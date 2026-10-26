"""「未解锁云」预览（画图侧）—— 三栏对照。

A  云的填充：内容层（含顶部 UI 背后那片留白）被云铺满；已解锁岛的外扩 15px 里没有云；
   **所有影子先画、所有云体后画**（四版口径：云体 / 影子是两张同画布图，影子在云体之下）。
B  被地块包围的云洞：整张图都解锁、只剩一格没开 —— 那格的云搬到顶层，**不裁剪**、每格一朵、
   缩到 `pocketScale`（三版口径②，原来那块白色六边形就是正像遮罩裁出来的）。
C  重叠对照：三朵云挤在一起，影子必须全部落在所有云体之下。

几何全部来自 `tools/preview_cloud_keepout.ts` 的导出（= 代码真源），本文件只负责合成与标注。

用法：
    python tools/preview_cloud_keepout.py              # 自己跑 tsx 现算一份（推荐）
    python tools/preview_cloud_keepout.py in.json      # 读上一份导出的 json
    npx tsx tools/preview_cloud_keepout.ts > /tmp/c.json
    python tools/preview_cloud_keepout.py /tmp/c.json
"""

import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCALE = 1.6        # 地图坐标 → 像素
PAD = 18
GAP = 16
OUT = os.path.join(ROOT, 'docs', '章节地图未解锁云-铺满背景与云洞.png')

BG = (26, 30, 36, 255)
SAND = (196, 142, 92, 255)      # 底图：露出来就说明"这里没云"
GRASS = (86, 122, 74, 255)


def load_geometry() -> dict:
    """优先用命令行给的 json 文件，否则跑 tsx 现算一份（保证与代码同源）。

    ⚠️ 别改成"stdin 有东西就读"：非交互跑（后台 / 管道）时 stdin 不是 tty 却也不会 EOF，
    `sys.stdin.read()` 会**永远挂着**（踩过：预览卡了 3 分钟一张图都没产出）。
    """
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        with open(sys.argv[1], encoding='utf-8') as handle:
            return json.load(handle)
    node = r'C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'
    script = os.path.join(ROOT, 'tools', 'preview_cloud_keepout.ts')
    raw = subprocess.check_output([node, '--import', 'tsx', script], cwd=ROOT)
    return json.loads(raw.decode('utf-8'))


def font(size: int):
    for path in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def art_sprite(path: str, scale: float) -> Image.Image:
    """读一张云图并按倍率缩放。

    云体 / 影子是**两张同画布 PNG**（`cloud_body_0` / `cloud_shadow_0`，由
    `tools/split_cloud_layers.py` 拆的）：尺寸天然一致，贴的时候用**同一个落点**就行，
    不存在任何 rect / offset 换算（三版运行时切 rect 就是在这儿翻的车）。
    """
    art = Image.open(path).convert('RGBA')
    size = (max(1, int(art.width * scale)), max(1, int(art.height * scale)))
    return art.resize(size, Image.LANCZOS)


