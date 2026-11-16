# BigMap 目录代码优化改动清单

> 状态：改动记录（2026-11）。记录本轮已执行的等价简化与删除项，供追溯；当前代码为准，不作为待办。

- 范围：`assets/script/app/bigmap`，23 个源码文件修改 + 1 个组件文件删除（另删除同名 `.meta`）。
- 原则：只做等价简化、死代码清理和规范修正，不改变运行逻辑；被测试或契约锁定的“看似冗余”代码不删。
- 工作区里 territory、guide、prefab、tools 等其他未提交改动均未触碰。
- 代码量：本次改动集剔除工作区既有的 `view/BigMapPageLayout.ts` 后为 `+117 / -327`（25 个文件，含删除的 `BigMapTargetPanel.ts` 与 `.meta`）。`git diff --stat` 当前显示 26 个文件 / `+124 / -333`，其中 `BigMapPageLayout.ts` 的 `7+ / 6-` 是本轮开始前就存在的工作区未提交改动，不计入本次。

## 一、逐处改动

### application

#### `application/BigMapArtLoader.ts`

- **L9 / L12（import 区）**
  - 改动：把 `toBigMapArtPath` 并入 `BigMapArtCatalog` 的主 import，删除单独的 `export { ... }` 与重复 import。
  - 依据：同一模块被 import 两次、且 re-export 没有任何外部消费方（全仓精确 grep 为 0）；合并后引用关系更直接。

#### `application/BigMapCampRepository.ts`

- **L169 `applyRoleEvent`**
  - 改动：`if (this.isDisposed || !event) return false;` → `if (this.isDisposed) return false;`。
  - 依据：`event: IBigMapRoleEvent` 是非空参数，6 处测试调用都传入真实事件；`!event` 分支不可达。

#### `application/BigMapConfigLoader.ts`

- **L3（import 区）**
  - 改动：删除未使用的 `type BigMapRawTables`。
  - 依据：类型只被下方已删除的包装函数使用，现文件内无引用。
- **L61（文件末尾，原 L62–L66）**
  - 改动：删除 `loadBigMapConfigFromTables(tables)`。
  - 依据：该导出是 `parseBigMapConfig` 的一层纯转发，全仓零引用；编辑器/测试走 `ConfigService` 的既有加载链。

#### `application/BigMapEntry.ts`

- **L25–L44（import 与常量区）**
  - 改动：把 `BIGMAP_PAGE_HOST_PREFAB` 及其 JSDoc 从 import 列表中间移到全部 import 之后。
  - 依据：常量插在 import 中间破坏模块头部“先 import 后声明”的分组，纯结构调整。
- **L134 `root.getComponent(UITransform)`**
  - 改动：删除非空断言 `!`。
  - 依据：`BigMapPageHost` prefab 必带 `UITransform`，项目规范禁止 `getComponent(X)!`。
- **L156（`else` 分支）**
  - 改动：删除 `if (!canvas) return;`。
  - 依据：L123 的 `if (!host && !canvas) return` 已保证进入 `else` 时 `canvas` 非空，该判断不可达。
- **L234 `UIOpacity` / L236 `BigMapPage`**
  - 改动：删除两处 `getComponent(...)!`。
  - 依据：同样是宿主 prefab 的必绑组件，类型由 prefab 保证，非空断言属于多余防御。

#### `application/BigMapModel.ts`

- **L488–L502（`buildingIdOfQueueAt` / `buildingNameOfQueueAt`）**
  - 改动：删除错位在 `buildingIdOfQueueAt` 上方的“建筑名”JSDoc，移到真正对应的 `buildingNameOfQueueAt`。
  - 依据：原注释与函数语义不符，属于复制粘贴造成的错位。
- **L742 `queueUnlockInfo`**
  - 改动：`cost: affordable || Number.isFinite(cost) ? cost : 0` → `cost: Number.isFinite(cost) ? cost : 0`。
  - 依据：`affordable` 的定义已包含 `Number.isFinite(cost)` 且 `cost > 0`；`affordable` 为真时 `cost` 必为有限数，结果完全等价。
- **L759 `mainLevel`**
  - 改动：把挤在同一行的 `return` 拆成标准两行。
  - 依据：格式规范，无逻辑变化。
- **L1163 `refreshCampDetail`**
  - 改动：两条连续早退 `if (this.isDisposed) return;` / `if (!repository) return;` 合并为一条 `if (this.isDisposed || !repository) return;`。
  - 依据：两条之间没有任何语句或注释，合并后顺序与结果一致。
- **L1456 `requestAttackMonster`**
  - 改动：`if (!view?.canAttack) return { ..., message: view?.attackReason || ... }` 拆成 `if (!view)` 与 `if (!view.canAttack)` 两段显式判断。
  - 依据：`view` 为空与“存在但不可攻击”在旧代码里共用一条消息；拆分后不可达分支仍返回 `monsterUnavailable`，可攻击分支保留 `attackReason`，行为一致且消除 `?.` 防御。

