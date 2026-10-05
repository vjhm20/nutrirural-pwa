// Verificacion tecnica del motor de tamizaje de NutriRural.
//
// Ejecuta cuatro comprobaciones independientes y emite un JSON con las
// metricas que se reportan en el capitulo de resultados de la tesis:
//   V1. Exactitud de la inversion LMS (ida y vuelta valor <-> puntaje z).
//   V2. Concordancia con los puntos de corte tabulados por la OMS y su cota
//       teorica de redondeo.
//   V3. Comportamiento de las reglas de clasificacion de riesgo.
//   V4. Rendimiento del tamizaje y tamano de la carga util offline.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const ref = JSON.parse(await fs.readFile(path.join(root, 'app/data/who_reference.json'), 'utf8'));
globalThis.fetch = async () => ({ ok: true, json: async () => ref });
const { screenChild, completedMonths } = await import('../app/js/who.js');

const TABLAS = [
  ['Peso para la edad (P/E)', 'wfa', 0.1],
  ['Longitud o talla para la edad (T/E)', 'hfa', 0.1],
  ['Peso para la longitud (P/L)', 'wfl', 0.1],
  ['Peso para la talla (P/T)', 'wfh', 0.1]
];
const COLS = [['n3', -3], ['n2', -2], ['n1', -1], ['z0', 0], ['p1', 1], ['p2', 2], ['p3', 3]];

const lmsZ = (v, r) => (Math.abs(r.l) < 1e-12 ? Math.log(v / r.m) / r.s : (Math.pow(v / r.m, r.l) - 1) / (r.l * r.s));
const lmsValor = (z, r) => (Math.abs(r.l) < 1e-12 ? r.m * Math.exp(r.s * z) : r.m * Math.pow(1 + r.l * r.s * z, 1 / r.l));

// ---- V1. Inversion LMS ------------------------------------------------------
let v1n = 0;
let v1max = 0;
for (const [, clave] of TABLAS) {
  for (const sexo of ['M', 'F']) {
    for (const row of ref[clave][sexo]) {
      for (let z = -4; z <= 4; z += 0.25) {
        const valor = lmsValor(z, row);
        if (!Number.isFinite(valor) || valor <= 0) continue;
        v1max = Math.max(v1max, Math.abs(lmsZ(valor, row) - z));
        v1n += 1;
      }
    }
  }
}

// ---- V2. Concordancia con los cortes tabulados ------------------------------
const v2 = [];
for (const [nombre, clave, paso] of TABLAS) {
  let n = 0;
  let suma = 0;
  let max = 0;
  let dentroDeCota = 0;
  let peor = null;
  for (const sexo of ['M', 'F']) {
    for (const row of ref[clave][sexo]) {
      // Amplitud de 1 DE estimada como el promedio de los intervalos vecinos.
      const de = (row.p3 - row.n3) / 6;
      const cota = de > 0 ? paso / 2 / de : Infinity;
      for (const [col, nominal] of COLS) {
        const err = Math.abs(lmsZ(row[col], row) - nominal);
        suma += err;
        n += 1;
        if (err <= cota + 1e-9) dentroDeCota += 1;
        if (err > max) { max = err; peor = { sexo, x: row.x, col, err: +err.toFixed(4), cota: +cota.toFixed(4) }; }
      }
    }
  }
  v2.push({ tabla: nombre, puntos: n, errorMedio: +(suma / n).toFixed(4), errorMaximo: +max.toFixed(4), dentroDeCotaPct: +(100 * dentroDeCota / n).toFixed(2), peorCaso: peor });
}

