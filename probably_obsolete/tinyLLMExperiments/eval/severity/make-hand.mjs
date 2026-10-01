// One-off authoring helper: writes eval/severity/calibration-hand.json (hand-assigned severities, owner scale, 2026-10-01).
import fs from 'node:fs';
const g = (sev, ids) => Object.fromEntries(ids.split(/\s+/).filter(Boolean).map(i => [`mj-${i}`, sev]));
const hand = {
  // the 105 hand-written hard negatives
  ...g('S4', '0004 0011 0060 0069 0104 0128 0147 0185 0230 0236 0243 0249 0293 0337 0344 0361 0442 0443 0449 0450 0463 0465 0474 0476 0480 0482 0494 0554 0595 0616 0618 0623 0629 0634 0648 0652 0657 0665 0668 0687 0174 0468 0042'),
  ...g('S3', '0022 0039 0046 0050 0113 0115 0137 0153 0160 0171 0184 0196 0206 0248 0272 0275 0287 0294 0295 0310 0320 0349 0354x 0355 0378 0429 0433 0459 0475 0481 0503 0511 0520 0540 0547 0562 0568 0579 0602 0639 0659 0672 0360'),
  ...g('S2', '0014 0018 0061 0064 0194 0201 0223 0226 0298 0308 0405 0445 0582 0597 0656 0671 0354'),
  ...g('S1', '0154 0278 0324 0385'),
  // typed negatives assigned by case
  ...g('S4', '0031 0083 0102 0170 0172 0237 0241 0266 0325 0368 0377 0398 0461 0696 0053 0285 0411 0101 0161 0242 0250 0553 0365 0374 0124 0454 0490 0626 0350 0003 0027 0070 0214 0234 0307 0422 0432 0498 0521 0524 0607 0613'),
  ...g('S3', '0024 0130 0148 0175 0219 0252 0386 0514 0645 0271 0323 0400 0642 0034 0057 0421 0162 0269 0327 0331 0353 0356 0372 0483 0578 0017 0088 0092 0103 0105 0116 0212 0265 0284 0291 0317 0493 0559 0591 0078 0191 0238 0406 0508 0658 0679 0126 0534 0332 0093 0108 0229 0453 0685'),
  ...g('S2', '0183 0240 0523 0121 0190 0387 0358 0434 0583'),
  ...g('S1', '0413 0199'),
};
// every change_question_type negative is S3
const labels = fs.readFileSync(new URL('../reports/current/meaning-judge/v2/labels.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
for (const r of labels) if (r.type === 'change_question_type') hand[r.id] = 'S3';
delete hand['mj-0354x'];
const dup = labels.filter(r => r.label === 'different' && r.source === 'hand_written').filter(r => !hand[r.id]).map(r => r.id);
if (dup.length) console.error('hard negatives without severity:', dup);
fs.writeFileSync(new URL('./calibration-hand.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.entries(hand).sort()), null, 1) + '\n');
console.log(Object.keys(hand).length);
