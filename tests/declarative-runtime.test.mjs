import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../sop/runtime.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {parse} from '../sop/parser.mjs';
import {context as repositoryContext} from './helpers.mjs';

const schema={temperature:{arity:2,args:['entity','integer']}};
const question='@q query\n  where temperature room_a ?degrees\n  select ?degrees';
const runtime=()=>new Runtime({schema});

test('premise context survives a turn but never becomes a repository fact',async()=>{
 const c=repositoryContext({bootstrap:false}),context={premises:[]};
 try{
  const engine=new Runtime({repo:c.repo,session:c.session,schema});
  const before=Object.keys(c.session.live.claims).length;
  const first=await engine.run('@p premise\n  holds temperature room_a 21',{origin:'model',inputText:'The room seems to be 21 degrees.',context});
  assert.equal(first.result.packet.status,'context_updated');
  assert.deepEqual(context.premises.map(p=>[p.origin,p.text]),[['model-interpretation','The room seems to be 21 degrees.']]);
  const answer=await engine.run(question,{origin:'model',context});
  assert.equal(answer.result.packet.status,'supported');
  assert.equal(answer.result.packet.hypothetical,true);
  assert.deepEqual(answer.result.packet.answers.map(a=>a.binding),[{'?degrees':21}]);
  assert.equal(Object.keys(c.session.live.claims).length,before);
  const other=await engine.run(question,{origin:'model',context:{premises:[]}});
  assert.equal(other.result.packet.status,'unknown');
  assert.equal(other.result.packet.hypothetical,false);
 }finally{c.dispose();}
});

test('conditional query scalars feed numeric problems without model-authored operations',async()=>{
 const source=`@p premise
  holds temperature room_a 21
${question}
@limit constraint
  var ?next int 0 100
  require ?next == $degrees + 1
  claim ?next <= 25
  select ?next
  task possible`;
 const out=await runtime().run(source,{origin:'model'});
 assert.equal(out.values.degrees,21);
 assert.equal(out.values.next,22);
 assert.equal(out.result.packet.status,'possible');
 assert.equal(out.result.packet.hypothetical,true);
 assert.equal(out.outputs.next.hypothetical,true);
 assert.deepEqual(out.problemResults.map(p=>p.id),['q','limit']);
});

test('multiple conditional scalar matches stop dependent calculation and request clarification',async()=>{
 const source=`@p premise
  holds temperature room_a 21
@other premise
  holds temperature room_a 22
${question}
@limit constraint
  var ?next int 0 100
  require ?next == $degrees + 1
  claim ?next <= 25`;
 const out=await runtime().run(source,{origin:'model'});
 assert.equal(out.outputs.degrees.status,'ambiguous');
 assert.equal(Object.hasOwn(out.values,'limit'),false);
 assert.equal(out.result.packet.status,'clarify');
 assert.equal(out.result.packet.next,'answer_clarification');
 assert.equal(out.result.packet.required.find(p=>p.name==='degrees').status,'ambiguous');
 assert.equal(parse(out.result.packet.pendingSop).wires.at(-1).type,'constraint');
 assert.equal(parse(out.executionSop).wires.at(-1).type,'clarify');
});

const ontology=`@maria_one entity
  kind person
  label en "Maria One"
  alias en "Maria"
@maria_two entity
  kind person
  label en "Maria Two"
  alias en "Maria"
@acme entity
  kind organization
  label en "Acme"
  alias ro "Laboratorul Alfa"
@works_at predicate
  args person organization
  label en "works at"`;

test('host identity lookup asks about homonyms but missing evidence remains unknown',async()=>{
 const lexicon=new Lexicon(ontology),engine=new Runtime({lexicon,schema:lexicon.predicates});
 const ambiguous=await engine.run('@q query\n  where works_at "Maria" acme',{origin:'model',inputText:'Does Maria work at Acme?'});
 assert.equal(ambiguous.result.packet.status,'clarify');
 assert.deepEqual(ambiguous.result.packet.required[0].candidates.map(c=>c.id),['maria_one','maria_two']);
 const known=await engine.run('@q query\n  where works_at maria_one acme',{origin:'model'});
 assert.equal(known.result.packet.status,'unknown');
 const alias=await engine.run('@q query\n  where works_at maria_one "Laboratorul Alfa"',{origin:'model',language:'en'});
 assert.equal(alias.result.packet.status,'unknown');
 assert.equal(alias.result.packet.query.where[0].a[1],'acme');
});

test('host-approved scoped identities need not be global lexicon entries',async()=>{
 const lexicon=new Lexicon(ontology),engine=new Runtime({lexicon,schema:lexicon.predicates});
 const out=await engine.run('@q query\n  where works_at guest acme',{origin:'model',context:{premises:[],entities:[{id:'guest',type:'person'}]}});
 assert.equal(out.result.packet.status,'unknown');
 assert.equal(out.result.packet.query.where[0].a[0],'guest');
});

test('model origin rejects operation, sourced fact and clarification authoring',async()=>{
 const sources=[
  '@x clarify\n  text "Which one?"',
  '@x fact\n  holds temperature room_a 21\n  valid timeless',
  '@p premise\n  holds temperature room_a 21\n@x remember\n  input $p',
  question+'\n@x solve\n  query $q',
  '@x jsEval\n  expr 1 + 2'
 ];
 for(const source of sources)await assert.rejects(runtime().run(source,{origin:'model'}));
});

test('trusted remember cannot promote a premise into sourced knowledge',async()=>{
 const c=repositoryContext({bootstrap:false});
 try{
  const engine=new Runtime({repo:c.repo,session:c.session,schema});
  const before=Object.keys(c.session.live.claims).length;
  await assert.rejects(engine.run('@p premise\n  holds temperature room_a 21\n@s remember\n  input $p'));
  assert.equal(Object.keys(c.session.live.claims).length,before);
 }finally{c.dispose();}
});

test('host-generated operations cannot collide with authored expansion-shaped names',async()=>{
 const out=await runtime().run('@host0__link premise\n  holds temperature room_a 21\n'+question,{origin:'model'});
 assert.deepEqual(out.result.packet.answers.map(a=>a.binding),[{'?degrees':21}]);
 assert.equal(out.values.host0__link.kind,'premise');
});

test('requested scalar ambiguity requires clarification even when the claim is entailed',async()=>{
 const source='@problem constraint\n  var ?x int 1 2\n  claim ?x >= 1\n  select ?x';
 const out=await runtime().run(source,{origin:'model'});
 assert.equal(out.problemResults[0].result.status,'entailed');
 assert.equal(out.result.packet.status,'clarify');
 assert.equal(out.result.packet.next,'answer_clarification');
 assert.deepEqual(out.result.packet.required,[{name:'x',status:'ambiguous',candidates:2}]);
 assert.equal(out.outputs.x.status,'ambiguous');
 assert.equal(Object.hasOwn(out.values,'x'),false);
});
