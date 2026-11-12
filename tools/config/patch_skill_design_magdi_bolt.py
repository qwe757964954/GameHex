# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 80 行（68016 磁电菇「五雷轰顶」101603）：补齐 L/M/N/O，并在 P 追加第四轮复盘。

背景（2026-11-12 用户口径）：
  「一起补，但是五雷轰顶的技能还是没有按照先后出现，视觉感官是同时出现的，审核修改后一并同步配置表」

这一行原来只有 K（L1 档描述）、P（落地参数）和 S（已实现），L/M/N/O 四格是空的 ——
「五雷轰顶」整段的机制口径只写在 K 里一行，翻案时读不出「几道 / 间隔多少 / 判伤在哪一帧 / 表现怎么错开」。

改四件事（zip 级手术，只动目标格）：
  1. L/M —— L2 / L3 两档（道数 4 / 5，倍率 200% / 250%，其余不变），与 K 同一句式；
  2. N —— 完整机制口径（落点怎么排、逐道 0.15s、单道半径 90、麻痹 30%·3s、判伤时刻表）；
  3. O —— 表现口径（序列帧 / 画布 / 烘焙缩放 / 屏上爆闪直径 / **到点才建节点** 的逐道出现）；
  4. P —— 追加「2026-11-12 第四轮」：数值一个没动，真因在**视图**（同一拍建节点 + 立刻 play clip
     ⇒ 五道雷同帧亮起），修法是 `ZCGameRenderWorld.renderEffectSystem` 过 `zcCombatEffectEntered` 闸。

