# -*- coding: utf-8 -*-
"""按「颜色能量」重算 alpha：清掉「黑底没抠干净」那种残影（2026-11-20 第 35 批）。

## 治什么

美术交付的序列帧常见这种残：**RGB 被压成纯黑 (0,0,0)，alpha 却留着**
（`持续光环伤害效果` 就是：1924 高的画布里上半部 100% 是 alpha 16~123 的纯黑雾）。
默认混合（SRC_ALPHA / ONE_MINUS_SRC_ALPHA）下，alpha 0.48 的黑色会把战场压暗成一块
模糊灰方块 —— 用户看到的就是「有模糊的像素背景」。

## 怎么治

判据是**颜色能量** `c = max(R,G,B)`，不是 alpha：

    k = smoothstep(lo, hi, c)      # 纯黑 c=0 ⇒ k=0，亮部 c≥hi ⇒ k=1
    a' = min(a, round(255 × k))    # 颜色能量给 alpha 设上限

- 纯黑像素（含整块雾）⇒ 上限 0 ⇒ `a' = 0`，彻底消失；
- 有颜色的主体 ⇒ `k≈1`，上限 255 ⇒ alpha **原样保留**（半透明光晕的呼吸感不丢）；
- 中间的过渡带（主体边缘的抗锯齿）⇒ 按颜色能量压到上限之内，不会切出硬边。

🔴 为什么是 `min` 而不是 `a' = a × k`：乘法每跑一次都会再削一次（实测第二遍还会再掉 6%），
不幂等；而"上限"表达的是同一件事，且**跑第二遍结果逐像素不变**。
🔴 也**别用固定 alpha 阈值**：光晕边缘的 alpha 本来就低，一刀切会把主体边缘削掉，
而黑雾的高 alpha 区切不掉。

## 用法

    python tools/art/clean_key_alpha.py <png 或目录>… [--lo 8] [--hi 48] \
        [--apply] [--preview tmp/aura_preview] [--backup <目录>]

- 默认 **dry-run**：只报统计 + 出对比图，不改文件；
- `--apply` 才写盘，先把原图复制到 `--backup`（不给就拒写）。
- `--preview` 出 `before/after` 两张拼图（压在深色/浅色两个底上，边缘问题一眼看得出）。

🔴 只改 alpha，**不动 contentSize、不动 meta、不动 prefab**：
`sprite-frame` 的 trim 只影响裁剪矩形，而本轮涉及的 prefab 都是 `_isTrimmedMode = false`
（按原始尺寸画），所以 alpha 变化不会让图位移或缩放。
"""
import argparse
import os
import shutil
import sys

from PIL import Image


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 <= edge0:
        return 1.0 if x >= edge1 else 0.0
    t = (x - edge0) / (edge1 - edge0)
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return t * t * (3.0 - 2.0 * t)


def clean_image(im: Image.Image, lo: int, hi: int, floor: int):
    """返回 (新图, 统计)。统计里有「被清掉的像素数」与「纯黑带 alpha 的残留数」。"""
    im = im.convert("RGBA")
    w, h = im.size
    src = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out.load()
    cleared = 0
    kept = 0
    residual = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            c = r if r > g else g
            if b > c:
                c = b
            k = smoothstep(lo, hi, c)
            #  上限语义（幂等）：不是「再乘一次」，而是「alpha 不许超过颜色能量允许的值」。
            na = min(a, int(255 * k + 0.5))
            if na <= floor:
                cleared += 1
                continue
            dst[x, y] = (r, g, b, na)
            kept += 1
            if c <= lo:
                residual += 1
    return out, {"cleared": cleared, "kept": kept, "residual": residual}


def composite(im: Image.Image, bg, scale: int = 2) -> Image.Image:
    plate = Image.new("RGBA", im.size, bg + (255,))
    plate.alpha_composite(im)
    return plate.resize((im.width * scale, im.height * scale), Image.NEAREST).convert("RGB")


def side_by_side(before: Image.Image, after: Image.Image, scale: int = 2) -> Image.Image:
    """四格：深底 before/after、浅底 before/after。"""
    bgs = [(43, 58, 43), (221, 221, 221)]
    w, h = before.width * scale, before.height * scale
    sheet = Image.new("RGB", (w * 2, h * len(bgs)), (0, 0, 0))
    for row, bg in enumerate(bgs):
        sheet.paste(composite(before, bg, scale), (0, row * h))
        sheet.paste(composite(after, bg, scale), (w, row * h))
    return sheet


def collect(targets):
    files = []
    for t in targets:
        if os.path.isdir(t):
            files += [os.path.join(t, n) for n in sorted(os.listdir(t)) if n.lower().endswith(".png")]
        elif t.lower().endswith(".png"):
            files.append(t)
        else:
            raise SystemExit(f"不是 png 也不是目录：{t}")
    if not files:
        raise SystemExit("没找到 png")
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="+")
    ap.add_argument("--lo", type=int, default=8, help="颜色能量低于它 ⇒ 全清（0~255）")
    ap.add_argument("--hi", type=int, default=48, help="颜色能量高于它 ⇒ alpha 原样")
    ap.add_argument("--floor", type=int, default=1, help="算完之后 alpha ≤ 它的一律归零")
    ap.add_argument("--apply", action="store_true", help="真写盘（默认只 dry-run）")
    ap.add_argument("--backup", default=None, help="--apply 时的原图备份目录")
    ap.add_argument("--preview", default=None, help="对比图输出目录（只出第一张）")
    args = ap.parse_args()

    files = collect(args.targets)
    if args.apply and not args.backup:
        raise SystemExit("--apply 必须配 --backup：原图要先备份")

    total_cleared = 0
    total_kept = 0
    total_residual = 0
    for i, path in enumerate(files):
        with Image.open(path) as im:
            im.load()
            before = im.convert("RGBA")
        after, st = clean_image(before, args.lo, args.hi, args.floor)
        total_cleared += st["cleared"]
        total_kept += st["kept"]
        total_residual += st["residual"]
        kept_before = before.width * before.height - before.getchannel("A").histogram()[0]
        print(f"{os.path.basename(path):14s} 非透明 {kept_before:7d} -> {st['kept']:7d}"
              f"（清掉 {st['cleared']:7d}，其中纯黑{st['cleared'] / max(1, kept_before):6.1%}）"
              f"  残留纯黑但仍有alpha {st['residual']:5d}")

        if args.preview and i == 0:
            os.makedirs(args.preview, exist_ok=True)
            sheet = side_by_side(before, after)
            out = os.path.join(args.preview, "对比_" + os.path.splitext(os.path.basename(path))[0] + ".png")
            sheet.save(out)
            print(f"[预览] {out}")

        if args.apply:
            os.makedirs(args.backup, exist_ok=True)
            bak = os.path.join(args.backup, os.path.basename(path))
            if not os.path.isfile(bak):
                shutil.copy2(path, bak)
            after.save(path, "PNG", optimize=True)

    print(f"\n合计：保留 {total_kept}，清掉 {total_cleared}，残留纯黑 {total_residual}")
    if args.apply:
        print(f"[已写盘] {len(files)} 张，原图备份在 {args.backup}")
    else:
        print("[dry-run] 没有改任何文件；加 --apply --backup <目录> 才写盘")
    return 0


if __name__ == "__main__":
    sys.exit(main())
