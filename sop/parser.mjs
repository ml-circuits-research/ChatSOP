/** SOP Lang experimental profile rw-1: line-oriented, multiline typed wires. */
import {outputRegistry,outputSpecs} from './outputs.mjs';
import {assert,stable} from '../lib/util.mjs';
import {parseExpression,expressionRefs,evaluateExpression} from './expression.mjs';
export const PROFILE='sop-agent-3';
export const SPEC={
 value:{one:['data'],required:['data']},
 resolve:{one:['text','language','kind','type','domain'],required:['text','language','kind']},
 fact:{one:['holds','valid','source','quote','retention'],required:['holds','valid']},
 rule:{one:['then','valid','mode','source'],many:['when'],required:['then','when']},
 query:{one:['mode','select','at','during','asof','limit'],many:['where','filter'],required:['where']},
 constraint:{one:['claim','task','unit','objective','direction'],many:['var','require'],required:['claim']},
 event:{one:['action','target','effective','replacement','source'],required:['action','target']},
 pack:{many:['items'],required:['items']},
 assert:{one:['scope'],many:['input','after'],required:['input']},
 recall:{one:['query','strategy'],many:['after'],required:['query']},
 link:{one:['query','data','strategy'],many:['after'],required:['query']},
 solve:{one:['query','constraint','data','backend','strategy','assume','reasoning'],many:['output','after']},
 binding:{one:['result','variable','mode','owner'],required:['result','variable','mode','owner']},
 reason:{one:['query','memory','data','constraint','backend','assume','reasoning','mode'],many:['after']},
 cnl:{one:['result','language'],required:['result']},
 jsEval:{one:['expr'],required:['expr']},
 template:{one:['params','yield','body','description'],many:['cue'],required:['body','yield']},
 expand:{one:['using'],many:['with','after'],required:['using']},
 clarify:{one:['text'],required:['text']},
 pattern:{one:['then','support','coverage','samples','counterexamples','source','status'],many:['when'],required:['when','then']},
 hypothesis:{one:['holds','cost','status','source'],many:['assume']},
 action:{one:['params','cost','source','valid'],many:['requires','adds','removes'],required:['requires']},
 goal:{many:['where'],required:['where']},
 trace:{one:['text','source','closed','known'],many:['feature']},
 policy:{one:['maxNodes','maxDepth','maxHypotheses','maxCandidates','maxPlans','timeoutMs']},
 theory:{one:['dialect','body'],required:['dialect','body']},
 procedure:{one:['params','yield','body','description'],many:['cue'],required:['body','yield']},
 abduce:{one:['query','data','memory','observation','candidates','reasoning','policy'],many:['output','after']},
 diagnose:{one:['query','data','memory','observation','candidates','tests','reasoning','policy'],many:['output','after']},
 associate:{one:['cue','data','mode','reasoning','policy'],many:['output','after'],required:['cue','data']},
 induce:{one:['data','candidates','holdout','reasoning','policy'],many:['output','after'],required:['data']},
 analogize:{one:['source','target','transfer','reasoning','policy'],many:['output','after'],required:['source','target']},
 plan:{one:['data','memory','actions','goal','reasoning','policy'],many:['output','after'],required:['goal']},
 simulate:{one:['query','data','memory','intervention','mode','reasoning','policy'],many:['output','after'],required:['query','intervention']},
 temporal:{one:['query','data','memory','reasoning','policy'],many:['output','after'],required:['query']}
};
export function words(s){return s.match(/"(?:\\.|[^"\\])*"|\S+/g)??[];}
export function unquote(s){return s?.startsWith('"')?JSON.parse(s):s;}
function splitTerms(s){let quoted=false,escape=false,start=0,parts=[];for(let i=0;i<s.length;i++){const c=s[i];if(quoted){if(!escape&&c==='"')quoted=false;if(!escape&&c==='\\')escape=true;else escape=false;}else if(c==='"')quoted=true;else if(c===','){parts.push(s.slice(start,i).trim());start=i+1;}}assert(!quoted,'Unclosed atom string');parts.push(s.slice(start).trim());return parts;}
export function parseTerm(s){if(/^\$[A-Za-z][A-Za-z0-9_]*$/.test(s))return {ref:s.slice(1)};if(/^\?[A-Za-z][A-Za-z0-9_]*$/.test(s))return s;if(s.startsWith('"')){const v=JSON.parse(s);assert(typeof v==='string','String term required');return v;}if(/^-?\d+$/.test(s)){const n=Number(s);assert(Number.isSafeInteger(n),'Safe integer expected');return n;}assert(/^[a-z][a-z0-9_:-]*$/.test(s),'Invalid canonical term '+s);return s;}
export function parseAtom(text){const m=text.match(/^(not\s+)?([a-z][a-z0-9_]*)\((.*)\)$/);assert(m,'Expected predicate(arg, ...) or not predicate(arg, ...)');const a=splitTerms(m[3]).map(parseTerm);assert(a.length>=1&&a.length<=4,'This profile supports 1..4 arguments');return {p:m[2],a,neg:!!m[1]};}
export function emitTerm(x){if(x&&typeof x==='object'&&x.ref)return '$'+x.ref;if(typeof x==='number')return String(x);if(/^\?[A-Za-z][A-Za-z0-9_]*$/.test(x))return x;return /^[a-z][a-z0-9_:-]*$/.test(x)?x:JSON.stringify(x);}
export const emitAtom=a=>(a.neg?'not ':'')+a.p+'('+a.a.map(emitTerm).join(', ')+')';
export function scalar(text,values={}){if(/^\$[A-Za-z][A-Za-z0-9_]*$/.test(text)){const n=text.slice(1);assert(Object.hasOwn(values,n),'Unresolved $'+n);return values[n];}return unquote(text);}
export function parse(source,{maxWires=2048,maxBytes=1048576,allowTypes=null}={}){
 assert(typeof source==='string'&&Buffer.byteLength(source)<=maxBytes,'SOP source size limit');const lines=source.replace(/\r\n/g,'\n').split('\n'),wires=[];let current=null;
 for(let i=0;i<lines.length;i++){const line=lines[i];if(!line.trim()||line.trimStart().startsWith('#'))continue;
  if(/^@/.test(line)){const m=line.match(/^@([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)\s*$/);assert(m,`Line ${i+1}: expected @name type`);assert(!wires.some(w=>w.id===m[1]),'Duplicate wire @'+m[1]);assert(SPEC[m[2]]||(allowTypes??[]).includes(m[2]),'Unknown wire type '+m[2]);assert(!['constructor','prototype','__proto__'].includes(m[1]),'Reserved wire name');current={id:m[1],type:m[2],fields:{},line:i+1};wires.push(current);assert(wires.length<=maxWires,'Too many wires');continue;}
  assert(current&&/^  \S/.test(line),`Line ${i+1}: wire fields use two spaces`);const m=line.trim().match(/^(\S+)(?:\s+(.*))?$/),key=m[1];let value=m[2]??'';
  const spec=SPEC[current.type];assert(!spec||(spec.one??[]).includes(key)||(spec.many??[]).includes(key),'Unsupported field '+key+' on '+current.type);
  if(value==='|'){const chunk=[];while(i+1<lines.length){const next=lines[i+1];if(next.trim()&&!next.startsWith('    '))break;i++;chunk.push(next.startsWith('    ')?next.slice(4):'');}value=chunk.join('\n').replace(/\s+$/,'');}
  current.fields[key]??=[];current.fields[key].push(value);if(spec&&(spec.one??[]).includes(key))assert(current.fields[key].length===1,'Duplicate '+key);
 }
 assert(wires.length>0,'Empty SOP program');for(const w of wires){const spec=SPEC[w.type];for(const k of spec?.required??[])assert(w.fields[k]?.length,'@'+w.id+' needs '+k);validateShape(w);}
 return {profile:PROFILE,wires};
}
export const one=(w,k,defaultValue=undefined)=>w.fields[k]?.[0]??defaultValue;
export const many=(w,k)=>w.fields[k]??[];
export function refsIn(text){let quoted=false,esc=false;const values=new Set(),handles=new Set();for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(!esc&&c==='"')quoted=false;if(!esc&&c==='\\')esc=true;else esc=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='$'||c==='~'){const m=text.slice(i+1).match(/^[A-Za-z][A-Za-z0-9_]*/);if(m){(c==='$'?values:handles).add(m[0]);i+=m[0].length;}}}return {values:[...values],handles:[...handles]};}
export function dependencies(w){if(['template','procedure'].includes(w.type))return {values:[],handles:[]};const result={values:new Set(),handles:new Set()};for(const [key,vs]of Object.entries(w.fields)){if(['quote','text'].includes(key)||(key==='source'&&w.type!=='analogize'))continue;for(const text of vs){const r=refsIn(text);r.values.forEach(x=>result.values.add(x));r.handles.forEach(x=>result.handles.add(x));}}return {values:[...result.values],handles:[...result.handles]};}
function validateShape(w){
 if(w.type==='fact')parseAtom(one(w,'holds'));
 if(['rule','pattern'].includes(w.type)){many(w,'when').forEach(parseAtom);parseAtom(one(w,'then'));}
 if(w.type==='rule')assert(['logical','causal'].includes(one(w,'mode','logical')),'rule mode must be logical or causal');
 if(w.type==='hypothesis'){assert(w.fields.holds||w.fields.assume,'hypothesis requires holds or assume');if(w.fields.holds)parseAtom(one(w,'holds'));many(w,'assume').forEach(parseAtom);}
 if(w.type==='goal')many(w,'where').forEach(parseAtom);
 if(w.type==='trace')many(w,'feature').forEach(parseAtom);
 if(w.type==='action'){for(const key of ['requires','adds','removes'])many(w,key).forEach(parseAtom);assert(w.fields.adds||w.fields.removes,'action needs effects');}
 if(['abduce','diagnose','associate','induce','analogize','plan','simulate','temporal'].includes(w.type))outputSpecs(w);
 if(w.type==='query'){many(w,'where').forEach(parseAtom);many(w,'filter').forEach(parseExpression);assert(!(w.fields.at&&w.fields.during),'Use at OR during');}
 if(w.type==='jsEval')parseExpression(one(w,'expr'));
 if(w.type==='constraint'){many(w,'require').forEach(parseExpression);parseExpression(one(w,'claim'));}
 if(w.type==='value'){const a=parseExpression(one(w,'data'));assert(a.type!=='name','value needs a literal or expression');}
 if(w.type==='event')assert(['end','retract','correct'].includes(one(w,'action')),'Unknown event action');
 if(w.type==='resolve'){assert(['entity','predicate','concept'].includes(one(w,'kind')),'resolve kind must be entity, predicate or concept');assert(/^[a-z]{2,3}$/.test(one(w,'language')),'resolve needs an explicit language');assert(!w.fields.type||one(w,'kind')==='entity','resolve type is only for entities');for(const key of ['text','type','domain'])if(w.fields[key])assert(typeof unquote(one(w,key))==='string'&&unquote(one(w,key)).length>0,'resolve '+key+' must be nonempty text');}
 if(w.type==='solve'){outputSpecs(w);assert(!(w.fields.constraint&&(w.fields.data||w.fields.assume)),'Constraint solve cannot consume undeclared fact data');}
 if(w.type==='reason'||w.type==='solve')assert(!!w.fields.query!==!!w.fields.constraint,'reason needs exactly query OR constraint');
}
export function validateGraph(program,{allowMaterialized=false}={}) {
 const outputs=outputRegistry(program,{allowMaterialized}),ids=new Set(program.wires.map(w=>w.id)),deps=new Map();
 for(const name of outputs.keys())ids.add(name);
 for(const w of program.wires){const d=dependencies(w);for(const id of [...d.values,...d.handles])assert(ids.has(id),'Unknown reference '+id+' in @'+w.id);deps.set(w.id,d.values);}
 for(const [name,spec]of outputs)if(!deps.has(name))deps.set(name,[spec.owner]);
 const done=new Set(),order=[];
 while(done.size<ids.size){const ready=[...ids].filter(id=>!done.has(id)&&deps.get(id).every(x=>done.has(x)));assert(ready.length,'Cyclic value dependencies (including deferred outputs)');for(const id of ready){done.add(id);order.push(id);}}
 return order;
}
export function canonical(program){return program.wires.map(w=>'@'+w.id+' '+w.type+'\n'+Object.entries(w.fields).flatMap(([k,vs])=>vs.map(v=>v.includes('\n')?'  '+k+' |\n'+v.split('\n').map(l=>'    '+l).join('\n'):'  '+k+(v?' '+v:''))).join('\n')).join('\n\n')+'\n';}
export function replaceReferences(source,names){let out='',quoted=false,esc=false;for(let i=0;i<source.length;i++){const c=source[i];if(quoted){out+=c;if(!esc&&c==='"')quoted=false;if(!esc&&c==='\\')esc=true;else esc=false;continue;}if(c==='"'){quoted=true;out+=c;continue;}if(c==='$'||c==='~'){const m=source.slice(i+1).match(/^[A-Za-z][A-Za-z0-9_]*/);if(m){out+=c+(names[m[0]]??m[0]);i+=m[0].length;continue;}}out+=c;}return out;}
