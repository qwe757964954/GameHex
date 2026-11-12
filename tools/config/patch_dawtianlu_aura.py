# -*- coding: utf-8 -*-
"""大威天芦 68025 第二批：① 纠正 102504 伤害口径；② 落地「无尘禁土」102503。

## ① 102504 天降神拳：300/500/700 是**普通伤害的百分比比率**

上一轮按「绝对伤害 ÷ 面板攻击 140」落成 `damageRate = 2.14/3.57/5.00`。
用户 2026-11-09 明确：**300/500/700 就是普通伤害的百分比比率**，即 `damageRate = 3.0/5.0/7.0`。
本脚本把 J 表三档的 `desc` + `skillParamJson` 一起改过来（K 表与设计案的文案同步）。

## ② 102503 无尘禁土：`behaviorKey = 'self_aura'`

设计案第 125 行：主动-冷却 15 秒；L1/L2/L3 解锁 9/18/24；持续 4/6/8 秒、每秒 30/40/55% 伤害；
III 级额外「期间自身伤害提高 20%」；「本体携带的范围持续伤害，跟随本体移动」。

参数（`skillParamJson`，**表值口径**，半径与攻击距离同一套 px）：
    auraCooldown  15        —— 冷却秒数
    auraSeconds   4/6/8     —— 持续秒数
    auraInterval  1         —— 每波间隔（「每秒」）
    auraRadius    60        —— 半径（与既有区域技能同一档，屏上直径 92.25px）
    auraDamageRate 0.30/0.40/0.55
    auraSelfDamagePct 0/0/20

`pvpSkillId` 必须写 **30858**（该单位当前普攻行）：`validate_skill_pipeline.mjs` 要求
`pvpSkillPlan[].pvpSkillId` 等于 `pvpCard.unitSkillId`；参数按 `unitId:pvpSkillId` 合并，
`aura*` 这一族键与 102504 的 `damageRate/pierceCount` 不冲突。

modifierId 取 94025051/52/53（68025 现有 9402501x/2x/4x，接在后面）。

## 为什么全部走 zip 级手术

`J-技能表.xlsx`（16 页签 / 共享公式 / 批注 / vmlDrawing）与 `K-卡牌升级.xlsx`（1492 个公式单元格）
用 openpyxl 存一次，eSon 就读不出这张表；`技能设计案2.xlsx` 有 1 个公式单元格（`伤害参数!B46`）。
三份都只替换目标成员里的若干 `<c>`，其余字节原样保留。
"""
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    bump_dimension, cell_xml, col_letter, read_zip_rows, set_cell, write_zip,
)

CARD_ID = '68025'
ATK_SKILL_ID = 30858            # pvpCard.unitSkillId（普攻行）
SOURCE_VERSION = '技能设计案2 大威天芦 v1.1'

J_PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/J-技能表.xlsx'
J_MEMBER = 'xl/worksheets/sheet9.xml'
J_SST = 'xl/sharedStrings.xml'

K_PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/K-卡牌升级.xlsx'
K_MEMBER = 'xl/worksheets/sheet2.xml'
K_BACKUP = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'

DESIGN_PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
DESIGN_MEMBER = 'xl/worksheets/sheet1.xml'
DESIGN_BACKUP = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

# ---------------------------------------------------------------- 结果数据

#  J 表列序（sheet 第 5 行字段名，A..AC，29 列）
J_COLS = ['enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
          'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
          'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'statId', 'operation',
          'value', 'statusId', 'statusStatJson', 'durationSeconds', 'maxStacks',
          'replacementSkillId', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion',
          'publishStatus', 'skillParamJson']

#  ① 102504 三档新口径：（档位, modifierId, damageRate 倍率, 命中人数, 百分比）
FIST = [
    (1, 94025041, 3.0, 5, 300),
    (2, 94025042, 5.0, 7, 500),
    (3, 94025043, 7.0, 9, 700),
]
FIST_PIERCE = {1: 4, 2: 6, 3: 8}


