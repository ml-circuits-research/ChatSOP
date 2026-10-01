// Rules v2.7 and v2.8 (v2.8: coordinated question clauses are separate queries; only an explicit "both" is one conjunction) (lib/ud-to-sop/reasoning-forms.mjs and the query-form rules of analyze.mjs): question forms the corpora do
// not contain (why_not, plan, abduce, procedure, conform), a grouped universal, a conjunction, comparisons on a measured
// attribute, `overlaps`, clock time, the reason clause, chained relational nouns, presupposition and existential "any".
// SymbolicLM runs on recorded Stanza parses (tests/fixtures/query-forms/parses.json, recorded by
// `node tools/eval/query-surface/probe-run.mjs`), so no Python is needed. Every expected program is also checked by the
// model-surface admission (`valid`), the boundary every model output obeys.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SymbolicLM} from '../lib/symbolic-lm/index.mjs';
import {PROBES} from '../tools/eval/query-surface/probes.mjs';
import {messageForms} from '../tools/eval/query-surface/forms.mjs';
import {repoPath} from './helpers.mjs';

const FIXTURE = repoPath('tests/fixtures/query-forms/parses.json');
const parses = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).parses : null;
const worker = parses && {start: async () => ({ready: true}), stop: async () => {}, request: async ({text, language}) => {
  const parse = parses[`${language ?? 'auto'}|${text}`];
  if (!parse) throw Error(`no recorded parse for ${text}`);
  return {parse, ms: 0};
}};
const lm = parses && new SymbolicLM({worker, lexicons: {has: () => false, perMillion: () => 0}});
const compact = sop => sop.trim().split('\n').map(line => line.trim()).filter(Boolean).join(' | ');
const run = message => lm.analyze(message, {route: 'direct', language: 'en'});
const skip = !parses && 'no fixture';

