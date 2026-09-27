(set-option :timeout 3000)
(set-logic QF_LIA)
(declare-const arrival Int)
(assert (>= arrival 0))
(assert (<= arrival 1440))
(assert (= arrival (+ 770 70)))

; Base premises
(check-sat)
(get-model)
; Is the claim possible?
(push)
(assert (<= arrival 840))
(check-sat)
(pop)
; Is its negation possible?
(push)
(assert (not (<= arrival 840)))
(check-sat)
(pop)
