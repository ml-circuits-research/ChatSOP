/** Vocabulary lists of LanguageProofingLLM iteration 3 (experiment train-language-proofing-gemma270m-it3). Matching is on the English side of a pair (prompt or target), inflections included. */
export const TRAINED_TEN = {
  cousin: /\bcousins?\b/i, niece: /\bnieces?\b/i, uncle: /\buncles?\b/i, tenant: /\btenants?\b/i, supervisor: /\bsupervisors?\b/i, tutor: /\b(tutors?|tutored|tutoring)\b/i,
  owe: /\b(owes?|owed|owing)\b/i, adopt: /\b(adopts?|adopted|adopting|adoption)\b/i, audit: /\b(audits?|audited|auditing)\b/i, boatyard: /\bboatyards?\b/i,
};
/** New held-out words of iteration 3: removed from train entirely, they feed `dev-heldout-v3` (the next generalization probe). Chosen before looking at any model output: two family/work nouns, a verb pair, three places, one cognate-like word each side of the difficulty range. */
export const HELD_OUT_V3 = {
  nephew: /\bnephews?\b/i, landlord: /\blandlords?\b/i, contractor: /\bcontractors?\b/i, postpone: /\b(postpones?|postponed|postponing)\b/i,
  reject: /\b(rejects?|rejected|rejecting)\b/i, bakery: /\b(bakery|bakeries)\b/i, warehouse: /\bwarehouses?\b/i, pharmacy: /\b(pharmacy|pharmacies)\b/i,
};
export const anyMatch = (table, text) => Object.keys(table).find(word => table[word].test(text)) ?? null;
export const matchesAny = (table, ...texts) => texts.some(t => anyMatch(table, t ?? ''));
