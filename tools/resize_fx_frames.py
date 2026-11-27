# -*- coding: utf-8 -*-
"""特效散图按「游戏里实际显示的尺寸」降采样，同步 image.meta 的 spriteFrame 数据。

背景：美术按大画布出图（例：`BUFF效果_持续正向` 21 帧 455×455），进 auto-atlas 后
是一页 2048×2048（RGBA 约 16.8 MB），而它在一格（顶面 123×90 屏上 px）里挂着，
显存全白占。画布不缩、靠 prefab `_lscale` 缩，在屏幕上看着一样，只是把浪费留在纹理里。

口径（与 `docs/zcds-表现层与领地规范.md` §1 的投射物特效一致）：

  · 长边取 256：既有投射物 / 光环特效的画布统一档位；
    一格的显示宽约 120 px ⇒ 内容宽约 200 px，约 1.7 倍像素密度，够用且不糊；
  · 等比缩，画布比例不变；所有帧同尺寸 ⇒ 缩放系数唯一，逐帧对齐不受影响；
  · 重采样走 **预乘 alpha** + LANCZOS。直通 alpha 直接缩会在半透明边缘掉出一圈
    脏边，而特效是加色混合、边缘最显眼；
  · `image.meta` 的 `spriteFrame` 子资源一起重算（trimX/trimY/width/height/
    offsetX/offsetY/uv/nuv/vertices）。`trimType` 仍是 `auto`，编辑器重导只会
    按阈值微调 ±1px；
  · 只动散图与 meta，不动 `.pac` / prefab —— 图集是导入期生成的，跟着图走。

用法：

    python tools/resize_fx_frames.py --dir <特效目录>            # 缺省长边 256
    python tools/resize_fx_frames.py --dir <特效目录> --size 192
    python tools/resize_fx_frames.py --dir <特效目录> --width 144 --height 321   # 非方画布
    python tools/resize_fx_frames.py --dir <特效目录> --width 215 --height 90 --crop 35,272,214,347
    python tools/resize_fx_frames.py --dir <特效目录> --dry-run  # 只看现状

注意：可重入但**破坏性** —— 已经是小画布的目录再跑一次会继续缩。所以先 `--dry-run`
看现状，且在版本库里跑。
"""
import argparse
import glob
import json
import os

import numpy as np
from PIL import Image

DEFAULT_SIZE = 256


def frame_files(directory):
    """目录下的散图（只取顶层；`atlas/` 之类子目录不是原始散图）。"""
    return sorted(glob.glob(os.path.join(directory, "*.png")))


def image_size(path):
    with Image.open(path) as im:
        return im.size


def resize_premultiplied(im, target_size):
    """预乘 alpha 后逐通道 LANCZOS 缩放，再解预乘。

    直通 alpha 缩会在「有颜色、alpha 很低」的像素上把颜色算进去，边缘发灰/发黑；
    特效叠在场景上，这圈脏边最扎眼。
    """
    rgba = np.asarray(im.convert("RGBA"), dtype=np.float32)
    alpha = rgba[..., 3] / 255.0
    premultiplied = np.dstack([
        rgba[..., 0] * alpha,
        rgba[..., 1] * alpha,
        rgba[..., 2] * alpha,
        rgba[..., 3],
    ])
    channels = [
        Image.fromarray(premultiplied[..., i], mode="F").resize(target_size, Image.LANCZOS)
        for i in range(4)
    ]
    scaled = np.dstack([np.asarray(channel, dtype=np.float32) for channel in channels])
    out_alpha = scaled[..., 3]
    out_rgb = np.zeros_like(scaled[..., :3])
    solid = out_alpha > 0
    out_rgb[solid] = scaled[solid][:, :3] / (out_alpha[solid, None] / 255.0)
    out = np.dstack([np.clip(out_rgb, 0, 255), np.clip(out_alpha, 0, 255)])
    return Image.fromarray(out.astype(np.uint8), mode="RGBA")


def sprite_meta_key(meta):
    for key, sub in (meta.get("subMetas") or {}).items():
        if sub.get("importer") == "sprite-frame":
            return key
    return None


def rescale_sprite_meta(meta, target_w, target_h):
    """按新画布重算 spriteFrame 子资源；偏移 / uv 全部由 trim 矩形推出来。"""
    key = sprite_meta_key(meta)
    if key is None:
        return False
    user_data = meta["subMetas"][key]["userData"]
    scale_x = target_w / user_data["rawWidth"]
    scale_y = target_h / user_data["rawHeight"]

    trim_x = round(user_data["trimX"] * scale_x)
    trim_y = round(user_data["trimY"] * scale_y)
    width = max(1, round(user_data["width"] * scale_x))
    height = max(1, round(user_data["height"] * scale_y))

    user_data["rawWidth"] = target_w
    user_data["rawHeight"] = target_h
    user_data["trimX"] = trim_x
    user_data["trimY"] = trim_y
    user_data["width"] = width
    user_data["height"] = height
    #  offset 是「裁剪矩形中心相对原画布中心」的位移，y 轴与引擎一致向上为正。
    user_data["offsetX"] = round((trim_x + width / 2) - target_w / 2, 2)
    user_data["offsetY"] = round(target_h / 2 - (trim_y + height / 2), 2)

    vertices = user_data.get("vertices")
    if vertices:
        half_w, half_h = width / 2, height / 2
        vertices["rawPosition"] = [-half_w, -half_h, 0, half_w, -half_h, 0,
                                   -half_w, half_h, 0, half_w, half_h, 0]
        vertices["minPos"] = [-half_w, -half_h, 0]
        vertices["maxPos"] = [half_w, half_h, 0]
        #  uv 的 y 从纹理底部起算，所以顶边 = rawHeight - trimY。
        uv_top = target_h - trim_y
        uv_bottom = uv_top - height
        vertices["uv"] = [trim_x, uv_top, trim_x + width, uv_top,
                          trim_x, uv_bottom, trim_x + width, uv_bottom]
        vertices["nuv"] = [vertices["uv"][0] / target_w, vertices["uv"][1] / target_h,
                           vertices["uv"][2] / target_w, vertices["uv"][3] / target_h,
                           vertices["uv"][4] / target_w, vertices["uv"][5] / target_h,
                           vertices["uv"][6] / target_w, vertices["uv"][7] / target_h]
    return True


