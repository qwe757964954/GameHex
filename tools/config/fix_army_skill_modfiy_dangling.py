# -*- coding: utf-8 -*-
"""清掉 `armySkillLevelUp.modfiy` 里指向不存在修改器的子链引用（三写，2026-11-25）。

## 为什么

`modfiy` 是 `[主链, 子链...]`：`[0]` 恒等于同链同档 `pvpSkillPlan.modifierId`，
`[1..]` 是同一条技能的附属性修改器（攻速 `949` / 移速 `958` 域），**必须在计划表里有行**
才算存在 —— 全仓没有单独的「修改器定义表」，94 域 id 的唯一存在性判据就是
「某条计划行的 `modifierId` 等于它」。

全表 420 行、429 条引用里，有 **6 处悬空**（`101601` 三档 + `102502` 三档，都在子链位）：

    101601 L1/L2/L3  [9401601x, 9491601x]
    102502 L1/L2/L3  [9402502x, 9492502x]

计划表里没有 `94916011~13` / `94925021~23` 任何一行。

## 为什么是删而不是补 6 行

这两条技能**本来就没有附属性修改器要挂**，效果已由计划行的 `mix.*` 参数完整承载：

- `101601`「裂变爆炸」描述「攻击提高24%，攻击范围提高35%」
  = `mix.attack.addRate 0.24` + `mix.attackRange.addRate 0.35`（三档同值）；
- `102502`「裂变暴击」描述「攻击提高35%，伤害提高29%，攻击速度提高35%」
  = `mix.attack.addRate 0.35` + `mix.damageRate.addRate 0.29` + `mix.attackSpeed.addRate 0.35`。

`9491601x` / `9492502x` 是 mix 参数体系之前留下的死引用（`army` 全表没有任何运行期读取，
`CardSkillList` 的 `ZCArmySkillLevelRow` 都不带 `modfiy` 这一列）。补 6 行等于凭空造数值。

## 口径

- **只删下标 > 0 且指向不存在的元素**；`[0]` 悬空就整体放弃（那是主链断了，要人看）；
- 删完 `[0]` 必须还在，且必须等于同链同档 `pvpSkillPlan.modifierId`；
- 三写：K 表 L 列（`inlineStr`，格式 `[94016011]`，与现有格同风格无空格）+ remoteRef + client；
- 幂等：已无悬空就什么都不写。
用法：
    python tools/config/fix_army_skill_modfiy_dangling.py
"""
import io
import json
import os
import shutil
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_read import read_sheet  # noqa: E402
from sync_army_skill_unlock import (  # noqa: E402
    ARMY_CLIENT, ARMY_REMOTE, JSON_BACKUP, PLAN_REMOTE, XLSX, load_columnar, load_row_array,
)
from fix_army_skill_modfiy_scalar import col_letter, set_cell_text  # noqa: E402

XLSX_BACKUP = 'D:/Alan/Project/POW/doc/塔防数据配置/_backup'
MEMBER = 'xl/worksheets/sheet2.xml'
SHEET_INDEX = 1
FIRST_DATA_ROW = 7
COL_ID = 1
COL_LEVEL = 5
COL_MODFIY = 12


