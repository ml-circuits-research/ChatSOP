#!/bin/sh
# Haiku reference baseline predictions (API only, no GPU). Responses are cached per row id in cache/, so a rerun is free.
# Order: wild (most important for the validity analysis), then the formalizer-v1 sample, then the OOD sample; 8 parallel calls.
cd "$(dirname "$0")/../../../.."
D=eval/reports/current/haiku-baseline
node tools/research/haiku-baseline.mjs predict --suite eval/suites/formalizer-wild-v1/test.jsonl --out $D/formalizer-wild-v1.predictions.jsonl --parallel 8 > $D/predict-wild.log 2>&1
node tools/research/haiku-baseline.mjs predict --suite $D/samples/formalizer-v1-sample.suite.jsonl --out $D/formalizer-v1-sample.predictions.jsonl --parallel 8 > $D/predict-v1.log 2>&1
node tools/research/haiku-baseline.mjs predict --suite $D/samples/formalizer-ood-v1-sample.suite.jsonl --out $D/formalizer-ood-v1-sample.predictions.jsonl --parallel 8 > $D/predict-ood.log 2>&1
