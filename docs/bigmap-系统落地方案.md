# 植物大地图系统 · 落地方案

> 需求源：钉钉文档《植物大地图系统》（2026-10-20 拉取，正文 77,631 字，本地转存 `tmp/map_system_doc.md`）
> 现有代码：`assets/script/app/bigmap/`（4,509 行）· 配置 `assets/remoteRef/BigMap-*.json`（12 张）· 测试 4 个文件 49 条
> 上一版实现说明：`docs/bigmap-系统实现说明.md`（2026-10-17，个人层单机版）

---

## 0. 结论先行

1. **文档不是"加个玩法"，是一个独立 SLG**：26 张配置表 + 22 张运行时存档表 + 30+ 界面元素 + 15 项服务端定时任务 + 跨服战盟。按现有人力，全量不是一期能干完的量级。
2. **现有 bigmap 是"个人层 + 本地存档 + 即时结算"的骨架**，覆盖文档约 **1/4**（详见 §1、§2）。界面是线框图，战斗是公式直算，没有服务器、没有联盟层、没有基地攻防。
3. **真正的门槛不是界面，是三件事**：① 服务器权威（存档 / 时钟 / 榜 / 快照）② 联盟→战盟的分层与跨服 ③ 基地攻防与迁移。界面工作量反而是最好估的。
4. **客户端先做对一件事，后面所有期都不用返工**：把「本地存档 + 本地时钟 + NPC 榜」抽成三个可替换端口（§3.4）。现在 `BigMapPresenter` 直接读写 `localStorage`、`tick()` 用本地逻辑秒、名次来自 NPC 模拟，这三处不抽，联机化等于重写。
5. 建议 **P0 个人层联机闭环 → P1 联盟层城池 → P2 基地攻防/集结 → P3 战盟跨服/赛季**。P0 可独立上线验证留存，且客户端 P0 里有约一半工作**不依赖服务端**，可以立刻开工。

---

## 1. 现状盘点（有据）

| 系统 | 现有实现 | 证据 |
| --- | --- | --- |
| 基地建造 | 5×5 六边建造区、按格摆放、1~3 队列、升级前置、资源田产出/收获/离线结算 | `model/BigMapBase.ts`、`view/BigMapBaseView.ts` |
| 建筑解锁 | 唯一来源 = 冒险章节通关（1 章主城 … 6 章装饰） | `model/BigMapUnlock.ts` |
| 世界地图 | 40×40 六边格、种子确定性生成、四层环、12 座个人层城池 + 13 座灰城、20 野怪、1 玩家基地 + 16 NPC | `model/BigMapWorld.ts` |
| 攻城 | 行动力 / 城防递减 / 越界 −20% / 打穿 + 战功达标 = 占领 | `model/BigMapBattle.ts` |
| 野怪 | 逐级解锁、击杀发奖、刷新 CD | 同上 |
| 界面 | 全 `Graphics` 线框：顶栏 / 大地图 / 建造区 / 建造列表 / 详情面板 / 队列条 | `view/BigMapTheme.ts`、`view/BigMapPage.ts` |
| 存档 | `sys.localStorage`，键 `zhancheng.bigmap.save`，脏档修复 | `application/BigMapStorage.ts`、`model/BigMapSaveData.ts` |
| **无** | 服务器 / 协议 / 联盟层 / 战盟 / 基地攻防 / 迁移 / 集结 / 阵容战斗 / 赛季 / 商店 / 托管 / 倍速 | `docs/bigmap-系统实现说明.md` §7 |

**战斗是公式直算，不接对局**：`BigMapBattle.ts` 头部明写"单人 + NPC 竞争者的可算版本"，伤害 = `420 + 180×(主城等级−1)`。文档要求"沿用项目内普通关卡战斗 + 托管 + 倍速"，这是**换实现**，不是调参（见 §3.2）。

---

## 2. 差额表（文档 vs 现状）

优先级口径：**P0 = 个人层闭环必需**，**P1 = 联盟层**，**P2 = 攻防/集结**，**P3 = 跨服/赛季**。

