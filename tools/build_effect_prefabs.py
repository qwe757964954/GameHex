# -*- coding: utf-8 -*-
"""
子弹_新怪物 / 飞剑术 散图 -> 自动图集(.pac) + 动画 + 预览 Prefab 生成器。
与怪物管线同规范：
  <set>/<frame>.png            散图（拆 plist 已生成，meta 由编辑器自动管理）
  <set>/atlas/<set>.pac        独立自动图集
  <set>/anim/<set>-loop.anim   飞剑术火焰飞剑 5 帧循环（子弹_新怪物为静态图，无 anim）
  <set>/<set>.prefab           根目录预览 Prefab
已存在的 .pac/.anim/.prefab 一律跳过，不覆盖成品。
"""
import json
import os
import uuid as uuid_mod
from PIL import Image

ROOT = r"D:\City1001\Demo3.8"
CLIENT_DIR = os.path.join(ROOT, r"assets\resources\zcds\client\monsters")
LAYER_UI_2D = 33554432  # 1 << 25
SAMPLE = 8
WRAP_LOOP = 2

# set -> (sprite 首帧名, [动画帧名] 或 None)
SETS = {
    "子弹_新怪物": {
        "preview_frame": "亡灵.png",
        "loop_frames": None,  # 静态子弹图，无循环动画
    },
    "飞剑术": {
        "preview_frame": "火焰飞剑_000.png",
        "loop_frames": [f"火焰飞剑_00{i}.png" for i in range(5)],
    },
}


def new_uuid():
    return str(uuid_mod.uuid4())


def new_file_id():
    return uuid_mod.uuid4().hex[:20]


def existing_uuid(meta_path):
    if not os.path.isfile(meta_path):
        return new_uuid()
    with open(meta_path, encoding="utf-8") as f:
        return json.load(f).get("uuid") or new_uuid()


def read_meta_uuid(meta_path):
    with open(meta_path, encoding="utf-8") as f:
        return json.load(f)["uuid"]


def frame_uuid(atlas_dir, fname):
    return read_meta_uuid(os.path.join(atlas_dir, fname + ".meta"))


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def build_pac(meta_uuid):
    return {"__type__": "cc.SpriteAtlas"}, {
        "ver": "1.0.8",
        "importer": "auto-atlas",
        "imported": True,
        "uuid": meta_uuid,
        "files": [".json"],
        "subMetas": {},
        "userData": {
            "maxWidth": 2048,
            "maxHeight": 2048,
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


def build_loop_anim(clip_name, frame_uuids, meta_uuid):
    n = len(frame_uuids)
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
        "_duration": round(n * step, 10),
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
                        "_times": [round(i * step, 10) for i in range(n)],
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


def build_prefab(name, sprite_uuid, width, height, anim_uuid=None):
    """anim_uuid 为空则只建 Sprite（静态图）。"""
    fid_ui, fid_spr, fid_anim, fid_node = [new_file_id() for _ in range(4)]
    components = [{"__id__": 2}, {"__id__": 4}]
    nodes = [
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
            "_components": components,
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
            "_isTrimmedMode": True,
            "_useGrayscale": False,
            "_atlas": None,
            "_id": "",
        },
        {"__type__": "cc.CompPrefabInfo", "fileId": fid_spr},
    ]
    if anim_uuid:
        components.append({"__id__": 6})
        nodes.append(
            {
                "__type__": "cc.Animation",
                "_name": "",
                "_objFlags": 0,
                "__editorExtras__": {},
                "node": {"__id__": 1},
                "_enabled": True,
                "__prefab": {"__id__": 7},
                "_defaultClip": {"__uuid__": anim_uuid},
                "_clips": [{"__uuid__": anim_uuid}],
                "playOnLoad": True,
                "_id": "",
            }
        )
        nodes.append({"__type__": "cc.CompPrefabInfo", "fileId": fid_anim})
    nodes.append(
        {
            "__type__": "cc.PrefabInfo",
            "root": {"__id__": 1},
            "asset": {"__id__": 0},
            "fileId": fid_node,
            "instance": None,
            "targetOverrides": None,
        }
    )
    nodes[1]["_prefab"] = {"__id__": len(nodes) - 1}
    return nodes


def main():
    for set_name, cfg in SETS.items():
        atlas_dir = os.path.join(CLIENT_DIR, set_name)
        if not os.path.isdir(atlas_dir):
            raise RuntimeError(f"目录不存在: {atlas_dir}")

        # 1) pac -> atlas/
        os.makedirs(os.path.join(atlas_dir, "atlas"), exist_ok=True)
        pac_path = os.path.join(atlas_dir, "atlas", f"{set_name}.pac")
        pac_meta_uuid = existing_uuid(pac_path + ".meta")
        pac, pac_meta = build_pac(pac_meta_uuid)
        if not os.path.isfile(pac_path):
            write_json(pac_path, pac)
            write_json(pac_path + ".meta", pac_meta)
            print(f"[pac] {set_name}/atlas/{set_name}.pac")

        # 2) anim -> anim/（仅飞剑术）
        anim_uuid = None
        if cfg["loop_frames"]:
            os.makedirs(os.path.join(atlas_dir, "anim"), exist_ok=True)
            clip_name = f"{set_name}-loop"
            anim_path = os.path.join(atlas_dir, "anim", f"{clip_name}.anim")
            frame_uuids = [
                f"{frame_uuid(atlas_dir, f)}@f9941" for f in cfg["loop_frames"]
            ]
            anim_meta_uuid = existing_uuid(anim_path + ".meta")
            clip, anim_meta = build_loop_anim(clip_name, frame_uuids, anim_meta_uuid)
            if not os.path.isfile(anim_path):
                write_json(anim_path, clip)
                write_json(anim_path + ".meta", anim_meta)
                print(f"[anim] {set_name}/anim/{clip_name}.anim ({len(cfg['loop_frames'])}帧)")
            anim_uuid = anim_meta_uuid

        # 3) prefab -> 根目录
        prefab_path = os.path.join(atlas_dir, f"{set_name}.prefab")
        if os.path.isfile(prefab_path):
            print(f"[跳过] 已存在: {prefab_path}")
            continue
        preview = cfg["preview_frame"]
        sprite_uuid = frame_uuid(atlas_dir, preview)
        with Image.open(os.path.join(atlas_dir, preview)) as im:
            w, h = im.size
        prefab = build_prefab(set_name, sprite_uuid, w, h, anim_uuid)
        prefab_meta_uuid = existing_uuid(prefab_path + ".meta")
        prefab_meta = {
            "ver": "1.1.50",
            "importer": "prefab",
            "imported": True,
            "uuid": prefab_meta_uuid,
            "files": [".json"],
            "subMetas": {},
            "userData": {"syncNodeName": set_name},
        }
        write_json(prefab_path, prefab)
        write_json(prefab_path + ".meta", prefab_meta)
        print(f"[prefab] {set_name}/{set_name}.prefab ({w}x{h}, sprite={preview})")

    print("\n完成，等待 Cocos Creator 导入。")


if __name__ == "__main__":
    main()
