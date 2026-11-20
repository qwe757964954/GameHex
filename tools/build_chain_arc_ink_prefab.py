# -*- coding: utf-8 -*-
"""
生成「闪电链水墨风」预制（2026-11-19 第 23 批）。

背景：用户要求把 102203 闪电链的每段电弧从【闪电链_电弧】（雷道人武将_闪电_attack_05，落雷造型）
换成美术新出的【闪电链水墨风】（`frame_01~03.png`，108×282 三帧）。

2026-11-19 第二轮（用户原话「闪电链没有播放序列帧，怎么是静态的，整个特效的 size 放大成 2」）：
  1. **改成三帧序列**：挂 `cc.Animation` + `anim/闪电链水墨风.anim`，轨道绑
     `cc.Sprite.spriteFrame`，15 fps 循环（3 帧 / 0.2s，一次链路 0.667s 能闪 3 轮）。
     ⚠️ 整条链是同一个 prefab 复制 n 份，各播各的 ⇒ 段与段之间**不保证同帧**
     （2026-11-18 第 17 批的口径）。段数少时无所谓，段数一多会看出「有的亮有的暗」——
     真要严格同步得改成「一条链一个节点 + 若干子节点共用一份帧表」，那是另一件事。
  2. **整体 ×2**：`SCALE` 0.333333 → 0.666666，屏上高度 93.33 → 186.67。
     换完必须同步 `ZCChainLightningFx.ZC_CHAIN_SEGMENT_SCREEN_LENGTH`，否则段长与实际不符
     ⇒ 要么段与段之间露缝，要么末段戳过目标。

结构（9 个对象）：
  0 cc.Prefab / 1 cc.Node（锚点中心、`_lpos.y` = 屏上一半 ⇒ **底端钉在节点原点**）
  / 2 cc.UITransform（contentSize = frame_01 裁剪后的 rect）/ 3 CompPrefabInfo
  / 4 cc.Sprite（SIMPLE + CUSTOM、`_isTrimmedMode=false`）/ 5 CompPrefabInfo
  / 6 PrefabInfo / 7 cc.Animation / 8 CompPrefabInfo

换帧或换图时改下面的常量重跑即可；已有 `.prefab.meta` / `.anim.meta` 时复用其 uuid。
"""
import base64
import json
import os
import uuid

ROOT = 'assets/bundles/battle/units/projectiles'
DIR_NAME = '闪电链水墨风'
PREFAB_NAME = '闪电链水墨风'
CLIP_NAME = '闪电链水墨风'
#  frame_01 定 contentSize（另两帧宽度差 2px，CUSTOM 尺寸不跟着跳）。
SOURCE_FRAME = 'frame_01.png'
FRAMES = ['frame_01.png', 'frame_02.png', 'frame_03.png']
#  0.666666 = 旧口径 0.333333 的两倍（用户「size 放大成 2」）。
SCALE = 0.666666
#  3 帧 / 15fps = 每次循环 0.2s；链路存活 0.667s ⇒ 大约闪 3 轮。
FPS = 15


def new_file_id() -> str:
    """Cocos 的 fileId：22 字符 base64（不带 padding）。"""
    return base64.urlsafe_b64encode(os.urandom(16)).decode('ascii').rstrip('=')


def read_sprite_frame(path: str):
    """从 png.meta 里读 spriteFrame 的 uuid 与裁剪尺寸（Cocos 生成的子资源 f9941）。"""
    with open(path + '.meta', encoding='utf-8') as handle:
        meta = json.load(handle)
    frame = meta['subMetas']['f9941']
    user_data = frame['userData']
    return {
        'uuid': f'{meta["uuid"]}@f9941',
        'width': user_data['width'],
        'height': user_data['height'],
        'rawWidth': user_data['rawWidth'],
        'rawHeight': user_data['rawHeight'],
        'trimX': user_data['trimX'],
        'trimY': user_data['trimY'],
    }


def build_clip(frames):
    """cc.AnimationClip：一条 ObjectTrack 绑 `cc.Sprite.spriteFrame`，15fps 循环。"""
    step = 1 / FPS
    times = [round(index * step, 10) for index in range(len(frames))]
    return {
        '__type__': 'cc.AnimationClip',
        '_name': CLIP_NAME,
        '_objFlags': 0,
        '_native': '',
        'sample': 30,
        'speed': 1,
        #  2 = Loop：链路活着的那 0.667s 里循环播放，不是播一遍就定住。
        'wrapMode': 2,
        'events': [],
        '_duration': round(len(frames) * step, 10),
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
                        '_values': [
                            {'__uuid__': frame['uuid'], '__expectedType__': 'cc.SpriteFrame'}
                            for frame in frames
                        ],
                    },
                },
            },
        ],
    }


