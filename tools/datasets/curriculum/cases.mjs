// Synthetic scenarios are test problems, NOT reviewed source knowledge or training gold.
// Every case has an independent oracle input; the SOP renderer never computes its answer.
export const REVISION = 'query-curriculum-synthetic-1';
export const NOW = '2026-09-26T12:00:00Z';
export const blockedFamilies = [
  { family: 'abduction', reason: 'Explanations are hypotheses, not established facts; requires separately judged abductive targets.' },
  { family: 'default_exception', reason: 'No reviewed defeasible microtheory; hard Horn implications would over-infer.' },
  { family: 'counterfactual', reason: 'Interventions need separately judged simulation worlds, not hard logical gold.' },
  { family: 'planning', reason: 'No approved action model and goal criterion in this corpus.' },
  { family: 'causal', reason: 'Coincidence and temporal order do not establish causal rules.' },
  { family: 'agentive_intention', reason: 'Knowing, intending and wanting cannot be inferred from observed actions.' },
  { family: 'general_quantification', reason: 'Closed-world universals are not implied by a finite open-world fact list.' },
];
const f = (text, atom, valid = 'timeless') => ({ text, atom, valid });
export const approvedTemplates = {
  check_arrival: [
    '@check_arrival template',
    '  description "Recuperează durata rutei și calculează sosirea într-o zi, în minute de la miezul nopții."',
    '  cue "sosire"',
    '  cue "ajung"',
    '  params route start deadline',
    '  yield answer',
    '  body |',
    '    @travel query',
    '      select ?duration',
    '      where duration($route, ?duration)',
    '    @retrieve_duration solve',
    '      query $travel',
    '      output ?duration one',
    '    @timing constraint',
    '      var ?arrival int 0 1440',
    '      require ?arrival == $start + $duration',
    '      claim ?arrival <= $deadline',
    '      task possible',
    '      unit minute',
    '    @feasibility solve',
    '      constraint $timing',
    '      output ?arrival one',
    '    @answer cnl',
    '      result $feasibility',
    '      language ro',
    '',
  ].join('\n'),
};
export const assumptions = [
  { id:'assume_uncontested', world:'assumption_open', family:'assumption_boundary', operators:['assume','defeasible_rule','ground'], where:'connected(room_a, room_b)', guess:'door_open(room_a, room_b)', defeated:false, en:['If no record denies it, is the door between rooms A and B open, and does that make the rooms connected?', 'Assume the A–B door is open unless a record says otherwise; check connectivity between the two rooms.', 'Check whether rooms A and B are connected when the door state is only a guess.'] },
  { id:'assume_defeated', world:'assumption_blocked', family:'assumption_boundary', operators:['assume','explicit_negation','defeasible_rule','ground'], where:'connected(room_a, room_b)', guess:'door_open(room_a, room_b)', defeated:true, en:['The record states the A–B door is not open; can the open-door assumption still connect the rooms?', 'Check the connectivity claim when an explicit record denies the assumed door state.', 'With the door recorded as closed, does guessing it open support the connection?'] },
];
export const worlds = [
  { id:'assumption_open', split:'train', domain:'robot navigation', facts:[
  ], rules:[{ id:'doorRule', when:['door_open(?x, ?y)'], then:'connected(?x, ?y)' }] },
  { id:'assumption_blocked', split:'train', domain:'robot navigation', facts:[
    f('The door between rooms A and B is not open.', 'not door_open(room_a, room_b)'),
  ], rules:[{ id:'doorRule', when:['door_open(?x, ?y)'], then:'connected(?x, ?y)' }] },
  { id:'family_train', split:'train', domain:'family records', facts:[
    f('Ana is a parent of Bogdan.', 'parent(ana, bogdan)'),
    f('Bogdan is a parent of Carina.', 'parent(bogdan, carina)'),
    f('Maria is a parent of Carina.', 'parent(maria, carina)'),
    f('Carina is not a parent of Ana.', 'not parent(carina, ana)'),
  ], rules:[{ id:'grandparentRule', when:['parent(?x, ?y)','parent(?y, ?z)'], then:'grandparent(?x, ?z)' }] },
  { id:'family_dev', split:'dev', domain:'family records', facts:[
    f('Maria is a parent of Bogdan.', 'parent(maria, bogdan)'),
    f('Bogdan is a parent of Ana.', 'parent(bogdan, ana)'),
    f('Carina is a parent of Ana.', 'parent(carina, ana)'),
    f('Maria is not a parent of Bogdan.', 'not parent(maria, bogdan)'),
  ], rules:[{ id:'grandparentRule', when:['parent(?x, ?y)','parent(?y, ?z)'], then:'grandparent(?x, ?z)' }] },
  { id:'family_test', split:'test', domain:'family records', facts:[
    f('Ana is a parent of Carina.', 'parent(ana, carina)'),
    f('Carina is a parent of Maria.', 'parent(carina, maria)'),
    f('Bogdan is a parent of Maria.', 'parent(bogdan, maria)'),
    f('Bogdan is not a parent of Maria.', 'not parent(bogdan, maria)'),
  ], rules:[{ id:'grandparentRule', when:['parent(?x, ?y)','parent(?y, ?z)'], then:'grandparent(?x, ?z)' }] },
  { id:'employment_train', split:'train', domain:'employment and projects', facts:[
    f('Maria works at Alpha Lab.', 'works_at(maria, lab_alpha)'),
    f('Ana works at Beta Lab.', 'works_at(ana, lab_beta)'),
    f('Bogdan is employed by Alpha Lab.', 'employed_by(bogdan, lab_alpha)'),
    f('Maria is a member of Delta Project.', 'project_member(maria, project_delta)'),
    f('Ana is not employed by Alpha Lab.', 'not employed_by(ana, lab_alpha)'),
  ], rules:[] },
  { id:'employment_test', split:'test', domain:'employment and projects', facts:[
    f('Ana works at Alpha Lab.', 'works_at(ana, lab_alpha)'),
    f('Bogdan works at Beta Lab.', 'works_at(bogdan, lab_beta)'),
    f('Carina is employed by Beta Lab.', 'employed_by(carina, lab_beta)'),
    f('Ana is a member of Delta Project.', 'project_member(ana, project_delta)'),
  ], rules:[] },
  { id:'temporal_train', split:'train', domain:'dated personnel records', facts:[
    f('Maria worked at Alpha Lab from 2024-01-01 until 2025-06-01.', 'works_at(maria, lab_alpha)', '2024-01-01 2025-06-01'),
    f('Maria did not work at Alpha Lab from 2025-06-01 until 2026-09-27.', 'not works_at(maria, lab_alpha)', '2025-06-01 2026-09-27'),
    f('Ana works at Beta Lab starting 2025-01-01.', 'works_at(ana, lab_beta)', '2025-01-01 open'),
  ], rules:[] },
  { id:'temporal_dev', split:'dev', domain:'dated personnel records', facts:[
    f('Bogdan worked at Beta Lab from 2024-03-01 until 2025-04-01.', 'works_at(bogdan, lab_beta)', '2024-03-01 2025-04-01'),
    f('Carina works at Alpha Lab starting 2025-04-01.', 'works_at(carina, lab_alpha)', '2025-04-01 open'),
  ], rules:[] },
  { id:'route_dev', split:'dev', domain:'route timing', facts:[
    f('The Alpha Lab route takes 70 minutes.', 'duration(route_demo, 70)'),
  ], rules:[], procedures:['check_arrival'] },
  { id:'incident_test', split:'test', domain:'incident observations', facts:[
    f('The network is down at Alpha Lab.', 'network_down(lab_alpha)'),
    f('The disk at Beta Lab is full.', 'disk_full(lab_beta)'),
    f('The Alpha Lab network is not down.', 'not network_down(lab_alpha)'),
  ], rules:[] },
];

