import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Repository} from '../src/repository.js';import {Runtime} from '../src/runtime.js';import {Lexicon} from '../src/lexicon.js';import {publishKnowledge} from '../src/ingest.js';
export const lex=Lexicon.load(new URL('../config/ontology.sop',import.meta.url));
export const schema=lex.predicates;
export const fixture=fs.readFileSync(new URL('../kb/bootstrap.sop',import.meta.url),'utf8');
export const day=s=>Date.parse(s);
export function context({bootstrap=true,memory={},now=day('2026-09-26T12:00:00Z')}={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sop-test-')),repo=new Repository(root,{memory});if(bootstrap)publishKnowledge(repo,'base',fixture,{schema,reviewed:true,knownAt:day('2024-01-01')});else repo.init('base');const session=repo.session('base','alice','s1');return {root,repo,session,run:(s,options={})=>new Runtime({repo,session,schema,now,...options}).run(s),dispose:()=>fs.rmSync(root,{recursive:true,force:true})};}
export const queryProgram=(atom,options='')=>`@q query\n  where ${atom}\n${options}\n@m recall\n  query $q\n@r reason\n  query $q\n  memory $m`;
