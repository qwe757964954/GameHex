# -*- coding: utf-8 -*-
"""第 17 批设计案同步（第二段，2026-11-18）：待规划 / 未实现 / 舞王的拆解。

用户口径（第 4·5·7 项）：
  4. 7 条【待规划】按照技能详述拆解；
  5. 未实现的主动也按照技能详述拆解实现；
  7. 艺术家的【舞王】重新设计（已裁定方向：**舞伴跟随本体、主动打最近的敌人**）。
  「所有的修改同步源表和设计案」。

本脚本只做**设计案侧**的「拆解」——把 K/L/M 三档补齐、把舞王整条重写、把 S 列状态改对，
并在 P 列写明落地车道与「设计没给、需要确认」的地方。数值一律照 N 列原文，不新造。

四条缺档位的：
  · 101404 一人成军（分裂菇）—— 召唤 3/4/6 只、继承 30/50/80%；
  · 101704 穿甲爆矢（毒箭蘑菇）—— 陷阱飞行 2 秒、爆炸 180/220/270%、中毒 15/25/35%、停留 6/8/10 秒；
  · 101904 生命爆发（窝瓜人）—— 移速 +50/80/100%、体型 ×2、最大生命 +15/30/50%；
  · 102704 战神附体（爆锤莲王）—— 体型 ×2、移速 −15%、攻击 +50/70/100%、6 秒、回 15% 最大生命。

一条重写：
  · 103103 舞王召唤（艺术家）—— 原设计「舞伴在以本体为圆心 200px 直径圆内活动」改成
    「跟随本体移动 + 主动攻击最近的敌人」。S 列从「已实现」改回【未实现】：
    表里现在这行是 `self_cast`（本体限时增伤 240%），跟「召唤 4 个舞伴」根本不是一件事，
    写「已实现」会让人以为召唤车道已经通了。

三处「设计没给」的空档，2026-11-18 用户已经裁掉：
  · 101404 分身**持续到战死为止**（没有时限）；
  · 101904 生命爆发**按 6 秒**落地（与 102704 同档）；
  · 101704 的「飞行速度 100px」是**每秒**（逻辑 px/s，与 101303 的 70px 同口径）。
  103103 的舞伴「跟随」按「4 个阵位跟着本体走」落地（原设计只有「不能出圈」）。

幂等：整格写固定文本，重复跑 `改 0 格`。
用法：python tools/config/patch_skill_design2_batch17b.py
"""
import html
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import set_cell, read_zip_rows, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

# ────────────────────────────────────────── 一、101404 一人成军（分裂菇 68014）

TIERS_101404 = [
    'L1（兵种 9 级）：累计普攻 8 次后召唤 3 只分裂菇分身；每只继承本体 30% 属性，'
    '只做普通攻击与被动技能，不计入单位上限',
    'L2（兵种 18 级）：累计普攻 8 次后召唤 4 只分裂菇分身；每只继承本体 50% 属性，'
    '只做普通攻击与被动技能，不计入单位上限',
    'L3（兵种 27 级）：累计普攻 8 次后召唤 6 只分裂菇分身；每只继承本体 80% 属性，'
    '只做普通攻击与被动技能，不计入单位上限',
]
P_101404 = (
    'skill 域 behaviorKey=summon_unit（count=3/4/6，statInherit=0.30/0.50/0.80，'
    'followOwner=true，autoAttack=nearest，countsTowardLimit=false）；'
    '依赖 1013 召唤元件（待建）。分身**持续到战死为止**（无时限，2026-11-18 用户确认）'
)

# ────────────────────────────────────────── 二、101704 穿甲爆矢（毒箭蘑菇 68017）

TIERS_101704 = [
    'L1（兵种 9 级）：累计普攻 8 次后朝目标丢出陷阱，飞行速度 100、飞行 2 秒；'
    '途中触碰到敌人立即爆炸，对半径 150 内敌人造成 180% 伤害，并使其中毒 6 秒、每秒 15% 伤害；'
    '若 2 秒内没碰到敌人，则在落点停留 6 秒，期间被敌人触碰同样爆炸，到期无人触碰直接消失',
    'L2（兵种 18 级）：累计普攻 8 次后朝目标丢出陷阱，飞行速度 100、飞行 2 秒；'
    '途中触碰到敌人立即爆炸，对半径 150 内敌人造成 220% 伤害，并使其中毒 6 秒、每秒 25% 伤害；'
    '若 2 秒内没碰到敌人，则在落点停留 8 秒，期间被敌人触碰同样爆炸，到期无人触碰直接消失',
    'L3（兵种 27 级）：累计普攻 8 次后朝目标丢出陷阱，飞行速度 100、飞行 2 秒；'
    '途中触碰到敌人立即爆炸，对半径 150 内敌人造成 270% 伤害，并使其中毒 6 秒、每秒 35% 伤害；'
    '若 2 秒内没碰到敌人，则在落点停留 10 秒，期间被敌人触碰同样爆炸，到期无人触碰直接消失',
]
P_101704 = (
    '复用 behaviorKey=trap_place（`ZCTrapFx` + `castTrap` + `ZCGroundZoneSystem`）：'
    '在 103504 之上补「飞行段」——trapFlightSpeed / trapFlightSeconds，途中碰到敌人立即引爆；'
    '参数一律加 `trap*` 前缀，别裸写 radius / damageRate（一卡一袋会串到普攻）。'
    '爆炸 expireDamageRate=1.8/2.2/2.7、半径 150；中毒走 `__poison:<每秒%>:<秒>__` 动态状态'
    '（intervalSeconds=1、rate=0.15/0.25/0.35、duration=6）；停留 6/8/10 秒。'
    '飞行速度 100 **逻辑 px / 秒**（2026-11-18 用户确认，与 101303 的 70px 同口径）'
)

