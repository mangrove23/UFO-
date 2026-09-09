@echo off
rem 로컬 서버 실행 후 브라우저 열기 (Node/Python 불필요)
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 /nobreak >nul
start "" http://localhost:8123/
