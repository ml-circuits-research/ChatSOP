import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This is a sealed, small evaluation reference, not training material or a
// checkpoint-selection set. The tuple oracles below were annotated from the
// quoted paragraphs, not computed by running the SOP target or by reading QA spans.
const VERSION = 'source-reference-v2';
const RAW_SHA256 = '80a5225e94905956a6446d296ca1093975c4d3b3260f1d6c8f68bc2ab77182d8';
const SOURCE_URL = 'https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v2.0.json';
const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const rawPath = path.join(root, 'datasets_sources/squad2-dev/raw/dev-v2.0.json');
const scaffoldPath = path.join(root, 'datasets/normalized/squad2-dev/scaffold.jsonl');
const licensePath = path.join(root, 'datasets_sources/squad2-dev/LICENSE.json');
const quote = text => JSON.stringify(text);

const worlds = [
  {
    paragraph: 0,
    entities: { normans: 'group', normandy: 'region', france: 'country', norse_raiders: 'group', denmark: 'country', iceland: 'country', norway: 'country', rollo: 'person', charles_iii: 'person' },
    predicates: {
      region_in: ['region', 'country', 'Normandy is a region in France, not the reverse.'],
      named_region: ['group', 'region', 'The group gave its name to the region.'],
      raiders_from: ['group', 'country', 'Country of origin stated for the Norse raiders and pirates.'],
      led_by: ['group', 'person', 'Group under its leader.'],
      agreed_to_swear_fealty_to: ['group', 'person', 'The group agreed to swear fealty to the named ruler; this does not assert that the oath was completed.'],
    },
    facts: [
      ['region_in normandy france', 'Normandy, a region in France'],
      ['named_region normans normandy', 'the people who in the 10th and 11th centuries gave their name to Normandy'],
      ...['denmark', 'iceland', 'norway'].map(country => [`raiders_from norse_raiders ${country}`, 'raiders and pirates from Denmark, Iceland and Norway']),
      ['led_by norse_raiders rollo', 'under their leader Rollo'],
      ['agreed_to_swear_fealty_to norse_raiders charles_iii', 'agreed to swear fealty to King Charles III of West Francia'],
    ],
  },
  {
    paragraph: 1,
    entities: { normans: 'group', gallo_romance: 'language', roger_ii: 'person', kingdom_sicily: 'polity', bohemond_i: 'person', principality_antioch: 'polity' },
    predicates: {
      adopted_language: ['group', 'language', 'The group adopted the named language.'],
      founded: ['person', 'polity', 'Explicitly credited founding of a polity; direction matters.'],
      founded_under: ['polity', 'person', 'Named leader under whom Norman adventurers founded the polity.'],
    },
    facts: [
      ['adopted_language normans gallo_romance', 'They adopted the Gallo-Romance language of the Frankish land they settled'],
      ['founded_under kingdom_sicily roger_ii', 'Norman adventurers founded the Kingdom of Sicily under Roger II'],
      ['founded bohemond_i principality_antioch', 'their prince Bohemond I founded the Principality of Antioch in the Levant'],
    ],
  },
  {
    paragraph: 3,
    entities: { duchy_normandy: 'polity', treaty_saint_clair: 'treaty', charles_iii: 'person', rollo: 'person', neustria: 'polity' },
    predicates: {
      established_by_treaty: ['polity', 'treaty', 'The polity was established by the named treaty.'],
      treaty_party: ['treaty', 'person', 'Named party to the treaty.'],
      situated_in: ['polity', 'polity', 'The Duchy was situated in the former kingdom.'],
    },
    facts: [
      ['established_by_treaty duchy_normandy treaty_saint_clair', 'The Duchy of Normandy, which began in 911 as a fiefdom, was established by the treaty of Saint-Clair-sur-Epte'],
      ['treaty_party treaty_saint_clair charles_iii', 'the treaty of Saint-Clair-sur-Epte between King Charles III of West Francia and the famed Viking ruler Rollo'],
      ['treaty_party treaty_saint_clair rollo', 'the treaty of Saint-Clair-sur-Epte between King Charles III of West Francia and the famed Viking ruler Rollo'],
      ['situated_in duchy_normandy neustria', 'was situated in the former Frankish kingdom of Neustria'],
    ],
  },
];

