import {completionBackend} from '../backends/completion.mjs';
import {requestCandidates} from './candidates.mjs';
import {ablationRequest, ABLATION_VARIANTS} from './surface.mjs';
import {compileCircuit, structuredRequest} from './compiler.mjs';
import {parse} from '../../../sop/parser.mjs';
import {checkModelProgram} from '../../../sop/declarative.mjs';

const obj = properties => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
const responseFormat = (name, schema) => ({response_format: {type: 'json_schema', json_schema: {name, strict: true, schema}}});
const FORMS = ['lookup', 'count', 'rank', 'compare', 'exists', 'every', 'chain', 'temporal', 'numeric', 'unclear'];
const value = (raw, candidates, role = '') => {
  if (raw.startsWith('?')) return {kind: 'variable', value: raw};
  if (/^-?\d+$/.test(raw)) return {kind: 'number', value: Number(raw)};
  const decoded = JSON.parse(raw);
  return {kind: candidates.times.includes(decoded) && (role === 'time' || !candidates.entities.includes(decoded)) ? 'time' : 'entity', value: decoded};
};

/** Lossless JSON circuit for the SOP subset of the closed schema. Never supplies a fallback. */
export function sopToCircuit(sop, candidates) {
  const program = checkModelProgram(parse(sop));
  if (program.wires.length !== 1) throw new Error('expected exactly one SOP circuit');
  const wire = program.wires[0], fields = wire.fields;
  const lines = text => text.split('\n').map(s => s.trim()).filter(Boolean);
  const expression = text => {
    const parts = text.split(' ');
    if (!parts.length || parts.length % 2 !== 1) throw new Error('invalid arithmetic expression');
    return {first: value(parts[0], candidates), rest: Array.from({length: (parts.length - 1) / 2}, (_, i) => ({op: parts[i * 2 + 1], term: value(parts[i * 2 + 2], candidates)}))};
  };
  const comparison = text => {
    const m = /^(.*?) (above|below|at_least|at_most|equal|not_equal) (.*?)$/.exec(text);
    if (!m) throw new Error('invalid comparison');
    return {left: expression(m[1]), comparator: m[2], right: expression(m[3])};
  };
  const group = text => {
    const parts = lines(text); let cursor = 0;
    const match = () => {
      if (parts[cursor++] !== 'match') throw new Error('expected match');
      const relation = /^relation (.+)$/.exec(parts[cursor++] ?? '');
      const predicate = relation && JSON.parse(relation[1]);
      const roles = [];
      while (parts[cursor]?.startsWith('role ')) {
        const role = /^role (\w+) (.+)$/.exec(parts[cursor++]);
        if (!role) throw new Error('invalid role');
        roles.push({name: role[1], value: value(role[2], candidates, role[1])});
      }
      const polarity = /^polarity (affirmed|negated)$/.exec(parts[cursor++] ?? '')?.[1];
      if (parts[cursor++] !== 'end' || !polarity) throw new Error('invalid match');
      return {predicate, polarity, roles};
    };
    const nested = depth => {
      const op = parts[cursor++];
      if (!['all', 'any'].includes(op)) throw new Error('invalid condition group');
      const matches = [], groups = [];
      while (parts[cursor] !== 'end' && cursor < parts.length) {
        if (parts[cursor] === 'match') matches.push(match());
        else if (!depth && ['all', 'any'].includes(parts[cursor])) {
          const child = nested(1); groups.push({op: child.op, matches: child.matches});
        } else throw new Error('invalid nested condition');
      }
      if (parts[cursor++] !== 'end') throw new Error('unterminated condition');
      return {op, matches, ...(depth ? {} : {groups})};
    };
    const result = nested(0);
    if (cursor !== parts.length) throw new Error('extra condition');
    return result;
  };
  const tests = text => {
    const parts = lines(text); const op = parts.shift();
    if (!['all', 'any'].includes(op) || parts.pop() !== 'end') throw new Error('invalid comparison group');
    return {op, items: parts.map(part => {
      const m = /^(\?\w+) (above|below|at_least|at_most|equal|not_equal) (.+)$/.exec(part);
      if (!m) throw new Error('invalid comparison');
      return {left: m[1], comparator: m[2], right: value(m[3], candidates)};
    })};
  };
  const only = name => {
    const values = fields[name] ?? [];
    if (values.length > 1) throw new Error(`repeated ${name}`);
    return values[0];
  };
  if (wire.type === 'unclear') return {circuit: {kind: 'unclear', reason: only('kind')}};
  if (wire.type === 'constraint') {
    const vars = (fields.var ?? []).map(v => {
      const [name, type, min, max] = v.split(' ');
      if (type !== 'int') throw new Error('non-integer variable');
      return {name, min: min === undefined ? null : Number(min), max: max === undefined ? null : Number(max)};
    });
    return {circuit: {kind: 'numeric', variables: vars, requirements: (fields.require ?? []).map(comparison),
      claim: only('claim') ? comparison(only('claim')) : null, task: only('task'), objective: only('objective') ? expression(only('objective')) : null,
      direction: only('direction') ?? null, select: only('select')?.split(' ') ?? []}};
  }
  if (wire.type !== 'query') throw new Error('not a query circuit');
  const where = group(only('where') ?? '');
  const select = only('select') ?? null, mode = only('mode');
  if (mode === 'count') return {circuit: {kind: 'count', where, select}};
  if (mode === 'exists') return {circuit: {kind: 'exists', where}};
  if (mode === 'every') {
    const [quantifier, threshold] = (only('quantifier') ?? 'all').split(' ');
    return {circuit: {kind: 'every', where, scope: group(only('scope') ?? ''), select,
      quantifier, threshold: threshold === undefined ? null : Number(threshold)}};
  }
  if (only('rank')) {
    const [direction, ranked, cutKind, cutValue] = only('rank').split(' ');
    return {circuit: {kind: 'rank', where, select, value: ranked, direction,
      cut: {kind: cutKind ?? 'all', value: cutValue === undefined ? null : Number(cutValue)}, options: only('compare') ? tests(only('compare')) : null}};
  }
  if (only('compare')) return {circuit: {kind: 'compare', where, select, tests: tests(only('compare'))}};
  const period = ['at', 'during', 'asof'].find(name => only(name) !== undefined) ?? 'none';
  if (period !== 'none' || only('measure') || only('order')) {
    const [left, relation, right] = only('order')?.split(' ') ?? [];
    return {circuit: {kind: 'temporal', where, select, period, time: period === 'none' ? null : JSON.parse(only(period)),
      measure: only('measure') ?? 'none', order: left ? {left, relation, right} : null}};
  }
  return {circuit: {kind: 'lookup', where, select}};
}

