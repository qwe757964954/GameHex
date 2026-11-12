# -*- coding: utf-8 -*-
"""科学家「精密陷阱」103504 的两套特效：散图 -> 自动图集(.pac) + 序列帧动画 + 战斗 Prefab（2026-11-12）。

美术只丢了散图，两个目录里**没有 prefab / anim / pac**：

| 目录 | 散图 | 用途 |
| :-- | :-- | :-- |
| `units/projectiles/科学家_陷阱/` | `vfx_skill_burngo_01_03-idle_00..11`（334×123）+ `-start_00..11`（331×117） | 陷阱常驻 / 生成 |
| `units/projectiles/科学家_陷阱爆炸/` | `032 SLBLJS levelup-1_00..17`（600×600） | 触碰或到点后的爆炸 |

设计案 175 行的表现口径原文：

    陷阱生成使用 【科学家陷阱】start00~start11 序列帧
    【陷阱】在持续时间内使用 idle00~idle11 的序列帧
    触碰陷阱直接消失，播放【科学家陷阱爆炸】特效

## 为什么要拆成三个 prefab（而 `磁电菇_劈雷技能` 只有一个）

一句话：**一个 `cc.AnimationClip` 的 `wrapMode` 管整段**，没法「先播一次 start、再无限循环 idle」。
工程里的 `ZCCombatEffectView` 只在 `mountVisual` 时 `play(默认 clip)`，不会自己接龙，也不认
「播完切下一段」。所以拆成三份、由**模型**决定谁在哪一拍出场（见 `ZCTrapFx` 的注释）：

    <set>/科学家_陷阱.prefab         idle 12 帧 loop     —— 常驻（区域的 holdVisual）
    <set>/科学家_陷阱_出现.prefab    start 12 帧 once    —— 生成那一拍（0.4s 后自动消失）
    <set>/科学家_陷阱爆炸/….prefab   18 帧 once          —— 死亡那一拍

🔴 生成段的 0.4s 与常驻段的出场时刻由**模型**对齐（`visualDelaySeconds = 0.4`），
不靠视图接龙 —— 视图只负责「到点才建节点」（`zcCombatEffectEntered`，docs §14.9）。

## 尺寸口径（只改 `TARGET_SCREEN_PX` 这一处）

    屏上 px = 逻辑 px × combatDistanceScale(0.3) × view/logical(2.5625) = 逻辑 px × 0.76875

| 预制 | 判定口径（表值） | 屏上目标 | 分母（源图可见宽） |
| :-- | :-- | :-- | :-- |
| 陷阱 idle / 出现 | 触碰直径 `trapRadius 50 × 2 = 100` 逻辑 px | **76.9 px** | idle 帧可见宽 300 源 px |
| 陷阱爆炸 | 爆炸直径 `trapExplodeRadius 100 × 2 = 200` 逻辑 px | **153.8 px** | 18 帧里最宽的 501 源 px |

分母一律用**可见宽**、不用画布宽：`334×123` 的画布里光环只占 300，`600×600` 的爆闪只占 501，
拿画布当分母会把特效缩到一半 —— 「看着多大就打多大」是这条口径存在的唯一理由。

## 帧选择

- **idle 12 帧全取，`sample = 12`、`wrapMode = 2`（循环）** ⇒ 一圈 1.0s，常驻期间不间断。
- **start 12 帧全取，`sample = 30`、`wrapMode = 1`（一次性）** ⇒ 0.4s 长完，
  与 `ZCTrapFx.ZC_TRAP_SPAWN_SECONDS` 必须是同一个数（模型用它当常驻视觉的延迟）。
- **爆炸 18 帧全取，`sample = 30`、`wrapMode = 1`** ⇒ 0.6s，与 `ZC_TRAP_EXPIRE_SECONDS` 同源。

## 重入

已存在的 `.meta` 一律复用 uuid，`fileId` 由 prefab uuid 派生 ⇒ 重跑不会让工程文件抖动；
源散图搬走后重跑会从 `tmp/projectile_src/` 找回。
"""
import hashlib
import json
import os
import shutil
import struct
import uuid as uuid_mod

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTILES_DIR = os.path.join(ROOT, 'assets', 'bundles', 'battle', 'units', 'projectiles')
SRC_CACHE_ROOT = os.path.join(ROOT, 'tmp', 'projectile_src')

