(set-option :timeout 3000)
(set-logic QF_LIA)
(declare-const answer__arrival Int)
(assert (>= answer__arrival 0))
(assert (<= answer__arrival 1440))
(assert (= answer__arrival (+ 770 70)))

; Base premises
(check-sat)
(get-model)
; Is the claim possible?
(push)
(assert (<= answer__arrival 840))
(check-sat)
(pop)
; Is its negation possible?
(push)
(assert (not (<= answer__arrival 840)))
(check-sat)
(pop)
