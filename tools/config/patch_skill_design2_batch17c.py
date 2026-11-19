# -*- coding: utf-8 -*-
"""第 17 批设计案同步（第三段，2026-11-18）：已落地的技能逐条改 P / S 两列。

与 `patch_skill_design2_batch17b.py`（补齐 K/L/M 三档那次）分工明确：
那段负责「把设计案拆清楚」，这段负责「**按实际落地的车道**改口径」——
落地时改过方案的地方（动态状态改成 pvpStatus 行、触发从冷却改成累计普攻……），
P 列必须写真实实现，否则下一个人会照着旧描述去找一段不存在的代码。

幂等：整格写固定文本，重复跑 `改 0`（打印 `[skip]`）。
用法：python tools/config/patch_skill_design2_batch17c.py
"""
import html
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import set_cell, read_zip_rows, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

# ────────────────────────────────────────── 第 86 行 · 101704 穿甲爆矢（毒箭蘑菇 68017）

P_101704 = (
    'skill 域 behaviorKey=trap_place（复用 103504 的 `castTrap` + `ZCGroundZoneSystem`），'
    '参数一律 trap* 前缀。两条新参数撑起「投掷段」：trapFlightSpeed=100（**逻辑 px / 秒**，'
    '2026-11-18 用户裁定「100px 是每秒」）+ trapFlightSeconds=2 —— 区域出生时带 moveVelocity '
    '朝目标飞，`flightSeconds` 读到 0 就地落地（`ZCGroundZoneSystem.settleFlight` 没收速度），'
    '落点之后的剩余寿命就是「停留」。⚠ 触发口径**不是冷却**：设计 J 列是「累计普攻 8 次」⇒ '
    'trapEvery=8，计数走独立的 `unit.trapFiredCount`（不复用 counterFiredCount，同卡还有自我增益时'
    '会互相吃次数）；被拒（参数不全）不消费次数，下帧重试。爆炸 trapExplodeRadius=150 / '
    'trapExplodeDamageRate=1.8/2.2/2.7；触碰半径 50 **只负责引爆、不给独立伤害**'
    '（不写 trapDamageRate —— `castTrap` 只在投掷形态放行「触碰伤害 0」，原地陷阱漏配仍然拒放）。'
    '「到期无人触碰直接消失」= trapExpireOnTimeout=0：区域带 expireRequiresContact，自然到期'
    '既不结算 expireDamage 也不播爆炸；踩响那一刻由 `contactTriggered` 放行整条到期通道。'
    '中毒走 **pvpStatus 三行** poison_bolt_l1~l3（periodic_damage + senderAttack + 1 秒一跳，'
    '15/25/35% × 6 秒），id 由计划行 statusId 列带进区域的 expireStatusId，'
    '由 `resolveExpiry` 挂给圈内每个还活着的人（不是只挂触发者）。停留 6/8/10 秒。'
)

# ────────────────────────────────────────── 第 106 行 · 102104 巨型仙人掌（仙人侍卫 68021）

P_102104 = (
    'skill 域 behaviorKey=self_aura（复用 `castSelfAura` 的波次区域：auraInterval=1 / '
    'auraDamageRate=0.5 / auraSeconds=6），本批新增两个参数：'
    '① auraBodySizePct=30 —— **百分点**（100 = ×2 ⇒ 30 就是「大 30%」、缩放 1.3），'
    '只进表现层（`ZCGameModel.syncBodyScale` 折成 `unit.bodyScale`，`bodyRadius` 一个字节不动）；'
    '② auraReflectPct=50/51/52 —— 受伤反弹，消费点 `ZCDamageResolutionSystem.applyReflect`：'
    '读**挨打那一方**身上的 reflectRate，按「实际掉的血」的 N% 打回攻击者，'
    '不过第二遍减伤 / 闪避，也**不递归**（否则双方互弹到天荒地老）。'
    '三项光环期自身增益（含既有的 auraSelfDamagePct）并进**同一条** `selfCastStatusId` 状态 —— '
    '生命周期都是「光环开着才成立」，分开挂会在 6 秒里出现三个图标、到期还错拍。'
    '⚠ 设计没给的两个值：J 列写「待定」⇒ 冷却取 12（与同批 101803 / 102603 同档）；'
    '只写「身周 / 附近」⇒ 半径取 120（与近战型光环 102403 冰山陨落同档）。'
)

