# 大地图布局字段字典

对象是 `tools/map-editor/presets/bigmap/<id>.json`（工作稿）和它发布后的
`assets/resources/config/bigmap-maps/world_<NN>.json`（客户端读取的那份）。
**同一个结构、同一套字段**，只是落在两个目录。

> 操作怎么用看 [`BIGMAP_README.md`](./BIGMAP_README.md)；架构分层看 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。
> 本文只讲**每个字段是什么、谁在消费、写错会怎样**。

## 0. 权威链（改字段前先认这份顺序）

| 角色 | 实现 | 职责 |
| --- | --- | --- |
| **唯一权威** | `assets/script/app/bigmap/model/BigMapLayout.ts` 的 `parseBigMapLayout` | 字段白名单、范围、互斥、外键；运行时和发布都走它 |
| 编辑器镜像 | `tools/map-editor/formats/bigmap-format.js` 的 `normalizeBigmapLayout` | 浏览器里即时校验（输一格就报），靠 `tests/bigmap-format.test.ts` 与权威对拍 |
| 校验 CLI | `tools/map-editor/validate_bigmap_layout.ts` | 调权威实现 + 与配置表对账，`copy_bigmap_maps.py` 用它 |
| 消费方 | `buildBigMapWorldFromLayout` → `IBigMapWorld` | 只挑它认识的字段进世界 |

两条硬规矩：

1. **未知字段一律丢弃**，两侧都只会把已知字段写回盘。手加的自定义字段活不过一次保存。
2. 编辑器镜像与权威**有任何口径差**，症状是「编辑器保存成功、进游戏一片空白」。改任一侧都要跑
   `npx tsx --test tests/bigmap-format.test.ts`。

## 1. 文件命名

| 位置 | 命名 | 谁决定 |
| --- | --- | --- |
| 工作稿 | `presets/bigmap/<id>.json` | 编辑器里 `mapId`（保存时写文件名） |
| 发布产物 | `assets/resources/config/bigmap-maps/<id>.json` | `copy_bigmap_maps.py` 用 `path.stem`，**不改名** |
| 运行时读取 | `config/bigmap-maps/world_<worldId 补两位>` | `BigMapLayoutLoader.bigMapLayoutPath(config.world.worldId)` |

⇒ **文件名必须是 `world_<worldId 两位>`**（如 `world_01`）。改名成 `dadi_tuchugao.json` 也能存、能发布，
但运行时按 `world_01` 找，找不到就静默回退种子生成。`_` 开头的文件发布时跳过。

## 2. 坐标口径（所有 `hexId` 的共同前提）

```
hexId = row * columns + column     // 全工程统一，不是 row 优先
row   = floor(hexId / columns)
column= hexId % columns
```

- 合法范围 `0 .. rows*columns-1`，越界直接判错。
- 布局中心：`row = floor((rows-1)/2)`、`column = floor((columns-1)/2)` ⇒ 100×100 时是 **4949**。
- `ring`（环号）= 该格到中心的六边距离。解锁、分布、地形权重都按它算。
- 六邻：**奇数列偏移、偶列下移半格**。与客户端 `hexGridNeighborIds` 逐格一致，
  **不要抄 `territory-format.js` 那套**（那是另一份 offset 约定）。
- 编辑器画布是 36×42 的逻辑网格，客户端渲染是 92.25×90 —— **两个轴放大倍数不同**
  （x ×2.5625、y ×2.142857），别按一个等比数换算。

## 3. 顶层字段

