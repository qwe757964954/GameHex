# -*- coding: utf-8 -*-
"""新手引导表改版后的「id 递补 + 三写同步」。

用户 2026-11-17 第 13 条：新对白更简洁，删掉了原 `D03`（翻第1块地那组），
要求把台词组 / 台词 id 的序列重新补满，并同步所有配置。

做的事：
  1. `X-新手引导.xlsx` / `新手引导台词`：组号按行序重排成 **D01…Dn 连续无空洞**，
     台词 id 跟着变成 `组序号×100+句序号`（401 → 301 这种）；
  2. `X-新手引导.xlsx` / `新手引导步骤`：`台词组` 列按同一映射改名；
     ⚠️ 引用了**已删掉**的组（本次是 `2-1` 的 `D03`）⇒ 清空，不再指向别人的台词；
     列头提示里的 `D01~D15` 跟着改成 `D01~Dn`；
  3. 重生成 `assets/remoteRef/guideDialog.json` 与 `json/client/guideDialog.json`（新文案一起进去）；
  4. 同步 `guideStep.json` 两份的 `dialogId`。

为什么不用 openpyxl：会把整表按 16384 列重写（见 `sync_treant_excel.py` 顶部说明）。
这里做 zip 级手术，且**只换共享字符串索引**（组号 `D01`…`D15` 全都在 SST 里，
包括已删掉的 `D03`），所以不新增字符串、不动 `sharedStrings.xml`。

幂等：已经连续 + 两份 JSON 已是最新时，全部打印 `[skip]`。
"""

import html
import io
import json
import os
import re
import shutil
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, '..', '..'))
DOC = os.path.abspath(os.path.join(PROJECT, '..', 'doc', '塔防数据配置'))
XLSX = os.path.join(DOC, 'X-新手引导.xlsx')
STEP_SHEET = 'xl/worksheets/sheet1.xml'
DIALOG_SHEET = 'xl/worksheets/sheet2.xml'
REMOTE_DIR = os.path.join(PROJECT, 'assets', 'remoteRef')
CLIENT_DIR = os.path.join(DOC, 'json', 'client')
BACKUP = os.path.join(os.environ.get('TEMP', '.'), 'guide_step_backup')

DIALOG_KEYS = ['id', 'group', 'order', 'speaker', 'content']

CELL_RE = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', re.S)
STEP_ID_RE = re.compile(r'\d+-\d+')


# ---------------------------------------------------------------- xlsx

