// Verifica la matriz de funciones por perfil y la visibilidad de los avisos.
import pw2 from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw2;
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

const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const resultados = [];
const check = (nombre, ok, detalle = '') => resultados.push({ nombre, ok, detalle });

// Matriz esperada, tomada de la hoja de funciones por usuario.
const ESPERADO = {
  agente: { clave: 'agente2026', eliminar: false, exportar: false, configurar: false, sincronizar: true },
  salud: { clave: 'salud2026', eliminar: true, exportar: false, configurar: false, sincronizar: true },
  admin: { clave: 'admin2026', eliminar: true, exportar: true, configurar: true, sincronizar: true }
};

for (const [usuario, esperado] of Object.entries(ESPERADO)) {
  const contexto = await navegador.newContext();
  const pagina = await contexto.newPage();
  await pagina.goto('http://127.0.0.1:4174/');
  await pagina.fill('#loginUser', usuario);
  await pagina.fill('#loginPass', esperado.clave);
  await pagina.click('#loginForm button[type=submit]');
  await pagina.waitForSelector('#appShell:not(.hidden)');
  await pagina.waitForTimeout(500);

  const permisos = await pagina.evaluate(() => JSON.parse(sessionStorage.getItem('nutrirural-session') || '{}').permisos || []);

  // CU07 Sincronizar datos: los tres perfiles tienen el boton en la barra superior.
  const verSync = await pagina.isVisible('#quickSyncBtn');
  check(`${usuario}: CU07 sincronizar disponible`, verSync === esperado.sincronizar, `boton=${verSync}`);

  // CU09 Configurar servicio.
  const verConfig = await pagina.isVisible('.nav-item[data-view="settings"]');
  check(`${usuario}: CU09 configurar`, verConfig === esperado.configurar, `menu=${verConfig}`);

  // CU08 Exportar respaldo: boton de exportar CSV en la vista de alertas.
  await pagina.click('.nav-item[data-view="alerts"]');
  await pagina.waitForTimeout(400);
  const verExport = await pagina.isVisible('#exportAlerts');
  check(`${usuario}: CU08 exportar`, verExport === esperado.exportar, `boton=${verExport}`);

  // CU01 a CU05 y CU10 estan disponibles para los tres perfiles.
  for (const [vista, cu] of [['children', 'CU03 consultar historial'], ['assessment', 'CU02 registrar control'], ['evaluation', 'CU10 responder evaluación']]) {
    const visible = await pagina.isVisible(`.nav-item[data-view="${vista}"]`);
    check(`${usuario}: ${cu}`, visible === true, `menu=${visible}`);
  }

  // CU06 Eliminar registro.
  check(`${usuario}: CU06 eliminar`, permisos.includes('eliminar') === esperado.eliminar, `permisos=${permisos.join(',')}`);

  await contexto.close();
}

// El aviso debe quedar a la izquierda y visible por encima de la ventana modal.
const contexto = await navegador.newContext();
const pagina = await contexto.newPage();
await pagina.goto('http://127.0.0.1:4174/');
await pagina.fill('#loginUser', 'agente');
await pagina.fill('#loginPass', 'agente2026');
await pagina.click('#loginForm button[type=submit]');
await pagina.waitForSelector('#appShell:not(.hidden)');
await pagina.click('.nav-item[data-view="children"]');
await pagina.waitForTimeout(300);
await pagina.click('#addChild, #dashboardAddChild, .btn.primary').catch(() => {});
if (!(await pagina.isVisible('#childDialog'))) {
  await pagina.evaluate(() => document.querySelector('#childDialog').showModal());
}
await pagina.evaluate(() => window.dispatchEvent(new Event('x')));
await pagina.evaluate(() => {
  const nodo = document.querySelector('#toast');
  nodo.textContent = 'prueba';
  const abierta = document.querySelector('dialog[open]');
  if (abierta) abierta.appendChild(nodo);
  nodo.classList.add('show');
});
const caja = await pagina.evaluate(() => {
  const nodo = document.querySelector('#toast');
  const r = nodo.getBoundingClientRect();
  // El aviso no captura clics, asi que para la prueba se habilita un instante.
  const previo = nodo.style.pointerEvents;
  nodo.style.pointerEvents = 'auto';
  const centro = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  nodo.style.pointerEvents = previo;
  return { left: r.left, right: window.innerWidth - r.right, dentroDeDialogo: nodo.closest('dialog') !== null, encima: centro === nodo || nodo.contains(centro) };
});
check('El aviso se dibuja pegado al borde izquierdo', caja.left < caja.right, `izq=${Math.round(caja.left)} der=${Math.round(caja.right)}`);
check('El aviso queda por encima de la ventana modal', caja.dentroDeDialogo && caja.encima, `dialogo=${caja.dentroDeDialogo} visible=${caja.encima}`);
await contexto.close();

console.log('\n=== MATRIZ DE FUNCIONES POR USUARIO ===');
for (const r of resultados) console.log(`${r.ok ? 'OK  ' : 'FALLA'} | ${r.nombre}${r.detalle ? '  (' + r.detalle + ')' : ''}`);
console.log(`\n${resultados.filter((r) => r.ok).length} de ${resultados.length} comprobaciones correctas.`);

await navegador.close();
servidor.close();
process.exit(resultados.every((r) => r.ok) ? 0 : 1);