// Manually enumerated finite tuples. An empty result below means not established
// by this bounded source world (UNKNOWN), never an assertion of falsity.
const cases = [
  { id: 'region', world: 0, structure: 'location-direction', where: ['region_in normandy ?country'], select: '?country', answers: [['france']], rationale: 'The phrase “Normandy, a region in France” maps region→country.', en: ['According to the passage, which country contains the region of Normandy?', 'In which country does this text place Normandy?', 'What country is Normandy described as a region in?'] },
  { id: 'name-giver', world: 0, structure: 'naming-role', where: ['named_region ?group normandy'], select: '?group', answers: [['normans']], rationale: '“The people ... gave their name to Normandy” refers back to the Normans in the same sentence.', en: ['Which people gave their name to Normandy in the passage?', 'Name the group whose name was given to Normandy.', 'Whose name is the region of Normandy described as deriving from?'] },
  { id: 'raider-origins', world: 0, structure: 'multiple-source-countries', where: ['raiders_from norse_raiders ?country'], select: '?country', answers: [['denmark'], ['iceland'], ['norway']], rationale: 'The text explicitly enumerates Denmark, Iceland and Norway as sources of the Norse raiders and pirates; all three are returned.', en: ['Which countries are named as origins of the Norse raiders and pirates?', 'List the countries from which the passage says those Norse raiders and pirates came.', 'Where are the Norse raiders and pirates described as coming from?'] },
  { id: 'leader', world: 0, structure: 'leader-direction', where: ['led_by norse_raiders ?person'], select: '?person', answers: [['rollo']], rationale: '“under their leader Rollo” identifies the leader of the previously described Norse raiders and pirates.', en: ['Who led the Norse raiders and pirates in this passage?', 'Name the leader under whom the Norse raiders are described.', 'Who is identified as the raiders’ leader?'] },
  { id: 'fealty', world: 0, structure: 'fealty-recipient', where: ['agreed_to_swear_fealty_to norse_raiders ?ruler'], select: '?ruler', answers: [['charles_iii']], rationale: 'The raiders agreed to swear fealty to King Charles III of West Francia; the group, not Rollo alone, is the subject.', en: ['To which ruler did the Norse raiders agree to swear fealty?', 'Name the recipient of the raiders’ promised fealty.', 'Who was the ruler to whom those raiders agreed to swear fealty?'] },
  { id: 'leader-fealty-join', world: 0, structure: 'shared-group-join', where: ['led_by ?group rollo', 'agreed_to_swear_fealty_to ?group charles_iii'], select: '?group', answers: [['norse_raiders']], rationale: 'The same Norse raider group is stated to be under Rollo and to agree to swear fealty to Charles III.', en: ['Which group was both under Rollo and agreeing to swear fealty to Charles III?', 'Identify the group linked to both Rollo as leader and Charles III as fealty recipient.', 'What group has Rollo as leader and promised fealty to Charles III?'] },
  { id: 'leader-reversed', world: 0, structure: 'leader-role-substitution-negative', negative: 'leader', where: ['led_by ?group charles_iii'], select: '?group', answers: [], rationale: 'Charles III is the fealty recipient, not an attested leader of a group; no negative fact about his leadership is asserted.', en: ['Which group does the passage establish as led by Charles III?', 'Name the group said to have Charles III as its leader, if any is established.', 'Is any group identified as being under Charles III as leader?'] },
  { id: 'fealty-reversed', world: 0, structure: 'fealty-role-substitution-negative', negative: 'fealty', where: ['agreed_to_swear_fealty_to ?group rollo'], select: '?group', answers: [], rationale: 'Rollo is the attested leader, not the attested recipient of fealty; absence of such a group is UNKNOWN, not a negative claim.', en: ['Which group does the passage say agreed to swear fealty to Rollo?', 'Name the group with Rollo as its fealty recipient, if established.', 'Does the passage identify any group promising fealty to Rollo?'] },
  { id: 'region-polarity', world: 0, structure: 'supported-claim-polarity-flip', negative: 'region', where: ['not region_in normandy france'], status: 'refuted', answers: [], rationale: 'The direct positive “Normandy, a region in France” refutes this explicit negative query; this is different from UNKNOWN on an unstated country.', en: ['Does the passage support the claim that Normandy is not a region in France?', 'Is the negative assertion “Normandy is not in France” consistent with the stated regional location?', 'Can the text establish that Normandy is outside France rather than inside it?'] },
  { id: 'absence-not-negation', world: 0, structure: 'owa-explicit-negation', negative: 'raider-origins', where: ['not raiders_from norse_raiders france'], answers: [], rationale: 'France is mentioned as Normandy’s location, but the text neither states nor explicitly denies France as an origin of these raiders; NOT is unknown, not supported.', en: ['Does the passage explicitly establish that these Norse raiders did not come from France?', 'Is a negative claim about France as an origin of the raiders supported by the text?', 'Can the passage prove the raiders were not from France?'] },
  { id: 'adopted-language', world: 1, structure: 'language-adoption', where: ['adopted_language normans ?language'], select: '?language', answers: [['gallo_romance']], rationale: '“They adopted the Gallo-Romance language” refers to the Normans in the preceding sentence.', en: ['Which language does the passage say the Normans adopted?', 'Name the language adopted by the Normans in the account.', 'What language did the Normans take up according to the text?'] },
  { id: 'sicily-founder', world: 1, structure: 'polity-founding-under', where: ['founded_under kingdom_sicily ?person'], select: '?person', answers: [['roger_ii']], rationale: 'The Kingdom of Sicily was founded by Norman adventurers “under Roger II”; he is the leader of the founding, not asserted to have acted alone.', en: ['Under whose leadership did Norman adventurers found the Kingdom of Sicily?', 'Who is named as the leader under whom the Kingdom of Sicily was founded?', 'The founding of the Kingdom of Sicily by Norman adventurers was under whom?'] },
  { id: 'antioch-founder', world: 1, structure: 'polity-founding-direct', where: ['founded ?person principality_antioch'], select: '?person', answers: [['bohemond_i']], rationale: 'The passage directly says Prince Bohemond I founded the Principality of Antioch.', en: ['Who founded the Principality of Antioch in the passage?', 'Identify the named founder of the Principality of Antioch.', 'Which prince is credited with founding the Principality of Antioch?'] },
  { id: 'duchy-treaty', world: 3, structure: 'polity-treaty', where: ['established_by_treaty duchy_normandy ?treaty'], select: '?treaty', answers: [['treaty_saint_clair']], rationale: 'The text explicitly describes the Duchy as established by the treaty of Saint-Clair-sur-Epte, distinct from its beginning in 911.', en: ['Which treaty established the Duchy of Normandy according to the text?', 'Name the treaty by which the Duchy of Normandy was established.', 'What agreement is credited with establishing the Duchy of Normandy?'] },
  { id: 'treaty-parties', world: 3, structure: 'two-treaty-parties', where: ['treaty_party treaty_saint_clair ?person'], select: '?person', answers: [['charles_iii'], ['rollo']], rationale: '“between King Charles III ... and ... Rollo” gives exactly two named parties to this treaty in the bounded paragraph.', en: ['Which two people are named as parties to the treaty of Saint-Clair-sur-Epte?', 'Name the individuals between whom the passage places the treaty of Saint-Clair-sur-Epte.', 'Who are the two named treaty parties in the account of the Duchy’s establishment?'], ro: 'Care sunt cele două persoane numite ca părți ale tratatului de la Saint-Clair-sur-Epte?' },
  { id: 'duchy-location', world: 3, structure: 'historical-location', where: ['situated_in duchy_normandy ?polity'], select: '?polity', answers: [['neustria']], rationale: 'The Duchy is described as situated in the former Frankish kingdom of Neustria; no present-day location is inferred.', en: ['In which former kingdom was the Duchy of Normandy situated?', 'What former Frankish kingdom contained the Duchy according to the passage?', 'Name the former kingdom in which the text situates the Duchy of Normandy.'] },
];

