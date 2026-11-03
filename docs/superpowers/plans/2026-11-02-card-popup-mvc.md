# Card Popup MVC Implementation Plan

> 使用 executing-plans，在当前 D:/City1001/Demo3.8 工作区按任务实施；用户已确认沿用同一架构，不重复确认。

**Goal:** 卡牌升级与布阵 Page 去业务状态、请求和控制器所有权。
**Architecture:** 通用弹窗会话宿主由 PopupManager 持有；bootstrap/card 装配每次打开的 Model/Controller/View；ControllerBase 统一事件、请求和资源清理。
**Tech Stack:** Cocos Creator 3.8.8、TypeScript、node:test/tsx。
**Spec:** docs/superpowers/specs/2026-11-02-card-popup-mvc-design.md

## 约束与验证边界

- 保留 prefab 引用、布局和现有 Repository/纯规则；不修改生成文件和并行改动。
- 真实 caller 在关闭时解除；旧响应不修改新会话或发布成功事件。
- cache:true 重开、异步打开失败/取消、LoadingPopup 租约分别覆盖。
- 保存中编辑、切换方案时，只能把实际提交的快照标为已确认。

## Task 1 通用弹窗外部组合会话
- [x] tests/popup-composition.test.ts 先失败：同类多实例、取消、失败、缓存重开及幂等释放。
- [x] framework/ui/PopupCompositionHost.ts 契约/宿主；PopupManager 接收 bootstrap 工厂并转发生命周期，沿用 callbackOwners。
- [x] 验证既有 Popup 生命周期、资源和取消集。

## Task 2 升级
- [x] tests/card-popup-controllers.test.ts 先失败：意图隔离、防重、失败重试、关闭迟到、Loading 租约。
- [x] CardUpgradeModel/Controller；CardUpgradePage 去取数/请求/业务状态，外部 CardPopupComposition 装配。
- [x] 验证 0级解锁、材料/满级、技能入口和升级结果主 tab 刷新。

## Task 3 布阵
- [x] 同一控制器测试文件补失败用例：初始方案、上/下阵/重置、保存失败保草稿、保存中编辑及切方案。
- [x] LineupBoardModel/Controller；LineupBoardPage 只渲染快照和派发意图，复用草稿与美术服务。
- [x] 更新受影响 UI/架构测试，绑定最小验证、类型诊断、Cocos刷新与文档迁移状态。

## 验证结果

实现及专项验证已完成；扩展检查中的未通过项、类型诊断和运行时覆盖边界见 [验证记录](2026-11-02-card-popup-mvc-validation.md)。未提交版本库。
