# -*- coding: utf-8 -*-
"""
巨力坚果_普攻 散图 -> 自动图集(.pac) + 循环动画 + 战斗 Prefab。

参照 `units/projectiles/豌豆游侠_普攻` 的落盘格式：
  <set>/atlas/<frame>.png + <set>/atlas/<set>.pac   auto-atlas 自动图集
  <set>/anim/<set>-loop.anim                        序列帧动画
  <set>/<set>.prefab                                战斗特效 Prefab

与 `build_effect_prefabs.py` 的差异（都是本项目的硬约束）：
  1. 散图必须放在 `atlas/` 里 —— auto-atlas 只打 `.pac` 同目录的图；
  2. Sprite 用 `_sizeMode = 0 (CUSTOM)` + `_isTrimmedMode = false`，
     UITransform 取**整帧画布**尺寸，保证逐帧换图不跟着新图变形
     （见 docs/zcds-表现层与领地规范.md §1.5）；
  3. 近战事件 `durationSeconds` 恒为 0.32s（ZCCombatSystem.attackTravelSeconds），
     所以 SAMPLE 由帧数反推，让整段恰好播完一遍；
  4. 源图 1947x1947 先等比缩到 CANVAS 再进图集，否则 auto-atlas(<=1024) 打不下。

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

SET_NAME = "巨力坚果_普攻"
FRAMES = [f"140_{i:02d}.png" for i in range(13)]

CANVAS = 168            # 缩图后每帧边长（屏上 = CANVAS * PREFAB_SCALE）
PREFAB_SCALE = 2.0      # 与 普攻爆炸 / 民兵普攻_刀光 同口径
PREFAB_POS = (1.6, 66.536)  # 与 普攻爆炸 / 民兵普攻_刀光 同口径

MELEE_EVENT_SECONDS = 0.32  # ZCCombatSystem.attackTravelSeconds 非投射物分支
SAMPLE = round(len(FRAMES) / MELEE_EVENT_SECONDS)  # 13 / 0.32 ≈ 41 -> 41*13 帧=0.317s

LAYER_UI_2D = 33554432  # 1 << 25
WRAP_LOOP = 2


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


def build_sprite_frame_meta(meta_uuid, display_name, size):
    """image impostor：type=sprite-frame，子资源 6c48a(texture) + f9941(spriteFrame)。

    trim 数据按**整帧画布**写（不裁剪），配合 Prefab 的 `_isTrimmedMode=false`
    锁定逐帧对齐；编辑器重算 trim 也不会改变显示尺寸。
    """
    half = size / 2.0
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
                    "width": size,
                    "height": size,
                    "rawWidth": size,
                    "rawHeight": size,
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
                            -half, -half, 0,
                            half, -half, 0,
                            -half, half, 0,
                            half, half, 0,
                        ],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, size, size, size, 0, 0, size, 0],
                        "nuv": [0, 1, 1, 1, 0, 0, 1, 0],
                        "minPos": [-half, -half, 0],
                        "maxPos": [half, half, 0],
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


def build_prefab(name, sprite_uuid, size, anim_uuid):
    fid_ui, fid_spr, fid_anim, fid_root = [new_file_id() for _ in range(4)]
    half = size
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
            "_lpos": {"__type__": "cc.Vec3", "x": PREFAB_POS[0], "y": PREFAB_POS[1], "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
            "_lscale": {"__type__": "cc.Vec3", "x": PREFAB_SCALE, "y": PREFAB_SCALE, "z": 1},
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
            "_contentSize": {"__type__": "cc.Size", "width": half, "height": half},
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
    with open(path, "rb") as f:
        head = f.read(33)
    return struct.unpack(">II", head[16:24])


def main():
    set_dir = os.path.join(PROJECTILES_DIR, SET_NAME)
    if not os.path.isdir(set_dir):
        raise RuntimeError(f"目录不存在: {set_dir}")
    atlas_dir = os.path.join(set_dir, "atlas")
    anim_dir = os.path.join(set_dir, "anim")
    os.makedirs(atlas_dir, exist_ok=True)
    os.makedirs(anim_dir, exist_ok=True)

    # 0) 目录 meta
    for d in (atlas_dir, anim_dir):
        meta_path = d + ".meta"
        if not os.path.isfile(meta_path):
            write_json(meta_path, build_dir_meta(new_uuid()))
            print(f"[dir]  {os.path.relpath(meta_path, set_dir)}")

    # 1) 缩图 + 搬进 atlas/
    for name in FRAMES:
        src = os.path.join(set_dir, name)
        src_meta = src + ".meta"
        if not os.path.isfile(src):
            raise RuntimeError(f"缺帧: {src}")
        dst = os.path.join(atlas_dir, name)
        dst_meta = dst + ".meta"
        if not os.path.isfile(dst):
            with Image.open(src) as im:
                im = im.convert("RGBA").resize((CANVAS, CANVAS), Image.LANCZOS)
                im.save(dst, "PNG", optimize=True)
            before = os.path.getsize(src) // 1024
            after = os.path.getsize(dst) // 1024
            print(f"[缩图] {name}  {before}KB -> {after}KB  ({CANVAS}x{CANVAS})")
        if os.path.isfile(src_meta) and not os.path.isfile(dst_meta):
            shutil.move(src_meta, dst_meta)
        if not os.path.isfile(dst_meta):
            write_json(dst_meta, build_sprite_frame_meta(new_uuid(), os.path.splitext(name)[0], CANVAS))
        # 统一改写为 sprite-frame + 整帧 trim，重复执行也幂等
        with open(dst_meta, encoding="utf-8") as f:
            meta = json.load(f)
        rebuilt = build_sprite_frame_meta(meta["uuid"], os.path.splitext(name)[0], CANVAS)
        write_json(dst_meta, rebuilt)
        # 清掉根目录的源图，避免同一 uuid 出现两份
        if os.path.isfile(src):
            os.remove(src)
        if os.path.isfile(src_meta):
            os.remove(src_meta)

    # 2) 图集
    pac_path = os.path.join(atlas_dir, f"{SET_NAME}.pac")
    if not os.path.isfile(pac_path):
        pac, pac_meta = build_pac(existing_uuid(pac_path + ".meta"))
        write_json(pac_path, pac)
        write_json(pac_path + ".meta", pac_meta)
        print(f"[pac]  atlas/{SET_NAME}.pac")
    else:
        print("[跳过] 已存在 pac")

    # 3) 动画
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

    # 4) Prefab
    prefab_path = os.path.join(set_dir, f"{SET_NAME}.prefab")
    if not os.path.isfile(prefab_path):
        with open(anim_path + ".meta", encoding="utf-8") as f:
            anim_uuid = json.load(f)["uuid"]
        with open(os.path.join(atlas_dir, FRAMES[0] + ".meta"), encoding="utf-8") as f:
            first_uuid = json.load(f)["uuid"]
        prefab = build_prefab(SET_NAME, first_uuid, CANVAS, anim_uuid)
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
        print(f"[prefab] {SET_NAME}.prefab  {CANVAS}x{CANVAS} scale={PREFAB_SCALE} pos={PREFAB_POS}")
    else:
        print("[跳过] 已存在 prefab")

    print("\n完成。特效路径 = units/projectiles/%s/%s" % (SET_NAME, SET_NAME))


if __name__ == "__main__":
    main()
