#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""卡牌常用子弹：从「卡牌常用子弹物件」里的碎图批量生成统一格式的弹体 prefab。

为什么要有这个脚本（2026-11-26 第 57 批）
------------------------------------------------
用户口径：「给卡牌常用的子弹制作统一格式的预制体」。七张卡（豌豆游侠 / 毒箭菇 /
杰克藕 / 大嘴花 / 仙桃行者 / 玉林好汉 / 诅咒菇）原来各用各的弹体美术，这次统一成
「一张主体图 + 一条白色三角形拖尾」。

拖尾**不进 prefab**：它由 `ZCEffectCatalog.ZC_EFFECT_TRAIL_SPECS` 登记、视图用
`Graphics` 画在宿主节点上（见 `view/ZCMissileTrail.ts`）。所以 prefab 只负责主体，
七个 prefab 的结构因此完全一致：

    <名字>              (根，scale 1，不承载任何美术)
      └─ body           (抖动改的就是它；`_lscale` = 屏上尺寸 / 素材像素)
           UITransform  (内容尺寸 = 素材画布，CUSTOM)
           Sprite       (`_isTrimmedMode = false`：素材是 trim 导入的，
                         关掉才按原始画布显示，主体位置才与设计稿一致)

🔴 三个必须记住的口径
------------------------------------------------
1. **主体几何中心对齐节点原点**（`_lpos` 补偿 bbox 中心与画布中心的偏差）。
   不补的话，子弹会偏向一侧：杰克藕的球在 215 画布上偏右 16.5px，拖尾从 -X 接过来
   就接在球外面，看着像两件东西。
2. **素材一律 0°**。用户给的参考图（示意 3~7）里灰色三角拖尾都在素材左侧、红箭头朝右，
   说明「素材原样 + 拖尾接在 -X」。所以 `facingOffsetDegrees` 全部是 0；
   若哪张实机看是倒着飞，改的是 `ZCEffectCatalog` 的 spec，**不要**回头转 prefab。
3. **缩放烘在 `body._lscale`**、spec 不写 `nodeScale`。理由是拖尾数值按「宿主本地 px」
   登记（`ZC_EFFECT_TRAIL_SPECS` 的注释），宿主 scale 保持 1 时本地值 = 屏上值，
   七张卡才能共用同一组拖尾数字。

尺寸口径：按**等效直径**（√(w·h)）归一到 `TARGET_EQUIV_DIAMETER`，再给长边一个上限
`MAX_LONG_EDGE` —— 只按长边归一会让仙桃行者那支箭粗成一片，只按面积归一又会让它短得
看不出是箭。要整体调大调小，只改这两个常量后重跑本脚本。

用法：`python tools/build_card_bullet_fx.py`
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import uuid

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'assets/bundles/battle/units/projectiles/卡牌常用子弹物件')

#  「看起来一样大」的目标等效直径（屏上 px）。用户实机看小/看大就改这一个数。
#  2026-11-26 第 58 批：用户实机反馈「现在的子弹太大了」⇒ 48 → 33.6（= 48 × 70%）。
#  🔴 改这个数**同时**要把 `ZC_EFFECT_TRAIL_SPECS` 里那七条的几何按同比例缩
#     （length / startX / rootHalfWidth / tipHalfWidth 全 × 0.7），否则拖尾会明显比弹体粗一圈。
TARGET_EQUIV_DIAMETER = 33.6
#  长边天花板：细长形（箭 / 刀 / 蛇）不会被拉成一根面条。
MAX_LONG_EDGE = 67.2
#  主体节点名：视图的抖动按这个名字找（`BULLET_BODY_NODE_NAME`）。
BODY_NODE_NAME = 'body'
#  不透明阈值：低于它的像素当背景（素材边缘有一圈极淡的抗锯齿）。
ALPHA_THRESHOLD = 8


