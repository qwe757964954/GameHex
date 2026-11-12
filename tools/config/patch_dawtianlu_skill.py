# -*- coding: utf-8 -*-
"""68025 大威天芦「天降神拳」（skill 102504 / pvpSkill 30859）落地配表补丁。

一次改 4 份源表（json 只是产物，改 JSON 下次打表会被刷回）：

  1. PVP-技能.xlsx / 技能配置 —— 新增两行
       30858「大威天芦普攻」melee，empoweredEvery=8、empoweredSkillId=30859
       30859「天降神拳」projectile，projectileSpeed=100、特效=大拳飞冲
     为什么要解耦：68025 此前借的是 30171「长枪兵普攻」（empoweredEvery=10、
     empoweredSkillId=36171）。改 30171 会连带改掉场上所有长枪兵单位，所以另起专属行
     —— 与 2026-10-29 巨力坚果 30802 的做法一致。
  2. PVP-卡牌.xlsx / 卡牌配置 —— 68025.unitSkillId 30171 → 30858
  3. J-技能表.xlsx / PVP技能配置 —— 68025 已有 15 行的 pvpSkillId 30171 → 30858
     （校验器要求 pvpSkillPlan.pvpSkillId 必须等于该单位当前普攻行）；
     并插 3 行 102504 的升级档（damageRate 2.14/3.57/5.00 = 300/500/700 ÷ 面板 140、
     pierceCount 4/6/8 = 最多命中 5/7/9 人、pierceFalloff 0.5 = 每多一人 -50%、
     projectileLifeSeconds 4 = 持续 4 秒）。
  4. K-卡牌升级.xlsx / 卡牌技能升级表 —— 102504 三档补 name / desc
     （modfiy 留空，由 project_skill_plan.mjs 从 pvpSkillPlan.modifierId 回填）。

可重入：已存在的行/已改好的值一律跳过；每份表改动前都备份到
`doc/塔防数据配置_历史备份/` 并回读自检。
"""
import os
import shutil
from copy import copy
from datetime import datetime

import openpyxl

DOC_ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
BACKUP_ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'

CARD_ID = '68025'
OLD_SKILL_ID = 30171
NEW_SKILL_ID = 30858
EMPOWERED_SKILL_ID = 30859
CHAIN_ID = 102504

# 30859 天降神拳本体：mode / 速度 / 特效
FIST_PREFAB = 'units/projectiles/大拳飞冲子弹类特效/大拳飞冲子弹类特效'

# 102504 三档：(等级, modifierId, 解锁兵种等级, damageRate, pierceCount, 命中人数, 面板伤害)
TIERS = [
    (1, 94025041, 0, 2.14, 4, 5, 300),
    (2, 94025042, 20, 3.57, 6, 7, 500),
    (3, 94025043, 25, 5.00, 8, 9, 700),
]

stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
os.makedirs(BACKUP_ROOT, exist_ok=True)


def backup(path):
    dst = os.path.join(BACKUP_ROOT, '%s.bak-%s' % (os.path.basename(path), stamp))
    shutil.copy2(path, dst)
    print('    备份 ->', dst)
    return dst


def header_index(ws, header_row, *names):
    """按字段名反查列号；列序被插列改乱就直接报错，不猜。"""
    wanted = {name: None for name in names}
    for col in range(1, ws.max_column + 1):
        value = ws.cell(header_row, col).value
        if value in wanted and wanted[value] is None:
            wanted[value] = col
    missing = [name for name, col in wanted.items() if col is None]
    if missing:
        raise SystemExit('[fail] 第 %d 行找不到字段：%s' % (header_row, missing))
    return wanted


def copy_style(src_cell, dst_cell):
    if src_cell.has_style:
        dst_cell._style = copy(src_cell._style)


def first_free_row(ws, start):
    row = start
    while ws.cell(row, 1).value not in (None, ''):
        row += 1
    return row