| 字段 | 类型 | 缺省 / 必须 | 含义 | 运行时 |
| --- | --- | --- | --- | --- |
| `kind` | string | 必须 = `"bigmapWorld"` | 结构标识，认错就整份拒绝 | ✅ 校验 |
| `version` | int | 必须 = `1` | **结构**版本，只认全等；加可选字段不用改 | ✅ 校验 |
| `layoutVersion` | int | 缺省 1，≥1 | **内容**版本，人工递增（改了几稿） | ⚠️ 只透传，不校验内容 |
| `worldId` | int | 必须 | 世界 id，决定加载文件名 `world_<NN>` | ✅ |
| `worldName` | string | 必须（缺省 `""`） | 显示名 | ✅ 进 `IBigMapWorld` |
| `rows` / `columns` | int | 必须 | 网格行列 | ✅ 必须等于 `bigmapWorld.rows/cols` |
| `terrainSeed` | int | 必须 | 地形种子。改它 = 整张地貌重掷 | ✅ |
| `terrainOverrides` | array | 缺省 `[]` | 手改地形，见 §4.1 | ✅ |
| `cities` | array | 缺省 `[]` | 城池落位，见 §4.2 | ✅ |
| `monsters` | array | 缺省 `[]` | 野怪落位，见 §4.3 | ✅ |
| `bases` | array | 缺省 `[]` | 基地（离线调试档用），见 §4.4 | ✅ |
| `blocked` | int[] | 缺省 `[]` | 障碍 / 禁放格 | ❌ 只校验，不进世界 |
| `spawnZones` | array | 缺省 `[]` | 出生区块，见 §4.5 | ❌ 只校验 |
| `points` | array | 缺省 `[]` | 活动据点，见 §4.6 | ❌ 只校验 |
| `background` | string | 缺省 `""` | 背景图资源名（相对 `resources`、不带扩展名） | ❌ 只校验（游戏背景另有来源） |

`rows`/`columns` 的上下限**两侧不同**：编辑器限 1~200；权威实现只要求 > 0。取小值（≤200）用。

## 4. 子结构

### 4.1 `terrainOverrides[]`

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `hexId` | int | 必须 | 被手改的格，**同一格只能出现一次** |
| `terrain` | string | 必须 | 见 §5 地形枚举 |

地形默认**由种子生成**（`bigMapRandom(seed, hexId, 7)`）：`ring ≤ 2` 全 `plain`；`ring ≤ 6` 无 `water`；
再往外按 0.5/0.72/0.9 分档。这里只存**偏离种子**的格子，所以「刷回原值」编辑器会自动删条目、不占体积。

### 4.2 `cities[]`

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `cityId` | int | 必须 | 必须存在于 `bigmapCity`，**不可重** |
| `anchorHexId` | int | 必须 | 锚点，**必须在该城的 `hexIds` 里** |
| `hexIds` | int[] | 必须非空 | 占格块。BFS 从锚点扩，`hexIds[0]` 就是锚点 |
| `ring` | int | **必须**（编辑器缺省 0） | 落位时选的环号。**不能由几何反推** —— 种子生成有「目标环占满就退一环」，反推会让往返对拍假红 |
| `rangeHex` | int[] | 缺省 `[]` | 势力范围标注（P1 联盟层才进规则） |
| `adjacentCityIds` | int[] | 缺省 `[]` | 相邻城 id，去重 + 升序写回 |
| `label` | string | 缺省 `String(cityId)` | 图上编号，如 `8-1` |

占格数：`layer === 4`（王座）⇒ 6 格，其余 ⇒ 4 格。空间不够时编辑器直接拒绝落位，不会硬塞。

### 4.3 `monsters[]`

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `instanceId` | int ≥1 | 必须 | **实例**号（同一种怪可以有多只），不可重 |
| `monsterId` | int ≥1 | 必须 | 必须存在于 `bigmapMonster` |
| `level` | int ≥1 | 必须 | 落地等级；编辑器取配置里的 `monsterLevel` |
| `anchorHexId` | int | 必须 | 必须在该怪的 `hexIds` 里 |
| `hexIds` | int[] | 必须非空 | 占格数取配置里的 `occupyHex` |

### 4.4 `bases[]`

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `baseId` | string | 必须非空、不可重 | `player` / `npc-01`… |
| `name` | string | **必须**（编辑器缺省 = `baseId`） | 显示名 |
| `isPlayer` | bool | 缺省 `false` | 玩家基地**全图最多 1 个**；一个都没有时运行时兜一个在地图中心 |
| `hexId` | int | 必须 | 基地只占 1 格，基地之间不可重叠 |
| `ring` | int | **必须**（编辑器缺省 0） | 环号 |
| `power` | int | 缺省 0 | 战力；编辑器新建 NPC 给 `600 + 序号×180` |

空数组 = 该图不预置基地。联机版真实基地坐标由服务器下发，这里只给离线调试档用。

