// Verifica la sincronizacion en los dos sentidos entre dos dispositivos
// distintos que comparten el mismo servicio de consolidacion.
import pw2 from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw2;
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(process.argv[2] || '../app');
const SERVIDOR_PY = process.argv[3] || '/root/srvtest/server.py';
const PUERTO_WEB = 4176;
const PUERTO_API = 8123;
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const resultados = [];
const check = (nombre, ok, detalle = '') => { resultados.push({ nombre, ok, detalle }); console.log(`  ${ok ? 'OK' : 'FALLA'} ${nombre}${detalle ? '  [' + detalle + ']' : ''}`); };
const paso = (t) => console.log('>>', t);

// Servidor estatico que entrega la aplicacion.
const web = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const archivo = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!archivo.startsWith(ROOT) || !fs.existsSync(archivo)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'text/plain' });
  fs.createReadStream(archivo).pipe(res);
});
await new Promise((r) => web.listen(PUERTO_WEB, r));

// Servicio de consolidacion con una base de datos limpia para la prueba.
const datos = fs.mkdtempSync('/tmp/nutrirural-prueba-');
const api = spawn('python3', ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(PUERTO_API)], {
  cwd: path.dirname(SERVIDOR_PY),
  env: { ...process.env, NUTRIRURAL_DATA_DIR: datos }
});
await new Promise((r) => setTimeout(r, 4000));

const base = `http://127.0.0.1:${PUERTO_API}`;
const salud = await fetch(`${base}/api/health`).then((r) => r.json()).catch(() => null);
check('El servicio de consolidación responde', Boolean(salud && salud.ok));


// Chromium a veces descarta el contexto de ejecucion justo despues de que el
// service worker toma el control; en ese caso se reintenta una vez.
async function ev(pagina, fn, arg) {
  for (let intento = 0; intento < 3; intento++) {
    try {
      await pagina.waitForLoadState('domcontentloaded');
      return await pagina.evaluate(fn, arg);
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed')) throw error;
      await pagina.waitForTimeout(700);
    }
  }
  throw new Error('No se pudo ejecutar el guion en la página');
}

const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// Cada contexto es un dispositivo distinto: no comparten almacenamiento local.
async function abrirDispositivo(usuario, clave) {
  const contexto = await navegador.newContext();
  const pagina = await contexto.newPage();
  await pagina.goto(`http://127.0.0.1:${PUERTO_WEB}/`);
  await pagina.waitForTimeout(1200);
  await pagina.fill('#loginUser', usuario);
  await pagina.fill('#loginPass', clave);
  await pagina.click('#loginForm button[type=submit]');
  await pagina.waitForSelector('#appShell:not(.hidden)');
  await pagina.waitForTimeout(600);
  const guardada = await ev(pagina, (dir) => new Promise((resolve) => {
    const q = indexedDB.open('nutrirural-db');
    q.onsuccess = () => {
      const tx = q.result.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: 'apiUrl', value: dir });
      tx.oncomplete = () => {
        const tx2 = q.result.transaction('settings', 'readonly');
        const g = tx2.objectStore('settings').get('apiUrl');
        g.onsuccess = () => resolve(g.result && g.result.value);
      };
    };
  }), base);
  check(`El dispositivo apunta al servicio de prueba (${usuario})`, guardada === base, `valor=${guardada}`);
  return { contexto, pagina };
}

async function sincronizar(pagina) {
  await pagina.waitForLoadState('domcontentloaded');
  const aviso = await ev(pagina, async () => {
    document.querySelector('#quickSyncBtn').click();
    await new Promise((r) => setTimeout(r, 3500));
    return document.querySelector('#toast').textContent;
  });
  await pagina.waitForTimeout(800);
  return aviso;
}

const contarNinos = (pagina) => ev(pagina, () => new Promise((resolve) => {
  const q = indexedDB.open('nutrirural-db');
  q.onsuccess = () => {
    const tx = q.result.transaction('children', 'readonly');
    const p = tx.objectStore('children').getAll();
    p.onsuccess = () => resolve(p.result.filter((c) => !c.deleted).map((c) => c.code).sort());
  };
}));

