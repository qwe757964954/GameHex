# app/common 代码优化改动清单

> 状态：改动记录（2026-11）。记录本轮已执行改动与净减行数，供追溯；当前代码为准，不作为待办。

范围：`assets/script/app/common`（16 个 `.ts`）。目标：去 AI 生成痕迹、删冗余、按项目规范统一命名/格式/注释/结构；不改功能逻辑。

结论先行：改动 14 个文件，`SpriteFrameCache.ts` 与 `RewardItemEvents.ts` 复核后保持原样；净减约 488 行（+477 / −965），其中绝大多数是注释与重复防御。另同步修正 `tests/common-tips-double-confirm.test.ts` 第 34 行的接口名正则（仅名字，断言强度未变）。

## 一、逐处改动

### 1. `CommonTips.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头注释（第 1–8 行） | 删掉「继承 PopupBase 三点说明」「@property 拖拽绑定」等模板说明；删除已不存在的「面板内嵌模式 `initStandalone`」用法 | 文档指向不存在的 API，属死文档；头部只保留用途与调用示例 |
| `CommonTipsOptions` 接口及其引用（`options` 字段、`onOpen`、`apply`） | 改名 `ICommonTipsOptions` | 项目规范：接口一律 `I` 前缀 |
| 原 `initialize()` / `setContent()` | 整体删除 | 全仓 grep 无调用；`initialize` 内部还调用了不存在的 `initStandalone`，属不可用代码 |
| `apply()` 中 `if (this.cancelButton) …` / `if (this.closeButton) …` | 去掉节点判空，直接 `active = …` | 三个按钮是本 prefab 必绑引用，项目规范要求必填 Inspector 引用直接访问 |
| `onSureClick()` / `onCancelClick()` | 删中间变量 `const onSure = …` / `const onCancel = …`，改为 `if (options?.onSure) options.onSure();` | 中间变量只用一次，属多余封装；回调时机未变 |
| `bindButton()` | 签名 `Node \| null` → `Node`，删首行 `if (!buttonNode) return;`；保留「节点上没有 `cc.Button` 就 warn」守卫 | 同上一条；warn 是配置错误提示，不是空值兜底，保留 |
| 三个按钮与 `buttonLayout` 的字段位置 | 从 `Label` 字段之间移到 `@property` 区块前部，四个按钮节点相邻；`= null` → `= null!` | 字段按语义分组；必填引用用 `null!` |
| 按钮 Node vs Button 的历史注释（原 20 行） | 压缩为 5 行，保留「字段是 Node、click 由 node.emit」这一条不变量 | 注释只留业务原因，不写排障过程 |
| `@property` 的 `panelBg/titleBg/titleDeco/titleLabel/contentLabel/sureLabel/cancelLabel` | `= null` → `= null!` | 同上，必绑引用 |

### 2. `EnemyCardView.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 第 1 行 import | `{_decorator, …}` → `{ _decorator, … }` | 与工程其它文件一致的空格格式 |
| 类注释 | 删除「原来是 LevelTipPanel 内联模板」的重构历史，保留选中框复用必须重刷的约束 | 历史沿革不是维护信息 |
| `icon` / `nameLabel` / `selectedFrame` | `= null` → `= null!` | 必填 Inspector 引用 |
| `render()` 注释 | 三行压成一行，保留「缺图只关图标」的用户可感知原因 | 避免注释复述代码 |

### 3. `LoadingPopup.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 私有静态 `_refCount/_instance/_opening/_pendingText` | 改为 `refCount/current/opening/pendingText` | 私有成员 camelCase、无下划线（`current` 比 `instance` 更贴合「当前实例」语义） |
| 实例私有 `_rotating` | 改为 `rotating` | 同上 |
| 所有引用点（`show/hide/forceHide/onOpen/onClose/update`） | 同步改名 | 逻辑与调用顺序完全未变 |
| `spinner` / `label` | `= null` → `= null!` | 必填 Inspector 引用 |
| 文件头 | `@example` 改「用法：」，说明文字去重 | 统一注释写法 |

