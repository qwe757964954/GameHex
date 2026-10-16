pushd %~dp0
rem protoCache_back.json
rem protoCompiled_back.proto

rem npx pbjs --target static-module --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out protoCache.proto protoCache_back.json
rem cmd /c npx pbjs --target proto3 --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out protoCache.proto protoCache_back.json
cmd /c npx pbjs --target proto2 --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out protoCompiled.proto protoCompiled_back.json
cmd /c npx pbjs --target static --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out protoCompiled.js protoCache_back.json
cmd /c npx pbts --main --no-comments --out Cmd.d.ts protoCompiled.js

