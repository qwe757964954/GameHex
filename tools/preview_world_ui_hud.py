"""
世界页 UI 换「领地页 HUD 皮肤」后的对照图（只出图，不改游戏代码）。

用法：
    "C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe" tools/preview_world_ui_hud.py

产出 `docs/世界页HUD皮肤-改前改后.png`，三栏：
  ① 改前：用户给的实机截图（深铁概念顶栏 + 扁金条按钮）
  ② 改后：顶栏换成领地页语法 —— **没有通栏底板、没有标题字**，只有一张浮起来的资源卡 +
     「一键收取」3D 金钮；「基地」仍是底栏同款木牌
  ③ 改后（弹窗）：点目标时弹出**居中模态** —— 全屏暗底 + 居中深色卡 + 两颗金钮

口径全部照抄代码，改代码后重跑这张图即可复核：
  · 卡面板   = `BigMapSkin.drawBigMapCardPanel`（rim 7,7,8 2px → 卡面 72,73,83 → 金线 176,138,78 1px）
  · 暗底     = `BIGMAP_HUD_COLORS.scrim`（5,10,14,205，与领地弹窗 `Dim` 同值）
  · 按钮     = `image/main/city/btn_quick_fight`（领地页【快速寻敌】那颗，无九宫边，直接按宽度压）
  · 模式木牌 = `image/common/cu_ty_btn13` 122×96（与底部菜单栏七格同款同尺寸）

坐标按 640×1280 设计分辨率换算（截图 429×831 ⇒ 缩放 0.649），三栏底图完全相同，
所以能直接横向比差异。
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

BASE = 'C:/Users/Administrator/.workbuddy/clipboard-images/clipboard-2026-10-22T11-13-22-617Z-4f1c998b.jpg'
OUT = os.path.join('docs', '世界页HUD皮肤-改前改后.png')

RES = 'assets/resources/image'
TAB_PLATE = f'{RES}/common/cu_ty_btn13.png'
QUICK_FIGHT = f'{RES}/main/city/btn_quick_fight.png'
ICON_DIR = f'{RES}/bigmap/concept/sprites'

FONT = 'C:/Windows/Fonts/msyh.ttc'

# --- 与 `BigMapPage` 一致的常量（设计分辨率下的游戏单位）---
DESIGN_W, DESIGN_H = 640, 1280
HEADER_HEIGHT = 108
NAVIGATION_HEIGHT = 88
MODE_BUTTON_W, MODE_BUTTON_H = 122, 96

# --- 与 `BIGMAP_HUD_COLORS` 一致 ---
CARD = (72, 73, 83, 232)
CARD_DEEP = (46, 47, 55, 240)
RIM = (7, 7, 8, 255)
LINE = (176, 138, 78, 170)
CREAM = (238, 235, 214)
MUTED = (178, 176, 168)
GOLD = (245, 201, 92)
INK = (48, 34, 22)
SCRIM = (5, 10, 14, 205)

# 截图里旧顶栏的实测外框，以及底部导航条的上边界
HEADER_BOX = (7, 6, 422, 89)
MODE_BOX = (14, 767, 64, 822)
NAV_TOP = 745

SCALE = (HEADER_BOX[3] - HEADER_BOX[1]) / HEADER_HEIGHT  # ≈0.769（旧顶栏 128 高 → 新 108 高按同倍率不好套）

PAGE_W = (HEADER_BOX[2] - HEADER_BOX[0]) / SCALE


def font(size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, max(8, round(size)))


def fit_width(image: Image.Image, width: int) -> Image.Image:
    w, h = image.size
    return image.resize((max(1, width), max(1, round(h * width / w))), Image.LANCZOS)


def g2p(value: float) -> int:
    """游戏单位 → 截图像素。"""
    return round(value * SCALE)


def centered_text(draw: ImageDraw.ImageDraw, box, text: str, fill, size: float,
                  outline=None, outline_w: int = 2) -> None:
    f = font(size)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=f, stroke_width=outline_w if outline else 0)
    x = box[0] + (box[2] - box[0] - (right - left)) / 2 - left
    y = box[1] + (box[3] - box[1] - (bottom - top)) / 2 - top
    draw.text((x, y), text, font=f, fill=fill, stroke_width=outline_w if outline else 0, stroke_fill=outline)


def card_panel(layer: Image.Image, box, radius: float = 12, fill=CARD) -> None:
    """复刻 `drawBigMapCardPanel`：近黑描边 → 卡面收 2px → 铜金细线再收 2px。"""
    draw = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    r = max(0, min(radius, (y1 - y0) / 2, (x1 - x0) / 2))
    draw.rounded_rectangle((x0, y0, x1 - 1, y1 - 1), radius=r, fill=RIM)
    draw.rounded_rectangle((x0 + 2, y0 + 2, x1 - 3, y1 - 3), radius=max(0, r - 2), fill=fill)
    draw.rounded_rectangle((x0 + 4, y0 + 4, x1 - 5, y1 - 5), radius=max(0, r - 4), outline=LINE, width=1)


def gold_button(base: Image.Image, center: tuple[float, float], width: float, height: float,
                caption: str, size: float) -> None:
    """贴领地页那颗 3D 金钮（`btn_quick_fight` 无九宫边，直接按目标尺寸压）。"""
    w, h = g2p(width), g2p(height)
    art = fit_width(Image.open(QUICK_FIGHT).convert('RGBA'), w)
    if art.height != h:
        art = art.resize((w, h), Image.LANCZOS)
    base.paste(art, (round(center[0] - w / 2), round(center[1] - h / 2)), art)
    centered_text(ImageDraw.Draw(base),
                  (center[0] - w / 2, center[1] - h / 2, center[0] + w / 2, center[1] + h / 2),
                  caption, INK, size)


def patch_header(screen: Image.Image) -> Image.Image:
    """把旧的通栏顶栏抹掉：用紧邻下方的一段地图切片盖住（六边格纹理延续，看不出接缝）。"""
    out = screen.copy()
    x0, y0, x1, y1 = HEADER_BOX
    band = screen.crop((0, y1 + 6, screen.width, y1 + 6 + (y1 - y0)))
    out.paste(band, (0, y0))
    return out


def restyle(screen: Image.Image) -> Image.Image:
    out = patch_header(screen)
    draw = ImageDraw.Draw(out)
    header_cy = HEADER_BOX[1] + g2p(HEADER_HEIGHT) / 2

    # 1) 资源卡：宽度 = 页宽 - 24 - 收取钮 - 12，高 62，left 对齐
    harvest_w, harvest_h = 116, 48
    card_w = max(220, PAGE_W - 24 - harvest_w - 12)
    card_left = HEADER_BOX[0] + g2p(12)
    card_top = header_cy - g2p(62) / 2
    card_panel(out, (card_left, card_top, card_left + g2p(card_w), card_top + g2p(62)), radius=g2p(14))

    # 2) 5 个资源：等分卡宽，图标 27 / 字 22
    slot = card_w / 5
    for index, (name, text) in enumerate([('grain', '3.9K'), ('wood', '2.7K'), ('iron', '1.4K'),
                                          ('coin', '8.6K'), ('stamina', '88')]):
        cx = card_left + g2p(slot * (index + 0.5))
        icon_path = f'{ICON_DIR}/{name}.png'
        icon_size = g2p(27)
        if os.path.exists(icon_path):
            icon = fit_width(Image.open(icon_path).convert('RGBA'), icon_size)
            out.paste(icon, (round(cx - g2p(slot / 2) + g2p(20) - icon_size / 2),
                             round(header_cy - icon_size / 2)), icon)
        centered_text(draw, (cx + g2p(14) - 42, header_cy - 12, cx + g2p(14) + 42, header_cy + 12),
                      text, CREAM, 22 * SCALE, outline=RIM, outline_w=1)

    # 3) 一键收取：领地页金钮，贴右边
    gold_button(out, (HEADER_BOX[2] - g2p(12) - g2p(harvest_w / 2), header_cy),
                harvest_w, harvest_h, '一键收取', 18 * SCALE)

    # 4) 基地木牌（不变：底栏同款同尺寸）
    plate = fit_width(Image.open(TAB_PLATE).convert('RGBA'), g2p(MODE_BUTTON_W))
    px = MODE_BOX[0]
    py = NAV_TOP - 8 - plate.height
    out.paste(plate, (round(px), round(py)), plate)
    centered_text(draw, (px, py + plate.height * 0.16, px + plate.width, py + plate.height),
                  '基地', INK, 24 * SCALE, outline=(214, 190, 150), outline_w=1)
    return out


def with_modal(screen: Image.Image) -> Image.Image:
    """在「改后」上叠一层弹窗：全屏暗底 + 居中卡片（领地页 TerritorySiteDetail 的排法）。"""
    out = screen.copy()
    dim = Image.new('RGBA', out.size, (0, 0, 0, 0))
    ImageDraw.Draw(dim).rectangle((0, 0, out.width, out.height), fill=SCRIM)
    out = Image.alpha_composite(out, dim)

    panel_w = min(max(300, PAGE_W - 48), 560)
    panel_h = min(400, max(300, DESIGN_H - HEADER_HEIGHT - NAVIGATION_HEIGHT - 160))
    cx, cy = out.width / 2, out.height / 2
    box = (cx - g2p(panel_w) / 2, cy - g2p(panel_h) / 2, cx + g2p(panel_w) / 2, cy + g2p(panel_h) / 2)
    card_panel(out, box, radius=g2p(16))
    draw = ImageDraw.Draw(out)

    centered_text(draw, (box[0], box[1] + g2p(30), box[2], box[1] + g2p(64)),
                  '军团壁垒（Lv.2）', GOLD, 24 * SCALE, outline=RIM, outline_w=1)
    body = ['据点信息加载中', '战锤 / 挑战玩法本期不开放']
    for index, line in enumerate(body):
        centered_text(draw, (box[0] + g2p(28), cy - g2p(30) + index * g2p(26),
                             box[2] - g2p(28), cy - g2p(10) + index * g2p(26)),
                      line, CREAM, 15 * SCALE)
    action_y = box[3] - g2p(46)
    gold_button(out, (cx - g2p(76), action_y), 132, 52, '定位', 19 * SCALE)
    gold_button(out, (cx + g2p(76), action_y), 132, 52, '攻打', 20 * SCALE)
    return out


def tag(image: Image.Image, text: str, color) -> Image.Image:
    pad = 34
    canvas = Image.new('RGB', (image.width, image.height + pad), (16, 16, 18))
    canvas.paste(image.convert('RGB'), (0, pad))
    ImageDraw.Draw(canvas).text((10, 6), text, font=font(18), fill=color)
    return canvas


def main() -> None:
    screen = Image.open(BASE).convert('RGBA')
    after = restyle(screen)
    before_panel = tag(screen, '① 改前 · 深铁顶栏 + 扁金条按钮', (232, 132, 106))
    after_panel = tag(after, '② 改后 · HUD 卡 + 金钮（无标题字）', (140, 216, 160))
    modal_panel = tag(with_modal(after), '③ 改后 · 弹窗＝居中模态＋暗底', (255, 226, 150))

    gap = 16
    width = before_panel.width + after_panel.width + modal_panel.width + gap * 2
    height = max(before_panel.height, after_panel.height, modal_panel.height)
    canvas = Image.new('RGB', (width, height), (10, 10, 12))
    canvas.paste(before_panel, (0, 0))
    canvas.paste(after_panel, (before_panel.width + gap, 0))
    canvas.paste(modal_panel, (before_panel.width + after_panel.width + gap * 2, 0))
    os.makedirs('docs', exist_ok=True)
    canvas.save(OUT)
    print('saved', OUT, canvas.size)


if __name__ == '__main__':
    main()
