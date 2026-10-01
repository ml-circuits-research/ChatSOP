#!/bin/sh
# Secondary condition haiku-thinking, run only after haiku-nothink (primary) has finished: rest of the wild suite,
# then 150-row subsamples of the formalizer-v1 and OOD samples.
cd "$(dirname "$0")/../../../.."
D=eval/reports/current/haiku-baseline
node tools/research/haiku-baseline.mjs predict --suite eval/suites/formalizer-wild-v1/test.jsonl --out $D/formalizer-wild-v1.predictions.jsonl --parallel 8 > $D/predict-wild.log 2>&1
node tools/research/haiku-baseline.mjs predict --suite $D/samples/formalizer-v1-thinking-sub.suite.jsonl --out $D/formalizer-v1-thinking-sub.predictions.jsonl --parallel 8 > $D/predict-v1.log 2>&1
node tools/research/haiku-baseline.mjs predict --suite $D/samples/formalizer-ood-v1-thinking-sub.suite.jsonl --out $D/formalizer-ood-v1-thinking-sub.predictions.jsonl --parallel 8 > $D/predict-ood.log 2>&1
