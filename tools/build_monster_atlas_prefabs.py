# -*- coding: utf-8 -*-
"""
怪物散图 -> 每怪物独立自动图集 + AnimationClip 生成器

输入: assets/resources/zcds/client/monsters/<atlas名>/ 下的 144 张预处理帧
输出:
  monsters/<atlas名>/            每怪物一个目录，统一 256x256、脚点对齐的帧
  monsters/<atlas名>/<atlas名>.pac   独立自动图集
  monsters/<atlas名>/<atlas名>-<动作>.anim  idle/run/attack 动画剪辑 (8fps)
  monsters/<atlas名>/<atlas名>.prefab       Sprite+Animation 预览 prefab
脚点对齐策略: 预处理已把内容归一到 256x256 统一画布(脚点=底部中心)。
本脚本只生成独立 pac/anim，不删除仍由运行时代码使用的旧 TexturePacker 图集。
"""
import json
import os
import re
import sys
import uuid as uuid_mod

ROOT = r"D:\City1001\Demo3.8"
MONSTERS_DIR = os.path.join(ROOT, r"assets\resources\zcds\client\monsters")
CANVAS_W, CANVAS_H = 256, 256
SAMPLE = 8  # fps, 与运行时 Math.floor(t*8) 步进一致

# 帧文件前缀 -> (运行时 atlas 名/目录名)
PREFIX_TO_ATLAS = {
    "民兵叉子": "民兵",
    "弓兵": "精灵弓箭手",
    "骷髅战士": "骷髅战士",
    "亡灵法师": "亡灵法师",
    "弓箭手拆分": "希尔瓦娜斯",
    "伊利丹": "伊利丹",
}
ACTIONS = ["idle", "run", "attack"]
WRAP_LOOP, WRAP_NORMAL = 2, 1  # cc.WrapMode: Loop=2, Normal=1

def new_uuid():
    return str(uuid_mod.uuid4())


def new_file_id():
    return uuid_mod.uuid4().hex[:20]


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def build_spriteframe_meta(old_meta, display_name):
    """texture 类型 meta -> sprite-frame 类型 (trimType none, 不裁剪)"""
    base_uuid = old_meta["uuid"]
    tex_sub = old_meta["subMetas"]["6c48a"]
    tex_sub["displayName"] = display_name
    return {
        "ver": "1.0.27",
        "importer": "image",
        "imported": True,
        "uuid": base_uuid,
        "files": [".json", ".png"],
        "subMetas": {
            "f9941": {
                "importer": "sprite-frame",
                "uuid": f"{base_uuid}@f9941",
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
                    "width": CANVAS_W,
                    "height": CANVAS_H,
                    "rawWidth": CANVAS_W,
                    "rawHeight": CANVAS_H,
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
                            -CANVAS_W / 2, -CANVAS_H / 2, 0,
                            CANVAS_W / 2, -CANVAS_H / 2, 0,
                            -CANVAS_W / 2, CANVAS_H / 2, 0,
                            CANVAS_W / 2, CANVAS_H / 2, 0,
                        ],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, CANVAS_H, CANVAS_W, CANVAS_H, 0, 0, CANVAS_W, 0],
                        "nuv": [0, 0, 1, 0, 0, 1, 1, 1],
                        "minPos": [-CANVAS_W / 2, -CANVAS_H / 2, 0],
                        "maxPos": [CANVAS_W / 2, CANVAS_H / 2, 0],
                    },
                    "isUuid": True,
                    "imageUuidOrDatabaseUri": f"{base_uuid}@6c48a",
                    "atlasUuid": "",
                    "trimType": "none",
                },
                "ver": "1.0.12",
                "imported": True,
                "files": [".json"],
                "subMetas": {},
            },
            "6c48a": tex_sub,
        },
        "userData": {
            "type": "sprite-frame",
            "fixAlphaTransparencyArtifacts": False,
            "hasAlpha": True,
            "redirect": f"{base_uuid}@f9941",
        },
    }


def existing_uuid(meta_path):
    if not os.path.isfile(meta_path):
        return new_uuid()
    with open(meta_path, encoding="utf-8") as file:
        return json.load(file).get("uuid") or new_uuid()


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


