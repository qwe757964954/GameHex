import re
import os

# 脚本位于 <项目根>/tools/ref/，项目根 = 上两级目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

# 步骤 1 从文件中筛选出类似 ([wd]+) 的字符串
ref_gen_path = os.path.join(PROJECT_ROOT, "assets", "script", "app", "generated", "refGen")
file_path = os.path.join(ref_gen_path, r"ref_type_all.d.ts")

output_file_path = os.path.join(ref_gen_path, r"RefBase.ts")


begin_content = """import RefMgrBase from "../../../framework/ref/RefMgrBase";
//import { RefMgrGuideBase } from "../../ref/refEx/RefMgrGuideBase";
export default class RefBase{
"""

end_content = """
}
"""


try:
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
        # 使用正则表达式筛选出类似 ([wd]+) 的字符串
        matches = re.findall(r'interface IRef([\w\d]+) extends', content)
        # 将结果保存到 jsonlist.txt
        # with open('jsonlist.txt', 'w', encoding='utf-8') as output_file:
            # output_file.write('n'.join(matches))

        # 将这些字符串加上后缀 .json 记录到 ts_list

    os.makedirs(ref_gen_path, exist_ok=True)
    with open(output_file_path, 'w', encoding='utf-8') as f:
        f.write(begin_content)
        
        for match in matches:
            f.write("protected _RefMgr{0}:RefMgr{0}Base<IRef{0}>;\n".format(match))
        
        for match in matches:
            f.write("get RefMgr{0}(){{if(!this._RefMgr{0}){{this._RefMgr{0}=new RefMgr{0}Base<IRef{0}>()}}return this._RefMgr{0}}}\n".format(match))
        
        f.write(end_content)
        
        for match in matches:
            f.write('export class RefMgr{0}Base<T extends IRefBase> extends RefMgrBase<T>{{constructor(){{super("{0}")}}}}\n'.format(match))
            
        
        
except FileNotFoundError:
    print(f"文件 {file_path} 未找到。")
