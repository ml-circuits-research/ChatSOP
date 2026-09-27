#!/usr/bin/env node
/**
 * static-check.mjs — deterministic per-body complexity scanner over the
 * shipped circuits.
 *
 * It reads every shipped `solution.sop` (the training-data solution.sop files), walks
 * each jsEval body, and computes five whole-body metrics:
 *
 *   lines      — non-empty source lines of the body;
 *   loops      — statement-level loop keywords (`for`, `while`, `do`);
 *   chains     — method calls among filter/reduce/map/sort/some/every;
 *   variables  — distinct names declared with `const`/`let`/`var`;
 *   depth      — maximum brace (`{}`) nesting depth (blocks and object literals).
 *
 * A body is MONSTROUS when any metric exceeds its threshold. Defaults are
 * lines > 15, loops > 2, chains > 3, variables > 6, depth > 3; every threshold
 * is env-overridable (DQ_MAX_LINES, DQ_MAX_LOOPS, DQ_MAX_CHAINS,
 * DQ_MAX_VARIABLES, DQ_MAX_DEPTH). The scan is pure: no LLM, no model calls,
 * no execution, no GPU, no servers.
 *
 * For each flagged body it reports the file, the family (the directory two
 * levels above the file), the five metrics, and a suggestion that maps the
 * body's dominant shape onto a predefined wire. The suggestion is chosen by the
 * first matching detector in this order:
 *
 *   fraction   — a gcd / reduced-ratio body (gcd, or numerator+denominator);
 *   graphPath  — an edge-list traversal body (edges plus shift/queue/visited/
 *                adjacency/neighbour/degree/reach/connected signals);
 *   aggregate  — a filter-then-reduce-to-scalar body (.filter with .reduce or
 *                Math.min/Math.max);
 *   container  — a build-then-query list body (.push together with a later
 *                filter/find/map/some/every);
 *   candidate  — the normalized shape hash is one of wire-discovery's top
 *                shapes (measured in skills/wire-discovery/last-report.md);
 *   container  — fallback: any remaining complex body points at the typed-store
 *                direction of the container plan (DS008).
 *
 * The normalized-shape hash reuses the exact normalization of
 * skills/wire-discovery/scripts/discover-wires.mjs so `candidate` compares
 * like-for-like against the measured top shapes.
 *
 * Usage:
 *   node static-check.mjs [--training-data dir] [--report path.md]
 *                         [--wire-discovery-report path.md]
 *
 * Output goes to stdout always; a markdown report is written when `--report`
 * names a path (the caller owns the default landing spot).
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Colors for the stdout listing: active only on a TTY and never under NO_COLOR,
// so piped output and the markdown report stay plain text.
// ---------------------------------------------------------------------------

const USE_COLOR = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  white: '\x1b[37m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};
const paint = (code, text) => (USE_COLOR ? `${code}${text}${C.reset}` : text);
const SUGGESTION_COLORS = {
  container: C.magenta,
  aggregate: C.green,
  fraction: C.cyan,
  graphPath: C.blue,
  candidate: C.yellow
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    trainingData: 'training-data',
    report: 'skills/data-quality/last-report.md',
    wireDiscoveryReport: 'skills/wire-discovery/last-report.md'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--training-data') args.trainingData = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--wire-discovery-report') args.wireDiscoveryReport = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('static-check.mjs [--training-data dir] [--report path.md] [--wire-discovery-report path.md]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Thresholds (env-overridable)
// ---------------------------------------------------------------------------

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function thresholds() {
  return {
    lines: envInt('DQ_MAX_LINES', 15),
    loops: envInt('DQ_MAX_LOOPS', 2),
    chains: envInt('DQ_MAX_CHAINS', 3),
    variables: envInt('DQ_MAX_VARIABLES', 6),
    depth: envInt('DQ_MAX_DEPTH', 3)
  };
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

function walkSolutionFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
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

// ---------------------------------------------------------------------------
// Circuit extraction
// ---------------------------------------------------------------------------

const DECLARATION_PATTERN = /^@([A-Za-z_][A-Za-z0-9_]*)[ \t]+(\S+)[ \t]*$/;

/**
 * Split an SOP text into its wire blocks. Each block is `@name command`
 * followed by its body up to the next declaration line. Leading and trailing
 * blank lines of the body are trimmed. This matches the runtime parser's
 * declaration rule (runtime/parser.mjs), so a body line that merely starts with
 * `@` is body content, never a declaration.
 */
