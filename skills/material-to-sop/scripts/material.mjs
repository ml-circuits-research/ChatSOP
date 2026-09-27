#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {TextDecoder} from 'node:util';
import {runSources} from './sources.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = message => { throw Error(message); };
const need = (condition, message) => { if (!condition) fail(message); };
const id = value => { need(typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), 'Expected lowercase safe identifier'); return value; };
const text = (value, label) => { need(typeof value === 'string' && value.trim().length > 0, `Missing ${label}`); return value; };
const object = (value, label) => { need(value !== null && typeof value === 'object' && !Array.isArray(value), `Expected ${label} object`); return value; };
const array = (value, label) => { need(Array.isArray(value) && value.length > 0, `Expected nonempty ${label} array`); return value; };
const digest = value => sha(json(value));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readUtf8 = file => { const bytes = fs.readFileSync(file); const value = new TextDecoder('utf-8', {fatal: true}).decode(bytes); need(Buffer.from(value, 'utf8').equals(bytes), 'Source must be canonical UTF-8 without BOM'); return value; };
function save(file, value, {immutable = false} = {}) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const content = json(value);
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') === content) return;
    if (immutable) fail(`Immutable artifact already exists: ${file}`);
  }
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, content, {flag: 'wx', mode: 0o600}); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
const requireQuote = (quote, source) => { text(quote, 'source quote'); need(source.includes(quote), 'Quote is not an exact source span'); };
function options(args) {
  const [command, ...tail] = args;
  const opts = {};
  for (let i = 0; i < tail.length; i += 2) {
    need(/^--[a-z][a-z-]*$/.test(tail[i]) && i + 1 < tail.length && !tail[i + 1].startsWith('--'), 'Expected --name value pairs');
    const name = tail[i].slice(2); need(!Object.hasOwn(opts, name), `Duplicate --${name}`); opts[name] = tail[i + 1];
  }
  const allowed = {
    prepare: ['workspace', 'file', 'source-id', 'revision', 'license'],
    review: ['workspace', 'input', 'project-root'], curriculum: ['workspace', 'input'],
    diagnose: ['workspace', 'input'], candidate: ['workspace', 'input', 'project-root'],
    probe: ['workspace', 'id', 'project-root'], decide: ['workspace', 'id', 'input'],
    freeze: ['workspace'], publish: ['workspace', 'id', 'project-root', 'state-root', 'base', 'input']
  };
  need(Object.hasOwn(allowed, command), `Unknown command ${command ?? '(none)'}`);
  for (const name of Object.keys(opts)) need(allowed[command].includes(name), `Unsupported --${name} for ${command}`);
  need(opts.workspace, '--workspace required');
  return [command, opts];
}
function workspace(p) {
  const root = path.resolve(p); fs.mkdirSync(root, {recursive: true});
  need(!fs.lstatSync(root).isSymbolicLink(), 'Workspace cannot be a symlink');
  return root;
}
function local(root, name) { const file = path.join(root, name); need(!fs.existsSync(file) || !fs.lstatSync(file).isSymbolicLink(), `Symlink artifact forbidden: ${name}`); return file; }
function material(root) {
  const m = readJson(local(root, 'material.json')), source = readUtf8(local(root, 'source.txt'));
  need(m.version === 1 && m.kind === 'txt-md' && m.sha256 === sha(source) && /^[a-z][a-z0-9_-]{0,63}$/.test(m.id), 'Source material changed or invalid');
  return {m, source};
}
async function adapter(projectRoot) {
  need(projectRoot, '--project-root required for ChatSOP adapter');
  const root = path.resolve(projectRoot);
  const paths = ['sop/parser.mjs', 'sop/ingest.mjs', 'memory/repository.mjs', 'sop/runtime.mjs'];
  for (const name of paths) need(fs.existsSync(path.join(root, name)), `ChatSOP capability unavailable: ${name}`);
  try {
    const [parser, ingest, repository, runtime] = await Promise.all(paths.map(p => import(pathToFileURL(path.join(root, p)).href)));
    need(typeof parser.parse === 'function' && typeof parser.parseAtom === 'function' && typeof ingest.prepareKnowledge === 'function' && typeof ingest.publishKnowledge === 'function' && typeof repository.Repository === 'function' && typeof runtime.Runtime === 'function', 'ChatSOP adapter exports unavailable');
    return {parser, ingest, Repository: repository.Repository, Runtime: runtime.Runtime};
  } catch (error) { fail(`ChatSOP adapter unavailable: ${error.message}`); }
}
const wires = (a, sop, types) => {
  const parsed = a.parser.parse(text(sop, 'SOP'));
  need(parsed.wires.length > 0 && parsed.wires.every(w => types.includes(w.type)), `Only ${types.join('/')} SOP wires permitted`);
  return parsed;
};
function normalizeProbes(probes, a, rule) {
  array(probes, 'probes');
  need(probes.length === 3, 'Exactly positive, negative and boundary probes required');
  const roles = new Set(), questions = new Set(), target = a.parser.parseAtom(rule.fields.then[0]).p;
  for (const probe of probes) {
    object(probe, 'probe'); need(['positive', 'negative', 'boundary'].includes(probe.role) && !roles.has(probe.role), 'Duplicate or invalid probe role'); roles.add(probe.role);
    text(probe.rationale, 'probe rationale');
    const setup = wires(a, probe.setupSop, ['fact']);
    need(setup.wires.every(w => a.parser.parseAtom(w.fields.holds[0]).p !== target), 'Probe setup must not assert the conclusion');
    const query = wires(a, probe.querySop, ['query', 'recall', 'reason']);
    need(query.wires.length === 3 && query.wires[0].type === 'query' && query.wires[1].type === 'recall' && query.wires[2].type === 'reason' && query.wires[1].fields.query?.[0] === '$' + query.wires[0].id && query.wires[2].fields.query?.[0] === '$' + query.wires[0].id && query.wires[2].fields.memory?.[0] === '$' + query.wires[1].id && query.wires[0].fields.where?.length === 1, 'Probe must query, recall isolated repository, then reason with that memory');
    const where = query.wires[0].fields.where[0], atom = a.parser.parseAtom(where);
    need(atom.p === target && !atom.neg && atom.a.every(v => typeof v !== 'string' || !v.startsWith('?')) && !questions.has(where), 'Each probe must ask a distinct ground positive conclusion of this rule');
    questions.add(where);
    need(['supported', 'unknown', 'refuted'].includes(probe.expectedStatus), 'Unsupported expected status');
    need(probe.role !== 'positive' || probe.expectedStatus === 'supported', 'Positive probe must expect support');
    need(probe.role === 'positive' || probe.expectedStatus !== 'supported', 'Negative/boundary must not expect support');
  }
  return probes;
}
function registry(root) { const file = local(root, 'registry.json'); return fs.existsSync(file) ? readJson(file) : {version: 1, entries: {}}; }
function checkedEntry(root, key) {
  const r = registry(root), e = r.entries[id(key)]; need(e, `Unknown candidate ${key}`);
  need(e.sha256 === digest(e.spec), 'Candidate checksum mismatch');
  return {r, e};
}
async function main() {
  if (['prepare-sources', 'review-sources'].includes(process.argv[2])) {
    await runSources(process.argv[2], process.argv.slice(3));
    return;
  }
  const [command, o] = options(process.argv.slice(2));
  let prepared;
  if (command === 'prepare') {
    need(o.file && ['.txt', '.md'].includes(path.extname(o.file).toLowerCase()), 'Only UTF-8 .txt/.md supported; DOCX/PDF require trusted external conversion first');
    const source = readUtf8(o.file); text(source, 'source text'); need(Buffer.byteLength(source) <= 2_000_000, 'Source too large (2 MB maximum)');
    prepared = {source, m: {version: 1, kind: 'txt-md', id: id(o['source-id']), revision: text(o.revision, 'revision'), license: text(o.license, 'license'), sha256: sha(source), origin: path.resolve(o.file)}};
  }
  if (command === 'publish') { need(o['state-root'] && o.base && o.input, '--state-root, --base, --input required'); id(o.base); }
  if (['probe', 'decide', 'publish'].includes(command)) id(o.id);
  const a = ['review', 'candidate', 'probe', 'publish'].includes(command) ? await adapter(o['project-root']) : null;
  const root = workspace(o.workspace);
  if (command === 'prepare') {
    const {source, m} = prepared;
    const src = local(root, 'source.txt');
    if (fs.existsSync(src)) need(readUtf8(src) === source, 'Source immutable; use a new workspace');
    else fs.writeFileSync(src, source, {flag: 'wx', mode: 0o600});
    save(local(root, 'material.json'), m, {immutable: true}); console.log(json(m)); return;
  }
  const {m, source} = material(root);
  if (command === 'review') {
    const input = object(readJson(o.input), 'review');
    need(input.sourceSha256 === m.sha256, 'Review source checksum mismatch');
    const facts = array(input.facts, 'facts');
    const ids = new Set();
    for (const fact of facts) {
      object(fact, 'fact'); requireQuote(fact.quote, source);
      const p = wires(a, fact.sop, ['fact']); need(p.wires.length === 1, 'One fact per quoted claim');
      need(!ids.has(p.wires[0].id), 'Duplicate fact ID'); ids.add(p.wires[0].id);
      need(p.wires[0].fields.source?.[0] === m.id && p.wires[0].fields.quote?.[0] === JSON.stringify(fact.quote), 'Fact source/quote must match exact source ID and quote');
      a.ingest.prepareKnowledge(fact.sop, {reviewed: true, documents: {[m.id]: source}, requireQuotes: true});
    }
    const reviewed = {version: 1, sourceSha256: m.sha256, facts, status: 'agent-draft-unapproved', sha256: digest(facts)};
    save(local(root, 'facts.json'), reviewed, {immutable: true}); console.log(json(reviewed)); return;
  }
  if (command === 'curriculum') {
    const input = object(readJson(o.input), 'curriculum'); need(input.sourceSha256 === m.sha256, 'Curriculum source checksum mismatch');
    const qs = array(input.questions, 'questions'), seen = new Set();
    for (const q of qs) { object(q, 'question'); need(!seen.has(id(q.id)), 'Duplicate question ID'); seen.add(q.id); text(q.question, 'question'); text(q.expectedBehavior, 'expected behavior'); for (const quote of array(q.sourceQuotes, 'question source quotes')) requireQuote(quote, source); array(q.probes, 'question test probes').forEach(p => { object(p, 'test probe'); text(p.input, 'probe input'); text(p.expected, 'probe expected'); }); }
    const result = {version: 1, sourceSha256: m.sha256, questions: qs, status: 'supplied-not-executed', sha256: digest(qs)};
    save(local(root, 'curriculum.json'), result, {immutable: true}); console.log(json(result)); return;
  }
  if (command === 'diagnose') {
    const x = object(readJson(o.input), 'diagnosis'); need(x.sourceSha256 === m.sha256, 'Diagnosis source checksum mismatch');
    const classes = ['source_gap', 'semantic_gap', 'reasoning_gap', 'ambiguity', 'over_inference'];
    need(classes.includes(x.classification), 'Unknown failure classification');
    for (const key of ['question', 'expected', 'observed', 'reason']) text(x[key], key);
    const evidence = object(x.evidence, 'observed execution evidence');
    for (const key of ['runId', 'trace', 'comparison']) text(evidence[key], `evidence.${key}`);
    for (const q of array(x.sourceQuotes, 'diagnosis source quotes')) requireQuote(q, source);
    need(x.expected !== x.observed, 'No observed failure to classify');
    const result = {version: 1, ...x, status: 'agent-assessment-unapproved', sha256: digest(x)};
    save(local(root, `diagnosis-${id(x.id)}.json`), result, {immutable: true}); console.log(json(result)); return;
  }
  if (command === 'candidate') {
    const s = object(readJson(o.input), 'candidate'); id(s.id);
    need(s.sourceSha256 === m.sha256, 'Candidate source checksum mismatch');
    need(['HARD', 'DEFAULT', 'PLAUSIBLE'].includes(s.strength), 'Invalid candidate strength');
    for (const key of ['rationale', 'scope']) text(s[key], key);
    for (const quote of array(s.sourceQuotes, 'candidate evidence quotes')) requireQuote(quote, source);
    need(Array.isArray(s.assumptions), 'Candidate assumptions must be explicit array'); s.assumptions.forEach(v => text(v, 'assumption'));
    const p = wires(a, s.sop, ['rule']); need(p.wires.length === 1, 'Exactly one rule per candidate');
    a.ingest.prepareKnowledge(s.sop, {reviewed: true});
    need(p.wires[0].fields.mode?.[0] === 'logical', 'Only explicitly logical rules supported for executable approval');
    normalizeProbes(s.probes, a, p.wires[0]);
    const r = registry(root); need(!r.entries[s.id] || digest(r.entries[s.id].spec) === digest(s), 'Candidate ID already used');
    if (!r.entries[s.id]) { r.entries[s.id] = {status: 'candidate', spec: s, sha256: digest(s), execution: null, decision: null, decisions: []}; save(local(root, 'registry.json'), r); }
    console.log(json(r.entries[s.id])); return;
  }
  if (command === 'probe') {
    const {r, e} = checkedEntry(root, o.id);
    if (e.execution) { need(e.execution.adapterRoot === path.resolve(o['project-root']), 'Probe already executed using another adapter'); console.log(json(e.execution)); return; }
    need(e.status === 'candidate', 'Only pending candidates can be probed');
    const results = [];
    for (const p of e.spec.probes) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'material-to-sop-'));
      try {
        const repo = new a.Repository(tmp), knownAt = Date.parse('2025-01-01T00:00:00Z');
        a.ingest.publishKnowledge(repo, 'probe', p.setupSop + '\n' + e.spec.sop, {reviewed: true, knownAt});
        const session = repo.session('probe', 'skill', 'probe');
        const result = await new a.Runtime({repo, session, now: Date.parse('2026-01-01T00:00:00Z')}).run(p.querySop);
        const status = result.result?.packet?.status ?? result.result?.status;
        need(typeof status === 'string', `Probe ${p.role} did not return a status`);
        results.push({role: p.role, expectedStatus: p.expectedStatus, observedStatus: status, passed: status === p.expectedStatus});
      } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
    }
    const execution = {candidateSha256: e.sha256, sourceSha256: m.sha256, adapterRoot: path.resolve(o['project-root']), executedAt: new Date().toISOString(), results};
    execution.sha256 = digest(execution);
    e.execution = execution; save(local(root, 'registry.json'), r);
    console.log(json(e.execution)); return;
  }
  if (command === 'decide') {
    const {r, e} = checkedEntry(root, o.id), approval = object(readJson(o.input), 'decision');
    need(['accept', 'reject', 'retract'].includes(approval.action), 'Invalid decision');
    need(approval.candidateSha256 === e.sha256 && approval.sourceSha256 === m.sha256, 'Decision hashes mismatch');
    text(approval.reviewer, 'reviewer identity'); text(approval.reason, 'reviewer reason'); text(approval.reviewedAt, 'review timestamp');
    need(['human', 'principal_integrator'].includes(approval.reviewerKind), 'reviewerKind must identify human or principal_integrator');
    need(!Number.isNaN(Date.parse(approval.reviewedAt)), 'Invalid review timestamp');
    const next = {accept: 'accepted', reject: 'rejected', retract: 'retracted'}[approval.action];
    if (e.status === next && digest(e.decision) === digest(approval)) { console.log(json(e)); return; }
    need(e.status === 'candidate' || (e.status === 'accepted' && next === 'retracted'), 'Invalid state transition');
    if (next === 'accepted') {
      need(e.spec.strength === 'HARD', 'DEFAULT/PLAUSIBLE candidates are quarantined; cannot approve executable rule');
      need(e.execution && e.execution.sha256 === digest({...e.execution, sha256: undefined}) && approval.executionSha256 === e.execution.sha256 && e.execution.results.length === 3 && e.execution.results.every(p => p.passed), 'Approval requires matching successful executed positive/negative/boundary probes');
      need(approval.statement === 'I approve this reviewed scoped rule for publication', 'Missing explicit publication approval statement');
    }
    e.status = next; e.decision = approval; e.decisions ??= []; e.decisions.push(approval);
    save(local(root, 'registry.json'), r); console.log(json(e)); return;
  }
  if (command === 'freeze') {
    const r = registry(root), accepted = Object.entries(r.entries).filter(([, e]) => e.status === 'accepted');
    need(accepted.length > 0, 'No accepted rules to freeze');
    const snapshot = {version: 1, sourceSha256: m.sha256, rules: Object.fromEntries(accepted.map(([key, e]) => [key, {candidateSha256: e.sha256, executionSha256: e.execution.sha256, decisionSha256: digest(e.decision), sop: e.spec.sop, scope: e.spec.scope, assumptions: e.spec.assumptions}])), registrySha256: digest(r), status: 'frozen-reviewed-registry'};
    snapshot.sha256 = digest(snapshot);
    save(local(root, `freeze-${snapshot.sha256}.json`), snapshot, {immutable: true}); console.log(json(snapshot)); return;
  }
  if (command === 'publish') {
    const {e} = checkedEntry(root, o.id);
    need(e.status === 'accepted' && e.spec.strength === 'HARD' && e.execution?.results.every(p => p.passed), 'Candidate not approved and tested');
    const approval = object(readJson(o.input), 'publication authorization');
    need(approval.candidateSha256 === e.sha256 && approval.executionSha256 === e.execution.sha256 && approval.decisionSha256 === digest(e.decision), 'Publication authorization mismatch');
    need(approval.statement === 'I authorize publication to this exact base and state root', 'Explicit host authorization required');
    need(approval.base === o.base && approval.stateRoot === path.resolve(o['state-root']), 'Publication destination mismatch');
    text(approval.authorizer, 'host authorizer');
    need(['human', 'principal_integrator'].includes(approval.authorizerKind), 'authorizerKind must identify human or principal_integrator');
    need(typeof approval.freezeSha256 === 'string' && /^[a-f0-9]{64}$/.test(approval.freezeSha256), 'Invalid freeze checksum');
    const frozen = `freeze-${approval.freezeSha256}.json`, snapshot = readJson(local(root, frozen));
    need(snapshot.sha256 === approval.freezeSha256 && digest({...snapshot, sha256: undefined}) === snapshot.sha256, 'Freeze checksum mismatch');
    need(snapshot.rules[o.id]?.candidateSha256 === e.sha256 && snapshot.rules[o.id].decisionSha256 === digest(e.decision), 'Rule not in current approved freeze');
    need(snapshot.registrySha256 === digest(registry(root)), 'Registry changed since freeze (including retraction)');
    const stateRoot = path.resolve(o['state-root']), receipt = local(root, `publication-${id(o.id)}.json`);
    const prior = fs.existsSync(receipt) ? readJson(receipt) : null;
    if (prior) { need(prior.authorizationSha256 === digest(approval), 'Conflicting publication request'); console.log(json(prior)); return; }
    const repo = new a.Repository(stateRoot);
    need(!repo.meta.bases[o.base], 'Destination base exists; refuse overwrite or duplicate publication');
    const result = a.ingest.publishKnowledge(repo, o.base, e.spec.sop, {reviewed: true, knownAt: Date.parse(approval.reviewedAt || e.decision.reviewedAt)});
    const record = {candidateId: o.id, snapshot: result.snapshot, base: o.base, stateRoot, authorizationSha256: digest(approval), candidateSha256: e.sha256};
    save(receipt, record, {immutable: true}); console.log(json(record)); return;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
