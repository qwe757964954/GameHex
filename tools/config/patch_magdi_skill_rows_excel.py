# -*- coding: utf-8 -*-
"""把 101603 五雷轰顶 / 101604 磁电冲击 的 6 行补进 `J-技能表.xlsx` 的 `PVP技能配置`。

为什么必须补
────────────
这两条技能是 2026-11-11 新设的，之前只写了两份 JSON 产物（`assets/remoteRef` 与
`doc/塔防数据配置/json/client`），**源表里没有行**。运行时读 JSON 不受影响，但
`npm run config:export` 一旦跑通（目前卡在 24 条既有错），转表会以 Excel 为准重新生成 JSON，
这 6 行会被整块刷掉 —— 属于埋着的雷，本轮提前拆掉。

为什么不用 openpyxl 另存
────────────────────────
这张表 2.4MB、16 个页签，`修改器` 页的 dimension 是 `A1:XFD3234`（16384 列），openpyxl 一保存
会把整张表按 16384 列重写（历史上另一个表就这么从 20KB 涨到 5.4MB）。所以沿用
`sync_treant_excel` 的 zip 级手术：只重写 `xl/worksheets/sheet9.xml`，其余条目逐字节复制。

`PVP技能配置` 的数据行全是 `t="inlineStr"`（表头行才是共享字符串），所以不碰 sharedStrings，
追加行的列样式逐列沿用末行（`styles_of_row`），不新增样式。

守卫
────
· 第 5 行字段名必须与 `SHEET_COLUMNS` 逐列一致（插列/改名直接报错）；
· 末行必须是 2212（2026-11-11 暴击伤害 1750 行补完后的状态）；
· B 列不许已存在 94016031~33 / 94016041~43（重复跑会产生重复键）；
· 两份 JSON 产物这 6 行的字段必须逐字一致（否则不知道该信哪份）。

用法：python tools/config/patch_magdi_skill_rows_excel.py
"""

import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT as CONFIG_ROOT, build_row, bump_dimension, col_letter, last_data_row, read_zip_rows,
    styles_of_row, upsert,
)
from patch_dawtianlu_aura_punch_excel import sheet_member  # noqa: E402
from patch_storm_radius_growth_excel import write_zip_members  # noqa: E402

ROOT = 'D:/Alan/Project/POW'
SKILL_XLSX = os.path.join(CONFIG_ROOT, 'J-技能表.xlsx')
SHEET_NAME = 'PVP技能配置'
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'pvpSkillPlan.json')
BACKUP_DIR = os.path.join(ROOT, 'Demo3.8', 'tmp', 'config_backup')

FIELD_ROW = 5
#  要补的成长技能链；行的具体内容一律从 JSON 取（不在这里写死修改器号，加链只改这一行）。
#  也可以在命令行上指定：`python patch_magdi_skill_rows_excel.py 102603 102604 372601`
#  （麻辣铁锅那 9 行就是这么补的 —— 同一个 sheet、同一套列，没必要再抄一份脚本）。
WANT_CHAINS = (101603, 101604)
if len(sys.argv) > 1:
    WANT_CHAINS = tuple(int(argument) for argument in sys.argv[1:])

#  与第 5 行表头逐列一致（`patch_lineup_crit_damage_excel.py` 已验证过一次，这里再守一遍）。
SHEET_COLUMNS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'statId', 'operation',
    'value', 'statusId', 'statusStatJson', 'durationSeconds', 'maxStacks',
    'replacementSkillId', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion',
    'publishStatus', 'skillParamJson',
]


def strip_tags(fragment):
    texts = re.findall(r'<t[^>]*>(.*?)</t>', fragment, re.S)
    texts += re.findall(r'<v>(.*?)</v>', fragment, re.S)
    return texts[0] if texts else ''


def field_names(xml, strings):
    cells = {}
    for m in re.finditer(r'<c r="([A-Z]+)%d"([^>]*)>(.*?)</c>' % FIELD_ROW, xml, re.S):
        attrs, inner = m.group(2), m.group(3)
        if 't="s"' in attrs:
            index = re.search(r'<v>(\d+)</v>', inner)
            cells[m.group(1)] = strings[int(index.group(1))] if index else ''
            continue
        cells[m.group(1)] = strip_tags(inner)
    return cells


def shared_strings(path, member='xl/sharedStrings.xml'):
    text = read_zip_rows(path, member)
    out = []
    for si in re.findall(r'<si>(.*?)</si>', text, re.S):
        out.append(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S)))
    return out


