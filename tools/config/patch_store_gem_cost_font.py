# -*- coding: utf-8 -*-
"""宝石宝箱（StoreGemBox）：把两张卡的消耗数字字号补到 18（2026-11-24）。

用户口径（附「高级宝箱」截图，红框圈住「抽1次 ✕ 250」的那个 250）：
> 「高级宝藏的消耗数字没调整」

🔴 根因：两张卡在 prefab 里**完全一样**（都是 `_fontSize = 20`），差别全在商店外壳
`Store.prefab` 的 `Sec0_StoreGemBox` —— 它只给 `Card0` 的 `Buy1/Cost/Value`、
`Buy10/Cost/Value`、两张卡的 `Own/Value` 各加了一条 `_fontSize = 28` 的深覆盖。
`Card1`（高级宝箱，紫色宝石那张）的两个 `Cost/Value` **漏了**，于是：

  · Card0 消耗数字：外壳 28 ⇒ 28 × 26/40 = **18.2**（屏上）
  · Card1 消耗数字：没有覆盖 ⇒ 20 × 26/40 = **13.0**（屏上）← 截图里那个偏小的

所以修在 prefab（真源），而不是再给外壳补覆盖：外壳那 4 条覆盖与 prefab 写 28 后完全等价，
留着无害；以后单独打开 `StoreGemBox.prefab` 也不会再看到 13 号字。

**为什么要连位置一起改**：字号 20→28 后，4 位数「2500」的文字实测宽 40.4，
而消耗区（`Cost` 76 宽 / 按钮内 3.5~80 共 76.5）只够
`图标 35 + 间距 + 文字 40.4` ⇒ 间距只剩 1。原来的 `_lpos.x = 10`（居中）会让文字
从 −10 起，压到金币右缘（−3）上 7 个单位 ⇒ 一并改成左对齐、`x = 20`（文字左缘 −2）。

落值（两张卡一致）：
  `Buy1/Cost/Value`、`Buy10/Cost/Value`：字号 28、实算 18、左对齐、`_lpos.x = 20`
  `Own/Value`：字号 28、实算 20（盒高 29 ⇒ 28 × 29/40 = 20.3，与外壳那条一致）

⚠️ 上限：4 位数正好贴到按钮右沿（79.9 / 80）。若出现 5 位数，`SHRINK` 会按 44 宽把字压到
15.9 并向右顶出 ~3.5 —— 现有数据最长 2500，够用；真出现 5 位数应改成整组居中（`storeCostRowX`）。

幂等：已是目标值则跳过写盘；备份只留改之前那一份。
用法：python tools/config/patch_store_gem_cost_font.py
"""
import io
import json
import os
import shutil

ROOT = 'D:/Alan/Project/POW/Demo3.8'
PREFAB = os.path.join(ROOT, 'assets', 'bundles', 'main-pages', 'ui', 'Store', 'StoreGemBox.prefab')
SHELL = os.path.join(ROOT, 'assets', 'bundles', 'main-pages', 'ui', 'Store', 'Store.prefab')
BACKUP_DIR = os.path.join(ROOT, 'tmp', 'backup_store_gem_cost_font_20261124')

FONT_COST = 28          #  × 盒高 26 / 行高 40 = 屏上 18.2
FONT_OWN = 28           #  × 盒高 29 / 行高 40 = 屏上 20.3
ACTUAL_COST = 18
ACTUAL_OWN = 20
COST_VALUE_X = 20       #  左对齐时文字左缘 = 20 − 44/2 = −2（图标右缘 −3 ⇒ 间距 1）
H_ALIGN_LEFT = 0
H_ALIGN_CENTER = 1

#  (叶子路径, 字号, 实算字号, hAlign, _lpos.x 或 None)
#  ⚠️ `Own/Value` 保持**居中**：它的盒子 44 宽、图标右缘在 −1，改左对齐会把「拥有数量」
#     从 11.5 附近拽到 −10.5，直接压到金币上。外壳也没覆盖它的 hAlign。
TARGETS = (
    ('Buy1/Cost/Value', FONT_COST, ACTUAL_COST, H_ALIGN_LEFT, COST_VALUE_X),
    ('Buy10/Cost/Value', FONT_COST, ACTUAL_COST, H_ALIGN_LEFT, COST_VALUE_X),
    ('Own/Value', FONT_OWN, ACTUAL_OWN, H_ALIGN_CENTER, None),
)


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


