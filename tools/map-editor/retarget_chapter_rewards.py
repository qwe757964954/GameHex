# -*- coding: utf-8 -*-
"""把 `chapter_01~07` 的**宝箱奖励 id** 与**随机格奖励池**统一切成「按章递增」。

用户 2026-11-06：

    「chapter01 固定格的奖励id从1014改成1016   随机格改为2002
     后续02章节到07章节也改成对应章节的奖励id」

确认过的口径（三个问题都问过了）：

| | 规则 | ch01 | ch02 | ch03 | ch04 | ch05 | ch06 | ch07 |
| :--- | :--- | --- | --- | --- | --- | --- | --- | --- |
| 固定格 `fixedResource.rewardId` | `1015 + 章序` | 1016 | 1017 | 1018 | 1019 | 1020 | 1021 | 1022 |
| 随机格 `randomSites.rewardPoolId` | `2001 + 章序` | 2002 | 2003 | 2004 | 2005 | 2006 | 2007 | 2008 |

* **第 01 章「整章统一」**：现有 `1015×5`、`1011×3`、`1001×1` 也一并覆盖成 `1016`，
  不只换 `1014`（包括 `fixedResource_1/_3` 那两个已经是 1016 的）。
* **7 章一律统一**，包括 9 道门（`fixedResource_1..9`）—— 它们也是 `fixedResource` 类型、
  也带 `rewardId`；`chapter_03` 的门 9 原来是 `1011`，这次一起归一。

## ⚠️ 奖励表要策划自己补（本脚本不碰奖励表）

`levelMapGrideReward` 现在只有 `1001~1016` 和 `2001` 有内容：

* `2002` 有一行但是**空壳**（`{"rewardId": 2002}`，没有 `rewardGroup`）；
* `1017~1022`、`2003~2008` **完全不存在**。

所以跑完本脚本，`--dry-run` 会把「待补奖励行」清单打出来。**在策划把 13 行补齐并导表之前，
这七个章节的宝箱和随机格都会是空的。**

## 只动两个字段

| 不动 | 动 |
| :--- | :--- |
| 站点数量 / id / `cellId` / `footprint` / `unlock` / `configId` / `buildingId` | 每个 `fixedResource` 的 `rewardId` |
| `candidateCells` / `buildingIds` / `maxActive` / `triggerSilver` / 图形 | `randomSites.rewardPoolId` |

脚本对「除这两个字段外完全没变」有硬断言，不是靠人眼看。

用法：

    python tools/map-editor/retarget_chapter_rewards.py --dry-run   # 只打印前后分布，不写盘
    python tools/map-editor/retarget_chapter_rewards.py             # 改预设 + 发布 4 处
    python tools/map-editor/retarget_chapter_rewards.py --id chapter_01 --no-publish

脚本是**幂等**的：已经是目标 id 时不做任何改动。
"""

from __future__ import annotations

import argparse
import copy
import json
import shutil
from datetime import date
from pathlib import Path

import copy_territory_maps as publisher
import presets_io
import randomize_random_sites as randomizer
from territory_format import TerritoryValidationError, validate_territory_map

SOURCE = presets_io.ROOT / "presets" / "territory"
BACKUPS = presets_io.ROOT / "backups"
REWARD_TABLE = presets_io.DOC_JSON_ROOT / "client" / "levelMapGrideReward.json"
CHAPTERS = tuple(range(1, 8))

FIXED_BASE = 1015          # 固定格：1015 + 章序
POOL_BASE = 2001           # 随机池：2001 + 章序
# `rewardId` 在站点字典里的落位：插在 `unlock` 之前（与既有 chapter_01 的写法一致）
INSERT_BEFORE = ("unlock", "rewardId")


def fixed_id(chapter: int) -> int:
    """第 `chapter` 章的固定格奖励 id。"""
    return FIXED_BASE + chapter


def pool_id(chapter: int) -> int:
    """第 `chapter` 章的随机格奖励池 id。"""
    return POOL_BASE + chapter


def with_reward(site: dict, reward: int) -> dict:
    """给站点写入 `rewardId`，**保持其余键的原有顺序**。

    已有 `rewardId` 的站点直接赋值（位置不变）；缺失的（`chapter_02` 的
    `fixedResource_103/_104`）插到 `unlock` 前，跟同级站点排在一起。
    """
    if "rewardId" in site:
        site["rewardId"] = reward
        return site
    rebuilt: dict = {}
    for key, value in site.items():
        if key in INSERT_BEFORE:
            rebuilt["rewardId"] = reward
        rebuilt[key] = value
    if "rewardId" not in rebuilt:      # 连 unlock 都没有的怪站点，补在最后
        rebuilt["rewardId"] = reward
    return rebuilt


def distribution(data: dict) -> dict:
    """统计本章固定格的 `rewardId` 分布（`None` 表示这条压根没写）。"""
    counts: dict = {}
    for site in data["sites"]:
        if site.get("type") == "fixedResource":
            key = site.get("rewardId")
            counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (item[0] is None, item[0] or 0)))


