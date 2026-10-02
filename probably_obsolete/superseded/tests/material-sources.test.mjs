import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildDemo} from '../skills/material-to-sop/fixtures/build-demo.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(project, 'skills/material-to-sop/scripts/material.mjs');
const run = (cwd, ...args) => spawnSync(process.execPath, [script, ...args], {cwd, encoding: 'utf8'});
const put = (name, value) => fs.writeFileSync(name, JSON.stringify(value));

// A fresh workspace and real source files, deliberately invoked outside the checkout.
test('five local formats retain exact passage locators; missing rights and missing quotes fail closed', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'material-sources-test-'));
  t.after(() => fs.rmSync(tmp, {recursive: true, force: true}));
  const workspace = path.join(tmp, 'workspace');
  const names = ['txt', 'md', 'docx', 'pdf', 'html'];
  const passages = names.map((name, index) => `Inspection ${index + 1}: ${name} verified.`);
  fs.writeFileSync(path.join(tmp, 'txt.txt'), `Préface.\n\n${passages[0]}\n`);
  fs.writeFileSync(path.join(tmp, 'md.md'), `# Record\n\n${passages[1]}\n`);
  fs.writeFileSync(path.join(tmp, 'html.html'), `<html><script>DO NOT INCLUDE</script><p>${passages[4]}</p></html>`);
  const generated = spawnSync('python3', ['-c', `import sys, zipfile
folder = sys.argv[1]
with zipfile.ZipFile(folder + '/docx.docx', 'w') as z:
 z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Inspection 3: </w:t></w:r><w:r><w:t>docx verified.</w:t></w:r></w:p></w:body></w:document>')
texts = [b'Preface page.', b'${passages[3]}']
streams = [b'BT /F1 12 Tf 40 700 Td (' + text + b') Tj ET' for text in texts]
objects = [
 b'<< /Type /Catalog /Pages 2 0 R >>',
 b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
 b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
 b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
 b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
] + [b'<< /Length ' + str(len(s)).encode() + b' >>\\nstream\\n' + s + b'\\nendstream' for s in streams]
pdf = b'%PDF-1.4\\n'
offsets = [0]
for i, obj in enumerate(objects, 1):
 offsets.append(len(pdf))
 pdf += str(i).encode() + b' 0 obj\\n' + obj + b'\\nendobj\\n'
xref = len(pdf)
pdf += b'xref\\n0 8\\n0000000000 65535 f \\n'
for offset in offsets[1:]:
 pdf += f'{offset:010d} 00000 n \\n'.encode()
pdf += b'trailer\\n<< /Size 8 /Root 1 0 R >>\\nstartxref\\n' + str(xref).encode() + b'\\n%%EOF\\n'
open(folder + '/pdf.pdf', 'wb').write(pdf)
`, tmp], {encoding: 'utf8'});
  assert.equal(generated.status, 0, generated.stderr);
  const sources = names.map((name, i) => ({id: name, file: path.join(tmp, `${name}.${name}`), revision: 'r1', rights: {status: 'authorized', basis: 'Synthetic fixture authored for this test'}, scope: 'test-only', budget: {maxBytes: 100000, maxPassages: 10}}));
  const manifest = path.join(tmp, 'manifest.json');
  put(manifest, {sources});
  const prepared = run(tmp, 'prepare-sources', '--workspace', workspace, '--manifest', manifest);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(JSON.parse(prepared.stdout).sources.length, 5);
  const facts = sources.map((source, i) => {
    const record = JSON.parse(fs.readFileSync(path.join(workspace, 'datasets/knowledge/source', `${source.id}.json`), 'utf8'));
    const passage = record.passages.find(p => p.text.includes(passages[i]));
    assert.ok(passage, `${source.id} missing original passage`);
    if (source.id === 'txt') assert.equal(passage.offset, Buffer.byteLength('Préface.\n\n'));
    if (source.id === 'pdf') assert.equal(passage.page, 2);
    if (source.id === 'html') assert.equal(record.passages.some(p => p.text.includes('DO NOT INCLUDE')), false);
    t.diagnostic(`${source.id}: ${record.format} page=${passage.page} paragraph=${passage.paragraph} offset=${passage.offset} quote located`);
    const quote = passages[i];
    return {sourceId: source.id, sourceSha256: record.rawSha256, passage: {page: passage.page, paragraph: passage.paragraph, offset: passage.offset}, quoteOffset: passage.offset + Buffer.byteLength(passage.text.slice(0, passage.text.indexOf(quote))), quote, sop: `@record_${source.id} fact\n  holds inspected ${source.id}\n  valid timeless\n  source ${source.id}\n  quote ${JSON.stringify(quote)}`};
  });
  const claims = path.join(tmp, 'claims.json');
  put(claims, {facts});
  const reviewed = run(tmp, 'review-sources', '--workspace', workspace, '--input', claims, '--project-root', project);
  assert.equal(reviewed.status, 0, reviewed.stderr);
  assert.equal(JSON.parse(reviewed.stdout).status, 'agent-draft-unapproved');
  t.diagnostic(`review-sources: ${JSON.parse(reviewed.stdout).facts} draft facts quarantined`);
  assert.equal(fs.existsSync(path.join(workspace, 'datasets/knowledge/implicit/facts.json')), true);
  assert.equal(fs.readdirSync(path.join(workspace, 'temporary')).length, 0);
  const altered = path.join(tmp, 'altered.json');
  put(altered, {facts: [{...facts[2], quote: 'Imaginary sentence.'}]});
  const rejected = run(tmp, 'review-sources', '--workspace', workspace, '--input', altered, '--project-root', project);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /byte-exact passage span/);
  t.diagnostic(`missing quote rejected: ${rejected.stderr.trim()}`);
  put(altered, {facts: [{...facts[0], quoteOffset: facts[0].quoteOffset + 1}]});
  const shifted = run(tmp, 'review-sources', '--workspace', workspace, '--input', altered, '--project-root', project);
  assert.notEqual(shifted.status, 0);
  assert.match(shifted.stderr, /byte-exact passage span/);
  const noRights = path.join(tmp, 'no-rights.json');
  put(noRights, {sources: [{...sources[0], id: 'unauthorized', rights: {status: 'unresolved', basis: 'Unknown grant'}}]});
  const forbidden = run(tmp, 'prepare-sources', '--workspace', path.join(tmp, 'rejected'), '--manifest', noRights);
  assert.notEqual(forbidden.status, 0);
  assert.match(forbidden.stderr, /missing explicit authorized rights/);
  t.diagnostic(`missing rights rejected: ${forbidden.stderr.trim()}`);
  fs.writeFileSync(path.join(tmp, 'unknown.rtf'), '{\\rtf1 Unsupported}');
  const unsupportedManifest = path.join(tmp, 'unsupported.json');
  put(unsupportedManifest, {sources: [{...sources[0], id: 'unknown', file: path.join(tmp, 'unknown.rtf')}]});
  const unsupported = run(tmp, 'prepare-sources', '--workspace', path.join(tmp, 'unsupported'), '--manifest', unsupportedManifest);
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported format \.rtf: no verified local adapter/);
  t.diagnostic(`RTF unsupported: ${unsupported.stderr.trim()}`);
  const overBudget = path.join(tmp, 'budget.json');
  put(overBudget, {sources: [{...sources[0], id: 'limited', budget: {maxBytes: 2, maxPassages: 1}}]});
  const budgetRejected = run(tmp, 'prepare-sources', '--workspace', path.join(tmp, 'budget'), '--manifest', overBudget);
  assert.notEqual(budgetRejected.status, 0);
  assert.match(budgetRejected.stderr, /exceeds byte budget/);
});

