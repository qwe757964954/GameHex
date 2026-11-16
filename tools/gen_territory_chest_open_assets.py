# -*- coding: utf-8 -*-
"""生成「领地宝箱开启」奖励页的资源：7 张切图 + `.meta` + prefab。

设计稿：蓝湖「宝箱开启」(`pid 36a56744…` / `image_id 5ed5552e…`)，画布 720×1610，
xhdpi `sliceScale=2` 导出的切图是 **1:1 设计像素**（不用再乘 2）。

用法：`python tools/gen_territory_chest_open_assets.py`
（幂等：每次都整份重写 meta / prefab，切图只拷贝不修改）

⚠️ prefab 是**整份重写**的：在编辑器里手改过 prefab 之后再跑本脚本，手改内容会被覆盖。
   布局的最终真源是 `assets/resources/ui/territory/TerritoryChestOpen.prefab`
   （Cards/RowTemplate 的 `cc.Layout`、各节点的 `UITransform`/`Widget`）；运行时
   `TerritoryChestOpenPage` 只按列数分行并读取 prefab 的边距/尺寸，不再维护第二份栅格常量。

## 为什么 meta 要脚本写而不是让编辑器导

prefab 里 `cc.Sprite._spriteFrame` 存的是 `<图片 uuid>@f9941`，脚本要在 **导入前** 就知道这个 uuid。
用固定 uuid 写 meta，prefab 才能一次写对；编辑器导入时认已有的 meta，不会重新分配。
`uuid` 由文件名 md5 派生 ⇒ 同一份文件名永远同一条 uuid，重跑脚本不会换 id。

⚠️ 子资源 id 是 Cocos 的固定约定：`6c48a` = texture、`f9941` = spriteFrame，
`trimType: none` 才能让 SpriteFrame 的 rect = 整图（卡框是 139×185 整图，裁一刀就歪）。

## prefab 的节点树

```
TerritoryChestOpen   720×1610  Widget 四边拉伸（长屏适配：顶上锚卡片、底下锚宝箱）
├── Bg               720×1610  Widget 四边拉伸 + UIOpacity（入场淡入；图在 image/ 根，不进图集）
├── Cards            580×401   Widget top=432 / hCenter=0（锚点 0.5,1 = 顶部中心）
│   ├── RowTemplate  580×185   inactive；cc.Layout 横向（spacingX=8、CONTAINER），页面按列数克隆
│   └── CardTemplate 139×185   inactive（运行时 instantiate 到行里；渲染序 Frame→Icon→Band→Count）
│       ├── Frame    139×185   品质卡框（默认蓝框，运行时按 quality 换 01~04）
│       ├── Icon     112×147   y=-3（图标位顶边距卡顶 22）
│       ├── Band     122×29    (-0.5,-70) 数量底条（盖住图标下沿）
│       └── Count    122×29    (-0.5,-70) 数量文字
├── Chest            282×277   Widget bottom=199 / hCenter=-6.5（可见 art 右偏 6.5）
├── Skip             123×64    Widget top=102 / left=31（文字 123×36 居中，触摸框加高）
└── Close            148×64    Widget bottom=126 / hCenter=0
```

产物落点：
· `assets/resources/image/bg_chest_open.png`（720×1610 大图，**不进图集**）
· `assets/resources/image/territory/chest_open/`（其余 6 张，随 `image/territory` 的 auto-atlas 合批）
"""
import hashlib
import json
import os
import shutil
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = r"C:\Users\hedao\Downloads\宝箱开启_slices\mipmap-xhdpi"
RES_IMAGE_DIR = os.path.join(ROOT, "assets", "resources", "image")
ART_DIR = os.path.join(RES_IMAGE_DIR, "territory", "chest_open")
PREFAB_DIR = os.path.join(ROOT, "assets", "resources", "ui", "territory")
PREFAB_NAME = "TerritoryChestOpen"
SCRIPT_DIR = os.path.join(ROOT, "assets", "script")

# 切图源文件名 → 工程文件名（设计稿原名 bxkq_* 保留前缀，去掉了 kqbx / baoixnag 这类拼写噪声）
SLICES = {
    "bxkq_bg.png": "bg_chest_open.png",
    "bxkq_img_baoixnag_02.png": "chest_open_chest.png",
    "bxkq_kp_01.png": "chest_open_card_01.png",
    "bxkq_kp_02.png": "chest_open_card_02.png",
    "bxkq_kp_03.png": "chest_open_card_03.png",
    "kqbx_kp_04.png": "chest_open_card_04.png",
    "kp_heidi.png": "chest_open_card_band.png",
}