def rewrite_full_frame_meta(meta, target_w, target_h):
    """裁掉整幅画布外内容后，spriteFrame 变成「整帧不裁剪」，uv 铺满。"""
    key = sprite_meta_key(meta)
    if key is None:
        return False
    user_data = meta["subMetas"][key]["userData"]
    user_data["rawWidth"] = target_w
    user_data["rawHeight"] = target_h
    user_data["trimX"] = 0
    user_data["trimY"] = 0
    user_data["width"] = target_w
    user_data["height"] = target_h
    user_data["offsetX"] = 0
    user_data["offsetY"] = 0
    user_data["trimType"] = "none"
    vertices = user_data.get("vertices")
    if vertices:
        half_w, half_h = target_w / 2, target_h / 2
        vertices["rawPosition"] = [-half_w, -half_h, 0, half_w, -half_h, 0,
                                   -half_w, half_h, 0, half_w, half_h, 0]
        vertices["minPos"] = [-half_w, -half_h, 0]
        vertices["maxPos"] = [half_w, half_h, 0]
        vertices["uv"] = [0, target_h, target_w, target_h, 0, 0, target_w, 0]
        vertices["nuv"] = [0, 1, 1, 1, 0, 0, 1, 0]
    return True


def write_json(path, payload):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def process(directory, target_w, target_h, dry_run, crop=None):
    files = frame_files(directory)
    if not files:
        print("目录里没有散图：%s" % directory)
        return
    sizes = {path: image_size(path) for path in files}
    source_sizes = set(sizes.values())
    if len(source_sizes) != 1:
        print("散图尺寸不一致（%s），逐帧换图会抖，先让美术对齐再缩。" % sorted(source_sizes))
        return
    source_w, source_h = source_sizes.pop()
    box = crop or (0, 0, source_w, source_h)
    box_w = box[2] - box[0]
    box_h = box[3] - box[1]
    scale_x = target_w / box_w
    scale_y = target_h / box_h
    if abs(scale_x - scale_y) > 0.02:
        print("目标 %d×%d 与原图 %d×%d 不是同一比例（%.4f vs %.4f），会拉歪。"
              % (target_w, target_h, source_w, source_h, scale_x, scale_y))
        return
    if abs(scale_x - scale_y) > 0.005:
        print("提示：非等比缩放 %.4f vs %.4f（差 %.2f%%），画面会轻微拉伸。"
              % (scale_x, scale_y, abs(scale_x - scale_y) * 100))
    if crop is None and source_w <= target_w:
        print("当前画布 %d×%d 已经不大了 %d×%d，什么都没做。"
              % (source_w, source_h, target_w, target_h))
        return

    total_before = sum(os.path.getsize(path) for path in files)
    print("%d 帧 %d×%d -> %d×%d（%.3f×）%s"
          % (len(files), source_w, source_h, target_w, target_h, scale_x,
             "（dry-run，不落盘）" if dry_run else ""))
    total_after = 0
    for path in files:
        source = Image.open(path)
        if crop is not None:
            source = source.crop(box)
        target = resize_premultiplied(source, (target_w, target_h))
        if dry_run:
            print("  %-44s %7.1f KB -> 预计缩到 %.1f KB"
                  % (os.path.basename(path), os.path.getsize(path) / 1024,
                     os.path.getsize(path) / 1024 * scale_x * scale_y))
            continue
        target.save(path, optimize=True)
        total_after += os.path.getsize(path)

        meta_path = path + ".meta"
        if not os.path.isfile(meta_path):
            continue
        with open(meta_path, encoding="utf-8") as handle:
            meta = json.load(handle)
        patched = (rewrite_full_frame_meta(meta, target_w, target_h) if crop is not None
                   else rescale_sprite_meta(meta, target_w, target_h))
        if patched:
            write_json(meta_path, meta)

    if not dry_run:
        print("PNG 合计 %.1f KB -> %.1f KB，全帧面积 %.2f MB -> %.2f MB"
              % (total_before / 1024, total_after / 1024,
                 len(files) * source_w * source_h * 4 / 1024 / 1024,
                 len(files) * target_w * target_h * 4 / 1024 / 1024))


def main():
    parser = argparse.ArgumentParser(description="特效散图按显示尺寸降采样")
    parser.add_argument("--dir", required=True, help="特效目录（散图顶层）")
    parser.add_argument("--size", type=int, default=DEFAULT_SIZE, help="缩后方画布边长，缺省 256")
    parser.add_argument("--width", type=int, help="缩后宽（与 --height 一起用，非方画布）")
    parser.add_argument("--height", type=int, help="缩后高")
    parser.add_argument("--crop", help="先裁源图再缩：x0,y0,x1,y1（源 px）")
    parser.add_argument("--dry-run", action="store_true", help="只打印现状，不改文件")
    args = parser.parse_args()
    if args.width and args.height:
        target_w, target_h = args.width, args.height
    else:
        target_w = target_h = args.size
    crop = tuple(int(v) for v in args.crop.split(",")) if args.crop else None
    process(os.path.abspath(args.dir), target_w, target_h, args.dry_run, crop)


if __name__ == "__main__":
    main()
