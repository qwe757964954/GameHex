# -*- coding: utf-8 -*-
"""
生成「鹿神守护」复合预制（2026-11-07）。

需求原话：
  「小鹿模型本体使用【魔术师召唤鹿】的预制，在小鹿冲刺的整个阶段都需要循环播放
    【火法师火船】特效，且该特效节点在小鹿的上层，小鹿冲刺结束后所有特效同步消失。」

为什么要**新做一个复合预制**，而不是把两条特效拆成两条战斗事件：
  · 「火特效在小鹿上层」是**节点层序**语义。拆成两个平铺的事件节点，层序得靠创建顺序
    （`zcCombatEffectSiblingIndex` 只按事件类型分 ground/top，同类型无先后保证），
    一旦池化复用顺序变了遮挡就翻。装进同一个 prefab、按 `_children` 顺序摆放是静态确定的。
  · 「同时消失」也是一个节点树天然成立的事：根节点一销毁，小鹿和火特效一起走。

结构：
  鹿神守护（root，UITransform 657x685 / 锚点中心）
    ├─ spine            小鹿本体，原封不动抄自 resources/skel/魔术师召唤鹿
    └─ fx_火船           火法师_火船 的 Sprite + Animation（loop clip）
  ⚠️ fx_火船 必须排在 _children 的**后面** ⇒ 渲染在小鹿之上（Cocos UI 同层兄弟按序绘制）。

跨包引用先例：battle 包的 `ui/game/ZCGameHex.prefab` 同样引用 `resources/skel/neutral_hex`
的 `sp.SkeletonData`，所以本 prefab 引用 `resources/skel/魔术师召唤鹿/lu.skel` 是同一种做法。
"""
import json
import os
import uuid

ROOT = 'assets/bundles/battle/units/projectiles'
OUT_DIR = os.path.join(ROOT, '鹿神守护')
NAME = '鹿神守护'

# ---- 小鹿本体：逐字抄自 assets/resources/skel/魔术师召唤鹿/魔术师召唤鹿.prefab ----
DEER_SKELETON_UUID = 'a9e65251-72eb-4de1-8317-8e934fdf07e8'   # lu.skel
DEER_UI_WIDTH = 657
DEER_UI_HEIGHT = 685.0001831054688
DEER_ANCHOR_X = 0.3595133277742104
DEER_ANCHOR_Y = 0.00898141620882144
DEER_ANIMATION = 'idle'

# ---- 火特效：火法师_火船 的 Sprite + Animation ----
FIRE_CLIP_UUID = 'f73e3359-a8ff-40e2-92c6-62893d672d6b'        # 火法师_火船-loop（17 帧 / 1.4167s / wrapMode 2 = Loop）
FIRE_FRAME_UUID = '622b6694-f270-4f00-bec3-7301fd277720@f9941'  # 首帧
FIRE_UI_WIDTH = 402
FIRE_UI_HEIGHT = 364
FIRE_SCALE = 1.2          # 原 prefab 烘焙的是 1.733；缩到 1.2 免得整块火盖住小鹿
#  摆位推导（不是拍的）：
#  小鹿 UITransform 宽 657、锚点 x = 0.3595 ⇒ 它的视觉横向中心在节点原点的
#  (0.5 - 0.3595) * 657 ≈ +92.2；纵向锚点 0.009 ⇒ 视觉底边在原点上 -6.2、顶边 +678.8，
#  身体中心约 +336。火特效贴在小鹿腰腹以下（约 0.45 倍身高的位置）读作「小鹿踏火而行」，
#  所以 y 取 150。要调「火多大 / 多低」只改这两个数，别动结构。
FIRE_OFFSET_X = 92.2
FIRE_OFFSET_Y = 150


def file_id():
    return uuid.uuid4().hex[:22]


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print('[ok]', path)


def node(node_id, name, children, components, prefab_info, parent, pos, scale):
    return {
        '__type__': 'cc.Node',
        '_name': name,
        '_objFlags': 0,
        '__editorExtras__': {},
        '_parent': {'__id__': parent} if parent is not None else None,
        '_children': [{'__id__': i} for i in children],
        '_active': True,
        '_components': [{'__id__': i} for i in components],
        '_prefab': {'__id__': prefab_info},
        '_lpos': {'__type__': 'cc.Vec3', 'x': pos[0], 'y': pos[1], 'z': 0},
        '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
        '_lscale': {'__type__': 'cc.Vec3', 'x': scale[0], 'y': scale[1], 'z': 1},
        '_mobility': 0,
        '_layer': 33554432,
        '_euler': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
        '_id': '',
    }


def ui_transform(node_id, width, height, anchor_x, anchor_y, prefab_info):
    return {
        '__type__': 'cc.UITransform',
        '_name': '',
        '_objFlags': 0,
        '__editorExtras__': {},
        'node': {'__id__': node_id},
        '_enabled': True,
        '__prefab': {'__id__': prefab_info},
        '_contentSize': {'__type__': 'cc.Size', 'width': width, 'height': height},
        '_anchorPoint': {'__type__': 'cc.Vec2', 'x': anchor_x, 'y': anchor_y},
        '_id': '',
    }


def comp_info():
    return {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id()}


