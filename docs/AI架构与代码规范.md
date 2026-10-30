# AI 架构与代码规范（全局总纲）

> **定位与适用范围**：
> - 本文档是 Cocos Creator 3.8 + TypeScript 项目的**全局架构、工程实现、Prefab 规范与美术配表工具链总纲**。
> - 日常开发与 AI 会话入口摘要见根目录 [AGENTS.md](https://www.google.com/search?q=..%2FAGENTS.md)；对局表现层（`app/zcds/view`）与「冒险」领地页（`app/territory`）的详细规格（原 §7.3.3 ~ §7.3.11）已拆分为独立文档 [docs/zcds-表现层与领地规范.md](https://www.google.com/search?q=.%2Fzcds-%E8%A1%A8%E7%8E%B0%E5%B1%82%E4%B8%8E%E9%A2%86%E5%9C%B0%E8%A7%84%E8%8C%83.md)。

## 1. 开发工作流与导航约定

1. **先定边界再动手**：修改代码前，先确认需求所属的 feature、流程（`Procedure*`）、数据真源（Model / Repository）与资源生命周期，禁止仅凭文件名猜测。
2. **优先使用 Codegraph**：仓库存在 `.codegraph/` 时，先通过 `codegraph explore` 追踪符号定义、调用链与关联单测，定位后再打开目标文件，避免大范围盲目搜索。
3. **工作区安全**：下刀前检查 `git status` / `svn status`；严禁覆盖、格式化或回退与当前任务无关的用户改动；严禁手改 `library/`、`temp/`、`build/`、`native/` 及生成产物。
4. **复用既有设施**：优先复用工程内已有的 Presenter 模式、端口定义、文本常量表、`AssetService` 加载器与测试夹具（Test Fixtures），禁止平行造轮子。

## 2. 分层架构与依赖硬约束

项目遵循严格的由外向内单向依赖原则：

```text
app/bootstrap（组合根：装配全局端口与流程）
  -> app/procedure（流程编排）、app/<feature>/application（用例/Presenter）、app/<feature>/view（Cocos 视图组件）
  -> core（领域端口、运行时契约、纯业务与几何规则）
platform（Cocos 引擎资源/网络/配置/热更新适配器） -> core
framework（通用 UI 基类 / 弹窗 / 路由机制）       -> core
```

| 层级 / 目录 | 允许依赖 | 严禁依赖 / 严禁行为 |
| :--- | :--- | :--- |
| `core/**` | 仅限 `core/**` 内部纯 TS 模块 | 严禁 `import 'cc'`、`framework`、`app`、`platform`；严禁直接 I/O（网络/本地存储）与全局可变单例 |
| `framework/**` | `core/**`、`cc` | 严禁依赖任何具体业务 `app/<feature>` 或具体 `Procedure*` |
| `platform/**` | `core/**`、引擎或底层 SDK | 只实现 `core` 端口（Adapter），严禁混入具体业务规则或 UI 状态 |
| `app/<feature>/model` 或 `application` | `core/**`、本 feature 内部纯契约 | 纯 TS 的 Presenter / Model 剥掉 `import type` 后不得依赖 `cc` 或直接调 `resources.load` |
| `app/<feature>/view` | 本 feature 的 `application`/`model`、`framework`、`cc` | 只负责引擎生命周期、输入转发与渲染编排；严禁跨页面直接切换 `Procedure*`（必须走 `GameRoute`）；严禁直调 `resources.load` 或 `fetch` |

### 2.1 视图 ↔ 控制器只走事件中控（禁止回调穿透）

视图（`app/<feature>/view`、`ui/**` 页面组件）**只派发意图**，控制器（Presenter / `ZC*` 组合根）订阅后处理。
视图**不得持有、也不得接收**控制器的回调：

```ts
// ✅ 视图侧：只报「玩家点了什么」
EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
EventMgr.instance.emit(ZCGameUiEvent.SettlementGrowEntry, 'equip'); // 同族入口共用一条事件 + payload

// ✅ 控制器侧：订阅集中在一个 bind*Events()，退出时 offTarget(this)
EventMgr.instance.on(ZCGameUiEvent.SettlementConfirm, this.onSettlementConfirm, this);

// ❌ 严禁：把流程 / 业务入口塞进视图
ZCSettlementPage.open({ onConfirm: () => this.returnToMain(), onGrowEntry: (key) => … });
```

- **判定**：视图代码里出现 `this.options?.onXxx?.(...)` 这类「可选回调 + 可选调用」即**违规**。
  它漏传一个就是**点了没反应且零报错**（`openRank` 曾整条漏传）。
- **「有没有人接」用布尔门闩，不要用回调占位**：视图要靠「接了没接」决定显隐 / 置灰时，
  userData 给 `hasXxx?: boolean`，页面据此写 `interactable` / `active`；行为仍由控制器订阅事件处理。
  拿「回调有没有值」当门闩 = 视图又持有了一次控制器入口。
- **视图不留 userData**：事件化之后 `private options` 这类字段通常只剩赋值与清空，属死字段，一并删掉。
- **契约集中**：同一 feature 的意图事件名放在一个纯 TS 契约文件（如 `view/ZCGameHudEvents.ts`），**不许 import `cc`**
  （要能被纯逻辑单测直接 require）；同族入口用「一条事件 + payload」，不要一个按钮一个事件。
- **注释只在契约文件写一次**：意图事件的名字、载荷、语义，在契约文件的 JSDoc 里写全（`ChestEvents.ts`、
  `ZCGameHudEvents.ts` 这类），**`emit` 处与 `on` 处不再复述**。「×× 意图走事件、视图不持有回调」属于规范本身，
  不写进代码注释。视图 / 页面里的注释只写契约没写的东西：为什么这条要多发一次、关闭时谁清哪个状态、
  prefab 上的物理事实。判据：同一句语义在仓库只出现一次，事件名相关注释的命中收敛在契约文件。
- **订阅纪律**：订阅在控制器初始化时集中注册一次，退出时 `offTarget(this)`；非一次性订阅
  （如 `ProcedureManager.onSwitchSettled`）必须由订阅方显式 `stop()`。
- **「只绑一次」不需要布尔门闩**：`PopupBase` 用 `_inited`（`PopupBase.ts:468` `if (!this._inited)`）保证 `onInit()` **每实例只跑一次**，`onLoad` 同理由引擎保证 ⇒ 里面再写 `if (this.buttonsBound) return` 或 `if (!this.rendererBound) { … }` 属双重保险，删。
  - 绑定的**唯一正确时机**是 `onInit` / `onLoad`；放到 `onOpen` / `present` / `render` / `update` 才是真会重复的地方。
  - `node.on()` 的监听随节点销毁一并释放；即便重复订阅，`EventTarget` 也会按 `callback + target` 去重 —— 前提是 handler 写成**箭头函数属性**（引用稳定），不是每次新建的闭包。
  - `renderItemFn` / `onItemClickFn` 是**普通属性赋值**，不是事件订阅 ⇒ 重复赋同一个函数不叠加，同样不需要门闩。
  - **必须留下的门闩**：用来做「当前是否绑着」**解绑判断**的（`PopupBase._blankBound` 在 `_unbindBlankClose` 里）、跨场景全局单例（`GameNet._reconnectEventsBound`）、绑/解成对且会被反复调用的（`MainTerritoryMap.mapInsetResizeBound`，`onDestroy` 里有 `off` 配对）。
  - 存量：2026-10-30 清了 **17 个文件 / 20 处**（12 个弹窗页的 `if (!x) { … }` 形态 + 5 个 `if (x) return` 形态）。剩余 12 处 `bound` 仍在「行组件 `bind()` / `bindButtons()`」这类可能反复调用的方法里，要先核 handler 引用是否稳定再删。

### 2.1.1 释放即解除事件，不在同步回调重复判断 disposed（2026-10-30）

- Controller 在 `dispose()` 中统一 `EventMgr.offTarget(this)`、网络 `removeCaller(this)`、取消定时器及退订缓存 / Model。同步事件处理函数不再重复 `if (this.disposed) return`，定时器回调也依靠取消调度停止。
- 解绑必须在事件基础设施中立即生效。`EventBus.emit` 仍遍历快照，但执行每项前确认它仍是原订阅；派发中 `off` / `offTarget` 后，尚未执行的旧监听本次也不再执行。同一函数移除再注册视为新订阅，下一次派发才执行。不在业务回调里模拟这条契约。
- 仓库清空监听集合后，无须在纯通知方法里重复检查 disposed；数组快照派发也须跳过已经退订的监听。网络请求回调由归属管理解除，局部回包赋值不再重复检测宿主释放。
- 仍保留真正跨生命周期的保护：`await` 后、`catch` / `finally` 中可能触发的 UI 更新、无法取消的异步任务、公开入口拒绝对已释放对象发起新操作，以及 `dispose()` 幂等检查。解绑不能撤回已经开始运行的 async 函数。
- 章节地图释放先断开输入、时钟和缓存，保留 Model 输出订阅完成本会话 loading 收尾，再退订输出。`stopping` 用于区分收尾消息，不是事件解绑的替代品。
- 测试应通过真实事件分发、请求归属和调度取消验证关闭后的行为，不保存旧 handler 再绕过事件系统直接调用。测试定时器的 stop 必须实际撤掉回调。
- 回归：`tests/framework-event-bus.test.ts`、`tests/bigmap-controller.test.ts`、`tests/territory-controller.test.ts`、`tests/territory-cell-subscriptions.test.ts`、`tests/callback-owner.test.ts`、`tests/view-intent-events.test.ts`。

### 2.1.2 按钮点击回调不判 `interactable`（2026-10-30）

`cc.Button` 在 `interactable = false` 时**根本不派发** `TOUCH_END` / `CLICK`，回调能进来就说明按钮可点。
回调开头再判一次 `interactable` 是**恒真的死代码**：它不表达任何业务语义，只会让后来读代码的人以为
「这个 handler 还有别的调用途径」。

```ts
// ✅ 置灰由渲染时全量写 interactable 表达，回调只负责派发意图
this.fastButton.interactable = content.fastOpenEnabled;   // render / applyContent 里赋值

private handleFastOpen(): void {
    EventMgr.instance.emit(CHEST_EVENTS.FAST_OPEN);
}

// ❌ 冗余守卫：按钮不可点时这行永远不会执行
private handleFastOpen(): void {
    if (!this.fastButton.interactable) return;
    EventMgr.instance.emit(CHEST_EVENTS.FAST_OPEN);
}
```

- **该判什么**：真正要拦的是**业务条件**（次数不足、扣费不够、请求在途）。门闩属控制器 / Presenter 判，
  或由渲染时的 `interactable` 表达；视图回调里**不读 `interactable` 反推业务状态**。
- **唯一例外**：handler 同时被 `Button` 以外的路径调用（键盘快捷键、代码直调、长按与点击共用入口）时，
  「按钮不可点」并不等于「本次调用该拒」—— 这种情况判**业务门闩**（`if (!this.canXxx) return;`），
  **仍然不判 `interactable`**。
- **排查口径**：`grep -rn "\.interactable) return" assets/script --include=*.ts` 应恒为 0 命中。
- 回归：`tests/chest-detail-panel.test.ts`、`tests/view-intent-events.test.ts`。

### 2.2 回调归属对象直接传递（事件、缓存与网络请求）

`caller` 表达回调的归属对象与 `this`，不代表调用方必须实现 `destroyable`。公共事件、缓存订阅和 `RequestMsg` 的归属参数使用 `object`，允许 Cocos 组件、`ScriptObject`、普通对象及类对象直接传入；可选宿主在调用链上保持 `object | undefined`，禁止先声明成 `unknown` 再断言。

事件入口统一为 `addListener` / `removeListener`；基础事件接口不引用 `cc.Object`、FairyGUI 类型，也不按宿主类别增加 `NodeListener` / `GObjectListener` 包装。

```ts
GameNet.instance.addEvent('CmdCityChapterPassCellBroMsg', this, this.onPassCellsBro);
CacheMgr.instance.setEventUpdate('CmdRole', this, this.onRoleCacheUpdate);
new RequestTerritoryCellInfo({ levelChapter }, this, this.onCellInfo);
// 普通组件退出时，一次解除广播监听与未完成请求的回调。
GameNet.instance.removeCaller(this);
```

- 禁止为满足归属参数而写 `this as unknown as destroyable`、`caller as destroyable`、`caller as any`、`caller as never`；也不得给组件或服务伪造 `destroyed` / `destroy()`。遇到类型不匹配，应修正最底层公共签名及上游端口。
- 网络请求与事件统一按宿主登记、主动解除，不靠回包时检查组件 `isValid` 兜底。纯 TS 端口为 `core/runtime/CallbackOwner.ICallbackOwnerRegistry`；既有 `EventProxy` 承担归属管理，不另建全局注册表。
- 普通组件在 `onDestroy` 调用 `GameNet.removeCaller(this)`。`PopupBase` 在关闭及销毁时、`ProcedureManager` 在流程切出、进入失败、预加载取消及销毁时统一解除；端口由 `ProcedureBootstrap` 注入。缓存弹窗关闭时节点可能仍然有效，同样必须解除。`ScriptObject` 沿用既有销毁钩子；普通订阅对象由持有者显式退订。缓存订阅仍按原缓存 API 解绑。
- `NetworkRequest` 接管 `RequestMsg` 的回调与宿主引用：正常完成后注销清理动作；宿主退出时清空成功/失败回调、取消发送资格并让 `send()` 的 Promise 以 `false` 落定。取消不触发业务失败回调，重复解除和迟到回包不再触达旧宿主。复合异步流程的 `context` / `revision` 守卫仍遵循 §3.2。
- 未发送的取消请求不再发出，也不在重连后恢复；已发请求不能撤销服务端执行，回包继续由传输层处理公共缓存和其他仍有效的订阅。网络层保留原有 `disabled` / `destroyed` 行为，不新增组件状态探测。
- 不修改全局 `destroyable` 契约，不将其必填字段改成可选来消除报错；它仍用于确实具备销毁能力的对象。
- 回归：`npx tsx --test tests/callback-owner.test.ts tests/network-request-policy.test.ts tests/popup-lifecycle.test.ts tests/procedure-manager-preload.test.ts`，覆盖宿主解除、取消等待、迟到回包、重开宿主、公共缓存与业务源码断言禁令。

## 3. 运行时实现硬约束

### 3.1 契约先行与边界归一化
- 先定义清晰的输入、输出、错误/取消语义与数学不变量，再写实现。
- 服务端协议、配表 JSON、本地存档等外部数据必须在 Repository / Config 边界完成归一化与合法性校验，内部模型不背负脏数据兜底分支。

### 3.2 异步安全与生命周期守卫
- 所有 `async / await` 或回调逻辑必须显式处理以下 4 种中断场景：**节点/弹窗已销毁、流程预加载已取消、玩家重复点击、请求失败**。
- `PopupBase` 子类统一使用 `nextPopupFrame()`，并在每次 `await` 恢复后立即检查 `if (!this.isValid) return;`。
- 流程级预加载（`Procedure*`）必须在异步阶段检查 `if (context.cancelled) return;`，防止切流程后幽灵回调污染新页面。
- **同步事件 / 缓存回调不判 `isValid`**（原则见 §2.1.1）：`CacheMgr.setEventUpdate` / `view.on('xxx')` / `EventMgr.on` 注册的**同步**回调，`onDestroy` 里已按 `caller + callback` 精确摘除，且事件层 `EventListener.execute`（`framework/event/EventProxy.ts:524`）派发前就有 `if (t.caller.destroyed === true) return false;` ⇒ 已销毁归属对象的监听**根本不会被调用** ⇒ 回调开头 `if (!this.isValid) return;` 恒真、属死代码，删掉。（Cocos 的 `destroyed` 在 `onDestroy` 之前就已置位，与 `isValid` 在本场景等价。）
  - **必须保留的三类**：① 任何 `await` 恢复之后；② `.then()` / `catch` / `finally` 里；③ **没有解除的**延迟调度（`scheduleOnce` / `setTimeout` / tween 结束回调）—— 它们绕过事件层的 `destroyed` 检查。
  - 判据：同步回调（`private onXxx = (): void =>`）体内出现 `isValid` 即违规；异步函数体内的 `isValid` 才是正常防护。
- **生命周期方法与已解除的调度回调内不判 `isValid`**：
  - `onLoad` / `onEnable` / `start` / `onDisable` / `update` / `lateUpdate` 由引擎保证只在组件存活期回调（`onDestroy` 本身就是销毁流程中的一站），`start` 更是在激活后、首帧 `update` 之前同步跑一次 ⇒ 体内 `if (!this.isValid) return;` 恒真，删。
  - `schedule` / `scheduleOnce` 的回调也不必判：引擎 `Component._onPreDestroy()`（3.8.8 `cocos/scene-graph/component.ts:405`）第一句就是 `this.unscheduleAllCallbacks()`，组件一销毁定时器随即可撤销；在 `onDisable` / `onDestroy` 里手动 `unschedule` 过的同理。
  - 真正要判的只有**跨帧才回来**的部分：`await` 之后、`.then / catch / finally`、没随组件销毁解除的 `setTimeout` / 外部传入的 tween 回调，以及外部可在任意时机调用的公开方法。
  - 判据：`onLoad|start|onEnable|update|lateUpdate` 与 `schedule` 回调体内出现 `isValid` = 违规。
- **`await` 之后必须判 `isValid` —— 但判据是「宿主有没有 destroy 路径」，不是「玩家主观会不会点别的」**：
  - 本工程的真实销毁路径：`MainTabHost.currentPage?.destroy()`（**换 tab 就销毁当前页**）、`ProcedureMain.destroyMainNode()`（进战斗 / 回登录时销毁整个主界面）。所以 tab 页里的任何异步等待，回来时页面可能已经没了。
  - **必须判**：资源加载完再弹窗 / 再刷 UI。反例（删了会出事）：`MainPage.openChestDetail` 里 `await this.chestDetailContentOf(detail)` 挂的是 `assets.load`，窗口内玩家切一个 tab 页面就被销毁；而 `if (this.detailSlot !== index) return;` 挡的是「又点了别的箱子」，**挡不住销毁** —— 销毁不会把字段改回哨兵值，判断仍为 false，接着就在已销毁页面上 `ChestDetailPanel.open(...)`，弹出一个与当前 tab 无关的孤儿窗（且此时 `chestArtScope` 已 disposed，图标全是 null）。
  - **弹窗同样要判**：`PopupManager` 默认 `cache = false`（`cache: params.cache === true`）⇒ 关闭即 `node.destroy()`；只有显式传 `cache: true` 的弹窗才 `removeFromParent + active = false` 进池复用。所以弹窗里的 `await` 之后也要判，并另外用 `presentRevision` 之类的口令挡住「内容串到别的弹窗」。
  - ⚠️ **既有债务**：视图层仍有 110 处「`await` 之后写 UI 却没有 `isValid`」的写法（口径见 `tmp/_view_await_gap.py`），新代码不要照抄，改到哪算哪。
  - **不判**：Repository / Model（纯数据，不碰视图）、生命周期方法、同步事件回调、`schedule` 回调。
  - 判据：写 tab 页异步时先问一句「这段窗口里用户能不能切 tab / 退出流程」，能就必须判。

### 3.3 渲染幂等、纯函数时间轴与唯一写入口
- **全量幂等 `render`**：视图 `render(state)` 必须是幂等的全量赋值。对象池复用节点或虚拟列表项在绑定新数据时，必须显式写全所有受控属性（含 `node.active`、缩放、染色、自定义材质开关），不得依赖上一帧或上一次池化前的残留状态。
- **纯函数时间轴**：动画表现统一记录 `startedAt` 时间戳，在 `render` 中按 `now - startedAt` 调用纯函数计算当前帧状态；禁止在视图组件内零散创建 `tween` 或使用 `dt` 累加状态（免疫暂停、切后台与帧率抖动，且可直接单测）。
- **单属性唯一写入口**：同一节点的 `scale`、`position`、`color`、`parent`、`customMaterial` 在视图类中必须收拢到**唯一私有方法**写入（例如 `applyBuildingScale`、`applyIconPosition`、`applyPulseMaterial`），杜绝多处直接写 `node.setScale` 导致静态刷新拍平动态动画。
- **内容指纹闸门（Content Signature）**：静态高频渲染应通过 `contentSignature()` 比对指纹跳过无变化重绘；若动态特写（如扩散波 `setClaimWave`）绕过闸门直写属性，收工时必须清空 `contentKey = ''` 强制下一帧常规重绘。

### 3.4 帧循环（`update`）与状态管理禁令
- **严禁在 `update` 中**：加载资源、查询全局配置表、每帧 `new` 临时数组/对象/节点、或混入业务结算规则。
- **动静分离节流**：短周期逐帧动画（如 0.1s~0.4s 的抖动、过渡波、金矿闪烁）必须挂在逐帧执行的 `renderDynamic` 上；低频状态同步挂在节流的 `renderStatic`（如 0.15s）上。
- **严禁新增全局可变状态**：禁止新增全局单例或 `static` 暂存区。跨流程传值一律走显式的 `entry params / context`；确需临时桥接时，必须保证**单次消费、读取即清空**，并配套单测守卫。

## 4. 命名、类型与代码风格规范

- **文件与类**：`PascalCase` 且文件名与导出类名严格同名；一个文件只承担一个清晰职责，禁止 `Utils.ts`、`Common.ts`、`Manager.ts` 等大杂烩收容箱。
- **接口与类型**：`PascalCase` 且**强制以 `I` 开头**（`I` 必须在最前，如 `IMailRepository`、`IZCSnapshot`，禁止写成 `ZCISnapshot`）；枚举成员 `PascalCase`；常量 `UPPER_SNAKE_CASE`。
- **变量与函数**：`camelCase`；布尔值以 `is / has / can` 开头；私有属性用 `private` + `camelCase`，**严禁使用 C# 风格的 `m_` 前缀**。函数名须体现动作意图（`load…`、`build…`、`present…`、`handle…`），禁用 `doIt`、`data`、`temp`。
- **模块前缀**：对局玩法 `zcds` 内的类统一以 `ZC` 开头；全仓严禁拼音命名。
- **TypeScript 严格性**：4 空格缩进、单引号、显式分号；纯类型依赖强制使用 `import type`；接口与入参优先标 `readonly`（除非如 `drainBuildingShakes` 需内部替换数组引用）；用 `unknown` 替代 `any`；Cocos Inspector 必填引用标 `null!`，可空引用显式标 `| null`，严禁用 `as any` 或静默 `?.` 掩盖绑定缺失。
- **注释原则**：注释只解释**业务原因、Cocos 引擎陷阱、数学不变式或兼容分支的删除条件**，严禁复述代码字面逻辑。
- **单例访问点必须非空，调用点不许写 `?.`**：`EventMgr.instance` / `CacheMgr.instance` / `PopupManager.inst` 一律声明成**非空类型**；构造不出来（场景里既没有 `Popup` 节点也没有 Canvas 这类初始化错误）就让 getter **直接 throw**，不要 `console.error + return null` 把判断推给每个调用点。
  - 调用点写 `Xxx.inst.doThing()`，**不写 `inst?.`、也不写 `if (!mgr) { console.error(...); return; }`** —— 这类兜底把「管理器没初始化」降级成「点了没反应」，是典型的静默失效；让它抛出来才能定位。
  - `?.` 只留给**真的可能为空**的查询：`PopupManager.inst.get(SomePanel)?.close()`（弹窗没开）、`GMManager.inst`（GM 面板未加载即无，允许 `| null`）。
  - 判据：`grep -rn "\.inst?\." assets/script --include=*.ts` 与 `grep -rn "instance?\." assets/script --include=*.ts` 均为 0。
- **组件查询与引用取用禁止 `!.`**：工程 `strict: false`（`strictNullChecks` 关闭），`getComponent(X)` / `getChildByName()` / `getComponentInChildren()` 的返回类型**看起来非空** ⇒ 写 `!` 只是把真实可能为 null 的值断言成非空，`tsc` 又不会再拦，崩溃从编译期挪到运行期。口径：
  - prefab 焊死的组件（`itemPrefab` 上的 `XxxView`、`@property` 已绑定的引用）属**不变量** ⇒ 直接 `.` 取用，**不写 `!`、也不加 `if (!x) return` 这种只为消音的判断**（配错了要炸出来，静默跳过会让错误变成「点了没反应」）。
  - 真可空（外部数据、显式 `| null` 的字段、按名字取的 `getComponent('XxxItem')`）⇒ 显式判空窄化或 `?.`，不用 `!` 糊。
  - 已有的判空若保留，必须是**真的能取不到**（如遍历 `content.children` 时靠 `dataIndex` 先筛出池化槽位），不能是「怕它不在」。
  - 判据：`grep -rn "[A-Za-z0-9_)]!\." assets/script --include=*.ts` 恒为 0 命中（注释里讲解该规则的地方除外）。
- **`@property` 绑死的引用直接用，不判空**：prefab 上已绑定的 `Node` / `Sprite` / `Label` / 自定义组件属**不变量** ⇒ 一律 `this.xxx.active` / `.string` / `.node` 直接取，**不写 `if (this.xxx)` / `this.xxx?.` / `if (this.xxx && …)`**。判空只会把「prefab 掉了组件」降级成「点了没反应」，查不出根因。
  - 「绑没绑」不靠直觉：读对应 prefab —— 找 `__type__` 等于该脚本 cid 的对象，看字段的 `__id__` 是否指向真实对象。公共组件常在一个 prefab 上挂**多个实例**，必须逐个核（如 `LeagueAdButton` 在 `LeagueDonate.prefab` 有 `BtnFree` / `BtnBuy` 两处，7 个字段都要存在）。
  - **例外（判空要留）**：① 字段 tooltip / 注释明写「可选 / 老端兼容 / 接口先留好」；② 同一脚本被多个 prefab 复用、并非每个都绑；③ `getComponent` 懒取缓存（`if (!this.iconSprite)` 是缓存判断，不是防御）；④ 入参本身可为 `null`（`setCostIcon(frame: SpriteFrame | null)` 里的 `if (!frame) return` 是语义，不是冗余）。
  - 存量与判据：按「`@property` 字段名 × `if (this.x)` / `this.x?.` 形态」扫全仓，2026-10-30 为 **558 处 / 122 个文件**（Top：`OSRankPage` 29、`LeagueHallPage` 28、`HangPage` 19、`OSShopItem` 17、`BattleTokenPage` 17）。**不要一把梭**：按模块清，每清一个文件先把它的所有 prefab 实例对完账，再改用例护栏。

## 5. Cocos Creator 预制体（Prefab）与静默陷阱守卫

Cocos 引擎中许多配置错误**完全不报错但表现静默失效**，修改或生成 Prefab 时必须核对以下清单：

| 陷阱类别 | 强制规范 | 违背症状（静默失效） |
| :--- | :--- | :--- |
| **图层位掩码 (`_layer`)** | 所有 UI 与棋盘子节点（含 `MapWater`、Spine 根与子节点）必须设为 `UI_2D` | UI 相机直接跳过渲染，画面缺失且控制台零报错 |
| **手写/脚本生成 Prefab** | 每个节点必须显式包含 `cc.UITransform` 组件 | 手写 JSON 不会触发 `@requireComponent` 自动补挂，运行时取宽高或挂 Widget 崩溃 |
| **CUSTOM 尺寸 Sprite** | `sizeMode = CUSTOM(0)` 的 Sprite 必须设 `_isTrimmedMode = false` | 引擎在赋 `spriteFrame` 时把 `contentSize` 强行覆写为裁剪框大小，设计稿尺寸失效 |
| **立绘等比缩放** | 方形原图（如 256×256 立绘）放进非方形设计框时，必须 `sizeMode = RAW(2)` 并由代码按 `frame.height` 等比算 scale | 设为固定框会把角色纵向拉伸变形 |
| **借用带 Widget 的节点** | 跨父级借用节点（如借 `ConfirmSpawn` 绿勾到 `mapLayer`）必须先 `widget.enabled = false`，销毁前归还父级与 Widget | Widget 每帧按原父级边距把节点拽回屏幕底部，覆盖代码写入的世界坐标 |
| **属性序列化覆盖** | 修改组件代码中 `@property` 的默认值（如 `entranceProgress`、`driftDistance`）时，必须同步更新 `.prefab` 中的序列化值 | 面板序列化值优先级高于代码默认值，只改代码在运行期完全不生效 |
| **双通道顶点染色** | 同时支持序列帧（`Sprite`）与骨骼（`sp.Skeleton`）的组件写色必须写 `if (sprite) ... else if (skeleton) ...` | 漏写 `else if (skeleton)` 会导致所有 Spine 单位永远不变色且无报错 |
| **克隆材质释放** | 每实例独立写 uniform 的材质（如 `pulseFade`）必须 `new Material()` 克隆，并在 `onDestroy` 中显式 `.destroy()` | 共用材质会导致多格同播时互相覆盖 uniform；不销毁则造成非托管内存泄漏 |
| **点击必须在 prefab 上挂 `cc.Button`** | 交互节点（头像 / 图标 / 自定义形状按钮）一律在 prefab 上挂 `cc.Button`（`transition = NONE`、`target = null`），代码只写 `node.on(Button.EventType.CLICK, handler, this)`。**禁止** `getComponent(Button) ? CLICK : TOUCH_END` 这种按组件形态分流的兜底 | 缺 `cc.Button` 的节点上绑 `CLICK` 是**静默死按钮**；而分流兜底把「prefab 掉了组件」降级成同样的静默无反应，且 `TOUCH_END` 会绕过 `interactable`（灰态仍可点） |

> **点击分流兜底的存量**（2026-10-30 扫全仓）：另有 25 处「有 Button 走 CLICK、否则退 `TOUCH_END`」的写法，集中在 `app/league/**`（17 处，多为 `bindByName(node, handler)` 这类通用 helper）、`app/playerinfo/**`（5 处）、`app/itemdetail/ItemDetailPage`、`app/maintask/MainTaskEntry`、`app/celebration/OSTabButton`、`app/chat/ChatRecruitRow`、`app/gift/RechargeChest`、`app/activity/LayerActivityPage`。
>
> 改造顺序**不能反**：① 先逐个核对目标节点、在 prefab 上补齐 `cc.Button`（`transition=NONE`）；② 再删代码里的兜底分支；③ 用 prefab 静态断言（该节点有 `cc.Button`）+ 源码断言（`doesNotMatch(/TOUCH_END/)`，**先剥注释**）锁住。倒过来做（先删兜底、后补组件）等于批量制造静默死按钮。


## 6. 测试护栏与交付验证标准

1. **三层验证体系**：
   - **纯函数与模型单测（首选、极速）**：曲线计算（`ZCGameViewUtil`）、布局换算（`TerritoryMapLayout`）、状态编排（`TerritoryPresenter`）直接用 `npx tsx --test tests/<name>.test.ts` 验证。测试必须直接 `import` 源码真实函数与常量，**严禁在测试桩里复制算式或写死易过期的中间浮点数**。
   - **Prefab 与源码结构守卫单测**：通过读取 `.prefab` / `.meta` JSON 与剥离注释后的源码正则，断言图层顺序、组件属性（`_enableBatch`、`_isTrimmedMode`）、单属性唯一写入口与接线链完整性。
   - **真引擎端到端探针（`tmp/_*_probe.mjs`）**：涉及复杂节点树装配、动态合批或真实资源加载时，使用探针脚本在引擎环境实测。
2. **交付报告要求**：任务完成时必须明确汇报：**修改了哪些文件、关键架构边界、实际运行的验证命令与通过条数、尚未覆盖的风险**。严禁未跑测试就声称“应该能运行”。

## 7. 专项领域规范与工具链（§7.3）

### 7.3.1 配置导表与引用校验工具链
修改任何 Excel 配置表或卡牌资源路径后，必须按顺序执行以下工具链（严禁手改生成的 `.json` 或 `refGen` TS 代码）：
1. 运行 `tools/config`：将 Excel 导出为 `json`、`remoteRef` 与 `refGen` 类型定义。
2. 运行 `tools/ref`：将产物同步至工程目录并执行引用守卫检查。
3. 运行 `python tools/pvp_card_check.py`：逐行校验卡表中每个 `unitPrefabPath` 对应的 `assets/resources/<unitPrefabPath>.prefab` 真实存在（在编译/提交期拦截，避免等到运行时才报 `Bundle resources doesn't contain ...`）。
4. 产物落地后，通过 Cocos MCP 刷新 `db://assets/remoteRef`。

### 7.3.2 美术碎图自动图集（`auto-atlas.pac`）与单位资源规范
1. **自动图集（`auto-atlas.pac`）拓扑铁律**：
   - 每棵碎图目录树的**最外层一级分类目录**必须放置且仅放置一份 `auto-atlas.pac`（如 `assets/resources/image/<分类>/`、`assets/resources/icons/<分类>/`）。
   - `auto-atlas.pac` 会**递归覆盖整个子目录树**（即使父目录自身没有直接放散图也生效，例如 `decor/` 的 pac 已覆盖 `decor/wasteland/`）。
   - **两条严禁**：① **严禁父子目录同时放 pac**（会导致子目录贴图重复打包）；② **严禁在 `image/` 根目录放 pac**（其下 35 个子目录各有独立 pac）。
   - 漏配 pac 引擎**不会报任何错误或警告**，新增美术目录时必须专项核查。
2. **兵种单位美术的两种形态**：
   - **序列帧单位**：路径为 `assets/resources/units/<名>/<名>.prefab`。
   - **Spine 骨骼单位**：路径为 `assets/resources/skel/<目录>/<目录>.prefab`，目录内固定三件套 `<前缀>.atlas.txt`（源 `.atlas` 必须改名为 `.atlas.txt`）+ `<前缀>.png` + `<前缀>.skel`。
   - **Spine Prefab 三条硬约束**：① 根节点与 `spine` 子节点的 `_layer` 均为 `UI_2D`；② `sp.Skeleton.defaultAnimation` 必须设为 `idle`；③ **`sp.Skeleton.enableBatch` 必须开启**（落盘 `_enableBatch: true`，引擎组件默认为 `false`，新建或脚本生成时必须显式写入）。
3. **卡表路径与目录命名关系**：
   - 卡表 `unitPrefabPath` 统一使用**正斜杠**（如 `skel/<目录>/<目录>`），走 `units/**` 还是 `skel/**` 唯一以卡表为准。
   - **目录名 = Prefab 名，但不必等于卡牌显示名**（如卡名 `豌豆游侠` 对应目录 `豌豆射手`，卡名 `巨力坚果` 对应目录 `坚果`；美术源文件夹名如 `金发老板exp`、`吞噬大嘴花exp` 不得直接作为工程目录名）。
   - 唯一硬约束是 `assets/resources/<unitPrefabPath>.prefab` 真实存在且通过 `tools/pvp_card_check.py`。**改目录名或挪位置必须同步改卡表**；仅改卡牌显示文案则无需动目录。

### 7.3.3 ~ 7.3.11 对局表现层与领地专项规范（已拆分独立维护）
为保持主架构文档轻量清晰，原 §7.3.3 ~ §7.3.11 的完整规格说明与回归测试判据已统一收拢至 [docs/zcds-表现层与领地规范.md](https://www.google.com/search?q=.%2Fzcds-%E8%A1%A8%E7%8E%B0%E5%B1%82%E4%B8%8E%E9%A2%86%E5%9C%B0%E8%A7%84%E8%8C%83.md)，章节映射如下：
- **原 §7.3.3**（棋盘图层、地块/建筑/特效缩放、资源抬层、地块激活脉冲∥缩没、出生与产金抖动、邻格延迟、城墙排序）➔ 见专项规范 **§1、§8、§9.5**
- **原 §7.3.4**（金卡「传说卡出场横幅」`ZCGameLegendBanner` 与扇入动画）➔ 见专项规范 **§2、§9.4**
- **原 §7.3.5**（「冒险」领地页 `TerritoryPage` 职责切分、Presenter 纯度与台面中心对齐）➔ 见专项规范 **§3**
- **原 §7.3.6**（其他玩家席位单位暗色叠加 `#828282`）➔ 见专项规范 **§4**
- **原 §7.3.7**（自选主城模式 World 层表现与借用绿勾确认按钮）➔ 见专项规范 **§5**
- **原 §7.3.8**（战斗飘字「快进慢出」45%/55% 单旋钮曲线与收尾漂移）➔ 见专项规范 **§6**
- **原 §7.3.9**（开局归属扩散波 `ZCClaimWave`）➔ 见专项规范 **§7**
- **原 §7.3.10 ~ §7.3.11**（体验反馈专项：胜利三段式扫场 row8、描边同步 row9、开局金矿闪烁 row10）➔ 见专项规范 **§9.1 ~ §9.3**


### 控制器资源归属

- `ControllerBase` 统一管理必需的资源、配置、会话服务与 ResourceScope；未使用资源即销毁时，不读取运行时服务。
- `ComponentController` 复用既有 `ProcedureManager.context`，首次使用服务时解析；未配置运行时即访问服务必须明确报错，不降级为可空资源入口。
- 主界面宿主、主城宝箱、卡牌阵容和公共奖励格各自持有控制器，退出时调用 dispose。业务页面不再暴露独立的 setAssetService / setConfigService / setSessionAssetService / useAssets 注入接口，弹窗 userData 也不传资源服务。
- `zcds` 入口统一调用 `createZCBattlePreload(battle, options)`，不再逐项传资源服务。战斗准备控制器从运行时取得必需资源契约，`ZCGameLoader` / `ZCGuideLoader` 只消费该契约，不自己查全局服务。
- 对局资源分两段归属：预加载资源由匹配任务独立 scope 持有，成功后移交流程；头像、卡面、首领头像与结算补图由 `ZCGame` 持有的 `ComponentController` 管理，`shutdown()` 在拆除展示节点后统一释放。不可用来源地图的 scope 代替战斗 scope。
- `PopupBase` 统一提供必需的 `assets` / `configs` / `sessionAssets` 与本次打开的 `resourceScope`，服务首次使用时从已有 `ProcedureManager.context` 解析。弹窗子类（如 `LineupBoardPage`）直接使用继承入口，不为资源另建 `ComponentController`。
- 弹窗关闭和销毁均由基类释放动态资源，`onClose` 先完成业务收尾；缓存弹窗每次重开创建新作用域。子类须清空本次加载缓存，加载闭包捕获本次资源服务，异步返回检查本次作用域是否已释放，防止旧任务借到新一轮作用域。关闭 / 销毁不再额外递增刷新版本号；版本号仅用于同一次打开期间重复刷新或切换阵容时防止旧结果覆盖新结果。`PopupManager` 负责 prefab 加载的原有作用域不变。
- `PopupManager.initialize` 是组合根配置框架端口，仍由 Bootstrap 完成；不属于业务页面的依赖穿透。

### 大地图 MVC 事件归属

- `ControllerBase` 从组合入口交付的必需 `GameContext` 统一取得资源、配置与会话服务，创建控制器 ResourceScope；页面只接收 `IControllerResources` 展示资源契约，不再单独注入可空 AssetService。资源加载默认归控制器，显式战斗 scope 原样传递，Controller dispose 时统一释放。
- `BigMapEntry` 是组合入口，从既有 ProcedureManager 取得已配置 GameContext，创建 Model、Controller、仓库与 View，并在关闭时释放 Controller。
- `BigMapController` 统一绑定网络广播、仓库/Model 变更和界面操作意图，管理操作锁、进入战斗状态与据点轮询。
- `BigMapModel` 保留状态和业务规则；仓库仅负责请求及快照，网关不自行监听广播。原 `BigMapPresenter` 路径仅兼容导出同一份 Model。
- `BigMapPage`、`BigMapWorldView`、`BigMapBaseView` 只消费 `IBigMapViewState`；用户操作经 `BigMapUiEvent.Intent` 派发，由 Controller 处理后发送 `BigMapViewEvent.Render/Command`。
- 地图页面为单实例，界面事件只携带操作与展示数据；场景直接销毁页面时发送 `Disposed`，Controller 幂等停止时钟、解除全部监听、释放仓库和网络请求，迟到结果不得再通知界面。


### 章节地图 MVC 事件归属（2026-10-30）

- `TerritoryEntry` 为每个页面装配 Model、Controller、章节加载器、Repository 与存档适配器；章节加载器与页面美术共用 ControllerBase 管理的 ResourceScope。
- `TerritoryController` 集中绑定格子推送、角色缓存与界面意图，管理 1 秒 / 60 秒时钟；网络请求 caller 为 Controller，销毁时统一 removeCaller。
- `TerritoryModel` 复用原 Presenter 的章节上下文、业务规则、加载期推送合并与交互版本校验；只通过实例 onOutput 通知 Controller，不广播全局界面事件。`TerritoryPresenter` 仅保留兼容重导出。
- `MainTerritoryMap` 只消费 `TerritoryViewEvent.Render/Command`，地图与三个关卡弹窗通过 `TerritoryUiEvent.Intent` 派发操作，页面关闭时由 Controller 统一解除事件、网络和缓存订阅。格子命中在地图内部先做输入锁判定，再转发意图。
- `TerritoryViewState` 为进度提供独立只读投影；未知服务端状态也须保留本地解锁格，不允许通过渲染快照修改 Model。
- 页面销毁先通知 Disposed，再幂等释放 Entry；Controller 作废 Model 的在途任务、配对释放 busy 提示、停止时钟与订阅。页面退出时关闭全局关卡弹窗；异步补图保留节点有效性、内容与任务版本校验。

回归：`territory-controller`、`territory-view-state`、`territory-mvc-boundary`、`territory-presenter`、`territory-cell-subscriptions`、`territory-level-tip-icons`，并运行领地专项绑定测试。
