/** Observable execution signature for finite-fixture evaluation.
 * This is not a proof of program equivalence. Future names can differ for scalar
 * outputs; row-field names remain part of the structured output contract.
 */
import {stable} from '../lib/util.mjs';
import {atomKey} from '../lib/types.mjs';
export function executionSignature(result,session) {
  const packet=result.result?.packet??result.result;
  const outputs=Object.values(result.outputs??{}).map(o=>({mode:o.mode,status:o.status,
    complete:o.complete,valueType:o.valueType,...(o.status==='bound'?{value:o.value}:{})}));
  outputs.sort((a,b)=>stable(a).localeCompare(stable(b)));
  return stable({status:packet.status,
    answers:packet.answers?.map(r=>[(packet.query?.select??Object.keys(r.binding)).map(k=>r.binding[k]),packet.query?.during?r.valid:null]).sort((a,b)=>stable(a).localeCompare(stable(b))),
    count:packet.count,
    counterexamples:packet.counterexamples?.map(b=>stable(b)).sort(),
    explanation:packet.explanation?{kind:packet.explanation.kind,steps:packet.explanation.steps.map(step=>atomKey(step.atom)).sort()}:undefined,
    guarantee:packet.guarantee,
    objective:packet.objective,direction:packet.direction,optimal:packet.optimal,
    explanations:packet.explanations?.map(h=>({hypotheses:h.hypotheses,atoms:h.atoms,cost:h.cost})),
    tests:packet.tests?.map(t=>({where:t.query?.where,separated_pairs:t.separated_pairs,predictions:t.predictions})),
    next_test:packet.next_test?.query?.where,
    plan:packet.plan&&{cost:packet.plan.cost,steps:packet.plan.sequence?.map(s=>({action:s.action,binding:s.binding,adds:s.adds,removes:s.removes}))},
    patterns:packet.patterns?.map(p=>({if:p.if,then:p.then,status:p.status,training:p.training,holdout:p.holdout})),
    cases:packet.candidates?.map(c=>({id:c.id,score:c.score})),
    mappings:packet.mappings?.map(m=>({mapping:m.mapping,proposed:m.proposed})),
    whatif:packet.whatif,
hypothetical:!!packet.hypothetical,complete:packet.complete,outputs,
    claims:Object.values(session.live.claims).map(c=>[c.tupleHash,c.valid,c.retention,c.source,c.quote]).sort(),
    events:session.live.events.map(e=>[e.action,e.target,e.effective]).sort(),
    contextStatements:(result.contextStatements??[]).map(s=>[atomKey(s.atom),s.valid,s.origin]).sort((a,b)=>stable(a).localeCompare(stable(b)))});
}
