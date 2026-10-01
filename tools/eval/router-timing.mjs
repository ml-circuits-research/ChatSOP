#!/usr/bin/env node
/**
 * Measurement of the StrategyRouter v1 (reasoning/router, DS006 "Routing rules", DS010; preregistration status/preregistrations/router-v1.json).
 *
 *   node tools/eval/router-timing.mjs [--quick] [--limit-s 60] [--only ring,negation] [--out eval/reports/current/router/timing.json]
 *
 * For each circuit shape and size of the speed table (eval/smoke-reasoning/bench/datalog-scale.mjs: the answer is known by construction) it
 * asks the question of the wire-level problem {handle: {wires}, query} through: the oracle alone (`reference`), each routable engine
 * requested by name, and the router (`auto`, verification on the policy of the router). One process per cell with a wall-clock limit. Per
 * cell: median-of-one wall milliseconds of the ask, status, completeness, whether the answer equals the known answer, and for `auto` the
 * chosen engine, the rule and the verification outcome. The summary at the end is the preregistered comparison: answer agreement of the
 * router with the known answer and with the oracle where the oracle completes, and latency oracle-only versus router.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '../../sop/knowledge/index.mjs';
import * as scale from '../../eval/smoke-reasoning/bench/datalog-scale.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const SHAPES = {ring: scale.ringComponents, selective: scale.selectiveChain, dense: scale.denseNonlinear, negation: scale.negationChain, aggregates: scale.groupAggregates};

const CELLS = [
  ['ring', '10^2', {components: 10, size: 10}], ['ring', '3x10^2', {components: 30, size: 10}], ['ring', '6x10^2', {components: 60, size: 10}], ['ring', '10^3', {components: 100, size: 10}], ['ring', '10^4', {components: 1000, size: 10}], ['ring', '10^5', {components: 10000, size: 10}],
  ['selective', '10^4', {components: 200, size: 50}], ['selective', '10^5', {components: 2000, size: 50}],
  ['dense', '30 nodes', {nodes: 30, density: 3}], ['dense', '100 nodes', {nodes: 100, density: 3}], ['dense', '200 nodes', {nodes: 200, density: 3}],
  ['negation', '10^3', {nodes: 600}], ['negation', '10^4', {nodes: 6000}], ['negation', '10^5', {nodes: 60000}],
  ['aggregates', '10^3', {rows: 1000, departments: 20}], ['aggregates', '10^4', {rows: 10000, departments: 100}], ['aggregates', '10^5', {rows: 100000, departments: 1000}],
];
const ENGINE_COLUMNS = ['reference', 'sql-sqlite', 'datalog-souffle', 'asp-clingo', 'auto'];

function parseInChunks(text, size = 400) {
  const blocks = text.split(/\n(?=@)/), wires = [];
  for (let i = 0; i < blocks.length; i += size) {
    const {wires: ws, errors} = parse(blocks.slice(i, i + size).join('\n') + '\n');
    if (errors.length) throw new Error(errors[0].message);
    wires.push(...ws);
  }
  return wires;
}
const key = r => JSON.stringify(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1)));
const sameRows = (a, b) => a.length === b.length && JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());

async function worker(spec) {
  const {routedAsk} = await import('../../reasoning/router/index.mjs');
  const inst = SHAPES[spec.shape](spec.params);
  const wires = parseInChunks(inst.knowledge);
  const t = performance.now();
  const packet = routedAsk({handle: {kind: 'js-reference-handle', knowledge: '', wires}, query: inst.query, requested: spec.engine, budget: spec.budget ?? {}});
  const ms = Math.round(performance.now() - t);
  const complete = packet.complete !== false && packet.status !== 'unsupported';
  const correct = !complete ? null : inst.answer.rows ? sameRows(packet.rows ?? [], inst.answer.rows) : packet.count === inst.answer.count;
  console.log(JSON.stringify({ok: true, facts: inst.facts, ms, status: packet.status, complete, reason: packet.code ?? packet.budget?.reason ?? packet.reason ?? null, correct, chosen: packet.route?.chosen ?? null, rule: packet.route?.rule ?? null, verification: packet.route?.verification?.outcome ?? (packet.route?.verification ? 'skipped' : null), rssMb: Math.round(process.memoryUsage().rss / 1048576)}));
}

if (args[0] === '--cell') {
  worker(JSON.parse(args[1])).catch(e => { console.log(JSON.stringify({ok: false, error: String(e.message ?? e).slice(0, 300)})); });
} else {
  const limitS = Number(opt('--limit-s', 60));
  const only = opt('--only', null)?.split(',');
  const quick = args.includes('--quick');
  const out = path.resolve(project, opt('--out', 'eval/reports/current/router/timing.json'));
  // the product setting: no caller budget, so every engine runs under its own default ceilings (a budget argument would keep the router on the oracle)
  const budget = {};
  const results = [];
  for (const [shape, size, params] of CELLS) {
    if (only && !only.includes(shape)) continue;
    if (quick && /10\^5/.test(size)) continue;
    for (const engine of ENGINE_COLUMNS) {
      const r = spawnSync(process.execPath, ['--max-old-space-size=16000', '--no-warnings', fileURLToPath(import.meta.url), '--cell', JSON.stringify({shape, params, engine, budget})], {encoding: 'utf8', timeout: limitS * 1000, maxBuffer: 1 << 26});
      let cell;
      if (r.error?.code === 'ETIMEDOUT') cell = {ok: true, timedOut: true};
      else { try { cell = JSON.parse((r.stdout || '').trim().split('\n').at(-1)); } catch { cell = {ok: false, error: (r.stderr || r.stdout || String(r.error)).slice(-200)}; } }
      results.push({shape, size, engine, ...cell});
      console.error(`${shape.padEnd(10)} ${size.padEnd(10)} ${engine.padEnd(16)} ${cell.timedOut ? 'TIMEOUT' : cell.ok ? `${cell.ms} ms ${cell.status}${cell.complete ? '' : ' (' + cell.reason + ')'}${cell.correct === false ? ' WRONG' : ''}${engine === 'auto' ? ` -> ${cell.chosen} [${cell.rule}, verification ${cell.verification}]` : ''}` : 'ERROR ' + cell.error}`);
    }
  }
  // the preregistered comparison
  const cells = {};
  for (const r of results) (cells[r.shape + ' ' + r.size] ??= {})[r.engine] = r;
  const rows = Object.entries(cells).map(([cell, e]) => ({cell, facts: e.auto?.facts ?? null, oracle_ms: e.reference?.timedOut ? 'timeout' : e.reference?.ms ?? null, oracle_complete: e.reference?.complete ?? null, oracle_correct: e.reference?.correct ?? null,
    router_ms: e.auto?.timedOut ? 'timeout' : e.auto?.ms ?? null, router_chosen: e.auto?.chosen ?? null, router_rule: e.auto?.rule ?? null, router_verification: e.auto?.verification ?? null, router_complete: e.auto?.complete ?? null, router_correct: e.auto?.correct ?? null}));
  const decided = rows.filter(r => r.router_complete);
  const summary = {cells: rows.length, router_complete: decided.length, router_correct: decided.filter(r => r.router_correct).length, router_wrong: decided.filter(r => r.router_correct === false).length,
    oracle_complete: rows.filter(r => r.oracle_complete).length, oracle_correct: rows.filter(r => r.oracle_complete && r.oracle_correct).length,
    oracle_wrong: rows.filter(r => r.oracle_complete && r.oracle_correct === false).length,
    router_agrees_with_oracle_where_oracle_completes: rows.filter(r => r.oracle_complete && r.router_complete).every(r => r.oracle_correct === r.router_correct)};
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify({generated: new Date().toISOString(), note: 'Regenerable observation (tools/eval/router-timing.mjs): wall ms of the ask per cell, one process per cell, instance pre-parsed; `auto` includes the oracle verification of the router.', limitS, machine: {cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30), node: process.version, platform: `${os.platform()} ${os.arch()}`}, summary, rows, results}, null, 1) + '\n');
  console.log(JSON.stringify(summary));
}
