# -*- coding: utf-8 -*-
"""
镭射飞龙_普攻 散图 -> **横向归一化的图集** + 循环动画 + 战斗 Prefab。

2026-11-10 换成美术新给的 `zheerniyasi_buff-xian_loop4_00~15`（16 帧，源图 1165×73），
旧的 19 帧 `prefix_loop_00~18` 退役。与旧版流程的**两点不同**：

  1. **横向归一化**（`normalize_frame`）。新美术的 16 帧**没有对齐**：可见段左端在 83~88 之间晃，
     右端从 704 一路漂到 1097 —— 而且帧 10 起尾巴上还甩出一颗小光斑往前飞。
     不归一化的话，光柱末端每循环一次就"缩回去"一次（旧美术 2026-11-05 踩过同一个坑，
     见 `ZCBeamEffect.contentStart` 的注释）。这里把**每帧的光束主体**统一映射到画布
     `[BODY_X0, BODY_X1]`，那颗飞行光斑由 `drop_flying_spark` 先抹掉（它会被拉伸到命中点之外，
     变成"目标旁边一个闪烁红点"）。
  2. 画布从 640×53 变成 **700×73**（新美术更高更"软"，左右还要留出柔光余量），
     但**锚点仍是左端中点 `(0, 0.5)`** ——
     `ZCBeamEffect` 的 `scaleX = 长度 / 可见段宽` 靠这个锚点只往右长。

⚠️ 归一化只重采样**横向**，纵向一个像素都不动：`ZCBeamEffect.widthScale` 是按"可见亮带厚度"
标定的（新美术 ≈ 52px 柔光 / 4.5px 亮芯），纵向一旦缩放这个标定就失真。

源图放在 `tools/art/sources/laser-beam-v2/`（**不在 assets 里**，避免被 asset-db 一起导入）；
产物写进 `assets/.../atlas/`，并复用已有的 `.meta` uuid，这样 anim / prefab 的引用不会断。

用法：
    python tools/build_laser_beam_fx.py            # 只打印将要做什么
    python tools/build_laser_beam_fx.py --write    # 真的落盘
    python tools/build_laser_beam_fx.py --write --force   # 连已存在的产物一起覆盖
"""
import argparse
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTILES_DIR = os.path.join(ROOT, "assets", "bundles", "battle", "units", "projectiles")
SRC_DIR = os.path.join(ROOT, "tools", "art", "sources", "laser-beam-v2")

SET_NAME = "镭射飞龙_普攻"
FRAME_COUNT = 16
FRAME_FMT = "zheerniyasi_buff-xian_loop4_{:02d}.png"
#  退役的旧素材（同目录、同 meta 命名）：落盘时清掉，否则图集里会留着 19 帧没人用的图。
LEGACY_FMT = "zheerniyasi_buff-xian_loop_{:02d}.png"
LEGACY_COUNT = 19

CANVAS_W = 700
CANVAS_H = 73            # 源图高度，纵向不缩放
#  归一化目标：光束主体（可见段）在画布里的位置。左右各留 72 是实测出来的：
#  每帧**主体之外还有一圈柔光**（alpha≈8~30），主体对齐后这圈柔光最宽会探出 45~52px
#  （帧 08 左边 51、帧 10 右边 58），留 72 才不会被画布边裁出一道硬边。
#  `ZCBeamEffect.contentStart/End` 就是这两个数 / 700。
BODY_X0 = 72
BODY_X1 = 628
#  纵向平移：新美术的 alpha 重心在 33.6/73（偏上 2.9px），旧美术在 28.8/53（偏下 2.3px）。
#  统一挪到画布中央，`muzzleLift` 的语义（= 光柱中心离脚点多高）才不会跟着素材漂。
#  取整 +2（不是 +2.9）：底行最多只有 alpha≈10 的柔光，再往下就要裁掉，得不偿失。
VERTICAL_SHIFT = 2

#  主体判定：列 alpha 总和的**最长连续段**。阈值 12% 峰值能把"亮芯变细"的帧仍然算进主体，
#  又能把甩出去的那颗孤立光斑（跟主体之间隔着一大片全透明）切成另一段。
BODY_COL_RATIO = 0.12
BODY_COL_FLOOR = 200

#  「飞出去的小光斑」判据，见 `drop_flying_spark`。
SPARK_GUARD = 30
SPARK_ALPHA = 90

