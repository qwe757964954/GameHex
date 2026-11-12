# -*- coding: utf-8 -*-
"""68025 大威天芦「天降神拳」102504：J 表（pvpSkillPlan）升级档 + 普攻行解耦。

为什么这份表走 zip 级手术、不用 openpyxl：
`J-技能表.xlsx` 有 16 个页签、`共享公式 / 4 份批注 / vmlDrawing / _FilterDatabase 名称`。
用 openpyxl 存一次，eSon 就**读不出这张表**（实测 `pvpSkillPlan=0`、`skillAttrModifier=0`、
`skillEffect=0`，连带 `armySkillLevelUp.modfiy` 全部报「引用不存在」）。
所以只改 `xl/worksheets/sheet9.xml`（PVP技能配置）这一个成员，其余字节原样保留。

做两件事：
  1. 单位 68025 现有 15 行的 `pvpSkillId` 30171 → 30858
     （校验器要求 pvpSkillPlan.pvpSkillId 必须等于该单位当前普攻行；解耦见
     `patch_dawtianlu_skill.py` 的说明）；
  2. 末尾追加 102504 的三档（L1/L2/L3）。追加而不插入：插入要顺移后面全部行的 `r`，
     收益只是「行挨在一起」，风险却是整表错位 —— 导出按字段名读，行序无意义。

数值口径（与 `技能设计案2.xlsx` 落地口径列一致）：
    damageRate 2.14 / 3.57 / 5.00  =  300 / 500 / 700 ÷ 面板攻击 140
    pierceCount 4 / 6 / 8          =  最多命中 5 / 7 / 9 人（规范口径**不含首个目标**）
    pierceFalloff 0.5              =  每多命中一人伤害递减 50%
    projectileLifeSeconds 4        =  弹速 100 × 4 秒 = 400px 射程
"""
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    bump_dimension, cell_xml, col_letter, read_zip_rows, set_cell, write_zip,
)

PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/J-技能表.xlsx'
MEMBER = 'xl/worksheets/sheet9.xml'          # workbook.xml: PVP技能配置 = rId9
SST_MEMBER = 'xl/sharedStrings.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'

CARD_ID = '68025'
OLD_SKILL_ID = 30171
NEW_SKILL_ID = 30858
CHAIN_ID = 102504
SKILL_NAME = '天降神拳'
SOURCE_VERSION = '技能设计案2 大威天芦 v1.0'

TIERS = [
    # level, modifierId, unlockHeroLevel, damageRate, pierceCount, 命中人数, 面板伤害
    (1, 94025041, 0, 2.14, 4, 5, 300),
    (2, 94025042, 20, 3.57, 6, 7, 500),
    (3, 94025043, 25, 5.00, 8, 9, 700),
]

# 列序（与 sheet 第 5 行字段名一一对应，A..AC）
COLS = ['enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
        'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
        'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'statId', 'operation',
        'value', 'statusId', 'statusStatJson', 'durationSeconds', 'maxStacks',
        'replacementSkillId', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion',
        'publishStatus', 'skillParamJson']


def load_sst(xml):
    return [re.sub(r'<[^>]+>', '', m) for m in re.findall(r'<si>(.*?)</si>', xml, re.S)]


def cell_element(scope, ref):
    """取某个单元格的**完整** `<c>` 元素（含属性）——`t="s"` 长在属性上，
    只捕获元素内容会把共享字符串当成数字，比对 unitId 就会永远落空。"""
    m = re.search(r'<c r="%s"(?:[^>]*?/>|[^>]*?>.*?</c>)' % ref, scope, re.S)
    return m.group(0) if m else None


def cell_text(element, sst):
    """把一个 `<c>` 元素还原成作者看得懂的字符串（共享字符串会回查 sst）。"""
    if not element:
        return ''
    if '<is>' in element:
        return ''.join(re.findall(r'<t[^>]*>(.*?)</t>', element, re.S))
    value = re.search(r'<v>(.*?)</v>', element, re.S)
    if not value:
        return ''
    text = value.group(1)
    if 't="s"' in element:
        index = int(text)
        return sst[index] if index < len(sst) else ''
    return text


