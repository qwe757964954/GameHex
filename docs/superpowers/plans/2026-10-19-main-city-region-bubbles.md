# 自选主城区域气泡提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在地图编辑器中支持逐区配置三种倾向，并在自选主城时以可收起、可展开的地图气泡向玩家展示己方各区倾向。

**Architecture:** 保留地图 JSON `regions[].tendency` 作为唯一配置源，由编辑器按纵深初始化默认倾向并在导入、撤销 / 重做、导出中保留。客户端以纯 TypeScript 解析玩家半区的区域提示描述，再由棋盘上的独立、非交互视图层绘制气泡；复用现有提示开关和主城选择阶段，不改变选点规则与网络消息。

**Tech Stack:** Cocos Creator 3.8 / TypeScript、地图编辑器原生 JavaScript + HTML、`node:test` 与 `tsx`。

**Spec:** `docs/superpowers/specs/2026-10-19-main-city-region-bubbles-design.md`

## Global Constraints

- 倾向固定为 `rush`（速攻）、`control`（控场）、`develop`（发育）；默认前区速攻、中区控场、后区发育。
- 既有地图缺少倾向字段时按区域深度补默认值；未知倾向值报配置错误。
- 气泡仅展示玩家半区已配置且有可用格子的区域，不拦截格子触摸。
- 复用现有「收回提示 / 显示提示」开关；不新增选点状态机，不改变服务器协议或主城合法性规则。
- 不覆盖工作区已有的 `select_river.json` 与 `tools/map-editor/presets/select_river.json` 修改。
- 如需修改 Prefab，必须通过 Cocos MCP 定位、修改并刷新验证；不得手改 Prefab。

## Review Focus

- 旧地图没有 `tendency`：导入、编辑器导出和运行时提示都应使用该纵深默认值；由 Task 1 的旧格式往返测试和 Task 2 的默认映射测试覆盖。
- 地图带未知倾向值：编辑器导入与客户端地图配置边界都应报错，不得静默变成默认倾向；由 Task 1 的无效值导入测试和 Task 2 对 `configureZCMap()` 的验证覆盖。
- 同一 `section + depth` 区域修改倾向或撤销 / 重做：现有涂色格不得丢失，JSON 应反映当前选择；由 Task 1 的更新与历史测试覆盖。
- 多区 / 空区 / 缺少格子坐标：只生成有效己方区域气泡，锚点为有效区域格中心均值；由 Task 2 的过滤与锚点测试覆盖。
- 收起、确认己方主城、重复 render 或销毁棋盘：气泡不遮挡输入、不残留、不累积；由 Task 3 的显隐、清理和视图契约测试覆盖。

---

### Task 1: 地图编辑器逐区倾向配置与持久化

**Files:**
- Modify: `tools/map-editor/index.html` — 在区域工具箱增加固定三选一倾向控件。
- Modify: `tools/map-editor/app.js` — 增加纵深默认值、导入校验、区域更新、撤销 / 重做和导出保留。
- Test: `tests/map-editor.test.ts`

**Interfaces:**
- Consumes: 当前 `regions` 数据结构 `{ section, depth, cells, tendency?, text? }` 和 `regionBrush`。
- Produces: `regions[].tendency` 只取 `rush | control | develop`；缺字段时依 `front → rush, mid → control, back → develop` 补齐。区域工具中改变倾向会更新当前 `section + depth` 区域；未创建区域时该值用于后续涂色。

