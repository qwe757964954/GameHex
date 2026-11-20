# -*- coding: utf-8 -*-
"""
生成「分裂菇_生成分身」预制（2026-11-20 第 33 批）。

背景：美术把 26 张散帧丢进
  assets/bundles/battle/units/projectiles/分裂菇_生成分身/
（`132 SLBLJS vfx_skill_darknix_01_01~26.png`，原始画布 1185×1185）
没有 prefab、没有 anim clip。而特效播放链路（`ZCCombatEvent.effectPrefabPath`
→ `ZCGameLoader` 按路径 `assets.load(path, Prefab)` → `ZCCombatEffectView.mountVisual`
→ `animation.stop()/play(clip)`）**只认 prefab 路径**，所以必须按工程既有结构补一张。

结构照抄同类现役资源（`闪电链水墨风` / `雷弹命中`）：
  0 cc.Prefab / 1 cc.Node / 2 cc.UITransform / 3 CompPrefabInfo
  / 4 cc.Sprite（SIMPLE + CUSTOM、`_isTrimmedMode=false`）/ 5 CompPrefabInfo
  / 6 PrefabInfo / 7 cc.Animation / 8 CompPrefabInfo

三条与「散帧序列」强相关的取法（错了就是「特效静默不出现」）：

  1. **contentSize 取原始画布 1185，不取裁剪后的 rect**。
     这 26 帧的裁剪框从 171×172 一路长到 912×868（爆发式扩散），
     按 frame_01 的裁剪尺寸定画布会把整段爆发压成一小坨。
     `_isTrimmedMode=false` ⇒ 每帧都按 1185 画布整张画进同一个 contentSize，
     帧与帧之间不会互相抽动，爆发该多大就多大。
  2. **`_sizeMode = 0`（CUSTOM）**：序列帧尺寸不许跟着 spriteFrame 变。
  3. **`wrapMode = 1`（Normal / 播一遍）**：这是一次性的「生成」爆点，
     循环播会变成一盏一直闪的灯。

尺寸：`TARGET_BURST_SCREEN_PX` 是**最大那一帧在屏上的宽度**（屏上 px），
不是整张画布 —— 反算 `SCALE = 目标 / 最大裁剪宽`，屏上画布 = 1185 × SCALE。
改大小只改这一个常量重跑；不要改 prefab 的 `_lscale` 与目录里的 `nodeScale` 两处。

已有 `.prefab.meta` / `.anim.meta` 时复用其 uuid（被代码常量与 prefab 引用后别再换身份）。
"""
import base64
import json
import os
import uuid

ROOT = 'assets/bundles/battle/units/projectiles'
DIR_NAME = '分裂菇_生成分身'
PREFAB_NAME = '分裂菇_生成分身'
CLIP_NAME = '分裂菇_生成分身'
FRAME_PREFIX = '132 SLBLJS vfx_skill_darknix_01_'
FRAME_COUNT = 26
#  最大那一帧（frame_12 / 13，912×880）在屏上的宽度。
TARGET_BURST_SCREEN_PX = 120
#  26 帧 / 24fps ≈ 1.083s：与 `ZCGameModel` 里 `ZC_SUMMON_SPAWN_FX_SECONDS` 必须一致，
#  短了会在播到一半时被事件寿命回收（后段爆发看不到），长了会把末帧定格多挂一会儿。
FPS = 24


def new_file_id() -> str:
    """Cocos 的 fileId：22 字符 base64（不带 padding）。"""
    return base64.urlsafe_b64encode(os.urandom(16)).decode('ascii').rstrip('=')


def frame_names():
    return [f'{FRAME_PREFIX}{index:02d}.png' for index in range(1, FRAME_COUNT + 1)]


def read_sprite_frame(path: str):
    """从 png.meta 里读 spriteFrame 的 uuid 与裁剪尺寸（Cocos 生成的子资源 f9941）。"""
    with open(path + '.meta', encoding='utf-8') as handle:
        meta = json.load(handle)
    frame = meta['subMetas']['f9941']
    user_data = frame['userData']
    return {
        'name': os.path.basename(path),
        'uuid': f'{meta["uuid"]}@f9941',
        'width': user_data['width'],
        'height': user_data['height'],
        'rawWidth': user_data['rawWidth'],
        'rawHeight': user_data['rawHeight'],
    }


