# -*- coding: utf-8 -*-
"""玉林好汉「精英猎手」强化弹体的 Prefab —— 只放大、不复制美术。

设计案 100404 的表现要求是「复用普通攻击，**子弹大小 ×3 倍**」。而工程规范
（`docs/zcds-表现层与领地规范.md` §1.10）把尺寸的真源锁死在 **prefab 根 `_lscale`** 上，
并明确禁止在 `ZCCombatEffectView` 里 `setScale` —— 否则同一个特效就有两个尺寸来源。

好在引擎本来就支持「强化那一击换一张图」：`ZCAttackResolutionSystem.sendAttack` 里
`effectPrefabPath = (empowered && definition.empoweredProfile?.effectPrefabPath) || profile.effectPrefabPath`，
`ZCGameLoader` / `ZCGameResourcePlan` 也都会把 `empoweredProfile.effectPrefabPath` 预加载。
所以这里的做法是：

    `玉林好汉_飞镖普攻_强化/玉林好汉_飞镖普攻_强化.prefab`
        · `_lscale = 1.5`          （= 普攻的 0.5 × 3 倍，唯一尺寸真源）
        · `_spriteFrame` / `cc.Animation` 一律**跨目录引用**普攻那套帧与 loop clip

不复制 13 张 PNG、不复制 .pac、不复制 .anim —— 只有 2 个文件（prefab + meta）。
改放大倍数**只动下面的 `BOOST_SCALE` 后重跑**，脚本会就地改写已有 prefab。
"""
import json
import os

import build_dart_attack_fx as base

BOOST_SET = "玉林好汉_飞镖普攻_强化"
BASE_SET = base.SET_NAME
BOOST_SCALE = base.PREFAB_SCALE * 3.0   # 0.5 × 3 = 1.5


def main():
    base_dir = os.path.join(base.PROJECTILES_DIR, BASE_SET)
    boost_dir = os.path.join(base.PROJECTILES_DIR, BOOST_SET)
    os.makedirs(boost_dir, exist_ok=True)

    anim_meta_path = os.path.join(base_dir, "anim", f"{BASE_SET}-loop.anim.meta")
    if not os.path.isfile(anim_meta_path):
        raise RuntimeError(f"缺普攻动画，先跑 build_dart_attack_fx.py：{anim_meta_path}")
    with open(anim_meta_path, encoding="utf-8") as f:
        anim_uuid = json.load(f)["uuid"]

    first_frame_meta = os.path.join(base_dir, "atlas", base.FRAMES[0] + ".meta")
    with open(first_frame_meta, encoding="utf-8") as f:
        frame_uuid = json.load(f)["uuid"]

    prefab_path = os.path.join(boost_dir, f"{BOOST_SET}.prefab")
    meta_path = prefab_path + ".meta"

    prefab_uuid = base.existing_uuid(meta_path)
    # 复用与普攻完全同构的两级节点结构，只换名字、尺寸缩放与引用
    config = base.build_prefab(BOOST_SET, frame_uuid, base.CANVAS_W, base.CANVAS_H,
                               anim_uuid, prefab_uuid)
    offset = [item for item in config if item.get("__type__") == "cc.Node"][1]
    offset["_lscale"] = {"__type__": "cc.Vec3", "x": BOOST_SCALE, "y": BOOST_SCALE, "z": 1}
    offset["_lpos"] = {"__type__": "cc.Vec3", "x": base.PREFAB_POS[0], "y": base.PREFAB_POS[1], "z": 0}

    base.write_json(prefab_path, config)
    base.write_json(meta_path, {
        "ver": "1.1.50",
        "importer": "prefab",
        "imported": True,
        "uuid": prefab_uuid,
        "files": [".json"],
        "subMetas": {},
        "userData": {"syncNodeName": BOOST_SET},
    })

    print(f"[prefab] {BOOST_SET}.prefab  {base.CANVAS_W}x{base.CANVAS_H}")
    print(f"         _lscale = {BOOST_SCALE}（普攻 {base.PREFAB_SCALE} × 3）")
    print(f"         引用 spriteFrame = {base.FRAMES[0]} @ {BASE_SET}/atlas")
    print(f"         引用 clip        = {BASE_SET}-loop")
    content = 160.0  # 427_00 的可见内容宽（画布 256 时）
    print(f"         屏上内容宽 ≈ {content * BOOST_SCALE:.0f}px（普攻 {content * base.PREFAB_SCALE:.0f}px）")


if __name__ == "__main__":
    main()
