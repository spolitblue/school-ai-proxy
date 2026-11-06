@echo off
rem ============================================================
rem  DSH school-ai-proxy launcher (idempotent)
rem  Starts the local reverse proxy that serves the campus
rem  DeepSeek-R1 route used by DeepSeek Harness.
rem  Safe to run repeatedly: exits immediately if 8799 is taken.
rem ============================================================
setlocal
set "DIR=%~dp0"
cd /d "%DIR%"

rem --- already listening? do nothing ---
netstat -ano | findstr ":8799 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 exit /b 0

rem --- locate node ---
set "NODE_EXE=node"
where node >nul 2>&1
if errorlevel 1 set "NODE_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe"
if not exist "%NODE_EXE%" if /i not "%NODE_EXE%"=="node" exit /b 1

rem --- DEBUG=1 makes the proxy log every request, handy for diagnosis ---
set "DEBUG=1"
echo. >> "%DIR%proxy.log"
echo [%DATE% %TIME%] launcher: starting proxy >> "%DIR%proxy.log"
"%NODE_EXE%" "%DIR%proxy.mjs" >> "%DIR%proxy.log" 2>&1
exit /b %errorlevel%
