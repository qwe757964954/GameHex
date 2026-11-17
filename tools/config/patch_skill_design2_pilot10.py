# -*- coding: utf-8 -*-
"""第 10 批设计案同步：102401「裂变共鸣」→「贯穿滋养」，机制整条换掉。

用户口径（2026-11-17）
──────────────────────
「102401 的技能机制修改，子弹穿过己方单位会回复生命值 3/4/5% 的生命值，一颗子弹最多给
  3/4/5 个己方单位回复，**所有卡牌都移除普通攻击减少冷却时间的这个机制**，修改后同步相关的
  配置，并且修改技能名字」

由此产生两个动作，不是一个：
  ① 102401 本行换机制（穿行治疗 + 攻速 + 混搭尾），并改名 —— 「裂变共鸣」的语义是「CD 共鸣」，
     跟新机制毫无关系；按「只有机制完全一样的才同名 / 机制不同一律另名」必须另起名。
  ② `cdReduceOnHit` 这条车道**全卡下线** —— 表里只有 102401 三行写过它，所以下线等价于
     「本行 P 列不再提它 + 代码四处登记 + 全部 JSON 里的这个 statId 一起拆」。
     详见 `tools/config/patch_ally_pierce_batch10.js` 与研发档案第 10 批小节。

顺手同步的一格
──────────────
第 9 页「卡牌描述与落地」里 68024 那句卡级描述还写着「裂变共鸣命中回退其他主动的冷却」。
它是 `PVP-卡牌.xlsx / 卡牌配置 I 列` 与两份 `pvpCard.json` 的**唯一上游**（配套脚本
`patch_card_description.py` / `.js` 都从这一页读），所以必须在这里先改，再跑那两个脚本回填。

幂等：所有格子重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_skill_design2_pilot10.py
"""
import html
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MAIN_MEMBER = 'xl/worksheets/sheet1.xml'
CARD_MEMBER = 'xl/worksheets/sheet9.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

ROW = 118
CHAIN = '102401'

CARD_DESC_OLD = '控制法师：裂变共鸣命中回退其他主动的冷却，冰山陨落大范围冻结。'
CARD_DESC_NEW = '控制法师：贯穿滋养让普攻子弹穿过己方单位回血，冰山陨落大范围冻结。'

PLAN = (
    'behaviorKey = **skill_params**（主链三空：`statId` / `operation` / `value` 全为 null，'
    '属性全部走子链槽位与 `mix.*`）。\n'
    'skillParamJson：`allyPierceHealPct` = 0.03 / 0.04 / 0.05（单次回复比例，按**被治疗单位'
    '自己的最大生命**算，不是施法者的）；`allyPierceMaxCount` = 3 / 4 / 5'
    '（🔴 **每颗弹道**的额度，不是每张卡 —— 多发弹幕的每一颗各算各的，所以出手时就拷到弹道的 '
    '`allyHealLeft` 上，别每帧回查参数，否则会变成「整轮齐射共享 5 次」）；'
    '`mix.attack.addRate` = 0.35、`mix.attackRange.addRate` = 0.35。\n'
    '子链 192401 `attackSpeed` addRate = 20 / 22 / 24。\n'
    '🔴 友军通道与 `hit` 互斥：不参与碰撞、**不消耗 `remainingPierces`**、**不扣 `baseDamage`**，'
    '只是「被路过」一次；排除施法者本人（否则每发白送自愈）；同一颗弹道对同一个单位只回一次'
    '（`allyHealIds` 去重）；额度归零立刻停。\n'
    '🔴 治疗走 `ZCStatusResolutionSystem.healUnit`：封顶 `maxHp`、死亡不生效、溢出丢弃、'
    '不吃治疗加成、不碰护盾。\n'
    '⚠️ 原落地为 `unit 域 cdReduceOnHit add = 0.4 / 0.5 / 0.6`（配 `cdReducePaidAt` 同帧去重）。'
    '该 statId 已按口径**全卡下线**：`ZCStatId` / `STAT_IDS` / `UNIT_STAT_IDS` / `STAT_TO_PATCH` '
    '四处登记、`ZCUnitStatPatch` 字段、`ZCSnapshotCodec` 白名单、'
    '`ZCAttackResolutionSystem.reduceCooldownsOnHit` 消费点、`ZC_CD_REDUCE_READY_KEYS` 常量'
    '与两份 JSON 全表已一并拆除 —— 别再照着旧笔记把它建回来'
)

