#!/usr/bin/env node
/** Worked examples of the translate-compare summary: 6 study sentences (one long run-on) and 4 jargon probes, every arm's output side by side. Prints markdown. */
import fs from 'node:fs';
import path from 'node:path';
import {T, readJsonl, readArm, sentences} from './lib.mjs';

const S = new Map(sentences().map(s => [s.id, s]));
const arms = ['prod1', 'opus-romance', 'opus-biblebig', 'qwen3-4b', 'deepseek'];
const A = Object.fromEntries([...arms, 'opus-biblebig-jargon', 'qwen3-4b-jargon', 'symbolic', 'gloss'].map(n => [n, readArm(n)]));
const clip = (t, n = 420) => String(t ?? '-').replace(/\s+/g, ' ').trim().slice(0, n);
const ids = ['natural::20260930T160113354#0', 'natural::20260929T035944885#1', 'natural::20260928T114835333#0', 'natural::20260928T110845634#0', 'natural::20260929T131305432#0'];
const long = sentences().filter(s => s.words >= 45 && s.words <= 70 && A.deepseek.get(s.id) && A['qwen3-4b'].get(s.id) && !/(.{12,}?)\1\1/.test(A.prod1.get(s.id)?.out ?? ''))[3];
if (long) ids.push(long.id);
let n = 0;
for (const id of ids) {
  const s = S.get(id);
  console.log(`**Example ${++n}** (${s.words} words)`, '', `- original: ${JSON.stringify(clip(s.text))}`);
  for (const a of ['prod1', 'symbolic', 'opus-romance', 'opus-biblebig', 'qwen3-4b', 'deepseek']) console.log(`- ${a}: ${JSON.stringify(clip(A[a].get(id)?.out))}`);
  if (A['opus-biblebig-jargon'].get(id)?.spans) console.log(`- opus-biblebig + jargon quoting: ${JSON.stringify(clip(A['opus-biblebig-jargon'].get(id).raw ?? A['opus-biblebig-jargon'].get(id).out))}`);
  console.log('');
}
const probe = readJsonl(path.join(T, 'jargon-probe.jsonl')), P = new Map(probe.map(p => [p.id, p]));
const rd = name => readArm(name);
const pa = ['symbolic', 'gloss', 'prod1', 'opus-romance', 'opus-biblebig', 'qwen3-1.7b', 'qwen3-4b', 'deepseek'];
const PA = Object.fromEntries(pa.flatMap(a => [[a, rd('probe-' + a)], [a + '-q', rd('probe-' + a + '-q')]]));
for (const id of ['probe0', 'probe2', 'probe3', 'probe1']) {
  const p = P.get(id);
  console.log(`**Example ${++n}** (jargon probe)`, '', `- original: ${JSON.stringify(p.text)}`, `- with the term quoted: ${JSON.stringify(p.quoted)}`);
  for (const a of pa) console.log(`- ${a}: ${JSON.stringify(clip(PA[a].get(id)?.out))} | quoted: ${JSON.stringify(clip(PA[a + "-q"].get(id)?.out))}`);
  console.log('');
}