| 系统 | 文档要求 | 现状 | 差额 | 优先级 |
| --- | --- | --- | --- | --- |
| 建造 · 队列 | 3 队列、付费解锁、有效期、取消返还 | 有队列，解锁用货币 | 补付费/到期/取消返还 | P0 |
| 建造 · 产出 | 产量 = 基础×等级×(1+科技)×(1+城池)×拥挤 | 基础×等级 | 补乘数链（城池增益要等 P1） | P0/P1 |
| 建造 · 科技树 | 3 条线、研发队列、前置、科技点 | 只有建筑本体 | 新表 `techTree/techLevel` + 研发队列 | P1 |
| 建造 · 装饰/赛季/城门 | 小玩法收集、赛季清零、城门血量决定迁城 | 无 | 赛季部分随 P3；城门挂 P2 | P2/P3 |
| 城池 · 分层 | 4 层（个人/联盟/战盟/王座） | 只有个人层可用，其余 `available=0` 画灰 | 打开 + 放宽 `parseBigMapConfig` 的层校验 | P1 |
| 城池 · 状态机 | 6 态 + 日程（09:00/21:00/21:10/22:00） | 无状态机，state 是派生视图 | 新增 `BigMapCityState` 纯函数 + 日程表 | P0 |
| 城池 · 辐射制 | 每城辐射 8~12 基地、心愿城池 1 座、切换 CD | 只有距离判定 | 新增 `city_radiate` 模型 + 心愿锁定 | P0 |
| 城池 · 榜单结算 | 每日 21:00 锁榜 / 22:00 快照、三系数乘积 | 即时算即时发 | 快照模型 + 结算展示 | P0 |
| 城池 · 名次/拥挤 | 1~10 名梯度 + 11 名起 −3% + 拥挤系数 | 有公式，参数在内 | 对齐口径（§8 有冲突） | P0 |
| 城池 · 联盟层 | 标记/宣战额度/相邻校验/占领上限/弃城换城/攻城积分榜/日志 | 无 | 全套 | P1 |
| 城池 · 首占 | 个人首占 + 联盟首占、一次性发奖、邮件 | 无 | 邮件系统接入 | P1 |
| 野怪 | 三层架构（全图统一/个人实例/多人同步）、集结分怪、迷雾 | 只有单机逐级解锁 | 个人实例层 P0；多队分怪 P2 | P0/P2 |
| 玩家基地 | 区块均衡随机落点、弱 PVP、防御值破城被动迁移、主动迁移（随机/定点）、保护罩/免战、掠夺 | 只有一个固定玩家基地 | **整套新建** | P2 |
| 联盟 | 职位权限、24h 参战冷却、赛季奖励绑定 | `app/league/` 已有完整联盟模块（工会/成员/职位/任务/商店） | 复用 + 加"参战资格/赛季积分" | P1 |
| 战盟/战区 | 4 战盟/战区、跨服匹配、王座 | 无 | 跨服链路 | P3 |
| 集结 | 城池集结（3~4 人、30s）、野怪多队分怪 | 无 | 新建 | P2 |
| 界面 | 文档列 20+ 界面元素（城池弹窗 12 项、集结弹窗、排行、跑马灯…） | 6 个线框面板 | 逐期补 | 分期 |
| 配置表 | 26 张 | 12 张（脚本推算值） | 补 14 张 + 现有表扩字段 | 分期 |
| 协议 | 全套请求-响应 + 推送 | 无 bigmap 协议 | 见 §6 | 分期 |

---

## 3. 必须先拍板的四个决策

### 3.1 世界由谁生成

| 方案 | 做法 | 优 | 劣 |
| --- | --- | --- | --- |
| A 服务器下发全量 | 服务器存 100×100 布局，客户端拉可视区 | 权威、可热改 | 带宽大、AOI 复杂度高 |
| **B 种子重建（推荐）** | 服务器只下发 `worldId + seed + 配置版本号`，客户端用纯函数重建，服务器下发**动态增量**（归属/野怪状态/其他基地） | 现在 `buildBigMapWorld(config, seed)` 直接可复用；改版靠版本号失效 | 必须锁死配置版本，否则两端地图不一致 |

