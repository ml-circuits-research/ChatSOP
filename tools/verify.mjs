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
 ['cases-md',process.execPath,['tools/datasets/build-cases-md.mjs','--check']],
 ['demo',process.execPath,['examples/demo.mjs']],
 ['linker-demo',process.execPath,['examples/linker-demo.mjs']],
 ['forgetting-demo',process.execPath,['examples/forgetting-demo.mjs']],
 ['shards-demo',process.execPath,['examples/shards-demo.mjs']],
 ['shards-benchmark',process.execPath,['tools/bench-shards.mjs']],
 ['data-validation',process.execPath,['tools/check-data.mjs','--dir','datasets/seed','--execute','--out',reportDir+'/data-validation.json']],
 ['data-sharded',process.execPath,['tools/check-data.mjs','--dir','datasets/seed','--execute','--sharded','--out',reportDir+'/data-sharded.json']],
 ['query-curriculum',process.execPath,['tools/datasets/validate.mjs','--manifest','datasets/query-v1/manifest.json','--execute']],
 ['source-reference',process.execPath,['tools/datasets/validate.mjs','--file','eval/suites/source-reference-v2.jsonl','--execute']],
 ['solver-availability',process.execPath,['tools/check-solvers.mjs']],
 ['reasoning-matrix',process.execPath,['examples/reasoning-demo.mjs']],
 ['contracts',process.execPath,['tools/capabilities.mjs']],
 ['memory-demo',process.execPath,['examples/memory-demo.mjs']]
];
for(const engine of ['holo','sqlite','scan','hybrid'])jobs.push(['data-'+engine,process.execPath,['tools/check-data.mjs','--dir','datasets/seed','--execute','--engine',engine,'--out',reportDir+'/memory/data-'+engine+'.json']]);
for(const role of ['formalizer','verbalizer'])jobs.push([role+'-dry-run',process.execPath,['training/cli.mjs','train','--dry-run','--role',role,'--model','gemma','--run','verify','--data','datasets/seed']]);
const groups={
 core:jobs.filter(job=>!job[0].startsWith('data-')&&!job[0].endsWith('-dry-run')),
 'associative-data':jobs.filter(job=>['data-validation','data-sharded','data-holo'].includes(job[0])),
 'exact-data':jobs.filter(job=>['data-sqlite','data-scan','data-hybrid'].includes(job[0])),
 training:jobs.filter(job=>job[0].endsWith('-dry-run'))
};
const report=file=>path.join(reportDir,file);
const metadata={sourceFingerprint,profile:'sop-agent-3',node:process.version,platform:process.platform,arch:process.arch,neuralModelTested:false,trainingExecuted:false};
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