PREFAB_SCALE_X = 1.0
PREFAB_SCALE_Y = 0.7     # 法师普攻统一缩到 70%（`zcds-mage-normal-attack-size` ④ 守着）
ANCHOR_X = 0.0
ANCHOR_Y = 0.5

SAMPLE = 26
WRAP_LOOP = 2

LAYER_UI_2D = 33554432


# ── 图片处理 ──────────────────────────────────────────────────────────────

def body_span(im):
    """这一帧「光束主体」的列区间 `[L, R]`（含端点）。"""
    alpha = im.split()[3]
    px = alpha.load()
    width, height = im.size
    colsum = [sum(px[x, y] for y in range(height)) for x in range(width)]
    threshold = max(max(colsum) * BODY_COL_RATIO, BODY_COL_FLOOR)

    runs, start = [], None
    for x, value in enumerate(colsum):
        if value >= threshold and start is None:
            start = x
        elif value < threshold and start is not None:
            runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, width - 1))
    return max(runs, key=lambda run: run[1] - run[0])


def drop_flying_spark(frame, body_right):
    """把主体右端 `SPARK_GUARD` px 之外那颗「飞出去的小光斑」抹掉。

    新素材帧 10~15 的尾巴上挂着一颗 5px 宽、alpha≈180 的亮斑往外飞，每帧右移 67px。
    在源图里它是「能量甩出去」的表现，但我们的光柱是**按目标距离拉伸**的：`contentEnd`
    之后的部分会落到命中点**外面**几十像素 —— 实机上就是"目标旁边有个闪烁的红点"
    （2026-11-10 实尺寸渲染 16 帧时抓到的，只有帧 10 落在画布内）。

    判据用绝对 alpha 而不是"离主体多远"：实测主体右端 30px 之外的**正常柔光最亮只有 15/255**
    （16 帧逐帧量过），而光斑是 179~181，90 这条线两边都碰不到。
    """
    alpha = frame.split()[3]
    px = alpha.load()
    width, height = frame.size
    columns = [x for x in range(body_right + SPARK_GUARD, width)
               if max(px[x, y] for y in range(height)) > SPARK_ALPHA]
    if not columns:
        return frame
    cleaned = frame.copy()
    out = cleaned.load()
    #  **整列清空**，不是只清亮像素：光斑外圈还有一圈 alpha 69~89 的软边，
    #  只清 >90 的话重采样之后仍会在命中点外留一颗 40% 不透明的小红点（实测 105/255）。
    #  这两列里正常柔光最多只有 15，整列清掉看不出缺口。
    for x in columns:
        for y in range(height):
            out[x, y] = (0, 0, 0, 0)
    return cleaned


def normalize_frame(src_path):
    """把一帧的主体横向归一化到 `[BODY_X0, BODY_X1]`，纵向只平移，返回 (新图, 主体, 倍率)。"""
    with Image.open(src_path) as opened:
        frame = opened.convert("RGBA")
    left, right = body_span(frame)
    frame = drop_flying_spark(frame, right)
    scale = (BODY_X1 - BODY_X0) / max(1, right - left)

    #  只取「映射后落在画布内」的那一段源图，再做一次等比横向缩放 —— 等价于
    #  `x' = BODY_X0 + (x - left) * scale`，但不用 AFFINE 变换，避免 PIL 版本差异。
    canvas_x = BODY_X0 - left * scale            # 源图 x=0 落在画布上的位置（通常是负数）
    src_x0 = max(0, int(-canvas_x / scale))
    src_x1 = min(frame.width, int((CANVAS_W - canvas_x) / scale) + 1)
    crop = frame.crop((src_x0, 0, src_x1, frame.height))
    resized = crop.resize((max(1, round(crop.width * scale)), crop.height), Image.LANCZOS)

    out = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    out.alpha_composite(resized, (round(canvas_x + src_x0 * scale), VERTICAL_SHIFT))
    return out, (left, right), scale


def measure(im):
    """归一化后的自检数据：可见段包围盒 / 亮带厚度 / 亮芯厚度。"""
    alpha = im.split()[3]
    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    core_box = alpha.point(lambda v: 255 if v > 200 else 0).getbbox()
    px = alpha.load()
    band = core = 0
    for x in range(BODY_X0 + 20, BODY_X1 - 20):
        band += sum(1 for y in range(im.height) if px[x, y] > 8)
        core += sum(1 for y in range(im.height) if px[x, y] > 200)
    span = max(1, BODY_X1 - BODY_X0 - 40)
    return box, core_box, band / span, core / span


