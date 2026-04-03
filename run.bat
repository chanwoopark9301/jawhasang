@echo off
cd /d "%~dp0"

echo [1/2] Starting server...
start "JawHaSang Server" python server.py

:WAIT_SERVER
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 goto WAIT_SERVER

start http://127.0.0.1:5000

echo [2/2] Starting ngrok...
%USERPROFILE%\AppData\Local\ngrok\ngrok.exe start jawhasang

pause
