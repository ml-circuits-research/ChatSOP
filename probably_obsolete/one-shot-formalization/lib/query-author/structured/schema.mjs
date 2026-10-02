// The JSON surface is intentionally smaller than DS014. All open-class strings are
// request-local choices; the runtime validator remains authoritative for SOP.
export const VARIABLES = Object.freeze(['?x', '?y', '?z', '?v', '?w', '?t', '?t1', '?t2', '?who', '?where', '?n', '?member', '?group', '?left', '?right']);
const object = properties => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
const choice = values => ({type: 'string', enum: values});
const array = (items, maxItems = 12, minItems = 0) => ({type: 'array', items, minItems, maxItems});
const nullable = schema => ({anyOf: [schema, {type: 'null'}]});

export function circuitSchema(candidates) {
  const predicates = candidates.predicates.map(p => p.id);
  const ref = name => ({$ref: `#/$defs/${name}`});
  const term = {anyOf: [
    object({kind: choice(['variable']), value: choice(VARIABLES)}),
    ...(candidates.entities.length ? [object({kind: choice(['entity']), value: choice(candidates.entities)})] : []),
    ...(candidates.numbers.length ? [object({kind: choice(['number']), value: {type: 'integer', enum: candidates.numbers}})] : []),
    ...(candidates.times.length ? [object({kind: choice(['time']), value: choice(candidates.times)})] : [])
  ]};
  const match = {anyOf: candidates.predicates.map(p => object({predicate: choice([p.id]), polarity: choice(['affirmed', 'negated']), roles: array(object({name: choice([...new Set([...p.roles.map(r => r.name), 'time'])]), value: ref('term')}), 4, 1)}))};
  const shallow = object({op: choice(['all', 'any']), matches: array(ref('match')), groups: array(object({op: choice(['all', 'any']), matches: array(ref('match'))}), 8)});
  const comparison = object({left: choice(VARIABLES), comparator: choice(['above', 'below', 'at_least', 'at_most', 'equal', 'not_equal']), right: ref('term')});
  const alternatives = object({op: choice(['all', 'any']), items: array(ref('comparison'), 12, 1)});
  const positive = candidates.numbers.filter(n => n > 0 && n <= 999);
  const cut = object({kind: choice(positive.length ? ['all', 'position', 'top'] : ['all']), value: positive.length ? nullable({type: 'integer', enum: positive}) : {type: 'null'}});
  const numericTerm = {anyOf: [
    object({kind: choice(['variable']), value: choice(VARIABLES)}),
    ...(candidates.numbers.length ? [object({kind: choice(['number']), value: {type: 'integer', enum: candidates.numbers}})] : [])
  ]};
  const expression = object({first: ref('numericTerm'), rest: array(object({op: choice(['plus', 'minus', 'times', 'divided_by']), term: ref('numericTerm')}), 8)});
  const numericComparison = object({left: ref('expression'), comparator: choice(['above', 'below', 'at_least', 'at_most', 'equal', 'not_equal']), right: ref('expression')});
  const query = (kind, extra = {}) => object({kind: choice([kind]), where: ref('group'), ...extra});
  const forms = [
    ...(predicates.length ? [
      query('lookup', {select: choice(VARIABLES)}),
      query('count', {select: choice(VARIABLES)}),
      query('rank', {select: choice(VARIABLES), value: choice(VARIABLES), direction: choice(['highest', 'lowest']), cut: ref('cut'), options: nullable(ref('alternatives'))}),
      query('compare', {select: nullable(choice(VARIABLES)), tests: ref('alternatives')}),
      query('exists'),
      query('every', {scope: ref('group'), select: nullable(choice(VARIABLES)), quantifier: choice(positive.length ? ['all', 'none', 'not_all', 'most', 'half', 'at_least'] : ['all', 'none', 'not_all', 'most', 'half']), threshold: positive.length ? nullable({type: 'integer', enum: positive}) : {type: 'null'}}),
      query('chain', {select: choice(VARIABLES)}),
      query('temporal', {select: nullable(choice(VARIABLES)), time: candidates.times.length ? nullable(choice(candidates.times)) : {type: 'null'}, period: choice(candidates.times.length ? ['none', 'at', 'during', 'asof'] : ['none']), measure: choice(['none', 'start', 'end', 'duration']), order: nullable(object({left: choice(VARIABLES), relation: choice(['before', 'after', 'same_time']), right: choice(VARIABLES)}))})
    ] : []),
    object({kind: choice(['numeric']), variables: array(object({name: choice(VARIABLES), min: candidates.numbers.length ? nullable({type: 'integer', enum: candidates.numbers}) : {type: 'null'}, max: candidates.numbers.length ? nullable({type: 'integer', enum: candidates.numbers}) : {type: 'null'}}), 8, 1), requirements: array(ref('numericComparison')), claim: nullable(ref('numericComparison')), task: choice(['possible', 'prove', 'optimize']), objective: nullable(ref('expression')), direction: nullable(choice(['min', 'max'])), select: array(choice(VARIABLES), 8)}),
    object({kind: choice(['unclear']), reason: choice(['gibberish', 'no_request', 'relation_not_in_memory'])})
  ];
  return {...object({circuit: {anyOf: forms}}), $defs: {term, numericTerm, expression, numericComparison, ...(predicates.length ? {match, group: shallow, comparison, alternatives, cut} : {})}};
}