// Split/holdout assignments are fixed here, before adding EN/RO surfaces.
// `negativeOf` points to the ID of a paired question in the same world.
export const cases = [
  { id:'parent_forward', world:'family_train', family:'relation_role', operators:['binary','ground'], where:['parent(ana, bogdan)'], en:['Is Ana a parent of Bogdan?', 'Does the record name Ana as Bogdan’s parent?', 'Check whether Bogdan has Ana as a parent.'] },
  { id:'parent_reversed', world:'family_train', family:'relation_role', operators:['binary','argument_reversal'], negativeOf:'parent_forward', where:['parent(bogdan, ana)'], en:['Is Bogdan a parent of Ana?', 'Does the record name Bogdan as Ana’s parent?', 'Check whether Ana has Bogdan as a parent.'] },
  { id:'parent_inverse_select', world:'family_train', family:'relation_role', operators:['binary','role_inversion','select'], select:['?who'], where:['parent(?who, carina)'], en:['Who is a parent of Carina?', 'Name Carina’s recorded parents.', 'For Carina, which people occur in the parent role?'], ro:'Cine sunt părinții Carinei?' },
  { id:'child_inverse_select', world:'family_train', family:'relation_role', operators:['binary','role_inversion','select'], select:['?child'], where:['parent(ana, ?child)'], en:['Who has Ana as a parent?', 'List Ana’s recorded children.', 'For which person is Ana in the parent role?'] },
  {id:'negative_explicit', world:'family_train', family:'negation_openworld', operators:['explicit_negation','ground'], where:['parent(carina, ana)'], en:['Is Carina a parent of Ana?', 'Check whether Carina is recorded as Ana’s parent.', 'Does the record support Carina parenting Ana?']},
  { id:'negative_assertion_direct', world:'family_train', family:'negation_openworld', operators:['explicit_negation','negative_query'], negativeOf:'negative_explicit', where:['not parent(carina, ana)'], en:['Is it explicitly recorded that Carina is not Ana’s parent?', 'Does the negative parent claim about Carina and Ana have support?', 'Check the assertion that Carina does not parent Ana.'], ro:'Există dovadă explicită că Carina nu este părintele Anei?' },
  { id:'unknown_absent', world:'family_train', family:'negation_openworld', operators:['open_world','ground'], where:['parent(maria, ana)'], en:['Is Maria a parent of Ana?', 'Does the record establish that Maria parents Ana?', 'Check Maria’s parent relation to Ana.'] },
  { id:'grandparent_ground', world:'family_train', family:'multi_hop', operators:['two_hop','approved_rule'], where:['grandparent(ana, carina)'], en:['Is Ana a grandparent of Carina?', 'Does a two-generation parent chain connect Ana to Carina?', 'Check Ana’s grandparent relation to Carina.'], ro:'Este Ana bunica sau bunicul Carinei?' },
  { id:'conjunction_ground', world:'family_train', family:'conjunction_join', operators:['and','shared_variable'], where:['parent(ana, bogdan)','parent(bogdan, carina)'], en:['Are both Ana parent to Bogdan and Bogdan parent to Carina?', 'Check the two links Ana–Bogdan and Bogdan–Carina together.', 'Does the stated two-link parent chain hold?'] },
  { id: 'multi_hop_inverse', world:'family_dev', family:'multi_hop', operators:['two_hop','select'], holdout: 'reasoning_world', select:['?elder'], where:['grandparent(?elder, ana)'], en:['Who is a grandparent of Ana?', 'Name the person two parent links above Ana.', 'Which recorded person is Ana’s grandparent?'] },
  { id:'join_pairs', world:'family_dev', family:'conjunction_join', operators:['and','shared_variable','select_multiple'], holdout:'composition', select:['?older','?younger'], where:['parent(?older, ?middle)','parent(?middle, ?younger)'], en:['List every grandparent–grandchild pair via a common parent.', 'Which older and younger people share a two-link parent chain?', 'Return each pair at the ends of an explicit parent-parent path.'] },
  {id:'conflicted_parent', world:'family_dev', family:'negation_openworld', operators:['explicit_negation','conflict'], where:['parent(maria, bogdan)'], en:['Is Maria a parent of Bogdan, given the conflicting records?', 'What does the evidence say about Maria parenting Bogdan?', 'Check the parent claim for Maria and Bogdan without discarding either record.'], ro:'Este Maria părintele lui Bogdan, având dovezi contradictorii?'},
  { id:'conflict_negative_direct', world:'family_dev', family:'negation_openworld', operators:['negative_query','conflict'], negativeOf:'conflicted_parent', where:['not parent(maria, bogdan)'], en:['Is Maria explicitly recorded as not parenting Bogdan despite the positive record?', 'What is the status of the negated parent claim for Maria and Bogdan?', 'Check whether the contrary assertion, Maria is not Bogdan’s parent, has evidence.'] },
  { id:'conflict_no_explosion', world:'family_dev', family:'negation_openworld', operators:['conflict','open_world'], where:['parent(ana, maria)'], en:['Do the conflicting records establish that Ana parents Maria?', 'Is Ana a parent of Maria in these records?', 'Check the unrelated Ana–Maria parent claim.'] },
  {id:'test_chain', world:'family_test', family:'multi_hop', operators:['two_hop','role_inversion'], holdout: 'world', where:['grandparent(ana, maria)'], en:['Is Ana a grandparent of Maria?', 'Trace whether a parent-of-parent chain goes from Ana to Maria.', 'Check Ana’s two-generation relation to Maria.']},
  { id: 'test_reversed_chain', world:'family_test', family:'multi_hop', operators:['two_hop','argument_reversal'], holdout: 'world', negativeOf:'test_chain', where:['grandparent(maria, ana)'], en:['Is Maria a grandparent of Ana?', 'Trace whether a parent-of-parent chain goes from Maria to Ana.', 'Check Maria’s two-generation relation to Ana.'] },
  { id:'test_join_pairs', world:'family_test', family:'conjunction_join', operators:['and','shared_variable','select_multiple'], holdout:'composition', select:['?older','?younger'], where:['parent(?older, ?middle)','parent(?middle, ?younger)'], en:['Which grandparent and grandchild form each two-parent-link pair?', 'Give all endpoint pairs for parent-to-parent paths.', 'Return the older–younger pairs linked through an intermediate parent.'] },
  { id:'works_vs_employed', world:'employment_train', family:'relation_role', operators:['predicate_distinction','ground'], where:['works_at(maria, lab_alpha)'], en:['Does Maria work at Alpha Lab?', 'Is Maria recorded as working for Alpha Lab?', 'Check the working-at relation between Maria and Alpha Lab.'] },
  { id:'employed_not_implied', world:'employment_train', family:'relation_role', operators:['predicate_distinction','open_world'], negativeOf:'works_vs_employed', where:['employed_by(maria, lab_alpha)'], en:['Is Maria employed by Alpha Lab?', 'Does the record say Alpha Lab employs Maria?', 'Check the employment contract relation for Maria and Alpha Lab.'] },
  { id:'employed_bogdan', world:'employment_train', family:'relation_role', operators:['ground','employed_by'], where:['employed_by(bogdan, lab_alpha)'], en:['Is Bogdan employed by Alpha Lab?', 'Check whether Bogdan has an explicit employment relation with Alpha Lab.', 'Does Alpha Lab employ Bogdan according to the records?'] },
  { id:'works_bogdan_missing', world:'employment_train', family:'relation_role', operators:['no_unapproved_rule','ground'], negativeOf:'employed_bogdan', where:['works_at(bogdan, lab_alpha)'], en:['Does Bogdan work at Alpha Lab?', 'Check the working-at relation for Bogdan and Alpha Lab.', 'Is Bogdan recorded as working at Alpha Lab?'] },
  { id:'join_work_project', world:'employment_train', family:'conjunction_join', operators:['and','heterogeneous_predicates','ground'], where:['works_at(maria, lab_alpha)','project_member(maria, project_delta)'], en:['Does Maria both work at Alpha Lab and belong to Delta Project?', 'Check Maria’s Alpha Lab workplace and Delta Project membership together.', 'Do both records hold: Maria works at Alpha Lab, and Maria participates in Delta Project?'], ro:'Maria lucrează la Laboratorul Alfa și participă la Proiectul Delta?' },
  { id:'count_employed', world:'employment_train', family:'finite_outputs', operators:['count','select'], mode:'count', select:['?worker'], where:['employed_by(?worker, lab_alpha)'], en:['How many recorded people are employed by Alpha Lab?', 'Count the distinct people with positive employment support at Alpha Lab.', 'What is the count of Alpha Lab employees in these records?'] },
  { id:'negative_employment', world:'employment_train', family:'negation_openworld', operators:['explicit_negation','predicate_distinction'], where:['employed_by(ana, lab_alpha)'], en:['Is Ana employed by Alpha Lab?', 'Is an employment relation for Ana and Alpha Lab supported?', 'Check the explicit employment claim about Ana.'] },
  {id:'test_join_work_project', world:'employment_test', family:'conjunction_join', operators:['and','heterogeneous_predicates','select'], holdout:'composition', select:['?member'], where:['works_at(?member, lab_alpha)','project_member(?member, project_delta)'], en:['Who works at Alpha Lab while participating in Delta Project?', 'Find the Delta Project participant with an Alpha Lab workplace.', 'Give people appearing in both the Alpha Lab work and Delta Project membership lists.']},
  { id:'test_employer_reverse', world:'employment_test', family:'relation_role', operators:['role_inversion','select'], holdout:'romanian', select:['?org'], where:['employed_by(carina, ?org)'], en:['Which organization employs Carina?', 'Who is Carina explicitly employed by?', 'Name Carina’s employer from the records.'], ro:'La ce organizație este angajată Carina?' },
  { id: 'test_work_reverse', world:'employment_test', family:'relation_role', operators:['role_inversion','select'], holdout: 'world', select:['?person'], where:['works_at(?person, lab_beta)'], en:['Who works at Beta Lab?', 'Name the people whose workplace is Beta Lab.', 'Find the person recorded as working at Beta Lab.'] },
  { id:'time_before', world:'temporal_train', family:'temporal', operators:['at','before_start','open_world'], where:['works_at(maria, lab_alpha)'], time:{at:'2023-12-31'}, en:['Did Maria work at Alpha Lab on 31 December 2023?', 'Check Maria’s work at Alpha Lab immediately before 2024.', 'On the day before 2024, was Maria working at Alpha Lab?'] },
  { id:'time_start', world:'temporal_train', family:'temporal', operators:['at','inclusive_start'], where:['works_at(maria, lab_alpha)'], time:{at:'2024-01-01'}, en:['Did Maria work at Alpha Lab on 1 January 2024?', 'Check Maria’s Alpha Lab work exactly at the record’s start date.', 'On the first day of 2024, was Maria working at Alpha Lab?'] },
  { id:'time_last_day', world:'temporal_train', family:'temporal', operators:['at','before_exclusive_end'], where:['works_at(maria, lab_alpha)'], time:{at:'2025-05-31'}, en:['Did Maria work at Alpha Lab on 31 May 2025?', 'Check her Alpha Lab work the day before June 2025.', 'Was her Alpha Lab work still recorded at the end of May 2025?'] },
  { id:'time_end', world:'temporal_train', family:'temporal', operators:['at','exclusive_end','explicit_negation'], negativeOf:'time_last_day', where:['works_at(maria, lab_alpha)'], time:{at:'2025-06-01'}, en:['Did Maria work at Alpha Lab on 1 June 2025?', 'Check her Alpha Lab work exactly at the period’s exclusive end.', 'What does the dated record say about her Alpha Lab work at the start of June 2025?'] },
  { id:'time_interval', world:'temporal_train', family:'temporal', operators:['during','bounded_interval'], where:['works_at(maria, lab_alpha)'], time:{during:'2024-04-01 2024-05-01'}, en:['Was Maria working at Alpha Lab at some point during April 2024?', 'Check for evidence of Maria’s Alpha Lab work during 1 April to 1 May 2024.', 'Within the April 2024 interval, is Maria’s Alpha Lab work recorded?'] },
  { id:'time_asof_early', world:'temporal_train', family:'temporal', operators:['at','asof','knowledge_cutoff'], where:['works_at(maria, lab_alpha)'], time:{at:'2024-05-01',asof:'2023-12-31'}, en:['From the records known by 31 December 2023, was Maria working at Alpha Lab on 1 May 2024?', 'Using only information available before 2024, check her Alpha Lab work on 1 May 2024.', 'As known at the end of 2023, does the 1 May 2024 work claim have support?'] },
  { id:'time_asof_late', world:'temporal_train', family:'temporal', operators:['at','asof','knowledge_cutoff'], negativeOf:'time_asof_early', where:['works_at(maria, lab_alpha)'], time:{at:'2024-05-01',asof:'2025-01-01'}, en:['From the records known by 1 January 2025, was Maria working at Alpha Lab on 1 May 2024?', 'Using information available in 2025, check her Alpha Lab work on 1 May 2024.', 'As known at the start of 2025, does the 1 May 2024 work claim have support?'] },
  {id:'dev_time_boundary', world:'temporal_dev', family:'temporal', operators:['at','exclusive_end'], holdout: 'world', where:['works_at(bogdan, lab_beta)'], time:{at:'2025-04-01'}, en:['Was Bogdan working at Beta Lab on 1 April 2025?', 'Check the Beta Lab work fact at its exclusive endpoint.', 'On the first day after March 2025, does the dated Beta Lab work apply?'], ro:'Lucra Bogdan la Laboratorul Beta la 1 aprilie 2025?'},
  { id: 'dev_time_window', world:'temporal_dev', family:'temporal', operators:['during','bounded_interval'], holdout: 'world', where:['works_at(carina, lab_alpha)'], time:{during:'2025-04-01 2025-05-01'}, en:['Was Carina working at Alpha Lab at some point during April 2025?', 'Check Carina’s Alpha Lab work within the April 2025 interval.', 'Is Carina’s dated work applicable at any time from 1 April to 1 May 2025?'] },
  { id:'incident_conflict', world:'incident_test', family:'negation_openworld', operators:['explicit_negation','conflict'], holdout:'composition', where:['network_down(lab_alpha)'], en:['Is Alpha Lab’s network down, given both incident reports?', 'Check the conflicting network-down claim at Alpha Lab.', 'Do the Alpha Lab network observations agree?'], ro:'Este rețeaua Laboratorului Alfa indisponibilă, având dovezi contradictorii?' },
  { id:'incident_absent_cause', world:'incident_test', family:'causal_boundary', operators:['open_world','no_causal_inference'], holdout:'lexical', where:['outage(lab_beta)'], en:['Is there a documented outage at Beta Lab?', 'Does a full disk alone establish an outage at Beta Lab?', 'Check for an outage fact at Beta Lab without assuming a cause.'] },
  { id:'resolved_lab', world:'employment_train', family:'scoped_synonyms', operators:['resolve','entity','type_organization'], resolve:{text:'Beta Lab',language:'en',id:'lab_beta'}, where:['works_at(ana, lab_beta)'], en:['Does Ana work at Beta Lab?', 'Is Ana’s workplace Beta Lab?', 'Check Ana’s work relation to the organization called Beta Lab.'] },
  { id: 'resolved_romanian_lab', world:'employment_test', family:'scoped_synonyms', operators:['resolve','entity','romanian','type_organization'], holdout: 'world', resolve:{text:'Laboratorul Alfa',language:'ro',id:'lab_alpha'}, where:['works_at(ana, lab_alpha)'], en:['Does Ana work at Laboratorul Alfa?', 'Check whether Ana works at the organization named Laboratorul Alfa.', 'Is Laboratorul Alfa the recorded workplace of Ana?'], ro:'Lucrează Ana la Laboratorul Alfa?' },
  { id:'route_expression', world:'route_dev', family:'expression_composition', operators:['query','unique_output','arithmetic','finite_constraint'], holdout:'composition', en:['The Alpha Lab route takes 70 minutes; leaving at minute 770, is arrival by minute 840 feasible?', 'Retrieve Alpha Lab’s route duration, add it to a departure time of 770 minutes, and check arrival no later than 840.', 'Will departure at minute 770 meet the minute-840 deadline using the recorded route duration?'] },
  { id:'route_approved_procedure', world:'route_dev', family:'approved_procedure', operators:['expand','host_approved_library','finite_constraint'], holdout:'composition', en:['Use the approved arrival-check procedure for Alpha Lab, starting at minute 770 with a minute-840 deadline.', 'Apply the reviewed arrival template to the Alpha Lab route: depart 770, deadline 840.', 'With start 770 and cutoff 840, run the approved route-arrival procedure for Alpha Lab.'] },
];

