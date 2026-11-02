# -*- coding: utf-8 -*-
"""在「技能设计案2.xlsx」的【本次改动说明】页尾追加火焰树妖这轮的五条口径与落点，
并顺手修掉第 55 行关于受击特效的两处事实错误（5 套 → 4 套、补明「按攻击方职业」）。

只追加/改写文本，不动样式结构；新行样式从既有正文行复制。
"""
from copy import copy

import openpyxl

PATH = r"D:\Alan\占城玩法\策划文档\战斗系统\技能设计案2.xlsx"
SHEET = "本次改动说明"

# 第 55 行（受击特效那段）原文与更正
FIX_ROW = 55
FIX_OLD_PREFIX = "units/effects/受击特效"
FIX_NEW = (
    "units/effects/受击特效 下**按攻击方职业**分了 4 套（射手/战士/法师/坦克，HIT_FX_TRAITS），"
    "伤害事件自动播、总时长固定 0.15s、取的是 `traits.attack` 而不是被打方的职业"
    "（2026-10-15 拍板）。「中毒受击」目录存在但**没被加载**，写进设计案会误导实现，"
    "要它必须先去 ZCGameLoader 的 HIT_FX_TRAITS 里加一项。"
)

HEADER = "火焰树妖（68003）· 2026-10-30 五条口径与落点"

ROWS = [
    ("口径 1 · 复用火船",
     "地面圈直接复用 火法师_火船（17 帧 / 1.417s）原地循环，不新建美术。"
     "落在 pvpSkill 30811 的 effectPrefabPath = units/projectiles/火法师_火船/火法师_火船。"),
    ("口径 2 · L3 也是 5 秒",
     "三级 durationSeconds 一律 5、waves 一律 5（每秒 1 波），只递进 damageRate 0.35/0.55/0.75。"
     "要单独改 L3 时长，得给 zone 参数加一条覆盖（约 3 行代码），当前不做。"),
    ("口径 3 · 累计 6 次普攻放 1 次",
     "pvpSkill 30711：empoweredEvery 10→6、empoweredSkillId 36181→30811（顺带解绑火法师武将技）。"
     "节拍由 ZCCombatSystem.consumeEmpoweredAttack 的 completedAttackCount % 6 决定，"
     "先自增再判定，所以是第 6/12/18… 次普攻。"),
    ("口径 4 · 受击特效按现有结构",
     "四组职业 × 固定 0.15s，按攻击方职业取；树妖是法师，所以每次命中播的都是「法师受击」。"
     "不新增燃烧火苗、不启用「中毒受击」——要做属新增美术 + 加载表。"),
    ("口径 5 · 点燃每 3 次普攻第 3 次",
     "新参数 pvpSkillPlan.skillParamJson.statusEveryNAttacks=3，配代码闸门 "
     "ZCAttackResolutionSystem.hitStatusOnBeat()（判 completedAttackCount % 3 === 0）。"
     "缺省 0 时恒为 true，既有表数据行为逐字不变。原稿的 20/30/40% 概率做不到："
     "applyHitStatus 无条件挂状态、没有掷骰。"),
    ("这轮改到的表与代码",
     "pvpSkill：新增 30811 + 30711 两个字段；pvpStatus：新增 burn_ignite_l1/l2/l3；"
     "pvpSkillPlan：新增 68003 共 12 行（4 技能 × 3 档）；"
     "ZCAttackResolutionSystem：新增 hitStatusOnBeat() 与区域分支补挂状态 2 处；"
     "用例 tests/zcds-attack-hit-status.test.ts（4 条，已全绿）。"
     "四张 Excel 源表（PVP-技能 / PVP-修改器适配 / J-技能表 / 本表）已同步。"),
    ("顺手修掉的两个坑",
     "① 第 6 次普攻是「灼热地带 + 点燃」同一拍，区域分支原本提前 return 会把点燃吞掉，"
     "已在 zone 分支补 applyHitStatus；② 区域半径 60 是**表值**，"
     "× combatDistanceScale(0.3) 才是 18 世界半径，改范围只改这一个数字，不用动代码。"),
    ("仍然待拍板",
     "点燃三档的兵种解锁等级：原表这一格是空的，暂按 9/18/24 插值写进 pvpSkillPlan。"
     "定了只要改 G 列（unlockHeroLevel），不涉及代码。"),
    ("已知不一致（这次没动）",
     "PVP-技能.xlsx 里 30711 的弹道速度还是 450，线上 json 是 500。这轮只同步了"
     "「强化次数 / 强化技能ID」两列，弹道速度留给策划确认后再对齐 —— 若按表导出，"
     "树妖火球会从 500 变成 450。"),
]


def main():
    wb = openpyxl.load_workbook(PATH)
    ws = wb[SHEET]

    # ① 更正受击特效那段
    if str(ws.cell(FIX_ROW, 2).value or "").startswith(FIX_OLD_PREFIX):
        ws.cell(FIX_ROW, 2).value = FIX_NEW
        print(f"[ok] 第 {FIX_ROW} 行：受击特效说明已更正（4 套 / 按攻击方职业）")
    else:
        raise RuntimeError(f"第 {FIX_ROW} 行不是预期的受击特效段落，拒绝改动")

    # ② 追加本轮口径
    last = max(cell.row for cell in ws["A"] if cell.value is not None)
    body_src, head_src = last, None
    for row in range(1, last + 1):
        if str(ws.cell(row, 1).value or "").startswith("表现描述怎么读"):
            head_src = row
            break
    if head_src is None:
        raise RuntimeError("找不到上一段小标题行，样式无从复制")

    start = last + 2
    for col in (1, 2):
        ws.cell(start, col)._style = copy(ws.cell(head_src, col)._style)
    ws.cell(start, 1).value = HEADER
    ws.row_dimensions[start].height = 26

    row = start
    for label, text in ROWS:
        row += 1
        for col in (1, 2):
            ws.cell(row, col)._style = copy(ws.cell(body_src, col)._style)
        ws.cell(row, 1).value = label
        ws.cell(row, 2).value = text
        ws.row_dimensions[row].height = 31 if len(text) <= 70 else (46.5 if len(text) <= 130 else 62)
        print(f"[ok] 第 {row} 行 {label}（{len(text)} 字）")

    # ③ 顺手把冻结窗格恢复成原设计（上一次 openpyxl 保存把它从 M9 掉成了 K2）
    main_sheet = wb["技能设计案 (2)"]
    if main_sheet.freeze_panes != "M9":
        main_sheet.freeze_panes = "M9"

    wb.save(PATH)
    print("已保存:", PATH)


if __name__ == "__main__":
    main()
