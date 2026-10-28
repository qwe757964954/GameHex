"""把装饰建筑按**运行时真实比例**叠进一块真地皮，检查"看起来居中没"。

为什么需要它：`applyIconPlacement` 对齐的是**透明包围盒中心**，而"人眼觉得居中"看的是
**视觉重心**。两者对树这种"树冠大、树干细"的东西差得很远（decor_03 差 25px），
对树桩那种扁平对称的东西几乎不差 —— 所以截图里"树歪、树桩正"。

比例口径（与 `TerritoryStationView.applyIconPlacement` 逐项一致）：
    可见宽 = 84（`BUILDING_VISIBLE_WIDTH`）× buildSize
    scale  = 可见宽 / 该图 trim 后的可见宽
落点：可见区中心压在**格面中心**（`HEX_GRID_CONTENT_LIFT = 12.5` 已经把地皮图心抬到格面中心）。

输出 `docs/章节地图装饰建筑对位.png`。
"""

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDINGS = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'buildings')
LAND = os.path.join(ROOT, 'assets', 'resources', 'image', 'buildings', 'img_land_01.png')
CONFIG = os.path.join(os.path.dirname(ROOT), 'doc', '塔防数据配置', 'json', 'client', 'build.json')
# 三种锚点口径：
#   center —— 包围盒中心压格心（默认/历史口径）
#   bottom —— 全部按可见底边压格心（2026-10-27 第一版）
#   rules  —— **线上真实规则**：只有白名单走底部对齐，其余居中，且底部对齐再往下修 DROP 像素
ANCHOR = 'rules' if 'rules' in sys.argv else ('bottom' if 'bottom' in sys.argv else 'center')
OUT_NAME = {
    'rules': '章节地图装饰建筑对位-线上规则.png',
    'bottom': '章节地图装饰建筑对位-底部对齐.png',
}.get(ANCHOR, '章节地图装饰建筑对位.png')
OUT = os.path.join(ROOT, 'docs', OUT_NAME)

# 🔴 与 `TerritoryStationView` 必须同值（那边是唯一真源）：
#   `TERRITORY_BOTTOM_ANCHOR_BUILD_IDS` / `TERRITORY_BOTTOM_ANCHOR_DROP_PX`
BOTTOM_ANCHOR_IDS = frozenset((69010, 69011, 69012, 69013))
BOTTOM_ANCHOR_DROP = 4

VISIBLE_WIDTH = 84          # `TerritoryStationView.BUILDING_VISIBLE_WIDTH`
FACE_WIDTH = 123            # `HEX_GRID_FACE_WIDTH`
FACE_HEIGHT = 90            # `HEX_GRID_FACE_HEIGHT`
NODE_SIZE = 128             # prefab 里 `Icon` 的 contentSize
ZOOM = 2                    # 只是放大看清楚
CELL = 200                  # 每格画板边长（缩放前的地图像素）
PAD = 26
COLS = 4
FOOT = 34


def load_meta(name):
    raw = json.load(open(os.path.join(BUILDINGS, name + '.png.meta'), encoding='utf-8'))
    for item in raw.get('subMetas', {}).values():
        data = item.get('userData') or {}
        if 'trimX' in data:
            return data
    raise SystemExit('没有 spriteFrame 子元数据：' + name)


