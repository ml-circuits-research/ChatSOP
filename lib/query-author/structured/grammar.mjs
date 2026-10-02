import {ARITHMETIC_WORDS, COMPARATOR_WORDS, ENUMS, ORDER_WORDS, QUANTIFIER_WORDS, RANK_CUTS, RANK_WORDS, ROLE_NAMES, TIME_MEASURES} from '../../../sop/enums.mjs';

const lit = JSON.stringify;
const alternatives = values => '(' + [...new Set(values)].map(lit).join(' | ') + ')';
const variables = ['?x', '?y', '?z', '?v', '?a', '?b', '?t', '?t1', '?t2', '?who', '?what', '?where', '?how', '?price', '?age', '?count'];
const spaces = n => lit(' '.repeat(n));
const field = (name, value) => `${lit('  ' + name + ' ')} ${value} "\\n"`;
const fieldBlock = (name, value) => `${lit('  ' + name + ' ')} ${value}`;
const enumRule = values => values.length ? alternatives(values) : null;
const quoted = values => enumRule(values.filter(v => typeof v === 'string' && v.trim() && !/^[?$~]/.test(v)).map(v => JSON.stringify(v)));
const numeric = type => /^(?:int|integer|number|float|decimal)$/.test(type);

/** GBNF with only retrieved predicates/roles and request-literal values; host validation handles bindings. */
export function generateGrammar(candidates) {
  const rules = new Map();
  const set = (key, expression) => { rules.set(key, expression); return key; };
  set('variable', alternatives(variables));
  const entities = quoted(candidates.entities ?? []);
  const times = quoted(candidates.times ?? []);
  const numbers = enumRule((candidates.numbers ?? []).filter(Number.isSafeInteger).map(String));
  const positive = enumRule((candidates.numbers ?? []).filter(n => Number.isSafeInteger(n) && n > 0).map(String));
  const rankNumbers = enumRule((candidates.numbers ?? []).filter(n => Number.isSafeInteger(n) && n > 0 && n <= 999).map(String));
  if (entities) set('entity', entities);
  if (times) set('time', times);
  if (numbers) set('number', numbers);
  set('comparator', alternatives(Object.keys(COMPARATOR_WORDS)));
  set('arithmetic', alternatives(Object.keys(ARITHMETIC_WORDS)));
  set('operand', ['variable', ...(entities ? ['entity'] : []), ...(times ? ['time'] : []), ...(numbers ? ['number'] : [])].join(' | '));
  // A parser-valid temporal order names two different variables, not ?x before ?x.
  set('order-word', alternatives(ORDER_WORDS));
  set('order-pair', '(' + variables.map(left =>
    `${lit(left + ' ')} order-word " " ${alternatives(variables.filter(right => right !== left))}`).join(' | ') + ')');
  const predicates = (candidates.predicates ?? []).filter(p => typeof p.id === 'string' && /^[a-z][a-z0-9_:-]*$/.test(p.id) && Array.isArray(p.roles))
    .map(p => ({...p, roles: [...new Map(p.roles.filter(r => r && ROLE_NAMES.includes(r.name)).map(r => [r.name, r])).values()].slice(0, 4)}))
    .filter(p => p.roles.length);

  function roleValue(role, chained) {
    const values = numeric(role.type) ? ['variable', ...(numbers ? ['number'] : [])] : role.name === 'time'
      ? ['variable', ...(times ? ['time'] : []), ...(entities ? ['entity'] : [])]
      : ['variable', ...(entities ? ['entity'] : [])];
    if (chained) values.push(lit('$q'));
    return '(' + values.join(' | ') + ')';
  }
  function match(depth, chained) {
    const indent = 2 + depth * 2;
    const children = [];
    predicates.forEach((p, index) => {
      // Enumerating nonempty subsets bounds role cardinality and excludes duplicate or unknown names.
      const roleOptions = [];
      for (let mask = 1; mask < (1 << p.roles.length); mask++) {
        roleOptions.push(p.roles.filter((_, i) => mask & (1 << i)).map(r =>
          `${spaces(indent + 2)} ${lit('role ' + r.name + ' ')} ${roleValue(r, chained)} "\\n"`).join(' '));
      }
      const name = `match-${chained ? 2 : 1}-${depth}-${index}`;
      set(name, `${lit('match\n')} ${spaces(indent + 2)} ${lit('relation ' + JSON.stringify(p.id) + '\n')} (${roleOptions.join(' | ')}) ${spaces(indent + 2)} ${lit('polarity ')} ("affirmed" | "negated") "\\n" ${spaces(indent)} ${lit('end\n')}`);
      children.push(name);
    });
    return set(`match-${chained ? 2 : 1}-${depth}`, children.join(' | '));
  }
  // The outer block's opener sits on the field line (indent 2). Its children are at indent 4.
  function condition(depth, chained) {
    const indent = 2 + depth * 2;
    const leaf = match(depth, chained);
    if (depth === 2) return set(`condition-${chained ? 2 : 1}-${depth}`, leaf);
    const next = condition(depth + 1, chained);
    return set(`condition-${chained ? 2 : 1}-${depth}`,
      `${leaf} | ("all\\n" | "any\\n") ${spaces(indent + 2)} ${next} (${spaces(indent + 2)} ${next}){0,2} ${spaces(indent)} "end\\n"`);
  }
  // Match blocks use their own depth-specific indentation, compare/constraint leaves share group depth only.
  function wordBlock(prefix, depth, leaf, maxDepth) {
    const name = `${prefix}-${depth}`;
    if (depth === maxDepth) return set(name, leaf);
    const next = wordBlock(prefix, depth + 1, leaf, maxDepth);
    const indent = 2 + depth * 2;
    return set(name, `${leaf} | ("all\\n" | "any\\n") ${spaces(indent + 2)} ${next} (${spaces(indent + 2)} ${next}){0,2} ${spaces(indent)} "end\\n"`);
  }
  const comparison = set('comparison', 'variable " " comparator " " operand "\\n"');
  wordBlock('compare', 0, comparison, 2);
  const selected = field('select', 'variable (" " variable){0,2}');
  const at = times ? `(${field('at', 'time')} | ${field('during', 'time')})?` : '';
  const asof = times ? `(${field('asof', 'time')})?` : '';
  const rankCut = rankNumbers ? `(" " ${alternatives(RANK_CUTS)} " " ${rankNumbers})?` : '';
  const rank = field('rank', `${alternatives(RANK_WORDS)} " " variable ${rankCut}`);
  const quantifier = field('quantifier', `(${alternatives(QUANTIFIER_WORDS.filter(x => x !== 'at_least'))}${positive ? ' | "at_least " ' + positive : ''})`);
  if (predicates.length) {
    for (const chained of [false, true]) {
      const conditionName = condition(0, chained);
      const where = set(`where-${chained ? 2 : 1}`, fieldBlock('where', conditionName));
      const scope = fieldBlock('scope', conditionName);
      const tail = `${at} ${entities ? `(${field('except', 'variable " " entity')})?` : ''} (${fieldBlock('compare', 'compare-0')})? (${field('order', 'order-pair')})? ${positive ? `(${field('limit', positive)})?` : ''}`;
      const main = `(${field('mode', alternatives(ENUMS.query.mode.filter(x => x !== 'every' && x !== 'explain')))})? ${asof} (${selected})? (${rank})? (${field('measure', alternatives(TIME_MEASURES))})? ${where} ${tail}`;
      const every = `${field('mode', lit('every'))} ${asof} (${selected})? (${quantifier})? ${where} ${scope} ${tail}`;
      const explain = `${field('mode', lit('explain'))} ${asof} ${where} ${tail}`;
      set(`query-${chained ? 2 : 1}`, `${lit(chained ? '@q2 query\n' : '@q query\n')} (${main} | ${every} | ${explain})`);
    }
  }
  set('unclear', `${lit('@u unclear\n')} ${field('kind', alternatives(['no_request', 'gibberish', 'relation_not_in_memory']))}`);
  if (numbers) {
    set('term', 'variable | number');
    set('expression', 'term (" " arithmetic " " term){0,3}');
    set('require-leaf', 'expression " " comparator " " expression "\\n"');
    wordBlock('requirement', 0, 'require-leaf', 2);
    const select = field('select', 'variable (" " variable){0,2}');
    const declaration = field('var', 'variable " int" (" " number " " number)?');
    const requirement = fieldBlock('require', 'requirement-0');
    const claim = fieldBlock('claim', 'requirement-0');
    const tasks = field('task', alternatives(['prove', 'possible']));
    const objective = `${field('objective', 'expression')} (${field('direction', alternatives(ENUMS.constraint.direction))})? ${field('task', lit('optimize'))}`;
    set('constraint', `${lit('@c constraint\n')} ((${declaration}){0,4} (${requirement}){0,4} ${claim} (${tasks} | ${objective}) (${select})? | (${declaration}){1,4} (${requirement}){1,4} (${tasks} | ${objective}) ${select})`);
  }
  set('root', ['unclear', ...(predicates.length ? ['query-1 ("\\n" query-2)?'] : []), ...(numbers ? ['constraint'] : [])].join(' | ') + ' "\\n"?');
  return ['root', ...[...rules.keys()].filter(key => key !== 'root')].map(key => `${key} ::= ${rules.get(key)}`).join('\n') + '\n';
}

/** The completion backend passes extraBody to llama.cpp; ordinary admission remains authoritative. */
export function grammarRequest(candidates) {
  return {
    extraBody: {grammar: generateGrammar(candidates)},
    system: 'Write only SOP circuits, never an answer. Use fields in this order: mode, asof, select, rank, measure, quantifier, where, scope, at/during, except, compare, order, limit. Put multiple matches in one where all/any group; stop after the last field. For constraints: var, require or claim, objective/direction, task, select. Include only fields the user asked for: no rank, measure, except, compare, order or limit unless explicitly requested. Use only candidate predicates and declared roles, request literal values, and the offered variables; when the vocabulary cannot express the question, emit @u unclear with kind relation_not_in_memory.',
    decode(reply) { return typeof reply === 'string' ? reply : (reply?.choices?.[0]?.message?.content ?? reply?.content ?? ''); },
  };
}
