"""独立核对 APK 里打进的内容与热更 release 是否同源。

不 import tools/hotupdate/publish_hotupdate.py 的任何函数：md5/清单解析全部自己算一遍，
这样它才是"独立复核"而不是"用实现验实现"。

用法：
    python tools/hotupdate/verify_apk_contents.py --apk <x.apk> --release <release 目录>
         [--client-version <hot_update.json 的 clientVersion>] [--sample N]

两个参数都必须显式给：本脚本刻意不做任何路径推导，图的是"你指哪我查哪"，
不会因为它在哪个目录而悄悄查到别的东西上去。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path


PASS = 0
FAIL = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"PASS  {label}")
    else:
        FAIL += 1
        print(f"FAIL  {label}  {detail}")


def md5_of(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True, help="release 目录（含 project.manifest）")
    parser.add_argument("--injection-marker", default="/* CITY1001_HOTUPDATE_INJECT_START */")
    parser.add_argument("--client-version", required=True)
    parser.add_argument("--sample", type=int, default=0, help="只抽查 N 个文件（0=全量）")
    args = parser.parse_args()

    release_manifest = json.loads((args.release / "project.manifest").read_text(encoding="utf-8"))
    assets = release_manifest["assets"]
    print(f"release 清单：{len(assets)} 个文件 / version={release_manifest['version']}")
    print(f"APK        ：{args.apk}  ({args.apk.stat().st_size} 字节)")
    print()

    with zipfile.ZipFile(args.apk) as archive:
        names = set(archive.namelist())

        # 1) APK 里带着随包清单，且版本是 clientVersion（不是 releaseId）
        packaged_name = "assets/project.manifest"
        check("APK 内含 assets/project.manifest", packaged_name in names)
        if packaged_name in names:
            packaged = json.loads(archive.read(packaged_name).decode("utf-8"))
            check(
                "随包清单 version == clientVersion",
                packaged.get("version") == args.client_version,
                f"实际 {packaged.get('version')!r}",
            )
            check(
                "随包清单指向渠道目录（不是某个 release）",
                packaged.get("packageUrl", "").rstrip("/").endswith("/dev"),
                packaged.get("packageUrl"),
            )
            check(
                "随包清单的文件表与 release 一致",
                packaged.get("assets") == assets,
                f"{len(packaged.get('assets', {}))} vs {len(assets)}",
            )

        # 2) 注入片段真的在 APK 的 main.js 里 ——
        #    没有它，热更下载成功也不会生效（引擎仍从包内读旧脚本）。
        main_js_name = "assets/main.js"
        check("APK 内含 assets/main.js", main_js_name in names)
        if main_js_name in names:
            main_js = archive.read(main_js_name).decode("utf-8", "replace")
            check("APK 的 main.js 含搜索路径恢复片段", args.injection_marker in main_js)

        # 3) 逐文件比对 md5：APK 里打进去的那份 == 热更 release 发布的那份
        targets = sorted(assets)
        if args.sample and args.sample < len(targets):
            step = max(1, len(targets) // args.sample)
            targets = targets[::step][: args.sample]
        missing: list[str] = []
        mismatched: list[str] = []
        for relative in targets:
            entry = f"assets/{relative}"
            if entry not in names:
                missing.append(relative)
                continue
            if md5_of(archive.read(entry)) != assets[relative]["md5"]:
                mismatched.append(relative)
        check(
            f"抽查 {len(targets)} 个文件全部存在且 md5 与清单一致",
            not missing and not mismatched,
            f"缺失 {missing[:3]} 不一致 {mismatched[:3]}",
        )

        # 4) 引导文件按设计不进清单（进了会"自锁"）
        for excluded in ("assets/main.js", "assets/application.js"):
            relative = excluded[len("assets/"):]
            check(f"{relative} 不在清单里（防自锁）", relative not in assets)

    print()
    print(f"通过 {PASS} 项，失败 {FAIL} 项")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
