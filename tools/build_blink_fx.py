# -*- coding: utf-8 -*-
"""
生成「瞬间移动特效」预制（2026-11-07）。

背景：美术把 18 张散帧丢进
  assets/bundles/battle/units/projectiles/瞬间移动特效/
就结束了 —— 没有 prefab、没有 anim clip，而且**每张 png 的 meta 都还是
`userData.type = "texture"`**（只有 texture 子资源、没有 `f9941` spriteFrame 子资源），
Sprite 根本取不到图。所以本脚本干三件事：

  ① 把 18 张 png 的 meta 改成 `sprite-frame` 形态（补 `f9941` 子资源）；
  ② 按工程既有结构补一张 prefab（单节点 + UITransform + Sprite + Animation）；
  ③ 补 18 帧 ObjectTrack 的 anim clip。

## 帧图 meta 为什么用 `trimType: "none"`（不裁剪）

同一段动画的 18 帧共享一张 1296×1228 画布，**内容在画布里居中、逐帧变大**。
如果让编辑器自动裁剪，每帧的 `width/height/offsetX/offsetY` 都不一样；
而 Sprite 是 `sizeMode = CUSTOM`（contentSize 固定 1296×1228），裁剪信息一旦参与
顶点计算，逐帧的偏移就会把「原地爆开」画成「原地抖着爆开」。
`hex_pulse_seq`（同一类序列帧特效）用的就是 `trimType: none`，这里照抄同一口径：
**raw == trimmed**，画布 1:1，18 帧严丝合缝。

## 尺寸：80px × 80px 是怎么反算的

需求：「特效大小约为 80px × 80px」。

按项目口径（`ZCCombatEffectScale.ts` 里镭射飞龙那条注释确立的），**分母取可见内容、
不取画布** —— 画布周围那一圈透明不占屏幕。用 PIL 按 `alpha ≥ 8` 逐帧量 18 帧的可见
bbox，**最大的一帧是第 15 帧 1166×1166**（之后 16/17 帧开始收）

    1166 / 1296 = 90% 的画布     ← 拿画布当分母会把特效缩小 10%
    80 / 1166   = 0.06861        ← 实际采用的烘焙缩放

⇒ prefab 根节点 `_lscale = 0.0686`，最大那一帧的可见圆正好是 80×80。
（若按画布 1296 折算应是 80/1296 = 0.0617，那会让最大帧只有 72px，不采用。）

## 时长：18 帧 / sample 24 = 0.75s

工程里 12fps 是主流量（`sample = 12`、`duration = 帧数 / 12`），但那是**循环类**特效
（普攻刀光、子弹待机）。18 帧按 12fps 播是 1.5s —— 一次「瞬间移动」闪 1.5 秒太黏了。
取 24fps ⇒ 0.75s，与 `磁电菇_子弹命中`（9 帧 / 0.75s）的一次性节拍同量级。

⚠️ `sample` 与 `_duration` 必须成对改：键时刻是 `i / sample`，`_duration` 是
`帧数 / sample`。只改一个会让末帧停在半路（或播完再定 0.5s 的空画面）。
"""
import json
import os
import struct
import uuid

ROOT = 'assets/bundles/battle/units/projectiles/瞬间移动特效'
NAME = '瞬间移动特效'

# 可见内容最大那一帧（第 15 帧）的 bbox 边长，见文件头注释。
PEAK_VISIBLE_PX = 1166
# 需求给的屏上尺寸（px）。
TARGET_SIZE_PX = 80
# 烘焙缩放 = 80 / 1166。
SCALE = round(TARGET_SIZE_PX / PEAK_VISIBLE_PX, 5)

# 18 帧 / 24fps = 0.75s。
SAMPLE = 24
FRAME_COUNT = 18
DURATION = round(FRAME_COUNT / SAMPLE, 5)


def png_size(path):
    raw = open(path, 'rb').read(33)
    return struct.unpack('>II', raw[16:24])


def new_uuid():
    return str(uuid.uuid4())


def file_id():
    return uuid.uuid4().hex[:22]


def write_json(path, data):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print('[ok]', path)