def build_prefab(frame, height_screen: float, clip_uuid: str):
    width, height = frame['width'], frame['height']
    return [
        {
            '__type__': 'cc.Prefab',
            '_name': PREFAB_NAME,
            '_objFlags': 0,
            '__editorExtras__': {},
            '_native': '',
            'data': {'__id__': 1},
            'optimizationPolicy': 0,
            'persistent': False,
        },
        {
            '__type__': 'cc.Node',
            '_name': PREFAB_NAME,
            '_objFlags': 0,
            '__editorExtras__': {},
            '_parent': None,
            '_children': [],
            '_active': True,
            '_components': [{'__id__': 2}, {'__id__': 4}, {'__id__': 7}],
            '_prefab': {'__id__': 6},
            #  底端钉在节点原点：链段摆到哪，电弧就从哪开始（与 `闪电链_电弧` 同口径）。
            '_lpos': {'__type__': 'cc.Vec3', 'x': 0, 'y': round(height_screen / 2, 4), 'z': 0},
            '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
            '_lscale': {'__type__': 'cc.Vec3', 'x': SCALE, 'y': SCALE, 'z': 1},
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
        {'__type__': 'cc.CompPrefabInfo', 'fileId': new_file_id()},
        {
            '__type__': 'cc.Sprite',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 1},
            '_enabled': True,
            '__prefab': {'__id__': 5},
            '_spriteFrame': {'__uuid__': frame['uuid'], '__expectedType__': 'cc.SpriteFrame'},
            '_type': 0,
            '_fillType': 0,
            #  CUSTOM：三帧宽度差 2px，跟着 rect 走会让整段左右抖。
            '_sizeMode': 0,
            '_fillCenter': {'__type__': 'cc.Vec2', 'x': 0, 'y': 0},
            '_fillStart': 0,
            '_fillRange': 0,
            '_isTrimmedMode': False,
            '_useGrayscale': False,
            '_atlas': None,
            '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': new_file_id()},
        {
            '__type__': 'cc.PrefabInfo',
            'root': {'__id__': 1},
            'asset': {'__id__': 0},
            'fileId': new_file_id(),
            'targetOverrides': None,
            'nestedPrefabInstanceRoots': None,
            'instance': None,
        },
        {
            '__type__': 'cc.Animation',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 1},
            '_enabled': True,
            '__prefab': {'__id__': 8},
            #  视图侧 `ZCCombatEffectView.attachVisualPrefab` 也会 `stop()` + `play(clipName)`，
            #  这里留着 true 是为了在编辑器里拖出来就能预览。
            'playOnLoad': True,
            '_clips': [{'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'}],
            '_defaultClip': {'__uuid__': clip_uuid, '__expectedType__': 'cc.AnimationClip'},
            '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': new_file_id()},
    ]


def reuse_uuid(meta_path: str) -> str:
    """已有 meta 时复用 uuid：prefab / clip 被代码常量与 prefab 引用后就别再换身份了。"""
    if os.path.exists(meta_path):
        with open(meta_path, encoding='utf-8') as handle:
            existing = json.load(handle).get('uuid')
        if existing:
            return existing
    return str(uuid.uuid4())


def main():
    directory = os.path.join(ROOT, DIR_NAME)
    frame = read_sprite_frame(os.path.join(directory, SOURCE_FRAME))
    frames = [read_sprite_frame(os.path.join(directory, name)) for name in FRAMES]
    prefab_path = os.path.join(directory, f'{PREFAB_NAME}.prefab')
    meta_path = prefab_path + '.meta'

    #  ── 动画片段 ──
    anim_dir = os.path.join(directory, 'anim')
    os.makedirs(anim_dir, exist_ok=True)
    anim_path = os.path.join(anim_dir, f'{CLIP_NAME}.anim')
    anim_meta_path = anim_path + '.meta'
    clip_uuid = reuse_uuid(anim_meta_path)
    with open(anim_path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(build_clip(frames), handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    anim_meta = {
        'ver': '2.0.4',
        'importer': 'animation-clip',
        'imported': True,
        'uuid': clip_uuid,
        'files': ['.bin'],
        'subMetas': {},
        'userData': {'name': CLIP_NAME},
    }
    with open(anim_meta_path, 'w', encoding='utf-8', newline='\r\n') as handle:
        json.dump(anim_meta, handle, ensure_ascii=False, indent=2)
        handle.write('\r\n')

    #  ── 预制 ──
    height_screen = frame['height'] * SCALE
    width_screen = frame['width'] * SCALE
    with open(prefab_path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(build_prefab(frame, height_screen, clip_uuid), handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    prefab_uuid = reuse_uuid(meta_path)
    meta = {
        'ver': '1.1.50',
        'importer': 'prefab',
        'imported': True,
        'uuid': prefab_uuid,
        'files': ['.json'],
        'subMetas': {},
        'userData': {'syncNodeName': PREFAB_NAME},
    }
    with open(meta_path, 'w', encoding='utf-8', newline='\r\n') as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
        handle.write('\r\n')

    print(f'源帧 {SOURCE_FRAME}: raw {frame["rawWidth"]}×{frame["rawHeight"]}'
          f' → 裁剪 rect {frame["width"]}×{frame["height"]}（trimX {frame["trimX"]}, trimY {frame["trimY"]}）')
    print(f'屏上尺寸 {width_screen:.3f} × {height_screen:.3f}（scale {SCALE}）')
    print(f'根 _lpos.y = {height_screen / 2:.4f}（底端在节点原点）')
    print(f'序列帧 {len(frames)} 帧 @ {FPS}fps，一次循环 {len(frames) / FPS:.3f}s，wrapMode=Loop')
    print(f'写出 {prefab_path} / {anim_path}')
    print('⚠️ 换了 SCALE 就要同步 ZCChainLightningFx 的 SCREEN_LENGTH（现应为 186.666）')


if __name__ == '__main__':
    main()
