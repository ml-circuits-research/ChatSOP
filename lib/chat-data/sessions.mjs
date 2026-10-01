/**
 * Chat sessions (DS022 "Sessions"): one folder per chat under `chat_data/sessions/<id>/`.
 *
 *   session.json        id, user, base (id, name, strategy, circuits), created_at, last_active_at, settings, kept
 *   repo/               the memory repository cloned from the base memory (hard links) plus the session's accepted circuits
 *   base_circuits/      the base memory's circuits at the time of the clone (a session is self-contained)
 *   circuits/           circuits the user accepted during the conversation (session layer)
 *   drafts/<id>.json    circuits proposed by the authoring path, waiting for accept or reject
 *   requests/<req>/     one temporary folder per authoring request (attached files, TASK.md, omp session, results)
 *   agent/              the conversation context and the last answer of the chat agent (server/session-store.mjs)
 *   provenance.jsonl    acceptances and the commit
 *   transcript.jsonl    the turns
 *
 * Nothing a session holds is knowledge of the base memory. Asserted statements stay turn-local evidence in `agent/`; circuits
 * enter `circuits/` only when the user accepts a draft (an explicit action); a commit to a fork of a base memory is a separate
 * action of any authenticated user that validates everything again and records provenance in the new memory.
 */
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../../memory/repository.mjs';
import {assertFolderId, newId} from './index.mjs';
import {BASE_NAME, cloneRepository, ingestFacts, memoryConfigFor, validateCircuits} from './memories.mjs';
import {createHash} from 'node:crypto';

const fail = (message, code = 'invalid_request', status = 400) => Object.assign(new Error(message), {code, status});
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(tmp, file); };
const sha = text => createHash('sha256').update(text).digest('hex');
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'circuit';

export const SESSION_SETTINGS = Object.freeze({
  // The model the session prefers for the coding agent (tried first, before the configured subscription chain); null uses the chain.
  omp_model: {default: null},
});

export function checkSettings(settings = {}) {
  const out = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!(key in SESSION_SETTINGS)) throw fail(`Unknown session setting ${JSON.stringify(key)}; known: ${Object.keys(SESSION_SETTINGS).join(', ')}`, 'unsupported_parameter');
    const spec = SESSION_SETTINGS[key];
    if (spec.values && !(spec.nullable && value === null) && !spec.values.includes(value)) throw fail(`${key} must be one of ${spec.values.join(', ')}`, 'invalid_parameter');
    if (key === 'omp_model' && value !== null && (typeof value !== 'string' || value.length > 200 || /[\s\0]/.test(value))) throw fail('omp_model must be a model selector such as provider/model', 'invalid_parameter');
    out[key] = value;
  }
  return out;
}

export class Sessions {
  constructor({chatData, memories, memory = {}}) {
    this.chatData = chatData;
    this.memories = memories;
    this.memory = memory;
    this.root = chatData.sessionsDir;
  }

  dir(id) { return path.join(this.root, assertFolderId(id, 'session id')); }
  infoFile(id) { return path.join(this.dir(id), 'session.json'); }

  info(id) {
    const info = readJson(this.infoFile(id));
    if (!info) throw fail(`Unknown session ${JSON.stringify(id)}`, 'unknown_session', 404);
    return info;
  }

  /** Session information visible to `user` (the owner, or an administrator). */
  visible(id, {user, admin = false}) {
    const info = this.info(id);
    if (!admin && info.user !== user) throw fail('This session belongs to another user', 'forbidden', 403);
    return info;
  }

  save(info) { writeJson(this.infoFile(info.id), info); return info; }

  touch(id, now = new Date()) { const info = this.info(id); info.last_active_at = now.toISOString(); return this.save(info); }

