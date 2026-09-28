wire-discovery: shipped-circuit shape analysis
==============================================

solution.sop files scanned: 10640
jsEval bodies scanned:     11760
distinct shapes found:     1012

wire commands across the shipped dataset:
  jsEval       11760 (50.5% of 23310 wires)
  literal      10750 (46.1% of 23310 wires)
  aggregate    240 (1.0% of 23310 wires)
  graphPath    160 (0.7% of 23310 wires)
  containerAdd 160 (0.7% of 23310 wires)
  container    120 (0.5% of 23310 wires)
  fraction     40 (0.2% of 23310 wires)
  containerFilter 40 (0.2% of 23310 wires)
  containerUpsert 40 (0.2% of 23310 wires)

wire count per circuit:
  2 wire(s): 9730 circuits (91.4% of 10640)
  3 wire(s): 190 circuits (1.8% of 10640)
  4 wire(s): 560 circuits (5.3% of 10640)
  5 wire(s): 40 circuits (0.4% of 10640)
  7 wire(s): 120 circuits (1.1% of 10640)

error-class correlation (holdout):
  holdout items: 705 (answer_match 436, answer_mismatch 83, execution_error 186, other 0)
  failing holdout items: 269 of 705
  shipped shapes contained in any holdout program: 1 of 1012
  (shape, item) containment matches: 40
  failing containment matches: 0
  -> error share is 0 for every shape (no whole-body shape occurs in a failing holdout program)

top 20 shapes, ranked by frequency x mean-lines x error-share (ties by frequency x mean-lines):

1. f04c09f7493a  freq 100  mean-lines 33.00  freq-x-lines 3300.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const preLossTenthsOf = (preLoss) => {
      |   const scaled = preLoss * 10;
      |   const lower = Math.floor(scaled);
      |   if (Math.abs(scaled - lower - 0.5) < 1e-9 && lower % 2 === 0) {
      |     return lower;
      |   }
      |   return Math.round(scaled);
      | };
      | const preLoss = slots.localUnits * slots.factor / (1 - slots.lossPercent / 100);
      | probe(preLoss > 0, "the pre-loss demand must be positive");
      | const preLossTenths = preLossTenthsOf(preLoss);
      | const batches = Math.ceil(preLossTenths / (slots.capacity * 10));
      | probe(batches === Math.ceil(preLoss / slots.capacity), "the one-decimal display must not change the whole-batch requirement");
      | probe(batches > 0, "the demand must require at least one batch");
      | const waves = Math.ceil(batches / slots.parallelBatches);
      | probe(waves * slots.parallelBatches >= batches, "the waves must cover every batch");
      | const minutes = waves * slots.waveMinutes + slots.setupMinutes + slots.bufferMinutes;
      | probe(minutes >= slots.setupMinutes + slots.bufferMinutes, "the elapsed time must include the setup and the buffer");
      | const cost = slots.fixedCost + slots.ratePerUnit * preLoss;
      | probe(cost >= slots.fixedCost, "the cost must include the fixed charge");
      | const capacityOk = batches <= slots.batchSlots;
      | const timeOk = minutes <= slots.deadlineMinutes;
      | const budgetOk = cost <= slots.budgetUnits;
      | const feasible = capacityOk && timeOk && budgetOk;
      | const failing = (capacityOk ? 0 : 1) + (timeOk ? 0 : 1) + (budgetOk ? 0 : 1);
      | probe(feasible === (failing === 0), "the verdict must be feasible exactly when no hard constraint fails");
      | const preLossText = Math.floor(preLossTenths / 10) + "." + (preLossTenths % 10);
      | const costText = cost.toFixed(2);
      | return "The plan is " + (feasible ? "feasible" : "not feasible") + ". Its key summaries are " + preLossText +
      |   " pre-loss standard units, " + batches + " batches, " + minutes + " minutes, and " + costText + " cost units. " +
      |   "The cost applies the stated per-unit rate to the pre-loss demand, the one quantity that every capacity " +
      |   "and variable-cost step shares.";

2. dc99299c2b18  freq 80  mean-lines 37.00  freq-x-lines 2960.0  families 2  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | probe(Array.isArray(slots.tasks) && slots.tasks.length > 0, "the plan must schedule at least one task");
      | probe(Array.isArray(slots.edges), "the plan must state the precedence pairs");
      | const duration = {};
      | const indegree = {};
      | const after = {};
      | for (const task of slots.tasks) {
      |   duration[task.name] = task.duration;
      |   indegree[task.name] = 0;
      |   after[task.name] = [];
      | }
      | for (const edge of slots.edges) {
      |   indegree[edge[1]] += 1;
      |   after[edge[0]].push(edge[1]);
      | }
      | const starts = {};
      | for (const task of slots.tasks) {
      |   starts[task.name] = 0;
      | }
      | const ready = slots.tasks.filter((task) => indegree[task.name] === 0).map((task) => task.name);
      | const ordered = [];
      | while (ready.length > 0) {
      |   const name = ready.shift();
      |   ordered.push(name);
      |   for (const next of after[name]) {
      |     const candidate = starts[name] + duration[name];
      |     if (candidate > starts[next]) {
      |       starts[next] = candidate;
      |     }
      |     indegree[next] -= 1;
      |     if (indegree[next] === 0) {
      |       ready.push(next);
      |     }
      |   }
      | }
      | probe(ordered.length === slots.tasks.length, "the precedence pairs must schedule every task");
      | return slots.tasks.map((task) => starts[task.name] + duration[task.name]);

