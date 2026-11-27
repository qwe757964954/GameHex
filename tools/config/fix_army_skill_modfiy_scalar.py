# -*- coding: utf-8 -*-
"""把 K 表 `modfiy` 列里「裸数字」的 36 行改成数组写法（2026-11-25）。

## 症状

`armySkillLevelUp.modfiy` 在 420 行里有 **36 行是字符串**（`"94031031"`），
其余 384 行是数组（`[94013011]` / `[]`）。类型声明写的是 `modfiy: any[]`，
6 条用例都在断言 `Array.isArray(row.modfiy)` ⇒ 这 36 行所在的链全红：

    12 条链 × 3 档：101404 / 101704 / 101803 / 101904 / 102004 / 102104 /
                   102203 / 102204 / 102304 / 102704 / 103103 / 103503

## 根因

K 表 L 列在 Excel 里是**数字格**（`<c r="L373" s="3"><v>94031031</v></c>`），
而正常行是**共享字符串**（`<c r="L7" s="3" t="s"><v>29</v></c>`，内容是 `[94013011]`）。
设计同学手填时没写方括号、Excel 就按数字存 ⇒ 导出成标量。

## 口径

- 目标形态一律 `[<原数字>]`（每条链每档本来就只挂一个修改器；用例期望也是单元素）；
- 三写：K 表 L 列（改 `inlineStr`，不动 `sharedStrings.xml`）+ `assets/remoteRef/armySkillLevelUp.json`
  + client 同名 json；
- 前置闸：① json 现值是**纯数字字符串**；② L 列现值是数字格且等于该值；
  ③ 两份 json 都做「未修改重建 == 原文逐字节」自检；
- 幂等：已一致就不写盘。
用法：python tools/config/fix_army_skill_modfiy_scalar.py
"""
import io
import os
import re
import shutil
import sys
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_read import read_sheet  # noqa: E402
from sync_army_skill_unlock import (  # noqa: E402
    ARMY_CLIENT, ARMY_REMOTE, JSON_BACKUP, XLSX, load_columnar, load_row_array,
)

XLSX_BACKUP = 'D:/Alan/Project/POW/doc/塔防数据配置/_backup'
MEMBER = 'xl/worksheets/sheet2.xml'
SHEET_INDEX = 1
FIRST_DATA_ROW = 7
COL_ID = 1
COL_LEVEL = 5
COL_MODFIY = 12  # L


def col_letter(index):
    letters = ''
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell_pattern(ref):
    return re.compile(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, re.S)


def set_cell_text(xml, ref, value):
    m = cell_pattern(ref).search(xml)
    if not m:
        raise SystemExit('[fail] 单元格 %s 不存在（不建格）' % ref)
    style = re.search(r's="(\d+)"', m.group(0))
    style_attr = ' s="%s"' % style.group(1) if style else ''
    new = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, style_attr, escape(str(value)))
    return xml[:m.start()] + new + xml[m.end():]


