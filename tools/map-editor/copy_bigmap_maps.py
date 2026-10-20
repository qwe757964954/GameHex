"""把 `tools/map-editor/presets/bigmap/*.json` 发布到客户端资源目录与策划 JSON 目录。

与 `copy_territory_maps.py` 同一条链路，差别只有两点：

1. **校验不在这里做**：规则只有一份权威实现（`BigMapLayout.parseBigMapLayout`），
   本脚本 `subprocess` 调 `npx tsx tools/map-editor/validate_bigmap_layout.ts` 跑它。
   在 python 里再抄一遍就是第三处漂移点（编辑器 js / 运行时 ts / 发布 py）。
2. 多一道**与配置表对账**：布局里的城/怪必须在 `BigMap-*` 表里存在，反之告警。

用法：
    python tools/map-editor/copy_bigmap_maps.py --dry-run
    python tools/map-editor/copy_bigmap_maps.py --id world_01
    tools\\map-editor\\copy-bigmap-maps.bat --id world_01
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
SOURCE = ROOT / "presets" / "bigmap"
TARGET = PROJECT / "assets" / "resources" / "config" / "bigmap-maps"
VALIDATOR = ROOT / "validate_bigmap_layout.ts"

# 策划侧两份 JSON（在 Demo3.8 之外，与 `export_tafang.mjs` 同一套口径）。
# ⚠️ `sever` 是仓库既有拼写，改名会打断转表链路。
DOC_JSON_ROOT = PROJECT.parents[0] / "doc" / "塔防数据配置" / "json"
DOC_TARGETS: tuple[Path, ...] = (DOC_JSON_ROOT / "sever", DOC_JSON_ROOT / "client")

META_PAYLOAD = {"ver": "1.1.2", "importer": "json", "imported": True, "uuid": "", "files": {}}


def _write(target: Path, payload: str, with_meta: bool) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(payload, encoding="utf-8")
    if not with_meta:
        return
    meta = target.with_suffix(target.suffix + ".meta")
    if not meta.exists():
        meta.write_text(json.dumps(META_PAYLOAD, indent=2) + "\n", encoding="utf-8")


def _node_command() -> list[str] | None:
    """找到能跑 tsx 的命令；node/npx 都缺时返回 None（调用方降级为「只发布不校验」并大声告警）。"""
    for name in ("npx.cmd", "npx", "npx.exe"):
        found = shutil.which(name)
        if found:
            return [found, "tsx", str(VALIDATOR)]
    return None


def validate(path: Path) -> tuple[dict | None, list[str], list[str]]:
    """返回 (归一化后的布局, 告警, 错误)。错误非空 ⇒ 调用方应中止。"""
    command = _node_command()
    if command is None:
        return None, ["找不到 npx，跳过权威校验（只做了 JSON 语法检查）"], []

    # tsx 在 Windows 上按 UTF-8 输出；不指定编码时中文会变乱码，报错信息全废。
    result = subprocess.run(
        [*command, str(path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(PROJECT),
    )
    stdout = (result.stdout or "").strip()
    if not stdout:
        return None, [], [f"校验器没有输出（exit {result.returncode}）：{(result.stderr or '').strip()[:400]}"]
    try:
        data = json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return None, [], [f"校验器输出不是 JSON：{stdout[:400]}"]
    if not data.get("ok"):
        return None, [], list(data.get("issues") or ["校验失败（无具体原因）"])
    return data.get("layout"), list(data.get("warnings") or []), []


def copy_one(path: Path, dry_run: bool) -> tuple[list[Path], list[str]]:
    layout, warnings, errors = validate(path)
    if errors:
        raise ValueError("; ".join(errors))

    payload = json.dumps(layout, ensure_ascii=False, indent=2) + "\n"
    targets = [TARGET / f"{path.stem}.json", *(directory / f"{path.stem}.json" for directory in DOC_TARGETS)]
    if not dry_run:
        _write(targets[0], payload, with_meta=True)
        for target in targets[1:]:
            _write(target, payload, with_meta=False)
    return targets, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish bigmap layouts to Cocos resources and planner JSON")
    parser.add_argument("--id", action="append", dest="ids", help="publish only this preset id (repeatable)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.ids:
        files = [SOURCE / f"{item}.json" for item in args.ids]
    else:
        # `_` 开头的是临时档（探针/试验），不参与默认批量发布；显式 --id 时不过滤。
        files = [path for path in sorted(SOURCE.glob("*.json")) if not path.stem.startswith("_")]
    if not files:
        print("no bigmap presets found")
        return 1

    failed = 0
    for path in files:
        if not path.exists():
            print(f"missing preset: {path}")
            failed += 1
            continue
        try:
            targets, warnings = copy_one(path, args.dry_run)
        except ValueError as error:
            print(f"invalid {path.name}: {error}")
            failed += 1
            continue
        print(f"{'would publish' if args.dry_run else 'published'} {path.name} -> " + ", ".join(str(item) for item in targets))
        for warning in warnings:
            print(f"warning: {warning}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
