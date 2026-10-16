#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复装备图标：按品质对应不同的装备图
装备 ID 规律：
  14X Y Z Z
  X = 阶数（1-20）
  Y = 品质（1=精良, 2=优秀, 3=史诗）
"""

import os
import json
import shutil

PROJECT_ROOT = r"D:\City1001\Demo3.8"
EQUIP_ICON_SRC = r"D:\City1001\zarts\art\UIProject\trunk\UIIcon\assets\图标\装备"
EQUIP_ICON_DST = os.path.join(PROJECT_ROOT, "assets", "resources", "icons", "equip")
CONFIG_DIR = os.path.join(PROJECT_ROOT, "assets", "resources", "config")

# 品质对应图标（用武器作为代表性装备图标）
# 品质1=精良(蓝) -> wq1
# 品质2=优秀(紫) -> wq2
# 品质3=史诗(橙) -> wq3
# 品质4=传说(红) -> wq4
QUALITY_ICON_MAP = {
    1: "wq1.png",
    2: "wq2.png",
    3: "wq3.png",
    4: "wq4.png",
    5: "wq4.png",
}

def main():
    print("=" * 60)
    print("修复装备图标：按品质对应")
    print("=" * 60)

    # 读取物品配置
    with open(os.path.join(CONFIG_DIR, "item.json"), encoding="utf-8") as f:
        items = json.load(f)

    # 读取 item_id_icon 映射
    with open(os.path.join(CONFIG_DIR, "item_id_icon.json"), encoding="utf-8") as f:
        item_id_icon = json.load(f)

    # 找出所有 14xxx 装备物品
    equip_items = []
    for item_id_str, data in items.items():
        if item_id_str.startswith("14") and len(item_id_str) == 5:
            quality_digit = int(item_id_str[3])  # 第四位是品质
            equip_items.append((int(item_id_str), quality_digit, data["name"]))

    print(f"装备物品: {len(equip_items)} 个")

    # 按品质分组统计
    quality_counts = {}
    for _, q, _ in equip_items:
        quality_counts[q] = quality_counts.get(q, 0) + 1
    print(f"品质分布: {quality_counts}")

    # 按品质复制对应图标
    updated = 0
    for item_id, quality, name in equip_items:
        icon_file = QUALITY_ICON_MAP.get(quality, "wq1.png")
        src_path = os.path.join(EQUIP_ICON_SRC, icon_file)
        dst_path = os.path.join(EQUIP_ICON_DST, f"{item_id}.png")

        if not os.path.exists(src_path):
            print(f"  [警告] 源图标不存在: {src_path}")
            continue

        shutil.copy2(src_path, dst_path)
        updated += 1

    print(f"\n更新完成: {updated} 个装备图标")

    # 同步更新 item_id_icon.json（路径不变，还是 icons/equip/{itemId}）
    # 不需要改，因为路径没变，只是内容变了

    print("\n" + "=" * 60)
    print("完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()
