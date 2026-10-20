# 策划地图编辑器 · 大地图（BigMap）方案

> 需求源：《植物大地图系统》（`docs/bigmap-系统落地方案.md` §5.3、§7）
> 现有编辑器：`tools/map-editor/`（关卡 `index.html`+`app.js`｜领地 `territory.html`+`territory-app.js` 994 行｜保存服务 `server.mjs` 582 行｜格式校验 `territory_format.py` 319 行｜发布 `copy_territory_maps.py` 76 行）

---

## 0. 结论

1. **不新起编辑器。** 在 `tools/map-editor/` 下加第三套页面 `bigmap.html` + `bigmap-app.js`，直接复用：SVG 六边格交互、缩放平移、撤销重做、脏标记、校验错误环、`server.mjs` 的 `PUT /api/xxx-presets/:id` + `POST /api/xxx-publish/:id`、`copy_*_maps.py` 的三产物发布。**省掉的是 994 行交互 + 582 行服务 + 76 行发布，不是省掉一个页面。**
2. **真正要改的是架构，不是编辑器**：现在世界是 `buildBigMapWorld(config, seed)` 纯函数**种子生成**的，策划一格都改不了。文档要求 74 座城同心圆分布、每城势力范围、野怪等级环带、出生区块容量 —— 这些必须可编辑。所以第一步是**把世界从「种子生成」改成「布局文件驱动，种子兜底」**。
3. **编辑器只产出静态布局**，不产出任何运行态（归属/积分/快照/基地坐标/刷新 CD）。这条与 `TERRITORY_README.md` 里"进度状态不写进静态地图 JSON"完全一致，别破例。
4. **有一个双真源硬冲突必须先拍**：城池坐标到底写在 `BigMap-城池配置.hexPos`，还是写在布局 JSON（§3.1）。两边都写，跑一次导表就静默回退一边。

---

## 1. 现有资产盘点

| 文件 | 能直接复用 | 大地图要改的地方 |
| --- | --- | --- |
| `territory-app.js`（994 行） | SVG 六边渲染、`cellAtLocal` 拾取、笔刷 1/3/7/19、撤销栈 80 步、`ctmCache` 逆矩阵缓存、错误环 + 浮标、依赖连线、缩放平移 | 行数列上限 `max=60`（`territory.html`）→ 100×100 必须放开；站点从"单格"改"多格形状"；新增势力范围刷子 |
| `server.mjs`（582 行） | 静态文件白名单、`/api/*-presets` GET/PUT/DELETE、`/api/*-publish` POST、`/api/*-assets` 列资源 | 🔴 **静态白名单是硬编码**（第 403~406 行逐字列了 `/territory.html`、`/territory-app.js`）；不登记 = 页面 404 且服务端零报错 |
| `territory_format.py`（319 行） | 校验骨架：`_cells` 格子列表解析、`_connected` 连通性、`_neighbors` 邻接、`_non_negative`、issue 列表 | 校验项换成大地图口径（§6），沿用 `issues/warnings` 双级 |
| `copy_territory_maps.py`（76 行） | 一份 payload 写三处（`assets/resources/config/territory-maps/` + `doc/.../json/sever` + `client`）、`.meta` 生成规则、`--dry-run` | 目标目录改 `bigmap-maps/`；多一步"与配置表对账" |
| `territory_format.py` 常量 | `ID_PATTERN`、`VERSION`、`SITE_TYPES` | 换成 `bigmapV1`、城池/野怪/据点/障碍 类型集 |
| `presets/territory/chapter_0N.json` | 预设文件组织方式（一图一文件、id 即文件名） | 一图一文件，id 如 `world_01` |
| `copy-territory-maps.bat` | 双击发布、参数透传 | 加 `copy-bigmap-maps.bat` |

**结论**：新增代码约 `bigmap-app.js`（估算 700~900 行，含复用拷贝）+ `bigmap.html`（~120 行）+ `formats/bigmap-format.js`（~200 行）+ `territory_format.py` 的孪生 `bigmap_format.py`（~250 行）+ `copy_bigmap_maps.py`（~90 行）。**不碰现有两套编辑器的逻辑**（复制而不要改公共函数，避免三套互相牵连）。

---

## 2. 职责边界

