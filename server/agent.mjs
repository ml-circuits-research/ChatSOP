import {Runtime} from '../sop/runtime.mjs';import {parse} from '../sop/parser.mjs';import {MODEL_TYPES,checkModelWire} from '../sop/declarative.mjs';import {checkModelLinks} from '../sop/clauses.mjs';import {defaultDictionary} from '../sop/dictionary.mjs';import {unquote,one} from '../sop/parser.mjs';import {assert} from '../lib/util.mjs';
import {propositionOf} from '../sop/propositions.mjs';
import {mentionedIn,mentionedThroughLexicon,mentionedThroughDictionary} from '../sop/linking.mjs';
import {answerLanguage} from './language.mjs';
import {adviceFor,signalsToSop} from '../lib/emotion-detection/index.mjs';
import {courtesyReply} from '../lib/emotion-detection/courtesy.mjs';
const CONTENT_TYPES=new Set(['stated','assumed','query','constraint']);
const verbatim=text=>String(text).normalize('NFC').toLocaleLowerCase('ro').replace(/\s+/g,' ').trim();
const listTypes=types=>{const t=[...types];return t.slice(0,-1).join(', ')+' or '+t.at(-1);};
/**
 * The model handles language; all state changes and inference go through SOP.
 * The formalizer (SymbolicLM, the one formalizer of the product) gets ONLY the user's message and writes context-free string
 * propositions in the model language (DS021); the host links them to the lexicon.
 */
