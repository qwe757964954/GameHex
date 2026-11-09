# 章节领地地图编辑器

章节领地与对战地图是两套协议，入口为 `http://127.0.0.1:8787/territory.html`。

```powershell
node tools/map-editor/server.mjs --open
python tools/map-editor/copy_territory_maps.py --dry-run
python tools/map-editor/copy_territory_maps.py --id chapter_01
```

Windows 下也可以直接双击 `tools/map-editor/copy-territory-maps.bat`；支持把参数继续传给 Python 脚本，例如：

```powershell
tools\map-editor\copy-territory-maps.bat --dry-run
tools\map-editor\copy-territory-maps.bat --id chapter_02
```

编辑器保存到 `tools/map-editor/presets/territory/`，发布时把**同一份校验后的 JSON**写入三个目标：

| 目标 | 用途 | 是否生成 `.meta` |
| --- | --- | --- |
| `assets/resources/config/territory-maps/` | Cocos 资源（客户端读） | 是 |
| `doc/塔防数据配置/json/sever/` | 策划侧服务端表 | 否 |
| `doc/塔防数据配置/json/client/` | 策划侧客户端表 | 否 |

> `sever` 是仓库既有拼写（与 `tools/config/export_tafang.mjs` 一致），不是 `server` 的笔误。
> 两个策划目录不是 Cocos 资源目录，**不生成 `.meta`**。

发布前会检查地图尺寸、初始格、固定站点、前置依赖、站点重叠、随机候选格和资源字段；站点数量不是 10 个只提示 warning，不阻断保存。校验只跑一次，三份产物按字节相同。

固定资源点选中后，在右侧填写“固定资源奖励 ID”，对应策划“关卡地图格子奖励”表的正整数 ID。每个固定资源点可以独立填写，切换格子或点击保存时会提交当前输入，地图 JSON 记录在该站点的 `rewardId`；原有 `configId` 保持原义。旧地图没有 `rewardId` 时仍可加载，待策划给出具体 ID 后逐点补齐。
右侧“批量设置固定资源奖励”可输入一个正整数奖励 ID，一键覆盖当前地图全部固定资源格的 `rewardId`。该操作可一次撤销，仍需 Ctrl+S 保存；其他类型站点不受影响。

客户端静态模型位于 `assets/script/app/territory/model/TerritoryMapConfig.ts`。玩家占据、探索中、停用等进度状态不写进静态地图 JSON，应由后续 `TerritoryProgress` 运行时模型保存。

### 随机站点的逐格建筑 ID（2026-10-27 批量填充）

右侧「随机站点（所选格）→ 建筑 ID」写的是 `randomSites.buildingIds`（`{"<cellId>": "<建筑ID>"}`），
**只对单个据点的候选格生效**；留空 = 该格统一交给奖励池。空串会被校验丢掉，等于"不写这个键"。

逐格填 400+ 个格子不适合手点，用脚本按比例铺：

```powershell
python tools/map-editor/randomize_random_sites.py --dry-run          # 先看统计
python tools/map-editor/randomize_random_sites.py                    # chapter_01~07 全跑
python tools/map-editor/randomize_random_sites.py --id chapter_03 --ratio 0.8 --seed 7
python tools/map-editor/randomize_random_sites.py --building-ids 69008-69015 --no-publish
```

- 名额 = `round(候选格 × --ratio)`，**先定名额再随机挑格**（52 格的小图逐格抛硬币会漂到 77%/92%）；
- 每格从 `--building-ids` 里均匀抽 1 个，默认 `69008-69015` = `territory_decor_01_v1 … _08_v1`；
- 只认 `chapter_\d{2}`，`chapter_smile` 这类试验图不会被顺手改；
- 改完依次落三处：预设（`indent=2` + LF）、`copy_territory_maps.copy_one`（资源目录 + 策划 JSON）、
  `assets/remoteRef/`（与 `tools/ref/ref_compress_json.py` 同款 `indent=0` 紧凑格式）。

### 关卡 / 首领 / 异步据点的建筑 ID（2026-11-06 批量补齐）

`stage` / `boss` / `asyncPvp` 这三类站点在 `stationIconOf` 里是「**没配 `buildingId` ⇒ 不画建筑**」，
所以 `chapter_02~07` 原本一个建筑都看不到。口径与 `chapter_01` 一致，按**每个 `(type, configId)` 组填一格**：

