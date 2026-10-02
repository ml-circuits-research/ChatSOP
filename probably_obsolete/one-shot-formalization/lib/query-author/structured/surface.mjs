import {circuitSchema, VARIABLES} from './schema.mjs';
import {compileCircuit, structuredRequest} from './compiler.mjs';
import {parse, canonical} from '../../../sop/parser.mjs';
import {checkModelProgram} from '../../../sop/declarative.mjs';

// Development-only one-factor comparisons. All variants use requestCandidates and the
// existing compileCircuit/checkModelProgram/authorQuery validator: no gold, facts, new
// entities or session definitions. Format compares JSON with SOP over the same form
// meanings, variable list and request-local predicates/roles/entities/numbers/times;
// SOP has no separate labels for lookup vs chain or unmodified temporal vs lookup.
// Restriction changes only JSON enums for predicate/entity/form to free strings, not
// admission. Steps narrows the same closed JSON schema by a selected form and predicate
// subset; extra model calls and their tokens/latency are part of the treatment.
export const ABLATION_VARIANTS = Object.freeze(['format-json', 'format-sop', 'restriction-free', 'steps']);
const lit = JSON.stringify;
const choices = values => '(' + [...new Set(values)].map(lit).join(' | ') + ')';
const responseFormat = (name, schema) => ({response_format: {type: 'json_schema', json_schema: {name, strict: true, schema}}});
const FORMS = ['lookup', 'count', 'rank', 'compare', 'exists', 'every', 'chain', 'temporal', 'numeric', 'unclear'];

/** A SOP spelling of the same closed vocabulary, form choices and single-circuit bounds as circuitSchema. */
export function closedSopGrammar(candidates) {
  const rules = new Map();
  const rule = (name, value) => {rules.set(name, value); return name;};
  const f = (name, value) => `${lit('  ' + name + ' ')} ${value} "\\n"`;
  const block = (name, value) => `${lit('  ' + name + ' ')} ${value}`;
  rule('variable', choices(VARIABLES));
  const entities = candidates.entities.filter(v => typeof v === 'string' && v.trim() && !/^[?$~]/.test(v));
  if (entities.length) rule('entity', choices(entities.map(lit)));
  if (candidates.times.length) rule('time', choices(candidates.times.map(lit)));
  if (candidates.numbers.length) rule('number', choices(candidates.numbers.map(String)));
  const positives = candidates.numbers.filter(n => n > 0 && n <= 999);
  if (positives.length) rule('positive', choices(positives.map(String)));
  rule('term', ['variable', ...(entities.length ? ['entity'] : []), ...(candidates.numbers.length ? ['number'] : []), ...(candidates.times.length ? ['time'] : [])].join(' | '));
  rule('numeric-term', ['variable', ...(candidates.numbers.length ? ['number'] : [])].join(' | '));
  rule('comparator', choices(['above', 'below', 'at_least', 'at_most', 'equal', 'not_equal']));
  rule('arith', choices(['plus', 'minus', 'times', 'divided_by']));
  rule('expression', 'numeric-term (" " arith " " numeric-term){0,8}');
  rule('comparison', 'variable " " comparator " " term "\\n"');
  rule('comparison-group', `${choices(['all', 'any'])} "\\n" ${lit('    ')} comparison (${lit('    ')} comparison){0,11} ${lit('  end\n')}`);
  // Restrict each match to its declared roles, with optional time, one to four distinct roles.
  if (candidates.predicates.length) {
    const matchBody = (p, indent) => {
      const roleNames = [...new Set([...p.roles.map(r => r.name), 'time'])];
      const alternatives = [];
      for (let mask = 1; mask < 2 ** roleNames.length; mask++) {
        const selected = roleNames.filter((_, index) => mask & (1 << index));
        if (selected.length > 4) continue;
        alternatives.push(selected.map(name => `${lit(' '.repeat(indent + 2) + 'role ' + name + ' ')} term "\\n"`).join(' '));
      }
      return `${lit('match\n')} ${lit(' '.repeat(indent + 2) + 'relation ' + lit(p.id) + '\n')} (${alternatives.join(' | ')}) ${lit(' '.repeat(indent + 2) + 'polarity ')} ${choices(['affirmed', 'negated'])} "\\n" ${lit(' '.repeat(indent) + 'end\n')}`;
    };
    for (const depth of [4, 6]) {
      const names = candidates.predicates.map((p, i) => rule(`match-${depth}-${i}`, matchBody(p, depth)));
      rule(`match-${depth}`, names.join(' | '));
    }
    rule('child-group', `${choices(['all', 'any'])} "\\n" ${lit('      ')} match-6 (${lit('      ')} match-6){0,11} ${lit('    end\n')}`);
    const rootMatches = `${lit('    ')} match-4 (${lit('    ')} match-4){0,11} (${lit('    ')} child-group){0,8}`;
    const rootChildren = `${lit('    ')} child-group (${lit('    ')} child-group){0,7}`;
    rule('group', `${choices(['all', 'any'])} "\\n" (${rootMatches} | ${rootChildren}) ${lit('  end\n')}`);
    const where = block('where', 'group');
    const select = f('select', 'variable');
    const compare = block('compare', 'comparison-group');
    const forms = [
      `${lit('@q query\n')} ${select} ${where}`,
      `${lit('@q query\n')} ${f('mode', lit('count'))} ${select} ${where}`,
      `${lit('@q query\n')} ${f('mode', lit('exists'))} ${where}`,
      `${lit('@q query\n')} ${f('mode', lit('every'))} (${select})? (${f('quantifier', positives.length ? `(${choices(['all', 'none', 'not_all', 'most', 'half'])} | ${lit('at_least ')} positive)` : choices(['all', 'none', 'not_all', 'most', 'half']))})? ${where} ${block('scope', 'group')}`,
      `${lit('@q query\n')} (${select})? ${where} ${compare}`,
      `${lit('@q query\n')} ${select} ${where} (${compare})? ${f('rank', `${choices(['highest', 'lowest'])} " " variable${positives.length ? ` (" " ${choices(['position', 'top'])} " " positive)?` : ''}`)}`,
      `${lit('@q query\n')} (${select})? ${where} ${candidates.times.length ? `(${f('at', 'time')} | ${f('during', 'time')} | ${f('asof', 'time')})?` : ''} (${f('measure', choices(['start', 'end', 'duration']))})? (${f('order', `variable " " ${choices(['before', 'after', 'same_time'])} " " variable`)})?`,
    ];
    // "chain" and "lookup" share the same SOP surface; the strict validator checks joins.
    rule('query', forms.join(' | '));
  }
  const numeric = `${lit('@q constraint\n')} (${f('var', `variable " " ${lit('int')}${candidates.numbers.length ? ' (" " number " " number)?' : ''}`)}){1,8} (${f('require', 'expression " " comparator " " expression')}){0,12} (${f('claim', 'expression " " comparator " " expression')})? (${f('objective', 'expression')} ${f('direction', choices(['min', 'max']))})? ${f('task', choices(['possible', 'prove', 'optimize']))} (${f('select', 'variable (" " variable){0,7}')})?`;
  rule('numeric', numeric);
  rule('unclear', `${lit('@q unclear\n')} ${f('kind', choices(['gibberish', 'no_request', 'relation_not_in_memory']))}`);
  rule('root', ['unclear', ...(candidates.predicates.length ? ['query'] : []), 'numeric'].join(' | '));
  return ['root', ...[...rules.keys()].filter(name => name !== 'root')].map(name => `${name} ::= ${rules.get(name)}`).join('\n') + '\n';
}

