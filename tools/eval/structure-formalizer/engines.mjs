/**
 * The product's engines over a scratch memory, for evaluation: `run(sop, literals)` → the result packet of one Agent turn whose
 * formalizer returns the given circuit (the route every formalization takes). The message lists the circuit's literals so the
 * validator's "a stated value is mentioned" guard admits them. Evaluation harness only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let world = null;

export async function engines() {
  if (world) return world;
  const [{Repository}, {Agent}, {seedLexicon}] = await Promise.all([import('../../../memory/repository.mjs'), import('../../../server/agent.mjs'), import('../../../lib/knowledge-seeds.mjs')]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-lfm-'));
  const repo = new Repository(root, {memory: JSON.parse(fs.readFileSync(path.join(ROOT, 'config/runtime.json'), 'utf8')).memory});
  repo.init('base');
  const lexicon = seedLexicon('core-min');
  let n = 0;
  const run = async (sop, literals = []) => {
    const session = repo.session('base', 'pl', `c${++n}`);
    try {
      const message = `values: ${[...new Set(literals.map(String))].join(' ; ') || 'none'}`;
      const r = await new Agent({repo, session, lexicon, config: {}}).turn(message, {language: 'en', formalizer: {formalize: async () => sop}});
      return r.packet ?? {status: 'error', error: 'no packet'};
    } catch (error) { return {status: 'error', error: error.message}; }
    finally { try { repo.discard(session); } catch { /* gone */ } }
  };
  world = {run, lexicon, dispose: () => fs.rmSync(root, {recursive: true, force: true})};
  return world;
}
