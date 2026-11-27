# -*- coding: utf-8 -*-
"""大威天芦（68025）「无尘禁土」102503 的火焰光环：散图 -> 自动图集 + 序列帧 + 战斗 Prefab。

## 为什么需要这个脚本

美术只丢进来一个目录 `units/projectiles/大威天芦_火焰光环/`，里面是 **30 张 864×883 的散图**
（`245-3-standby_loop_00/02/05/07/…/59`），**没有 prefab / anim / pac** ——
与麻辣铁锅、磁电菇、雷蕉那几批完全一样的情况。按项目统一格式补齐三件套：

    <set>/atlas/<帧>.png (+ sprite-frame meta)
    <set>/atlas/<set>.pac  (+ auto-atlas meta)
    <set>/anim/<set>-loop.anim (+ animation-clip meta)
    <set>/<set>.prefab (+ prefab meta)

三件套结构、`sprite-frame` meta（`f9941` 子资源）、`pac.meta` 三处 `false` 的坑，
全部与 `tools/build_magdi_strike_fx.py` / `tools/build_maladi_guo_fx.py` 逐字同构，
理由见那两个文件的文件头与 `docs/zcds-表现层与领地规范.md` §14.5。这里只记**本脚本特有的三条**。

## 1) 这是「脚下地面环」，不是「身前光柱」—— 锚点取椭圆环的几何中心

拆开看这套图是三部分：**底部一圈地面椭圆环** + **环上竖起的火焰墙** + **环下方溅出的火星**。

`self_aura` 的判定是一个**以施法者为圆心的地面圆**（102503 没有配 `auraForward`，
`castSelfAura` 的 `spawnX/spawnY` 直接取本体位置）。所以能代表「判定范围」的只有那圈地面椭圆环，
火焰墙只是它的立体的延伸 —— 与「持续光环伤害效果」那根竖直光柱（判定圆在地面、光柱往上冲）
是同一类构图，只是这次换成了「环 + 火」。

锚点因此取 **椭圆环的几何中心**：3/4 视角下地面圆的投影是椭圆，椭圆的几何中心就是地面圆心的投影。
把它钉到宿主原点（= `groundZones` 的区域圆心 = 施法者逻辑脚点），环就正好扣在脚下。

🔴 **椭圆参数是量出来的，不是写死的**：

- 环中心 x = 「水平跨度最大的那些行」的左右缘中点中位（520.5）；
- 环中心 y = 同一批行的 y 中位（704）—— 椭圆的最宽处就在它的中心高度，
  比「拿全序列 bbox 的下缘减半高」稳（下缘那 828 里混着环下方溅出的火星）；
- 环外径 = **各帧跨度的最大值**（680，不是中位 664）：画布宽会被钉成它，
  取最大值才让「最满的那一帧」正好贴合判定边界，取中位会让最满那一帧溢出约 2%。

取「跨度 ≥ 最大跨度 × 0.96」是为了排除火焰墙那几行的窄跨度与火星行的碎跨度。
换美术时这套量法照旧成立，不用手改常量。

## 2) 尺寸：画布宽 = 环外径，于是 `width × _lscale` = 判定直径

判定 `auraRadius = 200`（逻辑 px，三档同值），项目统一换算（docs §1.11）：

    屏上 px = 逻辑 px × combatDistanceScale(0.3) × view/logical(2.5625) = 逻辑 px × 0.76875

⇒ 判定直径 = 400 × 0.76875 = **307.5 屏上 px**。

🔴 **横向裁切不「紧贴内容」，而是以环中心对称铺开、宽度正好等于环外径**。这不是为了省事，
而是为了让「看着多大就打多大」变成一条**可读的算术**：

    _contentSize.width(308) × _lscale(1) = 308 ≈ 307.5 = 判定直径（差 0.5 px = 取整误差）

用例（`tests/zcds-dawtianlu-skills.test.ts` 的尺寸那条）就是直接读 prefab 验这个等式，
不需要在别处再抄一个「可见宽」魔数。代价是环两侧各有一点点透明边（环外的火星），
可以忽略。

🔴 **画布就是屏上尺寸，`_lscale` 恒为 1**（2026-11-26 改口径，之前是画布 340 + 缩放
0.904412）。`ZCCombatEffectScale.NODE_SCALE_BY_PREFAB_PATH` 也不登记（未登记 = 宿主倍率 1）：
这条 prefab 只服务 102503 一个技能，没有共用方，所以倍率一处都不该有。
反过来说，**以后要改半径就重跑本脚本**（画布会跟着 `JUDGE_DIAMETER_SCREEN` 一起变），
别去 prefab 里手改 `_lscale`，也别去 `ZCCombatEffectScale` 里找。

高度不设约束：3/4 视角下地面圆的竖向投影本来就是压扁的（本套扁率约 0.365），
火焰墙往上多高由美术决定，判定只看地面那个圆。

## 3) `_lpos` 补偿：把环中心挪到节点原点

横向因为「画布宽 = 环外径」已经对称，`_lpos.x` 只剩取整误差（本套 −0.226）；
纵向还要补 —— 环中心在画布中心**下方**约 72 画布 px（火焰墙全在环上方），
`_lpos.y` 把这个差值补回来，让「环中心 = 节点原点 = 区域圆心 = 施法者脚点」
（本套 71.9284；缩图前 340 画布上是 79.5 × 0.904412 ≈ 71.9，屏上位移没变）。

🔴 这条成立的前提是**宿主节点不旋转**：`castSelfAura` 只有在配了 `auraFaceTarget` 时才写
`angleDegrees`，102503 没配 ⇒ 宿主保持 0° ⇒ `_lpos.y` 是纯竖直位移。
**如果以后给 102503 打开 `auraFaceTarget`，这个 `_lpos.y` 会变成垂直于朝向的侧移**
（`ZCSelfAuraFx` 文件头与 docs §14.6 都记着这个坑），届时要改成把偏移烘进子节点、或走 `auraVisualLiftPx`。

## 动画节奏

30 帧 / `sample = 12` ⇒ **2.5s**，`wrapMode = 2`（Loop）。102503 的 `auraSeconds` 是 4 / 6 / 8 秒，
一段循环播 1.6~3.2 遍；Loop 不会停在最后一帧，区域到期时 `holdVisual` 事件整块摘掉节点。

## 重入

已存在的 `.meta` 一律复用 uuid；`fileId` 由 prefab uuid 派生 ⇒ 重跑不抖动。
源散图搬进 `tmp/projectile_src/大威天芦_火焰光环/`，重跑时从缓存目录找回。
"""
import hashlib
import json
import os
import shutil
import statistics
import struct
import uuid as uuid_mod

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTILES_DIR = os.path.join(ROOT, 'assets', 'bundles', 'battle', 'units', 'projectiles')
SRC_CACHE_ROOT = os.path.join(ROOT, 'tmp', 'projectile_src')

