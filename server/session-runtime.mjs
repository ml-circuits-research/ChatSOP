/**
 * The chat agents of the sessions (DS031 "Sessions"). Each session has its own repository (the clone of its base memory), its own
 * `SessionStore` (the conversation context under `agent/`) and one Agent per user. Every session links against the lexicon of its own
 * base memory (`Sessions.lexicon`), never a global one. A circuit accepted into the session after the
 * agent opened is made visible by `refresh`, which moves the agent's repository session onto the new base head.
 */
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SessionStore} from './session-store.mjs';
import {BASE_NAME} from '../lib/chat-data/memories.mjs';
import {assertFolderId} from '../lib/chat-data/index.mjs';

const CONVERSATION = 'chat';

export class SessionRuntimes {
  constructor({sessions, memories, config, defaultBase = 'default'}) {
    Object.assign(this, {sessions, memories, config, defaultBase});
    this.runtimes = new Map();
  }

  /** The session id of a request without one: one automatic session per user and conversation id on the default base memory. */
  autoSession(user, conversation, now = new Date()) {
    const id = 'auto-' + createHash('sha256').update(user + '\0' + conversation).digest('hex').slice(0, 24);
    if (!this.sessionExists(id)) this.sessions.create({base: this.defaultBase, user, id, name: `Conversation ${conversation}`, now});
    return id;
  }

  sessionExists(id) { try { this.sessions.info(id); return true; } catch (e) { if (e.status === 404) return false; throw e; } }

  /** The runtime of a session visible to `user` (or an administrator). */
  open(id, {user, admin = false}) {
    assertFolderId(id, 'session id');
    const info = this.sessions.visible(id, {user, admin});
    if (!this.runtimes.has(id)) {
      const repo = this.sessions.repository(id);
      // The lexicon is the session's own: the layered circuits of its base memory plus what the user accepted (DS031 "Lexicon of a memory").
      const store = new SessionStore({repo, lexicon: this.sessions.lexicon(id), config: this.config, root: path.join(this.sessions.dir(id), 'agent')});
      this.runtimes.set(id, {id, repo, store, users: new Set()});
    }
    const rt = this.runtimes.get(id);
    return {
      id, info, repo: rt.repo, lexicon: rt.store.lexicon,
      entry: owner => { rt.users.add(owner); return rt.store.get(owner, CONVERSATION, BASE_NAME); },
      save: (entry, owner) => rt.store.save(entry, owner, CONVERSATION, BASE_NAME),
    };
  }

  /** Makes circuits accepted into the session visible to its open agents: their repository session and their lexicon. */
  refresh(id) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.store.setLexicon(this.sessions.lexicon(id));
    for (const user of rt.users) rt.repo.rebase(rt.store.get(user, CONVERSATION, BASE_NAME).agent.session);
  }

  /** Forgets the in-memory runtime of a session (the files stay). */
  close(id) { this.runtimes.delete(id); }
}
