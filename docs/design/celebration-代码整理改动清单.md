# 开服庆典（celebration）代码整理改动清单

范围：`assets/script/app/celebration` 下 16 个 `.ts`；不含 prefab / 生成脚本 / 测试夹具。

约束：不改功能逻辑；删符号前先全仓确认无引用；不动工作区里其它模块已有的未提交改动（`gift`、`chat`、`itemdetail`、`firstRecharge`、`friend`、`common`、`bootstrap` 等）。

上一轮已清理的项（`CL_PAY_SDK_AVAILABLE`、`CL_READ_TIMEOUT_MS` / `CL_WRITE_TIMEOUT_MS` 导出、`rewardsOfTarget`、`shopBranchOf`、`OSRewardSlot.setFrameSliced`、页面里的必填引用判空）见 [`五目录-代码优化改动清单.md`](五目录-代码优化改动清单.md)，本清单只列本轮追加改动，不重复。

## 一、改动概览

| 文件 | 主要改动 | 行数（+/-） |
|---|---|---|
| `CelebrationTable.ts` | 洗表样板收敛成 `parseRows` / `rowsOfId`；删 `rankTimeOf`；压缩表头与判定注释 | +150/-311 |
| `CelebrationRepository.ts` | 3 个尾下划线函数改语义名、`rankReached` 改 `isRankReached`；删 `firstReward2Of`；转发导出 16 项收到 4 项；去 `as any` | +56/-132 |
| `CelebrationTexts.ts` | 删 `clFormat`、`CelebrationTextKey` 与 8 条无引用文案；保留照抄口径说明 | +29/-113 |
| `CelebrationViewState.ts` | 只压注释（去掉规则编号、模板句式），代码未动 | +14/-36 |
| `CelebrationArt.ts` | 文件头压缩；`osRankTextColor` 删不可达兜底；纠正 `osQualityFrameLevel` 的错误注释 | +87/-141 |
| `CelebrationFrames.ts` | 删 `preloadPaths` / `requestedPaths` / `size` / `_requested` / `artOf`；`iconOf` 去掉重复查表；引用计数按实例对称 | +60/-95 |
| `OSArtStrip.ts` | 空奖励分支复用 `hide()`；去掉 `UITransform` 判空与高度兜底 | +23/-42 |
| `OSRewardSlot.ts` | 注释压缩，`render` 保持全量赋值 | +16/-44 |
| `OSRankItem.ts` | 删 `osSegmentOf` / `collectSprites` / `OS_RANK_SEGMENT_NAMES`；名次分段直接用枚举颜色表 | +30/-72 |
| `OSDetailRow.ts` | 删 `OS_NOT_IN_RANK` 别名，统一 `CL_NOT_IN_RANK`；头像加载器类型收紧 | +29/-59 |
| `OSRankEntryButton.ts` | 删空 `onDestroy`；点击改绑 `this.node`；文件头压缩 | +15/-79 |
| `OSTabButton.ts` | 删 `button.node` 中转；三个可选回调改必填；文件头压缩 | +26/-54 |
| `OSShopItem.ts` | 删 `_buySprites` 包装与重复的 `costIcon.node.active` 赋值；点击改 `Button.EventType.CLICK` | +52/-77 |
| `OSTargetItem.ts` | 点击改用 `Button.EventType.CLICK`、回调改必填、类注释归位 | +34/-62 |
| `OSRankPage.ts` | 倒计时重复赋值抽 `_refreshCountdown`；`_listOfTab` / `_countOfTab` 去不可达分支；注释压缩 | +97/-185 |
| `OSRankRankDetailPage.ts` | `CL_EMPTY_RANK_ENTRY` 上移并取消导出；未上榜用 `CL_NOT_IN_RANK` | +30/-46 |
| `RequestCelebrationMsg.ts` | 文件头压缩，协议事实保留 | +14/-27 |

合计 `+762 / -1575`（净减 813 行）；目录总行数 3578 → 2715。全部 LF，缩进 4 空格、单引号、分号，与相邻模块一致。

## 二、逐处改动

