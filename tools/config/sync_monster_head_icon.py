# -*- coding: utf-8 -*-
"""把源表 `PVP-怪物卡牌.xlsx` 的「头像」（`headIcon`）规范化 + 同步到两份产物。

2026-11-23 用户：「美术换了新头像，但代码还没切直路径」。
现场是两个问题叠在一起：

  ① **代码只认 `icon.json` 的 key**（`兵种_头像_*` / `图标_头像_*`）。美术按习惯把整列写成了
     直路径 `icons/head/<名>` ⇒ `IconArtResolver.resolve()` 落空 ⇒ `loadIconByKey` 返回 null
     ⇒ **头像整片退占位图，一条错都不报**。
     代码侧已补直路径支持（`HeadArtModel.iconArtTargetOfPath`），两种写法都能用。
  ② 美术写的目录是 **`icons/head`**，那是**玩家头像特写（128×128）**；兵种卡面 / 传说卡横幅的
     立绘要的是 **`icons/cardHead` 的全身图（256×256）**。两张同名图不是同一张：
     `moshushi` 在 head 里裁到胸口、在 cardHead 里是全身。所以打表前必须把前缀换成 cardHead，
     否则「代码切了直路径」的下一步就是卡面变成裁到胸口的头像。

⚠️ 只在 `icons/cardHead/<名>.png` 真实存在时才换目录；缺图的行原样保留并打印告警 ——
   别用「把路径改对」掩盖「图还没进工程」。

用法：
    python tools/config/sync_monster_head_icon.py            # 预演（不写盘）
    python tools/config/sync_monster_head_icon.py --apply     # 真写（xlsx 走 zip 级手术 + 两份 json）
"""

from __future__ import annotations

import html
import io
import json
import os
import re
import sys
import time
import zipfile

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
POW_ROOT = os.path.dirname(PROJECT_ROOT)
DOC = os.path.join(POW_ROOT, 'doc', '塔防数据配置')

XLSX = os.path.join(DOC, 'PVP-怪物卡牌.xlsx')
CLIENT_JSON = os.path.join(DOC, 'json', 'client', 'monsterCard.json')
REMOTE_REF = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', 'monsterCard.json')
CARD_HEAD_DIR = os.path.join(PROJECT_ROOT, 'assets', 'bundles', 'main-pages', 'icons', 'cardHead')

SHEET_MEMBER = 'xl/worksheets/sheet1.xml'
HEADER_ROW = 5
COLUMN = 'headIcon'
COLUMN_LETTER = 'AI'
#  列说明（第 4 行）里写死了「icon.json 的图标名」，规范化后要跟着改成「图标名或直路径」。
DESC_ROW = 4
DESC_TEXT = (
    '图标名或直路径：可填 icon.json 的图标名（兵种卡「兵种_头像_<兵种>」→ icons/cardHead；'
    '近卫卡「图标_头像_<名>」→ icons/head），也可直接填资源路径（icons/cardHead/<名>，'
    '不要带 /spriteFrame）。兵种卡面要用 icons/cardHead 的全身图，别填 icons/head（那是头像特写 128）。'
    '留空 = 该卡暂无头像，界面保留占位图。'
)
#  旧说明里独有的措辞，用来判断这格还是不是老文案。
#  ⚠️ 别拿「icon.json 的图标名」当判据 —— 新说明里也有这半句，脚本会自己命中自己、永远不幂等。
DESC_LEGACY_MARK = '经它解出资源名'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402


