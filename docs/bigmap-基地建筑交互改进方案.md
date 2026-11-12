# 基地建筑交互改进方案（对标《向僵尸开炮》征途基地）

> 依据：本仓 `bigmap/` 现有实现（2026-11-11 读码）+《向僵尸开炮》征途基地的实际界面结构
> （玩家攻略「长按建筑可拖动重摆放」、拆解文与实战截图 OCR：`Lv.1 猎场 / 剩余储量 1200000(100%) / 采集时间 04:19:44`、
> `源能塔加成 → 打怪出征速度 +2.00%`、`建筑详情 → 等级/盟友帮助次数/战力 逐级对照`、`9千/h`、底部「家园 / 世界」平级页签）。

---

## 0. 结论先行

1. **最痛的不是美术，是「一次点击就弹居中模态」**。基地里所有建筑共用同一个 `BigMapInfoPopup`（居中 + Dim + 两颗按钮），
   想连着升两个建筑必须「关弹窗 → 重新找格 → 再点」。竞品是**三层结构**：地图常驻 → 贴底建筑卡（非模态）→ 升级详情（模态）。
   项目里 `BigMapCityPopup` 已经是「贴底 + Widget 自适应 + 零 setContentSize」的范式，直接照搬即可，成本低。
2. **结构化数据早就够，UI 却压成一句文本**。`IBigMapProduceConfig`（`producePerHour` / `produceCap`）、
   `IBigMapBuildingLevelConfig`（`attrBonus` / `resCap` / `preBuild` / `instantCost` / `maxOtherLevel`）全部零消费；
   `plotDetail` 只吐 `costGrain/Wood/Iron/buildTime`。所以「当前产率 → 下一级产率 +N/h」这类对比**不需要动配表**。
3. **三处可量化的硬缺陷**（不是主观感受）：
   - 选中描边 `cyan(79,216,228)` 压在沙地 `(201,176,138)` 上对比度 **1.22:1**（WCAG 非文字需 ≥3:1）⇒ 选中态等于不存在；
   - 建造面板里「资源不足 / 解锁原因」用 `danger(214,96,62)`，压在选中行 `cardLight(92,93,104)` 上 **1.74:1** ⇒ 最该看的字最看不见；
   - `switchMode('base')` 会立刻 `selectedPlotHexId = 主城` ⇒ **一进基地就被主城弹窗糊脸**，玩家还没看清布局。

---

## 0.5 审阅修正（2026-11-11，动手前复核本方案自身）

方案是自己写的，落代码前逐条核了一遍，**四处写错了**，此处订正（正文对应小节已同步改）：

| # | 原方案写的 | 实测 / 事实 | 订正 |
| --- | --- | --- | --- |
| ① | 选中描边换 `#FFF0C8`，「对沙地 3.9:1」 | 实测 **1.84:1**。沙地 `(201,176,138)` 亮度高，**亮色系任何颜色都到不了 3:1**（纯白也只有 2.09:1） | 色值方案整体作废，改**双环**：深色外环 `(20,18,14)` **8.96:1** + 暖金内环做语感。已实现 |
| ② | 危险字 `#FF8A6B`「4.6:1」、次要字 `#C8C4B8`「4.8:1」 | 实测 **2.83:1** / **3.74:1**（都在 `cardLight` 上） | 改 `dangerText(255,205,190)` **4.57:1**、`mutedText(224,220,208)` **4.76:1**。已实现 |
| ③ | 「文案改版会打 `tests/bigmap-format.test.ts`」 | 那个文件是**布局格式 js↔ts 对拍**，与建筑文案无关 | 真正受影响的是 `bigmap-base-render` / `bigmap-base-view` 的**模块桩**（它们把 `BigMapPresentationText` 整个 mock 掉了）。已改为引用真实纯函数 |
| ④ | 「L1 建筑卡照搬 `BigMapCityPopup`」 | `BigMapCityPopup` 是 `PopupBase` 子类，自带 `__BlankClose` 空白接收层 + 暗底，**会挡住地图点击**，与「非模态、地图可见」直接冲突 | 只复用它的 **Widget 排布思路**（贴底 + 四边对齐 + 代码零 `setContentSize`），卡本身必须是 `BigMapPageLayout` 下的普通节点 |

另外两处执行层面的修正：

- **prefab 子节点顺序不可靠**：`node_hierarchy move` 报成功，但保存后 `_children` 顺序没变。⇒ 光效层级改为**代码里 `setSiblingIndex`**（`build()` 时定死 1 / 3），与 `paintOrder` 同一套做法。
- **`IBigMapPlotDetailView` 加字段是破坏性改动**：`tests/bigmap-move.test.ts` 手搓了一份老对象，`formatBigMapPlotDetail` 读 `detail.preBuild.filter` 直接运行时崩。⇒ 新增 `tests/helpers/bigmap-view-state-fixture.ts#bigMapPlotDetailFixture`，以后加字段只改一处。

---

## 1. 现状链路（代码事实）

```
底部模式钮（'基地'/'大地图' 两态）
  └ BigMapPageLayout.onModeClick → intent{kind:'mode'}
      └ BigMapController.switchMode()            BigMapController.ts:156
          ├ 清所有选中 → selectedPlotHexId = 主城 hexId   ← 于是立刻弹窗
          └ command{focusBase}

地图手势  BigMapBaseView.ts:230-314
  ├ 拖拽平移 / 滚轮 / 双指缩放（clampBigMapBaseCamera）
  └ onTouchEnd:273  paintOrder 反向拾取
      ├ hitSprite(resource) → intent{harvest}
      ├ hitSprite(icon|badge) → intent{plotTap}
      └ pickBigMapBasePlot() → intent{plotTap}

plotTap  → BigMapController.selectPlot():211
  ├ pendingBuildingId≠0 → requestBuild(hexId, id)   ← 放置
  ├ pendingMoveInstanceId≠0 → requestMove
  └ 否则 selectedPlotHexId = hexId, buildMenuVisible = (无详情)

展示  → BigMapPage.refreshInfoContent():326 → buildInfoPopupContent():360
  └ BigMapInfoPopup（**居中模态**）：title + 一段 body 文本 + 缩略图 + 主按钮 + 次按钮

建造  → 建造面板竖列（6×56px）→ intent{build} → Toast「点击空地放置X」→ 所有空格画 1px 细边
收取  → 点收集图标 / 次按钮 / 一键收取  → 结果统一 Toast
```

**主/次按钮语义随状态漂移**（`BigMapPage.ts:379-386`）：

| 状态 | 主按钮 | 次按钮 |
| --- | --- | --- |
| 已建成可升级 | 升级 | 有产出→「收取 N」；否则→「移动」 |
| 建造/升级中 | 取消建造 | 有产出→收取；否则隐藏 |
| 满级/被限制 | 升级（灰） | 收取 / 移动 |

一颗按钮扛两种语义、灰态只靠 `interactable=false`（没有锁形、没有原因），是误操作的主要来源。

---

## 2. 问题清单

### P0（体验崩塌级，必须改）

| # | 现象 | 证据 | 影响 |
| --- | --- | --- | --- |
| P0-1 | **一进基地就弹主城模态** | `BigMapController.ts:162-163` 直接设 `selectedPlotHexId`，`refreshInfoContent` 随即 `showInfoPopup` | 首屏被遮，看不出基地全貌，第一印象是「卡了一下」 |
| P0-2 | **选中态几乎不可见** | `BigMapBaseView.ts:157` `strokeColor = cyan(79,216,228)`，沙地 `(201,176,138)` ⇒ 1.22:1 | 玩家点完不知道点中了谁 |
| P0-3 | **信息层与操作层糊在一起** | 单张居中模态同时承担「看一眼」和「点升级」 | 连续操作要开关弹窗；地图上下文丢失 |
| P0-4 | **放置没有 ghost / 合法性着色** | `BigMapBaseView.ts:155` 只给所有空格画 1px 细边 | 选完建筑不知道"能放哪、放哪行"，只能瞎点 |
| P0-5 | **升级看不到收益** | `formatBigMapPlotDetail` 只输出消耗 + 「提升建筑等级与发展能力」 | 玩家没有升级动机，SLG 的正反馈断了 |

### P1（明显掉分）