function extractWires(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const wires = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(DECLARATION_PATTERN);
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

function nonEmptyLineCount(text) {
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.trim() !== '') n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Code cleaning (comments and string/template literals removed)
// ---------------------------------------------------------------------------

/**
 * Return the body with comments and string/template literals replaced by a
 * single space, so the metric scanners below count structure and never count a
 * word that happens to sit inside a probe message or a comment. Template
 * literals are removed whole (including any `${...}` inside them).
 */
function cleanedCode(body) {
  const out = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i];
    const next = body[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && body[i] !== '\n') i += 1;
      out.push('\n');
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(body[i] === '*' && body[i + 1] === '/')) {
        if (body[i] === '\n') out.push('\n');
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i += 1;
      while (i < n) {
        if (body[i] === '\\') { i += 2; continue; }
        if (body[i] === q) { i += 1; break; }
        i += 1;
      }
      out.push(' ');
      continue;
    }

    out.push(c);
    i += 1;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Statement-level loops: `for`, `while`, and `do` keywords. */
function countLoops(code) {
  const m = code.match(/\b(?:for|while|do)\b/g);
  return m ? m.length : 0;
}

/** Method calls among the declared chain verbs. */
function countChains(code) {
  const m = code.match(/\.[ \t\r\n]*(?:filter|reduce|map|sort|some|every)\s*\(/g);
  return m ? m.length : 0;
}

/** Distinct identifiers declared with `const`/`let`/`var`. */
function declaredVariableNames(code) {
  const names = new Set();
  const re = /\b(const|let|var)\b/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    let i = m.index + m[0].length;
    while (i < code.length && /\s/.test(code[i])) i += 1;
    collectDeclarators(code, i, names);
  }
  return names;
}

function collectDeclarators(code, start, names) {
  let i = start;
  for (;;) {
    while (i < code.length && /\s/.test(code[i])) i += 1;
    if (i >= code.length) return;
    const c = code[i];
    if (c === '{') {
      extractObjectBindings(code, i, names);
      i = skipBalanced(code, i, '{', '}');
    } else if (c === '[') {
      extractArrayBindings(code, i, names);
      i = skipBalanced(code, i, '[', ']');
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < code.length && /[A-Za-z0-9_$]/.test(code[j])) j += 1;
      names.add(code.slice(i, j));
      i = j;
    } else {
      return;
    }
    while (i < code.length && /\s/.test(code[i])) i += 1;
    if (code[i] === '=') {
      i = skipInitializer(code, i + 1);
      while (i < code.length && /\s/.test(code[i])) i += 1;
    }
    if (code[i] === ',') { i += 1; continue; }
    return;
  }
}

function extractObjectBindings(code, start, names) {
  // start points at the opening '{'. An identifier is a binding when it is not
  // immediately followed by ':' (which marks a property key).
  const end = skipBalanced(code, start, '{', '}');
  let i = start + 1;
  while (i < end) {
    const c = code[i];
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < end && /[A-Za-z0-9_$]/.test(code[j])) j += 1;
      let k = j;
      while (k < end && /\s/.test(code[k])) k += 1;
      if (code[k] !== ':') names.add(code.slice(i, j));
      i = j;
    } else {
      i += 1;
    }
  }
}

function extractArrayBindings(code, start, names) {
  const end = skipBalanced(code, start, '[', ']');
  let i = start + 1;
  while (i < end) {
    const c = code[i];
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < end && /[A-Za-z0-9_$]/.test(code[j])) j += 1;
      names.add(code.slice(i, j));
      i = j;
    } else {
      i += 1;
    }
  }
}

