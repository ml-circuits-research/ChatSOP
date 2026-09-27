import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../sop/runtime.mjs';
import {Agent} from '../server/agent.mjs';
import {associate} from '../reasoning/learning.mjs';
import {compositionShape} from '../tools/datasets/coverage.mjs';
import {alphaCanonical} from '../tools/datasets/semantic-normalize.mjs';
import {context,lex} from './helpers.mjs';

const run=source=>new Runtime({now:Date.parse('2026-09-26')}).run(source);
const facts=`@ab fact
  holds parent ana bogdan
  valid timeless
@cd fact
  holds parent cora dana
  valid timeless
@bx fact
  holds likes bogdan x
  valid timeless
@dy fact
  holds likes dana y
  valid timeless
@bz fact
  holds dislikes bogdan z
  valid timeless
@data pack
  items $ab $cd $bx $dy $bz
`;
const groupedWhere=`  where all
    parent ?parent ?child
    any
      likes ?child ?item
      dislikes ?child ?item
    end
  end
`;

test('nested any inside all preserves correlated answer rows and explicit row outputs',async()=>{
 const result=await run(facts+`@q query
  select ?parent ?child ?item
${groupedWhere}@r solve
  query $q
  data $data
  output ?pairs rows`);
 assert.equal(result.result.status,'supported');
 assert.deepEqual(result.values.pairs.map(row=>[row['?parent'],row['?child'],row['?item']]).sort(),[
  ['ana','bogdan','x'],['ana','bogdan','z'],['cora','dana','y']
 ]);
 assert.equal(result.outputs.pairs.status,'bound');
 assert.equal(Object.hasOwn(result.values,'parent'),false);
});

const abduction=`@r1 rule
  when cause_one s
  then effect_one s
@r2 rule
  when cause_two s
  then effect_two s
@one hypothesis
  holds cause_one s
@two hypothesis
  holds cause_two s
@rules pack
  items $r1 $r2
@possible pack
  items $one $two
`;
const abduce=group=>abduction+`@q query
  where ${group}
    effect_one s
    effect_two s
  end
@r abduce
  query $q
  data $rules
  candidates $possible`;

test('abduction treats any target as alternatives and all target as a joint obligation',async()=>{
 const any=await run(abduce('any'));
 assert.equal(any.result.explanations.length,2);
 assert.deepEqual(any.result.explanations.map(e=>e.members[0]).sort(),['one','two']);
 const all=await run(abduce('all'));
 assert.equal(all.result.explanations.length,1);
 assert.deepEqual(all.result.explanations[0].members.sort(),['one','two']);
});

test('diagnosis preserves grouped test alternatives as structured recommendations',async()=>{
 const result=await run(abduce('any')+`\n@test query
  where any
    cause_one s
    unrelated s
  end
@d diagnose
  query $q
  data $rules
  candidates $possible
  tests $test
@text cnl
  result $d`);
 assert.equal(result.values.d.tests[0].separatedPairs,1);
 assert.deepEqual(result.values.d.nextTest.query.where[0],{kind:'any',children:[{p:'cause_one',a:['s'],neg:false},{p:'unrelated',a:['s'],neg:false}]});
});

test('association traverses grouped query cue atoms for relational ranking',()=>{
 const atom=(p,a)=>({p,a:[a],neg:false});
 const cue={kind:'query',where:[{kind:'any',children:[atom('hot','a'),atom('dry','a')]}]};
 const data=[{kind:'trace',id:'match',features:[atom('hot','a'),atom('dry','a')]},{kind:'trace',id:'miss',features:[atom('cold','b')]}];
 const result=associate({cue,data});
 assert.deepEqual(result.candidates.map(c=>c.id),['match','miss']);
 assert.equal(result.candidates[0].score,1);
});

test('vocabulary guard inspects every nested predicate and recognizes generated references by leaf index',()=>{
 const c=context();
 try{
  const a=new Agent({repo:c.repo,session:c.session,lexicon:lex,config:{}});
  const wire={type:'query',fields:{where:['any\n  parent ana carina\n  parent $who carina\nend']}};
  const shortlist={predicates:[{id:'parent'}],entities:[{id:'ana'},{id:'carina'}]};
  a.validateAtom({p:'parent',a:['bogdan','carina'],neg:false},shortlist,{wire,atomIndex:1,outputs:{who:{status:'bound',valueType:'person'}}});
  assert.throws(()=>a.validateAtom({p:'parent',a:['bogdan','carina'],neg:false},shortlist,{wire,atomIndex:0,outputs:{who:{status:'bound',valueType:'person'}}}),/outside its shortlist/);
  assert.throws(()=>a.validateVocabulary('@q query\n  where any\n    parent ana carina\n    unauthorized ana\n  end',shortlist),/predicate outside its shortlist/);
 }finally{c.dispose();}
});

test('dataset fingerprints and alpha keys preserve grouped branch structure',()=>{
 const query=where=>`@q query\n  where ${where}\n    parent ana carina\n    parent bogdan dana\n  end\n@r solve\n  query $q`;
 const all=query('all'),any=query('any');
 assert.notEqual(compositionShape(all),compositionShape(any));
 assert.notEqual(alphaCanonical(all),alphaCanonical(any));
});
