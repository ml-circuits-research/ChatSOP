#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {cliArgs,saveJSON} from '../src/util.js';
const a=cliArgs(),out=a.out??'reports/solvers.json';const report={neuralModelTested:false,backends:{}};
for(const [name,command,args]of [['z3','z3',['-version']],['prolog','swipl',['--version']]]){const r=spawnSync(command,args,{encoding:'utf8',timeout:5000});report.backends[name]={available:r.status===0,version:r.status===0?r.stdout.trim():null,error:r.error?.code??(r.status!==0?'not installed':null)};}
fs.mkdirSync('reports/generated',{recursive:true});for(const [command,file,target]of [['compile-smt','examples/constraint.sop','example.smt2'],['compile-prolog','examples/local.sop','example.pl']]){const r=spawnSync(process.execPath,['cli.js',command,'--file',file],{encoding:'utf8',timeout:10000});if(r.status!==0)throw Error(r.stderr);fs.writeFileSync(path.join('reports/generated',target),r.stdout);}
saveJSON(out,report);console.log(JSON.stringify(report,null,2));
