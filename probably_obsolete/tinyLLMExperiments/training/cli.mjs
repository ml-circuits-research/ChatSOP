#!/usr/bin/env node
/** Host-side training controller. ML operations remain in training/python. */
import {spawn, spawnSync} from 'node:child_process';
import {createHash, timingSafeEqual} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync, openSync, readSync, closeSync, renameSync, realpathSync} from 'node:fs';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {jsonlExists, shardPaths} from '../lib/jsonl-shards.mjs';
import {resolveDatasetPath} from '../lib/dataset-paths.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.TRAIN_PYTHON || 'python3';
const help=`Usage: node training/cli.mjs <command> [options]
  preflight [--cpu] [--hold-seconds 0..300] [--model NAME --run NAME --role ROLE --resume]
  download --model NAME [--config FILE]
  train --model NAME --run NAME --role formalizer|verbalizer|shared|proofreader --data DIR --qualification FILE --authorization FILE [--config FILE] [--max-steps N] [--cpu] [--full] [--resume] [--dry-run]
  token-audit --model NAME --role formalizer|verbalizer --data DIR [--out FILE]
  merge --model NAME --run NAME --role proofreader|formalizer|verbalizer [--checkpoint best|latest]
  predict --model NAME --run NAME --role formalizer --suite FILE --out FILE --timing FILE [--checkpoint best|latest] [--cpu] [--sample N] [--threads N]
    (seq2seq recipes only: greedy predictions from the message alone, training/python/predict_seq2seq.py)
  serve --model NAME --run NAME [--port N] [--cpu]
  serve-cpu --model NAME --run NAME --role proofreader|formalizer|verbalizer [--port N]
  export-gguf --model NAME --run NAME --role proofreader|formalizer|verbalizer
    (proofreader is the role of the LanguageProofingLLM and SymbolicProofingLLM runs; formalizer and verbalizer are archived roles)
  build-llama --ref PINNED_COMMIT (existing checkout only)
  spark-shell (SPARK_IMAGE must name a reviewed, locally available Podman image)

The model cache is models/<model>/bases/<40-character revision>/; run outputs are
models/<model>/<run>/<role>/. No operation installs dependencies. Run download
explicitly before train or token-audit. Help and dry-run do not write outputs.
`;
function fail(message){throw new Error(message);}
function options(args){const out={};for(let i=0;i<args.length;i++) {const arg=args[i];if(!arg.startsWith('--'))fail(`Unexpected argument ${arg}`);const name=arg.slice(2);if(!['model','run','role','config','data','out','max-steps','checkpoint','port','ref','qualification','authorization','hold-seconds','suite','timing','sample','threads','cpu','full','resume','dry-run'].includes(name))fail(`Unknown option ${arg}`);if(Object.hasOwn(out,name))fail(`Duplicate option ${arg}`);if(['cpu','full','resume','dry-run'].includes(name))out[name]=true;else {if(!args[++i]||args[i].startsWith('--'))fail(`Missing value for ${arg}`);out[name]=args[i];}}return out;}
function segment(v,field){if(!v||! /^(?!\.)(?!.*\.\.)(?!bases$)[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(v))fail(`Invalid ${field}: use one safe path segment`);return v;}
function integer(v,name,min,max){const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)fail(`Invalid ${name}: expected ${min}..${max}`);return n;}
function role(v){if(!['formalizer','verbalizer','shared','proofreader'].includes(v))fail('Role must be formalizer, verbalizer, shared or proofreader');return v;}
/** Qualification schema by role: 'formalizer'/'verbalizer' targets are SOP (checked by parsing and by SOP
 * execution-equivalence against a verification world); 'proofreader' targets are plain text repairs of the user's
 * own message (checked by the frozen-rules oracle of tools/research/proofing-oracle.mjs, not by parsing the target
 * as SOP), so it has its own check names, dataset_files pattern and (empty) contract file list — never the SOP
 * contract, which does not apply to a text-target role. Added 2026-09-30 for run train-proofreader-gemma270m-v1. */
