// The agent of `tinyagent run`: BM25, frontmatter, path confinement, skill discovery and scripts, schema extraction, the plan cache
// lifecycle (plan -> verified -> reuse; draft; edited -> re-verified), re-planning, plan-only, promotion, and adversarial plans against
// the new tools. Model calls go to a fake client; no server, no network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildIndex, terms, parseFrontmatter, createWorkspace, discoverSkills, skillRoots, runSkillScript, coerceToSchema, matchPlan,
  runAgent, PlanCache, planHash, planScript, executePlan, agentSettings, promotedPluginSource, extractMeta,
} from '../lib/agent/index.mjs';

const tmp = (name = 'ta-agent-') => fs.mkdtempSync(path.join(os.tmpdir(), name));
const MATCH_PROMPT = new URL('../prompts/agent-match.md', import.meta.url).pathname;

/** A fake TinyAgent client: `reply(o)` gives the text of each call by tier; every call is kept. */
function fakeTa(reply) {
  const calls = [];
  const ta = {
    calls,
    with: () => ta,
    async chat(o) { calls.push(o); const text = await reply(o, calls); return { ok: true, text, tier: o.tier, served: `fake-${o.tier}`, credits: o.tier === 'good' ? 0.1 : 0, usage: { in: 100, out: 50 }, ms: 2 }; },
    registerRun: async () => ({ ok: true }), finishRun: async () => ({ ok: true }),
  };
  return ta;
}
const CONFIG = { agent: { plannerTier: 'good', matchTier: 'tiny', askTiers: ['tiny', 'small'], timeMs: 20000 } };
const block = (code) => '```js\n' + code + '\n```';

const SUM_PLAN = `export const meta = {
  name: 'sum-csv-column',
  task: 'Sum a numeric column of a CSV file.',
  params: {file: {type: 'string', description: 'the CSV file'}, column: {type: 'string', description: 'the header of the column to sum'}},
  example: {file: 'sales.csv', column: 'amount'},
  skills: [],
};
const rowsOf = (text) => text.trim().split('\\n').map((l) => l.split(','));
export default async function run(tools, params) {
  const rows = rowsOf(await tools.read(params.file));
  const i = rows[0].indexOf(params.column);
  if (i < 0) throw new Error('no column ' + params.column);
  return {answer: String(rows.slice(1).reduce((s, r) => s + Number(r[i]), 0)), outputs: []};
}
export async function check(tools, params, result) {
  const rows = rowsOf(await tools.read(params.file));
  const i = rows[0].indexOf(params.column);
  let t = 0; for (const r of rows.slice(1)) t += Number(r[i]);
  return {ok: String(t) === result.answer, reason: 'recomputed the total'};
}`;

function csvFolder() {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'sales.csv'), 'id,amount,qty\n1,10,2\n2,32,1\n3,8,5\n');
  fs.writeFileSync(path.join(dir, 'march.csv'), 'id,amount,qty\n1,100,7\n2,1,1\n');
  return dir;
}

test('BM25 ranks the document that shares the rare terms first, in milliseconds', () => {
  assert.deepEqual(terms('Renaming the FILES, copies; boxes'), ['renaming', 'the', 'file', 'copy', 'box']);
  const docs = [
    { id: 'sum', fields: [{ text: 'Sum a numeric column of a CSV file', weight: 2 }, { text: 'file column' }] },
    { id: 'rename', fields: [{ text: 'Rename files in a folder by a pattern', weight: 2 }, { text: 'folder pattern prefix' }] },
    { id: 'table', fields: [{ text: 'Extract a table from a text file into CSV', weight: 2 }] },
  ];
  for (let i = 0; i < 300; i++) docs.push({ id: `filler-${i}`, fields: [{ text: `unrelated document number ${i} about weather and gardens` }] });
  const t0 = performance.now();
  const idx = buildIndex(docs);
  const hits = idx.search('rename the photos in this folder with prefix img', { k: 3 });
  assert.ok(performance.now() - t0 < 100, 'index and search within 100 ms');
  assert.equal(hits[0].id, 'rename');
  assert.equal(idx.search('sum the qty column of march.csv')[0].id, 'sum');
  assert.deepEqual(idx.search('zzz qqq'), []);
});

