# 大地图布局文件格式（bigmapWorld v1）

> 代码：`assets/script/app/bigmap/model/BigMapLayout.ts`
> 测试：`tests/bigmap-layout.test.ts`（8 条）
> 生成器：`tools/map-editor/gen_bigmap_preset.ts`
> 编辑器预设目录：`tools/map-editor/presets/bigmap/`

---

## 1. 为什么需要这个文件

原来世界是 `buildBigMapWorld(config, seed)` **种子生成**的：城池按 `slot/slotCount` 落在固定环上，野怪按等级算环带，策划一格都改不了。文档要求 74 座城同心圆分布、每城一张势力范围、出生区块控容量 —— 这些必须可编辑。

所以世界改成两条入口：

```
有布局 → buildBigMapWorldFromLayout(config, layout)
无布局 → buildBigMapWorld(config, seed)        // 离线调试档 / 单测夹具 / 老存档
```

**种子路径不是废弃代码**，它是兜底：布局文件缺失、版本不匹配、尺寸对不上时都退回它。`tests/bigmap-world.test.ts` 那 14 条断言继续护着它。

---

## 2. 三条硬约束

| # | 约束 | 理由 |
| --- | --- | --- |
| 1 | **城池坐标只写在布局里**，不写进 `BigMap-城池配置.hexPos` | 两边都写，跑一次 eSon 导表就把编辑器成果静默覆盖回去（`MEMORY` 303 条同类坑） |
| 2 | 布局只装**静态**数据 | 归属、积分、榜、快照、基地坐标、刷新 CD 都是运行态，进文件就是双真源 |
| 3 | 地形用 `terrainSeed` 生成 + `terrainOverrides` 手改 | 100×100 手摆 10000 格不现实；只存手改过的格子 |

---

## 3. 字段表

### 3.1 顶层

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | string | ✅ | 固定 `"bigmapWorld"`。写错直接拒载（防把领地地图当布局读） |
| `version` | int | ✅ | 结构版本，当前 `1`。语义变化才 +1，加可选字段不用改 |
| `layoutVersion` | int | ✅ | **内容版本**，客户端 `BUILTIN_LAYOUT_VERSION` 不等就拒载。改地图要 +1 |
| `worldId` | int | ✅ | 世界 id，与 `BigMap-世界地图配置.worldId` 对应 |
| `worldName` | string | ✅ | 显示名 |
| `rows` / `columns` | int | ✅ | 必须与 `BigMap-世界地图配置` 一致，否则 `isBigMapLayoutCompatible` 返回 false（走种子兜底） |
| `terrainSeed` | int | ✅ | 地形种子。`terrainSeed + hexId` 哈希决定地形，保证同布局同结果 |
| `terrainOverrides` | array | ✅（可空） | 手改地形，见 3.2 |
| `cities` | array | ✅（可空） | 城池落位，见 3.3 |
| `monsters` | array | ✅（可空） | 野怪落位，见 3.4 |
| `bases` | array | ✅（可空） | 基地落位，见 3.5。空数组 = 该图不预置基地（联机版服务器下发） |
| `blocked` | int[] | ✅（可空） | 障碍 / 禁放格：不能摆城、怪、基地、据点 |
| `spawnZones` | array | ✅（可空） | 出生区块，见 3.6 |
| `points` | array | ✅（可空） | 活动据点 / 挂机资源田 / 地图 BOSS，见 3.7 |
| `background` | string | ✅（可空） | 背景图资源名（相对 `assets/resources`、不带扩展名，如 `image/bigmap/world_01`）。空串 = 无背景 |

### 3.2 `terrainOverrides[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hexId` | int | 格 id = `row * columns + column` |
| `terrain` | string | `plain` / `forest` / `rock` / `water` |

同一格重复出现 → 拒载。

### 3.3 `cities[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `cityId` | int | 外键 → `BigMap-城池配置.id`，必须是配置表里存在的 |
| `anchorHexId` | int | 主格（点击选中的那一格），必须在自己的 `hexIds` 里 |
| `hexIds` | int[] | 占格块，长度 ≈ `occupyHex`（普通城 4、王座 6） |
| `ring` | int | 落位时选的环号。**不能由几何反推** —— 种子生成有「目标环被占满就退一环」的兜底，两者会不等 |
| `rangeHex` | int[] | 势力范围格子（编辑器「铺范围 / 刷格」产出）。⚠️ `IBigMapWorld` **不承载**：游戏里的范围判定仍走 `radiateCapacity` 距离，P1 联盟层才接进规则 |
| `adjacentCityIds` | int[] | 相邻城池（编辑器按范围邻接自动推导，可手改）。缺省空数组，去重 + 升序 |
| `label` | string | 地图上显示的编号（如 `1-16`）。缺省 = `String(cityId)` |

