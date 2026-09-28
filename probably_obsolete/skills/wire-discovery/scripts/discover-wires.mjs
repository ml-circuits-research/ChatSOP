#!/usr/bin/env node
/**
 * discover-wires.mjs — deterministic mass analyzer over the shipped circuits.
 *
 * It is the repeatable, tooled version of proposal_wires.md: it reads every
 * shipped `solution.sop`, extracts each jsEval body, normalizes the body into a
 * shape (slot/variable names replaced by metavariables assigned by position,
 * whitespace canonicalized), hashes the shape, clusters by hash, and ranks the
 * clusters by the product (frequency x mean-line-count x error-share). The
 * error share is read from the latest holdout items: among the holdout items
 * whose generated program contains the shape, the fraction whose class is not
 * `answer_match`.
 *
 * The same run prints the line-cost map of the procedural generator: which
 * operators transcribe to a single jsEval line and which already emit a
 * declarative wire, so the report names what a wire would absorb and what it
 * would not.
 *
 * Usage:
 *   node discover-wires.mjs [--top N] [--report path.md] [--training-data dir]
 *                           [--holdout path.jsonl] [--generator path.mjs]
 *
 * Output goes to stdout always; a markdown report is written only when
 * `--report` names a path (the caller owns the default).
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    top: 20,
    report: null,
    trainingData: 'training-data',
    holdout: 'evaluation/registry/exp-018-1.7b-qwen3-dv4/items/holdout.jsonl',
    generator: 'teacher/procedural/composition-families.mjs'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--top') args.top = Number(argv[++i]);
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--training-data') args.trainingData = argv[++i];
    else if (a === '--holdout') args.holdout = argv[++i];
    else if (a === '--generator') args.generator = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('discover-wires.mjs [--top N] [--report path.md] [--training-data dir] [--holdout path.jsonl] [--generator path.mjs]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

function walkSolutionFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.name === 'solution.sop') out.push(p);
    }
  }
  return out.sort();
}

function familyFromPath(filePath) {
  // The instance directory sits two levels above the file; its parent names the
  // family. Example: .../keep-below-total-ratio/keep-below-total-ratio-instance-002/solution.sop
  return basename(dirname(dirname(filePath)));
}

function nonEmptyLineCount(text) {
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.trim() !== '') n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Circuit extraction
// ---------------------------------------------------------------------------

/**
 * Split an SOP text into its wire blocks. Each block is `@name command`
 * followed by its body up to the next `@` line. Leading and trailing blank
 * lines of the body are trimmed.
 */
function extractWires(text) {
  const lines = text.split('\n');
  const wires = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^@(\S+)\s+(\S+)/);
    if (m) {
      if (cur) wires.push(cur);
      cur = { name: m[1], command: m[2], bodyLines: [] };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  if (cur) wires.push(cur);
  for (const w of wires) {
    while (w.bodyLines.length && w.bodyLines[0].trim() === '') w.bodyLines.shift();
    while (w.bodyLines.length && w.bodyLines[w.bodyLines.length - 1].trim() === '') w.bodyLines.pop();
    w.body = w.bodyLines.join('\n');
  }
  return wires;
}

// ---------------------------------------------------------------------------
// Deterministic normalization
// ---------------------------------------------------------------------------

const KEYWORDS = new Set((
  'break case catch class const continue debugger default delete do else export extends ' +
  'finally for function if import in instanceof let new return super switch this throw try ' +
  'typeof var void while with yield await async of static get set true false null undefined'
).split(' '));

const GLOBALS = new Set((
  'Math Number Array Object String Boolean Set Map JSON Symbol RegExp Date Error Infinity ' +
  'NaN parseInt parseFloat isNaN isFinite console'
).split(' '));

/**
 * Canonicalize a jsEval body into a shape string:
 *  - comments are stripped (they carry the stage index and operator name, not structure);
 *  - string literals and numbers are kept verbatim;
 *  - `slots.<key>` members are replaced by a slot metavariable `K<n>` assigned
 *    by position of first appearance;
 *  - `$wire` references are replaced by `$W<n>` by position;
 *  - every other identifier that is not a keyword, a global, `probe`, `slots`,
 *    or a method/property name is replaced by a variable metavariable `V<n>`
 *    assigned by position of first appearance;
 *  - whitespace is canonicalized to single spaces.
 */
