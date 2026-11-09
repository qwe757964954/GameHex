# -*- coding: utf-8 -*-
"""给「关卡 / 首领 / 异步据点」站点补建筑 ID（改预设 → 校验 → 发布三处 → 同步 remoteRef）。

用户 2026-11-06：

    「chapter02~07 的地块上也需要和 chapter 01 一样，填写对应的关卡建筑 id、boss 建筑 id，
     以及异步据点 id」

## 口径

| 站点 `type` | 建筑 ID | `build.json` 的 `buildType` | 外观 |
| :-- | :-- | :-- | :-- |
| `stage` | `69004` | 4（普通关） | `territory_outpost_v1` |
| `boss` | `69003` | 3（boss 关） | `territory_boss_v1` |
| `asyncPvp` | `69002` | 2（异步据点） | `territory_async_pvp_v1` |

## 为什么是「每个 configId 组只填一格」而不是「每格都填」

`chapter_01` 是既有摆法，全量核对过：14 个 `(type, configId)` 组、**每组恰好 1 格**有 `buildingId`
（stage 8 组 8 格 / boss 2 组 2 格 / asyncPvp 4 组 4 格）。

原因是这三类站点在 `TerritoryMapView.stationIconOf` 里是「**没配 `buildingId` ⇒ 不画建筑**」：
同一片战斗区域（同 `configId`）的所有格子共享同一个关卡，若每格都画建筑，整片区域会长满同一个
建筑（用户 2026-10-16 报的「327 和 328 长得一样」），读不出"这一关到底在哪一格"。
其余格子只留格面框 + 文案，`TerritoryStageBinding` 也优先挑带建筑的那格做代表。

`chapter_02~07` 的 13 个组每组只有 1 个站点 ⇒ 13 格全都要填。

## 为什么改预设

`presets/territory/chapter_0X.json` 是 `open-territory-editor` 的**编辑源**，产物由
`copy_territory_maps.py` 生成。直接改产物下次发布就被覆盖。

`assets/remoteRef/chapter_0X.json` 不属于 `copy_territory_maps.py` 的落点（那是
`tools/ref/ref_compress_json.py` 从策划 `json/client` 压出来的），所以按同一套序列化补一份，
保证三处内容同源（与 `randomize_random_sites.py` 完全同一路做法）。

用法：

    python tools/map-editor/fill_site_buildings.py --dry-run
    python tools/map-editor/fill_site_buildings.py --id chapter_02 --id chapter_03
    python tools/map-editor/fill_site_buildings.py --overwrite   # 连已有建筑也重写成本表口径
    python tools/map-editor/fill_site_buildings.py --no-publish  # 只改预设

⚠️ 幂等：组里已经有一格配置了 `buildingId` 就整组跳过（`chapter_01` 跑一遍等于没跑）。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import copy_territory_maps as publisher
import presets_io
from territory_format import TerritoryValidationError, validate_territory_map

SOURCE = publisher.SOURCE
REMOTE_DIR = presets_io.PROJECT / "assets" / "remoteRef"
BUILD_TABLE = REMOTE_DIR / "build.json"
CHAPTER_PATTERN = re.compile(r"chapter_\d{2}")

#: `站点 type → (建筑 ID, build.json 里的 buildType)`；be 值与 `assets/remoteRef/build.json` 对账。
SITE_BUILDINGS: dict[str, tuple[str, int]] = {
    "stage": ("69004", 4),
    "boss": ("69003", 3),
    "asyncPvp": ("69002", 2),
}


def read_build_types() -> dict[int, int]:
    """读 `build.json` 的 `buildId → buildType`（列存 `{c,k,v}` 与行数组两种形态都认）。

    只用来**对账**：表里改了 `buildType` 而这里没跟着改时，宁可报错也不要静默填错建筑。
    表读不到（策划还没导出）时返回空表 ⇒ 跳过对账，不阻断发布。
    """
    if not BUILD_TABLE.exists():
        return {}
    raw = json.loads(BUILD_TABLE.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and raw.get("c") == 1 and isinstance(raw.get("k"), list):
        rows = [dict(zip(raw["k"], values)) for values in raw.get("v") or []]
    elif isinstance(raw, list):
        rows = raw
    else:
        return {}
    types: dict[int, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        build_id = int(row.get("buildId") or 0)
        if build_id > 0:
            types[build_id] = int(row.get("buildType") or 0)
    return types


def assign(data: dict, overwrite: bool) -> list[tuple[str, int, str, str, str]]:
    """按「每组一格」补建筑 ID，返回 `[(siteId, cellId, type, configId, buildingId)]`。

    组 = `(type, configId)`。组里已有建筑（且不 `overwrite`）⇒ 整组跳过；
    否则填在**组内 cellId 最小**的那一格 —— 与遍历顺序无关，跑几遍结果都一样。
    """
    groups: dict[tuple[str, str], list[dict]] = {}
    for site in data.get("sites") or []:
        site_type = str(site.get("type") or "")
        if site_type not in SITE_BUILDINGS:
            continue
        config_id = str(site.get("configId") or "")
        groups.setdefault((site_type, config_id), []).append(site)

    changes: list[tuple[str, int, str, str, str]] = []
    for (site_type, config_id), sites in sorted(groups.items()):
        building_id = SITE_BUILDINGS[site_type][0]
        if not overwrite and any(str(site.get("buildingId") or "").strip() for site in sites):
            continue
        target = min(sites, key=lambda site: int(site.get("cellId") or 0))
        if str(target.get("buildingId") or "").strip() == building_id:
            continue
        target["buildingId"] = building_id
        changes.append((
            str(target.get("id") or ""),
            int(target.get("cellId") or 0),
            site_type,
            config_id,
            building_id,
        ))
    return changes


def write_preset(path: Path, data: dict, dry_run: bool) -> None:
    """按编辑器同一套格式回写：`indent=2` / `ensure_ascii=False` / LF / 结尾一个换行。"""
    if dry_run:
        return
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    # 显式 newline="\n"：Windows 下 text 模式默认会把 `\n` 翻成 `\r\n`，而预设文件是 LF。
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)


def write_remote(payload: dict, name: str, dry_run: bool) -> None:
    """补 `assets/remoteRef/<name>.json`：与 `tools/ref/ref_compress_json.py` 逐字节同款。"""
    if dry_run:
        return
    target = REMOTE_DIR / f"{name}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:  # 不传 newline：跟 ref 脚本一样吃平台换行
        json.dump(payload, handle, separators=(",", ":"), indent=0, ensure_ascii=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="给关卡 / 首领 / 异步据点站点补建筑 ID")
    parser.add_argument("--id", action="append", dest="ids", help="只处理这些预设 id（可重复）")
    parser.add_argument("--overwrite", action="store_true", help="连已有建筑也按本表口径重写")
    parser.add_argument("--dry-run", action="store_true", help="只打印结果，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布到资源目录 / 策划 JSON")
    args = parser.parse_args()

    build_types = read_build_types()
    for site_type, (building_id, expected) in SITE_BUILDINGS.items():
        actual = build_types.get(int(building_id))
        if actual is not None and actual != expected:
            raise SystemExit(
                f"{building_id} 在 build.json 里是 buildType={actual}，本脚本按 {expected} 用（{site_type}）——先对账")
    if not build_types:
        print("⚠️ 读不到 assets/remoteRef/build.json，跳过 buildType 对账")

    paths = sorted(SOURCE.glob("chapter_*.json")) if not args.ids else [
        SOURCE / f"{name}.json" for name in args.ids
    ]
    # 只认 `chapter_01` 这种两位章节号 —— `chapter_smile` 是试验图，不该被顺手改掉。
    paths = [path for path in paths if path.exists() and CHAPTER_PATTERN.fullmatch(path.stem)]
    if not paths:
        raise SystemExit("没找到任何 chapter 预设")

    print(f"{'预设':<14}{'补格数':>7}  明细")
    total = 0
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        name = path.stem
        changes = assign(data, args.overwrite)
        if not changes:
            print(f"{name:<14}{0:>7}  （已有建筑，跳过）")
            continue

        # 先过校验再动盘：一份坏档写进去，编辑器打开就会红，比报错更难查。
        try:
            validate_territory_map(data, name)
        except TerritoryValidationError as error:
            raise SystemExit(f"{name} 校验没过：{error}") from error

        write_preset(path, data, args.dry_run)
        if not args.no_publish:
            if args.dry_run:
                print(f"  [dry-run] 会发布 {name} 到资源目录 / 策划 JSON / remoteRef")
            else:
                targets, _ = publisher.copy_one(path, dry_run=False)
                # remoteRef 以**已发布的那份**为准再压一次，保证三处内容同源。
                published = json.loads(targets[0].read_text(encoding="utf-8"))
                write_remote(published, name, dry_run=False)

        detail = ", ".join(f"{site_id}@{cell}={building}" for site_id, cell, _, _, building in changes)
        print(f"{name:<14}{len(changes):>7}  {detail}")
        total += len(changes)

    print(f"{'合计':<14}{total:>7}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
