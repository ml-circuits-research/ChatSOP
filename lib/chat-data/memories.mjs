/**
 * Base memories (DS031 "Base memories"): named, forkable knowledge stores kept under `chat_data/base_memories/<id>/`.
 *
 *   manifest.json      id, name, parent, strategy, exact, created_at, description, counters
 *   repo/              a memory repository (memory/repository.mjs) of one memory strategy (DS023-DS028), one base named `main`
 *   circuits/NNNN-*.sop  the validated knowledge circuits, the source of truth the repository is derived from
 *   provenance.jsonl   one line per addition: who approved it, when, why, the circuit hash and what was ingested
 *
 * A base memory only grows through `addKnowledge`, an administrator action that validates the circuits with the knowledge
 * validator (sop/knowledge/) and records its provenance (AGENTS.md rules 4 and 5: nothing enters knowledge implicitly). The
 * repository holds what the memory strategy can retrieve (the `fact` wires); every other knowledge wire (rules, defaults,
 * norms, aggregates, ...) lives as a circuit and is the theory the exact engines read (`theory()`).
 *
 * A fork copies the circuits and, when the strategy is the same, clones the repository by hard links: snapshots and shards are
 * content-addressed files that are never modified in place, so the clone is copy-on-write at no cost. A fork that changes the
 * strategy rebuilds the repository by replaying the circuits into the new engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Repository} from '../../memory/repository.mjs';
import {MEMORY_ENGINES} from '../../memory/banks/factory.mjs';
import {publishKnowledge, prepareKnowledge} from '../../sop/ingest.mjs';
import {parse, validateProgram, wireText} from '../../sop/knowledge/index.mjs';
import {assertFolderId, newId} from './index.mjs';

export const BASE_NAME = 'main';
export const STRATEGIES = Object.freeze([...MEMORY_ENGINES]);
const FORBIDDEN_FIELDS = new Set(['approval', 'approved_by', 'approved_at']);
const FORBIDDEN_TYPES = new Set(['jsEval']);

const fail = (message, code = 'invalid_request', status = 400) => Object.assign(new Error(message), {code, status});
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(tmp, file); };
const sha = text => createHash('sha256').update(text).digest('hex');
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'circuit';

/** Validates strategy and exactness as given by a request. */
export function checkStrategy(strategy = 'recall-memory') {
  if (!STRATEGIES.includes(strategy)) throw fail(`strategy must be one of ${STRATEGIES.join(', ')}`, 'invalid_strategy');
  return strategy;
}

/** The memory configuration a repository of this strategy uses: the runtime defaults with the engine chosen. */
export const memoryConfigFor = (base, {strategy, exact = false}) => ({...base, engine: strategy, ...(exact ? {exact: true} : {})});

/** Clones a repository folder by hard links (snapshots and shards are immutable, content-addressed files). */
export function cloneRepository(from, to) {
  fs.mkdirSync(to, {recursive: true});
  for (const dir of ['snapshots', 'shards']) {
    const source = path.join(from, dir);
    fs.mkdirSync(path.join(to, dir), {recursive: true});
    if (!fs.existsSync(source)) continue;
    for (const name of fs.readdirSync(source)) {
      const target = path.join(to, dir, name);
      try { fs.linkSync(path.join(source, name), target); } catch { fs.copyFileSync(path.join(source, name), target); }
    }
  }
  const index = readJson(path.join(from, 'index.json'), {version: 1, bases: {}, users: {}, pins: {}});
  writeJson(path.join(to, 'index.json'), {...index, users: {}, pins: {}});
}

/**
 * Checks circuits for a knowledge store. Returns {ok, problems, warnings, wires}. Problems are errors of the knowledge validator,
 * a model-surface or jsEval wire, a governance field (the host writes approval in the provenance, never the author), or a query
 * wire (queries are tests, not knowledge). `existing` circuits are validated together with the new ones (ids, arity, closedness).
 */
