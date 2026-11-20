# -*- coding: utf-8 -*-
"""把 `pvpSkillPlan` 的指定链号，从 client 产物**同步回源表** `J-技能表.xlsx / PVP技能配置`。

为什么要这一步
──────────────
2026-11-19 那批技能（第 13~26 批）走的是「脚本直改两份 JSON」的路子：`remoteRef/pvpSkillPlan.json`
和 `doc/塔防数据配置/json/client/pvpSkillPlan.json` 都改了，**源表 xlsx 一直没跟上**。
后果不是报错，而是「改好的东西会自己退回去」：

  · 只要有人重跑一次转表（eSon 以 Excel 为准），`103103` 就从 `summon_unit` 退回 `self_cast`、
    `103503` 从 `ray_beam` 退回 `skill_params`、`102001` 的 desc 退回空白；
  · 17:58 那次外部批量还原就是这么把 `remoteRef` 打成旧快照的 —— 本脚本修的就是这个根。

所以口径是 **三写**：源表 xlsx + `assets/remoteRef` 列存 + `doc/.../json/client` 行对象。
本脚本负责把最后一块补上：以 client 为准，把落在源表里的那几行整行对齐。

为什么不整份重排、走 zip 级手术
──────────────────────────────
`J-技能表.xlsx` 有 16 个页签、共享公式、4 份批注、vmlDrawing、`_FilterDatabase` 名称。
openpyxl 存一次，eSon 就读不出这张表（`pvpSkillPlan=0`、`skillAttrModifier=0`、`skillEffect=0`）。
所以沿用 `patch_dawtianlu_plan_zip.py` 的做法：只替换目标 `<c>`，其余字节原样保留。

覆盖范围
────────
只改 (skillChainId, modifierId) 精确命中的行，只覆盖 **client 里存在的列**
（`replacementSkillId` 在 JSON 里没有，保留表里的原值）。其余行一个字节都不碰。

幂等：内容没变就不写盘；写完回读 9 行、29 列逐格比对。
用法：python tools/config/sync_plan_rows_to_j_excel.py [链号 ...] [--append]
      （缺省 = 102001 103103 103503）
      `--append`：client 有、源表**整行都没有**的链，按 client 追加到表尾。
                  早期批次（101404 / 102004 / 102203 / 102204 / 102304）就是只写了 JSON、
                  源表没行 —— 不加这个开关转表一次就被删掉。
"""
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    bump_dimension, cell_xml, read_zip_rows, set_cell, write_zip,
)

PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/J-技能表.xlsx'
MEMBER = 'xl/worksheets/sheet9.xml'          # workbook.xml: PVP技能配置 = rId9
SST_MEMBER = 'xl/sharedStrings.xml'
CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json'
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'

#  列序（与 sheet 第 5 行字段名一一对应，A..AC）
COLS = ['enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
        'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
        'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'statId', 'operation',
        'value', 'statusId', 'statusStatJson', 'durationSeconds', 'maxStacks',
        'replacementSkillId', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion',
        'publishStatus', 'skillParamJson']

#  JSON 里没有的列：不许被本脚本清空
NO_TOUCH = {'replacementSkillId'}

DEFAULT_CHAINS = [102001, 103103, 103503]


def col_letter(index):
    """1 → A, 27 → AA"""
    out = ''
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def load_sst(xml):
    return [re.sub(r'<[^>]+>', '', m) for m in re.findall(r'<si>(.*?)</si>', xml, re.S)]


def cell_element(scope, ref):
    """取完整 `<c>` 元素：`t="s"` 长在属性上，只抓内容会把共享字符串当成数字。"""
    m = re.search(r'<c r="%s"(?:[^>]*?/>|[^>]*?>.*?</c>)' % ref, scope, re.S)
    return m.group(0) if m else None


def cell_text(element, sst):
    if not element:
        return ''
    if '<is>' in element:
        return ''.join(re.findall(r'<t[^>]*>(.*?)</t>', element, re.S))
    value = re.search(r'<v>(.*?)</v>', element, re.S)
    if not value:
        return ''
    text = value.group(1)
    if 't="s"' in element:
        index = int(text)
        return sst[index] if index < len(sst) else ''
    return text


def want_text(value):
    """json 值 → 表里该长什么样。None 一律算空（表里就不该有东西）。"""
    if value is None:
        return ''
    if isinstance(value, bool):
        return '1' if value else '0'
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return ('%d' % value) if value == int(value) else repr(value)
    return str(value)


