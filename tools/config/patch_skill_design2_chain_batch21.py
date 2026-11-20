# -*- coding: utf-8 -*-
"""设计案同步（2026-11-19 第 21 批）：雷蕉「闪电链」102203 的传导判据 + 表现口径第二版。

用户原话（附 3 张示意图）：
> 闪电链技能逻辑修改 卡牌发射的射线接触到目标1后，产生1个150px的圆形判定范围（绿色），
> 范围内有其他目标敌人（又会产生1个目标2为圆心的判定范围），就会被判定为传导，
> 最多传导给4/6/8 个敌人，范围内没有目标就不会被传导，
> （受击目标数达到上限也不会再传导），技能特效会跟随敌人移动
> (如图2，释放端的卡牌静止不动，敌人移动，技能尾端会跟随旋转或伸缩)
> 特效更换为【闪电链-电弧】，红色圆圈是起点，再释放技能的卡牌中心点，
> 绿色框是尾部，在目标的中心位置，特效长度不够无法触碰目标可以拉伸特效或者复制多个节点
> （复制后压缩）连接目标

改设计案第 110 行（G 列守 102203）：
· K / L / M（三档档位说明）：命中数 3/4/6 → **4/6/8**，并写清「最多」与「150 px 圆」；
· N（判据）：从「跳向最近的未命中敌人」换成「150 px 圆逐圈扩散」；
· O（表现）：起点回到卡牌中心、特效跟随敌人、复制后压缩；
· P（落地口径）：`chainTargetCount` 3/4/6 → 4/6/8，末尾追加【2026-11-19 传导判定改口】。

幂等：K/L/M/N/O 按「当前文本 == 目标文本」跳过；P 只在缺少标记时追加，数字用定点替换。

用法：python tools/config/patch_skill_design2_chain_batch21.py
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

ROW = 110
EXPECTED_CHAIN = '102203'

MARKER = '【2026-11-19 传导判定改口】'

K_TEXT = (
    'L1（兵种 9 级）：释放闪电链，**最多**命中 4 个敌人，每个造成 90% 伤害。'
    '射线打中目标 1 后，以它为圆心画一个 **150 px** 的判定圆，圆内所有未命中的敌人一并传导，'
    '它们各自再成为新的圆心（逐圈扩散）；圆里没人就断，受击数到 4 个就停。'
)
L_TEXT = (
    'L2（兵种 18 级）：释放闪电链，**最多**命中 6 个敌人，每个造成 100% 伤害，'
    '每跳在上跳基础上再降 10%（复利：100 / 90 / 81 / 72.9 …）。判定同 L1（150 px 圆扩散，上限 6 个）。'
)
M_TEXT = (
    'L3（兵种 27 级）：释放闪电链，**最多**命中 8 个敌人，每个造成 120% 伤害；'
    '每跳在上跳基础上再降 10%（120 / 108 / 97 …）；最后一跳必定暴击，造成 150% 伤害。'
    '判定同 L1（150 px 圆扩散，上限 8 个）。'
)
N_TEXT = (
    '传导判据（2026-11-19 第 21 批）：射线打中目标 1 ⇒ 以目标 1 为圆心判定半径 150 px；'
    '圆内**每个**未命中的敌方单位都被传导，它们各自再产生一个同样大小的判定圆（一圈一圈往外扩，'
    '不是「跳向最近的那一个」）；圆内没有新目标就停止传导；受击目标数达到上限（4 / 6 / 8，含目标 1）'
    '也不再传导。同一个目标在同一轮技能里只挨一次（去重按单位实例 id，不按位置）。'
    '递减仍按「第几跳」复利计算（II 级起 10%），III 级终跳的强制暴击独立结算。'
)
O_TEXT = (
    '每条电弧 = 【闪电链-电弧】的单帧静态预制：`z` 轴旋转 **-90°**（美术长轴本来是竖的，'
    '转 -90° 后躺平指向下一段），**底端钉在这一段的起点**、顶端指向下一段的起点。'
    '**起点是释放技能的卡牌中心**（图上的红色圆圈），之后每个目标各占一点（绿色框 = 目标中心），'
    'n 个目标铺 **n 段**（含「卡牌 → 目标 1」那一段）。长度不够时**先复制、再把每段沿长轴压到正好**'
    '（段数 = `ceil(段距 / 单段长度)`，每段缩到 `段距 / 段数`）⇒ 末段正好咬住目标中心，'
    '既不缺口也不越过目标；**只压长轴**，闪电的粗细不变（等比缩放会把闪电拉粗，那是明确不要的）。'
    '整条链在放出那一帧直接出现（没有飞行过程、没有逐跳错开），并且**每帧跟随**：'
    '卡牌不动、敌人移动时，尾端跟着旋转 / 伸缩（事件带两端的单位 id，模型每帧重算坐标）。'
    '逐跳降透明度保留（首段 1.0，每段 −0.12，封底 0.4）。'
)

OLD_COUNT_TEXT = 'chainTargetCount=3/4/6'
NEW_COUNT_TEXT = 'chainTargetCount=4/6/8'

P_APPEND = (
    '\n' + MARKER + ' 用户附示意图改口：① 判据从「跳向最近的未命中敌人」换成'
    '「以每个已命中目标为圆心、半径 150 px 的圆，圆内未命中的敌人全部传导，逐圈扩散」，'
    '`chainJumpRadius=150` 数值不变、语义变成圆的半径；② 受击上限 3/4/6 → **4/6/8**'
    '（含目标 1，到顶即停）；③ 表现起点回到**卡牌中心**，n 个目标铺 n 段；'
    '④ 弧要**跟随敌人**（卡牌静止、敌人移动 ⇒ 尾端旋转 / 伸缩），落地走事件的 '
    '`followFromUnitId` / `followToUnitId` / `followPieceIndex` / `followPieceCount`，'
    '`ZCGameModel` 每帧重算；⑤ 长度不够允许「复制后压缩」—— 压的是 `stretchAlongAxis`（只动长轴），'
    '不是 `effectScale`（等比会把闪电拉粗）。伤害倍率 / 递减 / 终跳必暴 / 冷却一个字节都没动。'
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


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    strings = shared_strings()
    actual = cell_text(xml, 'G%d' % ROW, strings)
    if actual != EXPECTED_CHAIN:
        raise SystemExit('[fail] 第 %d 行 G 列是 %r，不是 %s' % (ROW, actual, EXPECTED_CHAIN))

    writes = {
        'K%d' % ROW: K_TEXT,
        'L%d' % ROW: L_TEXT,
        'M%d' % ROW: M_TEXT,
        'N%d' % ROW: N_TEXT,
        'O%d' % ROW: O_TEXT,
    }

    current_p = cell_text(xml, 'P%d' % ROW, strings)
    if OLD_COUNT_TEXT in current_p:
        current_p = current_p.replace(OLD_COUNT_TEXT, NEW_COUNT_TEXT, 1)
    if MARKER not in current_p:
        current_p = current_p + P_APPEND
    writes['P%d' % ROW] = current_p

    changed = []
    for ref, value in writes.items():
        if cell_text(xml, ref, strings) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed.append(ref)
    if not changed:
        print('[skip] 设计案第 %d 行已是目标文本（%d 格）' % (ROW, len(writes)))
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案第 %d 行写入 %d 格：%s；备份 → %s' % (
        ROW, len(changed), ', '.join(changed), backup))


if __name__ == '__main__':
    main()
