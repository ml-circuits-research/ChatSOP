#!/usr/bin/env node
/** Build v3 seed data. Worlds never cross splits. No neural weights are loaded.
 * Gold programs are executed; emitted CNL is the verbalizer source of truth.
 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {cliArgs,readJSONL,writeJSONL,saveJSON,digest,assert} from '../src/util.js';
import {parse,canonical} from '../src/sop/parser.js';import {scenarios} from '../examples/reasoning/scenarios.js';
import {formalPrompt,verbalPrompt} from '../src/llm.js';import {Runtime} from '../src/runtime.js';import {Repository} from '../src/repository.js';import {publishKnowledge} from '../src/ingest.js';import {Lexicon} from '../src/lexicon.js';
const args=cliArgs(),out=path.resolve(args.out??'data/seed'),worlds=Number(args.worlds??30),seed=Number(args.seed??731);
assert(Number.isInteger(worlds)&&worlds>=10&&worlds<=100000,'--worlds 10..100000');
const gen=spawnSync(process.execPath,['tools/generate-data.js','--out',out,'--worlds',String(worlds),'--seed',String(seed)],{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});if(gen.status!==0)throw Error(gen.stderr||gen.stdout);
const lex=Lexicon.load('config/ontology.sop'),bucket={};for(const role of ['formalizer','verbalizer']){bucket[role]={};for(const split of ['train','dev','test'])bucket[role][split]=readJSONL(path.join(out,role,split+'.jsonl'));}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sop-v3-data-'));let extra=0;
try {const repo=new Repository(root,{memory:{engine:'sqlite',power:8}});
for(let i=0;i<worlds;i++)for(const s of scenarios(i+seed*100)){
 const group='reason_world_'+seed+'_'+i+'_'+s.name,split=i%10===8?'dev':i%10===9?'test':'train';const target=canonical(parse(s.target));
 const built=publishKnowledge(repo,group,s.setup,{reviewed:true,knownAt:Date.parse('2024-01-01'),schema:lex.predicates});
 const session=repo.session(group,'gold','s');const result=await new Runtime({repo,session,schema:lex.predicates,now:Date.parse('2026-09-26T12:00:00Z')}).run(target,{origin:'model'});
 assert(result.result.packet.status===s.expectedStatus,'Gold program failed '+group);
 const entityIds=[...new Set((s.setup+'\n'+target).match(/\b(?:person_[abc]|device|robot|place_[abc]|org|other|[abcd])_\d+\b/g)??[])];
 const usedPreds=Object.keys(lex.predicates).filter(p=>new RegExp('\\b'+p+'\\(').test(s.setup+'\n'+target));
 const context={now:'2026-09-26',language:'ro',entities:entityIds.map(id=>({id,label:id})),predicates:usedPreds.map(id=>({id,args:lex.predicates[id].args,meaning:lex.predicates[id].description})),approvedTemplates:[],approvedDefinitions:built.library.map(x=>x.id),definitions_sop:built.library.map(x=>x.sop)};
 const row={id:'f3_'+group,group,split,case:s.name,role:'formalizer',profile:'sop-agent-3',language:'ro',input:s.input,context,prompt:formalPrompt(s.input,context),target,setup_sop:s.setup,expectedStatus:s.expectedStatus,expectedCheck:s.check,provenance:'programmatic finite world; teacher paraphrases must be reviewed'};
 bucket.formalizer[split].push(row);
 // The first verbalizer target is deliberately conservative identity-to-CNL.
 // A teacher may improve fluency, never change status, quantities or hypotheses.
 const cnl=result.result.text;
 bucket.verbalizer[split].push({id:'v3_'+group,group,split,case:s.name,role:'verbalizer',profile:'sop-agent-3',language:'ro',cnl,prompt:verbalPrompt(cnl,'ro'),target:cnl,seedKind:'identity-CNL; replace with semantically reviewed Romanian paraphrase'});extra++;
}}
finally{fs.rmSync(root,{recursive:true,force:true});}
let duplicatePromptsRemoved=0;for(const role of Object.keys(bucket)){const seen=new Set();for(const split of ['train','dev','test'])bucket[role][split]=bucket[role][split].filter(row=>{const h=digest(row.prompt);if(seen.has(h)){duplicatePromptsRemoved++;return false;}seen.add(h);return true;});}
for(const role of Object.keys(bucket))for(const split of ['train','dev','test'])writeJSONL(path.join(out,role,split+'.jsonl'),bucket[role][split]);
const report={profile:'sop-agent-3',worlds,seed,additionalReasoningExamples:extra,duplicatePromptsRemoved,splitUnit:'world; paraphrases inherit split; templates recur across splits',counts:Object.fromEntries(Object.entries(bucket).map(([r,splits])=>[r,Object.fromEntries(Object.entries(splits).map(([s,rows])=>[s,rows.length]))])),grammarSHA:digest(fs.readFileSync('src/sop/parser.js','utf8')),promptSHA:digest(fs.readFileSync('prompts/formalizer.txt','utf8')),generation:'executed synthetic seed programs, not human semantic evaluation',neuralModelTested:false};saveJSON(path.join(out,'manifest.json'),report);console.log(JSON.stringify(report,null,2));
