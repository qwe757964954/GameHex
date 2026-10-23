"""生成「笑脸」章节领地地图（`presets/territory/chapter_smile.json`）—— 2026-10-21 第三次改版。

需求（用户 2026-10-21）：
  1. **关卡按顺序解锁**：打过第 1 关 → 中间那些固定/随机资源 → 才激活第 2 关；
  2. **全图格子必须连通**，不能有孤立格；用来把格子连起来的空格放**随机资源**；
  3. 单站点占地：普通关卡 3~8 格、BOSS 6~10 格、异步据点 3~5 格；
  4. 同一站点（多格）的 `configId` 必须一致；战斗 id 用 **10011~10020**，
     其中 **10015 / 10020 是 BOSS**；
  5. 异步据点战斗 id 用 **20005~20008**（当前 3 个紫点 = 20005/20006/20007）；
  6. **顺序相邻的关卡不能隔太远**（本次改版重点）：整条解锁链必须是一条连续的
     行进路线 —— 从下巴出发 → 沿**左脸**上行 → **额头正中 10015** → 顺**右脸**
     下行 → **嘴部正中 10020** 终局；
  7. 紫色据点（异步 PvP）按用户截图的**三个白圈**摆：**左眼 / 右眼 / 脸正中**。

路线（10 个链点，y 向下为正，坐标是 px 空间里相对圆心的偏移）：
      链序  类型    战斗 id   位置
       1    stage   10011    下巴正中      (0.0,  7.1)
       2    stage   10012    左脸颊下      ↑ 逆时针向上
       3    stage   10013    左侧
       4    stage   10014    左脸颊上
       5    BOSS    10015    额头正中      (0.0, -7.1)
       6    stage   10016    右脸颊上      ↓ 顺时针向下
       7    stage   10017    右上
       8    stage   10018    右侧
       9    stage   10019    右下
      10    BOSS    10020    嘴部正中      (0.0,  2.6)

相邻链点的中心间距都被压在 5.5 个格子以内（脚本最后会打印实测值），
不会再出现「第 4 关在这头、第 5 关在那头」的跳跃感。

地盘划分：先按「离哪个链点最近」把圆盘切成 10 块（Voronoi），每个链点只在自己
那块地里长身体 → 相邻两关之间天生留出交界，交界上再挑一格放**固定资源当大门**，
这样既不会互相吃掉，又能保证「打完本关 → 清掉大门 → 下一关开启」。

布局（20×20）：整张脸是一个**填满的圆盘**（天然连通），按功能上色：
  · 圆盘外圈 = 8 个普通关卡 + 1 个额头 BOSS，顺序绕脸一圈；
  · 紫色据点 = 3 个，按白圈放：**左眼 (-2.9,-3.2) / 右眼 (2.9,-3.2) / 脸正中 (0,0)**，
    各自有独立的小地盘（半径 1.95），关卡抢不走，也不会跑出白圈；
  · 嘴 = 终局 BOSS 10020，做成一条**向上开口的弧**（两头高中间低），才像笑脸；
  · 圆盘剩下所有格子 = 固定资源（单格）+ 随机资源候选格，负责把整张图连成一片。

三步把「相邻关卡贴在一起」钉死（脚本最后会打印实测）：
  ① 切地盘（Voronoi）+ 交界预占 → 两块地不会糊成一坨；
  ② 收拢：哪两关隔得远，就从胖的那块往对方补格子，直到只剩 1 格空隙；
  ③ 定门：那一格空隙就是「大门」（固定资源），也是下一关的解锁前置。
实测相邻两关之间恒为「隔 2 格（=中间就那道门）」，中心间距 2.8~5.5。

用法：
    python tools/map-editor/gen_territory_smile.py
"""

from __future__ import annotations

import json
import math
import random
import subprocess
import heapq
from collections import deque
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
OUT = HERE / 'presets' / 'territory' / 'chapter_smile.json'
PREVIEW = HERE / 'presets' / 'territory' / 'chapter_smile-preview.png'

ROWS = 20
COLUMNS = 20
CHAPTER_ID = 5
NAME = '笑脸章'
MAP_ID = 'chapter_smile'

DISC_RADIUS = 8.3          # 脸（圆盘）半径
RING_RADIUS = 7.1          # 关卡环半径
MOUTH_BASE = 2.2           # 嘴的基准 y 偏移（相对圆心）
MOUTH_ARC_HALF = 2.9       # 嘴弧半宽
MOUTH_ARC_TOP = 3.0        # 嘴角高度（两头高）
MOUTH_ARC_DIP = 1.4        # 嘴中间往下沉多少（中间低 → 开口朝上的笑）

