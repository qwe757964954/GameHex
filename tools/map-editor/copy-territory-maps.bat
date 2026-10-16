@echo off
setlocal
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
set "PYTHONDONTWRITEBYTECODE=1"
cd /d "%~dp0"

py -3 --version >nul 2>nul
if not errorlevel 1 (
    py -3 copy_territory_maps.py %*
) else (
    python copy_territory_maps.py %*
)

if errorlevel 1 (
    echo.
    echo Territory map copy failed. Python 3 and valid territory presets are required.
) else (
    echo.
    echo Territory map copy complete.
)
pause