// These cases use supplied assertions as MODEL INPUT, never copy them into setup_sop.
export const attached = [
  {id:'assert_positive', split:'train', family:'attached_assertions', operators:['assert','session','ground'], claims:[f('Ana is a parent of Maria.', 'parent(ana, maria)')], where:['parent(ana, maria)'], en:['Ana is a parent of Maria. Is Ana a parent of Maria?', 'Given that Ana parents Maria, check the parent claim.', 'Using the fact I supplied—Ana is a parent of Maria—does it hold?']},
  { id:'assert_reverse', split:'train', family:'attached_assertions', operators:['assert','session','argument_reversal'], negativeOf:'assert_positive', claims:[f('Ana is a parent of Maria.', 'parent(ana, maria)')], where:['parent(maria, ana)'], en:['Ana is a parent of Maria. Is Maria a parent of Ana?', 'Given that Ana parents Maria, check whether Maria parents Ana.', 'Does Maria parent Ana if all I said was that Ana parents Maria?'] },
  { id:'assert_negative', split:'dev', family:'attached_assertions', operators:['assert','session','explicit_negation'], claims:[f('Bogdan is not a parent of Ana.', 'not parent(bogdan, ana)')], where:['parent(bogdan, ana)'], en:['Bogdan is not a parent of Ana. Is Bogdan a parent of Ana?', 'With my assertion that Bogdan does not parent Ana, check his parent relation to her.', 'I state that Bogdan is not Ana’s parent. Is the positive claim supported?'] },
  { id:'assert_conflict', split:'test', family:'attached_assertions', operators:['assert','session','conflict'], holdout:'composition', claims:[f('Carina works at Beta Lab.', 'works_at(carina, lab_beta)'),f('Carina does not work at Beta Lab.', 'not works_at(carina, lab_beta)')], where:['works_at(carina, lab_beta)'], en:['Carina works at Beta Lab; Carina does not work at Beta Lab. What is the status of that work claim?', 'Given both assertions about Carina’s Beta Lab work, check the claim without choosing a side.', 'I say Carina works and does not work at Beta Lab. Does the record support her work there?'], ro:'Carina lucrează și nu lucrează la Laboratorul Beta. Ce spun ambele afirmații?' },
  { id:'assert_only', split:'train', family:'attached_assertions', operators:['assert','session','no_query'], claims:[f('Ana works at Beta Lab.', 'works_at(ana, lab_beta)')], en:['Record this for the present session: Ana works at Beta Lab.', 'For this conversation, note that Ana works at Beta Lab.', 'Keep in this session the fact that Ana works at Beta Lab.'] },
  { id:'assert_temporal', split:'dev', family:'attached_assertions', operators:['assert','session','at','exclusive_end'], holdout:'composition', claims:[f('Maria worked at Alpha Lab from 2024-01-01 until 2025-06-01.', 'works_at(maria, lab_alpha)', '2024-01-01 2025-06-01')], where:['works_at(maria, lab_alpha)'], time:{at:'2025-06-01'}, en:['Maria worked at Alpha Lab from 1 January 2024 until 1 June 2025. Did she work there on 1 June 2025?', 'Given Maria’s Alpha Lab work ending on 1 June 2025, check that exact day.', 'I assert the work interval [2024-01-01, 2025-06-01). Does the work claim hold at its end?'] },
];

