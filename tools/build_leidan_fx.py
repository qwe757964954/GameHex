# -*- coding: utf-8 -*-
"""
生成「雷弹」两件套预fab（2026-11-06）。

背景：美术 11-06 只丢了散帧进
  assets/bundles/battle/units/projectiles/雷弹攻击/   (1 帧 idle)
  assets/bundles/battle/units/projectiles/雷弹命中/   (9 帧 hit)
没有 prefab、没有 anim clip。而 pvpSkill.effectPrefabPath / impactEffectPrefabPath
只认 prefab 路径，所以必须按工程既有结构补两张 prefab。

结构照抄同类现役资源：
  · 弹体  → 磁电菇_子弹攻击（单节点 + Sprite + Animation，加色混合 2/4，lscale 0.4）
  · 命中  → 磁电菇_子弹命中（单节点 + Sprite + Animation，9 帧 ObjectTrack，sample 12）

缩放按「屏上尺寸对齐旧资源」反算，不拍脑袋：
  弹体 磁电菇 232×164 × 0.4 = 93×66 屏上；新图 120×81 ⇒ 93/120 = 0.775 → 取 0.78
  命中 磁电菇 458×495 × 0.4 = 183×198 屏上；新图 261×250 ⇒ 183/261 = 0.701 → 取 0.70
"""
import json
import os
import struct
import uuid

ROOT = 'assets/bundles/battle/units/projectiles'

ATTACK_DIR = os.path.join(ROOT, '雷弹攻击')
HIT_DIR = os.path.join(ROOT, '雷弹命中')


def png_size(path):
    raw = open(path, 'rb').read(33)
    return struct.unpack('>II', raw[16:24])


def sprite_frame_uuid(png_path):
    meta = json.load(open(png_path + '.meta', encoding='utf-8'))
    return meta['uuid'] + '@f9941'


def new_uuid():
    return str(uuid.uuid4())


def file_id():
    return uuid.uuid4().hex[:22]


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print('[ok]', path)


def prefab_doc(name, width, height, scale, frames, clip_uuid):
    """单节点 + UITransform + Sprite + Animation 的 prefab（与磁电菇两件套同构）。"""
    comps = [{'__id__': 2}, {'__id__': 4}]
    if clip_uuid is not None:
        comps.append({'__id__': 6})
    doc = [
        {
            '__type__': 'cc.Prefab',
            '_name': name,
            '_objFlags': 0,
            '__editorExtras__': {},
            '_native': '',
            'data': {'__id__': 1},
            'optimizationPolicy': 0,
            'persistent': False,
        },
        {
            '__type__': 'cc.Node',
            '_name': name,
            '_objFlags': 0,
            '__editorExtras__': {},
            '_parent': None,
            '_children': [],
            '_active': True,
            '_components': comps,
            '_prefab': {'__id__': 6 if clip_uuid is None else 8},
            '_lpos': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
            '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
            '_lscale': {'__type__': 'cc.Vec3', 'x': scale, 'y': scale, 'z': scale},
            '_mobility': 0,
            '_layer': 33554432,
            '_euler': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
            '_id': '',
        },
        {
            '__type__': 'cc.UITransform',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 1},
            '_enabled': True,
            '__prefab': {'__id__': 3},
            '_contentSize': {'__type__': 'cc.Size', 'width': width, 'height': height},
            '_anchorPoint': {'__type__': 'cc.Vec2', 'x': 0.5, 'y': 0.5},
            '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id()},
        {
            '__type__': 'cc.Sprite',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 1},
            '_enabled': True,
            '__prefab': {'__id__': 5},
            '_customMaterial': None,
            # 2/4 = SRC_ALPHA / ONE_MINUS_SRC_ALPHA，即普通 alpha 混合（与磁电菇两件套一致）。
            # 雷弹弹体是「有实体的电池」，不能开加色，否则灰色壳子会被叠爆成白团。
            '_srcBlendFactor': 2,
            '_dstBlendFactor': 4,
            '_color': {'__type__': 'cc.Color', 'r': 255, 'g': 255, 'b': 255, 'a': 255},
            '_spriteFrame': {'__uuid__': frames[0], '__expectedType__': 'cc.SpriteFrame'},
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
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id()},
    ]
    if clip_uuid is not None:
        doc.append({
            '__type__': 'cc.Animation',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 1},
            '_enabled': True,
            '__prefab': {'__id__': 7},
            'playOnLoad': False,
            '_clips': [{'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'}],
            '_defaultClip': {'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'},
            '_id': '',
        })
        doc.append({'__type__': 'cc.CompPrefabInfo', 'fileId': file_id()})
    doc.append({
        '__type__': 'cc.PrefabInfo',
        'root': {'__id__': 1},
        'asset': {'__id__': 0},
        'fileId': file_id(),
        'instance': None,
        'targetOverrides': None,
    })
    return doc