**推荐 B**，但加一条硬约束：`worldId/seed/配置版本` 三者任一变化，客户端必须丢弃本地缓存重建。现在是写死 `seed`，要改成从服务器拿（`IBigMapWorldConfig` 里已有 `worldId` 字段可承载）。

### 3.2 战斗怎么接

文档要求"沿用普通关卡战斗"。现在 `BigMapBattle` 是公式直算，没有对局。两条路：

- **A 复用 zcds 对局**：进 `battle` 流程 → 打完上报 `damage/warScore` → 服务器校验。真实但重，且城池攻防的敌人（城防/驻守怪）要用现有怪物表配出来。
- **B 保留直算，做成"快速战斗"**：客户端请求"打一次"→ 服务器按公式算 → 回结果 + 战报动画。

**推荐 A 用于城池/野怪（有打法可玩），B 用于基地掠夺（弱 PVP，纯数值结算）**。理由：文档明确写了托管/倍速/集结，这些只有真对局才成立；而基地攻防文档自己写了"按战力结算"，不需要操作。

这一步必须现在定，因为它决定 `BigMapBattle` 是保留还是拆成 `BigMapBattleResolver`（B）+ `BigMapBattleLauncher`（A）。

### 3.3 时钟与结算权威

文档反复写"所有时间均走配置，服务器统一定时切换，客户端只读倒计时"。现在 `tick()` 用本地逻辑秒累加。

**必须新增 `IBigMapClock` 端口**：`now()` 返回服务器校准时间（本地 `Date.now()` + 服务器偏移），所有日程/倒计时/离线结算都走它。这条不抽，跨时区/改系统时间就能刷爆资源。

### 3.4 客户端先抽三个端口（可在服务端就位前完成）

这是本方案最关键的工程建议 —— 现在三个依赖是硬编码的，抽掉之后服务端接入是**换 adapter**，而不是重写 `Present` 层：

| 端口 | 现在是什么 | 抽成什么 | 落地方式 |
| --- | --- | --- | --- |
| `IBigMapRepository` | `BigMapPresenter` 直接 `storage.read/write` 整包 JSON | 按领域拆读：`getBaseState() / getCityStates() / getRank(cityId) / getProgress()`，写改为命令式 `submitXxx()` 返回服务器结果 | 保留现有 localStorage 实现做**离线调试档**，服务器实现平级 |
| `IBigMapClock` | `tick(dt)` 本地累加 | `now(): number`（服务器校准） | 现有逻辑秒实现降级为"单机模拟时钟" |
| `IBigMapRankProvider` | 名次/人数来自入参，NPC 模拟 | `fetchCityRank(cityId)` / `fetchLegionRank(cityId)` | 现有 NPC 生成器降级为"离线样本" |

**判据**：抽完之后，`model/**` 里不许出现 `localStorage`、`Date.now()`、`performance.now()`（一条 grep 能查）。

---

## 4. 分期计划

| 期 | 范围 | 客户端 | 服务端 | 验收判据 |
| --- | --- | --- | --- | --- |
| **P0 个人层联机闭环** | 建造 + 个人城池 + 辐射 + 心愿城池 + 快照结算 + 日程状态机 | 三端口抽象；状态机渲染（6 态 + 倒计时）；快照收益展示；排行榜页；`BigMap-*` 表扩字段 | 存档表（建造/基地/个人积分/快照/辐射）；15 项定时任务里的个人层 5 项；协议 12 条 | 断线重连状态一致；跨 22:00 快照收益正确；改系统时间不影响结算 |
| **P1 联盟层城池** | 标记 / 宣战额度 / 相邻校验 / 占领上限 / 弃城换城 / 攻城积分榜 / 日志邮件 / 首占 | 城池弹窗 12 项元素；标记与日志页；联盟战功榜；接入 `app/league` 权限 | 联盟积分/标记/日志/首占表；归属判定优先级；跨 21:10 结算 | 归属优先级三条规则各有单测；弃城零点前后行为差异正确 |
| **P2 基地攻防 + 集结** | 随机落点（区块均衡+最小间距）、防御值破城、迁移、保护罩/免战、掠夺、集结与多队分怪 | 基地弹窗、迁移界面、保护罩倒计时、集结弹窗、多队分怪结果 | 攻防/迁移日志、落点算法、集结房间 | 破城必触发随机迁移且给保护罩；同基地并发上限生效 |
| **P3 战盟跨服 + 赛季 + 商店** | 战区匹配、4 战盟、王座、赛季清零、商店兑换 | 战盟/王座界面、赛季页 | 跨服战斗/积分/榜；赛季重置 | 跨服积分隔离；赛季结束属性清零、师徒关系保留 |

