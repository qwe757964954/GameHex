"""领地关卡气泡底色的对照图（只出图，不动游戏代码）。

用法：`python tools/preview_territory_bubble.py` → `tools/ref/territory-bubble-frames.png`

口径照抄代码：
  · 已通关 = 蓝 `assets/bundles/battle/image/spawn-region/frame_03.png`
  · 未通关 = 红 `assets/bundles/battle/image/spawn-region/frame_02.png`
  · 气泡节点 88×45（`MAP_MARKER_BADGE_WIDTH` × `MAP_MARKER_BUBBLE_HEIGHT`），图原生 94×45，
    SLICED 九宫（左右边角各 28 / 上下边角各 28），中间一列被压 6px。这里直接按 88×45 缩放近似，
    细节差别只在边角弧度，判色 / 看字够用。
  · 文字 17 号加粗白字 + 3px 黑描边（`MAP_MARKER_BADGE_*`），局部 y=+5 给底部小尾巴让位。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BUBBLE_DIR = ROOT / "assets/bundles/battle/image/spawn-region"
FONT = "C:/Windows/Fonts/msyhbd.ttc"
FALLBACK_FONT = "C:/Windows/Fonts/msyh.ttc"

BUBBLE_W, BUBBLE_H = 88, 45
FONT_SIZE = 17
OUTLINE_W = 3
TEXT_Y = 5  # 向上为正（game 坐标），下面绘制时取反

CASES = [
    ("frame_03", "已通关", "1-2"),
    ("frame_02", "未通关", "1-2"),
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in (FONT, FALLBACK_FONT):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render(path: Path, text: str) -> Image.Image:
    art = Image.open(path).convert("RGBA").resize((BUBBLE_W, BUBBLE_H), Image.LANCZOS)
    canvas = Image.new("RGBA", (BUBBLE_W, BUBBLE_H), (0, 0, 0, 0))
    canvas.alpha_composite(art)

    # 放大 4 倍画字再缩回来，边缘才不毛糙（Cocos 那边是引擎自己抗锯齿）。
    scale = 4
    big = Image.new("RGBA", (BUBBLE_W * scale, BUBBLE_H * scale), (0, 0, 0, 0))
    big.alpha_composite(canvas.resize((BUBBLE_W * scale, BUBBLE_H * scale), Image.LANCZOS))
    draw = ImageDraw.Draw(big)
    font = load_font(FONT_SIZE * scale)
    draw.text((BUBBLE_W * scale / 2, (BUBBLE_H / 2 - TEXT_Y) * scale), text, font=font,
              fill=(255, 255, 255, 255), anchor="mm",
              stroke_width=OUTLINE_W * scale, stroke_fill=(8, 8, 8, 255))
    return big.resize((BUBBLE_W, BUBBLE_H), Image.LANCZOS)


def main() -> None:
    pad, gap, label_h = 18, 34, 28
    font = load_font(14)
    probe = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    captions = [f"{caption} · {name}" for name, caption, _ in CASES]
    # 每格宽度取「气泡宽」与「标题宽」的较大值，标题才不会压到隔壁
    cell_w = [max(BUBBLE_W, probe.textlength(c, font=font)) for c in captions]
    total_w = round(pad * 2 + sum(cell_w) + gap * (len(CASES) - 1))
    strip = Image.new("RGBA", (total_w, BUBBLE_H + pad * 2 + label_h), (58, 56, 48, 255))
    draw = ImageDraw.Draw(strip)
    x = pad
    for index, (name, caption, text) in enumerate(CASES):
        center = x + cell_w[index] / 2
        strip.alpha_composite(render(BUBBLE_DIR / f"{name}.png", text),
                              (round(center - BUBBLE_W / 2), pad))
        draw.text((center, pad + BUBBLE_H + label_h / 2 - 2), captions[index],
                  font=font, fill=(236, 232, 214, 255), anchor="mm")
        x += cell_w[index] + gap
    out = ROOT / "tools/ref/territory-bubble-frames.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    strip.resize((total_w * 3, strip.height * 3), Image.LANCZOS).save(out)
    print(f"written {out}")


if __name__ == "__main__":
    main()
