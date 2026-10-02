import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {cite, readSource} from './sources.mjs';

const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw Error(`Missing ${label}`);
  return value;
};
const positive = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) throw Error(`Expected positive ${label}`);
  return value;
};
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const optsOf = (args, allowed) => {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Expected --name value pairs');
    const key = args[i].slice(2);
    if (!allowed.includes(key) || Object.hasOwn(opts, key)) throw Error(`Unsupported or repeated --${key}`);
    opts[key] = args[i + 1];
  }
  return opts;
};
const rootOf = opts => path.resolve(requireText(opts.workspace, 'workspace'));
const getInput = opts => JSON.parse(fs.readFileSync(requireText(opts.input, 'input'), 'utf8'));
const sourceIds = root => fs.readdirSync(path.join(root, 'datasets/knowledge/source')).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();

function explore(root, input) {
  const modes = ['focused', 'broad-bounded', 'adaptive', 'near-exhaustive'];
  if (!modes.includes(input.mode)) throw Error('Unknown exploration mode');
  const limits = input.budget;
  const maxProbes = positive(limits?.maxProbes, 'probe budget');
  const maxBytes = positive(limits?.maxBytes, 'byte budget');
  const maxMs = positive(limits?.maxMs, 'time budget');
  if (!Array.isArray(input.questions) || !input.questions.length) throw Error('Exploration requires questions');
  const started = performance.now();
  const ids = sourceIds(root);
  if (!ids.length) throw Error('No prepared sources');
  const sources = new Map();
  const questions = input.questions.map(q => {
    requireText(q.id, 'question ID');
    requireText(q.question, 'question');
    requireText(q.needle, 'literal source needle');
    if (q.sourceId && !ids.includes(q.sourceId)) throw Error(`Unknown source ${q.sourceId}`);
    if (input.mode === 'focused' && !q.sourceId) throw Error('Focused question requires sourceId');
    return q;
  });
  if (new Set(questions.map(q => q.id)).size !== questions.length) throw Error('Duplicate question ID');
  const matches = [];
  let probes = 0, bytes = 0, stopped = null;
  // A probe compares one question with one passage; bytes include loaded source copies and each scan.
  for (const q of questions) {
    const ordered = input.mode === 'focused' ? [q.sourceId] :
      input.mode === 'adaptive' && q.sourceId ? [q.sourceId, ...ids.filter(id => id !== q.sourceId)] : ids;
    let found = false;
    for (const id of ordered) {
      if (probes >= maxProbes || performance.now() - started >= maxMs) {
        stopped = probes >= maxProbes ? 'probe_budget' : 'time_budget';
        break;
      }
      if (!sources.has(id)) {
        // Charge metadata and the raw source copy before loading them.
        const metadataFile = path.join(root, 'datasets/knowledge/source', `${id}.json`);
        const metadataSize = fs.statSync(metadataFile).size;
        if (bytes + metadataSize > maxBytes || performance.now() - started >= maxMs) {
          stopped = bytes + metadataSize > maxBytes ? 'byte_budget' : 'time_budget';
          break;
        }
        const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
        if (!['.txt', '.md', '.docx', '.pdf', '.html', '.htm'].includes(metadata.format)) throw Error('Source record invalid');
        const rawSize = fs.statSync(path.join(root, 'datasets/knowledge/source', `${id}${metadata.format}`)).size;
        if (bytes + metadataSize + rawSize > maxBytes || performance.now() - started >= maxMs) {
          stopped = bytes + metadataSize + rawSize > maxBytes ? 'byte_budget' : 'time_budget';
          break;
        }
        bytes += metadataSize + rawSize;
        sources.set(id, readSource(root, id));
      }
      if (performance.now() - started >= maxMs) {
        stopped = 'time_budget';
        break;
      }
      for (const passage of sources.get(id).passages) {
        const size = Buffer.byteLength(passage.text);
        if (probes + 1 > maxProbes || bytes + size > maxBytes || performance.now() - started >= maxMs) {
          stopped = probes + 1 > maxProbes ? 'probe_budget' : bytes + size > maxBytes ? 'byte_budget' : 'time_budget';
          break;
        }
        probes++;
        bytes += size;
        const where = passage.text.indexOf(q.needle);
        if (where !== -1) {
          matches.push({questionId: q.id, sourceId: id, passage: {page: passage.page, paragraph: passage.paragraph, offset: passage.offset}, quoteOffset: passage.offset + Buffer.byteLength(passage.text.slice(0, where)), quote: q.needle});
          found = true;
          if (input.mode !== 'near-exhaustive') break;
        }
      }
      if (stopped || (found && input.mode !== 'near-exhaustive')) break;
    }
    if (stopped) break;
  }
  const elapsedMs = Math.ceil(performance.now() - started);
  if (!stopped && elapsedMs > maxMs) stopped = 'time_budget';
  return {mode: input.mode, status: stopped ? 'incomplete' : 'completed', stopCondition: stopped ?? (input.mode === 'near-exhaustive' ? 'all_passages_scanned' : 'planned_questions_examined'), budget: {maxProbes, maxBytes, maxMs}, used: {probes, bytes, elapsedMs}, questions: questions.length, matchedQuestions: new Set(matches.map(match => match.questionId)).size, matches};
}

