---
name: spark-training
description: Run two tiny-model adapters on DGX Spark
---

# Run two tiny-model adapters on DGX Spark

Citește `08-spark.md`. Verifică accesul la modele și condițiile lor, mediul NVIDIA și păstrarea Torch CUDA. Nu modifica rețeaua sau driverele. Notează digestul containerului, revizia bazei, pachetele și hash-urile datelor.

Înainte de GPU, rulează verificarea SOP și auditul tokenizerului real. Fă smoke în directoare separate. Nu trunca țintele. Antrenează formalizatorul și verbalizatorul, păstrând best/latest și rapoartele. Controlează și un adaptor comun pe aceleași date când resursele permit.

Evaluează semantic, nu numai loss. Exportă GGUF după acceptare și retestează fiecare cuantizare. Nu declara succes conversațional pe baza testelor deterministe. Nu include token-uri de acces sau greutăți cu licență într-un ZIP public fără autorizare.

Pentru profilul v3, citește și `27-date-si-invatare-v3.md`. Catalogul de tipuri este `docs/contracts/wires.json`; exemplele cu abducție/planificare nu trebuie reduse la întrebări factuale.