def patch_pvp_skill():
    path = os.path.join(DOC_ROOT, 'PVP-技能.xlsx')
    wb = openpyxl.load_workbook(path)
    ws = wb['技能配置']
    cols = header_index(ws, 5, 'skillId', 'name', 'mode', 'projectileSpeed',
                        'empoweredEvery', 'empoweredSkillId', 'effectPrefabPath',
                        'trigger', 'cooldown')
    rows = {}
    for row in range(7, ws.max_row + 1):
        value = ws.cell(row, cols['skillId']).value
        if value in (NEW_SKILL_ID, EMPOWERED_SKILL_ID):
            rows[value] = row
    if len(rows) == 2:
        print('  [skip] 30858 / 30859 已存在')
        return
    if rows:
        raise SystemExit('[fail] 30858 / 30859 只存在一半，先人工核对：%s' % rows)

    print('  PVP-技能.xlsx / 技能配置')
    backup(path)
    template_row = ws.max_row          # 以最后一行为样式模板
    targets = [
        # skillId,        name,           mode,        speed, every, empowered, prefab
        (NEW_SKILL_ID,     '大威天芦普攻', 'melee',     0,     8,     EMPOWERED_SKILL_ID,
         'units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光'),
        (EMPOWERED_SKILL_ID, '天降神拳',   'projectile', 100,  0,     0, FIST_PREFAB),
    ]
    for offset, (skill_id, name, mode, speed, every, empowered, prefab) in enumerate(targets):
        row = first_free_row(ws, template_row) + offset
        for col in range(1, ws.max_column + 1):
            copy_style(ws.cell(template_row, col), ws.cell(row, col))
            ws.cell(row, col).value = None
        ws.cell(row, cols['skillId']).value = skill_id
        ws.cell(row, cols['name']).value = name
        ws.cell(row, cols['mode']).value = mode
        ws.cell(row, cols['projectileSpeed']).value = speed
        ws.cell(row, cols['empoweredEvery']).value = every
        ws.cell(row, cols['empoweredSkillId']).value = empowered
        ws.cell(row, cols['effectPrefabPath']).value = prefab
        ws.cell(row, cols['trigger']).value = 'every_n_attacks' if every else ''
        ws.cell(row, cols['cooldown']).value = 0
        print('    + %s %s（第 %d 行）' % (skill_id, name, row))
    wb.save(path)

    check = openpyxl.load_workbook(path)['技能配置']
    for skill_id in (NEW_SKILL_ID, EMPOWERED_SKILL_ID):
        hit = [r for r in range(7, check.max_row + 1)
               if check.cell(r, cols['skillId']).value == skill_id]
        if len(hit) != 1:
            raise SystemExit('[fail] 回读失败：%s 命中 %d 行' % (skill_id, len(hit)))
    print('  [ok] 回读通过')


def patch_pvp_card():
    path = os.path.join(DOC_ROOT, 'PVP-卡牌.xlsx')
    wb = openpyxl.load_workbook(path)
    ws = wb['卡牌配置']
    cols = header_index(ws, 5, 'id', 'unitSkillId')
    target = None
    for row in range(7, ws.max_row + 1):
        if str(ws.cell(row, cols['id']).value) == CARD_ID:
            target = row
            break
    if target is None:
        raise SystemExit('[fail] PVP-卡牌.xlsx 找不到卡 %s' % CARD_ID)

    cell = ws.cell(target, cols['unitSkillId'])
    before = cell.value
    if before == NEW_SKILL_ID:
        print('  [skip] 68025.unitSkillId 已是 %s' % NEW_SKILL_ID)
        return
    if before != OLD_SKILL_ID:
        raise SystemExit('[fail] 68025.unitSkillId 现值是 %r，既不是 %s 也不是 %s，拒绝覆盖'
                         % (before, OLD_SKILL_ID, NEW_SKILL_ID))
    print('  PVP-卡牌.xlsx / 卡牌配置：68025.unitSkillId %s -> %s' % (before, NEW_SKILL_ID))
    backup(path)
    cell.value = NEW_SKILL_ID
    wb.save(path)
    check = openpyxl.load_workbook(path)['卡牌配置'].cell(target, cols['unitSkillId']).value
    if check != NEW_SKILL_ID:
        raise SystemExit('[fail] 回读失败：%r' % (check,))
    print('  [ok] 回读通过')


def plan_desc(tier, count, rate, damage):
    percent = int(round(rate * 100))
    return ('累计 8 次普攻，向目标方向打出一记贯穿重拳（弹速 100、持续 4 秒）；'
            '最多命中 %d 个敌人，单个目标受到 %d%% 伤害（≈%d），每多命中一人递减 50%%'
            % (count, percent, damage))


