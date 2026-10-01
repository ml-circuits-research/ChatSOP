/** Canonical form of SOP text for comparing a paragraph's SOP with the concatenation of its components' SOPs
 * (DS008 "Composed evaluation suites"). Block ids (`@q`, `@q2`, `@s1`) and `$id` references to them are renamed by
 * position, so two programs that differ only in id renumbering are equal. Pure functions.
 */
const TOKEN = /"(?:\\.|[^"\\])*"|\$[A-Za-z][A-Za-z0-9_]*/g;

/** Blocks of a program: `[{id, keyword, lines}]`; a block starts at a line `@id keyword`. Text before the first block is ignored. */
export function sopBlocks(sop) {
  const blocks = [];
  for (const line of String(sop ?? '').split('\n')) {
    const head = /^@(\S+)\s*(\S*)/.exec(line);
    if (head) blocks.push({id: head[1], keyword: head[2], lines: [line]});
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }
  for (const b of blocks) while (b.lines.length && !b.lines[b.lines.length - 1].trim()) b.lines.pop();
  return blocks;
}

/**
 * Canonical blocks of the concatenation of programs. SymbolicLM emits the statements of a whole message before its queries (asserted
 * facts are read first), so the concatenation gets the same stable partition: every block that is not a `query` comes first, in
 * order, then the queries in order. Ids are renamed by position (`b0`, `b1`, ...) and `$id` references follow their block; a
 * reference to an id that no block defines is kept. Returns `{blocks, origin}`, `origin[k]` being the program index of block k.
 */
export function canonicalize(programs) {
  const items = [];
  programs.forEach((sop, p) => {
    const blocks = sopBlocks(sop);
    const local = new Map(blocks.map((b, i) => [b.id, `p${p}_${i}`]));
    blocks.forEach((b, i) => items.push({key: `p${p}_${i}`, keyword: b.keyword, origin: p, local, lines: b.lines}));
  });
  const ordered = [...items.filter(x => x.keyword !== 'query'), ...items.filter(x => x.keyword === 'query')];
  const position = new Map(ordered.map((x, k) => [x.key, `b${k}`]));
  const blocks = ordered.map((x, k) => x.lines.map((line, n) => {
    const text = n === 0 ? line.replace(/^@\S+/, `@b${k}`) : line;
    return text.replace(TOKEN, token => (token.startsWith('$') && x.local.has(token.slice(1)) ? `$${position.get(x.local.get(token.slice(1)))}` : token));
  }).join('\n'));
  return {blocks, origin: ordered.map(x => x.origin)};
}

/** Canonical blocks (strings) of one program. */
export const canonicalBlocks = sop => canonicalize([sop]).blocks;

/** Canonical blocks of the concatenation of several programs. */
export const concatCanonical = programs => canonicalize(programs).blocks;

/** Number of blocks of each program. */
export const blockCounts = programs => programs.map(sop => sopBlocks(sop).length);

/**
 * Compare a paragraph's SOP with its expected components' SOPs. `exact`: canonical blocks equal in order. `per_component[i]`:
 * the paragraph blocks at the positions of component i's blocks equal them (when the block counts line up); otherwise component i is
 * credited when all its canonical blocks, ignoring block ids, occur in the paragraph SOP (as a multiset).
 */
export function compareParagraph(actualSop, expectedPrograms) {
  const exp = canonicalize(expectedPrograms), act = canonicalBlocks(actualSop);
  const exact = exp.blocks.length === act.length && exp.blocks.every((b, i) => b === act[i]);
  const aligned = act.length === exp.blocks.length;
  const body = b => b.replace(/^@b\d+/, '@').replace(/\$b\d+/g, '$');
  const bag = new Map();
  for (const a of act) bag.set(body(a), (bag.get(body(a)) ?? 0) + 1);
  const perComponent = expectedPrograms.map((_, p) => {
    const mine = exp.blocks.map((b, k) => [b, k]).filter(([, k]) => exp.origin[k] === p);
    if (aligned) return mine.every(([b, k]) => act[k] === b);
    return mine.every(([b]) => { const n = bag.get(body(b)) ?? 0; if (n <= 0) return false; bag.set(body(b), n - 1); return true; });
  });
  return {exact, aligned, expected_blocks: exp.blocks.length, actual_blocks: act.length, per_component: perComponent};
}