**依赖关系**：P0 三端口 → 其余全部；P1 的日志/邮件被 P2 复用；P2 联调要求 `battle` 流程已支持托管/倍速（现工程已有部分能力，需确认）。

**客户端可立刻开工（不等服务端）**：三端口抽象、状态机纯函数、日程配置化、排行榜页、线框 → 美术接口预留。这部分建议本迭代就做，否则后面每条界面都要返工。

---

## 5. 客户端技术落位

### 5.1 目录（在现有基础上扩，不新建顶层模块）

```
app/bigmap/
├── model/                     # 纯 TS，零 cc / 零 framework（现状已守）
│   ├── BigMapTypes.ts         # 契约（已有，需扩 6 态/日程/辐射/排名）
│   ├── BigMapConfig.ts        # 12→26 张表解析（已有，需扩）
│   ├── BigMapWorld.ts         # 种子生成（已有，需支持服务器 seed）
│   ├── BigMapBase.ts          # 建造（已有）
│   ├── BigMapBattle.ts        # 拆成 BattleResolver / BattleLauncher
│   ├── BigMapCityState.ts     # ★ 新增：6 态状态机（纯函数，输入 now+日程+配置）
│   ├── BigMapCityRadiate.ts   # ★ 新增：辐射/心愿城池/容量
│   ├── BigMapScore.ts         # ★ 新增：名次/拥挤/等级三系数 + 边际递减
│   ├── BigMapSnapshot.ts      # ★ 新增：快照结算
│   └── BigMapBaseAttack.ts    # P2：基地攻防/防御值/迁移落点
├── application/
│   ├── BigMapPresenter.ts     # 唯一门面（已有，需拆出数据来源）
│   ├── BigMapRepository.ts    # ★ 端口
│   ├── BigMapClock.ts         # ★ 端口
│   ├── BigMapRankProvider.ts  # ★ 端口
│   ├── BigMapNetRepository.ts # P0：走 NetworkTransport 的实现
│   └── BigMapConfigLoader.ts  # 已有
└── view/
    ├── BigMapWorldView.ts     # 已有，P0 改成 chunk 渲染（§5.3）
    ├── BigMapPage.ts          # 已有
    ├── BigMapCityPanel.ts     # ★ 城池弹窗（12 项元素）
    ├── BigMapRankPanel.ts     # ★ 排行榜
    └── BigMapRallyPanel.ts    # P2
```

`core/` 里**不要**再放 bigmap 规则 —— 现有 `core/territory/` 是给对局与领地共用的纯规则，bigmap 目前只有客户端消费，留在 `app/bigmap/model` 更合适（要跨端共用时再上移）。

### 5.2 复用清单

| 能力 | 现成件 | 用法 |
| --- | --- | --- |
| 六边格几何 | `core/hex/HexGridLayout.ts` | 世界格坐标；**注意相位口径** `r = row − (column + (column&1))/2`（`docs/bigmap-系统实现说明.md` §3.2 踩过） |
| 格子高亮/翻格 | `core/hex/HexFlipPresentation.ts` | 势力范围染色、选中格脉冲（领地那边已验证过材质复用/回收） |
| 配置读取 | `ConfigService` + `RefUtil`（`tryGetCompressKeyRefData`） | `BigMap-*` 压缩表解压，**别自己读 JSON** |
| 弹窗骨架 | `framework/ui` 的 `PopupBase` 子类 | 城池/集结/排行面板；`nextPopupFrame()` + `isValid` 检查 |
| 事件 | `framework/event/EventBus` + 契约模块 | 新建 `BigMapEvents`（沿用 `ZCGameHudEvents` 模式，不用 `node.on` 串） |
| 对象池 | `framework/pool` | 野怪/基地图标节点复用 |
| 联盟数据 | `app/league/LeagueRepository.ts` 等 | 职位权限、成员列表；标记/弃城权限直接读 |
| 战斗入口 | `app/battle` + `battletoken` | P2 集结/攻城进对局 |
| 网络 | `platform/network` + `core/network` | `BigMapNetRepository` 走既有 `NetworkTransport`，不新开连接 |

