import fs from 'node:fs';
import {parse,validateGraph} from '../sop/parser.mjs';
const prompt=name=>fs.readFileSync(new URL('./prompts/'+name+'.txt',import.meta.url),'utf8').trim();
export const formalPrompt=(text,context)=>prompt('formalizer')+'\n\nCONTEXT\n'+JSON.stringify(context)+'\n\nMESSAGE\n'+text;
export const barePrompt=(text,context)=>'CONTEXT\n'+JSON.stringify(context)+'\n\nMESSAGE\n'+text;
export const verbalPrompt=(text,language='ro')=>prompt('verbalizer')+'\n\nLANGUAGE '+language+'\nCNL\n'+text;
export async function complete(config,input){const url=new URL(config.url);if(!['http:','https:'].includes(url.protocol))throw Error('Unsupported model endpoint');const body={model:config.model,messages:[{role:'user',content:input}],temperature:0,max_tokens:config.maxTokens??1024,stream:false,chat_template_kwargs:{enable_thinking:false}};if(config.grammarFile)body.grammar=fs.readFileSync(config.grammarFile,'utf8');
 const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.RECALL_LLM_KEY?{Authorization:'Bearer '+process.env.RECALL_LLM_KEY}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(config.timeoutMs??120000)});if(!res.ok)throw Error('Model endpoint returned '+res.status+': '+(await res.text()).slice(0,300));const data=await res.json(),text=data.choices?.[0]?.message?.content;if(typeof text!=='string')throw Error('Missing generated text');if(data.choices[0].finish_reason==='length')throw Error('Model output was truncated; no command executed');return text.trim();}
export async function formalize(text,context,config){const sop=await complete(config,formalPrompt(text,context));parse(sop);return sop;}
export async function verbalize(cnl,config){return {text:await complete(config,verbalPrompt(cnl.text,cnl.language)),cnl:cnl.text,semanticFaithfulness:'not-certified; authoritative CNL remains available'};}
