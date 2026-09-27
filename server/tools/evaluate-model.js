#!/usr/bin/env node
/** Actual endpoint evaluation, with a deterministic oracle for SOP execution.
 * No neural scores are produced by --dry-run. NL faithfulness remains human-reviewed.
 */
import {executionSignature as signature} from '../src/evaluation.js';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {cliArgs,readJSONL,saveJSON,loadJSON,stable} from '../src/util.js';import {complete} from '../src/llm.js';import {parse} from '../src/sop/parser.js';
import {Repository} from '../src/repository.js';import {Runtime} from '../src/runtime.js';import {Lexicon} from '../src/lexicon.js';import {publishKnowledge} from '../src/ingest.js';
const a=cliArgs(),role=a.role??'formalizer',rows=readJSONL(a.file??`data/seed/${role}/test.jsonl`).slice(0,Number(a.limit??100)),config=loadJSON(a.config??'config/runtime.json',{}),out=a.out??`reports/${role}-evaluation.json`;
if(a['dry-run']){saveJSON(out,{role,rows:rows.length,neuralModelTested:false,accuracy:null,syntaxChecked:role==='formalizer'?rows.every(r=>!!parse(r.target)):null});console.log(out);process.exit(0);}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sop-eval-')),repo=new Repository(temp,{memory:{power:8}}),lex=Lexicon.load(config.ontology??'config/ontology.sop'),bases=new Set(),details=[];

try{for(const row of rows){const start=performance.now();try{const predicted=await complete(config[role],row.prompt);if(role==='formalizer'){parse(predicted);if(!bases.has(row.group)){publishKnowledge(repo,row.group,row.setup_sop,{schema:lex.predicates,reviewed:true,knownAt:Date.parse('2024-01-01')});bases.add(row.group);}const goldSession=repo.session(row.group,'gold',row.id),predSession=repo.session(row.group,'pred',row.id);const run=s=>new Runtime({repo,session:s,schema:lex.predicates,now:Date.parse('2026-09-26T12:00:00Z')});const gold=await run(goldSession).run(row.target,{origin:'model'}),actual=await run(predSession).run(predicted,{origin:'model'});details.push({id:row.id,case:row.case,valid:true,executionEquivalent:signature(gold,goldSession)===signature(actual,predSession),predicted,expected:row.target,latencyMs:performance.now()-start});}
 else {const allowed=new Set(row.cnl.match(/\d+/g)??[]),generated=predicted.match(/\d+/g)??[];details.push({id:row.id,case:row.case,predicted,cnl:row.cnl,gold:row.target,newNumbers:generated.filter(x=>!allowed.has(x)),requiresHumanFaithfulnessReview:true,latencyMs:performance.now()-start});}}
 catch(e){details.push({id:row.id,case:row.case,valid:false,error:e.message,latencyMs:performance.now()-start});}}
}finally{fs.rmSync(temp,{recursive:true,force:true});}
const n=details.length,report={role,neuralModelTested:true,rows:n,validPrograms:role==='formalizer'?details.filter(r=>r.valid).length:null,executionEquivalent:role==='formalizer'?details.filter(r=>r.executionEquivalent).length:null,limitations:'Finite-fixture execution equivalence is not a proof of identical denotation on every KB. Inspect temporal qualifiers, selected variables, output modes/values and errors. Row-field names remain part of the observable contract. NL faithfulness is not certified automatically.',details};saveJSON(out,report);console.log(out);
