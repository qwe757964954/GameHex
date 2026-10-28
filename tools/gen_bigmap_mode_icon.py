"""生成【大地图】模式按钮的卡通图标（`hud_mode_world.png`）。

为什么是脚本画的：项目里没有任何「地图 / 卷轴 / 罗盘」类图标（`find` 过 world/map/globe/compass/scroll
全是地形贴图），而【基地】那颗能直接复用 `image/main/city/nav_territory.png`（石堡城门，同一套粗描边
卡通）。为了两张图能并排放在基地/大地图按钮上不打架，这里按 `hud_task_icon.png` 的画法画：
厚描边（近黑 #2A2018）+ 平涂 + 一档暗面，不画高光不画渐变。

画法：4 倍超采样后 LANCZOS 缩到 128×128，之后交给 Cocos 按需缩放（按钮上显示 ≈74px）。

用法：`python tools/gen_bigmap_mode_icon.py`
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from PIL import Image, ImageDraw

SS = 4  # 超采样倍数
SIZE = 128  # 最终边长
CANVAS = SIZE * SS

OUTLINE = (42, 32, 24, 255)  # 近黑描边，和 hud_task_icon 的外框同色系
PAPER_LIGHT = (240, 221, 180, 255)
PAPER_MID = (220, 196, 149, 255)
FOLD_LINE = (196, 172, 124, 255)
ROUTE = (168, 99, 44, 255)
MARK_RED = (216, 69, 58, 255)
MARK_RED_DARK = (150, 40, 33, 255)
MOUNTAIN = (150, 138, 116, 255)
MOUNTAIN_SHADE = (122, 110, 92, 255)
SNOW = (245, 240, 230, 255)


def s(value: float) -> float:
    """把 128 坐标系换算到超采样画布。"""
    return value * SS


def pts(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    return [(s(x), s(y)) for x, y in points]


def polygon(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], fill: tuple[int, ...]) -> None:
    draw.polygon(pts(points), fill=fill)


def line(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], color: tuple[int, ...], width: float) -> None:
    draw.line(pts(points), fill=color, width=int(s(width)), joint="curve")


def bezier(p0, p1, p2, t: float) -> tuple[float, float]:
    x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
    y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
    return x, y


def dashed_route(draw: ImageDraw.ImageDraw, p0, p1, p2, dash: float, gap: float, width: float) -> None:
    """沿二次贝塞尔按弧长打虚线 —— 折页地图上那条「行军路线」。"""
    steps = 600
    path = [bezier(p0, p1, p2, i / steps) for i in range(steps + 1)]
    drawing = True
    remain = dash
    segment: list[tuple[float, float]] = [path[0]]
    for i in range(1, len(path)):
        a, b = path[i - 1], path[i]
        seg_len = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        remain -= seg_len
        segment.append(b)
        if remain <= 0:
            if drawing and len(segment) > 1:
                line(draw, segment, ROUTE, width)
            drawing = not drawing
            remain = dash if drawing else gap
            segment = [b]
    if drawing and len(segment) > 1:
        line(draw, segment, ROUTE, width)


def write_meta(png: Path, width: int, height: int) -> None:
    """写 Cocos 的 `.png.meta`。

    为什么要手写：新图没有 meta 时编辑器会按默认设置导入（`trimType: auto`），
    而 `auto` 会算出 trim 偏移写回 meta —— 运行时 `Sprite` 用 `CUSTOM` 尺寸贴图，
    偏移一有值图标就会歪半个像素。这里直接钉成 `trimType: none + offset 0`，
    PNG 自己在脚本里已经裁到内容包围盒，不需要再 trim。
    """
    uid = str(uuid.uuid4())
    half_w, half_h = width / 2, height / 2
    meta = {
        "ver": "1.0.27", "importer": "image", "imported": True, "uuid": uid,
        "files": [".json", ".png"],
        "subMetas": {
            "6c48a": {
                "importer": "texture", "uuid": f"{uid}@6c48a", "displayName": png.stem, "id": "6c48a",
                "name": "texture",
                "userData": {
                    "wrapModeS": "clamp-to-edge", "wrapModeT": "clamp-to-edge",
                    "minfilter": "linear", "magfilter": "linear", "mipfilter": "none", "anisotropy": 0,
                    "isUuid": True, "imageUuidOrDatabaseUri": uid, "visible": False,
                },
                "ver": "1.0.22", "imported": True, "files": [".json"], "subMetas": {},
            },
            "f9941": {
                "importer": "sprite-frame", "uuid": f"{uid}@f9941", "displayName": png.stem, "id": "f9941",
                "name": "spriteFrame",
                "userData": {
                    "trimThreshold": 1, "rotated": False, "offsetX": 0, "offsetY": 0, "trimX": 0, "trimY": 0,
                    "width": width, "height": height, "rawWidth": width, "rawHeight": height,
                    "borderTop": 0, "borderBottom": 0, "borderLeft": 0, "borderRight": 0,
                    "packable": True, "pixelsToUnit": 100, "pivotX": 0.5, "pivotY": 0.5, "meshType": 0,
                    "vertices": {
                        "rawPosition": [-half_w, -half_h, 0, half_w, -half_h, 0,
                                        -half_w, half_h, 0, half_w, half_h, 0],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, height, width, height, 0, 0, width, 0],
                        "nuv": [0, 0, 1, 0, 0, 1, 1, 1],
                        "minPos": [-half_w, -half_h, 0], "maxPos": [half_w, half_h, 0],
                    },
                    "isUuid": True, "imageUuidOrDatabaseUri": f"{uid}@6c48a", "atlasUuid": "",
                    "trimType": "none",
                },
                "ver": "1.0.12", "imported": True, "files": [".json"], "subMetas": {},
            },
        },
        "userData": {
            "type": "sprite-frame", "fixAlphaTransparencyArtifacts": False, "hasAlpha": True,
            "redirect": f"{uid}@6c48a",
        },
    }
    png.with_suffix(".png.meta").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # 折成三段的地图：上下边都走锯齿，右段和左段同色调、中段压暗一档 = 折痕的受光/背光。
    left = [(14, 36), (46, 28), (46, 96), (14, 104)]
    middle = [(46, 28), (78, 36), (78, 104), (46, 96)]
    right = [(78, 36), (110, 28), (110, 96), (78, 104)]

    polygon(draw, left, PAPER_LIGHT)
    polygon(draw, middle, PAPER_MID)
    polygon(draw, right, PAPER_LIGHT)

    # 折痕：只画两段竖线，别把三段都描一遍（描一遍会变成三块拼图，不像一张纸）。
    line(draw, [(46, 28), (46, 96)], FOLD_LINE, 3.5)
    line(draw, [(78, 36), (78, 104)], FOLD_LINE, 3.5)

    # 行军路线：从左下走到右段中间，终点标红叉。
    dashed_route(draw, (21, 88), (56, 74), (90, 60), dash=6, gap=5, width=4)

    # 红叉（先画一圈深红当描边，再压亮红，缩到 74px 也不糊）。
    for color, width in ((MARK_RED_DARK, 9), (MARK_RED, 5)):
        line(draw, [(84, 52), (103, 71)], color, width)
        line(draw, [(103, 52), (84, 71)], color, width)

    # 左段的雪山：平涂三角 + 暗面 + 雪顶，全靠描边撑识别度。
    polygon(draw, [(20, 68), (31, 47), (42, 68)], MOUNTAIN)
    polygon(draw, [(31, 47), (42, 68), (31, 68)], MOUNTAIN_SHADE)
    polygon(draw, [(28, 55), (31, 48), (34, 55), (31, 57)], SNOW)

    # 整张纸的外轮廓最后描：先填后描，接缝处才不会被描边盖掉。
    silhouette = [(14, 36), (46, 28), (78, 36), (110, 28), (110, 96), (78, 104), (46, 96), (14, 104), (14, 36)]
    line(draw, silhouette, OUTLINE, 9)

    # 裁到内容包围盒再存：按钮上按 `CUSTOM` 等比塞进 72×72，留着透明边就等于图标变小一圈。
    out = image.resize((SIZE, SIZE), Image.LANCZOS)
    box = out.getbbox()
    if box:
        out = out.crop(box)
    target = Path(__file__).resolve().parents[1] / "assets/resources/image/main/hud/hud_mode_world.png"
    out.save(target)
    write_meta(target, out.width, out.height)
    preview = Path(__file__).resolve().parents[1] / "tools/ref/mode_icon_preview.png"
    preview.parent.mkdir(parents=True, exist_ok=True)
    out.resize((out.width * 3, out.height * 3), Image.LANCZOS).save(preview)
    print(f"written {target} ({out.width}×{out.height})")


if __name__ == "__main__":
    main()