| 站点 `type` | `buildingId` | `build.json` 的 `buildType` |
| :-- | :-- | :-- |
| `stage` | `69004` | 4 普通关（`territory_outpost_v1`） |
| `boss` | `69003` | 3 boss 关（`territory_boss_v1`） |
| `asyncPvp` | `69002` | 2 异步据点（`territory_async_pvp_v1`） |

```powershell
python tools/map-editor/fill_site_buildings.py --dry-run      # 先看要补哪些格
python tools/map-editor/fill_site_buildings.py                # chapter_01~07 全跑（01 会整章跳过）
python tools/map-editor/fill_site_buildings.py --id chapter_03 --no-publish
```

- **幂等**：组里已经有一格配了建筑就整组跳过，`chapter_01` 跑一遍等于没跑；`--overwrite` 才重写；
- 组内填在 **cellId 最小**的那一格（与遍历顺序无关，重跑结果一致）；
- 为什么不是"每格都填"：同一片战斗区域的所有格子共享同一关，每格都画会长出满片同款建筑
  （用户 2026-10-16 报的「327 和 328 长得一样」），`TerritoryStageBinding` 也优先挑带建筑的那格做代表；
- 落盘与校验同 `copy_territory_maps.py`（预设 → 资源目录 + 策划 JSON → `assets/remoteRef`）。

---

## 六边几何与笔刷（2026-10-20 统一）

几何口径现在**只有一份**：`formats/hex-grid.js`，与客户端 `core/hex/HexGridLayout.hexGridNeighborIds` 逐格对齐。
大地图编辑器、领地编辑器、python 发布校验全部走它（`territory-format.js` / `bigmap-format.js` 都只是转出）。

**修掉的坑**：领地编辑器原来有一套**自己的** offset 约定，与客户端 **400/400 格全部不一致**（`territory_format.py` 那份反而是对的）。
后果很难查：编辑器刷「7 格笔刷」实际选中另一组格子；编辑器校验说的「连通」和 python 发布校验说的不是一回事。
`tests/territory-map-format.test.ts` 现在用「20×20 + 40×40 逐格对拍客户端」钉着，别再长出第二套实现。

**渲染几何也一并对齐**：列距 36、行距 **42**（原来 `Y = √3R ≈ 41.57`，与客户端差 1%，20 行累计偏 8px）。
改完 4 张既有章节图**数据不用动**（格子是 row/col，不是像素），重建后仍全部合法。

**新增「按半径刷」**：右侧「按半径刷（环数）」填 N，落笔就按 `circleHexes(半径 N)` 铺一片 —— 与大地图同一个口径。
- 半径 1 = 7 格，2 = 19 格，3 = 37 格；
- **0 = 关闭**，退回原来四档笔刷（1 / 上下3 / 7 / 19）；
- 填了半径时**单点也会铺一片**（与大地图一致）；不填则保持原行为（单点 1 格、拖拽才刷）。

---

## 快捷键与鼠标（2026-10-20 补齐，与大地图对齐）

