"""把 12 张领地装饰图按同一比例排成对照表，并画出三个"中心"：

- 白十字 = 画布中心
- 红十字 = **alpha 包围盒中心**（= 代码实际对齐到格心的那个点）
- 黄点   = alpha 加权重心（"眼睛看到的中心"）

用途：一眼看出"某个装饰是不是天生重心偏移"，别再靠截图猜。
输出 `docs/装饰建筑视觉重心.png`。
"""

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDINGS = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'buildings')
OUT = os.path.join(ROOT, 'docs', '装饰建筑视觉重心.png')

NAMES = ['territory_decor_%02d_v1' % index for index in range(1, 13)]
CELL = 220
PAD = 30
COLS = 4
FOOT = 30


def measure(name):
    image = Image.open(os.path.join(BUILDINGS, name + '.png')).convert('RGBA')
    width, height = image.size
    alpha = image.getchannel('A')
    left, top, right, bottom = alpha.getbbox()
    pixels = alpha.load()
    sum_x = sum_y = sum_w = 0.0
    for y in range(height):
        for x in range(width):
            weight = pixels[x, y]
            if not weight:
                continue
            sum_x += x * weight
            sum_y += y * weight
            sum_w += weight
    box = ((left + right) / 2, (top + bottom) / 2)
    centroid = (sum_x / sum_w, sum_y / sum_w)
    return image, box, centroid


def cross(draw, x, y, size, color, width=2):
    draw.line([(x - size, y), (x + size, y)], fill=color, width=width)
    draw.line([(x, y - size), (x, y + size)], fill=color, width=width)


def main():
    rows = (len(NAMES) + COLS - 1) // COLS
    canvas = Image.new('RGBA', (COLS * CELL, rows * (CELL + FOOT) + PAD), (245, 245, 248, 255))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)
    except OSError:
        font = ImageFont.load_default()

    for index, name in enumerate(NAMES):
        image, box, centroid = measure(name)
        image = image.resize((CELL, CELL), Image.LANCZOS)
        col = index % COLS
        row = index // COLS
        x0 = col * CELL
        y0 = row * (CELL + FOOT) + PAD
        canvas.alpha_composite(image, (x0, y0))

        scale = CELL / 212
        cx, cy = x0 + CELL / 2, y0 + CELL / 2
        bx, by = x0 + box[0] * scale, y0 + box[1] * scale
        gx, gy = x0 + centroid[0] * scale, y0 + centroid[1] * scale

        draw.rectangle([x0, y0, x0 + CELL - 1, y0 + CELL - 1], outline=(180, 180, 190, 255))
        cross(draw, cx, cy, 16, (255, 255, 255, 220), 3)
        cross(draw, bx, by, 9, (220, 40, 40, 255), 2)
        draw.ellipse([gx - 5, gy - 5, gx + 5, gy + 5], fill=(255, 210, 0, 255))
        draw.text((x0 + 6, y0 + CELL + 4),
                  '%s  (%+.1f,%+.1f) / (%+.1f,%+.1f)' % (
                      name.replace('territory_', '').replace('_v1', ''),
                      box[0] - 106, box[1] - 106, centroid[0] - box[0], centroid[1] - box[1]),
                  fill=(30, 30, 30, 255), font=font)

    canvas.save(OUT)
    print('saved', OUT)


if __name__ == '__main__':
    main()
