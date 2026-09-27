/** Symbolic multilingual candidate retrieval; scores are rankings, not probabilities. */
import fs from 'node:fs';
import {parse,one,many,words,unquote} from './sop/parser.js';
import {assert} from './util.js';
export const normalize=s=>String(s).normalize('NFC').toLocaleLowerCase('ro').replace(/[şţ]/g,c=>c==='ş'?'ș':'ț').replace(/\s+/g,' ').trim();
const fold=s=>normalize(s).normalize('NFD').replace(/\p{M}/gu,'');
const tokens=s=>s.match(/[\p{L}\p{N}_]+/gu)??[];
export class Lexicon{
 constructor(source){this.entities={};this.predicates={};this.concepts={};this.entries=[];this.index=new Map();const program=parse(source,{allowTypes:['entity','predicate','concept']});
  for(const w of program.wires){assert(['entity','predicate','concept'].includes(w.type),'Ontology is declarative, not executable');const aliases=[],labels={};for(const key of ['label','alias'])for(const line of many(w,key)){const [lang,...rest]=words(line);assert(/^[a-z]{2,3}$/.test(lang)&&rest.length===1,'Use label/alias LANGUAGE "surface"');const surface=unquote(rest[0]);aliases.push({language:lang,surface});if(key==='label')labels[lang]=surface;}
   const item={id:w.id,kind:w.type,labels,aliases};if(w.type==='predicate'){item.args=words(one(w,'args',''));assert(item.args.length>=1&&item.args.length<=4,'Predicate needs 1..4 argument types');item.arity=item.args.length;item.description=unquote(one(w,'description',''));this.predicates[w.id]=item;}else if(w.type==='entity'){item.entityType=one(w,'kind','entity');this.entities[w.id]=item;}else {item.parents=many(w,'is_a');this.concepts[w.id]=item;}
   for(const a of [...aliases,{language:'und',surface:w.id}]){const entry={...a,id:w.id,kind:w.type,norm:normalize(a.surface),folded:fold(a.surface)};const ix=this.entries.length;this.entries.push(entry);for(const t of new Set(tokens(entry.folded))){if(!this.index.has(t))this.index.set(t,new Set());this.index.get(t).add(ix);}}
  }
 }
 static load(file){return new Lexicon(fs.readFileSync(file,'utf8'));}
 candidates(text,{language='auto',maxEntities=12,maxPredicates=10,maxConcepts=6}={}){
  const norm=normalize(text),folded=fold(text),seen=new Set();for(const t of tokens(folded))for(const i of this.index.get(t)??[])seen.add(i);
  const boundary=(s,a)=>{let at=s.indexOf(a);while(at>=0){const left=at===0||!/[\p{L}\p{N}_]/u.test(s[at-1]),right=at+a.length===s.length||!/[\p{L}\p{N}_]/u.test(s[at+a.length]);if(left&&right)return true;at=s.indexOf(a,at+1);}return false;};
  const best=new Map();for(const i of seen){const e=this.entries[i];if(language!=='auto'&&!['und',language].includes(e.language))continue;let score=boundary(norm,e.norm)?100:boundary(folded,e.folded)?85:0;if(!score)continue;score+=Math.min(tokens(e.folded).length,8);const prev=best.get(e.id);if(!prev||prev.score<score)best.set(e.id,{id:e.id,kind:e.kind,score,surface:e.surface,language:e.language});}
  const ranked=[...best.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));const ambiguous=new Map();for(const e of ranked){const k=fold(e.surface);if(!ambiguous.has(k))ambiguous.set(k,[]);ambiguous.get(k).push(e.id);}
  return {entities:ranked.filter(x=>x.kind==='entity').slice(0,maxEntities),predicates:ranked.filter(x=>x.kind==='predicate').slice(0,maxPredicates),concepts:ranked.filter(x=>x.kind==='concept').slice(0,maxConcepts),ambiguities:[...ambiguous].filter(([,ids])=>new Set(ids).size>1).map(([surface,ids])=>({surface,ids})),polarityCues:tokens(norm).filter(t=>['nu','not','never','never','kein','nicht','fără','fara','nunca','non'].includes(t)),truncated:ranked.filter(x=>x.kind==='entity').length>maxEntities||ranked.filter(x=>x.kind==='predicate').length>maxPredicates};
 }
}
export function microContext(text,lexicon,{language='auto',now='2026-09-26',maxBytes=3200,recent=[]}={}){
 assert(Buffer.byteLength(text)<=1600,'Message exceeds micro-context budget; split by discourse units, do not truncate it');const c=lexicon.candidates(text,{language});const payload={language,now,entities:c.entities.map(e=>({id:e.id,label:e.surface,type:lexicon.entities[e.id].entityType})),predicates:c.predicates.map(p=>({id:p.id,args:lexicon.predicates[p.id].args,meaning:lexicon.predicates[p.id].description})),ambiguities:c.ambiguities,polarityCues:c.polarityCues,recent:recent.slice(-3)};
 while(Buffer.byteLength(JSON.stringify(payload))>maxBytes){if(payload.recent.length)payload.recent.shift();else if(payload.entities.length>2)payload.entities.pop();else if(payload.predicates.length>2)payload.predicates.pop();else throw Error('Cannot fit required context without losing the input; request clarification');}
 return payload;
}