def fist_desc(tier, count, percent):
    return ('累计 8 次普攻，向目标方向打出一记贯穿重拳（弹速 100、持续 4 秒）；'
            '最多命中 %d 个敌人，单个目标受到 %d%% 普通伤害，每多命中一人递减 50%%'
            % (count, percent))


def fist_param(tier):
    rate = dict((t, r) for t, _m, r, _c, _p in FIST)[tier]
    return ('{"damageRate":%s,"pierceCount":%d,"pierceFalloff":0.5,'
            '"projectileLifeSeconds":4}' % (('%.1f' % rate), FIST_PIERCE[tier]))


#  ② 102503 三档：（档位, modifierId, 解锁兵种等级, 持续秒, 每秒倍率, 百分比, 自身增伤%）
AURA = [
    (1, 94025051, 9, 4, 0.30, 30, 0),
    (2, 94025052, 18, 6, 0.40, 40, 0),
    (3, 94025053, 24, 8, 0.55, 55, 20),
]
AURA_NAME = '无尘禁土'
AURA_RADIUS = 60


def aura_desc(seconds, percent, self_pct):
    text = ('冷却 15 秒：在自身脚下展开【无尘禁土】，持续 %d 秒，每秒对周围敌人造成 %d%% 普通伤害'
            % (seconds, percent))
    if self_pct:
        text += '；期间自身伤害提高 %d%%' % self_pct
    return text


def aura_param(seconds, rate, self_pct):
    parts = ['"auraCooldown":15', '"auraSeconds":%d' % seconds, '"auraInterval":1',
             '"auraRadius":%d' % AURA_RADIUS, '"auraDamageRate":%.2f' % rate]
    if self_pct:
        parts.append('"auraSelfDamagePct":%d' % self_pct)
    return '{%s}' % ','.join(parts)


# ---------------------------------------------------------------- J 表工具

def load_sst(xml):
    return [re.sub(r'<[^>]+>', '', m) for m in re.findall(r'<si>(.*?)</si>', xml, re.S)]


def cell_element(scope, ref):
    """取完整 `<c>` 元素（含属性）——`t="s"` 长在属性上，只取内容会把共享字符串当数字。"""
    m = re.search(r'<c r="%s"(?:[^>]*?/>|[^>]*?>.*?</c>)' % ref, scope, re.S)
    return m.group(0) if m else None


def cell_text(element, sst):
    if not element:
        return ''
    if '<is>' in element:
        return ''.join(re.findall(r'<t[^>]*>(.*?)</t>', element, re.S))
    value = re.search(r'<v>(.*?)</v>', element, re.S)
    if not value:
        return ''
    if 't="s"' in element:
        index = int(value.group(1))
        return sst[index] if index < len(sst) else ''
    return value.group(1)


def j_rows(xml, sst):
    """{row_num: (unitId, chainId, level)}，只收 68025 的行。"""
    out = {}
    for m in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        row_num, inner = int(m.group(1)), m.group(2)
        if cell_text(cell_element(inner, 'C%d' % row_num), sst) != CARD_ID:
            continue
        chain = cell_text(cell_element(inner, 'D%d' % row_num), sst)
        level = cell_text(cell_element(inner, 'F%d' % row_num), sst)
        out[row_num] = (chain, level)
    return out


# ---------------------------------------------------------------- 三份表

