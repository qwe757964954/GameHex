# -*- coding: utf-8 -*-
"""商店界面：把「按钮内的消耗数字 / 币种图标」统一到普通宝箱那一套（2026-11-24）。

用户口径（附 `StoreGemBox` 普通宝箱截图）：
> 「按照现在普通宝箱 抽取按钮的 数字字号和 icon 大小，调整整个商店界面的按钮内的消耗数字大小」
随后选定：**按屏幕上看一样大**，而不是「作者值都写 20」。

────────────────────────────────────────────────────────────────────────────
一、屏幕上「普通宝箱」那个数字到底多大？

`StoreGemBox.prefab` 里 `Buy1/Cost/Value` 是 `_fontSize = 20`，但**没人看到过 20**：

  · 这几个 Label 都是 `overflow = SHRINK`（2）且 `_lineHeight = 40`；
  · 盒子只有 44×26 ⇒ Cocos 按「行高 40 塞进 26 的盒」把它压到 `_actualFontSize = 13`；
  · 而商店外壳 `Store.prefab` 的 `Sec0_StoreGemBox` 带一层**深覆盖**，把那几个
    `_fontSize` 改成了 28 ⇒ 实际渲染 28 × 26/40 = 18.2 ⇒ `_actualFontSize = 18`。

即：**屏上 18px。** 反查方法 —— 实算字号 ≈ `字号 × min(1, 盒子高 ÷ 行高)`，
三处独立验证：银币 22×32/40 = 17.6 → 17、宝箱 20×26/40 = 13.0 → 13、壳覆盖 28×26/40 = 18.2 → 18。

二、所以「统一」= 反算，不是照抄 20

屏上尺寸 = `字号 × min(1, 盒子高/40) × 父级缩放`、图标 = `边长 × 父级缩放`。
各段的盒子高与父缩放都不同（礼包还压成 0.8×0.7 非等比），照抄 20 反而会散得更开：

  | 分段 | 父缩放 | 盒高/40 | 盒子 | 改前屏上 | 写 20 后 | **本脚本** | 落地屏上 |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 宝石宝箱 | 1.0 | 0.65 | 44×26 | 18.2 | 18.2（不动） | 不动 | 18.2 |
  | 等级礼包 | 0.8 × 0.7 | 1.00 | 84×42 | 18.2 | 14.0 | 字号 26 / 图标 50 | 18.2 / 40×35 |
  | 金币 | 0.85 | 0.85 | 120×34 | 21.7 | 14.5 | 字号 25 | 18.1 |
  | 银币 | 1.0 | 0.80 | 80×32 | 17.6 | 16.0 | 字号 23 / 图标 35 | 18.4 / 35×35 |
  | 黑市宝物 | 0.80 | 0.80 | 60×32 | 14.1 | 12.8 | 字号 28 / 图标 44 | 17.9 / 35×35 |

改前真正离谱的只有金币（21.7，偏大）和黑市（14.1，偏小）；礼包 26 本来就是对的。

三、为什么有两个节点要跟着挪位

图标是 Sprite，改边长会**以中心为轴**两边各长一半 ⇒ 会啃进旁边的数字：
  · 银币：版式是「图标右缘贴数字左缘」（都在卡内 97）⇒ 30→35 会压进去 2.5，中心往左让到 −20.5；
  · 礼包：40→50 右缘会盖住文案 ⇒ −41 → −46，维持原来 2 的间隙；
  · 黑市：40→44 ⇒ 中心 −5 → −7，右缘仍与数字左缘齐平。

四、礼包页注定差一点

`BuyBtn` 是 `scale(0.8, 0.7)` **非等比压扁**（160×80 → 128×56），里面的字和图标
不可能同时对上宽高。这里按**高度**对齐（字高与图标竖直直径是主要的尺寸感来源）
⇒ 礼包那枚币屏上 40×35，比宝箱的圆略宽。要完全正圆得改 `BuyBtn` 的缩放，
那会连带把按钮视觉高度从 56 抬到 64，属版面改动，不在本次范围。

────────────────────────────────────────────────────────────────────────────
只改这四处、不动别的：
  · `AdBtn`（免费抽）里是「免费」文案 + 广告图标，不是消耗数字；
  · `Own`（拥有数量）不是按钮；
  · `StoreSilver/Card0/Price/Video` 是广告播放图标，不是币种；
  · 各卡的主图标（卡根下的 `Icon`，100×100 / 135×135）是商品本身，不是币种。

幂等：已是目标值则跳过写盘。备份只留**改之前**那一份（二次运行不会覆盖）。
用法：python tools/config/patch_store_price_style.py
"""
import io
import json
import os
import shutil

ROOT = 'D:/Alan/Project/POW/Demo3.8'
DIR = os.path.join(ROOT, 'assets', 'bundles', 'main-pages', 'ui', 'Store')
BACKUP_DIR = os.path.join(ROOT, 'tmp', 'backup_store_price_style_20261124')

#  「普通宝箱」屏上基准（不动的那一段）
BASE_FONT = 18.2
BASE_ICON = 35

