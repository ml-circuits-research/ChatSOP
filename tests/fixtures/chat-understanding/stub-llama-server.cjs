#!/usr/bin/env node
// Stand-in for llama-server in the chat understanding tests: logs its alias and requests; LanguageProofingLLM appends " (cleaned)".
const http = require('node:http'), fs = require('node:fs');
const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
const log = process.env.STUB_LOG, alias = arg('--alias');
fs.appendFileSync(log, JSON.stringify({start: alias}) + '\n');
http.createServer((req, res) => {
  if (req.url === '/health') { res.end('{"status":"ok"}'); return; }
  let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
    const body = JSON.parse(raw), message = body.messages.at(-1).content;
    fs.appendFileSync(log, JSON.stringify({alias, message}) + '\n');
    const content = alias === 'language-proofing-llm' ? message.replace(/\.$/, '') + ' (cleaned).' : alias === 'symbolic-proofing-llm' ? message : 'unused';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content}, finish_reason: 'stop'}]}));
  });
}).listen(Number(arg('--port')), arg('--host'));
