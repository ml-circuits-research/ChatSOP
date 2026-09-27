# 05. Timpul, corecțiile și premisele contradictorii

## Două întrebări distincte

„Unde lucra Maria în 2025?” se referă la validitatea în lume. „Ce știam la 1 februarie 2025 despre asta?” se referă la istoricul cunoașterii. `valid` în fapt și `at/during` în query răspund primei întrebări. `knownAt`, stabilit de host, și `asof` răspund celei de-a doua. Un model nu poate falsifica timpul aflării printr-un câmp arbitrar.

Intervalele sunt `[start, end)`: începutul este inclus, sfârșitul exclus. Datele simple sunt ancorate la UTC. O oră fără zi sau fus nu este convertită prin ghicire. Pentru „în 2025” se folosește `[2025-01-01, 2026-01-01)`. Granularitatea mai fină cere timestamp UTC.

## Schimbare de stare

Un fapt spune `works_at(maria, lab_alpha)` de la 2024 până la un sfârșit necunoscut. Dacă aflăm explicit că raportul s-a încheiat la 1 martie 2026, un `event end` închide intervalul acelei afirmații. O întrebare din 2025 încă o poate recupera. După încheiere, lipsa unui fapt nou produce `unknown`, nu automat `not works_at`.

Aflarea unei alte slujbe nu închide prima slujbă: oamenii pot avea mai multe relații de muncă. Doar o regulă de exclusivitate explicită, adecvată domeniului, poate justifica o asemenea operație. Nucleul nu are această presupunere globală.

## Corecție epistemică

„Afirmația anterioară era greșită” nu descrie o mutare a persoanei în acel moment. Se emite un `event correct` care retrage afirmația veche și introduce noua afirmație, cu intervalul corect. Istoricul aflării rămâne. Cu `asof` anterior corecției se vede vechea versiune; după corecție ea nu este admisă ca premisă curentă.

Ținta este un ID de afirmație, nu doar predicatul și subiectul. Două surse pot face afirmații independente despre aceeași relație. Corectarea uneia nu retrage automat toate sursele. Biblioteca versionată de reguli este filtrată după timpul aflării înainte de alegerea versiunii vizibile.

## Inferență pe intervale

Când o regulă are două premise, concluzia este valabilă numai pe intersecția intervalelor premiselor și a intervalului regulii. Intersecția goală nu produce concluzie. La o interogare punctuală, și concluziile derivate sunt filtrate după acel moment. Closure-ul este recalculat din premisele actuale; nu păstrează un cache vechi de concluzii după corecție.

În logica folosită aici, o relație cu timp explicit poate fi tratată monoton în interiorul snapshot-ului. Nu este necesar să numim orice reasoning temporal „non-monoton”. Selectarea snapshot-ului și aplicarea retractărilor schimbă premisele; derivarea Horn peste setul fix de premise rămâne monotonă. Distincția face comportamentul implementabil și testabil.

## Negație și contradicție

`p(...)` și `not p(...)` sunt două tipuri de dovadă. Dacă se suprapun temporal, o întrebare ground primește `both`. Nu se derivă orice concluzie din conflict. Dacă sunt susținute în perioade diferite, statusul pentru interogarea de interval este `mixed_temporal`, iar dovezile arată intervalele; nu este o contradicție.

Pentru queries cu variabile, prototipul returnează răspunsurile semnului cerut și dovezile. Detectarea conflictelor complete între toate rândurile unui query complex este o extensie; nu interpreta o listă de rezultate drept audit global al consistenței.

## Ce nu acoperă încă modelul temporal

Nu avem un Event Calculus general, predicție de tranziții arbitrare, intervale incerte sau ramuri de lumi posibile persistente. `event` acoperă end/retract/correct, iar evenimente de domeniu pot fi reprezentate prin predicate obișnuite și reguli aprobate. Ipotezele sunt locale firului `reason`, nu se memorează automat. Condițiile temporale cu variabile numerice merg în `constraint`, nu sunt implicit rezolvate de `valid`.

Uitarea fizică a băncilor poate face nerecuperabil un fapt vechi. Bitemporalitatea metadatelor nu echivalează cu păstrarea unei arhive complete după decay.
