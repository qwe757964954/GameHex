@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
node server.mjs --open
if errorlevel 1 (
    echo.
    echo Node.js is required to run the map editor service.
    pause
)