export const numeric = [
  { id:'finite_possible', split:'train', family:'finite_constraints', operators:['finite_domain','possible','comparison'], min:0,max:4,require:['?x >= 2'],claim:'?x == 3',task:'possible', oracle:'possible', en:['Can a number from 0 through 4 that is at least 2 equal 3?', 'Is x = 3 possible if x is an integer in [0,4] constrained to at least 2?', 'Check whether some integer from 0 to 4 satisfying x >= 2 can equal 3.'], ro:'Poate un întreg între 0 și 4, cel puțin 2, să fie 3?' },
  { id:'finite_not_entailed', split:'train', family:'finite_constraints', operators:['finite_domain','prove','comparison'], negativeOf:'finite_possible', min:0,max:4,require:['?x >= 2'],claim:'?x == 3',task:'prove', oracle:'unknown', en:['Must every number from 0 through 4 that is at least 2 equal 3?', 'Does x >= 2 force x = 3 for integers in [0,4]?', 'For integer x in [0,4] with x >= 2, is x = 3 required?'] },
  { id:'finite_refuted', split:'train', family:'finite_constraints', operators:['finite_domain','prove','strict_comparison'], min:0,max:4,require:['?x >= 2'],claim:'?x < 2',task:'prove', oracle:'refuted', en:['Can all numbers at least 2 in [0,4] be below 2?', 'Does x >= 2 entail x < 2 over integers 0 to 4?', 'For an integer x in [0,4] satisfying x >= 2, prove the claim x < 2 if true.'] },
  { id:'finite_unique', split:'dev', family:'finite_outputs', operators:['finite_domain','unique_output','comparison'], min:0,max:4,require:['?x == 2 + 1'],claim:'?x <= 3',task:'possible', output:'?x one', oracle:'possible', outputValue:3, en:['For an integer x in [0,4] exactly 2 plus 1, is x at most 3 and what unique value is x?', 'For integer x in [0,4] with x = 2 + 1, check x <= 3 and return x.', 'Given x in [0,4] and x = 2 + 1, determine its sole value and test x <= 3.'] },
  {id:'finite_many', split:'test', family:'finite_outputs', operators:['finite_domain','nonunique_output','comparison'], holdout:'composition', min:0,max:4,require:['?x >= 2'],claim:'?x <= 3',task:'possible',output:'?x one',oracle:'possible', en:['If x is in [0,4] and at least 2, can x be at most 3? Return a value only if x is uniquely determined.', 'Is x <= 3 possible with 2 <= x <= 4, and is there one uniquely forced x?', 'For integer x in [0,4] with x >= 2, check feasibility of x <= 3; do not return a value unless unique.']},
  { id: 'finite_direction', split:'test', family:'finite_constraints', operators:['finite_domain','direction','strict_comparison'], holdout: 'operator', min:0,max:4,require:['?x >= 2'],claim:'?x > 3',task:'possible',oracle:'possible', en:['Could an integer x between 2 and 4 exceed 3?', 'Is x > 3 feasible when 2 <= x <= 4?', 'Among the integers from 2 through 4, is there any value greater than 3?'] },
];