def patch_j_table():
    xml = read_zip_rows(J_PATH, J_MEMBER)
    sst = load_sst(read_zip_rows(J_PATH, J_SST))
    rows = j_rows(xml, sst)

    fist_rows = {int(level): row for row, (chain, level) in rows.items() if chain == '102504'}
    if len(fist_rows) != 3:
        raise SystemExit('[fail] J 表 102504 命中 %d 行，预期 3 行：%s' % (len(fist_rows), fist_rows))
    for tier, _mod, _rate, count, percent in FIST:
        row = fist_rows[tier]
        xml = set_cell(xml, 'Z%d' % row, fist_desc(tier, count, percent))
        xml = set_cell(xml, 'AC%d' % row, fist_param(tier))
        print('  J 102504 L%d（第 %d 行）damageRate -> %s' % (tier, row, fist_param(tier)[14:30]))

    aura_rows = {int(level): row for row, (chain, level) in rows.items() if chain == '102503'}
    if len(aura_rows) == 3:
        print('  [skip] J 表 102503 三档已存在：%s' % sorted(aura_rows.values()))
    elif aura_rows:
        raise SystemExit('[fail] J 表 102503 只存在 %d 行，先人工核对' % len(aura_rows))
    else:
        last_row = max(int(n) for n in re.findall(r'<row r="(\d+)"', xml))
        for index, (tier, modifier, unlock, seconds, rate, percent, self_pct) in enumerate(AURA):
            row_num = last_row + 1 + index
            values = {name: '' for name in J_COLS}
            values.update({
                'enabled': 1,
                'modifierId': modifier,
                'unitId': CARD_ID,
                'skillChainId': 102503,
                'skillName': AURA_NAME,
                'skillLevel': tier,
                'unlockHeroLevel': unlock,
                'skillKind': 'active_cd',
                'passiveScope': 'battle',
                'progressionMode': 'replace',
                'pvpSkillId': ATK_SKILL_ID,
                'behaviorKey': 'self_aura',
                'stateMode': 'none',
                'desc': aura_desc(seconds, percent, self_pct),
                'sourceVersion': SOURCE_VERSION,
                'publishStatus': '可发布',
                'skillParamJson': aura_param(seconds, rate, self_pct),
            })
            cells = ''.join(
                cell_xml('%s%d' % (col_letter(i), row_num), None,
                         values[name] if values[name] != '' else None)
                for i, name in enumerate(J_COLS))
            xml = xml.replace('</sheetData>',
                              '<row r="%d" spans="1:%d">%s</row></sheetData>'
                              % (row_num, len(J_COLS), cells), 1)
            xml = bump_dimension(xml, row_num)
            print('  + J 102503 L%d modifierId=%s unlock=%d %ds %.0f%% self+%d%%（第 %d 行）'
                  % (tier, modifier, unlock, seconds, rate * 100, self_pct, row_num))

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(J_PATH, J_MEMBER, xml, K_BACKUP)
    moved = os.path.join(K_BACKUP, os.path.basename(J_PATH))
    backup = os.path.join(K_BACKUP, 'J-技能表.xlsx.bak-%s' % stamp)
    if os.path.isfile(moved):
        if os.path.isfile(backup):
            os.remove(backup)
        os.replace(moved, backup)

    #  回读
    check = read_zip_rows(J_PATH, J_MEMBER)
    check_sst = load_sst(read_zip_rows(J_PATH, J_SST))
    rows = j_rows(check, check_sst)
    for tier, _mod, _rate, _count, _percent in FIST:
        row = [r for r, (c, l) in rows.items() if c == '102504' and int(l) == tier][0]
        param = cell_text(cell_element(
            re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row, check, re.S).group(1), 'AC%d' % row), check_sst)
        if '"damageRate":%.1f' % dict((t, r) for t, _m, r, _c, _p in FIST)[tier] not in param:
            raise SystemExit('[fail] 回读失败：102504 L%d 的 skillParamJson=%r' % (tier, param))
    aura_found = [r for r, (c, _l) in rows.items() if c == '102503']
    if len(aura_found) != 3:
        raise SystemExit('[fail] 回读失败：102503 命中 %d 行' % len(aura_found))
    print('  [ok] J 表回读通过；备份 %s' % backup)


def row_text(xml, row_num, col):
    m = re.search(r'<c r="%s%d"[^>]*?(?:/>|>(.*?)</c>)' % (col, row_num), xml, re.S)
    if not m:
        return None
    inner = m.group(1) or ''
    texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
    texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
    return texts[0] if texts else ''


