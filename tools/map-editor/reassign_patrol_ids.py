# -*- coding: utf-8 -*-
"""把**已有**预设里每片巡逻宝箱的 `patrolId` 重算成「对应关卡 NPC 队伍 ∧ 塔防波次」那只。

用户 2026-11-20：

    「在地图上展示的野怪 id 从对应关卡的 npc 队伍配置和塔防出怪表的波次中抽取 1 个」

## 为什么要单独一个脚本

`add_patrol_chests.py` 是「从零加片子」，一见到已有 `patrolChest` 就整章跳过（幂等护栏）；
而这条需求是**改已有片子的一个字段**，跟选点、让位、解锁价都无关 —— 混进那个脚本会让
「重跑一次就重排一次地形」的风险重新出现。这里只碰 `patrolId` 一个键：

- 只改**锚点格**上已有的 `patrolId` 的值，锚点本身（哪一格）不动 ——
  锚点决定巡逻路线起点与交互上报格（`territoryPatrolAnchorCell`），换格等于换片子；
- 非锚点格的 `patrolId` 必须为空（一片两个锚点会长两只怪、且只认编号小的那个）；
- 其余字段（`battleId` / `buildingId` / `unlock` / `footprint`）一个字节都不动。

## 判据

取哪只怪、为什么取、两个来源分别是什么，全部来自 `patrol_monster_source.py`，
本脚本只负责把结果写到锚点上并打印对照表。重复跑结果逐字节一致（幂等）。

用法：

    python tools/map-editor/reassign_patrol_ids.py --dry-run     # 只看 diff
    python tools/map-editor/reassign_patrol_ids.py               # 写预设 + 发布
    python tools/map-editor/reassign_patrol_ids.py --id chapter_01 --no-publish
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import copy_territory_maps as publisher
import patrol_monster_source as monster_source
import presets_io
from territory_format import TerritoryValidationError, validate_territory_map

SOURCE = publisher.SOURCE
CHAPTER_PATTERN = re.compile(r"chapter_\d{2}")
#: 装饰宝箱建筑 id；没配 `patrolId` 的老片子靠它反推锚点。
CHEST_BUILDING_ID = "69021"


def group_sites(sites: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """按 `site.id` 分组（一片巡逻区 = 同一 id 的多条站点）。"""
    groups: dict[str, list[dict[str, Any]]] = {}
    for site in sites:
        if site.get("type") != "patrolChest":
            continue
        groups.setdefault(str(site["id"]), []).append(site)
    return groups


def resolve_anchor(group_id: str, sites: list[dict[str, Any]]) -> dict[str, Any]:
    """片内唯一的锚点格：优先「本来就有 `patrolId` 的那格」，否则「配了装饰宝箱的那格」。"""
    anchors = [site for site in sites if (site.get("patrolId") or 0) > 0]
    if len(anchors) > 1:
        raise SystemExit(f"{group_id}: 有 {len(anchors)} 个锚点格 —— 一片只能有一只巡逻怪")
    if anchors:
        return anchors[0]
    chests = [site for site in sites if str(site.get("buildingId") or "") == CHEST_BUILDING_ID]
    if len(chests) == 1:
        return chests[0]
    raise SystemExit(f"{group_id}: 找不到锚点格（既没有 patrolId 也没有装饰宝箱 {CHEST_BUILDING_ID}）")


def reassign(data: dict[str, Any], label: str, sources: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    """就地改 `patrolId`，返回逐片的对照行（不改其它字段）。"""
    rows: list[dict[str, Any]] = []
    for group_id, sites in sorted(group_sites(data["sites"]).items()):
        battle_ids = {int(site.get("battleId") or 0) for site in sites}
        if len(battle_ids) != 1:
            raise SystemExit(f"{label} / {group_id}: 整片 battleId 不一致 {sorted(battle_ids)}")
        battle_id = battle_ids.pop()
        source = sources.get(battle_id)
        if source is None:
            raise SystemExit(
                f"{label} / {group_id}: battleId {battle_id} 不在 monsterBox 里（先补宝箱组）"
            )
        anchor = resolve_anchor(group_id, sites)
        for site in sites:
            if site is anchor:
                continue
            if (site.get("patrolId") or 0) > 0:
                raise SystemExit(
                    f"{label} / {group_id}: 非锚点格 {site['cellId']} 也配了 patrolId "
                    "（会长两只怪，且只认编号小的那格）"
                )
        old = int(anchor.get("patrolId") or 0)
        new = int(source["patrolId"])
        anchor["patrolId"] = new
        rows.append({
            "label": label,
            "group": group_id,
            "cell": int(anchor["cellId"]),
            "battleId": battle_id,
            "levelId": source["levelId"],
            "npcCards": source["npcCards"],
            "waveIds": source["waveIds"],
            "old": old,
            "new": new,
            "changed": old != new,
            "basis": source["basis"],
        })
    if not rows:
        raise SystemExit(f"{label}: 一个 patrolChest 都没有")
    return rows


def write_preset(path: Path, normalized: dict[str, Any]) -> None:
    payload = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="按「对应关卡 NPC 队伍 ∧ 塔防波次」重算地图上展示的巡逻野怪 id",
    )
    parser.add_argument("--id", action="append", dest="ids", help="只处理这些预设 id（可重复）")
    parser.add_argument("--dry-run", action="store_true", help="只打印 diff，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布")
    args = parser.parse_args()

    if args.ids:
        names = args.ids
    else:
        names = [
            path.stem for path in sorted(SOURCE.glob("*.json"))
            if CHAPTER_PATTERN.fullmatch(path.stem)
        ]
    paths = [SOURCE / f"{name}.json" for name in names]
    for path in paths:
        if not path.exists():
            raise SystemExit(f"预设不存在：{path}")

    sources = monster_source.load_sources()
    total_changed = 0
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = reassign(data, path.stem, sources)
        monster_source.assert_monster_card({row["new"] for row in rows})

        print(f"\n=== {path.stem}")
        for row in rows:
            mark = "改" if row["changed"] else " ="
            print(
                f" {mark} {row['group']:<16} cell={row['cell']:<4} box={row['battleId']} "
                f"level={row['levelId']} 队伍={row['npcCards']} 波次={row['waveIds']} "
                f"{row['old'] or '(空)'} → {row['new']}（{row['basis']}）"
            )
        changed = sum(1 for row in rows if row["changed"])
        total_changed += changed
        print(f"  共 {len(rows)} 片，其中 {changed} 片要改 id")

        try:
            normalized, warnings = validate_territory_map(data, path.stem)
        except TerritoryValidationError as error:
            print(f"  ✗ 校验没过 → {error}")
            return 1
        for warning in warnings:
            print(f"  ⚠️ {warning}")
        if args.dry_run:
            continue
        write_preset(path, normalized)
        if not args.no_publish:
            targets, publish_warnings = publisher.copy_one(path, dry_run=False)
            for warning in publish_warnings:
                print(f"  ⚠️ {warning}")
            print(f"  已发布 {len(targets)} 处")
    print(f"\n合计 {total_changed} 片改了巡逻野怪 id")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
