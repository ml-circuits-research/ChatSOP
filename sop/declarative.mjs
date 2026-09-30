import {parse,canonical,one,many,words,parseAtom,emitAtom,dependencies,validateGraph,unquote,isMatch,parseMatch} from './parser.mjs';
import {parseCondition,parseBooleanCondition} from './conditions.mjs';
import {emitCondition} from '../lib/conditions.mjs';
import {variable,atomKey} from '../lib/types.mjs';
import {formatTime} from '../lib/time.mjs';
import {assert,stable} from '../lib/util.mjs';
import {cnl} from './cnl.mjs';
import {propositionOf,linkProposition,propositionValidity,propositionKey,conditionalStatement,reportProposition,propositionBody,LINK_PHRASES} from './propositions.mjs';
import {normalizeTime,linkQuestion} from './linking.mjs';
import {unclearReply,REPLY_LANGUAGES} from './unclear.mjs';
import {checkModelLinks,pairPlaceholders,planLinks,expandReferences,readingWithReferences,nearOf} from './clauses.mjs';
import {repairSpan,spanQuestion} from './repair.mjs';
import {defaultDictionary} from './dictionary.mjs';
import {linksOf,roleReferences,LINK_WORDS} from './parser.mjs';

/**
 * The neural author describes problems; only this host compiler emits operations.
 * The model language (DS021) has exactly these authored wire types.
 */
export const MODEL_TYPES=Object.freeze(new Set(['stated','assumed','unclear','query','constraint','unparsed']));
const listTypes=types=>{const t=[...types];return t.slice(0,-1).join(', ')+' or '+t.at(-1);};
const node=(id,type,fields)=>({id,type,fields,line:0});
const projectionNames=w=>w.type==='query'?words(one(w,'select','')):many(w,'var').map(line=>words(line)[0]);

function checkFilter(ast){
 assert(['literal','var','unary','binary'].includes(ast.type),'Model filters describe comparisons, not executable calls or object access');
 if(ast.type==='unary')checkFilter(ast.arg);
 if(ast.type==='binary'){checkFilter(ast.left);checkFilter(ast.right);}
}

