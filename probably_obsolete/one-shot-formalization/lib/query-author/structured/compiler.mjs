import {circuitSchema, VARIABLES} from './schema.mjs';
import {checkModelProgram} from '../../../sop/declarative.mjs';
import {parse, canonical} from '../../../sop/parser.mjs';

const kinds = ['lookup', 'count', 'rank', 'compare', 'exists', 'every', 'chain', 'temporal', 'numeric', 'unclear'];
const comparators = ['above', 'below', 'at_least', 'at_most', 'equal', 'not_equal'];
const fail = message => { throw Error(`structured circuit: ${message}`); };
const object = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) fail(`${label} has missing or unsafe fields`);
};
const oneOf = (value, choices, label) => { if (!choices.includes(value)) fail(`unknown ${label}: ${String(value)}`); return value; };
const items = (value, max, label, min = 1) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`invalid ${label} length`);
  return value;
};
const variable = value => oneOf(value, VARIABLES, 'variable');
const quoted = value => JSON.stringify(value);

export function compileCircuit(result, candidates) {
  object(result, ['circuit'], 'reply');
  const c = result.circuit;
  if (!c || typeof c !== 'object' || Array.isArray(c)) fail('circuit must be an object');
  oneOf(c.kind, kinds, 'circuit kind');
  const predicates = new Map(candidates.predicates.map(p => [p.id, new Set(p.roles.map(r => r.name))]));
  const entities = new Set(candidates.entities);
  const numbers = new Set(candidates.numbers);
  const times = new Set(candidates.times);
  const roleTerm = term => {
    object(term, ['kind', 'value'], 'term');
    switch (term.kind) {
      case 'variable': return variable(term.value);
      case 'entity': if (typeof term.value === 'string' && entities.has(term.value) && term.value.trim() && !/^[?$~]/.test(term.value)) return quoted(term.value); break;
      case 'number': if (Number.isSafeInteger(term.value) && numbers.has(term.value)) return String(term.value); break;
      case 'time': if (typeof term.value === 'string' && times.has(term.value) && term.value.trim()) return quoted(term.value); break;
    }
    fail('term is not an offered value of its declared kind');
  };
  const bound = new Set();
  const timesBound = new Set();
  const emitMatch = m => {
    object(m, ['predicate', 'polarity', 'roles'], 'match');
    const declared = predicates.get(m.predicate);
    if (!declared) fail('unknown predicate');
    oneOf(m.polarity, ['affirmed', 'negated'], 'polarity');
    const roles = items(m.roles, 4, 'roles');
    const seen = new Set();
    const lines = ['match', `relation ${quoted(m.predicate)}`];
    for (const r of roles) {
      object(r, ['name', 'value'], 'role');
      if (seen.has(r.name) || (!declared.has(r.name) && r.name !== 'time')) fail('unknown or repeated predicate role');
      seen.add(r.name);
      if (r.value?.kind === 'time' && r.name !== 'time') fail('time value requires a time role');
      if (r.value?.kind === 'variable') {
        variable(r.value.value);
        bound.add(r.value.value);
        if (r.name === 'time') timesBound.add(r.value.value);
      }
      lines.push(`role ${r.name} ${roleTerm(r.value)}`);
    }
    lines.push(`polarity ${m.polarity}`, 'end');
    return lines;
  };
  const group = (g, depth = 0) => {
    object(g, depth ? ['op', 'matches'] : ['op', 'matches', 'groups'], 'group');
    oneOf(g.op, ['all', 'any'], 'group operator');
    const matches = items(g.matches, 12, 'group matches', 0);
    const children = depth ? [] : items(g.groups, 8, 'nested groups', 0);
    if (!matches.length && !children.length) fail('empty condition group');
    const lines = [g.op];
    const start = new Set(bound), startTimes = new Set(timesBound), branches = [];
    const append = emit => {
      if (g.op === 'any') {
        bound.clear(); timesBound.clear();
        for (const v of start) bound.add(v);
        for (const v of startTimes) timesBound.add(v);
      }
      lines.push(...emit());
      branches.push({variables: new Set(bound), times: new Set(timesBound)});
    };
    for (const m of matches) append(() => emitMatch(m));
    for (const child of children) append(() => group(child, depth + 1));
    if (g.op === 'any') {
      bound.clear(); timesBound.clear();
      for (const v of branches[0].variables) if (branches.every(b => b.variables.has(v))) bound.add(v);
      for (const v of branches[0].times) if (branches.every(b => b.times.has(v))) timesBound.add(v);
    }
    lines.push('end');
    return lines;
  };
  const compare = value => {
    object(value, ['left', 'comparator', 'right'], 'comparison');
    variable(value.left);
    if (!bound.has(value.left)) fail('unbound comparison variable');
    oneOf(value.comparator, comparators, 'comparator');
    if (value.right?.kind === 'variable' && !bound.has(variable(value.right.value))) fail('unbound comparison operand');
    if (value.right?.kind === 'time' && !['equal', 'not_equal'].includes(value.comparator)) fail('time ordering uses temporal order');
    return `${value.left} ${value.comparator} ${roleTerm(value.right)}`;
  };
  const alternatives = value => {
    object(value, ['op', 'items'], 'comparison group');
    oneOf(value.op, ['all', 'any'], 'comparison operator');
    const lines = [value.op, ...items(value.items, 12, 'comparisons', 1).map(compare), 'end'];
    return lines;
  };
  if (c.kind === 'unclear') {
    object(c, ['kind', 'reason'], 'unclear');
    oneOf(c.reason, ['gibberish', 'no_request', 'relation_not_in_memory'], 'unclear reason');
    return canonical(checkModelProgram(parse(`@q unclear\n  kind ${c.reason}\n`)));
  }
  let lines = [];
  if (c.kind === 'numeric') {
    object(c, ['kind', 'variables', 'requirements', 'claim', 'task', 'objective', 'direction', 'select'], 'numeric');
    const vars = items(c.variables, 8, 'declared variables').map(v => {
      object(v, ['name', 'min', 'max'], 'integer variable');
      variable(v.name);
      if ((v.min === null) !== (v.max === null)) fail('integer bounds must be paired');
      if (v.min !== null && (!Number.isSafeInteger(v.min) || !Number.isSafeInteger(v.max) || !numbers.has(v.min) || !numbers.has(v.max) || v.min > v.max)) fail('unoffered or reversed integer bounds');
      return v;
    });
    const declared = new Set(vars.map(v => v.name));
    if (declared.size !== vars.length) fail('duplicate declared variable');
    const expr = x => {
      object(x, ['first', 'rest'], 'expression');
      const parts = items(x.rest, 8, 'arithmetic', 0);
      const terms = [x.first, ...parts.map(part => {object(part, ['op', 'term'], 'arithmetic step'); oneOf(part.op, ['plus', 'minus', 'times', 'divided_by'], 'arithmetic word'); return part.term;})];
      for (const t of terms) {
        if (!['number', 'variable'].includes(t?.kind)) fail('numeric expression needs integers or declared variables');
        if (t.kind === 'variable' && !declared.has(variable(t.value))) fail('undeclared expression variable');
      }
      return [roleTerm(x.first), ...parts.flatMap(part => [part.op, roleTerm(part.term)])].join(' ');
    };
    const condition = r => {
      object(r, ['left', 'comparator', 'right'], 'numeric comparison');
      oneOf(r.comparator, comparators, 'comparator');
      return `${expr(r.left)} ${r.comparator} ${expr(r.right)}`;
    };
    const selected = items(c.select, 8, 'numeric selection', 0).map(variable);
    if (new Set(selected).size !== selected.length || selected.some(v => !declared.has(v))) fail('undeclared or repeated selected variable');
    oneOf(c.task, ['possible', 'prove', 'optimize'], 'numeric task');
    if (c.task === 'prove' && c.claim === null) fail('proof needs a claim');
    if (c.task === 'optimize' ? c.objective === null || !['min', 'max'].includes(c.direction) : c.objective !== null || c.direction !== null) fail('objective and direction require optimization');
    if (c.claim === null && !selected.length && c.objective === null) fail('numeric circuit needs a claim, objective or selected variables');
    lines = ['@q constraint', ...vars.map(v => `  var ${v.name} int${v.min === null ? '' : ` ${v.min} ${v.max}`}`)];
    for (const r of items(c.requirements, 12, 'requirements', 0)) lines.push(`  require ${condition(r)}`);
    if (c.claim !== null) lines.push(`  claim ${condition(c.claim)}`);
    if (c.objective !== null) lines.push(`  objective ${expr(c.objective)}`, `  direction ${c.direction}`);
    lines.push(`  task ${c.task}`);
    if (selected.length) lines.push(`  select ${selected.join(' ')}`);
  } else {
    const fields = {
      lookup: ['kind', 'where', 'select'], count: ['kind', 'where', 'select'],
      rank: ['kind', 'where', 'select', 'value', 'direction', 'cut', 'options'],
      compare: ['kind', 'where', 'select', 'tests'], exists: ['kind', 'where'],
      every: ['kind', 'where', 'scope', 'select', 'quantifier', 'threshold'],
      chain: ['kind', 'where', 'select'],
      temporal: ['kind', 'where', 'select', 'time', 'period', 'measure', 'order']
    };
    object(c, fields[c.kind], c.kind);
    const where = group(c.where);
    if (c.kind === 'chain' && (where.filter(line => line === 'match').length < 2 || ![...bound].some(v => where.filter(line => line.includes(` ${v}`)).length > 1))) fail('chain needs a shared-variable join');
    lines = ['@q query', `  where ${where[0]}`, ...where.slice(1).map(line => `    ${line}`)];
    const selected = value => {if (value !== null) {variable(value); if (!bound.has(value)) fail('unbound selected variable'); lines.push(`  select ${value}`);}};
    if (c.kind === 'lookup' || c.kind === 'chain' || c.kind === 'count') {
      selected(c.select);
      if (c.kind === 'count') lines.push('  mode count');
    } else if (c.kind === 'rank') {
      selected(c.select);
      if (!bound.has(variable(c.value))) fail('unbound ranked value');
      oneOf(c.direction, ['highest', 'lowest'], 'rank direction');
      object(c.cut, ['kind', 'value'], 'rank cut');
      oneOf(c.cut.kind, ['all', 'position', 'top'], 'rank cut kind');
      if (c.cut.kind === 'all' ? c.cut.value !== null : !Number.isSafeInteger(c.cut.value) || c.cut.value <= 0 || c.cut.value > 999 || !numbers.has(c.cut.value)) fail('invalid rank cut');
      if (c.options !== null) {
        const options = alternatives(c.options);
        lines.push(`  compare ${options[0]}`, ...options.slice(1).map(line => `    ${line}`));
      }
      lines.push(`  rank ${c.direction} ${c.value}${c.cut.kind === 'all' ? '' : ` ${c.cut.kind} ${c.cut.value}`}`);
    } else if (c.kind === 'compare') {
      selected(c.select);
      const tests = alternatives(c.tests);
      lines.push(`  compare ${tests[0]}`, ...tests.slice(1).map(line => `    ${line}`));
    } else if (c.kind === 'exists') lines.push('  mode exists');
    else if (c.kind === 'every') {
      selected(c.select);
      const scope = group(c.scope);
      lines.push('  mode every', `  scope ${scope[0]}`, ...scope.slice(1).map(line => `    ${line}`));
      oneOf(c.quantifier, ['all', 'none', 'not_all', 'most', 'half', 'at_least'], 'quantifier');
      if (c.quantifier === 'at_least' ? !Number.isSafeInteger(c.threshold) || c.threshold <= 0 || !numbers.has(c.threshold) : c.threshold !== null) fail('invalid quantifier threshold');
      if (c.quantifier !== 'all') lines.push(`  quantifier ${c.quantifier}${c.threshold === null ? '' : ` ${c.threshold}`}`);
    } else if (c.kind === 'temporal') {
      selected(c.select);
      oneOf(c.period, ['none', 'at', 'during', 'asof'], 'period');
      oneOf(c.measure, ['none', 'start', 'end', 'duration'], 'measure');
      if (c.period === 'none' ? c.time !== null : !times.has(c.time)) fail('invalid time choice');
      if (c.period !== 'none') lines.push(`  ${c.period} ${quoted(c.time)}`);
      if (c.measure !== 'none') {
        if (!timesBound.has(c.select)) fail('measure requires selected time variable');
        lines.push(`  measure ${c.measure}`);
      }
      if (c.order !== null) {
        object(c.order, ['left', 'relation', 'right'], 'time order');
        if (c.order.left === c.order.right || !timesBound.has(variable(c.order.left)) || !timesBound.has(variable(c.order.right))) fail('order needs two bound time roles');
        oneOf(c.order.relation, ['before', 'after', 'same_time'], 'time ordering');
        lines.push(`  order ${c.order.left} ${c.order.relation} ${c.order.right}`);
      }
    }
  }
  return canonical(checkModelProgram(parse(lines.join('\n') + '\n')));
}

