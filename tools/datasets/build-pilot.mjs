import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, canonical, validateGraph } from '../../sop/parser.mjs';
import { sha256, validateCorpus } from './schema.mjs';
import { barePrompt as formalPrompt } from '../../server/llm.mjs';

const templatePath = fileURLToPath(new URL('../../datasets/templates/pilot.json', import.meta.url));
const sourceTemplate = fs.readFileSync(templatePath, 'utf8');
const templates = JSON.parse(sourceTemplate);
export const RESERVED_STRUCTURES = Object.freeze(['two-hop-ground', 'two-hop-inverse', 'two-hop-missing', 'two-hop-select']);
const stamp = '2026-09-26T12:00:00Z';
const sop = source => { const p = parse(source); validateGraph(p); return canonical(p); };
const rng = seed => { let n = seed >>> 0; return () => { n = (Math.imul(1664525, n) + 1013904223) >>> 0; return n / 4294967296; }; };
const phrase = (template, a, b) => template.replace('{a}', a).replace('{b}', b);

// Deliberately separate from SOP execution: graph reachability and explicit signed edges.
function graphOracle(parents, negativeParents, negativeGrandparents, predicate, left, right) {
  const positive = predicate === 'parent' ? parents : new Set([...parents].flatMap(edge => {
    const [, middle] = edge.split('|');
    return [...parents].filter(other => other.startsWith(middle + '|')).map(other => `${edge.split('|')[0]}|${other.split('|')[1]}`);
  }));
  const negative = predicate === 'parent' ? negativeParents : negativeGrandparents;
  const match = edge => { const [a, b] = edge.split('|'); return (left === '?who' || left === a) && (right === '?who' || right === b); };
  const hits = [...positive].filter(match).sort();
  if (left === '?who' || right === '?who') return { status: hits.length ? 'supported' : 'unknown', answers: hits.map(edge => [left === '?who' ? edge.split('|')[0] : edge.split('|')[1]]) };
  const key = `${left}|${right}`, yes = positive.has(key), no = negative.has(key);
  return { status: yes && no ? 'both' : yes ? 'supported' : no ? 'refuted' : 'unknown', answers: yes ? [[]] : [] };
}

