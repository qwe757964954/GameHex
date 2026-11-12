# -*- coding: utf-8 -*-
"""把 2026-11-10 的两处 PVP 数值改动写回 `doc/塔防数据配置` 的 Excel 源表。

配套脚本：`patch_storm_radius_growth_json.js`（写两份 json）。两边必须一起改，
否则下次打表（eSon 以 Excel 为准）会把 json 里的值刷回去。

  1. `PVP-技能.xlsx` / `技能配置`：30831「椰蛋战士·暴风」的 `areaRadius` 30 → 26。
     上一轮把特效宿主倍率 0.8 → 0.7 时只改了视觉，判定半径没跟；这次按
     30 × 0.7 / 0.8 = 26 同步，`ZCCombatEffectScale` 那条注释里记的「两处必须同步」就补齐了。
  2. `PVP-修改器适配.xlsx` / `PVP成长`：补 68025「大威天芦」1~25 级。
     口径见 `技能设计案2.xlsx / 伤害参数`：B3 每级 8%、A21:B45 的等级系数 1 + 8% × L。
     `attackRate = maxHpRate = 0.08 × L`（生命沿用同比例，是唯一的推断项，脚本里有注释）。

沿用 `sync_treant_excel` 的 zip 级手术：只重写目标 sheet 的 xml，其余条目原样复制。
`PVP-修改器适配.xlsx` 还要额外追加一条共享字符串（'68025' 原本不在 sharedStrings 里），
所以这里自己实现了一个「一次改多个成员」的写回函数。

守卫：
  · 两张表的字段名行（第 5 行）必须与预期一致，列序被插列改乱就报错；
  · `--expect` 语义写死：30831 现值必须是 30、PVP成长 里不许已有 68025 的行；
  · 写完用 openpyxl 只读回读校验（不 save，避免二次破坏）。
"""

import os
import re
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, col_letter, find_row_by, last_data_row, build_row, bump_dimension,
    read_zip_rows, set_cell, styles_of_row,
)

BACKUP_DIR = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

SKILL_XLSX = os.path.join(ROOT, 'PVP-技能.xlsx')
SKILL_MEMBER = 'xl/worksheets/sheet1.xml'
GROWTH_XLSX = os.path.join(ROOT, 'PVP-修改器适配.xlsx')
GROWTH_MEMBER = 'xl/worksheets/sheet3.xml'      # workbook.xml：rId3 = PVP成长
GROWTH_SST = 'xl/sharedStrings.xml'

STORM_SKILL_ID = 30831
STORM_RADIUS_BEFORE = 30
STORM_RADIUS_AFTER = 26

UNIT_ID = '68025'
MAX_LEVEL = 25
GROWTH_RATE_PER_LEVEL = 0.08
GROWTH_COLUMNS = ['unitId', 'level', 'attackFlat', 'attackRate', 'maxHpFlat',
                  'maxHpRate', 'moveSpeedRate', 'attackRangeFlat', 'enabled']

FIELD_ROW = 5
DATA_START = 7          # 1 表名 / 2 导出标记 / 3 中文 / 4 说明 / 5 字段名 / 6 类型


def write_zip_members(path, members, backup_dir, tag):
    """把 {成员名: 新 xml 文本} 一次性写回；其余条目逐字节复制。"""
    os.makedirs(backup_dir, exist_ok=True)
    backup = os.path.join(backup_dir, tag + '-' + os.path.basename(path))
    shutil.copy2(path, backup)
    tmp = path + '.tmp'
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = members[info.filename].encode('utf-8') if info.filename in members else src.read(info.filename)
            dst.writestr(info, data)
    os.replace(tmp, path)
    return backup


def shared_strings(path, member=GROWTH_SST):
    """读 sharedStrings.xml → 下标到文本的列表（`<si>` 可能有多个 `<t>` 片段）。"""
    text = read_zip_rows(path, member)
    items = []
    for si in re.findall(r'<si>(.*?)</si>', text, re.S):
        items.append(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S)))
    return items


def field_names(xml, strings=None):
    """第 5 行（字段名行）逐列的文本；`t="s"` 的格子按共享字符串解引用。"""
    cells = {}
    for m in re.finditer(r'<c r="([A-Z]+)%d"([^>]*)>(.*?)</c>' % FIELD_ROW, xml, re.S):
        attrs, inner = m.group(2), m.group(3)
        if 't="s"' in attrs and strings is not None:
            index = re.search(r'<v>(\d+)</v>', inner)
            cells[m.group(1)] = strings[int(index.group(1))] if index else ''
            continue
        texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
        texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
        cells[m.group(1)] = texts[0] if texts else ''
    return cells


def cell_text(xml, ref):
    m = re.search(r'<c r="%s"[^>]*>(.*?)</c>' % ref, xml, re.S)
    if not m:
        return None
    texts = re.findall(r'<v>(.*?)</v>', m.group(1), re.S)
    return texts[0] if texts else None


