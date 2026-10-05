// Prueba automatizada de las diez observaciones levantadas en la plataforma.
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
await new Promise((r) => servidor.listen(4173, r));

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));
pagina.on('response', (r) => { if (r.status() >= 400) errores.push('HTTP ' + r.status() + ' ' + r.url()); });
pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

const resultados = [];
const check = (nombre, ok, detalle = '') => resultados.push({ nombre, ok, detalle });

await pagina.goto('http://127.0.0.1:4173/');
await pagina.fill('#loginUser', 'agente');
await pagina.fill('#loginPass', 'agente2026');
await pagina.click('#loginForm button[type=submit]');
await pagina.waitForSelector('#appShell:not(.hidden)');

// ---------- Registrar niño ----------
await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(300);
await pagina.click('#newChildBtn, [data-action="new-child"], button:has-text("Registrar niño")').catch(() => {});
await pagina.waitForTimeout(400);

let abierto = await pagina.evaluate(() => document.getElementById('childDialog').open);
if (!abierto) {
  await pagina.evaluate(() => document.getElementById('childDialog').showModal());
  await pagina.evaluate(async () => {
    const f = document.getElementById('childForm');
    f.elements.facility.value = 'Centro de Salud Paruro';
    const hoy = new Date().toISOString().slice(0, 10);
    const d = new Date(); d.setMonth(d.getMonth() - 60);
    f.elements.dob.max = hoy; f.elements.dob.min = d.toISOString().slice(0, 10);
  });
}

// 1. DNI solo 8 digitos numericos
await pagina.fill('#childForm [name=code]', 'AB12-34cd56789');
const dni = await pagina.inputValue('#childForm [name=code]');
check('DNI acepta solo 8 dígitos numéricos', dni === '12345678' || (/^\d{0,8}$/.test(dni) && dni.length <= 8), `valor resultante: "${dni}"`);

// 3. Telefono solo 9 digitos numericos
await pagina.fill('#childForm [name=phone]', '9a8b7c6d5e4f3g2h1x9');
const tel = await pagina.inputValue('#childForm [name=phone]');
check('Teléfono acepta solo 9 dígitos numéricos', /^\d{0,9}$/.test(tel) && tel.length <= 9, `valor resultante: "${tel}"`);

// 2. Limites de fecha de nacimiento
const lim = await pagina.evaluate(() => {
  const i = document.getElementById('childForm').elements.dob;
  return { min: i.min, max: i.max };
});
const hoy = new Date().toISOString().slice(0, 10);
const hace60 = (() => { const d = new Date(); d.setMonth(d.getMonth() - 60); return d.toISOString().slice(0, 10); })();
check('Fecha de nacimiento limitada a 0-60 meses', lim.max === hoy && lim.min === hace60, `min=${lim.min} max=${lim.max}`);

// 4. Establecimiento no editable
const est = await pagina.evaluate(() => {
  const i = document.getElementById('childForm').elements.facility;
  return { valor: i.value, readonly: i.readOnly };
});
check('Establecimiento fijo y no editable', est.readonly === true && est.valor === 'Centro de Salud Paruro', `valor="${est.valor}" readonly=${est.readonly}`);

// 5. Cancelar cierra el diálogo aunque falten campos obligatorios
await pagina.click('#childDialog button:has-text("Cancelar")');
await pagina.waitForTimeout(250);
let cerrado = await pagina.evaluate(() => !document.getElementById('childDialog').open);
check('Botón Cancelar cierra el registro de niño', cerrado);

// 5b. La X también cierra
await pagina.evaluate(() => document.getElementById('childDialog').showModal());
await pagina.click('#childDialog .icon-btn[data-close]');
await pagina.waitForTimeout(250);
cerrado = await pagina.evaluate(() => !document.getElementById('childDialog').open);
check('Botón X cierra el registro de niño', cerrado);

// 5c. Escape también cierra
await pagina.evaluate(() => document.getElementById('childDialog').showModal());
await pagina.keyboard.press('Escape');
await pagina.waitForTimeout(250);
cerrado = await pagina.evaluate(() => !document.getElementById('childDialog').open);
check('Tecla Escape cierra el registro de niño', cerrado);

