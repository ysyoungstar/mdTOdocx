@echo off
setlocal

rem ============================================================
rem  mdTOdocx - start local services (IPv4 loopback only)
rem  1) pandoc server       : converts Markdown to DOCX
rem  2) python http.server  : serves this folder as a web page
rem  3) convert-server.py   : HTML/DOCX to Markdown, exports images (bridge)
rem ============================================================

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
set "BIND_IP=127.0.0.1"
set "PANDOC_PORT=3030"
set "WEB_PORT=8080"
set "BRIDGE_PORT=3040"
set "PANDOC_TIMEOUT=60"
set "BRIDGE_TIMEOUT=180"
set "PAGE_URL=http://%BIND_IP%:%WEB_PORT%/"

echo ============================================
echo  Markdown to Word - starting local services
echo ============================================
echo  Project folder: %APP_DIR%
echo.

where pandoc >nul 2>nul
if errorlevel 1 goto nopandoc

set "PYTHON_CMD="
where python >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=python"
if defined PYTHON_CMD goto pyready
where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py"
:pyready
if defined PYTHON_CMD goto startweb
goto nopython

:startweb
echo [1/4] starting pandoc server on port %PANDOC_PORT% ...
start "pandoc-server" /min /d "%APP_DIR%" pandoc server -p %PANDOC_PORT% -t %PANDOC_TIMEOUT%
echo [2/4] starting page server on %BIND_IP%:%WEB_PORT% ...
start "md2docx-web" /min /d "%APP_DIR%" %PYTHON_CMD% -m http.server %WEB_PORT% --bind %BIND_IP%
echo [3/4] starting markdown bridge on %BIND_IP%:%BRIDGE_PORT% ...
start "md2docx-bridge" /min /d "%APP_DIR%" %PYTHON_CMD% convert-server.py --port %BRIDGE_PORT% --timeout %BRIDGE_TIMEOUT%
echo [4/4] waiting for page server and bridge ...
powershell -NoProfile -Command "for($i=0;$i -lt 24;$i++){ $a=Get-NetTCPConnection -LocalPort %WEB_PORT% -State Listen -ErrorAction SilentlyContinue; $b=Get-NetTCPConnection -LocalPort %BRIDGE_PORT% -State Listen -ErrorAction SilentlyContinue; if($a -and $b){ exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 goto notready
start "" "%PAGE_URL%"
goto report

:nopython
echo [2/4] python not found.
echo       - the page server is skipped, index.html is opened directly
echo       - Word/HTML to Markdown needs the bridge: DISABLED without Python 3
timeout /t 2 /nobreak >nul
start "" "%APP_DIR%\index.html"
goto report

:notready
echo [WARN] a service was not ready within 12s - check the service windows
echo        (pandoc-server / md2docx-web / md2docx-bridge).

:report
echo.
echo --------------------------------------------
echo  Open this page in your browser: %PAGE_URL%
echo.
echo  Notes:
echo    - port 3030 is the pandoc conversion service; it is used by the
 echo      web page only, so opening it in a browser returns 404 by design.
echo    - port %BRIDGE_PORT% is the local bridge (convert-server.py) used for
 echo      Word/HTML to Markdown, and for exporting document images.
echo    - all services listen on IPv4 loopback %BIND_IP%, so localhost
 echo      can never fall back to IPv6 ::1 and fail to connect.
echo    - closing this window does NOT stop the services.
 echo      run stop-server.bat to stop them.
echo --------------------------------------------
echo.
pause
endlocal
goto :eof

:nopandoc
echo [ERROR] pandoc was not found in PATH.
echo         Install it first: https://pandoc.org/installing.html
echo.
pause
endlocal
goto :eof
rem REVISION=3