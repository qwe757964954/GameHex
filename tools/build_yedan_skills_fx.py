# -*- coding: utf-8 -*-
"""椰蛋战士（68005）两条技能的 Prefab —— 全部**复用既有美术**，只重排/缩放，不复制帧。

设计案（`技能设计案2.xlsx` 第 24 / 26 行）：

  · **100502 横扫**：`【P3 复用】长枪兵普攻_刀光(8帧) 拉成 120° 扇形贴地播 0.3s`
  · **100504 暴风**：`【P10 沿用】风法师_龙卷风(25帧) 缩 50%`

工程规范（`docs/zcds-表现层与领地规范.md` §1.10）把尺寸真源锁死在 prefab 节点 `_lscale` 上，
并禁止在 `ZCCombatEffectView` 里 `setScale`。所以两条技能各做一张**只含 prefab + meta** 的预制体，
帧与 clip 一律跨目录引用原技能那套：

    `椰蛋战士_暴风/椰蛋战士_暴风.prefab`
        · 两级结构（根 + offset），`offset._lscale = 2`（龙卷风原为 4，缩 50%）
        · 引用 `风法师_龙卷风` 的首帧 spriteFrame 与 `-loop` clip

    `椰蛋战士_横扫/椰蛋战士_横扫.prefab`
        · 两级结构（根 + offset）+ **5 簇**贴地刀光，沿 120° 弧摆开
        · 引用 `长枪兵普攻_刀光` 的首帧 spriteFrame 与 `-loop` clip

多簇的写法照抄 `火焰树妖_灼热地带技能`（工程里唯一的多簇区域 prefab）：
`根 → offset → flame_N`，每簇自己带 UITransform / Sprite / Animation，共用同一个 clip。

要改大小**只动下面的常数**后重跑 —— 脚本就地改写已有 prefab，不动美术文件。
"""
import json
import math
import os

from build_dart_attack_fx import (
    LAYER_UI_2D, PROJECTILES_DIR, build_dir_meta, existing_uuid, new_uuid, write_json,
)

STORM_SET = "椰蛋战士_暴风"
STORM_SRC = "风法师_龙卷风"
STORM_W, STORM_H = 128, 154
# 龙卷风 prefab 原来是 `_lscale = 4`，设计案要求「缩 50%」⇒ 2。
STORM_SCALE = 2.0

SWEEP_SET = "椰蛋战士_横扫"
SWEEP_SRC = "长枪兵普攻_刀光"
SWEEP_W, SWEEP_H = 64, 42
SWEEP_SCALE = 1.15
# 5 簇沿 120° 弧摆开；弧半径按「横扫判定半径 ≈ 46 逻辑像素」取，略往内收一点让刀光压在身上。
SWEEP_CLUSTERS = 5
SWEEP_SPREAD_DEG = 120
SWEEP_RADIUS = 40.0
SDK_VER = "1.1.50"


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def anim_uuid(src_set):
    meta = os.path.join(PROJECTILES_DIR, src_set, "anim", f"{src_set}-loop.anim.meta")
    if not os.path.isfile(meta):
        raise RuntimeError(f"缺动画：{meta}")
    return read_json(meta)["uuid"]


def first_frame_uuid(src_set, atlas_dir):
    names = sorted(name for name in os.listdir(atlas_dir) if name.endswith(".png.meta"))
    if not names:
        raise RuntimeError(f"{src_set}/atlas 里没有帧")
    return read_json(os.path.join(atlas_dir, names[0]))["uuid"], names[0][:-5]


