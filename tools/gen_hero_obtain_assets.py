# -*- coding: utf-8 -*-
"""生成「获得英雄」全屏展示页的资源：8 张切图 + `.meta` + prefab。

设计稿：蓝湖「获得英雄」(`pid 36a56744…` / `image_id db88dd81…`)，画布 720×1610，
xhdpi `sliceScale = 2` 导出的切图是 **1:1 设计像素**（不用再乘 2）。

用法：`python tools/gen_hero_obtain_assets.py`
（幂等：每次都整份重写 meta / prefab，切图只拷贝不修改）

⚠️ prefab 是**整份重写**的：手改过 prefab 再跑本脚本会被覆盖。
   布局改动的正确入口是 `assets/script/app/card/model/HeroObtainLayout.ts`
   （本脚本里的 `RECTS` 只是同一套设计稿数字的副本，单测会拿 prefab 坐标和纯函数对账）。

## 节点树

```
HeroObtain           720×1610  Widget 四边拉伸（ALWAYS）+ HeroObtainPage
├── Bg               720×1610  Widget 居中（不拉伸）+ Sprite + UIOpacity；页面按 cover 缩放
├── Touch            720×1610  cc.Button（NONE）四边拉伸（ALWAYS）—— 点任意处继续 / 关闭
└── Stage            720×1610  锚点 0.5/1，Widget 上下左右居中；设计稿溢出部分上下对称
    ├── Rays         690×690   (0,-769)     放射光（缩放 + 角度 + 透明度）
    ├── Shadow       302×68    (1,-952)     英雄影子
    ├── HeroRoot     421×426   (0.5,-745)   英雄根（浮起 / 缩放）；子 HeroHost 是 Spine 宿主
    ├── Title        326×54    (9,-310)     标题（导出图，不是文字）
    ├── Plate        252×51    (-3,-1038.5) 名牌底
    ├── Badge        40×40     (-84,-1038)  职业徽标
    ├── Name         124×30    (17,-1039)   英雄名 30pt 雅黑 Bold + 2px 黑描边
    ├── ProgressRow  720×1610              碎片进度整行（无数据时整行隐藏）
    │   ├── Shard    53×52     (-125.5,-1227)
    │   ├── BarBg    270×42    (11,-1227)
    │   ├── BarFill  255×27    (-117,-1226.5)  锚点 (0,0.5) + FILLED 从左长满
    │   └── Count    79×26     (12.5,-1227)
    └── Hint         175×29    (-1.5,-1388.5)  「点击屏幕继续」28pt
```

产物落点：
· `assets/resources/image/bg_hero_obtain.png`（720×1610 大图，**不进图集**）
· `assets/resources/image/hero_obtain/`（其余 7 张）
"""
import hashlib
import json
import os
import shutil
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = r"C:\Users\hedao\Downloads\获得英雄_slices\mipmap-xhdpi"
RES_IMAGE_DIR = os.path.join(ROOT, "assets", "resources", "image")
ART_DIR = os.path.join(RES_IMAGE_DIR, "hero_obtain")
PREFAB_DIR = os.path.join(ROOT, "assets", "resources", "ui", "heroObtain")
PREFAB_NAME = "HeroObtain"
PAGE_SCRIPT = "assets/script/app/card/view/HeroObtainPage.ts"
PAGE_UUID = "b7c3e4f1-2a9d-4b62-8f13-6e5d2c8a9f04"

SLICES = {
    "hdyx_bg.png": "bg_hero_obtain.png",
    "hdyx_guang.png": "hdyx_guang.png",
    "title_text.png": "hdyx_title.png",
    "xxk_di.png": "hdyx_xxk_di.png",
    "yinying.png": "hdyx_yinying.png",
    "icon_suipian.png": "hdyx_icon_suipian.png",
    "progress_bg.png": "hdyx_progress_bg.png",
    "progress_01.png": "hdyx_progress_01.png",
}

BG_NAME = "bg_hero_obtain.png"

