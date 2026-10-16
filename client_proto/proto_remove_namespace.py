import re
import sys

# 定义输入文件和输出文件的名称
input_file = sys.argv[1]
output_file = sys.argv[2]

# 用于匹配 "package com.*" 的正则表达式
pattern = re.compile(r'package com.*')

try:
    # 打开输入文件以读取内容
    with open(input_file, 'r', encoding='utf-8') as infile:
        # 读取输入文件的每一行并存储在一个列表中
        lines = infile.readlines()

    # 过滤掉匹配正则表达式的行
    new_lines = [line for line in lines if not pattern.match(line)]

    # 打开输出文件以写入新内容
    with open(output_file, 'w', encoding='utf-8') as outfile:
        # 将过滤后的行写入输出文件
        if len(sys.argv) > 3:
            outfile.write(sys.argv[3])
            outfile.write("\n\n")
        outfile.writelines(new_lines)

    print(f"处理完成，新内容已写入 {output_file}")

except FileNotFoundError:
    print(f"未找到输入文件 {input_file}，请检查文件路径。")
except Exception as e:
    print(f"发生错误: {e}")