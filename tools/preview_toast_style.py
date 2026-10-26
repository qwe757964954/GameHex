"""Toast 底框样式预览（对齐主界面聊天条）—— 三栏对照图。

左  参考：主 HUD 底部聊天条原图（`image/main/hud/hud_chat_bar.png`，700×44）
中  改前：430×100、不透明深藏青 `#1D313F`、24 号粗体纯白
右  改后：430×56、`rgba(0,0,0,153)`（60% 黑）、24 号粗体 **白 @ alpha 145**、字距 0.24、微软雅黑

三块都贴在**同一张深色背景**上：半透明底框只有在有底图时才看得出"透"，纯色预览会骗人。
底图是程序画的（深绿地 + 几块浅色六边形/土块），只为让透明度可读，不是任何真实截图。

数值真源在 `assets/script/app/common/Toast.ts` 的 @property 与
`assets/resources/ui/main/ArenaRoot.prefab` 的 `ChatBar/ChatMsg`，本脚本只是照它画。

用法：
    python tools/preview_toast_style.py
输出：
    docs/Toast样式-对齐聊天条.png
"""

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAT_BAR = os.path.join(ROOT, 'assets', 'resources', 'image', 'main', 'hud', 'hud_chat_bar.png')
OUT = os.path.join(ROOT, 'docs', 'Toast样式-对齐聊天条.png')

TEXT = '前置领地尚未占领'
FONT_PATH = r'C:\Windows\Fonts\msyh.ttc'

# 改前（Toast.ts 旧默认）
OLD = dict(width=430, height=100, radius=12, fill=(29, 49, 63, 255), color=(255, 255, 255, 255), spacing=0.0)
# 改后（对齐聊天条 ChatBar/ChatMsg）
NEW = dict(width=430, height=56, radius=12, fill=(0, 0, 0, 153), color=(255, 255, 255, 145), spacing=0.24)

PANEL_W = 760
PANEL_H = 300
GAP = 14
TITLE_H = 34


def font(size: int):
    for path in (FONT_PATH, r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def backdrop(size: tuple) -> Image.Image:
    """假地图底图：深绿地 + 几块浅色块面（够看出半透明就行）。"""
    w, h = size
    image = Image.new('RGBA', size, (46, 78, 52, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, int(h * 0.62), w, h], fill=(122, 96, 58, 255))
    for index, (cx, cy, r) in enumerate(((120, 90, 46), (300, 200, 38), (520, 120, 52), (680, 220, 34))):
        tint = (196, 214, 168, 255) if index % 2 == 0 else (86, 122, 74, 255)
        draw.regular_polygon((cx, cy, r), 6, rotation=30, fill=tint, outline=(28, 40, 30, 255))
    return image


def rounded(size: tuple, radius: int, fill: tuple) -> Image.Image:
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill)
    return layer


def text_layer(text: str, size_px: int, color: tuple, spacing: float) -> Image.Image:
    """逐字排版：PIL 没有字距参数，只能一个字一个字挪。"""
    face = font(size_px)
    widths = [face.getlength(char) for char in text]
    total = sum(widths) + spacing * (len(text) - 1)
    height = int(size_px * 1.4)
    layer = Image.new('RGBA', (int(total) + 4, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x = 0.0
    for char, width in zip(text, widths):
        draw.text((x, 0), char, font=face, fill=color)
        x += width + spacing
    return layer


def panel(shot: dict, title: str, bar: Image.Image | None = None) -> Image.Image:
    canvas = backdrop((PANEL_W, PANEL_H))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, 0, PANEL_W, TITLE_H], fill=(18, 22, 28, 255))
    draw.text((12, 8), title, font=font(17), fill=(226, 232, 240, 255))

    if bar is not None:
        # 参考栏：直接用聊天条原图（700×44），并叠上**同款文字** ——
        # 只放一条光底框是没法比"字"的，要字对字才看得出是否一致。
        left = (PANEL_W - bar.width) // 2
        top = (PANEL_H + TITLE_H) // 2 - bar.height // 2
        canvas.alpha_composite(bar, (left, top))
        label = text_layer(TEXT, 24, NEW['color'], NEW['spacing'])
        canvas.alpha_composite(label, (left + (bar.width - label.width) // 2, top + (bar.height - label.height) // 2))
        return canvas

    width, height = shot['width'], shot['height']
    left = (PANEL_W - width) // 2
    top = (PANEL_H + TITLE_H) // 2 - height // 2
    canvas.alpha_composite(rounded((width, height), shot['radius'], shot['fill']), (left, top))

    label = text_layer(TEXT, 24, shot['color'], shot['spacing'])
    canvas.alpha_composite(label, (left + (width - label.width) // 2, top + (height - label.height) // 2))
    return canvas


def main() -> None:
    chat = Image.open(CHAT_BAR).convert('RGBA')
    panels = [
        panel(NEW, '① 参考：主 HUD 聊天条（700×44 · 60% 黑）+ 同款文字', bar=chat),
        panel(OLD, '② 改前 Toast（430×100 · #1D313F 不透明 · 纯白）'),
        panel(NEW, '③ 改后 Toast（430×56 · 60% 黑 · 白 @145 · 字距 0.24）'),
    ]
    width = sum(item.width for item in panels) + GAP * (len(panels) - 1)
    height = max(item.height for item in panels)
    sheet = Image.new('RGBA', (width, height), (12, 14, 18, 255))
    x = 0
    for item in panels:
        sheet.alpha_composite(item, (x, 0))
        x += item.width + GAP
    sheet.convert('RGB').save(OUT, quality=95)
    print(OUT)


if __name__ == '__main__':
    main()
