# -*- coding: utf-8 -*-
"""第 17 批：四条技能链的卡牌技能升级行（K 表 + armySkillLevelUp 两份产物）。

为什么是「补」而不是「新建」
────────────
`armySkillLevelUp.json` 里这四条链其实已经有 3 行占位（早先批量建的），但 **name / desc /
modfiy 全空、unlockarmylevel 是默认的 12/24/36** —— 卡牌 UI 真读的就是这张表
（项目口径「desc 两份都改」），空着等于玩家点开技能只看到一行「I 级」。
所以本脚本把 B（技能名）/ C（描述）/ D（解锁等级）/ L（修改器号）/ M（档位图标）一起补齐。

四条链
──────
  101704 穿甲爆矢（毒箭蘑菇 68017） 94017041~43 · 累计普攻 8 次 · 无冷却
  101803 毒液喷吐（诅咒菇 68018）   94018031~33 · 冷却 12 秒  · **要写冷却列**
  101904 生命爆发（窝瓜人 68019）   94019041~43 · 累计普攻 10 次 · 无冷却
  102203 闪电链（雷蕉 68022）       94022031~33 · 冷却 12 秒  · **要写冷却列**
  102704 战神附体（爆锤莲王 68027） 94027041~43 · 累计普攻 10 次 · 无冷却
  103103 舞王召唤（艺术家 68031）   94031031~33 · 冷却 12 秒  · **要写冷却列**
  101404 一人成军（分裂菇 68014）   94014041~43 · 累计普攻 8 次 · 无冷却
  102204 嗜血术（雷蕉 68022）       94022041~43 · 冷却 8 秒   · **要写冷却列**
  102304 大吼大叫（南瓜战神 68023） 94023041~43 · 冷却 8 秒   · **要写冷却列**

🔴 「冷却时间」列（K）只给真的有冷却的技能写：整张表里主动技能都写 29
   （102503 / 101603 / 103504 / 101303 一致，与具体几秒无关），但 `counter_self_buff` /
   累计普攻型陷阱根本没有冷却这一说 —— 给它们写 29 会让人以为「每 29 秒一次」。
🔴 数值一律从 `pvpSkillPlan` 取，不在这里抄第二份：两份 pvpSkillPlan 不一致就直接报错，
   而不是挑一份信。

幂等：整格重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_batch17_k.py
"""
import html
import io
import json
import os
import re
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import cell_xml, read_zip_rows  # noqa: E402
from patch_splash_shot_k import render  # noqa: E402
from patch_burst_k import value_of, write_cell  # noqa: E402  同一套 zip 级整格替换

ROOT = 'D:/Alan/Project/POW'
XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'K-卡牌升级.xlsx')
MEMBER = 'xl/worksheets/sheet2.xml'          # 卡牌技能升级表
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')

#  链号 → (三档修改器号, 要不要写冷却列)。
CHAINS = {
    101704: ((94017041, 94017042, 94017043), False),
    101803: ((94018031, 94018032, 94018033), True),
    101904: ((94019041, 94019042, 94019043), False),
    102104: ((94021041, 94021042, 94021043), True),
    102203: ((94022031, 94022032, 94022033), True),
    102704: ((94027041, 94027042, 94027043), False),
    103103: ((94031031, 94031032, 94031033), True),
    101404: ((94014041, 94014042, 94014043), False),
    102204: ((94022041, 94022042, 94022043), True),
    102304: ((94023041, 94023042, 94023043), True),
    102004: ((94020041, 94020042, 94020043), True),
    103503: ((94035031, 94035032, 94035033), False),
}
ICONS = ('I', 'II', 'III')
ACTIVE_COOLDOWN_CELL = 29


def load_plan():
    """modifierId → (技能名, 描述, 解锁兵种等级)。两份 pvpSkillPlan 必须逐字一致。"""
    want = {mid for ids, _ in CHAINS.values() for mid in ids}
    out = {}
    for folder, packed in ((REMOTE, True), (CLIENT, False)):
        path = os.path.join(folder, 'pvpSkillPlan.json')
        with io.open(path, encoding='utf-8') as handle:
            data = json.load(handle)
        if packed:
            keys = data['k']
            rows = [dict(zip(keys, row)) for row in data['v']]
        else:
            rows = data
        for row in rows:
            if int(row['modifierId']) in want:
                got = (row['skillName'], row['desc'], int(row['unlockHeroLevel']))
                if int(row['modifierId']) in out and out[int(row['modifierId'])] != got:
                    raise SystemExit('[fail] %s 两份 pvpSkillPlan 不一致：%r vs %r'
                                     % (row['modifierId'], out[int(row['modifierId'])], got))
                out.setdefault(int(row['modifierId']), got)
    missing = want - set(out)
    if missing:
        raise SystemExit('[fail] pvpSkillPlan 里找不到这些修改器：%s' % sorted(missing))
    return out


