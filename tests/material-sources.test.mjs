import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

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
  fs.writeFileSync(path.join(tmp, 'txt.txt'), `Preface.\n\n${passages[0]}\n`);
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
