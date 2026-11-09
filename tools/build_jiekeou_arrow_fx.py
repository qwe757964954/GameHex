# -*- coding: utf-8 -*-
"""生成「杰克藕_普攻」带电箭预制（2026-11-06）。

口径来自设计案 68008 行 200801「【P2+P9 复用】弓兵_通用箭矢(静态) 拉长」+
【表现资源映射】第 45 行「弓兵_通用箭矢 + 雷法师_雷电 / 复用 / 静态箭矢叠电弧，做『带电箭』」。

结构（与工程里其它弹道预制一致：root → offset 两级，一个 Sprite + 一个 Animation）：
  root(杰克藕_普攻)
    ├─ arc    雷法师_雷电 的序列帧（loop clip），压扁拉长贴在箭身上
    └─ offset 弓兵_通用箭矢 的静态帧（染色成冷蓝白），拉长 30%

为什么要两个子节点而不是一个：`ZCCombatEffectView.mountVisual` 只起播**第一个**找到的
Animation 组件（`visual.getComponent(Animation) ?? getComponentInChildren`）。把带电弧放在
子节点首位，它的 loop clip 就会被起播；箭身那份 Animation 的 `_clips` 是空的（纯静态帧），
被忽略也不影响观感。
"""
import json
import os
import uuid

ROOT = r'D:/Alan/Project/POW/Demo3.8/assets/bundles/battle/units/projectiles'
OUT_DIR = os.path.join(ROOT, '杰克藕_普攻')
NAME = '杰克藕_普攻'

# 复用现有资源，不复制美术文件：
ARROW_FRAME = '7da40e07-d84e-4ba1-a671-3ed659a22613@f9941'   # 弓兵_通用箭矢 静态帧
ARC_FRAME = 'dd85dd41-63d4-4727-ad7b-234574c3bdaf@f9941'     # 雷法师_雷电 首帧
ARC_CLIP = '18932b8c-42cb-495a-a5a2-8d2a668aa004'            # 雷法师_雷电 loop clip


def node(name, parent_id, children, component_ids, prefab_id, lpos=(0, 0), lscale=(1, 1), euler_z=0.0):
    rad = euler_z * 3.141592653589793 / 180.0
    return {
        '__type__': 'cc.Node',
        '_name': name,
        '_objFlags': 0,
        '__editorExtras__': {},
        '_parent': {'__id__': parent_id} if parent_id is not None else None,
        '_children': [{'__id__': cid} for cid in children],
        '_active': True,
        '_components': [{'__id__': cid} for cid in component_ids],
        '_prefab': {'__id__': prefab_id},
        '_lpos': {'__type__': 'cc.Vec3', 'x': lpos[0], 'y': lpos[1], 'z': 0},
        '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0,
                  'z': round(__import__('math').sin(rad / 2), 8),
                  'w': round(__import__('math').cos(rad / 2), 8)},
        '_lscale': {'__type__': 'cc.Vec3', 'x': lscale[0], 'y': lscale[1], 'z': 1},
        '_mobility': 0,
        '_layer': 33554432,
        '_euler': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': euler_z},
        '_id': '',
    }


def uitransform(node_id, width, height, prefab_id):
    return {
        '__type__': 'cc.UITransform',
        '_name': '',
        '_objFlags': 0,
        '__editorExtras__': {},
        'node': {'__id__': node_id},
        '_enabled': True,
        '__prefab': {'__id__': prefab_id},
        '_contentSize': {'__type__': 'cc.Size', 'width': width, 'height': height},
        '_anchorPoint': {'__type__': 'cc.Vec2', 'x': 0.5, 'y': 0.5},
        '_id': '',
    }


def sprite(node_id, frame_uuid, prefab_id, color=None, additive=False):
    data = {
        '__type__': 'cc.Sprite',
        '_name': '',
        '_objFlags': 0,
        '__editorExtras__': {},
        'node': {'__id__': node_id},
        '_enabled': True,
        '__prefab': {'__id__': prefab_id},
        '_spriteFrame': {'__uuid__': frame_uuid, '__expectedType__': 'cc.SpriteFrame'},
        '_type': 0,
        '_fillType': 0,
        '_sizeMode': 0,
        '_fillCenter': {'__type__': 'cc.Vec2', 'x': 0, 'y': 0},
        '_fillStart': 0,
        '_fillRange': 0,
        '_isTrimmedMode': False,
        '_useGrayscale': False,
        '_atlas': None,
        '_id': '',
    }
    if additive:
        data.update({
            '_customMaterial': None,
            '_srcBlendFactor': 2,
            '_dstBlendFactor': 4,
        })
    if color:
        data['_color'] = {'__type__': 'cc.Color', 'r': color[0], 'g': color[1], 'b': color[2], 'a': 255}
    return data


def animation(node_id, prefab_id, clip_uuid):
    return {
        '__type__': 'cc.Animation',
        '_name': '',
        '_objFlags': 0,
        '__editorExtras__': {},
        'node': {'__id__': node_id},
        '_enabled': True,
        '__prefab': {'__id__': prefab_id},
        'playOnLoad': False,
        '_clips': ([{'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'}] if clip_uuid else []),
        '_defaultClip': ({'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'} if clip_uuid else None),
        '_id': '',
    }


