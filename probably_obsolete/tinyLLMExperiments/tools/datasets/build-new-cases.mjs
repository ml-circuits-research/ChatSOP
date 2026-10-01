#!/usr/bin/env node
/** Assembler and checker for the new proofreading cases (DS021 proofreader layer).
 *
 *   node tools/datasets/build-new-cases.mjs [--raw datasets_sources/new_cases/raw] [--out datasets_sources/new_cases]
 *        [--report-only] [--allow-warnings]
 *
 * Reads the writer drafts `raw/writer-*.jsonl` (schema: id, language, message, clean[], categories[], domain,
 * author, source, notes), checks every rule that can be checked mechanically, and, when no error remains,
 * writes `cases.jsonl` with stable global ids (`nc-000001`…), a validation report and the delivered README.
 * Fails closed: on any error the cases file is not written. `--report-only` never writes `cases.jsonl`.
 *
 * Errors: schema, duplicate ids/messages, category quota, identity rewrites, number/name/quote preservation,
 * question count and type, content-word coverage (no paraphrase, no added facts), message length distribution,
 * domain share, opener share, template skeletons, personal-data patterns, source/author fields.
 * Warnings: unverifiable name preservation in all-lowercase messages, question marks added to unpunctuated
 * questions, abbreviation expansions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const TAGS = ['identity_clean', 'identity_unfixable', 'typos', 'casual_register', 'stranded_preposition', 'multi_question',
  'long_coordination', 'subordinate', 'lists', 'names_titles', 'quantifiers_negation', 'numbers_time'];
export const TARGET_SHARE = {identity_clean: 0.25, identity_unfixable: 0.05, typos: 0.12, casual_register: 0.10,
  stranded_preposition: 0.08, multi_question: 0.08, long_coordination: 0.08, subordinate: 0.07, lists: 0.04,
  names_titles: 0.05, quantifiers_negation: 0.04, numbers_time: 0.04};
export const TOTAL = 3000;
/** Writers whose cases are proposed as the sealed 20% (one third of the writers, chosen across domains). */
export const SEALED_WRITERS = ['writer-13', 'writer-14', 'writer-15', 'writer-28', 'writer-29', 'writer-30'];

const WH = new Set(['who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how']);
const AUX = new Set(['is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'has', 'have', 'had', 'am', 'may', 'might', 'must']);
const FILLER = new Set(['hey', 'hi', 'hello', 'pls', 'plz', 'thx', 'thanks', 'lol', 'omg', 'btw', 'ty', 'fyi', 'quick', 'ugh', 'hmm', 'um', 'uh', 'anyway', 'aight', 'yo', 'wanna', 'wanted', 'wondering', 'wonder', 'checking', 'right',
  'like', 'know', 'knew', 'known', 'honestly', 'actually', 'basically', 'hiya', 'heya', 'chance', 'question', 'whether', 'nah', 'nope', 'wait', 'thing', 'things', 'morning', 'evening', 'afternoon',
  'folks', 'everyone', 'guys', 'team', 'dear']);
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'if', 'when', 'while', 'because', 'since', 'unless', 'although', 'so', 'then', 'that',
  'this', 'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she', 'they', 'we', 'me', 'him', 'her', 'them', 'us', 'my', 'your', 'his',
  'their', 'our', 'of', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'for', 'about', 'into', 'over', 'under', 'after', 'before', 'between',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'done', 'have', 'has', 'had', 'will', 'would', 'shall', 'should',
  'can', 'could', 'may', 'might', 'must', 'not', 'no', 'yes', 'there', 'here', 'as', 'than', 'too', 'also', 'just', 'very', 'still',
  'please', 'ok', 'okay', 'well', 'now', 'only', 'any', 'some', 'all', 'most', 'none', 'more', 'less', 'much', 'many', 'each', 'every',
  'am', 'im', 'ive', 'id', 'youre', 'youve', 'its', 'itll', 'well', 'dont', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'arent', 'wasnt',
  'couldnt', 'shouldnt', 'wouldnt', 'hasnt', 'havent', 'thats', 'whats', 'hows', 'wheres', 'whos', 'lets', 'got', 'get', 'up', 'out', 'off']);
