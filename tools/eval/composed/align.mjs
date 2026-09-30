/** Alignment of a rewriter's output with the expected components of a composed case (DS008 "Composed evaluation suites").
 *
 * Each component has an original text and an expected text (the same for a sentence that must stay untouched, the verified target
 * for one that must be rewritten). The output is searched, in component order, for the expected text of every component.
 * Statuses: `preserved` (untouched, as required), `repaired` (rewritten to its target), `broken` (a sentence that had to stay
 * untouched changed), `not_repaired` (a sentence that needed a rewrite came back unchanged), `wrong_rewrite` (a sentence that
 * needed a rewrite came back as something else), `dropped` (no text left for it). Extra text between components is `added`.
 * `order_ok` is false when a component's expected text occurs only before an earlier component's. Pure functions.
 */
import {splitSentences} from '../../../lib/sentence-split.mjs';

export const normSpace = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const meaningful = text => /[\p{L}\p{N}]/u.test(text);

export function alignRewrite(components, output) {
  const out = normSpace(output);
  const expected = components.map(c => normSpace(c.expected_text)), original = components.map(c => normSpace(c.text));
  const anchors = new Array(components.length).fill(null);
  let cursor = 0;
  components.forEach((c, i) => {
    let at = out.indexOf(expected[i], cursor), form = 'expected';
    if (at < 0 && c.must_change) { at = out.indexOf(original[i], cursor); form = 'original'; }
    if (at >= 0) { anchors[i] = {start: at, end: at + (form === 'expected' ? expected[i] : original[i]).length, form}; cursor = anchors[i].end; }
  });
  const status = new Array(components.length);
  let added = 0, dropped = 0, orderOk = true;
  components.forEach((c, i) => { if (anchors[i]) status[i] = anchors[i].form === 'expected' ? (c.must_change ? 'repaired' : 'preserved') : 'not_repaired'; });
  // Gaps: the text between resolved anchors holds the unresolved components between them.
  let prevEnd = 0, pending = [];
  const flush = (gapEnd) => {
    const gap = out.slice(prevEnd, gapEnd);
    const text = meaningful(gap) ? gap.trim() : '';
    const units = text ? splitSentences(text).length : 0;
    if (pending.length) {
      pending.forEach((i, k) => {
        if (k < units) status[i] = components[i].must_change ? 'wrong_rewrite' : 'broken';
        else { status[i] = 'dropped'; dropped++; }
      });
      if (units > pending.length) added += units - pending.length;
    } else if (units) added += units;
    pending = [];
  };
  components.forEach((c, i) => {
    if (anchors[i]) { flush(anchors[i].start); prevEnd = anchors[i].end; } else pending.push(i);
  });
  flush(out.length);
  // Order: an unresolved component whose expected text occurs anywhere else in the output was moved.
  components.forEach((c, i) => { if (!anchors[i] && out.includes(expected[i]) && expected[i]) { orderOk = false; } });
  const count = name => status.filter(s => s === name).length;
  const exact = out === normSpace(components.map(c => c.expected_text).join(' '));
  return {status, exact, order_ok: orderOk, added_units: added, dropped: count('dropped'), preserved: count('preserved'), repaired: count('repaired'), broken: count('broken'), not_repaired: count('not_repaired'), wrong_rewrite: count('wrong_rewrite')};
}
