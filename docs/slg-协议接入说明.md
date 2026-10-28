# SLG 协议接入

协议真源为 `client_proto/protoCompiled.proto`，运行时使用 `tools/proto/gen_static_module.mjs` 生成的随包静态模块。不要手改生成模块、类型或 JSON。

## 调用链

`BigMapEntry` 按当前角色和区服创建页级 `BigMapSlgRepository`，通过 `GameNetBigMapSlgGateway` 和已有 `GameNet` 发送请求。Presenter 只消费归一化状态，页面通过异步动作入口调用。关闭页面解除广播订阅；迟到回包、旧账号和旧页面排队请求均被拦截。

| 功能 | 请求 | Presenter 入口 |
| --- | --- | --- |
| 玩法信息 | `CmdSlgGameInfoReqMsg` | `initializeSlg`；`SlgGameInfo.toCampId`（所处城池）/ `maxMonsterLevel`（最高击杀野怪等级）落到 `BigMapSlgRepository.campId` / `maxClearedMonsterLevel` |
| 行动力恢复 | `CmdSlgActionUpdateReqMsg` | 初始化、广播、恢复到期后只读刷新 |
| 建筑全量 | `CmdSlgBuildInfoReqMsg` | 初始化、广播、完成到期、写操作未确认后只读刷新 |
| 建造 | `CmdSlgBuildReqMsg` | `requestBuild` |
| 升级 | `CmdSlgBuildUpgradeReqMsg` | `requestUpgrade` |
| 取消 | `CmdSlgBuildCancelReqMsg` | `requestCancelQueue` |
| 移动 | `CmdSlgBuildMoveReqMsg` | `requestMove`（基地详情次按钮「移动」→ 点空地；不走拖动） |
| 收取 | `CmdSlgBuildCollectReqMsg`（`buildInstIds` 批量） | `requestHarvest`、`requestHarvestAll`（一次结算） |
| 队列解锁 | `CmdSlgBuildUnlockQueueReqMsg` | `requestUnlockBuildQueue` |

已有 `CmdSlgCampSimpleInfoReqMsg`、`CmdSlgCampInfoReqMsg` 继续由据点 Repository 处理，可见区域和点击详情的查询入口不变。

## 配置与开战

- 配置统一经 `ConfigService` 加载。`bigMapCamp.campId` 是地图、据点查询及 1004 开战使用的城池配置 ID；`campBattleId` 保留为关联战斗配置，不传入 1004 请求。野怪开战参数使用 `bigmapMonster.monsterId`，`monsterBattle` 保留为关联战斗配置，不传入 1003 请求。
- 野怪开战：`CmdStartBattleReqMsg.startBattleInfo = { battleType: 1003, battleParams: [String(monsterId)] }`（用户确认参数口径，例如怪物 8013 关联战斗 30013，实际传 `['8013']`）。
- 据点开战：`CmdStartBattleReqMsg.startBattleInfo = { battleType: 1004, battleParams: [String(campId)] }`（2026-10-23 用户最新更正）。例如雾隐堡传 `['205']`，不传其关联战斗 `['50027']`。
- 页面调用 `requestAttackMonster` / `requestAttackCity`，Presenter 校验解锁或服务端据点状态；Entry 复用 `BattleStartService`，收到成功且类型、参数匹配的响应后通过 `GameRoute.Battle` 导航。未确认开战不进入本地模拟局，也不预扣资源或行动力。
- 已收到据点状态时，只对未占领且状态为开放/攻城中的、已配置战斗的地图据点启用攻击。详情查询失败且没有状态快照时，允许向开战协议请求资格确认，不伪造开放状态，不本地扣费；详情仍在加载时等待查询结束。配置表存在但当前地图没有放置的据点不会凭空生成。旧地图中的据点若在 `bigMapCamp` 无对应行则禁用攻击，不猜测映射。
- SLG 开战禁止自动重发与重连恢复；重复点击不叠请求，关页、换号、换服、超时后迟到回包失效。成功数据只随 entry params 交接，不进入 PVP 最近战斗缓存。
- 1003 / 1004 的 NPC 也占参战席位。`showInfo.name` 为空时，席位档案使用既有阵营名（如“敌方”），HUD 与排行榜共用此档案；不因名称或头像缺失删除第二方，也不伪造头像。
- 所有正式战斗共用服务端英雄阵容规则：各方卡牌采用各自 `heroInfos` 的英雄 ID、顺序与等级（沿用最多八张英雄卡的限制）；英雄卡池与相关资源查询使用同一份归一化阵容。明确的空数组、未下发的额外席位均不补本地英雄；只有无服务端回包的本地模式才用默认阵容。章节敌方名单不再提前裁剪正式回包的卡池；无英雄 ID 的系统卡继续使用客户端配置。
- SLG 选图人数取成功开战回包的参战单元数（2～4）；结算先建立对应类型等待器再上报结束，1003 解 `CmdSlgMonsterBattleResultInfo`，1004 解 `CmdSlgCampBattleResultInfo`，沿用奖励帧加载与结算页。据点展示实际下发的战功，未携带字段时保持未知。两类战斗结束均返回世界页，不回写领地冒险存档。

## 状态与生命周期约定

