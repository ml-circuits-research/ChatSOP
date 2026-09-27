/** Small, interpreted expression language with JavaScript spelling.
 * There is no eval(), Function(), vm context, dynamic import, or host-object call.
 * Every operation is dispatched below and charged to a finite budget.
 */
import {assert} from '../lib/util.mjs';
const bad=new Set(['__proto__','prototype','constructor','caller','callee','arguments']);
const infix={'??':1,'||':2,'&&':3,'===':4,'!==':4,'==':4,'!=':4,'<':5,'<=':5,'>':5,'>=':5,'+':6,'-':6,'*':7,'/':7,'%':7};
export function tokenize(source){
 assert(typeof source==='string'&&source.length<=16384,'Expression length limit');
 const out=[];let i=0;
 while(i<source.length){const c=source[i];if(/\s/.test(c)){i++;continue;}
  if(c==='"'){let j=i+1,escape=false;for(;j<source.length;j++){if(!escape&&source[j]==='"')break;if(!escape&&source[j]==='\\')escape=true;else escape=false;}assert(j<source.length,'Unterminated string');out.push({kind:'literal',value:JSON.parse(source.slice(i,j+1))});i=j+1;continue;}
  const s=source.slice(i);let m;
  if((m=s.match(/^\$([A-Za-z][A-Za-z0-9_]*)/))){out.push({kind:'ref',value:m[1]});i+=m[0].length;continue;}
  if((m=s.match(/^\?([A-Za-z][A-Za-z0-9_]*)/))){out.push({kind:'var',value:'?'+m[1]});i+=m[0].length;continue;}
  if((m=s.match(/^(?:\d+\.\d+|\d+)(?:[eE][+-]?\d+)?/))){const n=Number(m[0]);assert(Number.isFinite(n),'Nonfinite number');out.push({kind:'literal',value:n});i+=m[0].length;continue;}
  if((m=s.match(/^[A-Za-z_][A-Za-z0-9_]*/))){const w=m[0];out.push(['true','false','null'].includes(w)?{kind:'literal',value:JSON.parse(w)}:{kind:'name',value:w});i+=w.length;continue;}
  const op=['===','!==','<=','>=','==','!=','&&','||','??','+','-','*','/','%','<','>','!','?',':','(',')','[',']','{','}',',','.'].find(v=>s.startsWith(v));assert(op,'Unsupported expression token near '+s.slice(0,32));out.push({kind:op,value:op});i+=op.length;
  assert(out.length<=4096,'Too many expression tokens');
 }out.push({kind:'eof'});return out;
}
export function parseExpression(source){
 const ts=tokenize(source);let i=0,nodes=0;const node=o=>{assert(++nodes<=2048,'Expression node limit');return o;};
 const peek=()=>ts[i],take=k=>{assert(peek().kind===k,'Expected '+k+', got '+peek().kind);return ts[i++];};
 function primary(depth){assert(depth<=64,'Expression depth limit');let x,t=peek();
  if(t.kind==='literal'||t.kind==='ref'||t.kind==='var'||t.kind==='name'){i++;x=node({type:t.kind,value:t.value});}
  else if(t.kind==='!'||t.kind==='-'){i++;x=node({type:'unary',op:t.kind,arg:primary(depth+1)});}
  else if(t.kind==='('){i++;x=expression(0,depth+1);take(')');}
  else if(t.kind==='['){i++;const items=[];if(peek().kind!==']'){do{items.push(expression(0,depth+1));if(peek().kind!==',')break;i++;}while(true);}take(']');x=node({type:'array',items});}
  else if(t.kind==='{'){i++;const entries=[];if(peek().kind!=='}'){do{const k=ts[i++];assert(k.kind==='name'||k.kind==='literal'&&typeof k.value==='string','Object keys must be names or strings');assert(!bad.has(k.value),'Forbidden object key');take(':');entries.push([k.value,expression(0,depth+1)]);if(peek().kind!==',')break;i++;}while(true);}take('}');x=node({type:'object',entries});}
  else throw Error('Expected expression, got '+t.kind);
  for(;;){if(peek().kind==='.'){i++;const k=take('name').value;assert(!bad.has(k),'Forbidden property');x=node({type:'member',object:x,key:{type:'literal',value:k}});}
   else if(peek().kind==='['){i++;const k=expression(0,depth+1);take(']');x=node({type:'member',object:x,key:k});}
   else if(peek().kind==='('){i++;const args=[];if(peek().kind!==')'){do{args.push(expression(0,depth+1));if(peek().kind!==',')break;i++;}while(true);}take(')');x=node({type:'call',callee:x,args});}
   else break;
  }return x;
 }
 function expression(min,depth){let left=primary(depth);while(peek().kind in infix&&infix[peek().kind]>=min){const op=ts[i++].kind;left=node({type:'binary',op,left,right:expression(infix[op]+1,depth+1)});}if(min===0&&peek().kind==='?'){i++;const yes=expression(0,depth+1);take(':');left=node({type:'conditional',test:left,yes,no:expression(0,depth+1)});}return left;}
 const ast=expression(0,0);take('eof');return ast;
}
export function expressionRefs(ast){const out=new Set();(function walk(n){if(!n||typeof n!=='object')return;if(n.type==='ref')out.add(n.value);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);})(ast);return [...out];}
export function evaluateExpression(ast,{refs={},variables={},maxOps=10000,maxBytes=65536,maxItems=4096}={}){
 let ops=0;const bound=v=>{if(typeof v==='string')assert(Buffer.byteLength(v)<=maxBytes,'String output budget');if(Array.isArray(v))assert(v.length<=maxItems,'Array output budget');if(typeof v==='number')assert(Number.isFinite(v),'Nonfinite result');return v;};
 const own=(v,k)=>{assert(!bad.has(String(k)),'Forbidden property');if((typeof v==='string'||Array.isArray(v))&&k==='length')return v.length;assert(v!==null&&typeof v==='object'||typeof v==='string','Cannot index this value');assert(Object.hasOwn(Object(v),k),'Missing own property '+k);return bound(v[k]);};
 const math=new Set(['abs','min','max','floor','ceil','round']);
 const methods=new Set(['trim','toLowerCase','toUpperCase','normalize','slice','substring','includes','startsWith','endsWith','replaceAll','split','join']);
 function call(n){const args=n.args.map(e);assert(args.length<=32,'Too many arguments');
  if(n.callee.type==='name'){if(n.callee.value==='only'){assert(args.length===1&&Array.isArray(args[0])&&args[0].length===1,'only() requires exactly one result; clarify missing or ambiguous data');return args[0][0];}assert(['String','Number'].includes(n.callee.value),'Only String/Number/only are callable');assert(args.length===1&&['number','boolean','string'].includes(typeof args[0]),'Primitive conversion expected');return bound(n.callee.value==='String'?String(args[0]):Number(args[0]));}
  assert(n.callee.type==='member','Unsupported call');const key=e(n.callee.key);assert(typeof key==='string'&&!bad.has(key),'Invalid method');
  if(n.callee.object.type==='name'&&n.callee.object.value==='Math'){assert(math.has(key)&&args.length>0&&args.every(x=>typeof x==='number'),'Math operation not allowed');return bound(Math[key](...args));}
  assert(methods.has(key),'Method not allowed: '+key);const v=e(n.callee.object);
  if(key==='join'){assert(Array.isArray(v)&&v.every(x=>['string','number','boolean'].includes(typeof x))&&args.length<=1&&(args[0]===undefined||typeof args[0]==='string'),'join requires primitive array');const size=v.reduce((s,x)=>s+String(x).length,0)+(args[0]?.length??1)*v.length;assert(size<=maxBytes,'join output budget');return bound(v.join(args[0]));}
  if(key==='slice'&&Array.isArray(v)){assert(args.length<=2&&args.every(Number.isSafeInteger),'Integer indices expected');return bound(v.slice(...args));}
  assert(typeof v==='string','String method requires string');
  if(['trim','toLowerCase','toUpperCase'].includes(key)){assert(!args.length,'Method takes no arguments');return bound(String.prototype[key].call(v));}
  if(key==='normalize'){assert(args.length<=1&&['NFC','NFD','NFKC','NFKD',undefined].includes(args[0]),'Invalid normalization');return bound(v.normalize(args[0]));}
  if(['slice','substring'].includes(key)){assert(args.length<=2&&args.every(Number.isSafeInteger),'Integer indices expected');return bound(String.prototype[key].call(v,...args));}
  if(['includes','startsWith','endsWith'].includes(key)){assert(args.length===1&&typeof args[0]==='string','One string expected');return v[key](args[0]);}
  if(key==='replaceAll'){assert(args.length===2&&args.every(x=>typeof x==='string'),'Literal replacement only');const max=(v.length+1)*(args[1].length+1)+v.length;assert(max<=maxBytes*8,'Replacement allocation budget');return bound(v.replaceAll(...args));}
  if(key==='split'){assert(args.length===1&&typeof args[0]==='string','Literal delimiter expected');const r=v.split(args[0],maxItems+1);return bound(r);}
  throw Error('Unknown operation');
 }
 function e(n){assert(++ops<=maxOps,'Expression operation budget');switch(n.type){
  case 'literal':return bound(n.value);case 'ref':assert(Object.hasOwn(refs,n.value),'Unknown value $'+n.value);return bound(refs[n.value]);case 'var':assert(Object.hasOwn(variables,n.value),'Unbound '+n.value);return bound(variables[n.value]);
  case 'name':throw Error('No global values in jsEval: '+n.value);
  case 'array':return bound(n.items.map(e));case 'object':{const o=Object.create(null);for(const [k,v]of n.entries)o[k]=e(v);return o;}
  case 'member':return own(e(n.object),e(n.key));case 'call':return call(n);
  case 'conditional':return e(n.test)?e(n.yes):e(n.no);
  case 'unary':{const v=e(n.arg);if(n.op==='!')return !v;assert(typeof v==='number','Unary minus needs number');return bound(-v);}
  case 'binary':{const l=e(n.left);if(n.op==='&&')return l&&e(n.right);if(n.op==='||')return l||e(n.right);if(n.op==='??')return l??e(n.right);const r=e(n.right);
   if(['==','==='].includes(n.op))return l===r;if(['!=','!=='].includes(n.op))return l!==r;
   if(['<','<=','>','>='].includes(n.op)){assert(typeof l===typeof r&&['number','string'].includes(typeof l),'Comparison types differ');return {'<':l<r,'<=':l<=r,'>':l>r,'>=':l>=r}[n.op];}
   if(n.op==='+'&&typeof l==='string'&&typeof r==='string'){assert(l.length+r.length<=maxBytes,'Concatenation budget');return l+r;}
   assert(typeof l==='number'&&typeof r==='number','Arithmetic requires numbers');let v;switch(n.op){case '+':v=l+r;break;case '-':v=l-r;break;case '*':v=l*r;break;case '/':v=l/r;break;case '%':v=l%r;break;default:throw Error('Unknown binary op');}return bound(v);}
  default:throw Error('Unknown expression node');
 }}
 const value=e(ast);assert(Buffer.byteLength(JSON.stringify(value)??'null')<=maxBytes,'Expression serialized output budget');return {value,operations:ops};
}
export function runExpression(text,options){return evaluateExpression(parseExpression(text),options);}
