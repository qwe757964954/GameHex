"""Copy editor presets into Cocos resources without Node.js."""

import argparse
import json
from pathlib import Path
import re
import shutil
import uuid

from map_format import valid_id, validate_preset


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
SOURCE = ROOT / "presets"
GAME_SOURCE = PROJECT / "assets" / "script" / "app" / "zcds" / "ZCGame.ts"
MAP_DIRECTORY_PATTERN = re.compile(r"MAP_DIRECTORY = '([^']+)'")


def resolve_target() -> Path:
    """地图目录只在 ZCGame.ts 里定义一次，这里读回来，避免两处硬编码漂移。"""
    match = MAP_DIRECTORY_PATTERN.search(GAME_SOURCE.read_text(encoding="utf-8"))
    if not match:
        raise SystemExit(f"在 {GAME_SOURCE} 里找不到 MAP_DIRECTORY，无法确定地图资源目录")
    return PROJECT / "assets" / "resources" / match.group(1)


TARGET = resolve_target()


def main():
    parser = argparse.ArgumentParser(description="拷贝地图预设到 Cocos 资源目录")
    parser.add_argument("--id", dest="preset_id", help="只拷贝指定 map-id；省略则拷贝全部")
    parser.add_argument("--dry-run", action="store_true", help="只显示将要拷贝的文件")
    args = parser.parse_args()
    if args.preset_id and not valid_id(args.preset_id):
        parser.error("无效的 map-id")

    files = sorted(file for file in SOURCE.glob("*.json") if valid_id(file.stem)
                   and (not args.preset_id or file.stem == args.preset_id))
    if not files:
        parser.error(f"找不到 presets/{args.preset_id}.json" if args.preset_id else "presets 文件夹里没有地图")

    # Validate every source before copying any map, so an invalid preset cannot
    # leave a partly updated resource directory.
    for file in files:
        validate_preset(json.loads(file.read_text(encoding="utf-8")), file.stem)

    if not args.dry_run:
        TARGET.mkdir(parents=True, exist_ok=True)
    for file in files:
        target = TARGET / file.name
        if args.dry_run:
            print(f"将拷贝 {file.name} → {target}")
            continue
        shutil.copyfile(file, target)
        meta = Path(str(target) + ".meta")
        if not meta.exists():
            meta.write_text(json.dumps({
                "ver": "2.0.1", "importer": "json", "imported": True,
                "uuid": str(uuid.uuid4()), "files": [".json"],
                "subMetas": {}, "userData": {},
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"已拷贝 {file.name}")


if __name__ == "__main__":
    main()
