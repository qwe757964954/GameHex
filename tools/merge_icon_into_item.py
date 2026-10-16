#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把图标路径合并进 item.json，去掉单独的映射文件"""

import json

CONFIG_DIR = r"D:\City1001\Demo3.8\assets\resources\config"

# 读取两个文件
with open(CONFIG_DIR + r"\item.json", encoding="utf-8") as f:
    items = json.load(f)

with open(CONFIG_DIR + r"\item_id_icon.json", encoding="utf-8") as f:
    icon_map = json.load(f)

# 合并：给每个物品加 iconPath 字段
updated = 0
for item_id_str, item_data in items.items():
    if item_id_str in icon_map:
        item_data["iconPath"] = icon_map[item_id_str]
        updated += 1

# 保存合并后的 item.json
with open(CONFIG_DIR + r"\item.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print(f"合并完成: {updated} 个物品已添加 iconPath 字段")
print()
print("示例:")
for iid in ["10001", "14011", "14021", "14031"]:
    if iid in items:
        name = items[iid]["name"]
        path = items[iid]["iconPath"]
        print(f"  {iid}: {name} -> {path}")
