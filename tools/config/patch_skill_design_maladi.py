# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 127~131 行（68026 麻辣铁锅）：补三档描述、落地口径与状态。

同样是 zip 级手术：工作簿里有公式单元格（伤害参数 B46 等），openpyxl 存一次就会把
缓存值抹掉。这里只改目标格子，其余 295KB 原样保留。

数值口径全部来自已经落地的配表，逐条对着 `assets/remoteRef/pvpSkillPlan.json` 抄：
  · 102601（第 128 行）pvpSkillPlan 94026011~13 + 372601 三行 bulletAngle=0（原 20）
  · 102602（第 129 行）pvpSkillPlan 94026021~23
  · 102603（第 130 行）pvpSkillPlan 94026031~33
  · 102604（第 131 行）pvpSkillPlan 94026041~43 + pvpSkill 36182
本脚本幂等：重复跑只是把同样的字再写一遍。
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'          # workbook.xml: 技能设计案 (2) = rId1
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'
DONE = '已实现'


# ---------------------------------------------------------------- 127 / 202601 烈焰弹

P127 = (
    '普攻伤害 = pvpCard.unitAttack，本行只定义形态与节拍；强化槽挂在本行'
    '（empoweredEvery=8、empoweredSkillId=36182），累计 8 次普攻换第 131 行「凤凰降临」那一击'
    '（2026-11-11 由原 10 次 / 36181 火法师武将技 解耦，见第 131 行 P 列）'
)


# ---------------------------------------------------------------- 128 / 102601 孢子弹幕

P128 = (
    'skill 域 skillParamJson={"bulletNum":1/1/2} + unit 域 attackSpeed addRate=0.14/0.20/0.26 '
    '+ unit 域 damageRate addRate=0.08/0.12/0.16；skill 域参数按「同 unitId:pvpSkillId 参数叠加」'
    '合并进本卡普攻技能行。张角由 pvpSkillPlan 372601 三行 statId="bulletAngle"、operation="add"、'
    'value=0 落地（modifierId 97026011~13，解锁 null/14/22）。'
    '🔴 张角必须是 0，原 20° 已于 2026-11-11 收回：弹数是 2/2/3，扇形那套 spread=(i/(n-1))*2-1 '
    '在偶数弹时只有 -1/+1，两发分别偏 -10°/+10°、没有一发对准目标；射程 550 逻辑 px 处横偏 97，'
    '而命中圈只有 29 ⇒ 两发全脱靶（实测 Lv1~20 普攻伤害 0、Lv25/30 只中 1 发）。收 0 后全部子弹走 aim，'
    '两发 312 / 三发 468。同一份 bulletAngle 槽被普攻与强化击共用，'
    '所以 102604 要另配 projectileSpreadDeg 覆盖（第 131 行）。'
)


# ---------------------------------------------------------------- 129 / 102602 吸养根须

P129 = (
    'unit 域 lifestealRate add=0.30/0.40/0.50 + unit 域 damageRate addRate=0.15/0.20/0.25 '
    '+ skill 域 skillParamJson={"splashDamageRate":0.20/0.28/0.36,"splashRadius":38/46/55}；'
    'skill 域参数按「同 unitId:pvpSkillId 参数叠加」合并进本卡普攻技能行。'
    '字段名是 **splashDamageRate**（2026-11-11 修正：原写 explosionDamageRate，引擎不识别这个键，'
    '配了等于没配；爆炸那条「命中爆炸」走的是 impactBurst* 前缀，与本行的溅射是两套东西）；'
    '溅射半径沿用配表现值 38/46/55 逻辑 px，未按设计文案改动。'
)


# ---------------------------------------------------------------- 130 / 102603 喷射火焰

#  2026-11-11 第五轮口径：「根据特效的最长像素作为触发技能的实际距离」。
#  ⚠️ 2026-11-12 第七轮再改：用户口径「喷火的释放触发距离应该小于普通攻击的距离，
#  和特效的 350px 范围相匹配，只有敌人处于 350px 这个距离才会被攻击」。
#  普攻 `unitAttackRange` 550（折后 495）⇒ 触发距离定死 350，特效按它反算缩放（1.278207），
#  视觉长度也是 350；另加 `auraTriggerRange: 350` 做释放闸门（超出则待触发、不消费 CD）。
#  ⚠️ 2026-11-12 第八轮：判定从「圆」改成**矩形**（用户口径「改矩形：加 auraRectHalfHeight
#  （半长跟随 auraRadius），像磁电冲击 101604 那样做成从脚点到 350 的锥/矩形」）：
#  半长跟随 `auraRadius` = 175、中心前移 = 350 − 175 = 175 ⇒ 沿朝向覆盖 0~350、宽 140。
SPRAY_REACH = 350
SPRAY_RADIUS = 175
SPRAY_FORWARD = SPRAY_REACH - SPRAY_RADIUS
SPRAY_RECT_HALF_HEIGHT = 70