| # | 现象 | 证据 |
| --- | --- | --- |
| P1-6 | 失败原因是程序语且混英文 key | `bigMapMissingRes` ⇒ `资源不足：grain 差 12`；另有 `建造队列已满` / `受主城等级限制` / `需先将木材田-1升到 1 级` |
| P1-7 | 建造中只有格子上一行 `120s` 小字 | `BigMapBaseView.ts:185`；无进度环、无「立即完成」（`instantCost` 零消费） |
| P1-8 | 队列是底部一行拼接长文本 | `BigMapPageLayout.refreshQueue():194`，`建造队列 1/1 · 粮食田→Lv.3 120s · 待解锁 1` |
| P1-9 | 成功反馈全是 Toast | 建成 = 换图；收取 = 数字跳动。项目已有 `MainResBarFeedback`（0.46s 加/减/闪光曲线）但大地图未接 |
| P1-10 | 移动是「弹窗次按钮 → 再点空地」 | 竞品是**长按建筑直接拖动**；`canMove` 字段与 `bigMapCanMove` 规则都已就绪 |
| P1-11 | 同类建筑长一样 | `baseBuilding.baseBuildIcon`：5 座粮食田同一张 `barracks-pineapple`、6 座雕像中 4 座同一个 `territory_random_resource_v1` |
| P1-12 | 触控命中会串格 | `onTouchEnd` 用整张建筑图 rect + `paintOrder` 反向，高建筑吃掉相邻格；空地只有中心小范围可点 |

### P2（打磨项）

- P2-13 建造面板是地图上的固定竖列（`y = 216 - i*56`），6 行占 336px，无滚动、无图标、无「已建满」态。
- P2-14 「基地 / 大地图」是一颗互斥按钮，而竞品把「家园」做成与「世界」平级的常驻页签。
- P2-15 无「下一步该做什么」引导（`baseBuildInfo` 里写着 `提供科技研发入口` 这类文案，但没有任务链目标）。
- P2-16 取消建造（会返资源）、花资源升级均无二次确认。

---

## 3. 目标交互模型

**三层分离，逐层进入**（与竞品一致）：

```
Layer 0  地图层（常驻）
         建筑 + Lv 角标 + 建造进度环 + 可收取气泡
         ↓ 单击建筑（≤12px 位移）
Layer 1  建筑卡（非模态，贴底；复用 BigMapCityPopup 的 Widget 方案）
         名称 Lv.x ｜ 产率 1.2K/h ｜ 储量 800/1.0K ｜ [升级] [收取] [移动]
         ↓ 点卡片主体 或 点「升级」
Layer 2  升级详情（居中模态，仅此处用 Dim）
         当前 → 下一级 逐项对照（产率 / 容量 / 加成）＋ 消耗 ＋ 时长 ＋ 前置条件 ＋ [升级]
```

### 关键差异表

| 维度 | 现状 | 目标 |
| --- | --- | --- |
| 点建筑 | 居中模态遮住地图 | 贴底卡，地图仍可见、可继续点别的建筑 |
| 升级 | 卡片上的按钮直接发请求 | 先进详情看「+N/h、消耗、时长、前置」，再确认 |
| 摆放 | Toast + 全图细边 | ghost 跟随手指 + 绿/红格 + ✓/✕ 角标 |
| 移动 | 弹窗次按钮 → 点空地 | 长按 400ms 进拖拽态（可放绿、不可放红） |
| 成功反馈 | Toast | 世界内粒子/飘字（复用 `MainResBarFeedback` 节奏） |
| 失败反馈 | Toast（程序语） | 卡片内红字 + 缺多少 + 直达入口 |

### 状态矩阵（建筑卡）

| 状态 | 卡头 | 主数值区 | 主按钮 | 次按钮 | 卡片强调 |
| --- | --- | --- | --- | --- | --- |
| 可升级 · 资源够 | `名称 Lv.3` | `1.2K/h · 储量 800/1.0K` | 升级 | 收取 N | 金色描边 |
| 可升级 · 资源不够 | 同上 | 同上 | 升级（灰）+ 缺 `粮 12` | 收取 N | 无 |
| 建造中 | `名称 Lv.3→4` | 进度环 + `02:14` | 立即完成（货币） | 取消建造 | 进度条呼吸 |
| 满级 | `名称 Lv.10` | `1.8K/h · 满载` | — | 收取 N | 无 |
| 不可移动 | 同上 | 同上 | 升级 | 收取 / 隐藏 | — |

> 卡片里**不再出现**「移动」和「收取」抢同一颗按钮：腾出第三颗小图标按钮（或长按拖动替代），语义不再漂移。

---

## 4. 规格

### 4.1 尺寸与布局（画布 720×1280，底部导航 88）

| 元素 | 规格 |
| --- | --- |
| 建筑卡 | 宽 692（同 `BigMapCityPopup` Panel 口径）、高自适应 ≥176；贴底 `bottom = 88+16`，水平居中 |
| 卡内分区 | 左 96×96 建筑缩略图 ｜ 中 名称(24 粗)+产率(22)+储量条(250×8) ｜ 右 主按钮 168×72 |
| 次按钮 | 168×64，主按钮下方 8px |
| 升级详情 | 居中 620×自动，`scrim = (5,10,14,205)`（与领地弹窗逐通道同值） |
| 建造面板 | 改底部抽屉：宽 720，高 240，横向滚动 96×120 卡片，每卡 = 图标 + 名称 + `0/5` + 成本 |

### 4.2 颜色（沿用既有常量，只补 6 个）

> ⚠️ 本表已按实测订正过一遍（见 §0.5 ①②）。**沙地太亮，亮色在它上面做不出 3:1**，
> 所以「选中」一律走深色外环；「卡片文字」一律走浅色档。

| 用途 | 值 | 实测对比度 |
| --- | --- | --- |
| 选中外环 | `#14120E`（`selectOuter`）6px | 对沙地 **8.96:1** ✅ |
| 选中内环 | `#FFCA5C`（`selectInner`）2px | 1.38（不承担对比，只给语感） |
| 可放置 | `#185C28`（`placeOk`）+ ✓ | 对沙地 **3.87:1** ✅ |
| 不可放置 | `#7A1A1A`（`placeBad`）+ ✕ | 对沙地 **5.06:1** ✅ |
| 选中底光 | `#FFE296` α64（`glowFill`） | 装饰，不参与 |
| 危险文字（深卡正文） | `#FFCDBE`（`dangerText`） | `cardLight` **4.57:1** ✅ |
| 次要文字（深卡正文） | `#E0DCD0`（`mutedText`） | `cardLight` **4.76:1** ✅ |
| ~~危险文字 `#FF8A6B`~~ | ~~2.83:1~~ | ❌ 原方案算错，作废 |
| ~~次要文字 `#C8C4B8`~~ | ~~3.74:1~~ | ❌ 同上 |

### 4.3 动效（只动 `transform` / `opacity`，全部由 `elapsed` 纯函数出值，符合 `AGENTS.md` 渲染幂等）

| 动作 | 参数 |
| --- | --- |
| 建筑选中 | `scale 1→1.06`，0.12s，`easeOutBack`；底光 `alpha 0→0.55` 同步 |
| 卡片入场 | `y -40→0` + `alpha 0→1`，0.18s `easeOutCubic`；切建筑时**原地换内容**不重播入场 |
| ghost 跟随 | 跟随手指，`alpha 0.6`，可放/不可放瞬时切色（≤1 帧延迟） |
| 建造进度环 | 环形 2px，`remain > 60s` 青灰 / `≤60s` 金 / `≤10s` 闪烁 1Hz |
| 收取 | 资源图标沿贝塞尔飞向顶栏，0.46s（复用 `RES_BAR_HIT_SECONDS`），落点触发 HUD 单格闪光 |
| 建成 | 灰尘 Sprite + `Lv.+1` 金色飘字（0.8s 上浮 + 淡出） |

### 4.4 文案表（程序语 → 玩家语）

| 现在 | 改为 |
| --- | --- |
| `资源不足：grain 差 12、wood 差 3` | `粮食差 12　木材差 3`（缺的那项高亮，可点跳转产出建筑） |
| `受主城等级限制` | `主城 Lv.4 才能升到 Lv.5` |
| `建造队列已满` | `建造队列已满（1/1）· 点此解锁` |
| `需先将木材田-1升到 1 级` | `前置：木材田 Lv.1`（带完成勾选态） |
| `提升建筑等级与发展能力` | `产量 1.2K/h → 1.5K/h　+0.3K/h` |
| `建造中 · 剩余 120s\n进度 67%\n取消将按原规则返还资源` | 卡片内进度环 + `02:00`；取消时二次确认弹「返还 粮6 木4」 |
| `粮12 木8 铁3 · 30s · 第2章` | 三个资源图标 + 数字（不足标红）｜ `00:30` ｜ 章节只在不满足时出现 |

---

## 5. 无障碍审计（WCAG 2.2 AA 实测）

