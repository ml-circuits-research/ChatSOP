/**
 * Adapter for the NEW `js-reference` strategy (reasoning/strategies/js-reference/): the complete, deliberately naive oracle of the
 * proposed core. Unlike the product adapters it lowers nothing: it hands the knowledge and query circuits of the case, as text, to
 * the strategy, which parses them itself. The strategy declares its capabilities; modes of work (method, norms, procedures,
 * amendment, conform) are declared `not_expressible` and a circuit that needs them is reported that way, never weakened.
 *
 * The harness column is `js-oracle` (the column `js-reference` is the current `reference` route of the product, kept for comparison).
 */
import {jsReference, NotExpressibleError} from '../../../reasoning/strategies/js-reference/index.mjs';
import {NotExpressible} from './product.mjs';

export const jsOracle = {
  id: 'js-oracle', status: 'available', origin: 'reasoning/strategies/js-reference/ (the oracle, beside the reference and advanced routes)',
  description: 'The complete naive oracle of the proposed core: four-valued evidence, NAF, aggregates, defaults, integrity, intervals, plan, all-minimal abduce, why_not, verified per-row conditional, used and proofs, honest budgets.',
  supports: new Set(jsReference.features),
  async available() { return {ok: true}; },
  run(c, ctx) {
    try {
      const packet = jsReference.ask({theory: {knowledge: c.knowledge}, query: c.query});
      ctx.packet = packet;
      return packet;
    } catch (e) {
      if (e instanceof NotExpressibleError) throw new NotExpressible(e.message);
      throw e;
    }
  }
};