SCREEN_PX_PER_LOGIC = 0.3 * 2.5625

DOWNSCALE = 2
CROP_MARGIN = 12

LAYER_UI_2D = 33554432  # 1 << 25
WRAP_ONCE = 1
WRAP_LOOP = 2

TRAP_FRAME = 'vfx_skill_burngo_01_03-%s_%02d.png'
BLAST_FRAME = '032 SLBLJS levelup-1_%02d.png'

SETS = [
    dict(
        name='科学家_陷阱',
        #  两段动画共用一套裁切框（生成段的最后一帧比常驻段更宽）⇒ 两张 prefab 像素级对齐。
        clips=[
            dict(prefab='科学家_陷阱', clip_name='科学家_陷阱-idle', wrap=WRAP_LOOP, sample=12,
                 frames=[TRAP_FRAME % ('idle', i) for i in range(12)]),
            dict(prefab='科学家_陷阱_出现', clip_name='科学家_陷阱-出现', wrap=WRAP_ONCE, sample=30,
                 frames=[TRAP_FRAME % ('start', i) for i in range(12)]),
        ],
        #  分母只看**常驻段**：生成段最后一帧本来就比常驻段大一圈（光晕炸开），
        #  拿它当分母会把常驻光环缩到 93%。
        measure_frames=[TRAP_FRAME % ('idle', i) for i in range(12)],
        #  触碰直径 = trapRadius 50 × 2 = 100 逻辑 px。
        target_screen_px=100 * SCREEN_PX_PER_LOGIC,
        keep_all=True,
    ),
    dict(
        name='科学家_陷阱爆炸',
        clips=[
            dict(prefab='科学家_陷阱爆炸', clip_name='科学家_陷阱爆炸', wrap=WRAP_ONCE, sample=30,
                 frames=[BLAST_FRAME % i for i in range(18)]),
        ],
        measure_frames=[BLAST_FRAME % i for i in range(18)],
        #  爆炸直径 = trapExplodeRadius 100 × 2 = 200 逻辑 px。
        target_screen_px=200 * SCREEN_PX_PER_LOGIC,
        keep_all=True,
    ),
]


# ─────────────────────────── 基础工具 ───────────────────────────

def new_uuid():
    return str(uuid_mod.uuid4())


def write_json(path, obj):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)


def read_json(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def existing_uuid(meta_path):
    if os.path.isfile(meta_path):
        meta = read_json(meta_path)
        if meta.get('uuid'):
            return meta['uuid']
    return new_uuid()


def png_size(path):
    with open(path, 'rb') as fh:
        head = fh.read(26)
    return struct.unpack('>II', head[16:24])


def alpha_bbox(path, threshold=60):
    with Image.open(path) as im:
        mask = im.convert('RGBA').getchannel('A').point(lambda v: 255 if v > threshold else 0)
        return mask.getbbox()


def round6(value):
    return round(float(value), 6)


# ─────────────────────────── meta ───────────────────────────

def build_dir_meta(meta_uuid):
    return {
        'ver': '1.2.0',
        'importer': 'directory',
        'imported': True,
        'uuid': meta_uuid,
        'files': [],
        'subMetas': {},
        'userData': {},
    }


def build_sprite_frame_meta(meta_uuid, display_name, width, height):
    """image impostor：`type = sprite-frame`，子资源 6c48a(texture) + f9941(spriteFrame)。

    🔴 散图默认导成 `type = "texture"`（**只有 `@6c48a`，没有 `@f9941`**）。Prefab 里的
    `cc.Sprite._spriteFrame` 引的是 `@f9941`，缺这个子资源时引用取不到、**不报任何错**，
    特效永远不出现 —— 这一步是整个脚本里最容易静默失败的地方。
    """
    half_w, half_h = width / 2.0, height / 2.0
    return {
        'ver': '1.0.27',
        'importer': 'image',
        'imported': True,
        'uuid': meta_uuid,
        'files': ['.json', '.png'],
        'subMetas': {
            '6c48a': {
                'importer': 'texture',
                'uuid': meta_uuid + '@6c48a',
                'displayName': display_name,
                'id': '6c48a',
                'name': 'texture',
                'userData': {
                    'wrapModeS': 'clamp-to-edge',
                    'wrapModeT': 'clamp-to-edge',
                    'imageUuidOrDatabaseUri': meta_uuid,
                    'isUuid': True,
                    'visible': False,
                    'minfilter': 'linear',
                    'magfilter': 'linear',
                    'mipfilter': 'none',
                    'anisotropy': 0,
                },
                'ver': '1.0.22',
                'imported': True,
                'files': ['.json'],
                'subMetas': {},
            },
            'f9941': {
                'importer': 'sprite-frame',
                'uuid': meta_uuid + '@f9941',
                'displayName': display_name,
                'id': 'f9941',
                'name': 'spriteFrame',
                'userData': {
                    'trimThreshold': 1,
                    'rotated': False,
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
                        'rawPosition': [
                            -half_w, -half_h, 0,
                            half_w, -half_h, 0,
                            -half_w, half_h, 0,
                            half_w, half_h, 0,
                        ],
                        'indexes': [0, 1, 2, 2, 1, 3],
                        'uv': [0, height, width, height, 0, 0, width, 0],
                        'nuv': [0, 1, 1, 1, 0, 0, 1, 0],
                        'minPos': [-half_w, -half_h, 0],
                        'maxPos': [half_w, half_h, 0],
                    },
                    'isUuid': True,
                    'imageUuidOrDatabaseUri': meta_uuid + '@6c48a',
                    'atlasUuid': '',
                    'trimType': 'none',
                },
                'ver': '1.0.12',
                'imported': True,
                'files': ['.json'],
                'subMetas': {},
            },
        },
        'userData': {
            'type': 'sprite-frame',
            'fixAlphaTransparencyArtifacts': False,
            'hasAlpha': True,
            'redirect': meta_uuid + '@6c48a',
        },
    }