test('frontmatter: scalars, quoted strings, block scalars, lists and one nested map', () => {
  const { data, body } = parseFrontmatter(`---\nname: csv-tools\ndescription: >\n  Tools for CSV files:\n  totals and columns.\nlicense: "MIT"\nscripts:\n  - scripts/stats.mjs\n  - scripts/x.py\nmetadata:\n  version: 2\n  author: someone\nflag: true\n---\n# Body\ntext\n`);
  assert.equal(data.name, 'csv-tools');
  assert.equal(data.description, 'Tools for CSV files: totals and columns.');
  assert.equal(data.license, 'MIT');
  assert.deepEqual(data.scripts, ['scripts/stats.mjs', 'scripts/x.py']);
  assert.deepEqual(data.metadata, { version: 2, author: 'someone' });
  assert.equal(data.flag, true);
  assert.match(body, /^# Body/);
  assert.equal(parseFrontmatter('no frontmatter').hasFrontmatter, false);
});

test('path confinement: escapes through .., absolute paths, symbolic links and protected folders are refused', () => {
  const dir = tmp(), outside = tmp('ta-outside-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'a.txt'), 'A');
  fs.symlinkSync(outside, path.join(dir, 'out-link'));
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'secret-link.txt'));
  fs.symlinkSync(path.join(dir, 'sub', 'a.txt'), path.join(dir, 'inner-link.txt'));
  fs.symlinkSync(path.join(outside, 'nope.txt'), path.join(dir, 'dangling.txt'));
  const ws = createWorkspace(dir);
  assert.equal(ws.read('sub/a.txt'), 'A');
  assert.equal(ws.read(path.join(dir, 'sub', 'a.txt')), 'A', 'an absolute path inside is accepted');
  assert.equal(ws.read('inner-link.txt'), 'A', 'a link that stays inside can be read');
  for (const p of ['../x', 'sub/../../x', path.join(outside, 'secret.txt'), 'out-link/secret.txt', 'secret-link.txt', 'dangling.txt', 'a\0b', '', '/etc/passwd']) {
    assert.throws(() => ws.read(p), (e) => e.code === 'path_refused', `read ${JSON.stringify(p)}`);
  }
  for (const p of ['out-link/new.txt', 'inner-link.txt', 'dangling.txt', '.tinyagent/plans/x/plan.mjs', '.agents/skills/x/SKILL.md', '.git/config', '.', '../y.txt']) {
    assert.throws(() => ws.write(p, 'x'), (e) => e.code === 'path_refused', `write ${JSON.stringify(p)}`);
  }
  assert.equal(fs.existsSync(path.join(outside, 'new.txt')), false);
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'secret');
  assert.deepEqual(ws.write('deep/new/file.txt', 'hi'), { path: 'deep/new/file.txt', bytes: 2 });
  assert.deepEqual(ws.move('deep/new/file.txt', 'moved.txt'), { from: 'deep/new/file.txt', to: 'moved.txt' });
  assert.throws(() => ws.move('sub/a.txt', 'moved.txt'), /never overwrites/);
  assert.throws(() => ws.move('moved.txt', 'out-link/x.txt'), (e) => e.code === 'path_refused');
  assert.throws(() => ws.list('out-link'), (e) => e.code === 'path_refused');
  const listed = ws.list('.', { recursive: true }).map((e) => e.path);
  assert.ok(listed.includes('sub/a.txt') && listed.includes('out-link') && !listed.includes('out-link/secret.txt'), 'links are listed, never followed');
  assert.deepEqual(ws.search('a', { dir: 'sub' }).map((h) => h.path), ['sub/a.txt']);
  const small = createWorkspace(dir, { limits: { maxWriteBytes: 10 } });
  assert.throws(() => small.write('big.txt', 'x'.repeat(11)), /write limit/);
});

