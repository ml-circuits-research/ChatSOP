import {referenceJs, advancedProlog, advancedZ3} from './product.mjs';
import {jsOracle} from './js-oracle.mjs';
import {prologTablingAdapter} from './prolog-tabling.mjs';
import {datalogSoplabAdapter} from './datalog-soplab.mjs';
import {datalogE10Adapter} from './datalog-e10.mjs';
import {vrcCompressedPlanning} from './vrc-compressed-planning.mjs';
import {closureTemplate} from './closure-template.mjs';
import {datalogSouffleAdapter} from './datalog-souffle.mjs';
import {worldsSopr} from './worlds-sopr.mjs';
import {aspClingoAdapter} from './asp-clingo.mjs';
import {sqlSqliteAdapter} from './sql-sqlite.mjs';
import {dreamingSessionAdapter} from './dreaming-session.mjs';
import {z3SmtBoundedAdapter} from './z3-smt-bounded.mjs';
import {conformCoreAdapter} from './conform-core.mjs';
import {htnPlanner} from './htn-strips-planner.mjs';
import {gologSwiAdapter} from './golog-swi.mjs';
import {llmAgentAdapters} from './llm-agent.mjs';
import {plannedAdapters} from './planned.mjs';

/**
 * One adapter per STRATEGY, not per route: js-reference, prolog-swi and z3-lia are the three strategies that run
 * through reasoning/ today (each declares its own capabilities); the two Datalog engines are wired read-only from the
 * unpacked zips; the rest are planned stubs.
 */
export const adapters = [referenceJs, jsOracle, prologTablingAdapter, advancedProlog, advancedZ3, datalogE10Adapter, datalogSoplabAdapter, vrcCompressedPlanning, closureTemplate, worldsSopr, dreamingSessionAdapter, datalogSouffleAdapter, aspClingoAdapter, sqlSqliteAdapter, z3SmtBoundedAdapter, conformCoreAdapter, htnPlanner, gologSwiAdapter, ...llmAgentAdapters, ...plannedAdapters];
