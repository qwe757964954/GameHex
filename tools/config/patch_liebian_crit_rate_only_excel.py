# -*- coding: utf-8 -*-
"""把「裂变暴击只留轻微暴击率」写回 `doc/塔防数据配置/J-技能表.xlsx` 的 `PVP技能配置`。

配套脚本：`patch_liebian_crit_rate_only.js`（写两份 json）。两边必须一起改，否则下次 eSon
打表（以 Excel 为准）会把 12 行暴伤刷回来、把暴击率刷回 22/30/38。

改什么
──────
· **删掉 12 行**：4 条 `19x0x` 链（191601 / 192502 / 193301 / 193402）的 L1~L3，`statId = critDamage`；
· **改 12 行**：4 条 `10x0x` 链（101601 / 102502 / 103301 / 103402）的暴击率 22/30/38 → 3/4/5，
  `desc` 去掉「暴击伤害提高 N%」，只留暴击率 + 溅射（溅射来自 `skillParamJson`，真的生效）。

`PVP技能配置` 的列序（第 5 行字段名）：A enabled / B modifierId / C unitId / D skillChainId /
… / **P statId / Q operation / R value** / … / **Z desc** / AA sourceVersion / AB publishStatus /
AC skillParamJson。

守卫
────
· 字段行必须还是那 29 列；
· 动手前 24 行必须逐行对得上（暴伤 90/120/150、暴击率 22/30/38），对不上说明表被人改过；
· 回读：暴伤链必须一行不剩，暴击率必须是 3/4/5。

行内 `<row>` 直接摘除（行号留空是合法的 OOXML），`dimension` 不动（删的是中间行，末行号仍是 2212）。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, cell_xml, col_letter, read_zip_rows, set_cell,
)
from patch_storm_radius_growth_excel import shared_strings, write_zip_members  # noqa: E402

PLAN_XLSX = os.path.join(ROOT, 'J-技能表.xlsx')
PLAN_MEMBER = 'xl/worksheets/sheet9.xml'        # workbook.xml：rId9 = PVP技能配置
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/liebian_backup'

FIELD_ROW = 5
DATA_START = 7
EXPECT_FIELDS = ['enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
                 'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
                 'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'statId',
                 'operation', 'value', 'statusId', 'statusStatJson', 'durationSeconds',
                 'maxStacks', 'replacementSkillId', 'cooldown', 'maxTriggers', 'desc',
                 'sourceVersion', 'publishStatus', 'skillParamJson']

PAIRS = [
    ('68016', 191601, 101601),
    ('68025', 192502, 102502),
    ('68033', 193301, 103301),
    ('68034', 193402, 103402),
]
NEW_CRIT_RATE = {1: 3, 2: 4, 3: 5}
OLD_CRIT_DAMAGE = {1: 90, 2: 120, 3: 150}
OLD_CRIT_RATE = {1: 22, 2: 30, 3: 38}
SPLASH = {1: 32, 2: 40, 3: 48}


def field_names(xml, strings):
    cells = {}
    for m in re.finditer(r'<c r="([A-Z]+)%d"([^>]*)>(.*?)</c>' % FIELD_ROW, xml, re.S):
        attrs, inner = m.group(2), m.group(3)
        if 't="s"' in attrs:
            index = re.search(r'<v>(\d+)</v>', inner)
            cells[m.group(1)] = strings[int(index.group(1))] if index else ''
            continue
        texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
        texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
        cells[m.group(1)] = texts[0] if texts else ''
    return cells


def cell_value(xml, ref, strings):
    m = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not m:
        return None
    attrs, inner = m.group(1), m.group(2)
    raw = re.search(r'<v>(.*?)</v>', inner, re.S)
    if raw:
        return strings[int(raw.group(1))] if 't="s"' in attrs else raw.group(1)
    texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
    return texts[0] if texts else None


def index_rows(xml, strings):
    """(unitId, skillChainId, skillLevel) → excel 行号。"""
    out = {}
    for m in re.finditer(r'<c r="A(\d+)"[^>]*>(.*?)</c>', xml, re.S):
        row = int(m.group(1))
        if row < DATA_START:
            continue
        unit_id = cell_value(xml, 'C%d' % row, strings)
        chain = cell_value(xml, 'D%d' % row, strings)
        level = cell_value(xml, 'F%d' % row, strings)
        if unit_id is None or chain is None or level is None:
            continue
        out[(unit_id, int(float(chain)), int(float(level)))] = row
    return out


def main():
    xml = read_zip_rows(PLAN_XLSX, PLAN_MEMBER)
    strings = shared_strings(PLAN_XLSX)

    fields = field_names(xml, strings)
    actual = [fields.get(col_letter(i)) for i in range(len(EXPECT_FIELDS))]
    if actual != EXPECT_FIELDS:
        raise SystemExit('[fail] PVP技能配置 字段行是 %r' % (actual,))

    rows = index_rows(xml, strings)

    # ── 守卫：24 行必须都在，且还是动手前那套数值 ──────────────────────────
    for unit_id, damage_chain, rate_chain in PAIRS:
        for level in (1, 2, 3):
            for chain, stat_id, expected in ((damage_chain, 'critDamage', OLD_CRIT_DAMAGE[level]),
                                            (rate_chain, 'critRate', OLD_CRIT_RATE[level])):
                key = (unit_id, chain, level)
                if key not in rows:
                    raise SystemExit('[fail] 找不到 %s' % (key,))
                row = rows[key]
                got_stat = cell_value(xml, 'P%d' % row, strings)
                got_value = cell_value(xml, 'R%d' % row, strings)
                if got_stat != stat_id or int(float(got_value)) != expected:
                    raise SystemExit('[fail] %s 是 %s/%s，预期 %s/%d —— 表被人改过，拒绝覆盖'
                                     % (key, got_stat, got_value, stat_id, expected))

    # ── 1) 删掉暴伤行 ──────────────────────────────────────────────────────
    doomed = {rows[(unit_id, damage_chain, level)]
              for unit_id, damage_chain, _ in PAIRS for level in (1, 2, 3)}

    def strip_row(match):
        return '' if int(match.group(1)) in doomed else match.group(0)

    xml = re.sub(r'<row r="(\d+)"(?:\s[^>]*)?(?:/>|>.*?</row>)', strip_row, xml, flags=re.S)

    # ── 2) 改暴击率 + 文案 ────────────────────────────────────────────────
    for unit_id, _, rate_chain in PAIRS:
        for level in (1, 2, 3):
            row = rows[(unit_id, rate_chain, level)]
            rate = NEW_CRIT_RATE[level]
            xml = set_cell(xml, 'R%d' % row, rate)
            xml = set_cell(xml, 'Z%d' % row,
                           '暴击率提高%d%%，命中对周围造成%d%%溅射伤害' % (rate, SPLASH[level]))

    backup = write_zip_members(PLAN_XLSX, {PLAN_MEMBER: xml}, BACKUP_DIR, 'liebian-rate-only')
    print('[PVP技能配置] 删除 %d 行暴伤、改写 12 行暴击率；备份 %s' % (len(doomed), backup))

    # ── 回读 ──────────────────────────────────────────────────────────────
    check = read_zip_rows(PLAN_XLSX, PLAN_MEMBER)
    check_strings = shared_strings(PLAN_XLSX)
    check_rows = index_rows(check, check_strings)
    for unit_id, damage_chain, _ in PAIRS:
        for level in (1, 2, 3):
            if (unit_id, damage_chain, level) in check_rows:
                raise SystemExit('[fail] %s 的暴伤行没删掉' % ((unit_id, damage_chain, level),))
    for unit_id, _, rate_chain in PAIRS:
        for level in (1, 2, 3):
            row = check_rows[(unit_id, rate_chain, level)]
            got = cell_value(check, 'R%d' % row, check_strings)
            if int(float(got)) != NEW_CRIT_RATE[level]:
                raise SystemExit('[fail] %s 暴击率还是 %s' % ((unit_id, rate_chain, level), got))
    sample = check_rows[('68025', 102502, 3)]
    print('  抽样 68025/102502/L3：statId=%s value=%s desc=%s'
          % (cell_value(check, 'P%d' % sample, check_strings),
             cell_value(check, 'R%d' % sample, check_strings),
             cell_value(check, 'Z%d' % sample, check_strings)))


if __name__ == '__main__':
    main()