### 3.4 `monsters[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `instanceId` | int | 实例 id（同一配置可刷多只），全局唯一 |
| `monsterId` | int | 外键 → `BigMap-野怪配置.monsterId` |
| `level` | int | 冗余自配置，重建世界时直接用（省一次查表） |
| `anchorHexId` | int | 主格 |
| `hexIds` | int[] | 占格块（1~8 格） |

### 3.5 `bases[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `baseId` | string | `player` 或 `npc-01`…，全局唯一 |
| `name` | string | 显示名 |
| `isPlayer` | bool | 全场最多 1 个为 true |
| `hexId` | int | 基地占 1 格 |
| `ring` | int | 落位环号 |
| `power` | int | 展示用战力，玩家基地填 0 |

### 3.6 `spawnZones[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `zoneId` | int | ≥1，唯一 |
| `cityId` | int | 归属城池；0 = 未绑定（仅作图） |
| `cells` | int[] | 非空；区块包含的格子 |
| `capacity` | int | 计划容量。cells / 4 是「按最小间距 2 格」的粗略上限，超了给 warning |

### 3.7 `points[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `pointId` | int | ≥1，唯一 |
| `pointType` | int | 1 = 城池（一般不用，城池走 `cities`）｜2 = 挂机资源田｜3 = 地图 BOSS |
| `hexIds` | int[] | 非空占格 |
| `openCron` | string | 开放时间表达式，空串 = 常驻 |

---

## 4. 示例（截取）

```json
{
  "kind": "bigmapWorld",
  "version": 1,
  "layoutVersion": 1,
  "worldId": 1,
  "worldName": "大地图一",
  "rows": 40,
  "columns": 40,
  "terrainSeed": 20261017,
  "terrainOverrides": [],
  "cities": [
    { "cityId": 101, "anchorHexId": 1122, "hexIds": [1122, 1082, 1162, 1121], "ring": 18 }
  ],
  "monsters": [
    { "instanceId": 1, "monsterId": 501, "level": 1, "anchorHexId": 1050, "hexIds": [1050] }
  ],
  "bases": [
    { "baseId": "player", "name": "我的基地", "isPlayer": true, "hexId": 1002, "ring": 12, "power": 0 }
  ]
}
```

完整样例：`tools/map-editor/presets/bigmap/world_01.json`（9.8 KB / 40×40 / 25 城 / 20 怪 / 17 基地）。

---

## 5. 校验规则（`parseBigMapLayout` 会抛什么）

一次判完，**不留给界面**。`buildBigMapWorldFromLayout` 只补一条外键校验（因为只有它拿得到 config）。

| 判据 | 报错关键字 |
| --- | --- |
| `kind` 不是 `bigmapWorld` | `kind 必须是` |
| `version` 不支持 | `version=… 不受支持` |
| `rows/columns` 非正整数 | `必须为正` |
| 任意 hexId 越界 | `越界（合法范围 0..N）` |
| `hexIds` 空 / 有重复 | `必须是非空数组` / `内有重复格子` |
| 锚点不在自己的 `hexIds` 里 | `锚点 … 不在自己的 hexIds 里` |
| `cityId` / `instanceId` / `baseId` 重复 | `重复` |
| 三类占位压同一格 | `被 … 同时占用` |
| 地形取值非法 | `不是合法地形` |
| 玩家基地 > 1 | `玩家基地最多 1 个` |
| 布局里的城/怪不在配置表 | `不在 BigMap-城池配置 中`（build 阶段） |
| 尺寸与配置表不一致 | `尺寸不一致`（build 阶段） |

---

## 6. 坐标口径（M2 编辑器必须对齐这条）

编辑器用**逻辑网格** 36×42，客户端渲染用 **92.25×90**（底图 130×119 是压扁画布）。两者**不是等比缩放**：

```ts
BIGMAP_EDITOR_TO_VIEW_SCALE = {
    x: HEX_GRID_VIEW_COLUMN_SPACING / HEX_GRID_LOGICAL_COLUMN_STEP, // 2.5625
    y: HEX_GRID_VIEW_ROW_SPACING / HEX_GRID_LOGICAL_ROW_STEP,       // 2.142857…
}
```

**这就是「编辑器里摆 A、游戏里显示 B」最常见的成因**：按单轴等比放大会越往右下偏得越多。`tests/bigmap-layout.test.ts` 最后一条断言的就是这个比值 —— 哪天有人把它"统一"成一个比例，测试立刻红。

对拍方向固定：**编辑器对齐客户端**（以 `core/hex/HexGridLayout` 为准），不要反过来。

