"""把 `tools/map-editor/presets/territory/*.json` 发布到客户端资源目录与策划 JSON 目录。

一份 payload 写三处：Cocos 资源目录（带 `.meta`）+ 策划仓的 `sever` / `client`（不带）。
写盘与 `.meta` 的细节见 `presets_io.py` —— 那份是和 `copy_bigmap_maps.py` 共用的。

用法：
    python tools/map-editor/copy_territory_maps.py --dry-run
    python tools/map-editor/copy_territory_maps.py --id chapter_01
    tools\\map-editor\\copy-territory-maps.bat --id chapter_01
"""

from __future__ import annotations

import json
from pathlib import Path

import presets_io
from territory_format import validate_territory_map

ROOT = Path(__file__).resolve().parent
SOURCE = presets_io.ROOT / "presets" / "territory"
TARGET = presets_io.PROJECT / "assets" / "resources" / "config" / "territory-maps"

# 策划侧的两份 JSON 目录（口径与 `export_tafang.mjs` 一致）。**留在本模块**是为了让
# `tests/test_copy_territory_maps.py` 能 `patch.object(publisher, 'DOC_TARGETS', ...)`。
DOC_TARGETS: tuple[Path, ...] = presets_io.DOC_TARGETS


def copy_one(path: Path, dry_run: bool) -> tuple[list[Path], list[str]]:
    """校验一份预设并发布到三个落点；返回 (落盘路径列表, 警告列表)。

    三个目标写的是**同一份校验后的 payload** —— 校验只跑一次、产物按字节相同，
    避免三份目录各校验一次、规则漂移。
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    normalized, warnings = validate_territory_map(data, path.stem)
    payload = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    targets = [TARGET / f"{path.stem}.json", *(directory / f"{path.stem}.json" for directory in DOC_TARGETS)]
    if not dry_run:
        presets_io.publish(targets, payload)
    return targets, warnings


def main() -> int:
    args = presets_io.parse_args("Publish chapter territory maps to Cocos resources and planner JSON")
    return presets_io.run_batch(
        source=SOURCE,
        ids=args.ids,
        dry_run=args.dry_run,
        copy_one=copy_one,
        empty_message="no territory presets found",
    )


if __name__ == "__main__":
    raise SystemExit(main())
