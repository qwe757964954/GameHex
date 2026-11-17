# -*- coding: utf-8 -*-
"""把「技能设计案2.xlsx / 技能设计案 (2)」里 9 条多弹技能的 L1~L3 文案与 P 列落地口径
同步成 2026-11-17 第 5 批**实际实现**的样子。

改什么
──────
· L 列（玩家文案）：`（第 1 发 60%，第 2 发 36%）` → `（额外弹伤害约为第 1 发的 60%）`；
  L2/L3 的 `65% / 39%`、`70% / 42%` → `第 1 发的 65%`、`第 1 发的 70%`。
  依据：用户裁定「逐档额外弹伤害没有消费点，用 `bulletFalloff` 0.4/0.35/0.3 逼近，
  文案写成约为第 1 发的 60%」。
· P 列（落地口径）：原写法里的 `extraBulletDamage` 与 `projectileSpreadDeg` 都落不了地，
  换成实际的三个载体（`bulletNum` / `bulletFalloff` / `bulletAngle`），并写明尾巴落在哪条子链。

为什么不用 openpyxl
────────────────────
这张表 175 行技能、9 个页签，openpyxl 另存会把整本重写（共享字符串、样式、dimension 全变）。
沿用 `sync_treant_excel.set_cell`：只替换这几个单元格，写成 inlineStr，样式沿用原格。

幂等：文案已是新串就跳过；P 列整格重写成固定文本，重复跑结果一致。
"""
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = os.path.join(ROOT, 'Demo3.8/tmp/config_backup')

#  chain: (row, 额外弹数, 是否有张角, 尾巴说明)
SKILLS = {
    101001: (48, 2, True, '子链 281001 attack addRate=0.28、191001 attackRange addRate=0.35'),
    101301: (63, 1, False, '无尾巴（纯机制）'),
    101701: (83, 2, False, '子链 281701 attack addRate=0.28、191701 attackRange addRate=0.35'),
    102201: (108, 1, False, '无尾巴（纯机制）'),
    102402: (119, 2, True,
             '子链 192402 attack addRate=0.18；mix.damageRate.addRate=0.15、mix.attackRange.addRate=0.25'),
    102601: (128, 2, True, '子链 282601 attack addRate=0.28、192601 attackRange addRate=0.35'),
    103201: (158, 2, False, '子链 193201 attack addRate=0.28、283201 attackRange addRate=0.35'),
    103401: (168, 2, True, '子链 283401 attack addRate=0.28、193401 attackRange addRate=0.35'),
    103502: (174, 2, False,
             '子链 193502 attack addRate=0.18；mix.damageRate.addRate=0.15、mix.attackRange.addRate=0.25'),
}

#  旧串 → 新串。只对「2 颗」那几条生效（1 颗时没有「第 1 发」可参照）。
TEXT_REPLACEMENTS = [
    ('（第 1 发 60%，第 2 发 36%）', '（额外弹伤害约为第 1 发的 60%）'),
    ('额外弹伤害提高到 65% / 39%，其余不变', '额外弹伤害提高到第 1 发的 65%，其余不变'),
    ('额外弹伤害提高到 70% / 42%，其余不变', '额外弹伤害提高到第 1 发的 70%，其余不变'),
    #  🔴 2026-11-17 用户口径：本批不添加溅射机制 ⇒ L 列不能再写这句，
    #  否则文案承诺了一个 `splashDamageRate` 从未配置过的效果。
    ('，同一爆点第 2 个目标起每次 ×0.7', ''),
]

TEXT_COLUMNS = ('K', 'L', 'M')


def layout_of(bullets, has_angle, tails):
    """P 列正文：三个载体 + 尾巴落点。"""
    if has_angle:
        angle = ('unit 域 bulletAngle add=25（总张角，三档同值）；`projectileSpreadDeg` 在普攻路径是 '
                 '`empowered ? … : 0`，写了恒为 0，只能走这个键（见 Q12）')
    elif bullets + 1 == 2:
        angle = ('不配张角 —— 本体 1 + 额外 1 = 2 颗（偶数），扇形 `spread=(i/(n-1))*2-1` 没有 0° 中心位，'
                 '两发会一起脱靶（102601 在 2026-11-11 踩过），全走 aim')
    else:
        angle = '不配张角（射击系的弹道连击，全部走 aim 打同一目标）'
    return ('unit 域 bulletNum add={b}（🔴 **只写主链 940xxxxx 这一处**：`bulletNumFlat` 是 flat 加法，'
            '子链再写一次就是 +{double}）；skillParamJson bulletFalloff=0.4/0.35/0.3'
            '（第 2 颗 = 本体 `(1-f)²` ⇒ 36/42/49%；原 `extraBulletDamage` 没有任何消费点，已弃用）；'
            '{angle}；尾巴：{tails}').format(
        b=bullets, double=bullets * 2, angle=angle, tails=tails)


def main():
    dry = '--check' in sys.argv
    xml = read_zip_rows(XLSX, MEMBER)
    changed = 0

    for chain, (row, bullets, has_angle, tails) in SKILLS.items():
        #  L 列文案：9 条一律过一遍替换（前 3 条只对 2 颗的生效，第 4 条删溅射句对所有条生效）
        for column in TEXT_COLUMNS:
            ref = '%s%d' % (column, row)
            cell = _cell_text(xml, ref)
            if cell is None:
                raise SystemExit('[fail] 单元格 %s 不存在' % ref)
            updated = cell
            for old, new in TEXT_REPLACEMENTS:
                updated = updated.replace(old, new)
            if updated != cell:
                xml = set_cell(xml, ref, updated)
                changed += 1
                print('[ok] %s（%s）文案' % (ref, chain))

        #  P 列落地口径：整格重写
        ref = 'P%d' % row
        if _cell_text(xml, ref) is None:
            raise SystemExit('[fail] 单元格 %s 不存在' % ref)
        target = layout_of(bullets, has_angle, tails)
        if _cell_text(xml, ref) != target:
            xml = set_cell(xml, ref, target)
            changed += 1
            print('[ok] %s（%s）落地口径' % (ref, chain))

    if not changed:
        print('[skip] 9 条多弹的 L 列与 P 列已是目标内容')
        return
    if dry:
        print('[check] 干跑：共 %d 格，未写盘' % changed)
        return
    write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写入 %d 格；sheet1.xml 其余单元格未动' % changed)


def _cell_text(xml, ref):
    """取单元格文本（共享字符串查表 / inlineStr / 数字格都解）。"""
    import html
    import re
    match = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not match:
        return None
    attrs, body = match.group(1), match.group(2)
    if 't="s"' in attrs:
        index = re.search(r'<v>(\d+)</v>', body)
        if not index:
            return ''
        shared = read_zip_rows(XLSX, 'xl/sharedStrings.xml')
        entries = re.findall(r'<si>(.*?)</si>', shared, re.S)
        return html.unescape(re.sub(r'<[^>]+>', '', entries[int(index.group(1))]))
    text = re.search(r'<t[^>]*>(.*?)</t>', body, re.S)
    if text:
        return html.unescape(text.group(1))
    number = re.search(r'<v>(.*?)</v>', body, re.S)
    return number.group(1) if number else ''


if __name__ == '__main__':
    main()