| 操作 | 作用 |
| --- | --- |
| `Ctrl+S` | 保存（校验不过会拦住） |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` / `Ctrl+Shift+Z` | 重做 |
| `Esc` | **三级退出**：取消格式刷 → 清掉选中 → 回到「选择」工具 |
| `Delete` / `Backspace` | 删掉选中格上的站点；没站点就走擦除（候选格 / 装饰） |
| `1` ~ `9` | 按左侧工具顺序切换（前 9 个） |
| **右键** | 擦除，**可以拖着擦一片** |
| **中键拖动** | 平移画布 |
| 滚轮 | 以光标为中心缩放 |

⚠️ **右键语义与大地图不同，是有意的**：领地右键是「擦除刷」（拖着擦一整片，这是日常最高频的操作），
平移交给中键；大地图没有右键拖刷，所以那边把右键让给了「拖动平移」。
两边 1~9 / Esc / Ctrl 组合是一致的，切编辑器只需要记这一条差异。

---

## 缩放（2026-10-20 对齐大地图）

顶部有 **50% ~ 400% 滑块** + 百分比，滚轮也能缩，三者互相同步：

| 操作 | 锚点 | 说明 |
| --- | --- | --- |
| 拖滑块 | **视口中心** | 拖的时候画面不会往一边跑 |
| 滚轮 | **光标位置** | 光标底下的格子保持不动 |
| 适应窗口 | — | 回到 100% 并归位 |

两种锚点分开处理是刻意的：只按一个锚点做，拖滑块会「画面整体平移」，滚轮会「缩放点乱跳」。
`applyView()` 里统一回写滑块值，所以滚轮 / 适应窗口 / 代码设缩放都不会让滑块与画面脱节。

---

## 同一「战斗 id」的分组高亮（2026-10-20）

地图数据是**每格一条 site 记录**，同一个关卡用相同的 `configId` 串起来
（`chapter_01` 里 `configId=10010` 有 11 条、`10005` 有 7 条）。

所以点中这类格子的任意一格，编辑器会把**同 configId 的所有格子**一起框出来：

- 描边青色虚线（`.cell.site-group`，`stroke-width:2.6` + `dasharray:6 4`）；
- 右侧信息栏显示 `cellId 84 · boss_110 · 同战斗 id 共 11 格`；
- 空格子点上去没有分组，行为不变；
- `configId` 为空的站点按 `site.id` 分组，组里只有自己 —— 与以前一致。

顺带修了一处：找站点原来只比对 `site.cellId`（锚点），**多格 footprint 的站点被点到非锚点格子时会当成空格**。
现在统一走 `siteAtCell()`（按 footprint 反查），渲染索引也把 footprint 里每一格都登记了。

---

## 批量生成章节图：`gen_territory_shapes.py`（2026-10-23）

`presets/territory/chapter_03 … chapter_07` 这五张图不是手画的，由脚本按「图形」生成：

```text
python tools/map-editor/gen_territory_shapes.py            # 生成全部 5 张（含预览 PNG）
python tools/map-editor/gen_territory_shapes.py --only 04  # 只重做十字章
python tools/map-editor/gen_territory_shapes.py --check    # 只校验已落盘的 5 份 JSON
```

| id | 章节 | 图形 |
| --- | --- | --- |
| `chapter_03` | 3 | 飞机章（尖机头 + 后掠主翼 + 窄尾翼） |
| `chapter_04` | 4 | 十字章 |
| `chapter_05` | 5 | 盾牌章（平顶 + 下尖） |
| `chapter_06` | 6 | 菱形章 |
| `chapter_07` | 7 | 心形章（两个圆瓣 + V 形凹口） |

五张图**逐项同配额**（需求要求"每种类型笔刷数量一致"）：

| 项 | 数量 |
| --- | --- |
| 涂色格 | 160（且**恒定 1 块连通**） |
| `fixedResource` | 51（含 9 道门） |
| `randomSites.candidateCells` | 52 |
| `asyncPvp` | 3 × 4 格 |
| `stage` / `boss` | 8 / 2，合计 44 格 |
| 出生点 | 1（不占 site） |

### ⚠️ `chapter_03` 已经**不是**这套配额了（2026-11-06）

用户：「使用章节地图编辑器，给 chapter03 增加 70 个固定格子，以及 70 个随机格子，
不能改变顺序逻辑，可以填充形状的空白处」。

`gen_territory_shapes.py` 的配额是**算满**的（160 = 44 + 12 + 51 + 52 + 1），那 160 格里
一格空位都没有，所以"形状的空白处"只能往剪影外面吃。现在 `chapter_03` 是：

| 项 | 数量 | 说明 |
| --- | --- | --- |
| 涂色格 | **300 / 400**（75%） | 按后掠翼剖面对齐，逐行左右对称（`min + max = 19`） |
| `fixedResource` | **121**（1~9 门 + 10~51 原有 + **52~121 新增**） | 新增补的时候照 `1014`，现已统一成 `1018`（见下节），15 银币 / 1 体力 |
| `randomSites.candidateCells` | **122** | 原 52 + 新增 70 |
| `buildingIds` | **104** | 原 44 + 新增 60（85% 比例，池子还是 `69008-69015`） |
| `stage` / `boss` / `asyncPvp` | 8 / 2 / 3（44 + 12 格） | **一格没动** |

形状不是"往外长"长出来的，而是**先给剖面再填空位**：每行左边缩进
`PROFILE_H = (8,7,6,5,4,3,2,1,0,0,0,0,0,0,0,0,2,3,4,5)`，区间 `[L, 19−L]`，
`Σ L = 50` ⇒ 正好 300 格。第 8~15 行必须满幅——左右翼尖是链上的 `asyncPvp` 站点，
要对称就得两边都够到边缘。（第一版用的是"从现有涂色区均匀外扩"，出来是个圆角矩形，
用户看图否掉了。）

新增是靠 `fill_chapter03_cells.py` 补的（剖面、前置口径都写在脚本头上）：

```bash
python tools/map-editor/fill_chapter03_cells.py --dry-run   # 打 ASCII 预览 + 剖面自检
python tools/map-editor/fill_chapter03_cells.py             # 改预设 + 发布 4 处
```

**随机格的归属**由 `symmetrize_chapter03.py` 单独定（`fill` 之后再跑它）：

```bash
python tools/map-editor/symmetrize_chapter03.py --dry-run
```

它只改「谁是宝箱 / 谁是随机格」，**形状一格不差**（有断言）。口径：绕中轴 `u=9.5`
镜像成对（`(r, 9−k) ↔ (r, 10+k)`，一对同类型）、中间两列 `k=0` 一律给宝箱、
每行按 `可选格数 × 122 / 212` 分名额再用分层抽样摊开 —— 现在中间两列随机格 **0 个**。
⚠️ 宝箱会跟着换位置（两者互补，动一堆必动另一堆），但站点数、`id` 顺序、`rewardId` 都不变。

🔴 **别对 `chapter_03` 跑 `gen_territory_shapes.py --only 03`** —— 它是从图形重新生成的，
会把 121 + 122 覆盖回 51 + 52，140 格的补丁全丢。其余四章仍是上面那套 51 + 52。

### 七章的奖励 id：按章递增（2026-11-06 起）

生成器写的是占位值（门 `1011`、宝箱 `1014`、池 `2001`），**重跑生成器会把这些打回去**。
现在七章的真实口径由 `retarget_chapter_rewards.py` 统一：

| | 规则 | ch01 | ch02 | ch03 | ch04 | ch05 | ch06 | ch07 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fixedResource.rewardId` | `1015 + 章序` | 1016 | 1017 | 1018 | 1019 | 1020 | 1021 | 1022 |
| `randomSites.rewardPoolId` | `2001 + 章序` | 2002 | 2003 | 2004 | 2005 | 2006 | 2007 | 2008 |

