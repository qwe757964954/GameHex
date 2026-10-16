# -*- coding: utf-8 -*-
"""
拆 plist 图集为散图（子弹_新怪物 / 飞剑术），输出到 monsters/<图集名>/ 根目录。
与怪物帧同规范：保持原始内容尺寸、不做画布归一（特效按自然尺寸）。
不在此处写 .meta —— 由编辑器自动生成，避免被覆盖。
"""
import plistlib
import re
from pathlib import Path

from PIL import Image

CLIENT = Path(r"D:\City1001\Demo3.8\assets\resources\zcds\client")
MONSTERS = Path(r"D:\City1001\Demo3.8\assets\resources\zcds\client\monsters")

SETS = ["子弹_新怪物", "飞剑术"]


def nums(s: str) -> list[int]:
    return [int(n) for n in re.findall(r"-?\d+", s)]


def unpack(name: str) -> None:
    atlas_img = Image.open(CLIENT / f"{name}.png").convert("RGBA")
    with open(CLIENT / f"{name}.plist", "rb") as f:
        frames = plistlib.load(f)["frames"]
    out_dir = MONSTERS / name
    out_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for frame_name, info in sorted(frames.items()):
        x, y, w, h = nums(info["frame"])
        offset = nums(info.get("offset", "{0,0}"))
        sw, sh = nums(info.get("sourceSize", f"{{{w},{h}}}"))
        rotated = bool(info.get("rotated", False))

        if rotated:
            # 打包区内宽高互换，顺时针 90° 存入，逆时针还原
            crop = atlas_img.crop((x, y, x + h, y + w))
            sprite = crop.transpose(Image.Transpose.ROTATE_90)
        else:
            crop = atlas_img.crop((x, y, x + w, y + h))
            sprite = crop

        canvas = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
        ox, oy = offset
        dx = round((sw - w) / 2 + ox)
        dy = round((sh - h) / 2 - oy)
        canvas.alpha_composite(sprite, (dx, dy))
        canvas.save(out_dir / frame_name)
        count += 1

    print(f"{name}: {count} frames -> {out_dir}")


for s in SETS:
    unpack(s)
