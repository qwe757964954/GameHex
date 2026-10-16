# 领地地图 UI 合批优化设计

## 目标

降低领地地图站点数量增加时的 Draw Call 增长，同时保留 JSON 驱动、双向 ScrollView、Prefab 配置样式和按 `cellId` 复用节点的现有结构。

验收口径：

- 地图格子继续使用同一 SpriteFrame 连续渲染，不回退到逐格 Graphics。
- 每个站点不再持有独立的 `Graphics` 名称底条。
- 站点视觉按“图标、名称底条、名称文字、角标”全局分层，避免每个站点重复切换渲染状态。
- 所有站点继续保持整块可点击，换章和删除站点时不遗留脱离根节点的视觉节点。
- 资源缺失时保持现有降级语义，不因空 SpriteFrame 抛异常。
- 优化前后站点状态、文案、颜色和点击行为不变。

## 根因

`TerritoryStation.prefab` 当前每个实例依次包含 `Sprite → Graphics → Label → Label`。Cocos 按节点树顺序提交 UI，同一材质只有在连续出现时才能合批；`Graphics` 本身不能参与普通 UI 合批。因此站点数量越多，渲染状态切换越接近按站点线性增长。

六角格已经集中在 `GridLayer` 并共享同一 SpriteFrame，首要问题不是格子 Draw Call，而是站点内部渲染器交错。400 个格子仍有节点遍历成本，但不在本次第一阶段重写为 Mesh，避免同时扩大性能优化和地图交互风险。

## 选定方案

保留一个 `TerritoryStation.prefab` 作为站点样式与交互模板。实例化后，`TerritoryStationView` 将图标、名称底条、名称文字、角标节点分别迁移到 `TerritoryMapView` 提供的四个全局渲染层；站点根节点只留在命中层负责 Button 点击。

分层结构：

```text
MapLayer
├─ GridLayer
├─ StationIconLayer
├─ StationCaptionLayer
├─ StationTextLayer
├─ StationBadgeLayer
└─ StationHitLayer
```

视觉节点在 Prefab 中的局部坐标保存为偏移量。迁移后，`TerritoryStationView.setMapPosition()` 使用地图坐标加 Prefab 偏移同步各视觉节点，因此样式尺寸和排版仍由 Prefab 决定，代码不写死 UI 坐标。

名称底条由 `Graphics` 改为九宫格 `Sprite`。状态颜色继续通过 `Sprite.color` 设置，不增加状态贴图数量。

## 组件职责

### `TerritoryMapView`

- Inspector 持有五个站点层引用和站点 Prefab。
- 创建站点时向 `TerritoryStationView.initialize()` 注入渲染层与点击回调。
- 不直接操作站点子节点样式。
- 移动站点统一调用 `setMapPosition()`，不再直接只移动根节点。
- 移除站点时先 `dispose()`，再销毁根节点，保证已迁移的视觉节点同步销毁。

### `TerritoryStationView`

- Inspector 必填引用改为 `Sprite` 名称底条，删除 `Graphics` 依赖。
- 初始化时只迁移一次视觉节点，并记录四个 Prefab 局部偏移。
- `render()` 继续做幂等全量赋值：图标、文案、颜色、角标和交互状态。
- `setMapPosition()` 同步命中根节点和全部视觉节点。
- `dispose()` 可重复调用，清理事件与脱离根节点的视觉节点。
- `onDestroy()` 作为生命周期兜底调用 `dispose()`。

## 资源与文字

- 领地格子、建筑、资源图标、名称底条、角标底图进入同一 Auto Atlas；继续使用内置 Sprite 材质和一致的纹理采样配置。
- 名称与角标统一字体、材质和缓存模式。短文本优先使用 `CHAR`；若项目已有覆盖所需汉字的 BMFont，则优先复用 BMFont。
- 动态图集只作为平台允许时的补充，不依赖它修复节点顺序问题。
- 不在代码中全局强制开启动态图集；Native/小游戏内存策略由组合根或构建配置统一决定。

## 路线与静态批处理

当前领地视图没有独立路线 Graphics，本次不创建空实现。后续路线必须按颜色/粗细聚合为少量共享 Graphics，禁止一条路线一个组件。

本次不在整个 MapLayer 上启用 `UIStaticBatch`：地图含 ScrollView/Mask，站点还会变更状态。完成 Graphics 移除后，可以单独对完全静态的 GridLayer 做实机实验，但不作为本次验收依赖。

## Prefab/资源编辑边界

本任务中用户明确要求先验证 Cocos MCP 连接，再由 MCP 修改 prefab。实施边界如下：Prefab 只通过 Cocos Creator 的 prefab 编辑模式修改并在保存后校验；不通过脚本或文本编辑 `.prefab/.scene/.meta`。

1. `TerritoryPage.prefab/MapLayer` 下建立四个视觉层与一个命中层，尺寸、锚点与现有 StationLayer 一致。
2. 把 `TerritoryMapView` 新增的五个 Inspector 引用分别绑定到上述节点。
3. `TerritoryStation.prefab/CaptionBg` 移除 `cc.Graphics`，添加 `cc.Sprite`，使用九宫格 SpriteFrame，保留原尺寸。
4. 将 `TerritoryStationView.captionSprite` 绑定到 CaptionBg Sprite，并确认 Icon、CaptionLabel、BadgeLabel、Button 仍为必填引用。
5. 三张 128×128 建筑图保持 `packable: true`，允许 Cocos 动态合图；若真机数据表明仍有纹理切换，再补静态 Auto Atlas。
6. 将两个站点 Label 的 Cache Mode 设为 `CHAR`，保持相同字体、材质、描边配置。

上述绑定由 Cocos MCP 完成，并以 prefab 格式校验、结构测试和目标运行时预览作为分级验证证据。

## 测试与验证

自动化测试先于实现，至少覆盖：

- Prefab 合约不再接受 `CaptionBg` 上的 Graphics，并要求 Sprite。
- 页面 Prefab 合约要求五个全局站点层和对应 Inspector 引用。
- `TerritoryStationView` 初始化只迁移一次，保留 Prefab 偏移。
- `setMapPosition()` 同步根节点和四个视觉节点。
- `dispose()` 重复调用安全，脱离根节点的视觉节点不会泄漏。
- `render()` 颜色不变时不重复赋值，并在空图标、空角标时正确禁用节点。
- 现有地图布局、章节 JSON、ScrollView 和点击回归测试继续运行。

运行时验证使用章节四的 49 个站点作为压力场景，记录优化前后 Draw Call、渲染批次和帧时间。目标是站点主体批次随渲染层数量增长，而不是随站点数量线性增长；具体数值以浏览器预览和目标真机为准。

## 非目标

- 本次不把六角格重写为自定义 Mesh。
- 本次不实现随机奖励、资源据点玩法、异步 PVP 或服务端存档。
- 本次不改变地图 JSON 格式、站点绑定规则或章节进度规则。
- 本次不通过脚本或文本编辑 Prefab、Scene 及其 Meta；Prefab 修改仅使用已经连通的 Cocos MCP prefab 编辑流程。
