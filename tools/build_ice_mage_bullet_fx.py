# -*- coding: utf-8 -*-
"""冰法师通用子弹（第 51 批）散图 -> 图集 + 循环序列帧动画 + Prefab。

## 需求

「急冻瓜的【冰山陨落】【急冻光线】都使用新的冰法师通用子弹特效，制作格式一致的预制体，
飞行中是循环的序列帧，普通子弹飞行时箭头的方向朝向目标，特殊技能垂直下落的子弹时是箭头
方向直线下落，急冻光线使用特效不用拉长，直接当场急冻子弹使用」。

于是两个 Set 一起做（格式与 `战士通用剑气` / `玉米射手_普攻` 完全同构）：

    <set>/atlas/<帧>.png + <set>/atlas/<set>.pac     auto-atlas 自动图集
    <set>/anim/<set>-loop.anim                       序列帧动画（**循环**）
    <set>/<set>.prefab                               战斗特效 Prefab（两级：根 + offset）

| Set | 用在哪 | 帧 | 采样 |
| :-- | :-- | :-- | :-- |
| `冰法师通用子弹` | 急冻光线（`random_strike` 弹体）/ 冰山陨落（落地一击） | `fashe1_0..6`（7） | 24 |
| `冰法师通用子弹命中` | 上面两条的命中爆炸 | `fashe2_00..12`（13） | 12 |

## 🔴 朝向：素材正前方是 **+Y**（屏幕向上），不是 +X

`fashe1_*` 逐帧量 alpha>8 的框：第 0 帧是 200×200 的圆（冰爆本体，贴上方 y=46），
往后每帧内容**只往下长**（y 到 581），宽度从 200 涨到 280 ⇒ **冰爆头在上、尾迹在下**。
用户示例图也是同一个结论（红箭头从下往上穿过冰爆）。

所以：

  · 水平飞（急冻光线）⇒ `facingOffsetDegrees = -90`（素材 90° → 弹道方向 θ，转 θ−90）；
  · 垂直下落（冰山陨落）⇒ 同一个 offset 也自动得 −180（箭头朝下），**不需要第二条规则**；
  · 但冰山陨落走的是**事件级** `angleDegrees`（不是弹道），所以那一条要单独给 180°。

🔴 「急冻光线不用拉长」= 尺寸只由 `PREFAB_SCALE` 定，**不按弹道距离/判定半径拉伸**。
本脚本没有任何按距离算尺寸的代码，别加。

## 尺寸口径（改大小只动这两个 `*_SCALE`）

两个 Set 都先按**并集框**裁掉画布空白（逐帧各自的框大小不同，逐帧裁会抖），再等比缩到长边 256：

| Set | 源画布 | 并集框 | 裁后 → 缩到长边 256 | Prefab 屏上 |
| :-- | :-- | :-- | :-- | :-- |
| 子弹 | 359×615 | (52,6)-(332,581) = 280×575 | 125×256 | ×0.3 ⇒ **38×77** |
| 命中 | 1156×1156 | (341,335)-(802,1007) = 461×672 | 176×256 | ×0.5 ⇒ **88×128** |

参照系（都是屏上 px）：旧冰锥 14×67、幽魂怪子弹 34×44、战士通用剑气 123×141、
格面 123×90。子弹 38×77 = 0.3 格宽、0.86 格长 —— 是"一颗弹体"而不是"一条射线"，
这正是用户要的「不用拉长」；命中 88×128 比弹体大一圈，炸开才有层次。
"""
import os

from PIL import Image

import build_dart_attack_fx as base

#  两个 Set 的公共口径：散图 -> 图集 + 循环 anim + prefab
CACHE_UNUSED = True      # 未参与打包的散图搬去 tmp（`xuli` 蓄力帧本轮不用）
WRAP_LOOP = 2            # 循环：飞行中是循环的序列帧（用户口径）

SETS = [
    {
        'name': '冰法师通用子弹',
        'frames': [f'zft_tg_ani-fashe1_{i}.png' for i in range(7)],
        'union': (52, 6, 332, 581),
        'canvas_h': 256,
        'scale': 0.3,
        'sample': 24,
        'pos': (0.0, 0.0),
    },
    {
        'name': '冰法师通用子弹命中',
        'frames': [f'zft_tg_ani-fashe2_{i:02d}.png' for i in range(13)],
        'union': (341, 335, 802, 1007),
        'canvas_h': 256,
        'scale': 0.5,
        'sample': 12,
        'pos': (0.0, 0.0),
    },
]


def _canvas_w(union, canvas_h):
    return round((union[2] - union[0]) * canvas_h / (union[3] - union[1]))


def _prepare_atlas_frames(spec):
    """按并集框裁掉空白再写进 `atlas/`。

    `base.main()` 只在 `atlas/<name>.png` **不存在**时才自己缩放 —— 而它缩的是**整幅画布**。
    命中那套画布 1156×1156、内容只占 461×672（40%），整幅缩下来只剩一小团。
    所以先铺好这一张，`main()` 就只写 meta / pac / anim / prefab。
    """
    set_dir = os.path.join(base.PROJECTILES_DIR, spec['name'])
    atlas_dir = os.path.join(set_dir, 'atlas')
    os.makedirs(atlas_dir, exist_ok=True)
    canvas_w, canvas_h = _canvas_w(spec['union'], spec['canvas_h']), spec['canvas_h']
    for name in spec['frames']:
        dst = os.path.join(atlas_dir, name)
        if os.path.isfile(dst):
            continue
        src = os.path.join(set_dir, name)
        if not os.path.isfile(src):
            raise RuntimeError(f'缺帧: {src}')
        with Image.open(src) as im:
            im = im.convert('RGBA').crop(spec['union']).resize((canvas_w, canvas_h), Image.LANCZOS)
            im.save(dst, 'PNG', optimize=True)
        print(f"[裁+缩] {spec['name']}/{name} -> {canvas_w}x{canvas_h}")


def build(spec):
    base.SET_NAME = spec['name']
    base.FRAMES = list(spec['frames'])
    base.CANVAS_W = _canvas_w(spec['union'], spec['canvas_h'])
    base.CANVAS_H = spec['canvas_h']
    base.PREFAB_SCALE = spec['scale']
    base.PREFAB_POS = spec['pos']
    base.PREFAB_COLOR = None
    base.WRAP_LOOP = WRAP_LOOP
    base.SAMPLE = spec['sample']
    base.CACHE_UNUSED_FRAMES = CACHE_UNUSED
    _prepare_atlas_frames(spec)
    base.main()


if __name__ == '__main__':
    for item in SETS:
        print(f"\n===== {item['name']} =====")
        build(item)
        w, h = _canvas_w(item['union'], item['canvas_h']), item['canvas_h']
        print(f"屏上 {round(w * item['scale'])}x{round(h * item['scale'])} px"
              f"（画布 {w}x{h} × {item['scale']}）")
    print('\n朝向：素材正前方 +Y ⇒ 弹体 facingOffsetDegrees = -90'
          '（水平飞转成弹道方向 / 垂直下落自动朝下）；'
          '冰山陨落的落地那一击是事件级 angleDegrees = 180')
