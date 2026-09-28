import {Runtime} from '../sop/runtime.mjs';import {complete,formalize,verbalize,barePrompt} from './llm.mjs';import {parse} from '../sop/parser.mjs';import {MODEL_TYPES,checkModelWire} from '../sop/declarative.mjs';import {assert} from '../lib/util.mjs';
import {propositionOf} from '../sop/propositions.mjs';
import {mentionedIn} from '../sop/linking.mjs';
import {answerLanguage} from './language.mjs';
const listTypes=types=>{const t=[...types];return t.slice(0,-1).join(', ')+' or '+t.at(-1);};
/**
 * The model handles language; all state changes and inference go through SOP.
 * The formalizer sees ONLY the user's message and writes context-free string
 * propositions in the model language (DS021); the host links them to the lexicon.
 */
export class Agent{
 constructor({repo,session,lexicon,config}){Object.assign(this,{repo,session,lexicon,config});this.recent=[];this.last=null;this.context={statements:[]};}
 /**
  * `language` is the lexical hint for alias matching ('auto', 'en', 'ro', ...).
  * The answer language is `answerLanguage` when the caller selected one, an
  * explicit request in the message, a concrete en/ro turn language, or English.
  */
 async turn(text,{language='auto',answerLanguage:selected,languageSource,now=Date.now(),rewrite=true}={}){
  const chosen=languageSource?{language:selected??language,source:languageSource}:answerLanguage(text,selected??(['en','ro'].includes(language)?language:undefined));
  const replyLanguage=chosen.language;
  assert(this.config.promptProfile===undefined||['formal','bare'].includes(this.config.promptProfile),'Unsupported formalizer prompt profile');
  const promptProfile=this.config.promptProfile??'formal';
  // The prompt is the message only (plus the fixed instructions in the formal prompt).
  const sop=promptProfile==='bare'?await complete(this.config.formalizer,barePrompt(text)):await formalize(text,this.config.formalizer),program=this.validateVocabulary(sop,text);
  assert(MODEL_TYPES.has(program.wires.at(-1)?.type),'Model SOP must end in a model-language declaration');
  const result=await new Runtime({repo:this.repo,session:this.session,schema:this.lexicon.predicates,lexicon:this.lexicon,now,policy:this.config.policy}).run(sop,{origin:'model',inputText:text,language:replyLanguage,languageSource:chosen.source,context:this.context});
  let output=result.result;
  if(output?.status==='clarify')output={kind:'cnl',text:output.text,language:replyLanguage,packet:output};
  assert(output?.kind==='cnl','The host must produce a conversational result');
  this.context={statements:result.contextStatements??this.context.statements};
  this.last=output;this.recent.push({user:text.slice(0,400),response:output.text.slice(0,500)});this.recent=this.recent.slice(-3);
  const nl=rewrite&&this.config.verbalizer?await verbalize(output,this.config.verbalizer):{text:output.text};
  const packet=output.packet??{};
  return {sop,executionSop:result.executionSop,cnl:output.text,text:nl.text,packet:output.packet,trace:result.trace,outputs:result.outputs,blocked:result.blocked,generated:result.generated,
   userStatements:packet.user_statements??[],carriedStatements:packet.carried_statements??[],modelAssumptions:packet.model_assumptions??[],assumptionPolicy:packet.assumption_policy??null,assumptionBranch:packet.assumption_branch??null,
   unclear:packet.status==='unclear'?packet.unclear_kind:null,answerLanguage:replyLanguage,languageSource:chosen.source,promptProfile,neuralFormalization:true,verbalizationCertified:!rewrite};
 }
 /**
  * Admission of model output: model declarations only, `unclear` alone, and
  * every value of a `stated` wire (and a non-user speaker) mentioned in this
  * message (DS021 anchoring). The model had no context, so there is no shortlist.
  */
 validateVocabulary(sop,text=''){
  const program=parse(sop);
  if(program.wires.some(w=>w.type==='unclear'))assert(program.wires.length===1,'unclear_not_alone: unclear must be the only wire of the model output');
  for(const wire of program.wires){
   assert(MODEL_TYPES.has(wire.type),'Model output must be declarative: '+listTypes(MODEL_TYPES));
   checkModelWire(wire);
   if(wire.type==='stated'){
    const p=propositionOf(wire);
    for(const {name,value} of p.roles)assert(mentionedIn(value,text),'stated_value_not_in_message: '+JSON.stringify(value)+' (role '+name+' of @'+wire.id+') is not mentioned in this message; use assumed or a query variable');
    if(p.speaker!=='user')assert(mentionedIn(p.speaker,text),'stated_value_not_in_message: speaker '+JSON.stringify(p.speaker)+' of @'+wire.id+' is not mentioned in this message');
   }
  }
  return program;
 }
}
