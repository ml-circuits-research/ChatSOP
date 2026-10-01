import {loadCalibration} from './severity-calibration.mjs';
import {mechanicalSeverity} from '../../lib/severity/mechanical.mjs';
const rows = loadCalibration(); const conf = {};
const fp = [], miss = [];
for (const r of rows) { const m = mechanicalSeverity(r.message, r.candidate); const k = `${r.severity}->${m.decided ? m.severity : 'residue'}`; conf[k] = (conf[k] ?? 0) + 1; if (m.decided && m.severity === 'S4' && r.severity !== 'S4') fp.push([r.id, r.severity, r.message, r.candidate, m.flags.filter(f => f.certain).map(f => f.kind + ':' + f.detail).join(';')]); if (!m.decided && r.severity === 'S4') miss.push(r.id); }
console.log(conf); console.log('false S4:', fp.length); for (const f of fp.slice(0, +process.argv[2] || 40)) console.log(f.join(' | '));
