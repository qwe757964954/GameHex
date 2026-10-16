#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同步 remoteRef/item.json 的 icon 字段为工程路径"""

import json

CONFIG_ITEM = r"D:\City1001\Demo3.8\assets\resources\config\item.json"
REMOTE_ITEM = r"D:\City1001\Demo3.8\assets\remoteRef\item.json"

# 读 resources/config/item.json（已经有 iconPath）
with open(CONFIG_ITEM, encoding="utf-8") as f:
    config_items = json.load(f)

# 读 remoteRef/item.json
with open(REMOTE_ITEM, encoding="utf-8") as f:
    remote_items = json.load(f)

# 建立 resId -> iconPath 映射
icon_path_by_id = {}
for id_str, data in config_items.items():
    icon_path_by_id[data["id"]] = data.get("iconPath", "")

# 更新 remote items 的 icon 字段
updated = 0
for item in remote_items:
    res_id = item["resId"]
    if res_id in icon_path_by_id and icon_path_by_id[res_id]:
        item["icon"] = icon_path_by_id[res_id]
        updated += 1

# 保存
with open(REMOTE_ITEM, "w", encoding="utf-8") as f:
    json.dump(remote_items, f, ensure_ascii=False, indent=2)

print(f"同步完成: {updated}/{len(remote_items)} 条")
print()
print("示例:")
for item in remote_items[:5]:
    res_id = item["resId"]
    icon = item["icon"]
    print(f"  {res_id}: {icon}")
