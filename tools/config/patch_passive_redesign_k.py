# -*- coding: utf-8 -*-
"""被动重设计 V5 第一批：回填 `K-卡牌升级.xlsx / 卡牌技能升级表` 的 B（技能名）/ C（技能描述）。

口径与 `tools/config/patch_passive_redesign_batch1.js` 完全一致 —— 直接读 client 版
`armySkillLevelUp.json`（那份已经按设计案 L1~L3 写好了 name / desc），不在这里另抄一份文案。

为什么用 zip 级手术：这张页签里有大量公式单元格（N/O 列），openpyxl 保存只写公式不写缓存值，
转表器（POI）读缓存值 ⇒ 整表会导成空。所以只替换 B/C 两个 `<c>` 元素，其余条目逐字节复制。

用法：python tools/config/patch_passive_redesign_k.py
"""
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
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'armySkillLevelUp.json')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')

CHAINS = (
    100101, 100201, 100301, 100302, 100402, 100403,
    101901, 101902, 102003, 102103, 102801, 102802,
    102901, 102902, 103001, 103002,
    # 第二批：溅射 / 裂变爆炸 / 共生信号
    100802, 101501, 100902, 103202, 101002, 102602, 103402, 101601,
    100602, 102301, 103101,
    # 第三批：裂变暴击（暴击率 11/13/15 + 命中溅射 + 混搭尾）
    102502, 103301,
    # 第四批：克制条 20 条（异种猎杀 / 职业猎杀 / 抗性装甲 / 职业抗性协议）
    100103, 100203, 100303, 100401, 100503,
    101103, 101203, 101302, 101402, 101903,
    102001, 102002, 102101, 102102, 102202,
    102302, 102803, 102904, 103003, 103102,
    # 第五批：多弹 9 条（孢群弹幕 / 孢子弹幕 / 苔针双连 / 连发苔针）
    101001, 101301, 101701, 102201, 102402,
    102601, 103201, 103401, 103502,
)

#  `--all`：不按批次链表走，改成「`pvpCard.skillList` 引用到的全部技能链」。
#  用于解锁等级统一（2026-11-17）这类跨全表的改动 —— 那种改动会碰到每一张卡的四个技能格，
#  逐个批次列链会漏。
if '--all' in sys.argv:
    CARD_CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'pvpCard.json')
    with io.open(CARD_CLIENT, encoding='utf-8') as _handle:
        _cards = json.load(_handle)
    CHAINS = tuple(sorted({
        int(chain)
        for _card in _cards
        if str(_card.get('id', '')).startswith('68')
        for chain in (_card.get('skillList') or [])
    }))
    print('[all] 覆盖 %d 条技能链（取自 pvpCard.skillList）' % len(CHAINS))

CELL_RE = re.compile(r'<c r="([A-Z]+)(\d+)"[^>]*?(?:/>|>.*?</c>)', re.S)


def cell_text(fragment):
    texts = re.findall(r'<t[^>]*>(.*?)</t>', fragment, re.S)
    texts += re.findall(r'<v>(.*?)</v>', fragment, re.S)
    return texts[0] if texts else ''


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


def load_expected():
    with io.open(CLIENT, encoding='utf-8') as handle:
        rows = json.load(handle)
    out = {}
    for row in rows:
        if int(row['id']) in CHAINS:
            #  D 列 = 解锁所需兵种等级。V5 有卡改成「兵种 0 级，开局即解锁」，
            #  不连 D 一起写就会留下 xlsx=1 / json=0 的分歧（导表一跑就被 xlsx 扳回去）。
            out[(int(row['id']), int(row['skilllevel']))] = (
                row.get('name') or '', row.get('desc') or '', int(row.get('unlockarmylevel') or 0),
            )
    #  `--all` 模式下允许缺行：设计案里有些技能还没落表（`pvpSkillPlan` 无行），
    #  对应的 `armySkillLevelUp` 自然也就没有 —— 那不叫数据坏，只是没做。
    if '--all' not in sys.argv:
        missing = [key for chain in CHAINS for key in ((chain, 1), (chain, 2), (chain, 3)) if key not in out]
        if missing:
            raise SystemExit('[fail] client armySkillLevelUp 缺行：%s' % missing)
    return out


def main():
    expected = load_expected()
    xml = read_zip_rows(XLSX, MEMBER)

    #  A 列 id / E 列档位 → 行号
    level_cells = {}
    for match in CELL_RE.finditer(xml):
        if match.group(1) != 'E':
            continue
        row = int(match.group(2))
        level_cells.setdefault(row, cell_text(match.group(1) or match.group(0)))

    targets = {}
    for row in sorted(level_cells):
        chain_text = value_of(xml, 'A%d' % row)
        try:
            chain = int(str(chain_text).strip())
        except (TypeError, ValueError):
            continue
        level_text = value_of(xml, 'E%d' % row)
        try:
            level = int(str(level_text).strip())
        except (TypeError, ValueError):
            continue
        if (chain, level) in expected:
            targets[(chain, level)] = row

    missing = [key for key in expected if key not in targets]
    if missing:
        raise SystemExit('[fail] K 表找不到这些行：%s' % missing)

    changed = 0
    for (chain, level), (name, desc, unlock) in sorted(expected.items()):
        row = targets[(chain, level)]
        if value_of(xml, 'B%d' % row) != name:
            xml = write_cell(xml, 'B%d' % row, name)
            changed += 1
        if value_of(xml, 'C%d' % row) != desc:
            xml = write_cell(xml, 'C%d' % row, desc)
            changed += 1
        if value_of(xml, 'D%d' % row) != str(unlock):
            xml = write_cell(xml, 'D%d' % row, unlock)
            changed += 1

    if not changed:
        print('[skip] K 表 B/C/D 已是目标值（%d 行）' % len(expected))
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-passive-batch1'))
    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == MEMBER:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, XLSX)
    print('[ok] K 表 %d 行，改 %d 格' % (len(expected), changed))


def verify():
    xml = read_zip_rows(XLSX, MEMBER)
    expected = load_expected()
    bad = []
    for (chain, level), (name, desc, unlock) in expected.items():
        for row in range(1, 2000):
            if value_of(xml, 'A%d' % row) != str(chain):
                continue
            if value_of(xml, 'E%d' % row) != str(level):
                continue
            if (value_of(xml, 'B%d' % row) != name or value_of(xml, 'C%d' % row) != desc
                    or value_of(xml, 'D%d' % row) != str(unlock)):
                bad.append((chain, level))
            break
    if bad:
        raise SystemExit('[fail] 回读不一致：%s' % bad)
    print('[ok] 回读通过：%d 行 B/C/D 与 armySkillLevelUp 一致' % len(expected))


if __name__ == '__main__':
    main()
    verify()