export function validateCircuits(circuits, existing = []) {
  const problems = [];
  const wires = [];
  for (const c of circuits) {
    const parsed = parse(c.text);
    for (const w of parsed.wires) {
      wires.push(w);
      if (FORBIDDEN_TYPES.has(w.type)) problems.push({code: 'forbidden_wire', file: c.name, message: `${w.type} is a trusted host wire and never knowledge`, wire: w.id});
      for (const f of w.fields) if (FORBIDDEN_FIELDS.has(f.key)) problems.push({code: 'governance_field', file: c.name, message: `${f.key} is written by the host; remove it`, wire: w.id});
    }
  }
  const all = [...existing, ...circuits].map(c => ({name: c.name, text: c.text, role: 'knowledge'}));
  const result = validateProgram(all, {authoring: true});
  const own = new Set(circuits.map(c => c.name));
  for (const p of result.problems) {
    const mine = p.file === undefined || own.has(p.file) || p.severity !== 'warning';
    if (p.severity === 'warning') { if (mine) problems.push({...p, warning: true}); } else problems.push(p);
  }
  const errors = problems.filter(p => !p.warning);
  return {ok: errors.length === 0, problems: errors, warnings: problems.filter(p => p.warning), wires: wires.length};
}

/** Ingests the `fact` wires of a circuit into a repository base; returns what was stored and what stays circuit-only. */
export function ingestFacts(repo, base, text, {knownAt = Date.now()} = {}) {
  const facts = parse(text).wires.filter(w => w.type === 'fact');
  const accepted = [];
  const skipped = [];
  let defaultedValid = 0;
  for (const w of facts) {
    let source = wireText(w);
    let usable = tryPrepare(source, repo);
    if (!usable.ok && /needs valid/.test(usable.error) && !w.fields.some(f => f.key === 'valid')) {
      source += '\n  valid timeless';
      usable = tryPrepare(source, repo);
      if (usable.ok) defaultedValid++;
    }
    if (usable.ok) accepted.push(source); else skipped.push({wire: w.id, reason: usable.error});
  }
  if (accepted.length) publishKnowledge(repo, base, accepted.join('\n\n') + '\n', {reviewed: true, knownAt});
  return {facts_in_circuit: facts.length, facts_ingested: accepted.length, facts_defaulted_valid: defaultedValid, facts_skipped: skipped};
}

function tryPrepare(source, repo) {
  try { prepareKnowledge(source, {memory: repo.memory, reviewed: true}); return {ok: true}; } catch (error) { return {ok: false, error: error.message}; }
}

export class BaseMemories {
  /** `memory` is the runtime `memory` configuration (power, retention, sharding); the strategy of each base memory is added to it. */
  constructor({chatData, memory = {}}) {
    this.chatData = chatData;
    this.root = chatData.baseMemoriesDir;
    this.memory = memory;
  }

  dir(id) { return path.join(this.root, assertFolderId(id, 'base memory id')); }
  manifestFile(id) { return path.join(this.dir(id), 'manifest.json'); }

  manifest(id) {
    const m = readJson(this.manifestFile(id));
    if (!m) throw fail(`Unknown base memory ${JSON.stringify(id)}`, 'unknown_memory', 404);
    return m;
  }

