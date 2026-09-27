import fs from 'node:fs';
import path from 'node:path';

// Generators are inspected separately from the sealed evaluator and validation tools.
const entries = ['tools/generate-data.mjs', 'tools/build-data.mjs', 'tools/teacher-generate.mjs'];
const forbidden = /(?:eval\/suites\/[^\s'"`)]*\/test\.jsonl|datasets\/[^\s'"`)]*\/test\.jsonl|(?:eval\/suites|datasets)[^\s'"`)]*\/test\.jsonl)/;
const io = /\b(?:readFileSync|readFile|createReadStream|openSync|open|read_text|open\s*\()\s*\(/g;
const imported = /\b(?:import\s*(?:\(|[^;\n]*?\bfrom\s*)|require\s*\()\s*['"`]([^'"`]+)['"`]/g;
const list = source => [...source.matchAll(/\[\s*['\"](train|dev|test)['\"]\s*,\s*['\"](train|dev|test)['\"]\s*\]/g)].map(match => [match[1], match[2]]);
function trainingSources(root) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes:true })) {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (/\.(?:mjs|py)$/.test(entry.name)) files.push(relative);
    }
  };
  walk('training');
  return files.sort();
}

export function auditTrainingSelection(root) {
  const files = trainingSources(root), violations = [], observed_splits = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    if (/test\.jsonl/.test(source) || /eval\/suites/.test(source)) violations.push(`${file}: sealed test path in training/selection code`);
    if (file === 'training/cli.mjs') {
      const calls = [...source.matchAll(/\bdataset\s*\(\s*o\s*,\s*(\[[^\]]*\])/g)];
      if (!calls.length) violations.push('training/cli.mjs: missing dataset() callsites');
      for (const call of calls) {
        const splits = list(call[1])[0];
        observed_splits.push({ file, call:call[0], splits:splits ?? null });
        if (!splits || splits.join(',') !== 'train,dev') violations.push(`${file}: unsafe dataset() split list: ${call[1]}`);
      }
    }
    if (file === 'training/python/train.py' || file === 'training/python/audit_tokens.py') {
      const splits = list(source);
      observed_splits.push({ file, lists:splits });
      if (!splits.length || splits.some(items => items.join(',') !== 'train,dev')) violations.push(`${file}: missing/unsafe Python split list`);
      if (file.endsWith('train.py') && !source.includes("'formalizer'/'dev.jsonl'")) violations.push(`${file}: semantic selection must use dev.jsonl`);
    }
  }
  return { files, observed_splits, violations };
}

export function auditSourceBoundary(root) {
  const files = [...entries];
  const datasetDir = path.join(root, 'tools/datasets');
  for (const name of fs.readdirSync(datasetDir)) if (name.endsWith('.mjs') && name !== 'validate.mjs') files.push(`tools/datasets/${name}`);
  const violations = [];
  for (const name of files.sort()) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of source.matchAll(imported)) if (forbidden.test(match[1]) || /(?:^|\/)eval\/suites\//.test(match[1])) violations.push(`${name}: forbidden sealed-answer import ${match[1]}`);
    for (const match of source.matchAll(io)) {
      // Conservatively inspect the call expression through its closing parenthesis; this also
      // catches path.join(..., 'test.jsonl') reads, unlike searching literal readFileSync('...').
      const call = source.slice(match.index, match.index + 400).split(/[;\n]/, 1)[0];
      if (/test\.jsonl|eval\/suites/.test(call)) violations.push(`${name}: possible sealed-answer read: ${call.slice(0, 120)}`);
    }
    // A path assembled before an IO call must not hide a read of a literal sealed answer.
    if (forbidden.test(source) && !name.startsWith('tools/datasets/build-')) violations.push(`${name}: sealed-answer path in generation/selection source`);
    for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*test\.jsonl[^;\n]*/g)) {
      const read = new RegExp(`\\b(?:readFileSync|readFile|createReadStream|openSync|open|read_text)\\s*\\(\\s*${match[1]}\\b`);
      if (read.test(source)) violations.push(`${name}: sealed-answer path variable read: ${match[1]}`);
    }
  }
  const training = auditTrainingSelection(root);
  return { files:[...files, ...training.files], observed_splits:training.observed_splits, violations:[...violations, ...training.violations] };
}
