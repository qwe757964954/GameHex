@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
node server.mjs --open --bigmap
if errorlevel 1 (
    echo.
    echo Node.js is required to run the bigmap layout editor service.
    pause
)