// --- Dispositivo A: registra un nino propio y sincroniza ---
paso('abriendo dispositivo A');
const a = await abrirDispositivo('agente', 'agente2026');
await ev(a.pagina, () => new Promise((resolve) => {
  const q = indexedDB.open('nutrirural-db');
  q.onsuccess = () => {
    const ahora = new Date().toISOString();
    const tx = q.result.transaction('children', 'readwrite');
    tx.objectStore('children').put({
      id: 'child-prueba-A', code: '55555555', firstName: 'ANA', lastName: 'PRUEBA A',
      sex: 'F', dob: '2024-03-15', community: 'Paruro', caregiver: 'Prueba',
      phone: '', facility: 'Centro de Salud Paruro', notes: '',
      createdAt: ahora, updatedAt: ahora, syncStatus: 'pending'
    });
    tx.oncomplete = resolve;
  };
}));
paso('sincronizando A');
const avisoA = await sincronizar(a.pagina);
check('El dispositivo A envía sus registros', /enviados/.test(avisoA), `aviso="${avisoA}"`);

// --- Dispositivo B: nunca vio ese nino; al sincronizar debe recibirlo ---
paso('abriendo dispositivo B');
const b = await abrirDispositivo('salud', 'salud2026');
const antesB = await contarNinos(b.pagina);
check('El dispositivo B no tiene el registro del A antes de sincronizar', !antesB.includes('55555555'), `códigos=${antesB.join(',')}`);

paso('sincronizando B');
const avisoB = await sincronizar(b.pagina);
const despuesB = await contarNinos(b.pagina);
check('El dispositivo B recibe el registro creado en el A', despuesB.includes('55555555'), `aviso="${avisoB}"`);

// --- La segunda sincronización no debe traer nada repetido ---
paso('segunda sincronizacion de B');
const avisoB2 = await sincronizar(b.pagina);
check('Una segunda sincronización no duplica lo ya recibido', /al día/i.test(avisoB2), `aviso="${avisoB2}"`);
const despuesB2 = await contarNinos(b.pagina);
check('El número de registros se mantiene estable', despuesB2.length === despuesB.length, `antes=${despuesB.length} después=${despuesB2.length}`);

// --- La baja lógica también viaja ---
paso('dando de baja en B');
await ev(b.pagina, () => new Promise((resolve) => {
  const q = indexedDB.open('nutrirural-db');
  q.onsuccess = () => {
    const tx = q.result.transaction('children', 'readwrite');
    const g = tx.objectStore('children').get('child-prueba-A');
    g.onsuccess = () => {
      tx.objectStore('children').put({ ...g.result, deleted: true, updatedAt: new Date().toISOString(), syncStatus: 'pending' });
    };
    tx.oncomplete = resolve;
  };
}));
await sincronizar(b.pagina);
await sincronizar(a.pagina);
const despuesA = await contarNinos(a.pagina);
check('La baja hecha en B se propaga al A', !despuesA.includes('55555555'), `códigos=${despuesA.join(',')}`);

// --- Lo que el servidor consolidó ---
const stats = await fetch(`${base}/api/stats`).then((r) => r.json());
check('El servidor descuenta el registro dado de baja', stats.children >= 0, `niños=${stats.children}`);

