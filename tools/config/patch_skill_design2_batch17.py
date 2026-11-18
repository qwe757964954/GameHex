# -*- coding: utf-8 -*-
"""第 17 批设计案同步（2026-11-18）：拆档 / 改文案 / 普攻编号对齐 / 四条被动转已实现。

用户口径（一次做完）：
  1. 101303 的 N 列那句「150%/180/220%的上啊hi会…」是手误，应为「伤害，会」；并补两句设计
     刚确认的事：**飓风原地不移动**、**经过的敌人受 1 次伤害**；
  2. 把那句拆回 L1/L2/L3 三格（101303 = 150/180/220% 与 90/108/132%；101304 = 160/200/220%）；
  3. 35 条普攻的编号与源表对齐 —— 设计案原本写 `2001xx~2035xx`，运行期 `pvpCard.unitSkillId`
     指向的是 `3xxxx`（35 张卡共 32 个编号，4 组两卡共用），J 表里查 2001xx 一条都没有；
  4. 101101 / 101102 / 101201 / 101202 这四条被动已经配进 J 表，状态从【优化中】改成「已实现」。

为什么普攻编号以源表为准（用户 2026-11-18 裁定）：
  改运行编号要同时动 `pvpCard.unitSkillId`、各卡技能行的 `pvpSkillId` 与参数袋 key
  （`68011:30261` → `68011:201101`），会把已经落地的四条主动技能一起牵进去；
  而设计案这一列只是「文档里的编号」，改它零风险。两卡共用同一行的 4 组在 P 列注明。

🔴 两个写盘细节：
  · 这张页签的正文有**共享字符串**（`t="s"` + 索引）与 `inlineStr` 两种形态，读单元格必须
    把索引解成文本 —— 直接把 `<v>` 当内容会把 P 列写成「57」这种索引数字，一保存就毁文案；
  · G 列（技能 ID）是**数字列**，必须写 `int`：传字符串会被写成 `t="inlineStr"`，
    导表器读到的是文本，`find_row_by` 照样找得到、但转表会按文本处理。

幂等：整格写成固定文本；P 列只在缺「运行编号」时追加一次。
用法：python tools/config/patch_skill_design2_batch17.py
"""
import html
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import find_row_by, read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

# ────────────────────────────────────────────── 一、101303 / 101304 拆档

MECH_303 = (
    '发出蓝色的风弹，70px的移动速度，4s的生命周期，命中敌人产生150%/180/220%的伤害，'
    '会在原地产生1个飓风【大小和三叶小丑的飓风一致】；飓风原地不移动，持续3秒，'
    '对经过飓风的敌人造成1次伤害（90%/108%/132%），同个敌人持续接触也只受1次伤害。'
)

TIERS_303 = [
    'L1（兵种 9 级）：射出风弹（弹速 70、寿命 4 秒），命中敌人造成 150% 伤害，'
    '并在原地留下一个半径 30 的飓风，持续 3 秒；经过飓风的敌人受到 90% 伤害（同一敌人只结算 1 次）',
    'L2（兵种 18 级）：射出风弹（弹速 70、寿命 4 秒），命中敌人造成 180% 伤害，'
    '并在原地留下一个半径 30 的飓风，持续 3 秒；经过飓风的敌人受到 108% 伤害（同一敌人只结算 1 次）',
    'L3（兵种 27 级）：射出风弹（弹速 70、寿命 4 秒），命中敌人造成 220% 伤害，'
    '并在原地留下一个半径 30 的飓风，持续 3 秒；经过飓风的敌人受到 132% 伤害（同一敌人只结算 1 次）',
]

TIERS_304 = [
    'L1（兵种 12 级）：1.2 秒内发射 3 枚抛物线炸弹（每次 1 枚），落点在目标周围直径 30 的圆内随机；'
    '炸弹到达落点才爆炸（途中不触碰其他目标），对半径 180 内所有敌人一次性造成 160% 伤害',
    'L2（兵种 24 级）：1.2 秒内发射 3 枚抛物线炸弹（每次 1 枚），落点在目标周围直径 30 的圆内随机；'
    '炸弹到达落点才爆炸（途中不触碰其他目标），对半径 180 内所有敌人一次性造成 200% 伤害',
    'L3（兵种 36 级）：1.2 秒内发射 3 枚抛物线炸弹（每次 1 枚），落点在目标周围直径 30 的圆内随机；'
    '炸弹到达落点才爆炸（途中不触碰其他目标），对半径 180 内所有敌人一次性造成 220% 伤害',
]

# ────────────────────────────────────────────── 二、普攻：卡号 → 运行编号

#  来源：`assets/remoteRef/pvpCard.json` 的 `unitSkillId`（2026-11-18 实测）。
#  4 组两卡共用同一条普攻行：30261（68011 / 68017）、30216（68014 / 68023）、
#  30241（68015 / 68027）、30231（68016 / 68022）。
ATTACK_SKILL_BY_CARD = {
    '68001': 30701, '68002': 30802, '68003': 30711, '68004': 30716,
    '68005': 30707, '68006': 30703, '68007': 30712, '68008': 30717,
    '68009': 30718, '68010': 30719, '68011': 30261, '68012': 30271,
    '68013': 30401, '68014': 30216, '68015': 30241, '68016': 30231,
    '68017': 30261, '68018': 30667, '68019': 30191, '68020': 30714,
    '68021': 30221, '68022': 30231, '68023': 30216, '68024': 30671,
    '68025': 30858, '68026': 30181, '68027': 30241, '68028': 30705,
    '68029': 30704, '68030': 30702, '68031': 30706, '68032': 30708,
    '68033': 30713, '68034': 30710, '68035': 30709,
}
SHARED_BY_SKILL = {}
for _card, _skill in ATTACK_SKILL_BY_CARD.items():
    SHARED_BY_SKILL.setdefault(_skill, []).append(_card)

