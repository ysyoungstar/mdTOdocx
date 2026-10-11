@echo off
setlocal

rem ============================================================
rem  mdTOdocx - check / install Pandoc automatically
rem  Runs setup-pandoc.ps1 with PowerShell (no admin rights needed).
rem
rem  Usage (every argument is forwarded to the PowerShell script):
rem    setup-pandoc.bat                        check, install when needed
rem    setup-pandoc.bat -DryRun                only report, change nothing
rem    setup-pandoc.bat -MinVersion 3.1        require a newer minimum version
rem    setup-pandoc.bat -RequiredVersion 3.12.1  pin an exact version
rem    setup-pandoc.bat -Method zip            force the GitHub zip fallback
rem    setup-pandoc.bat -Force                 reinstall even when usable
rem
rem  Set M2D_NO_PAUSE=1 (env var) to skip the final pause - used by
rem  start-server.bat so the automatic check stays non-interactive.
rem ============================================================

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
set "PS1=%APP_DIR%\setup-pandoc.ps1"

if "%M2D_QUIET%"=="1" goto runquiet

echo ============================================
echo  Markdown to Word - Pandoc setup
echo ============================================
echo.

:runquiet
if not exist "%PS1%" (
  echo [ERROR] setup-pandoc.ps1 was not found next to this file:
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
echo  Pandoc is NOT ready (exit code %RC%).
echo  Manual install command:
echo    winget install -e --id JohnMacFarlane.Pandoc
echo  Official installer: https://pandoc.org/installing.html
echo --------------------------------------------
goto fail_pause

:ok
echo.
echo --------------------------------------------
echo  Pandoc is ready. Next step: start-server.bat
echo --------------------------------------------
goto done

:nops
echo.
echo [ERROR] powershell.exe was not found - cannot run the setup script.
echo         Install Pandoc manually: https://pandoc.org/installing.html

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