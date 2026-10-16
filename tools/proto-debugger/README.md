# 协议调试台（浏览器）

在浏览器里直接连接游戏服、发送/解码 protobuf 协议的调试工具，与游戏内
`GameNet → ProtoCoder` 完全同一套协议（同一个 `protoCompiledStatic` 静态模块）。

## 快速开始

1. 双击打开 `tools/proto-debugger/index.html`（无需本地服务器，file:// 直接可用）。
2. 填服务器地址：`ws://<host>:<port>/server`（登录时中心服返回的 `serverAddress`，
   与 `NetSocketBase.setConnectInfo` 拼接口径一致），点「连接」。
3. 下拉选择协议（或直接粘贴 `CmdXxxReqMsg` 全名），在 JSON 框填参数，点「发送」。
4. 右侧日志区显示 TX/RX 解码结果；服务器 `result=false` 的错误包按 `CmdTips` 解码成红字。

## 控制台 API（F12）

```js
GameSocket.send("CmdSystemGmReqMsg", { "cmd": "addItem 10001 1" }); // 发送，返回 clientIndex
GameSocket.send("CmdSystemSyncTimeReqMsg", {});                      // 心跳/对时
GameSocket.send("CmdSystemGmRspMsg", {...});                         // 带 RspMsg 后缀也会自动换算成 ReqMsg
GameSocket.protocols                                                  // 全部 259 个可发送协议名
GameSocket.connected                                                  // 是否已连接
GameSocket.connect("ws://127.0.0.1:8080/server");
GameSocket.disconnect();
GameSocket.onResponse = (rspName, data, clientIndex) => console.log(rspName, data);
GameSocket.onTips = (tips) => console.log('服务器错误提示', tips);
```

## 与游戏内协议链路的关系（同口径对照）

| 环节 | 游戏内 | 调试台 |
| --- | --- | --- |
| 协议静态模块 | `assets/script/lib/protobuf/protoCompiledStatic.ts` | `proto-runtime.js`（esbuild 打包同一文件 + protobufjs/minimal） |
| 请求体编码 | `ProtoCoder.encode(name)` → `protoPackage[name].encode(...).finish()` | 同左 |
| 封包 | `ClientCmdData{ messageId, clientIndex, data, appendData:null }` | 同左（字段为 camelCase，`snake_case` 由 pbjs 自动转换） |
| 收包 | `ServerCmdData` → `messageIds + splits` 切 `data` → 逐条 `decodeDataById` | 同左；`compress=true` 时用 `DecompressionStream('deflate')` 解压（zlib RFC1950） |
| 协议名 → id | `MessageId` 枚举：键 `CmdXxxRspMsg` → `CmdXxxReqMsg` | 同左（枚举出 259 个可发送协议） |

注意：`protoCompiledStatic.ts` 用 `--force-long`，int64 字段解码后是 protobufjs Long，
调试台显示/序列化时自动转成字符串；发送时 int64 传字符串或数字均可。

## 重新生成（协议表更新后）

```bash
node tools/proto/gen_static_module.mjs            # 1. 重新生成 assets/script/lib/protobuf/protoCompiledStatic.ts
node tools/proto-debugger/gen_debug_runtime.mjs   # 2. 重新打包 tools/proto-debugger/proto-runtime.js
node tools/proto-debugger/selftest.mjs            # 3. 自测（编解码一致性，应全部通过）
```

## 说明与限制

- 加密：游戏内 `ProtoCoder.encrypted()` 仅在 `window["_crypto_net_"] == 1` 且挂载 CryptoJS
  时启用，调试台默认不加密（与正式客户端默认一致）。
- 缓存：`ServerCmdData.cmdCaches`（按字段缓存更新）调试台只提示、不处理，业务协议不受影响。
- 登录态：多数业务协议需要先发登录协议拿会话；调试台是裸连接，不自动带 token，
  按你的测试流程手动先发登录/握手协议即可。
- 心跳默认 5s 自动发送 `CmdSystemSyncTimeReqMsg`（与 `GameNet.HEARTBEAT_INTERVAL_MS` 一致），
  可取消勾选关闭。