def anim_doc(name, frames, sample, duration):
    times = [round(i / sample, 10) for i in range(len(frames))]
    return {
        '__type__': 'cc.AnimationClip',
        '_name': name,
        '_objFlags': 0,
        '_native': '',
        'sample': sample,
        'speed': 1,
        # 1 = Normal，播完停在末帧；命中特效是「一次性」的，不能 loop。
        'wrapMode': 1,
        'events': [],
        '_duration': duration,
        '_keys': [],
        '_stepness': 0,
        'curveDatas': {},
        '_curves': [],
        '_commonTargets': [],
        '_hash': 0,
        '_tracks': [
            {
                '__type__': 'cc.animation.ObjectTrack',
                '_binding': {
                    '__type__': 'cc.animation.TrackBinding',
                    'path': {
                        '__type__': 'cc.animation.TrackPath',
                        '_paths': [
                            {'__type__': 'cc.animation.ComponentPath', 'component': 'cc.Sprite'},
                            'spriteFrame',
                        ],
                    },
                    'proxy': None,
                },
                '_channel': {
                    '__type__': 'cc.animation.Channel',
                    # ObjectCurve 只写 _times / _values —— 与磁电菇_子弹命中 逐键同构，
                    # 多写一个 _types 字段虽然引擎会忽略，但会让 diff 噪音变大。
                    '_curve': {
                        '__type__': 'cc.ObjectCurve',
                        '_times': times,
                        '_values': [{'__uuid__': u, '__expectedType__': 'cc.SpriteFrame'} for u in frames],
                    },
                    # 不写 `_wrappedCurve`：全工程 113 个 .anim 里 0 个带它（引擎按缺省处理）。
                },
            },
        ],
        # 以下 5 个字段是 3.8.x 序列化器给 AnimationClip 补的尾部键。
        # 不写也能跑，但工程里既有 .anim 全都带，缺了会在编辑器里点开时被改写、产生无意义 diff。
        '_exoticAnimation': None,
        '_events': [],
        '_embeddedPlayers': [],
        '_additiveSettings': {
            '__type__': 'cc.AnimationClipAdditiveSettings',
            'enabled': False,
            'refClip': None,
        },
        '_auxiliaryCurveEntries': [],
    }


def asset_meta(importer, ver, asset_uuid, name=None):
    user = {'name': name} if name else {}
    return {
        'ver': ver,
        'importer': importer,
        'imported': True,
        'uuid': asset_uuid,
        'files': [] if importer == 'directory' else ['.json'],
        'subMetas': {},
        'userData': user,
    }


def main():
    # ---------- 弹体：雷弹攻击 ----------
    idle_png = os.path.join(ATTACK_DIR, 'vfx_bullet_burngo_02-idle_0.png')
    idle_frame = sprite_frame_uuid(idle_png)
    w, h = png_size(idle_png)
    attack_doc = prefab_doc('雷弹攻击', w, h, 0.78, [idle_frame], None)
    attack_prefab = os.path.join(ATTACK_DIR, '雷弹攻击.prefab')
    write_json(attack_prefab, attack_doc)
    write_json(attack_prefab + '.meta', asset_meta('prefab', '1.1.50', new_uuid()))
    # 目录 meta 必须先于 prefab 的 userData.syncNodeName —— 后者由编辑器生成，手写会被覆盖。
    if not os.path.exists(os.path.join(ATTACK_DIR + '.meta')):
        write_json(ATTACK_DIR + '.meta', asset_meta('directory', '1.2.0', new_uuid()))

    # ---------- 命中：雷弹命中（9 帧） ----------
    hit_pngs = sorted(
        os.path.join(HIT_DIR, n) for n in os.listdir(HIT_DIR) if n.endswith('.png')
    )
    hit_frames = [sprite_frame_uuid(p) for p in hit_pngs]
    hw, hh = png_size(hit_pngs[0])
    clip_uuid = new_uuid()
    hit_prefab = os.path.join(HIT_DIR, '雷弹命中.prefab')
    write_json(hit_prefab, prefab_doc('雷弹命中', hw, hh, 0.70, hit_frames, clip_uuid))
    write_json(hit_prefab + '.meta', asset_meta('prefab', '1.1.50', new_uuid()))
    if not os.path.exists(HIT_DIR + '.meta'):
        write_json(HIT_DIR + '.meta', asset_meta('directory', '1.2.0', new_uuid()))

    anim_dir = os.path.join(HIT_DIR, 'anim')
    write_json(os.path.join(anim_dir + '.meta'), asset_meta('directory', '1.2.0', new_uuid()))
    # 9 帧 / sample 12 = 0.75s，与磁电菇_子弹命中逐字对齐，替换后节拍不变。
    write_json(os.path.join(anim_dir, '雷弹命中.anim'),
               anim_doc('雷弹命中', hit_frames, 12, 0.75))
    write_json(os.path.join(anim_dir, '雷弹命中.anim.meta'),
               asset_meta('animation-clip', '2.0.4', clip_uuid, '雷弹命中'))

    print('\n[info] 雷弹攻击 帧数 %d，尺寸 %dx%d' % (1, w, h))
    print('[info] 雷弹命中 帧数 %d，尺寸 %dx%d' % (len(hit_frames), hw, hh))


main()