def build_anim(name, action, frame_uuids, meta_uuid):
    """3.8 新轨道格式: ObjectTrack -> cc.Sprite.spriteFrame, ObjectCurve 关键帧"""
    n = len(frame_uuids)
    step = 1.0 / SAMPLE
    wrap = WRAP_NORMAL if action == "attack" else WRAP_LOOP
    clip = {
        "__type__": "cc.AnimationClip",
        "_name": name,
        "_objFlags": 0,
        "_native": "",
        "sample": SAMPLE,
        "speed": 1,
        "wrapMode": wrap,
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
        "userData": {"name": name},
    }
    return clip, meta



def main():
    # 1. 扫描每个独立怪物目录。帧搬运由 process_monster_frames.py 完成。
    groups = {}  # atlas -> {action -> [ (index, fname, base_uuid, old_meta|None, src_dir) ]}
    frame_re = re.compile(r"^(.+?)-(idle|run|attack)_(\d+)(?:_压缩)?\.png$")

    def collect(src_dir):
        if not os.path.isdir(src_dir):
            return
        for fname in sorted(os.listdir(src_dir)):
            if not fname.endswith(".png"):
                continue
            m = frame_re.match(fname)
            if not m:
                continue
            prefix, action, idx = m.group(1), m.group(2), int(m.group(3))
            atlas = PREFIX_TO_ATLAS.get(prefix)
            if not atlas:
                print(f"[跳过] 未映射前缀: {fname}")
                continue
            meta_path = os.path.join(src_dir, fname + ".meta")
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
            groups.setdefault(atlas, {}).setdefault(action, []).append(
                (idx, fname, meta["uuid"], src_dir)
            )

    for atlas in dict.fromkeys(PREFIX_TO_ATLAS.values()):
        collect(os.path.join(MONSTERS_DIR, atlas))

    for atlas, actions in sorted(groups.items()):
        for action in actions:
            actions[action].sort(key=lambda x: x[0])
        counts = {a: len(v) for a, v in actions.items()}
        if counts != {"idle": 8, "run": 8, "attack": 8}:
            raise RuntimeError(f"{atlas} 帧数不完整: {counts}")
        print(f"[分组] {atlas}: {counts}")

    expected = set(PREFIX_TO_ATLAS.values())
    if set(groups) != expected:
        raise RuntimeError(f"怪物目录不完整，缺少: {sorted(expected - set(groups))}")

    # 2. 每怪物: 建目录、移帧、改 meta、生成 pac/anim (prefab 由编辑器 MCP 创建)
    for atlas, actions in sorted(groups.items()):
        atlas_dir = os.path.join(MONSTERS_DIR, atlas)
        os.makedirs(atlas_dir, exist_ok=True)
        frame_uuids = {}  # action -> [uuid@f9941]
        for action, frames in actions.items():
            uuids = []
            for idx, fname, base_uuid, src_dir in frames:
                uuids.append(f"{base_uuid}@f9941")
            frame_uuids[action] = uuids

        # .pac -> atlas/ 单独文件夹
        atlas_sub = os.path.join(atlas_dir, "atlas")
        os.makedirs(atlas_sub, exist_ok=True)
        pac_path = os.path.join(atlas_sub, f"{atlas}.pac")
        pac, pac_meta = build_pac(existing_uuid(pac_path + ".meta"))
        write_json(pac_path, pac)
        write_json(pac_path + ".meta", pac_meta)

        # .anim x3 -> anim subfolder
        anim_sub = os.path.join(atlas_dir, "anim")
        os.makedirs(anim_sub, exist_ok=True)
        for action in ACTIONS:
            if action not in frame_uuids:
                continue
            clip_name = f"{atlas}-{action}"
            clip_path = os.path.join(anim_sub, f"{clip_name}.anim")
            clip, clip_meta = build_anim(
                clip_name,
                action,
                frame_uuids[action],
                existing_uuid(clip_path + ".meta"),
            )
            write_json(clip_path, clip)
            write_json(clip_path + ".meta", clip_meta)
        print(f"[完成] {atlas}: pac + {len(frame_uuids)} anim (prefab 走 MCP)")

    print("\n全部完成。请在 Cocos Creator 中等待资源刷新后检查 Console。")


if __name__ == "__main__":
    sys.exit(main())
