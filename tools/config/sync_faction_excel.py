# -*- coding: utf-8 -*-
"""把花果（68006~68010）与僵尸（68028~68035）这轮技能改动回填到 `doc/塔防数据配置`。

沿用 `sync_treant_excel` 的 zip 级手术（只改目标 sheet 的 xml，其余条目原样复制），
不做 openpyxl 另存 —— `J-技能表.xlsx` 的「修改器」页 dimension 是 `A1:XFD3234`，
一存就是几百 MB。

涉及五张表：

  1. `PVP-技能.xlsx` / 技能配置（sheet1，pvpSkill）：追加 17 条主动技能行
     （30841~30845 花果、30846~30857 僵尸），并把 13 张卡的普攻行整行对齐到运行时
     （强化次数 / 强化技能ID / 副技能ID / 触发方式 / 冷却 / 命中状态）。
  2. `PVP-卡牌.xlsx` / 卡牌配置（sheet1，pvpCard）：`unitSkillId`（AI 列）与显示名（B 列）。
  3. `PVP-修改器适配.xlsx` / 状态映射（sheet5，pvpStatus）：追加 17 条状态，
     其中眩晕各档必须带 `control = stun`。
  4. `J-技能表.xlsx` / PVP技能配置（sheet16，pvpSkillPlan）：追加 219 行（73 技能链 × 3 档）。
  5. `K-卡牌升级.xlsx` / 卡牌技能升级表（sheet2，armySkillLevelUp）：按 (id, skilllevel)
     改「技能名称 / 技能描述 / 解锁所需兵种等级」，不动消耗与图标列。

同时把 `json/client` 与 `json/sever` 的四个表按同一口径对齐（转表产物），
否则 `tests/zcds-model.test.ts` 的「remoteRef 与转表产物逐格一致」守卫会红。

用法：
  python tools/config/sync_faction_excel.py [--dry]
"""

import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    COLS_PLAN, COLS_SKILL, COLS_STATUS, ROOT, cell_xml, col_letter, find_row_by,
    last_data_row, read_zip_rows, row_of, set_cell, styles_of_row, upsert, write_zip,
)

REPO = 'D:/Alan/Project/POW/Demo3.8'
REMOTE = os.path.join(REPO, 'assets/remoteRef')
CLIENT = os.path.join(ROOT, 'json', 'client')
SEVER = os.path.join(ROOT, 'json', 'sever')
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

COLS_SKILL_FULL = COLS_SKILL + ['secondarySkillId']

UNITS = ['68006', '68007', '68008', '68009', '68010',
         '68028', '68029', '68030', '68031', '68032', '68033', '68034', '68035']

# 13 张卡的普攻行（整行对齐到运行时）
ATTACK_ROWS = [30703, 30712, 30717, 30718, 30719,
               30702, 30704, 30705, 30706, 30708, 30709, 30710, 30713]

# 本轮新增的主动技能行
NEW_SKILLS = [30841, 30842, 30843, 30844, 30845,
              30846, 30847, 30848, 30849, 30850, 30851, 30852, 30853,
              30854, 30855, 30856, 30857]

# 本轮新增 / 修正的状态
NEW_STATUS = ['slow_spore_l1', 'slow_spore_l2', 'slow_spore_l3', 'slow_blade_l3',
              'stun_1_5', 'stun_2s', 'vuln_10', 'vuln_20',
              'slow_mucus_l1', 'slow_mucus_l2', 'slow_mucus_l3',
              'slow_wave_l2', 'slow_wave_l3',
              'stun_1', 'stun_2_5', 'stun_3', 'stun_4']


# ---------------------------------------------------------------- 读 JSON

def _col_index(letters):
    value = 0
    for char in letters:
        value = value * 26 + (ord(char) - 64)
    return value


