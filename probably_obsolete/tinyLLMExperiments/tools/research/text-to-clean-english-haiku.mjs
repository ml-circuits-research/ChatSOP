#!/usr/bin/env node
/** Claude Haiku reference ceiling for the textToCleanEnglish survey (text-to-clean-english-v1).
 * Small sample, hard $5 total budget (stops before $4.50); headless `claude -p`, no tools, own scratch dir.
 *   node tools/research/text-to-clean-english-haiku.mjs --sample <sample.jsonl> --kinds ro,mixed,noisyEn,control --per-kind 10 --out <out.jsonl> --ledger <ledger.json>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MODEL = 'claude-haiku-4-5-20251001';
const BUDGET_STOP = 4.5;

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];

function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-haiku-'));

function callClaude(system, message, timeoutMs = 120000) {
  return new Promise(resolve => {
    const cliArgs = ['-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--system-prompt', system,
      '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'];
    const child = spawn('claude', cliArgs, {cwd: scratch, env: {...process.env, MAX_THINKING_TOKENS: '0'}, stdio: ['pipe', 'pipe', 'pipe']});
    child.stdin.end(message);
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('close', code => { clearTimeout(timer); resolve({code, out, err}); });
  });
}

async function main() {
  const prompt = fs.readFileSync(path.join(ROOT, args.prompt), 'utf8').trim();
  const sample = fs.readFileSync(path.join(ROOT, args.sample), 'utf8').trim().split('\n').map(JSON.parse.bind(JSON));
  const kinds = String(args.kinds).split(',');
  const perKind = Number(args.perKind ?? 10);
  const random = mulberry(20260930);
  const picked = [];
  for (const kind of kinds) {
    const rows = sample.filter(r => r.kind === kind);
    const shuffled = [...rows];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    picked.push(...shuffled.slice(0, perKind));
  }
  const ledgerFile = path.join(ROOT, args.ledger);
  let ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {model: MODEL, calls: [], total_cost_usd: 0};
  const out = [];
  for (const row of picked) {
    if (ledger.total_cost_usd >= BUDGET_STOP) { console.error(`STOP: budget ${ledger.total_cost_usd} >= ${BUDGET_STOP}`); break; }
    const started = Date.now();
    const {code, out: stdout, err} = await callClaude(prompt, row.text);
    let data = null;
    try { data = JSON.parse(stdout); } catch {}
    if (code === 0 && data && !data.is_error && typeof data.result === 'string') {
      const cost = data.total_cost_usd ?? 0;
      ledger.total_cost_usd += cost;
      ledger.calls.push({id: row.id, kind: row.kind, cost_usd: cost, ms: Date.now() - started});
      out.push({id: row.id, kind: row.kind, output: data.result.trim(), ms: Date.now() - started, cost_usd: cost});
      console.error(`${row.id} (${row.kind}): $${cost.toFixed(4)} total $${ledger.total_cost_usd.toFixed(3)}`);
    } else {
      console.error(`${row.id}: FAILED code=${code} err=${err.slice(0, 200)}`);
      out.push({id: row.id, kind: row.kind, output: '', error: true});
    }
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
  }
  fs.mkdirSync(path.dirname(path.join(ROOT, args.out)), {recursive: true});
  fs.writeFileSync(path.join(ROOT, args.out), out.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({rows: out.length, total_cost_usd: ledger.total_cost_usd}));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
