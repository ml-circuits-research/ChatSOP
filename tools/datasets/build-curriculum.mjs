import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse, canonical, parseAtom } from '../../sop/parser.mjs';
import { Lexicon } from '../../sop/lexicon.mjs';
import { canonicalTarget } from './schema.mjs';
import { measureCoverage } from './coverage.mjs';
import { barePrompt as formalPrompt } from '../../server/llm.mjs';
import { buildCasesMd } from './build-cases-md.mjs';
import { REVISION, NOW, worlds, cases, attached, numeric, extra, blockedFamilies, assumptions, approvedTemplates } from './curriculum/cases.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const baseOntology = fs.readFileSync(new URL('../../config/ontology.sop', import.meta.url), 'utf8');
const ontology = new Lexicon(baseOntology);
const routeOntologyText = baseOntology.trimEnd() + '\n\n@route_demo entity\n  kind entity\n  label en "Alpha Lab route"\n  label ro "Ruta Laboratorului Alfa"\n';
const routeOntology = new Lexicon(routeOntologyText);
const worldById = new Map(worlds.map(world => [world.id, world]));
const version = Object.freeze({ counter: 1, label: 'query-curriculum-v1', review_status: 'synthetic_unreviewed_not_training_approved' });
const templateHash = sha256(fs.readFileSync(new URL('./curriculum/cases.mjs', import.meta.url)));
const knownAt = '2024-01-01';
const approvedTemplate = canonical({ wires: parse(approvedTemplates.check_arrival).wires.filter(wire => wire.id === 'check_arrival') });
if (parse(approvedTemplate).wires.length !== 1) throw Error('Missing exact approved check_arrival procedure');