test('skill discovery: .agents/skills first, then the configured folders; declared scripts only; no shell', async () => {
  const dir = tmp(), extra = tmp('ta-skills-'), outside = tmp('ta-outside-');
  const mk = (root, name, fm, files = {}) => {
    fs.mkdirSync(path.join(root, name, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\n${fm}\n---\n# ${name}\nInstructions of ${name}.\n`);
    for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(root, name, f), t);
  };
  const local = path.join(dir, '.agents', 'skills');
  mk(local, 'csv-tools', 'name: csv-tools\ndescription: Totals of CSV columns.', { 'scripts/echo.mjs': 'console.log(JSON.stringify(process.argv.slice(2)))', 'scripts/slow.mjs': 'setTimeout(() => {}, 100000)', 'scripts/loud.mjs': 'process.stdout.write("x".repeat(1e6))' });
  mk(local, 'listed', 'name: listed\ndescription: Only the listed script.\nscripts: [scripts/ok.mjs]', { 'scripts/ok.mjs': 'console.log("ok")', 'scripts/hidden.mjs': 'console.log("hidden")' });
  fs.writeFileSync(path.join(outside, 'evil.mjs'), 'console.log("evil")');
  fs.symlinkSync(path.join(outside, 'evil.mjs'), path.join(local, 'csv-tools', 'scripts', 'evil.mjs'));
  mk(extra, 'csv-tools', 'name: csv-tools\ndescription: A second definition that loses.');
  mk(extra, 'summarize', 'name: summarize\ndescription: Summaries of text files.');
  mk(extra, 'Bad_Name', 'name: Bad_Name\ndescription: invalid');
  const { skills, problems } = discoverSkills(skillRoots(dir, [extra]));
  assert.deepEqual([...skills.keys()].sort(), ['csv-tools', 'listed', 'summarize']);
  assert.equal(skills.get('csv-tools').description, 'Totals of CSV columns.');
  assert.deepEqual(skills.get('csv-tools').scripts, ['scripts/echo.mjs', 'scripts/loud.mjs', 'scripts/slow.mjs'], 'a link leaving the skill folder is not a script');
  assert.deepEqual(skills.get('listed').scripts, ['scripts/ok.mjs']);
  assert.ok(problems.some((p) => /already defined/.test(p)) && problems.some((p) => /Bad_Name/.test(p)));
  const r = await runSkillScript(skills.get('csv-tools'), 'scripts/echo.mjs', ['$(touch pwned)', '; rm -rf /', '`id`'], { cwd: dir });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), ['$(touch pwned)', '; rm -rf /', '`id`']);
  assert.equal(fs.existsSync(path.join(dir, 'pwned')), false);
  await assert.rejects(runSkillScript(skills.get('listed'), 'scripts/hidden.mjs', [], { cwd: dir }), /not declared/);
  await assert.rejects(runSkillScript(skills.get('csv-tools'), 'scripts/evil.mjs', [], { cwd: dir }), /not declared/);
  await assert.rejects(runSkillScript(skills.get('csv-tools'), '../../../../bin/sh', [], { cwd: dir }), /not declared/);
  await assert.rejects(runSkillScript(skills.get('csv-tools'), 'scripts/echo.mjs', [1], { cwd: dir }), /strings/);
  const slow = await runSkillScript(skills.get('csv-tools'), 'scripts/slow.mjs', [], { cwd: dir, limits: { timeMs: 500 } });
  assert.equal(slow.timedOut, true);
  const loud = await runSkillScript(skills.get('csv-tools'), 'scripts/loud.mjs', [], { cwd: dir, limits: { maxOutputBytes: 1000 } });
  assert.equal(loud.truncated, true);
  assert.ok(loud.stdout.length <= 1000);
});