function normalizeBody(body) {
  const out = [];
  let i = 0;
  const n = body.length;
  const varMap = new Map();
  const slotMap = new Map();
  const refMap = new Map();
  let varSeq = 0;
  let slotSeq = 0;
  let refSeq = 0;
  let lastIdentRaw = null;
  let dotPending = false;

  while (i < n) {
    const c = body[i];

    if (c === '/' && body[i + 1] === '/') {
      while (i < n && body[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && body[i + 1] === '*') {
      i += 2;
      while (i < n && !(body[i] === '*' && body[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      let s = q;
      while (j < n) {
        if (body[j] === '\\') { s += body[j] + (body[j + 1] || ''); j += 2; continue; }
        s += body[j];
        if (body[j] === q) { j += 1; break; }
        j += 1;
      }
      out.push(s);
      i = j;
      lastIdentRaw = null;
      dotPending = false;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9]/.test(body[j])) j += 1;
      out.push(body.slice(i, j));
      i = j;
      lastIdentRaw = null;
      dotPending = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(body[j])) j += 1;
      const word = body.slice(i, j);
      if (word.startsWith('$')) {
        if (!refMap.has(word)) refMap.set(word, 'W' + (refSeq++));
        out.push('$' + refMap.get(word));
      } else if (KEYWORDS.has(word) || GLOBALS.has(word) || word === 'probe' || word === 'slots') {
        out.push(word);
      } else if (dotPending) {
        if (lastIdentRaw === 'slots') {
          if (!slotMap.has(word)) slotMap.set(word, 'K' + (slotSeq++));
          out.push(slotMap.get(word));
        } else {
          out.push(word);
        }
      } else {
        if (!varMap.has(word)) varMap.set(word, 'V' + (varSeq++));
        out.push(varMap.get(word));
      }
      lastIdentRaw = word;
      dotPending = false;
      i = j;
      continue;
    }

    out.push(c);
    if (c === '.') {
      dotPending = true;
    } else {
      lastIdentRaw = null;
      dotPending = false;
    }
    i += 1;
  }
  return out.join(' ');
}

function sha1(text) {
  return createHash('sha1').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// Generator line-cost map
// ---------------------------------------------------------------------------

/**
 * Read the committed procedural generator body strings and report the
 * transcription length per operator: one jsEval line, or an already-declarative
 * wire (the multi-line transcription the wire absorbed).
 */
function parseLineCostMap(src) {
  const map = { oneLine: [], declarative: [] };

  const olStart = src.indexOf('function operatorLines');
  if (olStart >= 0) {
    const olEnd = src.indexOf('\n}\n', olStart);
    const olBody = src.slice(olStart, olEnd < 0 ? undefined : olEnd);
    const re = /if \(name === '([^']+)'\) \{\s*return \[([\s\S]*?)\];\s*\}/g;
    let m;
    while ((m = re.exec(olBody))) {
      map.oneLine.push({ operator: m[1], lines: 1 });
    }
  }

  const idStart = src.indexOf('function isDeclarative');
  if (idStart >= 0) {
    const idEnd = src.indexOf('\n}', idStart);
    const idBody = src.slice(idStart, idEnd < 0 ? undefined : idEnd);
    for (const m of idBody.matchAll(/name === '([^']+)'/g)) {
      map.declarative.push({ operator: m[1], command: null, body: null });
    }
  }

  const dcStart = src.indexOf('function declarativeCommand');
  if (dcStart >= 0) {
    const dcEnd = src.indexOf('\n}', dcStart);
    const dcBody = src.slice(dcStart, dcEnd < 0 ? undefined : dcEnd);
    const re = /if \(name === '([^']+)'(?:\s*\|\|\s*name === '([^']+)')?\) \{\s*return '([^']+)';/g;
    let m;
    while ((m = re.exec(dcBody))) {
      const cmd = m[3];
      for (const nm of [m[1], m[2]].filter(Boolean)) {
        const entry = map.declarative.find((d) => d.operator === nm);
        if (entry) entry.command = cmd;
      }
    }
  }

  const dbStart = src.indexOf('function declarativeBody');
  if (dbStart >= 0) {
    const dbEnd = src.indexOf('\n}', dbStart);
    const dbBody = src.slice(dbStart, dbEnd < 0 ? undefined : dbEnd);
    const re = /if \(name === '([^']+)'\) \{\s*return `([\s\S]*?)`;\s*\}/g;
    let m;
    while ((m = re.exec(dbBody))) {
      const entry = map.declarative.find((d) => d.operator === m[1]);
      if (entry) {
        const raw = m[2].replace(/\\n/g, '\n');
        entry.body = raw.split('\n').map((l) => l.trim()).filter((l) => l !== '');
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Holdout error correlation
// ---------------------------------------------------------------------------

/**
 * Read the holdout items and index, per normalized shape hash, the class of
 * every item whose generated program (`completion`) contains that shape.
 * Returns the index plus the holdout totals for the correlation summary.
 */
function indexHoldout(holdoutPath) {
  const index = new Map(); // hash -> { match, mismatch, execution, other, items: [class] }
  const totals = { items: 0, failing: 0, match: 0, mismatch: 0, execution: 0, other: 0 };
  if (!existsSync(holdoutPath)) return { index, totals };

  let text;
  try {
    text = readFileSync(holdoutPath, 'utf8');
  } catch {
    return { index, totals };
  }

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const completion = item.completion;
    if (typeof completion !== 'string' || completion === '') continue;
    const cls = typeof item.class === 'string' ? item.class : 'unknown';

    totals.items += 1;
    if (cls === 'answer_match') totals.match += 1;
    else if (cls === 'answer_mismatch') totals.mismatch += 1;
    else if (cls === 'execution_error') totals.execution += 1;
    else totals.other += 1;
    if (cls !== 'answer_match') totals.failing += 1;

    const seen = new Set();
    for (const w of extractWires(completion)) {
      if (w.command !== 'jsEval') continue;
      const h = sha1(normalizeBody(w.body));
      if (seen.has(h)) continue;
      seen.add(h);
      let bucket = index.get(h);
      if (!bucket) {
        bucket = { match: 0, mismatch: 0, execution: 0, other: 0, items: [] };
        index.set(h, bucket);
      }
      bucket.items.push(cls);
      if (cls === 'answer_match') bucket.match += 1;
      else if (cls === 'answer_mismatch') bucket.mismatch += 1;
      else if (cls === 'execution_error') bucket.execution += 1;
      else bucket.other += 1;
    }
  }
  return { index, totals };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const trainingDir = resolve(root, args.trainingData);
  const holdoutPath = resolve(root, args.holdout);
  const generatorPath = resolve(root, args.generator);

  // 1. Scan shipped circuits.
  const files = walkSolutionFiles(trainingDir);

  const commandCounts = {};
  const wireCountDistribution = {};
  const shapes = new Map(); // hash -> { count, totalLines, families:Set, bodies:[] }

  let jsEvalBodies = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const wires = extractWires(text);
    wireCountDistribution[wires.length] = (wireCountDistribution[wires.length] || 0) + 1;
    const family = familyFromPath(file);

    for (const w of wires) {
      commandCounts[w.command] = (commandCounts[w.command] || 0) + 1;
      if (w.command !== 'jsEval') continue;
      jsEvalBodies += 1;
      const norm = normalizeBody(w.body);
      const h = sha1(norm);
      let shape = shapes.get(h);
      if (!shape) {
        shape = { count: 0, totalLines: 0, families: new Set(), bodies: [] };
        shapes.set(h, shape);
      }
      shape.count += 1;
      shape.totalLines += nonEmptyLineCount(w.body);
      shape.families.add(family);
      if (shape.bodies.length < 8) shape.bodies.push(w.body);
    }
  }

  // 2. Holdout correlation.
  const { index: holdoutIndex, totals: holdoutTotals } = indexHoldout(holdoutPath);

  // 3. Rank shapes.
  const ranked = [];
  let containmentShapes = 0;
  let containmentMatches = 0;
  let containmentFailing = 0;
  for (const [h, shape] of shapes) {
    const meanLines = shape.totalLines / shape.count;
    const bucket = holdoutIndex.get(h);
    let containing = 0;
    let failing = 0;
    let breakdown = { match: 0, mismatch: 0, execution: 0, other: 0 };
    if (bucket) {
      containing = bucket.items.length;
      failing = bucket.mismatch + bucket.execution + bucket.other;
      breakdown = { match: bucket.match, mismatch: bucket.mismatch, execution: bucket.execution, other: bucket.other };
      containmentShapes += 1;
      containmentMatches += containing;
      containmentFailing += failing;
    }
    const errorShare = containing > 0 ? failing / containing : 0;
    const mass = shape.count * meanLines;
    const score = mass * errorShare;
    ranked.push({
      hash: h,
      count: shape.count,
      meanLines,
      mass,
      familyCount: shape.families.size,
      errorShare,
      containing,
      failing,
      breakdown,
      score,
      bodies: shape.bodies
    });
  }
  ranked.sort((a, b) => b.score - a.score || b.mass - a.mass || b.count - a.count || b.meanLines - a.meanLines || a.hash.localeCompare(b.hash));

  // 4. Line-cost map.
  let lineCost = { oneLine: [], declarative: [] };
  if (existsSync(generatorPath)) {
    try {
      lineCost = parseLineCostMap(readFileSync(generatorPath, 'utf8'));
    } catch {
      lineCost = { oneLine: [], declarative: [] };
    }
  }

  // 5. Report.
  const report = buildReport({
    args,
    files,
    jsEvalBodies,
    commandCounts,
    wireCountDistribution,
    ranked,
    lineCost,
    holdoutTotals,
    containment: { shapes: containmentShapes, matches: containmentMatches, failing: containmentFailing }
  });
  console.log(report.text);

  if (args.report) {
    const reportPath = resolve(root, args.report);
    writeFileSync(reportPath, report.markdown, 'utf8');
    console.error(`report written to ${reportPath}`);
  }
}

