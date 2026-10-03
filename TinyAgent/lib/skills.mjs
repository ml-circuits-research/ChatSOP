// TEMPORARY (the TaskLambda rename of 2026-10-03; see lib/legacy.mjs and TODO.md): the module path and names of the server's registry
// before it became lib/lambda/registry.mjs, kept for callers that still import them. A loaded record keeps `inputs` (its params).
import { loadLambdas, validateParams } from './lambda/registry.mjs';

export const validateInputs = validateParams;
export async function loadSkills(config) {
  const { lambdas, problems } = await loadLambdas(config);
  return { skills: new Map([...lambdas].map(([k, v]) => [k, { ...v, inputs: v.params }])), problems };
}
