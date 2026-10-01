#!/usr/bin/env node
/** Markdown tables of the translate-compare study from the judged arms (stage 2 = all messages, stage 1 = first 60) with paired bootstrap deltas. Prints to stdout. */
import fs from 'node:fs';
import path from 'node:path';
import {units, loadJudges, measure, sevOf} from './judge.mjs';
import {pairId} from '../severity-apply.mjs';
import {rank} from '../../../lib/severity/scale.mjs';
import {T} from './lib.mjs';

const {g, z} = loadJudges();
const pct = s => (s.n ? `${(100 * s.rate).toFixed(0)}%` : '-');
const rate = x => (x.rate === null ? '-' : `${(100 * x.rate).toFixed(1)}%`);
const lat = fs.existsSync(path.join(T, 'latency.json')) ? JSON.parse(fs.readFileSync(path.join(T, 'latency.json'), 'utf8')).arms : {};
const goodMap = (arm, limit, level = 'sentence') => {
  const m = new Map();
  for (const u of units(arm, limit)) if (u.level === level && u.b.trim()) { const s = sevOf(pairId({a: u.a, b: u.b}), g, z); if (s.upper) m.set(u.key, rank(s.upper) < 3 ? 1 : 0); }
  return m;
};
/** Paired difference in good-enough rate (a minus b) over the units both judged, with a 95% bootstrap interval (2000 resamples, seeded). */
export function paired(a, b, level = 'sentence', limit = Infinity) {
  const ma = goodMap(a, limit, level), mb = goodMap(b, limit, level), keys = [...ma.keys()].filter(k => mb.has(k));
  const d = keys.map(k => ma.get(k) - mb.get(k));
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const means = [];
  for (let r = 0; r < 2000; r++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(rnd() * d.length)]; means.push(s / d.length); }
  means.sort((x, y) => x - y);
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  return {n: d.length, delta_pp: Number((100 * mean).toFixed(1)), ci_pp: [Number((100 * means[50]).toFixed(1)), Number((100 * means[1949]).toFixed(1))]};
}
const names = process.argv[2] ? process.argv[2].split(',') : [];
const limit = process.argv[3] && process.argv[3] !== 'all' ? Number(process.argv[3]) : Infinity;
const rows = names.map(n => ({n, m: measure(units(n, limit), g, z)}));
const SB = ['<8', '8-20', '21-40', '>40'], MB = ['<15', '15-40', '>40'];
console.log(`| arm | sentences (n) | good enough, upper: all | ${SB.join(' | ')} | milder judge: all | S4 (upper) | firm S3+ | excusable S3+ |`);
console.log(`| --- | ---: | ${['---', ...SB.map(() => '---'), '---', '---', '---', '---'].join(' | ')} |`);
for (const {n, m} of rows) { const s = m.sentence; console.log(`| ${n} | ${s.all.n} | ${rate(s.all.good_upper)} | ${SB.map(b => `${pct(s[b].good_upper)} (${s[b].n})`).join(' | ')} | ${rate(s.all.good_lower)} | ${rate(s.all.s4_upper)} | ${rate(s.all.firm_s3p)} | ${rate(s.all.excusable_s3p)} |`); }
console.log('');
console.log(`| arm | messages (n) | good enough, upper: all | ${MB.join(' | ')} | milder judge: all | S4 (upper) | firm S3+ | excusable S3+ |`);
console.log(`| --- | ---: | ${['---', ...MB.map(() => '---'), '---', '---', '---', '---'].join(' | ')} |`);
for (const {n, m} of rows) { const s = m.message; console.log(`| ${n} | ${s.all.n} | ${rate(s.all.good_upper)} | ${MB.map(b => `${pct(s[b].good_upper)} (${s[b].n})`).join(' | ')} | ${rate(s.all.good_lower)} | ${rate(s.all.s4_upper)} | ${rate(s.all.firm_s3p)} | ${rate(s.all.excusable_s3p)} |`); }