#### `application/BigMapStorage.ts`

- **L5（原 L6–L7）**
  - 改动：删除 `export { BIGMAP_SAVE_KEY, createMemoryBigMapStorage } from './BigMapSaveKeys';`。
  - 依据：全仓没有从 `BigMapStorage` 导入这两个符号的代码；测试统一从 `BigMapSaveKeys` 导入。文件内真正使用的 import 保留。

#### `application/NpcBigMapRankProvider.ts`

- **L4–L5（文件头注释）**
  - 改动：把“联机版应当平级再写一个 `RemoteBigMapRankProvider`”改为“联机版由 `RemoteBigMapRankProvider` 走服务器接口，两边共用同一套视图字段”。
  - 依据：该 Provider 已经存在，旧注释是过期计划，会误导后续维护。

### model

#### `model/BigMapBase.ts`

- **L19（import 区）**
  - 改动：删除未使用的 `type IBigMapBuildingConfig`。
  - 依据：仅被下方已删除的 `bigMapBuildingConfig` 使用。
- **L147–L149 `bigMapClampQueueUnlocked` JSDoc**
  - 改动：删除“初始 1 条、每建一座队列建筑 +1、由建筑反推”的旧说明，改为“把存档 `queueUnlocked` 收口到 `[initBuildQueue, maxBuildQueue]`；真源只有存档字段，由 `bigMapUnlockQueue` 推进”。
  - 依据：函数实际只对存档值做 clamp，并不扫描建筑；旧注释与实现不符。
- **L679（文件末尾，原 L683–L695）**
  - 改动：删除 `bigMapBuildingName`、`bigMapBuildingConfig` 两个导出。
  - 依据：全仓零引用；调用方直接读 `config.buildings`，这两个函数只是重复封装。

#### `model/BigMapBattle.ts`

- **L16 / L19（import 区）**
  - 改动：删除未使用的 `BigMapQueueState`、`type IBigMapCitySite`。
  - 依据：只服务于下方已删除的两个导出。
- **L35 `BIGMAP_BATTLE_TEXT`**
  - 改动：删除 `campUnavailable` 文案键。
  - 依据：全仓零引用；据点不可攻的实际分支使用 `campMissing` / `campOccupied` 等既有键。
- **L300 `bigMapMonsterAttackPreview`**
  - 改动：删除空语句 `void monster;`。
  - 依据：`monster` 参数不参与该函数计算，`void` 只是强行消除“未使用参数”的写法，没有运行效果。
- **L393（文件末尾，原 L398–L407）**
  - 改动：删除 `bigMapHasActiveQueue`、`bigMapCityAnchor`。
  - 依据：全仓零引用；前者只是 `queues.some` 的一行包装，后者只是读 `anchorHexId` 的转发。

#### `model/BigMapCampInfo.ts`

- **L44（原 L45–L46）**
  - 改动：删除 `BIGMAP_CAMP_OCCUPATION_TEXT`。
  - 依据：全仓零引用，界面使用自己的占领态文案。

#### `model/BigMapUnlock.ts`

- **L15（import 区）**
  - 改动：删除 `BigMapCityLayer` import。
  - 依据：只被下方已删除的函数使用。
- **L186（文件末尾，原 L188–L197）**
  - 改动：删除 `bigMapCityLayerName`。
  - 依据：全仓零引用；层级展示名已由其它界面自行映射。

### view

#### `view/BigMapBasePlot.ts`

- **L7、L21–L26（`@property` 区）**
  - 改动：`Sprite = null` / `Graphics = null` / `UITransform = null` / `Label = null` → `null!`。
  - 依据：均为 prefab 必绑 Inspector 引用，按项目规范用 `null!` 表达“运行时必存在”。

#### `view/BigMapBaseView.ts`

- **L40–L46（必填 `@property`）**
  - 改动：`UITransform` / `Sprite` / `Node` 等必填引用由 `= null` 改为 `= null!`。
  - 依据：同上，prefab 必绑。
- **L56–L57 `plotGhost` / `plotGhostOpacity`**
  - 改动：类型改为 `Sprite | null` / `UIOpacity | null`。
  - 依据：这两个是可选的表现节点，代码里已有 `if (this.plotGhost && this.plotGhostOpacity)` 判空，应表达为真可空。
- **L245（原 L246–L249）**
  - 改动：删除 `get selected()` 与 `get pending()`。
  - 依据：两处在 `assets/script`、`tests` 中均零引用；`pendingBuildingId` 仍有 `setPendingBuilding`/内部刷新使用，删除的只是对外转发 getter。

#### `view/BigMapBuildMenuPopup.ts`

