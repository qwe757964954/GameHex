# gift 目录代码优化改动清单

> 状态：改动记录（2026-11）。记录本轮已执行整理与测试改动，供追溯；当前代码为准，不作为待办。

## 1. 范围与结论

- 目标目录：`assets/script/app/gift`
- 关联测试：`tests/gift.test.ts`
- 基线：`8c94511c`（初始工程导入）
- 改动规模：27 个 gift 源码文件 + `tests/gift.test.ts`；`git diff --stat 8c94511c` 为 29 个路径（含 Cocos 自动生成的 `RechargeItemMap.ts.meta`），`415 insertions(+) / 1249 deletions(-)`。
- 改动性质：注释压缩、死代码/死字段删除、内部 API 收口、必填引用 `null!` 化、按钮事件统一、虚拟列表回调一次性绑定、绝对赋值。没有改变任何业务判定、网络参数、排序规则或页面切换规则。
- 结论：gift 目录主体优化已完成；`gift` 相关 16 个测试文件最终结果为 `431 pass / 0 fail`；类型检查只剩范围外既有的 bigmap 错误。

## 2. 验证结果

### 2.1 测试

执行命令：

```powershell
npx tsx --test tests/gift.test.ts tests/recharge-daily.test.ts tests/monthcard-gift.test.ts tests/store.test.ts tests/storeActions.test.ts tests/limittimeact.test.ts tests/main-entrance.test.ts tests/main-entrance-route.test.ts tests/reddot.test.ts tests/reward-popup-wiring.test.ts tests/popup-fullscreen-widget.test.ts tests/res-types.test.ts tests/tab-art-cleanup.test.ts tests/hang.test.ts tests/league.test.ts tests/league-store-donate-discount.test.ts
```

结果（`tmp/gift-after.log`）：

```text
# tests 431
# pass 431
# fail 0
# cancelled 0
# skipped 0
# todo 0
EXIT=0
```

日志中的 `[LimitTimeAct]` / `[MainEntranceVisible]` `console.error` 是既有用例主动构造非法输入的预期输出，不是失败。

### 2.2 类型检查

执行命令：

```powershell
npx tsc --noEmit -p tsconfig.json
```

结果（`tmp/gift-tsc.log`）：退出码 2，唯一错误为：

```text
assets/script/app/bigmap/application/BigMapConfigLoader.ts(25,106): error TS2304: Cannot find name 'BigMapRawTables'.
```

该错误位于 bigmap 范围，属于既有问题，本轮未修改。gift 目录没有新增类型错误。

### 2.3 diff 检查

```powershell
git diff --check -- assets/script/app/gift tests/gift.test.ts
```

退出码 0，无空白符错误。

## 3. 逐文件改动

### 3.1 数据表与解析层

#### `GiftTable.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 长历史表、老端路径、`⚠️` 话术压缩为数据口径说明 | 信息重复；实际口径已在字段和函数注释中 |
| 文件头 | 新增 `import { formatText, GIFT_TEXTS } from './GiftTexts'` | 限购/折扣文案改为走文案表，避免在纯函数里硬编码中文 |
| `IGiftShopRow`（约 L21） | 删除 `title`、`type2` 两个字段及 parse 赋值 | 全仓无消费；`desc` 才是商品行标题。`title` 仅测试断言，`type2` 只 parse 不读 |
| `parseGiftShopRow`（L162） | 随字段删除，parse 只保留 id/type/desc/rewards/priceType/cost/limit/discount | 与视图模型实际消费字段一致 |
| `parsePayChannelRow` / `parseGiftItemRow` | 从导出改为文件内部函数 | 只被同文件的 `parsePayChannelRows` / `parseGiftItemRows` 调用，无外部引用 |
| `visiblePayChannels`（L237） | 删除 `filter()` 后多余的 `.slice()` | `filter` 已返回新数组，再复制一次没有意义 |
| `discountTextOf`（L266） | 改为 `formatText(GIFT_TEXTS.discount, discount)` | 文案统一出口；输出仍为 `5折`，行为等价 |
| `limitTextOf`（L273） | 改为 `formatText(GIFT_TEXTS.limitSale, bought, limit)` | 同上；输出仍为 `限购 0/1` |
| `GIFT_RESOURCE_ICON_IDS`（原 L379） | 删除整个导出常量 | 全仓只有测试引用，生产代码通过 `collectGiftRewardResIds` + `GIFT_RES_ICON_ART` 取图 |
| `GIFT_MAIN_TABS` | 保留，`IGiftMainTab.key` 收口为 `GiftMainTabKey` | `special/total/daily` 三个页签仍由页面消费 |
| `GIFT_SUB_TAB_ART` / `GIFT_RES_ICON_ART` / `GIFT_ART_NAMES` | 注释压缩，修正“洗炼石无图”“元宝”等过期说法 | 与当前资源和策划表一致；避免误导 |
| 文件末尾 LingYu 纯函数 | 保留 `payPriceText`、`payCoinText`、`listLingYuCards`、`normalizePaidChannelIds`、`visiblePayChannels`、`IGiftLingYuCard` | 当前无生产调用，但灵玉页组件仍存在于 prefab，属于待接线视图模型；见第 4 节 |