test('schema extraction: values are coerced and validated; a refusal, a wrong id, a misfit or an invented value goes to the planner', async () => {
  const schema = { n: { type: 'integer', description: 'n' }, on: { type: 'boolean', description: 'b' }, cols: { type: 'string[]', description: 'c' } };
  assert.deepEqual(coerceToSchema(schema, { n: '12', on: 'false', cols: 'a' }), { n: 12, on: false, cols: ['a'] });
  const plans = [{ id: 'sum-csv-column-abc123', status: 'verified', description: 'Sum a numeric column of a CSV file.', firstRequest: 'Sum the amount column of sales.csv',
    meta: { name: 'sum-csv-column', task: 'Sum a numeric column of a CSV file.', params: { file: { type: 'string', description: 'csv' }, column: { type: 'string', description: 'column' } }, example: { file: 'sales.csv', column: 'amount' } } }];
  const run = (answer, request = 'Sum the qty column of march.csv') => matchPlan({ request, plans, promptFile: MATCH_PROMPT, ask: async () => ({ ok: true, text: JSON.stringify(answer), ms: 1 }) });
  let d = await run({ plan: 'sum-csv-column-abc123', values: { file: 'march.csv', column: 'qty' }, reason: 'same' });
  assert.equal(d.decision, 'reuse');
  assert.deepEqual(d.values, { file: 'march.csv', column: 'qty' });
  assert.equal(d.candidates[0].id, 'sum-csv-column-abc123');
  assert.equal(typeof d.bm25Ms, 'number');
  d = await run({ plan: null, values: {}, reason: 'different' });
  assert.equal(d.decision, 'plan');
  d = await run({ plan: 'other-plan', values: {} });
  assert.match(d.reason, /not a candidate/);
  d = await run({ plan: 'sum-csv-column-abc123', values: { file: 'march.csv' } });
  assert.match(d.reason, /column: required/);
  d = await run({ plan: 'sum-csv-column-abc123', values: { file: 'march.csv', column: 'qty', extra: 1 } });
  assert.match(d.reason, /not an input/);
  d = await run({ plan: 'sum-csv-column-abc123', values: { file: 'april.csv', column: 'qty' } });
  assert.match(d.reason, /not found in the request: file/);
  d = await matchPlan({ request: 'Paint a fence green', plans, promptFile: MATCH_PROMPT, ask: async () => assert.fail('no candidate: no model call') });
  assert.equal(d.decision, 'plan');
});

