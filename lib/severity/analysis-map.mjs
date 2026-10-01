/**
 * Layer 2 of the severity cascade (DS016 "Graded severity"): maps the verdict of the local analysis comparison (lib/languages-util/analysis-compare.mjs,
 * `{verdict, reasons, failedChecks}`) to a severity. `equivalent` is S0 and decided; `different` is decided S4 only for the checks that are catastrophic by
 * construction (polarity flip, subject/object role swap, a name, number or strong quantifier replaced or invented, an if/unless/although/before/after
 * connective present in one text only); every other result is a hint and the pair stays in the residue for the judge.
 */
const lists = (reasons, key) => {
  const line = (reasons ?? []).find(r => r.startsWith(`${key}:`));
  if (!line) return null;
  const grab = which => { const m = new RegExp(`only in ${which} \\[([^\\]]*)\\]`).exec(line); return m && m[1].trim() ? m[1].split(',').map(x => x.trim()) : []; };
  return {onlyA: grab('a'), onlyB: grab('b'), line};
};
const STRONG_Q = new Set(['all', 'every', 'each', 'none', 'no', 'both', 'never', 'always', 'universal', 'negative']);
const CATASTROPHIC_CONNECTIVES = new Set(['if', 'unless', 'although', 'before', 'after']);

export function severityFromComparison(cmp) {
  if (!cmp) return {severity: null, decided: false, flags: [], source: 'analysis_missing'};
  if (cmp.verdict === 'equivalent') return {severity: 'S0', decided: true, flags: [], source: 'analysis_equivalent'};
  if (cmp.verdict === 'uncertain') return {severity: null, decided: false, flags: [{kind: 'uncertain', severity: null, certain: false, detail: (cmp.reasons ?? []).join('; ').slice(0, 160)}], source: 'analysis_uncertain'};
  const flags = [], add = (kind, severity, certain, detail) => flags.push({kind, severity, certain, detail});
  for (const check of cmp.failedChecks ?? []) {
    if (check === 'polarity') add('polarity', 'S4', true, (cmp.reasons ?? []).find(r => r.startsWith('polarity')) ?? '');
    else if (check === 'roles') add('roles', 'S4', true, (cmp.reasons ?? []).find(r => r.startsWith('roles')) ?? '');
    else if (check === 'names' || check === 'numbers') {
      const l = lists(cmp.reasons, check);
      if (l && l.onlyB.length) add(`${check}_added_or_replaced`, 'S4', true, l.line);
      else add(`${check}_lost`, 'S2', false, l?.line ?? check);
    } else if (check === 'quantifiers') {
      const l = lists(cmp.reasons, 'quantifiers');
      const strong = l && [...l.onlyA, ...l.onlyB].some(x => STRONG_Q.has(x));
      add('quantifiers', strong ? 'S4' : 'S3', Boolean(strong && l.onlyA.length && l.onlyB.length) || Boolean(strong && l.onlyB.length), l?.line ?? '');
    } else if (check === 'connectives') {
      const m = /\[([^\]]*)\]/.exec((cmp.reasons ?? []).find(r => r.startsWith('connectives')) ?? '');
      const items = m ? m[1].split(',').map(x => x.trim()) : [];
      const bad = items.some(x => CATASTROPHIC_CONNECTIVES.has(x));
      add('connectives', bad ? 'S4' : 'S3', bad, items.join(','));
    } else if (check === 'question') add('question', 'S3', false, (cmp.reasons ?? []).find(r => r.startsWith('question')) ?? '');
  }
  const certain = flags.filter(f => f.certain);
  if (certain.length) return {severity: 'S4', decided: true, flags, source: 'analysis_different'};
  return {severity: null, decided: false, flags, source: 'analysis_different_soft'};
}