3. 19cf8bac2024  freq 120  mean-lines 17.00  freq-x-lines 2040.0  families 3  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const values = slots.values;
      | let current = values;
      | // stage 1: keepBelow
      | const kept0 = current.filter((value) => value < slots.threshold);
      | current = kept0;
      | // stage 2: count
      | const count1 = current.length;
      | current = count1;
      | // stage 3: elapsed
      | const adjusted2 = current * slots.per;
      | current = adjusted2;
      | // stage 4: addRate
      | const adjusted3 = current + slots.rate;
      | current = adjusted3;
      | probe(Number.isInteger(current) && current >= 0, "the answer must be a whole number that is not negative");
      | return current + " units.";

4. 86f7df7a0328  freq 100  mean-lines 20.00  freq-x-lines 2000.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const ids = slots.hypotheses.map((hypothesis) => hypothesis.id);
      | const supported = [];
      | const eliminated = [];
      | for (const observation of slots.observations) {
      |   if (observation.kind === "capacity-availability") {
      |     if (observation.availableUnits >= slots.failureCount) { eliminated.push("capacity"); } else { supported.push("capacity"); }
      |   } else if (observation.kind === "ordering-violation") {
      |     supported.push("ordering");
      |   } else if (observation.kind === "measurement-reproduction") {
      |     eliminated.push("measurement");
      |   } else {
      |   }
      | }
      | const survivors = slots.hypotheses.filter((hypothesis) => supported.includes(hypothesis.kind) && !eliminated.includes(hypothesis.kind));
      | probe(survivors.length === 1, "exactly one hypothesis must survive the discriminating observations");
      | const labels = { capacity: "capacity shortfall", ordering: "dependency/order mistake", measurement: "measurement error" };
      | const winner = survivors[0];
      | probe(typeof labels[winner.kind] === "string", "the surviving hypothesis must be a known claim");
      | return winner.id + ", the " + labels[winner.kind] + ", is the best-supported explanation. The decomposition is evidential: each observation is sent only to the hypothesis it can actually discriminate, then the hypothesis-level results are recombined.";

5. dbdc358c7e07  freq 100  mean-lines 20.00  freq-x-lines 2000.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | for (const route of slots.routes) {
      | }
      | const summaries = slots.routes.map((route) => ({
      |   name: route.name,
      |   timeMinutes: route.times.reduce((total, minutes) => total + minutes, 0),
      |   bottleneck: Math.min(...route.capacities)
      | }));
      | const feasible = summaries.filter((summary) => summary.bottleneck >= slots.requiredFlow && summary.timeMinutes <= slots.limitMinutes);
      | probe(feasible.length > 0, "at least one route must carry the required flow within the time limit");
      | let chosen = feasible[0];
      | for (const summary of feasible) {
      |   if (summary.timeMinutes < chosen.timeMinutes) {
      |     chosen = summary;
      |   }
      | }
      | probe(chosen.bottleneck >= slots.requiredFlow, "the chosen route must carry the required flow");
      | probe(chosen.timeMinutes <= slots.limitMinutes, "the chosen route must stay within the time limit");
      | probe(feasible.every((summary) => summary.timeMinutes >= chosen.timeMinutes), "no feasible route may be faster than the chosen route");
      | return "Choose Route " + chosen.name + ". The decomposition uses different aggregation operators for different meanings: sequential times add, serial capacities take a minimum, then shared constraints filter entire-route summaries.";

6. 39466edac790  freq 20  mean-lines 93.00  freq-x-lines 1860.0  families 4  error-share no holdout program contains this shape  score 0.00
      | const describeCrossDomain = function describeCrossDomain(check) {
      |   if (check.kind === 'distance') {
      |     return `${check.centimetres * check.kilometresPerCentimetre} km.`;
      |   }
      |   if (check.kind === 'time') {
      |     const minutes = check.startHour * 60 + check.startMinute + check.hours * 60;
      |     const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
      |     const minute = String(minutes % 60).padStart(2, '0');
      |     return `${hour}:${minute}.`;
      |   }
      |   if (check.kind === 'quorum') {
      |     return check.present >= check.threshold ? 'quorum is met.' : 'quorum is not met.';
      |   }
      |   if (check.kind === 'reports') {
      |     return `${check.total - check.duplicates} independent reports.`;
      |   }
      |   if (check.kind === 'sheets') {
      |     return `${check.start + check.received} map sheets.`;
      |   }
      |   throw new Error(`Unknown cross-domain check "${check.kind}".`);
      | };
      | const renderCrossDomain = function renderCrossDomain(checks) {
      |   if (checks === null || checks === undefined || checks.length === 0) {
      |     return '';
      |   }
      |   const parts = checks.map((check, index) => {
      |     const label = index === 1 ? 'Mixed-domain answer:' : 'Cross-domain answer:';
      |     return `${label} ${describeCrossDomain(check)}`;
      |   });
      |   return parts.join(' ');
      | };
      | const slots = $slots;
      | const parents = new Map();
      | const children = new Map();
      | const remember = (map, key, value) => {
      |   if (!map.has(key)) {
      |     map.set(key, new Set());
      |   }
      |   map.get(key).add(value);
      | };
      | for (const link of slots.links) {
      |   remember(parents, link.child, link.parent);
      |   remember(children, link.parent, link.child);
      | }
      | const descendantsAt = (person, levels) => {
      |   let frontier = new Set([person]);
      |   for (let step = 0; step < levels; step += 1) {
      |     const next = new Set();
      |     for (const current of frontier) {
      |       for (const child of children.get(current) || []) {
      |         next.add(child);
      |       }
      |     }
      |     frontier = next;
      |   }
      |   return frontier;
      | };
      | const shareParent = (left, right) => {
      |   const leftParents = parents.get(left) || new Set();
      |   for (const parent of parents.get(right) || []) {
      |     if (leftParents.has(parent)) {
      |       return true;
      |     }
      |   }
      |   return false;
      | };
      | const left = slots.subject;
      | const right = slots.object;
      | const leftParents = parents.get(left) || new Set();
      | const rightParents = parents.get(right) || new Set();
      | let relation = null;
      | if (leftParents.has(right)) {
      |   relation = right + " is a parent of " + left + ".";
      | } else if (rightParents.has(left)) {
      |   relation = left + " is a parent of " + right + ".";
      | } else if (descendantsAt(left, 2).has(right)) {
      |   relation = left + " is a grandparent of " + right + ".";
      | } else if (descendantsAt(right, 2).has(left)) {
      |   relation = right + " is a grandparent of " + left + ".";
      | } else if (shareParent(left, right)) {
      |   relation = left + " and " + right + " are siblings.";
      | } else {
      |   for (const leftParent of leftParents) {
      |     for (const rightParent of rightParents) {
      |       if (leftParent !== rightParent && shareParent(leftParent, rightParent)) {
      |         relation = left + " and " + right + " are cousins under the implied family tree.";
      |       }
      |     }
      |   }
      | }
      | probe(relation !== null, "the stated links must determine the relation between the two named people");
      | const suffix = renderCrossDomain(slots.crossDomain);
      | return suffix === "" ? relation : relation + " " + suffix;

