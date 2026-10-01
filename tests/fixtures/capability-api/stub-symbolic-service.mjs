#!/usr/bin/env node
// Stand-in for tools/symbolic-lm.mjs in the capability API tests: like the chat-understanding stub, plus triggers in the message:
// "BOOM" makes the service fail (HTTP 500), "NOREP" reports the word "xyz" as not represented, "UNSURE" marks the sentence uncertain,
// "SLOW" answers after 60 ms. Every request is logged ({service: true, body}) so a test can count the real calls.
import http from 'node:http';
import fs from 'node:fs';
const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
const log = process.env.STUB_LOG;
const sop = '@q query\n  where match\n    relation "likes"\n    role subject "Ana"\n    role object "Alpha Lab"\n    polarity affirmed\n  end';
http.createServer((req, res) => {
  if (req.url === '/health') { res.end('{"status":"ok","caches":{"stub":{"entries":0}}}'); return; }
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', async () => {
    const body = JSON.parse(raw);
    if (log) fs.appendFileSync(log, JSON.stringify({service: true, body}) + '\n');
    const asked = body.symbolic_lm ?? {};
    const message = body.messages.at(-1).content;
    if (message.includes('SLOW')) await new Promise(resolve => setTimeout(resolve, 60));
    if (message.includes('BOOM')) { res.statusCode = 500; res.end('{"error":{"message":"stanza worker crashed"}}'); return; }
    const nr = message.includes('NOREP') ? ['xyz'] : [];
    const status = message.includes('UNSURE') ? 'uncertain' : 'verified';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: sop}, finish_reason: 'stop'}],
      symbolic_lm: {route: 'direct', language: 'en', uncertainty: {uncertain: false, kinds: [], reasons: []}, english: null, analysed_text: message, analysis: {language: 'en', sentences: []},
        rewrite: asked.rewrite_url ? {input: message, output: message, applied: false, gate: asked.rewrite_when, acceptance: asked.rewrite_accept, units: []} : null,
        ...(asked.interpret ? {interpretation: {version: 'stub', available: true, text: message, sentences: [{index: 0, text: message, start: 0, end: message.length, status, cnl: status === 'verified' ? message : null, cnl_sentences: [message], certified: true, not_represented: nr, rewrite: null, summary: 'root: stub'}], not_represented: nr, certified: true}} : {}),
        received: asked}}));
  });
}).listen(Number(arg('--port')), arg('--host'));
