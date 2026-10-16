import os, openpyxl

doc = r'D:\City1001\doc\塔防数据配置'
targets = {1033343, 1004121}

for name in os.listdir(doc):
    if not name.endswith(('.xlsx', '.xlsm')):
        continue
    path = os.path.join(doc, name)
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as e:
        print('OPEN FAIL', name, e)
        continue
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if v is None:
                    continue
                try:
                    iv = int(v)
                except (ValueError, TypeError):
                    continue
                if iv in targets:
                    print(f'{name} [{ws.title}] {c.coordinate} = {v}')
    wb.close()
