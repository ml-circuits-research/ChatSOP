/**
 * The agentic backend: the omp coding agent in a fenced folder (lib/omp/run.mjs: `--tools read,write,edit`, no shell, a time limit
 * and a hard kill, the server's secrets stripped). Round 0 writes the context files and starts the agent; a repair round continues
 * the same omp session (`-c`) with the validator's output. The contract is the file `query.sop` in the folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import {runOmp} from '../../omp/run.mjs';

const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

export function ompBackend({model = null, bin = 'omp', timeoutMs = 120_000, thinking = null, runner = runOmp, env = process.env, graceMs} = {}) {
  return {
    id: 'omp', model,
    async generate({context, history, folder}) {
      if (!folder) throw new Error('the omp backend needs a folder');
      const round = history.length;
      if (round === 0) {
        for (const file of context.files) {
          const target = path.join(folder, file.path);
          fs.mkdirSync(path.dirname(target), {recursive: true});
          fs.writeFileSync(target, file.text);
        }
        fs.rmSync(path.join(folder, 'query.sop'), {force: true});
      }
      const last = history.at(-1);
      const run = await runner({folder, prompt: round === 0 ? context.prompt : context.repair(last.problems), files: round === 0 ? context.inputs : [], model, thinking, continueSession: round > 0,
        timeoutMs, bin, env, ...(graceMs !== undefined ? {graceMs} : {})});
      const sop = read(path.join(folder, 'query.sop'));
      const report = read(path.join(folder, 'report.md'));
      return {ok: run.ok, sop, report, usage: run.usage, duration_ms: run.duration_ms, reason: run.reason ?? (run.ok && !sop.trim() ? 'the agent wrote no query.sop' : undefined), output_file: run.output_file};
    },
  };
}
