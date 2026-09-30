/** Deterministic, stratified choice of the source rows to paraphrase (DS022 "LLM diversification").
 *
 * Only train and dev rows are eligible (a paraphrase inherits its source row's split and split group). Families
 * whose label depends on the exact surface are excluded: `unclear` (gibberish, no request and visible ambiguity
 * are properties of the wording) and `long_message` (composed from many parts; the medium/long redesign of D4 owns
 * it). Strata are family x language slice (`en`, `ro`, `mixed`); every family gets a floor, the rest is
 * proportional, and inside a family the languages are interleaved. The order is a seeded hash, so the first k rows
 * of a sample are themselves spread over the strata (the pilot's early-stopping stage reads the first 50).
 */
import {hash32} from '../diversity/text.mjs';

export const EXCLUDED_FAMILIES = new Set(['unclear', 'long_message']);
export const languageSlice = row => row.code_switch ? 'mixed' : row.language;
const order = (seed, row) => hash32(`${seed}:${row.id}`);

export function eligible(row) {
  return ['train', 'dev'].includes(row.split) && !EXCLUDED_FAMILIES.has(row.family) && !/^@\S+\s+unclear\s*$/m.test(row.sop_target) && row.question.length <= 400;
}

/** Choose `count` rows: a floor per family, the rest proportional to family size, languages interleaved. */
export function stratifiedSample(rows, {count = 300, seed = 20260929, floor = 4} = {}) {
  const byFamily = new Map();
  for (const row of rows.filter(eligible)) {
    if (!byFamily.has(row.family)) byFamily.set(row.family, []);
    byFamily.get(row.family).push(row);
  }
  const families = [...byFamily.keys()].sort();
  const total = families.reduce((n, family) => n + byFamily.get(family).length, 0);
  const quota = Object.fromEntries(families.map(family => [family, Math.min(floor, byFamily.get(family).length)]));
  // A sample smaller than the floors keeps one family after another in seeded order.
  for (const family of [...families].sort((a, b) => hash32(`${seed}:${a}`) - hash32(`${seed}:${b}`)).reverse())
    while (Object.values(quota).reduce((a, b) => a + b, 0) > count && quota[family] > 0) quota[family]--;
  let left = count - Object.values(quota).reduce((a, b) => a + b, 0);
  const shares = families.map(family => [family, left * byFamily.get(family).length / total]);
  for (const [family, share] of shares) quota[family] += Math.max(0, Math.floor(share));
  left = count - Object.values(quota).reduce((a, b) => a + b, 0);
  for (const [family] of shares.sort((a, b) => (b[1] % 1) - (a[1] % 1))) if (left-- > 0) quota[family]++;
  const picked = [];
  for (const family of families) {
    const byLanguage = new Map();
    for (const row of byFamily.get(family).sort((a, b) => order(seed, a) - order(seed, b))) {
      const key = languageSlice(row);
      if (!byLanguage.has(key)) byLanguage.set(key, []);
      byLanguage.get(key).push(row);
    }
    const lanes = [...byLanguage.keys()].sort().map(key => byLanguage.get(key));
    for (let i = 0; picked.filter(row => row.family === family).length < quota[family] && lanes.some(lane => lane.length); i++) {
      const lane = lanes[i % lanes.length];
      if (lane.length) picked.push(lane.shift());
    }
  }
  return picked.sort((a, b) => order(`${seed}:order`, a) - order(`${seed}:order`, b));
}
