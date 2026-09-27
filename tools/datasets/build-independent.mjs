import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { canonicalTarget, sha256, validateCorpus } from './schema.mjs';
import { Lexicon } from '../../sop/lexicon.mjs';
import { publishKnowledge } from '../../sop/ingest.mjs';
import { Repository } from '../../memory/repository.mjs';
import { Runtime } from '../../sop/runtime.mjs';

// These are authored incident cards, not inputs to the curriculum or pilot template engines.
// Each card records four named actors/objects, three *different* local relations and
// individually chosen evidence edges. P = affirmative, N = explicit denial,
// B = affirmative AND denial, T = dated evidence. The last pair is deliberately absent.
const cards = [
  ['archive','Mira','Folio 14','Nadia','Ledger 9','catalogued|a catalogat','sealed|a sigilat','transferred|a transferat','P0:0:1 P1:2:3 P2:0:3 N0:2:1 B1:0:3 T2:2:1','3:1'],
  ['clinic','Iulia','Sample C','Tudor','Register K','collected|a colectat','labeled|a etichetat','released|a eliberat','P0:0:1 P1:0:3 P2:2:1 N2:2:3 B0:2:3 T1:2:1','1:3'],
  ['gallery','Oana','Canvas 7','Radu','Crate 4','restored|a restaurat','insured|a asigurat','shipped|a expediat','P0:0:1 P1:2:1 P2:0:3 N1:0:3 B2:2:3 T0:2:3','3:0'],
  ['harbor','Daria','Vessel A','Lucian','Manifest 17','inspected|a inspectat','registered|a înregistrat','dispatched|a expediat','P0:0:1 P1:2:3 P2:2:1 N0:2:3 B1:0:1 T2:0:3','1:3'],
  ['library','Elena','Volume 8','Paul','Index Q','borrowed|a împrumutat','indexed|a indexat','returned|a returnat','P0:2:1 P1:0:1 P2:2:3 N2:0:1 B0:0:3 T1:2:3','1:3'],
  ['observatory','Irina','Telescope B','Sorin','Logbook 5','calibrated|a calibrat','checked|a verificat','reserved|a rezervat','P0:0:1 P1:2:3 P2:0:3 N1:0:1 B2:2:1 T0:2:3','3:1'],
  ['museum','Adina','Vase 21','Victor','Inventory M','photographed|a fotografiat','classified|a clasificat','packed|a ambalat','P0:2:1 P1:0:3 P2:0:1 N0:0:3 B1:2:1 T2:2:3','3:1'],
  ['farm','Petra','Orchard 3','Matei','Tractor 6','surveyed|a inspectat','watered|a udat','repaired|a reparat','P0:0:1 P1:2:1 P2:2:3 N2:0:3 B0:2:3 T1:0:3','1:3'],
  ['workshop','Alina','Motor R','Cezar','Manual 2','tested|a testat','documented|a documentat','installed|a instalat','P0:0:1 P1:2:3 P2:2:1 N1:0:3 B2:0:3 T0:2:3','3:1'],
  ['theater','Bianca','Script 12','Dorin','Stage B','revised|a revizuit','approved|a aprobat','prepared|a pregătit','P0:0:1 P1:2:1 P2:0:3 N0:2:3 B1:0:3 T2:2:3','1:3'],
  ['bakery','Carmen','Recipe 4','Florin','Oven 7','wrote|a scris','verified|a verificat','cleaned|a curățat','P0:0:1 P1:2:1 P2:2:3 N1:0:3 B0:2:3 T2:0:3','1:3'],
  ['railway','Delia','Schedule 24','Horia','Platform 3','updated|a actualizat','published|a publicat','closed|a închis','P0:0:1 P1:2:1 P2:2:3 N2:0:3 B1:0:3 T0:2:3','3:1'],
  ['newspaper','Emilia','Article 15','Marcel','Edition C','drafted|a redactat','edited|a editat','printed|a tipărit','P0:0:1 P1:2:1 P2:2:3 N0:2:3 B1:0:3 T2:0:3','3:1'],
  ['aquarium','Felicia','Tank 5','Nicolae','Filter 8','inspected|a inspectat','drained|a golit','replaced|a înlocuit','P0:0:1 P1:2:1 P2:0:3 N2:2:1 B0:2:3 T1:0:3','1:3'],
  ['festival','Gina','Ticket J','Octav','Program 6','issued|a emis','validated|a validat','translated|a tradus','P0:0:1 P1:2:1 P2:0:3 N0:2:3 B2:2:1 T1:0:3','3:1'],
  ['court','Hana','Transcript 10','Petru','Docket 2','transcribed|a transcris','signed|a semnat','filed|a depus','P0:0:1 P1:2:1 P2:2:3 N2:0:3 B1:0:3 T0:2:3','1:3'],
  ['weather','Ioana','Forecast B','Robert','Bulletin 11','compiled|a compilat','corrected|a corectat','broadcast|a difuzat','P0:0:1 P1:2:1 P2:2:3 N1:0:3 B0:2:3 T2:0:3','3:1'],
  ['school','Lavinia','Exam 3','Sabin','Report 4','graded|a notat','archived|a arhivat','submitted|a depus','P0:0:1 P1:2:3 P2:0:3 N0:2:3 B2:2:1 T1:0:1','1:3'],
  ['cinema','Monica','Film X','Teodor','Projector 9','reviewed|a evaluat','screened|a proiectat','repaired|a reparat','P0:0:1 P1:2:1 P2:2:3 N1:0:3 B0:2:3 T2:0:3','3:1'],
  ['botanical','Nora','Seedling 18','Vlad','Greenhouse D','planted|a plantat','measured|a măsurat','ventilated|a aerisit','P0:0:1 P1:2:1 P2:0:3 N2:2:3 B1:0:3 T0:2:3','3:1'],
];
const now = '2026-09-27T12:00:00Z';
const old = '2025-04-15';
const active = '2025-04-01 2025-05-01';
const assert = (condition, message) => { if (!condition) throw Error(message); };
const atom = (card, entry) => `${entry.neg ? 'not ' : ''}${card.id}_${entry.p} ${card.ids[entry.a]} ${card.ids[entry.b]}`;
const label = (card, i) => card.names[i];
const relation = (card, p, language) => card.relations[p][language === 'en' ? 0 : 1];
function prepare(raw) {
  const [id, ...columns] = raw;
  const names = columns.slice(0, 4), ids = names.map((_, i) => `${id}_e${i}`);
  const relations = columns.slice(4, 7).map(value => value.split('|'));
  const entries = columns[7].split(' ').map(value => {
    const [kind, a, b] = value.split(':');
    return { kind: kind[0], p: Number(kind[1]), a: Number(a), b: Number(b), neg: kind[0] === 'N' };
  });
  const [missingA, missingB] = columns[8].split(':').map(Number);
  assert(entries.length === 6 && entries.map(e => e.kind).join('') === 'PPPNBT', `${id}: malformed evidence card`);
  const card = { id, names, ids, relations, entries, missingA, missingB };
  const facts = entries.flatMap(entry => {
    const positive = { ...entry, neg: false };
    return entry.kind === 'B' ? [positive, { ...entry, neg: true }] : [entry];
  }).map(entry => ({ ...entry, valid: entry.kind === 'T' ? active : 'timeless', text: entry.neg ? `The record explicitly denies that ${label(card, entry.a)} ${relation(card, entry.p, 'en')} ${label(card, entry.b)}.` : `${label(card, entry.a)} ${relation(card, entry.p, 'en')} ${label(card, entry.b)}.` }));
  card.content = `Integrator-authored ${id} evidence card; known since 2024-01-01.\n${facts.map(f => f.text).join('\n')}\n`;
  card.source = { id: `independent_${id}`, kind: 'integrator_authored_scenario', uri: `integrator://independent-v1/${id}`, revision: sha256(JSON.stringify(cards)), sha256: sha256(card.content), license: null, content: card.content };
  card.setup = canonicalTarget(facts.map((fact, i) => `@evidence${i} fact\n  holds ${atom(card, fact)}\n  valid ${fact.valid}\n  source ${card.source.id}\n  quote ${JSON.stringify(fact.text)}`).join('\n'));
  card.ontology = [
    ...ids.map((entity, i) => `@${entity} entity\n  kind entity\n  label en ${JSON.stringify(names[i])}\n  label ro ${JSON.stringify(names[i])}`),
    ...relations.map(([en, ro], i) => `@${id}_${i} predicate\n  args entity entity\n  description ${JSON.stringify(`${en} / ${ro}`)}\n  label en ${JSON.stringify(en)}\n  label ro ${JSON.stringify(ro)}`),
  ].join('\n\n') + '\n';
  return card;
}
function cases(card) {
  const [positive, second, third, denied, conflict, dated] = card.entries;
  const missing = { p: 0, a: card.missingA, b: card.missingB };
  const caseOf = (family, where, surfaces, options = {}) => ({ family, where, surfaces, ...options });
  return [
    caseOf('affirmed', [atom(card, positive)], { en: `Is it documented that ${label(card, positive.a)} ${relation(card, positive.p, 'en')} ${label(card, positive.b)}?`, ro: `Este documentat că ${label(card, positive.a)} ${relation(card, positive.p, 'ro')} ${label(card, positive.b)}?` }),
    caseOf('explicit_denial', [atom(card, { ...denied, neg: false })], { en: `Do the records establish that ${label(card, denied.a)} ${relation(card, denied.p, 'en')} ${label(card, denied.b)}?`, ro: `Arată evidențele că ${label(card, denied.a)} ${relation(card, denied.p, 'ro')} ${label(card, denied.b)}?` }, { negativeOf: 0 }),
    caseOf('conflicting_reports', [atom(card, conflict)], { en: `Despite the conflicting reports, is it true that ${label(card, conflict.a)} ${relation(card, conflict.p, 'en')} ${label(card, conflict.b)}?`, ro: `În ciuda rapoartelor contradictorii, este adevărat că ${label(card, conflict.a)} ${relation(card, conflict.p, 'ro')} ${label(card, conflict.b)}?` }),
    caseOf('unreported_pair', [atom(card, missing)], { en: `Is there any evidence that ${label(card, missing.a)} ${relation(card, missing.p, 'en')} ${label(card, missing.b)}?`, ro: `Există dovezi că ${label(card, missing.a)} ${relation(card, missing.p, 'ro')} ${label(card, missing.b)}?` }),
    caseOf('identify_actor', [`${card.id}_${second.p} ?who ${card.ids[second.b]}`], { en: `Who ${relation(card, second.p, 'en')} ${label(card, second.b)}?`, ro: `Cine ${relation(card, second.p, 'ro')} ${label(card, second.b)}?` }, { select: '?who' }),
    caseOf('dated_during', [atom(card, dated)], { en: `On ${old}, was it recorded that ${label(card, dated.a)} ${relation(card, dated.p, 'en')} ${label(card, dated.b)}?`, ro: `La ${old}, era consemnat că ${label(card, dated.a)} ${relation(card, dated.p, 'ro')} ${label(card, dated.b)}?` }, { at: old }),
    caseOf('dated_after', [atom(card, dated)], { en: `On 2026-09-27, was it still true that ${label(card, dated.a)} ${relation(card, dated.p, 'en')} ${label(card, dated.b)}?`, ro: `La 2026-09-27, mai era valabil că ${label(card, dated.a)} ${relation(card, dated.p, 'ro')} ${label(card, dated.b)}?` }, { at: '2026-09-27' }),
    caseOf('two_observations', [atom(card, positive), atom(card, third)], { en: `Were both reports true: ${label(card, positive.a)} ${relation(card, positive.p, 'en')} ${label(card, positive.b)}, and ${label(card, third.a)} ${relation(card, third.p, 'en')} ${label(card, third.b)}?`, ro: `Sunt confirmate ambele: ${label(card, positive.a)} ${relation(card, positive.p, 'ro')} ${label(card, positive.b)} și ${label(card, third.a)} ${relation(card, third.p, 'ro')} ${label(card, third.b)}?` }),
    caseOf('explicit_negative_claim', [atom(card, { ...denied, neg: true })], { en: `Is there an explicit denial that ${label(card, denied.a)} ${relation(card, denied.p, 'en')} ${label(card, denied.b)}?`, ro: `Este negată explicit afirmația că ${label(card, denied.a)} ${relation(card, denied.p, 'ro')} ${label(card, denied.b)}?` }, { negativeOf: 1 }),
    caseOf('missing_referent', null, { en: `When asking whether ${label(card, second.a)} ${relation(card, second.p, 'en')} \"that item\", do you mean ${label(card, 1)} or ${label(card, 3)}?`, ro: `Când întrebi dacă ${label(card, second.a)} ${relation(card, second.p, 'ro')} „acel obiect”, te referi la ${label(card, 1)} sau la ${label(card, 3)}?` }, { clarification: `Which item is meant: ${label(card, 1)} or ${label(card, 3)}?` }),
  ];
}
function target(item) {
  if (!item.where) return canonicalTarget(`@ask clarify\n  text ${JSON.stringify(item.clarification)}`);
  return canonicalTarget(`@q query\n${item.select ? `  mode select\n  select ${item.select}\n` : ''}${item.where.map(where => `  where ${where}\n`).join('')}${item.at ? `  at ${item.at}\n` : ''}`);
}
function row(card, item, index, language) {
  const caseId = `${card.id}_${String(index).padStart(2, '0')}`;
  return {
    id: `${caseId}_${language}`, semantic_case_id: caseId, split_group_id: `independent_${card.id}`, structure_id: item.family,
    split: 'test', surface_group_id: `${caseId}_surface`, question: item.surfaces[language], language,
    sop_target: target(item), setup_sop: card.setup, evaluation_track: item.where ? 'formalization' : 'system',
    semantic_status: item.where ? item.family === 'conflicting_reports' ? 'contradictory' : item.family === 'unreported_pair' ? 'underspecified' : 'valid' : 'ambiguous',
    negative_of: item.negativeOf === undefined ? null : `${card.id}_${String(item.negativeOf).padStart(2, '0')}`,
    context_assertions: [], source: card.source, input_mode: item.where ? 'query_only' : 'clarification',
    generation_trace: { method: 'LLM-coding-assistant-authored-evidence-and-bilingual-surfaces', template: null, model: 'openai-codex/gpt-6-sol', review_status: 'not_reviewed' },
    quality_flags: { human_reviewed: false, training_approved: false, authored_by: 'LLM coding assistant', expected_from: 'gold_runtime_execution' },
    ontology_sop: card.ontology,
    context: { now, language, entities: card.ids.map((id, i) => ({ id, type: 'entity', label: card.names[i] })), predicates: card.relations.map(([en], i) => ({ id: `${card.id}_${i}`, args: ['entity', 'entity'], meaning: en })), approvedTemplates: [], procedures_sop: [] },
    expected: null,
  };
}
async function observed(card, item, repo, lexicon) {
  const session = repo.session('world', `case_${card.id}_${item.family}`, 'evaluation');
  const execution = await new Runtime({ repo, session, lexicon, schema: lexicon.predicates, now: Date.parse(now), policy: { allowWrite: false } }).run(target(item), item.where ? { origin: 'model', inputText: item.surfaces.en, language: 'en', context: { premises: [], entities: card.ids.map((id, i) => ({ id, label: card.names[i], type: 'entity' })) } } : { origin: 'trusted' });
  const packet = execution.result?.packet ?? execution.result;
  assert(packet?.status, `${card.id}/${item.family}: runtime returned no status: ${JSON.stringify(execution.result)}`);
  const expected = { status: packet.status };
  if (item.where) expected.answers = (packet.answers ?? []).map(answer => (packet.query?.select ?? Object.keys(answer.binding)).map(name => answer.binding[name])).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return expected;
}
export async function buildIndependent() {
  const rows = [], directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-independent-authoring-'));
  try {
    for (const raw of cards) {
      const card = prepare(raw), items = cases(card), lexicon = new Lexicon(card.ontology);
      const repo = new Repository(path.join(directory, card.id), { memory: { engine: 'sqlite', power: 10 } });
      publishKnowledge(repo, 'world', card.setup, { schema: lexicon.predicates, reviewed: true, knownAt: Date.parse('2024-01-01') });
      for (const [index, item] of items.entries()) {
        const expected = await observed(card, item, repo, lexicon);
        for (const language of ['en', 'ro']) rows.push({ ...row(card, item, index, language), expected });
      }
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  validateCorpus(rows);
  return rows;
}
export async function writeIndependent({ out = 'datasets/independent-v1', evalOut = 'eval/suites/independent-v1' } = {}) {
  assert(path.resolve(out) !== path.resolve(evalOut), 'Corpus and evaluation directories must differ');
  const rows = await buildIndependent(), data = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(evalOut, { recursive: true });
  fs.writeFileSync(path.join(evalOut, 'test.jsonl'), data);
  const version = { counter: 1, label: 'independent-v1', review_status: 'not_reviewed' };
  const provenance = { format: 'chatsop-independent-v1', version, author: 'LLM coding assistant', human_reviewed: false, training_approved: false, generator: 'tools/datasets/build-independent.mjs', test_sha256: sha256(data), summary: validateCorpus(rows) };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(provenance, null, 2) + '\n');
  fs.writeFileSync(path.join(evalOut, 'manifest.json'), JSON.stringify({ ...provenance, dataset_manifest: '../../../datasets/independent-v1/manifest.json' }, null, 2) + '\n');
  return provenance.summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await writeIndependent())); } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