TIERS_102603 = [
    (1, 9, '120%'),
    (2, 18, '150%'),
    (3, 24, '200%'),
]

def tier_text_102603(tier):
    level, rate = tier[1], tier[2]
    return ('L%d（兵种 %d 级）：跳起向前喷出火焰柱（起点在角色头部，冷却 12 秒、站桩不追人），'
            '持续 3 秒、每秒对身前 0~%dpx 的矩形（宽 %d）内所有敌人造成 %s 攻击力伤害'
            '（触发距离 %dpx：敌人进入 %dpx 内才会释放，与火焰特效等长）'
            % (tier[0], level, SPRAY_REACH, SPRAY_RECT_HALF_HEIGHT * 2, rate,
               SPRAY_REACH, SPRAY_REACH))


K130, L130, M130 = (tier_text_102603(t) for t in TIERS_102603)

P130 = (
    'skill 域 behaviorKey="self_aura"，skillParamJson={"auraCooldown":12,"auraSeconds":3,'
    '"auraInterval":1,"auraRadius":175,"auraDamageRate":1.2/1.5/2.0,"auraForward":175,'
    '"auraTriggerRange":350,"auraRectHalfHeight":70,"auraVisualLiftPx":97,"auraFollow":0,'
    '"casterLiftPx":30,"auraFaceTarget":1}'
    '（modifierId 94026031~33，解锁 9/18/24）。七条口径：'
    '① 复用既有 self_aura 车道，零新车道 —— auraForward 表达区域的中心偏移、auraRadius 表达半长、'
    'auraInterval + auraSeconds 表达「每秒一波共 3 波」、auraFollow=0 表达「站桩喷火不追人」。'
    '② **判定是矩形**（2026-11-12 第八轮，用户口径「改矩形：加 auraRectHalfHeight（半长跟随 auraRadius），'
    '像磁电冲击 101604 那样做成从脚点到 350 的锥/矩形」）：auraRadius 在这里是**半长**（缺省跟随半径）'
    '= **175**，中心前移 auraForward = 350 − 175 = **175** ⇒ 沿朝向覆盖 **0~350**；'
    'auraRectHalfHeight = **70** ⇒ 宽 140（量出来火焰垂直于朝向的可见厚度约 145，判定略窄于视觉、不出圈）。'
    '换成矩形的原因：第七轮的圆是 `300±50 = 250~350`，敌人贴脸（<250）时技能会放却打不到。'
    'auraForward / auraRadius / auraRectHalfHeight 都是逻辑 px，屏上要 ×0.76875'
    '（= combatDistanceScale 0.3 × view/logical 2.5625）。'
    '③ **触发距离 = 350 表值 px**（2026-11-12 第七轮，用户口径「喷火的释放触发距离应该小于普通攻击的距离，'
    '和特效的 350px 范围相匹配，只有敌人处于 350px 这个距离才会被攻击」）：'
    '普攻 unitAttackRange 550（折后 495）⇒ 350 更近；'
    '特效按 350 反算缩放 = 350×0.76875 ÷ 210.5 = **1.278207**，可见长度正好 350；'
    '矩形右边缘 = auraForward + auraRadius = **350**，正好压在火焰尖端。'
    '历史：350 → 400(缩放 1.040609) → 384/334(并集左缘 68) → 274/224(稳态尾部) → 350/300(圆) → 350/175(矩形)。'
    '③-b **`auraTriggerRange: 350` 是释放闸门**：最近目标还在 350 表值 px 之外 ⇒ 待触发、'
    '不消费冷却（叠在「普攻射程内有目标」那道闸门之后，只压不抬）。'
    '④ casterLiftPx=30 只抬 ZCUnitView.visualRoot、叠加在既有基准偏移（visualBaseOffsetY）上而不覆盖 —— '
    'visualRoot.y 是「美术相对脚下原点」的摆位，序列帧兵是负值，直接写 30 会让整只兵往下跳一截。'
    '滞空时长天然等于 auraSeconds：抬升挂在 ZCGroundZoneState 上，区域一到期就查不到 ⇒ 下一帧落回地面，'
    '不需要任何收尾逻辑；滞空期间播攻击动作（attackClip）。'
    '⑤ 特效 units/projectiles/麻辣铁锅_喷射火焰：39 帧、sample=12、wrapMode=1（一次性 3.250 秒），'
    '画布 222×168、缩放 1.278207、_lpos=(-0.320, -14.060)（宿主摆在矩形中心 175 处 ⇒ 火焰尾巴几乎落在脚点）；'
    '尾部锚点取**稳态尾部**（各帧可见左缘中位，'
    '源 x=238），不是全序列并集左缘 68 —— 那撮火苗只出现 2 帧，锚上去等于让火焰退到角色身后 85 屏上 px。'
    '尾部钉在施法者逻辑脚点、本地 y=0，竖直抬到头部由 **auraVisualLiftPx=97** 在视图层补'
    '（67 一个兵可见高 + 30 滞空抬升）—— 写进 prefab 的 _lpos.y 会被宿主节点'
    'setRotationFromEuler 转成「垂直于火焰的侧移」，只有正中朝右那一次看着是对的。'
    '⑥ target 方向由模型写（auraFaceTarget=1），宿主整体旋转，矩形跟着转向目标；'
    'auraWaveMaxTargets 留 0（= 不限制每波人数）；判定走 `zcGroundZoneReaches` 的矩形分支，'
    '`resolveWave` 与 `resolveExpiry` 两处都收口在同一函数（与磁电冲击 101604 同一条）。'
)

