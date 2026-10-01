## Error categories

Arm: it2.

### Sealed repair pairs

| category | pairs | share |
| --- | --- | --- |
| left unchanged, analysis still wrong | 311 | 42.1% |
| good: equals the verified target text | 130 | 17.6% |
| good: different wording, analysis correct, meaning kept | 122 | 16.5% |
| changed, analysis still wrong, meaning kept | 65 | 8.8% |
| meaning lost, analysis correct (judge says no) | 48 | 6.5% |
| changed, analysis still wrong and meaning lost | 29 | 3.9% |
| good: unchanged and already analysis-correct | 26 | 3.5% |
| meaning lost, analysis correct (names, numbers or negation changed) | 7 | 0.9% |
| runaway (cap hit or repeated sentence) | 1 | 0.1% |

| flag (overlapping) | pairs |
| --- | --- |
| pronoun dropped or replaced | 1 |
| lead-in, tag or question frame dropped | 3 |
| statement turned into a question | 13 |
| output sentence count differs from the target | 132 |
| decomposition pair (target has more sentences) | 134 |

Repair pairs by the failure kind of the source row:

| failure kind | pairs | good |
| --- | --- | --- |
| trees_differ | 514 | 191 (37.2%) |
| unparsed_span | 88 | 49 (55.7%) |
| judge_a | 75 | 14 (18.7%) |
| judge_c | 36 | 14 (38.9%) |
| judge_ac | 26 | 10 (38.5%) |

Repair pairs by the number of sentences of the verified target:

| target sentences | pairs | good | equals the target text |
| --- | --- | --- | --- |
| 1 | 485 | 187 (38.6%) | 93 (19.2%) |
| 2 | 171 | 62 (36.3%) | 29 (17%) |
| 3 | 45 | 14 (31.1%) | 4 (8.9%) |
| 4 or more | 38 | 15 (39.5%) | 4 (10.5%) |

### Identity breaks (working sentences whose analysis or text changed)

sealed identity pairs: 98 of 495 changed.

| cause (heuristic, first match) | sentences | of which output no longer analysis-correct |
| --- | --- | --- |
| reworded (words added, dropped or replaced) | 37 | 10 |
| lead-in, tag or question frame dropped | 26 | 3 |
| split into several sentences | 17 | 1 |
| punctuation or case only | 10 | 5 |
| same words reordered (passive/active, fronting, clause order) | 7 | 1 |
| pronoun changed | 1 | 0 |

500 working sentences: 77 of 500 changed.

| cause (heuristic, first match) | sentences | of which output no longer analysis-correct |
| --- | --- | --- |
| lead-in, tag or question frame dropped | 30 | 8 |
| reworded (words added, dropped or replaced) | 24 | 4 |
| same words reordered (passive/active, fronting, clause order) | 9 | 1 |
| split into several sentences | 9 | 0 |
| punctuation or case only | 4 | 1 |
| pronoun changed | 1 | 0 |

## Thirty examples

1. **good repair (decomposition) (sealed)**
   - IN: Can the wardens move the cones, and who put them there originally?
   - OUT: Can the wardens move the cones? Who put them there originally?
   - TGT: Can the wardens move the cones? Who put the cones there originally?
2. **good repair (decomposition) (sealed)**
   - IN: The dispatcher changed Pema's airport run to a larger vehicle and the driver saw the update but the rider still saw the small car in her app, so she called the office.
   - OUT: The dispatcher changed Pema's airport run to a larger vehicle. The driver saw the update. But the rider still saw the small car in her app. So she called the office.
   - TGT: The dispatcher changed Pema's airport run to a larger vehicle. The driver saw the update. The rider still saw the small car in her app. So she called the office.
3. **good repair (decomposition) (sealed)**
   - IN: Boaz took the tunnel and paid the toll and stopped near the arena and then the rider changed the destination to the hotel but the fare estimate did not update.
   - OUT: Boaz took the tunnel. He paid the toll. He stopped near the arena. Then the rider changed the destination to the hotel. But the fare estimate did not update.
   - TGT: Boaz took the tunnel and paid the toll. Boaz stopped near the arena. Then the rider changed the destination to the hotel. But the fare estimate did not update.
4. **good repair (sealed)**
   - IN: which platform does the Cambridge train usually leave from at King's Cross
   - OUT: From which platform does the Cambridge train typically leave at King's Cross?
   - TGT: From which platform does the Cambridge train usually leave at King's Cross?
5. **good repair (sealed)**
   - IN: What is Nori captain of?
   - OUT: Nori is captain of what?
   - TGT: Nori is captain of what?
6. **good repair (sealed)**
   - IN: Who is the oldest person working at Blue Harbor Media?
   - OUT: Which person working at Blue Harbor Media is the oldest?
   - TGT: Who is the oldest person who works at Blue Harbor Media?
