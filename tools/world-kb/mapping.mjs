/**
 * The world-v1 mapping table: one row per Wikidata property (and per derived form of one), the single source of
 * both the fetch plan (fetch.mjs) and the wire emitter (build.mjs). `node tools/world-kb/mapping-table.mjs` renders it as MAPPING.md.
 *
 *   scope   entity classes (keys of CLASSES) whose members the property is read for
 *   pid     Wikidata property
 *   pred    predicate name in the base memory
 *   kind    entity   value is an item (symbol; the item gets labels)
 *           year     value is a time; precision >= year; integer year (negative for BCE)
 *           date     value is a time with day precision; emitted as a `time` term (years 1..9999 only)
 *           integer  value is a quantity, rounded to an integer
 *           text     value is a string
 *   roles   the predicate's `args`
 *   only    entity values restricted to this set of Wikidata items (a curated list), else any item
 */
export const CLASSES = {
  country: {qid: 'Q3624078', label: 'sovereign state', min: null},
  continent: {qid: 'Q5107', label: 'continent'},
  city: {qid: 'Q515', label: 'city'},
  language: {qid: 'Q34770', label: 'language'},
  currency: {qid: 'Q8142', label: 'currency'},
  element: {qid: 'Q11344', label: 'chemical element'},
  planet: {qid: 'Q634', label: 'planet'},
  person: {qid: 'Q5', label: 'human'},
  company: {qid: 'Q4830453', label: 'business'},
  university: {qid: 'Q3918', label: 'university'},
  organization: {qid: 'Q484652', label: 'international organization'},
  literary_work: {qid: 'Q7725634', label: 'literary work'},
  film: {qid: 'Q11424', label: 'film'},
  painting: {qid: 'Q3305213', label: 'painting'},
};

export const PEOPLE_OCCUPATIONS = {
  physicist: 'Q169470', chemist: 'Q593644', mathematician: 'Q170790', biologist: 'Q864503', astronomer: 'Q11063',
  philosopher: 'Q4964182', economist: 'Q188094', engineer: 'Q81096', inventor: 'Q205375', physician: 'Q39631', computer_scientist: 'Q82594',
  writer: 'Q36180', poet: 'Q49757', novelist: 'Q6625963', playwright: 'Q214917', painter: 'Q1028181', sculptor: 'Q1281618',
  architect: 'Q42973', composer: 'Q36834', explorer: 'Q11900058', politician: 'Q82955', monarch: 'Q116', military_leader: 'Q47064',
  film_director: 'Q2526255', actor: 'Q33999', singer: 'Q177220', theologian: 'Q1234713', historian: 'Q201788',
};

export const AWARDS = {
  q38104: 'Q38104', q44585: 'Q44585', q80061: 'Q80061', q37922: 'Q37922', q35637: 'Q35637', q47170: 'Q47170', q28835: 'Q28835', q185667: 'Q185667',
};
export const ORG_MEMBERSHIPS = ['Q1065', 'Q458', 'Q7184', 'Q7159', 'Q7768', 'Q19771', 'Q7172', 'Q7795']; // UN, EU, NATO, African Union, ASEAN, G20, Arab League, OPEC (labels verified at fetch time)

const E2 = [['subject', 'entity'], ['object', 'entity']];
const Y = [['subject', 'entity'], ['object', 'integer']];
const T = [['subject', 'entity'], ['object', 'text']];
const D = [['subject', 'entity'], ['time', 'time']];
const row = (scope, pid, pred, kind, roles, extra = {}) => ({scope, pid, pred, kind, roles, ...extra});

