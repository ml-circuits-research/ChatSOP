import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requireField = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw Error(`Missing ${label}`);
  return value;
};
const identifier = value => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) throw Error('Invalid source ID');
  return value;
};
const utf8 = bytes => {
  const value = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  if (!Buffer.from(value, 'utf8').equals(bytes)) throw Error('Input must be canonical UTF-8 without BOM');
  return value;
};
const json = value => JSON.stringify(value, null, 2) + '\n';
const store = (file, value) => {
  const content = json(value);
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink() || fs.readFileSync(file, 'utf8') !== content) throw Error(`Immutable artifact conflict: ${file}`);
    return;
  }
  fs.writeFileSync(file, content, {flag: 'wx', mode: 0o600});
};
const parseOptions = args => {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Expected --name value pairs');
    const key = args[i].slice(2);
    if (Object.hasOwn(opts, key)) throw Error(`Duplicate --${key}`);
    opts[key] = args[i + 1];
  }
  return opts;
};
const paragraphSegments = (value, page, baseOffset) => {
  const result = [];
  const pattern = /[^\r\n]+(?:\r?\n[^\r\n]+)*/g;
  let match;
  let index = 0;
  while ((match = pattern.exec(value)) !== null) {
    const passage = match[0];
    if (!passage.trim()) continue;
    result.push({page, paragraph: ++index, offset: baseOffset + Buffer.byteLength(value.slice(0, match.index)), text: passage});
  }
  return result;
};
const splitPages = value => {
  let offset = 0;
  const result = [];
  for (const [i, page] of value.split('\f').entries()) {
    result.push(...paragraphSegments(page, i + 1, offset));
    offset += Buffer.byteLength(page) + 1;
  }
  return result;
};
const extract = (file, extension, raw) => {
  if (['.txt', '.md'].includes(extension)) {
    const source = utf8(raw);
    return {extractor: 'canonical-utf8', passages: paragraphSegments(source, null, 0), extracted: source};
  }
  if (extension === '.pdf') {
    let bytes;
    try { bytes = execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], {maxBuffer: 3_000_000}); }
    catch (error) { throw Error(`PDF extraction unavailable or failed: ${error.message}`); }
    const extracted = utf8(bytes);
    return {extractor: 'pdftotext -enc UTF-8', passages: splitPages(extracted), extracted};
  }
  if (['.docx', '.html', '.htm'].includes(extension)) {
    const kind = extension === '.docx' ? 'docx' : 'html';
    let output;
    try { output = execFileSync('python3', [path.join(here, 'extract.py'), kind, file], {encoding: 'utf8', maxBuffer: 3_000_000}); }
    catch (error) { throw Error(`${kind.toUpperCase()} extraction unavailable or failed: ${error.stderr?.toString().trim() || error.message}`); }
    const texts = JSON.parse(output);
    let offset = 0;
    const passages = texts.map((text, i) => {
      const item = {page: null, paragraph: i + 1, offset, text};
      offset += Buffer.byteLength(text) + 2;
      return item;
    });
    return {extractor: kind === 'docx' ? 'python3 stdlib zipfile/ElementTree' : 'python3 stdlib HTMLParser', passages, extracted: texts.join('\n\n')};
  }
  throw Error(`Unsupported format ${extension || '(none)'}: no verified local adapter`);
};
const safeRoot = workspace => {
  const root = path.resolve(requireField(workspace, 'workspace'));
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('Workspace symlink forbidden');
  return root;
};
const sourceDir = root => path.join(root, 'datasets', 'knowledge', 'source');
const implicitDir = root => path.join(root, 'datasets', 'knowledge', 'implicit');
export const readSource = (root, id) => {
  const file = path.join(sourceDir(root), `${identifier(id)}.json`);
  if (fs.lstatSync(file).isSymbolicLink()) throw Error('Source symlink forbidden');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.id !== id || record.version !== 1 || record.rights?.status !== 'authorized' ||
      !['.txt', '.md', '.docx', '.pdf', '.html', '.htm'].includes(record.format)) throw Error('Source record invalid');
  const rawFile = path.join(sourceDir(root), `${id}${record.format}`);
  if (fs.lstatSync(rawFile).isSymbolicLink()) throw Error('Source symlink forbidden');
  const raw = fs.readFileSync(rawFile);
  const recovered = extract(rawFile, record.format, raw);
  if (hash(raw) !== record.rawSha256 || hash(recovered.extracted) !== record.extractedSha256 ||
      json(recovered.passages) !== json(record.passages)) throw Error('Source bytes or passages changed');
  return record;
};
export const cite = (root, citation) => {
  const source = readSource(root, citation?.sourceId);
  if (source.rawSha256 !== citation.sourceSha256) throw Error('Source checksum mismatch');
  const location = citation.passage;
  const passage = source.passages.find(p => p.page === location?.page && p.paragraph === location?.paragraph && p.offset === location?.offset);
  if (!passage) throw Error('Unknown source passage locator');
  const quote = requireField(citation.quote, 'quote');
  if (!Number.isSafeInteger(citation.quoteOffset)) throw Error('Missing byte-exact quote offset');
  const relative = citation.quoteOffset - passage.offset;
  if (relative < 0 || !Buffer.from(passage.text, 'utf8').subarray(relative, relative + Buffer.byteLength(quote)).equals(Buffer.from(quote, 'utf8'))) throw Error('Quote is not a byte-exact passage span');
  return {source, passage};
};

