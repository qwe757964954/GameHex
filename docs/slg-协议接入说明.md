# SLG 协议接入

协议真源为 `client_proto/protoCompiled.proto`，运行时使用 `tools/proto/gen_static_module.mjs` 生成的随包静态模块。不要手改生成模块、类型或 JSON。

## 调用链

`BigMapEntry` 按当前角色和区服创建页级 `BigMapSlgRepository`，通过 `GameNetBigMapSlgGateway` 和已有 `GameNet` 发送请求。Presenter 只消费归一化状态，页面通过异步动作入口调用。关闭页面解除广播订阅；迟到回包、旧账号和旧页面排队请求均被拦截。

| 功能 | 请求 | Presenter 入口 |
| --- | --- | --- |
| 玩法信息 | `CmdSlgGameInfoReqMsg` | `initializeSlg` |
| 行动力恢复 | `CmdSlgActionUpdateReqMsg` | 初始化、广播、恢复到期后只读刷新 |
| 建筑全量 | `CmdSlgBuildInfoReqMsg` | 初始化、广播、完成到期、写操作未确认后只读刷新 |
| 建造 | `CmdSlgBuildReqMsg` | `requestBuild` |
| 升级 | `CmdSlgBuildUpgradeReqMsg` | `requestUpgrade` |
| 取消 | `CmdSlgBuildCancelReqMsg` | `requestCancelQueue` |
| 移动 | `CmdSlgBuildMoveReqMsg` | `requestMove`（业务入口；本次不新增拖动交互） |
| 收取 | `CmdSlgBuildCollectReqMsg`（`buildInstIds` 批量） | `requestHarvest`、`requestHarvestAll`（一次结算） |
| 队列解锁 | `CmdSlgBuildUnlockQueueReqMsg` | `requestUnlockBuildQueue` |

已有 `CmdSlgCampSimpleInfoReqMsg`、`CmdSlgCampInfoReqMsg` 继续由据点 Repository 处理，可见区域和点击详情的查询入口不变。

## 状态与生命周期约定

- `buildInstId` 已统一为正数 `uint32`（1～4294967295），收发、归一化和展示均使用数字，不转换为 `Long` 或字符串，也不再维护展示编号映射。越界值在编码前拒绝，联机状态不落盘。
- 建造区 `position=0` 有效；协议 `queueId` 按 1 起编号，转换成视图 0 起的槽位下标。
- `state=1` 展示在建格，`state=2` 保留当前建筑等级并展示升级队列，`finishTime` 是秒级时间戳。倒计时到期只重拉，不在客户端宣布完成。
- `nextRevertTime` 是剩余秒数，只计算恢复倒计时，不推算行动力总量。
- `CmdSlgGameInfoBroMsg`、`CmdSlgBuildInfoBroMsg` 目前无字段，作为失效通知重拉；写操作期间收到广播，会延后全量刷新。
- 同页写操作串行且不乐观更新。SLG 写请求关闭网络超时重发和重连恢复；未确认的写操作不重发，只重拉建筑事实。通用请求默认保留已有重试行为。
- 联机模式不读取、写入或结算离线基地存档；未登录预览继续使用已有本地规则。

## 当前协议限制

`GameInfo` 响应尚无数据，建筑协议也没有资源余额、行动力总量和待收取库存字段，界面用未知值展示；不套用本地初始余额。领取奖励使用响应 `tlCmdGoods`，不按配表或时间推算。野怪结算数据类型 `CmdSlgMonsterBattleResultInfo` 已同步到静态编解码模块，本次不扩展未定义的 SLG 开战参数或战斗页面流程。

`r804` 起建造与升级拆分为两条独立协议：`CmdSlgBuildReqMsg` 只剩 `buildingId`/`position`/`instant`，升级改走 `CmdSlgBuildUpgradeReqMsg`（`buildInstId`/`instant`），响应 `CmdSlgBuildUpgradeRspMsg` 消息号 `1255226437`。旧的 `type=1/2` 合并口径已废弃。

`r807` 起领取产出改为批量：请求 `CmdSlgBuildCollectReqMsg.buildInstIds`（`repeated uint32`），响应新增 `builds`（`repeated SlgBuildInfo`，服务端回写领取后的建筑事实）后再跟 `tlCmdGoods`。`requestHarvest` 传单元素数组，`requestHarvestAll` 一次带走全部资源建筑，不再逐栋串行。请求体因此允许 `number | readonly number[]`（`IBigMapSlgRequestBody`），实例列表在网关层逐个校验，空数组/越界/非数字直接拒绝。

⚠️ 同一次提交删掉了 `CmdSlgBuildInfoRspMsg` 的 message 定义，只保留 `MessageId` 里的 `1414628085` 和 `SlgBuildGameInfo` 结构体，导致建造全量请求没有可解码的响应类型（`bigmap-slg-protocol` 用例 9 红、`RequestBigMapSlgMsg.ts` 的 `CmdSlgBuildInfoRspMsg` 类型缺失）。需服务端补回该 message 后重新生成静态模块。

## 验证

新增测试：`bigmap-slg-protocol`、`bigmap-slg-repository`、`bigmap-slg-presenter`、`bigmap-slg-gateway`、`network-request-policy`。覆盖实际编解码、所有新增请求封装、状态映射、完整实例身份、空广播、超时只读恢复、旧全量响应防回滚、关页和切号、禁重试与默认网络重试兼容。