def ensure_cell(xml, ref, value):
    """写一个单元格；表里有**稀疏行**（空单元格不带 `<c>`），缺的时候按列序插进去。"""
    import re
    match = re.match(r'([A-Z]+)(\d+)$', ref)
    col, row_num = match.group(1), int(match.group(2))
    row_match = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row_num, xml, re.S)
    if not row_match:
        raise SystemExit('第 %d 行不存在' % row_num)
    if re.search(r'<c r="%s%d"[^>]*?(?:/>|>.*?</c>)' % (col, row_num), xml, re.S):
        return set_cell(xml, ref, value)

    target = _col_index(col)
    style = None
    insert_at = row_match.end(1)
    for cell in re.finditer(r'<c r="([A-Z]+)%d"[^>]*?(?:/>|>.*?</c>)' % row_num,
                            row_match.group(1), re.S):
        found = re.search(r's="(\d+)"', cell.group(0))
        if found:
            style = found.group(1)
        if _col_index(cell.group(1)) > target:
            insert_at = row_match.start(1) + cell.start()
            break
    return xml[:insert_at] + cell_xml(ref, style, value) + xml[insert_at:]


def read_rows(base, name):
    with io.open(os.path.join(base, name + '.json'), encoding='utf-8') as handle:
        raw = json.load(handle)
    if isinstance(raw, list):
        return [dict(row) for row in raw]
    return [dict(zip(raw['k'], values)) for values in raw['v']]