const EXPECTED = [
  ["Why can't I hard-reset the router?","@q query | mode why_not | where match | relation \"hard-reset\" | role subject \"the user\" | role object \"the router\" | polarity affirmed | end"],
  ["What is stopping Ana from joining the project?","@q query | mode why_not | where match | relation \"join\" | role subject \"Ana\" | role object \"the project\" | polarity affirmed | end"],
  ["What is missing for the invoice to be approved?","@q query | mode why_not | where match | relation \"be approved\" | role subject \"the invoice\" | polarity affirmed | end"],
  ["How do I reset the router?","@q query | mode plan | where match | relation \"reset\" | role subject \"the user\" | role object \"the router\" | polarity affirmed | end"],
  ["How can the robot get to C?","@q query | mode plan | where match | relation \"get to\" | role subject \"the robot\" | role destination \"C\" | polarity affirmed | end"],
  ["What are the steps to reset the router?","@q query | mode plan | where match | relation \"reset\" | role object \"the router\" | polarity affirmed | end"],
  ["What do I need to do to get a refund?","@q query | mode plan | where match | relation \"get\" | role subject \"the user\" | role object \"a refund\" | polarity affirmed | end"],
  ["What could explain the outage?","@q query | mode abduce | where match | relation \"occur\" | role subject \"the outage\" | polarity affirmed | end"],
  ["What might have caused the grass to be wet?","@q query | mode abduce | where match | relation \"be wet\" | role subject \"the grass\" | polarity affirmed | end"],
  ["What is the procedure for resetting the router?","@q query | mode procedure | where match | relation \"reset\" | role object \"the router\" | polarity affirmed | end"],
  ["What is the reset procedure?","@q query | mode procedure | where match | relation \"reset\" | role object ?x | polarity affirmed | end"],
  ["Did we follow the reset procedure?","@q query | mode conform | where match | relation \"follow\" | role subject \"we\" | role object \"the reset procedure\" | polarity affirmed | end"],
  ["Was the reset compliant?","@q query | mode conform | where match | relation \"be compliant\" | role subject \"the reset\" | polarity affirmed | end"],
  ["Which teams have only certified players?","@q query | mode every | select ?g | where match | relation \"be a player of\" | role subject ?m | role object ?g | polarity affirmed | end | scope match | relation \"be certified\" | role subject ?m | polarity affirmed | end"],
  ["Both at once: does Liam grow lavender, and is he the chef at the Bistrița Arena?","@q query | where all | match | relation \"grow\" | role subject \"Liam\" | role object \"lavender\" | polarity affirmed | end | match | relation \"be the chef at\" | role object \"the Bistrița Arena\" | role subject \"Liam\" | polarity affirmed | end | end"],
  ["Does Tamás go to the wedding reception and does he intend to attend the jazz evening?","@q query | where match | relation \"go to\" | role subject \"Tamás\" | role object \"the wedding reception\" | polarity affirmed | end | @q2 query | where match | relation \"intend to attend\" | role subject \"Tamás\" | role object \"the jazz evening\" | polarity affirmed | end"],
  ["Did the caterer confirm lunch, and does Kofi have the room key?","@q query | where match | relation \"confirm\" | role subject \"the caterer\" | role object \"lunch\" | polarity affirmed | end | @q2 query | where match | relation \"have\" | role subject \"Kofi\" | role object \"the room key\" | polarity affirmed | end"],
  ["Does the cottage cost more than 30000 lei?","@q query | mode exists | where match | relation \"cost\" | role subject \"the cottage\" | role object ?price | polarity affirmed | end | compare ?price above 30000"],
  ["Does the studio cost at least 8000 lei?","@q query | mode exists | where match | relation \"cost\" | role subject \"the studio\" | role object ?price | polarity affirmed | end | compare ?price at_least 8000"],
  ["Did Ana work at Alpha Lab at any point in 2025?","@q query | where match | relation \"work at\" | role subject \"Ana\" | role object \"Alpha Lab\" | polarity affirmed | end | overlaps \"2025\""],
  ["What time does the Sighișoara Arena open?","@q query | select ?hour | where match | relation \"open at\" | role subject \"the Sighișoara Arena\" | role time ?hour | polarity affirmed | end"],
  ["What is the reason that Rafael does not qualify for the bonus?","@q query | mode explain | where match | relation \"qualify for\" | role subject \"Rafael\" | role object \"the bonus\" | polarity negated | end"],
  ["Who is a parent of a parent of Ana?","@q query | select ?x | where all | match | relation \"be a parent of\" | role object ?m | role subject ?x | polarity affirmed | end | match | relation \"be a parent of\" | role subject ?m | role object \"Ana\" | polarity affirmed | end | end"],
  ["Is Javier García still playing for Olimpia Sighișoara?","@a1 assumed | relation \"play for\" | role subject \"Javier García\" | role object \"Olimpia Sighișoara\" | polarity affirmed | basis implicature | @q query | where match | relation \"play for\" | role subject \"Javier García\" | role object \"Olimpia Sighișoara\" | polarity affirmed | end"],
  ["Does any employee of Alpha Lab speak German?","@q query | mode exists | where all | match | relation \"be an employee of\" | role subject ?x | role object \"Alpha Lab\" | polarity affirmed | end | match | relation \"speak\" | role subject ?x | role object \"German\" | polarity affirmed | end | end"],
  ["What if Ana leaves the lab, who runs it?","@s1 stated | relation \"leave\" | role subject \"Ana\" | role object \"the lab\" | polarity affirmed | certainty supposed | @q query | select ?x | where match | relation \"run\" | role subject ?x | role object \"it\" | polarity affirmed | end | if $s1"],
  ["Why isn't Mei Zhao absent from work? Can you explain that?","@q query | mode explain | where match | relation \"be absent from work\" | role subject \"Mei Zhao\" | polarity negated | end"],
  ["Can you explain why Chioma Eze stays home?","@q query | mode explain | where match | relation \"stay home\" | role subject \"Chioma Eze\" | polarity affirmed | end"],
  ["Did Liviu go to the jazz evening again?","@a1 assumed | relation \"go to\" | role subject \"Liviu\" | role object \"the jazz evening\" | polarity affirmed | basis implicature | @q query | where match | relation \"go to\" | role subject \"Liviu\" | role object \"the jazz evening\" | polarity affirmed | end"],
  ["How does Ana commute?","@q query | select ?how | where match | relation \"commute\" | role subject \"Ana\" | role instrument ?how | polarity affirmed | end"],
  ["Why is Emil not eligible for the bonus?","@q query | mode explain | where match | relation \"be eligible for\" | role subject \"Emil\" | role object \"the bonus\" | polarity negated | end"],
  ["What caused the outage?","@q query | select ?x | where match | relation \"cause\" | role subject ?x | role object \"the outage\" | polarity affirmed | end"],
  ["Who is Ada Lovelace?","@q query | select ?x | where match | relation \"be\" | role object ?x | role subject \"Ada Lovelace\" | polarity affirmed | end"],
  ["What is Python?","@q query | select ?x | where match | relation \"be\" | role object ?x | role subject \"Python\" | polarity affirmed | end"],
  ["Ana is a doctor.","@s1 stated | relation \"be a\" | role object \"doctor\" | role subject \"Ana\" | polarity affirmed | certainty asserted"],
  ["Is Paris a city?","@q query | where match | relation \"be a\" | role object \"city\" | role subject \"Paris\" | polarity affirmed | end"],
  ["Who is the CEO of Acme?","@q query | select ?x | where match | relation \"be the CEO of\" | role object \"Acme\" | role subject ?x | polarity affirmed | end"],
  ["Paris is the capital of France.","@s1 stated | relation \"be the capital of\" | role object \"France\" | role subject \"Paris\" | polarity affirmed | certainty asserted"],
  ["Ana is sick.","@s1 stated | relation \"be sick\" | role subject \"Ana\" | polarity affirmed | certainty asserted"],
  ["Is Ana sick?","@q query | where match | relation \"be sick\" | role subject \"Ana\" | polarity affirmed | end"],
  ["Ana is in Cluj.","@s1 stated | relation \"be in\" | role location \"Cluj\" | role subject \"Ana\" | polarity affirmed | certainty asserted"],
  ["Where is Ana?","@q query | select ?place | where match | relation \"be\" | role subject \"Ana\" | role location ?place | polarity affirmed | end"],
];

