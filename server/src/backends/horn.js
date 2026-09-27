import {reason,closure} from '../reasoner.js';
import {runSWI} from '../solvers.js';
import {contains} from '../time.js';
import {stable,assert} from '../util.js';
export function solveHorn(q,memory,{backend='auto',assumptions=[],...limits}={}){
 if(backend==='auto')backend='js';assert(['js','prolog'].includes(backend),'Horn query requires JS or Prolog backend');
 if(backend==='js')return {...reason(q,memory,{assumptions,...limits}),backend:'js'};
 assert(q.at!==undefined,'The Prolog adapter implements point-in-time queries; use JS for interval answers');
 const input=[...memory.facts,...assumptions].filter(f=>contains(f.valid,q.at)),rules=memory.rules.filter(r=>contains(r.valid??{from:-Infinity,until:Infinity},q.at));
 let sw;try{sw=runSWI(input.map(f=>f.atom),rules,limits);}catch(e){return {status:'unsupported',backend:'prolog',code:'backend_unavailable',detail:e.message,complete:false};}
 const cl=closure(input,rules,limits);const set=xs=>[...new Set(xs.map(stable))].sort();const agree=stable(set(sw.atoms))===stable(set(cl.facts.map(f=>f.atom)));
 assert(agree||!sw.complete||!cl.complete,'Backend divergence on the portable Horn profile');
 const result=reason(q,{...memory,facts:input,rules,complete:memory.complete&&sw.complete&&cl.complete},limits);
 return {...result,backend:'prolog',proofBackend:'js-derivation-checked-against-prolog-closure',backendAgreement:agree};
}