def patch_level_up(plan, folder, packed):
    path = os.path.join(folder, 'armySkillLevelUp.json')
    with io.open(path, encoding='utf-8') as handle:
        data = json.load(handle)
    if packed:
        keys = data['k']
        rows = data['v']
        index = {name: position for position, name in enumerate(keys)}

        def field(row, name):
            return row[index[name]]

        def setter(row, name, value):
            row[index[name]] = value
    else:
        rows = data

        def field(row, name):
            return row.get(name)

        def setter(row, name, value):
            row[name] = value

    changed = 0
    for chain, (modifier_ids, _) in CHAINS.items():
        chain_rows = sorted(
            (row for row in rows if int(field(row, 'id')) == chain),
            key=lambda row: int(field(row, 'skilllevel')),
        )
        if len(chain_rows) != 3:
            raise SystemExit('[fail] %s 在 %s 里有 %d 档（预期 3）' % (chain, path, len(chain_rows)))
        for tier, row in enumerate(chain_rows):
            name, desc, unlock = plan[modifier_ids[tier]]
            wanted = (('name', name), ('desc', desc), ('modfiy', [modifier_ids[tier]]),
                      ('unlockarmylevel', unlock))
            for column, value in wanted:
                if field(row, column) != value:
                    setter(row, column, value)
                    changed += 1
    if changed:
        with io.open(path, 'w', encoding='utf-8', newline='') as handle:
            if packed:
                handle.write('{\r\n"k":%s,\r\n"v":%s,\r\n"c":%s\r\n}'
                             % (render(keys), render(rows), render(data['c'])))
            else:
                json.dump(rows, handle, ensure_ascii=False, separators=(',', ':'))
    print('[ok] %s：改 %d 格'
          % (os.path.basename(os.path.dirname(path)) + '/armySkillLevelUp.json', changed))


def rows_of_chain(xml, chain):
    """链号 → {档位: 行号}。A 列链号、E 列档位。"""
    out = {}
    for row in range(3, 1400):
        got = value_of(xml, 'A%d' % row)
        if not got or not got.strip().isdigit() or int(got) != chain:
            continue
        level = value_of(xml, 'E%d' % row)
        if level and level.strip().isdigit():
            out[int(level)] = row
    return out


def patch_xlsx(plan):
    xml = read_zip_rows(XLSX, MEMBER)
    targets = {chain: rows_of_chain(xml, chain) for chain in CHAINS}
    missing = [(chain, tier + 1) for chain in CHAINS for tier in range(3)
               if (tier + 1) not in targets[chain]]
    if missing:
        raise SystemExit('[fail] K 表找不到这些行：%s' % missing)

    changed = 0
    for chain, (modifier_ids, wants_cooldown) in CHAINS.items():
        for tier, modifier_id in enumerate(modifier_ids):
            row = targets[chain][tier + 1]
            name, desc, unlock = plan[modifier_id]
            wanted = {
                'B%d' % row: name,       # 技能名称
                'C%d' % row: desc,       # 技能描述（卡牌 UI 真读这一列）
                'D%d' % row: unlock,     # 解锁所需兵种等级
                'L%d' % row: modifier_id,  # 修改器（转表产出 `armySkillLevelUp.modfiy`）
                'M%d' % row: ICONS[tier],  # 技能图标 I / II / III
            }
            if wants_cooldown:
                wanted['K%d' % row] = ACTIVE_COOLDOWN_CELL
            for ref, value in sorted(wanted.items()):
                current = value_of(xml, ref)
                if current is not None and current == str(value):
                    continue
                xml = write_cell(xml, ref, value)
                changed += 1

    if not changed:
        print('[skip] K 表 B/C/D/L/M 已是目标值')
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-batch17'))
    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == MEMBER:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, XLSX)
    print('[ok] K 表改 %d 格' % changed)


def verify(plan):
    xml = read_zip_rows(XLSX, MEMBER)
    bad = []
    for chain, (modifier_ids, wants_cooldown) in CHAINS.items():
        targets = rows_of_chain(xml, chain)
        for tier, modifier_id in enumerate(modifier_ids):
            row = targets.get(tier + 1)
            if row is None:
                bad.append((chain, tier + 1, 'row missing'))
                continue
            name, desc, unlock = plan[modifier_id]
            got = (value_of(xml, 'B%d' % row), value_of(xml, 'C%d' % row),
                   value_of(xml, 'D%d' % row), value_of(xml, 'L%d' % row),
                   value_of(xml, 'M%d' % row))
            if got != (name, desc, str(unlock), str(modifier_id), ICONS[tier]):
                bad.append((chain, tier + 1, got))
            if wants_cooldown and value_of(xml, 'K%d' % row) != str(ACTIVE_COOLDOWN_CELL):
                bad.append((chain, tier + 1, 'K'))
    if bad:
        raise SystemExit('[fail] K 表回读不一致：%s' % bad)
    print('[ok] K 表回读通过：%d 行 × B/C/D/L/M' % (len(CHAINS) * 3))


def main():
    plan = load_plan()
    patch_level_up(plan, REMOTE, packed=True)
    patch_level_up(plan, CLIENT, packed=False)
    patch_xlsx(plan)
    verify(plan)


main()
