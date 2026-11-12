# -*- coding: utf-8 -*-
"""麻辣铁锅（68026）两套主动技能特效：散图 -> 自动图集(.pac) + 序列帧动画 + 战斗 Prefab（2026-11-11）。

美术同样只丢了散图，两个目录里**没有 prefab / anim / pac**：

| 目录 | 散图 | 用途 |
| :-- | :-- | :-- |
| `units/projectiles/麻辣铁锅_喷射火焰/` | 18 张 845×615（`146-1-attack_064 … _081`） | 102603「喷射火焰」`self_aura` |
| `units/projectiles/麻辣铁锅_爆炸龙卷/` | 32 张 1144×1136（`action-action_00 … _31`） | 102604「凤凰降临」命中爆炸 |

另外顺手派生一个**只有 prefab、不含新图**的 `麻辣铁锅_凤凰弹`：它是
`火法师_火船.prefab` 的「放大 150%」副本（根 `_lscale` 1.733333 × 1.5 = 2.6），
直接复用火船的 anim clip 与散图 uuid，所以图集不会多一份。

> 为什么不直接把 `units/projectiles/火法师_火船/火法师_火船` 登记进
> `ZCCombatEffectScale.NODE_SCALE_BY_PREFAB_PATH` 挂 1.5：那条路径同时被
> `pvpSkill 36181「火法师武将技」` 使用，挂上去会把火法师现役的武将技一起放大。
> 派生副本是唯一能只影响 102604 的做法。

## 结构与尺寸口径

三件套结构、`sprite-frame` meta（`f9941` 子资源）、`pac.meta` 三处 `false` 的坑，
全部与 `tools/build_magdi_strike_fx.py` 逐字同构，理由见那个文件的文件头与
`docs/zcds-表现层与领地规范.md` §14.5。这里只记**本脚本特有的两条**：

### 1) 喷射火焰：循环段是「把帧序排进同一条 clip」，不是第二条 clip

设计案 102603 表现列原文：「使用【麻辣铁锅喷射火焰】特效，当需要延长时间时使用循环帧 11-17」。
技能持续 3 秒，而 18 帧原速只有 18/12 = 1.5s，必须延长。做法是**把帧序列拼长**：

    帧序 = [第 1~18 帧] + [第 11~17 帧] × 3 = 18 + 21 = 39 帧

`sample = 12` ⇒ 39/12 = **3.25s**，比光环的 3s 略长 —— 故意留长：
`ZCGroundZoneSystem` 的 `holdVisual` 事件在区域到期时被整体摘掉，动画还在循环中段
就断了，不会出现「火焰停在最后一帧上僵住 0.33 秒」那种穿帮。

不用「18 帧 clip + 循环 clip」两条：`ZCCombatEffectView.mountVisual` 只
`play(defaultClip)`，没有串播能力；拼帧是唯一零改动的做法。

### 2) 喷射火焰的摆位：整条火焰贴在角色身上、铺满判定范围

判定圆心在**身前 `auraForward`** 处、半径 50。

🔴 **2026-11-12 第五轮修正（用户：「释放的目标在右侧时，技能特效的起始位置离角色很远，
相距了 60px」）—— 锚点必须取「稳态尾部」，不能取「全序列并集的最左缘」。**

逐帧量可见左缘（`alpha > 60`，源 px）会看到：**只有第 1~2 帧**（`064/065`）的左缘在 68~69，
从第 3 帧起就跳到 **230~247**，整段 cp 的中位左缘是 **238**。

    帧号 1  064  左 69      ← 起势火苗，只在最开头
    帧号 2  065  左 68      ← 同上
    帧号 3  066  左 247     ← 火焰主体已经射出去了
    ……
    帧号 11+ (074 起的循环段) 左 230~241

按「并集最左缘 68」钉尾部 ⇒ 尾部锚在那团只出现 2 帧（占 5% 时长）的火苗上，
而 95% 的时间里火焰实体从 238 才开始 —— 屏上 (238−68)/2 = **85px** 的空档，
正是用户截图里那段「离角色很远」。

现在改成 `tail_policy='steady'`：尾部 = **各帧可见左缘的中位数**（26/39 帧都有内容），
裁切框左边也随之从 68 收到 226（省下 170 源 px 的透明区，图集更小）。

    稳态尾部 238 源 px、最右缘 659 ⇒ 可见长度 421 源 px = 210.5 画布 px
    （第五轮：触发距离 = 210.5 ÷ 0.76875 = 273.8 ⇒ 274 逻辑 px、auraForward 224）

🔴 **2026-11-12 第七轮再翻一次（用户：「喷火的释放触发距离应该小于普通攻击的距离，
和特效的 350px 范围相匹配，只有敌人处于 350px 这个距离才会被攻击」）**：
第五轮「长度定距离」得到 274，而普攻射程是 `unitAttackRange 550`（折后 495）——
闸门在 550 就放，火焰却只够 274，敌人站 300 时技能空放。现在反过来**由距离定长度**：

    触发距离 = 350 表值逻辑 px = 屏上 269.06px（< 普攻 495 表值）
    ⇒ 缩放 = 269.06 ÷ 210.5 = 1.278207（可见长度正好 350）
    ⇒ auraForward = 350 − auraRadius 50 = 300（判定圆 250~350）
    ⇒ 尾部仍钉本地 (0, 0)，竖直抬到头部仍由 `auraVisualLiftPx = 97` 在视图层补

同时配表新增 `auraTriggerRange: 350`：最近目标还在 350 之外时**待触发、不消费 CD**
（`ZCSkillTriggerSystem.applySelfAura` + `ZCUnitTargeting.nearestEnemyDistance`）。

⚠️ 方向：火焰是**朝右下约 26°** 的柱体，只对「面朝右」的单位成立。表现事件带
`angleDegrees`（`auraFaceTarget: 1` 让模型给方向），宿主节点会按它整体旋转，
所以各方向都跟着转，不必再靠美术摆正。

### 3) 爆炸龙卷：32 帧一次性，第 26 帧是二段伤害的落点

设计案 102604：「爆炸开始后第 26 帧造成 1 次伤害」。第 26 帧 = index 25 占
`25/30 ~ 26/30` = 0.8333~0.8667s ⇒ 配表 `impactSecondDelay = 0.8333`。
`sample = 30`（不是项目常见的 12），这样「第 26 帧」与配表秒数才是同一条时间轴，
理由与 `磁电菇_劈雷技能` 取 30 完全一致。

32 帧 ÷ 30 = **1.0667s** 的整段：0 白闪、1~5 火柱升起、6~21 稳定燃烧、
22~27 退成地面余烬（**第 26 帧正好落在余烬段**，与「第二段范围伤害」的打击感一致）、
28~31 近乎消失。所以这一段看起来就是「炸一下 → 地上烧一会儿 → 再补一刀」。

## 重入

已存在的 `.meta` 一律复用 uuid；`fileId` 由 prefab uuid 派生 ⇒ 重跑不抖动。
源散图搬进 `tmp/projectile_src/<set>/`，重跑时从缓存目录找回。
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

#  屏上 px / 逻辑 px（docs §1.11）：0.3(combatDistanceScale) × 2.5625(view/logical)
SCREEN_PX_PER_LOGIC = 0.3 * 2.5625

DOWNSCALE = 2
CROP_MARGIN = 12

LAYER_UI_2D = 33554432  # 1 << 25
WRAP_ONCE = 1

#  102603 喷射火焰（2026-11-12 第六轮；用户口径「触发距离应该小于普通攻击的距离，
#  和特效的 350px 范围相匹配，只有敌人处于 350px 这个距离才会被攻击」）：
#    · **先定触发距离**（350 表值逻辑 px = 屏上 269.06px），再反算缩放让可见长度正好等于它
#      —— 与第五轮「长度反过来定距离」互为反向，原因见下面 `reach_logic_px` 的注释；
#    · `auraForward = 350 - auraRadius 50 = 300`（判定圆最远缘正好压在火焰尖端）；
#    · 火焰**尾部**钉在施法者逻辑脚点（本地 y = 0），竖直方向由 `auraVisualLiftPx` 在
#      视图层补 —— 写进 `_lpos.y` 会被宿主节点的 `setRotationFromEuler` 转成「垂直于弹道的侧移」。
NATURAL_SCALE = 1.0
#  判定改成矩形后，判定中心前移 `auraForward = 175`、半长 `auraRadius = 175`（覆盖 0~350）——
#  这个常量是**圆形时代的半径**，改成 175 才能让 `auraForward = reach − 它 = 175` 与配表一致。
AURA_RADIUS_LOGIC = 175
#  触发距离（表值逻辑 px）。用户 2026-11-12 第七轮：普攻是 550，技能只该在 350 以内放，
#  并且这个 350 就是火焰**看得见**的长度。给了这个值就不再走 `scale_policy`，缩放由它反算。
SPRAY_REACH_LOGIC = 350
#  角色头部屏上高度 = 一个兵可见高 67（`ZCCombatEffectPlacement` 的既有口径）
#  + 30（`casterLiftPx` 施法抬升，抬升挂在地面区域上 ⇒ 与火焰同寿，全程都在）。
HEAD_SCREEN_PX = 97.0
#  「稳态尾部」的取样窗：以中位左缘为起点，向右取这么多**源** px 算 alpha 重心当尾部高度。
TAIL_WINDOW_SRC = 30

SETS = [
    dict(
        name='麻辣铁锅_喷射火焰',
        #  18 帧原序 + 「循环帧 11~17」× 3（文件头 §1）。
        frames=['146-1-attack_%03d.png' % i for i in range(64, 82)]
               + ['146-1-attack_%03d.png' % i for _ in range(3) for i in range(74, 81)],
        #  🔴 2026-11-12 第七轮：触发距离由用户定死（350 表值 px，小于普攻 550），
        #  缩放**反算**成「可见长度 = 350」。第五轮曾经反过来（自然尺寸 → 长度定距离），
        #  但那会让「350px 才会有敌人被打」这条设计口径落不了地：实测长度只有 274 逻辑 px，
        #  敌人站在 280~350 之间时技能会放、火焰却够不到。
        #  锚点仍取稳态尾部，所以拉伸放大的是「可见火焰」本身，不会把量法误差放大成 85px 空档。
        reach_logic_px=SPRAY_REACH_LOGIC,
        #  保留这个声明只是为了让「取哪一段当长度」照旧走 `content_width`（稳态尾部 → 最右缘）。
        scale_policy='natural',
        #  `content_width` = 「尾部 → 最右缘」；配合 `tail_policy='steady'` 时尾部取中位左缘。
        measure='content_width',
        #  🔴 2026-11-12：尾部不能取「全序列并集的最左缘」—— 那团火苗只在第 1~2 帧存在
        #  （占 5% 时长），把锚点钉在它上面会让 95% 的时间里火焰实体离角色 85 屏上 px。
        tail_policy='steady',
        sample=12,
        wrap=WRAP_ONCE,
        clip_name='麻辣铁锅_喷射火焰',
        #  `tail_policy='steady'` 时锚点由构建器自己算（中位左缘 + 该窗的 alpha 重心），
        #  这里留 None 表示「别用写死的值」。`pin_tail_y_zero` 把这个点的**本地 y 钉到 0**
        #  （= 施法者逻辑脚点），竖直抬到头部由 `auraVisualLiftPx = 97` 在视图层做。
        anchor_point_src=None,
        pin_tail_y_zero=True,
        keep_all=True,
    ),
    dict(
        name='麻辣铁锅_爆炸龙卷',
        frames=['action-action_%02d.png' % i for i in range(0, 32)],
        #  判定半径 100 逻辑 px（102604 的 `impactBurstRadius`）⇒ 直径 153.75 屏上 px。
        target_screen_px=100 * 2 * SCREEN_PX_PER_LOGIC,
        measure='content_width',
        sample=30,
        wrap=WRAP_ONCE,
        clip_name='麻辣铁锅_爆炸龙卷',
        anchor_point_src=None,
        anchor_screen=(0.0, 0.0),
        keep_all=True,
    ),
]

#  「放大 150%」的派生 prefab：只有 prefab 一个文件，复用火船的 clip / 散图 uuid。
#  2026-11-11 第四轮用户口径「4 个子弹的体型缩小成 25%」⇒ 1.5 × 0.25 = 0.375（＝火船 × 0.375 = 0.65）。
DERIVED = [
    dict(
        name='麻辣铁锅_凤凰弹',
        source='火法师_火船',
        scale_multiplier=1.5 * 0.25,
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



def tail_centroid_y(sources, boxes, tail_x, threshold=60):
    """尾部窗（`tail_x … tail_x + TAIL_WINDOW_SRC`）里 alpha 的加权重心 y（**源** px）。

    用它当「火焰从角色头部喷出的那个点」的竖直位置 —— 只看尾部那一小段，
    不受远处火焰主体的高度影响（主体在画面上是斜着往上飞的）。
    """
    num = den = 0.0
    for path, box in zip(sources, boxes):
        if box[0] > tail_x + TAIL_WINDOW_SRC:
            #  这一帧的火焰主体已经飞到右边了，尾部这里没有东西可量
            continue
        with Image.open(path) as im:
            rgba = im.convert('RGBA')
            width, height = rgba.size
            px = rgba.load()
        for x in range(tail_x, min(tail_x + TAIL_WINDOW_SRC, width)):
            for y in range(height):
                alpha = px[x, y][3]
                if alpha > threshold:
                    num += y * alpha
                    den += alpha
    return int(round(num / den)) if den > 0 else (boxes[0][1] + boxes[0][3]) // 2


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
    for directory in (atlas_dir, anim_dir, cache_dir):
        os.makedirs(directory, exist_ok=True)

    frames = cfg['frames']
    sources = [source_path(set_dir, f) for f in frames]

    # 1) 可见并集 → 裁切框
    boxes = [alpha_bbox(p) for p in sources]
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)

    #  尾部（锚点）落在哪一列：
    #    默认 = 全序列并集的最左缘（`anchor_point_src` 写死）；
    #    `tail_policy='steady'` = **各帧可见左缘的中位数**（文件头 §2 的 2026-11-12 修正）。
    #  差别很大：这一套的并集最左缘 68 只由第 1~2 帧的起势火苗贡献，中位数是 238 ——
    #  按 68 钉尾部，95% 的时间里火焰实体从 238 才开始，屏上就空出 85px。
    anchor_src = cfg['anchor_point_src']
    steady = cfg.get('tail_policy') == 'steady'
    if steady:
        tail_x = int(round(statistics.median([b[0] for b in boxes])))
        anchor_src = (tail_x, tail_centroid_y(sources, boxes, tail_x))
        print('[%s] 稳态尾部：各帧左缘中位 %d 源 px（并集 %d，占比 %d/%d 帧），尾部 y 重心 %d'
              % (name, tail_x, left, sum(1 for b in boxes if b[0] <= tail_x), len(boxes), anchor_src[1]))

    src_w, src_h = png_size(sources[0])
    crop_left = max(0, (anchor_src[0] if steady else left) - CROP_MARGIN)
    crop_top = max(0, top - CROP_MARGIN)
    crop_right = min(src_w, right + CROP_MARGIN)
    crop_bottom = min(src_h, bottom + CROP_MARGIN)
    #  DOWNSCALE 取偶数，画布才是整数、逐帧不抖
    crop_w = (crop_right - crop_left) // DOWNSCALE * DOWNSCALE
    crop_h = (crop_bottom - crop_top) // DOWNSCALE * DOWNSCALE
    canvas_w = crop_w // DOWNSCALE
    canvas_h = crop_h // DOWNSCALE
    canvas_scale = canvas_w / float(crop_w)  # 源 px → 画布 px

    # 2) 反算缩放：分母 = 要对齐判定的那一段的可见尺寸
    if cfg['measure'] == 'reach':
        #  「火焰根部 → 尖端」的射程：根部是锚点，尖端取全序列最右缘。
        measured_src = right - anchor_src[0]
        measured_label = '火焰射程（根部→最右缘）'
    elif steady:
        #  「稳态尾部 → 最右缘」= 真正看得见的那条火焰有多长。
        measured_src = right - anchor_src[0]
        measured_label = '稳态可见长度（中位尾部→最右缘）'
    else:
        measured_src = right - left
        measured_label = '可见并集宽'
    measured_canvas = measured_src * canvas_scale
    target_reach_logic = cfg.get('reach_logic_px')
    if target_reach_logic:
        #  「距离定长度」：先把触发距离定死（表值逻辑 px），再反算缩放，
        #  让 `measured_canvas × scale` 正好等于 `reach × 0.76875`。
        scale = target_reach_logic * SCREEN_PX_PER_LOGIC / measured_canvas
    elif cfg.get('scale_policy') == 'natural':
        #  取自然尺寸：不反算缩放，触发距离由 `measured_canvas` 推出来（文件头 §2）。
        scale = NATURAL_SCALE
    else:
        scale = cfg['target_screen_px'] / measured_canvas

    # 3) 摆位
    if anchor_src:
        #  把「火焰根部」这个源图点钉到目标的**本地**坐标（相对节点原点，会跟着宿主一起转）。
        ax = (anchor_src[0] - crop_left) * canvas_scale
        ay = (anchor_src[1] - crop_top) * canvas_scale
        #  换算成「相对画布中心」的偏移，Cocos +y 朝上 ⇒ 源图 y 要先翻符号。
        off_x = (ax - canvas_w / 2.0) * scale
        off_y = (canvas_h / 2.0 - ay) * scale
        if cfg.get('pin_tail_y_zero'):
            #  尾部钉在施法者「逻辑脚点」：本地 x = −auraForward（宿点在判定圆心），本地 y = 0。
            #  y 必须是 0 —— 宿主节点会被 `setRotationFromEuler` 转到朝向，本地 y 等于
            #  「垂直于火焰的侧移」，只有 0 才在任何朝向下都贴着施法者。
            reach_screen = measured_canvas * scale
            if target_reach_logic:
                reach_logic = int(round(target_reach_logic))
                print('[102603] 触发距离定为 %d 逻辑px（= 屏上 %.1fpx）⇒ 反算缩放 %.6f'
                      % (reach_logic, reach_screen, scale))
            else:
                reach_logic = int(round(reach_screen / SCREEN_PX_PER_LOGIC))
            aura_forward = reach_logic - AURA_RADIUS_LOGIC
            pos = (-aura_forward * SCREEN_PX_PER_LOGIC - off_x, -off_y)
            print('[102603] 特效全长 %.1f 屏上px ⇒ 触发距离 %d 逻辑px；'
                  'auraForward=%d、auraRadius=%d、auraVisualLiftPx=%.0f'
                  % (reach_screen, reach_logic, aura_forward, AURA_RADIUS_LOGIC, HEAD_SCREEN_PX))
        else:
            pos = (cfg['anchor_screen'][0] - off_x, cfg['anchor_screen'][1] - off_y)
    else:
        pos = (cfg['anchor_screen'][0], cfg['anchor_screen'][1])

    # 4) 缩图进 atlas/ + 整帧不裁剪的 sprite-frame meta
    frame_uuids = []
    for frame, src in zip(frames, sources):
        dst = os.path.join(atlas_dir, frame)
        with Image.open(src) as im:
            im = im.convert('RGBA').crop((crop_left, crop_top, crop_left + crop_w, crop_top + crop_h))
            im = im.resize((canvas_w, canvas_h), Image.LANCZOS)
            im.save(dst, 'PNG', optimize=True)
        meta_uuid = existing_uuid(dst + '.meta')
        write_json(dst + '.meta',
                   build_sprite_frame_meta(meta_uuid, os.path.splitext(frame)[0], canvas_w, canvas_h))
        frame_uuids.append(meta_uuid + '@f9941')

    # 5) 源散图搬出 bundle
    wanted = set(frames)
    moved = 0
    for entry in sorted(os.listdir(set_dir)):
        base = entry[:-5] if entry.endswith('.meta') else entry
        if not base.lower().endswith('.png'):
            continue
        if base in wanted:
            #  用过的帧只搬「不带 .meta」的那一份会留下孤儿 meta，这里两份一起搬
            shutil.move(os.path.join(set_dir, entry), os.path.join(cache_dir, entry))
            moved += 1
            continue
        if not cfg['keep_all']:
            shutil.move(os.path.join(set_dir, entry), os.path.join(cache_dir, entry))
            moved += 1
    if moved:
        print('[缓存] %s：%d 个源文件 -> tmp/projectile_src/%s/' % (name, moved, name))

    # 6) 子目录 meta
    for directory in (atlas_dir, anim_dir):
        if not os.path.isfile(directory + '.meta'):
            write_json(directory + '.meta', build_dir_meta(new_uuid()))

    # 7) 自动图集
    pac_path = os.path.join(atlas_dir, name + '.pac')
    write_json(pac_path, {'__type__': 'cc.SpriteAtlas'})
    write_json(pac_path + '.meta', build_pac_meta(existing_uuid(pac_path + '.meta')))

    # 8) 动画
    clip_name = cfg['clip_name']
    anim_path = os.path.join(anim_dir, clip_name + '.anim')
    anim_uuid = existing_uuid(anim_path + '.meta')
    clip = build_anim(clip_name, frame_uuids, cfg['sample'], cfg['wrap'])
    write_json(anim_path, clip)
    write_json(anim_path + '.meta', {
        'ver': '2.0.4', 'importer': 'animation-clip', 'imported': True, 'uuid': anim_uuid,
        'files': ['.bin'], 'subMetas': {}, 'userData': {'name': clip_name},
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
    target_note = ('触发距离 %.0f 逻辑 px（反算缩放）' % cfg['reach_logic_px']
                   if cfg.get('reach_logic_px')
                   else ('自然尺寸' if cfg.get('scale_policy') == 'natural'
                         else '屏上目标 %.1f px' % cfg['target_screen_px']))
    print('        %s %d 源 px = %.1f 画布 px ⇒ 缩放 %.6f（%s）' % (
        measured_label, measured_src, measured_canvas, scale, target_note))
    print('        根节点 _lpos = (%.6f, %.6f)' % pos)
    print('        路径 = units/projectiles/%s/%s' % (name, name))
    return dict(name=name, scale=scale, pos=pos, canvas=(canvas_w, canvas_h), frames=len(frames))


def build_derived(cfg):
    """派生 prefab：只写 prefab + meta，复用源 prefab 的 clip / 首帧 uuid。"""
    name = cfg['name']
    src_dir = os.path.join(PROJECTILES_DIR, cfg['source'])
    src_prefab = os.path.join(src_dir, cfg['source'] + '.prefab')
    data = read_json(src_prefab)
    root = next(o for o in data if o.get('__type__') == 'cc.Node')
    clip_uuid = next(o for o in data if o.get('__type__') == 'cc.Animation')['_clips'][0]['__uuid__']
    first_frame = next(o for o in data if o.get('__type__') == 'cc.Sprite')['_spriteFrame']['__uuid__']
    size = next(o for o in data if o.get('__type__') == 'cc.UITransform')['_contentSize']
    base_scale = root['_lscale']['x']
    base_pos = (root['_lpos']['x'], root['_lpos']['y'])

    set_dir = os.path.join(PROJECTILES_DIR, name)
    os.makedirs(set_dir, exist_ok=True)
    prefab_path = os.path.join(set_dir, name + '.prefab')
    prefab_uuid = existing_uuid(prefab_path + '.meta')
    scale = base_scale * cfg['scale_multiplier']
    write_json(prefab_path, build_prefab(name, size['width'], size['height'], scale,
                                         base_pos, first_frame, clip_uuid, prefab_uuid))
    write_json(prefab_path + '.meta', build_prefab_meta(name, prefab_uuid))
    print('[%s] 派生自 %s：_lscale %.6f → %.6f（×%s），复用 clip %s' % (
        name, cfg['source'], base_scale, scale, cfg['scale_multiplier'], clip_uuid[:8]))
    print('        路径 = units/projectiles/%s/%s' % (name, name))
    return dict(name=name, scale=scale)


def main():
    results = [build_set(cfg) for cfg in SETS]
    results += [build_derived(cfg) for cfg in DERIVED]
    print('\n完成 %d 套。' % len(results))


if __name__ == '__main__':
    main()
