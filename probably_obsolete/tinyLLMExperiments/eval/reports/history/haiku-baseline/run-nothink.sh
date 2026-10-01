#!/bin/sh
# Condition haiku-nothink (MAX_THINKING_TOKENS=0): same prompt and rows; cache in cache-nothink/.
cd "$(dirname "$0")/../../../.."
D=eval/reports/current/haiku-baseline
node tools/research/haiku-baseline.mjs predict --condition nothink --suite eval/suites/formalizer-wild-v1/test.jsonl --out $D/formalizer-wild-v1.nothink.predictions.jsonl --parallel 8 > $D/predict-nothink-wild.log 2>&1
node tools/research/haiku-baseline.mjs predict --condition nothink --suite $D/samples/formalizer-v1-sample.suite.jsonl --out $D/formalizer-v1-sample.nothink.predictions.jsonl --parallel 8 > $D/predict-nothink-v1.log 2>&1
node tools/research/haiku-baseline.mjs predict --condition nothink --suite $D/samples/formalizer-ood-v1-sample.suite.jsonl --out $D/formalizer-ood-v1-sample.nothink.predictions.jsonl --parallel 8 > $D/predict-nothink-ood.log 2>&1
