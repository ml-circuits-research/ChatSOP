#!/usr/bin/env node
/** Model-surface phrase lint (guard G3 of eval/reports/history/no-context-sweep.md).
 *
 * The small formalizer sees the user's message only (DS021). This lint keeps the
 * documents that describe or teach the model surface from reintroducing the
 * retired context-bearing design: a shortlist, a CONTEXT + MESSAGE prompt,
 * canonical identifiers written by the model, or the retired `unclear` kinds.
 *
 * A match is exempt when its sentence clearly negates or retires the idea
 * ("no shortlist", "never", "removed", "legacy", "former", ...), and inside
 * `<pre data-sop="invalid">` examples, which show rejected output on purpose.
 * Usage: node tools/lint/model-surface.mjs [--json]; exit 1 on findings.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Files that describe the model surface; globs are expanded against the DS set. */
export const LINTED = [
  'server/prompts/formalizer.txt',
  ...['DS004', 'DS007', 'DS008', 'DS012', 'DS018', 'DS020', 'DS021'].map(id => ({specPrefix: id})),
  ...['stated', 'assumed', 'unclear', 'query', 'constraint', 'predicate', 'small-model', 'model-guide', 'question-types'].map(n => `docs/wire_typs/${n}.html`),
  'docs/wiki.html', 'docs/training.html', 'docs/runtime.html', 'docs/index.html',
  'README.md', 'AGENTS.md',
  ...['corpus-audit', 'evaluate-agent', 'synthetic-sop-data', 'training-rules', 'training-runbook'].map(n => `skills/${n}/SKILL.md`),
];

/** Forbidden phrases. `kind` rules only fire on the unclear-kind token itself. */
export const RULES = [
  {id: 'shortlist', re: /\bshort-?list(s|ed)?\b/i},
  {id: 'context-message-prompt', re: /CONTEXT\s*\+\s*MESSAGE/},
  {id: 'canonical-mentions', re: /\bcanonicalMentions\b/},
  {id: 'candidate-vocabulary', re: /\bcandidate (entities|predicates|aliases)\b/i},
  {id: 'usable-symbols', re: /\blist of usable symbols\b/i},
  {id: 'supplied-context', re: /\bsupplied context\b/i},
  {id: 'canonical-id', re: /\bcanonical (predicate|entity) IDs?\b/i},
  {id: 'model-facing-prompt', re: /\bin the model-facing prompt\b/i},
  {id: 'retired-unclear-kind', re: /(\bkind\s+|`|<code>)(nonsense|incomplete|contradictory|not_a_question|off_topic)\b/},
];

// A sentence with one of these cues states the idea only to negate, forbid or retire it.
const EXEMPT = /\b(no|not|never|without|neither|nor|removed|remove|retired|legacy|former|formerly|deleted|forbid|forbidden|forbids|rejects?|rejected|invalid|instead of|earlier|older|obsolete|sop-agent-3|guard|lint|bans?|banned)\b/i;

function files() {
  const specs = fs.readdirSync(path.join(ROOT, 'docs/specs'));
  return LINTED.flatMap(entry => typeof entry === 'string' ? [entry]
    : specs.filter(f => f.startsWith(entry.specPrefix + '-') && f.endsWith('.md')).map(f => `docs/specs/${f}`))
    .filter(rel => fs.existsSync(path.join(ROOT, rel)));
}

/** Blanks `<pre data-sop="invalid">` blocks (keeping line numbers) so rejected examples are not linted. */
const stripInvalid = text => text.replace(/<pre[^>]*data-sop="invalid"[^>]*>[\s\S]*?<\/pre>/g, m => m.replace(/[^\n]/g, ' '));

/** Lints one text; returns `[{line, rule, text}]`. */
export function lintText(text) {
  const findings = [];
  stripInvalid(text).split('\n').forEach((line, index) => {
    const plain = line.replace(/<[^>]+>/g, m => (m === '<code>' ? '<code>' : ' '));
    for (const sentence of plain.split(/(?<=[.!?])\s+|\s[—–]\s/)) {
      if (EXEMPT.test(sentence)) continue;
      for (const rule of RULES) if (rule.re.test(sentence)) findings.push({line: index + 1, rule: rule.id, text: sentence.trim().slice(0, 200)});
    }
  });
  return findings;
}

/** Lints every model-surface document; returns `[{file, line, rule, text}]`. */
export function lintModelSurface() {
  return files().flatMap(file => lintText(fs.readFileSync(path.join(ROOT, file), 'utf8')).map(f => ({file, ...f})));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = lintModelSurface();
  if (process.argv.includes('--json')) console.log(JSON.stringify({files: files().length, findings}, null, 2));
  else {
    for (const f of findings) console.log(`${f.file}:${f.line}: ${f.rule}: ${f.text}`);
    console.log(`model-surface lint: ${files().length} files, ${findings.length} finding(s)`);
  }
  process.exitCode = findings.length ? 1 : 0;
}