def build_pac_meta(meta_uuid):
    """照抄 `磁电菇_劈雷技能.pac.meta`（工程里正在用的自动图集口径）。

    ⚠️ `filterUnused` / `removeTextureInBundle` / `removeImageInBundle` 必须是 `false`：
    取 `true` 时打包会把散图从 bundle 里摘掉，而编辑器没有重新 import 过这批手写 meta，
    运行时两头都取不到（贴图没了、图集也还没生成）。
    """
    return {
        'ver': '1.0.8',
        'importer': 'auto-atlas',
        'imported': True,
        'uuid': meta_uuid,
        'files': ['.json'],
        'subMetas': {},
        'userData': {
            'maxWidth': 1024,
            'maxHeight': 1024,
            'padding': 2,
            'allowRotation': True,
            'forceSquared': False,
            'powerOfTwo': True,
            'algorithm': 'MaxRects',
            'format': 'png',
            'quality': 80,
            'contourBleed': True,
            'paddingBleed': True,
            'filterUnused': False,
            'removeTextureInBundle': False,
            'removeImageInBundle': False,
            'compressSettings': {
                'useCompressTexture': False,
                'compressType': 'default',
                'mode': 'shortest',
            },
            'removeSpriteAtlasInBundle': True,
            'textureSetting': {
                'wrapModeS': 'repeat',
                'wrapModeT': 'repeat',
                'minfilter': 'linear',
                'magfilter': 'linear',
                'mipfilter': 'none',
                'anisotropy': 0,
            },
        },
    }


# ─────────────────────────── 动画 / Prefab ───────────────────────────

