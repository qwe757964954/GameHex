# -*- coding: utf-8 -*-
"""把「裂变暴击暴击率回到 22/30/38」写回 `doc/塔防数据配置/J-技能表.xlsx` 的 `PVP技能配置`。

配套脚本：`patch_liebian_crit_rate_back_to_2238.js`（写两份 json）。

上一轮 `patch_liebian_crit_rate_only_excel.py` 把 4 条 `10x0x` 链的暴击率压到了 3/4/5，
并删掉了 4 条 `19x0x` 链的 12 行暴伤。用户确认 **22/30/38 要保留**，所以这里只把
`R`（value）与 `Z`（desc）改回来，**不恢复暴伤行**。

结果：裂变暴击 = 暴击率 22/30/38% + 溅射 32/40/48%，暴击伤害贡献为 0。

列序（第 5 行字段名）：A enabled / B modifierId / C unitId / D skillChainId / … /
**P statId / Q operation / R value** / … / **Z desc**。

守卫：当前值必须是上一轮写的 3/4/5（或是目标值本身，幂等）；`P` 列必须还是 `critRate`。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import ROOT, read_zip_rows, set_cell  # noqa: E402
from patch_storm_radius_growth_excel import shared_strings, write_zip_members  # noqa: E402

PLAN_XLSX = os.path.join(ROOT, 'J-技能表.xlsx')
PLAN_MEMBER = 'xl/worksheets/sheet9.xml'        # rId9 = PVP技能配置
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/liebian_backup'

DATA_START = 7
RATE_CHAINS = [('68016', 101601), ('68025', 102502), ('68033', 103301), ('68034', 103402)]
NEW_CRIT_RATE = {1: 22, 2: 30, 3: 38}
OLD_CRIT_RATE = {1: 3, 2: 4, 3: 5}
SPLASH = {1: 32, 2: 40, 3: 48}


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
    rows = index_rows(xml, strings)

    # ── 守卫 ────────────────────────────────────────────────────────────────
    for unit_id, chain in RATE_CHAINS:
        for level in (1, 2, 3):
            key = (unit_id, chain, level)
            if key not in rows:
                raise SystemExit('[fail] 找不到 %s' % (key,))
            row = rows[key]
            stat_id = cell_value(xml, 'P%d' % row, strings)
            value = int(float(cell_value(xml, 'R%d' % row, strings)))
            if stat_id != 'critRate':
                raise SystemExit('[fail] %s 的 statId 是 %s，预期 critRate' % (key, stat_id))
            if value not in (NEW_CRIT_RATE[level], OLD_CRIT_RATE[level]):
                raise SystemExit('[fail] %s 是 %d，既不是上一轮的 %d 也不是目标 %d —— 表被人改过，拒绝覆盖'
                                 % (key, value, OLD_CRIT_RATE[level], NEW_CRIT_RATE[level]))

    # ── 改写 ────────────────────────────────────────────────────────────────
    for unit_id, chain in RATE_CHAINS:
        for level in (1, 2, 3):
            row = rows[(unit_id, chain, level)]
            rate = NEW_CRIT_RATE[level]
            xml = set_cell(xml, 'R%d' % row, rate)
            xml = set_cell(xml, 'Z%d' % row,
                           '暴击率提高%d%%，命中对周围造成%d%%溅射伤害' % (rate, SPLASH[level]))

    backup = write_zip_members(PLAN_XLSX, {PLAN_MEMBER: xml}, BACKUP_DIR, 'liebian-rate-2238')
    print('[PVP技能配置] 12 行暴击率 → 22/30/38；备份 %s' % backup)

    # ── 回读 ────────────────────────────────────────────────────────────────
    check = read_zip_rows(PLAN_XLSX, PLAN_MEMBER)
    check_strings = shared_strings(PLAN_XLSX)
    check_rows = index_rows(check, check_strings)
    for unit_id, chain in RATE_CHAINS:
        for level in (1, 2, 3):
            row = check_rows[(unit_id, chain, level)]
            value = cell_value(check, 'R%d' % row, check_strings)
            desc = cell_value(check, 'Z%d' % row, check_strings)
            if int(float(value)) != NEW_CRIT_RATE[level]:
                raise SystemExit('[fail] %s 回读 %s，预期 %d' % ((unit_id, chain, level), value, NEW_CRIT_RATE[level]))
            if '暴击伤害' in (desc or ''):
                raise SystemExit('[fail] %s 的 desc 还写着暴击伤害：%s' % ((unit_id, chain, level), desc))
    #  暴伤行必须一行都不在（上一轮删掉的不能被谁刷回来）。
    stray = [key for key in check_rows if key[1] in (191601, 192502, 193301, 193402)]
    if stray:
        raise SystemExit('[fail] 暴伤链又出现了：%s' % stray)
    sample = check_rows[('68025', 102502, 3)]
    print('  抽样 68025/102502/L3：value=%s desc=%s'
          % (cell_value(check, 'R%d' % sample, check_strings),
             cell_value(check, 'Z%d' % sample, check_strings)))


if __name__ == '__main__':
    main()