/** Wrap runArm B-structured's fetch. The returned Response retains its JSON admission and scoring path. */
export function ablationFetchInterceptor({variant, lexicon, context, fetchImpl = globalThis.fetch, onCall = () => {}}) {
  if (!ABLATION_VARIANTS.includes(variant) || !context || !lexicon?.predicates) throw new Error('ablation interception needs variant, context and lexicon');
  const candidates = requestCandidates(context, lexicon);
  return async (url, init) => {
    const original = JSON.parse(init.body), request = ablationRequest(candidates, variant);
    const vocabulary = `Offered predicate IDs and roles: ${JSON.stringify(candidates.predicates.map(p => ({id: p.id, roles: p.roles.map(r => r.name)})))}; entity strings: ${JSON.stringify(candidates.entities)}; request integers: ${JSON.stringify(candidates.numbers)}; times: ${JSON.stringify(candidates.times)}.`;
    const messages = [{role: 'system', content: variant === 'steps' ? `Translate the request into a circuit, not an answer or facts. ${vocabulary} Step 1: choose only its form as {"kind":...}.` : request.system},
      {role: 'user', content: context.user.replace(/Write query\.sop\.$/, 'Return only the constrained circuit, not an answer.')}, ...original.messages.slice(2)];
    const steps = []; let remaining = original.max_tokens;
    const {response_format: _schema, grammar: _grammar, ...base} = original;
    const call = async (name, body, prompts = messages) => {
      if (remaining <= 0) throw new Error('shared question output token budget exhausted');
      const started = Date.now();
      let response, packet;
      try {
        response = await fetchImpl(url, {...init, body: JSON.stringify({...base, messages: prompts, max_tokens: remaining, ...body})});
        if (!response.ok) {
          steps.push({name, duration_ms: Date.now() - started, status: response.status, ok: false});
          onCall({variant, steps, error: `endpoint answered ${response.status}`});
          return {response};
        }
        packet = await response.json();
      } catch (error) {
        steps.push({name, duration_ms: Date.now() - started, ok: false, error: error.message});
        throw error;
      }
      const usage = packet.usage ?? {};
      remaining -= usage.completion_tokens ?? 0;
      steps.push({name, duration_ms: Date.now() - started, input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0, cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        timings: packet.timings ?? null});
      return {packet, reply: packet.choices?.[0]?.message?.content ?? ''};
    };
    try {
      let result;
    if (variant === 'steps') {
      const formSchema = obj({kind: {type: 'string', enum: candidates.predicates.length ? FORMS : ['numeric', 'unclear']}});
      const form = await call('form', responseFormat('form_choice', formSchema));
      if (form.response) return form.response;
      const formChoice = JSON.parse(form.reply);
      if (!formChoice || typeof formChoice !== 'object' || Array.isArray(formChoice) || Object.keys(formChoice).length !== 1) throw new Error('invalid form choice');
      const kind = formChoice.kind;
      if (!(candidates.predicates.length ? FORMS : ['numeric', 'unclear']).includes(kind)) throw new Error('unoffered form');
      let selected = [];
      if (kind !== 'numeric' && kind !== 'unclear') {
        const schema = obj({predicates: {type: 'array', items: {type: 'string', enum: candidates.predicates.map(p => p.id)},
          minItems: 1, maxItems: candidates.predicates.length, uniqueItems: true}});
        const pick = await call('predicates', responseFormat('predicate_choice', schema), [
          {role: 'system', content: `Translate the request into a circuit, not an answer or facts. ${vocabulary} Step 2: choose only the offered predicate IDs needed for form ${kind} as {\"predicates\":[...]}.`},
          messages[1], ...messages.slice(2)]);
        if (pick.response) return pick.response;
        const predicateChoice = JSON.parse(pick.reply);
        if (!predicateChoice || typeof predicateChoice !== 'object' || Array.isArray(predicateChoice) || Object.keys(predicateChoice).length !== 1) throw new Error('invalid predicate choice');
        selected = predicateChoice.predicates;
        if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(id => !candidates.predicates.some(p => p.id === id))) throw new Error('unoffered predicates');
      }
      const subset = {...candidates, predicates: candidates.predicates.filter(p => selected.includes(p.id))};
      const final = structuredRequest(subset);
      const schema = structuredClone(final.extraBody.response_format.json_schema.schema);
      schema.properties.circuit.anyOf = schema.properties.circuit.anyOf.filter(form => form.properties.kind.enum.includes(kind));
      result = await call('arguments', responseFormat('circuit', schema), [
        {role: 'system', content: final.system + `\nFill only form ${kind} using selected predicates ${JSON.stringify(selected)}; do not add facts or answers.`},
        {role: 'user', content: messages[1].content}, ...messages.slice(2)]);
    } else result = await call('circuit', request.extraBody);
    if (result.response) return result.response;
    let content = result.reply;
    if (variant === 'format-sop') {
      try {
        const json = sopToCircuit(content, candidates);
        compileCircuit(json, candidates);
        content = JSON.stringify(json);
      } catch { /* Preserve refusal: the unchanged runArm decoder rejects invalid raw SOP. */ }
    }
    const packet = result.packet;
    packet.choices[0].message.content = content;
    packet.usage = {prompt_tokens: steps.reduce((n, s) => n + s.input_tokens, 0),
      completion_tokens: steps.reduce((n, s) => n + s.output_tokens, 0),
      prompt_tokens_details: {cached_tokens: steps.reduce((n, s) => n + s.cache_read_tokens, 0)}};
    onCall({variant, steps, raw: result.reply, circuit: content});
    return new Response(JSON.stringify(packet), {status: 200, headers: {'content-type': 'application/json'}});
    } catch (error) {
      onCall({variant, steps, error: error.message});
      throw error;
    }
  };
}

