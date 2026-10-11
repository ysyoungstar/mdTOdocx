@echo off
setlocal

rem ============================================================
rem  mdTOdocx - check / install Python 3 automatically
rem  Runs setup-python.ps1 with PowerShell (no admin rights needed).
rem
rem  Usage (every argument is forwarded to the PowerShell script):
rem    setup-python.bat                          check, install when needed
rem    setup-python.bat -DryRun                  only report, change nothing
rem    setup-python.bat -MinVersion 3.8          require a newer minimum version
rem    setup-python.bat -RequiredVersion 3.13.7  pin an exact version
rem    setup-python.bat -Method official         skip winget, use the python.org installer
rem    setup-python.bat -Method mirror           prefer the regional mirror
rem    setup-python.bat -Scope AllUsers          install for all users (asks for UAC)
rem    setup-python.bat -IncludeDebug            also tick "Download debug binaries"
rem    setup-python.bat -Quiet                   fully silent installer window
rem    setup-python.bat -Force                   reinstall even when Python is usable
rem
rem  Set M2D_NO_PAUSE=1 (env var) to skip the final pause - used by
rem  start-server.bat so the automatic check stays non-interactive.
rem ============================================================

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
set "PS1=%APP_DIR%\setup-python.ps1"

if "%M2D_QUIET%"=="1" goto runquiet

echo ============================================
echo  Markdown to Word - Python setup
echo ============================================
echo.

:runquiet
if not exist "%PS1%" (
  echo [ERROR] setup-python.ps1 was not found next to this file:
  echo         %PS1%
  goto fail_pause
)

where powershell >nul 2>nul
if errorlevel 1 goto nops

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" goto ok

echo.
echo --------------------------------------------
echo  Python is NOT ready (exit code %RC%).
echo  Manual install commands:
echo    winget install -e --id Python.Python.3.13
echo  Official downloads: https://www.python.org/downloads/windows/
echo --------------------------------------------
goto fail_pause

:ok
echo.
echo --------------------------------------------
echo  Python is ready. Next step: start-server.bat
echo --------------------------------------------
goto done

:nops
echo.
echo [ERROR] powershell.exe was not found - cannot run the setup script.
echo         Install Python manually: https://www.python.org/downloads/windows/

goto fail_pause

:fail_pause
if not "%M2D_NO_PAUSE%"=="1" pause
endlocal
exit /b 1

:done
if not "%M2D_NO_PAUSE%"=="1" pause
endlocal
exit /b 0

rem REVISION=1