# ────────────────────────────────────────── 第 110 行 · 102203 闪电链（雷蕉 68022）

P_102203 = (
    'skill 域 behaviorKey=chain_damage（**纯新增车道**，一行存量结算都没碰：'
    '`ZCAttackResolutionSystem.castChainLightning` + 触发系统 `applyChainLightning`）。'
    '参数一律 chain* 前缀（`skillParamJson` 按 68022:30231 合并，袋里还住着 102201 / 102202）：'
    'chainCooldown=12；chainTargetCount=3/4/6；chainDamageRate=0.9/1.0/1.2；'
    'chainFalloff=0/0.10/0.10 —— **复利**（第 k 跳 ×(1−0.1)^k ⇒ 100/90/81/72.9…），'
    '与 splashFalloff / bulletFalloff / pierceFalloff 同一套，I 级仍显式写 0；'
    'chainFinalCritMultiplier=1.5 **只出现在 III 级**（终跳与掷出的暴击取大者 ——'
    '「必暴 150%」是下限，玩家自己掷出更高暴击不该被压回来）。'
    '跳法是「当前落点最近的、这一轮还没挨过的敌人」，用 id 集合去重（单位池化会换对象）。'
    '六跳在**同一帧全部结算**（连锁要么全中、要么没人可跳时提前断），表现只把每跳的 '
    'startedAt 错开 0.05s；每跳一条 area 事件、起终点都写落点中心（视图从不按 radius 缩放、'
    '只按 to 摆位 + angleDegrees 转向，写包围盒中点会把整条链歪到一边），'
    'angleDegrees = 上一跳 → 这一跳；逐跳降透明度走新增的 effectAlpha（视图经宿主 UIOpacity 级联）。'
    '⚙ 美术复用磁电菇_劈雷序列帧（已在加载清单）—— 设计 O 列要的「两点拉伸电弧」等专用资源到位后'
    '只改 ZCChainLightningFx 的常量。'
    '⚠ 设计没给的值：**跳距**（N 列只说「最近」，没给范围）取 chainJumpRadius=150 逻辑 px'
    '（与 101803 / 101704 的 150 同档）；不给上限时「最近」会落在半张图外。'
    '⚠ 冷却用自己的 unit.chainReadyAt，**不复用** boltReadyAt（同卡的 102204 嗜血术还占着那条）；'
    '吃普攻射程闸门（release），只认「活着的敌方单位」——目标锁在建筑/地块上按无目标拒放、不消费 CD。'
)

# ────────────────────────────────────────── 第 155 行 · 103103 舞王召唤（艺术家 68031）

