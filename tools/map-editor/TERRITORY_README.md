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
