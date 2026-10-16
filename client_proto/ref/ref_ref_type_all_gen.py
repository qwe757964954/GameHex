import json
import os

import sys
if len(sys.argv) > 1:
    config_path = sys.argv[1]
else:
    config_path = r"..\doc\塔防数据配置\json\client"
    
client_path = r"..\.."
config_path = os.path.join(client_path, config_path)
    
client_config_path = os.path.join(client_path, r"assets\remoteRef")

# 定义目录和文件路径
ref_json_path = os.path.join(client_config_path, r"refSmallAll.json")
output_file_path = os.path.join(client_path, r"assets\script\app\generated\refGen\ref_type_all.d.ts")

begin_content = ""
end_content = ""


def get_prop_ts_type(name, value):
    if isinstance(value, str):
        return "{0}:string\n".format(name)
    elif isinstance(value, (int, float)):
        return  "{0}:number\n".format(name)
    elif isinstance(value, list):
        return  "{0}:any[]\n".format(name)
    else:
        return  "{0}:any\n".format(name)
        
def generate_prop_ts_type(name, value, configName, props, typeAlias, key_count, total):
    typeName = None
    if isinstance(value, str):
        typeName = "string"
    elif isinstance(value, (int, float)):
        typeName = "number"
    elif isinstance(value, list):
        typeName = "any[]"
    else:
        typeName = "any"
    
    cur_count = key_count.get(name, 0)
    print(configName, name, cur_count, total)
    if cur_count >= total:
        sel = ""
    else:
        sel = "?"
    
    props[name] = "{0}{2}:{1}\n".format(name, typeName, sel)
    typeAlias.append("type IRef{0}_{1}={2}".format(configName, name, typeName))

def generate_prop_ts_type_check_all_rows(item, configName, props, typeAlias, key_count, total):
    nameType = dict()
    nameTypeIgnore = set()
    for list_item in item:
        for name, value in list_item.items():
            if name in nameTypeIgnore:
                continue
            typeName = None
            if isinstance(value, str):
                typeName = "string"
            elif isinstance(value, (int, float)):
                typeName = "number"
            elif isinstance(value, list):
                typeName = "any[]"
            else:
                typeName = "any"
            
            oldTypeName = nameType.get(name, 0)
            if oldTypeName == 0:
                nameType[name] = typeName
            elif oldTypeName != typeName:
                nameType[name] = "any"
                nameTypeIgnore.add(name)
    
    for name, typeName in nameType.items():
        cur_count = key_count.get(name, 0)
        print(configName, name, cur_count, total)
        if cur_count >= total:
            sel = ""
        else:
            sel = "?"
        
        props[name] = "{0}{2}:{1}\n".format(name, typeName, sel)
        typeAlias.append("type IRef{0}_{1}={2}".format(configName, name, typeName))

def parse_json(configName, item):
    begin_interface = "interface IRef{0} extends IRefBase\n{{\n".format(configName)
    end_interface = "}\n";
    refGen = "\ninterface refGen{{{0}:IRef{0}}}\n".format(configName)
    props = {}
    typeAlias = []
    
    key_count = {}
    for list_item in item:
        if isinstance(list_item, dict):
            for key in list_item.keys():
                key_count[key] = key_count.get(key, 0) + 1
    
    print(configName)
    total = len(item)
    if configName == "gameConfig":
        generate_prop_ts_type_check_all_rows(item, configName, props, typeAlias, key_count, total)
    elif configName == "coloring_data":
        return ""
    else:
        for list_item in item:
            for name, value in list_item.items():
                if props.get(name, None) == None:
                    generate_prop_ts_type(name, value, configName, props, typeAlias, key_count, total)

    content = ""
    for name, prop_str in props.items():
        content = content + prop_str
    
    
    return begin_interface + content + end_interface + "\n".join(typeAlias) + "\n" + refGen

try:
    # 打开并读取 refToCodeEnum.json 文件

    search_dir = config_path
    ref_data = {}
    if os.path.exists(search_dir):
        for root, dirs, files in os.walk(search_dir):
            for file in files:
                if file.endswith('.json'):
                    ref_json_path = os.path.join(root, file)
                    with open(ref_json_path, 'r', encoding='utf-8') as ref_file:
                        json_data = json.load(ref_file)
                        filename,ext = os.path.splitext(file)
                        ref_data[filename] = json_data
    else:
        print(f"目录 {search_dir} 不存在。")
        
    print(len(ref_data))
    # 用于存储生成的枚举内容
    result_contents = []
    
    ref_name_list = []
    # 遍历 refToCodeEnum.json 中的每个条目
    for key, item in ref_data.items():
        ref_name_list.append(key)
        
        result_contents.append(parse_json(key, item))


    # 将生成的枚举内容写入 enum.ts 文件
    if result_contents:
        with open(output_file_path, 'w', encoding='utf-8') as output_file:
            output_file.write(begin_content)
            output_file.write('\n\n'.join(result_contents))
            output_file.write("type TRefName=")
            output_file.write("|".join(["\"" + item + ".json\"" for item in ref_name_list]))
            
            output_file.write("\n\n")
            output_file.write("type TRefName2=")
            output_file.write("|".join(["\"" + item + "\"" for item in ref_name_list]))
            output_file.write("\n\n")
        print(f"枚举内容已成功写入 {output_file_path}。")
    else:
        print("没有生成有效的枚举内容。")

except FileNotFoundError:
    print(f"文件 {ref_json_path} 未找到。")
except json.JSONDecodeError:
    print(f"文件 {ref_json_path} 不是有效的 JSON 格式。")