NAME = '大威天芦_火焰光环'

#  屏上 px / 逻辑 px（docs §1.11）：0.3(combatDistanceScale) × 2.5625(view/logical)
SCREEN_PX_PER_LOGIC = 0.3 * 2.5625

CROP_MARGIN = 12

LAYER_UI_2D = 33554432  # 1 << 25
WRAP_LOOP = 2

SAMPLE = 12

#  102503 的 `auraRadius`（逻辑 px，三档同 200）⇒ 判定直径 400 逻辑 px。
AURA_RADIUS_LOGIC = 200
JUDGE_DIAMETER_SCREEN = AURA_RADIUS_LOGIC * 2 * SCREEN_PX_PER_LOGIC  # 307.5

#  环直径量法的取样阈值：跨度 ≥ 最大跨度 × 该比例的行才算「最宽处」。
RING_ROW_RATIO = 0.96
ALPHA_THRESHOLD = 60

FRAMES = ['245-3-standby_loop_%02d.png' % i for i in (
    0, 2, 5, 7, 9, 11, 12, 14, 18, 20, 22, 24, 25, 27, 29, 32, 34, 36, 38, 39, 41, 43, 45, 48, 50, 52, 53, 55, 57, 59)]

CLIP_NAME = NAME + '-loop'


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


