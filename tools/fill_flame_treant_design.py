# -*- coding: utf-8 -*-
"""重写「技能设计案2.xlsx」里火焰树妖（68003）五行的：L1/L2/L3、技能详述、表现描述、落地口径。

2026-10-30 第二轮：用户拍了五条口径，这一版把设计案与**已经落盘的代码 + 配表**对齐。
  1. 灼热地带复用「火法师_火船」的地面特效（不再新建）；
  2. L3 保持 5 秒（三级只递进伤害，不加时长）；
  3. 主动技按累计普攻触发，累计够 6 次释放 1 次；
  4. 受击特效按现在支持的结构做（四组职业、锁 0.15s，不新增燃烧火苗）；
  5. 点燃改成「每 3 次普攻的第 3 次附带」——表里由 statusEveryNAttacks=3 表达。

列位：9=触发类型 10=触发参数 11..13=L1/L2/L3 14=技能详述 15=表现描述 16=落地口径。
只动第 12~16 行，其余单元格与样式一律不动。
"""
import openpyxl

PATH = r"D:\Alan\占城玩法\策划文档\战斗系统\技能设计案2.xlsx"
SHEET = "技能设计案 (2)"

# 行号 -> {列号: 文案}（L 列与触发列）
LEVELS = {
    13: {
        11: "L1（兵种 1 级，开局即解锁）：攻击提高 10%",
        12: "L2（兵种 14 级）：攻击提高 10%",
        13: "L3（兵种 22 级）：攻击提高 10%",
    },
    14: {
        11: "L1（兵种 6 级）：射程提高 10%",
        12: "L2（兵种 16 级）：射程提高 10%",
        13: "L3（兵种 23 级）：射程提高 10%",
    },
    15: {
        9: "被动-累计普攻",
        10: 3,
        11: "L1（兵种 9 级）：每 3 次普攻的第 3 次附带点燃，每 0.5 秒造成 10% 攻击力伤害，持续 3 秒",
        12: "L2（兵种 18 级）：每 3 次普攻的第 3 次附带点燃，每 0.5 秒造成 15% 攻击力伤害，持续 3 秒",
        13: "L3（兵种 24 级）：每 3 次普攻的第 3 次附带点燃，每 0.5 秒造成 20% 攻击力伤害，持续 3 秒",
    },
    16: {
        9: "主动-累计普攻",
        10: 6,
        11: "L1（兵种 12 级）：每 6 次普攻释放一次半径 60 的灼热地带，持续 5 秒，每秒造成 35% 攻击力伤害",
        12: "L2（兵种 20 级）：每 6 次普攻释放一次半径 60 的灼热地带，持续 5 秒，每秒造成 55% 攻击力伤害",
        13: "L3（兵种 25 级）：每 6 次普攻释放一次半径 60 的灼热地带，持续 5 秒，每秒造成 75% 攻击力伤害",
    },
}