7. **good repair (sealed)**
   - IN: who did Lale cook for at the private dinner last night
   - OUT: For whom did Lale cook at the private dinner last night?
   - TGT: For whom did Lale cook at the private dinner last night?
8. **left unchanged, analysis still wrong (decomposition, sealed)**
   - IN: Who collected the sedan when the return office closed, and did Loredana receive a signed inspection slip before she boarded the last shuttle?
   - OUT: Who collected the sedan when the return office closed, and did Loredana receive a signed inspection slip before she boarded the last shuttle?
   - TGT: Who collected the sedan when the return office closed? Did Loredana receive a signed inspection slip before she boarded the last shuttle?
9. **changed, analysis still wrong and meaning lost (decomposition, sealed)**
   - IN: when the vet called after Jiji had already eaten the new food I could not tell whether the change in her appetite began before breakfast or only after our walk
   - OUT: I could not tell whether the change in her appetite began before breakfast. Or if the change in her appetite began after our walk. Or if the change in her appetite only after our walk.
   - TGT: Jiji had already eaten the new food when the vet called. When the vet called, I could not tell whether the change in her appetite began before breakfast or only after our walk.
10. **left unchanged, analysis still wrong (decomposition, sealed)**
   - IN: Unless the supplier sends the correct charger before Thursday, Imran says he cannot complete the scooter repair, but he can still inspect the cable and replace the cracked port cover.
   - OUT: Unless the supplier sends the correct charger before Thursday, Imran says he cannot complete the scooter repair, but he can still inspect the cable and replace the cracked port cover.
   - TGT: Imran says he cannot complete the scooter repair unless the supplier sends the correct charger before Thursday. But he can still inspect the cable. He can still replace the cracked port cover.
11. **meaning lost, analysis correct (judge says no) (sealed)**
   - IN: So how many companies is Carpathia Energy a supplier of?
   - OUT: How many companies supply Carpathia Energy?
   - TGT: Carpathia Energy is a supplier of how many companies?
12. **left unchanged, analysis still wrong (sealed)**
   - IN: Any chance Vikram goes to Bistrița Technical College?
   - OUT: Any chance Vikram goes to Bistrița Technical College?
   - TGT: Does Vikram go to Bistrița Technical College?
13. **meaning lost, analysis correct (judge says no) (sealed)**
   - IN: Where does whoever manages Mihai live?
   - OUT: Who manages Mihai?
   - TGT: Where does Mihai's manager live?
14. **meaning lost, analysis correct (names, numbers or negation changed) (sealed)**
   - IN: The agreement lists 250 kilometers for 3 days and charges 0.20 for each extra kilometer, but Youssef's copy says 200 kilometers, so which limit applies to this booking?
   - OUT: The agreement lists 250 kilometers for 3 days. Youssef's copy says 200 kilometers. Which limit applies to this booking?
   - TGT: The agreement lists 250 kilometers for 3 days. The agreement charges 0.20 for each extra kilometer. But Youssef's copy says 200 kilometers. So which limit applies to this booking?
15. **changed, analysis still wrong and meaning lost (sealed)**
   - IN: not all journals are searchable and some aren't even indexed
   - OUT: some journals aren't searchable and not all journals are indexed
   - TGT: Not all journals are searchable. Some aren't even indexed.
16. **runaway (cap hit or repeated sentence) (sealed)**
   - IN: The new tyres are wider and the mudguard barely clears them and Rui says the rear brake still rubs but the invoice lists only the tyre fitting and not the brake work.
   - OUT: The new tyres are wider. The mudguard barely clears them. Rui says the rear brake still rubs. But the invoice lists only the tyre fitting. Rui says the rear brake still rubs. But the invoice lists only the tyre fitting. Not the brake work.
   - TGT: The new tyres are wider. The mudguard barely clears them. Rui says the rear brake still rubs. But the invoice lists only the tyre fitting and not the brake work.
17. **identity break: reworded (words added, dropped or replaced)** (output no longer analysis-correct)
   - IN: Given that the Târgu Mureș Town Hall issues a work permit, is it correct that a work permit is issued by the Tampere Town Hall?
   - OUT: Given that the Târgu Mureș Town Hall issues a work permit, is it correct that it is issued by the Tampere Town Hall?
18. **identity break: reworded (words added, dropped or replaced)** (output still analysis-correct)
   - IN: Have all the students at Bistrița Music Academy completed the safety training?
   - OUT: Has every student at Bistrița Music Academy completed the safety training?