另一条已踩过的坑：奇数列偏移 → axial 的 `r = row − (column + (column & 1)) / 2`，写成减号会让每个格子的 6 个邻居里有一个算成 2 环。

---

## 7. 命令

```bash
# 用当前配置 + 种子导出一份布局到编辑器预设目录（写盘后会自己读回来重建一遍做自证）
npx tsx tools/map-editor/gen_bigmap_preset.ts world_01
npx tsx tools/map-editor/gen_bigmap_preset.ts world_01 12345   # 换种子
```

产物落 `tools/map-editor/presets/bigmap/`，**不进 assets** —— 运行时读的是发布后的 `assets/resources/config/bigmap-maps/`，由 M4 的 copy 脚本搬运（与 `presets/territory/` → `assets/resources/config/territory-maps/` 同一条链路）。

---

## 8. 落地状态

| 期 | 状态 | 交付 |
| --- | --- | --- |
| **M1 布局驱动闭环** | ✅ | 格式 + `parseBigMapLayout` + `exportBigMapLayout` + `buildBigMapWorldFromLayout` + 往返对拍（`tests/bigmap-layout.test.ts` 10 条）+ 预设生成器 |
| **M2 编辑器** | ✅ | `bigmap.html` / `bigmap-app.js`、`formats/bigmap-format.js`（编辑器 + server 共用校验）、`server.mjs` 的 `/api/bigmap-*`、发布对账、`copy_bigmap_maps.py`；`tests/bigmap-format.test.ts` 7 条对拍（js ↔ ts、六边邻居 1600 格逐格） |
| **M3 策略层** | ✅ | 出生区块工具 + 泊松容量模拟（`poissonSpawnPoints`，六边三着色贴住 n/3 上界）、背景图、截图 PNG（2×）、城池清单 CSV |
| **M4 运行时接入** | ✅ | `application/BigMapLayoutLoader.ts`（`AssetService` 读 `config/bigmap-maps/world_<id>`）+ `model/BigMapLayout.resolveBigMapLayout`（纯函数降级判据）+ `BigMapPresenter` 的 `layout` 依赖 + `ProcedureBootstrap` 注入；`tools/map-editor/verify_bigmap_world.ts` 校验「布局 vs 种子」差异 |

M3 唯一没做的是 **POI 图标**（城池/野怪/据点仍用几何形状）—— 美术资源还没定，
定了之后只是把 `renderEntities` 里的 `<rect>/<circle>` 换成 `<image>`，布局格式不用改。

M2 新增的 `rangeHex` / `adjacentCityIds` / `label` / `blocked` / `spawnZones` / `points` **已在 schema 里**，
`version` 没变（都是可选字段，缺省给空值，老布局照样能加载）。

⚠️ 这几项里只有 `blocked` / `spawnZones` 会参与运行时（P2 基地落点校验），
`rangeHex` / `adjacentCityIds` 现在纯属布局标注 —— **P1 之前别在客户端读它们做判定**，
否则会出现「编辑器刷了范围、游戏里没生效」和「游戏里按距离算、编辑器看着不对」两套真源。

### 运行时怎么加载（已实现）

```
BigMapEntry.open()
  → loadBigMapConfig(configs)                     12 张表
  → loadBigMapLayout(assets, config)              读 config/bigmap-maps/world_<worldId 两位>
      ├─ assets.has 为 false      → null（没交图）
      ├─ parse / 尺寸校验失败     → null + 日志
      └─ 正常                     → IBigMapLayout
  → new BigMapPresenter({ config, layout, ... })
      └─ createBigMapWorldInstance：layout 优先，构建失败/为 null 回退 buildBigMapWorld(seed)
```

三条硬规矩：

1. **任何失败都不抛** —— 最多退回种子世界。策划图配错不该让大世界打不开。
2. **路径约定不走配置表**：`world_<worldId>` 与编辑器预设同名。加一列 `layoutFile` 就多一处
   「导表漏填 → 整图静默变默认」的失效点。
3. **`worldId` 一变，文件名就变**（`world_01` → `world_02`），天然不会读到上一张图。

`ProcedureBootstrap` 里 `BigMapEntry.shared().setAssetService(assets)` 是唯一注入点；
没注入也能玩（降级种子），所以 `MainTabHost → BigMapEntryButton` 那条链一行没动。

### 发布后自检

```bash
npx tsx tools/map-editor/verify_bigmap_world.ts world_01
```

打印「已发布布局 vs 同种子生成」的差异清单。第一份 `world_01` 是从种子导出的，
所以正常输出是**完全一致**；策划改过图之后，这里就是「到底动了哪几座城」的清单。
