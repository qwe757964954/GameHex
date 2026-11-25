# -*- coding: utf-8 -*-
"""黑市宝物（StoreGoods）价格条：把「币种图标 + 数字」当**一个整体**居中（2026-11-24）。

用户口径（附黑市截图，红框圈住 `Card0` 的价格条）：
> 「金币 icon 和数字作为整体一起对按钮左右居中、上下居中，金币 icon 和数字间隔 2px」

改前的问题（两张卡都由 prefab 静态摆位，谁都不居中）：
  · `Icon` 44×44 `_lpos=(-7,-10)`、`Value` **60×32 固定盒子** `_lpos=(45,-14)` 且 `hAlign = 0`（左对齐）
    ⇒ 3 位数只占盒子左边一截，盒子右边 12px 是死的 ⇒ 整组视觉中心被推到按钮中线**右侧 12.4px**；
  · `Icon` 锚点 y = 1（顶边），盒高 44 ⇒ 中心落在 `-32`，而按钮竖直中线是 `-30` ⇒ **低 2px**；
  · `Value` 盒子宽 60 装 3 位数，换个位数宽窄不变 ⇒ 静态摆位只能对一种位数居中。

改法（三条一起才成立）：
  1. `Value` 的 `overflow` 2(SHRINK) → **0(NONE)**：盒子宽度跟着文字走，`10/100/1000` 各自贴合；
     顺带把 `_fontSize` 28 → **23**（NONE 下不再被「行高 40 ÷ 盒高 32」压成 22.4，
     23 × 父级 0.8 = 屏上 18.4，仍对着普通宝箱那 18.2）；
  2. 两格锚点都改成 `(0.5, 0.5)`、`_lpos.y` 都落在按钮竖直中线 `-30`
     ⇒ 上下居中与位数无关，运行时不用再算 y；
  3. `x` 交给 `storeCostRowX()`（`StoreCostTable.ts`）在 `refreshGoods()` 里按实测宽度重算
     ⇒ 任何位数都整组居中、间距恒为 `STORE_COST_ICON_GAP`。

prefab 里的 `x` 是按 `"100"` ≈ 38 宽估的**编辑器预览值**，运行时会覆盖：
  · `iconX = -(44 + 2.5 + 38)/2 + 22 = -20.25`
  · `textX = +(44 + 2.5 + 38)/2 - 38/2 = +23.25`

间距单位：`Price` 的 `_lscale = 0.8` ⇒ 作者 2.5 = 设计稿 2px。
幂等：已是目标值则跳过写盘；备份只留改之前那一份。
用法：python tools/config/patch_store_goods_cost_row.py
"""
import io
import json
import os
import shutil

ROOT = 'D:/Alan/Project/POW/Demo3.8'
PREFAB = os.path.join(ROOT, 'assets', 'bundles', 'main-pages', 'ui', 'Store', 'StoreGoods.prefab')
BACKUP_DIR = os.path.join(ROOT, 'tmp', 'backup_store_goods_cost_row_20261124')

CARD_COUNT = 7
BASE_TEXT_WIDTH = 38   #  "100" @ 字号 23 的实测宽（等宽数字估 0.555em），只用来摆编辑器预览位
ICON_X = -20.25      #  = -(44 + 2.5 + 38) / 2 + 44/2
TEXT_X = 23.25       #  =  (44 + 2.5 + 38) / 2 - 38/2
CENTER_Y = -30       #  按钮高 60、锚点 (0.5,1) ⇒ 竖直中线在 -30
FONT_SIZE = 23
LINE_HEIGHT = 23
OVERFLOW_NONE = 0
H_ALIGN_CENTER = 1
VALUE_SIZE = (BASE_TEXT_WIDTH, 24)   #  `overflow = NONE` 下盒子跟着文字走，这里只留个一致的值


def find(entries, path):
    parts = path.split('/')
    root = next((e for e in entries if e and e.get('__type__') == 'cc.Node'), None)
    node = root
    if node is None or node.get('_name') != parts[0]:
        return None
    for name in parts[1:]:
        for ref in (node.get('_children') or []):
            child = entries[ref['__id__']]
            if child.get('_name') == name:
                node = child
                break
        else:
            return None
    return node