O130 = (
    '播放攻击动画时角色美术根节点上移 30px（判定坐标不动），滞空期间循环播攻击动作，'
    '特效生成点对准角色头部 / 使用 units/projectiles/麻辣铁锅_喷射火焰（39 帧 @12fps，'
    '第 11~17 帧已重复 3 遍拼进同一条 clip，覆盖 3 秒），尾部锚在角色头部、向身前喷出到'
    '触发距离 350 逻辑 px（与火焰视觉长度等长，缩放 1.278207 由此反算）；'
    '敌人进入 350px 内才会释放'
)


# ---------------------------------------------------------------- 131 / 102604 凤凰降临

TIERS_102604 = [
    (1, 0, '220%', '150%', '150%'),
    (2, 20, '280%', '200%', '180%'),
    (3, 25, '300%', '250%', '200%'),
]


def tier_text(tier):
    _, level, direct, burst, second = tier
    return ('L%d（兵种 %d 级）：累计 8 次普攻，发射 4 颗夹角 90° 的凤凰弹（速度 150、持续 4 秒）；'
            '命中造成 %s 攻击力伤害并爆炸，爆炸对范围内所有敌人造成 %s 伤害，'
            '0.83 秒后再造成一次 %s 范围伤害' % (tier[0], level, direct, burst, second))


K131, L131, M131 = (tier_text(t) for t in TIERS_102604)

N131 = (
    '命中、爆炸、二次爆炸三段伤害 / 发射出 4 颗的子弹，每个子弹夹角 90°（速度方向），'
    '子弹速度 150px，持续 4 秒 / 子弹命中目标产生 220%/280%/300% 的伤害（对应等级），'
    '命中目标爆炸，爆炸产生瞬间伤害 150%/200%/250% 伤害（对应等级），'
    '爆炸开始后第 26 帧造成 1 次伤害 150%/180%/200%（对应等级），爆炸伤害和 2 段伤害都是范围伤害'
)

