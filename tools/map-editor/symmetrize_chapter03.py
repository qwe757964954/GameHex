# -*- coding: utf-8 -*-
"""把 `chapter_03` 的**随机格**重排成「绕中轴左右对称 + 分布均匀 + 中间不扎堆」。

用户 2026-11-06 第三次（截图红框圈住中间那两列）：

    「做到基于这两列去做左右侧的水平对称（尽可能，且只是随机格，中间不要这么多随机格，
     随机格的分布更均匀一点」

## 为什么"只动随机格"做不到（先说清楚，免得下次又踩）

一格要么是站点 footprint、要么是 `randomSites.candidateCells`，两者互斥，而
**并集必须还是那 300 格**（形状是上一版刚对齐的飞机剖面）。所以「把中间的随机格撤掉」
= 那些格子必须由宝箱顶上 —— 随机格和宝箱是互补的两堆，动一堆必然动另一堆。

因此本脚本动的是**归属**，不是形状：

| 不动 | 动 |
| :--- | :--- |
| 300 格的剖面形状（一格不差） | 234 个可分配格里谁是宝箱、谁是随机格 |
| 链点 / 首领 / 异步据点 / 9 道门 / 起点（66 格） | 112 个宝箱格与 122 个随机格的位置 |
| 站点数量（121 宝箱 + 3 异步 + 10 关卡） | 每个宝箱的 `cellId` / `configId` / `requiredCells` |

## 口径

1. **对称**：以 `u = 9.5` 为中轴（图中红框那两列 `col 9 / col 10` 正好跨在轴上），
   镜像对 `(r, 9−k) ↔ (r, 10+k)`。一对要么都是随机格、要么都是宝箱，否则一侧就破了。
   ⚠️ 六边形是 odd-q 错排列，跨中轴的镜像会让两侧**差半行**（`v = r + 0.5×(col&1)`），
   所以是「每一行各自左右对称」，不是"上下也对称"—— 这是格子本身的性质，不是没做。
2. **中间不扎堆**：`k = 0`（就是那两列）**一律给宝箱**，不做随机格。
3. **均匀**：起点是斜向棋盘 `(r + k) % 2 == 0`（≈50%），再按「离已有随机格最远的先补」
   （farthest-point）补到 122 个 —— 这就是"把最大的空隙先填上"，
   比按行列隔一个排要匀，也不会出现某几列一长串。

用法：

    python tools/map-editor/symmetrize_chapter03.py --dry-run   # 打预览，不写盘
    python tools/map-editor/symmetrize_chapter03.py             # 改预设 + 发布 2 处

脚本是**幂等**的：同一份输入跑几次结果一样（不依赖当前谁是随机格，只看剖面与固定格）。
"""

from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path

import copy_territory_maps as publisher
import presets_io
import randomize_random_sites as randomizer
from fill_chapter03_cells import (
    GATE_COUNT,
    GATE_ID,
    COLUMNS,
    ROWS,
    anchor_cells,
    hex_distance,
    immovable_cells,
    profile_cells,
    render,
)
from territory_format import TerritoryValidationError, validate_territory_map

PRESET = presets_io.ROOT / "presets" / "territory" / "chapter_03.json"
CANDIDATE_TOTAL = 122          # 保持上一版的数量：52（原有）+ 70（新增）
BUILDING_RATIO = 0.85          # 既有 44/52 ≈ 84.6%
SEED = 20261106
MAX_K = COLUMNS // 2 - 1       # 0..9：k = 0 就是中轴那两列


def mirror_pairs(painted: set[int], fixed: set[int]) -> list[dict]:
    """按「离中轴的距离 k」把每行的格子成对切开。

    - `full`：两格都可分配（`cells` 两个）；
    - `half`：只有一侧可分配，另一侧是固定格 / 不在剖面里（`cells` 一个）。
    """
    pairs: list[dict] = []
    for row in range(ROWS):
        for k in range(MAX_K + 1):
            left, right = row * COLUMNS + (9 - k), row * COLUMNS + (10 + k)
            inside = [cell for cell in (left, right) if cell in painted]
            if not inside:
                continue
            free = [cell for cell in inside if cell not in fixed]
            if not free:
                continue
            pairs.append({"row": row, "k": k, "cells": free, "full": len(free) == 2})
    return pairs


