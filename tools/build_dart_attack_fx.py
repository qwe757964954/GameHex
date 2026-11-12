# -*- coding: utf-8 -*-
"""玉林好汉_飞镖普攻 散图 -> 自动图集(.pac) + 循环动画 + 战斗 Prefab。

散图（`units/projectiles/玉林好汉_飞镖普攻/427_00.png … 427_24.png`，13 张 450x446）
做成与 `玉米射手_普攻` / `火焰树妖_普攻` 完全同构的三件套：

    <set>/atlas/427_xx.png + <set>/atlas/<set>.pac    auto-atlas 自动图集
    <set>/anim/<set>-loop.anim                        序列帧动画
    <set>/<set>.prefab                                战斗特效 Prefab

与 `build_nut_attack_fx.py`（巨力坚果，**近战**）的差别 —— 这条是**投射物**，按投射物口径：

  · sample 恒 12（玉米射手 / 火焰树妖 / 豌豆游侠 / 科学家 全是 12），时长 = 帧数 / 12；
  · prefab 根 `_lpos` 归零、`_lscale` 按「可见内容宽度」定，不套近战那套 y=66.536 的抬高；
  · 画布取长边 256、等比缩（450x446 -> 256x254），和既有投射物一致；
  · Sprite 仍用 `_sizeMode=0 (CUSTOM)` + `_isTrimmedMode=false`，UITransform 取整帧画布，
    保证逐帧换图不跟着新图变形（docs/zcds-表现层与领地规范.md §1.5）。

尺寸口径（同 §1.11 的算法，只是这里按**屏上观感**而不是技能范围反算）：
    源图可见内容宽 ≈ 272~302 px / 450 画布 ≈ 62%
    画布 256 时内容宽 ≈ 158~172 px；再乘 `_lscale = 0.5` ⇒ 屏上 79~86 px（约 0.65 格顶面）
    参照：玉米射手 55px、豌豆游侠 49px、火焰树妖 228px —— 飞镖取中间偏小。
要改大小**只动 prefab 根 `_lscale` 这一个数**，不要动画布（§1.10）。

可重入：已存在的 .png / .pac / .anim / .prefab 一律跳过，不覆盖成品。
"""
import copy
import hashlib
import json
import os
import shutil
import struct
import uuid as uuid_mod

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTILES_DIR = os.path.join(ROOT, "assets", "bundles", "battle", "units", "projectiles")

SET_NAME = "玉林好汉_飞镖普攻"
PREFAB_TEMPLATE = "玉米射手_普攻"   # 两级节点结构的模板，见 build_prefab 注释
FRAMES = [f"427_{i:02d}.png" for i in range(0, 25, 2)]  # 427_00 … 427_24，共 13 帧

CANVAS_W = 256           # 长边，与既有投射物特效一致
CANVAS_H = 254           # 450x446 等比缩到 256 宽 => round(446 * 256 / 450) = 254
PREFAB_SCALE = 0.5       # 屏上内容宽 ≈ 80px（约 0.65 格），只改这一个数就能调大小
PREFAB_POS = (0.0, 0.0)  # 投射物不抬高，锚点由事件坐标给

SAMPLE = 12              # 所有投射物特效的既有节奏
LAYER_UI_2D = 33554432   # 1 << 25
WRAP_LOOP = 2

#  Sprite 的烘焙染色（`cc.Sprite._color`）。缺省 None ⇒ 不写这个字段（= 白色，原样）。
#  只有「同一份美术要换个色系复用」时才给，例：持续光环伤害效果叠成黄色（见 build_aura_fx.py）。
PREFAB_COLOR = None

#  只取散图里的一段帧时（循环段不是第 1 帧起），剩下的散图会留在 bundle 里被打包。
#  置 True ⇒ 把 `FRAMES` 之外的 `*.png` / `*.png.meta` 一起搬进 tmp 缓存。
CACHE_UNUSED_FRAMES = False


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


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(33)
    return struct.unpack(">II", head[16:24])


