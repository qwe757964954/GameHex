"""量领地装饰图的「透明包围盒」与「像素重心」——判断建筑看起来不居中的根因。

一次性排查脚本（2026-10-27「树没居中」）。结论会写进 docs，脚本留着方便以后换图复核。

用法：
    python tools/probe_decor_centers.py
"""

import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDINGS = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'buildings')

# 69010~69013 = 装饰棕榈树1~4；69014/69015 = 树桩石块/树桩草丛（蓝圈里那个是对的）
NAMES = ['territory_decor_%02d_v1' % index for index in range(1, 13)]


def measure(name):
    path = os.path.join(BUILDINGS, name + '.png')
    meta_path = path + '.meta'
    image = Image.open(path).convert('RGBA')
    width, height = image.size
    alpha = image.getchannel('A')
    left, top, right, bottom = alpha.getbbox()

    # alpha 加权重心（"眼睛看到的中心"）
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
    centroid_x = sum_x / sum_w
    centroid_y = sum_y / sum_w

    box_center_x = (left + right) / 2
    box_center_y = (top + bottom) / 2

    meta = None
    if os.path.exists(meta_path):
        raw = json.load(open(meta_path, encoding='utf-8'))
        for item in raw.get('subMetas', {}).values():
            data = item.get('userData') or {}
            if 'trimX' in data:
                meta = data
                break

    return {
        'name': name,
        'size': (width, height),
        'bbox': (left, top, right, bottom),
        'box_vs_canvas': (box_center_x - width / 2, box_center_y - height / 2),
        'centroid_vs_box': (centroid_x - box_center_x, centroid_y - box_center_y),
        'meta': meta,
    }


def main():
    header = '%-26s %9s %16s %20s %22s' % (
        '素材', '画布', 'bbox', 'bbox中心-画布中心', 'alpha重心-bbox中心')
    print(header)
    print('-' * len(header))
    rows = []
    for name in NAMES:
        row = measure(name)
        rows.append(row)
        print('%-26s %9s %16s   (%+6.1f, %+6.1f)      (%+6.1f, %+6.1f)' % (
            row['name'],
            '%dx%d' % row['size'],
            str(row['bbox']),
            row['box_vs_canvas'][0], row['box_vs_canvas'][1],
            row['centroid_vs_box'][0], row['centroid_vs_box'][1],
        ))

    print()
    print('meta 与实测 bbox 是否一致（一致 = .meta 没坏，偏移是美术画进去的）：')
    for row in rows:
        meta = row['meta']
        if not meta:
            print('  %-26s 没有 spriteFrame 子元数据' % row['name'])
            continue
        left, top, right, bottom = row['bbox']
        # Cocos 的 trimX/trimY 是 rect 左上角；offsetX/offsetY 是可见区中心相对画布中心的位移（y 向上）
        ok_x = abs(meta['width'] - (right - left)) <= 1
        ok_y = abs(meta['height'] - (bottom - top)) <= 1
        offset_x = (left + right) / 2 - row['size'][0] / 2
        offset_y = -(top + bottom) / 2 + row['size'][1] / 2
        ok_ox = abs(meta['offsetX'] - offset_x) <= 1.5
        ok_oy = abs(meta['offsetY'] - offset_y) <= 1.5
        flag = 'OK' if (ok_x and ok_y and ok_ox and ok_oy) else 'MISMATCH'
        print('  %-26s %s  rect=%dx%d(实测 %dx%d) offset=(%d,%d)(实测 %+.1f,%+.1f)' % (
            row['name'], flag,
            meta['width'], meta['height'], right - left, bottom - top,
            meta['offsetX'], meta['offsetY'], offset_x, offset_y,
        ))


if __name__ == '__main__':
    main()
