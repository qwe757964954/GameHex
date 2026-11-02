# -*- coding: utf-8 -*-
"""火焰树妖普攻：借用**魔术师**（`魔法师_普攻`）的帧序列，按亮度重映射成**浅紫**。

2026-10-31 需求：「火焰树妖使用魔术师的攻击效果，改成类似的浅紫色的即可」。

## 为什么落在 `火焰树妖_普攻` 自己的目录里

`pvpSkill` 30711（火焰树妖普攻）的 `effectPrefabPath` 指向 `units/projectiles/火焰树妖_普攻/火焰树妖_普攻`。
**保持这个路径不变**、只换目录里的美术 ⇒ 配置表一行都不用改，也不会像「直接改 `魔法师_普攻`」那样
把魔术师自己的普攻一起染紫（那份还被 30854 帽子戏法 / 30855 空间置换引用）。

## 换了什么、没换什么

| | 换 | 说明 |
| --- | --- | --- |
| `atlas/049_xx.png` | ✅ 新的 16 帧（浅紫） | 从 `魔法师_普攻/atlas` 复制后上色，帧数/画布跟魔术师完全一致 |
| `atlas/*.pac` | ❌ 不动 | 内容只是 `{"__type__":"cc.SpriteAtlas"}` 的占位，引擎建包时按目录重算 |
| `anim/<set>-loop.anim` | ✅ 帧序列 | 文件名与 `.meta` 都不动（uuid 不变）⇒ prefab 的 `_clips` 引用不用改 |
| `<set>.prefab` | ✅ Sprite 帧图 + 画布尺寸 | 结构（根 + `offset`）与 `offset._lscale = 0.35`（法师统一 70%）**原样保留** |

旧的 8 帧火焰（`130_0..130_7.png`）先备份到 `tmp/legacy-treant-fire-frames/` 再删除 ——
要回退就把备份拷回去、再跑一次本脚本的前置步骤（脚本本身幂等，重复跑只会重刷同一批图）。

## 上色为什么不做成 `Sprite.color`

`Sprite.color` 是**顶点色相乘**，蓝色底乘紫只会发暗（蓝通道本来就饱和，红通道上不去）。
色阶重映射走美术层，和 §1.11 的树妖紫火焰同一套做法（`tools/art/tint_effect_purple.py`）。

用法：
    python tools/build_treant_purple_attack_fx.py [--dry-run]
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import uuid as uuid_mod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTILES = os.path.join(ROOT, "assets", "bundles", "battle", "units", "projectiles")

SRC_SET = "魔法师_普攻"
DST_SET = "火焰树妖_普攻"

TINT_SCRIPT = os.path.join(ROOT, "tools", "art", "tint_effect_purple.py")
# 色阶（亮度 0→1）。比 §1.11 那套「树妖紫」（0.52:#7E2CC0 / 0.74:#CB37F5）整体提亮一档：
# 需求要的是「**浅**紫」，而这份美术的亮部占比高（蓝白核心），压深了会读成深紫球。
TINT_STOPS = "0.00:#241238,0.30:#6A4BA8,0.55:#A87BE8,0.78:#D2B0F6,0.92:#E9D8FF,1.00:#FBF4FF"
TINT_BACKUP = "tmp/frame-backup-treant-attack-purple"
LEGACY_BACKUP = "tmp/legacy-treant-fire-frames"

# 与魔术师一致：sample 12 ⇒ 16 帧 = 1.3333s 一个循环
SAMPLE = 12
# 目标 prefab 的 `offset._lscale`（法师普攻统一 70% 的产物，2026-10-30 定；本脚本只校验不改）
OFFSET_SCALE = 0.35


def new_uuid():
    return str(uuid_mod.uuid4())


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fp:
        json.dump(obj, fp, ensure_ascii=False, indent=2)


def read_json(path):
    with open(path, encoding="utf-8") as fp:
        return json.load(fp)


def png_size(path):
    import struct
    with open(path, "rb") as fp:
        head = fp.read(33)
    return struct.unpack(">II", head[16:24])


def sprite_frame_meta(meta_uuid, display_name, width, height):
    """image impostor：`6c48a`(texture) + `f9941`(spriteFrame)。

    直接复用 `tools/build_dart_attack_fx.py` 的实现 —— 那份 meta 是照着编辑器导出的结构写的，
    重写一遍只会慢慢漂（AGENTS.md §1.11：帧图 meta 必须有 `f9941`，漏了就是静默空白）。
    """
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import build_dart_attack_fx as dart  # 顶部有 main guard，导入安全
    return dart.build_sprite_frame_meta(meta_uuid, display_name, width, height)


def copy_and_tint(dry_run):
    src_atlas = os.path.join(PROJECTILES, SRC_SET, "atlas")
    dst_atlas = os.path.join(PROJECTILES, DST_SET, "atlas")
    sources = sorted(glob.glob(os.path.join(src_atlas, "049_*.png")))
    if not sources:
        raise SystemExit("源帧图缺失：%s/049_*.png" % src_atlas)

    # 1) 把旧的火焰帧（130_x.png）挪去备份目录，别留在图集里当死资源。
    for path in sorted(glob.glob(os.path.join(dst_atlas, "*.png"))):
        name = os.path.basename(path)
        if name in {os.path.basename(item) for item in sources}:
            continue
        if dry_run:
            print("[dry] 会移走旧帧 %s" % name)
            continue
        os.makedirs(os.path.join(ROOT, LEGACY_BACKUP), exist_ok=True)
        for target in (path, path + ".meta"):
            if os.path.exists(target):
                shutil.move(target, os.path.join(ROOT, LEGACY_BACKUP, os.path.basename(target)))
        print("[legacy] %s -> %s/" % (name, LEGACY_BACKUP))

    # 2) 复制 + 写 meta（已有 meta 就沿用它的 uuid：重复跑不会把 prefab 的引用刷断）
    widths = set()
    for source in sources:
        name = os.path.basename(source)
        destination = os.path.join(dst_atlas, name)
        width, height = png_size(source)
        widths.add((width, height))
        if dry_run:
            print("[dry] %s  %dx%d" % (name, width, height))
            continue
        shutil.copyfile(source, destination)
        meta_path = destination + ".meta"
        meta_uuid = read_json(meta_path)["uuid"] if os.path.exists(meta_path) else new_uuid()
        write_json(meta_path, sprite_frame_meta(meta_uuid, name, width, height))
        print("[png] %s  %dx%d  uuid=%s" % (name, width, height, meta_uuid))

    if len(widths) != 1:
        raise SystemExit("源帧尺寸不一致：%s（逐帧换图会抖）" % sorted(widths))
    return sorted(os.path.basename(item) for item in sources), widths.pop()


def tint(dry_run):
    pattern = os.path.join(PROJECTILES, DST_SET, "atlas", "049_*.png")
    command = [sys.executable, TINT_SCRIPT, pattern, "--stops", TINT_STOPS, "--backup", TINT_BACKUP]
    if dry_run:
        print("[dry] " + " ".join(command))
        return
    subprocess.run(command, check=True)


def frame_uuids(atlas_dir, names):
    result = []
    for name in names:
        meta = read_json(os.path.join(atlas_dir, name + ".meta"))
        result.append(meta["uuid"] + "@f9941")
    return result


def rewrite_anim(names, uuids, dry_run):
    """改写既有 `.anim` 的帧序列（**文件名与 .meta 不动**，prefab 的 `_clips` 引用因此不受影响）。"""
    path = os.path.join(PROJECTILES, DST_SET, "anim", DST_SET + "-loop.anim")
    clip = read_json(path)
    step = 1.0 / SAMPLE
    track = clip["_tracks"][0]
    curve = track["_channel"]["_curve"]
    curve["_times"] = [round(index * step, 10) for index in range(len(uuids))]
    curve["_values"] = [{"__uuid__": uuid} for uuid in uuids]
    clip["_duration"] = round(len(uuids) * step, 10)
    clip["sample"] = SAMPLE
    if dry_run:
        print("[dry] anim %d 帧 / %.4fs" % (len(uuids), clip["_duration"]))
        return
    write_json(path, clip)
    print("[anim] %s  %d 帧 / sample %d / %.4fs" % (os.path.basename(path), len(uuids), SAMPLE, clip["_duration"]))


def patch_prefab(uuids, canvas, dry_run):
    path = os.path.join(PROJECTILES, DST_SET, DST_SET + ".prefab")
    prefab = read_json(path)
    width, height = canvas
    touched = []
    for entry in prefab:
        if entry.get("__type__") == "cc.Sprite":
            entry["_spriteFrame"]["__uuid__"] = uuids[0]
            touched.append("Sprite._spriteFrame -> 首帧")
        elif entry.get("__type__") == "cc.UITransform":
            entry["_contentSize"]["width"] = width
            entry["_contentSize"]["height"] = height
            touched.append("UITransform -> %dx%d" % (width, height))
        elif entry.get("__type__") == "cc.Node" and entry.get("_name") == "offset":
            scale = entry["_lscale"]
            if abs(scale["x"] - OFFSET_SCALE) > 1e-6 or abs(scale["y"] - OFFSET_SCALE) > 1e-6:
                raise SystemExit("offset._lscale 不是 %s（法师统一 70%%）—— 先确认是不是有人改过" % OFFSET_SCALE)
    if dry_run:
        print("[dry] prefab: " + "; ".join(touched))
        return
    write_json(path, prefab)
    print("[prefab] " + "; ".join(touched))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("源 = %s   目标 = %s" % (SRC_SET, DST_SET))
    names, canvas = copy_and_tint(args.dry_run)
    tint(args.dry_run)
    atlas_dir = os.path.join(PROJECTILES, DST_SET, "atlas")
    if args.dry_run:
        uuids = ["<dry>" for _ in names]
    else:
        uuids = frame_uuids(atlas_dir, names)
    rewrite_anim(names, uuids, args.dry_run)
    patch_prefab(uuids, canvas, args.dry_run)
    print("\n完成：%d 帧，画布 %dx%d，路径 units/projectiles/%s/%s（配置表不用改）"
          % (len(names), canvas[0], canvas[1], DST_SET, DST_SET))


if __name__ == "__main__":
    main()
