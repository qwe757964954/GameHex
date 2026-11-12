# -*- coding: utf-8 -*-
"""把 68025「大威天芦」的两处技能参数写回 `doc/塔防数据配置/J-技能表.xlsx / PVP技能配置`。

配套脚本：`patch_dawtianlu_aura_punch.js`（写两份 json）。两边必须一起改，否则下次 eSon
打表（以 Excel 为准）会把 `auraRadius` / `projectileLifeSeconds` 刷回旧值。

改的是 **AC 列 `skillParamJson`**（第 29 列，字段名行第 5 行）：

  · 94025051 / 94025052 / 94025053 「无尘禁土」：`auraRadius` 60 → 200
  · 94025041 / 94025042 / 94025043 「天降神拳」：`projectileLifeSeconds` 4 → 3

⚠️ 这里只替换 JSON 里的**一个键**，其余键原样保留 —— 手写整串容易把 `damageRate`
   的 `3.0` 写成 `3`、把键序打乱，导出后 dif[必查]。所以先原文解析、改字段、再序列化。

沿用 `sync_treant_excel` 的 zip 级手术：只重写目标 sheet 的 xml，其余条目原样复制。
sheet 成员名不写死，从 `workbook.xml` + `workbook.xml.rels` 按页签名反查
（`J-技能表.xlsx` 有 16 个页签，硬编码 sheetN 一改页序就写错表）。

守卫：
  · 字段名行必须仍是 `... publishStatus / skillParamJson`，列序被插列改乱就报错；
  · 改前值必须与预期一致（`auraRadius=60` / `projectileLifeSeconds=4`），跑偏就拒绝覆盖；
  · 写完用 openpyxl 只读回读校验（不 save，避免把整张表按 16384 列重写）。
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import ROOT, col_letter, find_row_by, read_zip_rows, set_cell  # noqa: E402
from patch_storm_radius_growth_excel import write_zip_members, field_names, shared_strings  # noqa: E402

XLSX = os.path.join(ROOT, 'J-技能表.xlsx')
SST = 'xl/sharedStrings.xml'
SHEET_NAME = 'PVP技能配置'
BACKUP_DIR = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

FIELD_ROW = 5
DATA_START = 7
PARAM_COL_INDEX = 28          # 0 基：A=0 … AC=28

#  modifierId → {字段: (改前, 改后)}
EDITS = {
    94025051: {'auraRadius': (60, 200)},
    94025052: {'auraRadius': (60, 200)},
    94025053: {'auraRadius': (60, 200)},
    94025041: {'projectileLifeSeconds': (4, 3)},
    94025042: {'projectileLifeSeconds': (4, 3)},
    94025043: {'projectileLifeSeconds': (4, 3)},
}


def sheet_member(path, sheet_name):
    """按页签名反查 `xl/worksheets/sheetN.xml`。"""
    wb = read_zip_rows(path, 'xl/workbook.xml')
    rels = read_zip_rows(path, 'xl/_rels/workbook.xml.rels')
    rid = None
    for m in re.finditer(r'<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', wb):
        if m.group(1) == sheet_name:
            rid = m.group(2)
            break
    if rid is None:
        #  属性顺序不固定，换个方向再找一次
        for m in re.finditer(r'<sheet[^>]*r:id="([^"]+)"[^>]*name="([^"]+)"', wb):
            if m.group(2) == sheet_name:
                rid = m.group(1)
                break
    if rid is None:
        raise SystemExit('[fail] workbook.xml 里找不到页签 %r' % sheet_name)
    for m in re.finditer(r'<Relationship[^>]*Id="%s"[^>]*Target="([^"]+)"' % rid, rels):
        target = m.group(1)
        break
    else:
        raise SystemExit('[fail] rels 里找不到 %s' % rid)
    target = target.lstrip('/')
    return target if target.startswith('xl/') else 'xl/' + target


def replace_number(raw, field, before, after):
    """在 JSON 原文里定点替换一个数值，其余字节原样保留。

    ⚠️ 不能 `json.loads` 再 `json.dumps`：那会把 `3.0` 写成 `3`、`0.30` 写成 `0.3`
    —— 数值等价，但源表是给人看的，`damageRate` 一列突然全变整型很像被脚本刷过，
    而且 diff 会从一个键扩成整串。这里只动要改的那一个 token。
    """
    pattern = r'("%s"\s*:\s*)%s(?=\s*[,}])' % (re.escape(field), re.escape(str(before)))
    if len(re.findall(pattern, raw)) != 1:
        raise SystemExit('[fail] %s=%s 在 %r 里出现 %d 次，预期 1 次'
                         % (field, before, raw, len(re.findall(pattern, raw))))
    return re.sub(pattern, lambda m: m.group(1) + str(after), raw)


def main():
    member = sheet_member(XLSX, SHEET_NAME)
    xml = read_zip_rows(XLSX, member)
    strings = shared_strings(XLSX)

    fields = field_names(xml, strings)
    actual = [fields.get(col_letter(i)) for i in range(PARAM_COL_INDEX + 1)]
    if actual[PARAM_COL_INDEX] != 'skillParamJson' or actual[PARAM_COL_INDEX - 1] != 'publishStatus':
        raise SystemExit('[fail] 字段行 %r 与预期不符（AA=publishStatus / AC=skillParamJson），列序变了'
                         % actual[-3:])

    param_col = col_letter(PARAM_COL_INDEX)
    touched = []
    for modifier_id, edits in EDITS.items():
        row = find_row_by(xml, 'B', modifier_id)
        if row is None:
            raise SystemExit('[fail] 找不到 modifierId=%s 的行' % modifier_id)
        ref = '%s%d' % (param_col, row)
        raw = None
        m = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
        if m:
            inner = m.group(2)
            if 't="s"' in m.group(1):
                idx = re.search(r'<v>(\d+)</v>', inner)
                raw = strings[int(idx.group(1))] if idx else None
            else:
                texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
                texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
                raw = texts[0] if texts else None
        if not raw:
            raise SystemExit('[fail] modifierId=%s 的 %s 是空的' % (modifier_id, ref))

        #  改前先整体核一遍：任何一个字段对不上就整行不改（避免半改）。
        params = json.loads(raw)
        for field, (before, _) in edits.items():
            if params.get(field) is None or abs(float(params[field]) - before) > 1e-9:
                raise SystemExit('[fail] %s.%s 现在是 %r，预期 %s —— 表被人改过，拒绝覆盖'
                                 % (modifier_id, field, params.get(field), before))
        next_raw = raw
        for field, (before, after) in edits.items():
            next_raw = replace_number(next_raw, field, before, after)
        xml = set_cell(xml, ref, next_raw)
        touched.append('%s(%s)' % (modifier_id, ref))

    backup = write_zip_members(XLSX, {member: xml}, BACKUP_DIR, 'dawtianlu')
    print('[ok] %s / %s：%s（备份 %s）' % (os.path.basename(XLSX), SHEET_NAME,
                                          ' / '.join(touched), backup))


def verify():
    import openpyxl

    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    ws = wb[SHEET_NAME]
    seen = {}
    for r in ws.iter_rows(min_row=DATA_START, values_only=True):
        if r[1] is None:
            continue
        seen[int(r[1])] = r[PARAM_COL_INDEX]
    wb.close()

    for modifier_id, edits in EDITS.items():
        params = json.loads(seen[modifier_id])
        for field, (_, after) in edits.items():
            if abs(float(params[field]) - after) > 1e-9:
                raise SystemExit('[fail] 回读 %s.%s = %r，预期 %s' % (modifier_id, field, params[field], after))
    print('[verify] 回读一致：9402504x projectileLifeSeconds=3；9402505x auraRadius=200')


if __name__ == '__main__':
    main()
    verify()
