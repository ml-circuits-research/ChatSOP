/** Keyboard geometry for typo costs: US QWERTY plus the Romanian standard layout (SR 13392:2004: ă î â right of P,
 * ș ț right of L). The Romanian programmer layout types diacritics with AltGr on the base letter, so a missed or
 * wrong AltGr is a diacritic substitution (see `DIACRITIC_BASE`), not a key neighbour.
 */
const ROWS = [
  {keys: 'qwertyuiopăîâ', offset: 0},
  {keys: 'asdfghjklșț', offset: 0.25},
  {keys: 'zxcvbnm', offset: 0.75},
];

const POSITION = new Map();
ROWS.forEach(({keys, offset}, row) => [...keys].forEach((key, column) => POSITION.set(key, {row, x: column + offset})));
POSITION.set('ş', POSITION.get('ș'));
POSITION.set('ţ', POSITION.get('ț'));

/** Diacritic letter -> base letter, for Romanian (comma and cedilla forms). */
export const DIACRITIC_BASE = new Map([['ă', 'a'], ['â', 'a'], ['î', 'i'], ['ș', 's'], ['ş', 's'], ['ț', 't'], ['ţ', 't']]);

export function foldDiacritics(word) {
  let out = '';
  for (const char of word) out += DIACRITIC_BASE.get(char) ?? char;
  return out;
}

/** True when two keys touch on the layouts above (same row, or the row above/below within one key width). */
export function adjacentKeys(a, b) {
  const p = POSITION.get(a), q = POSITION.get(b);
  if (!p || !q || a === b) return false;
  if (p.row === q.row) return Math.abs(p.x - q.x) <= 1.01;
  return Math.abs(p.row - q.row) === 1 && Math.abs(p.x - q.x) <= 1.01;
}

/** True when two letters differ only by a Romanian diacritic (a/ă/â, i/î/â, s/ș/ş, t/ț/ţ). */
export function diacriticVariants(a, b) {
  if (a === b) return false;
  const fa = DIACRITIC_BASE.get(a) ?? a, fb = DIACRITIC_BASE.get(b) ?? b;
  return fa === fb || (a === 'â' && b === 'î') || (a === 'î' && b === 'â');
}
