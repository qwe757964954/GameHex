# -*- coding: utf-8 -*-
"""第 45 批续：把设计案主表改过的 34 条技能名同步到配置源表（2026-11-25 16:06 那轮改名）。

用户口径：
    「技能设计案修改了技能名字，同步相关的配置源表」
    + 澄清：「全部 34 条（以设计案主表为准）」「102701 撞名照设计案改」

## 改了哪几类字段

| 表 | 列 | 说明 |
| :--- | :--- | :--- |
| `pvpSkillPlan` | `skillName` | 技能计划名（评审与工具链读） |
| `armySkillLevelUp` | `name` | **卡面 / 技能面板真读的就是这一份** |
| `pvpCard` | `description` | 卡面介绍里列举了本卡技能名 ⇒ 不改就和面板对不上 |
| `pvpSkill` | `name` | 只有 30848 一条（绿尸寒警告 → 篮球火） |
| `J-技能表.xlsx / PVP技能配置` | D 列（技能名称） | 转表真源 |
| `K-卡牌升级.xlsx / 卡牌技能升级表` | B 列（技能名称） | 转表真源 |
| `PVP-卡牌.xlsx / 卡牌配置` | I 列（description） | 转表真源 |
| `PVP-技能.xlsx / 技能配置` | B 列（技能名称） | 转表真源 |

## 🔴 两个「看着该改但故意不改」的地方

1. **`desc` 里的「戈壁狂箭」不动**。设计案 L1 原文是「…每秒随机选取…降下**戈壁狂箭**，每支造成 50% 伤害」
   —— 技能名是「戈壁箭雨」，落下来的箭叫「戈壁狂箭」。描述里那个词是**箭的名字**，
   照字面全套替换会变成「降下戈壁箭雨」，箭就变成了技能本身。
2. **只替换完整旧名**。「破阵投枪 → 破阵术」不许顺手把描述里的「投枪」也换掉：
   「换一枚穿透 3 目标的投枪」说的是**武器形态**，换成「术」就读不通了。

## 撞名

`102701`（爆锤莲王）改成「噬血蔓延」，与 `101702`（吞噬大嘴花）同名 —— 用户明确选「照设计案改」，
本脚本不拦，只在回读阶段把撞名清单打印出来。

幂等：按「旧名 → 新名」逐格比对，已是新名就跳过。
用法：python tools/config/patch_batch45_skill_rename.py
"""
import io
import json
import os
import re
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import xlsx_read  # noqa: E402
from sync_treant_excel import cell_xml, read_zip_rows  # noqa: E402
from patch_splash_shot_k import render  # noqa: E402  列存 JSON 的格式（CRLF、元素独占行）

ROOT = 'D:/Alan/Project/POW'
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')
DESIGN = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'

XLSX_PLAN = os.path.join(ROOT, 'doc', '塔防数据配置', 'J-技能表.xlsx')
XLSX_K = os.path.join(ROOT, 'doc', '塔防数据配置', 'K-卡牌升级.xlsx')
XLSX_CARD = os.path.join(ROOT, 'doc', '塔防数据配置', 'PVP-卡牌.xlsx')
XLSX_SKILL = os.path.join(ROOT, 'doc', '塔防数据配置', 'PVP-技能.xlsx')

#  只有这条 `pvpSkill` 行的名字就是技能名（其余被动 / 普攻行的 name 是「XX普攻」，与技能名无关）。
SKILL_RENAMES = {30848: '篮球火'}

