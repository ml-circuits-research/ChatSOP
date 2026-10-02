// Archived 2026-10-02 from tests/query-author.test.mjs: the tests of the retired omp circuit author backend (omp-backend.mjs).
// History only; not run.

test('omp backend: a rejected predicate is repaired in the same tool-free conversation', async t => {
  const folder = tempDir(t, 'qa-omp-');
  const log = path.join(tempDir(t, 'qa-log-'), 'calls.jsonl');
  withEnv(t, {STUB_OMP_MODE: 'good', STUB_OMP_LOG: log, STUB_OMP_QUERY: Q('levitate above', 'Ana', 'Bob'), STUB_OMP_QUERY_FIX: GOOD});
  const r = await authorQuery({message: 'Does Ana work at Lab Alpha?', lexicon: lex, folder, backend: ompBackend({bin: STUB, model: 'stub/model', timeoutMs: 30_000}), maxFixRounds: 2});
  assert.equal(r.status, 'validated', JSON.stringify(r.validation?.problems));
  assert.equal(r.sop, GOOD.trim());
  assert.equal(r.rounds, 2);
  assert.equal(r.usage.turns, 2);
  assert.ok(r.usage.cost_usd > 0);
  withEnv(t, {STUB_OMP_MODE: 'none'});
  const silent = await authorQuery({message: 'x', lexicon: lex, folder: tempDir(t, 'qa-omp-'), backend: ompBackend({bin: STUB, timeoutMs: 30_000})});
  assert.equal(silent.status, 'failed');
  assert.match(silent.reason, /no circuit/);
  const missing = await authorQuery({message: 'x', lexicon: lex, folder: tempDir(t, 'qa-omp-'), backend: ompBackend({bin: '/nonexistent/omp'})});
  assert.equal(missing.status, 'failed');
  assert.match(missing.reason, /could not be started/);
});

test('omp backend rejects missing, truncated, or mixed prose output without salvaging a circuit', async t => {
  const context = buildContext({message: 'Does Ana work at Lab Alpha?', lexicon: lex});
  const folder = tempDir(t, 'qa-omp-output-');
  // A stale file is never a fallback for a failed final answer.
  fs.writeFileSync(path.join(folder, 'query.sop'), GOOD);
  for (const final_text of ['', `Here is the answer:\n${GOOD}`, `${GOOD}\nThis is true.`, `\`\`\`sop\n${GOOD}`, `\`\`\`sop\n${GOOD}`, `Reading chosen: x\n\`\`\`sop\n${GOOD}\`\`\``]) {
    const backend = ompBackend({runner: async () => ({ok: true, final_text, usage: {}, duration_ms: 1})});
    const result = await backend.generate({context, folder});
    assert.equal(result.ok, false, JSON.stringify(final_text));
    assert.equal(result.sop, '');
    assert.match(result.reason, /circuit output rejected/);
  }
  // A wholly circuit-shaped text with a syntax error (truncated block, unknown field) is not salvaged either: it goes whole
  // to admission, which rejects it with a problem for a repair round.
  for (const final_text of ['@q query\n  where match\n', '@q query\n  kind entity\n  where match\n    relation "works_at"\n  end\n']) {
    const passed = await ompBackend({runner: async () => ({ok: true, final_text, usage: {}, duration_ms: 1})}).generate({context, folder});
    assert.equal(passed.ok, true, final_text);
    assert.equal(passed.sop, final_text.trim());
    assert.equal(validateQuery({sop: passed.sop, message: 'Does Ana work at Lab Alpha?', lexicon: lex}).ok, false);
  }
  // The invited optional report may follow the circuit fence as its own md fence; a stray top-level end goes to repair.
  const reported = await ompBackend({runner: async () => ({ok: true, final_text: `\`\`\`sop\n${GOOD}\`\`\`\n\n\`\`\`md\n# report.md\n- reading chosen\n\`\`\``, usage: {}, duration_ms: 1})}).generate({context, folder});
  assert.equal(reported.ok, true, reported.reason);
  assert.equal(reported.sop, GOOD.trim());
  const remark = await ompBackend({runner: async () => ({ok: true, final_text: `\`\`\`sop\n${GOOD}\`\`\`\n\nReading chosen: the employer reading.`, usage: {}, duration_ms: 1})}).generate({context, folder});
  assert.equal(remark.sop, GOOD.trim(), 'a short report after the complete fence is the invited report, not part of the circuit');
  const stray = await ompBackend({runner: async () => ({ok: true, final_text: `${GOOD}end\n`, usage: {}, duration_ms: 1})}).generate({context, folder});
  assert.equal(stray.ok, true, stray.reason);
  assert.equal(validateQuery({sop: stray.sop, message: 'Does Ana work at Lab Alpha?', lexicon: lex}).ok, false);
  // Session definitions are parsed with the knowledge grammar, not rejected as unknown model wires.
  const defined = await ompBackend({runner: async () => ({ok: true, final_text: `@colleague predicate\n  args subject:entity object:entity\n${GOOD}`, usage: {}, duration_ms: 1})}).generate({context, folder});
  assert.equal(defined.ok, true, defined.reason);
  const accepted = await ompBackend({runner: async () => ({ok: true, final_text: `\`\`\`sop\n${GOOD}\`\`\``, usage: {}, duration_ms: 1})}).generate({context, folder});
  assert.equal(validateQuery({sop: accepted.sop, message: 'Does Ana work at Lab Alpha?', lexicon: lex}).ok, true);
});