  /** Starts a session on a base memory: the base's repository is cloned by hard links, its circuits are copied. */
  create({base, user, id, name = '', settings = {}, now = new Date()}) {
    const manifest = this.memories.manifest(base);
    id = id ? assertFolderId(id, 'session id') : newId('s', now.getTime());
    if (fs.existsSync(this.dir(id))) throw fail(`Session ${id} already exists`, 'session_exists', 409);
    const folder = this.dir(id);
    fs.mkdirSync(folder, {recursive: true, mode: 0o700});
    for (const sub of ['circuits', 'drafts', 'requests', 'base_circuits', 'agent']) fs.mkdirSync(path.join(folder, sub));
    cloneRepository(path.join(this.memories.dir(base), 'repo'), path.join(folder, 'repo'));
    // The layered circuits of the base (imports first): the session is self-contained, its lexicon and validation never read the base again.
    this.memories.layeredCircuits(base).forEach((c, i) => fs.writeFileSync(path.join(folder, 'base_circuits', `${String(i + 1).padStart(4, '0')}-${c.layer ? c.layer + '-' : ''}${c.name.replace(/^.*:/, '').replace(/^\d+-/, '')}`), c.text));
    const info = {
      id, user, name: String(name).slice(0, 120) || manifest.name, created_at: now.toISOString(), last_active_at: now.toISOString(),
      base: {id: manifest.id, name: manifest.name, strategy: manifest.strategy, circuits: manifest.circuits},
      settings: {omp_model: null, ...checkSettings(settings)}, kept: false, committed_to: [],
    };
    return this.save(info);
  }

  list({user, admin = false}) {
    return fs.readdirSync(this.root).filter(id => fs.existsSync(path.join(this.root, id, 'session.json'))).map(id => this.info(id))
      .filter(info => admin || info.user === user).sort((a, b) => b.last_active_at.localeCompare(a.last_active_at));
  }

  updateSettings(id, settings) {
    const info = this.info(id);
    info.settings = {...info.settings, ...checkSettings(settings)};
    return this.save(info);
  }

  repository(id) {
    const info = this.info(id);
    return new Repository(path.join(this.dir(id), 'repo'), {memory: memoryConfigFor(this.memory, info.base)});
  }