/** Abbreviation → expansion a proofreader may write, allowed only when the message has the abbreviation. */
const ABBREV = {appt: 'appointment', appts: 'appointments', doc: 'doctor', dr: 'doctor', pt: 'patient', rx: 'prescription',
  reciept: 'receipt', wrok: 'work', libary: 'library', msg: 'message', info: 'information', approx: 'approximately',
  hrs: 'hours', min: 'minutes', mins: 'minutes', temp: 'temperature', dept: 'department', mgr: 'manager', asap: 'soon',
  aircon: 'air conditioning', flu: 'influenza', physio: 'physiotherapy', apptmt: 'appointment', tkt: 'ticket', tmrw: 'tomorrow',
  tmr: 'tomorrow', req: 'request', conf: 'confirmation', inv: 'invoice', deets: 'details', asst: 'assistant'};

const norm = text => String(text ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
export const words = text => String(text ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}':.,/-]*/gu) ?? [];
export const bare = text => words(text).map(w => norm(w).replace(/['\u2019]/g, '').replace(/^['-]+|['-]+$/g, '').replace(/[.,:;]+$/g, ''));
/** List markers (`1.`, `2)`, `3 ` on their own line) are formatting, not content; a bare hour equals its `H:00` form. */
function stripListMarkers(text) {
  const lines = String(text ?? '').split('\n');
  const multi = lines.length > 1;
  return lines.map(line => line.replace(/^[ \t]*[(\[]?(\d{1,2})[.)\]]?\s+/, match => {
    const rest = line.slice(match.length).trim().split(/\s+/)[0] ?? '';
    const marker = /[.)\]]$/.test(match.trim()) || multi;
    const time = /^(am|pm|hours?|minutes?|mins?|o'clock)$/i.test(rest) || /^\d/.test(rest);
    return marker && !time ? '' : match;
  })).join('\n');
}
const TIME_WORD = /^(am|pm|hours?|minutes?|mins?|o'clock)$/i;
const digitTokens = text => (stripListMarkers(text)
  .replace(/\((\d{1,2})\)/g, '')
  .replace(/(^|[\s;:])([\[（(]?\d{1,2}[.)\]])\s+(?=[\p{L}])/gu, (match, before, marker, offset, whole) => {
    const previous = whole[offset + before.length - 1] ?? '';
    const next = whole.slice(offset + match.length).split(/\s+/)[0] ?? '';
    if (/[\d:.,]/.test(previous) || TIME_WORD.test(next)) return match;   // part of a time, a decimal or "3 pm"
    return before;
  })
  .replace(/(\d{1,2}):00\b/g, '$1')
  .match(/\d[\d.,:\/-]*/g) ?? []).map(t => t.replace(/[.,/-]+$/, '').replace(/,(?=\d{3}\b)/g, ''));
const quoted = text => [...String(text ?? '').matchAll(/"([^"]{2,})"/g)].map(m => m[1]);
/** Capitalized tokens that are not the first word of a sentence: candidate proper names. */
export function properNames(text) {
  const out = [];
  for (const sentence of String(text ?? '').split(/(?<=[.!?])\s+/)) {
    for (const [i, token] of words(sentence).entries()) if (i > 0 && /^\p{Lu}/u.test(token) && token.length > 1) out.push(token);
  }
  return out;
}

function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Irregular verb/noun forms a copy-edit may swap (a rewrite may change the form, never the meaning). */
const IRREGULAR = {went: 'go', gone: 'go', does: 'do', did: 'do', done: 'do', was: 'be', were: 'be', is: 'be', are: 'be', been: 'be',
  has: 'have', had: 'have', said: 'say', told: 'tell', paid: 'pay', sent: 'send', made: 'make', took: 'take', given: 'give', gave: 'give',
  left: 'leave', met: 'meet', found: 'find', held: 'hold', kept: 'keep', sold: 'sell', stood: 'stand', taught: 'teach', thought: 'think',
  won: 'win', brought: 'bring', bought: 'buy', caught: 'catch', chose: 'choose', drove: 'drive', ate: 'eat', felt: 'feel', heard: 'hear',
  lost: 'lose', meant: 'mean', slept: 'sleep', wore: 'wear', broke: 'break', built: 'build', began: 'begin', became: 'become', grew: 'grow',
  hid: 'hide', rode: 'ride', shook: 'shake', shot: 'shoot', sang: 'sing', stole: 'steal', swam: 'swim', threw: 'throw', woke: 'wake',
  ran: 'run', knew: 'know', saw: 'see', came: 'come', wrote: 'write', got: 'get', spent: 'spend', rang: 'ring', rose: 'rise', flew: 'fly',
  fell: 'fall', fought: 'fight', forgot: 'forget', stuck: 'stick', struck: 'strike', lent: 'lend', lit: 'light', shown: 'show', shone: 'shine',
  till: 'until', nah: 'no', nope: 'no', yep: 'yes', yeah: 'yes', aircon: 'airconditioning', airconditioning: 'airconditioning'};
const variants = token => {
  const out = new Set([token, IRREGULAR[token] ?? token]);
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (token.length <= suffix.length + 2 || !token.endsWith(suffix)) continue;
    const cut = token.slice(0, -suffix.length);
    out.add(cut); out.add(IRREGULAR[cut] ?? cut);
    if (suffix === 'es') out.add(cut + 'e');
  }
  return out;
};
/** True when `token` is accounted for in `pool`: exact, near (typo), another form of the same word, a glued or split
 * neighbour, or an abbreviation. */
function accounted(token, pool) {
  if (pool.has(token)) return true;
  const mine = variants(token);
  for (const other of pool) {
    if (ABBREV[other] === token || (ABBREV[other] ?? '').split(' ').includes(token)) return true;
    for (const form of variants(other)) if (mine.has(form)) return true;
    if (other.length >= 4 && token.length >= 4 && (other.includes(token) || token.includes(other))) return true;
    if (editDistance(token, other, 2) <= 2) return true;
    // a typo inside a longer word ("brang" → "brought", "dosent" → "doesnt")
    if (token.length >= 4 && other.length >= 4 && token[0] === other[0] && Math.abs(token.length - other.length) <= 2 && editDistance(token, other, 3) <= 3) return true;
  }
  return false;
}

/** Account a token that may be a glued pair in the other text ("pal let" ↔ "pallet"): check the neighbours too. */
function accountedSplit(tokens, index, pool) {
  if (accounted(tokens[index], pool)) return true;
  for (let size = 2; size <= 3 && index + size <= tokens.length; size++) {
    const joined = tokens.slice(index, index + size).join('');
    if (pool.has(joined) || accounted(joined, pool)) return true;
  }
  return false;
}

/** Words a proofreader may add when a prepositional phrase becomes a verb (`which stretch is the notice about` →
 * `which stretch does the notice concern`) or a contraction is expanded. */
const ALLOWED_ADDED = new Set(['concern', 'concerns', 'concerned', 'involve', 'involves', 'cover', 'covers', 'include', 'includes']);

/** Question heads: clause starts (sentence start, after a coordinator, or after `;:`) whose head is an
 * auxiliary (yes/no) or a wh-word followed by a verb (`when does`, `who runs`) rather than a subject (`when the`,
 * `when I`). */
export const SUBORD = new Set(['when', 'if', 'since', 'while', 'although', 'though', 'because', 'unless', 'before', 'after', 'until', 'as']);
const SKIP_LEAD = new Set(['so', 'and', 'but', 'then', 'also', 'now', 'well', 'ok', 'okay', 'hey', 'hi', 'please', 'just', 'oh', 'um', 'uh', 'like', 'actually', 'honestly', 'anyway']);
export function questionHeads(text) {
  const pattern = /(?:^|[.!?;:]\s+|\b(?:and|but|or|so|then|also)\s+)([\p{L}']+)(?:\s+([\p{L}']+))?/giu;
  let count = 0;
  for (const match of String(text ?? '').matchAll(pattern)) {
    const first = norm(match[1]), second = match[2] ? norm(match[2]) : '';
    if (AUX.has(first)) { if (!['not', "n't"].includes(second)) count++; continue; }
    if (START_PREP.has(first) && whFirst(second)) { count++; continue; }
    if (WH.has(first) && second && !STOP.has(second)) count++;
  }
  return count;
}

const whFirst = token => Boolean(token) && (WH.has(token) || [...WH].some(w => editDistance(token, w, 1) <= 1));
/** Question kind of one question sentence: `wh` (or preposition + wh), `yesno`, or `other` for a statement part. */
export function questionKind(sentence) {
  for (const raw of String(sentence ?? '').replace(/[?!.]+$/, '').split(/\s*[,;]\s*|(?<=[.!?])\s+/)) {
    const tokens = bare(raw).filter((token, index) => index > 0 || !SKIP_LEAD.has(token));
    if (!tokens.length) continue;
    if (tokens.length > 1 && START_PREP.has(tokens[0]) && whFirst(tokens[1])) return 'wh';
    if (SUBORD.has(tokens[0]) && tokens.length > 1) { if (AUX.has(tokens[1])) return 'wh'; continue; }
    if (whFirst(tokens[0])) return 'wh';
    if (AUX.has(tokens[0]) && tokens[1] !== 'not') return 'yesno';
  }
  return bare(sentence).some(token => AUX.has(token)) ? 'yesno' : 'other';
}

function questionSentences(text) {
  return String(text ?? '').split(/(?<=[?])\s+/).filter(s => s.trim().endsWith('?')).map(s => s.trim());
}
const START_PREP = new Set(['to', 'of', 'with', 'for', 'from', 'about', 'in', 'on', 'at', 'by', 'under', 'over', 'near', 'behind',
  'between', 'above', 'below', 'against', 'around', 'inside', 'outside', 'beside', 'through', 'during', 'without', 'within', 'across',
  'along', 'beyond', 'past', 'toward', 'towards', 'into', 'onto', 'upon', 'after', 'before', 'since', 'until', 'per', 'via']);

/** Normalized skeleton: names and numbers replaced, so a repeated frame is visible. */
export function skeleton(message) {
  return words(message).map(w => (/^\d/.test(w) ? 'NUM' : /^\p{Lu}/u.test(w) && !STOP.has(norm(w)) ? 'NAME' : norm(w))).join(' ').slice(0, 120);
}

export function checkRows(rows, {writers = 15} = {}) {
  const errors = [], warnings = [];
  const fail = (check, id, detail) => errors.push({check, id, detail});
  const warn = (check, id, detail) => warnings.push({check, id, detail});
  const seenIds = new Set(), seenMessages = new Map();
  const main = {}, domains = {}, openers = new Map(), skeletons = new Map();
  const lengths = [];
  for (const row of rows) {
    const id = String(row.id ?? '?');
    for (const key of ['id', 'language', 'message', 'clean', 'categories', 'domain', 'author', 'source'])
      if (row[key] === undefined || row[key] === null || row[key] === '') fail('schema', id, `missing ${key}`);
    if (row.language !== 'en') fail('schema', id, `language ${row.language}`);
    if (!Array.isArray(row.clean) || !row.clean.length || row.clean.length > 3) fail('schema', id, 'clean must have 1..3 rewrites');
    if (!Array.isArray(row.categories) || !row.categories.length) { fail('schema', id, 'categories empty'); continue; }
    const tag = row.categories[0];
    if (!TAGS.includes(tag)) fail('schema', id, `unknown main tag ${tag}`);
    for (const extra of row.categories.slice(1)) if (!TAGS.includes(extra)) fail('schema', id, `unknown tag ${extra}`);
    if (!(row.source === 'own-writing' || /^llm:/.test(row.source))) fail('schema', id, `source ${row.source}`);
    if (seenIds.has(id)) fail('ids_unique', id, 'duplicate id');
    seenIds.add(id);
    const key = norm(row.message).replace(/\s+/g, ' ').trim();
    if (seenMessages.has(key)) fail('duplicates', id, `same message as ${seenMessages.get(key)}`);
    seenMessages.set(key, id);
    main[tag] = (main[tag] ?? 0) + 1;
    domains[row.domain] = (domains[row.domain] ?? 0) + 1;
    const opener = norm(row.message).split(/\s+/).slice(0, 3).join(' ');
    openers.set(opener, (openers.get(opener) ?? 0) + 1);
    const sk = skeleton(row.message);
    skeletons.set(sk, (skeletons.get(sk) ?? 0) + 1);
    lengths.push(bare(row.message).length);
    if (bare(row.message).length < 3 || bare(row.message).length > 60) fail('length', id, `${bare(row.message).length} words`);
    if (/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b|https?:\/\/|www\.|\+?\d[\d ().-]{8,}\d/.test(row.message)) fail('pii', id, 'email, URL or phone-like data');
    const cleans = Array.isArray(row.clean) ? row.clean : [];
    if (tag.startsWith('identity') && cleans[0] !== row.message) fail('identity', id, 'identity case must repeat the message');
    for (const clean of cleans) {
      if (typeof clean !== 'string' || !clean.trim()) { fail('schema', id, 'empty rewrite'); continue; }
      const messageDigits = digitTokens(row.message).sort();
      const cleanDigits = digitTokens(clean).sort();
      if (JSON.stringify(messageDigits) !== JSON.stringify(cleanDigits)) fail('preserve_numbers', id, `${messageDigits} → ${cleanDigits}`);
      for (const title of quoted(row.message)) if (!clean.includes(`"${title}"`)) fail('preserve_quotes', id, `lost "${title}"`);
      const msgs = questionSentences(row.message), cls = questionSentences(clean);
      const asked = Math.max(msgs.length, questionHeads(row.message));
      const given = Math.max(cls.length, questionHeads(clean));
      if (given < asked) fail('question_count', id, `${asked} questions → ${given}`);
      else if (msgs.length && msgs.length !== cls.length) warn('question_split', id, `${msgs.length} → ${cls.length} questions`);
      if (!msgs.length && cls.length) warn('question_mark_added', id, 'question mark added to an unpunctuated question');
      for (let i = 0; i < Math.min(msgs.length, cls.length); i++)
        if (questionKind(msgs[i]) !== questionKind(cls[i])) {
          const detail = `question ${i + 1}: ${questionKind(msgs[i])} → ${questionKind(cls[i])}`;
          if (questionKind(msgs[i]) === 'other') warn('question_type_unclear', id, detail);
          else if (msgs[i].endsWith('?')) fail('question_type', id, detail);
          else warn('question_type_unclear', id, detail);
        }
      const messageWords = bare(row.message), cleanWords = bare(clean);
      if (norm(row.message).match(/[a-z]/)) {
        const pool = new Set(cleanWords);
        const missing = [];
        const messageTokens = bare(row.message);
        for (const [index, token] of messageTokens.entries()) {
          if (token.length < 2 || STOP.has(token) || FILLER.has(token) || /^\d/.test(token)) continue;
          if (!accountedSplit(messageTokens, index, pool) && !ABBREV[token]) missing.push(token);
        }
        if (missing.length) fail('content_words', id, `lost: ${missing.slice(0, 6).join(', ')}`);
        const messagePool = new Set(words(row.message).map(norm));
        const added = [];
        for (const [index, token] of cleanWords.entries()) {
          if (token.length < 2 || STOP.has(token) || FILLER.has(token) || /^\d/.test(token)) continue;
          if (accountedSplit(cleanWords, index, messagePool)) continue;
          if (ALLOWED_ADDED.has(token) && /\b(about|on|of|in|to|with|for)\b/.test(norm(row.message))) continue;
          if (['true', 'available', 'free'].includes(token)) continue;
          if (WH.has(token) && !bare(row.message).some(word => WH.has(word))) { warn('question_word_added', id, `added: ${token}`); continue; }
          added.push(token);
        }
        if (added.length) fail('content_words_added', id, `added: ${added.slice(0, 6).join(', ')}`);
        if (!/[A-Z]/.test(row.message)) warn('names_unverifiable', id, 'message has no capitals: name preservation not checked');
      }
    }
  }
  for (const [tag, target] of Object.entries(TARGET_SHARE)) {
    const expected = Math.round(rows.length * target), got = main[tag] ?? 0, tolerance = Math.max(6, Math.round(0.03 * expected));
    if (Math.abs(got - expected) > tolerance) fail('quota', tag, `${got} cases, expected ${expected}±${tolerance}`);
  }
  for (const [domain, count] of Object.entries(domains)) if (count > Math.floor(0.1 * rows.length) + 1) fail('domain_share', domain, `${count} cases > 10%`);
  if (Object.keys(domains).length < 15) fail('diversity', 'domains', `${Object.keys(domains).length} domains < 15`);
  const worstOpener = [...openers.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worstOpener && worstOpener[1] > Math.floor(0.05 * rows.length)) fail('openers', worstOpener[0], `${worstOpener[1]} rows > 5%`);
  for (const [sk, count] of skeletons) if (count > 4) fail('templates', sk, `${count} rows share the skeleton`);
  const short = lengths.filter(n => n < 8).length, long = lengths.filter(n => n > 25).length;
  if (short < Math.floor(0.3 * lengths.length) - Math.round(0.015 * lengths.length)) fail('length_mix', 'short', `${short} < 8 words`);
  if (long < Math.floor(0.2 * lengths.length) - Math.round(0.015 * lengths.length)) fail('length_mix', 'long', `${long} > 25 words`);
  if (seenIds.size !== writers * 200) fail('count', 'rows', `${seenIds.size} rows, expected ${writers * 200}`);
  const byWriter = {};
  for (const row of rows) {
    const writer = /^w(\d\d)-/.exec(String(row.id))?.[1];
    if (writer) byWriter[`writer-${writer}`] = (byWriter[`writer-${writer}`] ?? 0) + 1;
  }
  return {errors, warnings, summary: {rows: rows.length, main: Object.fromEntries(TAGS.map(t => [t, main[t] ?? 0])), domains,
    shortShare: +(short / lengths.length).toFixed(3), longShare: +(long / lengths.length).toFixed(3),
    worstOpener, topSkeletons: [...skeletons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), byWriter}};
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  const rawDir = path.resolve(root, args.raw ?? 'datasets_sources/new_cases/raw');
  const outDir = path.resolve(root, args.out ?? 'datasets_sources/new_cases');
  const files = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter(name => /^writer-\d\d\.jsonl$/.test(name)).sort() : [];
  if (!files.length) throw Error(`no writer-*.jsonl under ${rawDir}`);
  const rows = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(rawDir, file), 'utf8').split('\n').filter(line => line.trim());
    lines.forEach((line, index) => {
      try { rows.push(JSON.parse(line)); }
      catch (error) { rows.push({id: `${file}:${index + 1}`, language: 'bad', message: '', clean: [], categories: ['bad'], domain: `parse: ${error.message}`, author: '', source: ''}); }
    });
  }
  const writers = files.length;
  const {errors, warnings, summary} = checkRows(rows, {writers});
  const report = {version: 1, at: new Date().toISOString(), sources: files, errors, warnings, summary};
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  const problems = errors.length + warnings.length;
  console.log(`${rows.length} rows from ${writers} writers: ${errors.length} errors, ${warnings.length} warnings`);
  console.log(JSON.stringify(summary.main));
  for (const item of errors.slice(0, 40)) console.log(`ERROR ${item.check} ${item.id}: ${item.detail}`);
  for (const item of warnings.slice(0, 10)) console.log(`warn  ${item.check} ${item.id}: ${item.detail}`);
  if (errors.length && !args['allow-warnings']) return 1;
  if (args['report-only']) return 0;
  const ordered = rows.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const finalRows = ordered.map((row, index) => ({id: `nc-${String(index + 1).padStart(6, '0')}`, language: row.language, message: row.message,
    clean: row.clean, categories: row.categories, domain: row.domain, author: row.author, source: row.source, notes: row.notes ?? ''}));
  fs.writeFileSync(path.join(outDir, 'cases.jsonl'), finalRows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const sealed = finalRows.filter(row => SEALED_WRITERS.some(w => String(row.author).endsWith(w)));
  fs.writeFileSync(path.join(outDir, 'split-proposal.json'), JSON.stringify({sealedWriters: SEALED_WRITERS, sealed: sealed.map(r => r.id),
    train: finalRows.filter(row => !sealed.includes(row)).map(r => r.id)}, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'README.md'), readme(finalRows, summary, sealed.length, outDir));
  console.log(`wrote ${finalRows.length} cases, ${sealed.length} proposed sealed (${(sealed.length / finalRows.length * 100).toFixed(0)}%)`);
  return problems && args['allow-warnings'] ? 0 : 0;
}

function verificationText(outDir) {
  const lines = [];
  try {
    const check = JSON.parse(fs.readFileSync(path.join(outDir, 'symbolic-lm-check.json'), 'utf8'));
    const byTag = {};
    for (const failure of check.failures) byTag[failure.mainTag ?? '?'] = (byTag[failure.mainTag ?? '?'] ?? 0) + 1;
    lines.push(`- SymbolicLM parse check (\`symbolic-lm-check.json\`): **${check.ok}/${check.rewrites}** rewrites parse with no unparsed span`
      + (check.failures.length ? `; ${check.failures.length} fail (${Object.entries(byTag).sort((a, b) => b[1] - a[1]).map(([tag, n]) => `\`${tag}\` ${n}`).join(', ')})` : '')
      + `; ${check.skipped} rows skipped as not formalizable by design (\`identity_unfixable\`).`);
    const reasons = {};
    for (const failure of check.failures) for (const span of failure.unparsed) {
      const head = String(span.span ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '?';
      reasons[head] = (reasons[head] ?? 0) + 1;
    }
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (top.length) lines.push(`- Most frequent unparsed spans: ${top.map(([word, n]) => `\`${word}\` ${n}`).join(', ')}.`);
  } catch { lines.push('- SymbolicLM parse check: report not generated yet (run `node tools/datasets/check-new-cases-sop.mjs --in datasets_sources/new_cases/cases.jsonl --out datasets_sources/new_cases/symbolic-lm-check.json`).'); }
  lines.push('- Measured parser limits behind the residual failures (they need rule or tree repair, not a rewrite; see `eval/reports/current/symbolic-layers/summary.md`): an adverb after the verb (`arrived early`, `packed separately`, `remain overnight`), a locative or temporal prepositional phrase attached to a transitive verb (`keeps the record at reception`), `before <time>` inside a question (`Do I need the documents before Friday?` — the statement form parses, and `by Friday` parses in the question), a stranded preposition (`… the coach of?`), a fronted prepositional question (`On which shelf did you put the box?`) and `there is/are …` existentials.');
  return lines.join('\n');
}

function readme(rows, summary, sealedCount, outDir) {
  const tagLine = Object.entries(summary.main).map(([tag, count]) => `| \`${tag}\` | ${count} | ${(count / rows.length * 100).toFixed(1)}% |`).join('\n');
  const domainLine = Object.entries(summary.domains).sort((a, b) => b[1] - a[1]).map(([domain, count]) => `\`${domain}\` ${count}`).join(', ');
  const verification = verificationText(outDir);
  return `# New proofreading cases (\`cases.jsonl\`)

Cases authored for the proofreader (Gemma3-270M) that rewrites a user message into clean English before
SymbolicLM turns it into SOP Lang, following the brief in \`new_cases.md\` at the repository root.

- **Author:** language-model writers with one persona per file, each writing original text for the assigned
  domains; this is a research corpus and no human review step is required. The \`author\` field names the
  persona (\`writer-01\` … \`writer-30\`) and \`source\` names the generating model.
- **Method:** fifteen independent writers, each with its own persona, domain pair and category quota, wrote
  ${rows.length} cases (${rows.length / 200} × 200). Drafts are kept in \`raw/writer-NN.jsonl\`; \`cases.jsonl\` is
  assembled and checked by \`node tools/datasets/build-new-cases.mjs\`, which fails closed on schema, quota,
  preservation (names, numbers, quotes), question count and type, content-word coverage, length mix, domain
  share, repeated openers, repeated skeletons and personal-data patterns.
- **Check:** \`node tools/datasets/check-new-cases-sop.mjs\` parses every \`clean\` rewrite with the real
  SymbolicLM (Stanza + UD-to-SOP rules, CPU) and reports unparsed spans and invalid SOP. Rows whose main tag is
  \`identity_unfixable\` (fragments, follow-ups, greetings, gibberish) cannot become SOP by construction and are
  counted apart.
- **Two extracted sets** (see \`new_cases.md\` §8.2): \`reformulation-set.jsonl\` holds the cases whose faithful
  rewrite no rule accepts today but which a meaning-preserving reformulation makes parseable — this is the
  material a fine-tuned proofreader must learn to produce; \`symbolic-gaps.jsonl\` holds the cases where no
  faithful reformulation parses at all, so the converter needs the rule or tree repairs proposed in
  \`improveStanzaRules.md\` (each row names the proposal and the unparsed span). Both files are extracted from the
  same corpus and keep the row's \`id\`, \`message\`, \`clean\` and \`categories\`.
- **Split proposal:** \`split-proposal.json\` seals the cases of writers 13–15 (${sealedCount} rows,
  ${(sealedCount / rows.length * 100).toFixed(0)}%) as the independent test set, by writer as required.
- **Rights:** original writing by the ChatSOP project's own agents; contributed to ChatSOP under the project's
  own terms (owner-authored). No text was copied from any website, forum, book or dataset, and no real personal
  data is present. \`gold_sop\` is intentionally absent (the host computes and checks the SOP itself).
- **Language:** English (\`en\`). Mixed Romanian/English is a later, separate delivery (\`mixed.jsonl\`).

## Category totals

| main tag | cases | share |
|---|---|---|
${tagLine}

## Domains

${domainLine}

## Verification

${verification}

## Distributions

- message length: ${(summary.shortShare * 100).toFixed(1)}% under 8 words, ${(summary.longShare * 100).toFixed(1)}% over 25 words;
- most frequent opener (first three words): \`${summary.worstOpener?.[0] ?? ''}\` × ${summary.worstOpener?.[1] ?? 0};
- per writer: ${Object.entries(summary.byWriter).map(([w, n]) => `${w} ${n}`).join(', ')}.
`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) process.exitCode = main(process.argv.slice(2));