/** Decoder does not invent a repair or replace a refusal: admission remains authoritative. */
export function ablationRequest(candidates, variant) {
  if (!ABLATION_VARIANTS.includes(variant)) throw new Error(`unknown ablation variant: ${variant}`);
  const base = structuredRequest(candidates);
  if (variant === 'format-json' || variant === 'steps') return base;
  if (variant === 'format-sop') return {
    system: [
      'Translate the user request into one SOP circuit, never an answer, definition, fact or assumption.',
      'Only choose from this request-local vocabulary: predicates ' + JSON.stringify(candidates.predicates.map(p => ({id: p.id, roles: p.roles.map(r => r.name)}))) +
        '; entities ' + JSON.stringify(candidates.entities) + '; integers ' + JSON.stringify(candidates.numbers) + '; times ' + JSON.stringify(candidates.times) + '.',
      'Use @q query for lookup/count/exists/every/compare/rank/chain/temporal; @q constraint for numeric; @q unclear if the memory cannot express the request. Match, where, scope and compare use balanced all/any/end groups.',
      'Reuse a bound variable for joins and selection; choose only declared predicate roles. For rank select a bound value and optionally top/position using an offered positive integer. For every put the domain in where and the condition in scope. For temporal use at/during/asof, measure or time order only when requested. Numeric variables, bounds, arithmetic and thresholds use offered integers; never solve the task yourself.'
    ].join('\n'),
    extraBody: {grammar: closedSopGrammar(candidates)},
    decode(reply) { return canonical(checkModelProgram(parse(reply))); },
  };
  const schema = structuredClone(circuitSchema(candidates));
  // The compiler (not this permissive schema) still refuses every unoffered value.
  const free = node => {
    if (!node || typeof node !== 'object') return;
    if (node.properties?.kind?.enum?.includes('entity')) node.properties.value = {type: 'string'};
    if (node.properties?.predicate?.enum) node.properties.predicate = {type: 'string'};
    if (node.properties?.kind?.enum?.some(v => FORMS.includes(v))) node.properties.kind = {type: 'string'};
    for (const child of Object.values(node)) free(child);
  };
  free(schema);
  return {...base, system: base.system + '\nExperimental free-string variant: predicate IDs, entity strings and circuit form names are free text, but only the offered vocabulary can be admitted by the compiler. No facts or answers.',
    extraBody: responseFormat('circuit', schema), decode(reply) {return compileCircuit(JSON.parse(reply), candidates);}};
}

