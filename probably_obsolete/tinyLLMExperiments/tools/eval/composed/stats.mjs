/** Small statistics helpers of the composed evaluation: Wilson intervals, proportions with counts, stratified stages. */
import {rngOf} from './compose.mjs';

/** Wilson 95% interval of k successes in n trials. */
export function wilson(k, n, z = 1.96) {
  if (!n) return {k, n, p: null, lo: null, hi: null};
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  const r = x => Math.round(1000 * x) / 10;
  return {k, n, p: r(p), lo: r(Math.max(0, (c - m) / d)), hi: r(Math.min(1, (c + m) / d))};
}

/** Group counts: `rate(items, strataOf, predicate)` gives `{all, by: {stratum: wilson}}`. */
export function rateBy(items, strataOf, predicate) {
  const groups = new Map();
  for (const item of items) { const s = strataOf(item); const g = groups.get(s) ?? {k: 0, n: 0}; g.n++; if (predicate(item)) g.k++; groups.set(s, g); }
  const all = {k: [...groups.values()].reduce((a, g) => a + g.k, 0), n: items.length};
  return {all: wilson(all.k, all.n), by: Object.fromEntries([...groups].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, {numeric: true})).map(([s, g]) => [s, wilson(g.k, g.n)]))};
}

/** Stratified nested stages: `stages(items, strataOf, sizes, seed)` -> [{size, ids}], every stage a superset of the previous one. */
export function stagesOf(items, strataOf, sizes, seed = 'stages') {
  const rng = rngOf(seed);
  const byStratum = new Map();
  for (const item of items) { const s = strataOf(item); (byStratum.get(s) ?? byStratum.set(s, []).get(s)).push(item); }
  const queues = [...byStratum.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([, list]) => rng.shuffle(list));
  const order = [];
  for (let i = 0; queues.some(q => i < q.length); i++) for (const q of queues) if (i < q.length) order.push(q[i]);
  return [...sizes.filter(n => n < items.length), items.length].map(size => ({size, items: order.slice(0, size)}));
}