def patch_shell_costs():
    """把外壳对 `Card0` 消耗数字的两条 `_lpos` 旧覆盖归到 prefab 的同值。

    外壳原来只给 `Card0` 加覆盖，位置还是手调的 `(17,-2)`；prefab 现在是 `(20,-1)`。
    不归一就会有 3 个单位的错位，而且「prefab 是一套、场景里是另一套」正是这次 bug 的成因。
    只改覆盖对象里的**值**，不动数组结构 ⇒ `__id__` 不会漂。
    """
    with io.open(SHELL, encoding='utf-8', newline='') as handle:
        raw = handle.read()
    entries = json.loads(raw)

    log = []
    for i, entry in enumerate(entries):
        if not (entry and entry.get('__type__') == 'CCPropertyOverrideInfo'):
            continue
        if (entry.get('propertyPath') or []) != ['_lpos']:
            continue
        value = entry.get('value') or {}
        if value.get('__type__') != 'cc.Vec3':
            continue
        #  只认当初手调的那一对 (17,-2)：整个 Store.prefab 里就这两条。
        if value.get('x') != 17 or value.get('y') != -2:
            continue
        value['x'] = COST_VALUE_X
        value['y'] = -1
        entry['value'] = value
        log.append('Store.prefab 覆盖 #%d _lpos (17,-2) → (%d,-1)' % (i, COST_VALUE_X))

    if not log:
        print('[skip] 外壳覆盖已是目标值')
        return 0
    #  断言命中数：多一条少一条都说明外壳结构变了，宁可停下。
    if len(log) != 2:
        raise SystemExit('[fail] 期望命中 2 条外壳覆盖，实得 %d 条，放弃' % len(log))
    text = json.dumps(entries, ensure_ascii=False, indent=2)
    if text.count('\n') != raw.rstrip('\n').count('\n'):
        raise SystemExit('[fail] Store.prefab 重写后行数不一致，放弃')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'Store.prefab')
    if not os.path.exists(backup):
        shutil.copy2(SHELL, backup)
    with io.open(SHELL, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)
    for line in log:
        print('  [ok] ' + line)
    return len(log)


def main():
    with io.open(PREFAB, encoding='utf-8', newline='') as handle:
        raw = handle.read()
    entries = json.loads(raw)
    log = []

    for card in (0, 1):
        for leaf, font, actual, h_align, posx in TARGETS:
            path = 'StoreGemBox/List/Card%d/%s' % (card, leaf)
            node = find(entries, path)
            if node is None:
                raise SystemExit('[fail] 找不到 %s' % path)
            label = label_of(entries, node)
            if label is None:
                raise SystemExit('[fail] %s 不是 Label' % path)
            for key, want in (('_fontSize', font), ('_actualFontSize', actual), ('_horizontalAlign', h_align)):
                before = label.get(key)
                if before != want:
                    label[key] = want
                    log.append('%s %s %s → %s' % (path, key, before, want))
            if posx is None:
                continue
            lpos = node.get('_lpos') or {'__type__': 'cc.Vec3', 'y': 0, 'z': 0}
            if lpos.get('x') != posx:
                before = lpos.get('x')
                lpos['x'] = posx
                lpos.setdefault('y', 0)
                lpos.setdefault('z', 0)
                node['_lpos'] = lpos
                log.append('%s _lpos.x %s → %s' % (path, before, posx))

    if not log:
        print('[skip] prefab 已是目标值')
        shell_changes = patch_shell_costs()
        print('[sum] prefab 0 处 / 外壳 %d 处' % shell_changes)
        return
    text = json.dumps(entries, ensure_ascii=False, indent=2)
    #  自检：行数一致说明只改了值、没有 __id__ 重排。
    #  ⚠️ 这份 prefab 原文末尾自带一个换行，`json.dumps` 不补 ⇒ 比之前先 rstrip。
    if text.count('\n') != raw.rstrip('\n').count('\n'):
        raise SystemExit('[fail] 重写后行数 %d ≠ 原文 %d，放弃'
                         % (text.count('\n'), raw.rstrip('\n').count('\n')))
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'StoreGemBox.prefab')
    if not os.path.exists(backup):
        shutil.copy2(PREFAB, backup)
    with io.open(PREFAB, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)
    for line in log:
        print('  [ok] ' + line)
    shell_changes = patch_shell_costs()
    print('[sum] prefab %d 处 / 外壳 %d 处' % (len(log), shell_changes))


if __name__ == '__main__':
    main()
