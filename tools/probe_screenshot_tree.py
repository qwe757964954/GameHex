"""在用户截图上精确量「树」与「它所在格面」的相对位置。

一次性的诊断脚本（2026-10-27「树没居中」）。做法：
  ① 按颜色分出「亮绿格面」与「深绿树」两套掩码；
  ② 对深绿做连通域，取红圈里那一棵；
  ③ 对亮绿做连通域，取包围这棵树的那块格面；
  ④ 打印两者的包围盒中心 / 重心之差（屏幕像素）。

用法：python tools/probe_screenshot_tree.py <截图>
"""

import sys
from collections import deque

from PIL import Image

PATH = sys.argv[1] if len(sys.argv) > 1 else (
    r'C:\Users\Administrator\.workbuddy\clipboard-images'
    r'\clipboard-2026-10-27T10-08-58-164Z-2b861cfc.png'
)


def is_red(color):
    r, g, b = color
    return r > 185 and g < 80 and b < 90


def is_face(color):
    r, g, b = color
    return g > r + 6 and g > 150 and r > 110


def is_tree(color):
    r, g, b = color
    return g > r + 6 and 60 < g <= 150


def components(mask, width, height, min_area=40):
    seen = [[False] * width for _ in range(height)]
    out = []
    for y in range(height):
        for x in range(width):
            if seen[y][x] or not mask[y][x]:
                continue
            queue = deque([(x, y)])
            seen[y][x] = True
            pixels = []
            while queue:
                cx, cy = queue.popleft()
                pixels.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < width and 0 <= ny < height and not seen[ny][nx] and mask[ny][nx]:
                        seen[ny][nx] = True
                        queue.append((nx, ny))
            if len(pixels) >= min_area:
                out.append(pixels)
    return out


def stats(pixels):
    xs = [p[0] for p in pixels]
    ys = [p[1] for p in pixels]
    return {
        'count': len(pixels),
        'box': (min(xs), min(ys), max(xs), max(ys)),
        'center': ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2),
        'centroid': (sum(xs) / len(xs), sum(ys) / len(ys)),
    }


def main():
    image = Image.open(PATH).convert('RGB')
    width, height = image.size
    data = image.load()
    print('截图尺寸 %dx%d' % (width, height))

    red = [[is_red(data[x, y]) for x in range(width)] for y in range(height)]
    face = [[is_face(data[x, y]) for x in range(width)] for y in range(height)]
    tree = [[is_tree(data[x, y]) for x in range(width)] for y in range(height)]

    reds = components(red, width, height, min_area=200)
    if not reds:
        print('找不到红圈')
        return
    ring = max(reds, key=lambda item: len(item))
    ring_stats = stats(ring)
    print('红圈 bbox=%s 中心=%s' % (ring_stats['box'], ring_stats['center']))
    # 红圈中心往右下挪一点，落到圈里的树上（用户把树圈在圈的上半）
    seed_x, seed_y = int(ring_stats['center'][0]), int(ring_stats['center'][1])

    trees = [stats(item) for item in components(tree, width, height, min_area=200)]
    trees.sort(key=lambda item: item['count'], reverse=True)
    print('\n深绿连通域（前 5）：')
    for item in trees[:5]:
        print('  块 %4d px bbox=%s 中心=(%.1f,%.1f) 重心=(%.1f,%.1f)' % (
            item['count'], item['box'], item['center'][0], item['center'][1],
            item['centroid'][0], item['centroid'][1]))

    # 离红圈中心最近、且面积最大的一块 = 圈里那棵树（红圈本身也压住树的一部分）
    def distance(item):
        cx, cy = item['center']
        return (cx - seed_x) ** 2 + (cy - seed_y) ** 2

    candidates = [item for item in trees if distance(item) < 60 ** 2]
    if not candidates:
        print('红圈附近没有深绿块')
        return
    target = max(candidates, key=lambda item: item['count'])
    print('\n→ 圈里那棵树：bbox=%s 中心=(%.1f,%.1f) 重心=(%.1f,%.1f) 面积=%d' % (
        target['box'], target['center'][0], target['center'][1],
        target['centroid'][0], target['centroid'][1], target['count']))

    # 找"包围这棵树"的格面：中心离树最近、且面积够大的亮绿块
    faces = [stats(item) for item in components(face, width, height, min_area=400)]
    faces.sort(key=lambda item: distance(item))
    print('\n亮绿连通域（离树最近的 4 块）：')
    for item in faces[:4]:
        print('  块 %4d px bbox=%s 中心=(%.1f,%.1f)' % (
            item['count'], item['box'], item['center'][0], item['center'][1]))

    if not faces:
        return
    cell = faces[0]
    dx = target['center'][0] - cell['center'][0]
    dy = target['center'][1] - cell['center'][1]
    print('\n【树 bbox 中心 − 格面中心】 = (%+.1f, %+.1f) 屏幕px' % (dx, dy))
    gdx = target['centroid'][0] - cell['center'][0]
    gdy = target['centroid'][1] - cell['center'][1]
    print('【树 视觉重心 − 格面中心】 = (%+.1f, %+.1f) 屏幕px' % (gdx, gdy))


if __name__ == '__main__':
    main()