#  文件 → [(节点路径, 要改的组件, 目标值)]。路径与 `tests/store.test.ts` 的 `analyze()` 同构：
#  从 prefab 根名开始逐层拼，中间不跳级。
EDITS = {
    'StoreLevelGift': [
        #  父缩放 0.8×0.7、盒高 42 ≥ 行高 40 ⇒ 不再二次缩字
        #  字号 26 × 1.00 × 0.7 = 18.2；图标 50 × 0.7 = 35（宽 40）
        ('StoreLevelGift/List/Card/BuyBtn/Icon', 'size', (50, 50)),
        ('StoreLevelGift/List/Card/BuyBtn/Icon', 'posx', -46),
        ('StoreLevelGift/List/Card/BuyBtn/Label', 'font', 26),
    ],
    'StoreGold': [
        #  父缩放 0.85、盒高 34 ⇒ 25 × （34/40） × 0.85 = 18.1
        (f'StoreGold/List/Card{i}/Price/Label', 'font', 25) for i in range(6)
    ],
    'StoreSilver': [
        #  父缩放 1.0、盒高 32 ⇒ 23 × 0.80 = 18.4；图标 35 × 1.0 = 35
        ('StoreSilver/List/Card0/Price/Label', 'font', 23),
        ('StoreSilver/List/Card1/Price/Label', 'font', 23),
        ('StoreSilver/List/Card2/Price/Label', 'font', 23),
        ('StoreSilver/List/Card3/Price/Label', 'font', 23),
        ('StoreSilver/List/Card1/Price/Icon', 'size', (35, 35)),
        ('StoreSilver/List/Card2/Price/Icon', 'size', (35, 35)),
        ('StoreSilver/List/Card3/Price/Icon', 'size', (35, 35)),
        #  版式口径是「图标右缘贴数字左缘」（都在卡内 97）⇒ 30→35 会各吃一半、
        #  右缘压进数字 2.5px。往左让 2.5，右缘原地不动。
        ('StoreSilver/List/Card1/Price/Icon', 'posx', -20.5),
        ('StoreSilver/List/Card2/Price/Icon', 'posx', -20.5),
        ('StoreSilver/List/Card3/Price/Icon', 'posx', -20.5),
    ],
    'StoreGoods': [
        #  父缩放 0.80、盒高 32 ⇒ 28 × 0.80 × 0.80 = 17.9；图标 44 × 0.8 = 35.2
        (f'StoreGoods/List/Card{i}/Price/Icon', 'size', (44, 44)) for i in range(7)
    ] + [
        #  中心 −5 → −7：44 边长下右缘仍与数字左缘齐平（卡内 112）
        (f'StoreGoods/List/Card{i}/Price/Icon', 'posx', -7) for i in range(7)
    ] + [
        (f'StoreGoods/List/Card{i}/Price/Value', 'font', 28) for i in range(7)
    ],
}


def load(path):
    with io.open(path, encoding='utf-8', newline='') as handle:
        raw = handle.read()
    return raw, json.loads(raw)


def dump(entries):
    return json.dumps(entries, ensure_ascii=False, indent=2)


def comp_of(entries, node, kind):
    for ref in (node.get('_components') or []):
        comp = entries[ref['__id__']]
        if comp.get('__type__') == kind:
            return comp
    return None


def find(entries, path):
    """按「根名/子名/…」定位节点；找不到返回 None。"""
    parts = path.split('/')
    root = next((e for e in entries if e and e.get('__type__') == 'cc.Node'), None)
    if root is None or root.get('_name') != parts[0]:
        return None
    node = root
    for name in parts[1:]:
        child = None
        for ref in (node.get('_children') or []):
            candidate = entries[ref['__id__']]
            if candidate.get('_name') == name:
                child = candidate
                break
        if child is None:
            return None
        node = child
    return node


def patch(name, edits):
    path = os.path.join(DIR, f'{name}.prefab')
    raw, entries = load(path)
    changes = []
    for node_path, kind, value in edits:
        node = find(entries, node_path)
        if node is None:
            raise SystemExit('[fail] %s 里找不到节点 %s' % (name, node_path))
        if kind == 'font':
            label = comp_of(entries, node, 'cc.Label')
            if label is None:
                raise SystemExit('[fail] %s 不是 Label' % node_path)
            before = label.get('_fontSize')
            if before != value:
                label['_fontSize'] = value
                changes.append('%s 字号 %s → %s' % (node_path, before, value))
        elif kind == 'posx':
            lpos = node.get('_lpos') or {}
            before = lpos.get('x')
            if before != value:
                lpos['x'] = value
                node['_lpos'] = lpos
                changes.append('%s 横移 %s → %s' % (node_path, before, value))
        else:
            ui = comp_of(entries, node, 'cc.UITransform')
            if ui is None:
                raise SystemExit('[fail] %s 没有 UITransform' % node_path)
            size = ui.get('_contentSize') or {}
            before = (size.get('width'), size.get('height'))
            if before != value:
                ui['_contentSize'] = {'__type__': 'cc.Size', 'width': value[0], 'height': value[1]}
                changes.append('%s 尺寸 %s×%s → %s×%s' % ((node_path,) + before + value))
    if not changes:
        print('[skip] %s 已是目标值' % name)
        return 0
    text = dump(entries)
    #  自检：行数必须与原文一致（说明只是改值，没有结构性重排 / __id__ 漂移）。
    if text.count('\n') != raw.count('\n'):
        raise SystemExit('[fail] %s 重写后行数 %d ≠ 原文 %d，放弃' % (name, text.count('\n'), raw.count('\n')))
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, f'{name}.prefab')
    #  只留**改之前**那一份：二次运行不能拿已改过的文件覆盖备份。
    if not os.path.exists(backup):
        shutil.copy2(path, backup)
    with io.open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)
    for line in changes:
        print('  [ok] %s' % line)
    print('[ok] %s 改 %d 处' % (name, len(changes)))
    return len(changes)


def main():
    total = 0
    for name, edits in EDITS.items():
        total += patch(name, edits)
    print('[sum] 共改 %d 处（口径：屏上字高 %.1f、图标 %d×%d）'
          % (total, BASE_FONT, BASE_ICON, BASE_ICON))


if __name__ == '__main__':
    main()
