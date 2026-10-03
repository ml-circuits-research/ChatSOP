#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';

const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1];
const log = frame => fs.appendFileSync(process.env.STUB_RPC_LOG, JSON.stringify({pid: process.pid, ...frame}) + '\n');
const send = frame => process.stdout.write(JSON.stringify(frame) + '\n');
log({kind: 'spawn', args, cwd: process.cwd(), env_keys: Object.keys(process.env).filter(key => /KEY|TOKEN|SECRET|PASSWORD/.test(key))});
let next = 0;
let current = null;
const sessions = new Map();
send({type: 'ready', protocolVersion: 1});
for await (const line of readline.createInterface({input: process.stdin})) {
  const cmd = JSON.parse(line);
  log({kind: 'command', type: cmd.type, id: cmd.id, session: current, message: cmd.message, sessionPath: cmd.sessionPath});
  const respond = (success, data, error) => send({id: cmd.id, type: 'response', command: cmd.type, success,
    ...(success ? {data} : {error})});
  if (cmd.type === 'new_session') {
    if (process.env.STUB_RPC_CANCEL_RESET && next > 0) { respond(true, {cancelled: true}); continue; }
    current = `session-${process.pid}-${++next}`;
    sessions.set(current, 0);
    respond(true, {cancelled: false});
  } else if (cmd.type === 'switch_session') {
    if (process.env.STUB_RPC_BAD_SWITCH) { respond(true, {}); continue; }
    if (!sessions.has(cmd.sessionPath)) respond(false, undefined, 'session missing');
    else { current = cmd.sessionPath; respond(true, {}); }
  } else if (cmd.type === 'get_state') {
    respond(true, {sessionFile: current, messageCount: sessions.get(current), queuedMessageCount: 0,
      isStreaming: false, dumpTools: [], systemPrompt: [flag('--system-prompt')]});
  } else if (cmd.type === 'prompt') {
    respond(true, {});
    if (cmd.message === 'CRASH') process.exit(17);
    if (cmd.message === 'STALL') continue;
    if (cmd.message === 'NULL_FRAME') { send(null); continue; }
    if (cmd.message === 'ASYNC_ERROR') {
      setImmediate(() => respond(false, undefined, 'asynchronous prompt rejected'));
      continue;
    }
    if (cmd.message === 'TOOL') {
      send({type: 'tool_execution_start'});
      continue;
    }
    const turn = sessions.get(current) + 1;
    sessions.set(current, turn);
    setImmediate(() => {
      if (cmd.message === 'ASSISTANT_ERROR') {
        send({type: 'message_end', message: {role: 'assistant', stopReason: 'error', errorMessage: 'provider failed', content: []}});
        send({type: 'agent_end'});
        return;
      }
      if (cmd.message === 'TRUNCATED') {
        send({type: 'message_end', message: {role: 'assistant', stopReason: 'length', content: [{type: 'text', text: '@u unclear\n  kind gibberish\n'}],
          usage: {input: 10, output: 7, cacheRead: 2, cost: {total: 0.00125}}}});
        send({type: 'agent_end'});
        return;
      }
      const message = {type: 'message_end', message: {role: 'assistant', content: [{type: 'text', text: `${current}:${turn}:${cmd.message}`}],
        usage: {input: turn * 10, output: 7, cacheRead: 2, cost: {total: 0.00125}}}};
      const serialized = JSON.stringify(message) + '\n';
      process.stdout.write(serialized.slice(0, 13));
      setTimeout(() => { process.stdout.write(serialized.slice(13)); send({type: 'agent_end'}); }, 2);
    });
  } else respond(false, undefined, 'unknown command');
}
