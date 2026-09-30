/** Vocabulary check: catches SOP constructs that are not in the language contract (hallucinated wire types,
 * field keywords and enumerated values), model-forbidden types in model targets and cardinality misuse.
 *
 * The vocabulary is never listed here. It is read at run time from the contract:
 *   - wire types and their `one`/`many`/`required` fields: `SPEC` (and `ONTOLOGY_SPEC`) exported by sop/parser.mjs;
 *   - the `sop/contracts/wires.json` snapshot: compared with SPEC to find types whose migration is in flight;
 *   - model-authorable types: the exported `MODEL_TYPES` set of sop/declarative.mjs (the one model language, DS021);
 *   - enumerated field values, in this order: explicit registries (`values`/`enums` on a SPEC or wires.json entry,
 *     or an exported `{type: {field: [...]}}` object named FIELD_VALUES/ENUMS/FIELD_ENUMS/ENUM_VALUES), exported
 *     constants the sop/ sources use to validate a field (`CONST.includes(one(w,'field'))`), and exported constants
 *     named after the field (`POLARITIES` for `polarity`, `UNCLEAR_KINDS` for `unclear.kind`).
 * Enumerations that the sources validate only with inline literals cannot be read from an exported constant; they
 * are reported as `unverified` with their location and are not enforced here (the parser still rejects some of
 * them at parse time, which programs report as `parse_error`).
 *
 * Only the audit tools import this module (it is a sealed auditor under eval/leakage.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import {anchoredValue} from './translation.mjs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {decode, attr, helpPages, tableFields} from '../../wire-help-pages.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Constructs reported by the check; `class` separates hallucinations from contract misuse and pending migration. */
export const CONSTRUCTS = {
  unknown_type: 'hallucination',
  unknown_field: 'hallucination',
  unknown_enum: 'hallucination',
  model_forbidden_type: 'contract',
  cardinality: 'contract',
  parse_error: 'contract',
  doc_missing_page: 'documentation',
  doc_missing_row: 'documentation',
  doc_unknown_row: 'documentation',
  doc_unknown_keyword: 'documentation',
  doc_missing_enum_value: 'documentation',
};
/** Classes that are reported but do not fail a run. */
export const NON_FAILING = new Set(['migration_pending', 'proposal']);

const listOf = value => {
  if (Array.isArray(value)) return value.every(x => typeof x === 'string') ? value : null;
  if (value instanceof Set) return [...value].every(x => typeof x === 'string') ? [...value] : null;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value);
    return keys.length && keys.every(key => value[key] && typeof value[key] === 'object') ? keys : null;
  }
  return null;
};
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Set);
const snake = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
function plural(field) {
  const upper = snake(field);
  if (/[^AEIOU]Y$/.test(upper)) return upper.slice(0, -1) + 'IES';
  if (/IS$/.test(upper)) return upper.slice(0, -2) + 'ES';
  if (/(S|X|CH|SH)$/.test(upper)) return upper + 'ES';
  return upper + 'S';
}

/** Read the contract sources of a checkout: every sop/*.mjs module (exports and text) and wires.json. */
export async function loadContract(root = REPO_ROOT) {
  const dir = path.join(root, 'sop');
  const modules = {}, sources = {};
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.mjs')).sort()) {
    const relative = 'sop/' + file;
    sources[relative] = fs.readFileSync(path.join(dir, file), 'utf8');
    try {
      modules[relative] = await import(pathToFileURL(path.join(dir, file)).href);
    } catch (error) {
      modules[relative] = {};
      sources[relative + '#import-error'] = error.message;
    }
  }
  const wiresFile = path.join(dir, 'contracts', 'wires.json');
  const wiresJson = fs.existsSync(wiresFile) ? JSON.parse(fs.readFileSync(wiresFile, 'utf8')) : null;
  return {modules, sources, wiresJson};
}