- **L67 `render`**
  - 改动：删除 `if (!row) return;`。
  - 依据：上一行在 `this.rows.length !== content.rows.length` 时已 `rebuildRows`，长度对齐后 `this.rows[index]` 必然存在。
- **L86–L88 `rebuildRows`**
  - 改动：`node.getChildByName('Name')?.getComponent(Label) ?? null!` 等三处改为直接访问。
  - 依据：行模板 prefab 必带 `Name` / `Detail` 子节点和 `Sprite`；`?? null!` 是既掩盖错误又伪造非空的写法，按规范改为直接访问。

#### `view/BigMapCityPopup.ts`

- **L115–L129（`@property` 区）**
  - 改动：`warScoreLabel`、`warScoreFillTransform`、`lordNameLabel`、`lordScoreLabel`、`lordPerson`、`fightButton`、`fightLabel`、`staminaLabel`、`staminaIcon` 由 `= null` 改为 `= null!`。
  - 依据：全部是 prefab 必绑引用；统一为项目约定的 `null!`。

#### `view/BigMapPage.ts`

- **L200 `buildBaseArea`**
  - 改动：`const rect = ...; this.layout.buildBase(data, rect);` 合并为 `this.layout.buildBase(data, this.worldAreaRect(width, height));`。
  - 依据：临时变量只用一次，合并后调用参数与顺序不变。该方法被 `tests/bigmap-page-bindings.test.ts` 直接调用，签名保持 `(data, width, height)` 不变。
- **L212（`sendIntent` 下方，原 L215–L216）**
  - 改动：删除 `onWorldTap` / `onPlotTap` 两个转发方法。
  - 依据：生产代码、prefab、scene 均无调用；只有两份测试调用。测试已改为直接调用 `sendIntent`，仍覆盖 `ready` / `enteringBattle` 门控，故删除。
- **L276（建造目录 `onClose` 注释）**
  - 改动：把三行重复解释合并为一句“`Force` 是页面自己收，不在此列”。
  - 依据：原文重复描述“状态必须跟着关”，信息密度低；保留关键例外，行为说明不丢。
- **L477 `buildInfoPopupContent`**
  - 改动：删除 `this.mode === 'world' &&`。
  - 依据：L476 已在 `mode === 'base'` 时提前返回，能走到 L477 只可能是 `world`。
- **L540 `loadRolePortrait` catch**
  - 改动：单行 `catch` 展开为标准三行。
  - 依据：与文件内其他 `catch` 格式统一，无逻辑变化。

#### `view/BigMapPlotCard.ts`

- **L91 `paintBackground`**
  - 改动：删除 `if (!transform) return;`。
  - 依据：卡片节点是 UI prefab 节点，必带 `UITransform`；该判断不可达。
- **L125（原 L127–L129）**
  - 改动：删除 `get rendered()`。
  - 依据：全仓零引用；页面侧不再通过该 getter 取展示数据。
- **L144 `handlePrimary`**
  - 改动：`if (!content?.primary || !content.primary.enabled) return;` → `if (!content || !content.primary) return;`。
  - 依据：`renderAction` 已把 `primary.enabled` 写进 `Button.interactable`，禁用态按钮不会触发 CLICK；handler 再判一次属于重复防御。`confirmPending` / `确认取消？` / `确认升级？` 等测试守卫均保留。

#### `view/BigMapPresentationText.ts`

- **L51（原 L52–L54）、L64（原 L68–L70）、L66（原 L73–L74）**
  - 改动：删除 `harvestAll`、`build`、`buildMenu`、`queue`、`queueLocked`、`enteringBattle` 六个文案键。
  - 依据：精确 grep `BIGMAP_PRESENTATION_TEXT.<key>` 全为 0；对应界面已直接使用其它常量或动态文案。

#### `view/BigMapResourceFeedback.ts`

- **L44（字段注释）**
  - 改动：`//增加：命中（labelScale + 数字滚动）` → `//命中：Label 缩放 + 数字滚动`。
  - 依据：去掉补丁式“增加：”前缀，注释直接说明用途。
- **L76 `floatLabel`**
  - 改动：`floatNode?.getComponent(Label) ?? null` → `floatNode ? floatNode.getComponent(Label) : null`。
  - 依据：两者等价；条件表达式比可选链加空值合并更直白。
- **L225 `prepareFloat`**
  - 改动：`node.getComponent(UITransform)?.setAnchorPoint(0.5, 0)` → 直接调用。
  - 依据：飘字节点由 prefab 预置且带 `UITransform`，可选链只会掩盖缺组件问题。

- **L64–L72 构造器**
  - 改动：`label.node.scale.x ?? 1` / `position.y ?? 0` / `color?.r ?? 255` 等 6 处兜底改为直接读取 `scale.x`、`position.y`、`color.r/g/b/a`。
  - 依据：`Label.color`、`Node.scale`、`Node.position` 都是引擎必填字段；唯一缺字段的是测试桩，已给 `tests/bigmap-page-bindings.test.ts` 的 `Label` 补上 `color`，不再需要生产代码兜底。

