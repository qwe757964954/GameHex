# -*- coding: utf-8 -*-
"""运动霸（68033）的普攻间隔 1.8 → 0.7（2026-11-03）。

用户口径：「冲刺是运动霸的普通攻击，每次普通攻击都会有 0.7 秒的冷却时间，
冷却时间静止在原地播放待机动作」。

所以这个 0.7 不是「冲刺专用的额外冷却」，就是这张卡的**攻击间隔**本身：
冲刺整段（约 0.5s 的冲锋 + 撞上）是这一拳的动作，撞上 / 冲空那一刻起算 0.7s 原地待机，
然后下一次冲锋。用 `unitAttackInterval` 而不是新加一列，是为了：
  ① 表源只有一处，策划改攻速时就改这一格；
  ② `ZCUnitSystem` 里 `nextAttackAt` 对所有单位是同一套口径，不会出现「两套冷却」；
  ③ 快照 / 回放不用新增字段。

三处必须同值（表源 + 导出产物 + 运行时打包态），少写一处下次重导就会被冲回 1.8：
  ① doc/塔防数据配置/PVP-卡牌.xlsx（Y 列 = 第 25 列，`unitAttackInterval`）
  ② doc/塔防数据配置/json/client/pvpCard.json（转表产物，紧凑行数组）
  ③ Demo3.8/assets/remoteRef/pvpCard.json（运行时，列存 {k,v,c}）
②③ 走 `tools/config/ref_table_io.js`，别用 JSON.stringify 直接覆写 —— 两套磁盘格式的
空白/换行是既定的，随手重排会把整张卡表变成 diff 炸弹。
"""
import json
import os
import shutil

from openpyxl import load_workbook

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
XLSX = os.path.join(ROOT, 'PVP-卡牌.xlsx')
CLIENT_JSON = os.path.join(ROOT, 'json', 'client', 'pvpCard.json')
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

CARD_ID = 68033
FIELD = 'unitAttackInterval'
OLD = 1.8
NEW = 0.7
XLSX_COL = 25          # Y 列
HEADER_ROWS = 6
DATA_START = 7
DESC = '单位攻击间隔（秒）；运动霸＝一次冲锋 + 0.7s 原地待机'


def main():
    # ------- 表源
    os.makedirs(BACKUP, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP, 'PVP-卡牌.xlsx'))

    wb = load_workbook(XLSX)
    ws = wb['卡牌配置']
    header = {r: ws.cell(r, XLSX_COL).value for r in range(1, HEADER_ROWS + 1)}
    if header[5] != FIELD:
        raise SystemExit('Y 列第 5 行字段名不是 %r：%r（列序被动过？）' % (FIELD, header[5]))

    target_row = None
    for r in range(DATA_START, ws.max_row + 1):
        if ws.cell(r, 1).value is not None and str(ws.cell(r, 1).value).strip() == str(CARD_ID):
            target_row = r
            break
    if target_row is None:
        raise SystemExit('PVP-卡牌.xlsx 里找不到卡 %d' % CARD_ID)

    cell = ws.cell(target_row, XLSX_COL)
    if cell.value == NEW and ws.cell(4, XLSX_COL).value == DESC:
        print('[skip] excel 已是 %s 且说明已是新口径' % NEW)
    else:
        if cell.value not in (OLD, NEW):
            raise SystemExit('excel Y%d 既不是 %s 也不是 %s：%r' % (target_row, OLD, NEW, cell.value))
        before = cell.value
        cell.value = NEW
        ws.cell(4, XLSX_COL).value = DESC
        try:
            wb.save(XLSX)
        except PermissionError:
            raise SystemExit(
                'PVP-卡牌.xlsx 正被 Excel / WPS 打开（目录里有 ~$PVP-卡牌.xlsx 锁文件），写不进去。\n'
                '  关掉这个工作簿后重跑：python tools/config/set_yundongba_attack_interval.py\n'
                '  注意：两份 json 已经改成 %s，表源还是 %s；不补这一步，下次重导会被冲回去。' % (NEW, before)
            )
        ws2 = load_workbook(XLSX)['卡牌配置']
        got = ws2.cell(target_row, XLSX_COL).value
        if abs(float(got) - NEW) > 1e-9:
            raise SystemExit('excel 回读不一致：%r' % got)
        dirty = [ws2.cell(r, 1).value for r in range(DATA_START, ws2.max_row + 1)
                 if str(ws2.cell(r, 1).value).strip() != str(CARD_ID)
                 and ws2.cell(r, XLSX_COL).value not in (None, '')
                 and abs(float(ws2.cell(r, XLSX_COL).value) - NEW) < 1e-9]
        if dirty:
            raise SystemExit('这些行的攻击间隔被一起改了：%s' % dirty[:8])
        print('[ok] PVP-卡牌.xlsx 第 %d 行 Y 列：%s → %s' % (target_row, before, NEW))

    # ------- 导出产物 / 运行时打包态（都走 ref_table_io，格式由它兜住）
    script = os.path.join('D:/Alan/Project/POW/Demo3.8', 'tools', 'config', 'write_card_interval.js')
    if not os.path.exists(script):
        raise SystemExit('缺少 %s' % script)
    print('[next] 再执行 node tools/config/write_card_interval.js 同步两份 json')


if __name__ == '__main__':
    main()
