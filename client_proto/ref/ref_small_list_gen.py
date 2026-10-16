import json

def extract_keys_to_file():
    try:
        # 打开并读取 a.json 文件
        with open(r'F:\pmshare\piaomiao\TreeKingdoms\client\assets\remoteRef\refSmallAll.json', 'r', encoding='utf-8') as file:
            data = json.load(file)
        
        nocompressed = []
        # 打开 small.txt 文件以写入模式
        with open('small.txt', 'w', encoding='utf-8') as output_file:
            # 遍历 JSON 数据
            if isinstance(data, dict):
                # 如果是字典类型，直接遍历键
                for key,item in data.items():
                    if isinstance(item, dict) and item.get("c", -1) == 1:
                        pass
                    else:
                        nocompressed.append(key)
                        
                    output_file.write(str(key) + '\n')
        
        with open("nocompressed.txt", "w", encoding='utf-8') as compressed:
            compressed.write("\n".join(nocompressed))
        print("键已成功写入 small.txt 文件。")
    except FileNotFoundError:
        print("未找到 a.json 文件。")
    except json.JSONDecodeError:
        print("a.json 文件不是有效的 JSON 格式。")

# 调用函数
extract_keys_to_file()