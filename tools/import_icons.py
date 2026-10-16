#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
物品表转 Cocos 配置
功能：
1. 解析 W-物品表.xlsx
2. 直接输出 item.json（icon 字段即为工程资源路径）
"""

import os
import json
import openpyxl

# ============ 路径配置 ============
CONFIG_DIR = r"D:\City1001\doc\塔防数据配置"
PROJECT_ROOT = r"D:\City1001\Demo3.8"
OUTPUT_CONFIG_DIR = os.path.join(PROJECT_ROOT, "assets", "resources", "config")


def parse_item_table():
    """读取 W-物品表.xlsx，返回物品列表"""
    items = []
    xlsx_path = os.path.join(CONFIG_DIR, "W-物品表.xlsx")
    
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["物品"]
    
    # 数据从第7行开始
    for row in ws.iter_rows(min_row=7, values_only=True):
        if not row or not row[0]:
            continue
        
        # 跳过非数字ID
        try:
            item_id = int(float(row[0]))
        except (ValueError, TypeError):
            continue
        
        def safe_str(v):
            return "" if v is None else str(v)
        
        def safe_int(v):
            if v is None:
                return 0
            try:
                return int(float(v))
            except (ValueError, TypeError):
                return 0
        
        item = {
            "id": item_id,
            "name": safe_str(row[1]),
            "desc": safe_str(row[2]),
            "key": safe_str(row[3]),
            "useType": safe_int(row[4]),
            "type": safe_int(row[5]),
            "quality": safe_int(row[6]),
            "icon": safe_str(row[7]),  # icon 字段直接就是工程资源路径
        }
        # iconPath = icon 字段（直接用，不再映射）
        item["iconPath"] = item["icon"]
        items.append(item)
    
    wb.close()
    print(f"[物品表] 共 {len(items)} 个物品")
    return items


def main():
    print("=" * 60)
    print("物品表转 Cocos 配置")
    print("=" * 60)
    
    # Step 1: 解析 W-物品表
    print("\n[Step 1] 解析 W-物品表.xlsx...")
    items = parse_item_table()
    
    # Step 2: 输出 item.json
    print("\n[Step 2] 生成 item.json...")
    os.makedirs(OUTPUT_CONFIG_DIR, exist_ok=True)
    
    item_json = {}
    for item in items:
        item_json[str(item["id"])] = item
    
    item_json_path = os.path.join(OUTPUT_CONFIG_DIR, "item.json")
    with open(item_json_path, "w", encoding="utf-8") as f:
        json.dump(item_json, f, ensure_ascii=False, indent=2)
    
    print(f"  item.json: {len(item_json)} 条 -> {item_json_path}")
    
    has_icon = sum(1 for v in item_json.values() if v.get("iconPath"))
    print(f"  其中有图标路径的: {has_icon} 个")
    
    print("\n" + "=" * 60)
    print("完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()