EXPECTED_SIZES = {
    "bg_hero_obtain.png": (720, 1610),
    "hdyx_guang.png": (690, 690),
    "hdyx_title.png": (326, 54),
    "hdyx_xxk_di.png": (252, 51),
    "hdyx_yinying.png": (302, 68),
    "hdyx_icon_suipian.png": (53, 52),
    "hdyx_progress_bg.png": (270, 42),
    "hdyx_progress_01.png": (255, 27),
}

PACKABLE = {BG_NAME: False}

CANVAS_W = 720
CANVAS_H = 1610
UI_2D = 33554432
BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

# 设计稿矩形（与 HeroObtainLayout.ts 的 HERO_OBTAIN_RECTS 同一套数字）
RECTS = {
    "title": (206, 283, 326, 54),
    "rays": (15, 424, 690, 690),
    "hero": (150, 532, 421, 426),
    "shadow": (210, 918, 302, 68),
    "plate": (231, 1013, 252, 51),
    "badge": (256, 1018, 40, 40),
    "name": (315, 1024, 124, 30),
    "shard": (208, 1201, 53, 52),
    "barBg": (236, 1206, 270, 42),
    "barFill": (243, 1213, 255, 27),
    "count": (333, 1214, 79, 26),
    "hint": (271, 1374, 175, 29),
}


def center_of(name):
    x, y, w, h = RECTS[name]
    return (x + w / 2 - CANVAS_W / 2, -(y + h / 2))


def left_quad_of(name):
    x, y, w, h = RECTS[name]
    return (x - CANVAS_W / 2, -(y + h / 2), w, h)


def size_of(name):
    _, _, w, h = RECTS[name]
    return (w, h)


def dest_dir_of(name):
    return RES_IMAGE_DIR if name == BG_NAME else ART_DIR


def uuid_of(seed):
    h = hashlib.md5(seed.encode("utf-8")).hexdigest()
    return "%s-%s-%s-%s-%s" % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])


def compress_uuid(uuid):
    raw = uuid.replace("-", "")
    head, rest = raw[:5], raw[5:]
    bits = bin(int(rest, 16))[2:].zfill(len(rest) * 4)
    return head + "".join(BASE64[int(bits[i:i + 6], 2)] for i in range(0, len(bits), 6))


def file_id(seed):
    digest = hashlib.md5(seed.encode("utf-8")).digest()
    return "".join(BASE64[b % 64] for b in digest)[:22]


def png_size(path):
    with open(path, "rb") as handle:
        handle.read(8)
        handle.read(4)
        chunk = handle.read(4)
        if chunk != b"IHDR":
            raise ValueError("不是 PNG：%s" % path)
        return struct.unpack(">II", handle.read(8))


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def copy_slices():
    os.makedirs(ART_DIR, exist_ok=True)
    for src, dst in SLICES.items():
        src_path = os.path.join(SRC_DIR, src)
        if not os.path.isfile(src_path):
            raise FileNotFoundError(src_path)
        size = png_size(src_path)
        if size != EXPECTED_SIZES[dst]:
            raise ValueError("%s 尺寸 %s 与设计稿 %s 不一致" % (dst, size, EXPECTED_SIZES[dst]))
        shutil.copyfile(src_path, os.path.join(dest_dir_of(dst), dst))
        print("copy %s -> %s %sx%s" % (src, os.path.relpath(os.path.join(dest_dir_of(dst), dst), ROOT), size[0], size[1]))