export const extra = [
  { id:'ambiguous_pronoun', split:'train', family:'clarification', operators:['ambiguous_reference'], en:['Is she their parent?', 'Check whether that person is the parent of the other.', 'Do they have her as a parent?'], ro:'Este ea părintele lor?', clarification:'Which two people do you mean by she and their?' },
  { id:'ambiguous_bank', reservedLexemes:['bank'], split:'test', family:'clarification', operators:['ambiguous_sense','lexical_holdout'], holdout:'lexical', en:['Does Maria work at the bank?', 'Check whether Maria works for that bank.', 'Is the bank Maria’s workplace?'], clarification:'Which bank or organization do you mean?' },
  { id:'unsupported_default', split:'dev', family:'unsupported_boundary', operators:['default_exception'], en:['If the network is normally up, can I assume it is up now?', 'Absent an outage report, is the network definitely working?', 'Does missing evidence of failure prove there is no failure?'], clarification:'There is no approved default rule or evidence for the current network state; what evidence should I use?' },
  { id: 'unsupported_cause', split:'test', family:'unsupported_boundary', operators:['abduction','causal_boundary'], holdout: 'capability_boundary', en:['Did a full disk cause the outage?', 'Given an outage, was its cause a full disk?', 'Can you establish a disk failure as the cause of this outage?'], clarification:'Which causal model or independently reviewed evidence links the disk to the outage?' },
  { id:'unsupported_plan', split:'dev', family:'unsupported_boundary', operators:['planning','missing_action_model'], en:['Which sequence of repairs guarantees the network will recover?', 'Plan the steps to restore service, with no action model provided.', 'What actions should I take to guarantee that the outage ends?'], clarification:'Which approved actions, preconditions and goal definition should the plan use?' },
  { id: 'unsupported_counterfactual', split:'test', family:'unsupported_boundary', operators:['counterfactual','missing_causal_model'], holdout: 'capability_boundary', en:['If the disk had not filled, would the outage still have happened?', 'Would service be up now had the disk remained free?', 'Without the disk filling, would the outage have been avoided?'], clarification:'Which reviewed causal model defines the intervention and the outcome?' },
];
