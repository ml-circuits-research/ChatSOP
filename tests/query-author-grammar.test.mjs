import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateGrammar} from '../lib/query-author/structured/grammar.mjs';
import {parse} from '../sop/parser.mjs';
import {checkModelProgram} from '../sop/declarative.mjs';

const binary = path.join(process.env.LLAMA_CPP_DIR ?? path.join(os.homedir(), 'llama-cpp-venv/llama.cpp'), 'build/bin/test-gbnf-validator');
const candidates = {
  predicates: [{id: 'works_at', roles: [{name: 'subject', type: 'person'}, {name: 'object', type: 'organization'}]},
    {id: 'cost', roles: [{name: 'subject', type: 'entity'}, {name: 'object', type: 'integer'}]},
    {id: 'visited', roles: [{name: 'subject', type: 'person'}, {name: 'time', type: 'time'}]}],
  entities: ['Ana', 'Acme', 'ana'], numbers: [2, 19, 2380], times: ['2026-09-01'],
};
const base = '@q query\n  select ?x\n  where match\n    relation "works_at"\n    role subject ?x\n    role object "Acme"\n    polarity affirmed\n  end\n';
const match = (predicate, roles, indent = 4) => `${' '.repeat(indent)}match\n${' '.repeat(indent + 2)}relation "${predicate}"\n${roles.map(([name, value]) => `${' '.repeat(indent + 2)}role ${name} ${value}\n`).join('')}${' '.repeat(indent + 2)}polarity affirmed\n${' '.repeat(indent)}end\n`;
const admitted = text => checkModelProgram(parse(text));
function accepted(grammar, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-gbnf-'));
  try {
    const g = path.join(dir, 'query.gbnf'), sample = path.join(dir, 'sample.txt');
    fs.writeFileSync(g, grammar);
    fs.writeFileSync(sample, text);
    const output = execFileSync(binary, [g, sample], {encoding: 'utf8'});
    assert.doesNotMatch(output, /Failed to (parse|initialize)/, output);
    return output.includes('is valid according to the grammar');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}


test('bounded grammar accepts valid query shapes, group nesting and words-only forms', {skip: !fs.existsSync(binary)}, () => {
  const grammar = generateGrammar(candidates);
  const programs = [base,
    '@q query\n  mode count\n  select ?x\n  where match\n    relation "works_at"\n    role subject ?x\n    polarity affirmed\n  end\n',
    '@q query\n  mode every\n  quantifier at_least 2\n  where all\n' + match('works_at', [['subject', '?x']], 4) + '  end\n  scope match\n    relation "visited"\n    role subject ?x\n    polarity affirmed\n  end\n',
    '@q query\n  select ?x\n  rank highest ?price top 2\n  where all\n' + match('works_at', [['subject', '?x']], 4) +
      '    any\n' + match('cost', [['subject', '?x'], ['object', '?price']], 6) + '    end\n  end\n  at "2026-09-01"\n  compare ?price above 19\n',
    '@q query\n  mode exists\n  where match\n    relation "visited"\n    role subject "Ana"\n    role time ?t\n    polarity affirmed\n  end\n',
    '@q query\n  select ?t\n  measure start\n  where match\n    relation "visited"\n    role subject "Ana"\n    role time ?t\n    polarity affirmed\n  end\n',
    '@q query\n  asof "2026-09-01"\n  select ?t\n  where match\n    relation "visited"\n    role time ?t\n    polarity affirmed\n  end\n  compare ?t equal "2026-09-01"\n',
    '@q query\n  mode exists\n  where all\n' + match('visited', [['subject', '"Ana"'], ['time', '?t1']]) +
      match('visited', [['subject', '"Acme"'], ['time', '?t2']]) + '  end\n  order ?t1 before ?t2\n',
    base + '\n@q2 query\n  select ?y\n  where match\n    relation "works_at"\n    role subject ?y\n    role object $q\n    polarity affirmed\n  end\n',
    '@q query\n  select ?x\n  where match\n    relation "works_at"\n    role subject ?x\n    polarity affirmed\n  end\n  except ?x "ana"\n  compare any\n    ?x equal "Ana"\n    ?x equal "Acme"\n  end\n',
    '@c constraint\n  var ?x int\n  var ?y int\n  require ?x equal 2380 times 19\n  require ?y equal ?x plus 2\n  task possible\n  select ?x ?y\n',
    '@c constraint\n  var ?x int\n  require all\n    ?x equal 2380 times 19\n    any\n      ?x above 2\n      ?x below 2380\n    end\n  end\n  objective ?x plus 2\n  direction max\n  task optimize\n  select ?x\n',
    '@c constraint\n  claim 2380 above 19\n  task prove\n',
    '@u unclear\n  kind relation_not_in_memory\n'];
  for (const text of programs) { admitted(text); assert.ok(accepted(grammar, text), `Rejected valid circuit:\n${text}`); }
});

test('grammar excludes unfamiliar predicates, roles, values, plumbing and broken groups', {skip: !fs.existsSync(binary)}, () => {
  const grammar = generateGrammar(candidates);
  const invalid = [base.replace('"works_at"', '"reports_to"'), base.replace('role subject', 'role manager'),
    base.replace('"Acme"', '"Secret"'), base.replace('role subject ?x\n', 'role subject ?x\n    role subject ?y\n'),
    base.replace('    polarity affirmed', '    polarity affirmed\n    role time ?t'), base.replace('  end\n', '  end\n  filter ?x > 19\n'),
    base.replace('  end\n', '  end\n  compare ?x > 19\n'), base.replace('  end\n', '  end\n  compare ?x above 999\n'),
    base + '  order ?t1 before ?t1\n',
    base.replace('  where match\n', '  where all\n    match\n').replace('  end\n', '    end\n'),
    '@f fact\n  holds works_at ana acme\n'];
  for (const text of invalid) assert.equal(accepted(grammar, text), false, `Admitted unauthorized circuit:\n${text}`);
});

test('zero predicates still offer numeric constraints and honest unclear', {skip: !fs.existsSync(binary)}, () => {
  const grammar = generateGrammar({predicates: [], entities: [], times: [], numbers: [19, 2380]});
  assert.ok(accepted(grammar, '@c constraint\n  var ?x int\n  require ?x equal 2380 times 19\n  task possible\n  select ?x\n'));
  assert.ok(accepted(grammar, '@u unclear\n  kind relation_not_in_memory\n'));
  assert.equal(accepted(grammar, base), false);
});