def image_meta(name, width, height):
    uuid = uuid_of(name)
    return {
        "ver": "1.0.27",
        "importer": "image",
        "imported": True,
        "uuid": uuid,
        "files": [".json", ".png"],
        "subMetas": {
            "6c48a": {
                "importer": "texture",
                "uuid": uuid + "@6c48a",
                "displayName": name.rsplit(".", 1)[0],
                "id": "6c48a",
                "name": "texture",
                "userData": {
                    "wrapModeS": "clamp-to-edge",
                    "wrapModeT": "clamp-to-edge",
                    "imageUuidOrDatabaseUri": uuid,
                    "isUuid": True,
                    "visible": False,
                    "minfilter": "linear",
                    "magfilter": "linear",
                    "mipfilter": "none",
                    "anisotropy": 0,
                },
                "ver": "1.0.22",
                "imported": True,
                "files": [".json"],
                "subMetas": {},
            },
            "f9941": {
                "importer": "sprite-frame",
                "uuid": uuid + "@f9941",
                "displayName": name.rsplit(".", 1)[0],
                "id": "f9941",
                "name": "spriteFrame",
                "userData": {
                    "trimThreshold": 1,
                    "rotated": False,
                    "offsetX": 0,
                    "offsetY": 0,
                    "trimX": 0,
                    "trimY": 0,
                    "width": width,
                    "height": height,
                    "rawWidth": width,
                    "rawHeight": height,
                    "borderTop": 0,
                    "borderBottom": 0,
                    "borderLeft": 0,
                    "borderRight": 0,
                    "packable": PACKABLE.get(name, True),
                    "pixelsToUnit": 100,
                    "pivotX": 0.5,
                    "pivotY": 0.5,
                    "meshType": 0,
                    "vertices": {
                        "rawPosition": [
                            -width / 2, -height / 2, 0,
                            width / 2, -height / 2, 0,
                            -width / 2, height / 2, 0,
                            width / 2, height / 2, 0,
                        ],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, height, width, height, 0, 0, width, 0],
                        "nuv": [0, 0, 1, 0, 0, 1, 1, 1],
                        "minPos": [-width / 2, -height / 2, 0],
                        "maxPos": [width / 2, height / 2, 0],
                    },
                    "isUuid": True,
                    "imageUuidOrDatabaseUri": uuid + "@6c48a",
                    "atlasUuid": "",
                    "trimType": "none",
                },
                "ver": "1.0.12",
                "imported": True,
                "files": [".json"],
                "subMetas": {},
            },
        },
        "userData": {
            "type": "sprite-frame",
            "fixAlphaTransparencyArtifacts": False,
            "hasAlpha": True,
            "redirect": uuid + "@6c48a",
            "compressSettings": {
                "useCompressTexture": True,
                "presetId": "aabpi/bUVNypEx52HEp8vu",
            },
        },
    }


def write_image_metas():
    for name, (width, height) in EXPECTED_SIZES.items():
        write_json(os.path.join(dest_dir_of(name), name + ".meta"), image_meta(name, width, height))
        print("meta %s.meta" % name)


def write_script_meta():
    path = os.path.join(ROOT, PAGE_SCRIPT)
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    write_json(path + ".meta", {
        "ver": "4.0.24",
        "importer": "typescript",
        "imported": True,
        "uuid": PAGE_UUID,
        "files": [],
        "subMetas": {},
        "userData": {},
    })
    print("meta %s.meta (cid %s)" % (PAGE_SCRIPT, compress_uuid(PAGE_UUID)))


