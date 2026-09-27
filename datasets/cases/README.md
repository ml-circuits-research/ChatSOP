# datasets/cases — audit manual al exemplelor de antrenare

Un fișier `.md` per caz semantic (72 cazuri: 60 interogări + 6 asserțiuni atașate + 6 restricții numerice). Aici vezi, **fără să citești JSONL**:

- întrebările (suprafețele) în EN/RO care mapează la **același target canonic**;
- asserțiunile atașate (citate + atomul SOP);
- răspunsul așteptat (status/answers/oracle), calculat **independent** de target;
- circuitul SOP canonic exact, în bloc `sop`;
- contextul lumii (doar oracle; **nu** e input de model).

Input-ul de antrenare per rând rămâne `CONTEXT + MESSAGE → circuit` (fără instrucțiuni).

## Reguli

1. **Nu edita manual** fișierele de aici — sunt generate din `tools/datasets/curriculum/cases.mjs` și regenerarea le suprascrie; orice modificare locală face ca `tools/datasets/validate.mjs` să eșueze cu „authoring tree does not match”.
2. Pentru a schimba un caz: editezi `cases.mjs`, apoi `node tools/datasets/build-cases-md.mjs` (regenerează MD) și `node tools/datasets/build-curriculum.mjs` (recompilează JSONL + manifest).
3. Verificare rapidă de drift: `node tools/datasets/build-cases-md.mjs --check` (exit 1 + listă dacă MD ≠ cod).

`README.md` (acest fișier) este exclus din arborele hash-uit.
