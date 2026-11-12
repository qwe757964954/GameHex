# -*- coding: utf-8 -*-
"""把 `chapter_01~07` 里「用 `1023` 奖励」的宝箱格换成新建筑 `69020`（`coinBox`）。

用户 2026-11-10：

    「使用地图编辑器编辑 chapter01~07 地块使用了 1023 奖励的，建筑 id 从 69005 改成 69020，
     如果需要给建筑图片补充预制，按照统一的格式制作，现在已经有图片了」

## 先纠正一处前提

用户说的是「从 69005 改成 69020」，但**实测 148 个 `rewardId=1023` 的格 `buildingId` 全是空串**
（`""`），没有任何一格写着 `69005`。原因见下：它们现在是靠 `type` 兜底长得像 69005，而不是配了 69005。

所以本脚本按「**变成** 69020」执行（对空串与对 `69005` 是同一个动作）。

## 为什么空串也长得像 69005

`TerritoryMapView.stationIconOf` 是「配了 `buildingId` 就走建筑表；`stage`/`boss`/`asyncPvp`
没配就不画建筑」，而 `fixedResource` / `bonus` 会**继续往下**回退到 `TERRITORY_SITE_ART`：

    fixedResource ⇒ art.fixedResource ⇒ image/territory/buildings/territory_fixed_resource_v1

那张图正好就是 `build.json` 里 `69005` 的贴图 ⇒ 空串与 `69005` 视觉上**完全一样**。
本脚本给这 148 格显式写上 `"69020"`，`stationIconOf` 的第一条分支（`buildFrames.get(69020)`）
命中后就**不再回退**，外观切到 `coinBox`。

## 口径

| 项 | 值 |
| :-- | :-- |
| 命中条件 | `type == "fixedResource"` **且** `rewardId == 1023` |
| 写入 `buildingId` | `"69020"`（字符串，与地图 JSON 的既有写法一致） |
| `build.json` 行 | `69020, 5, image/territory/buildings/coinBox, 1` —— 已存在，本脚本只**对账**不新增 |
| 其它 `fixedResource`（`1016~1022`） | **不动**，仍是空串（继续走 type 兜底） |

`buildType=5`（固定宝箱）不参与选图，只作语义标注；对账是为了「表里改了 `buildType` 而这里没跟着改」
时立刻报错，而不是静默填出一个长得不对的建筑。

## 为什么 148 格逐格填、而不是每组一格

`fill_site_buildings.py` 那套「每组只填一格」针对的是 `stage`/`boss`/`asyncPvp`：
同一 `configId` 的多格共享同一个关卡，每格都画建筑会让整片区域长满同一个建筑。

固定宝箱格**没有这个问题**：148 个 `configId` 全不重复（`fixedResource_<cellId>`，实测 148 格
⇒ 148 个唯一 `configId`）⇒ 每格就是自己那栋建筑，必须逐格填。

用法：

    python tools/map-editor/set_chest_building.py --dry-run
    python tools/map-editor/set_chest_building.py
    python tools/map-editor/set_chest_building.py --id chapter_03
    python tools/map-editor/set_chest_building.py --no-publish   # 只改预设

⚠️ 幂等：已经是 `69020` 的格不会再改，跑几遍结果一样。
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from pathlib import Path
from typing import Any

import copy_territory_maps as publisher
import presets_io
from territory_format import TerritoryValidationError, validate_territory_map

SOURCE = publisher.SOURCE
BUILD_TABLE = presets_io.PROJECT / "assets" / "remoteRef" / "build.json"
CHAPTER_PATTERN = re.compile(r"chapter_\d{2}")

#: 目标奖励 id（`1023` = 「1023 那档宝箱」）。
DEFAULT_REWARD_ID = 1023
#: 目标建筑 id 与它的 `buildType`（对账用）。
DEFAULT_BUILDING_ID = "69020"
EXPECTED_BUILD_TYPE = 5


def read_build_types() -> dict[int, int]:
    """读 `build.json` 的 `buildId → buildType`（列存 `{c,k,v}` 与行数组两种形态都认）。"""
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


def assign(data: dict, reward_id: int, building_id: str) -> list[tuple[str, int, str]]:
    """给命中的格写 `buildingId`，返回 `[(siteId, cellId, 原 buildingId)]`。"""
    changes: list[tuple[str, int, str]] = []
    for site in data.get("sites") or []:
        if str(site.get("type") or "") != "fixedResource":
            continue
        if int(site.get("rewardId") or 0) != reward_id:
            continue
        previous = str(site.get("buildingId") or "")
        if previous == building_id:
            continue
        site["buildingId"] = building_id
        changes.append((str(site.get("id") or ""), int(site.get("cellId") or 0), previous))
    return changes


def assert_only_building_changed(normalized_before: dict, normalized_after: dict) -> None:
    """硬断言：除命中格的 `buildingId` 外，其余字段一个都没动。

    靠人眼看 7 份、148 格不现实。两边都必须是**过完校验的**形态：
    `validate_territory_map` 会重排字段顺序、补默认值，拿原始字节和归一结果直接比
    会把「校验器的正常归一」误判成改动。
    """
    stripped_before = copy.deepcopy(normalized_before)
    stripped_after = copy.deepcopy(normalized_after)
    for payload in (stripped_before, stripped_after):
        for site in payload.get("sites") or []:
            site.pop("buildingId", None)
    if stripped_before != stripped_after:
        raise SystemExit("❌ 除 buildingId 外还有字段变了 —— 中止，别写盘")


def write_preset(path: Path, data: dict, dry_run: bool) -> None:
    """按编辑器同一套格式回写：`indent=2` / `ensure_ascii=False` / LF / 结尾一个换行。

    ⚠️ 传进来的必须是**过完 `validate_territory_map` 的** `normalized`，不是裸 `data`：
    校验器会把站点的键重排成 `… configId, buildingId, rewardId`，`copy_one` 发布的也是这一份。
    写裸 `data` 会让预设与已发布产物只差一个键序（内容相同、字节不同），
    这种差异在下一次有人做「预设 vs 产物」比对时会被当成脏改动。
    """
    if dry_run:
        return
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    # 显式 newline="\n"：Windows 下 text 模式默认会把 `\n` 翻成 `\r\n`，而预设文件是 LF。
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="把指定奖励档的宝箱格换成指定建筑 id")
    parser.add_argument("--id", action="append", dest="ids", help="只处理这些预设 id（可重复）")
    parser.add_argument("--reward-id", type=int, default=DEFAULT_REWARD_ID, help="命中的奖励 id")
    parser.add_argument("--building-id", default=DEFAULT_BUILDING_ID, help="写入的建筑 id")
    parser.add_argument("--dry-run", action="store_true", help="只打印结果，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布到资源目录 / 策划 JSON")
    args = parser.parse_args()

    build_types = read_build_types()
    target_build = int(args.building_id)
    actual = build_types.get(target_build)
    if actual is None:
        raise SystemExit(f"{target_build} 不在 assets/remoteRef/build.json 里 —— 先补建筑表再跑")
    if actual != EXPECTED_BUILD_TYPE:
        raise SystemExit(
            f"{target_build} 在 build.json 里是 buildType={actual}，本脚本按 {EXPECTED_BUILD_TYPE}"
            "（固定宝箱）用 —— 先对账")

    paths = sorted(SOURCE.glob("chapter_*.json")) if not args.ids else [
        SOURCE / f"{name}.json" for name in args.ids
    ]
    # 只认 `chapter_01` 这种两位章节号 —— `chapter_smile` 是试验图，不该被顺手改掉。
    paths = [path for path in paths if path.exists() and CHAPTER_PATTERN.fullmatch(path.stem)]
    if not paths:
        raise SystemExit("没找到任何 chapter 预设")

    print(f"{'预设':<14}{'改写格数':>9}  明细")
    total = 0
    for path in paths:
        before_raw = json.loads(path.read_text(encoding="utf-8"))
        data = copy.deepcopy(before_raw)
        name = path.stem
        changes = assign(data, args.reward_id, args.building_id)
        if not changes:
            print(f"{name:<14}{0:>9}  （已是 {args.building_id}，跳过）")
            continue

        # 先过校验再动盘：一份坏档写进去，编辑器打开就会红，比报错更难查。
        try:
            normalized_before, _ = validate_territory_map(before_raw, name)
            normalized, warnings = validate_territory_map(data, name)
        except TerritoryValidationError as error:
            raise SystemExit(f"{name} 校验没过：{error}") from error
        assert_only_building_changed(normalized_before, normalized)
        for warning in warnings:
            print(f"  ⚠️ {name}: {warning}")

        write_preset(path, normalized, args.dry_run)
        if not args.no_publish:
            if args.dry_run:
                print(f"  [dry-run] 会发布 {name} 到资源目录 / 策划 JSON")
            else:
                targets, publish_warnings = publisher.copy_one(path, dry_run=False)
                for warning in publish_warnings:
                    print(f"  ⚠️ {name}: {warning}")
                print(f"  已发布 {len(targets)} 处")

        detail = ", ".join(
            f"{site_id}@{cell}({previous or '空'}→{args.building_id})"
            for site_id, cell, previous in changes[:6]
        )
        more = "" if len(changes) <= 6 else f" …共 {len(changes)} 格"
        print(f"{name:<14}{len(changes):>9}  {detail}{more}")
        total += len(changes)

    print(f"{'合计':<14}{total:>9}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
