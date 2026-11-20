# -*- coding: utf-8 -*-
"""设计案（技能设计案2.xlsx · sheet1）101704 改名与口径同步（2026-11-19）。

用户口径：
  · 68017 卡名统一为「毒箭菇」（两行：101703 / 101704）；
  · 主动技 101704 由「穿甲爆矢」改名「蘑菇爆炸」；
  · 飞行速度 100（2026-11-19 21:30 定回 100）、飞行时间 2 → 1.2 秒
    （「生成」是 0.4 秒一次性动画，尾帧只多挂 0.8 秒）；
  · 表现拆成三段：飞行段「陷阱生成」/ 落地「陷阱」/ 炸开「火法师普攻爆炸」。

只动 68017 这两行的 B / H / K / L / M / N / O / P 八列，其余格一个不动。
幂等：逐格比对，内容没变就跳过（整份不写盘）。

🔴 WPS 开着这份表时会抛 WinError 5/32 —— 先关掉再跑。
用法：python tools/config/patch_mushroom_explosion_design.py
"""
import os
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows  # noqa: E402
from patch_burst_k import value_of, write_cell  # noqa: E402

XLSX = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_history'

ROW_SPLASH = 85   # 101703 群星坠落（卡名一起改）
ROW_MUSHROOM = 86  # 101704 蘑菇爆炸
COLUMN_P = 15     # 0 基：A=0 … P=15（`read_sheet` 返回的 cells 是 0 基数组）

CARD_NAME = '毒箭菇'
SKILL_NAME = '蘑菇爆炸'
SPEED_OLD = '70'   # 上一版写进表里的是 70，21:30 用户改回 100
SPEED_NEW = '100'
FLIGHT_OLD = '2'
FLIGHT_NEW = '1.2'

TIERS = [
    ('L1（兵种 9 级）', 6, '180', '15'),
    ('L2（兵种 18 级）', 8, '220', '25'),
    ('L3（兵种 27 级）', 10, '270', '35'),
]


def tier_text(prefix, stay, rate, poison):
    return (f'{prefix}：累计普攻 8 次后朝目标丢出陷阱，飞行速度 {SPEED_NEW}、飞行 {FLIGHT_NEW} 秒；'
            f'途中触碰到敌人立即爆炸，对半径 150 内敌人造成 {rate}% 伤害，'
            f'并使其中毒 6 秒、每秒 {poison}% 伤害；'
            f'若 {FLIGHT_NEW} 秒内没碰到敌人，则在落点停留 {stay} 秒，期间被敌人触碰同样爆炸，到期无人触碰直接消失')


MECH = ('类似科学家的陷阱技能，攻击次数达到触发，朝着目标丢出一个陷阱，'
        f'陷阱飞行速度{SPEED_NEW}px，持续{FLIGHT_NEW}秒，飞行途中触碰到敌人会爆炸，'
        '爆炸产生一个范围150px的伤害 180%/220%/270%  '
        '处于爆炸范围的敌人还会受到持续6s的伤害，每秒造成15%/25%/35%的伤害，'
        '如果没触碰到敌人则在原地停留 6/8/10秒，没人触碰直接消失')

VISUAL = ('【三段】飞行段：科学家_陷阱_生成（`科学家_陷阱_出现`）；'
          '落地后：科学家_陷阱（常驻循环）；'
          '炸开：火法师的普攻爆炸（`普攻爆炸`，与菌毯爆发同一个通用爆点）。零新增资源。')

MODIFIER_TAIL = ('\n【2026-11-19 表现三段】飞行段持有表现走区域的新字段 `flightVisualPath`'
                 '（= `科学家_陷阱_出现`），落地由 `ZCGroundZoneSystem.settleFlight` 摘掉飞行段那条事件、'
                 '下一帧按 `effectPrefabPath`（`科学家_陷阱`）重建；炸开的 prefab 由 '
                 '`ZCTrapFx.zcTrapExpirePath(unitId)` 按单位登记 —— 68017 走 `普攻爆炸`，'
                 '103504 精密陷阱仍走 `科学家_陷阱爆炸`。'
                 f'飞行速度改为 {SPEED_NEW}、飞行时间改为 {FLIGHT_NEW} 秒。')


def resolved_cell(row, column):
    """按 (行号, 0 基列) 取**已解析共享字符串**的单元格文本。

    这份表的长文本都是 `t="s"` 共享字符串单元格，`value_of` 只解析得出索引。
    """
    from xlsx_read import read_sheet
    for index, cells in read_sheet(XLSX, 0)[1]:
        if index != row:
            continue
        if column >= len(cells) or cells[column] is None:
            return ''
        return str(cells[column])
    return ''


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    plan = {}

    #  卡名：两行一起改
    for row in (ROW_SPLASH, ROW_MUSHROOM):
        plan['B%d' % row] = CARD_NAME

    #  技能名 + 三档文案 + 详述 + 表现描述
    plan['H%d' % ROW_MUSHROOM] = SKILL_NAME
    for column, (prefix, stay, rate, poison) in zip('KLM', TIERS):
        plan['%s%d' % (column, ROW_MUSHROOM)] = tier_text(prefix, stay, rate, poison)
    plan['N%d' % ROW_MUSHROOM] = MECH
    plan['O%d' % ROW_MUSHROOM] = VISUAL

    #  落地口径：把速度 / 时间改成 70 / 1.2，并在末尾补「表现三段」的落点说明。
    #
    #  🔴 读 P 必须走**解析共享字符串**的 `read_sheet`：这份表的长文本是 `t="s"` 单元格，
    #  `value_of` 只拿得到 `<v>` 里的共享字符串**索引**（当时读成 "558"），拿它当 base
    #  会把整格替换成「558 + 尾巴」，原文全丢 —— 2026-11-19 踩过一次，靠备份回填。
    current = resolved_cell(ROW_MUSHROOM, COLUMN_P)
    base = current.split('\n【2026-11-19 表现三段】')[0]
    if not base.strip() or base.strip().isdigit():
        raise SystemExit('[fail] P%d 读到的像是共享字符串索引（%r），拒绝用它当 base'
                         % (ROW_MUSHROOM, base[:20]))
    base = base.replace('trapFlightSpeed=' + SPEED_OLD, 'trapFlightSpeed=' + SPEED_NEW)
    base = base.replace('飞行速度 ' + SPEED_OLD, '飞行速度 ' + SPEED_NEW)
    base = base.replace('trapFlightSeconds=' + FLIGHT_OLD, 'trapFlightSeconds=' + FLIGHT_NEW)
    base = base.replace('飞行 ' + FLIGHT_OLD + ' 秒', '飞行 ' + FLIGHT_NEW + ' 秒')
    plan['P%d' % ROW_MUSHROOM] = base + MODIFIER_TAIL

    changed = 0
    for ref in sorted(plan):
        value = plan[ref]
        have = value_of(xml, ref)
        if have is not None and have == str(value):
            continue
        xml = write_cell(xml, ref, value)
        changed += 1

    if not changed:
        print('[skip] 设计案 68017 两行已是目标值')
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, '技能设计案2.xlsx.bak-mushroom'))
    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == MEMBER:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, XLSX)
    print('[ok] 技能设计案2.xlsx：改 %d 格' % changed)


if __name__ == '__main__':
    main()
