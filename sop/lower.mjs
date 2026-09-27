/** Parse -> validate -> typed objects. Only these objects reach solvers. */
import {one,many,parseAtom,scalar,words,unquote} from './parser.mjs';
import {parseExpression,evaluateExpression} from './expression.mjs';
import {atom,rule,variable,inferVariableTypes} from '../lib/types.mjs';
import {interval,instant} from '../lib/time.mjs';
import {assert} from '../lib/util.mjs';
import {parseCondition,parseBooleanCondition} from './conditions.mjs';
import {conditionAtoms,definitelyBound} from '../lib/conditions.mjs';
export function resolveAtom(text,values={},schema=null,{ground=false}={}){const a=parseAtom(text);a.a=a.a.map(v=>v&&typeof v==='object'&&v.ref?scalar('$'+v.ref,values):v);return atom(a,{ground,schema});}
export function lowerFact(w,values={},schema=null){return {kind:'fact',atom:resolveAtom(one(w,'holds'),values,schema,{ground:true}),valid:interval(one(w,'valid')),source:unquote(one(w,'source','user')),quote:unquote(one(w,'quote','')),retention:one(w,'retention','normal')};}
export function lowerPremise(w,values={},schema=null){return {kind:'premise',atom:resolveAtom(one(w,'holds'),values,schema,{ground:true}),valid:interval(one(w,'valid','timeless')),source:'model-interpretation',origin:'model-interpretation'};}
export function lowerRule(w,values={},schema=null){const r=rule({id:w.id,if:many(w,'when').map(x=>resolveAtom(x,values,schema)),then:resolveAtom(one(w,'then'),values,schema)},schema);return {...r,kind:'rule',mode:one(w,'mode','logical'),source:unquote(one(w,'source','approved-library')),valid:interval(one(w,'valid','timeless'))};}
export function lowerQuery(w,values={},schema=null,{now=Date.now()}={}){
 const where=many(w,'where').map(s=>parseCondition(s,leaf=>resolveAtom(leaf,values,schema)));const selected=words(one(w,'select',''));assert(selected.every(variable),'select contains only ?variables');
 const kind=one(w,'mode',selected.length?'select':'exists');assert(['select','exists','count','explain'].includes(kind),'Invalid query mode');if(kind==='select')assert(selected.length>0,'select mode needs variables');
 const bound=definitelyBound(where);assert(selected.every(v=>bound.has(v)),'Unbound selected variable: every alternative must bind selected variables');
 const filters=many(w,'filter').map(parseBooleanCondition);const varsIn=n=>{if(!n||typeof n!=='object')return [];return [...(n.type==='var'?[n.value]:[]),...Object.values(n).flatMap(v=>Array.isArray(v)?v.flatMap(varsIn):varsIn(v))];};for(const f of filters)assert(varsIn(f).every(v=>bound.has(v)),'Unbound filter variable');
 const limit=Number(one(w,'limit','100'));assert(Number.isSafeInteger(limit)&&limit>=1&&limit<=10000,'Invalid result limit');
 const time=w.fields.during?{during:interval(one(w,'during'))}:{at:one(w,'at')?instant(scalar(one(w,'at'),values)):now};
 const asof=one(w,'asof')?instant(scalar(one(w,'asof'),values)):now;
 return {kind:'query',variableTypes:inferVariableTypes(conditionAtoms(where),schema),mode:kind,where,select:selected,filters,limit,...time,asof};
}
function numericAST(n,vars,values,type){
 if(n.type==='ref')return numericAST({type:'literal',value:values[n.value]},vars,values,type);
 if(n.type==='literal'){assert(type==='Int'&&Number.isSafeInteger(n.value),'Integer expression expected');return n.value;}
 if(n.type==='var'){assert(type==='Int'&&Object.hasOwn(vars,n.value.slice(1)),'Undeclared variable '+n.value);return n.value.slice(1);}
 if(n.type==='unary'){if(n.op==='-')return {op:'sub',a:[0,numericAST(n.arg,vars,values,'Int')]};assert(type==='Bool'&&n.op==='!','Unsupported unary constraint');return {op:'not',a:[numericAST(n.arg,vars,values,'Bool')]};}
 assert(n.type==='binary','Constraints support integer linear arithmetic and Boolean combinations');
 const map={'+':['add','Int','Int'],'-':['sub','Int','Int'],'*':['mul','Int','Int'],'===':['eq','Int','Bool'],'==':['eq','Int','Bool'],'!==':['ne','Int','Bool'],'!=':['ne','Int','Bool'],'<':['lt','Int','Bool'],'<=':['le','Int','Bool'],'>':['gt','Int','Bool'],'>=':['ge','Int','Bool'],'&&':['and','Bool','Bool'],'||':['or','Bool','Bool']};
 const spec=map[n.op];assert(spec&&spec[2]===type,'Unsupported constraint operator/type '+n.op);const a=[numericAST(n.left,vars,values,spec[1]),numericAST(n.right,vars,values,spec[1])];if(spec[0]==='mul')assert(a.some(Number.isSafeInteger),'Only constant multiplication is in the portable constraint profile');return {op:spec[0],a};
}
export function lowerConstraint(w,values={}){
 const vars={};for(const l of many(w,'var')){const p=words(l);assert((p.length===2||p.length===4)&&/^\?[a-z][a-z0-9_]*$/.test(p[0])&&p[1]==='int','var ?name int [min max]');const name=p[0].slice(1);assert(!Object.hasOwn(vars,name),'Duplicate constraint variable');vars[name]={sort:'Int'};if(p.length===4){const min=Number(scalar(p[2],values)),max=Number(scalar(p[3],values));assert(Number.isSafeInteger(min)&&Number.isSafeInteger(max)&&min<=max,'Invalid finite domain');Object.assign(vars[name],{min,max});}}
 const selected=words(one(w,'select',''));assert(selected.every(v=>variable(v)&&Object.hasOwn(vars,v.slice(1)))&&new Set(selected).size===selected.length,'select needs distinct declared constraint variables');
 const convert=s=>numericAST(parseBooleanCondition(s),vars,values,'Bool');const task=one(w,'task','prove');assert(['prove','possible','optimize'].includes(task),'constraint task must be prove, possible or optimize');
 const objective=w.fields.objective?numericAST(parseExpression(one(w,'objective')),vars,values,'Int'):undefined;const direction=one(w,'direction','min');assert(['min','max'].includes(direction),'objective direction must be min or max');assert(task!=='optimize'||objective!==undefined,'optimize needs objective');assert(task==='optimize'||objective===undefined,'objective requires task optimize');
 return {kind:'constraint',vars,...(selected.length?{select:selected}:{}),...(objective===undefined?{}:{objective,direction}),constraints:many(w,'require').map(convert),claim:convert(one(w,'claim')),task,unit:one(w,'unit','scalar')};
}
