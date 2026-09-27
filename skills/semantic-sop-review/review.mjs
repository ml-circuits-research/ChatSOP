#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCircuits } from '../../tools/datasets/semantic-compare.mjs';
import { sha256, validateRecord } from '../../tools/datasets/schema.mjs';

const instruction = `Assess whether candidate and reference SOP circuits preserve the supplied natural-language meaning. Inspect polarity, quantification, argument roles, temporal scope, epistemic status, answer bindings, numeric outputs, and session effects. Finite probes cannot prove universal equivalence. Return equivalent, different, or uncertain with a concrete rationale. Do not claim a model was called unless the supplied review was actually made by that model. Neither an LLM nor an integrator may override invalid syntax/types/policy, reference errors, or an observed counterexample.`;
const requireField = (condition, message) => { if (!condition) throw Error(message); };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const writeOnce = (file, object) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(object, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
};
const hashFile = file => sha256(fs.readFileSync(file));
const checkedBundle = file => {
  const bundle = readJson(file);
  requireField(bundle.format === 'semantic-sop-review-v1', 'Unknown bundle format');
  requireField(bundle.prompt_sha256 === sha256(bundle.prompt) && bundle.context_sha256 === sha256(JSON.stringify(bundle.context)) && bundle.reference_sha256 === sha256(bundle.reference) && bundle.candidate_sha256 === sha256(bundle.candidate), 'Bundle contents/hash mismatch');
  return bundle;
};

export async function prepareReview({ row, candidate, probes = [], bundle, projectRoot, config = {} }) {
  requireField(nonempty(projectRoot) && fs.statSync(projectRoot).isDirectory(), 'An explicit existing project root is required');
  validateRecord(row);
  requireField(typeof candidate === 'string', 'Candidate SOP must be text');
  requireField(Array.isArray(probes), 'probes must be a JSON array');
  const comparison = await compareCircuits(row, candidate, { probes, config });
  const prompt = instruction;
  const artifact = {
    format: 'semantic-sop-review-v1', project_root: path.resolve(projectRoot), row_id: row.id,
    source: row.source, language: row.language, question: row.question, context_assertions: row.context_assertions,
    context: row.context, ontology_sop: row.ontology_sop ?? null, input_mode: row.input_mode ?? 'diagnostic_legacy',
    setup_sop: row.setup_sop, reference: row.sop_target, candidate,
    expected: row.expected, supplied_probes: probes, comparison,
    prompt, prompt_sha256: sha256(prompt), context_sha256: sha256(JSON.stringify(row.context)),
    reference_sha256: sha256(row.sop_target), candidate_sha256: sha256(candidate),
    limitation: 'Automatic alpha-equivalence is conservative; passing supplied finite worlds alone leaves differences pending review.',
  };
  writeOnce(bundle, artifact);
  return { bundle_sha256: hashFile(bundle), verdict: comparison.verdict };
}

export function recordReview({ bundle, review, receipt }) {
  const artifact = checkedBundle(bundle), evidence = readJson(review);
  requireField(artifact.comparison.verdict === 'pending', 'Only unresolved differences are eligible for LLM adjudication');
  requireField(evidence.reviewer_kind === 'llm' && nonempty(evidence.model?.provider) && nonempty(evidence.model?.id) && nonempty(evidence.model?.version) && nonempty(evidence.reviewer_identity) && nonempty(evidence.rationale) && ['equivalent', 'different', 'uncertain'].includes(evidence.verdict), 'Review needs actual LLM identity, model version, verdict and specific rationale');
  requireField(evidence.bundle_sha256 === hashFile(bundle) && evidence.prompt_sha256 === artifact.prompt_sha256 && evidence.context_sha256 === artifact.context_sha256 && evidence.reference_sha256 === artifact.reference_sha256 && evidence.candidate_sha256 === artifact.candidate_sha256, 'Review was not bound to this exact prompt/context/circuits');
  writeOnce(receipt, { ...evidence, format: 'semantic-sop-llm-review-v1', review_source_sha256: hashFile(review), recorded_at: new Date().toISOString(), provenance_note: 'Supplied review recorded as claimed; this CLI does not authenticate a model endpoint or claim human validation.' });
  return { receipt_sha256: hashFile(receipt) };
}

export function decideReview({ bundle, receipt, decision, output }) {
  const artifact = checkedBundle(bundle), choice = readJson(decision);
  requireField(['accept', 'reject', 'quarantine'].includes(choice.verdict) && nonempty(choice.principal_identity) && nonempty(choice.rationale), 'A separate principal integrator identity, verdict and rationale are required');
  requireField(choice.bundle_sha256 === hashFile(bundle), 'Decision bundle hash mismatch');
  let llmReceipt = null;
  if (receipt) {
    llmReceipt = readJson(receipt);
    requireField(llmReceipt.format === 'semantic-sop-llm-review-v1' && llmReceipt.bundle_sha256 === hashFile(bundle), 'Review receipt bundle mismatch');
    requireField(choice.receipt_sha256 === hashFile(receipt), 'Decision receipt hash mismatch');
    requireField(choice.principal_identity !== llmReceipt.reviewer_identity, 'Reviewer cannot self-certify as principal integrator');
  }
  if (choice.verdict === 'accept') {
    requireField(!['invalid', 'reference_error', 'counterexample'].includes(artifact.comparison.verdict), 'Semantic failure/counterexample cannot be overridden');
    requireField(artifact.comparison.verdict === 'equivalent' || llmReceipt?.verdict === 'equivalent', 'Pending differences require an equivalent LLM receipt');
  }
  writeOnce(output, { ...choice, format: 'semantic-sop-final-decision-v1', receipt_sha256: receipt ? hashFile(receipt) : null, decided_at: new Date().toISOString(), provenance_note: 'The principal decision is a separately supplied judgment, not human review attested by this CLI.' });
  return { decision_sha256: hashFile(output) };
}

function args(argv) {
  const [command, ...rest] = argv, options = {};
  requireField(['prepare', 'record-review', 'decide'].includes(command), 'Usage: review.mjs prepare|record-review|decide --project-root ROOT [options]');
  for (let i = 0; i < rest.length; i += 2) {
    requireField(rest[i]?.startsWith('--') && rest[i + 1], 'Expected --key value');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  requireField(nonempty(options['project-root']), '--project-root required for portable review');
  const root = path.resolve(options['project-root']);
  requireField(fs.statSync(root).isDirectory(), 'Project root must exist');
  const resolve = key => options[key] && path.resolve(root, options[key]);
  return { command, root, resolve };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { command, root, resolve } = args(process.argv.slice(2));
    let result;
    if (command === 'prepare') {
      const row = readJson(resolve('row')), candidate = fs.readFileSync(resolve('candidate'), 'utf8');
      result = await prepareReview({ row, candidate, probes: resolve('probes') ? readJson(resolve('probes')) : [], bundle: resolve('bundle'), projectRoot: root });
    } else if (command === 'record-review') result = recordReview({ bundle: resolve('bundle'), review: resolve('review'), receipt: resolve('receipt') });
    else result = decideReview({ bundle: resolve('bundle'), receipt: resolve('receipt'), decision: resolve('decision'), output: resolve('out') });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