// ---- V3. Reglas de clasificacion -------------------------------------------
// Se construye un nino de referencia exactamente en la mediana para su edad y
// se perturba un unico factor por caso, de modo que el resultado dependa solo
// de la regla que se quiere probar.
const EDAD = 36;
const nino = { sex: 'M', dob: '2023-03-15' };
const fecha = '2026-03-15';
const filaHfa = ref.hfa.M.find((r) => r.x === EDAD);
const tallaMediana = filaHfa.m;
const filaWfh = ref.wfh.M.reduce((a, b) => (Math.abs(b.x - tallaMediana) < Math.abs(a.x - tallaMediana) ? b : a));
const pesoMediana = lmsValor(0, filaWfh);
const pesoZ = (z) => lmsValor(z, filaWfh);

const casos = [
  ['Nino en la mediana, MUAC 140 mm', { weightKg: pesoMediana, heightCm: tallaMediana, muacMm: 140, edema: false }, 'normal'],
  ['Edema bilateral presente', { weightKg: pesoMediana, heightCm: tallaMediana, muacMm: 140, edema: true }, 'severe'],
  ['MUAC 110 mm (< 115)', { weightKg: pesoMediana, heightCm: tallaMediana, muacMm: 110, edema: false }, 'severe'],
  ['MUAC 120 mm (115-124)', { weightKg: pesoMediana, heightCm: tallaMediana, muacMm: 120, edema: false }, 'high'],
  ['P/T por debajo de -3 DE', { weightKg: pesoZ(-3.4), heightCm: tallaMediana, muacMm: 140, edema: false }, 'severe'],
  ['P/T entre -3 y -2 DE', { weightKg: pesoZ(-2.5), heightCm: tallaMediana, muacMm: 140, edema: false }, 'high'],
  ['P/T entre -2 y -1 DE', { weightKg: pesoZ(-1.5), heightCm: tallaMediana, muacMm: 140, edema: false }, 'observe'],
  ['MUAC fuera del rango 6-59 meses', { weightKg: pesoMediana, heightCm: tallaMediana, muacMm: 110, edema: false, dob: '2025-11-15' }, 'normal']
];

const reglas = [];
for (const [caso, datos, esperado] of casos) {
  const { dob, ...medidas } = datos;
  const r = await screenChild({ child: dob ? { sex: 'M', dob } : nino, date: fecha, position: 'auto', ...medidas });
  reglas.push({ caso, esperado, obtenido: r.risk, ok: r.risk === esperado });
}

// ---- V4. Rendimiento y carga util offline ----------------------------------
const N = 5000;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i += 1) {
  await screenChild({ child: nino, date: fecha, weightKg: 12 + (i % 60) / 20, heightCm: 92 + (i % 40) / 10, position: 'auto', muacMm: 120 + (i % 30), edema: false });
}
const msPorTamizaje = Number(process.hrtime.bigint() - t0) / 1e6 / N;

const ACTIVOS = ['app/index.html', 'app/styles.css', 'app/manifest.webmanifest', 'app/sw.js', 'app/icons/icon.svg', 'app/icons/icon-192.png', 'app/icons/icon-512.png', 'app/js/app.js', 'app/js/db.js', 'app/js/who.js', 'app/js/api.js', 'app/data/who_reference.json'];
const activos = ACTIVOS.map((f) => ({ archivo: f, bytes: fss.statSync(path.join(root, f)).size }));
const totalBytes = activos.reduce((a, b) => a + b.bytes, 0);

const filasReferencia = TABLAS.reduce((acc, [, k]) => acc + ref[k].M.length + ref[k].F.length, 0);

console.log(JSON.stringify({
  V1_inversionLMS: { evaluaciones: v1n, errorMaximo: v1max },
  V2_concordanciaCortes: v2,
  V3_reglas: { total: reglas.length, correctas: reglas.filter((r) => r.ok).length, detalle: reglas },
  V4_desempeno: {
    filasReferencia,
    msPorTamizaje: +msPorTamizaje.toFixed(4),
    tamizajesPorSegundo: Math.round(1000 / msPorTamizaje),
    edadMeses: completedMonths(nino.dob, fecha),
    activosOffline: activos,
    cargaUtilOfflineKB: +(totalBytes / 1024).toFixed(1)
  }
}, null, 2));
