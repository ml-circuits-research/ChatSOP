import {assert} from '../lib/util.mjs';
import {parseExpression} from './expression.mjs';

export function conditionField(type,key){
 return type==='query'&&['where','filter'].includes(key)||type==='constraint'&&['require','claim'].includes(key);
}

/** Explicit groups preserve nesting; ordinary leaf syntax belongs to the caller. */
export function parseCondition(source,parseLeaf){
 const lines=source.split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
 let cursor=0;
 function next(depth){
  assert(depth<=32,'Condition nesting limit');
  const text=lines[cursor++];
  assert(text&&text!=='end','Expected a condition');
  if(text!=='all'&&text!=='any')return parseLeaf(text);
  const children=[];
  while(cursor<lines.length&&lines[cursor]!=='end')children.push(next(depth+1));
  assert(lines[cursor++]==='end','Unclosed '+text+' condition');
  assert(children.length>0,'Empty '+text+' condition');
  return {kind:text,children};
 }
 const result=next(0);
 assert(cursor===lines.length,'Unexpected text after condition');
 return result;
}

/** Filters and numeric constraints share the existing typed expression lowering. */
export function parseBooleanCondition(source){
 const convert=node=>{
  if(!node.children)return node;
  return node.children.map(convert).reduce((left,right)=>({type:'binary',op:node.kind==='all'?'&&':'||',left,right}));
 };
 return convert(parseCondition(source,parseExpression));
}

export function formatCondition(source){
 let depth=0;
 return source.split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')).map((line,i)=>{
  if(line==='end')depth--;
  const text=(i?'  '.repeat(depth+1):'')+line;
  if(line==='all'||line==='any')depth++;
  return text;
 }).join('\n');
}
