import { parse, canonical, validateGraph, dependencies, parseAtom, emitAtom } from '../../sop/parser.mjs';
import {parseCondition} from '../../sop/conditions.mjs';
import {emitCondition} from '../../lib/conditions.mjs';
import {MODEL_TYPES, compileDeclarative} from '../../sop/declarative.mjs';

function renameLocalValues(text, names) {
  let quoted = false, escaped = false, output = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      output += char;
      if (!escaped && char === '"') quoted = false;
      if (!escaped && char === '\\') escaped = true;
      else escaped = false;
    } else if (char === '"') { quoted = true; output += char; }
    else if (char === '$') {
      const match = text.slice(i + 1).match(/^[A-Za-z][A-Za-z0-9_]*/);
      if (match) { output += '$' + (names[match[0]] ?? match[0]); i += match[0].length; }
      else output += char;
    } else output += char;
  }
  return output;
}
export function checkLocalGraph(graph) {
  if (graph.wires.every(wire => MODEL_TYPES.has(wire.type))) {
    compileDeclarative(canonical(graph));
    return;
  }
  const ids = new Set(graph.wires.map(wire => wire.id));
  // External handles are checked by the guarded runtime after host loading.
  if (!graph.wires.some(wire => dependencies(wire).handles.some(handle => !ids.has(handle)))) validateGraph(graph);
}

// Conservative alpha key for structural comparison, never an equivalence proof.
// Host-approved ~handles remain exact; only local $values and query-local logic
// variables may be renamed. Field and operator order with repeated fields survive.
export function alphaCanonical(source) {
  const graph = parse(source);
  checkLocalGraph(graph);
  const names = Object.fromEntries(graph.wires.map((wire, index) => [wire.id, `w${index}`]));
  const wires = graph.wires.map((wire, index) => {
    const vars = new Map();
    const variable = term => vars.has(term) ? vars.get(term) : (vars.set(term, `?v${vars.size}`), vars.get(term));
    const renameVariables = text => {
      let quoted = false, escaped = false, out = '';
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
          out += char;
          if (!escaped && char === '"') quoted = false;
          if (!escaped && char === '\\') escaped = true;
          else escaped = false;
        } else if (char === '"') { quoted = true; out += char; }
        else if (char === '?' && /^\?[A-Za-z][A-Za-z0-9_]*/.test(text.slice(i))) {
          const match = text.slice(i).match(/^\?[A-Za-z][A-Za-z0-9_]*/)[0];
          out += variable(match); i += match.length - 1;
        } else out += char;
      }
      return out;
    };
    const fields = Object.fromEntries(Object.entries(wire.fields).sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, values.map(value => {
      let result = renameLocalValues(value, names);
      if (wire.type === 'query' && ['where', 'select'].includes(key)) {
        if (!wire.fields.filter) result = renameVariables(result);
        if (key === 'where') result = emitCondition(parseCondition(result, parseAtom), emitAtom);
      } else if (['where', 'when', 'then', 'holds'].includes(key)) result = emitAtom(parseAtom(result));
      return result;
    })]));
    return { ...wire, id: `w${index}`, fields };
  });
  return canonical({ wires });
}
