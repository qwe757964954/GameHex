# -*- coding: utf-8 -*-
"""通用 xlsx 读取（不依赖 openpyxl）：zip + sharedStrings + sheet xml。

用法：
  python tools/config/xlsx_read.py <file.xlsx>                 # 列 sheet
  python tools/config/xlsx_read.py <file.xlsx> <sheetIndex> [maxRows]
"""
import io
import os
import re
import sys
import html
import zipfile

CELL_RE = re.compile(r'<c\b([^>]*)(?:/>|>(.*?)</c>)', re.S)
ATTR_R_RE = re.compile(r'\br="([A-Z]+)(\d+)"')
ATTR_T_RE = re.compile(r'\bt="([^"]+)"')
V_RE = re.compile(r'<v>(.*?)</v>', re.S)
IS_RE = re.compile(r'<is>(.*?)</is>', re.S)
T_RE = re.compile(r'<t[^>]*>(.*?)</t>', re.S)


def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def read_shared_strings(z):
    try:
        xml = z.read('xl/sharedStrings.xml').decode('utf-8')
    except KeyError:
        return []
    out = []
    for m in re.finditer(r'<si>(.*?)</si>', xml, re.S):
        body = m.group(1)
        out.append(html.unescape(''.join(T_RE.findall(body))))
    return out


def list_sheets(path):
    with zipfile.ZipFile(path) as z:
        wb = z.read('xl/workbook.xml').decode('utf-8')
        rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
        rid2target = {}
        for m in re.finditer(r'<Relationship\b([^>]*)/>', rels):
            attrs = m.group(1)
            rid = re.search(r'Id="([^"]+)"', attrs)
            tgt = re.search(r'Target="([^"]+)"', attrs)
            if rid and tgt:
                rid2target[rid.group(1)] = tgt.group(1).lstrip('/')
        sheets = []
        for m in re.finditer(r'<sheet\b([^>]*)/>', wb):
            attrs = m.group(1)
            name = re.search(r'name="([^"]*)"', attrs)
            rid = re.search(r'r:id="([^"]+)"', attrs)
            tgt = rid2target.get(rid.group(1) if rid else '', '')
            if tgt and not tgt.startswith('xl/'):
                tgt = 'xl/' + tgt
            sheets.append((name.group(1) if name else '?', tgt))
        return sheets


def read_sheet(path, sheet_index, max_rows=None):
    with zipfile.ZipFile(path) as z:
        sheets = list_sheets(path)
        name, member = sheets[sheet_index]
        sst = read_shared_strings(z)
        xml = z.read(member).decode('utf-8')
    rows = []
    for rm in re.finditer(r'<row\b([^>]*)>(.*?)</row>', xml, re.S):
        rn = re.search(r'\br="(\d+)"', rm.group(1))
        row_no = int(rn.group(1)) if rn else len(rows) + 1
        cells = {}
        for cm in CELL_RE.finditer(rm.group(2)):
            attrs, body = cm.group(1), cm.group(2) or ''
            ref = ATTR_R_RE.search(attrs)
            if not ref:
                continue
            col = col_index(ref.group(1))
            t = ATTR_T_RE.search(attrs)
            t = t.group(1) if t else ''
            if t == 's':
                v = V_RE.search(body)
                val = sst[int(v.group(1))] if v else ''
            elif t == 'inlineStr':
                isb = IS_RE.search(body)
                val = html.unescape(''.join(T_RE.findall(isb.group(1)))) if isb else ''
            elif t == 'str':
                v = V_RE.search(body)
                val = html.unescape(v.group(1)) if v else ''
            else:
                v = V_RE.search(body)
                val = v.group(1) if v else ''
            cells[col] = val
        width = max(cells) if cells else 0
        rows.append((row_no, [cells.get(i, '') for i in range(1, width + 1)]))
        if max_rows and len(rows) >= max_rows:
            break
    return name, rows


def main():
    path = sys.argv[1]
    if len(sys.argv) < 3:
        for i, (n, m) in enumerate(list_sheets(path)):
            print(i, n, m)
        return
    idx = int(sys.argv[2])
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    name, rows = read_sheet(path, idx, limit)
    print('### sheet', idx, name, 'rows(shown)', len(rows))
    for rn, vals in rows:
        print(rn, ' | '.join(str(v)[:60] for v in vals))


if __name__ == '__main__':
    main()