用 sRGB 相对亮度实算，正文需 ≥4.5:1、非文字 ≥3:1：

| 组合 | 比值 | 判定 |
| --- | --- | --- |
| `cream(238,235,214)` / `cardDeep(46,47,55)` | 11.08 | ✅ |
| `cream` / `card` | 7.43 | ✅ |
| `cream` / `cardLight` | 5.43 | ✅ |
| `muted(178,176,168)` / `cardDeep` | 6.13 | ✅ |
| `muted` / `card` | 4.11 | ❌ 正文不达标 |
| `muted` / `cardLight` | 3.00 | ❌ |
| `danger(214,96,62)` / `cardDeep` | 3.55 | ❌ |
| `danger` / `cardLight` | 1.74 | ❌ 严重 |
| `cyan(79,216,228)` / 沙地 | 1.22 | ❌ 严重（选中描边） |
| 暖棕 `(90,58,24)` / 沙地 | 4.90 | ✅ 建筑名可读，保留 |

**结论**：现有「红色 = 不足/锁定」在选中行几乎不可读，必须换色值；选中描边必须换暖金。

另外三条硬要求：
1. 触控目标 ≥ 44×44 —— `minZoom` 下地块约 60px，但**建筑命中矩形按图片算**，缩到最小时相邻格重叠，需把命中限制在「格子中心 ± tileHeight/2」内再取该格建筑。
2. 灰态不得只靠颜色 —— `interactable=false` 的按钮加锁形图标 + 一行原因。
3. 成功/失败不得只靠颜色 —— ✓/✕ 图标 + 文案。

---

## 6. 落地拆分

### 第 1 步（P0，半天～1 天，纯收益）

**1.1 取消「进基地即弹窗」**
- `BigMapController.switchMode`：`selectedPlotHexId` 不再设主城，改为 `command{focusBase}` 只移镜头。
- 验收：`tests/bigmap-controller.test.ts` 新增「切到 base 后 `selectedPlotHexId === -1`」。

**1.2 选中态换暖金 + 底光**
- `BigMapBaseView.refresh()`：描边色 `#FFF0C8`、底光 Sprite（`Plot` 模板加 `Glow` 节点）。
- prefab 侧：`BigMapBaseView` 的 `Plot_` 模板加 `Glow`（Sprite，暖金椭圆，默认 `alpha 0`）→ **走 cocos-creator MCP**，不手写 JSON。
- 验收：`tests/bigmap-base-view.test.ts` 断言描边色不为 cyan。

**1.3 `plotDetail` 补字段（不改配表，只 expose）**
```ts
// IBigMapPlotDetailView 追加
readonly produceNow: number;      // config.produce.get(id).get(level).producePerHour
readonly produceNext: number;     // …get(targetLevel)
readonly produceCap: number;
readonly resType: BigMapResType | '';
readonly attrBonus: number;       // 千分比
readonly instantCost: number;
readonly preBuild: readonly { name: string; level: number; done: boolean }[];
readonly missing: readonly { res: BigMapResType; amount: number }[];
```
- `missing` 由 `bigMapMissingRes` 结构化后返回（现在是拼字符串，英文 key 直接漏到 UI）。
- 验收：新增 `tests/bigmap-plot-detail.test.ts`（产率现/下级、缺料清单、前置完成态）；`tests/bigmap-format.test.ts` 因文案改版同步改断言（用失败用例名差集验证，不看总数）。

### 第 2 步（P0，2～3 天，主体改造）

**2.1 新增 `BigMapPlotCard`（Layer 1）**
- 文件：`bigmap/view/BigMapPlotCard.ts` + `Prefab ui/bigmap/BigMapPlotCard`（MCP 建）。
- 照搬 `BigMapCityPopup` 的 Widget 方案：根四边对齐、`Panel` 贴底 `bottom = 导航高 + 16`、**代码里零 `setContentSize`**。
- 只发 intent：`{kind:'plotUpgrade'}` / `{kind:'plotHarvest'}` / `{kind:'plotDetail'}` / `{kind:'plotMove'}`。
- `BigMapPage.refreshInfoContent`：base 模式走卡片，不再 `showInfoPopup`；`BigMapInfoPopup` 只留野怪、城池、搬移确认。

**2.2 新增「升级详情」（Layer 2）**
- `bigmap/view/BigMapUpgradePopup.ts`，居中模态，内含三级区块：`收益对照` / `消耗与时长` / `前置条件`。
- 复用 `scrim (5,10,14,205)` + `drawBigMapCardPanel`。

**2.3 ghost 放置**
- `BigMapBaseView` 加 `ghost: Node`（半透明建筑图 + 落点格高亮）。
- `pendingBuildingId !== 0` 时：跟手（`onTouchMove` 里移到当前指下格），落点合法性用 `bigMapCanPlace` 同款判定前置算一遍（纯函数，可单测）。
- 可放/不可放：绿/红 + ✓/✕。

### 第 3 步（P1，2 天）

- **长按拖动移建**：`onTouchStart` 起 400ms 计时，未移动且建筑 `canMove` ⇒ 进拖拽态。松开落在合法格 = `requestMove`。
- **进度环 + 立即完成**：`Plot` 模板加环形 Graphics；`instantCost` 接「立即完成」。
- **收取粒子**：复用 `MainResBarFeedback` 的 0.46s 节奏 + 顶栏单格闪光。
- **建造面板改底部抽屉**：横向卡片，图标 + `0/5` + 成本（不足标红），不再挤占地图。

### 第 4 步（P2，视排期）

- 「家园 / 世界」拆成平级入口（导航栏两颗），而非一颗互斥按钮。
- 任务链目标（`光信塔升至25级(8/25)` 式的下一步引导）。
- 取消建造二次确认 + 返还清单。

---

## 7. 风险与不做的事

| 项 | 判断 |
| --- | --- |
| 不新增配表字段 | 本方案全部字段在 `baseBuilding` / `baseBuildingLevel` / `bigmapProduce` 里已有，只做 expose |
| 不动 `BigMapWorldView` | 大地图（世界）那套交互不动，只改 base 模式分支 |
| 不重做美术 | 建筑图标复用问题（P1-11）单独立项：**同类建筑需要至少 2~3 个变体**，否则同屏 5 座粮食田永远分不清。这是美术产能问题，不是交互能补的 |
| prefab 改动 | 一律走 cocos-creator MCP，禁止手改 JSON（工程铁律） |
| 测试口径 | 现有 `bigmap-*` 用例 60 个，本轮会改到 `format` / `controller` / `base-view` / `info-layout` 四处断言；按**失败用例名集合双向差集**验证，不看总数 |

---

## 8. 一句话总结

现在的问题不是「不够像竞品」，而是**把 SLG 基地最核心的「看一眼 → 升一下 → 再升下一座」做成了每次开关一个居中弹窗**；
数据层早已就绪，缺的是把「建筑卡（非模态）／升级详情（模态）／ghost 放置／世界内反馈」这四件事补上。

---

## 9. 执行状态（2026-11-11 第一批已落地）

### 已完成

| 项 | 改动落点 | 判据 |
| --- | --- | --- |
| 进基地不再弹主城模态 | `BigMapController.switchMode` | `tests/bigmap-controller.test.ts`「切到基地只把镜头对准主城、不自动选中」 |
| 选中双环（8.96:1） | `BigMapSkin` `selectOuter/selectInner`、`BigMapBaseView.strokeHex` | `bigmap-base-render` / `bigmap-base-view` |
| 选中底光 + 建造进度环 | prefab `PlotTemplate/Glow`、`PlotTemplate/ProgressRing` + `BigMapBasePlot.glow/progressRing` + `BigMapBaseView.renderGlow/renderProgressRing` | 同上；`bigMapHexCorners` / `buildBigMapProgressPolyline` 为纯几何，可单测 |
| 详情补 6 组字段 | `IBigMapPlotDetailView`：`produceNow/Next/Cap`、`resType`、`storedRatio`、`attrBonus`、`instantCost`、`preBuild`、`missing`；`BigMapModel.plotDetail` | `tests/bigmap-plot-detail.test.ts`（5 条） |
| 缺料结构化，干掉英文 key | `bigMapMissingResList`（`BigMapBase.ts`）+ `bigMapMissingRes` 改中文 | 同上「缺料是结构化清单而不是一句英文 key」 |
| reason 玩家语 | 「主城 Lv.1 才能升到 Lv.3」 | `bigmap-base.test.ts` 改为口径守卫 |
| 详情正文改版 | `formatBigMapPlotDetail` + `formatBigMapDuration` + `formatBigMapRate` | `bigmap-plot-detail`「升级要能看到产量对比」 |
| 建造中/队列时间 | 格子状态与队列条统一 `mm:ss` | `formatBigMapDuration` 断言 |
| 深卡危险/次要字换成达标档 | `BIGMAP_HUD_COLORS.dangerText/mutedText` | 实测 4.57 / 4.76 |
| 摆放红绿预判 | `BigMapModel.placeableHexIds` → `IBigMapViewState.placeableHexIds` → 绿/红边 | `bigmap-controller`「摆放态投影放得下的格子」 |
| **L1 贴底建筑卡**（第二批） | 新脚本 `BigMapPlotCard.ts` + `BigMapPage.prefab` 内 `PlotCard` 节点树（692×180）+ `BigMapPageLayout.plotCard` / `renderPlotCard` | `bigmap-page-prefab`「基地建筑走贴底卡」+ `bigmap-move` 次按钮语义 |
| 点空地收起卡 | `BigMapBaseView.onTouchEnd` 未命中格子时发 `clear`（摆放/搬移态不打断） | `bigmap-page-prefab` 守卫断言 |
| 卡片层级 | 代码 `setSiblingIndex(queuePanel.getSiblingIndex())` —— 垫在导航钮下面、地图上面 | `bigmap-page-bindings` |