class Book:
    def __init__(self, path):
        self.path = path
        # 🔴 用完即关：Windows 下一直握着读句柄会让后面的 os.replace 报
        # PermissionError [WinError 5]（文件被自己占着）。
        with zipfile.ZipFile(path) as archive:
            raw = archive.read('xl/sharedStrings.xml').decode('utf-8')
        self.strings = [html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)))
                        for body in re.findall(r'<si>(.*?)</si>', raw, re.S)]
        self.index = {value: position for position, value in enumerate(self.strings)}
        self.sheets = {}

    def cells(self, member):
        """{(col, row): text}"""
        out = {}
        with zipfile.ZipFile(self.path) as archive:
            xml = archive.read(member).decode('utf-8')
        self.sheets[member] = xml
        for match in CELL_RE.finditer(xml):
            col, row, attrs, inner = match.group(1), int(match.group(2)), match.group(3), match.group(4) or ''
            inline = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
            if inline:
                out[(col, row)] = html.unescape(inline[0])
                continue
            value = re.search(r'<v>(.*?)</v>', inner, re.S)
            if not value:
                out[(col, row)] = ''
                continue
            out[(col, row)] = self.strings[int(value.group(1))] if 't="s"' in attrs else value.group(1)
        return out

    def write(self, member, edits):
        for (col, row), value in edits.items():
            self.sheets[member] = self._rewrite(self.sheets[member], '%s%d' % (col, row), value)

    def _rewrite(self, xml, ref, value):
        pattern = r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref
        match = re.search(pattern, xml, re.S)
        if not match:
            raise SystemExit('单元格 %s 不存在' % ref)
        style = re.search(r's="(\d+)"', match.group(0))
        attr = ' s="%s"' % style.group(1) if style else ''
        if isinstance(value, int):
            new = '<c r="%s"%s><v>%d</v></c>' % (ref, attr, value)
        elif value == '':
            new = '<c r="%s"%s/>' % (ref, attr)
        elif value in self.index:
            # 🔴 最安全的一条：只换 SST 索引，不新增字符串、不动 count / uniqueCount。
            new = '<c r="%s"%s t="s"><v>%d</v></c>' % (ref, attr, self.index[value])
        else:
            new = '<c r="%s"%s t="inlineStr"><is><t>%s</t></is></c>' % (
                ref, attr, html.escape(value))
        return xml[:match.start()] + new + xml[match.end():]

    def flush(self):
        os.makedirs(BACKUP, exist_ok=True)
        shutil.copy2(self.path, os.path.join(BACKUP, os.path.basename(self.path)))
        tmp = self.path + '.tmp'
        overrides = dict(self.sheets)
        # sst 的 count = 全表 `t="s"` 引用总数。我们清空 / 改写了几格字符串，声明值会偏大；
        # Excel / WPS 不校验，但严格解析器会挑 ⇒ 落盘前按实际引用数对齐（幂等）。
        with zipfile.ZipFile(self.path) as src:
            sst_xml = src.read('xl/sharedStrings.xml').decode('utf-8')
        total = sum(len(re.findall(r't="s"', xml)) for xml in self.sheets.values())
        fixed, hits = re.subn(r'(<sst\b[^>]*\bcount=")\d+(")', r'\g<1>%d\2' % total, sst_xml, count=1)
        if hits and fixed != sst_xml:
            overrides['xl/sharedStrings.xml'] = fixed
        with zipfile.ZipFile(self.path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
            for info in src.infolist():
                data = src.read(info.filename)
                if info.filename in overrides:
                    data = overrides[info.filename].encode('utf-8')
                dst.writestr(info, data)
        os.replace(tmp, self.path)


# ---------------------------------------------------------------- JSON

def dump_remote(keys, rows):
    return json.dumps({'k': keys, 'v': rows, 'c': 1}, ensure_ascii=False,
                      indent=0, separators=(',', ':'))


def dump_client(rows):
    return '[' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows) + ']'


def write_if_changed(path, text):
    current = io.open(path, encoding='utf-8', newline='').read() if os.path.exists(path) else None
    if current == text:
        print('[skip] %s' % os.path.relpath(path, PROJECT))
        return False
    io.open(path, 'w', encoding='utf-8', newline='').write(text)
    print('[ok] 已写 %s' % os.path.relpath(path, PROJECT))
    return True


# ---------------------------------------------------------------- 主流程

