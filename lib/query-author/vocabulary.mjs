/**
 * The vocabulary a query author sees (DS031 "codingAgentQuery"): the predicates of ONE base memory's lexicon with their roles, phrases
 * and glosses, and its classes. Never the entities: names stay strings in the query and the KnowledgeLinker joins them to the memory
 * afterwards (there can be tens of thousands of them). The rendering is bounded: when the memory declares more predicates than the
 * budget allows, the ones with the most stored facts come first and the text says that the list was cut.
 */
const MAX_ALIASES = 6;
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function predicateLine(p) {
  const roles = (p.roles?.length ? p.roles : (p.args ?? []).map((type, i) => ({name: ['subject', 'object'][i] ?? 'arg' + i, type})))
    .map(r => `${r.name}:${r.type ?? 'entity'}`).join(', ');
  const forms = [];
  for (const phrase of [...Object.values(p.labels ?? {}), ...(p.aliases ?? []).map(a => a.surface)]) {
    const f = clean(phrase);
    if (f && !forms.includes(f)) forms.push(f);
  }
  const shown = forms.slice(0, MAX_ALIASES).map(f => JSON.stringify(f)).join(' | ');
  const gloss = clean(p.description);
  return `- ${p.id} (${roles}) ${shown}${gloss ? ' - ' + gloss : ''}`;
}

/** `{text, predicates, shown, truncated, bytes}`; `maxBytes` bounds the rendering (default 90 kB, about 25k tokens). */
export function renderVocabulary(lexicon, {maxBytes = 90_000} = {}) {
  const all = Object.values(lexicon?.predicates ?? {});
  const ranked = [...all].sort((a, b) => (b.factCount ?? 0) - (a.factCount ?? 0) || a.id.localeCompare(b.id));
  const classes = Object.values(lexicon?.classes ?? {}).map(c => clean(c.labels?.en ?? c.id)).filter(Boolean);
  const head = `# Vocabulary of the memory (${all.length} predicates)\n\nEach line: predicate id (role:class, ...) the phrases that name it - gloss.\nWrite \`relation\` with one of the quoted phrases and only the roles listed; the id itself is never written.\n\n`;
  const tail = classes.length ? `\n\n## Classes\n\n${classes.slice(0, 200).join(', ')}\n` : '\n';
  const lines = [];
  let bytes = Buffer.byteLength(head) + Buffer.byteLength(tail) + 200;
  for (const p of ranked) {
    const line = predicateLine(p);
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > maxBytes) break;
    lines.push(line);
  }
  const truncated = lines.length < all.length;
  const note = truncated ? `\n\n(The list is cut: ${lines.length} of ${all.length} predicates are shown, those with the most stored facts first. A relation that is not listed may still exist; write the natural lemma and say so in report.md.)` : '';
  return {text: head + lines.join('\n') + note + tail, predicates: all.length, shown: lines.length, truncated, bytes};
}