P_103103 = (
    'skill 域 behaviorKey=summon_unit（**纯新增车道**：`ZCGameModel.summonUnits` / `syncSummons` + '
    '触发系统 `applySummonUnit`）。⚠ 本行原先是 self_cast（selfCastDamagePct=240 = 本体限时增伤），'
    'desc 却早就是召唤口径 —— 两者不是一件事，按设计「等 summon_unit 落地时把这条参数整体换掉」处理：'
    'behaviorKey 与整袋参数一起换，旧 selfCastCooldown / selfCastSeconds / selfCastDamagePct '
    '三键已清零（`patch_king_dance_batch17.js` 回读断言「一个都不许残留」）。'
    '参数一律 summon* 前缀（`skillParamJson` 按 68031:30706 合并，袋里还住着 103101 / 103102 / 103104）：'
    'summonCooldown=12；summonCount=4（三档同值）；summonHpInherit=0.80/0.90/1.00；'
    'summonAttackInherit=0.60/0.70/0.80；summonSeconds=6/7/8；summonFollow=1；'
    'summonSlotRadius=60；summonAlpha=0.60。'
    '「不计入单位上限」走 `spawnUnit(..., ignoreUnitCap=true)`（拆城 Boss 的同一条既有通道，不是新开口子）；'
    '继承值写 `inheritedStats` 而不是改 definition（`effectiveDefinition` 每帧从缓存折算，'
    '只有落在单位身上才不会被下一次刷新冲掉），基准取「本体**当前**的继承值」⇒ 链式继承不会一代比一代虚高'
    '（与 `cloneGateUnit` 同口径）。'
    '跟随＝每帧在 `ZCUnitSystem.update` **之前**把位置钉到「本体坐标 + 阵位角（135/45/225/315，'
    '随本体 facingRadians 一起转）× summonSlotRadius」，走 `placeAt(..., keepFacing=true)` —— '
    '朝向不能被「位移方向」覆盖，否则本体一转圈，四个舞伴各自扭头看自己"飞过去"的方向。'
    '索敌/攻击走 `ZCUnitSystem` 里独立的召唤物短路：只 `targeting.acquire` + 普攻，不参与阵型 / 自由行军'
    '（N 列「只做普攻与被动」）。'
    '到期由 `syncSummons` 置 dead + deathRemoveAt=now ⇒ 同一帧经 `removeDeadUnits` 摘掉，'
    '不进阵亡动画（「到期一起消失」）；本体先死 / 先被移除则舞伴跟着收场，否则位置无从算起。'
    'CD 用自己的 `unit.summonReadyAt`，**不复用** selfCastReadyAt（同卡 103104 迪斯科旋风占着）；'
    '不设普攻射程闸门 —— 舞伴的作用是「多几双手」，用射程挡会变成「远处有怪就不召」，'
    '而 N 列本来就要求取消硬范围、跟着本体走。'
    '⚠ 设计没给的两个值：N 列只写「半透明」⇒ summonAlpha=0.60（视图经宿主 UIOpacity 级联整棵子树）；'
    'O 列「半径约 60px」按**逻辑 px** 落 summonSlotRadius=60（与 auraRadius / splashRadius 同一套表值口径，'
    '代码里再乘 combatDistanceScale）。'
    '⚙ 美术直接复用本体 prefab（同一张卡），半透明由视图叠 opacity，不另做一套美术；'
    'O 列「出生特效错开 0.1s 播 4 次」等专用出生特效应到位后再补表现层（当前是本体出生表现）。'
)

# ────────────────────────────────────────── 第 71 行 · 101404 一人成军（分裂菇 68014）

P_101404 = (
    'skill 域 behaviorKey=summon_unit（**复用**第 17 批 103103 那条车道，一行新代码没加：'
    '`ZCGameModel.summonUnits` / `syncSummons` + `applySummonUnit`）。'
    '与舞王的唯一区别在**触发**：设计 K 列写的是「累计普攻 8 次后召唤」⇒ `summonEvery = 8`，'
    '计数走独立的 `unit.summonFiredCount`（不借 `summonReadyAt` —— 同卡 101403 菌丝突刺有冷却，'
    '共用一格会变成「放完分身、突刺也进冷却」；也不借 `counterFiredCount` —— 101401 连击那条链也在数普攻）。'
    '第一次推进只记下当前 `completedAttackCount`，不补放；被拒（参数不全）不消费次数。'
    '参数一律 summon* 前缀（`skillParamJson` 按 68014:30216 合并，袋里还住着 101401 / 101402 / 101403）：'
    'summonCount=3/4/6；`summonHpInherit = summonAttackInherit` = 0.30/0.50/0.80 —— '
    '设计说「继承本体 30%/50%/80% 属性」，没分生命与攻击，所以两格同值。'
    '持续：**不配 `summonSeconds`** ⇒ 走「到战死为止」那条分支（2026-11-18 用户裁定）。'
    '跟随：**不配 `summonFollow`** ⇒ 放出去自己走。设计案 P 列旧稿写的 followOwner=true 不采用，'
    '两条理由：① N 列只要求「只做普通攻击与被动技能」，没要求跟随；'
    '② 固定阵位只有 4 个（舞王那四个角），6 只分身会两两叠在同一个角上 —— 那是静默的画面错。'
    '不计入上限走 `spawnUnit(..., ignoreUnitCap = true)`（与 103103 同一条既有通道）。'
    '⚠ 本条**没有补值**：触发阈值、数量、继承比例全部来自设计 K/L/M 三列。'
)

