# Main Tabs MVC Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** 将底栏切换和现有功能编排移入控制器，共享生命周期基类。

**Architecture:** ControllerBase 持有资源与清理动作；功能控制器订阅意图并调用既有 Model/Repository；Cocos 页面负责渲染和节点生命周期。

**Tech Stack:** Cocos Creator 3.8、TypeScript、tsx node:test。

**Spec:** docs/superpowers/specs/2026-10-30-main-tabs-mvc-design.md

## Global Constraints

- framework 不引用 app；core 不引用 cc。
- View 意图走 EventMgr，不传业务回调。
- 加载成功再替换，取消与销毁必须释放资源。
- 保留首屏 ready、静默预热、首充和世界覆盖页行为。
- 用户已有领地模型与测试改动保持原样。

## Review Focus

- 连续切换及同目标重复点击不会挂载过期页。
- 世界加载途中切其他页不会迟到覆盖或关闭新世界。
- 页面退出后的网络、缓存与事件不会写旧视图。
- 英雄快照与权威数据交错只提交最新结果。
- 联盟加入后仅当前容器刷新，角色默认加载不会覆盖用户选择。

## Task 1: 公共生命周期

Files: framework/controller/ControllerBase.ts, tests/controller-resources.test.ts。
Interfaces: protected own(stop: () => void): void; protected listen(event, handler): void; isDisposed: boolean。
- [x] 写清理幂等、释放顺序和事件退订测试，运行确认 RED。
- [x] 实现公共清理；运行控制器资源与事件单测确认 GREEN。

## Task 2: 导航 MVC

Files: app/main/MainTabController.ts, MainTabModel.ts, MainTabEvents.ts, MainTabHost.ts, tests/main-tab-controller.test.ts, tests/main-tab-lazy-loading.test.ts。
Interfaces: switchTab(index: number): Promise<void>; snapshot 当前页、加载目标与版本；视图端口挂页与高亮。
- [x] 用可控 Promise 覆盖重复点击、最后目标、失败、销毁和覆盖页竞态并确认 RED。
- [x] 抽取切换，保留宿主外部接口；点击通过事件订阅；运行导航与首屏测试确认 GREEN。

## Task 3: 功能控制器

Files: store/StoreController.ts, card/CardLineupController.ts, role/RoleController.ts, league/LeagueTabController.ts 及对应页面和事件契约；territory 与 bigmap 既有控制器。
Interfaces: 各功能 start/refresh/dispose，展示输出用事件；复用现有 Repository、Presenter 和 StoreActions。
- [x] 补功能刷新、选择、退出和入盟通知测试并确认 RED。
- [x] 将输入编排迁入各功能控制器；公共释放归基类，保留领地收尾特殊顺序。
- [x] 运行功能单测与 view-intent-events、callback-owner 及领地绑定最小集。

## Task 4: 验证与交付

- [x] 完整 npm test，记录失败与实际通过数。
- [x] 检查 TypeScript、git diff --check 及工作区用户改动。
- [x] 对最终 diff 做独立审查，修复重要问题并回归；更新本计划完成状态。

执行约定：按用户“按以上执行”在当前 checkout 继续，使用 codex/main-tabs-mvc 分支，不额外提交或发布。无需再次审批计划。

## Task 5: 纠正 Page 与 Controller 所有权

- [x] 明确由 ProcedureMain 持有外部组合对象，Page 无反向控制器引用。
- [x] 增加所有权护栏 RED，再迁移导航、各功能、领地 Entry 与展示资源的组装与释放。
- [x] 生命周期通过 owner + phase 事件通知；快速寻敌与首屏就绪回调事件化。
- [x] 回归挂载前注入、页面隔离销毁、角色退出迟到结果，以及既有导航/首屏/世界测试；独立审查。
- [x] Cocos 刷新、TypeScript 诊断检查、定向与全量测试，结果写入验证记录（完整工程仍非全绿）。
