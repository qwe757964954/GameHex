# -*- coding: utf-8 -*-
"""给「随机站点」按比例随机分配建筑 ID（改预设 → 校验 → 发布三处 → 同步 remoteRef）。

用户 2026-10-27：

    「使用 open-territory-editor 编辑 chapter_01 到 chapter_07 的地图，将地图内的随机站点的
     格子建筑 id 改为在 69008~69015 的 id 中随机抽取 1 个，约有 85% 的随机站点格子都有建筑 id，
     15% 左右的随机站建筑 id 为空（什么都不填）」

## 口径

- 作用对象 = `randomSites.candidateCells`（编辑器右侧「随机站点」里勾选的那些格）；
- 「有建筑」= 从 `--building-ids` 里**均匀抽 1 个**（默认 `69008-69015`，即
  `territory_decor_01_v1 … territory_decor_08_v1`，见 `assets/remoteRef/build.json`）；
- 「没有建筑」= **连 key 都不写**（`buildingIds` 里没这一格），与编辑器那句
  「留空 = 统一交给奖励池」同一口径；写空串会被 `validate_territory_map` 直接丢掉；
- 名额是**先按比例算好再随机挑格**（`round(候选格 × 0.85)`），不是逐格抛硬币 ——
  52 格的小图逐格抛会漂到 77% / 92%，策划看图会觉得"这张怎么少了一截"。
  只随机**哪几格**和**各自抽到哪个建筑**，所以同名重跑结果稳定。

## 为什么是改预设而不是改产物

`presets/territory/chapter_0X.json` 是 `open-territory-editor` 的**编辑源**，产物由
`copy_territory_maps.py` 从它生成。直接改产物下次发布就被覆盖，所以入口只能是预设。

`assets/remoteRef/chapter_0X.json` 不属于 `copy_territory_maps.py` 的落点（那是
`tools/ref/ref_compress_json.py` 从策划 `json/client` 压出来的），所以这里按**同一套序列化**
（`indent=0` + `separators=(',',':')` + 平台换行）单独补一份，保证三处字节同源。

用法：

    python tools/map-editor/randomize_random_sites.py --dry-run
    python tools/map-editor/randomize_random_sites.py --id chapter_01 --id chapter_02
    python tools/map-editor/randomize_random_sites.py --ratio 0.8 --seed 1
    python tools/map-editor/randomize_random_sites.py --no-publish   # 只改预设

⚠️ 重跑会**整段重写** `buildingIds`（不是增量补），所以同一 `--seed` 结果可复现，
换 `--seed` 就是换一套摆法。
"""

from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path

import copy_territory_maps as publisher
import presets_io
from territory_format import TerritoryValidationError, validate_territory_map

SOURCE = publisher.SOURCE
REMOTE_DIR = presets_io.PROJECT / "assets" / "remoteRef"
CHAPTER_PATTERN = re.compile(r"chapter_\d{2}")
DEFAULT_IDS = (69008, 69015)
DEFAULT_RATIO = 0.85
DEFAULT_SEED = 20261027


def parse_id_range(text: str) -> list[str]:
    """`69008-69015` → `['69008', …, '69015']`；也接受 `69008,69009` 这种逗号列表。"""
    chunks = [chunk.strip() for chunk in text.split(",") if chunk.strip()]
    if len(chunks) > 1:
        return [str(int(chunk)) for chunk in chunks]
    low, _, high = chunks[0].partition("-")
    start, end = int(low), int(high or low)
    if end < start:
        raise SystemExit(f"--building-ids 区间反了：{text}")
    return [str(value) for value in range(start, end + 1)]


def assign(data: dict, ids: list[str], ratio: float, seed: int, name: str) -> dict[str, str]:
    """按候选格定名额抽格，返回 `{cellId: buildingId}`（按 cellId 升序，与校验侧输出一致）。"""
    random_sites = data.get("randomSites") or {}
    candidates = sorted({int(cell) for cell in random_sites.get("candidateCells") or []})
    rng = random.Random(f"{seed}:{name}")
    quota = min(len(candidates), max(0, round(len(candidates) * ratio)))
    chosen = sorted(rng.sample(candidates, quota))
    return {str(cell): rng.choice(ids) for cell in chosen}


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
    parser = argparse.ArgumentParser(description="按比例给随机站点分配建筑 ID")
    parser.add_argument("--id", action="append", dest="ids", help="只处理这些预设 id（可重复）")
    parser.add_argument("--building-ids", default=f"{DEFAULT_IDS[0]}-{DEFAULT_IDS[1]}",
                        help="建筑 ID 区间或逗号列表，默认 69008-69015")
    parser.add_argument("--ratio", type=float, default=DEFAULT_RATIO, help="有建筑的比例，默认 0.85")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="抽样种子（可复现）")
    parser.add_argument("--dry-run", action="store_true", help="只打印结果，不写盘")
    parser.add_argument("--no-publish", action="store_true", help="只改预设，不发布到资源目录 / 策划 JSON")
    args = parser.parse_args()

    if not 0.0 <= args.ratio <= 1.0:
        raise SystemExit("--ratio 必须在 [0, 1] 内")
    ids = parse_id_range(args.building_ids)

    paths = sorted(SOURCE.glob("chapter_*.json")) if not args.ids else [
        SOURCE / f"{name}.json" for name in args.ids
    ]
    # 只认 `chapter_01` 这种两位章节号 —— `chapter_smile` 是一张试验图，不该被顺手改掉。
    paths = [path for path in paths if path.exists() and CHAPTER_PATTERN.fullmatch(path.stem)]
    if not paths:
        raise SystemExit("没找到任何 chapter 预设")

    print(f"建筑 ID 池 {ids[0]}~{ids[-1]}（{len(ids)} 个）· 比例 {args.ratio:.0%} · 种子 {args.seed}")
    print(f"{'预设':<14}{'候选格':>6}{'有建筑':>7}{'留空':>6}{'实际比例':>9}")
    total_cells = total_filled = 0
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not data.get("randomSites"):
            print(f"{path.stem:<14}  （没有 randomSites，跳过）")
            continue
        name = path.stem
        building_ids = assign(data, ids, args.ratio, args.seed, name)
        candidates = data["randomSites"].get("candidateCells") or []
        data["randomSites"]["buildingIds"] = dict(building_ids)

        # 先过校验再动盘：一份坏档写进去，编辑器打开就会红，比报错更难查。
        try:
            normalized, _ = validate_territory_map(data, name)
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
                print(f"  → 发布 {len(targets) + 1} 处：{', '.join(t.name for t in targets)} + remoteRef")

        total_cells += len(candidates)
        total_filled += len(building_ids)
        filled = len(building_ids)
        print(f"{name:<14}{len(candidates):>6}{filled:>7}{len(candidates) - filled:>6}"
              f"{filled / max(1, len(candidates)):>9.0%}")

    share = total_filled / max(1, total_cells)
    print(f"{'合计':<14}{total_cells:>6}{total_filled:>7}{total_cells - total_filled:>6}{share:>9.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
