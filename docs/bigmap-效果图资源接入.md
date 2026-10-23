# 大地图与基地效果图资源接入

## 资源与分层

资源入口：`assets/resources/image/bigmap/concept/`，共 26 张 PNG：16 张建筑、场景及资源图标，9 张界面素材，1 张无建筑的基地背景。

这些资源由效果图风格重新分层生成，再切分透明图集；没有把带文字、等级与按钮的整屏截图当成游戏背景。图集源保留在本机 Codex 的 `generated_images` 目录，运行资源全部落在工程内。

`manifest.json` 记录切图尺寸、源图单元格位置及 SHA-256。所有 `.meta` 由 Cocos 资源刷新生成。父目录 `image/bigmap/auto-atlas.pac` 递归覆盖，子目录不再放第二份自动图集。

建筑图与配置分开：`BigMapArtCatalog` 仅映射配置 id 到图，不增加建筑类型、不改变数值。当前实际配置为主城、粮食田、木材田、铁矿田、货币田、科技树、建造队列、装饰雕像；效果图中的兵营素材同时保留为独立美术资源，没有为配合插画新增兵营规则。

## 运行时接线

2026-10-22：主界面「世界」入口改用 `BigMapEntry` 的 Canvas 全屏挂载路径，不再传入主城父节点或底栏预留高度。原主界面 HUD 和七格菜单被覆盖，返回时恢复原页选中态。全屏回归通过真实 `MainTabHost.openBigMap` 入口验证，而非只单独创建 `BigMapPage`。

本次全屏验证：127 条大地图测试及主界面世界入口用例通过；引擎实测根节点挂在 Canvas 下，尺寸 720×1465.846，与画布一致，位置为 (0, 0)，层级高于主城页面。完整 `main-hud-reference` 测试中仍有 1 条与本次无关的 `ArenaRoot/PlayerInfo` 结构断言失败，未修改该 Prefab；单独编译主界面调用链缺少 Cmd/fgui 等全局声明，未作为类型检查通过结果。

- `BigMapArtLoader` 通过 `AssetService` 加载，并由页面 `ResourceScope` 管理引用；重复路径在本次加载中合并，请求前后检查关闭状态。布局指定的世界背景仍优先；美术缺失保留旧建筑兜底。
- `BigMapBaseView` 用独立背景、透明建筑和可点击地块呈现实际存档。布局与拾取共用纯 TS 几何，支持非正方形配置；建筑按脚底位置排序。
- `BigMapPage` 使用全宽基地场地、按需建造目录、底部大地图/基地导航、资源图标、九宫面板及独立升级按钮。点击建筑只选中，升级、取消及收取仍调用已有 Presenter 动作。
- `plotDetail` 复用原升级规则给出只读预览，不扣资源、不写存档；图标名称、等级、资源数、队列倒计时均由真实状态驱动。建筑解锁仍只取冒险章节。
- 本次未修改 Prefab、地图 JSON、配置生成产物或存档格式。

## 素材生成方式与提示词

使用内置 imagegen，未调用外部 API 脚本。为避免整屏图中的文字、背景和建筑混为一张，分别生成以下素材后切图：

1. 建筑图集最终提示词：

> A production game sprite sheet, exactly FOUR COLUMNS and TWO ROWS on transparent background. Exactly 8 separate isolated objects centered in equal cells, generous gutters, consistent hand painted cartoon post apocalyptic wasteland, three-quarter overhead isometric view, warm tan and rust-orange palette with crisp dark brown outlines. No text, no labels, no ground platforms, no background, true transparent alpha. Top row left to right: (1) round brown wooden tree-stump headquarters tower, rounded steel door, green glowing circular window, blue solar panel on left, green flag atop parapet and wood root buttresses; (2) golden wheat farm with small rusty tank and tiny windmill; (3) teal-roofed corrugated shed sawmill with circular saw and pile of cut logs; (4) rusty orange curved-roof barracks hangar with target dummy. Bottom row: (5) small ironworks furnace with chimney, glowing orange fire and ore cart; (6) tan canvas warehouse with gray crates; (7) wood scaffolding over unfinished small building with draped tan cloth; (8) fortified scrap metal outpost with red flag and rust-red roofs. Charming chunky detailed miniature game art. Single sprite per cell, complete silhouettes fit inside cells. Render a landscape sheet, width twice height.

2. 场景与资源图集最终提示词：

> Production sprite atlas for a hand painted cartoon post-apocalyptic mobile strategy game, exactly 4 COLUMNS and 2 ROWS, EIGHT isolated sprites in 8 equal cells, landscape width exactly twice height, generous transparent gutters. True transparent alpha background. Objects centered and fully inside their own cell with 10% margin. Three-quarter overhead isometric view, crisp dark brown outlines, rusty warm brown scrap metal, warm daylight from upper-left. NO text, no UI plaques, no numbers, no scenery backdrop, no ground platforms. Top row from left: (1) a compact hostile mutant tent camp with red pennants and scrap barricade; (2) small rusty blue water tower on four metal legs, tiny pipe and ladder; (3) three chunky gray-brown angular desert rocks; (4) a compact tuft of sage green dry wasteland grass. Bottom row from left: (5) large distinct golden wheat resource icon, three wheat ears diagonal, no bag; (6) warm brown wood resource icon, three stacked cut logs with rings; (7) silver-gray iron resource icon, two metal ingots; (8) gold resource icon, small stack of embossed golden coins, no letters. Consistent polished miniature game art, transparent margins, absolutely no touching between cells.

3. 界面素材使用基地效果图作为风格参考，要求 3×3 透明单元格：空白标题面板、详情面板、金色主按钮、普通页签、选中页签、建筑名牌、空地台面、体力闪电、首页图标；严格去除文字、数值与建筑缩略图。背景单独保留空庭院与边缘围栏，去除全部建筑、地块标记、人物和 UI。

复切命令：

```powershell
python tools/slice_bigmap_art.py --sprites <建筑图集.png> --details <资源图集.png> --ui <界面图集.png> --background <基地背景.png>
```

然后通过 Cocos MCP 刷新 `db://assets/resources/image/bigmap` 和 `db://assets/script/app/bigmap`。

## 验证与边界

- `npx tsx --test tests/bigmap*.test.ts`：119 条通过，包含资源校验、重复加载、关闭取消、只读详情与布局拾取。
- 对 `BigMapPage.ts` 及其依赖执行定向 TypeScript 检查通过。
- `python tools/pvp_card_check.py` 通过。
- Cocos 浏览器预览使用隔离的内存存档验证完整素材加载、底部导航及真实点击放置建造。截图中的多个已建建筑来自预览夹具，不写入玩家存档。
- 预览产物保存在 `.codex-tmp/bigmap-art-integration/`。未做真机包验证；原登录页的远程配置 CORS/代理问题不在此次修改范围。