19. **identity break: split into several sentences** (output still analysis-correct)
   - IN: The battery meter shows half and then the screen goes blank and the scooter slows on hills and Qiao asked for a written price before we order any replacement cells.
   - OUT: The battery meter shows half. Then the screen goes blank. Then the scooter slows on hills. Qiao asked for a written price before we order any replacement cells.
20. **identity break: punctuation or case only** (output still analysis-correct)
   - IN: is the 26-inch wheel cheaper than the 28-inch wheel
   - OUT: Is the 26-inch wheel cheaper than the 28-inch wheel?
21. **identity break: lead-in, tag or question frame dropped** (output still analysis-correct)
   - IN: Any idea how Silviu Ungureanu settles the bill?
   - OUT: How does Silviu Ungureanu settle the bill, any idea?
22. **identity break: split into several sentences** (output still analysis-correct)
   - IN: Which tyre did Hina select and when will it arrive?
   - OUT: Which tyre did Hina select? When will it arrive?
23. **identity break: punctuation or case only** (output no longer analysis-correct)
   - IN: the tide rose 2 metres between 06 and 08 today
   - OUT: The tide rose 2 metres between 06 and 08 today.
24. **identity break: pronoun changed** (output still analysis-correct)
   - IN: Hypothetically, if Floarea Gheorghiu is the coach of the Bacău Falcons, is she the coach of the Bacău Falcons?
   - OUT: Hypothetically, if Floarea Gheorghiu is the coach of the Bacău Falcons, is he the coach of the Bacău Falcons?
25. **K6 decomposition, per sentence: sentence count reached (3 of 3)**
   - IN: the workshop ordered my mirror from a supplier last Thursday and said it might arrive this week has it arrived yet and if not can the car be used without it
   - OUT: The workshop ordered my mirror last Thursday. The workshop said it might arrive this week. If it doesn't arrive, can the car be used without it?
   - TGT: The workshop ordered my mirror from a supplier last Thursday and said it might arrive this week. Has it arrived yet? Can the car be used without it if the mirror has not arrived?
26. **K6 decomposition, per sentence: sentence count reached (2 of 2)**
   - IN: Which storage locker did Amadou take the bilge pump out of when the alarm sounded, and who did he hand the pump to before the mechanic arrived?
   - OUT: Out of which storage locker did Amadou take the bilge pump when the alarm sounded? Who handed the pump to before the mechanic arrived?
   - TGT: Which storage locker contained the bilge pump that Amadou took when the alarm sounded? To whom did he hand the pump before the mechanic arrived?
27. **K6 decomposition, per sentence: sentence count not reached (1 of 2)**
   - IN: Amina wants the atlas and the recipe book and the poetry collection is for her brother.
   - OUT: Amina wants the atlas and the recipe book and the poetry collection is for her brother.
   - TGT: Amina wants the atlas and the recipe book. Her brother is to have the poetry collection.
28. **K6 decomposition, per sentence: sentence count not reached (1 of 3)**
   - IN: The lights work now but the wipers still stop halfway and the washer bottle is full.
   - OUT: The lights work now but the wipers still stop halfway and the washer bottle is full.
   - TGT: The lights work now. The wipers still stop at the halfway point. The washer bottle is full.
29. **K2 mixed paragraph, per sentence (13 sentences, 9 sent)**
   - IN: I was wondering whether The Last Ferry was written by Valentina. Honestly, should Kaveh accept the offer from Vertex Analytics or not? Fact-check: Alexandru does not train the Brașov Falcons. Other than Mr Sârbu, I'm trying to find out who is responsible fo...
   - OUT: I was wondering whether The Last Ferry was written by Valentina. Honestly, should Kaveh accept the offer from Vertex Analytics or not? Fact-check: Alexandru does not train the Brașov Falcons. I'm trying to find out who is responsible for the backup cluster,...
   - TGT: I was wondering whether The Last Ferry was written by Valentina. Honestly, should Kaveh accept the offer from Vertex Analytics or not? Fact-check: Alexandru does not train the Brașov Falcons. Apart from Mr Sârbu, I am trying to find out who is responsible f...
30. **K2 mixed paragraph, per sentence (7 sentences, 5 sent)**
   - IN: The adoption fair is indoors if the weather turns bad. The lights work now but the wipers still stop halfway and the washer bottle is full. Which vet called? When? I wonder if the Passport Office in Porto issues a building permit.
   - OUT: The adoption fair is indoors if the weather turns bad. The lights work now but the wipers still stop halfway and the washer bottle is full. Which vet called? When? I wonder if the Passport Office in Porto issues a building permit.
   - TGT: The adoption fair is indoors if the weather turns bad. The lights work now. The wipers still stop at the halfway point. The washer bottle is full. Which vet called? When did the vet call? I wonder if the Passport Office in Porto issues a building permit.

