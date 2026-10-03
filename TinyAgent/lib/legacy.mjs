// TEMPORARY names of earlier versions, accepted while callers move (see TODO.md); this file is the only place they appear.

// TEMPORARY names of the TaskLambda rename (owner, 2026-10-03; delete when no caller needs them, see TODO.md "TaskLambda rename"):
// the configuration keys `skills.plugins` and `skills.jobs` (now `lambdas.project` and `lambdas.jobs`), the module export `skills` and
// field `inputs` (now `lambdas` and `params`), the endpoints `/v1/skills[/<name>]` (now `/v1/lambdas`), the library methods
// `skill`/`skills` (now `call`/`lambdas`), the commands `skills`, `skill`, `run-skills` and `plans` (now `lambdas --server`, `call`,
// `run-lambdas`, `lambdas`) and the agent's `.tinyagent/plans` folder (migrated in place to `.tinyagent/lambdas`).
export const OLD_LAMBDA_ENDPOINTS = Object.freeze({ list: '/v1/skills', call: '/v1/skills/' });

/** The project TaskLambda modules and job folders of a configuration, with the old `skills` keys as a fallback. */
export function lambdaSources(config = {}) {
  const l = config.lambdas ?? {}, s = config.skills ?? {};
  const problems = [];
  if (s.plugins?.length && !l.project) problems.push('configuration: skills.plugins is the old name of lambdas.project');
  if (s.jobs && Object.keys(s.jobs).length && !l.jobs) problems.push('configuration: skills.jobs is the old name of lambdas.jobs');
  return { project: l.project ?? s.plugins ?? [], jobs: l.jobs ?? s.jobs ?? {}, problems };
}

/** The purpose of a TaskLambda's model calls: `lambda:<name>`, or `skill:<name>` while a configuration allows only the old prefix. */
export function lambdaPurpose(name, config = {}) {
  const allowed = config.policy?.allowedPurposes ?? [];
  return `${allowed.includes('lambda:*') || !allowed.includes('skill:*') ? 'lambda' : 'skill'}:${name}`;
}
