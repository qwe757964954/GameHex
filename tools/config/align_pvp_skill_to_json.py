# -*- coding: utf-8 -*-
"""把 `PVP-技能.xlsx` 的数据列对齐到已发布 `json/client/pvpSkill.json` 的现值。

背景：之前几轮改技能时**只改了 json**（`tools/config/patch_*.js` 直接写 json），
Excel 源表没跟着改，于是同一份配置有两个版本。打表以 Excel 为准 ⇒ 会把 json 里
刚调好的值刷回去。本脚本反过来，把 Excel 拉到 json 的现值，让「源表 = 线上值」。

只对齐 `COLUMNS` 里显式列出的列，不做全表泛滥覆盖：
  - json 里**没有值**（None / 空串）的格子一律跳过 —— 否则会把 Excel 里填好的值抹掉；
  - 数值列只在 json 值 > 0 时覆盖；
  - 写前校验第 5 行字段名与预期一致，防止列序被插列改乱后错位写入。

重跑安全：对齐后两边相等，再跑是 0 处改动。
"""
import json
import os
import shutil
from datetime import datetime

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
PATH = os.path.join(ROOT, 'PVP-技能.xlsx')
JSON = os.path.join(ROOT, 'json', 'client', 'pvpSkill.json')
SHEET = '技能配置'
DATA_START = 7          # 1 表名 / 2 导出标记 / 3 中文 / 4 说明 / 5 字段名 / 6 类型
BACKUP_DIR = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

# (json 字段名, 列号, 比较方式)
COLUMNS = [
    ('projectileSpeed', 6, 'number'),
    ('effectPrefabPath', 10, 'path'),
]


def normalize(value, kind):
    if kind == 'number':
        try:
            return float(value) if value not in (None, '') else None
        except (TypeError, ValueError):
            return None
    text = str(value).strip().replace('\\', '/') if value is not None else ''
    return text or None


def usable(value, kind):
    """json 侧的值是否值得写进 Excel（不写空值，数值必须 > 0）。"""
    norm = normalize(value, kind)
    if norm is None:
        return False
    return norm > 0 if kind == 'number' else True


def main():
    rows = {int(item['skillId']): item for item in json.load(open(JSON, encoding='utf-8'))}

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = os.path.join(BACKUP_DIR, 'PVP-技能.before-align-%s.xlsx' % stamp)
    shutil.copy2(PATH, backup)

    wb = load_workbook(PATH)
    ws = wb[SHEET]

    # ------- 列序守卫：第 5 行必须是预期字段名
    for field, col, _ in COLUMNS:
        actual = ws.cell(5, col).value
        if actual != field:
            raise SystemExit('列 %s 第 5 行是 %r，预期 %r —— 列序变动，先人工核对'
                             % (get_column_letter(col), actual, field))

    changed = {}
    skipped = 0
    touched_rows = set()
    for r in range(DATA_START, ws.max_row + 1):
        raw_id = ws.cell(r, 1).value
        if raw_id is None:
            continue
        try:
            skill_id = int(str(raw_id).strip())
        except ValueError:
            continue
        source = rows.get(skill_id)
        if source is None:
            continue
        for field, col, kind in COLUMNS:
            if field not in source:
                continue
            want = source[field]
            if not usable(want, kind):
                skipped += 1
                continue
            current = ws.cell(r, col).value
            if normalize(current, kind) == normalize(want, kind):
                continue
            ws.cell(r, col).value = want
            changed.setdefault(field, []).append((skill_id, current, want))
            touched_rows.add(skill_id)

    if not changed:
        print('[ok] Excel 与 json 已一致，无需改动')
        return
    wb.save(PATH)

    # ------- 回读自检
    check = load_workbook(PATH)[SHEET]
    bad = []
    for field, col, kind in COLUMNS:
        for skill_id, _, want in changed.get(field, []):
            for r in range(DATA_START, check.max_row + 1):
                if str(check.cell(r, 1).value).strip() == str(skill_id):
                    if normalize(check.cell(r, col).value, kind) != normalize(want, kind):
                        bad.append((field, skill_id, check.cell(r, col).value, want))
                    break
    if bad:
        raise SystemExit('回读不一致：%s' % bad[:5])

    print('[ok] 已对齐 %d 个技能、%d 处单元格'
          % (len(touched_rows), sum(len(v) for v in changed.values())))
    for field, items in changed.items():
        print('   %-24s %2d 处' % (field, len(items)))
        for skill_id, old, new in items:
            print('      %d  %r -> %r' % (skill_id, old, new))
    if skipped:
        print('[skip] json 侧 %d 处为空值，未覆盖（保留 Excel 现值）' % skipped)
    print('[ok] 备份：%s' % backup)


if __name__ == '__main__':
    main()