# ────────────────────────────────────────── 第 111 行 · 102204 嗜血术（雷蕉 68022）

P_102204 = (
    'skill 域 behaviorKey=team_buff（**纯新增车道**：`ZCSkillTriggerSystem.applyTeamBuff`）。'
    '与既有的 `team_aura` 只差一件事：**有窗口**。光环是常驻的，这条是「开 N 秒、每 CD 开一次」；'
    '参数一律 teamBuff* 前缀（`skillParamJson` 按 68022:30231 合并，袋里还住着 102201 孢子弹幕 / '
    '102202 职业猎杀协议 / 102203 闪电链）：'
    'teamBuffCooldown=8（设计 J 列）；teamBuffRadius=190（**设计没给「周围」多大**，'
    '与 68031 / 68023 的共生信号光环同档）；teamBuffSeconds=5/6/8；'
    'teamBuffDamagePct=15/25/40 → 状态 `damageRatePct`（只在伤害结算处乘一次，不抬面板）；'
    'teamBuffAttackSpeedPct=0/15/30 → 状态 `attackIntervalPct`（正值 = 间隔缩短；'
    '**I 级显式写 0**，省了会被下一个人补成 15 而把 I 级改强）。'
    'III 级两格：teamBuffKillExtendSeconds=1 + teamBuffKillExtendMaxSeconds=4。'
    '🔴 延长按**受惠者自己**的 `killCount` 增量算，不记在施法者身上（设计 N 列「延长在每个目标'
    '自身的状态上独立计时」）：受惠者身上三个字段 `teamBuffUntil` / `teamBuffKillBase` / '
    '`teamBuffExtendUsed`，封顶按「已延长总秒数」判、额度用完后基线照推平（否则额度一放开会把'
    '攒着的击杀一次性补上）。`killCount` 只在 `ZCDamageResolutionSystem.damageUnit` 里由'
    '**打出最后一击的人**累加 —— 反射打死的不记（那条路径没有归属，硬算会把功劳记到挨打的人身上）。'
    '🔴 续挂时长 0.6 秒（与 `TEAM_AURA_SECONDS` 同档）而不是「整段窗口」：设计 N 列要求'
    '「友军离开范围即失去效果」，续挂时长就是「离开半径后多久掉」；而且只续到受惠者自己的截止'
    '时刻，否则最后一个 tick 会把状态多拖 0.6 秒，目测是「窗口关了人还亮着」。'
    '施法者自己也吃这条增益（距离 0 恒在半径内），与 `team_aura`「含自身」同一口径。'
    '⚠ 本条**只有一个补值**：半径 190。'
)

# ────────────────────────────────────────── 第 116 行 · 102304 大吼大叫（南瓜战神 68023）

P_102304 = (
    'skill 域 behaviorKey=roar（**纯新增车道**：`ZCAttackResolutionSystem.castRoar` 落地形判定与结算，'
    '`ZCSkillTriggerSystem.applyRoar` 管触发）。参数一律 roar* 前缀（`skillParamJson` 按 68023:30216 合并，'
    '袋里还住着 102301 荆棘光环 / 102302 被动 / 102303 冲锋猛击）：'
    'roarCooldown=8（设计 J 列）；roarRadius=150（**设计没给「周围」多大**，与 101803 毒液喷吐 / '
    '101704 投掷炸弹同档）；roarDamageRate=0.8/1.1/1.5；roarSeconds=3/4/5。'
    '🔴 减攻挂 `attackPct` = -20/-30/-40（**抬/降面板攻击**），不是 `damageRatePct` —— '
    '后者是「本次造成的伤害乘一个系数」，只在结算处生效一次、面板上看不见；'
    '设计 K 列说的是「降低攻击」，所以走面板格。状态 id `__roar:<pct>:<秒>__`，同参数复用同一条定义。'
    'III 级 roarAllyShieldRatio=0.15：护盾量 = **施法者**最大生命 × 15%（不是受惠者自己的），'
    '因为设计 M 列写「自身 15% 最大生命」；取值走 `Math.max(现有护盾, 新护盾)` 而不是叠加，'
    '同时写 `shieldExpireAt = 施放 + roarSeconds`，到期由 `ZCSkillTriggerSystem.expireShield` 清零 —— '
    '设计 N 列「一次性吸收、不回复、到期失效」三条都在这一处兑现（清零不清 HP，所以不会变相回血）。'
    '施法者自己只要在半径内（距离 0 恒成立）也吃这份护盾。'
    '🔴 CD 走**独立**的 `unit.roarReadyAt`：同卡的 102303 冲锋占着 `dashReadyAt`、'
    '102301 光环每帧续挂不要 CD；共用一格会让「放完怒吼、冲锋也进冷却」。'
    '🔴 半径内一个敌人都没有 ⇒ **拒放**（`castRoar` 返回 false），触发层不写 `roarReadyAt`，'
    '下帧继续试 —— 否则对空气吼完白吃 8 秒 CD（101704 投掷陷阱同一口径）。'
    '伤害走一条 `area` 事件（怒吼的环），`from`/`to` 同点 = 施法者位置、`radius` 照 150。'
    '⚠ 本条**只有一个补值**：半径 150。'
)

