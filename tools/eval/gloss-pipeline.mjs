#!/usr/bin/env node
/** End-to-end latency and agreement of the proofing chain with and without the gloss (experiment eval-gloss-v1; no training):
 *
 *   message -> [LanguagesUtil + TranslatorService gloss] -> LanguageProofingLLM -> SymbolicProofingLLM -> SymbolicLM
 *
 * Arms: `direct` (the message goes to LanguageProofingLLM as it is) and `gloss` (the gloss goes to LanguageProofingLLM; with the
 * iteration-2 model this is the untrained use of the gloss, with a gloss-trained model it is the post-editor). Stage times are
 * wall-clock milliseconds on the CPU (llama-server -ngl 0 -t 4 for both models, Stanza CPU worker). Per unit it records the text after
 * each stage and whether the final SOP equals the SOP SymbolicLM produces from the reference English (a proxy, not a SOP gold).
 *
 *   node tools/eval/gloss-pipeline.mjs --split dev2 --sample 300 --n 100 --lp URL --sp URL [--kind ro,mixed] [--out FILE]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {glossMessage} from '../../lib/translator-service/index.mjs';
import {loadSplit, WORK} from './language-proofing-eval.mjs';

const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
const o = args(process.argv.slice(2));
const quant = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

async function chat(url, text) {
  const t0 = performance.now();
  const res = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: text}], temperature: 0, top_k: 1, seed: 0, cache_prompt: false, max_tokens: 400})});
  if (!res.ok) throw Error(`endpoint ${res.status}`);
  const data = await res.json();
  return {text: String(data.choices?.[0]?.message?.content ?? '').trim(), ms: performance.now() - t0};
}

async function main() {
  const kinds = String(o.kind ?? 'ro,mixed').split(',');
  const rows = loadSplit(o.split ?? 'dev2', o.sample ? Number(o.sample) : null).filter(r => kinds.includes(r.kind) && r.pair === 'repair').slice(0, Number(o.n ?? 100));
  const lm = await createSymbolicLM({});
  const records = [];
  try {
    for (const r of rows) {
      const ref = await lm.analyze(r.target, {route: 'direct'});
      for (const arm of ['direct', 'gloss']) {
        const rec = {id: r.id, kind: r.kind, arm, input: r.prompt, ms: {}};
        let text = r.prompt;
        if (arm === 'gloss') { const g = await glossMessage(lm, r.prompt, {spell: true, senses: Number(o.senses ?? 1)}); text = g.text; rec.gloss = text; rec.ms.gloss = g.ms; }
        const lp = await chat(o.lp, text); rec.lp = lp.text; rec.ms.lp = lp.ms;
        const sp = await chat(o.sp, lp.text); rec.sp = sp.text; rec.ms.sp = sp.ms;
        const t0 = performance.now();
        const out = await lm.analyze(sp.text, {route: 'direct'});
        rec.ms.symbolic_lm = performance.now() - t0;
        rec.ms.total = Object.values(rec.ms).reduce((a, b) => a + b, 0);
        rec.valid = Boolean(out.valid); rec.same_sop_as_reference = out.sop === ref.sop; rec.reference_valid = Boolean(ref.valid);
        records.push(rec);
      }
    }
  } finally { await lm.stop?.(); }
  const summary = {};
  for (const arm of ['direct', 'gloss']) {
    const rs = records.filter(x => x.arm === arm);
    const stage = k => rs.map(x => x.ms[k]).filter(v => v !== undefined);
    summary[arm] = {n: rs.length, valid: rs.filter(x => x.valid).length, same_sop_as_reference: rs.filter(x => x.same_sop_as_reference).length,
      p50_ms: Object.fromEntries(['gloss', 'lp', 'sp', 'symbolic_lm', 'total'].filter(k => stage(k).length).map(k => [k, Math.round(quant(stage(k), 0.5))])),
      p95_ms: Object.fromEntries(['gloss', 'lp', 'sp', 'symbolic_lm', 'total'].filter(k => stage(k).length).map(k => [k, Math.round(quant(stage(k), 0.95))]))};
  }
  const out = path.resolve(process.cwd(), o.out ?? path.join(WORK, 'pipeline.json'));
  fs.writeFileSync(out, JSON.stringify({summary, records}, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
