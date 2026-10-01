/** Rules ud-rules-v1.4 of the UD → SOP converter (lib/ud-to-sop/, experiment eval-ud-rules-v14-v1): recorded Stanza
 * parses of ChatSOP-authored sentences (tests/fixtures/ud-to-sop/parses-v14.json) go through the rules without
 * Python; each test checks one v1.4 rule or tree repair on the SOP it produces, and every output is admitted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {convertParse, admissionError, claimScope} from '../lib/ud-to-sop/index.mjs';
import {repairSentence} from '../lib/ud-to-sop/repair.mjs';
import {numericConstraint} from '../lib/ud-to-sop/numeric.mjs';

const fixtures = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/ud-to-sop/parses-v14.json', import.meta.url)), 'utf8')).parses;
const sop = key => convertParse(fixtures[key].parse, fixtures[key].message).sop;

test('every v1.4 fixture converts to an admitted program', () => {
  for (const [key, {parse, message}] of Object.entries(fixtures)) assert.equal(admissionError(convertParse(parse, message).sop, message), null, key);
});

test('a mid-message lead-in checks only what follows it; a claim tail checks the sentence before it (R1)', () => {
  const out = sop('lead_in_scope');
  assert.match(out, /@s1 stated\n  relation "work at"/);
  assert.match(out, /query\n  where match\n    relation "live in"/);
  const lead = 'Is this correct? "Ana works at Acme"';
  assert.equal(lead.slice(...claimScope(lead)).trim(), '"Ana works at Acme"');
  const tail = 'Ion lives in Cluj. "Ana works at Acme" — does that hold?';
  assert.equal(tail.slice(...claimScope(tail)).trim().replace(/[—\s-]+$/, ''), '"Ana works at Acme"');
});

test('action requests in question form and in a conjunct ask nothing checkable (R13)', () => {
  assert.match(sop('action_question'), /kind no_request/);
  const out = sop('action_conjunct');
  assert.match(out, /relation "work at"/);
  assert.doesNotMatch(out, /draft/);
});

test('an offered answer turns the wh-question into a yes/no query; a follow-up is a fragment (R12, R17)', () => {
  const offered = sop('offered_answer');
  assert.doesNotMatch(offered, /select/);
  assert.match(offered, /role location "Arad"/);
  assert.match(sop('follow_up_time'), /fragment follow_up[\s\S]*role time "Friday"/);
});

test('conjoined clauses inside one embedded question are one query (R7) and a bare noun joins the relation (R6)', () => {
  const out = sop('embedded_conjuncts');
  assert.equal((out.match(/@q/g) ?? []).length, 1);
  assert.match(out, /where all/);
  assert.match(out, /relation "attend classes at"\n\s+role subject "Radu"\n\s+role object "Arad Music School"/);
  assert.match(sop('trip_to'), /relation "go on a trip to"[\s\S]*role destination "Sibiu"/);
  assert.match(sop('idiom_noun'), /relation "be out of service"/);
  assert.match(sop('collective'), /relation "buy together"[\s\S]*role subject "Irina and Dan"/);
  assert.match(sop('light_indefinite'), /relation "have an allergy to"[\s\S]*role object "pollen"/);
});

test('tree repairs: stranded prepositions, by-agents, relational nouns and titles (R5, R19, TR-NAME)', () => {
  assert.match(sop('stranded_member_of'), /mode count[\s\S]*relation "be a member of"[\s\S]*role subject "Elena"/);
  assert.match(sop('passive_by_wh'), /relation "be repaired by"\n\s+role subject "the bike"\n\s+role object \?x/);
  assert.match(sop('relational_wh'), /relation "be the boiling point of"[\s\S]*role object "ethanol"/);
  assert.match(sop('title_run'), /role object "Songs from the Old Harbour"/);
  const parse = fixtures.title_run.parse.sentences[0];
  assert.ok(repairSentence(parse).words.length === parse.words.length);
});

test('quantifiers, scope ambiguity, indefinite places and existentials (R2, R4, R8, R16, Q-LANG-2)', () => {
  assert.match(sop('partitive_half'), /quantifier half[\s\S]*relation "be a player of"/);
  assert.match(sop('none_of'), /quantifier none[\s\S]*relation "be a member of"/);
  assert.doesNotMatch(sop('none_of'), /polarity negated/);
  const ambiguous = sop('all_not');
  assert.match(ambiguous, /kind ambiguous/);
  assert.equal((ambiguous.match(/reading/g) ?? []).length, 2);
  assert.match(sop('indefinite_place'), /relation "be in"\n\s+role subject \?c\n\s+role location "Iași"/);
  assert.match(sop('existential_there'), /relation "work at"\n\s+role subject \?x\n\s+role object "Nova Labs"/);
});

test('asof, numeric constraints, Romanian lemmas and motion roles (R10, R15, C1, C3)', () => {
  assert.match(sop('asof'), /asof "3 May 2024"/);
  assert.match(sop('percentage'), /require \?x equal 3000 times 15[\s\S]*select \?x/);
  assert.match(sop('range_bound'), /var \?x int 3 12\n  claim \?x below 5\n  task possible/);
  assert.equal(numericConstraint('Who works at Acme?'), null);
  assert.match(sop('ro_participle'), /relation "fi căsătorit cu"/);
  assert.match(sop('ro_wonder'), /@q query/);
  assert.match(sop('ro_plan_merge'), /relation "plănui participa la"/);
  assert.match(sop('move_from_to'), /role source "Cluj"\n\s+role destination "Iași"/);
});