// These upstream questions are not SOP targets here. A QA span or impossible
// label alone cannot license a causal, reversed, anachronistic or temporal SOP.
const rejected = [
  ['56ddde6b9a695914005b9629', 'When were the Normans in Normandy?', 'Giving their name to Normandy in the 10th and 11th centuries is not a complete interval of residence.'],
  ['56ddde6b9a695914005b962c', 'What century did the Normans first gain their separate identity?', 'First-half-of-10th-century emergence is historical temporal language; this limited suite has no faithful temporal target for that event.'],
  ['5ad39d53604f3c001a3fe8d1', "Who gave their name to Normandy in the 1000's and 1100's", 'The source says 10th and 11th centuries, not 11th and 12th; do not silently repair the false premise.'],
  ['5ad39d53604f3c001a3fe8d2', 'What is France a region of?', 'Reverses Normandy-is-a-region-in-France; no country containing France is established.'],
  ['5ad39d53604f3c001a3fe8d3', 'Who did King Charles III swear fealty to?', 'Reverses the raiders→King Charles III fealty role; no negative claim about the king follows.'],
  ['5ad39d53604f3c001a3fe8d4', 'When did the Frankish identity emerge?', 'The paragraph dates Norman, not Frankish, identity.'],
  ['56dddf4066d3e219004dad5f', 'Who was the duke in the battle of Hastings?', 'William is called duke and his expedition led to the conquest at Hastings; no claim that he personally fought at the battle.'],
  ['56dddf4066d3e219004dad60', 'Who ruled the duchy of Normandy', 'Richard I is mentioned in a principality-forging clause, not as an exhaustive ruler answer.'],
  ['5ad3a266604f3c001a3fea27', 'What type of major impact did the Norman dynasty have on modern Europe?', 'Source scope is medieval Europe, not modern Europe.'],
  ['5ad3a266604f3c001a3fea28', 'Who was famed for their Christian spirit?', 'The source says Christian piety and martial spirit, not the asserted phrase.'],
  ['5ad3a266604f3c001a3fea29', 'Who assimilted the Roman language?', 'Text says Normans adopted Gallo-Romance; “Roman language” changes the object.'],
  ['5ad3a266604f3c001a3fea2a', 'Who ruled the country of Normandy?', 'Normandy is a duchy/region, not a country in the cited paragraph.'],
  ['5ad3a266604f3c001a3fea2b', 'What principality did William the conquerer found?', 'Principality of Antioch is attributed to Bohemond I, not William.'],
  ['5ad3ab70604f3c001a3feb89', 'What name comes from the English words Normans/Normanz?', 'The source calls Normans/Normanz French words, not English source words.'],
  ['5ad3ab70604f3c001a3feb8a', 'When was the French version of the word Norman first recorded?', 'Only the Medieval Latin record is dated; French recording time is unstated.'],
  ['56dde0ba66d3e219004dad75', 'When was the Duchy of Normandy founded?', 'Beginning as a fiefdom in 911 is not an exact founding instant under the available temporal profile.'],
  ['56dde0ba66d3e219004dad77', 'What river originally bounded the Duchy', 'Text distinguishes Epte in the offered lands and Seine in area/extension; no unambiguous original single river boundary.'],
].map(([original_id, question, reason]) => ({ original_id, question, reason }));

