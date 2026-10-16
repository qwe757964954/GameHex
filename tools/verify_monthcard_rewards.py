#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证月卡奖励物品的图标是否存在"""

import json
import os

with open(r"D:\City1001\Demo3.8\assets\resources\config\item.json", encoding="utf-8") as f:
    items = json.load(f)

icons_root = r"D:\City1001\Demo3.8\assets\resources"

reward_ids = [10992, 10011, 10012]
for rid in reward_ids:
    key = str(rid)
    if key in items:
        data = items[key]
        icon_path = data.get("iconPath", "")
        full_path = os.path.join(icons_root, icon_path + ".png")
        exists = os.path.exists(full_path)
        name = data["name"]
        print(f"{rid} {name}: {icon_path} -> 文件存在: {exists}")
    else:
        print(f"{rid}: 未找到物品")
