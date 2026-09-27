import {spawnSync} from 'node:child_process';
import {compileSMT} from '../solvers.mjs';
import {assert} from '../../lib/util.mjs';
function expr(n,env){if(Number.isSafeInteger(n))return n;if(typeof n==='string'){assert(Object.hasOwn(env,n),'Missing constraint variable');return env[n];}const a=n.a.map(x=>expr(x,env));let out;switch(n.op){case 'add':out=a[0]+a[1];break;case 'sub':out=a[0]-a[1];break;case 'mul':out=a[0]*a[1];break;case 'eq':return a[0]===a[1];case 'ne':return a[0]!==a[1];case 'lt':return a[0]<a[1];case 'le':return a[0]<=a[1];case 'gt':return a[0]>a[1];case 'ge':return a[0]>=a[1];case 'and':return a.every(Boolean);case 'or':return a.some(Boolean);case 'not':return !a[0];default:throw Error('Unknown constraint operator');}assert(Number.isSafeInteger(out),'JS integer overflow; use Z3');return out;}
export function enumerate(problem,{maxAssignments=100000,project=[]}={}){
 const names=Object.keys(problem.vars);let total=1;for(const n of names){const v=problem.vars[n];assert(Number.isSafeInteger(v.min)&&Number.isSafeInteger(v.max),'JS constraints require finite integer domains');total*=v.max-v.min+1;}
 let seen=0,base=0,yes=0,no=0,witness=null,counterexample=null;const env={}, projected=Object.fromEntries(project.filter(p=>p.mode!=='rows').map(p=>[p.name,new Set()])), allRows=[];
 function visit(i){if(seen>=maxAssignments)return;if(i<names.length){const name=names[i],v=problem.vars[name];for(let n=v.min;n<=v.max&&seen<maxAssignments;n++){env[name]=n;visit(i+1);}return;}seen++;if(!problem.constraints.every(c=>expr(c,env)))return;base++;for(const [n,values]of Object.entries(projected))values.add(env[n]);if(project.some(p=>p.mode==='rows'))allRows.push({...env});if(expr(problem.claim,env)){yes++;witness??={...env};}else{no++;counterexample??={...env};}}
 visit(0);const complete=seen>=total;let status;
 if(!base&&complete)status='inconsistent';else if(problem.task==='possible')status=yes?'possible':complete?'impossible':'unknown';else status=yes&&no?'unknown':!complete?'unknown':yes?'entailed':no?'refuted':'unknown';
 const outputProjection=Object.fromEntries(project.map(p=>{const values=[...(projected[p.name]??[])];const item=!complete?{status:'incomplete'}:!base?{status:'inconsistent'}:p.mode==='rows'?{status:'bound',value:allRows}:p.mode==='many'?{status:'bound',value:values}:values.length===1?{status:'bound',value:values[0]}:{status:'ambiguous',candidates:values.length};return ['?'+p.name,item];}));
 return {status,kind:'constraint',task:problem.task,backend:'js',complete,witness,counterexample,outputProjection,checks:{assignments:seen,total,baseModels:base,claimModels:yes,negatedClaimModels:no},unit:problem.unit,assurance:'Relative to the declared domains and admitted constraints.'};
}
function runZ3(source,timeoutMs){const r=spawnSync(process.env.Z3_BIN??'z3',['-in','-smt2'],{input:source,encoding:'utf8',timeout:timeoutMs+1000,maxBuffer:1048576});if(r.error)return {status:'unavailable',error:r.error.message};if(r.status!==0)return {status:'error',error:r.stderr||r.stdout};const status=r.stdout.split(/\s+/).find(x=>['sat','unsat','unknown'].includes(x));return {status:status??'error',output:r.stdout};}
export function z3(problem,{timeoutMs=3000,project=[]}={}){const {prefix,claim}=compileSMT(problem,{timeoutMs});const check=extra=>runZ3(prefix+extra+'\n(check-sat)\n',timeoutMs);const base=check('');if(['unavailable','error'].includes(base.status))return {status:'unsupported',code:'backend_unavailable',backend:'z3',detail:base.error,complete:false};if(base.status==='unsat')return {status:'inconsistent',backend:'z3',complete:true,checks:{base:'unsat'}};if(base.status!=='sat')return {status:'unknown',backend:'z3',complete:false,checks:{base:base.status}};
 const yes=check(`(assert ${claim})`),no=check(`(assert (not ${claim}))`);let status=problem.task==='possible'?(yes.status==='sat'?'possible':yes.status==='unsat'?'impossible':'unknown'):(no.status==='unsat'?'entailed':yes.status==='unsat'?'refuted':'unknown');
 const outputProjection={};
 for(const p of project){
  if(p.mode!=='one'){outputProjection['?'+p.name]={status:'unsupported_projection'};continue;}
  // A model is just one possible assignment. Export a scalar only when base
  // premises entail this same value (a second solver call checks uniqueness).
  assert(Object.hasOwn(problem.vars,p.name),'Unknown projected variable');
  const model=runZ3(prefix+'\n(check-sat)\n(get-value ('+p.name+'))\n',timeoutMs);
  const name=p.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=(model.output??'').match(new RegExp('\\('+name+'\\s+(-?\\d+|\\(-\\s+\\d+\\))\\)'));
  if(!match){outputProjection['?'+p.name]={status:'incomplete'};continue;}
  const value=match[1].startsWith('(')?-Number(match[1].replace(/[^0-9]/g,'')):Number(match[1]);
  if(!Number.isSafeInteger(value)){outputProjection['?'+p.name]={status:'unsupported_projection'};continue;}
  const term=value<0?'(- '+(-value)+')':String(value);
  const different=check('(assert (not (= '+p.name+' '+term+')))');
  outputProjection['?'+p.name]=different.status==='unsat'?{status:'bound',value}:different.status==='sat'?{status:'ambiguous'}:{status:'incomplete'};
 }
 return {status,kind:'constraint',task:problem.task,backend:'z3',complete:[yes.status,no.status].every(x=>['sat','unsat'].includes(x)),unit:problem.unit,outputProjection,checks:{base:base.status,withClaim:yes.status,withNegatedClaim:no.status},assurance:'Logical result relative to the declared constraints; satisfiable does not mean entailed.'};
}
export function solveConstraint(problem,{backend='auto',...options}={}){compileSMT(problem,options);if(backend==='auto'){const product=Object.values(problem.vars).reduce((n,v)=>Number.isSafeInteger(v.min)&&Number.isSafeInteger(v.max)?n*(v.max-v.min+1):Infinity,1);backend=product<=(options.maxAssignments??100000)?'js':'z3';}assert(['js','z3'].includes(backend),'Constraint problem cannot be dispatched to this backend');return backend==='js'?enumerate(problem,options):z3(problem,options);}
export {compileSMT};
