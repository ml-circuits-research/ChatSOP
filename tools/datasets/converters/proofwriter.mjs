import { createHash } from 'node:crypto';

const digest = data => createHash('sha256').update(data).digest('hex');
const identifier = text => `s_${Buffer.from(text, 'utf8').toString('hex')}`;
const requireValue = (condition, reason) => { if (!condition) throw Error(reason); };
const text = value => typeof value === 'string' && value.length > 0;
const atomFields = ['subject', 'relation', 'object', 'polarity'];

function atom(value) {
  requireValue(value && atomFields.every(key => text(value[key])), 'incomplete_formal_atom');
  requireValue(['+', '-', '~'].includes(value.polarity), 'unknown_polarity');
  requireValue(!variable(value.object), 'unsupported_variable_object');
  return value;
}

const variable = value => ['someone', 'something'].includes(value);
const polarity = value => value === '+' ? '' : 'not ';
function predicate(value) {
  return value.relation === 'is' ? `attribute_${identifier(value.object)}` : `relation_${identifier(value.relation)}`;
}
function term(value) { return variable(value) ? '?x' : identifier(value); }
function expression(value) {
  return `${polarity(value.polarity)}${predicate(value)} ${term(value.subject)}${value.relation === 'is' ? '' : ` ${term(value.object)}`}`;
}
function entitiesFor(value) {
  return value.relation === 'is' ? [value.subject] : [value.subject, value.object];
}
function key(value) {
  return JSON.stringify([value.subject, value.relation, value.object, value.polarity === '+' ? '+' : '-']);
}
function ground(value, subject) {
  return { ...value, subject: variable(value.subject) ? subject : value.subject, object: variable(value.object) ? subject : value.object };
}
function opposite(value) { return { ...value, polarity: value.polarity === '+' ? '-' : '+' }; }

/** Independent finite Horn oracle. In OWA, '~' is explicit hard negation (primary V2020.12.3 README). */
export function sourceOracle(theory, query) {
  const known = new Set(theory.facts.map(f => key(atom(f))));
  const entities = [...new Set([query, ...theory.facts, ...theory.rules.flatMap(r => [...r.premises, r.conclusion])].flatMap(a => entitiesFor(a).filter(x => !variable(x))))];
  requireValue(entities.length > 0 && entities.length <= 64 && theory.rules.length <= 50, 'oracle_bounds');
  for (let round = 0; round <= 128; round++) {
    let changed = false;
    for (const rule of theory.rules) for (const entity of entities) {
      if (rule.premises.every(part => known.has(key(ground(part, entity))))) {
        const result = key(ground(rule.conclusion, entity));
        if (!known.has(result)) { known.add(result); changed = true; }
      }
    }
    if (!changed) {
      const yes = known.has(key(query)), no = known.has(key(opposite(query)));
      return yes && no ? 'both' : yes ? 'supported' : no ? 'refuted' : 'unknown';
    }
  }
  throw Error('oracle_depth_exceeded');
}

function prepareTheory(raw) {
  requireValue(text(raw.id) && Number.isInteger(raw.depth) && text(raw.family) && text(raw.theory_text), 'invalid_theory_metadata');
  requireValue(Array.isArray(raw.facts) && Array.isArray(raw.rules) && Array.isArray(raw.questions), 'invalid_theory_lists');
  requireValue(raw.facts.length <= 64 && raw.rules.length <= 50 && raw.questions.length <= 100, 'theory_bounds');
  requireValue(raw.facts.every(f => text(f.id) && text(f.text)) && raw.rules.every(r => text(r.id) && text(r.text) && Array.isArray(r.premises) && r.premises.length > 0), 'missing_source_text');
  const ids = [...raw.facts, ...raw.rules].map(item => item.id);
  requireValue(ids.length === new Set(ids).size, 'duplicate_source_wires');
  for (const fact of raw.facts) {
    atom(fact);
    requireValue(fact.polarity !== '~' && !variable(fact.subject), 'unsupported_fact_shape');
  }
  for (const rule of raw.rules) {
    rule.premises.forEach(atom); atom(rule.conclusion);
    requireValue(rule.conclusion.polarity !== '~', 'invalid_rule_conclusion');
    const subjects = new Set([...rule.premises, rule.conclusion].map(a => a.subject).filter(variable));
    requireValue(subjects.size <= 1, 'multiple_generic_subjects');
    requireValue(!variable(rule.conclusion.subject) || rule.premises.some(p => variable(p.subject)), 'unbound_rule_subject');
  }
  const atoms = [...raw.facts, ...raw.rules.flatMap(r => [...r.premises, r.conclusion]), ...raw.questions.map(q => q.query).filter(Boolean)];
  const names = [...new Set(atoms.flatMap(a => entitiesFor(a).filter(x => !variable(x))))].sort();
  const predicates = new Map(atoms.map(a => [predicate(a), a]));
  const ontology_sop = [
    ...names.map(name => `@${identifier(name)} entity\n  kind proofwriter_entity\n  label en ${JSON.stringify(name)}`),
    ...[...predicates].sort(([a], [b]) => a.localeCompare(b)).map(([id, a]) => `@${id} predicate\n  args ${a.relation === 'is' ? 'proofwriter_entity' : 'proofwriter_entity proofwriter_entity'}\n  description ${JSON.stringify(a.relation === 'is' ? `is ${a.object}` : a.relation)}`)
  ].join('\n');
  const setup_sop = [
    ...raw.facts.map((f, i) => `@pw_fact_${i} fact\n  holds ${expression(f)}\n  valid timeless\n  source ${JSON.stringify(f.id)}\n  quote ${JSON.stringify(f.text)}`),
    ...raw.rules.map((r, i) => `@pw_rule_${i} rule\n${r.premises.map(p => `  when ${expression(p)}\n`).join('')}  then ${expression(r.conclusion)}\n  source ${JSON.stringify(r.id)}`)
  ].join('\n');
  return { ontology_sop, setup_sop };
}