MECH = (
    '法师高级被动。**第一条机制**：普攻子弹在飞行途中**穿过己方单位**时，为该单位回复其最大生命的'
    '固定百分比；同一颗子弹对同一个单位只回一次，且每颗子弹有「最多 N 个」的额度。'
    '**第二条机制**：同条再挂一条攻速 —— 攻速越高，一轮里穿过的友军批次越多，'
    '回血与攻速因此是同一份收益的两面，而不是两条不相干的属性。\n'
    '站位上它是「把法师的射程变成团队的续航带」：法师站后排、子弹飞得远，'
    '路过前排坦克的次数最多，所以这条被动的实际收益与前排厚度正相关。\n'
    '🔴 与「命中回退冷却」彻底分家：2026-11-17 按口径把 `cdReduceOnHit` 全卡下线，'
    '本卡不再影响任何主动技能的节拍，改为在续航维度补齐金卡位。\n'
    '【本轮改动】原名「裂变共鸣」（语义是 CD 共鸣），机制整体换成穿行治疗后按'
    '「只有机制一样的才同名、机制不同一律另名」改名为「贯穿滋养」。'
)

VISUAL = (
    '【新增】子弹穿过友军时，在友军身上闪一圈淡青色治疗光环 + 一段上浮的绿色治疗飘字'
    '（沿用现有 `healUnit` 的飘字档）；子弹本身**不减速、不偏转、不中断**。\n'
    '🔴 这是「路过」不是「命中」：不做击退、不做顿帧、不播受击动作、不弹伤害数字。\n'
    '额度用完（每颗弹道 3/4/5 个）后，后续穿过的友军不再有任何反馈 —— 表现层不要再补提示，'
    '否则玩家会以为「明明路过却没回血是 bug」'
)

CELLS = {
    'H': '贯穿滋养',
    'K': 'L1（兵种 3 级）：普攻子弹穿过己方单位时，为其回复 3% 最大生命'
         '（每颗子弹最多回复 3 个己方单位）；攻击速度提高 20%；'
         '攻击提高 35%，攻击范围提高 35%',
    'L': 'L2（兵种 10 级）：回复比例提高到 4%，每颗子弹最多回复 4 个己方单位；'
         '攻击速度提高到 22%',
    'M': 'L3（兵种 22 级）：回复比例提高到 5%，每颗子弹最多回复 5 个己方单位；'
         '攻击速度提高到 24%',
    'N': MECH,
    'O': VISUAL,
    'P': PLAN,
    'S': '【已实现】',
}


def cell_text(xml, ref):
    """读一个单元格的当前文本（共享字符串只回索引，够用于幂等比较，不解析正文）。"""
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    inner = match.group(1) or ''
    for pattern in (r'<t[^>]*>(.*?)</t>', r'<is>.*?<t[^>]*>(.*?)</t>', r'<v>(.*?)</v>'):
        hit = re.search(pattern, inner, re.S)
        if hit:
            return html.unescape(hit.group(1))
    return ''


def main():
    # ── 一、设计案主表 row 118 ──
    xml = read_zip_rows(XLSX, MAIN_MEMBER)
    actual = cell_text(xml, 'G%d' % ROW)
    if actual != CHAIN:
        raise SystemExit('[fail] 行 %d 的 G 列是 %r，不是 %s（设计案插行了？）' % (ROW, actual, CHAIN))

    changed = 0
    for column, value in sorted(CELLS.items()):
        ref = '%s%d' % (column, ROW)
        if cell_text(xml, ref) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed += 1
    if changed:
        backup = write_zip(XLSX, MAIN_MEMBER, xml, BACKUP_DIR)
        print('[ok] 设计案 102401 写入 %d 格；备份 → %s' % (changed, backup))
    else:
        print('[skip] 设计案 102401 已是目标文本')

    # ── 二、第 9 页「卡牌描述与落地」68024 那句 ──
    card = read_zip_rows(XLSX, CARD_MEMBER)
    if CARD_DESC_NEW in card:
        print('[skip] 卡牌描述页已是新文案')
        return
    if CARD_DESC_OLD not in card:
        #  宁可报错也不要静默跳过：这句是 PVP-卡牌 I 列与两份 pvpCard.json 的唯一上游。
        raise SystemExit('[fail] 卡牌描述页里找不到旧文案，先核对第 9 页再跑')
    card = card.replace(CARD_DESC_OLD, CARD_DESC_NEW, 1)
    backup = write_zip(XLSX, CARD_MEMBER, card, BACKUP_DIR)
    print('[ok] 卡牌描述页 68024 换文案；备份 → %s' % backup)


if __name__ == '__main__':
    main()
