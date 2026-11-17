# -*- coding: utf-8 -*-
"""把「技能设计案2.xlsx / 技能设计案 (2)」里 6 条连击技能的 P 列（落地口径）同步成
2026-11-17 第 6 批**实际实现**的样子。

要修的两个既有错标
──────────────────
· 100501 / 101401 是**紫卡 1 段**（L1~L3 写「普攻追加 1 段连击」），但 P 列抄的是金卡口径
  `multiHit=2` —— 照它落表会多打一段，直接改数值平衡。
· P 列的 `comboDamage/comboFalloff` 原来没有消费点（代码里 `extraHitCountOf` 把额外段按
  满伤害结算），本批新增 `ZCAttackResolutionSystem.comboDamageMultiplierOf` 才真正兑现，
  顺便把「靠谁消费」写进口径里，免得下次又被当成空字段删掉。

为什么不用 openpyxl：见 `patch_skill_design2_multibullet.py` 的说明（整本重写会丢公式缓存值）。

幂等：P 列整格重写成固定文本，重复跑结果一致（内容没变则跳过写盘）。
"""
import os
import re
import sys
import html

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

#  chain: (行号, 额外段数, 尾巴说明)
SKILLS = {
    100501: (23, 1, '无尾巴（纯机制；紫卡 1 段只有 60 VP，金卡才是 2 段）'),
    100702: (34, 2, '子链 280702 attack addRate=0.18、190702 attackSpeed addRate=0.18；'
                    'mix.damageRate.addRate=0.15'),
    100901: (43, 2, '子链 280901 attack addRate=0.26、190901 attackSpeed addRate=0.28'),
    101401: (68, 1, '无尾巴（纯机制；紫卡 1 段）'),
    101801: (88, 2, 'mix.attack.addRate=0.26、mix.attackSpeed.addRate=0.28（该卡无子链行）'),
    102501: (123, 2, 'mix.attack.addRate=0.26、mix.attackSpeed.addRate=0.28（该卡无子链行）'),
}

COLUMN = 'P'          # 第 16 列 = 落地口径（modifier 建议）


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


def text_of(hits, tails):
    if hits == 1:
        head = ('unit 域 multiHit=1（= attackCount add 1，共 2 段）；'
                'skillParamJson comboDamage=60/65/70、comboFalloff=0.4'
                '（没有第 3 段，该系数不生效）')
    else:
        head = ('unit 域 multiHit=2（= attackCount add 2，共 3 段）；'
                'skillParamJson comboDamage=60/65/70、comboFalloff=0.4'
                '（第 3 段 = 60/65/70 × 0.6 = 36/39/42）')
    return '%s；%s。递减由 ZCAttackResolutionSystem.comboDamageMultiplierOf 消费' \
           '（近战与弹道同一口径）。' % (head, tails)


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    writes = {}
    for chain, (row, hits, tails) in SKILLS.items():
        #  守卫：行号必须真的落在这条技能上，避免设计案插行后改错单元格。
        if str(chain) not in xml:
            raise SystemExit('[fail] %s 在设计案里找不到' % chain)
        writes['%s%d' % (COLUMN, row)] = text_of(hits, tails)

    changed = 0
    for ref, value in sorted(writes.items()):
        if cell_text(xml, ref) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed += 1
    if not changed:
        print('[skip] 设计案 P 列已是目标文本（%d 格）' % len(writes))
        return

    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案 P 列写入 %d 格；备份 → %s' % (changed, backup))


if __name__ == '__main__':
    main()
