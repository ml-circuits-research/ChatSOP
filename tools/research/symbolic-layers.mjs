#!/usr/bin/env node
/** Experiment eval-symbolic-layers-en-v1: layered blame of the English symbolic path (Stanza UD -> lib/ud-to-sop -> SOP).
 *
 *   node tools/research/symbolic-layers.mjs sample                         # stratified 400-message sample, halves A/B
 *   node tools/research/symbolic-layers.mjs parse                          # Stanza parses (GPU), sentence units, renderings
 *   node tools/research/symbolic-layers.mjs judge [--limit N] [--parallel 6] [--only ids.json]   # Layer 1 Haiku judge (cached)
 *   node tools/research/symbolic-layers.mjs convert --rules v1.2|v1.3 [--half A|B|all]           # Layer 2 rules SOP + scores
 *   node tools/research/symbolic-layers.mjs rewrite [--parallel 6]         # Layer 3 rewrites of DEEP/FAIL sentences
 *
 * Preregistration: status/preregistrations/eval-symbolic-layers-en-v1.json. Outputs under
 * eval/reports/current/symbolic-layers/. The judge and the rewriter are Claude Haiku 4.5 without thinking through
 * headless `claude -p` (no tools, empty settings); every response is cached by the sha256 of its full input.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {mulberry, tolerantScores, goldsOf} from './ud-baseline-eval.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = path.join(ROOT, 'eval/reports/current/symbolic-layers');
export const MODEL = 'claude-haiku-4-5-20251001';
const SUITES = {test: 'eval/suites/formalizer-v1/test.jsonl', ood: 'eval/suites/formalizer-ood-v1/test.jsonl', wild: 'eval/suites/formalizer-wild-v1/test.jsonl'};
const QUOTA = {test: 160, ood: 120, wild: 120};
const SEED = 20260929;

export const sha = text => createHash('sha256').update(text).digest('hex');
export const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
export const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
export const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function argumentsOf(argv) {
  const [command, ...rest] = argv; const args = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); args[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return args;
}

// ------------------------------------------------------------------ sample

export const QGROUP = {yes_no: 'yes_no', wh: 'wh', where: 'wh', when: 'wh', why: 'wh', how: 'wh', value: 'wh', definition: 'wh', count: 'count', how_many_times: 'count',
  since_when: 'time', until_when: 'time', how_long: 'time', universal: 'quant', quantified: 'quant', exists: 'quant', multi: 'multi', alternative: 'multi', compare: 'multi',
  order: 'multi', superlative: 'multi', numeric: 'numeric', claim_check: 'claim_check', none: 'none', fragment: 'none', advice: 'none', unclear: 'unclear', ambiguous: 'unclear'};
export const lengthBucket = text => (text.length <= 100 ? 'short' : text.length <= 300 ? 'medium' : 'long');
const isGibberishGold = row => /kind gibberish/.test(row.sop_target ?? '');

function sampleCommand() {
  const random = mulberry(SEED);
  const shuffle = xs => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
  const out = {seed: SEED, method: 'per source: English, non-gibberish gold, one row per semantic case; strata question-type group x length; proportional allocation (floor 2 per stratum, long capped at 12%); seeded order alternates halves A/B within each stratum (one running alternation per source, so odd strata balance out)', sources: {}, items: []};
  for (const [source, file] of Object.entries(SUITES)) {
    const seen = new Set();
    const rows = readJsonlShardedSync(path.join(ROOT, file)).filter(row => row.language === 'en' && !isGibberishGold(row)).filter(row => {
      const key = row.semantic_case_id ?? row.id; if (seen.has(key)) return false; seen.add(key); return true;
    });
    const strat = row => (QGROUP[row.question_type] ?? 'other') + '|' + lengthBucket(row.question);
    const groups = new Map();
    for (const row of rows) { const k = strat(row); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row); }
    for (const list of groups.values()) shuffle(list);
    const total = QUOTA[source];
    const longCap = Math.round(total * 0.12);
    const weight = ([, list]) => list.length;
    const keys = [...groups].sort((a, b) => a[0].localeCompare(b[0]));
    const alloc = new Map(keys.map(([k, list]) => [k, Math.min(list.length, 2)]));
    let longUsed = [...alloc].filter(([k]) => k.endsWith('|long')).reduce((a, [, n]) => a + n, 0);
    const weights = keys.map(entry => [entry[0], weight(entry)]);
    const wsum = weights.reduce((a, [, w]) => a + w, 0);
    let left = total - [...alloc.values()].reduce((a, b) => a + b, 0);
    const exact = weights.map(([k, w]) => ({k, want: left * w / wsum}));
    for (const e of exact) { const room = groups.get(e.k).length - alloc.get(e.k); let add = Math.min(room, Math.floor(e.want)); if (e.k.endsWith('|long')) add = Math.max(0, Math.min(add, longCap - longUsed)); alloc.set(e.k, alloc.get(e.k) + add); if (e.k.endsWith('|long')) longUsed += add; }
    left = total - [...alloc.values()].reduce((a, b) => a + b, 0);
    for (const e of [...exact].sort((a, b) => (b.want % 1) - (a.want % 1) || a.k.localeCompare(b.k))) {
      if (left <= 0) break;
      if (e.k.endsWith('|long') && longUsed >= longCap) continue;
      if (alloc.get(e.k) < groups.get(e.k).length) { alloc.set(e.k, alloc.get(e.k) + 1); left--; if (e.k.endsWith('|long')) longUsed++; }
    }
    for (const [k, list] of keys) if (left > 0 && !k.endsWith('|long')) { const add = Math.min(left, list.length - alloc.get(k)); alloc.set(k, alloc.get(k) + add); left -= add; }
    out.sources[source] = {suite: file, eligible: rows.length, sha256: sha(fs.readFileSync(path.join(ROOT, file))), allocation: Object.fromEntries(alloc), population: Object.fromEntries(keys.map(([k, l]) => [k, l.length]))};
    let turn = 0;
    for (const [k, list] of keys) list.slice(0, alloc.get(k)).forEach(row => out.items.push({id: row.id, source, stratum: k, qtype: row.question_type, qgroup: QGROUP[row.question_type] ?? 'other', length: lengthBucket(row.question), chars: row.question.length, half: turn++ % 2 === 0 ? 'A' : 'B'}));
  }
  writeJson(path.join(OUT, 'sample.json'), out);
  const count = (key) => out.items.reduce((a, it) => ({...a, [it[key]]: (a[it[key]] ?? 0) + 1}), {});
  console.log('items', out.items.length, count('source'), count('half'), count('length'), count('qgroup'));
}

/** Sample items joined with their suite rows. */
export function loadItems() {
  const sample = readJson(path.join(OUT, 'sample.json'));
  const rows = {};
  for (const [source, file] of Object.entries(SUITES)) rows[source] = new Map(readJsonlShardedSync(path.join(ROOT, file)).map(r => [r.id, r]));
  return sample.items.map(item => ({...item, row: rows[item.source].get(item.id)}));
}

