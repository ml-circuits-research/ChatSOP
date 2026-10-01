#!/usr/bin/env node
/** How many of the spans SymbolicLM does not represent (interpretation `not_represented`) does the symbolic strategy
 * classify? Runs SymbolicLM (Stanza) on the evaluation set, then the EmotionDetectionSystem on each message and its
 * leftover spans. Output: eval/reports/current/emotion-detection/leftover-study.json (and a jsonl of the spans).
 *   node tools/emotion-detection/leftover-study.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {interpretResult} from '../../lib/symbolic-lm/interpretation.mjs';
import {createDefaultEmotionDetectionSystem} from '../../lib/emotion-detection/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'eval/reports/current/emotion-detection');
const items = fs.readFileSync(path.join(DIR, 'eval-set.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const lm = await createSymbolicLM({threads: 4});
const emotion = createDefaultEmotionDetectionSystem(undefined, {enabled: true});
const rows = [];
for (const item of items) {
  try {
    const result = await lm.analyze(item.message, {});
    const interpretation = await interpretResult(lm, result, {certify: false});
    const left = (interpretation.not_represented ?? []).map(span => ({span}));
    const detected = await emotion.detect(item.message, {analysis: result.analysis, englishText: result.english ?? item.message, leftoverSpans: left});
    rows.push({id: item.id, message: item.message, available: interpretation.available !== false, leftover: left.map(l => l.span), classified: detected.leftovers.classified, remaining: detected.leftovers.remaining.map(r => r.span), kinds: detected.signals.map(s => s.kind)});
  } catch (error) { rows.push({id: item.id, message: item.message, error: String(error.message).slice(0, 120)}); }
}
await lm.stop();
const spans = rows.reduce((n, r) => n + (r.leftover?.length ?? 0), 0), classified = rows.reduce((n, r) => n + (r.classified?.length ?? 0), 0);
fs.writeFileSync(path.join(DIR, 'leftover-spans.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'leftover-study.json'), JSON.stringify({messages: rows.length, errors: rows.filter(r => r.error).length, interpretationAvailable: rows.filter(r => r.available).length, messagesWithLeftover: rows.filter(r => r.leftover?.length).length, leftoverSpans: spans, classified, remaining: spans - classified}, null, 1) + '\n');
console.log('done', spans, classified);