function ontology(world) {
  const entities = Object.entries(world.entities).map(([id, type]) => `@${id} entity\n  kind ${type}\n  label en ${quote(id.replaceAll('_', ' '))}\n`).join('\n');
  const predicates = Object.entries(world.predicates).map(([id, [subject, object, meaning]]) => `@${id} predicate\n  args ${subject} ${object}\n  description ${quote(meaning)}\n  alias en ${quote(id.replaceAll('_', ' '))}\n`).join('\n');
  return entities + '\n' + predicates;
}

function sourceWorlds(raw, scaffold) {
  const normans = raw.data.find(article => article.title === 'Normans');
  assert(normans, 'Missing Normans article in pinned raw source');
  return worlds.map(world => {
    const paragraph = normans.paragraphs[world.paragraph];
    assert(paragraph && scaffold.some(row => row.context_text === paragraph.context), `Missing scaffold paragraph ${world.paragraph}`);
    for (const [, text] of world.facts) assert(paragraph.context.includes(text), `Unquoted source fact: ${text}`);
    const id = `squad2-dev-normans-p${world.paragraph}`;
    const setup_sop = world.facts.map(([atom, text], index) => `@source_${index} fact\n  holds ${atom}\n  valid timeless\n  source ${id}\n  quote ${quote(text)}\n`).join('\n');
    return { ...world, paragraph: paragraph.context, id, setup_sop, ontology_sop: ontology(world) };
  });
}