def main():
    book = Book(XLSX)
    dialog = book.cells(DIALOG_SHEET)
    steps = book.cells(STEP_SHEET)

    data_rows = sorted({row for (_, row) in dialog
                        if ('A', row) in dialog and dialog[('A', row)].isdigit()
                        and re.fullmatch(r'D\d{2}', dialog.get(('B', row), ''))})
    if not data_rows:
        raise SystemExit('台词表里没找到数据行')

    # 组按行序重排成 D01…Dn：删掉中间某一组后，后面的自动补位。
    groups = []
    for row in data_rows:
        group = dialog[('B', row)]
        if group not in groups:
            groups.append(group)
    mapping = {old: 'D%02d' % (position + 1) for position, old in enumerate(groups)}
    renamed = {old: new for old, new in mapping.items() if old != new}
    print('组映射：%s' % (', '.join('%s→%s' % item for item in renamed.items()) or '（无需改动）'))

    dialog_edits, lines = {}, []
    for row in data_rows:
        order = int(dialog[('C', row)])
        old_group, old_id = dialog[('B', row)], int(dialog[('A', row)])
        new_group = mapping[old_group]
        new_id = int(new_group[1:]) * 100 + order
        if new_group != old_group:
            dialog_edits[('B', row)] = new_group
        if new_id != old_id:
            dialog_edits[('A', row)] = new_id
        lines.append({'id': new_id, 'group': new_group, 'order': order,
                      'speaker': dialog[('D', row)], 'content': dialog[('E', row)]})

    known = {line['group'] for line in lines}
    missing = sorted(set(mapping.values()) - known)
    if missing:
        raise SystemExit('重排后仍有空洞：%s' % '、'.join(missing))
    print('台词：%d 句 / %d 组（%s ~ %s）' % (len(lines), len(known), min(known), max(known)))

    # 步骤表：台词组列按同一映射改名；引用已删掉的组 ⇒ 清空。
    step_edits, step_wanted, notes = {}, {}, []
    for row in sorted({row for (_, row) in steps}):
        step_id = steps.get(('B', row), '')
        if not STEP_ID_RE.fullmatch(step_id):
            continue
        current = steps.get(('H', row), '')
        if not current:
            step_wanted[step_id] = ''
            continue
        if current in renamed:
            step_edits[('H', row)] = renamed[current]
            step_wanted[step_id] = renamed[current]
            notes.append('%s %s→%s' % (step_id, current, renamed[current]))
        elif current in groups:
            # 老表里本来就有这个组、且不需要改名 ⇒ 原样保留。
            step_wanted[step_id] = current
        else:
            # 引用的组在台词表里已经不存在了（本次是 2-1 的 D03）：清空，别让它指向别人的台词。
            step_edits[('H', row)] = ''
            step_wanted[step_id] = ''
            notes.append('%s %s→（清空，该组已删）' % (step_id, current))
    if notes:
        print('[ok] 步骤台词组：%s' % '；'.join(notes))

    # 列头提示里的组号范围（"台词组 D01~D15"）跟着表走。
    for (col, row), text in list(steps.items()):
        if col == 'H' and text.startswith('台词组 D01~') and text != '台词组 D01~%s' % max(known):
            wanted = '台词组 D01~%s' % max(known)
            step_edits[('H', row)] = wanted
            print('[ok] 列头提示：%s → %s' % (text, wanted))

    if dialog_edits:
        book.write(DIALOG_SHEET, dialog_edits)
    if step_edits:
        book.write(STEP_SHEET, step_edits)
    if dialog_edits or step_edits:
        book.flush()
        print('[ok] 已写盘 %s（备份 %s）' % (os.path.basename(XLSX), BACKUP))
    else:
        print('[skip] 源表 id 序列已连续，无需改动')

    # 两份台词 JSON 按定稿后的表重建（新文案一起进去）。
    rows = [[line[key] for key in DIALOG_KEYS] for line in lines]
    write_if_changed(os.path.join(REMOTE_DIR, 'guideDialog.json'), dump_remote(DIALOG_KEYS, rows))
    write_if_changed(os.path.join(CLIENT_DIR, 'guideDialog.json'),
                     dump_client([dict(zip(DIALOG_KEYS, row)) for row in rows]))

    # 步骤表 dialogId 同步进两份 JSON（其余字段不动）。
    for path in (os.path.join(REMOTE_DIR, 'guideStep.json'),
                 os.path.join(CLIENT_DIR, 'guideStep.json')):
        raw = io.open(path, encoding='utf-8', newline='').read()
        data = json.loads(raw)
        changed = 0
        if isinstance(data, dict):
            keys = data['k']
            position = keys.index('dialogId')
            at = keys.index('stepId')
            for row in data['v']:
                wanted = step_wanted.get(row[at], row[position])
                if row[position] != wanted:
                    row[position] = wanted
                    changed += 1
            text = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
        else:
            for row in data:
                wanted = step_wanted.get(row.get('stepId'), row.get('dialogId', ''))
                if row.get('dialogId', '') != wanted:
                    row['dialogId'] = wanted
                    changed += 1
            text = dump_client(data)
        if changed:
            io.open(path, 'w', encoding='utf-8', newline='').write(text)
            print('[ok] %s：%d 行 dialogId 已同步' % (os.path.relpath(path, PROJECT), changed))
        else:
            print('[skip] %s' % os.path.relpath(path, PROJECT))


if __name__ == '__main__':
    main()
