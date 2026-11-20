# -*- coding: utf-8 -*-
"""给 `chapter_02~07` 各加 5 片「巡逻宝箱野怪」地块（参考 `chapter_01`）。

用户 2026-11-11：

    「使用章节地图编辑器 编辑 chapter02~chapter07，每个章节增加 5 关巡逻宝箱野怪地块，
     每关大约 4~6 个地块格子（在主格子上填写巡逻野怪的 id 和装饰宝箱 id 69021，参考
     chapter01），新增的地块可以替代之前旧的随机格，每章最多被替换的随机格不超过 15 个。
     同步在 pvp 关卡表中的章节野怪巡逻宝箱 SHEET，补充章节 2~7 4 个等级的宝箱奖励
     （1/2/3/4 级宝箱对应 1/2/3/7 个随机格的奖励数量，奖励类型需要对应所在章节的随机格奖励）
     新增的地块可以破坏章节原本的形状定义，但是让巡逻野怪的地块相对地图中心点匀称分布」

## 口径

| 项 | 值 | 依据 |
| :-- | :-- | :-- |
| 每章片区数 | 5 | 用户「增加 5 关」 |
| 每片格数 | 4 | 「大约 4~6 个」（`chapter_01` 实测是 4~8） |
| 每片取随机格 | 3 | 5×3 = **15 = 每章替换上限**（用户「不超过 15 个」） |
| 每片新增空地 | 1 | 20 格 − 15 随机格；用户明确允许「破坏原本的形状定义」 |
| `battleId` | 该片所属宝箱组 id（`monsterBox.monsterBoxId`） | `TerritoryCampaignRepository` 按它查 `monsterBoxLevel` |
| `patrolId` | 该宝箱组基础关卡 `levelMonsterGroup` 的**最后一档**（数量 1 的"小 boss"） | 与 `chapter_01` 同字段语义 |
| `buildingId` | 主格 `"69021"`，其余 `""` | `chapter_01` 同款；只有主格长建筑 + 锁 + 银币 |
| `unlock` | 整片共用一个前置格（最近的主线 `stage`/`boss` 格），`0 / 10 / 2 / 5` | `chapter_01` 实测 |

## 为什么 `battleId` 不是 `levelInfo.levelId`

地图上的 `site.battleId` 是**宝箱组 id**（`1001~1005` 之于 `chapter_01`），
`TerritoryCampaignRepository.patrolLevelIdMapOf` 再用它查 `monsterBoxLevel` 才落到关卡。
写错这一跳的表现是：巡逻宝箱「开始挑战」恒灰、点格子弹「站点配置待补齐」，**零报错**。

`chapter_02~07` 的巡逻关卡 `60011~60070`（`levelInfo.levelType == 4`）**表里已经全在了**
（每章 10 条 = 5 片 × 2 档），所以本脚本只需要补 `monsterBox` 的 30 个组（每章 5 组 × 4 级）。

## 工具侧的两个硬约束

1. `randomSites.candidateCells` **不能含已占用格** —— 转成巡逻格后必须同时从
   `candidateCells` 与 `randomSites.buildingIds` 里删掉，否则校验直接报
   `cannot use fixed cell` / `is not a candidate cell`。
2. 一片巡逻区 = **同一个 `site.id` 的多个站点**（`chapter_01` 每格一条站点，
   `footprint: [自己]`），校验器只对 `patrolChest` 放行重复 id，并且要求整片连通。

用法：

    python tools/map-editor/add_patrol_chests.py --preview      # 只画图 + 打印，不写盘
    python tools/map-editor/add_patrol_chests.py --dry-run
    python tools/map-editor/add_patrol_chests.py                # 写预设 + 发布
    python tools/map-editor/add_patrol_chests.py --id chapter_02 --no-publish

⚠️ 幂等：某章已经有 5 片 `patrolChest` 时整章跳过（不会再往里塞）。
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import copy_territory_maps as publisher
import presets_io
from territory_format import TerritoryValidationError, validate_territory_map

SOURCE = publisher.SOURCE
LEVEL_INFO = presets_io.PROJECT / "assets" / "remoteRef" / "levelInfo.json"
MONSTER_BOX = presets_io.PROJECT / "assets" / "remoteRef" / "monsterBox.json"
GRID_REWARD = presets_io.PROJECT / "assets" / "remoteRef" / "levelMapGrideReward.json"
CHAPTER_PATTERN = re.compile(r"chapter_\d{2}")

#: 参与改动的章节（`chapter_01` 是参考模板，不动）。
CHAPTERS = (2, 3, 4, 5, 6, 7)
#: 每章片区数。
GROUPS_PER_CHAPTER = 5
#: 每片格数。
CELLS_PER_GROUP = 4
#: 每章最多替换掉的随机格（用户口径「不超过 15 个」）。
MAX_RANDOM_CELLS_PER_CHAPTER = 15
#: 单片最多吃掉的随机格（一片 4 格，全从随机格里取的情况）。
MAX_RANDOM_CELLS_PER_GROUP = 4
#: 装饰宝箱建筑 id（`chapter_01` 同款）。
CHEST_BUILDING_ID = "69021"
#: 整片共用的解锁参数（`chapter_01` 实测）。
UNLOCK_SILVER = 10
UNLOCK_EXPLORE_SECONDS = 2
UNLOCK_STAMINA = 5
#: `chapter_02` 的第一组宝箱 id（`chapter_01` 用了 `1001~1005`）。
FIRST_MONSTER_BOX_ID = 1006
#: 巡逻关卡起点（`levelInfo.levelType == 4` 的最小 id）。
FIRST_PATROL_LEVEL_ID = 60001
#: 每章巡逻关卡条数（5 片 × 基础/满级两档）。
PATROL_LEVELS_PER_CHAPTER = 10
#: 宝箱 4 个等级分别相当于几个随机格的奖励（用户口径）。
GRADE_RANDOM_CELLS = (1, 2, 3, 7)
#: 「升到这一级」的四列（`chapter_01` 五个组逐行相同，本脚本沿用）。
UP_COST_COLUMNS = (
    (0, 0, 0, 0),
    (20, 90, 2, 99),
    (20, 60, 2, 2),
    (20, 40, 2, 2),
)

# 蜂窝邻居（与 `HexGridLayout.ts` / `territory_format._neighbors` 逐字一致）。
OFF_EVEN = ((-1, 0), (1, 0), (0, -1), (1, -1), (0, 1), (1, 1))
OFF_ODD = ((-1, 0), (1, 0), (0, -1), (-1, -1), (0, 1), (-1, 1))

# 游戏侧格心常量（`HexGridLayout.ts`）。
COLUMN_SPACING = 92.25
ROW_SPACING = 90.0
COLUMN_PHASE = 22.5


# ---------------------------------------------------------------- 几何


def neighbors(cell_id: int, rows: int, columns: int) -> list[int]:
    row, column = divmod(cell_id, columns)
    offsets = OFF_EVEN if column % 2 == 0 else OFF_ODD
    out: list[int] = []
    for dr, dc in offsets:
        nr, nc = row + dr, column + dc
        if 0 <= nr < rows and 0 <= nc < columns:
            out.append(nr * columns + nc)
    return out


def center(cell_id: int, rows: int, columns: int) -> tuple[float, float]:
    row, column = divmod(cell_id, columns)
    x = (column - (columns - 1) / 2) * COLUMN_SPACING
    y = ((rows - 1) / 2 - row) * ROW_SPACING + (COLUMN_PHASE if column % 2 else -COLUMN_PHASE)
    return x, y


def polar(cell_id: int, rows: int, columns: int) -> tuple[float, float]:
    """相对**格网中心**的极坐标：`(半径 px, 角度° y 向上)`。"""
    x, y = center(cell_id, rows, columns)
    return math.hypot(x, y), math.degrees(math.atan2(y, x))


def group_angle(group: list[int], rows: int, columns: int) -> float:
    """一整片的**质心**方向角（度，y 向上）；用来衡量五片是否绕中心匀称。"""
    xs = [center(cell, rows, columns)[0] for cell in group]
    ys = [center(cell, rows, columns)[1] for cell in group]
    return math.degrees(math.atan2(sum(ys) / len(ys), sum(xs) / len(xs)))


def hex_distance(a: int, b: int, rows: int, columns: int) -> int:
    """两格之间的蜂窝步数（BFS，格网小到可以只算一次）。"""
    if a == b:
        return 0
    seen = {a}
    frontier = [a]
    depth = 0
    while frontier:
        depth += 1
        nxt: list[int] = []
        for cell in frontier:
            for near in neighbors(cell, rows, columns):
                if near in seen:
                    continue
                if near == b:
                    return depth
                seen.add(near)
                nxt.append(near)
        frontier = nxt
    return 10 ** 6


# ---------------------------------------------------------------- 表读取


def read_column_store(path: Path) -> tuple[list[str], list[list[Any]]]:
    """读 `{c:1,k:[…],v:[[…]]}` 列存 json（`assets/remoteRef` 那套）。"""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("c") != 1:
        raise SystemExit(f"{path.name} 不是列存格式（c != 1）")
    return list(raw["k"]), [list(row) for row in raw.get("v") or []]


def load_patrol_levels() -> dict[int, dict[str, Any]]:
    """`levelId → {chapter, monsters:[monsterId…]}`，只收 `levelType == 4`（领地巡逻）。"""
    keys, rows = read_column_store(LEVEL_INFO)
    idx = {key: i for i, key in enumerate(keys)}
    out: dict[int, dict[str, Any]] = {}
    for row in rows:
        if row[idx["levelType"]] != 4:
            continue
        groups = row[idx["levelMonsterGroup"]] or []
        monsters = [int(item.get("monsterId") or 0) for item in groups if isinstance(item, dict)]
        out[int(row[idx["levelId"]])] = {
            "chapter": int(row[idx["levelChapter"]]),
            "monsters": monsters,
        }
    return out


def load_random_pools() -> dict[int, list[dict[str, int]]]:
    """`rewardId → 奖励条目列表`（`levelMapGrideReward`，即「随机格奖励池」）。"""
    keys, rows = read_column_store(GRID_REWARD)
    idx = {key: i for i, key in enumerate(keys)}
    out: dict[int, list[dict[str, int]]] = {}
    for row in rows:
        entries: list[dict[str, int]] = []
        for item in row[idx["rewardGroup"]] or []:
            if not isinstance(item, dict):
                continue
            entries.append({
                "resId": int(item.get("resId") or 0),
                "number": int(item.get("number") or 0),
                "pro": int(item.get("pro") or 0),
            })
        out[int(row[idx["rewardId"]])] = entries
    return out


# ---------------------------------------------------------------- 选点


def free_cells(data: dict[str, Any]) -> tuple[set[int], set[int], set[int]]:
    """`(已占用, 随机格, 空地)` 三分；空地 = 没被任何站点 `footprint` 占、不是起点。"""
    rows, columns = data["rows"], data["columns"]
    covered: set[int] = set()
    for site in data["sites"]:
        covered.update(site["footprint"])
    candidates = set(data["randomSites"]["candidateCells"])
    start = data["startCellId"]
    voids = {
        cell for cell in range(rows * columns)
        if cell not in covered and cell not in candidates and cell != start
    }
    return covered, candidates, voids


def build_cluster(
    seed: int,
    data: dict[str, Any],
    covered: set[int],
    candidates: set[int],
    voids: set[int],
    quota: int,
) -> list[int] | None:
    """从 `seed` 长成一片 `CELLS_PER_GROUP` 格的连通地块。

    每步只在「与已选格相邻」的可用格里挑，优先序：
    **随机格（最多 `quota` 个）→ 贴着岛的格 → 离地图中心近 → 编号小**。
    逐格保证连通（按 BFS 层序取点会有"选了一格却没选它的通路"的坑）。

    `quota` 是「这片最多吃掉几个随机格」：整章 5 片 × 3 = 15，正好卡用户给的上限；
    凑不满时用边缘空地补（用户明确允许破坏原形状）。
    """
    rows, columns = data["rows"], data["columns"]
    picked = [seed]
    used_candidates = 1 if seed in candidates else 0
    while len(picked) < CELLS_PER_GROUP:
        options: list[int] = []
        for cell in (candidates | voids):
            if cell in picked:
                continue
            if cell in candidates and used_candidates >= quota:
                continue
            if not any(near in picked for near in neighbors(cell, rows, columns)):
                continue
            options.append(cell)
        if not options:
            return None
        options.sort(key=lambda cell: (
            0 if cell in candidates else 1,
            0 if any(near in covered for near in neighbors(cell, rows, columns)) else 1,
            polar(cell, rows, columns)[0],
            cell,
        ))
        chosen = options[0]
        picked.append(chosen)
        if chosen in candidates:
            used_candidates += 1
    return picked


def choose_groups(data: dict[str, Any]) -> list[list[int]]:
    """返回 5 片互不相邻的巡逻地块：绕地图中心尽量五等分、半径尽量一致。

    两步走：

    1. **枚举**：每个可用格当种子长一次（`build_cluster`，配额 3/2/1/0 各试一遍），
       得到全部可行片；种子既可以是随机格，也可以是**贴着岛的边缘空地**
       （`chapter_04~07` 的岛是十字形，随机格够不到空地，只靠随机格当种子凑不出 5 片）。
    2. **挑 5 片**：把 360° 切成 5 个扇区，每扇区挑「方向最贴扇区中线 → 半径最接近中位数」
       的一片，扇区边界以 9° 步长转 8 次，取**最小夹角最大**的那一轮。
    """
    rows, columns = data["rows"], data["columns"]
    covered, candidates, voids = free_cells(data)
    if not voids:
        raise SystemExit(f"{data['id']}: 一个空地都没有，5 片巡逻区无处可落")

    seeds = sorted(
        cell for cell in (candidates | voids)
        if cell in candidates
        or any(near in covered for near in neighbors(cell, rows, columns))
    )
    feasible: list[dict[str, Any]] = []
    seen: set[tuple[int, ...]] = set()
    for seed in seeds:
        for quota in range(MAX_RANDOM_CELLS_PER_GROUP, -1, -1):
            cells = build_cluster(seed, data, covered, candidates, voids, quota)
            if cells is None:
                continue
            key = tuple(sorted(cells))
            if key in seen:
                continue
            seen.add(key)
            radii = [polar(cell, rows, columns)[0] for cell in cells]
            feasible.append({
                "cells": list(key),
                "angle": group_angle(cells, rows, columns),
                "radius": sum(radii) / len(radii),
                "used": sum(1 for cell in cells if cell in candidates),
            })
    if len(feasible) < GROUPS_PER_CHAPTER:
        raise SystemExit(f"{data['id']}: 只能长出 {len(feasible)} 片巡逻地块，凑不出 {GROUPS_PER_CHAPTER} 片")

    radii = sorted(item["radius"] for item in feasible)
    median_radius = radii[len(radii) // 2]
    sector_width = 360 / GROUPS_PER_CHAPTER
    expanded = {
        index: set(item["cells"]) | {near for cell in item["cells"] for near in neighbors(cell, rows, columns)}
        for index, item in enumerate(feasible)
    }

    def clash(a: int, b: int) -> bool:
        """片与片之间至少隔一格：贴一起会读成"一大片"，主格建筑也只有一栋。"""
        return bool(set(feasible[a]["cells"]) & expanded[b])

    def sector_lists(offset: float) -> list[list[int]]:
        """每个 72° 扇区里按「吃掉随机格多 → 半径接近中位数 → 方向贴中线」排好的备选。"""
        buckets: list[list[int]] = [[] for _ in range(GROUPS_PER_CHAPTER)]
        for index, item in enumerate(feasible):
            angle = (item["angle"] - offset) % 360
            buckets[min(int(angle // sector_width), GROUPS_PER_CHAPTER - 1)].append(index)

        def key(index: int) -> tuple[int, float, float, int]:
            item = feasible[index]
            angle = (item["angle"] - offset) % 360
            sector = min(int(angle // sector_width), GROUPS_PER_CHAPTER - 1)
            drift = abs((angle - (sector * sector_width + sector_width / 2) + 180) % 360 - 180)
            return -item["used"], abs(item["radius"] - median_radius), drift, min(item["cells"])

        # 每个扇区留一小把备选：**按吃掉随机格的数量分档各留 2 个**，
        # 不能只取 used 最大的 6 个 —— 那样 5 个扇区全是 4 格随机格，合计 20 直接撞破 15 的上限。
        trimmed: list[list[int]] = []
        for bucket in buckets:
            bucket.sort(key=key)
            picked: list[int] = []
            per_used: dict[int, int] = {}
            for index in bucket:
                used = feasible[index]["used"]
                if per_used.get(used, 0) >= 2:
                    continue
                per_used[used] = per_used.get(used, 0) + 1
                picked.append(index)
                if len(picked) >= 8:
                    break
            trimmed.append(picked)
        return trimmed

    combos: list[tuple[float, int, float, tuple[int, ...]]] = []
    for step in range(8):
        buckets = sector_lists(step * 9)
        if any(not bucket for bucket in buckets):
            continue
        for combo in itertools.product(*buckets):
            used = sum(feasible[index]["used"] for index in combo)
            if used > MAX_RANDOM_CELLS_PER_CHAPTER:
                continue
            if any(clash(combo[i], combo[j]) for i in range(len(combo)) for j in range(i + 1, len(combo))):
                continue
            angles = sorted(feasible[index]["angle"] for index in combo)
            gaps = [(angles[(i + 1) % GROUPS_PER_CHAPTER] - angles[i]) % 360 for i in range(GROUPS_PER_CHAPTER)]
            radii_used = [feasible[index]["radius"] for index in combo]
            combos.append((min(gaps), used, max(radii_used) - min(radii_used), combo))
    if not combos:
        raise SystemExit(f"{data['id']}: 5 片凑不齐（可行片 {len(feasible)}）")
    # 两步定案：先看**最匀称**能到多少度（`72°` 是五等分上限），再在这个值下面让 10° 余量，
    # 余量内挑吃掉随机格最多的那组 —— 用户既要"匀称分布"，也要"替代旧的随机格"。
    best_gap = max(item[0] for item in combos)
    winner = max(
        (item for item in combos if item[0] >= best_gap - 10),
        key=lambda item: (item[1], item[0], -item[2]),
    )
    choose_groups.last_spread = (round(best_gap, 1), round(winner[0], 1))
    best = winner[3]
    return [list(feasible[index]["cells"]) for index in best]


# ---------------------------------------------------------------- 站点


def next_site_serial(data: dict[str, Any]) -> int:
    """沿用编辑器「建点顺序」编号：取全图所有 `xxx_<N>` 里最大的 N 再 +1。"""
    biggest = 0
    for site in data["sites"]:
        matched = re.fullmatch(r"[A-Za-z]+_(\d+)", str(site["id"]))
        if matched:
            biggest = max(biggest, int(matched.group(1)))
    return biggest + 1


def main_story_cell(data: dict[str, Any], cells: list[int]) -> int:
    """整片共用的前置格 = 离本片最近的主线格（`stage` 优先，其次 `boss`）。

    `chapter_01` 五片同样只挂一个前置格，落在 `stage_8 / stage_9 / boss_109 / fixedResource_2` 上。
    指向 `fixedResource` 会被 `isPrerequisiteComplete` 的「可解锁即完成」特例放大，
    所以这里优先挑 `stage` / `boss`；只有整章没有主线格时才退回任意站点。
    """
    rows, columns = data["rows"], data["columns"]
    def nearest(types: set[str]) -> tuple[int, int] | None:
        best: tuple[int, int] | None = None
        for site in data["sites"]:
            if site["type"] not in types:
                continue
            distance = min(hex_distance(cell, site["cellId"], rows, columns) for cell in cells)
            if best is None or distance < best[0] or (distance == best[0] and site["cellId"] < best[1]):
                best = (distance, site["cellId"])
        return best

    for types in ({"stage"}, {"stage", "boss"}, {"stage", "boss", "asyncPvp"}, {"stage", "boss", "asyncPvp", "fixedResource"}):
        found = nearest(types)
        if found is not None:
            return found[1]
    raise SystemExit(f"{data['id']}: 整章没有任何可当前置的站点")


def build_sites(
    data: dict[str, Any],
    groups: list[list[int]],
    chapter: int,
    patrol_levels: dict[int, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """生成站点 + 返回「本片用到的宝箱组」清单（供 `monsterBox` 同步）。"""
    serial = next_site_serial(data)
    sites: list[dict[str, Any]] = []
    boxes: list[dict[str, Any]] = []
    for index, cells in enumerate(groups):
        box_id = FIRST_MONSTER_BOX_ID + (chapter - CHAPTERS[0]) * GROUPS_PER_CHAPTER + index
        base_level = FIRST_PATROL_LEVEL_ID + (chapter - 1) * PATROL_LEVELS_PER_CHAPTER + index * 2
        level = patrol_levels.get(base_level)
        if level is None:
            raise SystemExit(f"chapter {chapter}: 巡逻关卡 {base_level} 不在 levelInfo 里")
        patrol_id = level["monsters"][-1] if level["monsters"] else 0
        if patrol_id <= 0:
            raise SystemExit(f"chapter {chapter}: 关卡 {base_level} 没有 levelMonsterGroup")

        # 主格 = 片内「邻居最多」的那个（形状中心），同票取编号小的，保证可复现。
        member = set(cells)
        anchor = min(
            cells,
            key=lambda cell: (
                -sum(1 for near in neighbors(cell, data["rows"], data["columns"]) if near in member),
                cell,
            ),
        )
        required = main_story_cell(data, cells)
        site_id = f"patrolChest_{serial + index}"
        for cell in cells:
            site: dict[str, Any] = {
                "id": site_id,
                "type": "patrolChest",
                "cellId": cell,
                "footprint": [cell],
                "battleId": box_id,
                "buildingId": CHEST_BUILDING_ID if cell == anchor else "",
                "unlock": {
                    "requiredCells": [required],
                    "combatPower": 0,
                    "silverCost": UNLOCK_SILVER,
                    "exploreSeconds": UNLOCK_EXPLORE_SECONDS,
                    "staminaCost": UNLOCK_STAMINA,
                },
            }
            if cell == anchor:
                site["patrolId"] = patrol_id
            sites.append(site)
        boxes.append({
            "monsterBoxId": box_id,
            "patrolId": patrol_id,
            "baseLevel": base_level,
            "maxLevel": base_level + 1,
            "siteId": site_id,
            "cells": cells,
        })
    return sites, boxes


# ---------------------------------------------------------------- 写盘


def apply(data: dict[str, Any], chapter: int, patrol_levels: dict[int, dict[str, Any]]) -> dict[str, Any]:
    """返回改好的深拷贝 + 打出摘要（不改入参）。"""
    existing = [site for site in data["sites"] if site["type"] == "patrolChest"]
    if existing:
        raise SystemExit(
            f"{data['id']}: 已经有 {len(existing)} 个 patrolChest 格，本脚本不重复添加"
        )
    groups = choose_groups(data)
    sites, boxes = build_sites(data, groups, chapter, patrol_levels)

    converted = {cell for group in groups for cell in group}
    candidates = list(data["randomSites"]["candidateCells"])
    building_ids = dict(data["randomSites"].get("buildingIds") or {})
    replaced = [cell for cell in candidates if cell in converted]
    remaining = [cell for cell in candidates if cell not in converted]
    for cell in replaced:
        building_ids.pop(str(cell), None)

    data["sites"] = [*data["sites"], *sites]
    data["randomSites"]["candidateCells"] = remaining
    if building_ids:
        data["randomSites"]["buildingIds"] = {key: building_ids[key] for key in sorted(building_ids, key=int)}
    else:
        data["randomSites"].pop("buildingIds", None)
    data["_patrolReport"] = {"groups": groups, "boxes": boxes, "replaced": replaced, "added": sorted(converted - set(replaced))}
    return data


def write_preset(path: Path, normalized: dict[str, Any]) -> None:
    payload = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)


# ---------------------------------------------------------------- 预览


def render(chapter: int, before: dict[str, Any], after: dict[str, Any], report: dict[str, Any], out: Path) -> None:
    """画「改前 / 改后」对照图（纯 PIL，坐标用游戏真实格心）。"""
    from PIL import Image, ImageDraw

    rows, columns = before["rows"], before["columns"]
    scale = 0.55
    width, height = int(columns * COLUMN_SPACING * scale) + 80, int(rows * ROW_SPACING * scale) + 80
    image = Image.new("RGB", (width * 2, height), (24, 26, 32))
    draw = ImageDraw.Draw(image)

    def cell_px(cell: int, offset: int) -> tuple[float, float]:
        x, y = center(cell, rows, columns)
        return (offset + width / 2 + x * scale, height / 2 - y * scale)

    def paint(payload: dict[str, Any], offset: int, title_lines: list[str]) -> None:
        covered: set[int] = set()
        for site in payload["sites"]:
            covered.update(site["footprint"])
        candidates = set(payload["randomSites"]["candidateCells"])
        radius = COLUMN_SPACING * scale * 0.52
        for cell in range(rows * columns):
            x, y = cell_px(cell, offset)
            if cell in covered:
                fill, outline = (92, 104, 120), (54, 60, 70)
            elif cell in candidates:
                fill, outline = (58, 74, 96), (40, 52, 66)
            else:
                continue
            draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=fill, outline=outline)
        for site in payload["sites"]:
            if site["type"] != "patrolChest":
                continue
            x, y = cell_px(site["cellId"], offset)
            is_anchor = bool(site.get("patrolId"))
            draw.ellipse(
                [x - radius, y - radius, x + radius, y + radius],
                fill=(226, 108, 96) if is_anchor else (196, 148, 92),
                outline=(255, 214, 130) if is_anchor else (140, 104, 62),
            )
        # 中心十字 + 半径圈：方便看「相对中心匀称」
        cx, cy = offset + width / 2, height / 2
        draw.line([cx - 12, cy, cx + 12, cy], fill=(120, 128, 140), width=1)
        draw.line([cx, cy - 12, cx, cy + 12], fill=(120, 128, 140), width=1)
        for ring in (400, 700, 900):
            draw.ellipse(
                [cx - ring * scale, cy - ring * scale, cx + ring * scale, cy + ring * scale],
                outline=(56, 60, 68),
            )
        for i, line in enumerate(title_lines):
            draw.text((offset + 12, 12 + i * 14), line, fill=(210, 216, 226))

    paint(before, 0, [f"chapter_0{chapter} before", f"sites={len(before['sites'])} cand={len(before['randomSites']['candidateCells'])}"])
    paint(after, width, [
        f"chapter_0{chapter} after",
        f"sites={len(after['sites'])} cand={len(after['randomSites']['candidateCells'])}",
        f"replaced={len(report['replaced'])} added={len(report['added'])}",
    ])
    draw.line([width, 0, width, height], fill=(48, 52, 60), width=1)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)


def ascii_map(data: dict[str, Any]) -> str:
    rows, columns = data["rows"], data["columns"]
    grid = [["·"] * columns for _ in range(rows)]
    covered: set[int] = set()
    for site in data["sites"]:
        covered.update(site["footprint"])
    for cell in covered:
        grid[cell // columns][cell % columns] = "#"
    for cell in data["randomSites"]["candidateCells"]:
        grid[cell // columns][cell % columns] = "o"
    grid[data["startCellId"] // columns][data["startCellId"] % columns] = "S"
    for site in data["sites"]:
        if site["type"] != "patrolChest":
            continue
        grid[site["cellId"] // columns][site["cellId"] % columns] = "P" if site.get("patrolId") else "p"
    return "\n".join("".join(line) for line in grid)


def main() -> int:
    parser = argparse.ArgumentParser(description="给 chapter_02~07 各加 5 片巡逻宝箱野怪地块")
    parser.add_argument("--id", action="append", dest="ids", help="只处理这些预设 id（可重复）")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布到资源目录 / 策划 JSON")
    parser.add_argument("--preview", action="store_true", help="额外输出 tmp/patrol_preview_*.png 对照图")
    args = parser.parse_args()

    patrol_levels = load_patrol_levels()
    names = args.ids or [f"chapter_0{chapter}" for chapter in CHAPTERS]
    paths = [SOURCE / f"{name}.json" for name in names]
    for path in paths:
        if not path.exists() or not CHAPTER_PATTERN.fullmatch(path.stem):
            raise SystemExit(f"预设不存在或不是章节图：{path}")

    for path in paths:
        chapter = int(path.stem.split("_")[1])
        before = json.loads(path.read_text(encoding="utf-8"))
        data = json.loads(path.read_text(encoding="utf-8"))
        try:
            apply(data, chapter, patrol_levels)
        except SystemExit as error:
            print(f"{path.stem}: {error}")
            continue
        report = data.pop("_patrolReport")
        try:
            normalized, warnings = validate_territory_map(data, path.stem)
        except TerritoryValidationError as error:
            print(f"{path.stem}: 校验没过 → {error}")
            return 1

        print(f"\n=== {path.stem}")
        spread = getattr(choose_groups, "last_spread", None)
        spread_text = f"  方位角最小间隔 {spread[1]}°（上限 {spread[0]}°）" if spread else ""
        print(f"  片数 {len(report['groups'])}  替换随机格 {len(report['replaced'])}  新增空地 {len(report['added'])}{spread_text}")
        for box in report["boxes"]:
            print(
                f"  {box['siteId']:<16} cells={box['cells']} "
                f"box={box['monsterBoxId']} patrol={box['patrolId']} "
                f"level {box['baseLevel']}/{box['maxLevel']}"
            )
        for warning in warnings:
            print(f"  ⚠️ {warning}")
        if args.preview:
            preview = presets_io.PROJECT / "tmp" / f"patrol_preview_{path.stem}.png"
            render(chapter, before, normalized, report, preview)
            print(ascii_map(normalized))
            print(f"  预览图 {preview}")
        if args.dry_run:
            continue
        write_preset(path, normalized)
        if not args.no_publish:
            targets, publish_warnings = publisher.copy_one(path, dry_run=False)
            for warning in publish_warnings:
                print(f"  ⚠️ {warning}")
            print(f"  已发布 {len(targets)} 处")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