P131 = (
    'skill 域 behaviorKey="skill_params"，挂在普攻行 30181 的强化槽：empoweredEvery=8、'
    'empoweredSkillId=36182（2026-11-11 新增 pvpSkill 36182「麻辣铁锅·凤凰降临」：mode=projectile、'
    'projectileSpeed=150、effectPrefabPath=units/projectiles/麻辣铁锅_凤凰弹/麻辣铁锅_凤凰弹、'
    'impactEffectPrefabPath=units/projectiles/麻辣铁锅_爆炸龙卷/麻辣铁锅_爆炸龙卷）；'
    'skillParamJson={"projectileCount":4,"projectileSpreadDeg":90,"projectileLifeSeconds":4,'
    '"damageRate":2.2/2.8/3.0,"impactBurstRadius":100,"impactBurstDamageRate":1.5/2.0/2.5,'
    '"impactBurstSecondRate":1.5/1.8/2.0,"impactBurstSecondDelay":0.8334,'
    '"impactBurstEffectSeconds":1.0667}（modifierId 94026041~43，解锁 0/20/25）。七条口径：'
    '① 原「新增 summon_projectile（count=1/1/2、trailDamageRate、explosionDamageRate）+ II 级起残留火海'
    '依赖 1008 持续区域元件」**作废**：三段都落地了，且没有残留火海。直击走既有 damageUnit；'
    '第一段爆炸在 resolveProjectileHit 里立刻遍历 unitsInRadius 逐人结算（含主目标）；'
    '第二段借 groundZones 的延迟波次（nextWaveAt = 当前 + delay、effectPrefabPath=null 表示不推表现事件），'
    '与五雷轰顶「第 5 帧判伤」是同一套延迟机制，不新开车道。'
    '② projectileCount **一旦显式声明就不再叠 bulletNum**：102601 的 +1/+1/+2 会同时作用在普攻和强化击上，'
    '不设这道闸门 4 颗会被顶成 6 颗。'
    '③ projectileSpreadDeg 是「强化那一击专用」的张角覆盖 —— bulletAngle 是 unit 域修改器，'
    '同一张卡的普攻与强化击共用一份槽，直接改会把普攻也拉成 90°。'
    '④ impactBurstSecondDelay 必须取 **0.8334** 而不是 0.8333：第 26 帧的时间窗是 [25/30, 26/30)，'
    '0.8333×30=24.999 会被 floor 到 24（第 25 帧），差之毫厘就早一帧打。'
    '爆炸龙卷的 sample 取 30（而非 12）就是为了让「第 26 帧」和配表秒数落在同一条时间轴上：'
    '32 帧 @12fps 只有 2.67s，且帧窗与配表秒数对不上。'
    '⑤ 爆炸范围半径 100 逻辑 px 与爆炸龙卷可见并集 874 源 px 同源（画布 449×412、缩放 0.351831、'
    'sample=30、wrapMode=1 即 32 帧 @30fps = 1.067 秒）。'
    '⑥ 子弹使用 units/projectiles/麻辣铁锅_凤凰弹 —— 火法师_火船 prefab 的**派生副本**：'
    '_lscale 1.733333 → 2.6（放大 150%），复用同一份 clip（f73e3359）与散图 uuid、目录里不放 png。'
    '不直接给火船挂 ZCCombatEffectScale，是因为 36181「火法师武将技」也在用那份 prefab，'
    '一挂会把别人的技能一起放大。'
    '⑦ impactBurstEffectSeconds=1.0667 必须 ≥ 动画总长：ZCGameModel 按 startedAt + durationSeconds '
    '剔除表现事件，写短了爆炸龙卷会在尾帧前被摘掉；这个值同时是命中事件的 durationSeconds，'
    '不写就退回 0.5s。'
)

O131 = (
    '子弹使用 units/projectiles/麻辣铁锅_凤凰弹（火法师_火船 17 帧 clip 的派生副本，'
    '_lscale 1.733333→2.6 即放大 150%，不动 36181 的火船） / '
    '爆炸使用 units/projectiles/麻辣铁锅_爆炸龙卷（32 帧 @30fps，可见并集约 874 源 px）'
)


# ---------------------------------------------------------------- 待写单元格

CELLS = [
    ('P', 127, P127),
    ('P', 128, P128),
    ('P', 129, P129),
    ('K', 130, K130), ('L', 130, L130), ('M', 130, M130), ('O', 130, O130), ('P', 130, P130),
    ('K', 131, K131), ('L', 131, L131), ('M', 131, M131), ('N', 131, N131),
    ('O', 131, O131), ('P', 131, P131),
    ('S', 127, DONE), ('S', 128, DONE), ('S', 129, DONE), ('S', 130, DONE), ('S', 131, DONE),
]


def main():
    xml = read_zip_rows(PATH, MEMBER)
    missing = [ref for col, row, _ in CELLS for ref in ['%s%d' % (col, row)]
               if '<c r="%s"' % ref not in xml]
    if missing:
        raise SystemExit('[fail] 单元格不存在：%s' % missing)

    for col, row, value in CELLS:
        ref = '%s%d' % (col, row)
        xml = set_cell(xml, ref, value)
        head = value[:48].replace('\n', ' ')
        print('  %-5s = %s%s' % (ref, head, '…' if len(value) > 48 else ''))

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    src = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, '%s.bak-%s' % (os.path.basename(PATH), stamp))
    if os.path.isfile(src) and src != backup:
        os.replace(src, backup)

    check = read_zip_rows(PATH, MEMBER)
    for col, row, value in CELLS:
        if value[:24] not in check:
            raise SystemExit('[fail] 回读失败：%s%d' % (col, row))
    print('[ok] 回读通过（%d 格）；备份 %s' % (len(CELLS), backup))


if __name__ == '__main__':
    main()
