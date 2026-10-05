const DB_NAME = 'nutrirural-db';
const DB_VERSION = 1;

let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción cancelada'));
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('children')) {
        const store = db.createObjectStore('children', { keyPath: 'id' });
        store.createIndex('code', 'code', { unique: true });
        store.createIndex('community', 'community');
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('assessments')) {
        const store = db.createObjectStore('assessments', { keyPath: 'id' });
        store.createIndex('childId', 'childId');
        store.createIndex('date', 'date');
        store.createIndex('risk', 'screening.risk');
      }
      if (!db.objectStoreNames.contains('surveys')) {
        const store = db.createObjectStore('surveys', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function put(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await txDone(tx);
  return value;
}

export async function bulkPut(storeName, values) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await txDone(tx);
}

export async function get(storeName, id) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).get(id));
}

export async function getAll(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).getAll());
}

export async function remove(storeName, id) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await txDone(tx);
}

export async function clearStore(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await txDone(tx);
}

export async function getSetting(key, fallback = null) {
  const item = await get('settings', key);
  return item ? item.value : fallback;
}

export async function setSetting(key, value) {
  return put('settings', { key, value, updatedAt: new Date().toISOString() });
}

export function newId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export async function seedDemoData() {
  const alreadySeeded = await getSetting('seeded', false);
  if (alreadySeeded) return;

  const now = new Date();
  const daysAgo = (n) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const yearsAgo = (years, months = 0) => {
    const d = new Date(now.getFullYear() - years, now.getMonth() - months, 15);
    return d.toISOString().slice(0, 10);
  };

  const children = [
    { id: 'child-demo-1', code: 'PAR-001', firstName: 'Lucía', lastName: 'Quispe', sex: 'F', dob: yearsAgo(2, 5), community: 'Ccapi', caregiver: 'Rosa Q.', phone: '', facility: 'Centro de Salud Paruro', notes: 'Registro demostrativo', createdAt: now.toISOString(), updatedAt: now.toISOString(), syncStatus: 'pending' },
    { id: 'child-demo-2', code: 'PAR-002', firstName: 'Mateo', lastName: 'Huamán', sex: 'M', dob: yearsAgo(1, 8), community: 'Yaurisque', caregiver: 'Elena H.', phone: '', facility: 'Centro de Salud Paruro', notes: 'Registro demostrativo', createdAt: now.toISOString(), updatedAt: now.toISOString(), syncStatus: 'pending' },
    { id: 'child-demo-3', code: 'PAR-003', firstName: 'Ana', lastName: 'Condori', sex: 'F', dob: yearsAgo(3, 1), community: 'Omacha', caregiver: 'María C.', phone: '', facility: 'Puesto de Salud Omacha', notes: 'Registro demostrativo', createdAt: now.toISOString(), updatedAt: now.toISOString(), syncStatus: 'pending' }
  ];

  const assessments = [
    { id: 'assess-demo-1', childId: 'child-demo-1', date: daysAgo(2), weightKg: 11.2, heightCm: 86.4, muacMm: 133, edema: false, nextControlDate: daysAgo(-28), notes: '', screening: { ageMonths: 29, waz: -0.7, haz: -0.9, whz: -0.4, bmi: 15.0, muacClass: 'normal', risk: 'normal', label: 'Sin alerta nutricional', recommendation: 'Mantener control según programación local.', flags: [] }, createdAt: now.toISOString(), updatedAt: now.toISOString(), syncStatus: 'pending' },
    { id: 'assess-demo-2', childId: 'child-demo-2', date: daysAgo(1), weightKg: 8.0, heightCm: 79.6, muacMm: 121, edema: false, nextControlDate: daysAgo(-7), notes: 'Repetir medición y coordinar evaluación.', screening: { ageMonths: 20, waz: -2.2, haz: -1.6, whz: -2.1, bmi: 12.6, muacClass: 'moderate', risk: 'high', label: 'Riesgo nutricional alto', recommendation: 'Verificar mediciones y coordinar evaluación por personal de salud con prioridad.', flags: [] }, createdAt: now.toISOString(), updatedAt: now.toISOString(), syncStatus: 'pending' },
    { id: 'assess-demo-3', childId: 'child-demo-3', date: daysAgo(4), weightKg: 11.1, heightCm: 91.7, muacMm: 114, edema: false, nextControlDate: daysAgo(-2), notes: 'Alerta demostrativa.', screening: { ageMonths: 37, waz: -2.8, haz: -2.5, whz: -2.6, bmi: 13.2, muacClass: 'severe', risk: 'severe', label: 'Alerta prioritaria', recommendation: 'Derivación y evaluación clínica inmediata según protocolo local.', flags: [] }, createdAt: now.toISOString(), updatedAt: now.toISOString(), syncStatus: 'pending' }
  ];

  await bulkPut('children', children);
  await bulkPut('assessments', assessments);
  await setSetting('seeded', true);
  await setSetting('facility', 'Centro de Salud Paruro');
  await setSetting('community', 'Paruro');
  await setSetting('apiUrl', '');
}

export async function exportDatabase() {
  const [children, assessments, surveys, settings] = await Promise.all([
    getAll('children'), getAll('assessments'), getAll('surveys'), getAll('settings')
  ]);
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: DB_VERSION,
    children,
    assessments,
    surveys,
    settings
  };
}

export async function resetDatabase() {
  await Promise.all(['children', 'assessments', 'surveys', 'settings'].map(clearStore));
  await seedDemoData();
}
