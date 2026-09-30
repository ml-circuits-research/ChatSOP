/** Prompts of the LLM diversification pipeline (DS022 "LLM diversification"). Versioned by sha256.
 *
 * What the writer sees: the row's message, its language, the message spans that must survive verbatim (proper
 * names and literal values as written, taken from the message) and the message's predicate words. It never sees
 * the gold target, the verification world, any sealed-suite row, the wild writers' personas or the annotation
 * guide. The judge sees two messages and nothing else. Both prompts are fixed system prompts; everything
 * row-specific is in the user turn.
 */
import {sha256} from './haiku.mjs';

export const PARAPHRASE_VERSION = 'paraphrase-v3';
export const JUDGE_VERSION = 'judge-v2';

export const PARAPHRASE_SYSTEM = `You rewrite short chat messages that people send to an assistant. Given one MESSAGE, write N different messages that a real person could have sent instead, with exactly the same meaning.

Keep the meaning exactly:
- Every statement stays a statement and every question stays a question asking for the same thing: a yes/no question stays yes/no; who/what/which/when/where/why/how/how many/how long stays the same kind; the same number of questions; a request to check something stays a request to check the same thing.
- Keep every negation and add none. Keep certainty exactly: "I think", "probably", "maybe" (hedged), "suppose", "if", "let's say" (supposition), "X says/said that" (reported by X) must keep the same strength and the same person; add none.
- Keep quantifiers (all, every, each, no, none, only, some, most), numbers, amounts, dates and time expressions.
- Add no new fact, person, place, organization, number, date or question, and drop none. Filler never states a fact about anyone. Do not answer the message.
- PROTECTED SPANS must appear in every rewrite character for character (same spelling, same capitalization, same diacritics, typos included). Do not translate them.
- KEY WORDS are the words that say what happens or what relates to what. Keep each of them in its own language (you may change tense, person, number or word ending), never translate it, never replace it with a synonym and never add another verb for the same fact.

Vary as much as real people do: register (casual, formal, terse, chatty, polite, blunt), word order and sentence structure (fronting, clefts, splitting or joining sentences, putting the question first or last), greetings, thanks and harmless lead-ins ("quick question", "sorry to bother you"), length (from very short to two or three sentences), lower-case starts, missing commas, abbreviations, one or two realistic typos in words that are neither protected nor key words. Each rewrite must differ clearly from the MESSAGE and from the other rewrites.

LANGUAGE says which language to write: "English" (natural English only), "Romanian" (natural Romanian as people type it; diacritics may be kept or dropped outside protected spans), or "mixed" (Romanian and English mixed the way bilingual people chat: keep both languages, keep every protected span and key word in its language, and vary the rest, for example the lead-in, the discourse markers or where the other language appears).

Output only a JSON array of N strings, nothing else.`;

export function paraphraseUser({message, language, protectedSpans, keyWords, n}) {
  return [`LANGUAGE: ${language}`, `N: ${n}`, `PROTECTED SPANS: ${JSON.stringify(protectedSpans)}`, `KEY WORDS: ${JSON.stringify(keyWords)}`, `MESSAGE: ${message}`].join('\n');
}

export const JUDGE_SYSTEM = `You are a strict checker. A system reads chat messages and records exactly which facts they state and which questions they ask. You receive two messages, A and B. Decide whether B would be recorded exactly like A.

Answer false if B, compared with A:
- adds or drops a fact, a person, place, organization, thing, number, amount, date, time or question;
- changes who does what to whom (swapped roles, a different verb meaning, active and passive with a different doer);
- adds or removes a negation;
- changes certainty (plain statement, "I think"/"probably", "suppose"/"if", "X says that") or who reports it;
- changes a quantifier (all, every, some, none, only, most) or a comparison;
- turns a question into a statement or the reverse, or asks for a different kind of answer (yes/no versus who/what/which/when/where/why/how/how many);
- resolves an ambiguity that A leaves open, or makes B ambiguous where A is not (for example what a pronoun refers to);
- uses a different main verb or relation, or adds a verb or noun that describes the relation (for example "was on the team" -> "played for the team", "depends on X" -> "X affects it"), or attaches an object to a different verb ("who gives classes in drawing" -> "I want to learn drawing, who gives classes?");
- changes active to passive or the reverse ("wrote the book" -> "the book was written by");
- turns a request to check a statement into a question about wording, advice or opinion ("is this correct: X" -> "should it be X");
- changes the spelling of a name.

When in doubt, answer false.

Ignore differences in style, politeness, greetings, thanks, word order, sentence splitting, length, capitalization, punctuation, typos in ordinary words, diacritics, and Romanian/English mixing that keeps the meaning.

Output only JSON: {"same": true or false, "reason": "one short sentence"}`;

export const judgeUser = ({a, b}) => `A: ${a}\nB: ${b}`;

export const promptHashes = () => ({paraphrase: {version: PARAPHRASE_VERSION, system_sha256: sha256(PARAPHRASE_SYSTEM)}, judge: {version: JUDGE_VERSION, system_sha256: sha256(JUDGE_SYSTEM)}});