def build_clip(frames):
    """cc.AnimationClip：一条 ObjectTrack 绑 `cc.Sprite.spriteFrame`，一次性播完。"""
    step = 1 / FPS
    times = [round(index * step, 10) for index in range(len(frames))]
    return {
        '__type__': 'cc.AnimationClip',
        '_name': CLIP_NAME,
        '_objFlags': 0,
        '_native': '',
        'sample': 30,
        'speed': 1,
        #  1 = Normal：只播一遍，停在末帧；事件寿命与 `_duration` 对齐，末帧停不了几毫秒。
        'wrapMode': 1,
        'events': [],
        #  末帧也要占满一拍，否则最后一格只闪 0 秒。
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


def build_prefab(frame, canvas: int, scale: float, clip_uuid: str):
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
            #  锚点居中 = 爆点正落在分身坐标上（单位根是脚点，视图不额外抬升）。
            '_lpos': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
            '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
            '_lscale': {'__type__': 'cc.Vec3', 'x': scale, 'y': scale, 'z': 1},
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
            '_contentSize': {'__type__': 'cc.Size', 'width': canvas, 'height': canvas},
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
            #  CUSTOM：26 帧裁剪框差得极大，跟着 spriteFrame 走会整体抽动。
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
            #  视图侧 `ZCCombatEffectView.mountVisual` 会 `stop()` + `play(clipName)`，
            #  这里留 true 是为了在编辑器里拖出来就能预览。
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


def write_json(path: str, payload, newline: str = '\n') -> None:
    with open(path, 'w', encoding='utf-8', newline=newline) as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write(newline)


def ensure_directory_meta(directory: str) -> None:
    """`anim/` 的目录 meta：手工建目录时编辑器会补一份，这里先写好免得它换 uuid。"""
    meta_path = directory + '.meta'
    if os.path.exists(meta_path):
        return
    write_json(meta_path, {
        'ver': '1.2.0',
        'importer': 'directory',
        'imported': True,
        'uuid': str(uuid.uuid4()),
        'files': [],
        'subMetas': {},
        'userData': {},
    }, '\r\n')


def main():
    directory = os.path.join(ROOT, DIR_NAME)
    names = frame_names()
    frames = [read_sprite_frame(os.path.join(directory, name)) for name in names]
    canvas = frames[0]['rawWidth']
    if any(frame['rawWidth'] != canvas or frame['rawHeight'] != canvas for frame in frames):
        raise SystemExit('这 26 帧的原始画布不一致，不能共用同一个 contentSize')
    widest = max(frames, key=lambda frame: frame['width'])
    scale = round(TARGET_BURST_SCREEN_PX / widest['width'], 6)
    prefab_path = os.path.join(directory, f'{PREFAB_NAME}.prefab')
    meta_path = prefab_path + '.meta'

    #  ── 动画片段 ──
    anim_dir = os.path.join(directory, 'anim')
    os.makedirs(anim_dir, exist_ok=True)
    ensure_directory_meta(anim_dir)
    anim_path = os.path.join(anim_dir, f'{CLIP_NAME}.anim')
    anim_meta_path = anim_path + '.meta'
    clip_uuid = reuse_uuid(anim_meta_path)
    write_json(anim_path, build_clip(frames))
    write_json(anim_meta_path, {
        'ver': '2.0.4',
        'importer': 'animation-clip',
        'imported': True,
        'uuid': clip_uuid,
        'files': ['.bin'],
        'subMetas': {},
        'userData': {'name': CLIP_NAME},
    }, '\r\n')

    #  ── 预制 ──
    write_json(prefab_path, build_prefab(frames[0], canvas, scale, clip_uuid))
    write_json(meta_path, {
        'ver': '1.1.50',
        'importer': 'prefab',
        'imported': True,
        'uuid': reuse_uuid(meta_path),
        'files': ['.json'],
        'subMetas': {},
        'userData': {'syncNodeName': PREFAB_NAME},
    }, '\r\n')

    duration = len(frames) / FPS
    print(f'帧数 {len(frames)}，原始画布 {canvas}×{canvas}')
    print(f'裁剪框 range：{min(f["width"] for f in frames)}×{min(f["height"] for f in frames)}'
          f' ~ {widest["width"]}×{widest["height"]}（{widest["name"]}）')
    print(f'SCALE {scale} ⇒ 最大一帧屏上 {widest["width"] * scale:.1f}×{widest["height"] * scale:.1f} px，'
          f'整张画布屏上 {canvas * scale:.1f} px')
    print(f'序列帧 @ {FPS}fps，`_duration` = {duration:.4f}s，wrapMode=Normal（播一遍）')
    print(f'写出 {prefab_path} / {anim_path}')
    print(f'⚠️ 模型侧 `ZC_SUMMON_SPAWN_FX_SECONDS` 必须等于 {duration:.4f}')


if __name__ == '__main__':
    main()
