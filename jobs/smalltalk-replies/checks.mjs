/**
 * Checks of smalltalk-replies (pure functions over the parsed JSON lines; structure only, never a reading of the user's words):
 * every requested register has at least `count` variants and no other register appears; each text is non-empty, within the
 * length, uses only the placeholders the situation allows and all it requires (and ends as the situation's shape says); no
 * URL, no long digit run (a phone number or a date would be an invented fact), no braces besides placeholders, no exact
 * duplicate inside the item. The meaning (tone, honesty, safety) is the auditor's job.
 */
const SLOT = /\{\{([a-z][a-z0-9_]*)\}\}/g;
export const norm = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9{} ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function check(item, output) {
  const d = item.data ?? item;
  const problems = [];
  const recs = (output.records ?? []).filter(r => r && typeof r.text === 'string');
  const seen = new Map();
  const per = {};
  for (const r of recs) {
    const text = r.text.trim();
    const tag = `${r.register}: "${text.slice(0, 60)}"`;
    if (!d.registerNames.includes(r.register)) { problems.push(`${tag}: register ${r.register} was not requested (${d.registerNames.join(', ')})`); continue; }
    per[r.register] = (per[r.register] ?? 0) + 1;
    if (!text) { problems.push(`${r.register}: empty text`); continue; }
    if (text.length > d.maxLen) problems.push(`${tag}: ${text.length} characters, the limit is ${d.maxLen}`);
    const used = [...text.matchAll(SLOT)].map(m => m[1]);
    for (const s of used) if (!d.allowed.includes(s)) problems.push(`${tag}: placeholder {{${s}}} is not allowed here${d.allowed.length ? ` (allowed: ${d.allowed.join(', ')})` : ' (none is allowed)'}`);
    for (const s of d.required) if (!used.includes(s)) problems.push(`${tag}: the placeholder {{${s}}} is required`);
    if (/[{}]/.test(text.replace(SLOT, ''))) problems.push(`${tag}: braces outside a placeholder`);
    if (d.ends && !text.endsWith(d.ends)) problems.push(`${tag}: must end with ${JSON.stringify(d.ends)}`);
    if (/https?:|www\.|\.(com|org|net)\b/i.test(text)) problems.push(`${tag}: no web addresses`);
    if (/\d[\d\s-]{2,}\d/.test(text.replace(SLOT, ''))) problems.push(`${tag}: no numbers of three or more digits (no phone numbers, dates or figures)`);
    const key = norm(text);
    if (seen.has(key)) problems.push(`${tag}: exact duplicate of another variant`);
    seen.set(key, true);
  }
  for (const reg of d.registerNames) if ((per[reg] ?? 0) < d.count) problems.push(`register ${reg}: ${per[reg] ?? 0} variants, ${d.count} are needed`);
  if (!problems.length) return {ok: true, value: recs.length};
  return {ok: false, problems: problems.slice(0, 12), hint: `Write exactly ${d.count} variants for each of: ${d.registerNames.join(', ')}; use only the placeholders listed; stay within ${d.maxLen} characters.`};
}
