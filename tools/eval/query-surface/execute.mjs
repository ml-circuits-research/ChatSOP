#!/usr/bin/env node
/**
 * End-to-end execution check of the query forms (owner priority 2026-10-01, step 3): a message goes through SymbolicLM
 * (recorded parses, or a live parse when `--live`), the model program is linked by the hand-made lexicon of the case
 * (lower-model.mjs), and the resulting circuit runs on a knowledge base through js-reference, the oracle. The
 * packets are checked against the answer a person would expect. The knowledge texts are the smoke cases of
 * eval/smoke-reasoning/cases (read only) or small texts written here.
 *
 *   node tools/eval/query-surface/execute.mjs [--live] [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SymbolicLM} from '../../../lib/symbolic-lm/index.mjs';
import {ask, NotExpressibleError} from '../../../reasoning/strategies/js-reference/index.mjs';
import {validateProgram} from '../../../sop/knowledge/index.mjs';
import {CachedWorker} from './cached-worker.mjs';
import {lowerModelProgram} from './lower-model.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURE = path.join(ROOT, 'tests/fixtures/query-forms/execution-parses.json');
const smoke = name => fs.readFileSync(path.join(ROOT, 'eval/smoke-reasoning/cases', name, 'knowledge.sop'), 'utf8');
const rel = (predicate, ...roles) => ({predicate, roles});

const MEMBERS = `@member predicate
  args subject:entity object:entity
  closed true
@works predicate
  args subject:entity object:entity
@m1 fact
  holds member ann delta
@m2 fact
  holds member bob delta
@w1 fact
  holds works ann alpha
@w2 fact
  holds works bob alpha
`;
const COSTS = `@cost predicate
  args subject:entity object:int
@c1 fact
  holds cost cottage 35000
@c2 fact
  holds cost studio 9000
`;
const TEAMS = `@player_of predicate
  args subject:entity object:entity
  closed true
@certified predicate
  args subject:entity
  closed true
@p1 fact
  holds player_of ann rapid
@p2 fact
  holds player_of bob rapid
@p3 fact
  holds player_of cy united
@p4 fact
  holds player_of di united
@k1 fact
  holds certified ann
@k2 fact
  holds certified bob
@k3 fact
  holds certified cy
`;
const WORLD = `@is_a predicate
  args subject:entity object:entity
@description_en predicate
  args subject:entity object:text
@located_in predicate
  args subject:entity location:entity
@d1 fact
  holds description_en ada "English mathematician and writer"
@c1 fact
  holds is_a paris city
@c2 fact
  holds is_a ada human
@l1 fact
  holds located_in ana cluj
`;
const WORKS_NEG = `@works predicate
  args subject:entity object:entity
@w1 fact
  holds works ann alpha
@w2 fact
  holds not works cara alpha
`;

export const CASES = [
  {id: 'count', form: 'count', message: 'How many employees does Dev have?', knowledge: smoke('07a-count-query'), link: {relations: {'have': rel('employee_of', 'object', 'subject')}, entities: {Dev: 'dev'}}, expect: {status: 'supported', count: 3}},
  {id: 'every-true', form: 'quantified', message: 'Does everyone who is a member of Delta work at Alpha?', knowledge: MEMBERS, link: {relations: {'be a member of': rel('member', 'subject', 'object'), 'work at': rel('works', 'subject', 'object')}, entities: {Delta: 'delta', Alpha: 'alpha'}}, expect: {status: 'supported'}},
  {id: 'every-refuted', form: 'quantified', message: 'Does everyone who is a member of Delta work at Alpha?', knowledge: smoke('08b-every-refuted'), link: {relations: {'be a member of': rel('member', 'subject', 'object'), 'work at': rel('works', 'subject', 'object')}, entities: {Delta: 'delta', Alpha: 'alpha'}}, expect: {status: 'refuted'}},
  {id: 'some', form: 'quantified', message: 'Does any member of Delta work at Alpha?', knowledge: smoke('08c-some-exists'), link: {relations: {'be a member of': rel('member', 'subject', 'object'), 'work at': rel('works', 'subject', 'object')}, entities: {Delta: 'delta', Alpha: 'alpha'}}, expect: {status: 'supported'}},
  {id: 'only-group', form: 'quantified', message: 'Which teams have only certified players?', knowledge: TEAMS, link: {relations: {'be a player of': rel('player_of', 'subject', 'object'), 'be certified': rel('certified', 'subject')}, entities: {}}, expect: {status: 'supported', rows: [{g: 'rapid'}]}},
  {id: 'explain', form: 'why', message: 'Why is Ann a grandparent of Cy?', knowledge: smoke('13a-explain-proof'), link: {relations: {'be a grandparent of': rel('grandparent', 'subject', 'object')}, entities: {Ann: 'ann', Cy: 'cy'}}, expect: {status: 'supported', uses: ['parent ann bob', 'parent bob cy']}},
  {id: 'why-not', form: 'why_not', message: 'What is missing for Ann to be a grandparent of Cy?', knowledge: smoke('13b-why-not'), link: {relations: {'be a grandparent of': rel('grandparent', 'subject', 'object')}, entities: {Ann: 'ann', Cy: 'cy'}}, expect: {status: 'unknown', missing: [['parent bob cy']]}},
  {id: 'abduce', form: 'abduce', message: 'What might have caused the grass to be wet?', knowledge: smoke('14a-abduction'), link: {relations: {'be wet': rel('wet', 'subject')}, entities: {'the grass': 'grass'}}, expect: {status: 'hypotheses', hypotheses: [['rained grass'], ['sprinkler_on grass']]}},
  {id: 'plan', form: 'plan', message: 'How can the robot get to C?', knowledge: smoke('11a-plan-strips'), link: {relations: {'get to': rel('at', 'subject', 'destination')}, entities: {'the robot': 'robot', C: 'c'}}, expect: {status: 'plan_found', plan: {cost: 2, steps: 2}}},
  {id: 'what-if', form: 'what_if', message: 'If Ann worked at Alpha, who works at Alpha?', knowledge: smoke('14b-whatif-supposition'), link: {relations: {'work at': rel('works', 'subject', 'object')}, entities: {Ann: 'ann', Alpha: 'alpha'}}, expect: {status: 'supported', rows: [{x: 'ann'}, {x: 'bob'}], conditional: ['s1']}},
  {id: 'overlaps-2022', form: 'temporal', message: 'Where did Ann work at any point in 2022?', knowledge: smoke('12b-temporal-interval'), link: {relations: {'work in': rel('works_at', 'subject', 'location')}, entities: {Ann: 'ann'}}, expect: {status: 'supported', rows: [{place: 'alpha'}]}},
  {id: 'overlaps-2023', form: 'temporal', message: 'Where did Ann work at any point in 2023?', knowledge: smoke('12b-temporal-interval'), link: {relations: {'work in': rel('works_at', 'subject', 'location')}, entities: {Ann: 'ann'}}, expect: {status: 'supported', rows: [{place: 'beta'}]}},
  {id: 'compare', form: 'comparative', message: 'Does the cottage cost more than 30000 lei?', knowledge: COSTS, link: {relations: {cost: rel('cost', 'subject', 'object')}, entities: {'the cottage': 'cottage'}}, expect: {status: 'supported'}},
  {id: 'compare-no', form: 'comparative', message: 'Does the studio cost more than 30000 lei?', knowledge: COSTS, link: {relations: {cost: rel('cost', 'subject', 'object')}, entities: {'the studio': 'studio'}}, expect: {status: 'refuted'}},
  {id: 'negated-refuted', form: 'yes_no', message: 'Does Cara work at Alpha?', knowledge: WORKS_NEG, link: {relations: {'work at': rel('works', 'subject', 'object')}, entities: {Cara: 'cara', Alpha: 'alpha'}}, expect: {status: 'refuted'}},
  {id: 'negated-question', form: 'negated', message: "Doesn't Cara work at Alpha?", knowledge: WORKS_NEG, link: {relations: {'work at': rel('works', 'subject', 'object')}, entities: {Cara: 'cara', Alpha: 'alpha'}}, expect: {status: 'supported'}},
  {id: 'copula-identity', form: 'wh', message: 'Who is Ada Lovelace?', knowledge: WORLD, link: {relations: {be: rel('description_en', 'subject', 'object')}, entities: {'Ada Lovelace': 'ada'}}, expect: {status: 'supported', rows: [{x: 'English mathematician and writer'}]}},
  {id: 'copula-class', form: 'yes_no', message: 'Is Paris a city?', knowledge: WORLD, link: {relations: {'be a': rel('is_a', 'subject', 'object')}, entities: {Paris: 'paris', city: 'city'}}, expect: {status: 'supported'}},
  {id: 'copula-location', form: 'wh', message: 'Where is Ana?', knowledge: WORLD, link: {relations: {be: rel('located_in', 'subject', 'location')}, entities: {Ana: 'ana'}}, expect: {status: 'supported', rows: [{place: 'cluj'}]}},
  {id: 'conform', form: 'conform', message: 'Did we follow the reset procedure?', knowledge: smoke('37a-conform-trace-violation'), link: {relations: {follow: rel('followed', 'subject', 'object')}, entities: {we: 'we', 'the reset procedure': 'reset'}}, expect: {declined: 'not_expressible'}},
  {id: 'procedure', form: 'procedure', message: 'What is the reset procedure?', knowledge: smoke('11c-procedure-method'), link: {relations: {reset: rel('router_reset', 'object')}, entities: {}}, expect: {declined: 'not_expressible'}},
];

const rowsOf = rows => rows.map(r => JSON.stringify(Object.fromEntries(Object.entries(r).sort()))).sort();

/** Runs one case; returns {ok, detail}. */
async function runCase(lm, c) {
  const result = await lm.analyze(c.message, {route: 'direct', language: 'en'});
  const lowered = lowerModelProgram(result.sop, c.link);
  const out = {id: c.id, form: c.form, message: c.message, sop: result.sop, circuit: lowered.queries.map(q => q.text).join(''), unlinked: lowered.unlinked, assumed: lowered.assumed};
  if (lowered.unlinked.length || !lowered.queries.length) return {...out, ok: false, detail: 'not linked: ' + JSON.stringify(lowered.unlinked)};
  const query = lowered.facts.join('') + lowered.queries.map(q => q.text).join('');
  const check = validateProgram([{name: 'knowledge', role: 'knowledge', text: c.knowledge}, {name: 'query', role: 'query', text: query}]);
  out.validation = (check.problems ?? check ?? []).filter(x => x.severity !== 'warning').map(x => x.code).slice(0, 4);
  try {
    const packet = ask({theory: {knowledge: c.knowledge}, query});
    out.packet = {status: packet.status, rows: packet.rows, count: packet.count, conditional: packet.conditional, missing: packet.missing, hypotheses: packet.hypotheses, plan: packet.plan ? {cost: packet.plan.cost, steps: packet.plan.steps?.length ?? packet.plan.length} : null, explain: packet.explain};
    const e = c.expect, checks = [];
    checks.push(packet.status === e.status);
    if (e.count !== undefined) checks.push(packet.count === e.count);
    if (e.rows) checks.push(JSON.stringify(rowsOf(packet.rows ?? [])) === JSON.stringify(rowsOf(e.rows)));
    if (e.conditional) checks.push(JSON.stringify(packet.conditional ?? []) === JSON.stringify(e.conditional));
    if (e.missing) checks.push(JSON.stringify(packet.missing) === JSON.stringify(e.missing));
    if (e.hypotheses) checks.push(JSON.stringify((packet.hypotheses ?? []).map(h => h.atoms ?? h)) === JSON.stringify(e.hypotheses) || JSON.stringify(packet.hypotheses) === JSON.stringify(e.hypotheses));
    if (e.plan) checks.push(packet.plan?.cost === e.plan.cost);
    if (e.uses) checks.push(JSON.stringify(packet.explain?.uses ?? packet.explain?.used ?? []) === JSON.stringify(e.uses) || JSON.stringify(packet.explain?.uses?.slice().sort()) === JSON.stringify(e.uses.slice().sort()));
    const ok = checks.every(Boolean);
    return {...out, ok, ...(c.knownGap && !ok ? {knownGap: c.knownGap} : {}), detail: ok ? 'as expected' : (c.knownGap ? 'documented oracle gap: ' : 'packet differs: ') + JSON.stringify({status: packet.status, rows: packet.rows, count: packet.count, missing: packet.missing, hypotheses: packet.hypotheses})};
  } catch (error) {
    if (error instanceof NotExpressibleError && c.expect.declined === 'not_expressible') return {...out, ok: true, detail: 'the oracle declines honestly: ' + error.message.slice(0, 120)};
    return {...out, ok: false, detail: `${error.name}: ${String(error.message).slice(0, 200)}`};
  }
}

export async function executeAll({live = false} = {}) {
  const worker = new CachedWorker({own: FIXTURE, device: live ? 'auto' : 'cpu'});
  if (!live) worker.liveWorker = () => { throw Error('no recorded parse (re-run with --live to record)'); };
  const lm = new SymbolicLM({worker, lexicons: {has: () => false, perMillion: () => 0}});
  await lm.start();
  const results = [];
  try { for (const c of CASES) results.push(await runCase(lm, c)); } finally { await lm.stop(); }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const live = process.argv.includes('--live');
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const results = await executeAll({live});
  for (const r of results) console.log(`${r.ok ? 'PASS' : r.knownGap ? 'GAP ' : 'FAIL'} ${r.id} (${r.form}): ${r.message}\n     ${r.detail}${r.ok ? '' : '\n     circuit: ' + r.circuit.replace(/\n/g, ' | ')}`);
  console.log(`${results.filter(r => r.ok).length}/${results.length} as expected, ${results.filter(r => r.knownGap).length} documented oracle gap(s), ${results.filter(r => !r.ok && !r.knownGap).length} failing`);
  if (jsonOut) fs.writeFileSync(path.resolve(ROOT, jsonOut), JSON.stringify(results, null, 1) + '\n');
}