def write_rows(base, name, rows, keys=None):
    path = os.path.join(base, name + '.json')
    with io.open(path, encoding='utf-8') as handle:
        raw = json.load(handle)
    if isinstance(raw, list):
        payload = rows
    else:
        payload = {'k': raw['k'], 'v': [[row.get(key) for key in raw['k']] for row in rows], 'c': 1}
    with io.open(path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
    return path


# ---------------------------------------------------------------- 1. pvpSkill

def sync_pvp_skill(backup_dir):
    path = os.path.join(ROOT, 'PVP-技能.xlsx')
    member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(path, member)
    remote = {row['skillId']: row for row in read_rows(REMOTE, 'pvpSkill')}

    ids = ATTACK_ROWS + NEW_SKILLS
    values = [[remote[skill_id].get(key) for key in COLS_SKILL_FULL] for skill_id in ids]
    xml, added, rewritten = upsert(xml, 'A', lambda row: row[0], values)
    backup = write_zip(path, member, xml, backup_dir)
    print('[ok] PVP-技能.xlsx：对齐 %d 行（普攻 %d + 新主动 %d），追加 %d / 重写 %d'
          % (len(ids), len(ATTACK_ROWS), len(NEW_SKILLS), added, rewritten))
    return backup


# ---------------------------------------------------------------- 2. pvpCard

def sync_pvp_card(backup_dir):
    path = os.path.join(ROOT, 'PVP-卡牌.xlsx')
    member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(path, member)
    remote = {str(row['id']): row for row in read_rows(REMOTE, 'pvpCard')}

    changed = []
    for card_id, row in remote.items():
        line = find_row_by(xml, 'A', card_id)
        if line is None:
            continue
        xml = ensure_cell(xml, 'B%d' % line, row.get('name'))
        xml = ensure_cell(xml, 'AI%d' % line, row.get('unitSkillId'))
        changed.append(card_id)
    backup = write_zip(path, member, xml, backup_dir)
    print('[ok] PVP-卡牌.xlsx：刷新 %d 张卡的 显示名 / 普攻技能ID' % len(changed))
    return backup


# ---------------------------------------------------------------- 3. pvpStatus

def sync_pvp_status(backup_dir):
    path = os.path.join(ROOT, 'PVP-修改器适配.xlsx')
    member = 'xl/worksheets/sheet5.xml'
    xml = read_zip_rows(path, member)
    remote = {row['statusId']: row for row in read_rows(REMOTE, 'pvpStatus')}

    values = [[remote[sid].get(key) for key in COLS_STATUS] for sid in NEW_STATUS]
    xml, added, rewritten = upsert(xml, 'B', lambda row: row[1], values)
    backup = write_zip(path, member, xml, backup_dir)
    print('[ok] PVP-修改器适配.xlsx / 状态映射：追加 %d 行 / 重写 %d 行' % (added, rewritten))
    return backup


# ---------------------------------------------------------------- 4. pvpSkillPlan

def sync_pvp_skill_plan(backup_dir):
    path = os.path.join(ROOT, 'J-技能表.xlsx')
    member = 'xl/worksheets/sheet16.xml'
    xml = read_zip_rows(path, member)
    plans = [row for row in read_rows(REMOTE, 'pvpSkillPlan') if str(row.get('unitId')) in UNITS]
    plans.sort(key=lambda row: (row['unitId'], row['skillChainId'], row['skillLevel']))

    values = [[plan.get(key) for key in COLS_PLAN] for plan in plans]
    xml, added, rewritten = upsert(xml, 'B', lambda row: row[1], values)
    backup = write_zip(path, member, xml, backup_dir)
    print('[ok] J-技能表.xlsx / PVP技能配置：追加 %d 行 / 重写 %d 行（13 卡共 %d 行）'
          % (added, rewritten, len(values)))
    return backup


# ---------------------------------------------------------------- 5. armySkillLevelUp

def sync_army_skill(backup_dir):
    """K-卡牌升级：改 名称 / 描述 / 解锁等级 / 技能类型 四列，(id, skilllevel) 定位。"""
    path = os.path.join(ROOT, 'K-卡牌升级.xlsx')
    member = 'xl/worksheets/sheet2.xml'
    xml = read_zip_rows(path, member)
    rows = read_rows(REMOTE, 'armySkillLevelUp')

    #  sheet 里 E 列是技能等级；先按 A 列建 id → 行号候选
    wanted = {str(item) for item in _skill_ids()}
    touched = 0
    for row in rows:
        skill_id = str(row.get('id'))
        if skill_id not in wanted:
            continue
        for line in _rows_of_id(xml, 'A', skill_id):
            level = _cell_text(xml, 'E%d' % line)
            if level is None or int(float(level)) != int(row['skilllevel']):
                continue
            xml = ensure_cell(xml, 'B%d' % line, row.get('name'))
            xml = ensure_cell(xml, 'C%d' % line, row.get('desc'))
            xml = ensure_cell(xml, 'D%d' % line, row.get('unlockarmylevel'))
            #  J 列 = armySkillType（1 数值被动 / 2 行为被动）。只影响卡牌页展示，
            #  但空着会被 `parseArmySkillLevelRow` 兜成 1，行为被动的新技能就会显示错。
            if row.get('armySkillType') is not None:
                xml = ensure_cell(xml, 'J%d' % line, row.get('armySkillType'))
            touched += 1
    backup = write_zip(path, member, xml, backup_dir)
    print('[ok] K-卡牌升级.xlsx / 卡牌技能升级表：刷新 %d 行文案、解锁等级与技能类型' % touched)
    return backup


_SKILL_IDS_CACHE = set()


def _skill_ids():
    """主链号 = 技能 id；子链是 `sid + 90000*k`，所以 ≥ 190000 的都不是主链。"""
    if not _SKILL_IDS_CACHE:
        for row in read_rows(REMOTE, 'pvpSkillPlan'):
            if str(row.get('unitId')) not in UNITS:
                continue
            chain = int(row['skillChainId'])
            if chain < 190000:
                _SKILL_IDS_CACHE.add(chain)
        _SKILL_IDS_CACHE.update(NEW_SKILLS)
    return _SKILL_IDS_CACHE


def _rows_of_id(xml, col, value):
    import re
    hits = []
    for m in re.finditer(r'<c r="%s(\d+)"[^>]*>(.*?)</c>' % col, xml, re.S):
        texts = re.findall(r'<t[^>]*>(.*?)</t>', m.group(2), re.S)
        texts += re.findall(r'<v>(.*?)</v>', m.group(2), re.S)
        if any(text == str(value) for text in texts):
            hits.append(int(m.group(1)))
    return hits


def _cell_text(xml, ref):
    import re
    m = re.search(r'<c r="%s"[^>]*>(.*?)</c>' % ref, xml, re.S)
    if not m:
        return None
    texts = re.findall(r'<v>(.*?)</v>', m.group(1), re.S) or re.findall(r'<t[^>]*>(.*?)</t>', m.group(1), re.S)
    return texts[0] if texts else None


# ---------------------------------------------------------------- 6. 转表产物 json

def sync_client_json():
    """让 `json/client`（以及 `json/sever`）与 remoteRef 对齐 —— 守卫用例读的是这两份。"""
    for name, key in (('pvpSkill', 'skillId'), ('pvpCard', 'id')):
        remote = read_rows(REMOTE, name)
        for base in (CLIENT, SEVER):
            #  sever 只有服务端要用的那几张表（pvpCard / pvpSkillPlan），缺的就跳过
            if not os.path.isfile(os.path.join(base, name + '.json')):
                continue
            write_rows(base, name, remote)
    #  状态与计划只补本轮的增量，其它行保持策划表原样
    for name, key in (('pvpStatus', 'statusId'), ('pvpSkillPlan', 'modifierId')):
        remote = {str(row[key]): row for row in read_rows(REMOTE, name)}
        for base in (CLIENT, SEVER):
            if not os.path.isfile(os.path.join(base, name + '.json')):
                continue
            local = read_rows(base, name)
            #  转表产物是「稀疏对象行」：值为空的键整个不出现。所以字段集要取并集，
            #  只看第一行会把 behaviorKey / skillParamJson / control 整份丢掉。
            fields = set().union(*[set(row) for row in local]) if local else None
            index = {str(row[key]): i for i, row in enumerate(local)}
            changed = 0
            for k, row in remote.items():
                if not _belongs(name, row):
                    continue
                payload = {f: row.get(f) for f in fields} if fields else dict(row)
                if k in index:
                    local[index[k]] = payload
                else:
                    local.append(payload)
                changed += 1
            if changed:
                write_rows(base, name, local)
                print('    %s/%s：%d 行对齐' % (os.path.basename(base), name, changed))
    _sync_army_json()
    print('[ok] json/client（及 json/sever）已对齐 pvpSkill / pvpCard / pvpStatus / pvpSkillPlan / armySkillLevelUp')


def _sync_army_json():
    """armySkillLevelUp 只同步「文案 + 解锁等级 + 技能类型」，其余（消耗 / modfiy / 图标）保持原样。"""
    wanted = {str(item) for item in _skill_ids()}
    remote = {(str(row['id']), int(row['skilllevel'])): row
              for row in read_rows(REMOTE, 'armySkillLevelUp') if str(row['id']) in wanted}
    for base in (CLIENT, SEVER):
        path = os.path.join(base, 'armySkillLevelUp.json')
        if not os.path.isfile(path):
            continue
        local = read_rows(base, 'armySkillLevelUp')
        changed = 0
        for row in local:
            key = (str(row.get('id')), int(row.get('skilllevel') or 0))
            source = remote.get(key)
            if not source:
                continue
            for field in ('name', 'desc', 'unlockarmylevel', 'armySkillType'):
                if row.get(field) != source.get(field):
                    row[field] = source.get(field)
                    changed += 1
        write_rows(base, 'armySkillLevelUp', local)
        print('    %s/armySkillLevelUp：%d 处文案对齐' % (os.path.basename(base), changed))


def _belongs(name, row):
    if name == 'pvpStatus':
        return row['statusId'] in NEW_STATUS
    plans = read_rows(REMOTE, 'pvpSkillPlan')
    return str(row.get('unitId')) in UNITS


if __name__ == '__main__':
    dry = '--dry' in sys.argv
    if dry:
        for name in ('pvpSkill', 'pvpCard', 'pvpStatus', 'pvpSkillPlan', 'armySkillLevelUp'):
            print('  %s: %d 行' % (name, len(read_rows(REMOTE, name))))
        print('（dry：只清点，不写盘）')
        sys.exit(0)
    backups = [
        sync_pvp_skill(BACKUP),
        sync_pvp_card(BACKUP),
        sync_pvp_status(BACKUP),
        sync_pvp_skill_plan(BACKUP),
        sync_army_skill(BACKUP),
    ]
    sync_client_json()
    print('备份：')
    for item in backups:
        print('  ', item, os.path.getsize(item))