#  本批同步的 34 条链与目标名（2026-11-25 16:06 版设计案主表）。只用于 `verify()` 的三方对账：
#  写入侧靠「旧名 ≠ 设计案名」自动判定，跑完一遍就恒为空，校验必须另有锚点。
TARGET_CHAINS = {
    100103: '异种猎杀', 100203: '装甲协议', 100204: '巨力护盾', 100303: '猎杀协议',
    100401: '猎杀协议', 100501: '飞叶快打', 100503: '异种猎杀', 100701: '破阵术',
    100702: '三连击', 100804: '戈壁箭雨', 100901: '破阵术', 101103: '猎杀协议',
    101203: '异种猎杀', 101302: '猎杀协议', 101401: '飞叶快打', 101402: '异种猎杀',
    101801: '三连击', 101802: '破阵术', 101903: '猎杀协议', 102001: '异种猎杀',
    102002: '猎杀协议', 102101: '异种猎杀', 102102: '猎杀协议', 102202: '猎杀协议',
    102302: '魔法抗性', 102501: '三连击', 102701: '噬血蔓延', 102702: '破阵术',
    102803: '异种猎杀', 102904: '装甲协议', 103003: '猎杀协议', 103004: '篮球火',
    103102: '装甲协议', 103302: '破阵术',
}

#  「旧名 → 新名」，只用于 `pvpCard.description`（卡面简介里点名了本卡技能）。
#  🔴 34 条链只有 11 个不同的旧名；且**只在这里用** —— `desc` 里那个「戈壁狂箭」是箭名，不许换。
PREVIOUS_NAMES = {
    '异种猎杀协议': '异种猎杀',
    '抗性装甲协议': '装甲协议',
    '职业猎杀协议': '猎杀协议',
    '职业抗性协议': '魔法抗性',
    '蔓生连打': '飞叶快打',
    '蔓生三连': '三连击',
    '破阵投枪': '破阵术',
    '亡者护盾': '巨力护盾',
    '戈壁狂箭': '戈壁箭雨',
    '吸养根须': '噬血蔓延',
    '绿尸寒警告': '篮球火',
}


# ────────────────────────────────────────── 差异清单

def load_json(folder, name):
    path = os.path.join(folder, name + '.json')
    with io.open(path, encoding='utf-8') as handle:
        return path, json.load(handle)


def rows_of(data):
    """返回 (可写的行迭代器, keys)。

    🔴 remoteRef 是**列存**：`v` 里每行是数组，字段位置由 `k` 决定。
    首版这里返回了 `dict(zip(k, row))` 的副本 —— 改副本对 `data['v']` 没有任何作用，
    再 `render(rows)` 写回去等于把「数组行」整份换成了「对象行」，转表器与用例全部读不动。
    所以 packed 版必须拿**数组行本身**、按下标读写。
    """
    if isinstance(data, list):
        return data, None
    if 'data' in data:
        return data['data'], None
    return data['v'], data['k']


def get_field(row, keys, name):
    return row[keys.index(name)] if keys else row.get(name)


def set_field(row, keys, name, value):
    if keys:
        row[keys.index(name)] = value
    else:
        row[name] = value


def design_names():
    _, rows = xlsx_read.read_sheet(DESIGN, 0)
    out = {}
    for _, cells in rows:
        if len(cells) < 8:
            continue
        try:
            skill_id = int(float(str(cells[6]).strip()))
        except ValueError:
            continue
        out[skill_id] = str(cells[7]).strip()
    return out


def rename_pairs():
    """chainId → (旧名, 新名)；旧名取配置，新名取设计案，只在两者不同时成立。"""
    wanted = design_names()
    _, data = load_json(REMOTE, 'pvpSkillPlan')
    rows, keys = rows_of(data)
    pairs = {}
    for row in rows:
        chain = int(get_field(row, keys, 'skillChainId'))
        if chain not in wanted:
            continue
        old = str(get_field(row, keys, 'skillName')).strip()
        new = wanted[chain]
        if old and new and old != new:
            pairs[chain] = (old, new)
    return pairs


# ────────────────────────────────────────── JSON 三写

def save(path, data, rows, packed):
    if packed:
        with io.open(path, 'w', encoding='utf-8', newline='') as handle:
            handle.write('{\r\n"k":%s,\r\n"v":%s,\r\n"c":%s\r\n}'
                         % (render(data['k']), render(rows), render(data['c'])))
    else:
        with io.open(path, 'w', encoding='utf-8', newline='') as handle:
            json.dump(rows, handle, ensure_ascii=False, separators=(',', ':'))