export function structuredRequest(candidates) {
  const schema = circuitSchema(candidates);
  return {
    system: [
      'Translate the user request into exactly one circuit. Output JSON matching response_format, not prose or an answer. Never write facts, assumptions, gold answers, or operations.',
      'Only choose from this request-local vocabulary: predicates ' + JSON.stringify(candidates.predicates.map(p => ({id: p.id, roles: p.roles.map(r => r.name)}))) +
        '; entities ' + JSON.stringify(candidates.entities) + '; integers ' + JSON.stringify(candidates.numbers) + '; times ' + JSON.stringify(candidates.times) + '.',
      'Top-level object is {\"circuit\":{...}}. Every query has \"kind\" and \"where\": {\"op\":\"all\"|\"any\", \"matches\":[...], \"groups\":[{\"op\":\"all\"|\"any\", \"matches\":[...]}]}. A match is {\"predicate\":offered_id,\"polarity\":\"affirmed\"|\"negated\",\"roles\":[{\"name\":declared_role,\"value\":{\"kind\":\"variable\"|\"entity\"|\"number\"|\"time\",\"value\":offered_value_or_variable}}]}. Reuse the same variable to join matches. Use only role time for a time variable when asking when. A variable must be bound in every where branch before selection/rank/comparison.',
      'lookup/count/chain add \"select\"; chain needs two joined matches. exists has only kind and where. compare adds \"select\" (variable or null) and \"tests\": {\"op\":\"all\"|\"any\",\"items\":[{\"left\":bound_variable,\"comparator\":\"above\"|\"below\"|\"at_least\"|\"at_most\"|\"equal\"|\"not_equal\",\"right\":term},...]}. rank adds select, numeric \"value\" variable, \"direction\":\"highest\"|\"lowest\", \"cut\":{\"kind\":\"all\"|\"position\"|\"top\",\"value\":null_or_offered_positive_integer}, \"options\":null_or_tests. Restrict named alternatives with options before ranking.',
      'every uses where as domain, scope as the required matches sharing domain variables, select as bound variable or null, quantifier all|none|not_all|most|half|at_least, threshold null except at_least. temporal adds select variable or null; period none|at|during|asof and time null or offered text; measure none|start|end|duration and order null or two bound time variables with before|after|same_time.',
      'numeric uses variables [{name, min, max}] with null/null or offered integer bounds, requirements [{left:expression, comparator, right:expression}], claim null or comparison, task possible|prove|optimize, objective null or expression, direction null|min|max, select array of declared variables. Expression is {first:term,rest:[{op:plus|minus|times|divided_by,term},...]}. Use claim for proof; objective and direction only for optimize. All numbers must be offered from the original request; do not solve the constraint yourself. If no fitting relation, choose unclear with reason relation_not_in_memory; greetings choose no_request.'
    ].join('\\n'),
    extraBody: {response_format: {type: 'json_schema', json_schema: {name: 'circuit', strict: true, schema}}},
    decode(reply) { return compileCircuit(JSON.parse(reply), candidates); }
  };
}