function qualificationSchema(role){
  if(role==='proofreader')return {checks:['oracle_grounding','meaning_preservation','leakage','split_integrity','source_rights','token_budget'],
    dataset_files_pattern:/^proofreader\/(train|dev)\.jsonl$/,contract_files:[]};
  return {checks:qualificationChecks,dataset_files_pattern:/^(formalizer|verbalizer)\/(train|dev)\.jsonl$/,contract_files:contractFiles};
}
function file(p){let path=resolve(p);if(!existsSync(path))path=resolve(root,resolveDatasetPath(p));if(!existsSync(path))fail(`Missing input: ${path}`);return path;}
function json(p){try{return JSON.parse(readFileSync(p,'utf8'));}catch(e){fail(`Invalid JSON ${p}: ${e.message}`);}}
function cfgPath(o){return file(o.config||join(root,'config',`train-${segment(o.model,'model')}.json`));}
function config(o){const path=cfgPath(o),value=json(path);if(!value.model_id||typeof value.model_id!=='string')fail(`Missing model_id in ${path}`);for(const field of ['max_length','epochs','batch_size','gradient_accumulation','save_every'])integer(value[field],field,1,1000000);return {path,value};}
function baseRoot(o){return join(root,'models',segment(o.model,'model'),'bases');}
function runRoot(o){return join(root,'models',segment(o.model,'model'),segment(o.run,'run'));}
function lockPath(){return join(root,'models','.training.lock');}
function externalOwner(){if(!process.env.TRAIN_EXTERNAL_LOCK)return null;if(process.env.TRAIN_EXTERNAL_LOCK!=='1'||!process.env.TRAIN_LOCK_TOKEN||process.env.TRAIN_LOCK_TOKEN.length<32)fail('Invalid external lock authorization');const owner=json(file(join(lockPath(),'owner.json')));const supplied=Buffer.from(process.env.TRAIN_LOCK_TOKEN),actual=Buffer.from(owner.token||'');if(owner.kind!=='container'||!Number.isSafeInteger(owner.pid)||owner.pid<1||supplied.length!==actual.length||!timingSafeEqual(supplied,actual))fail('Container training lock owner/token mismatch; refusing launch');return owner;}
function checkLock(){const external=externalOwner();if(external){if(existsSync(join(lockPath(),'job')))fail('Another operation holds this container training lock');return;}if(existsSync(lockPath()))fail(`Host training lock exists: ${lockPath()}; inspect its owner before manually removing a stale lock`);}
function limits(){const values={min_disk_gib:Number(process.env.TRAIN_MIN_FREE_GIB??30),warn_disk_gib:Number(process.env.TRAIN_WARN_FREE_GIB??40),stop_disk_gib:Number(process.env.TRAIN_STOP_FREE_GIB??16),min_host_gib:Number(process.env.TRAIN_MIN_AVAILABLE_GIB??16),stop_host_gib:Number(process.env.TRAIN_STOP_AVAILABLE_GIB??16),min_cuda_gib:Number(process.env.TRAIN_MIN_CUDA_FREE_GIB??48)};if(Object.values(values).some(x=>!Number.isFinite(x)||x<1)||values.min_disk_gib<values.stop_disk_gib||values.min_host_gib<values.stop_host_gib)fail('Invalid TRAIN resource thresholds; start floors must be >= stop floors');return values;}
function diskAndMemory(){const floor=limits(),disk=statfsSync(root,{bigint:true}),free=Number(disk.bavail*disk.bsize)/(1024**3);if(free<floor.min_disk_gib)fail(`Insufficient disk: ${free.toFixed(1)} GiB free; need ${floor.min_disk_gib} GiB`);const info=readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+) kB/m),available=(info?Number(info[1])*1024:os.freemem())/(1024**3);if(available<floor.min_host_gib)fail(`Insufficient available host memory: ${available.toFixed(1)} GiB; need ${floor.min_host_gib} GiB`);return {diskFreeGiB:+free.toFixed(1),availableMemoryGiB:+available.toFixed(1),limits:floor};}
function safetyStopReason(){
  const disk=statfsSync(root,{bigint:true});
  const free=Number(disk.bavail*disk.bsize)/(1024**3);
  const memory=readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+) kB/m);
  const available=(memory?Number(memory[1])*1024:os.freemem())/(1024**3);
  const floor=limits();
  if(free<floor.stop_disk_gib)return `Disk floor reached: ${free.toFixed(1)} GiB free`;
  if(available<floor.stop_host_gib)return `Memory floor reached: ${available.toFixed(1)} GiB available`;
  return null;
}
function dependencies(modules){const probe=spawnSync(python,['-c',`import importlib.util,importlib.metadata,json,sys
missing=[name for name in sys.argv[1:] if importlib.util.find_spec(name) is None]
if missing: print('Missing Python dependencies: '+', '.join(missing),file=sys.stderr);sys.exit(1)
print(json.dumps({'python':sys.executable,'python_version':sys.version.split()[0],'packages':{name:importlib.metadata.version(name) for name in sys.argv[1:]}}))`, ...modules],{encoding:'utf8'});if(probe.error)fail(`Python unavailable (${python}): ${probe.error.message}; set TRAIN_PYTHON to a reviewed, compatible interpreter`);if(probe.status!==0)fail(`${probe.stderr.trim()||'Python dependency probe failed'}; set TRAIN_PYTHON to a prepared environment, see training/python/requirements.txt (no automatic installation)`);return {...JSON.parse(probe.stdout),CPATH:process.env.CPATH||null,TRITON_PTXAS_PATH:process.env.TRITON_PTXAS_PATH||null,PYTORCH_CUDA_ALLOC_CONF:process.env.PYTORCH_CUDA_ALLOC_CONF||null};}
function hostGate(modules){checkLock();const environment=dependencies(modules);return {...diskAndMemory(),environment};}
async function locked(work){const external=externalOwner();if(external){const job=join(lockPath(),'job');try{mkdirSync(job);}catch(e){if(e.code==='EEXIST')fail(`Another operation holds ${job}`);throw e;}writeFileSync(join(job,'owner.json'),JSON.stringify({pid:process.pid,kind:'operation',startedAt:new Date().toISOString()})+'\n');try{return await work();}finally{const owner=json(file(join(job,'owner.json')));if(owner.pid!==process.pid)fail('Container job owner changed; refusing to remove another operation lock');rmSync(job,{recursive:true});}}mkdirSync(join(root,'models'),{recursive:true});const path=lockPath();try{mkdirSync(path);}catch(e){if(e.code==='EEXIST')fail(`Host training lock exists: ${path}; inspect owner before removal`);throw e;}try{writeFileSync(join(path,'owner.json'),JSON.stringify({pid:process.pid,hostname:os.hostname(),kind:'native',startedAt:new Date().toISOString(),argv:process.argv.slice(2)})+'\n');return await work();}finally{rmSync(path,{recursive:true});}}
function child(bin,args,{ownedGroup=false,monitor=false}={}){
  return new Promise((ok,bad)=>{
    const proc=spawn(bin,args,{cwd:root,stdio:'inherit',detached:ownedGroup});
    let interrupted=false,stopReason=null;
    const signal=name=>{
      interrupted=true;
      try{if(ownedGroup)process.kill(-proc.pid,name);else proc.kill(name);}
      catch(e){if(e.code!=='ESRCH')throw e;}
    };
    const onInt=()=>signal('SIGINT'),onTerm=()=>signal('SIGTERM');
    process.once('SIGINT',onInt);
    process.once('SIGTERM',onTerm);
    const guard=monitor?setInterval(()=>{
      if(interrupted)return;
      try{stopReason=safetyStopReason();}
      catch(e){stopReason=`Cannot measure host resources: ${e.message}`;}
      if(stopReason){console.error(`${stopReason}; stopping only owned ${bin} process`);signal('SIGTERM');}
    },30000):null;
    guard?.unref();
    const cleanup=()=>{clearInterval(guard);process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);};
    proc.once('error',e=>{cleanup();bad(e);});
    proc.once('exit',(code,reason)=>{
      cleanup();
      if(interrupted&&ownedGroup){try{process.kill(-proc.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
      if(code===0&&!interrupted)ok();else bad(new Error(stopReason||`${bin} exited ${reason||code}`));
    });
  });
}
// A .jsonl path may be stored as shards (lib/jsonl-shards.mjs); its hash is that of the concatenated parts, equal to the unsplit file's.
function sha(path){const hash=createHash('sha256'),chunk=Buffer.allocUnsafe(1024*1024);for(const part of path.endsWith('.jsonl')&&jsonlExists(path)?shardPaths(path):[path]){const fd=openSync(part,'r');try{let n;while((n=readSync(fd,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,n));}finally{closeSync(fd);}}return hash.digest('hex');}
function dataset(o,splits){if(!o.data)fail('Specify --data DIR explicitly (e.g. datasets_archive/formalizer-v1, projected by tools/research/prepare-experiment.mjs)');const data=file(o.data),roles=role(o.role)==='shared'?['formalizer','verbalizer']:[o.role],hashes={},rows={};for(const split of splits){rows[split]=0;for(const r of roles){const path=resolve(join(data,r,`${split}.jsonl`));if(!jsonlExists(path))fail(`Missing input: ${path}`);hashes[path]=sha(path);const lines=shardPaths(path).flatMap(part=>readFileSync(part,'utf8').split(/\r?\n/)).filter(Boolean);for(const [index,line] of lines.entries()){let value;try{value=JSON.parse(line);}catch{fail(`Invalid JSONL ${path}:${index+1}`);}if(typeof value.prompt!=='string'||typeof value.target!=='string')fail(`Invalid prompt/target at ${path}:${index+1}`);}rows[split]+=lines.length;}if(!rows[split])fail(`Empty ${split} dataset under ${data}`);}const versionPath=join(data,'VERSION'),manifestPath=join(data,'manifest.json');const version=existsSync(versionPath)?json(versionPath):null;if(version!==null&&(!Number.isSafeInteger(version.counter)||version.counter<1||typeof version.label!=='string'||!version.label.trim()))fail(`Invalid dataset VERSION: ${versionPath}`);return {data,hashes,rows,version,version_sha256:version===null?null:sha(versionPath),manifest_sha256:existsSync(manifestPath)?sha(manifestPath):null};}
const contractFiles=['sop/parser.mjs','sop/runtime.mjs','server/agent.mjs','server/prompts/formalizer.txt','config/knowledge/demo/0001-vocabulary.sop','tools/datasets/schema.mjs','tools/research/prepare-experiment.mjs'];
const qualificationChecks=['syntax_execution','semantic_review','leakage','coverage','source_rights','independent_reference_suite'];
function exactKeys(value,keys,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))
    fail(`${name} must contain exactly: ${keys.join(', ')}`);
}
function digest(value,name){if(!/^[a-f0-9]{64}$/.test(value||''))fail(`Invalid SHA-256 for ${name}`);}
function inside(base,relative,name){
  if(typeof relative!=='string'||!relative||relative.startsWith('/')||relative.split(/[\\/]/).includes('..'))
    fail(`${name} must be a relative file path`);
  const parent=realpathSync(base),target=realpathSync(file(join(base,relative)));
  if(!target.startsWith(parent+sep)||!statSync(target).isFile())fail(`${name} escapes ${parent}`);
  return target;
}
function timestamp(value,name){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)||!Number.isFinite(Date.parse(value)))
    fail(`Invalid ISO timestamp in ${name}`);
}
function qualification(o,ds){
  if(!o.qualification)fail('Dataset qualification required: pass --qualification FILE; fixture manifest alone is not approval');
  const path=file(o.qualification),record=json(path);
  if(record.format!=='chatsop-dataset-qualification-v1'||record.status!=='qualified')
    fail('Dataset qualification format/status mismatch');
  if(!ds.manifest_sha256||!ds.version_sha256)fail('Qualified training requires dataset manifest.json and VERSION');
  for(const [field,actual] of [['dataset_manifest_sha256',ds.manifest_sha256],['dataset_version_sha256',ds.version_sha256]]){
    digest(record[field],field);if(record[field]!==actual)fail(`${field} does not match dataset`);
  }
  const schema=qualificationSchema(o.role);
  const selected=Object.keys(ds.hashes).map(path=>path.slice(ds.data.length+1).split(sep).join('/'));
  const files=record.dataset_files;
  if(!files||typeof files!=='object'||Array.isArray(files)||!Object.keys(files).length)
    fail('Qualification needs reviewed dataset_files');
  for(const name of Object.keys(files)){
    if(!schema.dataset_files_pattern.test(name))fail(`Unreviewed dataset path in qualification: ${name}`);
    digest(files[name],name);
    if(sha(inside(ds.data,name,'qualification dataset file'))!==files[name])fail(`Qualification dataset file changed: ${name}`);
  }
  for(const name of selected)if(files[name]!==ds.hashes[join(ds.data,...name.split('/'))])fail(`Qualification missing or mismatched ${name}`);
  exactKeys(record.contract_files,schema.contract_files,'contract_files');
  for(const name of schema.contract_files){
    digest(record.contract_files[name],name);
    if(sha(inside(root,name,'contract file'))!==record.contract_files[name])fail(`SOP contract changed: ${name}`);
  }
  exactKeys(record.checks,schema.checks,'checks');
  exactKeys(record.evidence,schema.checks,'evidence');
  for(const name of schema.checks){
    if(record.checks[name]!==true)fail(`Qualification check failed: ${name}`);
    const evidence=record.evidence[name];
    exactKeys(evidence,['path','sha256'],`evidence.${name}`);
    digest(evidence.sha256,`evidence.${name}`);
    if(sha(inside(root,evidence.path,`evidence.${name}`))!==evidence.sha256)
      fail(`Qualification evidence changed: ${name}`);
  }
  if(!record.reviewer||!['human','principal_integrator'].includes(record.reviewer.kind)||
    typeof record.reviewer.id!=='string'||!record.reviewer.id.trim())fail('Missing dataset qualification reviewer');
  timestamp(record.reviewer.reviewed_at,'reviewer.reviewed_at');
  return {path,sha256:sha(path)};
}
function authorization(o,ds,qualified){
  if(!o.authorization)fail('NEW explicit user authorization required: pass --authorization FILE; no training allowed now');
  const path=file(o.authorization),receipt=json(path);
  if(receipt.format!=='chatsop-training-authorization-v1'||receipt.authorization!=='explicit-user-approval'||
    receipt.approved!==true||receipt.approved_by!=='user'||typeof receipt.instruction!=='string'||!receipt.instruction.trim())
    fail('Training authorization is not a NEW explicit user approval');
  timestamp(receipt.approved_at,'approved_at');
  const expected={model:o.model,run:o.run,role:o.role,qualification_sha256:qualified.sha256,
    recipe_sha256:sha(cfgPath(o)),dataset_manifest_sha256:ds.manifest_sha256,dataset_version_sha256:ds.version_sha256};
  for(const [name,value] of Object.entries(expected)){
    if(name.endsWith('_sha256'))digest(receipt[name],name);
    if(receipt[name]!==value)fail(`Authorization ${name} does not match this exact run`);
  }
  return {path,sha256:sha(path)};
}
function base(o,cfg){const dir=baseRoot(o);if(!existsSync(dir))fail(`Missing pinned base for ${o.model}; run download first`);const matches=readdirSync(dir,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^[a-f0-9]{40}$/.test(x.name)&&existsSync(join(dir,x.name,'recall-model-lock.json')));if(matches.length!==1)fail(`Expected exactly one pinned base in ${dir}; found ${matches.length}. Select a single revision explicitly in config and remove ambiguity manually`);const path=join(dir,matches[0].name),manifest=json(join(path,'recall-model-lock.json'));if(manifest.model_id!==cfg.model_id||manifest.revision!==matches[0].name||manifest.location!==path)fail(`Base identity mismatch in ${path}`);if(cfg.revision&&!['main',manifest.revision].includes(cfg.revision))fail('Base revision conflicts with recipe');for(const name of ['config.json','tokenizer_config.json'])file(join(path,name));if(!readdirSync(path).some(name=>name.endsWith('.safetensors')))fail(`Missing base weights in ${path}`);return {path,manifest};}
function checkpoint(path,expected,optimizer=false){
  const state=json(file(join(path,'state.json')));
  for(const key of ['role','model_id','revision','dataset_sha256','full'])
    if(JSON.stringify(state[key])!==JSON.stringify(expected[key]))fail(`Checkpoint mismatch for ${key} in ${path}`);
  for(const key of ['step','epoch','next_batch'])
    if(!Number.isSafeInteger(state[key])||state[key]<0)fail(`Invalid checkpoint ${key}: ${path}`);
  const weights=join(path,state.full?'model':'adapter');
  file(join(weights,state.full?'config.json':'adapter_config.json'));
  const files=readdirSync(weights);
  if(!files.some(x=>/\.(safetensors|bin)$/.test(x))&&!files.some(x=>/\.(safetensors|bin)\.index\.json$/.test(x)))
    fail(`Missing checkpoint weights in ${weights}`);
  file(join(path,'tokenizer','tokenizer_config.json'));
  file(join(path,'rng.pt'));
  if(optimizer)file(join(path,'optimizer.pt'));
  const marker=json(file(join(path,'checkpoint.json')));
  if(marker.step!==state.step||marker.role!==state.role||marker.complete!==true||!marker.artifacts||
    !marker.artifacts['state.json']||!marker.artifacts['rng.pt']||!marker.artifacts['tokenizer/tokenizer_config.json']||
    !Object.keys(marker.artifacts).some(x=>x.startsWith(`${state.full?'model':'adapter'}/`)))
    fail(`Incomplete checkpoint marker: ${path}`);
  for(const [name,digest] of Object.entries(marker.artifacts)){
    if(name.startsWith('/')||name.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(digest))
      fail(`Invalid checkpoint artifact record: ${name}`);
    const target=file(join(path,name));
    if(!statSync(target).isFile()||sha(target)!==digest)fail(`Corrupt checkpoint artifact: ${target}`);
  }
  if(optimizer&&!marker.artifacts['optimizer.pt'])fail(`Untracked optimizer state in ${path}`);
  if(path.endsWith('/best')&&state.role==='formalizer'&&!Array.isArray(state.best_semantic_score))
    fail(`Formalizer best lacks semantic validation: ${path}`);
  return state;
}
function identity(o,cfg,baseInfo,ds,environment,gates={}){return {model:o.model,run:o.run,role:o.role,model_id:cfg.model_id,revision:baseInfo.manifest.revision,dataset_sha256:ds.hashes,dataset_version:ds.version,dataset_version_sha256:ds.version_sha256,dataset_manifest_sha256:ds.manifest_sha256,recipe_sha256:sha(cfgPath(o)),qualification_sha256:gates.qualification_sha256,authorization_sha256:gates.authorization_sha256,full:!!o.full,max_steps:Number(o['max-steps']||0),device:o.cpu?'cpu':'cuda',environment,resource_thresholds:limits()};}
function runManifest(o,expected,resume){const path=join(runRoot(o),o.role),manifest=join(path,'identity.json');if(resume){const saved=json(file(manifest));for(const [key,value] of Object.entries(expected))if(JSON.stringify(saved[key])!==JSON.stringify(value))fail(`Run identity mismatch for ${key} in ${manifest}`);checkpoint(join(path,'latest'),expected,true);}else if(existsSync(path)&&readdirSync(path).length)fail(`Run role directory is not empty: ${path}. Use a new run or --resume.`);return {path,manifest};}
async function download(o){const {value:cfg}=config(o);const resources=hostGate(['huggingface_hub']);const response=await fetch(`https://huggingface.co/api/models/${cfg.model_id}/revision/${encodeURIComponent(cfg.revision||'main')}`,{headers:process.env.HF_TOKEN?{Authorization:`Bearer ${process.env.HF_TOKEN}`}:{}});if(!response.ok)fail(`Hub revision lookup failed (${response.status}) for ${cfg.model_id}; no output written`);const info=await response.json(),revision=info.sha;if(!/^[a-f0-9]{40}$/.test(revision))fail('Hub did not return an immutable 40-character commit SHA');if(cfg.revision&&cfg.revision!=='main'&&revision!==cfg.revision)fail('Hub revision differs from the pinned recipe SHA');const dest=join(baseRoot(o),revision);if(existsSync(dest))fail(`Base already exists: ${dest}; verify manifest or select another revision`);console.log(JSON.stringify({command:'download',model:o.model,model_id:cfg.model_id,revision,...resources}));await locked(async()=>{const staging=dest+'.partial-'+process.pid;mkdirSync(staging,{recursive:true});try{await child(python, [join(root,'training/python/download_model.py'),'--model-id',cfg.model_id,'--revision',revision,'--output',staging], {ownedGroup: true, monitor: true});for(const name of ['config.json','tokenizer_config.json'])file(join(staging,name));if(!readdirSync(staging).some(name=>name.endsWith('.safetensors')))fail(`Pinned base has no safetensors weights: ${staging}`);const manifest={model_id:cfg.model_id,revision,location:dest,downloaded_at:new Date().toISOString()};if(cfg.license){manifest.license=cfg.license;manifest.license_source=cfg.license_source||null;}if(cfg.upstream)manifest.upstream=cfg.upstream;if(cfg.model_id==='Qwen/Qwen3-0.6B'&&revision==='c1899de289a04d12100db370d81485cdf75e47ca'){file(join(staging,'LICENSE'));manifest.license='Apache-2.0';manifest.license_source=`https://huggingface.co/Qwen/Qwen3-0.6B/raw/${revision}/LICENSE`;}writeFileSync(join(staging,'recall-model-lock.json'),JSON.stringify(manifest,null,2)+'\n');renameSync(staging,dest);}catch(e){rmSync(staging,{recursive:true,force:true});throw e;}});}
async function train(o){
  role(o.role);segment(o.run,'run');
  const {value:cfg}=config(o),ds=dataset(o,['train','dev']);
  if(o['max-steps'])integer(o['max-steps'],'max-steps',1,100000000);
  if(o['dry-run']){
    let qualified=null,approved=null,reason=null;
    if(o.qualification){
      try{qualified=qualification(o,ds);if(o.authorization)approved=authorization(o,ds,qualified);}
      catch(error){reason=error.message;}
    }
    console.log(JSON.stringify({training_executed:false,dataset_qualified:!!qualified,training_authorized:!!approved,
      ...(reason?{gate_error:reason}:{}),model:o.model,run:o.run,role:o.role,
      recipe_sha256:sha(cfgPath(o)),dataset_version:ds.version,dataset_manifest_sha256:ds.manifest_sha256,
      rows:ds.rows,output:join(runRoot(o),o.role),base_required_before_training:true},null,2));
    return;
  }
  const qualified=qualification(o,ds),approved=authorization(o,ds,qualified);
  const gates={qualification_sha256:qualified.sha256,authorization_sha256:approved.sha256};
  const pinned=base(o,cfg),resources=hostGate(['torch','transformers','peft','accelerate']);
  const expected=identity(o,cfg,pinned,ds,resources.environment,gates),run=runManifest(o,expected,!!o.resume);
  console.log(JSON.stringify({command:'train',identity:expected,output:run.path,...resources}));
  await locked(async()=>{
    mkdirSync(run.path,{recursive:true});
    if(!o.resume)writeFileSync(run.manifest,JSON.stringify({...expected,created_at:new Date().toISOString()},null,2)+'\n');
    await child(python,[join(root,'training/python/train.py'),'--role',o.role,'--config',cfgPath(o),'--data',ds.data,
      '--output',run.path,'--base',pinned.path,'--identity',run.manifest,
      ...(o['max-steps']?['--max-steps',o['max-steps']]:[]),...(o.cpu?['--cpu']:[]),
      ...(o.full?['--full']:[]),...(o.resume?['--resume']:[])],{ownedGroup:true,monitor:true});
  });
}
async function preflight(o){
  const holdSeconds=integer(o['hold-seconds']??0,'hold-seconds',0,300);
  const resources=hostGate(['torch','transformers','peft','accelerate']);
  if(o.model){
    const {value:cfg}=config(o),pinned=base(o,cfg);
    if(o.run){
      role(o.role);
      const ds=dataset(o,['train','dev']),previous=join(runRoot(o),o.role,'identity.json');
      const saved=existsSync(previous)?json(previous):{};
      const gates={qualification_sha256:saved.qualification_sha256,authorization_sha256:saved.authorization_sha256};
      const expected=identity(o,cfg,pinned,ds,resources.environment,gates);
      runManifest(o,expected,!!o.resume);
    }
  }
  await locked(()=>child(python,[join(root,'training/python/preflight.py'),'--limits',JSON.stringify(resources.limits),
    '--hold-seconds',String(holdSeconds),...(o.cpu?['--cpu']:[])],{ownedGroup:true,monitor:true}));
  console.log(JSON.stringify(resources));
}
async function audit(o){role(o.role);if(o.role==='shared')fail('Token audit requires one role');const {value:cfg}=config(o),pinned=base(o,cfg),ds=dataset(o,['train','dev']);hostGate(['transformers']);const out=resolve(o.out||join(root,'eval/reports/current',`${o.model}-${o.role}-token-audit.json`));await locked(async()=>{mkdirSync(dirname(out),{recursive:true});await child(python,[join(root,'training/python/audit_tokens.py'),'--config',cfgPath(o),'--data',ds.data,'--role',o.role,'--out',out,'--base',pinned.path],{ownedGroup:true,monitor:true});});}
async function merge(o){if(role(o.role)==='shared')fail('Merge requires one role');const path=join(runRoot(o),o.role),identity=json(file(join(path,'identity.json'))),which=o.checkpoint||'best';if(!['best','latest'].includes(which))fail('Checkpoint must be best or latest');const source=join(path,which);checkpoint(source,identity,which==='latest');hostGate(['torch','transformers','peft']);const out=join(path,`merged-${which}`);if(existsSync(out))fail(`Output already exists: ${out}`);await locked(()=>child(python, [join(root,'training/python/merge.py'),'--checkpoint',source,'--output',out,'--base',join(baseRoot(o),identity.revision)], {ownedGroup: true, monitor: true}));}
async function predict(o){
  if(role(o.role)!=='formalizer')fail('predict serves the formalizer role');
  const {value:cfg}=config(o);if(cfg.architecture!=='seq2seq')fail('predict is for seq2seq recipes; decoder-only arms use GGUF and llama-server');
  const path=join(runRoot(o),o.role),id=json(file(join(path,'identity.json'))),which=o.checkpoint||'best';
  if(!['best','latest'].includes(which))fail('Checkpoint must be best or latest');
  checkpoint(join(path,which),id,which==='latest');
  for(const name of ['suite','out','timing'])if(!o[name])fail(`Specify --${name}`);
  const suite=file(o.suite),out=resolve(o.out),timing=resolve(o.timing);
  if(existsSync(out))fail(`Output already exists: ${out}`);
  hostGate(['torch','transformers','sentencepiece']);
  await locked(()=>child(python,[join(root,'training/python/predict_seq2seq.py'),'--checkpoint',join(path,which),'--suite',suite,'--out',out,'--timing',timing,
    '--device',o.cpu?'cpu':'cuda','--threads',String(integer(o.threads||6,'threads',1,64)),...(o.sample?['--sample',String(integer(o.sample,'sample',1,1000000))]:[]),
    '--label',`${o.model}/${o.run}/${which}`],{ownedGroup:true,monitor:true}));
}
async function serve(o){const path=runRoot(o),formal=join(path,'formalizer'),verbal=join(path,'verbalizer');const a=json(file(join(formal,'identity.json'))),b=json(file(join(verbal,'identity.json')));if(a.revision!==b.revision||a.model_id!==b.model_id||a.full||b.full)fail('Serving two adapters requires one matching LoRA base and revision');checkpoint(join(formal,'best'),a);checkpoint(join(verbal,'best'),b);hostGate(['torch','transformers','peft']);const port=integer(o.port||8080,'port',1,65535);await locked(()=>child(python, [join(root,'training/python/serve_adapters.py'),'--formalizer',join(formal,'best'),'--verbalizer',join(verbal,'best'),'--base',join(baseRoot(o),a.revision),'--port',String(port),...(o.cpu?['--cpu']:[])], {ownedGroup: true, monitor: true}));}
async function serveCpu(o){if(role(o.role)==='shared')fail('CPU server needs one role');const path=join(runRoot(o),o.role),which='best';const id=json(file(join(path,'identity.json')));checkpoint(join(path,which),id);const model=join(path,`merged-${which}`,'gguf','q4_k_m.gguf'),bin=process.env.LLAMA_SERVER||join(root,'vendor/llama.cpp/build/bin/llama-server');file(model);file(bin);await child(bin,['-m',model,'--alias',o.role,'--host','127.0.0.1','--port',String(integer(o.port|| (o.role==='formalizer'?8081:8082),'port',1,65535)),'-c',process.env.CONTEXT||'4096','-t',process.env.THREADS||'4','-ngl','0','-np','1','--jinja']);}
async function exportGguf(o){if(role(o.role)==='shared')fail('Export requires one role');const path=join(runRoot(o),o.role),id=json(file(join(path,'identity.json')));checkpoint(join(path,'best'),id);const dir=process.env.LLAMA_CPP_DIR||join(root,'vendor/llama.cpp'),converter=file(join(dir,'convert_hf_to_gguf.py')),quant=file(join(dir,'build/bin/llama-quantize'));dependencies(['torch','transformers','peft']);const merged=join(path,'merged-best');if(!existsSync(merged))await merge({...o,checkpoint:'best'});const out=join(merged,'gguf');mkdirSync(out,{recursive:true});const full=join(out,'f16.gguf');if(existsSync(full))fail(`Export already exists: ${full}`);await child(process.env.CONVERTER_PYTHON||python,[converter,merged,'--outfile',full,'--outtype','f16']);for(const [label,type] of [['q4_k_m','Q4_K_M'],['q8_0','Q8_0']])await child(quant,[full,join(out,`${label}.gguf`),type]);}
async function buildLlama(o){const dir=file(process.env.LLAMA_CPP_DIR||join(root,'vendor/llama.cpp'));file(join(dir,'CMakeLists.txt'));const ref=segment(o.ref,'ref');const revision=spawnSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'});if(revision.error||revision.status!==0)fail('Pinned llama.cpp Git checkout required');if(revision.stdout.trim()!==ref)fail(`llama.cpp checkout ${revision.stdout.trim()} differs from requested ${ref}; switch explicitly before building`);const cmake=spawnSync('cmake',['--version'],{encoding:'utf8'});if(cmake.error||cmake.status!==0)fail('cmake missing; install manually before building');await child('cmake',['-S',dir,'-B',join(dir,'build'),'-DGGML_CUDA=OFF','-DLLAMA_CURL=OFF']);await child('cmake',['--build',join(dir,'build'),'--config','Release','-j',String(integer(process.env.BUILD_JOBS||4,'BUILD_JOBS',1,256))]);}
async function sparkShell(){const image=process.env.SPARK_IMAGE;if(!image)fail('Set SPARK_IMAGE to an inspected local Podman image containing the prepared training environment; no image is pulled automatically');const inspected=spawnSync('podman',['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8'});if(inspected.error||inspected.status!==0)fail(`Podman image unavailable locally for ${image}: ${inspected.stderr?.trim()||inspected.error?.message||'image not found'}; inspect a reviewed image and set SPARK_IMAGE (no auto-pull)`);const id=inspected.stdout.trim();if(!id)fail('Podman image inspect returned no immutable image ID');console.log(`Local Podman image ID: ${id}`);const cache=join(os.homedir(),'.cache/huggingface');mkdirSync(cache,{recursive:true});await child('podman',['run','--rm','-it','--pull=never','--device=nvidia.com/gpu=all','--network=host','--ipc=host','--ulimit','memlock=-1','--ulimit','stack=67108864','-v',`${root}:/workspace`,'-v',`${cache}:/root/.cache/huggingface`,'-e','HF_TOKEN','-w','/workspace','--entrypoint','/bin/bash',id]);}
async function main(){const [cmd,...args]=process.argv.slice(2);if(!cmd||['--help','-h','help'].includes(cmd)){console.log(help);return;}const o=options(args);if(cmd==='preflight')return preflight(o);if(cmd==='download')return download(o);if(cmd==='train')return train(o);if(cmd==='token-audit')return audit(o);if(cmd==='merge')return merge(o);if(cmd==='predict')return predict(o);if(cmd==='serve')return serve(o);if(cmd==='serve-cpu')return serveCpu(o);if(cmd==='export-gguf')return exportGguf(o);if(cmd==='build-llama')return buildLlama(o);if(cmd==='spark-shell')return sparkShell();fail(`Unknown command ${cmd}\n${help}`);}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