def main():
    army_v, army_k, army_render, army_raw = load_columnar(ARMY_REMOTE)
    if army_render(army_v) != army_raw:
        raise SystemExit('[fail] remoteRef 原样重建不逐字节相同，放弃')
    c_rows, c_render, c_raw = load_row_array(ARMY_CLIENT)
    if c_render(c_rows) != c_raw:
        raise SystemExit('[fail] client 原样重建不逐字节相同，放弃')

    i_mod = army_k.index('modfiy')
    i_id = army_k.index('id')
    i_lv = army_k.index('skilllevel')

    targets = {}
    for row in army_v:
        value = row[i_mod]
        if isinstance(value, str):
            if not value.isdigit():
                raise SystemExit('[fail] modfiy 是字符串但不是纯数字：%r' % (value,))
            targets[(str(row[i_id]), int(row[i_lv]))] = int(value)
    if not targets:
        print('[skip] 没有标量形态的 modfiy')
        return
    print('[diff] %d 行 modfiy 是标量，涉及 %d 条链' % (
        len(targets), len({k[0] for k in targets})))

    # ---- xlsx 定位 + 前置闸 ----
    _, rows = read_sheet(XLSX, SHEET_INDEX)
    locate = {}
    for row_no, cells in rows:
        if row_no < FIRST_DATA_ROW or not cells:
            continue
        cid = str(cells[COL_ID - 1] if len(cells) >= COL_ID else '').replace('\r', '').strip()
        lvl = str(cells[COL_LEVEL - 1] if len(cells) >= COL_LEVEL else '').replace('\r', '').strip()
        if cid and lvl:
            locate[(cid, int(float(lvl)))] = (row_no, cells)

    missing = [k for k in targets if k not in locate]
    if missing:
        raise SystemExit('[fail] 这些行在 K 表里找不到：%s' % missing[:8])

    conflict = []
    for key, want in targets.items():
        row_no, cells = locate[key]
        current = str(cells[COL_MODFIY - 1]).replace('\r', '').strip() if len(cells) >= COL_MODFIY else ''
        if current == '[%d]' % want:
            continue  # 表已是数组写法，只差 json
        if not current.isdigit() or int(current) != want:
            conflict.append('%s 表里 L 列现值为「%s」，json 是「%s」' % (key, current, want))
    if conflict:
        for line in conflict[:10]:
            print('  ' + line)
        raise SystemExit('[fail] 前置闸未过，未写盘')

    # ---- 写 xlsx ----
    with zipfile.ZipFile(XLSX) as z:
        xml = z.read(MEMBER).decode('utf-8')
        members = [(item, z.read(item.filename)) for item in z.infolist()]

    written = 0
    for key, want in sorted(targets.items(), key=lambda kv: locate[kv[0]][0]):
        row_no, cells = locate[key]
        current = str(cells[COL_MODFIY - 1]).replace('\r', '').strip() if len(cells) >= COL_MODFIY else ''
        if current == '[%d]' % want:
            continue
        ref = '%s%d' % (col_letter(COL_MODFIY), row_no)
        xml = set_cell_text(xml, ref, '[%d]' % want)
        print('[patch] %s %s#L%d  %s → [%d]' % (ref, key[0], key[1], current, want))
        written += 1

    if written:
        os.makedirs(XLSX_BACKUP, exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        bx = os.path.join(XLSX_BACKUP, 'K-卡牌升级.modfiy.%s.xlsx' % stamp)
        shutil.copyfile(XLSX, bx)
        print('[backup] ' + bx)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as out:
            for item, payload in members:
                out.writestr(item, xml.encode('utf-8') if item.filename == MEMBER else payload)
        try:
            with open(XLSX, 'wb') as fh:
                fh.write(buffer.getvalue())
        except PermissionError:
            raise SystemExit('[fail] 文件被占用（WPS/Excel 打开着？）关掉再跑；本次未写盘')

    # ---- 写两份 json ----
    os.makedirs(JSON_BACKUP, exist_ok=True)
    shutil.copyfile(ARMY_REMOTE, os.path.join(JSON_BACKUP, 'armySkillLevelUp.modfiy.%s.json' % stamp))
    shutil.copyfile(ARMY_CLIENT, os.path.join(JSON_BACKUP, 'client_armySkillLevelUp.modfiy.%s.json' % stamp))

    for row in army_v:
        key = (str(row[i_id]), int(row[i_lv]))
        if key in targets:
            row[i_mod] = [targets[key]]
    io.open(ARMY_REMOTE, 'w', encoding='utf-8', newline='').write(army_render(army_v))

    hit = 0
    for row in c_rows:
        key = (str(row['id']), int(row['skilllevel']))
        if key in targets:
            row['modfiy'] = [targets[key]]
            hit += 1
    io.open(ARMY_CLIENT, 'w', encoding='utf-8', newline='').write(c_render(c_rows))
    if hit != len(targets):
        raise SystemExit('[fail] client 只命中 %d / %d 行' % (hit, len(targets)))

    # ---- 回读 ----
    _, after = read_sheet(XLSX, SHEET_INDEX)
    checked = 0
    for row_no, cells in after:
        if row_no < FIRST_DATA_ROW or not cells:
            continue
        cid = str(cells[COL_ID - 1]).replace('\r', '').strip()
        lvl = str(cells[COL_LEVEL - 1]).replace('\r', '').strip()
        if not cid or not lvl:
            continue
        key = (cid, int(float(lvl)))
        if key in targets:
            got = str(cells[COL_MODFIY - 1]).replace('\r', '').strip()
            if got != '[%d]' % targets[key]:
                raise SystemExit('[fail] 回读不一致 %s：%s' % (key, got))
            checked += 1

    v2, k2, _, _ = load_columnar(ARMY_REMOTE)
    c2, _, _ = load_row_array(ARMY_CLIENT)
    bad = [r[k2.index('id')] for r in v2 if isinstance(r[k2.index('modfiy')], str)]
    bad_c = [r['id'] for r in c2 if isinstance(r['modfiy'], str)]
    if bad or bad_c:
        raise SystemExit('[fail] 仍有标量 modfiy：remote=%s client=%s' % (bad[:5], bad_c[:5]))

    print('[ok] %d 行 modfiy 已三写改为数组（xlsx 回读 %d 行 / 两份 json 零残留）' % (len(targets), checked))


if __name__ == '__main__':
    main()