### L1 的关键取舍（与原方案的差异）

原方案写「新建 `BigMapPlotCard.prefab`」。实际做成 **`BigMapPage.prefab` 里的 `PlotCard` 节点树**，理由：

- 卡只有这一处用，不值得一个独立 prefab（多一层加载 + 一个 `.meta` + 一次 bundle 登记）；
- 项目的既有约定是「页面 UI 用页面 prefab 维护」（`docs` §5.14），队列条 / 建造面板都在里面；
- 顺带避开 `prefab_lifecycle create` 那一串坑（建完留实例、要清 dirty、要防手滑存场景）。

`BigMapInfoPopup` 保留给**野怪、城池驻守、迁城确认**——那几种确实是「看一眼就走」的模态，用居中弹窗合理。

### 未完成（下一批）

| 项 | 阻塞点 |
| --- | --- |
| L2 升级详情面板 | 卡上正文目前是文本（改版后的产量对比），还差「当前 → 下一级」的**表格化对照**；需要单独一个居中面板 |
| ghost 跟随贴图 | 红绿判定已就绪，只差一张半透明建筑图 + 跟手位移 |
| 长按 400ms 拖动移建 | 需与现有「累计 12px 即平移镜头」的手势仲裁 |
| 收取粒子 / 立即完成 / 建造面板改抽屉 / 页签拆分 / 二次确认 | 未开始 |
| 建筑图标辨识度 | `baseBuildIcon` 里 5 座粮食田共用一张图 —— 美术产能问题，交互补不了 |

### 验证证据

```
npx tsx --test tests/bigmap-*.test.ts
# tests 494   # pass 487   # fail 7
```

7 个红的用例名与改动前**完全一致**（`26 张设计切图` / `野怪用 1003` / `城池弹窗所有节点` /
`适配全部走 prefab` / `从第 1 页打开世界` / `详情排版由Prefab Widget` / `81 条城池参数`）⇒ **B−A = ∅**，本轮零新增失败。

这 7 条属既有基线：`bigmap-fullscreen-entry` 报 `getCachedPvpHeroInfos is not a function`（PVP 服务），
`bigmap-city-popup` 报 `Panel 贴底间距 300.783 !== 160`（prefab 数值）—— 都不经过本轮改动的符号。

`npx tsc --noEmit | grep -cE "^assets/script/app/bigmap"` → **0**

prefab 复查（两批都查）：
- `PlotTemplate` 8 个节点尺寸与改前逐项一致（`BuildingName 140×24`、`Status 140×23` 未被写坏）；
- `glow` / `progressRing` 落盘为 `{"__id__": N}` 且目标 `__type__` 为 `cc.Graphics`；
- `PlotCard` 9 个节点尺寸逐项正确（根 692×180、Thumb 96×96、Body 380×92…），
  `BigMapPageLayout.plotCard → cd92eRS2z5M3bjpZ1af0TnD`（BigMapPlotCard）挂在该节点；
- 三个按钮 Sprite 为 `CUSTOM + _isTrimmedMode=false`（页面守卫会红）。

### 第二批踩到的 MCP 坑（重要）

1. **`node_transform` 的 `customProperties.contentSize` 不落到 UITransform**：接口返回
   "Updated 2 properties"，但保存后节点还是 100×100 —— 必须用
   `set_component_property(componentType='cc.UITransform', properties={contentSize:{type:'size'}})`。
2. **`cc.Label` 的 `overflow` / `enableWrapText` 公开属性设不上**：要用内部字段 `_overflow`，
   否则 `SHRINK` 的 Label 会按文本把节点尺寸重算（Title 从 380×34 变成 52×37.8）。
3. **改完脚本后 `set_component_property` 认不到新字段**：报
   `Property 'plotCard' not found ... Available properties: ...` —— 先
   `asset_system refresh` 触发热重编译，再设就成功。
4. **`prefab_edit save` 会按 Widget 当前 position 重算 `_bottom`**：prefab 里存的 172 不是设计值，
   真正生效的是 `applyNavigationHeight` 里按导航高算的那次赋值 ⇒ 守卫不要断言 prefab 的 `_bottom`。

---

## 10. 第三批：美术同步、策划表接入、放置体验（2026-11-11）

### 10.1 美术落库

`zarts/art/植物占领世界美术/场景资源/基地建筑` 出图 6 张（**212×212 RGBA**，透明底），按类落进工程：

| 美术源文件 | 工程路径 | 覆盖建筑 |
| --- | --- | --- |
| 基地建筑.png | `assets/resources/image/buildings/base_main.png` | 71001 主城 |
| 粮食田.png | `.../base_grain.png` | 71002~71006（5 座） |
| 木材田.png | `.../base_wood.png` | 71007~71011（5 座） |
| 矿石田.png | `.../base_iron.png` | 71012~71014（3 座） |
| 钻石田.png | `.../base_coin.png` | 71015 货币田 |
| 研究院.png | `.../base_research.png` | 71016 研究院 |

放 **`resources/image/buildings/`**（不是 bigmap bundle）：表里 `baseBuildIcon` 的历史口径就是 `image/buildings/*`，
`bundleForPath` 对未登记目录返回 undefined 会自动落回 resources —— 不用动 `BundleCatalog.BUNDLE_DIRECTORIES`，
也就绕开了「新增 bundle 目录必须登记」那条红线（铁律 420）。

图集体量：`auto-atlas.pac` 是 2048²（4.19M 像素），现有约 2.3M，加这 6 张（0.27M）到 2.57M，够。

**没图的**：71017 小玩法入口（表里本来就空，走概念图兜底）、71018~71023 装饰雕像（继续借 `territory_*`）。美术未出图。

### 10.2 策划表接入（真源在 xlsx）

改的是 `doc/塔防数据配置/DM-建筑配置.xlsx` 的 **I 列（`baseBuildIcon`）**，第 7~22 行，共 22 处：

- 表结构：第 1 行文件名 / 第 2 行导出标志 / 第 3~4 行中文名与说明 / 第 5 行字段名 / 第 6 行类型 / 第 7 行起数据；
- I 列是 `t="inlineStr"` **内联字符串**（每行独立），所以按行号正则替换即可，不用碰 `sharedStrings`；
- 改法：zip 级读 `xl/worksheets/sheet1.xml` → 正则替换 → 重新打包（**禁 openpyxl**，会破坏样式）；
- 🔴 研究院那行必须单独改：`territory_random_resource_v1` 被 4 座装饰雕像复用，整体字符串替换会连坐。

**导表被无关数据卡住**：`npm run config:export` 在 `pvpSkillPlan` 报 1689 条既有错误（单位 68025 的普攻技能与升级技能不一致），
流程是「导出到临时目录 → 校验 → 通过才 publish」，所以 `remoteRef` 一个字节都不会写。

处置：用 `node tools/config/export_tafang.mjs --no-publish --keep-config` 拿到临时产物核对
（确认 22 行 icon 全部正确、装饰雕像未受影响），再**按行同步** `assets/remoteRef/baseBuilding.json`。

⚠️ 待 `pvpSkillPlan` 修好后重跑 `config:export`，`remoteRef` 应无差异（xlsx 已是真源）。届时用
`node tools/config/export_tafang.mjs --no-publish --keep-config` 的产物与本文件 diff 一次即可确认。