- 进入世界时，三条 SLG 初始化请求与页面资源并行准备，显示地图不等待 `GameInfo` / 建筑 / 行动力全部回包或超时。快照未就绪时仍由 Repository 拒绝基地写操作；回包经 Presenter 通知视图刷新，不使用本地资源或建筑代替服务端事实。战后重进同样遵守此约定。
- `buildInstId` 已统一为正数 `uint32`（1～4294967295），收发、归一化和展示均使用数字，不转换为 `Long` 或字符串，也不再维护展示编号映射。越界值在编码前拒绝，联机状态不落盘。
- 建造区 `position=0` 有效；协议 `queueId` 按 1 起编号，转换成视图 0 起的槽位下标。
- `state=1` 展示在建格，`state=2` 保留当前建筑等级并展示升级队列，`finishTime` 是秒级时间戳。倒计时到期只重拉，不在客户端宣布完成。
- `nextRevertTime` 是剩余秒数，只计算恢复倒计时，不推算行动力总量。
- r826 起，`CmdSlgGameInfoRspMsg`、`CmdSlgGameInfoBroMsg` 必填 `info`，其中 `SlgGameInfo.maxMonsterLevel` 表示最大击杀野怪等级；`CmdSlgBuildInfoBroMsg` 仍无字段。当前广播处理继续作为失效通知重拉；写操作期间收到广播，会延后全量刷新。
- 同页写操作串行且不乐观更新。SLG 写请求关闭网络超时重发和重连恢复；未确认的写操作不重发，只重拉建筑事实。通用请求默认保留已有重试行为。
- 联机模式不读取、写入或结算离线基地存档；未登录预览继续使用已有本地规则。

## 当前协议限制

`GameInfo` 响应已包含 `maxMonsterLevel`，已接入野怪击杀进度（详情首行「已通关最高 X 级」，`IBigMapMonsterView.clearedLevel`）。协议仍没有资源余额、行动力总量和待收取库存字段，界面用未知值展示；不套用本地初始余额。领取奖励使用响应 `tlCmdGoods`，不按配表或时间推算。野怪与据点奖励均以对应结算广播为准，不按掉落预览在本地发奖。r826 同时新增据点角色伤害排行榜类型 `SLG_CAMP_ROLE_HARM_RANK = 53`。

`r804` 起建造与升级拆分为两条独立协议：`CmdSlgBuildReqMsg` 只剩 `buildingId`/`position`/`instant`，升级改走 `CmdSlgBuildUpgradeReqMsg`（`buildInstId`/`instant`），响应 `CmdSlgBuildUpgradeRspMsg` 消息号 `1255226437`。旧的 `type=1/2` 合并口径已废弃。

`r807` 起领取产出改为批量：请求 `CmdSlgBuildCollectReqMsg.buildInstIds`（`repeated uint32`），响应新增 `builds`（`repeated SlgBuildInfo`，服务端回写领取后的建筑事实）后再跟 `tlCmdGoods`。`requestHarvest` 传单元素数组，`requestHarvestAll` 一次带走全部资源建筑，不再逐栋串行。请求体因此允许 `number | readonly number[]`（`IBigMapSlgRequestBody`），实例列表在网关层逐个校验，空数组/越界/非数字直接拒绝。

此前缺失的 `CmdSlgBuildInfoRspMsg` 已在当前协议源补回，并经生成脚本同步；`CmdSlgCampBattleResultInfo` 也已生成到 JSON、类型声明与随包静态编解码模块。

`r827` 起 `SlgGameInfo` 带 `toCampId`（所处城池）与 `maxMonsterLevel`（最高击杀野怪等级），两个字段都是 `required uint32`。口径：

- **势力范围只认 `toCampId`**。`BigMapSlgRepository.campId` 是「我在哪座城」的唯一真源，`bigMapWithinCityRange(city, distance, campId)` 在 `campId > 0` 时只判断「目标城是不是我这座城」，与距离无关；`campId === 0`（还没收到包 / 服务端明确未归属）才回退 `radiateCapacity` 距离，保证离线档与包未到达时不误判。
- **玩家基地位置也认 `toCampId`**。`BigMapPresenter.playerBaseHexId` = 该城的 `anchorHexId`（2026-10-23 用户确认「玩家基地就固定在 toCampId 那座城的锚点上」），距离显示、回城定位、基地标记、单格染色全部经它；布局档 `bases[].isPlayer.hexId` 只在未归属/城不在图上时兜底。基地与城占格重叠 ⇒ `bigMapOccupantOf(world, hexId, playerBaseHexId)` 在该格**先返回基地**（否则城占格优先，「点自己的基地回基地」永远走不到）；基地位置变化时 `BigMapWorldView` 会重建标记并作废 `contentKey`。
- **野怪逐级解锁吃 `maxMonsterLevel`**。联机存档是空的（`parseBigMapSave(null)`），本地 `clearedMonsterLevel` 恒 0 会把 `preLevel > 0` 的野怪全锁死；`Presenter.unlockContext` 现在取服务器值与本地值的较大者。
- 坏回包（缺字段、越界、非整数）整包作废且**不清空**已有值，避免一次超时把「所处城池」抹成 0；`game` 广播除刷新行动力外同时重拉 `GameInfo`。

## 验证

新增测试：`bigmap-slg-protocol`、`bigmap-slg-repository`、`bigmap-slg-presenter`、`bigmap-slg-gateway`、`bigmap-slg-game-info`、`network-request-policy`。覆盖实际编解码、所有新增请求封装、状态映射、完整实例身份、空广播、超时只读恢复、旧全量响应防回滚、关页和切号、禁重试与默认网络重试兼容。

战斗接入回归：`bigmap-battle-entry`、`bigmap-entry-cancellation`、`battle-start-concurrency`、`zcds-battle-result`；覆盖真实配置 ID、真实协议字节、开战与结束的调用顺序、重复点击/迟到回包、服务端胜负和战功、选图人数及返回世界页。
