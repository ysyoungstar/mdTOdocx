@echo off
setlocal

rem ============================================================
rem  mdTOdocx - stop local services (ports 3030 and 8080)
rem ============================================================

echo ============================================
echo  Markdown to Word - stopping local services
echo ============================================
echo.
echo Stopping processes listening on 3030 and 8080 ...
powershell -NoProfile -Command "foreach($p in 3030,8080){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }; Write-Output 'done'"
echo.
echo Done. If a service window is still open, close it manually:
 echo (pandoc-server / md2docx-web).
echo.
pause
endlocal
goto :eof
rem REVISION=3