- [x] **Step 1: 写编辑器倾向行为失败测试**：新增测试断言 `front/mid/back` 默认依次为 `rush/control/develop`；导入无 `tendency` 的旧区域后 JSON 导出补出默认值；导入 `tendency: 'unknown'` 时 `applyLayout` 显示错误且不覆盖当前状态；倾向变更只改当前 `section + depth` 区域，格子不变并由撤销 / 重做还原，导出 / 再导入仍保留该值。
- [x] **Step 2: 运行测试确认失败**：`npx tsx --test tests/map-editor.test.ts`。预期新倾向断言失败。
- [x] **Step 3: 在区域工具箱增加倾向选择器**：新增值为 `rush/control/develop` 的控件；切换纵深时显示该纵深默认值或该区域当前值。
- [x] **Step 4: 在 `tools/map-editor/app.js` 实现归一化和选择行为**：让 `cloneRegions(items)` 对缺字段区域补默认并拒绝未知值；新增区域写入当前倾向；选择器变化只更新当前 `section + depth` 区域，不触碰其 `cells`；倾向控件与纵深切换、`syncControls()`、snapshot/undo、导入、预设和 `buildJSON()` 维持同步。
- [x] **Step 5: 运行编辑器测试确认通过**：`npx tsx --test tests/map-editor.test.ts tests/map-editor-server.test.ts tests/map-editor-export.test.ts`。新增倾向行为通过；记录基线中已存在的地图 fixture/preset 断言失败。
- [x] **Step 6: 提交本任务变更**：仅暂存本任务的 HTML、JS 和测试文件。

### Task 2: 己方区域提示纯数据解析

**Files:**
- Create: `assets/script/app/zcds/model/ZCSpawnRegionHint.ts` — 纯 TypeScript 的提示描述解析。
- Test: `tests/zcds-spawn-region-hint.test.ts`
- Verify: `assets/script/app/zcds/model/ZCMapConfig.ts` 的现有倾向类型与默认映射；仅在验证发现规则缺失时修改此文件。

**Interfaces:**
- Consumes: `ZCMapRegion[]` 和 `ReadonlyMap<number, { x: number; y: number }>`，坐标来自当前渲染棋盘的格节点位置。
- Produces: `resolveZCSpawnRegionHints(regions: readonly ZCMapRegion[], cellPositions: ReadonlyMap<number, Readonly<{ x: number; y: number }>>, section: number): IZCSpawnRegionHint[]`；每项包含 `depth`、展示文案 `label` 和 `x/y` 格心均值。文案按 `ZC_TENDENCY_TEXT[region.tendency ?? ZC_DEPTH_TENDENCY[region.depth]]` 生成；只处理传入的己方 `section`，无区域格或无有效坐标的区域不产生提示。未知倾向由此前的地图配置边界拒绝。

- [x] **Step 1: 写提示解析失败测试**：新增 `resolveZCSpawnRegionHints` 用例，断言前 / 中 / 后默认倾向文案、覆盖倾向文案、`section` 过滤、空区过滤、缺少坐标过滤，以及多个有效格坐标算术均值锚点；另断言 `configureZCMap()` 对 `tendency: 'unknown'` 抛出已定义配置错误。
- [x] **Step 2: 运行测试确认失败**：`npx tsx --test tests/zcds-spawn-region-hint.test.ts`。预期模块或解析函数不存在。
- [x] **Step 3: 实现 `resolveZCSpawnRegionHints(regions, cellPositions, section)` 和 `IZCSpawnRegionHint`**：复用 `ZC_DEPTH_TENDENCY` 与 `ZC_TENDENCY_TEXT`；不读 Cocos 全局、不生成节点、不改变传入数据。
- [x] **Step 4: 运行提示解析测试和配置测试**：`npx tsx --test tests/zcds-spawn-region-hint.test.ts tests/zcds-select-map-label.test.ts tests/zcds-spawn-region.test.ts`。新解析测试通过；记录基线中已存在的 `zcds-select-map-label` 接线断言失败。
- [x] **Step 5: 提交本任务变更**：仅暂存提示解析模块及其测试（如需修改配置模型，也一并纳入）。

### Task 3: 棋盘气泡覆盖层与主城阶段生命周期

**Files:**
- Create: `assets/script/app/zcds/view/ZCSpawnRegionHintOverlay.ts` — 创建并复用最多三个气泡节点，绘制背景与文案。
- Modify: `assets/script/app/zcds/view/ZCGameRenderWorld.ts` — 将区域数据和格子位置传给解析器及覆盖层，移除把区域提示写入格子内容标签的路径。
- Modify: `assets/script/app/zcds/view/ZCHexView.ts` — 移除旧 `regionText` 展示契约与格内区域文案分支。
- Modify: `assets/script/app/zcds/ZCGame.ts` — 在 `finishSpawnSelection()` 将区域覆盖层从棋盘移除。
- Test: `tests/zcds-select-map-label.test.ts`, `tests/zcds-resource-unit-preview.test.ts` — 删除旧格内区域文案契约并更新视图输入断言，覆盖覆盖层接线、显隐和生命周期。