### 4. `MapMarkerBadge.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `MAP_MARKER_BADGE_FONT_SIZE` 注释 | 删除「2026-10-28 用户要求」与推导细节，保留「15 × 1.15 ≈ 17、高度是上限、SHRINK 会反缩」 | 注释写约束与陷阱，不写需求口述 |
| 气泡底图常量注释 | 删除日期、用户原话、emoji 与「当时两个槽位被压成同一张」的排障记录；保留「已通关蓝 / 未通关红 / frame_01 不用」 | 同上；规则本身保留 |
| 原 `frame_04` 悬挂 JSDoc | 删除独立注释块，把「frame_04 属领地块宝箱、常量在 TerritoryChestBubble」并入主注释 | 注释与常量块脱节，读者容易漏看 |
| 文字样式块注释 | 整段 `/** */` 改为块注释，压掉重复的「美术稿三个特征」表述 | 只留「系统字体靠 isBold/spacingX 逼近」的原因 |
| 行高 / 字距 / 加粗 / 描边注释 | 去掉日期与「用户调粗」来源，保留数值关系与 prefab 双改提醒 | 同上 |

### 5. `QualityFrameArt.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 合并「实测颜色」「共用模块清单」，压成 4 行 | 常量说明不需要模块清单 |
| `QUALITY_FRAME_NAMES` | `Array.from({ length: QUALITY_FRAME_LEVELS }, (_unused, index) => …)` → 4 个字面量 | 固定 4 项用生成器是模板化抽象；字面量更直观，值与顺序不变；守卫要求恰好 4 张 |

### 6. `RedDotArt.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `RED_DOT_SPINE_DIR` / `RED_DOT_SPINE_PREFAB_PATH` / `RED_DOT_SPINE_DATA_PATH` | 删除三个常量 | 全仓 0 引用；后两者值完全相同，且注释自承「组件不依赖它」 |
| `redDotArtCacheKey()` | 删除函数及 `artKey` import | 全仓 0 引用；缓存键已由 `SpriteFrameCache` 内部生成 |
| `redDotArtPath()` | 返回类型 `string \| null` → `string`；删 `if (!name) return null` | `RED_DOT_ART_NAMES` 是 `Record<RedDotArtKey, string>`，键穷尽，分支不可达 |
| `redDotIconSize()` | 删 `?? RED_DOT_ICON_SIZES.ordinary` 兜底 | 同上，查表不可能为空 |
| `loadRedDotFrame()` | 删 `const path = …; load(path ?? '')`，改为直传 | 上游已保证非 null |
| 文件头 + 三张图表格 | 四列表（FGUI 原名/原图/换算）压成三列（文件名/显示尺寸），保留「逐张给尺寸否则数字底压扁 1px」 | 换算过程不是维护所需，结论才是 |
| spine 段注释（原 20 行） | 压缩为 4 行：素材目录、动画名少一个 i、33×38.4 的来源、scale 保持 1 | 保留反直觉点，删二进制反解过程 |

### 7. `RedDot.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| import 块 | 同模块的 value import 与 `import type` 合并为一条，类型加 `type` 修饰 | 减少重复 import；类型不参与运行时 |
| `private type` | 改名 `dotType`（含 `setRedDot`/`setRedDotType`/`getRedDotType` 全部引用） | 避免与语言关键字同名，且与 getter 语义一致 |
| `iconTransform: UITransform \| null` | 改为 `UITransform`（onLoad 必取），`?.setContentSize` 改直调 | 必绑引用；prefab 缺 UITransform 属配置错误，不应静默 |
| `spineAvailable()` | `return !!this.spine && !!this.spine.skeletonData;` → `return !!this.spine.skeletonData;` | `spine` 是 `@property` 必绑，前半段恒真 |
| `onDestroy()` | 从文件末尾移到 `onLoad()` 之后 | 生命周期方法相邻，便于阅读 |
| `applyIcon()` | `if (!show \|\| key === null)` → `if (!show)` | `show` 已包含 `key !== null`，第二段不可达 |
| 文件头 + `setRedDot` 参数注释 | 类注释的节点结构树、三条行为、复用安全压成 11 行 | 保留结构与渲染顺序约束，删展开式说明 |

