# -*- coding: utf-8 -*-
"""设计案同步（2026-11-19 用户口径）：雷蕉「闪电链」102203 的表现改成「目标之间的连续电弧」。

用户原话：
> 雷蕉的 闪电链 技能取消中间飞的过程，直接出现在目标的位置，同时特效的z轴应该旋转90°，
> 左侧端点在目标1的中心点，右侧端点朝向 目标2 的中心点
>（特效图片需要覆盖到 目标中心点坐标位置，距离不够，不拉伸高度变形，复制多段来延续，
>  可以超出，但是不能少于）以此形成连续链条，同步相关的配置源表和设计案

改设计案第 110 行的 O / P 两格：
· O（表现）：原来的「雷弹从本体到首个目标 + 每跳在落点劈一记雷、逐跳错开」整段换掉，
  改成「单帧静态电弧、z 转 -90°、底端钉在当前目标中心、朝下一个目标、不够就复制、只复制不拉伸」；
· P（落地口径）：把「表现只把每跳的 startedAt 错开 0.05s…美术复用磁电菇_劈雷序列帧」那一句
  换成新口径（新预制 `闪电链_电弧`、单段屏上 89 px、世界 34.7 px、段数 = ceil(段距/34.7)），
  并补一段【2026-11-19 表现改口】。

结算（跳数 / 递减 / 终跳必暴 / CD 车道）一个字都没动，所以 K/L/M/N 四列与状态列保持原样。
配表（J 表 `PVP技能配置` / K 表）**没有造型列**，本次也不改任何数值 —— 详见脚本末尾打印。

幂等：目标文本里已经含有 `2026-11-19` 就跳过。

用法：python tools/config/patch_skill_design2_chain_arc.py
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

O_TEXT = (
    '每段电弧 = 【雷道人武将_闪电_attack_05】（设计案原话「雷电武将第 5 帧」）做成的**单帧静态**预制：'
    '`z` 轴旋转 **-90°**（美术长轴本来是竖的，转 -90° 后躺平指向下一个目标），'
    '**底端（左端）钉在当前目标的中心点**、顶端朝向下一个目标的中心点；'
    '一段不够长就**复制若干段**沿链路首尾相接（**可以超出、不许少**），'
    '**不拉伸** —— 等比缩放会把闪电的粗细一起拉变形，那是用户明确不要的。'
    '整条链在放出那一帧直接出现在**目标之间**：取消「雷弹从本体飞到首个目标」的过程，'
    '也不再逐跳错开出现时刻；逐跳降透明度保留。'
    '🔴 链条从第 1 个目标起铺（n 个目标 = n−1 段），只命中 1 个目标时退化成「在那个目标身上落一段」'
    '（否则整条链一个像素都没有）。'
)

#  P 列里要被整段替换的旧口径。
OLD_P_PIECE = (
    '表现只把每跳的 startedAt 错开 0.05s；每跳一条 area 事件、起终点都写落点中心'
    '（视图从不按 radius 缩放、只按 to 摆位 + angleDegrees 转向，写包围盒中点会把整条链歪到一边），'
    'angleDegrees = 上一跳 → 这一跳；逐跳降透明度走新增的 effectAlpha（视图经宿主 UIOpacity 级联）。'
    '⚙ 美术复用磁电菇_劈雷序列帧（已在加载清单）—— 设计 O 列要的「两点拉伸电弧」等专用资源到位后'
    '只改 ZCChainLightningFx 的常量。'
)

NEW_P_PIECE = (
    '表现见 O 列（2026-11-19 改口）：每段一条 area 事件、起终点都写**这一段的起点**'
    '（视图只认 to 摆位 + angleDegrees 转向），逐跳降透明度走最新 `effectAlpha`。'
    '⚙ 预制换成 `units/projectiles/闪电链_电弧/闪电链_电弧`（单帧静态 attack_05，'
    'UITransform 141×267 × 根 `_lscale` 0.333333 ⇒ 屏上 47×89，根 `_lpos.y = 44.5` 把底端钉在节点原点）；'
    '常量在 `ZCChainLightningFx`：单段屏上 89 px ÷ 2.5625 = **世界 34.7 px**，'
    '段数 = `ceil(段距 / 34.7)`，方向恒 `-90°`。'
)

P_APPEND = (
    '\n【2026-11-19 表现改口】用户口径「取消中间飞的过程、z 轴转 90°、左端点在目标 1、'
    '右端朝目标 2、不够就复制多段（可超出不可少、不拉伸）」。落地方式：'
    '① 结算完全不动（同一帧结算、跳数 / 递减 / 终跳必暴一律照旧）；'
    '② 不再推「本体 → 首个目标」那一段，也不再逐跳错开 `startedAt` —— 整条链同帧出现在目标之间；'
    '③ 每段最左拷贝摆在「当前目标中心」、`angleDegrees = 链路方向 -90°`，'
    '按 `ceil(段距 / 单段世界长度)` 复制，**只复制不缩放**（等比缩放会把闪电拉变形）；'
    '④ 只命中 1 个目标时退化成「在该目标身上落一段」，避免「照常掉血、屏幕没东西」。'
    '🔴 配表（J 表 `PVP技能配置` / K 表 `卡牌技能升级表`）没有造型列，本次**零数值改动** —— '
    '造型是行为技能的一部分，只能落在 `ZCChainLightningFx` 的代码常量里；'
    '新路径必须同时进 `ZCVisualResourcePlan` 的清单（漏收 = 静默无表现）。'
)


def shared_strings():
    """`xl/sharedStrings.xml` 的正文列表（设计案的正文字几乎都在这里）。"""
    text = read_zip_rows(XLSX, 'xl/sharedStrings.xml')
    out = []
    for item in re.findall(r'<si>(.*?)</si>', text, re.S):
        out.append(html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S))))
    return out


def cell_text(xml, ref, strings):
    """读一个单元格的当前正文（`t="s"` 回共享字符串正文，其余回内联文本）。"""
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
    #  纯数字格（技能 id / 行号）走 `<v>`，没有 `<t>`。
    value = re.search(r'<v>(.*?)</v>', inner, re.S)
    return html.unescape(value.group(1)) if value else ''


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    strings = shared_strings()
    actual = cell_text(xml, 'G%d' % ROW, strings)
    if actual != EXPECTED_CHAIN:
        raise SystemExit('[fail] 第 %d 行 G 列是 %r，不是 %s' % (ROW, actual, EXPECTED_CHAIN))

    writes = {'O%d' % ROW: O_TEXT}
    #  P 列要「改一段 + 追加一段」，所以要拿到正文；拿不到正文就不能瞎改，直接报错。
    current_p = cell_text(xml, 'P%d' % ROW, strings)
    if '2026-11-19' in current_p:
        pass
    elif OLD_P_PIECE in current_p:
        writes['P%d' % ROW] = current_p.replace(OLD_P_PIECE, NEW_P_PIECE) + P_APPEND
    else:
        raise SystemExit('[fail] P 列既没有旧口径也没有新口径，先人工核对：%r' % current_p[:80])

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
