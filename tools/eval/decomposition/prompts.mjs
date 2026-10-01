/** Prompts of the decomposition work (omp folders): the splitter that writes the expected decomposition of a tangled sentence, and the reverse tangler of Task 2. */
export const SPLIT_SYSTEM = `You split one tangled English message into SHORT sentences, for a dataset that teaches a grammatical analyser to read tangled text. Each input is one message. You write its decomposition: the same content as a list of short sentences, each with ONE finite clause and an explicit subject.

Rules:
1. Same meaning, nothing added and nothing dropped: keep every name, number, date, amount and quoted text exactly as written; keep negation, quantifiers (all, some, none, at most, at least, only), modality (can, should, might) and hedges (I think, maybe).
2. Keep the KIND of every part: a statement stays a statement, each question stays the same kind of question (yes/no, who, what, how many, why), a request or command stays a request or command. Never turn a question or request into a statement or the reverse.
3. Keep the connectives, as a sentence-initial word or short phrase: "But the supplier delivered binders.", "Because of this, I did not send the draft.", "If the gate is open, ..." stays "If the gate is open" only when its other clause comes right after it in the SAME sentence; otherwise write the connective as an opening adverbial ("Because of this", "After that", "Even so", "Otherwise"). Never invent a cause, time order or contrast that the message does not state.
4. Explicit subject: replace every pronoun (he, she, it, they, who, which, that, whose) by the noun or name it stands for, unless it is "I", "you" or "we".
5. A reported or hedged claim stays attached to its source and its hedge ("The shop says none were changed.", "I do not think every proof was sent."). Do not turn "I wonder whether X" or "Do you know if X" into the bare fact X; keep the frame as one sentence ("I wonder whether X.").
6. Subordinate, relative and coordinated clauses that can stand alone become their own sentences, in the original order. A list of items that share a verb may stay in one sentence when each item is a plain noun; a list of different actions or questions is split.
7. If the message really has one clause only and cannot be split without losing meaning, answer with the message unchanged as the only sentence.
8. Natural English, simple words, every sentence ends with a full stop or question mark.

Answer with one JSON object and nothing else: {"sentences": ["...", "..."]}`;

export const TANGLE_SYSTEM = `You write ONE tangled English sentence from a short group of sentences, for a dataset that teaches a very small model to split tangled sentences back into short ones. The group is the target; your sentence is the model input, so it must carry exactly the content of the group, no more, no less. Real users write long run-on sentences with relative clauses, subordinate clauses, long coordinations and lists, so produce that.

Style requested for this item is given on the first line ("style: ..."):
- subordinate: one main clause that carries the other sentences as participle phrases, "which"/"who"/"whose" clauses, appositions and prepositional embeddings, and "and" for the rest; a subordinating word (because, when, while, if, although, after, before, since, unless) ONLY when a sentence of the group already states that relation or starts with it.
- relative: fold the statements into relative clauses and appositions on the noun or name each statement is about (the shared entity), keeping a question or request as the main clause where there is one.
- participle: one main clause that carries the other facts as appositions and participle phrases about the same name or noun ("Nadia, the owner of the shop, having lost her key, called Ben"); "and" joins the rest; no subordinating word that the group does not state.
- list_coordination: one run-on sentence that coordinates 3 to 5 actions, facts or items with commas and "and", sharing the subject where possible, or a list of questions joined with commas and "and"; a long enumeration of clauses is expected.
- multi_question: one sentence that asks all the questions of the group joined with commas and "and" (a statement of the group may be carried inside as a relative clause); every question keeps its own kind.

Rules:
1. Keep every name, number, date, amount and quoted text exactly as written; keep negation, quantifiers, modality and hedges.
2. Keep the KIND of every sentence: a statement stays a statement, a question stays the same kind of question (a question may carry statements inside it as relative clauses), a request stays a request.
3. Add no fact, no cause, no time order, no contrast; do not use a connective (because, so, then, after, before, while, although, since, unless, but) that the group does not already contain, except that "and" and relative pronouns are free. Drop nothing.
4. Do not use he, she, they, him, her, them, his, their or "it" for a named person or thing; repeat the name or use who, which, whose. "I", "you" and "we" stay.
5. Exactly ONE sentence: one final full stop or question mark and none inside. Natural English, at most 60 words.
6. If the group cannot be folded into one natural sentence without changing it, answer with an empty text.

Answer with one JSON object and nothing else: {"text": "..."}`;
