import {parse,canonical,one,many,words,parseAtom,emitAtom,dependencies,validateGraph,unquote,isMatch,parseMatch} from './parser.mjs';
import {parseCondition,parseBooleanCondition} from './conditions.mjs';
import {emitCondition} from '../lib/conditions.mjs';
import {variable,atomKey} from '../lib/types.mjs';
import {formatTime} from '../lib/time.mjs';
import {assert,stable} from '../lib/util.mjs';
import {cnl} from './cnl.mjs';
import {propositionOf,linkProposition,propositionValidity,propositionKey,conditionalStatement,reportProposition} from './propositions.mjs';
import {normalizeTime,linkQuestion} from './linking.mjs';
import {unclearReply,REPLY_LANGUAGES} from './unclear.mjs';

/**
 * The neural author describes problems; only this host compiler emits operations.
 * The model language (DS021) has exactly these authored wire types.
 */
export const MODEL_TYPES=Object.freeze(new Set(['stated','assumed','unclear','query','constraint']));
const listTypes=types=>{const t=[...types];return t.slice(0,-1).join(', ')+' or '+t.at(-1);};
const node=(id,type,fields)=>({id,type,fields,line:0});
const projectionNames=w=>w.type==='query'?words(one(w,'select','')):many(w,'var').map(line=>words(line)[0]);

function checkFilter(ast){
 assert(['literal','var','unary','binary'].includes(ast.type),'Model filters describe comparisons, not executable calls or object access');
 if(ast.type==='unary')checkFilter(ast.arg);
 if(ast.type==='binary'){checkFilter(ast.left);checkFilter(ast.right);}
}