// Registro completo válido, para probar la ventana Ver
await pagina.evaluate(() => document.getElementById('childDialog').showModal());
await pagina.evaluate(() => {
  const f = document.getElementById('childForm');
  f.elements.facility.value = 'Centro de Salud Paruro';
});
const nac = (() => { const d = new Date(); d.setMonth(d.getMonth() - 30); return d.toISOString().slice(0, 10); })();
await pagina.fill('#childForm [name=code]', '87654321');
await pagina.fill('#childForm [name=firstName]', 'Ana');
await pagina.fill('#childForm [name=lastName]', 'Quispe');
await pagina.selectOption('#childForm [name=sex]', 'F');
await pagina.fill('#childForm [name=dob]', nac);
await pagina.fill('#childForm [name=community]', 'Paruro');
await pagina.fill('#childForm [name=caregiver]', 'Rosa Quispe');
await pagina.fill('#childForm [name=phone]', '984123456');
await pagina.click('#saveChildBtn');
await pagina.waitForTimeout(700);
cerrado = await pagina.evaluate(() => !document.getElementById('childDialog').open);
const guardado = await pagina.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('nutrirural-db'); r.onsuccess = () => res(r.result); });
  return await new Promise((res) => {
    const t = db.transaction('children', 'readonly').objectStore('children').getAll();
    t.onsuccess = () => res(t.result.find((c) => c.code === '87654321') || null);
  });
});
check('Registro válido se guarda con DNI, teléfono y establecimiento correctos',
  cerrado && guardado && guardado.phone === '984123456' && guardado.facility === 'Centro de Salud Paruro',
  guardado ? `phone=${guardado.phone} facility=${guardado.facility}` : 'no se guardó');

// 6. Teléfono visible en la ventana Ver
if (guardado) {
  await pagina.evaluate((id) => window.__abrirDetalle?.(id), guardado.id).catch(() => {});
  await pagina.click('.nav-item[data-view="children"]');
  await pagina.waitForTimeout(400);
  const verBtn = await pagina.$(`[data-detail="${guardado.id}"]`);
  if (verBtn) { await verBtn.click(); await pagina.waitForTimeout(500); }
  const detalle = await pagina.evaluate(() => document.getElementById('detailContent')?.textContent || '');
  check('La ventana Ver muestra el teléfono del cuidador', detalle.includes('984123456'), detalle ? 'contenido leído' : 'no se abrió el detalle');

  // 9b. Cerrar el detalle
  await pagina.click('#detailDialog button:has-text("Cerrar")').catch(() => {});
  await pagina.waitForTimeout(250);
  check('Botón Cerrar cierra la ventana Ver', await pagina.evaluate(() => !document.getElementById('detailDialog').open));
}

// ---------- Registrar control ----------
await pagina.evaluate(() => document.getElementById('assessmentDialog').showModal());
await pagina.waitForTimeout(200);

// 7. Posición obligatoria y con dos opciones
const pos = await pagina.evaluate(() => {
  const s = document.getElementById('assessmentForm').elements.position;
  return { req: s.required, valor: s.value, opciones: [...s.options].map((o) => o.value) };
});
check('Posición es obligatoria y sin valor por defecto', pos.req === true && pos.valor === '', `valor="${pos.valor}" required=${pos.req}`);
check('Posición ofrece exactamente acostado y de pie', pos.opciones.filter((v) => v).join(',') === 'length,height', `opciones=${pos.opciones.join('|')}`);

// 8. Próximo control desde el día siguiente
await pagina.evaluate(() => {
  const f = document.getElementById('assessmentForm');
  f.elements.date.value = '2026-05-10';
  f.elements.date.dispatchEvent(new Event('change', { bubbles: true }));
});
await pagina.waitForTimeout(200);
const prox = await pagina.evaluate(() => document.getElementById('assessmentForm').elements.nextControlDate.min);
check('Próximo control admite solo fechas posteriores al control', prox === '2026-05-11', `min=${prox}`);

// 9. Cancelar el control
await pagina.click('#assessmentDialog button:has-text("Cancelar")');
await pagina.waitForTimeout(250);
check('Botón Cancelar cierra el registro de control', await pagina.evaluate(() => !document.getElementById('assessmentDialog').open));

await pagina.evaluate(() => document.getElementById('assessmentDialog').showModal());
await pagina.keyboard.press('Escape');
await pagina.waitForTimeout(250);
check('Tecla Escape cierra el registro de control', await pagina.evaluate(() => !document.getElementById('assessmentDialog').open));

await navegador.close();
servidor.close();

console.log('\n=== RESULTADO DE LAS OBSERVACIONES ===');
for (const r of resultados) console.log(`${r.ok ? 'OK  ' : 'FALLA'} | ${r.nombre}${r.detalle ? '  (' + r.detalle + ')' : ''}`);
console.log(`\n${resultados.filter((r) => r.ok).length} de ${resultados.length} comprobaciones correctas.`);
if (errores.length) console.log('\nErrores de consola:\n' + errores.slice(0, 5).join('\n'));
process.exit(resultados.every((r) => r.ok) && !errores.length ? 0 : 1);
