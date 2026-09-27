# Câmpurile acceptate în sop-agent-3

Generat de `node tools/capabilities.js --write` din parser și registrul engine-ului. Cardinalitatea «unic» înseamnă maximum o apariție; câmpurile obligatorii sunt precizate separat. Validarea semantică descrisă în capitolul 24 se aplică suplimentar.

## `value`

Câmpuri unice: `data`.

Repetabile: niciunul.

Obligatorii: `data`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `fact`

Câmpuri unice: `holds`, `valid`, `source`, `quote`, `retention`.

Repetabile: niciunul.

Obligatorii: `holds`, `valid`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `rule`

Câmpuri unice: `then`, `valid`, `mode`, `source`.

Repetabile: `when`.

Obligatorii: `then`, `when`.

Modelul poate declara acest tip: nu; definiție aprobată sau fir intern. 

## `query`

Câmpuri unice: `mode`, `select`, `at`, `during`, `asof`, `limit`.

Repetabile: `where`, `filter`.

Obligatorii: `where`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `constraint`

Câmpuri unice: `claim`, `task`, `unit`, `objective`, `direction`.

Repetabile: `var`, `require`.

Obligatorii: `claim`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `event`

Câmpuri unice: `action`, `target`, `effective`, `replacement`, `source`.

Repetabile: niciunul.

Obligatorii: `action`, `target`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `pack`

Câmpuri unice: niciunul.

Repetabile: `items`.

Obligatorii: `items`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `assert`

Câmpuri unice: `scope`.

Repetabile: `input`, `after`.

Obligatorii: `input`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `recall`

Câmpuri unice: `query`, `strategy`.

Repetabile: `after`.

Obligatorii: `query`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `link`

Câmpuri unice: `query`, `data`, `strategy`.

Repetabile: `after`.

Obligatorii: `query`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `solve`

Câmpuri unice: `query`, `constraint`, `data`, `backend`, `strategy`, `assume`, `reasoning`.

Repetabile: `output`, `after`.

Obligatorii: conform validării semantice.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `binding`

Câmpuri unice: `result`, `variable`, `mode`, `owner`.

Repetabile: niciunul.

Obligatorii: `result`, `variable`, `mode`, `owner`.

Modelul poate declara acest tip: nu; definiție aprobată sau fir intern. Runtime-generated only

## `reason`

Câmpuri unice: `query`, `memory`, `data`, `constraint`, `backend`, `assume`, `reasoning`, `mode`.

Repetabile: `after`.

Obligatorii: conform validării semantice.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `cnl`

Câmpuri unice: `result`, `language`.

Repetabile: niciunul.

Obligatorii: `result`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `jsEval`

Câmpuri unice: `expr`.

Repetabile: niciunul.

Obligatorii: `expr`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `template`

Câmpuri unice: `params`, `yield`, `body`, `description`.

Repetabile: `cue`.

Obligatorii: `body`, `yield`.

Modelul poate declara acest tip: nu; definiție aprobată sau fir intern. 

## `expand`

Câmpuri unice: `using`.

Repetabile: `with`, `after`.

Obligatorii: `using`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `clarify`

Câmpuri unice: `text`.

Repetabile: niciunul.

Obligatorii: `text`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `pattern`

Câmpuri unice: `then`, `support`, `coverage`, `samples`, `counterexamples`, `source`, `status`.

Repetabile: `when`.

Obligatorii: `when`, `then`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `hypothesis`

Câmpuri unice: `holds`, `cost`, `status`, `source`.

Repetabile: `assume`.

Obligatorii: conform validării semantice.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `action`

Câmpuri unice: `params`, `cost`, `source`, `valid`.

Repetabile: `requires`, `adds`, `removes`.

Obligatorii: `requires`.

Modelul poate declara acest tip: nu; definiție aprobată sau fir intern. 

## `goal`

Câmpuri unice: niciunul.

Repetabile: `where`.

Obligatorii: `where`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `trace`

Câmpuri unice: `text`, `source`, `closed`, `known`.

Repetabile: `feature`.

Obligatorii: conform validării semantice.

Modelul poate declara acest tip: da, sub policy-ul host-ului. Model cannot certify closed=true

## `policy`

Câmpuri unice: `maxNodes`, `maxDepth`, `maxHypotheses`, `maxCandidates`, `maxPlans`, `timeoutMs`.

Repetabile: niciunul.

Obligatorii: conform validării semantice.

Modelul poate declara acest tip: nu; definiție aprobată sau fir intern. 

## `theory`

Câmpuri unice: `dialect`, `body`.

Repetabile: niciunul.

Obligatorii: `dialect`, `body`.

Modelul poate declara acest tip: nu; definiție aprobată sau fir intern. Unsupported unless an approved strategy handles the dialect

## `procedure`

Câmpuri unice: `params`, `yield`, `body`, `description`.

Repetabile: `cue`.

Obligatorii: `body`, `yield`.

Modelul poate declara acest tip: nu; definiție aprobată sau fir intern. 

## `abduce`

Câmpuri unice: `query`, `data`, `memory`, `observation`, `candidates`, `reasoning`, `policy`.

Repetabile: `output`, `after`.

Obligatorii: conform validării semantice.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `diagnose`

Câmpuri unice: `query`, `data`, `memory`, `observation`, `candidates`, `tests`, `reasoning`, `policy`.

Repetabile: `output`, `after`.

Obligatorii: conform validării semantice.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `associate`

Câmpuri unice: `cue`, `data`, `mode`, `reasoning`, `policy`.

Repetabile: `output`, `after`.

Obligatorii: `cue`, `data`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `induce`

Câmpuri unice: `data`, `candidates`, `holdout`, `reasoning`, `policy`.

Repetabile: `output`, `after`.

Obligatorii: `data`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `analogize`

Câmpuri unice: `source`, `target`, `transfer`, `reasoning`, `policy`.

Repetabile: `output`, `after`.

Obligatorii: `source`, `target`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `plan`

Câmpuri unice: `data`, `memory`, `actions`, `goal`, `reasoning`, `policy`.

Repetabile: `output`, `after`.

Obligatorii: `goal`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `simulate`

Câmpuri unice: `query`, `data`, `memory`, `intervention`, `mode`, `reasoning`, `policy`.

Repetabile: `output`, `after`.

Obligatorii: `query`, `intervention`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

## `temporal`

Câmpuri unice: `query`, `data`, `memory`, `reasoning`, `policy`.

Repetabile: `output`, `after`.

Obligatorii: `query`.

Modelul poate declara acest tip: da, sub policy-ul host-ului. 

