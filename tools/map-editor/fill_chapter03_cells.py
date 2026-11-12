# -*- coding: utf-8 -*-
"""给 `chapter_03` 补 **70 个固定资源格 + 70 个随机候选格**（不碰顺序逻辑）。

用户 2026-11-06：

    「使用章节地图编辑器，给 chapter03 增加 70 个固定格子，以及 70 个随机格子，
     不能改变顺序逻辑，可以填充形状的空白处」

当天第二次：

    「调整随机格的位置，让图形更对称，贴近飞机的形状」（附截图，红笔描了一架后掠翼飞机：
     机头在顶部中线收尖、翼尖顶到左右边缘、尾巴在底部收窄）

## 一、形状从哪来：先定**剖面**，再往里塞格子

`gen_territory_shapes.py` 的配额是**算满**的：

    160（涂色）= 44（10 个链点）+ 3×4（异步据点）+ 51（固定资源，含 9 道门）+ 52（随机候选）+ 1（出生点）

所以这 160 格里一格空位都没有，只能往外吃。第一版用「从现有涂色区均匀外扩」，
结果**第 0~6 行和 16~19 行被撑成了矩形** —— 用户看图说"不像飞机"。

现在的口径是**先给一个后掠翼剖面** `PROFILE_H`（每行左边缩进 `L`，区间 `[L, 19-L]`，
左右对称），再取 `剖面 − 现有涂色格` 当新增的 140 格：

| 行 | 缩进 | 宽度 | 含义 |
| ---: | ---: | ---: | :--- |
| 0 | 8 | 4 | 机头（收尖） |
| 1~7 | 7→1 | 6→18 | 前缘后掠（每行各扩 2 格） |
| 8~15 | 0 | 20 | 主翼满幅 |
| 16~19 | 2,3,4,5 | 16,14,12,10 | 尾巴收窄 |

为什么 8~15 行必须满幅：`asyncPvp_2` 在 (13,1)(14,0)(14,1)(15,0)、`asyncPvp_1` 在
(13,19)(14,17~19)、`asyncPvp_3` 在 (10,18)(10,19)(11,18)(11,19) —— 左右两侧的翼尖是
**链上固定站点**，左右都要够到边缘，中间那几行就只能满幅。这 6 行 = 120 格，是剖面的硬底座。

剖面总格数正好 300 = 160（现有）+ **140（新增）**，且经断言确认「现有 160 格 + 66 个不可动格
（链点 44 + 异步 12 + 9 道门 + 起点）全在剖面内」，所以 `剖面 − 现有 = 140` 一格不多不少，
新增的 70 宝箱 + 70 随机格正好填满。

## 二、三条不动的红线（用户：「不能改变顺序逻辑」）

1. 既有 64 个站点的 `cellId` / `footprint` / `unlock.requiredCells` **一个字节都不改**；
2. 9 道门（`fixedResource_1..9`，夹在相邻链点之间）不挪、不改前置；
3. 新增宝箱只**追加在 `sites` 末尾**（`fixedResource_52…`），既有数组顺序原样保留 ——
   运行时的 `stageById` / 「书写顺序」提示都靠这个顺序。

## 三、前置怎么给

既有 51 个宝箱的前置**全部是链点或门**（例：`fixedResource_51` at 260 ← `246`），
没有一个是"宝箱挂宝箱"。新增的照抄这个口径：前置 = **最近的链点/门**（`hex_distance` 最小，
同距取 cellId 小的），既不会自指、不会成环、也不会把 70 个新格子串成一条"宝箱依赖链"。

## 四、随机格

`randomSites.candidateCells` 追加 70 格（都落在剖面内），原有 52 格原样保留；`buildingIds`
按既有比例（`44/52 ≈ 85%`）给新格补，池子还是 `69008-69015`，保证新旧格看起来是一张图。

用法：

    python tools/map-editor/fill_chapter03_cells.py --dry-run     # 看 ASCII 预览 + 统计，不写盘
    python tools/map-editor/fill_chapter03_cells.py               # 改预设 + 发布资源目录与策划 JSON
    python tools/map-editor/fill_chapter03_cells.py --no-publish  # 只改预设

⚠️ 重跑**不是幂等**的：`sites` 会再追加 70 个。要重来先从
`tools/map-editor/backups/chapter_03.pre-fill140-20261106.preset.json` 还原。
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
from territory_format import TerritoryValidationError, validate_territory_map

ROWS = COLUMNS = 20
TOTAL = ROWS * COLUMNS
PRESET = presets_io.ROOT / "presets" / "territory" / "chapter_03.json"

CHAIN_TYPES = ("stage", "boss")
GATE_ID = re.compile(r"fixedResource_(\d+)")
GATE_COUNT = 9                 # 相邻链点之间的门 = CHAIN_COUNT - 1

FIXED_ADD = 70
RANDOM_ADD = 70
SEED = 20261106

REWARD_ID = 1014               # 既有 51 个宝箱里 48 个是 1014，新增一律照它
                               # ⚠️ 2026-11-06 起 chapter_03 已改成 1018（= 1015 + 章序），
                               #    再跑本脚本会把奖励 id 打回 1014 ⇒ 跑完补
                               #    `retarget_chapter_rewards.py --id chapter_03`。
FIXED_COST = {"silverCost": 15, "exploreSeconds": 1, "staminaCost": 1}   # = gen 的 COST.fixedResource

BUILDING_IDS = (69008, 69015)
BUILDING_RATIO = 0.85          # 既有 44/52 ≈ 84.6%

# ── 后掠翼剖面：每行左边界（右边镜像到 `19 - L`）──────────────────────────────
# 机头 4 格收尖 → 每行各扩 2 格（≈45° 后掠前缘）→ 主翼满幅 → 尾巴 16/14/12/10 收窄。
# Σ L = 50 ⇒ 总格数 = 400 − 2×50 = 300 = 160（现有）+ 140（新增）。
# ⚠️ 第 8~15 行必须 0（满幅）：左右翼尖是链上的 asyncPvp 站点，见模块注释「一」。
PROFILE_H = (8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 4, 5)


# ── 几何（与 `territory_format.py` / `gen_territory_shapes.py` 逐格一致）──────────
def coords_of(cell: int) -> tuple[int, int]:
    return divmod(cell, COLUMNS)


def cell_id(row: int, col: int) -> int:
    return row * COLUMNS + col


def neighbors(cell: int) -> list[int]:
    row, col = coords_of(cell)
    offsets = ([[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] if col % 2 == 0
               else [[-1, 0], [1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]])
    out = []
    for dr, dc in offsets:
        r, c = row + dr, col + dc
        if 0 <= r < ROWS and 0 <= c < COLUMNS:
            out.append(cell_id(r, c))
    return out


def hex_distance(a: int, b: int) -> int:
    def axial(cell: int) -> tuple[int, int]:
        row, col = coords_of(cell)
        return col, row - (col + (col & 1)) // 2

    aq, ar = axial(a)
    bq, br = axial(b)
    dq, dr = aq - bq, ar - br
    return (abs(dq) + abs(dr) + abs(dq + dr)) // 2


# ── 上游锚点池 ────────────────────────────────────────────────────────────────
def anchor_cells(sites: list[dict]) -> list[int]:
    """链点（`stage` / `boss`）+ 9 道门。新增宝箱的前置只从这里挑，见模块注释第 4 节。"""
    anchors = [site["cellId"] for site in sites if site["type"] in CHAIN_TYPES]
    gates = []
    for site in sites:
        if site["type"] != "fixedResource":
            continue
        match = GATE_ID.fullmatch(site["id"])
        if match and int(match.group(1)) <= GATE_COUNT:
            gates.append(site["cellId"])
    if len(gates) != GATE_COUNT:
        raise SystemExit(f"门（fixedResource_1..{GATE_COUNT}）找到 {len(gates)} 个，预期 {GATE_COUNT} 个")
    return anchors + gates


# ── 剖面选格 ──────────────────────────────────────────────────────────────────
def profile_cells(profile: tuple[int, ...] = PROFILE_H) -> set[int]:
    """剖面包住的全部格子：第 r 行 = `[L(r), 19 − L(r)]`（左右对称，中间都是实心）。"""
    if len(profile) != ROWS:
        raise SystemExit(f"剖面要 {ROWS} 行，给了 {len(profile)} 行")
    cells: set[int] = set()
    for row, inset in enumerate(profile):
        for column in range(inset, COLUMNS - inset):
            cells.add(cell_id(row, column))
    return cells


def immovable_cells(sites: list[dict], start: int) -> set[int]:
    """**不许动**的格子：链点（stage/boss）+ 异步据点 + 9 道门 + 起点。

    剩下的是 `fixedResource_10..51` 与 `candidateCells` —— 它们的位置可以随便调整
    （前置只挂在链点/门上，挪动不改变顺序逻辑）。
    """
    cells = {start}
    for site in sites:
        if site["type"] in ("stage", "boss", "asyncPvp"):
            cells.update(site["footprint"])
        elif site["type"] == "fixedResource":
            match = GATE_ID.fullmatch(site["id"])
            if match and int(match.group(1)) <= GATE_COUNT:
                cells.update(site["footprint"])
    return cells


def build_site(index: int, cell: int, prereq: int) -> dict:
    """新增固定资源格。字段顺序 = 编辑器写出来的顺序（`configId`/`buildingId` 在 `unlock` 之前）。"""
    return {
        "id": f"fixedResource_{index}",
        "type": "fixedResource",
        "cellId": cell,
        "footprint": [cell],
        "configId": f"fixedResource_{cell}",
        "buildingId": "",
        "unlock": {
            "requiredCells": [prereq],
            "combatPower": 0,
            "silverCost": FIXED_COST["silverCost"],
            "exploreSeconds": FIXED_COST["exploreSeconds"],
            "staminaCost": FIXED_COST["staminaCost"],
        },
        "rewardId": REWARD_ID,
    }


# ── 预览 ──────────────────────────────────────────────────────────────────────
SYMBOLS = {
    "start": "@", "stage": "S", "boss": "B", "asyncPvp": "A",
    "fixed_old": "o", "fixed_new": "x", "gate": "G",
    "random_old": "r", "random_new": "n", "free": ".",
}


def render(sites: list[dict], new_fixed: set[int], new_random: set[int], candidates: list[int], start: int) -> str:
    gate_cells = {site["cellId"] for site in sites
                  if site["type"] == "fixedResource" and (m := GATE_ID.fullmatch(site["id"])) and int(m.group(1)) <= GATE_COUNT}
    by_cell: dict[int, str] = {}
    for site in sites:
        for cell in site["footprint"]:
            symbol = ("G" if site["cellId"] in gate_cells else
                      SYMBOLS[site["type"]] if site["type"] != "fixedResource" else SYMBOLS["fixed_old"])
            by_cell.setdefault(cell, symbol)
    for cell in new_fixed:
        by_cell[cell] = SYMBOLS["fixed_new"]
    for cell in candidates:
        by_cell.setdefault(cell, SYMBOLS["random_new" if cell in new_random else "random_old"])
    by_cell[start] = SYMBOLS["start"]

    lines = ["     " + " ".join(f"{col % 10}" for col in range(COLUMNS))]
    for row in range(ROWS):
        # 奇数列下移半格，行首补一个空格，读起来才和游戏里的六边形对齐
        pad = "  " if row % 2 else ""
        lines.append(f"{row:>3} {pad}" + " ".join(by_cell.get(cell_id(row, col), ".") for col in range(COLUMNS)))
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="给 chapter_03 补 70 个固定格 + 70 个随机格")
    parser.add_argument("--fixed", type=int, default=FIXED_ADD, help="新增固定资源格数量")
    parser.add_argument("--random", type=int, default=RANDOM_ADD, help="新增随机候选格数量")
    parser.add_argument("--seed", type=int, default=SEED, help="选格种子（可复现）")
    parser.add_argument("--dry-run", action="store_true", help="只打印预览与统计，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布")
    args = parser.parse_args()

    data = json.loads(PRESET.read_text(encoding="utf-8"))
    sites: list[dict] = data["sites"]
    start: int = data["startCellId"]
    random_sites: dict = data["randomSites"]
    old_candidates = [int(cell) for cell in random_sites["candidateCells"]]

    occupied = {start}
    for site in sites:
        occupied.update(site["footprint"])
    painted = occupied | set(old_candidates)
    free = set(range(TOTAL)) - painted

    print(f"现况：站点 {len(sites)} 个 / 占用 {len(occupied)} 格 / 候选 {len(old_candidates)} 格 "
          f"/ 涂色 {len(painted)} 格 / 空位 {len(free)} 格")

    # ── 剖面自检：必须把「现有涂色格 + 不可动格」全包住，且剩下的空位正好等于要补的数量 ──
    profile = profile_cells()
    immovable = immovable_cells(sites, start)
    outside = sorted((painted | immovable) - profile)
    if outside:
        raise SystemExit(f"剖面包不住这些已有格子：{outside}（先调 `PROFILE_H`）")
    need = args.fixed + args.random
    available = len(profile) - len(painted)
    if available != need:
        raise SystemExit(f"剖面 {len(profile)} 格 − 现有涂色 {len(painted)} 格 = {available} 个空位，"
                         f"要补 {need} 个（改 `PROFILE_H` 让 Σ 缩进 = {(TOTAL - len(profile)) // 2 + (need - available) // 2}）")

    rng = random.Random(f"{args.seed}:chapter_03:fill")
    free_in_profile = sorted(profile - painted)
    # 随机挑哪 70 格当宝箱（固定种子可复现）—— 一行一隔一会排成规整横条，看着像贴图不是长出来的。
    fixed_set = set(rng.sample(free_in_profile, args.fixed))
    fixed_cells = sorted(fixed_set)
    random_cells = [cell for cell in free_in_profile if cell not in fixed_set]

    anchors = anchor_cells(sites)
    # id 按「上游链点 → 距离」排序，与既有 51 个的分组方式一致（它们也是按链点成批编号的）
    def order(cell: int) -> tuple[int, int, int]:
        prereq = min(anchors, key=lambda anchor: (hex_distance(cell, anchor), anchor))
        return (anchors.index(prereq), hex_distance(cell, prereq), cell)

    fixed_cells = sorted(fixed_cells, key=order)
    # ⚠️ 编号接着**固定资源**的最大序号排（`fixedResource_52…`），不是接着站点总数 ——
    #    sites 里还有 10 个关卡 + 3 个异步据点，用总数编号会从 `_65` 起跳、留下 52~64 的空档。
    existing_indexes = [int(match.group(1)) for site in sites if (match := GATE_ID.fullmatch(site["id"]))]
    next_index = max(existing_indexes, default=0) + 1
    new_sites = [build_site(next_index + offset, cell, min(anchors, key=lambda a: (hex_distance(cell, a), a)))
                 for offset, cell in enumerate(fixed_cells)]

    data["sites"] = sites + new_sites
    new_candidate_set = set(random_cells)
    data["randomSites"]["candidateCells"] = sorted(set(old_candidates) | new_candidate_set)

    # 新随机格的建筑 ID：名额先算好再抽格，口径与 `randomize_random_sites.assign` 一致
    ids = [str(value) for value in range(BUILDING_IDS[0], BUILDING_IDS[1] + 1)]
    quota = round(len(random_cells) * BUILDING_RATIO)
    building_ids = dict(random_sites.get("buildingIds") or {})
    with_building = rng.sample(sorted(random_cells), quota)
    for cell in with_building:
        building_ids[str(cell)] = rng.choice(ids)
    data["randomSites"]["buildingIds"] = {key: building_ids[key] for key in sorted(building_ids, key=int)}

    print(f"新增：固定资源 {len(new_sites)} 个（fixedResource_{next_index}…"
          f"fixedResource_{next_index + len(new_sites) - 1}）"
          f" / 候选 {len(random_cells)} 格 / 建筑 {quota} 格")
    print(f"新总量：站点 {len(data['sites'])} 个 / 候选 {len(data['randomSites']['candidateCells'])} 格 "
          f"/ 涂色 {len(painted) + need} 格（{len(painted) + need}/{TOTAL} = "
          f"{(len(painted) + need) / TOTAL:.0%}）")
    print(render(sites, set(fixed_cells), new_candidate_set, data["randomSites"]["candidateCells"], start))

    # 前置抽查：新增宝箱的 requiredCells 必须都是链点/门，且不自指
    anchor_set = set(anchors)
    bad = [site for site in new_sites if site["unlock"]["requiredCells"][0] not in anchor_set]
    if bad:
        raise SystemExit(f"{len(bad)} 个新宝箱的前置不在链点/门里")

    try:
        normalized, warnings = validate_territory_map(data, "chapter_03")
    except TerritoryValidationError as error:
        raise SystemExit(f"校验没过：{error}") from error
    for warning in warnings:
        print(f"warning: {warning}")

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