# 紫色据点（异步 PvP）的位置：按用户截图里画的三个白圈 —— 左眼 / 右眼 / 脸正中
ASYNC_ANCHORS: list[tuple[float, float]] = [(-2.9, -3.2), (2.9, -3.2), (0.0, 0.0)]
ASYNC_ZONE_RADIUS = 1.95   # 每个紫色据点自己的地盘半径（保证长在圈里，不被关卡抢）

STAGE_COUNT = 8            # 普通关卡数（10011~10020 去掉两个 BOSS）
BOSS_COUNT = 2
STAGE_SIZE = (3, 6)        # 每关格数区间（用户：普通关卡 3~8）
BOSS_SIZE = (7, 9)         # 用户：BOSS 6~10
ASYNC_SIZE = (5, 5)        # 用户：异步 3~5（取 5，正好把白圈填满）
RNG = random.Random(20261021)

# 战斗 id：按链顺序依次分配，第 5、10 个是 BOSS
BATTLE_IDS = [10011, 10012, 10013, 10014, 10015, 10016, 10017, 10018, 10019, 10020]
BOSS_BATTLE_IDS = {10015, 10020}
ASYNC_BATTLE_IDS = [20005, 20006, 20007, 20008]   # 现在用前 3 个；要第 4 个紫点就往 ASYNC_ANCHORS 里加一个锚点

RANDOM_CELL_COUNT = 90     # 随机资源候选格（用户可调）
DEFAULTS = {'combatPower': 0, 'silverCost': 10, 'exploreSeconds': 2, 'staminaCost': 5}
COST = {
    'stage': {'silverCost': 30, 'exploreSeconds': 2, 'staminaCost': 5},
    'boss': {'silverCost': 50, 'exploreSeconds': 4, 'staminaCost': 5},
    'asyncPvp': {'silverCost': 100, 'exploreSeconds': 6, 'staminaCost': 5},
    'fixedResource': {'silverCost': 15, 'exploreSeconds': 1, 'staminaCost': 1},
}

CENTER_U = (COLUMNS - 1) / 2
CENTER_V = (ROWS - 1) / 2

# 嘴弧覆盖的列范围（按列扫，保证弧连通）
MOUTH_COL_LEFT = int(round(CENTER_U - MOUTH_ARC_HALF / 0.866))
MOUTH_COL_RIGHT = int(round(CENTER_U + MOUTH_ARC_HALF / 0.866))


# ── 基础几何 ────────────────────────────────────────────────────────────────
def cell_id(row: int, col: int) -> int:
    return row * COLUMNS + col


def coords_of(cell: int) -> tuple[int, int]:
    return divmod(cell, COLUMNS)


def uv(cell: int) -> tuple[float, float]:
    row, col = coords_of(cell)
    return col, row + 0.5 * (col & 1)


def px(cell: int) -> tuple[float, float]:
    """把格子映射到「近似像素」空间（列按 0.866 压缩），圆才好画。"""
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
    return list(range(ROWS * COLUMNS))


def hex_distance(a: int, b: int) -> int:
    def axial(cell: int) -> tuple[int, int]:
        row, col = coords_of(cell)
        return col, row - (col + (col & 1)) // 2
    aq, ar = axial(a)
    bq, br = axial(b)
    dq, dr = aq - bq, ar - br
    return (abs(dq) + abs(dr) + abs(dq + dr)) // 2


def disc_cells() -> list[int]:
    return [c for c in all_cells() if radius(c) <= DISC_RADIUS]


def seed_near(x: float, y: float, cells: list[int]) -> int:
    return min(cells, key=lambda c: (math.hypot(px(c)[0] - x, px(c)[1] - y), c))


# ── 行进路线：10 个链点 ─────────────────────────────────────────────────────
def ring_point(degrees: float, radius_: float = RING_RADIUS) -> tuple[float, float]:
    rad = math.radians(degrees)
    return radius_ * math.cos(rad), radius_ * math.sin(rad)