# ────────────────────────────────────────── 三、101904 生命爆发（窝瓜人 68019）

TIERS_101904 = [
    'L1（兵种 12 级）：累计普攻 10 次后，移动速度 +50%、体型放大为 2 倍、最大生命 +15%',
    'L2（兵种 24 级）：累计普攻 10 次后，移动速度 +80%、体型放大为 2 倍、最大生命 +30%',
    'L3（兵种 36 级）：累计普攻 10 次后，移动速度 +100%、体型放大为 2 倍、最大生命 +50%',
]
P_101904 = (
    'skill 域 behaviorKey=counter_self_buff（every=10，moveSpeed addRate=0.50/0.80/1.00，'
    'bodySize addRate=1.00（即放大 2 倍），maxHp addRate=0.15/0.30/0.50）；'
    '需新增 statId bodySizePct（接到 `ZCUnitView` 的 gateScale 同一处缩放）。'
    '持续时间 **6 秒**（2026-11-18 用户确认，与 102704 同档）'
)

# ────────────────────────────────────────── 四、102704 战神附体（爆锤莲王 68027）

TIERS_102704 = [
    'L1（兵种 12 级）：累计普攻 10 次后进入附体 6 秒——体型放大为 2 倍、移动速度 −15%、'
    '攻击力 +50%；释放瞬间回复自身 15% 最大生命',
    'L2（兵种 24 级）：累计普攻 10 次后进入附体 6 秒——体型放大为 2 倍、移动速度 −15%、'
    '攻击力 +70%；释放瞬间回复自身 15% 最大生命',
    'L3（兵种 36 级）：累计普攻 10 次后进入附体 6 秒——体型放大为 2 倍、移动速度 −15%、'
    '攻击力 +100%；释放瞬间回复自身 15% 最大生命',
]
P_102704 = (
    'skill 域 behaviorKey=counter_self_buff（every=10，bodySize addRate=1.00，'
    'moveSpeed addRate=-0.15，attack addRate=0.50/0.70/1.00，duration=6，healMaxHpRate=0.15）；'
    '与 101904 共用同一条车道，差异全在参数。前缀 counter*'
)

# ────────────────────────────────────────── 五、103103 舞王召唤（艺术家 68031）· 重设计

K_103103 = ('L1（兵种 9 级）：冷却 12 秒，召唤 4 个舞伴僵尸（半透明）；每个舞伴继承舞王 80% 生命与 '
            '60% 攻击，持续 6 秒。舞伴**跟随本体移动**，并**主动攻击离自己最近的敌人**')
L_103103 = ('L2（兵种 18 级）：冷却 12 秒，召唤 4 个舞伴僵尸（半透明）；每个舞伴继承舞王 90% 生命与 '
            '70% 攻击，持续 7 秒。舞伴**跟随本体移动**，并**主动攻击离自己最近的敌人**')
M_103103 = ('L3（兵种 27 级）：冷却 12 秒，召唤 4 个舞伴僵尸（半透明）；每个舞伴继承舞王 100% 生命与 '
            '80% 攻击，持续 8 秒。舞伴**跟随本体移动**，并**主动攻击离自己最近的敌人**')
