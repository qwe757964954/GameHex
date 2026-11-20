# -*- coding: utf-8 -*-
"""把 `CardUpgraded.prefab` 里被编辑器重存冲掉的三处字体口径写回去。

背景（2026-11-20）：
  第 16 轮修过的「属性数字模糊 / 增益标题小一号」在 16:39 被 Cocos 编辑器重存覆盖，
  `tests/card-upgraded-layout.test.ts` 的两条用例随即变红。这里只改三个 Label 的四个数，
  不动任何节点位置与尺寸：

    · LeftHpValue     `_actualFontSize` 27 → 26（与 `_fontSize` 对齐 = 没被 SHRINK 介入）
    · RightAttackValue `_actualFontSize` 29 → 28
    · BonusTitle      `_actualFontSize` 23 → 22、`_isBold` true → false、`_outlineWidth` 2 → 1

幂等：值已经对了就一个字都不写。
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PREFAB = os.path.join(PROJECT_ROOT, 'assets', 'bundles', 'main-pages', 'ui', 'card', 'CardUpgraded.prefab')

# 节点名 → 要写的字段
TARGETS = {
    'LeftHpValue': {'_actualFontSize': 26},
    'RightAttackValue': {'_actualFontSize': 28},
    'BonusTitle': {'_actualFontSize': 22, '_isBold': False, '_outlineWidth': 1},
}


def main(argv: list[str]) -> int:
    apply = '--apply' in argv
    raw = io.open(PREFAB, encoding='utf-8', newline='').read()
    data = json.loads(raw)
    #  先确认「不动的往返」与磁盘字节一致 —— 否则写回去会把整份文件的缩进/换行改掉。
    if json.dumps(data, ensure_ascii=False, indent=2) != raw:
        raise SystemExit('预制体既有排版与 json.dumps(indent=2) 不一致，先核对再改')

    changed: list[str] = []
    for node in data:
        if not isinstance(node, dict) or node.get('__type__') != 'cc.Node':
            continue
        fields = TARGETS.get(node.get('_name', ''))
        if not fields:
            continue
        for ref in node.get('_components') or []:
            comp = data[ref['__id__']]
            if comp.get('__type__') != 'cc.Label':
                continue
            for key, value in fields.items():
                if comp.get(key) == value:
                    continue
                changed.append('%s.%s %s → %s' % (node['_name'], key, comp.get(key), value))
                comp[key] = value

    if not changed:
        print('三处字体口径已经对齐（幂等，跳过写盘）')
        return 0

    for line in changed:
        print('  ' + line)
    if not apply:
        print('（预演，加 --apply 才写盘）')
        return 0

    backup = os.path.join(PROJECT_ROOT, 'tmp', 'backup_cardupgraded_font_20261120', os.path.basename(PREFAB))
    os.makedirs(os.path.dirname(backup), exist_ok=True)
    shutil.copy2(PREFAB, backup)
    io.open(PREFAB, 'w', encoding='utf-8', newline='').write(
        json.dumps(data, ensure_ascii=False, indent=2))
    print('已写（备份 %s）' % os.path.relpath(backup, PROJECT_ROOT))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