# 角度约定：0° = 正右，90° = 正下（下巴），180° = 正左，270° = 正上（额头）。
CHAIN_ANCHORS: list[tuple[float, float]] = [
    ring_point(90.0),            # 1  stage 10011 下巴正中
    ring_point(135.0),           # 2  stage 10012 左脸颊下
    ring_point(180.0),           # 3  stage 10013 左侧
    ring_point(225.0),           # 4  stage 10014 左脸颊上
    ring_point(270.0),           # 5  BOSS  10015 额头正中
    ring_point(306.0),           # 6  stage 10016 右脸颊上
    ring_point(342.0),           # 7  stage 10017 右上
    ring_point(378.0),           # 8  stage 10018 右侧（=18°）
    ring_point(414.0),           # 9  stage 10019 右下（=54°）
    (0.0, MOUTH_BASE + 0.4),     # 10 BOSS  10020 嘴部正中
]

MAX_CHAIN_GAP = 6.6          # 相邻链点中心间距上限（px 空间单位 ≈ 格子数）
MAX_CHAIN_EDGE = 3           # 相邻两关地块之间最多隔几格（中间那道门）


def chain_owner_map(disc: list[int]) -> dict[int, int]:
    """每格归属于「离得最近的那个链点」，用来切地盘。"""
    owner: dict[int, int] = {}
    for cell in disc:
        x, y = px(cell)
        owner[cell] = min(
            range(len(CHAIN_ANCHORS)),
            key=lambda i: (math.hypot(x - CHAIN_ANCHORS[i][0], y - CHAIN_ANCHORS[i][1]), i),
        )
    return owner


def reserve_gates(owner: dict[int, int]) -> dict[int, int]:
    """给每对相邻链点挑一格「大门」（固定资源），返回 {链序: cell}。

    优先挑「在 A 的地盘里、又紧贴 B 的地盘」的交界格，这样大门一定卡在两关中间。
    """
    gates: dict[int, int] = {}
    for index in range(len(CHAIN_ANCHORS) - 1):
        ax, ay = CHAIN_ANCHORS[index]
        bx, by = CHAIN_ANCHORS[index + 1]
        mx, my = (ax + bx) / 2, (ay + by) / 2
        border = [c for c in owner
                  if owner[c] == index
                  and any(owner.get(n) == index + 1 for n in neighbor_cells(c))]
        pool = border or [c for c in owner if owner[c] == index]
        gates[index] = min(pool, key=lambda c: (math.hypot(px(c)[0] - mx, px(c)[1] - my), c))
    return gates


def footprint_gap(a: dict, b: dict) -> int:
    return min(hex_distance(x, y) for x in a['footprint'] for y in b['footprint'])


def tighten_chain(chain: list[dict], disc: set[int], used: set[int],
                  blocked: set[int], caps: dict[str, int]) -> None:
    """把隔得远的相邻两关往对方补格子，直到只剩 1 格空隙（那一格留给大门）。"""
    for index in range(len(chain) - 1):
        a, b = chain[index], chain[index + 1]
        for _ in range(10):
            gap = footprint_gap(a, b)
            if gap <= 2:
                break
            grown = False
            for src, dst in ((a, b), (b, a)):
                if len(src['footprint']) >= caps[src['type']]:
                    continue
                own = set(src['footprint'])
                dst_set = set(dst['footprint'])
                cands = [c for c in disc if c not in used and c not in blocked
                         and any(n in own for n in neighbor_cells(c))]
                if not cands:
                    continue
                best = min(cands, key=lambda c: (min(hex_distance(c, y) for y in dst_set), c))
                if min(hex_distance(best, y) for y in dst_set) >= gap:
                    continue                 # 这一格没能靠近对方，换另一边试
                used.add(best)
                src['footprint'] = sorted(src['footprint'] + [best])
                grown = True
                break
            if not grown:
                break


def separate_chain(chain: list[dict], used: set[int], floors: dict[str, int]) -> None:
    """反过来：万一两块地贴在一起（隔 1 格），从胖的那块摘掉贴着对方的边角料，
    保证中间一定留得下那道门。"""
    for index in range(len(chain) - 1):
        a, b = chain[index], chain[index + 1]
        for _ in range(6):
            if footprint_gap(a, b) >= 2:
                break
            done = False
            for src, dst in ((a, b), (b, a)):
                if len(src['footprint']) <= floors[src['type']]:
                    continue
                dst_set = set(dst['footprint'])
                cands = [c for c in src['footprint']
                         if c != src['cellId']
                         and any(n in dst_set for n in neighbor_cells(c))]
                for drop in sorted(cands):
                    rest = [c for c in src['footprint'] if c != drop]
                    if len(components(rest)) > 1:       # 摘掉会断成两块就跳过
                        continue
                    src['footprint'] = sorted(rest)
                    used.discard(drop)
                    done = True
                    break
                if done:
                    break
            if not done:
                break


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
        gates[index] = min(both or either or list(pool), key=dist)
    return gates