def build_sprite_frame_meta(meta_uuid, display_name, width, height):
    """image impostor：type=sprite-frame，子资源 6c48a(texture) + f9941(spriteFrame)。

    按**整帧画布**写（不裁剪），`trimType: none` + prefab 的 `_isTrimmedMode=false`
    一起锁死逐帧对齐；编辑器重算 trim 也不会改变显示尺寸。
    """
    half_w, half_h = width / 2.0, height / 2.0
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
                            -half_w, -half_h, 0,
                            half_w, -half_h, 0,
                            -half_w, half_h, 0,
                            half_w, half_h, 0,
                        ],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, height, width, height, 0, 0, width, 0],
                        "nuv": [0, 1, 1, 1, 0, 0, 1, 0],
                        "minPos": [-half_w, -half_h, 0],
                        "maxPos": [half_w, half_h, 0],
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


def build_prefab(name, sprite_uuid, width, height, anim_uuid, seed):
    """**以既有投射物 prefab 为模板**深拷贝，只替换必要字段。

    为什么不用手写结构：全工程 40+ 个投射物 prefab 都是**两级**节点 ——
    根 `Node`（只做分组、`_lscale = 1`、无组件）+ 子节点 `offset`（`_lscale` 才是尺寸真源，
    承载 UITransform / Sprite / Animation）。手写单层也能跑（`ZCCombatEffectView` 用
    `getComponent(Animation) ?? getComponentInChildren(Animation)` 都能找到），但
    「同样格式」这件事上会留一个肉眼可见的差异，后面按 prefab 结构写的用例也会误判。

    模板固定取 `玉米射手_普攻`（同样是 `mode: projectile` 的 6 帧序列帧）。
    `fileId` 由 `seed`（prefab 的 meta uuid）派生 ⇒ 重跑脚本不会让工程文件无意义地抖动。
    """
    template_path = os.path.join(PROJECTILES_DIR, PREFAB_TEMPLATE, f"{PREFAB_TEMPLATE}.prefab")
    with open(template_path, encoding="utf-8") as f:
        config = json.load(f)
    config = copy.deepcopy(config)

    def file_id(purpose):
        return hashlib.md5(f"{seed}:{purpose}".encode("utf-8")).hexdigest()[:20]

    nodes = [item for item in config if item.get("__type__") == "cc.Node"]
    root, offset_node = nodes[0], nodes[1]
    root["_name"] = name
    offset_node["_lscale"] = {"__type__": "cc.Vec3",
                              "x": PREFAB_SCALE, "y": PREFAB_SCALE, "z": 1}
    offset_node["_lpos"] = {"__type__": "cc.Vec3",
                            "x": PREFAB_POS[0], "y": PREFAB_POS[1], "z": 0}

    for item in config:
        kind = item.get("__type__")
        if kind == "cc.UITransform":
            item["_contentSize"] = {"__type__": "cc.Size", "width": width, "height": height}
        elif kind == "cc.Sprite":
            item["_spriteFrame"] = {"__uuid__": f"{sprite_uuid}@f9941",
                                    "__expectedType__": "cc.SpriteFrame"}
            item["_sizeMode"] = 0
            item["_isTrimmedMode"] = False
            if PREFAB_COLOR is not None:
                r, g, b = PREFAB_COLOR
                item["_color"] = {"__type__": "cc.Color", "r": r, "g": g, "b": b, "a": 255}
        elif kind == "cc.Animation":
            item["_clips"] = [{"__uuid__": anim_uuid, "__expectedType__": "cc.AnimationClip"}]
            item["_defaultClip"] = {"__uuid__": anim_uuid, "__expectedType__": "cc.AnimationClip"}
            item["playOnLoad"] = False
        elif kind == "cc.CompPrefabInfo":
            item["fileId"] = file_id("comp-%d" % config.index(item))
        elif kind == "cc.PrefabInfo":
            item["fileId"] = file_id("node-%d" % config.index(item))
    return config


