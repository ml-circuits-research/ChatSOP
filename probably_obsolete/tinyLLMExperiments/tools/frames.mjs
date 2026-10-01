#!/usr/bin/env node
/**
 * Build and inspect the host frame and synonym list (sop/frames.mjs; owner answer to Q-SYM-2).
 *
 *   node tools/frames.mjs build [--wordnet <dict dir>]    write config/dictionary/frames-{world,train,wordnet}.tsv
 *   node tools/frames.mjs lookup <relation>               the frame a relation phrase names
 *   node tools/frames.mjs normalize --file <program.sop>  print the normalized program and its changes
 *
 * Sources (training side only; no sealed suite is read):
 *   world    datasets_archive/formalizer-v1/world/predicates.sop: every predicate's labels and aliases (English and
 *            Romanian) with its declared roles (ChatSOP-authored generator lexicon, MIT);
 *   train    gold relations of datasets_archive/formalizer-v1 train rows that the world does not name, with their majority
 *            role set (seen at least 3 times, majority at least 80%; ChatSOP-authored synthetic corpus, MIT);
 *   wordnet  English verb synonyms from Princeton WordNet 3.0 (local cache datasets_sources/wordnet-3.0/, WordNet
 *            3.0 licence, notice kept in the file header): for the head verb of a world or train frame, the other
 *            members of its most frequent verb sense replace the verb in each English surface.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../lib/jsonl-shards.mjs';
import {parse, many, isMatch, parseMatch} from '../sop/parser.mjs';
import {parseCondition} from '../sop/conditions.mjs';
import {propositionOf} from '../sop/propositions.mjs';
import {phraseKey} from '../sop/linking.mjs';
import {formatFrames, Frames, normalizeProgram, loadFrames} from '../sop/frames.mjs';
import {defaultDictionary} from '../sop/dictionary.mjs';
const dictionary = defaultDictionary(); // the full dictionary: tools identify Romanian archive relations, the product linking does not use it

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'config', 'dictionary');
const WORLD = path.join(ROOT, 'datasets_archive/formalizer-v1/world/predicates.sop');
const TRAIN = path.join(ROOT, 'datasets_archive/formalizer-v1/train.jsonl');
const WORDNET = path.join(ROOT, 'datasets_sources/wordnet-3.0/dict');

function argumentsOf(argv) {
  const [command, ...rest] = argv; const args = {command, _: []};
  for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) { const key = rest[i].slice(2); args[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } else args._.push(rest[i]); }
  return args;
}
const slug = text => String(text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'x';

/** World predicates: [{id, roles, en: [...], ro: [...]}] from `@id predicate` blocks. */
export function worldPredicates(text) {
  const out = [];
  let current = null;
  for (const line of String(text).split('\n')) {
    const head = /^@(\S+)\s+predicate\b/.exec(line);
    if (head) { current = {id: head[1], roles: [], en: [], ro: []}; out.push(current); continue; }
    if (/^@/.test(line)) { current = null; continue; }
    if (!current) continue;
    const role = /^\s+role\s+([a-z]+)\s/.exec(line);
    if (role) current.roles.push(role[1]);
    const label = /^\s+(?:label|alias)\s+(en|ro)\s+("(?:\\.|[^"\\])*")/.exec(line);
    if (label) current[label[1]].push(JSON.parse(label[2]));
  }
  // English only (owner decision 2026-10-01): the Romanian labels of the archived world are not frame surfaces.
  return out.filter(p => p.roles.length && p.en.length);
}

/** Propositions of a gold program: [{relation, roles: [names]}]. */
function goldPropositions(sop) {
  let program;
  try { program = parse(sop); } catch { return []; }
  const out = [];
  for (const w of program.wires) {
    if (w.type === 'stated' || w.type === 'assumed') { try { const p = propositionOf(w); out.push({relation: p.relation, roles: p.roles.map(r => r.name)}); } catch { /* malformed */ } }
    if (w.type === 'query') for (const text of [...many(w, 'where'), ...many(w, 'scope')]) parseCondition(text, leaf => { if (isMatch(leaf)) { try { const p = parseMatch(leaf, 'm', {partial: true}); if (p.relation) out.push({relation: p.relation, roles: p.roles.map(r => r.name)}); } catch { /* partial */ } } return leaf; });
  }
  return out;
}