/** Build 16 distinct annotated cases, three EN surfaces each and one RO anchor. */
export function buildSourceReference() {
  const rawBytes = fs.readFileSync(rawPath);
  assert.equal(digest(rawBytes), RAW_SHA256, 'Pinned raw SQuAD dev bytes changed');
  const license = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
  assert.equal(license.raw_sha256, RAW_SHA256);
  assert.equal(license.data_license, 'CC-BY-SA-4.0');
  const scaffold = fs.readFileSync(scaffoldPath, 'utf8').trim().split('\n').map(JSON.parse);
  const selected = sourceWorlds(JSON.parse(rawBytes), scaffold);
  return cases.flatMap(item => {
    const world = selected[worlds.findIndex(entry => entry.paragraph === item.world)];
    const semanticId = `${VERSION}-${item.id}`;
    const target = `@q query\n${item.select ? `  select ${item.select}\n` : ''}${item.where.map(atom => `  where ${atom}\n`).join('')}`;
    const source = {
      id: world.id, kind: 'licensed_source_reference', uri: SOURCE_URL, revision: RAW_SHA256,
      sha256: digest(world.paragraph), license: 'CC-BY-SA-4.0', content: world.paragraph,
      raw_sha256: RAW_SHA256, article_title: 'Normans', paragraph_index: item.world,
      original_question_ids: scaffold.filter(row => row.context_text === world.paragraph).map(row => row.source.original_id),
      derivative_attribution: 'ChatSOP reference annotations and paraphrases authored by an LLM coding assistant on 2026-09-27; not human-reviewed.',
    };
    const contextBase = {
      now: '2026-09-26T12:00:00Z',
      entities: Object.entries(world.entities).map(([id, type]) => ({ id, type, label: id.replaceAll('_', ' ') })),
      predicates: Object.entries(world.predicates).map(([id, [subject, object, meaning]]) => ({ id, args: [subject, object], meaning })),
      approvedTemplates: [], procedures_sop: [],
      background_assertions: [world.paragraph],
    };
    const surfaces = [...item.en.map((question, index) => ({ language: 'en', question, index })), ...(item.ro ? [{ language: 'ro', question: item.ro, index: 0 }] : [])];
    return surfaces.map(({ language, question, index }) => ({
      id: `${semanticId}-${language}-${index + 1}`, semantic_case_id: semanticId,
      split_group_id: `${VERSION}-${RAW_SHA256}`, structure_id: item.structure, surface_group_id: semanticId,
      split: 'test', profile: 'sop-agent-3', evaluation_track:'formalization', input_mode: 'query_only', language, question,
      context_assertions: [], source, setup_sop: world.setup_sop, ontology_sop: world.ontology_sop,
      sop_target: target, semantic_status: 'valid', negative_of: item.negative ? `${VERSION}-${item.negative}` : null,
      generation_trace: { method: 'LLM-authored source passage reading and independently enumerated tuple annotation', template: null, model: null, review_status: 'not-human-reviewed; model identity not verified' },
      quality_flags: { human_reviewed: false, sealed_test_only: true, independently_authored_from_synthetic_curriculum: true, independent_of_pretrained_knowledge: false, finite_bounded_source_world: true },
      context: { ...contextBase, language },
      expected: { status: item.status ?? (item.answers.length ? 'supported' : 'unknown'), answers: item.answers, oracle_rationale: item.rationale },
    }));
  });
}

