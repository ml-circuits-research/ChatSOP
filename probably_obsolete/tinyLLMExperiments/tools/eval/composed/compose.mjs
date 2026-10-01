/** Deterministic composition of component sentences into paragraph cases (DS008 "Composed evaluation suites").
 *
 * Kinds: K1 all symbolic (n known-good sentences of different forms), K2 mixed (symbolic and neuro sentences; neuro ones need
 * their verified rewrite), K3 identity long (long single sentences and long all-symbolic paragraphs; the proofing model must not touch
 * them), K4 bad mixed (clean sentences among noisy, Romanian or mixed ones that have a clean target), K5 reference across sentences (a later
 * sentence refers to the subject of an earlier one by pronoun; the expected SOP has the name). Every case stores its components
 * (source ids, role, expected text, expected SOP) so a failure is attributable. Pure given the pools and the seed.
 */
import {createHash} from 'node:crypto';
import {canonicalBlocks, concatCanonical} from './sop-canon.mjs';
import {nameEntities, PERSON} from './components.mjs';
import {splitSentences} from '../../../lib/sentence-split.mjs';
import {classifyRow} from '../../datasets/three-datasets/decomposition.mjs';

export const COMPOSER_VERSION = 'composed-v1';

/** Seeded generator (mulberry32 over the sha1 of the seed text). */
export function rngOf(seed) {
  let a = parseInt(createHash('sha1').update(String(seed)).digest('hex').slice(0, 8), 16) >>> 0;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.int = n => Math.floor(next() * n);
  next.shuffle = array => { const a2 = array.slice(); for (let i = a2.length - 1; i > 0; i--) { const j = next.int(i + 1); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2; };
  return next;
}

/** Picks components balancing use: the least used first, random among ties, subject to a filter over what is already chosen. */
export class Picker {
  constructor(components, rng) { this.list = components; this.rng = rng; this.uses = new Map(components.map(c => [c.source_id, 0])); }
  pick(accept = () => true) {
    const order = this.rng.shuffle(this.list).sort((a, b) => this.uses.get(a.source_id) - this.uses.get(b.source_id));
    for (const c of order) if (accept(c)) { this.uses.set(c.source_id, this.uses.get(c.source_id) + 1); return c; }
    return null;
  }
}

const JOINER = ' ';
const publicComponent = (c, index, extra = {}) => {
  const {analysis, ...rest} = c;
  return {index, ...rest, ...extra};
};
export const joinTexts = (components, key) => components.map(c => c[key]).join(JOINER);

/** Token count independent of any tokenizer: sentence count of the joined expected text (host segmenter). */
const sentencesOf = text => splitSentences(text).length;

/** Row skeleton shared by every composed case. */
export function caseRow({kind, dataset, id, components, seed, split = 'test-composed', extra = {}}) {
  const message = joinTexts(components, 'text'), expected = joinTexts(components, 'expected_text');
  const programs = components.filter(c => c.expected_sop).map(c => c.expected_sop);
  const complete = components.every(c => c.expected_sop);
  return {
    id, dataset, split, split_group_id: id, kind, message, expected_text: expected,
    n_components: components.length, n_sentences: sentencesOf(expected), n_changes_expected: components.filter(c => c.expected_text !== c.text).length,
    joiner: JOINER,
    components: components.map((c, i) => publicComponent(c, i)),
    expected_sop: complete ? concatCanonical(programs).join('\n\n') + '\n' : null,
    expected_sop_complete: complete,
    composer: {version: COMPOSER_VERSION, seed},
    source: {corpus: 'composed', suite: 'composed', split, kind},
    rights: {license: 'MIT (repository LICENSE); original ChatSOP authored text', rights_decision: 'owner-released-inspired-by', text_copied: false, inherited_from: 'sealed test rows of the three datasets', spec: 'docs/specs/DS014-source-rights.md'},
    quality_flags: {synthetic: true, human_reviewed: false, training_approved: false, llm_authored: false, composed: true},
    review_status: 'not_reviewed',
    ...extra,
  };
}

const distinctForms = (chosen, c) => !c.form || !chosen.some(o => o.form === c.form);
const distinctSources = (chosen, c) => !chosen.some(o => o.source_id === c.source_id);

/** K1: `perCount` cases for each sentence count, sentences of different forms. */
export function composeK1(symbolic, {counts = [2, 3, 5, 8], perCount = 100, seed = 'k1'} = {}) {
  const out = [];
  for (const n of counts) {
    const rng = rngOf(`${seed}:${n}`), picker = new Picker(symbolic, rng);
    for (let i = 0; i < perCount; i++) {
      const chosen = [];
      while (chosen.length < n) { const c = picker.pick(x => distinctSources(chosen, x) && distinctForms(chosen, x)); if (!c) break; chosen.push(c); }
      if (chosen.length < n) continue;
      out.push(caseRow({kind: 'K1', dataset: 'symbolic_english', id: `composed-k1-n${String(n).padStart(2, '0')}-${String(i + 1).padStart(4, '0')}`, components: chosen, seed: `${seed}:${n}:${i}`, extra: {stratum: `n${n}`}}));
    }
  }
  return out;
}

/** K3: the longest natural single sentences, then paragraphs of many symbolic sentences (forms distinct while the pool lasts, then repeated). */
export function composeK3(symbolic, {counts = [[12, 60], [16, 60], [24, 60], [32, 40], [48, 30]], singles = 40, seed = 'k3'} = {}) {
  const out = [];
  const wordsOf = c => c.text.split(/\s+/).length;
  const longest = symbolic.slice().sort((a, b) => wordsOf(b) - wordsOf(a) || a.source_id.localeCompare(b.source_id)).filter(c => wordsOf(c) >= 18).slice(0, singles);
  longest.forEach((c, i) => out.push(caseRow({kind: 'K3', dataset: 'symbolic_english', id: `composed-k3-single-${String(i + 1).padStart(4, '0')}`, components: [c], seed: `${seed}:single:${i}`, extra: {stratum: 'single'}})));
  for (const [n, perCount] of counts) {
    const rng = rngOf(`${seed}:${n}`), picker = new Picker(symbolic, rng);
    for (let i = 0; i < perCount; i++) {
      const chosen = [];
      while (chosen.length < n) { const c = picker.pick(x => distinctSources(chosen, x) && distinctForms(chosen, x)) ?? picker.pick(x => distinctSources(chosen, x)); if (!c) break; chosen.push(c); }
      if (chosen.length < n) continue;
      out.push(caseRow({kind: 'K3', dataset: 'symbolic_english', id: `composed-k3-n${String(n).padStart(2, '0')}-${String(i + 1).padStart(4, '0')}`, components: chosen, seed: `${seed}:${n}:${i}`, extra: {stratum: `n${n}`}}));
    }
  }
  return out;
}

/** (total sentences, number of changed sentences) of the mixed kinds (K2, K4). */
export const MIX_SPECS = Object.freeze([[2, 1], [3, 1], [4, 1], [4, 2], [5, 1], [6, 2], [6, 3], [8, 2], [8, 4]]);

/** Positions of `m` changed items among `n`: a first, middle or last single position, else random distinct positions. */
function positionsOf(n, m, rng, slot) {
  if (m === 1) return [[0], [Math.floor((n - 1) / 2)], [n - 1]][slot % 3];
  return rng.shuffle([...Array(n).keys()]).slice(0, m).sort((a, b) => a - b);
}

/** K2 (`changed` = neuro pool) and K4 (`changed` = bad pool): clean symbolic sentences around sentences that need a rewrite. */
export function composeMixed({kind, dataset, symbolic, changed, specs = MIX_SPECS, perSpec = 34, seed}) {
  const out = [];
  specs.forEach(([n, m]) => {
    const rng = rngOf(`${seed}:${n}:${m}`), cleanPicker = new Picker(symbolic, rng), changedPicker = new Picker(changed, rng);
    for (let i = 0; i < perSpec; i++) {
      const at = positionsOf(n, m, rng, i);
      const chosenChanged = [];
      for (let k = 0; k < m; k++) { const c = changedPicker.pick(x => distinctSources(chosenChanged, x)); if (!c) return; chosenChanged.push(c); }
      const cleanChosen = [];
      for (let k = 0; k < n - m; k++) { const c = cleanPicker.pick(x => distinctSources(cleanChosen, x) && distinctForms(cleanChosen, x)); if (!c) return; cleanChosen.push(c); }
      const components = [];
      let ci = 0, gi = 0;
      for (let p = 0; p < n; p++) components.push(at.includes(p) ? chosenChanged[gi++] : cleanChosen[ci++]);
      const label = at.length === 1 ? ['first', 'middle', 'last'][at[0] === 0 ? 0 : at[0] === n - 1 ? 2 : 1] : 'spread';
      out.push(caseRow({kind, dataset, id: `composed-${kind.toLowerCase()}-n${String(n).padStart(2, '0')}m${m}-${String(i + 1).padStart(4, '0')}`, components, seed: `${seed}:${n}:${m}:${i}`, extra: {stratum: `n${n}m${m}`, changed_positions: at, position_label: label, mix: `${m} of ${n}`}}));
    }
  });
  return out;
}

const PRONOUN = {f: 'she', m: 'he'};
const quoted = s => JSON.stringify(s);

/** The person subject of a symbolic component, when it is the only person name of the sentence: `{name, gender}` or null. */
export function soleSubject(c) {
  const s = c.analysis?.sentences?.[0];
  if (!s) return null;
  const people = nameEntities(s).filter(e => e.person);
  if (people.length !== 1 || people[0].deprel !== 'nsubj' || !PERSON.get(people[0].first) || PERSON.get(people[0].first) === 'x') return null;
  if (c.text.split(people[0].text).length !== 2) return null;
  return {name: people[0].text, gender: PERSON.get(people[0].first)};
}

/** The sentence `c` with its own subject name replaced by `name` (text and SOP), or null when that cannot be done mechanically. */
export function withSubject(c, name, pronoun = null) {
  const s = c.analysis?.sentences?.[0];
  if (!s) return null;
  const people = nameEntities(s).filter(e => e.person && e.deprel === 'nsubj');
  if (people.length !== 1) return null;
  const own = people[0].text;
  if (c.text.split(own).length !== 2 || /^['’]s\b/.test(c.text.slice(c.text.indexOf(own) + own.length))) return null;
  const quotedOwn = quoted(own);
  if (!c.expected_sop.includes(`role subject ${quotedOwn}`)) return null;
  const others = [...c.expected_sop.matchAll(/"(?:\\.|[^"\\])*"/g)].map(m => m[0]).filter(v => v !== quotedOwn);
  if (others.some(v => v.includes(own))) return null;
  const at = c.text.indexOf(own);
  const replacement = pronoun ? (at === 0 ? pronoun[0].toUpperCase() + pronoun.slice(1) : pronoun) : name;
  return {text: c.text.replace(own, replacement), sop: c.expected_sop.split(quotedOwn).join(quoted(name)), own_name: own};
}

/** K5: a sentence about one person, optional unrelated sentences, then a sentence that refers to the person by pronoun. */
export function composeK5(symbolic, {counts = [2, 3, 4], perCount = 34, seed = 'k5'} = {}) {
  const out = [];
  const anchors = symbolic.map(c => ({c, subject: soleSubject(c)})).filter(x => x.subject);
  const carriers = symbolic.filter(c => c.analysis?.sentences?.[0] && nameEntities(c.analysis.sentences[0]).some(e => e.person && e.deprel === 'nsubj'));
  const bystanders = symbolic.filter(c => c.analysis?.sentences?.[0] && !nameEntities(c.analysis.sentences[0]).some(e => e.person));
  for (const n of counts) {
    const rng = rngOf(`${seed}:${n}`), a = new Picker(anchors.map(x => ({...x.c, _s: x.subject})), rng), b = new Picker(carriers, rng), d = new Picker(bystanders, rng);
    for (let i = 0; i < perCount; i++) {
      let built = null;
      for (let attempt = 0; attempt < 40 && !built; attempt++) {
        const anchor = a.pick(); if (!anchor) break;
        const carrier = b.pick(x => x.source_id !== anchor.source_id && x.expected_text !== anchor.text && withSubject(x, anchor._s.name, PRONOUN[anchor._s.gender]));
        if (!carrier) continue;
        const named = withSubject(carrier, anchor._s.name), pron = withSubject(carrier, anchor._s.name, PRONOUN[anchor._s.gender]);
        if (named.own_name === anchor._s.name) continue;
        const between = [];
        while (between.length < n - 2) { const x = d.pick(y => distinctSources(between, y) && y.source_id !== anchor.source_id && y.source_id !== carrier.source_id); if (!x) break; between.push(x); }
        if (between.length < n - 2) continue;
        const {_s, ...anchorComponent} = anchor;
        const reference = {
          ...carrier, role: 'symbolic_reference', text: pron.text, expected_text: pron.text, expected_sop: named.sop, expected_sop_source: 'gold_with_substituted_subject', named_text: named.text, source_id: `${carrier.source_id}#ref`, form: null,
          antecedent: {source_id: anchor.source_id, name: anchor._s.name, gender: anchor._s.gender, pronoun: PRONOUN[anchor._s.gender], distance: n - 1},
        };
        built = [anchorComponent, ...between, reference];
      }
      if (!built) continue;
      out.push(caseRow({kind: 'K5', dataset: 'symbolic_english', id: `composed-k5-n${String(n).padStart(2, '0')}-${String(i + 1).padStart(4, '0')}`, components: built, seed: `${seed}:${n}:${i}`, extra: {stratum: `n${n}`, reference: built[built.length - 1].antecedent}}));
    }
  }
  return out;
}

/**
 * K6 decomposition: test rows whose verified target splits the message into several sentences (a message with more than one finite
 * clause or several questions). One component per case: no composition, the case is the row itself. `rows` are dataset rows of one
 * dataset; each is kept only with a verified target (`targets[0].check`) that has more sentences than the message.
 */
export function composeK6(rows, {dataset, seed = 'k6'}) {
  const role = dataset === 'neuro_english' ? 'neuro' : 'bad';
  const out = [];
  for (const row of rows.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const k = classifyRow(row);
    if (!k.decomposition || !row.targets?.[0]?.check || /\n/.test(row.message)) continue;
    const component = {role, source_id: row.id, source_dataset: row.dataset, source_split: row.split, text: row.message, expected_text: row.target, expected_sop: row.gold_sop ?? null, expected_sop_source: row.gold_sop ? 'gold' : null, must_change: true,
      target_source: row.target_source, form: null, sentences: k.message_sentences, target_sentences: k.target_sentences, punctuated: /[.?!]$/.test(row.message.trim()), family: row.source?.family ?? null};
    out.push(caseRow({kind: 'K6', dataset, id: `composed-k6-${String(out.length + 1).padStart(4, '0')}`, components: [component], seed, extra: {stratum: k.type ?? 'other', decomposition: {type: k.type, types: k.types, unpunctuated: k.unpunctuated, message_clauses: k.shape.clauses, message_questions: k.shape.questions, message_sentences: k.message_sentences, target_sentences: k.target_sentences}}}));
  }
  return out;
}