def alpha_bbox(path, threshold=ALPHA_THRESHOLD):
    with Image.open(path) as im:
        mask = im.convert('RGBA').getchannel('A').point(lambda v: 255 if v > threshold else 0)
        return mask.getbbox()


def round6(value):
    return round(float(value), 6)


def ring_geometry(sources):
    """量地面椭圆环：返回 (中心 x, 中心 y, 水平外径最大值)，单位都是**源** px。

    最宽处就是椭圆中心所在的那一行 —— 所以「最宽行」的 y 中位是中心 y，
    左右缘中点中位是中心 x。

    外径取**各帧跨度的最大值**（不是中位）：画布宽会被钉成它，取最大值才保证
    最满的那一帧正好贴合判定边界，其余帧略小于边界 —— 这是对的口径
    （「看着多大就打多大」按最满的一帧算）。取中位会让最满那一帧溢出 2%。
    """
    spans = []  # (y, left, right)
    widest = 0
    for path in sources:
        with Image.open(path) as im:
            rgba = im.convert('RGBA')
            width, height = rgba.size
            px = rgba.load()
        #  只看下半张：地面环一定在火焰墙下面，这样不会被火焰主体的大跨度骗到。
        for y in range(int(height * 0.55), height):
            left = right = None
            for x in range(width):
                if px[x, y][3] > ALPHA_THRESHOLD:
                    if left is None:
                        left = x
                    right = x
            if left is None:
                continue
            spans.append((y, left, right))
            widest = max(widest, right - left)
    if not spans or widest <= 0:
        raise RuntimeError('量不到地面环：整段序列都没有可见像素')
    threshold = widest * RING_ROW_RATIO
    rows = [item for item in spans if (item[2] - item[1]) >= threshold]
    center_y = statistics.median([item[0] for item in rows])
    center_x = statistics.median([(item[1] + item[2]) / 2.0 for item in rows])
    print('[量] 环外径（各帧跨度最大值）%d 源 px；取样 %d 行（≥%.0f）' % (widest, len(rows), threshold))
    print('[量] 环中心 (%.1f, %.1f) 源 px' % (center_x, center_y))
    return center_x, center_y, widest


# ─────────────────────────── meta ───────────────────────────

def build_dir_meta(meta_uuid):
    return {
        'ver': '1.2.0', 'importer': 'directory', 'imported': True, 'uuid': meta_uuid,
        'files': [], 'subMetas': {}, 'userData': {},
    }


