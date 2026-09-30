// Visual audit tabs (DS020 "Corpus registry" and "Type-specific case views"): the three datasets bad_english,
// symbolic_english and neuro_english as their own tabs plus a secondary archive tab for the legacy corpora,
// type-specific row views, server-side paging and filters, view-only sealed suites, verdicts appended to the
// ledger, and on-demand SymbolicLM checks (a fake worker here, so the test needs no Stanza models).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAuditRouter} from '../../server/audit.mjs';
import {auditPage} from '../../server/pages/audit.mjs';
import {symbolicChecker} from '../../server/audit-shared.mjs';
import {loadAuditRegistry, corpusType, tabOf, tabDescriptions, AUDIT_TABS} from '../../server/audit-corpora.mjs';
import {dependencyTree, sentencesView} from '../../server/audit-datasets.mjs';

const write = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-tabs-'));
  fs.mkdirSync(path.join(root, 'datasets/formalizer-x'), {recursive: true});
  write(path.join(root, 'datasets/formalizer-x/train.jsonl'), [{id: 'f1', semantic_case_id: 'f1', question: 'Does Ana work at Acme?', language: 'en', sop_target: 'stated\n  relation "work at"\n  subject "Ana"\n  object "Acme"'}]);
  // A registry-declared corpus with no train/dev file of its own: it must still be discovered.
  write(path.join(root, 'datasets/proofing-y/extra-hard.jsonl'), [{id: 'p3', semantic_case_id: 'c3', input: 'who runs the lab', target: null, kind: 'hard', layer: 'parser', language: 'en', question_type: 'wh'}]);
  write(path.join(root, 'datasets/proofing-y/train.jsonl'), [
    {id: 'p1', semantic_case_id: 'c1', input: 'Is Ana the booss of Dan?', target: 'Is Ana the boss of Dan?', kind: 'repair', layer: 'input', language: 'en', question_type: 'yes_no', noise_ops: ['typo'], char_edit: 1},
    {id: 'p2', semantic_case_id: 'c2', input: 'Who is Dan?', target: 'Who is Dan?', kind: 'identity', language: 'en', question_type: 'wh'},
  ]);
  write(path.join(root, 'eval/suites/proofing-y/test.jsonl'), [{id: 'p9', semantic_case_id: 'c9', input: 'is it open', target: 'Is it open?', kind: 'repair', language: 'en'}]);
  write(path.join(root, 'datasets_sources/nc/raw/writer-01.jsonl'), [
    {id: 'w01-1', language: 'en', message: 'hey quick q - is the gym open sat', clean: ['Is the gym open on Saturday?'], categories: ['casual_register', 'typos'], domain: 'sports', author: 'w1', source: 'own-writing', notes: ''},
    {id: 'w01-2', language: 'en', message: 'Who manages the office?', clean: ['Who manages the office?'], categories: ['identity_clean'], domain: 'work', author: 'w1', source: 'own-writing', notes: ''},
  ]);
  write(path.join(root, 'datasets_sources/nc/raw/writer-02.jsonl'), [{id: 'w02-1', language: 'mixed', message: 'poti sa verifici deadline-ul?', clean_en: ['Can you check the deadline?'], clean_ro: ['Poți verifica termenul?'], categories: ['mixed'], domain: 'work', author: 'w2', source: 'own-writing'}]);
  // The three datasets (DS008 "Three datasets"), one row each per split.
  const analysis = {columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences: [{text: 'Ana works at Acme.', start: 0, end: 18, tokens: [[1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'], [2, 'works', 'work', 'VERB', 0, 'root'], [3, 'at', 'at', 'ADP', 4, 'case'], [4, 'Acme', 'Acme', 'PROPN', 2, 'obl'], [5, '.', '.', 'PUNCT', 2, 'punct']]}]};
  const base = {rights: {license: 'MIT'}, quality_flags: {}, review_status: 'not_reviewed', source: {corpus: 'formalizer-v1', id: 'x'}};
  write(path.join(root, 'datasets/symbolic_english/train.jsonl'), [{...base, id: 's1', dataset: 'symbolic_english', split: 'train', message: 'Ana works at Acme.', analysis, sop: 'stated\n  relation "work at"', sop_valid: true, outcome: 'converted', unparsed: [], gold_sop: 'stated\n  relation "work at"', analysis_verified: 'gold_sop_match', verification: {sop_gold_match: true, judge: null, stanza_spacy_agree: true}, symbolic_lm: {version: 'v', rules: 'r', stanza: 's'}}]);
  write(path.join(root, 'eval/suites/symbolic_english/test.jsonl'), [{...base, id: 's2', dataset: 'symbolic_english', split: 'test', message: 'Ana works at Acme too.', analysis, sop: 'x', sop_valid: true, outcome: 'converted', unparsed: [], gold_sop: null, analysis_verified: 'pending_judge', verification: {sop_gold_match: null, judge: {verdict: 'PASS'}, stanza_spacy_agree: null}}]);
  write(path.join(root, 'datasets/neuro_english/dev.jsonl'), [
    {...base, id: 'n1', dataset: 'neuro_english', split: 'dev', message: 'ok Ana works at acme', analysis, sop: 'unparsed\n  span "ok"', sop_valid: true, outcome: 'converted', unparsed: ['ok'], gold_sop: 'stated\n  relation "work at"', failure_kind: 'rules', failure: {classes: ['R'], categories: ['R_missing'], frame_recoverable: false}, rewrite_target: true, target: 'Ana works at Acme.', target_source: 'proofing.repair', targets: [{text: 'Ana works at Acme.', source: 'proofing.repair'}], flags: [], analysis_verified: 'gold_sop_mismatch', verification: {sop_gold_match: false, judge: null, stanza_spacy_agree: false}},
    {...base, id: 'n2', dataset: 'neuro_english', split: 'dev', message: 'Who is Ana a parent of?', analysis, sop: 'x', sop_valid: true, outcome: 'converted', unparsed: [], gold_sop: 'y', failure_kind: 'gold_convention', failure: {classes: ['C'], categories: ['C_boundary']}, rewrite_target: false, target: null, target_source: null, targets: [], flags: ['gold_convention_not_a_rewrite_target'], analysis_verified: 'gold_sop_mismatch', verification: {sop_gold_match: false, judge: null, stanza_spacy_agree: null}}]);
  write(path.join(root, 'datasets/bad_english/train.jsonl'), [{...base, id: 'b1', dataset: 'bad_english', split: 'train', message: 'Is Ana the booss of Dan ?', language: 'en', language_kind: 'noisy_en', noise_categories: ['typo'], gate_reasons: ['spellfix would change: booss->boss'], target: 'Is Ana the boss of Dan?', target_source: 'noise-inverse', targets: [{text: 'Is Ana the boss of Dan?', source: 'noise-inverse'}]}]);
  const registry = {
    corpora: {bad_english: {type: 'bad_english'}, symbolic_english: {type: 'symbolic_english'}, neuro_english: {type: 'neuro_english'}, 'proofing-y': {type: 'proofreading', extra_files: [{split: 'hard', path: 'datasets/proofing-y/extra-hard.jsonl'}]}},
    patterns: [{test: '^proofing', type: 'proofreading'}, {test: '^formalizer', type: 'formalizer'}],
    default_type: 'formalizer',
    clean_text_sources: [{id: 'nc', label: 'New cases', dir: 'datasets_sources/nc/raw', local_only: true}],
  };
  const analyzed = [];
  const symbolic = symbolicChecker({create: async () => ({analyze: async message => { analyzed.push(message); if (message === 'Ana works at Acme.') return {sop: 'stated\n  relation "work at"', valid: true, outcome: 'converted', route: 'direct', language: 'en', analysis, trace: {unparsed: []}}; const clean = /^[A-Z].*[?.]$/.test(message) && !/booss/.test(message); return {sop: clean ? 'query\n  where match\n    relation "x"' : 'unparsed\n  span "x"', valid: clean, outcome: clean ? 'converted' : 'nothing_formalized', route: 'direct', language: 'en', uncertain: false, reasons: []}; }})});
  const router = createAuditRouter({root, registry, symbolic, ledgerDir: path.join(root, 'ledger'), reportDir: path.join(root, 'reports')});
  return {root, router, analyzed};
}

test('the shipped registry types every audited corpus and new formalizer-, proofing- names need no edit', () => {
  const registry = loadAuditRegistry();
  for (const name of ['formalizer-v1', 'formalizer-ood-v1', 'formalizer-wild-v1', 'clean-english']) assert.equal(corpusType(name, registry), 'formalizer', name);
  for (const name of ['proofing', 'proofing-diverse-dev', 'proofing-next']) assert.equal(corpusType(name, registry), 'proofreading', name);
  assert.equal(registry.clean_text_sources[0].local_only, true);
});

test('corpora are discovered per type from the registry, including one with only registry-declared files', () => {
  const {router} = fixture();
  const corpora = Object.fromEntries([...router.corpora.keys()].map(name => [name, router.summary(name)]));
  assert.deepEqual(Object.fromEntries(Object.entries(corpora).map(([name, item]) => [name, item.type])), {bad_english: 'bad_english', symbolic_english: 'symbolic_english', neuro_english: 'neuro_english', 'formalizer-x': 'formalizer', 'proofing-y': 'proofreading', nc: 'cleanText'});
  assert.deepEqual(Object.fromEntries(Object.entries(corpora).map(([name, item]) => [name, item.tab])), {bad_english: 'bad_english', symbolic_english: 'symbolic_english', neuro_english: 'neuro_english', 'formalizer-x': 'archive', 'proofing-y': 'archive', nc: 'archive'});
  assert.deepEqual(corpora['proofing-y'].splits, {hard: 1, test: 1, train: 2});
  assert.deepEqual(corpora['proofing-y'].sealedSplits, ['test']);
  assert.equal(corpora['proofing-y'].sealed, false);
  assert.equal(corpora.nc.localOnly, true);
  assert.equal(corpora.nc.rows, 3);
});

test('the audit has exactly the three dataset tabs and a secondary archive tab, each with a purpose', () => {
  assert.deepEqual(AUDIT_TABS, ['bad_english', 'symbolic_english', 'neuro_english', 'archive']);
  const tabs = tabDescriptions(loadAuditRegistry());
  assert.deepEqual(tabs.map(tab => tab.id), AUDIT_TABS);
  for (const tab of tabs) assert.ok(tab.purpose.length > 80, tab.id);
  assert.deepEqual(['bad_english', 'symbolic_english', 'neuro_english', 'formalizer', 'proofreading', 'cleanText'].map(tabOf), ['bad_english', 'symbolic_english', 'neuro_english', 'archive', 'archive', 'archive']);
});

test('symbolic_english shows the analysis as tree and table data, the verification status and filters', () => {
  const {router} = fixture();
  const summary = router.summary('symbolic_english');
  assert.deepEqual(summary.splits, {test: 1, train: 1});
  assert.deepEqual(summary.sealedSplits, ['test']);
  assert.equal(router.caseList('symbolic_english', {verification: 'pending_judge'}).total, 1);
  assert.equal(router.caseList('symbolic_english', {judge: 'PASS'}).total, 1);
  assert.equal(router.caseList('symbolic_english', {agreement: 'agree'}).total, 1);
  assert.equal(router.caseList('symbolic_english', {split: 'train'}).items[0].id, 's1');
  const detail = router.caseDetail('symbolic_english', 's1');
  assert.equal(detail.type, 'symbolic_english');
  assert.equal(detail.verification.analysis_verified, 'gold_sop_match');
  assert.equal(detail.sentences.length, 1);
  assert.equal(detail.sentences[0].tokens[1].deprel, 'root');
  assert.match(detail.sentences[0].tree, /^root {2}works \(VERB\)\n├─ nsubj {2}Ana/);
  assert.equal(detail.sentences[0].arcs[0], '1 Ana —nsubj→ 2 works');
  assert.match(detail.sop, /work at/);
  assert.equal(dependencyTree(sentencesView(detail.raw[0].analysis)[0].tokens), detail.sentences[0].tree);
});

test('symbolic_english re-run classifies the row against the stored analysis', async () => {
  const {router, analyzed} = fixture();
  assert.deepEqual(analyzed, []);
  const same = await router.executeCase('symbolic_english', 's1');
  assert.equal(same.class, 'same');
  assert.equal(same.same_analysis, true);
  assert.equal(same.same_sop, true);
  const changed = await router.executeCase('symbolic_english', 's2');
  assert.notEqual(changed.class, 'same');
  assert.equal(changed.same_sop, false);
});

test('neuro_english shows failure kind, blame and the rewrite diff, and checks message and target on demand', async () => {
  const {router} = fixture();
  assert.equal(router.caseList('neuro_english', {failure_kind: 'rules'}).total, 1);
  assert.equal(router.caseList('neuro_english', {blame: 'C_boundary'}).total, 1);
  assert.equal(router.caseList('neuro_english', {target_state: 'not a rewrite target'}).total, 1);
  assert.equal(router.caseList('neuro_english', {flag: 'gold_convention_not_a_rewrite_target'}).total, 1);
  const detail = router.caseDetail('neuro_english', 'n1');
  assert.equal(detail.failure_kind, 'rules');
  assert.deepEqual(detail.failure.categories, ['R_missing']);
  assert.ok(detail.targets[0].spans.some(span => span.type !== 'equal'));
  assert.equal(detail.gold_sop.includes('work at'), true);
  const check = await router.executeCase('neuro_english', 'n1');
  assert.equal(check.message.check.valid, false);
  assert.equal(check.targets[0].check.valid, true);
  assert.equal(check.targets[0].improved, true);
  assert.equal(check.targets[0].matches_gold, true);
  assert.equal(check.targets[0].check.current, undefined, 'the stored-shape result stays server side');
});

test('bad_english shows kind, noise and the target diff, and classifies the target on demand', async () => {
  const {router} = fixture();
  assert.equal(router.caseList('bad_english', {kind: 'noisy_en'}).total, 1);
  assert.equal(router.caseList('bad_english', {noise: 'typo'}).total, 1);
  assert.equal(router.caseList('bad_english', {target_state: 'has target'}).total, 1);
  const detail = router.caseDetail('bad_english', 'b1');
  assert.equal(detail.kind, 'noisy_en');
  assert.deepEqual(detail.noise_categories, ['typo']);
  assert.ok(detail.targets[0].spans.some(span => span.type === 'insert' || span.type === 'delete'));
  const check = await router.executeCase('bad_english', 'b1');
  assert.equal(check.message.partition, 'noisy_en');
  assert.equal(check.targets[0].clean_english, true);
});

test('a dataset index follows a rewritten split file instead of reading stale byte ranges', () => {
  const {root, router} = fixture();
  assert.equal(router.caseDetail('bad_english', 'b1').message, 'Is Ana the booss of Dan ?');
  const file = path.join(root, 'datasets/bad_english/train.jsonl');
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  write(file, [{...row, id: 'b0', message: 'A longer first row so the offsets move .'}, row]);
  assert.equal(router.caseDetail('bad_english', 'b1').message, 'Is Ana the booss of Dan ?');
  assert.equal(router.caseList('bad_english', {}).total, 2);
});

test('proofreading cases carry the word diff, kind and pipeline; filters and paging run on the server', () => {
  const {router} = fixture();
  const all = router.caseList('proofing-y', {limit: 2});
  assert.equal(all.total, 4);
  assert.equal(all.pages, 2);
  assert.equal(all.items.length, 2);
  assert.equal(router.caseList('proofing-y', {kind: 'repair'}).total, 2);
  assert.equal(router.caseList('proofing-y', {split: 'hard'}).total, 1);
  assert.equal(router.caseList('proofing-y', {q: 'booss'}).total, 1);
  assert.equal(router.facets('proofing-y').groups.find(group => group.key === 'kind').values.identity, 1);
  const detail = router.caseDetail('proofing-y', 'c1');
  assert.equal(detail.type, 'proofreading');
  const row = detail.rows[0];
  assert.deepEqual(row.spans.filter(span => span.type !== 'equal').map(span => [span.type, span.text.trim()]), [['delete', 'booss'], ['insert', 'boss']]);
  assert.equal(row.kind, 'repair');
  assert.equal(row.char_edit, 1);
  assert.equal(router.caseDetail('proofing-y', 'c3').rows[0].spans, null);
});

test('cleanText cases show message to candidates with diffs, categories and author,', () => {
  const {router} = fixture();
  assert.equal(router.caseList('nc', {category: 'typos'}).total, 1);
  assert.equal(router.caseList('nc', {kind: 'identity'}).total, 1);
  assert.equal(router.caseList('nc', {split: 'writer-02'}).items[0].id, 'w02-1');
  const detail = router.caseDetail('nc', 'w01-1');
  assert.equal(detail.type, 'cleanText');
  assert.equal(detail.local_only, true);
  assert.deepEqual(detail.category, ['casual_register', 'typos']);
  assert.equal(detail.author, 'w1');
  assert.ok(detail.rows[0].candidates[0].spans.some(span => span.type === 'insert'));
  assert.deepEqual(router.caseDetail('nc', 'w02-1').rows[0].candidates.map(item => item.text), ['Can you check the deadline?']);
  assert.deepEqual(router.caseDetail('nc', 'w02-1').clean_ro, ['Poți verifica termenul?']);
});

test('the SymbolicLM check runs on demand for both texts and reports an unavailable worker without throwing', async () => {
  const {router, analyzed} = fixture();
  assert.deepEqual(analyzed, []);
  const proof = await router.executeCase('proofing-y', 'c1');
  assert.equal(proof.type, 'proofreading');
  assert.equal(proof.rows[0].input.valid, false);
  assert.equal(proof.rows[0].target.valid, true);
  assert.equal(proof.rows[0].improved, true);
  assert.deepEqual(analyzed, ['Is Ana the booss of Dan?', 'Is Ana the boss of Dan?']);
  const clean = await router.executeCase('nc', 'w01-1');
  assert.equal(clean.rows[0].candidates[0].check.valid, true);
  assert.equal(clean.rows[0].candidates[0].improved, true);
  const missing = symbolicChecker({create: async () => { throw new Error('no Stanza venv'); }});
  assert.deepEqual(await missing.check('hello'), {ok: false, error: 'no Stanza venv'});
});

test('a verdict is appended to the ledger of its corpus and the corpus data stays untouched', () => {
  const {root, router} = fixture();
  const before = fs.readFileSync(path.join(root, 'eval/suites/proofing-y/test.jsonl'), 'utf8');
  const record = router.recordVerdict({corpus: 'proofing-y', caseId: 'c9', verdict: 'approve', note: 'fine'});
  assert.equal(record.type, 'proofreading');
  assert.equal(record.targetSha256, null);
  router.recordVerdict({corpus: 'nc', caseId: 'w01-2', verdict: 'needs_fix'});
  assert.equal(fs.readFileSync(path.join(root, 'ledger/proofing-y.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.equal(fs.readFileSync(path.join(root, 'eval/suites/proofing-y/test.jsonl'), 'utf8'), before);
  assert.equal(router.caseList('nc', {verdict: 'needs_fix'}).total, 1);
});

test('the audit page renders one tab per dataset plus the archive tab and is usable at phone width', () => {
  const html = auditPage({tabs: tabDescriptions(loadAuditRegistry())});
  assert.match(html, /window\.CHATSOP_AUDIT=\{"tabs":\[\{"id":"bad_english"/);
  assert.match(html, /"id":"archive"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /@media \(max-width:900px\)/);
  assert.match(html, /name="viewport"/);
});
