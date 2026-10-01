#!/bin/sh
# Score the Haiku reference baseline with the same scorers as the small models (CPU only), then compare.
#   sh score.sh wild|v1|ood thinking|nothink
cd "$(dirname "$0")/../../../.."
D=eval/reports/current/haiku-baseline
case "$2" in thinking) W=formalizer-wild-v1; V=formalizer-v1-thinking-sub; O=formalizer-ood-v1-thinking-sub;;
  nothink) W=formalizer-wild-v1.nothink; V=formalizer-v1-sample.nothink; O=formalizer-ood-v1-sample.nothink;; *) echo "condition?"; exit 2;; esac
case "$1" in
  wild) node tools/eval/wild-suite.mjs --score $D/$W.predictions.jsonl --out $D/$W.wild.json > $D/$W.score.log 2>&1
        node eval/run.mjs --messages eval/suites/formalizer-wild-v1/test.jsonl --predictions $D/$W.predictions.jsonl --out $D/$W.reference-free.json > $D/$W.reference-free.log 2>&1;;
  v1)   S=$D/samples/formalizer-v1-sample.suite.jsonl; [ "$2" = thinking ] && S=$D/samples/formalizer-v1-thinking-sub.suite.jsonl
        node eval/run.mjs --file $S --predictions $D/$V.predictions.jsonl --out $D/$V.evaluation.json > $D/$V.score.log 2>&1;;
  ood)  S=$D/samples/formalizer-ood-v1-sample.suite.jsonl; [ "$2" = thinking ] && S=$D/samples/formalizer-ood-v1-thinking-sub.suite.jsonl
        node eval/run.mjs --file $S --predictions $D/$O.predictions.jsonl --out $D/$O.evaluation.json > $D/$O.score.log 2>&1;;
esac
tail -c 600 $D/*.score.log | tail -5