def patch_frame_meta(png_path):
    """把 `type = texture` 的图改成 `type = sprite-frame`，并补 `f9941` 子资源。

    结构逐键照抄 `hex_pulse_seq/hex_pulse_0.png.meta`（同一类「序列帧 + 不裁剪」资源）。
    已补过的直接跳过，脚本可重复执行。
    """
    meta_path = png_path + '.meta'
    meta = json.load(open(meta_path, encoding='utf-8'))
    if 'f9941' in meta.get('subMetas', {}):
        return meta['uuid'] + '@f9941'
    width, height = png_size(png_path)
    asset_uuid = meta['uuid']
    display = os.path.splitext(os.path.basename(png_path))[0]
    half_w, half_h = width / 2, height / 2
    meta['subMetas']['f9941'] = {
        'importer': 'sprite-frame',
        'uuid': asset_uuid + '@f9941',
        'displayName': display,
        'id': 'f9941',
        'name': 'spriteFrame',
        'userData': {
            'trimThreshold': 1,
            'rotated': False,
            # 不裁剪 ⇒ offset / trim 全 0，width/height 就是画布本身。
            'offsetX': 0,
            'offsetY': 0,
            'trimX': 0,
            'trimY': 0,
            'width': width,
            'height': height,
            'rawWidth': width,
            'rawHeight': height,
            'borderTop': 0,
            'borderBottom': 0,
            'borderLeft': 0,
            'borderRight': 0,
            'packable': True,
            'pixelsToUnit': 100,
            'pivotX': 0.5,
            'pivotY': 0.5,
            'meshType': 0,
            'vertices': {
                'rawPosition': [-half_w, -half_h, 0, half_w, -half_h, 0,
                                -half_w, half_h, 0, half_w, half_h, 0],
                'indexes': [0, 1, 2, 2, 1, 3],
                'uv': [0, height, width, height, 0, 0, width, 0],
                'nuv': [0, 0, 1, 0, 0, 1, 1, 1],
                'minPos': [-half_w, -half_h, 0],
                'maxPos': [half_w, half_h, 0],
            },
            'isUuid': True,
            'imageUuidOrDatabaseUri': asset_uuid + '@6c48a',
            'atlasUuid': '',
            'trimType': 'none',
        },
        'ver': '1.0.12',
        'imported': True,
        'files': ['.json'],
        'subMetas': {},
    }
    meta['userData']['type'] = 'sprite-frame'
    write_json(meta_path, meta)
    return asset_uuid + '@f9941'


def prefab_doc(name, width, height, scale, frames, clip_uuid):
    """单节点 + UITransform + Sprite + Animation（与磁电菇 / 雷弹两件套同构）。"""
    return [
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
            '_components': [{'__id__': 2}, {'__id__': 4}, {'__id__': 6}],
            '_prefab': {'__id__': 9},
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
            # 2/4 = SRC_ALPHA / ONE_MINUS_SRC_ALPHA。
            # 这张特效是「白色光斑 + 星屑」，叠一层普通 alpha 混合最稳；
            # 改加色会让中间那几帧的白芯直接烧成一片纯白，看不出爆开的层次。
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
        {
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
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id()},
        {
            '__type__': 'cc.PrefabInfo',
            'root': {'__id__': 1},
            'asset': {'__id__': 0},
            'fileId': file_id(),
            'instance': None,
            'targetOverrides': None,
        },
    ]


def anim_doc(name, frames, sample, duration):
    times = [round(i / sample, 10) for i in range(len(frames))]
    return {
        '__type__': 'cc.AnimationClip',
        '_name': name,
        '_objFlags': 0,
        '_native': '',
        'sample': sample,
        'speed': 1,
        # 1 = Normal：播完停在末帧。瞬间移动是「一次性」的，不能 loop。
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
                    '_curve': {
                        '__type__': 'cc.ObjectCurve',
                        '_times': times,
                        '_values': [{'__uuid__': u, '__expectedType__': 'cc.SpriteFrame'} for u in frames],
                    },
                },
            },
        ],
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
    pngs = sorted(p for p in (os.path.join(ROOT, n) for n in os.listdir(ROOT))
                  if p.endswith('.png'))
    assert len(pngs) == FRAME_COUNT, f'帧数不对：{len(pngs)}（期望 {FRAME_COUNT}）'
    frames = [patch_frame_meta(p) for p in pngs]
    width, height = png_size(pngs[0])

    clip_uuid = new_uuid()
    prefab_path = os.path.join(ROOT, NAME + '.prefab')
    write_json(prefab_path, prefab_doc(NAME, width, height, SCALE, frames, clip_uuid))
    write_json(prefab_path + '.meta', asset_meta('prefab', '1.1.50', new_uuid()))

    # 目录 meta：先于 prefab 的 userData.syncNodeName 生成（后者由编辑器接管，手写会被覆盖）。
    if not os.path.exists(ROOT + '.meta'):
        write_json(ROOT + '.meta', asset_meta('directory', '1.2.0', new_uuid()))

    anim_dir = os.path.join(ROOT, 'anim')
    write_json(anim_dir + '.meta', asset_meta('directory', '1.2.0', new_uuid()))
    write_json(os.path.join(anim_dir, NAME + '.anim'), anim_doc(NAME, frames, SAMPLE, DURATION))
    write_json(os.path.join(anim_dir, NAME + '.anim.meta'),
               asset_meta('animation-clip', '2.0.4', clip_uuid, NAME))

    print(f'\n[info] {NAME}: {len(frames)} 帧 / 画布 {width}x{height}'
          f' / 可见峰值 {PEAK_VISIBLE_PX}px / 烘焙缩放 {SCALE} ⇒ 屏上约 {TARGET_SIZE_PX}px')
    print(f'[info] sample={SAMPLE} duration={DURATION}s')


main()