### 4.5 `spawnZones[]`

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `zoneId` | int ≥1 | 必须 | 不可重 |
| `cityId` | int | 缺省 0 | 归属城；0 = 未绑定（只作图） |
| `cells` | int[] | 必须非空 | 区块格集合。区内不能有城/怪/基地/据点/障碍 |
| `capacity` | int | 缺省 0 | 计划放几个基地。`> floor(cells/4)` 出 **warning**（不阻断） |

`capacity` 的参照不是拍脑袋：按最小间距 2 撒点是六边格独立集，上界 = 格数/3，编辑器按 /4 粗估。
「算能放几个」按钮给的是真实撒点结果（离散泊松贪心，确定性），只画黄点、**不进布局文件**。

### 4.6 `points[]`

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `pointId` | int ≥1 | 必须 | 不可重 |
| `pointType` | int 1~3 | 必须 | 见 §5 据点类型 |
| `hexIds` | int[] | 必须非空 | 据点占的格（编辑器落 1 格） |
| `openCron` | string | 缺省 `""` | 开放时间表达式，运行期排期用 |

## 5. 枚举

| 枚举 | 取值 | 备注 |
| --- | --- | --- |
| 地形 `terrain` | `plain` 平地 / `forest` 林地 / `rock` 岩石 / `water` 水域 | 就这 4 个，写第 5 个直接判错 |
| 据点 `pointType` | `1` 城池（一般不用，城池走 `cities`）/ `2` 挂机资源田 / `3` 地图 BOSS | 编辑器下拉只列 2、3 |
| 城池层 `layer`（配置表） | `1` 个人层 / `2` 军团层 / `3` 战盟层 / `4` 王座 | 只用于决定占格数，不进布局 |

## 6. 校验规则

### 6.1 硬错（`issues` 非空 ⇒ 保存/发布都过不去）

- `kind` / `version` 不对；`rows` / `columns` 非正整数
- 任何 `hexId` 越界 `[0, rows*columns-1]`
- `hexIds` 为空（城池/野怪/据点）；城池或野怪的锚点不在自己的 `hexIds` 里
- 主键重复：`cityId` / `instanceId` / `baseId` / `zoneId` / `pointId`
- **占位互斥**：同一格被两个占位物压住 —— 障碍、城池、野怪、基地、据点**五类之间全部互斥**
- 基地与其它基地同格；`isPlayer` 的基地超过 1 个；`baseId` 空串

### 6.2 警告（`warnings`，不阻断）

- 相邻关系单向：`A → B` 有、`B → A` 没有
- `adjacentCityIds` 指向本图不存在的城
- 出生区块 `capacity > floor(cells/4)`
- 配置里有城但图上没放（只有 `validate_bigmap_layout.ts` 给这条）

### 6.3 三处口径差（改一侧要同步另一侧）

| 差异点 | 权威（TS） | 编辑器镜像（JS） |
| --- | --- | --- |
| `terrainOverrides` 同格重复 | **判错** | **不检查**（静默保留两条） |
| `blocked` / `rangeHex` 里的重复格 | 静默去重 | 判「内有重复格子」 |
| `cities[].ring` / `bases[].ring` 缺字段 | **判错**（必填） | 缺省 0 |
| `rows` / `columns` 上限 | 无上限 | 1~200 |

手改 JSON 时按**权威**那一列写（它更严），别指望编辑器放行就等于游戏能加载。

## 7. 编辑器读哪些配置表列

`/api/bigmap-config` 直读 `assets/remoteRef/`（`{c:1, k, v}` 压缩表），**只读不改**：

| 表 | 用到的列 | 用在哪 |
| --- | --- | --- |
| `bigmapWorld` | `worldId` `worldName` `rows` `cols` | 新建空白图的尺寸、尺寸一致性提示 |
| `bigmapCity` | `cityId` `cityName` `layer` `cityLevel` `available` | 城池下拉、占格数（`layer`）、信息面板 |
| `bigmapMonster` | `monsterId` `monsterName` `monsterLevel` `occupyHex` | 野怪下拉、占格数、落地等级 |

分工不变：**编辑器决定「东西在哪」，配置表决定「东西值多少」**。
坐标不要往 `bigmapCity.hexPos` 填 —— 跑一次 eSon 导表会把编辑器成果静默覆盖回去。

