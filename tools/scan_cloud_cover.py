# -*- coding: utf-8 -*-
"""扫「用云体铺满整屏」的参数：显示倍率 / 间距。

只看一件事：**合成不透明度**（1 - Π(1 - aᵢ)），也就是"地图透出来多少"。
纯 PIL，逐点算，不依赖 numpy。

⚠️ 美术必须是**云体** `cloud_body_0`：`cloud_idle_*` 是「云体 + 影子」的合并图，
   影子那圈纯黑低 alpha 会把覆盖率算高一点点，但画面上是灰的（见 `TerritoryBattleCover`
   类注释）。2026-11-02 晚上第五版起盖层只用云体。

⚠️ 这里的点阵与 `assets/script/app/territory/model/TerritoryBattleIntro.ts` 的
   `territoryBattleIntroCoverPuffs` **必须逐字段一致**（位置抖动 / 倍率 / 浓度 / 镜像，
   连 seed 的偏移量都一样）—— 差一个常数，本工具报出来的覆盖率就不代表实机。
   改了模型那边，先回来把 `puffs()` / `scale_of()` 对齐，再重扫。

用法：
    python tools/scan_cloud_cover.py            # 扫下面 GRID 里的组合
    python tools/scan_cloud_cover.py 260 107 94 # 单点：显示宽 / 间距x / 间距y
"""
import math
import sys
from PIL import Image

ART = 'assets/resources/image/territory/cloud/cloud_body_0.png'
SCREEN_W, SCREEN_H = 1080, 1920
MARGIN = 160
SAMPLE = 30

# 与模型里那份常量一一对应
SCALE_MIN = 0.90
SCALE_MAX = 1.12
ALPHA_MIN, ALPHA_MAX = 0.95, 1.0
JITTER = 0.30
STAGGER = 0.5

im = Image.open(ART).convert('RGBA')
apx = im.split()[3].load()
AW, AH = im.size


def noise(a, b):
    raw = math.sin(a * 12.9898 + b * 78.233) * 43758.5453
    return raw - math.floor(raw)


def scale_of(r, c):
    """与模型一致：窄区间均匀取（0.90~1.12）。"""
    return SCALE_MIN + (SCALE_MAX - SCALE_MIN) * noise(r + 17, c + 23)


def puffs(w, h, gap_x, gap_y, margin):
    out = []
    half_w = w / 2 + margin
    half_h = h / 2 + margin
    cols = int(math.ceil(half_w * 2 / gap_x)) + 1
    rows = int(math.ceil(half_h * 2 / gap_y)) + 1
    start_x = -((cols - 1) * gap_x) / 2
    start_y = -((rows - 1) * gap_y) / 2
    sa = ALPHA_MAX - ALPHA_MIN
    for r in range(rows):
        shift = (r % 2) * gap_x * 0.5
        for c in range(cols):
            out.append({
                'x': start_x + c * gap_x + shift + (noise(r * 3 + 1, c * 5 + 2) - 0.5) * gap_x * JITTER,
                'y': start_y + r * gap_y + (noise(c * 7 + 3, r * 11 + 4) - 0.5) * gap_y * JITTER,
                'scale': scale_of(r, c),
                'alpha': ALPHA_MIN + sa * noise(c + 31, r + 37),
                'delay': STAGGER * noise(r + 41, c + 43),
                'flip': noise(r + 59, c + 61) > 0.5,
            })
    return out


def coverage(ps, disp_w, disp_h):
    pts = []
    for gy in range(-SCREEN_H // 2, SCREEN_H // 2 + 1, SAMPLE):
        for gx in range(-SCREEN_W // 2, SCREEN_W // 2 + 1, SAMPLE):
            pts.append((gx, gy))
    total = [0.0] * len(pts)
    for p in ps:
        s = p['scale']
        w = disp_w * s
        h = disp_h * s
        halfw, halfh = w / 2, h / 2
        x0, y0 = p['x'], p['y']
        a_scale = p['alpha']
        flip = p['flip']
        for i, (px, py) in enumerate(pts):
            dx = px - x0
            dy = py - y0
            if dx < -halfw or dx > halfw or dy < -halfh or dy > halfh:
                continue
            u = (dx + halfw) / w
            if flip:
                u = 1 - u
            v = 1 - (dy + halfh) / h  # 屏幕 y 向上，贴图 y 向下
            tx = min(AW - 1, max(0, int(u * AW)))
            ty = min(AH - 1, max(0, int(v * AH)))
            a = apx[tx, ty] / 255.0 * a_scale
            if a <= 0:
                continue
            total[i] = total[i] + (1 - total[i]) * a
    lo = min(total)
    avg = sum(total) / len(total)
    ge90 = sum(1 for t in total if t >= 0.9) / len(total)
    ge70 = sum(1 for t in total if t >= 0.7) / len(total)
    return lo, avg, ge90, ge70


def run(disp_w, gx, gy):
    disp_h = disp_w * 240.0 / 200.0
    ps = puffs(SCREEN_W, SCREEN_H, gx, gy, MARGIN)
    lo, avg, ge90, ge70 = coverage(ps, disp_w, disp_h)
    print('disp_w=%d gap=(%d,%d) -> 团数=%d 最低=%.3f 平均=%.3f >=0.9占%.2f'
          % (disp_w, gx, gy, len(ps), lo, avg, ge90))
    sys.stdout.flush()


if len(sys.argv) >= 4:
    run(int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]))
    raise SystemExit(0)

# (显示宽, 间距x, 间距y)  —— 间距按"占显示宽的比例"给：0.41 / 0.30（与 400 宽那版同密度）
GRID = [
    (240, 98, 86),
    (260, 107, 94),
    (280, 115, 101),
    (240, 94, 83),
    (260, 102, 90),
]

for row in GRID:
    run(*row)
