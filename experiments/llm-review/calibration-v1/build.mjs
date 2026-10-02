#!/usr/bin/env node
/**
 * Builds the reviewer calibration set v1 (lib/llm-review): 20 known-good items and 10 with planted errors (wrong number, dropped
 * condition, hedge turned certain, wrong relation or direction). Knowledge items come from the zai/glm-5.3 ingestions (not the
 * openference material under review), circuits from the Qwen3.8 27b query-parser run plus three written here. Every good item was
 * checked by hand against its source. Ids are neutral and the order is shuffled with a fixed seed; the truth file is separate.
 *
 *   node tools/eval/review/collect.mjs ingestion --model glm-5.3 > /tmp/glm.jsonl
 *   node experiments/llm-review/calibration-v1/build.mjs /tmp/glm.jsonl eval/reports/current/query-parsers/forms-llmapiprovider_Qwen3.8_27b-cs-with.jsonl eval/reports/current/query-parsers/forms-llmapiprovider_Qwen3.8_27b-cs-without.jsonl
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [glmFile, withFile, withoutFile] = process.argv.slice(2);
const rows = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const glm = new Map();
for (const r of rows(glmFile)) if (!glm.has(r.id)) glm.set(r.id, r);
const qp = new Map();
for (const [tag, f] of [['with', withFile], ['without', withoutFile]]) for (const r of rows(f)) qp.set(`${tag}/${r.id}`, r);

const k = (id, edit = null) => {
  const r = glm.get(id);
  if (!r) throw new Error('missing ' + id);
  const work = edit ? edit(r.work) : r.work;
  if (edit && work === r.work) throw new Error('edit did not change ' + id);
  return {material: r.material, work, context_id: r.context_id, context: r.context, meta: {vocabulary: r.meta.vocabulary}};
};
const q = (id, edit = null) => {
  const r = qp.get(id);
  const work = edit ? edit(r.model_sop) : r.model_sop;
  if (edit && work === r.model_sop) throw new Error('edit did not change ' + id);
  return {material: r.question, work};
};
const own = (material, work) => ({material, work});

const good = [
  k('europa-facts-md-03/d1c3_f6'), k('europa-facts-md-03/d1c3_f8'), k('europa-facts-md-03/d1c3_f13'), k('europa-facts-md-03/d1c3_f22'),
  k('europa-facts-md-03/d1c3_f27'), k('europa-facts-md-04/d1c4_f2'), k('europa-facts-md-04/d1c4_f14'), k('europa-facts-md-04/d1c4_f42'),
  k('europa-facts-md-04/d1c4_f44'), k('brindlewood-handbook-md-01/d1c1_r_logistics_remote'), k('brindlewood-handbook-md-01/d1c1_r_leave_pt_12'),
  k('brindlewood-handbook-md-02/d1c2_r_trip_over5_approval'),
  q('with/cs02'), q('with/cs08'), q('with/cs15'), q('with/cs22'), q('with/cs24'), q('with/cs26'), q('with/cs30'), q('without/cs20'),
];
const planted = [
  [k('europa-facts-md-04/d1c4_f43', w => w.replace('europa 60', 'europa 40')), 'wrong number (miles value under a _km predicate)'],
  [k('europa-facts-md-04/d1c4_f10', w => w.replace('\n  status hedged', '')), 'hedge turned certain ("likely formed")'],
  [k('europa-facts-md-04/d1c4_f21', w => w.replace('less_dense_than earth venus', 'less_dense_than venus earth')), 'wrong relation direction'],
  [k('europa-facts-md-03/d1c3_f19', w => w.replace('\n  status reported\n  speaker "Astrobiologists"', '')), 'reported belief turned certain'],
  [k('brindlewood-handbook-md-01/d1c1_r_os_remote_ft', w => w.replace('\n  when full_time_employee ?p', '')), 'dropped condition (full-time)'],
  [k('brindlewood-handbook-md-02/d1c2_r_item_over_limit', w => w.replace('compare ?a above ?max', 'compare ?a above 250').replace(/\n  when expense_item_max btc \?max/, '')), 'wrong number (250 instead of the 200-credit limit)'],
  [q('with/cs25', w => w.replace(/\n    match\n      relation "located_in"[\s\S]*?\n    end/, '')), 'dropped condition (in Africa)'],
  [q('with/cs21', w => w.replace('role subject "karl_marx"\n    role object "charles_darwin"', 'role subject "charles_darwin"\n    role object "karl_marx"')), 'wrong direction'],
  [own('Which employees work more than 35 hours per week?', '@q query\n  select ?p\n  where match\n    relation "contract_hours"\n    role subject ?p\n    role object ?h\n    polarity affirmed\n  end\n  compare ?h above 30'), 'wrong number (30 instead of 35)'],
  [own('Tom probably lives in Paris. Does Tom live in France?', '@s1 stated\n  relation "lives_in"\n  role subject "Tom"\n  role location "Paris"\n  polarity affirmed\n  certainty asserted\n@q query\n  where match\n    relation "lives_in"\n    role subject "Tom"\n    role location "France"\n    polarity affirmed\n  end'), 'hedge turned certain ("probably")'],
];

// Fixed-seed shuffle (mulberry32) so the planted items are not grouped.
let seed = 20261002;
const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const all = [...good.map(x => ({x, bad: false, error: null})), ...planted.map(([x, error]) => ({x, bad: true, error}))];
for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
const kindOf = a => (a.x.context ? 'knowledge-wires' : 'query-circuits');
const n = {'knowledge-wires': 0, 'query-circuits': 0};
const out = {'knowledge-wires': [], 'query-circuits': []};
const truth = [];
for (const a of all) {
  const kind = kindOf(a);
  const id = `${kind[0]}${String(++n[kind]).padStart(2, '0')}`;
  out[kind].push({id, ...a.x});
  truth.push({id, kind, bad: a.bad, error: a.error});
}
for (const [kind, list] of Object.entries(out)) writeFileSync(join(HERE, `${kind}.jsonl`), list.map(r => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(join(HERE, 'truth.jsonl'), truth.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`good ${good.length}, planted ${planted.length}:`, Object.fromEntries(Object.entries(out).map(([k2, v]) => [k2, v.length])));