def read_xlsx_column() -> tuple[dict[int, object], dict[int, int]]:
    """读出 id → headIcon，顺带记下 id → 工作表行号（写回要用）。"""
    import openpyxl
    workbook = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    try:
        rows = list(workbook.worksheets[0].iter_rows(values_only=True))
    finally:
        #  read_only 模式不 close 会占着文件，下一句写盘就 WinError 5（2026-11-18）。
        workbook.close()
    header = rows[HEADER_ROW - 1]
    index = {name: column for column, name in enumerate(header) if name}
    if COLUMN not in index or 'id' not in index:
        raise SystemExit('表头里没有 %s / id 列（先核对第 %d 行）' % (COLUMN, HEADER_ROW))
    values: dict[int, object] = {}
    positions: dict[int, int] = {}
    for offset, row in enumerate(rows[HEADER_ROW:]):
        card_id = row[index['id']]
        if not isinstance(card_id, int):
            continue                                    # 类型行 / 备注行
        value = row[index[COLUMN]]
        values[card_id] = value.strip() if isinstance(value, str) and value.strip() else None
        positions[card_id] = HEADER_ROW + 1 + offset    # openpyxl 行号 = 表头行 + 1 起
    return values, positions


def normalize(card_id: int, value: object) -> tuple[object, str]:
    """把 `icons/head/<名>` 换成 `icons/cardHead/<名>`（仅当那张图真的在 cardHead 下）。

    返回 `(想要的取值, 说明)`；说明非空 = 需要打印给人看的那种情况。
    """
    if not value or not isinstance(value, str):
        return value, ''
    if not value.startswith('icons/head/'):
        return value, ''
    name = value[len('icons/head/'):].split('/')[0]
    if not name:
        return value, '%s 的 headIcon 是空路径：%r' % (card_id, value)
    if not os.path.exists(os.path.join(CARD_HEAD_DIR, name + '.png')):
        return value, ('%s 想换成 icons/cardHead/%s，但 cardHead 下没有这张图 ⇒ 原样保留'
                       % (card_id, name))
    return 'icons/cardHead/' + name, ''


def as_rows(data):
    """两种形态都吃：列存 `{k,v,c}` 或行对象数组。"""
    if isinstance(data, dict):
        return [dict(zip(data['k'], row)) for row in data['v']], data
    return data, None


def sync_products(source: dict[int, object], apply: bool) -> int:
    total = 0
    for path in (CLIENT_JSON, REMOTE_REF):
        with io.open(path, encoding='utf-8') as handle:
            raw = handle.read()
        data = json.loads(raw)
        rows, column_store = as_rows(data)
        column = column_store['k'].index(COLUMN) if column_store is not None else COLUMN

        touched = 0
        for position, row in enumerate(rows):
            card_id = row['id']
            if card_id not in source:
                continue
            want = source[card_id]
            #  行对象形态里「没配」是不写键（不是写 null），读取一律用 get。
            have = row.get(COLUMN)
            if have == want:
                continue
            if column_store is not None:
                column_store['v'][position][column] = want
            else:
                row[COLUMN] = want
            print('  %s：%s 的 %s ← %r（原 %r）'
                  % (os.path.basename(path), card_id, COLUMN, want, have))
            touched += 1

        if not touched:
            print('  %s：无差异（幂等）' % os.path.basename(path))
            continue
        if not apply:
            total += touched
            continue
        #  行数 / 行宽 / 换行数都不该变 —— 只换一个字符串值，排版动了就是写坏了。
        text = (json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
                if column_store is not None else
                '[' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':'))
                                 for row in rows) + ']')
        if text.count('\n') != raw.count('\n'):
            raise SystemExit('%s 换行数变了，排版被改坏，中止' % os.path.basename(path))
        with io.open(path, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(text)

        check = json.loads(io.open(path, encoding='utf-8').read())
        back, _ = as_rows(check)
        for row in back:
            if row['id'] in source and row.get(COLUMN) != source[row['id']]:
                raise SystemExit('回读不一致：%s 的 %s = %r' % (row['id'], COLUMN, row.get(COLUMN)))
        print('  %s：已写 %d 格' % (os.path.basename(path), touched))
        total += touched
    return total


def shared_string(xml: str, ref: str) -> str:
    """读某格现在的文本：inlineStr 直接取 `<t>`，共享字符串要经 sharedStrings 索引再解转义。"""
    cell = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, xml, re.S)
    if not cell:
        return ''
    body = cell.group(0)
    inline = re.search(r'<is>.*?<t[^>]*>(.*?)</t>', body, re.S)
    if inline:
        return html.unescape(inline.group(1))
    shared = re.search(r'<v>(\d+)</v>', body)
    if not shared or 't="s"' not in body.split('>')[0]:
        return ''
    with zipfile.ZipFile(XLSX) as archive:
        table = archive.read('xl/sharedStrings.xml').decode('utf-8')
    items = re.findall(r'<si>(.*?)</si>', table, re.S)
    index = int(shared.group(1))
    if index >= len(items):
        return ''
    texts = re.findall(r'<t[^>]*>(.*?)</t>', items[index], re.S)
    return html.unescape(''.join(texts))


