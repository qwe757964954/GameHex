# MVC 设计规范

本工程采用事件驱动的 MVC：Model 保存业务真源，View 表达界面，Controller 编排交互与外部输入。Composition / Entry 负责装配和释放三者。MVC 是职责划分，不要求给每个静态组件机械地新增三个类。

新增或重构页面、功能状态、用户交互、网络推送与生命周期时读取本文；通用硬约束见[工程入口](../../AGENTS.md)。本文解释已有架构约定，具体模块的事件、资源与销毁契约以[架构规范](../AI架构与代码规范.md) §2.1、§2.2 及“控制器资源归属”“大地图 MVC 事件归属”“章节地图 MVC 事件归属”为准。

## 1. 三层分别放什么

| 角色 | 应放内容 | 不应放内容 |
| --- | --- | --- |
| Model | 权威业务状态、合法操作、不变量、状态迁移；按需输出实例通知与只读状态投影 | Cocos 节点、Button/Sprite 操作、Controller/View 引用、全局 UI 事件 |
| View | 节点绑定、输入采集、布局、表现时间轴、按展示数据全量渲染、页面生命周期报告 | 扣费/解锁/奖励规则、业务网络请求、Controller/Entry 对象或其回调 |
| Controller | 订阅界面意图、Model 输出、缓存/网络推送；调用 Model/Repository；管理在途操作、时钟、导航和展示输出 | 节点树拼装、从 Label/Button 状态推断业务状态、复制 Model 的领域规则 |

- Model 的业务状态是唯一真源。ViewState 是展示投影，不能反向修改 Model；View 可以保留滚动位置、节点引用和渲染缓存等表现状态。
- 业务合法性由 Model/领域规则判定；Controller 承担请求在途、重复操作、取消与外部输入的编排，复用 Model 的规则生成 canXxx 等展示字段。View 的 interactable 只是显示结果，不能代替业务校验。
- 纯规则进入 feature 的 model/domain 或 core，不依赖 cc、UI 和直接 I/O。应用层 Model 可消费既有注入端口，不因 MVC 重构复制仓库或另建状态机。
- Repository/Gateway 负责外部数据访问与边界归一化，不控制页面、不堆业务规则；业务广播按现有模块契约由 Controller 统一订阅。
- Presenter 是存量命名：先确认它实际承担 Model、投影还是 Controller 职责，复用或迁移同一实现。不得仅为名称齐全新增第二份业务状态，也不得以「兼容再导出」留第二套入口（`XxxPresenter.ts` 只写 `export ... from './XxxModel'`）；大地图、领地两个模块的该层已于 2026-11 删除，直接 import `BigMapModel` / `TerritoryModel`。

## 2. 输入到渲染的完整事件流

```text
用户输入
  → View 派发 Intent（动作 + 必要业务标识）
  → Controller 接收，处理在途/会话门闩
  → Model 判规则、更新状态；外部读写经既有 Repository/Gateway
  → Model 实例输出 / Repository 结果 / 缓存或网络推送
  → Controller 生成只读 ViewState 或一次性展示命令
  → View 幂等 render / 播放表现
```

- View 与 Controller 的交互经 EventMgr：View 只报告“用户想做什么”，不传执行函数、不直接调用业务控制器。
- 事件与载荷类型集中在 feature 的纯 TS 契约文件；多实例或重开会话复用现有 owner/session 作用域，避免串页。不要为已经明确单实例的事件另建全局路由设施。
- Model 通过实例订阅通知 Controller，不自行向全局派发 UI Render/Command；具体展示事件由 Controller 负责。
- ViewState 表达可重复渲染的当前状态；Command 表达聚焦、提示、一次性动画等动作。普通 render 不重复触发奖励、扣费或请求。
- Controller 的 bind*Events 集中管理订阅；View 的节点事件在 onInit/onLoad 绑定，禁止在 render/update 中订阅。

### 示例：点击一个领地格子