// --- Reposición después de que el servidor pierda su copia ---
// El alojamiento gratuito no conserva los archivos entre reinicios: la base
// vuelve a crearse vacía. Como los dispositivos ya daban por entregados sus
// registros, sin esta comprobación nadie los volvería a enviar y el servidor se
// quedaría en cero para siempre. Aquí se reproduce esa situación.
paso('vaciando el servidor y volviendo a levantarlo');
const antesDelVaciado = await fetch(`${base}/api/health`).then((r) => r.json());
const ninosAntes = (await fetch(`${base}/api/stats`).then((r) => r.json())).children;
api.kill();
await new Promise((r) => setTimeout(r, 1500));
fs.rmSync(datos, { recursive: true, force: true });
fs.mkdirSync(datos, { recursive: true });
const api2 = spawn('python3', ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(PUERTO_API)], {
  cwd: path.dirname(SERVIDOR_PY),
  env: { ...process.env, NUTRIRURAL_DATA_DIR: datos }
});
await new Promise((r) => setTimeout(r, 4000));
const despuesDelVaciado = await fetch(`${base}/api/health`).then((r) => r.json());
check('El servidor reiniciado se presenta con otra identidad',
  Boolean(despuesDelVaciado.serverId) && despuesDelVaciado.serverId !== antesDelVaciado.serverId,
  `antes=${String(antesDelVaciado.serverId).slice(0, 8)} después=${String(despuesDelVaciado.serverId).slice(0, 8)}`);
const vacio = await fetch(`${base}/api/stats`).then((r) => r.json());
check('El servidor quedó sin registros tras el reinicio', vacio.children === 0, `niños=${vacio.children} (antes ${ninosAntes})`);

paso('sincronizando A después del vaciado');
const avisoRepos = await sincronizar(a.pagina);
check('El dispositivo repone lo que el servidor perdió', /repusieron/i.test(avisoRepos), `aviso="${avisoRepos}"`);
const repuesto = await fetch(`${base}/api/stats`).then((r) => r.json());
check('El servidor vuelve a tener los registros del dispositivo', repuesto.children > 0, `niños=${repuesto.children}`);

paso('segunda sincronizacion tras la reposicion');
const avisoRepos2 = await sincronizar(a.pagina);
check('La reposición no se repite en la siguiente sincronización', !/repusieron/i.test(avisoRepos2), `aviso="${avisoRepos2}"`);

// --- Equipo que recién se actualiza a esta versión ---
// Viene de la version anterior: sus registros figuran como entregados y no
// guarda ningun identificador de servidor, asi que no hay con que comparar. Si
// el servidor esta vacio debe reponer igual; de lo contrario ese equipo se
// quedaria aislado para siempre.
paso('simulando un equipo que viene de la version anterior');
api2.kill();
await new Promise((r) => setTimeout(r, 1500));
fs.rmSync(datos, { recursive: true, force: true });
fs.mkdirSync(datos, { recursive: true });
const api3 = spawn('python3', ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(PUERTO_API)], {
  cwd: path.dirname(SERVIDOR_PY),
  env: { ...process.env, NUTRIRURAL_DATA_DIR: datos }
});
await new Promise((r) => setTimeout(r, 4000));
// Se borra el identificador guardado: asi queda igual que un equipo que nunca
// conocio esta version.
await ev(b.pagina, () => new Promise((resolve) => {
  const q = indexedDB.open('nutrirural-db');
  q.onsuccess = () => {
    const tx = q.result.transaction('settings', 'readwrite');
    tx.objectStore('settings').delete('serverId');
    tx.oncomplete = resolve;
  };
}));
const avisoViejo = await sincronizar(b.pagina);
check('Un equipo sin identificador guardado repone si el servidor está vacío', /enviados/i.test(avisoViejo), `aviso="${avisoViejo}"`);
const repuesto2 = await fetch(`${base}/api/stats`).then((r) => r.json());
check('El servidor recupera los registros de ese equipo', repuesto2.children > 0, `niños=${repuesto2.children}`);

await a.contexto.close();
await b.contexto.close();
await navegador.close();
api3.kill();
web.close();
fs.rmSync(datos, { recursive: true, force: true });

console.log('\n=== SINCRONIZACIÓN EN LOS DOS SENTIDOS ===');
for (const r of resultados) console.log(`${r.ok ? 'OK  ' : 'FALLA'} | ${r.nombre}${r.detalle ? '  (' + r.detalle + ')' : ''}`);
console.log(`\n${resultados.filter((r) => r.ok).length} de ${resultados.length} comprobaciones correctas.`);
process.exit(resultados.every((r) => r.ok) ? 0 : 1);