# ────────────────────────────────────────── 第 101 行 · 102004 飓风（三叶小丑 68020）

P_102004 = (
    'skill 域 behaviorKey=storm_zone（**纯新增车道**：`ZCAttackResolutionSystem.castStorm` 建区域、'
    '`ZCSkillTriggerSystem.applyStorm` 管 CD、`ZCGroundZoneSystem` 负责「会飘」和「会拽」两件事）。'
    '参数一律 storm* 前缀（`skillParamJson` 按 68020:30714 合并，袋里还住着 102001 / 102002 的克制条）：'
    'stormCooldown=12（设计 J 列）；stormSeconds=6/7/8；stormInterval=0.5 与 stormDamageRate=0.1 '
    '（设计「每 0.5 秒造成 10% 伤害」，都是 K/L/M 的原话）；stormWanderSpeed=10（N 列「移动速度为 10px」）。'
    '🔴 **不设 `hitOncePerUnit`**：那是「同一个敌人全程只挨一次」（第 16 批 101303 的接触判定），'
    '这条设计明写「每 0.5 秒造成 10%」，站在风里就得一直挨 —— 靠 `waveInterval = 0.5` 复打。'
    '🔴 牵引**没有**挂 `legacyTraction` 状态，虽然 N 列说「与已有的 legacy_traction 完全契合」：'
    '那条车道的力心是**单位坐标**（挂在施法者身上），套过来会变成「把人往三叶小丑身上拽」；'
    '设计要的是往**风心**拽，而风心每秒换一次方向。所以算法与常量照抄（只拽敌方、'
    '最小距离 `20 × combatDistanceScale`、每步 `speed × dt` 且不超过「到最小距离的剩余」），'
    '只把力心换成区域圆心（`ZCGroundZoneSystem.pullEnemies`）。'
    '🔴 「方向随机变化」走 `context.random`（对局种子），不用 `Math.random` —— 后者会让同一份快照'
    '在回放 / 重算时飘出不同路径，而且不报错。'
    '🔴 场上没有敌人**不拒放**（与怒吼 102304 相反）：区域活 6~8 秒、还会飘，敌人走过来照样挨打、'
    '照样被拽；一次性爆发打空气才是白吃 CD。'
    '表现复用 `风法师_龙卷风`（`ZCStormFx`，与 101303 同一份美术）—— 资源清单按 68020 单独收一遍，'
    '否则「技能照常掉血、场上一团风都没有」。'
    '⚠ 本条**五个补值**：杀伤半径 90、换向间隔 1 秒、牵引速度 60 逻辑 px/s、牵引范围 150、'
    '生成点为施法者脚下（设计只说「在场上生成」）。'
)

# ────────────────────────────────────────── 第 176 行 · 103503 射线集束（科学家 68035）

