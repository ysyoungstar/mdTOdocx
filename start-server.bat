@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  mdTOdocx —— 一键启动本地服务
rem  1) pandoc server：负责 Markdown → DOCX 的实际转换
rem  2) python http.server：托管本目录页面（避免 file:// 限制）
rem ============================================================

set "APP_DIR=%~dp0"
set "PANDOC_PORT=3030"
set "WEB_PORT=8080"
set "PANDOC_TIMEOUT=60"

echo ============================================
echo  Markdown 转 Word 工具 - 启动本地服务
echo ============================================
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

rem ---------- 2. 启动 pandoc server ----------
echo [1/3] 启动 Pandoc 转换服务，端口 %PANDOC_PORT%，超时 %PANDOC_TIMEOUT% 秒 ...
start "pandoc-server" /min cmd /c "pandoc server -p %PANDOC_PORT% -t %PANDOC_TIMEOUT%"

rem ---------- 3. 检查 python 并启动静态服务 ----------
set "PYTHON_CMD="
where python >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=python"
if not defined PYTHON_CMD (
    where py >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=py"
)

if defined PYTHON_CMD (
    echo [2/3] 启动页面静态服务，端口 %WEB_PORT% ...
    start "md2docx-web" /min cmd /c "%PYTHON_CMD% -m http.server %WEB_PORT% --directory "%APP_DIR%""
) else (
    echo [2/3] 未找到 Python，将直接用文件方式打开页面。
)

rem ---------- 4. 等待服务就绪并打开浏览器 ----------
timeout /t 2 /nobreak >nul
echo [3/3] 打开浏览器 ...

if defined PYTHON_CMD (
    start "" "http://127.0.0.1:%WEB_PORT%/"
) else (
    start "" "%APP_DIR%index.html"
)

echo.
echo --------------------------------------------
echo  服务已启动：
echo    Pandoc 服务端口：%PANDOC_PORT%（http://127.0.0.1:%PANDOC_PORT%）
if defined PYTHON_CMD echo    页面访问地址：http://127.0.0.1:%WEB_PORT%/
if not defined PYTHON_CMD echo    页面地址：%APP_DIR%index.html
echo.
echo  提示：关闭本窗口不会停止服务；
echo        如需停止，请运行 stop-server.bat。
echo --------------------------------------------
echo.
pause
endlocal