async function propose(root, input, projectRoot) {
  requireText(input.id, 'candidate ID');
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(input.id)) throw Error('Invalid candidate ID');
  requireText(input.scope, 'candidate scope');
  requireText(input.limits, 'candidate limits');
  requireText(input.rationale, 'candidate rationale');
  requireText(input.sop, 'candidate SOP');
  const roles = ['positive', 'negative', 'boundary', 'nontrigger', 'transfer'];
  if (!Array.isArray(input.cases) || input.cases.length !== roles.length || new Set(input.cases.map(c => c.role)).size !== roles.length || roles.some(role => !input.cases.some(c => c.role === role))) throw Error('Positive, negative, boundary, nontrigger and transfer cases required');
  const checked = input.cases.map(c => {
    requireText(c.question, `${c.role} question`);
    requireText(c.rationale, `${c.role} rationale`);
    requireText(c.setupSop, `${c.role} setupSop`);
    requireText(c.querySop, `${c.role} querySop`);
    const {source} = cite(root, c.citation);
    return {case: c, source};
  });
  const primary = checked.find(item => item.case.role === 'positive').source;
  const transfer = checked.find(item => item.case.role === 'transfer').source;
  if (primary.id === transfer.id || primary.rawSha256 === transfer.rawSha256) throw Error('Second different source evidence required for rule transfer');
  const base = path.resolve(requireText(projectRoot, 'project root'));
  const [parser, ingest, repository, runtime] = await Promise.all(['sop/parser.mjs', 'sop/ingest.mjs', 'memory/repository.mjs', 'sop/runtime.mjs'].map(file => import(pathToFileURL(path.join(base, file)).href)));
  const parsed = parser.parse(input.sop);
  if (parsed.wires.length !== 1 || parsed.wires[0].type !== 'rule' || parsed.wires[0].fields.mode?.[0] !== 'logical') throw Error('One logical SOP rule required');
  ingest.prepareKnowledge(input.sop, {reviewed: true}); // Validation only; no publication.
  const target = parser.parseAtom(parsed.wires[0].fields.then[0]).p;
  const observed = [], asked = new Set();
  for (const {case: c, source} of checked) {
    const setup = parser.parse(c.setupSop);
    const query = parser.parse(c.querySop);
    if (!setup.wires.length || !setup.wires.every(w => w.type === 'fact' && parser.parseAtom(w.fields.holds[0]).p !== target)) throw Error(`${c.role} setup must contain facts but not assert the rule conclusion`);
    if (query.wires.length !== 3 || query.wires[0].type !== 'query' || query.wires[1].type !== 'recall' || query.wires[2].type !== 'reason' || query.wires[1].fields.query?.[0] !== `$${query.wires[0].id}` || query.wires[2].fields.query?.[0] !== `$${query.wires[0].id}` || query.wires[2].fields.memory?.[0] !== `$${query.wires[1].id}`) throw Error(`${c.role} requires query → recall → reason`);
    const atom = parser.parseAtom(query.wires[0].fields.where?.[0]);
    if (!atom || atom.neg || atom.a.some(v => typeof v === 'string' && v.startsWith('?')) || (c.role === 'nontrigger' ? atom.p === target : atom.p !== target)) throw Error(`${c.role} question trigger mismatch`);
    const questionKey = JSON.stringify(atom);
    if (asked.has(questionKey)) throw Error('Each case must ask a different ground question');
    asked.add(questionKey);
    const expected = ['positive', 'transfer'].includes(c.role) ? 'supported' : 'unknown';
    if (c.expectedStatus !== expected) throw Error(`${c.role} must expect ${expected}`);
    const temporary = fs.mkdtempSync(path.join(root, 'temporary', 'candidate-'));
    try {
      const knownAt = Date.parse('2025-01-01T00:00:00Z');
      const circuit = async includeRule => {
        const repo = new repository.Repository(path.join(temporary, includeRule ? 'with' : 'without'));
        ingest.publishKnowledge(repo, 'probe', c.setupSop + (includeRule ? `\n${input.sop}` : ''), {reviewed: true, knownAt});
        const session = repo.session('probe', 'skill', 'probe');
        const result = await new runtime.Runtime({repo, session, now: Date.parse('2026-01-01T00:00:00Z')}).run(c.querySop);
        return result.result?.packet?.status ?? result.result?.status;
      };
      // Both results are measured in separate isolated repositories.
      const baselineStatus = await circuit(false);
      const observedStatus = await circuit(true);
      observed.push({role: c.role, question: c.question, sourceId: source.id, baselineStatus, observedStatus, expectedStatus: expected});
      if (observedStatus !== expected) throw Error(`${c.role} probe failed: expected ${expected}, observed ${observedStatus}`);
    } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
  }
  const proposal = {version: 1, status: 'cross-source-proposal-unapproved', id: input.id, sourceIds: [primary.id, transfer.id], scope: input.scope, limits: input.limits, sop: input.sop, cases: input.cases, observed, sha256: fingerprint(input)};
  const file = path.join(root, 'datasets/knowledge/implicit', `candidate-${input.id}.json`);
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== JSON.stringify(proposal, null, 2) + '\n') throw Error('Candidate immutable conflict');
  } else fs.writeFileSync(file, JSON.stringify(proposal, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  return {status: proposal.status, id: proposal.id, sourceIds: proposal.sourceIds, observed, sha256: proposal.sha256};
}

export async function runExploration(command, args) {
  const opts = optsOf(args, command === 'propose-sources' ? ['workspace', 'input', 'project-root'] : ['workspace', 'input']);
  const root = rootOf(opts);
  const input = getInput(opts);
  const result = command === 'explore-sources' ? explore(root, input) : await propose(root, input, opts['project-root']);
  console.log(JSON.stringify(result, null, 2));
}
