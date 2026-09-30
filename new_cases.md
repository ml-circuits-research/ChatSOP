# New proofreading cases: how to produce them

This file tells whoever writes or collects new cases (people, or a strong LLM under a person's supervision) exactly what ChatSOP needs. The cases train and test the **proofreader**: a small model (Gemma3-270M) that rewrites a user's English message into clean English before **SymbolicLM** (Stanza parsing + UD-to-SOP rules) turns it into SOP Lang.

Why new cases are needed: the proofreader trained on text from our own generator helps on generator-like text (+6.7 points of correct SOP) and on Haiku paraphrases (+2.9), but not on independently written messages (wild suite: −1). It has not seen how real people write. See `eval/reports/current/proofing/report-v2.md` and `eval/reports/current/proofreader-e2e/`.

## 1. What one case is

One JSON object per line (JSONL), UTF-8:

```json
{"id": "nc-000123",
 "language": "en",
 "message": "hey quick q - who does hao report to now that maria left??",
 "clean": ["Maria left. To whom does Hao report now?"],
 "categories": ["casual_register", "stranded_preposition", "multi_clause"],
 "author": "writer-07",
 "source": "own-writing",
 "notes": ""}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique, stable. |
| `language` | yes | `en` for now. Mixed Romanian/English goes in a separate file with `"language": "mixed"` (section 7). |
| `message` | yes | The message exactly as a real user would type it: messy, casual, with typos where natural. |
| `clean` | yes | One to three acceptable clean rewrites that follow section 3. If the message is already clean, `clean` repeats the message exactly (an **identity** case). |
| `categories` | yes | One or more tags from section 4. |
| `author` | yes | A pseudonymous writer id, or the generating model plus the reviewing person. |
| `source` | yes | `own-writing`, or `llm:<model>+reviewed-by:<person>`. Never copied text (section 6). |
| `gold_sop` | no | SOP Lang for the clean message, if the provider can write it (DS021). Optional: without it we compute and check the SOP ourselves. |
| `notes` | no | Anything unusual, for example "ambiguous on purpose". |

## 2. The most important rule: the rewrite keeps the meaning exactly

The clean rewrite is a **copy-edit, not an answer and not an interpretation**. It must:

- keep every person, organization, place, product, date, time, number, amount and quoted title **exactly** as written; fix only an obvious typo in a common word, never in a name;
- keep negation (`not`, `never`, `no one`), quantifiers (`all`, `most`, `some`, `none`, `at least 3`, `not all`), comparisons (`more than`, `before October`, `the oldest`), and hedges (`I think`, `maybe`, `probably`);
- keep reported speech and who said it (`Ana says the lab is closed` stays that);
- keep the kind of request: a question stays a question, a yes/no question stays yes/no, a statement stays a statement, a request to check a claim stays one;
- add nothing: no guessed facts, no resolved pronoun unless it is certain from the message itself, no answer, no explanation;
- drop nothing that carries meaning. Only filler (`hey`, `quick q`, `lol`, `pls`, emojis, `Fact-check:`) may be dropped.

If a message is genuinely ambiguous, the rewrite must stay ambiguous. If it cannot be cleaned without guessing (a fragment like `and Tuesday?`), it is an identity case.

## 3. What "clean" looks like (what SymbolicLM parses well)

These rules come from measured failures of Stanza and our rules (`eval/reports/current/symbolic-layers/summary.md`, section 4):

1. **Spelling, casing, spacing.** Fix misspellings, glued words (`ticketsexist` → `tickets exist`) and split words (`rel ies` → `relies`). Capitalize sentence starts and names.
2. **One clause per sentence where possible.** Split run-ons and long `and` chains into separate sentences. Keep the connective when it carries meaning: `because`, `if`, `unless`, `although`, `before`, `after`, `when`, `while`, `so`.
3. **One question per sentence.** A message with three questions becomes three questions.
4. **Standard question order.** Put the question word first, and use a full subject and verb.
   - Avoid a preposition stranded at the end: prefer `To whom does Hao report?`. The echo form `Hao reports to whom?` is also accepted.
   - `Any chance X is open?` → `Is X open?`
5. **Lists: one sentence per item.** `- call Ana\n- book room 3` → `Call Ana. Book room 3.`
6. **Explicit subjects** in coordinated clauses: `Does Ion teach math and coach the team?` → `Does Ion teach math? Does Ion coach the team?`, but only when the meaning is clearly the same.
7. **Titles and odd names in quotes.** A book, film, project or team name that looks like normal words goes in double quotes: `"Letters to a Young Engineer"`. Names that are English words (`Can Şahin`, `Rose Hill Clinic`) keep their capitals.
8. **Plain standard English, not formal English.** Short everyday words are better than long formal ones. Do not paraphrase for style.

## 4. Categories and how many cases of each

Target for a first delivery: **3,000 English cases**. If they help, a later delivery aims for up to 10,000 cases, with the same proportions.

| Tag | What it covers | Share | Example message → clean |
|---|---|---|---|
| `identity_clean` | Already clean messages of every type: statements, yes/no and wh-questions, counts, comparisons. They teach the model **not to break** what works. | 25% | `Who manages the Cluj office?` → the same |
| `identity_unfixable` | Fragments, follow-ups, deliberate ambiguity, gibberish, greetings. The rewrite equals the message. | 5% | `and tuesday?` → the same |
| `typos` | Misspellings, glued or split words, missing apostrophes, keyboard slips | 12% | `does maria wrok at the libary` → `Does Maria work at the library?` |
| `casual_register` | Fillers, lead-ins, emojis, no punctuation, all lowercase, texting style | 10% | `hey so is the gym open sat or nah 🙏` → `Is the gym open on Saturday?` |
| `stranded_preposition` | Wh-questions ending in a preposition, fronted wh-phrases | 8% | `which team is Rotaru the coach of` → `Of which team is Rotaru the coach?` |
| `multi_question` | Two or more questions in one message | 8% | `who runs the lab and when does it open?` → `Who runs the lab? When does the lab open?` |
| `long_coordination` | Run-ons and long `and`/`or`/`but` chains | 8% | `Ana and Dan went to Iasi and then Dan came back but Ana stayed is Ana still there` → `Ana and Dan went to Iasi. Then Dan came back. Ana stayed. Is Ana still there?` |
| `subordinate` | `because`/`if`/`since`/`unless`/`before`/`after`/`when` clauses, including a clause in the middle | 7% | `since the bridge is closed is the bus late` → `Since the bridge is closed, is the bus late?` |
| `lists` | Bullets, to-dos, numbered items | 4% | see rule 5 |
| `names_titles` | Names that look like common words, titles, organizations with prepositions (`the vineyard near Sibiu`) | 5% | `did can sahin win best in show` → `Did Can Şahin win "Best in Show"?` |
| `quantifiers_negation` | `most`, `not all`, `none`, `at least N`, double negation | 4% | `not all nurses got the jab right?` → `Is it true that not all nurses got the jab?` |
| `numbers_time` | Amounts, dates, ranges, `before/after`, durations, comparisons | 4% | `was it more then 3 days after the 5th` → `Was it more than 3 days after the 5th?` |
| **Total** | | **100%** | |

A case can carry several tags. The shares count each case under its main tag.

## 5. Diversity requirements (the whole point)

- **Domains:** everyday life and work that our generator does not cover. Aim for at least 15 domains, each at most 10% of the cases: health and clinics, school, HR and payroll, logistics, retail, sports clubs, family events, finance and bills, travel, IT support, housing, farming, public offices, hobbies, and so on.
- **People:** invented names of varied origins, including Romanian names with and without diacritics. No real private persons.
- **Length:** from 3 to 60 words. About 30% should be short (under 8 words) and about 20% long (over 25 words).
- **No templates:** at most 5% of cases may start with the same first three words, and no fixed sentence frames repeated with swapped names. Each case is written independently.
- **Writers:** if people write the cases, use several writers (at least 5), because different people make different mistakes. If an LLM writes them, vary the prompts and personas, and have a person review a sample.

## 6. Rights and privacy (mandatory)

- Only original writing, or LLM output reviewed by a person. **Do not copy** messages from websites, forums, chats, datasets or books (`DS014-source-rights.md`, `datasets/SOURCES.md`).
- No real personal data: no real phone numbers, emails, addresses or health details of real people.
- State the licence under which ChatSOP may use the cases (for example "contributed to ChatSOP under CC BY 4.0" or "owner-authored").

## 7. Mixed Romanian/English (later, separate file)

Deliver these later in a separate file, `mixed.jsonl`, same format, with `"language": "mixed"`. `message` is how people really mix the two languages (`poti sa verifici daca deadline-ul e vineri?`). `clean` has two fields:

```json
"clean_ro": ["Poți să verifici dacă termenul-limită este vineri?"],
"clean_en": ["Can you check whether the deadline is on Friday?"]
```

About 500 cases are enough for a first test.

## 8. Delivery and what we do with the cases

1. Put the files in `datasets_sources/new_cases/` (`cases.jsonl`, later `mixed.jsonl`), plus a short `README.md` with authors, method, date and licence. This folder is the raw source cache and is never exported as is.
2. We check each case automatically:
   - SymbolicLM must turn every `clean` rewrite into a valid SOP with no unparsed spans;
   - names, numbers and quotes must be preserved;
   - if `gold_sop` is given, it must match.
   Failing cases come back to you with the reason.
3. **20% of the cases, split by writer, are sealed as a new independent test set.** It becomes our best test of real-world text, better than today's wild suite, which has only 341 English rows.
4. The rest joins `datasets_archive/proofing` (v3). We retrain Gemma3-270M only after you approve, then measure on the sealed 20% and on the wild suite.

## 9. Quick checklist per case

- [ ] `message` reads like a real person typed it.
- [ ] `clean` changes nothing about who, what, when, how many, and whether it is true.
- [ ] Names, numbers, dates and titles are identical.
- [ ] The question type is unchanged.
- [ ] Nothing is added or answered.
- [ ] Ambiguity is kept.
- [ ] Clean rules 1–8 are applied only where needed.
- [ ] The tags are set, and the source and author are filled in.
