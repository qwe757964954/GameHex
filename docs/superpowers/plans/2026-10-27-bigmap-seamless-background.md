# 世界地图连续背景接入

**目标：** 使用美术 `战斗地图/bigMapBG.png` 无缝平铺世界地图；用户已选择保留上方六边形地皮。

**方案：** 对比替换地皮与保留地皮，采用用户选择的后者。复用现有背景 Sprite，置于地图 content 最底层，使用 TILED 模式与原图尺寸；根据当前相机计算覆盖视口的整纹理区间，位置始终对齐世界坐标的纹理网格，拖动与缩放不会重置纹理相位。缺图时保留原来的布局背景兜底。规则、地块、势力与标记不变。

**边界：** 资源仅经 AssetService + 页面 scope 加载；原图经 Cocos MCP 导入，meta 由引擎生成；不修改现有 prefab、配置和其他未提交工作。背景不入自动图集，避免重复采样边缘串色。

**技术：** Cocos Creator 3.8、TypeScript、tsx 测试、引擎预览探针。

## 实施与验证

- [x] 新增纯 TS `BigMapBackgroundLayout`，计算 viewport 的世界坐标范围并扩展到整纹理边界；测试负坐标、远距离拖动、0.15～1.6 倍缩放、边界跨越、纹理相位与非法尺寸。
- [x] 经 MCP 导入 `assets/bundles/bigmap/image/bigmap/bigMapBG.png`，保留原图；加载器增加 `tiledBackground`，保留布局背景行为、取消语义和加载去重；执行加载器回归。
- [x] `BigMapWorldView` 复用背景节点，TILED + CUSTOM + trim=false，放入 content 第 0 层；相机变化时同步覆盖范围；缺失新素材走原背景，保留地块及装饰池。
- [x] 引擎验证图层、尺寸、接缝与拖动缩放，执行相关地图、生命周期与架构测试，记录结果。

## 复核重点

跨纹理边界不跳图；负坐标正确取整；最小缩放不露底；缺图回退不误平铺旧海报；切页取消不产生迟到引用。

## 验证结果

1. `npx tsx --test tests/bigmap-background-layout.test.ts tests/bigmap-art-loading.test.ts tests/bigmap-world-presentation.test.ts tests/bigmap-template-lifecycle.test.ts tests/bigmap-world.test.ts tests/bigmap-base.test.ts tests/bigmap-battle.test.ts tests/bigmap-presenter.test.ts tests/bigmap-territory-boundary.test.ts tests/bigmap-territory-color.test.ts tests/bigmap-resource-item-icons.test.ts tests/view-intent-events.test.ts`：102/102 通过。
2. `node tmp/bigmap_seamless_background_probe.mjs`：真实 Cocos 预览中加载世界地图 prefab 和原图，五组相机状态全部覆盖视口，验证背景在 content 最底层、49 张原有地皮仍在上方、缺图可切回原背景。脚本错误为 0。截图为 `outputs/bigmap-seamless-background/with-hexes.png`、`seams.png`，数据为同目录 `result.json`。这是独立表现层探针，未覆盖完整联网业务操作。
3. 原图与导入文件 SHA256 一致；引擎生成 meta 并经 MCP 设置 packable=false、wrapModeS/T=repeat，已刷新资源。
4. `git diff --check` 在本次修改的已跟踪文件上通过。
5. `npx tsc --noEmit --pretty false --incremental false` 未通过，诊断包括引擎声明中的 TypedArray/Map 错误等；未出现 BigMapBackgroundLayout、BigMapWorldView、BigMapArtLoader 或 tiledBackground 的诊断。日志为 `outputs/bigmap-seamless-background/typecheck.log`。
6. `python tools/pvp_card_check.py` 未通过：脚本按旧 `assets/resources/units` 路径报告 17 条 prefab 缺失，已逐条确认这 17 份都存在于 `assets/bundles/battle/units`。未扩大任务范围修改通用检查脚本。

改动限于美术导入、AssetService 加载器、背景布局与视图接线及相关测试。无 prefab/配置改写，无规则与存档变更。