数值逐条对着 `pvpSkillPlan` 94016031~33 抄，不在这里另写一套。
"""
import html
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

ROW = 80

#  三档：兵种解锁等级、道数、每道倍率（`unlockHeroLevel` 9 / 18 / 24，`boltCount` 3 / 4 / 5）
TIERS = [(1, 9, 3, '160%'), (2, 18, 4, '200%'), (3, 24, 5, '250%')]

N_TEXT = (
    '沿「施法者 → 目标」的方向连成一条直线落雷：第 1 道砸在锁定目标身上，'
    '其后每道沿同一方向再往后排 60 逻辑 px（屏上 46.1px），逐道出现间隔 0.15 秒。\r\n'
    '每道雷**独立**判定：半径 90 逻辑 px（屏上爆闪直径 138.4px）、每道 160%/200%/250% 攻击力、'
    '30% 概率使目标进入【麻痹】3 秒（只禁攻击、移速 −50%，软控 `pvpStatus.numb`）。\r\n'
    '出现 → 判伤前摇 0.15 秒（锚特效第 5 帧，见 O），所以第 i 道（i 从 0 起）的伤害落在 0.15 + 0.15×i 秒：'
    '0.15 / 0.30 / 0.45 / 0.60 / 0.75s。\r\n'
    '🔴 2026-11-12：「视觉上同时出现」**不是数值问题** —— 道数与间隔一直在配表里（K/P 都对），'
    '错在表现侧：五条 `area` 事件是同一拍推进 `combatEvents` 的，只靠 `startedAt` 排先后，'
    '而渲染世界原来「看到事件就建节点」⇒ 同帧全部亮起（复盘见 P 第四轮）。'
)

O_TEXT = (
    '使用 units/projectiles/磁电菇_劈雷技能/磁电菇_劈雷技能 序列帧（20 帧全取、sample=30、一次性 0.667s），'
    '画布 237×283、烘焙缩放 0.816372，地面接地点压在节点原点；'
    '屏上爆闪直径 138.4px = boltRadius 90 × 2 × 0.76875 ⇒ 看着多大就打多大。\r\n'
    '五道雷各推一条 `area` 表现事件，`startedAt` = 出手 + 0.15×i；'
    '视图**到点才建节点**（`ZCGameRenderWorld.renderEffectSystem` 先过 `zcCombatEffectEntered`），'
    '所以出现时刻逐道错开、每条动画各自从第 0 帧起播 —— 这条闸门就是「先后出现」的落点。\r\n'
    '不做逐道拖尾 / 屏幕震动：需求只要「看得出先后」，加料反而盖住 0.15s 的节奏。'
)

ROUND4 = (
    '\r\n2026-11-12 第四轮（用户口径「还是没有按照先后出现，视觉感官是同时出现的，审核修改后一并同步配置表」）：'
    '**参数一个都没改**（boltSpacing 60 / boltInterval 0.15 / boltDelay 0.15 保持），真因在视图：'
    '`castBoltLine` 是同一拍把 N 条 `area` 事件推进 `combatEvents` 的，先后只写在 `startedAt`（未来时刻）上；'
    '而 `ZCGameRenderWorld.renderEffectSystem` 原来对 `combatEvents` 无条件 `pool.acquire` + `initialize`，'
    '`initialize → mountVisual` 又立刻 `animation.stop()/play(默认 clip)`，'
    '`ZCCombatEffectView.render` 再把负进度钳成 0 —— 于是五道雷**同一帧全部亮起、动画同拍**，'
    '前几轮改的间隔只体现在判伤（`nextWaveAt`）上，屏幕上看不出来。'
    '修法：渲染世界先过 `zcCombatEffectEntered(startedAt, now)` 闸（`ZCGameViewUtil` 的纯函数，'
    '`startedAt` 落在未来 ⇒ 整条不建节点；缺字段 ⇒ 视为已到点，与历史口径一致），'
    '延迟出发的 projectile 同用这一条。落地后 5 道雷在 0 / 0.15 / 0.30 / 0.45 / 0.60 秒依次亮起，'
    '全部到点只花 0.6s < 单道特效 0.667s ⇒ 观感是「一道接一道砸下来」而不是「一波齐射」。'
    '用例：tests/zcds-magdi-mushroom.test.ts 新增两条（时间轴上已到点道数逐道 +1、视图闸门必须拦在 pool.acquire 之前）。'
)


def tier_text(level_no, hero_level, count, rate):
    if level_no == 1:
        return (
            'L1（兵种 %d 级）：锁定目标落 1 道雷电，并沿目标背朝向再落 %d 道'
            '（每道间隔 60px、出现间隔 0.15s、特效第 5 帧判伤），每道 %s 攻击力；'
            '逐道独立 30%% 概率使目标进入【麻痹】3 秒（只禁攻击、移速 −50%%）'
            % (hero_level, count - 1, rate)
        )
    return (
        'L%d（兵种 %d 级）：道数 %d 道（比上一档多 1 道），每道 %s 攻击力；'
        '冷却 12 秒 / 间距 60px / 逐道 0.15s / 单道半径 90 / 麻痹 30%%·3s / 第 5 帧判伤均不变'
        % (level_no, hero_level, count, rate)
    )


def load_shared_strings():
    """这张表的正文细胞是 `t="s"`（共享字符串）⇒ 追加时得先把索引解开。"""
    with zipfile.ZipFile(PATH) as archive:
        if 'xl/sharedStrings.xml' not in archive.namelist():
            return []
        raw = archive.read('xl/sharedStrings.xml').decode('utf-8')
    items = re.findall(r'<si>(.*?)</si>', raw, re.S)
    return [''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S)) for item in items]


def read_cell(xml, ref, shared):
    """取某个单元格的纯文本（共享串按索引解回；单元格不存在 ⇒ 空串）。

    🔴 一定要 `html.unescape`：这张表的正文是**共享字符串**，换行与引号在 `sharedStrings.xml`
    里是 `&#10;` / `&quot;` 形态，不解就带着实体去写回，会被 `set_cell` 二次转义成
    `&amp;#10;` —— 单元格里就变成一堆字面量（本轮踩过一次，P80 已按共享串原文重建）。
    """
    match = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not match:
        return ''
    attrs, inner = match.group(1), match.group(2)
    if 't="s"' in attrs:
        index = re.search(r'<v>(\d+)</v>', inner)
        return html.unescape(shared[int(index.group(1))]) if index else ''
    return html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)))


def pristine_p(shared):
    """共享串里那份**未被污染**的 P80 原文（第三轮落地参数）。

    它一直躺在 `sharedStrings.xml` 里：`set_cell` 只换单元格、不删共享串。P80 被二次转义过时
    就靠它重建，别去手抄一份。
    """
    for text in shared:
        decoded = html.unescape(text)
        if decoded.startswith('behaviorKey=bolt_strike') and 'boltInterval=0.15' in decoded:
            return decoded
    return ''


def main():
    xml = read_zip_rows(PATH, MEMBER)
    shared = load_shared_strings()

    jobs = []
    #  K 已经是 L1 档，按同一句式重写一遍（顺带保证「道数」与配表一致）
    jobs.append(('K%d' % ROW, tier_text(*TIERS[0])))
    jobs.append(('L%d' % ROW, tier_text(*TIERS[1])))
    jobs.append(('M%d' % ROW, tier_text(*TIERS[2])))
    jobs.append(('N%d' % ROW, N_TEXT))
    jobs.append(('O%d' % ROW, O_TEXT))

    current_p = read_cell(xml, 'P%d' % ROW, shared)
    base_p = pristine_p(shared) or current_p
    #  解共享串失败时绝不能带着一个索引号去追加 —— 那会把整段落地参数换成一个数字。
    if 'bolt_strike' not in base_p:
        raise SystemExit('[fail] P%d 不是预期的落地参数（读到 %r…），先人工核对'
                         % (ROW, base_p[:40]))
    merged_p = base_p + ROUND4
    if current_p == merged_p:
        print('[skip] P%d 已是目标内容（含第四轮复盘）' % ROW)
    else:
        if 'amp;#' in current_p:
            print('[fix] P%d 之前被二次转义污染 ⇒ 按共享串原文重建' % ROW)
        jobs.append(('P%d' % ROW, merged_p))

    for ref, value in jobs:
        xml = set_cell(xml, ref, value)
        print('  %-5s %s' % (ref, value.split('\r\n')[0][:110]))

    backup = write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写回 %s' % PATH)
    print('[ok] 备份 %s' % backup)

    check = read_zip_rows(PATH, MEMBER)
    for needle in ('L2（兵种 18 级）', 'L3（兵种 24 级）', '逐道出现间隔 0.15 秒',
                   'zcCombatEffectEntered'):
        if needle not in check:
            raise SystemExit('[fail] 回读缺关键词 %s' % needle)
    final_p = read_cell(check, 'P%d' % ROW, shared)
    if final_p.count('2026-11-12 第四轮') != 1:
        raise SystemExit('[fail] 第四轮复盘没写进 P%d（或重复）' % ROW)
    if 'amp;#' in final_p or '&#10;' in final_p:
        raise SystemExit('[fail] P%d 里还有被转义的字面量（&#10; / &amp;#…）' % ROW)
    if 'boltInterval=0.15' not in final_p:
        raise SystemExit('[fail] P%d 丢了落地参数原文' % ROW)
    #  S 列（状态）这一格还是共享串（本轮没重写它）⇒ 必须解索引再比，不能拿表 xml 直接搜。
    if read_cell(check, 'S%d' % ROW, shared) != '已实现':
        raise SystemExit('[fail] S%d 状态不是「已实现」' % ROW)
    print('[ok] 回读通过（K/L/M/N/O/P 已落盘，第四轮只追加一次）')


if __name__ == '__main__':
    main()