### 5.3 100×100 视图方案（这是最容易翻车的地方）

文档：100×100 = **10,000 格**，1000 名玩家。现在 40×40 全量 `Graphics` 一次画完，扩到 10,000 格会直接卡死。

- **分块**：`chunk = 16×16`（共 49 块），按视口 ±1 块建节点，离屏块回收进池。
- **两级 LOD**（文档界面自己就写了"最高视角/最低视角"）：
  - 远景：每块一张 `Graphics` 合并绘制（城池/基地/野怪只画色块 + 编号）
  - 近景：可视区内才实例化 `prefab`（城池模型/野怪/基地），走对象池
- **AOI**：动态对象（其他玩家基地、野怪状态）只订阅可视区 + 邻居块；服务器按块下发增量。
- **红线**：`update` 里不许遍历全图、不许建临时数组（`AGENTS.md` 帧循环禁令）。世界重建只在 `worldId/seed/配置版本` 变化时做一次。

### 5.4 状态机与时间轴（对齐 `AGENTS.md` 渲染幂等）

```
BigMapCityState.resolve(config, schedule, cityState, now) → { state, stage, remainMs, canAttack, ... }
```

纯函数、无状态、可单测。视图每帧只做 `render(resolve(...))`，不许在 view 里累加计时器。日程表 `cityScheduleConfig` 驱动，代码里不写 `21:00` 这种字面量（文档明确"所有时间均走配置"）。

### 5.5 测试策略

| 层 | 手段 | 判据 |
| --- | --- | --- |
| 纯规则 | `tests/bigmap-*.test.ts`（已有 4 个，49 条） | 断言落到具体数值，不写 `ok === true` |
| 新增规则 | `bigmap-city-state` / `bigmap-score` / `bigmap-snapshot` / `bigmap-radiate` | 状态机跨 6 个时点；三系数乘积；快照幂等 |
| 端到端 | 预览探针 | 断线重连、跨天结算、改系统时间 |
| 配置对账 | xlsx / remoteRef / 代码常量三方一致 | 沿用现有 `tools/config` + `refGen` 口径 |

---

## 6. 服务端接口最小清单（客户端提给后端）

> 现有 `client_proto/protoCompiled.proto`（4,949 行）是编译产物，**真源在服务端**，客户端只消费生成的 d.ts。以下按 P0 提，命名随项目既有风格。

| 功能 | 上行 | 下行 | 备注 |
| --- | --- | --- | --- |
| 进图 | `ReqBigMapEnter` | `ResBigMapEnter{worldId,seed,cfgVer,base,cities,radiate,stamina}` | 一次拉全，避免进图十连 |
| 世界增量 | `ReqBigMapTiles{chunkIds}` | `ResBigMapTiles{tiles[],cities[],bases[],monsters[]}` | 按 chunk 拉 |
| 建造/升级/取消 | `ReqBigMapBuild{op,hexId,buildingId,instanceId}` | 结果 + 新 state | 服务器校验资源与队列 |
| 收获 | `ReqBigMapHarvest{instanceId\|all}` | 结果 + 资源 | 离线产出在服务器算 |
| 攻打城池 | `ReqBigMapAttackCity{cityId}` | 战斗入口参数 / 结算 | 见 §3.2 |
| 上报战功 | `ReqBigMapReportScore{cityId,damage,token}` | 战功 + 实时名次 | 服务器校验伤害上限 |
| 城池详情 | `ReqBigMapCityInfo{cityId}` | 状态/日程/增益/相邻/榜单 | 弹窗一次拉全 |
| 心愿城池 | `ReqBigMapWishCity{cityId}` | 新主城 + CD | 冷却服务器判 |
| 排行榜 | `ReqBigMapRank{cityId,page}` | 榜 + 本人行 | 分片 |
| 快照结果 | 推送 `PushBigMapSnapshot{...}` | 当日收益 | 22:00 |
| 状态推送 | 推送 `PushBigMapCityState{cityIds,stage}` | 阶段切换 | 21:00/21:10 |

