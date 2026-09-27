:- use_module(library(http/json)).
:- use_module(library(solution_sequences)).
:- use_module(library(time)).
:- table rw/3.
:- discontiguous rw/3.
rw('706172656e74',[s('626f6764616e'),s('636172696e61')],0).
rw('6d6f74686572',[s('616e61'),s('626f6764616e')],0).
rw('706172656e74',[V0,V1],0) :- rw('6d6f74686572',[V0,V1],0).
rw('706172656e74',[V0,V1],0) :- rw('666174686572',[V0,V1],0).
rw(_,_,_) :- fail.
term_json(s(X), _{s:X}).
term_json(n(X), _{n:X}).
main :- call_with_time_limit(3,findnsols(10001,_{p:P,a:J,neg:N},(rw(P,A,N),maplist(term_json,A,J)),Rows)),json_write_dict(current_output,Rows),nl,halt.
:- initialization(main, main).