class Builder:
    def __init__(self):
        self.items = []
        self._seed = 0

    def add(self, obj):
        self.items.append(obj)
        return len(self.items) - 1

    @staticmethod
    def ref(index):
        return {"__id__": index}

    def next_id(self, kind):
        self._seed += 1
        return file_id("%s#%d" % (kind, self._seed))

    def node(self, name, parent, pos, size, anchor=(0.5, 0.5), active=True):
        node = self.add({
            "__type__": "cc.Node",
            "_name": name,
            "_objFlags": 0,
            "__editorExtras__": {},
            "_parent": self.ref(parent) if parent is not None else None,
            "_children": [],
            "_active": active,
            "_components": [],
            "_prefab": None,
            "_lpos": {"__type__": "cc.Vec3", "x": pos[0], "y": pos[1], "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
            "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
            "_mobility": 0,
            "_layer": UI_2D,
            "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_id": "",
        })
        self.uitransform(node, size, anchor)
        if parent is not None:
            self.items[parent]["_children"].append(self.ref(node))
        return node

    def comp(self, node, body):
        comp = {"__type__": body.pop("__type__"), "_name": "", "_objFlags": 0, "__editorExtras__": {}}
        comp["node"] = self.ref(node)
        comp["_enabled"] = True
        comp["__prefab"] = None
        comp.update(body)
        comp["_id"] = ""
        comp_id = self.add(comp)
        info_id = self.add({"__type__": "cc.CompPrefabInfo", "fileId": self.next_id(comp["__type__"])})
        comp["__prefab"] = self.ref(info_id)
        self.items[node]["_components"].append(self.ref(comp_id))
        return comp_id

    def uitransform(self, node, size, anchor=(0.5, 0.5)):
        return self.comp(node, {
            "__type__": "cc.UITransform",
            "_contentSize": {"__type__": "cc.Size", "width": size[0], "height": size[1]},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": anchor[0], "y": anchor[1]},
        })

    def sprite(self, node, frame, color=(255, 255, 255, 255), sprite_type=0, fill_range=1):
        return self.comp(node, {
            "__type__": "cc.Sprite",
            "_customMaterial": None,
            "_srcBlendFactor": 2,
            "_dstBlendFactor": 4,
            "_color": {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": color[3]},
            "_spriteFrame": {"__uuid__": frame, "__expectedType__": "cc.SpriteFrame"} if frame else None,
            "_type": sprite_type,
            "_fillType": 0,
            "_sizeMode": 0,
            "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0,
            "_fillRange": fill_range,
            "_isTrimmedMode": False,
            "_useGrayscale": False,
            "_atlas": None,
        })

    def uiopacity(self, node, opacity=255):
        return self.comp(node, {"__type__": "cc.UIOpacity", "_opacity": opacity})

    def widget(self, node, flags, size, left=0, right=0, top=0, bottom=0, hcenter=0, vcenter=0, align_mode=2):
        return self.comp(node, {
            "__type__": "cc.Widget",
            "_alignFlags": flags,
            "_target": None,
            "_left": left,
            "_right": right,
            "_top": top,
            "_bottom": bottom,
            "_horizontalCenter": hcenter,
            "_verticalCenter": vcenter,
            "_isAbsLeft": True,
            "_isAbsRight": True,
            "_isAbsTop": True,
            "_isAbsBottom": True,
            "_isAbsHorizontalCenter": True,
            "_isAbsVerticalCenter": True,
            "_originalWidth": size[0],
            "_originalHeight": size[1],
            "_alignMode": align_mode,
            "_lockFlags": 0,
        })

    def label(self, node, text, font_size, line_height, outline_width=2):
        return self.comp(node, {
            "__type__": "cc.Label",
            "_customMaterial": None,
            "_srcBlendFactor": 2,
            "_dstBlendFactor": 4,
            "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_string": text,
            "_horizontalAlign": 1,
            "_verticalAlign": 1,
            "_actualFontSize": font_size,
            "_fontSize": font_size,
            "_fontFamily": "Microsoft YaHei",
            "_lineHeight": line_height,
            "_overflow": 0,
            "_enableWrapText": False,
            "_font": None,
            "_isSystemFontUsed": True,
            "_spacingX": 0,
            "_isItalic": False,
            "_isBold": True,
            "_isUnderline": False,
            "_underlineHeight": 2,
            "_cacheMode": 0,
            "_enableOutline": True,
            "_outlineColor": {"__type__": "cc.Color", "r": 0, "g": 0, "b": 0, "a": 255},
            "_outlineWidth": outline_width,
            "_enableShadow": False,
            "_shadowColor": {"__type__": "cc.Color", "r": 0, "g": 0, "b": 0, "a": 255},
            "_shadowOffset": {"__type__": "cc.Vec2", "x": 2, "y": 2},
            "_shadowBlur": 2,
        })

    def button(self, node):
        return self.comp(node, {
            "__type__": "cc.Button",
            "clickEvents": [],
            "_interactable": True,
            "_transition": 0,
            "_normalColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_hoverColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
            "_pressedColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_disabledColor": {"__type__": "cc.Color", "r": 124, "g": 124, "b": 124, "a": 255},
            "_normalSprite": None,
            "_hoverSprite": None,
            "_pressedSprite": None,
            "_disabledSprite": None,
            "_duration": 0.1,
            "_zoomScale": 1.2,
            "_target": None,
        })

    def prefab_info(self, node, root=1, nested=False):
        info = {
            "__type__": "cc.PrefabInfo",
            "root": self.ref(root),
            "asset": self.ref(0),
            "fileId": self.next_id("node"),
            "instance": None,
            "targetOverrides": None,
        }
        if nested:
            info["nestedPrefabInstanceRoots"] = None
        info_id = self.add(info)
        self.items[node]["_prefab"] = self.ref(info_id)


def frame_of(image_name):
    return uuid_of(image_name) + "@f9941"


def sprite_comp_of(b, node):
    for ref in b.items[node]["_components"]:
        comp = b.items[ref["__id__"]]
        if comp["__type__"] == "cc.Sprite":
            return ref["__id__"]
    raise LookupError("缺 cc.Sprite")


def build_prefab():
    b = Builder()
    b.add({
        "__type__": "cc.Prefab",
        "_name": PREFAB_NAME,
        "_objFlags": 0,
        "__editorExtras__": {},
        "_native": "",
        "data": b.ref(1),
        "optimizationPolicy": 0,
        "persistent": False,
    })

    root = b.node(PREFAB_NAME, None, (0, 0), (CANVAS_W, CANVAS_H))
    b.widget(root, 45, (CANVAS_W, CANVAS_H), align_mode=1)
    page = b.comp(root, {
        "__type__": compress_uuid(PAGE_UUID),
        "closeOnBlank": False,
        "contentNodes": [],
    })
    b.prefab_info(root, nested=True)

    bg = b.node("Bg", root, (0, 0), (CANVAS_W, CANVAS_H))
    b.sprite(bg, frame_of(BG_NAME))
    bg_opacity = b.uiopacity(bg)
    b.widget(bg, 18, (CANVAS_W, CANVAS_H), align_mode=1)
    b.prefab_info(bg)

    touch = b.node("Touch", root, (0, 0), (CANVAS_W, CANVAS_H))
    touch_opacity = b.uiopacity(touch, 0)
    touch_button = b.button(touch)
    b.widget(touch, 45, (CANVAS_W, CANVAS_H), align_mode=1)
    b.prefab_info(touch)

    stage = b.node("Stage", root, (0, CANVAS_H / 2), (CANVAS_W, CANVAS_H), anchor=(0.5, 1))
    b.widget(stage, 18, (CANVAS_W, CANVAS_H), hcenter=0, vcenter=0, align_mode=1)
    b.prefab_info(stage)

    rays = b.node("Rays", stage, center_of("rays"), size_of("rays"))
    b.sprite(rays, frame_of("hdyx_guang.png"))
    rays_opacity = b.uiopacity(rays)
    b.prefab_info(rays)

    shadow = b.node("Shadow", stage, center_of("shadow"), size_of("shadow"))
    b.sprite(shadow, frame_of("hdyx_yinying.png"))
    shadow_opacity = b.uiopacity(shadow)
    b.prefab_info(shadow)

    hero_root = b.node("HeroRoot", stage, center_of("hero"), size_of("hero"))
    hero_opacity = b.uiopacity(hero_root)
    b.prefab_info(hero_root)

    hero_host = b.node("HeroHost", hero_root, (-14.5, -17), size_of("hero"))
    hero_sprite = b.sprite(hero_host, None)
    b.prefab_info(hero_host)

    title = b.node("Title", stage, center_of("title"), size_of("title"))
    b.sprite(title, frame_of("hdyx_title.png"))
    title_opacity = b.uiopacity(title)
    b.prefab_info(title)

    plate = b.node("Plate", stage, center_of("plate"), size_of("plate"))
    b.sprite(plate, frame_of("hdyx_xxk_di.png"))
    plate_opacity = b.uiopacity(plate)
    b.prefab_info(plate)

    badge = b.node("Badge", stage, center_of("badge"), size_of("badge"))
    badge_sprite = b.sprite(badge, None)
    badge_opacity = b.uiopacity(badge)
    b.prefab_info(badge)

    name = b.node("Name", stage, center_of("name"), size_of("name"))
    name_label = b.label(name, "椰蛋战士", 30, 31, 2)
    name_opacity = b.uiopacity(name)
    b.prefab_info(name)

    progress = b.node("ProgressRow", stage, (0, 0), (CANVAS_W, CANVAS_H))
    progress_opacity = b.uiopacity(progress)
    b.prefab_info(progress)

    shard = b.node("Shard", progress, center_of("shard"), size_of("shard"))
    shard_sprite = b.sprite(shard, frame_of("hdyx_icon_suipian.png"))
    b.prefab_info(shard)

    bar_bg = b.node("BarBg", progress, center_of("barBg"), size_of("barBg"))
    bar_bg_sprite = b.sprite(bar_bg, frame_of("hdyx_progress_bg.png"))
    b.prefab_info(bar_bg)

    fill = left_quad_of("barFill")
    bar_fill = b.node("BarFill", progress, (fill[0], fill[1]), (fill[2], fill[3]), anchor=(0, 0.5))
    bar_fill_sprite = b.sprite(bar_fill, frame_of("hdyx_progress_01.png"), sprite_type=3, fill_range=1)
    bar_fill_opacity = b.uiopacity(bar_fill)
    b.prefab_info(bar_fill)

    count = b.node("Count", progress, center_of("count"), size_of("count"))
    count_label = b.label(count, "53/53", 28, 29, 2)
    count_opacity = b.uiopacity(count)
    b.prefab_info(count)

    hint = b.node("Hint", stage, center_of("hint"), size_of("hint"))
    hint_label = b.label(hint, "点击屏幕继续", 28, 29, 2)
    hint_opacity = b.uiopacity(hint)
    b.prefab_info(hint)

    body = b.items[page]
    body["stage"] = b.ref(stage)
    body["bgOpacity"] = b.ref(bg_opacity)
    body["raysNode"] = b.ref(rays)
    body["raysOpacity"] = b.ref(rays_opacity)
    body["titleNode"] = b.ref(title)
    body["titleOpacity"] = b.ref(title_opacity)
    body["heroRoot"] = b.ref(hero_root)
    body["heroOpacity"] = b.ref(hero_opacity)
    body["heroSprite"] = b.ref(hero_sprite)
    body["shadowOpacity"] = b.ref(shadow_opacity)
    body["plateNode"] = b.ref(plate)
    body["plateOpacity"] = b.ref(plate_opacity)
    body["badgeSprite"] = b.ref(badge_sprite)
    body["badgeOpacity"] = b.ref(badge_opacity)
    body["nameLabel"] = b.ref(name_label)
    body["nameOpacity"] = b.ref(name_opacity)
    body["progressRow"] = b.ref(progress)
    body["progressOpacity"] = b.ref(progress_opacity)
    body["barBgSprite"] = b.ref(bar_bg_sprite)
    body["barFillSprite"] = b.ref(bar_fill_sprite)
    body["barFillOpacity"] = b.ref(bar_fill_opacity)
    body["countLabel"] = b.ref(count_label)
    body["countOpacity"] = b.ref(count_opacity)
    body["shardSprite"] = b.ref(shard_sprite)
    body["hintOpacity"] = b.ref(hint_opacity)
    body["hintLabel"] = b.ref(hint_label)
    body["touchButton"] = b.ref(touch_button)

    return b.items


def write_prefab():
    items = build_prefab()
    prefab_path = os.path.join(PREFAB_DIR, PREFAB_NAME + ".prefab")
    write_json(prefab_path, items)
    write_json(prefab_path + ".meta", {
        "ver": "1.1.50",
        "importer": "prefab",
        "imported": True,
        "uuid": uuid_of(PREFAB_NAME + ".prefab"),
        "files": [".json"],
        "subMetas": {},
        "userData": {"syncNodeName": PREFAB_NAME, "hasIcon": False},
    })
    print("prefab %s (%d 条序列化对象)" % (prefab_path, len(items)))


def main():
    copy_slices()
    write_image_metas()
    write_script_meta()
    write_prefab()


if __name__ == "__main__":
    main()
