import { getAll, bulkPut, getSetting, setSetting } from './db.js';

// Direccion del servicio de consolidacion publicado. Se usa cuando el equipo no
// tiene una direccion propia configurada, de modo que la sincronizacion funcione
// sin que cada usuario tenga que escribirla. Para trabajar contra un servidor
// local basta con escribir su direccion en Configuracion, y esa tiene prioridad.
export const API_POR_DEFECTO = 'https://nutrirural-api.onrender.com';

function trimSlash(value) {
  return (value || '').trim().replace(/\/$/, '');
}

async function baseUrl() {
  const configurada = trimSlash(await getSetting('apiUrl', ''));
  return configurada || API_POR_DEFECTO;
}

// El servicio publicado en un plan gratuito se suspende cuando pasa un rato sin
// uso, y el primer intento puede tardar cerca de un minuto en despertarlo. Por
// eso la consulta de estado espera mas que antes y distingue ese caso.
export async function pingServer(timeoutMs = 8000) {
  const base = await baseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/health`, { signal: controller.signal, cache: 'no-store' });
    if (response.status === 404) {
      return { ok: false, message: 'No hay un servicio de consolidación en esa dirección.' };
    }
    if (!response.ok) return { ok: false, message: `El servidor respondió con el código ${response.status}.` };
    const data = await response.json();
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, message: error.name === 'AbortError'
      ? 'El servidor no respondió a tiempo. Si estaba en reposo, vuelva a intentar en un minuto.'
      : 'No se pudo contactar al servidor. Los datos siguen guardados en este dispositivo.' };
  } finally {
    clearTimeout(timer);
  }
}

const ALMACENES = ['children', 'assessments', 'surveys'];

// Marca todos los registros del equipo como pendientes de envio. Se usa cuando
// el servidor perdio su copia y cuando el administrador pide reenviar todo.
export async function marcarTodoPendiente() {
  let total = 0;
  for (const almacen of ALMACENES) {
    const items = await getAll(almacen);
    if (!items.length) continue;
    await bulkPut(almacen, items.map((item) => ({ ...item, syncStatus: 'pending' })));
    total += items.length;
  }
  await setSetting('lastPullAt', '');
  return total;
}

// Indica si el equipo conserva informacion vigente que valga la pena reponer.
async function hayRegistrosVigentes() {
  for (const almacen of ALMACENES) {
    const items = await getAll(almacen);
    if (items.some((item) => !item.deleted)) return true;
  }
  return false;
}

// Comprueba si el servidor sigue siendo la misma copia de la base de datos que
// este equipo conocia. El servicio entrega un identificador que nace con la base
// y no cambia mientras esa base exista; si llega uno distinto es que el servidor
// se reinicio sobre un almacenamiento que no conserva los archivos y quedo
// vacio. En ese caso no basta con sincronizar lo pendiente, porque los registros
// ya enviados figuran como entregados y nadie los volveria a mandar: hay que
// marcarlos otra vez como pendientes para que la informacion se reconstruya.
//
// Hay un segundo caso que hay que cubrir: un equipo que se actualiza a esta
// version todavia no guardo ningun identificador, de modo que la comparacion no
// tiene con que hacerse. Si ademas el servidor esta en cero mientras el equipo
// conserva registros, se repone igual, porque un servidor vacio no tiene nada
// que perder y esa es justamente la situacion que dejo el reinicio anterior.
async function detectarReinicioDelServidor(base) {
  let datos = null;
  try {
    const response = await fetch(`${base}/api/health`, { cache: 'no-store' });
    if (!response.ok) return 0;
    datos = await response.json();
  } catch (error) {
    return 0;
  }

  const actual = datos.serverId || '';
  const guardado = await getSetting('serverId', '');
  if (actual) await setSetting('serverId', actual);

  const cambioDeBase = Boolean(guardado) && Boolean(actual) && guardado !== actual;
  const servidorVacio = Number(datos.storedRecords || 0) === 0;
  if (!cambioDeBase && !servidorVacio) return 0;
  if (!(await hayRegistrosVigentes())) return 0;

  const total = await marcarTodoPendiente();
  // Solo se avisa de un reinicio cuando consta que la base cambio. Un servidor
  // recien creado, o un equipo que todavia no habia guardado el identificador,
  // no necesitan esa explicacion: para el usuario es un envio normal.
  return cambioDeBase ? total : 0;
}

// Envia al servidor lo que este dispositivo tiene pendiente.
async function subirPendientes(base) {
  const [allChildren, allAssessments, allSurveys] = await Promise.all([
    getAll('children'), getAll('assessments'), getAll('surveys')
  ]);
  const children = allChildren.filter((item) => item.syncStatus !== 'synced');
  const assessments = allAssessments.filter((item) => item.syncStatus !== 'synced');
  const surveys = allSurveys.filter((item) => item.syncStatus !== 'synced');
  const total = children.length + assessments.length + surveys.length;
  if (!total) return 0;

  const response = await fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: localStorage.getItem('nutrirural-device') || 'browser-device', children, assessments, surveys })
  });
  if (response.status === 404) {
    throw new Error('No hay un servicio de consolidación en esa dirección. Los datos siguen guardados en este dispositivo.');
  }
  if (!response.ok) {
    throw new Error(`El servidor rechazó el envío (código ${response.status}). Los datos siguen guardados en este dispositivo.`);
  }
  await response.json();
  const syncedAt = new Date().toISOString();
  await Promise.all([
    bulkPut('children', children.map((item) => ({ ...item, syncStatus: 'synced', syncedAt }))),
    bulkPut('assessments', assessments.map((item) => ({ ...item, syncStatus: 'synced', syncedAt }))),
    bulkPut('surveys', surveys.map((item) => ({ ...item, syncStatus: 'synced', syncedAt })))
  ]);
  return total;
}

// Incorpora al dispositivo lo que otros equipos ya consolidaron en el servidor.
// La regla de resolucion es simple y predecible: gana la version con la fecha
// de actualizacion mas reciente. Ante empate se conserva la local, porque una
// edicion hecha aqui y todavia sin enviar no debe perderse.
async function bajarDelServidor(base) {
  const desde = await getSetting('lastPullAt', '');
  const url = `${base}/api/pull` + (desde ? `?since=${encodeURIComponent(desde)}` : '');
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`No se pudo traer la información del servidor (código ${response.status}).`);
  }
  const remoto = await response.json();

  let incorporados = 0;
  for (const almacen of ALMACENES) {
    const entrantes = remoto[almacen] || [];
    if (!entrantes.length) continue;
    const locales = new Map((await getAll(almacen)).map((item) => [item.id, item]));
    const aGuardar = [];
    for (const item of entrantes) {
      if (!item || !item.id) continue;
      const local = locales.get(item.id);
      if (local && (local.updatedAt || '') >= (item.updatedAt || '')) continue;
      aGuardar.push({ ...item, syncStatus: 'synced' });
    }
    if (aGuardar.length) {
      await bulkPut(almacen, aGuardar);
      incorporados += aGuardar.length;
    }
  }
  if (remoto.serverTime) await setSetting('lastPullAt', remoto.serverTime);
  return incorporados;
}

export async function syncPending() {
  const base = await baseUrl();
  // Antes de nada se comprueba que el servidor conserve la copia que este equipo
  // ya le habia entregado. Si no, se reponen los registros desde aqui.
  const repuestos = await detectarReinicioDelServidor(base);
  // Primero se sube y despues se baja: asi lo registrado en este equipo queda a
  // salvo en el servidor antes de mezclarlo con lo que trajeron los demas.
  const enviados = await subirPendientes(base);
  const recibidos = await bajarDelServidor(base);

  let message;
  if (repuestos) message = `El servidor se había reiniciado y quedó sin datos: se repusieron ${enviados} registros desde este dispositivo.`;
  else if (!enviados && !recibidos) message = 'Todo está al día. No había registros pendientes.';
  else if (enviados && recibidos) message = `${enviados} registros enviados y ${recibidos} recibidos del servidor.`;
  else if (enviados) message = `${enviados} registros enviados al servidor.`;
  else message = `${recibidos} registros recibidos del servidor.`;

  return { ok: true, uploaded: enviados, downloaded: recibidos, restored: repuestos, message };
}

// Reenvio manual, disponible para el administrador. Sirve cuando se quiere
// forzar la reposicion sin esperar a que el aplicativo detecte el reinicio.
export async function reenviarTodo() {
  const base = await baseUrl();
  await marcarTodoPendiente();
  const enviados = await subirPendientes(base);
  const recibidos = await bajarDelServidor(base);
  return {
    ok: true,
    uploaded: enviados,
    downloaded: recibidos,
    message: enviados
      ? `Se reenviaron ${enviados} registros al servidor${recibidos ? ` y se recibieron ${recibidos}` : ''}.`
      : 'No hay registros en este dispositivo para reenviar.'
  };
}