def build_anim(name, frame_uuids, sample, wrap):
    step = 1.0 / sample
    return {
        '__type__': 'cc.AnimationClip',
        '_name': name,
        '_objFlags': 0,
        '_native': '',
        'sample': sample,
        'speed': 1,
        'wrapMode': wrap,
        'events': [],
        '_duration': round(len(frame_uuids) * step, 10),
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
                        '_times': [round(i * step, 10) for i in range(len(frame_uuids))],
                        '_values': [{'__uuid__': u, '__expectedType__': 'cc.SpriteFrame'}
                                    for u in frame_uuids],
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


def build_prefab(name, width, height, scale, pos, first_frame, clip_uuid, seed):
    """单节点 + UITransform + Sprite + Animation（与 `磁电菇_劈雷技能` / `雷法师_武将闪电` 同构）。"""
    def file_id(purpose):
        return hashlib.md5(('%s:%s' % (seed, purpose)).encode('utf-8')).hexdigest()[:22]

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
            '_prefab': {'__id__': 8},
            '_lpos': {'__type__': 'cc.Vec3', 'x': round6(pos[0]), 'y': round6(pos[1]), 'z': 0},
            '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
            '_lscale': {'__type__': 'cc.Vec3', 'x': round6(scale), 'y': round6(scale), 'z': 1},
            '_mobility': 0,
            '_layer': LAYER_UI_2D,
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
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id('ui')},
        {
            '__type__': 'cc.Sprite',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 1},
            '_enabled': True,
            '__prefab': {'__id__': 5},
            '_customMaterial': None,
            #  2 / 4 = SRC_ALPHA / ONE_MINUS_SRC_ALPHA（普通 alpha 混合）。
            '_srcBlendFactor': 2,
            '_dstBlendFactor': 4,
            '_color': {'__type__': 'cc.Color', 'r': 255, 'g': 255, 'b': 255, 'a': 255},
            '_spriteFrame': {'__uuid__': first_frame, '__expectedType__': 'cc.SpriteFrame'},
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
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id('sprite')},
        {
            '__type__': 'cc.Animation',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 1},
            '_enabled': True,
            '__prefab': {'__id__': 7},
            #  播放由 `ZCCombatEffectView.mountVisual` 显式 `play(defaultClip.name)` 发起。
            'playOnLoad': False,
            '_clips': [{'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'}],
            '_defaultClip': {'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'},
            '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id('anim')},
        {
            '__type__': 'cc.PrefabInfo',
            'root': {'__id__': 1},
            'asset': {'__id__': 0},
            'fileId': file_id('root'),
            'instance': None,
            'targetOverrides': None,
        },
    ]


def build_prefab_meta(name, meta_uuid):
    return {
        'ver': '1.1.50',
        'importer': 'prefab',
        'imported': True,
        'uuid': meta_uuid,
        'files': ['.json'],
        'subMetas': {},
        'userData': {'syncNodeName': name},
    }


# ─────────────────────────── 主流程 ───────────────────────────

def source_path(set_dir, frame):
    direct = os.path.join(set_dir, frame)
    if os.path.isfile(direct):
        return direct
    cached = os.path.join(SRC_CACHE_ROOT, os.path.basename(set_dir), frame)
    if os.path.isfile(cached):
        return cached
    raise RuntimeError('缺帧：%s' % direct)