#### `GiftTexts.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 压缩为“礼包界面文案唯一出口” | 去掉模板化说明 |
| `GIFT_TEXTS`（L8） | 删除无生产消费的键：`title`、`tabSpecial`、`tabLingYu`、`tabJingShi`、`buy`、`soldOut`、`loading`、`firstBuyDouble` | 全仓检索仅测试引用；页签/标题使用 prefab 静态文本，商品按钮文案由 `payPriceText`/`free` 生成 |
| `GIFT_TEXTS` | 保留 `free`、`empty`、`offline`、`failed`、`buyOk`、`limitSale`、`discount`、`currency`、`payMissing` | 均有当前生产代码读取；`limitSale`/`discount` 本轮接入 `GiftTable` |
| `RECHARGE_TEXTS` | 删除 `dailyHint` | 顶部提示是 prefab 静态文本，生产代码不读该键 |
| `formatText`（L84） | 删除不可达的 `value === null` 判断，只判 `undefined` | `args` 类型是 `string | number`，`null` 不在类型内；缺参语义不变 |

#### `GiftArt.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 压缩老端图表明细与 `⚠️` 话术，保留“原稿有意拉伸、CUSTOM 尺寸”这条真实陷阱 | 避免注释比代码长 |
| `GIFT_SUB_TAB_ART` | `once` 注释压缩为“416 未开启、无图” | 与 `open.json` 及资源目录一致 |
| `GIFT_RES_ICON_ART` | 注释改为“资源档图标映射，以 `roleProperty.json` 为准” | `res-types.test.ts` 逐条校验 |
| `giftResIconPath` | 删除 | 全仓无引用；调用方只用 `giftResIconRef` |
| `QUALITY_FRAME_*` / `qualityFrameLevel` re-export | 删除未使用的转发，保留实际使用的 `QUALITY_FRAME_NAMES`、`qualityFrameName` | 减少 re-export 噪音；`GiftPage` 只用命名/取值 |
| `resolveItemIconPath` / `IGiftIconRef` re-export | 删除；`resolveItemIconRef` 改为文件顶部内部 import | 外部没有通过这些别名引用；仍保留 `resolveGiftIconRef` 对外入口 |
| `resolveGiftIconRef` | 保留“item 优先、资源档兜底”的两级逻辑 | 这是奖励格真实取图路径 |

