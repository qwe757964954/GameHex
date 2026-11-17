# -*- coding: utf-8 -*-
"""把「技能设计案2.xlsx / 技能设计案 (2)」第 8 批三条的 **P 列（落地口径）** 同步成
2026-11-17 实际落表的样子，并把「技能状态」改成【已实现】。

要修的三处（设计案原文都停在「🔴 新字段」的口径上，没写这个字段怎么存）：

· 100601 `hpRegenPct` —— 原文只写「unit 域 hpRegenPct=1.5/1.8/2.1（🔴 新字段）」，
  没写「没有基础值 ⇒ 只能 `add`、写 `addRate` 恒 0」以及「结算点在整秒边界」；
· 101602 `bulletSizeScale` —— 原文写「视觉体积与判定半径同步放大」，没写这个倍率
  是**绝对倍率**（1.6 = ×1.6）、也没写它同时喂 `collisionRadius` 与视图 `sizeScale`；
· 102401 `cdReduceOnHit` —— 原文写「按秒回退其他主动技能剩余 CD，不含自身」，
  没写「不含 `empoweredReadyAt`」「同一逻辑步只结算一次」这两条实现约束。

为什么不用 openpyxl：见 `patch_skill_design2_multibullet.py`（整本重写会丢公式缓存值）。

幂等：P 列整格重写成固定文本，内容没变则跳过写盘。
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

PLANS = {
    100601: (28,
             'unit 域 hpRegenPct **add** = 1.5 / 1.8 / 2.1（1.5 = 每秒 1.5%，与 `critRate` 同口径的百分点）；'
             '🔴 该字段没有基础值 ⇒ 只能写 `add`，写 `addRate` 会乘 baseValue(0) 恒为 0；'
             '同条混搭（数值尾）：mix.critRate add = 8 / 10 / 12（🔴 整卡 ≤15%）、'
             'mix.attack.addRate = 0.13、mix.maxHp.addRate = 0.13。'
             '消费点 = `ZCSkillTriggerSystem.applyHpRegen`：跨过**整秒**的那一帧结算一拍'
             '（逐帧切碎会被 `healUnit` 取整抹掉），走 `healUnit` ⇒ 封顶 maxHp、不吃治疗加成、不碰护盾'),
    101602: (79,
             'unit 域 bulletSizeScale **add** = 1.6 / 1.75 / 1.9 —— 语义是**绝对倍率**（1.6 = ×1.6），'
             '不是增量；🔴 同一倍率必须同时喂两处：弹道 `collisionRadius`（判定）与弹体 `sizeScale`（视图），'
             '只改一处就是「看着变大但打不中」或「判定变宽但看着没变」。'
             '第二机制：skillParamJson splashDamageRate = 30 / 34 / 38 + splashFalloff = 0.3'
             ' + splashRadius = 38 / 46 / 55（逻辑 px，设计案未定价，沿用已落地值）；'
             '子链 191602 damageRate addRate = 0.08；mix.attack.addRate = 0.10、mix.attackRange.addRate = 0.14'),
    102401: (118,
             'unit 域 cdReduceOnHit **add** = 0.4 / 0.5 / 0.6（秒）；'
             '🔴 回退的是各主动车道的 `*ReadyAt`（副轨 / 自身施法 / 光环 / 雷击 / 陷阱 / 多点打击 / 闪现），'
             '**不含 `empoweredReadyAt`** —— 那是强化与普攻自己的节拍，回退它等于「打人给自己加速」；'
             '🔴 **同一逻辑步只结算一次**（`cdReducePaidAt` 去重），否则穿透一拍打 3 人 = CD 掉 3 倍；'
             '冷却已好的一律夹到「当前时刻」为止，不会变成负 CD。'
             '子链 192401 attackSpeed addRate = 20 / 22 / 24；'
             'mix.attack.addRate = 0.35、mix.attackRange.addRate = 0.35。'
             '⚠️ 该卡真正的「其他主动」是 102403 冰山陨落 / 102404 急冻光线（仍待规划）⇒ 本机制待它们落地即生效'),
}

COLUMN = 'P'      # 第 16 列 = 落地口径
STATUS = 'S'      # 第 19 列 = 技能状态


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
    xml = read_zip_rows(XLSX, MEMBER)
    writes = {}
    for chain, (row, plan) in PLANS.items():
        #  守卫：行号必须真的落在这条技能上，避免设计案插行后改错单元格。
        ref_chain = 'G%d' % row
        if cell_text(xml, ref_chain) != str(chain):
            raise SystemExit('[fail] 行 %d 的 G 列是 %r，不是 %s' % (
                row, cell_text(xml, ref_chain), chain))
        writes['%s%d' % (COLUMN, row)] = plan
        writes['%s%d' % (STATUS, row)] = '【已实现】'

    changed = 0
    for ref, value in sorted(writes.items()):
        if cell_text(xml, ref) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed += 1
    if not changed:
        print('[skip] 设计案第 8 批已是目标文本（%d 格）' % len(writes))
        return

    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案第 8 批写入 %d 格（共检查 %d 格）；备份 → %s' % (
        changed, len(writes), backup))


if __name__ == '__main__':
    main()
