import {parse,canonical,one,many,words,parseAtom,emitAtom,dependencies,validateGraph} from './parser.mjs';
import {parseCondition,parseBooleanCondition} from './conditions.mjs';
import {emitCondition} from '../lib/conditions.mjs';
import {variable} from '../lib/types.mjs';
import {formatTime} from '../lib/time.mjs';
import {assert,stable} from '../lib/util.mjs';

/** The neural author describes problems; only this host compiler emits operations. */
export const MODEL_TYPES=new Set(['premise','query','constraint']);
const node=(id,type,fields)=>({id,type,fields,line:0});
const projectionNames=w=>w.type==='query'?words(one(w,'select','')):many(w,'var').map(line=>words(line)[0]);

function checkFilter(ast){
 assert(['literal','var','unary','binary'].includes(ast.type),'Model filters describe comparisons, not executable calls or object access');
 if(ast.type==='unary')checkFilter(ast.arg);
 if(ast.type==='binary'){checkFilter(ast.left);checkFilter(ast.right);}
}

export function compileDeclarative(source,{language='en',inputText='',context={premises:[]},lexicon=null,schema=null,maxWires=2048}={}){
 const authored=parse(source,{maxWires});
 for(const w of authored.wires){
  assert(MODEL_TYPES.has(w.type),'Model authors premise, query or constraint; '+w.type+' belongs to symbolic execution');
  assert(!dependencies(w).handles.length,'Model declarations cannot invoke definition handles');
  if(w.type==='query')many(w,'filter').forEach(text=>checkFilter(parseBooleanCondition(text)));
 }
 assert(Array.isArray(context.premises),'Context premises must be an array');
 const lang=/^[a-z]{2,3}$/.test(language)&&language!=='auto'?language:'en';
 const approvedEntities=new Map((context.entities??[]).map(entity=>[entity.id,entity]));
 const used=new Set(authored.wires.map(w=>w.id));
 const requestedRefs=new Set(authored.wires.flatMap(w=>dependencies(w).values));
 const outputs=new Map(),providers=new Map();
 for(const w of authored.wires)if(w.type==='query'||w.type==='constraint')for(const v of projectionNames(w)){
  if(!providers.has(v.slice(1)))providers.set(v.slice(1),[]);
  providers.get(v.slice(1)).push(w);
 }
 const exportValue=(name,owner)=>{
  assert(!used.has(name),'Projected scalar conflicts with declaration @'+name);
  assert(!outputs.has(name)||outputs.get(name)===owner.id,'Scalar $'+name+' has multiple producing problems');
  outputs.set(name,owner.id);
 };
 for(const name of requestedRefs)if(!used.has(name)){
  const choices=providers.get(name)??[];
  assert(choices.length===1,'Reference $'+name+' needs exactly one declaring problem');
  exportValue(name,choices[0]);
 }
 for(const w of authored.wires)if(w.type==='constraint')for(const v of words(one(w,'select',''))){
  assert(/^\?[a-z][a-z0-9_]*$/.test(v),'Constraint select needs ?variables');
  exportValue(v.slice(1),w);
 }
 for(const name of outputs.keys())used.add(name);
 const reservedRoots=new Set([...used].map(name=>name.split('__')[0]));let serial=0;
 const id=()=>{let name;do{name='host'+serial++;}while(reservedRoots.has(name));used.add(name);reservedRoots.add(name);return name;};
 const resolutions=[],resolved=new Map(),execution=[],premiseIds=[],retainedIds=[],problemIds=[],renderIds=[];
 const normalizeAtom=text=>{
  const a=parseAtom(text);
  if(lexicon)for(let i=0;i<a.a.length;i++){
   const term=a.a[i],type=(schema??lexicon.predicates)?.[a.p]?.args?.[i];
   if(typeof term!=='string'||variable(term)||!type||['integer','value'].includes(type))continue;
   const approved=approvedEntities.get(term),known=lexicon.entities[term];
   if(approved||known){assert(type==='entity'||(approved?.type??known?.entityType)===type,'Entity type does not match '+a.p+' argument');continue;}
   const scope={language:lang,kind:'entity',...(type==='entity'?{}:{type})};
   const local=lexicon.matching(term,scope),any=local.found.length?local:lexicon.matching(term,{...scope,language:'auto'});
   const resolutionLanguage=!local.found.length&&any.found.length===1&&any.found[0].language!=='und'?any.found[0].language:lang;
   const key=stable([term,type,resolutionLanguage]);
   if(!resolved.has(key)){
    const name=id(),fields={text:[JSON.stringify(term)],language:[resolutionLanguage],kind:['entity']};
    if(type!=='entity')fields.type=[type];
    resolutions.push(node(name,'resolve',fields));resolved.set(key,name);
   }
   a.a[i]={ref:resolved.get(key)};
  }
  return emitAtom(a);
 };
 for(const p of context.premises){
  assert(p.origin==='model-interpretation','Only attributed model interpretations belong in conversational context');
  const name=id();retainedIds.push(name);
  execution.push(node(name,'premise',{holds:[emitAtom(p.atom)],valid:[formatTime(p.valid.from)+' '+formatTime(p.valid.until)]}));
 }
 for(const w of authored.wires){
  const fields=Object.fromEntries(Object.entries(w.fields).map(([key,values])=>[key,[...values]]));
  if(w.type==='premise'){fields.holds=[normalizeAtom(one(w,'holds'))];premiseIds.push(w.id);}
  if(w.type==='query')fields.where=many(w,'where').map(text=>emitCondition(parseCondition(text,leaf=>parseAtom(normalizeAtom(leaf))),emitAtom));
  execution.push({...w,fields});
 }
 const assumptions=[...retainedIds,...premiseIds];
 let assumptionRef;
 if(assumptions.length===1)assumptionRef='$'+assumptions[0];
 if(assumptions.length>1){const name=id();execution.push(node(name,'pack',{items:assumptions.map(name=>'$'+name)}));assumptionRef='$'+name;}
 for(const w of authored.wires)if(w.type==='query'||w.type==='constraint'){
  const solveId=id(),renderId=id(),fields={[w.type]:['$'+w.id]};
  if(w.type==='query'&&assumptionRef)fields.assume=[assumptionRef];
  const projected=[...outputs].filter(([,owner])=>owner===w.id).map(([name])=>'?'+name+' one');
  if(projected.length)fields.output=projected;
  execution.push(node(solveId,'solve',fields),node(renderId,'cnl',{result:['$'+solveId],language:[lang]}));
  problemIds.push({declaration:w.id,solve:solveId,render:renderId});renderIds.push(renderId);
 }
 const program={wires:[...resolutions,...execution]};
 assert(program.wires.length<=maxWires,'Generated circuit exceeds wire budget');validateGraph(program);
 return {authoredSop:canonical(authored),executionSop:canonical(program),premiseIds,retainedIds,problemIds,renderIds,language:lang,inputText};
}

