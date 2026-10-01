// No-context guard G1 (eval/reports/history/no-context-sweep.md): the small model's prompt is the user's message
// and nothing else, in the prompt builders, the training projection, the audit browser and the projected corpora.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {barePrompt, formalPrompt} from '../eval/llm.mjs';
import {project, assertMessageOnly, PROMPT_PROFILE, FORBIDDEN_PROMPT} from '../tools/research/prepare-experiment.mjs';
import {promptOf} from '../server/audit.mjs';
import {readJsonlShardedSync} from '../lib/jsonl-shards.mjs';
import {corpusDir, corpusNames} from '../lib/dataset-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const message = 'Ana works at Acme. Does she still work there?';
const row = {
  id: 'fixture_1', question: message, model_input: message, language: 'en', split: 'train', split_group_id: 'g1', family: 'attached', question_type: 'yes_no',
  sop_target: '@q query\n  where match\n    relation "work at"\n    role subject "Ana"\n    role object "Acme"\n    polarity affirmed\n  end\n',
  // Evaluation-only scaffolding that must never reach a prompt.
  context: {now: '2026-09-28T12:00:00Z', model_visible: false, entities: [{id: 'ana', label: 'Ana'}], predicates: [{id: 'works_at', args: ['person', 'organization']}], background_assertions: ['x'], canonicalMentions: ['ana']},
  ontology_sop: '@ana entity\n  kind person\n  label en "Ana"\n', setup_sop: '@f fact\n  holds works_at ana acme\n  valid timeless\n',
};

test('G1: barePrompt is the message, formalPrompt adds only the fixed instructions', () => {
  assert.equal(barePrompt(message), message);
  const formal = formalPrompt(message);
  assert.ok(formal.endsWith('MESSAGE\n' + message));
  for (const forbidden of ['CONTEXT', '"entities"', '"predicates"', 'background_', 'canonicalMentions']) assert.ok(!formal.includes(forbidden), forbidden);
});

test('G1: the training projection and the audit browser use the message only', () => {
  const projected = project(row);
  assert.equal(projected.prompt, row.question);
  assert.deepEqual(Object.keys(projected).sort(), ['family', 'group', 'id', 'language', 'prompt', 'question_type', 'target']);
  assert.equal(promptOf(row), row.question);
  // Fail closed: a prompt that is not the message, or a row that splits the message, is refused.
  assert.throws(() => assertMessageOnly(row, 'CONTEXT\n{}\nMESSAGE\n' + message), /must equal the user's message/);
  assert.throws(() => assertMessageOnly({...row, context_assertions: ['Ana works at Acme.']}, message), /context_assertions are not model input/);
  assert.throws(() => assertMessageOnly({...row, model_input: 'other'}, message), /model_input differs/);
  assert.throws(() => project({...row, question: 'CONTEXT {"entities": []}', model_input: undefined}), /carries context/);
  assert.ok(FORBIDDEN_PROMPT.some(pattern => pattern.test('CONTEXT\n')));
});

test('G1: every projected formalizer prompt equals its source message', () => {
  const corpora = corpusNames(root).filter(name => fs.existsSync(path.join(root, corpusDir(name, root), 'formalizer/manifest.json'))).map(name => ({name, dir: path.join(root, corpusDir(name, root))}));
  assert.ok(corpora.length > 0, 'the legacy corpora with a formalizer projection are found');
  for (const entry of corpora) {
    const manifest = JSON.parse(fs.readFileSync(path.join(entry.dir, 'formalizer/manifest.json'), 'utf8'));
    assert.equal(manifest.prompt_profile, PROMPT_PROFILE, entry.name);
    for (const split of ['train', 'dev']) {
      const questions = new Map(readJsonlShardedSync(path.join(entry.dir, `${split}.jsonl`)).map(r => [r.id, r.question]));
      const projected = readJsonlShardedSync(path.join(entry.dir, `formalizer/${split}.jsonl`));
      assert.equal(projected.length, questions.size, `${entry.name}/${split}: projection covers every row`);
      for (const p of projected) assert.equal(p.prompt, questions.get(p.id), `${entry.name}/${split}/${p.id}`);
    }
  }
});