7. 7eb1c949d199  freq 100  mean-lines 18.00  freq-x-lines 1800.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const formatScore = (scaled) => {
      |   const sign = scaled < 0 ? "-" : "";
      |   const magnitude = Math.abs(scaled);
      |   return sign + Math.floor(magnitude / 10) + "." + (magnitude % 10);
      | };
      | const timeWeightScales = { 1: 10, 1.5: 15, 2: 20 };
      | const timeScale = timeWeightScales[slots.timeWeight];
      | for (const side of ["A", "B"]) {
      | }
      | const scoreA = slots.costA * 10 + timeScale * slots.timeA - slots.qualityWeight * 10 * slots.qualityA;
      | const scoreB = slots.costB * 10 + timeScale * slots.timeB - slots.qualityWeight * 10 * slots.qualityB;
      | const winner = scoreA <= scoreB ? "A" : "B";
      | const winnerScore = winner === "A" ? scoreA : scoreB;
      | const loserScore = winner === "A" ? scoreB : scoreA;
      | probe(winnerScore <= loserScore, "the winning coupled score must not exceed the losing one");
      | probe(Number.isInteger(winnerScore) && Number.isInteger(loserScore), "both coupled scores must be exact in tenths");
      | return "This is intentionally a false-decomposition case. The best formulation is one optimization subproblem, not three independent choices. Configuration " + winner + " wins because the predetermined combined score is " + formatScore(winnerScore) + " versus " + formatScore(loserScore) + ".";

8. a3358e4ec970  freq 20  mean-lines 86.00  freq-x-lines 1720.0  families 4  error-share no holdout program contains this shape  score 0.00
      | const describeCrossDomain = function describeCrossDomain(check) {
      |   if (check.kind === 'distance') {
      |     return `${check.centimetres * check.kilometresPerCentimetre} km.`;
      |   }
      |   if (check.kind === 'time') {
      |     const minutes = check.startHour * 60 + check.startMinute + check.hours * 60;
      |     const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
      |     const minute = String(minutes % 60).padStart(2, '0');
      |     return `${hour}:${minute}.`;
      |   }
      |   if (check.kind === 'quorum') {
      |     return check.present >= check.threshold ? 'quorum is met.' : 'quorum is not met.';
      |   }
      |   if (check.kind === 'reports') {
      |     return `${check.total - check.duplicates} independent reports.`;
      |   }
      |   if (check.kind === 'sheets') {
      |     return `${check.start + check.received} map sheets.`;
      |   }
      |   throw new Error(`Unknown cross-domain check "${check.kind}".`);
      | };
      | const renderCrossDomain = function renderCrossDomain(checks) {
      |   if (checks === null || checks === undefined || checks.length === 0) {
      |     return '';
      |   }
      |   const parts = checks.map((check, index) => {
      |     const label = index === 1 ? 'Mixed-domain answer:' : 'Cross-domain answer:';
      |     return `${label} ${describeCrossDomain(check)}`;
      |   });
      |   return parts.join(' ');
      | };
      | const slots = $slots;
      | let main;
      | if (slots.kind === "balance") {
      |   const locations = slots.locations;
      |   const questions = slots.questions;
      |   let best = questions[0];
      |   for (const question of questions.slice(1)) {
      |     const balance = Math.abs(2 * question.options.length - locations.length);
      |     const bestBalance = Math.abs(2 * best.options.length - locations.length);
      |     if (balance < bestBalance) {
      |       best = question;
      |     }
      |   }
      |   main = best.name + ".";
      | } else if (slots.kind === "robustness") {
      |   const intervals = slots.intervals;
      |   const robust = intervals[0].low > intervals[1].high;
      |   main = robust
      |     ? "Yes; the ranking " + intervals[0].name + ">" + intervals[1].name + " is robust across the stated ranges."
      |     : "No; the ranking is sensitive to the uncertainty.";
      | } else if (slots.kind === "counterexample") {
      |   const towns = slots.towns;
      |   let pair = null;
      |   for (let i = 0; i < towns.length && pair === null; i += 1) {
      |     for (let j = i + 1; j < towns.length && pair === null; j += 1) {
      |       const left = towns[i];
      |       const right = towns[j];
      |       if (left.roads > right.roads && left.minutes >= right.minutes) {
      |         pair = [left.name, right.name];
      |       } else if (right.roads > left.roads && right.minutes >= left.minutes) {
      |         pair = [right.name, left.name];
      |       }
      |     }
      |   }
      |   main = pair === null ? "No; the stated towns agree with the claim." : "Yes. " + pair[0] + " and " + pair[1] + " form a counterexample.";
      | } else if (slots.kind === "causality") {
      |   main = "No. The association alone does not establish that " + slots.cause + " cause " + slots.effect + ".";
      | } else if (slots.kind === "dominance") {
      |   const plans = slots.plans;
      |   const first = plans[0];
      |   const second = plans[1];
      |   const atLeast = (left, right) => left.cost <= right.cost && left.minutes <= right.minutes && left.safety >= right.safety;
      |   const strictlyBetter = (left, right) => left.cost < right.cost || left.minutes < right.minutes || left.safety > right.safety;
      |   if (atLeast(first, second) && strictlyBetter(first, second)) {
      |     main = first.name + " Pareto-dominates " + second.name + ".";
      |   } else if (atLeast(second, first) && strictlyBetter(second, first)) {
      |     main = second.name + " Pareto-dominates " + first.name + ".";
      |   } else {
      |     main = "Neither plan dominates the other.";
      |   }
      | } else {
      |   throw new Error("unknown meta-reasoning criterion: " + slots.kind);
      | }
      | const suffix = renderCrossDomain(slots.crossDomain);
      | return suffix === "" ? main : main + " " + suffix;

