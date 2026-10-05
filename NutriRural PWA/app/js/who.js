let referencePromise;

export function loadReference() {
  if (!referencePromise) {
    referencePromise = fetch('./data/who_reference.json').then((response) => {
      if (!response.ok) throw new Error('No se pudieron cargar las tablas OMS');
      return response.json();
    });
  }
  return referencePromise;
}

export function completedMonths(dob, date) {
  const birth = new Date(`${dob}T12:00:00`);
  const control = new Date(`${date}T12:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(control.getTime()) || control < birth) return null;
  let months = (control.getFullYear() - birth.getFullYear()) * 12 + control.getMonth() - birth.getMonth();
  if (control.getDate() < birth.getDate()) months -= 1;
  return months;
}

function interpolate(rows, x) {
  if (!Number.isFinite(x) || !rows.length) return null;
  if (x <= rows[0].x) return rows[0];
  if (x >= rows[rows.length - 1].x) return rows[rows.length - 1];

  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid].x === x) return rows[mid];
    if (rows[mid].x < x) lo = mid + 1;
    else hi = mid - 1;
  }
  const left = rows[Math.max(0, hi)];
  const right = rows[Math.min(rows.length - 1, lo)];
  const ratio = (x - left.x) / (right.x - left.x);
  const out = { x };
  for (const key of ['l', 'm', 's', 'n3', 'n2', 'n1', 'z0', 'p1', 'p2', 'p3']) {
    out[key] = left[key] + (right[key] - left[key]) * ratio;
  }
  return out;
}

function lmsZ(value, row) {
  if (!row || !Number.isFinite(value) || value <= 0) return null;
  const { l, m, s } = row;
  if (![l, m, s].every(Number.isFinite) || m <= 0 || s <= 0) return null;
  return Math.abs(l) < 1e-12
    ? Math.log(value / m) / s
    : (Math.pow(value / m, l) - 1) / (l * s);
}

// WHO recommends a linear SD correction beyond ±3 SD for weight-based indices.
function correctedWeightZ(value, row) {
  let z = lmsZ(value, row);
  if (z == null) return null;
  if (z > 3 && row.p3 > row.p2) z = 3 + (value - row.p3) / (row.p3 - row.p2);
  if (z < -3 && row.n2 > row.n3) z = -3 + (value - row.n3) / (row.n2 - row.n3);
  return z;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function classifyMuac(muacMm, ageMonths) {
  if (!Number.isFinite(muacMm)) return { code: 'not-recorded', label: 'No registrado' };
  if (ageMonths < 6 || ageMonths > 59) return { code: 'not-applicable', label: 'Fuera de rango 6–59 meses' };
  if (muacMm < 115) return { code: 'severe', label: 'MUAC < 115 mm' };
  if (muacMm < 125) return { code: 'moderate', label: 'MUAC 115–124 mm' };
  return { code: 'normal', label: 'MUAC ≥ 125 mm' };
}

function scoreRisk({ waz, haz, whz, muacClass, edema }) {
  if (edema || muacClass === 'severe' || (Number.isFinite(whz) && whz < -3)) {
    return {
      risk: 'severe',
      label: 'Alerta prioritaria',
      recommendation: 'Derivación y evaluación clínica inmediata según el protocolo local.'
    };
  }
  if (muacClass === 'moderate' || [waz, haz, whz].some((z) => Number.isFinite(z) && z < -2)) {
    return {
      risk: 'high',
      label: 'Riesgo nutricional alto',
      recommendation: 'Verificar las mediciones y coordinar una evaluación prioritaria por personal de salud.'
    };
  }
  if ([waz, haz, whz].some((z) => Number.isFinite(z) && z < -1)) {
    return {
      risk: 'observe',
      label: 'Requiere observación',
      recommendation: 'Repetir la medición, revisar la tendencia y programar seguimiento según criterio profesional.'
    };
  }
  return {
    risk: 'normal',
    label: 'Sin alerta nutricional',
    recommendation: 'Mantener el control periódico según la programación local.'
  };
}

export async function screenChild({ child, date, weightKg, heightCm, position = 'auto', muacMm, edema = false }) {
  const reference = await loadReference();
  const ageMonths = completedMonths(child.dob, date);
  const flags = [];
  const weight = Number(weightKg);
  const rawHeight = Number(heightCm);
  const muac = muacMm === '' || muacMm == null ? null : Number(muacMm);

  if (ageMonths == null) flags.push('La fecha del control debe ser posterior al nacimiento.');
  if (ageMonths != null && (ageMonths < 0 || ageMonths > 60)) flags.push('Las referencias del prototipo cubren de 0 a 60 meses.');
  if (!Number.isFinite(weight) || weight < 1 || weight > 40) flags.push('Revise el peso registrado.');
  if (!Number.isFinite(rawHeight) || rawHeight < 40 || rawHeight > 125) flags.push('Revise la longitud o talla registrada.');

  if (ageMonths == null || ageMonths < 0 || ageMonths > 60 || !Number.isFinite(weight) || !Number.isFinite(rawHeight)) {
    return { ageMonths, waz: null, haz: null, whz: null, bmi: null, muacClass: 'not-recorded', risk: 'observe', label: 'Datos por verificar', recommendation: 'Corrija los datos antes de emitir el tamizaje.', flags };
  }

  const sex = child.sex === 'F' ? 'F' : 'M';
  const expectedPosition = ageMonths < 24 ? 'length' : 'height';
  const actualPosition = position === 'auto' ? expectedPosition : position;
  let normalizedHeight = rawHeight;

  // Conversion convention used in WHO Anthro: recumbent length is about 0.7 cm greater than standing height.
  if (expectedPosition === 'length' && actualPosition === 'height') {
    normalizedHeight = rawHeight + 0.7;
    flags.push('Se sumaron 0,7 cm para convertir talla de pie a longitud según la edad.');
  } else if (expectedPosition === 'height' && actualPosition === 'length') {
    normalizedHeight = rawHeight - 0.7;
    flags.push('Se restaron 0,7 cm para convertir longitud acostado a talla según la edad.');
  }

  const ageX = Math.max(0, Math.min(60, Math.round(ageMonths)));
  const wfaRow = interpolate(reference.wfa[sex], ageX);
  const hfaRow = interpolate(reference.hfa[sex], ageX);
  const whTable = expectedPosition === 'length' ? reference.wfl[sex] : reference.wfh[sex];
  const minH = whTable[0].x;
  const maxH = whTable[whTable.length - 1].x;
  let whz = null;
  if (normalizedHeight >= minH && normalizedHeight <= maxH) {
    whz = correctedWeightZ(weight, interpolate(whTable, normalizedHeight));
  } else {
    flags.push(`La medida ${round(normalizedHeight, 1)} cm está fuera del rango de peso para longitud/talla disponible.`);
  }

  const waz = correctedWeightZ(weight, wfaRow);
  const haz = lmsZ(normalizedHeight, hfaRow);
  const bmi = weight / Math.pow(rawHeight / 100, 2);
  const muacResult = classifyMuac(muac, ageMonths);
  const risk = scoreRisk({ waz, haz, whz, muacClass: muacResult.code, edema: Boolean(edema) });

  return {
    ageMonths,
    normalizedHeightCm: round(normalizedHeight, 1),
    waz: round(waz),
    haz: round(haz),
    whz: round(whz),
    bmi: round(bmi, 1),
    muacMm: Number.isFinite(muac) ? muac : null,
    muacClass: muacResult.code,
    muacLabel: muacResult.label,
    edema: Boolean(edema),
    ...risk,
    flags
  };
}

export const riskLabels = {
  normal: 'Sin alerta',
  observe: 'Observación',
  high: 'Riesgo alto',
  severe: 'Prioritaria'
};