/** Converts only formal OWA theories. Caller must enforce redistribution approval separately. */
export function convertTheory(raw, { revision, uri, sha256, license, split = 'train' }) {
  requireValue(text(revision) && text(uri) && /^[0-9a-f]{64}$/.test(sha256) && (license === null || text(license)), 'missing_verified_provenance');
  requireValue(/-OWA-/.test(raw.id), 'not_owa');
  requireValue(['train', 'dev', 'test'].includes(split), 'invalid_split');
  const { ontology_sop, setup_sop } = prepareTheory(raw);
  const rows = [], rejected = [];
  for (const question of raw.questions) {
    try {
      requireValue(text(question.id) && text(question.text), 'missing_question_text');
      const a = atom(question.query);
      requireValue(a.polarity !== '~' && !entitiesFor(a).some(variable), 'unsupported_query_atom');
      const oracle = sourceOracle(raw, a);
      requireValue(oracle !== 'both', 'contradictory_owa_theory');
      const answer = { True: 'supported', False: 'refuted', Unknown: 'unknown' }[String(question.answer)];
      requireValue(answer && answer === oracle, `source_oracle_mismatch:${question.answer}:${oracle}`);
      const group = `proofwriter:${raw.id}`, caseId = `${group}:${question.id}`;
      rows.push({
        id: `${caseId}:en`, semantic_case_id: caseId, split_group_id: group,
        structure_id: `proofwriter-${raw.family}-depth${raw.depth}-${a.polarity === '+' ? 'positive' : 'negative'}`,
        split, input_mode: 'query_only', evaluation_track:'formalization',
        source: { id: 'proofwriter-structured', kind: 'external', uri, revision, sha256, license,
          original_id: { theory: raw.id, question: question.id }, original_question: question.text,
          theory_text: raw.theory_text, depth: raw.depth, qdep: question.qdep, qlen: question.qlen,
          family: raw.family, strategy: question.strategy, proofs: question.proofs, proof_graph: question.proof_graph,
          raw_theory_sha256: digest(JSON.stringify(raw)) },
        context_assertions: [], question: `Is it true that ${question.text.replace(/[.?!]\s*$/, '')}?`, language: 'en',
        surface_group_id: caseId, ontology_sop,
        sop_target: `@q query\n  where ${expression(a)}`,
        semantic_status: 'valid', negative_of: null,
        generation_trace: { method: 'deterministic_question_wrapper', template: null, model: null, review_status: 'pending_semantic_review' },
        quality_flags: { source_oracle: oracle, source_question_exact: question.text },
        setup_sop, context: {
          now: '2026-09-27', language: 'en',
          entities: [...new Set([a, ...raw.facts, ...raw.rules.flatMap(r => [...r.premises, r.conclusion])].flatMap(v => entitiesFor(v).filter(x => !variable(x))))].sort().map(name => ({ id: identifier(name), type: 'proofwriter_entity' })),
          predicates: [...new Map([a, ...raw.facts, ...raw.rules.flatMap(r => [...r.premises, r.conclusion])].map(v => [predicate(v), v]))].sort(([x], [y]) => x.localeCompare(y)).map(([id, v]) => ({ id, args: v.relation === 'is' ? ['proofwriter_entity'] : ['proofwriter_entity', 'proofwriter_entity'] })),
          approvedTemplates: [], procedures_sop: []
        }, expected: { status: oracle }
      });
    } catch (error) { rejected.push({ theory: raw.id, question: question.id ?? null, reason: error.message }); }
  }
  return { rows, rejected };
}
