import json
import os
import sys

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

ref_gen_path = os.path.join(PROJECT_ROOT, "assets", "script", "app", "generated", "refGen")

# 定义目录和文件路径
ref_json_path = os.path.join(config_path, r"refToCodeEnum.json")
output_file_path = os.path.join(ref_gen_path, r"RefEnum.ts")

try:
    # 打开并读取 refToCodeEnum.json 文件
    with open(ref_json_path, 'r', encoding='utf-8') as ref_file:
        ref_data = json.load(ref_file)

    # 用于存储生成的枚举内容
    enum_contents = []

    # 遍历 refToCodeEnum.json 中的每个条目
    for item in ref_data:
        enum_name = item["enumName"]
        print(enum_name)
        fname = item["fname"]
        key_field = item["key"]
        value_field = item["value"]

        # 构建要打开的文件路径
        target_file_path = os.path.join(config_path, fname)

        try:
            # 打开并读取目标文件
            with open(target_file_path, 'r', encoding='utf-8') as target_file:
                target_data = json.load(target_file)

            # 构建枚举内容
            enum_lines = []
            for entry in target_data:
                if key_field in entry and value_field in entry:
                    key_value = entry[key_field]
                    value_value = entry[value_field]
                    if isinstance(value_value, str):
                        enum_lines.append(f'{key_value} = "{value_value}"')
                    else:
                        enum_lines.append(f'{key_value} = {value_value}')

            if enum_lines:
                # 定义换行符和缩进
                line_separator = ',\n    '
                start_end_newline = '\n'
                indent = '    '
                enum_content = f"export enum {enum_name} {{{start_end_newline}{indent}{line_separator.join(enum_lines)}{start_end_newline}}}"
                enum_contents.append(enum_content)

        except FileNotFoundError:
            print(f"文件 {target_file_path} 未找到。")
        except json.JSONDecodeError:
            print(f"文件 {target_file_path} 不是有效的 JSON 格式。")

    # 将生成的枚举内容写入 enum.ts 文件
    if enum_contents:
        os.makedirs(ref_gen_path, exist_ok=True)
        with open(output_file_path, 'w', encoding='utf-8') as output_file:
            output_file.write('\n\n'.join(enum_contents))
        print(f"枚举内容已成功写入 {output_file_path}。")
    else:
        print("没有生成有效的枚举内容。")

except FileNotFoundError:
    print(f"文件 {ref_json_path} 未找到。")
except json.JSONDecodeError:
    print(f"文件 {ref_json_path} 不是有效的 JSON 格式。")