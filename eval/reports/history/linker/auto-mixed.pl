:- use_module(library(http/json)).
:- use_module(library(solution_sequences)).
:- use_module(library(time)).
:- table rw/3.
:- discontiguous rw/3.
rw('6475726174696f6e',[s('726f7574655f64656d6f'),n(70)],0).
rw(_,_,_) :- fail.
term_json(s(X), _{s:X}).
term_json(n(X), _{n:X}).
main :- call_with_time_limit(3,findnsols(10001,_{p:P,a:J,neg:N},(rw(P,A,N),maplist(term_json,A,J)),Rows)),json_write_dict(current_output,Rows),nl,halt.
:- initialization(main, main).
