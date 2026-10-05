// Pruebas de las mejoras funcionales: edición, permisos por perfil, controles
// programados, borrado lógico, duplicado por fecha y detalles menores.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '../app');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const archivo = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!archivo.startsWith(ROOT) || !fs.existsSync(archivo)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'text/plain' });
  fs.createReadStream(archivo).pipe(res);
});
await new Promise((r) => servidor.listen(4174, r));

const navegador = await chromium.launch();
// Un solo contexto para que IndexedDB se comparta entre los inicios de sesión.
const contexto = await navegador.newContext();
let paginaUnica = null;
const resultados = [];
const errores = [];
const check = (n, ok, d = '') => resultados.push({ n, ok, d });

async function entrar(usuario, clave) {
  if (!paginaUnica) {
    paginaUnica = await contexto.newPage();
    paginaUnica.on('pageerror', (e) => errores.push(String(e)));
    paginaUnica.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errores.push(m.text()); });
    paginaUnica.on('dialog', (d) => d.accept());
    await paginaUnica.goto('http://127.0.0.1:4174/');
  } else {
    await paginaUnica.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await paginaUnica.click('#logoutBtn');
    await paginaUnica.waitForTimeout(300);
  }
  const pagina = paginaUnica;
  await pagina.fill('#loginUser', usuario);
  await pagina.fill('#loginPass', clave);
  await pagina.click('#loginForm button[type=submit]');
  await pagina.waitForSelector('#appShell:not(.hidden)');
  await pagina.waitForTimeout(500);
  return pagina;
}

const cerrarDialogos = (pagina) => pagina.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

const leerNinos = (pagina) => pagina.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('nutrirural-db'); q.onsuccess = () => r(q.result); });
  return await new Promise((r) => { const t = db.transaction('children', 'readonly').objectStore('children').getAll(); t.onsuccess = () => r(t.result); });
});
const leerControles = (pagina) => pagina.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('nutrirural-db'); q.onsuccess = () => r(q.result); });
  return await new Promise((r) => { const t = db.transaction('assessments', 'readonly').objectStore('assessments').getAll(); t.onsuccess = () => r(t.result); });
});

// ============================ PERFIL AGENTE ============================
let pagina = await entrar('agente', 'agente2026');

// Configuración oculta para el agente
const verConfigAgente = await pagina.evaluate(() => !document.querySelector('.nav-item[data-view="settings"]').hidden);
check('Agente no ve la sección Configuración', verConfigAgente === false);

// Aunque fuerce la vista, no entra
await pagina.evaluate(() => document.querySelector('.nav-item[data-view="settings"]').click());
await pagina.waitForTimeout(400);
const tituloAgente = await pagina.textContent('#viewTitle');
check('Agente no puede abrir Configuración forzando la navegación', tituloAgente !== 'Configuración', `título=${tituloAgente}`);

// Registrar un niño para las pruebas siguientes
const nac = (() => { const d = new Date(); d.setMonth(d.getMonth() - 30); return d.toISOString().slice(0, 10); })();
await pagina.evaluate(() => document.getElementById('childDialog').showModal());
await pagina.fill('#childForm [name=code]', '11223344');
await pagina.fill('#childForm [name=firstName]', 'Lucía');
await pagina.fill('#childForm [name=lastName]', 'Ccahuana');
await pagina.selectOption('#childForm [name=sex]', 'F');
await pagina.fill('#childForm [name=dob]', nac);
await pagina.fill('#childForm [name=community]', 'Paruro');
await pagina.fill('#childForm [name=phone]', '984111222');
await pagina.click('#saveChildBtn');
await pagina.waitForTimeout(600);
let ninos = await leerNinos(pagina);
const nino = ninos.find((c) => c.code === '11223344');
check('Se registra el niño de prueba', Boolean(nino));

// El agente no ve el botón de eliminar en la ventana Ver
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(400);
await pagina.click(`[data-detail="${nino.id}"]`);
await pagina.waitForTimeout(400);
check('Agente no ve el botón Eliminar registro', await pagina.evaluate(() => !document.getElementById('detailDeleteChild')));
check('Agente sí ve el botón Editar datos del niño', await pagina.evaluate(() => Boolean(document.getElementById('detailEditChild'))));

