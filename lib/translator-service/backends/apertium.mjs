/**
 * TranslatorService backend `apertium`: checked for a usable Romanian→English pair on 2026-09-29 and found none,
 * packaged or unpackaged. Evidence:
 *   - `apt-cache search apertium` (Ubuntu noble universe) lists only `apertium-es-ro` (Spanish-Romanian data); no
 *     `apertium-ron-eng`/`apertium-eng-ron` package exists.
 *   - The `apertium` GitHub organization (https://github.com/apertium, where every trunk, incubator and nursery
 *     language pair lives as its own repository) has 655 public repositories as of this check; none is named
 *     `apertium-ron-eng` or `apertium-eng-ron`. The Romanian-involving repositories present are `apertium-ron`
 *     (a monolingual morphological analyzer/generator only, no bilingual dictionary), `apertium-fra-ron`,
 *     `apertium-ron-ina`, `apertium-ron-rup` and `apertium-ron-cat` — French, Interlingua, Aromanian and Catalan,
 *     never English.
 *   - A GitHub-wide code/repository search for "apertium ron-eng" and "apertium eng-ron" returns zero results.
 * This backend therefore always reports itself unavailable; `translate` throws rather than silently falling back
 * or attempting a multi-hop pivot translation (ro→es→en through the packaged Spanish-Romanian pair), which was not
 * asked for and would not be "a usable Romanian→English pair". Recorded in dependencies.md "Apertium (checked, not
 * used)" and DS021 "TranslatorService"; no GPL dependency was added because nothing was installed.
 */
export const APERTIUM_VERSION = 'translator-service-apertium-v1';

export function missing() {
  return 'no Romanian→English Apertium pair exists, packaged or in the apertium GitHub organization (incubator/nursery); checked 2026-09-29, see the file header for the evidence.';
}

export function translateBatch() {
  throw Error(`TranslatorService apertium backend unavailable: ${missing()}`);
}