1. View 从命中结果取得 cellId，经既有 TerritoryUiEvent.Intent 报告点击；地图内部可以先判表现输入锁。
2. Controller 处理当前会话与在途操作，调用 TerritoryModel 的既有规则。能否解锁、扣什么资源、状态如何变化，不能由 View 按图标或按钮颜色推断。
3. 需要服务端数据时，复用现有 Repository 和 caller 归属；Model 合并已归一化的数据，按模块既有契约输出变化。
4. Controller 接收实例输出，发布 TerritoryViewEvent.Render/Command。View 根据只读投影更新格子、费用、气泡或表现；不自己再扣一次资源。
5. 页面退出时，组合层释放本会话，Controller 停时钟、解除订阅与请求；已开始的异步任务仍须校验取消/版本，不能向重开的页面应用旧结果。

此例仅解释 MVC 职责和方向，不定义解锁、扣费、奖励或点击次数等业务需求，也不是新增 API。实际行为以本次明确需求和相关业务规格为准，意图类型与载荷先查 TerritoryEvents.ts 的既有调用链；需求变化时同步调整契约和测试。

## 3. 谁创建、谁持有、谁释放

```text
Procedure / 宿主流程
  → 持有 Composition / Entry
      → 装配 Model、Controller、Repository、View
      → 注入展示数据与展示资源契约
      → 根据作用域生命周期启动、取消、释放
```

- 组合层持有控制器与视图。主界面新增装配放 app/bootstrap 的 Composition；既有 BigMapEntry、TerritoryEntry 按各自现有边界维护，不为统一目录而搬动无关实现。
- Page 不 new、不保存、不 dispose Controller/Entry，也不保存其退出闭包。Page 只接收展示契约，并报告 ready/enabled/disabled/destroyed 等既有作用域生命周期事件。
- 业务资源与会话服务归 ControllerBase 的既有 ResourceScope；View 仅持有获准的展示资源契约。PopupBase 子类沿用基类资源入口与释放机制，不重复新建控制器来管理资源。
- 释放先断开输入与调度，再按模块输出/收尾契约解除其余订阅、请求并释放资源；dispose 保持幂等。章节地图 loading 收尾顺序遵循既有规范，不机械套用统一释放次序。
- 已解除的同步订阅不额外堆 disposed/isValid 守卫；await、Promise 后续与无法取消的异步任务仍检查会话、取消或节点有效性。
- MVC 不决定服务是否单例。共享服务可在明确生命周期内唯一，Model/Controller 仍按页面、账号或对局作用域装配；单例不能替代组合层的归属管理。适用范围见[单例与状态作用域](单例与状态作用域.md)。

## 4. 可对照的现有实现

下列代码路径均相对仓库根目录；使用 CodeGraph 查看当前符号及调用链，不必通读所有文件。

| 场景 | 参考入口 | 关注点 |
| --- | --- | --- |
| 大地图 | app/bigmap/application/BigMapEntry.ts、BigMapController.ts、BigMapModel.ts；view/BigMapPage.ts | Entry 装配、Controller 订阅、只读 ViewState 与 Render/Command |
| 章节地图 | app/territory/application/TerritoryEntry.ts、TerritoryController.ts、TerritoryModel.ts、TerritoryEvents.ts；app/main/MainTerritoryMap.ts | Model 实例输出、会话取消、页面只派发意图 |
| 主界面 | app/bootstrap/main/MainTabsComposition.ts、MainPageComposition.ts；app/main/MainTabController.ts | 流程持有组合对象，Page 不持有业务控制器 |

表内 app 路径位于 assets/script/app，文件名缩写与前一同目录项对应。

## 5. 改完验证什么

- View/Controller 交互：npx tsx --test tests/view-intent-events.test.ts。
- caller 与取消：npx tsx --test tests/callback-owner.test.ts。
- 流程/主界面归属：npx tsx --test tests/flow-architecture.test.ts tests/main-page-ownership.test.ts。
- 大地图 MVC：npx tsx --test tests/bigmap-mvc-boundary.test.ts tests/bigmap-controller.test.ts。
- 章节地图 MVC：npx tsx --test tests/territory-mvc-boundary.test.ts tests/territory-controller.test.ts tests/territory-view-state.test.ts。

只运行本次命中的验证集，并补充相关业务行为回归；表现改动仍按[专项路由](规范路由与最小验证.md)执行绑定测试。纯文档改动检查引用和职责描述的一致性，无需运行全部业务单测。
