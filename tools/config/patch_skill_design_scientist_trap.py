# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 175 行（68035 科学家「精密陷阱」103504）：补齐 K/L/M/N/O/P/S。

背景（2026-11-12 用户口径）：
  「根据修改的科学家技能补充相关描述，没有疑问根据美术序列帧制作大小相符、格式一致的预制开始研发，
    研发完成同步相关的配置源表和技能设计案」

这一行原来只有 N（设计案原文一段）、O（美术序列帧来源）、S（**待规划**），
K/L/M 三档、P 落地口径全空 —— 研发完了也翻不出「三档差多少 / 参数怎么落 / 代码在哪」。

改六件事（zip 级手术，只动目标格）：
  1. **G175：103503 → 103504**。原件这里填的是「射线集束」的 ID（下一行 176 也是 103503），
     而配置表里 `103503 = 射线集束`（`unlockHeroLevel` 9/18/24，与 176 行 K 列逐字对得上）、
     `103504` 才是这一行的「轨道打击」占位槽 ⇒ 判定 175 行 G 是笔误，一并改正。
  2. K/L/M —— 三档（15/18/23 秒、200/250/300%、180/220/280%），与 `pvpSkillPlan` 94035041~43 同源；
  3. N —— 保留设计案原文，追加「机制口径（2026-11-12 落地）」：放脚下、触碰单目标、踩爆两笔、均等无递减；
  4. O —— 保留美术来源，追加三个 prefab 的路径 / 帧数 / 烘焙缩放 / 屏上尺寸与出场时刻；
  5. P —— 完整落地口径（behaviorKey / 七个参数 / modifierId / 代码位置 / 用例）；
  6. S —— 待规划 → 已实现。