# ── 生长：BFS 保证连通 ──────────────────────────────────────────────────────
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
    """按「离种子最近优先」生长：地块更紧凑，不会沿着狭窄夹缝拉成一条虫。"""
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


def components(cells: list[int]) -> list[list[int]]:
    group = set(cells)
    seen: set[int] = set()
    out: list[list[int]] = []
    for start in cells:
        if start in seen:
            continue
        comp = [start]
        seen.add(start)
        queue = deque([start])
        while queue:
            cell = queue.popleft()
            for nxt in neighbor_cells(cell):
                if nxt in group and nxt not in seen:
                    seen.add(nxt)
                    comp.append(nxt)
                    queue.append(nxt)
        out.append(comp)
    return out


def mouth_blob(disc: set[int], used: set[int], protected: set[int], size: int) -> list[int]:
    """嘴做成一条向上开口的弧（两头高、中间低）：按列从左往右扫，逐列取最贴弧线的格，
    并且保证每一格都和左边那格相邻 —— 这样弧一定连通，左右也不会跑偏。"""
    cells: list[int] = []
    for col in range(MOUTH_COL_LEFT, MOUTH_COL_RIGHT + 1):
        x = (col - CENTER_U) * 0.866
        t = max(-1.0, min(1.0, x / MOUTH_ARC_HALF))
        y = MOUTH_ARC_TOP + MOUTH_ARC_DIP * (1.0 - t * t)
        column = [c for c in disc if coords_of(c)[1] == col
                  and c not in used and c not in protected]
        if not column:
            continue
        if cells:
            adj = [c for c in column if c in neighbor_cells(cells[-1])]
            if adj:
                column = adj
        cells.append(min(column, key=lambda c: (abs(px(c)[1] - y), c)))
    if not cells:
        return []
    for cell in cells:
        used.add(cell)
    if len(cells) < 6:                             # 弧太短就补一点，别补成团
        cells = list(max(components(cells), key=len))
        for cell in cells:
            used.add(cell)
        expand(cells, deque(cells), 6, disc, used, allow=lambda c: c not in protected)
    return cells[:size]


def async_zone(anchor: tuple[float, float], disc: set[int]) -> set[int]:
    ax, ay = anchor
    return {c for c in disc
            if math.hypot(px(c)[0] - ax, px(c)[1] - ay) <= ASYNC_ZONE_RADIUS}


