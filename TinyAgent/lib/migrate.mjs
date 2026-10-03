// `tinyagent migrate-home`: copies the data of the earlier proxy (request logs, run registrations, response cache, audit store, key
// files) into the TinyAgent home, verifies every copied file by size and SHA-256, and leaves the old folders untouched. Without
// `apply` it only reports what it would copy. Keys are copied as files (mode 0600) and never printed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expandHome, tinyHome } from './settings.mjs';
import { OLD_DATA, OLD_KEYS_DIR } from './legacy.mjs';

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : [])) : []);
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

export async function migrateHome({ apply = false, env = process.env, log = () => {} } = {}) {
  const home = tinyHome(env);
  const pairs = [[expandHome(OLD_DATA.data), path.join(home, 'data')], [expandHome(OLD_DATA.cache), path.join(home, 'cache')], [expandHome(OLD_DATA.audit), path.join(home, 'audit')], [expandHome(OLD_KEYS_DIR), path.join(home, 'keys')]];
  const report = { home, apply, copied: 0, skipped_same: 0, kept_newer: 0, bytes: 0, mismatched: [], per_folder: {} };
  for (const [from, to] of pairs) {
    const files = walk(from);
    const f = (report.per_folder[path.basename(to)] = { from, files: files.length, copied: 0 });
    for (const src of files) {
      const dst = path.join(to, path.relative(from, src));
      const isKey = to.endsWith('keys');
      if (fs.existsSync(dst) && to.endsWith('data') && src.endsWith('.jsonl')) {
        // A log both versions wrote (the same day): the union of the lines, in time order.
        const have = new Set(fs.readFileSync(dst, 'utf8').split('\n').filter(Boolean));
        const add = fs.readFileSync(src, 'utf8').split('\n').filter((l) => l && !have.has(l));
        if (!add.length) { report.skipped_same += 1; continue; }
        if (apply) {
          const t = (l) => { try { return JSON.parse(l).t ?? 0; } catch { return 0; } };
          fs.writeFileSync(dst, [...have, ...add].sort((a, b) => t(a) - t(b)).join('\n') + '\n');
        }
        f.copied += 1; report.copied += 1; report.merged = (report.merged ?? 0) + 1;
        continue;
      }
      if (fs.existsSync(dst)) {
        // A key file written as a template (commented lines only) is replaced; any other existing file is kept (never overwritten).
        const template = isKey && fs.readFileSync(dst, 'utf8').split('\n').every((l) => !l.trim() || l.trim().startsWith('#'));
        if (!template) { if (sha(dst) === sha(src)) report.skipped_same += 1; else report.kept_newer += 1; continue; }
      }
      if (!apply) { f.copied += 1; report.copied += 1; continue; }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      if (isKey) fs.chmodSync(dst, 0o600);
      if (fs.statSync(dst).size !== fs.statSync(src).size || sha(dst) !== sha(src)) report.mismatched.push(path.relative(home, dst));
      else { f.copied += 1; report.copied += 1; report.bytes += fs.statSync(dst).size; }
    }
    log(`${apply ? 'copied' : 'would copy'} ${f.copied}/${files.length} files: ${from} -> ${to}`);
  }
  report.verified = apply && !report.mismatched.length;
  return report;
}
