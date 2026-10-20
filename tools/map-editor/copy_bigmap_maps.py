"""把 `tools/map-editor/presets/bigmap/*.json` 发布到客户端资源目录与策划 JSON 目录。

与 `copy_territory_maps.py` 同一条链路（写盘 / `.meta` / 批处理骨架都在 `presets_io.py`），
差别只有两点：

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

import json
import shutil
import subprocess
from pathlib import Path

import presets_io

ROOT = Path(__file__).resolve().parent
SOURCE = presets_io.ROOT / "presets" / "bigmap"
TARGET = presets_io.PROJECT / "assets" / "resources" / "config" / "bigmap-maps"
VALIDATOR = presets_io.ROOT / "validate_bigmap_layout.ts"

DOC_TARGETS: tuple[Path, ...] = presets_io.DOC_TARGETS


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
        cwd=str(presets_io.PROJECT),
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
        presets_io.publish(targets, payload)
    return targets, warnings


def main() -> int:
    args = presets_io.parse_args("Publish bigmap layouts to Cocos resources and planner JSON")
    return presets_io.run_batch(
        source=SOURCE,
        ids=args.ids,
        dry_run=args.dry_run,
        copy_one=copy_one,
        empty_message="no bigmap presets found",
        skip_underscore=True,
    )


if __name__ == "__main__":
    raise SystemExit(main())