/** Admission of one model-authored wire; shared by the compiler, the agent and the evaluator. */
export function checkModelWire(w){
 assert(MODEL_TYPES.has(w.type),'Model authors '+listTypes(MODEL_TYPES)+'; '+w.type+' belongs to symbolic execution');
 assert(!dependencies(w).handles.length,'Model declarations cannot invoke definition handles');
 if(w.type==='query')many(w,'filter').forEach(text=>checkFilter(parseBooleanCondition(text)));
 if(w.type==='query'){
  // Model queries use string propositions (match blocks) and quoted temporal expressions.
  const leaves=[];for(const text of [...many(w,'where'),...many(w,'scope')])parseCondition(text,leaf=>{leaves.push(leaf);return {a:[]};});
  assert(leaves.every(isMatch),'query_needs_match: @'+w.id+' states each condition as a match block (relation, roles, polarity), not an atom');
  for(const key of ['at','during','asof'])if(w.fields[key])assert(/^"/.test(one(w,key)),'@'+w.id+' '+key+' takes a JSON-quoted temporal expression');
  assert(!w.fields.span,'@'+w.id+' span is host plumbing; the model asks for a time with role time ?variable');
  // "When", "since when", "how long", "how many times": at most one time variable, written as `role time ?t`.
  const times=new Set(leaves.flatMap(leaf=>parseMatch(leaf).roles.filter(role=>role.name==='time'&&typeof role.value==='string'&&role.value.startsWith('?')).map(role=>role.value)));
  assert(times.size<=1,'time_variable_multiple: @'+w.id+' asks for more than one time; use one query per time');
  if(w.fields.measure)assert(times.has(one(w,'select')),'measure_needs_time_variable: @'+w.id+' measure applies to the selected role time ?variable');
 }
 if(w.type==='constraint')assert(w.fields.task,'constraint_task_required: @'+w.id+' must state task prove, possible or optimize');
}
export function checkModelProgram(program){
 for(const w of program.wires)checkModelWire(w);
 if(program.wires.some(w=>w.type==='unclear'))assert(program.wires.length===1,'unclear_not_alone: unclear must be the only wire of the model output');
 return program;
}

export function compileDeclarative(source,{language='en',inputText='',context={},lexicon=null,schema=null,maxWires=2048,modelAssumptions='report',maxModelAssumptions=8,now=Date.now()}={}){
 const authored=checkModelProgram(parse(source,{maxWires}));
 const statementsIn=context.statements??[];
 assert(Array.isArray(statementsIn),'Context statements must be an array');
 assert(['report','branch'].includes(modelAssumptions),'Host policy modelAssumptions must be report or branch');
 const lang=/^[a-z]{2,3}$/.test(language)&&language!=='auto'?language:'en';
 const empty={problemIds:[],renderIds:[],statements:[],assumptions:[],links:new Map(),evidenceIds:[],suppositionIds:[],assumptionFactIds:[],modelAssumptions,language:lang,inputText};
 const unclear=authored.wires.find(w=>w.type==='unclear');
 if(unclear)return {...empty,unclear:{id:unclear.id,kind:one(unclear,'kind'),language:one(unclear,'language',null),readings:many(unclear,'reading').map(unquote)},authoredSop:canonical(authored),executionSop:''};
 const statements=authored.wires.filter(w=>w.type==='stated').map(propositionOf),assumptions=authored.wires.filter(w=>w.type==='assumed').map(propositionOf);
 assert(assumptions.length<=maxModelAssumptions,'too_many_assumptions: '+assumptions.length+' model assumptions exceed the host limit of '+maxModelAssumptions);
 const statedKeys=new Set();
 for(const p of statements){const key=stable([propositionKey(p),p.certainty,p.speaker]);assert(!statedKeys.has(key),'stated_duplicate: @'+p.id+' repeats an identical statement');statedKeys.add(key);}
 const plainStated=new Set(statements.map(propositionKey));
 for(const p of assumptions)assert(!plainStated.has(propositionKey(p)),'assumed_duplicates_stated: @'+p.id+' repeats a statement of this turn; the assumption is redundant');
 // Host linking (DS021): strings become predicates, atoms, entity lookups and intervals; failures become one host clarification.
 const issues=[],links=new Map();
 const anonymous=new Set(authored.wires.flatMap(w=>Object.values(w.fields).flat().flatMap(text=>text.match(/\?[A-Za-z][A-Za-z0-9_]*/g)??[])));
 let freshSerial=0;const fresh=()=>{let name;do{name='?host_any'+freshSerial++;}while(anonymous.has(name));anonymous.add(name);return name;};
 const link=(p,options)=>{
  if(!lexicon){issues.push({kind:'relation',status:'unknown',text:p.relation});return null;}
  const linked=linkProposition(p,lexicon,options);if(linked.issue){issues.push(linked.issue);return null;}
  return linked;
 };
 for(const p of [...statements,...assumptions]){
  const validity=propositionValidity(p,now);
  if(p.type==='stated'||modelAssumptions==='branch')issues.push(...validity.issues);
  // In report mode an assumption is linked only for the report; it never blocks the turn.
  const linked=p.type==='assumed'&&modelAssumptions!=='branch'?(lexicon?linkProposition(p,lexicon):{}):link(p);
  links.set(p.id,{...(linked?.issue?{}:linked??{}),validity:validity.issues.length?null:validity});
 }
 const temporal=(w,key)=>{
  const text=unquote(one(w,key)),period=normalizeTime(text,now);
  if(!period){issues.push({kind:'time',status:'unknown',text});return null;}
  return key==='during'?formatTime(period.from)+' '+formatTime(period.until):formatTime(period.from);
 };
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
 const resolutions=[],resolved=new Map(),execution=[],problemIds=[],renderIds=[];
 // Type-checks canonical entity arguments; with resolve=true a quoted surface becomes a generated resolve wire.
 const normalizeAtom=(text,{resolve=true}={})=>{
  const a=parseAtom(text);
  if(lexicon)for(let i=0;i<a.a.length;i++){
   const term=a.a[i],type=(schema??lexicon.predicates)?.[a.p]?.args?.[i];
   if(typeof term!=='string'||variable(term)||!type||['integer','value'].includes(type))continue;
   const known=lexicon.entities[term];
   if(known){assert(type==='entity'||known.entityType===type,'Entity type does not match '+a.p+' argument');continue;}
   if(!resolve)continue;
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
 const hasQuery=authored.wires.some(w=>w.type==='query'),branch=modelAssumptions==='branch'&&hasQuery;
 // Asserted user statements of earlier turns are re-supplied as turn-local user facts, never stored.
 const carriedIds=[];
 for(const s of statementsIn){
  assert(s.origin==='user-statement','Only attributed user statements are carried across turns');
  const name=id();carriedIds.push(name);
  execution.push(node(name,'fact',{holds:[emitAtom(s.atom)],valid:[formatTime(s.valid.from)+' '+formatTime(s.valid.until)],source:['user']}));
 }
 const evidenceIds=[],suppositionIds=[],assumptionFactIds=[],byId=new Map([...statements,...assumptions].map(p=>[p.id,p]));
 const fact=(w,source)=>{const l=links.get(w.id);return node(w.id,'fact',{holds:[normalizeAtom(l.atomText)],valid:[l.validity.text],source:[source]});};
 for(const w of authored.wires){
  if(w.type==='stated'||w.type==='assumed'){
   const p=byId.get(w.id),l=links.get(w.id);
   if(!l.atomText||!l.validity)continue;
   if(w.type==='stated'&&!conditionalStatement(p)){execution.push(fact(w,'user'));evidenceIds.push(w.id);}
   else if(w.type==='stated'&&hasQuery){execution.push(fact(w,'assumption'));suppositionIds.push(w.id);}
   else if(w.type==='assumed'&&branch){execution.push(fact(w,'assumption'));assumptionFactIds.push(w.id);}
   else if(w.type==='stated')normalizeAtom(l.atomText,{resolve:false});
   continue;
  }
  const fields=Object.fromEntries(Object.entries(w.fields).map(([key,values])=>[key,[...values]]));
  if(w.type==='query'){
   const spans=new Set();
   const leaf=text=>{const l=link(parseMatch(text,'@'+w.id+' match'),{exact:false,fresh});if(l?.span)spans.add(l.span);return parseAtom(l?normalizeAtom(l.atomText):'unlinked x');};
   fields.where=many(w,'where').map(text=>emitCondition(parseCondition(text,leaf),emitAtom));
   if(w.fields.scope)fields.scope=[emitCondition(parseCondition(one(w,'scope'),leaf),emitAtom)];
   // A time variable of a relation without a time role is the matched validity interval (host `span`).
   if(spans.size)fields.span=[...spans];
   if(w.fields.measure&&!spans.has(one(w,'select')))issues.push({kind:'time',status:'not_an_interval',text:one(w,'select')});
   // A quoted filter literal is an entity as written ("besides Ana"): the host resolves it like any role value.
   if(w.fields.filter)fields.filter=many(w,'filter').map(text=>text.replace(/"(?:\\.|[^"\\])*"/g,quoted=>{
    const surface=JSON.parse(quoted);if(!lexicon)return quoted;
    const found=lexicon.matching(surface,{language:lang,kind:'entity'}),any=found.found.length?found:lexicon.matching(surface,{language:'auto',kind:'entity'});
    if(any.found.length===1)return JSON.stringify(any.found[0].id);
    issues.push({kind:'entity',status:any.found.length?'ambiguous':'unknown',text:surface,candidates:any.found.map(e=>({id:e.id,roles:[]}))});return quoted;
   }));
   for(const key of ['at','during','asof'])if(w.fields[key]){const value=temporal(w,key);if(value)fields[key]=[value];}
  }
  execution.push({...w,fields});
 }
 if(issues.length)return {...empty,authoredSop:canonical(authored),executionSop:'',issues,statements,assumptions,links};
 const collect=ids=>{if(!ids.length)return undefined;if(ids.length===1)return '$'+ids[0];const name=id();execution.push(node(name,'pack',{items:ids.map(n=>'$'+n)}));return '$'+name;};
 const evidenceRef=collect([...carriedIds,...evidenceIds]),suppositionRef=collect(suppositionIds);
 const branchRef=assumptionFactIds.length?collect([...suppositionIds,...assumptionFactIds]):undefined;
 for(const w of authored.wires)if(w.type==='query'||w.type==='constraint'){
  const solveId=id(),renderId=id(),fields={[w.type]:['$'+w.id]};
  if(w.type==='query'){if(evidenceRef)fields.data=[evidenceRef];if(suppositionRef)fields.assume=[suppositionRef];}
  const projected=[...outputs].filter(([,owner])=>owner===w.id).map(([name])=>'?'+name+' one');
  if(projected.length)fields.output=projected;
  execution.push(node(solveId,'solve',fields),node(renderId,'cnl',{result:['$'+solveId],language:[lang]}));
  // The branch is an additional hypothetical solve; the primary answer never uses model assumptions.
  let branchId=null;
  if(w.type==='query'&&branchRef){branchId=id();const b={query:['$'+w.id],assume:[branchRef]};if(evidenceRef)b.data=[evidenceRef];execution.push(node(branchId,'solve',b));}
  problemIds.push({declaration:w.id,type:w.type,solve:solveId,render:renderId,branch:branchId,reading:canonical({wires:[authored.wires.find(x=>x.id===w.id)]}).trim().split('\n').map(line=>line.trim()).join('; ')});renderIds.push(renderId);
 }
 const program={wires:[...resolutions,...execution]};
 assert(program.wires.length<=maxWires,'Generated circuit exceeds wire budget');validateGraph(program);
 return {...empty,authoredSop:canonical(authored),executionSop:program.wires.length?canonical(program):'',carriedIds,problemIds,renderIds,statements,assumptions,links,evidenceIds,suppositionIds,assumptionFactIds};
}