# ── 单层内容节点（offset 的直接子节点）────────────────────────────────────────────
def content_node(name, parent_id, pos, scale, rot_z_deg, sprite_uuid, anim_clip):
    """返回 (按索引排列的条目列表, 该节点在本列表里的相对索引 0)。

    结构照抄 `火焰树妖_灼热地带技能` 的一簇：Node → UITransform → CompPrefabInfo →
    Sprite → CompPrefabInfo → Animation → CompPrefabInfo → PrefabInfo。
    索引由调用方平移到全局偏移，所以这里全部用**相对** id。
    """
    half = math.radians(rot_z_deg) * 0.5
    return [
        {
            "__type__": "cc.Node", "_name": name, "_objFlags": 0, "__editorExtras__": {},
            "_parent": {"__id__": parent_id}, "_children": [], "_active": True,
            "_components": [{"__id__": 1}, {"__id__": 3}, {"__id__": 5}],
            "_prefab": {"__id__": 7},
            "_lpos": {"__type__": "cc.Vec3", "x": pos[0], "y": pos[1], "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0,
                      "z": round(math.sin(half), 6), "w": round(math.cos(half), 6)},
            "_lscale": {"__type__": "cc.Vec3", "x": scale, "y": scale, "z": 1},
            "_mobility": 0, "_layer": LAYER_UI_2D,
            "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": rot_z_deg},
            "_id": "",
        },
        {
            "__type__": "cc.UITransform", "_name": "", "_objFlags": 0, "__editorExtras__": {},
            "node": {"__id__": 0}, "_enabled": True, "__prefab": {"__id__": 2},
            "_contentSize": {"__type__": "cc.Size", "width": SWEEP_W, "height": SWEEP_H},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}, "_id": "",
        },
        {"__type__": "cc.CompPrefabInfo", "fileId": "", "_purpose": "ut"},
        {
            "__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "__editorExtras__": {},
            "node": {"__id__": 0}, "_enabled": True, "__prefab": {"__id__": 4},
            "_spriteFrame": {"__uuid__": f"{sprite_uuid}@f9941", "__expectedType__": "cc.SpriteFrame"},
            "_type": 0, "_fillType": 0,
            # `_sizeMode=0 (CUSTOM)` + `_isTrimmedMode=false`：逐帧换图不跟着新图变形（§1.5）
            "_sizeMode": 0, "_isTrimmedMode": False,
            "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0, "_fillRange": 0, "_id": "",
        },
        {"__type__": "cc.CompPrefabInfo", "fileId": "", "_purpose": "sprite"},
        {
            "__type__": "cc.Animation", "_name": "", "_objFlags": 0, "__editorExtras__": {},
            "node": {"__id__": 0}, "_enabled": True, "__prefab": {"__id__": 6},
            # ⚠️ 多簇必须 `playOnLoad = True`：`ZCCombatEffectView` 只对
            # `getComponentInChildren(Animation)` 拿到的**第一个** Animation 调 play，
            # 其余几簇不会自动播，会冻在第 1 帧。源特效 `长枪兵普攻_刀光` 本来就是 true。
            "playOnLoad": True,
            "_clips": [{"__uuid__": anim_clip, "__expectedType__": "cc.AnimationClip"}],
            "_defaultClip": {"__uuid__": anim_clip, "__expectedType__": "cc.AnimationClip"},
            "_id": "",
        },
        {"__type__": "cc.CompPrefabInfo", "fileId": "", "_purpose": "anim"},
        {"__type__": "cc.PrefabInfo", "root": {"__id__": 0}, "asset": {"__id__": 0},
         "fileId": "", "targetOverrides": None, "nestedPrefabInstanceRoots": None, "instance": None},
    ]


