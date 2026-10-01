import {Runtime} from '../sop/runtime.mjs';import {parse} from '../sop/parser.mjs';import {MODEL_TYPES,checkModelWire} from '../sop/declarative.mjs';import {checkModelLinks} from '../sop/clauses.mjs';import {englishDictionary} from '../sop/dictionary.mjs';import {unquote,one} from '../sop/parser.mjs';import {assert} from '../lib/util.mjs';
import {propositionOf} from '../sop/propositions.mjs';
import {mentionedIn,mentionedThroughLexicon,mentionedThroughDictionary} from '../sop/linking.mjs';
const verbatim=text=>String(text).normalize('NFC').toLocaleLowerCase('ro').replace(/\s+/g,' ').trim();
const listTypes=types=>{const t=[...types];return t.slice(0,-1).join(', ')+' or '+t.at(-1);};
/**
 * One chat turn of a conversation (DS009, DS014). The circuit author (the coding agent through server/query-parser.mjs, or a test stub) is
 * the only component that reads the user's words: it gets the message and the vocabulary of the memory and writes circuits. The runtime
 * admits them, the KnowledgeLinker binds their strings to the memory, the StrategyRouter and the oracle compute the answer and the
 * answer is rendered in English from the result packet (sop/answer-text.mjs).
 */
export class Agent{
 constructor({repo,session,lexicon,config,circuitRules=null}){Object.assign(this,{repo,session,lexicon,config,circuitRules});this.recent=[];this.last=null;
  // Caller-owned conversation context: carried statements, the last query (for follow-ups) and, when the runtime
  // configures it, the caller's own entity for "the user" (DS014).
  this.context={statements:[],...(config?.user?{user:config.user}:{})};}
 /**
  * `formalizer` is required: `{id, formalize: async text => sop}`; the server builds it per turn from the request parser, and tests inject
  * their own. The answer is English.
  */
 async turn(text,{now=Date.now(),formalizer}={}){
  assert(typeof formalizer?.formalize==='function','A turn needs a circuit author: {id, formalize}');
  const started=performance.now();
  const sop=await formalizer.formalize(text);
  const formalization={model:formalizer.id??null,ms:Math.round(performance.now()-started)};
  let program,result;
  // Output that is not admitted or cannot be executed keeps its SOP and timing, so the caller can show what the author wrote.
  try{
   program=this.validateVocabulary(sop,text);assert(MODEL_TYPES.has(program.wires.at(-1)?.type),'Model SOP must end in a model-language declaration');
   result=await new Runtime({repo:this.repo,session:this.session,schema:this.lexicon.predicates,lexicon:this.lexicon,now,policy:this.config.policy,circuitRules:this.circuitRules}).run(sop,{origin:'model',inputText:text,language:'en',languageSource:'default',context:this.context});
  }catch(error){throw Object.assign(error,{modelSop:sop,formalization});}
  let output=result.result;
  if(output?.status==='clarify')output={kind:'cnl',text:output.text,language:'en',packet:output};
  assert(output?.kind==='cnl','The runtime must produce a conversational result');
  this.context={...this.context,statements:result.contextStatements??this.context.statements};
  this.last=output;this.recent.push({user:text.slice(0,400),response:output.text.slice(0,500)});this.recent=this.recent.slice(-3);
  const packet=output.packet??{};
  return {sop,executionSop:result.executionSop,cnl:output.text,text:output.text,englishText:output.text,packet:output.packet,trace:result.trace,outputs:result.outputs,blocked:result.blocked,generated:result.generated,
   userStatements:packet.user_statements??[],carriedStatements:packet.carried_statements??[],modelAssumptions:packet.model_assumptions??[],assumptionPolicy:packet.assumption_policy??null,assumptionBranch:packet.assumption_branch??null,
   unclear:packet.status==='unclear'?packet.unclear_kind:null,answerLanguage:'en',formalization};
 }
 /**
  * Admission of model output: model declarations only, `unclear` alone, links and
  * `$id` references that name wires of this output, every value of a `stated` wire
  * (and a non-user speaker) mentioned in this message, and every `unparsed` span a
  * verbatim part of it (DS014 anchoring). The model had no context, so there is no shortlist.
  */
 validateVocabulary(sop,text=''){
  const program=parse(sop);
  if(program.wires.some(w=>w.type==='unclear'))assert(program.wires.length===1,'unclear_not_alone: unclear must be the only wire of the model output');
  const dictionary=this.config?.policy?.dictionary===false?null:englishDictionary();
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