N_103103 = (
    '召唤 4 个舞伴僵尸（透明度 50% 的艺术加工），继承 80/90/100% 生命与 60/70/80% 攻击，'
    '持续 6/7/8 秒。'
    '2026-11-18 重设计：舞伴**跟随本体移动**（取消原「以艺术家为圆心 200px 直径圆内活动」的硬范围），'
    '并**主动攻击离自己最近的敌人**；舞伴只做普攻与被动，不计入单位上限，到期一起消失。'
)
O_103103 = (
    '【P13 沿用】出生特效错开 0.1s 播 4 次；舞伴落地后循环播 表演家MJ_普攻 做跳舞动作。'
    '重设计后不再需要「圆形范围光环」——改成 4 个固定阵位（左上/右上/左下/右下，半径约 60px）'
    '跟着本体走，走位时按本体朝向镜像；舞伴攻击时朝最近敌人转向'
)
P_103103 = (
    'skill 域 behaviorKey=summon_unit（count=4，hpInherit=0.80/0.90/1.00，'
    'attackInherit=0.60/0.70/0.80，duration=6/7/8，followOwner=true，'
    'followOffsetRadius=60，autoAttack=nearest）；依赖 1013 召唤元件（待建）。'
    '⚠ 表里当前这行是 self_cast（selfCastDamagePct=240，本体限时增伤），与「召唤 4 个舞伴」'
    '不是一件事 ⇒ S 列已从「已实现」改回【未实现】，等 summon_unit 落地时把这条参数整体换掉'
)

# ────────────────────────────────────────── 六、101803 毒液喷吐（诅咒菇 68018）· 已落地回填
#  设计 J 列是「待定」⇒ 触发用冷却 12；设计没给半径 ⇒ 取同卡菌核爆裂的 150。
#  两处都写进 P 列标「待确认」，不偷偷当既定值。
P_101803 = (
    'skill 域 behaviorKey=burst_aura + **venom 前缀**（同卡 101804 菌核爆裂已占用 burst 前缀，'
    '一卡一袋会互相覆盖）⇒ venomCooldown=12、venomDamageRate=1.0/1.3/1.8、venomRadius=150；'
    '中毒走 pvpStatus 三行 poison_venom_l1~l3（handler=periodic_damage、intervalSeconds=1、'
    'periodicAmountPct=20/25/35、duration=4/5/6、basis=senderAttack）；'
    'III 级「治疗降低 50%」= 该状态 statJson {"healTakenRate":-50}，由 '
    '`ZCStatusResolutionSystem.healUnit` 乘算。CD 单独记 `unit.venomReadyAt`。'
    '⚠ 待确认：J 列原写「待定」⇒ 冷却取 12（菌核爆裂 14 / 菌毯爆发 16 之间）；'
    '设计未给半径 ⇒ 取 150（与同卡菌核爆裂一致）'
)

ROWS = {
    71: {'K': TIERS_101404[0], 'L': TIERS_101404[1], 'M': TIERS_101404[2], 'P': P_101404},
    86: {'K': TIERS_101704[0], 'L': TIERS_101704[1], 'M': TIERS_101704[2], 'P': P_101704},
    96: {'K': TIERS_101904[0], 'L': TIERS_101904[1], 'M': TIERS_101904[2], 'P': P_101904,
         'S': '已实现'},
    136: {'K': TIERS_102704[0], 'L': TIERS_102704[1], 'M': TIERS_102704[2], 'P': P_102704,
          'S': '已实现'},
    90: {'P': P_101803, 'S': '已实现'},
    155: {'K': K_103103, 'L': L_103103, 'M': M_103103, 'N': N_103103, 'O': O_103103,
          'P': P_103103, 'S': '【未实现】'},
}


def load_shared_strings(path):
    with zipfile.ZipFile(path) as archive:
        raw = archive.read('xl/sharedStrings.xml').decode('utf-8')
    return [html.unescape(re.sub(r'<[^>]+>', '', block))
            for block in re.findall(r'<si>(.*?)</si>', raw, re.S)]


def cell_text(xml, ref, strings):
    match = re.search(r'<c r="%s"([^>]*?)(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    attrs, inner = match.group(1), match.group(2) or ''
    kind = re.search(r'\bt="([^"]+)"', attrs)
    name = kind.group(1) if kind else None
    if name == 's':
        value = re.search(r'<v>(.*?)</v>', inner, re.S)
        if not value:
            return ''
        index = int(value.group(1).strip())
        return strings[index] if 0 <= index < len(strings) else ''
    if name == 'inlineStr':
        return ''.join(html.unescape(part) for part in re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S))
    value = re.search(r'<v>(.*?)</v>', inner, re.S)
    return html.unescape(value.group(1)) if value else ''


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    strings = load_shared_strings(XLSX)
    changed = 0
    for row, spec in ROWS.items():
        for column, text in spec.items():
            ref = '%s%d' % (column, row)
            if cell_text(xml, ref, strings) == text:
                continue
            xml = set_cell(xml, ref, text)
            changed += 1
            print('[ok] %s（第 %d 行 %s 列）' % (ref, row, column))
    if not changed:
        print('[skip] 设计案已是目标值')
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 共改 %d 格；备份 → %s' % (changed, backup))


if __name__ == '__main__':
    main()
