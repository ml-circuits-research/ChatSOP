import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../../sop/runtime.mjs';
import { Repository } from '../../memory/repository.mjs';
import { publishKnowledge } from '../../sop/ingest.mjs';
import { Lexicon } from '../../sop/lexicon.mjs';
import { parse } from '../../sop/parser.mjs';
import { buildCurriculum } from './build-curriculum.mjs';
import { cases, assumptions, attached, numeric, extra, blockedFamilies } from './curriculum/cases.mjs';

const ontology = fs.readFileSync(new URL('../../config/ontology.sop', import.meta.url), 'utf8');
const baseLexicon = new Lexicon(ontology);
const permitted = new Set(['premise', 'query', 'constraint']);
const categories = [
  ...cases.map(item => ({ ...item, world_id: item.world })),
  ...assumptions.map(item => ({ ...item, world_id: item.world })),
  ...attached.map(item => ({ ...item, world_id: `attached_${item.split}` })),
  ...numeric.map(item => ({ ...item, world_id: `numeric_${item.split}` })),
  ...extra.map(item => ({ ...item, world_id: `extra_${item.split}` })),
];
const byCase = new Map(categories.map(item => [item.id, item]));
if (byCase.size !== categories.length) throw Error('Duplicate source question IDs');
const blocked = new Map(blockedFamilies.map(({ family, reason }) => [family, reason]));

export function questionInventory() {
  const families = new Map();
  for (const item of categories) {
    const entry = families.get(item.family) ?? { family: item.family, worlds: new Set(), operators: new Set(), cases: 0 };
    entry.cases++;
    entry.worlds.add(item.world_id);
    item.operators.forEach(operator => entry.operators.add(operator));
    families.set(item.family, entry);
  }
  for (const family of blocked.keys()) if (!families.has(family)) families.set(family, { family, worlds: new Set(), operators: new Set(), cases: 0 });
  return [...families.values()].sort((a, b) => a.family.localeCompare(b.family)).map(item => ({
    family: item.family, worlds: [...item.worlds].sort(), operators: [...item.operators].sort(), cases: item.cases,
    ...(blocked.has(item.family) ? { reasoning_gap: blocked.get(item.family) } : {}),
  }));
}

function unsupportedReason(item, kinds) {
  if (item.family === 'unsupported_boundary') {
    const blockedOperator = item.operators.find(operator => blocked.has(operator));
    return blocked.get(blockedOperator) ?? item.clarification;
  }
  if (item.family === 'clarification') return `Unresolved reference or sense: ${item.clarification}`;
  if (item.id === 'assert_only') return 'Session recording requires the trusted remember wire; a model-authored premise is conditional and cannot persist a claim.';
  if (item.family === 'approved_procedure') return 'Procedure expansion and presentation require host-approved system wires, not a model-authored declarative target.';
  if (kinds.some(kind => !permitted.has(kind))) return `No declarative model interpreter for wires: ${kinds.filter(kind => !permitted.has(kind)).join(', ')}.`;
  return null;
}

function rank(seed, id) { return createHash('sha256').update(`${seed}\0${id}`).digest('hex'); }