P_103503 = (
    'skill 域 behaviorKey=ray_beam（**纯新增车道**：`ZCAttackResolutionSystem.castRayBeam` 建区域、'
    '`ZCSkillTriggerSystem.applyRayBeam` 管次数）。'
    '🔴 这一行是**整袋换车道**，不是改个数：原 `behaviorKey = skill_params`、袋里装的是副轨主动的'
    '`secondaryCooldown / secondaryDamageRate / secondaryFanDeg / secondaryRadiusScale`，'
    '而 `desc` 早就是射线口径 —— 名字与参数对不上，实际放出来是「身前扇形甩一下」'
    '（与第 17 批 103103 舞王召唤同一个病）。旧四键已显式断言一个不剩。'
    '参数一律 ray* 前缀（`skillParamJson` 按 68035:30709 合并，袋里还住着 103501 穿甲苔刺 / '
    '103502 苔针双连 / 103504 精密陷阱）：rayEvery=8（设计 I 列「主动-累计普攻 8」，**没有冷却**）；'
    'raySeconds=2/3/4、rayInterval=0.2、rayDamageRate=0.20/0.25/0.35（K/L/M 原话）；'
    'rayVulnPct=0/10/20 → 状态 `damageTakenPct` **正值**（正 = 受到的伤害变高；写成负会变成减伤自残）；'
    'III 级 raySpotRadius=60 + raySpotDamageRate=0.5（末端光斑）。'
    '🔴 射线**不设 `hitOncePerUnit`**：设计是每秒 5 跳，「目标离开射线立即停止结算」由「每波按当前矩形'
    '重判」天然满足，不需要去重。'
    '🔴 III 级光斑是**第二个区域**，不是主区域的 `expireDamage`：`expireDamage` 按**区域中心**的圆结算，'
    '而光斑在射线末端（差一整条射线）。建一个 `wavesLeft = 0` 的小区域，与主区域同 `remainingSeconds`，'
    '靠它的到期通道在「射线消失那一拍」炸一次（N 列原话）。'
    '🔴 `area` 事件**不按 radius 缩放** ⇒ 光束长度靠事件级 `effectScale`（`ZCGroundZoneState.effectScale`，'
    '本轮新增；`syncHoldVisual` / `resolveWave` / `pushExpireVisual` 三处一起抄）。'
    '表现复用磁电菇「磁电冲击」那条横向雷电束（`雷电冲击`，`ZCRayBeamFx`），资源清单按 68035 单独收一遍。'
    '⚠ 本条**五个补值**：射线半长 120 / 半宽 36（长宽比 3.33，与复用美术 180:54 同比例，'
    '否则光束会被拉成一块板子而判定照旧）、起点前移 30、破甲残留 0.3 秒、光斑半径 60。'
)

#  链号 → (行号, P 列, S 列)。后续技能做完就直接往这里加一条。
SKILLS = {
    101704: (86, P_101704, '已实现'),
    102104: (106, P_102104, '已实现'),
    102203: (110, P_102203, '已实现'),
    103103: (155, P_103103, '已实现'),
    101404: (71, P_101404, '已实现'),
    102204: (111, P_102204, '已实现'),
    102304: (116, P_102304, '已实现'),
    102004: (101, P_102004, '已实现'),
    103503: (176, P_103503, '已实现'),
}


def load_shared_strings(path):
    with zipfile.ZipFile(path) as archive:
        raw = archive.read('xl/sharedStrings.xml').decode('utf-8')
    return [html.unescape(re.sub(r'<[^>]+>', '', block))
            for block in re.findall(r'<si>(.*?)</si>', raw, re.S)]


def cell_text(xml, ref, strings):
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


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    strings = load_shared_strings(XLSX)
    changed = 0
    for chain, (row, note, status) in SKILLS.items():
        #  守卫：行号必须真的对应这条链（表里插过行，写错行会把别人的描述洗掉）。
        got = cell_text(xml, 'G%d' % row, strings)
        if got != str(chain):
            raise SystemExit('[fail] 第 %d 行的技能 ID 是 %r，不是 %d' % (row, got, chain))
        for column, text in (('P', note), ('S', status)):
            ref = '%s%d' % (column, row)
            if cell_text(xml, ref, strings) == text:
                continue
            xml = set_cell(xml, ref, text)
            changed += 1
            print('[ok] %s（第 %d 行 %s 列）' % (ref, row, column))
    if not changed:
        print('[skip] 设计案已是目标值')
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 共改 %d 格；备份 → %s' % (changed, backup))


if __name__ == '__main__':
    main()