const TEXT={
 en:{context:n=>'Noted '+n+' statement(s) for this conversation; they are not stored in the repository.',conditionalOnly:'Suppositions, hedged claims and reported claims apply only to a question in the same message.',understood:(reading)=>'I understood the question as: '+reading+'. I cannot compute this kind of answer yet.',branch:'Only under the model\'s assumptions: ',condition:'Condition: '},
 ro:{context:n=>'Am reținut '+n+' afirmație/afirmații pentru această conversație; nu sunt înregistrate în depozit.',conditionalOnly:'Presupunerile, afirmațiile cu rezerve și afirmațiile raportate se aplică doar unei întrebări din același mesaj.',understood:(reading)=>'Am înțeles întrebarea astfel: '+reading+'. Încă nu pot calcula acest tip de răspuns.',branch:'Doar în ipotezele modelului: ',condition:'Condiție: '}
};
const textFor=language=>TEXT[language]??TEXT.en;

function unclearResult(plan,context,language){
 const reply=REPLY_LANGUAGES.includes(language)?language:'en';
 // An ambiguous message is answered with a host clarification that lists the model's candidate readings.
 const readings=plan.unclear.readings??[];
 const packet={kind:'unclear',status:'unclear',unclear_kind:plan.unclear.kind,language:reply,complete:true,next:readings.length?'choose_reading':'rephrase',...(readings.length?{readings}:{}),user_statements:[],model_assumptions:[],assumption_policy:plan.modelAssumptions};
 return {values:{},result:{kind:'cnl',language:reply,text:unclearReply(plan.unclear.kind,reply,readings),packet},trace:[{wire:plan.unclear.id,type:'unclear',epoch:0,status:'unclear'}],epochs:0,wireCount:0,outputs:{},blocked:{},generated:[],authoredSop:plan.authoredSop,executionSop:'',contextStatements:context.statements??[],problemResults:[]};
}

