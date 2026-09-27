/** Bank choice is independent of SOP syntax, temporal semantics and reasoner. */
import {HybridBank} from './hybrid.js';
import {Weaver} from '../../memory.js';
import {HoloBank} from './holo.js';
import {SQLiteBank} from './sqlite.js';
import {ScanBank} from './scan.js';
export function bankEngine(stateOrConfig={}){
 if(stateOrConfig.format==='hybrid-fact-bank-v1')return 'hybrid';
 if(stateOrConfig.format==='h7-fact-bank-v1')return 'holo';
 if(stateOrConfig.format==='sqlite-fact-bank-v1')return 'sqlite';
 if(stateOrConfig.format==='scan-fact-bank-v1')return 'scan';
 return (stateOrConfig.config??stateOrConfig).engine??'weaver';
}
export function createBank(config={},state=null){
 const engine=bankEngine(state??config),C={weaver:Weaver,holo:HoloBank,sqlite:SQLiteBank,scan:ScanBank,hybrid:HybridBank}[engine];
 if(!C)throw Error('Unknown memory.engine '+engine);
 return state?C.from(state):new C(config);
}
export const bankBytes=bank=>typeof bank.bankBytes==='function'?bank.bankBytes():bank.banks.length*bank.cells/2;