def prefab_info(node_id):
    return {
        '__type__': 'cc.PrefabInfo',
        'root': {'__id__': 1},
        'asset': {'__id__': 0},
        'fileId': file_id(),
        'instance': None,
        'targetOverrides': None,
    }


def build():
    doc = [
        {
            '__type__': 'cc.Prefab',
            '_name': NAME,
            '_objFlags': 0,
            '__editorExtras__': {},
            '_native': '',
            'data': {'__id__': 1},
            'optimizationPolicy': 0,
            'persistent': False,
        },
        # 1 root —— children 顺序 = 渲染顺序：spine(2) 在下、fx_火船(8) 在上。
        node(1, NAME, [2, 8], [16], 18, None, (0, 0), (1, 1)),
        # 2 小鹿本体
        node(2, 'spine', [], [3, 5], 7, 1, (0, 0), (1, 1)),
        ui_transform(2, DEER_UI_WIDTH, DEER_UI_HEIGHT, DEER_ANCHOR_X, DEER_ANCHOR_Y, 4),   # 3
        comp_info(),                                                                        # 4
        # 5 sp.Skeleton：与 魔术师召唤鹿.prefab 逐键一致（idle + loop ⇒ 加载即自动起播）
        {
            '__type__': 'sp.Skeleton',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 2},
            '_enabled': True,
            '__prefab': {'__id__': 6},
            '_customMaterial': None,
            '_srcBlendFactor': 2,
            '_dstBlendFactor': 4,
            '_color': {'__type__': 'cc.Color', 'r': 255, 'g': 255, 'b': 255, 'a': 255},
            '_skeletonData': {'__uuid__': DEER_SKELETON_UUID, '__expectedType__': 'sp.SkeletonData'},
            'defaultSkin': 'default',
            'defaultAnimation': DEER_ANIMATION,
            '_premultipliedAlpha': True,
            '_timeScale': 1,
            '_preCacheMode': 0,
            '_cacheMode': 0,
            '_sockets': [],
            '_useTint': False,
            '_debugMesh': False,
            '_debugBones': False,
            '_debugSlots': False,
            '_enableBatch': True,
            'loop': True,
            '_id': '',
        },
        comp_info(),                                    # 6
        prefab_info(2),                                 # 7
        # 8 火特效（兄弟序在小鹿之后 ⇒ 画在小鹿上层）
        node(8, 'fx_火船', [], [9, 11, 13], 15, 1, (FIRE_OFFSET_X, FIRE_OFFSET_Y), (FIRE_SCALE, FIRE_SCALE)),
        ui_transform(8, FIRE_UI_WIDTH, FIRE_UI_HEIGHT, 0.5, 0.5, 10),   # 9
        comp_info(),                                                    # 10
        {
            '__type__': 'cc.Sprite',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 8},
            '_enabled': True,
            '__prefab': {'__id__': 12},
            '_customMaterial': None,
            # 2/4 = 普通 alpha 混合，与 火法师_火船 本体一致。
            '_srcBlendFactor': 2,
            '_dstBlendFactor': 4,
            '_color': {'__type__': 'cc.Color', 'r': 255, 'g': 255, 'b': 255, 'a': 255},
            '_spriteFrame': {'__uuid__': FIRE_FRAME_UUID, '__expectedType__': 'cc.SpriteFrame'},
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
        comp_info(),                                                    # 12
        # 13 Animation：clip 自带 wrapMode 2（Loop），`ZCCombatEffectView.mountVisual`
        #    挂上后会 `stop() + play(clipName)` ⇒ 整个冲刺阶段一直循环。
        {
            '__type__': 'cc.Animation',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 8},
            '_enabled': True,
            '__prefab': {'__id__': 14},
            'playOnLoad': True,
            '_clips': [{'__uuid__': FIRE_CLIP_UUID, '__expectedType__': 'cc.AnimationClip'}],
            '_defaultClip': {'__uuid__': FIRE_CLIP_UUID, '__expectedType__': 'cc.AnimationClip'},
            '_id': '',
        },
        comp_info(),                                    # 14
        prefab_info(8),                                 # 15
        ui_transform(1, DEER_UI_WIDTH, DEER_UI_HEIGHT, 0.5, 0.5, 17),   # 16 root 的 UITransform
        comp_info(),                                                    # 17
        prefab_info(1),                                                 # 18
    ]
    return doc


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
    prefab_path = os.path.join(OUT_DIR, NAME + '.prefab')
    write_json(prefab_path, build())
    write_json(prefab_path + '.meta', asset_meta('prefab', '1.1.50', str(uuid.uuid4())))
    if not os.path.exists(OUT_DIR + '.meta'):
        write_json(OUT_DIR + '.meta', asset_meta('directory', '1.2.0', str(uuid.uuid4())))
    print('\n[info] 小鹿 %dx%d（锚点 %.4f, %.4f）+ 火特效 %dx%d ×%.2f @ (%.1f, %.1f)'
          % (DEER_UI_WIDTH, DEER_UI_HEIGHT, DEER_ANCHOR_X, DEER_ANCHOR_Y,
             FIRE_UI_WIDTH, FIRE_UI_HEIGHT, FIRE_SCALE, FIRE_OFFSET_X, FIRE_OFFSET_Y))


main()