#### `view/BigMapSkin.ts`

- **L9（原 L10–L11）**
  - 改动：删除已废弃的 `BIGMAP_SKIN_COLORS.cyan`。
  - 依据：全仓零引用；注释本身已说明它对比度不足、被 `selectOuter` 双环替代。

#### `view/BigMapTheme.ts`

- **L1（import 区）**
  - 改动：删除 `Graphics` import。
  - 依据：只被下方已删除的 `drawPanel` 使用。
- **L53（原 L54–L56）**
  - 改动：删除 `BIGMAP_EDGE_DARK`。
  - 依据：全仓零引用，注释也说明 `drawPanel` 不画它，实际由 prefab 九宫负责。
- **L128（原 L132–L152）**
  - 改动：删除 `drawPanel`。
  - 依据：全仓零引用；现有面板全部走 prefab / 其它绘制函数，该函数是遗留封装。

#### `view/BigMapWorldMarker.ts`

- **L29–L43（`@property` 区）**
  - 改动：`icon`、`badge`、`label`、`nameLabel`、`badgeBackground`、`occupantRoot`、`occupantFlag`、`occupantLabel`、`portraitRoot`、`portrait` 全部由 `= null` 改为 `= null!`。
  - 依据：均为标记 prefab 的必绑引用，统一按项目规范表达。

#### `view/BigMapWorldView.ts`

- **L15（import 区）**
  - 改动：删除 `BIGMAP_COLUMN_STEP`、`BIGMAP_ROW_STEP`。
  - 依据：只被下方已删除的三个 `WORLD_*` 导出使用。
- **L32（原 L33–L35）**
  - 改动：删除 `WORLD_HEX_SIZE`、`WORLD_COL_STEP`、`WORLD_ROW_STEP`。
  - 依据：全仓零引用；外部统一从 `BigMapWorldLayout` 取布局常量。
- **L127–L146（`@property` 与模板字段）**
  - 改动：`rootTransform`、`viewport`、`viewportTransform`、`content`、`background`、`sand`、`sandTransform`、`terrainLayer`、`tileLayer`、`decorLayer`、`markerLayer`、`iconLayer`、`templatesPrefab`、`zoomInButton`、`zoomOutButton`、`focusButton` 及 `groundTemplate` / `decorTemplate` / `markerTemplate` 改为 `null!`。
  - 依据：前一组是 prefab 必绑 Inspector 引用；后一组在 `ensureTemplates()` 中必然赋值后才使用。
- **L214 `ensureTemplates`**
  - 改动：删除 `as BigMapWorldTemplates` 断言。
  - 依据：`getComponent(BigMapWorldTemplates)` 的泛型返回值已经是该类型，断言重复。
- **L242–L248 `render`**
  - 改动：嵌套三元 `cityId > 0 ? ... : monsterId > 0 ? ... : selectedBaseHexId` 改为 `let selectedHexId = selectedBaseHexId` + `if / else if`。
  - 依据：三个分支优先级与赋值结果完全一致，改为显式分支便于阅读。
- **L845 `cullMarkers`**
  - 改动：`(hitArea.height ?? 0) / 2` → `hitArea.height / 2`。
  - 依据：`IBigMapMarkerHitArea.height` 是必填字段，生产标记必有值；只有两份测试夹具漏填，已补 `height`。
- **L936（原 L937，`onTouchStart` 前）**
  - 改动：删除 `get currentZoom()`。
  - 依据：全仓零引用；内部直接读 `this.zoom`。
- **L1009（原 L1011）**
  - 改动：删除 `get selected()`。
  - 依据：全仓零引用；测试与页面都直接读 `selectedHexId`。

## 二、零引用导出清理（11 个）

以下符号均先通过 `assets/script` + `tests` 全量引用扫描，再按精确 grep 复核为 0，随后删除：

| # | 符号 | 原位置 |
|---|---|---|
| 1 | `loadBigMapConfigFromTables` | `application/BigMapConfigLoader.ts` 文件末尾 |
| 2 | `bigMapBuildingName` | `model/BigMapBase.ts` 文件末尾 |
| 3 | `bigMapBuildingConfig` | `model/BigMapBase.ts` 文件末尾 |
| 4 | `bigMapHasActiveQueue` | `model/BigMapBattle.ts` 文件末尾 |
| 5 | `bigMapCityAnchor` | `model/BigMapBattle.ts` 文件末尾 |
| 6 | `BIGMAP_CAMP_OCCUPATION_TEXT` | `model/BigMapCampInfo.ts` L45 附近 |
| 7 | `bigMapCityLayerName` | `model/BigMapUnlock.ts` 文件末尾 |
| 8 | `BIGMAP_EDGE_DARK` | `view/BigMapTheme.ts` L54 附近 |
| 9 | `WORLD_HEX_SIZE` | `view/BigMapWorldView.ts` L33 附近 |
| 10 | `WORLD_COL_STEP` | `view/BigMapWorldView.ts` L34 附近 |
| 11 | `WORLD_ROW_STEP` | `view/BigMapWorldView.ts` L35 附近 |

