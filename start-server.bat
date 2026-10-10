@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  mdTOdocx - 一键启动本地服务（统一使用 IPv4 回环地址）
rem  1) pandoc server      : Markdown 转 DOCX 的转换服务
rem  2) python http.server  : 托管本目录页面
rem ============================================================

rem ---------- 基本配置 ----------
set "APP_DIR=%~dp0"
rem 去掉结尾反斜杠，避免与命令行引号拼接成反斜杠加引号而破坏参数解析
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
set "BIND_IP=127.0.0.1"
set "PANDOC_PORT=3030"
set "WEB_PORT=8080"
set "PANDOC_TIMEOUT=60"
set "PAGE_URL=http://%BIND_IP%:%WEB_PORT%/"

echo ============================================
echo  Markdown 转 Word 工具 - 启动本地服务
echo ============================================
echo  项目目录：%APP_DIR%
echo.

rem ---------- 1. 检查 pandoc ----------
where pandoc >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 pandoc 命令。
    echo        请先安装 Pandoc：https://pandoc.org/installing.html
    echo.
    pause
    exit /b 1
)

rem ---------- 2. 查找 python ----------
set "PYTHON_CMD="
where python >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=python"
if not defined PYTHON_CMD (
    where py >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=py"
)

rem ---------- 3. 端口占用提示 ----------
set "BUSY="
netstat -ano | findstr /r /c:"TCP.*:%PANDOC_PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 set "BUSY=Pandoc端口%PANDOC_PORT%"
netstat -ano | findstr /r /c:"TCP.*:%WEB_PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 set "BUSY=%BUSY% 页面端口%WEB_PORT%"
if defined BUSY (
    echo [提示] 以下端口已被占用：%BUSY%
    echo        若服务其实已在运行，可直接访问 %PAGE_URL%
    echo        若需要重新启动，请先运行 stop-server.bat。
    echo.
)

rem ---------- 4. 启动 pandoc server ----------
echo [1/3] 启动 Pandoc 转换服务（端口 %PANDOC_PORT%，超时 %PANDOC_TIMEOUT% 秒）...
start "pandoc-server" /min /d "%APP_DIR%" cmd /c "pandoc server -p %PANDOC_PORT% -t %PANDOC_TIMEOUT%"

rem ---------- 5. 启动静态页面服务 ----------
if defined PYTHON_CMD (
    echo [2/3] 启动页面静态服务（%BIND_IP%:%WEB_PORT%，仅监听 IPv4）...
    start "md2docx-web" /min /d "%APP_DIR%" cmd /c "%PYTHON_CMD% -m http.server %WEB_PORT% --bind %BIND_IP%"
) else (
    echo [2/3] 未找到 Python，改为直接打开本地文件。
)

rem ---------- 6. 等待就绪并打开浏览器 ----------
echo [3/3] 等待服务就绪并打开浏览器 ...
set "READY="
if defined PYTHON_CMD (
    for /l %%i in (1,1,15) do (
        if not defined READY (
            netstat -ano | findstr /r /c:"TCP.*:%WEB_PORT% .*LISTENING" >nul 2>nul
            if errorlevel 1 ( timeout /t 1 /nobreak >nul ) else ( set "READY=1" )
        )
    )
)

if defined PYTHON_CMD (
    if defined READY (
        start "" "%PAGE_URL%"
    ) else (
        echo     [警告] 静态服务未在 15 秒内就绪，请查看 md2docx-web 窗口中的错误信息。
    )
) else (
    start "" "%APP_DIR%\index.html"
)

echo.
echo --------------------------------------------
echo  请在浏览器打开页面地址：%PAGE_URL%
echo.
echo  说明：
echo    * pandoc 服务地址 http://%BIND_IP%:%PANDOC_PORT% 仅供页面内部调用，
echo      直接用浏览器访问会返回 404，这是正常现象，不是启动失败。
echo    * 所有服务只监听 IPv4 回环地址 %BIND_IP%，避免 localhost 被解析为 IPv6 的 ::1
echo      导致浏览器提示连接被拒绝。
echo    * 关闭本窗口不会停止服务；如需停止请运行 stop-server.bat。
echo --------------------------------------------
echo.
pause
endlocal