# Proto 编译指南

## 前置条件

- **Node.js** 已安装
- **Python** 已安装（`C:\Python314\python.exe`）
- 已执行 `npm install`（在 `client/` 根目录）

## 快速编译

在终端中执行以下命令：

```bat
cd /d g:\Warcraft1001\client\client_proto
set PATH=%PATH%;..\node_modules\.bin
build_proto.bat
```

## 编译工具

| 工具 | 说明 |
|------|------|
| `pbjs` | protobufjs-cli 提供的编译工具，proto → JS/JSON |
| `pbts` | protobufjs-cli 提供的类型生成工具，JS → .d.ts |
| `protoCompiled_fix.py` | 修复 JS 输出，添加 `$protobuf` 全局变量包装 |
| `proto_remove_namespace.py` | 移除 proto 中的 `package com.*` 命名空间 |
| `proto_fix_all.py` | 后处理 .d.ts：添加 declare、移除 class body、提取 enum |
| `replace_line.py` | 正则替换文本 |
| `protoCache_build.py` | 从 JSON 反射生成 protoCache.json |

## 输入文件

| 文件 | 说明 |
|------|------|
| `protoCompiled.proto` (103KB) | 主协议文件，定义所有游戏 message |
| `protoNet.proto` | 网络层协议（ClientCmdData、ServerCmdData 等） |
| `protoCache_list.txt` | 缓存目标 message 列表（76个条目） |
| `protoCache_back.json` | 缓存字段的原始 JSON 备份 |

## 输出文件（运行时使用）

| 输出文件 | 目标路径 | 用途 |
|----------|----------|------|
| `protoCompiled.js` | `../assets/script/lib/protobuf/subproto/protoCompiled.js` | 旧静态协议兼容产物；当前运行时优先使用下方 JSON 反射数据 |
| `protoCompiled.json` | `../assets/resources/config/protoCompiled.json` | 协议元数据 JSON，运行时反射用 |
| `protoCache.json` | `../assets/resources/config/protoCache.json` | 缓存字段映射（`tlKey`/`tmField` 结构） |
| `Cmd.d.ts` | `../assets/script/app/generated/netProto/Cmd.d.ts` | TypeScript 类型声明 |
| `CmdInterface.ts` | `../assets/script/app/generated/netProto/CmdInterface.ts` | Enum 导出定义 |
| `CacheMgrGen.ts` | `../assets/script/app/generated/netProto/CacheMgrGen.ts` | 缓存管理器生成代码 |

## 编译流程详解

### 第 1 步：编译 proto → JS（静态编解码）

```bat
pbjs --target static --wrap closure --force-long --force-message --out protoCompiled.js protoCompiled.proto protoNet.proto
```

- `--target static`：生成可直接使用的静态 JS 代码
- `--wrap closure`：用闭包包裹，避免全局变量污染
- `--force-long`：int64 字段强制使用 Long 类型
- `--force-message`：强制 message 类型

### 第 2 步：编译 proto → JSON（反射元数据）

```bat
pbjs --target json --wrap closure --force-long --force-message --out ..\assets\resources\config\protoCompiled.json protoCompiled.proto protoNet.proto
```

- 生成 JSON 格式的协议描述，供运行时反射使用（如动态解码未知消息）

### 第 3 步：修复 JS 文件

```bat
python protoCompiled_fix.py
```

- 在 `protoCompiled.js` 开头插入 `var $protobuf = window.protobuf`
- 在结尾插入 `window.protobufRoot = $root`
- 将修复后的文件输出到 `../assets/script/lib/protobuf/subproto/protoCompiled.js`

### 第 4 步：移除命名空间后生成类型定义

```bat
python proto_remove_namespace.py protoCompiled.proto protoCompiled_no_namespace.proto "package padding;"
python proto_remove_namespace.py protoNet.proto protoNet_no_namespace.proto "package padding;"

pbjs --target static --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-delimited --no-beautify --out cmd.d.js protoCompiled_no_namespace.proto protoNet_no_namespace.proto

pbts --main --no-comments --out Cmd.d.ts cmd.d.js
```

- 先移除 `package com.*` 命名空间（替换为 `package padding;`）
- 用 `--no-*` 精简生成的 JS（只保留类型信息，不要编解码逻辑）
- 再用 `pbts` 从精简 JS 生成 `.d.ts` 类型声明

### 第 5 步：生成 protoCache.json

```bat
python proto_remove_namespace.py protoCompiled.proto protoCompiled_no_namespace_empty.proto
pbjs --target json --wrap closure --force-long --force-message --no-verify --no-service --no-create --no-encode --no-decode --no-typeurl --no-convert --no-delimited --no-beautify --out protoCompiled_no_namespace.json protoCompiled_no_namespace_empty.proto
python protoCache_build.py
```

- 从 JSON 描述中提取指定 message 的字段映射
- 字段 `id=1` 且不在排除列表中的字段作为 `tlKey`（缓存键）
- 输出到 `../assets/resources/config/protoCache.json`

### 第 6 步：后处理 TypeScript 类型

```bat
python replace_line.py Cmd.d.ts "export\s" "declare " "padding\." ""
python proto_fix_all.py
```

- 将 `export` 替换为 `declare`
- 移除 `padding.` 命名空间前缀
- 提取 enum 到 `CmdInterface.ts`
- 生成 `MessageProtoName`、`EnumProtoName`、`ReqMsgProtoName` 等联合类型
- 生成 `protoCacheGen` 接口

### 第 7 步：移动产物并清理

```bat
move /y Cmd.d.ts ..\assets\script\app\generated\netProto\
move /y CmdInterface.ts ..\assets\script\app\generated\netProto\
erase /F protoCompiled_no_namespace.proto
erase /F protoCompiled_no_namespace.json
erase /F protoCompiled_no_namespace_empty.proto
erase /F protoNet_no_namespace.proto
erase /F cmd.d.js
erase /F protoCompiled.js
```

## 依赖管理

### 安装 protobufjs-cli

```bat
cd g:\Warcraft1001\client
npm install
```

- `protobufjs-cli` 已在 `package.json` 的 `devDependencies` 中声明（`^2.5.0`）
- 安装后 `pbjs` 和 `pbts` 可用在 `node_modules/.bin/` 中

### 如果 pbjs 不在 PATH 中

在运行 `build_proto.bat` 之前，先添加 `node_modules/.bin` 到 PATH：

```bat
set PATH=%PATH%;..\node_modules\.bin
```

或者使用全局安装：

```bat
npm install -g protobufjs-cli
```

## 辅助脚本

| 脚本 | 用途 |
|------|------|
| `build_proto.bat` | **主编译脚本**（完整流程） |
| `create_proto_all.bat` | 从 `protoCache_back.json` 反向生成 proto 文件 |
| `create_proto_test.bat` | 测试用：从 JSON 反向生成 proto 并编译 |
| `prettier.bat` | 格式化 protoCompiled.js |
| `protoCache.py` | 检查 `protoCache_back.json` 并生成 `protoCache_list.txt` |

## 注意事项

- `protoCompiled.proto` 使用 proto2 语法，带 `package com.xkhy.tafang.cmd;` 命名空间
- `protoNet.proto` 使用 proto2 语法，带 `package com.cca.core.network.cmd;` 命名空间
- 生成类型文件时需要先移除包名，否则生成的 `.d.ts` 会有多余的 namespace 嵌套
- 编译过程会生成约 10MB 的 JS 文件，属于正常现象
