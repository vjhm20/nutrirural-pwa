@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title NutriRural - Servidor local

echo ============================================================
echo  NutriRural - Instalacion e inicio para Windows
echo ============================================================
echo.

set "PYEXE="
set "PYARGS="

rem 0) Ruta manual opcional: set NUTRIRURAL_PYTHON=C:\ruta\python.exe
if defined NUTRIRURAL_PYTHON (
  if exist "%NUTRIRURAL_PYTHON%" (
    "%NUTRIRURAL_PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYEXE=%NUTRIRURAL_PYTHON%"
  )
)

rem 1) Python Launcher oficial
if not defined PYEXE (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
    if not errorlevel 1 (
      set "PYEXE=py"
      set "PYARGS=-3"
    )
  )
)

rem 2) Comando python3
if not defined PYEXE (
  where python3 >nul 2>nul
  if not errorlevel 1 (
    python3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYEXE=python3"
  )
)

rem 3) Comando python, descartando Python 2.7 de ArcGIS
if not defined PYEXE (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYEXE=python"
  )
)

rem 4) Instalaciones oficiales habituales del usuario
if not defined PYEXE if exist "%LocalAppData%\Programs\Python" (
  for /f "delims=" %%P in ('dir /b /s "%LocalAppData%\Programs\Python\Python3*\python.exe" 2^>nul') do (
    if not defined PYEXE (
      "%%P" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
      if not errorlevel 1 set "PYEXE=%%P"
    )
  )
)

rem 5) Instalaciones para todos los usuarios
if not defined PYEXE if exist "%ProgramFiles%" (
  for /f "delims=" %%P in ('dir /b /s "%ProgramFiles%\Python3*\python.exe" 2^>nul') do (
    if not defined PYEXE (
      "%%P" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
      if not errorlevel 1 set "PYEXE=%%P"
    )
  )
)

if not defined PYEXE goto :NO_PYTHON

echo [1/4] Python 3 compatible encontrado:
if defined PYARGS (
  %PYEXE% %PYARGS% --version
) else (
  "%PYEXE%" --version
)
echo.

rem Eliminar un entorno virtual incompleto o creado con una version incompatible
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
  if errorlevel 1 (
    echo Se encontro un entorno virtual incompatible. Se volvera a crear.
    rmdir /s /q ".venv"
  )
) else if exist ".venv" (
  echo Se encontro un entorno virtual incompleto. Se volvera a crear.
  rmdir /s /q ".venv"
)

if not exist ".venv\Scripts\python.exe" (
  echo [2/4] Creando entorno virtual...
  if defined PYARGS (
    %PYEXE% %PYARGS% -m venv ".venv"
  ) else (
    "%PYEXE%" -m venv ".venv"
  )
  if errorlevel 1 goto :VENV_ERROR
) else (
  echo [2/4] Entorno virtual existente: OK
)

echo [3/4] Instalando o verificando dependencias...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :PIP_ERROR

echo [4/4] Iniciando NutriRural...
echo.
echo Abra en su navegador: http://127.0.0.1:8000
echo Para detener el servidor, presione Ctrl+C.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000"
".venv\Scripts\python.exe" server.py

echo.
echo El servidor se ha detenido.
pause
exit /b 0

:NO_PYTHON
echo.
echo ERROR: No se encontro Python 3.10 o superior.
echo.
echo Su equipo esta intentando usar Python 2.7 de ArcGIS:
echo   C:\Python27\ArcGIS10.8\python.exe
echo Esa version debe conservarse para ArcGIS, pero no sirve para NutriRural.
echo.
echo SOLUCION:
echo 1. Instale Python 3.11 o Python 3.12 de 64 bits desde python.org.
echo 2. Durante la instalacion marque "Add python.exe to PATH".
echo 3. Marque tambien la instalacion del "Python Launcher (py)".
echo 4. Cierre esta ventana y ejecute nuevamente start_windows.bat.
echo.
echo No desinstale el Python 2.7 de ArcGIS.
echo.
pause
exit /b 1

:VENV_ERROR
echo.
echo ERROR: No se pudo crear el entorno virtual .venv.
echo Compruebe que la version encontrada sea Python 3.10 o superior.
echo Si existe una carpeta .venv, eliminela y vuelva a ejecutar este archivo.
echo.
pause
exit /b 2

:PIP_ERROR
echo.
echo ERROR: No se pudieron instalar las dependencias.
echo Verifique su conexion a Internet y vuelva a ejecutar este archivo.
echo.
pause
exit /b 3
