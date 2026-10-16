@echo off
rem ===========================================================================
rem  City1001 Demo3.8 -- native hot update: one-click build + publish entry
rem
rem  Usage:
rem    tools\hotupdate\publish_hotupdate.bat                          double-click -> menu
rem    tools\hotupdate\publish_hotupdate.bat android                  build + publish
rem    tools\hotupdate\publish_hotupdate.bat android --skip-build     publish only
rem    tools\hotupdate\publish_hotupdate.bat android --apk            also compile the APK
rem    tools\hotupdate\publish_hotupdate.bat android --no-apk         skip the APK
rem    tools\hotupdate\publish_hotupdate.bat ios --channel test       .py options pass through
rem    tools\hotupdate\publish_hotupdate.bat --help                   all options
rem
rem  APK compilation needs JDK 17+ (AGP 8.10.1 / Gradle 8.11.1). Point
rem  --gradle-jdk at one, or set HOTUPDATE_GRADLE_JDK.
rem
rem  THIS FILE MUST STAY ASCII-ONLY. Do not add non-ASCII text to it.
rem  cmd parses .bat by bytes under the active codepage. With non-ASCII content a
rem  `goto` label seek lands in the middle of a multi-byte character, half a line
rem  gets executed as a command, and you get errors that have nothing to do with
rem  the real cause, e.g.
rem      'lish_hotupdate.bat' is not recognized as an internal or external command
rem  Reproduced with UTF-8 (BOM and no BOM) and with GBK, all with CRLF endings.
rem  All Chinese UI lives in tools\hotupdate\publish_hotupdate.py, where encoding is under
rem  our control: chcp 65001 plus PYTHONIOENCODING=utf-8 are set below.
rem  Guard: tests/test_publish_hotupdate.py  test_bat_entry_is_ascii_only
rem
rem  Own switches (not forwarded to python): --pause / --no-pause
rem  Double-click (no arguments) always pauses at the end.
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
set "PF86=%ProgramFiles(x86)%"
set "CODE=1"
rem capture %~dp0 NOW: `shift` also shifts %0, so %~dp0 becomes the first
rem argument's directory after the parse loop and the script path breaks.
set "PUBLISH_PY=%~dp0publish_hotupdate.py"

rem ---------------------------------------------------------------------------
rem  locate the project
rem ---------------------------------------------------------------------------
rem this .bat lives in tools\hotupdate\, so the project root is two levels up
set "PROJECT_ROOT=%~dp0..\.."
pushd "%PROJECT_ROOT%" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] cannot enter project root: %PROJECT_ROOT%
    goto :finish
)
if not exist "assets\script" (
    echo [ERROR] not a Cocos project: %CD%
    goto :finish
)

rem no arguments means the user double-clicked the file
set "INTERACTIVE=1"
if not "%~1"=="" set "INTERACTIVE=0"
set "FORCE_PAUSE="
set "PASSTHRU="

rem ---------------------------------------------------------------------------
rem  split own switches out, forward everything else
rem ---------------------------------------------------------------------------
:parse_args
if "%~1"=="" goto :args_done
set "ARG=%~1"
if /i "%ARG%"=="--pause" (
    set "FORCE_PAUSE=1"
    shift
    goto :parse_args
)
if /i "%ARG%"=="--no-pause" (
    set "FORCE_PAUSE=0"
    shift
    goto :parse_args
)
set "PASSTHRU=!PASSTHRU! %1"
shift
goto :parse_args

:args_done
set "MENU_ARGS="
if "%INTERACTIVE%"=="1" set "MENU_ARGS=--interactive"

rem ---------------------------------------------------------------------------
rem  locate python (PATH may differ when launched from Explorer)
rem ---------------------------------------------------------------------------
set "PYTHON="
if defined PYTHON_EXE if exist "%PYTHON_EXE%" set "PYTHON="%PYTHON_EXE%""
if not defined PYTHON (
    py -3 --version >nul 2>nul
    if not errorlevel 1 set "PYTHON=py -3"
)
if not defined PYTHON (
    python --version >nul 2>nul
    if not errorlevel 1 set "PYTHON=python"
)
if not defined PYTHON (
    python3 --version >nul 2>nul
    if not errorlevel 1 set "PYTHON=python3"
)
if not defined PYTHON (
    if exist "%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe" (
        set "PYTHON="%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe""
    )
)
if not defined PYTHON (
    echo [ERROR] Python 3 not found. Install Python, or set PYTHON_EXE to python.exe
    goto :finish
)

rem ---------------------------------------------------------------------------
rem  locate node (the manifest generator needs it)
rem ---------------------------------------------------------------------------
if not defined NODE_EXE (
    where node >nul 2>nul
    if not errorlevel 1 goto :node_ready
    if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
    if not defined NODE_EXE if exist "%PF86%\nodejs\node.exe" set "NODE_EXE=%PF86%\nodejs\node.exe"
    if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    if not defined NODE_EXE for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do if not defined NODE_EXE if exist "%%~D\node.exe" set "NODE_EXE=%%~D\node.exe"
)
:node_ready

echo [hot-update] python: %PYTHON%
if defined NODE_EXE echo [hot-update] node  : %NODE_EXE%
echo.

rem ---------------------------------------------------------------------------
rem  run the real work: build + inject + manifests + publish (python side)
rem ---------------------------------------------------------------------------
%PYTHON% "%PUBLISH_PY%" %MENU_ARGS% %PASSTHRU%
set "CODE=%ERRORLEVEL%"

if "%CODE%"=="0" goto :finish
echo.
echo ===========================================================================
echo  [ERROR] publish failed, exit code %CODE%
echo ===========================================================================
echo   - CLI build refused while Creator is open  -^> add --skip-build
echo   - HTTP check failed                        -^> start the static server, or add --no-http-check
echo   - release-id collision                     -^> pass another --release-id, or clean outputs\hotupdate-staging
echo   - no JDK 17+ found                         -^> add --gradle-jdk "C:\Program Files\Java\jdk-17"
echo   - gradle build failed                      -^> read the log printed above (outputs\hotupdate-logs)

:finish
popd >nul 2>nul
if "%INTERACTIVE%"=="1" pause
if "%FORCE_PAUSE%"=="1" pause
endlocal & exit /b %CODE%