/** authorQuery-compatible adapter backed by the exact same fetch protocol as runArm. */
export function ablationBackend({variant, lexicon, fetchImpl = globalThis.fetch, ...settings}) {
  if (!ABLATION_VARIANTS.includes(variant) || !lexicon?.predicates) throw new Error('ablation backend needs a variant and memory lexicon');
  const backends = new WeakMap(), records = new WeakMap();
  return {
    id: `ablation-${variant}`, kind: 'completion', model: settings.model, endpoint: settings.endpoint,
    stepsFor: context => records.get(context) ?? [],
    async generate(args) {
      let backend = backends.get(args.context);
      if (!backend) {
        const context = args.context;
        backend = completionBackend({...settings,
          request: () => structuredRequest(requestCandidates(context, lexicon)),
          fetchImpl: ablationFetchInterceptor({variant, context, lexicon, fetchImpl, onCall: call => {
            records.set(context, [...(records.get(context) ?? []), call]);
          }})});
        backends.set(context, backend);
      }
      const previous = records.get(args.context)?.length ?? 0;
      const result = await backend.generate(args);
      const calls = (records.get(args.context) ?? []).slice(previous);
      return {...result, steps: calls.flatMap(call => call.steps),
        report: JSON.stringify({variant, calls, decoder_output: result.report ?? null})};
    }
  };
}
