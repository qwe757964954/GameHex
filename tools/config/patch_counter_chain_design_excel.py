# -*- coding: utf-8 -*-
"""把 `PVP-克制羁绊.xlsx / 克制` 的职业 4 条改成设计案的克制链。

设计案（`技能设计案2.xlsx / 技能设计案 (2)` 102001 机制列）：

    克制谱系（花果→蘑菇→盆栽→僵尸→花果；法师→坦克→射手→战士→法师）   ← A→B 读作「A 克 B」

职业环从坦克起写 = **坦克→射手→战士→法师→坦克**。与原表的差异只有 3 条：

    坦克→战士  ⇒ 坦克→射手
    战士→射手  ⇒ 战士→法师
    射手→法师  ⇒ 射手→战士
    法师→坦克  ⇒ 不变

阵营 4 条本来就与设计案一致，一个字节都不动。

为什么用 zip 级手术
──────────────────
`PVP-克制羁绊.xlsx` 只有 14 行、两张页签，openpyxl 另存虽然不会炸，但会把整个 workbook 的
共享字符串表重排（词条顺序变了，其余表的 `t="s"` 索引就全靠重算）—— 没有收益，只会让 diff 变脏。
这里只重写 `xl/worksheets/sheet1.xml` 里 3 个 `<v>`（共享字符串索引）：
坦克 14 / 战士 15 / 射手 16 / 法师 17 都已在 `sharedStrings.xml` 里，**不碰共享表**。

守卫
────
· B 列标签必须还是那 4 个（坦克 / 战士 / 射手 / 法师），否则说明行序变了；
· 改完逐格回读：B/C 的解码文本 + D 列倍率都要等于期望；
· 备份到 `doc/塔防数据配置_历史备份/`。

用法：python tools/config/patch_counter_chain_design_excel.py [--check]
"""
import os
import re
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows  # noqa: E402

ROOT = 'D:/Alan/Project/POW'
XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'PVP-克制羁绊.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'          # 「克制」页
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')

#  设计案职业环：坦克→射手→战士→法师→坦克（A→B = A 克 B）
ROLE_CHAIN = ['坦克', '射手', '战士', '法师']
#  「维度 + 攻击方标签」→ 该行的克制目标。攻击方在 B 列，克制目标在 C 列。
WANTED = {ROLE_CHAIN[i]: ROLE_CHAIN[(i + 1) % len(ROLE_CHAIN)] for i in range(len(ROLE_CHAIN))}
EXPECTED_MULTIPLIER = '1.3'

CELL_RE = re.compile(r'<c r="([A-Z]+)(\d+)"[^>]*?(?:/>|>.*?</c>)', re.S)
SI_RE = re.compile(r'<si>(.*?)</si>', re.S)
T_RE = re.compile(r'<t[^>]*>(.*?)</t>', re.S)


def shared_strings(z):
    text = z.read('xl/sharedStrings.xml').decode('utf-8')
    return [''.join(T_RE.findall(si)) for si in SI_RE.findall(text)]


def cell_xml_of(xml, ref):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, xml, re.S)
    return match.group(0) if match else None


def shared_index(xml, ref):
    """返回 `t="s"` 单元格的共享字符串索引；不是共享字符串就返回 None。"""
    fragment = cell_xml_of(xml, ref)
    if fragment is None or 't="s"' not in fragment:
        return None
    match = re.search(r'<v>(\d+)</v>', fragment)
    return int(match.group(1)) if match else None


def replace_shared_index(xml, ref, index):
    """只换 `<v>` 里的索引，保留 `s=`（样式）与 `t="s"`。"""
    pattern = re.compile(r'(<c r="%s"[^>]*t="s"[^>]*>)<v>\d+</v>(</c>)' % ref, re.S)
    if not pattern.search(xml):
        raise SystemExit('[fail] 单元格 %s 不是共享字符串格，无法只换索引' % ref)
    return pattern.sub(lambda m: '%s<v>%d</v>%s' % (m.group(1), index, m.group(2)), xml, count=1)


def locate_rows(xml, strings):
    """按 B 列文本找行号：{'坦克': 7, ...}。"""
    rows = {}
    for match in CELL_RE.finditer(xml):
        if match.group(1) != 'B':
            continue
        row = int(match.group(2))
        index = shared_index(xml, 'B%d' % row)
        if index is None:
            continue
        label = strings[index]
        if label in WANTED:
            rows[label] = row
    return rows


def main():
    check_only = '--check' in sys.argv
    with zipfile.ZipFile(XLSX) as z:
        strings = shared_strings(z)
        xml = z.read(MEMBER).decode('utf-8')

    index_of = {name: strings.index(name) for name in WANTED} if all(name in strings for name in WANTED) else {}
    if not index_of:
        raise SystemExit('[fail] 共享字符串表里缺职业标签：%s' % [n for n in WANTED if n not in strings])

    rows = locate_rows(xml, strings)
    missing = [name for name in WANTED if name not in rows]
    if missing:
        raise SystemExit('[fail] 克制页找不到这些攻击方标签：%s' % missing)

    changed = []
    for attacker, defender in WANTED.items():
        row = rows[attacker]
        current = shared_index(xml, 'C%d' % row)
        if current is None:
            raise SystemExit('[fail] C%d 不是共享字符串格' % row)
        if strings[current] == defender:
            continue
        changed.append((attacker, strings[current], defender, row))
        xml = replace_shared_index(xml, 'C%d' % row, index_of[defender])

    if not changed:
        print('[skip] 克制页职业 4 条已是设计案链条')
    elif check_only:
        print('[check] 需要改 %d 格：%s' % (len(changed), changed))
        return
    else:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        shutil.copy2(XLSX, os.path.join(BACKUP_DIR, 'PVP-克制羁绊.xlsx.bak-counter-chain'))
        tmp = XLSX + '.tmp'
        with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
            for info in src.infolist():
                data = src.read(info.filename)
                if info.filename == MEMBER:
                    data = xml.encode('utf-8')
                dst.writestr(info, data)
        os.replace(tmp, XLSX)
        for attacker, before, after, row in changed:
            print('  C%d：%s 的克制目标 %s → %s' % (row, attacker, before, after))

    # ── 回读 ────────────────────────────────────────────────────────────────
    with zipfile.ZipFile(XLSX) as z:
        strings = shared_strings(z)
        xml = z.read(MEMBER).decode('utf-8')
    bad = []
    for attacker, defender in WANTED.items():
        row = rows[attacker]
        got = strings[shared_index(xml, 'C%d' % row)]
        multiplier = re.search(r'<v>(.*?)</v>', cell_xml_of(xml, 'D%d' % row) or '')
        if got != defender or not multiplier or multiplier.group(1) != EXPECTED_MULTIPLIER:
            bad.append((attacker, got, multiplier.group(1) if multiplier else None))
    if bad:
        raise SystemExit('[fail] 回读不一致：%s' % bad)
    print('[ok] 回读通过：职业 4 条为 ' + '、'.join('%s→%s' % (a, d) for a, d in WANTED.items()))


if __name__ == '__main__':
    main()