### 2.1 `CelebrationTable.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 删掉「判定散在哪」大表、`⚠️` / `🔴` / `⇒` 符号、`规则 78/81/82` 编号，压成 3 段：零 import 约定、4 条口径陷阱、类型说明 | 开发细则要求注释只写业务原因 / 引擎陷阱 / 不变量；全仓检索不到「规则 N」的清单，属模板残留；emoji 与 Markdown 表格是生成痕迹 |
| 洗表段 L261 `parseRows` | 新增统一洗表：`Array.isArray` 判断、非对象行跳过、`build` 返回 `null` 视为无效行 | 原先 `parseConfigRows` / `parseTargetRows` / `parseRankRows` / `parseShopRows` / `parsePayChannelRows` / `parseServerStates` 六份循环与判空完全同构 |
| L278-L405 六个 `parseXxxRows` | 每个只留字段映射与 `id <= 0` 校验（4～19 行/个） | 与上一条同源；非法行过滤规则未变（仍是 `id <= 0` / `subId <= 0` 跳过） |
| L399 `rowsOfId` | 新增按 `id` 过滤的泛型函数；`targetsOf` / `ranksOf` / `shopsOf` 各剩一行 | 三个函数原先各写一遍 `for + push`，过滤条件同为 `row.id === id`；保留三个语义名是因为它们对应老端 `GetTargetArr` / `GetRankArr` / `GetShopArr`，删掉会让调用点失去出处 |
| 删 `rankTimeOf`（基线 L719） | 全仓确认无引用后删除；`CelebrationRepository.load()` 改为 `rankTimes.get(rankType) ?? null`（L214） | 该函数只是 `Map.get + ?? null` 的一行包装；调用点仅 `load()` 一处，内联后语义等价 |
| L509 `rankSegmentOf` | 注释压成 3 行，保留「第二段条件是 `start >= 2 && end <= 3`，不是 `start === 2`」 | 老端原条件如此，改动会移位名次颜色 |
| L679 `numAbbrOf` / L701 `countdownHmsOf` | 注释各留 1～2 行，保留「k/M/G 阈值与 `formatNumberToKMBT` 差 1000 倍」「`Math.ceil` 且负数钳 0」 | 两处都是刻意偏离通用格式化，删掉说明会被后人“修正” |
| L456 `stateBySubId` | 注释压缩，保留「`targetInfos` 下标是 `subId - 1`」「查不到行退 `Unfinished`（老端会抛）」 | 行为与基线一致，只动注释 |
| L474 `rdOf` | 注释保留「外层扫 `celebrationRank`、内层查 `celebrationTarget` 是老端原样」 | 该错位是照抄事实，不能“顺手修正” |

### 2.2 `CelebrationRepository.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 删数据来源大表与规则编号，改为 6 行来源列表 + 2 条陷阱（`server.id` 是 `rankType`；支付只到业务前置） | 同 2.1 注释规范；来源信息用列表已够用 |
| L79-L90 导出面 | 转发导出从 16 项收到 4 项：`CL_NOT_IN_RANK` / `buyCountOf` / `numAbbrOf` / `purchaseStateOf`（页面实际消费的就是这 4 个）；类型导出保留 | 被裁项页面已改为直接 `import` 自 `CelebrationTable`，全仓 `rg` + `tsc` 确认无外部引用；类型是快照契约，保留可读性 |
| L409 | `propertyWantTextOf_` → `targetHeaderTextOf` | 尾下划线是“与 Table 同名只能回避”的临时手段；改为“目标页表头”语义名，`rg` 确认无外部引用 |
| L425 | `limitBuyTextOf_` → `shopLimitTextOf` | 同上；与 `shopSaleTextOf` 成对 |
| L430 | `saleTextOf_` → `shopSaleTextOf` | 同上 |
| L477 | `rankReached` → `isRankReached` | 布尔判定按项目命名用 `is` 前缀；调用点仅 `OSRankItem` |
| 删 `firstReward2Of`（基线 L538） | 全仓无引用；`OSRankItem` 直接取 `row.rewards2[0]` | 一行转发，且“右侧只吃第一个奖励”的口径已写在该行注释里 |
| L337-L340 `requestRank` | `unionId: unionId as any` → 直接传 `string`；保留 `rankType as CmdRankType` | `proto` 的 `unionId` 是 `Long`，protobufjs 接受十进制字符串；`rankType` 是数字转枚举，收窄是必须的 |
| L214 / L239 | 内联 `rankTimes.get(...)`、`countdownOffsetOf(...)`；未改公式 | 与删 `rankTimeOf` 同步 |
| `targetHeaderTextOf` / `isRankReached` / `toRankEntry` 注释 | 压到 1～3 行，保留「`rank = -1` 不可抹 0」「`Long` 不能直接 `Number`」 | 都是会让显示悄悄出错的陷阱 |