test('bounded modes and cross-source candidate expose measured gaps without approving knowledge', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'material-transfer-test-'));
  t.after(() => fs.rmSync(tmp, {recursive: true, force: true}));
  const workspace = path.join(tmp, 'new-workspace');
  const manifest = path.join(project, 'skills/material-to-sop/fixtures/three-sources.json');
  const prepared = run(tmp, 'prepare-sources', '--workspace', workspace, '--manifest', manifest);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual(JSON.parse(prepared.stdout).sources.map(source => source.format), ['.txt', '.md', '.html']);
  const out = path.join(tmp, 'inputs');
  const demo = buildDemo(workspace, out);
  for (const name of demo.modes) {
    const result = run(tmp, 'explore-sources', '--workspace', workspace, '--input', path.join(out, `${name}.json`));
    assert.equal(result.status, 0, result.stderr);
    const observation = JSON.parse(result.stdout);
    assert.ok(observation.used.probes <= observation.budget.maxProbes);
    assert.ok(observation.used.bytes <= observation.budget.maxBytes);
    assert.equal(observation.status, name === 'incomplete' ? 'incomplete' : 'completed');
    if (name === 'incomplete') assert.equal(observation.stopCondition, 'probe_budget');
    if (name === 'focused') assert.deepEqual(observation.matches.map(match => match.sourceId), ['cold_chain']);
    if (name === 'adaptive') assert.deepEqual(observation.matches.map(match => match.sourceId), ['receiving_desk']);
    if (name === 'exhaustive') assert.equal(observation.stopCondition, 'all_passages_scanned');
    t.diagnostic(`${name}: ${observation.status} (${observation.stopCondition}), probes=${observation.used.probes}, bytes=${observation.used.bytes}, matches=${observation.matchedQuestions}`);
  }
  const byteInput = JSON.parse(fs.readFileSync(path.join(out, 'focused.json'), 'utf8'));
  const bytesLimited = path.join(tmp, 'byte-limited.json');
  put(bytesLimited, {...byteInput, budget: {...byteInput.budget, maxBytes: 1}});
  const byteRun = run(tmp, 'explore-sources', '--workspace', workspace, '--input', bytesLimited);
  assert.equal(byteRun.status, 0, byteRun.stderr);
  assert.equal(JSON.parse(byteRun.stdout).status, 'incomplete');
  assert.equal(JSON.parse(byteRun.stdout).stopCondition, 'byte_budget');
  const rejected = run(tmp, 'propose-sources', '--workspace', workspace, '--input', demo.rejected, '--project-root', project);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /transfer cases required/);
  t.diagnostic(`second-source evidence rejected: ${rejected.stderr.trim()}`);
  const crossSource = JSON.parse(fs.readFileSync(demo.candidate, 'utf8'));
  const sameSource = path.join(tmp, 'same-source.json');
  put(sameSource, {...crossSource, id: 'same_source_only', cases: crossSource.cases.map(c => c.role === 'transfer' ? {...c, citation: crossSource.cases[0].citation} : c)});
  const sameRejected = run(tmp, 'propose-sources', '--workspace', workspace, '--input', sameSource, '--project-root', project);
  assert.notEqual(sameRejected.status, 0);
  assert.match(sameRejected.stderr, /Second different source evidence required/);
  const result = run(tmp, 'propose-sources', '--workspace', workspace, '--input', demo.candidate, '--project-root', project);
  assert.equal(result.status, 0, result.stderr);
  const observation = JSON.parse(result.stdout);
  assert.equal(observation.status, 'cross-source-proposal-unapproved');
  assert.deepEqual(observation.sourceIds, ['cold_chain', 'receiving_desk']);
  assert.deepEqual(observation.observed.map(item => item.role), ['positive', 'negative', 'boundary', 'nontrigger', 'transfer']);
  assert.equal(observation.observed[0].baselineStatus, 'unknown');
  assert.equal(observation.observed[0].observedStatus, 'supported');
  assert.equal(observation.observed[3].observedStatus, 'unknown');
  assert.equal(observation.observed[4].observedStatus, 'supported');
  assert.equal(fs.readdirSync(path.join(workspace, 'temporary')).length, 0);
  assert.equal(fs.existsSync(path.join(workspace, 'datasets/knowledge/implicit/candidate-sealed_transfer_cross_source.json')), true);
  t.diagnostic(`semantic gap: ${observation.observed[0].baselineStatus} before rule; ${observation.observed[0].observedStatus} in isolated proposed-rule probe`);
  t.diagnostic(`nontrigger abstention: ${observation.observed[3].observedStatus}; transfer source: ${observation.observed[4].sourceId}, status=${observation.observed[4].observedStatus}`);
  const legacyPrepared = run(tmp, 'prepare', '--workspace', workspace, '--file', path.join(project, 'skills/material-to-sop/fixtures/cold-chain.txt'), '--source-id', 'cold_chain', '--revision', 'synthetic-rev1', '--license', 'test-only-local-fixture');
  assert.equal(legacyPrepared.status, 0, legacyPrepared.stderr);
  const bundled = JSON.parse(fs.readFileSync(path.join(project, 'skills/material-to-sop/fixtures/transfer-candidate.json'), 'utf8'));
  const singleSource = path.join(tmp, 'single-source.json');
  put(singleSource, {...bundled, secondSource: undefined, probes: bundled.probes.filter(probe => probe.role !== 'nontrigger')});
  const blocked = run(tmp, 'candidate', '--workspace', workspace, '--input', singleSource, '--project-root', project);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Single-source candidate requires a second prepared source plus a non-trigger probe/);
  t.diagnostic(`legacy single-source rejected: ${blocked.stderr.trim()}`);
  const registered = run(tmp, 'candidate', '--workspace', workspace, '--input', path.join(project, 'skills/material-to-sop/fixtures/transfer-candidate.json'), '--project-root', project);
  assert.equal(registered.status, 0, registered.stderr);
  assert.equal(JSON.parse(registered.stdout).status, 'candidate');
  const probed = run(tmp, 'probe', '--workspace', workspace, '--id', 'sealed_transfer', '--project-root', project);
  assert.equal(probed.status, 0, probed.stderr);
  const receipt = JSON.parse(probed.stdout);
  assert.deepEqual(receipt.results.map(item => item.role), ['positive', 'negative', 'boundary', 'nontrigger', 'transfer']);
  assert.ok(receipt.results.every(item => item.passed));
  t.diagnostic(`legacy candidate: 5 isolated probes passed; candidate remains unapproved`);
});