// ---- Edición de niño ----
await pagina.click('#detailEditChild');
await pagina.waitForTimeout(400);
const tituloDialogo = await pagina.textContent('#childDialogTitle');
const codigoPrecargado = await pagina.inputValue('#childForm [name=code]');
check('El diálogo entra en modo edición con los datos cargados', tituloDialogo === 'Editar datos del niño' && codigoPrecargado === '11223344', `título=${tituloDialogo} código=${codigoPrecargado}`);
await pagina.fill('#childForm [name=phone]', '984999888');
await pagina.click('#saveChildBtn');
await pagina.waitForTimeout(700);
ninos = await leerNinos(pagina);
const editado = ninos.filter((c) => c.code === '11223344');
check('La edición actualiza el registro sin duplicarlo', editado.length === 1 && editado[0].phone === '984999888' && editado[0].id === nino.id, `n=${editado.length} phone=${editado[0]?.phone}`);

// ---- Registrar un control ----
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(400);
await pagina.click(`[data-control="${nino.id}"]`);
await pagina.waitForTimeout(500);
await pagina.fill('#assessmentForm [name=weightKg]', '12.4');
await pagina.fill('#assessmentForm [name=heightCm]', '89.5');
await pagina.selectOption('#assessmentForm [name=position]', 'height');
await pagina.fill('#assessmentForm [name=muacMm]', '138');
await pagina.click('#saveAssessmentBtn');
await pagina.waitForTimeout(800);
let controles = (await leerControles(pagina)).filter((a) => a.childId === nino.id);
check('Se guarda el control con tamizaje', controles.length === 1 && Number.isFinite(controles[0].screening?.waz), `n=${controles.length}`);

// ---- Duplicado el mismo día ----
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(400);
await pagina.click(`[data-control="${nino.id}"]`);
await pagina.waitForTimeout(500);
await pagina.fill('#assessmentForm [name=weightKg]', '12.6');
await pagina.fill('#assessmentForm [name=heightCm]', '89.7');
await pagina.selectOption('#assessmentForm [name=position]', 'height');
await pagina.click('#saveAssessmentBtn');
await pagina.waitForTimeout(700);
controles = (await leerControles(pagina)).filter((a) => a.childId === nino.id && !a.deleted);
const avisoDuplicado = await pagina.textContent('#toast');
check('Bloquea un segundo control en la misma fecha', controles.length === 1 && avisoDuplicado.includes('Ya existe un control'), `n=${controles.length} aviso="${avisoDuplicado}"`);
await pagina.click('#assessmentDialog button:has-text("Cancelar")');
await pagina.waitForTimeout(300);

// ---- Edición de control ----
await pagina.click(`[data-detail="${nino.id}"]`);
await pagina.waitForTimeout(500);
const hayEditarControl = await pagina.evaluate(() => Boolean(document.querySelector('[data-edit-assessment]')));
check('El historial ofrece editar cada control', hayEditarControl);
if (hayEditarControl) {
  await pagina.click('[data-edit-assessment]');
  await pagina.waitForTimeout(600);
  const pesoPrecargado = await pagina.inputValue('#assessmentForm [name=weightKg]');
  await pagina.fill('#assessmentForm [name=weightKg]', '10.2');
  await pagina.click('#saveAssessmentBtn');
  await pagina.waitForTimeout(800);
  controles = (await leerControles(pagina)).filter((a) => a.childId === nino.id && !a.deleted);
  check('Editar un control recalcula el tamizaje sin duplicar',
    controles.length === 1 && controles[0].weightKg === 10.2 && controles[0].screening?.waz !== null,
    `precargado=${pesoPrecargado} n=${controles.length} peso=${controles[0]?.weightKg} waz=${controles[0]?.screening?.waz}`);
}

// ---- Tendencia en el historial ----
await pagina.evaluate(() => document.getElementById('detailDialog')?.close());
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(400);
await pagina.click(`[data-detail="${nino.id}"]`);
await pagina.waitForTimeout(500);
const encabezados = await pagina.evaluate(() => [...document.querySelectorAll('#detailContent th')].map((t) => t.textContent));
check('El historial incluye columna de tendencia', encabezados.includes('Tendencia'), encabezados.join('|'));
await pagina.evaluate(() => document.getElementById('detailDialog')?.close());

// ---- Controles programados en el panel ----
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="dashboard"]');
await pagina.waitForTimeout(600);
const panel = await pagina.textContent('#content');
check('El panel muestra la sección de controles programados', panel.includes('Controles programados'));
check('El panel muestra el indicador de controles vencidos', panel.includes('Controles vencidos'));