### 10.3 放置体验：ghost 跟手

新增 `BaseContent/PlotGhost`（Sprite + UIOpacity），挂在**地图坐标系**下（与 `BasePlots` 同级），
摆放态下：

| 行为 | 改前 | 改后 |
| --- | --- | --- |
| 选完建筑 | Toast「点击空地放置X」+ 所有空格画同一道细边 | 半透明建筑图吸在指下格 |
| 能不能放 | 只能点了才知道 | 绿边 + 原色 150 不透明 / 红边 + 染红 90 不透明 |
| 单指拖动 | 平移镜头 | **选落点**（ghost 跟手），不平移 |
| 松手 | 位移 >12px 视为拖动，不放置 | 直接落在指下格（摆放态本来就该"拖到哪放到哪"） |
| 双指 | 缩放 | 仍然缩放（不影响摆放） |

`placeableHexIds`（第二批做的红绿预判）就是 ghost 的着色依据，两处共用同一份判定。

### 10.4 🔴 这批踩的坑：`spriteFrame` 引用类型写成 `cc.ImageAsset`

**现象**：打开 `BigMapPage.prefab` 时编辑器刷一串
`[Scene] Cannot read properties of undefined (reading '0')`，堆栈落在
`Simple.updateUVs → Sprite._flushAssembler → Sprite.__preload`。

**根因**：MCP `set_component_property(propertyType='spriteFrame')` 传 **png 主 uuid**
（`016f4b94-…`）时，落盘的 `__expectedType__` 是 **`cc.ImageAsset`** ——
Sprite 拿到一个 ImageAsset，`imageAsset.uv` 是 undefined，`uv[0]` 当场崩。

**连带的坑**：这个异常发生在 `PrefabSceneProxy.open` 里 ⇒ prefab 场景加载被打断 ⇒
`node_query find_by_name` 找不到节点、`scene tree` 报 `uuid undefined`、
`set_component_property` 报 "Node not found or no components data"。
当时我以为是 uuid 变了，其实是**场景根本没加载完**。

**正解**：传 **spriteFrame 子资源 uuid** —— `<pngUuid>@f9941`：

```json
{"__uuid__": "016f4b94-22b3-4aeb-9d87-e3b5d2b9fd88@f9941", "__expectedType__": "cc.SpriteFrame"}
```

**另一个坑**：文本级改 prefab 里的 `__expectedType__` 会被**编辑器在 exit 时按内存副本回写覆盖**
（改完 `refresh` 再读，又变回 `cc.ImageAsset`）⇒ 必须在 prefab 编辑模式下用 MCP 改，或改完不让编辑器持有旧副本。

守卫：`tests/bigmap-page-prefab.test.ts` 加了「所有 Sprite 的 `_spriteFrame.__expectedType__` 必须是 `cc.SpriteFrame`」。

### 10.5 验证

```
tests/bigmap-[a-l]*.test.ts  → 280 用例, 273 过, 7 红（全为基线）
tests/bigmap-[m-z]*.test.ts  → 214 用例, 214 过
合计 494 / 487 / 7，失败名集合与改动前一致（B−A = ∅）
编辑器日志：修复后进 prefab 编辑模式，ERROR 0 条
```

### 10.6 建筑尺寸与居中（2026-11-11 修正）

**现象**（用户截图）：建筑很小、且不在格子中心。

**根因**：`fitBigMapSprite(sprite, frame, width)` 靠 `setScale` 缩放，而缩放的是**节点自身的
`contentSize`**。`PlotTemplate/Building` 的 Sprite 是 **RAW 模式** —— 设 `spriteFrame` 时引擎会把
`contentSize` 改成图片原始尺寸，于是：
- 换图就漂：`base_main` 212×212 / 兜底 `hq-base` 279×279 会得到完全不同的缩放结果；
- 原代码 `y = iconHeight / 2 - height * 0.12` 是按"图标高度"算的偏移，尺寸一漂，位置一起漂出格心。

**改法**：新增 `BigMapBaseView.fitPlotIcon`，不碰 `setScale`：

```ts
sprite.spriteFrame = frame;            // 先给图（RAW 的尺寸纠正发生在这里）
sprite.sizeMode = Sprite.SizeMode.CUSTOM;
sprite.trim = false;
const width = frame.rect.width * height / frame.rect.height;
requireBigMapTransform(sprite.node).setContentSize(width, height);
sprite.node.setScale(1, 1, 1);
sprite.node.setPosition(0, y, 0);
```

**按「格高」而不是「格宽」约束**：格子是扁六边形（`tileWidth : tileHeight ≈ 147 : 96`），
建筑图是正方形。按宽度撑（147）图高也是 147，上下各溢出相邻格 25px；按高度撑，
建筑的**视觉体量**才和一格一致。

| | 改前 | 改后 |
| --- | --- | --- |
| 尺寸依据 | `setScale`（随图片原始尺寸漂） | `contentSize`（图怎么换都一样） |
| 主城 | `width * 0.95` | `格高 × 1.06` |
| 其它 | `width * 0.82` | `格高 × 1.0` |
| 位置 | `iconHeight/2 - height*0.12` | `水平居中，y = -格高*0.04`（等距视角略沉） |
| 名字牌 / 状态 / 收取图标 | 按 iconHeight 叠在建筑顶 | 名字牌下移到格底 `-height*0.44`，状态/收取移到 `iconHeight/2 ± …` |

ghost 也改用同一函数，保证"预览的大小"和"落位后的大小"完全一致。

守卫：`tests/bigmap-base-render.test.ts`「建筑图标按格高撑满、水平居中、scale=1」。

⚠️ 如果预览里建筑仍是**灰白色的旧塔**（不是新美术的蓝紫堡垒），看控制台有没有
`[BigMap] N 座建筑的 baseBuildIcon 没加载到，已回退概念图：…` —— 有就是新图没进 resources 索引
（重启预览 / 重导入 `assets/resources/image/buildings`），没有就是预览缓存。

---

## 11. UI 一律落 prefab：页面宿主也搬进预制体（2026-11-11）

### 11.1 审计结论：UI 100% 已在 prefab，只有「页面宿主容器」还在代码里建

| 位置 | 现状 | 判定 |
| --- | --- | --- |
| 页面内容（卡片/按钮/文字/地图层） | `BigMapPage.prefab` + `BigMapWorldView.prefab` | ✅ 早已在 prefab |
| 地块 × 25 | `instantiate(plotTemplate)` | ✅ 模板在 prefab，实例化是**数据驱动**，不是搭 UI |
| 建造目录行 | `instantiate(buildRowTemplate)` | ✅ 同上（行数由表决定） |
| 世界标记 / 地面 / 装饰 | `instantiate(...Template)` | ✅ 同上 |
| **页面宿主容器** | ~~`new Node` + 4 次 `addComponent`~~ → `BigMapPageHost.prefab` | ✅ 本次搬走 |

「模板实例化」不算「用代码搭 UI」——节点长什么样、有几个子节点、怎么摆，全在 prefab 里，
代码只负责**按数据复制**。真正需要消灭的是「手写 `new Node` + 逐个 `addComponent` 拼界面」。

### 11.2 新建 `ui/bigmap/BigMapPageHost.prefab`

只装 4 个组件、**没有任何子节点或视觉元素**：

| 组件 | 配置 | 为什么进 prefab |
| --- | --- | --- |
| `cc.UITransform` | 720×1280 | 初始尺寸可见可调 |
| `cc.Widget` | `_alignFlags = 45`（四边）、`alignMode = ALWAYS`、四边 0 | **以前是代码里 8 行赋值**，现在 Inspector 一眼可见 |
| `cc.UIOpacity` | 255 | 运行时立刻被改成 0（准备期隐藏），但初始值该在 prefab |
| `BigMapPage` | — | 页面组件与宿主绑定，不再代码 `addComponent` |

`BigMapEntry` 侧只剩三件必须运行时算的事：`setContentSize`（尺寸随宿主/HUD 变）、
`setPosition`、`setParent`。

### 11.3 🔴 连带修掉一个真实风险：异步实例化后必须复查「页面还在不在」

原来 `new Node` 是**同步**的，`open()` 里 `revision` 校验都在 await 之前就完事。
改成 `instantiate` 之后多了一个 await 窗口 —— 期间玩家可能已经关页 / 切存档，
不复查就会**建出一个没人管的节点**（永不销毁）。

```ts
const root = await this.instantiatePageHost();
// 实例化是异步的：期间页面可能已被关掉 / 换了存档，那就要销毁刚建的节点，别泄漏。
if (revision !== this.openRevision || !this.isSaveOwnerCurrent(owner)) {
    root.destroy();
    return;
}
```