export function sourceReferenceProvenance(rows) {
  const raw = fs.readFileSync(rawPath), scaffold = fs.readFileSync(scaffoldPath), sourceCode = fs.readFileSync(fileURLToPath(import.meta.url));
  assert.equal(digest(raw), RAW_SHA256);
  return {
    format: 'chatsop-source-reference-provenance-v1', version: VERSION, profile: 'sop-agent-3', split: 'test',
    sealed_test_only: true, training_permitted: false, model_selection_permitted: false,
    original: { title: 'The Stanford Question Answering Dataset, SQuAD v2.0 dev-v2.0.json', authors: ['Pranav Rajpurkar', 'Robin Jia', 'Percy Liang'], url: SOURCE_URL, raw_sha256: RAW_SHA256, license: 'CC-BY-SA-4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode' },
    derivative: { attribution: 'ChatSOP reference annotations, SOP targets, scoped ontology and paraphrases authored by an LLM coding assistant on 2026-09-27', review_status: 'not human-reviewed', model_identity_verified: false, independent_of_synthetic_curriculum_templates: true, independent_of_pretrained_model_knowledge: false, license: 'CC-BY-SA-4.0' },
    source_scaffold_sha256: digest(scaffold), builder_sha256: digest(sourceCode),
    size: { semantic_cases: cases.length, english_surfaces_per_case: 3, romanian_cases: cases.filter(item => item.ro).length, rows: rows.length, distinct_source_paragraphs: worlds.length },
    oracle: 'Author-enumerated tuples from exact paragraph quotes; not generated by the SOP solver or upstream SQuAD answer spans. UNKNOWN indicates absence of supporting or explicit negative evidence, not falsehood.',
    limitations: ['Bounded historical passages and manually selected assertions, not exhaustive document understanding.', 'LLM annotation has no human sign-off or verified model identity.', 'No independence claim about pretrained knowledge; suite is only independently authored relative to the synthetic curriculum.', 'Upstream SQuAD answerability labels are not SOP gold.'],
    rejected_scaffold_questions: rejected,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node eval/suites/source-reference.mjs --out eval/suites/source-reference-v2-cutover.jsonl');
  } else if (args.length === 2 && args[0] === '--out' && args[1].endsWith('.jsonl')) {
    const target = path.resolve(args[1]);
    const provenance = target.replace(/\.jsonl$/, '.provenance.json');
    const rows = buildSourceReference();
    assert(!fs.existsSync(target) && !fs.existsSync(provenance), 'Export already exists; do not silently replace a sealed suite');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
    fs.writeFileSync(provenance, JSON.stringify({ ...sourceReferenceProvenance(rows), suite_sha256: digest(fs.readFileSync(target)) }, null, 2) + '\n', { flag: 'wx' });
    console.log(`${target}\n${provenance}`);
  } else {
    console.error('Usage: node eval/suites/source-reference.mjs --out <suite.jsonl>');
    process.exitCode = 1;
  }
}