# ── meta / 资源落盘 ───────────────────────────────────────────────────────

def new_uuid():
    import uuid as uuid_mod
    return str(uuid_mod.uuid4())


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(obj, handle, ensure_ascii=False, indent=2)


def frame_meta(uuid, display_name):
    """image impostor：type=sprite-frame，子资源 6c48a(texture) + f9941(spriteFrame)。

    trim 数据按**整帧画布**写（不裁剪），配合 Prefab 的 `_isTrimmedMode=false` 锁逐帧对齐。
    """
    hw, hh = CANVAS_W / 2.0, CANVAS_H / 2.0
    return {
        "ver": "1.0.27",
        "importer": "image",
        "imported": True,
        "uuid": uuid,
        "files": [".json", ".png"],
        "subMetas": {
            "6c48a": {
                "importer": "texture",
                "uuid": f"{uuid}@6c48a",
                "displayName": display_name,
                "id": "6c48a",
                "name": "texture",
                "userData": {
                    "wrapModeS": "clamp-to-edge", "wrapModeT": "clamp-to-edge",
                    "imageUuidOrDatabaseUri": uuid, "isUuid": True, "visible": False,
                    "minfilter": "linear", "magfilter": "linear", "mipfilter": "none", "anisotropy": 0,
                },
                "ver": "1.0.22", "imported": True, "files": [".json"], "subMetas": {},
            },
            "f9941": {
                "importer": "sprite-frame",
                "uuid": f"{uuid}@f9941",
                "displayName": display_name,
                "id": "f9941",
                "name": "spriteFrame",
                "userData": {
                    "trimThreshold": 1, "rotated": False,
                    "offsetX": 0, "offsetY": 0, "trimX": 0, "trimY": 0,
                    "width": CANVAS_W, "height": CANVAS_H,
                    "rawWidth": CANVAS_W, "rawHeight": CANVAS_H,
                    "borderTop": 0, "borderBottom": 0, "borderLeft": 0, "borderRight": 0,
                    "packable": True, "pixelsToUnit": 100,
                    "pivotX": 0.5, "pivotY": 0.5, "meshType": 0,
                    "vertices": {
                        "rawPosition": [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, CANVAS_H, CANVAS_W, CANVAS_H, 0, 0, CANVAS_W, 0],
                        "nuv": [0, 1, 1, 1, 0, 0, 1, 0],
                        "minPos": [-hw, -hh, 0], "maxPos": [hw, hh, 0],
                    },
                    "isUuid": True,
                    "imageUuidOrDatabaseUri": f"{uuid}@6c48a",
                    "atlasUuid": "",
                    "trimType": "none",
                },
                "ver": "1.0.12", "imported": True, "files": [".json"], "subMetas": {},
            },
        },
        "userData": {
            "type": "sprite-frame",
            "fixAlphaTransparencyArtifacts": False,
            "hasAlpha": True,
            "redirect": f"{uuid}@6c48a",
        },
    }


def build_loop_anim(clip_name, frame_uuids):
    step = 1.0 / SAMPLE
    return {
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
                        "_values": [{"__uuid__": uuid} for uuid in frame_uuids],
                    },
                },
            },
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


