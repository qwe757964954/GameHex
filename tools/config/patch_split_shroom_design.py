# -*- coding: utf-8 -*-
"""设计案（技能设计案2.xlsx · sheet1）101404 一人成军的分身口径同步（2026-11-19 第 26 批）。

用户口径：
  · 召唤 3/4/6 只新的分裂菇（数量本来就对，不动）；
  · 攻击力 / 生命值只有本体 30%/50%/80%（本来就对，不动）；
  · 移动速度、攻击速度、攻击范围与本体一致，也会去寻找敌人攻击；
  · 分身的数量不加入单位计算数量；
  · 场上最多同时存在 12 个技能召唤出来的分裂菇，超过时**不释放**该技能；
  · 召唤出来的分裂菇血量为 0 才消失。

只动 68014 那一行的 N / O / P 三格（L1 / L2 / L3 文案）。J（链号）/ K（技能名）/
L（触发方式）/ M（累计普攻 8 次）本来就对，一个字节都不碰 —— 这三列是配表与用例的对齐锚。
幂等：逐格比对，内容没变就跳过（整份不写盘）。

🔴 WPS 开着这份表时会抛 WinError 5/32 —— 先关掉再跑。
用法：python tools/config/patch_split_shroom_design.py
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

CHAIN = 101404
EVERY = 8
MAX_ALIVE = 12
TIERS = [
    ('N', 'L1（兵种 9 级）', 3, 30),
    ('O', 'L2（兵种 18 级）', 4, 50),
    ('P', 'L3（兵种 27 级）', 6, 80),
]


def tier_text(prefix, count, pct):
    return (f'{prefix}：累计普攻 {EVERY} 次后在本体位置召唤 {count} 只分裂菇分身；'
            f'每只继承本体 {pct}% 攻击力与 {pct}% 生命值，移动速度、攻击速度、攻击范围与本体一致；'
            '分身会自己寻找敌人攻击，不计入单位数量上限，只有血量归零才消失（本体阵亡也不会散）；'
            f'场上最多同时存在 {MAX_ALIVE} 只技能召唤出来的分裂菇，'
            '再召唤会超过上限时本次不释放该技能')


def find_row(xml):
    """按 G 列链号定位行（A 列是卡牌 ID，G 列是技能链号）。"""
    for row in range(3, 400):
        got = value_of(xml, 'G%d' % row)
        if got and got.strip().isdigit() and int(got) == CHAIN:
            return row
    raise SystemExit('[fail] 设计案里找不到链 %d' % CHAIN)


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    row = find_row(xml)
    plan = {}
    for column, prefix, count, pct in TIERS:
        plan['%s%d' % (column, row)] = tier_text(prefix, count, pct)

    changed = 0
    for ref in sorted(plan):
        value = plan[ref]
        have = value_of(xml, ref)
        if have is not None and have == str(value):
            continue
        xml = write_cell(xml, ref, value)
        changed += 1

    if not changed:
        print('[skip] 设计案 101404 三档文案已是目标值')
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, '技能设计案2.xlsx.bak-splitshroom'))
    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == MEMBER:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, XLSX)
    print('[ok] 技能设计案2.xlsx 第 %d 行：改 %d 格' % (row, changed))


if __name__ == '__main__':
    main()