**约定**：所有写操作**只发意图不发结果**，服务器回权威状态；客户端本地预演仅用于动画，收到回包后全量覆盖（渲染幂等）。

---

## 7. 配置表落地

### 7.1 命名与格式（沿用已定口径，别改）

- 表名：`BigMap-<中文表名>`（2026-10-17 定），如 `BigMap-城池配置.json`
- 格式：项目统一压缩表 `{"k":[字段],"v":[[值]]}`，客户端经 `RefUtil` 解压
- 端标记：`1` = 双端读，`3` = 仅客户端，`0` = 策划备注
- 策划 Excel：6 行表头（表名 / 端标记 / 中文名 / 说明 / 英文字段名 / 类型），生成器 `tools/config/gen_bigmap_xlsx.py` 已对齐

### 7.2 12 张现有表 → 26 张的增量

| 现有表 | 处理 | 说明 |
| --- | --- | --- |
| `BigMap-世界地图配置` | 扩字段 | `rows/cols` 改 100；新增 `chunkSize`、`playerCap` |
| `BigMap-建筑配置` / `建筑升级` / `建筑产出` | 扩字段 | 加 `unlockType/unlockParam/isSeason/canMove/techGroup` |
| `BigMap-城池配置` | 扩字段 + 扩行 | 加 `layer/occupySubject/exclusive/rangeHex/adjacentCityIds/needAdjacent/openWeek/dailyDeclareLimit/powerThreshold/warScoreRate/damageDecayCurve/singleDamageCap/radiateCapacity/radiateRate/minPlayerCount/wishSwitchCd/snapshotTime/lockBeforeMinutes/occupyScore/minOccupyWarScore/warScoreResetLine/rallyOpen/icon/desc`；行数 25 → 74 |
| `BigMap-城池等级` | 扩字段 | 等级 1~5 与文档 1~8 冲突，见 §8 |
| `BigMap-名次系数` / `积分规则` | 扩字段 | 合并进 `cityRankConfig` 口径（`rankExtendStep/rankExtendMin/rankFullCount/crowdCurve/totalOutputCurve/mainCityRate`） |
| `BigMap-野怪配置` | 扩字段 | 加 `syncType/openCron/fogType/firstKillDropId/normalDropId/rallyOpen` |
| `BigMap-资源定义` / `队列配置` / `行动力配置` | 小改 | 队列加 `queueUnlockDays/offlineBuild` |
| **新增** | `BigMap-城池增益`、`BigMap-城池特性`、`BigMap-攻城日程`、`BigMap-城池奖励`、`BigMap-科技树`、`BigMap-科技等级`、`BigMap-掉落组`、`BigMap-迁城配置`、`BigMap-基地出生`、`BigMap-基地攻防`、`BigMap-集结配置`、`BigMap-联盟配置`、`BigMap-赛季配置`、`BigMap-推广绑定` | 共 14 张 |

### 7.3 流程

```
策划 xlsx（6 行表头） → eSon 导表 → assets/remoteRef/BigMap-*.json → refGen → d.ts
                     ↘ tools/pvp_card_check.py 之类校验 ↗
```

**当前状态要如实说**：`gen_bigmap_tables.py` 是**数值推算脚本**，直接写 remoteRef；`gen_bigmap_xlsx.py` 才把字段表导成策划 Excel（输出到 `D:/Alan/占城玩法/策划文档/大地图/配表/`）。也就是**现在真源是脚本，不是策划表**。P0 期间必须把 12 张表转为策划 xlsx 入库，否则每次改公式都要改 py 重跑，策划改不动。

---

## 8. 文档内部冲突（必须先请策划确认，不要程序里二选一）