// ------------------------------------------------------------------ parse and render

const CLAUSAL = new Set(['root', 'advcl', 'acl', 'acl:relcl', 'ccomp', 'xcomp', 'csubj', 'csubj:pass', 'parataxis']);
const WH = new Set(['who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how']);
/** Clause-by-clause reading of a parse (who does what to whom), derived mechanically from the arcs. */
export function renderReading(sentence) {
  const words = sentence.words;
  const kids = new Map(words.map(w => [w.id, []]));
  for (const w of words) if (w.head) kids.get(w.head)?.push(w);
  const isPred = w => CLAUSAL.has(w.deprel) || (w.deprel === 'conj' && (isPredWord(w) || kids.get(w.id).some(k => /^(nsubj|csubj|cop|aux)/.test(k.deprel))));
  const isPredWord = w => ['VERB', 'AUX'].includes(w.upos) || kids.get(w.id)?.some(k => k.deprel === 'cop');
  const subtree = (w, stop) => { const out = [w]; for (const k of kids.get(w.id)) if (!stop(k)) out.push(...subtree(k, stop)); return out; };
  const span = w => subtree(w, k => isPred(k) || k.deprel === 'punct').sort((a, b) => a.id - b.id).map(x => x.text).join(' ');
  const clauses = words.filter(isPred);
  const lines = [];
  clauses.forEach((c, i) => {
    const head = c.head ? words.find(w => w.id === c.head) : null;
    const how = c.deprel === 'root' ? 'main clause' : `${c.deprel} clause attached to "${head?.text}" (${head?.id})`;
    const ks = kids.get(c.id);
    const mark = ks.filter(k => k.deprel === 'mark').map(k => k.text);
    const cop = ks.find(k => k.deprel === 'cop');
    const aux = ks.filter(k => /^aux/.test(k.deprel)).map(k => k.text);
    const neg = ks.filter(k => k.deprel === 'advmod' && /^(not|never|n't|no)$/i.test(k.lemma === 'not' ? 'not' : k.text)).map(k => k.text);
    const prt = ks.filter(k => k.deprel === 'compound:prt').map(k => k.text);
    lines.push(`Clause ${i + 1} [${how}]${mark.length ? ' introduced by "' + mark.join(' ') + '"' : ''}: predicate "${c.text}" (${c.id}, lemma ${c.lemma}${prt.length ? ' + particle ' + prt.join(' ') : ''}, ${c.upos})${cop ? ' with copula "' + cop.text + '"' : ''}${aux.length ? ', aux: ' + aux.join(' ') : ''}${neg.length ? ', NEGATED by "' + neg.join(' ') + '"' : ''}`);
    for (const k of ks) {
      if (/^(nsubj|csubj)/.test(k.deprel)) lines.push(`   ${k.deprel === 'nsubj:pass' ? 'passive subject' : 'subject'}: "${span(k)}" (head ${k.text} ${k.id})`);
      else if (k.deprel === 'obj') lines.push(`   object: "${span(k)}" (head ${k.text} ${k.id})`);
      else if (k.deprel === 'iobj') lines.push(`   indirect object: "${span(k)}" (head ${k.text} ${k.id})`);
      else if (/^obl/.test(k.deprel)) { const cs = kids.get(k.id).filter(x => x.deprel === 'case').map(x => x.text); lines.push(`   oblique${cs.length ? ' [' + cs.join(' ') + ']' : ''} (${k.deprel}): "${span(k)}" (head ${k.text} ${k.id})`); }
      else if (k.deprel === 'expl') lines.push(`   expletive: "${k.text}"`);
      else if (k.deprel === 'advmod' && !neg.includes(k.text)) lines.push(`   adverb: "${span(k)}"`);
    }
  });
  const nmods = words.filter(w => /^nmod/.test(w.deprel));
  for (const n of nmods) { const h = words.find(w => w.id === n.head); const cs = kids.get(n.id).filter(x => x.deprel === 'case').map(x => x.text); lines.push(`Noun attachment (${n.deprel}): "${span(n)}"${cs.length ? ' [' + cs.join(' ') + ']' : ''} modifies "${h?.text}" (${h?.id})`); }
  const conjs = words.filter(w => w.deprel === 'conj' && !isPred(w));
  for (const c of conjs) { const h = words.find(w => w.id === c.head); lines.push(`Coordination: "${c.text}" (${c.id}) coordinated with "${h?.text}" (${h?.id})`); }
  const whs = words.filter(w => WH.has(w.text.toLowerCase()));
  for (const w of whs) { const h = words.find(x => x.id === w.head); lines.push(`Question/relative word "${w.text}" (${w.id}): ${w.deprel} of "${h?.text ?? 'ROOT'}"`); }
  const ents = []; let cur = null;
  for (const w of words) { const tag = w.ner ?? 'O'; if (tag === 'O') { cur = null; continue; } if (/^[BS]-/.test(tag) || !cur) { cur = {type: tag.slice(2), words: [w.text]}; ents.push(cur); } else cur.words.push(w.text); if (/^[ES]-/.test(tag)) cur = null; }
  if (ents.length) lines.push('Named entities: ' + ents.map(e => `"${e.words.join(' ')}" ${e.type}`).join('; '));
  return lines.join('\n');
}

/** Readable rendering of one parsed sentence for the judge. */
export function renderSentence(sentence) {
  const words = sentence.words;
  const byId = new Map(words.map(w => [w.id, w]));
  const lines = words.map(w => {
    const head = w.head === 0 ? 'ROOT' : `${w.head}:${byId.get(w.head)?.text ?? '?'}`;
    const ner = w.ner && w.ner !== 'O' ? '  NER=' + w.ner : '';
    return `${String(w.id).padStart(2)}  ${w.text}  lemma=${w.lemma}  ${w.upos}  head=${head}  ${w.deprel}${ner}`;
  });
  return 'READING (derived from the arcs):\n' + renderReading(sentence) + '\n\nARCS (index form lemma UPOS head relation NER):\n' + lines.join('\n');
}

async function parseCommand() {
  const {StanzaWorker} = await import('../../lib/ud-to-sop/stanza.mjs');
  const {maskMessage} = await import('../../lib/ud-to-sop/index.mjs');
  const items = loadItems();
  const worker = new StanzaWorker({device: 'cuda'});
  const info = await worker.start();
  const parses = [], sentences = [];
  for (let i = 0; i < items.length; i += 64) {
    const chunk = items.slice(i, i + 64);
    const {parses: ps} = await worker.parseMany(chunk.map(it => maskMessage(it.row.question)));
    chunk.forEach((it, j) => {
      const p = ps[j];
      parses.push({id: it.id, masked: p.text, parse: p});
      const units = splitSentences(it.row.question);
      p.sentences.forEach((s, k) => {
        // Boundary agreement with the repository segmenter: a Stanza sentence whose span is not exactly one segmenter unit.
        const same = units.some(u => Math.abs(u.start - s.start) <= 1 && Math.abs(u.end - s.end) <= 1);
        sentences.push({key: `${it.id}#${k}`, id: it.id, index: k, source: it.source, half: it.half, qgroup: it.qgroup, length: it.length, language: s.language,
          text: it.row.question.slice(s.start, s.end), start: s.start, end: s.end, words: s.words.length, segmenter_match: same, rendering: renderSentence(s)});
      });
      if (!p.sentences.length) sentences.push({key: `${it.id}#0`, id: it.id, index: 0, source: it.source, half: it.half, qgroup: it.qgroup, length: it.length, language: 'en', text: it.row.question, start: 0, end: it.row.question.length, words: 0, segmenter_match: true, rendering: '(no words: the whole message was masked)', empty: true});
    });
  }
  await worker.stop();
  writeJsonl(path.join(OUT, 'parses.jsonl'), parses);
  writeJsonl(path.join(OUT, 'sentences.jsonl'), sentences);
  const segUnits = items.reduce((a, it) => a + splitSentences(it.row.question).length, 0);
  console.log(`device ${info.device}; messages ${items.length}; stanza sentences ${sentences.length}; segmenter units ${segUnits}; boundary mismatches ${sentences.filter(s => !s.segmenter_match).length}`);
}

// ------------------------------------------------------------------ Claude calls

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'symbolic-layers-'));
let pauseUntil = 0;
export function callClaude(system, message, timeoutMs = 180000) {
  return new Promise(resolve => {
    const args = ['-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--system-prompt', system,
      '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'];
    const child = spawn('claude', args, {cwd: scratch, env: {...process.env, MAX_THINKING_TOKENS: '0'}, stdio: ['pipe', 'pipe', 'pipe']});
    child.stdin.end(message);
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('close', code => { clearTimeout(timer); resolve({code, out, err}); });
  });
}

