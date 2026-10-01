import {assert, digest} from '../lib/util.mjs';
import {admitCircuits} from '../lib/query-author/session.mjs';
import {AuthorRuntime, memoryCircuits} from '../lib/query-author/runtime.mjs';
import {authorExecution} from '../lib/query-author/execution-context.mjs';
import {Sessions} from '../lib/chat-data/sessions.mjs';
import path from 'node:path';
import fs from 'node:fs';
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
    const draft=folder&&fs.existsSync(path.join(folder,'session.json'))?new Sessions({chatData:{sessionsDir:path.dirname(folder)}}).addDraft(path.basename(folder),{name:'coding-agent-definition',text:preview.program.definitionSop,model:formalizer.id,extra:{origin:'coding_agent'}}):null;
    if(result.result?.packet)result.result.packet.session_circuits={origin:'coding_agent',scope:'turn',status:'proposed',text:preview.program.definitionSop,...(draft?{draft_id:draft.id}:{})};
   }
  }catch(error){throw Object.assign(error,{modelSop:sop,formalization});}
  let output=result.result;
  if(output?.status==='clarify')output={kind:'cnl',text:output.text,language:'en',packet:output};
  assert(output?.kind==='cnl','The runtime must produce a conversational result');
  this.context={...this.context,statements:result.contextStatements??this.context.statements};
  this.last=output;this.recent.push({user:text.slice(0,400),response:output.text.slice(0,500)});this.recent=this.recent.slice(-3);
  const packet=output.packet??{};
  const branches=(result.problemResults??[]).flatMap(p=>p.branch?[p.branch]:[]);
  const conflicts=branches.flatMap(p=>p.session_conflicts??[]);
  if(conflicts.length)packet.session_conflicts=[...(packet.session_conflicts??[]),...conflicts];
  if(this.config?.policy?.reinforce!==false&&this.repo&&this.session&&!packet.hypothetical&&packet.proof?.length){
   const used=packet.proof.filter(f=>f.kind==='observed'&&f.source!=='assumption'&&f.evidence?.metadataVerified&&!f.evidence?.local);
   if(used.length){const promoted=this.repo.reinforce(this.session,used,{usedAt:now});if(promoted.some(x=>x.reinforced))packet.reinforcement={facts:promoted.filter(x=>x.reinforced).length,strength:this.session.live.retention().useStrength};}
  }
  return {sop,executionSop:result.executionSop,cnl:output.text,text:output.text,englishText:output.text,packet:output.packet,trace:result.trace,outputs:result.outputs,blocked:result.blocked,generated:result.generated,
   userStatements:packet.user_statements??[],carriedStatements:packet.carried_statements??[],modelAssumptions:packet.model_assumptions??[],assumptionPolicy:packet.assumption_policy??null,assumptionBranch:packet.assumption_branch??null,
   unclear:packet.status==='unclear'?packet.unclear_kind:null,answerLanguage:'en',formalization};
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