test('the cache lifecycle: plan -> verified -> reused for a parameter variant without the planner; a different task is planned', async () => {
  const dir = csvFolder();
  let planner = 0, match = 0;
  const ta = fakeTa((o) => {
    if (o.tier === 'good') { planner += 1; return block(SUM_PLAN); }
    match += 1;
    const req = o.messages.at(-1).content.split('NEW REQUEST:\n')[1];
    return /qty column of march/.test(req) ? JSON.stringify({ plan: o.messages.at(-1).content.match(/id: (\S+)/)[1], values: { file: 'march.csv', column: 'qty' }, reason: 'same task' }) : JSON.stringify({ plan: null, reason: 'different task' });
  });
  const logs = [];
  const r1 = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: dir, ta, config: CONFIG, log: (l) => logs.push(l) });
  assert.equal(r1.status, 'finished', JSON.stringify(r1));
  assert.equal(r1.answer, '50');
  assert.equal(r1.how, 'plan');
  assert.equal(r1.planStatus, 'verified');
  assert.equal(r1.plans, path.join(fs.realpathSync(dir), '.tinyagent', 'plans'));
  assert.ok(logs.some((l) => l.startsWith('plans: ')), 'every run prints the plan folder');
  for (const f of ['request.json', 'decision.json', 'plan-1.mjs', 'calls.jsonl', 'result.json']) assert.ok(fs.existsSync(path.join(r1.runDir, f)), f);
  const cache = new PlanCache(r1.plans);
  const stored = cache.read(r1.plan);
  assert.equal(stored.status, 'verified');
  for (const f of ['plan.mjs', 'PLAN.md', 'runs.jsonl']) assert.ok(fs.existsSync(path.join(stored.dir, f)), f);
  assert.match(stored.md, /## Parameters\n- `file` \(string\)/);

  const r2 = await runAgent({ request: 'Sum the qty column of march.csv', workdir: dir, ta, config: CONFIG });
  assert.equal(r2.status, 'finished');
  assert.equal(r2.how, 'reuse');
  assert.equal(r2.answer, '8');
  assert.equal(planner, 1, 'the variant ran the cached plan: no planner call');
  assert.equal(r2.stats.roles.planner, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(r2.runDir, 'decision.json'), 'utf8')).decision, 'reuse');
  assert.equal(cache.runs(r1.plan).length, 2);

  const r3 = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: dir, ta, config: CONFIG });
  assert.equal(r3.decision.how, 'exact', 'the same request reuses the plan without the match tier');
  assert.equal(match, 1);

  const r4 = await runAgent({ request: 'Count the lines of every csv file', workdir: dir, ta, config: CONFIG });
  assert.equal(r4.decision.decision, 'plan', 'a different task is not a reuse');
  assert.equal(planner, 2);
});

test('a plan without a check is stored as draft and not reused until verified', async () => {
  const dir = csvFolder();
  const noCheck = SUM_PLAN.slice(0, SUM_PLAN.indexOf('export async function check'));
  let planner = 0;
  const ta = fakeTa((o) => { if (o.tier === 'good') { planner += 1; return block(noCheck); } return JSON.stringify({ plan: o.messages.at(-1).content.match(/id: (\S+)/)[1], values: { file: 'march.csv', column: 'qty' } }); });
  const r1 = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: dir, ta, config: CONFIG });
  assert.equal(r1.planStatus, 'draft');
  const r2 = await runAgent({ request: 'Sum the qty column of march.csv', workdir: dir, ta, config: CONFIG });
  assert.equal(r2.how, 'plan', 'a draft is never reused');
  assert.equal(r2.decision.reason, 'the cache has no verified plan');
  const cache = new PlanCache(r1.plans);
  cache.verify(r1.plan);
  const r3 = await runAgent({ request: 'Sum the qty column of march.csv', workdir: dir, ta, config: CONFIG });
  assert.equal(r3.how, 'reuse');
  assert.equal(r3.answer, '8');
});

test('a plan edited by hand changes its hash and is re-verified by its check before reuse; a failing edit is not reused', async () => {
  const dir = csvFolder();
  let planner = 0;
  const ta = fakeTa((o) => { if (o.tier === 'good') { planner += 1; return block(SUM_PLAN); } return JSON.stringify({ plan: o.messages.at(-1).content.match(/id: (\S+)/)[1], values: { file: 'march.csv', column: 'qty' } }); });
  const r1 = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: dir, ta, config: CONFIG });
  const cache = new PlanCache(r1.plans);
  const file = path.join(cache.planDir(r1.plan), 'plan.mjs');
  const before = cache.read(r1.plan).hash;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("return {answer: String(", "tools.log('edited');\n  return {answer: String("));
  assert.equal(cache.read(r1.plan).status, 'edited');
  const r2 = await runAgent({ request: 'Sum the qty column of march.csv', workdir: dir, ta, config: CONFIG });
  assert.equal(r2.how, 'reuse-reverified');
  assert.equal(r2.answer, '8');
  const after = cache.read(r1.plan);
  assert.equal(after.status, 'verified');
  assert.notEqual(after.hash, before);
  assert.equal(after.front.verified_hash, after.hash);
  // A wrong edit: the check fails, the plan is not reused, the planner writes a new one.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("String(rows.slice(1)", "String(1 + rows.slice(1)"));
  const r3 = await runAgent({ request: 'Sum the qty column of march.csv', workdir: dir, ta, config: CONFIG });
  assert.equal(r3.how, 'plan');
  assert.equal(r3.status, 'finished');
  assert.notEqual(r3.plan, r1.plan, 'a new plan never overwrites a plan edited by hand');
  assert.equal(planner, 2);
  assert.equal(r3.decision.fallback.plan, r1.plan);
  assert.equal(cache.read(r1.plan).status, 'edited');
});