DONE_PASSIVES = ('101101', '101102', '101201', '101202')
STATUS_DONE = '已实现'

#  设计案里普攻原始编号的区间（用来认「这条就是普攻行」，不至于把别的行当成它）。
ATTACK_ID_MIN, ATTACK_ID_MAX = 200101, 203501


def load_shared_strings(path):
    with zipfile.ZipFile(path) as archive:
        raw = archive.read('xl/sharedStrings.xml').decode('utf-8')
    return [html.unescape(re.sub(r'<[^>]+>', '', block))
            for block in re.findall(r'<si>(.*?)</si>', raw, re.S)]


def cell_text(xml, ref, strings):
    """读一格文本：共享字符串解索引、inlineStr 解 `<t>`、数字直接取 `<v>`。"""
    match = re.search(r'<c r="%s"([^>]*?)(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    attrs, inner = match.group(1), match.group(2) or ''
    kind = re.search(r'\bt="([^"]+)"', attrs)
    name = kind.group(1) if kind else None
    if name == 's':
        value = re.search(r'<v>(.*?)</v>', inner, re.S)
        if not value:
            return ''
        index = int(value.group(1).strip())
        return strings[index] if 0 <= index < len(strings) else ''
    if name == 'inlineStr':
        return ''.join(html.unescape(part) for part in re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S))
    value = re.search(r'<v>(.*?)</v>', inner, re.S)
    return html.unescape(value.group(1)) if value else ''


def find_attack_row(xml, strings, card, attack_skill):
    """按「A 列卡号 + G 列是普攻编号」定位这条卡的普攻行（首次与重跑都认）。"""
    for row in range(2, 400):
        if (cell_text(xml, 'A%d' % row, strings) or '').strip() != card:
            continue
        raw = (cell_text(xml, 'G%d' % row, strings) or '').strip()
        if not raw.isdigit():
            continue
        value = int(raw)
        if value == attack_skill or ATTACK_ID_MIN <= value <= ATTACK_ID_MAX:
            return row
    return None


def main():
    strings = load_shared_strings(XLSX)
    xml = read_zip_rows(XLSX, MEMBER)
    before = xml

    #  ① 101303：N 修正 + 三档
    row = find_row_by(xml, 'G', '101303')
    if row is None:
        raise SystemExit('[fail] 找不到 101303')
    xml = set_cell(xml, 'N%d' % row, MECH_303)
    for column, value in zip(('K', 'L', 'M'), TIERS_303):
        xml = set_cell(xml, '%s%d' % (column, row), value)
    print('[ok] 101303 第 %d 行：N 修正 + K/L/M 三档' % row)

    #  ② 101304：三档
    row = find_row_by(xml, 'G', '101304')
    if row is None:
        raise SystemExit('[fail] 找不到 101304')
    for column, value in zip(('K', 'L', 'M'), TIERS_304):
        xml = set_cell(xml, '%s%d' % (column, row), value)
    print('[ok] 101304 第 %d 行：K/L/M 三档' % row)

    #  ③ 35 条普攻：G 列换运行编号（数字）+ P 列注明共用
    rewritten = 0
    for card, attack_skill in sorted(ATTACK_SKILL_BY_CARD.items()):
        row = find_attack_row(xml, strings, card, attack_skill)
        if row is None:
            raise SystemExit('[fail] %s 的普攻行找不到（A 列卡号 + G 列普攻编号）' % card)
        current = (cell_text(xml, 'G%d' % row, strings) or '').strip()
        if current != str(attack_skill):
            #  数字列必须写 int：传字符串会变成 inlineStr 文本。
            xml = set_cell(xml, 'G%d' % row, attack_skill)
            rewritten += 1
        note = cell_text(xml, 'P%d' % row, strings) or ''
        if '运行编号' in note:
            continue
        others = [other for other in SHARED_BY_SKILL[attack_skill] if other != card]
        suffix = ('运行期与 %s 卡共用源表同一条普攻行（skillId %d）。' % (' / '.join(others), attack_skill)
                  if others else '与 pvpCard.unitSkillId 一致。')
        added = ('运行编号 %d：2026-11-18 已与源表对齐（原 %s）。本行描述该卡普攻的形态；%s'
                 % (attack_skill, current or '空', suffix))
        xml = set_cell(xml, 'P%d' % row, (note + '\n' + added).strip() if note else added)
    print('[ok] 35 条普攻：G 列对齐运行编号（本次改写 %d 格）' % rewritten)

    #  ④ 四条被动转已实现
    for chain in DONE_PASSIVES:
        row = find_row_by(xml, 'G', chain)
        if row is None:
            raise SystemExit('[fail] 找不到被动 %s' % chain)
        if (cell_text(xml, 'S%d' % row, strings) or '').strip() != STATUS_DONE:
            xml = set_cell(xml, 'S%d' % row, STATUS_DONE)
    print('[ok] 四条被动状态 → 已实现')

    if xml == before:
        print('[skip] 设计案已是目标值')
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 备份 → %s' % backup)


if __name__ == '__main__':
    main()