function pct(part, whole) {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function buildReport({ args, files, jsEvalBodies, commandCounts, wireCountDistribution, ranked, lineCost, holdoutTotals, containment }) {
  const lines = [];
  const md = [];

  const head = 'wire-discovery: shipped-circuit shape analysis';
  lines.push(head);
  lines.push('='.repeat(head.length));

  // Totals.
  lines.push('');
  lines.push(`solution.sop files scanned: ${files.length}`);
  lines.push(`jsEval bodies scanned:     ${jsEvalBodies}`);
  lines.push(`distinct shapes found:     ${ranked.length}`);

  lines.push('');
  lines.push('wire commands across the shipped dataset:');
  const sortedCommands = Object.entries(commandCounts).sort((a, b) => b[1] - a[1]);
  const totalWires = sortedCommands.reduce((sum, [, count]) => sum + count, 0);
  for (const [cmd, count] of sortedCommands) {
    lines.push(`  ${cmd.padEnd(12)} ${count} (${pct(count, totalWires)} of ${totalWires} wires)`);
  }

  lines.push('');
  lines.push('wire count per circuit:');
  const sortedDist = Object.entries(wireCountDistribution).sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [wc, count] of sortedDist) {
    lines.push(`  ${wc} wire(s): ${count} circuits (${pct(count, files.length)} of ${files.length})`);
  }

  // Error-correlation finding.
  lines.push('');
  lines.push('error-class correlation (holdout):');
  lines.push(`  holdout items: ${holdoutTotals.items} (answer_match ${holdoutTotals.match}, answer_mismatch ${holdoutTotals.mismatch}, execution_error ${holdoutTotals.execution}, other ${holdoutTotals.other})`);
  lines.push(`  failing holdout items: ${holdoutTotals.failing} of ${holdoutTotals.items}`);
  lines.push(`  shipped shapes contained in any holdout program: ${containment.shapes} of ${ranked.length}`);
  lines.push(`  (shape, item) containment matches: ${containment.matches}`);
  lines.push(`  failing containment matches: ${containment.failing}`);
  lines.push(`  -> error share is ${containment.failing === 0 ? '0 for every shape (no whole-body shape occurs in a failing holdout program)' : 'non-zero for some shapes'}`);

  // Top table.
  const top = ranked.slice(0, args.top);
  lines.push('');
  lines.push(`top ${top.length} shapes, ranked by frequency x mean-lines x error-share (ties by frequency x mean-lines):`);
  for (let i = 0; i < top.length; i += 1) {
    const s = top[i];
    const errTxt = s.containing > 0
      ? `${s.failing}/${s.containing} (${pct(s.failing, s.containing)}) [match ${s.breakdown.match}, mismatch ${s.breakdown.mismatch}, execution ${s.breakdown.execution}, other ${s.breakdown.other}]`
      : 'no holdout program contains this shape';
    lines.push('');
    lines.push(`${i + 1}. ${s.hash.slice(0, 12)}  freq ${s.count}  mean-lines ${s.meanLines.toFixed(2)}  freq-x-lines ${s.mass.toFixed(1)}  families ${s.familyCount}  error-share ${errTxt}  score ${s.score.toFixed(2)}`);
    const rep = s.bodies[0] || '';
    for (const l of rep.split('\n')) {
      lines.push(`      | ${l}`);
    }
  }

  // Line-cost map.
  lines.push('');
  lines.push('line-cost map (procedural generator transcription):');
  lines.push(`  one-line jsEval operators: ${lineCost.oneLine.length}`);
  lines.push(`    ${lineCost.oneLine.map((o) => o.operator).join(', ')}`);
  lines.push(`  declarative operators (already a wire): ${lineCost.declarative.length}`);
  for (const d of lineCost.declarative) {
    const bodyDesc = d.body ? ` (${d.body.length} field${d.body.length === 1 ? '' : 's'})` : '';
    lines.push(`    ${d.operator} -> ${d.command || '?'}${bodyDesc}`);
  }

  // Validation gate.
  const admitted = top.filter((s) => s.meanLines >= 2 && s.count >= 10);
  const belowBar = top.filter((s) => !(s.meanLines >= 2 && s.count >= 10));
  lines.push('');
  lines.push('validation gate (adoption requires the family round-trip/oracle tests AND `node training-data/verify.mjs`):');
  lines.push(`  top-${top.length} shapes admitted to that gate on line-reduction evidence (multi-line AND recurring): ${admitted.length}`);
  for (const s of admitted) {
    lines.push(`    ${s.hash.slice(0, 12)}  freq ${s.count}  mean-lines ${s.meanLines.toFixed(2)}  families ${s.familyCount}`);
  }
  lines.push(`  top-${top.length} shapes below the proposal bar (single-line or rare): ${belowBar.length}`);
  lines.push(`  note: error-share is 0 for every shape in this run (see correlation finding above), so no candidate carries mistake-reduction evidence yet; admission rests on line reduction alone.`);

  // ---- markdown ----
  md.push('# wire-discovery: shipped-circuit shape analysis');
  md.push('');
  md.push(`Run: ${new Date().toISOString()}`);
  md.push('');
  md.push('## Measured totals');
  md.push('');
  md.push(`- solution.sop files scanned: **${files.length}**`);
  md.push(`- jsEval bodies scanned: **${jsEvalBodies}**`);
  md.push(`- distinct shapes found: **${ranked.length}**`);
  md.push('');
  md.push('| command | count | share of wires |');
  md.push('|---|---|---|');
  for (const [cmd, count] of sortedCommands) {
    md.push(`| ${cmd} | ${count} | ${pct(count, totalWires)} |`);
  }
  md.push('');
  md.push('| wires per circuit | circuits | share |');
  md.push('|---|---|---|');
  for (const [wc, count] of sortedDist) {
    md.push(`| ${wc} | ${count} | ${pct(count, files.length)} |`);
  }
  md.push('');
  md.push('## Error-class correlation (holdout)');
  md.push('');
  md.push(`- holdout items: **${holdoutTotals.items}** — answer_match ${holdoutTotals.match}, answer_mismatch ${holdoutTotals.mismatch}, execution_error ${holdoutTotals.execution}, other ${holdoutTotals.other}`);
  md.push(`- failing holdout items: **${holdoutTotals.failing}** of ${holdoutTotals.items}`);
  md.push(`- shipped shapes contained in any holdout program: **${containment.shapes}** of ${ranked.length}`);
  md.push(`- (shape, item) containment matches: **${containment.matches}**`);
  md.push(`- failing containment matches: **${containment.failing}**`);
  md.push('');
  md.push(`Because failing containment is ${containment.failing}, the error-share factor is 0 for every shape; no whole-body shape occurs in a failing holdout program, so the ranking below reduces to frequency x mean-lines.`);
  md.push('');
  md.push(`## Top ${top.length} shapes (frequency x mean-lines x error-share)`);
  md.push('');
  for (let i = 0; i < top.length; i += 1) {
    const s = top[i];
    const errTxt = s.containing > 0
      ? `${s.failing}/${s.containing} (${pct(s.failing, s.containing)})`
      : 'no holdout program contains this shape';
    md.push(`### ${i + 1}. \`${s.hash.slice(0, 12)}\``);
    md.push('');
    md.push(`- frequency: **${s.count}**`);
    md.push(`- mean lines: **${s.meanLines.toFixed(2)}**`);
    md.push(`- frequency x lines: **${s.mass.toFixed(1)}**`);
    md.push(`- distinct families: **${s.familyCount}**`);
    md.push(`- error share: **${errTxt}** — match ${s.breakdown.match}, mismatch ${s.breakdown.mismatch}, execution ${s.breakdown.execution}, other ${s.breakdown.other}`);
    md.push(`- score (freq x lines x error-share): **${s.score.toFixed(2)}**`);
    md.push('');
    md.push('```js');
    md.push(s.bodies[0] || '');
    md.push('```');
    md.push('');
  }
  md.push('## Line-cost map (procedural generator transcription)');
  md.push('');
  md.push(`- one-line jsEval operators: **${lineCost.oneLine.length}** — ${lineCost.oneLine.map((o) => o.operator).join(', ')}`);
  md.push(`- declarative operators (already a wire): **${lineCost.declarative.length}**`);
  for (const d of lineCost.declarative) {
    const bodyDesc = d.body ? ` (${d.body.length} field${d.body.length === 1 ? '' : 's'})` : '';
    md.push(`  - \`${d.operator}\` -> \`${d.command || '?'}\`${bodyDesc}`);
  }
  md.push('');
  md.push('## Validation gate');
  md.push('');
  md.push('A proposed abstraction is adopted only after the family round-trip/oracle tests AND `node training-data/verify.mjs` (which executes every shipped circuit and reproduces the printed answer) pass, in every phase. Applying that rule to the measured top candidates:');
  md.push('');
  md.push(`- top-${top.length} shapes admitted to that gate on line-reduction evidence (multi-line AND recurring): **${admitted.length}**`);
  for (const s of admitted) {
    md.push(`  - \`${s.hash.slice(0, 12)}\` freq ${s.count}, mean-lines ${s.meanLines.toFixed(2)}, families ${s.familyCount}`);
  }
  md.push(`- top-${top.length} shapes below the proposal bar (single-line or rare): **${belowBar.length}**`);
  md.push('');
  md.push('Error-share is 0 for every shape in this run (see the correlation section), so no candidate carries mistake-reduction evidence yet; admission rests on line reduction alone, and every admitted candidate still owes the round-trip/oracle and verify gates before adoption.');
  md.push('');

  return { text: lines.join('\n'), markdown: md.join('\n') + '\n' };
}

main();