#### `GiftRepository.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 压缩为“表 + 缓存 + 购买请求”说明 | 删除大段老端/协议历史 |
| `IGiftSnapshot` | 删除 `now` 字段；`load()` 去掉 `nowMs` 参数 | 全仓无消费；快照不需要时间基准 |
| `IGiftRepository` | 删除 `peekBuyTimes()` | 只有测试辅助用途，生产无调用；测试已不依赖 |
| `READ_TIMEOUT_MS` / `GIFT_READ_TIMEOUT_MS` | 删除 | 只是未被使用的假常量；读缓存不是网络请求 |
| `readBuyTimes` | `(CacheMgr.instance as any).getCmdShop(GIFT_SHOP_TYPE)` 改为 `CacheMgr.instance.getCmdShop(GIFT_SHOP_TYPE as CmdShopType)` | 去掉 `as any`，保留生成枚举的窄化 |
| `buyGift` 请求参数 | `cmdShopType: GIFT_SHOP_TYPE as any` 改为 `as CmdShopType` | 同上；协议字段和值未变 |
| `buyGift` 注释 | 删除“必须 withTimeout”的模板警告，保留服务端另推 `CmdShop` 的业务说明 | 说明仍有效，但不重复防御性话术 |

#### `RechargeActivityTable.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 由“老端口径/数据链路/差异”压缩为四条核心说明 | 去掉重复历史 |
| `IRechargeTabRow`（L53） | 删除 `name`、`tlType` 字段及 parse 赋值 | `name` 全仓无消费；`tlType` 只 parse 不读，页签过滤由 `activity.type` 完成 |
| `IRechargeActivityRow` / `IRechargeActivityInfo` | 删除 `name` 字段及 parse/assign | 同上 |
| `IRechargeTotalRowView` | 删除 `redDot`、`buttonKey` | 视图只消费 `state`/`title`/`rewards`/`limitText`；这两个字段没有读取方 |
| `RechargeButtonKey` / `rechargeButtonKeyOf()` | 删除 | 只有类型和转换函数，无 UI 消费 |
| `IRechargeBoxView` | 删除 `claimable` | 宝箱视图只用 `taken/reachable/progressText/qualityFrame/iconFrame` |
| `IRechargeTotalPageView` | 删除 `tab` | 页面不读；activityId 已够 |
| `pickActivityForTab` / `isAdvancedTabVisible` / `rechargeRowState` / `rowsOfPlan` / `sortRechargeRows` | 从导出改为文件内部函数 | 无外部引用；保留原有判定和排序 |
| `buildRechargeTotalPageView` | 继续计算 `hasClaimable`，但不再构造无消费的 `redDot/buttonKey/claimable` 字段 | `hasClaimable` 被红点函数消费 |
| `rechargeTotalRedDot` / `IRechargeTotalPageView.hasClaimable` | **保留** | `ReadVars` 的真实链路；见第 4.1 节。此前误删已恢复 |

#### `RechargeActivityRepository.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 压缩为数据来源说明 | 去掉重复历史 |
| `IRechargeActivitySnapshot` | 删除 `now`、`load(nowMs)` | 无消费 |
| `hasRedDot` | **保留**，`load()` 继续写 `rechargeTotalRedDot(activities, planRows)` | `RdVars.ts` 第 85 行真实读取；见 4.1 |
| `advancedTabVisible` | 去掉多余括号，`planRows` 去掉显式类型标注 | 代码更直接，行为不变 |

#### `RechargeDailyTable.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `roundHasClaimable()` | 删除 | 全仓无引用；实际红点/可领判定不使用它 |

#### `RechargeDailyRepository.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 压缩 | 去掉模板化说明 |
| `IRechargeDailySnapshot` | 删除 `now`、`load(nowMs)` | 无消费 |
| 未使用的 `IRechargeDailyReward` import、文件末尾 re-export | 删除 | 没有调用方；保留实际使用的类型和导出 |
| round 去重 | 改为 `new Set(rows.map(...))` + `map()` | 去重后再映射，行为等价，少一次数组复制 |

#### `RechargeItemMap.ts` / 三个 `Request*Msg.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `RechargeItemMap.ts` | 文件头压缩为一句，函数签名保留 | 该文件只做 resId → 奖励映射 |
| `RequestGiftMsg.ts` | 注释/格式压缩 | 协议名、请求/响应泛型保持不变 |
| `RequestRechargeActivityMsg.ts` | 同上 | 同上 |
| `RequestRechargeDailyMsg.ts` | 同上 | 同上 |

