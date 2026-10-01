/** UD -> SOP rules v1.5 draft (experiment eval-ud-rules-v15-v1, tools/research/ud-rules-v15-draft/): recorded Stanza
 * parses (tests/fixtures/ud-to-sop/parses-v15-draft.json) go through the DRAFT copy of the rules without Python and
 * without touching lib/ud-to-sop (translator-agent coordination constraint; see AGENTS.md and the preregistration).
 * Each test checks one v1.5 candidate fix; every output is admitted. Once translator-agent records a done/blocked
 * journal event and the draft is ported into lib/ud-to-sop, this file's import moves from the draft to
 * ../lib/ud-to-sop/index.mjs (as tests/ud-to-sop-v14.test.mjs does) and the fixture is regenerated from the live
 * rules; until then it is the draft's own regression guard. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRules} from '../tools/research/ud-rules-v14.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DRAFT = path.join(ROOT, 'tools/research/ud-rules-v15-draft');
const {convertParse} = await loadRules(DRAFT);

const fixtures = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/ud-to-sop/parses-v15-draft.json', import.meta.url)), 'utf8')).parses;
const sop = key => convertParse(fixtures[key].parse, fixtures[key].message).sop;

test('every v1.5-draft fixture converts to an admitted program', () => {
  for (const [key, {parse, message}] of Object.entries(fixtures)) {
    const result = convertParse(parse, message);
    assert.equal(result.valid, true, `${key}: ${result.error}`);
  }
});

test('Romanian claim tail "— se confirmă?" is one query on the quoted claim, not two unlinked wires (eval-ud-rules-v14-v1 lost row fv1_011603_0_0)', () => {
  const out = sop('ro_claim_tail_confirma');
  assert.equal((out.match(/^@\w+ query/gm) ?? []).length, 1, out);
  assert.match(out, /relation "împrumuta"/);
  assert.match(out, /role subject "Ghiță"/);
  assert.match(out, /role object "Ciorbele Transilvaniei"/);
  assert.doesNotMatch(out, /confirma/);
});

test('Romanian claim tail "— așa este?" is one query on the quoted claim, not two unlinked wires', () => {
  const out = sop('ro_claim_tail_asa_este');
  assert.equal((out.match(/^@\w+ query/gm) ?? []).length, 1, out);
  assert.match(out, /relation "lucra la"/);
  assert.match(out, /polarity negated/);
});

test('a weekday nested inside a compound noun phrase stays in the value; a clause-level weekday is still pulled out as a time (eval-ud-rules-v14-v1 lost row ood2_000100_0_0)', () => {
  const nested = sop('ro_weekday_nested_in_value');
  assert.doesNotMatch(nested, /valid on/);
  assert.match(nested, /joi/);
  const clauseTime = sop('ro_weekday_clause_time');
  assert.match(clauseTime, /valid on "luni"/);
});

test('an event\'s venue after "held" is role location even when Stanza tags it a facility/organization, not role object (TODO.md "be held at/in")', () => {
  assert.match(sop('held_at_progressive_passive'), /relation "be held at"[\s\S]*role location "the Community Centre"/);
  assert.match(sop('held_at_simple_passive'), /relation "be held at"[\s\S]*role location "the Community Centre"/);
  // Regression: a geographic place after "held in" already worked under v1.4 and must keep working.
  assert.match(sop('held_in_gpe_regression'), /relation "be held in"[\s\S]*role location "Cluj"/);
});
