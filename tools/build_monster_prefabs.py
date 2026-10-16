# -*- coding: utf-8 -*-
"""
怪物预览 Prefab 生成器（Cocos Creator 3.8.8 格式，与 ZCGameWall.prefab 同版序列化）。

每个怪物目录下生成 <怪物名>.prefab：
  根节点(<怪物名>) + cc.UITransform(256x256) + cc.Sprite(idle_0 帧) + cc.Animation(3 个剪辑, playOnLoad)
帧与动画剪辑均为每怪物独立资源（zcds/client/monsters/<怪物名>/），供场景直接拖入预览。
已存在的 .prefab 一律跳过，不覆盖成品。
"""
import json
import os
import re
import uuid as uuid_mod

ROOT = r"D:\City1001\Demo3.8"
MONSTERS_DIR = os.path.join(ROOT, r"assets\resources\zcds\client\monsters")
LAYER_UI_2D = 33554432  # 1 << 25, 与项目 UI 节点一致


def new_uuid():
    return str(uuid_mod.uuid4())


def new_file_id():
    return uuid_mod.uuid4().hex[:20]


def existing_uuid(meta_path):
    if not os.path.isfile(meta_path):
        return new_uuid()
    with open(meta_path, encoding="utf-8") as file:
        return json.load(file).get("uuid") or new_uuid()


def read_meta_uuid(meta_path):
    with open(meta_path, encoding="utf-8") as file:
        return json.load(file)["uuid"]


def find_idle0_frame(atlas_dir):
    pat = re.compile(r"^.+?-idle_0(?:_压缩)?\.png$")
    for fname in sorted(os.listdir(atlas_dir)):
        if pat.match(fname):
            return fname
    raise RuntimeError(f"缺少 idle_0 帧: {atlas_dir}")


def build_prefab(name, sprite_uuid, idle_uuid, run_uuid, attack_uuid, file_ids):
    fid_ui, fid_spr, fid_anim, fid_node = file_ids
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
            "_contentSize": {"__type__": "cc.Size", "width": 256, "height": 256},
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
            "_spriteFrame": {
                "__uuid__": f"{sprite_uuid}@f9941",
                "__expectedType__": "cc.SpriteFrame",
            },
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
        {
            "__type__": "cc.Animation",
            "_name": "",
            "_objFlags": 0,
            "__editorExtras__": {},
            "node": {"__id__": 1},
            "_enabled": True,
            "__prefab": {"__id__": 7},
            "_defaultClip": {"__uuid__": idle_uuid},
            "_clips": [
                {"__uuid__": idle_uuid},
                {"__uuid__": run_uuid},
                {"__uuid__": attack_uuid},
            ],
            "playOnLoad": True,
            "_id": "",
        },
        {"__type__": "cc.CompPrefabInfo", "fileId": fid_anim},
        {
            "__type__": "cc.PrefabInfo",
            "root": {"__id__": 1},
            "asset": {"__id__": 0},
            "fileId": fid_node,
            "instance": None,
            "targetOverrides": None,
        },
    ]


def main():
    monsters = sorted(
        d for d in os.listdir(MONSTERS_DIR)
        if os.path.isdir(os.path.join(MONSTERS_DIR, d))
    )
    expected = {"民兵", "精灵弓箭手", "骷髅战士", "亡灵法师", "希尔瓦娜斯", "伊利丹"}
    if set(monsters) != expected:
        raise RuntimeError(f"怪物目录不完整: {sorted(expected - set(monsters))}")

    for name in monsters:
        atlas_dir = os.path.join(MONSTERS_DIR, name)
        prefab_path = os.path.join(atlas_dir, f"{name}.prefab")
        if os.path.isfile(prefab_path):
            print(f"[跳过] 已存在: {prefab_path}")
            continue

        idle0 = find_idle0_frame(atlas_dir)
        sprite_uuid = read_meta_uuid(os.path.join(atlas_dir, idle0 + ".meta"))
        idle_uuid = read_meta_uuid(os.path.join(atlas_dir, f"{name}-idle.anim.meta"))
        run_uuid = read_meta_uuid(os.path.join(atlas_dir, f"{name}-run.anim.meta"))
        attack_uuid = read_meta_uuid(os.path.join(atlas_dir, f"{name}-attack.anim.meta"))

        file_ids = [new_file_id() for _ in range(4)]
        prefab = build_prefab(name, sprite_uuid, idle_uuid, run_uuid, attack_uuid, file_ids)

        meta_uuid = existing_uuid(prefab_path + ".meta")
        meta = {
            "ver": "1.1.50",
            "importer": "prefab",
            "imported": True,
            "uuid": meta_uuid,
            "files": [".json"],
            "subMetas": {},
            "userData": {"syncNodeName": name},
        }

        with open(prefab_path, "w", encoding="utf-8") as f:
            json.dump(prefab, f, ensure_ascii=False, indent=2)
        with open(prefab_path + ".meta", "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        print(
            f"[完成] {name}.prefab  (sprite={idle0}, idle={idle_uuid[:8]}, "
            f"run={run_uuid[:8]}, attack={attack_uuid[:8]})"
        )

    print("\n全部 Prefab 已生成，等待 Cocos Creator 自动导入。")


if __name__ == "__main__":
    main()