### 3.2 页面与视图层

#### `GiftPage.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 改为“超值礼包 / 累计充值 / 每日充值”三页实际结构 | 旧说明只写“超值礼包+灵玉直冲”，与当前页面不符 |
| 必填 `@property` | 改为 `null!` | 项目规范：prefab 必绑引用不用 `null` 掩盖 |
| `totalViewNode` / `dailyViewNode` | 保留 `Node | null`，并保留 `ensureViews()` 按节点名查找 | 实测 prefab 这两个字段为空，节点在 `PageRoot` 下按名字存在；判空是必要逻辑 |
| `selectedTab` | 使用 `GiftMainTabKey` | 与 `GIFT_MAIN_TABS` 的 key 类型统一 |
| `backButton` | 直接绑定 `Button.EventType.CLICK`，不再 `getComponent(Button)` 兜底 | prefab 的 `BackBtn` 节点带 `cc.Button`（已验证组件为 `UITransform/Sprite/Button`） |
| `qualityFrameOf` 薄包装 | 删除，直接调用 `qualityFrameOfRes` | 只有一处调用，包装没有语义增量 |
| `loadIconFrames` | `items` 改为必填，删除 `snapshot` 回退；用 `Set` 去重；`resId <= 0` 过滤明确；首处调用补传 `snapshot.items` | 两个充值页的数据源与当前快照不同，回退会把错表传进来；补传是修复调用点 |
| `tabButtons` / `alive` | 删除 `.slice()`；`alive` 简化为 `this.node.isValid` | 排序前复制无意义；节点有效性直接判断 |
| `onPayChannel` | **保留** | 当前无调用方，但 `GiftLingYuView.onPay` 是预留回调，`gift.test.ts` D7 锁定 `GIFT_TEXTS.payMissing`；见 4.3 |
| 大页签底部注释 | 删除“底部两张底图”的孤立注释 | 与实际 3 个页签不符 |

#### `GiftSpecialView.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 必填引用 | `null!` | prefab 必绑 |
| `rowRendererBound` | 删除，在 `onLoad()` 一次性绑定 `rowList.renderItemFn` | 回调长驻，不需要“只绑一次”门闩；`onLoad` 只执行一次 |
| `rowList` / tabs 判空 | 删除 | 均为 prefab 必绑；`getComponentsInChildren` 返回数组 |
| `tabs` 的 `.slice()` | 删除 | 排序前复制无意义 |
| `renderRow` 的 `getComponent` 判空 | 删除 | 虚拟列表模板节点必挂 `GiftShopRow`；prefab 结构已验证 |
| `rowViews` | 保留按索引实时读取 | 虚拟列表会复用槽位，闭包捕获会点错行 |

#### `GiftLingYuView.ts` / `GiftLingYuCard.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 必填引用 | `null!` | prefab 必绑 |
| 模板化长注释 | 压缩为组件职责 | 去掉机械式结构说明 |
| `GiftLingYuView` 缩进/`cards` 排序表达式换行 | 修正格式 | 与原文件缩进和行宽统一 |
| 文件本身 | **保留** | prefab 的 `LingYuPage` 上仍有 1 个 `GiftLingYuView`、6 个 `GiftLingYuCard`，测试按组件 cid 和数量校验；删除会变成 MissingScript，超出本轮代码优化边界 |

#### `GiftShopRow.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `background` 字段 | 删除 | 全仓无读取；原字段只用于 `render()` 里自取 Sprite 的兜底，兜底已删除。prefab 中该序列化键会成为无效数据，运行不受影响 |
| 必填引用 | `null!` | prefab 必绑 |
| `slots` getter | 改为 `onLoad()` 缓存排序结果 | 每次 `render()` 都查子组件并排序是重复开销；预fab 行模板子节点固定 |
| `actionIcon.spriteFrame` | 改为绝对赋值 | 虚拟列表复用时会残留上一行图标；绝对赋值保证幂等 |
| 注释 | 压缩状态表/`⚠️` 说明，保留“售罄/免费/购买互斥、全量赋值”两条真实约束 | 行为规则仍需要维护者知道 |

