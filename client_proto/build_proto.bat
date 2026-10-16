@echo off
setlocal
pushd "%~dp0"
set "PATH=%PATH%;..\node_modules\.bin"
if not exist "..\assets\resources\config" mkdir "..\assets\resources\config"
cmd /c pbjs --target static --wrap closure --force-long --force-message --no-verify --no-convert --no-delimited --no-service --out protoCompiled.js protoCompiled.proto protoNet.proto
if errorlevel 1 goto :failed
cmd /c pbjs --target json --wrap closure --force-long --force-message --out ..\assets\resources\config\protoCompiled.json protoCompiled.proto protoNet.proto
if errorlevel 1 goto :failed
python strip_edition.py
if errorlevel 1 goto :failed
python protoCompiled_fix.py
if errorlevel 1 goto :failed


python proto_remove_namespace.py protoCompiled.proto protoCompiled_no_namespace.proto "package padding;"
python proto_remove_namespace.py protoNet.proto protoNet_no_namespace.proto "package padding;"

cmd /c pbjs --target static --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out cmd.d.js protoCompiled_no_namespace.proto protoNet_no_namespace.proto
REM cmd /c npx pbjs --target static-module --wrap es6 --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out cmd.d.js protoCompiled_no_namespace.proto protoNet_no_namespace.proto
REM cmd /c npx pbts --main --no-comments --out Cmd1.d.ts cmd.d.js
cmd /c pbts --main --no-comments --out Cmd.d.ts cmd.d.js
if errorlevel 1 goto :failed

echo create protoCache.json
python proto_remove_namespace.py protoCompiled.proto protoCompiled_no_namespace_empty.proto
cmd /c pbjs --target json --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out protoCompiled_no_namespace.json protoCompiled_no_namespace_empty.proto
python protoCache_build.py
if errorlevel 1 goto :failed
rem cmd /c npx pbjs --target static --wrap closure --force-long --force-message --out protoCompiled.js protoCompiled.proto protoNet.proto


REM cmd /c npx pbjs --target static-module --wrap es6 --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out test.js protoCompiled_no_namespace.proto protoNet_no_namespace.proto
rem cmd /c npx pbjs --target static-module --wrap es6 --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --out cmd.d.js protoCompiled_no_namespace.proto protoNet_no_namespace.proto
REM cmd /c npx pbjs --target static-module --wrap es6 --force-long --force-message --no-verify --no-convert --no-delimited --no-beautify --no-service --out cmd.d.js protoCompiled_no_namespace.proto protoNet_no_namespace.proto
REM cmd /c npx pbts --main --no-comments --out test.ts cmd.d.js
REM cmd /c npx pbts --main --no-comments --out cmd.d.ts cmd.d.js

echo remove commentds and remove namespace
python replace_line.py Cmd.d.ts "export\s" "declare " "padding\." ""
python proto_fix_all.py
if errorlevel 1 goto :failed
move /y Cmd.d.ts ..\assets\script\app\generated\netProto\
move /y CmdInterface.ts ..\assets\script\app\generated\netProto\
erase /F protoCompiled_no_namespace.proto 2>nul
erase /F protoCompiled_no_namespace.json 2>nul
erase /F protoCompiled_no_namespace_empty.proto 2>nul
erase /F protoCompiled_no_namespace_json.proto 2>nul
erase /F protoNet_no_namespace.proto 2>nul
erase /F cmd.d.js 2>nul
erase /F protoCompiled.js 2>nul

echo Protocol build completed.
popd
endlocal
exit /b 0

:failed
echo Protocol build failed with exit code %errorlevel%.
popd
endlocal
exit /b 1