def render(geo: dict, scenario: dict) -> Image.Image:
    """画一个场景，返回面板图（含标题）。"""
    content = geo['content']
    lift = geo['lift']
    face = geo['face']
    keep_out = geo['keepOut']
    cloud = geo['cloud']
    cells = scenario.get('cells') or []
    revealed = set(scenario.get('revealed') or [])
    pockets = set(scenario.get('pockets') or [])

    half_w = content['width'] / 2
    half_h = content['height'] / 2
    width = int(content['width'] * SCALE) + PAD * 2
    height = int(content['height'] * SCALE) + PAD * 2 + 30

    def to_px(px: float, py: float) -> tuple:
        """地图坐标（y 向上）→ 画布像素（y 向下）。"""
        return (PAD + (px + half_w) * SCALE, PAD + 30 + (half_h - py) * SCALE)

    canvas = Image.new('RGBA', (width, height), BG)
    draw = ImageDraw.Draw(canvas)

    if cells:
        # 内容层矩形 = ScrollView 能滚到的全部范围（整块都该有云，否则滚到边缘就露底图）
        draw.rectangle([to_px(-half_w, half_h), to_px(half_w, -half_h)], fill=SAND)
        for cell in cells:
            if cell['cellId'] not in revealed:
                continue
            poly = [to_px(cell['x'] + p['x'], cell['y'] + lift + p['y']) for p in face]
            draw.polygon(poly, fill=GRASS, outline=(20, 22, 26, 255))

    def build(points, scale):
        """一组云 → (影子层, 云体层)。影子层先合成、云体层后合成（= 影子在云体之下）。"""
        body = art_sprite(os.path.join(ROOT, cloud['body']), scale)
        shadow = art_sprite(os.path.join(ROOT, cloud['shadow']), scale)
        shadow_layer = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        body_layer = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        for point in points:
            px, py = to_px(point['x'], point['y'] + lift + cloud['offsetY'])
            # 体 / 影**同一个落点**：两张图同画布、同锚点。
            left = int(px - body.width / 2)
            top = int(py - body.height / 2)
            body_layer.alpha_composite(body, (left, top))
            shadow_layer.alpha_composite(shadow, (left, top))
        return shadow_layer, body_layer

    def apply_keep_out(layer):
        """**反向**遮罩：已解锁格面外扩 15px 的地方不显示云。"""
        if not cells or not revealed:
            return layer
        keep_mask = Image.new('L', (width, height), 0)
        for cell in cells:
            if cell['cellId'] not in revealed:
                continue
            poly = [to_px(cell['x'] + p['x'], cell['y'] + lift + p['y']) for p in keep_out]
            ImageDraw.Draw(keep_mask).polygon(poly, fill=255)
        alpha = layer.getchannel('A')
        layer.putalpha(Image.composite(Image.new('L', alpha.size, 0), alpha, keep_mask))
        return layer

    if scenario['key'] == 'overlap':
        points = scenario['cluster']
        shadow_layer, body_layer = build(points, cloud['scale'])
        canvas.alpha_composite(shadow_layer)
        canvas.alpha_composite(body_layer)
        for point in points:
            px, py = to_px(point['x'], point['y'] + lift)
            draw.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(255, 96, 96, 255))
    else:
        # ① 真实格里未解锁、且不是云洞的那些
        points = [
            {'x': cell['x'], 'y': cell['y']}
            for cell in cells
            if cell['cellId'] not in revealed and cell['cellId'] not in pockets
        ]
        points += scenario.get('fillPoints') or []
        shadow_layer, body_layer = build(points, cloud['scale'])
        canvas.alpha_composite(apply_keep_out(shadow_layer))
        canvas.alpha_composite(apply_keep_out(body_layer))

        # ② 云洞：顶层、不裁剪、每格一朵、缩到 pocketScale（影子同样在云体之下）
        if pockets:
            hole_points = [cell for cell in cells if cell['cellId'] in pockets]
            hole_shadow, hole_body = build(hole_points, cloud['pocketScale'])
            canvas.alpha_composite(hole_shadow)
            canvas.alpha_composite(hole_body)
            for cell in hole_points:
                px, py = to_px(cell['x'], cell['y'] + lift)
                draw.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(255, 96, 96, 255))

    ImageDraw.Draw(canvas).text((PAD, 6), scenario['title'], font=font(17), fill=(226, 232, 240, 255))
    return canvas


def main() -> None:
    geo = load_geometry()
    panels = [render(geo, scenario) for scenario in geo['scenarios']]
    width = sum(panel.width for panel in panels) + GAP * (len(panels) - 1)
    height = max(panel.height for panel in panels)
    sheet = Image.new('RGBA', (width, height), BG)
    x = 0
    for panel in panels:
        sheet.alpha_composite(panel, (x, 0))
        x += panel.width + GAP
    sheet.convert('RGB').save(OUT, quality=95)
    print(OUT)


if __name__ == '__main__':
    main()
