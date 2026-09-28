#!/usr/bin/env node
/** Offline verification. Does not install packages, download weights or train. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {saveJSON,digest} from '../lib/util.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const reportDir='eval/reports/current';
fs.mkdirSync(reportDir,{recursive:true});
const group=process.argv.includes('--group')?process.argv[process.argv.indexOf('--group')+1]:'all';
const sources=['package.json','lib','sop','memory','reasoning','server','eval','tests','tools','training','config','datasets','skills/material-to-sop','skills/semantic-sop-review','examples'];
function fingerprints(location){
 const stat=fs.statSync(location);
 if(stat.isFile())return [[location,crypto.createHash('sha256').update(fs.readFileSync(location)).digest('hex')]];
 return fs.readdirSync(location,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  if(entry.name==='__pycache__'||entry.name==='.venv'||location==='tools'&&entry.name==='.solvers'||location==='sop'&&entry.name==='contracts'||location==='eval'&&entry.name==='reports')return [];
  return fingerprints(path.join(location,entry.name));
 });
}
const sourceFingerprint=digest(sources.flatMap(fingerprints));
const testFiles=fs.readdirSync('tests').filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
const jobs=[
 ['node-tests',process.execPath,['--test',...testFiles]],
 ['demo',process.execPath,['examples/demo.mjs']],
 ['declarative-demo',process.execPath,['examples/declarative-demo.mjs']],
 ['research-examples',process.execPath,['examples/research/demo.mjs']],
 ['linker-demo',process.execPath,['examples/linker-demo.mjs']],
 ['forgetting-demo',process.execPath,['examples/forgetting-demo.mjs']],
 ['shards-demo',process.execPath,['examples/shards-demo.mjs']],
 ['shards-benchmark',process.execPath,['tools/bench-shards.mjs']],
 ['corpus-formalizer',process.execPath,['tools/datasets/verify-corpus.mjs','--corpus','formalizer-v1','--sample','400']],
 ['corpus-formalizer-ood',process.execPath,['tools/datasets/verify-corpus.mjs','--suite','formalizer-ood-v1','--sample','200']],
 ['research-preparation',process.execPath,['tools/research/prepare-experiment.mjs']],
 ['solver-availability',process.execPath,['tools/check-solvers.mjs']],
 ['reasoning-matrix',process.execPath,['examples/reasoning-demo.mjs']],
 ['contracts',process.execPath,['tools/capabilities.mjs']],
 ['spec-refs',process.execPath,['tools/check-spec-refs.mjs']],
 ['model-surface-lint',process.execPath,['tools/lint/model-surface.mjs']],
 ['file-size-limit',process.execPath,['tools/shard-large-files.mjs','--check']],
 ['memory-demo',process.execPath,['examples/memory-demo.mjs']]
];
// The corpus sample executed once per memory engine: the verification worlds must answer the same way on each.
for(const engine of ['holo-memory','recall-memory','sqlite','scan','hybrid'])jobs.push(['data-'+engine,process.execPath,['tools/datasets/verify-corpus.mjs','--corpus','formalizer-v1','--sample','200','--engine',engine]]);
jobs.push(['formalizer-dry-run',process.execPath,['training/cli.mjs','train','--dry-run','--role','formalizer','--model','gemma','--run','verify','--data','datasets/formalizer-v1']]);
const groups={
 core:jobs.filter(job=>!job[0].startsWith('data-')&&!job[0].endsWith('-dry-run')),
 'associative-data':jobs.filter(job=>['data-holo-memory','data-recall-memory'].includes(job[0])),
 'exact-data':jobs.filter(job=>['data-sqlite','data-scan','data-hybrid'].includes(job[0])),
 training:jobs.filter(job=>job[0].endsWith('-dry-run'))
};
const report=file=>path.join(reportDir,file);
const metadata={sourceFingerprint,node:process.version,platform:process.platform,arch:process.arch,neuralModelTested:false,trainingExecuted:false};
if(process.argv.includes('--collect')){
 const parts=Object.keys(groups).map(name=>JSON.parse(fs.readFileSync(report('verification-'+name+'.json'),'utf8')));
 if(parts.some(part=>part.sourceFingerprint!==sourceFingerprint||!part.complete))throw Error('Stale/incomplete verification part; re-run changed source');
 const results=parts.flatMap(part=>part.results),summary={...metadata,complete:true,results};
 saveJSON(report('verification.json'),summary);
 console.log(JSON.stringify(summary,null,2));
 process.exit(results.some(result=>result.status==='failed')?1:0);
}
if(group!=='all'&&!groups[group])throw Error('Unknown --group '+group);
const selectedJobs=group==='all'?jobs:groups[group],results=[],reportPath=report('verification'+(group==='all'?'':'-'+group)+'.json');
for(const [name,command,args] of selectedJobs){
 console.log('START '+name);
 const start=performance.now(),run=spawnSync(command,args,{encoding:'utf8',timeout:name.endsWith('-dry-run')?15000:180000,maxBuffer:20*1024*1024});
 const log=(run.stdout??'')+(run.stderr??'');
 fs.writeFileSync(report(name+'.log'),log);
 const entry={name,status:run.status===0?'passed':'failed',exitCode:run.status,seconds:Number(((performance.now()-start)/1000).toFixed(3)),error:run.error?.message??null};
 if(name==='node-tests')for(const key of ['tests','pass','fail','skipped']){
  const match=log.match(new RegExp('^# '+key+' (\\d+)$','m'));
  if(match)entry[key]=Number(match[1]);
 }
 results.push(entry);
 console.log(name+': '+entry.status+' ('+entry.seconds+'s)');
 saveJSON(reportPath,{...metadata,complete:false,results});
}
const summary={...metadata,complete:true,results};
saveJSON(reportPath,summary);
console.log(JSON.stringify(summary,null,2));
if(results.some(result=>result.status==='failed'))process.exitCode=1;
