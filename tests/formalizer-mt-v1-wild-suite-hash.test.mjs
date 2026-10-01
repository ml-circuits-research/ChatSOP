/** Housekeeping deviation D1 of status/preregistrations/formalizer-mt-v1.json: that preregistration and
 * status/training/qualification-formalizer-v1.json both froze the wild suite's hash from before the Q-SYM-3
 * re-adjudication (eval-ud-rules-v14-v1 deviation D2). This test proves the deviation's "how_to_pin_or_rebuild"
 * option (b) is correct: replaying eval/reports/history/ud-rules-v14/gold-readjudication.jsonl's "before" values
 * over the current sealed suite reconstructs the previously frozen file byte for byte (same sha256), without ever
 * writing that reconstruction back to eval/suites/ (the sealed suite is never modified). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const readJsonlLines = file => fs.readFileSync(file, 'utf8').split('\n');

test('the pre-Q-SYM-3 wild suite hash is reconstructible byte for byte from gold-readjudication.jsonl', () => {
  const currentPath = ROOT + 'eval/suites/formalizer-wild-v1/test.jsonl';
  const current = fs.readFileSync(currentPath, 'utf8');
  assert.equal(sha256(current), '548d76beceb18f1b9a5e9de3fb65856c9965242e779933a2d666198fe6dff897', 'the suite must still be the current (post-adjudication) one this test starts from');

  const readjudications = new Map(
    readJsonlLines(ROOT + 'eval/reports/history/ud-rules-v14/gold-readjudication.jsonl').filter(l => l.trim()).map(l => JSON.parse(l)).map(r => [r.id, r]),
  );
  assert.equal(readjudications.size, 10);

  const lines = current.split('\n');
  let reverted = 0;
  const rebuilt = lines.map(line => {
    if (!line.trim()) return line;
    const row = JSON.parse(line);
    const readjudication = readjudications.get(row.id);
    if (!readjudication) return line;
    reverted++;
    const copy = {...row, sop_target: readjudication.before.sop_target, sop_targets_accepted: readjudication.before.sop_targets_accepted};
    // The re-adjudication also stamped an `adjudication.readjudication` sub-object (date/by/group/note) that did not
    // exist before it; gold-readjudication.jsonl does not carry a "before" value for it (only for the two sop_target
    // fields), so an exact reconstruction removes the key entirely rather than guessing a prior value for it.
    if (copy.adjudication?.readjudication) { const {readjudication: _drop, ...adjudication} = copy.adjudication; copy.adjudication = adjudication; }
    return JSON.stringify(copy);
  });
  assert.equal(reverted, 10, 'every readjudicated row must be found and reverted exactly once');

  const rebuiltText = rebuilt.join('\n');
  assert.equal(sha256(rebuiltText), '077e7164a3020c1e6c3c28c8f3b5b8f2c08e2e3f59ee0e6830f9991509884163', 'reverting the 10 readjudicated rows must reproduce the exact hash frozen by formalizer-mt-v1 and status/training/qualification-formalizer-v1.json');

  // The reconstruction happens only in memory for this test; the sealed suite on disk is never touched.
  assert.equal(fs.readFileSync(currentPath, 'utf8'), current);
});
