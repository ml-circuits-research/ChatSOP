// Built-in skill: a SkillPlugin written on the fly. The planner tier writes a small program against the sandbox API (prompts/plugin-writer.md);
// the program is saved to the operation folder (plugin.js, for audit) and run in the sandbox (lib/sandbox.mjs), whose only capability is
// an allow-listed API: chat on the sandbox tiers within the call limit, reading the attachments, writing outputs into the operation folder.
// A program that fails to load or throws is shown its error once and rewritten.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPlugin} from '../lib/sandbox.mjs';

const PROMPT = fileURLToPath(new URL('../prompts/plugin-writer.md', import.meta.url));
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const codeOf = text => { const m = /```(?:js|javascript)?\s*\n([\s\S]*?)```/.exec(String(text ?? '')); return (m ? m[1] : String(text ?? '')).trim(); };

export default {
  name: 'write-plugin',
  description: 'When no other skill fits: write a small program on the fly that calls models step by step over the attachments (split, ask, combine, check), run it in a sandbox, and return its result and output files.',
  inputs: {
    goal: {type: 'string', min: 1, max: 4000, description: 'what the program must do, in full'},
    tier: {type: 'string', enum: ['small', 'medium', 'good'], default: 'good', description: 'the tier that writes the program'},
  },
  async run(ctx) {
    const box = ctx.config.sandbox ?? {};
    const tiers = box.tiers ?? ['tiny', 'small'];
    const maxCalls = box.maxCalls ?? 50;
    const outDir = path.join(ctx.dir, 'outputs');
    fs.mkdirSync(outDir, {recursive: true});
    let chats = 0, written = [];
    const api = {
      async chat(o) {
        if (!o || typeof o.prompt !== 'string') throw new Error('chat needs {tier, prompt}');
        if (!tiers.includes(o.tier)) throw new Error(`tier ${o.tier} is not allowed in the sandbox (allowed: ${tiers.join(', ')})`);
        if (++chats > maxCalls) throw new Error(`the call limit of ${maxCalls} is reached`);
        const r = await ctx.ta.chat({tier: o.tier, prompt: o.prompt.slice(0, 60000), system: typeof o.system === 'string' ? o.system.slice(0, 8000) : undefined, maxTokens: Math.min(Number(o.maxTokens) || 2000, 8000), temperature: 0, retryCut: true});
        return {ok: r.ok, text: r.ok ? r.text : '', reason: r.ok ? null : r.reason};
      },
      listInputs: async () => ctx.attachments.map(a => ({name: a.name, bytes: a.bytes ?? null})),
      async readInput({name}) { const n = typeof name === 'string' ? name : name?.name; if (!ctx.attachments.some(a => a.name === n)) throw new Error(`no input ${n} (inputs: ${ctx.attachments.map(a => a.name).join(', ')})`); return (await ctx.readAttachment(n)).slice(0, 2_000_000); },
      async writeOutput({name, text}) {
        if (!SAFE.test(String(name)) || typeof text !== 'string') throw new Error('writeOutput needs a simple file name and text');
        if (text.length > (box.maxOutputBytes ?? 1_000_000)) throw new Error('the output is too large');
        fs.writeFileSync(path.join(outDir, name), text); if (!written.includes(name)) written.push(name);
        return {written: name};
      },
      async log({message}) { ctx.log(`plugin: ${String(message).slice(0, 300)}`); return true; },
    };
    const system = fs.readFileSync(PROMPT, 'utf8').replace('{{tiers}}', tiers.join(', ')).replace('{{maxCalls}}', String(maxCalls));
    const messages = [{role: 'system', content: system}, {role: 'user', content: `TASK:\n${ctx.inputs.goal}\n\nATTACHMENTS:\n${ctx.attachments.map(a => `- ${a.name} (${a.bytes ?? '?'} bytes)`).join('\n') || '(none)'}`}];
    let last = null;
    for (let round = 1; round <= 2; round++) {
      const w = await ctx.ta.chat({tier: ctx.inputs.tier, messages, maxTokens: 8000, temperature: 0, retryCut: true});
      if (!w.ok) return {status: 'failed', summary: `the plugin writer (${ctx.inputs.tier}) failed: ${w.reason}`};
      const code = codeOf(w.text);
      const file = path.join(ctx.dir, round === 1 ? 'plugin.js' : `plugin-${round}.js`);
      fs.writeFileSync(file, code + '\n');
      ctx.log(`plugin written: ${path.basename(file)} (${code.length} chars)`);
      last = await runPlugin(code, {request: ctx.inputs.goal, attachments: ctx.attachments.map(a => ({name: a.name, bytes: a.bytes ?? null}))}, api, {timeMs: box.timeMs, heapMb: box.heapMb, maxCodeBytes: box.maxCodeBytes});
      fs.writeFileSync(path.join(ctx.dir, `plugin-run-${round}.json`), JSON.stringify(last, null, 1) + '\n');
      if (last.ok) break;
      messages.push({role: 'assistant', content: w.text}, {role: 'user', content: `The program failed in the sandbox: ${last.code}: ${last.message}\nWrite the corrected program, in one js code block.`});
    }
    const value = last?.value;
    const summary = last?.ok ? (typeof value === 'string' ? value : value?.summary ?? JSON.stringify(value)).slice(0, 1500) : `the plugin failed: ${last?.code}: ${last?.message}`;
    return {status: last?.ok ? 'finished' : 'failed', summary, value: value ?? null, outputs: written.map(n => path.join(outDir, n)), calls: chats};
  },
};
