"""把美术的「六边形脉冲序列帧」处理成**游戏内可用的脉冲层**（一次性工具，2026-10-19）。

背景
----
美术交付的 5 张 `hex_pulse_0..4.png`（320×320）里，**中心那块六边形是实心不透明**的：
它画的是「地块本体」的参考色（#D9CDE2，alpha 255），波是本体外面那一圈发光描边。
这是给「整块地皮都换成这套图」的场景准备的。

本项目的用法不是这样：地块自己有色（阵营色 / 中立色）、有图标和价格，
脉冲层是**盖在地块上面**的一层。实心本体压上去会把地块整块盖成淡紫，播完再「啪」地
弹回原色 —— 那不是脉冲，是闪屏。

处理口径（用户 2026-10-19 两次给口径后的最终版）：
  · 先试过「彻底挖空」（本体 alpha → 0，中心完全透出地块）—— 观感偏空；
  · 现口径：**中间那块六边形保留，但压到 35% 不透明度**（`BODY_ALPHA`），
    外圈的波**原样不动**（它自带 70%→15% 的逐帧淡出，不能动）。
    ⇒ 地块的阵营色 / 图标 / 价格仍然透得出来，波又有个「发光的本体」托底。

做法
----
1. 从第 0 帧量出本体的**不透明**包围盒（alpha ≥ 250）⇒ 平顶六边形
   （顶点 = 左右两个尖 + 上下两条横边）；
2. 把这个六边形向心收 `INSET_PX` 像素，得到「本体区」—— 留一点边不被压，
   这样帧 0 那圈「贴着本体边缘出生的波」的亮边还在；
3. 对 5 帧统一按这个区把 alpha **乘** `BODY_ALPHA`（不是清零）：
   5 帧本体位置逐像素一致，一份蒙版够用。

用法
----
    python tools/gen_hex_pulse_layer.py <源目录> [目标目录]

`<源目录>` 里应有 `hex_pulse_0.png ~ hex_pulse_4.png`（**美术原稿**，本体是实心的那份）；
目标目录默认 `assets/resources/image/effects/hex_pulse_seq/`。同时会在源目录写出
`_preview_dark.png`（深色底）与 `_preview_tile.png`（地块色底）两张对照图，方便肉眼验收。
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

FRAME_COUNT = 5
#: 「本体区」相对本体多边形向心收缩的像素（留一点边：帧 0 的贴边亮边不压，否则波出生那一下会缺一圈）。
INSET_PX = 3.0
#: 本体区的不透明度（0 = 彻底挖空，1 = 保持美术原样的实心）。
#: 2026-10-19 用户口径：「中间不需要彻底挖空，使用 35% 透明的六边形即可」⇒ 0.35。
#: ⚠️ 这一档就是唯一的观感旋钮：太小会退回「空得发虚」，太大就会把地块盖住（回到闪屏）。
BODY_ALPHA = 0.35
#: 判「本体」的 alpha 阈值（本体是不透明实心，抗锯齿边不算）。
OPAQUE_ALPHA = 250


# ── 极简 PNG 编解码（本机没有 PIL，只处理 8bit RGBA / RGB，够用） ──────────────────


def read_png(path: Path) -> tuple[int, int, int, bytes]:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"不是 PNG：{path}"
    pos, idat, width, height, channels = 8, b"", 0, 0, 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", chunk)
            assert depth == 8, "只支持 8bit"
            channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * channels
    out = bytearray(height * stride)
    previous = bytearray(stride)
    cursor = 0
    for y in range(height):
        filter_type = raw[cursor]
        cursor += 1
        line = bytearray(raw[cursor:cursor + stride])
        cursor += stride
        if filter_type == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 255
        elif filter_type == 2:
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 255
        elif filter_type == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 255
        elif filter_type == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = previous[i]
                corner = previous[i - channels] if i >= channels else 0
                estimate = left + up - corner
                dist_a = abs(estimate - left)
                dist_b = abs(estimate - up)
                dist_c = abs(estimate - corner)
                if dist_a <= dist_b and dist_a <= dist_c:
                    predictor = left
                elif dist_b <= dist_c:
                    predictor = up
                else:
                    predictor = corner
                line[i] = (line[i] + predictor) & 255
        out[y * stride:(y + 1) * stride] = line
        previous = line
    return width, height, channels, bytes(out)


def write_png(path: Path, width: int, height: int, channels: int, pixels: bytes) -> None:
    color_type = {1: 0, 3: 2, 4: 6}[channels]
    stride = width * channels
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                     + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


# ── 本体多边形 ──────────────────────────────────────────────────────────────────


def opaque_bounds(width: int, height: int, channels: int, pixels: bytes) -> tuple[int, int, int, int]:
    """第 0 帧里「不透明」像素的包围盒（= 本体六边形）。"""
    alpha_at = channels - 1
    min_x, min_y, max_x, max_y = width, height, -1, -1
    for y in range(height):
        row = y * width * channels
        for x in range(width):
            if pixels[row + x * channels + alpha_at] >= OPAQUE_ALPHA:
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
    assert max_x > min_x and max_y > min_y, "量不到本体（第 0 帧没有不透明像素？）"
    return min_x, min_y, max_x, max_y


def build_pulse_layer(directory: Path, target: Path) -> None:
    frames = [read_png(directory / f"hex_pulse_{index}.png") for index in range(FRAME_COUNT)]
    width, height, channels, first = frames[0]
    assert channels == 4, "序列帧必须是带透明通道的 RGBA"
    min_x, min_y, max_x, max_y = opaque_bounds(width, height, channels, first)

    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    # 平顶六边形：左右两个尖（y = 中心）+ 上下两条横边（半长 = 半宽的一半）。
    half_width = (max_x - min_x + 1) / 2
    half_height = (max_y - min_y + 1) / 2
    half_top_edge = half_width / 2
    apothem = half_height
    shrink = max(0.0, 1.0 - INSET_PX / apothem)
    inner_width = half_width * shrink
    inner_height = half_height * shrink
    inner_top = half_top_edge * shrink

    target.mkdir(parents=True, exist_ok=True)
    processed_frames: list[bytes] = []
    for index, (fw, fh, fch, pixels) in enumerate(frames):
        assert (fw, fh) == (width, height), "5 帧尺寸必须一致（否则节点缩放没法共用）"
        out = bytearray(pixels)
        for y in range(height):
            dy = abs(y - center_y)
            if dy > inner_height:
                continue
            # 该行的左右边界：顶点在 y = 中心（半宽），到上下横边收成「半宽的一半」。
            limit = inner_width - (dy / inner_height) * (inner_width - inner_top)
            span = int(limit)
            row = y * width * fch
            start = int(center_x - span)
            for x in range(max(0, start), min(width, start + span * 2 + 1)):
                offset = row + x * fch + 3
                source_alpha = pixels[offset]
                out[offset] = int(source_alpha * BODY_ALPHA + 0.5)
        write_png(target / f"hex_pulse_{index}.png", width, height, fch, bytes(out))
        processed_frames.append(bytes(out))

    _write_previews(directory, width, height, processed_frames)
    print(f"本体区：bbox=({min_x},{min_y})-({max_x},{max_y}) 内缩 {INSET_PX}px、"
          f"alpha × {BODY_ALPHA} ⇒ 已写出 {FRAME_COUNT} 帧到 {target}")


def _write_previews(directory: Path, width: int, height: int, frames: list[bytes]) -> None:
    """两张对照图：深色底（看波形）/ 地块色底（确认中心没被盖住）。"""
    gap = 8
    total_width = width * FRAME_COUNT + gap * (FRAME_COUNT + 1)
    for name, background in (("_preview_dark.png", (35, 37, 43)), ("_preview_tile.png", (106, 90, 140))):
        out = bytearray(total_width * height * 3)
        for y in range(height):
            row = y * total_width * 3
            for x in range(total_width):
                offset = row + x * 3
                out[offset:offset + 3] = bytes(background)
        for index, pixels in enumerate(frames):
            origin_x = gap + index * (width + gap)
            for y in range(height):
                for x in range(width):
                    src = (y * width + x) * 4
                    alpha = pixels[src + 3] / 255.0
                    if alpha <= 0:
                        continue
                    dst = (y * total_width + origin_x + x) * 3
                    for channel in range(3):
                        base = out[dst + channel]
                        out[dst + channel] = int(base * (1 - alpha) + pixels[src + channel] * alpha)
        write_png(directory / name, total_width, height, 3, bytes(out))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(
        "assets/resources/image/effects/hex_pulse_seq")
    build_pulse_layer(source, destination)
