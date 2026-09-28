import test from 'node:test';
import assert from 'node:assert/strict';
import {parse,parseAtom,emitAtom} from '../sop/parser.mjs';

test('atoms use whitespace-separated terms, typed integers, references and explicit negation',()=>{
 const atom=parseAtom('not connected $left ?right 17');
 assert.deepEqual(atom,{p:'connected',a:[{ref:'left'},'?right',17],neg:true});
 assert.equal(emitAtom(atom),'not connected $left ?right 17');
 assert.deepEqual(parseAtom('temperature sensor_1 -12'),{p:'temperature',a:['sensor_1',-12],neg:false});
 assert.deepEqual(parseAtom('pair a b c d').a,['a','b','c','d']);
});

test('JSON-quoted terms preserve multiword text, punctuation, parentheses and escapes',()=>{
 const atom=parseAtom('caption "Alpha Lab, (West)" "quote: \\"hi\\"; slash \\\\"');
 assert.deepEqual(atom.a,['Alpha Lab, (West)','quote: "hi"; slash \\']);
 assert.equal(emitAtom(atom),'caption "Alpha Lab, (West)" "quote: \\"hi\\"; slash \\\\"');
 assert.deepEqual(parseAtom(emitAtom(atom)),atom);
 assert.equal(parse('@f fact\n  holds caption "Alpha Lab, (West)"\n  valid timeless').wires[0].fields.holds[0],'caption "Alpha Lab, (West)"');
});

test('legacy parentheses and commas are rejected rather than parsed as terms',()=>{
 const shape=/Expected \[not\] predicate term1 term2; not is reserved/,term=/Invalid canonical term/;
 for(const [text,message] of [['parent(ana, bogdan)',shape],['not parent(ana, bogdan)',shape],['parent ana, bogdan',term],['parent ana bogdan,',term],['parent(ana)',shape],['parent ana (bogdan)',term]]){
  assert.throws(()=>parseAtom(text),message,text);
 }
});

test('missing, excess, adjacent or malformed atom terms fail closed',()=>{
 const shape=/Expected \[not\] predicate term1 term2; not is reserved/,arity=/An atom takes 1\.\.4 arguments/,adjacent=/Atom terms must be separated by whitespace/;
 const cases=[
  ['parent',shape],['not parent',shape],['parent ',arity],['parent a b c d e',arity],
  ['parent "a""b"',adjacent],['parent "unterminated',/Expected a complete atom term or quoted string/],['parent "x"y',adjacent],
  ['parent a\nb',/An atom occupies one line/],['not a',shape],['p 9007199254740992',/Safe integer expected/],
 ];
 for(const [text,message] of cases){
  assert.throws(()=>parseAtom(text),message,text);
 }
});
