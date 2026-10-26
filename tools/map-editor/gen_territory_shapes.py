"""按「图形」批量生成章节领地地图：`chapter_03` ~ `chapter_07`（2026-10-23）。

需求（用户原话）：
  1. 地图 id 从 **chapter_03** 起，参考 `chapter_01` / `chapter_02` 的**关卡顺序**设计；
  2. 每种类型（固定资源 / 随机候选 / 异步据点）的**笔刷数量**保持一致；
  3. chapter_03 图形是**飞机**，chapter_04 是**十字符号**；
  4. **单个章节内所有格子必须相连**（不能有孤立格）；
  5. 从 03 起做 **5 个**不同章节地图，命名按顺序递增；json 先存本地。

## 关卡顺序（照 ch02 的口径，不是 ch01）

ch01 是「一格一个关卡、36 关」的老结构；ch02（笑脸章）才是现在的口径，本次全部照 ch02：

| 项 | 口径 |
| --- | --- |
| 链长 | **10 个链点**：8 个 `stage` + 2 个 `boss`（第 5、10 个是 BOSS） |
| 战斗 id | `10011 … 10020`，按链序递增；BOSS = `10015` / `10020` |
| 解锁 | 第 i 关需要「上一关的 `cellId`」+「两关之间那道门的 `cellId`」；第 1 关只需要出生点 |
| 门 | 相邻两关之间**恒定隔 1 格**，那一格是 `fixedResource`（大门），它自己也挂在上一关上 |
| 距离 | 相邻两关地块之间 2~3 格（实测 ch02 全是 2）；中心间距 ≤ 6.6 |
| 异步据点 | 战斗 id `20005 … 20007`，各占 4 格，挂在最近的链点下 |

## 笔刷数量（5 张图**逐项相同**，改就一起改）

| 笔刷 | 数量 | 说明 |
| --- | --- | --- |
| `fixedResource` | **51** | 含 9 道门（10 个链点 ⇒ 9 个间隙）；每格一个 site |
| `randomSites.candidateCells` | **52** | 随机候选格，单格一个候选 |
| `asyncPvp` | **3** | 每个 4 格 |
| `stage` | **8** | 合计 44 格，逐点 3~8（`distribute_sizes` 按地盘摊） |
| `boss` | **2** | 逐点 5~9 |

于是每张图**被涂色的格子恒为 160**：

```
10 关合计 44 + 3 据点 × 4 + 51 固定 + 52 候选 + 出生点 1 = 160
```

（出生点不占 site，但它是「已涂色」的一格，连通性判定把它算进来。）

⚠️ 160 这个总量是**图形**定的：飞机/十字这类剪影在 20×20 上要 130~170 格才认得出。
一旦上到 200（= 半张图），`fit_mask_connected` 必须把机翼与机身之间填满，
剪影会退化成"带尖角的矩形"（2026-10-23 第一版踩过）。

## 图形

| id | 章节 | 图形 | 说明 |
| --- | --- | --- | --- |
| `chapter_03` | 3 | 飞机章 | 尖机头 + 细长机身 + 后掠主翼 + 窄尾翼 |
| `chapter_04` | 4 | 十字章 | 带硬边界的竖条 ∪ 横条 |
| `chapter_05` | 5 | 盾牌章 | 平顶 + 两肩微鼓 + 下尖 |
| `chapter_06` | 6 | 菱形章 | 四条直边 |
| `chapter_07` | 7 | 心形章 | 两个圆瓣 + 显式 V 形凹口 + 下尖 |

每张图都是 20×20 六边格，**只涂图形内部的 160 格**，其余留空（游戏里就是"没有地块"）。
`fit_mask_connected()` 取形状的**等值面**（同一形状的等比缩放）凑到恰好 160 格，
`solidify_rows()` 再把每行补成连续段（去掉六边格偶/奇列造成的 `#.#.#.` 虚线边）。

## 三个关键决定（都踩过坑，别改回去）

1. **锚点自动取椭圆环**（`choose_chain` 扫半径）：链间距对锚点极度敏感，
   手摆 50 个坐标改一次形状就得重摆一遍。
2. **链间距用"平移"收敛**（`shape_chain`）：加/减格子会让 44 这个总数漂，配额跟着错。
3. **异步据点在链和门之后才种**（不在第一步预占圈）：三个预占圈 ≈ 36 格，
   在飞机细长的机身处会把走道整条封死，链间距怎么修都修不回。

用法：
    python tools/map-editor/gen_territory_shapes.py            # 全部 5 张
    python tools/map-editor/gen_territory_shapes.py --only 03  # 只重做 chapter_03
    python tools/map-editor/gen_territory_shapes.py --check    # 只校验已生成的文件
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import random
import subprocess
import sys
from collections import deque
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
PRESET_DIR = HERE / 'presets' / 'territory'

ROWS = 20
COLUMNS = 20
TOTAL_CELLS = ROWS * COLUMNS

# ── 笔刷数量：5 张图共用这一组（需求 2 的落点）──────────────────────────────
# ⚠️ 这组数是「图形」定的，不是拍脑袋：飞机/十字这类剪影在 20×20 上大约 130~170 格才认得出，
# 涂色总量一旦上到 200（= 半张图），`fit_mask_connected` 就得把机翼和机身之间填满，
# 剪影会退化成一块"带尖角的矩形"。所以总量压在 160。
TARGET_PAINTED = 160          # 被涂色的格子总数（含出生点）
STAGE_COUNT = 8
BOSS_COUNT = 2
CHAIN_COUNT = STAGE_COUNT + BOSS_COUNT      # 10
# 逐点占地：BOSS 在链序第 5、10 个（下标 4 / 9）。
# 不写死每个点的格数 —— 不同形状的"机尾 / 星尖"能给的格子差很多，写死就会出现
# 「第 2 个链点只长出 3/4 格」。只锁**总和 44** 与每个点的上下限，具体分配在
# `distribute_sizes()` 里按各点实际地盘摊（总和锁死 ⇒ 下面那三项配额才不会漂）。
CHAIN_CELLS = 44
STAGE_MIN, STAGE_MAX = 3, 8      # 与 ch02 口径一致（普通关卡 3~8 格）
BOSS_MIN, BOSS_MAX = 5, 9        # 用户口径 BOSS 6~10，下探 1 格留给窄地形
ASYNC_COUNT = 3
ASYNC_SIZE = 4
GATES = CHAIN_COUNT - 1                      # 相邻链点之间的门 = 9 个（都算固定资源）
FIXED_TOTAL = 51                             # 含 9 道门
RANDOM_TOTAL = 52

# 自检：上面那组数必须自洽，否则 build() 里一定对不上
_expected = CHAIN_CELLS + ASYNC_COUNT * ASYNC_SIZE + FIXED_TOTAL + RANDOM_TOTAL + 1
assert _expected == TARGET_PAINTED, f'笔刷数量与涂色总数对不上：{_expected} != {TARGET_PAINTED}'
assert STAGE_COUNT * STAGE_MIN + BOSS_COUNT * BOSS_MIN <= CHAIN_CELLS <= \
    STAGE_COUNT * STAGE_MAX + BOSS_COUNT * BOSS_MAX, 'CHAIN_CELLS 落在上下限之外，分配不出来'

# 战斗 id 与 BOSS 位次（照 ch02：链序第 5、10 个是 BOSS）
BATTLE_IDS = [10011 + i for i in range(CHAIN_COUNT)]          # 10011 … 10020
BOSS_INDEXES = (4, 9)                                          # 10015 / 10020 是 BOSS
ASYNC_BATTLE_IDS = [20005 + i for i in range(ASYNC_COUNT)]

DEFAULTS = {'combatPower': 0, 'silverCost': 10, 'exploreSeconds': 2, 'staminaCost': 5}
COST = {
    'stage': {'silverCost': 30, 'exploreSeconds': 2, 'staminaCost': 5},
    'boss': {'silverCost': 50, 'exploreSeconds': 4, 'staminaCost': 5},
    'asyncPvp': {'silverCost': 100, 'exploreSeconds': 6, 'staminaCost': 5},
    'fixedResource': {'silverCost': 15, 'exploreSeconds': 1, 'staminaCost': 1},
}

MAX_CHAIN_GAP = 6.6      # 相邻链点中心间距上限（px 空间单位 ≈ 格）
MAX_CHAIN_EDGE = 3       # 相邻两关地块之间最多隔几格（2 格 = 中间正好一格门）
RNG_SEED = 20261023

CENTER_U = (COLUMNS - 1) / 2
CENTER_V = (ROWS - 1) / 2


# ── 基础几何（与 formats/hex-grid.js 逐格一致）──────────────────────────────
def cell_id(row: int, col: int) -> int:
    return row * COLUMNS + col


def coords_of(cell: int) -> tuple[int, int]:
    return divmod(cell, COLUMNS)


def uv(cell: int) -> tuple[float, float]:
    row, col = coords_of(cell)
    return col, row + 0.5 * (col & 1)


def px(cell: int) -> tuple[float, float]:
    """近似像素空间：x 按 0.866 压缩，y 向下为正。一个格子的"面积"= 0.866。"""
    u, v = uv(cell)
    return (u - CENTER_U) * 0.866, v - CENTER_V


def radius(cell: int) -> float:
    x, y = px(cell)
    return math.hypot(x, y)


def neighbor_cells(cell: int) -> list[int]:
    row, col = coords_of(cell)
    offsets = ([[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] if col % 2 == 0
               else [[-1, 0], [1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]])
    out = []
    for dr, dc in offsets:
        r, c = row + dr, col + dc
        if 0 <= r < ROWS and 0 <= c < COLUMNS:
            out.append(cell_id(r, c))
    return out


def all_cells() -> list[int]:
    return list(range(TOTAL_CELLS))


def hex_distance(a: int, b: int) -> int:
    def axial(cell: int) -> tuple[int, int]:
        row, col = coords_of(cell)
        return col, row - (col + (col & 1)) // 2
    aq, ar = axial(a)
    bq, br = axial(b)
    dq, dr = aq - bq, ar - br
    return (abs(dq) + abs(dr) + abs(dq + dr)) // 2


def components(cells: list[int]) -> list[list[int]]:
    target = set(cells)
    seen: set[int] = set()
    out: list[list[int]] = []
    for start in sorted(target):
        if start in seen:
            continue
        blob = [start]
        seen.add(start)
        queue = deque([start])
        while queue:
            cur = queue.popleft()
            for nxt in neighbor_cells(cur):
                if nxt in target and nxt not in seen:
                    seen.add(nxt)
                    blob.append(nxt)
                    queue.append(nxt)
        out.append(blob)
    return out


# ── 图形：解析式 + 缩放因子 k ────────────────────────────────────────────────
# 每个形状都写成「在 k=1 时大致是目标体量」，`fit_mask_connected` 再二分 k 把格数
# 收敛到目标值。**不要**靠"往里补格子"去凑数：补格会优先填凹角（机身与机翼之间），
# 飞机就会被填成一块带尖角的矩形（2026-10-23 第一版踩过）。
def shape_airplane(x: float, y: float, k: float = 1.0) -> bool:
    """机头朝上（y 负方向）：尖机头 + 细长机身 + 后掠主翼 + 窄尾翼。

    三段必须**留出体量差**（机身 ~3.7 宽 / 翼展 ~17 / 尾翼 ~6.4），否则就成了一块
    带尖角的矩形。"后掠"是机身根部靠前、翼尖靠后 —— 靠 `lead/trail` 随 |x| 平移实现，
    **不要**改成左右对称的矩形翼（那样从上看是十字）。
    """
    x, y = x / k, y / k
    ax = abs(x)
    if -9.4 <= y < -4.2:                                  # 机头：从尖端张开
        t = (y + 9.4) / 5.2
        return ax <= 0.30 + 1.60 * t ** 0.80
    if -4.2 <= y <= 8.6:
        half = 1.85                                       # 机身半宽
        if ax <= 8.4:                                     # 主翼：后掠
            lead = -4.2 + 0.60 * ax
            trail = 2.2 + 0.40 * ax
            if lead <= y <= trail:
                half = max(half, ax)
        if 6.4 <= y <= 8.2 and ax <= 3.2:                 # 尾翼：明显比主翼窄
            half = max(half, ax)
        return ax <= half
    return False


def shape_cross(x: float, y: float, k: float = 1.0) -> bool:
    """十字符号：带**硬边界**的十字（竖条 ∪ 横条）。

    🔴 边界必须写死成 `|x|,|y| <= 8.6`：早期版本只写 `|x|<=2.7 or |y|<=2.7`，
    等于两条**无限长**的条带被网格裁掉，臂永远顶到 20×20 的边缘 ——
    臂长 : 臂宽 ≈ 4:1 全由网格决定，缩放任一改就成"风车"，不是十字。
    """
    x, y = x / k, y / k
    if abs(x) > 8.6 or abs(y) > 8.6:
        return False
    return abs(x) <= 2.85 or abs(y) <= 2.85


def shape_shield(x: float, y: float, k: float = 1.0) -> bool:
    """盾牌：**平顶**、两侧微鼓、下半收成尖。

    与菱形章的区别就在上半：盾牌顶边是平的（y 最小时仍有接近全宽），
    菱形是四条直边、顶端收成一个尖。
    """
    x, y = x / k, y / k
    if y < -6.6 or y > 8.8:
        return False
    if y <= 1.2:                                          # 上半：顶部微拱 + 两肩圆角
        t = (y + 6.6) / 7.8
        half = 7.0 * (1 - 0.10 * t) - 0.9 * max(0.0, 0.14 - t) * 7
        return abs(x) <= half
    t = (y - 1.2) / 7.6                                   # 下半：指数收尖
    return abs(x) <= 7.0 * max(0.0, 1 - t) ** 1.55


def shape_diamond(x: float, y: float, k: float = 1.0) -> bool:
    """菱形（钻石）：四条直边，20×20 上最干净的一种多边形。"""
    x, y = x / k, y / k
    return abs(x) / 6.6 + abs(y) / 9.2 <= 1.0


def shape_star(x: float, y: float, k: float = 1.0) -> bool:
    """五角星：一个尖朝上。

    ⚠️ 备用形状，当前没用：160 格太小，五个尖角撑不住（尖只剩 1~2 格，像一圈毛刺）。
    要用它得把 `TARGET_PAINTED` 抬到 220+，那时飞机/十字又会变胖。
    """
    x, y = x / k, y / k
    r = math.hypot(x, y)
    if r > 10.6:
        return False
    angle = math.atan2(-y, x)                 # 屏幕 y 向下 ⇒ 取负，90° 在正上方
    kk = 0.44 + 0.56 * abs(math.cos(2.5 * (angle - math.pi / 2)))
    return r <= 10.6 * kk


def shape_heart(x: float, y: float, k: float = 1.0) -> bool:
    """心形：两个圆瓣（顶上两团圆弧）+ 下方收尖的三角 + **挖出来的 V 形凹口**。

    🔴 别回去用隐式曲线 `(u²+v²-1)³-u²v³<=0`，也别只靠"两个圆的交集留缝"：
      · 隐式曲线在 160 格下凹口只有 0.6 格深，量化后右瓣只剩 1 格，读出来是歪的团；
      · 两圆留缝的深度由 `R - sqrt(R²-C²)` 定死，圆一放大凹口就跟着变浅。
    现在凹口是**显式楔形**：顶点 (0, -2.6)、朝上张开到 ±2.1，深度 ~5 格。
    6 格宽以上的凹口不会被 `solidify_rows` 当成"行内洞"补掉（它只补缺 1 格的）。
    """
    x, y = x / k, y / k
    inside = False
    if math.hypot(abs(x) - 3.7, y + 3.0) <= 4.4:                       # 左右两个圆瓣
        inside = True
    elif -1.0 <= y <= 9.0:                                             # 下方收尖的三角
        inside = abs(x) <= 7.9 * (1 - (y + 1.0) / 10.0) ** 0.92
    if not inside:
        return False
    if y < -2.6:                                                       # 顶部 V 形凹口
        t = (-2.6 - y) / 5.0
        if abs(x) <= 2.1 * t:
            return False
    return True


# ── 把形状调到恰好 N 格，并保证连通 ─────────────────────────────────────────
def fit_mask_connected(predicate: Callable[..., bool], target: int) -> list[int]:
    """取形状的**等值面**：每格算出"最多能撑到多大的 k"，再按 k 从大到小取前 `target` 格。

    为什么这么做（踩过的三种错法都写在下面，别再改回去）：
      · 按解析式直接取格（k=1）⇒ 格数是个巧合值，不是 160，后面配额全对不上；
      · 不够就"往里补格子"⇒ 补格优先填凹角（机身与机翼之间 / 十字的四个内角），
        飞机被填成一块带尖角的矩形；
      · 补到平坦边缘时会出现 `#.#.#.` 这种一格宽的毛刺。
    等值面法得到的是**同一形状的等比例缩放**，既精确又是平滑轮廓，没有毛刺。
    """
    def enter_k(cell: int) -> float:
        """这一格「从多大的 k 开始才落进形状」。

        k 越大形状越大 ⇒ 该值**越小**的格越靠形状中心。用二分找「进入形状的最小 k」。
        永远进不去的格返回 +inf。
        """
        x, y = px(cell)
        lo, hi = 0.30, 2.60
        if not predicate(x, y, hi):
            return math.inf
        for _ in range(22):
            mid = (lo + hi) / 2
            if predicate(x, y, mid):
                hi = mid
            else:
                lo = mid
        return hi

    scored = {cell: enter_k(cell) for cell in all_cells()}
    reachable = sum(1 for value in scored.values() if math.isfinite(value))
    if reachable < target:
        raise SystemExit(f'形状最多只能铺 {reachable} 格，不够 {target}')

    def distance(cell: int) -> float:
        x, y = px(cell)
        return math.hypot(x, y)

    # 🔴 排序键必须**先量化再比距离**：六边格偶/奇列的 y 差半格，边界的 enter_k 会
    # 在相邻两列间来回跳，直接排序会挑出 `#.#.#.` 这种一列隔一列的毛刺行。
    # 把 enter_k 按 0.05 分桶后，同桶内按「离图形中心远近」排，割线就会从中路往外推。
    QUANT = 0.05

    def rank_key(cell: int) -> tuple[int, float, int]:
        # 永远进不去的格（+inf）统一压到最后
        bucket = 10 ** 6 if not math.isfinite(scored[cell]) else int(round(scored[cell] / QUANT))
        return bucket, distance(cell), cell

    ranked = sorted(all_cells(), key=rank_key)
    inside = set(ranked[:target])
    rest = [cell for cell in ranked if cell not in inside]

    # 连通修复：先只留最大连通块，再按排序补回来（补的必须是贴着主块的格）
    for _ in range(60):
        blobs = components(sorted(inside))
        if len(blobs) == 1:
            break
        main = max(blobs, key=len)
        inside = set(main)
        for cell in rest:
            if len(inside) >= target:
                break
            if cell in inside:
                continue
            if any(n in inside for n in neighbor_cells(cell)):
                inside.add(cell)
        rest = [cell for cell in rest if cell not in inside]
        if len(inside) < target:
            for cell in rest:
                if len(inside) >= target:
                    break
                inside.add(cell)
        if len(inside) >= target:
            break

    if len(inside) != target:
        raise SystemExit(f'等值面取了 {len(inside)} 格，应为 {target}')
    inside = solidify_rows(inside, target)
    if len(components(sorted(inside))) != 1:
        raise SystemExit('等值面仍然不连通（形状本身太细，换个比例或换形状）')
    return sorted(inside)


def solidify_rows(inside: set[int], target: int) -> set[int]:
    """把每一行补成**连续段**，超出的从「最长那一行的两端」削掉。

    为什么需要：六边格偶/奇列差半格，水平边界会正好落在两行之间 ⇒ 等值面切出来
    是 `#.#.#.` 的虚线边（飞机机翼后缘、十字横条上下沿都踩过）。行内补洞之后
    每行都是实心段，剪影一眼就认得出来；削的时候只动两端，不会再把行切碎。
    """
    for _ in range(200):
        # ① 行内补洞：一行里两侧都有、中间只缺一格 ⇒ 补上（缺口大的不补，避免跨过凹口搭桥）
        rows: dict[int, list[int]] = {}
        for cell in inside:
            row, col = coords_of(cell)
            rows.setdefault(row, []).append(col)
        added = False
        for row, cols in rows.items():
            cols.sort()
            for left, right in zip(cols, cols[1:]):
                if right - left == 2:
                    inside.add(cell_id(row, left + 1))
                    added = True
        if added and len(inside) <= target:
            continue

        # ② 超了就从最长那一行的两端削（保证每行仍然连续）
        if len(inside) > target:
            rows = {}
            for cell in inside:
                row, col = coords_of(cell)
                rows.setdefault(row, []).append(col)
            trimmed = False
            for row in sorted(rows, key=lambda r: (-len(rows[r]), r)):
                cols = sorted(rows[row])
                if len(cols) <= 1:
                    continue
                for col in (cols[0], cols[-1]):
                    cell = cell_id(row, col)
                    trial = inside - {cell}
                    if cell in inside and len(components(sorted(trial))) == 1:
                        inside = trial
                        trimmed = True
                        break
                if trimmed:
                    break
            if not trimmed:
                raise SystemExit('削不下去了（每格都是桥）')
            continue

        if len(inside) == target:
            break
    return inside


# ── 链路：10 个锚点（px 空间）──────────────────────────────────────────────
def seed_near(x: float, y: float, cells: list[int]) -> int:
    return min(cells, key=lambda c: (math.hypot(px(c)[0] - x, px(c)[1] - y), c))


RING_SNAP = 0.95          # 环上的点离最近格子中心超过这个距离就算"落在形状外"


def outline_anchors(mask: list[int], start_deg: float = 90.0) -> list[tuple[float, float]]:
    """兜底方案：从重心朝 10 个等分角度打射线，取该方向上**轮廓**的那一格当锚点。

    宽扁或带细长尖角的图形可能找不到整圈内接（见 `auto_anchors`），这时用轮廓锚点。
    弦长会明显偏大（飞机章实测 5~7），`shape_chain` 要平移好几格才补得回来。
    """
    xs = [px(c)[0] for c in mask]
    ys = [px(c)[1] for c in mask]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    step = 360.0 / CHAIN_COUNT
    picked: list[int] = []
    for index in range(CHAIN_COUNT):
        angle = math.radians(start_deg + step * index)
        ux, uy = math.cos(angle), math.sin(angle)
        best: int | None = None
        best_score = -1e9
        for cell in mask:
            dx, dy = px(cell)[0] - cx, px(cell)[1] - cy
            along = dx * ux + dy * uy                 # 朝这条射线的投影
            if along <= 0 or abs(dx * uy - dy * ux) > 0.95:
                continue
            if along > best_score:
                best_score, best = along, cell
        if best is None:
            best = seed_near(cx + 5 * ux, cy + 5 * uy, mask)
        picked.append(best)
    if len(set(picked)) != CHAIN_COUNT:
        raise SystemExit('轮廓锚点撞了（同一格被两个角度取到，形状太窄）')
    return [px(cell) for cell in picked]


def auto_anchors(mask: list[int], start_deg: float = 90.0) -> list[tuple[float, float]]:
    """10 个链点锚 = 形状**内接环**上等分角度取格（从正下方开始，逆时针）。与 ch02 同口径。

    🔴 为什么不直接取轮廓 / 不手摆坐标（都试过）：
      · 手摆 50 个坐标：改一次形状就得重摆一遍，摆得比 3 格近或远，相邻两关就出
        gap=1 / gap=5，`shape_chain` 平移救不回来（飞机章为此返工两轮）；
      · 取轮廓：飞机的轮廓环有 60+ 格，而 10 关总共只有 `CHAIN_CELLS` + 9 道门 = 53 格，
        根本绕不满一圈 —— 实测相邻锚点 5~7 格，blob 长不过去。
    内接环的弦长天然落在「4 格地块 + 隔 1~2 格」的窗口里（实测 2.0~4.4），
    半径由形状自己定：从 9.2 往下试，第一个能让 10 个点**全部落进形状**的半径就是它。
    """
    step = 360.0 / CHAIN_COUNT
    for r10 in range(92, 12, -2):
        radius = r10 / 10.0
        cells: list[int] = []
        for index in range(CHAIN_COUNT):
            angle = math.radians(start_deg + step * index)
            x, y = radius * math.cos(angle), radius * math.sin(angle)
            cell = seed_near(x, y, mask)
            if math.hypot(px(cell)[0] - x, px(cell)[1] - y) > RING_SNAP:
                break
            cells.append(cell)
        else:
            if len(set(cells)) == CHAIN_COUNT:
                return [px(cell) for cell in cells]
    return outline_anchors(mask, start_deg)


# ── 五个章节的定义 ──────────────────────────────────────────────────────────
# 链点锚**不手写**：`auto_anchors()` 按各图形的内接环自动取 10 个。
# 关卡顺序从正下方开始逆时针绕一圈，第 5 / 10 个是 BOSS（与 ch02 同口径）。
CHAPTERS: list[dict] = [
    {
        'id': 'chapter_03',
        'chapterId': 3,
        'name': '飞机章',
        'shape': shape_airplane,
        'preview': 'chapter_03-plane-preview.png',
    },
    {
        'id': 'chapter_04',
        'chapterId': 4,
        'name': '十字章',
        'shape': shape_cross,
        'preview': 'chapter_04-cross-preview.png',
    },
    {
        'id': 'chapter_05',
        'chapterId': 5,
        'name': '盾牌章',
        'shape': shape_shield,
        'preview': 'chapter_05-shield-preview.png',
    },
    {
        'id': 'chapter_06',
        'chapterId': 6,
        'name': '菱形章',
        'shape': shape_diamond,
        'preview': 'chapter_06-diamond-preview.png',
    },
    {
        'id': 'chapter_07',
        'chapterId': 7,
        'name': '心形章',
        'shape': shape_heart,
        'preview': 'chapter_07-heart-preview.png',
    },
]


# ── 切地盘 / 生长 / 收拢（沿用笑脸章那一套，已验证过）──────────────────────
def chain_owner_map(mask: list[int], anchors: list[tuple[float, float]]) -> dict[int, int]:
    """每格归属于「离得最近的那个链点」，用来切地盘。"""
    owner: dict[int, int] = {}
    for cell in mask:
        x, y = px(cell)
        owner[cell] = min(
            range(len(anchors)),
            key=lambda i: (math.hypot(x - anchors[i][0], y - anchors[i][1]), i),
        )
    return owner


def expand(blob: list[int], frontier: deque[int], size: int, pool: set[int],
           used: set[int], allow: Callable[[int], bool] | None = None) -> None:
    while frontier and len(blob) < size:
        cell = frontier.popleft()
        for nxt in neighbor_cells(cell):
            if len(blob) >= size:
                break
            if nxt not in pool or nxt in used:
                continue
            if allow is not None and not allow(nxt):
                continue
            used.add(nxt)
            blob.append(nxt)
            frontier.append(nxt)


def grow_compact(seed: int, size: int, pool: set[int], used: set[int],
                 allow: Callable[[int], bool] | None = None) -> list[int]:
    """按「离种子最近优先」生长：地块紧凑，不会沿夹缝拉成一条虫。"""
    if seed not in pool or seed in used or (allow is not None and not allow(seed)):
        return []
    sx, sy = px(seed)
    blob = [seed]
    used.add(seed)
    pushed = {seed}
    heap: list[tuple[float, int]] = []

    def push(cell: int) -> None:
        for nxt in neighbor_cells(cell):
            if nxt in pushed or nxt in used or nxt not in pool:
                continue
            if allow is not None and not allow(nxt):
                continue
            pushed.add(nxt)
            x, y = px(nxt)
            heapq.heappush(heap, (math.hypot(x - sx, y - sy), nxt))

    push(seed)
    while heap and len(blob) < size:
        _, cell = heapq.heappop(heap)
        if cell in used:
            continue
        used.add(cell)
        blob.append(cell)
        push(cell)
    return blob


def footprint_gap(a: dict, b: dict) -> int:
    return min(hex_distance(x, y) for x in a['footprint'] for y in b['footprint'])


def _pair_gap(cells: list[int], other: list[int]) -> int:
    return min(hex_distance(x, y) for x in cells for y in other)


def _free_ring(own: set[int], mask: set[int], used: set[int],
               blocked: set[int]) -> list[int]:
    """贴着 `own` 一圈、可以直接拿来用的空格（不属于任何已有站点）。"""
    return [c for c in mask if c not in used and c not in blocked
            and any(n in own for n in neighbor_cells(c))]


def _slide_toward(src: dict, dst: dict, mask: set[int], used: set[int],
                  blocked: set[int]) -> bool:
    """把 `src` 的整体往 `dst` 挪一格：先加一格更靠 `dst` 的空格，再摘自己最远的一格。

    🔴 为什么不"长一格"：格子数一变，`固定 51 / 候选 52` 的配额就漂了。
    slide 的两步一加一减，占地格数恒定。
    """
    own = set(src['footprint'])
    dst_cells = dst['footprint']
    ring = _free_ring(own, mask, used, blocked)
    if not ring:
        return False
    add = min(ring, key=lambda c: (_pair_gap([c], dst_cells), c))
    gain = _pair_gap([add], dst_cells)
    if gain >= _pair_gap(src['footprint'], dst_cells):
        return False                       # 这一格加进来也没更近，别做无用功
    drops = sorted((c for c in src['footprint'] if c != src['cellId']),
                   key=lambda c: (-_pair_gap([c], dst_cells), c))
    for drop in drops:
        if _pair_gap([drop], dst_cells) <= gain:
            continue                       # 只摘"比新格更靠后"的，保证净靠近
        rest = [c for c in src['footprint'] if c != drop] + [add]
        if len(components(rest)) > 1:
            continue
        used.add(add)
        used.discard(drop)
        src['footprint'] = sorted(rest)
        return True
    return False


def _slide_away(src: dict, dst: dict, mask: set[int], used: set[int],
                blocked: set[int]) -> bool:
    """反过来：两块地贴死了（间隙 1 格塞不下大门），摘掉贴着对方的那格再往别处补一格。

    同样保证"摘一格 + 补一格"，总数不变；补的那格还要离 `dst` 够远，不能又贴上去。
    """
    dst_cells = dst['footprint']
    if len(src['footprint']) <= 2:
        return False
    touching = sorted(c for c in src['footprint']
                      if c != src['cellId'] and _pair_gap([c], dst_cells) < 2)
    for drop in touching:
        rest = [c for c in src['footprint'] if c != drop]
        if len(components(rest)) > 1:
            continue                       # 摘掉就断成两块，不行
        gap = _pair_gap(rest, dst_cells)
        if gap < 2:
            continue                       # 摘了这一格还是贴死，白摘
        ring = [c for c in _free_ring(set(rest), mask, used, blocked)
                if _pair_gap([c], dst_cells) >= gap]
        if not ring:
            continue
        add = max(ring, key=lambda c: (_pair_gap([c], dst_cells), -c))
        final = rest + [add]
        if len(components(final)) > 1:
            continue
        used.discard(drop)
        used.add(add)
        src['footprint'] = sorted(final)
        return True
    return False


def shape_chain(chain: list[dict], mask: set[int], used: set[int],
                blocked: set[int], rounds: int = 6) -> list[str]:
    """把相邻两关的间隙收敛到 **2~3 格**（2 格时中间那格正好留给大门）。

    ch02 的实测口径就是 gap 恒为 2 —— 相邻两关不相贴、中间恰好一格门。
    这里只做**平移**，不改任何站点的格数，所以 `sum(plan)` 不会被破坏。
    返回没修好的对（交给调用方决定是重试还是报错）。
    """
    for _ in range(rounds):
        changed = False
        for index in range(len(chain) - 1):
            a, b = chain[index], chain[index + 1]
            gap = _pair_gap(a['footprint'], b['footprint'])
            if 2 <= gap <= MAX_CHAIN_EDGE:
                continue
            if gap > MAX_CHAIN_EDGE:
                moved = (_slide_toward(a, b, mask, used, blocked)
                         or _slide_toward(b, a, mask, used, blocked))
            else:
                moved = (_slide_away(a, b, mask, used, blocked)
                         or _slide_away(b, a, mask, used, blocked))
            changed = changed or moved
        if not changed:
            break

    bad: list[str] = []
    for index in range(len(chain) - 1):
        gap = _pair_gap(chain[index]['footprint'], chain[index + 1]['footprint'])
        if not 2 <= gap <= MAX_CHAIN_EDGE:
            bad.append(f'{chain[index]["configId"]}→{chain[index + 1]["configId"]} gap={gap}')
    return bad


def balance_chain(chain: list[dict], plan: list[int], mask: set[int],
                  used: set[int], blocked: set[int]) -> None:
    """把 10 个链点的总占地**精确**收敛到 `sum(plan)`。

    为什么需要：`grow_compact` 有时长不满（地盘被邻格挤住），`shape_chain` 又只做平移。
    两头一漂，剩下的格子就不是「固定 51 + 候选 52」了 —— 而这两项是需求里要
    「每张图保持一致」的硬指标，必须靠这一步兜住。
    """
    for _ in range(80):
        diffs = [(index, len(site['footprint']) - plan[index]) for index, site in enumerate(chain)]
        over = sorted(((d, i) for i, d in diffs if d > 0), reverse=True)
        under = sorted(((d, i) for i, d in diffs if d < 0))

        if over:
            _, index = over[0]
            site = chain[index]
            xs = [px(c)[0] for c in site['footprint']]
            ys = [px(c)[1] for c in site['footprint']]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            neighbours: set[int] = set()
            for offset in (-1, 1):
                other = index + offset
                if 0 <= other < len(chain):
                    neighbours |= set(chain[other]['footprint'])
            # 摘「离重心最远」的那格，且不许摘掉贴着邻居的格（那会把门的位置也摘掉）
            cands = sorted((c for c in site['footprint'] if c != site['cellId']),
                           key=lambda c: (-math.hypot(px(c)[0] - cx, px(c)[1] - cy), c))
            for drop in cands:
                if any(n in neighbours for n in neighbor_cells(drop)):
                    continue
                rest = [c for c in site['footprint'] if c != drop]
                if len(components(rest)) > 1:
                    continue
                site['footprint'] = sorted(rest)
                used.discard(drop)
                break
            else:
                raise SystemExit(f'{site["id"]} 收不回去（每格都贴着邻居或会断）')
            continue

        if under:
            _, index = under[0]
            site = chain[index]
            own = set(site['footprint'])
            cands = [c for c in mask if c not in used and c not in blocked
                     and any(n in own for n in neighbor_cells(c))]
            if not cands:
                raise SystemExit(f'{site["id"]} 补不上去（周围没有可用空格）')
            best = min(cands, key=lambda c: (min(hex_distance(c, n) for n in own), c))
            used.add(best)
            site['footprint'] = sorted(site['footprint'] + [best])
            continue

        return


def pick_gates(chain: list[dict], free: set[int]) -> dict[int, int]:
    """给每对相邻关卡挑一格「同时贴着两边」的空格当大门。"""
    gates: dict[int, int] = {}
    for index in range(len(chain) - 1):
        a = set(chain[index]['footprint'])
        b = set(chain[index + 1]['footprint'])
        ax = sum(px(c)[0] for c in a) / len(a)
        ay = sum(px(c)[1] for c in a) / len(a)
        bx = sum(px(c)[0] for c in b) / len(b)
        by = sum(px(c)[1] for c in b) / len(b)
        mx, my = (ax + bx) / 2, (ay + by) / 2

        def dist(cell: int) -> tuple[float, int]:
            return math.hypot(px(cell)[0] - mx, px(cell)[1] - my), cell

        def touches(cell: int, group: set[int]) -> bool:
            return any(n in group for n in neighbor_cells(cell))

        pool = free - set(gates.values())
        both = [c for c in pool if touches(c, a) and touches(c, b)]
        either = [c for c in pool if touches(c, a) or touches(c, b)]
        candidates = both or either or list(pool)
        if not candidates:
            raise SystemExit(f'第 {index + 1}/{index + 2} 关之间找不到可用的门')
        gates[index] = min(candidates, key=dist)
    return gates


# ── 紫色据点：链和门都定好之后再种 ──────────────────────────────────────────
# 两道门槛（px 空间，与链点同一套单位）。细长图形上必须放宽，所以做成阶梯。
ASYNC_MIN_CHAIN_LADDER = (2.60, 2.20, 1.85, 1.55, 1.25)   # 种子离最近关卡地块的距离
ASYNC_MIN_GAP_LADDER = (3.60, 2.90, 2.30)                 # 据点彼此的距离（两块地不互贴）


def rank_async_seeds(free: list[int], chain_cells: list[int],
                     min_chain: float) -> list[int]:
    """把空地按"当紫色据点种子"的合适程度排个序：离所有关卡地块越远越好。

    🔴 这里只排序、不拍板。真正的落点由调用方一个个试种 ——
    "这块空地够不够 4 格连成一块"只能让 `grow_compact` 试出来，静态判断不准。

    为什么不事先把据点圈"预占"住（上一版的做法）：三个圈 ≈ 36 格，在飞机章细长的
    机身里正好把机尾与机翼之间的走道整条封死，链间距（10012→10013 gap=5）怎么
    平移都修不回来。改成"链和门都定好、再从剩余空地种"，矛盾自然消失。
    """
    def chain_distance(cell: int) -> float:
        x, y = px(cell)
        return min(math.hypot(x - px(other)[0], y - px(other)[1]) for other in chain_cells)

    scored = [(-chain_distance(c), c) for c in free]
    return [cell for _, cell in sorted(scored) if chain_distance(cell) >= min_chain]


def distribute_sizes(avail: dict[int, int]) -> list[int]:
    """把 `CHAIN_CELLS` 格摊给 10 个链点，**按各点实际能用的地盘**来分。

    `avail[i]` = 第 i 个链点地盘里还没被占用的格数（已扣掉门与紫色据点）。
    先给每个点一个下限（普通 3 / BOSS 5），剩下的按「地盘从大到小」轮着 +1，
    直到总数到 `CHAIN_CELLS`；每点不超过自己地盘的格数。

    ⚠️ 写死成 4/4/4… 会在窄地形上直接失败（飞机机尾被两个链点 + 两个据点夹着，
    第 2 点只剩 3 格可用）。而只要**总和**锁死 44，"固定 51 / 候选 52" 就不会漂。
    """
    sizes = [BOSS_MIN if index in BOSS_INDEXES else STAGE_MIN for index in range(CHAIN_COUNT)]
    caps = [min(avail[index], BOSS_MAX if index in BOSS_INDEXES else STAGE_MAX)
            for index in range(CHAIN_COUNT)]
    if sum(sizes) > CHAIN_CELLS:
        raise SystemExit('下限之和已经超过 CHAIN_CELLS')
    remaining = CHAIN_CELLS - sum(sizes)
    order = sorted(range(CHAIN_COUNT), key=lambda i: (-avail[i], i))
    while remaining > 0:
        grown = False
        for index in order:
            if remaining == 0:
                break
            if sizes[index] >= caps[index]:
                continue
            sizes[index] += 1
            remaining -= 1
            grown = True
        if not grown:
            raise SystemExit(f'地盘不够分：还差 {remaining} 格（形状太小）')
    return sizes


# ── 组表 ────────────────────────────────────────────────────────────────────
def make_site(site_type: str, cells: list[int], extra: dict | None = None,
              site_id: str | None = None) -> dict:
    cost = COST[site_type]
    site = {
        'id': site_id or site_type,
        'type': site_type,
        'cellId': cells[0],
        'footprint': sorted(cells),
        'configId': '',
        'buildingId': '',
        'unlock': {
            'requiredCells': [],
            'combatPower': 0,
            'silverCost': cost['silverCost'],
            'exploreSeconds': cost['exploreSeconds'],
            'staminaCost': cost['staminaCost'],
        },
    }
    if extra:
        site.update(extra)
    return site


def ellipse_anchors(mask_list: list[int], rx: float, ry: float,
                    start_deg: float = 90.0) -> list[tuple[float, float]] | None:
    """椭圆环上等分角度取 10 个锚点，每个点吸到最近的格子。

    为什么是椭圆而不是圆：五个图形的长宽比差得远（飞机 17:20、盾牌 14:16），
    用一个半径的圆，窄的地方弦长挤到 1.7（两块地直接贴上）、宽的地方拉到 7
    （中间隔 5 格，门塞不进去）。rx / ry 分开就能同时压住两头。
    吸不到 10 个不同的格子就返回 None（这组半径作废）。
    """
    step = 360.0 / CHAIN_COUNT
    cells: list[int] = []
    for index in range(CHAIN_COUNT):
        angle = math.radians(start_deg + step * index)
        cells.append(seed_near(rx * math.cos(angle), ry * math.sin(angle), mask_list))
    if len(set(cells)) != CHAIN_COUNT:
        return None
    return [px(cell) for cell in cells]


def plan_chain(mask_list: list[int], anchors: list[tuple[float, float]],
               start_cell: int, tag: str) -> tuple[list[dict], list[int], set[int], set[int], list[str]]:
    """① 切地盘 → ② 摊尺寸、按链序长 10 块 → ③ 平移收敛间隙。

    返回 `(chain, plan, used, protected, bad_pairs)`，**不写任何全局状态**，
    这样 `choose_chain` 才能拿不同锚点反复试算。
    """
    mask = set(mask_list)
    used: set[int] = {start_cell}

    # ① 切地盘 + 预占门位
    # 🔴 只预占**每对相邻的一格**（笑脸章的口径），不要预占整条交界带：
    #    十字章试过"整带预占"，160 格里保护掉 72 格（45%），有的链点只剩 2 格长不满。
    # 🔴 也不要在这一步预占紫色据点圈：三个圈 ≈ 36 格，在细长的机身处正好把
    #    机尾与机翼之间的走道整条封死（飞机章 10012 与 10013 之间那堵墙），
    #    链间距怎么平移都修不回来。据点改成"等链和门都定好、再挑空地种"。
    owner = chain_owner_map(mask_list, anchors)
    protected: set[int] = set()
    for index in range(len(anchors) - 1):
        region = [cell for cell in mask_list if owner[cell] == index]
        border = [cell for cell in region
                  if any(owner.get(n) == index + 1 for n in neighbor_cells(cell))]
        pool = border or region
        if not pool:
            continue
        # 取「贴着下一块地盘、又最靠近两锚点中点」的那一格
        ax, ay = anchors[index]
        bx, by = anchors[index + 1]
        mx, my = (ax + bx) / 2, (ay + by) / 2
        protected.add(min(pool, key=lambda c: (math.hypot(px(c)[0] - mx, px(c)[1] - my), c)))

    # ② 按链序长 10 个站点（BOSS 在第 5 / 10 个）；每个点的格数按它自己的地盘摊
    avail = {
        index: sum(1 for c in mask_list
                   if owner[c] == index and c not in protected and c not in used)
        for index in range(CHAIN_COUNT)
    }
    plan = distribute_sizes(avail)

    chain: list[dict] = []
    counts = {'stage': 0, 'boss': 0}
    for index, (ax, ay) in enumerate(anchors):
        is_boss = index in BOSS_INDEXES
        site_type = 'boss' if is_boss else 'stage'
        size = plan[index]
        own = [c for c in mask_list if owner[c] == index and c not in protected and c not in used]
        if not own:
            raise SystemExit(f'{tag} 第 {index + 1} 个链点没有属于自己的地盘')
        seed = seed_near(ax, ay, own)
        blob = grow_compact(seed, size, mask, used,
                            allow=lambda c, i=index: owner.get(c) == i and c not in protected)
        if len(blob) < size:                       # 地盘被挤窄了，放宽到整张图
            expand(blob, deque(blob), size, mask, used, allow=lambda c: c not in protected)
        if len(blob) < size:
            raise SystemExit(f'{tag} 第 {index + 1} 个链点只长出 {len(blob)}/{size} 格')
        counts[site_type] += 1
        chain.append(make_site(site_type, blob,
                               {'configId': str(BATTLE_IDS[index])},
                               site_id=f'{site_type}_{counts[site_type]}'))

    # ③ 平移收敛：相邻两关的间隙恒压到 2~3 格（2 格时中间那格正好是门）
    bad = shape_chain(chain, mask, used, protected)
    # 两头的漂移兜住：10 关加起来必须正好 sum(plan) 格，否则配额一定对不上
    balance_chain(chain, plan, mask, used, protected)
    return chain, plan, used, protected, bad


# 椭圆半径候选：0.4 一档，从 2.8 扫到 8.4 / 9.4（够覆盖扁的飞机和接近圆的菱形）
ANCHOR_RX = tuple(x / 10 for x in range(28, 88, 4))
ANCHOR_RY = tuple(y / 10 for y in range(28, 98, 4))


def choose_chain(mask_list: list[int], start_cell: int,
                 tag: str) -> tuple[float, float, list[dict], list[int], set[int], set[int], list[str]]:
    """扫一遍椭圆半径，取「链间距修得最干净」的那组。

    🔴 为什么是"试算 + 真实评估"，不是"算个公式定半径"：
      链间距是「Voronoi 切地盘 → 紧凑生长 → 平移」三步的**涌现结果**，没有解析式。
      而这件事对锚点又极度敏感 —— 差 0.4 的半径就可能让某一对从 gap=2 变成 gap=5。
      直接扫一遍（每组只算一次、总共几十毫秒）比人肉调参数可靠得多。
      `plan_chain` 因此被写成"纯函数"，可以随便重算。
    """
    best: tuple[int, float, float, tuple] | None = None
    fallback: tuple[int, float, float, tuple] | None = None
    for rx in ANCHOR_RX:
        for ry in ANCHOR_RY:
            anchors = ellipse_anchors(mask_list, rx, ry)
            if anchors is None:
                continue
            try:
                result = plan_chain(mask_list, anchors, start_cell, tag)
            except SystemExit:
                continue
            score = len(result[4])
            if fallback is None or score < fallback[0]:
                fallback = (score, rx, ry, result)
            if score == 0:
                return (rx, ry) + result
    if fallback is None:
        raise SystemExit(f'{tag} 所有候选半径都长不出 10 个链点（图形太碎）')
    return (fallback[1], fallback[2]) + fallback[3]


def build(spec: dict) -> tuple[dict, list[str]]:
    mask_list = fit_mask_connected(spec['shape'], TARGET_PAINTED)
    mask = set(mask_list)

    # 出生点：形状最底下一格（离中线最近的），它不占 site
    bottom_row = max(coords_of(c)[0] for c in mask)
    bottom = [c for c in mask if coords_of(c)[0] == bottom_row]
    start_cell = min(bottom, key=lambda c: (abs(px(c)[0]), c))
    if start_cell not in mask:
        raise SystemExit('出生点没落在形状里')

    rx, ry, chain, plan, used, protected, bad_pairs = choose_chain(
        mask_list, start_cell, spec['id'])
    if bad_pairs:
        raise SystemExit(f'{spec["id"]} 链间距修不好（rx={rx} ry={ry}）：'
                         + '；'.join(bad_pairs))

    sites: list[dict] = list(chain)

    def add(site_type: str, cells: list[int], extra: dict | None = None) -> dict:
        counts = sum(1 for x in sites if x['type'] == site_type) + 1
        site = make_site(site_type, cells, extra, site_id=f'{site_type}_{counts}')
        sites.append(site)
        return site

    def center_of(blob: list[int]) -> tuple[float, float]:
        xs = [px(c)[0] for c in blob]
        ys = [px(c)[1] for c in blob]
        return sum(xs) / len(xs), sum(ys) / len(ys)

    # ④ 定门（每对相邻链点一道，共 9 道）
    gate_by_pair = pick_gates(chain, mask - used)
    used |= set(gate_by_pair.values())
    gate_sites = [add('fixedResource', [cell],
                      {'configId': f'fixedResource_{cell}', 'rewardId': 1011})
                  for _, cell in sorted(gate_by_pair.items())]

    # ⑤ 异步据点（3 个 × 4 格）：链和门都落定之后，从剩下的空地挑三块种上去
    chain_cells = [c for site in chain for c in site['footprint']]

    def plant_async(min_chain: float, min_gap: float) -> list[dict]:
        """按（离链多远、彼此多远）两道门槛试着种满 ASYNC_COUNT 个，种不满就全部回滚。"""
        used_before, sites_before = set(used), len(sites)
        picked: list[int] = []
        for seed in rank_async_seeds(sorted(mask - used), chain_cells, min_chain):
            if len(picked) == ASYNC_COUNT:
                break
            sx, sy = px(seed)
            if any(math.hypot(sx - px(o)[0], sy - px(o)[1]) < min_gap for o in picked):
                continue
            snapshot = set(used)
            blob = grow_compact(seed, ASYNC_SIZE, mask, used)
            if len(blob) < ASYNC_SIZE:      # 这块空地连不成 4 格，回滚再试下一个种子
                used.intersection_update(snapshot)
                continue
            picked.append(seed)
            add('asyncPvp', blob, {'configId': str(ASYNC_BATTLE_IDS[len(picked) - 1])})
        if len(picked) == ASYNC_COUNT:
            return sites[sites_before:]
        used.intersection_update(used_before)
        del sites[sites_before:]
        return []

    async_sites: list[dict] = []
    for min_chain in ASYNC_MIN_CHAIN_LADDER:
        for min_gap in ASYNC_MIN_GAP_LADDER:
            async_sites = plant_async(min_chain, min_gap)
            if async_sites:
                break
        if async_sites:
            break
    if not async_sites:
        raise SystemExit(f'{spec["id"]} 种不下 {ASYNC_COUNT} 个异步据点（空地太碎）')

    # ⑥ 剩下的格子：随机候选 + 固定资源（固定资源数量 = 目标值 − 已落的门）
    rest = sorted(mask - used, key=lambda c: (radius(c), c))
    fixed_needed = FIXED_TOTAL - len(gate_sites)
    if len(rest) != RANDOM_TOTAL + fixed_needed:
        raise SystemExit(f'{spec["id"]} 剩余 {len(rest)} 格，应为 {RANDOM_TOTAL + fixed_needed}'
                         f'（候选 {RANDOM_TOTAL} + 固定 {fixed_needed}）')
    random_rest = rest[::2][:RANDOM_TOTAL]
    if len(random_rest) != RANDOM_TOTAL:
        random_rest = rest[:RANDOM_TOTAL]
    random_set = set(random_rest)
    fixed_rest = [cell for cell in rest if cell not in random_set]
    for cell in fixed_rest:
        add('fixedResource', [cell], {'configId': f'fixedResource_{cell}', 'rewardId': 1011})

    # ⑦ 链上站点补过格子 ⇒ 锚点格取「离地块重心最近」的那一格
    for site in chain:
        cx, cy = center_of(site['footprint'])
        site['cellId'] = min(site['footprint'],
                             key=lambda c: (math.hypot(px(c)[0] - cx, px(c)[1] - cy), c))

    # ⑧ 解锁：第 i 关 = 上一关 cellId + 它们之间那道门
    for index, site in enumerate(chain):
        if index == 0:
            site['unlock']['requiredCells'] = [start_cell]
            continue
        required = [chain[index - 1]['cellId']]
        if index - 1 < len(gate_sites):
            required.append(gate_sites[index - 1]['cellId'])
        site['unlock']['requiredCells'] = required

    for index, gate in enumerate(gate_sites):        # 门自己挂在它前面那一关
        gate['unlock']['requiredCells'] = [chain[min(index, len(chain) - 1)]['cellId']]

    chain_ids = {site['id'] for site in chain}
    gate_ids = {site['id'] for site in gate_sites}
    for site in sites:                               # 其余站点挂到最近的链点
        if site['id'] in chain_ids or site['id'] in gate_ids:
            continue
        nearest = min(chain, key=lambda other: hex_distance(other['cellId'], site['cellId']))
        site['unlock']['requiredCells'] = [nearest['cellId']]

    data = {
        'version': 1,
        'mapKind': 'territoryChapter',
        'id': spec['id'],
        'name': spec['name'],
        'chapterId': spec['chapterId'],
        'rows': ROWS,
        'columns': COLUMNS,
        'startCellId': start_cell,
        'background': '',
        'defaults': dict(DEFAULTS),
        'sites': sites,
        'randomSites': {
            'triggerSilver': 15,
            'rewardPoolId': '2001',
            'candidateCells': sorted(random_rest),
            'maxActive': 1,
            'buildingIds': {str(c): '69006' for c in sorted(random_rest)[::5]},
        },
    }
    return data, [site['id'] for site in chain]


# ── 自检：笔刷数量 / 连通 / 链路 ────────────────────────────────────────────
def check(data: dict, label: str = '') -> None:
    tag = label or data['id']
    sites = data['sites']
    counts: dict[str, int] = {}
    for site in sites:
        counts[site['type']] = counts.get(site['type'], 0) + 1
    problems: list[str] = []
    if counts.get('fixedResource') != FIXED_TOTAL:
        problems.append(f"fixedResource {counts.get('fixedResource')} != {FIXED_TOTAL}")
    if counts.get('stage') != STAGE_COUNT:
        problems.append(f"stage {counts.get('stage')} != {STAGE_COUNT}")
    if counts.get('boss') != BOSS_COUNT:
        problems.append(f"boss {counts.get('boss')} != {BOSS_COUNT}")
    if counts.get('asyncPvp') != ASYNC_COUNT:
        problems.append(f"asyncPvp {counts.get('asyncPvp')} != {ASYNC_COUNT}")
    if len(data['randomSites']['candidateCells']) != RANDOM_TOTAL:
        problems.append(f"candidateCells {len(data['randomSites']['candidateCells'])} != {RANDOM_TOTAL}")

    painted = {data['startCellId']}
    for site in sites:
        painted |= set(site['footprint'])
    painted |= set(data['randomSites']['candidateCells'])
    blobs = components(sorted(painted))
    if len(blobs) != 1:
        problems.append(f'涂色格不连通：{len(blobs)} 块（大小 {[len(b) for b in blobs][:5]}）')
    if len(painted) != TARGET_PAINTED:
        problems.append(f'涂色格 {len(painted)} != {TARGET_PAINTED}')

    # 同一站点多格必须同 configId（本来就是一条记录，这里只是防手改）
    chain = sorted([s for s in sites if s['type'] in ('stage', 'boss')],
                   key=lambda s: int(s.get('configId') or 0))
    if [int(s['configId']) for s in chain] != BATTLE_IDS:
        problems.append(f'链序 configId 不是 {BATTLE_IDS[0]}…{BATTLE_IDS[-1]}')
    for index in range(len(chain) - 1):
        a, b = chain[index], chain[index + 1]
        ax = sum(px(c)[0] for c in a['footprint']) / len(a['footprint'])
        ay = sum(px(c)[1] for c in a['footprint']) / len(a['footprint'])
        bx = sum(px(c)[0] for c in b['footprint']) / len(b['footprint'])
        by = sum(px(c)[1] for c in b['footprint']) / len(b['footprint'])
        gap = math.hypot(ax - bx, ay - by)
        edge = footprint_gap(a, b)
        if gap > MAX_CHAIN_GAP:
            problems.append(f'{a["configId"]}→{b["configId"]} 中心间距 {gap:.2f} > {MAX_CHAIN_GAP}')
        if edge > MAX_CHAIN_EDGE:
            problems.append(f'{a["configId"]}→{b["configId"]} 相隔 {edge} 格 > {MAX_CHAIN_EDGE}')
        if edge < 2:
            problems.append(f'{a["configId"]}→{b["configId"]} 只隔 {edge} 格（门塞不进去）')

    if problems:
        raise SystemExit(f'[{tag}] 自检失败：\n  - ' + '\n  - '.join(problems))

    sizes: dict[str, list[int]] = {}
    for site in sites:
        sizes.setdefault(site['type'], []).append(len(site['footprint']))
    print(f'  ✓ {tag}：涂色 {len(painted)} 格 / 连通 1 块；'
          f'笔刷 固定 {counts["fixedResource"]} · 随机候选 {RANDOM_TOTAL} · 异步 {counts["asyncPvp"]}'
          f' · 关卡 {counts["stage"]}+{counts["boss"]}BOSS')
    print('    占地：' + '，'.join(f'{k} {min(v)}~{max(v)}' for k, v in sorted(sizes.items())))


def validate_with_editor(data: dict) -> None:
    """用编辑器自己的 `normalizeTerritoryMap` 跑一遍；不通过就不落盘。"""
    script = HERE / '_validate_shapes.mjs'
    payload = HERE / '_validate_shapes.json'
    script.write_text(
        "import {readFileSync} from 'node:fs';\n"
        "import {normalizeTerritoryMap} from './formats/territory-format.js';\n"
        "const data = JSON.parse(readFileSync(new URL('./_validate_shapes.json', import.meta.url), 'utf8'));\n"
        "const {map, warnings} = normalizeTerritoryMap(data, data.id);\n"
        "console.log(JSON.stringify({sites: map.sites.length, warnings}));\n",
        encoding='utf-8',
    )
    payload.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    try:
        result = subprocess.run(['node', str(script)], cwd=HERE, capture_output=True, text=True)
        if result.returncode != 0:
            raise SystemExit('编辑器归一化失败：\n' + (result.stderr or result.stdout))
        info = json.loads(result.stdout.strip().splitlines()[-1])
        warnings = [w for w in info['warnings']]
        print(f'    编辑器校验通过（sites {info["sites"]}）'
              + (f'；提醒：{warnings}' if warnings else ''))
    finally:
        script.unlink(missing_ok=True)
        payload.unlink(missing_ok=True)


# ── 预览（网格 + PNG）───────────────────────────────────────────────────────
def ascii_preview(data: dict, chain_ids: list[str]) -> None:
    order = {sid: i for i, sid in enumerate(chain_ids)}
    grid = [['·'] * COLUMNS for _ in range(ROWS)]
    for site in data['sites']:
        if site['id'] in order:
            step = order[site['id']] + 1
            mark = str(step) if step < 10 else 'X'
        elif site['type'] == 'asyncPvp':
            mark = 'A'
        else:
            mark = 'r'
        for cell in site['footprint']:
            row, col = coords_of(cell)
            grid[row][col] = mark
    for cell in data['randomSites']['candidateCells']:
        row, col = coords_of(cell)
        if grid[row][col] == '·':
            grid[row][col] = '?'
    row, col = coords_of(data['startCellId'])
    grid[row][col] = '@'
    print('  数字=链序（X=第 10），A=异步，r=固定资源，?=随机资源，@=出生点，·=空格')
    for r in range(ROWS):
        print('  ' + ' '.join(grid[r]))


def render_preview(data: dict, chain_ids: list[str], out_path: Path) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print('  跳过 PNG 预览：未安装 Pillow')
        return

    scale = 42.0
    radius_px = scale * 0.577
    width = int(COLUMNS * 0.866 * scale + 2 * radius_px + 48)
    height = int((ROWS + 0.5) * scale + 2 * radius_px + 96)
    image = Image.new('RGB', (width, height), (22, 24, 30))
    draw = ImageDraw.Draw(image)

    def font(size: int, bold: bool = False):
        for name in (('arialbd.ttf', 'arial.ttf') if bold else ('arial.ttf',)):
            path = Path('C:/Windows/Fonts') / name
            if path.exists():
                try:
                    return ImageFont.truetype(str(path), size)
                except OSError:
                    pass
        return ImageFont.load_default()

    label_font = font(14, True)
    title_font = font(19, True)
    order = {sid: i for i, sid in enumerate(chain_ids)}
    palette = {
        'stage': (54, 116, 205),
        'boss': (203, 62, 72),
        'asyncPvp': (124, 84, 198),
        'fixedResource': (56, 60, 70),
        'random': (44, 96, 92),
    }
    random_set = set(data['randomSites']['candidateCells'])
    occupied = {cell for site in data['sites'] for cell in site['footprint']}

    def hexagon(cx: float, cy: float, shrink: float = 0.93) -> list[tuple[float, float]]:
        r = radius_px * shrink
        return [(cx + r * math.cos(math.radians(60 * k)),
                 cy + r * math.sin(math.radians(60 * k))) for k in range(6)]

    cx0 = width / 2
    cy0 = height / 2 - 8
    for site in data['sites']:
        for cell in site['footprint']:
            x, y = px(cell)
            draw.polygon(hexagon(cx0 + x * scale, cy0 + y * scale),
                         fill=palette[site['type']], outline=(12, 14, 18))
    for cell in random_set:
        if cell in occupied:
            continue
        x, y = px(cell)
        draw.polygon(hexagon(cx0 + x * scale, cy0 + y * scale),
                     fill=palette['random'], outline=(12, 14, 18))

    sx, sy = px(data['startCellId'])
    draw.ellipse([cx0 + sx * scale - 7, cy0 + sy * scale - 7,
                  cx0 + sx * scale + 7, cy0 + sy * scale + 7], fill=(250, 214, 92))

    centers: list[tuple[float, float]] = []
    for site in data['sites']:
        if site['id'] not in order:
            continue
        xs = [px(c)[0] for c in site['footprint']]
        ys = [px(c)[1] for c in site['footprint']]
        centers.append((cx0 + sum(xs) / len(xs) * scale, cy0 + sum(ys) / len(ys) * scale))
    if len(centers) >= 2:
        draw.line(centers, fill=(250, 214, 92), width=3, joint='curve')
    for site in data['sites']:
        if site['id'] not in order:
            continue
        step = order[site['id']] + 1
        xs = [px(c)[0] for c in site['footprint']]
        ys = [px(c)[1] for c in site['footprint']]
        tx = cx0 + sum(xs) / len(xs) * scale
        ty = cy0 + sum(ys) / len(ys) * scale
        draw.text((tx, ty), str(step), font=label_font, fill=(255, 255, 255),
                  anchor='mm', stroke_width=2, stroke_fill=(10, 10, 12))

    legend = [('关卡', palette['stage']), ('BOSS', palette['boss']),
              ('异步', palette['asyncPvp']), ('资源', palette['fixedResource']),
              ('随机', palette['random'])]
    lx, ly = 20, height - 32
    draw.text((20, 11), f"{data['id']} · {data['name']} · 20×20 · 链路 10011→10020",
              font=title_font, fill=(226, 230, 238))
    for name, color in legend:
        draw.rounded_rectangle([lx, ly, lx + 15, ly + 15], radius=4, fill=color)
        draw.text((lx + 21, ly), name, font=font(12), fill=(196, 202, 214))
        lx += 21 + draw.textlength(name, font=font(12)) + 16

    image.save(out_path)
    print(f'  已写出预览 {out_path.relative_to(HERE)}')


# ── 入口 ────────────────────────────────────────────────────────────────────
def run_one(spec: dict) -> dict:
    print(f"== {spec['id']} · {spec['name']}")
    data, chain_ids = build(spec)
    check(data)
    validate_with_editor(data)
    ascii_preview(data, chain_ids)
    out = PRESET_DIR / f"{spec['id']}.json"
    PRESET_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'  已写出 {out.relative_to(HERE.parent.parent)}')
    render_preview(data, chain_ids, PRESET_DIR / spec['preview'])
    return data


def run_check() -> int:
    failed = 0
    for spec in CHAPTERS:
        path = PRESET_DIR / f"{spec['id']}.json"
        if not path.exists():
            print(f'  ✗ {spec["id"]}：文件不存在')
            failed += 1
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        try:
            check(data)
            validate_with_editor(data)
        except SystemExit as error:
            print(f'  ✗ {error}')
            failed += 1
    print('全部通过' if not failed else f'{failed} 张未通过')
    return 1 if failed else 0


def main() -> None:
    parser = argparse.ArgumentParser(description='按图形批量生成章节领地地图')
    parser.add_argument('--only', help='只做某一章（ch03 / 03 / chapter_03 都行）')
    parser.add_argument('--check', action='store_true', help='只校验已生成的文件')
    args = parser.parse_args()

    if args.check:
        sys.exit(run_check())

    specs = CHAPTERS
    if args.only:
        key = args.only.replace('chapter_', '').replace('ch', '').zfill(2)
        specs = [spec for spec in CHAPTERS if spec['id'].endswith(key)]
        if not specs:
            raise SystemExit(f'没有 {args.only} 这一章')
    random.seed(RNG_SEED)
    for spec in specs:
        run_one(spec)


if __name__ == '__main__':
    main()
