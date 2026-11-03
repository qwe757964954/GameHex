# -*- coding: utf-8 -*-
"""量「盖层用哪张云图」的**整屏平均亮度**—— 用来判"发灰"到底是不是影子造成的。

背景（2026-11-02 晚上，用户实机截图「当前云的层级是错误的，应该和 screenshot-1 一致（都是白色）」）：

`image/territory/cloud/` 下有两张只差一层的图：

| 图 | 内容 | 地图怎么用 |
| --- | --- | --- |
| `cloud_idle_*` | 云体 **+ 影子**（纯黑、alpha 21~61）烤在一起 | 不用 |
| `cloud_body_0` | 只有云体 | 影子**全部抽到 `CloudShadow` 层、压在云体之下**，所以地图上的云是白的 |
| `cloud_shadow_0` | 只有影子 | 同上 |

盖层是几百朵**密铺**，如果每朵都自带影子，黑影就会盖在**邻居的白云体**上 ⇒ 整屏发灰。
这个脚本按 `territoryBattleIntroCoverPuffs` 的真点阵把三种画法各合成一遍，报平均亮度：

    single      = 合并图（`cloud_idle_0`）—— 实机就是这一版，用户说发灰
    body_only   = 只画云体（现在的口径）
    two_layer   = 影子全在下、云体全在上（地图那套结构）

判据：拿它跟**实机截图**比。领地正常页 ≈ (231,230,217)，用户截图的灰版 ≈ (147,145,136)。

用法（仓库根目录，跑完看 `tmp/cover-probe/` 里的三张图）：

    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/probe_cloud_cover_grey.py
"""
import json
import os
import shutil
import subprocess

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'cloud')
OUT_DIR = os.path.join(ROOT, 'tmp', 'cover-probe')
NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

SCREEN_W, SCREEN_H = 750, 1334
# 只影响出图大小（屏越大越慢），亮度与它无关。
SCALE = 0.42
SAND = (201, 179, 143)


def sample() -> dict:
    """跑真模型拿点阵（不在这里抄常量）。"""
    out = subprocess.run([NPX, 'tsx', 'tools/preview_battle_intro_curves.ts'], cwd=ROOT,
                         check=True, capture_output=True)
    return json.loads(out.stdout)


def load(name: str) -> Image.Image:
    return Image.open(os.path.join(ART, name + '.png')).convert('RGBA')


def composite(clouds, width, height, layers) -> Image.Image:
    """按点阵铺一屏；`layers` 是一串 (帧, 是否先铺) —— 影子层先、云体层后。"""
    canvas = Image.new('RGBA', (int(SCREEN_W * SCALE), int(SCREEN_H * SCALE)), SAND + (255,))
    for art in layers:
        if art is None:
            continue
        for cloud in clouds:
            w = max(2, int(round(width * cloud['scale'] * SCALE)))
            h = max(2, int(round(height * cloud['scale'] * SCALE)))
            patch = art.resize((w, h), Image.BILINEAR)
            if cloud['flip']:
                patch = patch.transpose(Image.FLIP_LEFT_RIGHT)
            # `alpha` 是逐帧的（下标 2 = hold 帧，全合拢）
            alpha = cloud['alpha'][2] if isinstance(cloud['alpha'], list) else 1
            if alpha < 0.999:
                table = [int(round(v * alpha)) for v in range(256)]
                patch.putalpha(patch.getchannel('A').point(table))
            cx = int(round((cloud['x'] + SCREEN_W / 2) * SCALE))
            cy = int(round((SCREEN_H / 2 - cloud['y']) * SCALE))
            canvas.alpha_composite(patch, (cx - w // 2, cy - h // 2))
    return canvas.convert('RGB')


def stats(image: Image.Image):
    px = list(image.getdata())
    mean = tuple(sum(p[i] for p in px) // len(px) for i in range(3))
    lum = sorted(int(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) for p in px)
    return mean, lum[len(lum) // 2]


def main() -> None:
    data = sample()
    cover = data['cover']
    clouds = cover['clouds']
    idle, body, shadow = load('cloud_idle_0'), load('cloud_body_0'), load('cloud_shadow_0')
    variants = [
        ('single', [idle]),
        ('body_only', [body]),
        ('two_layer', [shadow, body]),
    ]
    os.makedirs(OUT_DIR, exist_ok=True)
    print('clouds = %d, disp = %dx%d' % (len(clouds), cover['width'], cover['height']))
    for name, layers in variants:
        image = composite(clouds, cover['width'], cover['height'], layers)
        mean, median = stats(image)
        print('%-10s mean=%s  median lum=%d' % (name, mean, median))
        image.save(os.path.join(OUT_DIR, name + '.png'))
    print('参照：领地正常页 mean=(231,230,217) median=234；用户截图的灰版 mean=(147,145,136) median=144')
    print('输出：', OUT_DIR)


if __name__ == '__main__':
    main()