### 8. `RedDotState.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 删除老端 `GObjRD` 源码引用块与 FGUI gearIcon 细节，压成 6 行 | 保留「boolean 归一、spine 优先、静态图回退」三条口径 |
| `normalizeRedDotCount` 注释 | 去掉「复刻老端那两行」「⚠️」等表述，保留 `true <= 0` 恒 false 的陷阱 | 陷阱是必要信息，排障语气不是 |

### 9. `ResBar.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `MainResBarFeedback` import | 补空格 | 格式统一 |
| import 名单 | 移除 `IResBarCell` | `resolveCells` 重构后本文件不再使用 |
| `slot0/1/2` | `= null` → `= null!` | 必填 Inspector 引用 |
| `readTable()` → `readTable<T>()` | 泛型化，`readTables()` 内去掉 3 处 `as readonly …` 强转；`Promise.resolve(null)` 改为直接 `null` | 消除同形状强转；`Promise.all` 对 null 项的处理不变，返回元组类型不变 |
| `update()` | `if (this.slot0 && this.slot0.step(dt)) busy = true;` → `busy = this.slot0.step(dt) \|\| busy;`（三槽同改）；`if (this.stepFlash(dt)) busy = true` → `\|\| busy` | 逐槽调用顺序与短路语义等价，布尔或可读性更好；仍显式调用 slot0/1/2，未改成数组（守卫要求） |
| `stepFlash()` | 两处 `this.glow?.clear(); if (this.glow) …` 合并为单个 `if (this.glow) { clear(); node.active = false; }` | 同一判空写两遍；行为相同（无 glow 时都不动作） |
| `computeGlowRect()` | 删除局部 `const pad = GLOW_PADDING;`，直接用常量；`isFinite` 早退保留 | 局部别名无收益；`isFinite` 行是守卫钉死的，逐字保留 |
| `resolveCells()` | 删除外层 `let cells … = null`，改为 `if` 块内 `const cells = …` | 变量只在块内使用，去掉「先声明后赋值」的空洞模式 |
| 文件头（原 60+ 行） | 压缩为 14 行：职责、与 MainResBar 分工、两种接入、槽位规则、keys 字符串原因、数据来源、自驱动 | 保留配置口径，删除历史表格与重复警示 |
| `playGainFeedback` / `playSpendFeedback` / `flash` / `applyFlash` / `ensureGlow` / `computeGlowRect` / `resolveCells` / `clampKeys` / `readTables` 注释 | 逐段压缩，去掉日期、用户反馈引语、emoji、规则编号 | 注释只写原因/陷阱/不变量 |
| `reload()` 的 `slots` 与 `slot.render(slots[i] ?? null)` | 未改动（逐字保留） | `militia-talent-ui.test.ts` 有源码级正则 |