def patch_skill_plan():
    path = os.path.join(DOC_ROOT, 'J-技能表.xlsx')
    wb = openpyxl.load_workbook(path)
    ws = wb['PVP技能配置']
    cols = header_index(ws, 5, 'enabled', 'modifierId', 'unitId', 'skillChainId',
                        'skillName', 'skillLevel', 'unlockHeroLevel', 'skillKind',
                        'passiveScope', 'progressionMode', 'pvpSkillId', 'behaviorKey',
                        'stateMode', 'desc', 'sourceVersion', 'publishStatus',
                        'skillParamJson')
    card_rows = [r for r in range(7, ws.max_row + 1)
                 if str(ws.cell(r, cols['unitId']).value) == CARD_ID]
    if not card_rows:
        raise SystemExit('[fail] J-技能表 找不到 unitId=%s 的行' % CARD_ID)
    last_card_row = card_rows[-1]

    has_chain = [r for r in range(7, ws.max_row + 1)
                 if str(ws.cell(r, cols['skillChainId']).value) == str(CHAIN_ID)]
    stale = [r for r in card_rows
             if ws.cell(r, cols['pvpSkillId']).value != NEW_SKILL_ID]

    if has_chain and not stale:
        print('  [skip] 102504 已存在且 pvpSkillId 已指向 %s' % NEW_SKILL_ID)
        return

    if not has_chain:
        print('  J-技能表.xlsx / PVP技能配置')
        backup(path)
        ws.insert_rows(last_card_row + 1, len(TIERS))
        for tier_index, (level, modifier_id, unlock, rate, pierce, count, damage) in enumerate(TIERS):
            row = last_card_row + 1 + tier_index
            for col in range(1, ws.max_column + 1):
                copy_style(ws.cell(last_card_row, col), ws.cell(row, col))
                ws.cell(row, col).value = None
            values = {
                'enabled': 1,
                'modifierId': modifier_id,
                'unitId': CARD_ID,
                'skillChainId': CHAIN_ID,
                'skillName': '天降神拳',
                'skillLevel': level,
                'unlockHeroLevel': unlock,
                'skillKind': 'active_attack',
                'passiveScope': 'battle',
                'progressionMode': 'replace',
                'pvpSkillId': NEW_SKILL_ID,
                'behaviorKey': 'skill_params',
                'stateMode': 'none',
                'desc': plan_desc(level, count, rate, damage),
                'sourceVersion': '技能设计案2 大威天芦 v1.0',
                'publishStatus': '可发布',
                'skillParamJson': '{"damageRate":%.2f,"pierceCount":%d,'
                                  '"pierceFalloff":0.5,"projectileLifeSeconds":4}'
                                  % (rate, pierce),
            }
            for name, value in values.items():
                ws.cell(row, cols[name]).value = value
            print('    + 102504 L%d modifierId=%s pierce=%d rate=%.2f（第 %d 行）'
                  % (level, modifier_id, pierce, rate, row))
        stale = [r for r in card_rows
                 if ws.cell(r, cols['pvpSkillId']).value != NEW_SKILL_ID]
    else:
        print('  J-技能表.xlsx / PVP技能配置（仅改 pvpSkillId，102504 已存在）')
        backup(path)

    for row in stale:
        ws.cell(row, cols['pvpSkillId']).value = NEW_SKILL_ID
    print('    改 pvpSkillId 30171 -> %s 共 %d 行' % (NEW_SKILL_ID, len(stale)))
    wb.save(path)

    check = openpyxl.load_workbook(path)['PVP技能配置']
    bad = [r for r in range(7, check.max_row + 1)
           if str(check.cell(r, cols['unitId']).value) == CARD_ID
           and check.cell(r, cols['pvpSkillId']).value != NEW_SKILL_ID]
    if bad:
        raise SystemExit('[fail] 回读失败，仍有 %d 行指向旧普攻行：%s' % (len(bad), bad))
    chains = [r for r in range(7, check.max_row + 1)
              if str(check.cell(r, cols['skillChainId']).value) == str(CHAIN_ID)]
    if len(chains) != len(TIERS):
        raise SystemExit('[fail] 回读失败：102504 命中 %d 行' % len(chains))
    print('  [ok] 回读通过')


def patch_card_level_up():
    path = os.path.join(DOC_ROOT, 'K-卡牌升级.xlsx')
    wb = openpyxl.load_workbook(path)
    ws = wb['卡牌技能升级表']
    cols = header_index(ws, 5, 'id', 'name', 'desc', 'unlockarmylevel', 'skilllevel')
    rows = [r for r in range(7, ws.max_row + 1)
            if str(ws.cell(r, cols['id']).value) == str(CHAIN_ID)]
    if len(rows) != 3:
        raise SystemExit('[fail] K 表 102504 命中 %d 行，预期 3 行' % len(rows))
    if ws.cell(rows[0], cols['name']).value == '天降神拳':
        print('  [skip] K 表 102504 已有名字')
        return

    print('  K-卡牌升级.xlsx / 卡牌技能升级表')
    backup(path)
    for row in rows:
        level = int(ws.cell(row, cols['skilllevel']).value)
        _, _, _, rate, _, count, damage = TIERS[level - 1]
        ws.cell(row, cols['name']).value = '天降神拳'
        ws.cell(row, cols['desc']).value = (
            '累计8次普攻，向目标方向打出一记贯穿重拳，最多命中%d个敌人，'
            '单个目标受到%d%%伤害，每多命中一人递减50%%' % (count, int(round(rate * 100))))
        print('    L%d（兵种 %s 级）' % (level, ws.cell(row, cols['unlockarmylevel']).value))
    wb.save(path)
    print('  [ok] 已写入（modfiy 留空，导出时由 pvpSkillPlan.modifierId 回填）')


print('== 1/4 PVP-技能.xlsx')
patch_pvp_skill()
print('== 2/4 PVP-卡牌.xlsx')
patch_pvp_card()
print('== 3/4 J-技能表.xlsx')
patch_skill_plan()
print('== 4/4 K-卡牌升级.xlsx')
patch_card_level_up()
print('\n完成。接着跑 npm run config:export 让 json 跟上。')
