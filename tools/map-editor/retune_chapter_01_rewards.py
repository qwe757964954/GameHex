# -*- coding: utf-8 -*-
"""`chapter_01`：把 10 个「1023 银币宝箱」按**位置均匀**换成 8×1016 + 1×1015 + 1×1012。

用户 2026-11-26：

    「按照位置均匀的 抽取 10个 1023 替换成8个1016 ，以及1个1015 和1个1012 ，
     这10个修改的奖励对应的建筑id也同步改成69005」

## 为什么建筑跟着奖励一起换

`rewardId=1023` 是**全表唯一只发银币**的奖励池（`resId` 只有 `7`），所以它的格配
`69020`（`coinBox` 银币箱子）。换成 `1016 / 1015 / 1012`（银币 + 资源 + 卡牌碎片 / 钻石）以后，
外观要退回通用的资源箱 `69005`（`territory_fixed_resource_v1`），否则会出现
「箱子画成银币宝箱、开出来却是碎片」的错位。

🔴 只改这 10 格的 `rewardId` 与 `buildingId`，`cellId / footprint / unlock / type` 一个字节不动；
剩下 12 格仍是 `1023` + `69020`，`tests/territory-building-id.test.ts` 那条
「1023 的格必须显式配 69020」继续成立。

## 「位置均匀」怎么算

22 个候选格 → 枚举 `C(22,10) = 646646` 种组合（1~2 秒跑完）后按三条判据排序：

1. **硬约束**：10 个格两两的**方位角**至少差 `MIN_ANGLE_GAP = 25°`。
   少了这条会选出一堆「同方向、不同半径」的格（实测里 `29` 与 `109` 都是 93°，欧氏距离却有
   358px）—— 数学上散得开，看起来还是一条竖线上的两点。
2. **最大化最小两两欧氏距离**（`p-dispersion`）：不许扎堆。
3. **最小化覆盖半径**（`k-center`）：每个没被选中的 `1023` 格，都要离某个选中格足够近，
   别留下没人管的一大片。

方位角与半径都取**游戏真实格心**（`HexGridLayout` 的 `92.25 / 90 / ±22.5`），不拿行列表号当
欧氏空间（奇偶列有 22.5px 错位，行列表号会把相邻两列读成更远）。

全枚举是确定性的（同输入同输出，没有随机种子），重复跑结果逐字节一致；`25°` 收不到解时
按 `20 / 15 / 10 / 0` 逐级放宽并在输出里说明（当前数据在 `25°` 就有 24 组候选）。

10 个里再取**距离最远的一对**分别给 `1015`（4 条奖励）与 `1012`（1 条钻石），
让两只「稀有箱」也尽量分开；其余 8 个给 `1016`。`cellId` 小的一只给 `1015`，只为了可复现。

用法：

    python tools/map-editor/retune_chapter_01_rewards.py --dry-run --preview   # 只看选点 + 画图
    python tools/map-editor/retune_chapter_01_rewards.py                       # 写预设 + 发布
    python tools/map-editor/retune_chapter_01_rewards.py --no-publish
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import copy_territory_maps as publisher
import presets_io
from territory_format import TerritoryValidationError, validate_territory_map

SOURCE = publisher.SOURCE
CHAPTER = "chapter_01"
#: 被替换的奖励池（全表唯一只发银币的一组）。
FROM_REWARD_ID = 1023
#: 目标奖励池 → 分到几个格。
PLAN = {1016: 8, 1015: 1, 1012: 1}
PICK_COUNT = sum(PLAN.values())
#: 10 个格的方位角两两最小间隔（度）。挡掉「同方向、不同半径」的伪均匀，见模块注释。
MIN_ANGLE_GAP = 25.0
#: 银币宝箱的建筑（`coinBox`）与新奖励通用的资源箱建筑。
CHEST_BUILDING = "69020"
PLAIN_BUILDING = "69005"
#: 执行前该章应有的 `1023` 格数（防止重复跑把第二遍的 12 个也吃掉）。
EXPECTED_SOURCE_CELLS = 22

# 游戏侧格心常量（`HexGridLayout.ts`，与 `add_patrol_chests.py` 同一份）。
COLUMN_SPACING = 92.25
ROW_SPACING = 90.0
COLUMN_PHASE = 22.5


def center(cell_id: int, rows: int, columns: int) -> tuple[float, float]:
    row, column = divmod(cell_id, columns)
    x = (column - (columns - 1) / 2) * COLUMN_SPACING
    y = ((rows - 1) / 2 - row) * ROW_SPACING + (COLUMN_PHASE if column % 2 else -COLUMN_PHASE)
    return x, y


def distance(a: int, b: int, rows: int, columns: int) -> float:
    ax, ay = center(a, rows, columns)
    bx, by = center(b, rows, columns)
    return math.hypot(ax - bx, ay - by)


def angle(cell_id: int, rows: int, columns: int) -> float:
    x, y = center(cell_id, rows, columns)
    return math.degrees(math.atan2(y, x)) % 360


def radius(cell_id: int, rows: int, columns: int) -> float:
    x, y = center(cell_id, rows, columns)
    return math.hypot(x, y)


def pick_even(cells: list[int], rows: int, columns: int, count: int) -> list[int]:
    """枚举全部组合，按「方位角硬约束 → 最小距离最大 → 覆盖半径最小」取最优。

    判据见模块注释「位置均匀怎么算」。返回按 `cellId` 升序的 `count` 个格。
    """
    import itertools

    if len(cells) < count:
        raise SystemExit(f"只有 {len(cells)} 个候选格，挑不出 {count} 个")
    dist = {cell: center(cell, rows, columns) for cell in cells}
    angles = {cell: angle(cell, rows, columns) for cell in cells}

    def pairwise(a: int, b: int) -> float:
        ax, ay = dist[a]
        bx, by = dist[b]
        return math.hypot(ax - bx, ay - by)

    for min_gap in (MIN_ANGLE_GAP, 20.0, 15.0, 10.0, 0.0):
        best: tuple[tuple[float, float, tuple[int, ...]], tuple[int, ...]] | None = None
        for combo in itertools.combinations(cells, count):
            sorted_angles = sorted(angles[cell] for cell in combo)
            gaps = [(sorted_angles[(i + 1) % count] - sorted_angles[i]) % 360 for i in range(count)]
            if min(gaps) < min_gap:
                continue
            nearest = min(pairwise(a, b) for a, b in itertools.combinations(combo, 2))
            cover = max(min(pairwise(cell, chosen) for chosen in combo) for cell in cells)
            # 最小距离「大」优先、覆盖半径「小」优先，最后按 cellId 序列定序保证可复现。
            key = (-nearest, cover, combo)
            if best is None or key < best[0]:
                best = (key, combo)
        if best is not None:
            pick_even.min_gap = min_gap
            return sorted(best[1])
    raise SystemExit("方位角约束全部放宽后仍无解（候选格太少）")


def farthest_pair(cells: list[int], rows: int, columns: int) -> tuple[int, int]:
    """选中的格里距离最远的一对（相同距离取编号小的组合）。"""
    best: tuple[float, int, int] | None = None
    for index, first in enumerate(cells):
        for second in cells[index + 1:]:
            span = distance(first, second, rows, columns)
            pair = (min(first, second), max(first, second))
            if best is None or span > best[0] or (span == best[0] and pair < best[1:]):
                best = (span, pair[0], pair[1])
    assert best is not None
    return best[1], best[2]


def assign(picked: list[int], rows: int, columns: int) -> dict[int, int]:
    """10 个格 → `cellId: 新 rewardId`。两只稀有箱落在距离最远的一对上。"""
    rare = sorted(farthest_pair(picked, rows, columns))
    # `cellId` 小的一只给 1015、大的一只给 1012（只为可复现，两只稀有箱本身已经分得最开）。
    plan: dict[int, int] = {rare[0]: 1015, rare[1]: 1012}
    common = [cell for cell in picked if cell not in plan]
    assert len(common) == PLAN[1016], f"8 个普通箱应剩 {PLAN[1016]} 格，实际 {len(common)}"
    for cell in common:
        plan[cell] = 1016
    return plan


def check_reward_pools() -> None:
    """两个新池必须存在，且语义与「换掉 1023」一致（1023 = 纯银币）。"""
    raw = json.loads((presets_io.PROJECT / "assets" / "remoteRef" / "levelMapGrideReward.json").read_text(encoding="utf-8"))
    pools = {int(row[0]): row[1] for row in raw["v"]}
    for reward_id in (FROM_REWARD_ID, *PLAN):
        if reward_id not in pools:
            raise SystemExit(f"levelMapGrideReward 里没有奖励池 {reward_id}")
    if {entry["resId"] for entry in pools[FROM_REWARD_ID]} != {7}:
        raise SystemExit(f"奖励池 {FROM_REWARD_ID} 不再是纯银币池 —— 本脚本的前提变了，先复核")
    build = json.loads((presets_io.PROJECT / "assets" / "remoteRef" / "build.json").read_text(encoding="utf-8"))
    index = {key: offset for offset, key in enumerate(build["k"])}
    build_ids = {str(row[index["buildId"]]) for row in build["v"]}
    for build_id in (CHEST_BUILDING, PLAIN_BUILDING):
        if build_id not in build_ids:
            raise SystemExit(f"build 表里没有建筑 {build_id}")


def apply(data: dict[str, Any]) -> tuple[dict[int, int], list[dict[str, Any]]]:
    """就地改这 10 格，返回 `cellId → 新 rewardId` 与逐格的变更行。"""
    rows, columns = data["rows"], data["columns"]
    source_sites = [site for site in data["sites"] if site.get("rewardId") == FROM_REWARD_ID]
    if len(source_sites) != EXPECTED_SOURCE_CELLS:
        raise SystemExit(
            f"{CHAPTER} 现在有 {len(source_sites)} 个 rewardId={FROM_REWARD_ID} 的格，"
            f"应为 {EXPECTED_SOURCE_CELLS} —— 本脚本已经跑过或数据被改过，先复核再动"
        )
    cells = sorted(int(site["cellId"]) for site in source_sites)
    picked = pick_even(cells, rows, columns, PICK_COUNT)
    plan = assign(picked, rows, columns)

    by_cell = {int(site["cellId"]): site for site in source_sites}
    changes: list[dict[str, Any]] = []
    for cell in picked:
        site = by_cell[cell]
        if site.get("type") != "fixedResource":
            raise SystemExit(f"格 {cell} 不是 fixedResource（{site.get('type')}）—— 与 1023 宝箱口径不符")
        if str(site.get("buildingId") or "") != CHEST_BUILDING:
            raise SystemExit(f"格 {cell} 的 buildingId 是 {site.get('buildingId')!r}，不是 {CHEST_BUILDING}")
        site["rewardId"] = plan[cell]
        site["buildingId"] = PLAIN_BUILDING
        x, y = center(cell, rows, columns)
        changes.append({
            "cell": cell,
            "rewardId": plan[cell],
            "radius": round(math.hypot(x, y), 1),
            "angle": round(math.degrees(math.atan2(y, x)), 1),
        })
    return plan, sorted(changes, key=lambda item: item["cell"])


def write_preset(path: Path, normalized: dict[str, Any]) -> None:
    payload = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)


def render(before: dict[str, Any], after: dict[str, Any], plan: dict[int, int], out: Path) -> None:
    """改前 / 改后对照图：只画 `1023` 系与本次改动的格，选中格按新奖励上色并标 cellId。"""
    from PIL import Image, ImageDraw

    rows, columns = after["rows"], after["columns"]
    scale = 1.0
    width = int(columns * COLUMN_SPACING * scale) + 60
    height = int(rows * ROW_SPACING * scale) + 60
    image = Image.new("RGB", (width * 2, height), (22, 24, 30))
    draw = ImageDraw.Draw(image)
    colors = {1023: (176, 112, 76), 1016: (86, 144, 212), 1015: (226, 168, 70), 1012: (206, 96, 140)}

    def px(cell: int, offset: int) -> tuple[float, float]:
        x, y = center(cell, rows, columns)
        return offset + width / 2 + x * scale, height / 2 - y * scale

    def paint(payload: dict[str, Any], offset: int, title: list[str]) -> None:
        radius = COLUMN_SPACING * scale * 0.46
        # 先铺一层「有地块」的底，好看清岛形
        covered: set[int] = set()
        for site in payload["sites"]:
            covered.update(site["footprint"])
        for cell in covered:
            x, y = px(cell, offset)
            draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=(58, 64, 76))
        for site in payload["sites"]:
            reward = site.get("rewardId")
            if reward not in colors:
                continue
            cell = int(site["cellId"])
            x, y = px(cell, offset)
            big = reward != 1023
            r = radius * (0.92 if big else 0.5)
            draw.ellipse([x - r, y - r, x + r, y + r], fill=colors[reward],
                         outline=(245, 245, 245) if big else None)
            if big:
                draw.text((x - 8, y - 5), str(cell), fill=(16, 18, 22))
                draw.text((x + r + 3, y - 5), str(reward), fill=(226, 232, 240))
        cx, cy = offset + width / 2, height / 2
        draw.line([cx - 16, cy, cx + 16, cy], fill=(130, 138, 150))
        draw.line([cx, cy - 16, cx, cy + 16], fill=(130, 138, 150))
        for i, line in enumerate(title):
            draw.text((offset + 12, 10 + i * 14), line, fill=(214, 220, 230))

    paint(before, 0, ["chapter_01 before", "1023 x22  (others dim)"])
    paint(after, width, [
        "chapter_01 after",
        f"1023 x{sum(1 for s in after['sites'] if s.get('rewardId') == 1023)}"
        f"  1016 x{sum(1 for s in after['sites'] if s.get('rewardId') == 1016)}"
        f"  1015 x1  1012 x1",
    ])
    draw.line([width, 0, width, height], fill=(52, 58, 66))
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)


def main() -> int:
    parser = argparse.ArgumentParser(description="chapter_01：10 个 1023 银币宝箱按位置均匀换成 1016/1015/1012")
    parser.add_argument("--dry-run", action="store_true", help="只打印 + 画图，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布")
    parser.add_argument("--preview", action="store_true", help="输出 tmp/chapter01_reward_retune.png")
    args = parser.parse_args()

    check_reward_pools()
    path = SOURCE / f"{CHAPTER}.json"
    before = json.loads(path.read_text(encoding="utf-8"))
    data = json.loads(path.read_text(encoding="utf-8"))
    plan, changes = apply(data)

    print(f"=== {CHAPTER}：{len(changes)} 个 {FROM_REWARD_ID} 格 → "
          + " / ".join(f"{reward}×{count}" for reward, count in PLAN.items())
          + f"（方位角最小间隔 {getattr(pick_even, 'min_gap', MIN_ANGLE_GAP)}°）")
    for item in changes:
        print(f"  cell {item['cell']:4d}  reward {FROM_REWARD_ID} → {item['rewardId']:<5d}  "
              f"building {CHEST_BUILDING} → {PLAIN_BUILDING}   "
              f"半径 {item['radius']:6.1f}  方位 {item['angle']:6.1f}°")
    angles = sorted(item["angle"] for item in changes)
    gaps = [round((angles[(i + 1) % len(angles)] - angles[i]) % 360, 1) for i in range(len(angles))]
    print(f"  方位角 {angles}")
    print(f"  相邻空档 {gaps}  最大 {max(gaps)}°（10 等分理想 36°）")

    try:
        normalized, warnings = validate_territory_map(data, CHAPTER)
    except TerritoryValidationError as error:
        print(f"✗ 校验没过 → {error}")
        return 1
    for warning in warnings:
        print(f"⚠️ {warning}")

    if args.preview:
        preview = presets_io.PROJECT / "tmp" / "chapter01_reward_retune.png"
        render(before, normalized, plan, preview)
        print(f"预览图 {preview}")

    if args.dry_run:
        return 0
    write_preset(path, normalized)
    if not args.no_publish:
        targets, publish_warnings = publisher.copy_one(path, dry_run=False)
        for warning in publish_warnings:
            print(f"⚠️ {warning}")
        print(f"已发布 {len(targets)} 处")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
