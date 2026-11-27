# -*- coding: utf-8 -*-
"""把 `armySkillLevelUp.modfiy` 的空档按 `pvpSkillPlan.modifierId` 补齐（三写，2026-11-25）。

## 为什么

`armySkillLevelUp.modfiy` = 「这一档挂哪个技能修改器」。全表 420 行里：

- **114 行有值**，且规律是一条都没破：`modfiy[0]` **恒等于**同链同档 `pvpSkillPlan.modifierId`
  （75 行单元素严格相等，39 行是 `[主链, 子链]` 两元素，单元素却不相等的 **0 行**）；
- **306 行为空**，其中 **231 行**的计划行 `modifierId` 就是 94 域（`940xxxxx`），
  说明这些链本该有引用、只是 K 表 L 列没写。

=> 目标值可以直接从计划行推，不需要人填。

## 为什么不一次全推（默认只补「确实需要」的那几条）

231 格分布在 76 条链上，是**大批未接线**而不是个别漏填。默认只补「当前有用例指名要它」
的 6 条链（`DEFAULT_CHAINS`），其余留给用户决定 —— 传 `--all` 才批量推。

## 口径

- 目标 = `[plan.modifierId]`（同链同 `skillLevel`）；计划行的 `modifierId` 不是 94 域就跳过
  （那是 `910xxxxx` 面板域，跟 `modfiy` 不是一回事，例如 `100501` 是 `91005101`）；
- 三写：K 表 L 列（`inlineStr` `[94015041]`，不动 `sharedStrings.xml`）+ `assets/remoteRef` +
  client 同名 json；
- 前置闸：只写「army 为空 / client 为空 / K 表 L 列为空」的格，任一非空就跳过并报告；
- 幂等：已一致不写盘。
用法：
    python tools/config/fill_army_skill_modfiy_from_plan.py            # 只补默认 6 条链
    python tools/config/fill_army_skill_modfiy_from_plan.py --all      # 批量补全部可推的
    python tools/config/fill_army_skill_modfiy_from_plan.py --chains 101603,101604
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

#  当前有用例指名要这几条链的修改器引用（每条 3 档）。
DEFAULT_CHAINS = ('101104', '101204', '101504', '102403', '102503', '102504')


def main() -> None:
    argv = sys.argv[1:]
    all_chains = '--all' in argv
    chains = list(DEFAULT_CHAINS)
    for index, item in enumerate(argv):
        if item == '--chains' and index + 1 < len(argv):
            chains = [c.strip() for c in argv[index + 1].split(',') if c.strip()]

    plan = json.load(io.open(PLAN_REMOTE, encoding='utf-8'))
    plan_by_key = {}
    for row in plan:
        plan_by_key[(str(row['skillChainId']), int(row['skillLevel']))] = row

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
    skipped = []
    for row in army_v:
        key = (str(row[i_id]), int(row[i_lv]))
        if not all_chains and key[0] not in chains:
            continue
        source = plan_by_key.get(key)
        if not source:
            skipped.append('%s#L%d 计划行里没有这一档' % key)
            continue
        modifier = str(source.get('modifierId') or '')
        if not modifier.startswith('94'):
            skipped.append('%s#L%d 计划行 modifierId=%s 不是 94 域' % (key[0], key[1], modifier))
            continue
        if row[i_mod]:
            continue  # 已经有值，不覆盖
        targets[key] = int(modifier)

    if not targets:
        print('[skip] 没有可补的格（目标链都不缺，或计划行推不出来）')
        for line in skipped[:10]:
            print('  ' + line)
        return
    print('[diff] %d 格可补，涉及 %d 条链：%s' % (
        len(targets), len({k[0] for k in targets}), sorted({k[0] for k in targets})))

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
    for key, want in sorted(targets.items(), key=lambda kv: locate[kv[0]][0]):
        row_no, cells = locate[key]
        current = str(cells[COL_MODFIY - 1]).replace('\r', '').strip() if len(cells) >= COL_MODFIY else ''
        want_text = '[%d]' % want
        if current == want_text:
            continue
        if current not in ('', '[]'):
            raise SystemExit('[fail] %s 的 K 表 L 列已是「%s」，与预期空档不符，停下来人工确认'
                             % (key, current))
        xml = set_cell_text(xml, '%s%d' % (col_letter(COL_MODFIY), row_no), want_text)
        print('[patch] %s%d %s#L%d  %s → %s'
              % (col_letter(COL_MODFIY), row_no, key[0], key[1], current or '（空）', want_text))
        written += 1

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    if written:
        os.makedirs(XLSX_BACKUP, exist_ok=True)
        backup = os.path.join(XLSX_BACKUP, 'K-卡牌升级.modfiy-fill.%s.xlsx' % stamp)
        shutil.copyfile(XLSX, backup)
        print('[backup] ' + backup)
        write_zip(XLSX, xml, members, MEMBER)

    # ---- 两份 json ----
    os.makedirs(JSON_BACKUP, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    shutil.copyfile(ARMY_REMOTE, os.path.join(JSON_BACKUP, 'armySkillLevelUp.modfiy-fill.%s.json' % stamp))
    shutil.copyfile(ARMY_CLIENT, os.path.join(JSON_BACKUP, 'client_armySkillLevelUp.modfiy-fill.%s.json' % stamp))

    for row in army_v:
        key = (str(row[i_id]), int(row[i_lv]))
        if key in targets:
            row[i_mod] = [targets[key]]
    io.open(ARMY_REMOTE, 'w', encoding='utf-8', newline='').write(army_render(army_v))

    hit = 0
    for row in c_rows:
        key = (str(row['id']), int(row['skilllevel']))
        if key in targets:
            row['modfiy'] = [targets[key]]
            hit += 1
    io.open(ARMY_CLIENT, 'w', encoding='utf-8', newline='').write(c_render(c_rows))
    if hit != len(targets):
        raise SystemExit('[fail] client 只命中 %d / %d 行' % (hit, len(targets)))

    # ---- 回读三方 ----
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
            if got != '[%d]' % targets[key]:
                raise SystemExit('[fail] 回读不一致 %s：%s' % (key, got))
            checked += 1

    v2, k2, _, _ = load_columnar(ARMY_REMOTE)
    c2, _, _ = load_row_array(ARMY_CLIENT)
    for key, want in targets.items():
        remote = next(r for r in v2 if (str(r[k2.index('id')]), int(r[k2.index('skilllevel')])) == key)
        client = next(r for r in c2 if (str(r['id']), int(r['skilllevel'])) == key)
        if list(remote[k2.index('modfiy')]) != [want] or list(client['modfiy']) != [want]:
            raise SystemExit('[fail] json 回读不一致 %s' % (key,))

    print('[ok] %d 格 modfiy 已三写补齐（xlsx 回读 %d 格）' % (len(targets), checked))
    for line in skipped[:10]:
        print('  [skip] ' + line)


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
