#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
优化图标存储：删除重复的 ID 命名文件，保留一份原图
策略：
1. 删除所有按 {itemId}.png 命名的重复文件
2. 保留按内容命名的原始文件（一张图一份）
3. 修正 item_id_icon.json：itemId -> 实际图标路径
"""

import os
import json
import shutil

PROJECT_ROOT = r"D:\City1001\Demo3.8"
ICONS_DIR = os.path.join(PROJECT_ROOT, "assets", "resources", "icons")
CONFIG_DIR = os.path.join(PROJECT_ROOT, "assets", "resources", "config")


def main():
    print("=" * 60)
    print("优化图标存储：去除重复")
    print("=" * 60)

    # 1. 统计当前状态
    all_pngs = []
    for root, dirs, files in os.walk(ICONS_DIR):
        for f in files:
            if f.endswith(".png"):
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, ICONS_DIR)
                all_pngs.append({
                    "filename": f,
                    "path": full_path,
                    "rel_path": rel_path.replace(os.sep, "/"),
                    "size": os.path.getsize(full_path),
                    "is_id_named": f.replace(".png", "").isdigit(),
                })

    total_size = sum(p["size"] for p in all_pngs)
    print(f"优化前: {len(all_pngs)} 个文件, {total_size/1024:.1f} KB")

    # 2. 删除按 ID 命名的重复文件
    id_named = [p for p in all_pngs if p["is_id_named"]]
    content_named = [p for p in all_pngs if not p["is_id_named"]]

    print(f"\n按ID命名(重复): {len(id_named)} 个")
    print(f"按内容命名(原始): {len(content_named)} 个")

    deleted = 0
    for p in id_named:
        try:
            os.remove(p["path"])
            # 同时删除 .meta 文件
            meta_path = p["path"] + ".meta"
            if os.path.exists(meta_path):
                os.remove(meta_path)
            deleted += 1
        except Exception as e:
            print(f"  [错误] 删除失败: {p['filename']}, {e}")

    print(f"\n删除重复文件: {deleted} 个")

    # 3. 修正 item_id_icon.json
    # 重新建立映射：itemId -> 对应的内容命名图标路径
    with open(os.path.join(CONFIG_DIR, "item.json"), encoding="utf-8") as f:
        items = json.load(f)

    with open(os.path.join(CONFIG_DIR, "icon_map.json"), encoding="utf-8") as f:
        icon_map = json.load(f)

    # 建立 内容命名文件名 -> 相对路径 的映射
    # 从 content_named 里找
    content_files = {}
    for p in content_named:
        filename = p["filename"].replace(".png", "")
        content_files[filename] = p["rel_path"]

    # 重新生成 itemId -> 图标路径
    item_id_to_icon = {}
    for item_id_str, item_data in items.items():
        icon_key = item_data.get("icon", "")
        if not icon_key:
            continue

        # 从 icon_map 找 resources 路径
        if icon_key in icon_map:
            res_path = icon_map[icon_key].replace("ui/icons/", "icons/")
            item_id_to_icon[item_id_str] = res_path

    # 保存新的映射表
    output_path = os.path.join(CONFIG_DIR, "item_id_icon.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(item_id_to_icon, f, ensure_ascii=False, indent=2)

    print(f"\n更新映射表: {len(item_id_to_icon)} 条 -> {output_path}")

    # 4. 统计优化后状态
    remaining_pngs = []
    for root, dirs, files in os.walk(ICONS_DIR):
        for f in files:
            if f.endswith(".png"):
                remaining_pngs.append(os.path.join(root, f))

    new_total_size = sum(os.path.getsize(p) for p in remaining_pngs)

    print("\n" + "=" * 60)
    print("优化完成！")
    print(f"  优化前: {len(all_pngs)} 个文件, {total_size/1024:.1f} KB")
    print(f"  优化后: {len(remaining_pngs)} 个文件, {new_total_size/1024:.1f} KB")
    print(f"  节省: {(total_size - new_total_size)/1024:.1f} KB ({(1 - new_total_size/total_size)*100:.1f}%)")
    print("=" * 60)


if __name__ == "__main__":
    main()
