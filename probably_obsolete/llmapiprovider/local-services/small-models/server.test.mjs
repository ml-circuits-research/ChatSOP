// The small-model local service of LLMAPIProvider (local-services/small-models): request checks and the HTTP layer over fake backends.
// No model is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, structureRequest, folRequest} from './server.mjs';

test('request checks and fake backends over HTTP', async () => {
  assert.throws(() => structureRequest({text: ''}), /text must be/);
  assert.throws(() => structureRequest({text: 'x'}), /nothing to extract/);
  assert.throws(() => folRequest({inputs: ['a'], candidates: 9}, {maxCandidates: 8}), /candidates must be/);
  assert.deepEqual(folRequest({text: 'All cats are animals.'}).inputs, ['All cats are animals.']);
  const backends = {
    structure: {id: 'fake-psm', status: () => ({loaded: true}), run: async r => ({entities: {quantity: [{text: r.text.match(/\d+/)[0]}]}, relations: [], structures: {}})},
    formalizer: {id: 'fake-lfm', status: () => ({loaded: true}), run: async r => ({results: r.inputs.map(input => ({input, candidates: ['Cat(tom)'].slice(0, r.candidates), tokens: 3}))})},
  };
  const server = createServer({backends, config: {formalizer: {maxCandidates: 8}}});
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/v1/structure`, {method: 'POST', body: JSON.stringify({text: 'Ana has 12 apples.', entities: ['quantity']})})).json();
    assert.equal(s.object, 'structure'); assert.equal(s.model, 'fake-psm'); assert.equal(s.entities.quantity[0].text, '12');
    const f = await (await fetch(`${base}/v1/fol`, {method: 'POST', body: JSON.stringify({inputs: ['Tom is a cat.']})})).json();
    assert.equal(f.results[0].candidates[0], 'Cat(tom)');
    const bad = await fetch(`${base}/v1/fol`, {method: 'POST', body: '{"inputs": []}'});
    assert.equal(bad.status, 400);
    assert.equal((await (await fetch(`${base}/health`)).json()).models.structure.loaded, true);
  } finally { server.close(); }
});