另外删除的零引用成员/文案：`BigMapPlotCard.rendered`、`BigMapWorldView.currentZoom`、`BigMapWorldView.selected`、`BigMapBaseView.selected`、`BIGMAP_BATTLE_TEXT.campUnavailable`、`BIGMAP_PRESENTATION_TEXT` 六个键、`BIGMAP_SKIN_COLORS.cyan`、`BigMapTheme.drawPanel`。

## 三、保留项复核结论（逐项重审）

本轮没有沿用上一轮的“保留”决定，而是按“生产调用链 → 测试引用 → prefab/scene UUID → 类型契约”重新核了一遍。

| # | 原“看似冗余”项 | 复核证据 | 最终结论 |
|---|---|---|---|
| 1 | `BigMapPage.onWorldTap` / `onPlotTap` | `assets/script`、`prefab`、`scene` 中零调用；仅 `bigmap-battle-enter-mask`、`bigmap-camp-view` 两份测试调用 | **可删除，已删除**；测试改为直接调用仍在生产使用的 `sendIntent`，门控覆盖不变 |
| 2 | `BigMapTargetPanel.handlePrimary` 的 `interactable` 判断 | 类在 `assets/script` 无 import、无 `addComponent`、无 prefab/scene UUID 引用；仅自己的测试文件使用 | **整类为死代码，已删除** `BigMapTargetPanel.ts`、`.meta` 及测试；文档中的类名同步去掉 |
| 3 | `BigMapPlotCard.confirmPending` / 二次确认文案 | `render`、`handlePrimary` 均在生产路径使用；`bigmap-page-prefab` 源码守卫锁定 | **必须保留**。取消建造/升级会真实扣资源或丢建造时间，二次确认是业务规则，不是防御 |
| 4 | `BigMapPage.buildWorldArea` / `buildBaseArea` 签名 | `buildUi` 生产路径同时调用两者；`bigmap-page-bindings` 也直接调用 | **必须保留**。这是页面装配的真实入口，不是测试专用包装 |
| 5 | `BigMapWorldView` 的 `hitArea.height ?? 0` | `IBigMapMarkerHitArea.height` 为必填；生产 `BigMapWorldMarker` 始终写值；仅两份测试夹具漏填 | **可删除，已删除**；给 `bigmap-focus-city` / `bigmap-camp-view` 夹具补 `height`，不再让生产代码替测试桩兜底 |
| 6 | `BigMapResourceFeedback` 构造器的 `?? 1 / ?? 0 / ?? 255 / color?.` | `Label.color`、`Node.scale`、`Node.position` 均为引擎必填；唯一缺 `color` 的是 `bigmap-page-bindings` 的 Label 桩 | **可删除，已删除**；给该测试桩补 `color`，生产代码直接读取真实字段 |
| 7 | `BigMapModel.refreshCityRank` 的 `!board` | `IBigMapRankProvider.fetchCityRank` 明确返回 `Promise<IBigMapCityRankBoard \| null>`；`RemoteBigMapRankProvider` 在 disposed / 非当前角色 / 断线时返回 `null` | **必须保留**。没有该判断会把 `null` 写进 `rankBoards`，后续同步读榜会拿到空对象 |
| 8 | `BigMapBaseView.pending` getter | `assets/script` 与 `tests` 均零引用；`pendingBuildingId` 仍由 `setPendingBuilding` 和内部刷新使用 | **可删除，已删除**。之前“被 BigMapPageLayout 使用”的判断是错的，复核后确认无消费方 |

### 审核范围与确认依据

- **审核范围**：上述 8 项，以及它们涉及的生产文件、4 份测试夹具、`BigMapTargetPanel` 的 `.meta`、`docs/bigmap-系统实现说明.md` 中的相关描述。
- **生产引用**：逐符号 grep `assets/script/app`，再扩到 `assets` 的 `.prefab` / `.scene`。
- **隐式依赖**：对删除的类额外查了脚本 UUID `f3e6e16f-9ddb-46d4-8200-f72aa8dd14e9`，全仓只命中 `.meta` 自身；确认没有 prefab/scene 通过 UUID 挂载。
- **测试引用**：逐文件查看调用点与断言，区分“测试直接调用死代码”与“测试验证生产入口”；前者改测试，后者保留代码。
- **类型契约**：核对 `IBigMapMarkerHitArea`、`IBigMapRankProvider`、`Label`/`Node` 的必填字段，确认哪些兜底是生产必需、哪些只是测试桩缺失。
- **多次复核**：同一项至少经过“初次 grep → 删除后全仓 grep → 全量测试”三次检查；删除 `onWorldTap`/`onPlotTap`、`BigMapTargetPanel`、`pending` 后均再次确认零引用。

