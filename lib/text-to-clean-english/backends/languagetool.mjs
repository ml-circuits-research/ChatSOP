/**
 * textToCleanEnglish backend `languagetool`: an external LanguageTool HTTP server (LGPL, `dependencies.md`,
 * `docs/specs/DS014-source-rights.md`), grammar and spelling for English and Romanian; it never translates, so it
 * should only be pointed at monolingual text of the language it is asked to check.
 *
 * **Measured (survey `clean-english-candidates-v1`): LanguageTool corrupts unknown proper names when it sees them
 * raw** (`Ungureanu` -> `Unguent`, `Vlădescu` -> `Blades`, `Wanjiru Odhiambo` -> `Wanting Huambo`). This backend
 * therefore always masks names, quoted spans and numbers first with `lib/ud-to-sop/protect.mjs` (the same
 * placeholder scheme `eval-rewrite-symbolic-v1` and the Opus-MT/Apertium research backends use) and restores them
 * afterward; every accepted correction is on the protected skeleton, never on a name. Applying its own suggested
 * replacement to every match with one, left to right, offset-based so later edits do not shift earlier ones.
 */
import {protect, restore} from '../../ud-to-sop/protect.mjs';

export function createLanguageToolBackend({url, language = 'en-US', timeoutMs = 8000, fetchImpl = fetch} = {}) {
  if (!url) throw Error('textToCleanEnglish languagetool backend needs options.url (a running LanguageTool server, POST {url}/v2/check)');
  return {
    name: 'languagetool',
    async clean(message) {
      const {text: masked, slots} = protect(String(message));
      const params = new URLSearchParams({text: masked, language});
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let body;
      try {
        const response = await fetchImpl(`${url}/v2/check`, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: params, signal: controller.signal});
        if (!response.ok) throw Error(`LanguageTool server answered HTTP ${response.status}`);
        body = await response.json();
      } finally { clearTimeout(timer); }
      const matches = [...(body.matches ?? [])].sort((a, b) => b.offset - a.offset); // right to left: offsets stay valid
      let out = masked;
      const changes = [];
      let unresolved = 0;
      for (const match of matches) {
        const replacement = match.replacements?.[0]?.value;
        const from = out.slice(match.offset, match.offset + match.length);
        if (replacement === undefined) { unresolved++; changes.push({from, to: null, rule: match.rule?.id ?? null, message: match.message}); continue; }
        out = out.slice(0, match.offset) + replacement + out.slice(match.offset + match.length);
        changes.push({from, to: replacement, rule: match.rule?.id ?? null, message: match.message});
      }
      const restored = restore(out, slots);
      return {
        text: restored.text,
        changes: changes.reverse(),
        confidence: unresolved ? 0.85 : changes.length ? 0.95 : 1,
        translated: false,
        placeholders_preserved: restored.preserved,
      };
    },
  };
}
