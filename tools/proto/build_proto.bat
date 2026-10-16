@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM protobuf 协议编译流程（迁入 Demo3.8 项目版 · 反射路线）
REM 工作目录: tools/proto/
REM 输入: protoCompiled.proto / protoNet.proto / protoCache_list.txt
REM 输出:
REM   assets/resources/config/protoCompiled.json             (反射元数据, 运行时用)
REM   assets/resources/config/protoCache.json                (缓存字段映射)
REM   assets/script/app/generated/netProto/Cmd.d.ts          (TS 类型)
REM   assets/script/app/generated/netProto/CmdInterface.ts   (枚举导出)
REM
REM 说明: 运行时走反射路线(ProtocolCodec 用 protobufjs/light.js + protoCompiled.json)。
REM   静态 js 路线(window.protobufRoot)已废弃, 不再生成 protoCompiled.js。
REM ============================================================

pushd %~dp0

REM 项目根 = tools/proto 的上两级
set PROJECT_ROOT=%~dp0..\..
for %%i in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fi"

REM pbjs / pbts 工具路径
set PBJS=%PROJECT_ROOT%\node_modules\.bin\pbjs.cmd
set PBTS=%PROJECT_ROOT%\node_modules\.bin\pbts.cmd

REM Python
set PYTHON=C:\Users\hedao\.workbuddy\binaries\python\envs\default\Scripts\python.exe
if not exist "%PYTHON%" set PYTHON=python

set OUT_CONFIG=%PROJECT_ROOT%\assets\resources\config
set OUT_NETPROTO=%PROJECT_ROOT%\assets\script\app\generated\netProto
if not exist "%OUT_CONFIG%" mkdir "%OUT_CONFIG%"

echo ============================================================
echo [1/5] 编译 proto -^> JSON (protoCompiled.json)
echo ============================================================
call "%PBJS%" --target json --wrap closure --force-long --force-message --out "%OUT_CONFIG%\protoCompiled.json" protoCompiled.proto protoNet.proto

echo ============================================================
echo [2/5] 去除 JSON 里的 edition 字段
echo ============================================================
"%PYTHON%" strip_edition.py "%OUT_CONFIG%\protoCompiled.json"

echo ============================================================
echo [3/5] 移除命名空间, 生成精简 JS 用于类型
echo ============================================================
"%PYTHON%" proto_remove_namespace.py protoCompiled.proto protoCompiled_no_namespace.proto "package padding;"
"%PYTHON%" proto_remove_namespace.py protoNet.proto protoNet_no_namespace.proto "package padding;"
call "%PBJS%" --target static --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-delimited --no-beautify --out cmd.d.js protoCompiled_no_namespace.proto protoNet_no_namespace.proto
call "%PBTS%" --main --no-comments --out Cmd.d.ts cmd.d.js

echo ============================================================
echo [4/5] 生成 protoCache.json
echo ============================================================
"%PYTHON%" proto_remove_namespace.py protoCompiled.proto protoCompiled_no_namespace_empty.proto
call "%PBJS%" --target json --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-delimited --no-beautify --out protoCompiled_no_namespace.json protoCompiled_no_namespace_empty.proto
"%PYTHON%" protoCache_build.py

echo ============================================================
echo [5/5] 后处理 TS 类型 + 提取枚举 + 移动产物 + 清理
echo ============================================================
"%PYTHON%" replace_line.py Cmd.d.ts "export\s" "declare " "padding\." ""
"%PYTHON%" proto_fix_all.py

if not exist "%OUT_NETPROTO%" mkdir "%OUT_NETPROTO%"
move /y Cmd.d.ts "%OUT_NETPROTO%\" >nul
move /y CmdInterface.ts "%OUT_NETPROTO%\" >nul
erase /F protoCompiled_no_namespace.proto 2>nul
erase /F protoCompiled_no_namespace.json 2>nul
erase /F protoCompiled_no_namespace_empty.proto 2>nul
erase /F protoNet_no_namespace.proto 2>nul
erase /F cmd.d.js 2>nul

echo ============================================================
echo 全部完成
echo ============================================================
popd
endlocal
