/** Minimal Hunspell reader: expands a `.dic` word list with the prefix and suffix rules of its `.aff` file.
 *
 * Only what the pinned en_US (SCOWL) and ro (Rospell) dictionaries use is supported: single-character flags,
 * SFX/PFX rules with strip, append and condition (a flag may name both a PFX and an SFX group), one level of prefix x suffix cross product, and the
 * ONLYINCOMPOUND / NEEDAFFIX / FORBIDDENWORD flags (such stems are not emitted alone). Compounding and
 * continuation classes are not expanded; a word the reader misses is simply unknown, which makes the corrector
 * more conservative only if the missing word is a correction target, never less.
 */

function conditionPattern(condition, suffix) {
  if (!condition || condition === '.') return null;
  // Hunspell conditions are a regular-expression subset: literal letters, `.` and `[...]` / `[^...]` classes.
  const source = condition.replace(/[\\^$*+?(){}|]/g, match => (match === '^' ? '^' : `\\${match}`));
  return new RegExp(suffix ? `(?:${source})$` : `^(?:${source})`, 'u');
}

/** Parses the affix rules and the flags that suppress a bare stem. */
export function parseAff(text) {
  const rules = new Map(), flags = {onlyInCompound: null, needAffix: null, forbidden: null};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts[0] === 'FLAG' && parts[1] !== 'UTF-8') throw Error(`Unsupported FLAG type ${parts[1]}`);
    if (parts[0] === 'ONLYINCOMPOUND') flags.onlyInCompound = parts[1];
    if (parts[0] === 'NEEDAFFIX') flags.needAffix = parts[1];
    if (parts[0] === 'FORBIDDENWORD') flags.forbidden = parts[1];
    if ((parts[0] !== 'SFX' && parts[0] !== 'PFX') || parts.length !== 4 || !/^[YN]$/.test(parts[2])) continue;
    const [kind, flag, cross, count] = parts;
    const group = {suffix: kind === 'SFX', cross: cross === 'Y', rules: []};
    for (let k = 0; k < Number(count); k++) {
      const rule = lines[++i].trim().split(/\s+/);
      if (rule[0] !== kind || rule[1] !== flag) throw Error(`Malformed ${kind} ${flag} rule: ${lines[i]}`);
      const strip = rule[2] === '0' ? '' : rule[2];
      const append = (rule[3] === '0' ? '' : rule[3]).split('/')[0];
      group.rules.push({strip, append, condition: conditionPattern(rule[4], group.suffix)});
    }
    rules.set(kind + flag, group);
  }
  return {rules, flags};
}

function applyRule(word, group, rule) {
  if (rule.condition && !rule.condition.test(word)) return null;
  if (group.suffix) {
    if (rule.strip && !word.endsWith(rule.strip)) return null;
    return word.slice(0, word.length - rule.strip.length) + rule.append;
  }
  if (rule.strip && !word.startsWith(rule.strip)) return null;
  return rule.append + word.slice(rule.strip.length);
}

/** Calls `emit(form)` for every stem and affixed form of the dictionary. */
export function expandDic(dicText, aff, emit) {
  const lines = dicText.split(/\r?\n/);
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    const slash = line.search(/(?<!\\)\//);
    const word = (slash < 0 ? line : line.slice(0, slash)).split(/\s/)[0].replace(/\\\//g, '/');
    const flags = slash < 0 ? '' : line.slice(slash + 1).split(/\s/)[0];
    const {onlyInCompound, needAffix, forbidden} = aff.flags;
    if (forbidden && flags.includes(forbidden)) continue;
    if (!(onlyInCompound && flags.includes(onlyInCompound)) && !(needAffix && flags.includes(needAffix))) emit(word);
    const prefixed = [];
    for (const key of [...flags].flatMap(flag => ['PFX' + flag, 'SFX' + flag])) {
      const group = aff.rules.get(key);
      if (!group) continue;
      for (const rule of group.rules) {
        const form = applyRule(word, group, rule);
        if (form === null) continue;
        emit(form);
        if (!group.suffix && group.cross) prefixed.push(form);
      }
    }
    if (!prefixed.length) continue;
    for (const flag of flags) {
      const group = aff.rules.get('SFX' + flag);
      if (!group?.cross) continue;
      for (const stem of prefixed) for (const rule of group.rules) {
        const form = applyRule(stem, group, rule);
        if (form !== null) emit(form);
      }
    }
  }
}
