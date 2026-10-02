// Development-only public API; the request surface has no backend dependencies.
export {ABLATION_VARIANTS, ablationRequest, closedSopGrammar} from './surface.mjs';
export {ablationBackend, ablationFetchInterceptor, sopToCircuit} from './intercept.mjs';
