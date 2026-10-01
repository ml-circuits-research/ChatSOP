#!/usr/bin/env node
/**
 * Builds the sealed suite `eval/suites/code-instructions-v1/` (programming plan, milestone P0): 20 instruction tasks written for the project
 * (strings, arrays, objects, math, small algorithms; a few in Romanian), each with 2 or 3 visible examples and 3 hidden tests, and a reference
 * solution that the hidden and visible tests must accept (checked here in the code-sandbox). The hidden tests and the references are sealed: the
 * proposer sees only `id`, `entry`, `instruction` and `examples`; the evaluation harness runs the hidden tests after the arm has committed its
 * answer. Written by hand: nothing is copied from HumanEval, MBPP or any other benchmark.
 *
 *   node tools/eval/build-code-instructions-v1.mjs [--check]     (--check verifies the committed files without writing)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {codeSandbox} from '../../reasoning/strategies/code-sandbox/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'eval/suites/code-instructions-v1');
const t = (call, expect) => ({call, expect});

export const TASKS = [
  {id: 'ci-01', topic: 'strings', entry: 'countVowels',
    instruction: 'Write a function countVowels(s) that returns how many vowels the string s contains. The vowels are a, e, i, o and u, in lower or upper case. The letter y is not a vowel.',
    examples: [t('countVowels("hello")', '2'), t('countVowels("SKY")', '0'), t('countVowels("Education")', '5')],
    hidden: [t('countVowels("")', '0'), t('countVowels("rhythm and BLUES")', '3'), t('countVowels("AEIOUaeiou")', '10')],
    reference: 'function countVowels(s) { let n = 0; for (const c of s.toLowerCase()) if ("aeiou".includes(c)) n++; return n; }'},
  {id: 'ci-02', topic: 'strings', entry: 'isPalindrome',
    instruction: 'Write a function isPalindrome(s) that returns true when the string s reads the same forwards and backwards after you ignore upper and lower case and ignore every character that is not a letter or a digit. The empty string is a palindrome.',
    examples: [t('isPalindrome("Racecar")', 'true'), t('isPalindrome("A man, a plan, a canal: Panama")', 'true'), t('isPalindrome("hello")', 'false')],
    hidden: [t('isPalindrome("")', 'true'), t('isPalindrome("0P")', 'false'), t('isPalindrome("No \'x\' in Nixon")', 'true')],
    reference: 'function isPalindrome(s) { const c = s.toLowerCase().replace(/[^a-z0-9]/g, ""); return c === [...c].reverse().join(""); }'},
  {id: 'ci-03', topic: 'strings', entry: 'capitalizeWords',
    instruction: 'Scrie o funcție capitalizeWords(s) care primește un șir de cuvinte separate prin spații și întoarce același șir în care fiecare cuvânt începe cu literă mare, iar restul literelor din cuvânt sunt mici. Spațiile rămân exact cum sunt: nu le comprima și nu le scoate. (In English: capitalize every word, lower-case the rest of it, keep the spacing as it is.)',
    examples: [t('capitalizeWords("hello world")', '"Hello World"'), t('capitalizeWords("jAVA sCRIPT is fun")', '"Java Script Is Fun"')],
    hidden: [t('capitalizeWords("")', '""'), t('capitalizeWords("a  b")', '"A  B"'), t('capitalizeWords("MARE si mic")', '"Mare Si Mic"')],
    reference: 'function capitalizeWords(s) { return s.split(" ").map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(" "); }'},
  {id: 'ci-04', topic: 'strings', entry: 'reverseWords',
    instruction: 'Write a function reverseWords(s) that returns the words of the string s in reverse order, joined by exactly one space. Words are separated by one or more spaces, and spaces at the start or the end of s are ignored. A string with no words gives the empty string.',
    examples: [t('reverseWords("the sky is blue")', '"blue is sky the"'), t('reverseWords("  hello   world ")', '"world hello"')],
    hidden: [t('reverseWords("")', '""'), t('reverseWords("one")', '"one"'), t('reverseWords("a b  c   d")', '"d c b a"')],
    reference: 'function reverseWords(s) { return s.split(" ").filter(Boolean).reverse().join(" "); }'},
  {id: 'ci-05', topic: 'strings', entry: 'compressRuns',
    instruction: 'Write a function compressRuns(s) that does run-length encoding of the string s: every maximal run of the same character is written as that character followed by the length of the run, also when the length is 1. The empty string gives the empty string.',
    examples: [t('compressRuns("aaabcc")', '"a3b1c2"'), t('compressRuns("abc")', '"a1b1c1"'), t('compressRuns("zzzzzzzzzzzz")', '"z12"')],
    hidden: [t('compressRuns("")', '""'), t('compressRuns("aabbaa")', '"a2b2a2"'), t('compressRuns("xyyyz")', '"x1y3z1"')],
    reference: 'function compressRuns(s) { let out = "", i = 0; while (i < s.length) { let j = i; while (j < s.length && s[j] === s[i]) j++; out += s[i] + (j - i); i = j; } return out; }'},
  {id: 'ci-06', topic: 'arrays', entry: 'mostFrequent',
    instruction: 'Write a function mostFrequent(xs) that returns the element which occurs most often in the array xs. If several elements are tied, return the one whose first occurrence in xs comes earliest. For an empty array return null. Elements are numbers or strings and are compared with ===.',
    examples: [t('mostFrequent([1, 2, 2, 3])', '2'), t('mostFrequent(["a", "b", "b", "a", "c"])', '"a"'), t('mostFrequent([7])', '7')],
    hidden: [t('mostFrequent([])', 'null'), t('mostFrequent([3, 1, 1, 3, 2])', '3'), t('mostFrequent(["x", "y", "y", "z", "z", "z"])', '"z"')],
    reference: 'function mostFrequent(xs) { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); let best = null, bc = 0; for (const [k, c] of m) if (c > bc) { best = k; bc = c; } return best; }'},
  {id: 'ci-07', topic: 'arrays', entry: 'dedupeKeepOrder',
    instruction: 'Write a function dedupeKeepOrder(xs) that returns a new array without duplicates: keep the first occurrence of every element and the original order. Elements are numbers or strings compared with === (so 1 and "1" are different). The array xs must not be changed.',
    examples: [t('dedupeKeepOrder([1, 2, 1, 3, 2])', '[1, 2, 3]'), t('dedupeKeepOrder(["a", "a", "a"])', '["a"]')],
    hidden: [t('dedupeKeepOrder([])', '[]'), t('dedupeKeepOrder([1, "1", 1, "1"])', '[1, "1"]'), t('(() => { const a = [1, 1, 2]; dedupeKeepOrder(a); return a; })()', '[1, 1, 2]')],
    reference: 'function dedupeKeepOrder(xs) { return [...new Set(xs)]; }'},
  {id: 'ci-08', topic: 'arrays', entry: 'chunk',
    instruction: 'Write a function chunk(xs, n) that splits the array xs into consecutive pieces of length n and returns the array of the pieces. The last piece may be shorter. n is a positive integer. An empty array gives an empty array.',
    examples: [t('chunk([1, 2, 3, 4, 5], 2)', '[[1, 2], [3, 4], [5]]'), t('chunk([1, 2, 3], 3)', '[[1, 2, 3]]')],
    hidden: [t('chunk([], 4)', '[]'), t('chunk([1, 2, 3], 5)', '[[1, 2, 3]]'), t('chunk(["a", "b", "c", "d"], 1)', '[["a"], ["b"], ["c"], ["d"]]')],
    reference: 'function chunk(xs, n) { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; }'},
  {id: 'ci-09', topic: 'arrays', entry: 'secondLargest',
    instruction: 'Write a function secondLargest(xs) that returns the second largest DISTINCT number of the array of numbers xs, or null when xs has fewer than two distinct values. The array xs must not be changed.',
    examples: [t('secondLargest([3, 1, 4, 1, 5])', '4'), t('secondLargest([10, 10, 9])', '9'), t('secondLargest([2, 2])', 'null')],
    hidden: [t('secondLargest([])', 'null'), t('secondLargest([-1, -5, -3])', '-3'), t('secondLargest([5, 5, 4, 4, 3])', '4')],
    reference: 'function secondLargest(xs) { const d = [...new Set(xs)].sort((a, b) => b - a); return d.length < 2 ? null : d[1]; }'},
  {id: 'ci-10', topic: 'arrays', entry: 'flatten',
    instruction: 'Write a function flatten(xs) that returns a new array in which all nested arrays are flattened completely, at any depth, keeping the left-to-right order. Elements that are not arrays (including null and objects) are kept as they are.',
    examples: [t('flatten([1, [2, [3]]])', '[1, 2, 3]'), t('flatten([[], [1]])', '[1]')],
    hidden: [t('flatten([])', '[]'), t('flatten([[[["a"]]], "b", [null, [{x: 1}]]])', '["a", "b", null, {x: 1}]'), t('flatten([1, 2, 3])', '[1, 2, 3]')],
    reference: 'function flatten(xs) { const out = []; for (const x of xs) { if (Array.isArray(x)) out.push(...flatten(x)); else out.push(x); } return out; }'},
  {id: 'ci-11', topic: 'objects', entry: 'groupByLength',
    instruction: 'Write a function groupByLength(words) that returns an object whose keys are word lengths and whose values are arrays with the words of that length, in their original order. An empty array gives an empty object.',
    examples: [t('groupByLength(["cat", "dog", "bird"])', '({3: ["cat", "dog"], 4: ["bird"]})'), t('groupByLength(["a", "bb", "c"])', '({1: ["a", "c"], 2: ["bb"]})')],
    hidden: [t('groupByLength([])', '({})'), t('groupByLength(["", "x", ""])', '({0: ["", ""], 1: ["x"]})'), t('groupByLength(["same", "size", "word"])', '({4: ["same", "size", "word"]})')],
    reference: 'function groupByLength(words) { const o = {}; for (const w of words) (o[w.length] ??= []).push(w); return o; }'},
  {id: 'ci-12', topic: 'objects', entry: 'invertObject',
    instruction: 'Write a function invertObject(o) that returns a new object in which each value of o becomes a key and each key of o becomes the value. The values of o are strings or numbers (they become string keys). If two keys of o have the same value, the key that comes LAST in the order of the keys of o wins.',
    examples: [t('invertObject({a: "x", b: "y"})', '({x: "a", y: "b"})'), t('invertObject({one: 1, two: 2})', '({1: "one", 2: "two"})')],
    hidden: [t('invertObject({})', '({})'), t('invertObject({a: 1, b: 2, c: 1})', '({1: "c", 2: "b"})'), t('invertObject({k: "k"})', '({k: "k"})')],
    reference: 'function invertObject(o) { const r = {}; for (const k of Object.keys(o)) r[o[k]] = k; return r; }'},
  {id: 'ci-13', topic: 'objects', entry: 'mergeCounts',
    instruction: 'Write a function mergeCounts(a, b). Both a and b are objects that map names to counts (non-negative integers). Return a new object in which every name that occurs in a or in b maps to the sum of its counts in the two objects. The objects a and b must not be changed.',
    examples: [t('mergeCounts({a: 1, b: 2}, {b: 3, c: 4})', '({a: 1, b: 5, c: 4})'), t('mergeCounts({}, {x: 1})', '({x: 1})')],
    hidden: [t('mergeCounts({}, {})', '({})'), t('mergeCounts({a: 1}, {a: 2})', '({a: 3})'), t('(() => { const a = {p: 1}; mergeCounts(a, {p: 1}); return a; })()', '({p: 1})')],
    reference: 'function mergeCounts(a, b) { const r = {...a}; for (const k of Object.keys(b)) r[k] = (r[k] ?? 0) + b[k]; return r; }'},
  {id: 'ci-14', topic: 'objects', entry: 'pick',
    instruction: 'Scrie o funcție pick(o, keys) care întoarce un obiect nou ce conține doar acele chei din lista keys care sunt proprietăți proprii ale lui o, cu valorile lor din o. Cheile care nu există în o sunt ignorate, iar ordinea cheilor în rezultat nu contează. O proprietate care există în o dar are valoarea undefined este tot o proprietate și rămâne în rezultat.',
    examples: [t('pick({a: 1, b: 2, c: 3}, ["a", "c"])', '({a: 1, c: 3})'), t('pick({a: 1}, ["z"])', '({})')],
    hidden: [t('pick({}, ["a"])', '({})'), t('pick({a: undefined, b: 2}, ["a", "b"])', '({a: undefined, b: 2})'), t('pick({a: 1, b: 2}, ["b", "b", "a"])', '({a: 1, b: 2})')],
    reference: 'function pick(o, keys) { const r = {}; for (const k of keys) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }'},
  {id: 'ci-15', topic: 'math', entry: 'gcd',
    instruction: 'Write a function gcd(a, b) that returns the greatest common divisor of two non-negative integers a and b. gcd(a, 0) is a, gcd(0, b) is b, and gcd(0, 0) is 0.',
    examples: [t('gcd(12, 18)', '6'), t('gcd(7, 13)', '1')],
    hidden: [t('gcd(0, 0)', '0'), t('gcd(0, 9)', '9'), t('gcd(1071, 462)', '21')],
    reference: 'function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }'},
  {id: 'ci-16', topic: 'math', entry: 'isPrime',
    instruction: 'Write a function isPrime(n) that returns true when the integer n is a prime number. Numbers below 2, including 0, 1 and the negative numbers, are not prime. The number n is at most 1000000000, and the function must answer quickly (trying divisors up to the square root of n is fast enough).',
    examples: [t('isPrime(7)', 'true'), t('isPrime(9)', 'false'), t('isPrime(2)', 'true')],
    hidden: [t('isPrime(1)', 'false'), t('isPrime(-7)', 'false'), t('isPrime(999999937)', 'true')],
    reference: 'function isPrime(n) { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; }'},
  {id: 'ci-17', topic: 'math', entry: 'sumDigits',
    instruction: 'Scrie o funcție sumDigits(n) care întoarce suma cifrelor zecimale ale unui număr întreg nenegativ n. De exemplu, pentru 123 rezultatul este 6 (1 + 2 + 3). Numărul n încape într-un număr JavaScript obișnuit (cel mult 9007199254740991).',
    examples: [t('sumDigits(123)', '6'), t('sumDigits(0)', '0'), t('sumDigits(9999)', '36')],
    hidden: [t('sumDigits(10)', '1'), t('sumDigits(1000000007)', '8'), t('sumDigits(987654321)', '45')],
    reference: 'function sumDigits(n) { let s = 0; for (const c of String(n)) s += Number(c); return s; }'},
  {id: 'ci-18', topic: 'algorithms', entry: 'binarySearch',
    instruction: 'Write a function binarySearch(xs, target). The array xs holds numbers sorted in ascending order. Return the index of target in xs, or -1 when target is not in xs. When target occurs several times, return the lowest index. Do not scan the whole array: it will also be called on arrays of one million elements.',
    examples: [t('binarySearch([1, 3, 5, 7], 5)', '2'), t('binarySearch([1, 3, 5, 7], 4)', '-1'), t('binarySearch([1, 2, 2, 2, 3], 2)', '1')],
    hidden: [t('binarySearch([], 1)', '-1'), t('binarySearch(Array.from({length: 1000000}, (_, i) => i * 2), 999998)', '499999'), t('binarySearch([5], 5)', '0')],
    reference: 'function binarySearch(xs, target) { let lo = 0, hi = xs.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < target) lo = mid + 1; else hi = mid; } return lo < xs.length && xs[lo] === target ? lo : -1; }'},
  {id: 'ci-19', topic: 'algorithms', entry: 'romanToInt',
    instruction: 'Write a function romanToInt(s) that converts a Roman numeral written with the upper-case letters I, V, X, L, C, D and M (value from 1 to 3999) to an integer. Use the subtractive notation: IV is 4, IX is 9, XL is 40, XC is 90, CD is 400 and CM is 900.',
    examples: [t('romanToInt("III")', '3'), t('romanToInt("IV")', '4'), t('romanToInt("MCMXCIV")', '1994')],
    hidden: [t('romanToInt("XLII")', '42'), t('romanToInt("MMMCMXCIX")', '3999'), t('romanToInt("DCCCXC")', '890')],
    reference: 'function romanToInt(s) { const v = {I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000}; let n = 0; for (let i = 0; i < s.length; i++) n += v[s[i]] < (v[s[i + 1]] ?? 0) ? -v[s[i]] : v[s[i]]; return n; }'},
  {id: 'ci-20', topic: 'algorithms', entry: 'balancedBrackets',
    instruction: 'Write a function balancedBrackets(s) that returns true when every opening bracket among ( [ { in the string s has a matching closing bracket ) ] } in the right order, and false otherwise. Characters that are not brackets are ignored. The empty string is balanced.',
    examples: [t('balancedBrackets("([]{})")', 'true'), t('balancedBrackets("(]")', 'false'), t('balancedBrackets("a(b)c")', 'true')],
    hidden: [t('balancedBrackets("")', 'true'), t('balancedBrackets(")(")', 'false'), t('balancedBrackets("{[(x)]}y)")', 'false')],
    reference: 'function balancedBrackets(s) { const st = [], pair = {")": "(", "]": "[", "}": "{"}; for (const c of s) { if ("([{".includes(c)) st.push(c); else if (c in pair) { if (st.pop() !== pair[c]) return false; } } return st.length === 0; }'}
];

/** Verify every reference against its visible and hidden tests in the sandbox. */
export async function verifyReferences(tasks = TASKS) {
  const bad = [];
  for (const task of tasks) {
    const tests = [...task.examples, ...task.hidden].map((x, i) => ({id: 't' + (i + 1), call: x.call, expect: x.expect}));
    const r = await codeSandbox.ask({code: {entry: task.entry, body: task.reference}, tests}, {perTestMs: 3000});
    if (r.status !== 'verified') bad.push(`${task.id} ${task.entry}: ${r.status} ${JSON.stringify(r.failures ?? r.notes)}`);
    if (task.examples.length < 2 || task.examples.length > 3 || task.hidden.length !== 3) bad.push(`${task.id}: needs 2-3 examples and 3 hidden tests`);
  }
  return bad;
}

