# -*- coding: utf-8 -*-
"""把「技能设计案2.xlsx / 技能设计案 (2)」里 5 条**破阵投枪**同步成 2026-11-17 第 7 批
**实际落表**的样子。

要修的三件事
────────────
· **100901（行 43）整条换将**：原来是「蔓生三连」（连击 2 段），按用户 2026-11-17 口径换成
  「破阵投枪」—— 名称、L1~L3、详述、表现层、P 列全部重写，不能再留着连击口径。
· **另外 4 条（行 33/89/134/164）名字与 L 列早已是投枪，但 P 列缺 `lanceDamageRate`**：
  首目标 70% 这个系数此前没有字段承载（老口径把它包在「依次承受 70%/45%/30%」里），
  本批新增 `lanceDamageRate` 才真正兑现，不写进 P 列下次会被当成空字段删掉。
· **S 列（技能状态）全 5 条从【未实现】/【优化中】改成【已实现】**。

为什么不用 openpyxl：见 `patch_skill_design2_multibullet.py` 的说明（整本重写会丢公式缓存值）。

幂等：每格整格重写成固定文本，重复跑内容不变则跳过写盘。
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
DESC_MEMBER = 'xl/worksheets/sheet9.xml'      # 卡牌描述与落地（F 列 = 卡牌描述）
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

NAME = '破阵投枪'

#  `卡牌描述与落地` 页：卡牌 id → (行号, 描述)。100901 换将 / 101802 早就是投枪，
#  但两张卡的**卡牌描述**还写着「蔓生三连」—— 卡面是玩家真读的那份，必须跟着改。
DESCRIPTIONS = {
    68009: (10, '群战战士：破阵投枪 + 爆囊扩散双 AOE，大地之力推出一道直线冲击波压住一路。'),
    68018: (19, '毒伤战士：破阵投枪隔几次甩一记穿透枪，毒液喷吐持续掉血，菌核爆裂把贴脸的敌人击退。'),
}

表现层 = '【新增】投枪弹体（长条 + 拖尾），出手瞬间本体播一次「掷」动作；命中处按穿透链依次爆点'

#  chain: dict(行号, 档位, 数值尾文案, P 列尾巴)
SKILLS = {
    100701: dict(
        row=33, unlock=(3, 10, 22),
        tail='攻击提高 24%，攻击速度提高 26%',
        ptail='子链 190701 attack addRate=0.24、mix.attackSpeed.addRate=0.26',
        note='【本轮改动】原「穿甲苔刺」= 直线穿透，属射手高级；战士高级是「远程穿透弹」；'
             '按战士·高级+中低级被动池重新分配。',
    ),
    100901: dict(
        row=43, unlock=(3, 10, 22),
        tail='攻击提高 26%，攻击速度提高 28%',
        ptail='子链 280901 attack addRate=0.26、190901 attackSpeed addRate=0.28',
        note='【本轮改动】2026-11-17 按用户口径把原「蔓生三连」（连击 2 段）整条换成「破阵投枪」：'
             '段数是整卡常驻、同卡只能一条链写，而 68009 的 100903「迅击」也写 `attackCount`，'
             '两条会各触发一次；换成投枪后 68009 只剩 100903 写段数，叠加问题一并消解。',
    ),
    101802: dict(
        row=89, unlock=(6, 16, 26),
        tail='攻击提高 16%，伤害提高 13%，攻击速度提高 17%',
        ptail='子链 281802 attack addRate=0.16、191802 attackSpeed addRate=0.17、'
              'mix.damageRate.addRate=0.13',
        note='【本轮改动】原「穿甲苔刺」= 直线穿透，属射手高级；战士高级是「远程穿透弹」；'
             '按战士·高级+中低级被动池重新分配。',
    ),
    102702: dict(
        row=134, unlock=(6, 16, 26),
        tail='攻击提高 11%，伤害提高 9%，攻击速度提高 11%',
        ptail='子链 192702 attackSpeed addRate=0.11、mix.attack.addRate=0.11、'
              'mix.damageRate.addRate=0.09',
        note='【本轮改动】原「穿甲苔刺」= 直线穿透，属射手高级；战士高级是「远程穿透弹」；'
             '按战士·高级+中低级被动池重新分配。',
    ),
    103302: dict(
        row=164, unlock=(6, 16, 26),
        tail='攻击提高 16%，伤害提高 13%，攻击速度提高 17%',
        ptail='子链 283302 attack addRate=0.16、193302 attackSpeed addRate=0.17、'
              'mix.damageRate.addRate=0.13',
        note='【本轮改动】原「穿甲苔刺」= 直线穿透，属射手高级；战士高级是「远程穿透弹」；'
             '按战士·高级+中低级被动池重新分配。',
    ),
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


def level_text(chain, spec):
    low, mid, high = spec['unlock']
    return {
        10: f'L1（兵种 {low} 级）：每 4 次普攻，把本次攻击替换成一枚远程穿透弹'
            f'（穿透 3 个目标，依次承受 70%/45%/30%，飞行距离不变）；{spec["tail"]}',
        11: f'L2（兵种 {mid} 级）：触发间隔缩短为 3 次，穿透数量与衰减链不变',
        12: f'L3（兵种 {high} 级）：触发间隔缩短为 2 次，穿透数量与衰减链不变',
    }


def detail_text(chain, spec):
    return ('战士高级被动。每 4 次普攻（三档为 4/3/2 次）把该次攻击替换成一枚远程穿透弹：'
            '飞行距离不变、**穿透 3 个目标**（依次承受 70% → 45% → 30%），其余普攻仍是近战。'
            '🔴 2026-11-16 按用户口径把穿透数从 2 提到 3，用「多一个目标」这条机制补战力，'
            '而不是继续挂纯数值尾巴。补上近战唯一的中远距离手段，不改变整体站位逻辑。'
            f'（本条按整卡 VP 缺口挂数值尾：{spec["tail"]}）\n{spec["note"]}')


def plan_text(chain, spec):
    return ('skillParamJson lanceEvery=4/3/2 + lancePierceCount=3（目标总数**含首目标**，'
            '剩余穿透 = 2）+ lancePierceFalloff=0.35（第 2/3 人 = 70%×(1−0.35)^n ⇒ 45%/30%）'
            '+ lanceDamageRate=0.7（首目标折算）；触发时把本次普攻**整份换成弹道**'
            '（只换 mode / 弹速 / 弹体特效，不改 attackRange）；数值尾（三档不变）：'
            f'{spec["ptail"]}。消费点 = ZCAttackResolutionSystem.lanceBeatOf / lanceProfileOf')


def write_member(member, writes, label):
    """按 `writes` 逐格重写；内容全一致则跳过写盘（幂等）。"""
    xml = read_zip_rows(XLSX, member)
    changed = 0
    for ref, value in sorted(writes.items()):
        if cell_text(xml, ref) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed += 1
    if not changed:
        print('[skip] %s 已是目标文本（%d 格）' % (label, len(writes)))
        return
    backup = write_zip(XLSX, member, xml, BACKUP_DIR)
    print('[ok] %s 写入 %d 格（共检查 %d 格）；备份 → %s' % (label, changed, len(writes), backup))


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    writes = {}
    for chain, spec in SKILLS.items():
        row = spec['row']
        #  守卫：行号必须真的落在这条技能上，避免设计案插行后改错单元格。
        ref_chain = 'G%d' % row
        if cell_text(xml, ref_chain) != str(chain):
            raise SystemExit('[fail] 行 %d 的 G 列是 %r，不是 %s' % (
                row, cell_text(xml, ref_chain), chain))
        writes['H%d' % row] = NAME
        for column, value in level_text(chain, spec).items():
            writes['%s%d' % (chr(65 + column), row)] = value
        writes['N%d' % row] = detail_text(chain, spec)
        writes['O%d' % row] = 表现层
        writes['P%d' % row] = plan_text(chain, spec)
        writes['S%d' % row] = '【已实现】'

    write_member(MEMBER, writes, '设计案投枪 5 条')

    #  卡牌描述页单独一片工作表，守卫同样按 A 列卡牌 id 对齐行号。
    desc_xml = read_zip_rows(XLSX, DESC_MEMBER)
    desc_writes = {}
    for card, (row, text) in DESCRIPTIONS.items():
        if cell_text(desc_xml, 'A%d' % row) != str(card):
            raise SystemExit('[fail] 卡牌描述页行 %d 的 A 列是 %r，不是 %d' % (
                row, cell_text(desc_xml, 'A%d' % row), card))
        desc_writes['F%d' % row] = text
    write_member(DESC_MEMBER, desc_writes, '设计案卡牌描述 2 张')


if __name__ == '__main__':
    main()