/** Return deterministic, bounded surfaces; no row is training-approved or human-reviewed. */
export function generateQuestionCurriculum({ family, world, seed = 0, limit = 30 } = {}) {
  if (family !== undefined && (typeof family !== 'string' || !family)) throw Error('family must be a nonempty string');
  if (world !== undefined && (typeof world !== 'string' || !world)) throw Error('world must be a nonempty string');
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error('seed must be an integer and limit must be in 1..1000');
  const inventory = questionInventory();
  if (family && !inventory.some(item => item.family === family)) throw Error(`Unknown family ${family}`);
  if (world && !inventory.some(item => item.worlds.includes(world))) throw Error(`Unknown world ${world}`);
  if (family && world && !inventory.some(item => item.family === family && item.worlds.includes(world))) throw Error(`No ${family} questions in ${world}`);
  const rows = buildCurriculum().filter(row => (!family || row.matrix.family_id === family) && (!world || byCase.get(row.semantic_case_id)?.world_id === world));
  const result = rows.map(row => {
    const item = byCase.get(row.semantic_case_id);
    if (!item) throw Error(`Unrecognized source case ${row.semantic_case_id}`);
    const kinds = parse(row.sop_target).wires.map(wire => wire.type);
    const reason = unsupportedReason(item, kinds);
    const common = {
      id: row.id, case_id: item.id, family: item.family, world: item.world_id, split: row.split,
      split_group_id: row.split_group_id, operators: item.operators, language: row.language,
      question: row.question, evaluation_track: row.evaluation_track,
      review_status: 'synthetic_unreviewed_not_training_approved',
    };
    if (reason) return { ...common, status: 'unsupported', reason, target: null, host_setup: row.setup_sop, oracle: { status: 'unsupported', reason }, expected: { status: 'unsupported' } };
    return {
      ...common, status: 'executable', target: row.sop_target, host_setup: row.setup_sop,
      ...(row.ontology_sop ? { host_ontology: row.ontology_sop } : {}),
      host_context: { entities: row.context.entities, now: row.context.now },
      oracle: { kind: row.quality_flags.independent_oracle, status: row.expected.status },
      expected: { status: row.expected.status },
    };
  });
  // Blocked vision families have no source question/world. Inventory their gap without making up a question.
  if (!world) for (const [name, reason] of blocked) if ((!family || family === name) && !result.some(row => row.family === name)) result.push({
    id: `gap_${name}`, case_id: null, family: name, world: null, split: null, split_group_id: null,
    operators: [], language: null, question: null, evaluation_track: 'system', review_status: 'synthetic_unreviewed_not_training_approved',
    status: 'unsupported', reason, target: null, host_setup: '', oracle: { status: 'unsupported', reason }, expected: { status: 'unsupported' },
  });
  return result.sort((a, b) => rank(seed, a.id).localeCompare(rank(seed, b.id)) || a.id.localeCompare(b.id)).slice(0, limit);
}

/** Execute every surface gold against the existing runtime; never derive the oracle from the runtime. */
export async function verifyQuestionGolds(rows) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'question-curriculum-'));
  let executed = 0, unsupported = 0;
  try {
    for (const row of rows) {
      if (row.status === 'unsupported') {
        if (!row.reason || row.target !== null || row.expected?.status !== 'unsupported') throw Error(`${row.id}: invalid reasoning gap`);
        unsupported++;
        continue;
      }
      if (row.status !== 'executable' || !row.target || row.oracle?.status !== row.expected?.status) throw Error(`${row.id}: invalid independent oracle`);
      if (parse(row.target).wires.some(wire => !permitted.has(wire.type))) throw Error(`${row.id}: forbidden target wire`);
      const lexicon = row.host_ontology ? new Lexicon(row.host_ontology) : baseLexicon;
      const repo = new Repository(path.join(temp, `case-${executed}`), { memory: { engine: 'sqlite', power: 10 } });
      if (row.host_setup.trim()) publishKnowledge(repo, 'world', row.host_setup, { schema: lexicon.predicates, reviewed: true, knownAt: Date.parse('2024-01-01') });
      else repo.init('world');
      const session = repo.session('world', 'gold', 'evaluation');
      const runtime = new Runtime({ repo, session, lexicon, schema: lexicon.predicates, now: Date.parse(row.host_context.now), policy: { allowWrite: false } });
      const output = await runtime.run(row.target, { origin: 'model', inputText: row.question, language: row.language, context: { premises: [], entities: row.host_context.entities } });
      const observed = output.result?.packet?.status ?? output.result?.status;
      if (observed !== row.oracle.status) throw Error(`${row.id}: oracle ${row.oracle.status}, runtime ${observed ?? '(no status)'}`);
      executed++;
    }
    return { surfaces: rows.length, executed_golds: executed, unsupported_surfaces: unsupported };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (!['--family', '--world', '--seed', '--limit'].includes(args[i]) || !args[i + 1]) throw Error('Usage: node tools/datasets/question-curriculum.mjs [--family NAME] [--world NAME] [--seed INT] [--limit 1..1000]');
      const key = args[i++].slice(2), value = args[i];
      options[key] = key === 'seed' || key === 'limit' ? Number(value) : value;
    }
    const rows = generateQuestionCurriculum(options);
    const verification = await verifyQuestionGolds(rows);
    console.log(JSON.stringify({ inventory: questionInventory(), verification, rows }, null, 2));
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