**Interfaces:**
- Consumes: Task 2 的 `IZCSpawnRegionHint[]` 和 `hintsVisible`。
- Produces: `ZCSpawnRegionHintOverlay.render(hints: readonly IZCSpawnRegionHint[], visible: boolean): void` 与 `ZCSpawnRegionHintOverlay.clear(): void`；`ZCGameRenderWorld.clearSpawnRegionHints(): void` 转发清理。显示时按描述复用节点并全量赋值，隐藏或无提示时不显示旧内容，`clear()` 销毁并清空其自有节点。

- [x] **Step 1: 写气泡接线 / 生命周期失败测试**：更新 `tests/zcds-select-map-label.test.ts`，断言选点渲染调用专属覆盖层且不再构造格内 `regionText`；更新 `tests/zcds-resource-unit-preview.test.ts` 中受影响的展示输入契约；提示显隐使用同一个 `hintsVisible`；`ZCGame.finishSpawnSelection()` 清除选点气泡；`ZCGameRenderWorld.destroy()` 销毁覆盖层。
- [x] **Step 2: 运行测试确认失败**：`npx tsx --test tests/zcds-select-map-label.test.ts`。预期旧的格内文本断言失败或新覆盖层契约缺失。
- [x] **Step 3: 实现 `ZCSpawnRegionHintOverlay`**：在棋盘根节点下创建专属覆盖层；每个气泡节点显式配置 `UITransform`，用 `Graphics` 绘制圆角底和 `Label` 绘制「区名 · 倾向」；不注册触摸监听、不添加 `BlockInputEvents`，确保触摸穿透到格子。
- [x] **Step 4: 接入 `ZCGameRenderWorld`、`ZCHexView` 和 `ZCGame`**：从己方区域格视图读取格心坐标并调用 Task 2 解析器；每次选点渲染全量更新气泡；从 `IZCSpawnHexPresentation` 与 `ZCHexView.renderSpawnSelection()` 删除 `regionText` 契约和格内文字分支；实现 `clearSpawnRegionHints()`，在 `finishSpawnSelection()` 和 world `destroy()` 中调用清理。
- [x] **Step 5: 运行主城选择与相关视图测试**：`npx tsx --test tests/zcds-select-map-label.test.ts tests/zcds-spawn-region-hint.test.ts tests/zcds-spawn-base-confirm.test.ts tests/zcds-spawn-selection-view.test.ts`。新增覆盖层断言通过；记录基线中的确认按钮和标签接线失败。
- [x] **Step 6: 运行绑定专项验证**：`npx tsx --test tests/zcds-spawn-selection.test.ts tests/zcds-spawn-region.test.ts tests/map-editor.test.ts`。新增功能断言通过；记录基线中的地图 preset fixture 失败。
- [x] **Step 7: 提交本任务变更**：仅暂存本任务的视图实现和测试文件。

## 最终自检

实现完成后运行：

```powershell
npx tsx --test tests/map-editor.test.ts tests/map-editor-server.test.ts tests/map-editor-export.test.ts tests/zcds-spawn-region-hint.test.ts tests/zcds-select-map-label.test.ts tests/zcds-spawn-base-confirm.test.ts tests/zcds-spawn-selection-view.test.ts tests/zcds-spawn-selection.test.ts tests/zcds-spawn-region.test.ts
```

实际结果：新增倾向、解析、气泡与生命周期断言通过；全量测试仍有 134 个与实现前相同的基线失败。运行时只在己方选点时展示正确气泡，复用地图级描述缓存，按钮可收起 / 展开，格子仍可点击，确认和退出后没有残留覆盖物。
