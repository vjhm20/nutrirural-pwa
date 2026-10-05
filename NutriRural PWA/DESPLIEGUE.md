# Despliegue de NutriRural

## Que se publica

La PWA (`app/`) es un sitio estatico completo: funciona sin backend porque el
tamizaje, el calculo de puntajes z con las tablas LMS de la OMS y el
almacenamiento se resuelven en el navegador (IndexedDB). Netlify sirve `app/`
tal cual; no hay paso de compilacion.

El servidor `server.py` (FastAPI + SQLite) es **opcional** y se usa solo para la
sincronizacion centralizada durante el piloto. Netlify no lo ejecuta: si se
necesita, se levanta aparte y su direccion se registra dentro de la aplicacion,
en Configuracion, campo "URL del servidor/API".

## Netlify conectado a GitHub

1. Subir este repositorio a GitHub.
2. En Netlify: Add new site > Import an existing project > GitHub, y elegir el
   repositorio.
3. Netlify lee `netlify.toml`, por lo que la configuracion queda asi:
   - Build command: (vacio)
   - Publish directory: `app`
4. Deploy. Cada `git push` a la rama principal genera un despliegue nuevo.

## Comprobaciones despues del despliegue

- La pagina carga y permite iniciar sesion con las credenciales de demostracion.
- En DevTools > Application, el service worker aparece como `activated`.
- Con el modo avion activado, la aplicacion sigue abriendo y registrando datos.
- El manifiesto se lee y el navegador ofrece "Instalar aplicacion".

## El servidor en un plan gratuito: lo que hay que saber

El servicio de consolidacion publicado en Render usa el plan gratuito, y ese
plan tiene dos comportamientos que conviene tener presentes:

1. **Se duerme.** Tras unos quince minutos sin peticiones el servicio se
   suspende. La primera sincronizacion despues de ese reposo puede tardar cerca
   de un minuto en responder; la aplicacion avisa de la demora y no se cuelga.
2. **No conserva los archivos entre reinicios.** El disco es efimero: cada
   despliegue nuevo y cada arranque despues del reposo levantan el contenedor
   otra vez, y la base SQLite vuelve a crearse vacia.

El segundo punto no hace perder informacion, porque cada dispositivo guarda su
copia completa en IndexedDB, pero si se dejaba sin tratar el servidor quedaba en
cero para siempre: los equipos ya habian marcado sus registros como entregados y
ninguno los volvia a mandar. Por eso el servicio entrega ahora un identificador
de base de datos (`serverId`) que nace con la base y no cambia mientras esa base
exista. El aplicativo lo guarda y lo compara en cada sincronizacion: si llega
uno distinto, entiende que el servidor perdio su copia, vuelve a marcar todo
como pendiente y lo repone. El aviso en pantalla lo dice con esas palabras
("El servidor se habia reiniciado y quedo sin datos: se repusieron N registros
desde este dispositivo"). El administrador tambien puede forzar la reposicion
desde Configuracion > Gestion de datos > "Reenviar todos los registros al
servidor".

Para un piloto con datos que deban permanecer en el servidor entre reinicios hay
que contratar un plan con disco persistente; el bloque correspondiente esta
comentado en `render.yaml`.

## Advertencia

Prototipo academico. Las credenciales se validan en el navegador y no protegen
informacion real. Antes de usarlo con datos de personas hace falta el trabajo
descrito en SECURITY_AND_LIMITATIONS.md.

## Comandos exactos para subir el repositorio

El repositorio ya esta inicializado y con dos commits hechos. Desde una terminal
(Git Bash, PowerShell o CMD), dentro de la carpeta del proyecto:

```
cd "D:\1. ROY TESIS Y PROYECTOS\TRABAJOS\UNSAAC\Ing. Sistemas\407 - tesis software\Software\NutriRural PWA"

git config user.name "Tu Nombre"
git config user.email "tu-correo@ejemplo.com"

git remote add origin https://github.com/USUARIO/nutrirural-pwa.git
git branch -M main
git push -u origin main
```

Antes del push hay que crear el repositorio en github.com **vacio**: sin README,
sin .gitignore y sin licencia, para que el primer push no entre en conflicto.

Las dos primeras lineas de configuracion son opcionales: el repositorio quedo con
una identidad provisional y conviene reemplazarla por la real antes de publicar.

## Conectar Netlify

1. En Netlify: **Add new site > Import an existing project > GitHub**.
2. Autorizar el acceso y elegir el repositorio recien creado.
3. Netlify lee `netlify.toml`, asi que los campos quedan asi solos:
   - Build command: vacio
   - Publish directory: `app`
4. **Deploy site**. Desde ahi, cada `git push` a `main` genera un despliegue nuevo.

El sitio queda con `X-Robots-Tag: noindex` y un `robots.txt` que impide la
indexacion, porque se trata de un prototipo academico y no de un servicio real.
