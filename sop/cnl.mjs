import {emitAtom} from './parser.mjs';
import {emitCondition} from '../lib/conditions.mjs';
import {formatTime} from '../lib/time.mjs';
import {renderAnswer} from './answer-text.mjs';
const messages={
 en:{not_computable:'The question is understood, but the host cannot compute this answer from the values it has.',hypotheses:'Possible explanations; assumptions are not confirmed.',candidates:'Candidates for exploration, not proven facts.',patterns:'Candidate regularities measured on supplied cases.',mappings:'Candidate correspondences between structures; the transfer is not confirmed.',budget_exhausted:'The search was stopped by a limit (see the reason); this is not a negative answer.',not_expressible:'The problem cannot be expressed by the reasoning engine.',plan_found:'A plan was found in the action model; it has not been executed.',no_plan:'No plan was found in the explored finite state space.',optimal:'Optimal solution in the declared model and domains.',feasible_bound:'A feasible solution was found; optimality is unproven.',mixed_temporal:'The claim and its negation are supported in different, non-overlapping intervals.',supported:'The available evidence supports the claim.',refuted:'Explicit evidence supports the negated claim.',both:'Both the claim and its explicit negation have supporting evidence.',unknown:'The available information does not decide the question.',entailed:'The claim holds in every model of the constraints.',possible:'At least one model satisfies the claim.',impossible:'No model of the stated conditions satisfies the claim.',inconsistent:'The stated conditions are inconsistent; no arbitrary conclusion is accepted.',unsupported:'The available backend cannot execute this operation.',stored:'The assertions have been recorded.',incomplete:'Search is incomplete; more answers may exist.',hypothetical:'This result depends on the stated assumptions.'}
};
/** The English rendering of a result packet. Other answer languages are produced by translating this text at the output edge (lib/translator-service/answer.mjs, DS014 "English-only core"); `language` is accepted and ignored. */
export function cnl(packet,_language,{lexicon=null}={}){
 // A query result is written as a natural answer from the packet (sop/answer-text.mjs); the packet keeps the structured form.
 const natural=renderAnswer(packet,{lexicon});if(natural!==null)return {kind:'cnl',language:'en',text:natural,packet};
 const m=messages.en,lines=[];if(packet.hypothetical)lines.push(m.hypothetical);
 lines.push(packet.status==='clarify'?packet.text:(m[packet.status==='approximate'?(packet.patterns?'patterns':packet.mappings?'mappings':'candidates'):packet.status]??packet.status));
 if(packet.status==='budget_exhausted'&&packet.reason)lines.push('REASON '+packet.reason);
 if(packet.kind==='count'&&packet.count!==undefined)lines.push('Number of retrieved results: '+packet.count+'.');
 if(packet.at_least!==undefined)lines.push('At least '+packet.at_least+' results found; the exact number cannot be given from the retrieved memory.');
 if(packet.kind==='every'){lines.push('Known members checked: '+packet.members+'.');for(const b of (packet.counterexamples??[]).slice(0,5))lines.push('COUNTEREXAMPLE '+Object.entries(b).map(([k,v])=>k+' = '+JSON.stringify(v)).join('; '));if(packet.undecided?.length)lines.push('UNDECIDED '+packet.undecided.length);}
 if(packet.explanation)lines.push('EXPLANATION '+packet.explanation.kind.toUpperCase());
 for(const row of packet.answers??[]){if(packet.kind==='explain'&&!Object.keys(row.binding).length)continue;lines.push('ANSWER '+Object.entries(row.binding).map(([k,v])=>k+' = '+JSON.stringify(v)).join('; '));if(packet.query?.during&&row.valid)lines.push('VALID ['+formatTime(row.valid.from)+', '+formatTime(row.valid.until)+')');}
 for(const [name,item]of Object.entries(packet.outputProjection??{}))if(item.status==='bound')lines.push('VALUE '+name+' = '+JSON.stringify(item.value));
 for(const p of packet.proof??[])lines.push('EVIDENCE '+p.id+': '+emitAtom(p.atom)+(packet.query?.during&&p.valid?' VALID ['+formatTime(p.valid.from)+', '+formatTime(p.valid.until)+')':'')+(p.kind==='derived'?' VIA '+p.rule+' FROM '+p.from.join(', '):' SOURCE '+p.source));
 if(packet.objective!==undefined)lines.push('OBJECTIVE '+packet.direction+' = '+packet.objective);
 for(const h of (packet.explanations??[]).slice(0,5))lines.push('HYPOTHESIS '+h.hypotheses.join('+')+' COST '+h.cost+': '+h.atoms.join(' AND '));
 if(packet.next_test)lines.push('SUGGESTED_TEST '+packet.next_test.query.where.map(c=>emitCondition(c,emitAtom)).join(' AND ')+'; NOT_EXECUTED');
 for(const p of (packet.patterns??[]).slice(0,5))lines.push('PATTERN '+p.id+': '+p.if.map(emitAtom).join(' AND ')+' -> '+emitAtom(p.then)+'; SUPPORT '+p.training.supportCount+'/'+p.training.opportunities+'; COUNTEREXAMPLES '+p.training.counterexamples+'; UNKNOWN '+p.training.unknown+'; NOT_A_RULE');
 for(const c of (packet.candidates??[]).slice(0,5))lines.push('CANDIDATE '+c.id+' SCORE '+c.score+'; NOT_PROBABILITY');
 for(const a of (packet.mappings??[]).slice(0,5))lines.push('ANALOGY '+JSON.stringify(a.mapping)+' MATCHED '+a.matched+'/'+a.sourceEdges+'; CANDIDATE_TRANSFER');
 if(packet.plan){lines.push('PLAN COST '+packet.plan.cost+'; '+(packet.guarantee==='exact'?'OPTIMAL_WITHIN_MODEL':'OPTIMALITY_NOT_ESTABLISHED'));packet.plan.sequence.forEach((step,i)=>lines.push('STEP '+(i+1)+' '+step.action+' '+JSON.stringify(step.binding)));}
 for(const a of packet.whatif?.intervention??[])lines.push('INTERVENTION '+a+'; NOT_STORED');
 if(packet.route)lines.push('ENGINE '+packet.reasoningStrategy+' / '+packet.route.backend+(packet.route.fallback?' / '+packet.route.fallback:''));
 if(packet.complete===false&&packet.status!=='incomplete')lines.push(m.incomplete);
 return {kind:'cnl',language:'en',text:lines.filter(Boolean).join('\n'),packet};
}
