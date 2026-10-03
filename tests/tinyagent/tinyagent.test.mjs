// Runs TinyAgent's own tests (stub providers, no network, no model) as part of npm test: the core (tiers, limits, fallback, cache,
// audit, budgets, local servers, prompted roles), the server and its library, TaskLambdas and their call folders, jobs, run-lambdas,
// the agent of tinyagent run, the sandbox of model-written TaskLambdas.
import '../../TinyAgent/test/proxy.test.mjs';
import '../../TinyAgent/test/server.test.mjs';
import '../../TinyAgent/test/sandbox.test.mjs';
import '../../TinyAgent/test/priority.test.mjs';
import '../../TinyAgent/test/cache-cut.test.mjs';
import '../../TinyAgent/test/jobs-runner.test.mjs';
import '../../TinyAgent/test/jobs-task.test.mjs';
import '../../TinyAgent/test/agent.test.mjs';
import '../../TinyAgent/test/calls.test.mjs';