/** Cached call: returns {ok, text, cost, ms}; the cache key is the sha256 of system + message. */
export async function cachedCall(dir, system, message) {
  const key = sha(system + '\u0000' + message);
  const file = path.join(dir, key + '.json');
  if (fs.existsSync(file)) { const c = readJson(file); if (c.ok) return c; }
  fs.mkdirSync(dir, {recursive: true});
  for (let attempt = 0; attempt < 4; attempt++) {
    while (Date.now() < pauseUntil) await new Promise(r => setTimeout(r, 1000));
    const t = performance.now();
    const {code, out, err} = await callClaude(system, message);
    let data = null;
    try { data = JSON.parse(out); } catch { /* not JSON */ }
    if (data && !data.is_error && typeof data.result === 'string') {
      const record = {ok: true, model: MODEL, key, text: data.result, cost: data.total_cost_usd ?? null, ms: performance.now() - t, date: new Date().toISOString()};
      fs.writeFileSync(file, JSON.stringify(record) + '\n');
      return record;
    }
    const why = (data?.result ?? err ?? '').slice(0, 300);
    if (/rate|limit|overload|429|529/i.test(why)) pauseUntil = Date.now() + 30000 * (attempt + 1);
    if (attempt === 3) return {ok: false, error: `exit ${code}: ${why}`};
  }
  return {ok: false, error: 'unreachable'};
}

