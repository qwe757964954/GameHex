import re
import os
import sys
if len(sys.argv) > 1:
    config_path = sys.argv[1]
else:
    config_path = r"..\doc\塔防数据配置\json\client"
    
# 步骤 1 从文件中筛选出类似 ([wd]+) 的字符串
client_path = r"..\.."
file_path = os.path.join(client_path, r"assets\script\app\generated\refGen\ref_type_all.d.ts")
try:
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
        # 使用正则表达式筛选出类似 ([wd]+) 的字符串
        matches = re.findall(r'interface IRef([\w\d]+) extends', content)
        # 将结果保存到 jsonlist.txt
        # with open('jsonlist.txt', 'w', encoding='utf-8') as output_file:
            # output_file.write('n'.join(matches))

        # 将这些字符串加上后缀 .json 记录到 ts_list
        ts_list = [match + ".json" for match in matches]
except FileNotFoundError:
    print(f"文件 {file_path} 未找到。")
    ts_list = []


config_path = os.path.join(client_path, config_path)

search_dir = config_path
dir_list = []
if os.path.exists(search_dir):
    for root, dirs, files in os.walk(search_dir):
        for file in files:
            if file.endswith('.json'):
                dir_list.append(file)
else:
    print(f"目录 {search_dir} 不存在。")

# 步骤 3 对比两个列表找出只在 ts_list 中存在的和在 dir_list 中存在的字符串

only_in_ts_list = [item for item in ts_list if item not in dir_list]
only_in_dir_list = [item for item in dir_list if item not in ts_list]
in_both_lists = [item for item in ts_list if item in dir_list]

print("only_in_ts_list", only_in_ts_list, "total ts", len(ts_list))# ts 101
print("only_in_dir_list", only_in_dir_list, "total dir", len(dir_list))
#print("in_both_lists", in_both_lists)