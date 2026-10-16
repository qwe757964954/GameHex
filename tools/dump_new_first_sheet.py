import openpyxl

path = r'D:\City1001\doc\塔防数据配置\S-商城.xlsx'

for data_only in (False, True):
    print(f'===== data_only={data_only} =====')
    wb = openpyxl.load_workbook(path, read_only=True, data_only=data_only)
    ws = wb['新首充']
    for row in ws.iter_rows():
        for c in row:
            if c.value is not None:
                print(f'{c.coordinate}: {repr(c.value)}')
    wb.close()
    print()
