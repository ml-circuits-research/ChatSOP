/**
 * The vocabulary text a query author sees (DS031 "codingAgentQuery: vocabulary"): lines for predicates, entity hints and the full list.
 * Predicates are written BY ID. Entities are never listed in bulk: only the hints for the names of the message (retrieval.mjs).
 */
const MAX_FORMS = 6;
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

export function rolesOf(p) {
  return (p.roles?.length ? p.roles : (p.args ?? []).map((type, i) => ({name: ['subject', 'object'][i] ?? 'arg' + i, type}))).map(r => `${r.name}:${r.type ?? 'entity'}`).join(', ');
}

export function predicateLine(p, {phrases = true} = {}) {
  const forms = [];
  for (const phrase of [...Object.values(p.labels ?? {}), ...(p.aliases ?? []).map(a => a.surface)]) {
    const f = clean(phrase);
    if (f && !forms.includes(f)) forms.push(f);
  }
  const shown = phrases ? ' ' + forms.slice(0, MAX_FORMS).map(f => JSON.stringify(f)).join(' | ') : '';
  const gloss = clean(p.description);
  return `- ${p.id} (${rolesOf(p)})${shown}${gloss ? ' - ' + gloss : ''}`;
}

/** The candidate predicates as markdown. `candidates`: [{id}] from retrieval.mjs. */
export function renderCandidates(lexicon, candidates, {phrases = true} = {}) {
  const lines = candidates.map(c => lexicon.predicates[c.id]).filter(Boolean).map(p => predicateLine(p, {phrases}));
  return `# Candidate predicates for this request\n\nEach line: predicate id (role:class, ...) the phrases that name it - gloss. Write the ID in \`relation\`, with only the roles listed. They are selected by matching the request against the memory; if none of them means what the request asks, say so with \`unclear\` (kind relation_not_in_memory).\n\n${lines.join('\n') || '(no candidate matched)'}\n`;
}

/**
 * The ids of the predicates that are not candidates, with their roles in a compact form, for the model to pick from when retrieval missed the sense
 * ("people" for `population_of`). Bounded: the predicates with the most stored facts first, at most `max`.
 */
export function renderIndex(lexicon, candidates, {max = 300} = {}) {
  const shown = new Set(candidates.map(c => c.id));
  const rest = Object.values(lexicon?.predicates ?? {}).filter(p => !shown.has(p.id)).sort((a, b) => (b.factCount ?? 0) - (a.factCount ?? 0) || a.id.localeCompare(b.id));
  if (!rest.length) return '';
  const list = rest.slice(0, max).map(p => `${p.id}(${(p.roles ?? []).map(r => r.name).join(',')})`);
  return `\n## Other predicates of the memory (id and role names only)\n\nUse one of these only when none of the candidates above means what the request asks; the component checks its roles.${rest.length > max ? ` (${max} of ${rest.length} shown)` : ''}\n\n${list.join(' ')}\n`;
}

/** The entity hints as markdown: per name of the request, the memory's candidate entities. */
export function renderEntityHints(mentions) {
  if (!mentions.length) return '# Entity hints\n\n(no name of the request matches an entity of the memory)\n';
  const lines = mentions.map(m => `- ${JSON.stringify(m.surface)}${m.partial ? ' (a part of a name)' : ''}: ` + m.candidates.map(c => `${c.id} (${c.class ?? 'entity'}${c.description ? ', ' + c.description : ''})`).join(' | ') + (m.total > m.candidates.length ? ` | +${m.total - m.candidates.length} more` : ''));
  return `# Entity hints\n\nFor a name of the request you may write one of these entity IDS as the quoted value, but only if it is the one the request means; otherwise write the name as a string exactly as in the request and the KnowledgeLinker resolves it (a namesake is asked about, never guessed). Never write an id that is not listed here.\n\n${lines.join('\n')}\n`;
}

/** The full predicate list, bounded: ids with roles and the first phrase (an agentic backend may read it as a file). */
export function renderVocabulary(lexicon, {maxBytes = 90_000} = {}) {
  const all = Object.values(lexicon?.predicates ?? {});
  const ranked = [...all].sort((a, b) => (b.factCount ?? 0) - (a.factCount ?? 0) || a.id.localeCompare(b.id));
  const classes = Object.values(lexicon?.classes ?? {}).map(c => clean(c.labels?.en ?? c.id)).filter(Boolean);
  const head = `# Full predicate list of the memory (${all.length} predicates)\n\nEach line: predicate id (role:class, ...) the phrases that name it - gloss.\n\n`;
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
  const note = truncated ? `\n\n(The list is cut: ${lines.length} of ${all.length} predicates are shown, those with the most stored facts first.)` : '';
  return {text: head + lines.join('\n') + note + tail, predicates: all.length, shown: lines.length, truncated, bytes};
}