# ── 1) PVP-技能.xlsx：30831 areaRadius ───────────────────────────────────────
def patch_skill_radius():
    xml = read_zip_rows(SKILL_XLSX, SKILL_MEMBER)
    fields = field_names(xml)
    if fields.get('G') != 'areaRadius':
        raise SystemExit('[fail] PVP-技能 第 %d 行 G 列是 %r，预期 areaRadius —— 列序变了'
                         % (FIELD_ROW, fields.get('G')))

    row = find_row_by(xml, 'A', STORM_SKILL_ID)
    if row is None:
        raise SystemExit('[fail] PVP-技能 里找不到 skillId=%s' % STORM_SKILL_ID)
    before = cell_text(xml, 'G%d' % row)
    print('[now] 技能配置!G%d（skillId=%s 暴风）= %r' % (row, STORM_SKILL_ID, before))
    if before is not None and float(before) == STORM_RADIUS_AFTER:
        print('[skip] 已经是 %s，无需改动' % STORM_RADIUS_AFTER)
        return
    if before is None or float(before) != STORM_RADIUS_BEFORE:
        raise SystemExit('[fail] 现值 %r 与预期 %s 不符，拒绝覆盖' % (before, STORM_RADIUS_BEFORE))

    xml = set_cell(xml, 'G%d' % row, STORM_RADIUS_AFTER)
    backup = write_zip_members(SKILL_XLSX, {SKILL_MEMBER: xml}, BACKUP_DIR, 'skill')
    print('[ok] areaRadius %s → %s（备份 %s）' % (STORM_RADIUS_BEFORE, STORM_RADIUS_AFTER, backup))


# ── 2) PVP-修改器适配.xlsx：68025 的 1~25 级 ────────────────────────────────
def patch_growth_rows():
    xml = read_zip_rows(GROWTH_XLSX, GROWTH_MEMBER)
    fields = field_names(xml, shared_strings(GROWTH_XLSX))
    actual = [fields.get(col_letter(i)) for i in range(len(GROWTH_COLUMNS))]
    if actual != GROWTH_COLUMNS:
        raise SystemExit('[fail] PVP成长 字段行是 %r，预期 %r' % (actual, GROWTH_COLUMNS))

    if find_row_by(xml, 'A', UNIT_ID) is not None:
        raise SystemExit('[fail] PVP成长 里已经有 %s 的行，拒绝重复追加' % UNIT_ID)

    sst = read_zip_rows(GROWTH_XLSX, GROWTH_SST)
    m = re.search(r'count="(\d+)" uniqueCount="(\d+)"', sst)
    if not m:
        raise SystemExit('[fail] sharedStrings 缺 count/uniqueCount')
    total, unique = int(m.group(1)), int(m.group(2))
    sst = sst.replace(m.group(0), 'count="%d" uniqueCount="%d"' % (total + MAX_LEVEL, unique + 1))
    sst = sst.replace('</sst>', '<si><t>%s</t></si></sst>' % UNIT_ID)
    string_index = unique            # 新串的下标 = 原来的 uniqueCount

    styles = styles_of_row(xml, last_data_row(xml))
    target = last_data_row(xml)
    appended = 0
    for level in range(1, MAX_LEVEL + 1):
        rate = round(GROWTH_RATE_PER_LEVEL * level, 2)
        values = [UNIT_ID, level, 0, rate, 0, rate, 0, 0, 1]
        target += 1
        row_xml = build_row(target, values, styles)
        #  unitId 是字符串：用共享字符串而不是 inlineStr —— eSon 的读取器对两种都认，
        #  但源表里既有行全是 `t="s"`，保持一致最不容易在打表时出意外。
        row_xml = row_xml.replace(
            '<c r="A%d" s="%s" t="inlineStr"><is><t>%s</t></is></c>'
            % (target, styles.get('A'), UNIT_ID),
            '<c r="A%d" s="%s" t="s"><v>%d</v></c>' % (target, styles.get('A'), string_index),
        )
        xml = xml.replace('</sheetData>', row_xml + '</sheetData>', 1)
        appended += 1
    xml = bump_dimension(xml, target)

    backup = write_zip_members(GROWTH_XLSX,
                               {GROWTH_MEMBER: xml, GROWTH_SST: sst},
                               BACKUP_DIR, 'growth')
    print('[ok] PVP成长 追加 %s 的 %d 行（L1 +8%% … L25 +200%%；备份 %s）'
          % (UNIT_ID, appended, backup))


# ── 3) 只读回读校验 ────────────────────────────────────────────────────────
def verify():
    import openpyxl

    wb = openpyxl.load_workbook(SKILL_XLSX, read_only=True, data_only=True)
    ws = wb['技能配置']
    hit = [r for r in ws.iter_rows(min_row=DATA_START, values_only=True) if r[0] == STORM_SKILL_ID]
    if not hit or float(hit[0][6]) != STORM_RADIUS_AFTER:
        raise SystemExit('[fail] 回读 PVP-技能 30831 areaRadius 不是 %s：%r'
                         % (STORM_RADIUS_AFTER, hit[0][6] if hit else None))
    wb.close()

    wb = openpyxl.load_workbook(GROWTH_XLSX, read_only=True, data_only=True)
    ws = wb['PVP成长']
    rows = [r for r in ws.iter_rows(min_row=DATA_START, values_only=True) if str(r[0]) == UNIT_ID]
    if len(rows) != MAX_LEVEL:
        raise SystemExit('[fail] 回读 PVP成长 只有 %d 行' % len(rows))
    top = [r for r in rows if int(r[1]) == MAX_LEVEL][0]
    if abs(float(top[3]) - 2.0) > 1e-9:
        raise SystemExit('[fail] 回读 25 级 attackRate = %r，预期 2.0' % top[3])
    wb.close()
    print('[verify] 两张源表回读一致：30831 areaRadius=%s；%s 共 %d 行，L25 attackRate=%s'
          % (STORM_RADIUS_AFTER, UNIT_ID, len(rows), top[3]))


if __name__ == '__main__':
    patch_skill_radius()
    patch_growth_rows()
    verify()
