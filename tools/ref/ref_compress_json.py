
import os
import sys
import json

# 脚本位于 <项目根>/tools/ref/，项目根 = 上两级目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

# 输入源：项目外 doc 目录下的转表 json（可被 sys.argv[1] 覆盖）
if len(sys.argv) > 1:
    config_path = sys.argv[1]
    if not os.path.isabs(config_path):
        config_path = os.path.abspath(config_path)
else:
    config_path = r"D:\City1001\doc\塔防数据配置\json\client"

# 输出：项目内 remoteRef + generated/refGen
client_config_path = os.path.join(PROJECT_ROOT, "assets", "remoteRef")
ref_gen_path = os.path.join(PROJECT_ROOT, "assets", "script", "app", "generated", "refGen")

# 定义目录和文件路径
ref_json_path = os.path.join(client_config_path, r"refSmallAll.json")
output_file_path = os.path.join(ref_gen_path, r"ref_type_all.d.ts")

def get_list_from_file(file_name):
    small_list = []
    try:
        # 以只读模式打开 small.txt 文件
        with open(file_name, 'r', encoding='utf-8') as file:
            # 遍历文件的每一行
            for line in file:
                # 去除每行前后的空格
                line = line.strip()
                # 检查去除空格后的行是否非空
                if line:
                    # 若不为空，则添加到 small_list 中
                    small_list.append(line)
    except FileNotFoundError:
        print("未找到 small.txt 文件，请检查文件路径和文件名。")
    
    return small_list
    
# todo: do sv
def process_json_file(file_name, iscompress):
    try:
        # 读取文件并解析为 JSON
        with open(file_name, 'r', encoding='utf-8') as file:
            data = json.load(file)
        
        if not iscompress:
            return data
            
       # print(data)
        # 检查数据是否为列表
        if not isinstance(data, list):
            return data

        # 统计每个键的数目
        key_count = {}
        for item in data:
            if isinstance(item, dict):
                for key in item.keys():
                    key_count[key] = key_count.get(key, 0) + 1

        # 将键放入 key_arr 并按数目排序
        key_arr = sorted(key_count.keys(), key=lambda k: key_count[k], reverse=True)

        # 创建 value_arr
        value_arr = []
        for item in data:
            values = []
            for key in key_arr:
                values.append(item.get(key))
            value_arr.append(values)

        # 将结果放入字典
        result = {'k': key_arr, 'v': value_arr, 'c': 1}

        return result

    except FileNotFoundError:
        print(f"未找到文件: {file_name}")
    except json.JSONDecodeError:
        print(f"文件 {file_name} 不是有效的 JSON 格式")
    except ValueError as e:
        print(e)

small_list = get_list_from_file(os.path.join(SCRIPT_DIR, "small.txt"))
exclude_list = get_list_from_file(os.path.join(SCRIPT_DIR, "exclude.txt"))
nocompressed_list = get_list_from_file(os.path.join(SCRIPT_DIR, "nocompressed.txt"))

os.makedirs(client_config_path, exist_ok=True)

small = {}
for file_name in os.listdir(config_path):
    # 示例调用
    if file_name.endswith(".json"):
        name,ext = os.path.splitext(file_name)
        if name in exclude_list:
            continue
       
        iscompress = name not in nocompressed_list
        my_dict = process_json_file(os.path.join(config_path, file_name), iscompress)
        if my_dict == None:
            print(name, "None")
            print(os.path.join(config_path, file_name))
            continue
        
        if name in small_list:
            print(name, "small")
            small[name] = my_dict
            continue
        
        with open(os.path.join(client_config_path, file_name), 'w', encoding='utf-8') as file:
            # 将字典转换为 JSON 格式的字符串并写入文件
            # indent=4 用于格式化输出，让 JSON 更易读
            json.dump(my_dict, file, separators=(',', ':'), indent=0, ensure_ascii=False)

with open(os.path.join(client_config_path, "refSmallAll.json"), 'w', encoding='utf-8') as file:
    # 将字典转换为 JSON 格式的字符串并写入文件
    # indent=4 用于格式化输出，让 JSON 更易读
    json.dump(small, file, separators=(',', ':'), indent=0, ensure_ascii=False)