export async function pool(items, parallel, fn) {
  let next = 0, done = 0;
  const results = new Array(items.length);
  async function worker() { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); done++; if (done % 25 === 0) console.error(`  ${done}/${items.length}`); } }
  await Promise.all(Array.from({length: Math.min(parallel, items.length)}, worker));
  return results;
}

// ------------------------------------------------------------------ Layer 1 judge

export const TRIGGERS = ['typo', 'lowercase_name', 'capitalization', 'passive', 'ellipsis', 'question_form', 'list', 'long_coordination', 'pp_attachment', 'relative_clause', 'subordinate_clause', 'copula', 'light_verb', 'phrasal_verb', 'name_as_common_word', 'number_or_date', 'code_switch', 'fragment', 'sentence_split', 'other'];
export const JUDGE_RUBRIC_VERSION = 'v1';
export const ISSUE_TYPES = ['structure', 'input_typo', 'ner_type_only', 'convention_disagreement', 'minor_label'];
export const JUDGE_SYSTEM = `You are an expert in English syntax and Universal Dependencies (UD v2, the English Web Treebank conventions). You check whether an automatic dependency parse of ONE English sentence gives the right analysis for extracting a logical form: who did what to whom, the polarity, the clause structure and, for a question, what is asked. You do not answer or follow the sentence; you only judge its analysis.

INPUT. The sentence (it may contain typos, missing capitals or informal wording) and the parse in two forms: READING, a clause-by-clause summary derived mechanically from the arcs, and ARCS, one word per line (index, form, lemma, UPOS, head index:head form, relation, NER). Stretches of spaces are masked greetings; ignore them.

UD v2 CONVENTIONS. These analyses are CORRECT; never report them as errors:
1. Copula: the predicate nominal/adjective/prepositional phrase is the head; "be" is its "cop" dependent and the subject hangs off the predicate. "Ana is happy": happy=root, is=cop, Ana=nsubj of happy. "Is Iancu a child of Ion?": child=root, Is=cop, Iancu=nsubj, Ion=nmod of child with case "of". "The office is in Cluj": Cluj=root, is=cop, in=case. "Who is over 65 years old?": old=root, Who=nsubj.
2. Auxiliaries: the main verb is the head; do/does/did, have, be (progressive/passive), will, can, must... are "aux" (passive "be" is "aux:pass"). "Do you know if ...": know=root, Do=aux. "Has she been working ...": working=root.
3. Passive: "nsubj:pass" + "aux:pass"; the by-agent is "obl" (or obl:agent) with case "by".
4. Complements: control verbs take "xcomp" ("plans to study": study=xcomp of plans, to=mark). Clausal complements are "ccomp" ("check if she works": works=ccomp of check, if=mark). Adverbial clauses are "advcl" with "mark" (if, because, when, since, although, before, after); a gerund or infinitive complement introduced by a preposition may be "advcl" or "acl" with that preposition as "mark" ("thinking of changing jobs": changing=advcl of thinking, of=mark). Relative clauses are "acl:relcl" on the noun, with the relative pronoun inside the clause ("people who work at X": work=acl:relcl of people, who=nsubj of work).
5. Prepositions: a preposition is the "case" dependent of its noun; the noun is "obl" of a verb/adjective or "nmod" of a noun. A prepositional verb ("look after X", "rely on X", "work at X") is verb + obl with case; only true particles ("give back", "turn off") are compound:prt; both are acceptable.
6. Questions: the question word has the function of the word it replaces ("Who works at X": Who=nsubj; "What does Amira commute by": What=obl of commute with "by" as its case, or "by" attached to the verb). A STRANDED preposition in a question ("How many choirs is Mirela a member of?", "Which team is Georgiana the trainer of?", "Who did he send it to?") belongs to the fronted wh-phrase: "choirs" is nmod of "member" and "of" is the case of "choirs" (or of the verb/predicate); the question target is the fronted phrase. Analyses that make the fronted phrase a SECOND nsubj of the predicate, or leave "of"/"to" hanging with no link to the asked phrase, are STRUCTURE errors (they change what is asked).
7. Negation "not/n't/never" is advmod (UD v2 has no "neg"). Names inside a name may be flat or compound. Temporal nouns may be obl:tmod, obl:npmod, obl:unmarked or nmod:tmod. Discourse words and lead-ins ("so", "also", "please", "Fact-check:", "Quick question:", "Any idea") may be discourse, advmod, parataxis, dep, vocative or even the root with the real clause as parataxis/ccomp/dep; that is acceptable when the real clause is intact (e.g. "Fact-check: Kavya doesn't train the Falcons." with check=root and train=parataxis of check is acceptable, at most MINOR). Complex prepositions ("apart from X", "instead of X", "because of X", "according to X") may be analysed as X=obl of the verb with the words as case/fixed, or as the first word (advmod) with X as its obl: both are acceptable.
8. "How many times" / "how often": "times" may be obl:npmod, obl:tmod, obj or advmod of the verb; any of these is acceptable as long as "how many" modifies "times".

ISSUE TYPES. Classify every problem you find with exactly one type:
- structure: a wrong head or relation that changes the logical form (see DEEP).
- input_typo: the input word itself is misspelled ("mwade", "teadh", "kmow", "lcated") and the parser gives it the right structural position (the arc head and relation are right) but a non-word lemma or an odd tag. This is input noise, not a parse error. If the typo makes the parser build a WRONG structure (a misspelled verb tagged NOUN with the arguments hanging off it, a word split in two that becomes an argument), that is a structure issue with trigger typo.
- ner_type_only: an entity span with the wrong type (a person tagged ORG), or a missing/extra NER label, when the words themselves are analysed right; names are copied verbatim downstream, so this never matters for the logical form.
- convention_disagreement: an analysis you would have done differently but which is a defensible UD v2 option (see the conventions above); list only when you are unsure.
- minor_label: any other wrong arc or label that does not change who did what to whom, the polarity, the clause structure or the question target (det, punct, amod vs compound, nmod vs obl on a correct head, an adverb attached one level off, obl:tmod vs obl).

VERDICT (about the analysis, not the input):
- DEEP: at least one structure issue: a wrong analysis that would change the logical form: who did what to whom (wrong subject, object or oblique head or attachment; an argument taken for the predicate or vice versa), the polarity (negation attached to the wrong clause or lost), the clause structure (a subordinate or relative clause missed, attached to the wrong clause or turned into the main clause; two sentences glued so one becomes an argument of the other), or the question target (the question word or fronted phrase given the wrong function; a question read as a statement).
- FAIL: no usable predicate-argument structure at all (most words hang off a noun or a punctuation mark; the sentence is a word salad of fragments).
- INPUT_TYPO: no structure issue, but at least one input_typo issue.
- MINOR: no structure or input_typo issue, but some minor_label / ner_type_only / convention_disagreement issue.
- CORRECT: no issue at all.

Probable trigger of each structure issue, from this closed list: ${TRIGGERS.join(', ')}.

Answer with ONE JSON object and nothing else, no Markdown:
{"verdict": "CORRECT|MINOR|INPUT_TYPO|DEEP|FAIL",
 "elements": {"predicate": "ok|wrong|na", "subject": "ok|wrong|na", "objects": "ok|wrong|na", "obliques": "ok|wrong|na", "negation": "ok|wrong|na", "clauses": "ok|wrong|na", "question": "ok|wrong|na", "entities": "ok|wrong|na", "copula": "ok|wrong|na"},
 "issues": [{"word": "<index>:<form>", "got": "<head index>:<head form> <relation>", "expected": "<head index>:<head form> <relation>", "type": "structure|input_typo|ner_type_only|convention_disagreement|minor_label", "trigger": "<trigger>"}],
 "error_type": "<short label of the main structure error, or 'none'>",
 "triggers": ["<trigger of each structure issue>"],
 "note": "<one sentence>"}
"elements" marks "wrong" only for structure issues. Use "na" when the element does not occur. List at most 8 issues, the structure issues first.`;

