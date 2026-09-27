import { parse, parseAtom, words } from '../../sop/parser.mjs';
import {parseCondition} from '../../sop/conditions.mjs';
import { stable, digest } from '../../lib/util.mjs';

// A conservative wire/field/term fingerprint, not a proof of semantic novelty.
// Constants and predicate names are erased; argument sharing and operators survive.
export function compositionShape(source) {
  const wires = parse(source).wires;
  const references = new Map(wires.map((wire, index) => [wire.id, `w${index}`]));
  const constants = new Map(), predicates = new Map();
  const name = (map, value, prefix) => {
    if (!map.has(value)) map.set(value, `${prefix}${map.size}`);
    return map.get(value);
  };
  return stable(wires.map(wire => {
    const variables = new Map();
    const term = value => {
      if (typeof value === 'string' && value.startsWith('?')) return name(variables, value, 'v');
      if (value && typeof value === 'object' && value.ref) return name(references, value.ref, 'r');
      return typeof value === 'string' ? name(constants, value, 'c') : typeof value;
    };
    for (const value of wire.fields.select ?? []) words(value).forEach(term);
    const fields = { ...wire.fields };
    if (wire.type === 'query') fields.mode ??= [fields.select?.length ? 'select' : 'exists'];
    return [wire.type, Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, values.map(value => {
      const atomShape = atom => ({ predicate:name(predicates, atom.p, 'p'), neg:!!atom.neg, args:atom.a.map(term) });
      if (key === 'where' && wire.type === 'query') return parseCondition(value, atom => atomShape(parseAtom(atom)));
      if (['where', 'holds', 'when', 'then'].includes(key)) return atomShape(parseAtom(value));
      if (['quote', 'text', 'source', 'at', 'asof', 'during', 'valid', 'language'].includes(key)) return '<literal>';
      if (key === 'data') { try { const data = JSON.parse(value); return Array.isArray(data) ? 'array' : typeof data; } catch { return 'symbol'; } }
      return value.replace(/\$([A-Za-z][A-Za-z0-9_]*)/g, (_, id) => '$' + name(references, id, 'r'))
        .replace(/~[A-Za-z][A-Za-z0-9_]*/g, '~approved')
        .replace(/\?[A-Za-z][A-Za-z0-9_]*/g, id => '?' + name(variables, id, 'v'))
        .replace(/\b\d+(?:\.\d+)?\b/g, '#').replace(/\s+/g, ' ').trim();
    })])];
  }));
}

export function measureCoverage(rows) {
  const cases = [...new Map(rows.map(row => [row.semantic_case_id, row])).values()];
  const tally = values => values.reduce((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {});
  const wireTypes = source => [...new Set(parse(source).wires.map(wire => wire.type))];
  const shapes = new Map(cases.map(row => [row.semantic_case_id, compositionShape(row.sop_target)]));
  const training = cases.filter(row => row.split === 'train' && row.evaluation_track === 'formalization');
  const trainShapes = new Set(training.map(row => shapes.get(row.semantic_case_id)));
  const trainRows = rows.filter(row => row.split === 'train');
  const trainEntities = new Set(trainRows.flatMap(row => row.context.entities.map(item => item.id)));
  const trainPredicates = new Set(trainRows.flatMap(row => row.context.predicates.map(item => item.id)));
  const normalize = value => value.normalize('NFC').toLocaleLowerCase('ro').replace(/\s+/g, ' ').trim();
  const trainText = normalize(trainRows.map(row => JSON.stringify({ question:row.question, context:row.context, assertions:row.context_assertions })).join('\n'));
  const trainRomanian = new Set(trainRows.filter(row => row.language === 'ro').map(row => normalize(row.question)));
  const compositions = {};
  for (const row of cases) {
    const shape = shapes.get(row.semantic_case_id), hash = digest(shape);
    compositions[hash] ??= { shape, train:[], dev:[], test:[] };
    compositions[hash][row.split].push(row.semantic_case_id);
  }
  for (const entry of Object.values(compositions)) for (const split of ['train', 'dev', 'test']) entry[split].sort();
  const holdouts = cases.filter(row => row.matrix?.holdout).map(row => {
    const kind = row.matrix.holdout;
    const result = { case_id:row.semantic_case_id, split:row.split, kind, checked:false, pass:null };
    if (kind === 'composition') return { ...result, checked:true, pass:row.split !== 'train' && !trainShapes.has(shapes.get(row.semantic_case_id)), criterion:'wire-field-term fingerprint absent from training', shape_sha256:digest(shapes.get(row.semantic_case_id)) };
    if (kind === 'lexical') {
      const entities = row.context.entities.map(item => item.id).filter(id => !trainEntities.has(id));
      const predicates = row.context.predicates.map(item => item.id).filter(id => !trainPredicates.has(id));
      const surfaces = (row.matrix.reserved_lexemes ?? []).filter(value => normalize(row.question).includes(normalize(value)) && !trainText.includes(normalize(value)));
      return { ...result, checked:true, pass:row.split !== 'train' && entities.length + predicates.length + surfaces.length > 0, entities, predicates, surfaces };
    }
    if (kind === 'romanian') {
      const surfaces = rows.filter(other => other.semantic_case_id === row.semantic_case_id && other.language === 'ro').map(other => normalize(other.question));
      return { ...result, checked:true, pass:row.split !== 'train' && surfaces.length > 0 && surfaces.every(surface => !trainRomanian.has(surface)), criterion:'whole Romanian question absent from training; not a claim of unseen words' };
    }
    return result;
  }).sort((a, b) => a.case_id.localeCompare(b.case_id));
  return {
    target_wire_cases:tally(cases.flatMap(row => wireTypes(row.sop_target))),
    target_wire_rows:tally(rows.flatMap(row => wireTypes(row.sop_target))),
    by_evaluation_track:tally(cases.map(row => row.evaluation_track)),
    formalization_target_wire_cases:tally(cases.filter(row => row.evaluation_track === 'formalization').flatMap(row => wireTypes(row.sop_target))),
    system_target_wire_cases:tally(cases.filter(row => row.evaluation_track === 'system').flatMap(row => wireTypes(row.sop_target))),
    host_setup_wire_cases:tally(cases.flatMap(row => row.setup_sop ? wireTypes(row.setup_sop) : [])),
    by_oracle:tally(cases.map(row => row.quality_flags.independent_oracle ?? 'unspecified')),
    by_expected_status:tally(cases.map(row => row.expected.status)),
    romanian_cases:new Set(rows.filter(row => row.language === 'ro').map(row => row.semantic_case_id)).size,
    semantic_cases:cases.length, compositions, holdouts,
    limitations:['Fingerprint novelty is a structural check, not proof of semantic novelty.', 'A lexical reservation is relative to this corpus, not to a pretrained model.', 'Source setup wires do not count as model-emitted coverage.'],
  };
}
