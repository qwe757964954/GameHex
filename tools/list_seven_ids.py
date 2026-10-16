import openpyxl

path = r'D:\City1001\doc\塔防数据配置\W-物品表.xlsx'
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
ws = wb['物品']

rows = list(ws.iter_rows(values_only=True))
# 找表头
header_i = None
for i, r in enumerate(rows[:8]):
    if r and r[0] == 'resId':
        header_i = i
        break
print('header row:', rows[header_i][:10])

count = 0
for r in rows[header_i+1:]:
    if not r or r[0] is None:
        continue
    try:
        rid = int(r[0])
    except (ValueError, TypeError):
        continue
    if rid >= 1000000:
        count += 1
        print(f'resId={rid}  name={r[1]!r}  icon={r[7]!r}')
print('total >=1000000:', count)
wb.close()
