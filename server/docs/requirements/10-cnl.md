# 10. De la rezultat formal la CNL și limbaj natural

Reasoner-ul produce un pachet structurat cu status, răspunsuri, dovezi, intervale și completitudine. `cnl` îl transformă determinist în propoziții controlate și linii `ANSWER`, `VALID`, `EVIDENCE`. Răspunsul poate fi afișat direct fără al doilea model. Acesta este baseline-ul de fidelitate.

Verbalizatorul primește numai CNL-ul necesar răspunsului și limba dorită, nu întreaga memorie și nici libertatea de a aplica alte reguli. El poate lega propoziții, explica pe scurt și folosi etichete cunoscute, dar nu poate introduce nume, numere, cauze, certitudine sau relații absente. Textul este un produs de prezentare; nu este scris în KB drept dovadă nouă.

Exemplele critice sunt diferențele dintre „există o soluție în condițiile date” și „este garantat”, dintre „nu am dovezi” și „este fals”, dintre „era valabil în 2025” și „este valabil acum”. Pentru o concluzie contradictorie trebuie păstrate ambele surse relevante. Pentru un rezultat ipotetic trebuie păstrată condiția.

Două strategii pot fi evaluate. Prima folosește CNL direct și este complet deterministă la prezentare. A doua folosește modelul mic pentru fluentizare și păstrează CNL-ul accesibil. Un verificator semantic complet al reformulării nu este livrat; în pipeline-ul de evaluare se face audit pe exemple și se păstrează perechea CNL/NL.

Vocabularul CNL implementat este română și engleză. Extinderea la altă limbă presupune șabloane suplimentare sau traducere neuronală evaluată. Aliasurile multilingve din ontologie nu produc automat propoziții gramaticale în acea limbă.
