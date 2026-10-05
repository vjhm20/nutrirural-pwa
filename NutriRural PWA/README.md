# NutriRural — MVP offline-first

Prototipo académico desarrollado a partir del plan de tesis **“Diseño y validación de una plataforma digital para detección temprana y monitoreo de desnutrición infantil en zonas rurales con baja conectividad, caso distrito Paruro, Cusco”**.

## Funciones incluidas

- Aplicación web progresiva (PWA), adaptable a celular, tableta y computadora.
- Registro de niños y controles antropométricos.
- Cálculo local de WAZ, HAZ y WHZ mediante tablas LMS de los Estándares de Crecimiento Infantil de la OMS.
- Registro de MUAC, edema, alertas, recomendaciones y próximo control.
- Panel con cobertura, alertas, distribución de riesgo y actividad reciente.
- Historial longitudinal por niño y exportación de alertas en CSV.
- Evaluación SUS y NPS.
- Edición de niños y de controles ya registrados, con recálculo del tamizaje.
- Bloqueo de un segundo control del mismo niño en la misma fecha.
- Panel de controles programados y vencidos, a partir del próximo control.
- Perfiles con permisos diferenciados (agente, salud, administrador).
- Almacenamiento local con IndexedDB y cola de sincronización.
- Baja lógica: los registros eliminados se marcan y la baja viaja al servidor.
- API local FastAPI + SQLite para sincronizar registros.
- Exportación de respaldo local en JSON.

## Puesta en marcha

Requiere Python 3.10 o posterior.

### Windows (PowerShell)

```powershell
cd NutriRural_PWA
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

### macOS o Linux

```bash
cd NutriRural_PWA
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Abra `http://127.0.0.1:8000`.

## Credenciales de demostración

| Perfil | Usuario | Contraseña |
|---|---|---|
| Agente comunitario | `agente` | `agente2026` |
| Personal de salud | `salud` | `salud2026` |
| Administrador | `admin` | `admin2026` |

## Matriz de funciones por perfil

| Caso de uso | Agente comunitario | Personal de salud | Administrador |
|---|:--:|:--:|:--:|
| CU01. Registrar niño | Sí | Sí | Sí |
| CU02. Registrar control | Sí | Sí | Sí |
| CU03. Consultar historial | Sí | Sí | Sí |
| CU04. Revisar alertas | Sí | Sí | Sí |
| CU05. Editar registro | Sí | Sí | Sí |
| CU06. Eliminar registro | No | Sí | Sí |
| CU07. Sincronizar datos | Sí | Sí | Sí |
| CU08. Exportar respaldo | No | No | Sí |
| CU09. Configurar servicio | No | No | Sí |
| CU10. Responder evaluación | Sí | Sí | Sí |

La edición de los datos del niño se ejerce con la misma capacidad de CU05. El
administrador además puede restablecer los datos de demostración.

Los permisos se verifican tanto al dibujar la interfaz como dentro de cada
operación: ocultar un botón no es el único control. Al restaurar una sesión
guardada los permisos se releen de la definición del perfil, de modo que alterar
el almacenamiento del navegador no concede capacidades adicionales.

## Prueba offline

1. Ingrese y recorra la plataforma una vez con el servidor activo.
2. Detenga el servidor o desactive la conectividad.
3. Continúe registrando información: se conservará en IndexedDB.
4. Reinicie el servidor y pulse **Sincronizar**.

## Datos y archivos

- Datos del navegador: IndexedDB `nutrirural-db`.
- Datos sincronizados del servidor: `server_data/nutrirural.sqlite3`.
- Respaldo: Configuración → **Exportar respaldo JSON**.
- Exportación central: `http://127.0.0.1:8000/api/export`.

## Pruebas

```bash
python3 tests/test_reference.py        # integridad de las tablas de la OMS
node tests/test_who.mjs                # cálculo de edad y puntajes z
node tests/validacion_oms.mjs          # pruebas V1 a V4 de la tesis
python3 tests/test_server.py           # API de sincronización
python3 tests/test_baja_logica.py      # baja lógica propagada al servidor
```

Las pruebas de interfaz necesitan Playwright (`npm install playwright && npx playwright install chromium`):

```bash
node tests/prueba_observaciones.mjs app  # validaciones de los formularios
node tests/prueba_mejoras.mjs app       # edición, borrado lógico y controles programados
node tests/prueba_permisos.mjs app      # matriz de funciones por perfil y avisos
node tests/prueba_sincronizacion.mjs app server.py  # sincronización en los dos sentidos
```

Las cuatro suites de interfaz suman 71 comprobaciones.

## Limitaciones importantes

Este producto es un **MVP de investigación**, no un dispositivo médico ni un sistema clínico validado. Aunque incorpora tablas OMS y reglas de tamizaje, antes de usarlo con datos reales debe:

- ser revisado por profesionales de nutrición, pediatría y salud pública;
- compararse caso por caso con WHO Anthro u otra herramienta oficial aprobada;
- aprobar protocolos éticos, consentimiento, seguridad, control de acceso y protección de datos personales;
- adaptarse a las normas y flujos institucionales del MINSA/DIRESA/GERESA;
- reemplazar las credenciales demostrativas por autenticación segura y cifrado.

## Estructura

```text
NutriRural_PWA/
├── app/
│   ├── data/who_reference.json
│   ├── js/{app,api,db,who}.js
│   ├── index.html
│   ├── styles.css
│   ├── manifest.webmanifest
│   └── sw.js
├── server.py
├── requirements.txt
└── tests/
```

## Fuentes antropométricas

Las tablas incluidas en `app/data/who_reference.json` fueron preparadas a partir de las tablas oficiales de los **WHO Child Growth Standards** para peso-edad, longitud/talla-edad y peso-longitud/talla. Referencias:

- https://www.who.int/tools/child-growth-standards
- https://www.who.int/tools/child-growth-standards/software
- https://www.who.int/tools/child-growth-standards/standards/weight-for-age
- https://www.who.int/tools/child-growth-standards/standards/length-height-for-age
- https://www.who.int/tools/child-growth-standards/standards/weight-for-length-height