9. bf13cb9bcaa7  freq 100  mean-lines 17.00  freq-x-lines 1700.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const optionFields = ["A", "B"];
      | for (const label of optionFields) {
      |   const option = slots["option" + label];
      | }
      | const evaluate = (option) => ({ label: option.label, minutes: option.setupMinutes + Math.ceil(slots.items / option.itemsPerCycle) * 6, costCents: option.fixedCents + option.itemCents * slots.items });
      | const evaluated = [evaluate(slots.optionA), evaluate(slots.optionB)];
      | for (const option of evaluated) {
      |   option.feasible = option.minutes <= slots.limitMinutes && option.costCents <= slots.budgetCents;
      | }
      | const feasible = evaluated.filter((option) => option.feasible);
      | probe(feasible.length > 0, "the scenario asks for a selection, so at least one option must satisfy both shared constraints");
      | const chosen = feasible.reduce((best, option) => (option.costCents < best.costCents ? option : best));
      | probe(chosen.feasible, "the selected option must stay within the stated time limit and cost ceiling");
      | probe(feasible.every((option) => option.costCents >= chosen.costCents), "the selected option must be the cheapest feasible one");
      | probe(feasible.filter((option) => option.costCents === chosen.costCents).length === 1, "the preference rule needs a unique cheapest feasible option");
      | return "Choose Option " + chosen.label + ". The important architecture is “evaluate each option locally, then compare summaries under shared constraints,” rather than interleaving the arithmetic of both options.";

10. cc5bb5765f32  freq 50  mean-lines 34.00  freq-x-lines 1700.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
      | const facts = new Map();
      | for (const fact of slots.observed) {
      |   facts.set(fact.name, fact.value);
      | }
      | const applied = [];
      | let progressed = true;
      | while (progressed) {
      |   progressed = false;
      |   for (const rule of slots.rules) {
      |     if (applied.indexOf(rule.index) !== -1) {
      |       continue;
      |     }
      |     const holds = rule.conditions.every((condition) => facts.get(condition.name) === condition.value);
      |     if (!holds) {
      |       continue;
      |     }
      |     const known = facts.get(rule.conclusion.name);
      |     if (known !== undefined) {
      |       if (known !== rule.conclusion.value) {
      |         throw new Error("rule " + rule.index + " contradicts the known value of " + rule.conclusion.name);
      |       }
      |       continue;
      |     }
      |     facts.set(rule.conclusion.name, rule.conclusion.value);
      |     applied.push(rule.index);
      |     progressed = true;
      |   }
      | }
      | probe(slots.query.every((name) => facts.get(name) !== undefined), "the stated rules must pin down every queried value");
      | probe(applied.indexOf(slots.askedRule) === -1, "the asked rule must not be needed in this family");
      | const conclusions = slots.query.map((name) => name + " must be " + facts.get(name)).join("; ");
      | return conclusions + ". Rule " + slots.askedRule + " is not needed for these " + words[slots.query.length] + " conclusions in this case.";

11. 760a4cbfc8a1  freq 50  mean-lines 33.00  freq-x-lines 1650.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const roundHundredths = (numerator, denominator) => {
      |   let hundredths = Math.floor((numerator * 100) / denominator);
      |   const remainder = (numerator * 100) % denominator;
      |   if (2 * remainder > denominator || (2 * remainder === denominator && hundredths % 2 === 1)) {
      |     hundredths += 1;
      |   }
      |   return hundredths;
      | };
      | const formatHundredths = (hundredths) => {
      |   const whole = Math.floor(hundredths / 100);
      |   const rest = hundredths % 100;
      |   if (rest === 0) { return String(whole); }
      |   return whole + "." + String(rest).padStart(2, "0").replace(/0$/, "");
      | };
      | const expectedWithout = roundHundredths(slots.probabilityPercent * slots.loss, 100);
      | const expectedWith = roundHundredths(slots.protectionCost * 10000 + slots.probabilityPercent * slots.reductionPercent * slots.loss, 10000);
      | const adverseWithout = slots.loss * 100;
      | const adverseWith = slots.protectionCost * 100 + slots.reductionPercent * slots.loss;
      | const limit = slots.riskLimit * 100;
      | const acceptableWithout = adverseWithout <= limit;
      | const acceptableWith = adverseWith <= limit;
      | probe(adverseWith <= adverseWithout, "the protective measure must not increase the adverse-scenario loss");
      | probe(expectedWithout > 0 && expectedWith > 0, "both expected costs must be positive");
      | let justification = "neither option, because both violate the hard risk rule";
      | if (acceptableWithout && acceptableWith) {
      |   justification = expectedWith < expectedWithout ? "the protective measure" : "the option without protection";
      | } else if (acceptableWithout) {
      |   justification = "the option without protection";
      | } else if (acceptableWith) {
      |   justification = "the protective measure";
      | }
      | return "Expected cost without protection: " + formatHundredths(expectedWithout) + " CU; with protection: " + formatHundredths(expectedWith) + " CU. Under the hard risk rule, the justified choice is " + justification + ".";