export function runSources(command, args) {
  const opts = parseOptions(args);
  const accepted = command === 'prepare-sources' ? ['workspace', 'manifest'] : ['workspace', 'input', 'project-root'];
  for (const key of Object.keys(opts)) if (!accepted.includes(key)) throw Error(`Unsupported --${key}`);
  const root = safeRoot(opts.workspace);
  if (command === 'prepare-sources') {
    const manifest = JSON.parse(fs.readFileSync(requireField(opts.manifest, 'manifest'), 'utf8'));
    if (!Array.isArray(manifest.sources) || !manifest.sources.length) throw Error('Manifest requires nonempty sources');
    const records = manifest.sources.map(s => {
      const id = identifier(s.id);
      const rights = s.rights;
      if (rights?.status !== 'authorized') throw Error(`Source ${id} missing explicit authorized rights`);
      requireField(rights.basis, 'rights basis');
      requireField(s.scope, 'source scope');
      requireField(s.revision, 'source revision');
      if (!Number.isSafeInteger(s.budget?.maxBytes) || s.budget.maxBytes < 1 || !Number.isSafeInteger(s.budget?.maxPassages) || s.budget.maxPassages < 1) throw Error(`Source ${id} requires positive byte and passage budgets`);
      const file = path.resolve(path.dirname(path.resolve(opts.manifest)), requireField(s.file, 'source file'));
      const raw = fs.readFileSync(file);
      if (raw.length > s.budget.maxBytes || raw.length > 20_000_000) throw Error(`Source ${id} exceeds byte budget`);
      const extension = path.extname(file).toLowerCase();
      const {extractor, passages, extracted} = extract(file, extension, raw);
      if (Buffer.byteLength(extracted) > 2_000_000 || !passages.length || passages.length > s.budget.maxPassages) throw Error(`Source ${id} exceeds extraction budget or contains no text`);
      return {record: {version: 1, id, origin: file, revision: s.revision, rights, scope: s.scope, budget: s.budget, format: extension, extractor, rawSha256: hash(raw), extractedSha256: hash(extracted), passages}, raw};
    });
    if (new Set(records.map(({record}) => record.id)).size !== records.length) throw Error('Duplicate source ID');
    fs.mkdirSync(sourceDir(root), {recursive: true, mode: 0o700});
    fs.mkdirSync(implicitDir(root), {recursive: true, mode: 0o700});
    fs.mkdirSync(path.join(root, 'temporary'), {recursive: true, mode: 0o700});
    for (const {record, raw} of records) {
      const original = path.join(sourceDir(root), `${record.id}${record.format}`);
      if (fs.existsSync(original)) {
        if (fs.lstatSync(original).isSymbolicLink() || !fs.readFileSync(original).equals(raw)) throw Error(`Immutable source conflict: ${original}`);
      } else fs.writeFileSync(original, raw, {flag: 'wx', mode: 0o600});
      store(path.join(sourceDir(root), `${record.id}.json`), record);
    }
    console.log(json({status: 'source-only-unapproved', sources: records.map(({record: r}) => ({id: r.id, format: r.format, passages: r.passages.length, rawSha256: r.rawSha256}))}));
    return;
  }
  if (command !== 'review-sources') throw Error(`Unknown command ${command}`);
  const input = JSON.parse(fs.readFileSync(requireField(opts.input, 'input'), 'utf8'));
  if (!Array.isArray(input.facts) || !input.facts.length) throw Error('Review requires facts');
  // The ChatSOP adapter is used only for validation. No repository is opened here.
  const validated = input.facts.map(fact => ({fact, ...cite(root, fact)}));
  return import(path.join(path.resolve(requireField(opts['project-root'], 'project root')), 'sop/parser.mjs')).then(async parser => {
    const ingest = await import(path.join(path.resolve(opts['project-root']), 'sop/ingest.mjs'));
    for (const {fact, source, passage} of validated) {
      const parsed = parser.parse(fact.sop);
      if (parsed.wires.length !== 1 || parsed.wires[0].type !== 'fact' || parsed.wires[0].fields.source?.[0] !== source.id || parsed.wires[0].fields.quote?.[0] !== JSON.stringify(fact.quote)) throw Error('Fact SOP source/quote mismatch');
      ingest.prepareKnowledge(fact.sop, {reviewed: true, documents: {[source.id]: passage.text}, requireQuotes: true});
    }
    const draft = {version: 1, status: 'agent-draft-unapproved', facts: input.facts, sha256: hash(json(input.facts))};
    store(path.join(implicitDir(root), 'facts.json'), draft);
    console.log(json({status: draft.status, facts: draft.facts.length, sha256: draft.sha256}));
  });
}
