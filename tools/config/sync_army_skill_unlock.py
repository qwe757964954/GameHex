# -*- coding: utf-8 -*-
"""把技能**解锁等级**（K 表 D 列 / `armySkillLevelUp.unlockarmylevel`）对齐到
`pvpSkillPlan.unlockHeroLevel`（2026-11-25）。

## 为什么

`tools/config/patch_skill_unlock_levels.js`（2026-11-17 用户口径）规定：

    技能1 → 3/10/22    技能2 → 6/16/26    技能3 → 9/18/27    技能4 → 12/24/36
    并明确写「`armySkillLevelUp.unlockarmylevel` 必须同源（K 表 D 列读它）」

但那个脚本**只写 json**（`pvpSkillPlan` + `armySkillLevelUp` 两份），够不到 K 表 xlsx。
于是下一次「K 表 → 转表」就把 `armySkillLevelUp` 重建成 xlsx 的旧值：

| 技能格 | xlsx / army L1（旧） | 计划行 L1（对） | L2 / L3 |
| :--- | :--- | :--- | :--- |
| 技能1 | 2 | 3 | 10 / 22（一致） |
| 技能2 | 3 | 6 | 16 / 26（一致） |
| 技能3 | 5 | 9 | 18 / 27（一致） |
| 技能4 | 7 | 12 | 24 / 36（一致） |

实测 **139 行全在 skilllevel=1**，army 一律小于 plan，L2/L3 零差异 ⇒ 不是「设计改了」，
是**只有第一档从没落到 xlsx**。症状：卡面写「Lv2 解锁」，战斗侧 `ZCModifierRuntime`
按 `unlockHeroLevel` 判到 Lv3 才放行 —— 玩家看到有技能、放不出来。

## 口径

- 目标值一律取 `pvpSkillPlan.unlockHeroLevel`（已由 11-17 口径脚本写定，且与设计案四档一致）；
- 三写：K 表 D 列 + `assets/remoteRef/armySkillLevelUp.json` + client 同名 json；
- 只写 `unlockarmylevel` 一列 / 一个字段，其它列逐字节不动；
- 前置闸：① 键集 1:1（420 行）；② 表里 B 列技能名 == 计划行 `skillName`；
  ③ 表里 D 列现值 == army json 现值（说明没人手改过）；④ 两份 json 都做
  「未修改重建 == 原文逐字节」自检；
- 幂等：三方已一致就不写盘。
用法：python tools/config/sync_army_skill_unlock.py
"""
import io
import json
import os
import re
import shutil
import sys
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_read import read_sheet  # noqa: E402

XLSX = 'D:/Alan/Project/POW/doc/塔防数据配置/K-卡牌升级.xlsx'
XLSX_BACKUP = 'D:/Alan/Project/POW/doc/塔防数据配置/_backup'
MEMBER = 'xl/worksheets/sheet2.xml'
SHEET_INDEX = 1
FIRST_DATA_ROW = 7

COL_ID = 1
COL_NAME = 2
COL_UNLOCK = 4
COL_LEVEL = 5

ROOT = 'D:/Alan/Project/POW'
ARMY_REMOTE = 'assets/remoteRef/armySkillLevelUp.json'
ARMY_CLIENT = os.path.join(ROOT, 'doc/塔防数据配置/json/client/armySkillLevelUp.json')
PLAN_REMOTE = 'assets/remoteRef/pvpSkillPlan.json'
JSON_BACKUP = 'tmp/config_backup'


def col_letter(index):
    letters = ''
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell_pattern(ref):
    return re.compile(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, re.S)


def set_cell_number(xml, ref, value):
    """数字格：保留原 s=（样式），只换 <v>。不建格。"""
    m = cell_pattern(ref).search(xml)
    if not m:
        raise SystemExit('[fail] 单元格 %s 不存在（不建格）' % ref)
    style = re.search(r's="(\d+)"', m.group(0))
    style_attr = ' s="%s"' % style.group(1) if style else ''
    new = '<c r="%s"%s><v>%d</v></c>' % (ref, style_attr, int(value))
    return xml[:m.start()] + new + xml[m.end():]


# ---------- json io（带「原样重建」自检） ----------