12. 7119501fd6f3  freq 20  mean-lines 82.00  freq-x-lines 1640.0  families 4  error-share no holdout program contains this shape  score 0.00
      | const describeCrossDomain = function describeCrossDomain(check) {
      |   if (check.kind === 'distance') {
      |     return `${check.centimetres * check.kilometresPerCentimetre} km.`;
      |   }
      |   if (check.kind === 'time') {
      |     const minutes = check.startHour * 60 + check.startMinute + check.hours * 60;
      |     const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
      |     const minute = String(minutes % 60).padStart(2, '0');
      |     return `${hour}:${minute}.`;
      |   }
      |   if (check.kind === 'quorum') {
      |     return check.present >= check.threshold ? 'quorum is met.' : 'quorum is not met.';
      |   }
      |   if (check.kind === 'reports') {
      |     return `${check.total - check.duplicates} independent reports.`;
      |   }
      |   if (check.kind === 'sheets') {
      |     return `${check.start + check.received} map sheets.`;
      |   }
      |   throw new Error(`Unknown cross-domain check "${check.kind}".`);
      | };
      | const renderCrossDomain = function renderCrossDomain(checks) {
      |   if (checks === null || checks === undefined || checks.length === 0) {
      |     return '';
      |   }
      |   const parts = checks.map((check, index) => {
      |     const label = index === 1 ? 'Mixed-domain answer:' : 'Cross-domain answer:';
      |     return `${label} ${describeCrossDomain(check)}`;
      |   });
      |   return parts.join(' ');
      | };
      | const slots = $slots;
      | const holds = (order) => {
      |   const position = new Map(slots.plots.map((plot, index) => [order[index], index]));
      |   const last = slots.plots.length - 1;
      |   for (const [left, right] of slots.forbidden) {
      |     if (Math.abs(position.get(left) - position.get(right)) === 1) {
      |       return false;
      |     }
      |   }
      |   for (const [left, right] of slots.adjacent) {
      |     if (Math.abs(position.get(left) - position.get(right)) !== 1) {
      |       return false;
      |     }
      |   }
      |   for (const use of slots.ends) {
      |     const index = position.get(use);
      |     if (index !== 0 && index !== last) {
      |       return false;
      |     }
      |   }
      |   return true;
      | };
      | const valid = [];
      | const order = [];
      | const used = new Set();
      | const place = (index) => {
      |   if (index === slots.plots.length) {
      |     if (holds(order)) {
      |       valid.push(order.slice());
      |     }
      |     return;
      |   }
      |   for (const use of slots.uses) {
      |     if (used.has(use)) {
      |       continue;
      |     }
      |     used.add(use);
      |     order.push(use);
      |     place(index + 1);
      |     order.pop();
      |     used.delete(use);
      |   }
      | };
      | place(0);
      | probe(valid.length > 0, "the stated constraints must leave at least one valid assignment");
      | const chosen = valid[(slots.caseNumber - 1) % valid.length];
      | probe(chosen.length === slots.plots.length && new Set(chosen).size === slots.uses.length, "the assignment must place every use exactly once");
      | probe(holds(chosen), "the assignment must satisfy every stated constraint");
      | const main = slots.plots.map((plot, index) => plot + "=" + chosen[index]).join(", ") + " is a valid assignment.";
      | const suffix = renderCrossDomain(slots.crossDomain);
      | return suffix === "" ? main : main + " " + suffix;

