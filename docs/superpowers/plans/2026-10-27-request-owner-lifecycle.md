# Request Owner Lifecycle Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** 宿主退出时统一解除事件与请求回调，取消的 Promise 以 false 落定，迟到回包仍处理公共缓存。

**Architecture:** 复用 EventProxy 的对象归属机制登记请求清理动作。NetworkRequest 转移并显式释放回调，不读取组件 isValid。组合根向弹窗和流程管理器注入纯 TS 生命周期端口；普通页面在销毁时显式解除归属。

**Tech Stack:** Cocos Creator 3.8、TypeScript、node:test / tsx。

**Spec:** 本聊天用户已批准的“按宿主登记 → 退出时统一解除 → Promise 按取消结束 → 迟到回包仅走公共处理”约定。

## Global Constraints

- framework 不依赖 app；core 不依赖 Cocos；不新增全局注册表。
- 保护用户现有改动；保持 caller 直接传对象；取消不触发业务失败回调。
- 只撤回本轮新加的组件判活，不删除既有业务 generation / cancelled 守卫。

## Review Focus

- 取消前保存的回包函数在取消后执行，不得触发旧回调。
- 同一宿主关闭、再打开时，新请求不得被上一轮清理取消。
- 未发送请求不得在重连后发送；已发送请求的回包仍更新公共缓存。
- 正常完成与重复取消都须清登记且只落定一次。
- 弹窗缓存关闭、组件销毁和流程退出三条路径都须接通。

### Task 1: 请求归属与取消

**Files:** EventProxy.ts、NetworkRequest.ts、GameNet.ts、NetSocket.ts、ConnectedNetState.ts、core/runtime/CallbackOwner.ts；tests/callback-owner.test.ts、network-request-policy.test.ts。

- [x] 先写取消、重复取消、迟到成功/失败、重开宿主和队列回归，观察失败。
- [x] EventProxy 增加 addCallerCleanup；解除宿主时统一清理事件与动作。
- [x] NetworkRequest 增加 cancel，清回调/归属并以 false 落定；正常完成注销清理动作。
- [x] GameNet 提供 removeCaller；注册请求时注入相同端口；队列跳过取消请求，响应保留公共处理。
- [x] 跑最小回归确认通过。

### Task 2: 生命周期接线

**Files:** GameContext.ts、PopupBase.ts、PopupManager.ts、ProcedureManager.ts、ProcedureBootstrap.ts、MainPage.ts、MainTabHost.ts、MainTerritoryMap.ts；对应 popup/procedure 测试。

- [x] 加缓存弹窗关闭重开、流程切出和页面销毁测试。
- [x] 组合根注入端口；弹窗关闭和销毁、流程离开和取消预加载统一解除宿主；普通页面显式清理。
- [x] 运行生命周期与网络回归，核对 no app import。

### Task 3: 文档与验证

- [x] 更新 AGENTS.md 和全局规范 §2.2，撤回 isValid 兜底约定。
- [x] 跑相关测试与完整 npm test，记录当前工作区失败，不声称全量通过。
- [x] 独立审查、修复本次问题，保存验证记录。

## Execution Record

- Ruling: 复用既有 EventProxy 实例管理请求清理动作，不新增全局表。
- Ruling: ConnectedNetState 既有公共缓存处理顺序已由迟到回包测试验证，无需改写该文件。
- 38 条相关测试通过，独立审查通过；全量与类型检查详情见 tmp/request-owner-lifecycle-verification.md。
