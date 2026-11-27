# -*- coding: utf-8 -*-
"""音效配置同步（用户 2026-11-23 / 2026-11-24）：Y-音频.xlsx 源表 + client JSON + remoteRef 列存 + refSmallAll。

## 为什么要改

战斗 / 领地 / 抽奖三条链路新增了 17 条音效（四职业普攻与技能、固定格奖励大小、随机格奖励、
金卡碎片展示、爆炸技能、战斗翻地块抽空 / 蓝绿 / 紫 / 金），代码里已经按
`resources://塔防/音效/<名>` 全路径在播，但**音效配置源表 `Y-音频.xlsx` 里一行都没有** ——
策划在表里看不到、改不了，`audioConfig` 的键查表（`AudioMgr.getClipPath` 的非路径键分支）也取不到。

## 三写口径（与仓库既有约定一致）

1. 源表：`D:/Alan/Project/POW/doc/塔防数据配置/Y-音频.xlsx` 的 `数据配置` 页（zip 级 `set_cell/upsert`，
   走 inlineStr，不碰 sharedStrings —— openpyxl 另存会把整表按 16384 列重写）；
2. client JSON：`doc/塔防数据配置/json/client/audioConfig.json`（转表产物，逐行一个对象）；
3. 列存：工程内 `assets/remoteRef/audioConfig.json`（与 client JSON 同内容，LF、无尾换行）；
4. 小表合并：`assets/remoteRef/refSmallAll.json` 的 `audioConfig.{k,v}` —— `audioConfig` 在
   `small.txt` 里，运行时 `RefUtil` 读的是这份合并表，不改就是「表里有、游戏里没有」。

守卫：第 5 行必须是 key/value/m4a；表尾必须仍是「一声狮吼」；每行回读逐字一致；
已存在的 key 不重复追加（幂等）。
用法：python tools/config/patch_audio_config.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from patch_dawtianlu_aura_punch_excel import sheet_member  # noqa: E402
from sync_treant_excel import last_data_row, read_zip_rows, upsert, write_zip  # noqa: E402
from xlsx_read import read_sheet  # noqa: E402

DOC_ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
XLSX = os.path.join(DOC_ROOT, 'Y-音频.xlsx')
CLIENT_JSON = os.path.join(DOC_ROOT, 'json', 'client', 'audioConfig.json')
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
REMOTE_JSON = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', 'audioConfig.json')
REF_SMALL = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', 'refSmallAll.json')

SHEET_NAME = '数据配置'
SHEET_MEMBER = 'xl/worksheets/sheet1.xml'
AUDIO_ROOT = 'resources://塔防/音效'

#  顺序即表里的追加顺序：四职业（法师 / 战士 / 射手 / 坦克）→ 领地与宝箱 → 战斗通用。
NEW_KEYS = [
    '法师普攻',
    '法师技能',
    '战士普攻',
    '战士技能',
    '射手普攻',
    '射手技能',
    '坦克普攻',
    '坦克技能',
    '固定格奖励小',
    '固定格奖励大',
    '随机格奖励',
    '金卡碎片展示',
    '爆炸技能',
    #  战斗内翻地块的抽卡结果音（用户 2026-11-24，第二批次）：
    #  抽空 / 蓝绿 / 紫 / 金。与上面领地那三颗**不是一套刻度** ——
    #  领地按奖励数量分大小，这里按抽到的卡牌品阶分档。
    '战斗中抽空',
    '战斗中抽蓝绿',
    '战斗中抽紫',
    '战斗中抽金',
    #  养成通用反馈（用户 2026-11-26）：卡牌升级界面 / 巡逻宝箱升级 / 装备升级与强化 / 宝石镶嵌。
    #  成功一条被四处共用，失败只有巡逻宝箱用得上（其余玩法失败仍是 toast）。
    '升级成功通用音效',
    '升级失败通用音效',
]


def sheet_rows():
    return read_sheet(XLSX, 0)[1]


def existing_keys():
    keys = []
    for index, cells in sheet_rows():
        if index < 6:
            continue
        key = str(cells[0]).strip() if cells else ''
        if key:
            keys.append(key)
    return keys


def guard_header():
    rows = sheet_rows()
    header = rows[4][1] if len(rows) > 4 else []
    if [str(v).strip() for v in header[:3]] != ['key', 'value', 'm4a']:
        raise SystemExit('[fail] 第 5 行不是 key/value/m4a：%r —— 列序变动，先人工核对' % (header,))


def patch_xlsx(pending):
    member = sheet_member(XLSX, SHEET_NAME)
    xml = read_zip_rows(XLSX, member)
    if last_data_row(xml) != max(index for index, _ in sheet_rows()):
        raise SystemExit('[fail] sheet xml 与 read_sheet 的行数对不上，先人工核对')
    values = [[key, '%s/%s' % (AUDIO_ROOT, key)] for key in pending]
    xml, added, rewritten = upsert(xml, 'A', lambda row: row[0], values)
    if rewritten:
        raise SystemExit('[fail] 预期只追加，却重写了 %d 行 —— 先人工核对' % rewritten)
    backup = write_zip(XLSX, member, xml, BACKUP_DIR)
    return added, backup


def verify_xlsx(pending):
    by_key = {}
    for index, cells in sheet_rows():
        key = str(cells[0]).strip() if cells else ''
        if key:
            by_key[key] = cells
    bad = []
    for key in pending:
        cells = by_key.get(key)
        expected = '%s/%s' % (AUDIO_ROOT, key)
        if cells is None:
            bad.append('%s 缺失' % key)
        elif str(cells[1] if len(cells) > 1 else '').strip() != expected:
            bad.append('%s 的值是 %r，预期 %r' % (key, cells[1], expected))
    if bad:
        raise SystemExit('[fail] 回读不一致：' + '；'.join(bad))


def patch_flat_json(path, pending):
    with open(path, encoding='utf-8', newline='') as fh:
        text = fh.read()
    rows = json.loads(text)
    have = {str(row.get('key')) for row in rows if isinstance(row, dict)}
    added = 0
    for key in pending:
        if key in have:
            continue
        rows.append({'key': key, 'value': '%s/%s' % (AUDIO_ROOT, key)})
        added += 1
    payload = ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('[' + payload + ']')
    return added


def patch_ref_small(pending):
    with open(REF_SMALL, encoding='utf-8', newline='') as fh:
        data = json.load(fh)
    table = data.get('audioConfig')
    if not isinstance(table, dict) or not isinstance(table.get('v'), list):
        raise SystemExit('[fail] refSmallAll.audioConfig 结构异常，先人工核对')
    columns = list(table['k'])
    if columns[:2] != ['key', 'value']:
        raise SystemExit('[fail] refSmallAll.audioConfig.k 是 %r，预期以 key/value 开头' % (columns,))
    have = {str(row[0]) for row in table['v'] if row}
    added = 0
    for key in pending:
        if key in have:
            continue
        row = [None] * len(columns)
        row[columns.index('key')] = key
        row[columns.index('value')] = '%s/%s' % (AUDIO_ROOT, key)
        table['v'].append(row)
        added += 1
    out = json.dumps(data, separators=(',', ':'), indent=0, ensure_ascii=False)
    with open(REF_SMALL, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(out)
    return added


def main():
    guard_header()
    have = set(existing_keys())
    if '一声狮吼' not in have:
        raise SystemExit('[fail] 表尾不是「一声狮吼」—— 表被改过，先人工核对再追加')
    pending = [key for key in NEW_KEYS if key not in have]
    json_only = '--json-only' in sys.argv[1:]
    if not pending:
        print('[skip] %d 条音效都已在表里，无需改动' % len(NEW_KEYS))
        return

    backup = '(跳过：源表被 WPS 占用，见 --json-only)'
    added = 0
    if not json_only:
        added, backup = patch_xlsx(pending)
        verify_xlsx(pending)
    client_added = patch_flat_json(CLIENT_JSON, pending)
    remote_added = patch_flat_json(REMOTE_JSON, pending)
    small_added = patch_ref_small(pending)
    print('[ok] Y-音频.xlsx 追加 %d 行（备份 %s）' % (added, backup))
    print('[ok] client json +%d / remoteRef json +%d / refSmallAll +%d' % (client_added, remote_added, small_added))
    print('[keys] ' + '、'.join(pending))


if __name__ == '__main__':
    main()