### 2.3 `CelebrationTexts.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 删 `clFormat`（基线 L158） | 与 `CelebrationTable` 的模板函数重复，全仓无调用 | 重复实现，留两份会漂移 |
| 删 `CelebrationTextKey`（基线 L148） | 类型别名，全仓无引用 | 死类型 |
| 删 8 条文案（基线 L62/65/66/67/85/113/115/131） | `title`、`tabTarget`、`tabRank`、`tabShop`、`myRankFallback`、`rankPrefix`、`rankSuffix`、`soldOutTip` | 全仓无消费：页签名走 prefab 图，名次前后缀已硬编码在 `rankTextOf`，售罄是 `n41` 图不是文案；保留只会让人误以为有登记表在用 |
| 保留段 | FGUI 静态文案 + `mL.json` 7 条；「多钱」错别字、半角冒号照抄并注明 | `tests/celebration.test.ts` 对本表做对账；照抄是刻意口径 |
| 文件头 | 三类出处压成 5 行 | 注释规范 |

### 2.4 `CelebrationViewState.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 / L32 / L64 / L94 | 去掉「规则 78」「cs?」等标记，三个函数注释压到 2～5 行；保留「页 id ≠ 页下标」「`grayed` 用 tint 近似」 | 纯函数与 cc 分离的原因要留；其余是模板句 |
| 代码 | 未改 | 三个状态映射与基线逐字一致 |

### 2.5 `CelebrationArt.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 删出处大段与 emoji，压成 5 条约定（路径不带扩展名、漏 `/spriteFrame` 只留白、九宫以 `.meta` 为准、`os_` / `cu_` 前缀） | 注释规范；关键事实保留 |
| L191 `osQualityFrameLevel` | 只改注释：原文称与 `common/QualityFrameArt.qualityFrameLevel` 同算法，实际品质 2 时本函数给 2、common 按 `quality-1` 折算给 1，明确写“不可互换” | 实测口径不同；合并会改显示，故只纠正注释 |
| L336 `osRankTextColor` | 删 `?? OS_RANK_TEXT_COLORS.other` 兜底 | 参数是 `ECelebrationRankSegment` 三值，`Record` 已全覆盖，兜底不可达 |
| L298 `OS_RANK_TEXT_COLORS` | 键从字符串 `'first' / 'secondThird' / 'other'` 改为枚举 `ECelebrationRankSegment` | 与 `rankSegmentOf` 返回值直接对接，删掉 `OSRankItem` 里的字符串映射表 |
| L228 `celebrationNeededArtPaths` | 参数类型 `IActivityGoodsInfo` → `ICelebrationGoodsInfo` | 入参来自庆典快照，用本模块的快照契约；两者结构相同，仅类型来源 |
| 图条注释 | 保留每个 key 的尺寸 / 九宫值（`tests/celebration.test.ts` 的 B1/F1 要双向对账），删掉「⚠️」「必须是」等叙述 | 对账需要事实，不需要语气词 |

