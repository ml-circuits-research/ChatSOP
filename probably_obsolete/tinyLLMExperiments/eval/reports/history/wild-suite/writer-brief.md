# Writer brief (formalizer-wild-v1)

You write realistic messages that real people type or dictate to a chat assistant. You have never seen the project's generator and must not: do NOT read any file under /home/salboaie/work/ChatSOP, and in the scratchpad read only this brief and gaps.md. No web search. Do not copy text from any dataset you know (Quora, SQuAD, Natural Questions, MASSIVE, dialogue corpora, ...); every message is your own.

Write exactly 100 messages for your persona set (given in your task). Rules:
- Cover every gap ID G01–G34 in gaps.md at least twice across your 100 (tag 1–3 IDs per message in "gaps"); about 10 plain everyday questions tagged G00; about 6 messages that are not requests at all or are unintelligible (tag G34, or "U-gibberish" for keyboard mash / garbled text, "U-chitchat" for pure greetings/thanks/small talk), and about 4 messages where the TEXT ITSELF is ambiguous with two readings (tag "U-ambiguous": a pronoun after two parallel clauses, a homonym, scope of "all ... not", PP attachment).
- Concrete content: people, organisations, places, objects, dates, amounts that one could look up or check. Invent fresh names of many nationalities, organisations, places and domains of your own choosing; do NOT fall back on employment/allergies/sports teams.
- Length: about 10 messages of 1–3 words, most 6–30 words, about 15 of 40–150 words.
- Real noise only where a real person would produce it (typos, missing diacritics, no punctuation, emoji, abbreviations, dictation errors). No templates, no repeated openers or frames; every message sounds like a different person on a different day.

Output: JSONL (UTF-8), one object per line, to the path given in your task:
{"id":"<prefix>-001", "writer":"<letter>", "language":"en"|"ro"|"mixed", "gaps":["G05","G25"], "message":"..."}
Check that the file has exactly 100 lines, every line parses with JSON.parse, and no two messages are identical. Hand back a short report: counts per gap ID and language.
