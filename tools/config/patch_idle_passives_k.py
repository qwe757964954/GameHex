# -*- coding: utf-8 -*-
"""第 17 批：68011 / 68012 的四条纯数值被动（2026-11-18）。

这四条链的 K 表占位行早就在，但名字与文案都是**更早一版**的设计：
  · 101101「新手法师 / 射程提高10%」→ 废土铁芽 / 攻击提高 10/12/14%
  · 101102「新手魔杖 / 攻击提高10~12%」→ 超视孢子 / 攻击范围提高 14/18/24%
  · 101201「石质投矛 / 攻击提高10~12%」→ 废土铁芽 / 攻击提高 10/12/14%
  · 101202「巨魔身躯 / 最大生命提高10~12%」→ 灵巧投掷 / 攻击速度提高 11/13/15%
所以本脚本是**改写**：
  · `armySkillLevelUp.json` 两份产物：`name` / `desc` / `modfiy`；
  · `K-卡牌升级.xlsx / 卡牌技能升级表`：B（技能名）/ C（技能描述）。

🔴 被动行**不写** K（冷却）与 M（档位图标）：整张表里所有 `passive_stat`（101103 / 101203 …）
   这两列都是空的，只有主动技能才写「29 / I·II·III」。给被动补上会让卡面显示一个
   永远用不到的冷却数字。

为什么 B/C 要抄 pvpSkillPlan 的 desc：卡牌 UI 真读 `armySkillLevelUp.desc`，
只改 JSON 不写 xlsx 的话，转表器一跑（以 Excel 为准）就会把旧文案抄回去。

幂等：整格重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_idle_passives_k.py
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
from patch_splash_shot_k import render  # noqa: E402  同一个 `render`：数组一行一个元素、`\\r\\n`

ROOT = 'D:/Alan/Project/POW'
XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'K-卡牌升级.xlsx')
MEMBER = 'xl/worksheets/sheet2.xml'          # 卡牌技能升级表
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')

#  要改写的三条技能档（链号 → 三档修改器号）。数值一律从 pvpSkillPlan 取，不在这里抄第二份。
CHAINS = {
    101101: (94011011, 94011012, 94011013),
    101102: (94011021, 94011022, 94011023),
    101201: (94012011, 94012012, 94012013),
    101202: (94012021, 94012022, 94012023),
}


def value_of(xml, ref):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    texts = re.findall(r'<t[^>]*>(.*?)</t>', match.group(1) or '', re.S)
    texts += re.findall(r'<v>(.*?)</v>', match.group(1) or '', re.S)
    return html.unescape(texts[0]) if texts else ''


def write_cell(xml, ref, value):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, xml, re.S)
    if not match:
        raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', match.group(0))
    return xml[:match.start()] + cell_xml(ref, style.group(1) if style else None, value) + xml[match.end():]


def load_plan():
    """modifierId → (技能名, 描述)。两份 pvpSkillPlan 必须逐字一致，否则不知道该信哪份。"""
    want = {mid for ids in CHAINS.values() for mid in ids}
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
                got = (row['skillName'], row['desc'])
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
    for chain, modifier_ids in CHAINS.items():
        chain_rows = sorted(
            (row for row in rows if int(field(row, 'id')) == chain),
            key=lambda row: int(field(row, 'skilllevel')),
        )
        if len(chain_rows) != 3:
            raise SystemExit('[fail] %s 在 %s 里有 %d 档（预期 3）' % (chain, path, len(chain_rows)))
        for tier, row in enumerate(chain_rows):
            name, desc = plan[modifier_ids[tier]]
            for column, value in (('name', name), ('desc', desc), ('modfiy', [modifier_ids[tier]])):
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
    print('[ok] %s：改 %d 格' % (os.path.basename(os.path.dirname(path)) + '/armySkillLevelUp.json', changed))


def patch_xlsx(plan):
    xml = read_zip_rows(XLSX, MEMBER)
    targets = {}
    for row in range(3, 1200):
        chain = value_of(xml, 'A%d' % row)
        if not chain or not chain.strip().isdigit():
            continue
        if int(chain) not in CHAINS:
            continue
        level = value_of(xml, 'E%d' % row)
        if not level or not level.strip().isdigit():
            continue
        targets[(int(chain), int(level))] = row
    missing = [(chain, tier + 1) for chain in CHAINS for tier in range(3)
               if (chain, tier + 1) not in targets]
    if missing:
        raise SystemExit('[fail] K 表找不到这些行：%s' % missing)

    changed = 0
    for chain, modifier_ids in CHAINS.items():
        for tier, modifier_id in enumerate(modifier_ids):
            row = targets[(chain, tier + 1)]
            name, desc = plan[modifier_id]
            wanted = {
                'B%d' % row: name,
                'C%d' % row: desc,
            }
            for ref, value in sorted(wanted.items()):
                current = value_of(xml, ref)
                if current is not None and current == str(value):
                    continue
                xml = write_cell(xml, ref, value)
                changed += 1

    if not changed:
        print('[skip] K 表 B/C 已是目标值')
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-idle-passives17'))
    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == MEMBER:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    #  Windows 上先关掉句柄再替换，否则 `os.replace` 报 WinError 5。
    os.replace(tmp, XLSX)
    print('[ok] K 表改 %d 格' % changed)


def verify(plan):
    xml = read_zip_rows(XLSX, MEMBER)
    bad = []
    for chain, modifier_ids in CHAINS.items():
        for tier, modifier_id in enumerate(modifier_ids):
            name, desc = plan[modifier_id]
            for row in range(3, 1200):
                if value_of(xml, 'A%d' % row) != str(chain):
                    continue
                if value_of(xml, 'E%d' % row) != str(tier + 1):
                    continue
                got = (value_of(xml, 'B%d' % row), value_of(xml, 'C%d' % row))
                if got != (name, desc):
                    bad.append((chain, tier + 1, got))
                break
    if bad:
        raise SystemExit('[fail] K 表回读不一致：%s' % bad)
    print('[ok] K 表回读通过：%d 行 × B/C' % (len(CHAINS) * 3))


def main():
    plan = load_plan()
    patch_level_up(plan, REMOTE, packed=True)
    patch_level_up(plan, CLIENT, packed=False)
    patch_xlsx(plan)
    verify(plan)


if __name__ == '__main__':
    main()