def patch_k_table():
    xml = read_zip_rows(K_PATH, K_MEMBER)

    def rows_of(chain):
        found = {}
        for m in re.finditer(r'<c r="E(\d+)"[^>]*>(.*?)</c>', xml, re.S):
            row_num = int(m.group(1))
            if row_text(xml, row_num, 'A') != str(chain):
                continue
            level = re.search(r'<v>(\d+)</v>', m.group(2))
            found[row_num] = int(level.group(1)) if level else None
        return found

    fist = rows_of(102504)
    if len(fist) != 3:
        raise SystemExit('[fail] K 表 102504 命中 %d 行' % len(fist))
    for row, tier in sorted(fist.items()):
        count = dict((t, c) for t, _m, _r, c, _p in FIST)[tier]
        percent = dict((t, p) for t, _m, _r, _c, p in FIST)[tier]
        xml = set_cell(xml, 'C%d' % row, fist_desc(tier, count, percent))
        print('  K 102504 L%d（第 %d 行）desc -> %d%%' % (tier, row, percent))

    aura = rows_of(102503)
    if len(aura) != 3:
        raise SystemExit('[fail] K 表 102503 命中 %d 行' % len(aura))
    for row, tier in sorted(aura.items()):
        seconds, percent, self_pct = dict(
            (t, (s, p, sp)) for t, _m, _u, s, _r, p, sp in AURA)[tier]
        xml = set_cell(xml, 'B%d' % row, AURA_NAME)
        xml = set_cell(xml, 'C%d' % row, aura_desc(seconds, percent, self_pct))
        print('  K 102503 L%d（第 %d 行）-> %s' % (tier, row, AURA_NAME))

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(K_PATH, K_MEMBER, xml, K_BACKUP)
    moved = os.path.join(K_BACKUP, os.path.basename(K_PATH))
    backup = os.path.join(K_BACKUP, 'K-卡牌升级.xlsx.bak-%s' % stamp)
    if os.path.isfile(moved):
        os.replace(moved, backup)

    check = read_zip_rows(K_PATH, K_MEMBER)
    for row in fist:
        if '普通伤害' not in (row_text(check, row, 'C') or ''):
            raise SystemExit('[fail] K 表回读失败：第 %d 行' % row)
    for row in aura:
        if row_text(check, row, 'B') != AURA_NAME:
            raise SystemExit('[fail] K 表回读失败：第 %d 行' % row)
    print('  [ok] K 表回读通过；备份 %s' % backup)