### 2.6 `CelebrationFrames.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 删 `preloadPaths()` / `requestedPaths` / `size` / `_requested`（基线 L56、L41、L135、L140） | 全仓无引用；`_requested` 只在 `loadFrame` 里 `add`、在 `dispose` 里 `clear` | 探针 API 没有探针在用；`_pending` 已承担并发去重 |
| 删 `artOf(key)`（基线 L96） | 全仓无调用；页面直接用 `frameOf(osArtPath(key))` | 一行包装，且已无消费方 |
| L88 `iconOf` | 去掉先 `goodsOf` 再 `rewardIconRefOf` 的两次查表，只调 `rewardIconRefOf` | `rewardIconRefOf` 内部就是 `goodsOf` + 解析，空值路径已返回 `null` |
| L49 `loadFrame` | 加载失败缓存 `null`；在途 Promise 去重；关闭后才返回的结果补 `decRef` | 与基线行为对齐（失败也进缓存），并补上“窗口已关”时的引用平衡；加载仍走 `routedLoad` |
| L38 `preload` / L99 `dispose` | 注释压到 1 行；`dispose` 幂等 | 注释规范；页面 `onClose` 可能重复调用 |
| 引用计数 | `SpriteFrame.addRef()` / `decRef()`，按实例 `_frames` 对称释放 | 仓库既有写法（`SpriteFrameCache`、`TerritoryBattleCover`）；`Bundle` 没有 `addRef`；模块级集合会在两个面板并发时互相 `decRef` |

### 2.7 视图组件

| 文件 / 位置 | 改动 | 依据 |
|---|---|---|
| `OSArtStrip.ts` L51 | `count === 0` 的 3 行隐藏逻辑改调 `hide()` | 与 L89 `hide()` 完全重复 |
| `OSArtStrip.ts` L60 | `const host = getComponent(UITransform); host ? host.height : this.itemHeight` → 直接 `this.getComponent(UITransform).height` | 奖励条节点必有 `UITransform`；`itemHeight` 只在这条兜底里被读，`@property` 保留只为对齐 prefab 设计值（tooltip 已改成“排布用 UITransform 高度”） |
| `OSArtStrip.ts` 文件头 | 注释压缩，保留 `Mask` 裁剪 / 缩放加在条目上的原因 | 注释规范 |
| `OSRankItem.ts` 删 `osSegmentOf` / `collectSprites` / `OS_RANK_SEGMENT_NAMES` | 全仓无引用；分段文案与颜色改用 `rankSegmentOf` + 枚举颜色表 | `osSegmentOf` 用 `row` 算分段，`render` 里已有 `start/end`；`collectSprites` 只是 `[frame, icon]` 的包装 |
| `OSRankItem.ts` L78 `toColor` | 参数直接收 `OsRgb` 元组，不再接受 `undefined` | 颜色表三值全覆盖，`undefined` 路径不可达 |
| `OSDetailRow.ts` 删 `OS_NOT_IN_RANK` | 改用 `CL_NOT_IN_RANK`，与页面、表格共用同一常量 | 同一语义两个常量名，容易写成不同值 |
| `OSDetailRow.ts` L29 `getSprite` | 参数类型由 `() => Sprite \| null` 收成 `() => Sprite`；`_setFrame` 只保留 `sprite.isValid`（异步回调后必须判） | 宿主传入的是必绑 `headIcon`；`isValid` 是 await 之后的必要守卫，不能删 |
| `OSDetailRow.ts` L85 `_avatar` | `private _avatar: OSAvatarLoader = null!`（`onLoad` 赋值） | 项目 `null!` 约定；`Component` 生命周期内非空 |
| `OSRankEntryButton.ts` 删 `onDestroy` | 原方法是空实现 | 死代码 |
| `OSRankEntryButton.ts` L34 | `const button = ...; button.node.on(...)` → `this.node.on(...)` | `Button.node` 就是 `this.node`，少一层中转 |
| `OSTabButton.ts` 删 `button.node` 中转 | 直接 `this.node.on(Button.EventType.CLICK, ...)` | 同上 |
| `OSTabButton.ts` L48 `onTap` / `OSShopItem.ts` L80 `onBuy` / `OSTargetItem.ts` `onClaim` / `onGoto` | 由 `(() => void) \| null` 改为必填 | 宿主每次铺行都会重设；可空会逼 handler 再做判空，项目规范要求用数据表达可用性 |
| `OSShopItem.ts` 删 `_buySprites` | 原为三行 sprite 包装，实际只做 `spriteFrame` 赋值 | 过度封装 |
| `OSShopItem.ts` L122-124 | 删 `vis.costIconVisible` 分支里重复的 `this.costIcon.node.active = ...`，统一由 `!!frame` 决定 | 同一值写两遍；行为等价 |
| `OSTargetItem.ts` / `OSShopItem.ts` 点击绑定 | `'click'` 字面量 → `Button.EventType.CLICK` | 与全仓其它按钮一致；`'click'` 拼错不报错 |
| `OSTargetItem.ts` 类注释 | 从 re-export 上方移到 `@ccclass` 上方，并压缩 | 注释原来悬空，不归属任何声明 |
| `OSRewardSlot.ts` | 只压注释；`render` 三分支全量赋值保留 | 行是 clone 复用的，全量赋值是幂等要求 |