# ── 主流程 ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="真的落盘（默认只演算）")
    parser.add_argument("--force", action="store_true", help="覆盖已经归一化过的产物")
    args = parser.parse_args()

    set_dir = os.path.join(PROJECTILES_DIR, SET_NAME)
    atlas_dir = os.path.join(set_dir, "atlas")
    anim_dir = os.path.join(set_dir, "anim")
    if not os.path.isdir(atlas_dir):
        raise SystemExit(f"目录不存在: {atlas_dir}")
    if not os.path.isdir(SRC_DIR):
        raise SystemExit(f"缺美术源图目录: {SRC_DIR}")

    print(f"源图: {os.path.relpath(SRC_DIR, ROOT)}   {FRAME_COUNT} 帧 -> {CANVAS_W}x{CANVAS_H}"
          f"  可见段=[{BODY_X0},{BODY_X1}]")

    report = []
    for index in range(FRAME_COUNT):
        name = FRAME_FMT.format(index)
        src = os.path.join(SRC_DIR, name)
        if not os.path.isfile(src):
            raise SystemExit(f"缺源图: {src}")
        normalized, (left, right), scale = normalize_frame(src)
        box, core_box, band, core = measure(normalized)
        report.append((name, (left, right), scale, box, core_box, band, core))
        if args.write:
            normalized.save(os.path.join(atlas_dir, name), "PNG", optimize=True)

    print(f"\n{'帧':<32}{'源主体':>14}{'倍率':>8}{'归一后包围盒':>22}{'亮带':>7}{'亮芯':>7}")
    for name, body, scale, box, core_box, band, core in report:
        print(f"{name:<32}[{body[0]},{body[1]}]{scale:>8.4f}"
              f"{str(box):>22}{band:>7.1f}{core:>7.1f}")
    lefts = {item[3][0] for item in report}
    rights = {item[3][2] for item in report}
    print(f"\n归一后左端集合 {sorted(lefts)} / 右端集合 {sorted(rights)}"
          f"（都应是 单值：{BODY_X0} 与 {BODY_X1}）")
    print(f"亮带均值 {sum(r[5] for r in report) / len(report):.1f}px  亮芯均值 {sum(r[6] for r in report) / len(report):.1f}px")

    #  逐帧 uuid 从已有 meta 里取（没有就新建），引用不断。
    uuids = []
    for index in range(FRAME_COUNT):
        name = FRAME_FMT.format(index)
        meta_path = os.path.join(atlas_dir, name + ".meta")
        if os.path.isfile(meta_path):
            uuid = read_json(meta_path)["uuid"]
        else:
            uuid = new_uuid()
        uuids.append(uuid)
        if args.write:
            write_json(meta_path, frame_meta(uuid, os.path.splitext(name)[0]))
    print(f"帧 uuid: {len(set(uuids))} 个（重复 = 0 才正常）")

    #  退役旧素材
    legacy = []
    for index in range(LEGACY_COUNT):
        name = LEGACY_FMT.format(index)
        for path in (os.path.join(atlas_dir, name), os.path.join(atlas_dir, name + ".meta")):
            if os.path.isfile(path):
                legacy.append(path)
                if args.write:
                    os.remove(path)
    print(f"{'已删除' if args.write else '将删除'}旧素材 {len(legacy)} 个文件"
          f"（{LEGACY_FMT.format(0)} ~ {LEGACY_FMT.format(LEGACY_COUNT - 1)}）")

    #  循环动画
    clip_name = f"{SET_NAME}-loop"
    anim_path = os.path.join(anim_dir, f"{clip_name}.anim")
    clip = build_loop_anim(clip_name, [f"{uuid}@f9941" for uuid in uuids])
    if args.write:
        write_json(anim_path, clip)
        meta_path = anim_path + ".meta"
        if not os.path.isfile(meta_path):
            write_json(meta_path, {
                "ver": "2.0.4", "importer": "animation-clip", "imported": True,
                "uuid": new_uuid(), "files": [".bin"], "subMetas": {},
                "userData": {"name": clip_name},
            })
    print(f"{'已写' if args.write else '将写'} {os.path.relpath(anim_path, set_dir)}"
          f"  sample={SAMPLE} frames={FRAME_COUNT} dur={clip['_duration']:.4f}s")

    #  Prefab：只补画布尺寸与首个 spriteFrame，其余（fileId / anim 引用）原样保留。
    prefab_path = os.path.join(set_dir, f"{SET_NAME}.prefab")
    prefab = read_json(prefab_path)
    transform = next(item for item in prefab if item.get("__type__") == "cc.UITransform")
    sprite = next(item for item in prefab if item.get("__type__") == "cc.Sprite")
    old_size = (transform["_contentSize"]["width"], transform["_contentSize"]["height"])
    old_frame = sprite["_spriteFrame"]["__uuid__"]
    transform["_contentSize"]["width"] = CANVAS_W
    transform["_contentSize"]["height"] = CANVAS_H
    sprite["_spriteFrame"]["__uuid__"] = f"{uuids[0]}@f9941"
    if args.write:
        write_json(prefab_path, prefab)
    print(f"{'已写' if args.write else '将写'} {SET_NAME}.prefab"
          f"  {old_size[0]}x{old_size[1]} -> {CANVAS_W}x{CANVAS_H}"
          f"  spriteFrame {old_frame[:8]}… -> {uuids[0][:8]}…")

    if not args.write:
        print("\n（演算模式，未落盘。加 --write 执行。）")


if __name__ == "__main__":
    main()