def patch_plan(folder, pairs):
    path, data = load_json(folder, 'pvpSkillPlan')
    packed = not isinstance(data, list)
    rows, keys = rows_of(data)
    changed = 0
    for row in rows:
        pair = pairs.get(int(get_field(row, keys, 'skillChainId')))
        if pair and str(get_field(row, keys, 'skillName')).strip() == pair[0]:
            set_field(row, keys, 'skillName', pair[1])
            changed += 1
    if changed:
        save(path, data, rows, packed)
    print('[ok] %s/pvpSkillPlan：改 %d 格' % (os.path.basename(folder), changed))


def patch_level(folder, pairs):
    path, data = load_json(folder, 'armySkillLevelUp')
    packed = not isinstance(data, list)
    rows, keys = rows_of(data)
    changed = 0
    for row in rows:
        pair = pairs.get(int(get_field(row, keys, 'id')))
        if pair and str(get_field(row, keys, 'name')).strip() == pair[0]:
            set_field(row, keys, 'name', pair[1])
            changed += 1
    if changed:
        save(path, data, rows, packed)
    print('[ok] %s/armySkillLevelUp：改 %d 格' % (os.path.basename(folder), changed))


def patch_card(folder, pairs):
    """卡面介绍里列举了技能名 ⇒ 按完整旧名替换（`str.replace` 不会命中片段）。"""
    path, data = load_json(folder, 'pvpCard')
    packed = not isinstance(data, list)
    rows, keys = rows_of(data)
    olds = PREVIOUS_NAMES
    changed = 0
    for row in rows:
        text = str(get_field(row, keys, 'description') or '')
        if not text:
            continue
        updated = text
        for old, new in olds.items():
            updated = updated.replace(old, new)
        if updated != text:
            set_field(row, keys, 'description', updated)
            changed += 1
    if changed:
        save(path, data, rows, packed)
    print('[ok] %s/pvpCard：改 %d 张卡的介绍' % (os.path.basename(folder), changed))


def patch_skill(folder):
    path, data = load_json(folder, 'pvpSkill')
    packed = not isinstance(data, list)
    rows, keys = rows_of(data)
    changed = 0
    for row in rows:
        want = SKILL_RENAMES.get(int(get_field(row, keys, 'skillId')))
        if want and str(get_field(row, keys, 'name')) != want:
            set_field(row, keys, 'name', want)
            changed += 1
    if changed:
        save(path, data, rows, packed)
    print('[ok] %s/pvpSkill：改 %d 格' % (os.path.basename(folder), changed))


# ────────────────────────────────────────── xlsx

def value_of(xml, ref):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    texts = re.findall(r'<t[^>]*>(.*?)</t>', match.group(1) or '', re.S)
    texts += re.findall(r'<v>(.*?)</v>', match.group(1) or '', re.S)
    return texts[0] if texts else ''


def write_cell(xml, ref, value):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, xml, re.S)
    if not match:
        raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', match.group(0))
    return xml[:match.start()] + cell_xml(ref, style.group(1) if style else None, value) + xml[match.end():]


def apply_cells(path, member, wanted, label):
    xml = read_zip_rows(path, member)
    changed = 0
    for ref, value in sorted(wanted.items()):
        if value_of(xml, ref) == str(value):
            continue
        xml = write_cell(xml, ref, value)
        changed += 1
    if not changed:
        print('[skip] %s：已是目标值' % label)
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(path, os.path.join(BACKUP_DIR, os.path.basename(path) + '.bak-batch45rename'))
    tmp = path + '.tmp'
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            blob = src.read(info.filename)
            if info.filename == member:
                blob = xml.encode('utf-8')
            dst.writestr(info, blob)
    os.replace(tmp, path)
    print('[ok] %s：改 %d 格' % (label, changed))