# ── 组表 ────────────────────────────────────────────────────────────────────
def build() -> tuple[dict, list[str]]:
    disc_list = disc_cells()
    disc = set(disc_list)
    start_cell = cell_id(ROWS - 1, COLUMNS // 2)          # 最底下一行正中（下巴下方入口）

    used: set[int] = set()
    sites: list[dict] = []

    def add(site_type: str, cells: list[int], extra: dict | None = None) -> dict:
        cost = COST[site_type]
        site = {
            'id': f'{site_type}_{sum(1 for x in sites if x["type"] == site_type) + 1}',
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
        sites.append(site)
        return site

    def center_of(blob: list[int]) -> tuple[float, float]:
        xs = [px(c)[0] for c in blob]
        ys = [px(c)[1] for c in blob]
        return sum(xs) / len(xs), sum(ys) / len(ys)

    # ① 先切地盘：链点只能在自己那块地里长，两关之间天然留一条交界；
    #    交界那几格先占住，防止两块地粘一起（最后再从中挑一格当大门）。
    owner = chain_owner_map(disc_list)
    border = set(reserve_gates(owner).values())
    protected = set(border)
    for anchor in ASYNC_ANCHORS:                 # 三个白圈里的地盘留给紫色据点
        protected |= async_zone(anchor, disc)

    # ② 先把嘴（笑弧）画出来，免得被下巴两侧的关卡挤歪
    mouth_cells = mouth_blob(disc, used, protected, RNG.randint(*BOSS_SIZE))

    # ③ 按链序长其余 9 个站点（顺序很关键：先长的先占，后面的绕开）
    chain: list[dict] = []
    for index in range(len(CHAIN_ANCHORS)):
        ax, ay = CHAIN_ANCHORS[index]
        own = [c for c in disc_list if owner[c] == index and c not in protected]
        is_boss = BATTLE_IDS[index] in BOSS_BATTLE_IDS
        low, high = BOSS_SIZE if is_boss else STAGE_SIZE
        if index == len(CHAIN_ANCHORS) - 1:
            blob = list(mouth_cells)
        else:
            if not own:
                raise SystemExit(f'第 {index + 1} 个链点没有属于自己的地盘')
            seed = seed_near(ax, ay, own)
            blob = grow_compact(seed, RNG.randint(low, high), disc, used,
                                allow=lambda c, i=index: owner.get(c) == i and c not in protected)
        if len(blob) < low:                       # 地盘被挤窄了就放宽到整张脸
            expand(blob, deque(blob), low, disc, used, allow=lambda c: c not in protected)
        if len(blob) < low:
            raise SystemExit(f'第 {index + 1} 个链点只长出 {len(blob)} 格（< {low}）')

        site_type = 'boss' if is_boss else 'stage'
        site = add(site_type, blob)
        site['configId'] = str(BATTLE_IDS[index])
        chain.append(site)

    # ③ 收拢链路：随机生长会让两块地各自偏一点，这里把「隔得太远」的相邻两关
    #    朝对方补格子，直到只剩一格空隙（那一格就是大门）。补格上限按类型放宽 2 格。
    tighten_chain(chain, disc, used, protected, {'stage': STAGE_SIZE[1] + 2,
                                                 'boss': BOSS_SIZE[1] + 1})
    separate_chain(chain, used, {'stage': STAGE_SIZE[0], 'boss': BOSS_SIZE[0]})

    # ④ 定大门：挑一格「同时贴着前后两关」的空格
    gate_by_pair = pick_gates(chain, disc - used)
    used |= set(gate_by_pair.values())

    # ⑤ 紫色据点（异步 PvP）：按三个白圈的位置放 —— 左眼 / 右眼 / 脸正中，
    #    每个只在自己的小圈子里长，既不抢关卡的地，也不会跑出白圈。
    async_blobs: list[list[int]] = []
    for anchor in ASYNC_ANCHORS:
        zone = async_zone(anchor, disc)
        free = sorted(zone - used)
        if not free:
            raise SystemExit('紫色据点没有可用的格（圈里被占满了）')
        seed = seed_near(*anchor, free)
        blob = grow_compact(seed, RNG.randint(*ASYNC_SIZE), zone, used)
        if len(blob) < ASYNC_SIZE[0]:
            expand(blob, deque(blob), ASYNC_SIZE[0], disc, used)
        async_blobs.append(blob)
    async_sites = [add('asyncPvp', blob, {'configId': str(ASYNC_BATTLE_IDS[i])})
                   for i, blob in enumerate(async_blobs)]

    # ⑥ 大门落表
    gate_sites = [add('fixedResource', [cell],
                      {'configId': f'fixedResource_{cell}', 'rewardId': 1011})
                  for _, cell in sorted(gate_by_pair.items())]

    # ⑦ 盘内剩下的格子：固定资源 + 随机候选（保证整张图连成一片）
    rest = sorted(disc - used, key=lambda c: (radius(c), c))
    random_rest = [cell for index, cell in enumerate(rest) if index % 2 == 0][:RANDOM_CELL_COUNT]
    random_set = set(random_rest)
    fixed_rest = [cell for cell in rest if cell not in random_set]
    for cell in fixed_rest:
        add('fixedResource', [cell], {'configId': f'fixedResource_{cell}', 'rewardId': 1011})

    # 链上站点补过格子，锚点格重新取一下（解锁依赖用的是这个 id）：
    # 取「离地块重心最近」的那一格，这样图标/编号就落在关卡正中间。
    for site in chain:
        cx, cy = center_of(site['footprint'])
        site['cellId'] = min(site['footprint'],
                             key=lambda c: (math.hypot(px(c)[0] - cx, px(c)[1] - cy), c))

    # ⑧ 解锁：链上第 i 个 = 上一个链点 + 它们之间那道门
    for index, site in enumerate(chain):
        if index == 0:
            site['unlock']['requiredCells'] = [start_cell]
            continue
        required = [chain[index - 1]['cellId']]
        if index - 1 < len(gate_sites):
            required.append(gate_sites[index - 1]['cellId'])
        site['unlock']['requiredCells'] = required

    # 门资源自己挂在「它前面那一关」
    gate_ids = {gate['id'] for gate in gate_sites}
    for index, gate in enumerate(gate_sites):
        gate['unlock']['requiredCells'] = [chain[min(index, len(chain) - 1)]['cellId']]

    # 其余站点（异步 / 散点资源）：挂到最近的链上站点
    for site in sites:
        if site in chain or site['id'] in gate_ids:
            continue
        nearest = min(chain, key=lambda other: hex_distance(other['cellId'], site['cellId']))
        site['unlock']['requiredCells'] = [nearest['cellId']]

    data = {
        'version': 1,
        'mapKind': 'territoryChapter',
        'id': MAP_ID,
        'name': NAME,
        'chapterId': CHAPTER_ID,
        'rows': ROWS,
        'columns': COLUMNS,
        'startCellId': start_cell,
        'background': '',
        'defaults': DEFAULTS,
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


# ── 自检输出 ────────────────────────────────────────────────────────────────
def chain_report(chain: list[dict]) -> None:
    print('  链路（中心间距 / 两关地块之间最近隔几格）：')
    gaps = []
    edges = []
    for i in range(len(chain) - 1):
        a = chain[i]
        b = chain[i + 1]
        ax = sum(px(c)[0] for c in a['footprint']) / len(a['footprint'])
        ay = sum(px(c)[1] for c in a['footprint']) / len(a['footprint'])
        bx = sum(px(c)[0] for c in b['footprint']) / len(b['footprint'])
        by = sum(px(c)[1] for c in b['footprint']) / len(b['footprint'])
        gap = math.hypot(ax - bx, ay - by)
        edge = min(hex_distance(x, y) for x in a['footprint'] for y in b['footprint'])
        gaps.append(gap)
        edges.append(edge)
        print(f"    {i + 1:>2} {a['configId']:>6}({a['type'][:4]:<4}) → "
              f"{i + 2:>2} {b['configId']:>6}({b['type'][:4]:<4})  "
              f"中心 {gap:5.2f}   隔 {edge} 格")
    print(f'  最大中心间距 {max(gaps):.2f}（上限 {MAX_CHAIN_GAP}）；'
          f'最大隔格 {max(edges)}（上限 {MAX_CHAIN_EDGE}）')
    if max(gaps) > MAX_CHAIN_GAP or max(edges) > MAX_CHAIN_EDGE:
        raise SystemExit(f'链路出现跳跃：中心 {max(gaps):.2f} / 隔 {max(edges)} 格')


def preview(data: dict, chain_ids: list[str]) -> None:
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
    print('  数字=链序（X=第 10 个），A=异步，r=固定资源，?=随机资源，@=出生点')
    for r in range(ROWS):
        print('  ' + ' '.join(grid[r]))


def render_preview(data: dict, chain_ids: list[str]) -> None:
    """渲染 PNG 预览（和编辑器里看到的一致），方便肉眼检查链路走向。"""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print('  跳过 PNG 预览：未安装 Pillow')
        return

    scale = 46.0
    radius_px = scale * 0.577          # 平顶六边形外接半径
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

    label_font = font(15, True)
    title_font = font(20, True)

    order = {sid: i for i, sid in enumerate(chain_ids)}
    palette = {
        'stage': (54, 116, 205),
        'boss': (203, 62, 72),
        'asyncPvp': (124, 84, 198),
        'fixedResource': (56, 60, 70),
        'random': (44, 96, 92),
    }
    random_set = set(data['randomSites']['candidateCells'])

    def hexagon(cx: float, cy: float, shrink: float = 0.93) -> list[tuple[float, float]]:
        r = radius_px * shrink
        return [(cx + r * math.cos(math.radians(60 * k)),
                 cy + r * math.sin(math.radians(60 * k))) for k in range(6)]

    cx0 = width / 2
    cy0 = height / 2 - 8
    for site in data['sites']:
        for cell in site['footprint']:
            x, y = px(cell)
            color = palette[site['type']]
            outline = (12, 14, 18)
            draw.polygon(hexagon(cx0 + x * scale, cy0 + y * scale), fill=color, outline=outline)
    for cell in random_set:
        row, col = coords_of(cell)
        if any(cell in site['footprint'] for site in data['sites']):
            continue
        x, y = px(cell)
        draw.polygon(hexagon(cx0 + x * scale, cy0 + y * scale), fill=palette['random'],
                     outline=(12, 14, 18))

    # 出生点
    sx, sy = px(data['startCellId'])
    draw.ellipse([cx0 + sx * scale - 8, cy0 + sy * scale - 8,
                  cx0 + sx * scale + 8, cy0 + sy * scale + 8], fill=(250, 214, 92))

    # 链路序号 + 中心连线
    centers: list[tuple[float, float]] = []
    for site in data['sites']:
        if site['id'] not in order:
            continue
        xs = [px(c)[0] for c in site['footprint']]
        ys = [px(c)[1] for c in site['footprint']]
        centers.append((cx0 + sum(xs) / len(xs) * scale, cy0 + sum(ys) / len(ys) * scale))
    if len(centers) >= 2:
        draw.line(centers, fill=(250, 214, 92, 120), width=3, joint='curve')
    for site in data['sites']:
        if site['id'] not in order:
            continue
        step = order[site['id']] + 1
        xs = [px(c)[0] for c in site['footprint']]
        ys = [px(c)[1] for c in site['footprint']]
        tx = cx0 + sum(xs) / len(xs) * scale
        ty = cy0 + sum(ys) / len(ys) * scale
        text = str(step)
        draw.text((tx, ty), text, font=label_font, fill=(255, 255, 255),
                  anchor='mm', stroke_width=2, stroke_fill=(10, 10, 12))
        if site['type'] == 'boss':
            draw.text((tx, ty + 15), site['configId'], font=font(10, True),
                      fill=(255, 214, 214), anchor='mm')

    # 图例
    legend = [('关卡', palette['stage']), ('BOSS', palette['boss']),
              ('异步', palette['asyncPvp']), ('资源', palette['fixedResource']),
              ('随机', palette['random'])]
    lx = 20
    ly = height - 34
    draw.text((20, 12), f"{data['name']}  {ROWS}×{COLUMNS}  链路 10011→10020",
              font=title_font, fill=(226, 230, 238))
    for name, color in legend:
        draw.rounded_rectangle([lx, ly, lx + 16, ly + 16], radius=4, fill=color)
        draw.text((lx + 22, ly + 1), name, font=font(13), fill=(196, 202, 214))
        lx += 22 + draw.textlength(name, font=font(13)) + 18

    image.save(PREVIEW)
    print(f'  已写出预览 {PREVIEW}')


def validate(data: dict) -> None:
    """用编辑器自己的归一化跑一遍；不通过就不落盘。"""
    script = HERE / '_validate_territory.mjs'
    payload = HERE / '_validate_territory.json'
    script.write_text(
        "import {readFileSync} from 'node:fs';\n"
        "import {normalizeTerritoryMap} from './formats/territory-format.js';\n"
        "const data = JSON.parse(readFileSync(new URL('./_validate_territory.json', import.meta.url), 'utf8'));\n"
        "const {map, warnings} = normalizeTerritoryMap(data, 'x');\n"
        "console.log(JSON.stringify({sites: map.sites.length, warnings}));\n",
        encoding='utf-8',
    )
    payload.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    try:
        result = subprocess.run(['node', str(script)], cwd=HERE, capture_output=True, text=True)
        if result.returncode != 0:
            raise SystemExit('校验失败：\n' + (result.stderr or result.stdout))
        print('  校验通过：' + result.stdout.strip())
    finally:
        script.unlink(missing_ok=True)
        payload.unlink(missing_ok=True)


def main() -> None:
    data, chain_ids = build()
    chain = [site for site in data['sites'] if site['id'] in set(chain_ids)]
    chain.sort(key=lambda site: chain_ids.index(site['id']))
    preview(data, chain_ids)
    chain_report(chain)
    validate(data)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    counts: dict[str, int] = {}
    for site in data['sites']:
        counts[site['type']] = counts.get(site['type'], 0) + 1
    print(f'  已写出 {OUT}')
    print(f"  站点 {len(data['sites'])}：{counts}")
    sizes: dict[str, list[int]] = {}
    for site in data['sites']:
        sizes.setdefault(site['type'], []).append(len(site['footprint']))
    for site_type, values in sizes.items():
        print(f'  {site_type} 占地 {min(values)}~{max(values)} 格')
    print(f"  随机候选 {len(data['randomSites']['candidateCells'])} 格")
    render_preview(data, chain_ids)


if __name__ == '__main__':
    main()