## 四、验证

### 1. bigmap 测试

```powershell
$files = Get-ChildItem -LiteralPath "D:\City1001\Demo3.8\tests" -Filter "bigmap-*.test.ts" | Select-Object -ExpandProperty FullName
npx tsx --test @files
```

结果：`tests 535 / pass 535 / fail 0`，退出码 `0`（65 个测试文件全部执行）。

> 说明：这是删除完成时的首次全量结果。最终清理临时恢复组件后重跑为 `65 文件 / 533 用例 / 532 通过 / 1 失败`，失败点为 `tests/bigmap-hud-skin.test.ts:234` 的源码守卫——它仍断言旧常量 `MODE_ICON_SIZE`，而工作区中已有的 `BigMapPageLayout.ts` 未提交改动已把该常量改为 `@property modeIconSize`。该失败与本次删除/简化无直接关系，详见 §6.3。

本轮为配合死代码删除与兜底清理，同步调整了 4 份测试夹具/调用点：

- `tests/bigmap-battle-enter-mask.test.ts`：改调 `sendIntent`，不再依赖已删除的 `onWorldTap/onPlotTap`。
- `tests/bigmap-camp-view.test.ts`：同上；标记夹具补 `hitArea.height`。
- `tests/bigmap-focus-city.test.ts`：标记夹具补 `hitArea.height`。
- `tests/bigmap-page-bindings.test.ts`：Label 桩补 `color`。
- 删除 `tests/bigmap-target-panel.test.ts`（被测类已整体删除）。

### 2. TypeScript 检查

```powershell
npx tsc --noEmit -p "temp\tsconfig.cocos.json"
```

结果：退出码 `2`，但仅 4 条既有环境错误 `TS2688 Cannot find type definition file for './temp/declarations/cc'`（以及 `cc.custom-macro`、`cc.env`、`jsb`），与本次改动无关；过滤 `bigmap` 后错误数为 **0**。

### 3. 空白/补丁检查

```powershell
git -C "D:\City1001\Demo3.8" diff --check
```

结果：退出码 `0`，无空白错误；仅有工作区既有的 CRLF 提示。

### 4. 未覆盖项

- 未运行全仓非 bigmap 测试（工作区存在 territory、guide 等大量未提交改动，可能带有基线问题）。
- 未做真机/编辑器内的 prefab 挂载验证；`null!` 与组件直接访问依赖 prefab 既有绑定，已由 bigmap 测试与源码守卫覆盖。
- `BigMapTargetPanel` 的删除依据仅覆盖本仓库：已在 `assets` 的 `.ts` / `.prefab` / `.scene` 中确认无 import、无 `addComponent`、无 UUID 引用；若该脚本被仓库外工程复用，需另行确认。

## 五、改动汇总

- 代码文件：**23 个修改 + 1 个删除**（`BigMapTargetPanel.ts`，另删除同名 `.meta`）；测试 4 改 1 删；文档 1 处类名同步。
- 删除死组件类：**1 个**（`BigMapTargetPanel`）。
- 删除零引用导出：**11 个**。
- 删除零引用成员/文案：**15 个**（5 个 getter、2 个转发方法、1 个绘制函数、1 个颜色常量、6 个文案键）。
- 删除不可达/重复判断：**6 处**（`!event`、`!canvas`、`!row`、`!transform`、`mode === 'world'`、`primary.enabled`）。
- 删除类型必填字段上的多余兜底：**7 处**（`hitArea.height ?? 0` 1 处；`BigMapResourceFeedback` 构造器 6 处）。
- 统一 Inspector 引用写法：**5 个文件**（`BigMapBasePlot`、`BigMapBaseView`、`BigMapCityPopup`、`BigMapWorldMarker`、`BigMapWorldView`）。
- 修正过期/错位注释：**4 处**（`BigMapBase` 队列容量、`NpcBigMapRankProvider` 联机实现、`BigMapModel` 建筑名 JSDoc、`BigMapPage` 建造目录关闭说明）。
- 审核后确认必须保留：**3 项**（`BigMapPlotCard` 二次确认、`BigMapPage.buildWorldArea/buildBaseArea`、`BigMapModel.refreshCityRank` 的 `!board`）。
- 行为变更：**0**。

## 六、本轮验收补充（2026-11-16）

本轮验收没有新增业务代码改动；只做了两件事：跑全量非 bigmap 测试，以及临时恢复 `BigMapTargetPanel` 做 prefab 挂载验证。验证结束后，临时恢复的组件和临时 prefab/scene 已全部删除。

