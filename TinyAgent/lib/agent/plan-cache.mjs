// The plan cache: a plain folder a person or a coding agent can read and edit. One directory per plan:
//
//   <plans>/<id>/plan.mjs     the plan (lib/agent/plan-code.mjs); edit it freely
//   <plans>/<id>/PLAN.md      frontmatter (id, status, verified_hash, created, updated, runs) and sections: Description (edit it to
//                             improve matching), Parameters, Skills, First request, Check, Last runs
//   <plans>/<id>/runs.jsonl   one line per run of the plan (time, run id, how it was chosen, parameters, outcome, ms)
//   <plans>/index.json        derived: the `meta` of every plan.mjs by its hash (rebuilt when a plan changes; safe to delete)
//
// Status: `draft` (stored, never reused), `verified` (passed its own check, or confirmed with `tinyagent plans verify`; reused). A plan
// whose plan.mjs no longer has the hash it was verified with is `edited`: it is re-verified (its check runs) before it is reused.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, writeFrontmatter } from './frontmatter.mjs';
import { planHash } from './plan-code.mjs';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const now = () => new Date().toISOString();
const sectionsOf = (body) => {
  const out = new Map();
  const parts = String(body).split(/^## /m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    out.set((nl < 0 ? part : part.slice(0, nl)).trim(), nl < 0 ? '' : part.slice(nl + 1).trim());
  }
  return { title: parts[0].trim(), sections: out };
};

/** Effective status of a plan: verified only when its current hash is the hash it was verified with. */
export const effectiveStatus = (front, hash) => (front.status === 'verified' ? (front.verified_hash === hash ? 'verified' : 'edited') : 'draft');

export class PlanCache {
  constructor(dir) { this.dir = path.resolve(dir); }

