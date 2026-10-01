#!/usr/bin/env node
// Stand-in for tools/symbolic-lm.mjs in the chat understanding tests: serves /health and /v1/chat/completions, answers with a fixed
// model SOP and reports back the host options it received (`symbolic_lm`), so a test can see what the server sent.
import http from 'node:http';
import fs from 'node:fs';
const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
const log = process.env.STUB_LOG;
const sop = '@q query\n  where match\n    relation "likes"\n    role subject "Ana"\n    role object "Alpha Lab"\n    polarity affirmed\n  end';
http.createServer((req, res) => {
  if (req.url === '/health') { res.end('{"status":"ok"}'); return; }
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    if (log) fs.appendFileSync(log, JSON.stringify({service: true, body}) + '\n');
    const asked = body.symbolic_lm ?? {};
    const message = body.messages.at(-1).content;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: sop}, finish_reason: 'stop'}],
      symbolic_lm: {route: 'direct', language: 'en', uncertainty: {uncertain: false, kinds: [], reasons: []}, english: null, analysed_text: message, analysis: null,
        rewrite: asked.rewrite_url ? {input: message, output: message, applied: false, gate: asked.rewrite_when, acceptance: asked.rewrite_accept, units: []} : null,
        ...(asked.interpret ? {interpretation: {version: 'stub', available: true, text: message, sentences: [{index: 0, text: message, status: 'verified', cnl: message, cnl_sentences: [message], certified: true, not_represented: [], rewrite: null}], not_represented: [], certified: true}} : {}),
        received: asked}}));
  });
}).listen(Number(arg('--port')), arg('--host'));
