import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {atom,rule} from '../lib/types.mjs';import {assert,variable} from '../lib/util.mjs';
/** Only an allowlisted typed AST is compiled, never LLM-supplied code. */
export function compileSMT(problem,{timeoutMs=3000}={}){
 const vars=problem.vars;assert(vars&&typeof vars==='object'&&!Array.isArray(vars),'vars object expected');
 const names=Object.keys(vars);assert(names.length<=64,'At most 64 variables');
 let nodes=0;const declarations=[];
 for(const name of names){assert(/^[a-z][a-z0-9_]{0,31}$/.test(name),'Invalid variable name');const v=vars[name];assert(v&&v.sort==='Int','Only Int variables are supported');assert(Object.keys(v).every(k=>['sort','min','max'].includes(k)),'Unknown variable field');declarations.push(`(declare-const ${name} Int)`);for(const [k,op] of [['min','>='],['max','<=']])if(v[k]!==undefined){assert(Number.isSafeInteger(v[k]),'Integer bound expected');declarations.push(`(assert (${op} ${name} ${int(v[k])}))`);}if(v.min!==undefined&&v.max!==undefined)assert(v.min<=v.max,'Contradictory variable bounds');}
 const check=(x,type)=>{assert(++nodes<=4000,'Expression too large');if(Number.isSafeInteger(x)){assert(type==='Int','Expected Boolean expression');return int(x);}if(typeof x==='string'){assert(type==='Int'&&names.includes(x),'Undeclared variable or sort mismatch');return x;}
 assert(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>['op','a'].includes(k))&&Array.isArray(x.a),'Invalid expression');
 const binary={add:['+','Int','Int'],sub:['-','Int','Int'],mul:['*','Int','Int'],eq:['=','Int','Bool'],ne:['distinct','Int','Bool'],lt:['<','Int','Bool'],le:['<=','Int','Bool'],gt:['>','Int','Bool'],ge:['>=','Int','Bool']};
 if(binary[x.op]){const [symbol,input,output]=binary[x.op];assert(type===output&&x.a.length===2,'Wrong operator arity/type');if(x.op==='mul')assert(x.a.some(Number.isSafeInteger),'Only multiplication by an integer constant is allowed');return `(${symbol} ${x.a.map(a=>check(a,input)).join(' ')})`;}
 assert(type==='Bool'&&['and','or','not'].includes(x.op),'Unsupported operator');assert(x.op==='not'?x.a.length===1:x.a.length>=1&&x.a.length<=32,'Invalid Boolean arity');return `(${x.op} ${x.a.map(a=>check(a,'Bool')).join(' ')})`;
 };
 assert(Array.isArray(problem.constraints)&&problem.constraints.length<=256,'Invalid constraint list');
 const prefix=`(set-option :timeout ${timeoutMs})\n(set-logic QF_LIA)\n`+declarations.join('\n')+'\n'+problem.constraints.map(x=>`(assert ${check(x,'Bool')})`).join('\n')+'\n';
 const claim=problem.claim===undefined?null:check(problem.claim,'Bool');return {prefix,claim};
}
function int(n){return n<0?`(- ${-n})`:String(n);}
function z3Run(text,timeoutMs){const r=spawnSync(process.env.Z3_BIN??'z3',['-in','-smt2'],{input:text,encoding:'utf8',timeout:timeoutMs+1000,maxBuffer:1024*1024});if(r.error)throw Error(`Z3 unavailable or timed out: ${r.error.message}`);if(r.status!==0)throw Error(`Z3 failed: ${r.stderr||r.stdout}`);return r.stdout.trim();}
export function solve(problem,{timeoutMs=3000}={}){
 const {prefix,claim}=compileSMT(problem,{timeoutMs});const status=z3Run(prefix+'(check-sat)\n',timeoutMs).split(/\s+/)[0];
 if(status==='unsat')return {status:'inconsistent',meaning:'The stated conditions have no model; no arbitrary conclusion is accepted.'};
 if(status!=='sat')return {status:'unknown',meaning:'Solver did not decide within its limits.'};
 if(!claim)return {status:'sat',witness:z3Run(prefix+'(check-sat)\n(get-model)\n',timeoutMs),meaning:'A satisfying assignment exists; it is not a uniquely entailed answer.'};
 const notClaim=z3Run(prefix+`(assert (not ${claim}))\n(check-sat)\n`,timeoutMs).split(/\s+/)[0];
 const yesClaim=z3Run(prefix+`(assert ${claim})\n(check-sat)\n`,timeoutMs).split(/\s+/)[0];
 return {status:notClaim==='unsat'?'entailed':yesClaim==='unsat'?'refuted':'unknown',satisfiable:true,checks:{withNegatedClaim:notClaim,withClaim:yesClaim}};
}
/** SWI-Prolog reference backend for precisely the same function-free Horn fragment. */
export function compileProlog(facts,rules,{timeoutMs=3000,maxFacts=10000}={}){
 const enc=x=>"'"+Buffer.from(String(x),'utf8').toString('hex')+"'";
 const emit=(a,vars)=>`rw(${enc(a.p)},[${a.a.map(x=>{if(variable(x)){if(!vars.has(x))vars.set(x,'V'+vars.size);return vars.get(x);}return typeof x==='number'?`n(${x})`:`s(${enc(x)})`;}).join(',')}],${a.neg?1:0})`;
 let program=':- use_module(library(http/json)).\n:- use_module(library(solution_sequences)).\n:- use_module(library(time)).\n:- table rw/3.\n:- discontiguous rw/3.\n';
 for(const f of facts)program+=emit(atom(f,{ground:true}),new Map())+'.\n';
 for(const rr of rules){const r=rule(rr),vars=new Map();program+=emit(r.then,vars)+' :- '+r.if.map(a=>emit(a,vars)).join(', ')+'.\n';}
 // An empty knowledge base still defines the predicate.
 program+='rw(_,_,_) :- fail.\n';
 program+='term_json(s(X), _{s:X}).\nterm_json(n(X), _{n:X}).\n';
 program+=`main :- call_with_time_limit(${timeoutMs/1000},findnsols(${maxFacts+1},_{p:P,a:J,neg:N},(rw(P,A,N),maplist(term_json,A,J)),Rows)),json_write_dict(current_output,Rows),nl,halt.\n:- initialization(main, main).\n`;
 return program;
}
export function runSWI(facts,rules,{timeoutMs=3000,maxFacts=10000}={}){
 const program=compileProlog(facts,rules,{timeoutMs,maxFacts});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-swipl-'));try{const file=path.join(dir,'program.pl');fs.writeFileSync(file,program);const r=spawnSync(process.env.SWIPL_BIN??'swipl',['-q','-f',file],{encoding:'utf8',timeout:timeoutMs+1500,maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw Error(`SWI-Prolog failed: ${r.error?.message??r.stderr}`);const raw=JSON.parse(r.stdout);return {complete:raw.length<=maxFacts,atoms:raw.slice(0,maxFacts).map(x=>({p:Buffer.from(x.p,'hex').toString('utf8'),a:x.a.map(v=>'n'in v?v.n:Buffer.from(v.s,'hex').toString('utf8')),neg:x.neg===1}))};}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
