/**
 * Prints the UD → SOP analysis (analyze.mjs) as SOP Lang model output (DS021): one keyword per line, JSON-quoted
 * strings, `?variables`, `$id` references and link lines, `match … end` blocks, `unparsed` spans.
 */
const quote = value => JSON.stringify(String(value));
/** A role value: `?var`, `$id`, a plain safe integer (C11), or a JSON-quoted string. */
export const term = value => {
  const text = String(value);
  if (/^[?$][A-Za-z][A-Za-z0-9_]*$/.test(text)) return text;
  if (/^-?\d{1,15}$/.test(text) && Number.isSafeInteger(Number(text)) && !/^-?0\d/.test(text)) return text;
  return quote(text);
};

function propositionLines(p, indent) {
  const pad = ' '.repeat(indent);
  return [...(p.relation ? [pad + 'relation ' + quote(p.relation)] : []), ...p.roles.map(r => pad + 'role ' + r.name + ' ' + term(r.value)), pad + 'polarity ' + p.polarity];
}

function block(p, indent, keyword) {
  const pad = ' '.repeat(indent);
  return [pad + keyword + ' match', ...propositionLines(p, indent + 2), pad + 'end'];
}

function where(blocks, indent) {
  const pad = ' '.repeat(indent);
  if (blocks.length === 1) return block(blocks[0], indent, 'where');
  return [pad + 'where all', ...blocks.flatMap(b => [pad + '  match', ...propositionLines(b, indent + 4), pad + '  end']), pad + 'end'];
}

const links = wire => (wire.links ?? []).map(([keyword, target]) => '  ' + keyword + ' $' + target);

/** One wire as SOP text. */
export function emitWire(w) {
  const head = '@' + w.id + ' ' + w.type;
  if (w.type === 'stated') {
    const valid = Object.entries(w.valid ?? {}).map(([form, text]) => '  valid ' + form + ' ' + quote(text));
    return [head, ...propositionLines(w, 2).slice(0, -1), ...valid, '  polarity ' + w.polarity, '  certainty ' + w.certainty, ...(w.speaker ? ['  speaker ' + quote(w.speaker)] : []), ...links(w)].join('\n');
  }
  if (w.type === 'assumed') return [head, ...propositionLines(w, 2), ...(w.basis ? ['  basis ' + w.basis] : []), ...links(w)].join('\n');
  if (w.type === 'query') {
    return [head, ...(w.fragment ? ['  fragment ' + w.fragment] : []), ...(w.mode ? ['  mode ' + w.mode] : []), ...(w.quantifier ? ['  quantifier ' + w.quantifier] : []), ...(w.select?.length ? ['  select ' + w.select.join(' ')] : []), ...(w.measure ? ['  measure ' + w.measure] : []),
      ...(w.rank ? ['  rank ' + w.rank.join(' ')] : []), ...where(w.blocks, 2), ...(w.scope ? block(w.scope, 2, 'scope') : []),
      ...(w.compares ?? []).map(([v, op, n]) => '  compare ' + v + ' ' + op + ' ' + (String(n).startsWith('?') ? n : term(n))), ...(w.excepts ?? []).map(([v, value]) => '  except ' + v + ' ' + quote(value)), ...(w.order ? ['  order ' + w.order.join(' ')] : []),
      ...(w.during ? ['  during ' + quote(w.during)] : []), ...(w.at ? ['  at ' + quote(w.at)] : []), ...links(w)].join('\n');
  }
  if (w.type === 'unparsed') return [head, '  span ' + quote(w.span), ...(w.near ? ['  near $' + w.near] : []), ...(w.hint ? ['  hint ' + w.hint] : [])].join('\n');
  if (w.type === 'unclear') return [head, '  kind ' + w.kind].join('\n');
  throw Error('Cannot emit wire type ' + w.type);
}

const ORDER = {unclear: 0, stated: 1, assumed: 2, query: 3, constraint: 4, unparsed: 5};
/** The whole output: statements, assumptions, queries, then unparsed spans, each group in creation order. */
export function emitProgram(wires) {
  return wires.map((w, i) => [w, i]).sort((a, b) => (ORDER[a[0].type] - ORDER[b[0].type]) || a[1] - b[1]).map(([w]) => emitWire(w)).join('\n\n') + '\n';
}