export const REVIEW_SYSTEM = JUDGE_SYSTEM.replace('You check whether', 'You are the second reviewer. A first reviewer has claimed that the parse below has structure errors. First reviewers often flag valid UD v2 analyses (copula heads, aux, xcomp, advcl with mark, prepositional verbs), input typos or NER types as structure errors, or misread the sentence. Check each claimed structure issue yourself against the conventions: keep it only if it really changes the logical form, retype it otherwise (input_typo, ner_type_only, convention_disagreement, minor_label), and add any real structure error the first reviewer missed. Then give your own final verdict. You check whether');
export function reviewMessage(sentence, first) {
  return `${judgeMessage(sentence)}\n\nFIRST REVIEWER (verdict ${first.verdict}, main error: ${first.error_type ?? ''}):\n${(first.wrong_arcs ?? []).map(a => `- ${a.word}: got ${a.got}; claimed expected ${a.expected} (${a.type ?? a.severity})`).join('\n') || '- (no arcs listed)'}\nNote: ${first.note ?? ''}`;
}
export function judgeMessage(sentence) {
  return `SENTENCE: ${sentence.text}\n\nPARSE:\n${sentence.rendering}`;
}
export function parseJudge(text) {
  const raw = String(text ?? '').replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1));
    if (!['CORRECT', 'MINOR', 'INPUT_TYPO', 'DEEP', 'FAIL'].includes(j.verdict)) return null;
    j.issues = Array.isArray(j.issues) ? j.issues : Array.isArray(j.wrong_arcs) ? j.wrong_arcs : [];
    j.wrong_arcs = j.issues;
    j.rubric = JUDGE_RUBRIC_VERSION;
    j.triggers = Array.isArray(j.triggers) ? j.triggers.filter(t => TRIGGERS.includes(t)) : [];
    return j;
  } catch { return null; }
}