/** WordNet verb index: lemma -> [synset offsets] (most frequent first) and offset -> member lemmas. */
function readWordNet(dir) {
  const index = new Map(), synsets = new Map();
  for (const line of fs.readFileSync(path.join(dir, 'index.verb'), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.trim().split(' ');
    const lemma = f[0], synsetCount = Number(f[2]), pointerCount = Number(f[3]);
    const tagged = Number(f[5 + pointerCount]);
    index.set(lemma, {offsets: f.slice(6 + pointerCount, 6 + pointerCount + synsetCount), tagged});
  }
  for (const line of fs.readFileSync(path.join(dir, 'data.verb'), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.split(' ');
    const count = parseInt(f[3], 16);
    synsets.set(f[0], Array.from({length: count}, (_, i) => f[4 + 2 * i].replace(/\(.*\)$/, '').replace(/_/g, ' ').toLowerCase()));
  }
  return {index, synsets};
}

const WORDNET_NOTICE = `WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
Derived data: English verb synonyms of the most frequent verb sense, reformatted as ChatSOP frames by tools/frames.mjs.
Permission to use, copy, modify and distribute this software and database and its documentation for any purpose and without fee or royalty is hereby granted, provided that you agree to comply with the following copyright notice and statements, including the disclaimer, and that the same appear on ALL copies of the software, database and documentation, including modifications that you make for internal use or for distribution.
THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to distribution of the software and/or database. Title to copyright in this software, database and any associated documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve same.`;

function buildCommand(args) {
  // 1. World frames.
  const world = worldPredicates(fs.readFileSync(WORLD, 'utf8')).map(p => ({id: 'world:' + p.id.toLowerCase(), relation: p.en[0], roles: p.roles, surfaces: p.en.slice(1), english: p.en, source: 'world', note: 'predicate ' + p.id}));
  const known = new Set(world.flatMap(f => [f.relation, ...f.surfaces].map(phraseKey)));
  // 2. Train frames: gold relations the world does not name.
  const counts = new Map();
  for (const row of readJsonlShardedSync(TRAIN)) for (const p of goldPropositions(row.sop_target ?? '')) {
    const key = phraseKey(p.relation);
    if (!key || known.has(key) || dictionary.isRomanian(p.relation)) continue; // a Romanian gold relation of the archived corpora is not an English frame
    const roles = [...new Set(p.roles.filter(r => r !== 'time'))].sort().join('|');
    if (!counts.has(key)) counts.set(key, {relation: p.relation, sets: new Map(), n: 0});
    const c = counts.get(key);
    c.n++;
    c.sets.set(roles, (c.sets.get(roles) ?? 0) + 1);
  }
  const train = [];
  for (const [key, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [best, n] = [...c.sets].sort((a, b) => b[1] - a[1])[0];
    if (c.n < 3 || n / c.n < 0.8 || !best) continue;
    const roles = best.split('|');
    if (!roles.includes('subject')) roles.unshift('subject');
    train.push({id: 'train:' + slug(key), relation: c.relation, roles: [...new Set(['subject', ...roles])], surfaces: [], source: 'train', note: `${c.n} gold propositions, ${Math.round(100 * n / c.n)}% with this role set`});
  }
  // 3. WordNet synonyms of each frame's head verb (most frequent sense only).
  const wordnet = [];
  const wnDir = args.wordnet ? path.resolve(args.wordnet) : WORDNET;
  if (fs.existsSync(path.join(wnDir, 'data.verb'))) {
    const wn = readWordNet(wnDir);
    const taken = new Set([...world, ...train].flatMap(f => [f.relation, ...f.surfaces].map(phraseKey)));
    for (const frame of [...world, ...train]) {
      const english = frame.english ?? [frame.relation];
      const surfaces = new Set();
      for (const surface of english) {
        const [verb, ...rest] = surface.split(' ');
        if (verb === 'be' || !wn.index.has(verb)) continue;
        const first = wn.index.get(verb).offsets[0];
        for (const syn of wn.synsets.get(first) ?? []) {
          if (syn === verb) continue;
          const candidate = [syn, ...rest].join(' ');
          if (!taken.has(phraseKey(candidate))) surfaces.add(candidate);
        }
      }
      if (surfaces.size) wordnet.push({id: 'wordnet:' + frame.id.replace(/^\w+:/, ''), relation: frame.relation, roles: frame.roles, surfaces: [...surfaces].sort(), source: 'wordnet', note: 'synonyms of the head verb (first WordNet 3.0 sense)'});
    }
  } else console.error('WordNet cache not found under ' + wnDir + '; frames-wordnet.tsv not written');
  const write = (file, frames, comment) => fs.writeFileSync(path.join(DIR, file), formatFrames(frames, comment));
  write('frames-world.tsv', world, 'ChatSOP host frames: the relation frames of the formalizer-v1 verification world (datasets_archive/formalizer-v1/world/predicates.sop).\nGenerated by `node tools/frames.mjs build`; do not edit by hand. Licence: MIT (repository LICENSE); original ChatSOP authored text.');
  write('frames-train.tsv', train, 'ChatSOP host frames: gold relations of the formalizer-v1 train split that the world does not name, with their majority role set.\nGenerated by `node tools/frames.mjs build`; do not edit by hand. Licence: MIT (repository LICENSE); ChatSOP synthetic corpus.');
  if (wordnet.length) write('frames-wordnet.tsv', wordnet, 'ChatSOP host frames: English verb synonyms from Princeton WordNet 3.0.\n' + WORDNET_NOTICE);
  console.log(JSON.stringify({world: world.length, train: train.length, wordnet: wordnet.length, wordnet_surfaces: wordnet.reduce((a, f) => a + f.surfaces.length, 0)}));
}

function lookupCommand(args) {
  const frames = loadFrames();
  const hit = frames.lookup(args._.join(' '));
  console.log(JSON.stringify(hit, null, 1));
}

function normalizeCommand(args) {
  const out = normalizeProgram(fs.readFileSync(path.resolve(args.file), 'utf8'), loadFrames());
  console.log(out.sop);
  console.error(JSON.stringify(out.changes));
}

const args = argumentsOf(process.argv.slice(2));
const commands = {build: buildCommand, lookup: lookupCommand, normalize: normalizeCommand};
if (commands[args.command]) commands[args.command](args);
else console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n'));
void Frames;