#### `GiftSubTab.ts` / `GiftTabButton.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 必填引用 | `null!` | prefab 必绑 |
| `button` 自取 `getComponent` 兜底 | 删除 | prefab 节点自带 `cc.Button`；项目规范禁止组件自取兜底 |
| `GiftTabButton` 注释 | “两个页签”改为实际 3 个大页签 | 与 `GIFT_MAIN_TABS` 一致 |
| `render()` 判空 | 删除 | `label`/`bg` 均必绑 |
| `GiftSubTab.render()` 底图切换 | 保留“任一为空只切能得到的那张” | 两张底图由宿主按状态传入，保留防御性分支但不使用 `!` |

#### `GiftRewardSlot.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 必填引用 | `null!` | prefab 必绑 |
| `onLoad` 自取 `frame` 兜底 | 删除 | prefab 已绑定；同节点 Sprite 也由 Inspector 指定 |
| 注释 | 压缩“逐格给图”“不画问号”为业务原因 | 保留关键陷阱 |

#### `RechargeProgressBar.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `bg` / `bar` | `null!` | prefab 必绑 |
| `valueLabel` | 明确为 `Label | null` | 顶部进度条不显示文本，确实可空 |

#### `RechargeDailyView.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 压缩为页面结构、顶部文本、倒计时缺失说明 | 去掉三处 FGUI 差异的长篇历史 |
| `topProgress` / `rowList` | `null!` | prefab 必绑 |
| `rowRendererBound` | 删除，`onLoad()` 一次性绑定 `renderItemFn` | 长驻回调只绑一次，不需要布尔门闩 |
| 顶部/stage/list 判空 | 删除 | prefab 必绑；`stages` 固定 3 个 |
| `presentRows` | 直接 `refreshList(this.rowViews)`，去掉 `as unknown[]` | 类型已匹配 |
| `renderRow` 的 `getComponent` 判空 | 删除 | 模板节点必挂 `RechargeDailyRow` |
| `rowViews` 类型 | 改为可变数组 | `refreshList` 需要可变数组；仍按索引实时读取 |

#### `RechargeTotalView.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 文件头 | 压缩为页面结构和“限购控件保留、红点未接”说明 | 去掉四处 FGUI 差异的长篇说明 |
| `topProgress` / `introLabel` / `rowList` | `null!` | prefab 必绑 |
| `rowRendererBound` | 删除，`onLoad()` 一次性绑定 `renderItemFn` | 同 `RechargeDailyView` |
| intro/top/chest/list 判空 | 删除 | 必绑；`chests` 固定 2 个 |
| `presentIntro` | 直接控制父节点显隐 | 保留“空 `desc` 藏整块气泡”的行为 |
| `renderRow` 的 `getComponent` 判空 | 删除 | 模板节点必挂 `RechargeTotalRow` |
| `rowTitle` 注释 | 保留“`{0}` 出现两次，必须走全局替换”的陷阱 | 这是真实格式约束 |

#### `RechargeTotalRow.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `btnClaim` / `btnUndone` | 从 `Node` 改为 `Button`，绑定 `Button.EventType.CLICK` | prefab 两个节点均带 `cc.Button`（已验证组件） |
| `rowState` 字段 / `state` getter | 删除 | 全仓无读取；按钮回调由宿主按行数据分派 |
| 按钮显隐 | 改用 `.node.active` | `Button` 组件没有 `active` 属性 |
| 限购字段 | **保留** | prefab 的 `Limit` 节点仍挂载（`_active=false`），`present()` 永远传 `null`；删除会改 prefab 序列化 |
| 奖励格循环 | 保留“逐格给图 + 显式重开”，删除模板警告 | 虚拟列表复用必须重开 |

