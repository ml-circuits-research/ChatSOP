/**
 * Adapter for `conform-core` (reasoning/strategies/conform/): the oracle plus the `conform` capability through the lowering of a trace
 * with its norms and methods to core rules (x_c_*). A query with `mode conform` is lowered and answered by the oracle on the lowered
 * program; every other query goes to the oracle unchanged. A circuit it does not run is reported `not_expressible`, never weakened.
 */
import {conformCore, NotExpressibleError} from '../../../reasoning/strategies/conform/index.mjs';
import {NotExpressible} from './product.mjs';

export const conformCoreAdapter = {
  id: 'conform-core', status: 'available', origin: 'reasoning/strategies/conform/ (conformance lowered to core rules, run on the oracle)',
  description: 'Conformance of a trace against the norms and methods in force, lowered to step-indexed core rules and answered by the js-oracle; all other queries are the oracle itself.',
  lowering: conformCore.lowering,
  supports: new Set(conformCore.features),
  async available() { return {ok: true}; },
  run(c, ctx) {
    try {
      const packet = conformCore.ask({theory: {knowledge: c.knowledge}, query: c.query});
      ctx.packet = packet;
      return packet;
    } catch (e) {
      if (e instanceof NotExpressibleError) throw new NotExpressible(e.message);
      throw e;
    }
  }
};