function source(world) {
  const content = `Synthetic scenario ${world.id}; host knowledge available from ${knownAt}.\n` + world.facts.map(item => item.text).join('\n') + '\n';
  return { id: world.id, kind: 'synthetic_curriculum', uri: `synthetic://query-v1/${world.id}`, revision: templateHash, sha256: sha256(content), license: null, content };
}
function setup(world) {
  if (!world.facts.length && !world.rules.length && !world.procedures?.length) return '';
  return canonicalTarget([
    ...world.facts.map((fact, i) => `@record${i} fact\n  holds ${fact.atom}\n  valid ${fact.valid}\n  source ${world.id}\n  quote ${JSON.stringify(fact.text)}`),
    ...world.rules.map(rule => `@${rule.id} rule\n${rule.when.map(atom => `  when ${atom}`).join('\n')}\n  then ${rule.then}\n  source ${world.id}`),
    ...(world.procedures ?? []).map(name => { if (name !== 'check_arrival') throw Error(`Unapproved procedure ${name}`); return approvedTemplate; }),
  ].join('\n'));
}
const worldsPrepared = new Map(worlds.map(world => [world.id, { source: source(world), setup_sop: setup(world) }]));
function constraintsOracle(item) {
  // Exhaustive finite integer arithmetic independent of SOP parser, solver and evaluator.
  const evaluate = (expression, x) => {
    const match = expression.match(/^\?x (==|>=|<=|>|<) (\d+)(?: \+ (\d+))?$/);
    if (!match) throw Error(`Unsupported handwritten numeric oracle expression: ${expression}`);
    const n = Number(match[2]) + Number(match[3] ?? 0);
    return { '==': x === n, '>=': x >= n, '<=': x <= n, '>': x > n, '<': x < n }[match[1]];
  };
  const feasible = Array.from({ length: item.max - item.min + 1 }, (_, i) => i + item.min).filter(x => item.require.every(rule => evaluate(rule, x)));
  const satisfying = feasible.filter(x => evaluate(item.claim, x));
  const status = !feasible.length ? 'inconsistent' : item.task === 'possible' ? (satisfying.length ? 'possible' : 'impossible') : !satisfying.length ? 'refuted' : satisfying.length === feasible.length ? 'entailed' : 'unknown';
  if (status !== item.oracle) throw Error(`${item.id}: independent finite oracle disagrees with declared semantic decision`);
  if (item.outputValue !== undefined && (feasible.length !== 1 || feasible[0] !== item.outputValue)) throw Error(`${item.id}: claimed unique value is not forced by premises`);
  return { status, ...(item.outputValue !== undefined ? { outputs: { x: item.outputValue } } : {}), ...(item.output && item.outputValue === undefined ? { packet: { outputProjection: { '?x': { status:'ambiguous', candidates:feasible.length } } } } : {}) };
}
function graphOracle(world, item, local = []) {
  const positive = [], negative = [];
  const facts = [...world.facts, ...local];
  for (const fact of facts) {
    const atom = parseAtom(fact.atom);
    (atom.neg ? negative : positive).push({ ...atom, valid: fact.valid });
  }
  for (const rule of world.rules) {
    if (rule.then !== 'grandparent(?x, ?z)') throw Error(`Unreviewed oracle rule ${rule.id}`);
    const parents = positive.filter(atom => atom.p === 'parent');
    for (const first of parents) for (const second of parents) if (first.a[1] === second.a[0]) {
      positive.push({ p: 'grandparent', a: [first.a[0], second.a[1]], neg: false, valid: 'timeless' });
    }
  }
  const time = item.time ?? {};
  const date = value => Date.parse(`${value}T00:00:00Z`);
  const active = atom => {
    if (time.asof && date(time.asof) < date(knownAt)) return false;
    if (atom.valid === 'timeless') return true;
    const [start, end] = atom.valid.split(' ');
    const from = date(start), until = end === 'open' ? Infinity : date(end);
    if (time.at) return from <= date(time.at) && date(time.at) < until;
    if (time.during) { const [left, right] = time.during.split(' ').map(date); return from < right && left < until; }
    return from <= Date.parse(NOW) && Date.parse(NOW) < until;
  };
  const matches = (pattern, fact, env) => {
    if (pattern.p !== fact.p || !!pattern.neg !== !!fact.neg || !active(fact)) return null;
    const next = { ...env };
    for (let i = 0; i < pattern.a.length; i++) {
      const value = pattern.a[i], actual = fact.a[i];
      if (value.startsWith('?')) { if (Object.hasOwn(next, value) && next[value] !== actual) return null; next[value] = actual; }
      else if (value !== actual) return null;
    }
    return next;
  };
  const patterns = item.where.map(parseAtom);
  const joined = patterns.reduce((rows, pattern) => rows.flatMap(env => (pattern.neg ? negative : positive).flatMap(fact => { const next = matches(pattern, fact, env); return next ? [next] : []; })), [{}]);
  const tuples = [...new Map(joined.map(env => { const tuple = (item.select ?? []).map(name => env[name]); return [JSON.stringify(tuple), tuple]; })).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  let status = joined.length ? 'supported' : 'unknown';
  if (patterns.length === 1 && !patterns[0].a.some(term => term.startsWith('?'))) {
    const opposing = { ...patterns[0], neg: !patterns[0].neg };
    if ((patterns[0].neg ? positive : negative).some(atom => matches(opposing, atom, {}))) status = joined.length ? 'both' : 'refuted';
  }
  return { status, answers: item.select?.length ? tuples : joined.length ? [[]] : [], ...(item.mode === 'count' ? { packet:{ count:tuples.length } } : {}) };
}
function routeOracle(world, item) {
  const routes = world.facts.map(record => parseAtom(record.atom)).filter(atom => atom.p === 'duration' && atom.a[0] === 'route_demo');
  if (routes.length !== 1 || !Number.isSafeInteger(routes[0].a[1])) throw Error(`${item.id}: route duration is not uniquely sourced`);
  const minutes = routes[0].a[1], arrival = 770 + minutes;
  return { status: arrival <= 840 ? 'possible' : 'refuted', outputs: item.id === 'route_expression' ? { minutes, arrival, time: arrival } : { expanded__duration: minutes, expanded__arrival: arrival } };
}
function targetRouteExpression() {
  return canonicalTarget('@travel query\n  mode select\n  select ?minutes\n  where duration(route_demo, ?minutes)\n@known solve\n  query $travel\n  output ?minutes one\n@departure value\n  data 770\n@arrival jsEval\n  expr $departure + $minutes\n@limit constraint\n  var ?time int 0 1440\n  require ?time == $arrival\n  claim ?time <= 840\n  task possible\n@r solve\n  constraint $limit\n  output ?time one\n@answer cnl\n  result $r\n  language en');
}
function targetRouteProcedure() {
  return canonicalTarget('@route value\n  data "route_demo"\n@start value\n  data 770\n@deadline value\n  data 840\n@expanded expand\n  using ~check_arrival\n  with route $route\n  with start $start\n  with deadline $deadline\n@packet jsEval\n  expr $expanded.packet\n@answer cnl\n  result $packet\n  language en');
}
function targetQuery(item, { claims = [], resolve = null } = {}) {
  const blocks = claims.flatMap((claim, i) => [`@userFact${i} fact\n  holds ${claim.atom}\n  valid ${claim.valid}\n  source user\n  quote ${JSON.stringify(claim.text)}`, `@store${i} assert\n  input $userFact${i}\n  scope session`]);
  if (resolve) blocks.push(`@alias resolve\n  text ${JSON.stringify(resolve.text)}\n  language ${resolve.language}\n  kind entity\n  type organization`);
  if (!item.where) return canonicalTarget(blocks.join('\n'));
  const where = resolve ? item.where.map(atom => atom.replace(resolve.id, '$alias')) : item.where;
  blocks.push(`@q query\n${item.mode ? `  mode ${item.mode}\n` : ''}${item.select ? `  select ${item.select.join(' ')}\n` : ''}${where.map(atom => `  where ${atom}\n`).join('')}${item.time?.at ? `  at ${item.time.at}\n` : ''}${item.time?.during ? `  during ${item.time.during}\n` : ''}${item.time?.asof ? `  asof ${item.time.asof}\n` : ''}`.trimEnd());
  blocks.push(`@r solve\n  query $q${claims.map((_, i) => `\n  after $store${i}`).join('')}`);
  blocks.push('@answer cnl\n  result $r\n  language en');
  return canonicalTarget(blocks.join('\n'));
}
function targetConstraint(item) {
  const block = `@c constraint\n  var ?x int ${item.min} ${item.max}\n${item.require.map(rule => `  require ${rule}\n`).join('')}  claim ${item.claim}\n  task ${item.task}`;
  return canonicalTarget(`${block}\n@r solve\n  constraint $c${item.output ? `\n  output ${item.output}` : ''}\n@answer cnl\n  result $r\n  language en`);
}
function targetClarify(item) { return canonicalTarget(`@ask clarify\n  text ${JSON.stringify(item.clarification)}`); }
function rowContext(language, input, world) {
  const atoms = [...(world?.facts ?? []), ...(input.claims ?? [])].map(x => x.atom).concat(input.where ?? []);
  const predicates = new Set(atoms.map(atom => parseAtom(atom).p));
  for (const rule of world?.rules ?? []) { predicates.add(parseAtom(rule.then).p); rule.when.forEach(atom => predicates.add(parseAtom(atom).p)); }
  const lexicon = world?.id === 'route_dev' ? routeOntology : ontology;
  const used = new Set(atoms.flatMap(atom => parseAtom(atom).a).filter(x => lexicon.entities[x]));
  const entities = [...used].sort().map(id => ({ id, type: lexicon.entities[id].entityType, label: lexicon.entities[id].labels[language] ?? lexicon.entities[id].labels.en ?? id }));
  return { now: NOW, language, entities, predicates: [...predicates].sort().map(id => ({ id, args: lexicon.predicates[id].args, meaning: lexicon.predicates[id].description })), approvedTemplates: world?.procedures ?? [], procedures_sop: world?.procedures?.map(() => approvedTemplate) ?? [], canonicalMentions: input.resolve ? [{ surface:input.resolve.text, language:input.resolve.language, kind:'entity', id:input.resolve.id }] : [], background_assertions: world?.facts.map(fact => fact.text) ?? [], background_rules: world?.rules.map(rule => `${rule.when.join(' AND ')} -> ${rule.then}`) ?? [], background_known_at: world?.facts.length ? knownAt : null };
}
function render(item, { world = null, group, input_mode, target, expected, sourceInfo, oracleKind }) {
  if (!item.en || item.en.length < 3 || item.en.length !== new Set(item.en).size) throw Error(`${item.id}: expected several distinct natural questions`);
  const surfaces = [...item.en.map((text, index) => ({ text, language: 'en', name: `en${index + 1}` })), ...(item.ro ? [{ text: item.ro, language: 'ro', name: 'ro' }] : [])];
  return surfaces.map(({ text, language, name }) => ({
    id: `${item.id}_${name}`, semantic_case_id: item.id, split_group_id: group,
    structure_id: item.operators.join('__'), split: item.split ?? world?.split,
    input_mode, source: sourceInfo, context_assertions: item.claims?.map(claim => claim.text) ?? [],
    question: text, language, surface_group_id: `${item.id}_surface`, sop_target: target,
    semantic_status: item.clarification ? (item.family === 'unsupported_boundary' ? 'unsupported' : 'ambiguous') : expected.status === 'both' ? 'contradictory' : 'valid',
    negative_of: item.negativeOf ?? null,
    generation_trace: { method: 'harness-llm-authored-synthetic-scenario', template: `${REVISION}/${item.id}/${name}`, model: 'unverified-harness-backend', review_status: 'synthetic_unreviewed' },
    quality_flags: { synthetic: true, independent_oracle: oracleKind, human_reviewed: false, training_approved: false },
    setup_sop: world ? worldsPrepared.get(world.id).setup_sop : '',
    ...(world?.id === 'route_dev' ? { ontology_sop: routeOntologyText } : {}),
    context: rowContext(language, item, world), expected,
    matrix: { family_id: item.family, operators: item.operators, domain: world?.domain ?? (item.family === 'finite_constraints' || item.family === 'finite_outputs' ? 'finite integer arithmetic' : 'conversation'), holdout: item.holdout ?? null, reserved_lexemes:item.reservedLexemes ?? [], contrast: item.negativeOf ?? null, provenance_class: 'synthetic_unreviewed' },
  }));
}
function assumptionOracle(item) {
  // Defeasible reading: the assumption supports the claim only while no admitted fact denies it.
  return { status: item.defeated ? 'unknown' : 'supported', answers: item.defeated ? [] : [[]], packet: { hypothetical: !item.defeated } };
}
function targetAssumption(item) {
  return canonicalTarget(`@q query\n  mode exists\n  where ${item.where}\n@guess fact\n  holds ${item.guess}\n  valid timeless\n  source assumption\n@r solve\n  query $q\n  assume $guess\n@answer cnl\n  result $r\n  language en`);
}
function buildCases() {
  const rows = [];
  for (const item of assumptions) {
    const world = worldById.get(item.world);
    if (!world) throw Error(`Unknown world ${item.world}`);
    rows.push(...render(item, { world, group: world.id, input_mode: 'query_only', sourceInfo: worldsPrepared.get(world.id).source, expected: assumptionOracle(item), target: targetAssumption(item), oracleKind: 'handwritten_defeasible_assumption' }));
  }
  for (const item of cases) {
    const world = worldById.get(item.world);
    if (!world) throw Error(`Unknown world ${item.world}`);
    const expected = item.id.startsWith('route_') ? routeOracle(world, item) : graphOracle(world, item);
    const target = item.id === 'route_expression' ? targetRouteExpression() : item.id === 'route_approved_procedure' ? targetRouteProcedure() : targetQuery(item, { resolve:item.resolve });
    rows.push(...render(item, { world, group: world.id, input_mode: 'query_only', sourceInfo: worldsPrepared.get(world.id).source, expected, target, oracleKind:item.id.startsWith('route_') ? 'handwritten_route_arithmetic' : 'handwritten_graph_temporal' }));
  }
  for (const item of attached) {
    const world = { id: `attached_${item.split}`, split:item.split, domain:'conversation', facts:[], rules:[] };
    const content = `Synthetic user-assertion scenario ${item.id}.\n` + item.claims.map(claim => claim.text).join('\n') + '\n';
    const sourceInfo = { id: item.id, kind:'synthetic_curriculum', uri:`synthetic://query-v1/${item.id}`, revision:templateHash, sha256:sha256(content), license:null, content };
    const expected = item.where ? graphOracle(world, item, item.claims) : { status:'stored', packet:{ count:item.claims.length } };
    expected.session_claims = item.claims.map(claim => ({ holds:claim.atom, valid:claim.valid, source:'user', quote:claim.text, retention:'normal' }));
    rows.push(...render(item, { world:null, group:`attached_${item.split}`, input_mode:'assertions_query', sourceInfo, expected, target:targetQuery(item,{ claims:item.claims }), oracleKind:'handwritten_graph_temporal' }));
  }
  for (const item of numeric) {
    const content = `Synthetic finite-integer problem ${item.id}; bounds ${item.min}..${item.max}; ${item.require.join(', ')}; question ${item.claim}.\n`;
    const sourceInfo = { id:item.id, kind:'synthetic_curriculum', uri:`synthetic://query-v1/${item.id}`, revision:templateHash, sha256:sha256(content), license:null, content };
    rows.push(...render(item, { group:`numeric_${item.split}`, input_mode:'query_only', sourceInfo, target:targetConstraint(item), expected:constraintsOracle(item), oracleKind:'finite_enumeration' }));
  }
  for (const item of extra) {
    const content = `Synthetic clarification/unsupported-boundary scenario ${item.id}.\n`;
    const sourceInfo = { id:item.id, kind:'synthetic_curriculum', uri:`synthetic://query-v1/${item.id}`, revision:templateHash, sha256:sha256(content), license:null, content };
    rows.push(...render(item, { group:`extra_${item.split}`, input_mode:'clarification', sourceInfo, target:targetClarify(item), expected:{ status:'clarify' }, oracleKind:'explicit_missing_information' }));
  }
  return rows;
}

export function buildCurriculum() {
  const rows = buildCases();
  const byId = new Map(rows.map(row => [row.semantic_case_id, row]));
  for (const row of rows) if (row.negative_of) {
    const other = byId.get(row.negative_of);
    if (!other || other.split_group_id !== row.split_group_id || other.split !== row.split || other.sop_target === row.sop_target) throw Error(`${row.id}: contrast crossed group or lost semantic difference`);
  }
  const groups = new Map();
  for (const row of rows) {
    const existing = groups.get(row.split_group_id);
    if (existing && existing !== row.split) throw Error(`Cross-split group: ${row.split_group_id}`);
    if (row.matrix.holdout && row.split === 'train') throw Error(`${row.id}: reserved holdout leaked into train`);
    groups.set(row.split_group_id, row.split);
  }
  if (!['train','dev','test'].every(split => rows.some(row => row.split === split))) throw Error('All three splits are required');
  for (const holdout of measureCoverage(rows).holdouts) if (holdout.checked && !holdout.pass) throw Error(`${holdout.case_id}: declared ${holdout.kind} holdout is exposed in training`);
  return rows;
}
export function curriculumMatrix(rows = buildCurriculum()) {
  const caseRows = new Map();
  for (const row of rows) {
    const record = caseRows.get(row.semantic_case_id);
    if (record) record.count++;
    else caseRows.set(row.semantic_case_id,{ row, count:1 });
  }
  const cases = [...caseRows.values()];
  const tally = collection => collection.reduce((counts, name) => { counts[name] = (counts[name] ?? 0) + 1; return counts; }, {});
  const byFamily = {};
  for (const {row,count} of cases) {
    const family = row.matrix.family_id;
    byFamily[family] ??= { semantic_cases:0, rows:0, splits:{ train:0, dev:0, test:0 }, operators:[], domains:[], contrasts:0, reviewed_cases:0 };
    const record = byFamily[family];
    record.semantic_cases++;
    record.rows += count;
    record.splits[row.split]++;
    record.operators = [...new Set([...record.operators,...row.matrix.operators])].sort();
    record.domains = [...new Set([...record.domains,row.matrix.domain])].sort();
    if (row.negative_of) record.contrasts++;
  }
  return { status:'expected_from_generator_not_observed_qualified_coverage', source_backed_cases:0,
    source_backed_reason:'QA2D/ProofWriter rights and mapping unresolved; source scaffolds are not SOP gold; synthetic corpus only.',
    synthetic_cases:cases.length, synthetic_rows:rows.length, human_reviewed_cases:0, training_approved:false,
    claimed_families:Object.keys(byFamily).sort(), expected_from_code:{ semantic_cases:cases.length, rows:rows.length },
    observed_validation:null, observed_human_review:null,
    by_split:tally(cases.map(({row}) => row.split)), by_language:tally(rows.map(row => row.language)),
    by_input_mode:tally(cases.map(({row}) => row.input_mode)), by_holdout:tally(cases.map(({row}) => row.matrix.holdout ?? 'none')),
    by_family:byFamily, blocked_families:blockedFamilies,
    measured_structure:measureCoverage(rows),
    known_limitations:['Synthetic scenarios and paraphrases need independent principal review.',
      'During queries ask for evidence intersecting a window, not universal validity throughout that window.',
      'A selected tuple from a multi-atom join may rely on a contested premise; overall supported status does not certify uncontested tuples.',
      'Host-approved procedure reuse is the pinned demonstration template, not a newly certified external procedure.'] };
}
function physicalPath(input) {
  let cursor = path.resolve(input), suffix = [];
  while (!fs.existsSync(cursor)) { suffix.unshift(path.basename(cursor)); cursor = path.dirname(cursor); }
  return path.resolve(fs.realpathSync(cursor), ...suffix);
}
function safeOutput(out, evalOut) {
  if (!out || !evalOut) throw Error('Disjoint --out and --eval-out directories required');
  const a = physicalPath(out), b = physicalPath(evalOut);
  if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) throw Error('Evaluation suite must be disjoint from training export');
  return [a,b];
}
export function writeCurriculum({ out = fileURLToPath(new URL('../../datasets/query-v1/', import.meta.url)), evalOut = fileURLToPath(new URL('../../../eval/suites/query-v1/', import.meta.url)) } = {}) {
  const [development, sealed] = safeOutput(out, evalOut);
  const rows = buildCurriculum(), matrix = curriculumMatrix(rows);
  const writeRows = (dir, filename, data, files) => { fs.mkdirSync(path.dirname(path.join(dir, filename)), { recursive:true }); const text = data.map(row => JSON.stringify(row)).join('\n') + '\n'; fs.writeFileSync(path.join(dir,filename),text); files[filename] = sha256(text); };
  const devFiles = {}, evalFiles = {};
  for (const split of ['train','dev']) writeRows(development, `${split}.jsonl`, rows.filter(row => row.split === split), devFiles);
  writeRows(sealed, 'test.jsonl', rows.filter(row => row.split === 'test'), evalFiles);
  for (const split of ['train','dev']) writeRows(development, `formalizer/${split}.jsonl`, rows.filter(row => row.split === split).map(row => ({ id:row.id, input_mode:row.input_mode, prompt:formalPrompt([...row.context_assertions, row.question].join('\n'), row.context), target:row.sop_target, context:row.context, group:row.split_group_id })), devFiles);
  const versionText = JSON.stringify(version) + '\n';
  for (const [dir,files] of [[development,devFiles],[sealed,evalFiles]]) { fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'VERSION'),versionText); files.VERSION = sha256(versionText); }
  const common = { version, profile:'sop-agent-3', source_template_sha256:templateHash, cases_md:buildCasesMd({ rows, write:true }), matrix, review_status:'synthetic_unreviewed_not_training_approved' };
  const manifest = { format:'chatsop-query-curriculum-v1', ...common, files:devFiles, sealed_eval:{ relative_directory:path.relative(development,sealed), manifest:'manifest.json' } };
  const evalManifest = { format:'chatsop-query-curriculum-eval-v1', ...common, files:evalFiles };
  fs.writeFileSync(path.join(development,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  fs.writeFileSync(path.join(sealed,'manifest.json'),JSON.stringify(evalManifest,null,2)+'\n');
  return { matrix, manifest, evalManifest };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i=0;i<args.length;i+=2) { if (!['--out','--eval-out'].includes(args[i]) || !args[i+1]) throw Error('Usage: node tools/datasets/build-curriculum.mjs [--out DIR --eval-out DIR]'); options[args[i]==='--eval-out'?'evalOut':'out'] = args[i+1]; }
    console.log(JSON.stringify(writeCurriculum(options).matrix));
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