| 编辑器**管**（产出到布局 JSON） | 编辑器**不管**（运行时/配置表） |
| --- | --- |
| 世界尺寸、中心格、地形种子与手改异常格 | 城池归属、状态机、积分、快照 |
| 74 座城的落位、占格块、层级、等级 | 城池等级数值（战功倍率/占领积分/门槛）→ `BigMap-城池等级` |
| 每城势力范围格子列表（`rangeHex`） | 辐射容量/收益比例 → `BigMap-城池配置` 数值列 |
| 相邻关系（自动推导，可手改） | 玩家基地坐标、迁城、保护罩 |
| 野怪落点、等级环带、刷新点间距 | 野怪掉落、刷新秒数、战功 → `BigMap-野怪配置` |
| 活动据点/挂机资源田/地图 BOSS 位置 | 开放 cron → `BigMap-野怪配置.openCron` |
| 障碍/不可通行/禁放区 | 行动力消耗、行动力上限 |
| 出生区块划分与容量系数 | 出生算法参数（`spawnMinDistance` 等）→ `BigMap-基地出生` |
| 背景图层、POI 图标、评审截图 | 美术资源本身（只存路径字符串） |

一句话：**编辑器决定"东西在哪"，配置表决定"东西值多少"。**

---

## 3. 三个必须拍板的决策

### 3.1 坐标真源放哪（最重要）

现在 `BigMap-城池配置` 表里有 `hexPos` 字段（`I BigMapCityConfig` 没有这个字段，但文档 §十二 主表定义了它），而世界是种子生成的，`BigMapWorld` 按 `slot/slotCount` 算位置。

| 方案 | 做法 | 风险 |
| --- | --- | --- |
| A 布局 JSON 独立持有坐标（**推荐**） | 布局 JSON 存 `hexPos/hexIds/rangeHex/adjacent`；`BigMap-城池配置` **删掉/停用**这几列，只留数值 | 文档的字段表要改；策划会问"坐标去哪填了" |
| B 发布时回写配置表的坐标列 | `copy_bigmap_maps.py` 把布局坐标合并进 `assets/remoteRef/BigMap-城池配置.json` | 🔴 **eSon 导表会整表覆盖**，`copy_ref.bat` 一跑坐标就回退成表里的旧值 —— 这正是项目里踩过的「静默失效」类坑（`MEMORY` 303 条） |

**推荐 A**，理由：坐标属于"静态地图"，数值属于"配置表"，两者更新节奏和责任人不同；合在一张表里，无论哪边跑一次脚本都会覆盖另一边。A 的代价是文档字段表要划掉 `hexPos/rangeHex/adjacentCityIds` 三列，改注明"由地图编辑器产出"。

### 3.2 布局文件放哪

| 方案 | 路径 | 能否热更 | 适用 |
| --- | --- | --- | --- |
| **A 随包（推荐）** | `assets/resources/config/bigmap-maps/world_01.json` | 否（`hot_update.json` 的 `startupBundles` 只有 `remoteRef`） | 地图改版跟客户端版本走，避免老客户端读新地图但逻辑不兼容 |
| B 热更 | `assets/remoteRef/BigMap-世界布局.json` + 加进 `tools/ref/nocompressed.txt`（防止被 `ref_compress_json.py` 压成 `{k,v}`） | 是 | 想不发版调城池位置 |

**推荐 A**，与 `territory-maps/` 完全对齐。真要热更再迁 B —— 迁移只改 `BigMapConfigLoader` 里一个路径 + 加一行 `nocompressed.txt`，现在不用为它付复杂度。布局 JSON 里带 `layoutVersion`，客户端版本不匹配直接拒绝加载（不要"尽力解析"）。

### 3.3 世界生成怎么降级

```
优先级：布局文件 > 种子生成
- 有 world_01.json → buildBigMapWorldFromLayout(config, layout)
- 无布局文件     → 退回现在的 buildBigMapWorld(config, seed)   ← 保住 49 条测试与离线调试档
```

现有 `tests/bigmap-world.test.ts` 14 条断言种子生成结果，**一条都不用改**。新加 `tests/bigmap-layout.test.ts` 单独测布局驱动。

---

## 4. 布局数据格式（草案）

