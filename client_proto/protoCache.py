import json


def check_json_fields(json_file_path):

    # 打开并读取 JSON 文件
    with open(json_file_path, 'r', encoding='utf-8') as file:
        data = json.load(file)
    # 遍历数据中的每个 item
    names = []
    for name, item in data.items():
        tl_key = item.get('tlKey')
        tm_field = item.get('tmField')
        if len(tl_key) != 1:
            print(f"{name} => tlKey: {tl_key}, len: {len(tl_key)}")
            names.append(f"{name} 0")
            continue
            
        if tl_key and tm_field and isinstance(tm_field, dict):
            # 检查 tmField 中对应 tlKey 的对象
            sub_item = tm_field.get(tl_key[0])
            if sub_item and isinstance(sub_item, dict):
                field_number = sub_item.get('fieldNumber')
                if field_number is not None and field_number != 1:
                    print(f"{name} => tlKey: {tl_key}, fieldNumber: {field_number}")

        names.append(f"{name}")
    
    with open("protoCache_list.txt", 'w', encoding='utf-8') as file:
        file.write("\n".join(names))
if __name__ == "__main__":
    json_file_path = 'protoCache_back.json'
    check_json_fields(json_file_path)