def xlsx_plan_cells(targets):
    """`J-技能表.xlsx / PVP技能配置`：B 列 modifierId → **E 列** skillName。

    🔴 列号别数错：表头是 `enabled(A) / modifierId(B) / unitId(C) / skillChainId(D) / skillName(E)`。
    首版写成 `D` 就把技能名灌进了「成长技能ID」那一列（102 格），整列链号被名字顶掉 ——
    而所有用例只读 `pvpSkillPlan`，**一条都不会红**，只能靠回读 xlsx 发现。

    这一页按 `modifierId` 定位（不是技能链），所以先用 pvpSkillPlan 建
    `modifierId → skillChainId` 的反查表，再按 `TARGET_CHAINS` 取新名。
    """
    _, rows = xlsx_read.read_sheet(XLSX_PLAN, 8)
    chain_of = {}
    _, data = load_json(REMOTE, 'pvpSkillPlan')
    rows_, keys_ = rows_of(data)
    for row in rows_:
        chain_of[int(get_field(row, keys_, 'modifierId'))] = int(get_field(row, keys_, 'skillChainId'))
    out = {}
    for rn, cells in rows:
        if len(cells) < 5:
            continue
        try:
            modifier_id = int(float(str(cells[1]).strip()))
        except ValueError:
            continue
        chain = chain_of.get(modifier_id)
        if chain in targets:
            out['E%d' % rn] = targets[chain]
    return out


def xlsx_k_cells(targets):
    """`K-卡牌升级.xlsx / 卡牌技能升级表`：A 列 id → B 列 name。"""
    _, rows = xlsx_read.read_sheet(XLSX_K, 1)
    out = {}
    for rn, cells in rows:
        if len(cells) < 5:
            continue
        try:
            chain = int(float(str(cells[0]).strip()))
        except ValueError:
            continue
        if chain in targets:
            out['B%d' % rn] = targets[chain]
    return out


def xlsx_card_cells(targets):
    """`PVP-卡牌.xlsx / 卡牌配置`：E 列 unitId → I 列 description。"""
    _, rows = xlsx_read.read_sheet(XLSX_CARD, 0)
    owner_of = {}
    _, data = load_json(REMOTE, 'pvpSkillPlan')
    rows_, keys_ = rows_of(data)
    for row in rows_:
        chain = int(get_field(row, keys_, 'skillChainId'))
        if chain in targets:
            owner_of.setdefault(str(get_field(row, keys_, 'unitId')).strip(), []).append(chain)
    olds = PREVIOUS_NAMES
    out = {}
    for rn, cells in rows:
        if len(cells) < 9:
            continue
        unit_id = str(cells[4]).strip()
        if unit_id not in owner_of:
            continue
        text = str(cells[8])
        updated = text
        for old, new in olds.items():
            updated = updated.replace(old, new)
        if updated != text:
            out['I%d' % rn] = updated
    return out


def xlsx_skill_cells():
    """`PVP-技能.xlsx / 技能配置`：A 列 skillId → B 列 name。"""
    _, rows = xlsx_read.read_sheet(XLSX_SKILL, 0)
    out = {}
    for rn, cells in rows:
        if len(cells) < 2:
            continue
        try:
            skill_id = int(float(str(cells[0]).strip()))
        except ValueError:
            continue
        if skill_id in SKILL_RENAMES:
            out['B%d' % rn] = SKILL_RENAMES[skill_id]
    return out


# ────────────────────────────────────────── 回读