# 行号 -> (技能详述, 表现描述, 落地口径)
CONTENT = {
    # 200301 火球弹射
    12: (
        "每 1.8s 向当前目标抛射 1 枚火球（弹速 500），命中结算 1 次普攻伤害；面板攻击 24、射程 300。"
        "普攻节拍由 pvpCard.unitAttackInterval 决定，本行只定形态。"
        "累计每 6 次普攻，第 6/12/18… 次不再走普通弹道，直接升级成武将技「灼热地带」那一击。",
        "【P7 沿用·已验证】火焰树妖_普攻 8 帧 / 0.667s @12fps，沿弹道直线飞向目标，发射点随单位朝向。"
        "受击特效按现在支持的唯一结构走：伤害事件自动播，按**攻击方**职业取四组之一"
        "（射手 / 战士 / 法师 / 坦克，HIT_FX_TRAITS），时长锁 0.15s。树妖自己是法师职业，"
        "所以它的每一次命中（含点燃与灼热地带）播的都是「法师受击」那一组，不区分技能来源。",
        "pvpSkill 30711 已改完：mode=projectile、projectileSpeed=500、trigger=every_n_attacks、"
        "**empoweredEvery=6、empoweredSkillId=30811**（此前是继承来的 36181 火法师武将技，已解绑）。"
        "「累计 6 次」由 ZCCombatSystem.consumeEmpoweredAttack 驱动 —— 它先自增 "
        "completedAttackCount 再判 `% 6 === 0`，所以第 6/12/18… 次普攻命中强化。"
        "普攻伤害 = pvpCard.unitAttack(24) × 成长/星级系数，本行不重复定义数值。",
    ),
    # 100301 魔力塑能
    13: (
        "纯面板攻击 +10%，三级同值、不叠加 —— 本质是「解锁」而不是「升级」，"
        "L2/L3 的意义在于把兵种等级门槛提到 14/22 级后仍然保持这档收益。"
        "与 100302 一起构成树妖的兜底成长线：一个抬攻击、一个抬射程。",
        "【无独立特效】纯数值，画面无变化，不改任何资源。"
        "若想让玩家有感知，只能靠伤害飘字数值变大，不需要新做资源。",
        "pvpSkillPlan 已写入 3 行（68003 一共 12 行，4 技能 × 3 档）：skillKind=passive_stat、"
        "passiveScope=deployed、triggerEvent=build、statId=attack、operation=addRate、value=0.10、"
        "progressionMode=replace、unlockHeroLevel=1/14/22。"
        "🔴 progressionMode 必须是 replace：selectZCSkillPlans 对 replace 只取等级最高的一档，"
        "填 accumulate 会三级叠成 +30%。"
        "🔴 原稿的「兵种 0 级」在表里落成 **1 级**：ZCStatSchema 硬校验 "
        "[skillChainId, skillLevel, unlockHeroLevel] 每项 ≥ 1，填 0 直接抛错；"
        "而 1 就是 selectZCSkillPlans 的最小等级，等效于开局解锁。",
    ),
    # 100302 魔力回路
    14: (
        "纯射程 +10%，三级同值、不叠加。对弹道单位而言只抬高选目标的覆盖范围，"
        "不改变弹速、不改变命中判定，因此收益是「更早开火」而不是「打得更疼」。",
        "【无独立特效】纯数值，画面无变化，不改任何资源。"
        "射程变远的唯一表现是敌人进入攻击范围的时间点提前，没有可播放的特效。",
        "pvpSkillPlan 已写入 3 行：statId=attackRange、operation=addRate、value=0.10、"
        "progressionMode=replace、unlockHeroLevel=6/16/23。"
        "⚠ 与 200301 的射程基线联动：unitAttackRange=300 是底数，+10% 后取 330，"
        "改表后需实机确认树妖不会在视野外提前锁定敌人。",
    ),
    # 100303 点燃
    15: (
        "普攻命中挂「点燃」，但**不是每次命中都挂**：数 3 次普攻一个循环，"
        "第 3 次（累计第 3/6/9… 次）那一击才附带点燃 —— 前两次是干净伤害，第三次开始跳烧。"
        "点燃本身每 0.5 秒结算一次攻击力百分比伤害，持续 3 秒（共 6 跳）："
        "L1 10%/跳（合计 60% 攻击力）、L2 15%/跳（90%）、L3 20%/跳（120%）。"
        "刷新策略 refresh —— 重复命中只重置剩余时间，不叠层、不叠伤害。"
        "定位是树妖的输出核心，长线对拼里点燃总伤会超过普攻本体。",
        "【命中沿用 / 跳伤无资源】点燃那一击与普通命中播的是同一套受击特效"
        "（按攻击方职业，树妖=法师 ⇒ 恒走「法师受击」，锁 0.15s），不额外加火苗；"
        "之后每 0.5 秒一跳只有伤害飘字。"
        "🔴 原稿的「循环播 中毒受击(6帧)」不做：受击特效只加载了四组职业"
        "（HIT_FX_TRAITS = 射手/战士/法师/坦克），中毒受击目录虽然存在但没被加载；"
        "要火苗必须新做一套挂在受击者身上的循环特效，属新增内容。",
        "① pvpStatus 已写入 burn_ignite_l1/l2/l3：handlerKey=periodic_damage、intervalSeconds=0.5、"
        "periodicAmountPct=10/15/20、periodicBasis=senderAttack、durationSeconds=3、"
        "maxStacks=1、refreshPolicy=refresh、enabled=1。"
        "结算走 ZCStatusResolutionSystem.resolvePeriodicEvent 的 else 分支 = 施法者攻击力 × 百分比。"
        "② pvpSkillPlan 已写入 3 行：skillKind=event_passive、triggerEvent=hit、"
        "behaviorKey=on_hit_status、statusId=对应档、"
        "**skillParamJson={\"statusEveryNAttacks\":3}**、progressionMode=replace。"
        "③ 「每 3 次才挂」是新加的机制（原稿的 20/30/40% 概率做不到 —— applyHitStatus 无条件挂、不掷骰）："
        "ZCAttackResolutionSystem 新增 hitStatusOnBeat()，挂状态前判 "
        "`completedAttackCount % N === 0`，参数缺省 0 时恒为 true，既有表数据行为逐字不变。"
        "④ 第 6 次普攻是「灼热地带 + 点燃」同一拍，区域分支原本提前 return 会吞掉点燃，"
        "已在 zone 分支补 applyHitStatus。用例见 tests/zcds-attack-hit-status.test.ts。"
        "⚠ 兵种解锁等级 9/18/24 是插值（原表这格为空），待策划确认。",
    ),
    # 100304 灼热地带
    16: (
        "每 6 次普攻的一次出手不再打单体，改为在**目标所在坐标**释放半径 60 的圆形灼热地带："
        "持续 5 秒、每秒结算 1 波（共 5 波），每波对区域内所有敌人造成攻击力 35%/55%/75%"
        "（L1/L2/L3）并照常吃克制系数。区域落点固定在释放瞬间的目标位置、不跟随目标移动。"
        "三级**时长一致、只递进伤害**，定位是「把普攻的一次性伤害摊成一片持续压制」，"
        "对密集阵型收益最高。",
        "【P17 定案·复用】地面圈直接复用法师系现成的 火法师_火船（17 帧 / 1.417s）原地循环 —— "
        "橙红调天然契合火系，且它是现成的「区域特效」范式（36201 冰雕 / 36251 龙卷风同款），"
        "不新建任何美术。区域预制走 groundZone 的 effectPrefabPath，"
        "随区域存活时间自己循环播放，5 秒到期自然消失。"
        "🔴 不要用 普攻爆炸 —— 那是瞬时爆炸帧，循环播放会一直闪。",
        "① pvpSkill 已新增 30811「树妖·灼热地带」：mode=area、areaRadius=60、durationSeconds=5、"
        "waves=5、damageRate=0.35、effectPrefabPath=units/projectiles/火法师_火船/火法师_火船、"
        "empoweredEvery=0、empoweredSkillId=0、trigger 留空、cooldown=0。"
        "② 30711 的 empoweredEvery 10→6、empoweredSkillId 36181→30811（顺带解决「树妖在放火法师火船」）。"
        "③ pvpSkillPlan 已写入 3 行：skillKind=active_cd、triggerEvent=active、behaviorKey=skill_params、"
        "skillParamJson={\"damageRate\":0.35/0.55/0.75}。"
        "计划行的 triggerEvent/cooldown 只是声明，真正计时的是 30711 上的 empoweredEvery=6。"
        "🔴 L3 的「持续 7 秒」已按用户口径取消：durationSeconds 只读 pvpSkill 行，"
        "skillParamJson 只能覆盖 damageRate/impactDamageRate，覆盖不了时长；"
        "要让 L3 变 7 秒得给 zone 参数加一条覆盖（约 3 行），当前不做。"
        "⚠ areaRadius=60 是**表格单位**，× combatDistanceScale(0.3) = 18 世界半径，"
        "与冰雕/龙卷风同档；要调范围改这一处即可，不需要动代码。",
    ),
}


def main():
    wb = openpyxl.load_workbook(PATH)
    ws = wb[SHEET]
    for row, cells in LEVELS.items():
        if str(ws.cell(row, 2).value) != "火焰树妖":
            raise RuntimeError(f"第 {row} 行不是火焰树妖，拒绝写入")
        for col, value in cells.items():
            ws.cell(row, col).value = value
        print(f"[ok] 第 {row} 行 L 列：{sorted(cells)}")
    for row, (mech, fx, mod) in CONTENT.items():
        name = ws.cell(row, 8).value
        if str(ws.cell(row, 2).value) != "火焰树妖":
            raise RuntimeError(f"第 {row} 行不是火焰树妖，实际为 {ws.cell(row, 2).value}，拒绝写入")
        ws.cell(row, 14).value = mech
        ws.cell(row, 15).value = fx
        ws.cell(row, 16).value = mod
        print(f"[ok] 第 {row} 行 {name}：详述 {len(mech)} 字 / 表现 {len(fx)} 字 / 落地 {len(mod)} 字")
    wb.save(PATH)
    print("已保存:", PATH)


if __name__ == "__main__":
    main()