### 2.8 页面

| 文件 / 位置 | 改动 | 依据 |
|---|---|---|
| `OSRankPage.ts` L287 `_refreshCountdown` | 抽出倒计时赋值，`applySnapshot` 与 `_tick` 共用 | 原两处各写一遍 `refreshTime.string = countdownTextOf(...)` |
| `OSRankPage.ts` L410 `_listOfTab` | 去掉入参 `tab` 与“未知页签返回 `null`”分支，改为按 `_tab` 三分支、目标页兜底 | `_tab` 只由 `selectTab` 写入且已校验 `0..CL_TAB_COUNT-1`，`null` 分支不可达 |
| `OSRankPage.ts` L417 `_countOfTab` | 去掉入参 `tab` 与“未知页签返回 0”分支 | 同上 |
| `OSRankPage.ts` 注释 | 文件头压缩，保留三条虚拟列表约定与两处刷新入口口径 | 注释规范 |
| `OSRankRankDetailPage.ts` L41 | `CL_EMPTY_RANK_ENTRY` 从文件尾上移到使用点之前，取消 `export`，`rank: CL_NOT_IN_RANK` | 全仓无外部引用；常量在使用点附近更易读；不沿用 `-1` 字面量 |
| `OSRankRankDetailPage.ts` 空态渲染 | 直接 `this.heroRow.render(CL_EMPTY_RANK_ENTRY)` | 必填引用，按契约访问 |

### 2.9 `RequestCelebrationMsg.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 压成“两个请求 + 没有拉取请求 + 两条 BroMsg 不发但要知道 + `id` 是 `celebrationConfig.id`” | 注释规范；协议事实（msgid、`tlCmdGoods`、`canRmb`）全部保留 |

## 三、命名与格式统一

| 旧 | 新 | 文件 | 依据 |
|---|---|---|---|
| `propertyWantTextOf_` | `targetHeaderTextOf` | `CelebrationRepository` | 尾下划线是回避重名的临时手段；改用语义名 |
| `limitBuyTextOf_` | `shopLimitTextOf` | 同上 | 同上 |
| `saleTextOf_` | `shopSaleTextOf` | 同上 | 同上 |
| `rankReached` | `isRankReached` | 同上 | 布尔用 `is` 前缀 |
| `OS_NOT_IN_RANK` | `CL_NOT_IN_RANK` | `OSDetailRow` | 与表格常量统一，避免两套值 |
| `OS_RANK_SEGMENT_NAMES`（字符串键表） | `OS_RANK_TEXT_COLORS`（枚举键表） | `OSRankItem` → `CelebrationArt` | 去掉一层字符串映射，枚举直接查表 |
| `'click'` 字面量 | `Button.EventType.CLICK` | `OSTargetItem` / `OSShopItem` | 全仓按钮统一写法 |

其余格式项：

- 必填 Inspector 引用统一 `null!`；只有真正可空的帧参数用 `| null`。
- 回调（`onTap` / `onClaim` / `onGoto` / `onBuy`）改必填，不再 `?.()`。
- 注释统一简体中文；文件头 5～20 行，函数注释 1～3 行，只写业务原因 / 引擎陷阱 / 口径。
- 删除所有 `⚠️` / `🔴` / `⇒` / `**加粗**` / `① ② ③` / “规则 N” / “别顺手” / “记账在此” 等叙述。
- 全目录 LF、4 空格、单引号、分号；无行尾空格。

## 四、刻意保留（不能删 / 不能合并）

