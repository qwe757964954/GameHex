# Battle Entry Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 领地与大地图共享已解析战斗资产，提前准备公共资源，减少连续开战重复加载。
**Architecture:** SessionAssetService 向 app 提供可选资源复用能力；core 缓存只依赖资源端口和作用域；app 统一预加载与取消；正式阵容仍以回包为准。
**Tech Stack:** Cocos Creator 3.8.8 / TypeScript / tsx tests.
**Spec:** docs/superpowers/plans/2026-10-26-battle-entry-design.md

## Global Constraints
- 当前编辑器工作区、备份逐文件、不提交、不修改生成文件或 Prefab。
- 资产上限64条、空闲120000ms；退出登录换代，活跃对局资产不得提前释放。
- 不缓存节点、阵容、随机源、模拟状态；预热不选图/不注入数值。

## Review Focus
- 双入口并发和重复点击共享请求，但各自租约独立取消。
- clear/过期/容量压力与迟到完成交错，活跃资产保持有效。
- 详情预热关闭和开战衔接，后台不得堵住正式加载。
- 实际修改器替换模型、召唤和中立奖励不能漏。
- 跨分包、三四人、离线和守城/选点模式保持原行为。

## Task 1: ScopedAssetCache
Files: core/asset/ScopedAssetCache.ts, tests/scoped-asset-cache.test.ts.
Interfaces: implements AssetService; constructor(delegate, {maxEntries,idleMs}, now); prune(), clear(), stats. Scope lease protection, promise merging, failed removal, capacity bypass.
- [ ] Write behavioral tests for hit, cancellation, failure retry, TTL, capacity, clear/late; watch RED.
- [ ] Implement and run npx tsx --test tests/scoped-asset-cache.test.ts; expect all PASS.

## Task 2: Session parsed warmup + entry integration
Files: SessionAssetService.ts, AppSessionAssetService.ts, ZCBattlePreparation.ts, MainTerritoryMap.ts, MainTabHost.ts, BigMapEntry.ts, BigMapPage.ts, ProcedureBootstrap.ts, ProcedureGame.ts, ProcedureMatching.ts, shared resource manifest.
Interfaces: reusableAssets?: AssetService; warmupBattle?(): Promise<void>. createZCBattlePreload(assets, configs, battlePromise, options) returns existing ZCGamePreload. Same lease transfer rules.
- [ ] Tests assert no config/map changes during warmup; duplicate/close/clear; both entry use shared prep and cached assets. Watch RED.
- [ ] Implement, update only affected VM dependencies, run session/entry/lifecycle tests; expect PASS.

## Task 3: Resource plan narrowing
Files: ZCGameLoader.ts, ZCGamePreparedResources / lazy guide consumer as needed, tests/preview-battle-resource-plan.test.ts.
- [ ] Reproduce unrelated override loading. Assert actual textModifiers and required dependencies retained; offline fallback all. Watch RED.
- [ ] Implement conditional UI only where view already supports null; preserve required assets if optional consumers require larger refactor. Run loader/client-combat tests; expect PASS.

## Task 4: Engine verification and final review
- [ ] Refresh scripts; same Chrome probe cold/warm/reentry, capture underlying loader calls and cache stats.
- [ ] Run focused loading/battle/territory sets, check types attributable to changed files, record unrelated baseline failures.
- [ ] One fresh final reviewer per executing-plans; fix important findings RED→GREEN. Preserve worktree and no commits.
