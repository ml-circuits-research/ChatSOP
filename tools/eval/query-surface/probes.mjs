/**
 * Authored probe questions for the query forms the corpora do not contain (why_not, plan, abduce, conform, procedure,
 * what-if, "at any point" overlaps, comparison on an attribute with a unit). They are written by hand with
 * their own words (neither dataset rows nor natural rows) and give the rules a form to be developed against
 * (AGENTS.md rule 9: forms, not rows). `form` names the form each probe belongs to; `mode` is the expected query mode.
 * tests/query-forms.test.mjs replays recorded parses of these (tests/fixtures/query-forms/parses.json).
 */
export const PROBES = [
  // why_not: a modal-negative "why", or what blocks / is missing
  {form: 'why_not', mode: 'why_not', message: "Why can't I hard-reset the router?"},
  {form: 'why_not', mode: 'why_not', message: "Why can't Ana access the billing portal?"},
  {form: 'why_not', mode: 'why_not', message: "Why couldn't Marta book a room for Friday?"},
  {form: 'why_not', mode: 'why_not', message: "Why isn't Ana allowed to approve the budget?"},
  {form: 'why_not', mode: 'why_not', message: 'Why cannot the invoice be approved?'},
  {form: 'why_not', mode: 'why_not', message: 'What is stopping Ana from joining the project?'},
  {form: 'why_not', mode: 'why_not', message: 'What prevents the deployment from finishing?'},
  {form: 'why_not', mode: 'why_not', message: 'What is missing for the invoice to be approved?'},
  {form: 'why_not', mode: 'why_not', message: 'What would it take for Ana to join the lab?'},
  // plan: how do I / what are the steps
  {form: 'plan', mode: 'plan', message: 'How do I reset the router?'},
  {form: 'plan', mode: 'plan', message: 'How can we get access to the lab?'},
  {form: 'plan', mode: 'plan', message: 'How should I register for the exam?'},
  {form: 'plan', mode: 'plan', message: 'How to deploy the service?'},
  {form: 'plan', mode: 'plan', message: 'What are the steps to reset the router?'},
  {form: 'plan', mode: 'plan', message: 'What do I need to do to get a refund?'},
  {form: 'plan', mode: 'plan', message: 'What should we do to renew the licence?'},
  {form: 'plan', mode: 'plan', message: 'How could one cancel the subscription?'},
  // abduce: what could explain an observation
  {form: 'abduce', mode: 'abduce', message: 'What could explain the outage?'},
  {form: 'abduce', mode: 'abduce', message: 'What might have caused the delay?'},
  {form: 'abduce', mode: 'abduce', message: 'What could be the cause of the fever?'},
  {form: 'abduce', mode: 'abduce', message: 'Which fault would account for the alarm?'},
  {form: 'abduce', mode: 'abduce', message: 'What may be behind the failure of the pump?'},
  // procedure
  {form: 'procedure', mode: 'procedure', message: 'What is the procedure for resetting the router?'},
  {form: 'procedure', mode: 'procedure', message: 'What is the reset procedure?'},
  {form: 'procedure', mode: 'procedure', message: 'What is the process for approving an invoice?'},
  {form: 'procedure', mode: 'procedure', message: 'What is the onboarding protocol for new hires?'},
  // conform
  {form: 'conform', mode: 'conform', message: 'Did we follow the reset procedure?'},
  {form: 'conform', mode: 'conform', message: 'Was the reset compliant?'},
  {form: 'conform', mode: 'conform', message: 'Is the deployment compliant with the policy?'},
  {form: 'conform', mode: 'conform', message: 'Did Ana comply with the approval process?'},
  {form: 'conform', mode: 'conform', message: 'Was the procedure followed?'},
  // what-if
  {form: 'what_if', mode: 'select', message: 'What if Ana leaves the lab, who runs it?'},
  {form: 'what_if', mode: null, message: 'If the router is reset, does the alarm stop?'},
  {form: 'what_if', mode: null, message: 'What would happen if Ana left the lab?'},
  // temporal overlaps and ranges
  {form: 'temporal', mode: null, message: 'Did Ana work at Alpha Lab at any point in 2025?'},
  {form: 'temporal', mode: null, message: 'Who worked at Alpha Lab during 2025?'},
  // comparison on an attribute with a unit
  {form: 'comparative', mode: 'exists', message: 'Does the cottage cost more than 30000 lei?'},
  {form: 'comparative', mode: 'exists', message: 'Does the studio cost at least 8000 lei?'},
  {form: 'comparative', mode: null, message: 'Which team has the fewest players?'},
  {form: 'comparative', mode: null, message: 'Who is older than Ion?'},
  // quantified
  {form: 'quantified', mode: 'every', message: 'Which teams have only certified players?'},
  {form: 'quantified', mode: null, message: 'Is any player of Rapid older than 40?'},
  {form: 'quantified', mode: null, message: 'Does Ana both work at Alpha Lab and live in Cluj?'},
  // negated questions
  {form: 'negated', mode: null, message: "Doesn't Ana work at Alpha Lab?"},
  {form: 'negated', mode: null, message: "Isn't Ion a member of the choir?"},
  {form: 'negated', mode: null, message: "Who doesn't work at Alpha Lab?"},
];