### 6.1 非 bigmap 测试：未全绿

| 运行方式 | 文件 | 用例 | 通过 | 失败 | 结论 |
|---|---:|---:|---:|---:|---|
| 451 个非 bigmap 文件分 8 批跑 | 451 | 5508 | 5437 | 71 | 不通过 |
| 31 个失败文件合并重跑 | 31 | 653 | 583 | 70 | 至少 1 个批跑噪声 |
| 31 个失败文件逐文件隔离重跑 | 31 | 674 | 605 | 69 | 69 个可复现失败；2 个文件隔离后转绿 |

- 批跑失败分布在 31 个文件，主要是：`activity` 7、`itemdetail` 7、`zcds-hud-score-slot-size-tween` 6、`zcds-multi-target-falloff` 5、`iteminfo` 4、`new-treasure` 4、`playerinfo` 4、`chest-detail-speed-up` 3、`showreward` 3，其余 1–2 个/文件。
- 隔离后转绿的两个文件是 `battle-runtime-controller.test.ts`（26/26）与 `zcds-spawn-frame-report.test.ts`（3/3），说明批跑存在顺序/共享状态噪声；剩余 69 个失败在单文件隔离下仍稳定复现。
- 这些失败文件都不在本次改动集内（本次只改 bigmap 源码、bigmap 测试、bigmap 文档）。但**不能**据此断言它们全是旧基线：工作区里还有大量未提交改动，其中 `tests/activity.test.ts`、`tests/seven-day.test.ts` 等本身就是失败文件；`tmp/verify/baseline.json`（2026-11-09，5244 用例 / 97 失败）与 `docs/agent/测试基线红清单.md`（2026-11-13，5922 用例 / 20 失败）都已过期，当前 69 个失败名与旧基线只有 4 个重合。旧基线不能作为“相对基线零新增”的判据。
- 完整 69 条失败名见 `docs/design/bigmap-非bigmap测试失败清单.txt`。
- 因此：**“全部非 bigmap 测试通过”未达成**，且不能把 69 个失败归因为本次改动；它们属于当前工作区/既有代码的独立红项，需要单独归属和修复。

### 6.2 编辑器 prefab 挂载验证：组件可实例化/显示

验证步骤与结果：

1. 用 `git restore --source=HEAD --worktree` 临时恢复 `assets/script/app/bigmap/view/BigMapTargetPanel.ts` 与 `.meta`，刷新 asset-db 后确认类注册成功：`found:true`，class id `f3e6eFvndtG1IIA9yqo3RTp`。
2. 创建临时场景 `assets/__tmp_bigmap_validation__/Validation.scene`，补 Canvas + Camera，搭建 `BigMapTargetPanel` 所需引用树（root/panel/dim、title、headings、sections、tip、primary、primaryLabel、primaryBackground、cost、costIcon、costBackground、secondary、secondaryLabel、close）。
3. 调用 `initialize(720,1280)` 与 `render({...})`，运行时状态确认：
   - 组件类 `BigMapTargetPanel` 存在，节点 active=true，处于场景层级中；
   - 13 个 Inspector 引用全部已绑定（rootTransform/panelTransform/dimTransform/title/primary/primaryLabel/primaryBackground/cost/costIcon/costBackground/secondary/secondaryLabel/close）；
   - 标题=`据点详情`，headings=`名称 / 势力`，sections=`Lv.12 城池 / 可攻击`，tip=`消耗 20 体力，胜利后占领`，主按钮=`确认升级？`，cost=`20`，次按钮=`定位`；
   - 面板尺寸 600×800，主按钮 interactable=true。
4. 用该节点创建临时 prefab `assets/__tmp_bigmap_validation__/BigMapTargetPanelValidation.prefab`：序列化结果 valid=true，17 个节点、34 个组件、51 个 fileId；prefab 文件内包含组件类型 `f3e6eFvndtG1IIA9yqo3RTp` 及 `rootTransform`/`panelTransform` 引用。
5. 把 prefab 实例化到 Canvas 下，`inspect_prefab_instance` 返回 `linked:true`，实例 fileId `56QJlVqWRFfrEDa3Yer0n5`，资源 UUID `b4b161f5-c9b8-4db3-aff2-8810da9d661b`；实例上的组件与 13 个引用、标题/正文/按钮/费用文本再次全部通过运行时校验。Scene 视图截图显示面板与文字已绘制。

截图：`temp/mcp-captures/bigmap-target-panel-scene.png`（场景视图，1148×531）；裁剪放大版随本轮回复附上。

**语义边界（必须区分）**：这次验证证明的是“`BigMapTargetPanel` 作为组件本身可以被实例化、绑定引用并正常显示”，**不证明**工程里原本有 prefab/scene 在使用它。一个死代码组件同样可能“功能正常但无人引用”。因此它不能反证删除依据，也不能作为“应恢复该组件”的证据；只能说明若未来产品重新启用该弹窗，可以从历史版本恢复。

