@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_USE_ENV_PROXY=1"
set "HTTP_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=http://127.0.0.1:7890"
node tools\refresh.mjs
echo.
pause
