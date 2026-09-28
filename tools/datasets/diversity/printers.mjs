/** Target printers: surface IR → target text. The registry is pluggable (`registerPrinter`), so a change of
 * the SOP surface is a new printer, not a generator change.
 *
 * `strings` follows the grammar of sop/parser.mjs (DS021): `stated`/`assumed` with a quoted `relation`
 * phrase, closed-role `role NAME "value"` lines, `polarity`, optional `valid on|from|until "text"`, then
 * `certainty`/`speaker` (stated) or `basis` (assumed); `unclear` with `kind`, alone; a `query` whose `where`
 * holds one `match … end` block or an `all` group of them, with `select`, `mode`, `measure`, `filter`, a
 * `scope` block for `mode every` and `at|during|asof "text"`; `constraint` with `task`. Values are quoted exactly as written in the message.
 */
import { validateSurface } from './ir.mjs';

const validLines = (p, indent) => Object.entries(p.valid ?? {}).map(([form, text]) => `${indent}valid ${form} ${text}`);
const propositionLines = (p, indent = '  ', { validity = true } = {}) => [`${indent}relation ${JSON.stringify(p.relation)}`, ...p.roles.map(([role, value]) => `${indent}role ${role} ${value}`), `${indent}polarity ${p.polarity}`, ...(validity ? validLines(p, indent) : [])];
const matchBlock = (p, indent) => [`${indent}match`, ...propositionLines(p, indent + '  ', { validity: false }), `${indent}end`];

const condition = (key, props) => props.length === 1 ? [`  ${key} match`, ...propositionLines(props[0], '    ', { validity: false }), '  end'] : [`  ${key} all`, ...props.flatMap(p => matchBlock(p, '    ')), '  end'];
const queryWire = (q, id) => {
  const variables = q.props.some(p => p.roles.some(([, v]) => v.startsWith('?')));
  const lines = [`@${id} query`];
  if (q.ask === 'count') lines.push('  mode count');
  else if (q.ask === 'every') lines.push('  mode every');
  else if (q.ask === 'explain') lines.push('  mode explain');
  else if (q.ask === 'whether' && variables) lines.push('  mode exists');
  if (q.asof) lines.push(`  asof ${q.asof}`);
  if (q.select?.length) lines.push(`  select ${q.select.join(' ')}`);
  if (q.measure) lines.push(`  measure ${q.measure}`);
  lines.push(...condition('where', q.props));
  if (q.scope?.length) lines.push(...condition('scope', q.scope));
  for (const filter of q.filter ?? []) lines.push(`  filter ${filter}`);
  const time = q.time ?? q.props.find(p => p.queryTime)?.queryTime;
  if (time?.at) lines.push(`  at ${time.at}`);
  if (time?.during) lines.push(`  during ${time.during}`);
  return lines.join('\n');
};

const PRINTERS = new Map();
/** Register a printer: `print(row) → {target: string|null, format, provisional: [..], lossy: [..]}`; `row`
 * carries `surface` (surface IR) and `canon` (canonical IR). */
export function registerPrinter(name, print) { PRINTERS.set(name, print); }
export const printerNames = () => [...PRINTERS.keys()];
export function printTarget(name, row) {
  const printer = PRINTERS.get(name);
  if (!printer) throw Error(`Unknown printer ${name}; registered: ${printerNames().join(', ')}`);
  return printer(row);
}

registerPrinter('strings', ({ surface }) => {
  const ir = validateSurface(surface);
  if (ir.unclear) return { target: `@u unclear\n  kind ${ir.unclear.kind}\n${(ir.unclear.readings ?? []).map(r => `  reading ${r}\n`).join('')}`, format: 'strings', provisional: [] };
  const wires = [], provisional = new Set();
  ir.stated.forEach((p, i) => wires.push([`@s${i + 1} stated`, ...propositionLines(p), `  certainty ${p.certainty}`, ...(p.speaker ? [`  speaker ${p.speaker}`] : [])].join('\n')));
  ir.assumed.forEach((p, i) => wires.push([`@a${i + 1} assumed`, ...propositionLines(p), ...(p.basis ? [`  basis ${p.basis}`] : [])].join('\n')));
  if (ir.query) wires.push(queryWire(ir.query, 'q'));
  (ir.moreQueries ?? []).forEach((q, n) => wires.push(queryWire(q, `q${n + 2}`)));
  if (ir.constraint) {
    const c = ir.constraint;
    wires.push([`@c constraint`, ...c.vars.map(([name, lo, hi]) => `  var ${name} int ${lo} ${hi}`), ...c.require.map(e => `  require ${e}`), `  claim ${c.claim}`, `  task ${c.task}`, ...(c.select?.length ? [`  select ${c.select.join(' ')}`] : [])].join('\n'));
  }
  return { target: wires.join('\n\n') + '\n', format: 'strings', provisional: [...provisional] };
});
