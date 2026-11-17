# -*- coding: utf-8 -*-
"""第 11 批设计案同步：102503「无尘禁土」换火焰光环特效（2026-11-17）。

用户口径
────────
「大威天芦 的无尘禁土 使用【大威天芦_火焰光环】特效，并按照统一的格式制作预制，
  修改同步相关的配置源表和设计案」

落地分两半：
  · 预制三件套 —— `tools/build_dawtianlu_flame_aura_fx.py`（散图 → atlas + anim + prefab）；
  · 造型接线 —— `ZCSelfAuraFx.SELF_AURA_FX_BY_UNIT['68025']`（`self_aura` 在配表里没有造型列，
    详见 `ZCSelfAuraFx` 文件头）。

本脚本只改设计案这一行：
  · O 列（表现描述）：换成火焰光环的观感与节奏；
  · P 列（落地口径）：把造型路径 / 尺寸 / 生成器写进去，并**顺手订正两处历史笔误** ——
    `auraRadius` 写的是 60（实际早已改成 200）、`unlockHeroLevel` 写的是 9/18/24（实际 9/18/27）。
    P 列的其余部分（运行期链路说明）逐字保留，只做局部替换。

幂等：所有格子重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_skill_design2_flame_aura.py
"""
import html
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

ROW = 125
CHAIN = '102503'

VISUAL = (
    '使用【大威天芦_火焰光环】特效：一圈**地面椭圆环** + 环上竖起的火焰墙 + 环下溅出的火星，'
    '30 帧 / 12fps 循环（2.5s）。\n'
    '环的外径就是技能判定范围，环中心扣在施法者脚下，持续期间随本体移动；'
    '区域到期时表现整块摘掉，不会停在最后一帧上僵住。\n'
    '【本轮改动】原为【持续光环伤害效果】那根竖直光柱（循环第 8~25 帧）。'
)

#  P 列里要原地替换的两处历史笔误（不是本批的改动，但同一条口径写错会误导核对）。
P_FIXES = [
    ('"auraRadius":60', '"auraRadius":200'),
    ('unlockHeroLevel 9/18/24', 'unlockHeroLevel 9/18/27'),
]

P_VISUAL_OLD = (
    '特效 units/projectiles/持续光环伤害效果/持续光环伤害效果'
    '（18 帧循环 1.5s，画布 256×390、_lscale 0.58 ⇒ 屏上宽 ≈92px，与 auraRadius 60 的判定直径对齐）。'
)

P_VISUAL_NEW = (
    '特效 units/projectiles/大威天芦_火焰光环/大威天芦_火焰光环'
    '（30 帧 / sample 12 / Loop 2.5s，画布 340×294、根 `_lscale` 0.904412 ⇒ 屏上宽 '
    '307.5px = auraRadius 200 的判定直径）。'
    '🔴 地面椭圆环的外径被生成器钉成**画布宽**，所以「画布宽 × `_lscale` = 判定直径」是一条可读的等式；'
    '根 `_lpos` 把环中心钉到施法者脚点（横向只剩取整误差，纵向 +71.9px 补偿火焰墙全在环上方）。\n'
    '🔴 造型**没有配置列**：`self_aura` 是行为技能，`pvpSkill` 按 unitId 挂的是普攻行（68025 = 30858），'
    '一行只服务一个「出手」，装不下第三条主动技能的造型；`skillParamJson` 又只有数值槽。'
    '所以路径落在代码表 `ZCSelfAuraFx.SELF_AURA_FX_BY_UNIT[\'68025\']`，'
    '并由 `ZCVisualResourcePlan` 按「本局有没有这个单位的 `self_aura` 计划」收进加载清单'
    '（漏收 = 技能照常扣血、屏幕一次都不亮且不报错）。\n'
    '生成器 = `tools/build_dawtianlu_flame_aura_fx.py`（幂等，换美术后重跑即可；'
    '**改半径也重跑它**，不要在 `ZCCombatEffectScale` 里给这条路径加宿主倍率）。'
)

CELLS = {
    'O': VISUAL,
}


def shared_strings():
    """共享字符串表（`t="s"` 单元格的 `<v>` 是索引，不解析它就等于在读编号）。

    🔴 必须 `html.unescape`：里面存的是 `&quot;auraRadius&quot;`，
    不还原的话 `'"auraRadius":60'` 永远匹配不上（这一错当初排查了半天）。
    """
    text = read_zip_rows(XLSX, 'xl/sharedStrings.xml')
    return [html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S)))
            for item in re.findall(r'<si>(.*?)</si>', text, re.S)]


def cell_text(xml, ref, strings):
    """读一个单元格的当前文本（`t="s"` 要再查一次共享字符串表）。"""
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    inner = match.group(1) or ''
    if 't="s"' in match.group(0):
        index = re.search(r'<v>(\d+)</v>', inner)
        return strings[int(index.group(1))] if index else ''
    for pattern in (r'<t[^>]*>(.*?)</t>', r'<is>.*?<t[^>]*>(.*?)</t>', r'<v>(.*?)</v>'):
        hit = re.search(pattern, inner, re.S)
        if hit:
            return html.unescape(hit.group(1))
    return ''


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    strings = shared_strings()
    actual = cell_text(xml, 'G%d' % ROW, strings)
    if actual != CHAIN:
        raise SystemExit('[fail] 行 %d 的 G 列是 %r，不是 %s（设计案插行了？）' % (ROW, actual, CHAIN))

    writes = dict(CELLS)

    #  P 列：局部替换，其余逐字保留。任何一处找不到原文就报错，别静默跳过。
    current_p = cell_text(xml, 'P%d' % ROW, strings) or ''
    if len(current_p) < 200:
        raise SystemExit('[fail] P%d 只读到 %d 个字符，共享字符串没解对' % (ROW, len(current_p)))
    next_p = current_p
    for old, new in P_FIXES + [(P_VISUAL_OLD, P_VISUAL_NEW)]:
        if new in next_p:
            continue
        if old not in next_p:
            raise SystemExit('[fail] P%d 里找不到这段原文，先核对设计案：%r' % (ROW, old[:40]))
        next_p = next_p.replace(old, new, 1)
    if next_p != current_p:
        writes['P'] = next_p

    changed = 0
    for column, value in sorted(writes.items()):
        ref = '%s%d' % (column, ROW)
        if cell_text(xml, ref, strings) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed += 1
    if not changed:
        print('[skip] 设计案 102503 已是目标文本')
        return

    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案 102503 写入 %d 格（O 表现 + P 落地口径）；备份 → %s' % (changed, backup))


if __name__ == '__main__':
    main()
