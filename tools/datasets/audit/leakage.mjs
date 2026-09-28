/** Template-level leakage between development splits and the sealed test.
 *
 * AUDIT-ONLY MODULE. It compares `eval/suites/<corpus>/test.jsonl` with the train/dev splits so a reviewer can see
 * how much of the sealed test is predictable from development data. It is a measurement, not training or
 * selection code: nothing here feeds a builder, a trainer or a checkpoint selector, and `eval/leakage.mjs`
 * verifies that no generator or training source imports it (AGENTS.md rule 9).
 *
 * Splits are streamed in the fixed order train, dev, test, so every dev/test row is compared against complete
 * earlier sets without keeping the rows themselves.
 */
import {normalize} from './text.mjs';

const pct = (count, total) => total ? count / total : 0;

export class SplitLeakage {
  constructor() {
    this.sets = {};
    this.pairs = {
      dev_vs_train: {from: 'dev', against: ['train']},
      test_vs_train: {from: 'test', against: ['train']},
      test_vs_dev: {from: 'test', against: ['dev']},
      test_vs_development: {from: 'test', against: ['train', 'dev']},
    };
    for (const pair of Object.values(this.pairs)) Object.assign(pair, {rows: 0, exact_input: 0, template: 0, skeleton: 0, entity: 0, near_duplicate: 0});
  }

  setsFor(split) {
    return this.sets[split] ??= {messages: new Set(), templates: new Set(), skeletons: new Set(), entities: new Set()};
  }

  /** Record one row; `nearSplits` lists the splits of earlier rows it nearly duplicates. */
  add({split, message, template, skeleton, entityHeads, nearSplits}) {
    const normalized = normalize(message);
    for (const pair of Object.values(this.pairs)) {
      if (pair.from !== split) continue;
      const against = pair.against.map(name => this.setsFor(name));
      pair.rows++;
      if (against.some(set => set.messages.has(normalized))) pair.exact_input++;
      if (against.some(set => set.templates.has(template))) pair.template++;
      if (skeleton !== null && against.some(set => set.skeletons.has(skeleton))) pair.skeleton++;
      if (entityHeads.some(head => against.some(set => set.entities.has(head)))) pair.entity++;
      if (nearSplits.some(name => pair.against.includes(name))) pair.near_duplicate++;
    }
    const own = this.setsFor(split);
    own.messages.add(normalized);
    own.templates.add(template);
    if (skeleton !== null) own.skeletons.add(skeleton);
    for (const head of entityHeads) own.entities.add(head);
  }

  report() {
    return Object.fromEntries(Object.entries(this.pairs).filter(([, pair]) => pair.rows > 0).map(([name, pair]) => [name, {
      rows: pair.rows,
      exact_input_overlap: pct(pair.exact_input, pair.rows),
      template_overlap: pct(pair.template, pair.rows),
      target_skeleton_overlap: pct(pair.skeleton, pair.rows),
      entity_overlap: pct(pair.entity, pair.rows),
      near_duplicate_overlap: pct(pair.near_duplicate, pair.rows),
    }]));
  }
}

/** Normalized label heads (text before the first comma) used for entity overlap. */
export const entityHeads = vocabulary => [...new Set([...vocabulary.entities.values()]
  .map(entity => normalize(String(entity.label ?? '').split(',')[0]))
  .filter(head => head.length > 1))];