def patch_design():
    xml = read_zip_rows(DESIGN_PATH, DESIGN_MEMBER)

    # ① 第 126 行 102504：三档文案 + 落地口径（百分比口径）
    fist_cells = {
        'K126': 'L1（兵种 0 级）：累计 8 次普攻后，向目标方向击出一记贯穿重拳，弹速 100、持续 4 秒；'
                '最多命中 5 个敌人，首击造成 300% 普通伤害，之后每多命中一人伤害递减 50%',
        'L126': 'L2（兵种 20 级）：累计 8 次普攻后，向目标方向击出一记贯穿重拳，弹速 100、持续 4 秒；'
                '最多命中 7 个敌人，首击造成 500% 普通伤害，之后每多命中一人伤害递减 50%',
        'M126': 'L3（兵种 25 级）：累计 8 次普攻后，向目标方向击出一记贯穿重拳，弹速 100、持续 4 秒；'
                '最多命中 9 个敌人，首击造成 700% 普通伤害，之后每多命中一人伤害递减 50%',
        'P126': 'pvpSkill 30859「天降神拳」（projectile，projectileSpeed=100，'
                'effectPrefabPath=units/projectiles/大拳飞冲子弹类特效/大拳飞冲子弹类特效）承接弹道，'
                '挂到 30858「大威天芦普攻」的 empoweredSkillId；普攻行 trigger=every_n_attacks、'
                'empoweredEvery=8（原借 30171 长枪兵普攻，2026-11-09 解耦）。'
                'skill 域 skillParamJson={"damageRate":3.0/5.0/7.0,"pierceCount":4/6/8,'
                '"pierceFalloff":0.5,"projectileLifeSeconds":4}。'
                '口径修正（2026-11-09 用户）：「300/500/700」是**普通伤害的百分比比率**，'
                'damageRate 直接写 3.0/5.0/7.0，**不再按面板攻击 140 折算**（上一轮的 2.14/3.57/5.00 作废）。'
                '另两条不变：pierceCount 不含首个目标（首目标 + 穿透 N 次 = 5/7/9 人）；'
                'projectileLifeSeconds 是让弹道寿命取固定值而不是「距离 ÷ 速度」的专用参数。'
                '升级描述与修改器引用见 K 表 102504（94025041/42/43，由 pvpSkillPlan.modifierId 回填）。',
    }
    # ② 第 125 行 102503：三档文案 + 落地口径 + 状态
    aura_cells = {
        'K125': 'L1（兵种 9 级）：冷却 15 秒。在自身脚下展开【无尘禁土】，持续 4 秒，'
                '每秒对周围敌人造成 30% 普通伤害',
        'L125': 'L2（兵种 18 级）：冷却 15 秒。在自身脚下展开【无尘禁土】，持续 6 秒，'
                '每秒对周围敌人造成 40% 普通伤害',
        'M125': 'L3（兵种 24 级）：冷却 15 秒。在自身脚下展开【无尘禁土】，持续 8 秒，'
                '每秒对周围敌人造成 55% 普通伤害；期间自身伤害提高 20%',
        'P125': 'pvpSkillPlan 102503 三档（modifierId 94025051/52/53，pvpSkillId=30858）：'
                'behaviorKey=self_aura、skillKind=active_cd、unlockHeroLevel 9/18/24；'
                'skillParamJson={"auraCooldown":15,"auraSeconds":4/6/8,"auraInterval":1,'
                '"auraRadius":60,"auraDamageRate":0.30/0.40/0.55,"auraSelfDamagePct":0/0/20}。'
                '运行期：`ZCSkillTriggerSystem.applySelfAura` 按 15 秒 CD 调 '
                '`ZCAttackResolutionSystem.castSelfAura`，在施法者脚下建一片 '
                '`ZCGroundZoneState`（waves = 持续秒 / 1s，逐波结算半径内敌人），'
                '`followUnitId` 让 `ZCGroundZoneSystem` 每帧把圆心拍回本体（「跟随本体移动」）；'
                'III 级的自身增伤是一条 `damageRatePct=20` 的限时状态，时长与光环一致。'
                '特效 units/projectiles/持续光环伤害效果/持续光环伤害效果（18 帧循环 1.5s，'
                '画布 256×390、_lscale 0.58 ⇒ 屏上宽 ≈92px，与 auraRadius 60 的判定直径对齐）。'
                '为什么不做成 periodic_damage 状态：那个 handler 只结算**承载者自己**掉血（自伤 DoT），'
                '不做半径内 AoE；也不走 team_aura —— 那个给友军挂增益，不打人。',
        'S125': '已实现',
    }
    for ref, value in list(fist_cells.items()) + list(aura_cells.items()):
        if '<c r="%s"' % ref not in xml:
            raise SystemExit('[fail] 设计案单元格 %s 不存在' % ref)
        xml = set_cell(xml, ref, value)
        print('  %s = %s…' % (ref, value[:30]))

    os.makedirs(DESIGN_BACKUP, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(DESIGN_PATH, DESIGN_MEMBER, xml, DESIGN_BACKUP)
    moved = os.path.join(DESIGN_BACKUP, os.path.basename(DESIGN_PATH))
    backup = os.path.join(DESIGN_BACKUP, '技能设计案2.xlsx.bak-%s' % stamp)
    if os.path.isfile(moved):
        os.replace(moved, backup)

    check = read_zip_rows(DESIGN_PATH, DESIGN_MEMBER)
    for ref, value in list(fist_cells.items()) + list(aura_cells.items()):
        if value[:16] not in check:
            raise SystemExit('[fail] 设计案回读失败：%s' % ref)
    print('  [ok] 设计案回读通过；备份 %s' % backup)


def main():
    print('① J-技能表.xlsx / PVP技能配置')
    patch_j_table()
    print('② K-卡牌升级.xlsx / 卡牌技能升级表')
    patch_k_table()
    print('③ 技能设计案2.xlsx / 技能设计案 (2)')
    patch_design()
    print('\n完成。下一步：npm run config:export')


if __name__ == '__main__':
    main()
