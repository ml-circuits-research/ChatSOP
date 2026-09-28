// Label conventions of the model-language corpora (DS022 "Relation phrases", "Row fields", "Stated versus
// assumed", noise cue words): checked on the generator's lexicon and on every built row.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {repoPath} from '../helpers.mjs';
import {corpusSkip, loadCorpus} from './corpus.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {PREDICATES} from '../../tools/datasets/diversity/domains.mjs';
import {missingRelationWords, relationWordProblems} from '../../tools/datasets/diversity/relation-words.mjs';
import {addNoise} from '../../tools/datasets/diversity/noise.mjs';
import {rng, foldDiacritics} from '../../tools/datasets/diversity/text.mjs';

const CORPUS = 'formalizer-v1', OOD = 'formalizer-ood-v1';
const skip = corpusSkip(CORPUS);
const allRows = () => [...loadCorpus(CORPUS).rows, ...readJsonlShardedSync(repoPath(`eval/suites/${OOD}/test.jsonl`))];
const folded = text => foldDiacritics(String(text)).toLowerCase();

test('lexicon: every construction form contains the words of its relation phrase', () => {
  const problems = [];
  for (const [id, spec] of Object.entries(PREDICATES)) for (const language of ['en', 'ro']) for (const c of spec[language] ?? []) {
    for (const [key, forms] of Object.entries(c.forms)) for (const form of [].concat(forms)) {
      const text = form.replace(/\{g:[A-Za-z_]+:([^:}]*):([^}]*)\}/g, ' $1 $2 ').replace(/\{[^}]*\}/g, ' ');
      const missing = missingRelationWords(c.rel, text);
      if (missing.length) problems.push(`${id} ${c.id} "${c.rel}" ${key}: "${form}" lacks ${missing.join(', ')}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('relation phrases: every clean row uses the message\'s own words (no paraphrase)', {skip}, () => {
  const problems = [];
  // Noise may misspell a word of the message; the convention is checked on the rows without noise.
  for (const row of allRows().filter(item => !item.noise_level && item.surface_ir)) {
    for (const problem of relationWordProblems(row.surface_ir, row.question)) problems.push(`${row.id}: ${problem} in ${JSON.stringify(row.question)}`);
  }
  assert.deepEqual(problems.slice(0, 20), []);
});

test('assumptions: presuppositions have a trigger, world assumptions reverse the statement', {skip}, () => {
  const problems = [];
  const TRIGGER = /(?<![\p{L}])(still|again|anymore|inca|mai|iar|iara|iarasi|din nou)(?![\p{L}])/u;
  for (const row of allRows()) {
    const surface = row.surface_ir ?? {};
    const stated = new Set((surface.stated ?? []).map(p => p.relation));
    for (const assumed of surface.assumed ?? []) {
      if (assumed.basis === 'implicature' && !TRIGGER.test(folded(row.question))) problems.push(`${row.id}: implicature without a trigger: ${row.question}`);
      if (assumed.basis === 'world' && !stated.has(assumed.relation)) problems.push(`${row.id}: world assumption "${assumed.relation}" is not a stated relation phrase`);
    }
  }
  assert.deepEqual(problems.slice(0, 20), []);
});

test('row fields: only documented fields, and nothing named like model input', {skip}, () => {
  const spec = fs.readFileSync(repoPath('docs/specs/DS022-diversity-generator.md'), 'utf8');
  const section = spec.slice(spec.indexOf('## Row fields'), spec.indexOf('\n## ', spec.indexOf('## Row fields') + 5));
  const documented = new Set(section.split('\n').filter(line => line.startsWith('| `')).flatMap(line => line.split('|')[1].match(/`([a-z_]+)`/g).map(field => field.slice(1, -1))));
  assert.ok(documented.has('question') && documented.has('verification_context'), 'DS022 row-field table');
  const undocumented = new Map();
  for (const row of allRows()) {
    for (const forbidden of ['context', 'prompt', 'model_input', 'context_assertions']) assert.equal(row[forbidden], undefined, `${row.id}: ${forbidden}`);
    for (const key of Object.keys(row)) if (!documented.has(key) && !undocumented.has(key)) undocumented.set(key, row.id);
  }
  assert.deepEqual(Object.fromEntries(undocumented), {});
});

test('noise never corrupts a Romanian or English cue word', () => {
  const messages = [['Ovidiu încă lucrează la Baia Mare Logistic?', 'ro', 'inca'], ['Costin mai locuiește în Deva?', 'ro', 'mai'], ['Niciun jucător de la Rapid Deva nu e certificat?', 'ro', 'niciun'],
    ['A vizitat Ana din nou Clujul?', 'ro', 'din nou'], ['Does Ana still work at Acme?', 'en', 'still'], ['Is nobody at Acme certified?', 'en', 'nobody']];
  for (const [text, language, cue] of messages) {
    const random = rng(`cue:${text}`);
    for (let i = 0; i < 300; i++) {
      const noisy = addNoise(text, {language, random, level: 'heavy'}).text;
      assert.ok(new RegExp(`(?<![\\p{L}])${cue}(?![\\p{L}])`, 'u').test(folded(noisy)), `${cue} lost in ${JSON.stringify(noisy)}`);
    }
  }
});
