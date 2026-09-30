/**
 * Host bilingual and synonym dictionary (sop/dictionary.mjs) and its maintenance CLI (tools/dictionary.mjs).
 * Most tests build a small dictionary inline or in a temporary directory, so they do not depend on the Wiktionary
 * extraction; one smoke test reads the real config/dictionary and skips when wiktionary.tsv is absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseTsv, formatTsv, compileEntries, compileDictionary, Dictionary, DICTIONARY_DIR} from '../sop/dictionary.mjs';
import {isDefinite, lemmaOfDefinite, glossCandidates} from '../tools/dictionary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'tools', 'dictionary.mjs');
const HEADER = 'id\tpos\ten\tro\tforms\tnote\n';

const ENTRIES = [
  {id: 'rel:works_at', pos: 'relation', en: ['work at', 'work for', 'be employed by'], ro: ['lucra la', 'fi angajat la', 'munci la'], forms: ['lucrează la', 'a lucrat la'], source: 'generator', priority: 20},
  {id: 'rel:lives_in', pos: 'relation', en: ['live in'], ro: ['locui în'], forms: ['locuiește în'], source: 'generator', priority: 20},
  {id: 'man:noun:firma', pos: 'noun', en: ['company', 'firm'], ro: ['firmă'], forms: ['def:firma', 'firme'], source: 'manual', priority: 10},
  {id: 'man:phrase:sala-de-sport', pos: 'phrase', en: ['gym'], ro: ['sală de sport'], forms: ['def:sala de sport'], source: 'manual', priority: 10},
  {id: 'man:noun:sala', pos: 'noun', en: ['room', 'hall'], ro: ['sală'], forms: ['def:sala', 'săli'], source: 'manual', priority: 10},
  {id: 'man:verb:lucra', pos: 'verb', en: ['work'], ro: ['lucra'], forms: ['lucrează'], source: 'manual', priority: 10},
  {id: 'man:prep:la', pos: 'prep', en: ['at', 'to'], ro: ['la'], source: 'manual', priority: 10},
  {id: 'gen:kin:brother', pos: 'noun', en: ['brother'], ro: ['frate'], forms: ['def:fratele'], source: 'generator', priority: 20},
  {id: 'wkt:noun:firma', pos: 'noun', en: ['shop sign'], ro: ['firmă'], source: 'wiktionary', priority: 30},
];
const dictionary = Dictionary.fromEntries(ENTRIES);

test('parseTsv accepts comments and lists, and rejects malformed sources', () => {
  const entries = parseTsv(`# comment\n${HEADER}\nx:1\tnoun\ta|b\tc\tdef:d|e\tnote\n`);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].en, ['a', 'b']);
  assert.deepEqual(entries[0].forms, ['def:d', 'e']);
  assert.throws(() => parseTsv('id\tpos\tro\ten\tforms\tnote\n'), /header must be/);
  assert.throws(() => parseTsv(`${HEADER}Bad Id\tnoun\ta\tb\t\t\n`), /invalid id/);
  assert.throws(() => parseTsv(`${HEADER}x:1\tverbz\ta\tb\t\t\n`), /pos must be one of/);
  assert.throws(() => parseTsv(`${HEADER}x:1\tnoun\t\t\t\t\n`), /needs an en or ro surface/);
  // formatTsv round-trips through parseTsv.
  const again = parseTsv(formatTsv(entries.map(({file, line, ...e}) => e), 'licence line'));
  assert.deepEqual(again.map(e => e.id), ['x:1']);
});

test('compileEntries maps folded surfaces with lemma, form and definite flags', () => {
  const compiled = compileEntries(ENTRIES.map(e => ({forms: [], note: '', ...e})));
  assert.deepEqual(compiled.ro['lucra la'], [[0, 'l']]);
  assert.deepEqual(compiled.ro['lucreaza la'], [[0, 'f']]);
  assert.ok(compiled.ro['firma'].some(([i, f]) => i === 2 && f === 'd'));
  assert.ok(compiled.en['work at'].some(([i]) => i === 0));
  // Surfaces that name Object.prototype members are ordinary keys.
  const odd = compileEntries([{id: 'x:1', pos: 'noun', en: ['constructor'], ro: ['constructor'], forms: []}]);
  assert.deepEqual(odd.en.constructor, [[0, 'l']]);
});

test('lookup finds lemmas, inflected and definite forms; the best source priority wins', () => {
  assert.equal(dictionary.lookup('lucra la')[0].entry.id, 'rel:works_at');
  assert.equal(dictionary.lookup('lucrează la')[0].flag, 'f');
  assert.equal(dictionary.lookup('LUCREAZA  la')[0].entry.id, 'rel:works_at', 'folded: case, diacritics and spaces');
  const firma = dictionary.lookup('firma');
  assert.deepEqual([...new Set(firma.map(hit => hit.entry.id))], ['man:noun:firma'], 'manual (10) shadows wiktionary (30)');
  assert.ok(firma.some(hit => hit.flag === 'd'));
  assert.equal(dictionary.lookup('work at', 'en')[0].entry.id, 'rel:works_at');
  assert.deepEqual(dictionary.lookup('nothing here'), []);
});

test('candidates translate Romanian, keep English and names, and never guess', () => {
  assert.deepEqual(dictionary.candidates('lucra la', 'relation').candidates, ['work at', 'work for', 'be employed by']);
  assert.equal(dictionary.candidates('lucrează la', 'relation').status, 'translated');
  assert.deepEqual(dictionary.candidates('work at', 'relation'), {status: 'unchanged', candidates: ['work at'], untranslated: [], sources: []});
  assert.deepEqual(dictionary.candidates('firma', 'value').candidates, ['the company']);
  assert.deepEqual(dictionary.candidates('firmă', 'value').candidates, ['company']);
  assert.deepEqual(dictionary.candidates('sala', 'value').candidates, ['the room'], 'a definite form that folds to its lemma');
  assert.deepEqual(dictionary.candidates('sală', 'value').candidates, ['room']);
  assert.deepEqual(dictionary.candidates('sala de sport', 'value').candidates, ['the gym']);
  const unknown = dictionary.candidates('zgrâbțui', 'value');
  assert.equal(unknown.status, 'untranslated');
  assert.deepEqual(unknown.untranslated, ['zgrâbțui']);
  assert.deepEqual(dictionary.candidates('Ana', 'value').candidates, ['Ana']);
  assert.deepEqual(dictionary.candidates('Ștefan Popescu', 'value').candidates, ['Ștefan Popescu'], 'names kept as written');
  assert.deepEqual(dictionary.candidates('fratele meu', 'value').candidates, ["the user's brother"]);
  assert.deepEqual(dictionary.candidates('eu', 'value').candidates, ['the user']);
  // Word-by-word composition through a verb and a preposition.
  assert.ok(dictionary.candidates('lucra pentru', 'relation').status === 'untranslated', 'pentru is not in this small dictionary');
  assert.deepEqual(Dictionary.fromEntries([...ENTRIES, {id: 'm:p', pos: 'prep', en: ['for'], ro: ['pentru']}]).candidates('lucra pentru', 'relation').candidates, ['work for']);
});

test('synonyms, meanings and sameMeaning work across languages', () => {
  assert.deepEqual(dictionary.synonyms('work at'), ['work for', 'be employed by']);
  assert.deepEqual([...dictionary.meanings('fi angajat la')], ['rel:works_at']);
  assert.ok(dictionary.sameMeaning('lucra la', 'work at'));
  assert.ok(dictionary.sameMeaning('work at', 'be employed by'));
  assert.ok(dictionary.sameMeaning('lucrează la', 'be employed by'));
  assert.ok(dictionary.sameMeaning('the gym', 'sala de sport', 'value'));
  assert.ok(dictionary.sameMeaning('firma', 'the company', 'value'));
  assert.ok(!dictionary.sameMeaning('lucra la', 'live in'));
  assert.ok(!dictionary.sameMeaning('the gym', 'the company', 'value'));
});

test('seed helpers: definite detection, lemma derivation and gloss candidates', () => {
  assert.ok(isDefinite('tramvaiul') && isDefinite('mașina') && isDefinite('cardul de debit') && isDefinite('Volvo-ul vechi'));
  assert.ok(!isDefinite('numerar') && !isDefinite('un card preplătit') && !isDefinite('Dacia roșie') && !isDefinite('salată de cartofi'));
  assert.equal(lemmaOfDefinite('mașina'), 'mașină');
  assert.equal(lemmaOfDefinite('cardul de debit'), 'card de debit');
  assert.equal(lemmaOfDefinite('ansamblul folcloric'), 'ansamblu folcloric');
  assert.equal(lemmaOfDefinite('aplicația de rezervări'), 'aplicație de rezervări');
  assert.equal(lemmaOfDefinite('autobuzul școlii'), null, 'a genitive modifier is not derived');
  assert.equal(lemmaOfDefinite('tramvaiul'), null, 'an ambiguous ending is not derived');
  assert.deepEqual(glossCandidates('to work, labor (for pay); to toil', 'verb'), ['work', 'labor', 'toil']);
  assert.deepEqual(glossCandidates('a company', 'noun'), ['company']);
  assert.deepEqual(glossCandidates('Used to form the Romanian superlative of adjectives', 'adv'), []);
});

function tempDictionary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-dictionary-'));
  fs.copyFileSync(path.join(DICTIONARY_DIR, 'manifest.json'), path.join(dir, 'manifest.json'));
  fs.writeFileSync(path.join(dir, 'manual.tsv'), `# manual\n${HEADER}man:prep:la\tprep\tat|to\tla\t\t\n`);
  fs.writeFileSync(path.join(dir, 'generator.tsv'), `${HEADER}rel:works_at\trelation\twork at|be employed by\tlucra la\tlucrează la\t\n`);
  fs.writeFileSync(path.join(dir, 'review.tsv'), HEADER);
  return dir;
}
const cli = (dir, ...args) => execFileSync(process.execPath, [CLI, ...args, '--dir', dir], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

test('CLI add, propose, review, approve and reject on a temporary dictionary', () => {
  const dir = tempDictionary();
  try {
    cli(dir, 'add', '--pos', 'verb', '--en', 'leave|depart', '--ro', 'pleca', '--forms', 'pleacă|plecat');
    const manual = parseTsv(fs.readFileSync(path.join(dir, 'manual.tsv'), 'utf8'));
    assert.deepEqual(manual.map(e => e.id), ['man:prep:la', 'man:verb:pleca']);
    assert.ok(fs.readFileSync(path.join(dir, 'manual.tsv'), 'utf8').startsWith('# manual\n'), 'header comment kept');
    assert.throws(() => cli(dir, 'add', '--pos', 'verb', '--en', 'leave', '--ro', 'pleca'), /duplicate id/);
    assert.throws(() => cli(dir, 'add', '--pos', 'verbz', '--en', 'x', '--ro', 'y'), /--pos must be one of/);

    cli(dir, 'propose', '--pos', 'noun', '--en', 'gym', '--ro', 'sală de sport', '--forms', 'def:sala de sport', '--note', 'found in eval row X');
    cli(dir, 'propose', '--pos', 'noun', '--en', 'nonsense', '--ro', 'zgrâbțui', '--note', 'found in eval row Y');
    assert.match(cli(dir, 'review'), /2 pending proposal\(s\)[\s\S]*prop:noun:sala-de-sport/);
    // Proposals are not loaded.
    assert.deepEqual(Dictionary.load(dir, {cache: false}).lookup('sala de sport'), []);

    cli(dir, 'approve', 'prop:noun:sala-de-sport');
    cli(dir, 'reject', 'prop:noun:zgrabtui');
    assert.deepEqual(parseTsv(fs.readFileSync(path.join(dir, 'review.tsv'), 'utf8')), []);
    const loaded = Dictionary.load(dir, {cache: false});
    assert.equal(loaded.lookup('sala de sport')[0].entry.id, 'man:noun:sala-de-sport');
    assert.deepEqual(loaded.candidates('sala de sport', 'value').candidates, ['the gym']);
    assert.throws(() => cli(dir, 'approve', 'prop:noun:missing'), /no pending proposal/);
    assert.match(cli(dir, 'check'), /duplicate ids: 0/);
    assert.match(cli(dir, 'lookup', 'lucrează la'), /rel:works_at/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('smoke: the real config/dictionary compiles and translates', {skip: !fs.existsSync(path.join(DICTIONARY_DIR, 'wiktionary.tsv')) && 'wiktionary.tsv missing'}, () => {
  const compiled = compileDictionary(DICTIONARY_DIR, {cache: false});
  const real = new Dictionary(compiled);
  assert.ok(compiled.entries.length > 1000);
  assert.ok(real.sameMeaning('lucra la', 'work at'));
  assert.ok(real.sameMeaning('fi angajat la', 'be employed by'));
  assert.ok(real.sameMeaning('the gym', 'sala de sport', 'value'));
  assert.equal(real.candidates('lucrează la', 'relation').candidates[0], 'work at');
  assert.deepEqual(real.candidates('fratele meu', 'value').candidates, ["the user's brother"]);
  assert.equal(real.candidates('zgrâbțui', 'value').status, 'untranslated');
  assert.deepEqual(real.candidates('factura', 'value').candidates, ['the invoice']);
});

test('a Romanian verb chain gets an English to-infinitive and a copula form answers to its fi lemma form', () => {
  const d = Dictionary.fromEntries([
    {id: 'man:verb:vrea', pos: 'verb', en: ['want'], ro: ['vrea']},
    {id: 'man:verb:putea', pos: 'verb', en: ['can'], ro: ['putea']},
    {id: 'man:verb:invata', pos: 'verb', en: ['learn'], ro: ['învăța']},
    {id: 'man:verb:semna', pos: 'verb', en: ['sign'], ro: ['semna']},
    {id: 'rel:coaches', pos: 'relation', en: ['coach', 'be the coach of'], ro: ['antrena'], forms: ['e antrenorul de la', 'este antrenoarea de la']},
  ]);
  assert.deepEqual(d.candidates('vrea învăța', 'relation').candidates, ['want to learn']);
  assert.deepEqual(d.candidates('putea semna', 'relation').candidates, ['can sign']);
  assert.ok(d.sameMeaning('fi antrenorul de la', 'be the coach of', 'relation'));
  assert.ok(d.sameMeaning('fi antrenoarea de la', 'coach', 'relation'));
});