def main():
    set_dir = os.path.join(PROJECTILES_DIR, SET_NAME)
    if not os.path.isdir(set_dir):
        raise RuntimeError(f"目录不存在: {set_dir}")
    atlas_dir = os.path.join(set_dir, "atlas")
    anim_dir = os.path.join(set_dir, "anim")
    os.makedirs(atlas_dir, exist_ok=True)
    os.makedirs(anim_dir, exist_ok=True)

    # 0) 子目录 meta
    for d in (atlas_dir, anim_dir):
        meta_path = d + ".meta"
        if not os.path.isfile(meta_path):
            write_json(meta_path, build_dir_meta(new_uuid()))
            print(f"[dir]  {os.path.relpath(meta_path, set_dir)}")

    # 1) 缩图 + 搬进 atlas/，并把 meta 改写成「整帧不裁剪」的 sprite-frame
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
            before = os.path.getsize(src) // 1024
            after = os.path.getsize(dst) // 1024
            print(f"[缩图] {name}  {before}KB -> {after}KB  ({CANVAS_W}x{CANVAS_H})")
        if os.path.isfile(src_meta) and not os.path.isfile(dst_meta):
            shutil.move(src_meta, dst_meta)
        if not os.path.isfile(dst_meta):
            write_json(dst_meta, build_sprite_frame_meta(
                new_uuid(), os.path.splitext(name)[0], CANVAS_W, CANVAS_H))
        with open(dst_meta, encoding="utf-8") as f:
            meta = json.load(f)
        write_json(dst_meta, build_sprite_frame_meta(
            meta["uuid"], os.path.splitext(name)[0], CANVAS_W, CANVAS_H))
        # 根目录的源图**搬到 assets 之外**（`tmp/projectile_src/<set>/`）：既不留在
        # bundle 里被打包，也不销毁原始尺寸 —— 以后要更高分辨率的图集还能拿回来重跑。
        src_cache = os.path.join(ROOT, "tmp", "projectile_src", SET_NAME)
        for stale in (src, src_meta):
            if os.path.isfile(stale):
                os.makedirs(src_cache, exist_ok=True)
                shutil.move(stale, os.path.join(src_cache, os.path.basename(stale)))

    # 1.5) 只用一段帧时，把剩下的散图也搬出 bundle（见 CACHE_UNUSED_FRAMES）
    if CACHE_UNUSED_FRAMES:
        wanted = set(FRAMES)
        src_cache = os.path.join(ROOT, "tmp", "projectile_src", SET_NAME)
        moved = 0
        for entry in sorted(os.listdir(set_dir)):
            base_name = entry[:-5] if entry.endswith(".meta") else entry
            if not base_name.lower().endswith(".png") or base_name in wanted:
                continue
            os.makedirs(src_cache, exist_ok=True)
            shutil.move(os.path.join(set_dir, entry), os.path.join(src_cache, entry))
            moved += 1
        if moved:
            print(f"[缓存] {moved} 个未用散图 -> tmp/projectile_src/{SET_NAME}/")

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
        print(f"[anim] anim/{clip_name}.anim  sample={SAMPLE} frames={len(FRAMES)} dur={clip['_duration']:.3f}s")
    else:
        print("[跳过] 已存在 anim")

    # 4) Prefab —— **始终重写**：内容是确定的，重跑只是把结构刷成模板口径
    prefab_path = os.path.join(set_dir, f"{SET_NAME}.prefab")
    with open(anim_path + ".meta", encoding="utf-8") as f:
        anim_uuid = json.load(f)["uuid"]
    with open(os.path.join(atlas_dir, FRAMES[0] + ".meta"), encoding="utf-8") as f:
        first_uuid = json.load(f)["uuid"]
    prefab_uuid = existing_uuid(prefab_path + ".meta")
    prefab = build_prefab(SET_NAME, first_uuid, CANVAS_W, CANVAS_H, anim_uuid, prefab_uuid)
    write_json(prefab_path, prefab)
    write_json(prefab_path + ".meta", {
        "ver": "1.1.50",
        "importer": "prefab",
        "imported": True,
        "uuid": prefab_uuid,
        "files": [".json"],
        "subMetas": {},
        "userData": {"syncNodeName": SET_NAME},
    })
    print(f"[prefab] {SET_NAME}.prefab  {CANVAS_W}x{CANVAS_H} scale={PREFAB_SCALE} pos={PREFAB_POS}"
          f"（模板 {PREFAB_TEMPLATE}）")

    print("\n完成。特效路径 = units/projectiles/%s/%s" % (SET_NAME, SET_NAME))


if __name__ == "__main__":
    main()