def read_sprite_frame_uuid(png_path: str) -> str:
    """从 `.png.meta` 取 sprite-frame 子资源的 uuid（`@f9941` 那条）。"""
    meta_path = png_path + '.meta'
    if not os.path.exists(meta_path):
        raise SystemExit(f'缺少 meta（先用编辑器导入素材）：{meta_path}')
    with open(meta_path, encoding='utf8') as handle:
        meta = json.load(handle)
    for name, sub in (meta.get('subMetas') or {}).items():
        if sub.get('importer') == 'sprite-frame':
            return f"{meta['uuid']}@{name}"
    raise SystemExit(f'meta 里没有 sprite-frame 子资源：{meta_path}')


def measure(png_path: str) -> tuple[int, int, tuple[int, int, int, int]]:
    """素材画布尺寸 + 不透明内容的包围盒。"""
    image = Image.open(png_path).convert('RGBA')
    width, height = image.size
    alpha = image.split()[3].point(lambda value: 255 if value > ALPHA_THRESHOLD else 0)
    bbox = alpha.getbbox()
    if bbox is None:
        raise SystemExit(f'整张图都是透明的：{png_path}')
    return width, height, bbox


def scale_for(bbox: tuple[int, int, int, int]) -> float:
    """等效直径归一 + 长边封顶，取更小的那个倍率。"""
    box_w = bbox[2] - bbox[0]
    box_h = bbox[3] - bbox[1]
    equiv = math.sqrt(box_w * box_h)
    by_area = TARGET_EQUIV_DIAMETER / equiv if equiv > 0 else 1.0
    by_long = MAX_LONG_EDGE / max(box_w, box_h) if max(box_w, box_h) > 0 else 1.0
    return round(min(by_area, by_long), 3)


def stable_hex(seed: str, length: int) -> str:
    """确定性 fileId：同一个名字重跑脚本得到同一个 id，SVN 里不会每次全量改写。"""
    return hashlib.sha1(seed.encode('utf8')).hexdigest()[:length]


def build_prefab(name: str, canvas_w: int, canvas_h: int, bbox, sprite_uuid: str) -> list:
    """按统一结构拼一份 prefab（字段顺序对齐既有弹体 prefab，便于人眼 diff）。"""
    scale = scale_for(bbox)
    #  主体几何中心 vs 画布中心：节点坐标 y 向上，图片 y 向下 ⇒ 纵向要反号。
    center_x = (bbox[0] + bbox[2]) / 2.0
    center_y = (bbox[1] + bbox[3]) / 2.0
    offset_x = round(canvas_w / 2.0 - center_x, 2)
    offset_y = round(center_y - canvas_h / 2.0, 2)

    def vec3(x, y, z):
        return {'__type__': 'cc.Vec3', 'x': x, 'y': y, 'z': z}

    def quat():
        return {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1}

    def node(name_, parent, children, components, prefab_id, pos, scale_, ):
        return {
            '__type__': 'cc.Node',
            '_name': name_,
            '_objFlags': 0,
            '__editorExtras__': {},
            '_parent': parent,
            '_children': children,
            '_active': True,
            '_components': components,
            '_prefab': {'__id__': prefab_id},
            '_lpos': pos,
            '_lrot': quat(),
            '_lscale': scale_,
            '_mobility': 0,
            '_layer': 33554432,
            '_euler': vec3(0, 0, 0),
            '_id': '',
        }

    def prefab_info(seed):
        return {
            '__type__': 'cc.PrefabInfo',
            'root': {'__id__': 1},
            'asset': {'__id__': 0},
            'fileId': stable_hex(f'{name}:{seed}', 22),
            'targetOverrides': None,
            'nestedPrefabInstanceRoots': None,
            'instance': None,
        }

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
        node(name, None, [{'__id__': 2}], [], 8, vec3(0, 0, 0), vec3(1, 1, 1)),
        node(BODY_NODE_NAME, {'__id__': 1}, [], [{'__id__': 3}, {'__id__': 5}], 7,
             vec3(offset_x, offset_y, 0), vec3(scale, scale, 1)),
        {
            '__type__': 'cc.UITransform',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 2},
            '_enabled': True,
            '__prefab': {'__id__': 4},
            '_contentSize': {'__type__': 'cc.Size', 'width': canvas_w, 'height': canvas_h},
            '_anchorPoint': {'__type__': 'cc.Vec2', 'x': 0.5, 'y': 0.5},
            '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': stable_hex(f'{name}:uitransform', 22)},
        {
            '__type__': 'cc.Sprite',
            '_name': '',
            '_objFlags': 0,
            '__editorExtras__': {},
            'node': {'__id__': 2},
            '_enabled': True,
            '__prefab': {'__id__': 6},
            '_spriteFrame': {'__uuid__': sprite_uuid, '__expectedType__': 'cc.SpriteFrame'},
            '_type': 0,
            '_fillType': 0,
            '_sizeMode': 0,
            '_fillCenter': {'__type__': 'cc.Vec2', 'x': 0, 'y': 0},
            '_fillStart': 0,
            '_fillRange': 0,
            #  🔴 CUSTOM + 关裁剪：素材是 trim 导入的，开着 trim 会把内容按包围盒重排，
            #  主体就不再落在画布原位，「主体中心对齐原点」也跟着失效。
            '_isTrimmedMode': False,
            '_useGrayscale': False,
            '_atlas': None,
            '_id': '',
        },
        {'__type__': 'cc.CompPrefabInfo', 'fileId': stable_hex(f'{name}:sprite', 22)},
        prefab_info('body'),
        prefab_info('root'),
    ]


