import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const source = 'Mara is a parent of Sorin. Sorin is a parent of Daria. No parent relation involving Victor is stated.';
const digest = value => createHash('sha256').update(value).digest('hex');
const sourceId = 'integrator-core-family-2026-09-27';
const setup = `@first fact
  holds parent(mara, sorin)
  valid timeless
  source ${sourceId}
  quote "Mara is a parent of Sorin."

@second fact
  holds parent(sorin, daria)
  valid timeless
  source ${sourceId}
  quote "Sorin is a parent of Daria."

@grandparent_rule rule
  when parent(?a, ?b)
  when parent(?b, ?c)
  then grandparent(?a, ?c)
`;

const cases = [
  { id: 'parent', family: 'parent-direct', query: 'select ?who\n  where parent(?who, sorin)', status: 'supported', answers: [['mara']], en: 'Which person is identified as a parent of Sorin?', ro: 'Cine este indicat drept părinte al lui Sorin?' },
  { id: 'child', family: 'parent-inverse', query: 'select ?who\n  where parent(sorin, ?who)', status: 'supported', answers: [['daria']], en: 'Name the person for whom Sorin is a parent.', ro: 'Numește persoana al cărei părinte este Sorin.' },
  { id: 'grandparent', family: 'grandparent-composition', query: 'select ?who\n  where grandparent(?who, daria)', status: 'supported', answers: [['mara']], en: 'Following the two parent links, who is a grandparent of Daria?', ro: 'Urmărind cele două relații de părinte, cine este bunic sau bunică pentru Daria?' },
  { id: 'missing', family: 'unknown-parent', query: 'select ?who\n  where parent(?who, victor)', status: 'unknown', answers: [], en: 'What does this source establish about the identity of Victor’s parents?', ro: 'Ce stabilește această sursă despre identitatea părinților lui Victor?' },
  { id: 'reversal', family: 'parent-reversal', query: 'select ?who\n  where parent(?who, mara)', status: 'unknown', answers: [], negative: 'parent', en: 'Who is Mara’s parent, rather than Mara’s child?', ro: 'Cine este părintele Marei, nu copilul ei?' },
  { id: 'no-closed-world', family: 'explicit-negation', query: 'where not parent(mara, victor)', status: 'unknown', en: 'Can the source establish that Mara is not a parent of Victor?', ro: 'Putem stabili din sursă că Mara nu este părintele lui Victor?' },
];

/** Authored separately from the pilot templates; not human-validated or statistically sufficient. */
export function coreSuite() {
  return cases.flatMap(item => ['en', 'ro'].map(language => ({
    id: `independent-${item.id}-${language}`,
    semantic_case_id: `independent-${item.id}`,
    split_group_id: sourceId,
    structure_id: item.family,
    split: 'test',
    profile: 'sop-agent-3',
    source: { id: sourceId, kind: 'integrator-authored-evaluation', uri: 'eval/suites/core.mjs', revision: '1', sha256: digest(source), license: 'MIT' },
    context_assertions: [], question: item[language], language,
    surface_group_id: `independent-${item.id}`,
    sop_target: `@q query\n  ${item.query}\n\n@result solve\n  query $q\n\n@answer cnl\n  result $result\n  language en\n`,
    semantic_status: 'valid',
    negative_of: item.negative ? `independent-${item.negative}` : null,
    generation_trace: { method: 'integrator-authored', template: null, model: null, review_status: 'integrator-authored-not-human-validated' },
    quality_flags: { independent_of_pilot_generator: true, human_reviewed: false },
    setup_sop: setup,
    context: {
      now: '2026-09-26T12:00:00Z', language,
      entities: ['mara', 'sorin', 'daria', 'victor'].map(id => ({ id, label: id[0].toUpperCase() + id.slice(1), type: 'person' })),
      predicates: [
        { id: 'parent', args: ['person', 'person'], meaning: 'A parent of another person; direction matters.' },
        { id: 'grandparent', args: ['person', 'person'], meaning: 'A parent of a parent, without a gender claim.' },
      ],
      approvedTemplates: [], procedures_sop: [],
    },
    expected: { status: item.status, ...(item.answers ? { answers: item.answers } : {}), outputs: {} },
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node eval/suites/core.mjs --out <suite.jsonl>');
  } else if (args.length === 2 && args[0] === '--out') {
    const target = path.resolve(args[1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, coreSuite().map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
    console.log(target);
  } else {
    console.error('Usage: node eval/suites/core.mjs --out <suite.jsonl>');
    process.exitCode = 1;
  }
}