def load_columnar(path):
    """列存 {k,v,c}：返回 (rows_as_arrays, k, 重建函数)。

    本表的落盘形态是 **CRLF + 每个元素独占一行**：

        {\\r\\n"k":[\\r\\n"id",\\r\\n…\\r\\n],\\r\\n"v":[\\r\\n[\\r\\n100101,\\r\\n…\\r\\n]\\r\\n],\\r\\n"c":1\\r\\n}

    尾部无换行。用 `json.dumps` 整份重建会变成单行 ⇒ 自检直接红（这正是要拦的：
    格式一变，转表器与所有用例一起读不动）。
    """
    raw = io.open(path, encoding='utf-8', newline='').read()  # newline='' 必须：否则 CRLF 被折成 LF
    data = json.loads(raw)
    k = data['k']
    v = data['v']
    sep = ',\r\n'

    def enc(value):
        """标量原样；数组**逐元素独占行**（`modfiy` 这种嵌套数组也一样）。"""
        if isinstance(value, list):
            if not value:
                return '[]'
            return '[\r\n' + sep.join(enc(x) for x in value) + '\r\n]'
        if isinstance(value, dict):
            items = [json.dumps(str(key), ensure_ascii=False) + ':' + enc(val)
                     for key, val in value.items()]
            return '{' + sep.join(items) + '}'
        return json.dumps(value, ensure_ascii=False)

    def render(rows):
        return ('{\r\n"k":' + enc(k)
                + ',\r\n"v":' + enc(rows)
                + ',\r\n"c":' + enc(data['c']) + '\r\n}')

    return v, k, render, raw


def load_row_array(path):
    """行对象数组（`[` + `,\n` 分隔 + `]`，无尾换行）。"""
    raw = io.open(path, encoding='utf-8', newline='').read()
    rows = json.loads(raw)

    def render(items):
        return '[' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':'))
                                for r in items) + ']'

    return rows, render, raw


def read_plan():
    data = json.load(io.open(PLAN_REMOTE, encoding='utf-8'))
    out = {}
    for row in data:
        out[(str(row['skillChainId']), int(row['skillLevel']))] = row
    return out