# 整屏底图**不放** `territory/chest_open/`：720×1610 超出该图集 1024×1024 的页高，
# 构建期会被切图（`tests/auto-atlas-capacity.test.ts` C4 会红）。`image/` 根按规范禁止放 pac，
# 天然是「不进图集的大图区」（`bg_main` 同处）。
BG_NAME = "bg_chest_open.png"

# 期望尺寸（设计稿量测值，写死是为了「切图换了却没改布局」时立刻炸）
EXPECTED_SIZES = {
    "bg_chest_open.png": (720, 1610),
    "chest_open_chest.png": (282, 277),
    "chest_open_card_01.png": (139, 185),
    "chest_open_card_02.png": (139, 185),
    "chest_open_card_03.png": (139, 185),
    "chest_open_card_04.png": (139, 185),
    "chest_open_card_band.png": (122, 29),
}

# 整屏底图不进图集（其余 6 张被打进 image/territory 的自动图集，合批）
PACKABLE = {
    BG_NAME: False,
}


def dest_dir_of(name):
    return RES_IMAGE_DIR if name == BG_NAME else ART_DIR

# 脚本 uuid 固定：prefab 里自定义组件的 `__type__` 就是脚本 uuid 的压缩形式
SCRIPT_UUIDS = {
    "assets/script/app/territory/view/TerritoryChestOpenPage.ts": "a7d34c69-2f19-4b52-9c8e-6d1b7f40e3a8",
    "assets/script/app/territory/view/TerritoryChestOpenCard.ts": "c58e21b0-7a4d-4f69-8b2e-91c0d5a34f17",
    "assets/script/app/territory/view/TerritoryChestOpenArt.ts": "e41b9d76-3c58-4a0f-95d2-8b6a7c1e4f30",
    "assets/script/app/territory/model/TerritoryChestOpenLayout.ts": "f72a58c4-9d06-4117-b8e3-2c5a9d6f1b48",
}
PAGE_SCRIPT = "assets/script/app/territory/view/TerritoryChestOpenPage.ts"
CARD_SCRIPT = "assets/script/app/territory/view/TerritoryChestOpenCard.ts"

UI_2D = 33554432
BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

# 设计稿常量（与 TerritoryChestOpenLayout.ts 同源；这里只用来摆 prefab 的**初始**位置，
# 运行时的定位仍以 Widget + 纯函数为准）
CANVAS_W = 720
CANVAS_H = 1610
CARD_TOP = 432


def uuid_of(seed):
    h = hashlib.md5(seed.encode("utf-8")).hexdigest()
    return "%s-%s-%s-%s-%s" % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])


def compress_uuid(uuid):
    """Cocos 的压缩 uuid：前 5 个 hex 原样，其余 27 个 hex（108 bit）按 6 bit 查表。"""
    raw = uuid.replace("-", "")
    head, rest = raw[:5], raw[5:]
    bits = bin(int(rest, 16))[2:].zfill(len(rest) * 4)
    return head + "".join(BASE64[int(bits[i:i + 6], 2)] for i in range(0, len(bits), 6))


def file_id(seed):
    """prefab 内部的 fileId（22 字符，基 64 字母表；只要求同文件内唯一）。"""
    digest = hashlib.md5(seed.encode("utf-8")).digest()
    return "".join(BASE64[b % 64] for b in digest)[:22]


def png_size(path):
    with open(path, "rb") as handle:
        handle.read(8)
        handle.read(4)
        chunk = handle.read(4)
        if chunk != b"IHDR":
            raise ValueError("不是 PNG：%s" % path)
        width, height = struct.unpack(">II", handle.read(8))
    return width, height


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


# ============================================================
# 1. 切图 + meta
# ============================================================

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
    packable = PACKABLE.get(name, True)
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
                    "packable": packable,
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
        print("meta %s.meta (%s)" % (name, os.path.relpath(dest_dir_of(name), ROOT)))


def write_script_metas():
    for rel, uuid in SCRIPT_UUIDS.items():
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            raise FileNotFoundError(path)
        write_json(path + ".meta", {
            "ver": "4.0.24",
            "importer": "typescript",
            "imported": True,
            "uuid": uuid,
            "files": [],
            "subMetas": {},
            "userData": {},
        })
        print("meta %s.meta (cid %s)" % (rel, compress_uuid(uuid)))


