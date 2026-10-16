#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import the remaining PVP unit frame sets into Cocos Creator resources.

The source art uses inconsistent prefixes and some units do not have a run
sequence.  Output is normalized to the same 256x256 bottom-centred canvas as
the existing ZCDS units.  Missing run sequences reuse idle frames.
"""

from __future__ import annotations

from pathlib import Path
import json
import re
import statistics
import uuid

from PIL import Image


SOURCE_ROOT = Path(r"D:\City1001\zarts\art\怪物资源")
OUTPUT_ROOT = Path(r"D:\City1001\Demo3.8\assets\resources\units")
CANVAS_W = 256
CANVAS_H = 256
FOOT_MARGIN = 8
CONTENT_MARGIN = 8
TARGET_IDLE_HEIGHT = 180
SAMPLE = 8
LAYER_UI_2D = 1 << 25

# Runtime unit name -> source folder.
UNITS = {
    "九头蛇": "九头蛇",
    "狼骑兵": "狼骑兵",
    "德鲁伊": "猛禽德鲁伊",
    "萨满": "萨满",
    "亡灵骑士": "亡灵骑士",
    "牛头人": "牛头人战士",
    "步兵": "步兵",
    "近卫变节巫师": "变节巫师",
    "刺杀者": "刺杀者",
}

FRAME_RE = re.compile(r"^.+?-(idle|run|attack)_(\d+)(?:_压缩)?\.png$")


def new_uuid() -> str:
    return str(uuid.uuid4())


def new_file_id() -> str:
    return uuid.uuid4().hex[:20]


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def existing_uuid(meta_path: Path) -> str:
    if meta_path.is_file():
        return json.loads(meta_path.read_text(encoding="utf-8")).get("uuid") or new_uuid()
    return new_uuid()


def directory_meta(path: Path) -> None:
    meta_path = Path(f"{path}.meta")
    write_json(meta_path, {
        "ver": "1.2.0",
        "importer": "directory",
        "imported": True,
        "uuid": existing_uuid(meta_path),
        "files": [],
        "subMetas": {},
        "userData": {},
    })


def select_frames(source_dir: Path) -> dict[str, list[Path]]:
    grouped: dict[str, dict[bool, list[tuple[int, Path]]]] = {}
    for path in source_dir.glob("*.png"):
        match = FRAME_RE.match(path.name)
        if not match:
            continue
        action, index_text = match.groups()
        compressed = "_压缩" in path.stem
        grouped.setdefault(action, {}).setdefault(compressed, []).append((int(index_text), path))

    selected: dict[str, list[Path]] = {}
    for action in ("idle", "run", "attack"):
        choices = grouped.get(action, {})
        frames = choices.get(True) or choices.get(False) or []
        selected[action] = [path for _, path in sorted(frames, key=lambda item: item[0])]
    if not selected["idle"] or not selected["attack"]:
        raise RuntimeError(f"缺少 idle/attack 帧: {source_dir}")
    if not selected["run"]:
        selected["run"] = selected["idle"]
    return selected


def visible_size(path: Path) -> tuple[int, int] | None:
    with Image.open(path) as source:
        box = source.convert("RGBA").getbbox()
    if box is None:
        return None
    return box[2] - box[0], box[3] - box[1]


def unit_scale(frames: dict[str, list[Path]]) -> float:
    idle_heights = [
        size[1]
        for path in frames["idle"]
        for size in [visible_size(path)]
        if size is not None
    ]
    if not idle_heights:
        raise RuntimeError("idle 帧没有可见像素")
    scale = TARGET_IDLE_HEIGHT / statistics.median(idle_heights)
    max_width = CANVAS_W - CONTENT_MARGIN * 2
    max_height = CANVAS_H - FOOT_MARGIN - CONTENT_MARGIN
    for paths in frames.values():
        for path in paths:
            size = visible_size(path)
            if size:
                scale = min(scale, max_width / size[0], max_height / size[1])
    return scale


def normalize_frame(source_path: Path, destination_path: Path, scale: float) -> None:
    with Image.open(source_path) as source:
        image = source.convert("RGBA")
    box = image.getbbox()
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    if box:
        content = image.crop(box)
        size = (max(1, round(content.width * scale)), max(1, round(content.height * scale)))
        if content.size != size:
            content = content.resize(size, Image.Resampling.LANCZOS)
        x = (CANVAS_W - content.width) // 2
        y = CANVAS_H - FOOT_MARGIN - content.height
        canvas.alpha_composite(content, (x, y))
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination_path)


def image_meta(meta_path: Path, display_name: str) -> str:
    base_uuid = existing_uuid(meta_path)
    texture_uuid = f"{base_uuid}@6c48a"
    sprite_uuid = f"{base_uuid}@f9941"
    write_json(meta_path, {
        "ver": "1.0.27",
        "importer": "image",
        "imported": True,
        "uuid": base_uuid,
        "files": [".json", ".png"],
        "subMetas": {
            "6c48a": {
                "importer": "texture", "uuid": texture_uuid, "displayName": display_name,
                "id": "6c48a", "name": "texture",
                "userData": {
                    "wrapModeS": "clamp-to-edge", "wrapModeT": "clamp-to-edge",
                    "minfilter": "linear", "magfilter": "linear", "mipfilter": "none",
                    "anisotropy": 0, "isUuid": True,
                    "imageUuidOrDatabaseUri": base_uuid, "visible": False,
                },
                "ver": "1.0.22", "imported": True, "files": [".json"], "subMetas": {},
            },
            "f9941": {
                "importer": "sprite-frame", "uuid": sprite_uuid, "displayName": display_name,
                "id": "f9941", "name": "spriteFrame",
                "userData": {
                    "trimThreshold": 1, "rotated": False, "offsetX": 0, "offsetY": 0,
                    "trimX": 0, "trimY": 0, "width": CANVAS_W, "height": CANVAS_H,
                    "rawWidth": CANVAS_W, "rawHeight": CANVAS_H,
                    "borderTop": 0, "borderBottom": 0, "borderLeft": 0, "borderRight": 0,
                    "packable": True, "pixelsToUnit": 100, "pivotX": 0.5, "pivotY": 0.5,
                    "meshType": 0,
                    "vertices": {
                        "rawPosition": [-128, -128, 0, 128, -128, 0, -128, 128, 0, 128, 128, 0],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, 256, 256, 256, 0, 0, 256, 0],
                        "nuv": [0, 0, 1, 0, 0, 1, 1, 1],
                        "minPos": [-128, -128, 0], "maxPos": [128, 128, 0],
                    },
                    "isUuid": True, "imageUuidOrDatabaseUri": texture_uuid,
                    "atlasUuid": "", "trimType": "none",
                },
                "ver": "1.0.12", "imported": True, "files": [".json"], "subMetas": {},
            },
        },
        "userData": {
            "type": "sprite-frame", "fixAlphaTransparencyArtifacts": False,
            "hasAlpha": True, "redirect": texture_uuid,
        },
    })
    return sprite_uuid


def build_pac(meta_uuid: str) -> tuple[dict, dict]:
    return {"__type__": "cc.SpriteAtlas"}, {
        "ver": "1.0.8", "importer": "auto-atlas", "imported": True,
        "uuid": meta_uuid, "files": [".json"], "subMetas": {},
        "userData": {
            "maxWidth": 2048, "maxHeight": 2048, "padding": 2,
            "allowRotation": True, "forceSquared": False, "powerOfTwo": True,
            "algorithm": "MaxRects", "format": "png", "quality": 80,
            "contourBleed": True, "paddingBleed": True, "filterUnused": True,
            "removeTextureInBundle": True, "removeImageInBundle": True,
            "removeSpriteAtlasInBundle": True, "compressSettings": {},
            "textureSetting": {
                "wrapModeS": "clamp-to-edge", "wrapModeT": "clamp-to-edge",
                "minfilter": "linear", "magfilter": "linear", "mipfilter": "none",
                "anisotropy": 0,
            },
        },
    }


def build_animation(name: str, action: str, frame_uuids: list[str], meta_uuid: str) -> tuple[dict, dict]:
    step = 1 / SAMPLE
    clip = {
        "__type__": "cc.AnimationClip", "_name": name, "_objFlags": 0, "_native": "",
        "sample": SAMPLE, "speed": 1, "wrapMode": 1 if action == "attack" else 2,
        "events": [], "_duration": round(len(frame_uuids) * step, 10), "_keys": [],
        "_stepness": 0, "curveDatas": {}, "_curves": [], "_commonTargets": [], "_hash": 0,
        "_tracks": [{
            "__type__": "cc.animation.ObjectTrack",
            "_binding": {"__type__": "cc.animation.TrackBinding", "path": {
                "__type__": "cc.animation.TrackPath", "_paths": [
                    {"__type__": "cc.animation.ComponentPath", "component": "cc.Sprite"},
                    "spriteFrame",
                ],
            }, "proxy": None},
            "_channel": {"__type__": "cc.animation.Channel", "_curve": {
                "__type__": "cc.ObjectCurve",
                "_times": [round(i * step, 10) for i in range(len(frame_uuids))],
                "_values": [{"__uuid__": item} for item in frame_uuids],
            }},
        }],
        "_exoticAnimation": None, "_events": [], "_embeddedPlayers": [],
        "_additiveSettings": {"__type__": "cc.AnimationClipAdditiveSettings", "enabled": False, "refClip": None},
        "_auxiliaryCurveEntries": [],
    }
    meta = {
        "ver": "2.0.4", "importer": "animation-clip", "imported": True,
        "uuid": meta_uuid, "files": [".bin"], "subMetas": {}, "userData": {"name": name},
    }
    return clip, meta


def build_prefab(name: str, sprite_uuid: str, clips: dict[str, str]) -> list[dict]:
    ui_id, sprite_id, animation_id, node_id = [new_file_id() for _ in range(4)]
    return [
        {"__type__": "cc.Prefab", "_name": name, "_objFlags": 0, "__editorExtras__": {},
         "_native": "", "data": {"__id__": 1}, "optimizationPolicy": 0, "persistent": False},
        {"__type__": "cc.Node", "_name": name, "_objFlags": 0, "__editorExtras__": {},
         "_parent": None, "_children": [], "_active": True,
         "_components": [{"__id__": 2}, {"__id__": 4}, {"__id__": 6}], "_prefab": {"__id__": 8},
         "_lpos": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
         "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
         "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
         "_mobility": 0, "_layer": LAYER_UI_2D,
         "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0}, "_id": ""},
        {"__type__": "cc.UITransform", "_name": "", "_objFlags": 0, "__editorExtras__": {},
         "node": {"__id__": 1}, "_enabled": True, "__prefab": {"__id__": 3},
         "_contentSize": {"__type__": "cc.Size", "width": 98, "height": 98},
         "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}, "_id": ""},
        {"__type__": "cc.CompPrefabInfo", "fileId": ui_id},
        {"__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "__editorExtras__": {},
         "node": {"__id__": 1}, "_enabled": True, "__prefab": {"__id__": 5}, "_customMaterial": None,
         "_srcBlendFactor": 2, "_dstBlendFactor": 4,
         "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
         "_spriteFrame": {"__uuid__": sprite_uuid, "__expectedType__": "cc.SpriteFrame"},
         "_type": 0, "_fillType": 0, "_sizeMode": 0,
         "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
         "_fillStart": 0, "_fillRange": 0, "_isTrimmedMode": False,
         "_useGrayscale": False, "_atlas": None, "_id": ""},
        {"__type__": "cc.CompPrefabInfo", "fileId": sprite_id},
        {"__type__": "cc.Animation", "_name": "", "_objFlags": 0, "__editorExtras__": {},
         "node": {"__id__": 1}, "_enabled": True, "__prefab": {"__id__": 7}, "playOnLoad": True,
         "_clips": [{"__uuid__": clips[action], "__expectedType__": "cc.AnimationClip"}
                    for action in ("idle", "run", "attack")],
         "_defaultClip": {"__uuid__": clips["idle"], "__expectedType__": "cc.AnimationClip"}, "_id": ""},
        {"__type__": "cc.CompPrefabInfo", "fileId": animation_id},
        {"__type__": "cc.PrefabInfo", "root": {"__id__": 1}, "asset": {"__id__": 0},
         "fileId": node_id, "instance": None, "targetOverrides": None},
    ]


def import_unit(name: str, source_name: str) -> None:
    source_dir = SOURCE_ROOT / source_name
    if not source_dir.is_dir():
        raise FileNotFoundError(source_dir)
    output_dir = OUTPUT_ROOT / name
    atlas_dir = output_dir / "atlas"
    animation_dir = output_dir / "anim"
    output_dir.mkdir(parents=True, exist_ok=True)
    atlas_dir.mkdir(parents=True, exist_ok=True)
    animation_dir.mkdir(parents=True, exist_ok=True)
    for directory in (output_dir, atlas_dir, animation_dir):
        directory_meta(directory)

    source_frames = select_frames(source_dir)
    scale = unit_scale(source_frames)
    frame_uuids: dict[str, list[str]] = {}
    for action in ("idle", "run", "attack"):
        uuids: list[str] = []
        for index, source_path in enumerate(source_frames[action]):
            base_name = f"{name}-{action}_{index}"
            target_path = atlas_dir / f"{base_name}.png"
            normalize_frame(source_path, target_path, scale)
            uuids.append(image_meta(Path(f"{target_path}.meta"), base_name))
        frame_uuids[action] = uuids

    pac_path = atlas_dir / f"{name}.pac"
    pac, pac_meta = build_pac(existing_uuid(Path(f"{pac_path}.meta")))
    write_json(pac_path, pac)
    write_json(Path(f"{pac_path}.meta"), pac_meta)

    clip_uuids: dict[str, str] = {}
    for action in ("idle", "run", "attack"):
        clip_name = f"{name}-{action}"
        clip_path = animation_dir / f"{clip_name}.anim"
        clip_uuid = existing_uuid(Path(f"{clip_path}.meta"))
        clip, clip_meta = build_animation(clip_name, action, frame_uuids[action], clip_uuid)
        write_json(clip_path, clip)
        write_json(Path(f"{clip_path}.meta"), clip_meta)
        clip_uuids[action] = clip_uuid

    prefab_path = output_dir / f"{name}.prefab"
    write_json(prefab_path, build_prefab(name, frame_uuids["idle"][0], clip_uuids))
    prefab_meta_path = Path(f"{prefab_path}.meta")
    write_json(prefab_meta_path, {
        "ver": "1.1.50", "importer": "prefab", "imported": True,
        "uuid": existing_uuid(prefab_meta_path), "files": [".json"],
        "subMetas": {}, "userData": {"syncNodeName": name},
    })
    counts = {action: len(items) for action, items in frame_uuids.items()}
    print(f"{name}: source={source_name}, scale={scale:.4f}, frames={counts}")


def main() -> int:
    for unit_name, source_name in UNITS.items():
        import_unit(unit_name, source_name)
    print(f"已导入 {len(UNITS)} 个 PVP 单位到 {OUTPUT_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
