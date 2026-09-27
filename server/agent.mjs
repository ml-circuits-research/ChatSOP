import {Runtime} from '../sop/runtime.mjs';import {microContext,normalize} from '../sop/lexicon.mjs';import {formalize,verbalize,complete,barePrompt} from './llm.mjs';import {parse,many,one,parseAtom,emitAtom,dependencies} from '../sop/parser.mjs';import {MODEL_TYPES} from '../sop/declarative.mjs';import {assert} from '../lib/util.mjs';
import {formatTime} from '../lib/time.mjs';
import {conditionAtoms,emitCondition} from '../lib/conditions.mjs';
import {parseCondition} from '../sop/conditions.mjs';
const whereAtoms=w=>many(w,'where').flatMap(s=>conditionAtoms([parseCondition(s,parseAtom)]));
function atomSources(w){if(w.type==='premise')return [one(w,'holds')];if(w.type==='query')return whereAtoms(w).map(emitAtom);return [];}
/** The model handles language. All state changes and inference go through SOP. */
export class Agent{
 constructor({repo,session,lexicon,config}){Object.assign(this,{repo,session,lexicon,config});this.recent=[];this.last=null;this.context={premises:[]};}
 async turn(text,{language='auto',now=Date.now(),rewrite=true}={}){
  const context=microContext(text,this.lexicon,{language,now:new Date(now).toISOString(),recent:this.recent});
  if(this.last?.packet?.query)context.previous_query_sop='@previous query\n'+this.last.packet.query.where.map(c=>'  where '+emitCondition(c,emitAtom).replaceAll('\n','\n    ')).join('\n');
  const pending=this.last?.packet?.pendingSop;
  if(pending){context.previous_query_sop=pending;context.pending_clarification={question:this.last.text,required:this.last.packet.required??[]};}
  if(this.last?.packet?.proof)context.claims=this.last.packet.proof.filter(p=>p.kind==='observed').slice(0,3).map(p=>({id:p.id,sop:'@known fact\n  holds '+emitAtom(p.atom)+'\n  valid '+(p.valid.from===-Infinity?'beginning':new Date(p.valid.from).toISOString())+' '+(p.valid.until===Infinity?'open':new Date(p.valid.until).toISOString())}));
  // Previous grounded vocabulary and conditional premises remain available
  // for follow-ups, without treating model interpretations as observed facts.
  const pendingAtoms=pending?parse(pending).wires.filter(w=>w.type==='query').flatMap(whereAtoms):[];
  const prior=[...conditionAtoms(this.last?.packet?.query?.where??[]),...pendingAtoms,...(this.last?.packet?.proof??[]).slice(0,3).map(p=>p.atom),...this.context.premises.map(p=>p.atom)];
  for(const a of prior){if(!context.predicates.some(p=>p.id===a.p)&&this.lexicon.predicates[a.p]){const p=this.lexicon.predicates[a.p];context.predicates.push({id:a.p,args:p.args,meaning:p.description});}for(const id of a.a){const e=this.lexicon.entities[id];if(e&&!context.entities.some(x=>x.id===id))context.entities.push({id,label:e.labels.ro??id,type:e.entityType});}}
  for(const required of this.last?.packet?.required??[])for(const candidate of Array.isArray(required.candidates)?required.candidates:[]){const id=typeof candidate==='string'?candidate:candidate?.id,e=this.lexicon.entities[id];if(e&&!context.entities.some(x=>x.id===id))context.entities.push({id,label:e.labels.ro??id,type:e.entityType});}
  context.conditionalPremises=this.context.premises.map(p=>({holds:emitAtom(p.atom),valid:formatTime(p.valid.from)+' '+formatTime(p.valid.until),origin:p.origin,text:p.text}));
  const budget=this.config.contextMaxBytes??4800;
  while(Buffer.byteLength(JSON.stringify(context))>budget&&context.recent.length)context.recent.shift();
  assert(Buffer.byteLength(JSON.stringify(context))<=budget,'Discourse context exceeds budget; split the request or clarify');
  assert(this.config.promptProfile===undefined||['formal','bare'].includes(this.config.promptProfile),'Unsupported formalizer prompt profile');
  const promptProfile=this.config.promptProfile??'formal';
  const sop=promptProfile==='bare'?await complete(this.config.formalizer,barePrompt(text,context)):await formalize(text,context,this.config.formalizer),program=this.validateVocabulary(sop,context,text);
  assert(MODEL_TYPES.has(program.wires.at(-1)?.type),'Model SOP must end in a premise, query, or constraint');
  this.context.entities=context.entities;
  const result=await new Runtime({repo:this.repo,session:this.session,schema:this.lexicon.predicates,lexicon:this.lexicon,now,policy:this.config.policy,atomGuard:(a,meta)=>this.validateAtom(a,context,meta)}).run(sop,{origin:'model',inputText:text,language,context:this.context});
  let output=result.result;
  if(output?.status==='clarify')output={kind:'cnl',text:output.text,language:language==='auto'?'en':language,packet:output};
  assert(output?.kind==='cnl','The host must produce a conversational result');
  this.context={premises:result.contextPremises??this.context.premises,entities:context.entities};
  this.last=output;this.recent.push({user:text.slice(0,400),response:output.text.slice(0,500)});this.recent=this.recent.slice(-3);
  const nl=rewrite&&this.config.verbalizer?await verbalize(output,this.config.verbalizer):{text:output.text};
  return {sop,executionSop:result.executionSop,cnl:output.text,text:nl.text,packet:output.packet,trace:result.trace,outputs:result.outputs,blocked:result.blocked,generated:result.generated,promptProfile,neuralFormalization:true,verbalizationCertified:!rewrite};
 }
 validateAtom(a,context,meta={}){const predicates=new Set(context.predicates.map(p=>p.id)),ids=new Set(context.entities.map(e=>e.id));assert(predicates.has(a.p),'Model selected a predicate outside its shortlist; widen retrieval or clarify');for(let i=0;i<a.a.length;i++){const x=a.a[i],t=this.lexicon.predicates[a.p]?.args[i];if(typeof x==='string'&&!x.startsWith('?')&&t!=='value'&&t!=='integer'){const raw=meta.wire?parseAtom(atomSources(meta.wire)[meta.atomIndex??0]):null;const ref=raw?.a[i]?.ref;const generated=ref&&meta.outputs?.[ref]?.status==='bound';assert(ids.has(x)||generated,'Model selected an entity outside its shortlist; resolve identity first');if(generated){const produced=meta.outputs[ref].wireType==='resolve'?meta.outputs[ref].type:meta.outputs[ref].valueType;assert(t==='entity'||t===produced,'Generated output type does not match predicate argument');if(meta.outputs[ref].wireType==='resolve')assert(ids.has(x),'resolve cannot widen the model vocabulary');}const actual=this.lexicon.entities[x]?.entityType;if(actual&&t&&t!=='entity')assert(actual===t,'Resolved entity type does not match predicate argument');}}}
 validateVocabulary(sop,context,text=''){
  const ids=new Set(context.entities.map(e=>e.id)),predicates=new Set(context.predicates.map(p=>p.id));
  const mentioned=[text,...this.recent.map(r=>r.user)].map(normalize);
  const program=parse(sop);
  for(const wire of program.wires){
   assert(MODEL_TYPES.has(wire.type),'Model output must be declarative: premise, query, or constraint');
   assert(!dependencies(wire).handles.length,'Model output cannot select execution definitions');
   for(const source of atomSources(wire)){
    const atom=parseAtom(source);
    assert(predicates.has(atom.p),'Model selected a predicate outside its shortlist; widen retrieval or clarify');
    for(let i=0;i<atom.a.length;i++){
     const term=atom.a[i],type=this.lexicon.predicates[atom.p]?.args[i];
     if(typeof term!=='string'||term.startsWith('?')||type==='value'||type==='integer')continue;
     if(ids.has(term))continue;
     assert(!this.lexicon.entities[term]&&mentioned.some(m=>m.includes(normalize(term))),'Model selected an entity outside its shortlist; resolve identity first');
    }
   }
  }
  return program;
 }
}