#### `RechargeDailyRow.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| `btnGoto` / `btnClaim` | 从 `Node` 改为 `Button`，绑定 `Button.EventType.CLICK` | prefab 两个节点均带 `cc.Button` |
| `buttonKey` 字段 / `state` getter | 删除 | 视图模型本身已有 `state`/`buttonKey`，行组件不再重复保存 |
| 按钮显隐 | 改用 `.node.active` | `Button` 组件没有 `active` 属性 |
| 进度条显隐 | 保留“仅 `goto` 态显示” | 与 prefab/FGUI 行为一致 |

#### `RechargeChest.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 点击区 | 从 `Node` 改为 `Button`，绑定 `Button.EventType.CLICK` | prefab 宝箱点击区带 `cc.Button` |
| `taken` / `reachable` 字段、`isTaken` / `isReachable` getter | 删除 | 全仓无读取；`render()` 入参已表达状态 |
| `progressLabel` | `null!`，删除判空 | prefab 必绑 |
| `button.interactable` | 直接设置 | 按钮组件必绑 |
| 禁用态语义 | 改为 Button 禁用后不再派发 CLICK | 原先 `TOUCH_END` 会派发但宿主拒绝；最终用户结果一致 |

#### `RechargeDailyStage.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| 必填引用 | `null!` | prefab 必绑 |
| `stageState` / `state` getter | 删除 | 全仓无读取 |
| 点击事件 | **保留 `Node.EventType.TOUCH_END`** | prefab 的 `Reward0/1/2` 节点只有 `UITransform`，没有 `cc.Button`；改 CLICK 会成为死按钮。见 4.5 |

### 3.3 测试调整

#### `tests/gift.test.ts`

| 位置 | 改动 | 依据 |
|---|---|---|
| D3 | 删除 `REPO_SRC.includes('GIFT_READ_TIMEOUT_MS')` 断言 | 该常量只是未被使用的假常量，已删除 |
| A4 | 删除 `IGiftShopRow.title` 字段断言，保留 `desc` 断言 | `title` 字段已删除；行标题口径仍是 `desc` |
| B4 | 删除 `GIFT_RESOURCE_ICON_IDS` 常量断言，保留资源图标映射断言 | 常量已删除；映射仍由 `GIFT_RES_ICON_ART` 校验 |
| E1 | 文案键清单同步为实际保留键 | 删除未消费文案键 |
| 其余断言 | 未改 | D7 仍依赖 `GIFT_TEXTS.payMissing`，因此 `GiftPage.onPayChannel` 保留 |

## 4. “看似冗余”代码的重新审核

本节不是沿用上一轮保留决定，而是按“是否被生产代码调用、是否有隐式依赖、是否有资产/协议契约”重新逐项核查。核查手段：全仓 `rg`、`tsc`、prefab 组件/字段解析、测试运行。

### 4.1 `rechargeTotalRedDot` / `hasRedDot` / `hasClaimable`：确认必须保留

- 结论：**必须保留**，此前计划删除是误判。
- 实际链路：
  - `RechargeActivityRepository.load()` 在 `assets/script/app/gift/RechargeActivityRepository.ts:85` 写入 `hasRedDot: rechargeTotalRedDot(activities, planRows)`。
  - `assets/script/app/rd/RdVars.ts:81-86` 的 `RdRechargeGiftVar.loadSnapshot()` 在 `await rechargeActivityRepository.load()` 后读取 `snapshot.hasRedDot`，并写入红点状态。
  - `rechargeTotalRedDot()` 在 `RechargeActivityTable.ts:423` 读取 `view.hasClaimable`；`hasClaimable` 由 `buildRechargeTotalPageView()` 计算。
- 复核证据：
  - 删除 `hasRedDot` 后，`tsc` 立即报 `assets/script/app/rd/RdVars.ts(85,36): Property 'hasRedDot' does not exist on type 'IRechargeActivitySnapshot'`。
  - 恢复字段和函数后，gift 16 个测试文件全绿，且 `tsc` 不再报 gift 错误。
- 使用场景：累计充值入口的红点聚合；`RdVars` 在 `CmdActivity` 推送后重新装载快照，红点由 `OnComputeResult()` 返回 0/1。

