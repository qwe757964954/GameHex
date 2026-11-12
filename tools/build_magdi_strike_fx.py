# -*- coding: utf-8 -*-
"""磁电菇两套主动技能特效：散图 -> 自动图集(.pac) + 序列帧动画 + 战斗 Prefab（2026-11-11）。

美术只丢了散图，两个目录里**没有 prefab / anim / pac**：

| 目录 | 散图 | 用途 |
| :-- | :-- | :-- |
| `units/projectiles/磁电菇_劈雷技能/` | 20 张 1019×607（`014-1-attack_11 … _40`） | 101603「五雷轰顶」`bolt_strike` |
| `units/projectiles/雷电冲击/` | 18 张 1042×289（`…_01 … _18`） | 101604「磁电冲击」`self_aura` |

在此之前两处都只能借用别人的预制体（`雷法师_武将闪电` / `持续光环伤害效果`）——
`pvpSkill.effectPrefabPath` 只认 prefab 路径，散图再多也播不出来。

## 结构（与工程现役三件套同构）

    <set>/atlas/<帧>.png + <set>/atlas/<set>.pac     auto-atlas 自动图集
    <set>/anim/<片段>.anim                            序列帧动画（ObjectTrack → cc.Sprite.spriteFrame）
    <set>/<set>.prefab                                战斗特效 Prefab（单节点）

Prefab 取**单节点**（而不是 `玉米射手_普攻` 那种「根 + offset」两级）：落雷需要把
**地面接地点**压到节点原点上，而单节点的根 `_lpos` 正好承担这个静态摆位
（`ZCCombatEffectView.mountVisual` 明确**不清零**根节点位置，只把宿主节点挪到事件坐标）。
`雷法师_武将闪电` / `磁电菇_子弹攻击` 都是这个结构。

## 尺寸口径（只改 `TARGET_SCREEN_PX` 这一个数）

项目统一换算（docs §1.11，见 `ZCCombatEffectScale` 注释）：

    屏上 px = 逻辑 px × combatDistanceScale(0.3) × view/logical(2.5625) = 逻辑 px × 0.76875

**劈雷**：判定半径 `pvpSkillPlan.skillParamJson.boltRadius = 90` ⇒ 地面爆闪直径
`90 × 2 × 0.76875 = 138.4` 屏上 px。分母取源图里**最亮那一帧的底部爆闪可见宽**
（第 19 帧，alpha>60 底部 12% 带 = 339 源 px），不是画布宽 —— 画布 1019 宽里
闪电只占 450，拿画布当分母会把雷缩到三分之一。

**雷电冲击**：判定半径 `auraRadius = 180`（L2 档）⇒ 冲击波长度 `180 × 2 × 0.76875 = 276.6` 屏上 px。
分母取**内容并集宽**（961 源 px，光核在左端的深色球）。三档半径 160 / 180 / 200
只有一个预制体，按中档 L2 烘焙 ⇒ L1 视觉偏大 12.5%、L3 偏小 10%（视觉与判定本来就不是
同一个形状：判定是圆，美术是横向束，见 §14.5）。

## 帧选择

- **劈雷 20 帧全取**，`sample = 30`、`wrapMode = 1`（一次性，停在末帧）。
  30fps 是为了对上设计案的「**伤害判定在特效第 5 帧**」：第 5 帧（index 4）占
  `4/30 = 0.1333s ~ 5/30 = 0.1667s`，配表 `boltDelay = 0.15` 正落在这一帧中间，
  配表与表现都不用改。整段 20/30 = **0.667s**，落雷表现事件必须活够这么久
  （`ZCBoltStrikeFx.ZC_BOLT_EFFECT_SECONDS`）。
- **雷电冲击只取第 9~14 帧**：设计案 101604 表现描述原文「使用【雷电冲击】特效，
  中间需要持续时间是，使用 9~14 帧循环」。1~8 是起势、15~18 是消散，不进循环段
  （3 秒持续里循环 6 圈）。剩余 12 帧按 `build_aura_fx.py` 的同一套口径搬去
  `tmp/projectile_src/<set>/`，**不留在 bundle 里被打包**。
  入场「由无到有」交给区域系统的 `growSeconds = 0.2`，不靠这段动画自己长。

## 重入

已存在的 `atlas/<帧>.meta` / `.pac.meta` / `.anim.meta` / `.prefab.meta` 一律**复用 uuid**，
`fileId` 由 prefab uuid 派生的 md5 前 22 位 ⇒ 重跑不会让工程文件无意义地抖动。
源散图搬走后重跑会从 `tmp/projectile_src/` 找回，不会报缺帧。
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

#  屏上 px / 逻辑 px，见文件头「尺寸口径」。
SCREEN_PX_PER_LOGIC = 0.3 * 2.5625

#  裁切后统一再缩一半：源图画布 1019×607 / 1042×289 太大，20 帧原样进图集会吃掉 50MB 显存。
DOWNSCALE = 2

#  画布外留白（源 px）：闪电的辉光在 alpha>60 之外还有一圈，留一点免得被切出硬边。
CROP_MARGIN = 12

LAYER_UI_2D = 33554432  # 1 << 25
WRAP_ONCE = 1
WRAP_LOOP = 2

SETS = [
    dict(
        name='磁电菇_劈雷技能',
        frames=['014-1-attack_%02d.png' % i
                for i in (11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 27, 30, 33, 35, 38, 39, 40)],
        #  判定半径 boltRadius = 90（表值）⇒ 屏上直径 138.4。
        target_screen_px=90 * 2 * SCREEN_PX_PER_LOGIC,
        #  分母：地面爆闪的可见宽（量法见文件头）—— 见 footer 里 anchor 的说明。
        measure='ground_splash',
        sample=30,
        wrap=WRAP_ONCE,
        clip_name='磁电菇_劈雷技能',
        #  地面接地点压到节点原点：落雷是「打在这一点上」的，不是「悬在这点上」。
        anchor='ground',
        keep_all=True,
    ),
    dict(
        name='雷电冲击',
        frames=['151 SLBLJS vfx_skill_frozen_01_01_01_%02d.png' % i for i in range(9, 15)],
        #  判定半径 auraRadius = 180（L2 档）⇒ 冲击波长度 276.6。
        target_screen_px=180 * 2 * SCREEN_PX_PER_LOGIC,
        measure='content_width',
        sample=12,
        wrap=WRAP_LOOP,
        clip_name='雷电冲击-loop',
        #  冲击波是**以判定圆心为中心**向两侧铺开的，居中即可（美术本身左端是发射球）。
        anchor='center',
        keep_all=False,
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
    """alpha > threshold 的可见框（左, 上, 右, 下）。"""
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

    按**整帧画布**写（不裁剪）、`trimType: "none"` + prefab 的 `_isTrimmedMode = false`：
    逐帧换图不会跟着新图的可见框变形（docs §1.5）。
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
    """照抄 `磁电菇_子弹攻击.pac.meta`（工程里正在用的自动图集口径）。

    ⚠️ 三处与 `build_dart_attack_fx.build_pac` 不同：`filterUnused: false`、
    `removeTextureInBundle: false`、`removeImageInBundle: false`。这三项取 `true` 时
    图集打包会把散图从 bundle 里摘掉，而编辑器**没有**重新 import 过这批手写 meta，
    运行时就会两头都取不到（贴图没了、图集也还没生成）。
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
        #  以下 5 个键是 3.8.x 序列化器给 AnimationClip 补的尾部字段：不写也能跑，
        #  但工程里既有 .anim 全都带，缺了会被编辑器点开时改写、产生无意义 diff。
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
    """单节点 + UITransform + Sprite + Animation（与 `雷法师_武将闪电` 同构）。

    `fileId` 由 prefab 的 meta uuid（`seed`）派生 ⇒ 重跑不会抖动。
    """
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
            #  闪电的辉光已经烘在 alpha 里，再叠加色混合会把整道雷爆成白团。
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
    """散图可能已被上一次运行搬进缓存目录。"""
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

    frames = cfg['frames']
    sources = [source_path(set_dir, f) for f in frames]

    # 1) 可见并集 → 裁切框（按 DOWNSCALE 取偶数，保证画布是整数且不抖）
    boxes = [alpha_bbox(p) for p in sources]
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    src_w, src_h = png_size(sources[0])
    crop_left = max(0, left - CROP_MARGIN)
    crop_top = max(0, top - CROP_MARGIN)
    crop_right = min(src_w, right + CROP_MARGIN)
    crop_bottom = min(src_h, bottom + CROP_MARGIN)
    crop_w = (crop_right - crop_left) // DOWNSCALE * DOWNSCALE
    crop_h = (crop_bottom - crop_top) // DOWNSCALE * DOWNSCALE
    canvas_w = crop_w // DOWNSCALE
    canvas_h = crop_h // DOWNSCALE

    # 2) 反算缩放：分母 = 源图上「要跟判定对齐的那一段」的可见尺寸
    if cfg['measure'] == 'ground_splash':
        #  逐帧量「底部 12% 带」的可见宽，取**全序列最大值**：爆闪最亮的那一帧
        #  不一定是画面最靠下的那一帧（雷尾还在往下滴的时候爆闪已经淡了）。
        widths = []
        for path, box in zip(sources, boxes):
            with Image.open(path) as im:
                mask = im.convert('RGBA').getchannel('A').point(lambda v: 255 if v > 60 else 0)
                band_top = max(0, box[3] - int(src_h * 0.12))
                band = mask.crop((0, band_top, src_w, src_h)).getbbox()
            widths.append(band[2] - band[0] if band else 0)
        measured_src = max(widths)
        measured_label = '地面爆闪宽（%d 帧底部 12%% 带最大值）' % len(widths)
    else:
        measured_src = right - left
        measured_label = '内容并集宽'
    measured_canvas = measured_src * canvas_w / float(crop_w)
    scale = cfg['target_screen_px'] / measured_canvas

    # 3) 摆位：把「接地点」压到节点原点（落雷），或保持居中（冲击波）
    if cfg['anchor'] == 'ground':
        #  画布里「从顶部往下」量出来的接地点 y，换成相对画布中心的**向上**偏移（Cocos +y 朝上）。
        #  接地点在中心下方 135.5 画布 px ⇒ 节点要**往上抬** 135.5 × scale 才能让它落回原点。
        ground_canvas = (bottom - crop_top) * canvas_h / float(crop_h)
        pos = (0.0, (ground_canvas - canvas_h / 2.0) * scale)
    else:
        pos = (0.0, 0.0)

    # 4) 缩图进 atlas/，并写「整帧不裁剪」的 sprite-frame meta
    frame_uuids = []
    for frame, src in zip(frames, sources):
        dst = os.path.join(atlas_dir, frame)
        dst_meta = dst + '.meta'
        with Image.open(src) as im:
            im = im.convert('RGBA').crop((crop_left, crop_top, crop_left + crop_w, crop_top + crop_h))
            im = im.resize((canvas_w, canvas_h), Image.LANCZOS)
            im.save(dst, 'PNG', optimize=True)
        meta_uuid = existing_uuid(dst_meta)
        write_json(dst_meta, build_sprite_frame_meta(meta_uuid, os.path.splitext(frame)[0],
                                                     canvas_w, canvas_h))
        frame_uuids.append(meta_uuid + '@f9941')

    # 5) 源散图搬出 bundle（不销毁原尺寸：以后要更高分辨率还能拿回来重跑）
    for frame in frames:
        for suffix in ('', '.meta'):
            loose = os.path.join(set_dir, frame + suffix)
            if os.path.isfile(loose):
                shutil.move(loose, os.path.join(cache_dir, os.path.basename(loose)))
    if not cfg['keep_all']:
        wanted = set(frames)
        moved = 0
        for entry in sorted(os.listdir(set_dir)):
            base = entry[:-5] if entry.endswith('.meta') else entry
            if not base.lower().endswith('.png') or base in wanted:
                continue
            shutil.move(os.path.join(set_dir, entry), os.path.join(cache_dir, entry))
            moved += 1
        if moved:
            print('[缓存] %s：%d 个未用散图 -> tmp/projectile_src/%s/' % (name, moved, name))

    # 6) 子目录 meta
    for directory in (atlas_dir, anim_dir):
        meta_path = directory + '.meta'
        if not os.path.isfile(meta_path):
            write_json(meta_path, build_dir_meta(new_uuid()))

    # 7) 自动图集
    pac_path = os.path.join(atlas_dir, name + '.pac')
    write_json(pac_path, {'__type__': 'cc.SpriteAtlas'})
    write_json(pac_path + '.meta', build_pac_meta(existing_uuid(pac_path + '.meta')))

    # 8) 动画
    clip_name = cfg['clip_name']
    anim_path = os.path.join(anim_dir, clip_name + '.anim')
    anim_meta_path = anim_path + '.meta'
    anim_uuid = existing_uuid(anim_meta_path)
    clip = build_anim(clip_name, frame_uuids, cfg['sample'], cfg['wrap'])
    write_json(anim_path, clip)
    write_json(anim_meta_path, {
        'ver': '2.0.4',
        'importer': 'animation-clip',
        'imported': True,
        'uuid': anim_uuid,
        'files': ['.bin'],
        'subMetas': {},
        'userData': {'name': clip_name},
    })

    # 9) Prefab
    prefab_path = os.path.join(set_dir, name + '.prefab')
    prefab_uuid = existing_uuid(prefab_path + '.meta')
    write_json(prefab_path, build_prefab(name, canvas_w, canvas_h, scale, pos,
                                         frame_uuids[0], anim_uuid, prefab_uuid))
    write_json(prefab_path + '.meta', build_prefab_meta(name, prefab_uuid))

    print('[%s] %d 帧  sample=%d wrap=%d  %.3fs' % (
        name, len(frames), cfg['sample'], cfg['wrap'], clip['_duration']))
    print('        源 %dx%d → 裁 %dx%d @(%d,%d) → 画布 %dx%d' % (
        src_w, src_h, crop_w, crop_h, crop_left, crop_top, canvas_w, canvas_h))
    print('        %s = %d 源 px = %.1f 画布 px ⇒ 缩放 %.6f（屏上目标 %.1f px）' % (
        measured_label, measured_src, measured_canvas, scale, cfg['target_screen_px']))
    print('        根节点 _lpos = (%.6f, %.6f)' % pos)
    print('        路径 = units/projectiles/%s/%s' % (name, name))
    return dict(name=name, prefab=prefab_path, scale=scale, pos=pos,
                canvas=(canvas_w, canvas_h), frames=len(frames))


def main():
    results = [build_set(cfg) for cfg in SETS]
    print('\n完成 %d 套。' % len(results))


if __name__ == '__main__':
    main()