  ensure() { fs.mkdirSync(this.dir, { recursive: true }); return this; }
  planDir(id) { if (!ID.test(String(id))) throw new Error(`invalid plan id ${id}`); return path.join(this.dir, id); }
  ids() { return fs.existsSync(this.dir) ? fs.readdirSync(this.dir, { withFileTypes: true }).filter((e) => e.isDirectory() && ID.test(e.name) && fs.existsSync(path.join(this.dir, e.name, 'plan.mjs'))).map((e) => e.name).sort() : []; }
  readIndex() { try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8')); } catch { return { version: 1, plans: {} }; } }
  writeIndex(index) { this.ensure(); const f = path.join(this.dir, 'index.json'); fs.writeFileSync(`${f}.tmp`, JSON.stringify(index, null, 1) + '\n'); fs.renameSync(`${f}.tmp`, f); }

  /** One plan as stored now: {id, dir, code, hash, front, status, description, firstRequest, md}. Meta comes from `load`. */
  read(id) {
    const dir = this.planDir(id);
    if (!fs.existsSync(path.join(dir, 'plan.mjs'))) throw new Error(`no plan ${id} in ${this.dir}`);
    const code = fs.readFileSync(path.join(dir, 'plan.mjs'), 'utf8');
    const md = fs.existsSync(path.join(dir, 'PLAN.md')) ? fs.readFileSync(path.join(dir, 'PLAN.md'), 'utf8') : '';
    const { data: front, body } = parseFrontmatter(md);
    const { sections } = sectionsOf(body);
    const hash = planHash(code);
    return { id, dir, code, hash, front, status: effectiveStatus(front, hash), description: sections.get('Description') ?? '', firstRequest: sections.get('First request') ?? '', md };
  }

  /**
   * Every plan with its meta. `extractMeta(code)` -> {meta} | {error} runs the plan's meta in the sandbox; it is called only for plans
   * whose hash is not in index.json (new or edited plans). Returns [{...read(id), meta, metaError}].
   */
  async load({ extractMeta } = {}) {
    const index = this.readIndex();
    let changed = false;
    const out = [];
    for (const id of this.ids()) {
      let p;
      try { p = this.read(id); } catch { continue; }
      let entry = index.plans[id];
      if ((!entry || entry.hash !== p.hash) && extractMeta) {
        const r = await extractMeta(p.code);
        entry = { hash: p.hash, meta: r.meta ?? null, error: r.error ?? null };
        index.plans[id] = entry; changed = true;
      }
      out.push({ ...p, meta: entry?.hash === p.hash ? entry.meta : null, metaError: entry?.hash === p.hash ? entry.error : 'meta not read' });
    }
    for (const id of Object.keys(index.plans)) if (!out.some((p) => p.id === id)) { delete index.plans[id]; changed = true; }
    if (changed) this.writeIndex(index);
    return out;
  }

  /** Stores a new plan (or finds the same code already stored). Returns its id. */
  save({ code, meta, request, verified, check, description = null }) {
    this.ensure();
    const hash = planHash(code);
    // The id names the plan and its first hash; a folder of that name whose plan.mjs was edited since is never overwritten.
    let id = `${String(meta.name).slice(0, 48)}-${hash.slice(0, 6)}`;
    for (let n = 2; fs.existsSync(path.join(this.planDir(id), 'plan.mjs')); n++) {
      if (planHash(fs.readFileSync(path.join(this.planDir(id), 'plan.mjs'), 'utf8')) === hash) {
        if (verified) this.setStatus(id, 'verified', hash);
        return id;
      }
      id = `${String(meta.name).slice(0, 48)}-${hash.slice(0, 6)}-${n}`;
    }
    const dir = this.planDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plan.mjs'), code.endsWith('\n') ? code : `${code}\n`);
    const front = { id, status: verified ? 'verified' : 'draft', verified_hash: verified ? hash : null, created: now(), updated: now(), runs: 0 };
    fs.writeFileSync(path.join(dir, 'PLAN.md'), renderPlanMd({ front, meta, description: description ?? meta.description ?? meta.task, request, check, lastRuns: [] }));
    const index = this.readIndex();
    index.plans[id] = { hash, meta, error: null };
    this.writeIndex(index);
    return id;
  }

  /** Rewrites PLAN.md's frontmatter and derived sections, keeping the Description a person may have edited. */
  rewrite(id, { front: patch = {}, meta = null, lastRuns = null } = {}) {
    const p = this.read(id);
    const { body } = parseFrontmatter(p.md);
    const { sections } = sectionsOf(body);
    const front = { ...p.front, ...patch, id, updated: now() };
    const m = meta ?? this.readIndex().plans[id]?.meta ?? {};
    const text = renderPlanMd({ front, meta: m, description: sections.get('Description') ?? m.task ?? '', request: sections.get('First request') ?? '',
      check: sections.get('Check') ?? null, lastRuns: lastRuns ?? (sections.get('Last runs') ?? '').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)) });
    fs.writeFileSync(path.join(p.dir, 'PLAN.md'), text);
  }

  setStatus(id, status, hash = null) {
    const p = this.read(id);
    this.rewrite(id, { front: { status, verified_hash: status === 'verified' ? hash ?? p.hash : null } });
  }

  /** `tinyagent plans verify`: a person confirms the plan as it is now. */
  verify(id) { const p = this.read(id); this.setStatus(id, 'verified', p.hash); return this.read(id); }

  /** Appends a run to runs.jsonl and to PLAN.md's last runs (at most 5 kept there). */
  recordRun(id, run) {
    const p = this.read(id);
    const line = { at: now(), ...run, hash: p.hash };
    fs.appendFileSync(path.join(p.dir, 'runs.jsonl'), JSON.stringify(line) + '\n');
    const { sections } = sectionsOf(parseFrontmatter(p.md).body);
    const last = (sections.get('Last runs') ?? '').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    const entry = `${line.at.slice(0, 19)}Z ${run.ok ? 'ok' : 'failed'} ${run.how ?? ''} ${run.ms ?? '?'} ms ${JSON.stringify(run.params ?? {}).slice(0, 160)}${run.run ? ` (run ${run.run})` : ''}`;
    this.rewrite(id, { front: { runs: Number(p.front.runs ?? 0) + 1, last_used: line.at }, lastRuns: [entry, ...last].slice(0, 5) });
  }

  runs(id) {
    const f = path.join(this.planDir(id), 'runs.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  }

  remove(id) {
    const dir = this.planDir(id);
    if (!fs.existsSync(dir)) throw new Error(`no plan ${id}`);
    fs.rmSync(dir, { recursive: true, force: true });
    const index = this.readIndex();
    delete index.plans[id];
    this.writeIndex(index);
  }
}

/** PLAN.md of a plan. */
export function renderPlanMd({ front, meta, description, request, check, lastRuns }) {
  const params = Object.entries(meta?.params ?? {});
  return `${writeFrontmatter(front)}# ${meta?.name ?? front.id}

## Description
${String(description ?? '').trim() || '(none)'}

## Parameters
${params.length ? params.map(([k, d]) => `- \`${k}\` (${d.type}${d.default !== undefined ? `, default ${JSON.stringify(d.default)}` : ''}): ${d.description ?? ''}`).join('\n') : '(none)'}

## Skills
${(meta?.skills ?? []).length ? meta.skills.join(', ') : '(none)'}

## First request
${String(request ?? '').trim() || '(unknown)'}

## Check
${check ?? '(none)'}

## Last runs
${(lastRuns ?? []).map((l) => `- ${l}`).join('\n') || '(none)'}
`;
}