def label_of(entries, node):
    for ref in (node.get('_components') or []):
        comp = entries[ref['__id__']]
        if comp.get('__type__') == 'cc.Label':
            return comp
    return None


def set_pos(node, x, y, log, where):
    lpos = node.get('_lpos') or {'__type__': 'cc.Vec3', 'z': 0}
    before = (lpos.get('x'), lpos.get('y'))
    if before == (x, y):
        return
    lpos['x'] = x
    lpos['y'] = y
    lpos.setdefault('z', 0)
    node['_lpos'] = lpos
    log.append('%s 位置 (%s,%s) → (%s,%s)' % (where, before[0], before[1], x, y))


def set_anchor_y(node, y, entries, log, where):
    for ref in (node.get('_components') or []):
        ui = entries[ref['__id__']]
        if ui.get('__type__') != 'cc.UITransform':
            continue
        anchor = ui.get('_anchorPoint') or {'__type__': 'cc.Vec2', 'x': 0.5}
        if anchor.get('y') == y:
            return
        before = anchor.get('y')
        anchor['y'] = y
        anchor.setdefault('x', 0.5)
        anchor['__type__'] = anchor.get('__type__', 'cc.Vec2')
        ui['_anchorPoint'] = anchor
        log.append('%s 锚点 y %s → %s' % (where, before, y))


def main():
    with io.open(PREFAB, encoding='utf-8', newline='') as handle:
        raw = handle.read()
    entries = json.loads(raw)
    log = []

    for i in range(CARD_COUNT):
        base = 'StoreGoods/List/Card%d/Price' % i
        icon = find(entries, base + '/Icon')
        value = find(entries, base + '/Value')
        if icon is None or value is None:
            raise SystemExit('[fail] 找不到 %s/Icon 或 /Value' % base)

        set_anchor_y(icon, 0.5, entries, log, base + '/Icon ')
        set_pos(icon, ICON_X, CENTER_Y, log, base + '/Icon')

        set_anchor_y(value, 0.5, entries, log, base + '/Value ')
        set_pos(value, TEXT_X, CENTER_Y, log, base + '/Value')

        label = label_of(entries, value)
        if label is None:
            raise SystemExit('[fail] %s/Value 不是 Label' % base)
        for key, want in (('_fontSize', FONT_SIZE), ('_actualFontSize', FONT_SIZE),
                          ('_lineHeight', LINE_HEIGHT), ('_overflow', OVERFLOW_NONE),
                          ('_horizontalAlign', H_ALIGN_CENTER)):
            before = label.get(key)
            if before != want:
                label[key] = want
                log.append('%s/Value %s %s → %s' % (base, key, before, want))
        #  盒子跟着文字走，序列化的值只当编辑器预览 ⇒ 与上面按 38 宽算出来的位置对齐。
        for ref in (value.get('_components') or []):
            ui = entries[ref['__id__']]
            if ui.get('__type__') != 'cc.UITransform':
                continue
            size = ui.get('_contentSize') or {}
            before = (size.get('width'), size.get('height'))
            if before == VALUE_SIZE:
                break
            ui['_contentSize'] = {'__type__': 'cc.Size', 'width': VALUE_SIZE[0], 'height': VALUE_SIZE[1]}
            log.append('%s/Value 盒子 %s×%s → %s×%s' % ((base,) + before + VALUE_SIZE))
            break

    if not log:
        print('[skip] 已是目标值')
        return
    text = json.dumps(entries, ensure_ascii=False, indent=2)
    if text.count('\n') != raw.count('\n'):
        raise SystemExit('[fail] 重写后行数 %d ≠ 原文 %d，放弃' % (text.count('\n'), raw.count('\n')))
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'StoreGoods.prefab')
    if not os.path.exists(backup):
        shutil.copy2(PREFAB, backup)
    with io.open(PREFAB, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)
    for line in log:
        print('  [ok] ' + line)
    print('[sum] 共改 %d 处' % len(log))


if __name__ == '__main__':
    main()