def cell_value(value):
    """写回用的原生值：数字写成数字（走 `t="n"`），字符串走 inlineStr。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return value
    return str(value)


def load_client():
    with open(CLIENT, encoding='utf-8') as handle:
        rows = json.load(handle)
    if isinstance(rows, dict):
        rows = rows.get('rows') or list(rows.values())[0]
    return rows


def style_of(xml, ref):
    """继承同一列上一行的 `s=` 样式，新行才不会长得跟白板一样。"""
    element = cell_element(xml, ref)
    if not element:
        return None
    match = re.search(r'\bs="(\d+)"', element)
    return match.group(1) if match else None


def parse_args():
    chains, append = [], False
    for arg in sys.argv[1:]:
        if arg == '--append':
            append = True
        elif re.fullmatch(r'\d+', arg):
            chains.append(int(arg))
        else:
            raise SystemExit('[fail] 参数看不懂：%r（只认链号 与 --append）' % arg)
    return (chains or DEFAULT_CHAINS), append


def main():
    chains, append = parse_args()
    client = load_client()
    by_key = {(int(r['skillChainId']), int(r['modifierId'])): r for r in client}

    xml = read_zip_rows(PATH, MEMBER)
    sst = load_sst(read_zip_rows(PATH, SST_MEMBER))

    # ---- 1) 按 (chain, modifier) 定位行
    located = {}
    for m in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        row_num, inner = int(m.group(1)), m.group(2)
        if row_num <= 5:                       # 前 5 行是标题/说明/字段名/类型
            continue
        chain = cell_text(cell_element(inner, 'D%d' % row_num), sst)
        mod = cell_text(cell_element(inner, 'B%d' % row_num), sst)
        if not chain or not mod:
            continue
        try:
            key = (int(float(chain)), int(float(mod)))
        except ValueError:
            continue
        if key[0] not in chains:
            continue
        if key in located:
            raise SystemExit('[fail] 第 %d 行与第 %d 行都是 %s' % (located[key], row_num, key))
        located[key] = row_num

    # ---- 2) client 有、源表整行都没有的（早期批次只写了 JSON，源表从来没补）
    missing = sorted(key for key in by_key if key[0] in chains and key not in located)
    if missing and not append:
        for key in missing:
            row = by_key[key]
            print('  [缺] chain=%-7d mod=%-9d unit=%-6s lv=%s  %s'
                  % (key[0], key[1], row.get('unitId'), row.get('skillLevel'), row.get('skillName')))
        raise SystemExit('[fail] 源表缺 %d 行；确认要补就在命令末尾加 --append' % len(missing))

    if not any(key[0] in chains for key in located) and not missing:
        raise SystemExit('[fail] 源表里找不到这些链：%s' % chains)

    # ---- 3) 逐格比对，只改不一致的
    print('源表命中 %d 行（链 %s）' % (len(located), chains))
    changed = 0
    plan = []
    for key in sorted(located):
        row_num = located[key]
        row = by_key.get(key)
        if row is None:
            raise SystemExit('[fail] client 里没有 %s，不知道该写成什么' % (key,))
        diffs = []
        for index, name in enumerate(COLS, start=1):
            if name in NO_TOUCH or name not in row:
                continue
            ref = '%s%d' % (col_letter(index), row_num)
            current = cell_text(cell_element(xml, ref), sst)
            target = want_text(row[name])
            if current.strip() == target.strip():
                continue
            diffs.append((ref, name, current, target))
        print('  行%-5d %s  %s' % (row_num, key, '一致' if not diffs else '%d 格待改' % len(diffs)))
        for ref, name, current, target in diffs:
            print('      %-5s %-16s %r -> %r' % (ref, name, current[:48], target[:48]))
        plan.append((row_num, key, diffs))
        changed += len(diffs)

    if not changed and not missing:
        print('[skip] 源表这 %d 行已与 client 一致' % len(located))
        verify(xml, sst, located, by_key, quiet=True)
        return

    # ---- 4) 写回（zip 级手术 + 备份）
    for row_num, key, diffs in plan:
        row = by_key[key]
        for ref, name, _current, _target in diffs:
            xml = set_cell(xml, ref, cell_value(row[name]))

    appended = 0
    if missing:
        last_row = max(int(n) for n in re.findall(r'<row r="(\d+)"', xml))
        for offset, key in enumerate(missing, start=1):
            row_num = last_row + offset
            row = by_key[key]
            cells = ''.join(
                cell_xml('%s%d' % (col_letter(index), row_num),
                         style_of(xml, '%s%d' % (col_letter(index), last_row)),
                         cell_value(row[name]) if name in row else None)
                for index, name in enumerate(COLS, start=1))
            xml = xml.replace('</sheetData>',
                              '<row r="%d" spans="1:29">%s</row></sheetData>' % (row_num, cells), 1)
            xml = bump_dimension(xml, row_num)
            located[key] = row_num
            appended += 1
            print('  + 行%-5d chain=%-7d mod=%-9d %s' % (row_num, key[0], key[1], row.get('skillName')))

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    moved = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, 'J-技能表.xlsx.bak-plan-%s' % stamp)
    if os.path.isfile(moved):
        if os.path.isfile(backup):
            os.remove(backup)
        os.replace(moved, backup)
    print('[ok] 写盘完成：改 %d 格 / 补 %d 行，备份 %s'
          % (changed, appended, os.path.basename(backup)))

    # ---- 5) 回读自检
    verify(read_zip_rows(PATH, MEMBER), load_sst(read_zip_rows(PATH, SST_MEMBER)), located, by_key)


def verify(xml, sst, located, by_key, quiet=False):
    bad = []
    for key, row_num in sorted(located.items()):
        row = by_key[key]
        for index, name in enumerate(COLS, start=1):
            if name in NO_TOUCH or name not in row:
                continue
            ref = '%s%d' % (col_letter(index), row_num)
            current = cell_text(cell_element(xml, ref), sst)
            target = want_text(row[name])
            if current.strip() != target.strip():
                bad.append((row_num, name, current[:40], target[:40]))
    if bad:
        for row_num, name, current, target in bad:
            print('  [x] 行%-5d %-16s 表=%r client=%r' % (row_num, name, current, target))
        raise SystemExit('[fail] 回读失败：%d 格仍不一致' % len(bad))
    if not quiet:
        print('[ok] 回读通过：%d 行 × %d 列逐格与 client 一致'
              % (len(located), len([c for c in COLS if c not in NO_TOUCH])))


if __name__ == '__main__':
    main()
