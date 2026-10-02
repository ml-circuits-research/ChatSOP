#!/usr/bin/env node
// A stub of the omp CLI for the test suite: it never calls a model. It answers `--version` and `models --json`, and for a run
// (`-p ... --cwd FOLDER --session-dir DIR`) writes the files a coding agent would write, depending on STUB_OMP_MODE:
//   good  knowledge.sop (the file STUB_OMP_GOOD), queries.sop, report.md
//   fix   a broken knowledge.sop on the first call and the good one on a continued call (-c)
//   bad   always a broken knowledge.sop
//   none  writes nothing
//   fail  exits 3
//   slow  sleeps 60 s
// STUB_OMP_DELAY_MS delays a run (used by the UI screenshot tool so the progress can be seen).
// Every call is appended to STUB_OMP_LOG as one JSON line {args, env_keys, cwd}; a session file with usage and cost is written.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
if (process.env.STUB_OMP_LOG) fs.appendFileSync(process.env.STUB_OMP_LOG, JSON.stringify({args, cwd: process.cwd(), env_keys: Object.keys(process.env).filter(k => /KEY|TOKEN|SECRET|PASSWORD/.test(k))}) + '\n');
if (args[0] === '--version') { console.log('omp v0.0.0-stub'); process.exit(0); }
if (args[0] === 'models') {
  const entry = (provider, id, input, output) => ({provider, kind: 'chat', id, selector: `${provider}/${id}`, name: id, contextWindow: 1000000, maxTokens: 100000, reasoning: false, thinking: [], input: ['text'], cost: {input, output}, pricingStatus: 'fixed'});
  console.log(JSON.stringify({models: [entry('deepseek', 'deepseek-flash', 0.3, 1.2), entry('xai-oauth', 'grok-4.20-0309-non-reasoning', 1.25, 2.5), entry('zai', 'glm-5', 0.5, 2), entry('openrouter', 'vendor/some-model', 1, 2), entry('mystery', 'x', 0, 0)]}));
  process.exit(0);
}
if (value('--mode') === 'rpc') {
  const mode = process.env.STUB_OMP_MODE ?? 'good';
  const sessions = new Map();
  let current = null;
  let next = 0;
  const send = frame => process.stdout.write(JSON.stringify(frame) + '\n');
  send({type: 'ready', protocolVersion: 1});
  for await (const line of readline.createInterface({input: process.stdin})) {
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }
    const respond = (success, data, error) => send({type: 'response', id: cmd.id, command: cmd.type, success, ...(error ? {error} : {data})});
    if (cmd.type === 'new_session') {
      current = `stub-rpc-session-${++next}`;
      sessions.set(current, 0);
      respond(true, {cancelled: false});
    } else if (cmd.type === 'switch_session') {
      if (!sessions.has(cmd.sessionPath)) respond(false, null, 'unknown session');
      else { current = cmd.sessionPath; respond(true, {}); }
    } else if (cmd.type === 'get_state') {
      respond(true, {sessionFile: current, messageCount: sessions.get(current), queuedMessageCount: 0,
        isStreaming: false, dumpTools: [], systemPrompt: [value('--system-prompt')]});
    } else if (cmd.type === 'prompt') {
      respond(true, {});
      if (mode === 'fail') process.exit(3);
      if (mode === 'slow') continue;
      const turn = (sessions.get(current) ?? 0) + 1;
      sessions.set(current, turn);
      const text = mode === 'none' ? '' : turn > 1 && process.env.STUB_OMP_QUERY_FIX ? process.env.STUB_OMP_QUERY_FIX : process.env.STUB_OMP_QUERY ?? '';
      setImmediate(() => {
        send({type: 'message_end', message: {role: 'assistant', content: [{type: 'text', text}],
          usage: {input: 1000, output: 200, cacheRead: 50, cost: {total: 0.0025}}}});
        send({type: 'agent_end'});
      });
    } else respond(false, null, 'unsupported command');
  }
  process.exit(0);
}

const folder = value('--cwd') ?? process.cwd();
if (process.env.STUB_OMP_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Number(process.env.STUB_OMP_DELAY_MS)));
const mode = process.env.STUB_OMP_MODE ?? 'good';
const continued = args.includes('-c');
const BROKEN = '@r1 rule\n  when parent ?x ?y\n';
if (mode === 'fail') { console.error('stub failure'); process.exit(3); }
if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 60_000));
const good = process.env.STUB_OMP_GOOD ? fs.readFileSync(process.env.STUB_OMP_GOOD, 'utf8') : '@f1 fact\n  holds parent ann bob\n  source "stub"\n';
if (mode === 'good' || (mode === 'fix' && continued)) {
  fs.writeFileSync(path.join(folder, 'knowledge.sop'), good);
  fs.writeFileSync(path.join(folder, 'queries.sop'), '@q query\n  where parent ?x bob\n  select ?x\n');
  fs.writeFileSync(path.join(folder, 'report.md'), 'Stub report: nothing was left out.\n');
} else if (mode === 'fix' || mode === 'bad') {
  fs.writeFileSync(path.join(folder, 'knowledge.sop'), BROKEN);
}
const sessionDir = value('--session-dir');
if (sessionDir) {
  fs.mkdirSync(sessionDir, {recursive: true});
  const message = {role: 'assistant', content: [{type: 'text', text: `stub done (${mode})`}], usage: {input: 1000, output: 200, cacheRead: 50, cost: {total: 0.0025}}};
  fs.appendFileSync(path.join(sessionDir, 'stub-session.jsonl'), JSON.stringify({type: 'message', message}) + '\n');
}
console.log(JSON.stringify({type: 'agent_end'}));