async function main() {
  const bad = await verifyReferences();
  if (bad.length) { console.error(bad.join('\n')); return 1; }
  const text = TASKS.map(x => JSON.stringify(x)).join('\n') + '\n';
  const counts = Object.fromEntries([...new Set(TASKS.map(x => x.topic))].map(k => [k, TASKS.filter(x => x.topic === k).length]));
  const manifest = {
    format: 'chatsop-code-instructions-suite-v1', experiment: 'programming-kb-p0', created: new Date().toISOString().slice(0, 10), rows: TASKS.length, by_topic: counts,
    language: 'javascript', sha256: crypto.createHash('sha256').update(text).digest('hex'),
    selection: 'written by hand for the project (code-p0-agent, 2026-10-01); every instruction names its function; 2 or 3 visible examples and 3 hidden tests per task; a few instructions in Romanian; nothing taken from HumanEval, MBPP or another benchmark',
    sealed: 'hidden tests and reference solutions are sealed: the proposer sees id, entry, instruction and the visible examples only (lib/programming/solve-instruction.mjs never reads this folder); the evaluation harness runs the hidden tests after the arm has committed its answer'
  };
  if (process.argv.includes('--check')) {
    const old = fs.readFileSync(path.join(dir, 'test.jsonl'), 'utf8');
    if (old !== text) { console.error('test.jsonl differs from the table in this script'); return 1; }
    console.log(`ok: ${TASKS.length} tasks, every reference verified on its visible and hidden tests`);
    return 0;
  }
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'test.jsonl'), text);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`wrote ${TASKS.length} tasks to ${path.relative(root, dir)}`);
  return 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