def build_multi_prefab(name, sprite_uuid, anim_clip, clusters):
    """根 + offset + N 簇。`clusters` = [(pos_x, pos_y, scale, rot_z_deg)]。"""
    items = [
        # 0
        {"__type__": "cc.Prefab", "_name": name, "_objFlags": 0, "__editorExtras__": {},
         "_native": "", "data": {"__id__": 1}, "optimizationPolicy": 0, "persistent": False},
        # 1 根：只做分组，_lscale 恒 1
        {
            "__type__": "cc.Node", "_name": name, "_objFlags": 0, "__editorExtras__": {},
            "_parent": None, "_children": [{"__id__": 2}], "_active": True, "_components": [],
            "_prefab": None,
            "_lpos": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
            "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
            "_mobility": 0, "_layer": LAYER_UI_2D,
            "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0}, "_id": "",
        },
        # 2 offset：尺寸真源
        {
            "__type__": "cc.Node", "_name": "offset", "_objFlags": 0, "__editorExtras__": {},
            "_parent": {"__id__": 1}, "_children": [], "_active": True, "_components": [],
            "_prefab": None,
            "_lpos": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
            "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
            "_mobility": 0, "_layer": LAYER_UI_2D,
            "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0}, "_id": "",
        },
    ]
    cluster_ids = []
    for index, (px, py, scale, rot) in enumerate(clusters):
        base = len(items)
        cluster_ids.append(base)
        items.extend(content_node(f"slash_{index}", 2, (px, py), scale, rot, sprite_uuid, anim_clip))
    items[2]["_children"] = [{"__id__": cid} for cid in cluster_ids]
    # 根与 offset 各要一个 PrefabInfo（每簇的那个由 content_node 自带，已随块平移）
    root_info = len(items)
    items.append({"__type__": "cc.PrefabInfo", "root": {"__id__": 1}, "asset": {"__id__": 0},
                  "fileId": "", "targetOverrides": None,
                  "nestedPrefabInstanceRoots": None, "instance": None})
    offset_info = len(items)
    items.append({"__type__": "cc.PrefabInfo", "root": {"__id__": 1}, "asset": {"__id__": 0},
                  "fileId": "", "targetOverrides": None,
                  "nestedPrefabInstanceRoots": None, "instance": None})
    items[1]["_prefab"] = {"__id__": root_info}
    items[2]["_prefab"] = {"__id__": offset_info}
    return remap_ids(items)


def remap_ids(items):
    """把 content_node 里的**相对** `__id__` 平移成全局索引，并补 fileId。

    相对块里：节点 = 0，其余 1..7 是它的组件与本节点的 PrefabInfo；
    但 PrefabInfo 的 `root` 指向整个 prefab 的根（全局 1），这里统一改回来。
    """
    out = []
    for index, item in enumerate(items):
        item = json.loads(json.dumps(item))
        out.append(item)
    # 找每个 cluster 的起点：节点名以 slash_ 开头
    starts = [i for i, it in enumerate(out) if it.get("__type__") == "cc.Node" and str(it.get("_name", "")).startswith("slash_")]
    for start in starts:
        for offset in range(0, 8):
            item = out[start + offset]
            node = item.get("node")
            if node is not None:
                item["node"] = {"__id__": start + node["__id__"]}
            prefab = item.get("__prefab")
            if prefab is not None:
                item["__prefab"] = {"__id__": start + prefab["__id__"]}
            if item.get("__type__") == "cc.Node":
                children = item.get("_children")
                if children:
                    item["_children"] = [{"__id__": start + c["__id__"]} for c in children]
                # ⚠️ 组件引用也要平移：漏了这一处，5 簇会全部指向 slash_0 的三个组件
                comps = item.get("_components")
                if comps:
                    item["_components"] = [{"__id__": start + c["__id__"]} for c in comps]
                # 节点自己的 PrefabInfo 引用键是 `_prefab`（组件才是 `__prefab`）
                node_prefab = item.get("_prefab")
                if node_prefab is not None:
                    item["_prefab"] = {"__id__": start + node_prefab["__id__"]}
                parent = item.get("_parent")
                if parent is not None and parent["__id__"] != 2:
                    item["_parent"] = {"__id__": start + parent["__id__"]}
            if item.get("__type__") == "cc.PrefabInfo":
                item["root"] = {"__id__": 1}
                item["asset"] = {"__id__": 0}
    # fileId：按 (prefab uuid seed, 全局索引) 派生，重跑不抖动
    for index, item in enumerate(out):
        if item.get("__type__") in ("cc.CompPrefabInfo", "cc.PrefabInfo"):
            item["fileId"] = __import__("hashlib").md5(f"yedan:{index}".encode("utf-8")).hexdigest()[:20]
    return out


def write_prefab(set_name, config):
    set_dir = os.path.join(PROJECTILES_DIR, set_name)
    os.makedirs(set_dir, exist_ok=True)
    meta_dir = set_dir + ".meta"
    if not os.path.isfile(meta_dir):
        write_json(meta_dir, build_dir_meta(new_uuid()))
        print(f"[dir]  {set_name}/")
    prefab_path = os.path.join(set_dir, f"{set_name}.prefab")
    prefab_uuid = existing_uuid(prefab_path + ".meta")
    write_json(prefab_path, config)
    write_json(prefab_path + ".meta", {
        "ver": SDK_VER, "importer": "prefab", "imported": True,
        "uuid": prefab_uuid, "files": [".json"], "subMetas": {},
        "userData": {"syncNodeName": set_name},
    })
    return prefab_path


