"""
给 `image/territory/chest/*.png` 生成**能当 SpriteFrame 用**的 `.meta`。

## 为什么需要这个脚本

Cocos Creator 3.x 的一张图片导入后会产生**两个**子资源：

| 子资源 id | 类型 | 用途 |
| --- | --- | --- |
| `6c48a` | `texture` | `resources.load(path, Texture2D)` |
| `f9941` | `sprite-frame` | `resources.load(path + '/spriteFrame', SpriteFrame)` |

手写的 meta 如果只写了 `6c48a`、`userData.type` 留成 `"texture"`，
`resources.load('.../chest_seq_0/spriteFrame', SpriteFrame)` 会**直接失败**
（路径根本不存在）—— 表现是「开箱动画整段没有箱体、只剩光效」，而且**不报错只 warn**，
非常难查。宝箱补帧序列就踩过这个坑（2026-10-22）。

## 为什么 `trimType = "none"`

补帧序列是**同一张画布**上的翻页动画：箱盖长高时内容的包围盒（bbox）每帧都不一样。
若按 bbox 裁（`auto`），`SpriteFrame.rect` 每帧不同 ⇒ 视图那句
`CHEST_VISIBLE_HEIGHT / frame.rect.height` 会把每帧缩到不同的比例，
看起来就是「宝箱一开盖就整体缩小」。

关掉裁剪 ⇒ `rect` 恒等于整张画布（142×156），翻页时只有像素变化、没有尺寸变化。

## 用法

```
"C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe" tools/gen_chest_meta.py
```

幂等：已存在的 `uuid` 会**沿用**（不换 id），只重写子资源与 userData。
"""

from __future__ import annotations

import glob
import json
import os
import uuid as uuidlib

CHEST_DIR = os.path.join('assets', 'resources', 'image', 'territory', 'chest')

# 与工程里其它图片一致的版本号（照抄 `territory_fixed_resource_v1.png.meta`）。
IMAGE_VER = '1.0.27'
TEXTURE_VER = '1.0.22'
SPRITE_VER = '1.0.12'
TEXTURE_ID = '6c48a'
SPRITE_ID = 'f9941'


def read_size(path: str) -> tuple[int, int]:
    """只读 PNG 头（IHDR）拿宽高 —— 避免为 7 张图引入 Pillow 依赖。"""
    with open(path, 'rb') as handle:
        head = handle.read(33)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'不是 PNG：{path}')
    width = int.from_bytes(head[16:20], 'big')
    height = int.from_bytes(head[20:24], 'big')
    return width, height


def load_uuid(path: str) -> str:
    """沿用旧 meta 的 uuid（没有就新生成）。"""
    meta = f'{path}.meta'
    if os.path.exists(meta):
        try:
            with open(meta, 'r', encoding='utf-8') as handle:
                old = json.load(handle)
            value = old.get('uuid')
            if isinstance(value, str) and len(value) == 36:
                return value
        except (OSError, ValueError):
            pass
    return str(uuidlib.uuid4())


def build_meta(name: str, root_uuid: str, width: int, height: int) -> dict:
    half_w = width / 2
    half_h = height / 2
    # 不裁剪 ⇒ 顶点就是整张画布的四个角，UV 铺满 [0,1]。
    raw_position = [
        -half_w, -half_h, 0,
        half_w, -half_h, 0,
        -half_w, half_h, 0,
        half_w, half_h, 0,
    ]
    # ⚠️ `uv` 用的是「左下原点」的**像素**坐标（与 `territory_fixed_resource_v1` 同尺规）：
    #    上边 y = rawHeight、下边 y = 0。
    uv = [0, height, width, height, 0, 0, width, 0]
    nuv = [0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0]
    return {
        'ver': IMAGE_VER,
        'importer': 'image',
        'imported': True,
        'uuid': root_uuid,
        'files': ['.json', '.png'],
        'subMetas': {
            TEXTURE_ID: {
                'importer': 'texture',
                'uuid': f'{root_uuid}@{TEXTURE_ID}',
                'displayName': name,
                'id': TEXTURE_ID,
                'name': 'texture',
                'userData': {
                    'wrapModeS': 'clamp-to-edge',
                    'wrapModeT': 'clamp-to-edge',
                    'imageUuidOrDatabaseUri': root_uuid,
                    'isUuid': True,
                    'visible': False,
                    'minfilter': 'linear',
                    'magfilter': 'linear',
                    'mipfilter': 'none',
                    'anisotropy': 0,
                },
                'ver': TEXTURE_VER,
                'imported': True,
                'files': ['.json'],
                'subMetas': {},
            },
            SPRITE_ID: {
                'importer': 'sprite-frame',
                'uuid': f'{root_uuid}@{SPRITE_ID}',
                'displayName': name,
                'id': SPRITE_ID,
                'name': 'spriteFrame',
                'userData': {
                    'trimThreshold': 1,
                    'rotated': False,
                    'offsetX': 0.5,
                    'offsetY': 0.5,
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
                        'rawPosition': raw_position,
                        'indexes': [0, 1, 2, 2, 1, 3],
                        'uv': uv,
                        'nuv': nuv,
                        'minPos': [-half_w, -half_h, 0],
                        'maxPos': [half_w, half_h, 0],
                    },
                    'isUuid': True,
                    'imageUuidOrDatabaseUri': f'{root_uuid}@{TEXTURE_ID}',
                    'atlasUuid': '',
                    # `none` = 不按内容包围盒裁（翻页动画必须固定 rect，见文件头说明）。
                    'trimType': 'none',
                },
                'ver': SPRITE_VER,
                'imported': True,
                'files': ['.json'],
                'subMetas': {},
            },
        },
        'userData': {
            'type': 'sprite-frame',
            'fixAlphaTransparencyArtifacts': False,
            'hasAlpha': True,
            # 主资源重定向到 texture（与引擎导入结果一致）；SpriteFrame 走 `@f9941`。
            'redirect': f'{root_uuid}@{TEXTURE_ID}',
        },
    }


def main() -> None:
    paths = sorted(glob.glob(os.path.join(CHEST_DIR, '*.png')))
    if not paths:
        raise SystemExit(f'没有找到图片：{CHEST_DIR}')
    for path in paths:
        name = os.path.splitext(os.path.basename(path))[0]
        width, height = read_size(path)
        root_uuid = load_uuid(path)
        meta = build_meta(name, root_uuid, width, height)
        with open(f'{path}.meta', 'w', encoding='utf-8', newline='\n') as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        print(f'{name}: {width}x{height} -> {root_uuid}@f9941')


if __name__ == '__main__':
    main()