🔴 正文是共享字符串（`t="s"`）：读回必须 `html.unescape`，否则 `set_cell` 会把 `&#10;`
二次转义成 `&amp;#10;` 字面量写回去（第十轮踩过，`patch_skill_design_magdi_bolt.py` 有详述）。
"""
import html
import re
import sys
import os
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

ROW = 175
CHAIN = 103504

#  三档：等级序号、兵种解锁等级（`pvpSkillPlan.unlockHeroLevel` 1/20/25）、
#        陷阱存活秒数、触碰倍率、爆炸倍率（设计案 N 列原文 15/18/23、200/250/300、180/220/280）
TIERS = [
    (1, 1, 15, '200%', '180%'),
    (2, 20, 18, '250%', '220%'),
    (3, 25, 23, '300%', '280%'),
]

N_APPEND = (
    '\r\n\r\n【机制口径（2026-11-12 落地）】\r\n'
    '放置点 = 施法者**脚下**（`trapForward` 缺省 0 = 原地坐标），落下去就不再移动、不跟随施法者。\r\n'
    '触碰判定半径 50 逻辑 px = idle 序列帧的屏上直径 76.9px ÷ 0.76875 ÷ 2（看着多大就踩多大）；'
    '每帧在半径内取**第一个**敌方单位结算 1 次 200%/250%/300%，随后整片陷阱当场消失 —— '
    '同一帧两个人一起踩进来也只算先到的那个，不做「全打一遍」。\r\n'
    '🔴 踩中 = **两笔伤害**：触碰那一下（上一条）+ 立刻引爆。设计案原文的「1 次伤害」与'
    '「1 次额外伤害」就是这两笔，不是二选一。\r\n'
    '爆炸半径 100 逻辑 px（屏上直径 153.75px），对范围内**全部**敌人各结算 1 次 180%/220%/280%，'
    '**均等、无递减、不随人数摊薄**；踩爆与「到点自爆」走同一条结算（`resolveExpiry`）。\r\n'
    '暴击 / 克制按**放下那一刻**的当前目标算一次，两笔伤害共用同一个乘数 —— 陷阱是「灌注好能量的布置物」，'
    '不是「每次有人踩就重新掷一次骰」。\r\n'
    '冷却 10 秒（设计案 J 列）+ 不消耗普攻节奏 ⇒ 同屏最多同时存在 3 个陷阱（23s ÷ 10s），'
    '这 3 个是「提前铺路」用的，不是「一场只放一个」。'
)

O_APPEND = (
    '\r\n\r\n【预制体（2026-11-12 生成：tools/build_scientist_trap_fx.py）】\r\n'
    '· `units/projectiles/科学家_陷阱/科学家_陷阱_出现` —— start00~11，12 帧、sample=30、'
    '一次性 0.4s、wrapMode=1\r\n'
    '· `units/projectiles/科学家_陷阱/科学家_陷阱` —— idle00~11，12 帧、sample=12、'
    '循环 1.0s、wrapMode=2\r\n'
    '· `units/projectiles/科学家_陷阱爆炸/科学家_陷阱爆炸` —— 18 帧、sample=30、一次性 0.6s、wrapMode=1\r\n'
    '尺寸：start 与 idle 共用同一个裁切框、烘焙缩放 **0.471626**（画布 167×61，'
    '屏上宽 76.9px = trapRadius 50 × 2 × 0.76875）；爆炸烘焙缩放 **0.613772**'
    '（画布 262×234，屏上直径 153.8px = trapExplodeRadius 100 × 2 × 0.76875）—— 判定圈与美术同源，'
    '不存在「看着炸到了其实没打到」。\r\n'
    '🔴 三段拆成三个 prefab：`cc.AnimationClip` 的 `wrapMode` 管**整段**，做不出「先播一次 start、'
    '再无限循环 idle」；`ZCCombatEffectView` 也只在 `mountVisual` 时播默认 clip，不会自己接龙。\r\n'
    '出场时刻由**模型**给，不靠美术错帧：生成段是独立的一条 0.4s `area` 事件；'
    '常驻段靠区域的 `visualDelaySeconds = 0.4s` 推后出场，视图侧由 `zcCombatEffectEntered` 挡住未来事件'
    '（docs §14.9）⇒ 两段不会同帧双影。爆炸段在「陷阱消失这一拍」现推一条 0.6s 事件 —— '
    '爆炸时刻由踩上去的那一脚决定，施法那一刻根本算不出来。'
)

P_TEXT = (
    'behaviorKey=trap_place（🔴 同时要进两处：`ZCStatSchema.SKILL_BEHAVIORS` 白名单，'
    '以及 `ZCVisualResourcePlan` 按它筛出上面三个预制体 —— 留 `skill_params` 的后果是'
    '「技能照常结算、屏幕上一个像素都没有、而且一条错都不报」）；'
    'skillParamJson={"trapCooldown":10,"trapDuration":15/18/23,"trapRadius":50,'
    '"trapDamageRate":2.0/2.5/3.0,"trapExplodeRadius":100,"trapExplodeDamageRate":1.8/2.2/2.8,'
    '"trapForward":0}（距离一律**表值 px**，代码乘 combatDistanceScale 落世界坐标）；'
    'modifierId 94035041 / 94035042 / 94035043（原地改写「轨道打击」占位，statusId 清空 —— 陷阱不眩晕）；'
    'triggerEvent=active、skillKind=active_cd。\r\n'
    '代码：`ZCSkillTriggerSystem.applyTrap`（⑩ 车道，只看 trapCooldown，**不**看普攻射程闸门 —— '
    '陷阱落在脚下，等目标进射程才落会永远落在追兵身后）→ `ZCAttackResolutionSystem.castTrap`'
    '（推区域 + 生成表现）→ `ZCGroundZoneSystem.resolveContact`（触碰单目标）/ '
    '`pushExpireVisual`（爆炸表现）/ `resolveExpiry`（均等伤害）；表现常量在 `ZCTrapFx.ts`；'
    '用例 `tests/zcds-scientist-trap.test.ts`。'
)


def tier_text(level_no, hero_level, seconds, touch_rate, explode_rate):
    if level_no == 1:
        return (
            'L1（兵种 %d 级）：冷却 10 秒在脚下放置陷阱，陷阱存活 %d 秒；敌人踩中立刻受到 %s 攻击力伤害，'
            '同时引爆并对爆炸范围内所有敌人各造成 %s 攻击力伤害（均等、不递减）；无人踩中则到时自动引爆'
            % (hero_level, seconds, touch_rate, explode_rate)
        )
    return (
        'L%d（兵种 %d 级）：陷阱存活 %d 秒（比上一档长），踩中伤害 %s、爆炸伤害 %s；'
        '冷却 10 秒 / 触碰半径 50 / 爆炸半径 100px / 均等无递减均不变'
        % (level_no, hero_level, seconds, touch_rate, explode_rate)
    )


def load_shared_strings():
    with zipfile.ZipFile(PATH) as archive:
        if 'xl/sharedStrings.xml' not in archive.namelist():
            return []
        raw = archive.read('xl/sharedStrings.xml').decode('utf-8')
    items = re.findall(r'<si>(.*?)</si>', raw, re.S)
    return [''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S)) for item in items]


def read_cell(xml, ref, shared):
    """取单元格纯文本；共享串解回且 **unescape**（不然带着实体写回会被二次转义）。"""
    match = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not match:
        return ''
    attrs, inner = match.group(1), match.group(2)
    if 't="s"' in attrs:
        index = re.search(r'<v>(\d+)</v>', inner)
        return html.unescape(shared[int(index.group(1))]) if index else ''
    value = re.search(r'<v>(.*?)</v>', inner, re.S)
    if value:
        return html.unescape(value.group(1))
    return html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)))


def main():
    xml = read_zip_rows(PATH, MEMBER)
    shared = load_shared_strings()

    jobs = []
    #  ① G175 笔误：填的是 103503（射线集束），这一行该是 103504。
    current_g = read_cell(xml, 'G%d' % ROW, shared)
    if current_g.strip() not in ('103504',):
        print('[fix] G%d = %s（射线集束的 ID 被抄到这一行）⇒ 改成 %d'
              % (ROW, current_g or '空', CHAIN))
        jobs.append(('G%d' % ROW, CHAIN))

    #  ② 三档
    for tier in TIERS:
        ref = '%s%d' % ('KLM'[tier[0] - 1], ROW)
        jobs.append((ref, tier_text(*tier)))

    #  ③ N / O：保留原文，只在末尾追加（重复跑不会叠第二遍）
    current_n = read_cell(xml, 'N%d' % ROW, shared)
    if '机制口径（2026-11-12 落地）' not in current_n:
        if '原地坐标' not in current_n:
            raise SystemExit('[fail] N%d 不是预期的设计案原文（读到 %r…）' % (ROW, current_n[:40]))
        jobs.append(('N%d' % ROW, current_n + N_APPEND))
    else:
        print('[skip] N%d 已含机制口径' % ROW)

    current_o = read_cell(xml, 'O%d' % ROW, shared)
    if '预制体（2026-11-12 生成' not in current_o:
        if 'idle00' not in current_o:
            raise SystemExit('[fail] O%d 不是预期的美术口径（读到 %r…）' % (ROW, current_o[:40]))
        jobs.append(('O%d' % ROW, current_o + O_APPEND))
    else:
        print('[skip] O%d 已含预制体清单' % ROW)

    #  ④ 落地口径 + 状态
    jobs.append(('P%d' % ROW, P_TEXT))
    jobs.append(('S%d' % ROW, '已实现'))

    for ref, value in jobs:
        xml = set_cell(xml, ref, value)
        head = str(value).split('\r\n')[0]
        print('  %-5s %s' % (ref, head[:110]))

    backup = write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写回 %s' % PATH)
    print('[ok] 备份 %s' % backup)

    # ── 回读 ────────────────────────────────────────────────────────────
    check = read_zip_rows(PATH, MEMBER)
    for ref in ('K%d' % ROW, 'L%d' % ROW, 'M%d' % ROW):
        text = read_cell(check, ref, load_shared_strings())
        if '陷阱存活' not in text and '持续' not in text:
            raise SystemExit('[fail] %s 没写进去（读到 %r）' % (ref, text[:40]))
    n = read_cell(check, 'N%d' % ROW, load_shared_strings())
    if n.count('机制口径（2026-11-12 落地）') != 1:
        raise SystemExit('[fail] N%d 的机制口径没写进或重复' % ROW)
    if '原地坐标留下一个持续时间' not in n:
        raise SystemExit('[fail] N%d 丢了设计案原文' % ROW)
    o = read_cell(check, 'O%d' % ROW, load_shared_strings())
    if '0.471626' not in o or '0.613772' not in o:
        raise SystemExit('[fail] O%d 缺烘焙缩放' % ROW)
    p = read_cell(check, 'P%d' % ROW, load_shared_strings())
    for needle in ('trap_place', 'trapExplodeRadius', '94035041'):
        if needle not in p:
            raise SystemExit('[fail] P%d 缺 %s' % (ROW, needle))
    if read_cell(check, 'S%d' % ROW, load_shared_strings()) != '已实现':
        raise SystemExit('[fail] S%d 不是「已实现」' % ROW)
    if read_cell(check, 'G%d' % ROW, load_shared_strings()).strip() != str(CHAIN):
        raise SystemExit('[fail] G%d 不是 %d' % (ROW, CHAIN))
    for ref in ('N%d' % ROW, 'O%d' % ROW, 'P%d' % ROW):
        text = read_cell(check, ref, load_shared_strings())
        if 'amp;#' in text or '&#10;' in text:
            raise SystemExit('[fail] %s 里还有被二次转义的字面量' % ref)
    print('[ok] 回读通过：G/K/L/M/N/O/P/S 全部到位，无二次转义')


if __name__ == '__main__':
    main()
