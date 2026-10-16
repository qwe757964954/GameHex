import re
import sys

def replace_text_in_file(file_path, replacements):
    try:
        # 打开文件并读取内容
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()

        # 进行多次替换操作
        for pattern, replacement in replacements:
            content = re.sub(pattern, replacement, content)

        # 将修改后的内容写回文件
        with open(file_path, 'w', encoding='utf-8') as file:
            file.write(content)

        print(f"文件 {file_path} 替换完成。")
    except FileNotFoundError:
        print(f"未找到文件 {file_path}，请检查文件路径。")
    except Exception as e:
        print(f"发生错误: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 4 or (len(sys.argv) - 2) % 2 != 0:
        print("参数输入有误，请按照以下格式输入：python script.py 文件名 正则表达式1 替换内容1 [正则表达式2 替换内容2 ...]")
        sys.exit(1)

    # 获取文件名
    file_path = sys.argv[1]

    # 提取正则表达式和替换内容对
    replacements = []
    for i in range(2, len(sys.argv), 2):
        pattern = sys.argv[i]
        replacement = sys.argv[i + 1]
        print(pattern, replacement)
        replacements.append((pattern, replacement))

    # 调用替换函数
    replace_text_in_file(file_path, replacements)