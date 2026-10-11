@echo off
setlocal

rem ============================================================
rem  mdTOdocx - start local services (IPv4 loopback only)
rem  1) pandoc server       : converts Markdown to DOCX
rem  2) serve-pages.py      : serves this folder as a web page (no-cache)
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

rem --- make the usual pandoc install folders visible for this session ---
rem (a zip or manual install may exist on disk without being on PATH yet)
if exist "%LOCALAPPDATA%\Pandoc\pandoc.exe" set "PATH=%PATH%;%LOCALAPPDATA%\Pandoc"
if exist "%ProgramFiles%\Pandoc\pandoc.exe" set "PATH=%PATH%;%ProgramFiles%\Pandoc"
set "PF86=%ProgramFiles(x86)%"
if defined PF86 if exist "%PF86%\Pandoc\pandoc.exe" set "PATH=%PATH%;%PF86%\Pandoc"
where pandoc >nul 2>nul
if not errorlevel 1 goto pandocready

rem --- still missing: run the automatic setup helper (setup-pandoc.bat) ---
echo [0/4] pandoc was not found - running setup-pandoc.bat ...
echo.
set "M2D_NO_PAUSE=1"
call "%APP_DIR%\setup-pandoc.bat" -MinVersion 3.0
set "M2D_NO_PAUSE="
rem a fresh install may land in one of the folders above
if exist "%LOCALAPPDATA%\Pandoc\pandoc.exe" set "PATH=%PATH%;%LOCALAPPDATA%\Pandoc"
if exist "%ProgramFiles%\Pandoc\pandoc.exe" set "PATH=%PATH%;%ProgramFiles%\Pandoc"
where pandoc >nul 2>nul
if errorlevel 1 goto nopandoc
echo [0/4] pandoc is available now - continuing.
echo.

:pandocready

rem --- locate a usable Python 3: py launcher -> PATH -> usual folders ---
set "PY_EXE="
call :findpy
if defined PY_EXE goto pyready

rem --- still missing: run the automatic setup helper (setup-python.bat) ---
echo [py] python was not found - running setup-python.bat ...
echo.
set "M2D_NO_PAUSE=1"
call "%APP_DIR%\setup-python.bat" -MinVersion 3.7
set "M2D_NO_PAUSE="
rem a fresh install is not on the PATH of this already running session,
rem :findpy looks into the official install folders as well
call :findpy

:pyready
if defined PY_EXE goto startweb
goto nopython

:startweb
echo [1/4] starting pandoc server on port %PANDOC_PORT% ...
start "pandoc-server" /min /d "%APP_DIR%" pandoc server -p %PANDOC_PORT% -t %PANDOC_TIMEOUT%
echo [2/4] starting page server on %BIND_IP%:%WEB_PORT% ...
start "md2docx-web" /min /d "%APP_DIR%" "%PY_EXE%" "%APP_DIR%\serve-pages.py" %WEB_PORT% %BIND_IP%
echo [3/4] starting markdown bridge on %BIND_IP%:%BRIDGE_PORT% ...
start "md2docx-bridge" /min /d "%APP_DIR%" "%PY_EXE%" "%APP_DIR%\convert-server.py" --port %BRIDGE_PORT% --timeout %BRIDGE_TIMEOUT%
echo [4/4] waiting for page server and bridge ...
powershell -NoProfile -Command "for($i=0;$i -lt 24;$i++){ $a=Get-NetTCPConnection -LocalPort %WEB_PORT% -State Listen -ErrorAction SilentlyContinue; $b=Get-NetTCPConnection -LocalPort %BRIDGE_PORT% -State Listen -ErrorAction SilentlyContinue; if($a -and $b){ exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 goto notready
start "" "%PAGE_URL%"
goto report

:nopython
echo [2/4] python is still not available - running without the local services.
echo       - the page server is skipped, index.html is opened directly
echo       - Word/HTML to Markdown needs the bridge: DISABLED without Python 3
echo       - try the helper again: setup-python.bat
echo         or install it manually: https://www.python.org/downloads/windows/
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
echo [ERROR] pandoc is still not available.
echo         Try the helper first: setup-pandoc.bat -Method zip
echo         Or install it manually: https://pandoc.org/installing.html
echo.
pause
endlocal
goto :eof

rem ------------------------------------------------------------
rem  helper: locate a real python.exe
rem  1) the py launcher knows every registered installation
rem  2) python on PATH (the Microsoft Store alias stub is skipped)
rem  3) the official install folders, because a fresh install does not
rem     appear on the PATH of this already running session
rem ------------------------------------------------------------
:findpy
for /f "delims=" %%i in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do set "PY_EXE=%%i"
if defined PY_EXE if exist "%PY_EXE%" goto :eof
set "PY_EXE="
for /f "delims=" %%i in ('where python 2^>nul') do call :acceptexe "%%i"
if defined PY_EXE goto :eof
for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*") do call :acceptexe "%%d\python.exe"
if defined PY_EXE goto :eof
for /d %%d in ("%ProgramFiles%\Python3*") do call :acceptexe "%%d\python.exe"
if defined PY_EXE goto :eof
if not "%ProgramFiles(x86)%"=="" for /d %%d in ("%ProgramFiles(x86)%\Python3*") do call :acceptexe "%%d\python.exe"
goto :eof

:acceptexe
if not exist "%~1" goto :eof
echo %~1| find /i "WindowsApps" >nul && goto :eof
set "PY_EXE=%~1"
goto :eof
rem REVISION=6