/** Host-reviewed ontology lookup: indexed exact forms, never fuzzy identity. */
import fs from 'node:fs';
import {parse,one,many,words,unquote} from './parser.mjs';
import {assert,digest} from '../lib/util.mjs';
export const normalize=s=>String(s).normalize('NFC').toLocaleLowerCase('ro').replace(/[şţ]/g,c=>c==='ş'?'ș':'ț').replace(/\s+/g,' ').trim();
const fold=s=>normalize(s).normalize('NFD').replace(/\p{M}/gu,'');
const tokens=s=>s.match(/[\p{L}\p{N}_]+/gu)??[];
const spans=(s,a)=>{const out=[];let at=s.indexOf(a);while(at>=0){const end=at+a.length,left=at===0||!/[\p{L}\p{N}_]/u.test(s[at-1]),right=end===s.length||!/[\p{L}\p{N}_]/u.test(s[end]);if(left&&right)out.push([at,end]);at=s.indexOf(a,at+1);}return out;};
export class Lexicon{
 constructor(source,{provenance='host-ontology'}={}){this.entities={};this.predicates={};this.concepts={};this.entries=[];this.index=new Map();this.exact=new Map();this.folded=new Map();this.version=digest(source);this.provenance=provenance;const program=parse(source,{allowTypes:['entity','predicate','concept']});
  for(const w of program.wires){assert(['entity','predicate','concept'].includes(w.type),'Ontology is declarative, not executable');const aliases=[],labels={};for(const key of ['label','alias'])for(const line of many(w,key)){const [lang,...rest]=words(line);assert(/^[a-z]{2,3}$/.test(lang)&&rest.length===1,'Use label/alias LANGUAGE "surface"');const surface=unquote(rest[0]);assert(typeof surface==='string'&&surface.length>0,'Nonempty alias surface required');aliases.push({language:lang,surface});if(key==='label')labels[lang]=surface;}
   const item={id:w.id,kind:w.type,labels,aliases,domain:one(w,'domain',null),version:this.version,provenance:this.provenance};if(w.type==='predicate'){item.args=words(one(w,'args',''));assert(item.args.length>=1&&item.args.length<=4,'Predicate needs 1..4 argument types');item.arity=item.args.length;item.description=unquote(one(w,'description',''));this.predicates[w.id]=item;}else if(w.type==='entity'){item.entityType=one(w,'kind','entity');this.entities[w.id]=item;}else {item.parents=many(w,'is_a');this.concepts[w.id]=item;}
   for(const a of [...aliases,{language:'und',surface:w.id}]){const entry={...a,id:w.id,kind:w.type,type:item.entityType,domain:item.domain,norm:normalize(a.surface),folded:fold(a.surface),version:this.version,provenance:this.provenance};const ix=this.entries.length;this.entries.push(entry);for(const [index,key] of [[this.exact,entry.norm],[this.folded,entry.folded]]){if(!index.has(key))index.set(key,[]);index.get(key).push(ix);}for(const t of new Set(tokens(entry.folded))){if(!this.index.has(t))this.index.set(t,new Set());this.index.get(t).add(ix);}}
  }
 }
 static load(file){return new Lexicon(fs.readFileSync(file,'utf8'),{provenance:String(file)});}
 matching(surface,{language,kind,type,domain}){
  const matches=(index,key)=>[...new Map((index.get(key)??[]).map(i=>this.entries[i]).filter(e=>(language==='auto'||e.language===language||e.language==='und')&&e.kind===kind&&(!type||e.type===type)&&(!domain||e.domain===domain)).map(e=>[e.id,e])).values()];
  const exact=matches(this.exact,normalize(surface));return {found:exact.length?exact:matches(this.folded,fold(surface)),match:exact.length?'exact':'accent-folded'};
 }
 resolve(surface,{language,kind,type,domain}={}){
  assert(typeof surface==='string'&&surface.length>0&&Buffer.byteLength(surface)<=1600,'resolve text must be bounded');assert(/^[a-z]{2,3}$/.test(language??''),'resolve requires explicit language');assert(['entity','predicate','concept'].includes(kind),'resolve requires symbolic kind');assert(!type||kind==='entity','resolve type only applies to entities');
  const {found,match}=this.matching(surface,{language,kind,type,domain});
  const base={surface,language,kind,version:this.version,provenance:this.provenance};
  if(found.length===1){const e=found[0];return {...base,status:'bound',id:e.id,type:e.type,domain:e.domain,match};}
  return {...base,status:found.length?'ambiguous':'unknown',candidates:found.map(e=>({id:e.id,type:e.type,domain:e.domain})).sort((a,b)=>a.id.localeCompare(b.id))};
 }
 candidates(text,{language='auto',maxEntities=12,maxPredicates=10,maxConcepts=6}={}){
  assert(typeof text==='string'&&Buffer.byteLength(text)<=1600,'Lexical input size limit');const norm=normalize(text),folded=fold(text),seen=new Set();for(const t of tokens(folded))for(const i of this.index.get(t)??[])seen.add(i);
  // Resolve every actual mention before ranking IDs. A longer match shadows a
  // nested short alias only at that occurrence, not at another occurrence.
  const positions=new Map();for(const i of seen){const e=this.entries[i];if(language!=='auto'&&!['und',language].includes(e.language))continue;for(const [start,end] of spans(folded,e.folded))positions.set(start+':'+end,{start,end});}
  assert(positions.size<=512,'Too many lexical mentions');const maximal=[...positions.values()].filter(a=>![...positions.values()].some(b=>b.start<=a.start&&a.end<=b.end&&b.end-b.start>a.end-a.start));
  const best=new Map(),ambiguities=[];for(const {start,end} of maximal){const surface=norm.slice(start,end);for(const kind of ['entity','predicate','concept']){const {found,match}=this.matching(surface,{language,kind});if(!found.length)continue;
   if(found.length>1)ambiguities.push({kind,surface,ids:found.map(e=>e.id).sort()});
   for(const e of found){const score=(match==='exact'?100:85)+Math.min(tokens(e.folded).length,8),prev=best.get(e.id);if(!prev||prev.score<score)best.set(e.id,{id:e.id,kind:e.kind,score,surface:e.surface,language:e.language});}
  }}
  const ranked=[...best.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  return {entities:ranked.filter(x=>x.kind==='entity').slice(0,maxEntities),predicates:ranked.filter(x=>x.kind==='predicate').slice(0,maxPredicates),concepts:ranked.filter(x=>x.kind==='concept').slice(0,maxConcepts),ambiguities,polarityCues:tokens(norm).filter(t=>['nu','not','never','kein','nicht','fără','fara','nunca','non'].includes(t)),truncated:ranked.filter(x=>x.kind==='entity').length>maxEntities||ranked.filter(x=>x.kind==='predicate').length>maxPredicates};
 }
}
export function microContext(text,lexicon,{language='auto',now='2026-09-26',maxBytes=3200,recent=[]}={}){
 assert(Buffer.byteLength(text)<=1600,'Message exceeds micro-context budget; split by discourse units, do not truncate it');const c=lexicon.candidates(text,{language}),ambiguous=new Set(c.ambiguities.flatMap(a=>a.ids.map(id=>a.kind+':'+id)));
 const entities=c.entities.filter(e=>!ambiguous.has('entity:'+e.id)),predicates=c.predicates.filter(e=>!ambiguous.has('predicate:'+e.id)),concepts=c.concepts.filter(e=>!ambiguous.has('concept:'+e.id));
 const payload={language,now,entities:entities.map(e=>({id:e.id,label:e.surface,type:lexicon.entities[e.id].entityType})),predicates:predicates.map(p=>({id:p.id,args:lexicon.predicates[p.id].args,meaning:lexicon.predicates[p.id].description})),concepts:concepts.map(c=>({id:c.id,label:c.surface,domain:lexicon.concepts[c.id].domain})),ambiguities:c.ambiguities,canonicalMentions:[...entities,...predicates,...concepts].map(e=>({surface:e.surface,id:e.id,kind:e.kind,language:e.language})),lexiconVersion:lexicon.version,polarityCues:c.polarityCues,recent:recent.slice(-3)};
 while(Buffer.byteLength(JSON.stringify(payload))>maxBytes){if(payload.recent.length)payload.recent.shift();else if(payload.concepts.length){const c=payload.concepts.pop();payload.canonicalMentions=payload.canonicalMentions.filter(x=>x.id!==c.id);}else if(payload.entities.length>2){const e=payload.entities.pop();payload.canonicalMentions=payload.canonicalMentions.filter(x=>x.id!==e.id);}else if(payload.predicates.length>2){const p=payload.predicates.pop();payload.canonicalMentions=payload.canonicalMentions.filter(x=>x.id!==p.id);}else throw Error('Cannot fit required context without losing the input; request clarification');}
 return payload;
}
