/**
 * Adapter for the product strategy `datalog-soplab` (reasoning/strategies/datalog-soplab/): the desugared core lowered to the vendored soplab
 * engine (sop-reasoning-lab 0.4.0). Replaces the read-only adapter on the unpacked zip (`zip-soplab.mjs`, legacy, not registered by default).
 */
import {datalogSoplab, NotExpressibleError} from '../../../reasoning/strategies/datalog-soplab/index.mjs';
import {NotExpressible} from './product.mjs';

export const datalogSoplabAdapter = {
  id: 'datalog-soplab', status: 'available', origin: 'reasoning/strategies/datalog-soplab/ (vendored soplab: delta materialisation, NONE, reduce, transition planner; all-minimal abduction on top)',
  description: 'soplab: relation-of-bindings engine with naive/delta evaluation, stratified NONE, reduce aggregates, transition planner; abduction enumerates all minimal explanations over soplab closures. Vendored, plain Node.',
  supports: new Set(datalogSoplab.features),
  available: () => datalogSoplab.available(),
  async run(c, ctx) {
    // the vendored soplab planner has no plan-length horizon: a policy that asks for one cannot be honoured, so it is not expressible (never answered as if it had been)
    if (/^  mode\s+plan\s*$/m.test(c.query) && /^  maxDepth\s/m.test(c.query)) throw new NotExpressible('maxDepth: the soplab planner has no plan-length horizon');
    try {
      const packet = datalogSoplab.ask({theory: {knowledge: c.knowledge}, query: c.query}, {}, {conditional: false});
      ctx.packet = packet;
      return packet;
    } catch (e) {
      if (e instanceof NotExpressibleError) throw new NotExpressible(e.message);
      throw e;
    }
  }
};
