from __future__ import annotations

import argparse
import json
from pathlib import Path

from territory_format import TerritoryValidationError, validate_territory_map

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
SOURCE = ROOT / "presets" / "territory"
TARGET = PROJECT / "assets" / "resources" / "config" / "territory-maps"

# 策划侧的两份 JSON 导出目录（在 Demo3.8 之外，与 `export_tafang.mjs` 同一套口径：
# `cityRoot/doc/塔防数据配置/json/{sever,client}`）。
#
# ⚠️ `sever` 是仓库既有拼写（不是 server 的笔误），改名会打断转表链路，别"顺手修正"。
# 这两个目录**不生成 Cocos 的 .meta** —— 它们不是 Cocos 资源目录，生成 .meta 只会污染策划仓。
DOC_JSON_ROOT = PROJECT.parents[0] / "doc" / "塔防数据配置" / "json"
DOC_TARGETS: tuple[Path, ...] = (DOC_JSON_ROOT / "sever", DOC_JSON_ROOT / "client")


def _publish(target: Path, payload: str, with_meta: bool) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(payload, encoding="utf-8")
    if not with_meta:
        return
    meta = target.with_suffix(target.suffix + ".meta")
    if not meta.exists():
        meta.write_text(json.dumps({"ver": "1.1.2", "importer": "json", "imported": True, "uuid": "", "files": {}}, indent=2) + "\n", encoding="utf-8")


def copy_one(path: Path, dry_run: bool) -> tuple[list[Path], list[str]]:
    """校验一份预设图并发布到全部目标；返回 (落盘路径列表, 警告列表)。

    三个目标写的是**同一份校验后的 JSON**（同一段 payload）——
    校验只跑一次，产物按字节相同，避免三份目录各校验一次、规则漂移。
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    normalized, warnings = validate_territory_map(data, path.stem)
    payload = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    targets = [TARGET / f"{path.stem}.json", *(directory / f"{path.stem}.json" for directory in DOC_TARGETS)]
    if not dry_run:
        # 只有 Cocos 资源目录要 .meta；策划目录不是 Cocos 资源，不生成。
        _publish(targets[0], payload, with_meta=True)
        for target in targets[1:]:
            _publish(target, payload, with_meta=False)
    return targets, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish chapter territory maps to Cocos resources and planner JSON")
    parser.add_argument("--id", action="append", dest="ids", help="publish only this preset id (repeatable)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    files = [SOURCE / f"{item}.json" for item in args.ids] if args.ids else sorted(SOURCE.glob("*.json"))
    if not files:
        print("no territory presets found")
        return 1
    for path in files:
        if not path.exists():
            print(f"missing preset: {path}")
            return 1
        try:
            targets, warnings = copy_one(path, args.dry_run)
        except (OSError, json.JSONDecodeError, TerritoryValidationError) as error:
            print(f"invalid {path.name}: {error}")
            return 1
        print(f"{'would publish' if args.dry_run else 'published'} {path.name} -> " + ", ".join(str(item) for item in targets))
        for warning in warnings:
            print(f"warning: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