test('each v2.7 form writes its program', {skip}, async () => {
  for (const [message, expected] of EXPECTED) {
    const result = await run(message);
    assert.equal(result.valid, true, `admitted: ${message}`);
    assert.equal(compact(result.sop), expected, message);
  }
});

test('every authored probe gets the query mode of its form', {skip}, async () => {
  for (const probe of PROBES.filter(p => p.mode)) {
    const result = await run(probe.message);
    const mode = /\n\s*mode (\w+)/.exec(result.sop)?.[1] ?? null;
    assert.equal(mode, probe.mode, `${probe.form}: ${probe.message}`);
    assert.equal(result.valid, true, probe.message);
  }
});

test('the surface form classifier names the forms of the probes', () => {
  const form = message => messageForms(message).forms;
  assert.ok(form("Why can't I hard-reset the router?").includes('why_not'));
  assert.ok(form('How do I reset the router?').includes('plan'));
  assert.ok(form('What is the procedure for resetting the router?').includes('procedure'));
  assert.ok(form('Did we follow the reset procedure?').includes('conform'));
  assert.ok(form('How many players are older than 40?').includes('count'));
  assert.ok(form('Who works at Alpha Lab? Where does Ana live?').includes('multi'));
  assert.ok(form('Do you know when the audit ended?').includes('embedded'));
});

test('a plain how or why question keeps its older form', {skip}, async () => {
  for (const [message, mode, instrument] of [['How does Ana commute?', null, true], ['Why is Emil not eligible for the bonus?', 'explain', false], ['What caused the outage?', null, false]]) {
    const sop = (await run(message)).sop;
    assert.equal(/\n\s*mode (\w+)/.exec(sop)?.[1] ?? null, mode, message);
    assert.equal(/role instrument \?how/.test(sop), instrument, message);
  }
});