test('a failing plan goes back to the planner with its error, at most maxRounds rounds; plan-only runs nothing', async () => {
  const dir = csvFolder();
  const broken = SUM_PLAN.replace("rows[0].indexOf(params.column);\n  if", "rows[0].indexOf(params.colum);\n  if");
  const seen = [];
  const ta = fakeTa((o) => { seen.push(o.messages.at(-1).content); return block(seen.length === 1 ? broken : SUM_PLAN); });
  const r = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: dir, ta, config: CONFIG, useCache: false });
  assert.equal(r.status, 'finished');
  assert.equal(r.rounds, 2);
  assert.match(seen[1], /The plan failed \(run, plugin_error\): no column amount \(at run \(plan\.js:12:/, 'the error names the line of plan.mjs');
  assert.match(seen[1], /read\("sales\.csv"\)/);
  assert.equal(fs.readFileSync(path.join(r.runDir, 'errors.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.ok(fs.existsSync(path.join(r.runDir, 'plan-2.mjs')));

  const always = fakeTa(() => block(broken));
  const f = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: dir, ta: always, config: { agent: { ...CONFIG.agent, maxRounds: 3 } }, useCache: false });
  assert.equal(f.status, 'failed');
  assert.equal(always.calls.length, 3);

  const dry = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: tmp(), ta: fakeTa(() => block(SUM_PLAN)), config: CONFIG, planOnly: true });
  assert.equal(dry.status, 'planned');
  assert.match(dry.code, /export default async function run/);
  assert.deepEqual(new PlanCache(dry.plans).ids(), [], 'plan-only stores nothing');
});

test('the planner may ask once for skill bodies and file heads (progressive disclosure)', async () => {
  const dir = csvFolder();
  fs.mkdirSync(path.join(dir, '.agents', 'skills', 'csv-tools'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'skills', 'csv-tools', 'SKILL.md'), '---\nname: csv-tools\ndescription: Totals of CSV columns.\n---\nBODY-OF-CSV-TOOLS\n');
  const seen = [];
  const ta = fakeTa((o) => { seen.push(o.messages.map((m) => ({ ...m }))); return seen.length === 1 ? '{"load_skills": ["csv-tools"], "peek": ["sales.csv", "../etc/passwd"]}' : block(SUM_PLAN); });
  const r = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: dir, ta, config: CONFIG });
  assert.equal(r.status, 'finished');
  assert.match(seen[0][0].content, /- csv-tools: Totals of CSV columns\./);
  assert.doesNotMatch(seen[0][0].content, /BODY-OF-CSV-TOOLS/, 'the planner sees names and descriptions first');
  const context = seen[1].at(-1).content;
  assert.match(context, /BODY-OF-CSV-TOOLS/);
  assert.match(context, /id,amount,qty/);
  assert.match(context, /etc\/passwd: .*outside/);
});