### 11.4 后续加页面级节点，直接改 prefab

想加「准备期遮罩」「全局红点」「断线提示条」，都在 `BigMapPage.prefab` 里建节点 + 绑 `@property`，
不要再往 `BigMapEntry` 里写 `new Node`。守卫用例会拦住这种写法：

```
tests/bigmap-page-prefab.test.ts
  · 页面、基地与公共样式不再运行时搭建 UI
  · 页面宿主也走 prefab：入口不再用代码 new 节点 / addComponent 搭 UI   ← 本次新增
```

### 11.5 改这块要注意的测试桩

两个 harness 用 `runInNewContext` + `require('cc')` 注入桩，`instantiate` 必须返回
**「组件已挂好」的节点**（等价于 prefab 内容），否则 `getComponent(...)!` 会拿到 null：

- `tests/bigmap-entry-cancellation.test.ts`（17 条）
- `tests/bigmap-page-readiness.test.ts`（9 条，其中 `Page.initialize` 里断言了 `node.active === true`）

---

## 12. 建造目录改成模态层：点空白关闭（2026-11-11）

### 12.1 问题

`BuildPanel` 是一块**裸面板**（300×556，贴在左上）：没有遮罩、点面板外面毫无反应，
只能再点一次「建造」按钮才能收起；而且半透明地压在基地上，很难看出它是个浮层。

### 12.2 改法：加一层全屏遮罩 `BuildMenuDim`

新增节点（同在 `BigMapPage.prefab`，无新 prefab）：

| 项 | 配置 |
| --- | --- |
| 尺寸 | 720×1280（铺满） |
| 视觉 | `white.png` Sprite，颜色纯黑，`UIOpacity = 150`（半透明，能看见底下的基地） |
| 交互 | `cc.Button`（`transition = NONE`，不缩放不变色） |
| 行为 | 点击 → 发 `toggleBuildMenu` intent（与再点一次「建造」等价） |
| 显隐 | 与 `buildPanel` **完全同条件**：`mode === 'base' && buildMenuVisible` |

### 12.3 🔴 层级必须在代码里定，`prefab move` 不可靠

`node_hierarchy move` 返回 `✅ Node moved`，但存盘后 `BuildMenuDim` 仍在
`_children` 末尾（和 `plotCard` 那次一样：MCP 存 prefab 不按编辑器所见保序）。
遮罩排在最后 = 盖住面板本身，玩家什么都看不到。所以：

```ts
// initialize() 里，借面板的槽位把遮罩插到它**紧前面**
this.buildMenuDim.setSiblingIndex(this.buildPanel.getSiblingIndex());
this.buildMenuDim.active = false;
```

顺序结果：`… → BuildMenu → **BuildMenuDim** → BuildPanel → QueueStatus → …`
即「遮罩盖住除面板外的一切」。

### 12.4 为什么不走 `PopupManager`

`BuildPanel` 是**页面内的一个列表**，不是独立业务弹窗：

- 它的数据（9 行建筑目录 + 解锁条件）与页面同一份快照，走弹窗栈要多一层状态同步；
- 返回键由 Tab 体系处理（弹窗栈会抢走返回语义）；
- `PopupBase.canCloseOnBlank()` 虽然默认 `true`，但那套是为「详情 / 确认框」设计的。

所以这里做的是**页面内模态层**：视觉上是弹窗（有遮罩、点空白关），
实现上留在 `BigMapPage` 里，不进全局栈。将来若需要「居中大弹窗 + 标题栏 + 关闭按钮」，
再单独做一个 `BigMapBuildMenuPopup`（继承 `PopupBase`），现在的遮罩可以平移过去。

### 12.5 守卫

`tests/bigmap-page-prefab.test.ts`「建造目录带遮罩层」断言：节点存在、铺满屏、
同时有 `Sprite`（视觉分层）与 `Button`（接点击）、`BigMapPageLayout.buildMenuDim` 已绑定。

---

## 13. 建造目录升级为独立 Popup（2026-11-11）

第 12 节那版是「页面内模态层」（`BuildPanel` + 手写 `BuildMenuDim`）。本节把它改成
**独立 prefab + 继承 `PopupBase`**，与其他业务弹窗一致。

### 13.1 新文件

| 文件 | 作用 |
| --- | --- |
| `ui/bigmap/BigMapBuildMenuPopup.prefab` | 弹窗本体：根（Sprite 底板 + `BlockInputEvents` + 弹窗脚本）→ `Title` / `Rows` / `Rows/BuildRowTemplate`(Name + Detail) |
| `view/BigMapBuildMenuPopup.ts` | `extends PopupBase`；`onOpen` 画行、点行发 `build` intent 并关窗 |

### 13.2 页面侧删掉的东西

| 删除 | 原因 |
| --- | --- |
| `BuildPanel` 节点 | 面板搬进弹窗 prefab |
| `BuildMenuDim` 节点 | **遮罩由 `PopupBase.ensureBlankCatcher` 自动建**（全屏透明接收层，`insertChild(0)` 保证压在最底），`canCloseOnBlank()` 默认 true ⇒ 点空白自动关 |
| `Templates/BuildRowTemplate` | 行模板跟着目录走 |
| `BigMapPageLayout` 的 `buildPanel` / `buildMenuDim` / `buildRowTemplate` / `buildRows` / `bindBuildRows` / `refreshBuildRows` | 全部职责移交弹窗 |
| `QUEUE_ROW_ID`（layout 常量） | 改由 `BIGMAP_QUEUE_ROW_KIND`（弹窗导出）统一 |

页面只留一个 `buildMenuButton`（打开用的入口按钮）。

### 13.3 数据流

```
BigMapModel.buildMenu() + queueUnlockInfo()
  → BigMapPage.buildMenuRows(data)      // 摊平成 { kind, name, detail, selected, nameMuted, detailDanger }
  → BigMapBuildMenuPopup.render({ rows }) // 弹窗不认识 model，只画
  → 点行 → EventMgr.emit(Intent, { kind:'build', buildingKind }) + close()
```

`refreshBuildMenu(data)` 跟着 `buildMenuVisible` 走：开→`get()` 有就 `render`、没有就 `open`；
关→`close(Force)`。`open` 是异步的，用 `buildMenuOpening` 挡重复压栈，并在 `.then` 里复查状态
（期间可能已关页 / 退回大地图）。

### 13.4 这批踩的 MCP 坑（都在技能里记过，本次再次复现）

1. **`prefab_lifecycle create` 把 layer 全写成 `DEFAULT(1073741824)`** —— 6 个节点逐个重设成 `33554432`。
2. **create 之后组件引用变 `null`**（`titleLabel` / `rowTemplate` 指向的 `__id__` 失效）—— 进编辑模式重绑。
3. **`node_hierarchy move` 报成功但 `_children` 顺序不变** —— 层级别指望 MCP，改在代码里 `setSiblingIndex`。
4. `node_query find` 按**新名字**搜不到刚 create 的节点（那是 prefab 实例化后的运行时名），用旧名 `BuildPanel` 才找得到。

### 13.5 判据

- `tests/bigmap-page-prefab.test.ts`「建造目录是独立 Popup」：页面里不再有 `BuildPanel` / `BuildMenuDim` /
  `BuildRowTemplate`；弹窗 prefab 里三个引用都非空、行模板 `active=false`、所有节点在 `UI_2D`。
- `tests/bigmap-page-bindings.test.ts`：`layout.buildRows` 必须为 `undefined`（行归弹窗），
  输入锁与按钮态断言保留。
- 全量 **507 用例全绿**（286 + 221），`tsc` 对 bigmap 源码 0 错误。

---

## 14. 落地优先级重排（2026-11-11，按代码事实核对）

### 14.1 先说结论：文档滞后于代码，P0 已全部落地

逐条回代码核对（不是照抄旧清单）：