## 8. 运行时到底消费哪些字段

`buildBigMapWorldFromLayout` 只把这几项塞进 `IBigMapWorld`：

```
worldId worldName rows columns terrainSeed          → 世界头
terrainOverrides                                     → 逐格 terrain
cities: cityId anchorHexId hexIds ring               → IBigMapCitySite
monsters: instanceId monsterId level anchorHexId hexIds
bases:   baseId name isPlayer hexId ring power
```

**不进世界**（`parseBigMapLayout` 会校验并保留，但 `IBigMapWorld` 不承载）：
`layoutVersion` `rangeHex` `adjacentCityIds` `label` `blocked` `spawnZones` `points` `background`。

其中最容易被误会的是 `rangeHex`：**势力范围当前只是布局标注**，游戏里的范围判定走
`radiateCapacity` 距离（`bigMapWithinCityRange`）。刷了范围不等于游戏里生效 —— P1 联盟层做
「范围染色 + 进出增益」时才接进规则。

导出的另一个坑：「世界 → 布局」是**有损**的。`exportBigMapLayout` 必须带上 `base`（原布局）
才能把 `rangeHex`/`adjacentCityIds`/`label`/`blocked`/`spawnZones`/`points`/`background` 抄回来，
不带底稿时这些会整片回退成空 —— 策划刷半天的范围被一次导出抹掉。

## 9. 已发布状态与当前数据问题（2026-10-21 实测）

| 事实 | 证据 |
| --- | --- |
| 布局发布对账**实际处于降级状态** | `npx tsx tools/map-editor/validate_bigmap_layout.ts ...` 输出 `warnings`：`读不到 BigMap-城池配置，跳过城池对账` / `读不到 BigMap-野怪配置，跳过野怪对账` |
| 原因是表名还是中文旧名 | `server.mjs`、`validate_bigmap_layout.ts` 写的是 `BigMap-城池配置` / `BigMap-野怪配置` / `BigMap-世界地图配置`，而 `assets/remoteRef/` 里实际是 `bigmapCity.json` / `bigmapMonster.json` / `bigmapWorld.json`（2026-10-20 表名统一改英文 camelCase） |
| 连带：编辑器城池/野怪下拉为空 | `/api/bigmap-config` 的 `world` / `cities` / `monsters` 全走 `readRefRows`，同样读不到 ⇒ 返回 `null` / `[]` |
| `dadi_tuchugao.json` 的城 id 与现表**零交集** | 布局 `2001~2081`（81 座），`bigmapCity` 是 `101~401`（25 座），命中 0；野怪 `8001~8020` 完全对得上 |
| `dadi_tuchugao.json` 尺寸与配置表不一致 | 布局 `100×100`，`bigmapWorld` 是 `40×40` ⇒ `isBigMapLayoutCompatible` 判假，运行时回退种子生成（不白屏，但策划摆位全丢） |

前三条是同一个根因；第四条修好对账后会让发布直接失败（这是**正确**行为，得先把城 id 对齐）。

## 10. 最小样例

```json
{
  "kind": "bigmapWorld",
  "version": 1,
  "layoutVersion": 1,
  "worldId": 1,
  "worldName": "大地图初稿",
  "rows": 40,
  "columns": 40,
  "terrainSeed": 20261020,
  "terrainOverrides": [{ "hexId": 780, "terrain": "water" }],
  "cities": [{
    "cityId": 101,
    "anchorHexId": 780,
    "hexIds": [780, 779, 781, 740],
    "ring": 0,
    "rangeHex": [741, 742],
    "adjacentCityIds": [102],
    "label": "1-1"
  }],
  "monsters": [{
    "instanceId": 1,
    "monsterId": 8001,
    "level": 1,
    "anchorHexId": 900,
    "hexIds": [900]
  }],
  "bases": [],
  "blocked": [901],
  "spawnZones": [{
    "zoneId": 1,
    "cityId": 101,
    "cells": [820, 821, 822, 860],
    "capacity": 1
  }],
  "points": [{
    "pointId": 1,
    "pointType": 2,
    "hexIds": [1000],
    "openCron": ""
  }],
  "background": ""
}
```

> 上面是**结构示例**，格子与 id 只为了展示字段，别照抄落图。