| 位置 | 保留内容 | 原因 |
|---|---|---|
| `CelebrationArt.osQualityFrameLevel` | 独立实现，不换成 `common/QualityFrameArt.qualityFrameLevel` | 品质 2 → 本函数 2、common 按 `quality-1` 给 1；合并会改框档 |
| `CelebrationTable.rdOf` | 外层 `celebrationRank.subId`、内层查 `celebrationTarget` | 老端原样错位；修正会改红点结果 |
| `CelebrationTable.countdownOffsetOf` | 减 5 分钟且允许负数 | 老端“提前 5 分钟结束”的口径；钳 0 会改变展示 |
| `CelebrationTable.numAbbrOf` | 独立阈值（k=1000 等） | 与 `formatNumberToKMBT` 差 1000 倍，不能互换 |
| `CelebrationTable.countdownHmsOf` | `Math.ceil` + 负数钳 `00:00:00` | 单测 A11 锁定了这条有意偏离 |
| `OSShopItem` 售罄按钮 | 只置灰、不 `interactable = false` | 老端如此，客户端补禁用会与服务端口径冲突 |
| `OSShopItem.rmbSignRedundant.active = false` | 恒隐藏的 `n39` | prefab 里存在该节点；保留赋值是防美术回填后双层 ￥ |
| `OSRankPage.rankDetailRedDot` 等恒 false 写入 | 保留 | 同上是 prefab 节点存在、口径为“永不点亮” |
| `CelebrationTexts` 的「多钱」、半角冒号 | 照抄 | 原文案对账，单测锁了这些字面量 |
| `CelebrationFrames.iconOf` 的 `resId <= 0` 前置判断 | 保留在 `rewardIconRefOf` 内 | 0 / 负数不是合法资源 id，提前短路 |
| `OSArtStrip.itemHeight` `@property` | 保留 | 只用于对齐 prefab 里的设计值；排布读 `UITransform` 高度，删掉会丢设计稿锚点 |
| `CelebrationViewState` 单独成文件 | 保留 | 三个映射要被 Node 用例直接 import，带 `cc` 的文件进不了测试环境 |
| `OSArtStrip` / `OSShopItem` / `OSTargetItem` 的 re-export | 保留 | `tests/celebration.test.ts` 从这些文件 import 状态映射，删了会断测试 |

## 五、验证结果

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | celebration 目录 0 错误；全仓仅剩 2 条既有错误：`bigmap/application/BigMapConfigLoader.ts(25,106)`、`gift/GiftPage.ts(242,20)`，均未触碰 |
| `npx tsx --test tests/celebration.test.ts` | 46 pass / 0 fail |
| `npx tsx --test tests/view-intent-events.test.ts tests/callback-owner.test.ts` | 11 pass / 0 fail（按钮 / 意图守卫） |
| `npm run verify:defs` | 2 个跨文件引用，0 缺失定义 |
| `npm run verify:hygiene` | `root hygiene OK: 8 个白名单文件` |
| `npm run verify:route` | 推导出的 3 个用例来自工作区其它模块的既有改动，与本次 celebration 改动无关 |

未运行：Cocos 编辑器内 prefab 实例化冒烟（本轮未改 prefab、未改 `@property` 名，风险集中在 `CelebrationFrames` 的加载路径，已由仓库既有 `routedLoad` 覆盖）。

## 六、行数变化

```
CelebrationArt.ts            +87  -141
CelebrationFrames.ts         +60   -95
CelebrationRepository.ts     +56  -132
CelebrationTable.ts         +150  -311
CelebrationTexts.ts          +29  -113
CelebrationViewState.ts      +14   -36
OSArtStrip.ts                +23   -42
OSDetailRow.ts               +29   -59
OSRankEntryButton.ts         +15   -79
OSRankItem.ts                +30   -72
OSRankPage.ts                +97  -185
OSRankRankDetailPage.ts      +30   -46
OSRewardSlot.ts              +16   -44
OSShopItem.ts                +52   -77
OSTabButton.ts               +26   -54
OSTargetItem.ts              +34   -62
RequestCelebrationMsg.ts     +14   -27
合计                        +762 -1575
```

目录总行数：3578 → 2715（净减 813 行，约 −23%）。