/** Model interpretations stay in caller-owned conversation context, never the repository. */
export async function runDeclarative(source,{runtime,language='en',inputText='',context={premises:[]}}){
 const plan=compileDeclarative(source,{language,inputText,context,lexicon:runtime.lexicon,schema:runtime.schema,maxWires:runtime.policy.maxWires});
 assert(context.premises.length+plan.premiseIds.length<=runtime.policy.maxFacts,'Conversation premise limit');
 const result=await runtime.run(plan.executionSop,{origin:'generated'});
 const admitted=plan.premiseIds.flatMap(name=>{
  const p=result.values[name];return p?.kind==='premise'?[{atom:p.atom,valid:p.valid,origin:'model-interpretation',text:inputText}]:[];
 });
 const retained=new Map(context.premises.map(p=>[stable(p),p]));
 for(const p of admitted)retained.set(stable(p),p);
 context.premises=[...retained.values()];
 const rendered=plan.renderIds.map(name=>result.values[name]).filter(value=>value?.kind==='cnl');
 if(!plan.problemIds.length){
  const missing=plan.premiseIds.filter(name=>!result.values[name]);
  if(!missing.length){
   const packet={kind:'context',status:'context_updated',complete:true,count:admitted.length};
   result.result={kind:'cnl',language:plan.language,packet,text:'Retained '+admitted.length+' contextual premise(s) as model interpretations, not verified facts.'};
  }
 }else if(rendered.length===plan.renderIds.length){
  result.result=rendered.length===1?rendered[0]:{...rendered.at(-1),text:rendered.map((r,i)=>plan.problemIds[i].declaration+':\n'+r.text).join('\n\n')};
 }
 const unresolved=Object.entries(result.outputs).filter(([,output])=>output.status!=='bound');
 if(unresolved.length||result.result?.status==='blocked'||(!plan.problemIds.length&&admitted.length<plan.premiseIds.length)){
  const details=unresolved.map(([name,output])=>({name,status:output.status,...(output.surface?{surface:output.surface}:{}),...(output.candidates?{candidates:output.candidates}:{})}));
  const identities=details.filter(item=>item.surface);
  const describeIdentity=item=>{
   const choices=Array.isArray(item.candidates)?item.candidates.map(candidate=>runtime.lexicon?.entities[candidate.id]?.labels?.[plan.language]??candidate.id):[];
   return JSON.stringify(item.surface)+(choices.length?' ('+choices.join(' or ')+')':'');
  };
  const question=identities.length?'Which entity do you mean by '+identities.map(describeIdentity).join(', ')+'?':
   details.some(item=>item.status==='incomplete')?'The search did not finish within its limits. Can you narrow the question?':
   'What additional condition or value determines '+details.map(item=>'?'+item.name).join(', ')+'? The current premises do not provide the unique input needed to continue.';
  const reserved=new Set([...Object.keys(result.values),...parse(plan.executionSop).wires.map(w=>w.id)]);let clarifyId='hostClarify';while(reserved.has(clarifyId))clarifyId+='Next';
  const clarification=canonical({wires:[node(clarifyId,'clarify',{text:[JSON.stringify(question)]})]});
  const stopped=await runtime.run(clarification,{origin:'generated'});
  const packet={...stopped.result,reason:'unresolved_dependency',required:details,pendingSop:plan.authoredSop,next:'answer_clarification',complete:false};
  result.result={kind:'cnl',language:plan.language,text:question,packet};
  result.generated.push({kind:'clarification',epoch:0,source:clarification});
  result.trace.push(...stopped.trace);
  Object.assign(result.values,stopped.values);
  plan.executionSop+='\n'+clarification;
 }
 return {...result,authoredSop:plan.authoredSop,executionSop:plan.executionSop,contextPremises:context.premises,problemResults:plan.problemIds.map(p=>({id:p.declaration,result:result.values[p.solve]})),generated:[{kind:'orchestration',epoch:0,source:plan.executionSop},...result.generated]};
}