def main() -> None:
    plan = json.load(io.open(PLAN_REMOTE, encoding='utf-8'))
    known = set(int(row['modifierId']) for row in plan if row.get('modifierId'))
    plan_by_key = {}
    for row in plan:
        plan_by_key[(str(row['skillChainId']), int(row['skillLevel']))] = int(row['modifierId'])

    army_v, army_k, army_render, army_raw = load_columnar(ARMY_REMOTE)
    if army_render(army_v) != army_raw:
        raise SystemExit('[fail] remoteRef 原样重建不逐字节相同，放弃')
    c_rows, c_render, c_raw = load_row_array(ARMY_CLIENT)
    if c_render(c_rows) != c_raw:
        raise SystemExit('[fail] client 原样重建不逐字节相同，放弃')

    i_mod = army_k.index('modfiy')
    i_id = army_k.index('id')
    i_lv = army_k.index('skilllevel')

    targets = {}
    current_of = {}
    dropped = []
    for row in army_v:
        ids = list(row[i_mod] or [])
        if not ids:
            continue
        current_of[(str(row[i_id]), int(row[i_lv]))] = ids
        keep = []
        for index, value in enumerate(ids):
            if int(value) in known:
                keep.append(int(value))
                continue
            if index == 0:
                raise SystemExit('[fail] %s#L%d 的**主链** %s 在计划表里不存在，人工确认'
                                 % (row[i_id], row[i_lv], value))
            dropped.append((str(row[i_id]), int(row[i_lv]), int(value)))
        if len(keep) == len(ids):
            continue
        key = (str(row[i_id]), int(row[i_lv]))
        if keep[0] != plan_by_key.get(key):
            raise SystemExit('[fail] %s 主链 %s 与计划行 %s 不相等，放弃'
                             % (key, keep[0], plan_by_key.get(key)))
        targets[key] = keep

    if not targets:
        print('[skip] 没有悬空引用，什么都没改')
        return
    print('[diff] %d 行要清理，共 %d 处悬空引用：%s' % (
        len(targets), len(dropped), sorted({d[2] for d in dropped})))
    for key, keep in sorted(targets.items()):
        print('  %s#L%d → %s' % (key[0], key[1], keep))

    # ---- xlsx 定位 ----
    _, rows = read_sheet(XLSX, SHEET_INDEX)
    locate = {}
    for row_no, cells in rows:
        if row_no < FIRST_DATA_ROW or not cells:
            continue
        cid = str(cells[COL_ID - 1] if len(cells) >= COL_ID else '').replace('\r', '').strip()
        lvl = str(cells[COL_LEVEL - 1] if len(cells) >= COL_LEVEL else '').replace('\r', '').strip()
        if cid and lvl:
            locate[(cid, int(float(lvl)))] = (row_no, cells)
    missing = [k for k in targets if k not in locate]
    if missing:
        raise SystemExit('[fail] 这些行在 K 表里找不到：%s' % missing[:8])

    import zipfile
    with zipfile.ZipFile(XLSX) as handle:
        xml = handle.read(MEMBER).decode('utf-8')
        members = [(item, handle.read(item.filename)) for item in handle.infolist()]

    written = 0
    for key, keep in sorted(targets.items(), key=lambda kv: locate[kv[0]][0]):
        row_no, cells = locate[key]
        current = str(cells[COL_MODFIY - 1]).replace('\r', '').strip() if len(cells) >= COL_MODFIY else ''
        want_text = '[%s]' % ','.join(str(v) for v in keep)
        if current == want_text:
            continue
        expect_old = '[%s]' % ','.join(str(v) for v in current_of[key])
        if current != expect_old:
            raise SystemExit('[fail] %s 的 K 表 L 列是「%s」，与 json 现状「%s」不符，人工确认'
                             % (key, current, expect_old))
        xml = set_cell_text(xml, '%s%d' % (col_letter(COL_MODFIY), row_no), want_text)
        print('[patch] %s%d %s#L%d  %s → %s'
              % (col_letter(COL_MODFIY), row_no, key[0], key[1], current, want_text))
        written += 1

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    if written:
        os.makedirs(XLSX_BACKUP, exist_ok=True)
        backup = os.path.join(XLSX_BACKUP, 'K-卡牌升级.modfiy-dangling.%s.xlsx' % stamp)
        shutil.copyfile(XLSX, backup)
        print('[backup] ' + backup)
        write_zip(XLSX, xml, members, MEMBER)

    # ---- 两份 json ----
    os.makedirs(JSON_BACKUP, exist_ok=True)
    shutil.copyfile(ARMY_REMOTE, os.path.join(JSON_BACKUP, 'armySkillLevelUp.modfiy-dangling.%s.json' % stamp))
    shutil.copyfile(ARMY_CLIENT, os.path.join(JSON_BACKUP, 'client_armySkillLevelUp.modfiy-dangling.%s.json' % stamp))

    for row in army_v:
        key = (str(row[i_id]), int(row[i_lv]))
        if key in targets:
            row[i_mod] = targets[key]
    io.open(ARMY_REMOTE, 'w', encoding='utf-8', newline='').write(army_render(army_v))

    hit = 0
    for row in c_rows:
        key = (str(row['id']), int(row['skilllevel']))
        if key in targets:
            row['modfiy'] = targets[key]
            hit += 1
    io.open(ARMY_CLIENT, 'w', encoding='utf-8', newline='').write(c_render(c_rows))
    if hit != len(targets):
        raise SystemExit('[fail] client 只命中 %d / %d 行' % (hit, len(targets)))

    # ---- 回读三方 + 全表复查 ----
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
        if key in targets:
            got = str(cells[COL_MODFIY - 1]).replace('\r', '').strip()
            want_text = '[%s]' % ','.join(str(v) for v in targets[key])
            if got != want_text:
                raise SystemExit('[fail] 回读不一致 %s：%s' % (key, got))
            checked += 1

    v2, k2, _, _ = load_columnar(ARMY_REMOTE)
    c2, _, _ = load_row_array(ARMY_CLIENT)
    for key, keep in targets.items():
        remote = next(r for r in v2 if (str(r[k2.index('id')]), int(r[k2.index('skilllevel')])) == key)
        client = next(r for r in c2 if (str(r['id']), int(r['skilllevel'])) == key)
        if list(remote[k2.index('modfiy')]) != keep or list(client['modfiy']) != keep:
            raise SystemExit('[fail] json 回读不一致 %s' % (key,))
    still = [(str(r[k2.index('id')]), r[k2.index('skilllevel')], int(x))
             for r in v2 for x in (r[k2.index('modfiy')] or []) if int(x) not in known]
    if still:
        raise SystemExit('[fail] 还有悬空引用：%s' % still[:6])

    print('[ok] %d 行已清掉 %d 处悬空引用（xlsx 回读 %d 行；全表复查 0 悬空）'
          % (len(targets), len(dropped), checked))


def write_zip(path, xml, members, member_name):
    import zipfile
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as out:
        for item, payload in members:
            out.writestr(item, xml.encode('utf-8') if item.filename == member_name else payload)
    try:
        with open(path, 'wb') as handle:
            handle.write(buffer.getvalue())
    except PermissionError:
        raise SystemExit('[fail] 文件被占用（WPS/Excel 打开着？）关掉再跑；本次未写盘')


if __name__ == '__main__':
    main()
