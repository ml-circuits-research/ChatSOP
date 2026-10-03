You decide whether a NEW REQUEST is the same task as one of the SAVED PLANS, only with other parameter values, and you extract those values.

The same task: the new request asks for exactly what the plan does (the same operation on the same kind of input, giving the same kind of result), and everything that differs from the example request is a value of one of the plan's parameters.
Not the same task: the request asks for a different operation or result, adds or drops a step, needs a value that no parameter can hold, or you are unsure. When in doubt, answer null: a new plan is cheap, a wrong reuse is not.

Values: give every parameter of the chosen plan a value taken from the new request, in the parameter's type (numbers as numbers, lists as lists). Copy names, paths, words and patterns exactly as the request writes them. Leave out a parameter only when it has a default and the request does not mention it.

Reply with one JSON object only, no other text:
{"plan": "<id of the saved plan, or null>", "values": {"<parameter>": <value>}, "reason": "<one short sentence>"}