### 10. `ResTypes.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头（原 43 行） | 压成 8 行：真源字段、互查职责、`resShowType` 继承、图标目录归属、兜底表定位；删「曾经手抄三份」「md5 相同」的历史表 | 历史不构成维护约束 |
| `FALLBACK_RES_ICON_ART` 注释 | 压成两行，保留「表优先、测试逐条比对」 | 守卫信息必须留 |
| `COMMON_ICON_ART_ROOT` 注释 | 压成三行，保留「别写成 COMMON_ART_ROOT」的陷阱 | 同名不同目录，易错点 |
| `ROLE_PROPERTY_ICON_ROOT_OVERRIDE` 注释 | 20+ 行实测表压成 9 行，保留三条例外、静默失败症状、守卫用例 | 例外表必须逐名覆盖，是核心约束 |
| `resBarIconSpritePath` 注释 | 压成 6 行，保留「两种拼法不同」「少 `/spriteFrame` 的症状」「bundle 路由不在这里」 | 症状描述能直接指向错误原因 |
| `resolveResBarRefIds` 注释 | 三条规则改为陈述句；**修正文档笔误**：`unmappedResIds()` → `resolveResBarCells` + `unknownResIds` | 原函数不存在，文档指向错误 API |
| 全部导出符号与实现 | 未改动 | `res-types.test.ts` 直接 import 所有导出，删符号即红 |

### 11. `RewardItemView.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `ResourceScope` import | 改为 `import type` | 仅用类型，避免运行时代入 |
| `currentResId` 字段 | 从 `qualityOf` 之后移到字段区（`frameCache` 之后） | 状态字段集中 |
| `resourceScope` getter | 单行写法改为多行；位置随字段下移 | 工程内 getter 统一多行 |
| `onDestroy()` | 从 `loadFrame` 之后移到 `onLoad()` 之后 | 生命周期相邻 |
| `qualityOf()` | 从 `loadFrame` 之后上移到 `loadTables` 之后（静态工具相邻）；删除 `as { quality?: unknown } \| undefined` | `itemRows` 已是 `IItemRefRow[]`，自带 `quality: unknown`，强转多余 |
| `render()` | `Math.floor(data.amount)` 只算一次（原表达式里出现 3 次） | 重复计算，且可读性差 |
| `loadFrame()` 失败注释 | 改为「失败结果同样留在缓存里」，与 `frameCache.set(path, task)` 的实际行为一致 | 原注释写「不入缓存、下趟重试」与代码不符，属错误文档 |
| 类注释 / `IRewardItemData` 注释 | 删「领地四个弹窗各自一份」的重构史与用法示例 | 历史不必要 |

### 12. `RoutedResource.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `routedLoadDir` 签名 | 超长单行改为多行参数 | 与文件内其它函数签名风格一致 |
| `resolveBundle` / `routedLoad` 注释 | 压缩「loadAssetBundle 内部职责」与「模块级静态工具拿不到 AssetService」的说明，保留路由规则归属 core | 保留分层原因，删解释性铺陈 |

### 13. `TabButton.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `private inited = false` 与 `ensureInit()` 中两行门闩 | 删除，`ensureInit` 只保留 `this.node.on(...)` | `node.on` 自身按 callback + target 去重；项目规范明确不加「只绑一次」门闩 |
| `bg/icon/nameLabel/redDot` | `= null` → `= null!` | 必填 Inspector 引用 |
| `offBgFrame/onBgFrame/offIcon/onIcon` | `= null` → `= null!` 改为 `SpriteFrame \| null = null` | 这四个是可选实例覆盖，真可空 |
| `handleClick()` | `if (this.onSelect) this.onSelect();` → `this.onSelect?.();` | 可选回调的标准写法 |
| `onDestroy()` | 去掉 `if (this.node && this.node.isValid)` 包裹，直接 `this.node.off(...)` | 组件销毁时 `this.node` 必然存在；多余守卫 |
| `playHitFeedback()` / `update()` | `this.icon?.isValid` → `this.icon.isValid` | icon 必绑，可选链掩盖配置错误 |
| 类头注释（原 60+ 行） | 压成 12 行：共用事实、Inspector 表达差异、三条约定（绝对赋值 / 不碰 contentSize / 红点表达式）、`ensureInit` 为何不能只在 onLoad | 删除 FGUI XML 坐标、底图 122×96 推导、「有意没复刻整块上抬」等重构史料 |
| `setSelected` / `setLabel` / `setEnabled` / `setIconFrame` / `bindRedDotExpr` 注释 | 逐段去重、去 emoji/规则编号，保留「两态都写」「不解绑会写死对象」 | 同上 |