/**
 * User statements stay in caller-owned conversation
 * context, never in the repository. `languageSource` says whether the answer
 * language was requested (`request`/`prompt`) or defaulted (`default`).
 */
export async function runDeclarative(source,{runtime,language='en',languageSource='default',inputText='',context={}}){
 context.statements??=[];
 const policy=runtime.policy;
 const plan=compileDeclarative(source,{language,inputText,context,lexicon:runtime.lexicon,schema:runtime.schema,maxWires:policy.maxWires,modelAssumptions:policy.modelAssumptions??'report',maxModelAssumptions:policy.maxModelAssumptions??8,now:runtime.now});
 if(plan.unclear)return unclearResult(plan,context,languageSource==='default'&&plan.unclear.language?plan.unclear.language:plan.language);
 // Host linking failed (unknown or ambiguous relation, role set, time expression): ask, run nothing else.
 if(plan.issues?.length){
  const question=linkQuestion(plan.issues,plan.language);
  const clarification=canonical({wires:[node('hostClarify','clarify',{text:[JSON.stringify(question)]})]});
  const stopped=await runtime.run(clarification,{origin:'generated'});
  const report=p=>reportProposition(p,{predicate:plan.links.get(p.id)?.predicate??null,validity:plan.links.get(p.id)?.validity?.interval??null,language:plan.language});
  const packet={...stopped.result,reason:'unresolved_link',required:plan.issues,pendingSop:plan.authoredSop,next:'answer_clarification',complete:false,user_statements:plan.statements.map(report),model_assumptions:plan.assumptions.map(report),assumption_policy:plan.modelAssumptions};
  return {...stopped,result:{kind:'cnl',language:plan.language,text:question,packet},authoredSop:plan.authoredSop,executionSop:clarification,contextStatements:context.statements,problemResults:[],generated:[{kind:'clarification',epoch:0,source:clarification}]};
 }
 assert(context.statements.length+plan.evidenceIds.length<=policy.maxFacts,'Conversation statement limit');
 // A turn of reported assumptions or turn-local suppositions only has nothing to execute.
 const result=plan.executionSop?await runtime.run(plan.executionSop,{origin:'generated'}):{values:Object.create(null),result:undefined,trace:[],epochs:0,wireCount:0,outputs:{},blocked:{},generated:[]};
 const m=textFor(plan.language);
 const carriedBefore=context.statements;
 const admittedStatements=plan.evidenceIds.flatMap(name=>{const f=result.values[name];return f?.kind==='fact'?[{atom:f.atom,valid:f.valid,origin:'user-statement',text:inputText}]:[];});
 const statementKey=s=>stable([atomKey(s.atom),s.valid.from,s.valid.until]);
 const keptStatements=new Map(context.statements.map(s=>[statementKey(s),s]));
 for(const s of admittedStatements)if(!keptStatements.has(statementKey(s)))keptStatements.set(statementKey(s),s);
 context.statements=[...keptStatements.values()];
 // Host-rendered reports; `basis` and certainty are descriptive and never change admission.
 // The runtime names the k-th flattened `assume` item assume_k in proofs and defeat lists.
 const use=(packets,order,name)=>{
  const k=order.indexOf(name);if(k<0||!packets.length)return {used_in_proof:null,defeated:null};
  return {used_in_proof:packets.some(packet=>(packet?.proof??[]).some(item=>item.id==='assume_'+k)),defeated:packets.some(packet=>(packet?.defeatedAssumptions??[]).includes('assume_'+k))};
 };
 const primaryPackets=plan.problemIds.filter(p=>p.type==='query').map(p=>result.values[p.solve]).filter(Boolean);
 const reportOf=(p,extra)=>{const l=plan.links.get(p.id)??{},value=result.values[p.id];return reportProposition(p,{atom:value?.atom?emitAtom(value.atom):l.atomText??null,predicate:l.predicate??null,validity:l.validity?.interval??null,language:plan.language,extra});};
 const userStatements=plan.statements.map(p=>reportOf(p,{treatment:conditionalStatement(p)?'supposition':'evidence',conditional:conditionalStatement(p),in_circuit:Object.hasOwn(result.values,p.id),...(conditionalStatement(p)?use(primaryPackets,plan.suppositionIds,p.id):{})}));
 const branchPackets=plan.problemIds.filter(p=>p.branch).map(p=>({problem:p.declaration,packet:result.values[p.branch]}));
 const assumptionUse=p=>use(branchPackets.map(b=>b.packet).filter(Boolean),[...plan.suppositionIds,...plan.assumptionFactIds],p.id);
 const modelAssumptions=plan.assumptions.map(p=>reportOf(p,{treatment:plan.assumptionFactIds.includes(p.id)?'branched':'reported',...assumptionUse(p)}));
 const assumptionBranch=branchPackets.map(({problem,packet})=>({problem,status:packet?.status??'blocked',answers:packet?.answers??[],hypothetical:packet?.hypothetical===true,defeatedAssumptions:packet?.defeatedAssumptions??[],route:packet?.route??null,text:packet?.status?cnl(packet,plan.language).text:null}));
 const reports={user_statements:userStatements,carried_statements:carriedBefore.map(s=>({atom:emitAtom(s.atom),valid:{from:formatTime(s.valid.from),until:formatTime(s.valid.until)},certainty:'asserted',speaker:'user'})),model_assumptions:modelAssumptions,assumption_policy:plan.modelAssumptions,...(assumptionBranch.length?{assumption_branch:assumptionBranch}:{})};
 const rendered=plan.renderIds.map(name=>result.values[name]).filter(value=>value?.kind==='cnl').map((value,index)=>{
  const problem=plan.problemIds[index];
  // No model-level refusal: an understood question without an engine is reported as such (DS021).
  if(value.packet?.status!=='unsupported')return value;
  return {...value,text:m.understood(problem.reading),packet:{...value.packet,status:'not_computable',engine_status:'unsupported',understood_as:problem.reading}};
 });
 if(!plan.problemIds.length){
  const missing=plan.evidenceIds.filter(name=>!result.values[name]);
  if(!missing.length){
   const count=admittedStatements.length;
   const packet={kind:'context',status:'context_updated',complete:true,count,...reports};
   const text=[m.context(count),...(plan.statements.some(conditionalStatement)?[m.conditionalOnly]:[])].join('\n');
   result.result={kind:'cnl',language:plan.language,packet,text};
  }
 }else if(rendered.length===plan.renderIds.length){
  const decorate=(value,index)=>{
   const problem=plan.problemIds[index],lines=[value.text];
   if(value.packet?.hypothetical)for(const s of userStatements)if(s.conditional&&s.in_circuit)lines.push(m.condition+s.statement);
   for(const b of assumptionBranch)if(b.problem===problem.declaration&&b.text)lines.push(m.branch+b.text.split('\n').join(' | '));
   return lines.join('\n');
  };
  const texts=rendered.map(decorate);
  const last=rendered.at(-1);
  result.result=rendered.length===1?{...last,text:texts[0],packet:{...last.packet,...reports}}:{...last,text:texts.map((t,i)=>plan.problemIds[i].declaration+':\n'+t).join('\n\n'),packet:{...last.packet,...reports}};
 }
 const unresolved=Object.entries(result.outputs).filter(([,output])=>output.status!=='bound');
 if(unresolved.length||result.result?.status==='blocked'||(!plan.problemIds.length&&admittedStatements.length<plan.evidenceIds.length)){
  const details=unresolved.map(([name,output])=>({name,status:output.status,...(output.surface?{surface:output.surface}:{}),...(output.candidates?{candidates:output.candidates}:{})}));
  const identities=details.filter(item=>item.surface);
  const describeIdentity=item=>{
   const choices=Array.isArray(item.candidates)?item.candidates.map(candidate=>runtime.lexicon?.entities[candidate.id]?.labels?.[plan.language]??candidate.id):[];
   return JSON.stringify(item.surface)+(choices.length?' ('+choices.join(' or ')+')':'');
  };
  const question=identities.length?'Which entity do you mean by '+identities.map(describeIdentity).join(', ')+'?':
   details.some(item=>item.status==='incomplete')?'The search did not finish within its limits. Can you narrow the question?':
   'What additional condition or value determines '+details.map(item=>'?'+item.name).join(', ')+'? The current statements do not provide the unique input needed to continue.';
  const reserved=new Set([...Object.keys(result.values),...parse(plan.executionSop).wires.map(w=>w.id)]);let clarifyId='hostClarify';while(reserved.has(clarifyId))clarifyId+='Next';
  const clarification=canonical({wires:[node(clarifyId,'clarify',{text:[JSON.stringify(question)]})]});
  const stopped=await runtime.run(clarification,{origin:'generated'});
  const packet={...stopped.result,reason:'unresolved_dependency',required:details,pendingSop:plan.authoredSop,next:'answer_clarification',complete:false,...reports};
  result.result={kind:'cnl',language:plan.language,text:question,packet};
  result.generated.push({kind:'clarification',epoch:0,source:clarification});
  result.trace.push(...stopped.trace);
  Object.assign(result.values,stopped.values);
  plan.executionSop+='\n'+clarification;
 }
 return {...result,authoredSop:plan.authoredSop,executionSop:plan.executionSop,contextStatements:context.statements,problemResults:plan.problemIds.map(p=>({id:p.declaration,result:result.values[p.solve],...(p.branch?{branch:result.values[p.branch]}:{})})),generated:[{kind:'orchestration',epoch:0,source:plan.executionSop},...result.generated]};
}