13. 64fd18424389  freq 20  mean-lines 81.00  freq-x-lines 1620.0  families 4  error-share no holdout program contains this shape  score 0.00
      | const describeCrossDomain = function describeCrossDomain(check) {
      |   if (check.kind === 'distance') {
      |     return `${check.centimetres * check.kilometresPerCentimetre} km.`;
      |   }
      |   if (check.kind === 'time') {
      |     const minutes = check.startHour * 60 + check.startMinute + check.hours * 60;
      |     const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
      |     const minute = String(minutes % 60).padStart(2, '0');
      |     return `${hour}:${minute}.`;
      |   }
      |   if (check.kind === 'quorum') {
      |     return check.present >= check.threshold ? 'quorum is met.' : 'quorum is not met.';
      |   }
      |   if (check.kind === 'reports') {
      |     return `${check.total - check.duplicates} independent reports.`;
      |   }
      |   if (check.kind === 'sheets') {
      |     return `${check.start + check.received} map sheets.`;
      |   }
      |   throw new Error(`Unknown cross-domain check "${check.kind}".`);
      | };
      | const renderCrossDomain = function renderCrossDomain(checks) {
      |   if (checks === null || checks === undefined || checks.length === 0) {
      |     return '';
      |   }
      |   const parts = checks.map((check, index) => {
      |     const label = index === 1 ? 'Mixed-domain answer:' : 'Cross-domain answer:';
      |     return `${label} ${describeCrossDomain(check)}`;
      |   });
      |   return parts.join(' ');
      | };
      | const slots = $slots;
      | const names = { flooding: "flooding", "road closure": "road closure", warning: "a warning", "field muddy": "the field becomes muddy", "bus rerouting": "bus rerouting" };
      | const nameOf = (key) => { const name = names[key]; if (name === undefined) { throw new Error("unknown consequence " + key); } return name; };
      | const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
      | const joinList = (items) => items.length === 1 ? items[0] : items.length === 2 ? items[0] + " and " + items[1] : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
      | const trueKeys = new Set(slots.facts.filter((fact) => fact.positive).map((fact) => fact.key));
      | const falseKeys = new Set(slots.facts.filter((fact) => !fact.positive).map((fact) => fact.key));
      | const derived = [];
      | const derivedKeys = new Set();
      | const holds = (condition) => condition.positive ? trueKeys.has(condition.key) || derivedKeys.has(condition.key) : falseKeys.has(condition.key);
      | let changed = true;
      | while (changed) {
      |   changed = false;
      |   for (const rule of slots.rules) {
      |     if (trueKeys.has(rule.consequent) || derivedKeys.has(rule.consequent)) {
      |       continue;
      |     }
      |     const satisfied = rule.connector === "OR" ? rule.conditions.some(holds) : rule.conditions.every(holds);
      |     if (satisfied) {
      |       derived.push(rule.consequent);
      |       derivedKeys.add(rule.consequent);
      |       changed = true;
      |     }
      |   }
      | }
      | probe(derived.length > 0, "at least one rule must fire on the given facts");
      | const heads = slots.rules.map((rule) => rule.consequent);
      | const givenHeads = heads.filter((head) => trueKeys.has(head));
      | const missingHeads = heads.filter((head) => !trueKeys.has(head) && !derivedKeys.has(head));
      | const deduced = capitalize(joinList(derived.map(nameOf)));
      | let main;
      | if (givenHeads.length > 0) {
      |   main = deduced + " can be deduced; " + nameOf(givenHeads[0]) + " is already given as a fact.";
      | } else if (slots.rules.some((rule) => rule.connector === "OR")) {
      |   const clauses = derived.map((key) => key === "warning" ? "the warning follows from the working siren" : capitalize(nameOf(key)));
      |   main = clauses.slice(0, -1).join(", ") + (clauses.length === 1 ? "" : ", and ") + clauses[clauses.length - 1] + ".";
      | } else if (missingHeads.length > 0) {
      |   main = deduced + " can be deduced, but " + joinList(missingHeads.map(nameOf)) + " cannot be deduced.";
      | } else {
      |   let chain = true;
      |   for (let index = 1; index < derived.length; index += 1) {
      |     const rule = slots.rules.filter((candidate) => candidate.consequent === derived[index])[0];
      |     if (!rule.conditions.some((condition) => derived.slice(0, index).includes(condition.key))) {
      |       chain = false;
      |     }
      |   }
      |   main = deduced + " can" + (chain ? " all" : "") + " be deduced.";
      | }
      | const suffix = renderCrossDomain(slots.crossDomain);
      | return suffix === "" ? main : main + " " + suffix;

14. 91c7330ff77d  freq 100  mean-lines 16.00  freq-x-lines 1600.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const formatTenths = (tenths) => Math.floor(tenths / 10) + "." + (tenths % 10);
      | for (const side of ["A", "B"]) {
      | }
      | const scaled = slots.demand * (100 + slots.errorPercent) * (100 + slots.marginPercent);
      | const requirementTenths = Math.floor((scaled + 500) / 1000);
      | probe(requirementTenths > slots.demand * 10, "the robust requirement must exceed the average forecast");
      | const options = [
      |   { label: "A", capacity: slots.capacityA, cost: slots.costA },
      |   { label: "B", capacity: slots.capacityB, cost: slots.costB }
      | ];
      | const feasible = options.filter((option) => option.capacity * 10 >= requirementTenths);
      | probe(feasible.length > 0, "at least one stated option must reach the robust requirement");
      | const chosen = feasible.reduce((best, option) => (option.cost < best.cost ? option : best));
      | probe(feasible.every((option) => option.cost >= chosen.cost), "the chosen option must have the lowest cost among the feasible ones");
      | return "The robust capacity requirement is " + formatTenths(requirementTenths) + ", and Option " + chosen.label + " is the lowest-cost option that meets it. The uncertainty interval and safety policy are separate transformations, which prevents double-counting the margin.";

15. b17aa3c5c3a5  freq 50  mean-lines 31.00  freq-x-lines 1550.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const start = {};
      | const finish = {};
      | const scheduled = [];
      | const remaining = slots.order.slice();
      | while (remaining.length > 0) {
      |   const ready = remaining.filter((name) => slots.prerequisites[name].every((prerequisite) => scheduled.indexOf(prerequisite) !== -1));
      |   if (ready.length === 0) {
      |     throw new Error("the stated prerequisites contain a cycle, so no schedule exists");
      |   }
      |   for (const name of ready) {
      |     const prerequisites = slots.prerequisites[name];
      |     start[name] = prerequisites.length === 0 ? 0 : Math.max(...prerequisites.map((prerequisite) => finish[prerequisite]));
      |     finish[name] = start[name] + slots.durations[name];
      |     scheduled.push(name);
      |     remaining.splice(remaining.indexOf(name), 1);
      |   }
      | }
      | const last = scheduled.reduce((best, name) => (finish[name] > finish[best] ? name : best));
      | probe(finish[last] > 0, "the project must have a positive duration");
      | const chain = [last];
      | let task = last;
      | while (slots.prerequisites[task].length > 0) {
      |   const binding = slots.prerequisites[task].find((prerequisite) => finish[prerequisite] === start[task]);
      |   if (binding === undefined) {
      |     throw new Error("no stated prerequisite of task " + task + " fixes its start time");
      |   }
      |   chain.unshift(binding);
      |   task = binding;
      | }
      | return "The minimum duration is " + finish[last] + " " + slots.unit + "s. One critical chain is " + chain.join("\u2013") + ".";