def retarget(data: dict, chapter: int) -> dict:
    """返回改好的新 `data`：固定格 → `fixed_id(chapter)`，随机池 → `pool_id(chapter)`。"""
    result = copy.deepcopy(data)
    reward, pool = fixed_id(chapter), pool_id(chapter)
    result["sites"] = [
        with_reward(site, reward) if site.get("type") == "fixedResource" else site
        for site in result["sites"]
    ]
    result["randomSites"]["rewardPoolId"] = str(pool)
    return result


def diff_fields(before: dict, after: dict) -> list[str]:
    """列出除了 `rewardId` / `rewardPoolId` 之外被改动的字段（应为空）。

    把两个字段还原到「改前」再整体比，比逐字段白名单更严 —— 少一个键也会被抓到。
    """
    probe = copy.deepcopy(after)
    for site, origin in zip(probe["sites"], before["sites"]):
        if origin.get("type") == "fixedResource":
            if "rewardId" in origin:
                site["rewardId"] = origin["rewardId"]
            else:
                site.pop("rewardId", None)
    probe["randomSites"]["rewardPoolId"] = before["randomSites"]["rewardPoolId"]
    return [] if probe == before else ["除奖励字段外还有差异（见 git diff）"]


def reward_table_ids() -> set[int]:
    """奖励表里**真正有内容**的 id（`rewardGroup` 为空的空壳行不算）。"""
    if not REWARD_TABLE.exists():
        return set()
    rows = json.loads(REWARD_TABLE.read_text(encoding="utf-8"))
    return {row["rewardId"] for row in rows if row.get("rewardGroup")}


def main() -> int:
    parser = argparse.ArgumentParser(description="把七章的固定格奖励 id 与随机池按章递增替换")
    parser.add_argument("--id", action="append", dest="ids", help="只处理这些章节（可重复），默认全七章")
    parser.add_argument("--dry-run", action="store_true", help="只打印前后分布，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布")
    args = parser.parse_args()

    chapters = [int(name.split("_")[1]) for name in args.ids] if args.ids else list(CHAPTERS)
    paths = [SOURCE / f"chapter_{chapter:02d}.json" for chapter in chapters]
    missing = [path for path in paths if not path.exists()]
    if missing:
        raise SystemExit(f"找不到预设：{', '.join(str(path) for path in missing)}")

    existing_ids = reward_table_ids()
    stamp = date.today().strftime("%Y%m%d")
    planned: list[tuple[Path, dict, dict, dict]] = []   # (预设, 原数据, 新数据, 校验后数据)
    wanted: set[int] = set()

    print("章节     固定格 rewardId 分布  →  统一后          随机池  →  统一后")
    print("-" * 88)
    for path, chapter in zip(paths, chapters):
        data = json.loads(path.read_text(encoding="utf-8"))
        before, pool_before = distribution(data), data["randomSites"]["rewardPoolId"]
        updated = retarget(data, chapter)

        issues = diff_fields(data, updated)
        if issues:
            raise SystemExit(f"{path.stem}: {'；'.join(issues)}")
        try:
            normalized, warnings = validate_territory_map(updated, path.stem)
        except TerritoryValidationError as error:
            raise SystemExit(f"{path.stem} 校验没过：{error}") from error
        if warnings:
            print(f"  ⚠️ {path.stem} 校验警告：{'；'.join(warnings)}")

        after, pool_after = distribution(normalized), normalized["randomSites"]["rewardPoolId"]
        changed = before != after or pool_before != pool_after
        note = "" if changed else "   （已是目标值，跳过）"
        print(f"{path.stem}  {before}  →  {after}    {pool_before}  →  {pool_after}{note}")
        wanted.update({fixed_id(chapter), pool_id(chapter)})
        planned.append((path, data, updated, normalized))

    lack = sorted(wanted - existing_ids)
    if lack:
        print(f"\n⚠️ 奖励表缺这 {len(lack)} 个 id（无内容 / 整行不存在）：{lack}")
        print(f"   {REWARD_TABLE}")
        print("   补齐并导表之前，对应章节的宝箱与随机格都是空奖励。")
    else:
        print("\n奖励表已覆盖全部目标 id。")

    if args.dry_run:
        print("\n[dry-run] 没有写盘。")
        return 0

    written: list[tuple[str, dict]] = []
    for path, data, updated, normalized in planned:
        if data == updated:
            continue
        BACKUPS.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, BACKUPS / f"{path.stem}.pre-retarget-{stamp}.preset.json")
        # 预设按编辑器同一套格式回写（indent=2 / LF / 结尾换行）；与发布产物语义相同
        randomizer.write_preset(path, updated, dry_run=False)
        written.append((path.stem, normalized))
        print(f"已改预设：{path.relative_to(presets_io.PROJECT)}")

    if not written:
        print("七章都已经是目标值，没有写盘。")
        return 0

    if args.no_publish:
        print("--no-publish：跳过发布。")
        return 0

    for name, _ in written:
        targets, _ = publisher.copy_one(SOURCE / f"{name}.json", dry_run=False)
        published = json.loads(targets[0].read_text(encoding="utf-8"))
        randomizer.write_remote(published, name, dry_run=False)
        print(f"已发布 {len(targets) + 1} 处：{name} → {targets[0].parent.name}/ + doc/sever + doc/client"
              f" + assets/remoteRef/{name}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