def main():
    configs = json.load(open(CONFIG, encoding='utf-8'))
    rows = []
    for entry in configs:
        name = entry['buildresource'].split('/')[-1]
        if not name.startswith('territory_decor'):
            continue
        rows.append((entry['buildId'], name, float(entry['buildSize'])))

    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 14)
    except OSError:
        font = ImageFont.load_default()

    land = Image.open(LAND).convert('RGBA')
    # 地皮图锚在整图中心；格面中心比图心高 `HEX_GRID_CONTENT_LIFT`
    lift = 12.5
    grid_rows = (len(rows) + COLS - 1) // COLS
    canvas = Image.new('RGBA', (COLS * CELL * ZOOM, grid_rows * (CELL * ZOOM + FOOT) + PAD), (243, 243, 246, 255))
    draw = ImageDraw.Draw(canvas)

    for index, (build_id, name, size) in enumerate(rows):
        meta = load_meta(name)
        visible_width = meta['width'] * NODE_SIZE / meta['rawWidth']
        scale = (VISIBLE_WIDTH / visible_width) * size

        cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
        cx, cy = CELL / 2, CELL / 2

        # ① 地皮：图心放在「格面中心 + lift」处
        tile = land.resize((int(land.width * 1), int(land.height * 1)), Image.LANCZOS)
        cell.alpha_composite(tile, (int(cx - tile.width / 2), int(cy + lift * 1 - tile.height / 2)))

        # ② 建筑：可见区中心压在格面中心（= 代码里那套 trim 补偿的净效果）
        art = Image.open(os.path.join(BUILDINGS, name + '.png')).convert('RGBA')
        left, top, right, bottom = art.getchannel('A').getbbox()
        art = art.crop((left, top, right, bottom))
        scaled = art.resize((max(1, int(round(art.width * scale))), max(1, int(round(art.height * scale)))),
                            Image.LANCZOS)
        # 三种锚点：center = 可见区中心压格心；bottom = 可见区**底边**压格心；
        # rules = 按线上白名单逐张判定，底部对齐那一档再往下修 DROP（`+y` 向下）。
        use_bottom = ANCHOR == 'bottom' or (ANCHOR == 'rules' and build_id in BOTTOM_ANCHOR_IDS)
        if use_bottom:
            origin_y = cy - scaled.height + BOTTOM_ANCHOR_DROP
            label_anchor = 'bottom-%.0f' % BOTTOM_ANCHOR_DROP if BOTTOM_ANCHOR_DROP else 'bottom'
        else:
            origin_y = cy - scaled.height / 2
            label_anchor = 'center'
        cell.alpha_composite(scaled, (int(round(cx - scaled.width / 2)), int(round(origin_y))))

        # ③ 参考线：格面六边形 + 中心十字（白线 = 人眼该觉得"居中"的地方）
        hw, hh, qw = FACE_WIDTH / 2, FACE_HEIGHT / 2, FACE_WIDTH / 4
        hexagon = [(cx + hw, cy), (cx + qw, cy - hh), (cx - qw, cy - hh),
                   (cx - hw, cy), (cx - qw, cy + hh), (cx + qw, cy + hh)]
        ImageDraw.Draw(cell).polygon(hexagon, outline=(255, 255, 255, 210))
        pen = ImageDraw.Draw(cell)
        pen.line([(cx - 12, cy), (cx + 12, cy)], fill=(255, 255, 255, 235), width=1)
        pen.line([(cx, cy - 12), (cx, cy + 12)], fill=(255, 255, 255, 235), width=1)

        cell = cell.resize((CELL * ZOOM, CELL * ZOOM), Image.LANCZOS)
        col, row = index % COLS, index // COLS
        x0 = col * CELL * ZOOM
        y0 = row * (CELL * ZOOM + FOOT) + PAD
        canvas.alpha_composite(cell, (x0, y0))
        draw.rectangle([x0, y0, x0 + CELL * ZOOM - 1, y0 + CELL * ZOOM - 1], outline=(190, 190, 200, 255))
        draw.text((x0 + 6, y0 + CELL * ZOOM + 4),
                  '%d %s  bs=%s %s' % (build_id, name.replace('territory_', '').replace('_v1', ''), size,
                                       label_anchor if ANCHOR == 'rules' else ANCHOR),
                  fill=(30, 30, 30, 255), font=font)

    canvas.save(OUT)
    if ANCHOR == 'rules':
        print('白名单（底部对齐）:', sorted(BOTTOM_ANCHOR_IDS), ' 往下修:', BOTTOM_ANCHOR_DROP, 'px')
    print('saved', OUT)


if __name__ == '__main__':
    main()