```jsonc
{
  "kind": "bigmapWorld",
  "version": 1,
  "layoutVersion": 1,          // 与客户端 BUILTIN_LAYOUT_VERSION 比对，不等就拒载
  "worldId": 1,
  "name": "大地图一",
  "rows": 100, "columns": 100,
  "centerHexId": 5050,

  // 地形：默认交给种子生成，只记"手改过"的格子（省体积，10000 格手摆不现实）
  "terrainSeed": 20261020,
  "terrainOverrides": [ { "hexId": 1234, "terrain": "water" } ],

  // 城池：坐标/占格/势力范围都在这
  "cities": [
    {
      "cityId": 101, "layer": 1, "cityLevel": 2,
      "anchorHexId": 8123,
      "hexIds": [8123, 8124, 8223, 8224],        // 占 4 格，编辑器按形状算出来
      "rangeHex": "b64:AAAA...",                 // 势力范围，bitset+base64（见下）
      "adjacentCityIds": [102, 104],             // 自动推导，可手改
      "label": "1-16"
    }
  ],

  "monsters": [ { "instanceId": 1, "monsterId": 501, "anchorHexId": 3001, "hexIds": [3001] } ],
  "points":   [ { "pointType": 2, "anchorHexId": 4100, "hexIds": [4100, 4101], "openCron": "TUE,THU 20:00" } ],
  "blocked":  [ 111, 112, 113 ],                 // 障碍/禁放
  "spawnZones": [ { "zoneId": 1, "cityId": 101, "cells": "b64:...", "capacity": 10 } ],

  "background": "image/bigmap/world_01",
  "artMeta": { "poiIcons": { "city_1": "img/city_lv1" } }
}
```

**为什么势力范围用 bitset+base64**：74 座城 × 每城 20~50 格，直接写坐标数组约 2200 个数字 ≈ 30KB；bitset（10000 bit = 1250 B/城，74 城 ≈ 92KB）反而更大 —— 所以**按城存"格 id 数组"更省**。折中：`rangeHex` 存 RLE 或 `hexId` 差量数组。项目里 `TerritoryCellBitSet` 适合"全图一张掩码"，这里适合"每城一张小集合" ⇒ **用 `[baseHexId, delta...]` 差量编码**，74 城合计约 6KB。方案里先写数组，压不压缩由 M2 实测数据再定（别过早优化）。

---

## 5. 编辑器要新增的能力（相对 territory 的差额）

| 能力 | territory 现状 | 大地图需求 | 做法 |
| --- | --- | --- | --- |
| 大尺寸渲染 | 20×20 SVG，全量 `<path>` | **100×100 = 10000 格** | 分块 16×16（49 块），只挂视口 ±1 块的 `<g>`；远景每块合成 1 个 `<path>`（只吃 hover 高亮，不吃点击）。判据：80% 缩放时 DOM 节点 < 3000 |
| 多格占地 | 单格站点 | 城池 4 格、野怪 1~8 格 | "形状工具"：点中心 → 按 `occupyHex` 自动算六边块（2/3/4/7 格预设），可框选手改；落位时实时检测重叠 |
| 势力范围刷 | 无 | 每城一张透明色区 | 两段式：①「生成半径 N 环」一键铺（默认覆盖 8~12 基地容量）② 手绘增删；两城范围重叠给 warning 而非 error（文档没禁止重叠） |
| 相邻推导 | 依赖线手填 `requiredCells` | `adjacentCityIds` 74 城手填不可能 | 按"势力范围邻接 / 中心距 ≤ 2 环"自动推导，画连线（复用 `.dependency` 样式），允许手改覆盖 |
| 环序校验 | 无 | 1 级在外、8 级王城在中心，74 座数量固定 20/15/20/11/4/3/1 | 按 `ring` 分组统计，配额不符直接阻断保存（warning 挡不住这种系统性问题） |
| 禁放冲突 | 站点重叠 | 城池本体/野怪/据点/资源田/障碍 互斥 | 落位时实时算，冲突格画红环（复用 `.error-ring`） |
| 出生区块 | 无 | 区块划分 + 容量 + 最小间距 2 格 | 圈区块 → 显示容量与"理论可放格数"；给「泊松盘预览」按钮，算出实际可行落点数并报出来（策划据此调容量，不用上线才发现放不下 1000 人） |
| 截图导出 | 无 | 评审要图 | 「导出 PNG」：复用 SVG 序列化 → canvas，输出 2× 图；顺带导出"城池清单 CSV"给策划对表 |
| 关卡链 | 有 `requiredCells` 依赖 | 1→8 级解锁顺序（`prevCityId` 链） | 直接复用依赖连线与 DAG 校验，改标签即可 |

