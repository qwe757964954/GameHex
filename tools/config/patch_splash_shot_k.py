# -*- coding: utf-8 -*-
"""第 12 批：孢爆箭 101303 / 孢子凝珠 101104 的卡牌技能升级行（K 表 + armySkillLevelUp）。

这两条链的 K 表行早就在（旧设计「愈合」/「寒冰箭」），所以本脚本是**改写**而不是追加：
  · `armySkillLevelUp.json` 两份产物：`name` / `desc` / `modfiy`（修改器号指向 pvpSkillPlan 的三档）；
  · `K-卡牌升级.xlsx / 卡牌技能升级表`：B（技能名）/ C（技能描述）/ K（冷却列，主动技能统一 29）/
    M（档位图标 I/II/III）。

为什么 B/C 要抄 pvpSkillPlan 的 desc：卡牌 UI 真读的是 `armySkillLevelUp.desc`
（见项目口径「desc 两份都改」）。只改 JSON 不写 xlsx 的话，转表器一跑（以 Excel 为准）
就会把旧文案「寒冰箭 / 愈合」又抄回去 —— 而这两条技能的机制已经整条换掉了。

为什么用 zip 级手术：这张页签有大量公式单元格（N/O 列），openpyxl 保存只写公式不写缓存值，
转表器读缓存值 ⇒ 整表导成空。沿用 `patch_passive_redesign_k.py` 的做法，只替换目标 `<c>`。

用法：python tools/config/patch_splash_shot_k.py
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

ROOT = 'D:/Alan/Project/POW'
XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'K-卡牌升级.xlsx')
MEMBER = 'xl/worksheets/sheet2.xml'          # 卡牌技能升级表
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')

#  要改写的三条技能档（链号 → 三档修改器号）。数值一律从 pvpSkillPlan 取，不在这里抄第二份。
CHAINS = {
    101303: (94013031, 94013032, 94013033),
    101104: (94011041, 94011042, 94011043),
}
ICONS = ('I', 'II', 'III')
#  主动技能的「冷却时间」列在整张表里都是 29（102503 / 101603 / 103504 一致）。
ACTIVE_COOLDOWN_CELL = 29

CELL_RE = re.compile(r'<c r="([A-Z]+)(\d+)"[^>]*?(?:/>|>.*?</c>)', re.S)


def cell_text(fragment):
    texts = re.findall(r'<t[^>]*>(.*?)</t>', fragment, re.S)
    texts += re.findall(r'<v>(.*?)</v>', fragment, re.S)
    return html.unescape(texts[0]) if texts else ''


def value_of(xml, ref):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    return cell_text(match.group(1) or '')


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
                out.setdefault(int(row['modifierId']), (row['skillName'], row['desc']))
    missing = want - set(out)
    if missing:
        raise SystemExit('[fail] pvpSkillPlan 里找不到这些修改器：%s' % sorted(missing))
    return out


def render(value):
    """与 `tools/config/ref_table_io.js` 的 `render` 逐字同构：数组一行一个元素、`\\r\\n` 换行。
    自己拼字符串是为了「只改 6 格、不整份重排」—— 用 `json.dump` 会把 5800 行压成一行。"""
    if isinstance(value, list):
        if not value:
            return '[]'
        return '[\r\n' + ',\r\n'.join(render(item) for item in value) + '\r\n]'
    if isinstance(value, dict):
        entries = list(value.items())
        if not entries:
            return '{}'
        return '{\r\n' + ',\r\n'.join(
            '%s:%s' % (json.dumps(key, ensure_ascii=False), render(item)) for key, item in entries) + '\r\n}'
    return json.dumps(value, ensure_ascii=False)


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
    #  A 列链号 + E 列档位 → 行号
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
                'K%d' % row: ACTIVE_COOLDOWN_CELL,
                'M%d' % row: ICONS[tier],
            }
            for ref, value in wanted.items():
                current = value_of(xml, ref)
                if current is not None and current == str(value):
                    continue
                xml = write_cell(xml, ref, value)
                changed += 1

    if not changed:
        print('[skip] K 表 B/C/K/M 已是目标值')
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-splash-shot'))
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
                got = (value_of(xml, 'B%d' % row), value_of(xml, 'C%d' % row),
                       value_of(xml, 'K%d' % row), value_of(xml, 'M%d' % row))
                if got != (name, desc, str(ACTIVE_COOLDOWN_CELL), ICONS[tier]):
                    bad.append((chain, tier + 1, got))
                break
    if bad:
        raise SystemExit('[fail] K 表回读不一致：%s' % bad)
    print('[ok] K 表回读通过：%d 行 × B/C/K/M' % (len(CHAINS) * 3))


def main():
    plan = load_plan()
    patch_level_up(plan, REMOTE, packed=True)
    patch_level_up(plan, CLIENT, packed=False)
    patch_xlsx(plan)
    verify(plan)


if __name__ == '__main__':
    main()