def main() -> None:
    if not os.path.isdir(SRC_DIR):
        raise SystemExit(f'找不到素材目录：{SRC_DIR}')

    pngs = sorted(f for f in os.listdir(SRC_DIR) if f.endswith('.png'))
    if not pngs:
        raise SystemExit(f'素材目录里没有 png：{SRC_DIR}')

    print(f'{"prefab":<18}{"画布":>10}{"bbox":>16}{"scale":>8}{"屏上":>14}  拖尾 startX/length')
    for png in pngs:
        name = os.path.splitext(png)[0]
        png_path = os.path.join(SRC_DIR, png)
        canvas_w, canvas_h, bbox = measure(png_path)
        sprite_uuid = read_sprite_frame_uuid(png_path)
        prefab = build_prefab(name, canvas_w, canvas_h, bbox, sprite_uuid)

        out_path = os.path.join(SRC_DIR, f'{name}.prefab')
        with open(out_path, 'w', encoding='utf8', newline='\n') as handle:
            json.dump(prefab, handle, ensure_ascii=False, indent=2)
            handle.write('\n')

        meta_path = out_path + '.meta'
        with open(meta_path, 'w', encoding='utf8', newline='\n') as handle:
            json.dump({
                'ver': '1.1.50',
                'importer': 'prefab',
                'imported': True,
                'uuid': str(uuid.uuid5(uuid.NAMESPACE_URL, f'pow-card-bullet:{name}')),
                'files': ['.json'],
                'subMetas': {},
                'userData': {'syncNodeName': name},
            }, handle, ensure_ascii=False, indent=2)
            handle.write('\n')

        scale = scale_for(bbox)
        box_w = (bbox[2] - bbox[0]) * scale
        box_h = (bbox[3] - bbox[1]) * scale
        #  拖尾：从主体后半段开始，沿 -X 伸出 2 倍等效直径。数值给的是**屏上 px**
        #  （宿主 scale = 1 ⇒ 本地 px = 屏上 px），照抄进 ZC_EFFECT_TRAIL_SPECS 即可。
        start_x = round(-max(6.0, box_w / 2.0 * 0.85), 1)
        length = round(TARGET_EQUIV_DIAMETER * 2.0, 1)
        root_half = round(max(8.0, min(box_h / 2.0, TARGET_EQUIV_DIAMETER * 0.4)), 1)
        print(f'{name:<18}{canvas_w}x{canvas_h:>6}{bbox!s:>16}{scale:>8}'
              f'{box_w:>7.1f}x{box_h:<6.1f}  {start_x} / {length}  (根半宽 {root_half})')


if __name__ == '__main__':
    main()