# ============================================================
# 2. prefab
# ============================================================

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
        # 先把 UITransform 挂上：3.x 的 cc.Node 必须显式带它，否则 Sprite/Label 不渲染
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

    def sprite(self, node, frame, color=(255, 255, 255, 255)):
        return self.comp(node, {
            "__type__": "cc.Sprite",
            "_customMaterial": None,
            "_srcBlendFactor": 2,
            "_dstBlendFactor": 4,
            "_color": {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": color[3]},
            "_spriteFrame": {"__uuid__": frame, "__expectedType__": "cc.SpriteFrame"} if frame else None,
            "_type": 0,
            "_fillType": 0,
            "_sizeMode": 0,
            "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0,
            "_fillRange": 0,
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

    def layout(
        self,
        node,
        layout_type,
        resize_mode=1,
        cell_size=(0, 0),
        start_axis=0,
        padding=(0, 0, 0, 0),
        spacing=(0, 0),
        vertical_direction=1,
        horizontal_direction=0,
        constraint=0,
        constraint_num=0,
        affected_by_scale=False,
        is_align=False,
    ):
        return self.comp(node, {
            "__type__": "cc.Layout",
            "_resizeMode": resize_mode,
            "_layoutType": layout_type,
            "_cellSize": {"__type__": "cc.Size", "width": cell_size[0], "height": cell_size[1]},
            "_startAxis": start_axis,
            "_paddingLeft": padding[0],
            "_paddingRight": padding[1],
            "_paddingTop": padding[2],
            "_paddingBottom": padding[3],
            "_spacingX": spacing[0],
            "_spacingY": spacing[1],
            "_verticalDirection": vertical_direction,
            "_horizontalDirection": horizontal_direction,
            "_constraint": constraint,
            "_constraintNum": constraint_num,
            "_affectedByScale": affected_by_scale,
            "_isAlign": is_align,
        })

    def label(self, node, text, font_size, line_height, outline_width=2, font_family="Microsoft YaHei"):
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
            "_fontFamily": font_family,
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
    """切图名 → prefab 里引用的 SpriteFrame uuid（`<image uuid>@f9941`）。"""
    return uuid_of(image_name) + "@f9941"


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

    # ── 根：720×1610 + 四边拉伸（长屏适配）───────────────────────────
    root = b.node(PREFAB_NAME, None, (0, 0), (CANVAS_W, CANVAS_H))
    root_widget = b.widget(root, 45, (CANVAS_W, CANVAS_H))
    page_comp = b.comp(root, {
        "__type__": compress_uuid(SCRIPT_UUIDS[PAGE_SCRIPT]),
        "popupLayer": 0,
        "closeOnBlank": True,
        "contentNodes": [],
        "bgOpacity": None,
        "cardsRoot": None,
        "rowTemplate": None,
        "cardTemplate": None,
        "gridColumns": 4,
        "gridMinScale": 0.7,
        "gridBottomGap": 16,
        "chestNode": None,
        "chestOpacity": None,
        "skipButton": None,
        "skipOpacity": None,
        "closeButton": None,
        "skipLabel": None,
        "closeLabel": None,
    })
    b.prefab_info(root, nested=True)

    # ── Bg：整屏底图（四边拉伸，UIOpacity 做入场淡入）───────────────
    bg = b.node("Bg", root, (0, 0), (CANVAS_W, CANVAS_H))
    b.sprite(bg, frame_of(BG_NAME))
    bg_opacity = b.uiopacity(bg)
    b.widget(bg, 45, (CANVAS_W, CANVAS_H))
    b.prefab_info(bg)

    # ── Cards：顶部锚定（容器锚点 0.5/1 ⇒ 局部原点就是它自己的顶边中心）──
    cards = b.node("Cards", root, (0, CANVAS_H / 2 - CARD_TOP), (580, 401), anchor=(0.5, 1))
    b.widget(cards, 17, (580, 401), top=CARD_TOP, hcenter=0)
    # 纵向 Layout：页面按列数分行，行高/行距由 prefab 决定，不再用纯函数算 y。
    b.layout(cards, 2, resize_mode=1, spacing=(8, 31), vertical_direction=1, is_align=True)
    b.prefab_info(cards)

    # 行模板：横向 Layout，页面按列数往里塞卡；不足一行的卡由容器宽度居中。
    row = b.node("RowTemplate", cards, (0, -92.5), (580, 185), active=False)
    b.layout(row, 1, resize_mode=1, spacing=(8, 0), horizontal_direction=0, is_align=True)
    b.prefab_info(row)

    card = b.node("CardTemplate", cards, (0, -92.5), (139, 185), active=False)
    card_opacity = b.uiopacity(card)
    card_comp = b.comp(card, {
        "__type__": compress_uuid(SCRIPT_UUIDS[CARD_SCRIPT]),
        "frame": None,
        "icon": None,
        "count": None,
        "opacity": None,
        "iconMaxUpscale": 2,
    })
    b.prefab_info(card)

    frame = b.node("Frame", card, (0, 0), (139, 185))
    b.sprite(frame, frame_of("chest_open_card_04.png"))
    b.prefab_info(frame)

    icon = b.node("Icon", card, (0, -3), (112, 147))
    b.sprite(icon, None)
    b.prefab_info(icon)

    band = b.node("Band", card, (-0.5, -70), (122, 29))
    b.sprite(band, frame_of("chest_open_card_band.png"))
    b.prefab_info(band)

    count = b.node("Count", card, (-0.5, -70), (122, 29))
    count_label = b.label(count, "X1", 22, 26, 2)
    b.prefab_info(count)

    # ── Chest：底部锚定，可见 art 重心对齐屏幕中心（x = -6.5）────────
    # Widget 用 ALWAYS(1)：Sprite 在 onLoad 会先把 UITransform 改成裁切后的 282×235，
    # 一次性对齐（ONCE）或只在窗口 resize 时的对齐都会停在错的 y（本页曾因此低 21px）。
    chest = b.node("Chest", root, (-6.5, (199 + 277 / 2) - CANVAS_H / 2), (282, 277))
    b.sprite(chest, frame_of("chest_open_chest.png"))
    chest_opacity = b.uiopacity(chest)
    b.widget(chest, 20, (282, 277), bottom=199, hcenter=-6.5, align_mode=1)
    b.prefab_info(chest)

    # ── Skip：左上，文字 123×36，触摸框 123×64（上下各放 28）─────────
    skip = b.node("Skip", root, (31 + 123 / 2 - CANVAS_W / 2, CANVAS_H / 2 - 102 - 64 / 2), (123, 64))
    skip_label = b.label(skip, "跳过>>", 37, 37)
    skip_opacity = b.uiopacity(skip)
    skip_button = b.button(skip)
    b.widget(skip, 9, (123, 64), left=31, top=102)
    b.prefab_info(skip)

    # ── Close：底部居中，文字 148×36，触摸框 148×64 ──────────────────
    close = b.node("Close", root, (0, (126 + 64 / 2) - CANVAS_H / 2), (148, 64))
    close_label = b.label(close, "点击关闭", 37, 37)
    close_button = b.button(close)
    b.widget(close, 20, (148, 64), bottom=126, hcenter=0)
    b.prefab_info(close)

    # ── 回填脚本引用（必须在所有节点/组件都存在之后）────────────────
    page = b.items[page_comp]
    page["bgOpacity"] = b.ref(bg_opacity)
    page["cardsRoot"] = b.ref(cards)
    page["rowTemplate"] = b.ref(row)
    page["cardTemplate"] = b.ref(card)
    page["chestNode"] = b.ref(chest)
    page["chestOpacity"] = b.ref(chest_opacity)
    page["skipButton"] = b.ref(skip_button)
    page["skipOpacity"] = b.ref(skip_opacity)
    page["closeButton"] = b.ref(close_button)
    page["skipLabel"] = b.ref(skip_label)
    page["closeLabel"] = b.ref(close_label)

    card_body = b.items[card_comp]
    card_body["frame"] = b.ref(frame_sprite_comp(b, frame))
    card_body["icon"] = b.ref(frame_sprite_comp(b, icon))
    card_body["count"] = b.ref(count_label)
    card_body["opacity"] = b.ref(card_opacity)

    return b.items


def frame_sprite_comp(b, node):
    for ref in b.items[node]["_components"]:
        comp = b.items[ref["__id__"]]
        if comp["__type__"] == "cc.Sprite":
            return ref["__id__"]
    raise LookupError("缺 cc.Sprite")


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
    write_script_metas()
    write_prefab()


if __name__ == "__main__":
    main()
