"""把云图拆成「云体」「影子」两张**同画布**的图（一次性美术加工，离线跑）。

## 为什么必须离线拆

云图被 `image/territory/auto-atlas.pac` 收进图集页，运行时 `spriteFrame.texture` 是**一整张图集**，
想切一刀就得自己拼 `rect + originalSize + offset` 三件套。三版就是这么做的，实机翻车了：

    Cocos 3.x 的 `SpriteFrame.rect` 是**自上而下**（`_calculateUV` 里 `rect.y` 直接当 top 用），
    而当时按「纹理原点左下」推的 `y = H - bottom` ⇒ 体 / 影两条**整体互换**，
    影子被摆到画布上方 +60px，正好压在云体的奶油色上 → 截图里整片云发灰（22% 黑压奶油色）。

离线拆成两张独立 PNG 以后，运行时只做「两个 Sprite 同坐标、影子分组在云体之下」，
一个 rect 都不用算 —— 这类方向错误没有第二次机会。

## 两张图的约束

* **同画布 200×240、同锚点**：两个节点写同一个 `setPosition` 就对齐；
* 像素**互斥**：一个像素要么在云体图里、要么在影子图里 ⇒ 两张图上下叠起来 == 原图；
* `.meta` 照抄源图（`trimType: none` 不能丢，否则 Cocos 会把全透明的边裁掉、offset 一变又歪）。

## 判据

影子的像素是**纯黑 + 低 alpha**（实测只有 `(0,0,0,21|34|46|56|61)` 五种，边缘抗锯齿留下的），
云体最暗的像素也在 `(200,200,180)` 以上 ⇒ 用 `r + g + b <= 90` 就能干净分开，不用调阈值。

## 用法

    python tools/split_cloud_layers.py

输出（都在 `assets/resources/image/territory/cloud/`）：

    源             → 云体                    / 影子
    cloud_idle_0   → cloud_body_0           / cloud_shadow_0
    cloud_dissolve_0 → cloud_dissolve_body_0 / cloud_dissolve_shadow_0
    cloud_dissolve_1 → cloud_dissolve_body_1 / cloud_dissolve_shadow_1

⚠️ 只拆**运行时真的会用到**的 3 张（待机静态图只取 `idle_0`）。想把待机飘动动画放回来，
   把 `cloud_idle_1..4` 加进下面的 `FRAMES` 再跑一次即可。
"""

import json
import os
import random
import uuid

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_DIR = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'cloud')
META_TEMPLATE = os.path.join(CLOUD_DIR, 'cloud_idle_0.png.meta')
TEMPLATE_NAME = 'cloud_idle_0'

# 源图 → (云体名, 影子名)
FRAMES = (
    ('cloud_idle_0', 'cloud_body_0', 'cloud_shadow_0'),
    ('cloud_dissolve_0', 'cloud_dissolve_body_0', 'cloud_dissolve_shadow_0'),
    ('cloud_dissolve_1', 'cloud_dissolve_body_1', 'cloud_dissolve_shadow_1'),
)

# 影子是纯黑 (0,0,0) 低 alpha 那团；云体最暗的像素也在 (200,200,180) 以上（sum 580）。
# 中间没有任何灰区，90 这个阈值只是"离两边都远"的取法。
SHADOW_SUM_MAX = 90

# 源图尺寸（同画布约束靠它兜底：拆出来尺寸不一致就直接报错，不许悄悄产出歪图）。
ART_SIZE = (200, 240)


def split(source):
    """返回 (云体图, 影子图)，两张同尺寸、像素互斥。"""
    body = source.copy()
    shadow = source.copy()
    body_px = body.load()
    shadow_px = shadow.load()
    clear = (0, 0, 0, 0)
    for y in range(source.height):
        for x in range(source.width):
            pixel = source.getpixel((x, y))
            if pixel[3] == 0 or sum(pixel[:3]) > SHADOW_SUM_MAX:
                shadow_px[x, y] = clear
            else:
                body_px[x, y] = clear
    return body, shadow


def new_uuid():
    """Cocos 的 uuid 是标准 8-4-4-4-12 十六进制串。"""
    return str(uuid.UUID(int=random.getrandbits(128)))


def write_meta(path, name):
    """照抄源图 `.meta` 的全文，换掉 uuid 与显示名。

    文本替换而不是"读 json 再改字段"：`redirect` / `imageUuidOrDatabaseUri` / `atlasUuid`
    这些字段里嵌着 uuid 字符串，逐个挑容易漏一个 —— 漏了就是"图导入成功但 spriteFrame 指向别人"。
    """
    with open(META_TEMPLATE, encoding='utf-8') as handle:
        text = handle.read()
    old_uuid = json.loads(text)['uuid']
    text = text.replace(old_uuid, new_uuid()).replace(TEMPLATE_NAME, name)
    meta = json.loads(text)  # 顺手校验：改完仍是合法 json
    for sub in (meta.get('subMetas') or {}).values():
        sub['displayName'] = name
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


def verify(source, body, shadow):
    """两张图叠起来必须还原原图（逐像素：一个算体、另一个必是全透明）。"""
    for y in range(source.height):
        for x in range(source.width):
            pixel = source.getpixel((x, y))
            in_body = body.getpixel((x, y))[3] > 0
            in_shadow = shadow.getpixel((x, y))[3] > 0
            if in_body and in_shadow:
                raise SystemExit(f'像素 ({x},{y}) 同时落进了体和影子')
            if pixel[3] > 0 and not (in_body or in_shadow):
                raise SystemExit(f'像素 ({x},{y}) 两边都没收，会丢内容')
            if in_body and body.getpixel((x, y)) != pixel:
                raise SystemExit(f'像素 ({x},{y}) 云体图变色了')
            if in_shadow and shadow.getpixel((x, y)) != pixel:
                raise SystemExit(f'像素 ({x},{y}) 影子图变色了')


def main():
    for source_name, body_name, shadow_name in FRAMES:
        source = Image.open(os.path.join(CLOUD_DIR, f'{source_name}.png')).convert('RGBA')
        if source.size != ART_SIZE:
            raise SystemExit(f'{source_name}.png 尺寸 {source.size} != {ART_SIZE}，同画布约束不成立')
        body, shadow = split(source)
        verify(source, body, shadow)
        for image, name in ((body, body_name), (shadow, shadow_name)):
            png = os.path.join(CLOUD_DIR, f'{name}.png')
            image.save(png)
            write_meta(f'{png}.meta', name)
            print(f'{source_name} -> {name}.png {image.size}')


if __name__ == '__main__':
    main()
