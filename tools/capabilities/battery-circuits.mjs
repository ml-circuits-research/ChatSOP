/**
 * The circuits of the capability battery itself, for the coverage report (`node tools/capabilities/coverage.mjs --battery`): the L1
 * cases (negative ones flagged), the L2 programs of the full tier and the circuits of the last L3 run.
 */
import {allCases} from './l1.mjs';
import {battery} from './l2-generator.mjs';

export async function batteryCircuits() {
  const out = [];
  for (const c of allCases().cases) {
    const negative = c.expect !== 'valid';
    if (c.files) {
      const knowledge = c.files.filter(f => f.role === 'knowledge').map(f => f.text).join('\n');
      const query = c.files.filter(f => f.role === 'query').map(f => f.text).join('\n');
      out.push({source: 'battery', ref: 'l1/' + c.id, negative, circuit: {knowledge, query}});
    } else out.push({source: 'battery', ref: 'l1/' + c.id, negative, circuit: {text: c.text, surface: negative ? 'model' : undefined}});
  }
  for (const p of battery('full').programs) out.push({source: 'battery', ref: 'l2/' + p.id, circuit: {knowledge: p.knowledge, query: p.query}});
  try {
    const {l3Circuits} = await import('./l3-run.mjs');
    out.push(...l3Circuits());
  } catch (e) { if (!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e?.code ?? e?.message))) throw e; }
  return out;
}
