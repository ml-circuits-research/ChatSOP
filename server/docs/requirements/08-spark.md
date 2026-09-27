# 08. Antrenare pe DGX Spark și rulare CPU

## Alegerea modelului

`config/train-gemma.json` selectează `google/gemma-3-270m-it`. Este baza mică pentru experiment, nu o afirmație că este demonstrat cel mai mic model bun în română. Modelul și condițiile lui de acces se verifică în model card [S4]. Configurația alternativă este `Qwen/Qwen3-0.6B` [S5]. Competența pe protocolul SOP și pe română se măsoară independent după antrenare.

Antrenăm două adaptoare LoRA: formalizator și verbalizator. Pot utiliza aceeași bază, dar au obiective diferite. Configurația include și rolul `shared`, precum și full fine-tuning, pentru experimente. Nu presupunem că două adaptoare sunt automat superioare unui adaptor comun; acesta este un control util. Servirea cu două adaptoare economisește memoria bazei, dar operațiile sunt serializate în serverul simplu.

## Pregătire

Pe gazdă ai nevoie de Docker cu acces la GPU, spațiu pentru cache și Node 22+. Acceptă condițiile modelului în contul Hugging Face și setează `HF_TOKEN` în shell. Nu salva token-ul în repository.

```bash
node tools/verify.js
node tools/build-data.js --out data/generated --worlds 1000
node tools/check-data.js --dir data/generated --execute --out reports/generated-validation.json
bash scripts/spark-shell.sh
```

Scriptul pornește imaginea `nvcr.io/nvidia/pytorch:25.11-py3`, folosită și într-un playbook oficial Spark [S6]. Se poate schimba prin `SPARK_IMAGE`. Pachetul folosește PyTorch/Transformers/PEFT direct; nu cere Unsloth. Digestul imaginii este salvat. Directorul proiectului și cache-ul sunt montate, iar serverele rămân pe loopback. Nu modifica driverele sau rețeaua Spark pentru acest experiment.

În container:

```bash
bash scripts/spark-setup.sh
source .venv/bin/activate
python training/preflight.py
python training/download_model.py --help
python training/audit_tokens.py --config config/train-gemma.json --data data/generated --role formalizer
```

Setup-ul păstrează build-ul CUDA PyTorch al NVIDIA printr-un virtualenv cu system-site-packages și o constrângere de versiune. Nu instala un wheel CPU de Torch peste el. Raportul preflight și `pip freeze` sunt salvate în `reports/`. ARM64/CUDA, accesul la model și compatibilitatea exactă a versiunilor trebuie confirmate pe gazda reală; nu au fost executate aici.

## Test scurt, apoi antrenare

```bash
bash scripts/smoke-train.sh
bash scripts/train-both.sh
```

Smoke-ul face până la 20 de pași per rol pe seed și salvează în directoare separate, nu peste rularea completă. Antrenarea completă folosește `TRAIN_CONFIG` și `TRAIN_DATA` din mediu sau valorile implicite Gemma/data-generated.

```bash
TRAIN_CONFIG=config/train-qwen.json TRAIN_DATA=data/generated bash scripts/train-both.sh
```

Scriptul nu suprascrie un output existent fără instrucțiune explicită. Pentru reluare:

```bash
python training/train.py --role formalizer --config config/train-gemma.json \
  --data data/generated --output outputs/formalizer --resume
```

Pentru teste fără descărcare/antrenare:

```bash
python training/train.py --role formalizer --data data/seed --dry-run
python training/train.py --role verbalizer --data data/seed --dry-run
```

Loss-ul este aplicat numai răspunsului, nu promptului. Tokenizarea refuză truncarea tăcută. Antrenarea fixează seed-uri, salvează versiunea bazei și hash-urile datelor, folosește BF16 pe GPU și păstrează best/latest. Resume-ul verifică identitatea datelor și rolul. Nu promite reproducere bit-cu-bit a stării RNG după orice întrerupere.

LoRA este implementat cu PEFT [S7], cu ținte `all-linear`; configurația implicită are rank 16. Aceasta este o alegere de pornire, nu un optimum măsurat. Verifică trainable parameters, tokenizare și dev loss în rapoarte înainte să crești numărul de exemple. Un dev loss mic nu este dovada fidelității semanticii.

## Servire și test conversațional

```bash
python training/serve_adapters.py
```

Serverul încarcă `outputs/formalizer/best` și `outputs/verbalizer/best`, confirmă că baza și revizia coincid și le deservește pe portul 8080. Concurența este protejată de un lock; nu este server de producție. Decodarea este greedy, fără chain-of-thought cerut și fără constrângere de gramatică. Parserul, schema și policy-ul validează ulterior. Opțiunea de gramatică a unui server extern este o extensie, nu o funcție implicită a acestui server.

```bash
# Pe gazdă, alt terminal:
node cli.js init
node cli.js chat --config config/runtime-shared.json --cnl-only
```

Verifică întâi „Ana este părintele lui Bogdan”, o întrebare, „De ce?”, o corecție și un query temporal. `:sop` arată programul modelului, `:cnl` rezultatul determinist, `:proof` pachetul. `:commit` salvează stratul utilizatorului; fără el, modificările rămân ale sesiunii. După evaluarea formalizatorului, elimină `--cnl-only` și evaluează reformularea separat.

## Export CPU

```bash
bash scripts/build-llama.sh
bash scripts/export-gguf.sh
bash scripts/serve-cpu.sh formalizer
# alt terminal
bash scripts/serve-cpu.sh verbalizer
# alt terminal
node cli.js chat --config config/runtime-cpu.json
```

Exportul combină separat fiecare adaptor cu baza și produce GGUF f16, Q8_0 și Q4_K_M. Converterul poate avea dependențe proprii: instalează-le într-un mediu separat și setează `CONVERTER_PYTHON`; nu altera Torch-ul de training pentru convertor. Scripturile păstrează commit-ul llama.cpp și hash-urile fișierelor.

Setează `MODEL_FILE`, `THREADS` și `CONTEXT` pentru testul CPU. `-ngl 0` este utilizat. Testează cuantizarea: schimbarea unor operatori, negări sau paranteze poate afecta semantic parsing chiar când textul pare lizibil. Nu presupune că Q4 și BF16 sunt semantic echivalente.

Rularea pe telefon necesită un host local pentru Node sau un port al runtime-ului și un backend mobil pentru model. Acest ZIP nu este o aplicație Android/iOS și nu livrează automat ambalarea mobilă. Scopul livrat este experiment Spark și inference local pe CPU.

Pentru profilul v3, citește și `27-date-si-invatare-v3.md`. Catalogul de tipuri este `docs/contracts/wires.json`; exemplele cu abducție/planificare nu trebuie reduse la întrebări factuale.
