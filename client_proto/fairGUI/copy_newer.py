import os
import shutil
from pathlib import Path

def copy_newer_files(source_dir, target_dir):
    """递归拷贝目录，仅更新日期较新的文件"""
    source = Path(source_dir)
    target = Path(target_dir)
    
    if not source.exists():
        print(f"源目录不存在: {source}")
        return
    
    # 创建目标目录（如果不存在）
    target.mkdir(parents=True, exist_ok=True)
    
    # 遍历源目录中的所有文件和子目录
    for item in source.rglob('*'):
        relative_path = item.relative_to(source)
        target_path = target / relative_path
        
        # 如果是目录，创建对应目录
        if item.is_dir():
            target_path.mkdir(exist_ok=True)
            continue
            
        # 如果是文件，比较修改时间
        if target_path.exists():
            source_mtime = item.stat().st_mtime
            target_mtime = target_path.stat().st_mtime
            
            # 如果源文件更新，则拷贝
            if source_mtime > target_mtime:
                print(f"更新: {target_path}")
                shutil.copy2(item, target_path)
        else:
            # 目标文件不存在，直接拷贝
            print(f"新建: {target_path}")
            shutil.copy2(item, target_path)

if __name__ == "__main__":
    import sys
    # 设置源目录和目标目录
    source_directory = sys.argv[1]
    target_directory = sys.argv[2]
    
    print(os.path.abspath(source_directory))
    print("=>")
    print(os.path.abspath(target_directory))
    copy_newer_files(source_directory, target_directory)
    print("拷贝完成！")