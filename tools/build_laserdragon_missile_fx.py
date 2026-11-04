# -*- coding: utf-8 -*-
"""
镭射飞龙「追踪导弹」的两个特效：散图 -> 自动图集(.pac) + 动画 + 战斗 Prefab。

  1. `units/projectiles/镭射飞龙_导弹技能`      —— 飞行段的弹体（4 帧循环，81×77）
  2. `units/projectiles/镭射飞龙_导弹技能命中`  —— 停下后的爆炸（12 帧单次，225×215）

与 `build_laser_beam_fx.py`（镭射飞龙_普攻）同一套落盘格式，三处不同：
  · 锚点在**中心** `(0.5, 0.5)` —— 这两份是「一个完整的物件」，不是从一端长出去的射线；
  · 弹体是**循环**动画（WrapMode 2），爆炸是**单次**（WrapMode 1）—— 爆炸播完就停，
    循环会让 80px 的爆炸一直在原地闪；
  · 画布保持**原图尺寸**，不做等比缩放：爆炸的最终大小由 `ZCCombatEffectScale.ts` 的
    `NODE_SCALE_BY_PREFAB_PATH` 统一乘（80px ÷ 225px），与「判定半径 80」同一个数，
    改半径只改那一处 + 配表，不用回来重新烘图。

可重入：已存在的 .pac / .anim / .prefab 一律跳过，不覆盖成品。
"""
import json
import os
import shutil
import struct
import uuid as uuid_mod

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTILES_DIR = os.path.join(ROOT, "assets", "bundles", "battle", "units", "projectiles")

LAYER_UI_2D = 33554432  # 1 << 25

SETS = [
    {
        "set": "镭射飞龙_导弹技能",
        "frames": [f"vfx_bullet_goblinbomber_01_01-idle_{i}.png" for i in range(4)],
        "canvas": (81, 77),
        "clip": "loop",
        "wrap": 2,
        "sample": 24,
    },
    {
        "set": "镭射飞龙_导弹技能命中",
        "frames": [f"vfx_bullet_goblinbomber_01_01-hit_{i:02d}.png" for i in range(12)],
        "canvas": (225, 215),
        "clip": "once",
        "wrap": 1,
        "sample": 26,
    },
]


def new_uuid():
    return str(uuid_mod.uuid4())


