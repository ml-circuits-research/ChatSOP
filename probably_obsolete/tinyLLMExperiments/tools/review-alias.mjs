#!/usr/bin/env node
/** Adds one reviewed surface to a vocabulary circuit (knowledge grammar, DS004 "Lexicon wires"): an entity gets an `alias` line, a predicate gets a
 *  `form` line in its lexeme of the review's language (a new lexeme when it has none). The review must identify the reviewer and the evidence.
 *  Never merges silently: a surface that already names another symbol after accent folding is refused unless the review sets keepAmbiguous. */
import fs from 'node:fs';import {cliArgs,loadJSON,assert,atomic,digest} from '../lib/util.mjs';import {normalize,Lexicon} from '../sop/lexicon.mjs';import {parse} from '../sop/knowledge/lexical.mjs';
const a=cliArgs();assert(a.ontology&&a.review&&a.out,'Use --ontology ... --review ... --out ...');
const review=loadJSON(a.review,null);assert(review?.verdict==='accept'&&review.reviewer&&review.evidence,'Review must identify reviewer and evidence');
assert(/^[a-z]{2,3}$/.test(review.language)&&typeof review.surface==='string','Language and surface required');
const source=fs.readFileSync(a.ontology,'utf8'),lex=new Lexicon(source),parsed=parse(source),w=parsed.wires.find(x=>x.id===review.canonicalId&&['entity','predicate'].includes(x.type));assert(w,'Unknown canonical ID');
const folded=normalize(review.surface).normalize('NFD').replace(/\p{M}/gu,'');
const collisions=lex.entries.filter(e=>e.folded===folded&&e.kind===w.type&&['und',review.language].includes(e.language)&&e.id!==review.canonicalId);
assert(!collisions.length||review.keepAmbiguous===true,'Surface also names another ID after accent folding; do not silently merge them');
const lines=source.split('\n'),lastLine=wire=>{const next=parsed.wires.find(x=>x.line>wire.line);let end=(next?next.line-1:lines.length)-1;while(end>wire.line-1&&!lines[end].trim())end--;return end;};
let output;
if(w.type==='entity'){const at=lastLine(w);lines.splice(at+1,0,'  alias '+review.language+' '+JSON.stringify(review.surface));output=lines.join('\n');}
else{const lexeme=parsed.wires.find(x=>x.type==='lexeme'&&x.fields.some(f=>f.key==='of'&&f.value.trim()===w.id)&&x.fields.some(f=>f.key==='language'&&f.value.trim()===review.language));
 if(lexeme){const forms=lexeme.fields.filter(f=>f.key==='form'),at=forms.length?forms.at(-1).line-1:lastLine(lexeme);lines.splice(at+1,0,'  form '+JSON.stringify(review.surface));output=lines.join('\n');}
 else{const frame=lex.predicates[w.id].roles.map(r=>r.name).join(' ');output=source.replace(/\s*$/,'\n')+`\n@lx_${w.id}_${review.language}_reviewed lexeme\n  of ${w.id}\n  language ${review.language}\n  pos verb\n  form ${JSON.stringify(review.surface)}\n  frame ${frame}\n  source ${JSON.stringify('reviewed by '+review.reviewer+': '+review.evidence)}\n`;}}
new Lexicon(output);atomic(a.out,output);console.log(JSON.stringify({oldSHA:digest(source),newSHA:digest(output),reviewer:review.reviewer,ambiguityRetained:collisions.length>0},null,2));
