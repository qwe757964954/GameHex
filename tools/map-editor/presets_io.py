"""`copy_territory_maps.py` / `copy_bigmap_maps.py` 的公共骨架。

这两份脚本的差别只有三样：**源目录、目标目录、怎么校验**。其余部分逐字相同 ——
策划 JSON 双写（`sever` / `client`）、`.meta` 只给 Cocos 资源目录生成、`--id` / `--dry-run`
参数、逐份打印。尤其 `.meta` 的字段是 Cocos 的导入契约，写在两处就会漂移一次
（`ver 1.1.2` 那套），所以收在这里。

## 为什么 `copy_maps.py` 不进来

对局地图那套的 `.meta` 是 `ver 2.0.1 + uuid + subMetas + userData`（导入器版本不同），
目标目录还是从 `ZCGame.ts` 的 `MAP_DIRECTORY` 反查出来的，也不需要写策划 JSON。
硬合并只会让这里多出一堆 `if kind == ...` —— 重复没消掉，可读性先没了。

## 为什么 `copy_one` 留在各自的脚本里

`tests/test_copy_territory_maps.py` 用 `patch.object(publisher, 'TARGET', ...)` 替换目标目录，
所以 `TARGET` / `DOC_TARGETS` 必须还留在那两个模块的命名空间里、由 `copy_one` 直接读。
这里只提供 `publish()` 这一条**写路径**，targets 由调用方算好传进来。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]

# 策划侧的两份 JSON 导出目录（在 Demo3.8 之外，与 `export_tafang.mjs` 同一套口径：
# `cityRoot/doc/塔防数据配置/json/{sever,client}`）。
#
# ⚠️ `sever` 是仓库既有拼写（不是 server 的笔误），改名会打断转表链路，别"顺手修正"。
# 这两个目录**不生成 Cocos 的 .meta** —— 它们不是 Cocos 资源目录，生成 .meta 只会污染策划仓。
DOC_JSON_ROOT = PROJECT.parents[0] / "doc" / "塔防数据配置" / "json"
DOC_TARGETS: tuple[Path, ...] = (DOC_JSON_ROOT / "sever", DOC_JSON_ROOT / "client")

# Cocos json 导入器的 meta 契约（territory / bigmap 共用这一套；对局地图是另一套，见模块注释）。
META_PAYLOAD = {"ver": "1.1.2", "importer": "json", "imported": True, "uuid": "", "files": {}}

CopyOne = Callable[[Path, bool], "tuple[list[Path], list[str]]"]


def targets_for(target_dir: Path, stem: str) -> list[Path]:
    """一份预设的三个落点：Cocos 资源目录 + 策划 sever + 策划 client。"""
    return [target_dir / f"{stem}.json", *(directory / f"{stem}.json" for directory in DOC_TARGETS)]


def publish(targets: list[Path], payload: str) -> None:
    """按顺序写全部目标；**只有第一个**（Cocos 资源目录）带 `.meta`。

    `.meta` 已存在就不覆盖 —— 里面的 `uuid` 被引用关系绑着，重写会让 Cocos 当成新资源。
    """
    for index, target in enumerate(targets):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload, encoding="utf-8")
        if index != 0:
            continue
        meta = target.with_suffix(target.suffix + ".meta")
        if not meta.exists():
            meta.write_text(json.dumps(META_PAYLOAD, indent=2) + "\n", encoding="utf-8")


def parse_args(description: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--id", action="append", dest="ids", help="publish only this preset id (repeatable)")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def run_batch(
    *,
    source: Path,
    ids: list[str] | None,
    dry_run: bool,
    copy_one: CopyOne,
    empty_message: str,
    skip_underscore: bool = False,
) -> int:
    """逐份发布，返回进程退出码。

    **一份坏档不会中断其余**（以前 territory 那份遇错直接 return，后面的图就不发了）：
    跑完再看谁坏，比逐个试要省事。退出码仍是非 0。
    """
    if ids:
        files = [source / f"{item}.json" for item in ids]
    else:
        # `_` 开头的是临时档（探针/试验），不参与默认批量发布；显式 --id 时不过滤。
        files = [
            path for path in sorted(source.glob("*.json"))
            if not (skip_underscore and path.stem.startswith("_"))
        ]
    if not files:
        print(empty_message)
        return 1

    failed = 0
    for path in files:
        if not path.exists():
            print(f"missing preset: {path}")
            failed += 1
            continue
        try:
            targets, warnings = copy_one(path, dry_run)
        except Exception as error:  # noqa: BLE001 —— 校验错误类型由各脚本自己定，这里只负责呈现
            print(f"invalid {path.name}: {error}")
            failed += 1
            continue
        printed = ", ".join(str(item) for item in targets)
        print(f"{'would publish' if dry_run else 'published'} {path.name} -> {printed}")
        for warning in warnings:
            print(f"warning: {warning}")
    return 1 if failed else 0