---

## 6. 发布前校验清单

### 阻断（error，不修不能保存/发布）

| # | 校验项 | 规则 |
| --- | --- | --- |
| 1 | 尺寸 | `rows/columns == world 配置`，1 ≤ 1..100 |
| 2 | 城池落位 | `anchorHexId` 在范围内且不被 `blocked` 占用 |
| 3 | 占格块 | `hexIds.length == occupyHex`，且内部连通（`_connected` 复用） |
| 4 | 城池重叠 | 任意两城 `hexIds` 不相交 |
| 5 | 层级配额 | `cityLevel` 1~8 的数量 = 20/15/20/11/4/3/1（共 74），与 `BigMap-城池配置` 行数一致 |
| 6 | 环序 | 等级越高的城 `ring` 越小（王城必须在中心环） |
| 7 | 禁放冲突 | 野怪/据点/障碍不与城池 `hexIds` 相交 |
| 8 | 相邻闭环 | `adjacentCityIds` 双向一致（A 写了 B，B 必须写 A） |
| 9 | 解锁链 | `prevCityId` 无环、链头唯一、每级至少 1 座 |
| 10 | 出生区块 | 每区块 `cells` 内"可放格数 × spawnCapRatio" ≥ 该区容量，否则放不下 |
| 11 | 配置外键 | 布局里出现的 `cityId/monsterId` 必须在对应配置表里存在（**反向也要查**：配置表有但布局没有 ⇒ 该城永远不会出现在图上） |

### 警告（warning，可保存）

- 两城势力范围重叠 > 20%
- 某城 `rangeHex` 格数 < 该城 `radiateCapacity` × 2（范围太小装不下辐射）
- 野怪等级环带交叉
- 某区块到最近城池距离 > 6 环（孤岛）
- 城池周围 3 环内无障碍（防守地形缺失）

> 参考现状：`copy_territory_maps.py` 的口径就是"站点数量不对只 warning 不阻断"。大地图第 5 项我建议**升级为阻断**，因为 74 座是文档硬约束，不是风格问题。

---

## 7. 发布链路

```powershell
node tools/map-editor/server.mjs --open        # 编辑器：http://127.0.0.1:8787/bigmap.html
python tools/map-editor/copy_bigmap_maps.py --dry-run
python tools/map-editor/copy_bigmap_maps.py --id world_01
tools\map-editor\copy-bigmap-maps.bat --id world_01     # 策划双击用
```

发布写三处（同一份校验后 payload，字节相同）：

| 目标 | 用途 | `.meta` |
| --- | --- | --- |
| `assets/resources/config/bigmap-maps/world_01.json` | 客户端读 | **是** |
| `doc/塔防数据配置/json/client/world_01.json` | 策划客户端表 | 否 |
| `doc/塔防数据配置/json/sever/world_01.json` | 策划服务端表 | 否 |

（`sever` 是仓库既有拼写，别改成 `server` —— `copy_territory_maps.py` 注释里专门标了。）

**新增第 4 步：与配置表对账**（territory 没有，大地图必须有）：

```
布局里的 cityId 集合  ==  BigMap-城池配置.json 的 id 集合
布局里的 monsterId 集合 == BigMap-野怪配置.json 的 id 集合
数量不符 → 报错并列出差异 id（两个方向都列）
```

不加这步，会出现"表里加了新城池但图上没有"和"图上有城但表里没数值"两种静默问题。

---

## 8. 一致性对拍（防"编辑器摆 A、客户端显示 B"）

这条比编辑器本身更重要。**六边几何存在两套实现**：编辑器 `territory-app.js` 的 `DIR_EVEN/DIR_ODD` + `X=1.5R, Y=√3R`，客户端 `core/hex/HexGridLayout`。项目里已经踩过相位坑（`docs/bigmap-系统实现说明.md` §3.2：`r = row − (column + (column&1))/2`，写成 `−(column&1)` 就有一个邻居算成 2 环）。

**对策（M1 就做）**：

1. 布局 JSON 导出时附带 `debug.hexCenters`（每格 id → 像素坐标），只给测试用，客户端正面路径不读。
2. 新增 `tests/bigmap-layout.test.ts`：
   - 断言"相邻格距离恒为 1"（沿用 `bigmap-world.test.ts` 已有判据）
   - 断言 `HexGridLayout` 算出的像素 ↔ 编辑器导出的 `hexCenters` 误差 < 0.01
   - 断言 `layout → buildWorld → export → 再 build` 幂等（逐格 deepEqual）