def main():
    xml = read_zip_rows(PATH, MEMBER)
    sst = load_sst(read_zip_rows(PATH, SST_MEMBER))

    # ---- 1) 找 68025 的行（C 列是共享字符串，必须回查 sst 才能比对）
    card_rows = []
    row_xml = {}
    for m in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        row_num, inner = int(m.group(1)), m.group(2)
        row_xml[row_num] = inner
        if cell_text(cell_element(inner, 'C%d' % row_num), sst) == CARD_ID:
            card_rows.append(row_num)
    if not card_rows:
        raise SystemExit('[fail] sheet9 里找不到 unitId=%s 的行' % CARD_ID)

    existing_chain = [row_num for row_num in card_rows
                      if cell_text(cell_element(row_xml[row_num], 'D%d' % row_num), sst)
                      == str(CHAIN_ID)]
    if len(existing_chain) == len(TIERS):
        print('[skip] 102504 三档已存在：行 %s' % existing_chain)
        existing_chain = existing_chain
    elif existing_chain:
        raise SystemExit('[fail] 102504 只存在 %d 行，先人工核对' % len(existing_chain))

    # ---- 2) pvpSkillId 30171 → 30858
    moved = 0
    for row_num in card_rows:
        ref = 'K%d' % row_num
        km = cell_element(xml, ref)
        if not km:
            raise SystemExit('[fail] 第 %d 行没有 %s' % (row_num, ref))
        current = cell_text(km, sst)
        if current == str(NEW_SKILL_ID):
            continue
        if current != str(OLD_SKILL_ID):
            raise SystemExit('[fail] 第 %d 行 pvpSkillId=%r，既不是 %s 也不是 %s'
                             % (row_num, current, OLD_SKILL_ID, NEW_SKILL_ID))
        xml = set_cell(xml, ref, NEW_SKILL_ID)
        moved += 1
    print('  pvpSkillId %s -> %s：%d 行' % (OLD_SKILL_ID, NEW_SKILL_ID, moved))

    # ---- 3) 追加 102504 三档
    if not existing_chain:
        last_row = max(int(n) for n in re.findall(r'<row r="(\d+)"', xml))
        for index, (level, modifier_id, unlock, rate, pierce, count, damage) in enumerate(TIERS):
            row_num = last_row + 1 + index
            values = {name: '' for name in COLS}
            values.update({
                'enabled': 1,
                'modifierId': modifier_id,
                'unitId': CARD_ID,
                'skillChainId': CHAIN_ID,
                'skillName': SKILL_NAME,
                'skillLevel': level,
                'unlockHeroLevel': unlock,
                'skillKind': 'active_attack',
                'passiveScope': 'battle',
                'progressionMode': 'replace',
                'pvpSkillId': NEW_SKILL_ID,
                'behaviorKey': 'skill_params',
                'stateMode': 'none',
                'desc': ('累计 8 次普攻，向目标方向打出一记贯穿重拳（弹速 100、持续 4 秒）；'
                         '最多命中 %d 个敌人，单个目标受到 %d%% 伤害（≈%d），'
                         '每多命中一人递减 50%%' % (count, int(round(rate * 100)), damage)),
                'sourceVersion': SOURCE_VERSION,
                'publishStatus': '可发布',
                'skillParamJson': '{"damageRate":%.2f,"pierceCount":%d,'
                                  '"pierceFalloff":0.5,"projectileLifeSeconds":4}'
                                  % (rate, pierce),
            })
            cells = ''.join(
                cell_xml('%s%d' % (col_letter(i), row_num),
                         None,
                         values[name] if values[name] != '' else None)
                for i, name in enumerate(COLS))
            xml = xml.replace('</sheetData>',
                              '<row r="%d" spans="1:29">%s</row></sheetData>' % (row_num, cells), 1)
            xml = bump_dimension(xml, row_num)
            print('  + 102504 L%d modifierId=%s pierce=%d rate=%.2f（第 %d 行）'
                  % (level, modifier_id, pierce, rate, row_num))

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    moved_backup = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, 'J-技能表.xlsx.bak-%s' % stamp)
    if os.path.isfile(moved_backup):
        if os.path.isfile(backup):
            os.remove(backup)
        os.replace(moved_backup, backup)

    # ---- 4) 回读自检
    check = read_zip_rows(PATH, MEMBER)
    check_sst = load_sst(read_zip_rows(PATH, SST_MEMBER))
    bad = []
    chain_rows = []
    for m in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', check, re.S):
        row_num, inner = int(m.group(1)), m.group(2)
        if cell_text(cell_element(inner, 'C%d' % row_num), check_sst) != CARD_ID:
            continue
        if cell_text(cell_element(inner, 'K%d' % row_num), check_sst) != str(NEW_SKILL_ID):
            bad.append(row_num)
        if cell_text(cell_element(inner, 'D%d' % row_num), check_sst) == str(CHAIN_ID):
            chain_rows.append(row_num)
    if bad:
        raise SystemExit('[fail] 回读失败，仍指向旧行：%s' % bad)
    if len(chain_rows) != len(TIERS):
        raise SystemExit('[fail] 回读失败：102504 命中 %d 行' % len(chain_rows))
    print('[ok] 回读通过（68025 共 %d 行，102504 %d 档）；备份 %s'
          % (len(card_rows) + len(chain_rows) - len(existing_chain), len(chain_rows), backup))


if __name__ == '__main__':
    main()
