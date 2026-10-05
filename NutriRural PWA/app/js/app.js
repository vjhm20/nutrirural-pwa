import {
  openDb, seedDemoData, getAll, get, put, remove, getSetting, setSetting,
  newId, exportDatabase, resetDatabase
} from './db.js';
import { screenChild, riskLabels, completedMonths } from './who.js';
import { pingServer, syncPending, reenviarTodo, API_POR_DEFECTO } from './api.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const today = () => new Date().toISOString().slice(0, 10);
const shiftDate = (isoDate, { years = 0, months = 0, days = 0 } = {}) => {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setFullYear(d.getFullYear() + years);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
// Solo digitos: se aplica mientras el usuario escribe para que el campo no acepte otros caracteres.
function soloDigitos(input, largo) {
  if (!input) return;
  const limpiar = () => {
    const limpio = input.value.replace(/\D/g, '').slice(0, largo);
    if (input.value !== limpio) input.value = limpio;
  };
  input.addEventListener('input', limpiar);
  input.addEventListener('paste', () => setTimeout(limpiar, 0));
}
const formatDate = (value) => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : '—';
const formatDateTime = (value) => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const fullName = (child) => `${child.firstName || ''} ${child.lastName || ''}`.trim();

const views = {
  dashboard: ['Panel de monitoreo', 'Resumen operativo de la jornada'],
  children: ['Niños registrados', 'Historia y seguimiento antropométrico'],
  assessment: ['Nuevo control', 'Registre medidas y genere el tamizaje automático'],
  alerts: ['Alertas y derivaciones', 'Casos que requieren verificación o atención'],
  evaluation: ['Evaluación SUS/NPS', 'Usabilidad y aceptación del prototipo'],
  sync: ['Sincronización', 'Cola offline y respaldo en el servidor local'],
  settings: ['Configuración', 'Establecimiento, comunidad y administración de datos']
};

// Cada perfil tiene capacidades distintas. Los permisos se verifican tanto al
// dibujar la interfaz como dentro de cada operacion, para que ocultar un boton
// no sea el unico control.
//
// Correspondencia con los casos de uso del documento de tesis:
//   registrar   CU01 Registrar nino y CU02 Registrar control
//   editar      Editar nino y CU05 Editar registro
//   consultar   CU03 Consultar historial
//   alertas     CU04 Revisar alertas
//   eliminar    CU06 Eliminar registro
//   sincronizar CU07 Sincronizar datos
//   exportar    CU08 Exportar respaldo
//   configurar  CU09 Configurar servicio (incluye restablecer la demostracion)
//   evaluar     CU10 Responder evaluacion
const PERMISOS_COMUNES = ['registrar', 'editar', 'consultar', 'alertas', 'sincronizar', 'evaluar'];

const credentials = {
  agente: { password: 'agente2026', role: 'Agente comunitario', initials: 'AC', permisos: [...PERMISOS_COMUNES] },
  salud: { password: 'salud2026', role: 'Personal de salud', initials: 'PS', permisos: [...PERMISOS_COMUNES, 'eliminar'] },
  admin: { password: 'admin2026', role: 'Administrador', initials: 'AD', permisos: [...PERMISOS_COMUNES, 'eliminar', 'exportar', 'configurar', 'restablecer'] }
};

const PERMISO_POR_VISTA = {
  children: 'consultar',
  assessment: 'registrar',
  alerts: 'alertas',
  evaluation: 'evaluar',
  sync: 'sincronizar',
  settings: 'configurar'
};

function puede(accion) {
  return Boolean(session && Array.isArray(session.permisos) && session.permisos.includes(accion));
}

// Quita tildes para que la busqueda encuentre "Quispe" escribiendo "quispe".
function sinTildes(texto = '') {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const ESTABLECIMIENTO = 'Centro de Salud Paruro';

let session = null;
let currentView = 'dashboard';
let previewTimer;

// El aviso se dibuja abajo a la izquierda, fuera del area que ocupa el sello del
// proveedor de hosting. Cuando hay una ventana modal abierta el navegador la
// coloca en una capa superior y todo lo demas queda por debajo, incluido este
// aviso: por eso el nodo se traslada dentro de la ventana abierta mientras dura
// el mensaje y regresa al cuerpo del documento cuando esa ventana se cierra.
function reubicarToast(node) {
  const abierta = document.querySelector('dialog[open]');
  const destino = abierta || document.body;
  if (node.parentElement !== destino) destino.appendChild(node);
  if (abierta && !abierta._toastWatch) {
    abierta._toastWatch = true;
    abierta.addEventListener('close', () => {
      if (node.parentElement === abierta) document.body.appendChild(node);
    });
  }
}

function toast(message) {
  const node = $('#toast');
  reubicarToast(node);
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove('show'), 2800);
}

function statusBadge(risk) {
  return `<span class="status ${esc(risk || 'pending')}">${esc(riskLabels[risk] || 'Sin control')}</span>`;
}

function iconForRisk(risk) {
  return risk === 'severe' ? '⛑' : risk === 'high' ? '⚠' : risk === 'observe' ? '◷' : '✓';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function datasets() {
  const [todosNinos, todosControles, todasEncuestas] = await Promise.all([
    getAll('children'), getAll('assessments'), getAll('surveys')
  ]);
  // El borrado es logico: el registro se conserva marcado para que la baja
  // viaje al servidor en la siguiente sincronizacion.
  const vigente = (item) => !item.deleted;
  const children = todosNinos.filter(vigente);
  const assessments = todosControles.filter(vigente);
  const surveys = todasEncuestas.filter(vigente);
  children.sort((a, b) => fullName(a).localeCompare(fullName(b), 'es'));
  assessments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { children, assessments, surveys };
}

function latestByChild(assessments) {
  const map = new Map();
  for (const item of assessments) if (!map.has(item.childId)) map.set(item.childId, item);
  return map;
}

function pendingCount({ children, assessments, surveys }) {
  return [...children, ...assessments, ...surveys].filter((item) => item.syncStatus !== 'synced').length;
}

async function refreshBadges(data = null) {
  const ds = data || await datasets();
  const latest = latestByChild(ds.assessments);
  const alerts = [...latest.values()].filter((item) => ['observe', 'high', 'severe'].includes(item.screening?.risk));
  $('#alertBadge').textContent = alerts.length;
  $('#syncBadge').textContent = pendingCount(ds);
}

async function renderDashboard() {
  const data = await datasets();
  const latest = latestByChild(data.assessments);
  const lastControls = [...latest.values()];
  const total = data.children.length;
  const withControl = lastControls.length;
  const coverage = total ? Math.round((withControl / total) * 100) : 0;
  const alerts = lastControls.filter((a) => ['high', 'severe'].includes(a.screening?.risk));
  const severe = lastControls.filter((a) => a.screening?.risk === 'severe').length;
  const pending = pendingCount(data);
  // Controles programados: se usa el proximo control del ultimo registro de cada nino.
  const hoy = today();
  const programados = lastControls
    .filter((item) => item.nextControlDate)
    .map((item) => ({ item, child: data.children.find((c) => c.id === item.childId), fecha: item.nextControlDate }))
    .filter((fila) => fila.child)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const vencidos = programados.filter((fila) => fila.fecha < hoy);
  const proximos = programados.filter((fila) => fila.fecha >= hoy).slice(0, 5);
  const diasDeAtraso = (fecha) => Math.round((new Date(`${hoy}T12:00:00`) - new Date(`${fecha}T12:00:00`)) / 86400000);
  const counts = { normal: 0, observe: 0, high: 0, severe: 0 };
  for (const item of lastControls) counts[item.screening?.risk || 'observe'] += 1;
  const maxCount = Math.max(1, ...Object.values(counts));
  const childMap = new Map(data.children.map((child) => [child.id, child]));

  $('#content').innerHTML = `
    <div class="page-actions"><button class="btn secondary" id="dashboardAddChild">Registrar niño</button><button class="btn primary" id="dashboardNewControl">Nuevo control</button></div>
    <section class="kpi-grid">
      <article class="card kpi"><span class="label">Niños registrados</span><strong>${total}</strong><small>${withControl} con al menos un control</small></article>
      <article class="card kpi"><span class="label">Cobertura de tamizaje</span><strong>${coverage}%</strong><small>Meta del piloto: incremento medible</small></article>
      <article class="card kpi"><span class="label">Alertas activas</span><strong>${alerts.length}</strong><small>${severe} de prioridad inmediata</small></article>
      <article class="card kpi"><span class="label">Controles vencidos</span><strong>${vencidos.length}</strong><small>${proximos.length} programados por delante</small></article>
      <article class="card kpi"><span class="label">Pendientes de sincronizar</span><strong>${pending}</strong><small>Datos conservados en el dispositivo</small></article>
    </section>
    <section class="grid-2">
      <article class="card"><h3>Distribución del último control</h3><div class="risk-bars">
        ${Object.entries(counts).map(([risk, count]) => `<div class="bar-row"><span>${riskLabels[risk]}</span><div class="bar-track"><div class="bar-fill ${risk}" style="width:${(count / maxCount) * 100}%"></div></div><b>${count}</b></div>`).join('')}
      </div></article>
      <article class="card"><h3>Alertas recientes</h3><div class="alert-list">
        ${alerts.slice(0, 4).map((item) => { const child = childMap.get(item.childId); return `<button class="alert-item link-btn" data-detail="${item.childId}"><span class="activity-icon">${iconForRisk(item.screening.risk)}</span><span><b>${esc(child ? fullName(child) : 'Registro')}</b><p>${esc(item.screening.label)}</p><small>${formatDate(item.date)} · ${esc(child?.community || '')}</small></span></button>`; }).join('') || '<div class="empty">No hay alertas altas en el último control.</div>'}
      </div></article>
    </section>
    <section class="card" style="margin-top:16px"><h3>Controles programados</h3><p class="muted">Según la fecha de próximo control del último registro de cada niño.</p><div class="vencidos-list">
      ${vencidos.map((fila) => `<div class="vencido-item atrasado"><div><b>${esc(fullName(fila.child))}</b><small>Vencido el ${formatDate(fila.fecha)} · ${diasDeAtraso(fila.fecha)} día(s) de atraso · ${esc(fila.child.community)}</small></div><button class="btn secondary" data-control="${fila.child.id}">Registrar control</button></div>`).join('')}
      ${proximos.map((fila) => `<div class="vencido-item"><div><b>${esc(fullName(fila.child))}</b><small>Programado para el ${formatDate(fila.fecha)} · ${esc(fila.child.community)}</small></div><button class="link-btn" data-detail="${fila.child.id}">Ver</button></div>`).join('')}
      ${(!vencidos.length && !proximos.length) ? '<div class="empty">Ningún control programado todavía.</div>' : ''}
    </div></section>
    <section class="card" style="margin-top:16px"><h3>Actividad reciente</h3><div class="activity-list">
      ${data.assessments.slice(0, 6).map((item) => { const child = childMap.get(item.childId); return `<div class="activity-item"><span class="activity-icon">${iconForRisk(item.screening?.risk)}</span><div><b>${esc(child ? fullName(child) : 'Niño no encontrado')}</b><p>${esc(item.screening?.label || 'Control registrado')}</p><small>${formatDate(item.date)} · ${item.syncStatus === 'synced' ? 'Sincronizado' : 'Guardado offline'}</small></div></div>`; }).join('') || '<div class="empty">Todavía no se registraron controles.</div>'}
    </div></section>`;

  $('#dashboardAddChild').onclick = () => openChildDialog();
  $('#dashboardNewControl').onclick = () => showView('assessment');
  $$('[data-detail]').forEach((button) => button.onclick = () => openDetail(button.dataset.detail));
  $$('[data-control]').forEach((button) => button.onclick = () => openAssessmentDialog(button.dataset.control));
  await refreshBadges(data);
}

async function renderChildren() {
  const data = await datasets();
  const latest = latestByChild(data.assessments);
  $('#content').innerHTML = `
    <div class="toolbar"><input id="childSearch" class="search" placeholder="Buscar por nombre, código o comunidad"><button class="btn primary" id="addChildBtn">Registrar niño</button></div>
    <div class="table-wrap"><table><thead><tr><th>Niño</th><th>Código</th><th>Edad</th><th>Comunidad</th><th>Último control</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="childrenBody"></tbody></table></div>`;

  const renderRows = (query = '') => {
    const q = sinTildes(query.trim());
    const filtered = data.children.filter((child) => sinTildes(`${fullName(child)} ${child.code} ${child.community}`).includes(q));
    $('#childrenBody').innerHTML = filtered.map((child) => {
      const last = latest.get(child.id);
      const age = ageText(child.dob);
      return `<tr><td><b>${esc(fullName(child))}</b><br><small>${child.sex === 'F' ? 'Femenino' : 'Masculino'}</small></td><td>${esc(child.code)}</td><td>${age}</td><td>${esc(child.community)}</td><td>${last ? formatDate(last.date) : 'Sin control'}</td><td>${last ? statusBadge(last.screening?.risk) : statusBadge('pending')}</td><td><button class="link-btn" data-control="${child.id}">Control</button> · <button class="link-btn" data-detail="${child.id}">Ver</button></td></tr>`;
    }).join('') || '<tr><td colspan="7"><div class="empty">No se encontraron registros.</div></td></tr>';
    $$('[data-control]').forEach((button) => button.onclick = () => openAssessmentDialog(button.dataset.control));
    $$('[data-detail]').forEach((button) => button.onclick = () => openDetail(button.dataset.detail));
  };
  renderRows();
  $('#childSearch').oninput = (event) => renderRows(event.target.value);
  $('#addChildBtn').onclick = () => openChildDialog();
  await refreshBadges(data);
}

function ageText(dob) {
  const birth = new Date(`${dob}T12:00:00`);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months--;
  if (months < 24) return `${Math.max(0, months)} meses`;
  return `${Math.floor(months / 12)} a ${months % 12} m`;
}

async function renderAssessment() {
  const data = await datasets();
  $('#content').innerHTML = `<section class="card"><h3>Seleccione al niño</h3><p class="muted">La evaluación se guarda primero en este dispositivo y queda disponible aun sin internet.</p>
    <div class="toolbar"><input id="assessmentSearch" class="search" placeholder="Buscar por nombre, código o comunidad"><button class="btn secondary" id="assessmentAddChild">Registrar nuevo</button></div>
    <div class="table-wrap"><table><thead><tr><th>Niño</th><th>Código</th><th>Edad</th><th>Comunidad</th><th></th></tr></thead><tbody id="assessmentChildBody"></tbody></table></div></section>`;
  const renderRows = (query = '') => {
    const q = sinTildes(query.trim());
    const filtered = data.children.filter((child) => sinTildes(`${fullName(child)} ${child.code} ${child.community}`).includes(q));
    $('#assessmentChildBody').innerHTML = filtered.map((child) => `<tr><td><b>${esc(fullName(child))}</b></td><td>${esc(child.code)}</td><td>${ageText(child.dob)}</td><td>${esc(child.community)}</td><td><button class="btn primary" data-control="${child.id}">Registrar control</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Primero registre un niño.</div></td></tr>';
    $$('[data-control]').forEach((button) => button.onclick = () => openAssessmentDialog(button.dataset.control));
  };
  renderRows();
  $('#assessmentSearch').oninput = (event) => renderRows(event.target.value);
  $('#assessmentAddChild').onclick = () => openChildDialog();
  await refreshBadges(data);
}

async function renderAlerts() {
  const data = await datasets();
  const childMap = new Map(data.children.map((child) => [child.id, child]));
  const latest = latestByChild(data.assessments);
  const alerts = [...latest.values()].filter((a) => ['observe', 'high', 'severe'].includes(a.screening?.risk)).sort((a, b) => {
    const priority = { severe: 3, high: 2, observe: 1 };
    return priority[b.screening.risk] - priority[a.screening.risk] || b.date.localeCompare(a.date);
  });
  $('#content').innerHTML = `<section class="card"><div class="toolbar"><div><h3 style="margin:0">Casos activos</h3><p class="muted">Ordenados por prioridad del último control.</p></div>${puede('exportar') ? '<button class="btn secondary" id="exportAlerts">Exportar CSV</button>' : ''}</div><div class="alert-list">
    ${alerts.map((item) => { const child = childMap.get(item.childId); return `<article class="alert-item"><span class="activity-icon">${iconForRisk(item.screening.risk)}</span><div style="flex:1"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><b>${esc(child ? fullName(child) : 'Registro')}</b>${statusBadge(item.screening.risk)}</div><p>${esc(item.screening.recommendation)}</p><small>${formatDate(item.date)} · ${esc(child?.community || '')} · MUAC ${item.muacMm || '—'} mm</small></div><button class="btn secondary" data-detail="${item.childId}">Ver historia</button></article>`; }).join('') || '<div class="empty">No existen alertas activas.</div>'}
  </div></section>`;
  $$('[data-detail]').forEach((button) => button.onclick = () => openDetail(button.dataset.detail));
  const botonExportar = $('#exportAlerts');
  if (botonExportar) botonExportar.onclick = () => {
    if (!puede('exportar')) return toast('Solo el administrador puede exportar los datos.');
    exportAlertsCsv(alerts, childMap);
  };
  await refreshBadges(data);
}

function exportAlertsCsv(alerts, childMap) {
  const lines = [['codigo', 'nombre', 'comunidad', 'fecha', 'riesgo', 'WAZ', 'HAZ', 'WHZ', 'MUAC_mm', 'recomendacion']];
  for (const item of alerts) {
    const child = childMap.get(item.childId) || {};
    lines.push([child.code, fullName(child), child.community, item.date, item.screening?.label, item.screening?.waz, item.screening?.haz, item.screening?.whz, item.muacMm, item.screening?.recommendation]);
  }
  const csv = lines.map((row) => row.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), `alertas-nutrirural-${today()}.csv`);
}

const susQuestions = [
  'Me gustaría usar esta plataforma con frecuencia.',
  'La plataforma me pareció innecesariamente compleja.',
  'La plataforma me pareció fácil de usar.',
  'Necesitaría apoyo técnico para usar esta plataforma.',
  'Las funciones de la plataforma están bien integradas.',
  'Encontré demasiada inconsistencia en la plataforma.',
  'La mayoría de personas aprendería a usarla rápidamente.',
  'La plataforma me resultó incómoda o pesada de usar.',
  'Me sentí seguro al usar la plataforma.',
  'Necesité aprender muchas cosas antes de utilizarla.'
];

async function renderEvaluation() {
  const data = await datasets();
  const avgSus = data.surveys.length ? Math.round(data.surveys.reduce((sum, s) => sum + Number(s.susScore || 0), 0) / data.surveys.length) : 0;
  const nps = calculateNps(data.surveys.map((s) => s.nps));
  $('#content').innerHTML = `<section class="grid-2" style="margin-top:0"><article class="card"><h3>Nueva evaluación</h3><p class="muted">Marque de 1 (totalmente en desacuerdo) a 5 (totalmente de acuerdo).</p><form id="surveyForm" class="sus-grid">
    ${susQuestions.map((question, index) => `<div class="sus-item"><span>${index + 1}. ${esc(question)}</span><div class="likert">${[1,2,3,4,5].map((score) => `<label>${score}<input type="radio" name="q${index + 1}" value="${score}" required></label>`).join('')}</div></div>`).join('')}
    <div><b>¿Qué tan probable es que recomiende la plataforma? (NPS)</b><div class="nps-row" style="margin-top:10px">${[0,1,2,3,4,5,6,7,8,9,10].map((score) => `<label>${score}<input type="radio" name="nps" value="${score}" required></label>`).join('')}</div></div>
    <label style="display:grid;gap:6px"><b>Comentario opcional</b><textarea name="comment" rows="3"></textarea></label><button class="btn primary" type="submit">Guardar evaluación</button>
  </form></article><aside class="card"><h3>Resultados acumulados</h3><div class="quality-grid"><div class="quality-card"><span>SUS promedio</span><strong>${avgSus || '—'}</strong><small>Escala 0–100</small></div><div class="quality-card"><span>NPS</span><strong>${data.surveys.length ? nps : '—'}</strong><small>Rango −100 a 100</small></div><div class="quality-card"><span>Respuestas</span><strong>${data.surveys.length}</strong><small>Evaluaciones locales</small></div></div><p class="warning-note">Estos resultados corresponden al prototipo y deben analizarse con la muestra y el diseño definidos en la tesis.</p></aside></section>`;
  $('#surveyForm').onsubmit = saveSurvey;
  await refreshBadges(data);
}

function calculateSus(values) {
  let sum = 0;
  values.forEach((value, index) => {
    sum += index % 2 === 0 ? value - 1 : 5 - value;
  });
  return sum * 2.5;
}

function calculateNps(scores) {
  const valid = scores.map(Number).filter(Number.isFinite);
  if (!valid.length) return 0;
  const promoters = valid.filter((n) => n >= 9).length;
  const detractors = valid.filter((n) => n <= 6).length;
  return Math.round(((promoters - detractors) / valid.length) * 100);
}

async function saveSurvey(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const values = susQuestions.map((_, index) => Number(form.get(`q${index + 1}`)));
  const record = {
    id: newId('survey'),
    user: session.user,
    role: session.role,
    responses: values,
    susScore: calculateSus(values),
    nps: Number(form.get('nps')),
    comment: form.get('comment')?.trim() || '',
    createdAt: new Date().toISOString(),
    syncStatus: 'pending'
  };
  await put('surveys', record);
  toast(`Evaluación guardada. SUS: ${record.susScore}`);
  renderEvaluation();
}

async function renderSync() {
  const data = await datasets();
  const pending = pendingCount(data);
  const lastSync = await getSetting('lastSyncAt', null);
  const server = await pingServer();
  $('#content').innerHTML = `<section class="sync-panel"><article class="card"><h3>Estado de la cola offline</h3><div class="metric-list">
    <div class="metric-row"><span>Niños pendientes</span><b>${data.children.filter((i) => i.syncStatus !== 'synced').length}</b></div>
    <div class="metric-row"><span>Controles pendientes</span><b>${data.assessments.filter((i) => i.syncStatus !== 'synced').length}</b></div>
    <div class="metric-row"><span>Encuestas pendientes</span><b>${data.surveys.filter((i) => i.syncStatus !== 'synced').length}</b></div>
    <div class="metric-row"><span>Total</span><b>${pending}</b></div></div><button class="btn primary" id="syncNow" style="width:100%;margin-top:16px">Sincronizar ahora</button></article>
    <article class="card"><h3>Servidor</h3><div class="metric-list"><div class="metric-row"><span>Disponibilidad</span><b>${server.ok ? 'Disponible' : 'No disponible'}</b></div><div class="metric-row"><span>Última sincronización</span><b>${formatDateTime(lastSync)}</b></div><div class="metric-row"><span>Conectividad del navegador</span><b>${navigator.onLine ? 'En línea' : 'Sin internet'}</b></div></div><p class="${server.ok ? 'warning-note' : 'warning-note'}">${esc(server.ok ? 'El servidor local está listo para recibir los registros.' : 'Los datos continúan seguros en este dispositivo. Inicie el servidor y vuelva a intentar.')}</p></article></section>`;
  $('#syncNow').onclick = doSync;
  await refreshBadges(data);
}

async function renderSettings() {
  const facility = await getSetting('facility', 'Centro de Salud Paruro');
  const community = await getSetting('community', 'Paruro');
  const apiUrl = await getSetting('apiUrl', '');
  $('#content').innerHTML = `<section class="grid-2" style="margin-top:0"><article class="card"><h3>Datos operativos</h3><form id="settingsForm" class="stack"><label>Establecimiento de referencia<input name="facility" value="${esc(facility)}" readonly tabindex="-1" aria-readonly="true" class="readonly-field"><small class="muted">Fijo para el piloto: todos los registros se derivan al Centro de Salud Paruro.</small></label><label>Comunidad predeterminada<input name="community" value="${esc(community)}"></label><label>URL del servidor/API<input name="apiUrl" value="${esc(apiUrl)}" placeholder="${esc(API_POR_DEFECTO)}"><small class="muted">Si se deja vacío se usa el servicio publicado: ${esc(API_POR_DEFECTO)}. Escriba otra dirección solo para trabajar contra un servidor local.</small></label><button class="btn primary" type="submit">Guardar configuración</button></form></article>
    <article class="card"><h3>Gestión de datos</h3><p>Exporte un respaldo JSON antes de borrar o trasladar el dispositivo.</p><div class="stack"><button class="btn secondary" id="exportData">Exportar respaldo JSON</button><button class="btn secondary" id="resendAll">Reenviar todos los registros al servidor</button><button class="btn danger" id="resetData">Restablecer datos de demostración</button></div><p class="muted">El reenvío repone en el servidor todo lo que guarda este dispositivo. Sirve cuando el servicio de consolidación se reinició y quedó sin datos.</p><p class="warning-note">El prototipo almacena datos en IndexedDB del navegador. Para un uso real se requiere una política institucional de seguridad, acceso y respaldo.</p></article></section>`;
  $('#settingsForm').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await Promise.all([
      setSetting('facility', ESTABLECIMIENTO),
      setSetting('community', form.get('community').trim()),
      setSetting('apiUrl', form.get('apiUrl').trim())
    ]);
    toast('Configuración guardada.');
    updateNetworkChip();
  };
  $('#exportData').onclick = async () => {
    if (!puede('exportar')) return toast('Solo el administrador puede exportar el respaldo.');
    const backup = await exportDatabase();
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `respaldo-nutrirural-${today()}.json`);
  };
  $('#resendAll').onclick = async () => {
    if (!puede('sincronizar')) return toast('Su perfil no permite sincronizar datos.');
    const boton = $('#resendAll');
    const rotulo = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Reenviando…';
    try {
      const resultado = await reenviarTodo();
      await setSetting('lastSyncAt', new Date().toISOString());
      toast(resultado.message);
    } catch (error) {
      toast(error.message || 'No se pudo reenviar. Los datos permanecen en el dispositivo.');
    } finally {
      boton.disabled = false;
      boton.textContent = rotulo;
      updateNetworkChip();
      refreshBadges();
    }
  };
  $('#resetData').onclick = async () => {
    if (!puede('restablecer')) return toast('Solo el administrador puede restablecer los datos.');
    if (!confirm('¿Restablecer todos los datos locales y recuperar la demostración?')) return;
    await resetDatabase();
    toast('Datos de demostración restablecidos.');
    renderSettings();
  };
}

async function showView(name) {
  const permisoRequerido = PERMISO_POR_VISTA[name];
  if (permisoRequerido && !puede(permisoRequerido)) {
    toast('Su perfil no tiene acceso a esa sección.');
    name = 'dashboard';
  }
  currentView = views[name] ? name : 'dashboard';
  const [title, subtitle] = views[currentView];
  $('#viewTitle').textContent = title;
  $('#viewSubtitle').textContent = subtitle;
  $$('.nav-item[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === currentView);
    const permiso = PERMISO_POR_VISTA[button.dataset.view];
    button.hidden = Boolean(permiso && !puede(permiso));
  });
  $('.sidebar').classList.remove('open');
  const renderers = { dashboard: renderDashboard, children: renderChildren, assessment: renderAssessment, alerts: renderAlerts, evaluation: renderEvaluation, sync: renderSync, settings: renderSettings };
  await renderers[currentView]();
}

// childId presente = edicion; ausente = alta nueva.
async function openChildDialog(childId = null) {
  // Los manejadores de clic pueden pasar el objeto Event: solo se acepta un id de texto.
  if (typeof childId !== 'string' || !childId) childId = null;
  if (!puede('registrar')) return toast('Su perfil no permite registrar niños.');
  if (childId && !puede('editar')) return toast('Su perfil no permite editar registros.');
  const form = $('#childForm');
  form.reset();
  form.dataset.editando = childId || '';
  const enEdicion = childId ? await get('children', childId) : null;
  $('#childDialogTitle').textContent = enEdicion ? 'Editar datos del niño' : 'Registrar niño';
  $('#saveChildBtn').textContent = enEdicion ? 'Guardar cambios' : 'Guardar niño';
  form.elements.community.value = await getSetting('community', 'Paruro');
  form.elements.facility.value = ESTABLECIMIENTO;
  if (enEdicion) {
    for (const campo of ['code', 'firstName', 'lastName', 'sex', 'dob', 'community', 'caregiver', 'phone', 'notes']) {
      if (form.elements[campo]) form.elements[campo].value = enEdicion[campo] ?? '';
    }
  }
  // La plataforma cubre de 0 a 60 meses: la fecha de nacimiento no puede ser futura
  // ni anterior a los cinco anios cumplidos.
  const hoy = today();
  form.elements.dob.max = hoy;
  form.elements.dob.min = shiftDate(hoy, { months: -60 });
  $('#childDialog').showModal();
}

async function saveChild(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const code = form.get('code').trim();
  if (!/^\d{8}$/.test(code)) {
    toast('El DNI debe tener exactamente 8 dígitos numéricos.');
    return;
  }
  const phone = form.get('phone').trim();
  if (phone && !/^\d{9}$/.test(phone)) {
    toast('El teléfono debe tener exactamente 9 dígitos numéricos.');
    return;
  }
  const dob = form.get('dob');
  const edadMeses = completedMonths(dob, today());
  if (edadMeses == null || edadMeses < 0 || edadMeses > 60) {
    toast('La fecha de nacimiento debe corresponder a un niño de 0 a 60 meses.');
    return;
  }
  const editandoId = event.currentTarget.dataset.editando || '';
  const anterior = editandoId ? await get('children', editandoId) : null;
  const existing = (await getAll('children'))
    .filter((child) => !child.deleted && child.id !== editandoId)
    .find((child) => child.code.toLowerCase() === code.toLowerCase());
  if (existing) {
    toast('Ya existe un niño con ese DNI.');
    return;
  }
  const now = new Date().toISOString();
  const record = {
    ...(anterior || {}),
    id: anterior ? anterior.id : newId('child'),
    code, firstName: form.get('firstName').trim(), lastName: form.get('lastName').trim(),
    sex: form.get('sex'), dob, community: form.get('community').trim(),
    caregiver: form.get('caregiver').trim(), phone, facility: ESTABLECIMIENTO,
    notes: form.get('notes').trim(),
    createdAt: anterior ? anterior.createdAt : now,
    updatedAt: now,
    createdBy: anterior ? anterior.createdBy : session.user,
    updatedBy: session.user,
    syncStatus: 'pending'
  };
  await put('children', record);
  $('#childDialog').close();
  toast(anterior ? 'Datos del niño actualizados.' : 'Niño registrado en el dispositivo.');
  showView(currentView === 'assessment' ? 'assessment' : 'children');
}

// El proximo control se programa como minimo un dia despues de la fecha del control.
function aplicarLimiteProximoControl(form) {
  const fecha = form.elements.date.value || today();
  const minimo = shiftDate(fecha, { days: 1 });
  form.elements.nextControlDate.min = minimo;
  if (form.elements.nextControlDate.value && form.elements.nextControlDate.value < minimo) {
    form.elements.nextControlDate.value = minimo;
  }
}

// assessmentId presente = se edita un control ya guardado.
async function openAssessmentDialog(childId, assessmentId = null) {
  if (typeof assessmentId !== 'string' || !assessmentId) assessmentId = null;
  if (typeof childId !== 'string' || !childId) return toast('No se seleccionó ningún niño.');
  if (!puede('registrar')) return toast('Su perfil no permite registrar controles.');
  if (assessmentId && !puede('editar')) return toast('Su perfil no permite editar controles.');
  const child = await get('children', childId);
  if (!child || child.deleted) return toast('No se encontró el registro.');
  const form = $('#assessmentForm');
  form.reset();
  form.dataset.editando = assessmentId || '';
  const enEdicion = assessmentId ? await get('assessments', assessmentId) : null;
  $('#assessmentDialogTitle').textContent = enEdicion ? 'Editar control antropométrico' : 'Nuevo control antropométrico';
  $('#saveAssessmentBtn').textContent = enEdicion ? 'Guardar cambios' : 'Guardar control y generar alerta';
  form.elements.childId.value = child.id;
  form.elements.date.value = enEdicion ? enEdicion.date : today();
  form.elements.date.max = today();
  if (enEdicion) {
    form.elements.weightKg.value = enEdicion.weightKg ?? '';
    form.elements.heightCm.value = enEdicion.heightCm ?? '';
    form.elements.position.value = enEdicion.position || '';
    form.elements.muacMm.value = enEdicion.muacMm ?? '';
    form.elements.edema.value = enEdicion.edema ? 'yes' : 'no';
    form.elements.notes.value = enEdicion.notes || '';
  }
  aplicarLimiteProximoControl(form);
  form.elements.nextControlDate.value = enEdicion
    ? (enEdicion.nextControlDate || '')
    : shiftDate(today(), { days: 30 });
  aplicarDisponibilidadMuac(form, child);
  $('#assessmentChildLabel').textContent = `${fullName(child)} · ${child.code} · ${ageText(child.dob)}`;
  $('#screeningPreview').innerHTML = '<h4>Vista previa del tamizaje</h4><p class="muted">Complete peso y talla para calcular indicadores.</p>';
  $('#assessmentDialog').showModal();
  if (enEdicion) updateScreeningPreview();
}

// El MUAC solo esta validado entre 6 y 59 meses: fuera de ese rango se bloquea
// el campo en vez de aceptar un dato que el motor va a descartar despues.
function aplicarDisponibilidadMuac(form, child) {
  const meses = completedMonths(child.dob, form.elements.date.value || today());
  const aplicable = meses != null && meses >= 6 && meses <= 59;
  const campo = form.elements.muacMm;
  campo.disabled = !aplicable;
  campo.title = aplicable ? '' : 'El MUAC solo aplica entre 6 y 59 meses de edad.';
  if (!aplicable) campo.value = '';
  const etiqueta = campo.closest('label');
  if (etiqueta) etiqueta.classList.toggle('campo-inactivo', !aplicable);
}

async function updateScreeningPreview() {
  const form = $('#assessmentForm');
  if (!form.elements.childId.value || !form.elements.weightKg.value || !form.elements.heightCm.value || !form.elements.date.value) return;
  const child = await get('children', form.elements.childId.value);
  const screening = await screenChild({
    child,
    date: form.elements.date.value,
    weightKg: Number(form.elements.weightKg.value),
    heightCm: Number(form.elements.heightCm.value),
    position: form.elements.position.value || 'auto',
    muacMm: form.elements.muacMm.value,
    edema: form.elements.edema.value === 'yes'
  });
  renderPreview(screening);
}

function renderPreview(screening) {
  $('#screeningPreview').innerHTML = `<h4>Vista previa del tamizaje</h4><div class="hero-status ${screening.risk}">${esc(screening.label)}</div><div class="score-grid">
    <div class="score-box"><small>Peso/edad (WAZ)</small><strong>${screening.waz ?? '—'}</strong></div><div class="score-box"><small>Talla/edad (HAZ)</small><strong>${screening.haz ?? '—'}</strong></div>
    <div class="score-box"><small>Peso/talla (WHZ)</small><strong>${screening.whz ?? '—'}</strong></div><div class="score-box"><small>IMC</small><strong>${screening.bmi ?? '—'}</strong></div></div>
    <p><b>MUAC:</b> ${esc(screening.muacLabel || 'No registrado')}</p><p>${esc(screening.recommendation)}</p>${screening.flags?.length ? `<ul>${screening.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}<p class="warning-note">Resultado de tamizaje académico; requiere interpretación profesional.</p>`;
}

async function saveAssessment(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const child = await get('children', form.get('childId'));
  if (!child) return toast('Seleccione un niño válido.');
  const position = form.get('position');
  if (position !== 'length' && position !== 'height') {
    toast('Seleccione la posición de medición: acostado o de pie.');
    return;
  }
  const fechaControl = form.get('date');
  const proximo = form.get('nextControlDate');
  if (proximo && proximo <= fechaControl) {
    toast('El próximo control debe ser posterior a la fecha del control.');
    return;
  }
  const editandoId = formElement.dataset.editando || '';
  const anterior = editandoId ? await get('assessments', editandoId) : null;
  const duplicado = (await getAll('assessments')).find((item) =>
    !item.deleted && item.childId === child.id && item.date === fechaControl && item.id !== editandoId);
  if (duplicado) {
    toast('Ya existe un control de este niño en esa fecha. Edítelo desde la ventana Ver.');
    return;
  }
  const start = performance.now();
  const screening = await screenChild({
    child, date: form.get('date'), weightKg: Number(form.get('weightKg')), heightCm: Number(form.get('heightCm')),
    position, muacMm: form.get('muacMm'), edema: form.get('edema') === 'yes'
  });
  if (screening.flags?.some((flag) => flag.includes('posterior') || flag.includes('Revise') || flag.includes('referencias'))) {
    renderPreview(screening);
    toast('Revise los datos antes de guardar.');
    return;
  }
  const now = new Date().toISOString();
  const record = {
    ...(anterior || {}),
    id: anterior ? anterior.id : newId('assess'), childId: child.id, date: form.get('date'), weightKg: Number(form.get('weightKg')),
    heightCm: Number(form.get('heightCm')), position, muacMm: form.get('muacMm') ? Number(form.get('muacMm')) : null,
    edema: form.get('edema') === 'yes', nextControlDate: form.get('nextControlDate') || null, notes: form.get('notes').trim(),
    screening, processingMs: Math.round(performance.now() - start),
    createdAt: anterior ? anterior.createdAt : now, updatedAt: now,
    createdBy: anterior ? anterior.createdBy : session.user, updatedBy: session.user,
    syncStatus: 'pending'
  };
  await put('assessments', record);
  await put('children', { ...child, updatedAt: now, syncStatus: 'pending' });
  $('#assessmentDialog').close();
  toast(anterior
    ? 'Control actualizado y tamizaje recalculado.'
    : (screening.risk === 'severe' ? 'Control guardado. Se generó una alerta prioritaria.' : 'Control guardado en el dispositivo.'));
  showView(screening.risk === 'normal' ? 'children' : 'alerts');
}

// Borrado logico: el registro queda marcado y pendiente, de modo que la baja
// se propague al servidor en lugar de desaparecer solo del dispositivo.
async function marcarEliminado(almacen, id) {
  if (!id) return;
  const registro = await get(almacen, id);
  if (!registro) return;
  const now = new Date().toISOString();
  await put(almacen, { ...registro, deleted: true, deletedAt: now, deletedBy: session?.user || 'desconocido', updatedAt: now, syncStatus: 'pending' });
}

async function openDetail(childId) {
  const [child, assessments] = await Promise.all([get('children', childId), getAll('assessments')]);
  if (!child || child.deleted) return;
  const history = assessments
    .filter((item) => item.childId === childId && !item.deleted)
    .sort((a, b) => b.date.localeCompare(a.date));
  // La tendencia compara el peor puntaje z de cada control con el del control
  // anterior, para que el historial muestre si el nino mejora o empeora.
  const peorZ = (item) => {
    const zs = [item.screening?.waz, item.screening?.haz, item.screening?.whz].filter(Number.isFinite);
    return zs.length ? Math.min(...zs) : null;
  };
  const tendencia = (item, indice) => {
    const previo = history[indice + 1];
    const actual = peorZ(item);
    const antes = previo ? peorZ(previo) : null;
    if (actual == null || antes == null) return '<span class="muted">—</span>';
    const delta = actual - antes;
    if (Math.abs(delta) < 0.1) return `<span class="tendencia igual" title="Sin cambio relevante">= ${delta.toFixed(2)}</span>`;
    return delta > 0
      ? `<span class="tendencia mejora" title="Mejora respecto al control anterior">&#9650; +${delta.toFixed(2)}</span>`
      : `<span class="tendencia empeora" title="Retrocede respecto al control anterior">&#9660; ${delta.toFixed(2)}</span>`;
  };
  $('#detailContent').innerHTML = `<div class="modal-head"><div><h3>${esc(fullName(child))}</h3><p>${esc(child.code)} · ${esc(child.community)}</p></div><button type="button" class="icon-btn" data-close="detailDialog" aria-label="Cerrar">×</button></div>
    <div class="detail-grid"><div><small>Nacimiento</small><b>${formatDate(child.dob)}</b></div><div><small>Madre, padre o cuidador</small><b>${esc(child.caregiver || '—')}</b></div><div><small>Teléfono</small><b>${esc(child.phone || '—')}</b></div><div><small>Referencia</small><b>${esc(child.facility || '—')}</b></div></div>
    <h3 style="margin-top:20px">Historial de controles</h3><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Peso</th><th>Talla</th><th>MUAC</th><th>WAZ</th><th>HAZ</th><th>WHZ</th><th>Tendencia</th><th>Estado</th><th></th></tr></thead><tbody>${history.map((item, indice) => `<tr><td>${formatDate(item.date)}</td><td>${item.weightKg} kg</td><td>${item.heightCm} cm</td><td>${item.muacMm || '—'}</td><td>${item.screening?.waz ?? '—'}</td><td>${item.screening?.haz ?? '—'}</td><td>${item.screening?.whz ?? '—'}</td><td>${tendencia(item, indice)}</td><td>${statusBadge(item.screening?.risk)}</td><td>${puede('editar') ? `<button class="link-btn" data-edit-assessment="${item.id}">Editar</button>` : ''}${puede('eliminar') ? ` · <button class="link-btn" data-delete-assessment="${item.id}">Eliminar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10"><div class="empty">Sin controles.</div></td></tr>'}</tbody></table></div>
    <div class="modal-actions"><button class="btn primary" id="detailNewControl">Registrar nuevo control</button>${puede('editar') ? '<button class="btn secondary" id="detailEditChild">Editar datos del niño</button>' : ''}${puede('eliminar') ? '<button class="btn danger" id="detailDeleteChild">Eliminar registro</button>' : ''}</div>`;
  $('#detailNewControl').onclick = () => { $('#detailDialog').close(); openAssessmentDialog(child.id); };
  if ($('#detailEditChild')) $('#detailEditChild').onclick = () => { $('#detailDialog').close(); openChildDialog(child.id); };
  $$('[data-edit-assessment]').forEach((boton) => boton.onclick = () => {
    $('#detailDialog').close();
    openAssessmentDialog(child.id, boton.dataset.editAssessment);
  });
  $$('[data-delete-assessment]').forEach((boton) => boton.onclick = async () => {
    if (!puede('eliminar')) return toast('Su perfil no permite eliminar controles.');
    if (!confirm('¿Eliminar este control? La baja se enviará al servidor en la próxima sincronización.')) return;
    await marcarEliminado('assessments', boton.dataset.deleteAssessment);
    toast('Control eliminado.');
    $('#detailDialog').close();
    openDetail(child.id);
  });
  if ($('#detailDeleteChild')) $('#detailDeleteChild').onclick = async () => {
    if (!puede('eliminar')) return toast('Su perfil no permite eliminar registros.');
    if (!confirm('¿Eliminar este niño y todos sus controles? La baja se enviará al servidor en la próxima sincronización.')) return;
    for (const item of history) await marcarEliminado('assessments', item.id);
    await marcarEliminado('children', child.id);
    $('#detailDialog').close();
    toast('Registro eliminado.');
    showView('children');
  };
  $('#detailDialog').showModal();
}

async function doSync() {
  if (!puede('sincronizar')) return toast('Su perfil no permite sincronizar datos.');
  const button = $('#syncNow') || $('#quickSyncBtn');
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Sincronizando…'; }
  // El servicio publicado en un plan gratuito despierta recien al recibir la
  // primera peticion, asi que conviene avisar antes de que el usuario crea que
  // la aplicacion se colgo.
  const avisoDemora = setTimeout(() => toast('Contactando al servidor. Si estaba en reposo puede tardar hasta un minuto.'), 2500);
  let recibidos = 0;
  try {
    const result = await syncPending();
    await setSetting('lastSyncAt', new Date().toISOString());
    toast(result.message);
    recibidos = result.downloaded || 0;
  } catch (error) {
    toast(error.message || 'No se pudo sincronizar. Los datos permanecen en el dispositivo.');
  } finally {
    clearTimeout(avisoDemora);
    if (button) { button.disabled = false; button.textContent = original; }
    updateNetworkChip();
    // Si llegaron registros de otros equipos hay que redibujar la pantalla,
    // porque las listas que el usuario tiene a la vista quedaron desactualizadas.
    if (recibidos) showView(currentView);
    else if (currentView === 'sync') renderSync();
    else refreshBadges();
  }
}

async function updateNetworkChip() {
  const server = navigator.onLine ? await pingServer(2500) : { ok: false };
  const chip = $('#networkChip');
  if (!chip) return;
  chip.className = `chip ${server.ok ? 'online' : 'offline'}`;
  chip.textContent = server.ok ? '● Servidor disponible' : navigator.onLine ? '● Sin servidor' : '● Sin conexión';
}

function bindEvents() {
  $('#loginForm').onsubmit = async (event) => {
    event.preventDefault();
    const user = $('#loginUser').value.trim().toLowerCase();
    const account = credentials[user];
    if (!account || account.password !== $('#loginPass').value) return toast('Credenciales incorrectas.');
    session = { user, role: account.role, initials: account.initials, permisos: account.permisos };
    sessionStorage.setItem('nutrirural-session', JSON.stringify(session));
    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    $('#roleLabel').textContent = session.role;
    $('#avatar').textContent = session.initials;
    showView('dashboard');
    updateNetworkChip();
  };
  $('#logoutBtn').onclick = () => {
    sessionStorage.removeItem('nutrirural-session');
    session = null;
    $('#appShell').classList.add('hidden');
    $('#loginScreen').classList.remove('hidden');
  };
  $$('.nav-item[data-view]').forEach((button) => button.onclick = () => showView(button.dataset.view));
  $('#menuBtn').onclick = () => $('.sidebar').classList.toggle('open');
  $('#quickSyncBtn').onclick = doSync;
  $('#childForm').onsubmit = saveChild;
  $('#assessmentForm').onsubmit = saveAssessment;

  // Cerrar o cancelar cualquier dialogo. Antes los botones enviaban el formulario,
  // asi que la validacion de los campos obligatorios impedia salir de la ventana.
  document.addEventListener('click', (event) => {
    const boton = event.target.closest('[data-close]');
    if (!boton) return;
    event.preventDefault();
    document.getElementById(boton.dataset.close)?.close();
  });
  // La tecla Escape tambien debe cerrar sin dejar el formulario a medias.
  $$('dialog.modal').forEach((dialogo) => dialogo.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialogo.close();
  }));

  soloDigitos($('#childForm').elements.code, 8);
  soloDigitos($('#childForm').elements.phone, 9);
  $('#assessmentForm').elements.date.addEventListener('change', async () => {
    const form = $('#assessmentForm');
    aplicarLimiteProximoControl(form);
    const childId = form.elements.childId.value;
    if (!childId) return;
    const child = await get('children', childId);
    if (child) aplicarDisponibilidadMuac(form, child);
  });
  ['input', 'change'].forEach((name) => $('#assessmentForm').addEventListener(name, () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updateScreeningPreview, 160);
  }));
  window.addEventListener('online', updateNetworkChip);
  window.addEventListener('offline', updateNetworkChip);
}

async function init() {
  if (!localStorage.getItem('nutrirural-device')) localStorage.setItem('nutrirural-device', newId('device'));
  await openDb();
  await seedDemoData();
  bindEvents();
  const saved = sessionStorage.getItem('nutrirural-session');
  if (saved) {
    try {
      session = JSON.parse(saved);
      // Los permisos se vuelven a tomar de la definicion del perfil y no de lo
      // guardado en el navegador, para que no se puedan alterar manualmente.
      session.permisos = credentials[session.user]?.permisos || [];
      $('#loginScreen').classList.add('hidden');
      $('#appShell').classList.remove('hidden');
      $('#roleLabel').textContent = session.role;
      $('#avatar').textContent = session.initials;
      await showView('dashboard');
      updateNetworkChip();
    } catch { sessionStorage.removeItem('nutrirural-session'); }
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init().catch((error) => {
  console.error(error);
  toast(`No se pudo iniciar la plataforma: ${error.message}`);
});