### 14. `Toast.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头（原 60+ 行） | 压成 21 行：三条交互约定、底条样式口径、单行文字、用法、装配点 | 删除样式来源表格与「换美术图改法」的空想指引 |
| 静态 `_queue` / `_owner` | 改为 `queue` / `owner` | 私有成员无下划线 |
| 实例 `_remain/_playing/_selfClosing` 与方法 `_schedule/_playNext/_stop/_applyLayout/_applyTextStyle/_drawPanel` | 全部去下划线 | 同上 |
| `currentText` getter | 由读取独立 `_text` 字段改为直接 `this.label.string` | 消除「字段与 Label 双写」的冗余状态；测试仍可读到当前文案 |
| `applyLayout()` | 两处 `this.panel.getComponent(UITransform)` / `this.label.node.getComponent(UITransform)` 去掉判空 | prefab 两节点均带 UITransform，必绑引用直取 |
| `panel/panelGraphics/label` | `= null` → `= null!` | 必填 Inspector 引用 |
| `Toast.show()` 的类型与空串检查 | 未改动（逐字保留） | `toast.test.ts` 会传 `42`、`''`、`undefined`，此守卫是行为 |

## 二、删除项与引用确认

| 删除项 | 位置 | 引用检查 | 结论 |
|---|---|---|---|
| `CommonTips.initialize`、`CommonTips.setContent` | `CommonTips.ts` | 全仓 grep `CommonTips.(initialize\|setContent)` 无命中（另有 `LeagueEditModel.setContent`，同名的其它类方法，与本组件无关） | 可删；属无调用 API |
| `RED_DOT_SPINE_DIR`、`RED_DOT_SPINE_PREFAB_PATH`、`RED_DOT_SPINE_DATA_PATH` | `RedDotArt.ts` | 全仓 0 命中 | 可删；后两者值重复且无使用 |
| `redDotArtCacheKey` + `artKey` import | `RedDotArt.ts` | 全仓 0 命中 | 可删 |
| `TabButton.inited` | `TabButton.ts` | 私有字段，仅本文件 `ensureInit` 使用 | 可删；`node.on` 自带去重 |
| `IResBarCell` import | `ResBar.ts` | 重构后本文件无引用（`ResTypes` 仍导出，供其它模块用） | 可删 import，不删导出 |
| `RedDot.iconTransform` 的可空性、`RedDot.spine` 的 `!!` 判断 | `RedDot.ts` | 均为本文件内部 | 可简化 |

## 三、行为等价与边界说明

1. **必绑引用从「静默跳过」改为直取**：`CommonTips` 三个按钮节点、`Toast` 两个 UITransform、`TabButton.icon`、`RedDot.iconTransform`、`ResBar.slot0/1/2`。现有 prefab 均已绑齐，正常运行无差异；只有「prefab 少绑」这种配置错误会由「点了没反应 / 整块跳过」变为启动即报错。按项目规范（必填 Inspector 引用用 `null!` 并直接访问），这是期望行为，故保留。
2. **`ResBar.update`**：`busy = slot.step(dt) || busy` 与 `if (slot && slot.step(dt)) busy = true` 在布尔结果与调用顺序上等价；三个槽仍是显式逐条调用，未改成 `hostSlots()` 数组（`resbar-adaptive-layout.test.ts` 明确禁止）。
3. **`ResBar.readTables` 泛型化**：返回元组形状 `[propRows|null, openRows|null, itemRows|null]` 不变；`Promise.all` 接收 `null` 项的行为与 `Promise.resolve(null)` 一致。
4. **`RewardItemView.loadFrame` 注释修正**：原注释称失败结果不入缓存，实际 `frameCache.set` 在请求前就写入，失败 Promise 也留在缓存；注释改为与实现一致，代码未改。
5. **`RedDot.applyIcon`**：`!show` 已覆盖 `key === null`（`show = visible && !useSpine && key !== null`），删掉第二段不可达判断。
6. **`CommonTips` 回调**：`const onSure = options?.onSure; onSure?.()` 与 `if (options?.onSure) options.onSure()` 都是「取出后立即调用」，中间无 await，语义一致。
7. **未改动**：`SpriteFrameCache.ts`、`RewardItemEvents.ts` 复核后无 AI 味注释、无死代码、命名已合规，保持原样（避免无意义 diff）。

