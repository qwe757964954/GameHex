import re
import sys
import os

# 脚本位于 <项目根>/tools/proto/，项目根 = 上两级目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

def remove_namespace(content):
    pattern_package = r'^declare namespace\s.*$'
    result = re.sub(pattern_package, '', content, flags=re.M)
    # 检查是否删除了以 package 开头的行
    if result != content:
        # 从后往前找到第一个 } 并删除
        last_brace_index = result.rfind('}')
        if last_brace_index != -1:
            result = result[:last_brace_index] + result[last_brace_index + 1:]
            
    return result
    
def add_declare(content):

    # 定义正则表达式，使用 MULTILINE 标志让 ^ 匹配每行开头
    pattern = re.compile(r'^(\s*)class', re.MULTILINE)

    # 替换匹配到的内容
    content = pattern.sub(r'\g<1>declare class', content)
    
    pattern = re.compile(r'^(\s*)interface', re.MULTILINE)
    
    content = pattern.sub(r'\g<1>declare interface', content)
    
    
    pattern = re.compile(r'^(\s*)enum', re.MULTILINE)
    
    content = pattern.sub(r'\g<1>declare enum', content)
    
    return content

def remove_class(text):
    result = ""
    old_begin = 0
    i = 0
    while i < len(text):
        # 查找非字母数字之后以 declare class 开头的情况
        
        index = text[i:].find("declare class")
      #  print("first", index)
        if index < 0:
            # 如果没有匹配到，将剩余的文本添加到结果中
            result += text[i:]
            break
        
        # 记录匹配的起始位置
        start_index = i + index
        if start_index > old_begin:
            result += text[old_begin:start_index]
        
        # 找到第一个 '{' 的位置
        open_brace_index = text.find('{', start_index)
        if open_brace_index == -1:
            print("error")
            break

        # 开始计数
        brace_count = 1
        j = open_brace_index + 1
        while j < len(text):
            if text[j] == '{':
                brace_count += 1
            elif text[j] == '}':
                brace_count -= 1
                if brace_count == 0:
                    # 计数为 0 时，跳过这部分内容，将 '}' 之后的内容继续处理
                    i = j + 1
                    old_begin = i
               #     print("end", i)
                    break
            j += 1
        else:
            # 如果没有找到匹配的 '}'，将从起始位置到当前位置的文本添加到结果中
            result += text[i:j]
            i = j

   
    return result

def change_interface_to_class(content):

    pattern = re.compile(r'\bdeclare interface I', re.MULTILINE)

    # 替换匹配到的内容
    content = pattern.sub(r'declare class ', content)
    return content
    
def collect_protoCacheGen(content):
    begin_str = "declare interface protoCacheGen{"
    lines = []
    with open(os.path.join(SCRIPT_DIR, 'protoCache_list.txt'), 'r', encoding='utf-8') as txt_file:
        for line in txt_file:
            item = line.strip()
            lines.append(f'{item}:{{c:{item}, c_k:{item}_Key}}')
        
    end_str = "}"
    return begin_str + "\n".join(lines) + end_str

def collect_patterns_and_append_declarations(file_path, out_enum_file):

    # 读取文件内容
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()


    content = remove_namespace(content)
    content = add_declare(content)


        
    # 定义正则表达式
    message_pattern = re.compile(r'declare class ([\d\w_]+)')
    enum_pattern = re.compile(r'enum ([\d\w_]+)')
    req_pattern = re.compile(r'declare class\s+([\d\w_]+ReqMsg)')
    cmd_enum_pattern = re.compile(r'(enum\s+[\d\w_]+\s*\{[^}]+?\})')

    # 收集匹配的内容
    message_list = message_pattern.findall(content)
    enum_list = enum_pattern.findall(content)
    req_list = req_pattern.findall(content)
    # print(message_list)
    # print(enum_list)

    # 生成要追加的声明内容
    enum_declaration = "declare type EnumProtoName =\n| " + '\n| '.join([f'"{item}"' for item in enum_list])
    enum_import = f"import {{ {','.join(enum_list)} }} from \"./CmdInterface\";\n\n"
    message_declaration = "declare type MessageProtoName =\n| " + '\n| '.join([f'"{item}"' for item in message_list])
    req_declaration = "declare type ReqMsgProtoName =\n| " + '\n| '.join([f'"{item}"' for item in req_list])
    
    # import { CmdRankType } from "../../../generated/netProto/CmdInterface";

    new_content = remove_class(content)
    saved_content = new_content
    #new_content = cmd_enum_pattern.sub(content, "", re.MULTILINE)
   # new_content = re.sub(r'(enum\s+[\d\w_]+\s*\{[^}]+?\})', '\n', new_content, re.MULTILINE)
    print(len(content), len(new_content))
    content = new_content
    content = change_interface_to_class(content)
    
    protoCacheGen = collect_protoCacheGen(content)

    # 追加声明内容到文件末尾
    new_content = content + '\n\n' + enum_declaration + '\n\n' + message_declaration + "\n\n" + req_declaration + "\n\n" + protoCacheGen

    # 将新内容写回文件，覆盖旧内容
    with open(file_path, 'w', encoding='utf-8') as file:
     #   file.write(enum_import)
        file.write(new_content)

    
    cmd_enum_content = cmd_enum_pattern.findall(saved_content, re.MULTILINE)
    with open(out_enum_file, 'w', encoding='utf-8') as file:
        for cmd_enum in cmd_enum_content:
            if cmd_enum.startswith("enum MessageId"):
                continue
                
            file.write("export ")
            file.write(cmd_enum)
            file.write("\r\n")

    print(f"处理完成，已更新文件 {file_path}")



if __name__ == "__main__":

    file_path = "Cmd.d.ts"
    enum_interface = "CmdInterface.ts"
    
    
    collect_patterns_and_append_declarations(file_path, enum_interface)