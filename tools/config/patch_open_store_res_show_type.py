# -*- coding: utf-8 -*-
"""G-功能开启：把 refId=1（TabStore 商店）的资源栏显示改成 gold,end,coin（2026-11-26）。

背景：商城页资源条改为与主界面同一套货币（铜币 + 体力）并追加 id 10 充值币，
客户端 prefab 已先落成 `resKeys="gold,end,coin"`；表侧 `open.json` refId=1 的
`resShowType` 仍是 `[10,7]`（幻灵玉+铜币），顺序与内容都对不上，需要改源表。

改法：只在 `G-功能开启.xlsx` 的「功能开启」sheet 里，把 A 列 refId=1 且 F 列
`TabStore` 那一行的 D 列（resShowType）改成 `[7,9,10]`。

实现细节：直接改 zip 里的 XML，不动 openpyxl 的工作簿对象，避免整本重排。
D7 原来是共享字符串 53（`[10,7]`，被 53 个格子复用），所以不能原地改，
改为把新串追加到 sharedStrings 末尾再让该格指向它（count/uniqueCount 同步 +1）。

幂等：已经是目标值就跳过写盘。备份只留改之前那一份。
用法：python tools/config/patch_open_store_res_show_type.py [--dry]
"""
import os
import re
import shutil
import sys
import zipfile

XLSX = r'D:\City1001\doc\塔防数据配置\G-功能开启.xlsx'
SHEET = 'xl/worksheets/sheet1.xml'
SST = 'xl/sharedStrings.xml'
TARGET_REF_ID = 1
TARGET_URL = 'TabStore'
TARGET_VALUE = '[7,9,10]'
BACKUP_DIR = r'D:\City1001\Demo3.8\tmp\backup_open_res_show_type_20261126'

CELL_RE = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', re.S)
V_RE = re.compile(r'<v>(.*?)</v>', re.S)
SI_RE = re.compile(r'<si>(.*?)</si>', re.S)
T_RE = re.compile(r'<t[^>]*>(.*?)</t>', re.S)


def read_shared(z):
    sst = z.read(SST).decode('utf-8')
    return sst, [T_RE.findall(si) and ''.join(T_RE.findall(si)) or '' for si in SI_RE.findall(sst)]


def cell_value(shared, attrs, body):
    t = re.search(r't="([^"]+)"', attrs or '')
    if not body:
        return None
    v = V_RE.search(body)
    if not v:
        return None
    raw = v.group(1)
    if t and t.group(1) == 's':
        return shared[int(raw)]
    if t and t.group(1) == 'inlineStr':
        return ''.join(T_RE.findall(body))
    return raw


def find_target_row(sheet_xml, shared):
    for row in re.findall(r'<row[^>]*>.*?</row>', sheet_xml, re.S):
        cells = {}
        for col, rownum, attrs, body in CELL_RE.findall(row):
            cells[col] = (rownum, attrs, body)
        a = cells.get('A')
        f = cells.get('F')
        if not a or not f:
            continue
        if cell_value(shared, a[1], a[2]) != str(TARGET_REF_ID):
            continue
        if cell_value(shared, f[1], f[2]) != TARGET_URL:
            continue
        return row, cells
    return None, None


def main():
    dry = '--dry' in sys.argv
    if not os.path.isfile(XLSX):
        raise SystemExit('missing xlsx: ' + XLSX)

    with zipfile.ZipFile(XLSX) as z:
        sheet_xml = z.read(SHEET).decode('utf-8')
        sst_xml, shared = read_shared(z)
        entries = [(item, z.read(item.filename)) for item in z.infolist()]

    row, cells = find_target_row(sheet_xml, shared)
    if not row:
        raise SystemExit('target row not found (refId=%s, url=%s)' % (TARGET_REF_ID, TARGET_URL))
    d = cells.get('D')
    if not d:
        raise SystemExit('target row has no D cell')
    rownum, attrs, body = d
    current = cell_value(shared, attrs, body)
    print('before:', 'D%s' % rownum, current)

    if current == TARGET_VALUE:
        print('already patched, skip')
        return

    if TARGET_VALUE in shared:
        new_index = shared.index(TARGET_VALUE)
        sst_new = sst_xml
    else:
        new_index = len(shared)
        sst_new = re.sub(
            r'<sst([^>]*?)count="([0-9]+)"([^>]*?)uniqueCount="([0-9]+)">',
            lambda m: '<sst%s count="%d"%s uniqueCount="%d">' % (
                m.group(1), int(m.group(2)) + 1, m.group(3), int(m.group(4)) + 1),
            sst_xml, count=1)
        sst_new = sst_new.replace('</sst>', '<si><t>%s</t></si></sst>' % TARGET_VALUE)

    new_cell = '<c r="D%s"%s t="s"><v>%d</v></c>' % (rownum, attrs.replace(' t="s"', ''), new_index)
    old_cell = re.search(r'<c r="D%s"[^>]*?(?:/>|>.*?</c>)' % rownum, sheet_xml, re.S)
    if not old_cell:
        raise SystemExit('cannot locate raw cell D%s' % rownum)
    sheet_new = sheet_xml.replace(old_cell.group(0), new_cell, 1)
    print('after :', 'D%s' % rownum, TARGET_VALUE, '(shared index %d)' % new_index)

    if dry:
        print('dry run, nothing written')
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'G-功能开启.xlsx')
    if not os.path.exists(backup):
        shutil.copy2(XLSX, backup)
        print('backup:', backup)

    tmp_path = XLSX + '.tmp'
    with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item, data in entries:
            if item.filename == SHEET:
                data = sheet_new.encode('utf-8')
            elif item.filename == SST:
                data = sst_new.encode('utf-8')
            zout.writestr(item, data)
    shutil.move(tmp_path, XLSX)
    print('written:', XLSX)


if __name__ == '__main__':
    main()