test('adversarial plans: the tools refuse escapes, undeclared scripts, other tiers; no host object is reachable', async () => {
  const dir = csvFolder(), outside = tmp('ta-outside-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(dir, 'link'));
  const ws = createWorkspace(dir);
  const ta = fakeTa(() => 'model says hi');
  const S = agentSettings({ agent: { askTiers: ['tiny'], maxAsks: 2, timeMs: 5000 } });
  const probe = (body) => `export const meta = {name: 'probe', task: 'An adversarial probe plan.', params: {}, example: {}};
export default async function run(tools, params) { ${body} }`;
  const attempt = async (body) => (await executePlan({ code: probe(body), params: {}, workspace: ws, ta, settings: S }));
  const refusals = {
    dotdot: `return await tools.read('../../etc/passwd');`,
    link: `return await tools.read('link/secret.txt');`,
    writeOut: `return await tools.write('link/pwned.txt', 'x');`,
    cache: `return await tools.write('.tinyagent/plans/evil/plan.mjs', 'x');`,
    skillDef: `return await tools.write('.agents/skills/evil/SKILL.md', 'x');`,
    tier: `return await tools.ask('good', 'hi');`,
    script: `return await tools.runSkillScript('nope', 'x.mjs', []);`,
    shell: `return await tools.exec('ls');`,
    ctor: `return tools.read.constructor('return process')();`,
    toolsProto: `return Object.getPrototypeOf(tools).constructor.constructor('return process')();`,
    errCtor: `try { await tools.read('../x'); } catch (e) { return e.constructor.constructor('return process')(); }`,
    imports: `const m = await import('node:fs'); return 1;`,
  };
  for (const [name, body] of Object.entries(refusals)) {
    const r = await attempt(body);
    assert.equal(r.ok, false, `${name} must fail, got ${JSON.stringify(r.result)}`);
  }
  assert.equal(fs.existsSync(path.join(outside, 'pwned.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, '.tinyagent', 'plans', 'evil')), false);
  const asks = await attempt(`const a = await tools.ask('tiny', 'one'); const b = await tools.ask('tiny', 'two'); try { await tools.ask('tiny', 'three'); return 'no limit'; } catch (e) { return {answer: [a, b, e.message]}; }`);
  assert.equal(asks.ok, true, JSON.stringify(asks.error));
  assert.match(asks.result.answer[2], /limit of 2 model calls/);
  const globals = await attempt(`return {answer: [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof Buffer, Object.keys(tools).sort().join(',')].join(' ')};`);
  assert.equal(globals.result.answer, 'undefined undefined undefined undefined undefined ask,list,log,move,read,runSkillScript,search,write');
  assert.equal(planScript(`import fs from 'node:fs';\nexport default async function run() {}`).error.includes('never imports'), true);
  assert.equal(planScript(`const fs = require('fs');`).error.includes('require'), true);
  const loop = await executePlan({ code: probe('for (;;) {}'), params: {}, workspace: ws, ta, settings: { ...S, timeMs: 1000 } });
  assert.equal(loop.error.code, 'plugin_time_limit');
});

test('promotion: a verified plan becomes a SkillPlugin that runs it with the tools confined to inputs.workdir', async () => {
  const dir = csvFolder();
  const ta = fakeTa(() => block(SUM_PLAN));
  const r = await runAgent({ request: 'Sum the amount column of sales.csv', workdir: dir, ta, config: CONFIG });
  const cache = new PlanCache(r.plans);
  const plan = cache.read(r.plan);
  const { meta } = await extractMeta(plan.code);
  const toDir = tmp('ta-plugins-');
  const file = path.join(toDir, 'sum-column.mjs');
  fs.writeFileSync(file, promotedPluginSource({ name: 'sum-column', plan, meta, toDir }));
  const skill = (await import(file)).default;
  assert.equal(skill.name, 'sum-column');
  assert.deepEqual(Object.keys(skill.inputs), ['file', 'column', 'workdir']);
  const out = await skill.run({ inputs: { file: 'march.csv', column: 'amount', workdir: dir }, ta, config: CONFIG, log: () => {} });
  assert.equal(out.status, 'finished');
  assert.equal(out.summary, '101');
  assert.equal(planHash(plan.code), plan.hash);
  cache.remove(r.plan);
  assert.deepEqual(cache.ids(), []);
});
