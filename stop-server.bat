@echo off
chcp 65001 >nul

rem ============================================================
rem  mdTOdocx —— 停止本地服务
rem  仅终止监听 3030（pandoc server）与 8080（静态服务）的进程
rem ============================================================

echo ============================================
echo  Markdown 转 Word 工具 - 停止本地服务
echo ============================================
echo.

echo 正在停止 Pandoc 服务（端口 3030）...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3030" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>nul
    echo   已终止进程 %%p
)

echo 正在停止静态服务（端口 8080）...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>nul
    echo   已终止进程 %%p
)

echo.
echo 处理完成。如果服务窗口仍然存在，可手动关闭名为 pandoc-server / md2docx-web 的窗口。
echo.
pause
