import {completionBackend} from './completion.mjs';
import {requestCandidates} from '../structured/candidates.mjs';
import {grammarRequest} from '../structured/grammar.mjs';
import {structuredRequest} from '../structured/compiler.mjs';

/** Explicit experimental decoder; product defaults and validation stay unchanged. */
export function constrainedBackend({format, lexicon, ...settings}) {
  if (!['grammar', 'structured'].includes(format)) throw new Error('constrained format must be grammar or structured');
  if (!lexicon?.predicates) throw new Error('constrained authoring needs the request memory lexicon');
  const adapters = new WeakMap();
  const backend = completionBackend({...settings, request: ({context}) => {
    if (!adapters.has(context)) {
      const candidates = requestCandidates(context, lexicon);
      const adapter = format === 'grammar' ? grammarRequest(candidates) : structuredRequest(candidates);
      if (format === 'grammar') adapter.system = `${context.system}\n\n${adapter.system}\nUse only the request grammar's canonical subset: one query or constraint, balanced match/group blocks, no final end after the wire. Choose only candidate predicates and their declared roles; if these cannot express the request, use unclear. No session definitions in this experimental arm.`;
      else adapter.user = context.user.replace(/Write query\.sop\.$/, 'Return only the JSON circuit choices specified by the schema, not SOP or an answer.');
      adapters.set(context, adapter);
    }
    return adapters.get(context);
  }});
  return {...backend, id: `completion-${format}`};
}