def write_xlsx(cells: dict[str, object], apply: bool) -> str:
    """xlsx 走 zip 级手术（整表 openpyxl.save 会重写样式 / 合并单元格）。"""
    xml = read_zip_rows(XLSX, SHEET_MEMBER)
    for ref, value in cells.items():
        xml = set_cell(xml, ref, value)
    if not apply:
        return ''
    backup_dir = os.path.join(PROJECT_ROOT, 'tmp', 'backup_head_icon_%s' % time.strftime('%Y%m%d_%H%M%S'))
    backup = write_zip(XLSX, SHEET_MEMBER, xml, backup_dir)
    return backup


def main(argv: list[str]) -> int:
    apply = '--apply' in argv
    values, positions = read_xlsx_column()
    print('源表 %s：%d 行，其中 %d 行配了头像' % (
        COLUMN, len(values), len([v for v in values.values() if v])))

    want: dict[int, object] = {}
    notes: list[str] = []
    for card_id, value in sorted(values.items()):
        target, note = normalize(card_id, value)
        want[card_id] = target
        if note:
            notes.append(note)
    for note in notes:
        print('  ⚠️ ' + note)

    changed = {card_id: (values[card_id], want[card_id])
               for card_id in want if values[card_id] != want[card_id]}
    print('需要规范化目录的行：%d' % len(changed))
    for card_id, (old, new) in sorted(changed.items()):
        print('  %s：%r → %r' % (card_id, old, new))

    #  列说明也跟着改（只在还是旧写法时动，避免每次覆盖别人的措辞）。
    cells: dict[str, object] = {'%s%d' % (COLUMN_LETTER, row): value
                                for row, value in ((positions[card_id], new)
                                                   for card_id, (_, new) in changed.items())}
    with zipfile.ZipFile(XLSX) as archive:
        sheet = archive.read(SHEET_MEMBER).decode('utf-8')
    desc_ref = '%s%d' % (COLUMN_LETTER, DESC_ROW)
    if DESC_LEGACY_MARK in shared_string(sheet, desc_ref):
        cells[desc_ref] = DESC_TEXT
        print('列说明（%s）也会一并改成「图标名或直路径」' % desc_ref)

    backup = write_xlsx(cells, apply)
    if backup:
        print('源表已写 %d 格；备份 %s' % (len(cells), os.path.relpath(backup, PROJECT_ROOT)))

    if apply and cells:
        #  回读一遍源表，确认 zip 级手术真的落到格子里。
        check, _ = read_xlsx_column()
        bad = [(card_id, check.get(card_id)) for card_id, (_, new) in changed.items()
               if check.get(card_id) != new]
        if bad:
            raise SystemExit('源表回读不一致：%s' % bad)
        print('源表回读：%d 行全部一致' % len(changed))

    total = sync_products(want, apply)
    print('%s：源表 %d 格 / 产物 %d 格%s'
          % ('已写盘' if apply else '待写', len(cells), total, '' if apply else '（加 --apply 真写）'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