16. 41ee0c8484d5  freq 50  mean-lines 29.00  freq-x-lines 1450.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const names = ["A", "B", "C"];
      | const depth = slots.programs.A.length;
      | const totalOf = (taken) => names.reduce((sum, name) => sum + slots.programs[name].slice(0, taken[name]).reduce((left, right) => left + right, 0), 0);
      | let best = null;
      | let optima = 0;
      | let allocation = null;
      | for (let a = 0; a <= slots.units; a += 1) {
      |   for (let b = 0; a + b <= slots.units; b += 1) {
      |     const taken = { A: a, B: b, C: slots.units - a - b };
      |     if (names.some((name) => taken[name] > depth)) {
      |       continue;
      |     }
      |     const value = totalOf(taken);
      |     if (best === null || value > best) {
      |       best = value;
      |       optima = 1;
      |       allocation = taken;
      |     } else if (value === best) {
      |       optima += 1;
      |     }
      |   }
      | }
      | probe(allocation !== null, "at least one allocation of the stated units must be feasible");
      | probe(best > 0, "the optimal allocation must have a positive total benefit");
      | const chosen = "A=" + allocation.A + ", B=" + allocation.B + ", C=" + allocation.C;
      | return optima === 1
      |   ? chosen + "; maximum total benefit = " + best + " points."
      |   : "One optimal allocation is " + chosen + ", with " + best + " points. There are " + optima + " tied optimal allocations.";

17. d100a5677177  freq 50  mean-lines 29.00  freq-x-lines 1450.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const scenarioCount = slots.scenarios.length;
      | let probabilitySum = 0;
      | for (const probability of slots.probabilities) {
      |   probabilitySum += probability;
      | }
      | const labels = [];
      | const hundredths = {};
      | const minimums = {};
      | for (const strategy of slots.strategies) {
      |   let total = 0;
      |   for (let index = 0; index < scenarioCount; index += 1) {
      |     const outcome = strategy.outcomes[index];
      |     total += slots.probabilities[index] * outcome;
      |   }
      |   hundredths[strategy.label] = total;
      |   minimums[strategy.label] = Math.min(...strategy.outcomes);
      |   labels.push(strategy.label);
      | }
      | const acceptable = labels.filter((label) => minimums[label] >= slots.threshold);
      | const bestMean = acceptable.length === 0 ? 0 : Math.max(...acceptable.map((label) => hundredths[label]));
      | const winner = acceptable.find((label) => hundredths[label] === bestMean);
      | probe(acceptable.length === 0 || winner !== undefined, "the acceptable strategies must attain a largest weighted mean");
      | const format = (value) => {
      |   const tenths = Math.floor(value / 10);
      |   return Math.floor(tenths / 10) + "." + (tenths % 10);
      | };
      | const means = labels.map((label) => label + "=" + format(hundredths[label])).join(", ");
      | return "Weighted means: " + means + ". After the robustness threshold, the choice is " + (winner === undefined ? "none of the strategies" : winner) + ".";

18. 2b319bc23bc6  freq 80  mean-lines 17.00  freq-x-lines 1360.0  families 2  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const values = slots.values;
      | let current = values;
      | // stage 1: keepBelow
      | const kept0 = current.filter((value) => value < slots.threshold);
      | current = kept0;
      | // stage 2: total
      | const total1 = current.reduce((sum, value) => sum + value, 0);
      | current = total1;
      | // stage 3: perUnit
      | const scaled2 = current * slots.perUnit;
      | current = scaled2;
      | // stage 4: subtractRate
      | const adjusted3 = current - slots.rate;
      | current = adjusted3;
      | probe(Number.isInteger(current) && current >= 0, "the answer must be a whole number that is not negative");
      | return current + " units.";

19. ac151f688068  freq 50  mean-lines 27.00  freq-x-lines 1350.0  families 1  error-share no holdout program contains this shape  score 0.00
      | const slots = $slots;
      | const scale = slots.scale;
      | const criteria = slots.weights.length;
      | let weightSum = 0;
      | for (const weight of slots.weights) {
      |   weightSum += weight.percent;
      | }
      | const labels = [];
      | const hundredths = {};
      | for (const option of slots.options) {
      |   let total = 0;
      |   for (let index = 0; index < criteria; index += 1) {
      |     const score = option.scores[index];
      |     total += slots.weights[index].percent * score;
      |   }
      |   hundredths[option.label] = total;
      |   labels.push(option.label);
      | }
      | const maximum = Math.max(...labels.map((label) => hundredths[label]));
      | const winners = labels.filter((label) => hundredths[label] === maximum);
      | probe(winners.length > 0, "the weighted scores must attain a maximum");
      | const format = (value) => {
      |   const whole = Math.floor(value / 100);
      |   const fraction = value % 100;
      |   return whole + "." + (fraction < 10 ? "0" + fraction : String(fraction));
      | };
      | return "Scores: " + labels.map((label) => label + "=" + format(hundredths[label])).join(", ") + ". Winner(s) under these weights: " + winners.join(", ") + ".";

