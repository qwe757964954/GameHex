pushd %~dp0
rem protoCache_back.json
rem protoCompiled_back.proto

rem npx pbjs --target static-module --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out protoCache.proto protoCache_back.json
rem cmd /c npx pbjs --target proto3 --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --no-service --out protoCache.proto protoCache_back.json
rem cmd /c npx pbjs --target proto2 --wrap closure --force-long --force-message --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --out protoCompiled.proto protoCompiled_back.json
cmd /c npx pbjs --target proto2 --wrap closure --force-long --force-message --no-typeurl --no-convert --no-verify --no-delimited --no-beautify --out protoCache.proto protoCache_back.json

