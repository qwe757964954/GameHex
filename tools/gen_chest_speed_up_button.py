"""把详情弹窗的黄色主按钮 `btn_open.png` 改色成绿色版 `btn_speed_up.png`。

背景（2026-11-11 用户口径）：宝箱详情弹窗右侧按钮在「加速」态要和宝箱栏那颗
绿色「加速」按钮同色，但**解锁 / 开启态仍用原来的黄色底**。详情弹窗的两颗按钮
（`btn.png` 蓝 / `btn_open.png` 黄）是同一套形状：同样的圆角、黑色描边、左上高光、
右下小缺口。直接拿栏位的 `chest_btn_green.png`（130×54）放大到 255×108 会把描边
和圆角一起拉变形，所以这里按 `btn_open.png` **只换色相**，几何逐像素不变。

改色规则（连续，避免高光与主体之间出现色带）：
  · 色相整体 +65°：主体 43°（金黄）→ 108°（栏位绿底的主色相）；
  · 饱和度 / 明度按原饱和度连续收敛到 `btn.png`（蓝色那颗）的量级
    （s 0.92→0.67、v 0.96→0.87），高光几乎不动；
  · 低饱和的高光跟着偏一点绿，黑色描边（s≈0）保持纯黑，alpha 原样保留。

meta 直接从 `btn_open.png.meta` 克隆：尺寸 / 九宫格边距 / 顶点数据完全一致，
只需换 uuid、displayName 与三处内部引用。写死 uuid 是为了 prefab 里的引用稳定
（重跑脚本不会把已绑定的引用弄脏）。

用法：python tools/gen_chest_speed_up_button.py
"""

from __future__ import annotations

import colorsys
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DETAIL = ROOT / 'assets/resources/image/main/chest/detail'
SRC_PNG = DETAIL / 'btn_open.png'
SRC_META = DETAIL / 'btn_open.png.meta'
DST_PNG = DETAIL / 'btn_speed_up.png'
DST_META = DETAIL / 'btn_speed_up.png.meta'

# 固定 uuid：与 `ui/main/ChestDetailPanel.prefab` 里 openSpeedUpFrame 的引用一一对应。
UUID = 'b6c1e904-3a75-4b18-9a6c-d2f0e18b47a5'
HUE_SHIFT_DEG = 65.0


def recolor(src: Image.Image) -> Image.Image:
    out = Image.new('RGBA', src.size)
    src_pixels = src.load()
    out_pixels = out.load()
    width, height = src.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = src_pixels[x, y]
            if a == 0:
                out_pixels[x, y] = (0, 0, 0, 0)
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            # 按原饱和度插值：主体收敛到蓝色按钮的 s/v，高光基本保持。
            weight = min(1.0, s / 0.92)
            s2 = s * (1.0 - 0.27 * weight)
            v2 = v * (1.0 - 0.09 * weight)
            h2 = (h + HUE_SHIFT_DEG / 360.0) % 1.0
            r2, g2, b2 = colorsys.hsv_to_rgb(h2, s2, v2)
            out_pixels[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    return out


def build_meta() -> dict:
    meta = json.loads(SRC_META.read_text(encoding='utf-8'))
    old = meta['uuid']
    meta['uuid'] = UUID
    for sub in meta['subMetas'].values():
        sub['uuid'] = sub['uuid'].replace(old, UUID)
        if sub.get('userData'):
            ud = sub['userData']
            for key in ('imageUuidOrDatabaseUri', 'atlasUuid'):
                if isinstance(ud.get(key), str):
                    ud[key] = ud[key].replace(old, UUID)
            if sub['id'] == 'f9941':
                sub['displayName'] = 'btn_speed_up'
    meta['subMetas']['6c48a']['displayName'] = 'btn_speed_up'
    meta['userData']['redirect'] = meta['userData']['redirect'].replace(old, UUID)
    return meta


def main() -> None:
    src = Image.open(SRC_PNG).convert('RGBA')
    out = recolor(src)
    out.save(DST_PNG)
    # ⚠️ 同目录其它 .meta 都是 LF；write_text 在 Windows 默认会转成 CRLF。
    with DST_META.open('w', encoding='utf-8', newline='\n') as fp:
        fp.write(json.dumps(build_meta(), ensure_ascii=False, indent=2) + '\n')
    print(f'{DST_PNG.relative_to(ROOT)} {out.size}')
    print(f'{DST_META.relative_to(ROOT)} uuid={UUID}')


if __name__ == '__main__':
    main()
