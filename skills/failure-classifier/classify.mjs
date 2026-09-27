import {parse, canonical, parseAtom, emitAtom} from '../../sop/parser.mjs';

const required = (condition, message) => { if (!condition) throw Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const program = source => canonical(parse(source));
const atom = source => emitAtom(parseAtom(source));
const packet = execution => {
  required(execution && typeof execution === 'object' && execution.result && typeof execution.result.status === 'string', 'An executed runtime result packet is required');
  return execution.result;
};
const complete = result => result.complete === true;
const signedSource = source => text(source?.id) && text(source?.quote) && text(source?.reviewer) && text(source?.assertedAtom);
const finding = (classification, component, evidence) => ({classification, component, evidence});

/** Diagnostics are independent source/host attestations, not conclusions supplied by the classifier. */
export function classifyFailure({question, goldSop, candidateSop, goldExecution, candidateExecution, diagnostics = {}}) {
  required(text(question), 'A nonempty question is required');
  const gold = program(goldSop), candidate = program(candidateSop);
  const g = packet(goldExecution), c = packet(candidateExecution);
  const observations = {goldStatus:g.status, candidateStatus:c.status, goldComplete:g.complete, candidateComplete:c.complete};
  const matches = [];
  if (complete(g) && complete(c)) {
    if (diagnostics.source?.reviewed === true && signedSource(diagnostics.source) && gold === candidate && g.status === 'unknown' && c.status === 'unknown') {
      const assertion = atom(diagnostics.source.assertedAtom);
      if (!gold.includes('holds '+assertion) && !gold.includes('when '+assertion))
        matches.push(finding('source_gap', 'source acquisition / reviewed knowledge ingestion', {...observations, source:{id:diagnostics.source.id, quote:diagnostics.source.quote, reviewer:diagnostics.source.reviewer, assertedAtom:assertion}, missingFromBothCircuits:true}));
    }
    if (text(diagnostics.sameInputDigest) && gold !== candidate && g.status !== c.status && ['supported','refuted'].includes(g.status) && !diagnostics.unreviewedExtraPremise)
      matches.push(finding('semantic_gap', 'SOP formalization / reviewed semantic mapping', {...observations, sameInputDigest:diagnostics.sameInputDigest, goldSop:gold, candidateSop:candidate}));
    if (text(diagnostics.sameInputDigest) && gold === candidate && g.status !== c.status)
      matches.push(finding('reasoning_gap', 'reasoning backend / execution', {...observations, sameInputDigest:diagnostics.sameInputDigest, sameCircuit:true}));
    const extra = diagnostics.unreviewedExtraPremise;
    if (text(diagnostics.sameInputDigest) && text(extra?.atom) && text(extra?.sourceId) && extra?.reviewedAsUnsupported === true && g.status === 'unknown' && c.status === 'supported' && gold !== candidate) {
      const alleged = atom(extra.atom), premises = parse(candidateSop).wires.filter(w => w.type === 'premise').flatMap(w => w.fields.holds ?? []).map(atom);
      if (premises.includes(alleged) && !parse(goldSop).wires.filter(w => w.type === 'premise').flatMap(w => w.fields.holds ?? []).map(atom).includes(alleged))
        matches.push(finding('over_inference', 'unsupported premise / candidate SOP authoring', {...observations, sameInputDigest:diagnostics.sameInputDigest, extraPremise:alleged, sourceId:extra.sourceId}));
    }
    const interpretations = diagnostics.interpretations;
    if (Array.isArray(interpretations) && interpretations.length >= 2 && interpretations.every(x => text(x.meaning) && text(x.sop) && x.execution?.result?.complete === true && text(x.sourceQuote) && text(x.reviewer))) {
      const forms = interpretations.map(x => program(x.sop));
      if (new Set(forms).size > 1 && new Set(interpretations.map(x => x.execution.result.status)).size > 1)
        matches.push(finding('ambiguity', 'question clarification / competing interpretations', {question, alternatives:interpretations.map((x,i)=>({meaning:x.meaning, sop:forms[i], status:x.execution.result.status, sourceQuote:x.sourceQuote, reviewer:x.reviewer}))}));
    }
  }
  // Independent signals can conflict; never resolve by a guess or a precedence rule.
  if (matches.length !== 1) return {classification:'insufficient_evidence', component:null, evidence:{...observations, admissibleSignals:matches.map(x=>x.classification), reason:matches.length ? 'Conflicting diagnostic signals' : 'No discriminating completed observation and independent attribution'}};
  return matches[0];
}