export class Agent{
 constructor({repo,session,lexicon,config}){Object.assign(this,{repo,session,lexicon,config});this.recent=[];this.last=null;
  // Caller-owned conversation context: carried statements, the last query (for follow-ups) and, when the host
  // configures it, the caller's own entity for "the user" (DS021 Q-LANG-4, Q-LANG-5).
  this.context={statements:[],...(config?.user?{user:config.user}:{})};}
 /**
  * `language` is the lexical hint for alias matching ('auto', 'en', 'ro', ...).
  * The answer language is `answerLanguage` when the caller selected one, an
  * explicit request in the message, a concrete en/ro turn language, or English.
  * `formalizer` is required: `{id, formalize: async text => sop, pragmatic?: () => signals}`, the SymbolicLM service of the model
  * registry (server/formalizers.mjs); the server builds it per turn, and tests inject their own.
  */
 async turn(text,{language='auto',answerLanguage:selected,languageSource,now=Date.now(),formalizer,pragmatic=null}={}){
  assert(typeof formalizer?.formalize==='function','A turn needs a formalizer: {id, formalize}');
  const chosen=languageSource?{language:selected??language,source:languageSource}:answerLanguage(text,selected??(['en','ro'].includes(language)?language:undefined));
  const replyLanguage=chosen.language;
  // The formalizer's input is the message only (DS021).
  const started=performance.now();
  const sop=await formalizer.formalize(text);
  // A service formalizer (SymbolicLM) reports the EmotionDetectionSystem's signals with its analysis (DS029).
  pragmatic=pragmatic??formalizer?.pragmatic?.()??null;
  const formalization={model:formalizer.id??null,ms:Math.round(performance.now()-started)};
  let program;
  // Model output that is not admitted or cannot be executed keeps its SOP and timing, so the caller can show what the model wrote.
  let result,signals=[],pragmaticSop='',advice=null;
  try{
   program=this.validateVocabulary(sop,text);assert(MODEL_TYPES.has(program.wires.at(-1)?.type),'Model SOP must end in a model-language declaration');
   // Advisory pragmatic signals (DS029): host-emitted circuit lines for the reasoner, never facts about the world and never model output.
   if(pragmatic){
    signals=(pragmatic.signals??[]).filter(x=>!x.experimental);
    pragmaticSop=signals.length?signalsToSop(signals,{taken:new Set(program.wires.map(w=>w.id))}):'';
    if(pragmaticSop)parse(pragmaticSop);
    advice=adviceFor(signals,{hasContent:program.wires.some(w=>CONTENT_TYPES.has(w.type))});
    // Greeting, thanks, apology or closing without any content: a short courtesy reply and no computation.
    if(advice.courtesyOnly){
     const reply=courtesyReply(signals,replyLanguage),packet={kind:'courtesy',status:'courtesy',complete:true,language:replyLanguage,pragmatic:signals.map(({kind,score,span,source,basis})=>({kind,score,span:span??null,source,basis}))};
     this.last={kind:'cnl',text:reply,language:replyLanguage,packet};this.recent.push({user:text.slice(0,400),response:reply});this.recent=this.recent.slice(-3);
     return {sop,executionSop:pragmaticSop,cnl:reply,text:reply,packet,trace:[],outputs:{},blocked:[],generated:[],userStatements:[],carriedStatements:[],modelAssumptions:[],assumptionPolicy:null,assumptionBranch:null,unclear:null,answerLanguage:replyLanguage,languageSource:chosen.source,formalization,pragmatic:{signals,sop:pragmaticSop,advice}};
    }
   }
   result=await new Runtime({repo:this.repo,session:this.session,schema:this.lexicon.predicates,lexicon:this.lexicon,now,policy:this.config.policy}).run(sop,{origin:'model',inputText:text,language:replyLanguage,languageSource:chosen.source,context:this.context});
  }catch(error){throw Object.assign(error,{modelSop:sop,formalization});}
  let output=result.result;
  if(output?.status==='clarify')output={kind:'cnl',text:output.text,language:replyLanguage,packet:output};
  assert(output?.kind==='cnl','The host must produce a conversational result');
  this.context={...this.context,statements:result.contextStatements??this.context.statements};
  this.last=output;this.recent.push({user:text.slice(0,400),response:output.text.slice(0,500)});this.recent=this.recent.slice(-3);
  const packet=output.packet??{};
  return {sop,executionSop:pragmaticSop?result.executionSop+'\n\n'+pragmaticSop:result.executionSop,cnl:output.text,text:output.text,packet:output.packet,trace:result.trace,outputs:result.outputs,blocked:result.blocked,generated:result.generated,
   userStatements:packet.user_statements??[],carriedStatements:packet.carried_statements??[],modelAssumptions:packet.model_assumptions??[],assumptionPolicy:packet.assumption_policy??null,assumptionBranch:packet.assumption_branch??null,
   unclear:packet.status==='unclear'?packet.unclear_kind:null,answerLanguage:replyLanguage,languageSource:chosen.source,formalization,...(pragmatic?{pragmatic:{signals,sop:pragmaticSop,advice}}:{})};
 }
 /**
  * Admission of model output: model declarations only, `unclear` alone, links and
  * `$id` references that name wires of this output, every value of a `stated` wire
  * (and a non-user speaker) mentioned in this message, and every `unparsed` span a
  * verbatim part of it (DS021 anchoring). The model had no context, so there is no shortlist.
  */
 validateVocabulary(sop,text=''){
  const program=parse(sop);
  if(program.wires.some(w=>w.type==='unclear'))assert(program.wires.length===1,'unclear_not_alone: unclear must be the only wire of the model output');
  const dictionary=this.config?.policy?.dictionary===false?null:defaultDictionary();
  for(const wire of program.wires){
   assert(MODEL_TYPES.has(wire.type),'Model output must be declarative: '+listTypes(MODEL_TYPES));
   checkModelWire(wire);
   if(wire.type==='stated'){
    const p=propositionOf(wire);
    // A value is written as in the message (normalized), or as the English (or Romanian) surface of a dictionary
    // entry or a lexicon entity the message names. A `$id` (another clause) and a placeholder ?variable (paired with
    // an unparsed span) are structural and are anchored through the wires they name.
    for(const {name,value} of p.roles){
     if(value&&typeof value==='object'||typeof value==='string'&&value.startsWith('?'))continue;
     assert(mentionedIn(value,text)||mentionedThroughLexicon(value,text,this.lexicon)||mentionedThroughDictionary(value,text,dictionary),'stated_value_not_in_message: '+JSON.stringify(value)+' (role '+name+' of @'+wire.id+') is not mentioned in this message; use assumed, a query variable or an unparsed span');
    }
    if(p.speaker!=='user')assert(mentionedIn(p.speaker,text),'stated_value_not_in_message: speaker '+JSON.stringify(p.speaker)+' of @'+wire.id+' is not mentioned in this message');
   }
   // An unparsed span is copied verbatim from the message (case and spacing aside); it is never a paraphrase.
   if(wire.type==='unparsed'){const span=unquote(one(wire,'span'));assert(verbatim(text).includes(verbatim(span)),'unparsed_span_not_in_message: '+JSON.stringify(span)+' of @'+wire.id+' is not a verbatim part of this message');}
  }
  checkModelLinks(program);
  return program;
 }
}
