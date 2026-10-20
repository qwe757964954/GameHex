# 主城内嵌领地地图归属调整

## 目标

领地地图现在是主城页面的一部分。主城显示自己的顶部 HUD 与底部导航，地图区域只展示可交互地图；不再保留重复的章节 HUD。页面容器与主城使用的地图 Prefab 归入 `main`，领地规则与地图功能组件继续由 `territory` feature 维护。

## 已确认范围

- 主城专用页面容器与地图 Prefab 移到 `app/main`、`ui/main`。
- `HudLayer` 及其 `TerritoryHeaderView` 组件、节点引用、初始化、事件和渲染接线从主城地图页面移除。
- `TerritoryPresenter`、地图/站点/详情视图、资源加载、地图布局与规则继续留在 `app/territory`。
- 主城入口、ArenaRoot、宝箱栏、主界面 HUD 和底部页签行为保持现状。
- 不改 Presenter 的业务状态、关卡/章节数据或存档协议；地图仍使用当前默认章节和既有状态加载路径。

## 结构与数据流

新增/迁移后的主城地图页面组件为 `assets/script/app/main/MainTerritoryMap.ts`，主城专用 Prefab 为 `assets/resources/ui/main/MainTerritoryMap.prefab`。页面组件负责创建 TerritoryPresenter、初始化 TerritoryMapView 与详情面板、加载领地资源，并把 Presenter 状态交给地图视图渲染。`MainTabHost` 在主城页挂载前把 `AssetService` 注入该组件。

地图的 Presenter、模型、地图/站点/详情视图和资源加载器继续位于 `assets/script/app/territory/**`。依赖保持单向：主城组合页面使用领地 feature 的现有接口，不把关卡规则或存档逻辑移入 `main`。

`MainTerritoryMap.prefab` 只保留地图所需的 `MapViewport`、`MapLayer`、地图渲染层及站点详情面板。移除 `HudLayer`、`TerritoryHeaderView` 组件与其章节/钱包/提示控件。ArenaRoot 中现有嵌套实例保持相同地图位置、裁剪、滚动、渲染层顺序和点击行为；通过 Cocos MCP 移动/编辑 Prefab，并刷新资产数据库。

## 生命周期

主城页面实例化后、挂到 `Content` 之前，`MainTabHost` 将 `AssetService` 注入 `MainTerritoryMap`。组件在 `onLoad` 中初始化地图和详情面板，在 `start` / Presenter 订阅中按既有流程开始加载和渲染。移除章节 HUD 后，不再初始化 `TerritoryHeaderView`、订阅上一章/下一章节点事件，也不再渲染 `state.hud`；地图与站点详情的事件和销毁清理保持不变。

## 验收标准

- `TerritoryPage.prefab` 不再是主城地图实例来源；ArenaRoot 使用 `ui/main/MainTerritoryMap.prefab`。
- `HudLayer` 与 `TerritoryHeaderView` 不再出现在主城地图 Prefab 或主城地图组件接线中。
- 主城进入时仍能加载地图、滚动/拖动地图、点击站点打开详情并开始现有 PVE 流程。
- 领地 Presenter、地图层和站点表现规则仍位于 `app/territory`，不复制第二套地图状态机。
- 新 Prefab 通过 Cocos Prefab 校验；相关 TerritoryPage split、Presenter、地图居中、翻格、建筑抖动和主城路由用例通过。

## 实现与验证边界

- 先确认工作区已有改动并避免覆盖；只调整本需求涉及的主城/领地页面文件、Prefab、契约测试和职责文档。
- Prefab 节点修改使用 Cocos MCP；资产移动使用 Cocos asset operation；不手写 Prefab JSON 或 `.meta`。
- 最小验证包括 `tests/territory-page-split.test.ts`、`tests/territory-presenter.test.ts`、`tests/territory-cell-center-align.test.ts`、`tests/territory-hex-flip.test.ts`、`tests/territory-building-shake.test.ts`、`tests/main-tab-adventure-route.test.ts`，并用 Cocos MCP 验证新 Prefab 与 ArenaRoot 引用。
