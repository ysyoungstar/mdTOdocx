@echo off
chcp 65001 >nul

rem ============================================================
rem  mdTOdocx —— 停止本地服务
rem  仅终止监听 3030（pandoc server）与 8080（页面静态服务）的进程
rem  端口匹配带尾随空格，避免误杀 :30300 之类的端口
rem ============================================================

echo ============================================
echo  Markdown 转 Word 工具 - 停止本地服务
echo ============================================
echo.

call :killport 3030 "Pandoc 转换服务"
call :killport 8080 "页面静态服务"

echo.
echo 处理完成。若服务窗口仍然存在，可手动关闭名为 pandoc-server / md2docx-web 的窗口。
echo.
pause
exit /b 0

:killport
echo 正在停止 %~2（端口 %~1）...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP.*:%~1 .*LISTENING"') do (
    taskkill /PID %%p /F >nul 2>nul
    echo    已终止进程 %%p
)
exit /b 0