  readCircuits(folder) {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).filter(n => n.endsWith('.sop')).sort().map(name => ({name, text: fs.readFileSync(path.join(folder, name), 'utf8')}));
  }

  baseCircuits(id) { return this.readCircuits(path.join(this.dir(id), 'base_circuits')); }
  circuits(id) { return this.readCircuits(path.join(this.dir(id), 'circuits')); }

  /** The compiled lexicon of the session: its base's layered circuits followed by the accepted session circuits (cached by hash). */
  lexicon(id) { return this.chatData.lexicons.get([...this.baseCircuits(id), ...this.circuits(id)], {provenance: `session:${id}`}); }

  /** Base theory followed by the accepted session circuits (drafts are never part of it). */
  theory(id) { return [...this.baseCircuits(id), ...this.circuits(id)].map(c => c.text.trimEnd()).join('\n\n') + '\n'; }

  appendProvenance(id, record) { fs.appendFileSync(path.join(this.dir(id), 'provenance.jsonl'), JSON.stringify(record) + '\n'); }
  provenance(id) {
    const file = path.join(this.dir(id), 'provenance.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  }

  // ---- drafts -----------------------------------------------------------------------------------------------------------

  draftFile(id, draftId) { return path.join(this.dir(id), 'drafts', assertFolderId(draftId, 'draft id') + '.json'); }

  drafts(id) {
    const folder = path.join(this.dir(id), 'drafts');
    return fs.readdirSync(folder).filter(n => n.endsWith('.json')).map(n => readJson(path.join(folder, n))).filter(Boolean)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  draft(id, draftId) {
    const d = readJson(this.draftFile(id, draftId));
    if (!d) throw fail(`Unknown draft ${JSON.stringify(draftId)}`, 'unknown_draft', 404);
    return d;
  }

  /** Stores a proposed circuit as a draft with the result of its validation; a draft is not knowledge. */
  addDraft(id, {name, text, request = null, model = null, validation = null, extra = {}, now = new Date()}) {
    if (typeof text !== 'string' || !text.trim()) throw fail('A draft needs a circuit text', 'invalid_circuits');
    const draftId = newId('d', now.getTime());
    const check = validation ?? validateCircuits([{name, text}], [...this.baseCircuits(id), ...this.circuits(id)]);
    const draft = {id: draftId, name: String(name), text, state: 'draft', status: 'proposed', created_at: now.toISOString(), request, model, validation: {ok: check.ok, problems: check.problems, warnings: check.warnings ?? []}, ...extra};
    writeJson(this.draftFile(id, draftId), draft);
    return draft;
  }

  rejectDraft(id, draftId, now = new Date()) {
    const d = this.draft(id, draftId);
    if (d.state !== 'draft') throw fail(`Draft ${draftId} is already ${d.state}`, 'draft_closed', 409);
    writeJson(this.draftFile(id, draftId), {...d, state: 'rejected', status: 'rejected', closed_at: now.toISOString()});
    return this.draft(id, draftId);
  }

  /**
   * Accepts a draft into the session layer: validated again together with the base and session circuits, stored as the next
   * session circuit, its facts ingested into the session's repository. The acceptance is the user's explicit action.
   */
  acceptDraft(id, draftId, {approvedBy, now = new Date()}) {
    const d = this.draft(id, draftId);
    if (d.state !== 'draft') throw fail(`Draft ${draftId} is already ${d.state}`, 'draft_closed', 409);
    const check = validateCircuits([{name: d.name, text: d.text}], [...this.baseCircuits(id), ...this.circuits(id)]);
    if (!check.ok) throw Object.assign(fail('The draft does not pass the knowledge validator; it stays a draft', 'validation_failed', 422), {problems: check.problems, warnings: check.warnings});
    const seq = this.circuits(id).length + 1;
    const file = `${String(seq).padStart(4, '0')}-${slug(d.name)}.sop`;
    fs.writeFileSync(path.join(this.dir(id), 'circuits', file), d.text);
    const ingest = ingestFacts(this.repository(id), BASE_NAME, d.text, {knownAt: now.getTime()});
    const record = {kind: 'accept', seq, file, draft: d.id, sha256: sha(d.text), approved_by: approvedBy, approved_at: now.toISOString(), request: d.request, model: d.model, ingest};
    this.appendProvenance(id, record);
    writeJson(this.draftFile(id, draftId), {...d, state: 'accepted', status: 'accepted', closed_at: now.toISOString(), circuit: file});
    return {draft: this.draft(id, draftId), record, warnings: check.warnings};
  }

  // ---- commit to a fork --------------------------------------------------------------------------------------------------

  /**
   * Commits the session's accepted circuits to a NEW base memory: a fork of the session's base memory plus those circuits.
   * The fork is taken from the base memory's current state (hard-link clone, or a replay when the strategy changes), the session
   * circuits are validated on top of it and added with provenance (`kind: commit`, the session id as source). Any authenticated user
   * action; the base memory the session started from is never changed.
   */
  commit(id, {name, strategy, description = '', approvedBy, newId: wanted, now = new Date()}) {
    if (!approvedBy) throw fail('Committing to a base memory needs the acting user (approvedBy)', 'approval_required', 403);
    const info = this.info(id);
    const sessionCircuits = this.circuits(id);
    if (!sessionCircuits.length) throw fail('The session has no accepted circuits to commit', 'nothing_to_commit', 409);
    const parent = this.memories.manifest(info.base.id);
    const target = strategy ?? info.base.strategy;
    const fork = this.memories.fork(parent.id, {name, strategy: target, description: description || `Committed from session ${id}`, newId: wanted, now});
    const created = fork.memory.id;
    const additions = sessionCircuits.map(c => ({name: c.name.replace(/^\d+-/, ''), text: c.text}));
    const check = validateCircuits(additions, this.memories.layeredCircuits(created));
    if (!check.ok) {
      this.memories.delete(created);
      throw Object.assign(fail('The session circuits do not pass the validator on top of the base memory; nothing was committed', 'validation_failed', 422), {problems: check.problems, warnings: check.warnings});
    }
    const added = additions.map(c => this.memories.store(created, c, {approvedBy, reason: `commit of session ${id}`, source: `session:${id}`, now, kind: 'commit'}));
    const result = this.memories.describe(created);
    const next = this.info(id);
    next.committed_to = [...(next.committed_to ?? []), {id: created, at: now.toISOString(), by: approvedBy}];
    this.save(next);
    return {memory: result, added, fork_method: fork.method};
  }

  // ---- transcript, requests ----------------------------------------------------------------------------------------------

  appendTranscript(id, entry, now = new Date()) {
    fs.appendFileSync(path.join(this.dir(id), 'transcript.jsonl'), JSON.stringify({ts: now.toISOString(), ...entry}) + '\n');
    this.touch(id, now);
  }

  transcript(id, {limit = 200} = {}) {
    const file = path.join(this.dir(id), 'transcript.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(-limit);
  }

  /** The temporary folder of one authoring request inside the session. */
  requestFolder(id) {
    const reqId = newId('r');
    const dir = path.join(this.dir(id), 'requests', reqId);
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    return {id: reqId, dir};
  }

  describe(id) {
    const info = this.info(id);
    return {...info, circuits: this.circuits(id).map(c => c.name), drafts: this.drafts(id).map(({text, ...d}) => d), provenance: this.provenance(id).slice(-20)};
  }

  delete(id) { this.info(id); fs.rmSync(this.dir(id), {recursive: true, force: true}); }
}
