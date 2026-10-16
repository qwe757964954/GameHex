import os, openpyxl

doc = r'D:\City1001\doc\塔防数据配置'

# 1) 找含 10401 的表（首充第1档奖励），定位源文件/sheet
for name in os.listdir(doc):
    if not name.endswith(('.xlsx', '.xlsm')) or name.startswith('~$'):
        continue
    path = os.path.join(doc, name)
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception:
        continue
    for ws in wb.worksheets:
        hit = False
        for row in ws.iter_rows():
            for c in row:
                if c.value == 10401:
                    print(f'FOUND 10401 in {name} [{ws.title}] {c.coordinate}')
                    hit = True
            if hit:
                break
    wb.close()