| 原编号 | 项 | 代码事实 | 状态 |
| --- | --- | --- | --- |
| P0-1 | 一进基地弹主城模态 | `buildPlotCardContent` 只读 `selectedPlotHexId`，进入基地不再主动选中（对标 `switchMode` 注释） | ✅ 已改 |
| P0-2 | 选中态不可见 | `BigMapBaseView` 描边改高对比 + 选中光圈 | ✅ 已改 |
| P0-3 | 信息层与操作层糊在一起 | `BigMapPlotCard` 贴底非模态卡 + 独立 `BigMapBuildMenuPopup` | ✅ 已改 |
| P0-4 | 放置没有 ghost / 合法性着色 | `PlotGhost` 节点 + `renderGhost`（红绿判定 + 最近格吸附） | ✅ 已改 |
| P0-5 | 升级看不到收益 | `formatBigMapPlotDetail` 输出「产量 120/时 → 180/时 +60/时」+ 储存上限 + 属性加成 | ✅ 已改（缺视觉表格化，属打磨） |
| P1-6 | 失败原因是程序语 | `bigMapCanPlace` 的 reason 全中文（`该位置已有建筑` / `建造队列已满`），资源名走 `bigmapResource.resName`（粮食/木材/铁矿） | ✅ 已改 |
| P1-7 | 建造中只有小字 | `renderProgressRing` 进度环 + 卡上剩余时间 + 进度百分比 | ✅ 已改 |
| P1-12 | 触控命中串格 | 命中统一走 `pickBigMapBasePlot`（按格心算，不受绘制顺序影响），摆放态再叠最近格吸附 | ✅ 已改 |
| P2-13 | 建造面板固定竖列 | 已换成独立 Popup（第 13 节），行数自适应 | ✅ 已改 |
| P1-8 | 队列是底部一行拼接长文本 | `refreshQueue` 仍是 `${queue} 1/1 · 粮食田→Lv.3 120s · 待解锁 1` 单串 | ❌ 未做 |
| P1-9 | 成功反馈全是 Toast | 大地图资源条只有 Label，未接 `MainResBarFeedback` 曲线 | ❌ 未做 |
| P1-10 | 长按建筑直接拖动移建 | 仍是「次按钮 → 再点空地」 | ❌ 未做 |
| P1-11 | 同类建筑长一样 | `baseBuilding.baseBuildIcon` 5 座粮田同图 | ⛔ 美术阻塞 |
| P2-14 | 家园与世界平级页签 | 仍是单颗互斥按钮 | ⛔ 需与主界面 Tab 一起改 |
| P2-15 | 无「下一步该做什么」引导 | 无任务链目标 | ⛔ 需策划给目标 |
| P2-16 | 取消建造 / 花资源升级无二次确认 | 点主按钮直接发 `primary` | ❌ 未做 |

### 14.2 重排后的优先级

**排序标准**：① 客户端能否独立完成（不依赖美术 / 服务端 / 策划）；② 误操作或资源损失风险；③ 单位成本收益比。

| 序 | 项 | 成本 | 为什么排这里 |
| --- | --- | --- | --- |
| **A1** | P2-16 二次确认 | 低 | **唯一会「点错就丢资源」的缺口**。取消建造会返资源但白等时间，升级直接扣粮木铁。复用现成 `BigMapInfoPopup`，不动 prefab |
| **A2** | P1-8 队列行结构化 | 中 | 一行长文本在 540×38 里挤三块信息（槽位/进度/待解锁），窄屏会截断。改 prefab 拆成「槽位点 + 文本」，顺带给 P1-7 的进度环一个落点 |
| **A3** | P1-9 资源变化反馈 | 中 | 升级扣了 300 粮、界面只有 Toast，玩家会怀疑没扣。但要接 `MainResBarFeedback` 的 elapsed 曲线（渲染幂等约束），不能简单 tween |
| **B1** | P1-10 长按拖动移建 | 高 | 需与「累计 12px 平移镜头」仲裁，改手势状态机，回归面大 |
| **C1** | P2-15 引导 | 中 | 依赖策划给目标链，客户端先做会返工 |
| **挂起** | P1-11 图标 / P2-14 页签 | — | 美术产能 / 需主界面联调，不在客户端单独闭环 |

**和原文档的顺序差异**：原方案把 P1-8（队列行）排在 P2-16 之前，理由是"可读性"。
但**可读性是掉分项，误操作是丢资源项** —— `取消建造` 目前一点就执行，返还比例再高也白等一次建造时间。
所以 A1 提到最前。

### 14.3 每项的前置判断（做之前先确认）

- **A1**：`BigMapInfoPopup` 的 `onSecondary` 会发 `secondary` intent。建造中卡片 `secondary` 为 `null`，
  控制器那条分支通常是 no-op，但**要实测一次**；若会误触就改成「确认弹窗关窗只发 `clear`」。
- **A2**：`QueueStatus` 节点 540×38 里现在是单个 Label，拆结构要动 `bigmap-page-bindings` 的断言。
- **A3**：`AGENTS.md` 要求渲染幂等（只动 `transform` / `opacity`，由 `elapsed` 纯函数出值），
  **不能用 `tween` 改 Label 颜色**，要照 `MainResBarSlot` 的 `resBarFlashFx` 取 fx。

### 14.4 不做的事（重申）

- 不给 `BuildPanel` 加滚动/图标/已建满态 —— 它已经被弹窗取代。
- 不动 `BigMapInfoPopup` 的通用行为（野怪、据点、驻守玩家都共用），确认弹窗只在建造链路拦截。

### 14.5 A1 已落地（2026-11-11）

**主按钮改两段式**，不用弹窗：

| 状态 | 主按钮文案 | 点击行为 |
| --- | --- | --- |
| 常态（建造中） | `取消建造` | → 进入确认态 |
| 确认态（建造中） | `确认取消？` | → 发 `primary`（真取消） |
| 常态（已建成） | `升级` | → 进入确认态 |
| 确认态（已建成） | `确认升级？` | → 发 `primary`（真扣资源） |

**为什么不用居中确认弹窗**：

- `BigMapInfoPopup` 的 `onSecondary` 会发 `secondary` intent，建造中卡片 `secondary` 为 `null`，
  控制器那条分支行为不确定，贸然复用有误触风险；
- 弹窗会遮住地图，打断「连着升好几座」的节奏 —— 而这正是贴底卡存在的理由；
- 就地改文案**零新增 UI 节点、零新增意图**，控制器完全不用改。

**确认态自动复位**（不需要定时器）：

- 换选中 / 等级变化 → `render` 里比对 `name` + `level`，不一致就清；
- 收卡（`content === null`）→ 清；
- 再点一次 → 执行并清。

**关键坑**：`render` 每 500ms 全量跑一遍，会把 `确认取消？` 冲回 `取消建造` ——
所以 `render` 里必须让确认态优先，不能用常规 `renderAction` 覆盖。

判据：`tests/bigmap-page-prefab.test.ts`「建筑卡主按钮两段式」——
断言有确认态、有两条确认文案、`handlePrimary` 不能一进来就发意图、`render` 里确认态优先。

全量 **508 用例全绿**（286 + 222），`tsc` 对 bigmap 源码 0 错误。

### 14.6 下一项

**A2（队列行结构化）**：`QueueStatus` 540×38 里现在是一个 Label 拼三块信息，
窄屏会截断，且没有「点一下看详情」的落点。改 prefab 拆成「槽位点 × N + 文本」，
顺带把 P1-7 的进度环接进去。要动 `bigmap-page-bindings` 的断言。

### 14.7 修一个崩溃：`BigMapPanel.background` 被 MCP 另存丢了

**现象**：打开建造目录时报
`TypeError: Cannot set properties of null (setting 'color')` at `BigMapPanel.redraw` ← `onEnable`
← `PopupManager` 把弹窗 `setParent` 到层上（激活整棵子树）。

**根因**：`prefab_lifecycle create` 另存 `BuildPanel` 时，**组件引用会丢**（`background` 变 `null`），
而 `BigMapPanel` 挂在 `@executeInEditMode` 上，`onEnable → redraw` 直接 `this.background.color = ...` 裸取。

`onValidate` 里本来就写了 `if (this.background)`，**`onEnable` 漏判** —— 实现不一致才是这次崩的根。

**两层修复**：

1. `redraw()` 加 `if (!this.background) return;`（引用丢失是常态，不能假设 Inspector 一定绑好）；
2. 新 prefab 的 `BigMapPanel.background` 重绑到自己的 `Sprite`（`fill = 72,73,83,232`，与原面板一致）。

**守卫**：`tests/bigmap-page-prefab.test.ts`「底板代理的 background 必须绑上」——
扫 `BigMapPage.prefab` 与 `BigMapBuildMenuPopup.prefab` 里所有 `BigMapPanel`，
`background` 必须非空且目标类型是 `cc.Sprite`；同时断言 `redraw` 里有判空。

> 这条和 13.4 的第 2 点同源：**MCP 另存 prefab 会丢组件引用**，这次丢的是别的脚本的字段，
> 所以「搬完 prefab 必须逐个核对所有 `@property` 引用」不是只针对新组件，是**整棵子树**。

全量 **509 用例全绿**（286 + 223）。