3. 断言的**方向要固定**：以客户端 `HexGridLayout` 为准，编辑器去对齐它 —— 反过来会把"编辑器能跑、真机偏一格"的风险留在线上。

---

## 9. 分期

| 期 | 内容 | 判据 | 依赖 |
| --- | --- | --- | --- |
| **M1 只读闭环**（先做，2~3 天） | 定格式；`buildBigMapWorldFromLayout()`；种子世界→导出布局 JSON；布局→重建世界；对拍测试 | `tests/bigmap-layout.test.ts` 全绿；**现有 49 条测试一条不改** | 无（纯客户端 0 服务端依赖） |
| **M2 可编辑** | `bigmap.html`+`bigmap-app.js`：城池落位/多格形状/势力范围刷/野怪/相邻推导/分块渲染/校验 | 手工摆完 74 座城，保存→发布→游戏内位置一致 | M1 |
| **M3 策略层** | 出生区块+容量模拟+泊松盘预览、障碍、背景、截图导出、CSV 清单 | 策划独立完成一张图不改代码 | M2 |
| **M4 打通** | `copy_bigmap_maps.py` 三产物 + 对账 + `.bat`；服务端读同一份布局 | 服务端与客户端读同一份 JSON，坐标逐格一致 | M2 |

**M1 是最该先做的**：它把"架构切换"压缩成一个可验证的小步，做完之后哪怕编辑器界面还没影，世界也已经可数据驱动了。之后美术/策划要改地图，只差一个 UI。

---

## 10. 风险与坑

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| 🔴 页面 404 零报错 | `server.mjs` 第 403~406 行**硬编码**静态白名单，新增页面不登记就 404，服务端不报错 | 加页面时同改白名单；顺手把白名单改成"目录扫描 + 后缀白名单"，一次修掉这个坑 |
| 🔴 与 eSon 导表抢列 | 坐标若留在 `BigMap-城池配置`，导表直接覆盖编辑器成果 | 按 §3.1 选 A，坐标不进配置表 |
| SVG 10000 格 | 全量 `<path>` 浏览器会卡死（territory 只有 400 格） | §5 分块 + 远景合成；M2 首个任务就是量 DOM 节点数与交互帧率 |
| 两份校验实现漂移 | `territory_format.py`（发布）+ `formats/territory-format.js`（编辑器）是两套逻辑，规则改一处漏一处 | 大地图**规则只写 js 一份**，py 侧 `subprocess` 调 `node formats/bigmap-format.js` 复用；或 py 只做"文件存在 + 版本号"浅校验 |
| 策划不熟 SVN | 布局产物要进两个仓（工程 + doc） | 一条 `.bat` 双击；`--dry-run` 先看变更清单 |
| 城池数量落差 | 文档 74 座 vs 现配 25 条（12 个人层 + 13 灰城） | M2 前先让策划确认等级配比（§6 第 5 项会直接卡住）；表行数补齐是**配置工作**，不是编辑器工作 |
| 布局改动引发存档指错 | 存档里存的是 `hexId`，地图一改，旧档基地会落在新地形上 | 布局带 `layoutVersion`，变化时走"存档迁移或清空基地坐标"逻辑（P0 联机版由服务器兜底，单机档可清） |

---

## 11. 本周可落的三件事（不依赖任何确认）

1. **M1 的格式与函数**：`docs/bigmap-布局格式.md`（字段表 + 示例）+ `buildBigMapWorldFromLayout()` + `tests/bigmap-layout.test.ts`。判据：种子世界 → 导出 → 重建，逐格 deepEqual，且 49 条旧测试零改动。
2. **修掉白名单坑**：`server.mjs` 静态文件白名单改目录扫描，避免以后每加页面都要手改且失败静默。
3. **向策划要两样东西**：① 城池等级配额确认（20/15/20/11/4/3/1）；② 第一张图的草图（哪片是出生区、哪片是王城），M2 直接照图摆。

> M2 的编辑器界面工作量大头在"多格形状 + 势力范围刷 + 分块渲染"这三件，其余都是 territory 现成交互搬过来改名。要动手我按 M1 → M2 顺序做，M1 随时可以开始。
