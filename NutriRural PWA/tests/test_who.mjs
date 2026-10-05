import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const reference = JSON.parse(await fs.readFile(path.join(root, 'app/data/who_reference.json'), 'utf8'));
globalThis.fetch = async () => ({ ok: true, json: async () => reference });
const { screenChild, completedMonths } = await import('../app/js/who.js');

if (completedMonths('2024-01-15', '2024-07-15') !== 6) throw new Error('Cálculo de edad incorrecto');

const boy = { sex: 'M', dob: '2026-01-01' };
const result = await screenChild({
  child: boy,
  date: '2026-01-01',
  weightKg: 3.3464,
  heightCm: 49.8842,
  position: 'length',
  muacMm: '',
  edema: false,
});
if (Math.abs(result.waz) > 0.01) throw new Error(`WAZ esperado cercano a 0, obtenido ${result.waz}`);
if (Math.abs(result.haz) > 0.01) throw new Error(`HAZ esperado cercano a 0, obtenido ${result.haz}`);
if (!Number.isFinite(result.whz)) throw new Error('WHZ no calculado');
console.log('OK: cálculo JavaScript de edad y puntajes z operativo.');