def main():
    plan = read_plan()

    # ---- remoteRef army（列存） ----
    army_v, army_k, army_render, army_raw = load_columnar(ARMY_REMOTE)
    if army_render(army_v) != army_raw:
        raise SystemExit('[fail] remoteRef/armySkillLevelUp 原样重建不逐字节相同，放弃')
    i_unlock = army_k.index('unlockarmylevel')
    i_id = army_k.index('id')
    i_lv = army_k.index('skilllevel')

    # ---- client army（行对象数组） ----
    c_rows, c_render, c_raw = load_row_array(ARMY_CLIENT)
    if c_render(c_rows) != c_raw:
        raise SystemExit('[fail] client/armySkillLevelUp 原样重建不逐字节相同，放弃')

    plan_keys = set(plan)
    army_keys = {(str(r[i_id]), int(r[i_lv])) for r in army_v}
    #  army 的每一行都必须能在计划行里找到（army 是子集：`109001` 属于 owner 级
    #  「全队暴击伤害增幅」，只有计划行、没有卡牌技能行，不能反过来要求 1:1）。
    only_army = sorted(army_keys - plan_keys)
    if only_army:
        raise SystemExit('[fail] army 有 %d 行在计划行里找不到：%s' % (len(only_army), only_army[:8]))

    # ---- 目标差异 ----
    diff = {}
    for row in army_v:
        key = (str(row[i_id]), int(row[i_lv]))
        want = int(plan[key]['unlockHeroLevel'])
        if int(row[i_unlock]) != want:
            diff[key] = (int(row[i_unlock]), want, str(plan[key].get('skillName')))

    if not diff:
        print('[skip] army 与计划行解锁等级已一致')
        return
    print('[diff] %d 行需要改（按 skilllevel 分布：%s）' % (
        len(diff),
        {lv: sum(1 for k in diff if k[1] == lv) for lv in sorted({k[1] for k in diff})}))

    # ---- xlsx 定位 + 前置闸 ----
    _, rows = read_sheet(XLSX, SHEET_INDEX)
    locate = {}
    for row_no, cells in rows:
        if row_no < FIRST_DATA_ROW or not cells:
            continue
        cid = str(cells[COL_ID - 1] if len(cells) >= COL_ID else '').replace('\r', '').strip()
        lvl = str(cells[COL_LEVEL - 1] if len(cells) >= COL_LEVEL else '').replace('\r', '').strip()
        if cid and lvl:
            locate[(cid, int(float(lvl)))] = (row_no, cells)

    missing = [k for k in diff if k not in locate]
    if missing:
        raise SystemExit('[fail] 这 %d 行在 K 表里找不到：%s' % (len(missing), missing[:8]))

    conflict = []
    for key, (old, want, name) in diff.items():
        row_no, cells = locate[key]
        sheet_name = str(cells[COL_NAME - 1]).replace('\r', '').strip()
        sheet_unlock = str(cells[COL_UNLOCK - 1]).replace('\r', '').strip()
        if sheet_name != name:
            conflict.append('%s 技能名不符：表「%s」/ 计划「%s」' % (key, sheet_name, name))
        elif sheet_unlock and int(float(sheet_unlock)) != old:
            conflict.append('%s 表里 D 列现值 %s ≠ army %s（可能已手改）' % (key, sheet_unlock, old))
    if conflict:
        for line in conflict[:10]:
            print('  ' + line)
        raise SystemExit('[fail] 前置闸未过，未写盘')

    # ---- 写 xlsx ----
    with zipfile.ZipFile(XLSX) as z:
        xml = z.read(MEMBER).decode('utf-8')
        members = [(item, z.read(item.filename)) for item in z.infolist()]

    for key, (old, want, name) in sorted(diff.items(), key=lambda kv: locate[kv[0]][0]):
        ref = '%s%d' % (col_letter(COL_UNLOCK), locate[key][0])
        xml = set_cell_number(xml, ref, want)
        print('[patch] %s %s#L%d %s  %d → %d' % (ref, key[0], key[1], name, old, want))

    os.makedirs(XLSX_BACKUP, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    bx = os.path.join(XLSX_BACKUP, 'K-卡牌升级.%s.xlsx' % stamp)
    shutil.copyfile(XLSX, bx)
    print('[backup] ' + bx)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as out:
        for item, payload in members:
            out.writestr(item, xml.encode('utf-8') if item.filename == MEMBER else payload)
    try:
        with open(XLSX, 'wb') as fh:
            fh.write(buffer.getvalue())
    except PermissionError:
        raise SystemExit('[fail] 文件被占用（WPS/Excel 打开着？）关掉再跑；本次未写盘')

    # ---- 写两份 json ----
    os.makedirs(JSON_BACKUP, exist_ok=True)
    shutil.copyfile(ARMY_REMOTE, os.path.join(JSON_BACKUP, 'armySkillLevelUp.unlock.%s.json' % stamp))
    shutil.copyfile(ARMY_CLIENT, os.path.join(JSON_BACKUP, 'client_armySkillLevelUp.unlock.%s.json' % stamp))

    for row in army_v:
        key = (str(row[i_id]), int(row[i_lv]))
        if key in diff:
            row[i_unlock] = diff[key][1]
    io.open(ARMY_REMOTE, 'w', encoding='utf-8', newline='').write(army_render(army_v))

    changed = 0
    for row in c_rows:
        key = (str(row['id']), int(row['skilllevel']))
        if key in diff:
            row['unlockarmylevel'] = diff[key][1]
            changed += 1
    io.open(ARMY_CLIENT, 'w', encoding='utf-8', newline='').write(c_render(c_rows))
    if changed != len(diff):
        raise SystemExit('[fail] client 只命中 %d / %d 行' % (changed, len(diff)))

    # ---- 回读三写比对 ----
    _, after = read_sheet(XLSX, SHEET_INDEX)
    checked = 0
    for row_no, cells in after:
        if row_no < FIRST_DATA_ROW or not cells:
            continue
        cid = str(cells[COL_ID - 1]).replace('\r', '').strip()
        lvl = str(cells[COL_LEVEL - 1]).replace('\r', '').strip()
        if not cid or not lvl:
            continue
        key = (cid, int(float(lvl)))
        if key in diff:
            got = str(cells[COL_UNLOCK - 1]).replace('\r', '').strip()
            if int(float(got)) != diff[key][1]:
                raise SystemExit('[fail] 回读不一致 %s：表里 %s' % (key, got))
            checked += 1

    v2, k2, _, _ = load_columnar(ARMY_REMOTE)
    c2, _, _ = load_row_array(ARMY_CLIENT)
    bad = [key for key in diff
           if int([r for r in v2 if (str(r[k2.index('id')]), int(r[k2.index('skilllevel')])) == key][0][k2.index('unlockarmylevel')]) != diff[key][1]]
    bad_c = [key for key in diff
             if int([r for r in c2 if (str(r['id']), int(r['skilllevel'])) == key][0]['unlockarmylevel']) != diff[key][1]]
    if bad or bad_c:
        raise SystemExit('[fail] json 回读不一致 remote=%s client=%s' % (bad[:5], bad_c[:5]))

    print('[ok] %d 行解锁等级已三写对齐（xlsx 回读 %d 行 / remote+client 回读一致）' % (len(diff), checked))


if __name__ == '__main__':
    main()
