/** Internal AST helpers. SOP is the only authored knowledge/command syntax. */
import {assert,stable} from './util.mjs';
export {variable} from './util.mjs';
import {variable} from './util.mjs';
export function atom(x,{ground=false,schema=null}={}){
 assert(x&&/^[a-z][a-z0-9_]{0,47}$/.test(x.p),'Invalid predicate');assert(Array.isArray(x.a)&&x.a.length>=1&&x.a.length<=4,'Arity must be 1..4');
 assert(x.a.every(v=>Number.isSafeInteger(v)||typeof v==='string'&&v.length>0&&v.length<=256),'Terms must be strings or safe integers');
 assert(x.a.every(v=>typeof v!=='string'||!v.startsWith('?')||variable(v)),'Invalid logic variable');assert(!ground||x.a.every(v=>!variable(v)),'Ground fact required');
 if(schema){assert(Object.hasOwn(schema,x.p),'Unknown predicate '+x.p);assert(schema[x.p].arity===x.a.length,'Wrong arity for '+x.p);for(let i=0;i<x.a.length;i++){const t=schema[x.p].args?.[i];if(variable(x.a[i]))continue;if(t==='integer')assert(Number.isSafeInteger(x.a[i]),'Integer expected');else if(t&&t!=='value')assert(typeof x.a[i]==='string','Symbol expected');}}
 return {p:x.p,a:[...x.a],neg:x.neg===true};
}
export const atomKey=a=>stable(atom(a));
export function rule(x,schema=null){assert(x&&/^[A-Za-z][A-Za-z0-9_]{0,100}$/.test(x.id),'Invalid rule ID');assert(Array.isArray(x.if)&&x.if.length>0&&x.if.length<=16,'Rule needs 1..16 premises');const body=x.if.map(a=>atom(a,{schema})),head=atom(x.then,{schema});const bound=new Set(body.flatMap(a=>a.a.filter(variable)));assert(head.a.filter(variable).every(v=>bound.has(v)),'Unsafe head variable');inferVariableTypes([...body,head],schema);return {id:x.id,if:body,then:head};}

/** Types used to link local logical variables across predicate occurrences. */
export function inferVariableTypes(atoms,schema=null){
 const types={};if(!schema)return types;
 for(const a of atoms)for(let i=0;i<a.a.length;i++){const name=a.a[i];if(!variable(name))continue;
  const next=schema[a.p]?.args?.[i]??'value',old=types[name];
  if(!old||old==='value'){types[name]=next;continue;}if(next==='value'||next===old)continue;
  if(old==='entity'&&next!=='integer'){types[name]=next;continue;}if(next==='entity'&&old!=='integer')continue;
  assert(false,'Incompatible types for '+name+': '+old+' and '+next);
 }return types;
}
