# Updated RuleTaker datasets for ProofWriter

This directory contains an updated version of the original [RuleTaker datasets](https://allenai.org/data/ruletaker),
associated with the paper "ProofWriter: Generating Implications, Proofs, and Abductive Statements
over Natural Language" (arXiv Dec 2020).

The top directories are:
  
   * CWA: Closed-world-assumption version of the dataset. Theories without negation are the same as the original
  RuleTaker datasets. Theories with negation were regenerated with a similar distribution to the original datasets
  but with a few issues fixed to ensure Datalog compatibility (remove negative facts and rules with negative
  conclusions; ensure all theories are stratifiable; ensure no rule has a free variable in a negated condition)
  * OWA: Open-world-assumption version of the dataset (no CWA, negative rule conditions treated as hard
  negation, rather than negation-as-failure NAF). Similar to CWA, the theories with negation were regenerated,
  although we allow negative facts and rule conclusions in this case. In OWA, questions without a proof has
  the answer "Unknown".
 

Within each CWA/OWA directory, the individual datasets are as follows:

  * depth-N (N=0, 1, 2, 3, 5): Questions with rulebases in synthetic language reasoning paths up to depth N, as defined in the paper.
  * birds-electricity: Questions with "birds" and "electricity" rulebases.
  * NatLang: Questions with rulebases in crowdsourced natural language.
  * depth-3ext: The Depth3 dataset augmented with 10% each of the depth=0, depth=1, and depth-2 datasets.
  * depth-3ext-NatLang: The Depth3Ext dataset augmented with the NatLang one.
  
Each of these directories then have the following files:

  * meta-(train/dev/test).jsonl: Main dataset for each split, with theories and associated questions and proofs
  * meta-stage-(train/dev/test).jsonl: "Staged" version of each theory, with depth-1 implications derived one at a
  time while adding to the theory.
  * meta-abduct-(train/dev/test).jsonl: "Missing fact" data for each theory 
  

## Format of `meta-(train/dev/test).jsonl` files

Here is a sample entry:

```
{
  "id":"RelNeg-OWA-D2-1717","maxD":2,"NFact":7,"NRule":3,
  "theory":"The cow is big. The cow needs the dog. The dog sees the rabbit. The rabbit chases the cow. The rabbit chases the dog. The rabbit is big. The rabbit sees the dog. If the cow is blue and the cow needs the rabbit then the cow needs the dog. If the cow chases the dog then the cow sees the rabbit. If something is big then it chases the dog.",
  "triples":{
    "triple1":{"text":"The cow is big.","representation":"(\"cow\" \"is\" \"big\" \"+\")"},
    "triple2":{"text":"The cow needs the dog.","representation":"(\"cow\" \"needs\" \"dog\" \"+\")"},
    "triple3":{"text":"The dog sees the rabbit.","representation":"(\"dog\" \"sees\" \"rabbit\" \"+\")"},
    "triple4":{"text":"The rabbit chases the cow.","representation":"(\"rabbit\" \"chases\" \"cow\" \"+\")"},
    "triple5":{"text":"The rabbit chases the dog.","representation":"(\"rabbit\" \"chases\" \"dog\" \"+\")"},
    "triple6":{"text":"The rabbit is big.","representation":"(\"rabbit\" \"is\" \"big\" \"+\")"},
    "triple7":{"text":"The rabbit sees the dog.","representation":"(\"rabbit\" \"sees\" \"dog\" \"+\")"}},
  "rules":{
    "rule1":{"text":"If the cow is blue and the cow needs the rabbit then the cow needs the dog.","representation":"(((\"cow\" \"is\" \"blue\" \"+\") (\"cow\" \"needs\" \"rabbit\" \"+\")) -> (\"cow\" \"needs\" \"dog\" \"+\"))"},
    "rule2":{"text":"If the cow chases the dog then the cow sees the rabbit.","representation":"(((\"cow\" \"chases\" \"dog\" \"+\")) -> (\"cow\" \"sees\" \"rabbit\" \"+\"))"},
    "rule3":{"text":"If something is big then it chases the dog.","representation":"(((\"something\" \"is\" \"big\" \"+\")) -> (\"something\" \"chases\" \"dog\" \"+\"))"}},
  "questions":{
    "Q1":{"question":"The cow is big.","answer":true,"QDep":0,"QLen":1,"strategy":"proof","proofs":"[(triple1)]","representation":"(\"cow\" \"is\" \"big\" \"+\")","proofsWithIntermediates":[{"representation":
    "triple1","intermediates":[]}]},
    "Q2":{"question":"The dog does not see the rabbit.","answer":false,"QDep":0,"QLen":1,"strategy":"inv-proof","proofs":"[(triple3)]","representation":"(\"dog\" \"sees\" \"rabbit\" \"-\")","proofsWithIntermediates":[{"representation":
    "triple3","intermediates":[]}]},
    "Q3":{"question":"The cow chases the dog.","answer":true,"QDep":1,"QLen":2,"strategy":"proof","proofs":"[(((triple1) -> rule3))]","representation":"(\"cow\" \"chases\" \"dog\" \"+\")","proofsWithIntermediates":[{"representation":"((triple1) -> (rule3 % int1))","intermediates":{"int1":{"text":"The cow chases the dog.","representation":"(\"cow\" \"chases\" \"dog\" \"+\")"}}}]},
    "Q4":{"question":"The cow does not chase the dog.","answer":false,"QDep":1,"QLen":2,"strategy":"inv-proof","proofs":"[(((triple1) -> rule3))]","representation":"(\"cow\" \"chases\" \"dog\" \"-\")","proofsWithIntermediates":[{"representation":"((triple1) -> (rule3 % int1))","intermediates":{"int1":{"text":"The cow chases the dog.","representation":"(\"cow\" \"chases\" \"dog\" \"+\")"}}}]},
    "Q5":{"question":"The cow sees the rabbit.","answer":true,"QDep":2,"QLen":3,"strategy":"proof","proofs":"[(((((triple1) -> rule3)) -> rule2))]","representation":"(\"cow\" \"sees\" \"rabbit\" \"+\")","proofsWithIntermediates":[{"representation":"((((triple1) -> (rule3 % int2))) -> (rule2 % int1))","intermediates":{"int1":{"text":"The cow sees the rabbit.","representation":"(\"cow\" \"sees\" \"rabbit\" \"+\")"},"int2":{"text":"The cow chases the dog.","representation":"(\"cow\" \"chases\" \"dog\" \"+\")"}}}]},
    "Q6":{"question":"The cow does not see the rabbit.","answer":false,"QDep":2,"QLen":3,"strategy":"inv-proof","proofs":"[(((((triple1) -> rule3)) -> rule2))]","representation":"(\"cow\" \"sees\" \"rabbit\" \"-\")","proofsWithIntermediates":[{"representation":"((((triple1) -> (rule3 % int2))) -> (rule2 % int1))","intermediates":{"int1":{"text":"The cow sees the rabbit.","representation":"(\"cow\" \"sees\" \"rabbit\" \"+\")"},"int2":{"text":"The cow chases the dog.","representation":"(\"cow\" \"chases\" \"dog\" \"+\")"}}}]},
    "Q7":{"question":"The dog does not chase the dog.","answer":"Unknown","QDep":1,"QLen":"","strategy":"inv-rconc","proofs":"[@1: The dog chases the dog.[CWA. Example of deepest failure = (rule3 <- FAIL)]]","representation":"(\"dog\" \"chases\" \"dog\" \"-\")"},
    "Q8":{"question":"The cow is red.","answer":"Unknown","QDep":0,"QLen":"","strategy":"random","proofs":"[@0: The cow is red.[CWA. Example of deepest failure = (FAIL)]]","representation":"(\"cow\" \"is\" \"red\" \"+\")"},
    "Q9":{"question":"The rabbit is not blue.","answer":"Unknown","QDep":0,"QLen":"","strategy":"inv-random","proofs":"[@0: The rabbit is blue.[CWA. Example of deepest failure = (FAIL)]]","representation":"(\"rabbit\" \"is\" \"blue\" \"-\")"},
    "Q10":{"question":"The cow chases the rabbit.","answer":"Unknown","QDep":0,"QLen":"","strategy":"random","proofs":"[@0: The cow chases the rabbit.[CWA. Example of deepest failure = (FAIL)]]","representation":"(\"cow\" \"chases\" \"rabbit\" \"+\")"},
    "Q11":{"question":"The rabbit is not rough.","answer":"Unknown","QDep":0,"QLen":"","strategy":"inv-random","proofs":"[@0: The rabbit is rough.[CWA. Example of deepest failure = (FAIL)]]","representation":"(\"rabbit\" \"is\" \"rough\" \"-\")"},
    "Q12":{"question":"The dog is red.","answer":"Unknown","QDep":0,"QLen":"","strategy":"random","proofs":"[@0: The dog is red.[CWA. Example of deepest failure = (FAIL)]]","representation":"(\"dog\" \"is\" \"red\" \"+\")"}},
  "allProofs":"@0: The cow is big.[(triple1)] The cow needs the dog.[(triple2)] The dog sees the rabbit.[(triple3)] The rabbit chases the cow.[(triple4)] The rabbit chases the dog.[(triple5 OR ((triple6) -> rule3))] The rabbit is big.[(triple6)] The rabbit sees the dog.[(triple7)] @1: The cow chases the dog.[(((triple1) -> rule3))] @2: The cow sees the rabbit.[(((((triple1) -> rule3)) -> rule2))]",
  "proofDetails":[
    {"text":"The cow is big.","QDep":0,"representation":"(\"cow\" \"is\" \"big\" \"+\")","proofsWithIntermediates":[{"representation":"triple1","intermediates":[]}]},
    {"text":"The cow needs the dog.","QDep":0,"representation":"(\"cow\" \"needs\" \"dog\" \"+\")","proofsWithIntermediates":[{"representation":"triple2","intermediates":[]}]},
    {"text":"The dog sees the rabbit.","QDep":0,"representation":"(\"dog\" \"sees\" \"rabbit\" \"+\")","proofsWithIntermediates":[{"representation":"triple3","intermediates":[]}]},
    {"text":"The rabbit chases the cow.","QDep":0,"representation":"(\"rabbit\" \"chases\" \"cow\" \"+\")","proofsWithIntermediates":[{"representation":"triple4","intermediates":[]}]},
    {"text":"The rabbit chases the dog.","QDep":0,"representation":"(\"rabbit\" \"chases\" \"dog\" \"+\")","proofsWithIntermediates":[{"representation":"triple5","intermediates":[]},{"representation":"((triple6) -> (rule3 % int1))","intermediates":{"int1":{"text":"The rabbit chases the dog.","representation":"(\"rabbit\" \"chases\" \"dog\" \"+\")"}}}]},
    {"text":"The rabbit is big.","QDep":0,"representation":"(\"rabbit\" \"is\" \"big\" \"+\")","proofsWithIntermediates":[{"representation":"triple6","intermediates":[]}]},
    {"text":"The rabbit sees the dog.","QDep":0,"representation":"(\"rabbit\" \"sees\" \"dog\" \"+\")","proofsWithIntermediates":[{"representation":"triple7","intermediates":[]}]},
    {"text":"The cow chases the dog.","QDep":1,"representation":"(\"cow\" \"chases\" \"dog\" \"+\")","proofsWithIntermediates":[{"representation":"((triple1) -> (rule3 % int1))","intermediates":{"int1":{"text":"The cow chases the dog.","representation":"(\"cow\" \"chases\" \"dog\" \"+\")"}}}]},
    {"text":"The cow sees the rabbit.","QDep":2,"representation":"(\"cow\" \"sees\" \"rabbit\" \"+\")","proofsWithIntermediates":[{"representation":"((((triple1) -> (rule3 % int2))) -> (rule2 % int1))","intermediates":{"int1":{"text":"The cow sees the rabbit.","representation":"(\"cow\" \"sees\" \"rabbit\" \"+\")"},"int2":{"text":"The cow chases the dog.","representation":"(\"cow\" \"chases\" \"dog\" \"+\")"}}}]}
  ]
}
```

Description of the `meta-(train/dev/test).jsonl` fields:

* `id`: The id of the rulebase.
* `maxD`: The max depth of the questions for rulebase.
* `NFact`: The number of facts (triples) in the rulebase.
* `NRule`: The number of rules in the rulebase.
* `theory`: The plain text sentences of the theory in fixed order (for more robustness can scramble these)
* `triples`: A list of the facts (triples), sequentially identified as triple1, triple2, etc. For each fact:
  * `text`: The (synthetic) language associated with the triple.
  * `representation`: The lisp-format representation of the triple in the form "(arg1 rel arg2 polarity)" where rel is set to "is" for attributes, and polarity is "+" or "-".
* `rules`: The list of rules in the rulebase, identified as rule1, rule2, etc. For each rule:
    * `text`: The (synthetic) language associated with the rule
    * `representation`: The lisp-format representation of the rule, of the form (lhs1 lhs2 ...) -> rhs 
    representing the meaning "if lhs1 and lhs2 and ... then rhs". Each lhs and rhs is in the same format as the 
    triples above, but can contain the generic "something" argument, while in the lhs a negative polarity is represented 
    as "~", which is interpreted as negation as failure (NAF) in the CWA theories.
* `questions`: Each of the True/False(/Unknown) questions for the rulebase, identified as Q1, Q2, etc. For each question:
  * `question`: The (synthetic) language associated with the question
  * `representation`: The lisp-format representation of the question, same as the triple format described above.
  * `answer`: Specifiying the truth value of the question (`true` or `false`, in OWA theories can also have `Unknown`).
  * `QDep`: The "depth" of the "proof" for the question.
  * `QLen`: The "length" of the "proof" (number of leaves).
  * `strategy`: How the statement was derived, one of:
      * "proof" / "inv-proof": A proven statement (or its negation).
      * "rconc" / "inv-rconc": An unproven rule conclusion in the rulebase (or its negation).
      * "random" / "inv-random": A randomly selected unproven statement not covered by the above (or its negation).
  * `proofs`: The possible proofs for the truth-value of the question, or examples of deepest failure when the closed world
  assumption (CWA) is invoked. If multiple proof paths are possible, they are separated by "OR".
  * `proofsWithIntermediates`: List of possible proofs with intermediate implications, shallowest proofs first. For each list item:
    * `representation`: The proof string, which might have references to intermediates, like "int1".
    * `intermediates`: Lookup for each intermediate output, with value fields:
      * `text`: Plain text for intermediate output
      * `representation`: Lisp-format representation of intermediate output.
* `allProofs`: For each depth, this gives all the provable statements in the rulebase along with their proofs.
* `proofDetails`: List of all provable impliciations of theory. For each list item:
  * `text`: Plain text for implication.
  * `QDep`: Depth of (shallowest) proof.
  * `proofsWithIntermediates`: List of possible proofs with intermediate implications, see description right above.
  
For the ParaRules theories (`NatLang` directory), there are two additional fields describing how the paraphrased sentences relate
to the original triples and rules. E.g., here we see how both `triple1` ("Bob is green") and `triple2` ("Bob is blue") are
mapped to the same sentence `sent1` ("Bob has been blue because he's green with envy"):

```
{
  "id":"AttNonegNatLang-OWA-146","maxD":3,"NFact":9,"NRule":6,
  "theory":"Bob has been blue because he's green with envy. The round, rough, and green one was labeled Eric after all. Gary is feeling blue because he thinks he has been too nice to people which makes him red in anger and causes him to act in a rough manner. People who are round and red are young. If someone is green faced and has cold skin and a red body then you'll often find that their sentiment is blue. Nice blue people are usually round in shape. Anyone known to be red, young and blue will also be found to be cold. Big and round young people are often nice. Green, red and blue people tend to be big.",
  "triples":{
    "triple1":{"text":"Bob is green.","representation":"(\"Bob\" \"is\" \"green\" \"+\")"},
    "triple2":{"text":"Bob is blue.","representation":"(\"Bob\" \"is\" \"blue\" \"+\")"},
    "triple3":{"text":"Eric is round.","representation":"(\"Eric\" \"is\" \"round\" \"+\")"},
...
  "mappings":{"triple1":"sent1","triple2":"sent1","triple3":"sent2","triple4":"sent2","triple5":"sent2","triple6":"sent3","triple7":"sent3","triple8":"sent3","triple9":"sent3","rule1":"sent4","rule2":"sent5","rule3":"sent6","rule4":"sent7","rule5":"sent8","rule6":"sent9"},
  "sentences":{"sent1":"Bob has been blue because he's green with envy.","sent2":"The round, rough, and green one was labeled Eric after all.","sent3":"Gary is feeling blue because he thinks he has been too nice to people which makes him red in anger and causes him to act in a rough manner.","sent4":"People who are round and red are young.","sent5":"If someone is green faced and has cold skin and a red body then you'll often find that their sentiment is blue.","sent6":"Nice blue people are usually round in shape.","sent7":"Anyone known to be red, young and blue will also be found to be cold.","sent8":"Big and round young people are often nice.","sent9":"Green, red and blue people tend to be big."}}
```

where the fields are

* `mappings`: Map from triple/rule identifiers to sentence identifiers
* `sentences`: Map from sentence identifiers to plain text sentences.



## Format of `meta-stage-(train/dev/test).jsonl` files

These files contain the augmented dataset used to train the incremental ProofWriter by building up a sample
sequence of D=1 implications to get the full set of implications for a rulebase. 

Here is the example corresponding to the example above:

```
{
  "id":"RelNeg-OWA-D2-1717-add0","maxD":2,"NFact":7,"NRule":3,
  "triples":{
    "triple1":{"text":"The cow is big.","representation":"(\"cow\" \"is\" \"big\" \"+\")"},
    "triple2":{"text":"The cow needs the dog.","representation":"(\"cow\" \"needs\" \"dog\" \"+\")"}
    ...
    "triple7":{"text":"The rabbit sees the dog.","representation":"(\"rabbit\" \"sees\" \"dog\" \"+\")"}}
  "rules":{"rule1": ...},
  "allInferences":[{"text":"The cow chases the dog.","proofs":"[(((triple1) -> rule3))]"}]
}
{
  "id":"RelNeg-OWA-D2-1717-add1","maxD":2,"NFact":7,"NRule":3,
  "triples":{
    "triple1":{"text":"The cow is big.","representation":"(\"cow\" \"is\" \"big\" \"+\")"},
    "triple2":{"text":"The cow needs the dog.","representation":"(\"cow\" \"needs\" \"dog\" \"+\")"},
    ...
    "triple7":{"text":"The rabbit sees the dog.","representation":"(\"rabbit\" \"sees\" \"dog\" \"+\")"},
    "triple8":{"text":"The cow chases the dog."}},
  "rules":{"rule1": ...},
  "allInferences":[{"text":"The cow sees the rabbit.","proofs":"[(((triple8) -> rule2))]"}]
}
{
  "id":"RelNeg-OWA-D2-1717-add2","maxD":2,"NFact":7,"NRule":3,
  "triples":{
    "triple1":{"text":"The cow is big.","representation":"(\"cow\" \"is\" \"big\" \"+\")"},
    "triple2":{"text":"The cow needs the dog.","representation":"(\"cow\" \"needs\" \"dog\" \"+\")"},
    ...
    "triple7":{"text":"The rabbit sees the dog.","representation":"(\"rabbit\" \"sees\" \"dog\" \"+\")"},
    "triple8":{"text":"The cow chases the dog.",
    "triple9":{"text":"The cow sees the rabbit."}},
  "rules":{"rule1": ...},
  "allInferences":[]
}
```

The format is a subset of the meta-(train/dev/test).jsonl format above, where the `id` field has been
appended with a suffix `-add0`, `-add1`, etc indicating how many implications have been added to
the theory. The `allInferences` field lists all possible depth-1 inferences, with proofs, given 
current list of triples and rules. If there are multiple inferences possible in the Nth step (`-addN`), then
the N+1th step will have added a random one of these as a new triple, 
while the rest carry over to the next `allInferences` field.



## Format of `meta-abduct-(train/dev/test).jsonl` files

Here is a sample entry:

```
{
  "id":"AttNeg-OWA-D3-1349",
  "triples":{
    "triple1":{"text":"Bob is quiet.","representation":"(\"Bob\" \"is\" \"quiet\" \"+\")"},
    "triple2":{"text":"Dave is kind.","representation":"(\"Dave\" \"is\" \"kind\" \"+\")"},
    "triple3":{"text":"Fiona is cold.","representation":"(\"Fiona\" \"is\" \"cold\" \"+\")"}},
  "rules":{
    "rule1":{"text":"All quiet things are green.","representation":"(((\"something\" \"is\" \"quiet\" \"+\")) -> (\"something\" \"is\" \"green\" \"+\"))"},
    "rule2":{"text":"If something is rough then it is smart.","representation":"(((\"something\" \"is\" \"rough\" \"+\")) -> (\"something\" \"is\" \"smart\" \"+\"))"},
    "rule3":{"text":"All green things are rough.","representation":"(((\"something\" \"is\" \"green\" \"+\")) -> (\"something\" \"is\" \"rough\" \"+\"))"}},
  "abductions":{
    "MF11":{"question":"Dave is not green.","answers":[]},
    "MF19":{"question":"Dave is smart.","answers":[{"text":"Dave is rough.","proof":"[(((tripleM) -> rule2))]","QDep":"1"},{"text":"Dave is green.","proof":"[(((((tripleM) -> rule3)) -> rule2))]","QDep":"2"},{"text":"Dave is quiet.","proof":"[(((((((tripleM) -> rule1)) -> rule3)) -> rule2))]","QDep":"3"}]},
    "MF20":{"question":"Fiona is smart.","answers":[{"text":"Fiona is rough.","proof":"[(((tripleM) -> rule2))]","QDep":"1"},{"text":"Fiona is green.","proof":"[(((((tripleM) -> rule3)) -> rule2))]","QDep":"2"},{"text":"Fiona is quiet.","proof":"[(((((((tripleM) -> rule1)) -> rule3)) -> rule2))]","QDep":"3"}]},
    "MF21":{"question":"Dave is rough.","answers":[{"text":"Dave is green.","proof":"[(((tripleM) -> rule3))]","QDep":"1"},{"text":"Dave is quiet.","proof":"[(((((tripleM) -> rule1)) -> rule3))]","QDep":"2"}]},
    "MF22":{"question":"Fiona is rough.","answers":[{"text":"Fiona is green.","proof":"[(((tripleM) -> rule3))]","QDep":"1"},{"text":"Fiona is quiet.","proof":"[(((((tripleM) -> rule1)) -> rule3))]","QDep":"2"}]},
    "MF23":{"question":"Dave is green.","answers":[{"text":"Dave is quiet.","proof":"[(((tripleM) -> rule1))]","QDep":"1"}]},
    "MF24":{"question":"Fiona is green.","answers":[{"text":"Fiona is quiet.","proof":"[(((tripleM) -> rule1))]","QDep":"1"}]}
  }
}
```

Description of the fields:

* `id`: The theory id, same as in corresponding meta-(train/dev/test).jsonl file where more metadata can be found.
* `triples`, `rules`: Core theory repeated, see description above.
* `abductions`: List of questions and their abducted missing facts, each entry has and identifier (MF11 will 
correspond to Q11 in the original theory, except cases where more examples were augmented). Each entry has fields:
  * `question`: The question text that we want to make true.
  * `answers`: List of answers (single facts) which make the question statement true. Each answer has fields:
    * `text`: The text of the missing fact.
    * `proof`: The proof(s) of the questions using the missing fact, represented in the proofs as `tripleM`.

### Changelog

   * V2020.12.3: Fixed mismatched `theory` field for some theories, so it now always matches the text in `triples` and `rules`, rather than sometimes using a different language variant of the rules. 
    
 