/** Distillation layer interfaces (DS022 "LLM diversification", layer 2). NOT RUN YET: it waits for the new target
 * format (clause chaining and Romanian normalization, owner decisions D1 and L1-L6), so a format must be
 * registered before `distill` does anything.
 *
 * Flow, per phenomenon brief:
 *   1. a writer call turns a brief (a phenomenon from the DS022 family list or the 34-gap list, a register, a
 *      language, a length band; never a wild or OOD row, persona or annotation example) into realistic messages;
 *   2. two independent formalizer calls (different prompts or samples) write targets in the registered format;
 *   3. a row is kept only when both targets are exactly equal after the format's canonicalization AND the format's
 *      checks pass: parser, vocabulary, value anchoring in the message, and execution in a verification world;
 *   4. surviving messages then pass the same no-copy checks as paraphrases (source datasets and sealed suites) and
 *      carry `generation_trace.method = llm-distillation` provenance.
 *
 * A target format plugs in with `registerTargetFormat(name, format)`, where `format` provides:
 *   - `formalizerSystem`: the system prompt of the formalizer calls (message-only input, DS021 rule);
 *   - `canonicalize(text)`: the canonical printed program used for exact agreement;
 *   - `check({message, target})`: async, resolves to {ok, problems[], world?, expected?}, running the parser,
 *     the vocabulary, the anchoring guard and execution against a world the format can build for the message.
 */
const FORMATS = new Map();

export function registerTargetFormat(name, format) {
  for (const key of ['formalizerSystem', 'canonicalize', 'check']) if (!format?.[key]) throw Error(`target format ${name} lacks ${key}`);
  FORMATS.set(name, format);
}
export const targetFormats = () => [...FORMATS.keys()];

/** A brief is data, not text to copy: {phenomenon, language, register, length_band, count}. */
export function writerUser(brief) {
  return `PHENOMENON: ${brief.phenomenon}\nLANGUAGE: ${brief.language}\nREGISTER: ${brief.register}\nLENGTH: ${brief.length_band}\nN: ${brief.count}`;
}

/**
 * Run the layer for a list of briefs. `client` is a haiku.mjs client; `writerSystem` the writer prompt.
 * Returns {kept, rejected} with per-row reasons. Throws while no target format is registered.
 */
export async function distill({client, briefs, format: name, writerSystem, parse}) {
  const format = FORMATS.get(name);
  if (!format) throw Error(`distillation waits for a target format; registered: ${targetFormats().join(', ') || 'none'}`);
  const kept = [], rejected = [];
  for (const brief of briefs) {
    const written = await client.complete({system: writerSystem, user: writerUser(brief), purpose: 'distill-writer'});
    for (const message of parse(written.text) ?? []) {
      const [a, b] = await Promise.all([0, 1].map(sample => client.complete({system: format.formalizerSystem, user: message, purpose: 'distill-formalize', sample})));
      const first = format.canonicalize(a.text), second = format.canonicalize(b.text);
      if (first !== second) { rejected.push({message, reason: 'formalizations disagree'}); continue; }
      const verdict = await format.check({message, target: first});
      (verdict.ok ? kept : rejected).push({message, target: first, brief, ...verdict});
    }
  }
  return {kept, rejected};
}
