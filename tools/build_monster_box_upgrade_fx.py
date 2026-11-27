# -*- coding: utf-8 -*-
"""
生成「怪物宝箱升级成功」spine 提示预制（2026-11-25）。

需求原话：
  「怪物宝箱升级成功的提示使用spine动画 @image#1 制作格式一致的预制，播放1次即可，
    在屏幕中间位置播放」

美术交付的资产是 `assets/resources/skel/UI升级升星升阶特效字/shengduan.skel`
（spine 3.8.99 / binary，导出工具写的是 `spine-2/effect3`），一张图里塞了三条动画：
`shengji` / `shengjie` / `shengxing`（各 1.07s）。截图是「升级成功」那一版 ⇒ 用 `shengji`。

⚠️ 动画名**不在** `.prefab` 里：`shengduan.skel.meta` 只登记了 uuid / atlasUuid，
Cocos 的 `library/3c/3c5ccf59-….json` 里 `_skeletonJson` 也是 `null`（只存了 `.bin` 与
textures）⇒ 名字是拿 `@pixi-spine/runtime-3.8` 在 Node 里把 `.skel` 解开读出来的。
三条动画的逐帧包围盒（`AnimationState.update/apply` + `attachment.computeWorldVertices`）：

    shengji   x -71.3 ..  68.0   y -28.1 .. 30.7   ⇒ 139.2 × 58.8，中心 (-1.6, 1.3)
    shengjie  x -72.8 ..  66.4   y -28.1 .. 30.7   ⇒ 139.2 × 58.8，中心 (-3.2, 1.3)
    shengxing x -70.5 ..  68.7   y -29.6 .. 29.2   ⇒ 139.2 × 58.8，中心 (-0.9, -0.2)

三条一样大、中心都在原点附近 ⇒ 预制 UITransform 取 140×60、锚点 0.5/0.5，节点原点就是
视觉中心（「格式一致」＝ 不用再像 `CardUpgradeFx` 那样按包围盒反算偏心锚点）。

播放语义：
  · `loop: false` + 运行时 `setAnimation(0, 'shengji', false)` ⇒ **正好播一次**；
  · `defaultAnimation` 也写 `shengji` —— 只是编辑器里点开能直接预览，实机由面板起播。

尺寸：逻辑 139×59（设计分辨率 720×1280 的 19%）太小，读不出「升级成功」⇒ 预制里烘
`_lscale = 2`（屏上 278×118，约占屏宽 39%）。要改大小只改 `FX_SCALE`，别改 UITransform
（那是素材真实包围盒，改了就和美术对不上）。

跨包：`resources/skel/` 与 `resources/ui/territory/` 都在首包 `resources`，预制引用
同包 spine 不产生跨包依赖。
"""
import json
import os
import uuid

ROOT = 'assets/resources/ui/territory'
NAME = 'TerritoryMonsterBoxUpgradeFx'

# shengduan.skel.meta 里的 uuid（spine-data importer）
SKELETON_UUID = '3c5ccf59-899c-4bd5-ba07-e1feab8676e1'
ANIMATION = 'shengji'

# 三条动画的实测包围盒（见文件头）：139.2 × 58.8，取整到 140 × 60。
FX_WIDTH = 140
FX_HEIGHT = 60
FX_SCALE = 2.0


def file_id():
    return uuid.uuid4().hex[:22]


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print('[ok]', path)


def node(name, components, prefab_info, scale):
    return {
        '__type__': 'cc.Node',
        '_name': name,
        '_objFlags': 0,
        '__editorExtras__': {},
        '_parent': None,
        '_children': [],
        '_active': True,
        '_components': [{'__id__': i} for i in components],
        '_prefab': {'__id__': prefab_info},
        '_lpos': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
        '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
        '_lscale': {'__type__': 'cc.Vec3', 'x': scale, 'y': scale, 'z': 1},
        '_mobility': 0,
        '_layer': 33554432,
        '_euler': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
        '_id': '',
    }


def ui_transform(width, height, anchor_x, anchor_y, prefab_info):
    return {
        '__type__': 'cc.UITransform',
        '_name': '',
        '_objFlags': 0,
        '__editorExtras__': {},
        'node': {'__id__': 1},
        '_enabled': True,
        '__prefab': {'__id__': prefab_info},
        '_contentSize': {'__type__': 'cc.Size', 'width': width, 'height': height},
        '_anchorPoint': {'__type__': 'cc.Vec2', 'x': anchor_x, 'y': anchor_y},
        '_id': '',
    }


def comp_info():
    return {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id()}


def prefab_info():
    return {
        '__type__': 'cc.PrefabInfo',
        'root': {'__id__': 1},
        'asset': {'__id__': 0},
        'fileId': file_id(),
        'instance': None,
        'targetOverrides': None,
        'nestedPrefabInstanceRoots': None,
    }


def build():
    return [
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
        # 1 根节点：单节点预制，原点 = spine 视觉中心（包围盒中心 ≈ (0,0)）。
        node(NAME, [2, 4], 6, FX_SCALE),
        ui_transform(FX_WIDTH, FX_HEIGHT, 0.5, 0.5, 3),   # 2
        comp_info(),                                      # 3
        # 4 sp.Skeleton：逐键抄自 `ui/card/CardUpgradeFx.prefab`（同样是「播一次的字特效」），
        #   只换 SkeletonData、动画名与 loop（那边 loop 也是 false，这里保持一致）。
        {
            '__type__': 'sp.Skeleton',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 1},
            '_enabled': True,
            '__prefab': {'__id__': 5},
            '_customMaterial': None,
            '_srcBlendFactor': 2,
            '_dstBlendFactor': 4,
            '_color': {'__type__': 'cc.Color', 'r': 255, 'g': 255, 'b': 255, 'a': 255},
            '_skeletonData': {'__uuid__': SKELETON_UUID, '__expectedType__': 'sp.SkeletonData'},
            'defaultSkin': 'default',
            'defaultAnimation': ANIMATION,
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
            'loop': False,
            '_id': '',
        },
        comp_info(),                                      # 5
        prefab_info(),                                    # 6
    ]


def asset_meta(asset_uuid):
    """与同目录其它预制同一份 userData 口径（`syncNodeName` 让编辑器改根节点名时同步预制名）。"""
    return {
        'ver': '1.1.50',
        'importer': 'prefab',
        'imported': True,
        'uuid': asset_uuid,
        'files': ['.json'],
        'subMetas': {},
        'userData': {'syncNodeName': NAME, 'hasIcon': False},
    }


def main():
    prefab_path = os.path.join(ROOT, NAME + '.prefab')
    write_json(prefab_path, build())
    # 已存在就沿用原 uuid（重跑脚本不能把工程里已引用的 uuid 换掉）
    meta_path = prefab_path + '.meta'
    asset_uuid = str(uuid.uuid4())
    if os.path.exists(meta_path):
        try:
            asset_uuid = json.load(open(meta_path, encoding='utf-8'))['uuid']
        except (ValueError, KeyError):
            pass
    write_json(meta_path, asset_meta(asset_uuid))
    print('[info] spine %s ×%.2f ⇒ 屏上 %.0f × %.0f 逻辑像素'
          % (ANIMATION, FX_SCALE, FX_WIDTH * FX_SCALE, FX_HEIGHT * FX_SCALE))


if __name__ == '__main__':
    main()
