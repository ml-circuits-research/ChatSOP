import {assert, digest} from '../lib/util.mjs';
import {admitCircuits} from '../lib/query-author/session.mjs';
import {AuthorRuntime, memoryCircuits} from '../lib/query-author/runtime.mjs';
import {authorExecution} from '../lib/query-author/execution-context.mjs';
import {Sessions} from '../lib/chat-data/sessions.mjs';
import {createDefaultEmotionDetectionSystem,adviceFor,signalsToSop} from '../lib/emotion-detection/index.mjs';
import {interpret,standaloneReply,tone,signalLanguage} from '../lib/emotion-detection/turn.mjs';
import {parse} from '../sop/parser.mjs';
import path from 'node:path';
import fs from 'node:fs';
/**
 * One chat turn of a conversation (DS009, DS014). The circuit author (the coding agent through server/query-parser.mjs, or a test stub) is
 * the only component that reads the user's words: it gets the message and the vocabulary of the memory and writes circuits. The runtime
 * admits them, the KnowledgeLinker binds their strings to the memory, the StrategyRouter and the oracle compute the answer and the
 * answer is rendered in English from the result packet (sop/answer-text.mjs).
 */
export class Agent{
 constructor({repo,session,lexicon,config,circuitRules=null,emotion}){Object.assign(this,{repo,session,lexicon,config,circuitRules});this.emotion=emotion;this.recent=[];this.last=null;
  // Caller-owned conversation context: carried statements, the last query (for follow-ups) and, when the runtime
  // configures it, the caller's own entity for "the user" (DS014).
  this.context={statements:[],...(config?.user?{user:config.user}:{})};}
 /**
  * `formalizer` is required: `{id, formalize: async text => sop}`; the server builds it per turn from the request parser, and tests inject
  * their own. The answer is English.
  */
 /**
  * The EmotionDetectionSystem of this agent (DS023): `emotion` given to the constructor (a system, or `false` for none), else the one built from
  * config/emotion-detection.json unless `config.emotionDetection.enabled` is false. Detection is symbolic and takes well under a millisecond.
  */
 detector(){
  if(this.emotion===false||this.config?.emotionDetection?.enabled===false)return null;
  if(!this.emotion)this.emotion=createDefaultEmotionDetectionSystem();
  return this.emotion;
 }
 /**
  * `formalizer` is required. Before it runs, the pragmatic signals of the message are detected (DS023 "Chat turn"): a message that is only
  * courtesy or only an emotional reaction gets a deterministic reply in its language and no formalizer call; otherwise the edge courtesy is
  * stripped from the text the formalizer sees, and the answer gets the courtesy phrase and tone the signals ask for. `emotion: false` turns it off for the turn.
  */
 async turn(text,{now=Date.now(),formalizer,emotion=true}={}){
  assert(typeof formalizer?.formalize==='function','A turn needs a circuit author: {id, formalize}');
  const started=performance.now();
  const system=emotion===false?null:this.detector();
  const detected=system?await system.detect(text):null;
  const signals=detected?.signals??[],view=signals.length?interpret(text,signals):null;
  const advice=view?adviceFor(signals.filter(x=>!x.experimental),{hasContent:!view.courtesyOnly&&!view.signalOnly}):null;
  const language=view?.language??signalLanguage([],text);
  const wires=view?.wireSignals??[];
  let pragmaticSop='';
  if(wires.length){pragmaticSop=signalsToSop(wires);parse(pragmaticSop);}
  const pragmatic=signals.length?signals.map(({kind,score,span,source,basis,label,experimental})=>({kind,score,span:span??null,source,basis,label,...(experimental?{experimental:true}:{})})):undefined;
  if(view&&(view.courtesyOnly||view.signalOnly)){
   // Only courtesy or only a reaction: a deterministic reply in the user's language, no coding-agent call, no computation, no memory change.
   const reply=standaloneReply(signals,view.language),packet={kind:'courtesy',status:'courtesy',complete:true,language:view.language,localized:true,reply_kind:view.courtesyOnly?'courtesy':'reaction',pragmatic};
   const output={kind:'cnl',text:reply,language:view.language,packet};
   this.last=output;this.recent.push({user:text.slice(0,400),response:reply});this.recent=this.recent.slice(-3);
   return {sop:'',executionSop:pragmaticSop,cnl:reply,text:reply,englishText:view.language==='en'?reply:null,packet,trace:[],outputs:{},blocked:[],generated:[],userStatements:[],carriedStatements:[],modelAssumptions:[],assumptionPolicy:null,assumptionBranch:null,unclear:null,
    answerLanguage:{applied:false,mode:'auto',reason:'courtesy reply written in the language of the message',ms:0},formalization:{model:null,ms:Math.round(performance.now()-started)},pragmatic:{signals,sop:pragmaticSop,advice,language:view.language,standalone:true}};
  }
  const original=text;
  text=view?.core??text;
  const circuits=memoryCircuits(this);
  let preview=null;
  const execute=async source=>{
   const program=admitCircuits(source,text,this.lexicon,{circuits,policy:this.config?.policy});
   const context=structuredClone(this.context);
   const result=await new AuthorRuntime({repo:this.repo,session:this.session,lexicon:program.lexicon,schema:program.lexicon?.predicates,now,policy:this.config?.policy,circuits,definitions:program.definitionSop}).run(program.modelSop,{origin:'model',inputText:text,language:'en',languageSource:'default',context});
   preview={sop:source,result,context,program};
   return result.result?.packet??result.result;
  };
  const sop=await authorExecution.run({execute,circuits,key:digest([circuits.map(c=>c.text),this.context.statements,this.context.user]),contextKey:digest(this.context.lastQuery??''),selfCheck:this.config?.queryParser?.selfCheck!==false},()=>formalizer.formalize(text));
  const formalization={model:formalizer.id??null,ms:Math.round(performance.now()-started)};
  let result;
  try{
   if(preview?.sop!==sop)await execute(sop);
   result=preview.result;
   this.context=preview.context;
   if(preview.program.definitionSop){
    const folder=this.repo?.root?path.dirname(this.repo.root):null;
    // A definition the coding agent wrote joins the session layer once it validates (no manual acceptance, owner 2026-10-02).
    let added=null,problems=null;
    if(folder&&fs.existsSync(path.join(folder,'session.json'))){try{added=new Sessions({chatData:{sessionsDir:path.dirname(folder)}}).addCircuit(path.basename(folder),{name:'coding-agent-definition',text:preview.program.definitionSop,model:formalizer.id,origin:'coding_agent'});}catch(error){problems=(error.problems??[{code:error.code,message:error.message}]).slice(0,10);}}
    if(result.result?.packet)result.result.packet.session_circuits={origin:'coding_agent',scope:added?'session':'turn',status:added?'added':problems?'not_added':'turn_only',text:preview.program.definitionSop,...(added?{file:added.file}:{}),...(problems?{problems}:{})};
   }
  }catch(error){throw Object.assign(error,{modelSop:sop,formalization});}
  let output=result.result;
  if(output?.status==='clarify')output={kind:'cnl',text:output.text,language:'en',packet:output};
  assert(output?.kind==='cnl','The runtime must produce a conversational result');
  let toned=null;
  if(output.packet?.status==='unclear'&&output.packet.unclear_kind==='no_request'){
   // A message without a request is never shown as the raw verdict: a natural invitation in the language of the message (DS023 "Chat turn").
   output={...output,text:standaloneReply(signals,language),language};output.packet=Object.assign(output.packet,{localized:true,language});
  }else if(view||advice){
   toned=tone(output.text,{signals:signals.filter(x=>!x.experimental),advice,status:output.packet?.status});
   if(toned.applied.length)output={...output,text:toned.text};
  }
  this.context={...this.context,statements:result.contextStatements??this.context.statements};
  this.last=output;this.recent.push({user:text.slice(0,400),response:output.text.slice(0,500)});this.recent=this.recent.slice(-3);
  const packet=output.packet??{};
  if(pragmatic){packet.pragmatic=pragmatic;if(toned?.applied.length||text!==original)packet.pragmatic_use={language,applied:toned?.applied??[],...(text!==original?{message_for_formalizer:text}:{})};}
  const branches=(result.problemResults??[]).flatMap(p=>p.branch?[p.branch]:[]);
  const conflicts=branches.flatMap(p=>p.session_conflicts??[]);
  if(conflicts.length)packet.session_conflicts=[...(packet.session_conflicts??[]),...conflicts];
  if(this.config?.policy?.reinforce!==false&&this.repo&&this.session&&!packet.hypothetical&&packet.proof?.length){
   const used=packet.proof.filter(f=>f.kind==='observed'&&f.source!=='assumption'&&f.evidence?.metadataVerified&&!f.evidence?.local);
   if(used.length){const promoted=this.repo.reinforce(this.session,used,{usedAt:now});if(promoted.some(x=>x.reinforced))packet.reinforcement={facts:promoted.filter(x=>x.reinforced).length,strength:this.session.live.retention().useStrength};}
  }
  return {sop,executionSop:pragmaticSop?result.executionSop+'\n\n'+pragmaticSop:result.executionSop,cnl:output.text,text:output.text,englishText:output.text,packet:output.packet,trace:result.trace,outputs:result.outputs,blocked:result.blocked,generated:result.generated,
   userStatements:packet.user_statements??[],carriedStatements:packet.carried_statements??[],modelAssumptions:packet.model_assumptions??[],assumptionPolicy:packet.assumption_policy??null,assumptionBranch:packet.assumption_branch??null,
   unclear:packet.status==='unclear'?packet.unclear_kind:null,answerLanguage:'en',formalization,...(pragmatic?{pragmatic:{signals,sop:pragmaticSop,advice,language,standalone:false}}:{})};
 }
 /**
  * Admission of proposition circuits and turn-local session definitions against
  * accepted memory. Links and value references name wires of this output.
  * Stated values are anchored to the message; unparsed spans are verbatim.
  * Proposed definitions do not modify the accepted theory or base memory.
  */
 validateVocabulary(sop,text=''){
  return admitCircuits(sop,text,this.lexicon,{circuits:this.repo?memoryCircuits(this):undefined,policy:this.config?.policy});
 }
}
