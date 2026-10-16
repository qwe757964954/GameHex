#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Normalize the six ZCDS unit frame sets into per-monster folders.

Each monster uses one scale calculated from the median visible height of its
idle frames. This keeps that monster's idle/run/attack proportions intact,
while making the six monsters visually comparable. Every frame is placed on a
256 x 256 transparent canvas, bottom-centred to a common foot line.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
import statistics

from PIL import Image


SRC_ROOT = Path(r"D:\City1001\zarts\art\怪物资源")
DST_ROOT = Path(r"D:\City1001\Demo3.8\assets\resources\zcds\client\monsters")

CANVAS_W = 256
CANVAS_H = 256
FOOT_MARGIN = 8
TARGET_IDLE_HEIGHT = 180
CONTENT_MARGIN = 8

# Source folder -> (output folder, use files suffixed with `_压缩`).
MONSTERS = {
    "民兵": ("民兵", False),
    "精灵弓箭手": ("精灵弓箭手", False),
    "骷髅战士": ("骷髅战士", False),
    "亡灵法师": ("亡灵法师", True),
    "希尔瓦娜斯": ("希尔瓦娜斯", False),
    "伊利丹": ("伊利丹", False),
}

FRAME_RE = re.compile(r"^.+?-(idle|run|attack)_(\d+)(?:_压缩)?\.png$")


def sequence_frames(source_dir: Path, use_compressed: bool) -> list[Path]:
    frames: list[Path] = []
    for path in sorted(source_dir.glob("*.png"), key=lambda item: item.name):
        if not FRAME_RE.match(path.name):
            continue
        if (("_压缩" in path.stem) != use_compressed):
            continue
        frames.append(path)
    return frames


def visible_size(path: Path) -> tuple[int, int] | None:
    with Image.open(path) as source:
        bbox = source.convert("RGBA").getbbox()
    if bbox is None:
        return None
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def monster_scale(frames: list[Path]) -> float:
    idle_heights = [
        size[1]
        for path in frames
        if "-idle_" in path.stem
        for size in [visible_size(path)]
        if size is not None
    ]
    if not idle_heights:
        raise RuntimeError("No non-empty idle frames were found")

    scale = TARGET_IDLE_HEIGHT / statistics.median(idle_heights)
    max_width = CANVAS_W - CONTENT_MARGIN * 2
    max_height = CANVAS_H - FOOT_MARGIN - CONTENT_MARGIN
    for path in frames:
        size = visible_size(path)
        if size is None:
            continue
        width, height = size
        scale = min(scale, max_width / width, max_height / height)
    return scale


def normalize_frame(source_path: Path, destination_path: Path, scale: float) -> tuple[int, int] | None:
    with Image.open(source_path) as source:
        image = source.convert("RGBA")
    bbox = image.getbbox()
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    if bbox is None:
        canvas.save(destination_path)
        return None

    content = image.crop(bbox)
    width = max(1, round(content.width * scale))
    height = max(1, round(content.height * scale))
    if (width, height) != content.size:
        content = content.resize((width, height), Image.Resampling.LANCZOS)

    x = (CANVAS_W - width) // 2
    y = CANVAS_H - FOOT_MARGIN - height
    canvas.alpha_composite(content, (x, y))
    canvas.save(destination_path)
    return width, height


def main() -> int:
    totals: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for source_name, (output_name, use_compressed) in MONSTERS.items():
        source_dir = SRC_ROOT / source_name
        if not source_dir.is_dir():
            raise FileNotFoundError(f"Missing source folder: {source_dir}")

        frames = sequence_frames(source_dir, use_compressed)
        if not frames:
            raise RuntimeError(f"No sequence frames found in: {source_dir}")

        output_dir = DST_ROOT / output_name
        output_dir.mkdir(parents=True, exist_ok=True)
        scale = monster_scale(frames)
        visible_heights: list[int] = []
        for source_path in frames:
            result = normalize_frame(source_path, output_dir / source_path.name, scale)
            match = FRAME_RE.match(source_path.name)
            assert match is not None
            totals[output_name][match.group(1)] += 1
            if result is not None:
                visible_heights.append(result[1])

        print(
            f"{output_name}: scale={scale:.4f}, frames={len(frames)}, "
            f"visibleHeight={min(visible_heights)}..{max(visible_heights)}, "
            f"actions={dict(totals[output_name])}"
        )

    print(f"Output: {DST_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