/** Advance past a balanced pair of open/close delimiters; returns index after the close. */
function skipBalanced(code, start, open, close) {
  let depth = 0;
  let i = start;
  for (; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return i;
}

/** Advance past an initializer expression to the next top-level ',' or terminator. */
function skipInitializer(code, start) {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(') paren += 1;
    else if (ch === ')') {
      if (paren === 0 && bracket === 0 && brace === 0) return i; // closes an outer for-header
      paren -= 1;
    } else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') {
      if (brace === 0) return i;
      brace -= 1;
    } else if ((ch === ',' || ch === ';') && paren === 0 && bracket === 0 && brace === 0) {
      return i;
    }
  }
  return code.length;
}

/** Maximum brace depth (blocks and object literals) reached in the cleaned code. */
function maxBraceDepth(code) {
  let depth = 0;
  let max = 0;
  for (const ch of code) {
    if (ch === '{') {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === '}') {
      depth -= 1;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// Suggestion
// ---------------------------------------------------------------------------

function suggest(body, code, shapeHash, topShapes) {
  if (/\bgcd\b/.test(code) || (/\bnumerator\b/.test(code) && /\bdenominator\b/.test(code))) {
    return 'fraction';
  }
  if (/\bedges\b/.test(code) && /\b(?:shift|queue|visited|seen|adjacency|adjacent|neighbor|neighbour|degree|reach|connected)\b/.test(code)) {
    return 'graphPath';
  }
  if (/\.[ \t\r\n]*filter\s*\(/.test(code) && (/\.[ \t\r\n]*reduce\s*\(/.test(code) || /Math\.min\s*\(/.test(code) || /Math\.max\s*\(/.test(code))) {
    return 'aggregate';
  }
  if (/\.push\s*\(/.test(code) && /\.[ \t\r\n]*(?:filter|find|map|some|every)\s*\(/.test(code)) {
    return 'container';
  }
  if (topShapes.has(shapeHash.slice(0, 12))) {
    return 'candidate';
  }
  return 'container';
}

// ---------------------------------------------------------------------------
// Normalization (kept identical to wire-discovery for like-for-like hashes)
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
// wire-discovery top shapes
// ---------------------------------------------------------------------------

function readTopShapeHashes(reportPath) {
  const set = new Set();
  if (!existsSync(reportPath)) return set;
  let text;
  try {
    text = readFileSync(reportPath, 'utf8');
  } catch {
    return set;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^### \d+\. `([0-9a-f]{12})`/);
    if (m) set.add(m[1]);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const trainingDir = resolve(root, args.trainingData);
  const reportPath = resolve(root, args.report);
  const wireDiscoveryPath = resolve(root, args.wireDiscoveryReport);

  const thr = thresholds();
  const topShapes = readTopShapeHashes(wireDiscoveryPath);

  const files = walkSolutionFiles(trainingDir);

  const metricExceeds = { lines: 0, loops: 0, chains: 0, variables: 0, depth: 0 };
  const tripCounts = {}; // number of thresholds tripped -> count
  const suggestionCounts = {};
  const familyFlagged = {}; // family -> flagged body count
  const topShapeHits = {}; // top-shape prefix -> body count (across all bodies)
  const flagged = [];

  let jsEvalBodies = 0;
  let totalWires = 0;
  let totalJsLines = 0;
  const bloated = [];

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const family = familyFromPath(file);
    const wires = extractWires(text);
    totalWires += wires.length;
    let fileJsLines = 0;

    for (const w of wires) {
      if (w.command !== 'jsEval') continue;
      jsEvalBodies += 1;
      fileJsLines += nonEmptyLineCount(w.body);
      totalJsLines += nonEmptyLineCount(w.body);

      const code = cleanedCode(w.body);
      const metrics = {
        lines: nonEmptyLineCount(w.body),
        loops: countLoops(code),
        chains: countChains(code),
        variables: declaredVariableNames(code).size,
        depth: maxBraceDepth(code)
      };

      const shapeHash = sha1(normalizeBody(w.body));
      const prefix = shapeHash.slice(0, 12);
      if (topShapes.has(prefix)) {
        topShapeHits[prefix] = (topShapeHits[prefix] || 0) + 1;
      }

      const trips = [];
      if (metrics.lines > thr.lines) trips.push('lines');
      if (metrics.loops > thr.loops) trips.push('loops');
      if (metrics.chains > thr.chains) trips.push('chains');
      if (metrics.variables > thr.variables) trips.push('variables');
      if (metrics.depth > thr.depth) trips.push('depth');

      if (trips.length === 0) continue;

      for (const t of trips) metricExceeds[t] += 1;
      tripCounts[trips.length] = (tripCounts[trips.length] || 0) + 1;

      const suggestion = suggest(w.body, code, shapeHash, topShapes);
      suggestionCounts[suggestion] = (suggestionCounts[suggestion] || 0) + 1;
      familyFlagged[family] = (familyFlagged[family] || 0) + 1;

      flagged.push({ file, family, metrics, trips, suggestion });
    }
    // The bloat indicator: a plan with at most the minimal three wires (slots,
    // answer, and maybe one stage) that still carries a large mass of hand-written
    // JavaScript is a candidate for more, smaller wires.
    if (wires.length <= 3 && fileJsLines > 25) {
      bloated.push({ file, family, wires: wires.length, lines: fileJsLines });
    }
  }

  const report = buildReport({ args, thr, files, jsEvalBodies, totalWires, totalJsLines, bloated, metricExceeds, tripCounts, suggestionCounts, familyFlagged, topShapeHits, flagged, topShapes });
  console.log(report.text);

  writeFileSync(reportPath, report.markdown, 'utf8');
  console.error(`report written to ${reportPath}`);
}

function pct(part, whole) {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function buildReport({ args, thr, files, jsEvalBodies, totalWires, totalJsLines, bloated, metricExceeds, tripCounts, suggestionCounts, familyFlagged, topShapeHits, flagged, topShapes }) {
  const flaggedFiles = new Set(flagged.map((f) => f.file)).size;
  const topShapesPresent = Object.keys(topShapeHits).length;
  const topShapeHitBodies = Object.values(topShapeHits).reduce((s, n) => s + n, 0);

  const metricLabels = [
    ['lines', `> ${thr.lines}`],
    ['loops', `> ${thr.loops}`],
    ['chains', `> ${thr.chains}`],
    ['variables', `> ${thr.variables}`],
    ['depth', `> ${thr.depth}`]
  ];
  const SUGGESTIONS = ['fraction', 'graphPath', 'aggregate', 'container', 'candidate'];
  const sortedSugg = SUGGESTIONS
    .map((s) => [s, suggestionCounts[s] || 0])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const allSugg = SUGGESTIONS.map((s) => [s, suggestionCounts[s] || 0]).sort((a, b) => b[1] - a[1]);
  const sortedFamilies = Object.entries(familyFlagged).sort((a, b) => b[1] - a[1]);

  const severity = (f) => f.trips.length * 1e6 + f.metrics.lines * 1e3 + f.metrics.chains * 10 + f.metrics.variables;
  const bySeverity = flagged.slice().sort((a, b) => severity(b) - severity(a));
  const representative = bySeverity.slice(0, 60);

  const lines = [];
  const md = [];

  const head = 'data-quality: jsEval body complexity scan';
  lines.push(head);
  lines.push('='.repeat(head.length));

  // Thresholds.
  lines.push('');
  lines.push('thresholds in effect (env-overridable):');
  lines.push(`  lines > ${thr.lines} (DQ_MAX_LINES)`);
  lines.push(`  loops > ${thr.loops} (DQ_MAX_LOOPS)`);
  lines.push(`  chains > ${thr.chains} (DQ_MAX_CHAINS)`);
  lines.push(`  variables > ${thr.variables} (DQ_MAX_VARIABLES)`);
  lines.push(`  depth > ${thr.depth} (DQ_MAX_DEPTH)`);

  // Totals.
  lines.push('');
  lines.push(`solution.sop files scanned: ${files.length}`);
  lines.push(`jsEval bodies scanned:     ${jsEvalBodies}`);
  lines.push(`bodies flagged MONSTROUS:  ${flagged.length} (${pct(flagged.length, jsEvalBodies)} of bodies)`);
  lines.push(`files with a flagged body: ${flaggedFiles} (${pct(flaggedFiles, files.length)} of files)`);

  // The bloat indicator: wires per plan against hand-written JavaScript mass.
  const avgWires = files.length === 0 ? 0 : (totalWires / files.length).toFixed(2);
  const avgJsLines = files.length === 0 ? 0 : (totalJsLines / files.length).toFixed(1);
  const jsPerWire = totalWires === 0 ? 0 : (totalJsLines / totalWires).toFixed(1);
  lines.push('');
  lines.push('the bloat indicator (wires vs hand-written JavaScript):');
  lines.push(`  total wires across the suite: ${totalWires}`);
  lines.push(`  average wires per plan:       ${avgWires}`);
  lines.push(`  average jsEval lines per plan: ${avgJsLines}`);
  lines.push(`  jsEval lines per wire:        ${jsPerWire} — low wire counts with high line counts mean bloat`);
  lines.push(`  plans with <= 3 wires but > 25 jsEval lines (too few wires): ${bloated.length} (${pct(bloated.length, files.length)} of plans)`);
  lines.push(`wire-discovery top shapes available for candidate matching: ${topShapes.size}`);
  lines.push(`wire-discovery top shapes still present in the current dataset: ${topShapesPresent} (${topShapeHitBodies} bodies)`);

  // Per-metric trips.
  lines.push('');
  lines.push('bodies exceeding each threshold (a body may exceed several):');
  for (const [key, label] of metricLabels) {
    lines.push(`  ${key.padEnd(11)} ${String(metricExceeds[key]).padStart(6)} (${pct(metricExceeds[key], jsEvalBodies)} of bodies)`);
  }

  // Trip-count distribution.
  lines.push('');
  lines.push('thresholds tripped per flagged body:');
  for (const [k, v] of Object.entries(tripCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    lines.push(`  ${k} threshold(s): ${v} bodies (${pct(v, flagged.length)} of flagged)`);
  }

  // Suggestion distribution.
  lines.push('');
  lines.push('suggestion distribution over flagged bodies:');
  for (const [s, v] of sortedSugg) {
    lines.push(`  ${s.padEnd(12)} ${v} (${pct(v, flagged.length)} of flagged)`);
  }

  // Per-family flagged counts.
  lines.push('');
  lines.push(`flagged bodies by family (${sortedFamilies.length} families affected):`);
  for (const [family, v] of sortedFamilies.slice(0, 20)) {
    lines.push(`  ${family.padEnd(48)} ${v}`);
  }
  if (sortedFamilies.length > 20) {
    lines.push(`  ... ${sortedFamilies.length - 20} more families`);
  }

  // Flagged list (full). Each body is two lines: the file on top, the
  // observation beneath it — one wide line per file was unreadable.
  lines.push('');
  lines.push(`flagged bodies (${flagged.length}):`);
  for (const f of flagged) {
    lines.push(`  ${paint(C.bold + C.white, f.file)}`);
    const observation = paint(C.dim, `    ${f.family}: lines=${f.metrics.lines} loops=${f.metrics.loops} chains=${f.metrics.chains} variables=${f.metrics.variables} depth=${f.metrics.depth}`)
      + ` | ${paint(C.red, `tripped=${f.trips.join('+')}`)}`
      + ` | ${paint(SUGGESTION_COLORS[f.suggestion] ?? C.white, `suggestion=${f.suggestion}`)}`;
    lines.push(observation);
  }

  // ---- markdown ----
  md.push('# data-quality: jsEval body complexity scan');
  md.push('');
  md.push(`Run: ${new Date().toISOString()}`);
  md.push('');
  md.push('## Thresholds in effect');
  md.push('');
  md.push('| metric | threshold | env override |');
  md.push('|---|---|---|');
  md.push(`| lines | \`> ${thr.lines}\` | \`DQ_MAX_LINES\` |`);
  md.push(`| loops | \`> ${thr.loops}\` | \`DQ_MAX_LOOPS\` |`);
  md.push(`| chains | \`> ${thr.chains}\` | \`DQ_MAX_CHAINS\` |`);
  md.push(`| variables | \`> ${thr.variables}\` | \`DQ_MAX_VARIABLES\` |`);
  md.push(`| depth | \`> ${thr.depth}\` | \`DQ_MAX_DEPTH\` |`);
  md.push('');
  md.push('## Totals');
  md.push('');
  md.push(`- solution.sop files scanned: **${files.length}**`);
  md.push(`- the bloat indicator: **${avgWires}** wires per plan against **${avgJsLines}** jsEval lines per plan (${jsPerWire} lines per wire); **${bloated.length}** plans carry ${'`'}<= 3 wires but > 25 jsEval lines${'`'} — too few wires for the JavaScript mass`);
  md.push(`- jsEval bodies scanned: **${jsEvalBodies}**`);
  md.push(`- bodies flagged MONSTROUS: **${flagged.length}** (${pct(flagged.length, jsEvalBodies)} of bodies)`);
  md.push(`- files with a flagged body: **${flaggedFiles}** (${pct(flaggedFiles, files.length)} of files)`);
  md.push(`- wire-discovery top shapes available for candidate matching: **${topShapes.size}**`);
  md.push(`- wire-discovery top shapes still present in the current dataset: **${topShapesPresent}** (${topShapeHitBodies} bodies)`);
  md.push('');
  md.push('## Per-metric trips');
  md.push('');
  md.push('A body may exceed several thresholds; each row counts bodies that trip that one metric.');
  md.push('');
  md.push('| metric | threshold | bodies | share of all bodies |');
  md.push('|---|---|---|---|');
  for (const [key, label] of metricLabels) {
    md.push(`| ${key} | \`${label}\` | ${metricExceeds[key]} | ${pct(metricExceeds[key], jsEvalBodies)} |`);
  }
  md.push('');
  md.push('## Thresholds tripped per flagged body');
  md.push('');
  md.push('| tripped | bodies | share of flagged |');
  md.push('|---|---|---|');
  for (const [k, v] of Object.entries(tripCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    md.push(`| ${k} | ${v} | ${pct(v, flagged.length)} |`);
  }
  md.push('');
  md.push('## Suggestion distribution');
  md.push('');
  md.push('| suggestion | bodies | share of flagged |');
  md.push('|---|---|---|');
  for (const [s, v] of allSugg) {
    md.push(`| ${s} | ${v} | ${pct(v, flagged.length)} |`);
  }
  md.push('');
  md.push('`candidate` matches a body\'s normalized shape against the top shapes in the current');
  md.push('wire-discovery report. A zero here means none of the flagged bodies is one of those');
  md.push('top shapes — usually because the wire-discovery report predates the last rebuild');
  md.push('(its measured shapes no longer occur verbatim, or the surviving shapes map to an');
  md.push('existing wire such as `graphPath`). Re-run wire-discovery, then re-run this tool, and');
  md.push('the candidate bucket repopulates.');
  md.push('');
  md.push('## Flagged bodies by family');
  md.push('');
  md.push(`- affected families: **${sortedFamilies.length}**`);
  md.push('');
  md.push('| family | flagged bodies |');
  md.push('|---|---|');
  for (const [family, v] of sortedFamilies) {
    md.push(`| ${family} | ${v} |`);
  }
  md.push('');
  md.push('## Flagged bodies (summary)');
  md.push('');
  md.push(`The ${flagged.length} flagged bodies are summarized here: the ${representative.length} most`);
  md.push('severe by tripped thresholds, then line count, then chain count. The complete per-body');
  md.push('list is printed to stdout by the tool.');
  md.push('');
  md.push('| file | family | lines | loops | chains | variables | depth | tripped | suggestion |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const f of representative) {
    md.push(`| \`${f.file}\` | ${f.family} | ${f.metrics.lines} | ${f.metrics.loops} | ${f.metrics.chains} | ${f.metrics.variables} | ${f.metrics.depth} | ${f.trips.join('+')} | ${f.suggestion} |`);
  }
  md.push('');

  return { text: lines.join('\n'), markdown: md.join('\n') + '\n' };
}

main();
