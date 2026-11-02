"""把序列帧特效（火焰）按**亮度**重映射成指定色阶 —— 用来给火焰叠主题色。

为什么不用 `Sprite.color`（顶点色相乘）：相乘只能压暗通道，黄橙色火焰的红/绿已经拉满，
乘任何紫色只会变成发闷的赭红，**蓝色通道永远上不去**，出不来紫。
`Sprite.grayscale` 理论上能先把图转灰度再乘色，但本项目 0 个 `.anim` / prefab 用过，
引擎里 `USE_GRAYSCALE` 是否生效无法在离线环境验证 —— 一失效就是「火焰还是黄的」，静默翻车。
所以走美术层：保留 alpha，把 RGB 按亮度查一条紫色色阶。

色阶锚点取自火焰树妖的 Spine 贴图 `assets/resources/skel/火焰树妖/huoju.png`
（实测：高频 #4C2B68、亮紫 #CB37F5、高光 #EA91F4）。

用法：
    python tools/art/tint_effect_purple.py assets/bundles/battle/units/projectiles/火焰树妖_灼热地带技能/atlas/*.png
    python tools/art/tint_effect_purple.py --revert <同样的路径>

`--revert` 从 `--backup` 目录（默认 tmp/frame-backup-<日期>）把原图还原回去；
不用 `--backup` 时默认就备份到该目录，所以涂色是**可逆**的。
"""
import argparse
import glob
import os
import shutil
from datetime import datetime

from PIL import Image

# 亮度 → 颜色。形成「暗紫边缘 / 树妖主紫 / 亮紫 / 淡紫芯」的火。
# 顶端刻意**不拉到纯白**（#FAF0FF 会让小火苗整个芯发白、整体读成"白火"）：留一点品红，
# 火焰的小尺寸下也能一眼看出是紫的。
DEFAULT_STOPS = '0.00:#170A20,0.28:#4C2B68,0.52:#7E2CC0,0.74:#CB37F5,0.90:#E485F6,1.00:#F2C6FF'


def parse_stops(text):
    stops = []
    for chunk in text.split(','):
        position, color = chunk.split(':')
        color = color.strip().lstrip('#')
        stops.append((float(position), tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))))
    stops.sort(key=lambda item: item[0])
    if stops[0][0] != 0.0 or stops[-1][0] != 1.0:
        raise SystemExit('色阶必须从 0.00 到 1.00')
    return stops


def build_lut(stops):
    """256 项查找表：下标 = 亮度，值 = 目标 RGB。"""
    table = []
    for level in range(256):
        position = level / 255
        for index in range(len(stops) - 1):
            start_at, start_color = stops[index]
            end_at, end_color = stops[index + 1]
            if position <= end_at or index == len(stops) - 2:
                span = end_at - start_at
                k = 0 if span <= 0 else (position - start_at) / span
                k = min(1.0, max(0.0, k))
                table.append(tuple(round(a + (b - a) * k) for a, b in zip(start_color, end_color)))
                break
    return table


def tint(path, lut):
    with Image.open(path) as source:
        image = source.convert('RGBA')
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            # 亮度用 Rec.601；火焰的「亮」就是它的结构，按它映射才不会糊成一片。
            luma = (299 * r + 587 * g + 114 * b) // 1000
            tr, tg, tb = lut[luma]
            pixels[x, y] = (tr, tg, tb, a)
    image.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('files', nargs='+')
    parser.add_argument('--stops', default=DEFAULT_STOPS)
    parser.add_argument('--backup', default=None, help='原图备份目录')
    parser.add_argument('--revert', action='store_true', help='从备份还原（不改色）')
    args = parser.parse_args()

    backup = args.backup or f'tmp/frame-backup-{datetime.now().strftime("%Y%m%d")}-purple'
    lut = build_lut(parse_stops(args.stops))

    paths = []
    for pattern in args.files:
        paths.extend(sorted(glob.glob(pattern)))
    if not paths:
        raise SystemExit('没有匹配到文件')

    if args.revert:
        restored = 0
        for path in paths:
            saved = os.path.join(backup, os.path.basename(path))
            if os.path.exists(saved):
                shutil.copyfile(saved, path)
                restored += 1
        print(f'[revert] {restored}/{len(paths)} 张已从 {backup} 还原')
        return

    os.makedirs(backup, exist_ok=True)
    for path in paths:
        saved = os.path.join(backup, os.path.basename(path))
        if os.path.exists(saved):
            # 幂等：**先还原再上色**。否则第二次运行会把已经染过的图再染一遍（紫色叠紫色 → 发黑），
            # 而调用方看不出任何异常（`--stops` 换了却越调越暗，极难排查）。
            shutil.copyfile(saved, path)
        else:
            shutil.copyfile(path, saved)
        tint(path, lut)
    print(f'[tint] {len(paths)} 张 → 紫色（原图备份 {backup}）')


if __name__ == '__main__':
    main()