### 14.8 A2 已落地：队列行拆成「槽位点 × 3 + 摘要文本」

**改前**：`QueueStatus`（540×38）里只有一个 Label，拼
`建造队列 1/1 · 粮食田→Lv.3 120s · 待解锁 1` —— 三块信息挤一行，窄屏必截断。

**改后**：

```
QueueStatus 540×38
├── QueueSlot0/1/2   72×32  Sprite(FILLED)     ← 三态：未解锁暗 / 建造中亮+进度 / 空闲中性
└── QueueText       296×30  Label              ← 「1/1 · 粮食田 Lv.3 02:00」
```

| 槽位状态 | 颜色 | `fillRange` |
| --- | --- | --- |
| 未解锁 | `cardDeep` | 1 |
| 建造中 | `cardLight` | `progress`（下限 0.02，刚开工也不至于看不见） |
| 空闲 | `muted` | 1 |

「待解锁 N 条」不再写进文字 —— 暗色槽位本身就是提示。

### 14.9 这批踩的三个 MCP 坑

1. **`@property` 数组设不上**：`Sprite[]` / `Node[]` 都试过，`properties` 批量模式的 `nodeArray` 报
   `Cannot read properties of undefined (reading 'hasOwnProperty')`，单属性模式同样报。
   ⇒ 保留 `@property({ type: [Node] }) queueSlotNodes` 供 Inspector 手工绑，
   代码里 `queueSlotList()` 在绑定为空时按固定子节点名兜底（这三个槽位不会增删）。
2. **`QueueText` 带 Widget 时会被重算成 0 宽**：把 `alignFlags` 从 56（撑满）改成 32（只右对齐）后，
   `save` 按 `left/right` 重算写回 `0×30`。⇒ 直接删掉 Widget，`contentSize` 写死 296×30 + 固定 `lpos`。
3. **`asset_system refresh` 会让 prefab 编辑模式失效**：refresh 之后 `find_by_name` 报
   `Node not found`，必须重新 `enter`。

判据：`tests/bigmap-page-prefab.test.ts`「建造队列拆成槽位点 + 摘要文本」——
三个槽位存在、都是 `FILLED`（`_type=3`）、高 32、摘要文本不再挂 Widget。

全量 **509 用例全绿**（286 + 223）。

---

## 15. 第二批落地：A3 资源反馈 / B1 长按拖动 / C1 引导（P1-9、P1-10、P2-15）

本批只做客户端可独立闭环的部分：A3、B1 完成；C1 因策划目标链缺失保持阻塞，不编造目标链、不先做会返工的框架。

### 15.1 A3 资源变化反馈（P1-9，中）——复用主界面 elapsed 曲线，禁止 tween

现状：大地图顶部资源条只有 5 个 Value Label，`refreshHeader` 每次 render 全量写 string+color，
无 update 心跳、无反馈曲线，扣费只靠 Toast。主界面已有零引擎依赖的纯函数 `MainResBarFeedback`（无 import），
其视图 `MainResBarSlot` 记 elapsed、每帧取 fx 写节点。

**复用曲线、不重复算法**：新建普通类 `BigMapResourceFeedback`（非 Component——bigmap 资源条只有 Label，
无法复用带 icon/plus/bg 的 `MainResBarSlot`），命中/扣除/飘字曲线全部直接调用 `MainResBarFeedback` 纯函数，
本类只做「记 elapsed → 取 fx → 写 Label」。

- `sync(amount, hitAmount, spendAmount)`：直接持有**原始 amount 整数**（Label 文本带 K 后缀无法反解析），
  滚动 from/to 用原始整数，落文本再走 K 格式化（`formatBigMapResourceAmount`）。
- `step(dt)`：累计 elapsed，按 `resBarHitFx / resBarSpendFx / resBarSpendFlashColor / resBarSpendFloatFx`
  取当前值写 Label（数字滚动 + 白闪 + 飘字）；`cancel()` 归位、`isPlaying` 报在播。
- `BigMapPageLayout` 加 `update(dt)` 心跳：无反馈在播直接返回不空转；懒建反馈数组；
  常态文本抽成 `steadyResourceText()`。

**飘字节点（关键约束）**：prefab 守卫禁止 bigmap/view 出现 `new Node(`/`.addComponent(`，
且 `ResourceItem` 直接子节点被断言恰为 `['Icon','Value']`、自身带 `cc.Layout`（飘字挂其下会被纳入水平排列挤动 Icon/Value）。
最终把 5 个 `SpendFloat` 预置在各自的 **Value 节点下**（Value 只有 UITransform+Label+Widget、无 Layout，不会重排；
飘字作为子节点跟随 Value）。构造函数 `label.node.getChildByName('SpendFloat')` 查找，
坐标用 Value 局部系（`floatX=0`、`floatStartY=valueHeight/2+FLOAT_GAP`），首次使用 copyTypography + 描边；
节点缺失则静默降级为不飘字，白闪/滚动主反馈不受影响。`ResourceItem` 直接子节点仍是 Icon/Value，现有守卫无需改动。

判据：`tests/bigmap-resource-feedback.test.ts`（7 用例）——命中白闪、扣除滚动 + 钉住 0.34s 先跳再扣、
飘字上浮淡出、K 格式化、节点缺失降级、cancel 归位。

### 15.2 B1 长按拖动移建（P1-10，高）——规则在 Model、手势在 View、三态状态机

**规则在 Model、手势在 View、复用现有 requestMove 写链路**：

- Model 新增 `moveableHexIds(instanceId)`：逐空格跑 `bigMapCanMove`，原格被规则判 false 不在内。
- `BigMapViewState` 加 `moveableHexIds` 字段，在 `pendingMoveInstanceId≠0` 时计算。
- 新增 `moveBegin` intent；controller 的 `beginMove(instanceId)` 直接把 pendingMove 指向该实例（不要求先选中），
  与卡片「移动」按钮共用同一 pendingMove 状态，松手落点仍走 `selectPlot` 的 move 分支。

**手势状态机（`BigMapBaseView`，idle / press / dragging）**：

- `onTouchStart` 起 press 候选：命中只认 icon 且配置 `canMove`。
- update 累计 `pressElapsed` 到 `LONG_PRESS_SECONDS=0.4s` 触发 dragging：乐观显示 ghost 并 emit `moveBegin`。
- dragging 态单指 `moveGhostTo` 跟手、不平移；松手落点在 moveable 内才 `tapPlot`。
- **仲裁**：press 态累计移动超 `LONG_PRESS_MOVE_LIMIT=12px`（与点选/平移共用阈值）即 cancelPress 改走平移；
  双指介入取消；短按松手仍是普通点选。

判据：`tests/bigmap-base-view.test.ts`（12 用例，含 6 个长按手势）+
`tests/bigmap-controller.test.ts`（20 用例，含 moveBegin 入口专项：进入/取消/不存在实例、moveable 只含空格且不含原格）。

### 15.3 C1 引导（P2-15，中）——阻塞，等策划目标链

bigmap 模块内无任何 guide/task/quest 状态或数据：`baseBuildInfo` 只是建筑表的纯描述文本，
`canMove` 是建筑配置，`BigMapUnlock` 是章节解锁判定（只回答能不能解锁，不回答下一步做什么）。
协议层 `CmdGuide` 已预留读写通道（`CmdGuideReadReq/Rsp`、`CmdGuideRecordReq`），
但 `CmdGuideDetail` 字段高度泛化（仅 `extend:string / resId:number / type:number`），
无目标链步骤顺序、目标动作、完成条件、UI 锚点语义，且全工程无业务代码消费。

**结论：策划目标链与服务端实现到位前客户端先做会返工，C1 保持阻塞，不编造目标链、不先做可配置框架。**
解锁条件：策划提供有序目标链 + 补齐 `CmdGuideDetail` 语义（步骤/动作/完成条件/UI 锚点）+ 服务端读写实现。

### 15.4 验证

- bigmap 全量 **65 文件 531 用例全绿**（含 A3 新增 7、B1 手势新增 6 与 controller 专项）。
- `npx tsc --noEmit` **零错误**。
- 全工程 `npm test`：5716 用例，5609 过、107 失败。107 个失败**全部**位于 zcds-*（绝大多数）、
  auto-atlas-topology、map-editor-*，**无一个 bigmap 文件**；单独跑这些文件同样失败（稳定基线，非全量并发偶发），
  原因是各模块自身的历史改动/配表/预设（如 battle 特效目录未配 auto-atlas、zcds `corset.json` 缺类型 8），
  且 zcds 源码不引用 bigmap。本次源码改动全部位于 bigmap 模块，**零新增失败**。
