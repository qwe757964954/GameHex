# -*- coding: utf-8 -*-
"""设计案同步（2026-11-19 第 23 批）：闪电链换【闪电链水墨风】+ 雷蕉普攻资源口径。

用户口径（附两张资源面板截图）：
> 闪电链特效更换成新特效【闪电链水墨风】，制作格式一致的预制，同步相关的配置源表，
> 雷蕉 普通攻击子弹 使用的是【雷弹攻击】预制体，命中后播放的是雷弹命中，修改后同步配置源表和设计案

改三行（G 列守着技能 id，防串行）：

| 行 | 技能 | 改什么 |
| --- | --- | --- |
| 110 | 102203 闪电链 | O 列 `闪电链-电弧` → `闪电链水墨风` + 补贴合口径；P 列 ⚙ 预制段换路径 / 尺寸，追加换素材说明 |
| 107 | 30231 雷蕉普攻 | O 列删「（带白色三角形拖尾）」；P 列追加实际落地资源口径 |
| 77  | 30231 磁电菇普攻 | 与 107 同一条源表行、同一份 prefab，拖尾一删两家都没了 ⇒ 一起改 |

配表侧：`PVP-技能.xlsx` 第 17 行（skillId 30231）的 `effectPrefabPath` / `impactEffectPrefabPath`
本来就写着 `units/projectiles/雷弹攻击/雷弹攻击` / `units/projectiles/雷弹命中/雷弹命中`，
与 remoteRef、client json 三份一致 —— **本次零改动**，脚本末尾会再核一遍并打印。
闪电链在 J 表 / K 表里没有造型列（行为技能的造型只落在 `ZCChainLightningFx` 的代码常量）。

幂等：目标文本已含对应批次标记就跳过。

用法：python tools/config/patch_skill_design2_chain_ink.py
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

ROW_CHAIN = 110
ROW_LEIDEN = 107
ROW_MAGNET = 77

# ── 110 行（102203 闪电链）──────────────────────────────────────────────
O_CHAIN_OLD = '【闪电链-电弧】'
O_CHAIN_NEW = '【闪电链水墨风】'
O_CHAIN_TAIL_OLD = '逐跳降透明度保留（首段 1.0，每段 −0.12，封底 0.4）。'
O_CHAIN_TAIL_NEW = (
    '逐跳降透明度保留（首段 1.0，每段 −0.12，封底 0.4）。'
    '贴图两端都是**实心笔触**（水墨风 frame_01，原图内容 2..281 / rect 2..282）⇒ 段与段首尾相接时'
    '不会再出现「亮团接细丝」的跳变；每段额外留 **2 px 重叠**吃掉笔锋那行淡像素，接缝处不许留缝。'
)

P_CHAIN_OLD = (
    '⚙ 预制换成 `units/projectiles/闪电链_电弧/闪电链_电弧`（单帧静态 attack_05，'
    'UITransform 141×267 × 根 `_lscale` 0.333333 ⇒ 屏上 47×89，根 `_lpos.y = 44.5` 把底端钉在节点原点）；'
    '常量在 `ZCChainLightningFx`：单段屏上 89 px ÷ 2.5625 = **世界 34.7 px**，'
    '段数 = `ceil(段距 / 34.7)`，方向恒 `-90°`。'
)
P_CHAIN_NEW = (
    '⚙ 预制 = `units/projectiles/闪电链水墨风/闪电链水墨风`（2026-11-19 第 23 批换素材：'
    '单帧静态 frame_01，UITransform 103×280 × 根 `_lscale` 0.333333 ⇒ 屏上 34.33×93.33，'
    '根 `_lpos.y = 46.6666` 把底端钉在节点原点）；常量在 `ZCChainLightningFx`：'
    '单段屏上 93.333 px ÷ 2.5625 = **世界 36.43 px**，段数 = `ceil(段距 / 36.43)`，方向恒 `-90°`。'
)
P_CHAIN_APPEND = (
    '\n【2026-11-19 换素材 + 段间贴合】用户口径「闪电链特效更换成新特效【闪电链水墨风】，'
    '制作格式一致的预制」「闪电链的预制应该贴合，不能留有缝隙」。落地：'
    '① 预制从 `闪电链_电弧`（雷道人武将_闪电_attack_05，落雷造型：一端亮团、一端散成细丝）'
    '换成 `闪电链水墨风`（美术给 frame_01~03，只取 **frame_01** 做单帧静态 —— 整条链是同一 prefab '
    '复制 n 份，多份 `cc.Animation` 各播各的帧一定对不上，这是第 17 批踩过的坑）；'
    '结构与旧预制逐字段一致（7 个对象、无 Animation、`_sizeMode:0`、`_isTrimmedMode=false`）。'
    '② 缝隙病根**不在摆位**：旧贴图在锚点那一侧有 11 屏上 px 全透明（原图 216×297，闪电只画到 raw 264，'
    'rect 底边却在 297）⇒ 每段尾巴固定空段长的 12%。换图后实测只剩 0.33 px，常量取 1。'
    '③ `zcChainArcPieceLayout` 新增 `offsetX/offsetY`：节点沿长轴后退这 1 px（有像素的那截才落在段起点），'
    '`stretch` 的除数从 rect 全长换成**可见长度**（92.33 屏上）并留 2 px 重叠 ⇒ '
    '每段内容正好盖到下一段起点、末段咬住目标中心；`ZCAttackResolutionSystem.pushChainArc` 与 '
    '`ZCGameModel.syncFollowingCombatEvents` **两处**都要加这个偏移（漏一处 = 只在首次施放贴合、跟随又裂开）。'
    '④ 段数仍按 rect 全长 93.33 算（少了是真的没东西可画），内容长度由 `stretch` 补（满段 ≈1.03，只动长轴）。'
    '⑤ 结算 / 配表零改动（判据、跳数、递减、终跳必暴、`chainReadyAt` 全不动）。'
)

# ── 107 / 77 行（30231 普攻，两张卡共用同一条源表行与同一份 prefab）────────
O_ATTACK_OLD = '（带白色三角形拖尾）'
O_ATTACK_TAIL_OLD = '雷弹命中'
P_ATTACK_APPEND = (
    '\n【2026-11-19 普攻资源口径】弹体 = `units/projectiles/雷弹攻击/雷弹攻击`（电池 120×81，'
    'prefab 根 `_lscale` 0.78；宿主倍率 0.35 ⇒ 屏上 32.8×22.1），命中 = `units/projectiles/雷弹命中/雷弹命中`；'
    '表侧就是 `pvpSkill` 30231 的 `effectPrefabPath` / `impactEffectPrefabPath`'
    '（`PVP-技能.xlsx` 第 17 行，与 remoteRef、client json 三份一致）。'
    '2026-11-11 那条「白色三角形拖尾」已删（用户看实录截图问「为什么会有单个子弹形式的闪电」—— '
    '就是拖尾把电池弹拉成了电球）；`ZCMissileTrail` 现在只剩镭射飞龙的导弹一条。'
    '68016 磁电菇与本卡共用 30231 / 同一份 prefab，两家一起变。'
)


def shared_strings():
    text = read_zip_rows(XLSX, 'xl/sharedStrings.xml')
    out = []
    for item in re.findall(r'<si>(.*?)</si>', text, re.S):
        out.append(html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S))))
    return out


def cell_text(xml, ref, strings):
    match = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not match:
        return ''
    attrs, inner = match.group(1), match.group(2)
    if 't="s"' in attrs:
        index = re.search(r'<v>(\d+)</v>', inner)
        return strings[int(index.group(1))] if index else ''
    hit = re.search(r'<t[^>]*>(.*?)</t>', inner, re.S)
    if hit:
        return html.unescape(hit.group(1))
    value = re.search(r'<v>(.*?)</v>', inner, re.S)
    return html.unescape(value.group(1)) if value else ''


def require(xml, ref, strings, expected):
    actual = cell_text(xml, ref, strings)
    if actual != expected:
        raise SystemExit('[fail] %s 是 %r，不是 %s（先人工核对，别串行）' % (ref, actual, expected))


def patch_chain(xml, strings, writes):
    """110 行：O 列换素材名 + P 列换预制段并追加说明。"""
    require(xml, 'G%d' % ROW_CHAIN, strings, '102203')

    current_o = cell_text(xml, 'O%d' % ROW_CHAIN, strings)
    if '闪电链水墨风' not in current_o:
        if O_CHAIN_OLD not in current_o:
            raise SystemExit('[fail] O%d 里找不到 %r，先人工核对' % (ROW_CHAIN, O_CHAIN_OLD))
        new_o = current_o.replace(O_CHAIN_OLD, O_CHAIN_NEW)
        if O_CHAIN_TAIL_OLD in new_o:
            new_o = new_o.replace(O_CHAIN_TAIL_OLD, O_CHAIN_TAIL_NEW)
        writes['O%d' % ROW_CHAIN] = new_o

    current_p = cell_text(xml, 'P%d' % ROW_CHAIN, strings)
    if '换素材 + 段间贴合' not in current_p:
        if P_CHAIN_OLD not in current_p:
            raise SystemExit('[fail] P%d 里找不到旧的预制段，先人工核对：%r' % (ROW_CHAIN, current_p[:80]))
        writes['P%d' % ROW_CHAIN] = current_p.replace(P_CHAIN_OLD, P_CHAIN_NEW) + P_CHAIN_APPEND


def patch_attack(xml, strings, writes, row):
    """107 / 77 行：O 列删拖尾字样（只删一次，改成不带尾巴的写法）+ P 列追加资源口径。"""
    current_o = cell_text(xml, 'O%d' % row, strings)
    if O_ATTACK_OLD in current_o:
        writes['O%d' % row] = current_o.replace(O_ATTACK_OLD, '')
    elif '拖尾' in current_o:
        raise SystemExit('[fail] O%d 仍提到拖尾但形态不同，先人工核对：%r' % (row, current_o))

    current_p = cell_text(xml, 'P%d' % row, strings)
    if '普攻资源口径' not in current_p:
        writes['P%d' % row] = current_p + P_ATTACK_APPEND


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    strings = shared_strings()
    writes = {}

    require(xml, 'G%d' % ROW_LEIDEN, strings, '30231')
    require(xml, 'G%d' % ROW_MAGNET, strings, '30231')
    patch_chain(xml, strings, writes)
    patch_attack(xml, strings, writes, ROW_LEIDEN)
    patch_attack(xml, strings, writes, ROW_MAGNET)

    changed = []
    for ref, value in writes.items():
        if cell_text(xml, ref, strings) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed.append(ref)
    if not changed:
        print('[skip] 设计案三行都已是目标文本')
    else:
        backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
        print('[ok] 设计案写入 %d 格：%s；备份 → %s' % (len(changed), ', '.join(changed), backup))

    #  配表侧只做核对（源表第 17 行本来就写着雷弹两件套，本次不改）。
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from xlsx_read import read_sheet
    skill_xlsx = 'D:/Alan/Project/POW/doc/塔防数据配置/PVP-技能.xlsx'
    _, rows = read_sheet(skill_xlsx, 0)
    for rn, vals in rows:
        if len(vals) > 9 and str(vals[0]) == '30231':
            print('[check] PVP-技能.xlsx 第 %d 行 30231：effectPrefabPath=%r impactEffectPrefabPath=%r'
                  % (rn, vals[9], vals[20] if len(vals) > 20 else ''))
            break


if __name__ == '__main__':
    main()
