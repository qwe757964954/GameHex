# -*- coding: utf-8 -*-
"""68015「机甲菇」的 `unitPrefabPath` 改回 `skel/机甲菇/机甲菇`（2026-11-16 用户拍板）。

## 为什么

`PVP-卡牌.xlsx` AG 列写的是 `units/阿尔萨斯/阿尔萨斯`，但：

· `assets/resources/` 下**根本没有 `units/` 这个根目录**（只有 config / icons / image /
  shaders / skel / ui / 塔防），35 张卡里 34 张都走 `skel/`；
· 这个 prefab 不存在，实际资源是 `assets/resources/skel/机甲菇/机甲菇.prefab`。

留着它会让 68015 在游戏里加载不到模型（`zcds-model` 的「prefab 可加载」与「remoteRef 与转表
产物逐格一致」两条用例一直红）。名字本轮已定稿为「机甲菇」，模型沿用机甲菇 —— 只改名、不换形象。

## 改哪三处

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| `PVP-卡牌.xlsx` AG 列（68015） | `units/阿尔萨斯/阿尔萨斯` | `skel/机甲菇/机甲菇` |
| `doc/.../json/client/pvpCard.json` | 同上 | 同上 |
| `assets/remoteRef/pvpCard.json` | 已是目标值 | 仅断言 |

`headIcon` 保持 `兵种_头像_阿尔萨斯`（图标资源确实存在，是单独做的一张头像），`buildIcon`
保持 `barracks-机甲菇`。

用法：
    python tools/config/patch_jijiagu_prefab_path.py --check
    python tools/config/patch_jijiagu_prefab_path.py --write
"""

import argparse
import html
import io
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

from sync_treant_excel import ROOT, read_zip_rows, write_zip          # noqa: E402
from patch_bullet_falloff import set_cell_safe                        # noqa: E402
from patch_multi_target_falloff import dump_rows, read_rows            # noqa: E402
from patch_mushroom_race import dump_rich, read_packed                 # noqa: E402

DEMO = 'D:/Alan/Project/POW/Demo3.8'
REMOTE = os.path.join(DEMO, 'assets', 'remoteRef')
CLIENT = os.path.join(ROOT, 'json', 'client')
CARD_XLSX = os.path.join(ROOT, 'PVP-卡牌.xlsx')
BACKUP = os.path.join(DEMO, 'tmp', 'backup_jijiagu_prefab')

CARD_ID = 68015
WANT = 'skel/机甲菇/机甲菇'
OLD = 'units/阿尔萨斯/阿尔萨斯'
COLUMN = 'AG'          # unitPrefabPath

ROW_RE = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.S)


def load_sst(path):
    with zipfile.ZipFile(path) as handle:
        raw = handle.read('xl/sharedStrings.xml').decode('utf-8')
    root = re.search(r'<sst.*?</sst>', raw, re.S)
    items = []
    for one in re.finditer(r'<si>(.*?)</si>', root.group(0), re.S):
        text = ''.join(re.findall(r'<t[^>]*>(.*?)</t>', one.group(1), re.S))
        items.append(html.unescape(re.sub(r'<[^>]+>', '', text)))
    return items


def cell_text(body, ref, sst):
    cell = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, body, re.S)
    if not cell:
        return None
    inner = cell.group(1) or ''
    value = re.search(r'<v>(.*?)</v>', inner, re.S)
    if 't="s"' in cell.group(0) and value:
        return sst[int(value.group(1))]
    if 't="inlineStr"' in cell.group(0):
        text = re.search(r'<t[^>]*>(.*?)</t>', inner, re.S)
        return html.unescape(text.group(1)) if text else ''
    return value.group(1) if value else ''


def sync_excel(check):
    sst = load_sst(CARD_XLSX)
    xml = read_zip_rows(CARD_XLSX, 'xl/worksheets/sheet1.xml')
    row_num, body = None, ''
    for rn, one in ROW_RE.findall(xml):
        if cell_text(one, 'A%d' % int(rn), sst) == str(CARD_ID):
            row_num, body = int(rn), one
            break
    if row_num is None:
        raise SystemExit('PVP-卡牌 找不到 %d' % CARD_ID)
    current = cell_text(body, '%s%d' % (COLUMN, row_num), sst)
    if current not in (OLD, WANT):
        raise SystemExit('68015 的 %s 是 %r，既不是旧值也不是目标值，拒绝覆盖' % (COLUMN, current))
    if current == WANT:
        return 0
    xml = set_cell_safe(xml, '%s%d' % (COLUMN, row_num), WANT)
    if not check:
        write_zip(CARD_XLSX, 'xl/worksheets/sheet1.xml', xml, BACKUP)
    return 1


def sync_json(check):
    changed = 0

    target = os.path.join(REMOTE, 'pvpCard.json')
    keys, _values, rows = read_packed(target)
    for row in rows:
        if int(str(row['id'])) == CARD_ID:
            current = row.get('unitPrefabPath')
            if current not in (OLD, WANT):
                raise SystemExit('remoteRef 的 68015.unitPrefabPath 是 %r，拒绝覆盖' % current)
            if current == OLD:
                row['unitPrefabPath'] = WANT
                changed += 1
                if not check:
                    with io.open(target, 'w', encoding='utf-8', newline='') as handle:
                        handle.write(dump_rich(keys, rows))

    target = os.path.join(CLIENT, 'pvpCard.json')
    data, trailing = read_rows(target)
    for row in data:
        if int(str(row['id'])) == CARD_ID:
            current = row.get('unitPrefabPath')
            if current not in (OLD, WANT):
                raise SystemExit('client 的 68015.unitPrefabPath 是 %r，拒绝覆盖' % current)
            if current == OLD:
                row['unitPrefabPath'] = WANT
                changed += 1
                if not check:
                    with io.open(target, 'w', encoding='utf-8', newline='') as handle:
                        handle.write(dump_rows(data, trailing))
    return changed


def verify():
    problems = []
    for base, tag, rich in ((REMOTE, 'remoteRef', True), (CLIENT, 'client', False)):
        target = os.path.join(base, 'pvpCard.json')
        rows = read_packed(target)[2] if rich else read_rows(target)[0]
        for row in rows:
            if int(str(row['id'])) == CARD_ID and row.get('unitPrefabPath') != WANT:
                problems.append('%s: %r' % (tag, row.get('unitPrefabPath')))
    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    check = not args.write

    print('== ① PVP-卡牌.xlsx %s%d' % (COLUMN, CARD_ID))
    print('  改 %d 格' % sync_excel(check))
    print('== ② 两份 pvpCard.json')
    print('  改 %d 行' % sync_json(check))
    if not check:
        problems = verify()
        if problems:
            raise SystemExit('回读不符：%s' % problems)
        print('  回读校验通过')
    print('== %s ==' % ('干跑完成，未落盘' if check else '已落盘'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