export const MAPPING = [
  row(['country'], 'P36', 'capital', 'entity', E2, {note: 'capital of the country (current)'}),
  row(['country'], 'P30', 'on_continent', 'entity', E2),
  row(['country'], 'P37', 'official_language', 'entity', E2),
  row(['country'], 'P38', 'uses_currency', 'entity', E2),
  row(['country'], 'P35', 'head_of_state', 'entity', E2, {note: 'current holder, best rank'}),
  row(['country'], 'P6', 'head_of_government', 'entity', E2, {note: 'current holder, best rank'}),
  row(['country'], 'P47', 'borders', 'entity', E2, {note: 'shares a land border; Wikidata states both directions'}),
  row(['country'], 'P463', 'member_of', 'entity', E2, {only: ORG_MEMBERSHIPS, note: 'membership in a curated list of international organizations'}),
  row(['country', 'city', 'language', 'currency'], 'P1082', 'population', 'integer', Y, {note: 'best-rank value'}),
  row(['country'], 'P2046', 'area_km2', 'integer', Y, {note: 'square kilometres, rounded'}),
  row(['country', 'company', 'university', 'organization', 'city'], 'P571', 'founded_year', 'year', Y, {note: 'inception; year precision'}),
  row(['country'], 'P297', 'iso_country_code', 'text', T, {note: 'ISO 3166-1 alpha-2'}),
  row(['language'], 'P218', 'iso_language_code', 'text', T, {note: 'ISO 639-1'}),
  row(['currency'], 'P498', 'iso_currency_code', 'text', T, {note: 'ISO 4217'}),
  row(['language'], 'P279', 'language_family', 'entity', E2, {note: 'subclass of: the family or parent language'}),
  row(['country', 'city', 'company', 'university', 'organization', 'literary_work', 'film', 'painting'], 'P17', 'located_in', 'entity', E2, {note: 'country; merged with P131 under one predicate (rule located_in_transitive)'}),
  row(['city', 'company', 'university', 'organization'], 'P131', 'located_in', 'entity', E2, {note: 'located in the administrative territorial entity'}),
  row(['person'], 'P569', 'birth_year', 'year', Y),
  row(['person'], 'P569', 'birth_date', 'date', D, {note: 'only when the date has day precision'}),
  row(['person'], 'P570', 'death_year', 'year', Y),
  row(['person'], 'P570', 'death_date', 'date', D, {note: 'only when the date has day precision'}),
  row(['person'], 'P19', 'born_in', 'entity', E2),
  row(['person'], 'P20', 'died_in', 'entity', E2),
  row(['person'], 'P27', 'citizen_of', 'entity', E2),
  row(['person'], 'P106', 'occupation', 'entity', E2),
  row(['person'], 'P21', 'gender', 'entity', E2),
  row(['person'], 'P69', 'educated_at', 'entity', E2),
  row(['person'], 'P166', 'award_received', 'entity', E2, {only: Object.values(AWARDS), note: 'curated list: the Nobel Prizes, Fields Medal, Turing Award'}),
  row(['company', 'university', 'organization'], 'P159', 'headquartered_in', 'entity', E2),
  row(['company', 'organization'], 'P112', 'founded_by', 'entity', E2),
  row(['company'], 'P452', 'industry', 'entity', E2),
  row(['company', 'university'], 'P749', 'parent_organization', 'entity', E2),
  row(['literary_work'], 'P50', 'author', 'entity', E2),
  row(['film'], 'P57', 'director', 'entity', E2),
  row(['painting'], 'P170', 'creator', 'entity', E2),
  row(['literary_work', 'film', 'painting'], 'P577', 'publication_year', 'year', Y, {note: 'publication or release; for paintings P571 is used instead'}),
  row(['painting'], 'P571', 'publication_year', 'year', Y, {note: 'inception of the painting'}),
  row(['literary_work', 'film'], 'P407', 'language_of_work', 'entity', E2, {note: 'P407 for literary works, P364 for films (original language)'}),
  row(['film'], 'P364', 'language_of_work', 'entity', E2),
  row(['literary_work', 'film'], 'P495', 'origin_country', 'entity', E2),
  row(['element'], 'P1086', 'atomic_number', 'integer', Y),
  row(['element'], 'P246', 'element_symbol', 'text', T),
  row(['element'], 'P575', 'discovery_year', 'year', Y),
  row(['element'], 'P61', 'discoverer', 'entity', E2),
  row(['planet'], 'P397', 'orbits', 'entity', E2, {note: 'parent astronomical body'}),
  row(['planet'], 'P575', 'discovery_year', 'year', Y),
  row(['planet'], 'P61', 'discoverer', 'entity', E2),
];

/** Predicates that are not one Wikidata property: labels and class membership, emitted for every selected entity. */
export const DERIVED = [
  {pred: 'is_a', source: 'P31', roles: E2, note: 'instance of: only the curated classes of CLASSES (country, city, human, ...), plus the selection class'},
  {pred: 'label_en', source: 'label', roles: T, note: 'English label (rdfs:label@en)'},
  {pred: 'label_ro', source: 'label', roles: T, note: 'Romanian label (rdfs:label@ro) when present; helps the host dictionary'},
  {pred: 'description_en', source: 'description', roles: T, note: 'English description (schema:description@en) of selected entities'},
  {pred: 'sitelinks', source: 'wikibase:sitelinks', roles: Y, note: 'number of Wikipedia editions; a notability measure used to pick the plain symbol on a name collision'},
];