20. b63958b81cdb  freq 20  mean-lines 66.00  freq-x-lines 1320.0  families 4  error-share no holdout program contains this shape  score 0.00
      | const describeCrossDomain = function describeCrossDomain(check) {
      |   if (check.kind === 'distance') {
      |     return `${check.centimetres * check.kilometresPerCentimetre} km.`;
      |   }
      |   if (check.kind === 'time') {
      |     const minutes = check.startHour * 60 + check.startMinute + check.hours * 60;
      |     const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
      |     const minute = String(minutes % 60).padStart(2, '0');
      |     return `${hour}:${minute}.`;
      |   }
      |   if (check.kind === 'quorum') {
      |     return check.present >= check.threshold ? 'quorum is met.' : 'quorum is not met.';
      |   }
      |   if (check.kind === 'reports') {
      |     return `${check.total - check.duplicates} independent reports.`;
      |   }
      |   if (check.kind === 'sheets') {
      |     return `${check.start + check.received} map sheets.`;
      |   }
      |   throw new Error(`Unknown cross-domain check "${check.kind}".`);
      | };
      | const renderCrossDomain = function renderCrossDomain(checks) {
      |   if (checks === null || checks === undefined || checks.length === 0) {
      |     return '';
      |   }
      |   const parts = checks.map((check, index) => {
      |     const label = index === 1 ? 'Mixed-domain answer:' : 'Cross-domain answer:';
      |     return `${label} ${describeCrossDomain(check)}`;
      |   });
      |   return parts.join(' ');
      | };
      | const slots = $slots;
      | const parent = new Map(slots.pairs.map((pair) => [pair.inner, pair.outer]));
      | const chainOf = (start) => {
      |   const chain = [];
      |   const seen = new Set([start]);
      |   let node = start;
      |   while (parent.has(node)) {
      |     node = parent.get(node);
      |     if (seen.has(node)) {
      |       break;
      |     }
      |     seen.add(node);
      |     chain.push(node);
      |   }
      |   return chain;
      | };
      | const contains = (inner, outer) => chainOf(inner).indexOf(outer) >= 0;
      | const listPhrase = (items) => items.length === 1 ? items[0] : items.length === 2 ? items[0] + " and " + items[1] : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
      | const question = slots.question;
      | let main;
      | if (question.kind === "membership") {
      |   probe(contains(question.subject, question.object), "the asked membership must follow from the stated containment");
      |   main = "Yes, " + question.subject + " is in " + question.object + ".";
      | } else if (question.kind === "reversal") {
      |   probe(contains(question.object, question.subject), "the reversed question must reverse a containment the facts state");
      |   main = "No. The containment relation cannot be reversed.";
      | } else if (question.kind === "ancestors") {
      |   const chain = chainOf(question.subject);
      |   probe(chain.length > 0, "the facts must state a larger unit for the asked place");
      |   main = listPhrase(chain) + ".";
      | } else {
      |   main = "No. Country membership alone is insufficient to identify the region.";
      | }
      | const suffix = renderCrossDomain(slots.crossDomain);
      | return suffix === "" ? main : main + " " + suffix;

line-cost map (procedural generator transcription):
  one-line jsEval operators: 20
    keepAbove, keepBelow, total, count, largest, smallest, double, perUnit, addRate, subtractRate, keepDivisibleBy, modulo, ratioPer, percentOf, discount, nthLargest, uniqueCount, squareArea, elapsed, rectangleArea
  declarative operators (already a wire): 3
    pathExists -> graphPath (3 fields)
    neighbourCount -> graphPath (3 fields)
    probability -> fraction (2 fields)

validation gate (adoption requires the family round-trip/oracle tests AND `node training-data/verify.mjs`):
  top-20 shapes admitted to that gate on line-reduction evidence (multi-line AND recurring): 20
    f04c09f7493a  freq 100  mean-lines 33.00  families 1
    dc99299c2b18  freq 80  mean-lines 37.00  families 2
    19cf8bac2024  freq 120  mean-lines 17.00  families 3
    86f7df7a0328  freq 100  mean-lines 20.00  families 1
    dbdc358c7e07  freq 100  mean-lines 20.00  families 1
    39466edac790  freq 20  mean-lines 93.00  families 4
    7eb1c949d199  freq 100  mean-lines 18.00  families 1
    a3358e4ec970  freq 20  mean-lines 86.00  families 4
    bf13cb9bcaa7  freq 100  mean-lines 17.00  families 1
    cc5bb5765f32  freq 50  mean-lines 34.00  families 1
    760a4cbfc8a1  freq 50  mean-lines 33.00  families 1
    7119501fd6f3  freq 20  mean-lines 82.00  families 4
    64fd18424389  freq 20  mean-lines 81.00  families 4
    91c7330ff77d  freq 100  mean-lines 16.00  families 1
    b17aa3c5c3a5  freq 50  mean-lines 31.00  families 1
    41ee0c8484d5  freq 50  mean-lines 29.00  families 1
    d100a5677177  freq 50  mean-lines 29.00  families 1
    2b319bc23bc6  freq 80  mean-lines 17.00  families 2
    ac151f688068  freq 50  mean-lines 27.00  families 1
    b63958b81cdb  freq 20  mean-lines 66.00  families 4
  top-20 shapes below the proposal bar (single-line or rare): 0
  note: error-share is 0 for every shape in this run (see correlation finding above), so no candidate carries mistake-reduction evidence yet; admission rests on line reduction alone.
