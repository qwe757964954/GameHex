"""把【基地 / 大地图】按钮按真实像素合成一张预览图，不启动引擎就能看观感。

尺寸全部照抄 `MainTaskEntry.prefab`（任务按钮）：底板 111×79 @ y-7.5、图标 79×71 @ y+11.5、
Label 在底部 y-25（22 号粗体、白色、2px 黑描边）。模式按钮节点 122×96，比任务按钮宽 9px。

用法：`python tools/preview_mode_button.py`  → `tools/ref/mode_button_preview.png`
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets/resources/image"
TASK_BG = ASSETS / "main/hud/hud_task_tab.png"
TASK_ICON = ASSETS / "main/hud/hud_task_icon.png"
BASE_ICON = ASSETS / "main/city/nav_territory.png"
WORLD_ICON = ASSETS / "main/hud/hud_mode_world.png"

BUTTON_W, BUTTON_H = 122, 96
BG_W, BG_H = 111, 79
ICON_W, ICON_H = 79, 71
# 游戏里是 `fitBigMapSprite(icon, frame, 79)`：按宽度 79 等比缩放；这里同样只按宽度卡。
FONT_SIZE = 22
OUTLINE = 2

FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
]


def find_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def place(canvas: Image.Image, art: Image.Image, center_x: float, center_y: float, w: int, h: int) -> None:
    """按 `center_x/center_y`（画布坐标）把 art 缩放并贴上；`w` 是目标宽度，高度按比例走。"""
    scale = w / art.width if art.width >= art.height else min(w / art.width, h / art.height)
    size = (max(1, round(art.width * scale)), max(1, round(art.height * scale)))
    resized = art.resize(size, Image.LANCZOS)
    canvas.alpha_composite(resized, (round(center_x - size[0] / 2), round(center_y - size[1] / 2)))


def outlined_text(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, font, fill, stroke, width: int) -> None:
    x, y = xy
    for dx in range(-width, width + 1):
        for dy in range(-width, width + 1):
            if dx * dx + dy * dy > width * width:
                continue
            draw.text((x + dx, y + dy), text, font=font, fill=stroke, anchor="mm")
    draw.text((x, y), text, font=font, fill=fill, anchor="mm")


def render_button(label: str, icon_path: Path) -> Image.Image:
    canvas = Image.new("RGBA", (BUTTON_W, BUTTON_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    # 按钮节点中心 = (BUTTON_W/2, BUTTON_H/2)；prefab 里的 y 是「相对节点中心、向上为正」。
    cx, cy = BUTTON_W / 2, BUTTON_H / 2
    place(canvas, Image.open(TASK_BG).convert("RGBA"), cx, cy + 7.5, BG_W, BG_H)
    place(canvas, Image.open(icon_path).convert("RGBA"), cx, cy - 11.5, ICON_W, ICON_H)
    font = find_font(FONT_SIZE)
    outlined_text(draw, (cx, cy + 25), label, font, (255, 255, 255, 255), (10, 8, 6, 255), OUTLINE)
    return canvas


def main() -> None:
    gap = 28
    stages = [("基地", BASE_ICON), ("大地图", WORLD_ICON), ("任务", TASK_ICON)]
    width = gap + sum(BUTTON_W + gap for _ in stages)
    strip = Image.new("RGBA", (width, BUTTON_H + gap * 2), (46, 44, 40, 255))
    for index, (label, icon) in enumerate(stages):
        art = render_button(label, icon if label != "任务" else TASK_ICON)
        strip.alpha_composite(art, (gap + index * (BUTTON_W + gap), gap))
    out = ROOT / "tools/ref/mode_button_preview.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    strip.resize((width * 2, (BUTTON_H + gap * 2) * 2), Image.LANCZOS).save(out)
    print(f"written {out}")


if __name__ == "__main__":
    main()