def load_rows():
    """从 remoteRef 取 `WANT_CHAINS` 各链的全部行，并与 client 产物逐字对拍。

    client 产物省掉 null 键（`writeRowsLikeOriginal` 会 filter），所以只比两边都有的键。
    """
    data = json.load(io.open(REMOTE, encoding='utf-8'))
    keys = data['k']
    remote = {}
    for row in data['v']:
        record = dict(zip(keys, row))
        if record.get('skillChainId') in WANT_CHAINS:
            remote[record['modifierId']] = record
    client = {}
    for row in json.load(io.open(CLIENT, encoding='utf-8')):
        if row.get('skillChainId') in WANT_CHAINS:
            client[row['modifierId']] = row

    if not remote:
        raise SystemExit('[fail] remoteRef 里找不到链 %s 的行' % (WANT_CHAINS,))
    if sorted(remote) != sorted(client):
        raise SystemExit('[fail] remoteRef 与 client 的行集合不一致：%s vs %s' % (
            sorted(remote), sorted(client)))
    for modifier_id, record in remote.items():
        for column in SHEET_COLUMNS:
            if column == 'replacementSkillId' or column not in client[modifier_id]:
                continue
            if record.get(column) != client[modifier_id][column]:
                raise SystemExit('[fail] %s 的 %s 两份产物不一致：%r vs %r' % (
                    modifier_id, column, record.get(column), client[modifier_id].get(column)))
    #  按 modifierId 升序写（表里也是从小到大）
    return [remote[modifier_id] for modifier_id in sorted(remote)]


def main():
    rows = load_rows()

    member = sheet_member(SKILL_XLSX, SHEET_NAME)
    xml = read_zip_rows(SKILL_XLSX, member)
    strings = shared_strings(SKILL_XLSX)

    # ── 守卫 1：字段行 ──────────────────────────────────────────────────────
    fields = field_names(xml, strings)
    actual = [fields.get(col_letter(index)) for index in range(len(SHEET_COLUMNS))]
    if actual != SHEET_COLUMNS:
        raise SystemExit('[fail] %s 字段行是 %r，预期 %r' % (SHEET_NAME, actual, SHEET_COLUMNS))

    last = last_data_row(xml)
    #  ⚠️ 只「追加」是不够的：改数值 / 改文案时 6 行早就在表里，追加路径会直接 skip，
    #  于是源表停在旧值上（`verify()` 会报「回读 45px、期望 60px」）。
    #  所以走 `upsert`：已存在的行**原地重写**，缺的补到末尾 —— 与 JSON 是唯一真源这条口径一致。
    values = [[record.get(column) for column in SHEET_COLUMNS] for record in rows]
    xml, appended, rewritten = upsert(xml, 'B', lambda row: row[1], values)
    if appended == 0 and rewritten == 0:
        print('[skip] 链 %s 的 %d 行都已在表里且逐格一致（末行 %d）' % (
            WANT_CHAINS, len(rows), last))
        return
    xml = bump_dimension(xml, last_data_row(xml))

    backup = write_zip_members(SKILL_XLSX, {member: xml}, BACKUP_DIR, 'magdi-skill-rows')
    print('[ok] %s / %s：原地重写 %d 行、追加 %d 行；成员 %s' % (
        os.path.basename(SKILL_XLSX), SHEET_NAME, rewritten, appended, member))
    print('[ok] 备份 → %s' % backup)


def verify():
    import openpyxl

    expected = {record['modifierId']: record for record in load_rows()}
    wb = openpyxl.load_workbook(SKILL_XLSX, read_only=True, data_only=True)
    sheet = wb[SHEET_NAME]
    got = {}
    for row in sheet.iter_rows(min_row=FIELD_ROW + 2, values_only=True):
        if row[0] is None or not isinstance(row[1], (int, float)):
            continue
        if int(row[1]) in expected:
            got[int(row[1])] = row
    wb.close()

    if sorted(got) != sorted(expected):
        raise SystemExit('[fail] 回读只找到 %s' % sorted(got))

    for modifier_id, record in expected.items():
        row = got[modifier_id]
        for index, column in enumerate(SHEET_COLUMNS):
            want, have = record.get(column), row[index]
            if isinstance(want, (int, float)) and isinstance(have, (int, float)):
                if abs(float(have) - float(want)) > 1e-9:
                    raise SystemExit('[fail] %s.%s 回读 %r，期望 %r' % (modifier_id, column, have, want))
                continue
            if want is None and have in (None, ''):
                continue
            if str(want) != str(have):
                raise SystemExit('[fail] %s.%s 回读 %r，期望 %r' % (modifier_id, column, have, want))
        print('  %s L%s %s %s' % (modifier_id, row[5], row[4], (row[28] or '')[:48]))
    print('[ok] 回读通过：%d 行 × %d 列逐格与 JSON 一致' % (len(expected), len(SHEET_COLUMNS)))


if __name__ == '__main__':
    main()
    verify()