def comp_info(file_id):
    return {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id}


def prefab_info(file_id):
    return {
        '__type__': 'cc.PrefabInfo',
        'root': {'__id__': 1},
        'asset': {'__id__': 0},
        'fileId': file_id,
        'targetOverrides': None,
        'nestedPrefabInstanceRoots': None,
        'instance': None,
    }


def build():
    ids = {key: index for index, key in enumerate([
        'prefab', 'root',
        'arc', 'arc_ut', 'arc_ut_ci', 'arc_sprite', 'arc_sprite_ci', 'arc_anim', 'arc_anim_ci', 'arc_pi',
        'arrow', 'arrow_ut', 'arrow_ut_ci', 'arrow_sprite', 'arrow_sprite_ci', 'arrow_anim', 'arrow_anim_ci',
        'arrow_pi', 'root_pi',
    ])}

    data = [None] * len(ids)
    data[ids['prefab']] = {
        '__type__': 'cc.Prefab',
        '_name': NAME,
        '_objFlags': 0,
        '__editorExtras__': {},
        '_native': '',
        'data': {'__id__': ids['root']},
        'optimizationPolicy': 0,
        'persistent': False,
    }
    data[ids['root']] = node(NAME, None, [ids['arc'], ids['arrow']], [], ids['root_pi'])
    # 电弧在箭身上方一点点（-y 是飞行方向的反向），并压扁到箭身宽度
    data[ids['arc']] = node('arc', ids['root'], [], [ids['arc_ut'], ids['arc_sprite'], ids['arc_anim']],
                            ids['arc_pi'], lpos=(0, 0), lscale=(0.16, 0.16), euler_z=-90.0)
    data[ids['arc_ut']] = uitransform(ids['arc'], 210, 490, ids['arc_ut_ci'])
    data[ids['arc_ut_ci']] = comp_info('a1LjKpWQ9GxYb0Wc8LZQ2V')
    data[ids['arc_sprite']] = sprite(ids['arc'], ARC_FRAME, ids['arc_sprite_ci'], color=(190, 225, 255), additive=True)
    data[ids['arc_sprite_ci']] = comp_info('a2LjKpWQ9GxYb0Wc8LZQ2V')
    data[ids['arc_anim']] = animation(ids['arc'], ids['arc_anim_ci'], ARC_CLIP)
    data[ids['arc_anim_ci']] = comp_info('a3LjKpWQ9GxYb0Wc8LZQ2V')
    data[ids['arc_pi']] = prefab_info('a4LjKpWQ9GxYb0Wc8LZQ2V')

    # 箭身：与 弓兵_通用箭矢 同尺寸同旋转，纵向拉到 1.3 倍（「拉长」）
    data[ids['arrow']] = node('offset', ids['root'], [], [ids['arrow_ut'], ids['arrow_sprite'], ids['arrow_anim']],
                              ids['arrow_pi'], lpos=(0, 0), lscale=(0.4, 0.52), euler_z=-90.0)
    data[ids['arrow_ut']] = uitransform(ids['arrow'], 97, 125, ids['arrow_ut_ci'])
    data[ids['arrow_ut_ci']] = comp_info('b1LjKpWQ9GxYb0Wc8LZQ2V')
    data[ids['arrow_sprite']] = sprite(ids['arrow'], ARROW_FRAME, ids['arrow_sprite_ci'], color=(205, 235, 255))
    data[ids['arrow_sprite_ci']] = comp_info('b2LjKpWQ9GxYb0Wc8LZQ2V')
    data[ids['arrow_anim']] = animation(ids['arrow'], ids['arrow_anim_ci'], None)
    data[ids['arrow_anim_ci']] = comp_info('b3LjKpWQ9GxYb0Wc8LZQ2V')
    data[ids['arrow_pi']] = prefab_info('b4LjKpWQ9GxYb0Wc8LZQ2V')
    data[ids['root_pi']] = prefab_info('c1LjKpWQ9GxYb0Wc8LZQ2V')

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, NAME + '.prefab'), 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write('\n')

    folder_uuid = str(uuid.uuid4())
    with open(OUT_DIR + '.meta', 'w', encoding='utf-8') as handle:
        json.dump({
            'ver': '1.2.0', 'importer': 'directory', 'imported': True,
            'uuid': folder_uuid, 'files': [], 'subMetas': {}, 'userData': {},
        }, handle, ensure_ascii=False, indent=2)
        handle.write('\n')

    with open(os.path.join(OUT_DIR, NAME + '.prefab.meta'), 'w', encoding='utf-8') as handle:
        json.dump({
            'ver': '1.1.50', 'importer': 'prefab', 'imported': True,
            'uuid': str(uuid.uuid4()), 'files': ['.json'], 'subMetas': {},
            'userData': {'syncNodeName': NAME, 'hasIcon': False},
        }, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print('生成', OUT_DIR)


if __name__ == '__main__':
    build()
