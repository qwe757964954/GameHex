# -*- coding: utf-8 -*-
"""把「点开宝箱 / 翻第2块地 / 翻第3块地」这几步改成**弱引导**（`maskType = none`）。

用户口径：
  · 2026-11-17 第 12 条：2-3 的奖励对话结束后，后续两个翻地块
    **不用遮罩、不用气泡提示文案，只保留手指点地块的动画**；
  · 2026-11-17 第 13 条 ③：**2-2「点开宝箱」也改成弱引导** ——
    第一次点宝箱时就不压暗，只留手指 + 光圈（后面开箱演出自己会接管画面）。

三写（源表 + 两份导出 JSON）：
  · `doc/塔防数据配置/X-新手引导.xlsx` / `新手引导步骤`：2-2、3-1、4-1 的「遮罩类型」列 hole → none，
    顺带把列头提示补上 `none 无遮罩`（已补过就跳过）；
  · `assets/remoteRef/guideStep.json`（`{k,v,c}` 列存）；
  · `doc/塔防数据配置/json/client/guideStep.json`（每行一个对象的数组）。

Excel 写盘一律 **zip 级手术**（`sync_treant_excel.set_cell`）：openpyxl 另存会把整表按
16384 列重写，文件体积爆炸（见该文件顶部说明）。字符串格写 `t="inlineStr"`，与既有行一致。

幂等：已经是 `none` 的格子打印 `[skip]` 后原样写回（内容零变化），可反复重跑。
"""

import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, '..', '..'))
DOC = os.path.abspath(os.path.join(PROJECT, '..', 'doc', '塔防数据配置'))
XLSX = os.path.join(DOC, 'X-新手引导.xlsx')
SHEET = 'xl/worksheets/sheet1.xml'
REMOTE = os.path.join(PROJECT, 'assets', 'remoteRef', 'guideStep.json')
CLIENT = os.path.join(DOC, 'json', 'client', 'guideStep.json')
BACKUP = os.path.join(os.environ.get('TEMP', '.'), 'guide_step_backup')

WEAK_STEPS = ('2-2', '3-1', '4-1')
WEAK_MASK = 'none'
HINT_ADD = ' / none 无遮罩（弱引导）'


# ---------------------------------------------------------------- Excel

def shared_strings():
    import zipfile
    with zipfile.ZipFile(XLSX) as z:
        xml = z.read('xl/sharedStrings.xml').decode('utf-8')
    values = []
    for body in re.findall(r'<si>(.*?)</si>', xml, re.S):
        values.append(''.join(re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)))
    return values


def cell_text(xml, ref, strings):
    m = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not m or m.group(1) is None:
        return ''
    inner = m.group(1)
    inline = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
    if inline:
        return inline[0]
    v = re.search(r'<v>(.*?)</v>', inner, re.S)
    if not v:
        return ''
    if 't="s"' in m.group(0):
        return strings[int(v.group(1))]
    return v.group(1)


def patch_excel():
    xml = read_zip_rows(XLSX, SHEET)
    strings = shared_strings()
    # 行号不写死：按 B 列的 stepId 反查（表头/备注插一行就全错位）。
    rows = {}
    for m in re.finditer(r'<c r="B(\d+)"[^>]*>(.*?)</c>', xml, re.S):
        value = cell_text(xml, 'B' + m.group(1), strings)
        if value in WEAK_STEPS:
            rows[value] = int(m.group(1))
    missing = [step for step in WEAK_STEPS if step not in rows]
    if missing:
        raise SystemExit('源表里找不到步骤行：%s' % '、'.join(missing))

    changed = 0
    for step, row in rows.items():
        ref = 'E%d' % row
        if cell_text(xml, ref, strings) == WEAK_MASK:
            print('[skip] %s 已经是 %s' % (ref, WEAK_MASK))
            continue
        xml = set_cell(xml, ref, WEAK_MASK)
        changed += 1
        print('[ok] %s（步骤 %s）遮罩 hole → %s' % (ref, step, WEAK_MASK))

    # 列头那一行写的是可选值口径，补上 none 免得下一个人照着 hole 乱填。
    # ⚠️ 行号**不能写死**：表头前面还有导表标记 / 中文列头 / 类型行，插一行就全错位
    #    （上一版写死 E10，正好落在 2-2 的遮罩格上，把「hole」冲成了提示文案）。
    #    这里按内容找：第一个「列头口径」单元格（含 `全屏黑`）才算提示行。
    hint_ref = None
    for m in re.finditer(r'<c r="(E\d+)"[^>]*>(.*?)</c>', xml, re.S):
        if '全屏黑' in cell_text(xml, m.group(1), strings):
            hint_ref = m.group(1)
            break
    if hint_ref is None:
        print('[warn] 找不到遮罩类型列头（含「全屏黑」的格子），跳过提示更新')
    else:
        hint = cell_text(xml, hint_ref, strings)
        if 'none' not in hint:
            xml = set_cell(xml, hint_ref, hint + HINT_ADD)
            changed += 1
            print('[ok] %s 提示补上 none 说明' % hint_ref)

    if not changed:
        print('[skip] Excel 无需改动')
        return
    backup = write_zip(XLSX, SHEET, xml, BACKUP)
    print('[ok] 已写盘 %s（备份 %s）' % (os.path.basename(XLSX), backup))


# ---------------------------------------------------------------- JSON

def patch_remote():
    raw = io.open(REMOTE, encoding='utf-8', newline='').read()
    data = json.loads(raw)
    # 先确认「原样重新序列化」能字节还原，再动手 —— 否则会把整份文件的排版洗一遍。
    if json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')) != raw:
        raise SystemExit('remoteRef 排版与预期不一致，先人工确认再改')
    keys = data['k']
    index = keys.index('maskType')
    step_at = keys.index('stepId')
    changed = 0
    for row in data['v']:
        if row[step_at] in WEAK_STEPS and row[index] != WEAK_MASK:
            print('[ok] remoteRef %s：%s → %s' % (row[step_at], row[index], WEAK_MASK))
            row[index] = WEAK_MASK
            changed += 1
    if not changed:
        print('[skip] remoteRef 无需改动')
        return
    io.open(REMOTE, 'w', encoding='utf-8', newline='').write(
        json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')))


def patch_client():
    raw = io.open(CLIENT, encoding='utf-8', newline='').read()
    rows = json.loads(raw)
    rebuilt = '[' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows) + ']'
    if rebuilt != raw:
        raise SystemExit('client json 排版与预期不一致，先人工确认再改')
    changed = 0
    for row in rows:
        if row.get('stepId') in WEAK_STEPS and row.get('maskType') != WEAK_MASK:
            print('[ok] client %s：%s → %s' % (row['stepId'], row.get('maskType'), WEAK_MASK))
            row['maskType'] = WEAK_MASK
            changed += 1
    if not changed:
        print('[skip] client json 无需改动')
        return
    io.open(CLIENT, 'w', encoding='utf-8', newline='').write(
        '[' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows) + ']')


if __name__ == '__main__':
    patch_excel()
    patch_remote()
    patch_client()
    print('完成：%s 两步已改为弱引导（maskType = none）' % '、'.join(WEAK_STEPS))