def build_single(set_name, src_set, scale):
    """两级结构、只做缩放：直接借 `build_dart_attack_fx.build_prefab` 的模板法。"""
    import build_dart_attack_fx as base
    src_dir = os.path.join(PROJECTILES_DIR, src_set)
    atlas_dir = os.path.join(src_dir, "atlas")
    frame_uuid, frame_name = first_frame_uuid(src_set, atlas_dir)
    clip = anim_uuid(src_set)
    saved = (base.PREFAB_SCALE, base.PREFAB_POS)
    base.PREFAB_SCALE = scale
    base.PREFAB_POS = (0.0, 0.0)
    try:
        prefab_path = os.path.join(PROJECTILES_DIR, set_name, f"{set_name}.prefab")
        config = base.build_prefab(set_name, frame_uuid, STORM_W, STORM_H, clip,
                                   existing_uuid(prefab_path + ".meta"))
    finally:
        base.PREFAB_SCALE, base.PREFAB_POS = saved
    return config, frame_name, clip


def main():
    # ── 暴风：龙卷风缩 50% ────────────────────────────────────────────────────
    config, frame_name, clip = build_single(STORM_SET, STORM_SRC, STORM_SCALE)
    # 模板法把画布尺寸写的是 STORM_W/H，这里再确认一次（模板取的是玉米射手的 256x254）
    for item in config:
        if item.get("__type__") == "cc.UITransform":
            item["_contentSize"] = {"__type__": "cc.Size", "width": STORM_W, "height": STORM_H}
    path = write_prefab(STORM_SET, config)
    print(f"[prefab] {STORM_SET}  {STORM_W}x{STORM_H}  _lscale = {STORM_SCALE}（{STORM_SRC} 的 4 × 50%）")
    print(f"         引用 spriteFrame = {frame_name} @ {STORM_SRC}/atlas")
    print(f"         引用 clip        = {STORM_SRC}-loop（{clip}）")
    print(f"         → {os.path.relpath(path, PROJECTILES_DIR)}")

    # ── 横扫：5 簇刀光沿 120° 弧摆开 ─────────────────────────────────────────
    atlas_dir = os.path.join(PROJECTILES_DIR, SWEEP_SRC, "atlas")
    frame_uuid, frame_name = first_frame_uuid(SWEEP_SRC, atlas_dir)
    clip = anim_uuid(SWEEP_SRC)
    clusters = []
    for index in range(SWEEP_CLUSTERS):
        # 中间那簇正对目标方向（局部 +x），两侧均分到 ±60°
        frac = (index / (SWEEP_CLUSTERS - 1)) * 2 - 1
        angle = math.radians(frac * SWEEP_SPREAD_DEG / 2)
        clusters.append((
            round(math.cos(angle) * SWEEP_RADIUS, 4),
            round(math.sin(angle) * SWEEP_RADIUS, 4),
            SWEEP_SCALE,
            round(math.degrees(angle) + 90.0, 4),
        ))
    config = build_multi_prefab(SWEEP_SET, frame_uuid, clip, clusters)
    path = write_prefab(SWEEP_SET, config)
    print(f"[prefab] {SWEEP_SET}  {SWEEP_W}x{SWEEP_H} × {SWEEP_CLUSTERS} 簇  "
          f"弧半径 {SWEEP_RADIUS}  展开 {SWEEP_SPREAD_DEG}°  每簇 _lscale = {SWEEP_SCALE}")
    print(f"         引用 spriteFrame = {frame_name} @ {SWEEP_SRC}/atlas")
    print(f"         引用 clip        = {SWEEP_SRC}-loop（{clip}）")
    print(f"         → {os.path.relpath(path, PROJECTILES_DIR)}")


if __name__ == "__main__":
    main()