逐条对过原文，这些是**同一份文档里两处写法不一致**，不与现状混谈：

| # | 项 | 冲突 | 建议 |
| --- | --- | --- | --- |
| 1 | 拥挤系数 | §四.5 正文 `0.6 + 0.5/N`；`cityRankConfig` 表 `0.5 + 0.5/N` | 以表为准改正文，或反之；必须选一个 |
| 2 | 名次系数 | 概述"前 5 名 100/90/85/80/75/70"（6 个值却写前 5）；§四.4 给 1~10 名 100/90/85/80/75/71/68/65/62/60 | 以 §四.4 为准（概述标注作废） |
| 3 | 个人占领 | 概述"最外层个人玩家最大同时占 1 个"；§二/§四"锁定 1 座主城 + 多城辐射" | 以定稿为准，概述作废 |
| 4 | 城池等级 | 概述"4 层"；§二"8 个等级同心圆"（20/15/20/11/4/3/1 = 74 座）；字段写"cityLevel 1~5（征途参考 1~8）" | 三处三义，必须定；影响表行数与 UI 分级 |
| 5 | 地图与人数 | 概述 100×100 支持 1000 人；现配 40×40 | 若真 1000 人同图，AOI/分块方案必须先定（§5.3） |
| 6 | 术语 | 正文混用"军团 / 联盟"；存档表用 `city_legion_score`；工程里是 `League` | 统一为"联盟/League"，存档表字段名同步改，否则两端对不上 |
| 7 | 标记 vs 宣战 | §五"每日可标记数量有限"、§六.1"每日宣战城池数未超上限（3 城）"、§二"每日宣战限 3 城" | 标记和宣战是同一件事还是两步？额度共享还是独立？ |
| 8 | 战力门槛 | "战力不达标无法上榜"，但攻打本身不拦 | 确认：不达标是不进榜还是不能打（影响按钮状态） |

另有大量 `{花括号}` 待定数值（耗材、时间、上限、价格），这些本来就该进配置表，不阻塞，但**每次评审要过一遍“本期是否填”**，否则 P0 上线全是占位值。

---

## 9. 风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 规模误判 | 全量 ≈ 独立 SLG，客户端增量预估 2~3 万行 + 服务端整套 | 严格按 P0~P3 切，每期可上线；P3 前不做跨服 |
| 配置无真源 | 现为脚本推算值，策划改不动，数值与文档两套 | P0 内把 12 张转 xlsx 入库，改 JSON 前先改表 |
| 1000 人同图 | 现 40×40 全量绘制会随规模线性恶化 | §5.3 分块 + LOD 先行，P0 就落地 chunk 渲染 |
| 战斗口径未定 | §3.2 不定，`BigMapBattle` 白写 | 评审第一件事定 A/B |
| 跨服战盟 | 现工程无跨服战斗/积分链路 | P3 前单独做技术预研，不混在功能期里 |
| 美术缺失 | 现在全线框，城池/基地/野怪无资源 | 视图留 `BigMapTheme` 接口，P0 末提交美术需求单 |
| 术语不统一 | 存档表 `legion` vs 工程 `League`，两端字段对不上 | §8-6 先统一再建表 |

---

## 10. 下一步（本周可做，不依赖任何外部确认）

1. **抽三个端口**（§3.4）：`IBigMapRepository` / `IBigMapClock` / `IBigMapRankProvider`，现有 localStorage 实现降级为离线档。判据：`grep -rn "localStorage\|Date.now()\|performance.now()" assets/script/app/bigmap/model/` 为空。
2. **写 `BigMapCityState` 纯函数 + 单测**：用 `BigMap-攻城日程`（这张表还没有，先用常量 + 测试夹具）驱动 6 态，覆盖 08:00/09:00/21:00/21:10/22:00 五个时点。
3. **把 §8 的 8 条冲突 + §9 的攻击口径拿去过评审**，一次问清，别在代码里留二选一。

> 第 1、2 项纯客户端、零服务端依赖、不碰 prefab，且是后续所有期的地基。这三件做完，P0 的客户端部分就能和后端并行推进。
