# -*- coding: utf-8 -*-
"""
镭射飞龙_普攻 散图 -> 自动图集(.pac) + 循环动画 + 战斗 Prefab。

与 `build_nut_attack_fx.py`（巨力坚果）同一套落盘格式，**两处不同**：
  1. 画布是**长方形**（640x53），源图 1130x93 是一条横躺的镭射光束，等比缩到 640 宽；
  2. 锚点在**左端中点** `(0, 0.5)`，不是 `(0.5, 0.5)` —— 这是「从眼睛发射、另一端指向目标」
     的实现基础：节点缩放 x 时，光束从锚点向右长出去，不会两头一起长。
     `ZCBeamEffect.ts` 里的 `scaleX = 长度 / 自然宽度` 依赖这个锚点。

Prefab 根节点 `_lpos` / `_lscale` 都保持 (0,0) / (1,1)：光束的发射点由运行时的
`muzzleForward / muzzleLift` 给（见 `ZCBeamEffect.ts`），美术偏置不压在 prefab 里，
否则「换一条更长的光束」要连摆位一起改。

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

SET_NAME = "镭射飞龙_普攻"
FRAMES = [f"zheerniyasi_buff-xian_loop_{i:02d}.png" for i in range(19)]

CANVAS_W = 640           # 1130 -> 640 等比缩（0.566），auto-atlas(<=1024) 一页放得下 19 帧
CANVAS_H = 53            # 93 * 640 / 1130 = 52.7 -> 53
#  根节点缩放：x 恒 1、y 取 0.7。
#  `y = 0.7` 是项目既有的「法师职业普攻子弹特效统一缩到 70%」（2026-10-30），
#  由 `tests/zcds-mage-normal-attack-size.test.ts` 的 ④ 守着 —— 光束类只缩**粗细**，
#  横向永远等于「长度 / 画布宽」，写死多少都会被覆盖，所以 x 保持 1 不误导。
PREFAB_SCALE_X = 1.0
PREFAB_SCALE_Y = 0.7
ANCHOR_X = 0.0           # 左端：发射口
ANCHOR_Y = 0.5

# 光束是常驻循环的闪烁，26fps 一循环 ≈ 0.73s；比近战特效慢，是因为它是「持续照射」不是「一击」
SAMPLE = 26
WRAP_LOOP = 2

LAYER_UI_2D = 33554432  # 1 << 25


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


def frame_uuid(atlas_dir, fname):
    with open(os.path.join(atlas_dir, fname + ".meta"), encoding="utf-8") as f:
        return json.load(f)["uuid"]


def build_sprite_frame_meta(meta_uuid, display_name, width, height):
    """image impostor：type=sprite-frame，子资源 6c48a(texture) + f9941(spriteFrame)。

    trim 数据按**整帧画布**写（不裁剪），配合 Prefab 的 `_isTrimmedMode=false` 锁定逐帧对齐。
    """
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
                        "rawPosition": [
                            -hw, -hh, 0,
                            hw, -hh, 0,
                            -hw, hh, 0,
                            hw, hh, 0,
                        ],
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


def build_loop_anim(clip_name, frame_uuids, meta_uuid):
    step = 1.0 / SAMPLE
    clip = {
        "__type__": "cc.AnimationClip",
        "_name": clip_name,
        "_objFlags": 0,
        "_native": "",
        "sample": SAMPLE,
        "speed": 1,
        "wrapMode": WRAP_LOOP,
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
            "_lscale": {"__type__": "cc.Vec3", "x": PREFAB_SCALE_X, "y": PREFAB_SCALE_Y, "z": 1},
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
            #  左端锚点：光束从节点原点向右长，`scaleX` 直接等于「长度 / width」。
            "_anchorPoint": {"__type__": "cc.Vec2", "x": ANCHOR_X, "y": ANCHOR_Y},
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


def main():
    set_dir = os.path.join(PROJECTILES_DIR, SET_NAME)
    if not os.path.isdir(set_dir):
        raise RuntimeError(f"目录不存在: {set_dir}")
    atlas_dir = os.path.join(set_dir, "atlas")
    anim_dir = os.path.join(set_dir, "anim")
    os.makedirs(atlas_dir, exist_ok=True)
    os.makedirs(anim_dir, exist_ok=True)

    for d in (atlas_dir, anim_dir):
        meta_path = d + ".meta"
        if not os.path.isfile(meta_path):
            write_json(meta_path, build_dir_meta(new_uuid()))
            print(f"[dir]  {os.path.relpath(meta_path, set_dir)}")

    for name in FRAMES:
        src = os.path.join(set_dir, name)
        src_meta = src + ".meta"
        dst = os.path.join(atlas_dir, name)
        dst_meta = dst + ".meta"
        if not os.path.isfile(dst):
            if not os.path.isfile(src):
                raise RuntimeError(f"缺帧: {src}")
            with Image.open(src) as im:
                im = im.convert("RGBA").resize((CANVAS_W, CANVAS_H), Image.LANCZOS)
                im.save(dst, "PNG", optimize=True)
            print(f"[缩图] {name}  {CANVAS_W}x{CANVAS_H}")
        if os.path.isfile(src_meta) and not os.path.isfile(dst_meta):
            shutil.move(src_meta, dst_meta)
        if not os.path.isfile(dst_meta):
            write_json(dst_meta, build_sprite_frame_meta(
                new_uuid(), os.path.splitext(name)[0], CANVAS_W, CANVAS_H))
        with open(dst_meta, encoding="utf-8") as f:
            meta = json.load(f)
        write_json(dst_meta, build_sprite_frame_meta(
            meta["uuid"], os.path.splitext(name)[0], CANVAS_W, CANVAS_H))
        if os.path.isfile(src):
            os.remove(src)
        if os.path.isfile(src_meta):
            os.remove(src_meta)

    pac_path = os.path.join(atlas_dir, f"{SET_NAME}.pac")
    if not os.path.isfile(pac_path):
        pac, pac_meta = build_pac(existing_uuid(pac_path + ".meta"))
        write_json(pac_path, pac)
        write_json(pac_path + ".meta", pac_meta)
        print(f"[pac]  atlas/{SET_NAME}.pac")
    else:
        print("[跳过] 已存在 pac")

    clip_name = f"{SET_NAME}-loop"
    anim_path = os.path.join(anim_dir, f"{clip_name}.anim")
    if not os.path.isfile(anim_path):
        uuids = [f"{frame_uuid(atlas_dir, n)}@f9941" for n in FRAMES]
        clip, anim_meta = build_loop_anim(clip_name, uuids, existing_uuid(anim_path + ".meta"))
        write_json(anim_path, clip)
        write_json(anim_path + ".meta", anim_meta)
        print(f"[anim] anim/{clip_name}.anim  sample={SAMPLE} frames={len(FRAMES)} dur={clip['_duration']:.4f}s")
    else:
        print("[跳过] 已存在 anim")

    prefab_path = os.path.join(set_dir, f"{SET_NAME}.prefab")
    if not os.path.isfile(prefab_path):
        with open(anim_path + ".meta", encoding="utf-8") as f:
            anim_uuid = json.load(f)["uuid"]
        with open(os.path.join(atlas_dir, FRAMES[0] + ".meta"), encoding="utf-8") as f:
            first_uuid = json.load(f)["uuid"]
        prefab = build_prefab(SET_NAME, first_uuid, CANVAS_W, CANVAS_H, anim_uuid)
        prefab_meta = {
            "ver": "1.1.50",
            "importer": "prefab",
            "imported": True,
            "uuid": existing_uuid(prefab_path + ".meta"),
            "files": [".json"],
            "subMetas": {},
            "userData": {"syncNodeName": SET_NAME},
        }
        write_json(prefab_path, prefab)
        write_json(prefab_path + ".meta", prefab_meta)
        print(f"[prefab] {SET_NAME}.prefab  {CANVAS_W}x{CANVAS_H} anchor=({ANCHOR_X},{ANCHOR_Y})")
    else:
        print("[跳过] 已存在 prefab")

    print("\n完成。特效路径 = units/projectiles/%s/%s" % (SET_NAME, SET_NAME))


if __name__ == "__main__":
    main()
