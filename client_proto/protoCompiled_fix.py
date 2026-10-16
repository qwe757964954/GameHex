# 输入文件的路径
input_file_path = 'protoCompiled.js'
# 输出文件的路径
output_file_path = '../assets/script/lib/protobuf/subproto/protoCompiled.js'

try:
    # 以二进制模式读取输入文件
    with open(input_file_path, 'rb') as file:
        # 读取文件内容
        content = file.read()

    # 尝试对内容进行解码，这里假设文件可能是多种编码，先尝试常见的编码
    encodings = ['utf-8', 'gbk', 'latin-1']
    decoded_content = None
    for encoding in encodings:
        try:
            decoded_content = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if decoded_content is None:
        print("无法确定文件编码。")
    else:
        # 在文件开头插入 "aab"，结尾插入 "ccd"
        begin_content = "var $protobuf = window.protobuf"
        end_content = """

var $window___ = $root.com
$window___.protobufRoot = $root
window.protobufRoot = $root
"""

        # 创建输出目录（如果不存在）
        import os
        output_dir = os.path.dirname(output_file_path)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # 以 UTF-8 编码将新内容写入输出文件
        with open(output_file_path, 'w', encoding='utf-8') as output_file:
            output_file.write(begin_content)
            output_file.write(decoded_content)
            output_file.write(end_content)

        print(f"文件处理完成，已保存到 {output_file_path}")

except FileNotFoundError:
    print(f"输入文件 {input_file_path} 未找到。")
except Exception as e:
    print(f"发生错误: {e}")