```bash
python tools/map-editor/retarget_chapter_rewards.py --dry-run   # 打前后分布 + 待补奖励行清单
python tools/map-editor/retarget_chapter_rewards.py             # 改预设 + 发布 4 处
```

它只动这两个字段（有「除奖励字段外完全没变」的硬断言），站点数 / `cellId` / `footprint` /
`candidateCells` / `buildingIds` 一格不动，可重复跑。

⚠️ 顺序：**`fill` / `symmetrize` / `gen` 之后必须再跑一次 `retarget`**，否则奖励 id 会退回占位值。
⚠️ 奖励表 `levelMapGrideReward` 目前只有 `1001~1016` 与 `2001` 有内容；`2002` 是空壳行
（`{"rewardId": 2002}`，没有 `rewardGroup`），`1017~1022` / `2003~2008` 整行不存在。
**这 13 行没补之前，七章的宝箱和随机格都是空奖励。**

关卡顺序照 `chapter_02` 的口径：`configId` `10011…10020` 按链序递增，第 5、10 个是 BOSS；
相邻两关地块之间恒隔 2 格，中间那格就是门（`fixedResource`，自己也挂在上一关下）。

脚本里写死了三处**踩过的坑**（改之前先读注释）：

1. 锚点必须自动取椭圆环（`choose_chain` 扫半径）—— 链间距对锚点极度敏感，
   手摆 50 个坐标改一次形状就得重摆一遍；
2. 链间距只能用"平移"收敛（`shape_chain`）—— 加减格子会让 44 这个总数漂，配额跟着错；
3. 异步据点必须等链和门都定好之后再种 —— 预占三个圈（≈36 格）在细长图形里会封死走道。

生成完是**本地文件**，还没发布到 `assets/` 与策划表；要上线在编辑器里打开对应章节点发布
（或跑 `copy_territory_maps.py --id chapter_03`）。