## 四、验证

| 命令 | 结果 |
|---|---|
| `npx tsx --test`（reddot / tab-button / toast / common-tips / res-types / reward-item / sprite-frame-consumers） | 85/85 通过 |
| `npx tsx --test`（resbar-adaptive-layout / main-resbar / main-resbar-spend / militia-talent-ui / sprite-frame-null / territory-* / art-paths / routed-resource / sprite-frame-cache） | 125/125 通过 |
| `npx tsx --test`（全部 55 个 import `app/common` 的测试文件） | 1172/1174 通过；2 条失败均在 `zcds-settlement.test.ts`（结算按钮显隐、统计面板量尺），失败断言落在 `GameRunAway` 的 `returnButton.node.active` 与面板高度计算，与 common 目录改动无关，且该文件不在本次改动范围 |
| `npm run verify:guards` | 41/41 通过；`root hygiene OK: 8 个白名单文件` |
| `npm run verify`（check 模式） | 全仓 tsc：common 目录 0 条错误（4 条新增均在 `celebration/CelebrationRepository.ts`、`bigmap/BigMapConfigLoader.ts`）。该模式本次按它自己的改动集只选了 5 个其它文件（1215/1220 通过，新增失败 1 条为资源目录 `T2`，与源码无关），未覆盖 common；common 的结论以下面两项与定向跑为准 |
| `npm test`（全量） | 6073 条：6049 通过 / 24 失败；失败集中在与 common 无关的既有红项（withTimeout、HeadArt、atlas、技能导表、卡牌表、资源点、`zcds-settlement` 等），`app/common` 相关守卫无一失败 |

说明：`npm run verify:route` 只打印「改动文件 → 应跑用例」的映射（不执行），本次已按该映射与「全部 common 引用者」两套集合手工跑完。

## 五、汇总

| 项 | 数量 |
|---|---|
| 改动文件 | 14（common）+ 1（测试正则同步） |
| 保持原样 | 2（`SpriteFrameCache.ts`、`RewardItemEvents.ts`） |
| 删除死代码 | 4 处（`CommonTips.initialize`、`CommonTips.setContent`、`RedDotArt.redDotArtCacheKey`、3 个 `RED_DOT_SPINE_*` 常量） |
| 删除冗余防御 | 约 10 处（按钮/UITransform/组件判空、`inited` 门闩、`?? 兜底`、`!!` 判断、不可达分支） |
| 命名修正 | 接口 `I` 前缀 1 处、私有成员去下划线 12 个、`type` → `dotType` 1 处 |
| 注释压缩 | 14 个文件的头注释与逐段说明，净减约 480 行 |
| 功能逻辑改动 | 无（仅「必绑引用缺失」这类配置错误由静默改为报错，见第三节） |

三项要求对应关系：

1. **去 AI 味**：删除日期/用户引语/emoji/规则编号/重构史、`⚠️` 模板句式，注释改为陈述「为什么」与「别怎么改」。
2. **删冗余**：删 4 处无引用 API、`inited` 门闩、不可达分支、重复判空、重复计算、多余类型断言与中间变量；删除前逐项 grep 确认引用。
3. **统一规范**：接口 `I` 前缀、私有成员 camelCase、必填 `null!` / 可空 `| null`、生命周期方法相邻、import 空格与 `type` 修饰、字段分组与注释位置统一。
