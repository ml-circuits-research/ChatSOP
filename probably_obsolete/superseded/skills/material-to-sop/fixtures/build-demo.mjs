#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const required = value => { if (!value) throw Error('Usage: node build-demo.mjs /absolute/workspace /absolute/output-directory'); return path.resolve(value); };
const fixture = fileURLToPath(import.meta.url);
export function buildDemo(workspace, outputDirectory) {
  const root = required(workspace), out = required(outputDirectory);
  const sourceDir = path.join(root, 'datasets/knowledge/source');
  const records = Object.fromEntries(['cold_chain', 'visitor_access', 'receiving_desk'].map(id => [id, JSON.parse(fs.readFileSync(path.join(sourceDir, `${id}.json`), 'utf8'))]));
  const citation = (id, quote) => {
    const record = records[id];
    const passage = record.passages.find(item => item.text.includes(quote));
    if (!passage) throw Error(`Quoted span missing from ${id}: ${quote}`);
    return {sourceId: id, sourceSha256: record.rawSha256, passage: {page: passage.page, paragraph: passage.paragraph, offset: passage.offset}, quoteOffset: passage.offset + Buffer.byteLength(passage.text.slice(0, passage.text.indexOf(quote))), quote};
  };
  const query = (predicate, entity) => `@q query\n  where ${predicate} ${entity}\n@m recall\n  query $q\n@answer reason\n  query $q\n  memory $m`;
  const fact = (id, predicate, entity) => `@${id} fact\n  holds ${predicate} ${entity}\n  valid timeless`;
  const setup = (entity, seal) => [fact(`box_${entity}`, 'sealed_vaccine_box', entity), fact(`log_${entity}`, 'complete_log', entity), ...(seal ? [fact(`seal_${entity}`, seal, entity)] : [])].join('\n');
  const makeCase = (role, question, rationale, sourceId, quote, setupSop, querySop, expectedStatus) => ({role, question, rationale, citation: citation(sourceId, quote), setupSop, querySop, expectedStatus});
  const candidate = {
    id: 'sealed_transfer_cross_source',
    scope: 'Hypothetical sealed vaccine boxes with independently established complete logs and intact seals in these synthetic transfer desks; eligibility, not an actual action',
    limits: 'No eligibility conclusion for broken/unknown seals, missing logs, visitor access, other products or real-world transfer authorization; second source is a synthetic example, not independent field validation',
    rationale: 'The cold-chain note states eligibility under the conjunction; the separate receiving-desk checklist independently states the same scoped implication. Neither authorizes publication.',
    sop: '@eligible rule\n  when sealed_vaccine_box ?x\n  when complete_log ?x\n  when seal_intact ?x\n  then routine_transfer_eligible ?x\n  mode logical',
    cases: [
      makeCase('positive', 'Would a sealed box with a complete log and intact seal be eligible?', 'All necessary source conditions are explicitly supplied as hypothetical probe facts.', 'cold_chain', 'A sealed vaccine box with a complete temperature log and intact seal is eligible for routine transfer.', setup('box_a', 'seal_intact'), query('routine_transfer_eligible', 'box_a'), 'supported'),
      makeCase('negative', 'Does a box with a broken seal become eligible from its complete log?', 'Broken seal is not evidence of an intact seal; abstain on eligibility.', 'cold_chain', 'A box with a broken seal must be held for inspection, even if its temperature log is complete.', setup('box_b', 'seal_broken'), query('routine_transfer_eligible', 'box_b'), 'unknown'),
      makeCase('boundary', 'Is eligibility known if the seal observation is absent?', 'Unknown seal is not intact seal; keep the open-world limit.', 'receiving_desk', 'The checklist does not state whether a box with an unknown seal is eligible.', setup('box_c', null), query('routine_transfer_eligible', 'box_c'), 'unknown'),
      makeCase('nontrigger', 'May visitor_a enter the archive from a badge alone?', 'Visitor access is not a trigger for the vaccine-box rule; necessary badge and escort conditions are not a sufficient access grant.', 'visitor_access', 'A visitor may enter the archive only if the visitor has an active badge and an escort is present.', fact('badge_visitor', 'active_badge', 'visitor_a'), query('archive_entry', 'visitor_a'), 'unknown'),
      makeCase('transfer', 'Would a second desk consider an independently observed intact sealed box eligible?', 'Reuse the same rule for a different source and ground box, without claiming field generality.', 'receiving_desk', 'For a sealed vaccine box, a complete temperature log and an intact seal together establish routine transfer eligibility at this desk.', setup('box_t', 'seal_intact'), query('routine_transfer_eligible', 'box_t'), 'supported')
    ]
  };
  const rejected = {...candidate, id: 'missing_second_source', cases: candidate.cases.filter(c => c.role !== 'transfer')};
  const questions = [{id: 'transfer', question: 'Locate an explicit transfer rule quotation', needle: 'routine transfer', sourceId: 'cold_chain'}];
  const budget = {maxProbes: 100, maxBytes: 100000, maxMs: 3000};
  const modes = {
    focused: {mode: 'focused', questions, budget},
    broad: {mode: 'broad-bounded', questions, budget},
    adaptive: {mode: 'adaptive', questions: [{id: 'transfer_elsewhere', question: 'Find transfer language beyond the visitor desk', needle: 'routine transfer eligibility', sourceId: 'visitor_access'}], budget},
    exhaustive: {mode: 'near-exhaustive', questions, budget},
    incomplete: {mode: 'near-exhaustive', questions, budget: {...budget, maxProbes: 1}}
  };
  fs.mkdirSync(out, {recursive: true});
  const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
  write('candidate.json', candidate);
  write('rejected.json', rejected);
  for (const [mode, input] of Object.entries(modes)) write(`${mode}.json`, input);
  return {candidate: path.join(out, 'candidate.json'), rejected: path.join(out, 'rejected.json'), modes: Object.keys(modes)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fixture) console.log(JSON.stringify(buildDemo(process.argv[2], process.argv[3]), null, 2));