async function judgeCommand(args) {
  const sentences = readJsonl(path.join(OUT, 'sentences.jsonl'));
  let todo = sentences.filter(s => !s.empty && s.language === 'en');
  if (args.only) { const keys = new Set(readJson(path.resolve(args.only))); todo = todo.filter(s => keys.has(s.key)); }
  if (args.limit) todo = todo.slice(0, Number(args.limit));
  const dir = path.join(OUT, 'cache/judge');
  const results = await pool(todo, Number(args.parallel ?? 6), async s => {
    const r = await cachedCall(dir, JUDGE_SYSTEM, judgeMessage(s));
    const first = r.ok ? parseJudge(r.text) : null;
    const out = {key: s.key, ok: r.ok, judge: first, first, raw: r.ok ? r.text : r.error, cost: r.cost ?? null, ms: r.ms ?? null};
    // Stage 2 (deviation D1): a DEEP or FAIL verdict is re-checked arc by arc against UD v2 before it counts.
    if (first && ['DEEP', 'FAIL'].includes(first.verdict)) {
      const r2 = await cachedCall(path.join(OUT, 'cache/review'), REVIEW_SYSTEM, reviewMessage(s, first));
      const second = r2.ok ? parseJudge(r2.text) : null;
      out.review = second; out.cost = (out.cost ?? 0) + (r2.cost ?? 0);
      if (second) out.judge = second;
    }
    return out;
  });
  const file = path.join(OUT, 'judgments.jsonl');
  const prior = new Map(readJsonl(file).map(j => [j.key, j]));
  for (const r of results) prior.set(r.key, r);
  const order = new Map(sentences.map((s, i) => [s.key, i]));
  writeJsonl(file, [...prior.values()].sort((a, b) => order.get(a.key) - order.get(b.key)));
  const got = results.filter(r => r.judge);
  const dist = got.reduce((a, r) => ({...a, [r.judge.verdict]: (a[r.judge.verdict] ?? 0) + 1}), {});
  console.log(`judged ${results.length}; unusable ${results.length - got.length}; cost ${results.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(3)} USD`, dist);
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const commands = {sample: sampleCommand, parse: parseCommand, judge: judgeCommand};
  if (commands[args.command]) return commands[args.command](args);
  const extra = await import('./symbolic-layers-2.mjs');
  if (extra.COMMANDS[args.command]) return extra.COMMANDS[args.command](args);
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

export {tolerantScores, goldsOf, execFileSync};