  list() {
    return fs.readdirSync(this.root).filter(id => fs.existsSync(path.join(this.root, id, 'manifest.json'))).map(id => this.manifest(id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  repository(id) {
    const m = this.manifest(id);
    return new Repository(path.join(this.dir(id), 'repo'), {memory: memoryConfigFor(this.memory, m)});
  }

  circuits(id) {
    const folder = path.join(this.dir(id), 'circuits');
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).filter(n => n.endsWith('.sop')).sort().map(name => ({name, text: fs.readFileSync(path.join(folder, name), 'utf8')}));
  }

  /** The theory of a base memory: its circuits concatenated in order (what the exact engines read). */
  theory(id) { return this.circuits(id).map(c => c.text.trimEnd()).join('\n\n') + '\n'; }

  provenance(id) {
    const file = path.join(this.dir(id), 'provenance.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  }

  appendProvenance(id, record) { fs.appendFileSync(path.join(this.dir(id), 'provenance.jsonl'), JSON.stringify(record) + '\n'); }

  /** Creates an empty base memory. */
  create({id, name, strategy = 'recall-memory', exact = false, description = '', parent = null, now = new Date()} = {}) {
    if (typeof name !== 'string' || !name.trim()) throw fail('Provide a non-empty name', 'invalid_name');
    checkStrategy(strategy);
    id = id ? assertFolderId(id, 'base memory id') : newId('bm', now.getTime());
    if (fs.existsSync(this.dir(id))) throw fail(`Base memory ${id} already exists`, 'memory_exists', 409);
    fs.mkdirSync(path.join(this.dir(id), 'circuits'), {recursive: true});
    const manifest = {id, name: name.trim().slice(0, 120), parent, strategy, exact: Boolean(exact), created_at: now.toISOString(), description: String(description).slice(0, 2000), circuits: 0, facts: 0};
    writeJson(this.manifestFile(id), manifest);
    const repo = new Repository(path.join(this.dir(id), 'repo'), {memory: memoryConfigFor(this.memory, manifest)});
    repo.init(BASE_NAME);
    return manifest;
  }

  /** Writes a validated circuit as the next file and ingests its facts; the shared step of add, import and replay. */
  store(id, circuit, {approvedBy, reason = '', source = null, now = new Date(), kind = 'add'} = {}) {
    const manifest = this.manifest(id);
    const seq = manifest.circuits + 1;
    const file = `${String(seq).padStart(4, '0')}-${slug(circuit.name)}.sop`;
    fs.writeFileSync(path.join(this.dir(id), 'circuits', file), circuit.text);
    const ingest = ingestFacts(this.repository(id), BASE_NAME, circuit.text, {knownAt: now.getTime()});
    const record = {kind, seq, file, sha256: sha(circuit.text), approved_by: approvedBy, approved_at: now.toISOString(), reason, source, wires: parse(circuit.text).wires.length, ingest};
    this.appendProvenance(id, record);
    writeJson(this.manifestFile(id), {...manifest, circuits: seq, facts: manifest.facts + ingest.facts_ingested});
    return record;
  }

  /**
   * Adds validated circuits to a base memory (an administrator action). Nothing is written when any circuit fails validation.
   * `circuits` is [{name, text}]; `approvedBy` names the approving administrator.
   */
  addKnowledge(id, {circuits, approvedBy, reason = '', source = null, now = new Date()}) {
    if (!approvedBy) throw fail('Adding knowledge needs an approving administrator', 'approval_required', 403);
    if (!Array.isArray(circuits) || !circuits.length) throw fail('Provide circuits: [{name, text}]', 'invalid_circuits');
    for (const c of circuits) if (typeof c?.text !== 'string' || !c.text.trim() || typeof c.name !== 'string') throw fail('Each circuit needs a name and a non-empty text', 'invalid_circuits');
    this.manifest(id);
    const check = validateCircuits(circuits, this.circuits(id));
    if (!check.ok) throw Object.assign(fail('The circuits did not pass the knowledge validator; nothing was added', 'validation_failed', 422), {problems: check.problems, warnings: check.warnings});
    const added = circuits.map(c => this.store(id, c, {approvedBy, reason, source, now}));
    return {memory: this.manifest(id), added, warnings: check.warnings};
  }

  /** Imports a memory: a new base memory holding the given circuits, all validated first (administrator action). */
  importMemory({name, strategy, exact, description, circuits = [], approvedBy, reason = 'import', source = null, id, now = new Date()}) {
    if (!approvedBy) throw fail('Importing knowledge needs an approving administrator', 'approval_required', 403);
    checkStrategy(strategy ?? 'recall-memory');
    if (circuits.length) {
      for (const c of circuits) if (typeof c?.text !== 'string' || typeof c.name !== 'string') throw fail('Each circuit needs a name and a text', 'invalid_circuits');
      const check = validateCircuits(circuits);
      if (!check.ok) throw Object.assign(fail('The circuits did not pass the knowledge validator; nothing was imported', 'validation_failed', 422), {problems: check.problems, warnings: check.warnings});
    }
    const created = this.create({id, name, strategy, exact, description, now});
    try {
      for (const c of circuits) this.store(created.id, c, {approvedBy, reason, source, now, kind: 'import'});
    } catch (error) { fs.rmSync(this.dir(created.id), {recursive: true, force: true}); throw error; }
    return this.manifest(created.id);
  }

  /** Forks a base memory: its circuits and provenance are copied, the repository is cloned (same strategy) or rebuilt (new one). */
  fork(id, {name, strategy, exact, description = '', newId: wanted, now = new Date()} = {}) {
    const parent = this.manifest(id);
    strategy = checkStrategy(strategy ?? parent.strategy);
    exact = exact ?? (strategy === parent.strategy ? parent.exact : false);
    const child = this.create({id: wanted, name, strategy, exact, description, parent: {id: parent.id, name: parent.name, strategy: parent.strategy, circuits: parent.circuits, forked_at: now.toISOString()}, now});
    const from = this.dir(id);
    const to = this.dir(child.id);
    try {
      fs.copyFileSync(path.join(from, 'provenance.jsonl'), path.join(to, 'provenance.jsonl'));
    } catch { /* a base memory without additions has no provenance file */ }
    const copied = this.circuits(id);
    for (const c of copied) fs.writeFileSync(path.join(to, 'circuits', c.name), c.text);
    const same = strategy === parent.strategy && exact === parent.exact;
    let rebuilt = null;
    if (same) {
      fs.rmSync(path.join(to, 'repo'), {recursive: true, force: true});
      cloneRepository(path.join(from, 'repo'), path.join(to, 'repo'));
    } else {
      rebuilt = {facts_ingested: 0, facts_skipped: 0};
      const repo = this.repository(child.id);
      for (const c of copied) {
        const r = ingestFacts(repo, BASE_NAME, c.text, {knownAt: now.getTime()});
        rebuilt.facts_ingested += r.facts_ingested;
        rebuilt.facts_skipped += r.facts_skipped.length;
      }
    }
    const manifest = {...this.manifest(child.id), circuits: copied.length, facts: same ? parent.facts : rebuilt.facts_ingested};
    writeJson(this.manifestFile(child.id), manifest);
    this.appendProvenance(child.id, {kind: 'fork', from: parent.id, strategy_from: parent.strategy, strategy_to: strategy, method: same ? 'hard-link clone (copy-on-write)' : 'replay of the circuits into the new engine', at: now.toISOString()});
    return {memory: manifest, method: same ? 'clone' : 'replay', rebuilt};
  }

  /** The summary of a base memory for the API: the manifest, the circuit names and the last provenance records. */
  describe(id) {
    const manifest = this.manifest(id);
    const provenance = this.provenance(id);
    return {...manifest, circuit_files: this.circuits(id).map(c => c.name), provenance: provenance.slice(-20)};
  }

  /**
   * The facts the memory store holds for a predicate (a read through the memory strategy, so it shows what retrieval would find).
   * The predicates come from the `predicate` wires of the circuits unless one is named; at most `limit` rows per predicate.
   */
  facts(id, {predicate = null, limit = 200} = {}) {
    const circuits = this.circuits(id);
    const arity = new Map();
    for (const c of circuits) for (const w of parse(c.text).wires) {
      if (w.type !== 'predicate') continue;
      const args = (w.fields.find(f => f.key === 'args')?.value ?? '').trim();
      arity.set(w.id, args === 'none' || !args ? 0 : args.split(/\s+/).length);
    }
    const names = predicate ? [predicate] : [...arity.keys()];
    const repo = this.repository(id);
    const session = repo.session(BASE_NAME, 'reader', newId('view'));
    const out = {};
    try {
      for (const name of names) {
        const atom = {p: name, a: Array.from({length: arity.get(name) ?? 2}, (_, i) => `?v${i}`), neg: false};
        const rows = repo.recall(session, atom, {asof: Infinity}, {limit}).rows;
        out[name] = rows.map(r => ({id: r.id, args: r.atom.a, source: r.source ?? null, quote: r.quote ?? null}));
      }
    } finally { repo.closeSession(session); }
    return out;
  }

  delete(id) {
    this.manifest(id);
    fs.rmSync(this.dir(id), {recursive: true, force: true});
  }
}

/** The empty base memory that chats naming none use; created when it is missing. Returns its id. */
export function ensureDefaultBase(memories, config = {}) {
  const id = config.chatData?.defaultBase ?? 'default';
  if (!memories.list().some(m => m.id === id)) {
    memories.create({id, name: 'Default (empty)', strategy: config.memory?.engine ?? 'recall-memory', description: 'Empty base memory used by chats that name none.'});
  }
  return id;
}
