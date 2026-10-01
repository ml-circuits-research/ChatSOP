#!/usr/bin/env node
// Stand-in for the SymbolicLM service in the HTTP server tests: it forwards every chat-completion body to the in-test mock at
// STUB_CALLBACK_URL (which scripts the SOP, records the call and may delay it) and wraps the answer in the service's own report.
// A wrapper script in the test's temporary directory sets STUB_CALLBACK_URL, so every fixture server has its own mock.
import http from 'node:http';
const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
http.createServer((req, res) => {
  if (req.url === '/health') { res.end('{"status":"ok"}'); return; }
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', async () => {
    const message = JSON.parse(raw).messages.at(-1).content;
    try {
      const upstream = await fetch(process.env.STUB_CALLBACK_URL, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: raw});
      const answer = await upstream.json();
      const sop = answer.choices[0].message.content;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({choices: [{message: {content: sop}, finish_reason: 'stop'}],
        symbolic_lm: {route: 'direct', language: 'en', uncertainty: {uncertain: false, kinds: [], reasons: []}, english: null, analysed_text: message, analysis: null, rewrite: null}}));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({error: {message: String(error.message)}}));
    }
  });
}).listen(Number(arg('--port')), arg('--host'));