验证后的清理状态：

- 临时 prefab、临时 scene 已通过 asset-db 删除；`assets/__tmp_bigmap_validation__` 空目录已移除；
- 临时恢复的 `BigMapTargetPanel.ts` 与 `.meta` 已再次删除，`git status` 为 `D`；
- 刷新 asset-db 后 `cc.js.getClassByName("BigMapTargetPanel")` 返回 `found:false`；
- 编辑器已重新打开原 `assets/__layout_test/SevenDay.orig.prefab`（窗口标题 `SevenDay.orig.prefab - zhanchengmaster - Cocos Creator 3.8.8`）。

### 6.3 清理后的最终回归

```powershell
$files = Get-ChildItem -LiteralPath "D:\City1001\Demo3.8\tests" -Filter "bigmap-*.test.ts" | Select-Object -ExpandProperty FullName
npx tsx --test @files
```

结果：`65 文件 / 533 用例 / 532 通过 / 1 失败`，退出码 `1`。

唯一失败：`tests/bigmap-hud-skin.test.ts:234`，断言源码包含 `fitBigMapSprite(this.modeIcon, icon, MODE_ICON_SIZE, 0, MODE_ICON_Y)`；当前 `assets/script/app/bigmap/view/BigMapPageLayout.ts` 使用的是 `this.modeIconSize` / `this.modeIconY`。该文件在本轮开始前就已是工作区未提交状态（`M`，diff 为把旧常量改成 `@property`），不在本次改动集内，因此不是本次删除/简化引入的失败；它是当前工作区里 source 与 guard 未同步的独立红项。需要修的话，应单独决定是保留 `@property` 并更新守卫，还是恢复常量；本轮未改。

其他检查：

- `npx tsc --noEmit -p "temp\tsconfig.cocos.json"`：退出码 `2`，仅 4 条既有 `TS2688`（`cc`、`cc.custom-macro`、`cc.env`、`jsb` 类型声明找不到），非 `TS2688` 错误 **0**。
- `git diff --check`：退出码 `0`，仅有工作区既有 CRLF 提示。
- 最终 `git status`：`BigMapTargetPanel.ts` / `.meta` 均为 `D`，临时目录不存在。

### 6.4 删除依据是否充分：结论与依据清单

**结论：删除 `BigMapTargetPanel` 的代码依据是充分的；但“全量回归全绿”这个验收条件没有满足，不能把本轮验收称为“全部通过”。**

删除依据清单：

1. **生产引用为零**：`assets/script` 中无 `import BigMapTargetPanel`、无 `addComponent(BigMapTargetPanel)`、无类名/构造调用。
2. **资源引用为零**：在 `assets` 的 `.prefab` / `.scene` 中按类 UUID `f3e6e16f-9ddb-46d4-8200-f72aa8dd14e9` 与 class id `f3e6eFvndtG1IIA9yqo3RTp` 扫描，无命中；临时验证 prefab 内的命中已在验证后随临时资源删除。
3. **测试引用仅为自身与反向守卫**：原 `tests/bigmap-target-panel.test.ts` 是唯一直接使用；删除后，`tests/territory-async-player-panel.test.ts`、`tests/territory-level-panels.test.ts` 的断言是“必须已移除”的反向守卫，不是使用证据。
4. **编辑器挂载只证明组件可运行**：临时 prefab 实例化、13 个引用绑定、标题/正文/按钮/费用显示均通过；这证明组件不是“坏到不能运行”，但与“工程原本是否使用它”无关。
5. **清理后类已注销**：asset-db 刷新后 `getClassByName` 返回 `found:false`，临时场景/prefab/目录均已删除，原 prefab 已恢复打开。
6. **测试侧的限制**：非 bigmap 69 个可复现失败、bigmap 1 个工作区既有 source/guard 失败；这两项都不是本次改动引入，但也不等于“全量测试全绿”。因此删除决策本身成立，验收证据链只能算“代码引用依据充分 + 全量测试未全绿”。

非功能性字符串残留（不影响运行时，未在本轮跨目录修改）：

- `assets/script/app/main/LevelInfoPanel.ts:31` 注释仍以 `BigMapTargetPanel.staminaIcon` 作类比；
- `assets/script/app/territory/view/BigMapPlayerLevelPanel.ts:42–44` 注释仍以 `BigMapTargetPanel` / `BigMapLevelInfoPanel` 作历史对比；
- `tests/territory-async-player-panel.test.ts:26,45` 与 `tests/territory-level-panels.test.ts:50,71` 是反向守卫，保留是刻意的。

若验收标准要求“类名字符串零残留”，还需单独清理上述 2 处生产注释；它们不是 import、组件挂载或资源 UUID 引用，不影响本次删除结论。