/** Admission of one model-authored wire; shared by the compiler, the agent and the evaluator. */
/** Operator symbols a model-authored expression must not spell (DS021 "Words, not operators"); quoted text is ignored. */
const OPERATOR=/[<>=!+*\/%&|()]|\s-\s/;
const unquoted=text=>String(text).replace(/"(?:\\.|[^"\\])*"/g,'""');
export function checkModelWire(w){
 assert(MODEL_TYPES.has(w.type),'Model authors '+listTypes(MODEL_TYPES)+'; '+w.type+' belongs to symbolic execution');
 assert(!dependencies(w).handles.length,'Model declarations cannot invoke definition handles');
 // The model writes words, never operator syntax: compare/except/rank/order in queries, word expressions in constraints.
 if(w.type==='query')assert(!w.fields.filter,'operator_not_words: @'+w.id+' filter is operator syntax; use compare, except or order words');
 if(w.type==='constraint')for(const text of [...many(w,'require'),...many(w,'claim'),...many(w,'objective')])assert(!OPERATOR.test(unquoted(text)),'operator_not_words: @'+w.id+' writes an operator symbol; use above, below, at_least, at_most, equal, not_equal, plus, minus, times, divided_by');
 if(w.type==='query'){
  // Model queries use string propositions (match blocks) and quoted temporal expressions.
  const partial=w.fields.fragment!==undefined;
  const leaves=[];for(const text of [...many(w,'where'),...many(w,'scope')])parseCondition(text,leaf=>{leaves.push(leaf);return {a:[]};});
  assert(leaves.every(isMatch),'query_needs_match: @'+w.id+' states each condition as a match block (relation, roles, polarity), not an atom');
  for(const key of ['at','during','asof'])if(w.fields[key])assert(/^"/.test(one(w,key)),'@'+w.id+' '+key+' takes a JSON-quoted temporal expression');
  assert(!w.fields.span,'@'+w.id+' span is host plumbing; the model asks for a time with role time ?variable');
  // "When", "since when", "how long", "how many times": at most one time variable, written as `role time ?t`.
  const times=new Set(leaves.flatMap(leaf=>parseMatch(leaf,'match',{partial}).roles.filter(role=>role.name==='time'&&typeof role.value==='string'&&role.value.startsWith('?')).map(role=>role.value)));
  // Two time variables only for a temporal order ("before or after"): `order ?t1 before ?t2` names both.
  if(w.fields.order){const [a,,b]=words(one(w,'order'));assert(times.size===2&&times.has(a)&&times.has(b),'order_needs_two_times: @'+w.id+' order compares the two time variables of its match blocks (role time ?t1, role time ?t2)');}
  else assert(times.size<=1,'time_variable_multiple: @'+w.id+' asks for more than one time; use one query per time, or order ?t1 before ?t2');
  if(w.fields.measure)assert(times.has(one(w,'select')),'measure_needs_time_variable: @'+w.id+' measure applies to the selected role time ?variable');
 }
 if(w.type==='constraint')assert(w.fields.task,'constraint_task_required: @'+w.id+' must state task prove, possible or optimize');
}
export function checkModelProgram(program){
 for(const w of program.wires)checkModelWire(w);
 if(program.wires.some(w=>w.type==='unclear'))assert(program.wires.length===1,'unclear_not_alone: unclear must be the only wire of the model output');
 // Links, `$id` role references and unparsed spans are checked across wires (DS021 "Clauses and links").
 checkModelLinks(program);
 return program;
}

/** A match-tree field value with each match leaf rewritten by `edit(proposition) -> proposition`. */
function rewriteMatches(text,edit){
 const tree=parseCondition(text,leaf=>leaf);
 const lines=[];
 const visit=node=>{
  if(typeof node==='string'){
   const p=edit(parseMatch(node,'match',{partial:true}));
   lines.push('match',...(p.relation!==undefined?['relation '+JSON.stringify(p.relation)]:[]),...p.roles.map(r=>'role '+r.name+' '+(typeof r.value==='number'||/^\?/.test(r.value)?String(r.value):JSON.stringify(r.value))),...(p.polarity?['polarity '+p.polarity]:[]),'end');
   return;
  }
  lines.push(node.kind);node.children.forEach(visit);lines.push('end');
 };
 visit(tree);return lines.join('\n');
}
/**
 * Complete an elliptical follow-up (`fragment follow_up`, DS021 Q-LANG-4) from the previous query of the
 * caller-owned conversation context: every role the fragment gives replaces the same role of the previous query
 * (or is added to its first match), a given relation or polarity replaces the first match's, and a quoted
 * `role time` becomes the query period (`during`). Returns the completed query wire, or null without context.
 */
export function completeFragment(fragment,previousText){
 if(!previousText)return null;
 const previous=parse(previousText).wires.find(w=>w.type==='query');
 if(!previous)return null;
 const given=[];for(const text of many(fragment,'where'))parseCondition(text,leaf=>{given.push(parseMatch(leaf,'match',{partial:true}));return leaf;});
 const roles=given.flatMap(p=>p.roles),relation=given.find(p=>p.relation!==undefined)?.relation,polarity=given.find(p=>p.polarity)?.polarity;
 const time=roles.find(r=>r.name==='time'&&typeof r.value==='string'&&!r.value.startsWith('?'));
 const pending=roles.filter(r=>r!==time);
 const placed=new Set();let first=true;
 const fields=Object.fromEntries(Object.entries(previous.fields).filter(([key])=>key!=='fragment').map(([key,values])=>[key,[...values]]));
 fields.where=fields.where.map(text=>rewriteMatches(text,p=>{
  const out={...p,roles:p.roles.map(r=>{const g=pending.find(x=>x.name===r.name);if(g){placed.add(g);return {name:r.name,value:g.value};}return r;})};
  if(first){first=false;if(relation!==undefined)out.relation=relation;if(polarity)out.polarity=polarity;}
  return out;
 }));
 const missing=pending.filter(r=>!placed.has(r));
 if(missing.length){let added=false;fields.where=fields.where.map(text=>rewriteMatches(text,p=>{if(added)return p;added=true;return {...p,roles:[...p.roles,...missing.filter(r=>!p.roles.some(x=>x.name===r.name))]};}));}
 if(time){delete fields.at;fields.during=[JSON.stringify(time.value)];}
 return {id:fragment.id,type:'query',fields,line:fragment.line};
}
/** Advice and modal-of-recommendation relations the host does not compute (DS021 Q-LANG-6): answered not_computable. */
export const ADVICE_MODALS=Object.freeze(['should','ought to','had better','be worth','be a good idea to','be advisable to']);
const isAdvice=relation=>{const t=' '+String(relation).toLowerCase().replace(/\s+/g,' ')+' ';return ADVICE_MODALS.some(m=>t.startsWith(' '+m+' ')||t.includes(' '+m+' '));};
/** A reference to the user (DS021 Q-LANG-5): "the user" is linked to the caller identity when the caller supplies one. */
const USER_SURFACES=new Set(['the user','user']);

/** Toggle the negation prefix of a linked atom text (`unless` scopes the negation of its clause). */
const toggleNegation=text=>text.startsWith('not ')?text.slice(4):'not '+text;
const REFERENCE_VALUE=value=>value&&typeof value==='object'&&value.ref;

export function compileDeclarative(source,{language='en',inputText='',context={},lexicon=null,schema=null,maxWires=2048,modelAssumptions='report',maxModelAssumptions=8,now=Date.now(),dictionary}={}){
 // The bilingual and synonym dictionary (DS021 "Content words"); null disables it (the strict evaluation link).
 const dict=dictionary===undefined?defaultDictionary():dictionary;
 let authored=checkModelProgram(parse(source,{maxWires}));
 // An elliptical follow-up is completed from the previous query of the conversation, or clarified (Q-LANG-4).
 const fragment=authored.wires.find(w=>w.type==='query'&&w.fields.fragment);
 if(fragment){
  const completed=completeFragment(fragment,context.lastQuery);
  if(!completed){
   const given=[];for(const text of many(fragment,'where'))parseCondition(text,leaf=>{given.push(parseMatch(leaf,'match',{partial:true}));return leaf;});
   const lang0=/^[a-z]{2,3}$/.test(language)&&language!=='auto'?language:'en';
   return {problemIds:[],renderIds:[],statements:[],assumptions:[],links:new Map(),evidenceIds:[],suppositionIds:[],assumptionFactIds:[],modelAssumptions,language:lang0,inputText,authoredSop:canonical(authored),executionSop:'',
    clauseLinks:[],translations:[],untranslated:[],repairs:[],unresolvedSpans:[],held:new Set(),reportOnly:new Set(),
    fragment:{id:fragment.id,values:given.flatMap(p=>p.roles.map(r=>r.value)).filter(v=>typeof v!=='string'||!v.startsWith('?')),relation:given.find(p=>p.relation!==undefined)?.relation??null}};
  }
  authored={wires:authored.wires.map(w=>w===fragment?completed:w)};
  checkModelProgram(parse(canonical(authored),{maxWires}));
 }
 const statementsIn=context.statements??[];
 assert(Array.isArray(statementsIn),'Context statements must be an array');
 assert(['report','branch'].includes(modelAssumptions),'Host policy modelAssumptions must be report or branch');
 const lang=/^[a-z]{2,3}$/.test(language)&&language!=='auto'?language:'en';
 const translations=[],untranslated=[],repairs=[],unresolvedSpans=[];
 const empty={problemIds:[],renderIds:[],statements:[],assumptions:[],links:new Map(),evidenceIds:[],suppositionIds:[],assumptionFactIds:[],modelAssumptions,language:lang,inputText,
  clauseLinks:[],translations,untranslated,repairs,unresolvedSpans,held:new Set(),reportOnly:new Set()};
 if(fragment)empty.completedFragment=canonical({wires:[authored.wires.find(w=>w.id===fragment.id)]});
 const unclear=authored.wires.find(w=>w.type==='unclear');
 if(unclear)return {...empty,unclear:{id:unclear.id,kind:one(unclear,'kind'),language:one(unclear,'language',null),readings:many(unclear,'reading').map(unquote)},authoredSop:canonical(authored),executionSop:''};
 const authoredById=new Map(authored.wires.map(w=>[w.id,w]));

 // 1. Unparsed spans (DS021 "Honest partial formalization"): symbolic repair before linking. A resolved span fills the
 // placeholder it is paired with; an unresolved one becomes one clarification question and holds back its wire.
 const pairs=pairPlaceholders(authored),fills=new Map(),periodFills=new Map(),held=new Set(),relationSpans=new Map();
 for(const u of authored.wires.filter(w=>w.type==='unparsed')){
  const span=unquote(one(u,'span')),hint=one(u,'hint',null),near=nearOf(u),pair=pairs.byUnparsed.get(u.id)??null;
  const base={unparsed:u.id,span,hint,near,...(pair?{wire:pair.wire,role:pair.role}:{})};
  if(hint==='relation'&&near&&!pair){if(!relationSpans.has(near))relationSpans.set(near,[]);relationSpans.get(near).push(base);continue;}
  const repaired=repairSpan(span,{hint,lexicon,dictionary:dict,context,now});
  if(repaired){
   repairs.push({...base,method:repaired.method,value:repaired.value,filled:!!pair});
   // A repaired time in a query's `role time ?t` placeholder is the query period (like `during "…"`), not an argument.
   if(pair&&repaired.method==='time'&&authoredById.get(pair.wire)?.type==='query')periodFills.set(pair.wire,{variable:pair.variable,text:repaired.value});
   else if(pair){if(!fills.has(pair.wire))fills.set(pair.wire,new Map());fills.get(pair.wire).set(pair.variable,repaired.value);}
  }else{unresolvedSpans.push({...base,blocking:!!pair,question:spanQuestion(span,hint,lang)});if(pair)held.add(pair.wire);}
 }
 const valueToken=v=>typeof v==='number'?String(v):JSON.stringify(v);
 const fillWire=w=>{const map=fills.get(w.id);if(!map)return w;return {...w,fields:Object.fromEntries(Object.entries(w.fields).map(([k,vs])=>[k,vs.map(text=>String(text).replace(/"(?:\\.|[^"\\])*"|\?[A-Za-z][A-Za-z0-9_]*/g,t=>t.startsWith('?')&&map.has(t)?valueToken(map.get(t)):t))]))};};
 const fillPeriod=w=>{const f=periodFills.get(w.id);if(!f)return w;const drop=new RegExp('^\\s*role time \\'+f.variable+'\\s*$');const fields={...w.fields,where:many(w,'where').map(text=>String(text).split('\n').filter(line=>!drop.test(line)).join('\n'))};if(!w.fields.at&&!w.fields.during)fields.during=[JSON.stringify(f.text)];return {...w,fields};};
 let work=authored.wires.filter(w=>w.type!=='unparsed').map(fillWire).map(fillPeriod);
 // A wire that needs a held wire (its proposition as an argument, the answers of a held query, or a held condition) is held too.
 for(let changed=true;changed;){changed=false;for(const w of work){if(held.has(w.id))continue;const needs=[...roleReferences(w).map(r=>r.target),...(w.type==='query'?linksOf(w).filter(l=>l.keyword==='if'||l.keyword==='unless').map(l=>l.target):[])];if(needs.some(id=>held.has(id))){held.add(w.id);changed=true;}}}
 // 2. Wire references: `$q` becomes a join (query chaining, L3); a proposition argument `$s` has no engine.
 const expanded=expandReferences(work);work=expanded.wires;
 // 3. Clause links (L4): conditions scope their query, timed temporal links bound the query period, the rest is reported.
 const plan=planLinks(work,{now});
 const workById=new Map(work.map(w=>[w.id,w]));
 // Problems the host understands but does not compute: advice questions (Q-LANG-6), arithmetic with division or decimals
 // (Q-LANG-7) and questions over a proposition used as an argument (`$s`).
 const notComputable=work.filter(w=>!held.has(w.id)&&((w.type==='query'&&(expanded.eventQueries.has(w.id)||[...many(w,'where'),...many(w,'scope')].some(text=>{let advice=false;parseCondition(text,leaf=>{const p=parseMatch(leaf,'match',{partial:true});if(p.relation&&isAdvice(p.relation))advice=true;return leaf;});return advice;})))
  ||(w.type==='constraint'&&[...many(w,'require'),...many(w,'claim'),...many(w,'objective')].some(text=>/\bdivided_by\b|(?:^|\s)-?\d+\.\d+(?:\s|$)/.test(unquoted(text))))))
  .map(w=>({declaration:w.id,type:w.type,reading:expanded.eventQueries.has(w.id)?readingWithReferences(authoredById.get(w.id),authoredById):canonical({wires:[authoredById.get(w.id)??w]}).trim().split('\n').map(line=>line.trim()).join('; ')}));
 const skipped=new Set([...notComputable.map(item=>item.declaration),...held]);
 empty.notComputable=notComputable;
 const statements=work.filter(w=>w.type==='stated').map(propositionOf),assumptions=work.filter(w=>w.type==='assumed').map(propositionOf);
 assert(assumptions.length<=maxModelAssumptions,'too_many_assumptions: '+assumptions.length+' model assumptions exceed the host limit of '+maxModelAssumptions);
 const statedKeys=new Set();
 for(const p of statements){const key=stable([propositionKey(p),p.certainty,p.speaker]);assert(!statedKeys.has(key),'stated_duplicate: @'+p.id+' repeats an identical statement');statedKeys.add(key);}
 const plainStated=new Set(statements.map(propositionKey));
 for(const p of assumptions)assert(!plainStated.has(propositionKey(p)),'assumed_duplicates_stated: @'+p.id+' repeats a statement of this turn; the assumption is redundant');
 // Statements the host reports without using them: a proposition over another proposition (`$s`), a statement that
 // carries its own condition (`if`/`unless`: conditional, never evidence) and a statement held by an unresolved span.
 const conditionalCarriers=new Set(work.filter(w=>(w.type==='stated'||w.type==='assumed')&&linksOf(w).some(l=>l.keyword==='if'||l.keyword==='unless')).map(w=>w.id));
 const reportOnly=new Set([...expanded.eventStatements,...conditionalCarriers,...[...held].filter(id=>['stated','assumed'].includes(workById.get(id)?.type))]);
 // Host linking (DS021): strings become predicates, atoms, entity lookups and intervals; failures become one host clarification.
 // A relation phrase that does not link is retried with its dictionary translations and synonyms; the lexicon decides.
 const issues=[],links=new Map();
 const anonymous=new Set(work.flatMap(w=>Object.values(w.fields).flat().flatMap(text=>String(text).match(/\?[A-Za-z][A-Za-z0-9_]*/g)??[])));
 let freshSerial=0;const fresh=()=>{let name;do{name='?host_any'+freshSerial++;}while(anonymous.has(name));anonymous.add(name);return name;};
 const noteUntranslated=item=>{if(!untranslated.some(x=>x.wire===item.wire&&x.field===item.field&&x.text===item.text))untranslated.push(item);};
 const tryLink=(p,options,wire)=>{
  if(!lexicon)return {issue:{kind:'relation',status:'unknown',text:p.relation}};
  const first=linkProposition(p,lexicon,options);
  if(!first.issue||!dict||p.relation===undefined)return first;
  // Tiers, in order: the dictionary's canonical English translation, its other translations, English synonyms, then
  // the phrases of an unparsed relation span near this wire. The first tier that links to exactly one predicate wins;
  // two predicates in one tier are ambiguous (the host asks); the dictionary never picks between them.
  const c=dict.candidates(p.relation,'relation'),translated=c.status==='translated'?c.candidates:[];
  if(c.status==='untranslated')noteUntranslated({wire,field:'relation',text:p.relation,tokens:c.untranslated});
  const tiers=[translated.slice(0,1).map(text=>({text,source:'dictionary'})),translated.slice(1).map(text=>({text,source:'dictionary'})),
   [p.relation,...translated].flatMap(x=>dict.synonyms(x,'relation')).map(text=>({text,source:'synonym'})),
   (relationSpans.get(wire)??[]).flatMap(span=>{const d=dict.candidates(span.span,'relation');return (d.status==='translated'?d.candidates:[span.span]).map(text=>({text,source:'unparsed_span'}));})];
  for(const tier of tiers){
   const bound=new Map();
   for(const alt of tier){if(alt.text===p.relation)continue;const l=linkProposition({...p,relation:alt.text},lexicon,options);if(!l.issue&&!bound.has(l.predicate))bound.set(l.predicate,{l,alt});}
   if(bound.size===1){const [{l,alt}]=bound.values();if(!translations.some(t=>t.wire===wire&&t.from===p.relation))translations.push({wire,field:'relation',from:p.relation,to:alt.text,source:alt.source,predicate:l.predicate});return l;}
   if(bound.size>1)return {issue:{kind:'relation',status:'ambiguous',text:p.relation,candidates:[...bound.values()].map(({l})=>({id:l.predicate,roles:[]}))}};
  }
  return first;
 };
 const link=(p,options,wire)=>{const linked=tryLink(p,options,wire);if(linked.issue){issues.push(linked.issue);return null;}return linked;};
 const hasPlaceholder=p=>p.roles.some(r=>typeof r.value==='string'&&r.value.startsWith('?')||REFERENCE_VALUE(r.value));
 for(const p of [...statements,...assumptions]){
  const validity=propositionValidity(p,now);
  const quiet=reportOnly.has(p.id)||(p.type==='assumed'&&modelAssumptions!=='branch');
  if(!quiet)issues.push(...validity.issues);
  // In report mode an assumption is linked only for the report; it never blocks the turn. So is a reported statement.
  const linked=hasPlaceholder(p)?{}:quiet?(lexicon?tryLink(p,{},p.id):{}):link(p,{},p.id);
  links.set(p.id,{...(linked?.issue?{}:linked??{}),validity:validity.issues.length?null:validity});
 }
 const temporal=(w,key)=>{
  const text=unquote(one(w,key)),period=normalizeTime(text,now);
  if(!period){issues.push({kind:'time',status:'unknown',text});return null;}
  return key==='during'?formatTime(period.from)+' '+formatTime(period.until):formatTime(period.from);
 };
 const used=new Set(authored.wires.map(w=>w.id));
 const requestedRefs=new Set(work.filter(w=>w.type==='constraint'||w.type==='query').flatMap(w=>dependencies(w).values).filter(name=>!used.has(name)));
 const outputs=new Map(),providers=new Map();
 for(const w of work)if(w.type==='query'||w.type==='constraint')for(const v of projectionNames(w)){
  if(!providers.has(v.slice(1)))providers.set(v.slice(1),[]);
  providers.get(v.slice(1)).push(w);
 }
 const exportValue=(name,owner)=>{
  assert(!used.has(name),'Projected scalar conflicts with declaration @'+name);
  assert(!outputs.has(name)||outputs.get(name)===owner.id,'Scalar $'+name+' has multiple producing problems');
  outputs.set(name,owner.id);
 };
 for(const name of requestedRefs){
  const choices=providers.get(name)??[];
  assert(choices.length===1,'Reference $'+name+' needs exactly one declaring problem');
  exportValue(name,choices[0]);
 }
 for(const w of work)if(w.type==='constraint')for(const v of words(one(w,'select',''))){
  assert(/^\?[a-z][a-z0-9_]*$/.test(v),'Constraint select needs ?variables');
  exportValue(v.slice(1),w);
 }
 for(const name of outputs.keys())used.add(name);
 const reservedRoots=new Set([...used].map(name=>name.split('__')[0]));let serial=0;
 const id=()=>{let name;do{name='host'+serial++;}while(reservedRoots.has(name));used.add(name);reservedRoots.add(name);return name;};
 const resolutions=[],resolved=new Map(),execution=[],problemIds=[],renderIds=[];
 // Type-checks canonical entity arguments; with resolve=true a quoted surface becomes a generated resolve wire.
 // A surface the lexicon does not know is retried with its dictionary translations; the lexicon must accept exactly one.
 const normalizeAtom=(text,{resolve=true,wire=null}={})=>{
  const a=parseAtom(text);
  if(lexicon)for(let i=0;i<a.a.length;i++){
   let term=a.a[i];const type=(schema??lexicon.predicates)?.[a.p]?.args?.[i];
   // "the user" is the caller when the caller-owned context names its entity (Q-LANG-5); otherwise it resolves like any surface.
   if(typeof term==='string'&&context.user&&USER_SURFACES.has(term.trim().toLowerCase())){a.a[i]=context.user;continue;}
   if(typeof term!=='string'||variable(term)||!type||['integer','value'].includes(type))continue;
   const known=lexicon.entities[term];
   if(known){assert(type==='entity'||known.entityType===type,'Entity type does not match '+a.p+' argument');continue;}
   if(!resolve)continue;
   const scope={language:lang,kind:'entity',...(type==='entity'?{}:{type})};
   let local=lexicon.matching(term,scope),any=local.found.length?local:lexicon.matching(term,{...scope,language:'auto'});
   if(!any.found.length&&dict){
    const c=dict.candidates(term,'value');
    if(c.status==='translated'){
     const hits=c.candidates.filter(x=>lexicon.matching(x,{...scope,language:'auto'}).found.length===1);
     if(hits.length===1){if(!translations.some(t=>t.wire===wire&&t.from===term))translations.push({wire,field:'value',from:term,to:hits[0],source:'dictionary'});term=hits[0];local=lexicon.matching(term,scope);any=local.found.length?local:lexicon.matching(term,{...scope,language:'auto'});}
    }else if(c.status==='untranslated')noteUntranslated({wire,field:'value',text:term,tokens:c.untranslated});
   }
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
 const hasQuery=work.some(w=>w.type==='query'&&!skipped.has(w.id)),branch=modelAssumptions==='branch'&&hasQuery;
 // Asserted user statements of earlier turns are re-supplied as turn-local user facts, never stored.
 const carriedIds=[];
 for(const s of statementsIn){
  assert(s.origin==='user-statement','Only attributed user statements are carried across turns');
  const name=id();carriedIds.push(name);
  execution.push(node(name,'fact',{holds:[emitAtom(s.atom)],valid:[formatTime(s.valid.from)+' '+formatTime(s.valid.until)],source:['user']}));
 }
 const evidenceIds=[],suppositionIds=[],assumptionFactIds=[],byId=new Map([...statements,...assumptions].map(p=>[p.id,p]));
 // `unless $s` scopes the negation of the clause: the supposition lowered for that query is the negated atom.
 const fact=(w,source)=>{const l=links.get(w.id),atomText=plan.negated.has(w.id)?toggleNegation(l.atomText):l.atomText;return node(w.id,'fact',{holds:[normalizeAtom(atomText,{wire:w.id})],valid:[l.validity.text],source:[source]});};
 const linkedQueries=new Set();
 for(const w of work){
  if(skipped.has(w.id))continue;
  if(w.type==='stated'||w.type==='assumed'){
   if(reportOnly.has(w.id))continue;
   const p=byId.get(w.id),l=links.get(w.id);
   if(!l.atomText||!l.validity)continue;
   if(w.type==='stated'&&!conditionalStatement(p)){execution.push(fact(w,'user'));evidenceIds.push(w.id);}
   else if(w.type==='stated'&&hasQuery){execution.push(fact(w,'assumption'));suppositionIds.push(w.id);}
   else if(w.type==='assumed'&&branch){execution.push(fact(w,'assumption'));assumptionFactIds.push(w.id);}
   else if(w.type==='stated')normalizeAtom(l.atomText,{resolve:false,wire:w.id});
   continue;
  }
  const fields=Object.fromEntries(Object.entries(w.fields).filter(([key])=>!LINK_WORDS.includes(key)).map(([key,values])=>[key,[...values]]));
  if(w.type==='query'){
   const spans=new Set(),spanLeaf=new Map();let leafIndex=0,failed=false;
   const leaf=text=>{const index=leafIndex++;const l=link(parseMatch(text,'@'+w.id+' match'),{exact:false,fresh},w.id);if(!l)failed=true;if(l?.span){spans.add(l.span);spanLeaf.set(l.span,index);}return parseAtom(l?normalizeAtom(l.atomText,{wire:w.id}):'unlinked x');};
   fields.where=many(w,'where').map(text=>emitCondition(parseCondition(text,leaf),emitAtom));
   if(w.fields.scope)fields.scope=[emitCondition(parseCondition(one(w,'scope'),leaf),emitAtom)];
   if(!failed)linkedQueries.add(w.id);
   if(w.fields.order){
    // Temporal order (Q-LANG-3): each time variable is the validity interval of its own match; the host records which.
    const [a,relation,b]=words(one(w,'order'));
    if(spanLeaf.has(a)&&spanLeaf.has(b))fields.order=[a+' '+relation+' '+b+' leaves '+spanLeaf.get(a)+' '+spanLeaf.get(b)];
    else issues.push({kind:'time',status:'not_an_interval',text:[a,b].filter(v=>!spanLeaf.has(v)).join(' ')});
   }
   // A time variable of a relation without a time role is the matched validity interval (host `span`).
   else if(spans.size)fields.span=[...spans];
   if(w.fields.measure&&!spans.has(one(w,'select')))issues.push({kind:'time',status:'not_an_interval',text:one(w,'select')});
   // A quoted literal of filter, compare or except is an entity as written ("besides Ana"): the host resolves it like
   // any role value; a compared string that names no entity ("2380 lei") stays a value.
   const literal=(text,{valueAllowed=false}={})=>text.replace(/"(?:\\.|[^"\\])*"/g,quoted=>{
    const surface=JSON.parse(quoted);if(!lexicon)return quoted;
    if(context.user&&USER_SURFACES.has(surface.trim().toLowerCase()))return JSON.stringify(context.user);
    const found=lexicon.matching(surface,{language:lang,kind:'entity'}),any=found.found.length?found:lexicon.matching(surface,{language:'auto',kind:'entity'});
    if(any.found.length===1)return JSON.stringify(any.found[0].id);
    if(!any.found.length&&valueAllowed)return quoted;
    issues.push({kind:'entity',status:any.found.length?'ambiguous':'unknown',text:surface,candidates:any.found.map(e=>({id:e.id,roles:[]}))});return quoted;
   });
   if(w.fields.filter)fields.filter=many(w,'filter').map(text=>literal(text));
   if(w.fields.except)fields.except=many(w,'except').map(text=>literal(text));
   if(w.fields.compare)fields.compare=many(w,'compare').map(text=>literal(text,{valueAllowed:true}));
   for(const key of ['at','during','asof'])if(w.fields[key]){const value=temporal(w,key);if(value)fields[key]=[value];}
   // A timed before/after/when link bounds the query period (L4): until, from or during the linked clause's time.
   const period=plan.periods.get(w.id);
   if(period)fields.during=[formatTime(period.from)+' '+formatTime(period.until)];
  }
  execution.push({...w,fields});
 }
 // A relation span (`unparsed … hint relation`) is repaired when its wire linked, through the span or its own phrase.
 for(const [wire,spans] of relationSpans)for(const span of spans){
  const via=translations.find(t=>t.wire===wire&&t.source==='unparsed_span'),ok=via||links.get(wire)?.predicate||linkedQueries.has(wire);
  if(ok)repairs.push({...span,method:via?'dictionary':'near_wire_linked',value:via?.to??null,filled:!!via});
  else unresolvedSpans.push({...span,blocking:false,question:spanQuestion(span.span,span.hint,lang)});
 }
 const report={clauseLinks:plan.links,joins:expanded.joins,translations,untranslated,repairs,unresolvedSpans,held,reportOnly};
 if(issues.length)return {...empty,...report,authoredSop:canonical(authored),executionSop:'',issues,statements,assumptions,links};
 const collect=ids=>{if(!ids.length)return undefined;if(ids.length===1)return '$'+ids[0];const name=id();execution.push(node(name,'pack',{items:ids.map(n=>'$'+n)}));return '$'+name;};
 const evidenceRef=collect([...carriedIds,...evidenceIds]);
 // A supposition named by an `if`/`unless` link applies only to the queries that name it; the others apply to every query.
 const assumeFor=q=>suppositionIds.filter(s=>!plan.scoped.has(s)||(plan.conditions.get(q)??[]).includes(s));
 const packs=new Map();const collectOnce=ids=>{const key=ids.join(' ');if(!packs.has(key))packs.set(key,collect(ids));return packs.get(key);};
 for(const w of work)if((w.type==='query'||w.type==='constraint')&&!skipped.has(w.id)){
  const solveId=id(),renderId=id(),fields={[w.type]:['$'+w.id]};
  const assumeIds=w.type==='query'?assumeFor(w.id):[];
  if(w.type==='query'){if(evidenceRef)fields.data=[evidenceRef];const suppositionRef=collectOnce(assumeIds);if(suppositionRef)fields.assume=[suppositionRef];}
  const projected=[...outputs].filter(([,owner])=>owner===w.id).map(([name])=>'?'+name+' one');
  if(projected.length)fields.output=projected;
  execution.push(node(solveId,'solve',fields),node(renderId,'cnl',{result:['$'+solveId],language:[lang]}));
  // The branch is an additional hypothetical solve; the primary answer never uses model assumptions.
  let branchId=null;const branchIds=[...assumeIds,...assumptionFactIds];
  if(w.type==='query'&&branch&&assumptionFactIds.length){branchId=id();const b={query:['$'+w.id],assume:[collectOnce(branchIds)]};if(evidenceRef)b.data=[evidenceRef];execution.push(node(branchId,'solve',b));}
  problemIds.push({declaration:w.id,type:w.type,solve:solveId,render:renderId,branch:branchId,assume:assumeIds,branchAssume:branchId?branchIds:[],reading:canonical({wires:[authoredById.get(w.id)??w]}).trim().split('\n').map(line=>line.trim()).join('; ')});renderIds.push(renderId);
 }
 const program={wires:[...resolutions,...execution]};
 assert(program.wires.length<=maxWires,'Generated circuit exceeds wire budget');validateGraph(program);
 return {...empty,...report,authoredSop:canonical(authored),executionSop:program.wires.length?canonical(program):'',carriedIds,problemIds,renderIds,statements,assumptions,links,evidenceIds,suppositionIds,assumptionFactIds};
}

const TEXT={
 en:{context:n=>'Noted '+n+' statement(s) for this conversation; they are not stored in the repository.',conditionalOnly:'Suppositions, hedged claims and reported claims apply only to a question in the same message.',understood:(reading)=>'I understood the question as: '+reading+'. I cannot compute this kind of answer yet.',branch:'Only under the model\'s assumptions: ',condition:'Condition: ',notChecked:'Not checked: '},
 ro:{context:n=>'Am reținut '+n+' afirmație/afirmații pentru această conversație; nu sunt înregistrate în depozit.',conditionalOnly:'Presupunerile, afirmațiile cu rezerve și afirmațiile raportate se aplică doar unei întrebări din același mesaj.',understood:(reading)=>'Am înțeles întrebarea astfel: '+reading+'. Încă nu pot calcula acest tip de răspuns.',branch:'Doar în ipotezele modelului: ',condition:'Condiție: ',notChecked:'Neverificat: '}
};
const textFor=language=>TEXT[language]??TEXT.en;

function unclearResult(plan,context,language){
 const reply=REPLY_LANGUAGES.includes(language)?language:'en';
 // An ambiguous message is answered with a host clarification that lists the model's candidate readings.
 const readings=plan.unclear.readings??[];
 const packet={kind:'unclear',status:'unclear',unclear_kind:plan.unclear.kind,language:reply,complete:true,next:readings.length?'choose_reading':'rephrase',...(readings.length?{readings}:{}),user_statements:[],model_assumptions:[],assumption_policy:plan.modelAssumptions};
 return {values:{},result:{kind:'cnl',language:reply,text:unclearReply(plan.unclear.kind,reply,readings),packet},trace:[{wire:plan.unclear.id,type:'unclear',epoch:0,status:'unclear'}],epochs:0,wireCount:0,outputs:{},blocked:{},generated:[],authoredSop:plan.authoredSop,executionSop:'',contextStatements:context.statements??[],problemResults:[]};
}

/** Links of one wire, each with its target proposition (for the host sentence). */
function linksFor(plan,id){
 const byId=new Map([...plan.statements,...plan.assumptions].map(p=>[p.id,p]));
 return (plan.clauseLinks??[]).filter(l=>l.from===id).map(l=>({...l,target:byId.get(l.to)??null}));
}
/** Packet fields of the clause links, the content-word translation and the unparsed-span repair (DS021). */
function languageReports(plan){
 return {clause_links:(plan.clauseLinks??[]).map(l=>({...l})),untranslated:plan.untranslated??[],translations:plan.translations??[],repairs:plan.repairs??[],unresolved_spans:plan.unresolvedSpans??[]};
}

/**
 * User statements stay in caller-owned conversation
 * context, never in the repository. `languageSource` says whether the answer
 * language was requested (`request`/`prompt`) or defaulted (`default`).
 */
export async function runDeclarative(source,{runtime,language='en',languageSource='default',inputText='',context={}}){
 context.statements??=[];
 const policy=runtime.policy;
 const plan=compileDeclarative(source,{language,inputText,context,lexicon:runtime.lexicon,schema:runtime.schema,maxWires:policy.maxWires,modelAssumptions:policy.modelAssumptions??'report',maxModelAssumptions:policy.maxModelAssumptions??8,now:runtime.now,...(policy.dictionary===false?{dictionary:null}:{})});
 if(plan.unclear)return unclearResult(plan,context,languageSource==='default'&&plan.unclear.language?plan.unclear.language:plan.language);
 // An elliptical follow-up without a previous question in the conversation: ask what it is about (Q-LANG-4).
 if(plan.fragment){
  const ro=plan.language==='ro',about=plan.fragment.values.map(v=>typeof v==='string'?v:String(v)).join(ro?' și ':' and ');
  const question=about?(ro?'Ce doriți să aflați despre '+about+'?':'What would you like to know about '+about+'?'):(ro?'La ce întrebare se referă „'+(plan.fragment.relation??'')+'”?':'Which question does "'+(plan.fragment.relation??'')+'" continue?');
  const clarification=canonical({wires:[node('hostClarify','clarify',{text:[JSON.stringify(question)]})]});
  const stopped=await runtime.run(clarification,{origin:'generated'});
  const packet={...stopped.result,reason:'fragment_without_context',fragment:plan.fragment,pendingSop:plan.authoredSop,next:'answer_clarification',complete:false,user_statements:[],model_assumptions:[],assumption_policy:plan.modelAssumptions};
  return {...stopped,result:{kind:'cnl',language:plan.language,text:question,packet},authoredSop:plan.authoredSop,executionSop:clarification,contextStatements:context.statements,problemResults:[],generated:[{kind:'clarification',epoch:0,source:clarification}]};
 }
 // Host linking failed (unknown or ambiguous relation, role set, time expression): ask, run nothing else.
 if(plan.issues?.length){
  const question=[linkQuestion(plan.issues,plan.language),...plan.unresolvedSpans.map(span=>span.question)].join(' ');
  const clarification=canonical({wires:[node('hostClarify','clarify',{text:[JSON.stringify(question)]})]});
  const stopped=await runtime.run(clarification,{origin:'generated'});
  const report=p=>reportProposition(p,{predicate:plan.links.get(p.id)?.predicate??null,validity:plan.links.get(p.id)?.validity?.interval??null,language:plan.language,links:linksFor(plan,p.id)});
  const packet={...stopped.result,reason:'unresolved_link',required:plan.issues,pendingSop:plan.authoredSop,next:'answer_clarification',complete:false,user_statements:plan.statements.map(report),model_assumptions:plan.assumptions.map(report),assumption_policy:plan.modelAssumptions,...languageReports(plan)};
  return {...stopped,result:{kind:'cnl',language:plan.language,text:question,packet},authoredSop:plan.authoredSop,executionSop:clarification,contextStatements:context.statements,problemResults:[],generated:[{kind:'clarification',epoch:0,source:clarification}]};
 }
 // Every problem waits for an unparsed span the host could not repair: one targeted question per span, nothing else runs.
 const blockingSpans=plan.unresolvedSpans.filter(span=>span.blocking);
 if(blockingSpans.length&&!plan.problemIds.length&&!(plan.notComputable??[]).length&&!plan.evidenceIds.length){
  const question=plan.unresolvedSpans.map(span=>span.question).join(' ');
  const clarification=canonical({wires:[node('hostClarify','clarify',{text:[JSON.stringify(question)]})]});
  const stopped=await runtime.run(clarification,{origin:'generated'});
  const report=p=>reportProposition(p,{predicate:plan.links.get(p.id)?.predicate??null,validity:plan.links.get(p.id)?.validity?.interval??null,language:plan.language,links:linksFor(plan,p.id),extra:plan.held.has(p.id)?{treatment:'incomplete'}:{}});
  const packet={...stopped.result,reason:'unresolved_span',required:blockingSpans,pendingSop:plan.authoredSop,next:'answer_clarification',complete:false,user_statements:plan.statements.map(report),model_assumptions:plan.assumptions.map(report),assumption_policy:plan.modelAssumptions,...languageReports(plan)};
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
 // Each query assumes its own supposition list (a condition named by `if`/`unless` scopes to its query), so each packet
 // is read with its own order.
 const usedBy=(runs,name)=>{
  const relevant=runs.filter(r=>r.packet&&r.order.includes(name));
  if(!relevant.length)return {used_in_proof:null,defeated:null};
  const hit=(r,list)=>list.some(item=>item==='assume_'+r.order.indexOf(name));
  return {used_in_proof:relevant.some(r=>hit(r,(r.packet.proof??[]).map(item=>item.id))),defeated:relevant.some(r=>hit(r,r.packet.defeatedAssumptions??[]))};
 };
 const primaryRuns=plan.problemIds.filter(p=>p.type==='query').map(p=>({packet:result.values[p.solve],order:p.assume}));
 const reportOf=(p,extra)=>{const l=plan.links.get(p.id)??{},value=result.values[p.id];return reportProposition(p,{atom:value?.atom?emitAtom(value.atom):l.atomText??null,predicate:l.predicate??null,validity:l.validity?.interval??null,language:plan.language,extra,links:linksFor(plan,p.id)});};
 const treatmentOf=p=>plan.held.has(p.id)?'incomplete':plan.reportOnly.has(p.id)?(plan.clauseLinks.some(l=>l.from===p.id&&(l.keyword==='if'||l.keyword==='unless'))?'conditional_statement':'reported'):conditionalStatement(p)?'supposition':'evidence';
 const userStatements=plan.statements.map(p=>reportOf(p,{treatment:treatmentOf(p),conditional:conditionalStatement(p)||plan.reportOnly.has(p.id),in_circuit:Object.hasOwn(result.values,p.id),...(conditionalStatement(p)&&!plan.reportOnly.has(p.id)?usedBy(primaryRuns,p.id):{})}));
 const branchPackets=plan.problemIds.filter(p=>p.branch).map(p=>({problem:p.declaration,packet:result.values[p.branch],order:p.branchAssume}));
 const assumptionUse=p=>usedBy(branchPackets,p.id);
 const modelAssumptions=plan.assumptions.map(p=>reportOf(p,{treatment:plan.held.has(p.id)?'incomplete':plan.assumptionFactIds.includes(p.id)?'branched':'reported',...assumptionUse(p)}));
 const assumptionBranch=branchPackets.map(({problem,packet})=>({problem,status:packet?.status??'blocked',answers:packet?.answers??[],hypothetical:packet?.hypothetical===true,defeatedAssumptions:packet?.defeatedAssumptions??[],route:packet?.route??null,text:packet?.status?cnl(packet,plan.language).text:null}));
 const reports={user_statements:userStatements,carried_statements:carriedBefore.map(s=>({atom:emitAtom(s.atom),valid:{from:formatTime(s.valid.from),until:formatTime(s.valid.until)},certainty:'asserted',speaker:'user'})),model_assumptions:modelAssumptions,assumption_policy:plan.modelAssumptions,...(assumptionBranch.length?{assumption_branch:assumptionBranch}:{}),...languageReports(plan)};
 const rendered=plan.renderIds.map(name=>result.values[name]).filter(value=>value?.kind==='cnl').map((value,index)=>{
  const problem=plan.problemIds[index];
  // No model-level refusal: an understood question without an engine is reported as such (DS021).
  if(value.packet?.status!=='unsupported')return value;
  return {...value,text:m.understood(problem.reading),packet:{...value.packet,status:'not_computable',engine_status:'unsupported',understood_as:problem.reading}};
 });
 // Problems understood but not computed by the host (advice, division, decimals): reported as not_computable (Q-LANG-6, Q-LANG-7).
 const notComputable=(plan.notComputable??[]).map(item=>({declaration:item.declaration,text:m.understood(item.reading),packet:{kind:item.type,status:'not_computable',engine_status:'not_computable',understood_as:item.reading,complete:true}}));
 if(!plan.problemIds.length&&notComputable.length){
  const last=notComputable.at(-1);
  result.result={kind:'cnl',language:plan.language,text:notComputable.length===1?last.text:notComputable.map(item=>item.declaration+':\n'+item.text).join('\n\n'),packet:{...last.packet,...reports}};
 }else if(!plan.problemIds.length){
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
   if(value.packet?.hypothetical)for(const s of userStatements)if(s.conditional&&s.in_circuit&&problem.assume.includes(s.id))lines.push(m.condition+s.statement);
   // Links of this question that no engine checks are reported with the answer (L4).
   for(const l of linksFor(plan,problem.declaration))if(l.status==='not_checked')lines.push(m.notChecked+(LINK_PHRASES[plan.language]??LINK_PHRASES.en)[l.keyword]+': '+(l.target?propositionBody(l.target,plan.language):'$'+l.to));
   for(const b of assumptionBranch)if(b.problem===problem.declaration&&b.text)lines.push(m.branch+b.text.split('\n').join(' | '));
   return lines.join('\n');
  };
  const texts=rendered.map(decorate);
  const last=rendered.at(-1);
  const all=[...texts.map((t,i)=>[plan.problemIds[i].declaration,t]),...notComputable.map(item=>[item.declaration,item.text])];
  result.result=all.length===1?{...last,text:texts[0],packet:{...last.packet,...reports}}:{...last,text:all.map(([declaration,t])=>declaration+':\n'+t).join('\n\n'),packet:{...last.packet,...reports,...(notComputable.length?{not_computable:notComputable.map(item=>item.packet)}:{})}};
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
 // Unparsed spans the host could not repair: one targeted question each, after whatever could be answered.
 if(plan.unresolvedSpans.length&&result.result?.kind==='cnl'){
  result.result={...result.result,text:[result.result.text,...plan.unresolvedSpans.map(span=>span.question)].join('\n'),packet:{...result.result.packet,...languageReports(plan),...(plan.unresolvedSpans.some(span=>span.blocking)?{next:'answer_clarification',complete:false}:{})}};
 }
 // The last computed query stays in caller-owned context, so an elliptical follow-up can be completed (Q-LANG-4).
 const lastQuery=parse(plan.authoredSop).wires.find(w=>w.type==='query'&&!plan.held.has(w.id)&&!(plan.notComputable??[]).some(item=>item.declaration===w.id));
 if(lastQuery)context.lastQuery=canonical({wires:[lastQuery]});
 return {...result,authoredSop:plan.authoredSop,executionSop:plan.executionSop,contextStatements:context.statements,contextLastQuery:context.lastQuery??null,problemResults:plan.problemIds.map(p=>({id:p.declaration,result:result.values[p.solve],...(p.branch?{branch:result.values[p.branch]}:{})})),generated:[{kind:'orchestration',epoch:0,source:plan.executionSop},...result.generated]};
}
