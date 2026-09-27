#!/usr/bin/env node
/** Verbalizer smoke evaluation, not a certification of NL semantic faithfulness. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cliArgs,readJSONL,saveJSON,loadJSON} from '../lib/util.mjs';
import {complete} from '../server/llm.mjs';

const args=cliArgs();
const root=fileURLToPath(new URL('../',import.meta.url));
const resource=file=>path.resolve(root,file);
const rows=readJSONL(args.file??resource('datasets/seed/verbalizer/test.jsonl'));
const out=args.out??resource('eval/reports/current/verbalizer-evaluation.json');
if(args['dry-run']){
 const report={role:'verbalizer',rows:rows.length,attempted:0,requests_succeeded:0,evaluated_rows:0,neuralModelTested:false,accuracy:null,requiresHumanFaithfulnessReview:true};
 saveJSON(out,report);
 console.log(out);
}else{
 const config=loadJSON(args.config??resource('config/runtime.json'),{});
 if(!config.verbalizer?.url||!config.verbalizer?.model)throw Error('Verbalizer endpoint URL and model are required');
 const details=[];let requestsSucceeded=0;
 for(const row of rows){
  const start=performance.now();
  try{
   const predicted=await complete(config.verbalizer,row.prompt);
   requestsSucceeded++;
   const allowed=new Set(row.cnl.match(/\d+/g)??[]),generated=predicted.match(/\d+/g)??[];
   details.push({id:row.id,case:row.case,predicted,cnl:row.cnl,gold:row.target,newNumbers:generated.filter(value=>!allowed.has(value)),requiresHumanFaithfulnessReview:true,latencyMs:performance.now()-start});
  }catch(error){
   details.push({id:row.id,case:row.case,valid:false,error:error.message,latencyMs:performance.now()-start});
  }
 }
 const evaluatedRows=details.filter(row=>row.valid!==false).length;
 const report={role:'verbalizer',rows:rows.length,attempted:details.length,requests_succeeded:requestsSucceeded,evaluated_rows:evaluatedRows,neuralModelTested:requestsSucceeded>0,accuracy:null,requiresHumanFaithfulnessReview:true,limitations:'New numbers are a guard only. Semantic faithfulness requires human review.',details};
 saveJSON(out,report);
 console.log(out);
}