### 4.2 `GiftLingYuView` / `GiftLingYuCard`：确认暂不删除，属于资产契约

- 结论：**不删除源文件**；当前没有生产 import，但 prefab 仍绑定组件。
- 核查证据：
  - `Gift.prefab` 的 `LingYuPage` 节点 `_active=false`，节点上 1 个 `GiftLingYuView` 组件。
  - `LingYuPage` 下 6 个 `GiftLingYuCard` 组件（压缩 UUID 前缀计数分别为 1 和 6）。
  - `tests/gift.test.ts` 的 C3/C8 按组件 cid 和数量校验 prefab 结构；删除 `.ts` 会让 prefab 出现 MissingScript，并让测试失败。
- 使用场景：灵玉直冲页当前被 `_active=false` 禁用；保留组件与数据装配代码，等页面开放时直接接线。
- 可删除条件：产品确认灵玉页永久下线，并同步删除 prefab 中 `LingYuPage` 及 6 张卡、删除 C3/C8 和相关测试。本轮只做代码优化，未改 prefab，因此不满足“删代码即可”的条件。

### 4.3 `GiftPage.onPayChannel` / `GIFT_TEXTS.payMissing`：保留为未接线入口

- 结论：**暂保留**；它不是运行时死路径，但当前确实没有调用方。
- 核查证据：
  - `GiftPage.ts:567` 的 `onPayChannel` 私有方法没有任何 `this.onPayChannel(...)` 调用。
  - `GiftLingYuView.onPay` 是灵玉卡的支付回调契约，当前灵玉页未接入 `GiftPage`。
  - `tests/gift.test.ts` D7 直接断言页面源码包含 `GIFT_TEXTS.payMissing`；E1 也保留该键。
- 使用场景：灵玉页接回时，卡片 `onPay` → `GiftPage.onPayChannel` → 提示“支付功能尚未接入”，避免静默失败。
- 可删除条件：删除灵玉页整套入口，同时删除 D7/E1 的对应断言；本轮不做，以免把“禁用页”误判成“无此功能”。

### 4.4 `payPriceText` / `payCoinText` / `listLingYuCards` / `normalizePaidChannelIds` / `paidChannelIds`：保留为灵玉页视图模型

- 结论：**暂保留**；当前生产侧只有测试调用，但没有删除它们。
- 核查证据：
  - `payPriceText`、`payCoinText` 只被 `tests/gift.test.ts` A11 调用。
  - `listLingYuCards` 只被 A13 调用，内部使用 `visiblePayChannels` 和 `paidChannelIds`。
  - `normalizePaidChannelIds` 只被 `GiftRepository.load()` 写入快照字段，快照字段本身当前没有生产读取方；`listLingYuCards` 的默认参数使用它。
- 使用场景：灵玉页的卡面价格、到账数量、首充双倍标记；页面组件仍在 prefab 中，只是未接线。
- 可删除条件：与 4.2 相同，灵玉页永久下线时一起删除，并同步删除 A11/A13、`paidChannelIds`、`readRole()`。

### 4.5 `RechargeTotalRow` 限购 UI：保留

- 结论：**保留字段和节点**，但确认当前永远不显示。
- 核查证据：
  - `Gift.prefab` 中 `RechargeTotalRow` 模板下的 `Limit` 节点 `_active=false`。
  - `RechargeTotalView.present()` 向 `RechargeTotalRow.render()` 传 `limitText=null`，因此 `limitNode.active` 永远为 false。
  - `RechargeTotalRow.render()` 仍保留 `limitNode/limitTitle/limitValue` 的赋值和隐藏逻辑。
- 使用场景：如果后续策划开启累计充值限购，prefab 位置和组件字段已经就绪；删除会改 prefab 序列化。
- 可删除条件：确认永久不做限购，并同步删除 prefab 的 `Limit` 节点和字段。

### 4.6 `RechargeDailyStage` 的 `TOUCH_END`：保留，属于 prefab 例外

