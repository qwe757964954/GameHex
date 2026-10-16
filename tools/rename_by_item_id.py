#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按物品 ID 重命名图标文件
输入：assets/resources/config/item.json + icon_map.json
输出：图标文件统一改名为 {itemId}.png，并更新配置
"""

import os
import json
import shutil

PROJECT_ROOT = r"D:\City1001\Demo3.8"
CONFIG_DIR = os.path.join(PROJECT_ROOT, "assets", "resources", "config")
ICONS_DIR = os.path.join(PROJECT_ROOT, "assets", "resources", "icons")


def main():
    print("=" * 60)
    print("按物品 ID 重命名图标")
    print("=" * 60)

    # 1. 读取配置
    with open(os.path.join(CONFIG_DIR, "item.json"), encoding="utf-8") as f:
        items = json.load(f)

    with open(os.path.join(CONFIG_DIR, "icon_map.json"), encoding="utf-8") as f:
        icon_map = json.load(f)

    print(f"物品总数: {len(items)}")
    print(f"图标映射: {len(icon_map)}")

    # 2. 建立 物品ID -> (分类, 原文件名) 的映射
    # 同时记录每个图标文件被哪些物品引用
    item_to_file = {}       # itemId -> 源文件绝对路径
    icon_ref_count = {}     # 图标key -> 被多少物品引用

    for item_id_str, item_data in items.items():
        icon_key = item_data.get("icon", "")
        if not icon_key or icon_key not in icon_map:
            continue

        res_path = icon_map[icon_key]  # e.g. "ui/icons/item/图标_图纸_帽子"
        # 修正路径：ui/icons/ -> icons/
        res_path = res_path.replace("ui/icons/", "icons/")
        # 源文件绝对路径
        abs_path = os.path.join(PROJECT_ROOT, "assets", "resources", res_path + ".png")

        if not os.path.exists(abs_path):
            print(f"  [警告] 文件不存在: {abs_path}")
            continue

        item_id = int(item_id_str)
        item_to_file[item_id] = abs_path
        icon_ref_count[icon_key] = icon_ref_count.get(icon_key, 0) + 1

    print(f"\n可重命名的物品: {len(item_to_file)}")

    # 3. 按物品 ID 复制/重命名
    # 策略：每个物品对应一个 {itemId}.png，放在原分类目录下
    renamed = 0
    skipped = 0

    for item_id, src_path in item_to_file.items():
        # 确定分类目录（从源路径提取）
        src_rel = os.path.relpath(src_path, ICONS_DIR)
        category = src_rel.split(os.sep)[0]

        dst_dir = os.path.join(ICONS_DIR, category)
        dst_path = os.path.join(dst_dir, f"{item_id}.png")

        # 如果目标已存在，跳过
        if os.path.exists(dst_path):
            skipped += 1
            continue

        shutil.copy2(src_path, dst_path)
        renamed += 1

    print(f"\n重命名完成: {renamed} 个新文件")
    print(f"已存在跳过: {skipped} 个")

    # 4. 删除旧的中文文件名文件（可选）
    # 先不删，保留以防万一

    # 5. 生成新的 item_id_icon.json: itemId -> 分类路径
    # 这样代码里直接 load("ui/icons/" + category + "/" + itemId)
    item_id_to_path = {}
    for item_id, src_path in item_to_file.items():
        src_rel = os.path.relpath(src_path, ICONS_DIR)
        category = src_rel.split(os.sep)[0]
        item_id_to_path[str(item_id)] = f"icons/{category}/{item_id}"

    output_path = os.path.join(CONFIG_DIR, "item_id_icon.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(item_id_to_path, f, ensure_ascii=False, indent=2)

    print(f"\n新配置文件: {output_path}")
    print(f"  共 {len(item_id_to_path)} 条")

    # 6. 统计
    print("\n" + "=" * 60)
    print("完成！")
    print(f"  物品 ID 命名图标: {renamed} 个")
    print(f"  共享图标数: {len(icon_ref_count)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