def verify():
    """三方对账：设计案主表 == remoteRef == client（只看本批改过的 34 条链）。

    不复用 `rename_pairs()` —— 它靠「旧名 ≠ 设计案名」判定，跑完一遍就恒为空，
    再校验等于什么都没查。所以目标链清单固化成常量 `TARGET_CHAINS`。
    """
    wanted = design_names()
    for chain, expect in TARGET_CHAINS.items():
        if wanted.get(chain) != expect:
            raise SystemExit('[fail] 设计案主表里 %s 现在叫「%s」，本脚本记录的是「%s」'
                             % (chain, wanted.get(chain), expect))
    for folder in (REMOTE, CLIENT):
        tag = os.path.basename(folder)
        _, data = load_json(folder, 'pvpSkillPlan')
        rows, keys = rows_of(data)
        for row in rows:
            chain = int(get_field(row, keys, 'skillChainId'))
            if chain not in TARGET_CHAINS:
                continue
            got = str(get_field(row, keys, 'skillName')).strip()
            if got != TARGET_CHAINS[chain]:
                raise SystemExit('[fail] %s pvpSkillPlan %s 是「%s」' % (tag, chain, got))
        _, data = load_json(folder, 'armySkillLevelUp')
        rows, keys = rows_of(data)
        for row in rows:
            chain = int(get_field(row, keys, 'id'))
            if chain not in TARGET_CHAINS:
                continue
            got = str(get_field(row, keys, 'name')).strip()
            if got != TARGET_CHAINS[chain]:
                raise SystemExit('[fail] %s armySkillLevelUp %s 是「%s」' % (tag, chain, got))
        _, data = load_json(folder, 'pvpSkill')
        rows, keys = rows_of(data)
        for row in rows:
            want = SKILL_RENAMES.get(int(get_field(row, keys, 'skillId')))
            if want and str(get_field(row, keys, 'name')) != want:
                raise SystemExit('[fail] %s pvpSkill %s 未同步' % (tag, get_field(row, keys, 'skillId')))
    print('[ok] 三方对账通过：%d 条技能链 × (pvpSkillPlan.skillName + armySkillLevelUp.name)' % len(TARGET_CHAINS))

    #  撞名自检：改完之后哪些名字被多条链共用（设计案本来就有，不是本脚本造成的）。
    _, data = load_json(REMOTE, 'armySkillLevelUp')
    seen = {}
    rows_, keys_ = rows_of(data)
    for row in rows_:
        seen.setdefault(str(get_field(row, keys_, 'name')).strip(), set()).add(int(get_field(row, keys_, 'id')))
    dup = {name: sorted(ids) for name, ids in seen.items()
           if len(ids) > 1 and name in set(TARGET_CHAINS.values())}
    if dup:
        print('[warn] 改完仍有同名技能（用户已确认照设计案）：')
        for name, ids in sorted(dup.items()):
            print('   %s <- %s' % (name, ids))


def main():
    pairs = rename_pairs()
    print('待同步 %d 条技能链' % len(pairs))
    for chain, (old, new) in sorted(pairs.items()):
        print('   %-7d %-12s → %s' % (chain, old, new))

    #  🔴 xlsx 一律用 `TARGET_CHAINS` 而不是 `pairs`：pairs 靠「旧名 ≠ 设计案名」判定，
    #  跑完一遍就恒为空 —— 用 pairs 的话第二次跑什么都不写，想补一列都没机会。
    targets = dict(TARGET_CHAINS)
    apply_cells(XLSX_PLAN, 'xl/worksheets/sheet9.xml', xlsx_plan_cells(targets), 'J-技能表.xlsx')
    apply_cells(XLSX_K, 'xl/worksheets/sheet2.xml', xlsx_k_cells(targets), 'K-卡牌升级.xlsx')
    apply_cells(XLSX_CARD, 'xl/worksheets/sheet1.xml', xlsx_card_cells(targets), 'PVP-卡牌.xlsx')
    apply_cells(XLSX_SKILL, 'xl/worksheets/sheet1.xml', xlsx_skill_cells(), 'PVP-技能.xlsx')

    for folder in (REMOTE, CLIENT):
        patch_plan(folder, pairs)
        patch_level(folder, pairs)
        patch_card(folder, pairs)
        patch_skill(folder)

    verify()


if __name__ == '__main__':
    main()