export function buildPilot({ worlds = 100, seed = 731 } = {}) {
  if (!Number.isSafeInteger(worlds) || worlds < 10 || !Number.isSafeInteger(seed)) throw Error('worlds must be an integer >= 10 and seed a safe integer');
  const random = rng(seed), shuffled = Array.from({ length: worlds }, (_, i) => i);
  for (let i = worlds - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const devCount = Math.max(1, Math.floor(worlds * .15)), testCount = Math.max(1, Math.floor(worlds * .15));
  const allocation = new Map(shuffled.map((world, rank) => [world, rank < testCount ? 'test' : rank < testCount + devCount ? 'dev' : 'train']));
  const rows = [];
  for (let world = 0; world < worlds; world++) {
    const split = allocation.get(world), group = `world_${seed}_${world}`;
    const [a, b, c, d] = [0, 1, 2, 3].map(i => `person_${seed < 0 ? 'n' + Math.abs(seed) : seed}_${world}_${i}`);
    const parents = new Set([`${a}|${b}`, `${b}|${c}`]);
    const negativeParents = new Set([`${c}|${a}`]);
    const negativeGrandparents = split === 'train' ? new Set() : new Set([`${c}|${a}`]);
    const source = [phrase(templates.english.parent, a, b), phrase(templates.english.parent, b, c), phrase(templates.english.negative, c, a)];
    const atoms = [`parent(${a}, ${b})`, `parent(${b}, ${c})`, `not parent(${c}, ${a})`];
    if (split !== 'train') { source.push(phrase(templates.english.grandparentNegative, c, a)); atoms.push(`not grandparent(${c}, ${a})`); }
    const facts = atoms.map((atom, index) => `@fact${index} fact\n  holds ${atom}\n  valid timeless\n  source ${group}\n  quote ${JSON.stringify(source[index])}`);
    const rule = '@twoHop rule\n  when parent(?x, ?y)\n  when parent(?y, ?z)\n  then grandparent(?x, ?z)';
    const setup = sop([...facts, ...(split === 'train' ? [] : [rule])].join('\n'));
    const sourceSha = sha256(source.join('\n') + '\n');
    const plans = split === 'train' ? [
      ['direct-ground', 'parent', a, b, null],
      ['direct-inverse', 'parent', b, a, 0],
      ['direct-explicit-opposite', 'parent', c, a, 0],
      ['direct-missing', 'parent', a, d, 0],
      ['direct-select', 'parent', '?who', c, null],
      ['clarification', null, null, null, null],
    ] : [
      ['two-hop-ground', 'grandparent', a, c, null],
      ['two-hop-inverse', 'grandparent', c, a, 0],
      ['two-hop-missing', 'grandparent', a, d, 0],
      ['two-hop-select', 'grandparent', '?who', c, null],
      ['direct-ground', 'parent', a, b, null],
      ['clarification', null, null, null, null],
    ];
    for (const [index, [structure, predicate, left, right, negativeIndex]] of plans.entries()) {
      const caseId = `${group}_case_${index}`;
      const oracle = predicate ? graphOracle(parents, negativeParents, negativeGrandparents, predicate, left, right) : { status: 'clarify' };
      const target = predicate ? sop(`@q query\n${left === '?who' ? '  mode select\n  select ?who\n' : ''}  where ${predicate}(${left}, ${right})\n  at 2026-09-26\n@answer solve\n  query $q`) : sop('@ask clarify\n  text "Which person and relationship should I check?"');
      const en = predicate ? left === '?who' ? `Who is a ${predicate} of ${right}?` : `Is ${left} a ${predicate} of ${right}?` : 'Is that person related to the other one?';
      const ro = predicate ? left === '?who' ? `Cine este ${predicate === 'parent' ? 'părintele' : 'bunicul'} lui ${right}?` : `Este ${left} ${predicate === 'parent' ? 'părintele' : 'bunicul'} lui ${right}?` : 'Este acea persoană rudă cu cealaltă?';
      const languages = index === 0 ? ['en', 'ro'] : ['en'];
      for (const language of languages) {
        const row = {
          id: `${caseId}_${language}`, semantic_case_id: caseId, split_group_id: group, structure_id: structure, split,
          source: { id: group, kind: 'synthetic_fixture', uri: `synthetic://pilot/${group}`, revision: sha256(sourceTemplate), sha256: sourceSha, license: null },
          context_assertions: source, question: language === 'en' ? en : ro, language, surface_group_id: `${caseId}_surface`, sop_target: target,
          semantic_status: predicate ? 'valid' : 'ambiguous', negative_of: negativeIndex === null ? null : `${group}_case_${negativeIndex}`,
          generation_trace: { method: 'deterministic-template', template: `${templates.version}/${structure}/${language}`, model: null, review_status: 'synthetic_unreviewed' },
          quality_flags: { synthetic: true, graph_oracle: true, human_reviewed: false }, setup_sop: setup,
          context: { now: stamp, language, entities: [a, b, c, d].map(id => ({ id, type: 'person', label: id })), predicates: (split === 'train' ? ['parent'] : ['parent', 'grandparent']).map(id => ({ id, args: ['person', 'person'], meaning: id === 'parent' ? 'parent relationship' : 'parent of a parent' })), approvedTemplates: [], procedures_sop: [] },
          expected: oracle,
        };
        rows.push(row);
      }
    }
  }
  validateCorpus(rows, { reservedStructures: RESERVED_STRUCTURES });
  return rows;
}

export function writePilot({ out, evalOut, worlds = 100, seed = 731 }) {
  if (!out || !evalOut || path.resolve(out) === path.resolve(evalOut) || path.resolve(out).startsWith(path.resolve(evalOut) + path.sep) || path.resolve(evalOut).startsWith(path.resolve(out) + path.sep)) throw Error('Disjoint --out and --eval-out directories are required to seal test');
  const rows = buildPilot({ worlds, seed }), summary = validateCorpus(rows, { reservedStructures: RESERVED_STRUCTURES });
  const files = {}, evalFiles = {};
  const writeRows = (dir, name, items, map, key = name) => { fs.mkdirSync(dir, { recursive: true }); const data = items.map(item => JSON.stringify(item)).join('\n') + '\n'; fs.writeFileSync(path.join(dir, name), data); map[key] = sha256(data); };
  for (const split of ['train', 'dev']) writeRows(out, `${split}.jsonl`, rows.filter(row => row.split === split), files);
  writeRows(evalOut, 'test.jsonl', rows.filter(row => row.split === 'test'), evalFiles);
  for (const split of ['train', 'dev']) writeRows(path.join(out, 'formalizer'), `${split}.jsonl`, rows.filter(row => row.split === split).map(row => ({ id: row.id, prompt: formalPrompt([...row.context_assertions, row.question].join('\n'), row.context), target: row.sop_target, context: row.context, setup: row.setup_sop, group: row.split_group_id })), files, `formalizer/${split}.jsonl`);
  const version = { counter: 1, label: 'pilot-source-v1' };
  const versionBytes = JSON.stringify(version) + '\n';
  for (const [dir, map] of [[out, files], [evalOut, evalFiles]]) { fs.writeFileSync(path.join(dir, 'VERSION'), versionBytes); map.VERSION = sha256(versionBytes); }
  const manifest = { format: 'chatsop-pilot-v1', version, seed, worlds, profile: 'sop-agent-3', source_template_sha256: sha256(sourceTemplate), reserved_structures: RESERVED_STRUCTURES, summary, files, sealed_eval: { relative_directory: path.relative(out, evalOut), manifest: 'manifest.json' } };
  const evalManifest = { format: 'chatsop-pilot-eval-v1', version, seed, worlds, profile: 'sop-agent-3', source_template_sha256: sha256(sourceTemplate), reserved_structures: RESERVED_STRUCTURES, files: evalFiles };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(evalOut, 'manifest.json'), JSON.stringify(evalManifest, null, 2) + '\n');
  return { summary, manifest, evalManifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) { if (!['--out', '--eval-out', '--worlds', '--seed'].includes(args[i]) || !args[i + 1]) throw Error('Usage: node tools/datasets/build-pilot.mjs --out DIR --eval-out DIR [--worlds COUNT] [--seed INTEGER]'); options[args[i] === '--eval-out' ? 'evalOut' : args[i].slice(2)] = args[i + 1]; }
    if (options.worlds !== undefined) options.worlds = Number(options.worlds);
    if (options.seed !== undefined) options.seed = Number(options.seed);
    console.log(JSON.stringify(writePilot(options).summary));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