/** Enumerations the sop/ sources validate: exported-constant usages (verifiable) and inline literals (not). */
function sourceEnums(sources, exported, types) {
  const usages = [], inline = [];
  const typesWith = field => [...types].filter(([, spec]) => spec.one.has(field) || spec.many.has(field)).map(([type]) => type);
  for (const [file, text] of Object.entries(sources)) {
    if (file.includes('#')) continue;
    const lines = text.split('\n');
    let fn = null, block = null;
    lines.forEach((line, index) => {
      const location = `${file}:${index + 1}`;
      const declared = line.match(/function\s+([A-Za-z_]\w*)/);
      if (declared) fn = declared[1];
      const opens = line.match(/if\s*\(\s*w\.type\s*===\s*['"](\w+)['"]\s*\)\s*\{\s*$/);
      if (opens) block = opens[1];
      else if (/^\s*\}\s*$/.test(line)) block = null;
      const onLine = [...line.matchAll(/w\.type\s*===\s*['"](\w+)['"]/g)].map(m => m[1]);
      const lowered = fn?.match(/^lower([A-Z]\w*)$/)?.[1];
      const scope = field => {
        const candidates = onLine.length ? onLine : block ? [block] : lowered ? [lowered[0].toLowerCase() + lowered.slice(1)] : [];
        const owners = typesWith(field);
        return candidates.length ? candidates.filter(type => owners.includes(type)) : null;
      };
      const fieldOf = argument => argument.match(/one\(\s*\w+\s*,\s*'(\w+)'/)?.[1]
        ?? line.match(new RegExp(`\\b${argument.trim().replace(/[^\w]/g, '')}\\s*=\\s*one\\(\\s*\\w+\\s*,\\s*'(\\w+)'`))?.[1];
      for (const m of line.matchAll(/(?:\b([A-Z][A-Z0-9_]*)\.includes\(|Object\.hasOwn\(\s*([A-Z][A-Z0-9_]*)\s*,)\s*(one\([^()]*\)|\w+)/g)) {
        const name = m[1] ?? m[2], field = fieldOf(m[3]);
        if (!field) continue;
        const values = listOf(exported.get(name)?.value);
        (values ? usages : inline).push({types: scope(field), field, values, source: values ? `exported ${name} (used at ${location})` : `module-local ${name}`, location});
      }
      for (const m of line.matchAll(/\[((?:'[\w-]+'\s*,\s*)+'[\w-]+')\]\.includes\(\s*(one\([^()]*(?:\([^()]*\))?[^()]*\)|\w+)\s*\)/g)) {
        const field = fieldOf(m[2]);
        if (field) inline.push({types: scope(field), field, values: [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]), source: 'inline literal', location});
      }
      // Output port modes are validated by a regular expression next to `fields.output`.
      if (/fields\.output/.test(lines.slice(Math.max(0, index - 3), index + 1).join('\n'))) {
        for (const m of line.matchAll(/\/\^?[^/\n]*\\s\+\(((?:[a-z]+\|)+[a-z]+)\)[^/\n]*\//g)) {
          inline.push({types: typesWith('output'), field: 'output', values: m[1].split('|'), source: 'inline regular expression (second token)', location});
        }
      }
    });
  }
  return {usages, inline};
}

/**
 * Build the vocabulary from contract sources (`loadContract` output, or stubs in tests).
 * `pendingTypes` adds types whose findings are classified as migration pending.
 */
export function buildVocabulary({modules, sources = {}, wiresJson = null, pendingTypes = []}) {
  const parser = modules['sop/parser.mjs'] ?? {};
  if (!isRecord(parser.SPEC)) throw Error('sop/parser.mjs exports no SPEC; the vocabulary cannot be read');
  const exported = new Map();
  for (const [module, exports] of Object.entries(modules)) for (const [name, value] of Object.entries(exports)) if (!exported.has(name)) exported.set(name, {module, value});

  const types = new Map();
  const addType = (type, spec, ontology) => types.set(type, {
    one: new Set(spec.one ?? []), many: new Set(spec.many ?? []), required: new Set(spec.required ?? []), ontology,
    source: ontology ? 'ONTOLOGY_SPEC' : 'SPEC',
  });
  for (const [type, spec] of Object.entries(parser.SPEC)) addType(type, spec, false);
  for (const [type, spec] of Object.entries(isRecord(parser.ONTOLOGY_SPEC) ? parser.ONTOLOGY_SPEC : {})) if (!types.has(type)) addType(type, spec, true);

  // Enumerated values.
  const enums = new Map();
  const setEnum = (type, field, values, source) => {
    const spec = types.get(type);
    if (!spec || !(spec.one.has(field) || spec.many.has(field)) || !values?.length || enums.has(`${type}.${field}`)) return;
    enums.set(`${type}.${field}`, {type, field, values: new Set(values.map(String)), source});
  };
  const registry = (object, source, type = null) => {
    for (const key of ['values', 'enums', 'enum']) if (isRecord(object?.[key])) for (const [field, values] of Object.entries(object[key])) setEnum(type, field, listOf(values), source);
  };
  for (const [type, spec] of Object.entries(parser.SPEC)) registry(spec, `SPEC.${type}`, type);
  for (const [type, entry] of Object.entries(wiresJson?.wires ?? {})) registry(entry, `wires.json ${type}`, type);
  for (const name of ['FIELD_VALUES', 'ENUMS', 'FIELD_ENUMS', 'ENUM_VALUES']) {
    const table = exported.get(name);
    if (isRecord(table?.value)) for (const [type, fields] of Object.entries(table.value)) if (isRecord(fields)) for (const [field, values] of Object.entries(fields)) setEnum(type, field, listOf(values), `exported ${name}`);
  }
  const scanned = sourceEnums(sources, exported, types);
  for (const usage of scanned.usages) for (const type of usage.types ?? []) setEnum(type, usage.field, usage.values, usage.source);
  for (const [type, spec] of types) for (const field of [...spec.one, ...spec.many]) {
    for (const name of [`${snake(type)}_${plural(field)}`, plural(field)]) {
      const values = listOf(exported.get(name)?.value);
      if (values) {
        setEnum(type, field, values, `exported ${name}`);
        break;
      }
    }
  }
  const unverified = [];
  for (const item of scanned.inline) {
    // Checks whose wire type cannot be located (routing conditions inside runtime code) are not field enumerations.
    for (const type of item.types ?? []) {
      if (enums.has(`${type}.${item.field}`)) continue;
      unverified.push({type, field: item.field, observed: item.values ?? null, location: item.location, reason: `${item.source}; not exported, so not enforced here`});
    }
  }

  // Model-authorable types: the one model language.
  const modelTypes = listOf(exported.get('MODEL_TYPES')?.value) ? new Set(listOf(exported.get('MODEL_TYPES').value)) : null;

  // Types whose migration is in flight: findings about them are classified as pending, not hallucinated.
  const pending = new Map();
  const mark = (type, reason) => { if (!pending.has(type)) pending.set(type, reason); };
  for (const type of pendingTypes) mark(type, 'declared pending by the caller');
  for (const [name, {value}] of exported) if (/^(RETIRED|DEPRECATED|LEGACY|PENDING)_\w*TYPES$/.test(name)) for (const type of listOf(value) ?? []) mark(type, `listed in exported ${name}`);
  const snapshot = wiresJson?.wires ?? null;
  if (snapshot) {
    for (const type of Object.keys(snapshot)) if (!parser.SPEC[type]) mark(type, 'in wires.json but no longer in parser SPEC');
    for (const type of Object.keys(parser.SPEC)) if (!snapshot[type]) mark(type, 'in parser SPEC but not yet in wires.json');
    if (modelTypes) {
      for (const [type, entry] of Object.entries(snapshot)) if (entry.authoredByModel === true && !modelTypes.has(type)) mark(type, 'model-authored in wires.json but not in MODEL_TYPES');
      for (const type of modelTypes) if (snapshot[type] && snapshot[type].authoredByModel === false) mark(type, 'in MODEL_TYPES but not model-authored in wires.json');
    }
  }

  const drift = snapshot ? {
    only_in_spec: Object.keys(parser.SPEC).filter(type => !snapshot[type]),
    only_in_wires_json: Object.keys(snapshot).filter(type => !parser.SPEC[type]),
  } : null;
  const conditionField = Object.values(modules).find(m => typeof m.conditionField === 'function')?.conditionField ?? (() => false);
  return {types, enums, unverified, modelTypes, pending, drift, parse: parser.parse ?? null, conditionField};
}

/** Load and build the vocabulary of a checkout. */
export async function loadVocabulary({root = REPO_ROOT, pendingTypes = []} = {}) {
  return buildVocabulary({...await loadContract(root), pendingTypes});
}

/** Plain-object summary of a vocabulary for reports. */
export function describeVocabulary(v) {
  return {
    types: Object.fromEntries([...v.types].map(([type, spec]) => [type, {one: [...spec.one], many: [...spec.many], required: [...spec.required], source: spec.source}])),
    enums: Object.fromEntries([...v.enums].map(([key, entry]) => [key, {values: [...entry.values], source: entry.source}])),
    unverified_enums: v.unverified,
    model_types: v.modelTypes ? [...v.modelTypes] : [],
    pending_types: Object.fromEntries(v.pending),
    contract_drift: v.drift,
  };
}

const HEADER = /^@([A-Za-z][A-Za-z0-9_]*)[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]*$/;
const SOP_HINT = /^@[A-Za-z][A-Za-z0-9_]*[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]*\n  \S/m;
/** True when a text block contains at least one `@id type` header followed by a two-space field line. */
export const looksLikeSop = text => SOP_HINT.test(String(text).replace(/\r\n/g, '\n'));

function dedent(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const indents = lines.filter(line => line.trim()).map(line => line.match(/^ */)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return cut ? lines.map(line => line.slice(cut)).join('\n') : lines.join('\n');
}

/**
 * Tolerant structural scan (the parser's line grammar without its validation): `@id type` headers, two-space
 * field lines, `|` blocks and `all`/`any`...`end` condition groups. Anything else ends the current wire, so
 * fragments inside prose still scan. Lines are 1-based within `text`.
 */
export function scanSop(text, {conditionField = () => false} = {}) {
  const lines = dedent(String(text)).split('\n'), wires = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const header = HEADER.exec(line);
    if (header) {
      current = {id: header[1], type: header[2], line: i + 1, fields: []};
      wires.push(current);
      continue;
    }
    if (!current || !/^  \S/.test(line)) {
      current = null;
      continue;
    }
    const match = line.trim().match(/^(\S+)(?:\s+(.*))?$/);
    const field = {key: match[1], value: (match[2] ?? '').trim(), line: i + 1};
    if (field.value === '|') {
      const chunk = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].startsWith('    '))) chunk.push(lines[++i].slice(4));
      field.value = chunk.join('\n').replace(/\s+$/, '');
      field.block = true;
    } else if (conditionField(current.type, field.key) && ['all', 'any'].includes(field.value)) {
      let depth = 1;
      while (depth && i + 1 < lines.length && /^  \s*\S/.test(lines[i + 1])) {
        const item = lines[++i].trim();
        if (item === 'all' || item === 'any') depth++;
        if (item === 'end') depth--;
      }
    }
    current.fields.push(field);
  }
  return wires;
}

const distance = (a, b) => {
  const row = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
};
const suggest = (word, candidates) => {
  let best = null, score = Infinity;
  for (const candidate of candidates) {
    const d = distance(word.toLowerCase(), candidate.toLowerCase());
    if (d < score) [best, score] = [candidate, d];
  }
  return best && score <= Math.max(2, Math.floor(word.length / 3)) ? ` (did you mean ${best}?)` : '';
};
const unquote = text => {
  if (!text.startsWith('"')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Check one SOP program or fragment. Options:
 *   ontology   'deny' (SPEC types only), 'only' (ontology types only) or 'allow' (both)
 *   model      true for a model target: types outside the model-authorable set are forbidden
 *   complete   true for whole programs: missing required fields are reported (fragments skip that)
 *   invalid    null, or {unknownType: bool} for an example marked invalid: only unknown types are checked, and
 *              not even those when the example demonstrates an unknown type
 *   parse      also run the repository parser when the scan finds nothing, reporting its error as parse_error
 * Returns findings `{construct, class, line, wire, type, field?, value?, message}`.
 */
export function checkProgram(text, vocabulary, {ontology = 'allow', model = false, complete = true, invalid = null, parse = false, proposal = false} = {}) {
  const findings = [];
  const add = (construct, wire, line, message, extra = {}) => {
    const pending = vocabulary.pending.has(wire.type) || (extra.field && vocabulary.pending.has(`${wire.type}.${extra.field}`));
    findings.push({construct, class: pending ? 'migration_pending' : proposal ? 'proposal' : CONSTRUCTS[construct], line, wire: wire.id, type: wire.type, ...extra, message});
  };
  const known = type => {
    const spec = vocabulary.types.get(type);
    if (!spec) return null;
    if (ontology === 'deny' && spec.ontology) return null;
    if (ontology === 'only' && !spec.ontology) return null;
    return spec;
  };
  const allowed = [...vocabulary.types].filter(([, spec]) => ontology === 'allow' || (ontology === 'only') === spec.ontology).map(([type]) => type);
  const modelTypes = model ? vocabulary.modelTypes : null;
  const visit = (source, offset) => {
    for (const wire of scanSop(source, {conditionField: vocabulary.conditionField})) {
      const spec = known(wire.type);
      const line = offset + wire.line;
      if (!spec) {
        const elsewhere = vocabulary.types.get(wire.type);
        const message = elsewhere ? `${elsewhere.ontology ? 'ontology' : 'program'} type ${wire.type} is not allowed in this ${ontology === 'only' ? 'ontology' : 'program'}`
          : `unknown wire type ${wire.type}${suggest(wire.type, allowed)}`;
        if (!invalid?.unknownType) add('unknown_type', wire, line, message);
        continue;
      }
      if (modelTypes && !modelTypes.has(wire.type)) add('model_forbidden_type', wire, line, `${wire.type} is not model-authorable (allowed: ${[...modelTypes].join(', ')})`);
      if (invalid) continue;
      const counts = new Map();
      for (const field of wire.fields) {
        const at = offset + field.line;
        if (!spec.one.has(field.key) && !spec.many.has(field.key)) {
          add('unknown_field', wire, at, `unknown field ${field.key} on ${wire.type}${suggest(field.key, [...spec.one, ...spec.many])}`, {field: field.key});
          continue;
        }
        counts.set(field.key, (counts.get(field.key) ?? 0) + 1);
        if (spec.one.has(field.key) && counts.get(field.key) === 2) add('cardinality', wire, at, `${wire.type}.${field.key} takes one value but is repeated`, {field: field.key});
        const entry = vocabulary.enums.get(`${wire.type}.${field.key}`);
        const value = unquote(field.value);
        if (entry && !/^[$~]/.test(field.value) && !entry.values.has(value)) {
          add('unknown_enum', wire, at, `${wire.type}.${field.key} value ${JSON.stringify(value)} is not one of ${[...entry.values].join(', ')}`, {field: field.key, value});
        }
        if (field.block && looksLikeSop(field.value)) visit(field.value, at);
      }
      if (complete) for (const key of spec.required) if (!counts.has(key)) add('cardinality', wire, line, `${wire.type} requires ${key}`, {field: key});
    }
  };
  visit(String(text), 0);
  if (parse && !findings.length && vocabulary.parse && String(text).trim()) {
    const allowTypes = ontology === 'deny' ? null : [...vocabulary.types].filter(([, spec]) => spec.ontology).map(([type]) => type);
    // A `# --- ... ---` comment line separates independent programs kept in one file (examples/research/*.sop).
    let offset = 0;
    for (const chunk of String(text).split(/^(?=# -{3})/m)) {
      if (chunk.replace(/^#.*$/gm, '').trim()) {
        try {
          vocabulary.parse(chunk, {allowTypes});
        } catch (error) {
          const line = Number(error.message.match(/^Line (\d+)/)?.[1] ?? 0);
          findings.push({construct: 'parse_error', class: proposal ? 'proposal' : 'contract', line: line ? offset + line : offset + 1, message: error.message});
        }
      }
      offset += chunk.split('\n').length - 1;
    }
  }
  return findings;
}

/** Row fields holding SOP and how each is checked. The target is the model's output. */
const ROW_PROGRAMS = [
  {field: 'sop_target', alias: 'target', ontology: 'deny', model: true},
  {field: 'setup_sop', ontology: 'deny', model: false},
  {field: 'ontology_sop', ontology: 'only', model: false},
];

/** Check every SOP field of a corpus row. The model-authorable subset applies to non-system targets. */
export function checkRow(row, vocabulary, {parse = true} = {}) {
  const findings = [];
  for (const spec of ROW_PROGRAMS) {
    const text = row[spec.field] ?? (spec.alias ? row[spec.alias] : undefined);
    if (typeof text !== 'string' || !text.trim()) continue;
    const model = spec.model && row.evaluation_track !== 'system';
    for (const finding of checkProgram(text, vocabulary, {ontology: spec.ontology, model, parse})) findings.push({...finding, where: spec.field});
  }
  return findings;
}

const NON_SOP_LANGUAGES = /^(js|javascript|mjs|ts|json|jsonl|sh|bash|shell|console|python|py|html|css|yaml|yml|prolog|smt|smt2|sql|diff|mermaid)$/i;

/** SOP blocks of an HTML page: `<pre>` contents with the page's data-sop/data-check/data-error markup. */
export function htmlBlocks(html) {
  const blocks = [];
  for (const m of html.matchAll(/<pre([^>]*)>([\s\S]*?)<\/pre>/g)) {
    const language = (attr(m[1], 'class') ?? '').match(/language-(\w+)/)?.[1] ?? '';
    if (NON_SOP_LANGUAGES.test(language)) continue;
    const source = decode(m[2].replace(/<\/?code[^>]*>/g, ''));
    const kind = attr(m[1], 'data-sop') ?? null;
    if (!kind && !looksLikeSop(source)) continue;
    const error = attr(m[1], 'data-error') ? decode(attr(m[1], 'data-error')) : '';
    const leading = m[2].match(/^(?:<code[^>]*>)?(\n?)/)[1] ? 1 : 0;
    blocks.push({
      line: html.slice(0, m.index).split('\n').length + leading - 1,
      source, kind,
      ontology: kind === 'ontology' ? 'only' : 'allow',
      invalid: kind === 'invalid' ? {unknownType: /unknown wire type/i.test(error)} : null,
    });
  }
  return blocks;
}

/** SOP blocks of a Markdown file: fenced blocks whose info string is empty or SOP-like; `invalid` in it exempts fields. */
export function markdownBlocks(text) {
  const blocks = [], lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*([^\s`]*)(.*)$/);
    if (!open) continue;
    const start = i, fence = open[2], body = [];
    while (++i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i]);
    const source = body.join('\n');
    if (NON_SOP_LANGUAGES.test(open[3]) || (open[3].toLowerCase() !== 'sop' && !looksLikeSop(dedent(source)))) continue;
    const info = (open[3] + open[4]).toLowerCase();
    blocks.push({line: start + 1, source, kind: info.trim() || null, ontology: 'allow', invalid: /\binvalid\b/.test(info) ? {unknownType: /unknown[-_ ]type/.test(info)} : null});
  }
  return blocks;
}

/**
 * Cross-check the wire help pages with the contract: every contract type has a page, every field a table row,
 * every enumerated value a mention; every keyword in a page table exists in the contract.
 */
export function checkHelpPages(helpDir, vocabulary) {
  if (!fs.existsSync(helpDir)) return [];
  const findings = [];
  const pages = helpPages(helpDir);
  const byName = new Map(pages.map(page => [page.name, page]));
  const fieldNames = new Set([...vocabulary.types.values()].flatMap(spec => [...spec.one, ...spec.many]));
  const add = (construct, type, file, message, extra = {}) => findings.push({construct, class: vocabulary.pending.has(type) ? 'migration_pending' : CONSTRUCTS[construct], file, type, ...extra, message});
  for (const [type, spec] of vocabulary.types) {
    const page = byName.get(type);
    if (!page) {
      add('doc_missing_page', type, `${type}.html`, `contract type ${type} has no help page`);
      continue;
    }
    const rows = new Set(tableFields(page.html));
    for (const field of [...spec.one, ...spec.many]) if (!rows.has(field)) add('doc_missing_row', type, page.file, `${type}.${field} has no row in the field table`, {field});
    for (const row of rows) if (/^[a-z][A-Za-z0-9_]*$/.test(row) && !spec.one.has(row) && !spec.many.has(row)) add('doc_unknown_row', type, page.file, `table row ${row} is not a field of ${type}`, {field: row});
  }
  for (const [key, entry] of vocabulary.enums) {
    const page = byName.get(entry.type);
    if (!page) continue;
    const text = decode(page.html);
    for (const value of entry.values) if (!new RegExp(`(^|[^\\w])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(text)) add('doc_missing_enum_value', entry.type, page.file, `${key} value ${value} is not mentioned`, {field: entry.field, value});
  }
  for (const page of pages) {
    if (vocabulary.types.has(page.name)) continue;
    for (const row of tableFields(page.html)) if (/^[a-z][A-Za-z0-9_]*$/.test(row) && !vocabulary.types.has(row) && !fieldNames.has(row)) add('doc_unknown_keyword', page.name, page.file, `table keyword ${row} is neither a contract type nor a field`, {field: row});
  }
  return findings;
}

// Corpus-audit integration: the default contract vocabulary of this checkout, loaded once.
const DEFAULT = await loadVocabulary();
const rowFindings = context => context.contractFindings ??= checkRow(context.row, DEFAULT, {parse: false});
const describe = finding => `${finding.where}:${finding.line ?? '?'} ${finding.construct}: ${finding.message}`;

const verbatimIn = (span, message) => { const f = t => String(t).normalize('NFC').toLocaleLowerCase('ro').replace(/\s+/g, ' ').trim(); return f(message).includes(f(span)); };
/** Quoted model-target values that look like identifiers or generator counters rather than message text. */
const ID_LIKE = [/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/, /\d+_\d+/, /\b[0-9a-f]{8,}\b/, /gp\d+_/];
/**
 * No-context guard G2: a model target carries strings as written, never identifiers. Flags the retired
 * constructs (`holds`, `premise`, atom `where` leaves), quoted values that look like ids or counters, and
 * `stated` values that do not occur in the message (host anchoring, sop/linking.mjs mentionedIn; an English
 * translation of a common noun the message mentions is anchored through the generator lexicon, translation.mjs).
 */
export function modelTargetIdFindings(row) {
  if (row.evaluation_track === 'system') return [];
  const target = typeof row.sop_target === 'string' ? row.sop_target : typeof row.target === 'string' ? row.target : '';
  if (!target) return [];
  const findings = [];
  const wireIds = new Set([...target.matchAll(/^@([A-Za-z][A-Za-z0-9_]*)\s/gm)].map(m => m[1]));
  let wire = null;
  for (const [index, line] of target.split('\n').entries()) {
    const header = line.match(HEADER);
    if (header) { wire = header[2]; if (wire === 'premise') findings.push(`line ${index + 1}: retired premise wire`); continue; }
    const field = line.match(/^\s+(\S+)(?:\s+(.*))?$/);
    if (!field) continue;
    const [, key, rest = ''] = field;
    if (key === 'holds') findings.push(`line ${index + 1}: retired holds field`);
    if (wire === 'query' && (key === 'where' || key === 'scope') && rest && !['match', 'all', 'any'].includes(rest.trim())) findings.push(`line ${index + 1}: atom ${key} leaf instead of a match block`);
    if (!['relation', 'role', 'valid', 'speaker', 'reading', 'span'].includes(key) && !/^\$/.test(rest.trim())) continue;
    if (/^\$/.test(rest.trim())) { const ref = rest.trim().slice(1); if (!wireIds.has(ref)) findings.push(`line ${index + 1}: ${key} $${ref} names no wire of this target`); continue; }
    if (wire === 'unparsed' && key === 'span') for (const quoted of rest.match(/"(?:\\.|[^"\\])*"/g) ?? []) if (!verbatimIn(JSON.parse(quoted), row.question ?? '')) findings.push(`line ${index + 1}: unparsed span ${quoted} is not a verbatim part of the message`);
    if (key === 'span') continue;
    for (const quoted of rest.match(/"(?:\\.|[^"\\])*"/g) ?? []) {
      const value = JSON.parse(quoted);
      if (ID_LIKE.some(pattern => pattern.test(value))) findings.push(`line ${index + 1}: ${key} value ${quoted} looks like an identifier`);
      if (wire === 'stated' && key === 'role' && !anchoredValue(value, row.question ?? '', row)) findings.push(`line ${index + 1}: stated value ${quoted} is not in the message`);
    }
    if (key === 'role' && !/^\S+\s+("(?:\\.|[^"\\])*"|-?\d+|\?[A-Za-z][A-Za-z0-9_]*|\$[A-Za-z][A-Za-z0-9_]*)\s*$/.test(rest)) findings.push(`line ${index + 1}: role value is not a JSON string, integer, ?variable or $id`);
    // A `$id` (a role value, a link line or `near`) names a wire of the same target (DS021 "Clauses and links").
    for (const ref of rest.replace(/"(?:\\.|[^"\\])*"/g, '').match(/\$[A-Za-z][A-Za-z0-9_]*/g) ?? []) if (!wireIds.has(ref.slice(1))) findings.push(`line ${index + 1}: ${ref} names no wire of this target`);
  }
  return findings;
}

/** Row check appended to ROW_CHECKS in checks.mjs. Pending migration findings never fail; see `pendingFindings`. */
export const VOCABULARY_ROW_CHECKS = [
  {
    id: 'vocabulary.model_target_id_token', severity: 'error', threshold: 0, target: false,
    description: 'A model target uses a retired construct (holds, premise, atom leaves), a quoted value that looks like an identifier or counter, or a stated value absent from the message (no-context guard G2).',
    run: context => modelTargetIdFindings(context.row),
  },
  {
    id: 'vocabulary.contract', severity: 'error', threshold: 0, target: false,
    description: 'A target, setup or ontology program uses a wire type, field or enumerated value outside the contract (sop/parser.mjs SPEC), a model-forbidden type, or a field against its cardinality.',
    run: context => rowFindings(context).filter(finding => !NON_FAILING.has(finding.class)).map(describe),
  },
];

/** Contract findings of a row about types whose migration is in flight (tallied by the audit engine). */
export const pendingFindings = context => rowFindings(context).filter(finding => finding.class === 'migration_pending');

/** The default vocabulary summary, for reports. */
export const defaultVocabularySummary = () => describeVocabulary(DEFAULT);
