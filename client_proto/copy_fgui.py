import os
import shutil


def copy_files(src_dir, dest_dir):
    if not os.path.exists(src_dir):
        print(f"源目录 {src_dir} 不存在。")
        return
    if not os.path.exists(dest_dir):
        os.makedirs(dest_dir)
    for root, dirs, files in os.walk(src_dir):
        relative_path = os.path.relpath(root, src_dir)
        dest_sub_dir = os.path.join(dest_dir, relative_path)
        if not os.path.exists(dest_sub_dir):
            os.makedirs(dest_sub_dir)
        for file in files:
            src_file_path = os.path.join(root, file)
            dest_file_path = os.path.join(dest_sub_dir, file)
            if os.path.exists(dest_file_path):
                src_mtime = os.path.getmtime(src_file_path)
                dest_mtime = os.path.getmtime(dest_file_path)
                if src_mtime > dest_mtime:
                    try:
                        shutil.copy2(src_file_path, dest_file_path)
                        print(f"更新文件: {dest_file_path}")
                    except Exception as e:
                        print(f"复制文件 {src_file_path} 时出错: {e}")
            else:
                try:
                    shutil.copy2(src_file_path, dest_file_path)
                    print(f"复制文件: {dest_file_path}")
                except Exception as e:
                    print(f"复制文件 {src_file_path} 时出错: {e}")


def copy_single_file(src_file, dest_file):
    # 检查源文件是否存在
    if not os.path.exists(src_file):
        print(f"源文件 {src_file} 不存在。")
        return


    # 构建目标文件路径
    file_name = os.path.basename(src_file)


    # 检查目标文件是否存在
    if os.path.exists(dest_file):
        # 获取源文件和目标文件的修改时间
        src_mtime = os.path.getmtime(src_file)
        dest_mtime = os.path.getmtime(dest_file)
        if src_mtime <= dest_mtime:
            print(f"目标文件 {dest_file} 较新，不进行覆盖。")
        else:
            try:
                shutil.copy2(src_file, dest_file)
                print(f"更新文件: {dest_file}")
            except Exception as e:
                print(f"复制文件 {src_file} 时出错: {e}")
    else:
        try:
            shutil.copy2(src_file, dest_file)
            print(f"复制文件: {dest_file}")
        except Exception as e:
            print(f"复制文件 {src_file} 时出错: {e}")

import sys

if __name__ == "__main__":
    src_root = sys.argv[1]
    dest_root = sys.argv[2]
    
    fgui = r"assets\resources\fgui"
    src = os.path.join(src_root, fgui)
    dest = os.path.join(dest_root, fgui)
    copy_files(src, dest)
    
    fguipakginfo_json = r"assets\resources\fguiConfig\fguipkginfo.json"
    
    copy_single_file(os.path.join(src_root, fguipakginfo_json), os.path.join(dest_root, fguipakginfo_json))
    
    cocos_d_ts = r"assets\script\declare\FairyGUIGen_UIProject.d.ts"
    copy_single_file(os.path.join(src_root, cocos_d_ts), os.path.join(dest_root, cocos_d_ts))
    