def choose_candidates(pairs: list[dict]) -> set[int]:
    """按**每行配额**选格：行内用分层抽样铺开，行与行之间密度一致。

    为什么不是「全局按间隔挑」：那样第 17 行被补到 11/14（79%），第 0~3 行一个没有 —— 用户要的
    「均匀」是**每行差不多同一个密度**（都 ≈ 122/234 ≈ 52%），不是"格子之间间隔一致"。

    每行配额用最大余数法分 122 个名额；行内再把名额摊成"满对（2 格）/ 半对（1 格）"，
    用分层抽样取下标，保证在 k 上均匀铺开（不是从中间开始连着一串）。
    """
    by_row: dict[int, list[dict]] = {}
    for pair in pairs:
        if pair["k"] > 0:                     # k = 0 就是中轴那两列，永远留给宝箱
            by_row.setdefault(pair["row"], []).append(pair)
    for row_pairs in by_row.values():
        row_pairs.sort(key=lambda pair: pair["k"])

    weight = {row: sum(len(pair["cells"]) for pair in row_pairs) for row, row_pairs in by_row.items()}
    total_weight = sum(weight.values())
    exact = {row: value * CANDIDATE_TOTAL / total_weight for row, value in weight.items()}
    quota = {row: int(value) for row, value in exact.items()}
    spare = CANDIDATE_TOTAL - sum(quota.values())
    for row in sorted(by_row, key=lambda r: (exact[r] - quota[r], weight[r]), reverse=True)[:spare]:
        quota[row] += 1

    # 只有满对的行只能取偶数格 ⇒ 把奇数配额减 1，再把名额让给能吃的行
    def has_half(row: int) -> bool:
        return any(not pair["full"] for pair in by_row[row])

    for row in by_row:
        if quota[row] % 2 and not has_half(row) and quota[row] > 0:
            quota[row] -= 1
    deficit = CANDIDATE_TOTAL - sum(quota.values())
    while deficit > 0:
        # ⚠️ 每轮都要重算「谁最缺配额」：按固定的顺序表加，同一个余数最大的行会被一路加到爆
        #    （第一版就把第 11 行从 6 顶到了 11，密度飙到 100%）。
        pool = [row for row in by_row
                if quota[row] + 1 <= weight[row]
                and ((quota[row] + 1) % 2 == 0 or has_half(row))]
        if not pool:
            raise SystemExit(f"配额调不平：还差 {deficit} 格")
        row = max(pool, key=lambda r: (exact[r] - quota[r], weight[r]))
        quota[row] += 1
        deficit -= 1

    chosen: set[int] = set()
    for row, row_pairs in by_row.items():
        want = quota[row]
        fulls = [pair for pair in row_pairs if pair["full"]]
        halves = [pair for pair in row_pairs if not pair["full"]]
        # 满对优先（2 格/对），剩下的用半对（1 格/对）补零头；满对不够时全靠半对
        full_take = min(len(fulls), want // 2)
        half_take = want - full_take * 2
        if half_take > len(halves):
            raise SystemExit(f"第 {row} 行取不满配额 {want}（满对 {len(fulls)} / 半对 {len(halves)}）")

        def spread(pool: list[dict], take: int) -> list[dict]:
            if take <= 0:
                return []
            if take == 1:
                return [pool[len(pool) // 2]]
            return [pool[round((index + 0.5) * len(pool) / take - 0.5)] for index in range(take)]

        picks = spread(fulls, full_take) + spread(halves, half_take)
        if sum(len(pair["cells"]) for pair in picks) != want:
            raise SystemExit(f"第 {row} 行取不满配额 {want}")
        for pair in picks:
            chosen.update(pair["cells"])
    return chosen
    return {cell for pair in pairs if selected(pair, chosen) for cell in pair["cells"]}


def chest_site(site: dict, cell: int, prereq: int) -> dict:
    """把宝箱站点挪到新格子上：`id` / `rewardId` 不变，`cellId` / `configId` / 前置跟着走。"""
    return {
        "id": site["id"],
        "type": site["type"],
        "cellId": cell,
        "footprint": [cell],
        "configId": f"fixedResource_{cell}",
        "buildingId": site.get("buildingId", ""),
        "unlock": {**site["unlock"], "requiredCells": [prereq]},
        "rewardId": site["rewardId"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="把 chapter_03 的随机格重排成左右对称、均匀分布")
    parser.add_argument("--dry-run", action="store_true", help="只打印预览与统计，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布")
    args = parser.parse_args()

    data = json.loads(PRESET.read_text(encoding="utf-8"))
    sites: list[dict] = data["sites"]
    start: int = data["startCellId"]
    random_sites: dict = data["randomSites"]

    fixed = immovable_cells(sites, start)
    painted = profile_cells()
    missing = sorted(set(fixed) - painted)
    if missing:
        raise SystemExit(f"固定格不在剖面里：{missing}")

    assignable = painted - fixed
    gates = [site for site in sites if site["type"] == "fixedResource"
             and (match := GATE_ID.fullmatch(site["id"])) and int(match.group(1)) <= GATE_COUNT]
    chests = [site for site in sites if site["type"] == "fixedResource" and site not in gates]
    if len(chests) + len(gates) != sum(1 for site in sites if site["type"] == "fixedResource"):
        raise SystemExit("固定资源站点分类出错")
    if len(assignable) != len(chests) + CANDIDATE_TOTAL:
        raise SystemExit(f"可分配 {len(assignable)} 格 ≠ 宝箱 {len(chests)} + 随机 {CANDIDATE_TOTAL}")

    pairs = mirror_pairs(painted, fixed)
    candidates = choose_candidates(pairs)
    chest_cells = sorted(assignable - candidates)
    if len(candidates) != CANDIDATE_TOTAL or len(chest_cells) != len(chests):
        raise SystemExit(f"分配对不上：随机 {len(candidates)} / 宝箱格 {len(chest_cells)}")

    # 宝箱怎么配到新格子：就近贪心 —— 让 3 个 `rewardId 1011` 的宝箱待在原地附近，别全打乱
    anchors = anchor_cells(sites)
    pairs_left = [(site["cellId"], site) for site in chests]
    moved: dict[str, dict] = {}
    for cell in chest_cells:
        index = min(range(len(pairs_left)), key=lambda i: (hex_distance(cell, pairs_left[i][0]), i))
        origin, site = pairs_left.pop(index)
        moved[site["id"]] = chest_site(site, cell, min(anchors, key=lambda a: (hex_distance(cell, a), a)))

    data["sites"] = [moved[site["id"]] if site["id"] in moved else site for site in sites]
    data["randomSites"]["candidateCells"] = sorted(candidates)

    # 建筑 ID：还在候选集里的保留，再补到 85%
    rng = random.Random(f"{SEED}:chapter_03:symmetrize")
    pool = [str(value) for value in range(69008, 69016)]
    building_ids = {key: value for key, value in (random_sites.get("buildingIds") or {}).items()
                    if int(key) in candidates}
    quota = round(len(candidates) * BUILDING_RATIO)
    for cell in rng.sample(sorted(candidates - {int(key) for key in building_ids}), max(0, quota - len(building_ids))):
        building_ids[str(cell)] = rng.choice(pool)
    data["randomSites"]["buildingIds"] = {key: building_ids[key] for key in sorted(building_ids, key=int)}

    # 形状体检：搬完之后，站点 + 随机格 + 起点 的并集必须还是同一批 300 格
    after = {x for site in data["sites"] for x in site["footprint"]} | candidates | {start}
    if after != painted:
        raise SystemExit(f"形状变了：多了 {sorted(after - painted)}，少了 {sorted(painted - after)}")

    # 对称体检：每个随机格的镜像只要「也可分配」，就必须也是随机格（镜像落在固定格上不算破）
    mirrored_bad = []
    for cell in sorted(candidates):
        row, col = divmod(cell, COLUMNS)
        mirror = row * COLUMNS + (COLUMNS - 1 - col)
        if mirror in assignable and mirror not in candidates:
            mirrored_bad.append((cell, mirror))
    if mirrored_bad:
        raise SystemExit(f"{len(mirrored_bad)} 个随机格的镜像没同步：{mirrored_bad[:6]}")
    drifted = [site for site in data["sites"] if site["id"] in moved
               and site["unlock"]["requiredCells"][0] not in set(anchors)]
    if drifted:
        raise SystemExit(f"{len(drifted)} 个宝箱的前置不在链点/门里")

    print(f"可分配 {len(assignable)} 格 → 随机 {len(candidates)} + 宝箱 {len(chest_cells)}"
          f"（固定 {len(fixed)} 格不动，形状 {len(painted)} 格不变）")
    print(f"中间两列（col 9/10）的随机格：{sorted(c for c in candidates if c % COLUMNS in (9, 10))}")
    print("每列随机格数：" + " ".join(
        f"{col}:{sum(1 for c in candidates if c % COLUMNS == col)}" for col in range(COLUMNS)))
    print("镜像检查：" + ("全部同步" if not mirrored_bad else f"{len(mirrored_bad)} 处不同步"))
    print(render(data["sites"], set(), set(), data["randomSites"]["candidateCells"], start))

    try:
        validate_territory_map(data, "chapter_03")
    except TerritoryValidationError as error:
        raise SystemExit(f"校验没过：{error}") from error

    if args.dry_run:
        print("\n[dry-run] 没有写盘。")
        return 0

    randomizer.write_preset(PRESET, data, dry_run=False)
    print(f"\n已改预设：{PRESET.relative_to(presets_io.PROJECT)}")
    if args.no_publish:
        print("--no-publish：跳过发布。")
        return 0

    targets, _ = publisher.copy_one(PRESET, dry_run=False)
    print(f"已发布 {len(targets)} 处：{', '.join(str(t) for t in targets)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