def build_set(cfg):
    name = cfg['name']
    set_dir = os.path.join(PROJECTILES_DIR, name)
    if not os.path.isdir(set_dir):
        raise RuntimeError('目录不存在：%s' % set_dir)
    atlas_dir = os.path.join(set_dir, 'atlas')
    anim_dir = os.path.join(set_dir, 'anim')
    cache_dir = os.path.join(SRC_CACHE_ROOT, name)
    os.makedirs(atlas_dir, exist_ok=True)
    os.makedirs(anim_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)

    # 1) 全套帧（去重、保序）→ 共用裁切框
    all_frames = []
    for clip in cfg['clips']:
        for frame in clip['frames']:
            if frame not in all_frames:
                all_frames.append(frame)
    sources = {frame: source_path(set_dir, frame) for frame in all_frames}
    boxes = [alpha_bbox(sources[frame]) for frame in all_frames]
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    src_w, src_h = png_size(sources[all_frames[0]])
    crop_left = max(0, left - CROP_MARGIN)
    crop_top = max(0, top - CROP_MARGIN)
    crop_right = min(src_w, right + CROP_MARGIN)
    crop_bottom = min(src_h, bottom + CROP_MARGIN)
    crop_w = (crop_right - crop_left) // DOWNSCALE * DOWNSCALE
    crop_h = (crop_bottom - crop_top) // DOWNSCALE * DOWNSCALE
    canvas_w = crop_w // DOWNSCALE
    canvas_h = crop_h // DOWNSCALE

    # 2) 反算缩放：分母 = 参照帧里**最宽的可见框**（不是画布宽，见文件头）
    widths = []
    for frame in cfg['measure_frames']:
        box = alpha_bbox(sources[frame])
        widths.append(box[2] - box[0] if box else 0)
    measured_src = max(widths) if widths else 0
    if not (measured_src > 0):
        raise RuntimeError('%s 参照帧全透明，量不出尺寸' % name)
    measured_canvas = measured_src * canvas_w / float(crop_w)
    scale = cfg['target_screen_px'] / measured_canvas

    # 3) 缩图进 atlas/，并写「整帧不裁剪」的 sprite-frame meta
    frame_uuids = {}
    for frame in all_frames:
        dst = os.path.join(atlas_dir, frame)
        dst_meta = dst + '.meta'
        with Image.open(sources[frame]) as im:
            im = im.convert('RGBA').crop((crop_left, crop_top, crop_left + crop_w, crop_top + crop_h))
            im = im.resize((canvas_w, canvas_h), Image.LANCZOS)
            im.save(dst, 'PNG', optimize=True)
        meta_uuid = existing_uuid(dst_meta)
        write_json(dst_meta, build_sprite_frame_meta(meta_uuid, os.path.splitext(frame)[0],
                                                     canvas_w, canvas_h))
        frame_uuids[frame] = meta_uuid + '@f9941'

    # 4) 源散图搬出 bundle（保留原图，便于以后更高分辨率重跑）
    for frame in all_frames:
        for suffix in ('', '.meta'):
            loose = os.path.join(set_dir, frame + suffix)
            if os.path.isfile(loose):
                shutil.move(loose, os.path.join(cache_dir, os.path.basename(loose)))

    # 5) 子目录 meta
    for directory in (atlas_dir, anim_dir):
        meta_path = directory + '.meta'
        if not os.path.isfile(meta_path):
            write_json(meta_path, build_dir_meta(new_uuid()))

    # 6) 自动图集（整个 set 共用一份）
    pac_path = os.path.join(atlas_dir, name + '.pac')
    write_json(pac_path, {'__type__': 'cc.SpriteAtlas'})
    write_json(pac_path + '.meta', build_pac_meta(existing_uuid(pac_path + '.meta')))

    # 7) 逐段：动画 + prefab
    built = []
    for clip in cfg['clips']:
        clip_name = clip['clip_name']
        anim_path = os.path.join(anim_dir, clip_name + '.anim')
        anim_meta_path = anim_path + '.meta'
        anim_uuid = existing_uuid(anim_meta_path)
        uuids = [frame_uuids[frame] for frame in clip['frames']]
        data = build_anim(clip_name, uuids, clip['sample'], clip['wrap'])
        write_json(anim_path, data)
        write_json(anim_meta_path, {
            'ver': '2.0.4',
            'importer': 'animation-clip',
            'imported': True,
            'uuid': anim_uuid,
            'files': ['.bin'],
            'subMetas': {},
            'userData': {'name': clip_name},
        })

        prefab_name = clip['prefab']
        prefab_path = os.path.join(set_dir, prefab_name + '.prefab')
        prefab_uuid = existing_uuid(prefab_path + '.meta')
        write_json(prefab_path, build_prefab(prefab_name, canvas_w, canvas_h, scale, (0.0, 0.0),
                                             uuids[0], anim_uuid, prefab_uuid))
        write_json(prefab_path + '.meta', build_prefab_meta(prefab_name, prefab_uuid))
        built.append((prefab_name, len(uuids), clip['sample'], clip['wrap'], data['_duration']))

    print('[%s] %d 帧共用  sample 见下' % (name, len(all_frames)))
    print('        源 %dx%d → 裁 %dx%d @(%d,%d) → 画布 %dx%d' % (
        src_w, src_h, crop_w, crop_h, crop_left, crop_top, canvas_w, canvas_h))
    print('        可见宽 %d 源 px = %.1f 画布 px ⇒ 缩放 %.6f（屏上目标 %.1f px）' % (
        measured_src, measured_canvas, scale, cfg['target_screen_px']))
    for prefab_name, count, sample, wrap, duration in built:
        print('        %-24s %2d 帧  sample=%2d wrap=%d  %.3fs' % (
            prefab_name, count, sample, wrap, duration))
    return dict(name=name, scale=scale, canvas=(canvas_w, canvas_h), clips=built)


def main():
    for cfg in SETS:
        build_set(cfg)
    print('\n完成 %d 套。' % len(SETS))


if __name__ == '__main__':
    main()