def build_sprite_frame_meta(meta_uuid, display_name, width, height):
    """`type = sprite-frame` + `f9941` 子资源 —— 缺这一步特效**不报错、永远不出现**。"""
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
                    'wrapModeS': 'clamp-to-edge', 'wrapModeT': 'clamp-to-edge',
                    'imageUuidOrDatabaseUri': meta_uuid, 'isUuid': True, 'visible': False,
                    'minfilter': 'linear', 'magfilter': 'linear', 'mipfilter': 'none',
                    'anisotropy': 0,
                },
                'ver': '1.0.22', 'imported': True, 'files': ['.json'], 'subMetas': {},
            },
            'f9941': {
                'importer': 'sprite-frame',
                'uuid': meta_uuid + '@f9941',
                'displayName': display_name,
                'id': 'f9941',
                'name': 'spriteFrame',
                'userData': {
                    'trimThreshold': 1, 'rotated': False,
                    'offsetX': 0, 'offsetY': 0, 'trimX': 0, 'trimY': 0,
                    'width': width, 'height': height,
                    'rawWidth': width, 'rawHeight': height,
                    'borderTop': 0, 'borderBottom': 0, 'borderLeft': 0, 'borderRight': 0,
                    'packable': True, 'pixelsToUnit': 100,
                    'pivotX': 0.5, 'pivotY': 0.5, 'meshType': 0,
                    'vertices': {
                        'rawPosition': [
                            -half_w, -half_h, 0, half_w, -half_h, 0,
                            -half_w, half_h, 0, half_w, half_h, 0,
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
                'ver': '1.0.12', 'imported': True, 'files': ['.json'], 'subMetas': {},
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
    """三处必须 `false`：`filterUnused` / `removeTextureInBundle` / `removeImageInBundle`。

    取 `true` 时图集打包会把散图从 bundle 里摘掉，而编辑器没重新 import 过这批手写
    meta，运行时贴图与图集两头都取不到（不报错，只是没有画面）。
    """
    return {
        'ver': '1.0.8', 'importer': 'auto-atlas', 'imported': True, 'uuid': meta_uuid,
        'files': ['.json'], 'subMetas': {},
        'userData': {
            'maxWidth': 1024, 'maxHeight': 1024, 'padding': 2, 'allowRotation': True,
            'forceSquared': False, 'powerOfTwo': True, 'algorithm': 'MaxRects',
            'format': 'png', 'quality': 80, 'contourBleed': True, 'paddingBleed': True,
            'filterUnused': False, 'removeTextureInBundle': False, 'removeImageInBundle': False,
            'compressSettings': {
                'useCompressTexture': False, 'compressType': 'default', 'mode': 'shortest',
            },
            'removeSpriteAtlasInBundle': True,
            'textureSetting': {
                'wrapModeS': 'repeat', 'wrapModeT': 'repeat',
                'minfilter': 'linear', 'magfilter': 'linear', 'mipfilter': 'none',
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
            '__type__': 'cc.AnimationClipAdditiveSettings', 'enabled': False, 'refClip': None,
        },
        '_auxiliaryCurveEntries': [],
    }


def build_prefab(name, width, height, scale, pos, first_frame, clip_uuid, seed):
    def file_id(purpose):
        return hashlib.md5(('%s:%s' % (seed, purpose)).encode('utf-8')).hexdigest()[:22]

    return [
        {
            '__type__': 'cc.Prefab', '_name': name, '_objFlags': 0, '__editorExtras__': {},
            '_native': '', 'data': {'__id__': 1}, 'optimizationPolicy': 0, 'persistent': False,
        },
        {
            '__type__': 'cc.Node', '_name': name, '_objFlags': 0, '__editorExtras__': {},
            '_parent': None, '_children': [], '_active': True,
            '_components': [{'__id__': 2}, {'__id__': 4}, {'__id__': 6}],
            '_prefab': {'__id__': 8},
            '_lpos': {'__type__': 'cc.Vec3', 'x': round6(pos[0]), 'y': round6(pos[1]), 'z': 0},
            '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
            '_lscale': {'__type__': 'cc.Vec3', 'x': round6(scale), 'y': round6(scale), 'z': 1},
            '_mobility': 0, '_layer': LAYER_UI_2D,
            '_euler': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
            '_id': '',
        },
        {
            '__type__': 'cc.UITransform', '_name': '', '_objFlags': 0, '__editorExtras__': {},
            'node': {'__id__': 1}, '_enabled': True, '__prefab': {'__id__': 3},
            '_contentSize': {'__type__': 'cc.Size', 'width': width, 'height': height},
            '_anchorPoint': {'__type__': 'cc.Vec2', 'x': 0.5, 'y': 0.5},
            '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id('ui')},
        {
            '__type__': 'cc.Sprite', '_name': '', '_objFlags': 0, '__editorExtras__': {},
            'node': {'__id__': 1}, '_enabled': True, '__prefab': {'__id__': 5},
            '_customMaterial': None,
            '_srcBlendFactor': 2, '_dstBlendFactor': 4,
            '_color': {'__type__': 'cc.Color', 'r': 255, 'g': 255, 'b': 255, 'a': 255},
            '_spriteFrame': {'__uuid__': first_frame, '__expectedType__': 'cc.SpriteFrame'},
            '_type': 0, '_fillType': 0, '_sizeMode': 0,
            '_fillCenter': {'__type__': 'cc.Vec2', 'x': 0, 'y': 0},
            '_fillStart': 0, '_fillRange': 0,
            '_isTrimmedMode': False, '_useGrayscale': False,
            '_atlas': None, '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id('sprite')},
        {
            '__type__': 'cc.Animation', '_name': '', '_objFlags': 0, '__editorExtras__': {},
            'node': {'__id__': 1}, '_enabled': True, '__prefab': {'__id__': 7},
            'playOnLoad': False,
            '_clips': [{'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'}],
            '_defaultClip': {'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'},
            '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id('anim')},
        {
            '__type__': 'cc.PrefabInfo', 'root': {'__id__': 1}, 'asset': {'__id__': 0},
            'fileId': file_id('root'), 'instance': None, 'targetOverrides': None,
        },
    ]


def build_prefab_meta(name, meta_uuid):
    return {
        'ver': '1.1.50', 'importer': 'prefab', 'imported': True, 'uuid': meta_uuid,
        'files': ['.json'], 'subMetas': {}, 'userData': {'syncNodeName': name},
    }


# ─────────────────────────── 主流程 ───────────────────────────

def source_path(set_dir, frame):
    direct = os.path.join(set_dir, frame)
    if os.path.isfile(direct):
        return direct
    cached = os.path.join(SRC_CACHE_ROOT, NAME, frame)
    if os.path.isfile(cached):
        return cached
    raise RuntimeError('缺帧：%s' % direct)


def main():
    set_dir = os.path.join(PROJECTILES_DIR, NAME)
    if not os.path.isdir(set_dir):
        raise RuntimeError('目录不存在：%s' % set_dir)
    atlas_dir = os.path.join(set_dir, 'atlas')
    anim_dir = os.path.join(set_dir, 'anim')
    cache_dir = os.path.join(SRC_CACHE_ROOT, NAME)
    for directory in (atlas_dir, anim_dir, cache_dir):
        os.makedirs(directory, exist_ok=True)

    sources = [source_path(set_dir, frame) for frame in FRAMES]

    # 1) 量地面环 —— 先量，因为裁切框的左右由它决定
    center_x, center_y, ring_src = ring_geometry(sources)

    # 2) 可见并集 → 纵向裁切框（上下紧贴内容）；横向由环中心对称铺开
    boxes = [alpha_bbox(path) for path in sources]
    top = min(box[1] for box in boxes)
    bottom = max(box[3] for box in boxes)

    src_w, src_h = png_size(sources[0])
    #  🔴 画布**宽 = 环外径**（左右各取一半），不是「紧贴内容」：
    #  这样 `_contentSize.width` 就是环外径 ⇒ `width × _lscale` 直接等于判定直径，
    #  用例里那一条「看着多大就打多大」的等式变成可读的算术，不用再去别处抄一个魔数。
    #  同时环中心 x 落在画布中心 ⇒ `_lpos.x = 0`（只剩竖直补偿）。
    half_w_src = ring_src / 2.0
    crop_left = max(0, int(round(center_x - half_w_src)))
    crop_right = min(src_w, crop_left + ring_src)
    crop_left = max(0, crop_right - ring_src)          # 贴到右边界时把左边补回来
    crop_top = max(0, top - CROP_MARGIN)
    crop_bottom = min(src_h, bottom + CROP_MARGIN)
    crop_w = crop_right - crop_left
    crop_h = crop_bottom - crop_top
    #  🔴 画布 = 判定直径（屏上 px 取整）：贴图本身就是屏上尺寸，`_lscale` 恒为 1。
    #  307.5 取整成 308，差 0.5 px（0.16%），用例按相对误差 <0.5% 校验。
    canvas_w = int(round(JUDGE_DIAMETER_SCREEN))
    canvas_h = int(round(crop_h * canvas_w / float(crop_w)))
    canvas_scale = canvas_w / float(crop_w)  # 源 px → 画布 px

    # 3) 尺寸已经烘进画布，prefab 不再乘任何倍率
    scale = 1.0

    # 4) 摆位：把环中心挪到节点原点（`_lpos` 补偿画布中心与环中心的差）
    ax = (center_x - crop_left) * canvas_scale
    ay = (center_y - crop_top) * canvas_scale
    #  Cocos +y 朝上 ⇒ 源图 y 要先翻符号
    off_x = (ax - canvas_w / 2.0) * scale
    off_y = (canvas_h / 2.0 - ay) * scale
    pos = (-off_x, -off_y)

    # 5) 缩图进 atlas/ + 整帧不裁剪的 sprite-frame meta
    frame_uuids = []
    for frame, src in zip(FRAMES, sources):
        dst = os.path.join(atlas_dir, frame)
        with Image.open(src) as im:
            im = im.convert('RGBA').crop((crop_left, crop_top, crop_left + crop_w, crop_top + crop_h))
            im = im.resize((canvas_w, canvas_h), Image.LANCZOS)
            im.save(dst, 'PNG', optimize=True)
        meta_uuid = existing_uuid(dst + '.meta')
        write_json(dst + '.meta',
                   build_sprite_frame_meta(meta_uuid, os.path.splitext(frame)[0], canvas_w, canvas_h))
        frame_uuids.append(meta_uuid + '@f9941')

    # 5) 源散图搬出 bundle（30 张全部进帧序，不留死资源）
    moved = 0
    for entry in sorted(os.listdir(set_dir)):
        base = entry[:-5] if entry.endswith('.meta') else entry
        if not base.lower().endswith('.png'):
            continue
        shutil.move(os.path.join(set_dir, entry), os.path.join(cache_dir, entry))
        moved += 1
    if moved:
        print('[缓存] %s：%d 个源文件 -> tmp/projectile_src/%s/' % (NAME, moved, NAME))

    # 6) 子目录 meta
    for directory in (atlas_dir, anim_dir):
        if not os.path.isfile(directory + '.meta'):
            write_json(directory + '.meta', build_dir_meta(new_uuid()))

    # 7) 自动图集
    pac_path = os.path.join(atlas_dir, NAME + '.pac')
    write_json(pac_path, {'__type__': 'cc.SpriteAtlas'})
    write_json(pac_path + '.meta', build_pac_meta(existing_uuid(pac_path + '.meta')))

    # 8) 动画
    anim_path = os.path.join(anim_dir, CLIP_NAME + '.anim')
    anim_uuid = existing_uuid(anim_path + '.meta')
    clip = build_anim(CLIP_NAME, frame_uuids, SAMPLE, WRAP_LOOP)
    write_json(anim_path, clip)
    write_json(anim_path + '.meta', {
        'ver': '2.0.4', 'importer': 'animation-clip', 'imported': True, 'uuid': anim_uuid,
        'files': ['.bin'], 'subMetas': {}, 'userData': {'name': CLIP_NAME},
    })

    # 9) Prefab
    prefab_path = os.path.join(set_dir, NAME + '.prefab')
    prefab_uuid = existing_uuid(prefab_path + '.meta')
    write_json(prefab_path, build_prefab(NAME, canvas_w, canvas_h, scale, pos,
                                         frame_uuids[0], anim_uuid, prefab_uuid))
    write_json(prefab_path + '.meta', build_prefab_meta(NAME, prefab_uuid))

    print('\n[%s] %d 帧  sample=%d wrap=%d  %.4fs' % (
        NAME, len(FRAMES), SAMPLE, WRAP_LOOP, clip['_duration']))
    print('  源 %dx%d → 裁 %dx%d @(%d,%d) → 画布 %dx%d' % (
        src_w, src_h, crop_w, crop_h, crop_left, crop_top, canvas_w, canvas_h))
    print('  环外径 %d 源 px → 画布宽 %d px ⇒ 缩放 %.6f（目标 307.5 屏上 px，贴图即屏上尺寸）' % (
        ring_src, canvas_w, scale))
    print('  根节点 _lpos = (%.6f, %.6f)' % pos)
    print('  环中心画布坐标 (%.2f, %.2f)（画布中心 %.1f, %.1f）' % (
        ax, ay, canvas_w / 2.0, canvas_h / 2.0))
    print('  路径 = units/projectiles/%s/%s' % (NAME, NAME))


if __name__ == '__main__':
    main()