def new_file_id():
    return uuid_mod.uuid4().hex[:20]


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def existing_uuid(meta_path):
    if os.path.isfile(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        if meta.get("uuid"):
            return meta["uuid"]
    return new_uuid()


def build_sprite_frame_meta(meta_uuid, display_name, width, height):
    hw, hh = width / 2.0, height / 2.0
    return {
        "ver": "1.0.27",
        "importer": "image",
        "imported": True,
        "uuid": meta_uuid,
        "files": [".json", ".png"],
        "subMetas": {
            "6c48a": {
                "importer": "texture",
                "uuid": f"{meta_uuid}@6c48a",
                "displayName": display_name,
                "id": "6c48a",
                "name": "texture",
                "userData": {
                    "wrapModeS": "clamp-to-edge",
                    "wrapModeT": "clamp-to-edge",
                    "imageUuidOrDatabaseUri": meta_uuid,
                    "isUuid": True,
                    "visible": False,
                    "minfilter": "linear",
                    "magfilter": "linear",
                    "mipfilter": "none",
                    "anisotropy": 0,
                },
                "ver": "1.0.22",
                "imported": True,
                "files": [".json"],
                "subMetas": {},
            },
            "f9941": {
                "importer": "sprite-frame",
                "uuid": f"{meta_uuid}@f9941",
                "displayName": display_name,
                "id": "f9941",
                "name": "spriteFrame",
                "userData": {
                    "trimThreshold": 1,
                    "rotated": False,
                    "offsetX": 0,
                    "offsetY": 0,
                    "trimX": 0,
                    "trimY": 0,
                    "width": width,
                    "height": height,
                    "rawWidth": width,
                    "rawHeight": height,
                    "borderTop": 0,
                    "borderBottom": 0,
                    "borderLeft": 0,
                    "borderRight": 0,
                    "packable": True,
                    "pixelsToUnit": 100,
                    "pivotX": 0.5,
                    "pivotY": 0.5,
                    "meshType": 0,
                    "vertices": {
                        "rawPosition": [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, height, width, height, 0, 0, width, 0],
                        "nuv": [0, 1, 1, 1, 0, 0, 1, 0],
                        "minPos": [-hw, -hh, 0],
                        "maxPos": [hw, hh, 0],
                    },
                    "isUuid": True,
                    "imageUuidOrDatabaseUri": f"{meta_uuid}@6c48a",
                    "atlasUuid": "",
                    "trimType": "none",
                },
                "ver": "1.0.12",
                "imported": True,
                "files": [".json"],
                "subMetas": {},
            },
        },
        "userData": {
            "type": "sprite-frame",
            "fixAlphaTransparencyArtifacts": False,
            "hasAlpha": True,
            "redirect": f"{meta_uuid}@6c48a",
        },
    }


def build_dir_meta(meta_uuid):
    return {
        "ver": "1.2.0",
        "importer": "directory",
        "imported": True,
        "uuid": meta_uuid,
        "files": [],
        "subMetas": {},
        "userData": {},
    }


def build_pac(meta_uuid):
    pac = {"__type__": "cc.SpriteAtlas"}
    meta = {
        "ver": "1.0.8",
        "importer": "auto-atlas",
        "imported": True,
        "uuid": meta_uuid,
        "files": [".json"],
        "subMetas": {},
        "userData": {
            "maxWidth": 1024,
            "maxHeight": 1024,
            "padding": 2,
            "allowRotation": True,
            "forceSquared": False,
            "powerOfTwo": True,
            "algorithm": "MaxRects",
            "format": "png",
            "quality": 80,
            "contourBleed": True,
            "paddingBleed": True,
            "filterUnused": True,
            "removeTextureInBundle": True,
            "removeImageInBundle": True,
            "removeSpriteAtlasInBundle": True,
            "compressSettings": {},
            "textureSetting": {
                "wrapModeS": "clamp-to-edge",
                "wrapModeT": "clamp-to-edge",
                "minfilter": "linear",
                "magfilter": "linear",
                "mipfilter": "none",
                "anisotropy": 0,
            },
        },
    }
    return pac, meta


def build_anim(clip_name, frame_uuids, meta_uuid, sample, wrap):
    step = 1.0 / sample
    clip = {
        "__type__": "cc.AnimationClip",
        "_name": clip_name,
        "_objFlags": 0,
        "_native": "",
        "sample": sample,
        "speed": 1,
        "wrapMode": wrap,
        "events": [],
        "_duration": round(len(frame_uuids) * step, 10),
        "_keys": [],
        "_stepness": 0,
        "curveDatas": {},
        "_curves": [],
        "_commonTargets": [],
        "_hash": 0,
        "_tracks": [
            {
                "__type__": "cc.animation.ObjectTrack",
                "_binding": {
                    "__type__": "cc.animation.TrackBinding",
                    "path": {
                        "__type__": "cc.animation.TrackPath",
                        "_paths": [
                            {"__type__": "cc.animation.ComponentPath", "component": "cc.Sprite"},
                            "spriteFrame",
                        ],
                    },
                    "proxy": None,
                },
                "_channel": {
                    "__type__": "cc.animation.Channel",
                    "_curve": {
                        "__type__": "cc.ObjectCurve",
                        "_times": [round(i * step, 10) for i in range(len(frame_uuids))],
                        "_values": [{"__uuid__": u} for u in frame_uuids],
                    },
                },
            }
        ],
        "_exoticAnimation": None,
        "_events": [],
        "_embeddedPlayers": [],
        "_additiveSettings": {
            "__type__": "cc.AnimationClipAdditiveSettings",
            "enabled": False,
            "refClip": None,
        },
        "_auxiliaryCurveEntries": [],
    }
    meta = {
        "ver": "2.0.4",
        "importer": "animation-clip",
        "imported": True,
        "uuid": meta_uuid,
        "files": [".bin"],
        "subMetas": {},
        "userData": {"name": clip_name},
    }
    return clip, meta


def build_prefab(name, sprite_uuid, width, height, anim_uuid):
    fid_ui, fid_spr, fid_anim, fid_root = [new_file_id() for _ in range(4)]
    return [
        {
            "__type__": "cc.Prefab",
            "_name": name,
            "_objFlags": 0,
            "__editorExtras__": {},
            "_native": "",
            "data": {"__id__": 1},
            "optimizationPolicy": 0,
            "persistent": False,
        },
        {
            "__type__": "cc.Node",
            "_name": name,
            "_objFlags": 0,
            "__editorExtras__": {},
            "_parent": None,
            "_children": [],
            "_active": True,
            "_components": [{"__id__": 2}, {"__id__": 4}, {"__id__": 6}],
            "_prefab": {"__id__": 8},
            "_lpos": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
            "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
            "_mobility": 0,
            "_layer": LAYER_UI_2D,
            "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_id": "",
        },
        {
            "__type__": "cc.UITransform",
            "_name": "",
            "_objFlags": 0,
            "__editorExtras__": {},
            "node": {"__id__": 1},
            "_enabled": True,
            "__prefab": {"__id__": 3},
            "_contentSize": {"__type__": "cc.Size", "width": width, "height": height},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
            "_id": "",
        },
        {"__type__": "cc.CompPrefabInfo", "fileId": fid_ui},
        {
            "__type__": "cc.Sprite",
            "_name": "",
            "_objFlags": 0,
            "__editorExtras__": {},
            "node": {"__id__": 1},
            "_enabled": True,
            "__prefab": {"__id__": 5},
            "_customMaterial": None,
            "_srcBlendFactor": 2,
            "_dstBlendFactor": 4,
            "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_spriteFrame": {"__uuid__": f"{sprite_uuid}@f9941", "__expectedType__": "cc.SpriteFrame"},
            "_type": 0,
            "_fillType": 0,
            "_sizeMode": 0,
            "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0,
            "_fillRange": 0,
            "_isTrimmedMode": False,
            "_useGrayscale": False,
            "_atlas": None,
            "_id": "",
        },
        {"__type__": "cc.CompPrefabInfo", "fileId": fid_spr},
        {
            "__type__": "cc.Animation",
            "_name": "",
            "_objFlags": 0,
            "__editorExtras__": {},
            "node": {"__id__": 1},
            "_enabled": True,
            "__prefab": {"__id__": 7},
            "playOnLoad": False,
            "_clips": [{"__uuid__": anim_uuid, "__expectedType__": "cc.AnimationClip"}],
            "_id": "",
            "_defaultClip": {"__uuid__": anim_uuid, "__expectedType__": "cc.AnimationClip"},
        },
        {"__type__": "cc.CompPrefabInfo", "fileId": fid_anim},
        {
            "__type__": "cc.PrefabInfo",
            "root": {"__id__": 1},
            "asset": {"__id__": 0},
            "fileId": fid_root,
            "targetOverrides": None,
            "nestedPrefabInstanceRoots": None,
            "instance": None,
        },
    ]


def png_size(path):
    with open(path, "rb") as fh:
        head = fh.read(33)
    return struct.unpack(">II", head[16:24])


def build_one(cfg):
    set_name = cfg["set"]
    frames = cfg["frames"]
    width, height = cfg["canvas"]
    set_dir = os.path.join(PROJECTILES_DIR, set_name)
    if not os.path.isdir(set_dir):
        raise RuntimeError(f"目录不存在: {set_dir}")
    atlas_dir = os.path.join(set_dir, "atlas")
    anim_dir = os.path.join(set_dir, "anim")
    os.makedirs(atlas_dir, exist_ok=True)
    os.makedirs(anim_dir, exist_ok=True)

    print(f"\n===== {set_name} =====")
    for d in (atlas_dir, anim_dir):
        meta_path = d + ".meta"
        if not os.path.isfile(meta_path):
            write_json(meta_path, build_dir_meta(new_uuid()))
            print(f"[dir]  {os.path.relpath(meta_path, set_dir)}")

    for name in frames:
        src = os.path.join(set_dir, name)
        src_meta = src + ".meta"
        dst = os.path.join(atlas_dir, name)
        dst_meta = dst + ".meta"
        if not os.path.isfile(dst):
            if not os.path.isfile(src):
                raise RuntimeError(f"缺帧: {src}")
            real = png_size(src)
            with Image.open(src) as im:
                im = im.convert("RGBA")
                if real != (width, height):
                    im = im.resize((width, height), Image.LANCZOS)
                im.save(dst, "PNG", optimize=True)
            print(f"[图]   {name}  {real[0]}x{real[1]} -> {width}x{height}")
        if os.path.isfile(src_meta) and not os.path.isfile(dst_meta):
            shutil.move(src_meta, dst_meta)
        uuid = existing_uuid(dst_meta)
        write_json(dst_meta, build_sprite_frame_meta(uuid, os.path.splitext(name)[0], width, height))
        if os.path.isfile(src):
            os.remove(src)

    pac_path = os.path.join(atlas_dir, f"{set_name}.pac")
    if not os.path.isfile(pac_path):
        pac, pac_meta = build_pac(existing_uuid(pac_path + ".meta"))
        write_json(pac_path, pac)
        write_json(pac_path + ".meta", pac_meta)
        print(f"[pac]  atlas/{set_name}.pac")

    clip_name = f"{set_name}-{cfg['clip']}"
    anim_path = os.path.join(anim_dir, f"{clip_name}.anim")
    if not os.path.isfile(anim_path):
        uuids = []
        for n in frames:
            with open(os.path.join(atlas_dir, n + ".meta"), encoding="utf-8") as f:
                uuids.append(json.load(f)["uuid"] + "@f9941")
        clip, anim_meta = build_anim(clip_name, uuids, existing_uuid(anim_path + ".meta"),
                                     cfg["sample"], cfg["wrap"])
        write_json(anim_path, clip)
        write_json(anim_path + ".meta", anim_meta)
        print(f"[anim] anim/{clip_name}.anim  sample={cfg['sample']} frames={len(frames)} "
              f"wrap={cfg['wrap']} dur={clip['_duration']:.3f}s")

    prefab_path = os.path.join(set_dir, f"{set_name}.prefab")
    if not os.path.isfile(prefab_path):
        with open(anim_path + ".meta", encoding="utf-8") as f:
            anim_uuid = json.load(f)["uuid"]
        with open(os.path.join(atlas_dir, frames[0] + ".meta"), encoding="utf-8") as f:
            first_uuid = json.load(f)["uuid"]
        prefab = build_prefab(set_name, first_uuid, width, height, anim_uuid)
        prefab_meta = {
            "ver": "1.1.50",
            "importer": "prefab",
            "imported": True,
            "uuid": existing_uuid(prefab_path + ".meta"),
            "files": [".json"],
            "subMetas": {},
            "userData": {"syncNodeName": set_name},
        }
        write_json(prefab_path, prefab)
        write_json(prefab_path + ".meta", prefab_meta)
        print(f"[prefab] {set_name}.prefab  {width}x{height} anchor=(0.5,0.5)")
    else:
        print("[跳过] 已存在 prefab")


def main():
    for cfg in SETS:
        build_one(cfg)
    print("\n完成。")
    for cfg in SETS:
        print("  units/projectiles/%s/%s" % (cfg["set"], cfg["set"]))


if __name__ == "__main__":
    main()