// ---- Búsqueda sin tildes ----
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(400);
await pagina.fill('#childSearch', 'lucia');
await pagina.waitForTimeout(300);
const filas = await pagina.textContent('#childrenBody');
check('La búsqueda ignora las tildes', filas.includes('Ccahuana'), 'buscando "lucia" para "Lucía"');

// ---- MUAC fuera de 6-59 meses ----
await pagina.evaluate(() => document.getElementById('childDialog').showModal());
const recien = new Date().toISOString().slice(0, 10);
await pagina.fill('#childForm [name=code]', '55667788');
await pagina.fill('#childForm [name=firstName]', 'Bebé');
await pagina.fill('#childForm [name=lastName]', 'Nuevo');
await pagina.selectOption('#childForm [name=sex]', 'M');
await pagina.fill('#childForm [name=dob]', recien);
await pagina.fill('#childForm [name=community]', 'Paruro');
await pagina.click('#saveChildBtn');
await pagina.waitForTimeout(700);
const bebe = (await leerNinos(pagina)).find((c) => c.code === '55667788');
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(400);
await pagina.click(`[data-control="${bebe.id}"]`);
await pagina.waitForTimeout(500);
const muacBloqueado = await pagina.evaluate(() => document.getElementById('assessmentForm').elements.muacMm.disabled);
check('MUAC bloqueado en menores de 6 meses', muacBloqueado === true);
await pagina.click('#assessmentDialog button:has-text("Cancelar")');
await pagina.waitForTimeout(300);
// ============================ PERFIL SALUD: borrado lógico ============================
pagina = await entrar('salud', 'salud2026');
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(500);
check('Personal de salud tampoco ve Configuración', await pagina.evaluate(() => document.querySelector('.nav-item[data-view="settings"]').hidden === true));
await pagina.click(`[data-detail="${nino.id}"]`);
await pagina.waitForTimeout(500);
check('Personal de salud sí ve el botón Eliminar', await pagina.evaluate(() => Boolean(document.getElementById('detailDeleteChild'))));
await pagina.click('#detailDeleteChild');
await pagina.waitForTimeout(900);
ninos = await leerNinos(pagina);
const borrado = ninos.find((c) => c.id === nino.id);
check('El borrado es lógico y queda pendiente de sincronizar',
  Boolean(borrado) && borrado.deleted === true && borrado.syncStatus === 'pending',
  borrado ? `deleted=${borrado.deleted} sync=${borrado.syncStatus}` : 'el registro desapareció');
const listado = await pagina.textContent('#content');
check('El niño eliminado deja de listarse', !listado.includes('Ccahuana'));
const controlesTrasBorrado = (await leerControles(pagina)).filter((a) => a.childId === nino.id);
check('Los controles del niño también quedan marcados', controlesTrasBorrado.every((a) => a.deleted === true), `n=${controlesTrasBorrado.length}`);
// ============================ PERFIL ADMIN ============================
pagina = await entrar('admin', 'admin2026');
check('El administrador sí ve Configuración', await pagina.evaluate(() => document.querySelector('.nav-item[data-view="settings"]').hidden === false));
await cerrarDialogos(pagina); await pagina.click('.nav-item[data-view="settings"]');
await pagina.waitForTimeout(500);
const estConfig = await pagina.evaluate(() => {
  const i = document.querySelector('#settingsForm [name=facility]');
  return { valor: i.value, readonly: i.readOnly };
});
check('Establecimiento en Configuración es de solo lectura', estConfig.readonly === true && estConfig.valor === 'Centro de Salud Paruro', `valor="${estConfig.valor}" readonly=${estConfig.readonly}`);

await navegador.close();
servidor.close();

console.log('\n=== MEJORAS FUNCIONALES ===');
for (const r of resultados) console.log(`${r.ok ? 'OK  ' : 'FALLA'} | ${r.n}${r.d ? '  (' + r.d + ')' : ''}`);
console.log(`\n${resultados.filter((r) => r.ok).length} de ${resultados.length} comprobaciones correctas.`);
if (errores.length) console.log('\nErrores de consola:\n' + [...new Set(errores)].slice(0, 6).join('\n'));
process.exit(resultados.every((r) => r.ok) ? 0 : 1);
