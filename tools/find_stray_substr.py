import os, openpyxl

doc = r'D:\City1001\doc\塔防数据配置'
needles = ['1033343', '1004121']

for name in os.listdir(doc):
    if not name.endswith(('.xlsx', '.xlsm')) or name.startswith('~$'):
        continue
    path = os.path.join(doc, name)
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception:
        continue
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str) and any(n in v for n in needles):
                    print(f'{name} [{ws.title}] {c.coordinate} = {v[:160]}')
    wb.close()