- 结论：**保留 `TOUCH_END`**，不能机械改成 `CLICK`。
- 核查证据：
  - prefab 的 `Reward0/1/2` 节点组件只有 `cc.UITransform`（组件 id 901/945/989 均为 `cc.UITransform`），没有 `cc.Button`。
  - 项目规范要求交互节点挂 `cc.Button` 后代码绑 `CLICK`；该节点当前没有 Button，改 `CLICK` 会收不到事件。
- 使用场景：每日充值顶部三个阶段格的点击领取。
- 彻底符合规范的做法：先给 prefab 三个阶段格补 `cc.Button`，再改代码为 `CLICK`；本轮未改 prefab。

### 4.7 `GiftPage.totalViewNode` / `dailyViewNode` 判空：保留

- 结论：**保留 `Node | null` 和 `ensureViews()` 查找**。
- 核查证据：
  - `Gift.prefab` 的 `GiftPage` 组件中 `totalViewNode`、`dailyViewNode` 序列化为空。
  - 两个节点位于 `PageRoot` 下，名称为 `RechargeTotalPage` / `DailyPage`；`ensureViews()` 按名称解析。
- 使用场景：页面首次加载时补齐两个充值页引用；删除判空会在 prefab 当前状态下空引用。

### 4.8 `GiftShopRow.background`：确认可删除，已删除

- 结论：**已删除**。
- 核查证据：删除 `render()` 中的 `getComponent(Sprite)` 自取兜底后，全仓没有任何 `background` 读取；该字段只作为 Inspector 绑定存在。
- 影响：prefab 中该字段成为无效序列化键，不影响运行；如需彻底清理，可在 Cocos 中重新保存 `Gift.prefab` 让引擎丢弃无效键。

## 5. 未覆盖与风险

1. `RechargeDailyStage` 仍是 `TOUCH_END`，因为 prefab 该节点没有 `cc.Button`；若要统一为 CLICK，需要改 prefab，属于资源变更，本轮未做。
2. `RechargeTotalRow` 的限购 UI 字段保留，当前永远隐藏；删除需要同步改 prefab 序列化，本轮未做。
3. `GiftLingYuView` / `GiftLingYuCard` 及其数据装配函数保留，当前无生产接线；这是禁用页的资产契约，不是本轮遗漏。
4. `GiftPage.onPayChannel` 无调用方，保留为灵玉页预留入口；D7 测试锁定 `payMissing` 文案。
5. `GiftShopRow.background` 已从源码删除，prefab 仍有旧的序列化键；运行不受影响，但建议下次在 Cocos 中保存 prefab 时让引擎清理。
6. 类型检查仍有范围外既有 bigmap 错误；本轮未修改 bigmap。
7. 本轮未执行 `npm run verify:hygiene`；该命令已知会被根目录非白名单日志文件阻断，属于范围外环境问题。

## 6. 改动清单汇总

- 数据层：`GiftTable.ts`、`GiftTexts.ts`、`GiftArt.ts`、`GiftRepository.ts`、`RechargeActivityTable.ts`、`RechargeActivityRepository.ts`、`RechargeDailyTable.ts`、`RechargeDailyRepository.ts`、`RechargeItemMap.ts`、`RequestGiftMsg.ts`、`RequestRechargeActivityMsg.ts`、`RequestRechargeDailyMsg.ts`
- 视图/页面：`GiftPage.ts`、`GiftSpecialView.ts`、`GiftLingYuView.ts`、`GiftLingYuCard.ts`、`GiftShopRow.ts`、`GiftSubTab.ts`、`GiftTabButton.ts`、`GiftRewardSlot.ts`、`RechargeProgressBar.ts`、`RechargeDailyView.ts`、`RechargeTotalView.ts`、`RechargeTotalRow.ts`、`RechargeDailyRow.ts`、`RechargeChest.ts`、`RechargeDailyStage.ts`
- 测试：`tests/gift.test.ts`
- 未改：prefab、meta（`RechargeItemMap.ts.meta` 为 Cocos 自动生成，不计入手工改动）、其它模块源码。
