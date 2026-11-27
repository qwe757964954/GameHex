# 占城大师（zcds）表现层与领地专项规范

> **定位与适用范围**：
> - 本文档拆分自 [AI架构与代码规范.md](AI架构与代码规范.md) 原第 `7.3.3` ~ `7.3.11` 节，维护**对局表现层（`app/zcds/view`）与「冒险」领地页（`app/territory`）的业务与表现规格**。其中参数和功能范围适用于对应模块，不是全工程 Agent 禁令；本次明确需求变更时，同步调整实现、配置、本文与相关测试。
> - 凡涉及对局棋盘图层、地块激活/脉冲/卡牌/建筑动画、特效缩放、飘字曲线、自选主城、开局归属扩散波、胜利扫场、传说卡横幅以及领地页（含领地喷发 / 资源读数）的修改，必须先核对本文档中的**唯一写入口**、**不变量**与**回归测试判据**。
> - 仅按本次任务读取相关章节。旧入口中的参数、旧实现与历史范围完整保存在[旧入口业务与表现记录](history/2026-10-31-旧入口业务与表现记录.md)，仅在追溯或核对差异时读取，不作为当前规格或强制规则；本文中的取值演进、旧方案也按历史说明处理。

## 模块核心写入口与必跑单测速查表

| 功能域 | 关键文件 / 唯一写入口 | 必跑单测判据（`npx tsx --test <路径>`） |
| :--- | :--- | :--- |
| 棋盘图层与城墙 y 排序 | `ZCGameBoard.prefab` / `ZCGameRenderWorld.boardLayer`、`renderWallSystem` | `tests/zcds-progress.test.ts`、`tests/zcds-render-performance.test.ts` |
| 地块/建筑/资源图标缩放 | `ZCHexView.renderContent`（图标）、`applyBuildingScale`（建筑） | `tests/zcds-tile-icon-scale.test.ts`、`tests/zcds-building-icon-scale.test.ts`、`tests/zcds-resource-icon-scale.test.ts` |
| 中立资源抬层与兵团落点 | `ZCHexView.setResourceIconRaised`、`applyIconPosition`、`layoutResourceUnits` | `tests/zcds-resource-icon-layer.test.ts`、`tests/zcds-resource-unit-preview.test.ts` |
| 地块激活（脉冲∥缩没→卡牌→建筑） | `ZCHexView.hexActivationFx`、`hexPulseShrinkFx`、`applyTileTransform` | `tests/zcds-hex-activation.test.ts`、`tests/zcds-card-reveal-pop.test.ts`、`tests/territory-hex-flip.test.ts` |
| 点击脉冲的 5 帧序列（对齐缩放 / 一次性退场） | `ZCHexView.applyPulseRipple`、`HexFlipPresentation.hexPulseFx`（`pulseFrame`） | `tests/zcds-hex-activation.test.ts` |
| 单位出生抖动 & 建筑产兵/产金抖动 | `ZCUnitView.playSpawnShake` / `ZCHexView.playBuildingShake`、`drainBuildingShakes` | `tests/zcds-unit-spawn-shake.test.ts`、`tests/zcds-building-spawn-shake.test.ts` |
| 新扩展邻格生成动画（与脉冲同起） | `ZCHexView.noteDevelopableSpawn` / `advanceDevelopableSpawn`、`ZCGameRenderWorld.renderDevelopableSpawns` | `tests/zcds-hex-neighbor-spawn.test.ts` |
| 出生 / 受击 / 阵亡特效缩放 | 各特效 `.prefab` 根 `_lscale` / `ZCEffectPool.playSpawnFx`、`playDeathFx`、`playHitFx` | `tests/zcds-hit-fx.test.ts` |
| 受击特效总时长锁 0.15s（加速、无定格） | `ZCEffectPool.HIT_FX_TARGET_SECONDS` / `state.speed`、`ZCGameModel.HIT_FX_SECONDS` | `tests/zcds-hit-fx.test.ts` |
| 出生特效锁总时长 1.25s（speed 由 clip 反推） | `ZCEffectPool.SPAWN_FX_TARGET_SECONDS` / `state.speed` | `tests/zcds-spawn-fx.test.ts` |
| 传说卡出场横幅（金卡 tier 4） | `ZCGameLegendBanner.prefab` / `legendRoleProgress`、`legendRoleEase` | `tests/zcds-legend-banner.test.ts` |
| **战斗技能特效：锚点 / 层级 / 飞行段 / 朝向**（2026-11-02） | `ZCCombatEffectPlacement.ts` / `ZCCombatEffectFlight.ts`（均按 prefab 路径配）/ `ZCCombatEffectView.render` | `tests/zcds-combat-effect-placement.test.ts`、`tests/zcds-combat-effect-flight.test.ts` |
| **冲刺（运动霸「拳击冲撞」）**（2026-11-02 接线） | `ZCUnitSystem`（`chargeSpeedScale` → `speedScale` + `unit.charging`）/ `ZCUnitTargeting.chargeSpeedScale` / `ZCUnitView` 动作切换 | `tests/zcds-charge.test.ts` |
| **技能释放的触发范围（待触发闸门）**（2026-11-11，见 §13） | `ZCUnitTargeting.hasTargetInAttackRange` / `attackReachOf` → `IZCSkillTriggerContext.inAttackRange` / `attackReachOf` → `ZCSkillTriggerSystem.tick` | `tests/zcds-skill-trigger-range.test.ts`、`tests/zcds-skill-trigger.test.ts` |
| **施法动作窗口 + buff 类原地锁**（2026-11-13，见 §18） | `ZCUnitCastAction.ts`（两条时长）/ `ZCSkillTriggerSystem.markCastAction` / `ZCUnitSystem.updateUnit`（`castHoldUntil` 分支）/ `ZCUnitView`（`casting` 进片段三元） | `tests/zcds-unit-cast-action.test.ts` |
| **命中附加特效的落点**（2026-11-18，见 §31） | 配置列 `pvpSkill.impactEffectAnchor`（0~1）→ `ZCImpactEffectFx.zcImpactEffectAnchor` / `ZCAttackResolutionSystem.pushImpactEffect` | `tests/zcds-impact-effect-anchor.test.ts`、`tests/zcds-charge.test.ts` |
| **五雷轰顶 `bolt_strike` + 磁电冲击 `self_aura`（累计普攻）+ 软控麻痹 `numb`**（2026-11-11，见 §14） | `ZCSkillTriggerSystem.applyBoltStrike` / `applySelfAura`（`auraEvery`）/ `ZCAttackResolutionSystem.castBoltLine` / `ZCBoltStrikeFx.ts` / `ZCStatusSystem.attackBlockedOf` + `ZCUnitSystem.startAttack` | `tests/zcds-magdi-mushroom.test.ts`、`tests/zcds-skill-trigger.test.ts` |
| 「冒险」领地页与台面中心对齐 | `TerritoryPresenter.ts` / `TerritoryMapView.cellCenter`、`applyIconPlacement` | `tests/territory-presenter.test.ts`、`tests/territory-page-split.test.ts`、`tests/territory-cell-center-align.test.ts` |
| 敌方单位顶点色置灰 | `ZCUnitView.applyVisualTint` | `tests/zcds-unit-view-render.test.ts` |
| 自选主城（选择基地模式） | `ZCSpawnSelection.defaultHexFor`、`isPlacing` / `borrowSpawnConfirmButton` | `tests/zcds-spawn-base-confirm.test.ts` |
| 战斗飘字「快进慢出」与收尾漂移 | `ZCFloatTextView` / `floatTextEntrance`、`floatTextFade`、`floatTextDrift` | `tests/zcds-float-text-gold-icon.test.ts`、`tests/zcds-progress.test.ts` |
| **伤害飘字的纵向方向**（我方造成向上飞 / 挨打向下坠，镜像同距，2026-11-23，见 §6.5） | `ZCFloatTextView.damageTravelSign` / `dealtByPlayer`、`takenFromPlayer` | `tests/zcds-damage-float-text.test.ts` |
| **头像列可以填直路径**（key 优先、落空按路径拆；打表统一 `icons/cardHead`，2026-11-23，见 §38） | `HeadArtModel.iconArtTargetOfPath` / `createIconArtResolver` / `tools/config/sync_monster_head_icon.py` | `tests/card-head-icon.test.ts` |
| **战斗统计面板：开局铺满阵容 / 数值降序 / 敌方头像切换**（2026-11-24，见 §41） | `ZCDamageStats.compareDamageStatsRows` / `buildDamageStatsColumns`（第三参 `enemyOwner`）/ `ZCBattleRuntimeController.damageUnits`（补阵容）/ `GameRunAway.prefab` 的 `EnemySeats` | `tests/zcds-damage-stats.test.ts`、`tests/zcds-settlement.test.ts`、`tests/battle-runtime-controller.test.ts` |
| **结算页 MVP 徽标坐标归 prefab**（自适应「推徽标」会把徽标拽回旧坐标，2026-11-24，见 §42） | `ZCSettlementMvpActor`（只摆立绘，不碰 `MvpBlock` 其它子节点）/ `ZC_SETTLEMENT_STYLE.mvpArt.maxHeadTopInBlock` / `ZCSettlement.prefab` 的 `MvpBlock` | `tests/zcds-settlement-page.test.ts` |
| **伤害统计的柱子 = 占全队总量的占比**（分母从「列内最大值」改成「该席位全队合计」，2026-11-24，见 §43） | `ZCDamageStats.damageStatsBarRatio(value, total)` / `buildDamageStatsColumns` 的 `totalOwn` / `totalEnemy` / `RunAwayUnitItem.render(value, total, …)` | `tests/zcds-damage-stats.test.ts`、`tests/zcds-settlement.test.ts` |
| 开局归属扩散波 | `ZCClaimWave` / `buildClaimWavePlan`、`ZCHexView.setClaimWave` | `tests/zcds-territory-claim-wave.test.ts` |
| 胜利结算三段式扫场（铺场/回正/脉冲） | `ZCVictorySweep` / `zcDeepFactionColor`、`setSweepOwner`、`appendHexPulseOutlineSegments` | `tests/zcds-progress.test.ts`、`tests/zcds-outline-layer.test.ts` |
| **结算胜负 UI 特效与地块翻转同起同落**（胜利/失败两段骨架、720 宽铺满、时长 = 扫场总时长，2026-11-25，见 §46） | `ZCGame.playOutcomeEffect` / `advanceOutcomeEffect`、`ZCGameRenderWorld.victorySweepSeconds`、`ZCSettlementOutcomeStyle`、`view/ZCUISpineBannerFx`、`model/ZCUISpineBannerStyle`、`ZC_BATTLE_FX_PATHS.settlementOutcomeSkeleton` | `tests/zcds-outcome-effect.test.ts` |
| **对局开始「开局对战」横幅**（全景停留 0.45s 内播一次、推镜头即关窗、720 宽铺满，2026-11-25，见 §48） | `ZCGameHUDView.playMapIntro` / `setBattleStartEffect` / `playBattleStartEffect`、`ZCBattleStartStyle`、`view/ZCUISpineBannerFx`、`ZC_BATTLE_FX_PATHS.battleStartBanner` | `tests/zcds-battle-start.test.ts` |
| **冰法师通用子弹**（急冻瓜【急冻光线】弹体 + 【冰山陨落】落地一击共用；循环序列帧、朝向 −90°、落地 180°，2026-11-25，见 §50） | `ZC_EFFECT_PATHS.iceMageBullet` / `.iceMageBulletImpact`、`ZC_EFFECT_MISSILE_BY_UNIT['68024']`、`ZCSelfAuraFx.ZC_SELF_AURA_LANDING_ANGLE_DEGREES`、`tools/build_ice_mage_bullet_fx.py` | `tests/zcds-ice-mage-bullet-batch51.test.ts` |
| **区域洒弹：子弹从区域上方垂直下落**（篮球天才 / 急冻瓜 / 杰克藕；纯表现，判定圆心仍是落点，2026-11-25，见 §51） | `model/ZCProjectileDropStyle.ts`（`ZC_BULLET_DROP_UNITS` / `ZC_BULLET_DROP_HEIGHT_PX` / `zcBulletDropHeightOf` / `zcBulletDropOffsetPx`）→ `ZCGameTypes.dropFromPx` → `ZCCombatEffectView` / `ZCSkillResolutionSystem`（self_aura 落地 · `random_strike`）/ `ZCGroundZoneSystem.resolveWave` | `tests/zcds-bullet-drop-batch52.test.ts` |
| **角色前后关系：层 + 屏幕 y**（分身垫底 / 地面按 y / 飞行与中立野怪整体在地面之上，y 大的先画，与墙砖同口径；2026-11-26 第 55 批，见 §54） | `model/ZCCharacterDrawOrder.ts`（`zcCharacterTierOf` / `zcCharacterDrawOrder` / `ZC_CHARACTER_TIER_SUMMON&#124;GROUND&#124;AIR`）、`ZCGameRenderWorld.characterLayer` / `ensureCharacterLayer` / `attachToCharacterLayer` / `renderCharacterOrder`、`ZCHexView.setCharacterLayer` / `syncMonsterTrailingNodes` / `monsterBodyNode` / `monsterTrailingNodes` | `tests/zcds-character-draw-order-batch55.test.ts`、`tests/zcds-resource-unit-preview.test.ts` |
| **野怪三态染色 + 集火特效贴血条 3px**（未激活压亮且**不压透** / 激活暗红 / 被玩家方打下回原色并播一次出生特效，2026-11-26，见 §53） | `model/ZCMonsterPresentation.ts`（`zcMonsterTintStateOf` / `ZC_MONSTER_TINTS` / `zcMonsterFocusSpineY` / `zcMonsterFocusButtonY`）、`ZCHexView.positionMonsterHeader` / `noteMonsterCapture` / `consumeMonsterCapturedFx` / `monsterFxHost`、`ZCGameRenderWorld.renderNeutralFeatures`（`effectPool.playSpawnFx`） | `tests/zcds-monster-status-batch53.test.ts`、`tests/zcds-resource-unit-preview.test.ts` |
| **集火：特效美术底边贴血条 3px + 放大 1.5 + 点击提示**（锚点要减 `\|bounds.y\|×scale`；按钮恒可点，「能不能集火」由模型判原因弹吐司；2026-11-26 第 56 批，见 §57） | `model/ZCMonsterPresentation.ts`（`zcMonsterFocusSpineArtLiftPx` / `zcMonsterFocusSpineScale` / `ZC_MONSTER_FOCUS_SPINE_SCALE` / `ZC_MONSTER_FOCUS_TOAST` / `IZCMonsterFocusToggleResult`）、`systems/ZCNeutralFeatureSystem.focusBlockReason` / `toggleFocus`、`ZCGameModel.toggleMonsterFocusResult`、`ZCHexView.monsterFocusSpineArtLiftValue` / `monsterSpineBaseScale` / `renderMonsterFocus`、`ZCBattleRuntimeController.onMonsterFocus` / `showMonsterFocusToast`、`IZCBattleRuntimeServices.toast`、`BattleComposition.createRuntimeServices` | `tests/zcds-monster-focus-batch56.test.ts`、`tests/zcds-monster-status-batch53.test.ts`、`tests/zcds-resource-unit-preview.test.ts` |
| **塔防 BOSS 波预警 UI 特效**（720 宽 = `_lscale 720÷画布`；按 `currentWaveIsBoss` + `waveId` 去重；只在守城局加载；2026-11-26 第 57 批，见 §58） | `assets/bundles/battle/units/effects/BOSS来袭UI特效/BOSS来袭UI特效.prefab`、`model/ZCBossWarningStyle.ts`（`ZC_BOSS_WARNING_ANIMATION` / `zcShouldPlayBossWarning`）、`model/ZCGameResourcePlan.ZC_BATTLE_FX_PATHS.bossWarningBanner`、`ZCGame.loadBossWarningBanner`、`ZCGameHUDView.setBossWarningEffect` / `playBossWarningEffect`、`ZCUISpineBannerFx` / `ZCUISpineBannerStyle.zcUiBannerScale` | `tests/zcds-boss-warning-batch57.test.ts`、`tests/zcds-battle-start.test.ts`、`tests/zcds-outcome-effect.test.ts` |
| **弹道雨连发 + 起点抬 25px + 白环 150px/s 滑动 + 子弹 70%**（逐颗 0.1s 出手但伤害仍在施法那拍结算；圈换目标滑过去不瞬移；七颗 prefab 与拖尾同缩 70%；起点 = 角色图片中心 +5px；2026-11-26 第 58 批，见 §60） | `ZCProjectileDropStyle.ZC_BULLET_RAIN_SHOT_INTERVAL_SECONDS` / `ZC_BULLET_RAIN_ORIGIN_LIFT_PX`、`systems/ZCSkillResolutionSystem.strikeTargets`（`fireAt`）、`systems/ZCGroundZoneSystem`（zone 叠加抬升）、`ZCSkillRangeRingFx.ZC_SKILL_RANGE_RING_SLIDE_SPEED`、`ZCGameTypes.ZCCombatEvent.slideFrom*/slideStartAt/slideSeconds`、`view/ZCCombatEffectSlide.zcCombatEffectSlidePoint`、`view/ZCCombatEffectView`、`ZCEffectCatalog.ZC_EFFECT_TRAIL_SPECS`、`tools/build_card_bullet_fx.py` | `tests/zcds-bullet-rain-batch55.test.ts`、`tests/zcds-card-bullet-batch57.test.ts`、`tests/zcds-bullet-drop-batch52.test.ts`、`tests/zcds-combat-effect-placement.test.ts` |
| **集火按钮的灰跟野怪三态走**（解锁但怪没醒 ⇒ 循环 + **仍压灰**；激活才回原色；定格只跟解锁；2026-11-26 第 59 批，见 §57.7） | `model/ZCMonsterPresentation.zcMonsterFocusSpineVisualOf` / `type ZCMonsterFocusSpineVisual`、`ZCHexView.renderMonsterFocus`（复用 `zcMonsterTintStateOf`）/ `applyMonsterFocusSpine` / `MONSTER_FOCUS_DIM_TINT` | `tests/zcds-monster-focus-grey-batch59.test.ts`、`tests/zcds-resource-unit-preview.test.ts`、`tests/zcds-monster-focus-batch56.test.ts` |
| **大招通报：传说卡放主动技**（卡面图 + 技能名，白字粗体 + 黑描边 2px、每条主动技各一次、串行各 2.3s；事件路径 + **行为车道路径**，2026-11-25，见 §45 / §45.1） | `ZCGameModel.announceLegendSkillCasts` / `isActiveSkillCast` / `announceActiveCast` / `castWithAnnounce`、`ZCSkillTriggerSystem` 的 `blinkTo(…, behaviorKey)` / `announceCast`、`zcAnnounceSkillNameIndex`、`ZCBattlePresentationQueue.pushSkillAnnounce`（串行游标）、`ZCSkillAnnounceStyle`、`view/ZCSkillAnnounceFx`、`ZC_BATTLE_FX_PATHS.skillAnnounceSkeleton`、美术交付物 `units/effects/大招技能提示特效/大招技能提示特效.prefab`（§45.2，运行时**不读**它）、日志档 `ZCDC_LOG_SKILL_ANNOUNCE` | `tests/zcds-skill-announce.test.ts` |
| **废墟地块底色按归属方混合灰**（2026-10-29） | `ZCTheme.zcRuinsFactionColor` / `ZCHexView.territoryTint`（`ZCHexView.TERRITORY_FILL_ALPHA`） | `tests/zcds-ruins-tile-color.test.ts` |
| **废墟建筑不再产金**（主城那一路原来无条件发钱，2026-10-29） | `ZCEconomySystem.tickIncome` / `isIncomeSource`、`isBuildingOperational` | `tests/zcds-ruins-income.test.ts` |
| 开局金矿格整圈描边呼吸（绿色 · 9px · 棋盘最上层） | `ZCGameViewUtil.zcNeutralHintAlpha` / `ZCHexView.strokeHintOutline` / `ZCGameRenderWorld.ensureHintOutlineGraphics` | `tests/zcds-neutral-hint-outline.test.ts` |
| 对局中立资源奖励**金币飞向战斗金币栏**（6 枚错峰飞行 + 金币栏读数上飘，2026-11-04 恢复） | `ZCGame` 金币栏目标装配 / `view/ZCGameRenderWorld.renderNeutralRewards` / `view/ZCNeutralRewardFx` / `ZCBattlePresentationQueue.ZC_NEUTRAL_REWARD_TOTAL_SECONDS` | `tests/zcds-neutral-reward-fx.test.ts` |
| 领地随机资源格「翻开」（**原地碎裂**，2026-10-16 起只剩这一套） | `core/hex/HexFlipPresentation.hexShatterFx` / `TerritoryHexFlip.applyFace`、`applyReveal` | `tests/territory-hex-flip.test.ts` |
| 领地建筑**生成抖动**（先 Y 后 X，120%）+ **展示滞后到翻转结束** | `core/hex/ShakePresentation` / `TerritoryStationView.playBuildingShake`、`TerritoryMapView.pendingBuildingReveal`、`ITerritoryStationRender.hidden` | `tests/territory-building-shake.test.ts` |
| 领地**新地块进场**动画（两档：普通生成 / **胜利通过更重**，2026-11-03） | `model/TerritoryHexSpawn.territoryHexSpawnFrame`（`peakScale` 过冲）/ `…Delays` / `TERRITORY_HEX_SPAWN_(VICTORY_)TIMING` / `view/TerritoryHexSpawn.play(…, timing)` / `TerritoryMapView.syncHexSpawn` / `TerritoryModel.victoryClaimCells` | `tests/territory-hex-spawn.test.ts`、`tests/territory-battle-prelude.test.ts` |
| 领地**资源不足**的数字变红（银币 / 体力各判各的，2026-11-03） | `model/TerritoryCostShortfall.territoryUnlockShortfall` / `TerritoryMapView.stationRenderOf`（`conditionTextColor` · `levelBubbleTextColor`）/ `TerritoryStationView.renderLevelBubble` / `TerritoryModel.buildState`（`wallet`） | `tests/territory-wallet-shortfall.test.ts`、`tests/territory-random-resource-render.test.ts` |
| 领地「获得银币 / 体力」**格心抛物线喷发（12 颗 · ±26° · 由小变大 + 持续自转）** + 读数在其**上方 40px**（row17；粒子自身动画 2026-11-02 改口径，旧的「上下翻面」已作废） | `model/TerritoryResourceGain.territoryBurstLaunch / territoryBurstParticle`（`scale` / `rotation`） / `view/TerritoryGainBurst` / `TerritoryMapView.playResourceGain`、`ensureBurstRoot` | `tests/territory-resource-gain.test.ts` |
| **宝箱气泡底图 / 排版**（`frame_04` 竖向水滴，icon 在上、数字在下；2026-11-02 两轮） | `model/TerritoryChestBubble.territoryChestBubbleLayout`（尺寸 / icon / 字号 / 描边） / `TerritoryStationView.renderLevelBubble`、`themeLevelBubbleLabel`、`applyLevelBubbleLayout` / `TerritoryPageAssets`（`chestBubbleFrame`） | `tests/territory-chest-bubble.test.ts` |
| 领地奖励**图标解析**：`roleProperty` + `item` **两张表**、`item` 图在 `main-pages` 分包 + 随机格**读数合成一条**（2026-10-26） | `ResTypes.resBarCellOfRefId` / `ResTypes.resBarIconSpritePath` / `MainTerritoryMap.ensureRewardIcon`、`refRows` / `TerritoryMapView.playResourceGain` 的 `readout` | `tests/res-types.test.ts`、`tests/territory-resource-gain.test.ts` |
| **资源栏「扣除」反馈**（数字**白色闪烁** → 跳一下 → 才扣 + 上方飘 `-N`；2026-11-02 立项，2026-11-03 改口径去掉红色） | `main/MainResBarFeedback.resBarSpendFx / resBarSpendFloatFx / resBarSpendFlashColor` / `main/MainResBarSlot.playSpendFeedback`、`ensureSpendFloat` / `common/ResBar.reload`（`spendDeltaOf` 自动检测） | `tests/main-resbar-spend.test.ts`、`tests/main-resbar-feedback.test.ts`、`tests/militia-talent-ui.test.ts` |
| **「章节选择」行排版**（金边即底框 / 区块留白 / 挂锁 ×1.3 / 序号块与完成度块缩 90%+上抬 / 章节名居中 / 挂锁两轴跟随；2026-11-03/04 五轮） | `ChapterSelectPanel.prefab` 的 `CurrentRing` · `NumBlock` · `StatusBlock` · `LockIcon` · `NameLabel` 几何 / `main/ChapterSelectItem.render` | `tests/chapter-select.test.ts` |
| **「章节选择」完成度 = 已通关格子 / 章节全部格子**（格子按区域关整片算通关、资源据点不扩散；空格不算；与金牌判据解耦；2026-11-05） | `model/ChapterSelectRows.chapterPercentOf`（+ `passedCellSet`）/ `IChapterSelectMapInfo.areaGroups` / `ChapterSelectLoader.buildAreaGroups`（与 `TerritoryProgress.areaPeers` 同源） | `tests/chapter-select.test.ts` |
| **战斗宝箱入口开启条件**（pvp 20001 通关才显示 + `0→1.15→1` 生成动画 + `Cell0..Cell3` 同进同出；2026-11-03） | `open.json` `refId=701`「战斗掉落宝箱」的 `visibleCondition` / `main/ChestEntryGate.ts` / `main/BattleLevelPassed.ts` / `MainPage.onLoad`、`applyChestEntryGate`、`setChestCellsVisible` | `tests/chest-entry-gate.test.ts` |
| **快速寻敌开启条件**（激活第 1 章第 4 关地块才出现、解锁后全章常驻；`open` `refId=702` + 条件类型 `territoryLevelActivated`；2026-11-09） | `open` `refId=702` 的 `visibleCondition` / `main/QuickFindGate.ts` / `main/ChestEntryGate.isTerritoryLevelActivatedInTerritory`、`activatedTerritoryLevelIds` / `model/TerritorySaveStore.loadActivatedLevels`、`markLevelsActivated` / `MainPage.applyQuickFindGate`、`rememberActivatedTerritoryLevels`、`refreshOpenGates` | `tests/quick-find-gate.test.ts`、`tests/main-quick-find.test.ts`、`tests/territory-save-store.test.ts` |
| **未解锁 → 可激活的 1s 过渡**（锁 `1→1.2→0` + 银币数字 `0→1.15→1`，两段同时起手同时收工；2026-11-09） | `model/TerritoryUnlockTransition.territoryUnlockLockScale / territoryUnlockPriceScale` / `TerritoryMapView.applyHexLock`（记「锁刚消失」）、`startUnlockTransitionIfNeeded`、`stepUnlockTransitions`、`applyUnlockTransitionFrame` / `TerritoryStationView.setConditionSpawnScale`、`applyCaptionPlacement` | `tests/territory-unlock-transition.test.ts` |
| **未解锁地块整块置灰**（锁住 ⇒ `img_land_01_gray`，前置满足那帧换回泥土 + 0.36s 换色；整片灰按**逐格** `lockBlockedCells`、锁仍按节点收敛；2026-11-10） | `TerritoryPageAssets.tileGrey` / `TerritoryMapView.paintHexes`（`greyCell`）、`isStructurallyBlocked` | `tests/territory-tile-frames.test.ts` |
| **同一关卡节点的地块一起换状态色**（待解锁整片灰 / 已解锁未通关整片叠红 `frame_01` / 通关整片草地并摘框；兄弟格与 footprint 格统一读**承载格**进度，不许一格灰一格褐；2026-11-18） | `model/TerritoryNodeUI.territoryNodeStateCellByCell` / `territoryNodeGreyCells` / `TerritoryMapView.paintHexes`（`stateCellByCell`） | `tests/territory-tile-frames.test.ts` |
| **固定格宝箱奖励粒子改道飞向底部卡牌 icon**（与随机格共用顶层 `TerritoryRewardFx` + `playHeroRewardFlight`；`flyStart` 那刻才起飞；`applyFly`/`fireLandings` 逐枚让位给非钱包类，钱包 `7/9` 留守；进度徽标仍由 `presentRewards` 统一触发；2026-11-19） | `MainTerritoryMap.runChestOpening` / `TerritoryMapView.armChestHeroFlight`、`launchChestHeroFlight` / `TerritoryChestView.setFlyStartHook` | `tests/territory-chest-hero-flight.test.ts` |
| **巡逻宝箱怪未挑战成功与关卡地块同形**（`patrolChest` 用红 `frameStage` 而非蓝 `frameChest`；同 `battleId` 任一格占点 ⇒ 整片转草地摘框；野怪主骨架 `#828282` + 放大 1.08 的 `unit-outline-copy` 红色副本，胜利后写绝对色恢复；2026-11-19，见 §3.47） | `model/TerritoryMonsterPatrol.territoryPatrolPassedCells`、`TERRITORY_PATROL_*` / `application/TerritoryViewState.patrolPassedCells` / `MainTerritoryMap.renderMap` / `TerritoryMapView.TERRITORY_SITE_FRAME`、`isCellPassed`、`renderMap` / `view/TerritoryMonsterPatrolView.attachOutline`、`applyLook` / `application/TerritoryChapterLoader`（描边材质） | `tests/territory-patrol-look.test.ts`、`tests/territory-tile-frames.test.ts` |
| **巡逻野怪片区 icon 只落在配了野怪 id 的格**（同 `site.id` 收敛到 `patrolId` 锚点；锁 / 价格 / 编号一律不落兄弟格；`NODE_SITE_TYPES` 不许塞 `patrolChest`，否则连带改地皮红框；2026-11-20，见 §3.48） | `model/TerritoryMonsterPatrol.territoryPatrolAnchorByCell` / `model/TerritoryNodeUI.territoryNodeCarrierByCell`、`territoryNodeMutedCells` | `tests/territory-patrol-node-ui.test.ts`、`tests/territory-node-ui.test.ts` |
| **通关后巡逻野怪继续移动、只去叠加**（通关不再过滤 `monsterPatrols`；`patrolPassedCells` 只喂 `applyLook` 恢复原色 + 收描边、和 `paintHexes` 转草地摘框；2026-11-20，见 §3.50） | `model/TerritoryMonsterPatrol.buildTerritoryMonsterPatrols` / `application/TerritoryViewState.patrolPassedCells` / `view/TerritoryMonsterPatrolView.applyLook` | `tests/territory-monster-patrol.test.ts`、`tests/territory-patrol-look.test.ts` |
| **固定宝箱格可激活 ⇒ 价格行之上加一颗宝箱 icon**（`icon_baoxiang` 58×45，宝箱在上、`银币+数字`在下、整块居中；无宝箱时零偏移；未解锁仍只画锁；2026-11-10） | `model/TerritoryConditionBadge.territoryConditionBlockLayout` / `TerritoryStationView.applyConditionChest`、`applyCaptionPlacement`、`readCaptionIconHeight` / `TerritoryMapView.stationRenderOf`（`conditionChestIcon`，只给 `fixedResource`）/ `TerritoryPageAssets.chestIcon` | `tests/territory-condition-chest.test.ts` |
| **银币宝箱独立打开动画**（`1023` / `coinBox` ⇒ icon `1→1.3→0` 原地 pop；**不复用** `chest_seq_*` 三档开箱；奖励当场结算不挂动画回调；2026-11-10） | `model/TerritorySilverChestOpen.territorySilverChestIconPop` / `model/TerritoryMapConfig.TERRITORY_SILVER_CHEST_REWARD_ID` / `TerritoryModel.handleUnlockThenPass`（`silverChest: true`）/ `MainTerritoryMap.presentRewards` / `TerritoryMapView.playSilverChestOpen` / `TerritoryStationView.playSilverChestIconPop`、`stepSilverChestPop` | `tests/territory-silver-chest-open.test.ts` |
| **碎片 / 种族经验飞向底部「英雄」按钮 + 碎片进度长满徽标**（钱包 `7/9` 仍飞资源栏；固定格改落点、随机格补飞行、英雄按钮先 Y 后 X 受击抖动；徽标仅本次新达成、从当前比例长到 100%、多英雄按 `sortLineupCards` 串行；2026-11-10） | `model/TerritoryHeroReward`（`isTerritoryHeroRewardResId` / `territoryHeroFlightFx` / `territoryHeroBadgeFrame` / `detectTerritoryHeroBadges`）/ `view/TerritoryHeroFlight` / `TerritoryMapView.setHeroRewardTargetWorld`、`playHeroRewardFlight` / `MainTerritoryMap.wireRewardCatch`、`playCellGains`、`playHeroBadges`、`findHeroTabButton` / `common/TabButton.playHitFeedback` / `main/HeroFragmentBadge` / `bootstrap/main/TerritoryHeroProgressSource`（`MainPageComposition.mountTerritory` 注入） | `tests/territory-hero-reward.test.ts`、`tests/territory-chest-animation.test.ts`、`tests/tab-button.test.ts` |
| **巡逻宝箱升级摇奖 + 守护怪头像**（空星槽里虚影呼吸（周期 0.4→0.833s）+ 宝箱**原地 7Hz 颤动**（水平 ±4 / 垂直 ±2 / 缩放 ±8%）+ 逐渐叠纯白；**成功顿 5 帧再换图**、**失败减速泄劲**；落点等回包、最短演满 1.2s；结果 toast 挂**演完**；守护怪读 `levelInfo.levelMonsterGroup` → `monsterCard.headIcon`；2026-11-24 三轮改版，见 §3.53） | `model/TerritoryMonsterBoxRoll`（`monsterBoxPulseAt` / `monsterBoxShakeXAt` · `YAt` · `ScaleAt` / `monsterBoxRollPose`）/ `model/TerritoryCampaignConfig.readTerritoryGuardMonsters` / `model/TerritoryMonsterBoxDetail`（`guards[].headIcon` · `upgradeAttempt`）/ `application/TerritoryModel`（`noteMonsterBoxAttempt` / `notifyMonsterBoxRollSettled`）/ `view/TerritoryMonsterBoxPanel`（`startRoll` / `update` / `applyRollPose` / `prepareStarGhost` / `ensureChestWhite` / `notifyRollSettled`）/ `TerritoryDetailCoordinator.monsterBoxContentOf`（`whiteMaskMaterial`）/ `MainTerritoryMap.prefillMonsterBoxGuardIcons` | `tests/territory-monster-box-roll.test.ts`、`tests/territory-monster-box-prefab-refs.test.ts`、`tests/territory-monster-box-guards.test.ts`、`tests/territory-monster-box-detail.test.ts` |
| 🔴 **异步 PVP 战斗结束「掉落宝箱获得」动画**（一枚 `hud_chest` 带**三角形拖尾**沿二次贝塞尔弧线从地图胜利格心飞进 `BottomHud/ChestEntry`；飞入后目标 icon 抖「先 Y 后 X」、最后一颗绿点**落地那一拍**才点亮。🔴 11-23 修：触发只认 `victoryBattleCells`（战斗结算存档的一次性边沿），**不认** `victoryClaimCells` —— 服务端 `passCells` 先落 owned ⇒ `startExplore` 被拒 ⇒ 本地零收地，旧口径恒空导致动画静默消失；格心必须在 `scrollToCell` 之后量。回城是全量重拉队列，没有「本次新增一个」的增量信号；绿点用 `chestDropPending` 闩压住，别让数据先亮。11-23 深夜加固：`play()` 返回 true 才落「已播过」的闩；控制台留 5 条 `[ChestDrop]` 排障锚点（哪行出现 = 卡在哪环，见 §3.54 七）。🔴 11-23 三次：触发**白名单只认 `asyncPvp`**，删掉 `pvpCell ?? claimCells[0]` 兜底 —— `resolveBattle()` 是所有 `pve` 战斗共用收尾口，塔防（`defence`）/ 普通关（`match`）回城也非空，兜底会让它们一起播（见 §3.54 八）。2026-11-22，见 §3.54） | `main/ChestDropFlight`（`chestDropFlightFrame` / `chestDropTrailQuads` / `chestDropHitScale`）/ `main/ChestDropFlightView` / `MainPage.onChestDropFlight`、`tryStartChestDrop`、`onChestDropLanded`、`renderChests` / `MainTerritoryMap.emitChestDropFlight` / `TerritoryMapView.cellWorldPoint` / `ChestEvents.DROP_FLIGHT` / `TerritoryModel.applyStoredBattleResult`、`victoryBattleCells` | `tests/chest-drop-flight.test.ts`、`tests/chest-drop-flight-trigger.test.ts` |
| **宝箱详情主按钮加速态**（绿底 `btn_speed_up` + 播放 icon `chest_bolt`；解锁 / 开启仍黄色；**点解锁后整颗按钮同步刷新**，不再只刷倒计时；2026-11-11） | `ChestDetailPanel.applyOpenButton`（唯一写入口）/ `updateCountdown(秒, 计时中, {caption, speedUp})` / `MainPage.chestDetailContentOf`（`openSpeedUp`）、`refreshChestDetailCountdown`、`loadTreasureQueue`（回调改 `refreshTreasureDisplay`）/ `tools/gen_chest_speed_up_button.py`、`tools/patch_chest_detail_speed_up_prefab.py` | `tests/chest-detail-speed-up.test.ts`、`tests/chest-detail-panel.test.ts`、`tests/chest-detail-lifecycle.test.ts` |
| **预告关卡红色编号气泡 + 异步据点解锁即直开**（预告整关 footprint 只给**虚影承载格**挂一颗红 `frame_02`；气泡按虚影帧抬高，未解锁仍是锁/价格；`asyncPvp` 并入「花银币解锁那一次直开」，已解锁仍弹侦查面板；2026-11-11） | `TerritoryMapView.stationRenderOf`（`isPreviewBattleSite` / `previewBubble` / `levelBubbleAnchorFrame`）/ `TerritoryStationView.renderLevelBubble`、`previewAnchorScale`、`applyLevelBubblePosition` / `TerritoryModel.selectSite`、`isAutoStartSite` / `tools/patch_territory_preview_bubble.py` | `tests/territory-preview-bubble.test.ts`、`tests/territory-presenter.test.ts`、`tests/territory-boss-and-random-building.test.ts`、`tests/territory-chest-bubble.test.ts` |
| 🔴 **PVP 红气泡里的头像按「红色圆角主体」居中**（`frame_02` 94×45 的圆角主体只到 raw 行 36，`37..44` 是 8px 小尖角 ⇒ `SLICED` 上下切边 1:1 ⇒ 主体中心恒比**节点中心**高 `4px`；头像 `icon_hero_head_40018` 是 auto trim（`offset = -2/-13.5`）+ `trim=false` ⇒ 可见中心比节点中心低 `13.5×46/204 ≈ 3.04px`。旧 `PORTRAIT_Y = 3` 只补了 trim ⇒ 头像贴红框下沿、上方空一大片红。落点统一走 `territoryPvpBubblePortraitPosition(frame, size)`，x / y 都按帧几何算，缺帧兜底与真帧同源；2026-11-23，见 §3.55） | `model/TerritoryLevelBubble`（`FRAME_HEIGHT` / `BODY_BOTTOM_ROW` / `TAIL_ROWS` / `BODY_CENTER_LIFT_Y` / `territoryPvpBubblePortraitPosition`）/ `TerritoryStationView.applyLevelBubbleLayout` / `frame_02.png.meta`、`icon_hero_head_40018.png.meta` | `tests/territory-pvp-bubble-portrait-align.test.ts`、`tests/territory-station-batching.test.ts`、`tests/territory-chest-bubble.test.ts` |
| **章节通关判据 = 通过本章最后一个首领关**（异步据点不参与；无首领退回全占领；2026-11-04） | `model/TerritoryStageBinding.chapterFinalBossCell`（取 `stage.stage` 最大，同级比 `levelId` 再比 `cellId`）/ `TerritoryModel.chapterCompletion`（`bossCellId` + `progress.isAreaPassed`）/ `model/ChapterSelectRows.chapterClearedOf` / `ChapterSelectLoader.finalBossLevelIdOf`（`levelMod === 2`）与 `finalBossCells` | `tests/territory-stage-binding.test.ts`、`tests/territory-presenter.test.ts`、`tests/chapter-select.test.ts` |
| **整章云散回收 + 章节切换镜头 + 散雾只给首次通关演**（模型只发 `chapterSwitch` 命令 → 页面压住换图保住云散 → `lead/cover/wait/reveal` 四段；**模型命令只认按钮来源**，首通自动推进由页面补起同一段转场（§3.40）；散雾主判**边沿** `chapterClearPending`、辅以同章 `chapterCleared false→true` 电平兜底，**换章那一帧不认**；2026-11-04 / 11-05 / 11-11） | `model/TerritoryChapterSwitch`（四段时长 / `lead` 相机先行 / `rise` / `sink` / `reveal` 曲线）/ `model/TerritoryCloud.territoryCloudClearAction`（`none` / `animate` / `instant`）/ `TerritoryModel.noteChapterJustCleared`、`emitStateChange`（发一拍就消费）/ `MainTerritoryMap.beginChapterSwitch`、`stepChapterSwitch`（`lead`/`cover`/`wait`/`reveal`）、`writeChapterSwitchLead`、`renderAll`（`chapterSwapPending` / `firstClearEdge`）/ `TerritoryMapView.beginChapterSwitch`、`setChapterSwitchOffset`、`syncClouds` / `TerritoryCloudView.setChapterCleared(cleared, animate)`、`dismissFillNow`、`dismissing` | `tests/territory-chapter-switch.test.ts`、`tests/territory-cloud.test.ts`、`tests/territory-battle-prelude.test.ts`、`tests/territory-chapter-clear-followup.test.ts` |
| 🔴 **SVN 合并后「章节通关动画丢失」+「第 2 章云层贴地块」**（首通编排：边沿丢了也能靠同章电平兜底 → 云散演完 → **补起切换转场** → 云盖满才画新章；云层 15px 间隔按**全量格心 × 所有已揭示格**描，不再只按 `cloudCells`；2026-11-11，见 §3.40） | `MainTerritoryMap.renderAll`（`firstClearEdge` / `clearSignal` / `chapterClearFollowup` / `chapterClearSwitch`）、`update`（`chapterSwapPending` ①-a/b/c）、`beginChapterSwitch(..., deferRender)` / `TerritoryMapView.syncClouds`（`setKeepOutPoints(input.layout.points)`）/ `TerritoryCloudView.setKeepOutPoints`、`forEachKeepOutCell` / `tools/patch_chapter_clear_followup.py`、`tools/patch_territory_cloud_gap.py` | `tests/territory-chapter-clear-followup.test.ts`、`tests/territory-cloud.test.ts`（4 条挡云间隔）、`tests/territory-chapter-switch.test.ts` |
| 🔴 **飞舞的奖励图标画在所有 UI 之上**（页面内 `TerritoryOverlay` 盖不过 `BottomHud` 聊天框与 `BottomNav` 底栏 ⇒ 粒子层挂 `MainRoot` 最后一位；**页面只找根、视图建层**，不许页面 `new Node`；只迁「飞向英雄按钮」那批，格心喷发与开箱表演原层不动；2026-11-11，见 §3.41） | `MainTerritoryMap.rewardFxRoot()`（找 `MainTabHost.navBar.parent`） / `TerritoryMapView.mountRewardFxLayer`、`disposeRewardFxLayer`、`setRewardFxHost`、`rewardFxLayer`、`cellPointInNode` / `tools/patch_territory_reward_fx_layer.py` | `tests/territory-reward-fx-layer.test.ts`、`tests/territory-page-split.test.ts`、`tests/territory-battle-intro.test.ts` |
| 🔴 **SVN 合并后「未通关预告气泡变回蓝色」**（根因**不在**判据 / 路径 / 资源：`TerritoryPageAssets.loadFrame` 用 `assets.has()` 查 bundle 索引、查不到就静默 `return null` ⇒ `levelBubblePendingFrame = null` ⇒ `stationRenderOf` 两条未通关分支一起回退蓝 `frame_03`；改为**只由 `load` 判加载**、`has` 降级成失败后的日志；旧夹具一律 `has: () => true`，所以 12 条专项全绿也盖不住实机；2026-11-11，见 §3.42） | `TerritoryPageAssets.loadFrame` / `common/MapMarkerBadge.MAP_MARKER_BUBBLE_FRAME_{PASSED,PENDING}_PATH` / `TerritoryMapView.stationRenderOf`（`previewBubble` 与 `claimed` 两条分支） | `tests/territory-bubble-red-frame.test.ts`、`tests/territory-preview-bubble.test.ts`、`tests/territory-random-resource-render.test.ts` |
| 🔴 **新手引导收起底部 UI 时云层要继续铺到屏幕底**（真因**不是** inset / 留白：`CloudFillLayer` 是 `MapLayer` 的孩子，被 `MapViewport` 的 rect `Mask` 裁在视口底边，而视口 Widget `bottom = 168` ⇒ 底栏一收就露出整条 `zdbg1` 橙色裸底图；须在**页面根第 0 个孩子**建 `CloudBottomStrip` 补 Mask 外那一截，只在底栏 `active = false` 时点亮，淡出跟着铺满层收；2026-11-17，见 §3.43） | `model/TerritoryCloud.territoryCloudBottomStripPoints` / `TerritoryCloudView.setBottomStripEnabled`、`buildBottomStrip`、`syncBottomStripAlpha` / `TerritoryMapView.setBottomCloudFillVisible` / `MainTerritoryMap.syncBottomCloudFill`（`update` 所有早退之前） | `tests/territory-cloud-bottom-strip.test.ts` |
| **铺满背景的雾（铺满层）**：盖住"没有内容"的空格与内容层那圈留白；换章那一帧必须**当场重建**（2026-10-26 / 11-06） | `model/TerritoryCloud.territoryCloudFillPoints` / `TerritoryCloudView.setFillArea`、`setFillOccupied`（判据是 `fillAreaReady`，**不是** `fillKey`）、`rebuildFill`、`applyFillActive` / `TerritoryMapView.syncContentSize`、`syncClouds`、`syncGrid`（`reset()`） | `tests/territory-cloud.test.ts` |
| **塔防 BOSS 波识别**（`defenceModWave.monsterType`：`1` 普通 / `2` 精英 / `3` BOSS；客户端 JSON 必须含该列，缺列时按「每组最后一波」兜底，2026-11-07） | `model/TerritoryCampaignConfig.projectDefenceWaves`（→ `TerritoryCampaignWave.isBoss`）/ `ZCGameModel.defenceBossWaveIndex`、`isBossWave`、`ZCPveDefenceWave.isBoss` | `tests/territory-campaign-config.test.ts`、`tests/zcds-pve-defence.test.ts` |
| **塔防胜负只认「BOSS 已被击败」**（中间波清空不算赢；拆 BOSS 建筑提前触发的跳末波逻辑保持不变，2026-11-07） | `ZCGameModel.defenceBossState`（账本空时按场上同卡单位兜底）→ `ZCOutcomeSystem.checkOutcome(state, context, nextWaveIndex, defenceBoss)` | `tests/zcds-outcome-system.test.ts`、`tests/zcds-pve-defence.test.ts` |
| 🔴 **塔防波次徽标常驻 + 大血条只在 BOSS 波显示**（`IconBoss` + `第N/M波` 从第一波起一直挂着；头像框 / 名字 / 总血条 / `X{n}` 整组只认 `currentWaveIsBoss`，非 BOSS 怪只有头顶血条。2026-11-20 恢复 SVN 合并回退：旧判据 `currentWaveId !== null` 把「有当前波」当「有首领」，普通小怪波（截图 `第3/6波`）也挂大血条；模型 / 配置层口径从未变过。另：`setBossBarVisible` 收的是 `Portrait` 父节点，只藏 `Icon` 会留一个 86×86 空头像框；见 §4.5） | `ZCGame.renderBossPanel`（有 `defenceWaveProgress` 就建面板，按 `progress.currentWaveIsBoss` 调 `setBossBarVisible`）/ `ZCGameModel.defenceWaveProgress.currentWaveIsBoss` ← `isBossWave()` / `defenceBossWaveIndex()` / `ZCHudBossPanel.setBossBarVisible`、`formatZCDefenceWaveText` | `tests/zcds-pve-defence-hud.test.ts`、`tests/zcds-boss-panel.test.ts`、`tests/zcds-game-resources.test.ts`、`tests/zcds-pve-defence.test.ts` |
| 🔴 **碎片进度徽标只有「本次新达成可升级」才展示**（11-10 口径，11-22 用户再次确认：碎片 + 经验**都满**、卡牌从不可升级变成可升级的那一拍才播，领奖前已可升级 / 本次没凑齐 / 满级都不播 ⇒ **不是每次领奖都弹**。11-20 曾加 `detectTerritoryHeroBadgeProgress` 回落通道按真实增量播，实机变成「每次领奖弹 26%」，已整条撤掉；组合层只 `return detectTerritoryHeroBadges(states)`。版面：`BadgeIcon.x=-49` 与条左缘 -25 **间隔 2px**，`LiftAnchor.y=10` 且按**图标顶边世界坐标**定位（旧「中心+58」会把徽标压在卡牌图标中间）；白色 `NN%` + 深灰槽 + 长满 100% 刷光见 §3.52） | `TerritoryHeroReward.detectTerritoryHeroBadges` / `territoryHeroBadgeShineFrame`；`TerritoryHeroProgressSource.newlyReady` / `HeroFragmentBadge.placeAboveHeroButton`、`apply` / `HeroFragmentBadge.prefab:BadgePercent` | `tests/territory-hero-badge-layout.test.ts`、`tests/territory-hero-reward.test.ts`、`tests/prefab-mounted-components.test.ts` |
| 🔴 **塔防结算演出必须等首领条把这次扣血演完**（BOSS 被打死那一拍模型血量已归零、HUD 只在 0.15s 的 `static` 节奏刷新且结算分支不刷 HUD ⇒ 旧表现是「怪已死、血条还是死前满血」的同时扫场已经开播；改为结算起手先 `beginHpDrain` 钉住死前比例 → 把最终血量 `render` 进面板（动画期只记目标）→ 条降完（0.5s，smoothstep）才拉远镜头 + 扫场；非塔防局 / 血量没降都当帧放行，2026-11-20） | `ZCGame.advanceSettlementPresentation`（`settlementHpSettled` 起手闸）/ `ZCHudBossPanel.beginHpDrain`、`advanceHpDrain`、`bossHpDrainRatio`、`ZC_BOSS_HP_DRAIN_SECONDS` / 契约 `IZCBattleView.advanceSettlementPresentation(model, frame, dt)` | `tests/zcds-pve-defence-hud.test.ts` |
| 🔴 **战斗伤害飘字的颜色 / 字号口径**（玩家造成的伤害一律**白字**（含克制增伤，`CRITICAL_COLOR` / `RESTRAINT_COLOR` 都指回 `NORMAL_DAMAGE_COLOR`）；暴击只放大**字号 1.7 倍**（30 → 51，颜色仍是白）；本机席位被**另一个玩家**扣血 ⇒ **红字 + 负号**（`-16`，暴击时同样 51px 且前缀仍是「暴击」）；两个**非玩家**互打 ⇒ **不推飘字**、只留血条变化；`resisted` 灰 / `execute` 橙保持原样。判「谁是玩家」的唯一真源是 `ZCMatchConfig.npcOwners`（入口 `buildZCBattleEntry` 按有无 `pve` 写入非本机席位），🔴 **不能**用 `owner !== player` 反推 —— PVP 4 人局另外三个席位也是真人；红色也只认 `defender === Player`，塔防里 NPC 打我方卡仍是白字，2026-11-20） | `ZCGameModel.floatTextToneOf`、`isPlayerSeat`、`damageUnit` / `ZCMatchConfig.npcOwners` / `ZCBattleEntryBuilder`（`ownersForPlayerCount` 去掉 player）/ `ZCFloatText.takenFromPlayer` / `ZCBattlePresentationQueue.pushFloatText` / `ZCFloatTextView.CRITICAL_FONT_SIZE`、`CRITICAL_COLOR`、`RESTRAINT_COLOR`、`PLAYER_LOSS_COLOR`、`battleText`、`applyColor` | `tests/zcds-damage-float-text.test.ts`、`tests/zcds-progress.test.ts`、`tests/zcds-battle-presentation-queue.test.ts`、`tests/zcds-client-combat-config.test.ts` |
| 🔴 **伤害飘字的纵向方向分两档**（2026-11-23 用户：「玩家方造成的伤害数字是往上飞的，运动路径和现在的相反，受到伤害的数字运动路径保持不变」）：`dealtByPlayer` ⇒ **向上飞**；`takenFromPlayer` ⇒ **原样向下坠**（一个像素都不动）；无标记（`heal` / `miss` / 裸伤害文本）保持向下。两档**只有符号相反** —— 起点（头顶 + 轨道行距）、纵向总距离 `damageDropDistance = 100`、入场时序、轨道散落、弹出缩放全部共用，所以一切「只调了其中一条」的改动都是错的。判据只认模型给的两个正交标记，**视图不许拿 `owner` 反推**（PVP 4 人局另外三席也是真人）；两个标记同时出现以 `takenFromPlayer` 为准（红字负号那档的语义是「我掉了多少血」）。见 §6.5） | `ZCFloatTextView.damageTravelSign`、`render` 的伤害分支 / `ZCGameViewUtil.floatTextEntrance`、`floatTextDrift` / `ZCFloatText.dealtByPlayer`、`takenFromPlayer` | `tests/zcds-damage-float-text.test.ts`（「向上飞 / 挨打那条保持向下坠」+「两个标记同时出现」）、`tests/zcds-progress.test.ts` |
| **首领关（塔防）敌方不主动翻格**，首领和其他波次怪按配置出场 | `ZCGameModel.advance`、`spawnDueDefenceWaves` | `tests/zcds-pve-defence.test.ts` |
| 🔴 **塔防同一波多只怪必须逐只出怪**（一波 20~30 只时旧实现同一帧 `for` 循环全生成 ⇒ 从敌方主城爆出一坨、朝向随机四散；用户口径 2026-11-20：逐只 0.1~0.2s、排成直线队列。落法：波次触发只登记「出怪票」，`advanceDefenceSpawnQueue` 每拍按 `ZC_DEFENCE_SPAWN_INTERVAL_SECONDS = 0.15` 补一只；塔防怪的出生点不再随机散角，整波压在「敌方主城 → 目标主城」这条轴上 ⇒ 同点同向 + 时间错开 = 纵队。🔴 两个连带：①「这一波还没打完」必须同时看**活着的敌人 + 排队中的票**（`defenceForceOnField`），只看活体会在「第一只刚死、下一只还没出生」的空场帧提前触发下一波；②末波还在排队时不许判胜（`defenceBossState` 先查票），否则先头几只被打死就当场结算） | `ZCGameModel.triggerDueDefenceWaves`、`advanceDefenceSpawnQueue`、`spawnDefenceWaveUnit`、`defenceForceOnField`、`defenceBossState` / `spawnUnit(..., lineUpAlongGoal)` / `ZC_DEFENCE_SPAWN_INTERVAL_SECONDS` | `tests/zcds-pve-defence.test.ts`、`tests/zcds-client-combat-config.test.ts` |
| **出怪表的「怪物体型」要生效**（`defenceModWave.monsterSize` 当模型缩放倍率：1 普通 / 2 BOSS，缺省不缩放，封顶 2.5；2026-11-09） | `ZCGameModel.defenceMonsterScale` → 出怪时写 `unit.gateScale`（视图/头顶血条/兜底体型都乘它）/ 链路 `TerritoryCampaignWave.monsterSize` → `ZCPveDefenceWave.monsterSize` | `tests/zcds-pve-defence.test.ts`、`tests/territory-campaign-config.test.ts`、`tests/zcds-client-combat-config.test.ts` |
| **塔防局收起玩家基础信息**（名字 / 头像 / 兵力三件套不画，buff 位保留，2026-11-09） | `ZCGameHUDView.hidePlayerBasicInfo`（`defence !== null` 置位）→ `ZCGameHudPlayerRow.render`（`basicInfoVisible`） | `tests/zcds-hud-dead-avatar-tint.test.ts` |
| **`levelInfo.openGrideTime` = NPC 两次翻地块的最小间隔**（「关卡翻地快频率(s)」；**计时从第一次翻格之后开始**，首格不被拖后；下限 **1 秒**（`ZC_AI_MIN_DEVELOP_INTERVAL_SECONDS`，2026-11-11 起不再用全局 2.8s 当下限，否则填 1~2.7 秒会被静默抬回去）；`0`/缺省 = 不额外限速、按全局 `enemyAiIntervalSeconds`；**只压 NPC**，玩家不受影响） | `ZCGameModel.aiDevelopIntervalSeconds` / `restoreOrCreateState` 预置 `state.aiClock`；链路 `TerritoryCampaignStage.openGrideTime` → `ITerritoryBattleNavParams` → `ZCBattleEntryBuilder` | `tests/zcds-pve-defence.test.ts`、`tests/territory-campaign-config.test.ts` |
| 🔴 **`openGrideTime` 与领地格子的「探索中」时长无关**（2026-11-11 拆开）：后者只认地图配置的 `site.unlock.exploreSeconds`（`TerritoryMapConfig`，缺省 2 秒，`TerritoryProgress` 算 `finishesAt`）。旧实现把同一列也喂给 `TerritoryCampaignStage.exploreSeconds` ⇒「把 NPC 调慢到 10 秒，通关后开那一格也要等 10 秒」 | `TerritoryModel.loadChapter` 的 `unlock` 覆盖只留 `staminaCost`；`TerritoryCampaignStage` 已删 `exploreSeconds` | `tests/territory-campaign-config.test.ts`（`'exploreSeconds' in stage === false`）、`tests/territory-map-config.test.ts` |
| **`levelInfo.gradeProModifier` 只给 NPC 加权抽卡**（乘品质权重后再归一；玩家恒走 `pvpTile` 原表，2026-11-09） | `applyPvpRarityModifier`（**只在非空品级内部归一**，`empty` 空手率不变；表头原话「抽取概率*系数，同时其他品阶均等变化」= 未加权品级按同一比例缩）→ `drawPvpTile(..., seatRules)`；席位判定在 `ZCGameModel.buildDevelopmentContext().drawRulesOf`（`owner === Player ? null : { rarityModifier, goldPity: false }`）。链路 `TerritoryCampaignStage.gradeProModifier` → `ITerritoryBattleNavParams` → `ZCGameEntry.pve` → `ZCMatchConfig.gradeProModifier` | `tests/zcds-npc-rarity-modifier.test.ts`、`tests/territory-campaign-config.test.ts` |
| **NPC 不参与金色保底**（「全类型随机」连续未出金的兜底只给玩家；2026-11-09） | `ZCPvpSeatDrawRules.goldPity = false`（`drawPvpTile` 里 `seatRules?.goldPity !== false` 才判保底）。保底绕过 `rarityWeights`，给 AI 等于「隔固定次数必送金卡」，会把关卡难度拉平 | `tests/zcds-npc-rarity-modifier.test.ts` |
| **`gradeProModifier` 是「乘系数」不是「目标占比」**：某品级占比涨跌取决于它的系数 vs **其余品级的加权平均**（10003 门槛 2.6；表里 2026-11-09 已把 green 从 2 提到 3 才跨过门槛，绿 50%→53.57%、蓝 40%→42.86%、金 2%→0.71%） | 同前两行；门槛算法钉在测试里，别把「系数配了 2 倍占比却降了」当回归 bug 改公式 | `tests/zcds-npc-rarity-modifier.test.ts` |
| **塔防关 NPC 卡组按 `npcCard` 收紧**（服务端开战回包里带英雄也不能整池上阵，2026-11-07） | `ZCBattleEntryBuilder.buildZCBattleEntry`（`clipToLevelCards = requestedEnemyCards.size > 0 && (!battle \|\| pve?.mode === 'defence')`） | `tests/zcds-client-combat-config.test.ts` |
| 🔴 **异步据点弹窗压在最上层 + 打开期间隐藏【快速寻敌】**（`BigMapPlayerLevelPanel` 不是 `PopupBase`，挂在 `MapRoot/MainTerritoryMap.node` 下 ⇒ `open()` 的「本父排最后」盖不住 `ArenaRoot` 后画的 `BeginGame` / `TopHud` / `BottomHud` / `ChestBar` 与 `MainRoot/BottomNav`；改为打开那一拍挂 `MainRoot` 最后一位、关闭挂回本页、`onDestroy` 自己 `dispose`。按钮显隐真源 = `MainTerritoryMap.playerStageOpen`（节点 `active`，全局弹窗栈查不到），三处既有写入点后补「只写 false」遮罩，关弹窗的**一次性边沿**才按 702 + 宝箱栏的完整判据恢复；不许每帧写，否则顶掉引导层 `gateHidden`；2026-11-23，见 §3.56） | `view/BigMapPlayerLevelPanel.topLayerHost`、`open`、`close`、`restoreHomeParent`、`dispose` / `MainTerritoryMap.playerStageOpen`、`onDestroy` / `MainPage.stagePanelOpen`、`maskQuickFindForPopup`、`syncQuickFindOnPopupEdge`、`stagePopupMasked` | `tests/main-quick-find-popup-mask.test.ts`、`tests/territory-async-player-panel.test.ts`（层级对拍）、`tests/quick-find-gate.test.ts`、`tests/chest-bar.test.ts` |

## 对局资源与控制器生命周期（2026-10-30）

- 匹配、大地图、章节地图均通过 `createZCBattlePreload(battle, options)` 准备对局；入口只交战斗 Promise、人数与波次，不再注入独立 AssetService / ConfigService。
- 战斗准备创建 `ComponentController`，沿用 `ControllerBase` 从既有 GameContext 取得必需服务、优先使用会话复用资源。加载器只接收统一的只读资源契约。
- `ZCGamePreload` 独立 scope 归属加载资源和准备控制器。取消或失败释放；移交后匹配退出不释放，战斗流程退出才释放。显式 scope 必须穿透控制器的默认 scope。
- 直接进入战斗时，`ProcedureGame.onPreload` 将准备控制器登记到本次流程 scope；取消后不得写入 preparedResources。流程上下文缺失须明确报错。
- `ZCGame` 单独持有运行时补图控制器，玩家头像、角色卡面、首领头像及结算奖励图经其 AssetService 加载；继续复用公共头像解析、图标缓存和奖励换算规则。异步返回仍检查离场状态，`shutdown()` 先关闭弹窗和展示节点，再释放控制器并清空帧表，重复退出幂等。
- 回归：`tests/zcds-controller-resources.test.ts`、`tests/battle-preparation-entry.test.ts`、`tests/zcds-matching-preload.test.ts`、`tests/zcds-game-preload.test.ts`、`tests/zcds-map-loading.test.ts`、`tests/zcds-sprite-frame-loader.test.ts`、`tests/cocos-resource-lifecycle.test.ts`、`tests/controller-resources.test.ts`。

## 1. 对局棋盘的图层结构与地块表现（`ZCGameBoard.prefab`）

### 1.1 声明式棋盘图层（代码不拼层）与城墙排序

`ZCGameRenderWorld` **禁止在代码中 `new Node` 拼图层**。地图层下的结构固定声明在 `ZCGameBoard.prefab` 中，**子节点顺序 = 渲染顺序**（后画的压在上面）：

```text
mapLayer（= ZCGameHUD.prefab 的 content）
└─ ZCGameBoard          ← ui/game/ZCGameBoard.prefab（ZCGameLoader 加载 → ZCGame 实例化后挂进来）
   ├─ MapWater          水面：white Sprite，透明色在 prefab 配置，initialize 只按地图包围盒设置位置与尺寸
   ├─ HexLayer          地块实例挂这里
   ├─ OutlineLayer      整盘共享的领地轮廓：一个 cc.Graphics（ZCOutlineLayer 逐边描线）
   ├─ (ZCGameWallLayer) ← 城墙砖层来自独立 prefab，initialize 时插到 OutlineLayer 之后（outlineLayer.getSiblingIndex() + 1）
   ├─ ResourceLayer     中立资源图标：从地块节点里抬上来的（压得过墙砖，防图标被墙线切断）
   ├─ DecorLayer        自由装饰：ZCGameDecor.prefab 的条目挂这里
   ├─ BuildingOverlay   建筑剪影（从地块节点里提升上来的）
   └─ CooldownOverlay   生命条 + 冷却圈
```

- **硬约束**：
  1. 层的引用一律走 `board.getChildByName('<层名>')`（`ZCGameRenderWorld.boardLayer()`），严禁再用 `siblingIndex` 现算层序或 `new Node` 建同名层。
  2. 城墙层插入锚点必须是 `OutlineLayer + 1`（若插在 `HexLayer + 1` 会导致轮廓线从墙砖里穿出来）。
  3. 各层（含水面）的 `layer` 必须全部为 `UI_2D`。
  4. `destroy()` 只摘 ECS 实体与装饰节点；**board 与城墙层归调用方（随 HUD 销毁）**，渲染层内严禁拆毁。
- **中立格只做矢量绘制（2026-10-16）**：中立格**不铺地块底图**（`ZCHexView.NEUTRAL_FILL_ALPHA = 0`，
  `setSprite` 见 alpha 0 连 Sprite 都不启用）⇒ 棋盘底图直接透出来；格子感全部由 `OutlineLayer`
  的矢量线提供 —— 中立格自己画**暖棕细线**（`ZCOutlineLayer.NEUTRAL_GRID_LINE_WIDTH/COLOR`，
  半透明深色叠在底图上、颜色随底图走），与阵营交界的那条边仍由阵营方的粗线负责
 （`buildTerritoryBoundaryMasks` 已把它从这一格的 mask 里剔掉）。
- **城墙砖全盘按屏幕 y 降序排列**：
  - `ZCGameRenderWorld.renderWallSystem` 在铺砖前必须把**全盘**墙段按 `segment.y` **降序**排一遍（y 小的后画 ⇒ 越下方的城墙层级越高、恒压住上方的城墙）。
  - ⚠️ **必须整盘一起排**，严禁按格或按连通簇分段排（分段会让环形城墙接角处的上下关系随遍历顺序漂移，出现“有的角对齐、有的角带台阶”）。
  - ⚠️ 排序会打乱 `segmentIndex` 与六边形 edge 的对应关系，共享材质帧槽号也按新顺序分配 ⇒ 单测必须**按落点坐标反查边号**，不得写死 `records[edge]` 或 `rightUp = 0`。
- **判据**：`tests/zcds-progress.test.ts`（图层顺序与 `_layer`）、`tests/zcds-render-performance.test.ts`（跨格城墙按屏幕 y 降序）、端到端探针 `tmp/_board_probe.mjs`。

### 1.2 地块图标缩放、中立资源抬层与落点

- 资源格初始化时保留全类型随机开发类型及其配置价格；资源标记清除后若仍可开发（如击败野怪），显示问号与价格，与既有抽卡规则一致。普通资源领取后仍按原规则标记为已开发，不再次收费。回归：`tests/zcds-neutral-features.test.ts`。
- **地块与建筑图标缩放由代码唯一决定（只改 Prefab `_lscale` 会被静默覆盖）**：
  - `iconSprite` 同时承载地块类型图标（`icon_jk/by/wh/em`）与中立资源点图标，唯一缩放写入口为 `ZCHexView.renderContent`：类型图标写 `TILE_ICON_SCALE = 0.8`，资源图标按 `resourceIconScale` 缩放到格子边长。
  - 割草机静态使用 `map-resource/extension` 的左右镜像（朝左下）；运行时由 `renderMower` 按路线方向切换右上、右下、上、下四张图，左侧方向镜像右侧图，按当前帧尺寸等比缩放。启动帧及末段均取路线方向，不以当前位移是否为零判断。
  - 已建建筑唯一缩放写入口为 `applyBuildingScale`（基准 `BUILDING_ICON_SCALE = 0.72`）。
  - 金币图标 `BuildingLayer/PriceIcon` 与价格数字 `BuildingLayer/IconLabel` **不参与**上述缩放。
  - **判据**：`tests/zcds-tile-icon-scale.test.ts`、`tests/zcds-building-icon-scale.test.ts`、`tests/zcds-resource-icon-scale.test.ts`。
- **中立资源图标必须抬到 `ResourceLayer`（防邻格切边）**：
  - **物理原因**：地块整图 130×119、格距仅 92.25×90（相邻格整图重叠）；资源图标 128×128 大于地块顶面 123×90，若留在格节点内必然被后画的邻格沿格边线齐刷刷切掉一半。
  - **唯一入口**：`ZCHexView.setResourceIconRaised`（唯一写 `parent` 入口）将其抬至 `ResourceLayer`，并由 `applyIconPosition`（唯一写坐标入口）换算为棋盘层局部坐标（`格节点位置 + BuildingLayer 偏移 + 图标偏移`）。
  - 地块类型图标字形仅 33×33 落在顶面内，**不抬层**。激活表现的「整格隐藏」段需在 `applyActivationFx` 中同步控制已抬层资源图标的显隐。
  - **判据**：`tests/zcds-resource-icon-layer.test.ts`。
- **地块类型图标落点与兵团资源落点**：
  - 中立资源在原有落点基础上统一小幅上移；静态图标、神器 Spine、兵团与野怪预览共用 `NEUTRAL_RESOURCE_LIFT`，按 `HEX_GRID_FACE_HEIGHT` 的比例计算，不在渲染分支散写固定像素补偿。调节量以代码常量为准，地块类型图标和价格行保持原样。
  - `ZCHexView.DEFAULT_TILE_ICON_POS` 与 `ZCGameHex.prefab` 的 `BuildingLayer/BuildingIcon._lpos` 必须同值：当前 `y = 4`（下界 `y >= 1.4`，再小会切到底部 `y = -26.376` 的金币图标）。注意 `BuildingLayer` 挂有 `cc.Widget`，运行时局部 `y = 15.101`（早期注释中的 `2.342` 已作废）。
  - 中立兵团资源点（`unit_cap`）格内兵团纵向落点由 `ZCHexView.RESOURCE_UNIT_POS_Y` 统一管理，并叠加上述共享上移量；横向间距与目标高保持不变，防止小兵陷进地块下半部被侧壁遮挡。
  - **判据**：`tests/zcds-resource-unit-preview.test.ts`。

### 1.3 地块激活表现：点击动画（阶段 1 脉冲 → 阶段 2 缩没，0.7s）→ 卡牌弹出 → 建筑同拍由小变大

`ZCHexView.hexActivationFx` 将总时长 `ZC_HEX_ACTIVATION_SECONDS = 1.856s` **按秒切成两段**（总长由固定段长相加得出：`ZC_HEX_ACTIVATION_SECONDS = ZC_CARD_START_SECONDS(0.7) + ZC_CARD_REVEAL_SECONDS(1.156)`；卡牌段固定 `1.156s` 以保证淡出窗恒大于建筑生长时长，与点击动画段解耦）：

| 阶段 | 时间窗口 | 核心行为与不变量 |
| :--- | :--- | :--- |
| **① 点击动画段** | `[0, ZC_CARD_START_SECONDS = 0.7s)` | 合成函数 `hexPulseShrinkFx`，**两阶段先后**（2026-10-19）：<br>**阶段 1** `[0, 0.2s)` 只播脉冲 —— `GroundGlow` 按 `pulseFrame` 播 5 帧美术序列（10fps、一道波 `0.5s`；放大与淡出**烘焙在图里**），格子连图标 + 价格数字**原尺寸不动**（`tileScale` 恒 1）；<br>**阶段 2** `[0.2s, 0.7s]` 脉冲继续（0.5s 处自然退场），格根同时原地等比缩至 `0.1`。全程 `tileLift = 0` 零位移、`buildingPopScale = 0` 保持开发前价格外观 |
| **② 卡牌弹出段** | `[0.7s, 1.856s)`（长 `1.156s`） | `0.7s` 当帧显形（`now < startedAt` 时写绝对 `node.active = false`，严禁可见静止干等），按 `elasticPopScale`（`0.2 → 峰值 1.2 → 下探 0.92 → 1`）弹出，`progress = 0.62` 起淡出 |
| **③ 建筑同拍生长** | 卡牌最后 38% 淡出窗（`0.43928s`）内 | 卡牌开始淡出那刻地块原尺寸回场，建筑在 `ZC_HEX_BUILDING_SECONDS = 0.36s` 内从 `0.15` 经同一条 `elasticPopScale` 长到 `1`（`0.36 < 0.43928` 保证卡牌淡完时建筑已长齐） |

- **点击动画段六条硬约束**：
  1. **只由缩没写格根 `tileScale`**：`hexPulseFx` 的 `tileScale` 恒为 `1`；缩没由 `hexPulseShrinkFx` 在 **阶段 2** 才写入 —— 起点 `HEX_PULSE_SHRINK_START_SECONDS = 0.2s`（= 5 帧里的**中间帧**第 2 帧开始那一刻，`HEX_PULSE_FRAME_SECONDS × 2`，别写成 `WAVE/2` 差半帧），跨度 = `ZC_HEX_SHRINK_SECONDS - 0.2 = 0.5s`，末刻收到 `HEX_SHRINK_MIN_SCALE = 0.1`。**段长仍恒 0.7s**（卡牌弹出 / 首批兵 / 邻格按住窗都锚它），严禁把整段也改成 0.5s。
  2. **脉冲层必须抵消父节点缩放与位移**：脉冲节点 `GroundGlow` 是格根的子节点，格根缩小时，`applyPulseRipple` 必须写入 `局部缩放 = 对齐换算 / 格根缩放`、局部 y 写入 `ZC_LAND_TOP_CENTER_LIFT / 格根缩放`。对齐换算是**常量**：把美术图里 `164×142` 的本体摊成格面 `123×90` ⇒ `x = 123/164`、`y = 90/142`（本项目格面 1.367 比正六边形 1.155 更扁，**不许等比**）。节点 `contentSize` 必须按整张 `320×320` 画布给（波最大约 `292×253`，只给格面尺寸会把波挤扁）；离开脉冲段由 `restorePulseLayer` 把缩放归 1、`contentSize` 写回 prefab 的 `130×239`。
  3. **只换帧，不叠 scale / opacity**：美术已把放大（1.00 → 1.78）与不透明度（70% → 15%）烘焙进图，`hexPulseFx` 只产出 `pulseFrame`（5 帧、10fps、`0.1s/帧`）；**不许**在节点上再写缩放 / 透明度动画（等于放大两次、虚化两次），也不再使用 `shaders/hex-pulse.effect` 的径向虚化（旧 30 帧 `fkz_*` 那套已整条退役）。一道波 `0.5s` 播完 ⇒ `pulseFrame = HEX_PULSE_FRAME_HIDDEN(-1)` 直接退场，段尾剩下 `0.2s` 只有缩没在走（**不许**举着末帧当静止波）。
  4. **全程零位移（`tileLift = 0`）**：保持地块与图标中心点坐标不变；底光序列帧（依赖 `tileLift > 0`）与换父置顶（`setRaised`）在对局点击段天然不触发，**严禁为点亮底光而把 `tileLift` 改回非零**。
  5. **无卡牌路径（`hasCardReveal = false`）**：点击动画（两阶段）照常播放，播完直接回常规定格（`HEX_FLIP_IDLE_FX`），不进隐藏段。
  6. **浮点容差与负数保护**：段末比较必须带 `HEX_ACT_SECONDS_EPSILON = 1e-9`；`progress < 0` 必须先返回 idle，严禁交给 `clamp01` 折成 0（否则会把正常建筑 `buildingPopScale` 置 0 藏起来）。
- **判据**：`tests/zcds-hex-activation.test.ts`（含阶段 1 `tileScale` 恒 1、阶段 2 才缩且末刻到 0.1、`pulseFrame` 按 10fps 等宽推进 / 播完退场、对齐缩放恒定、零位移、淡出窗 > 建筑生长时长）、`tests/zcds-card-reveal-pop.test.ts`、`tests/zcds-building-icon-scale.test.ts`、`tests/territory-hex-flip.test.ts`。

### 1.4 单位出生抖动、建筑产兵/产金抖动与新邻格生成动画

- **单位出生抖动（110%）**：
  - `ZCUnitView.playSpawnShake(now)` 只记起点，`render` 按 `now - 起点` 调 `spawnShakePulse`（先 Y 轴拉至 `1 + SPAWN_SHAKE_STRETCH(0.1) = 1.1` 回落，再 X 轴拉至 `1.1` 回落，各 `SPAWN_SHAKE_PHASE_SECONDS = 0.12s`），叠乘在朝向翻转之上（含描边副本 `applyOutlineCopyScale`）。由 `renderUnitEntity` 的 `isBirth` 分支触发。
  - **判据**：`tests/zcds-unit-spawn-shake.test.ts`。
- **建筑抖动（产兵 + 产金共用曲线，拉伸量 120%）**：
  - 详见第 9.5 节：`ZCHexView.playBuildingShake(now)` 使用 `BUILDING_SHAKE_STRETCH = 0.2`（120%），因子乘进唯一写入口 `applyBuildingScale`，挂 `renderDynamic` 逐帧推进。
  - **判据**：`tests/zcds-building-spawn-shake.test.ts`。
- **新扩展邻格生成动画与脉冲同步（2026-10-26 改口径，**取代** row6 的 0.9s 按住窗）**：
  - 需求原话：「战斗中，新格子的生成动画和地块脉冲动画同步播放」。旧口径「延迟 0.2s、等卡牌生成动画开始后再展示」（`ZC_HEX_NEIGHBOR_HOLD_SECONDS = ZC_CARD_START_SECONDS + 0.2`）已**删除**，不要加回来。
  - **不再按住**：新点亮邻格的图标 / 价格数字 / 玩家色染色 / 共享轮廓描边在**点击那一拍**就跟脉冲一起出现（渲染世界与地块视图在同一次静态刷新里各自写，天然同帧，见第 9.2 节）。
  - **生成动画**：只动 `buildingLayer`（= 地块图标 + 价格图标 + 价格数字的容器）。缩放沿 `elasticPopScale(t, DEVELOPABLE_SPAWN_FROM_SCALE = 0.6)`（`1.2` 峰值 → `0.92` 下探 → `1`），透明度走 `developableSpawnOpacity`（前 `DEVELOPABLE_SPAWN_FADE_END = 0.55` 线性淡入，之后恒 1）。时长 `ZC_HEX_NEIGHBOR_SPAWN_SECONDS = HEX_PULSE_WAVE_SECONDS = 0.5s`，与那道波**同起同收**；**别**把它写成脉冲段长 0.7s（那会把邻格拖到卡牌起点之后才长齐）。
  - **起点锚脉冲起点**：`ZCHexView.noteDevelopableSpawn` 只在 `canDevelop` **由假变真**那一拍登记，起点取 `presentation.developPulseStartedAt`（渲染层用本帧 `hexActivations` 里最新的 `startedAt` 填），拿不到才退回 `now`。⚠️ 锚 `now` 会让生成动画整体滞后于脉冲（地块走 0.15s 静态节流）。
  - **逐帧推进**：`ZCGameRenderWorld.renderDevelopableSpawns`（挂 `renderDynamic`）+ `developableSpawnHexes` 集合，与 `renderBuildingShakes` 同款：`renderHexSystem` 里 `isDevelopableSpawning()` 入队、`advanceDevelopableSpawn` 返回 `false` 出队并复位 1 / 255。
  - `UIOpacity` **懒挂**在 `buildingLayer` 上（只有真播过生成动画的格子才多这个组件）；`initialize` 必须复位 `developableSpawnStartedAt / lastCanDevelop / developableBootstrapped`，并调 `applyDevelopableSpawn(0)` 把缩放 / 透明度落回基准。
  - **判据**：`tests/zcds-hex-neighbor-spawn.test.ts`。

### 1.5 特效（出生光柱 / 受击 / 阵亡）的显示大小由 Prefab 根 `_lscale` 唯一决定

与地块/建筑图标（由代码定缩放）**正好相反**，特效的显示尺寸完全归属美术 Prefab 根节点 `_lscale`，**在代码里写 `setScale` 或 `setPosition(0,0,0)` 会静默破坏表现**：

| 特效类型 | 图片像素 / 固定显示画布 | Prefab 根 `_lscale` | 屏上显示尺寸 | 代码端硬约束（`ZCEffectPool`） |
| :--- | :--- | :--- | :--- | :--- |
| **出生特效** | 110×137 / 266×330 | `0.4144` | 110.2×136.8（基准宽 ~110px） | `playSpawnFx` **严禁写 `setPosition` 或 `setScale`**（Prefab `_lpos = (0, -28.2)` 是美术将光柱重心从头顶压到胸口的偏移，写 `(0,0,0)` 会静默覆盖） |
| **受击特效（五组）** | 约 62–77px / 原显示画布 | 按原图折算后再 **×0.7** | 屏上宽 **77px**（战士 61.6，= 110 基准 ×0.7 ×0.8） | 缩图后固定显示画布，改大小只动 Prefab `_lscale` |
| **阵亡特效（唯一例外）** | 88×180 / 535×1092 | **`0.16448`**（`= 0.2056 × 0.8`） | **88×179.6**（比 110px 基准小 20%） | `playDeathFx` 只写 `x/y`（阵亡 Prefab `_lpos` 本就是 `(0,0,0)`），**严禁写 `scale`**（池化复用节点每播一次乘一次会逐次缩水；且**严禁顺手把阵亡特效“统一口径”改回 110px**，它刻意缩小 20% 以免抢单位本体视觉重心） |

- **2026-10-28 用户要求降低资源包**：出生、五组受击及阵亡特效帧按常规显示尺寸缩图；Sprite 改为 `CUSTOM` + `trim=false`，保留原 UITransform 画布、根缩放、位置与帧 UUID。逐帧换图不得让画布跟着新图像素尺寸变化。
- **判据**：`tests/zcds-hit-fx.test.ts`（同一条用例同时断言**缩放倍数**与**屏上像素尺寸**，防止原图基数变动漏检）。 `tests/zcds-unit-fx-resolution.test.ts` 核对缩图和固定画布。

### 1.6 受击特效：总时长锁死 0.15s，且不许有定格（2026-10-17）

三条硬约束，缺任何一条都会出现「闪一下之后还剩一坨末帧杵在角色身上」：

| 关注点 | 唯一真源 | 说明 |
| :--- | :--- | :--- |
| **总时长 0.15s** | `ZCEffectPool.HIT_FX_TARGET_SECONDS` + `ZCGameModel.HIT_FX_SECONDS` | 两处必须同值（视图层不 import 模型层常量）；`tests/zcds-hit-fx.test.ts` 有源码级断言钉住 |
| **加速而不是截断** | `state.speed = clip.duration / 0.15` | 资产 `_duration` 仍是美术真值「帧数/18fps」（射手 0.4444s、法师 0.7222s）。改 `clip.duration` / `state.duration` 是**丢帧**，改 `speed` 才是加速 |
| **回收点跟着加速后的时长** | `playHitFx` 里 `duration: HIT_FX_TARGET_SECONDS` | 还按 `clip.duration` 回收 ⇒ 动画 0.15s 就播完、节点留到 0.44s，`wrapMode = Normal(1)` 把**末帧定住** |

- **`play()` 必然 seek 回 0**：`Animation.play(name)` → `crossFade(name, 0)` → `clear()` → `AnimationState.onPlay()` → `setTime(0)`。所以 ① 池化复用节点不会先闪一帧旧画面，无需额外 `stop()`；② **渲染循环里绝不能逐帧调 `playHitFx`**，必须走 `syncHitFx` 按 fx 对象引用去重，否则动画被钉死在第 0 帧。
- **`speed` 只在 `AnimationState.initialize()` 里从 `clip.speed` 取一次**，`play()` / `stop()` 都不重置 ⇒ 每次播放重算 `clip.duration / 0.15` 是幂等的，池化复用不会累乘。3.8.8 的 `play(name?)` **没有** `startTime` 第二参（`animation-component.ts:200`）。
- **判据**：`tests/zcds-hit-fx.test.ts`（`state.speed` 逐个职业断言 + 0.149s 未回收 / 0.15s 必回收 + 两处常量同值）。

### 1.7 出生特效：锁总时长 1.25s（2026-10-19，两次收紧）

用户口径两轮：「播放速度加快，动画总时长缩短成 80%」（2.0s → 1.6s）→「再加速，**1.6s → 1.25s**」。

- **唯一真源** `ZCEffectPool.SPAWN_FX_TARGET_SECONDS = 1.25` —— **锁总时长**，倍速由 clip 反推：
  `state.speed = clip.duration / 1.25`（美术原速 2.0s ⇒ **1.6×**，24 帧 / sample 12）。
  和受击那 0.15s 是同一套做法（见 §1.6）：只动 `speed`，**不改资产 `_duration`**
  （那是「帧数 / sample」的美术真值，改它等于把后半段关键帧丢掉，时间戳不会重排）。
- **回收点就是目标时长**：`duration = SPAWN_FX_TARGET_SECONDS`。`wrapMode = Normal(1)` 播完会**停在末帧**，
  还按 2.0s 回收就多出 0.75s 冻住的残影。拿不到 clip 时也按这个值占位。
- ⚠️ 尺寸 / 位置仍归 Prefab（§1.5），加速**只碰 `speed`**，别顺手写 `setScale`。
- **判据**：`tests/zcds-spawn-fx.test.ts`（`state.speed === 1.6`、1.2s 不回收 / 1.25s 必回收）。

### 1.8 中立资源奖励：金币飞向战斗金币栏（2026-11-04 恢复）

本次用户明确要求恢复之前的动画：「金币飞到战斗游戏金币栏」。此要求替代 2026-10-26 的格心金币喷发口径。

#### 一、金币堆 / 宝箱

- 玩家领取时，6 枚金币从资源格中心错峰飞向战斗 HUD 的**金币栏 `ZCGameHUD CoinPanel`（整个面板）**；每枚沿确定性弧线飞行，到达后淡出。
- 最后一枚金币到达后，在金币栏位置显示实际奖励金额「+N」，向上飘并淡出。
- 不叠加格心喷发；非玩家领取不向玩家金币栏飞行。金矿仍走建筑激活，兵力仍走单位出生表现。

#### 二、接线与坐标

- ZCGame 将 `hudView.coinPanel` 注入 `ZCGameRenderWorld` 的 `coinPanelNode`，目标节点是**整个 CoinPanel，不是 `GoldLabel` / `coin` 子图标**；旧字段名 `goldCounterNode` 已废弃，表现口径以 2026-11-04 用户指令为准（规则 405），历史注释与 `ZCNeutralBurst` 备用曲线只作档案、当前不接线。
- 渲染世界每帧用 `overlayLocalOf()` 把资源格中心与金币栏面板中心换算到 `overlayLayer` 局部坐标，再传给 `ZCNeutralRewardFx`。
- 金币目标缺失时跳过金币飞行，神器目标独立处理。节点随事件过期或换局统一销毁。
- HUD 挂点四段缺一不可：`ZCGameHUDView.coinPanel` 声明 → prefab 绑定 → `ZCGame.ts` 装配 `coinPanelNode` → `ZCGameRenderWorld.overlayLocalOf()`；任一断开金币整条不播、零报错。

#### 三、时间轴

复用 ZCBattlePresentationQueue 的飞行、错峰和上飘常量，以及 ZCNeutralRewardFx 的现有纯函数曲线；记录 startedAt，逐帧按当前时间计算，禁止累加 dt 或新建 tween。
事件存活时长必须覆盖飞行 + 最后一枚错峰 + 读数上飘的整段时间，不缩短现有队列保留时间。

#### 四、验证

tests/zcds-neutral-reward-fx.test.ts 覆盖正式装配的金币栏目标、真实渲染入口中的金币堆 / 宝箱、全屏层坐标转换、金币飞行、金币栏读数上飘以及过期清理。
神器仍保持格心爆炸 + 图标飞向神器按钮，见下节及 tests/zcds-artifact-claim-burst.test.ts。

#### 五、神器领取的格心爆炸：屏上边长 **90px**（2026-10-27）

`ZC_ARTIFACT_CLAIM_BURST_SIZE` 只决定**屏上大小**（`Sprite` 是 `CUSTOM` + `trim = false`，按 `UITransform` 拉满），与源图像素无关；2026-10-28 按用户要求将 18 帧从 300×300 缩至 90×90，原始尺寸仅用于下方历史问题说明。取值演进：

| 日期 | 值 | 口径 |
| :--- | :--- | :--- |
| 初版 | 220 | ≈1.7 格 —— 盖住邻格资源图标与造价数字 |
| 2026-10-26 | 150 | ≈1.15 格（「特效太大了」第一次收） |
| **2026-10-27** | **90** | **0.6 × 150，稳在一格之内**（0.73 × 顶面 123） |

- **上限口径**：一格顶面 `123×90`（`core/hex/HexGridLayout`）、地砖脚印 `130×119`（`ZCGameHex.prefab` 的 `TileBackground`），取最紧的 **123** 当红线 —— 用例直接断言 `≤ 123`。
- 🔴🔴 **这三次改动在屏上全都没生效过（2026-10-27 二次返工查出）**：`ZCNeutralRewardFx.createSprite`
  原来是「先 `transform.setContentSize(size)` → `addComponent(Sprite)` → **赋 `spriteFrame`** → 最后才
  `sizeMode = CUSTOM`」。`Sprite._sizeMode` 出厂是 `TRIMMED`，**赋图那一刻**引擎走
  `_applySpriteFrame() → _applySpriteSize()`，TRIMMED 分支直接 `setContentSize(rect.width, rect.height)`
  把节点写成**原图 300×300**；而 `sizeMode = CUSTOM` 的 setter 只在非 CUSTOM 时重算，**不会把尺寸还回来**。
  ⇒ 用户看到的始终是 300px（≈2.4 格），所以「怎么改都没变小」。
  修法：**先 CUSTOM + `trim = false` → 再赋 `spriteFrame` → 最后兜一次 `setContentSize`**。
  同一个 helper 建的三样都受影响，修好后一起生效：爆炸 300 → **90**、神器图标 230 → **40**
  （`ZC_NEUTRAL_REWARD_ARTIFACT_SIZE`）、金币 43 → **34**（`ZC_NEUTRAL_REWARD_COIN_SIZE`）。
- ⚠️ **别只用 `contentSize` 断言**：测试夹具里的 `cc.Sprite` 是空类，不模拟这条回写 ⇒
  「先设尺寸后 CUSTOM」的老写法在桩里照样绿。用例现在额外钉**赋值顺序**
  （`sizeMode` 的位置必须早于 `spriteFrame`，兜底的 `setContentSize` 必须晚于它）。
- 🔴 **问号状态不跟着缩**：图 1 那个「六边形底 + 问号指示器」是 `ZCHexView.artifactHexSpine`（prefab 里 **168×166.8**、Spine 循环动画，`artifact_charge` 专用），代码只切显隐与动画名、**一行尺寸都不写** ⇒ 改爆炸常量动不到它。
- 判据：`tests/zcds-artifact-claim-burst.test.ts` 的「爆炸屏上边长 90px（0.6 × 150、不超一格），问号态的六边形 Spine 尺寸不动」——同时钉住 `90 == 0.6 × 150`、`≤ 123`、节点实际 `contentSize`、`createSprite` 的赋值顺序、以及 `ArtifactHexSpine` 仍为 168×166.8。

### 1.9 废墟：底色按归属方混合灰，且**不再产金**（2026-10-29）

用户口径两条：

> 1.「战斗中形成废墟后，废墟的地块颜色需要和归属玩家的一致」
> 2.「形成废墟的建筑不会再生产金币，现在前端还有播放金币生成的动画」

**① 底色（`ZCHexView.territoryTint` + `ZCTheme.zcRuinsFactionColor`）**

- 改前：`state.state === 'ruins'` 时**无条件**返回 `ZC_CLIENT_COLORS.ruins`（`#5E656C` 一块中立灰），
  `state.owner` 完全没参与取色 ⇒ 谁的地被打成废墟都变成同一块灰，看不出这块废墟原来属于谁。
- 改后：`zcRuinsFactionColor(owner)` = **阵营色往废墟灰里线性混 `ZC_RUINS_GRAY_MIX = 0.45`**。
  实测 我方 `#7e82ff → #7075bd`、敌方 `#fb4969 → #b4566a`、3 号 `#fbcc49 → #b0a05a`、4 号 `#bd49fb → #8f56bd`。
  `0` = 跟完好领地一样（看不出废了）、`1` = 退回老 bug（全都一块灰）—— 两端都别取。
- `owner === 'neutral'` **原样返回废墟灰**：中立没有阵营色可混（`zcFactionColor('neutral')` 是浅石板色，
  混出来比灰还亮、反倒像"崭新"），中立废墟就是"没有归属的废墟"。
- alpha 不在函数里写死：`ZCHexView.TERRITORY_FILL_ALPHA` 由视图给，与普通领地同一口径（透明度的语义是
  「这格是不是领地」，不是「是不是废墟」）。取色优先级不变：扫场 `sweepOwner` → 开局扩散波 `claimWave` → 废墟 → 常规。
- 判据：`tests/zcds-ruins-tile-color.test.ts` —— 纯函数逐通道按公式复算、四席位废墟色两两不同、
  视图真的按 `state.owner` 出 `tileSprite.color`、源码守卫禁止再出现 `ZC_CLIENT_COLORS.ruins.r/g/b`。

**② 产金（`ZCEconomySystem.tickIncome`）**

- 🔴 真凶是**主城**那一路：主城收入原来是**无条件**给 `context.owners` 每一方发钱、飘字坐标写死
  `homeId(owner)`。主城被打成废墟（`building='none'` + `state='ruins'` + `hp=0`）之后，只要这一方
  还有别的建筑（`developedCount > 0`，对局没结束），这段循环照跑 ⇒ **废墟格每一拍飘一次「金币 + 数字」、
  还带着建筑抖动**，看起来就是"废墟还在产金币"。
- 金矿那一路本来就有 `building !== 'mine'` 兜着，所以之前只在主城上露出来。
- 修法：主城先 `isIncomeSource(hexById(homeId), 'hq')` 判「主城还在且还在运转」，判不过 `continue`；
  金矿改走同一条闸 `isIncomeSource(mine, 'mine')`。`isBuildingOperational` 同时补齐
  `building !== 'none'` 与 `state !== 'ruins'`（存档 / 回放里两者只其一的脏数据也挡住）。
- **不是"把产金关掉"**：同一时刻还活着的金矿必须照常产出、照常飘字 —— 用例用反向守卫钉住这一点
  （只钉"废墟没有飘字"的话，删掉整条产金也能绿）。
- 判据：`tests/zcds-ruins-income.test.ts` —— 主城废墟 + 旁边活金矿 ⇒ 主城坐标 0 条产金飘字、
  金币增量**恰好**等于金矿飘出的数值之和；金矿废墟同理；外加 `tickIncome` 的赋值顺序守卫。

### 1.10 战斗技能特效（`ZCCombatEffectView`）：锚点 / 层级 / 飞行段 / 朝向都**按 prefab 路径**配

技能特效（`pvpSkill.effectPrefabPath` 指向的那份 prefab）在 `ZCCombatEffectView` 里逐帧定位。
四件「画在哪、画在哪层、要不要飞、朝哪边」的事都是**纯表现配置**，一律不进 `ZCSnapshot`（快照只带
`fromX/fromY/toX/toY/durationSeconds` 这些逻辑事实）：

| 表现项 | 唯一真源 | 认法 | 判据 |
| :--- | :--- | :--- | :--- |
| 播放锚点 | `view/ZCCombatEffectPlacement.ts` 的 `ANCHOR_BY_PREFAB_PATH` | 特效 prefab 路径 | `tests/zcds-combat-effect-placement.test.ts` |
| 图层（地面 / 顶层） | 同上 `zcCombatEffectLayerOf` | **事件类型**（`area` ⇒ ground） | 同上 |
| 飞行段（位置 + 寿命 + 转角） | `model/ZCCombatEffectFlight.ts` 的 `FLIGHT_BY_PREFAB_PATH` | 特效 prefab 路径 | `tests/zcds-combat-effect-flight.test.ts` |
| 朝向（**只**转角，不飞） | 同上 `FACING_BY_PREFAB_PATH` | 特效 prefab 路径 | 同上 ⑥ |

**为什么按 prefab 路径认、而不是技能 id**：真正决定「该贴谁身上 / 该不该飞 / 该朝哪边」的是**画出来的是哪张图**。
同一个 prefab 被两条技能行复用时（30802 坚果重砸 / 30803 亡者护盾共用 `巨力坚果_普攻`）配一次就都对了。

**飞行段与朝向必须分两张表**：飞行段的记录里带着 `speed / min / max`，它同时决定**事件寿命**
（`zcCombatEffectTravelSeconds` 会把它喂给 `durationSeconds`）。把「只是想转个身」的效果登记进飞行表，
会顺手改掉它活多久 —— 这就是 `FACING_BY_PREFAB_PATH` 单独存在的唯一理由（`zcCombatEffectFacingOffsetOf`
里飞行段的偏移**优先**，同一个 prefab 不允许两张表给出两个答案）。

**猎头者普攻（2026-11-02 需求「特效需要匹配射程，改成像子弹一样飞向目标」）**：

| 事实 | 值 |
| :--- | :--- |
| 卡 | `pvpCard` 68012 猎头者，`unitSkillId = 30271`，`unitAttackRange = 500` |
| 技能行 | `pvpSkill` 30271 —— 名字叫「斧盾兵普攻」，**`mode = 'melee'`**，特效 `斧盾兵_反击气刃`（150×61 月牙，单帧） |
| 改前的两条硬伤 | ① `attackTravelSeconds` 对 melee 返回**固定 0.32s**（与距离无关）⇒「和射程对不上」；② 视图把特效**钉在锚点上播一次** ⇒ 没有飞行过程 |
| 改后 | 登记飞行段 `speed 420 / min 0.14 / max 0.6 / facingOffsetDegrees 0`：时长 = `距离 / speed`（满射程 150px ⇒ 0.357s），视图沿 `from → to` 插值并转角 |

- 🔴 **朝向 = 让箭头的「正面」沿弹道指着目标**，`facingOffsetDegrees` 只有一个含义：
  美术的正面画在哪个方向。美术 150×61，**亮白弧顶在右、速度线拖在左** ⇒ 正面就是 `+X` ⇒ 填 **`0`**
  （转角 = 弹道方向本身）。
- ⚠️ **别改回 90**。2026-11-02 第一轮曾按「长轴的法线朝目标」登记 `90`，实战截图里箭头变成
  **侧着飞**（正面朝上、敌人却在右边；当时的实测截图不入库），用户要求「顺时针再旋转 90°」
  —— 顺时针 = 负方向，`90 → 0` 正好 90°。判据只有一条：**明亮的弧顶那一头必须冲着目标**。
- 美术正面若画在 `+Y`（朝上），填 `-90`；一句话记法：**正面朝右填 0，正面朝上填 -90，逆时针为正**。
  - 转角算式 `zcCombatEffectFacingDegrees(弹道角, flight)` 是纯函数；弹道角**必须用视图坐标**算
    （`mapToViewX/Y` 的 x / y 缩放比不同，拿逻辑坐标直接 `atan2` 会算歪）。
  - 只影响转角，不影响位置与时长；同一个 prefab 的所有持有者共用这**一个**值 ——
    换成竖版美术（长轴本来就竖直）时记得把它调回 0。

- 🔴 **不改表**：`pvpSkill` 走 `RefUtil` 从远端 `refSmallAll` 拉，`assets/remoteRef/*.json` 只是拆分副本，
  单侧改会被覆盖（`tests/zcds-combat-effect-flight.test.ts` ⑤ 专门守着「30271 仍是 melee」）。
- 🔴 **`durationSeconds` 是纯表现**：melee 的伤害在 `state.combatEvents.push(event)` **之后立刻**
  `context.damageUnit(...)` 结算，`durationSeconds` 只决定事件存活多久（`ZCGameModel.advance` 按它剔除）。
  所以在这里按距离拉长是安全的 —— 但也意味着**它不能拿来调伤害节奏**。
- 🔴 不在 `FLIGHT_BY_PREFAB_PATH` 里登记的特效逐字不变（22 条近战特效保持原地播）。
  想登记一条之前先确认：美术是「能朝目标飞的形状」（月牙 / 箭矢 / 飞镖），正面砸地的爆炸类不要登记；
  以及这张图还被哪几条技能行引用 —— **同一张图的所有持有者会一起开始飞**（30271 另外还挂在
  饥饿战士 50030、艺术家 50033、怪物猎头者 50014 身上）。
- 实现细节：视图里飞行分支与 projectile 分支**共用同一套角度算式**，别各写一份；
  起点仍走 `ZCCombatEffectPlacement` 的锚点（渲染层建节点时的初值），所以第一帧不会闪。

**运动霸普攻 / 能量光束（2026-11-02 需求「技能特效没有朝向目标，现在的朝向是反的」）**：

| 事实 | 值 |
| :--- | :--- |
| 卡 | `pvpCard` 68033 运动霸，`unitSkillId = 30713`，`unitAttackRange = 45`，`unitMoveSpeed = 25` |
| 引用同一张图的行 | 30713「运动霸普攻」（`melee`）+ 30852「能量光束」（`area`）⇒ 换朝向两边一起生效 |
| 美术 | `消灭学霸_普攻` 228×256、15 帧绿色气刃：**亮白汇聚点在画布左侧**（最亮 15% 质心 x≈25~40，画布中心 114 ⇒ 根节点尺度下约 -37px），刃口向**右**散开 ⇒ 正前方 = `+X`，偏移 **0°** |
| 改前 | `ZCCombatEffectView` 对 melee / area 一律 `setRotationFromEuler(0,0,0)` ⇒ 美术朝哪边就朝哪边：目标站左边时正好反 180°，站上下时是「横着扫」 |
| 改后 | 登记 `FACING_BY_PREFAB_PATH[...]= 0`，转角 = 弹道方向（`zcCombatEffectHeadingDegrees`） |

- 只登记**美术本身有明确正前方**的效果。左右镜像对称的（`重骑兵_践踏` 那种横向冲击波）转不转都一样。
- `from === to` 的原地爆（气浪 / 扇形技 / 多点落点）返回 `null` 不转 —— 没有方向可言。
  `NaN` 也返回 `null`：`NaN` 流进 `setRotationFromEuler` 会让节点矩阵变 `NaN`，特效静默消失且不报错。
- ⚠️ 已知取舍：这张图的**汇聚点不在画布中心**（偏左约 37px），所以绕节点中心旋转时「出拳点」会以
  半径 ~40px 绕着角色转。气刃本身 114×128（视图 px）比近战射程（45×0.3 ≈ 13.5 世界 px）大一圈，
  所以观感上仍盖得住目标；若要彻底校正，得把 `消灭学霸_普攻.prefab` 里 `offset` 节点的 `_lpos`
  调到 `(80, 21)`（让汇聚点落到节点原点）—— 那是改美术摆位，未做。当时对照截图不入库。

### 1.11 冲刺（运动霸「拳击冲撞」）：**真·撞击**，撞到才算伤害；冲刺＝普攻本身（2026-11-03）

设计案口径：「挥拳冲撞当前目标，近战判定，命中结算 1 次伤害，距离敌人 120px 时开始冲刺，
冲刺阶段的移动速度 ×4」「开始冲刺时播放**循环的攻击动作**」。

> 🔴 **老实现（2026-10-31 ~ 11-01）是错的，已整体替换**：那时冲刺只是「距敌 `chargeDistance` 内
> 把移速乘 4」，`move` 分支仍一路 `advanceTowardUnit / advanceUnitMovement` **追着目标走**，
> 只要进了近战射程就必定结算 ⇒ **结构上不可能 miss**，冲刺也就没有躲的余地。
> 用户 2026-11-02 原话：「现在是会索敌的」。新语义见下表，各条均由用户逐条拍板。

| 环节 | 唯一真源 | 说明 |
| :--- | :--- | :--- |
| 起冲判定 | `ZCUnitSystem.tryStartDash()`（`updateUnit` 里 `attack` 之后、`waitAttack/idle/move` 之前） | 四个门槛**缺一不可**：有目标（**单位 / 城墙 / 建筑都算**）+ `chargeSpeedScale() > 1`（在 `chargeDistance` 内）+ `now >= nextAttackAt`（冷却就绪）+ 上下文真的给了 `dashStep/placeAt` |
| 终点 | `unit.dashX / dashY`（起冲时拍的**快照**） | 不是每帧读目标位置 —— 读现算值就等于没改，冲刺又会变成必中 |
| 推进 | `ZCMovementSystem.dashStep()` → `placeAt()` | 直线、不寻路、不改道；`dashStep` 只给**预测**落点，判完碰撞才 `placeAt` 落盘 |
| 命中 | `ZCUnitTargeting.dashFirstHit()` → `IZCDashHit.kind` | 线段扫掠圆，取**路径上第一个**进圈的对象（单位 / 城墙 / 建筑统一扫掠，不是只认锁定目标） |
| 收场 | 撞到 → 停在接触点并结算 1 次普攻；冲空 → **零伤害** | **四种收场都进 0.7s 冷却**，但只有「撞到」结算伤害 |
| 冷却 | `startDashCooldown()`：`nextAttackAt = now + attackInterval`、`dashRecoverUntil = nextAttackAt` | 从**撞上 / 冲空那一刻**起算（不是起冲）；时长就是这张卡的攻速 |

- 🔴 **冲刺＝普攻本身，不是额外的加速 buff**（2026-11-03 用户口径：「冲刺是运动霸的普通攻击，
  每次普通攻击都会有 0.7 秒的冷却时间，冷却时间静止在原地播放待机动作」）。
  所以 0.7s **没有新加一列**，直接改 `pvpCard 68033.unitAttackInterval`（原 1.8）：
  冲锋段（≈0.51s）是这一拳的动作，收场起算 0.7s 原地待机，然后下一次冲锋。
  好处是表源只有一处、`nextAttackAt` 只有一套时钟、快照不用加字段。
- 🔴 **起冲不扣冷却，收场才扣**（这条推翻过上一版）：`startDash` 只写 `dashX/dashY/dashUntil`。
  若在起冲处扣，中途被硬控打断 / 超时兜底这些路径就要靠「起冲时扣过」自证，
  而 0.7s 起算点也会比画面上「撞上」的时刻早约 0.5s。
- 🔴 **`dashRecoverUntil` 与 `nextAttackAt` 是同一时刻的两个用途**，必须一起写：
  前者管「这 0.7s 站住别动」（`updateUnit` 里放在 `born` 之后、**索敌之前**，冷却期间连
  `acquire` 都不做），后者管「什么时候能再出手」。只写前者会一边等一边挪窝，只写后者则
  冷却期间会追着目标走 —— 都不是「静止在原地播待机动作」。
- 🔴 **冷却期间 `charging === false`、`battleState === 'idle'`**：`charging` 是「本帧正在冲刺」
  的派生量，`ZCUnitView` 靠它把移动动作换成循环攻击动作；待机时还挂着它，播的就是出拳而不是待机。
- 🔴 **`charging` 每帧先清**：它不能是记忆量。不清的话，离开冲刺的那一帧（撞上 / 目标死亡 /
  被硬控）会把这个标记带进 idle，单位就会停在出拳姿势上。
- 🔴 **冲刺分支抢在所有状态之前**（`updateUnit` 里紧跟硬控闸门之后）。塞进 `move` 分支里是不够的：
  目标中途死亡 / 跑出射程都会让 `move` 提前 return，冲锋就半路刹车了 —— 真·撞击的前提是
  「冲出去就收不回来」。
- 🔴 **碰撞半径用近战 `reach`，不是双方 `bodyRadius` 求和**。`bodyRadius` 是给弹道算「贴脸」的
  （表里常是 6px，换算到世界坐标才 1.8），拿它当冲撞判定会变成「必须精确踩到对方脚心」，
  画面上看就是反复穿人。取 `attackReach` 还顺带把「改 `attackRange` 时冲撞手感跟着走」这条焊死。
  - 单位目标 `bodyRadius = 6` ⇒ `reach = 15.3`；**结构目标 `bodyRadius = 80`**（`STRUCTURE_TARGET_BODY_RADIUS`）
    ⇒ `reach = (45 + 80) × 0.3 = 37.5`，所以冲城墙时停在离地块心 37.5 处，不会钻进墙里。
- ⚠️ **城墙 / 建筑目标也走冲刺**（2026-11-03 用户口径「城墙 / 建筑目标也需要走冲刺，撞到就停止，
  撞到单位目标也会停止」）：撞到就停在接触点、结算一次，然后同样进 0.7s 待机。
  - 结构只在**它是当前锁定目标**时才参与扫掠 —— 冲锋路过一面无关的墙不该被它截住；
    那面墙本身由 `dashStep` 的「进不了敌方墙格」兜住。
  - `current()` 已经把合法性判完（墙要 `hasExposedWall`、建筑要 `hp > 0 && wallHp <= 0 && owner` 合法），
    墙被拆平 / 建筑爆了 ⇒ 返回 null ⇒ 不会冲过去撞空气。
  - 撞到后把 `targetWallHexId / targetBuildingHexId` 写成那个地块，`sendAttack` 据此分流到
    `damageWall / damageBuilding`。
- ⚠️ **`dashStep` 要放行「本次冲刺目标所在的那一格」**（`unit.targetWallHexId ?? unit.targetBuildingHexId`）：
  否则冲进目标城墙时，会被自己的「进不了敌方墙格」兜底提前截停，永远撞不到墙上。
- ⚠️ **冲空 / 超时 / 被硬控打断同责**：都不结算伤害，但**都要进 0.7s 冷却**。
  这三条以前靠「起冲就扣过」蒙对；改成收场扣之后必须各自显式调 `startDashCooldown`，
  漏一条就会出现「零成本冲锋」（硬控解掉下一帧立刻再冲）。`dashUntil` 只是超时兜底
  （终点不可达时别让冲刺永远挂着），正常收场靠「撞到」或「到点」。
- 📐 **看得见的冲锋段 = `chargeDistance × combatDistanceScale − 近战 reach`**：
  `220 × 0.3 = 66` 起点、`reach = 15.3` 终点 ⇒ 冲锋段 ≈ 50.7 世界 px，
  按 `moveSpeed 25 × 4 = 100 px/s` 约 **0.51s**（30fps 下 15 帧），「起冲 → 追过去 → 撞上」三段才读得出来。
  冲锋段（0.51s）**必须短于攻速（0.7s）**，否则收场瞬间冷却就到期，画面上根本看不到待机那一段。
  - 表值 `chargeDistance` 已于 **2026-11-02 由设计案的 120 改成 220**（`tools/config/set_yundongba_dash_distance.py`
    三处同写：表源 xlsx S 列 + `json/client/pvpSkill.json` + `assets/remoteRef/pvpSkill.json`）。
    这一条**偏离了设计案原值**，需要策划同步到 `pvpSkill` 真源，否则下次拉远端 ref 会被打回 120。
  - `unitAttackInterval` 于 **2026-11-03 由 1.8 改成 0.7**（`tools/config/set_yundongba_attack_interval.py`
    + `tools/config/write_card_interval.js`，同样是表源 + 两份 json 三处同写）。
- ⚠️ `chargeDistance` / `unitAttackInterval` / `attackRange` 都是 `pvpSkill` / `pvpCard` 的**远端表值**
  （`assets/remoteRef/*.json` 只是本地副本，`RefUtil` 拉的是 `refSmallAll`）—— 单侧改会被覆盖。
- **判据**：`tests/zcds-charge.test.ts`（27 条）—— ①起手距离几何 ②三个门槛各自失效 ③碰撞半径 /
  第一个目标 / 友军尸体跳过 ④`dashStep` 直线与撞墙、`placeAt` 朝向 ⑤起冲 / 命中 /
  **冲空零伤害照吃冷却** / 路径上第一个 / 冷却没好不起冲 / 硬控打断 / 超时兜底
  ⑤b**城墙与建筑也走冲刺、停在 37.5 处、作废结构不再冲** ⑥气浪仍是纯表现
  ⑦两处配表同值（`chargeDistance 220` / `unitAttackInterval 0.7`）+ 冲锋段 ≥ 0.4s 且短于攻速。


## 2. 抽到金卡的「传说卡出场横幅」（`ZCGameLegendBanner.prefab`）

抽到 `tier === 4`（金卡/传说）时，除地块上的小卡牌（`ZCGameCardReveal`，挂 `mapLayer`）外，同时在 **HUD 根节点 `options.overlayLayer`** 弹出全屏出场横幅 `ui/game/ZCGameLegendBanner.prefab`（四色底板与头像环按 `ZC_CLIENT_COLORS` 色相匹配 `owner`）。

- **角色图来源（2026-11-04，2026-11-13 调整）**：横幅与卡牌阵容页一致，按 `resolveCardHeroArt(card)` 取 `CARD_HEAD_ART_ROOT` 下的专属图；未配置专属图时该卡不产出职业占位（原 `ICON_ART_ROOT` 职业雕像兜底已随旧资源下线移除）。由本局资源作用域预载并经 `legendRoleArtFrames` 只读表注入；离场后不回填。地块翻牌继续使用独立的 `cardArtFrames`（`headIcon`）表。新立绘含 390×300 等宽幅画布，仍按画布高等比缩放到 280，底边对齐；下文 84 / 256 为旧资源样本，非规格限制。

- **宽度 = 屏幕宽度**（2026-10-19 用户口径「传说牌弹出的 UI 提示应该对齐屏幕的宽度」）：
  `applyLayout` 里 **根节点** = `viewWidth × (屏高 / 人数)`（它是「布局格子」，落位按它算），
  **底板 `Banner`** = `viewWidth × 417` —— 只跟宽度走，**高度永远是 prefab 的 417**，
  并强制回到 `x = 0`。设计稿 720 只是兜底（`DESIGN_WIDTH`）。
  - 只改根不改底板 ⇒ 底图仍是 720 宽、右边留一条缝（一次反馈的画面）；
  - 底板连高度也一起按「格子高」拉伸 ⇒ 2 人局被拉到 640，横幅平白长高一截、底边掉到屏幕中间
    （**另一次**反馈「横幅底部的高度被修改了」）。这两条都是实测踩过的，别合并成一次写入。
  ⚠️ 底板 / 标题 / 头像 / 卡名曾在 prefab 里被整体左移 62.6（左贴边、右空一截），已改回设计位；
  改这条链时别再把 `Banner` 往左挪。

- **四条静默失效硬约束**：
  1. **严禁挂 `mapLayer`**：必须挂 `options.overlayLayer`（HUD 根），否则会随棋盘 ScrollView 拖动并被 Mask 裁切。
  2. **立绘按画布规格等比放大到立绘区**（2026-11-02 需求「磁电菇（原「萨尔」）等旧角色，模型也要匹配 banner 的高度，
     放大对应的模型让它与 UI 等高」）：`Role` 节点 `sizeMode = RAW(2)`、中心锚点，
     **视图写的是等比 `scale = LEGEND_ROLE_TARGET_HEIGHT / 画布高`**，不是写死 UITransform 尺寸。
     - 目标高 **280**、静止位由 `legendRoleRestY()` = `LEGEND_ROLE_BOTTOM_Y(-188) + 280/2 = -48` 算出（脚踩下沿往上长）。
     - 为什么是 280 而不是底板的 417：底板是**右边高、左边斜切**的丝带（`legend_banner_02` 实测 `x=0` 处可见 252 高、
       `x=719` 处 363）。立绘落在 `x=-192`（png `x=168`），那一列可见区 `y ∈ [-189, 101]`、**291 高** —— 按 417 定高会顶穿丝带。
       280 = 291 × 96%；逐列实测最坏只探出 **6.7px**（`MF_BFS_YUREN` 的左肩），256 画布那批还富余 9~44px。
     - 为什么能做到「等高」：横幅左格取的是**卡面静态图**（`resolveLegendArt` ①），`cardHead` 里躺着两种画布 ——
       本地卡面 **256×256**（17 张）、旧角色走的老头像 **84×84**（27 张，`tx_icon_*`）。
       `sizeMode = RAW` 会把节点直接定成画布尺寸 ⇒ 84 那批只占 417 的 20%，截图里「磁电菇（原萨尔）小得像个图标」就是这么来的。
       84 档放大 **3.33 倍**、256 档 1.09 倍，视觉高一致。
     - 为什么按**画布**高归一而不是可见高：运行时的 `SpriteFrame` 只给 `rect` / `originalSize`（`.meta` 是 `trimType: none`
       ⇒ 都是整块画布），**拿不到 alpha 包围盒**。同画布内可见高的差异（256 那批 221~249、84 那批 81~84）是美术本身的高矮，
       不是该抹平的偏差。
     - ⚠️ 节点来自 `ZCNodePool` ⇒ 每次**绝对赋值**；解析器拿不到图时必须显式写回 1，否则复用回来还带着上一张卡的倍数。
     - ⚠️ 必须是 `setScale(s, s)` 等比。早前废弃的「按 `frame.height` 缩放到高度 333」是把**固定框 × 方形图**拼在一起，
       才会纵向压扁 30%；等比放大不会。2026-10-10 的「不缩放、就用 256×256」也已作废。
  3. **禁 Trim 尺寸覆写**：`CUSTOM` 尺寸的 Sprite 必须 `_isTrimmedMode = false`。
  4. **头像圆裁**：`Head` 节点挂载工程既有的 `CircleAvatar`（shader `circle-avatar`），禁止用 `cc.Mask`。
- **扇入与 Role 下落动画（row11）**：详见第 9.4 节。
- **异步头像晚注入**：`ZCGame.loadLegendPortraits()` 异步加载完成后，渲染层每帧 `renderLegendBanners` 里通过闭包取 `ProcedureGame.current?.resolveLegendPortrait(owner)` 喂给 `view.setPortraitResolver`；解析器更换时作废内容键、立刻重绘已弹出的横幅。加载失败则保留玩家色头像环，不阻断对局。
- **判据**：`tests/zcds-legend-banner.test.ts`、端到端探针 `tmp/_legendbanner_probe.mjs`。

## 3. 「冒险」领地页的职责边界（Prefab 骨架 + 视图 + MVC）

### 3.1 职责切分表

| 关注点 | 唯一归属模块 |
| :--- | :--- |
| 主城地图页骨架、布局、Widget 对齐 | `ui/main/MainTerritoryMap.prefab` + `app/main/MainTerritoryMap.ts` |
| 滚动 / 裁剪 / 拖拽 / 拖动中抑制子节点点击 | `cc.ScrollView`（挂在带 `Mask` 的 `MapViewport`，`content = MapLayer`，`cancelInnerEvents = true`） |
| 六边格 + 站点（按 `cellId` diff 复用） | `view/TerritoryMapView.ts` |
| 站点条目、图标 trim 补偿、未解锁格「银币图标 + 数值」排布 | `ui/territory/TerritoryStation.prefab` + `view/TerritoryStationView.ts` |
| 站点 / 待配置据点详情弹层 | `ui/territory/TerritorySiteDetail.prefab` + `view/TerritorySiteDetailPanel.ts`（页内 `instantiate` 持有，`Panel` 挂空 `cc.Button` 防点击穿透） |
| 配色真源 / 坐标换算 / 协议归一化 | `view/TerritoryTheme.ts` / `model/TerritoryMapLayout.ts` / `model/TerritoryMapConfig.ts` |
| 章节状态与业务规则（纯 TS） | `application/TerritoryModel.ts`（持有时钟与业务状态，原 `TerritoryPresenter` 已全面退役） |
| 界面展示数据纯函数投影（HUD / 关卡详情 / 提示 / 库存） | `application/TerritoryProjection.ts`（无副作用纯函数，从 `TerritoryModel` 剥离解耦） |
| 数据仓储（Cell / ChapterInfo / Campaign） | 全部位于 `application/`（`TerritoryCampaignRepository.ts` 等含真实配置/网络 I/O，不入纯 TS `model/`） |
| 意图、命令与视图事件定义 | `application/TerritoryEvents.ts`（唯一真源，包含 `TERRITORY_EVENTS.STATION_TAP` / `TerritoryUiEvent` / `TerritoryViewEvent`） |
| 网络/缓存订阅、时钟、界面意图与会话生命周期 | `application/TerritoryController.ts`，页面单实例，退出时统一解除订阅并取消异步任务 |
| 章节 JSON、地图美术与弹窗补图资源归属 | `framework/controller/ControllerBase.ts` 提供必需展示资源契约并统一释放，页面不保存可空 AssetService |
| 章节加载器、Repository、存档与 MVC 装配 | `application/TerritoryEntry.ts`，页面传入已绑定 ResourceScope 的资源入口 |
| 引擎生命周期与渲染接线 | `app/main/MainTerritoryMap.ts` 消费展示快照与表现命令、派发操作意图；`MainTabHost.showPage` 必须在 `setParent` 前调用 `initialize(this.controller.resources)` |

章节地图事件释放遵循全局规范 §2.1.1：Controller 退出时退订 UI、网络、缓存与时钟，同步意图 / 广播 / 定时回调不重复判断 disposed。退出前不再维护 `stopping` 状态：`model.dispose()` 先输出配对的 `busy=false` 收尾并清空输出订阅，Controller 保持输出订阅到 `model.dispose()` 返回后再 `stopOutput`，最后由 `super.dispose()` 释放资源（`isDisposed` 在 `releaseInputs()` 后即为真，资源要到 `scope.dispose()` 才释放）。`await` 后的有效性和取消检查继续保留。测试从事件入口验证解绑，不直接调用已保存的旧 handler。

### 3.2 七条硬口径

领地挂机产出通过主城左下角金币车征收入口点击领取，并弹出获得奖励。进入领地、占领结算及定时刷新只建立新据点的计时账本，不自动发奖或消费已有累计时间。入口不受旧主线 `CmdBattleLevel` / `CmdBattleChapter` 解锁条件控制；计时读取当前章节已占领据点的领地账本。整小时产出、配置上限及新占领据点不追溯历史时间的结算规则保持不变；重复点击不得重复领取。

章节地图的关卡、首领和异步据点统一两步点击：未解锁且区域未通关时，点击先请求解锁；**主线关卡（stage / boss）解锁回包成功后立刻请求开战、直接进战斗**（2026-10-29 口径「只有解锁那一次直开」），异步据点与绑不到关卡的格子只解锁、不自动弹窗；再次点击**已解锁**站点才打开对应详情（异步据点为「玩家关卡」，主线为「关卡界面」）。已通关区域跳过重复解锁，保留重复挑战入口。验证见 `tests/territory-presenter.test.ts`。

章节地图已解锁的关卡 / 首领 / 玩家据点在建筑上方显示短编号气泡（显示配置中的 `chapterId-stage`，例如 `1-5`，**连字符两侧不留空格**）。2026-10-28 用户指定底图 `image/spawn-region/frame_03`：使用蓝色带尖角原图，88×45、15 号白字，文字局部 y=5 对齐气泡正文；Sprite 先 CUSTOM + trim=false 再赋帧，采用 SLICED 保留边角，白色顶点色保留原图蓝色。同日按美术效果图校正文字样式：字重改**加粗**（美术稿笔画约占字高 25%，常规体只有 14%）、字距走 `spacingX = -1` 收紧（美术稿三字紧贴）、行高 20、字号 15 保持不变（实测字高/气泡高 0.50，美术稿 0.53，差的不是字号）。⚠️ 间距**不许写进字符串**：空格宽度跟字号 / 字体绑定，一旦换字号就会整体漂移；四个样式值统一从 `app/common/MapMarkerBadge` 导出（`MAP_MARKER_BADGE_FONT_SIZE` / `_LINE_HEIGHT` / `_SPACING_X` / `_BOLD` / `_TEXT_Y`），`renderLevelBubble` 必须整组覆盖 —— prefab 里的 `12 / 16 / 常规体` 是旧角标口径，只改字号会留下旧字重与旧字距。美术由 `TerritoryPageAssets` 经页面作用域的 AssetService 加载，`BundleCatalog` 路由到 battle 分包，不从视图加载。底部尖角距建筑可见顶边 3px；跟随 trim 和 `buildSize` 后的可见高度定位。大地图仍使用原有 88×30 编号牌，两边共用 `app/common/MapMarkerBadge` 的宽度、字号和定位函数。未解锁格保留银币条件，资源点及缺少有效建筑 / 气泡帧 / 关卡配置的站点不画气泡。气泡在共享角标层按需创建，`getStationLayers` 必须把角标层移至透明命中层之后，避免相邻行的 128×128 命中区抢走编号点击。点击沿用 `STATION_TAP`，隐藏 / 在途 / 生成淡入与站点同步，回收时统一销毁。判据：`tests/territory-station-batching.test.ts`、`tests/territory-tile-frames.test.ts`、`tests/territory-level-bubble-style.test.ts`（字重 / 字距 / 行高 / 抬升的常量守卫）、`tmp/territory-level-bubble-probe.mjs`（包含真实鼠标点击）。

快速寻敌优先按当前推进顺序定位未通关 Boss；没有未通关目标时，定位当前章节关卡序号最高的已通关 Boss，同区域优先选建筑格。Boss 关卡、首领波次与异步据点允许重复挑战，区域已通关时跳过再次解锁；详情按钮与地图点击均请求服务端开战，保留在途判重与迟到回包校验。主线 Boss / 首领使用章节格子战斗参数；异步据点沿用服务端确认通关后切宝箱子类型的规则，奖励以服务端结算为准。

1. **滚动用 `cc.ScrollView`**：禁止手写触摸拖拽或建多余 `view` 子节点；切章回中心调 `scrollToOffset(Vec2.ZERO, 0)`。
   - **内容层尺寸 = 地图包围盒 + 四周留白**（2026-10-21 用户口径「整体一起上移，不要被按钮遮挡」）。
     唯一出口 `model/TerritoryMapLayout.territoryMapContentSize()`（`TERRITORY_MAP_CONTENT_PADDING = 300`）。
     ⚠️ 留白不是装饰，是**可滚范围**：`ScrollView` 的偏移被「内容层尺寸 − 视口尺寸」钳死，
     内容层 ≡ 包围盒时，贴到地图下边缘的目标格**再大的抬升量也抬不动**（第一章起始格在第 18 行，
     理想偏移 1312.5、上限只有 940，差 372.5 —— 正好是被【快速寻敌】压住的那一截）。
     加了留白后滚到底时地图底边仍在视口底部之上 300px，而且**格心坐标一个都不用动**，
     `buildTerritoryMapLayout` 与共享格心对齐的契约继续成立。
     判据：`tests/territory-map-layout.test.ts`「滚到地图最底部时，底边仍在视口底部之上留白那么多」。
   - 底图 `syncBackground` 的 cover 必须按**内容层尺寸**算，不能按包围盒 —— 否则滚进留白那 300px 会露空白。
   - 效果对照（左：内容层 ≡ 包围盒；右：内容层 + 2×300 留白）：

   （示意图已随资源清理移除；按本节的位置与缩放口径验收。）
2. **节点按 `cellId` diff 复用**：`tickProgress` 每秒重绘，严禁 `destroyAllChildren` 全量重建。
3. **主城 HUD 与地图分层**：`MainTerritoryMap` 只保留地图与详情弹窗；主城顶部信息与导航由 `ArenaRoot` 承载。地图视口顶部贴页面顶边（`MapViewport.Widget.top = 0`），让格子云延伸到顶部 HUD 背后；底部仍预留 168px 导航区。`ArenaRoot` 的 `MapRoot` 排在 `TopHud` / `BottomHud` 前，确保 HUD 显示与按钮点击在地图之上，禁止再通过顶部视口留白裁掉云。进入地图先渲染本地存档，服务端状态后台单调合并，失败仅 `outputs.showTip`。
4. **`@property` 引用区分**：`{type: Node}` 直接是节点本身，组件引用才访问 `.node`。
5. **运行时不画站点解锁连线**：依赖连线仅存在于地图编辑器 `tools/map-editor/territory.html` 的 `g.layer-links` 开关。
6. **Model 纯度与单通知通道**：页内只走 `model.onOutput()` 一个**实例订阅**通道（纯 TS、返回退订函数、`dispose` 清空），Controller 经 `TerritoryViewEvent.Render/Command` 派发视图；视图间跨组件通知统一走**节点事件**（`node.on` / `node.emit` + `application/TerritoryEvents.ts` 的 `TERRITORY_EVENTS` 常量表），监听挂组件自身节点、随节点销毁自动清理；`TerritoryModel` 剥掉 `import type` 后严禁 import `cc`、`framework` 或具体边界实现类。
7. **建筑/站点落在格子可见台面中心（`cellCenter` + trim 补偿 + 可见宽归一 70）**：
   - **台面偏移**：地块底图 `img_land_01_gray`（130×119）可见台面占 `y = 2~91`（高 90px），下方 28px 为侧壁；锚点在整图中心 `y = 59` ⇒ 台面中心比锚点高 `HEX_GRID_CONTENT_LIFT = 12.5px`。因此 `TerritoryMapView.cellCenter()` 必须返回 `{ x: point.x, y: point.y + HEX_GRID_CONTENT_LIFT }`（注意：`syncGrid` 中格子节点自身坐标仍为 `(point.x, point.y, 0)`，只偏移格内建筑/站点内容）。
   - **逐图 trim 偏移补偿与可见宽归一（`TerritoryStationView.applyIconPlacement`）**：读取动态合批安全的 `frame.rect / originalSize / offset` 补偿美术非对称留白，并将**trim 后目标可见宽统一归一为 `84`**（2026-10-19 用户要求「当前尺寸调大 120%」：70 × 1.2；可见高 65~75，占台面高 90 的 72~83%，判据 `可见高 <= 台面高 × 0.85`）。取值历史：100 ⇒ 顶满格子（严禁回去）；70 ⇒ 2026-10-15 的保守值；换尺寸只改这一个常量，同屏建筑等比缩放、比例关系不变。
   - **未解锁格的「银币图标 + 数值」成对排布（`TerritoryStationView.applyCaptionPlacement`）**：2026-10-16 需求 —— 图标 **×1.1**、数值 **×1.5**、两者间距**恒 2px**，且这一对**以格心为中心**（数字多一位是往左长、图标同步让位，不是整体右漂）。
     - 间距**不能写成两个固定偏移**（旧实现是图标 `−24` / 数值 `+22`）：那样间距随位数漂，钉不住 2px。改为按**实测文本宽**算 —— 与 `ZCFloatTextView.renderGoldIcon` 的 `GOLD_ICON_GAP` 同一套口径。
     - 数值在条件模式下必须切 `overflow = NONE`：prefab 里它是 `SHRINK` + 固定 `92` 宽、文本居中，**量到的是框宽不是文本宽**（`LayerActivityLayout` 的数量框同理）。写完字符串后立刻调 `refreshCaptionTextLayout()`（`Label.updateRenderData(true)`）把布局逼到**同一帧**，否则「按 A 宽度摆、按 B 宽度画」会让间距偏掉。
     - 引擎还没量过的那一帧（读到出厂宽 92）按**位数**估宽（`CONDITION_DIGIT_WIDTH = 9.5`，Arial 数字等宽 `0.556em`）。
     - ⚠️ 退出条件模式必须还原 `overflow` 与两个缩放：`CaptionLabel` 同时承担「名称底条」文案（那边靠 `SHRINK` 防超宽），且站点节点是**池化复用**的。
- **判据**：`tests/territory-cell-center-align.test.ts`、`tests/territory-map-layout.test.ts`、`tests/territory-map-config.test.ts`、`tests/territory-page-split.test.ts`、`tests/territory-presenter.test.ts`、`tests/territory-station-batching.test.ts`（间距恒 2px / 1·3·5 位数 / 出厂宽那一帧 / 退出模式还原）、`tmp/_territory_probe.mjs`。
8. **领域模型与视图播放器语义分工**：`model/` 仅承载纯数学曲线与错峰时钟模型（`model/TerritoryHexSpawn.ts`、`model/TerritoryHexRecolor.ts`、`model/TerritoryTapFeedback.ts`），严禁引入 `cc`；`view/` 承载驱动 Cocos Node / UIOpacity / Sprite 的动画播放器，并暴露语义化别名（`TerritoryHexSpawnPlayer`、`TerritoryHexRecolorPlayer`、`TerritoryTapFeedbackPlayer`）；展示数据投影统一由 `application/TerritoryProjection.ts` 纯函数生成，使 `TerritoryModel` 专注于纯领域状态与开合规则管理。

未通关的 PVP（`asyncPvp`）气泡按 2026-11-23 蓝湖稿：**94×103**（94 的头像区 + 9 的小尾巴），红底仍是九宫格 `frame_02`；内部复用**左上角玩家卡的头像资源**（不是另画一套）：黄底头像框 `image/main/hud/hud_avatar_frame`（64×64）、玩家本人头像（54×54，`CmdRole.img` → head 表 → `icons/head`）、等级角标 `image/main/hud/hud_level_bg`（19×19，11 号白字）贴在左下角。头像 / 红底缺失时回退原「PVP」文字胶囊（黄框 / 角标缺失只少画对应一层，头像照常显示）。**已通关 PVP 按同日图1 改成「问号徽标」**：底图换成 **94×103 蓝底成品方图** `image/spawn-region/pvp_clear_frame`（切片原名 `frame_04`，但工程里该名已被宝箱水滴 `qipao_01` 占用），中心叠 **74×74 灰盾问号** `pvp_clear_icon`（切片 `tx_01`），**无文字 / 无等级角标**；问号距底图上沿 10 ⇒ 图标中心比气泡根中心高 4.5（`TERRITORY_PVP_CLEAR_BUBBLE_ICON_Y`）。新图任一缺失时回退原「PVP」蓝胶囊；未通关头像气泡、普通关卡编号、宝箱水滴均不动。**几何归 prefab**：头像框 / 角标 / 角标字的尺寸与落点固定在 `TerritoryStation.prefab` 的 `LevelBubble` 子树，`TerritoryStationView` 只绑 `@property`、换帧与切显隐，不在代码里写这类属性；只按底图刷新气泡根尺寸 / 图标边长与头像的 trim 落点。等级每帧读组合层注入的玩家资料，换头像 / 升级由组合层订阅 `CmdRole` 通知页面补一帧（页面本身不读缓存，守 `territory-mvc-boundary`）。普通关卡和宝箱布局不变，沿用原气泡的点击、定位、显隐与资源作用域。判据：`tests/territory-preview-bubble.test.ts`、`tests/territory-pvp-clear-bubble.test.ts`、`tests/territory-station-batching.test.ts`、`tests/territory-bubble-red-frame.test.ts`、`tests/territory-page-split.test.ts`。

### 3.3 随机资源格「翻开」：原地快碎裂（2026-10-16）

- 随机格请求（2026-11-04）：点击立即沿用按压/光圈反馈，等待服务器期间不弹全屏 loading；等待期间不展示「开启中…」文字。一次只处理一个随机格，期间保留地图拖动，拒绝其他格点击和快速定位，防止改交互号丢弃已发写请求。回包成功后才翻地、展示建筑和实际奖励；失败恢复点击并提示，网络失败先重拉章节快照核对是否已经解锁。切章/退出仍按会话作废旧结果。关卡解锁、开战和固定资源点保持原有等待流程。

需求原文：「地块反转动画优化，**两种方案都做，点击后随机播放**，让我根据播放的结果判断只保留哪一种方案」⇒ 用户看完两套后拍板「**只保留地块破碎效果的方案**」。

于是**只剩一套**：曲线 `hexShatterFx`（`core/hex/HexFlipPresentation.ts`，纯函数、零 `cc`，可脱离引擎单测）+ `HEX_SHATTER_SECONDS = 0.68s`（碎裂段 + 新地皮放大段），由 `TerritoryHexFlip` 走**一条**接线（材质 → `apply` 写口 → `applyFace` 换脸）：

| 环节 | 做法 |
| :--- | :--- |
| 地块本体 | **原地**碎：全程 `tileLift = 0`（不抬起）、`tileFlip = 1`（不旋转）、`tileScale = 1`（不缩整格）—— 需求原文「**原地**快碎裂」，格心坐标与格根缩放全程不动 |
| 碎裂 | **片元级碎块腐蚀**（`shaders/hex-flip.effect`）：格内归一化坐标切 4×4 网格 → 3×3 邻域 Voronoi 取最近 / 次近抖动种子 → `border` 随进度往块心推（错峰碎裂）+ 薄圈裂缝提亮 |
| 换脸点 | `HEX_SHATTER_ERODE_END = 0.55`：到这里旧地皮**已经碎没**，同一帧换成新地皮（换帧看不见） |
| 新地皮 | `revealScale` 从 `HEX_SHATTER_REVEAL_START = 0.42` 起由 0 涨到 1（末尾轻微过冲 `HEX_REVEAL_POP` 再收回）—— 写在**子节点 `Reveal`** 上 |
| 起手 | `flash` 在 `[0, HEX_SHATTER_FLASH_WINDOW = 0.16]` 内冲上去再退掉（整格朝白推一下） |

- **删除的部分（2026-10-16，方案1「抬起后绕水平轴垂直翻转 360°」整条下线）**：
  - core：`hexTurnFx` / `makeTurnFx`、`HEX_TURN_SECONDS = 0.72` / `HEX_TURN_FACE_SWAP = 0.75` / `HEX_TURN_EDGE_FADE_COS = 0.32`、随机点将 `pickHexFlipVariant` + 类型 `ZCHexFlipVariant`、`IZCHexFlipFx.tileSin`、`HEX_FLIP_PERSPECTIVE`（顶点层透视除法）、`hexFlipBodyGlow` + `HEX_FLIP_BODY_GLOW`（正面开口补光）；
  - 视图：每格抽中的 `variant` / `lastVariant` / `totalSecondsOf`、`flipCos` / `flipSin` / `flipPerspective` / `turnParams` 四个材质参数、以及「抬起期间提到同层末位」的 `raise`/`reindex`（`siblingIndex` 不再被动画碰）；
  - 着色器：顶点层 3D 旋转 + 透视除法、片元层体积明暗（`vDepth` / `vTurn`）、侧视淡出（`turnParams.x` / `vCos`）、正面开口补光（`glowStrength` / `vLocalY` / `rim`）。
  - 🔴 这些删除都是**逐像素等价**的：碎裂全程 `tileFlip(cos) = 1`、`tileLift = 0` ⇒ 旋转角 0（透视因子 `q ≡ 1`）、`abs(sin) = 0`（`mix(1, shade, 0) ≡ 1`）、补光强度恒 0、`smoothstep(0, t, |cos|) ≡ 1`。**别只把曲线补回来** —— 着色器那几段已经不在了，翻整圈会退化成纯压扁；要回看走版本历史（SVN）。
- **旧地皮由 `TerritoryMapView.syncFlip` 显式传入**（`{ from: art.tileLocked, to: art.tileCleared }`）：点击那一帧 `paintHexes`（同一次 `renderMap` 里**先**跑）已按新进度把地皮换成草地，不传旧的就等于「从新地皮开始碎」，读不出「翻开」这件事。
  - ⚠️ 换脸点必须**每帧重写**：`paintHexes` 是幂等全量重绘、随时可能把 `spriteFrame` 直接写成新地皮，动画中途被顶掉就是「碎到一半突然换地皮」。每帧比一次引用即可自愈。
  - ⚠️ `settle()` 必须落回**新地皮**：动画被 `reset()`（换章 / 重建格节点）打断时，不收口会永远停在泥巴块。
- **`Reveal` 子节点**（`TerritoryMapView.createHex` 挂，`sizeMode = RAW`，默认收起）：**不动格根** —— 格根缩放归对局的缩没段，动它会把格面框 / 底光 / 建筑一起放大。池化复用前必须把倍率还原成 `1`（`hideReveal`）。
- **底光（`GroundGlow` 序列帧）恒灭**：那道光画的是「地块抬起来后露出的原格开口」，而碎裂**不抬起**（`tileLift ≡ 0`）⇒ `hexFlipGroundGlowStrength` 恒 `0`。保留通道是因为它与对局共用同一份 core 推导；**别为了让底光出现去伪造抬升量**（那等于把「原地」破坏掉）。
- **着色器 `shaders/hex-flip.effect`**：uniform 只剩 `flipCenter` / `flipHalfHeight` / `flipHalfWidth` / `flashParams` / `shatterParams` / `shardGrid`；碎裂整段挂在 `shatterParams.x > 0.5` 上（为 `0` 时**逐像素等价于「没有碎裂」**，起手那几帧与静止态都走这条）。碎块划分用**格内归一化坐标 `vQuad`**（世界坐标 ÷ 实际半尺寸），**不能用 `a_texCoord`**（SpriteFrame 可能裁剪 / 进图集）。裂缝亮线必须**乘完遮罩之后**再加（它就长在遮罩边缘上，先加会被自己那圈 `shardMask < 1` 抹掉）。顶点**不做任何形变**（只换算 `vQuad`）。
  - ⚠️ 顶点 / 片元两段的 `uniform HexFlip` 块必须**逐字一致**（成员与顺序）—— 不一致不会报错，只会静默错读。用例直接对账两份成员表。
  - 半尺寸由**格子实际 `UITransform` 尺寸 × 世界缩放**派生（帧到位后是 126×117，与设计常量 130×119 差一圈），取不到才退回整图常量。
- **时长归属**：`HEX_FLIP_SECONDS`（0.384s）**只属于对局**（`ZCBattlePresentationQueue.ZC_HEX_FLIP_SECONDS`）；领地**不定义自己的时长常量**，直接按 core 的 `HEX_SHATTER_SECONDS` 计时（禁止再造 `TERRITORY_HEX_FLIP_MAX_SECONDS` 这类别名 / 第二份字面量——时长只存在 core 一份）。
- **判据**：`tests/territory-hex-flip.test.ts`（19 条：碎裂的「原地」三恒定、碎裂与放大单调 + 过冲幅度、白闪窗口、底光两个帧序分支、接线守卫，以及**删除守卫** —— 方案1 的符号 / uniform / 着色器四段与 `raise`/`reindex` 一律不许残留）。

### 3.4 建筑生成抖动 + 建筑展示滞后到地块翻转结束（2026-10-16 row14）

需求原文：「冒险 / **建筑生成增加类似战斗系统的建筑抖动效果** / **建筑展示的时间需要滞后，等待地块反转结束**」。

#### 一、抖动曲线只有一处真源：`core/hex/ShakePresentation.ts`

这条「先 Y 后 X」两段脉冲原本只长在 `app/zcds/view/ZCGameViewUtil.ts` 里；领地的建筑也要播同一条，而 **`app/territory` 与 `app/zcds` 之间没有任何依赖**（领地是独立页面，不该反向吃对局的视图层）⇒ 与 `HexFlipPresentation` 一样落到 `core/hex`。

| 符号 | 值 / 含义 |
| :--- | :--- |
| `SPAWN_SHAKE_STRETCH` | `0.1` —— **单位**自己出生那一下（110%） |
| `BUILDING_SHAKE_STRETCH` | `0.2` —— **建筑**生成（120%，需求原文「建筑模型放大比例改成 120%」） |
| `SPAWN_SHAKE_PHASE_SECONDS` | `0.12` —— 单段（Y 或 X）时长 |
| `SPAWN_SHAKE_TOTAL_SECONDS` | `0.24` = 两段之和 |
| `spawnShakePulse(t, stretch)` | `1 + stretch · sin(π t)`，`t` 钳到 `[0,1]`（出手 / 收手零斜率，无尖点） |
| `spawnShakeScaleY/X(elapsed, stretch)` | 前段拉 Y（X 恒 1）、后段拉 X（Y 已回落）；段外恒 1 |

- `ZCGameViewUtil` **只做转发**（`export { … } from '../../../core/hex/ShakePresentation'`），对局侧既有的 `from './ZCGameViewUtil'` 写法与数值全部不变 —— 但**真源只剩 core 那一处**，判据直接对账两份导出逐个相等。
- 两边都是把因子**乘进各自的基准缩放**（对局 `0.72`、领地 `BUILDING_VISIBLE_WIDTH / 可见宽`），不是覆盖 ⇒ 「抖完建筑尺寸变了」这种漂移不会发生。
- 推进方式两边不同：对局由渲染世界每帧调 `advanceBuildingShake(now)`（对局静态渲染是 0.15s 节流，播不出 0.24s 的抖动）；领地的站点视图本来就是每帧的，由自己的 `update(dt)` 推进（没在抖时只做一次数值比较，百来个站点的开销可以忽略）。

#### 二、建筑展示滞后到翻转结束：`ITerritoryStationRender.hidden`

随机资源格翻开的那一帧，进度上已经是「已开启」，但地皮正在翻 ⇒ 建筑必须等翻转播完才出现。

- `TerritoryMapView.syncFlip` 在 `hexFlip.play(...)` **返回 true** 时才把 cellId 记进 `pendingBuildingReveal` —— 没注入 effect（`play` 返回 `false`）**不会**登记，建筑照旧立刻出现，不会变成「格子不动、建筑也不出来」。
- `syncStations` 对在待办里的格子改用 `{ ...content, hidden: true }` 渲染，并把**这一份 content** 存进 `pendingBuildingRender`（解除待办发生在 `update`，那时算不出 content）。
- `update(dt)` 里 `hexFlip.step(dt)` 之后立刻 `resolveBuildingReveal()`：这一格的 `isPlaying` 已经变 false ⇒ **同一帧**用存下的 content 重画一次（不带 `hidden`）并 `view.playBuildingShake()`。
- 换章 / 重建格子（`syncGrid` 的换图分支）必须 `clear()` 两张表，否则新图上同名格会永远等一个不会播完的翻转。
- 🔴 **`renderMap` 里 `syncFlip` 必须排在 `syncStations` 之前**：排后面的话站点会先按「已开启」画一帧，表现为建筑**闪一下就消失**（下一帧才被隐藏、要等 0.7s 再长出来）。

为什么不能靠 `icon: null` 实现隐藏 —— `TerritoryStationView.render` 里 `hasBuilding = !isCondition && content.icon !== null`，`icon` 一为空，名称底条 / 名称 / 角标三者的 `active` **全部变 true**（反而多出一条底条）。所以走独立的 `hidden` 闸：只关**四个视觉节点**的 `active`，并且 `button.interactable` 一并关掉。

⚠️ 也不能关 `this.node.active`：四个视觉节点在 `initialize` 里已被 reparent 到**共享 layer**（`StationIconLayer` 等），站点根节点上只剩命中区 —— 关根节点只关掉点击，视觉照旧留在屏幕上。

#### 三、判据

`tests/territory-building-shake.test.ts`（8 条）：core 零依赖 + 对局侧转发逐项相等 + 领地不出现 `zcds`；120% 与「先 Y 后 X」、段外恒 1；抖动**乘**在归一化基准缩放上、播完复位、`dispose` 停表；`hidden` 只关四个视觉节点（并反向钉「关根节点没用」）；翻开登记待办 → 翻转期间 `hidden` → 播完同一帧补建筑并抖一次；没翻格不登记；换章清空；`renderMap` / `update` 的顺序守卫。

### 3.5 领地「获得银币 / 体力」：格心喷发（抛物线倒锥 + 由小变大 + 持续自转）+ 读数在其上方 40px（row17，喷发口径 2026-11-02 改）

需求原文（2026-10-16）：「获得银币或者体力时，播放**喷发**的效果，喷发**多个图标**，多个图片的喷发范围限制在一个**倒圆锥**的图形，喷发的坐标点对应**点击地块的中心点坐标**，图标和数字 ui 增加上移的动画放在例子效果坐标点的**上方间隔 40px**」。

2026-10-17 用户把喷发单独细化成一整套物理口径（12 颗 / 错峰 0.025s / ±26° / 初速 650±12% / 重力 1500 / 抛物线 / 落回台面 0.12s 淡出且不穿模），**喷发段已按新口径重写**，读数那条 1.15s 时间线一行没动。

🔴 **2026-11-02 又改了一次粒子自身动画**：用户原话「优化【种族经验】粒子的发射动画优化，**取消垂直反转效果**，改成粒子**由小变大生成**，同时伴随**持续的旋转效果**」 ⇒ 2026-10-17 那版「绕自身水平轴上下翻面」（`scaleY = baseScale·cos(ωt+phase)`）**整段作废**。轨迹、错峰、淡出三条一个字没动，只换了「每颗粒子自己怎么变大小 / 怎么转」。

#### 一、一句话分工：喷发一半，读一半

| 需求里的句子 | 落点 |
| :--- | :--- |
| 「喷发多个图标」 | `TERRITORY_GAIN_BURST_COUNT = 12` 颗粒子（**每颗都是一个资源图标**，不是一颗带动画的图） |
| 「限制在倒圆锥」 | `TERRITORY_GAIN_BURST_HALF_ANGLE_DEG = 26` —— **出射方向**与屏幕竖直轴夹角的上限 |
| 「喷发坐标点 = 点击地块的中心点」 | `TerritoryMapView.playResourceGain`：`originY = hex.position.y + HEX_GRID_CONTENT_LIFT` |
| 「图标和数字 ui … 上方间隔 40px」 | `baseY = originY + TERRITORY_GAIN_START_LIFT_PX`（该常量就是 `40`），仍由 `TerritoryResourceGainView` 升起 1.15s |
| 「icon 由小变大 + 持续旋转」（2026-11-02 取代旧的「上下翻转」） | `territoryBurstParticle` 的 `scale` / `rotation`（见第三节），视图只写 `setScale(s, s, 1)` + `angle = rotation` |
| 「落回地块表面即淡出、不穿模」 | 抛物线落点 + `SURFACE_FADE_SECONDS = 0.12` + 位置冻在落点 |

🔴 **两处都必须加 `HEX_GRID_CONTENT_LIFT`（12.5），而且只加一次**：`hex.position` 是**蜂窝几何的布局点**，人眼看到的台面中心才在它上面 12.5px（`cellCenter()` 同一个口径）。读数的起点因此是「格心 + 40」，**不是**「格心 + 30」也不再是「布局点 + 70」—— 判据里有一条反向守卫钉死这个加法结构。

#### 二、倒锥约束的是**出射方向**，不是「任意时刻 |x| ≤ y·tan」

初版是「径向直线 + `easeOutCubic`」，所以 `|offsetX| / offsetY = |tan θ|` 全程成立。改成抛物线后**这条式子不再成立**：位置角从出射角开始一路变大，到顶点时 `x / y` 趋于无穷。真正的不变量只有出射速度方向：

```
phi = random(-1, 1) · 半顶角
vx  = speed · sin(phi)        vy = speed · cos(phi)
|vx| / vy = |tan phi| ≤ tan(26°)        ← 出射那一刻成立，之后不再约束
```

抛物线的实际边界（判据用的就是这个）：
- 顶点 `t = vy / g`，高度 `apex = vy² / 2g`（≈ 88~177px，取决于是 `-12%` 还是 `+12%` 的初速）；
- 落回台面 `t = 2vy/g`，此时 `|x| = |vx| · 2vy/g ≤ 2·tan(半顶角)·vy²/g = 4·tan(半顶角)·apex`。

| 符号（`model/TerritoryResourceGain`） | 值 / 含义 |
| :--- | :--- |
| `TERRITORY_GAIN_BURST_COUNT` | `12` —— 一喷几颗 |
| `TERRITORY_GAIN_BURST_HALF_ANGLE_DEG` | `26` —— 半顶角（判据的斜率就从它算 `tan`，测试里**不许另抄角度**） |
| `TERRITORY_GAIN_BURST_SPEED` / `_SPEED_JITTER` | `650` / `0.12` —— 初速与 ±12% 随机量 |
| `TERRITORY_GAIN_BURST_GRAVITY` | `1500` —— 重力（抛物线靠它把粒子拉回来） |
| `TERRITORY_GAIN_BURST_STAGGER_SECONDS` | `0.025` —— 相邻两颗的出发间隔；12 颗铺开 0.275s ⇒ **绝不与首颗同帧** |
| `TERRITORY_GAIN_BURST_LIFE_SECONDS` / `_LIFE_JITTER` | `1.1` / `0.15` —— 单颗存活时长 ±15% |
| `TERRITORY_GAIN_BURST_FADE_SECONDS` | `0.25` —— **生命先到期**时的末段淡出 |
| `TERRITORY_GAIN_BURST_SURFACE_FADE_SECONDS` | `0.12` —— **落回台面**后的快速淡出 |
| `TERRITORY_GAIN_BURST_BASE_SCALE` / `_SCALE_JITTER` | `1` / `0.2` ⇒ 基础缩放 0.8~1.2 |
| `TERRITORY_GAIN_BURST_GROW_SECONDS` / `_GROW_START_SCALE` | `0.18` / `0.15` —— 由小变大的时长与出生系数（0.18s 后恒为 1） |
| `TERRITORY_GAIN_BURST_SPIN_MIN_HZ` / `_MAX_HZ` | `0.6` / `1.1` —— 自转速度区间（**圈/秒**） |
| `TERRITORY_GAIN_BURST_TOTAL_SECONDS` | `1.54` = 最后一颗的出发时刻 + **最长**生命。⚠️ 只是**硬上限**，视图真正的收尾判据是「一颗活的都没有」（实际 ≈1.2s） |
| `territoryBurstLaunch(seed, index)` | 纯函数：出射参数 `{ phi, speed, vx, vy, baseScale, spinHz, phase, life }`，同一 `(seed, index)` 恒等 |
| `territoryBurstParticle(seed, index, elapsed)` | 纯函数（零 `cc`）：`null` = 这颗**还没出发**或**已经消失**；`index` 不在 `[0, COUNT)` 整数值、`elapsed` 非有限/为负 ⇒ `null` |

🔴 **轨迹用解析式 `y = vy·t − ½g t²`，不要写成逐帧累加**：两者数学上等价，但累加会让落点随帧率变（30fps 两帧 ≠ 60fps 四帧），违反「动画一律 记录 startedAt + 纯函数算进度」这条全局约束。

⚠️ 抖动**不用 `Math.random()`**：同一 `(seed, index)` 必须给出同一组参数，否则倒锥判据没法验、池化复用的问题也没法复现。「每次点击不一样」由 `TerritoryMapView.burstSeed`（每次点击自增）提供。

#### 三、粒子自身：由小变大 + 持续自转（2026-11-02 取代旧的「上下翻面」）

用户改口径：「取消垂直反转效果，改成粒子由小变大生成，同时伴随持续的旋转效果」。

```
grow     = GROW_START + (1 − GROW_START) · easeOutCubic(min(1, t / 0.18))     GROW_START = 0.15
scale    = baseScale · grow                                                 ← 横纵**同一个值**
rotation = 360 · spinHz · t + phase°                                        spinHz ∈ [0.6, 1.1] 圈/秒
```

- **横纵等比**：`scale` 只有一个标量，视图写 `setScale(fx.scale, fx.scale, 1)`。旧版的 `scaleX / scaleY` 字段已**删除** —— 留着就有人会再写一次「压扁 y」。
- **出生就看得见**：起点不取 `0`，取 `0.15`。取 0 会让「出现」的第一帧完全是空的，看起来像掉帧。
- **0.18s 之后恒为 1**：再长会盖住错峰（相邻两颗只差 0.025s），0.18s ≈ 11 帧，正好「看得出它长出来」。
- **自转匀速、不取模**：`rotation` 随 `t` 一直累加。取 `% 360` 会在回绕那一帧被引擎读成「倒转回去」，观感是转一下卡一下。
- 🔴 **翻面 ≠ 自转**：前者压 `scaleY`（会翻到背面、宽度不变），后者只写 `node.angle`（图标永远正面朝上）。两者**不能**同时叠加，混着做会得到"既翻又转"的怪相。
- 12 颗的 `spinHz` 与 `phase` 都两两不同（各取一次哈希）⇒ 不会同步转。

#### 四、怎么收：先到的那条说了算

| 条件 | 触发时刻 | 淡出窗口 | 位置 |
| :--- | :--- | :--- | :--- |
| 落回台面 | `2vy/g`（≈0.69~0.97s） | `0.12s` | **冻在落点**（`offsetY` 恒 0、横向也不再滑） |
| 生命到期 | `life`（1.1s ±15%） | 末段 `0.25s` | 落点 / 空中 |

- 两条取**先到的**。实测只有 **0.3%** 的样本是「生命先到期」（要初速贴近 +12% 上限**且**生命贴近 −15% 下限），绝大多数都是落回台面。
- 落地后位置**冻住**而不是只夹 `y`：只夹 `y` 会读成「图标贴着地皮横滑一段」。
- 收尾前的最后一帧必须几乎全透明（`opacity < 0.02`）⇒ 回收时是「淡没」不是「跳没」。

#### 五、粒子组：纯类、逐帧、无 prefab

`view/TerritoryGainBurst.ts`（**不是** `Component`，与 `TerritoryHexFlip` 同一套路）：

- 一次喷发 = **一个原点容器** + 12 颗粒子；容器摆在喷发原点，粒子的位移直接写成容器的局部坐标 ⇒ 「相对原点」只在一个地方表达。
- 每颗粒子**各自**挂一个 `UIOpacity`（错峰 + 各自淡出决定了它们不能共用根上那一个），`Sprite` 用 `sizeMode = CUSTOM` + `trim = false`，尺寸 `TERRITORY_GAIN_BURST_ICON_SIZE = 64`（需求默认值；觉得 12×64 太满只改这一个数，喷发曲线不受影响）。
- 图标按 `entries` **轮流取**（同时给银币 + 体力 ⇒ 两种图各喷一半）；`frames` 为空（图没加载出来）只是那几颗是空的，**不是**把整喷关掉 —— 与飘字「缺图仍照常升」同一口径。
- 逐帧 `step(dt)` 由 `TerritoryMapView.update` 推进，**禁用 tween**（池化复用的节点上挂 tween 会在回收后继续跑，规则 106 / 247）。`stop()` 把容器**和每颗粒子**一起复位（只收容器会留下上一喷的残影）。
- `step` 的收尾判据是 `apply()` 返回「还有没有活着的粒子」，`TOTAL_SECONDS` 只作硬上限兜底 —— 死等上限会让容器白挂 0.3s 空帧。
- 🔴 **粒子层必须是 `GainLayer` 的第一个子节点**（`TerritoryMapView.ensureBurstRoot` 里 `setSiblingIndex(0)`）：子节点顺序 = 渲染顺序，飘字节点是后建的，排在后面 ⇒ 粒子画在「+N 读数」**之下**；这条顺序只在建层那一刻定一次，之后两个池都不再动兄弟序。
- **为什么不建 prefab**：一粒粒子只有「一张可换的图 + 位置 / 缩放 / 角度 / 透明度」，没有任何图集布局参数，而图本来就要由页面注入（飘字 prefab 里「帧由代码注入，prefab 里不许写死」的同一理由）⇒ 建 prefab 等于把同一张图的占位写十二遍。

#### 六、判据

`tests/territory-resource-gain.test.ts`（39 条，其中喷发占 17 条）：
- 出射：12 颗 / 0.025s 错峰 / 绝不与首颗同帧 / 总时长 = 出发时刻 + 最长生命；
- 倒锥：`|phi| ≤ 半顶角`、`vx = speed·sinφ`、`vy = speed·cosφ`、`|vx|/vy ≤ tan26°`、初速 ±12%、左右都铺开且**200 次喷发整体无水平偏向**；
- 抛物线：上升段单调、不穿模（`y ≥ 0`）、峰值 ≈ `vy²/2g`、横向不越过 `2·tan·vy²/g`；
- 生长 + 自转：`scale` 逐位等于生长式、**恒正**（翻面的直接反证）、出生帧 = `GROW_START`、单调不减且相邻帧不硬切、`rotation` 逐位等于自转式且**严格递增**（不取模）、角度增量 = `spinHz·360·dt`、12 颗转速与初相两两不同、一颗生命里至少转半圈；
- 收尾：落台面 0.12s（位置冻在落点）与生命末段 0.25s 两条分支各自命中、收尾帧几乎全透明；
- 确定性、脏输入全 `null`；粒子组沙箱（真代码 + `cc` 打桩）验容器落在原点、粒子数 = 常量、逐帧节点值逐位等于模型（含 `scale.x === scale.y === fx.scale`、`angle === fx.rotation`）、错峰可见、出生帧明显小于满尺寸、放完提前收起、复用能重新点亮；接线守卫（`originY` / `baseY` 的加法结构、喷发只喷一次且排在飘字之前、`setSiblingIndex(0)`、`stepBursts`）、以及「粒子组不许 instantiate prefab / 不许出现 tween」。

### 3.6 领地奖励图标：**必须查两张表**，`item` 的图在 `main-pages` 分包（2026-10-26）

现场：点开随机资源格 → 4 条 `+165 / +143 / +141 / +151` 飘字**前面全没有图标**，一格 12 颗喷发粒子
**一颗都看不见**。用户的第一反应是「是不是策划表没转 JSON、所以找不到 icon」。

**结论：表没坏、图也没缺，是解析链断了两处。**

| 环节 | 真源 | 证据 |
|---|---|---|
| 表 | `assets/remoteRef/roleProperty.json`（17 行）、`assets/remoteRef/item.json`（389 行） | 都在盘上，`RefUtil` → `remoteRef` bundle 正常（HUD 货币条就是同一张表） |
| 图 | `roleProperty` 图在 `assets/resources/icons/{resource,common}`、`image/main/resbar`；`item` 图在 **`assets/bundles/main-pages/icons/{item,equip,gem,skill,hero}`** | 截图里格子上的银币小图标渲染正常 ⇒ 首包那条链是通的 |

#### 一、两个断点（是**同一个**症状的两个必要条件）

1. **`ensureRewardIcon` 只查 `roleProperty`**：`resBarCellOfRefId(resId, rows)` 的 `itemRows` 留空 ⇒
   `itemRowOfResId(undefined, …)` 恒 `null` ⇒ `kind` 只能是 `roleProperty` / `unknown`，
   **`item` 分支是死代码**。随机池发的恰恰是道具（`16001` 精灵弓箭手、`16014` 天赋石…，只在 `item` 表里）
   ⇒ 全部 `unknown` ⇒ `frame = null`。
2. **`item.icon` 的图不在首包**：存的是 `icons/item/图标_兵书弓兵`，实盘在 `assets/bundles/main-pages/`。
   老代码 `assets.load(cell.icon, SpriteFrame)` 两坑都踩：少拼 `/spriteFrame`（Cocos 索引里只有
   `xxx/spriteFrame`，报 `Bundle resources doesn't contain …`，**不是 404**）+ 当成 `resources` 相对路径。

**为什么「图标没有」和「粒子没有」是一起发生的**：`TerritoryMapView.playGainBurst` 与飘字用
**同一批** `gainIcons` frame，`Sprite` 没有 `spriteFrame` 就什么都不画 —— 不是两套表现各坏一次。

#### 二、口径（唯一出口）

```ts
const [propRows, itemRows] = await Promise.all([
    this.refRows<IResPropertyRow>(ROLE_PROPERTY_TABLE),
    this.refRows<IItemRefRow>(ITEM_TABLE),
]);
const path = resBarIconSpritePath(resBarCellOfRefId(resId, propRows, itemRows));
if (path) frame = await assets.load(path, SpriteFrame);   // bundle 由 CocosAssetService 自动路由
```

- `ResTypes.resBarCellOfRefId`：**`roleProperty` 优先、其次 `item`**（与货币条、奖励格同口径）。
- `ResTypes.resBarIconSpritePath`（本轮新增）：把 `IResBarCell` 拼成**可 load 的全名**。
  - `roleProperty` 裸名 `图标_铜币` → `spriteFramePath(resIconRoot(name), name)`（三张例外查覆盖表）；
  - `item` 路径 `icons/item/x` → `spriteFramePathOf(path)`（幂等补 `/spriteFrame`）。
  - **bundle 路由不在这层做**：`CocosAssetService` 按 `BundleCatalog.bundleForPath` 前缀自动选包，
    没加载的包它自己 `loadBundle`（所以 `main-pages` 不用页面预先拉起）。
- 表按名记忆 **Promise**（`refRows`）：一格 3~5 种资源、连开几格时只有第一次真的读表。

#### 三、红线

- 🔴 **不许为「看起来有东西」放假图**。`item` 表 389 行里当前有 11 行没填 `icon`、1 行图两边都没有
  （`10118` 图标_随机宝石宝箱）⇒ 这些奖励**只有数字、没有图标**。飘一个金币去代表「图纸」比没有图更误导；
  全工程口径一致（奖励格缺图就只剩品质框）。缺图打一条带 `resId` 的 `console.warn`，催美术时有据可查。
- 🔴 **缺图不等于关掉表现**：喷发照播、`+N` 照飘、奖励照发。
- 🔴 **不许再出现两参 `resBarCellOfRefId(resId, rows)`**：任何"随机池 / 服务端回包"给的 `resId` 都可能落在
  `item` 表里。

#### 四、判据

- `tests/res-types.test.ts`（3 条）：`roleProperty` 裸名 → 首包目录（含 3 / 13 / 14 三张覆盖表例外，逐条对实盘）；
  `item` → `main-pages` 且后缀幂等；`item` **全表 389 行逐行对实盘**（首包或 `main-pages` 至少一处有图，
  缺图行数 ≤ 12，涨了就红）。
- `tests/territory-resource-gain.test.ts`（2 条，源码守卫）：`refRows<IItemRefRow>(ITEM_TABLE)` 必须出现、
  `resBarCellOfRefId` 必须**三参**、两参写法与 `assets.load(cell.icon` 不许回潮、拼路径必须走
  `resBarIconSpritePath`；缺图只缓存 `null` + warn，且**不许拿银币图顶替**。

#### 五、读数合成一条：统一图标 + 数量之和（2026-10-26 追加）

图标修好之后现场变成另一个样子：随机格一次发 4 种种族经验（僵尸 / 盆栽 / 花果 / 蘑菇），
实机是「**4 行飘字、4 个不同的球、4 个数字**」—— 玩家读不出总量，也不懂图为什么不一样。

口径（用户原话）：「将 icon 和数字 UI 的部分统一使用【种族经验球_随机】的 icon，数字则是
全部加起来之和，粒子喷发使用对应的 icon 规则保持不变。」

| 部分 | 改成什么 | 落点 |
|---|---|---|
| **读数**（icon + 数字） | **一条**：图标统一 `种族经验球_随机`，数字 = **全部数量之和** | `TerritoryMapView.playResourceGain` 的 `readout` 参数 |
| **喷发粒子** | **不变**：仍按每种奖励**各自的图**轮流喷、个数仍按数量之和分级 | `playGainBurst`（一行没动） |

- 统一图标是**写死的美术路径** `TERRITORY_RANDOM_GAIN_READOUT_ART = 'icons/item/种族经验球_随机'`
  （`ArtPaths`）—— 当前 `item` / `roleProperty` 两张表里**没有任何 resId 指向这张图**，它是美术给
  「随机种族经验值」这个槽位出的占位图，所以不去表里查 `resId`。图同样在 **`main-pages` 分包**。
- 为什么**喷发不跟着统一**：喷发是「这一格给的是混合资源」的视觉证据，4 种球各喷几颗比全喷同一种更准确；
  而且用户明确要求这块「规则保持不变」。
- 合成模式**不叠加**：读数落在 `originY + 40px` 那条起点线上（`index = 0`），不吃
  `TERRITORY_GAIN_STACK_GAP_PX`；逐条模式（银币 / 体力那条 `settleRewards` 路）行为完全不变。
- **合成读数的起点再抬 30px ⇒ 70**（2026-10-26 第三张截图口径：「金球加数字 UI 的初始位置
  增加 30px，不会遮挡粒子效果」）。种族经验球那张图比银币大，贴着 40px 会和格心喷出的那把粒子
  挤在同一片区域。常量：`TERRITORY_GAIN_READOUT_EXTRA_LIFT_PX = 30`、
  `TERRITORY_GAIN_READOUT_LIFT_PX = TERRITORY_GAIN_START_LIFT_PX + 30 = 70`。
  🔴 **`TERRITORY_GAIN_START_LIFT_PX` 仍是 40**（row17 需求原值 + §3.5 / `territory-cell-center-align`
  的判据都锚它）—— 这里只多出一个「合成读音专属」的抬升，不许把 40 直接改成 70。
- 取不到图 ⇒ `readout.frame = null`，读数只剩数字（`+550`），喷发与发奖照旧 + 一条 warn。

判据：`tests/territory-resource-gain.test.ts` 追加 5 条 —— 合成模式只出一条 / 不叠加 / 不再 `forEach`；
**喷发仍按 `entries` 各用各的图**且先于读数；页面 `gains.reduce` 求和后只传一条 `readout`；
统一图标常量必须等于 `icons/item/种族经验球_随机` 且实盘在 `main-pages` 里；
合成起点恒等 `40 + 30 = 70` 且**逐条模式仍是 40**。

### 3.7 宝箱图标飞进资源栏 + 资源栏跳动/闪光（2026-10-26 第四张截图）

用户两条并列需求：

> ① 「更换资源栏的图标，资源栏的按钮分别对应 银币 icon 和 体力 icon」
> ② 「宝箱打开的体力或银币 icon 飞到对应的资源栏中，资源栏的 icon 和数字有跳动增加的反馈，资源栏整体闪光」

⚠️ ② 里的「整体闪光」**当天就被收窄成「只有命中的那一格闪」**（用户第六张截图，见下面的「二（续）」）。
本节正文保留原话只为记录需求演进，落地口径以「二（续）」为准。

#### 一、① 改的是一行 prefab 覆盖值，不是代码

HUD 那条货币条是 `common/ResBar` 的**嵌套实例**（`ArenaRoot/TopHud/ResBarLayer/ResBar`），
格数与顺序的唯一真源就是实例上覆盖的 `resKeys`：

| | 改前 | 改后 |
|---|---|---|
| `ArenaRoot.prefab` 的 `resKeys` 覆盖 | `gold,gem` | **`gold,end`** |
| 第 1 格 | `gold` = 银币（`图标_铜币`） | 同左 |
| 第 2 格 | `gem` = 晶石（`图标_灵石`） | **`end` = 体力（`图标_体力`）** |
| 第 3 格 | `render(null)` 整格隐藏 | 同左 |

- `plus`（补货加号）只按 `key === 'end'` 亮 ⇒ 改完只有**体力格**带加号（`MainResBarTypes.buildResBarSlots`）。
  ⚠️ HUD 这两个槽上还覆盖着 `alwaysShowPlus = true`（银币格也有加号），这是 HUD 自己的版面，别动。
- 🔴 `MainResBarTypes.RES_BAR_KEYS`（`gold,gem,end`）**不再代表 HUD** —— 它只服务
  `buildResBarView` 的默认参数（`MainResBar` 算出来的 `slots` 按设计不渲染）。
  别再拿它去比 prefab，两处已经不是一一对应。

##### 一（续）、图标也要跟着换 —— 而且必须「由 keys 驱动」（2026-10-26 第五张截图）

> 「资源栏这两个图标保持大小不变，分别更换成 图标_银币和 图标_体力」

改完 `resKeys` 后现场是：数值已经是体力口径（`59/30`），**两格图标却还是同一枚金币**。

根因不是 `resKeys`，是宿主把两格的图标**写死**了，而且是**两道**：

| 覆盖项 | 归属 | 后果 |
|---|---|---|
| `iconOverride` = `hud_coin_icon`（HUD 专用金色硬币） | `MainResBarSlot` | `render()` 里 `if (this.iconOverride) return;` **直接短路**，表里的图永远不会用 |
| `_spriteFrame` = `hud_coin_icon` | 格子里的 `Icon` Sprite | 即使去掉上一条，异步加载失败/未完成时也还是那枚金币 |

⇒ 两条一起处理：

1. **摘掉 `iconOverride` 覆盖项**（`propertyOverrides` 里那 2 条），让图标回到
   `resKeys → roleProperty.icon → resIconRoot()` 这条唯一出口 —— 以后再改 keys，图标自动跟随。
   ⚠️ 摘除只从 `propertyOverrides` 数组里去掉引用，`CCPropertyOverrideInfo` / `TargetInfo`
   对象留在原地（`__id__` 编号不能动）；它们变成无引用的死数据，编辑器下次保存会自动清掉。
2. **`Icon` 的 `_spriteFrame` 换成表里那两张**（`图标_铜币` / `图标_体力`）：它是**首帧占位图**
   ——异步加载完成前先画对的那张，不会闪一下旧图。

##### 「保持大小不变」是怎么落到 44×44 的

| 图 | 画布 | 可见区 | 可见占比 |
|---|---|---|---|
| 旧 `hud_coin_icon` | 38×37 | 38×37 | **100%** |
| `图标_铜币`（银币） | 100×100 | 86×86 | 86% |
| `图标_体力` | 100×100 | 90×81 | 90% × 81% |

旧图无透明留白，节点 38×37 ⇒ 可见硬币 **≈ 38px**。游戏内图标带留白，若节点仍给 38
可见只剩 **≈ 33~34px**（肉眼小一圈）。所以 `Icon` 的 `_contentSize` 覆盖改成 **44×44**：

- `44 × 0.86 = 37.8` ≈ 38（银币）
- `44 × 0.90 = 39.6` / `44 × 0.81 = 35.6`（体力）

**改尺寸的是节点、不是美术** —— 不要为了"看起来一样大"去重切图。

#### 二、② 的链路：三步，各在一个文件

```
MainTerritoryMap.wireRewardCatch()          页面：resId → 资源栏哪一格（业务口径）
  ├─ ResBar.slotWorldPositionOf(key)        资源栏：那一格的世界坐标
  └─ TerritoryMapView.setRewardCatchWorldPoint(resId, world)  换算成覆盖层局部坐标
        └─ TerritoryChestView.setCatchPointOf(resId, x, y)    每枚图标各自飞向自己的格子
TerritoryChestView.step() → fireLandings(t) 到达时刻 = flyStart + i×stagger + flySeconds
  └─ TerritoryMapView.setRewardLandedHandler → ResBar.playGainFeedback(key, amount)
        ├─ MainResBarSlot.playGainFeedback  图标弹一下 + 数字滚动
        └─ ResBar.flash(slot)               **那一格**闪光（Graphics，无美术资源）
```

| 关注点 | 真源 | 备注 |
|---|---|---|
| `resId → key` | `TerritoryResourceGain.TERRITORY_WALLET_RES_KEY`（`7→gold` / `9→end`） | 与 `roleProperty.json` 的 `key` 列一致，单测逐行比对 |
| 到达时刻 | `territoryChestFlyArriveAt(spec, i, flyCount)` | 不许用「上一帧还在、这一帧没了」反推（逐帧累加会漏最后一枚） |
| 反馈曲线 | `MainResBarFeedback`（`resBarHitFx` / `resBarFlashFx`） | 纯函数，零 `cc`；视图只「取 fx → 写节点」 |
| 闪光区域 | **命中的那一格**的框 + 8px（`ResBar.computeGlowRect(target)`） | 见下面第四节：不许回退成整条，否则银币格会跟着体力格一起亮 |

🔴 **这四步必须都在盘上**：2026-10-26 复查时发现页面侧那一段（`wireRewardCatch`）**整段缺失** ——
视图 API 齐了但零调用，图标只飞默认落点、资源栏从不跳也从不闪，而且**一句错都不报**。
判据已补在 `tests/territory-chest-animation.test.ts`（「页面接线」那条），别再删。

#### 二（续）、闪光只闪**命中的那一格**（2026-10-26 第六张截图）

> 「宝箱打开获取体力资源，只有对应的资源条闪烁，银币资源栏不闪烁」

上一版写的是「资源栏**整体**闪光」（第二节原话就来自用户的第五张截图）。实机表现是：只发体力时，
**银币格跟着一起亮** —— 玩家反而读不出到底涨的是哪个资源。这是"整条闪"的固有缺陷，不是参数问题。

根因在 `ResBar` 的两行：

| 位置 | 改前 | 改后 |
|---|---|---|
| `playGainFeedback` | `this.flash();` | **`this.flash(slot);`** |
| `computeGlowRect()` | 无参，遍历 `hostSlots()` 取**所有显示中格子**的包围盒 | `computeGlowRect(target)`，有 `target` 只算那一格 |

细节：

- `flash(target?)` 保留无参形态（= 整条，老口径）**只作兼容**；本工程唯一的调用点必须传槽位。
- `target` 不可见 / 没有 `UITransform` ⇒ 返回 `null`（**这一帧不闪**），
  🔴 **绝不回退成整条包围盒** —— 那正是本轮要修的病，回退等于白改。
- 闪光只有一层 `Graphics`：连续命中**不同格**时后一次直接改写 `glowRect` + 重启时间轴，
  光「跳」到新格上，而不是两格同时亮（"哪格涨了闪哪格"才是玩家的判据）。
- `playGainFeedback(key, amount)` 增加早退：`amount <= 0` / 非有限数 ⇒ **整段跳过**。
  开箱奖励是配表来的，0 值行存在；不拦会出现「这一格亮了一下、数字一动不动」。
- 曲线本身（`resBarFlashFx` / `RES_BAR_FLASH_SECONDS` / `RES_BAR_FLASH_PEAK_ALPHA`）**一个数都没动**，
  改的只是画框 —— 时长与亮度是手感，作用域是语义，别混在一起调。

判据：`tests/main-resbar.test.ts` 新增 1 条源码契约 —— `playGainFeedback` 必须 `this.flash(slot)`；
全文件不许出现无参 `this.flash()`；`computeGlowRect` 必须按槽位算框且算不出时 `return null`。

#### 三、红线

1. **不许用 tween**（规则 106/247）：`ResBar.update` 是唯一心跳，`MainResBarSlot` 自己**不挂** `update`。
2. **每种资源只通知一次落地**（`landedResIds`）：30 枚图标里同一资源占 15 枚，按枚通知会把数字「击」15 次。
3. **落地通知必须排在停播判断之前**：最后几枚是在收尾段落地的，放到 `stop()` 之后就永远收不到。
4. **数字滚动期间 `render()` 只暂存不直写**（`pendingSlot`）：`CmdRole` 推包正好落在滚动途中时，
   直接重写会表现成「滚到一半跳回新值」。
5. **找资源栏要「从本节点往上逐层问」**，不许从场景根 `getComponentInChildren` ——
   商城 / 天赋页内嵌同一个公共件，从根搜很容易先命中被盖住的那一份（图标飞过去就没了）。
6. 拿不到资源栏（独立预览 / 版面被改）⇒ 保持默认落点 `(0, size.height/2 - 46)`，**发奖不受影响**。
7. **反馈的视觉范围 = 语义范围**：涨的是哪一格就只动哪一格（跳动、数字、闪光三者一致）。
   任何"帮玩家看得更清楚"的整体高亮都是在削弱可读性 —— 玩家是靠"哪格在动"认资源的。

#### 四、判据

- `tests/main-resbar-feedback.test.ts`（11 条）：窗口外 `null`、起手恒等 1、图标峰值 = `1 + 0.34`、
  数字峰值更小、收尾回到 1、`countRatio` 单调、体力后缀 `/上限` 不丢、滚动首尾精确。
- `tests/territory-chest-animation.test.ts`（+4 条）：`flyArriveAt` 相邻差 = 错峰；
  **最后一枚必须早于 `territoryChestEndSeconds`**；脏 index 给 `Infinity`；
  视图里 `fireLandings` 必须排在停播判断之前、`landedResIds` 每场清空。
- `tests/territory-resource-gain.test.ts`（+4 条）：`7→gold` / `9→end`、覆盖面与钱包资源完全一致、
  与 `roleProperty` 表逐行一致、**HUD 的 `resKeys` 必须真的摆着这两格**（改回 `gold,gem` 会让体力无处可落）。
- `tests/main-resbar.test.ts`：`ArenaRoot` 实例的 `resKeys` 断言改成字面量 `gold,end`；
  另加一条「两格图标跟 `resKeys` 走」——**宿主不许再覆盖 `iconOverride`**、
  `Icon` 的占位 `_spriteFrame` 必须逐字等于 `roleProperty` 里 `gold`/`end` 那张图的 uuid、
  `Icon` 尺寸必须 `44×44`。

#### 五（补）、**扣除**也走同一套单格反馈：白色闪烁 → 跳一下 → **然后**才扣 + 上方飘 `-N`（2026-11-02 立项，2026-11-03 改口径）

两版需求原文（都在说同一件事：**扣**的时候先给一拍确认，再动数字）：

| 日期 | 用户原话 | 落地 |
| :--- | :--- | :--- |
| 2026-11-02 | 「当发生资源扣除时，对应资源栏的数字显红，跳动再扣除」 | 数字**显红** + 跳，跳完才扣 |
| 2026-11-03 | 「1. 数字不显示红色，白色闪烁；2. 在资源栏的上方 2px 的位置，播放【-】符号和扣除数字 UI 一起上移消失的提示」 | 红**整条退役** → 数字**白色闪烁**（白度 + 透明度），另加一条 `-N` 飘字 |

**难点全在顺序上，不在画面上**：数值真值来自 `CmdRole`，服务端一推、`reload` 一跑，
label 上就已经是**扣后**的值了 —— 什么都不做的话玩家看到的是「数字直接掉下去、然后才闪一下」，
与需求正好相反。所以这条反馈必须把 label **先钉回扣前值**、演完闪与跳，最后才滚到扣后值。

**为什么"白"要靠透明度做**：资源栏的数字本来就是纯白（`ResBar.prefab` 的 `Value` = `#FFFFFF`），
把字色混向白等于什么都没变 ⇒ 看得见的只有**闪**。所以模型给两个输出：
`whiteStrength`（深色字的宿主才看得见）与 `labelAlpha`（白字靠它闪），视图各写各的。

| 阶段 | 时间 | 数字文本 | 颜色 / 透明度 | 缩放 / 位移 |
| :--- | :--- | :--- | :--- | :--- |
| ① 白闪 + 跳 | `0 ~ 0.34s`（`SPEND_HOLD`） | **一动不动**（还是扣前值） | 白度 0.05s 升到 1；透明度闪 **2 下**（`1 ↔ 0.25`） | 单峰弹跳（图标 +12%、数字 +20%）+ 上跳 6px |
| ② 扣减 | `0.34 ~ 0.90s` | 从扣前滚到扣后 | 回到常态色 + 全不透明 | 已归位，不再动 |
| ③ 飘字 | `0 ~ 0.90s`（整窗） | `-30` | 45% 之后线性淡出 | 起点「槽位上沿 **+2px**」，全程上移 46px（`EaseOutCubic`） |

🔴 **①的「一动不动」是这条需求的机器判据**：`resBarSpendFx(elapsed).countRatio`
在前 `SPEND_HOLD_SECONDS` 内**恒为 0**。把它改成"边闪边扣"这一条立刻红。

🔴 **闪烁必须收在 ① 之内**（`RES_BAR_SPEND_FLASH_SECONDS === RES_BAR_SPEND_HOLD_SECONDS`）：
数字一边滚一边闪，玩家读不出扣到多少。


**为什么不用在花钱的地方一处处调**：扣除的唯一入口是 `ResBar.reload` 里的
`slot.spendDeltaOf(next.amount)` —— 每格自己记着「上次落定的**原始数值**」(`settledValue`)，
新值比它小就是一次扣除。读数文本是换算后的缩写串（`122.3M`），不能反解析，所以比对与滚动
都只认 `amount`，显示时才过 `formatResBarAmountText`。这样**所有**来源（挑战扣体力、商城买东西、GM 改值）自动覆盖，
不需要谁记得调一次（漏一处就少一处反馈，而且零报错）。
`ResBar.playSpendFeedback(key, amount)` 仍然公开，只给「值已落地、但不会再走 `render`」的边角用。

**三个坑**：

1. **顺序**：`spendDeltaOf` / `playSpendFeedback` 必须排在 `slot.render(...)` **之前**
   （`tests/main-resbar-spend` 有源码守卫钉死）。反过来的话 label 已被写成新值，
   动画只能"先扣再闪" —— 而且**看起来仍然有动画**，最容易被当成做对了。
2. **白度必须从这一格自己的常态色混过来**（`resBarSpendFlashColor(base, strength)`），
   不能写死常量白：收尾要混回原值。透明度同理必须在 `finishSpend` / `cancelSpend` /
   `render(null)` 三处都复原点（漏一处，资源栏就会留一格半透明数字）。
3. **飘字是懒建的**（`ensureSpendFloat`，第一次扣才 `new Node` + `addComponent(Label)`）：
   它是纯反馈件、没有美术资产、也没有交互，排版必须和 `Value` **完全一致** ——
   复制 `valueLabel` 的字体/字号，比在 prefab 里手抄三份再靠人肉对版本可靠。
   锚点 `(0.5, 0)` + 起点 `槽位半高 + RES_BAR_SPEND_FLOAT_GAP(2)`；
   白色描边（`LabelOutline` 2px）是因为它悬在地图上，白字直接压在浅色地格会糊。

**判据**：`tests/main-resbar-spend.test.ts`（16 条）——
曲线口径（窗口外 `null`、前 `HOLD` 段 `countRatio` 恒 0、弹跳单峰、白度升→保持→淡回、
透明度闪 2 下且起止为 1、混色 `strength=0` 逐位等于原色、飘字单调上移 + 45% 后淡出 +
`-N` 文本不带千分位）+ **真代码沙箱**（`cc` 打桩跑 `MainResBarSlot`）：
第一帧不许掉数字、定格段数字不变但已在闪在跳、飘字压在「上沿 + 2px」且与数字同列、
收尾精确落在扣后值且颜色/透明度/位移/缩放/飘字全复原、反馈途中来推包只暂存、
整格隐藏要复原、加/扣两条时间轴互斥；外加两条源码契约
（`reload` 里「判扣除」先于 `render`；单格不许自己挂 `update`、不许用 tween）。

### 3.8 建筑体量倍率 `buildSize`（表「模型大小」，**可以是小数**）（2026-10-27）

#### 一、链路：改一处表，四棵棕榈树就跟着变

```text
doc/塔防数据配置/PVP-建筑.xlsx（「装饰建筑」表 D 列「模型大小」）
  → doc/塔防数据配置/json/client/build.json        （策划转表产物）
  → assets/remoteRef/build.json                    （ref_compress_json.py 压缩成 k/v/c）
  → TerritoryPageAssets.buildScales                （Number(row.buildSize)，≤0 或非数 → 1）
  → TerritoryMapView.buildScaleOf → TerritoryStationView.iconSizeScale
  → scale = (BUILDING_VISIBLE_WIDTH / 可见宽) × iconSizeScale
```

- **纯客户端字段**：`json/sever/build.json` 里**没有** `buildSize`（只有 `buildId` / `buildresource`），改体量不用动服务端表。
- **类型行要跟着改**：xlsx 第 6 行是类型声明行，写小数时 D 列必须写 **`float`**，否则转表工具按 `int` 读会把 `0.8` 抹成 `0`（然后被 `rawSize > 0 ? ... : 1` 兜回 1，表现为「改了表但没变化，零报错」）。
- **它是乘在归一系数之上，不是替换**：`buildSize = 1` 时与旧行为逐像素一致；>1 变大、<1 变小。替换会让同屏建筑忽大忽小，见 `tests/territory-cell-center-align.test.ts` 第四层。

#### 二、改体量**不会**破坏居中对齐（判据的数学依据）

缩放是围绕 `Icon` 节点锚点（= 节点中心）等比进行的，而 trim 补偿量与缩放同源：

```ts
const scale  = (BUILDING_VISIBLE_WIDTH / visibleWidth) * this.iconSizeScale;
const shiftX = frame.offset.x * canvasScaleX * scale;   // ← scale 里已经含 iconSizeScale
const shiftY = frame.offset.y * canvasScaleY * scale;
node.setPosition(mapX - shiftX, mapY - shiftY, mapZ);
```

缩放后「可见区中心偏离画布中心」= `offset × canvasScale × scale`，补偿量**正是同一个式子** ⇒ 残差恒为 **0**，与 `buildSize` 取什么值无关。落点本身由 `cellCenter`（`+ HEX_GRID_CONTENT_LIFT = 12.5`）抬到 2.5D 台面中心，也不受体量影响。

> 所以「缩小 + 对齐中心」这两件事里，**对齐是本来就成立的**，不需要额外改代码；要动的只有表里的倍率。

#### 三、2026-10-27：69010~69013 四棵棕榈树 `1 → 0.8`

`PVP-建筑.xlsx`「装饰建筑」表 69010~69013 = 装饰棕榈树 1~4（`territory_decor_03_v1 … 06_v1`）。
按「归一宽 84 × buildSize」复算的实际渲染尺寸（台面 123×90）：

| buildId | 素材 | buildSize | 实际可见 宽×高 | 高/台面 |
| :-- | :-- | :-- | :-- | :-- |
| 69010 | `territory_decor_03_v1` | 1 → **0.8** | 84×90.1 → **67.2×72.1** | 80.1% |
| 69011 | `territory_decor_04_v1` | 1 → **0.8** | 84×101.0 → **67.2×80.8** | 89.8% |
| 69012 | `territory_decor_05_v1` | 1 → **0.8** | 84×117.7 → **67.2×94.2** | 104.6% |
| 69013 | `territory_decor_06_v1` | 1 → **0.8** | 84×122.9 → **67.2×98.3** | 109.3% |

⚠️ 69012 / 69013 缩到 0.8 后**可见高仍大于台面高 90**（= 截图上「树顶出格子」那两张）。要压进台面还需要再降一档
（`0.7` ⇒ 82.4 / 86.0；`0.65` ⇒ 76.5 / 79.9），属美术口味，未擅自改。
同类还有 `territory_decor_12_v1`（69019，92.5，未动）。

### 3.9 装饰建筑「底部对齐格子中心点」（只留 69010~69013，2026-10-27 两轮收敛）

#### 一、现象与真因

截图读作「树没居中、浮在格子上」，**不是锚点坏了、也不是代码没对齐**：

1. `.meta` 的 `rect / offsetX / offsetY` 与 PNG 实测 alpha bbox **逐项一致**（12 张全过）；
2. `applyIconPlacement` 把**透明包围盒（trim）中心**压到格心，残差恒 **0**（`tests/territory-cell-center-align.test.ts` 第二层钉住）。

真因是**像素重心 ≠ 包围盒中心**：物体越高，"站在地上"的构图让重心越偏底部。换算到地图像素
（已乘 `buildSize`）后纵向偏差：`decor_03` **−14.6**、`decor_05` **+13.4**、`decor_04` **−6.4**，
而树桩 / 石块类只有 −1.6 ~ −2.3 —— 正好解释「树歪、树桩正」。

#### 二、口径：可见**底边**压格心

```ts
const visibleHeight = trimmed.height * canvasScaleY;          // 归一前的可见高
const anchorLiftY  = this.bottomAnchored
    ? visibleHeight * scale * 0.5 - TERRITORY_BOTTOM_ANCHOR_DROP_PX   // 18px = 4px 影子 + 10px + 4px
    : 0;
node.setPosition(mapX - shiftX, mapY - shiftY + anchorLiftY, mapZ);
```

推导：可见中心原本被摆在格心 ⇒ 可见底边在「格心 − 可见高/2」；要让**底边 = 格心**，节点须再上抬「可见高/2」（缩放后）。

再减 `TERRITORY_BOTTOM_ANCHOR_DROP_PX = 18`，**三笔叠加**（都是往下）：

| 来源 | 数值 | 理由 |
| :-- | :-- | :-- |
| 2026-10-27 逐图验收 | 4px | 树干底下还有一圈**落地影子**，影子算进包围盒 ⇒ 严格按"可见底边"对齐时本体被抬起约 4px |
| 2026-11-12 用户 | **+10px** | 「装饰节点是树这一类的 建筑id 69010~69013 统一往下挪动10px」 |
| 2026-11-12 用户追加 | **+4px** | 「还可以再往下挪4个像素」 |

⚠️ 三笔都是**地图像素**，不乘 `buildSize` / `scale`（位置写在父节点空间，与 `Icon` 缩放无关）。
⚠️ 只改 `TERRITORY_BOTTOM_ANCHOR_DROP_PX` **这一个数**：`applyIconPlacement`（实心建筑 + 虚影）
与 `applyLevelBubblePosition`（气泡抬升）同源，站点 / 随机格 / 虚影三条渲染路径同时生效，别在调用方各加一份。

| 要点 | 口径 |
| :-- | :-- |
| 抬升量 | `可见高(trim × canvasScaleY) × scale ÷ 2 − 18`（4px 影子 + 10px + 4px），前一项**含 `buildSize`**、后一项不含 |
| 影响面 | 只改**纵向落点**，横向与缩放完全不动（`tests/territory-bottom-anchor.test.ts` 逐项钉住） |
| 白名单 | `TERRITORY_BOTTOM_ANCHOR_BUILD_IDS = 69010…69013`（**四棵棕榈树**），判定函数 `territoryUsesBottomAnchor()` |
| 传参 | `ITerritoryStationRender.bottomAnchor?`，由 `TerritoryMapView` 两条路各传一次：站点 `Number(site.buildingId)`、随机格 `Number.isFinite(buildingId) && …` |
| 写入时机 | `render()` 里必须在 **`applyIconPlacement()` 之前**写 `this.bottomAnchored`（站点节点池化复用，晚写就用上一格的口径） |

#### 二-补、2026-11-12 增补：四棵树两轮共再往下 14px

> 需求原文：①「装饰节点是树这一类的 建筑id 69010~69013 统一往下挪动10px」（附截图，红框圈出地图上的树）；
> ② 同日追加「还可以再往下挪4个像素」。

两轮都按**增量**执行：保留 10-27 的 4px 落地影子补偿，`4 → 14 → 18`。范围是
`territoryUsesBottomAnchor()` 白名单内的四棵棕榈树（**没有**扩大到屋子 / 哨站 / 树桩），
也没改缩放、横向落点、trim 补偿。
同步改了三处真源：`TerritoryStationView.ts` 常量、`tests/territory-bottom-anchor.test.ts`
全部抬升量数值、`tools/preview_decor_alignment.py` 的 `BOTTOM_ANCHOR_DROP`（逐图对位图脚本必须与线上同值）。
⚠️ 若后续口径是「总偏移改成 N px」而不是「再往下 N px」，只需把这一个常量改成 N 并同步这两处。

#### 三、🔴 不要走「让美术把内容往下平移」这条路

`trim` 会自动裁到 alpha bbox，内容平移后 bbox 跟着走，代码照 bbox 中心对齐 ⇒ **屏幕上一个像素都不变**。
视觉重心的偏差只能靠**落点口径**（本节）或**改构图本身**（让 bbox 中心与重心重合）解决。

#### 四、第二轮的取舍：谁留、谁退回居中

用户按**逐图对位图**验收；对位图由 `python tools/preview_decor_alignment.py rules` 生成，输出不入库：

| buildId | 素材 | buildSize | 验收 | 现在 |
| :-- | :-- | :-- | :-- | :-- |
| 69008 | `decor_01` 宝箱屋 | 1.0 | ✗ | **居中**（底边对齐把本体抬太高） |
| 69009 | `decor_02` 圆顶哨站 | 1.0 | ✗ | **居中** |
| 69010 | `decor_03` 棕榈 1 | 0.8 | ✓ | 底部对齐 −18px |
| 69011 | `decor_04` 棕榈 2 | 0.8 | ✓ | 底部对齐 −18px |
| 69012 | `decor_05` 棕榈 3 | 0.8 | ✓ | 底部对齐 −18px |
| 69013 | `decor_06` 棕榈 4 | 0.8 | ✓ | 底部对齐 −18px |
| 69014 | `decor_07` 树桩 | 1.0 | ✗ | **居中**（扁平对称，本身重心就在中间） |
| 69015 | `decor_08` 树桩+草 | 1.0 | ✗ | **居中** |

规律：**只有"高、细、明显站在地上"的棕榈树需要底边对齐**；屋子/哨站/树桩的重心本来就靠中间，
底边对齐反而把它们整体抬高。`decor_09…12`（草丛 / 树桩花 / 宝箱）一直是居中口径。

#### 五、判据

`tests/territory-bottom-anchor.test.ts`（12 条，真实模块 + 真实 VM 渲染）：

- 白名单恰好 `[69010, 69011, 69012, 69013]`；`69008 / 69009 / 69014 / 69015 / 69007 / 69016 / 0 / −1 / 69010.5 / NaN / ±Infinity` 一律 `false`；
- 抬升量 = 7.2（可见高 60、scale 0.84、−18）、随可见高变（40 → −1.2，**负抬升**）、随 `buildSize` 变（0.8 → 2.16，
  **−18 不缩**）、与 `trim` 偏移互不干扰；2026-11-12 增补一条「相对旧 4px 落点共再往下 14px」的增量守卫；
- 池化复用：先 `bottomAnchor: true` 再 `false`，抬升必须被完整清掉，且缺省与显式 `false` 逐像素等价；
- 接线：`bottomAnchored` 的赋值早于 `applyIconPlacement()`；`TerritoryMapView` 两条路都传且渲染层**不许出现 id 字面量**。

### 3.10 地图拖拽**上下**限：地块边缘停在个人信息框下方 15px（2026-10-27 三轮 + 2026-11-05 修复）

#### 一、用户口径

> 第一轮：「最底部的地块可以被拖动到 UI 框的下方，间距约 15px」
> 第二轮：「**顶部**的格子还是无法拖动到个人信息框的下方」
> 第三轮：「当前顶部留白已经实现，但是仍然需要可以下拉多大约 **60px**」
> 第四轮（2026-11-05，配图黄线）：「当前最上沿的地块能往下拖动的极限位置不够下，还是会被 UI 遮挡，
> 应该能拖到黄线位置才不会被遮挡」

⇒ 滚到**下**极限时，地图**底边**停在「顶部 HUD 框底边 + 15px」；
   滚到**上**极限时，第一排地块的**可见顶边**停在「HUD 底边 + 15 + 60」。
（HUD 框 = 指挥官栏 + 好友/邮件/排行榜/邀请那一块，即 `ArenaRoot/TopHud`。）

| 边 | 看什么 | 公式（`hudBottom` = HUD 底边到视口顶部的距离） |
| :-- | :-- | :-- |
| 底部 | 地图包围盒底边 | `视口高 − hudBottom − 15` |
| 顶部 | 第一排的**可见顶边** | `hudBottom + 15 + 半个格面高(45) + 呼吸量(60)` |

🔴 **第四轮不是公式问题，是量错了基准**（`2026-11-05`）：
三个常数一个都没少，但 `hudBottom` 一直量成 **0** —— `MainTerritoryMap.findTopHud()` 只查了
`this.node.parent`，而地图页的层级是 `ArenaRoot / MapRoot / MainTerritoryMap`
（`MapRoot` 是那个嵌套 prefab 实例的宿主层），`TopHud` 挂在 `ArenaRoot` 上 ⇒ 隔了一层就永远找不到。
后果：`padTop` 只剩 `15 + 45 + 60 = 120`，第一排可见顶边停在离屏幕顶 **75**，正好钻进 146 高的
`TopHud` 后面 —— 玩家的体感就是"拖到头了还在 UI 底下"。

修法：新增 `hostPageRoot()`（往上最多 4 层、逐层 `getChildByName`），顶部 / 底部两条基准线
都从它起步（`MainTaskEntry` 在 `BottomHud` 里、`BeginGame` / `ChestBar` 在 `ArenaRoot` 上，
**没有一个是 `MapRoot` 的后代**）。底部那侧之前没暴露，是因为量不到会退到兜底 300，真实 305，差 5px 看不出来。

> 教训：**"量不到"必须当成 bug，不能当合法退化**。顶部退化成 0 = 第一排被 HUD 挡住，
> 底部退化成 300 ≈ 真实值 —— 同一个错误在两个方向上一个是响的、一个是哑的，
> 所以判据里要钉"起点必须往上走"，而不是只钉常数。


⚠️ 顶部那两截**必须分开表达**，别合并成 `+105`：

| 常量 | 值 | 性质 | 变不变 |
| :-- | :-- | :-- | :-- |
| `TERRITORY_MAP_TOP_FACE_RISE` | `HEX_GRID_FACE_HEIGHT / 2` = 45 | **几何**：格面以格心为中心，图上探半格 | 改行高就得跟着变 |
| `TERRITORY_MAP_TOP_BREATH` | 60 | **手感**：完整露出来之后还能再拖多远 | 跟几何无关，随时可调 |

只加 15 ⇒ 格心在下巴下面 15px、第一排的**上半张脸**仍压在面板后（第二轮报的）；
加够 45 但不再留 ⇒ 第一排刚好贴着面板口，读起来还是"没拖完"（第三轮报的）。

#### 二、机制：留白就是硬上限，不是"回弹前的临时越界"

拖拽归 `cc.ScrollView`，它只按「内容层高 − 视口高」钳范围；`MainTerritoryMap.prefab` 里
`elastic = **false**` ⇒ **拖不过去，松手也不回弹**。所以上限完全由内容层底部留白一个数决定：

```text
滚到最底 ⇒ 内容层底边贴视口底边 ⇒ 地图底边在视口底部上方 pad
         ⇒ 地图底边距视口顶部 = 视口高 − pad
要让这条边落在 hudBottom + GAP：
  pad = 视口高 − hudBottom − GAP          （GAP = TERRITORY_MAP_HUD_GAP = 15）
```

顶部同理，只是看的是**可见顶边**：

```text
滚到最顶 ⇒ 内容层顶边贴视口顶边 ⇒ 地图包围盒顶边距视口顶部 = padTop
可见顶边 = padTop − FACE_RISE        （FACE_RISE = HEX_GRID_FACE_HEIGHT / 2 = 45）
要让它在 hudBottom + GAP + BREATH：
  padTop = hudBottom + GAP + FACE_RISE + BREATH    （BREATH = 60）
```

两个式子一起实现为 `territoryMapContentPaddingBottom(viewportHeight, hudBottom)` /
`territoryMapContentPaddingTop(hudBottom)`，都夹在 `[0, ∞)`。

⚠️ 两边**不对称是故意的**：底部看的是「地图包围盒底边」（格心），而地块侧壁在格心**下方** 71px，
格心停在 `hudBottom + 15` 时整块地块自然已经在面板下方；顶部相反，可见部分在格心**上方**。

#### 三、链路

```text
ArenaRoot/TopHud（四边 Widget，顶对齐 16）+ 长屏适配 MainHudLayout
  → MainTerritoryMap.hostPageRoot()        （往上最多 4 层，找挂着 TopHud 的那一层）
  → MainTerritoryMap.findTopHud()          （从宿主页根按名字找；**不能**用 this.node.parent）
  → topHudBottom()：两个 getBoundingBoxToWorld() 相减 = HUD 底边到视口顶部的距离
  → territoryMapContentPaddingBottom(viewport.height, hudBottom) / territoryMapContentPaddingTop(hudBottom)
  → TerritoryMapView.setContentPaddingBottom(pad) / setContentPaddingTop(padTop)
  → 三处消费（必须同源）：
       syncContentSize / syncBackground → territoryMapContentSize(layout, pad, padTop)
       applyContentShift              → territoryMapContentShiftY(pad, padTop) = (pad − padTop) / 2
       MainTerritoryMap.scrollToCell  → territoryMapOffsetForCell(..., { paddingBottom, paddingTop })
```

⚠️ **起点是 `hostPageRoot()`，不是 `this.node.parent`**：层级 `ArenaRoot / MapRoot / MainTerritoryMap`
⇒ 父节点是 `MapRoot`，`TopHud` 不在它下面（2026-11-05 的病根，见上）。
⚠️ **量世界包围盒，不抄 prefab 数字**：TopHud 挂 Widget + 长屏适配（`MainHudLayout` 按安全区改
`top`）⇒ 底边随屏幕比例变，抄死数值在长屏上会差几十像素。
⚠️ **`canvas-resize` 回调要延一帧**再量：`MainHudLayout` 也在同一事件里排 TopHud 的 Widget，
两个组件顺序不保证，同帧量到的可能还是旧底边。
⚠️ 改留白只能走 setter：偏移是 `(bottom − top)/2`，直接赋字段会让内容层错位。
⚠️ **两份留白必须一起传**：只传底部 ⇒ 内容层高与偏移各少一截，滚到顶时第一排地块又钻回面板后面。

#### 四、标准 720×1280 屏的实算

| 量 | 值 |
| :-- | :-- |
| `MapViewport` | 720 × **1112**（四边 Widget，bottom = 168） |
| `TopHud` 底边到视口顶部 `hudBottom` | 16 + 130 = **146** |
| 底部留白 `pad` | 挂件咬入 305 + 50 = **355**（2026-10-28 前是 `视口高 − hudBottom − 15` = 951） |
| 顶部留白 `padTop` | 146 + 15 + 45 + 60 = **266**（2026-11-05 之前实际恒为 **120** —— `hudBottom` 量成 0） |
| 内容层高（18 行图，1694） | 1694 + 355 + 266 = **2315** |
| 内容层偏移 `shift` | (355 − 266) / 2 = **44.5** |
| 拖到最底时地图底边距屏幕顶部 | **757**（= 视口高 1112 − pad 355；底排停在挂件上沿上方 50） |
| 拖到最顶时第一排**可见顶边**距屏幕顶部 | **221**（= 146 + 15 + 60） |
| 拖到最顶时格心距屏幕顶部 | 266（可见顶边再减 45） |

> 副作用（可接受但记一笔）：内容层变高 ⇒ 底图 cover 系数变大（横向裁剪更多）、
> 云填充面积同步变大（两侧各多半份留白）。滚到最底时地图下方那一大片是**底图 + 云**，不是白底；
> 滚到最顶时面板下方会露出约 120px 的云（`266 − 146`），读作"还没探索的边境"，不是裸底图。

#### 五、判据

`tests/territory-map-bottom-inset.test.ts`（18 条）：

- 两条反算公式与边界（HUD 高过视口 / 非有限值 / 负数一律夹到合法值）；
- **两条不变量**：滚到最底地图底边 = `hudBottom + 15`；滚到最顶第一排**可见顶边**
  = `hudBottom + 15 + 60`（并反证"只加 15 不加 45"会落进面板里、并钉死 45 与 60 是两个常量）；
- 两份留白一起决定 `内容层高` 与 `偏移 = (bottom − top)/2`，缺省仍是 `300 / 0`；
- 顶部留白真的撑大了可滚上限（`scrollToOffset` 不被钳在半路）；
- 视图 `contentPaddingTop` 字段 + `setContentPaddingTop` setter 都同步重写偏移；
- 页面从宿主页找 TopHud 量包围盒、**两份留白用同一个 `hudBottom` 反算**、注入早于 `initialize`、
  `scrollToCell` 两份都传；
- **找基准线的起点必须往上走**（`hostPageRoot`）：顶部与底部两个测量都从它起步，并反证
  "`this.node.parent.getChildByName('TopHud')`" 不许回来 —— 2026-11-05 第一排钻到 HUD 后面的病根。

### 3.11 云层散场：判据用「已激活」，收工先演镜头，雾逐朵退场（2026-10-27）

#### 一、两条判据**故意不同源**

| 判据 | 管什么 | 用什么 |
| :-- | :-- | :-- |
| 逐格 | 这一格的云要不要**散** | `revealed`（`territoryRevealedCells`；格子一露就让开） |
| 整片 | 铺满层（背景那层雾）什么时候**收工** | **已激活**（打通才算） |

`revealed` 里有一类是"看得见、还没开"的格（已占领格**前沿**的随机候选格 + 前置满足的站点）。
拿它当收工判据 ⇒ 玩家还有一格没激活，雾就散了。激活口径：

```text
激活 = progress.isCellUnlocked(cellId)     // 服务端允许点
    || progress.isOwned(cellId)            // 已占领
    || progress.isAreaPassed(cellId)       // 同 configId 已通关
```

三条都是服务端确认过的状态 ⇒ 判据**不会死锁**。
⚠️ 别拿 `isCellPassed` 当唯一判据：宝箱要"领完"、`bonus` 根本不走 `isAreaPassed`
（`areaPeers` 只认 stage/boss/asyncPvp），卡在最后那一格就永远收不了官。

#### 二、收工演出：拉远 → 看雾散 → 拉回

| 段 | 时长 | 常量 |
| :-- | :-- | :-- |
| 拉远（抬到整张图入画，`easeOut`） | 1.1s | `TERRITORY_CLOUD_DOLLY_OUT_SECONDS` |
| 淡出（在拉远视角里慢慢淡，**逐朵错峰**） | **2s** | `TERRITORY_CLOUD_DOLLY_FADE_SECONDS` |
| 拉回（`1 - easeOut` 对称落回） | 0.7s | `TERRITORY_CLOUD_DOLLY_IN_SECONDS` |

总时长 `territoryCloudDollyTotalSeconds()` = **3.8s**（别写死，跟着三段走）。

- 淡出时长**单独一份**，不复用 `TERRITORY_CLOUD_FILL_FADE_SECONDS`（0.5s）：那个是"没人看"时的
  默认值，且刻意与最后一朵云的消散同长；进了演出必须放慢，否则读不出"逐渐消失"。
- 起淡时机 = **拉远到位那一刻**（`territoryCloudDollyFadeDue`），起早了玩家还没看清全图。
- 入画倍率 `territoryCloudDollyFitScale(mapW, mapH, vw, vh)`：≤ 1 **只缩不放**，余量 0.94，
  分母是「包围盒 + 一整格」（包围盒量的是格心，最外圈地块的图还往外探半格）。
- 时钟只放**一只**（`TerritoryCloudView.dollyElapsed`）：地图视图每帧读 `dollyZoom` / `dollyScale`
  去推 `MapLayer`，两边各持一只表必然漂。
- 镜头**复用宝箱那套基准**：`applyChestCamera(1 + (fit - 1) * zoom, zoom)`，对焦点 = 地图包围盒中心。
  `f: 0→1` 把地图中心挪到屏幕正中，`k: 1→fit` 缩到入画，`(0, 1)` 正好是恒等 ⇒ 首末两帧都精确回原位。
- 收尾只留一条：`cameraBusy = 开箱在播 || 散场在播`，为真时既不还原镜头也不解锁输入。
- 退化：`fitScale >= 1`（图本来就比视口小）/ 页面没注入视口 ⇒ 不演镜头，走 0.5s 淡出；
  取不到覆盖层 ⇒ 只演雾散、镜头不动。**换章 / 回退 ⇒ 演出立刻收，雾立刻复原**（回退不带动画）。

#### 二之二、雾**逐朵**退场：靠近地块的先散，越远越慢（2026-10-27 同日第二次）

需求：「从靠近地块的云雾先消失，离地块远的消失的慢，形成一个消失扩散的视觉效果」。

老口径是整层一个 `UIOpacity` ⇒ 几百朵雾同一帧起淡、同一帧淡完，读成"整层灰整体变薄"。
现在每朵按自己的**波次**（`0` = 贴着地块、`1` = 最远）各拿一条窗口：

```text
distance → 波次    territoryCloudFillWaveOrder(distance, maxDistance)     // 0~1，脏参数一律 0
波次     → 窗口    territoryCloudFillWaveWindow(order, total)             // { delay, duration }
已用时   → 透明度  territoryCloudFillWaveOpacity(seconds, order, total)    // 复用 easeOut
```

| 量 | 公式 | 近端 | 远端 |
| :-- | :-- | :-- | :-- |
| `delay` | 波次 × `STAGGER`(0.25) × 总时长 | 0 | 0.25T |
| `duration` | 总时长 − delay − `SPREAD`(0.45) × 总时长 × (1 − 波次) | 0.55T | 0.75T |
| 淡完 | delay + duration | 0.55T | **1.00T** |

三条硬约束：

1. **"起得早"和"淡得更快"必须同时有**：只错开起淡时间，观感是"整片雾匀速变薄、只是先后不同"，
   远的那圈并不比近的慢。
2. **右端不许超过整条时长**（远端正好等于它）：铺满层是"整条走完"才 `active = false` 的，
   只要有一朵没淡完就被收起来，那朵就是"啪"一下没。
3. `STAGGER` **必须小于** `SPREAD`：否则窗长随距离**变短**，远的反而先没（单测钉了这条单调性）。

实现要点：

- 波次在**起淡那一刻**编一次（`prepareFillWave`；全解锁时地块位置已是终态），
  逐帧只做一次除法 —— 每帧拿几百朵 × 几百格求最近距离是白烧 CPU；
- 逐朵透明度走 `Sprite.color.a`（`writeOpacity`），**不挂 `UIOpacity`**：几百个组件会让节点
  退出静态合批。影子在另一个节点里，用**同一个读数**一起写；
- 编不出波（没有地块坐标 / 节点数与波次不齐）⇒ 整层退回"一条曲线"的老口径，
  宁可没有扩散感，也不要让某一朵停在半透明上。

#### 三、判据

`tests/territory-cloud.test.ts`（51 条）：三段时长与总时长、拉远曲线的形状与单调性、起淡时机、
入画倍率的独立复算与"只缩不放"与四个脏入参、视图里"拉远未到位雾不淡 / 起淡即 2s / 3.8s 收工回 0"、
**前沿格不算激活（等 5 秒也不散）**、无余量不演镜头、回退与换章立刻收、演出中不接受新倍率、
波次归一化与脏参数、波窗口的单调性与右端不越界（`STAGGER < SPREAD`）、
波透明度"同一时刻近 < 中 < 远、整条走完全 0"、视图层逐朵错峰（近的比远的先散、最远的仍 255、
收工全 0、影子同读数）、**换章那一帧 `reset()` 之后铺满层必须当场重建**，
以及接线（探针参数、`stepCloudDolly` 排在 `clouds.step` 之后、页面注入视口）。

#### 四、🔴 换章那一帧：铺满层被清空、且当场没人补（2026-11-06）

用户原话：「章节 chapter02 地图未通关，用来遮挡背景的云层丢失了」。截图里左上角还留着几朵
真实云、格子簇也在，但**整片沙漠底图裸露**，零报错。

根因不是云没建，而是**建了又被扔、扔了没人补**。`renderMap` 的三步顺序把 `reset()` 夹在两次
"喂尺寸"之间：

| 步 | 谁 | 干了什么 |
| :-- | :-- | :-- |
| ① | `syncContentSize` → `setFillArea(新章尺寸)` | 指纹变了 ⇒ 用**上一章**的已盖格白建一整套 |
| ② | `syncGrid` → `clouds.reset()` | 铺满层清空、`fillKey = ''`、`fillPoints = []` |
| ③ | `syncClouds` → `setFillOccupied(新章的格)` | 老判据 `if (!this.fillKey) return;` ⇒ **一朵都不重建** |

终态：`fillLayer.active` 还是 ① 留下的 `true`、`fillSprites` 是 0 —— **"开着但空着"**，
`fillVisible` 读出来还是 `true`，日志也干净，谁去查都以为雾在。

为什么 chapter_01 看着没事：它通常是**首屏**，进图前后有多次 `StateChange`（资源就绪 / 首帧
就绪），下一次 `renderAll` 的 `setFillArea` 把雾补回来了。换章只发一次渲染 ⇒ 停在原地就是永久裸底图。

修法（判据换源，语义不动）：

```text
老：if (!this.fillKey) return;          // fillKey 是"那批节点还在不在"的指纹
新：if (!this.fillAreaReady) return;    // 只问"尺寸知不知道"（行列 / 宽高还在，reset 也没撤）
```

`fillAreaReady` 由 `setFillArea` 置位、**`clearFill()` 不撤**（尺寸这件事换章后又没变），
于是 ③ 那一帧就能用现成的尺寸当场重建。守卫的另一半照旧：从没 `setFillArea` 过 ⇒ 只记账、
不建节点（建了也是铺在 0×0 上）。

教训：「指纹」和「事实」是两种东西 —— 拿指纹去表达"我知不知道尺寸"，一旦某个流程在两次
写入之间做了清空，就会把唯一一次补救挡掉，而且**不报错、状态还读着正常**。

> 过程与"为什么不是这样"的长版见 `docs/章节地图动画与点击反馈实现说明.md` §8.14~§8.16。

### 3.12 未解锁的关卡格：解锁那一次**直开**，之后仍弹窗（2026-10-29 更新）

#### 一、用户口径（两轮，后一轮覆盖前一轮的第二步）

2026-10-28：

> 「当关卡地块未解锁时（显示银币和数字 ui 时），点击地块消耗银币，播放地块切换成关卡地块的
>  动画（与其他新生成的地块动画一致），**不要**直接改成点击银币弹出【领地关卡弹窗】」

2026-10-29：

> 「章节地图，首次解锁关卡，立即发送请求给服务器开战，不用弹窗」
> 追加确认口径：**「只有解锁那一次直开、之后仍弹窗」**。

背景：2026-10-27 为了做「关卡界面」（目标 / 奖励 / 感叹号），把关卡格改成**点一次就弹窗**；
2026-10-28 改成「点一下只解锁」，于是玩家要**点两次**才进得去第一场战斗（解锁一次、开界面再点一次）。
2026-10-29 收口成：**解锁那一下直接进战斗**，解锁之后回到「弹窗 → 点开始战斗」的老路。

#### 二、口径：按解锁状态 + 站点类型分三段

| 这一格 | 入口 | 结果 |
| :-- | :-- | :-- |
| **未解锁** + 绑得到关卡（`stage` / `boss` / **`asyncPvp`**） | `handleUnlockThenBattle` | 校验前置 / 银币 / 体力 → `unlockCell` → **回包 `ok` 后立刻进战斗**（`mode = match` 时请求交匹配页）→ 界面不弹 |
| **未解锁** + 绑不到 campaign 行 | `handleUnlockOnly` | 只解锁 + 「已解锁，点击查看关卡」提示 |
| **已解锁 / 区域已通关** | 打开对应详情 | `asyncPvp` 弹 `BigMapPlayerLevelPanel`（侦查 / 占领奖励 / 双按钮），其余弹关卡界面；窗里「开始战斗」→ `requestBattle` |

🔴 **2026-11-11 口径**：用户「触发异步据点也是直接进入战斗」，把 `asyncPvp` 并进直开名单。
被跳过的**只是「花银币解锁那一次」的弹窗** —— 已解锁 / 已通关的异步据点照旧弹侦查面板，
侦查、占领奖励、费用角标一个都没删（详见 §3.39）。

判据两段（`selectSite`）：

- 进不进锁态分支：`!progress.isCellUnlocked(cellId) && !progress.isAreaPassed(cellId)`。
  `isAreaPassed` 必须有：同 `configId` 的格子共享通关状态，只判 `isCellUnlocked` 会让
  "区域已通关、本格没单独解锁"的格子反复走解锁请求。
- 直不直开：`stageByCell.get(cellId)` 有值 **且** `isAutoStartSite(site)`。
  🔴 2026-11-11 起这份名单 = `isBattleSite(site)` = `stage` / `boss` / **`asyncPvp`**；
  旧的 `isLevelSite`（只含主线两型）已彻底退役，源码守卫会红线挡住它回来。
  ⚠️ `isAutoStartSite` 与 `isBattleSite` 眼下同集合但**语义不同**：前者管「要不要跳过弹窗」，
  后者管「能不能发开战请求」；以后某型要留弹窗时只改前者。
  🔴 **不要**再按 `isOwned` / 是否打过二次分流 —— 「未通关」不是「该直开」的条件，
  否则玩家退出战斗后再点它又是直开、永远看不到关卡界面。

**开关**：`gameConfig.chapterLevelAutoStartConfig`（策划表 `S-数据配置` 原话：
「章节地图【首次】激活关卡地块，自动进入战斗（1开 0关」）。

| 值 | 行为 |
| :-- | :-- |
| `1`（表里当前值） | 锁着的战斗站点点一下 = 解锁 + 立刻开战 |
| `0` | **完整退回**改之前的两步：只解锁 + 「已解锁，点击查看关卡」，界面不弹、不发开战 |

读表口径 `readTerritoryLevelAutoStart`：**`0` 是唯一表示「关」的值**；缺行 / `''` / `'  '` / `null`
一律退回缺省 `TERRITORY_LEVEL_AUTO_START_FALLBACK = true`。
🔴 缺省必须取**开**：取关会让「配置没同步」表现成功能静默失效（点了只解锁、零报错）；
🔴 别直接 `Number(raw)` —— `Number('')` 是 `0`，表里多一个空格就把功能静默关掉。
环节：`loadTerritoryCampaign`（读表）→ `TerritoryChapterLoader`（搬进 bundle）→
`ITerritoryChapterContext.levelAutoStart` → `selectSite` 那一处判据。

#### 三、动画：为什么要单开一份「已解锁」快照

视图的生成动画（`hexSpawn`）原本只认 **`revealed` 的 diff**。这不够用：

```text
revealed = owned ∪ unlocked ∪ 前置满足的站点 ∪ **前沿可见的随机候选格**
```

关卡格从「锁着（银币 + 数字）」变「已解锁（关卡建筑）」时，它**前后都在 `revealed` 里**
⇒ diff 恒为 0 ⇒ 外观直接换、没有过渡，读作"点了一下什么都没发生"。

所以 `TerritoryMapView.syncHexSpawn` 现在有**两条触发**，合到一个去重集合里：

| 来源 | 判据 |
| :-- | :-- |
| 新露出 | `revealed` 里上一帧没有 |
| **新解锁** | `isCellUnlocked` 这一帧才变 true（`unlockedSnapshot` 的 diff）|

- 两条可能同帧命中（新露出 + 同帧解锁）⇒ 用 `entered` 集合去重，否则同一格播两次、缩放打架。
- `unlockedSnapshot` 与 `revealedSnapshot` **同生共死**：每帧更新、换章 / 布局重建一起 `clear()`。
- 正在翻格的格子仍然让给翻格（`hexFlip.isPlaying` ⇒ `continue`），随机资源格不会播两套。
- ⚠️ 2026-10-29 起解锁成功会**马上 navigate 进战斗**，生成动画只在「后端的解锁推送先到、开战回包还没回」
  这一小段里可见；不要为了看动画而延后开战请求。

#### 四、红线

- 🔴 **两个请求共用一具骨架**：`unlockCell` 与 `startBattle` 都写在**同一个** `runCellWrite` 的
  `request` 里串行发（一次 pending 登记、**一层** loading、一个交互号）。
  两次 `runCellWrite` 嵌套会让 loading 在中间归零闪一下，且第二段取到的是新交互号 ⇒
  玩家中途点别的格作废不掉这条开战。
- 🔴 解锁回包**必须是 `ok` 才发开战**：`offline` / `failed` 一律不发（解锁状态是服务端权威，
  没确认就开战会被按「未解锁」拒绝）。这里**不套用** `startBattle` 的 fail-open ——
  那条放行的是纯本地开战，不发 `CmdStartBattleReqMsg`，两者不是一回事。
- 🔴 `battleParams` 唯一构造入口是 `battleParamsFor(site, chapterId)`；弹窗按钮与直开两条路共用，
  不许各拼一遍（漏一条就是「某种入口点进去服务端说配置错误」）。
- 🔴 开战被拒：只提示 `TERRITORY_TEXTS.bossBattleStartFailed`，格子**已解锁照常记账**，
  下一次点击回到关卡界面（不会因为一次拒绝把这格锁死）。
- 🔴 交互号：`runCellWrite` 取当下的 `this.interactionId`；串两段时**不能**中途换号，
  否则「点 A 在途 → 点 B」作废不掉 A 的开战。
- 文案：直开路径**不发**「已解锁」提示（这一下直接进战斗，提示会先闪一句再被 loading 盖掉）。

#### 五、判据

- `tests/territory-presenter.test.ts`：
  - `chapterLevelAutoStartConfig = 0：锁着的关卡点一下只解锁，不弹窗也不开战` —— 开关关掉必须完整退回两步。
  - `an initially locked stage unlocks and starts the battle on the first click` —— 解锁 1 + 开战 1 + `nav = 1` + `detail.levelInfo === null`；再点 → 才出现 `detail.levelInfo` 且**不再**自动开战。
  - `★首次解锁直开被拒：…再点回到关卡界面` —— 拒绝时 `nav = 0` / `beginBattle = 0` / 解锁照常记账。
  - `解锁请求在途：…同一层 loading 继续盖着开战请求` —— `busy` 全程只有一对 show/hide（不闪），文案「开战中…」。
  - 327 / Boss 两条两步式用例、真机 309 用例已按三段式改写。
- `tests/territory-campaign-config.test.ts`：`chapterLevelAutoStartConfig：1 开 / 0 关；缺行或脏值退回缺省（开）`
  —— 含「真表里这行必须是 1」的守卫（删表行 / 改值会红）。
- `tests/territory-boss-and-random-building.test.ts`：源码钉住 `selectSite` 走
  `handleUnlockThenBattle(site, lockedStage)` 且受 `lockedStage && isAutoStartSite(site)` 守卫，
  后者必须委托 `isBattleSite(site)`（2026-11-11 起含 asyncPvp）；
  `battleParamsFor` 内部仍走 `chapterCellBattleParams`。
- `tests/territory-presenter.test.ts`：异步据点三格共享 `configId` 时各自「解锁即直开」
  （`tips = []`、`beginBattle = 3`），已解锁后再点仍弹侦查面板；「未通关首次挑战」那条
  断言第一跳由 `selectSite` 触发、第二跳由面板按钮触发（`nav.length = 2`）。
- `tests/territory-hex-spawn.test.ts`：源码钉住 `unlockedSnapshot` 的三件事
  （首帧快照 / 每帧推新 / 换章清空）+ `entered` 去重 + 「刚解锁要进场」那一条判据。

### 3.13 固定奖励宝箱：气泡提示 + 同屏唯一 + 「还没点我」跳动（2026-11-02）

需求原文（三句，一次提完）：

> 1. 领地玩法内的固定奖励配置的宝箱 **增加一个气泡UI提示**（气泡样式同章节），气泡内的提示UI是 **体力 icon + 需要消耗的数量值**；
> 2. 同屏内多个宝箱时，**只展示 1 个气泡**，气泡优先展示在**解锁 id 最大**的宝箱上；
> 3. 当玩家点击地块，地块的**前置宝箱已激活、未点击**时播放宝箱未通过的提示动画：对应的宝箱**原地跳动 1.5s** 提示玩家点击，播放动画时**隐藏宝箱的提示气泡**。

三条规则**建在同一个状态上**：`isCellUnlocked(cellId) && !isOwned(cellId)` —— 也就是「已激活、还没点」。
这一对判据与 `stationRenderOf` 里「前置宝箱未领取 ⇒ 后继格银币数字染红」**同源**（都读 `progress`），
别在视图里另写一套「宝箱领没领」。

#### 一、真源：`app/territory/model/TerritoryChestHint.ts`（零 cc 纯函数）

| 符号 | 作用 |
| :--- | :--- |
| `territoryChestShowsHint(site, progress)` | 这一格该不该挂气泡：`type === fixedResource` + 已激活 + 未领取 |
| `territoryChestHintCell(sites, progress, revealed)` | 同屏**唯一**那只气泡挂哪：候选里解锁序号最大者，无候选 `null` |
| `territoryPrerequisiteChestCell(site, sites, progress)` | 点这一格时该跳哪只宝箱：`unlock.requiredCells` 里「已激活未领取」的固定宝箱 |
| `territoryChestUnlockId(site)` | 解锁序号 = `fixedResource_<N>` 的 `N`（兜底 `cellId`） |
| `territoryChestHintBounceOffset(elapsed)` | 跳动曲线：`elapsed` 秒时相对原位的纵向偏移 |

视图只收结果：`TerritoryMapView.syncStations` 一轮算一次 `chestHintCell` 透传给 `stationRenderOf`，
`TerritoryStationView` 只负责把「偏移 / 气泡可见」写进节点。

#### 二、气泡：样式复用章节那颗，内容是「体力图标 + 消耗数」

- **底图**用 `art.levelBubbleFrame`（已通关那张蓝底 `frame_03`，与章节关卡编号同一张、同一套圆角与尾巴）。
  🔴 别按 `claimed` 去取未通关红：宝箱本来就还没领，取红会读成「被打败了」。
- **文字** = `site.unlock.staminaCost`；**图标** = `art.staminaIcon`（`RESOURCE_ICON_ART_ROOT/图标_体力`，
  与领奖飘字同一张，别在领地目录另存一份）。
- 图标与数字**成对居中**（`applyLevelBubbleLayout`，唯一写入口）：
  ```
  总宽 = 26(图标) + 2(间距) + 实测文本宽
  图标中心 x = −总宽/2 + 13
  数字中心 x = +总宽/2 − 文本宽/2
  ```
  做法是 `overflow` 在 `NONE`（有图标，要实测文本宽）与 `SHRINK`（纯文字，编号居中）之间切 ——
  切 `NONE` 才量得到真实字宽，`SHRINK` 下 `contentSize` 恒是框宽。
- **拿不到图标 ⇒ 退化成纯数字**（美术没到位时宁可少个图标，也不能让宝箱没有提示）。

#### 三、同屏唯一：「同屏」= 本轮渲染出来的格子

- 地图是整张 ScrollView 内容层、**没有视口裁剪** ⇒ 「渲染出来的 = 玩家可能看到的」，
  不再算屏幕矩形（算了反而会有「滚到边缘气泡忽隐忽现」的抖动）。
- 排序：解锁序号大者优先；**同号**（数据脏了）取 `cellId` 小的那个 —— 保证结果与 `sites`
  的遍历顺序无关、可重复。已领取 / 未激活 / 未露出的格子一律**不参选**。
- 序号取 `fixedResource_<N>` 的 `N`（编辑器建点顺序）。已核对 `chapter_01~07`（历史 `chapter_smile` 预设已清理）：
  固定宝箱 id 全部合规且**同章不重号**，判据钉在 `tests/territory-chest-hint.test.ts`。

#### 四、跳动 1.5s + 播放期间藏气泡

| 常量 | 值 | 说明 |
| :--- | :--- | :--- |
| `TERRITORY_CHEST_HINT_SECONDS` | `1.5` | 需求原文的时长 |
| `TERRITORY_CHEST_HINT_HOPS` | `3` | 3 跳 × 0.5s，节奏够"催"，不会读成抽搐 |
| `TERRITORY_CHEST_HINT_HEIGHT` | `14` | 第一跳抬起高度（地图像素） |
| `TERRITORY_CHEST_HINT_HOP_DECAY` | `0.25` | 逐跳 ×0.75，收得住；1.5s 末端正好回 0 |

- 曲线是每跳一条**半正弦** `sin(π·phase)`：起跳与落地都为 0（不瞬移），1.5s 结束精确落回原位
  —— 所以**不需要"复位动画"**，播完把偏移写 0 就落地。
- 非法入参（`NaN` / 负数 / 已播完）一律返 0：站点每秒会被刷一次，宁可"这一帧没跳"，
  也不能把 `NaN` 写进节点坐标（那是整只宝箱消失，且零报错）。
- 🔴 **偏移必须走唯一坐标出口** `writeIconPosition()`（`iconBaseY + chestHintOffsetY`）：
  `applyIconPlacement` 每秒会重排一次位置，动画里直接 `setPosition` 会被"按回地面"。
- 🔴 **藏气泡必须走开关** `setHintBubbleSuppressed(bool)`，判据落在 `renderLevelBubble` 的
  `visible` 表达式里（`&& !this.hintBubbleSuppressed`）。直接 `node.active = false` 会在下一轮
  `syncStations` 重画时被**重新打开** —— 动画还在播，气泡却回来了。
- 触发在 `onStationClick`（`playTapFeedback` 之后、转发意图之前：转发会弹全屏 loading）。
  三条守卫：① 本格自己**还没开**（已解锁/已拥有时前置宝箱不再挡路，跳了是误导）；
  ② 拿不到站点视图 ⇒ 不播；③ 同一只连点 ⇒ **重新起跳**（催一次，不排队播 N 次）。
- 🔴 跳动判据是 **`!isOwned`**，不是「已激活未领取」（2026-11-02 追加）：
  `isPrerequisiteComplete` 对固定资源的口径是「**解锁即算完成**」，所以「宝箱还锁着」那种情况
  **不会**被前置判定拦住、却同样把玩家堵在门外。两种状态对玩家都是"这个宝箱还没打开"
  （提示文案统一写「前置宝箱未打开」），跳动目标自然也要覆盖两态 —— 否则玩家读到提示抬头看，
  地图上一点反馈都没有。⚠️ **气泡的判据不跟着放宽**：气泡写的是"花多少体力领"，
  箱子没激活时挂上去只会让人以为现在就能点。
- 收尾只有一条路径：`stepChestHint` 扣到 1.5s ⇒ `clearChestHint()`（偏移归零 + 解禁气泡 + 清表）。
  换章（`syncGrid` 换图分支）也走它 —— 否则半空的偏移与"气泡抑制"会挂到新图同名 `cellId` 上
  （症状：某只宝箱一直浮着、气泡永远不出现）。

#### 五、判据

`tests/territory-chest-hint.test.ts`（26 条）：

- 气泡：只挂「已激活未领取」；非宝箱站点不挂；用**本格**解锁而不是区域通关。
- 唯一：留解锁 id 最大者；已领取 / 未露出不参选；结果与输入顺序无关（含同号取小）；
  真表守卫（八张图的宝箱 id 合规 + 同章不重号）。
- 跳动：判据落在前置格上；**已领取不跳、未解锁也跳**；`footprint` 命中也要认；多只取序号最大；
  1.5s 三跳起点落点为 0、峰值 = 抬起高度、逐跳衰减、整段非负且不超首跳。
- 接线守卫：`update` 第一条仍是 `hexFlip.step` 且调了 `stepChestHint`；`onStationClick` 起跳、
  `syncGrid` 收尾；`visible` 里含 `hintBubbleSuppressed`；Icon 的 `setPosition` 只剩一个出口；
  `staminaIcon` 从资源加载一路接到 `levelBubbleIcon`。

⚠️ 桩型用例（`territory-building-shake` / `territory-random-resource-render` /
`territory-resource-gain` / `territory-theme` / `territory-tile-frames`）的 require 桩里必须加
`'../model/TerritoryChestHint'` 与 `'../model/TerritoryLevelBubble'` 两个分支，否则会在沙箱
`require` 阶段直接
`Unexpected dependency`（看起来像产品代码炸了）。

### 3.14 「前置没满足」的提示要指名道姓（2026-11-02）

需求原文（截图里那条「前置领地尚未占领」太笼统）：

> · **前置地块未解锁提示具体的前置地块的名字**；
> · **关卡地块**提示关卡的名字 `【数字-数字 关卡通关后解锁】`，**名字同气泡文案**；
> · **宝箱地块**则播放宝箱的动画，并且提示文案改为 `【前置宝箱未打开】`。

**只报第一个**（2026-11-02 用户定口径：`chapter_01` 有前置 5 格的格子，全列出来 toast 会跨两行压住地图）：

| 第一个能命名的前置是 | 玩家看到的那句话 | 依据 |
| :--- | :--- | :--- |
| 没打完的关卡 / 首领 / 异步据点 | `1-1 关卡通关后解锁` | 名字 = 该格**气泡文案** |
| 没打开的固定宝箱 | `前置宝箱未打开` | + 对应宝箱原地跳 1.5s（§3.13） |
| （前几格都念不出名字）普通地块 | `前置领地尚未占领`（兜底） | `chapter_01` 有 4 处这种前置 |

"第一个"= `requiredCells` 的**书写顺序**（编辑器连线顺序），不排序、不挑"更重要"的；
念不出名字的格子（不属于任何站点的普通地块）**跳过**看下一个。多个前置就分多次提示：
玩家按提示做掉一个、再点一次，自然看到下一个 —— 比一句话塞三段好读。

#### 一、名字：与气泡文案**同一个函数**

`model/TerritoryLevelBubble.territoryLevelBubbleText(site, stage)` —— 2026-11-02 把气泡文案从
`TerritoryMapView` 搬到这里，就是为这一条：气泡写什么，提示就说什么。

- 主线 / 首领 ⇒ `${chapterId}-${stage}`（`1-1`，连字符两侧不留空格）；
- 异步据点 ⇒ `PVP`。🔴 它是可重复挑战，编号会被读成"第 4 关打一次就过"；提示里若自己拼
  `${chapterId}-${stage}`，地图上根本没有那个编号 —— 玩家会去找一个不存在的关卡。

`TerritoryMapView` 现在只剩 `levelBubble: territoryLevelBubbleText(site, stage)`，
`exports TERRITORY_ASYNC_PVP_BUBBLE_TEXT` 是**转发**（旧引用不断），值只存在于 model。

#### 二、清单：与拦截判据**同源**

`TerritoryProgress.prerequisiteBlockers(cellId)` 返回「还没满足的前置格」，`checkUnlock` 的
拦截直接调它 ⇒ 不会出现"拦了却说不清拦在哪"或"提示列了个其实不挡路的格"。

🔴 一个容易想反的点：**固定资源的"完成"是「解锁即完成」**（`isPrerequisiteComplete` 的特例）。
所以「宝箱前置」只有**还没解锁**时才进这张清单；「已解锁、还没领取」的宝箱**不拦人**，
那种情况走的是另一条表现（后继格银币数字染红 + 点击时宝箱跳动，见 §3.13）。
两条需求各管一段，别合并成一条判据。

#### 三、拼法（`model/TerritoryPrerequisite`，零 cc）

- `territoryPrerequisiteText(blockerCellIds, sites, stageByCell)`：一步到位（查站点 → 取名 → 拼句）；
- `territoryPrerequisiteBlockText(blockers)`：只负责拼，纯数据进出，单测直接钉字符串；
- **只输出一句**：按清单顺序找第一个「宝箱」或「能命名的关卡」，命中即返回 ——
  不存在「1-1、1-2」这种名单，也不存在「关卡 + 宝箱」拼两句（有守卫钉着：真表扫一遍，
  结果里不许出现 `、` / `，` / `等`）；
- 叫不出名字 ⇒ 返回**空串**，由 `TerritoryModel` 退回 `TERRITORY_TEXTS.prerequisiteNotOwned`。
- 只有「前置没满足」这一条 reason 被改写；战力不足 / 在探索 / 已占领等 reason **原样透出**
  （它们本来就够具体，套一层反而更糊）。

#### 四、判据

`tests/territory-prerequisite-text.test.ts`（13 条）：

- 拼装：只有关卡 / 只有宝箱 / 混合只报第一个（两种顺序各测一次）/ 多个关卡只报第一个 /
  念不出来的跳过 / 无名返空串。
- 取名：`3-12`、`PVP`、没绑关卡返 `undefined`；并钉住「`TerritoryPrerequisite` 里不许再出现
  `${chapterId}-` 这种本地拼法」。
- 真表 + 真进度：`chapter_01` 全站点扫一遍 —— 每个被拦的站点，`prerequisiteBlockers` 非空且
  `checkUnlock` 确实拦；拼出来的句子只能是那几种合法形态（含 `PVP 关卡通关后解锁`）；
  空串**只**出现在"前置全是不属于站点的普通地块"时。
- 接线守卫：`canAffordUnlock` 走 `unlockBlockTip`；`prerequisiteBlockText` 只喂数据、不自己扫表。

⚠️ 桩型用例的 require 桩里要补 `'../model/TerritoryLevelBubble'`（`TerritoryMapView` 新增了这条
import），否则整组会以 `Unexpected dependency` 红。

### 3.15 首次解锁关卡自动开战：推一下镜头 + 一句话（2026-11-02）

需求原文：

> **首次解锁关卡自动进入战斗时，镜头推进**（类似宝箱第二档奖励的效果），**同时弹出提示条**，
> 文案 `【遭遇敌人，即将开始战斗】`。

要拆成三件事看，缺一条就会做歪：

| # | 需求 | 落到哪 |
| --- | --- | --- |
| 1 | **只在「首次解锁 ⇒ 自动开战」这条入口播** | `TerritoryModel.handleUnlockThenBattle` 是**唯一**传 `approach = true` 的地方 |
| 2 | 镜头推进 = 宝箱**第二档**的观感 | `TERRITORY_BATTLE_APPROACH_ZOOM = 1.35` |
| 3 | 同时弹提示条，文案逐字 | `TERRITORY_TEXTS.battleApproach`，页面 `FW.showTip` |

🔴 第 1 条是本次最容易做错的地方：玩家在 `LevelInfoPanel` 里**自己按**「开始战斗」时**不播**。
他刚刚亲手点了按钮、本来就等着跳场景，再拖 1.2 秒纯属卡顿；而"首次解锁"是**系统替他按的**
开战键 —— 不推一下、不说一句，玩家会以为误触，场景就切走了。

#### 一、曲线（`model/TerritoryBattleApproach`，零 cc）

```
0 ──0.6s──▶ 1.35 ──保持──▶ 1.0s ──0.2s──▶ 1.0（复位）
    easeOutCubic              easeInQuad
```

| 常量 | 值 | 作用 |
| --- | --- | --- |
| `TERRITORY_BATTLE_APPROACH_SECONDS` | **1.2** | 总时长；页面延迟跳转用的就是它（**两处同源**，改一个不用两边改） |
| `TERRITORY_BATTLE_APPROACH_IN_SECONDS` | 0.6 | 推到位 |
| `TERRITORY_BATTLE_APPROACH_HOLD_UNTIL` | 1.0 | 保持到的时刻 |
| `TERRITORY_BATTLE_APPROACH_OUT_SECONDS` | 0.2 | 收回 = 总时长 − 保持点（算出来的，别手写） |
| `TERRITORY_BATTLE_APPROACH_ZOOM` | **1.35** | = `TERRITORY_CHEST_CAMERA_ZOOM_MEDIUM`（宝箱第二档） |

输出 `{ scale, focus, done }` —— 与 `territoryChestCameraFx` **同一套语义**（`focus` 是"目标格往
屏幕中心挪多少"，0 = 原位、1 = 正中），所以 `TerritoryMapView` 一行新公式都没写，只是换条曲线喂
同样的 `applyChestCamera(scale, focus, origin)`。

三个容易踩的点：

- **起点必须恒为 1**（`t = 0` ⇒ `scale 1 / focus 0`）：点下去那一帧的画面要和静止时逐像素同大，
  不能"点一下突然弹大一圈"（宝箱那边 2026-10-22 踩过同一个坑）。
- **收尾必须回 1**：过场结束就跳战斗页，但地图节点已被放大 + 平移，不还原的话页面晚销毁一帧就会
  「啪」地缩回去；而且带着放大的 content 去开 `ScrollView`，滚动边界会按错的尺寸算（§3.1.1）。
- **非法入参按 `t = 0`**：`NaN` / 负数不能写进节点 scale —— 那是整张地图消失，且零报错。

#### 二、视图：复用开箱那套基准，不许新写推镜

| 环节 | 做法 |
| --- | --- |
| 取格心 | `cellPointInOverlay(cellId)`（与开箱同一入口）；拿不到 ⇒ **返回 `false`**，不播 |
| 量基准 | `captureChestCamera(point)` —— 必须在第一帧写位置**之前**量，否则量到的是"已经被推过"的地图 |
| 每帧 | `stepBattleApproach(dt)` → `applyChestCamera(fx.scale, fx.focus, origin)` |
| 收尾 | 只把 `battleApproach` 置 `null`，还原与解锁交给 `update` 里那条唯一的收尾路径 |

🔴 **`cameraBusy` 必须三合一**：

```ts
const cameraBusy = this.chestView?.isPlaying === true || this.clouds.dollyActive
    || this.battleApproach !== null;
```

漏掉最后一项的后果很具体：过场刚开始的那一帧 `cameraBusy` 为假 ⇒ `restoreChestCamera()` 立刻
把地图按回原位，镜头根本推不动（表现为"提示条弹了，但画面没反应"）。

`stepBattleApproach` 的位置也有讲究：必须排在 `update` 的 `stepCloudDolly()` **之后**、`cameraBusy`
判定**之前** —— 晚一帧写 `applyChestCamera` 就会和云的那套推镜抢同一帧的 `scale`。

另外两处要清状态（先清再 `restoreChestCamera`，否则它还会继续写位置）：`stopChestPlay()`、
`syncGrid` 的换图分支。同时 `playBattleApproach` 里 `chestView?.isPlaying` 为真就直接 `false` ——
两套镜头同时写 `scale` 会互相打架。

#### 三、页面：延一帧起播、播不了就立刻跳

```ts
if (!payload.approach) { this.commitBattleNav(payload); return; }   // 玩家手按的那条，原样直跳
if (this.battleApproachPending) return;
this.battleApproachPending = true;
this.scheduleOnce(() => {                                            // ① 延一帧
    const started = this.mapView?.playBattleApproach(pve.territoryCellId) ?? false;
    if (started) FW.showTip(TERRITORY_TEXTS.battleApproach);
    this.scheduleOnce(() => { …; this.commitBattleNav(payload); },   // ② 推迟一个总时长
        started ? TERRITORY_BATTLE_APPROACH_SECONDS : 0);
}, 0);
```

- **① 为什么延一帧**：写请求的全屏 `LoadingPopup` 是在 model 的 `finally` 里才收的，同一帧起播会被
  全屏 loading 整个盖住（玩家只看到提示条、看不到推镜）。
- **② `started ? 时长 : 0`**：格子不在视口 / 覆盖层没建 ⇒ `playBattleApproach` 返回 `false`，
  这时**别白等 1.2 秒**，立刻跳。
- **单一跳转出口**：过场前后都走 `commitBattleNav(payload)`，
  `ProcedureManager.navigate(GameRoute.Battle` 全文件**只有这一处**（守卫钉着），避免两条分支
  各写一份导致 preload 处理漂移。
- **预热不跟着延后**：`ensureBattlePreload` 在分支之前就调了，1.2 秒正好用来等资源。
- **过场期间丢弃后续 navigate**（`battleApproachPending`）：地图已被 `setInputLocked(true)` 锁住，
  正常也点不出第二格；这条只是兜住协议侧的重发。

#### 四、载荷：`approach` 是可选的、只在为真时挂上

`TerritoryModel.navigateToBattle`：

```ts
this.publish({ kind: 'navigate', payload: approach ? { pve, battle, approach } : { pve, battle } });
```

不写成 `{ pve, battle, approach: false }` 是为了不动既有断言 —— 老用例是整对象深比较的。
链路：`applyBattleStart(site, stage, result, approach = false)` → `beginBattle(…)` → `navigateToBattle(…)`；
`handleUnlockThenBattle` 的回包里传 `true`，是**全文件唯一**带 `true` 的调用点。

#### 五、判据

`tests/territory-battle-approach.test.ts`（13 条）：

- 曲线：起点 `1 / 0`、推到头 `1.35` 且 `focus = 1`、保持段恒 `1.35`、结束回 `1` 且 `done`、
  推入段单调有界、非法入参按原位、总时长落在 1~2s。
- 文案：`TERRITORY_TEXTS.battleApproach === '遭遇敌人，即将开始战斗'`（逐字）。
- 接线守卫：`applyBattleStart` 只有 2 处调用且只有 1 处带 `, true`；navigate 载荷是三元表达式；
  页面有 `if (!payload.approach)` 分支 + `playBattleApproach(pve.territoryCellId)` +
  `FW.showTip(TERRITORY_TEXTS.battleApproach)` + `started ? … : 0`；
  `ProcedureManager.navigate(GameRoute.Battle` 只剩 1 处；
  视图里 `stepBattleApproach` 在 `update` 内、`cameraBusy` 含 `|| this.battleApproach !== null;`、
  起点写的是 `applyChestCamera(1, 0, point)` + `setInputLocked(true)`。

⚠️ 桩型用例的 require 桩若报 `Unexpected dependency: ../model/TerritoryBattleApproach`，
说明页面新增了这条 import，补桩即可（`MainTerritoryMap` 只取那个 `_SECONDS` 常量）。

### 3.16 宝箱气泡换 `frame_04`：竖向水滴 + 图标在上、数字在下（2026-11-02）

需求原文（用户附美术资源树截图 + 美术参考图）：

> 「宝箱的气泡框使用新的美术资源 **`frame_04`**，图标内 icon 和数字的排版参考 screenshot-2 的美术图」

#### 一、为什么不能沿用「章节」气泡那套

| | 章节 / 关卡编号气泡 | 宝箱提示气泡 |
| --- | --- | --- |
| 底图 | `frame_03` 蓝 / `frame_02` 红，**94×45 横向胶囊** | **`frame_04`，77×87 竖向水滴**（尖朝下指着宝箱） |
| 内容 | 一行编号（`1-1` / `章节` / `PVP`） | **上下两行**：上 icon、下数字 |
| 排版 | 图标与数字**并排**、整对居中 | 图标在上、数字在下，**各自**水平居中 |

77 宽的水滴里并排放 36 的图标 + 两位数会顶到描边，而水滴的尖端只有 12px 宽 ——
所以旧的「总宽 = 图标宽 + 间距 + 数值宽」那套（`LEVEL_BUBBLE_ICON_SIZE/GAP`、
`readBubbleTextWidth`）随本次换图**一并删除**，别再加回来。

#### 二、数值（`model/TerritoryChestBubble`，零 cc）

| 常量 | 值 | 依据 |
| --- | --- | --- |
| `TERRITORY_CHEST_BUBBLE_WIDTH/HEIGHT` | **77 / 87** | `frame_04.png` 实测画布，按原尺寸渲染（缩放会让 1px 描边发虚） |
| `..._ICON_SIZE` | **36** | 约占气泡宽 47%（美术稿里肉块与水滴同比例）。2026-11-02 第二轮「放大 5%」⇒ 34 × 1.05 = 35.7 → 36 |
| `..._ICON_Y` | **+17** | 落点处 alpha 宽 ≥ 65（水滴最宽段），不顶圆顶；36 的图标占 y −1 ~ +35，最上一行 alpha 宽 53 ≥ 36 |
| `..._TEXT_Y` | **−17** | 数字包围盒（含描边）占 y −3 ~ −31，第 75 行 alpha 宽 33 刚好装下两位数字；再往下压到尖端 |
| `..._FONT_SIZE / LINE_HEIGHT` | **24 / 27** | 美术稿 `12` 的字高约占内区 20%（实测 10px / 51px）⇒ `87 × 0.20 ÷ 0.716 ≈ 24` |
| `..._TEXT_COLOR` | **`#5A3A1E`** 深棕 | 底图奶白 `#F8F0E0`，**白字等于没字**；纯黑又比美术稿硬一档 |
| `..._OUTLINE_WIDTH / _COLOR` | **1 / `#3A2410`** | 补字重：美术稿笔画约占字高 25%，实机只有 ~12%，`isBold` 到顶也补不满 ⇒ 叠一圈同色系更深的描边 |

视图侧只读 `territoryChestBubbleLayout()`，`renderLevelBubble` / `themeLevelBubbleLabel` /
`applyLevelBubbleLayout` 里**都不许再写数字**：换图后只要 PNG 变了，常量与用例会一起亮红。

#### 二·补 2026-11-02 第二轮：icon +5%、字体「大小和粗细」对齐美术稿

用户原话：「体力 icon 放大 5%，字体样式也要匹配原来的大小和粗细」。逐像素比对后结论：

| 项 | 实机（改前） | 美术稿 | 处理 |
| --- | --- | --- | --- |
| icon 边长 | 34 | 略大一点 | **36**（+5.9%，5% 取整的必然） |
| 数字字高 / 气泡内区高 | 10 / 44 = 22.7% | 10 / 51 = 19.6% | 字号 22 → **24**（按内区 20% 反推） |
| 笔画 / 字高 | ~12%（细、发灰） | ~25%（厚） | `isBold` 已开 ⇒ 再叠 **描边 1**（同色系更深 `#3A2410`） |

⚠️ 描边宽度**不要**图省事取 2：24 号字叠 2 会把 `12` 糊成一团（合成图对照美术稿明显偏粗）。
⚠️ 两套气泡**共用同一个 Label** ⇒ 切回编号气泡时必须把 `outlineColor` 复位成 `Color.BLACK`
（只改 `enableOutline` 的话会带着上一轮的深棕描边）。


#### 三、视图的三处关键改动

1. **尺寸每帧刷**：`UITransform` 与 `Sprite.type` 都按「有没有 icon」重算 ——
   宝箱用 `SIMPLE`（成品水滴无九宫格切边）、编号用 `SLICED`（胶囊靠切边保圆角）。
   创建时定死会在「同一格从编号气泡变成宝箱提示」时留下错尺寸。
2. **定位读实际高度**：`applyLevelBubblePosition` 不再写死 `MAP_MARKER_BUBBLE_HEIGHT(45)`，
   改成读节点 `contentSize.height` —— 否则 87 高的水滴会把尖扎进地块 / 整体飘高一截。
3. **文字样式收进唯一入口** `themeLevelBubbleLabel(chest)`：两套口径差别很大
   （深棕 + 深棕描边 vs 白字压黑描边），创建与复用都走它，避免只改一处；
   切到编号气泡时要**同时**复位 `outlineColor`（共用一个 Label）。

#### 四、判据

`tests/territory-chest-bubble.test.ts`（12 条）：

- **底图**：常量路径就是 `image/spawn-region/frame_04/spriteFrame`；宽高与 PNG 画布一致；
  高 > 宽（拿成横向胶囊会立刻红）。
- **不溢出**：解 PNG 逐行 alpha 区间，icon 方框与数字方框（**含描边**扩边）的**每一行**
  都必须被不透明区间盖住（变异验证：`ICON_SIZE` 改成 52，这条与「上下不重叠」「+5%」一起红）。
- **顺序与颜色**：`iconY > textY` 且两者不交叠；底图平均亮度 > 200 ⇒ 文字亮度必须 < 110。
- **第二轮口径**：`iconSize ∈ [34, 36]`（5% 取整区间）、icon 占宽 44%~50%、
  描边宽度 1~3 且**描边色比文字色更深**（否则等于没加粗）。
- **接线**：页面 `loadFrame(assets, TERRITORY_CHEST_BUBBLE_FRAME_PATH)` 且 `return` 带
  `chestBubbleFrame`；地图视图取 `input.art.chestBubbleFrame ?? input.art.levelBubbleFrame`；
  视图有 `icon.node.setPosition(0, chest.iconY, 0)`、`badgeLabel.node.setPosition(0, chest.textY, 0)`、
  `const spriteType = chest ? Sprite.Type.SIMPLE : Sprite.Type.SLICED;`；
  描边三件（`enableOutline = chest.outlineWidth > 0` / `outlineWidth` / `outlineColor`）都在
  `themeLevelBubbleLabel` 里接线，且有 `outlineColor = Color.BLACK` 的复位；
  反向钉住 `LEVEL_BUBBLE_ICON_GAP` / `readBubbleTextWidth` **不许回来**。

⚠️ 桩型用例：`TerritoryStationView` 新增了 `../model/TerritoryChestBubble` 这条 import，
`tests/helpers/territory-station-fixtures.ts` 的 require 桩必须以**真模块**补上，
`TerritoryPageAssets` 的桩（`territory-random-resource-render`）同理 —— 否则整组会以
`Unexpected require/dependency` 红，看起来像产品代码炸了。

### 3.17 「胜利通过」的地块进场比普通生成**更重**（2026-11-03）

用户原话：*「胜利通过的地块动画节奏感需要比普通的地块生成动画更强，更明显」*。

#### 一、为什么必须分两档，而不是把普通档调重

同一支动画服务两件性质不同的事：

| 场景 | 性质 | 节奏该多重 |
| :-- | :-- | :-- |
| 云散开 / 解锁一片 / 章节推进露出 | **背景事件**，常常一次十几格 | 轻。重了就是挡视线 |
| 打完这一关、地盘归我 | **主动作的收尾**，玩家视线就在这一格 | 重。要让"收地"有一下落地的声音 |

所以不是改参数，是**分档**：曲线完全共用（`easeOutCubic`），只有 `ITerritoryHexSpawnTiming`
里的七个数不同。改一处曲线两边一起变，档位差异一眼能比对（见 `model/TerritoryHexSpawn.ts` 的表）。

#### 二、两档的具体差异

| 维度 | 普通 `TERRITORY_HEX_SPAWN_TIMING` | 胜利 `…_VICTORY_TIMING` | 为什么 |
| :-- | --: | --: | :-- |
| 单格时长 | 0.40s | **0.62s** | 过冲要有时间收尾，否则读成"抖了一下" |
| 起手缩放 | 0.55 | **0.28** | 起手更小 ⇒ "从地里长出来"的落差更大 |
| 过冲峰值 | 无（`peakScale = 1`） | **1.14 @ 72%** | 长过头再收回 = "砸下去"；只放不弹就只是普通缓出 |
| 错峰间隔 | 0.055s | **0.14s** | 一格一格分得开才听得出节拍（普通档几乎同时冒头） |
| 错峰上限 | 0.30s | **0.62s** | 十几格也让它真的排完；"同时一坨"就没有节奏了 |
| 透明度铺满 | 70% | **50%** | 先亮起来再长大，亮的那一下正好压在过冲上 |

- 透明度**仍然先于缩放铺满**（这条两档共用，`opacityPortion < 1` 是硬口径）。
- 过冲是**连续**的：`t = peakPortion` 时两支都取到 `peakScale`（`easeOutCubic` 端点精确），
  不会在切换点跳一下；`t >= seconds` 一律回 `{ scale: 1, opacity: 1 }`（`assert.deepEqual` 钉住）。
- 普通档 `peakScale = 1 / peakPortion = 1` ⇒ `territoryHexSpawnFrame` 走"缓出长到底"那一支，
  **不是**靠 `if (victory)` 分支 —— 两档共用同一条代码路径。

#### 三、哪一批算「胜利通过」

模型侧两个字段（`TerritoryModel`）：

| 字段 | 语义 |
| :-- | :-- |
| `victoryPending` | 「刚打完一场胜仗，等一下收进来的那批要放大播」—— 由 `applyStoredBattleResult()` 在 **`result.ok`** 时置位 |
| `victoryClaimCells` | 这一批具体是哪几格 —— 由 `settleProgress()` 在 `claimed.length > 0` 时兑现，**兑现即清标记** |

- 🔴 标记必须挂在 `result.ok` 上：`ok === false`（这一格已经在探索中 / 不满足条件）时并没有
  "新收进地盘"，放大播一遍纯属噪音。
- 🔴 `settleProgress` **每次进来先清空** `victoryClaimCells`：它只服务于紧接着的那一次渲染，
  留着不放会让后面无关的生成批次也走重档。
- 🔴 `claimed` 为空（只是"没到期"）时**不能消费** `victoryPending`，否则真正的收地那批反而丢档。
- 🔴 切章节（`loadChapter`）与 `dispose()` 都要复位两个字段：否则新章第一次普通生成会被
  当成"胜利通过"放大播。

视图侧选档（`TerritoryMapView.syncHexSpawn`）：

```ts
const celebrate = input.victoryClaimCells;
const victory = celebrate.length > 0 && fresh.some((cell) => celebrate.includes(cell.cellId));
const timing = victory ? TERRITORY_HEX_SPAWN_VICTORY_TIMING : TERRITORY_HEX_SPAWN_TIMING;
const delays = territoryHexSpawnDelays(fresh, timing.stagger, timing.staggerMax);
```

- **整批同档**：同一批里只要有一格来自胜利格，整批都走重档 —— 混档播没有节拍。
- ⚠️ `territoryHexSpawnDelays` 的第 2/3 参必须跟着 `timing` 走。只改时长不改错峰，
  格子还是挤在一起，玩家看到的只是"变慢了"而不是"更有节奏"（用例专门钉这一条）。
- 首帧建快照（`spawnBootstrapped`）**不播**：进页面时不该放大播一遍存档里已有的格子。
- `TerritoryHexSpawn`（视图）按**格**记 `timing`：同一批可能混档，`remainingSeconds()` 也要
  按每格自己的档位算剩余（页面靠它决定"新地块生成播完再盖云"）。

#### 四、判据

`tests/territory-hex-spawn.test.ts`：

- `★★★胜利档每一项都比普通档更重` —— 时长 / 起手 / 错峰 / 上限 / 透明度五条全部**单向**比较；
  普通档 `peakScale === 1`（不许有过冲）。
- `★★★唯一过冲峰值精确等于 peakScale，末帧精确回到 1` —— 200 点采样：不越界、
  只允许**一个**拐点、峰值落在 `peakPortion ± 1.5 步`、`peakPortion` 处取到精确值、
  `t >= seconds` 回到 `{1,1}`。
- `★透明度在 opacityPortion 就已铺满` —— 铺满那一刻缩放仍在半路（"亮"与"长大"是两段）。
- `★一批的总时长长于普通档` + `★错峰间隔按胜利档算且仍按簇心铺开`。
- `视图 play 第 4 参把档位带进每一格` —— 起手帧用该档 `fromScale`、`remainingSeconds` 用该档时长、
  普通档到点时胜利档还在播。
- `★★★地图视图：胜利那一批整批走重档` / `★首帧不播胜利档` —— 源码守卫。
- `★★★模型：只有 result.ok 才置标记` / `只兑现一次` / `切章与销毁都复位` / `状态透出`。

### 3.18 体力 / 银币不够时，**对应的**那个数字变红（2026-11-03）

用户原话：*「体力不足或银币不足时，对应的数字 UI 显示红色」*。

#### 一、三个数字，两套判据

| 数字 | 在哪 | 判据 |
| :-- | :-- | :-- |
| **银币**消耗（未解锁格左上「银币 + 15」） | `stationRenderOf` 的 `!isOpened` 分支 → `conditionTextColor` | `wallet.silver < site.unlock.silverCost` |
| **体力**消耗（宝箱水滴气泡里「体力 + 1」） | `fixedResource` 分支 → `levelBubbleTextColor` | `wallet.stamina < site.unlock.staminaCost` |
| 银币消耗（随机资源格） | `syncStations` 的随机格分支 | `wallet.silver < randomSites.triggerSilver` |

判据只有一个入口：**`model/TerritoryCostShortfall.territoryUnlockShortfall(wallet, cost)`**
（两项分开返回 —— 这就是"对应"的全部意思）。

#### 二、银币数字的三条红法（缺一条都读错）

```ts
const short = territoryUnlockShortfall(input.wallet, site.unlock);
const silverRed = short.silver                        // ① 银币确实不够
    || unclaimedFixedPrereq                           // ② 前置宝箱还没领（2026-10-21 口径）
    || (!isOpenable && !short.stamina);               // ③ 这格开不了，但不是因为体力
```

- ① 是本次需求；
- ② 是既有口径，必须留着（否则"宝箱没领"这条提示消失）；
- ③ 保留旧读法（前置没打 / 战力不够时数字跟着红），但**把「体力不足」这一种排除掉** ——
  体力不够却把银币染红，等于告诉玩家"钱不够"，他会去攒错东西。
- 🔴 因此**不能**再写成 `isOpenable && !unclaimedFixedPrereq ? 白 : 红`：那样一体力不足就整片红。

#### 三、边界（都写在纯函数里，用例逐条钉住）

| 情况 | 结论 | 为什么 |
| :-- | :-- | :-- |
| `cost <= 0`（免费格 / 表里填 0） | 不算不足 | 否则整张图红一片，而玩家点得进去 |
| `cost` 非有限数（`NaN` / `∞`） | 不算不足 | 配表脏数据不该由表现层兜（配表侧有校验线） |
| 余额未知（`NaN` / 缺 `wallet`） | 不算不足 | 红是"确定不够"的断言，读不到就染红只是噪音 |
| 刚好够（`balance === cost`） | 不算不足 | 能开就是能开 |

#### 四、接线（少一跳就静默不变红）

```text
TerritoryModel.buildState()            → wallet: { silver, stamina }        （存档兜底 0，与 buildHud 同口径）
TerritoryViewState.buildTerritoryViewState() → wallet 拍快照（Object.freeze）
MainTerritoryMap.renderAll()           → renderMap({ …, wallet: state.wallet })
TerritoryMapView.stationRenderOf()     → conditionTextColor / levelBubbleTextColor
TerritoryStationView.renderLevelBubble() → 覆盖 badgeLabel.color
```

- ⚠️ 快照必须冻结：延迟一帧的渲染若读到**已经扣过费**的实时钱包，银币数字会在同一帧里
  红→白闪一下，红/白也就不再对应"付款前"的事实。
- ⚠️ 气泡覆盖色必须排在 `themeLevelBubbleLabel` **之后**：那一支每帧都会把颜色写回
  「宝箱深棕 / 编号白」，写在前面等于被它盖掉（表现：体力不足但数字仍是深棕）。

#### 五、判据

`tests/territory-wallet-shortfall.test.ts`（12 条）：

- 纯函数：刚好够 / 差 1 / 免费 / 脏消耗 / 余额未知 / 两项各判各的 / 大数（`MAX_SAFE_INTEGER`）。
- 接线守卫：银币那颗只读 `short.silver`、体力那颗只读 `.stamina`、随机格同口径、
  覆盖色在 `themeLevelBubbleLabel` 之后、钱包从模型一路透到地图（含快照冻结）。
- **行为**（沙箱真跑 `syncStations`）：未解锁站点格四条 —— 都够白 / 银币差 1 红 /
  **只缺体力 ⇒ 银币白** / 两项都缺 ⇒ 红。截图里那几颗「银币 15」走的正是这条路径，
  不能靠随机格那份用例"顺带证明"（两条渲染路径）。

`tests/territory-random-resource-render.test.ts`（行为，同一套沙箱）：

- `★★★银币不够 ⇒ 银币数字红；体力不够（银币够）⇒ 银币数字白` —— 随机格同四条。

⚠️ `TerritoryMapView` 的沙箱桩表已抽到 `tests/helpers/territory-map-view-sandbox.ts`
（`loadTerritoryMapViewClass`）：新增 MapView 的 import 时**只补这一处**，
否则所有引用者一起以 `Unexpected dependency` 红。

### 3.19 「章节选择」的入口 = 地图上的章节建筑（含气泡）；两侧三角关闭（2026-11-03）

章节列表名称由 `PVP-关卡.xlsx` 导出的 `chapterName.json` 提供：经 `ConfigService` 读取，按 `chapterId` 对应并显示 `chapterName`（例如第一章“枯菌穹顶”、第二章“僵笑面具”）。缺少对应项时沿用地图名称，再兜底为章节序号；名称配置不改变章节开放范围、锁定态或站点完成度。

用户两句话（配两张图）：

> 1. 「章节弹窗对应的打开按钮是章节建筑（包括气泡部分」
> 2. 「关闭快速寻敌的左右侧的三角形按钮 UI」

这是同一件事的两半：**入口搬家**。原来入口是快速寻敌（`BeginGame`）两侧那两颗
`PreviousChapter` / `NextChapter` 三角；现在改成地图起始格那颗**章节建筑**，以及它头上那颗
「章节」**气泡**。只做一半就会出现「弹窗没有入口」或「两个入口同时存在」。

#### 一、视图侧：起始格是「章节入口」

| 位置 | 改动 |
| :-- | :-- |
| `TerritoryMapView` 起始格渲染 | `chapterEntry: true` + `interactive: true` |
| `ensureStartView()` | `initialize(layers)`（原来传 `false` = 不可点） |
| `TerritoryStationView.handleClick` | 先判 `chapterEntry` 发 `TerritoryUiEvent.ChapterSelect`，否则走 `STATION_TAP` |
| `ITerritoryStationRender.chapterEntry` | 每帧从内容写（站点节点池化复用，不写会带着上一格的身份） |

- **气泡为什么自动就能点**：`renderLevelBubble` 给气泡节点挂的那颗 Button 用的是
  `visible && content.interactive` —— 与建筑共用同一个 `interactive`。
  所以「包括气泡部分」不需要第二个开关，`interactive: true` 一处就够。
- ⚠️ 章节入口**不能**塞进 `STATION_TAP`：那条链的下游（`onStationClick`）要真站点去算
  `cellId`、播点击反馈、发解锁 intent，起始格 `site === null` 会让整条链空转。
- ⚠️ 只有 `clickable` 但 `site` 为空的组合是**合法**的（就是起始格），别再按
  「`site` 有值才发事件」一刀切 —— 那正是这次改之前点不动的原因。

#### 二、页面侧：三角关闭 + 订阅新入口

| 位置 | 改动 |
| :-- | :-- |
| `MainPage.onLoad` | 两个三角 `active = false`；`EventMgr.on(TerritoryUiEvent.ChapterSelect, this.onOpenChapterSelect, this)` |
| `MainPage.onTerritoryRender` | **删掉** `active = ready` 两行（那正是让三角重新出现的地方） |

- 节点与点击绑定**保留**在 prefab 上（不删 `@property`，否则反序列化会丢掉引用），
  只是永久隐藏；将来要恢复就还那两行。
- 三角与建筑开的是**同一个方法**（`onOpenChapterSelect` → `openChapterSelect` → `ChapterSelectPanel.open`），
  不许各写一套 open，否则两套「当前章 / 完成度」数据迟早不一致。
- `TerritoryUiEvent.ChapterSelect` 定义在 `application/TerritoryEvents.ts`：章节选择不是领地模型的状态
  （不进 `TerritoryModel`、不需要规则），所以走 UI 事件让**页**去开，不给模型加空 intent。

#### 三、判据

`tests/territory-chapter-entry.test.ts`（8 条）：

- 行为（`helpers/territory-station-fixtures` 里真跑视图）：
  ① 章节建筑点了只发 `ChapterSelect`、不发 `STATION_TAP`；
  ② 同一视图改回普通站点后发 `STATION_TAP`（池化复位）；
  ③ `interactive` 同时管住建筑那颗 Button（气泡共用同一字段，源码钉住共用关系）。
- 源码守卫：起始格 `chapterEntry: true` + `interactive: true`、`ensureStartView` 不再传 `false`、
  事件常量不撞名、`MainPage` 订阅且 `onTerritoryRender` 不再动三角、`onStartGame` 仍只发 `focusLevel`。
- `tests/main-quick-find.test.ts`：原来那条「两侧箭头常驻」已按新需求改写为「恒隐藏」。

⚠️ 夹具坑（已修）：`tests/helpers/territory-station-fixtures.ts` 的 `./TerritoryEvents` 桩
原来手抄了一份常量表，停在 `STATION_CLICK` 那一代 —— 真视图发 `STATION_TAP` 时桩里没这个键，
`emit(undefined)` 也算"发了事件"，等于把验收放空。现在改为**真模块**。

### 3.20 「章节选择」一行的排版：选中行的底框是**金边**，不是 `RowBg`（2026-11-03）

用户三条（配当前截图 + 效果图）：

> 1. 「橙色的选中描边是外描边，调小 1 个像素」
> 2. 「代表数字的框要对齐，底框囊括了其他部分在内，不要超出底框范围」
> 3. 「锁的 icon 可以放大 130%，比效果图略大」

三条都落在 `ChapterSelectPanel.prefab` 的行模板上，不涉及脚本（`ChapterSelectItem.render`
只换帧和文字，不碰 transform）。

#### 一、第 2 条的关键：底框到底是哪个节点

直觉上「底框」= `RowBg`（552×140），照这个算，序号块 126 高摆在 140 里还留 7px，怎么都够。
但实测素材后结论相反 —— **选中行真正的外框是那圈金色高亮环**：

| 素材 | art | 可见实体 | 说明 |
| :-- | :-- | :-- | :-- |
| `row_base.png` | 742×221 | art y=1..206 | 底下 15px 是烘焙好的投影 ⇒ 摆进 552×140 的节点后**可见体只有 130 高、视觉中心比节点中心高 4.4** |
| `row_current_ring.png` | 744×233 | 描边 14px，洞 = art x14..729 / y14..207 | 换算到 553×147 的节点上，**洞只有 532×122**，比 `RowBg` 本体还小一圈 |

也就是说：金边会盖掉 `RowBg` 自己那圈深色内边线，还往内啃 ~10px。序号块 / 状态块按
`RowBg` 的 140 去摆，横向就被金边压住（截图上的「数字框顶出底框」）。
**判据要按洞算，不能按 `RowBg` 算。**

#### 二、三条的落地值

| 节点 | 改前 | 改后 | 依据 |
| :-- | :-- | :-- | :-- |
| `CurrentRing` | 554×148 | **553×147** | 外描边整体收 1px |
| `NumBlock` | 98×126 @y=0 | **98×112 @y=3.8** | 塞进洞里，上下各留 ~4.9 |
| `StatusBlock` | 144×126 @y=0 | **144×112 @y=3.8** | 同上；左 5.2 / 右 5.2 留白相等 |
| `LockIcon` | 62×70 @y=0 | **81×91 @y=3.8** | 62×70 × 1.3；与状态块同列必须一起位移 |

- **y=3.8 不是随手取的**：环的洞中心在 art y=110.5、art 中心在 116.5，差 6 art px ×
  (147/233) = 3.8。挂锁、序号块、状态块三块共用这一个值 —— 少写一个就会出现
  「锁飘在状态块下沿」。
- **只压高度、不动宽度**：宽度动了序号字号和「完成度」两行的换行位置都得跟着调；
  98×112 的形变约 5%，肉眼看不出来，超过 10% 木纹就开始糊。
- 效果图里块与底板的留白比 ≈ 92%（83/90）。按洞算出来 112/122 ≈ 92%，对得上；
  按 `RowBg` 算会是 120/130 ≈ 92% 但会被金边吃掉 —— 两个 92% 长一样，必须看洞。

#### 三、判据

`tests/chapter-select.test.ts` 新增「行内区块落在金色描边的洞里、四周留白均匀」：

- 从 `CurrentRing` 的节点尺寸 + 素材里洞的位置**反推**洞的半宽/半高/中心（不硬编码 532×122，
  改环尺寸时自动跟着走）；
- 上下留白 ≥4px 且两侧相差 ≤2px；
- 序号块贴左、状态块贴右，左右留白也要相等（差 2px 肉眼就看得出）；
- 形变 ≤10%、挂锁 = `round(62×1.3) × round(70×1.3)`。

⚠️ 素材尺寸是**判据的一部分**，换 `row_current_ring.png` / `row_base.png` 时必须重算
`RING_ART` 与 y 偏移，否则测试仍绿但画面会歪。

#### 四、第四轮（2026-11-03 提，2026-11-04 实机定稿）：缩到 90% + 上抬到 y=12

需求原文：

> 「章节序号框上移1px，缩小成95%，需要和底框是居中对齐，还有章节名称也需要居中对齐，
> 完成度的整个框也要轻微缩小在底框内」

**为什么 112 高还嫌大**：上面那个「洞 532×122」是**整体等比**换算的结果。引擎实际走
九宫格、`spriteFrame.insetTop/Bottom = 32` 是**按 1:1** 画的，洞的真实可见高度只有
约 112 —— 和序号块一样高。引擎真实渲染的临时实测截图不入库，读数为：

| 量的是什么 | 截图读数 | 结论 |
| :-- | :-- | :-- |
| 金边洞上下内沿 | y=28..151（124px，比例尺 ≈1.107） | 洞 ≈ **112** 设计单位 |
| 绿块 `StatusBlock` | y=28..151 | 与洞**等高** ⇒ 顶天立地、零留白 |
| 木块 `NumBlock` | y≈30..151 | 比洞低 1~2px ⇒ 用户说的「偏下 1px」 |

所以：**不缩就是顶着金边**，「缩到 95%」后才各有 ~7px 余量；**且实际渲染比等比模型
低约 1px**，这才是「上移 1px」的来源 —— 不是模型算错，是模型看不见九宫格的 1:1 边框。

| 节点 | 改前 | 四轮初版 | **最终（2026-11-04 实机定稿）** |
| :-- | :-- | :-- | :-- |
| `NumBlock` | `y=3.8` · `scale=1` · `x=-211.5` | `y=4.8` · `0.95` | **`y=12` · `0.9` · `x=-212`** |
| `StatusBlock` | `y=3.8` · `scale=1` · `x=188.5` | `y=4.8` · `0.95` | **`y=12` · `0.9` · `x=194`** |
| `LockIcon` | `y=3.8` · `scale=1` · `x=188.5` | `y=4.8` | **`y=12` · `x=194`**（只挪不缩） |
| `NameLabel` | `_horizontalAlign=0`（LEFT） | `1`（CENTER） | `1`（CENTER），`y=14.2` |

- `NameLabel` 的标签框本来就居中于两块之间（框心 −23.5 / 空隙心 −23），是**文字**左对齐
  才显得没居中 ⇒ 只翻对齐方式，没动 x。
- `LockIcon` 的两轴都必须跟 `StatusBlock` 一致：**y 同基线、x 同轴线**。它俩同列但互斥显示
  （锁定行藏状态块显示锁），差一点就是「锁飘在状态块下沿 / 偏左」。
  2026-11-04 编辑器里只动了状态块的 y/x，锁没跟上，已补齐。

改完的实际留白（`_lscale` 计入；金边洞按 `RING_ART` 等比换算 = 531×122 @ 中心 3.79）：

| 块 | 渲染尺寸 | 上 / 下留白 | 左 / 右留白 |
| :-- | :-- | :-- | :-- |
| `NumBlock` | 88.2 × 100.8 @y=12 | **2.3 / 18.7** | 9.4 |
| `StatusBlock` | 129.6 × 100.8 @y=12 | **2.3 / 18.7** | 6.7 |

⚠️ **块是刻意偏上的，不是居中**。用户看着实机明暗分界把它抬到了 `y=12`（洞中心 3.8 + 8.2），
上留白只剩 2.3px。所以判据**不再要求上下留白相等**，只要求：

1. 不扎进金边（上下留白都 ≥1）；
2. 不偏到另一侧去（`top < bottom`，反了说明基线该往上调）；
3. 不溢出 `RowBg` 的 140 高节点矩形（±70），否则会压到相邻行。

⚠️ 120 高的洞 + 100.8 的块，理论居中是 `y=3.8`（8.7/8.7）；`y=12` 是**实机目视**结果。
换基线时三块必须一起改，测试常量 `BLOCK_BASELINE_Y` / `BLOCK_SCALE` 也要跟着改。

#### 五、判据（第四轮补充）

`tests/chapter-select.test.ts`：

- **必须把 `_lscale` 算进「渲染尺寸」** —— 原来直接拿 `_contentSize` 比，缩放一改
  测试就看不见了（仍绿但实际上块已经缩了）。新增 `renderedOf()`。
- 上下不再判「留白相等」（块是刻意偏上的），改判「不扎金边 + 不偏到另一侧」。
- 左右容差 `≤3`：0.9 缩放会把原始 x 上那 1.2px 的差放大到 2.7px。
- 新增一条用例锁三件事：两块 `_lscale = 0.9`（且 x/y 等比）、挂锁 `_scale = 1`、
  `NameLabel._horizontalAlign = 1`。

#### 六、⚠️ 编辑器重存会把行模板点亮（2026-11-04 踩到）

在 Cocos 里调这一行时必须先把 `Content/Item` 设成 active 才看得见，调完**忘了关**，
就会留下 `Item._active = true` —— 它是虚拟列表的模板、`Content` 的第一个子节点，
`VirtualScrollView.start()` 摘走它之前会先渲染一帧，表现为**进面板闪一行空白行**。
`tests/chapter-select.test.ts` 的「行模板默认隐藏」就是拦这个的，这次报了红。

同类痕迹：编辑器拖拽会把 `scale` 拖成 `0.898` 这种浮点毛刺，两块本该一样却差 0.2%，
已归一成 `0.9`。**手工调完记得跑一遍 `npx tsx --test tests/chapter-select.test.ts`。**

### 3.21 「战斗宝箱入口」的开启条件：pvp 20001 通关才长出来（2026-11-03）

需求原文：

> 「在功能开启表中补充完整战斗宝箱掉落的开启条件，只有当 pvp 节点 20001 胜利通过后，
> 才展示出战斗宝箱入口 icon，播放 icon 生成的缩放动画」

#### 一、条件写在表里（`open.json` `refId = 701`「战斗掉落宝箱」）

⚠️ **用策划表里本来就有的那一行**（2026-11-03 用户指明「补充到 701 对应行内」）。
当时先临时开过一行 `refId=504`，已撤 —— 表重新导出时多出来的行会被冲掉，而代码会静默变成
「入口永远不显示」（`rowMissing` → fail-closed）。
第二轮又发现只改 json 不改 Excel 是同一个坑的另一种形态：`G-功能开启.xlsx` 的 701 行
条件三格本来是空的，现已补上（`territoryLevel` / `{"resId":20001}` / `通关第20001关后解锁`），
并顺带补了 `name`（`V` 列，原为空）。

| 字段 | 值 | 为什么 |
| :-- | :-- | :-- |
| `name` / `resShowType` | `战斗掉落宝箱` / `[10, 7]` | 策划表原样（货币条口径 = 金币 + 体力），留着备查 |
| `visibleCondition` | `[{ "param": { "resId": 20001 }, "type": "territoryLevel" }]` | 与主界面两侧入口**同一套**判定框架（`MainEntranceVisible`），只是换了个条件类型；⚠️ **不能写成 `battleLevel`** —— 见下 |
| `belond` | `0` | 底部 HUD 的节点，**不是**左右两列活动入口；`collectEntranceItems` 只收 `2 / 3`，`0` 让它只当「条件载体」（同 `refId=13` 聊天入口） |
| `url` / `icon` | 都不填 | 没有对应界面；图标是 prefab 上 `BottomHud/ChestEntry` 自带的 `hud_chest.png`，不按表加载 |
| `type` | `2` | **照抄策划表「界面类型」列**（2 = layer 界面）。客户端不读这个字段（`belond=0` 不进两侧列表），但漏掉它 json 就和表对不上了 |
| `tipShow` | `通关第20001关后解锁` | 策划对表 / 将来做「未解锁提示」用，客户端当前不读 |

⚠️ **四层链路，改哪一层决定了改动活多久**（2026-11-03 一小时内踩过两次）：

| 层 | 文件 | 说明 |
| :-- | :-- | :-- |
| ① 真源 | `doc/塔防数据配置/G-功能开启.xlsx`（第 71 行 = `refId 701`） | **只改这一层才算改表**；列 `I = visibleCondition#type`、`J = visibleCondition#param`、`K = tipShow`、`V = name` |
| ② 中间产物 | `doc/塔防数据配置/json/client/open.json` | `npm run config:export` 从 ① 生成 |
| ③ **压缩产物** | `assets/remoteRef/refSmallAll.json` 里的 `open` | `tools/ref/ref_compress_json.py` 从 ② 生成 —— **运行时读的就是这一份** |
| ④ 死文件 | `assets/remoteRef/open.json` | 历史残留，改它对运行时毫无影响（原因见下） |

⚠️ **运行时只认 ③**：`open` 在 `tools/ref/small.txt` 里是合并表成员，
`RefUtil.loadRefSmallAll()` 把 refSmallAll 里出现的每个表名注册进 `tmMergeRef`；
之后 `getRefAll('open')` 走合并表分支，`getResData` 见到合并表成员**直接返回 `null`**，
`open.json` 连被打开的机会都没有。2026-11-03 实机现象就是
「表读到了、却报 `找不到 refId=701` 的战斗宝箱行」。

只改 ②③④ 不改 ① ⇒ 下次导表条件没了；改了 ①②④ 却不重跑压缩脚本 ⇒ 运行时照样没有。
和「自己另开一行 `refId=504`」是同一个坑的三种形态。用例 `chest-entry-gate` 会同时校验
③ 与 ④ 行数一致、且 ③ 里确有 701。

#### 二、客户端只做三件事

| 位置 | 干什么 |
| :-- | :-- |
| `main/ChestEntryGate.ts` | 纯函数：捞出 `refId=701` 那一行 → 交给 `isEntranceRowVisible` 判 → 给 `{ unlocked, rowMissing }` |
| `main/BattleLevelPassed.ts` | `isLevelPassed` 的**唯一**实现（`CmdBattleLevel.star >= 1`），两侧入口与宝箱入口共用 |
| `main/MainPage.ts` | `onLoad` 里先 `active = false` 再判；解锁才 `active = true` + 播生成动画；`setEventUpdate('CmdBattleLevel')` 让 20001 打完那一刻就长出来，不必等重进主城 |

三条硬口径：

1. **`MainPage` 里不许出现 `20001`**（含代码，注释不算）—— 条件只有表里那一份，
   用例 `chest-entry-gate` 会扫源码。
2. **表缺行 / 整表读失败 ⇒ 不显示**（fail-closed），但 `rowMissing` 单独报出来：
   「没配表」和「条件没满足」混成一个 `false` 之后就没法排障。
3. **庆祝标记必须是 `static`**：主城页每从一局回来都会重建（`start()` 重拉宝箱队列），
   放实例字段则 icon 的「生成」动画每次都重播 —— 那就不叫生成了。

#### 二（补）条件类型是 `territoryLevel`，不是 `battleLevel`（2026-11-03 实机根因）

实机日志：

```
[MainPage] 战斗宝箱入口未解锁: battleLevel(20001) => fail（CmdBattleLevel 里没有 level=20001 这一行）
```

**pvp 据点通关，服务端不写 `CmdBattleLevel`。** 两张表各管一段：

| 条件类型 | 数据源 | 覆盖 |
| :-- | :-- | :-- |
| `battleLevel` | `CmdBattleLevel.star >= 1` | 主线 / 章节关卡 |
| `territoryLevel` | 领地格子 `CmdCityChapterCellInfo.passCells` | 领地据点，含 pvp 异步据点（2000x） |
| `territoryLevelActivated` | 领地格子 `unlockCells ∪ passCells`（+ 本地 `isOwned`） | 同上，但门槛是**激活**（花银币解锁）而不是通关，见 §3.32 |

类型与数据源**必须成对**：`battleLevel` 配据点关卡 = 永远打不开（用例有对照断言）。

判定实现（`MainPage`）：

- 取数靠领地渲染快照 —— `MainPage` 本来就订阅了 `TerritoryViewEvent.Render`，
  顺手存下 `stageByCell`（cellId → 关卡）与 `progress`。
- 判定用领地自己的口径 **`progress.isAreaPassed(cellId)`**：同 `configId` 的格子任一个 owned
  就算整片通关（山猫 2026-10 定的区域口径）。一片战斗区域常横跨好几格，只认其中一格会误判。
- 快照没到（领地还没渲染 / 宿主没挂地图）按「没通过」—— 宁可晚显示，也不在没打过时摆出来。
- 领地每渲染一帧就重算一次 ⇒ pvp 地块打完那一刻 icon 就长出来，不用等重进主城。

排障：`warnChestEntryBlocked` 对 `territoryLevel` 会打印「领地有没有这一关的格子 / 那几格通没通」。

#### 二（补2）四个数量格跟着入口 icon 同进同出（2026-11-03）

需求原文：*「这几个图标是和宝箱 icon 同步展示的，宝箱未解锁时不展示」*

`BottomHud/Cell0..Cell3`（4 个 25×20 的小格，排在 `ChestEntry` 正下方）是**入口 icon 的一部分**，
不是独立 UI —— 只藏 icon 会留下 4 个孤零零的格子。

| 位置 | 干什么 |
| :-- | :-- |
| `MainPage.chestCells()` | 四个格子的**唯一**集合定义；`renderChests` 填色和 `setChestCellsVisible` 显隐都走它，免得将来只改一边 |
| `MainPage.setChestCellsVisible` | 整组 `node.active` 一起开关 |
| `MainPage.onLoad` | 判条件之前先 `false`（`onLoad` 早于首帧渲染，未解锁的号一帧都瞥不见） |
| `MainPage.applyChestEntryGate` | 解锁 ⇒ `true`；未解锁 ⇒ `false`（和 `chestToggle.active` 成对写） |
| `ArenaRoot.prefab` | `Cell0..Cell3` 的 `_active` 默认 `false` —— 与 `ChestEntry` 同一个 fail-closed 口径 |

⚠️ 引用是 Inspector 上的，`chestCells()` 里过滤掉没绑的格子：个别宿主（测试桩）不绑这 4 个引用，
少绑一个不该把整个主城页带崩。

#### 三、生成动画：`0 → 1.15 → 1`

- 时长 `CHEST_ENTRY_POP_SECONDS = 0.34s`，前 **65%** 长到峰值、后 35% 落回（`easeOutCubic`）。
- 峰值 `1.15` 与领地宝箱 `TERRITORY_CHEST_POP_OVERSHOOT` **同一个数**：两处「弹出来」的手感
  必须像一家人，用例会对拍这两个常量。
- 落位即停（`elapsed >= 时长` 直接返回 `1` 并 `unschedule`），不留空转；播到一半被切走时
  `onDisable` 把缩放收干净，别把 0.4 倍留在屏幕上。

#### 四、判据

`tests/chest-entry-gate.test.ts`（11 条）：

- 表：`refId=701`「战斗掉落宝箱」存在、`name` / `resShowType=[10,7]` / `type=2` 与策划表一致、
  条件就是 `territoryLevel(20001)`、`belond=0`、无 `url/icon`、`tipShow` 提到 20001，且 `504` 不许再回来；
  并且它在 `belond=2/3` 的列表里**收不到**；
- 判定：未过 20001 ⇒ 不显示（且不 warn）；过 ⇒ 显示；只过 20000 不算；表缺行 ⇒ 不显示但 warn 到 `refId`；
- 动画：`t=0 → 0`、峰值 1.15 @ 65%、`t≥0.34 → 1`、上升/回落段都单调、峰值常量与领地宝箱一致；
- 接线：`onLoad` 先藏再判、庆祝标记是静态、`CmdBattleLevel` 订阅/退订成对、prefab 上
  `chestToggle` 指向 `BottomHud/ChestEntry` 且 `_active = false`（兜底：任何一步抛错都不会漏出 icon）；
- 数量格：解锁/未解锁两支都写了 `setChestCellsVisible`、格子列表在源码里只出现一次、
  `chestCell0..3` 绑在 `BottomHud/Cell0..Cell3` 上且四格 `_active` 默认都为 `false`。

#### 五、实机结果 + 「假失败」修正（2026-11-03 20:30）

用户实机确认 **icon 已经出现**（打完 pvp 地块后 `godCells` 到位 339 格，重算即解锁）。
但日志里 icon 出现**之前**刷了两行：

```
[MainPage] 战斗宝箱入口未解锁: territoryLevel(20001) => fail（…领地这一章…当前章节 0 格）
```

这两行是假失败，根因值得记一笔：**`stageByCell` 在主城页 `onLoad` 时是「空 Map」而不是 `null`**，
所以走不到「还没渲染过」那条分支，直接落到「这一章没有 `levelId=20001` 的格子」——
一句话把排障方向指到「关卡号配错 / 章节没格子」上去，实际只是数据还没到。
（`onLoad` + 关卡缓存推送各触发一次，所以是两行。）

修正（语义分层，不是简单静音）：

| 层 | 做法 |
| :-- | :-- |
| 纯函数 | `ChestEntryGate.isChestEntryVerdictProvisional(reports, ready)`：只要条件里有 `territoryLevel` 且快照没到位 ⇒ 这条 fail 是「暂缓」 |
| `MainPage` | 打 warn 前先问它；暂缓时只打**一条** `console.log`（`chestEntryWaitingLogged` 静态去重，主城页会重建） |
| `territorySnapshotReady()` | `stageByCell != null && size > 0` —— **空表也算没到** |
| `territoryLevelDetail` | 空表分支改口为「领地格子还没到」，不再说成「这一章没有这关」 |

⚠️ 只有 `territoryLevel` 参与这个「暂缓」判定：`battleLevel` 读的是同步的 `CmdBattleLevel`，
缺行就是硬失败，必须照常 warn —— 否则真配错关卡号时反而查不出来。真失败的 warn 一行没删。

判据加 1 条（`tests/chest-entry-gate.test.ts` 17 条）：暂缓/真失败的分界、`battleLevel` 不受影响、
空 `visibleCondition` 不被吞、`MainPage` 的四处接线（含 `size > 0` 和静态去重标记）都在。

#### 六、⚠️ SVN 合并会把 701 冲掉（2026-11-04 第二次踩到）

现象：合并后进游戏，宝箱入口和四个数量格全不见，日志回到那句
`[ChestEntryGate] open.json 里找不到 refId=701 的战斗宝箱行`。**代码一行没动**，
是 ③ 层数据被合并覆盖回旧版（64 行，701 消失）。

| 层 | 合并后 | 说明 |
| :-- | :-- | :-- |
| ① Excel / ② 中间产物 / ④ `open.json` | **都完好** | 所以「看着没丢」——但 ④ 是死文件，运行时根本不读 |
| ③ `refSmallAll.json` 的 `open` | **被冲回 64 行** | 运行时只认这一份 ⇒ 功能整体消失 |

⚠️ **`refSmallAll.json` 是生成物**（Excel → 中间产物 → `ref_compress_json.py`）。
冲突时**不要挑边**，挑哪边都是错的；正确做法是保留文件结构、重跑压缩把 `open` 重建成最新版：
`tmp/restore_open701_refsmallall.py`（只换 `open` 键，其余 79 张表深比较证明未动；
先验证 `indent=0 + separators=(',',':') + CRLF` 能字节级还原才开始改）。

⚠️ 那句 warn 写的是 `open.json`，容易让人去改死文件 —— 真正该看的是 `refSmallAll.json` 的 `open` 块。

**合并后自检（一条就够）**：`npx tsx --test tests/chest-entry-gate.test.ts`，
里面有「`refSmallAll` 的 `open` 里也要有 701」的守卫，被冲掉会直接报红。

### 3.22 章节通关判据 = 通过最后一个首领关卡；云散不许被换章掐断 + 切章镜头（2026-11-04）

需求两句：

> 「完成章节云层消散的动画没有了，重新找回，并且增加一个章节的切换动画，
> 镜头快速上移，移动到新章节的位置，将新章节居中，玩家只能通过章节按钮播放切换动画，
> 回到已通过的章节」
>
> 「章节通关条件，通过该章节的最后 1 个 boss 关卡，但是不用通过所有的异步据点」

#### 一、通关判据：`chapterFinalBossCell`

| 项 | 口径 |
| :-- | :-- |
| 判据 | `bindTerritoryStages`（只绑 `stage` / `boss`，按 `levelId` 去重）里 **`stage.stage` 最大**的那个首领格；`progress.isAreaPassed(该格)` 为真 ⇒ 整章通关 |
| 排序为什么不用 `levelId` | 它是全局号，同章内不单调（chapter_01 的 `20001` 排在 `10010` 后面）；而线性推进链 `applyTerritoryStageUnlocks` 就是按 `stage.stage` 排的 ⇒ 链尾那一关才是"最后"的那关 |
| 异步据点 | **不参与**。`bindTerritoryStages` 本来就排除 `asyncPvp`；拿打不了的格子当门槛 = 这一章永远通不了、下一章永远锁着 |
| 一章一个可打首领都没有 | `chapterFinalBossCell` 返回 `null` ⇒ **退回旧口径「全部站点占领」**。死锁比漏判严重 |
| 唯一实现 | `model/TerritoryStageBinding.ts` 的纯函数；`TerritoryModel.chapterCompletion()` 拿它覆盖 `complete`，同时把 `occupied/total` 原样留着给 HUD 显示 |
| 弹窗同源 | `ChapterSelectRows.chapterClearedOf`：地图信息带 `finalBossCells`（同 `configId` 的全部格子）就只看那几个格；带不到才退回「占领率 100%」。金牌行因此**可以不是 100%** |

配套：`TERRITORY_TEXTS.requireChapterComplete` 不再报「已占领 x/y」——占领率与通关条件已经不是一回事，
报占领进度会让人以为"再占几格就能进"。现在的文案是「请先通关本章最后一个首领关卡」。

#### 二、云散为什么"没了"（不是被删，是被掐断）

`TerritoryCloudView` 那套「整图打通 ⇒ 拉远 1.1s ⇒ 逐朵淡 2.0s ⇒ 拉回」一直都在。
真因是**通关那一刻 `advanceCompletedChapter()` 立刻 `loadChapter(下一章)`**，而
`TerritoryMapView.syncGrid` 换章第一件事就是 `clouds.reset()` + `restoreChestCamera()` ——
演出起手不到一帧就被清掉。

修法（不动模型时序，改**页面先不画**）：

1. `ITerritoryViewState.chapterCleared` 把「本章已通关」交给地图；
2. `syncClouds` **先** `clouds.setChapterCleared(...)` **再** `sync(...)`：
   - `setChapterCleared` 写的是**状态**（`dismissForced`）而不是一次性动作 —— `sync` 每帧都重算
     "该不该有雾"，判据不成立就按回退复原，只做动作会让雾一闪一闪；
   - 每帧都写（含 `false`）：两章布局键相同时 `syncGrid` 会早退、不 `reset`，粘住的旧标记
     会让新一章的雾一上来就是散的；
   - 这也是新判据的必要条件：老 `isMapCleared` 要求"全部内容格已激活"，通关时还剩异步据点
     / 没打的普通关时它**永远不成立**，只靠它玩家看不到散雾。
3. `MainTerritoryMap.renderAll` 在换章那一帧判 `mapView.chapterClearPlaying`（= `clouds.dismissing`）：
   还在演就 **`chapterSwapPending = true` 并 return**，地图保持旧章不动；`update` 每帧来补，
   演完再 `renderAll()` 换图。`syncGrid` 里的 `clouds.reset()` **不要删** —— 它是对的，
   要解决的是"别在演出中途调它"。

#### 三、切章镜头：四段 1.0 秒

内存里同时只有一张章节图，所以"镜头上移"不能靠两张图真的纵向排布。用
`model/TerritoryChapterSwitch` 的纯曲线 + `TerritoryBattleCover` 那层云拼出来：

| 段 | 时长 | 画面 |
| :-- | :-- | :-- |
| `lead` | **0.1s** | **相机先行**：整张地图快速往下走 25% rise（世界下移 = 镜头上移）。**云还在画面外**（`out(0)` 的 spread + 透明度 0），玩家先看见"画面被带着往上走" |
| `cover` | 0.32s | 云从画面外合拢盖满；相机**保持**在 `lead` 走到的位置（每帧写同一个常量，不再动） |
| `wait` | ≤ 6s | 黑场里换图（模型发命令后自己 `loadChapter`）。云保持合拢但**待机帧继续走**（`stepChapterSwitchCover`），不冻屏 |
| `reveal` | 0.58s | 新章先抬到 `+45% 视口高`，再落回 0（= 居中）；云同时往四周散开 + 逐朵淡出 |

`lead` 是 2026-11-05 用户补的口径：「相机先向上快速移动 0.1s 后，云层遮挡动画再开始播放」。
它必须是**独立的一段**，不能并进 `cover` —— 并进去就变成"云一边合拢、镜头一边慢慢走"，
与"先动完再盖"相反。

| 关键约束 | 为什么 |
| :-- | :-- |
| **模型命令只来自玩家点章节按钮**（2026-11-11 补，见 §3.40） | 模型只在 `switchChapter` / `selectChapter` 里发 `chapterSwitch` 命令；`advanceCompletedChapter`（通关自动推进）**不发**。判据是事件来源，不是"猜这次是不是自动"。🔴 **这不等于「首通自动推进不播切换」**：2026-11-11 起，页面在整章云散演完后按 `{from,to}` **补起同一段转场**（模型命令通道一个字没改），实现「先通过动画、再切换」 |
| 揭幕看 `lastRenderedChapter === to` | 模型在 `loadChapter` 开头就把 `chapterId` 改了，那时地图还是旧的 —— 按 `state.chapterId` 判会在旧图上揭幕 |
| 演不了就**不演** | `beginChapterSwitch()` 返回 `false`（云美术没加载 / 整页过场或推镜过场正在演）时直接换章。宁可没动画，也不要盖一片空底色 |
| `lead` 段云必须完全透明 | 这一段的目的是让位移单独被看见；云只要露一点，就又变回"云和位移同时开始" |
| 合拢段写**常量**位移 | 相机在 `lead` 段就到位了。合拢段若按 `coverProgress` 再插值一次（从 0 起算），画面会**往回弹**一下，读成"走了一下又退回来" |
| 位移只写 `MapLayer` 的 y，且让位 | 它与开箱 / 散场 / 推镜**同一个节点**；`chestCameraActive` 时不写。基点在第一次调用时量一次，换章由 `syncGrid → resetChapterSwitchOffset()` 清空后**重新量**（`MapLayer` 是 ScrollView 的 content，换章会滚到新章的起始格） |
| 输入锁要进 `update` 的排除名单 | `update` 的收尾是"没有镜头动画在播就解锁"，而转场期间 `cameraBusyLocked` 为假 ⇒ 不认 `chapterSwitchActive` 的话，云还盖着玩家就能拖地图 |

#### 四、散雾只给**首次通关**演（2026-11-05 补的口径）

> 「通过该章节的动画只有首次通关章节播放，切换章节后获取到通过状态也不用播放」

`chapterCleared` 是**持久状态**。如果按电平起演，玩家切回一个早就通了的章节、或者存档里就通着的
章节，**进页面第一帧就要演一遍散场** —— 这是错的。所以把它拆成两个字段：

| 字段 | 语义 | 谁判 |
| :-- | :-- | :-- |
| `chapterCleared` | **电平**：这一章通没通（持久） | 决定**要不要散**（散完的终态） |
| `chapterClearPending` | **边沿**：这一拍是不是刚打通（一次性，发出去一拍就消费） | 决定**演不演** |

模型侧：`wasComplete` 是各路径**动手之前**取的通关态（`fastTick` / `slowTick` / `loadChapter` /
`applyPassCellsBro` / 格子信息合并），`noteChapterJustCleared(wasComplete)` 在
`!wasComplete && 现在通了` 时置位，且**必须排在 `emitStateChange()` 之前** —— 状态是随这次广播
发出去的，晚一拍页面就收不到置位。`emitStateChange()` 发完立刻把置位清掉（一次性）。

视图侧：`territoryCloudClearAction(cleared, animate, resolved)` 三选一 ——
`animate` 演完整散场、`instant` 直接收掉、`none` 不动；`resolved` 是"已经在演 / 已经淡完"，
用它做幂等。

三件容易做错的事：

1. **判据不能是"这一拍通没通"，只能是"动手前 vs 动手后"**。战斗回来那条路上，服务端推送常常
   在 `loadChapter` 的合并段就已经把首领格通掉了 —— 那时第一次广播的 `chapterCleared` 就已经是
   `true`。按"上一拍 vs 这一拍"或"进页面第一帧"判，都会把这次首通吞掉（动画再也不播）。
2. **`instant` 只写终态**（`dollyElapsed = -1`、`fillFadeElapsed = -1`、`fillDismissed = true` +
   `applyFillActive()`），与演完之后完全一致 ⇒ 后续每拍 `sync` 都当它收过了，`dismissing` 也立刻
   变 `false`（页面不会白等一个永远不来的演出）。真实云层仍盖着没解锁的格，别顺手清掉。
3. **老判据 `isMapCleared` 保持原样**（"全图都打通了"的另一套庆祝）：进章时若 `chapterCleared`
   为真，`instant` 已经把 `fillDismissed` 落定，`sync` 里那条 `if (!fillDismissed && …) startDismiss()`
   自然被挡住，不会二次开演。

#### 判据

`tests/territory-chapter-switch.test.ts`（19 条：纯曲线 + 触发源 + 四处接线 + 首次通关判据 + 相机先行段）、
`tests/territory-presenter.test.ts` 的「切章命令只发给玩家点的章节按钮」、
`tests/territory-stage-binding.test.ts` 的四条判据用例、`tests/chapter-select.test.ts` 的弹窗同源用例。

> 🔴 **2026-11-11 增补（§3.40）**：SVN 合并后出现「首次通关只剩切换动画、通过动画丢了」。本节四段曲线与**模型命令来源**不变，
> 但「只有玩家点按钮才播切换」这条已被本轮用户口径覆盖 —— 首通自动推进也要播切换，由页面在云散演完后用**同一组曲线**补起。
> 同时 `chapterClearPending` 一次性边沿可能被合并 / 回包时序冲掉，页面加了同章电平兜底。**排查动画丢失时先读 §3.40。**

### 3.23 「章节选择」的完成度 = 已通关格子 / 章节全部格子（2026-11-05）

> 「章节完成度指的是章节内的所有格子已经都是通关状态，计算已通过的格子数和占据总格子数的比例」

弹窗每行右侧那个百分比，公式就一条：

```
完成度 = 处于通关状态的格子数 ÷ 本章全部格子数
```

| 项 | 口径 |
| :-- | :-- |
| 分母 | 地图 `sites[].cellId` —— **章节里所有格子**（普通关 / 首领 / 异步据点 / 资源据点 / 宝箱都算）。格网里的**空格不算**：空格没有"通关"这回事，算进分母 100% 就永远到不了 |
| 分子 | 处于**通关状态**的格子：自己打通了，或同 `configId` 的那片战斗区域里有一格打通（= 地图上格子外观的同一判据 `TerritoryProgress.isAreaPassed`） |
| 100% 的语义 | 章节里每一格都通关 —— 少一个资源据点也是 95%，不四舍五入 |
| 与金牌的关系 | **两回事**。金牌（`cleared`）看「最后一个首领关卡」（§3.22 一），完成度看全格子 ⇒ 金牌行可以不是 100%，100% 也不代表一定发了金牌 |

**为什么分子必须按区域扩散**：一章里大量关卡是「一次占多格」的（chapter_01 有 13 组、
覆盖 69 格，光 `boss 10005` 就占 7 格 192/193/194/212/213/214/233）。打其中任意一格，
地图上那 7 格**全部变成已通关外观**。若完成度只数"服务端记过的那一格"，就会出现
「地图上每一格都显示已通关，完成度却只有六成」—— 这正是本条要修的。

**为什么资源据点不扩散**：`fixedResource` 同样有同 `configId` 多格（chapter_01 的
`fixedResource_173` 占 173/195/174），但它们是**三个独立据点**。扩散组由
`ChapterSelectLoader.buildAreaGroups` 按 `type ∈ {stage, boss, asyncPvp}` + `configId` 是非空
数字串构建，与 `TerritoryProgress.areaPeers` 完全同源 —— 两处口径必须一起改。

判据：`tests/chapter-select.test.ts`（23 条，其中 3 条专守本条：区域扩散、资源据点不扩散、
加载器按真实配表算出的 50% / 75% / 100%）。

### 3.24 「看得见」与「点得动」同源：前置关卡必须**通关**，不是「解锁」（2026-11-06）

用户原话（chapter_02 两张截图）：

> 1. chapter02，boss 关卡的解锁关系没有绑定到 2-9 的关卡中，**提前披露了**；
> 2. **尚未通关就已经显示成已通过的蓝色气泡**，但是其他未通过的关卡显示是正确的。

两条症状各自对应一条**不同**的运行时缺陷（数据侧是好的：七章的 stage/boss 前置一律是
「上一关 + 一个宝箱」，chapter_02 的 `boss_2` 前置就是 `[314(stage_8 = 2-9), 292(fixedResource_9)]`）。

#### 一、揭示门槛漏了「必须通关」

`territoryRevealedCells` 原来把前置满足判成「前置格 ∈ `owned ∪ unlocked`」，
而点击拦截 `checkUnlock` → `prerequisiteBlockers` → `isPrerequisiteComplete` 判的是
**关卡前置必须通关**。两套口径 ⇒ 只要把 2-9 的格子**花银币解锁、一枪不打**，2-10 就露出来了。

修法：揭示侧改问 `TerritoryProgress.isPrerequisiteComplete`（由 `private` 转 `public`），
**唯一一份判据**：

| 前置格是 | 算「完成」的条件 |
| :--- | :--- |
| 关卡 / 首领 / 异步据点 | `isAreaPassed`（同 `configId` 任一格通关即可） |
| 固定资源（宝箱） | **解锁即可**（宝箱不进 `passCells`） |
| 普通地块 / 起点 | `owned` |

⇒ 从此「看得见」= 「点得动」：露出 2-10 的那个时刻，也是它能开战的时刻。

#### 二、`markCellsPassed` 把整批解锁回包记成「通关」

`openRandomResourceCell` 拿到 `unlockCell` 的回包后调
`markCellsUnlocked(...)` + `markCellsPassed(result.unlockedCellIds ?? [cellId])`。
回包的 `cellId` 是**一片区域一起解锁**的整批（实测请求 327 → 回 `[327, 328]`），
于是只要回包里混进一个关卡 / 首领格，那格就变成「已通关」：

- 地块变草地（`isCellPassed` → `isAreaPassed` → `owned`）；
- **编号气泡变蓝**（同一判据）；
- 因为 `owned ⊆ opened ⊆ revealed`，**后继关卡被提前揭示**。

而玩家根本没打过那一关。修法：`markCellsPassed` 按 `randomSites.candidateCells` 白名单过滤 ——
「解锁即通关」这条特例只在随机格成立（服务端在解锁时结算发奖）。
⚠️ 没配 `randomSites` 的老地图白名单为空 ⇒ 不过滤，别把整章随机格搞失效。

> 已经写进存档 / 服务端的历史脏数据不会自动消失：气泡仍是蓝的。核对办法是看
> `passCells` 里有没有那一格 —— 没有就是脏数据，清掉该章本地存档（或等服端快照覆盖）即可。

#### 三、判据

`tests/territory-cell-reveal.test.ts` 新增 3 条：

- 「前置关卡只解锁没通关时，后继关卡（首领）不许提前揭示」——解锁 2-9 ⇒ 2-10 不露；打完 ⇒ 露；
- 「`markCellsPassed` 只把随机候选格记成通关，关卡 / 首领格一律不认」；
- 「没配 `randomSites` 的老地图：`markCellsPassed` 保持原样全收（兼容）」。

### 3.25 `chapter_03` 从 160 格铺到 300 格：+70 个固定资源 / +70 个随机格（2026-11-06）

用户原话：

> 使用章节地图编辑器，给 chapter03 增加 70 个固定格子，以及 70 个随机格子，
> 不能改变顺序逻辑，可以填充形状的空白处。

#### 一、为什么只能"往外长"

`gen_territory_shapes.py` 的涂色配额是**算满**的：

| 组成 | 格数 |
| :--- | ---: |
| 10 个链点（8 关 + 2 首领） | 44 |
| 3 个异步据点 × 4 | 12 |
| `fixedResource`（含 9 道门） | 51 |
| `randomSites.candidateCells` | 52 |
| 出生点 | 1 |
| **合计（= `TARGET_PAINTED`）** | **160** |

也就是说这 160 格里**一格空位都没有**，用户说的"形状的空白处"只能是剪影外面那 240 格。

#### 二、第二版：先定**剖面**再塞格子（第一版是均匀外扩，被否了）

第一版实现成「从现有涂色区一圈一圈均匀外扩」，出来的东西在第 0~6 行和第 16~19 行是齐平的
—— **整团是个圆角矩形**。用户看图后：

> 调整随机格的位置，让图形更对称，贴近飞机的形状

并附了张红笔描后掠翼飞机的截图（机头在顶部中线收尖、翼尖顶到左右边缘、尾巴在底部收窄）。

现在的口径反过来：**先写一个后掠翼剖面，再把新增的 140 格填进剖面剩下的空位**。
剖面用「每行左边缩进 `L(r)`、区间 `[L, 19−L]`」表达（左右天然对称）：

| 行 | 缩进 | 宽度 | 含义 |
| ---: | ---: | ---: | :--- |
| 0 | 8 | 4 | 机头收尖 |
| 1~7 | 7 → 1 | 6 → 18 | 前缘后掠（每行各扩 2 格，≈45°） |
| 8~15 | 0 | 20 | 主翼满幅 |
| 16~19 | 2, 3, 4, 5 | 16, 14, 12, 10 | 尾巴收窄 |

`Σ L = 50` ⇒ 剖面 = `400 − 2×50 = 300` 格 = 160（现有）+ **140（新增）**，
且脚本里**断言**了「现有 160 格 + 66 个不可动格（链点 44 + 异步 12 + 9 道门 + 起点）全在剖面内」，
所以「剖面 − 现有」正好 140 格，70 宝箱 + 70 随机格一格不多一格不少。

**为什么第 8~15 行必须满幅**：左右翼尖是**链上的固定站点** —— `asyncPvp_2` 在
(13,1)(14,0)(14,1)(15,0)、`asyncPvp_1` 在 (13,19)(14,17~19)、`asyncPvp_3` 在
(10,18)(10,19)(11,18)(11,19)。要左右对称就得两边都够到边缘，中间这几行只能是满幅。
这 6 行 = 120 格是剖面的硬底座，也决定了「300 格不可能是一架纤细飞机」——
机头能收到 4 格，尾巴最窄只能到 10 格。

改完逐行体检：`min(cols) + max(cols) == 19` 对**每一行都成立**（20 行全过），
即每行都是绕 `u = 9.5` 的中轴区间。

#### 三、`chapter_03` 现在的量（其余六章不变）

| 项 | 改前 | 改后 |
| :--- | ---: | ---: |
| 涂色格 | 160 / 400（40%） | **300 / 400（75%）** |
| `fixedResource` | 51（`_1`~`_51`） | **121**（新增 `_52`~`_121`） |
| `randomSites.candidateCells` | 52 | **122** |
| `randomSites.buildingIds` | 44 | **104** |
| `stage` / `boss` / `asyncPvp` | 8 / 2 / 3 | **一格没动** |

新增的 70 个宝箱与既有的同构：`rewardId 1014`、`configId fixedResource_<cellId>`、
`buildingId ""`、`silverCost 15 / exploreSeconds 1 / staminaCost 1`。

#### 四、"不能改变顺序逻辑"落在哪三条

1. 既有 64 个站点的 `cellId` / `footprint` / `unlock.requiredCells` **一个字节都不改**
   （核对方式：改后 `sites[:64]` 与原档 `deepEqual`）；
2. 9 道门（`fixedResource_1..9`，夹在相邻链点之间）不挪、不改前置；
3. 新增只**追加在 `sites` 末尾** —— 运行时靠这个顺序喂 `stageById` 和"书写顺序"的提示文案。

新增宝箱的前置照抄既有 51 个的口径：**只从 19 个上游锚点里挑**（10 个链点 + 9 道门），
取 `hex_distance` 最近的那个。既不会自指、不会成环，也不会把 70 个新格串成一条
"宝箱挂宝箱"的依赖链（那样每开一格都要先开上一格，15 银币 × 70 层）。

#### 五、随机格与建筑

`candidateCells` 追加 70 格（全落在剖面内）、原 52 格原样保留；`buildingIds` 按既有比例
（`44 / 52 ≈ 85%`）给新格补 60 个，池子仍是 `69008-69015` —— 新旧格摆在一张图上看不出批次。
`triggerSilver / rewardPoolId / maxActive` 三个字段没动。
哪 70 格当宝箱是**固定种子抽样**（不是「排序后一隔一」——那会排成规整横条，看着像贴图）。

#### 六、随机格再重排：绕中轴左右对称 / 中间不扎堆 / 按行定额（同日晚些，第三版）

用户第三次（截图红框圈住中间两列）：

> 做到基于这两列去做左右侧的水平对称（尽可能，且只是随机格，中间不要这么多随机格，
> 随机格的分布更均匀一点

红框那两列就是中轴（`col 9 / col 10`，跨在 `u = 9.5` 上）。

**先说清楚"只动随机格"为什么做不到**：一格要么是站点 footprint、要么是
`candidateCells`，两者互斥而并集必须还是那 300 格。所以「把中间的随机格撤掉」= 那些格子
必须由宝箱顶上 —— 随机格和宝箱是互补的两堆。于是第三版动的是**归属**，不是形状：

| 不动 | 动 |
| :--- | :--- |
| 300 格的剖面（一格不差，脚本里有断言） | 234 个可分配格里谁是宝箱、谁是随机格 |
| 链点 / 首领 / 异步据点 / 9 道门 / 起点（66 格） | 112 个宝箱格与 122 个随机格的位置 |
| 站点数与 `id` 顺序、`rewardId`（`1014:118 / 1011:3`） | 每个宝箱的 `cellId` / `configId` / `requiredCells` |

改前中间两列有 **20 个随机格**（其中 18 个是生成器原来发的，只有 2 个是我上一版加的），
改后是 **0 个**。

口径三条：

1. **对称**：镜像对 `(r, 9−k) ↔ (r, 10+k)`，一对要么都是随机格、要么都是宝箱 ——
   否则一侧就破了。⚠️ 六边形是 odd-q 错排（`v = r + 0.5×(col&1)`），跨中轴的镜像天然
   **差半行**，所以是"每一行各自左右对称"，不是"上下也对称"；这是格子性质，不是没做。
2. **中间不扎堆**：`k = 0`（那两列）一律给宝箱。
3. **均匀 = 每行密度一致**（不是"格子间隔一致"）：按 `每行可选格数 × 122 / 212` 用最大余数法
   分名额，行内再用分层抽样取下标，把它们摊开。

踩过的两个坑（都在 `symmetrize_chapter03.py` 的注释里）：

- 先做过「全局最远点插入」，结果第 17 行被补到 **11/14（79%）**、第 0~3 行一个没有 ——
  均匀的度量选错了；
- 补名额时按固定的"余数最大"顺序表加，同一行会被一路加到爆（第 11 行 6 → 11，密度 100%）——
  必须每轮重算谁最缺。

改完每行密度 50%~58%（首尾两行例外：机头只有 3 格可选、尾巴 10 格），
`min(cols)+max(cols)` 与镜像检查逐行通过。

#### 七、发布与回滚

```bash
python tools/map-editor/fill_chapter03_cells.py --dry-run   # ASCII 预览 + 统计，不写盘
python tools/map-editor/fill_chapter03_cells.py             # 改预设 + 发布 2 处
```

写盘落点与其他章一致：预设 → `assets/resources/config/territory-maps/`（带 `.meta`，uuid 不动）
→ 策划 `json/sever`。`remoteRef` 不保留章节布局（地图不写策划 client，不会被扫进去）。
改前备份在 `tools/map-editor/backups/chapter_03.pre-fill140-20261106.*`。

🔴 **别对 `chapter_03` 跑 `gen_territory_shapes.py --only 03`**：它从图形重新生成，
会把 121 + 122 覆盖回 51 + 52，140 格的补丁全丢。

### 3.26 七章奖励 id 按章递增：固定格 `1015+章序` / 随机池 `2001+章序`（2026-11-06）

原话：「chapter01 固定格的奖励id从1014改成1016　随机格改为2002　后续02章节到07章节也改成对应章节的奖励id」。

| | 规则 | ch01 | ch02 | ch03 | ch04 | ch05 | ch06 | ch07 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fixedResource.rewardId` | `1015 + 章序` | 1016 | 1017 | 1018 | 1019 | 1020 | 1021 | 1022 |
| `randomSites.rewardPoolId` | `2001 + 章序` | 2002 | 2003 | 2004 | 2005 | 2006 | 2007 | 2008 |

**口径三问（都已确认）**：

1. **固定格按章递增**，不是七章共用 1016 —— 但不新增奖励表行就等于给空奖励，见下方红字。
2. **`chapter_01` 整章统一**：不只换 `1014`，连 `1015×5`、`1011×3`、`1001×1` 一起覆盖成 `1016`（含已是 1016 的 `fixedResource_1/_3`）。
   `chapter_02` 那 2 个原本没写 `rewardId` 的（`fixedResource_103/_104`，`cellId` 368/370）也一并补成 `1017`。
3. **9 道门（`fixedResource_1..9`）也统一**：它们是同类型的 `fixedResource`、也带 `rewardId`（`chapter_03` 的门 9 原来是 `1011`）。

**只动两个字段**。脚本 `tools/map-editor/retarget_chapter_rewards.py` 对「把这两个字段还原回去后
整份 JSON 必须与改前完全相等」有硬断言 —— 站点数 / `id` 顺序 / `cellId` / `footprint` / `unlock` /
`candidateCells` / `buildingIds` / `triggerSilver` / `maxActive` 一格都没动，脚本可重复跑。

```bash
python tools/map-editor/retarget_chapter_rewards.py --dry-run   # 打前后分布 + 待补奖励行清单
python tools/map-editor/retarget_chapter_rewards.py             # 改预设 + 发布 4 处
```

改前备份：`tools/map-editor/backups/chapter_0{1..7}.pre-retarget-20261106.preset.json`。

🔴 **奖励表缺 13 行，策划补齐并导表之前这七章是空奖励**：
`levelMapGrideReward` 现在只有 `1001~1016` 与 `2001` 有 `rewardGroup`；`2002` 有一行但是空壳
（`{"rewardId": 2002}`，没有 `rewardGroup` 键），`1017~1022` / `2003~2008` **整行不存在**。

⚠️ **顺序**：`gen_territory_shapes.py`（门写 `1011`、池写 `2001`）和 `fill_chapter03_cells.py`
（宝箱写 `1014`）里都是**占位值**。任何时候重跑它们，都必须再跑一次 `retarget_chapter_rewards.py`，
否则奖励 id 会静默退回占位值。

### 3.27 提前披露（预告）与建筑虚影（2026-11-09）

用户口径：「默认提前展示关卡 10001 所在的地块 → 通过第一关后提前展示 boss 关卡建筑 →
通过 boss 后提前披露第 2 个 boss 的位置；**提前展示不改变消耗银币激活地块的逻辑**」。

**披露序列 = `[本章第 1 关] + [本章每个首领]`，链式触发**（`model/TerritoryPreview.ts`）：

| 目标 | 触发条件 |
| --- | --- |
| 第 1 关 | 开局恒披露（前一项是出生点） |
| 首领 1 | 第 1 关已通过 |
| 首领 2 | 首领 1 已通过 |

任一时刻最多 **1 个**目标处于「未通过、被披露」状态。「已通过」走 `isAreaPassed`
（同 `configId` 任一格 owned），与显示侧 / 点击拦截同源。披露范围是**整关 footprint**
（用户：「不然大建筑会有错位」——`chapter_02` 起一关就是一个带 5~10 格 footprint 的站点）。

**三态与虚影的组合**（虚影不是第四种状态，锁 / 价格 / 编号全部照旧）：

| 状态 | 地块 | 锁 | 价格 | 虚影 |
| --- | --- | --- | --- | --- |
| 未解锁（前置没满足） | ✔ | ✔ | ✘（`locked` 时被摘掉） | ✔ 35% |
| 可激活（前置满足、没花钱） | ✔ | ✘ | ✔ | ✔ 35%（**被价格压住**） |
| 已激活（花了银币） | ✔ | ✘ | ✘ | ✘（换实心建筑，0.2s 淡出） |

**层序：气泡 > 锁 > 价格 > 虚影 > 建筑**（2026-11-09 二轮定前四层；2026-11-10 追加「气泡 > 锁」）。`MapLayer` 子节点顺序即渲染序，
虚影层（`StationGhostLayer`）运行时建、插在 `StationCaptionLayer` **之前**
（`… → StationIconLayer → **StationGhostLayer** → StationCaptionLayer → StationTextLayer → StationBadgeLayer → HexLockLayer → StationHitLayer`），
所以：建筑在最底、虚影 35% 压住建筑、银币图标与数字压在虚影上、锁压在价格上、关卡编号气泡再**压住锁**。

⚠️ 第一版是「锁 > 虚影 > 价格」（虚影插在 `StationBadgeLayer` 之前），实机看图后用户改成现在这版：
「银币 icon + 数字 UI 的层级也是高于建筑的」—— 数字被 35% 的虚影染成一块，读不出这一格要花多少钱。

⚠️ 2026-11-10 用户追加：「**锁的 UI 层级要在宝箱气泡 UI 的下层**」—— 锁标层锚点从 `StationHitLayer`
前挪到 `StationBadgeLayer` 前，于是顺序变成「气泡 > 锁 > 价格」。**不能**顺势挪到价格层之前：
§3.31 那 1s 过渡的前半段就是靠「锁盖住还没长好的价格」才不穿帮，锁一旦掉到价格底下，
过渡会先露出半大的银币再被锁盖住，视觉上等于闪一下。守卫用例在 `tests/territory-cell-center-align.test.ts`
（`★★★锁标层插在气泡层之前（气泡压住锁），且仍在价格层之上`）。

🔴 **绝不能放宽 `isPrerequisiteComplete`**。2026-11-06 刚修过一个同源的 bug
（「花钱解锁 2-9、没打，2-10 就露出来了」），守卫用例在
`tests/territory-cell-reveal.test.ts`。披露走的是**并行的可选入参**：
`territoryRevealedCells(map, progress, previewCells?)` —— 不传时逐格与旧版相同。
`previewCells` 由 `ITerritoryViewState` 透到渲染输入，**不进任何扣费 / 解锁判据**。
披露的格因此**看得见、点得动（会弹前置未满足）、但开不了**，与「不改变激活逻辑」一致。

**虚影怎么画**：复用 `TerritoryStationView`（`instantiate` 站点 prefab）而不是直接摆 Sprite
—— 落点 / 可见宽度归一 / trim 偏移补偿 / 底边对齐全走同一套 `setMapPosition` + `render`，
虚影与实心建筑才会逐像素重合。只 `Icon` 进虚影层，底条 / 文字 / 角标 / **带 `cc.Button` 的
命中根节点**全部塞进一个 `active = false` 的壳里（`StationGhostShell/Shell`）⇒ 不吃点击。

**只在带 `buildingId` 的那一格画**：一关占 2~11 格，但 `stationIconOf` 对没配 `buildingId`
的 stage/boss 返回 `null`（2026-10-16 口径），所以整关只有一格有建筑、也只有一格有虚影。
`chapter_01` 的第 1 关是特例：可激活的 `327` 没有建筑，有建筑的 `328` 被两个宝箱锁着 ——
开局呈现为「一块空地（`327`，按 §3.28 不再标价）+ 一个被锁住的虚影（`328`）」。`328` 这一格
在未解锁时按现行口径只显示价格、不长建筑（虚影补上了「这格是关卡」的读法）。

**0.2s 淡入**：虚影 0.35 → 0 与底下实心建筑 0 → 1 同时走（后者是 `hexSpawn` 的生成淡入），
合成出来就是 35% → 100%。与全工程一致**不建 tween**，在 `update` 里扣时间
（`stepGhostFade`，扣到 0 销毁）。换章整批清空（`ghostKey` 变即 `clearGhosts`）。

判据：`tests/territory-preview.test.ts`（序列 / 链式 / 整关 footprint / 披露≠能开 / 揭示函数
不传时不变 / 只画带建筑未激活的格 / 0.2s 淡出 / 换章清空）
+ `tests/territory-cell-center-align.test.ts`（四处 `cellCenter`、虚影层插位）。

### 3.28 一个节点只在一块地上长 UI：同节点的非建筑格不画任何东西（2026-11-09）

> 用户原话：「关卡或者 boss 关卡，或者 pvp 据点，**置于建筑地块上**展示具体的 UI，
> 其他**同一节点**的地块不展示任何 UI。」

**现象**：`chapter_01` 的一关不是「一个站点带一整块 footprint」，而是**多个单格站点共用
同一个 `configId`**（`10001` = `327` 无建筑 + `328` 建筑 69004，两格各 30 银币）。于是同一片
地块上出现「一个建筑 + 一圈银币数字」，读起来像「这一关要买三次」——截图里 `30` / `15` 混排
就是这么来的。

**口径**：节点 = **同 `configId` 的战斗站点组**（`stage` / `boss` / `asyncPvp`）。组内只有
**配了 `buildingId`** 的那一格承载 UI，其余格（`cellId` / `footprint`）什么都不画。

| 格 | 未解锁 | 已解锁 |
| :--- | :--- | :--- |
| **建筑格** | 银币 + 价格（不长建筑，§3.27 的虚影补「这格是关卡」） | 建筑 + 编号气泡 |
| **同节点其它格** | **纯空地** | **纯空地** |

> 🔴 2026-11-10 用户再次确认，并收回了 2026-11-09 第四 / 五轮的两次放宽
> （「解锁后兄弟格还是要显示银币 icon 和数量」、「兄弟格跟 30 样式一样」）：
> 「和 boss 关卡是同一个节点的地块都不显示 UI，只有建筑虚影上显示 UI
> （锁住的 icon 或者是银币 icon + 数字）」。
> 截图是 `10010` 首领：11 格里 10 格空地被挂满了红色 `35`，其中一把锁在 `105` 上 ——
> 现在那 10 格一律纯空地，`35` 只在承载格出现（四种状态见 §3.31）。
> ⚠️ 代码侧的关键是 `stationRenderOf` 的 muted 分支**不许带 `isOpened` 条件**，
> 一带就会退化成「未解锁时兄弟格也挂价格」。

**七章分布**：只有 `chapter_01` 命中 —— 13 个关卡组、69 格里有 **56 格没建筑**；
`chapter_02~07` 一个站点就是整块 footprint，非锚点格根本不是站点，本来就什么都不画。

**实现**：`model/TerritoryNodeUI.ts` 的 `territoryNodeMutedCells(sites)` 算出该隐的 `cellId`
集合（零 `cc` 纯函数），`syncStations` 每轮算一次、作为 `stationRenderOf` 的**第 4 个可选参数**
透下去；缺省是空集合 ⇒ 老调用方与沙箱测试逐格不变。命中时 `stationRenderOf` 直接返回
`{ icon: null, caption: '', badge: '', interactive: !pending }` —— 价格 / 编号 / 建筑三者一起摘，
`interactive` **原样保留**。

🔴 **隐的是 UI，不是格子**：用户 2026-11-09 明确「保留可点，照常解锁」。所以这个集合
**只能**喂给画法分支，不许拿去过滤 `revealedCells` / `siteOpenableCells` / 扣费判据 ——
否则这 56 格永远激活不了。消耗数字由点击后的确认弹窗承担。

🔴 **锁**：节点内的**非建筑格不画锁**，整组收敛成建筑格上的一把（用户 2026-11-09 第二轮
「锁的 UI 也是只显示 1 个，在建筑格子上即可」）。判据在 `territoryNodeLockCells`，见 §3.29。

**边界（都有用例）**：
- 组内**一格建筑都没有** ⇒ 一格都不隐（隐了整关凭空消失）；
- 组内**每格都有建筑** ⇒ 不隐（各自承载自己的 UI）；
- 没有 `configId` 的站点不参与分组（宁可不隐，别乱隐）；
- `fixedResource` / `bonus` 即使共用 `configId` 也不参与（它们不是「节点」）；
- 兄弟站的 footprint 万一压到承载格上 ⇒ 承载格保住 UI。

判据：`tests/territory-node-ui.test.ts`（真实 `chapter_01` 56 格 / `chapter_02~07` 零命中 /
四条边界 / 沙箱跑 `syncStations` 验「兄弟格无价格无气泡无建筑但仍可点」/ 不传参行为不变）。

### 3.29 一个节点一把锁 + 「预告首领关」过场（2026-11-09 第二轮）

> 用户原话：「1. 锁的 UI 也是只显示 1 个，在建筑格子上即可；
> 2. 预告 boss 关卡有预告动画 —— 2.1 通过第 1 关的地块动画结束后，镜头移动到 boss 位置、
> 屏幕居中；2.2 云层消失动画、boss 关卡地块生成动画、建筑虚影和锁**同时**生成动画，
> 动画结束停留 1s，镜头自动挪回初始位置。」

#### ① 锁：一个节点一把，画在建筑格

> 2026-11-10 细化成「一处 UI、锁与银币二选一」，见 §3.31（本节的收敛口径不变，落点判据更严）。

模型给的 `lockBlockedCells` 是**逐格**的（`chapter_01` 的 `10005` 首领 = 7 个单格站点，
于是截图里 7 把锁）。`territoryNodeLockCells(sites, lockedCells)` 把它收敛成
「节点内任一格被卡住 ⇒ 锁画在**承载格**（配了建筑的那格）上」，非节点格（随机资源格 / 宝箱）
原样透传。

- 承载格的口径来自 `territoryNodeCarrierByCell`：同 `configId` 组内有建筑格 ⇒ 整组（含各自
  `footprint`）都指向它；一个建筑都没有 ⇒ 指向自己的 `cellId`（`chapter_02` 起的一台站
  footprint 因此收敛到锚点，也是「一把锁」）。
- `paintHexes` 与 `syncStations` **必须同源**调它：前者画锁，后者据此摘掉价格 ——
  两个地方各算一份就会出现「锁在这格、价格在那格」。

#### ② 过场：四段 + 一个「先压住」

时间轴在 `model/TerritoryPreviewCinema.ts`（纯函数）：

| 段 | 时长 | `focus` | 干什么 |
| :--- | :--- | :--- | :--- |
| `wait` | 动态 | 0 | 等**第 1 关那一批**胜利地块长完（`territoryHexSpawnBatchSeconds(victoryClaimCells, 胜利档)`） |
| `pan` | 0.55s | 0 → 1 | 镜头推到首领建筑格、屏幕居中 |
| `reveal` | 0.6s | 1 | **放开被压住的格** ⇒ 云散 / 地块生成 / 虚影淡入 + 锁弹跳同时起手 |
| `hold` | 1.0s | 1 | 需求「停留 1s」 |
| `back` | 0.55s | 1 → 0 | 镜头自动归位 |

🔴 **关键是「先压住」**：披露是模型算的，它一旦把首领格并进 `revealedCells`，云会在同一帧散完、
地块也在同一帧长完 —— 镜头还在原位，玩家只看到一块静态地形。所以视图在 `wait` / `pan`
期间把这批格同时从 `revealedCells` 与 `previewCells` 里剔掉（`holdPreviewCinemaCells`）：
云照旧盖着、虚影也不建；`reveal` 段一到清空压住集合并**就地重渲染一帧**
（`rerenderForPreviewCinema`），五套原有表现自己就同时开演了 —— 过场**不重复实现**任何动画。

- 起演条件四条（`armPreviewCinema`）：这一帧新披露了格子 + 新披露里有**首领** +
  这一帧有 `victoryClaimCells`（= 刚打完一关）+ 不是首帧（`spawnBootstrapped`）。
  第三条是"通过第 1 关"的判据，第四条防止重进页面把过场再播一遍。
- 镜头复用 `captureChestCamera` + `applyChestCamera(1, focus, point)`（与开箱 / 推镜 / 过场
  同一套基准）；`cameraBusyLocked` 必须把它算进去，否则第一帧就被 `restoreChestCamera` 按回去。
- 虚影淡入（0 → 35%）与锁弹跳（0.55 → 1.12 → 1，0.2s）只在**过场放开的那一帧**生效
  （`previewCinemaRevealPending` 一次性开关），其它时机仍是"直接 35% / 直接出现"。
- 换章（`syncGrid` 重建格子）必须 `cancelPreviewCinema()`：压住集合不清，新章头几格会永久不出现。

判据：`tests/territory-preview-cinema.test.ts`（段序 / 时长 / focus 单调 / 大帧跨段 /
起演四条 / 压住哪些格 / 放开即重渲染 / 收尾清空 / 换章作废）。

### 3.30 锁 = 「前置没完成」；红字只留给缺钱（2026-11-09 第三轮）

> 用户原话（配图紫框圈住一格「银币 + 红色 15」）：「前置地块未解锁，展示的也是锁 icon，
> 不是银币 + 显示红色的 UI。」

#### 现象与根因

截图里那一格画的是**银币图标 + 红色 15**，既没有锁，也不是缺钱（钱包 350，单价 15）。
它是**前置宝箱解锁了却没点开**的一种：

- `TerritoryProgress.isPrerequisiteComplete` 对 `fixedResource` 有个特例 ——
  「`unlockable`（服务端 `unlockCells` 里有）即算完成」，因为服务端把宝箱的 completed
  记在 `unlockCells` 而不是 `passCells`。
- 于是这种格**不进** `prerequisiteBlockers` ⇒ **不画锁**；
- 而 `stationRenderOf` 里还有一条旧口径（山猫 2026-10-21）「前置宝箱未领取 ⇒ 银币数字染红」
  ⇒ 画面上只剩一条**没有锁的红价格**，玩家读成"钱不够"。

#### 现在的口径

| 状态 | 画什么 | 判据 |
| :--- | :--- | :--- |
| 前置关卡没打通 / 前置格还没开 | **锁**（价格整条摘掉） | `prerequisiteBlockers` 非空 |
| 前置宝箱解锁了没点开 | **锁**（价格整条摘掉） | `unclaimedFixedPrerequisites` 非空 |
| 随机格四周没有已开格 | **锁** | `canOpenTerritoryRandomCell` = `needsNeighbor` |
| 银币不够 | 价格数字**红**，不上锁 | `territoryCostShortfall.silver` |
| 体力不够 | 体力那颗数字红，银币**不红**、不上锁 | `territoryCostShortfall.stamina` |

实现：

- `TerritoryProgress.isPrerequisitePending(cellId)` = 上面两行前置判据的并集，**唯一入口**。
- `TerritoryModel` 只算一遍 `prereqPending` 集合，**同时**喂两个集合：
  `siteOpenableCells`（排除）与 `lockBlockedCells`（纳入）⇒ 两者天然互补，
  不会再出现「这格能开却顶着锁」。
- `TerritoryMapView.stationRenderOf` 删掉 `unclaimedFixedPrereq` 那条红字分支 ——
  这一种已经由模型侧上锁（`syncStations` 的 `locked` 会把 `isCondition` 置 false，
  `captionSprite` / `captionLabel` 两个节点一起关掉）。
- ⚠️ **只改画法，不拦点击**：这一种在服务端是允许解锁的（`checkUnlock` 过），
  锁只是「先把旁边那只宝箱点了」的提示，点下去照常扣银币解锁（同 §3.28 的「保留可点」）。

判据：`tests/territory-presenter.test.ts` 的两条守卫（缺钱不上锁 / 能开的格不许上锁）+
新增「unlocked-but-unclaimed chest prerequisite locks the successor instead of reddening the price」；
`tests/territory-random-resource-render.test.ts` 里那条旧断言已翻面（红 → 白）。

### 3.31 「未解锁 → 可激活」的 1s 过渡（2026-11-09 第四轮）

> 用户原话：「增加一个未解锁过渡到可激活的动画 1.锁放大1.2，再缩小消失，动画总时间1s
> 2.银币和数字UI生成动画，总时间1s」

#### 触发条件：**锁消失的那一刻**，不是「解锁成功」

| 事件 | 画面 | 播过渡吗 |
| :--- | :--- | :--- |
| 前置满足（隔壁格激活 / 宝箱点了） | 锁消失 + 价格出现 | **播**（需求说的就是这一步） |
| 点价格花钱激活 | 锁早就没了，价格消失、建筑长出来 | 不播（走的是地块生成 + 建筑抖动那条链） |
| 服务端直接把这格标成已解锁 | 既没锁也没价 | 不播（`isCondition` 为假，没有价可长） |

判据三条缺一不可：① 这一帧锁刚被摘掉；② 价格真的出现了（`isCondition`）；③ 站点视图已存在。

#### 两条曲线（`model/TerritoryUnlockTransition`，纯函数）

| 目标 | 0s | 峰值 | 落点 | 关键帧 |
| :-- | :-- | :-- | :-- | :-- |
| 锁的 `scale` | 1 | **1.2** @ 0.35s（`easeOutCubic`） | 0 @ 1s（`easeInCubic`，越缩越快） | 放大要快、消失要拖 |
| 价格的系数 | **0** | **1.15** @ 0.55s | 1 @ 1s | 系数乘在 `1.1 / 1.5` 两个基准上 |

🔴 **两段同时起手、同时收工**（各 1s，不是首尾相接的 2s）。锁层（`HexLockLayer`，插在 `StationBadgeLayer` 之前）压在价格层
（`StationCaptionLayer`）上面，所以前半段是「锁挡住价格」、后半段是「锁缩没了、价格已经长好」，
天然衔接；把价格延后 0.5s 会让总时长变成 2s，违背用户口径。

🔴 **用缩放，不用透明度**：价格那两颗节点（`CaptionBg` / `CaptionLabel`）的**位置**是按实测文本宽
算出来的（`applyCaptionPlacement`），改透明度只会淡入、读不出"生成"；而且半透明的语义已经被
`setSpawnOpacity`（"地块还在长"）占用了。

#### 实现（四个写点，别散在别处）

| 位置 | 干什么 |
| :-- | :-- |
| `TerritoryMapView.applyHexLock` | 锁显隐的**唯一交汇点**：上一帧 `active`、这一帧摘掉 ⇒ 记进 `lockVanishedCells`；过渡在播时**不许**把锁关掉 |
| `TerritoryMapView.startUnlockTransitionIfNeeded`（`syncStations` 里两条路各调一次） | 消费票据 ⇒ `unlockTransitions.set(cellId, 0)`；先 `lockPops.delete` 让位（抢同一颗节点的 `scale`） |
| `TerritoryMapView.stepUnlockTransitions`（`update` 里，排在 `stepLockPops` 之后） | 推进秒表，写锁的缩放；收尾那一帧先把 `scale` 复位成 1 **再**关节点 |
| `TerritoryStationView.setConditionSpawnScale` | 乘在 `CONDITION_ICON_SCALE / CONDITION_VALUE_SCALE` 上（**唯一**缩放写入口是 `applyCaptionPlacement`） |

服务细节：

- 起播必须排在 `view.render(content)` **之前** —— 视图先把系数记下来，随后那次
  `applyCaptionPlacement` 才按它摆，否则第一帧是全尺寸闪一下再缩回去。
- 位置**不跟着缩**：两颗各自绕中心长大，合起来读作"整条价格从中间长出来"；按缩放后的宽度
  重排位置反而会让它在放大时左右乱窜。
- 退出条件模式（下一格借到同一个池化槽位）必须把系数写回 1；`dispose()` 也复位
  （同「抖动 / 气泡偏移不许跟着池化槽位走」那一族约束）。
- 换章 `cancelPreviewCinema()` 一并清空 `unlockTransitions` / `lockVanishedCells`：
  格子与锁节点都要重建，留着的秒表会去写已经销毁或复用给别格的节点。
- `paintHexes` 每秒全量走一遍 ⇒ 过渡期间它会用 `show = false` 再调一次 `applyHexLock`，
  靠"在播就 return"挡住，否则消失的锁会闪回一帧。

判据：`tests/territory-unlock-transition.test.ts`（曲线端点 / 单调性 / 1s 收工 / 视图系数乘法
与池化复位 / 三处接线的源码位置）。

### 3.31 一个节点一处 UI：锁与银币**二选一**（2026-11-10）

> 用户原话（配图是 `chapter_01` 的 1-5 首领截图：中心一格「银币 + 红 50」、周围 6 格各一把锁，
> 红圈圈住了其中一把锁和那个 50）：「应该是只有建筑承载 UI，这个是老账号的脏数据引起的原因吗」；
> 追问后定稿：「**如果是未解锁，那么整个关卡节点就只有建筑虚影上显示锁住的 icon，
> 如果是可激活，那么只有建筑虚影显示银币和数值 UI，不会出现锁和银币同时存在的情况**。」

#### 结论：不是脏数据

那 7 格是配置里固定的同一条 `configId`（`10005`）：`213` 有建筑，周围 6 格是同关空地，
六边形邻接关系正好是「中心 + 6 邻格」。但**前置本来就不同**：

| 格 | 前置 `requiredCells` |
| :--- | :--- |
| `213`（建筑） | `[252]` = 1-4 通过即可 |
| 其余 6 格（空地） | `[252, 253, 232, 231]` = 1-4 + 三只宝箱（`253/232/231`） |

⇒ 6 格被三只未点开的宝箱卡住（§3.30 的口径）、`213` 自己没被卡住所以照常标价，
两者叠在一起就成了「一格价格 + 六格锁」。任何账号都是这个配置，与存档新旧无关。

#### 现在的口径（三句话）

1. **只有承载格（`chapter_02` 起是锚点）承载 UI** —— 空地一格都不画，包括锁；
2. **锁与价格互斥** —— 画锁的格一定不画价格，绝不会「锁 + 银币」并排；
3. **组内任一格被卡住 ⇒ 整个节点算「未解锁」⇒ 锁落在承载格上**（这条保留了
   2026-11-09 第三轮「附近格子也要有锁」的诉求，但落点从「空地也复制一把」改成「收到建筑格」）。

由此得到的四种画面：

| 节点状态 | 承载格 | 其余格 |
| :--- | :--- | :--- |
| 未解锁（前置没打通 / 前置宝箱没点开） | **锁** | 什么都不画 |
| 可激活（前置满足，钱够） | **银币图标 + 数值（白）** | 什么都不画 |
| 可激活但钱不够 | **银币图标 + 数值（红）** | 什么都不画 |
| 已解锁 / 已通关 | 建筑 / 编号气泡 / 已通关绿 | 什么都不画 |

实现：`territoryNodeLockCells(sites, lockedCells)` 用 `territoryNodeCarrierByCell` 把
`lockBlockedCells` 收敛到承载格；`paintHexes`（画锁）与 `syncStations`（摘价格）**同源调用**它。
⚠️ 只改画法不拦点击：`213` 这种「自己前置已满足、被兄弟格连坐」的格仍然点了就能解锁
（与 §3.28「保留可点，照常解锁」同一条纪律）；真要连坐拦截，得改 `checkUnlock` 并与服务端口径对齐。

判据：`tests/territory-node-ui.test.ts` 的「10005 首领 ⇒ 只收敛成 213 那一把」、
「footprint 收敛到锚点」、「非节点格原样透传」、「空输入零改动」。

## 4. 其他玩家席位的视觉区分：顶点色相乘灰
- **统一判据**：`owner !== 'player'`（与领地染色、城墙敌我同口径）。
- **实现方式**：在 `ZCUnitView.applyVisualTint` 中通过 `Sprite.color` / `Skeleton.color` 顶点色相乘叠 `#828282`（`OTHER_PLAYER_TINT = 0x82`），保留美术明暗体积，不额外建节点。
- **状态枚举与优先级**：使用枚举 `TINT_WHITE / TINT_OTHER_PLAYER / TINT_DEAD`，优先级为 **阵亡（alpha 190） > 其他玩家（`#828282`） > 原色**。
- **双分支强制**：必须写 `if (sprite) ... else if (skeleton) ...`，确保序列帧与 Spine 单位均生效。
- **判据**：`tests/zcds-unit-view-render.test.ts`。

### 4.1 敌我标识：阵营色 + 描边 + 四色血条（R25「【战斗】敌我标识」）

需求两条：①「根据不同得阵营，叠加对应的颜色和描边」②「不同阵营区分不同的血条」。

① 早已闭环，本轮只做核对（口径分散在三处，别以为要新加一套）：

| 载体 | 入口 | 说明 |
| --- | --- | --- |
| 领地填充 | `ZCHexView` 的 `zcFactionColor(owner)` | 60% 透明；结算铺场用 `zcDeepFactionColor` |
| 领地轮廓 | `ZCOutlineLayer` 的 `zcFactionColor(owner)` | **整盘共享一层绘制**（不是每格一个 `Graphics`），100% 不透明 |
| 单位外轮廓 | `ZCUnitView.renderOutline` → `OWNER_EDGE_COLOR[owner]` | 只给「非我方且未阵亡」的单位；颜色读共享主题 `ZC_CLIENT_COLORS.*Edge`，不复制值 |

② 是本轮的实际改动。原先 `pickHealthBarFill` 只接三张图，`enemy3` 与 `enemy` **共用红色**（蓝湖「多队伍」稿只出了三队配色），四家同场时两条红条分不清谁是谁。

- `ZCGameViewUtil.pickHealthBarFill(owner, player, enemy, enemy2, enemy3)` 改成**五参**，穷举 `switch`；`default` 只兜 `neutral`（没有阵营色概念，按敌方红）。
- `ZCUnitView`（单位）与 `ZCHexView`（建筑 / 城墙）各加一个 `@property barFillEnemy3`，prefab 同步绑定。
- 紫图取**项目里已有但一直没人用**的 `resources/image/buildings/jindutiao_p.png`（实测 `#8b5af5`，与 `ZC_CLIENT_COLORS.enemy3Edge` 的 `#bd49fb` 同色相系）⇒ **不需要新美术、不需要重出图集**。
  该图 20×10、九宫格 `3/7`，与 gameui 那三张（30×8、`4/4`）源尺寸不同，但血条节点是 `SLICED` + `CUSTOM` 画在 68×8（`barFillHeight = 8`），实际观感一致。
- ⚠️ 另有一整套**四色且尺寸统一**的 `resources/image/buildings/jindutiao_{b,r,y,p}.png`（均 20×10）**全部未被引用**。本轮**刻意不用**它们替换现有三张：那会改掉已验收的我方 / 敌方 / 敌2 观感。

判据：`tests/zcds-progress.test.ts` 的「血条使用 ProgressBar，裁切非法比例并按阵营换填充图」——四家映射两两不同 + `neutral` 兜底 + `Set(size) === 4`。

### 4.2 血条尺寸：单位「矮一点、短 20%」，城墙/建筑「高 2px、短 40%」（2026-10-26）

战场上单位挨得近，原稿（蓝湖「多队伍」76×17 / 86×17、地块 94×17）的条会**互相糊在一起、还比分身宽**。两类载体按不同口径收：

| 载体 | 外框 | 填充 | `totalLength` | 填充左缘 |
| --- | --- | --- | --- | --- |
| 单位·普通 | 76×17 → **60.8×17**（高不动、宽 ×80%） | 68×8 → **52.8×8** | 68 → **52.8** | −34 → **−26.4** |
| 单位·英雄 | 86×17 → **68.8×17** | 78×8 → **60.8×8** | 78 → **60.8** | −39 → **−30.4** |
| 城墙 / 建筑 | 94×17 → **56.4×19**（高 +2px、宽 ×60%） | 86×8 → **51.6×10** | 86 → **51.6** | −43 → **−25.8** |

两条容易踩空的地方：

1. **单位条的真源是脚本字段**，不是 prefab。`ZCUnitView.renderHealthBar` 的写法是「尺寸变了才写一次」，所以只改 prefab 会在第一帧渲染时被 `barWidth / barWidthHero / barHeight / barFillHeight` 覆写回原值 —— 必须改 `@property` 字段，再把 prefab 序列化值同步成同一组数（否则编辑器里看到的是旧宽）。地块条没有对应字段（`ZCHexView` 的血条尺寸完全由 prefab 决定），只改 prefab。
2. **`barFillInset`（单位条左右内缩）保持 4px 不缩**：它跟的是外框边框的**像素厚度**，而外框高度没变（仍 17），缩它会让描边和填充贴到一起。地块条没有 inset 字段，左右各 4px 是随宽度 ×0.6 一起缩成 2.4px。

验收口径（数字必须两端一致）：`HealthBar` 外框 / `Bar` 填充 / `ProgressBar._totalLength` 三者自洽 —— `totalLength === 外框宽 − 2 × inset`、`Bar._lpos.x === −外框宽 / 2 + inset`。

### 4.3 扣血白条：被扣掉那段先变白，**0.13s 从右往左**缩没（2026-10-27）

需求：「血条扣血增加一个缓动动画，被扣除部分显示成白色，白色部分在 0.13s 内从右往左缩短消失，暴露出黑色底框」。

实现 = `view/ZCHealthBarDamageTrail`（纯类，**单位条与城墙/建筑条共用**）+ `ZCGameViewUtil` 的三条纯函数：

| 符号 | 值 / 口径 |
| --- | --- |
| `HEALTH_BAR_DAMAGE_TRAIL_SECONDS` | **0.13**（时间真源，别在实现里再写一份） |
| `healthBarDamageTrailScale(elapsed)` | `1 → 0`，用 **smoothstep** `1 − t²(3−2t)`（两端速度都为 0 才像"被吸回去"，线性在 0.13s 上会看出起停硬边） |
| `healthBarDamageTrailWidth(len, progress, from, elapsed)` | `len × (from − progress) × scale`；回血 / 没掉血 / `progress` 非有限 ⇒ **0**（不画） |
| `healthBarRatio(hp, maxHp)` | 血条比例的**唯一**入口（血条本体、白条、可见性共用一套钳位） |

几何与层级（三条都是踩过就知道的）：

1. **白条是"被扣掉的那段"，不是"旧血量"**：左缘钉在填充条的**当前右缘**（`barSprite.node.position.x + totalLength × progress`），右缘是**扣血前那条边**。宽度收窄时只有右缘往左走 —— 这正是需求的方向；把左缘也一起缩就变成"从中间塌"。
2. **画布懒建在 `HealthBar` 的第一个子节点**（`Graphics` + 白 `rect` + `fill`，垫在填充条下面）：子节点序 = 渲染顺序，左缘与填充右缘重合处的亚像素重叠永远由填充压住，不会出现"白条吃掉一点血"。
3. **高度取填充条自己的高**（单位 8 / 地块 10），只改宽度 —— 不去猜 prefab 的槽高。

时间轴挂哪（**这条最容易做错**）：

- **单位条**：`ZCUnitView.render` 走 `renderDynamic`，每帧一次，直接喂 `damageTrail.render(bar, ratio, now)`。
- **城墙 / 建筑条**：`ZCHexView.render` 走 `renderStatic`（**0.15s 节流**）—— 白条只有 0.13s，留在静态刷新里会「闪一帧就没」。所以按 `developableSpawnHexes` 的同一套机制：静态刷新时 `isHealthBarTrailAnimating()` 登记进 `ZCGameRenderWorld.healthBarTrailHexes`，动态帧 `renderHealthBarTrails` 调 `advanceHealthBarTrail(now)` 推进，播完返回 `false` 出队。集合平时为空 ⇒ 零开销。
  - 比例仍只在静态刷新里算一次（`lastBarRatio`）：动态帧不重复读模型、不写 `ProgressBar`。代价是白条最多晚一个静态拍（≤0.15s）起手 —— 但**填充条的掉血本来就只在那一拍发生**，两者同步，观感上不会"白条比血先动"。
- 复用复位：`ZCUnitView.resetForReuse` / `ZCHexView.initialize` 都要 `damageTrail.reset()`，否则回池第一帧会按上一条命的比例闪一条白。

判据：`tests/zcds-health-bar-damage-trail.test.ts`（8 条）—— 曲线两端慢 + 单调、宽度区间（回血/脏参数为 0）、单位条起步位置与半程宽度、中途再挨打重新计时、回血不起白条、复位、以及「白条推进必须挂 `renderDynamic`、不许挂回 `renderStatic`」的源码守卫。

### 4.4 出局玩家的头像压黑（HUD 左侧玩家行，2026-10-27）

需求：「玩家被击杀后，该名玩家的头像需要参考美术效果叠加一点颜色遮黑」。

| 项 | 口径 |
| --- | --- |
| 颜色真源 | `ZCTheme.ZC_HUD_DEAD_AVATAR_TINT = Color(72, 72, 72, 255)`（≈0.28 亮度，想调深浅只改这一处） |
| 压谁 | `headIcon`（头像）+ `headFrame`（席位圆盘）**一起**压 |
| 不压谁 | `nameText` 仍按 `zcFactionColor(owner)` —— 出局后「这是谁」这条信息不能丢 |
| 判据 | `territoryCountOf(owner) <= 0`，与顶部四格「红 X」的 `finished` **同一帧同一个数**（复用 `render` 里刚算好的 `counts[i]`） |

三个实现要点：

1. **用 `Sprite.color` 相乘，不盖半透明黑块**。相乘保留原画的明暗与轮廓（与单位「阵亡色」`ZCUnitView.UNIT_DEAD_TINT` 同一套机制）；盖黑块会把圆盘的席位色一起洗成灰，还得多挂一个节点/图。
2. **只在状态翻转时写一次**（`ZCGameHudPlayerRow.appliedDead` 缓存）。颜色是乘进顶点色的，每帧重写同一个值也会把材质标脏。行节点由虚拟列表复用，缓存跟着组件一起被复用，所以不会出现"上一席的黑留在这一席"。
3. **判据从 `ZCGameHUDView.render` 注入**（`paintPlayerRows` 第三参 `deadOf`）。`setSeatProfiles` 调 `paintPlayerRows(owners)` 时不传 ⇒ 选点阶段（还没开打、连 `model` 都没有）四行都不压黑。

判据：`tests/zcds-hud-dead-avatar-tint.test.ts`（7 条）—— 常量口径（三通道相等、够深但不至于全黑）、机制守卫（改 `Sprite.color`，禁 `UIOpacity`/黑块）、头像与圆盘同步翻转、只在翻转时写、名字色不变、虚拟列表复用归位、以及「判据必须复用同帧 `counts`」的源码守卫。

### 4.5 塔防大血条只在 BOSS 波显示，非 BOSS 怪不展示（2026-11-20）

> 用户原话（配图红框）：「塔防模式非BOSS怪不展示大血条UI（合并svn这个改动回退了）」
> 截图：左上 `第3/6波` 的普通小怪波，头像框 + 名字 + 长血条整条挂在屏上；战场里是多只小怪，不是 BOSS 单体。

🔴 **真因只有视图接线一行**：`ZCGame.renderBossPanel` 被合并回退成
`setBossBarVisible(progress.currentWaveId !== null)`。「有当前波」从第 1 波起恒真 ⇒ 普通波也挂首领大血条。
**模型 / 配置层口径从未变过**：`ZCGameModel.defenceWaveProgress.currentWaveIsBoss` 由 `isBossWave()` →
`defenceBossWaveIndex()` 算（表里有 `isBoss` 就认它，没填按每组最后一波兜底），`ZCMatchConfig` /
`ZCBattleEntryBuilder` 的注释也都写着「大血条只在 BOSS 波显示」。恢复只认这一份数据，
别再拿 `currentWaveId` / `spawnedWaves` / 场上怪数去推「有没有首领」。

| 项 | 口径 |
| --- | --- |
| 常驻 | 骷髅 `IconBoss` + `第N/M波`（`formatZCDefenceWaveText` 把 `spawnedWaves` 钳到 1 起，2026-11-09 定案） |
| 只在 BOSS 波 | 头像框 `Portrait` / 名字 `BossName` / 血条 `Bar`（含 `Fill` 与 `X{n}`）—— 由 `setBossBarVisible` 整组收放 |
| 非 BOSS 波 | 上面三者一起 `active = false`，小怪只走自己的头顶血条；面板**不销毁、不重建** |
| 结算 | 条藏着时 `advanceHpDrain` 第一帧就放行 ⇒ 不为空动画多等 0.5s（见速查表结算那行） |

🔴 **别只藏 `Icon`**：`portraitIcon` 这个 `cc.Sprite` 绑在 `Portrait/Icon` 子节点上，`Portrait` 自己还带
86×86 的 `boss_txk` 框贴图。只写 `portraitIcon.node.active = false` 会在普通波留下一个空头像框 ⇒
要收的是 `portraitIcon.node.parent`（与 `hpFill.node.parent` = `Bar` 同一手法），没有父级时退回自己。

**不变量**：`renderBossPanel` 每次 `static` 刷新都调一次 `setBossBarVisible`，写的是**绝对显隐**；
从 BOSS 波切回普通波必须能再收起，不能靠「实例化时染一次」。

**判据**：`tests/zcds-pve-defence-hud.test.ts`（波次序列 `[false, false, true, false]` + 整组收起 / 徽标仍刷新）、
`tests/zcds-boss-panel.test.ts`（接线源码守卫：判据必须是 `currentWaveIsBoss`）、
`tests/zcds-game-resources.test.ts`（BOSS / 普通波两次 `renderBossPanel` 不重建面板）、
`tests/zcds-pve-defence.test.ts`（模型侧 `currentWaveIsBoss` 逐波真值）。

## 5. 自选主城（选择基地模式）：World 层表现 + 跟随基地的确认按钮

沿用既有 `cityMode: 'select'` 的 `ZCSpawnSelection` + `ZCSpawnSelectionView`，仅在 World 层挂载表现，**严禁新建第二套选点状态机或第二颗确认按钮 Prefab**：

1. **预置玩家默认落点（零随机源消耗）**：构造期 `ZCSpawnSelection.defaultHexFor('player')` 优先取 `map.homes[0]`，不合法则退回 `legalHexes()[0]`；**只预置玩家、不预置 AI，且严禁消耗随机源**（构造期随机源消耗次数恒等于 `owners.length - 1`）。
2. **基地相邻 6 格深蓝高亮**：取 `selection.baseNeighborIds('player')`（仅我方），由 `ZCHexView` 渲染 `SPAWN_BASE_NEIGHBOR_FILL`（`#1D24C8`，alpha 170），**优先级：基地邻格高亮 > 受阻红 > 半区/中立色**。
3. **借用 HUD 绿勾按钮改挂世界层 `mapLayer`**：
   - 由 `ZCGame.borrowSpawnConfirmButton()` 借出 `ZCSpawnSelection.prefab/ConfirmSpawn`（`btn_gou.png`）改挂 `hudView.mapLayer`，由 `renderSpawnConfirmButton` 逐帧写坐标至**基地中心正下方 2 个行距**（`SPAWN_BASE_CONFIRM_ROW_OFFSET(2) × HEX_GRID_VIEW_ROW_SPACING(90) = 180px`，严禁乘列距 92.25）。
   - **借还三铁律**：① 借出时必须关掉其自带的 `cc.Widget`；② 在 `spawnSelectionView.node.destroy()` **之前**必须调 `restoreSpawnConfirmButton()` 归还父级、兄弟序、坐标与 Widget（并把世界层引用置 `null`）；③ 若 `shutdown` 时原父级已失效则直接销毁。
4. **显隐判据用 `isPlacing('player')`**：我方点击确认后高亮与按钮立即收起，严禁用 `snapshot.finished`（否则等待 AI 确认期间仍会多亮几秒）。
5. **顶栏三行式（2026-10-17 按线框图重排）**：`SpawnInfoBand`（663×130）内自上而下 = **倒计时数字 48 号（加粗）`y=+35`（第一行、水平居中）→ 标题 25 号 `y=-9`（第二行）→ 进度条 200×23 `y=-46`（第三行）**；等待态收掉数字与进度条，标题回到 `y=0` 居中（`SPAWN_HINT_PICKING_Y / SPAWN_HINT_CENTER_Y`）。
   两个必踩的坑：
   - 🔴 **「字比数大」**：汉字满字高 ≈ 0.95em，阿拉伯数字只有大写高 ≈ 0.72em（无降部）。所以「数字 30 号 + 标题 28 号」实际是**标题看着更大**（视觉高 21.6 : 26.6），这也是调整前截图里「7 比标题还小」的根因。配字号必须按**视觉高度**算：48 : 25 ⇒ 34.6 : 23.8 ≈ 0.69（48 : 30 那版是 0.82）。
   - 🔴 **`SHRINK` 静默缩字**：Label 是 `overflow=SHRINK`，框小就把字号压回去而不报错。旧标题框 221 装不下 8 字 × 28 号，`prefab` 里 `_actualFontSize: 22` 就是被压过的证据 —— **换字号必须同时放宽框**（现 300×38，框高还要 ≥ `lineHeight`）。
   - 进度条几何：先按需求**长度 −35%、高度 −5%**（398×32 → 259×30），再经用户两次手定 **230×23 → 200×23**（填充 194×16，四边留 2~6px）；视图只写 `fillRange`，几何一律在 prefab。
- **判据**：`tests/zcds-spawn-base-confirm.test.ts`（12 条）、`tests/zcds-spawn-selection-view.test.ts`（12 条，含三行式排版与光学字号判据）。

## 6. 战斗飘字「快进慢出」：前 45% 入场，后 55% 淡出

⚠️ 这一节讲的是**伤害 / 治疗 / 暴击…**那一类飘字。**金币是唯一的例外**，而且金币内部还分两条
方向相反的路（2026-10-27 拆开，见 §6.3 / §6.4）：

| kind | 来处 | 曲线 | 数字 | 方向 |
| --- | --- | --- | --- | --- |
| `gold` | 击杀单位 / 拆建筑**掉落** | `floatTextGoldDrop` | 无 | 往下落（`drop >= 0`） |
| `goldincome` | 主城 / 金矿**产出** | `floatTextGoldRise` | `+N` | 往上升（`rise >= 0`） |

两条曲线**方向必须是反的**，各自有单测按符号卡（掉落一旦往上飘、产金一旦往下掉 = 接错了曲线）。

总时长常量 `FLOAT_TEXT_DAMAGE_SECONDS = 0.85`（金币另有 `FLOAT_TEXT_GOLD_SECONDS = 0.62` 与
`FLOAT_TEXT_GOLD_INCOME_SECONDS = 0.9`），由单旋钮 `entranceProgress = FLOAT_TEXT_ENTRANCE_PROGRESS = 0.45`
统一划分前后两段（三条纯函数均在 `ZCGameViewUtil.ts`）：

1. **前 45% 入场（`floatTextEntrance`）**：`progress / entranceProgress` 套 `easeOutCubic`，入场结束后恒为 `1`。**散落、下坠、摇摆、弹出缩放一律喂 `enter`（严禁喂整条 `progress`）**。
2. **后 55% 匀速淡出（`floatTextFade`）**：入场段恒为 `1`，之后在剩余 55% 时长内**线性**降到 `0`。
3. **后 55% 同向收尾漂移（`floatTextDrift`）**：入场段恒为 `0`，之后按 `easeOutQuad` 沿入场同向再漂移 `driftDistance = 7`（落在 `5~10px` 护栏内），消除静止调透明度的生硬感。⚠️「同向」指**那一条飘字自己的方向**：我方造成的那条向上、挨打那条向下，见 §6.5。
4. **Prefab 序列化同步**：修改 `entranceProgress (0.45)` 或 `driftDistance (7)` 必须同步更新 `ZCGameFloatText.prefab` 上的序列化值。
- **判据**：`tests/zcds-float-text-gold-icon.test.ts`、`tests/zcds-float-text-gold-drop.test.ts`、`tests/zcds-progress.test.ts`。

### 6.1 各阶段时间表（按 0.45 切分，伤害 `0.85s`）

| 阶段 | 伤害飘字（`0.85s`） | 该段里发生什么 |
| --- | --- | --- |
| ① 出现 | `0.000` | 弹出缩放 **1.25**、`alpha 255`；起点在头顶 `y=+55` |
| ② 入场段 | `0.000 → 0.3825` | `easeOutCubic` 走完位移 + 缩放 1.25→1 |
| ③ 淡出段 | `0.3825 → 0.8500` | `alpha` 线性 255→0；位置**只**再沿同向漂 7px（`easeOutQuad`） |
| ④ 回收 | `≥ 0.8500` | 模型侧 `now >= startedAt + durationSeconds` 即摘除（`ZCBattlePresentationQueue`） |
| 段长 | 入场 `0.3825` / 淡出 `0.4675` | 淡出恒为总时长的 55% |

关键节点实测（伤害，`row 0` / 中轨）—— 表里是**挨打那条**（向下坠）；我方造成那条把 `y` 沿起点 +55 镜像成向上，见 §6.5：

| 时刻 | 进度 | 入场进度 `enter` | `alpha` | 缩放 | `y`（起点 +55） |
| --- | --- | --- | --- | --- | --- |
| `0.0000s` | 0% | 0.000 | 255 | 1.250 | +55.0 |
| `0.0850s` | 10% | **0.530** | 255 | 1.118 | +2.1 |
| `0.1700s` | 20% | 0.829 | 255 | 1.043 | −27.9 |
| `0.3825s` | 45% | 1.000 | 255 | 1.000 | −45.0 |
| `0.6162s` | 72.5% | 1.000 | 128 | 1.000 | −50.3 |
| `0.7650s` | 90% | 1.000 | 46 | 1.000 | −51.8 |
| `0.8500s` | 100% | 1.000 | 0 | 1.000 | −52.0 |

「快进」的量化证据：**10% 的时间（85ms）里已经走完 53% 的位移**、20% 时走完 83%，
剩下 55% 时长只挪 7px —— 所以读起来是「啪」地落到位再慢慢消失，而不是一路匀速飘。

### 6.2 文案：伤害不再带负号，前缀单独一条小字号 Label（2026-10-17）

伤害飘字显示减伤、护盾吸收之后的完整命中伤害，击杀时也显示剩余生命封顶前的数值。例如命中 83，目标剩余 17 点生命，飘字显示 83，实际扣血、战斗统计和吸血按 17 结算。

| kind | 数值 Label | 前缀 Label（`Text/Prefix`） | 前缀字号 |
| --- | --- | --- | --- |
| `damage` | `25` | —— | —— |
| `critical` | `25` | `暴击` | 17（数字 34 的一半） |
| `restraint` | `25` | `克制` | 15（数字 30 的一半） |
| `resisted` | `25` | `抵抗` | 15 |
| `execute` | `25` | `秒杀` | 17 |
| `heal` | `+25` | —— | —— |
| `gold` | **（无文字）** | —— | —— |
| `goldincome` | `+25` | —— | —— |
| `miss` | `MISS` | —— | —— |

- **负号已删**（`-25` → `25`）：飘字本来就长在挨打的目标身上，负号只多占一个字宽。`+` 保留 —— 它标的是「加」这个语义。
- **`gold`（掉落）连 `+` 和数字一起去掉了**（2026-10-23 用户：「移除金币的加号和数字 UI」）：`battleText` 对 `gold` 返回空串，
  `textLabel.enabled` 每帧置 `false`（**不是** `node.active = false` —— 金币图标是 `Text` 的子节点，关节点会把硬币一起关掉）。
- **`goldincome`（建筑产出）恰好相反：必须有数字**（2026-10-27 用户：「播放金币 icon 和**对应的数字 UI**」）。
  数字带 `+`（标"到账"），硬币不自转、排到数字左侧 —— 这条有文字，硬币再居中就会把加号盖掉。
- **前缀为什么要拆**：`cc.Label` 一条字符串只有**一个**字号，「克制」与「31」写在一句里就只能同号；需求「前缀约只有数字一半高」在单 Label 上无解（换 `RichText` 会连带改锚点与自适应宽度的行为，不值）。
- 前缀挂在 `Text` 之下 ⇒ 位置、弹出缩放、上下散落自动继承；水平位置按数字**实际宽度**反推（`-(数字宽/2 + 6 + 前缀宽/2)`，间距 6 是留了描边的余地）。前缀恒为 2 个汉字，宽度直接按「字数 × 字号」算（不读 `UITransform`，那条路有一帧延迟）。
- 字号真源 `ZCFloatTextView.PREFIX_FONT_RATIO = 0.5`：数字按 0.72em 的大写高、汉字按 0.95em 算，30 → 15 时视觉高度是 `21.6 : 14.25 ≈ 0.66`；要更贴「一半高」把它改成 `0.4`（30 → 12）即可，只此一处。

### 6.3 金币飘字（掉落 `gold`）：只有硬币，从角色中心上方落到中心点缩没（2026-10-23）

> ⚠️ 本节只讲**击杀 / 拆建筑掉落**（`kind: 'gold'`）。**建筑产金**是另一条路，见 §6.4。

同一天两轮口径，最终形态：

| 项 | 口径 |
| --- | --- |
| 文字 | **没有**：加号、数字都不显示（`battleText('gold')` 返回空串 + `textLabel.enabled = false`） |
| 图标 | 唯一可见物：`GoldIcon` 挂在 `Text` 节点**原点**（`x = y = 0`），不再按文字宽度往左偏 |
| 落点 | **角色中心**：`goldCenterY = damageTargetSize / 2 = 49`（单位根节点是**逻辑脚点**，画布中心在它上方 ≈ 45.7~49px） |
| 起手 | 中心上方 `FLOAT_TEXT_GOLD_DROP_PX = 18`（即 `y = +67`），之后只往下走 |
| 时长 | `FLOAT_TEXT_GOLD_SECONDS = 0.62s`（比伤害 0.85s 更快，"迅速消失"） |
| 曲线 | `ZCGameViewUtil.floatTextGoldDrop`：掉落 30%（`k²` 加速）→ 停住 15% → 缩没 55%（`scale` 与 `fade` 同步 `1-k²`） |

- ⚠️ **不是** `offsetY`：那个值（26）只到小腿/腰，读起来是「金币掉在脚边」；2026-10-23 后 `offsetY` 已废弃（仅留 prefab 序列化兼容）。
- ⚠️ **建筑产出不再走这条**（2026-10-27 起改 `goldincome`）：`grantGold` 有 4 个调用点，只有
  `economyContext.grantGold`（主城 / 金矿周期产出）传显式的 `'goldincome'`，击杀与拆建筑两处走缺省 `'gold'`。
- **判据**：`tests/zcds-float-text-gold-drop.test.ts`（8 条）、`tests/zcds-float-text-gold-icon.test.ts`（7 条）、`tests/zcds-progress.test.ts` 的「飘字整链 / 慢出段漂移」两条。

### 6.4 建筑产金飘字（`goldincome`）：硬币 + 数字从建筑顶部升起 50px 并淡出（2026-10-27）

用户口径：「建筑生成金币的动画效果需要和单位被击杀掉落金币的动画效果区分开来，建筑生成金币动画是播放
金币 icon 和对应的数字 UI 从建筑的顶部往上升起 50px，并且变透明消失」。

改前两种金币**共用一个 kind**，所以建筑产出也在播「落到地面 → 停一下 → 缩小消失」而且没有数字 ——
读起来像"从地里掉出来一枚硬币"，与"建筑在产钱"这件事完全对不上。

| 项 | 口径 |
| --- | --- |
| kind | `goldincome`（`ZCFloatTextKind` 里与 `gold` 并列，因为**来处不同、动画语义相反**） |
| 文字 | `+N`（`battleText` → `` `+${value}` ``），Label **保持可见** |
| 硬币 | `GoldIcon` 在数字**左侧**：`x = -(数字宽/2 + GOLD_ICON_TEXT_GAP 4 + GOLD_ICON_HALF_SIZE 15)`，不自转 |
| 起点 | **建筑顶部**：格心 + `FLOAT_TEXT_GOLD_INCOME_TOP_PX = 48` |
| 上升 | `FLOAT_TEXT_GOLD_RISE_PX = 50`，缓动 `k(2-k)`（起手快、快到顶收住，不是匀速电梯） |
| 淡出 | 30% 起淡，`1 - u²` 加速收到 0（前三成保持全不透明，"数字先看清再散"） |
| 时长 | `FLOAT_TEXT_GOLD_INCOME_SECONDS = 0.9s`（50px 塞进 0.62s 会像被弹出去） |
| 曲线 | `ZCGameViewUtil.floatTextGoldRise`，返回 `{ rise, fade }` |

- 🔴 **`48` 不是手填的审美值**，是地块 prefab 里 `buildingSprite` 那个节点的上边缘：
  `lpos.y 15.651 + 高 90 × BUILDING_ICON_SCALE 0.72 / 2 = 48.05`。换建筑图 / 改 `BUILDING_ICON_SCALE`
  必须重标，`tests/zcds-float-text-gold-income.test.ts` 会**直接读 prefab 算一遍**来卡这个常量（容差 1px）。
  prefab 里有两个同名 `BuildingIcon`，要用 `ZCHexView.buildingSprite` 那条绑定去找，别按名字猜。
- 🔴 **硬币与数字一起升靠父子关系**，不是各算一遍：`GoldIcon` 是 `Text` 的子节点，移动 `Text` 两者同步动。
  这也解释了为什么只能改 `textLabel.enabled`、不能关 `Text` 节点（关了硬币一起没）。
- **必须显式 `setScale(1,1,1)`**：节点来自对象池，上一条可能是 `gold`（末尾 `scale` 收到 0），
  不写回 1 就会得到「透明度满但看不见」的一条。
- **判据**：`tests/zcds-float-text-gold-income.test.ts`（13 条）。

### 6.5 伤害飘字的纵向方向：我方造成向上飞 / 挨打保持向下坠（2026-11-23）

> 用户原话：「战斗中，玩家方造成的伤害数字是往上飞的，运动路径和现在的相反，
> 受到伤害的数字运动路径保持不变」

改前整个伤害分支只有一条**向下**的曲线（`y = headY + 行×30 − 入场位移 − 收尾漂移`，
`damageDropDistance = 100`）——「数字从目标头顶冒出来，然后一路坠到脚下」。
现在按**这一条飘字是谁的战果**分两档，只有纵向符号不同：

| 档 | 判据（模型给的） | 公式（`dir` = +1 / −1） | 读起来 |
| --- | --- | --- | --- |
| 我方打出去 | `dealtByPlayer === true` | `y = headY + 行×30 **+** (入场位移 + 收尾漂移)` | 从头顶往上飞 |
| 我方挨打 | `takenFromPlayer === true` | `y = headY + 行×30 − (入场位移 + 收尾漂移)` | **与改前逐位相同** |
| 无标记（`heal` / `miss` / 用例里的裸文本） | 两个都没有 | 同「我方挨打」 | 与改前逐位相同 |

其中 `入场位移 = enter × (damageDropDistance + 行 × DAMAGE_ROW_DROP_EXTRA)`、`收尾漂移 = drift × driftDistance`，
`enter = floatTextEntrance(progress)`、`drift = floatTextDrift(progress)` —— 与 §6 的三个纯函数同源，没有新增曲线。

镜像实测（`row 0`、`damageDropDistance = 100`、`driftDistance = 7`、起点 `headY = 49 + 6 = 55`）：

| 进度 | `enter` | 挨打（向下，= 改前） | 我方造成（向上） |
| --- | --- | --- | --- |
| 0% | 0.000 | +55.0 | +55.0 |
| 10% | 0.530 | +2.1 | +108.0 |
| 20% | 0.829 | −27.9 | +137.9 |
| 45% | 1.000 | −45.0 | +155.0 |
| 72.5% | 1.000 | −50.3 | +160.3 |
| 100% | 1.000 | −52.0 | +162.0 |

「只有符号相反」是这条需求的**硬约束**，不是巧合：起点、距离、时序、轨道行距、弹出缩放全部共用。
所以用例钉的不是两套数字，而是「逐拍互为镜像」（`up[i] + down[i] === 2 × 起点`）——
只调其中一条的距离或时序，用例会红。

- 🔴 **判据只认 `dealtByPlayer` / `takenFromPlayer`，视图不许拿 `owner` 反推**：PVP 4 人局里另外
  三个席位也是真人，按 `owner` 判会把两档都判错（与颜色那条 🔴 是同一个真源问题，见 §6.2）。
- 🔴 **两个标记同时出现时以 `takenFromPlayer` 为准**：那一档的颜色 / 字号 / 负号 / 前缀全按
  「我掉了多少血」收敛，方向跟着它走才不会出现「红字负号往上飞」。
- **属性名仍叫 `damageDropDistance`**：prefab 按字段名绑值，改名会静默丢序列化值、退到缺省。
  语义已经是「纵向位移距离」，`tooltip` 按两档写；要两档走不同距离得**新增**字段，别改这个。
- **无标记保持向下**：运行时不存在「非玩家互打的伤害飘字」（模型侧直接不推），这一支纯粹是
  `heal` / `miss` 与旧用例的兼容位 —— 也正因为它在，「以后新加一种没带标记的飘字」默认仍是老行为，不会忽然上飞。
- **判据**：`tests/zcds-damage-float-text.test.ts` 的「我方造成的伤害数字向上飞，挨打那条保持向下坠（路径互为镜像）」
  与「两个标记同时出现时以 takenFromPlayer 为准」；回归靠 `tests/zcds-progress.test.ts` 的两条旧飘字用例
  （它们用不带标记的裸文本 ⇒ 必须逐位等于改前的下坠路径）。

### 3.32 「快速寻敌」的开启条件：激活第 1 章第 4 关地块（`open` 702，2026-11-09）

> 用户原话：「1. 快速寻敌按钮在激活第 1 章第 4 关的地块后才解锁该功能，解锁后所有的章节都常驻；
> 2. 同步到【功能开启表中】，新增 id 702」

跟 §3.21（战斗宝箱入口）是**同一套机制的第二条用例**：表里一行条件 + 一个纯函数闸门 +
账号级落盘的「一次性成就」。

| 项 | 战斗宝箱（701） | 快速寻敌（702） |
| :-- | :-- | :-- |
| 载体 | `open` `refId=701` | `open` `refId=702`（`name=快速寻敌`，`belond=0`、`type=2`） |
| 条件类型 | `territoryLevel`（据点**通关**） | **`territoryLevelActivated`**（据点**激活**） |
| 参数 | `resId=20001` | `resId=10004`（`levelInfo` 里 `chapterLevel=1`、`chapterStage=4`） |
| 表现 | 底部 icon + `0→1.15→1` 生成动画 | 底部大按钮 `ArenaRoot/BeginGame` 显隐 |
| 闸门 | `main/ChestEntryGate.resolveChestEntryGate` | `main/QuickFindGate.resolveQuickFindGate` |
| 落盘 | `territory.passedLevels.v1` | `territory.activatedLevels.v1` |

🔴 **激活 ≠ 通关**，这是本条最容易写错的地方：

```
激活（花银币解锁那一格）  isCellUnlocked || isOwned || isAreaPassed
通关（打完了）            isAreaPassed（同 configId 任一格 owned）
```

用 `isTerritoryLevelPassedInTerritory`（通关）会**晚一整场战斗**——玩家花银币激活了却还没打/打输了，
按钮就一直不出来，与「激活地块后解锁」不符。反过来也不能把 `territoryLevel` 改成读激活：
战斗宝箱那条要求「pvp 20001 胜利通过」，放宽会让未通关就掉宝箱。

所以 `MainEntranceVisible` 里两条条件**并存**：`territoryLevel` 走 `isTerritoryLevelPassed`，
`territoryLevelActivated` 走 `isTerritoryLevelActivated`。`EMPTY_ENTRANCE_PLAYER_STATE` 与
`MainEntranceList`（拿不到领地快照的那条列表）两条都给 `false` —— 缺数据一律不放行。

🔴 **「所有章节常驻」必须落盘**：10004 只出现在第 1 章的 `stageByCell` 里。
只查当前章 ⇒ 玩家切到第 2 章，`MainPage.refreshOpenGates` 立刻判「未解锁」把按钮收走 ——
这就是 2026-11-04 战斗宝箱入口那个 bug 的同款形状（§3.21 三）。所以：

- `MainPage.onTerritoryRender` 先 `rememberPassedTerritoryLevels()` 再
  `rememberActivatedTerritoryLevels()`，最后才 `refreshOpenGates()`；
- 记账用 `activatedTerritoryLevelIds(view)` 整批算（纯函数），落盘 `markLevelsActivated(Array.from(set))`
  —— **必须 `Array.from`**，release 构建把 `[...set]` 降级成 `[].concat(set)`；
- 判定 `isTerritoryLevelActivatedInTerritory(levelId, view, archived)` 先看落盘再看当前章快照。

**按钮显隐只有一个开关**（`quickFindUnlocked`），三处写点都对它取与：

| 位置 | 写什么 |
| :-- | :-- |
| `MainPage.onLoad` | 先 `startButton.active = false`（早于首帧渲染），再 `refreshOpenGates()` |
| `MainPage.start` | `= this.quickFindUnlocked`（**不能**再无条件 `true`） |
| `MainPage.setChestPanelOpen` | `= this.quickFindUnlocked && !open`（收起宝箱栏不许绕过闸门） |
| `MainPage.onStartGame` | `if (!this.quickFindUnlocked) return;`（事件被转发进来也挡住） |

表缺行 / 整表读失败 ⇒ `rowMissing` ⇒ 按未解锁（fail-closed），并 warn 到 `refId`。
这条对**主 CTA** 比 icon 更痛，所以恢复脚本一并留在 `tmp/patch_open702.py`（三层表同步 + 校验）。

判据：`tests/quick-find-gate.test.ts`（11 条：表 3 项、两判据不串台 4 项、跨章常驻 3 项、页面接线 2 项）
+ `tests/territory-save-store.test.ts`（激活集合单独一份 key、与通关互不污染、脏数据不放行）
+ `tests/main-quick-find.test.ts`（未解锁点击不派发 `focusLevel`）。

### 3.33 未解锁的地块整块置灰，变成可激活时再"重新加载颜色"（2026-11-10）

> 用户原话（配图圈住一片未解锁地块，箭头指向一个灰色色块）：
> 「未解锁的地块整个地块图片都置灰，等待切换成可激活的状态（银币 icon + 数字）时再重新加载颜色」

#### 状态表（地皮三选一 + 锁 + 价格）

| 状态 | 地皮 | 锁 | 银币 + 数字 |
| :-- | :-- | :-- | :-- |
| 未解锁（被前置卡住） | **`tileGrey`（`img_land_01_gray` 灰版）** | ✔（一个节点一把，画在承载格） | ✘ |
| 可激活（前置满足、没花钱） | `tileLocked`（`img_land_02` 泥土） | ✘ | ✔ |
| 已激活（花了银币）/ 已通关 | `tileCleared`（`img_land_01` 草地） | ✘ | ✘ |

#### 为什么另起一张灰图，而不是给泥土乘灰

承 §3.10 / §3.30 那条老结论「成品美术自带明暗，再乘色会发脏」：`Sprite.color` 是**逐通道相乘**，
泥土 `#8b7355` 乘任何灰只会得到更暗的棕，**读不出"灰"**（灰度化需要 shader，而这张灰图本来就在包里，
2026-10-16 之前就是它 —— 只是当时还配着三色 tint，被一起删了）。所以：**换图，不染色**。

- 灰图是旧的 **130×119**（新地皮 126×117）。**锁着的格不画格面框**（框只给「已解锁未通关」），
  所以 126 那套"框缩在格子中间"的问题在这里不成立，多出来的 4×2 只表现为与邻居 2px 交叠。
  美术补一张 126×117 的灰版后，只需改 `TerritoryPageAssets` 那一行路径，代码其余不动。
- 灰图缺失 ⇒ 退回 `tileLocked`（宁可这一格不置灰，也不能没地皮）。

#### 🔴 整片灰 vs 一把锁：两条判据、两个集合

| 出口 | 判据 | 集合 |
| :-- | :-- | :-- |
| 锁标画在哪 | `isHexLockCell` + `territoryNodeLockCells` | **收敛**：一个节点一把（7 格的首领只在承载格画锁，2026-11-09 用户口径） |
| 地皮灰到哪些格 | `isStructurallyBlocked` + `lockBlockedCells` | **逐格**：整片都灰 —— 只灰一格会读成"这格特殊" |

两套共用同一个底座 `isStructurallyBlocked(cellId, input, passed)`（`passed` / `pending` /
已解锁 / 已占领四条排除只写一份）。`paintHexes` 里就是 `lockCell`（收敛）与
`greyCell`（逐格）两行，各自喂给 `applyHexLock` 与地皮三选一。

#### 「重新加载颜色」不需要额外动作

前置一满足，模型就不再把这格列进 `lockBlockedCells` ⇒ 下一帧 `greyCell` 变假、地皮自然换回
`tileLocked`；`shouldRecolor` 还会顺手播一段 **0.36s 换色**（旧灰皮缩掉、泥土露出来），
叠在 §3.31 那 1s 过渡上就是三件事同帧起手：**灰变彩 + 锁缩没 + 银币和数字长出来**。

#### 写点

| 位置 | 干什么 |
| :-- | :-- |
| `TerritoryPageAssets` | `tileGrey` 槽位 + `loadFrame(img_land_01_gray)`（不新增美术） |
| `TerritoryModel.emptyArt` | `tileGrey: null`（章节未加载时的空图也要有这一项） |
| `TerritoryMapView.paintHexes` | `greyCell` → `nextFrame = passed ? 草地 : greyCell ? (tileGrey ?? tileLocked) : 泥土` |
| `TerritoryMapView.isStructurallyBlocked` | 锁与灰的公共底座（新增；`isHexLockCell` 改为调它） |

判据：`tests/territory-tile-frames.test.ts`（整片置灰 / 已解锁与已通关不灰 / 解锁那帧换回泥土 /
灰图缺失降级 / 两个集合不合并 / 灰图只许当 `tileGrey` 用且磁盘尺寸 130×119）。

### 3.34 固定宝箱格「可激活」：宝箱 icon 压在价格行之上（2026-11-10）

> 「当固定格资源处于可激活状态时，除了展示银币 icon + 数字外，**新增宝箱 icon 展示**，
>  宝箱 icon 使用美术资源 `icon_baoxiang`，整个格子的排版参照美术效果图。
>  当银币不足，只有数字 UI 显示红色的逻辑不变。固定格未解锁，**仍然只显示锁 icon**。」

**美术**：`image/territory/icon_baoxiang`（58×45），与锁标 / 地皮同目录 ⇒ 同进 `auto-atlas`，同帧能合批；
槽位 `ITerritoryBattleArt.chestIcon`。⚠️ 与 `frameChest`（宝箱**格面框** `fram_02`）不是一回事。

**排版**：两行 = 宝箱在上、`银币 icon + 数字`在下，整块在格心**居中**（不是贴着格子下沿）。
公式在 `model/TerritoryConditionBadge.territoryConditionBlockLayout`。

配数（2026-11-10 用户第二轮：「缩银币 icon 和数字，宝箱 0.95，间隙再小点，全在格内且离边留 1px」）：

| 项 | 常量 | 值 | 未缩放 | 缩放后 |
| :--- | :--- | :--- | ---: | ---: |
| 银币 icon | `CONDITION_ICON_SCALE` | 0.85 | 40×40 | 34×34 |
| 数字 | `CONDITION_VALUE_SCALE` | 1.2 | 实测文本宽 | ×1.2 |
| 行内间隙 | `CONDITION_GAP` | 1 | — | 1 |
| 宝箱 | `TERRITORY_CONDITION_CHEST_SCALE` | 0.95 | 58×45 | 55.1×42.75 |
| 行间间隙 | `TERRITORY_CONDITION_CHEST_GAP` | 1 | — | 1 |

⇒ 块高 = 42.75 + 1 + 34 = **77.75**；格面 123×90 ⇒ 上下各留 **6.125**（`TERRITORY_CONDITION_FACE_MIN_MARGIN`
= 1 是验收下限）。价格行 `y = −21.875`、宝箱 `y = +17.5`，关于格心对称；宝箱横向 55.1 在 `|y| ≈ 17.5`
处的可用宽（六边形收窄后 `≈ 61.5 − 17.5/tan60° × 2` 之外的余量）内，3 位数价格行（34.2 宽）也不顶斜边。

🔴 **没有宝箱时必须 `rowY = 0`**。站点节点是池化复用的，同一个槽位这一秒画宝箱格、下一秒可能画关卡格；
只要这里带一点点偏移，「非宝箱格的价格行整体下移」就会变成全局的版式回归。

**只在「`fixedResource` + 可激活」这一种状态**：`TerritoryMapView.stationRenderOf` 的「未解锁」分支里
按 `site.type` 判（不是按「有没有图」判）；前置没满足的宝箱格走 `syncStations` 的 `locked`
（`isCondition = false`）⇒ 只画锁，天然满足「未解锁仍然只显示锁 icon」。

**红字规则不变**：宝箱图标是独立 Sprite、不参与染色；`conditionTextColor`（银币不足 / 开不了且原因不是
体力不足 ⇒ 只数字变红）原样保留。

**节点**：`ConditionChest` 运行时建在 `StationCaptionLayer`（与价格行同层：压在建筑 / 虚影之上，
气泡与锁之下），惰性创建 + 池化复用；§3.31 的生成缩放（基准 1）与 `setSpawnOpacity` 的整站淡入都带上它，
`dispose()` 必须手动销毁 —— 它挂在共享层上、不在根节点底下。

判据：`tests/territory-condition-chest.test.ts`（排版零偏移 / 对称 / 视图落位与显隐 / 生成缩放与销毁 /
只有 `fixedResource` 拿得到图 / 美术槽位守卫）。

### 3.35 「1023 奖励」的宝箱格换成新建筑 `69020`（`coinBox`，2026-11-10）

> 「使用地图编辑器编辑 chapter01~07 地块使用了 1023 奖励的，建筑 id 从 69005 改成 69020，
>  如果需要给建筑图片补充预制，按照统一的格式制作，现在已经有图片了」

**先纠正一处前提**：实测 148 个 `rewardId=1023` 的格 `buildingId` **全是空串**，没有任何一格写着 `69005`。
但用户看到的「像是 69005」是对的 —— 空串**确实**长得跟 69005 一模一样，原因见下。

**为什么空串 = 69005**：`stationIconOf` 对 `stage`/`boss`/`asyncPvp` 是「没配 `buildingId` ⇒ 不画建筑」，
而 `fixedResource`/`bonus` **会继续往下回退**到 `TERRITORY_SITE_ART`：

```
fixedResource ⇒ art.fixedResource ⇒ image/territory/buildings/territory_fixed_resource_v1
```

这张图正好就是 `build.json` 里 `69005` 的贴图。所以「空串」与「配了 69005」在画面上无法区分。

🔴 **只改 `build.json` 里 69020 的贴图是无效的** —— 没有格子在读它。必须先让格子显式配 `"69020"`，
`stationIconOf` 的第一条分支（`buildFrames.get(69020)`）才会命中，且命中后**不再回退**。

**配数**（`assets/remoteRef/build.json`，源表 `PVP-建筑.xlsx / 装饰建筑` 页早有此行）：

| buildId | buildType | buildresource | buildSize |
| :--- | :--- | :--- | :--- |
| `69020` | 5（固定宝箱） | `image/territory/buildings/coinBox` | 1 |

`buildType` **不参与选图**（见 §3.15 那条），只作语义标注；对账是为了「表里改了 buildType 而脚本没跟着改」
时立刻报错，而不是静默填出一个长得不对的建筑。

**为什么 148 格逐格填、而不是像关卡那样「每组一格」**：那套口径针对的是 `stage`/`boss`/`asyncPvp`
（同一 `configId` 的多格共享同一个关卡，每格都画建筑会让整片区域长满同一个建筑）。
固定宝箱格**没有这个问题**：148 格 ⇒ 148 个唯一 `configId`（`fixedResource_<cellId>`），每格就是自己那栋建筑。

**落点**（两处，由发布脚本一次写同一份 payload）：预设 + `assets/resources/config/territory-maps/` +
策划 `doc/塔防数据配置/json/sever/`。⚠️ 预设必须写**归一化后**的形态，否则与产物只差一个键序
（校验器把站点键重排成 `… configId, buildingId, rewardId`），下次有人做「预设 vs 产物」比对会当成脏改动。

| 章 | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 合计 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1023 格数（11-10 当时） | 25 | 27 | 36 | 15 | 15 | 15 | 15 | **148** |

⚠️ **这张表是 11-10 的历史数，别再当现状**。2026-11-26 用户要求把 `chapter_01` 的 10 个 1023
按位置均匀改配成 `1016/1015/1012`（建筑 `69020 → 69005`），见 §3.58 ⇒ 现在是
`12 / 27 / 36 / 15 / 15 / 15 / 15 = 135`（`chapter_01` 在 11-26 之前就已经是 22 格而非 25，
中间有过一次地图调整，不是本轮引入）。

**脚本**：`tools/map-editor/set_chest_building.py`（幂等；`--dry-run` / `--id` / `--no-publish`；
内置「除 `buildingId` 外字段一律不许变」的硬断言）。

**图片/预制**：`coinBox.png` 已在 `image/territory/buildings/`，212×212，`.meta` 与其它建筑图**同构**
（`importer: image` / `ver 1.0.27` / `subMetas` 同为 `6c48a` texture + `f9941` sprite-frame）
⇒ **不需要补预制**：建筑一律是 `SpriteFrame` 直取（`buildresource` + `/spriteFrame`），全局没有建筑预制这一层。

**锚点**：`69020` **不进** `TERRITORY_BOTTOM_ANCHOR_BUILD_IDS`（那里只有装饰树 `69010~69013`，落地影子要往下压 4px）；
宝箱是对称方盒，居中锚点即可。

判据：`tests/territory-building-id.test.ts` 末条（七章 148 格逐格核 `69020` / 表里 `buildType=5` 且贴图是 `coinBox`）。

### 3.36 银币宝箱的独立打开动画：icon 原地 pop，不复用卡牌宝箱（2026-11-10）

> 「银币宝箱是**独立的**打开动画，不要用卡牌宝箱的打开动画，因为他们的图标不一致。
>  评估下能否根据现有的图制作类似卡牌碎片宝箱打开序列帧图，**可以就开始画图制作动画**，
>  **不行的话就直接播放 icon 放大缩小的消失动画**作为银币宝箱的打开动画即可。」

#### 评估结论：**做不出同款序列帧，采用用户给的兜底 pop**

先盘素材（`tools/gen_chest_open_frames.py` 是唯一已有的序列帧烘焙工具）：

| 素材 | 尺寸 | 状态 | 能不能补帧 |
| :--- | :--- | :--- | :--- |
| `chest/territory_fixed_resource_v1.png`（黄铜藤蔓箱闭合态） | 212×212 | 闭合 | ✅ 与下一行成对 |
| `chest/chest_open_v1.png`（**同一只**黄箱子开盖态） | 142×156 | 开盖 | ✅ 现成，`chest_seq_0…5` 就是这么来的 |
| `chest/chest_seq_0.png … chest_seq_5.png` | 142×156 ×6 | 开盖过程 | 黄箱子专用 |
| `buildings/coinBox.png`（蓝银金属箱，69020） | 212×212 | **只有闭合态** | ❌ 缺开盖态 / 箱内衬 / 箱盖内侧 / 分层源文件 |
| `icon_baoxiang.png`（白绿线条小宝箱） | 58×45 | **只有闭合态** | ❌ 同上 |

`gen_chest_open_frames.py` 的做法要求**同一只箱子的闭合态 + 开盖态两张整图**：箱体取开盖图、
闭合盖垫在下面压扁淡出、新盖绕接缝纵向长出。银币宝箱只有一张闭合整图 ⇒ 没有可对齐的盖几何；
把黄箱子的盖子贴上去正是用户说的「图标不一致」；临时生成一张开盖态，金属铆钉 / 蓝色菱形纹 /
银色包边无法逐像素对齐，只会造出**第三种图标**。

⇒ **不新增任何美术资源**，按兜底实现：`icon 放大 1→1.3 → 缩小到 0（消失）`。

#### 两类宝箱（判据表）

| 类别 | `rewardId` | 奖励 | 地图图标 | 打开动画 |
| :--- | :--- | :--- | :--- | :--- |
| 卡牌碎片宝箱 | `1016~1022` | 银币 + 卡牌碎片 + 专属道具 | `territory_fixed_resource_v1`（黄铜藤蔓箱，69005） | `chest_seq_0…5` 开盖补帧 + 三档全屏表演 `playChestOpen` |
| **银币宝箱** | **1023** | **只有银币**（`resId=7`） | `coinBox`（蓝银金属箱，69020） | **独立 pop**，原地缩放消失 |

🔴 **判据只能用 `site.rewardId`，不能看领取回包里的奖励内容**。奖励是概率组，卡牌碎片宝箱
也可能恰好抽到银币；`levelMapGrideReward.json` 里 `1023` 是唯一**整组只发 `resId=7`** 的组，
常量落在 `model/TerritoryMapConfig.TERRITORY_SILVER_CHEST_REWARD_ID`。七章 148 格见 §3.35。

#### 时间轴（`model/TerritorySilverChestOpen.ts`，纯函数、零 `cc`）

```
0s          0.12s                0.4s
 1 ───────↗ 1.3 ─────────────↘ 0（消失）
   easeOutCubic(30%)   easeInQuad(70%)
```

- `TERRITORY_SILVER_CHEST_POP_SECONDS = 0.4` / `TERRITORY_SILVER_CHEST_POP_PEAK = 1.3` /
  `GROW_PORTION = 0.3`。`NaN` / `±Infinity` / `≤ 0` 返回 `1`（原样，别先闪一下没了），
  `≥ 0.4s` 返回 `0` —— 与 `territoryUnlockLockScale(-1) = 1` 同口径。
- **缩到 0 就是消失**：不叠 `UIOpacity` 淡出，少一条与 `setSpawnOpacity` 抢同一颗节点的通道。
- **纯函数时间轴，不是 tween**：站点节点池化复用，tween 回收后仍会继续写节点；沿用
  `TerritoryUnlockTransition` / `ShakePresentation` 的模式，视图只按 `elapsed` 写当前帧，
  复位时把 `elapsed` 置 `-1`，没有要销毁的定时器。

#### 链路（四步，不改配表）

1. `TerritoryModel.handleUnlockThenPass`：领取回包按 `site.rewardId === 1023` 分流出
   `showRewards(..., { silverChest: true })`；**其余仍保留 `showRewards(result.rewards, site.cellId)`
   原串调用**（`territory-cell-protocol` / `territory-burst-density` 的结构守卫钉的就是它）。
2. `MainTerritoryMap.presentRewards`：`presentation?.silverChest === true` ⇒
   `mapView.playSilverChestOpen(cellId)` + **`settleRewards(rewards, cellId, false)` 当场结算后 return**。
   🔴 不进 `playChestOpen` / `playChestThenSettle`，不看 `tier`、不碰 `chest_seq_*`；
   **奖励绝不挂 `onDone` / `isChestPlaying` / `wireRewardCatch`** —— 换章 / 页面销毁 / 视图回收
   都可能让 0.4s 播不完，挂回调会静默吞掉这批银币。`suppressGain = false`：这次没有飞出图标带过 `+N`。
3. `TerritoryMapView.playSilverChestOpen` 只转发 `stationViews.get(cellId)?.playSilverChestIconPop()`：
   不建覆盖层、不锁输入、不推镜头、不碰 `chestView` / `captureChestCamera`。
4. `TerritoryStationView`：`writeIconScale()` 改成 `iconBaseScale × buildingShake × pop` 三因子相乘；
   `stepSilverChestPop(deltaTime)` 在 `update()` 最前面推进，播完 `resetSilverChestPop()` 并
   `render(this.lastContent)` 让箱子真正退场。

#### 三个容易踩的边界

- **帧快照**：领取回包一到，`stationRenderOf` 会把 claimed 格的 `content.icon` 置 `null`。
  `playSilverChestIconPop()` 必须**当场快照 `iconSprite.spriteFrame`**，退场期间
  `setIcon(popFrame ?? content.icon)` 顶上，否则动画还没起手箱子就没了。
- **池化换格**：`render()` 里 `contentCellId !== silverChestPopCellId` 立即 `resetSilverChestPop()`，
  否则 pop 系数会被带到下一格；`dispose()` 同样复位。
- **无图 / 已销毁降级**：`playSilverChestIconPop()` 拿不到 `spriteFrame` 或 `cellId` 就返回 `false`，
  页面照常结算奖励（纯表现不许挡玩法）。

判据：`tests/territory-silver-chest-open.test.ts`（10 条：曲线端点 / 单调 / 峰值接合 / 非法值、
`1023` 全表判据与 148 格 `69020`、帧快照播完才消失、换格停表、无图与 dispose 降级、
Presenter 分流、页面不进 `playChestOpen` 且当场结算、MapView 不碰覆盖层、pop 不建 tween 不抢 `UIOpacity`）。

### 3.37 碎片 / 种族经验飞向底部「英雄」按钮 + 碎片进度徽标（2026-11-10）

> 「1. 固定格打开，对应往上飞的卡牌碎片粒子和种族经验的终点位置改成**英雄图标**的位置，
>  并且英雄图标播放粒子飞入的**抖动受击反馈**；
>  2. 随机格打开获取的卡牌碎片和种族经验也**增加 1 个往卡牌飞的动画**；
>  3. 当英雄内某一个角色的卡牌碎片累计满且种族经验也累计满，在英雄 icon 上播放
>  **对应碎片 icon 进度长满**的动画（进度增长，整个 UI 消失），多个英雄按排序优先级逐个播放。」

#### 用户当场确认的三条口径（`AskUserQuestion`）

| 问题 | 口径 | 实现 |
| :--- | :--- | :--- |
| 哪些奖励改道飞英雄按钮 | **只改碎片经验** | `7` 银币 / `9` 体力仍飞顶部资源栏并触发数字跳动；其余一律飞英雄按钮 |
| 进度长满何时触发 | **仅本次新达成** | 领奖前已可升级 / 已满级 / 未配置 ⇒ 不播，避免每次领奖重复播同一个英雄 |
| 进度条起点 | **从当前比例起** | `from = clamp(cardOwned / cardNeed, 0, 1)`，长到 `1` 后整个徽标淡出消失 |

#### 判据只有一条：`isTerritoryHeroRewardResId`

```
isTerritoryHeroRewardResId(resId) = 合法正数 && !isTerritoryWalletResId(resId)
```

`model/TerritoryHeroReward.ts`（零 `cc`）是「判据 / 飞行曲线 / 徽标进度 / 队列排序」的**唯一真源**。
非钱包类不只是 `18xxx` 碎片和 `16xxx` 种族经验，还包含 `10010` 卷轴、`19xxx` 专属道具等
—— 用户口径是「除了银币体力都归英雄」，所以**不按资源段白名单逐个枚举**，一律用钱包补集。
改之前这些资源没有登记落点，`TerritoryChestView` 全部回落到「屏幕顶部中央」堆成一团
（就是需求截图红框里的现象）。

#### ① 固定格：改落点，不改开箱表演

`MainTerritoryMap.wireRewardCatch()` 一处分流，两处都走 `setRewardCatchWorldPoint(resId, world)`：

```
7 / 9 → territoryWalletResKeyOf → ResBar.slotWorldPositionOf(key) → 顶部资源栏
其余  → findHeroTabButton → button.icon 的 UITransform.convertToWorldSpaceAR → 底部英雄按钮
世界坐标 → 覆盖层局部坐标：TerritoryMapView.setRewardCatchWorldPoint / setHeroRewardTargetWorld
```

🔴 **页面只负责「哪个节点」，矩阵换算一律留在视图**（`convertToNodeSpaceAR`）；
`TerritoryChestView` 一行都不用改 —— 它的 `catchPoints: Map<resId,{x,y}>` 本来就按 `resId` 取点。

> 🔴 **2026-11-11 修订（§3.41）**：随机格那段飞行（`setHeroRewardTargetWorld` / `playHeroRewardFlight`）
> 的坐标系已从页面内 `TerritoryOverlay` 换到 `MainRoot` 顶层 `TerritoryRewardFx` —— 否则图标飞到
> 底部会被聊天框 / 底栏挡住。**固定格开箱表演仍走覆盖层**，两条链路换算入口不同但都用 `convertToNodeSpaceAR`。
落地回调同样按 `territoryWalletResKeyOf` 再算一次目标：钱包类 `bar.playGainFeedback(key, amount)`，
其余 `heroButton.playHitFeedback()`。**不在回调里缓存第二份映射**。

按钮抖动**复用** `core/hex/ShakePresentation` 的 `spawnShakeScaleX/Y` + `BUILDING_SHAKE_STRETCH`
（先 Y 后 X 两段脉冲），`TabButton` 只加 `hitElapsed` + `update(dt)` 按帧写 `icon.node.setScale`；
不建 tween、不另抄曲线、不改 prefab。

#### ② 随机格：保留原表演，另补一段飞行

随机格原本只有「格心 12 颗抛物线喷发 + 合成读数」，**没有飞行段**。
`playCellGains()` 的 `playResourceGain()` 原样保留，后面**再补**：

```
entries.filter(isTerritoryHeroRewardResId)
  → mountRewardFxLayer(rewardFxRoot())   ← 2026-11-11 补：先换成 MainRoot 顶层宿主
  → setHeroRewardTargetWorld(英雄按钮世界坐标)
  → setHeroRewardLandedHandler(一次 playHitFeedback)
  → playHeroRewardFlight(cellId, heroEntries)
```

`view/TerritoryHeroFlight.ts` 是轻量二次贝塞尔飞行（不复用 `chestView` 开箱覆盖层、不锁输入）：

| 常量 | 值 | 说明 |
| :--- | :--- | :--- |
| `TERRITORY_HERO_FLIGHT_MAX_COUNT` | `8` | 一批最多飞 8 枚，防止随机池开出几十条奖励时铺满屏 |
| `TERRITORY_HERO_FLIGHT_SECONDS` | `0.62` | 单枚时长，`easeOutQuad` |
| `TERRITORY_HERO_FLIGHT_STAGGER` | `0.055` | 逐枚错峰 |
| `TERRITORY_HERO_FLIGHT_ARC_RATIO` | `0.42` | 控制点抬升比例（按 `|dy|` 算，向上向下都鼓） |

控制点 `(startX + dx·0.3, startY + |dy|·arcRatio)`；末段 `k>0.82` 淡出。
**本批只通知一次落地抖动**（`landed` 布尔量），不是每枚图标抖一次。
节点池化，`step(dt)` 纯函数按 `elapsed` 写当前帧，`resetHeroFlights()` 在 `resetGains()` 里复位。

#### ③ 碎片进度徽标：新达成检测 + 串行队列

`app/main/HeroFragmentBadge.ts`（非 `Component` 的纯表现视图）挂在 `BottomNav` 上、
摆在英雄按钮图标正上方：`碎片 icon + 角色头像 + 绿色圆角进度条`，用 `Graphics` 每帧重画，
**不用 `cc.ProgressBar`、不用 tween**。

```
grow 0.7s（easeOutCubic：from → 1） → hold 0.2s → fade 0.25s → 整个 UI 消失
```

🔴 **新达成判定用「预测叠加」，不是「领奖前后各读一次背包」**：服务端奖励回包到达时
`CacheMgr` 的 `CmdItem` 缓存可能还没刷新，两次读会是同一个值 ⇒ 永远检测不到。
适配器把本次 `resId → amount` 直接叠进 `countOf`：

```
before = evaluateUpgrade(表, cardId, 等级, 当前背包)
after  = evaluateUpgrade(表, cardId, 等级, 当前背包 + 本次增量)
入队   ⇔ !before.canUpgrade && after.canUpgrade && !maxedOrUnconfigured
```

`canUpgrade = 碎片够 && 经验够`（`CardUpgradeCost.evaluateUpgrade` 真源），正好就是用户说的
「碎片累计满且种族经验也累计满」。进度起点 `cardOwned / cardNeed` 钳到 `[0,1]`。

**依赖倒置**：领地 model 只声明 `ITerritoryHeroProgressSource`；组合层
`bootstrap/main/TerritoryHeroProgressSource.ts` 实现它并 import `app/card`。
`app/territory` / `MainTerritoryMap` **不许反向依赖 `app/card`**，注入点是
`MainPageComposition.mountTerritory()` 的 `territory.setHeroProgressSource(...)`。

**排序优先级**复用 `sortLineupCards` 的返回下标（已上阵 > 已解锁 > 解锁中 > 未获得；
同组比品质 / 等级 / 职业），与玩家在卡库里看到的顺序一致，不另造权重；
`sortTerritoryHeroBadges` 稳定排序，同优先级按 `cardId.localeCompare` 兜底。
`HeroFragmentBadge.enqueue()` 一次只播一个，播完 `startNext()`，多英雄逐个播放。

#### 四个边界

- **纯表现，绝不接管结算**：`presentRewards()` 开头 `void this.playHeroBadges(rewards)` 是即发即忘的
  异步分支（覆盖固定格 / 随机格 / 银币宝箱 / 挂机弹窗四条路）；数据源读失败 / 徽标没建起来 /
  缺碎片图都只降级成「不播」，奖励仍走既有 `settleRewards` / `playCellGains`。
- **坐标拿不到就整段跳过**：找不到 `MainTabHost` / `TabButton` / `UITransform` ⇒ 目标 `null`，
  固定格回落默认落点、随机格不补飞行，喷发 / 读数 / 发奖一个都不少。
- **异步回来页面可能已销毁**：`playHeroBadges` 两次 `isValid` 检查（查表后、取图后）；
  `onDestroy()` 手动 `heroBadge.dispose()`、清空数据源与落地回调。
- **每加一个 import 都要补 VM 夹具白名单**：`TerritoryMapView` 新增
  `./TerritoryHeroFlight` 触发 5 个独立夹具的 `Unexpected dependency`，
  `TabButton` 新增 `../../core/hex/ShakePresentation` 触发 `tests/tab-button.test.ts` 的
  `Unexpected import`（返回零依赖的抖动真模块，不造假曲线）。

判据：`tests/territory-hero-reward.test.ts`（15 条：判据 / 飞行曲线错峰与端点 / 落地时刻 /
徽标三段进度 / 仅本次新达成 / 稳定排序 / 固定格落点分流与按钮真源 / 随机格保留喷发并补飞行 /
飞行不 tween 且只抖一次 / 页面不接管结算 / update 驱动与销毁 dispose / 徽标串行队列 /
数据源组合层注入与预测叠加）+ `tests/territory-chest-animation.test.ts`（既有资源栏落点守卫不回退）
+ `tests/tab-button.test.ts`（抖动 import 白名单）。

### 3.38 宝箱详情弹窗主按钮：加速态绿底 + 播放 icon + 解锁后同步刷新（2026-11-11）

> 「加入按钮是绿色的，加速文案前面缺了播放 icon」「点击解锁后，详情的按钮也要同步刷新」。
> （「加入」是「加速」笔误；用户当场确认：**只把加速态改绿**，解锁 / 开启仍用黄色底。）

#### 症状与根因

弹窗右侧主按钮 `BtnPrimary` 一直用 prefab 上那张**黄色** `btn_open.png`，而下方宝箱栏
`ChestSlot` 的「加速」按钮是**绿色** `chest_btn_green.png` + 文字前一颗播放（摄影机）icon
`chest_bolt.png` ⇒ 同一个状态在两处长得不一样。更糟的是**状态切了弹窗不跟着切**：
点「解锁」→ 服务端把槽位从 `Activate` 变成 `SpeedUp` → 栏位已经变绿「加速」，
弹窗还写着黄色「解锁」（用户截图 3 的两个红框）。

根因是 `MainPage.refreshChestDetailCountdown()` 只调 `panel.updateCountdown(秒, 是否计时中)`，
而那个方法**只写倒计时文本 + `interactable`**，文案 / 底图 / icon 全都不碰。

#### 绿色底图为什么是新生成一张，而不是复用栏位那张

| 素材 | 尺寸 | 结论 |
| :--- | :--- | :--- |
| `chest/detail/btn_open.png`（黄，弹窗主按钮） | 321×108 | 圆角 / 黑描边 / 左上高光 / 右下缺口，与蓝色 `btn.png` 成套 |
| `chest/chest_btn_green.png`（绿，栏位按钮） | 130×54 | 只有一半大，直接放大到 255×108 会把描边和圆角拉伸变形 |
| **`chest/detail/btn_speed_up.png`（新）** | **321×108** | **按 `btn_open.png` 只换色相**（+65°，主体 43°→108° 与栏位绿同色相；s/v 收敛到蓝色那颗的量级），几何逐像素不变 |

`tools/gen_chest_speed_up_button.py` 可复现：meta 从 `btn_open.png.meta` 克隆，**固定 uuid**
`b6c1e904-…`，尺寸 / 九宫格 / 顶点数据全抄，只换 uuid / displayName / 内部引用 ⇒ 重跑不会
弄脏 prefab 引用。⚠️ Windows 上写 prefab 必须 `newline='\n'`（原文件 LF），否则整份大 diff。

#### 一条入口写全按钮，不再有「半刷新」

`ChestDetailPanel.applyOpenButton(state)` 是主按钮的**唯一写入口**：
文案 / 底图（加速=绿，其余=`onInit` 快照的黄）/ 播放 icon 显隐与排版 / 倒计时胶囊 / 可点。
`applyContent`（开窗、换箱）与 `updateCountdown`（每秒、状态变化）都走它。

```
MainPage.chestDetailContentOf  → openSpeedUp: counting（只 SpeedUp 为真）
MainPage.refreshChestDetailCountdown → panel.updateCountdown(秒, speedUp,
                                       { caption: chestActionCaption(action), speedUp })
MainPage.loadTreasureQueue     → load(this, () => refreshTreasureDisplay())
                                 （激活回包 / 广播一到就刷，不等下一次 1s tick）
```

🔴 **文案只能来自 `chestActionCaption(action)`**，弹窗一个字都不许自己写（2026-11-09 就因为
两处各写一份，栏位改成「解锁 / 加速」后弹窗连续落后两轮）。`IChestOpenButtonRefresh` 把
「当前文案 + 是否加速」随倒计时一起下发，这才是「同步刷新」的落点。

#### 排版与边界

- 播放 icon 节点 `BtnPrimary/SpeedUpIcon`（42×44，复用 `chest_bolt.png`），**默认 `active=false`**；
  加速态把「icon 42 + 间隙 6 + 文案（2 字 × 34 + 字距 1.8）」拼成一组围绕设计稿 x=4 居中
  ⇒ icon x≈−33.9、文案 x≈28；倒计时胶囊仍在 (4.5, −22) 不动。
- 字宽按字数 × 字号估，与 `ChestSlotView.layoutButtonLabel` 一样**不去开关 `Overflow` 量真宽**
  （那会把 SHRINK 的框永久改窄）。非加速态文案必须回到 x=4、icon 隐藏、底图还原黄色；
  两态都是全量赋值，连续调用不累加位移。
- 「加速」仍是**禁用**按钮：服务端只有 InfoList / Activate / FastOpen / Open，没有加速协议
  （见 `MainPage.chestDetailContentOf` 注释）。配色变化纯表现，不改玩法。
- `SpeedUpIcon` 节点追加在 prefab 对象数组**末尾**、作为 `BtnPrimary` 最后一个子节点，
  不动任何既有 `__id__`；新节点同样要 `UI_2D` + `UITransform`。

判据：`tests/chest-detail-speed-up.test.ts`（7 条：绿图几何与 meta、prefab 节点 / 三处绑定、
加速态排版、还原黄底、解锁后整颗同步切态、幂等、源码守卫）+ `tests/chest-detail-panel.test.ts`
（新引用绑定）+ `tests/chest-detail-lifecycle.test.ts`（内容 `openSpeedUp`、激活后刷新参数、
队列变化立即刷详情）+ `tests/chest-entry-count.test.ts`（补 `PopupManager` 桩）。

### 3.39 预告关卡红色编号气泡 + 异步据点解锁即直开（2026-11-11）

需求原文（两句，一次提完）：

> 1. 预告关卡节点，展示气泡提示（**红色未通过的状态**）；
> 2. 触发异步据点也是**直接进入战斗**。

当场确认的两个口径（都不靠猜）：

| 口径 | 选择 | 理由 |
| :--- | :--- | :--- |
| 气泡画在哪一格 | **只画虚影承载格** | 预告披露的是整关 footprint（`chapter_02` 起一关 5~10 格），每格都挂会满屏 `1-1`；与 §3.28「一个节点只有承载格承载 UI」同源 |
| 「直开」的范围 | **与主线一致：仅解锁那一次** | 把 `asyncPvp` 并进「花银币解锁那一次直开」名单；已解锁 / 已通关仍弹 `BigMapPlayerLevelPanel`，侦查功能完整保留 |

#### 一、为什么预告节点原本没有气泡

`TerritoryPreview.territoryPreviewLevels()` 的披露序列 = `[本章第 1 关] + [每个首领]`，
`territoryPreviewCells()` 取**整关 footprint 并集**，经 `TerritoryCellReveal` **无条件并入**
`revealedCells`（只改可见性 / 画 35% 虚影）。🔴 **披露 ≠ 能开**：解锁、扣费、开战判据
一个字没动（`isPrerequisiteComplete` / `checkUnlock` 同源，见 `TerritoryCellReveal` 文件头）。

而 `TerritoryMapView.stationRenderOf()` 的 `!isOpened` 分支原本返回
`icon: null` + `isCondition: true`（锁 / 银币价格），**不给 `levelBubble`**；
即便给了，`TerritoryStationView.renderLevelBubble()` 的 visible 也要求
`content.icon !== null && !content.isCondition` —— 两道门槛都过不了。所以不是"漏了一张图"，
是结构上就没有气泡。

#### 二、数据层：四条判据一次收口

在未解锁分支加 `isPreviewBattleSite`，四条**同时成立**才挂：

1. `input.previewCells.includes(site.cellId)` —— 确实是本轮披露的预告关卡；
2. `type ∈ { stage, boss, asyncPvp }` —— 资源点 / 装饰格不挂编号；
3. `!!site.buildingId` —— 与 `syncGhosts` 同一条判据，只有**会画 35% 虚影**的那格；
4. `territoryLevelBubbleText(site, stage) !== undefined` —— 文案真源算得出编号
   （`asyncPvp` 恒 `PVP`，其余要绑到 campaign 行才有 `章节-关卡`）。

再取 `previewAnchor = stationIconOf(site, stage, input.art)`，**查得到帧**才置
`previewBubble = true`（虚影都画不出来时不挂气泡）。输出三个字段：

| 字段 | 值 | 用途 |
| :--- | :--- | :--- |
| `levelBubble` | `territoryLevelBubbleText(site, stage)` | 复用文案真源，不另拼编号 |
| `levelBubbleFrame` | `levelBubblePendingFrame ?? levelBubbleFrame` | **红色未通关 `frame_02`**；红图缺失回退蓝图，别让编号消失 |
| `levelBubbleAnchorFrame` | 虚影那张建筑帧 | 让气泡抬到虚影顶上 |

`ITerritoryStationRender` 新增 `previewBubble?: boolean` / `levelBubbleAnchorFrame?`；
`syncStations` 的 `{...base}` 自动带过去，锁态把 `isCondition` 置 false 也不影响气泡
（层序仍是**气泡 > 锁 > 价格 > 虚影 > 建筑**）。

#### 三、视图层：只放宽两条门槛 + 按虚影抬升

```ts
const preview = content.previewBubble === true;
const visible = text !== '' && frame !== null
    && (preview || (content.icon !== null && !content.isCondition))
    && !content.hidden && !content.isLoading && !this.hintBubbleSuppressed;
```

`hidden` / `isLoading` / `hintBubbleSuppressed` 三道约束**原样保留**，气泡形状、点击、
层级也全部复用既有路径 —— 没有第二套渲染。

🔴 **位置坑**：`applyLevelBubblePosition()` 原本按 `iconSprite.spriteFrame` 算建筑可见高，
预告格 `icon` 是 null ⇒ `height = 0` ⇒ 气泡落回格心、压住价格与 35% 虚影。
改法是用 `levelBubbleAnchorFrame` 当锚点帧，缩放走 `previewAnchorScale()`
（**逐字复刻 `applyIconPlacement` 的归一系数** `BUILDING_VISIBLE_WIDTH / 可见宽 × iconSizeScale`），
与 `renderGhost` 传给虚影 View 的 `iconScale` 同源，因此两者逐像素对齐。
`dispose()` 必须把 `levelBubbleAnchorFrame` 置 null（站点节点池化复用，别把上一格的虚影高度带走）。

#### 四、玩法层：`isLevelSite` → `isAutoStartSite`

`TerritoryModel.selectSite()` 的锁态分支原来写 `lockedStage && this.isLevelSite(site)`
（`isLevelSite` 只含 `stage` / `boss`，注释还写着「asyncPvp 的弹窗带侦查，要留给人点」）。
改为 `lockedStage && this.isAutoStartSite(site)`，后者 `return this.isBattleSite(site)`
= `stage` / `boss` / `asyncPvp`。**`isLevelSite` 彻底删除**，避免旧口径留在源码里复活。

- 仍然只在 `!isCellUnlocked && !isAreaPassed` 时生效 → 已解锁 / 已通关走
  `detailSite = site` → 页面 `renderDetail` 的 `detail.playerStage` 分支 → 侦查面板照旧；
- `lockedStage === null`（绑不到 campaign 行）→ 退回 `handleUnlockOnly` 只解锁，不发空请求；
- `levelAutoStart` 开关（`chapterLevelAutoStartConfig`）判据只在 `selectSite` 一处，没动；
- `mode = match` 的 asyncPvp 与主线一样把开战请求交给匹配页，领地侧 `startBattle` 计数仍为 0。

#### 五、回归与既有坑

- 定向 `tests/territory-preview-bubble.test.ts`（12 条）：数据层四条判据 / 红图回退 /
  已解锁分色 / 视图真的可见 / 锚点抬升（有锚点比无锚点高 >20px）/ 三道门槛仍生效 /
  源码守卫（判据、`isAutoStartSite`、侦查面板保留）。
- 既有 `tests/territory-presenter.test.ts` 两条 asyncPvp 用例按新口径改写：
  「只解锁」的 `tips` 从 3 条 `已解锁，点击查看关卡` 变 `[]`，`beginBattle` 从 1 变 4，
  `nav.length` 从 1 变 2（第一跳由 `selectSite` 触发）。
- 🔴 `tests/territory-chest-bubble.test.ts`「气泡尺寸按底图走」用 `slice(at, at + 2600)`
  **固定字符窗口**取 `renderLevelBubble` 函数体；本轮加注释把窗口撑短，明明代码还在却报红。
  已改成按 `\n    private ` 找函数体边界 —— 以后再加注释不会再假红。
- 三份应用源码与相关测试都是 **CRLF**；改动走 `tools/patch_territory_preview_bubble.py`
  按 bytes 替换并自动保持行尾（带 `already` 幂等标记，可重复跑）。
- 结果：定向 4 个文件 **162/162 绿**；领地全量 `tests/territory-*.test.ts`
  **1049 条 / 1046 绿 / 3 红**，3 红全是既有（campaign 缺 battle card、`gradeProModifier`
  真表漂移、`全是 7/9 时整批跳过 ShowReward` 的旧正则）。`tsc --noEmit` 三份应用源码零错误。

### 3.40 SVN 合并后：首通「先通过、再切换」+ 第 2 章云层与地块固定 15px 间隔（2026-11-11）

需求两句（截图 = 第 2 章 `2-1` 红色编号气泡、浅色云纹紧贴六边形边缘、地块外圈没有一圈均匀留白）：

> 1. svn 合并后，章节通关动画丢失了，只有章节切换动画，章节首次通关需要播放章节通过动画后，再播放切换
> 2. 第2章的云层和地块没有固定间隔

🔴 **口径覆盖**：§3.22 的「只有玩家点章节按钮才播」说的是**模型命令来源**；本轮用户明确要求首通自动推进也播切换。
**不改模型命令通道**（`switchChapter` / `selectChapter` 仍是唯一两处发 `chapterSwitch` 的地方），
由页面在整章云散演完后用**同一组四段曲线**补起转场。

#### 一、为什么"只剩切换动画"（两条真因同时成立）

只读勘察：`territory-chapter-switch` + `territory-cloud` + `territory-battle-prelude` 当时 **82/82 全绿**
（旧用例没覆盖合并后的时序）；`TerritoryMapView.ts` / `TerritoryCloudView.ts` 在
`2026-11-11 14:09:46` **同一秒**被改过，仓库里还留着 `.mine` / `.rNNNN` 冲突残留
（`reference-image.json`、`zcds-building-spawn-shake.test.ts`）。本机没有 `svn` 命令，只能按代码倒推。

| # | 真因 | 症状 |
| :-- | :-- | :-- |
| ① | `chapterClearPending` 是模型**一次性边沿**（`emitStateChange()` 发一拍就消费）。只有它为真，`TerritoryCloudView.setChapterCleared(cleared, true)` 才走 `animate` 起整章云散；合并 / 回包时序把它冲掉 ⇒ 页面只看得到持久 `chapterCleared` 电平，云走 `instant` **直接收掉** | 章节通过动画整段消失 |
| ② | 旧编排里 `advanceCompletedChapter()`（首通自动推进）**不发 `chapterSwitch` 命令**，页面压住换图等云散；云散没演就直接补画新章 | 「先通过后切换」根本串不起来，玩家只看到换章 / 切换镜头 |

🔴 只修任一条都不够：光补边沿只能把云散找回来，后面仍没有切换；光补切换会在通过动画之前就把新章画上来。

#### 二、首通编排：五拍串接（全部在页面侧）

`MainTerritoryMap` 新增三个字段 + 一个参数：

| 字段 / 参数 | 语义 |
| :-- | :-- |
| `lastRenderedChapterCleared` | 上一次**真正渲染过**的通关电平，用来算 `false→true` 边沿 |
| `chapterClearFollowup` | 「这一轮是首通自动推进」的意图标记（手动切章会被 `beginChapterSwitch` 清掉） |
| `chapterClearSwitch` | `{ from, to }`，云散演完后要补起的那一段切换 |
| `IChapterSwitchState.deferRender` | 这段转场期间**新章不许画**，等云盖满（`wait` / `reveal`）才放行 |

| 拍 | 触发 | 页面动作 |
| :-- | :-- | :-- |
| 1 | 首领打通那一拍 | `firstClearEdge = state.chapterCleared && !lastRenderedChapterCleared && !chapterChanged`；`clearSignal = chapterClearPending \|\| firstClearEdge` ⇒ 置 `chapterClearFollowup = true`，并把 `clearSignal` 当 `chapterClearPending` 喂给 `renderMap`（**云才会走 `animate`**） |
| 2 | 模型 `advanceCompletedChapter()` 立刻 `loadChapter(下一章)` | `renderAll()` 见 `chapterChanged && chapterClearFollowup` ⇒ 记 `chapterClearSwitch = {from, to}`、`chapterSwapPending = true`、**return 不画新章**（`syncGrid` 的 `clouds.reset()` 不许掐断云散） |
| 3 | `update()` 发现 `chapterClearPlaying === false`（云散演完） | ①-b 调 `beginChapterSwitch(from, to, true)` 补起 `lead → cover → wait → reveal`；演不了（`beginChapterSwitch` 返回 false）就 ①-c 直接换章，**绝不把玩家卡在旧图** |
| 4 | 转场进 `wait` / `reveal`（云已盖满） | ② 把 `deferRender` / `chapterSwapPending` 清掉，`renderAll()` 这才发现新章并揭幕；`lead` / `cover` 期间 `renderAll` 里的守卫继续压画，否则会提前露新图 |
| 5 | 转场被超时 / 打断收掉 | ③ `chapterSwapPending && !chapterSwitch` 兜底补画，`lastRenderedChapterCleared` 在每次真正渲染后落定 |

```ts
const firstClearEdge = state.chapterCleared && !this.lastRenderedChapterCleared
    && !chapterChanged;
const clearSignal = state.chapterClearPending || firstClearEdge;
if (clearSignal && state.chapterCleared) this.chapterClearFollowup = true;
```

| 关键约束 | 为什么 |
| :-- | :-- |
| 🔴 `firstClearEdge` **必须带 `!chapterChanged`** | 切回一个早就通关的章节时 `lastRenderedChapterCleared` 还是 false，不带这个条件会误判首通、重演一遍散场（§3.22 四「散雾只给首次通关」） |
| 🔴 `clearSignal` 要**同时**喂给 `renderMap` | 只置页面字段、不给地图，`setChapterCleared` 仍收不到 `animate=true`，通过动画照样不演 |
| 🔴 手动切章清掉 `chapterClearFollowup` | 玩家点章节按钮与首通自动推进是两条路，别把意图标记带过去二次补转场 |
| 模型命令口径**一个字不改** | 新编排只在页面侧补起同一段演出；`tests/territory-chapter-clear-followup.test.ts` 有源码守卫钉住「模型仍只有 `switchChapter` / `selectChapter` 两处发 `chapterSwitch`」 |
| `heroBadge.step()` 排在 `update()` 所有早退之前 | ① 的 `if (chapterClearPlaying) return` 会把整串英雄徽标队列卡住（代码注释已写明） |
| 转场 ① / ② / ③ 的顺序不能换 | ① 先补画新章，② 才可能揭幕；② 期间还要压住 ①-c 的「普通换章补画」分支（`!chapterSwitch?.deferRender`） |

#### 三、第 2 章云层为什么没有固定间隔

`CloudKeepOut` 反向遮罩按 `territoryCloudKeepOutPoints()`（`TERRITORY_CLOUD_KEEP_OUT_PX = 15`，
**地块轮廓 = 格面 + 侧壁**外扩 15px）描擦除区，但遍历的是 `cloudCells`
（= `sites[].cellId` + `randomSites.candidateCells` + `startCellId`）。
§3.27 之后预告披露的是**整关 footprint**（`chapter_02` 起一关 5~10 格），
`paintHexes` 会把这些格画成地块，它们**不在 `cloudCells`** ⇒ 云纹直接盖到地块边缘，
视觉上就是「第 2 章起云和地块之间没有那一圈固定留白」。

真表佐证（第一关 footprint 与 `cloudCells` 的差集）：

| 章 | 第一关 footprint | 漏描 |
| :-- | :-- | --: |
| `chapter_01` | `[327, 328]` | **0**（都在表里，旧口径不露馅） |
| `chapter_02` | `[306, 309, 327, 328, 329, 330, 348, 350]` | **7 / 8** |
| `chapter_03` | `[331, 332, 350, 351]` | **3 / 4** |

修法：`TerritoryMapView.syncClouds()` 在 `setChapterCleared` **之前**注入全量格心：

```ts
this.clouds.setKeepOutPoints(input.layout.points);
this.clouds.setChapterCleared(input.chapterCleared, input.chapterClearPending);
this.clouds.sync(this.cloudCells, revealed, pockets, ...);
```

`TerritoryCloudView` 新增 `keepOutPoints` / `setKeepOutPoints()` / `forEachKeepOutCell()`：
**挡云区 `rebuildKeepOut()` 与消散层 `syncDissolveKeepOut()` 共用同一份遍历** ——
`keepOutIds`（= `revealed`）× 全量格心，已揭示格一个不漏。

| 坑 | 说明 |
| :-- | :-- |
| 🔴 **引用变化要强制重描** | 换章时坐标系换了，但 `revealed` 集合有可能碰巧一样 ⇒ `syncKeepOut` 的判等早退，旧多边形留在旧格心、15px 间隔整体错位。`setKeepOutPoints` 里按 `this.keepOutPoints === points` 判引用，变了就 `rebuildKeepOut()` + 把 `dissolveIds` 清空逼遮罩重画 |
| 🔴 `null` 退回旧口径 | 老用例 / 没有布局的退化路径不注入格心，此时 `forEachKeepOutCell` 退回「只遍历 `this.cells`」，别让无布局场景整块崩掉 |
| 消散层遮罩必须同源 | 「擦邻居」那层如果用旧 `cells`，消散时会在 footprint 格上留一圈云；两处都走 `forEachKeepOutCell` |
| ⚠️ 三份 VM 夹具要补桩 | `tests/helpers/territory-map-view-sandbox.ts`、`territory-building-shake.test.ts`、`territory-tile-frames.test.ts` 里的 `TerritoryCloudView` 是空壳类，新增调用不补 `setKeepOutPoints(): void {}` 会直接 TypeError |

#### 四、判据与回归

| 项 | 结果 |
| :-- | :-- |
| 定向 `territory-cloud`(56) + `territory-chapter-clear-followup`(9) + `territory-chapter-switch`(19) | **84 / 84 绿** |
| 领地全量 `tests/territory-*.test.ts` | **1065 条 / 1063 绿 / 2 红**，2 红全是既有：`territory campaign joins chapter levels, NPC teams and monster cards`（真表缺 battle card）、`全是 7/9 时整批跳过 ShowReward`（旧正则） |
| 广域 `chest-*` + `main-*` + `tab-button` + `new-treasure*` + `territory-*` | **1272 条 / 1261 绿 / 11 红**，全是既有 `ArenaRoot.prefab` / 资源栏几何 / 快速寻敌文案 / 真表漂移，**零新增红** |
| `tsc --noEmit` | 三份改动的应用源码**零错误**；`tests/zcds-building-spawn-shake.test.ts` 仍有 3 条 `TS1185`（`<<<<<<< .mine` / `=======` / `>>>>>>> .r1236` 的 SVN 冲突标记残留，本轮未清理） |

新增用例 `tests/territory-chapter-clear-followup.test.ts`（9 条，VM 真实例化 `MainTerritoryMap` 跑
`renderAll()` / `update()` 状态机）：边沿丢失时的电平兜底 / 切回已通关章节不重演 / 首通自动推进压画 /
演出顺序 / 降级与中断兜底 / 模型命令口径守卫 / 页面源码守卫 / 云层接线守卫。
`tests/territory-cloud.test.ts` 补 4 条：footprint 格不在 `cloudCells` 也有 15px 轮廓、
换章换了坐标系但 `revealed` 没变也要重描、消散层遮罩同源、三章真表佐证。

工具：`tools/patch_chapter_clear_followup.py`（8 个 hunk）、`tools/patch_territory_cloud_gap.py`（4 个文件），
都按 **bytes 精确替换**并自动保持 `MainTerritoryMap.ts` / `TerritoryMapView.ts` 的 CRLF、
新 TS / 用例的 LF，带 `already` 幂等标记可重复跑（沿用 §3.39 的行尾教训）。

### 3.41 飞舞的奖励图标要画在所有 UI 之上（2026-11-11）

需求一句（截图 = 第 2 章地图，`EXP` 小图标飞到「快速寻敌」按钮与底部聊天框一带被压住，
红圈标出其中一颗）：

> 飞舞的icon粒子要处在UI的上层，现在被聊天框挡住

#### 一、真层级：页面内「排最后」不等于屏幕最上层

prefab 实测（`assets/resources/ui/main/`）：

| 节点 | 子节点顺序（左 → 右 = 先 → 后渲染） | 后果 |
| :-- | :-- | :-- |
| `MainRoot` | `Bg` → `Content` → **`BottomNav`** | 底栏是最后一个 ⇒ 整棵领地页都画在它下面 |
| `Content / ArenaRoot` | `MapRoot` → `BeginGame` → `EntranceLayer` → `OSRankEntry` → `TopHud` → **`BottomHud`**（内含 `ChatBar`） → `ChestBar` | 领地页在 `MapRoot` 里，比 `TopHud` / `BottomHud` 都早 ⇒ 聊天框、快速寻敌、资源栏全压在页面上 |
| `ArenaRoot / MapRoot / MainTerritoryMap` | `MapViewport`（→ `MapLayer` → … → `GainLayer`） | `TerritoryOverlay` 懒建在页面根并排最后，**只在这一页内部**靠上 |

所以「把覆盖层在页面里再往后挪」是无效的：跨到 `ArenaRoot` 就被 `BottomHud` 盖，
跨到 `MainRoot` 又被 `BottomNav` 盖。唯一正确的落点是 **`MainRoot` 的最后一个子节点**。
弹窗由 `PopupManager` 挂在 `MainRoot` 之外 ⇒ 仍盖在图标之上（模态不该被飞过的粒子压住）。

#### 二、分工：页面找根、视图建层

🔴 **页面不许自己搭 UI**：`tests/territory-page-split.test.ts` 与
`tests/territory-battle-intro.test.ts` 两条架构守卫禁止 `MainTerritoryMap.ts` 出现
`new Node(` / `addComponent(`。本轮第一版把建层写在页面里，广域回归当场红这两条，已改回视图。

| 角色 | 职责 |
| :-- | :-- |
| `MainTerritoryMap.rewardFxRoot()` | **只找节点**：`findHeroTabHost()?.navBar.parent`（= `MainRoot`）；拿不到 `MainTabHost` 退 `hostPageRoot()`（= `ArenaRoot`，至少盖住聊天框）；再不行 `null` |
| `TerritoryMapView.mountRewardFxLayer(root)` | 懒建 `TerritoryRewardFx`：`layer` 跟随宿主、`addComponent(UITransform)` 撑尺寸、`setSiblingIndex(root.children.length - 1)`，然后 `setRewardFxHost(host)` |
| `setRewardFxHost(host)` | 换宿主时**丢掉在飞 / 池化中的图标**（旧节点挂在旧层，复用会「新层一个图标都不出现」），并作废 `heroRewardTarget`（旧宿主的局部坐标） |
| `rewardFxLayer()` | 顶层优先；没注入 / 节点已失效 ⇒ 回退 `ensureOverlayHost()`（旧行为，**不静默消失**） |
| `disposeRewardFxLayer()` | 页面 `onDestroy` 通知，收掉挂在 `MainRoot` 上的那个节点（它不随本页子节点销毁） |

| 关键约束 | 为什么 |
| :-- | :-- |
| 🔴 注入顺序 = `mountRewardFxLayer` → `setHeroRewardTargetWorld` → `playHeroRewardFlight` | 先换宿主再登记终点，否则这一批飞行的终点还是旧覆盖层坐标，整批飞偏 |
| 🔴 起点与终点必须同一套坐标系 | `cellPointInNode(cellId, host)` 从 `cellPointInOverlay` 抽出；`cellPointInOverlay` 仍给开箱 / 点击反馈 / 推镜用，不受影响 |
| `layer` 必须跟宿主 | 不跟 `_layer` 时整层不进 UI 相机，且**不报错**（与散图 `f9941` 同类静默故障） |
| 节点不吃点击 | 新层没有 `cc.Button` / `TOUCH_*` 监听；Sprite 子节点默认不参与触摸派发（对比 `MainPage.ensureChestBlankCatcher` 是显式 `on(TOUCH_START)` 才接点击） |

#### 三、范围：只迁「飞向英雄按钮」那批

| 表现 | 宿主 | 本轮是否迁 |
| :-- | :-- | :-- |
| 随机格飞向英雄按钮（`TerritoryHeroFlight`，≤8 枚 0.62s） | `MainRoot / TerritoryRewardFx` | ✅ 就是被聊天框挡住的那批 |
| 格心抛物线喷发 12 颗（`TerritoryGainBurst`） | `MapLayer / GainLayer` | ❌ 必须继续画在 `+N` 读数**之下**（§3.17）；喷发范围在地图中部，本来也到不了聊天框 |
| 开箱表演 / 点击反馈 / 云盖 / 切章镜头 | `MainTerritoryMap / TerritoryOverlay` | ❌ 另一套全屏表演与页面坐标系，动它们会连带改镜头基准 |
| 固定格开箱飞图标（`TerritoryChestView`） | 覆盖层 | ❌ 落点是顶部资源栏，不在用户截图范围内 |

> ⚠️ 「页面内覆盖层盖不过 HUD」这条对**开箱表演**同样成立；本轮只按用户反馈修飞行图标，
> 若后续发现开箱光柱 / 飞图标也被 HUD 压住，复用 `mountRewardFxLayer` 的宿主即可，别再建第二份层。

#### 四、判据与回归

- `tests/territory-reward-fx-layer.test.ts`（**19 条**）：三份 prefab 层级真值 / `MainRoot` 内无弹窗层 /
  运行时节点不进 prefab / VM 行为（注入、回退、换宿主清池、终点按新矩阵换算、起播把同一宿主交给起点与父层、
  `cellPointInNode`、挂载排最后与幂等、销毁回落）/ 源码守卫（页面不搭 UI、注入顺序、其它表演不许迁层）。
- 领地全量 `tests/territory-*.test.ts` **1087 / 1087 绿**；广域
  `chest-*` + `main-*` + `tab-button` + `new-treasure*` + `territory-*` **1294 / 1294 绿**；
  `tsc --noEmit` 两份应用源码与新用例**零错误**。
- 工具 `tools/patch_territory_reward_fx_layer.py`：从原始状态**一次到位**（按 bytes 替换、自动保持 CRLF / LF、
  `already` 幂等标记），重复执行会输出 `skipped`。
- ⚠️ VM 沙箱里建的对象与本文件**不同 realm**，`deepStrictEqual` 会因原型不同而假红 ⇒
  坐标断言一律逐字段比（`assert.equal(point.x, …)`）。
- ⚠️ 共享夹具 `tests/helpers/territory-map-view-sandbox.ts` 的 `cc` 桩补了 `Vec3` / 最小 `Node`；
  给 `TerritoryMapView` 加 import 时仍要全盘 grep `Unexpected dependency` 补白名单。

### 3.42 第 2 章 2-10 首领改成「裂开的笑嘴」：10 格 U 形（2026-11-11）

> 「修改第2关的2-10的boss 关卡形状，像裂开的笑嘴（绿框范围），保持正确的解锁关系，
>  用随机格或者固定格填充替换缺失的地块」

**先认清对象**：编辑器的红色格子上标的是「皇冠 + `2`」= 站点 id `boss_2` 的后缀。
`boss_2.configId = 10020`、`levelInfo` 里 `10020` 是 `levelChapter 2 / chapterStage 10`
⇒ **2-10 = `boss_2`**（不是 `boss_1`/10015 = 2-5）。

**为什么还需要反向核对几何**：编辑器画的是**正六边形**（列距 37.25 / 行距 43.5 / 相位 = 行距一半），
而游戏是压扁的（列距 92.25 / 行距 90 / 相位 ±22.5 = 行距四分之一）。两者**拓扑一致、仿射不一致**，
所以「从截图量像素反推格号」要靠 token 反算：先由金币/皇冠图标质心拟合出编辑器的列距/行距/相位，
把每个红像素归到最近的格心，才能得到 (u,v) 网格。直接拿游戏常量去套会整体错位。

**目标形状（D3，10 格）**

| 行 | 格 | 作用 |
| :--- | :--- | :--- |
| r12c6 | `246` | **退出 boss**，改回固定格 |
| r13c7~c13 | `267 268 269 270 271 272 273` | 嘴身（`270` = 承载格） |
| r14c9~c11 | `289 290 291` | 下唇，比嘴身低一层 ⇒ 中间下凹 = 张嘴笑 |

嘴身上沿是一条直线（304 那格已退出）⇒ 两端不外凸，配合下唇下沉就是「笑嘴」。
「裂开」的版本（下唇中间留一格当裂口）是 A 方案，用户最终选了 D3 连成一条。

🔴 **`270` 必须留在 boss 里，且必须继续当承载格**。它是 `boss_2.cellId`，而且
**17 个站点把 `270` 写进 `requiredCells`**（`asyncPvp_3`、`fixedResource_10/11/16/17/18/19/20/21/22/27/30/36/38/46/48/63`）——
它是通往下半区的唯一关口。`isPrerequisiteComplete` 对固定资源格有「只要可解锁就算完成」的特例
（§3.30），`270` 一旦变成资源格，那 17 格会在开局全部可解锁，推进线直接塌。
⇒ `unlock.requiredCells` 保持 `[314, 292]` 不动（两个前置都还在，无环）。

**「缺失地块」怎么填**：退出的 `246` 新建固定格 `fixedResource_90`
（`configId: fixedResource_246` / `requiredCells [270]` / `silverCost 15` / `exploreSeconds 1` / `staminaCost 1`）。

⚠️ **奖励要用 1023 + `69020`**：被并掉的 `289`（`fixedResource_46`）恰好是本章一个 1023 银币宝箱。
新格若用默认的 `1017`，本章 1023 宝箱会从 27 变 26（七章合计 148 → 147），等于顺手删了个设计好的宝箱。
所以把那个宝箱**挪到 246** ⇒ 数量与 §3.35 的守卫（148 格）都保持不变。

**站点总数 104 → 102**（吞 3 个固定格、补 1 个）⇒ 章节完成度分母少 2。
`tests/territory-map-config.test.ts` 里 `config.sites.length` 的期望值因此从 104 改成 102。

**发布落点变了（2026-11-11）**：`presets_io.py` 的 `DOC_TARGETS`（sever + client）已收成
`DOC_SEVER_TARGET = (sever,)`，`copy_territory_maps.copy_one` 只写
**Cocos 资源目录 + 策划 `sever`** 两处。策划 `json/client` 仍与 sever 保持一致（人工同步），
但**不再由脚本自动写** —— 以后改地图记得单独同步 client，否则七章里会只有被改的那一章不一致。

**脚本**：`tools/map-editor/patch_boss2_mouth.py`（幂等；`--dry-run` / `--no-publish`；
硬断言「除 `boss_2.footprint` 与增删的那几个站点外一律不许变」；另有两条前置校验：
退出集合必须等于 `[246]`、1023 宝箱数量必须持平）。

判据：`tests/territory-map-config.test.ts`（preset ≡ 已发布 + 站点数 102）、
`tests/territory-building-id.test.ts`（七章 148 格 1023 宝箱仍在），
`npx tsx --test tests/territory-*.test.ts` 全量 1097 条全绿。

### 3.42 SVN 合并后：未通关预告气泡变回蓝色（2026-11-11）

需求原文：

> 「合并svn之后，未通关的预告气泡又变回了蓝色，不是红色」

#### 一、现象与「旧用例全绿」的悖论

截图里同屏两颗编号气泡**都是蓝** `frame_03`：`2-9` 在绿色已通关地块（蓝是对的）、
`2-10` 在褐色未通关地块（应为红 `frame_02`）。而 §3.39 的
`tests/territory-preview-bubble.test.ts` **12 / 12 绿**，`stationRenderOf` 里两条
`levelBubblePendingFrame` 分支也都在 —— 与 §3.40 那次一样，是
**用例没覆盖合并后的实机状态**，不是代码被合并删了。

#### 二、逐项排除（全是绿的，别再往这些方向改）

| 环节 | 核对结果 |
| :--- | :--- |
| 路径常量 | `MapMarkerBadge`：`PASSED = image/spawn-region/frame_03/spriteFrame`（蓝）、`PENDING = image/spawn-region/frame_02/spriteFrame`（红），两者不等 |
| 磁盘资源 / meta | `assets/bundles/battle/image/spawn-region/frame_02.png`（红胶囊）/ `frame_03.png`（蓝胶囊）都在，`type: sprite-frame` + `@f9941` 齐全 |
| bundle 路由 | `BundleCatalog` 的 `image/spawn-region` → `BATTLE_BUNDLE`，`bundleForPath()` 两条路径都命中 |
| `Promise.all` 顺序 | 26 项与解构逐项对齐：`levelBubbleFrame`(蓝) → `levelBubblePendingFrame`(红) → `chestBubbleFrame` → `staminaIcon` |
| art 传递 | `loadTerritoryBattleArt → TerritoryChapterLoader.art → context.art → buildState().art`，整对象传，没裁字段 |
| 数据层判据 | `previewBubble` 分支与 `claimed ? 蓝 : 红` 分支都在；`isAreaPassed`、`isOpened`、`areaPeers` 口径未变 |
| 视图层 | `renderLevelBubble` 每帧 `if (bubble.sprite.spriteFrame !== frame)` 写回，池化复用不会残留旧图 |

#### 三、真因：`has()` 索引预检把「查不到索引」当成「图不存在」

```ts
// 旧实现（已删）
if (!(await assets.has(path, SpriteFrame))) {
    console.warn(`美术未在 bundle 索引中，使用矢量兜底：${path}`);
    return null;              // ← 静默判空，零报错
}
```

`CocosAssetService.has()` 走 `bundle.getInfoWithPath(path, SpriteFrame)`，查的是
构建产物 `config.json` 的 **paths 索引**；`load()` 才真正解析 uuid。两者不是一回事。
`spawn-region/` 下两张图的登记方式本来就不一致：

| 图 | `packable` | 登记方式 |
| :--- | :--- | :--- |
| `frame_03`（已通关蓝） | `true` | 进 `auto-atlas.pac` 图集 |
| `frame_02`（未通关红） | `false` | 独立散图 |

实机一旦对红图查不到索引，`levelBubblePendingFrame` 就是 `null`；
`stationRenderOf` 两条「未通关」分支的尾巴都是
`?? input.art.levelBubbleFrame`（**宁可蓝一下，也不能没气泡**），于是
`2-10` 和 `2-9` 一起变蓝 —— 与截图逐像素一致。

🔴 **为什么旧用例全绿**：`tests/territory-random-resource-render.test.ts:365` 等夹具把
`AssetService` 桩写成 `{ load, has: async () => true }`，`has=false` 这条分支从未被跑过。
「恒 true 的桩」是这类资源假阴性问题的通用盲区，凡改 `loadFrame` 必补一条 `has=false` 用例。

#### 四、修复：`has` 不参与「要不要加载」的判断

```ts
async function loadFrame(assets: AssetService, path: string): Promise<SpriteFrame | null> {
    try {
        return await assets.load(path, SpriteFrame);
    } catch (error) {
        let indexed = true;
        try { indexed = await assets.has(path, SpriteFrame); } catch { indexed = false; }
        console.warn(`[TerritoryPage] 战斗美术加载失败，使用矢量兜底：${path}`
            + `${indexed ? '' : '（bundle 索引也未登记此路径）'}`, error);
        return null;
    }
}
```

- **加不加载只由 `load` 自己判**：真缺图仍由 `catch` 返回 `null`，旧降级策略一字未改；
  只是不再「明明有图却判空」。正常路径还少一次异步索引查询。
- `has` 降级为**失败后把日志说清楚**（区分「路径拼错」与「资源没进包」）。
- ⚠️ **不要**顺手改掉「红图缺失回退蓝图」这条口径：那会让红图真丢时**整颗编号气泡消失**，
  比蓝更糟；用户要的是「本该有红图时别变蓝」，不是「宁可没气泡」。
- ⚠️ 函数头注释里逐字引用了旧写法 `if (!(await assets.has(...))) return null`，
  源码守卫必须**先去注释再断言**，否则会像 `territory-chest-bubble` 那次一样假红。

#### 五、回归

- 新增 `tests/territory-bubble-red-frame.test.ts`（**10 条**）：`has=false` / `has=true` / 单张
  load 失败三种实机状态跑真 `loadTerritoryBattleArt`；源码守卫（`load` 排在 `has` 之前、
  无短路 `return`、解构顺序）；磁盘 PNG + meta + bundle 路由真值；红图进 art 后
  `stationRenderOf` 预告 / 已解锁未通关取红、已通关取蓝。
- 定向 `tests/territory-preview-bubble.test.ts` **12 / 12 绿**；领地全量
  `tests/territory-*.test.ts` **1097 / 1097 全绿**；广域
  `chest-* + main-* + tab-button + new-treasure* + territory-*` **1304 / 1304 全绿**。
- ⚠️ 首轮曾跑出 1 红 `tests/territory-map-config.test.ts`
  「chapter two keeps the current editor site format…」`sites.length` **102 ≠ 104**：同一批
  SVN 合并**分批落盘** —— 当日日志已把 `chapter_02` 站点数 104 → 102 并把用例期望同步成 102，
  但合并中途用例先落回 104、地图已是 102；落盘完成后复跑即全绿。与气泡修复无关，**别去改地图表**。
- 两份改动文件仍为 **LF**；定向 `tsc --noEmit` 涉改动文件只剩 2 条环境错误
  （`cc` 模块声明缺失 + 其派生的 `JsonAsset.json`），新用例零错误。

### 3.43 新手引导收起底部 UI 时，云层继续向屏幕底填充完整（2026-11-17）

> 需求原文：「新手引导需要隐藏底部的UI框，当UI框被隐藏时，云层继续向底部填充完整」。
> 截图：上方云层铺到约 87% 高度后是一条笔直的水平断口，下面约 13% 是一整条橙色底图。

#### 一、真因：**Mask 裁切**，不是 inset / `contentPaddingBottom`

层级（真值取自 `assets/resources/ui/main/MainTerritoryMap.prefab`）：

```text
页面根 MainTerritoryMap  自身挂 cc.Sprite = image/zdbg1.jpg（橙色沙漠），720×1280
  └ MapViewport          cc.Mask(_type=0 GRAPHICS_RECT, enabled=true) + Widget(bottom=168)
                          UITransform 720×1112，顶边贴屏幕顶
      └ MapLayer  → GridLayer / CloudKeepOut → CloudFillLayer（铺满层）
```

`CloudFillLayer` 铺得再满也**出不了 `MapViewport` 的 rect Mask**。视口底边离屏幕底
`1280 − 1112 = 168` 正好是 `BottomNav`（720×152）+ 底下 HUD 的那一截；平时被底栏盖着，
`GuideComposition.syncDialogHud` 在引导有台词 / 焦点时把 `BottomNav` / `BottomHud` /
`TopHud` / `BeginGame` 一起 `active = false`，盖子一收就露出页面根那张橙色底图。
截图那条 13% ≈ `168 / 1280`。

🔴 所以**放大 `setFillArea` / 加大 `contentPaddingBottom` / 改 `bottomHudInset` 全都无效**：
它们改的都是 Mask 里面的内容层，画不到视口外面去。这也是本次最容易走错的一条路。

#### 二、修法：页面根第 0 个孩子补一条同源云带

| 决定 | 口径 |
| :-- | :-- |
| 落点 | 页面根**第 0 个孩子** `CloudBottomStrip`：压住橙色底图，但整层仍被 `MapViewport` 盖住 ⇒ 溢出到视口里的半朵会被不透明的 `MapBackground` 盖回去，**不需要第二层 Mask** |
| 几何 | `territoryCloudBottomStripPoints(rows, columns, 页面宽, 带高, 带中线)`：复用铺满层**同一张格网**（列距 92.25 / 行距 90 / 奇偶列相位一致），只把矩形整体平移到页面底部 |
| 带高 | **现算** `视口底边(页面局部 y) − 页面底边`，即 `viewport.position.y − viewportH/2 + pageH/2`；🔴 不许抄死 `168`，长屏 / 安全区变化会变 |
| 点亮判据 | 页面按 `MainTabHost.navBar.active === false` 判（底栏就是那条带的"盖子"）→ `TerritoryMapView.setBottomCloudFillVisible(bool)` → `TerritoryCloudView.setBottomStripEnabled(bool)`；页面**不反向依赖引导配置**，只转发一个布尔 |
| 时序 | `MainTerritoryMap.syncBottomCloudFill()` 排在 `update()` **所有早退之前**（过场 / 战斗前奏会 `return`），且带 `bottomNavNode` 缓存 + 值没变早退，不每帧重铺 |
| 收工 | `syncBottomStrip()` 只在「底栏收起 + 有云体帧 + 雾没散完 + 铺满层有节点」时点亮；`step()` 把铺满层第 0 朵的 `color.a` 同步到补云带 ⇒ 整片雾散完不会孤零零留一条云 |
| 帧晚到 | `setFrames()` 同时给补云带的体 / 影 `rebindSprites`（与铺满层 / 云洞层同一个坑） |
| 层级内序 | 层内第 0 个孩子是 `CloudBottomStripShadow`（影子分组），云体随后 ⇒ 影子永远在云体之下 |

⚠️ **页面不许自己搭 UI**：建节点、量视口、铺格点、排兄弟序全在 `TerritoryCloudView`；
`MainTerritoryMap.ts` 里一行 `new Node(` / `addComponent(` 都不许出现（架构守卫
`territory-page-split` / `territory-battle-intro`）。

#### 三、为什么不改视口几何

把 `MapViewport` 的 Widget `bottom` 改成 0 / 把 `UITransform` 拉高，确实能让云画到屏幕底，
但会连带改 `ScrollView` 的可滚范围、`bottomHudInset` 基准、`scrollToCell` 偏移与散场镜头倍率
（全页地块整体下移 84px）。引导期间地图会「跳一下」，且 `tests/territory-map-bottom-inset.test.ts`
那套 720×1112 实算全要重写 ⇒ 不如补一条独立的带。

#### 四、判据与回归

`tests/territory-cloud-bottom-strip.test.ts`（**11 条**）：

1. prefab 事实：`MapViewport` 的 Mask 启用、`_type = 0`、Widget `_bottom = 168`、高 1112；
   页面根 Sprite 是 `zdbg1`。
2. 纯几何：补云带点阵与 `territoryCloudFillPoints` 逐点同 x、y 只差中线平移；
   非法尺寸 / 行列 / 非有限中线一律返回空。
3. 接线：页面判 `navBar.active` 且排在 `update` 所有早退之前、只转发布尔；
   视图只做转发；云层用模型纯函数、挂页面根第 0 位、带高现算、帧晚到补帧。
4. VM 行为：底栏没收起时**一个多余节点都不建**；收起后第 0 个孩子点亮、体影成对、
   云心落在带内；开关反复切幂等；视口铺到页面底（带高 0）时不补；雾淡出 / 散完一起收。

回归（2026-11-17）：专项 **11 / 11 绿**、`territory-cloud` + `territory-map-bottom-inset`
**76 / 76 绿**、`npx tsc --noEmit` exit 0；领地全量 `tests/territory-*.test.ts`
**1168 / 1149 绿 / 19 红**、广域 1380 / 1359 绿 / 21 红、全量 `test:raw`
**6425 / 6352 绿 / 73 红**（本日基线 74 红）。🔴 这批红全是 **11-17 SVN 合并遗留**、
与补云带无关，且已逐条用 `.svn/pristine` 基线正本对拍：`?.` 空守卫被冲掉
（`chapterClearPlaying` / `disposeRewardFxLayer` / `resetChapterSwitchOffset`）、
锁层 / 虚影层插入锚点回退、配表数量漂移（`1023` 宝箱格 22≠23、合计 145≠146、
BOSS 波 24≠129）、`TerritoryProgress` 前置领地口径、无引擎视图类既有红。
同文件里被冲掉的两条 `?.`（`bindMapInsetResize` / `scrollToCell`）已顺手补回。

### 3.44 同一关卡节点的地块要一起换状态色（2026-11-18）

> 用户原话（配图绿圈）：「绿圈部分的地块也是归属关卡地块，现在没有和归属相关的
> 地块状态同步变化，待解锁是灰色，可激活就应该变成红色了」。
> 同图第 1 条「红框的云层和背景云层是分离的，如果不好实现可以不做」—— 见本节末尾的代价评估。

**现场**：`chapter_01` 的 1-1 由**两个单格站点**组成 —— `327`（`stage`、`configId=10001`、
没配 `buildingId`，即绿圈那格）与 `328`（同 `configId`、配了 `69004`，灰白带锁 +
红 `1-1` 气泡的承载格）。`chapter_02` 起则是「一个站点 + 5~10 格 footprint」。

**真因**：`TerritoryMapView.paintHexes` 原先**逐格**用自己 `cellId` 的
`isCellUnlocked / isOwned / isAreaPassed` 判地皮与格面框：

- `greyCell` = `isStructurallyBlocked(cellId)` ∧ `blockedCells.has(cellId)`，
  而 `blockedCells` 只由模型那份**逐格** `lockBlockedCells` + 被卡住站点的 footprint 组成；
  兄弟格与承载格只要有一格没进集合，就会出现「承载格灰、兄弟格褐」；
- `hexFrameOf(cellId)` 要 `siteByCell.get(cellId)`：footprint 里的格根本查不到站点 ⇒
  **永远拿不到红色 `frame_01`**；多格节点的兄弟格也各读各的进度 ⇒ 红框只挂在一格上。

🔴 **「一个节点只在一块地上长 UI」（§3.28）管的是锁 / 价格 / 编号气泡，不是整片地皮的颜色**。
这两件事同源但不同层：UI 继续收敛到承载格，地皮与格面框必须整片同步。
`territoryNodeMutedCells` / `territoryNodeLockCells` 一个字没动。

**改法**（`model/TerritoryNodeUI.ts` 两个纯函数 + `paintHexes` 三处接线）：

| 判据 | 旧 | 新 |
| --- | --- | --- |
| 状态代表格 | 自己 | `territoryNodeStateCellByCell` → 组内**唯一承载格**；无建筑时退回组内首站点；**多建筑节点不收敛**（各自承担 UI） |
| 整片置灰 | `lockBlockedCells` + 被卡住站点的 footprint | 再并 `territoryNodeGreyCells`：组内任一格被卡住 ⇒ 整组（含各自 footprint）一起灰 |
| `passed` / 框 / 置灰 | `isCellPassed(cellId)` / `hexFrameOf(cellId)` / `isStructurallyBlocked(cellId)` | 一律传 `stateCellId`；**写节点仍写 `cellId`**（`applyHexFrame(cellId, …)`、`applyHexLock(cellId, …)`） |

🔴 **多建筑节点（组内每格都有 `buildingId`）既不收敛状态代表格、也不整片摊灰**：
它们各自承担 UI，硬拧成一格会读错；两个纯函数用的是同一条边界。
🔴 `isCellPassed` 里的 `isAreaPassed` 本来就是 `configId` 区域口径，与本次收敛同源；
别再额外写一份「区域通关」判据。🔴 宝箱 / 随机格**不参与**节点组（`nodeGroups` 只收
`stage / boss / asyncPvp`），它们照旧各自判状态，不能被别人带灰或带红框。

判据：`tests/territory-tile-frames.test.ts` 新增 6 条（纯函数代表格 / 整片灰集合 /
待解锁三格一起灰 / 可激活三格一起挂红框 / 通关三格一起草地并摘框 / 源码守卫不许退回逐格）。
复刻的图是 `327 + 328 + footprint 329 + 节点外宝箱 900`（对照组）。

**第 1 条「云层分离」的代价评估（结论：先不做）**：`CloudBottomStrip` 用
`territoryCloudBottomStripPoints` 在「以补云带中线为原点」的局部矩形里重新推一套
`rowStart/rowEnd`，而 `CloudFillLayer` 用的是**全页格网**（`setFillArea` 的内容层坐标）。
两套格网在 `MapViewport` 的 rect Mask 底边处相位对不上 ⇒ 一条水平接缝 + 云朵被裁半 +
缝隙里透出 `zdbg1` 的橙色碎点（用户红框所见）。要真正消除必须：① 补云带改成沿用全页格点、
② 挂到页面根的层按 `contentShiftY` + `ScrollView` 的滚动偏移**逐帧**对齐 content 原点、
③ 重算淡出 / 换章 / 安全区指纹。而且铺满层随滚动移动、页面根那层不动，只做静态对齐
会在拖动地图时重新裂开。改动面 = 几何纯函数 + 云视图逐帧同步 + `territory-cloud` /
`territory-cloud-bottom-strip` / `territory-map-bottom-inset` 三组 VM 夹具 + 实机截图复核，
属于「不好实现」那一档 ⇒ 按用户许可**暂不处理**；现有补云带继续保证「不露橙色裸底条」。

### 3.45 固定格宝箱奖励粒子改道飞向底部卡牌 icon（2026-11-19）

> 用户原话（配图红圈）：「这个固定格宝箱打开奖励粒子往上飞的动画改成和随机格往
> 卡牌 icon 飞的动画一致，都是飞向底部菜单栏卡牌 icon，当对应的卡牌可升级时，也会触发进度动画」。

**现场**：截图红圈 = `TerritoryChest.prefab` 的 `Fly/FlySlot`（奖励图标 + `+N` 数量文字）飞到屏幕顶部中央。
`TerritoryChestView` 构造里写死 `setCatchPoint(0, height/2 - 46)`；
`setCatchPointOf(resId, x, y)` 本来支持按资源分开落点，但页面侧旧的 `wireRewardCatch()`
（`7/9 → ResBar.slotWorldPositionOf`，其余 → 英雄按钮）在 SVN 合并后**整段缺失**，
`tests/territory-hero-reward.test.ts` 还钉着
`setRewardCatchWorldPoint|slotWorldPositionOf|bar.playGainFeedback` 不许复活。
⇒ 没有任何调用方登记落点，全部 FlySlot 回落顶部中央，就是用户看到的「往上飞」。

**两条链路（改前）**：

| | 固定格宝箱 | 随机格 |
| :--- | :--- | :--- |
| 宿主 | `TerritoryOverlay`（页面层，被 `MainRoot/BottomNav` 压住） | `MainRoot/TerritoryRewardFx`（顶层，§3.41） |
| 落点 | 屏幕顶部中央（构造里写死） | `heroTabWorldPositionOf()` → 底栏卡牌 icon |
| 时间轴 | `chest_seq_*` 三档，`flyStart` = 0.80 / 1.05 / 1.35s，5/15/30 枚 | `TerritoryHeroFlight`，0.62s × ≤8 枚 |
| 落地反馈 | `setLandedHandler`（页面已不接，等于没有） | `setHeroRewardLandedHandler` → 按钮受击抖动 |

🔴 **不要试图把旧 `wireRewardCatch` 接回来只改个落点**：覆盖层在 `BottomNav` 之下，
图标飞到底部会被底栏盖住 —— §3.41 已经为随机格踩过一次。这次必须与随机格共用**顶层宿主**。

**改法：一条链路、三处接线**

```
页面 runChestOpening
  heroEntries = entries.filter(isTerritoryHeroRewardResId)
  → mountRewardFxLayer(rewardFxRoot())        // MainRoot 顶层，先挂宿主
  → setHeroRewardTargetWorld(heroTabWorldPositionOf(heroButton))
  → setHeroRewardLandedHandler(heroButton.playHitFeedback)
  → armChestHeroFlight(cellId, heroEntries)   // 只登记，不立刻飞
  → playChestOpen(cellId, tier, entries, handOff)   // 四参签名一个字没改
视图 ensureOverlayHost
  → chestView.setFlyStartHook(() => launchChestHeroFlight())
开箱表演 step
  → elapsed 跨过 spec.flyStart ⇒ 钩子发一次
  → launchChestHeroFlight → playHeroRewardFlight(cellId, entries)   // 随机格同一个入口
```

🔴 **起飞必须等 `flyStart`**：三档表演先把箱子推到屏幕中央（`cameraFocus → 1`），
`playHeroRewardFlight` 的起点取「这一帧」的格心世界坐标（`cellPointInNode` 走引擎矩阵）。
在 `playChestOpen` 那一帧就飞 ⇒ 箱子还没开、图标已经飞走，起点还落在被镜头挪走之前的原格上。
时间轴归 `TerritoryChestView`（`spec.flyStart` 本来就是三档参数的一部分），地图视图不许再抄一份。

🔴 **Fly 层要逐枚让位，不是整层关掉**：`applyFly` / `fireLandings` 都按
`isTerritoryHeroRewardResId(rewards[index % rewards.length].resId)` 判；
只留钱包类（`7` 银币 / `9` 体力）走原落点。判据与随机格共用 `model/TerritoryHeroReward` 的同一条真源，
不许按 `18xxx 碎片 / 16xxx 经验` 白名单枚举。整层关掉会把银币的 `+N` 一起吞掉；
整层不改则同一批奖励一上一下飞两遍。

🔴 **待飞批次四处作废**：`launchChestHeroFlight` 起播后清、`playChestOpen` 起播失败清、
`stopChestPlay` 打断清、`resetHeroFlights`（换章 / 顶层宿主换层）清；
`play()` / `stop()` 各自把 `flyStartFired` 复位 ⇒ 下一场到点还能再发一次。

**「卡牌可升级 ⇒ 进度动画」不用新接线**：`presentRewards` 开头的
`void this.playHeroBadges(rewards)` 排在所有分流之前（§3.37 ③），
固定格 / 随机格 / 银币宝箱 / 挂机弹窗四条路都覆盖；`TerritoryHeroProgressSource.newlyReady`
按「预测叠加」判本次新达成，`HeroFragmentBadge` 在英雄按钮上方按卡库顺序串行播放。
本次改动**没有**碰它，也没有为「等图标落地」再触发一遍 —— 同一个 `newlyReady` 连查两次会入队两次。
时序上徽标在奖励回包那一刻起播、比图标落地早；这是 §3.37 的既有口径，按「不新造平行状态机」保留。

**降级**：拿不到 `MainTabHost` / 英雄按钮 / 顶层宿主 ⇒ `heroRewardTarget` 为 null，
`playHeroRewardFlight` 整段跳过；开箱表演、交棒 `ChestRewardsReady`、奖励结算一个都不少（纯表现）。

**判据**：`tests/territory-chest-hero-flight.test.ts` **14 条**（判据真值 / 三档起飞时刻 /
起飞钩子只发一次且掉帧跨过也补发 / Fly 槽位逐枚让位 / 落地通知跳过改道资源 /
待飞批次只起播一次 / 接线顺序 / 进度徽标仍在所有分流之前）。
用 `Object.create(prototype)` 的最小 VM 夹具直接跑
`TerritoryChestView.step / applyFly / fireLandings`，两个 model 模块给**真模块**（不抄判据）。

**回归**：领地 `1218 / 1200 绿 / 18 红`、广域 `1438 / 1417 绿 / 21 红`、
全量 `6764 / 6655 绿 / 109 红`。为把外来红剥干净，做了
「临时还原三个源文件 → 跑全量 → 按字节恢复（md5 校验）」对拍：
基线 `6750 / 6641 绿 / 109 红`，两份红单 `LC_ALL=C sort` 后逐条 diff **完全一致**
⇒ 本次 **0 条新红**、净增 14 绿。`npx tsc --noEmit` 21 条全在 zcds 合并遗留，改动文件零报错。

### 3.46 巡逻怪物宝箱（Monster Box）弹窗交互与升级协议（2026-11-19）

需求原文（2026-11-19 设计稿）：领地地图上的野怪宝箱格增加独立详情与升级弹窗（`ui/territory/TerritoryMonsterBoxPanel.prefab` + `view/TerritoryMonsterBoxPanel.ts`）。

#### 一、职责与交互三态

| 状态 | 视觉表现 | 操作可用性 |
| :--- | :--- | :--- |
| **基础态 (Lv.1~3)** | 点阵（当前等级高亮） + 守护怪 + 奖励列表 + 「升级宝箱」主按钮 + 「开始挑战」副按钮 | 两个按钮皆可交互。设计定位「升级为主、挑战为次」 |
| **升级态 (upgrading)** | 点阵切换为进度条（0~100% 动效） | 双按钮禁用并压色（`BTN_DIM = new Color(120, 118, 112, 255)`），防连点与穿透 |
| **满级态 (Max Lv)** | 点阵全亮、守护怪全解锁、隐藏升级按钮 | 仅保留「开始挑战」按钮，自动居中对齐；`upgradeCost <= 0` 隐藏升级入口 |

#### 二、纯渲染契约与协议数据流

1. **纯渲染契约（View 不做业务推算）**：
   - 弹窗通过 `applyContent(content: ITerritoryMonsterBoxContent)` 驱动，脚本内严禁自算消耗、成功率、守护怪状态或关卡数值。
   - 缺省数据（`0` / 空数组 / `null`）一律解释为「无该项数据」，UI 整块隐藏，严禁出现「数据尚未下发却显示 0 级 / 0 银币」的误导表现。
2. **写请求与单调合并（只发不等）**：
   - 点击「升级宝箱」通过 `EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'upgradeMonsterBox', cellId } })` 报告意图。
   - `TerritoryController` 将意图分发至 `TerritoryModel.upgradeMonsterBox(cellId)`，向服务端发起 `CmdCityChapterUpMonsterBoxLvReqMsg { levelChapter, cellId }`。
   - 客户端**不预扣银币**、也**不本地 `lv + 1`**；升级结果由服务端通过 `CmdCityChapterUpMonsterBoxLvRspMsg` 下发确认。
   - 回包成功（`succ = 1`）时，通过 `TerritoryCellRepository` 解析并单调合并最新 `monsterBoxInfo` 到快照状态；回包失败（`succ = 0`）或超时报错时，弹出提示并作废在途写票据，保留界面状态可重试。
3. **按钮布局与居中规范**：
   - 双按钮共存时采用成对排布（升级为主在右/主位，挑战在左/副位）；当升级按钮隐藏时，挑战按钮需动态居中对齐，避免单按钮偏于一侧。
4. **判据**：
   - `tests/territory-monster-box.test.ts`（数据解析、状态收窄、等级查表、单向合并与异常裁剪）。

### 3.47 巡逻宝箱怪「未挑战成功」与关卡地块同形（2026-11-19）

> 用户原话（配图红圈）：「新增的巡逻宝箱怪没有挑战成功前和普通的关卡地块一致
> 1.激活后的地块是红色的
> 2.巡逻的宝箱怪和战斗内的其他玩家卡牌一样叠加暗色和红色描边（一样的形式
> 3.战斗胜利后这个形象取消叠加，回复正常的颜色，地块同理（和关卡一致」

**现场**：截图里 `1-1` 普通关卡承载格带红 `frame_01`、附近棕色泥土块一起红；绿色宝箱怪站在棕色地块上，
地块不红、怪物也没暗色 / 红描边。`chapter_01` 有 31 个 `patrolChest` 站点（5 片，每格一个站点、
footprint 全是单格），同 `site.id` / 同 `battleId` 组成一片。

**三条真因（互不相关，缺一条都只修好一半）**：

| # | 真因 | 位置 |
| :--- | :--- | :--- |
| ① 地块不红 | `TERRITORY_SITE_FRAME` 只配了 boss / stage / asyncPvp / fixedResource，**没有 `patrolChest`** ⇒ `hexFrameOf` 查表落空返回 null | `TerritoryMapView.ts` |
| ② 胜利后地块不同步 | `isCellPassed` 对宝箱格走逐格 `isOwned`，而巡逻区是「同 `battleId` 任一格占点即整片通过」 ⇒ 只绿了占点那一格，同片其余还挂红框 | `TerritoryMapView.isCellPassed` |
| ③ 怪物没暗色 / 红描边 | `TerritoryMonsterPatrolView` 只做骨骼实例化、路径位移与朝向，**完全没有染色 / 描边逻辑** | `view/TerritoryMonsterPatrolView.ts` |

**改法**：

1. ① `TERRITORY_SITE_FRAME.patrolChest = 'frameStage'`。🔴 **不是 `frameChest`**：
   `fram_02` 蓝是「待领取的宝箱」，巡逻宝箱是「待挑战的怪」；普通关卡槽位 `frameStage`
   现在加载的就是红 `frame_01`（§3.44 / `TerritoryPageAssets`）。
2. ② 抽 `territoryPatrolPassedCells(sites, progress)` 到 `model/TerritoryMonsterPatrol`，
   发布帧 `TerritoryViewState` 把它和 `monsterPatrols` 同拍冻结 → 页面透传 `patrolPassedCells`
   → `paintHexes` 的 `isCellPassed` 早于站点查询命中即 `true`（footprint 格查不到站点也能吃到）。
   缺省用模块级 `EMPTY_CELL_SET`，不在每帧 `new Set()`。
   🔴 2026-11-20 起这份集合**只管表现与地块状态**（野怪恢复原色 / 收描边、地皮转草地、
   摘红框），不再参与野怪生灭；旧版「与停巡判据同源」那句已作废，见 §3.50。
3. ③ 复用战斗内 `ZCUnitView` 的**同一形式**：
   - 主骨架 `sp.Skeleton.color = #828282`（`OTHER_PLAYER_TINT`，顶点色相乘；不是盖一层黑 Sprite，
     那会把怪外面透明区也涂黑）；
   - 同一份 prefab 的第二个实例放大 `1.08`、插在本体子节点第 **0** 位（先画副本 ⇒ 大出来的
     那一圈才是「边」，顺序反了整只怪变成红色块）、`customMaterial` 挂 `shaders/unit-outline-copy`、
     `premultipliedAlpha = true`（shader 按预乘口径输出）、染 `ZC_CLIENT_COLORS.enemyEdge = (251,73,105)`、
     与本体同 clip 起播；
   - `step()` 每帧把副本 `trackTime` 对齐本体，防止红边慢半拍；隐藏的副本不参与锁相。
   - 材质由 `TerritoryChapterLoader` 加载 `EffectAsset` 后 `new Material().initialize({effectAsset})`
     挂进 `art.monsterOutlineMaterial`；只在这章真有巡逻怪时才加载，失败 `catch` 降级
     「只压暗、不描边」（绝不退化成一只放大的红怪）。
4. 胜利后：`applyLook()` 每次 `sync` 写**绝对色**（白 / 暗）与副本 `active`，不靠「创建时染一次」
   —— 节点按 `cellId` 复用，缓存判断会残留上一次的暗色。
   🔴 2026-11-20 定案（§3.50）：通关片区**野怪继续巡逻**，不再消失；`clearedCells` 命中时
   这只怪写回原色、收起描边副本。旧版「通关即不生成、叠加随野怪一起消失」已被覆盖。

🔴 **参数不许各写一套魔数**：`TERRITORY_PATROL_DIM_RGB / EDGE_RGB / OUTLINE_SCALE /
OUTLINE_EFFECT_PATH` 集中在 `model/TerritoryMonsterPatrol`；`tests/territory-patrol-look.test.ts`
用源码守卫反查 `ZCUnitView` / `ZCTheme` / `ZCGameLoader` 的同名常量，任一边改了都红。
领地页**不反向 import `zcds/view`**（分层），只搬数值 + 守卫。

**判据**：`tests/territory-patrol-look.test.ts`（整片通过含 footprint / 通关后继续巡逻 /
发布帧冻结 / 暗色与描边全字段 / 胜利双向恢复 / 端到端通关帧 / shader 缺失降级 / 锁相 /
`clear` 一次销毁 / 四组同源守卫 / 三处接线守卫）；`tests/territory-tile-frames.test.ts` 追加 **4 条**
（激活未通关红框且不误伤普通宝箱 / 未解锁不提前红 / 胜利整片转草地摘框 / 映射表源码守卫）。

**回归**：专项 `12 + 4` 全绿；定向组合 `65 / 65` 绿；领地 `1237 / 1224 绿 / 13 红`，
13 红全部是 11-19 基线 18 红的子集 ⇒ **改动范围 0 条新红**；全量 `6821 / 6697 绿 / 124 红`，
比基线多出来的 28 红全在 `zcds-*` / `bigmap-*` / `popup-fullscreen-widget` / `maintask`，
属外部进程改表漂移，涉及本次改动源码的红 **0 条**。`npx tsc --noEmit` 仍是 zcds 合并遗留 21 条，
改动文件零报错。行尾：源码 / 用例主体 LF，`TerritoryViewState.ts` / `TerritoryModel.ts` /
`territory-tile-frames.test.ts` / 本规范保持 CRLF。

### 3.48 巡逻野怪片区：解锁 / 激活 icon 只落在配了野怪 id 的那一格（2026-11-20）

> 用户原话（配图红圈 / 绿圈）：「同个节点的巡逻野怪地块，只在配置了野怪 id 的地块上展示
> 解锁 icon 和激活银币 icon，其他地块不显示，参考异步 PVP 地块」

**现场**：`chapter_01` 一片巡逻区 = 同 `site.id` 的 4~8 个 `patrolChest` 站点（31 格 / 5 片）。
截图红圈里每格都挂「银币 + 10 / 15」，读成「这一片要连续买十几次」；绿圈是异步 PVP 的
对照 —— 同一个节点两格，**只有承载格挂 100**，另一格是空地。

**真因**：「一个节点只在一块地上长 UI」那套收敛在 `model/TerritoryNodeUI.ts`，
但 `NODE_SITE_TYPES` 只有 `stage / boss / asyncPvp`，`nodeGroups` 按 `configId` 分组、
承载格按 `buildingId` 挑。巡逻格**两个字段都没有**（分组键是 `site.id`，承载格是 `patrolId`）
⇒ 两套收敛一条都命不中：

| 收敛 | 函数 | 巡逻格之前的表现 |
| :--- | :--- | :--- |
| 价格 / 编号 / 建筑 | `territoryNodeMutedCells` → `stationRenderOf` 早退 | 每格各画一条 `conditionIcon + caption` |
| 锁 | `territoryNodeCarrierByCell` → `territoryNodeLockCells` | `lockedCells` 原样透传，同片每格一把锁 |

**改法（只动 model 的收敛判据，视图调用点一字未改）**：

1. `model/TerritoryMonsterPatrol.ts` 新增 `territoryPatrolAnchorByCell(sites)`：
   按 `site.id` 一次分组，`cellId / footprint → 承载格`。承载格 = **配了 `patrolId` 的格**；
   没配的兄弟格指向组内 `cellId` 最小的锚点；整片都没配 `patrolId` 的旧图不给映射
   （调用方 `?? cellId` 退回逐格画法，不许整片 UI 凭空消失）。
   🔴 先写站点 `cellId`、再补 `footprint`，否则 footprint 压到同片另一站点时会把承载格覆盖掉。
2. `territoryPatrolAnchorCell`（后端上报用）**委托同一份锚点表**，但先校验 `site` 确实属于
   `sites` 里的同 `id` 片区 —— 锚点表按 `cellId` 建索引，旧图 / 合成 site 的 `id` 对不上时
   必须退回自己，不能因为 `cellId` 碰巧相同被别片拐走（既有 `366` 边界用例）。
3. `TerritoryNodeUI.ts` 两个函数各自合入这份映射：
   `territoryNodeCarrierByCell` 直接 `out.set`（锁收敛），
   `territoryNodeMutedCells` 把 `cell !== anchor` 的格加进 muted（价格 / 建筑 / 气泡早退）。
4. 🔴 **`NODE_SITE_TYPES` 不许塞 `patrolChest`**：`nodeGroups` 还供
   `territoryNodeStateCellByCell` / `territoryNodeGreyCells` 使用，塞进去会连带改地皮与红框
   的状态判据（§3.44 / §3.47），本需求只改 UI。用例专门钉死这条。

**边界**：进 muted 的格**任何状态都不画 UI，但仍可点、照常扣银币解锁**（与 §3.28 同口径）；
同片多格配了 `patrolId` 则那些格都显示；锚点被前置卡住时整片算未解锁 ⇒ 锁落在锚点、
价格整条摘掉（锁价互斥，不会并排）。普通宝箱 `fixedResource` 不参与这套收敛，照旧各画各的价格。

**判据**：新增 `tests/territory-patrol-node-ui.test.ts` **11 条**（真实五片锚点 / 与后端上报同源 /
carrier + footprint / 锁只留一把 / 旧图不收敛 / 多锚点 / footprint 压站 / 沙箱 `syncStations`
两态画法 + 锁价互斥 / 普通宝箱不受影响 / 两条源码守卫）；`tests/territory-node-ui.test.ts`
把 `muted.size` 从 `56` 更新为 `56 + 26`，并保留原有「战斗站点全部被隐」的覆盖。

**回归**：专项 `11 / 11` 绿；定向组合 `106 / 105 绿 / 1 红`（1 红是既有的
`TerritoryModel` 点击路由源码守卫，读的是本次未改的文件）；领地全量做「改动前 → 改动后」
字节级对拍：基线 `1249 / 1228 绿 / 21 红` → 改动后 `1260 / 1239 绿 / 21 红`，
21 条红单按用例名逐条完全一致 ⇒ **0 条新红，净增 11 绿**；全量 `6875 / 6761 绿 / 114 红`，
领地组 21 条红单与对拍结果一致，全量红单里没有一条指向本次改动模块。
`npx tsc --noEmit` 29 条全在 zcds 合并遗留，改动文件零报错；`verify:hygiene` 通过。

### 3.49 chapter_02~07 各补 5 片巡逻宝箱野怪地块（2026-11-20）

> 用户原话：「使用章节地图编辑器 编辑 chapter02~chapter07，每个章节增加 5 关巡逻宝箱野怪地块，
> 每关大约 4~6 个地块格子（在主格子上填写巡逻野怪的 id 和装饰宝箱 id 69021，参考 chapter01），
> 新增的地块可以替代之前旧的随机格，每章最多被替换的随机格不超过 15 个」
> 「同步在 pvp 关卡表中的章节野怪巡逻宝箱 SHEET，补充章节 2~7 4 个等级的宝箱奖励
> （1/2/3/4 级宝箱对应 1/2/3/7 个随机格的奖励数量，奖励类型需要对应所在章节的随机格奖励）」

#### 一、形状口径：为什么每片是「3 随机格 + 1 新增空地」

`chapter_01` 的五片是纯随机格改的（31 格 / 5 片，4~8 格一片）。这次有两条硬约束打架：

| 约束 | 数 |
| :--- | :--- |
| 5 片 × 4 格（用户说「大约 4~6」） | **20 格** |
| 每章最多替换的随机格 | **15 个** |

⇒ 至少 5 格必须来自「原本没有地块的空格」。而**空格要能补进片里，必须贴着随机格**
（不贴随机格的空地长出来与岛断成两截，那片永远点不到）。`chapter_04~07` 的岛是**十字形**，
随机格全在中段、边缘全是 `fixedResource`，够得到空地的随机格只有 8 个 ⇒ 铁定凑不出 5 片。
所以种子既可以是随机格，也可以是**贴着岛的边缘空地**（纯新增地形），每片最多吃 3 个随机格
⇒ 5 × 3 = 15 正好卡上限，多出来的用空地补。实测落地：ch2/3/4/7 各 15 随机格 + 5 空地，
ch6 14+6、ch5 12+8（十字/放射状岛形那两个方向实在没有可吃的随机格）。

#### 二、分布口径：「相对地图中心点匀称」怎么算

1. 把**所有可行片**枚举出来（每个随机格 / 边缘空地当种子，配额 4/3/2/1/0 各长一次，
   长法是「随机格优先 → 贴岛优先 → 离中心近优先」，逐格保证连通）；
2. 按方向角排序后做贪心（每步挑「最贴近上一步 +72°」且与已选片不相邻的那片），
   8 个起始偏移各试一遍；
3. 取**最小夹角最大**的一组（72° 是五等分上限），再给 10° 余量、在余量内挑吃掉随机格最多的。

落地最小夹角：ch2 65.0° / ch3 64.2° / ch4 63.5° / ch5 62.9° / ch6 63.1° / ch7 69.2°。

#### 三、字段口径（逐字照 `chapter_01` 的模板）

| 字段 | 值 |
| :-- | :-- |
| 一片 = | **同 `site.id` 的 4 条站点**，每条 `footprint: [自己]`（校验器只对 `patrolChest` 放行重复 id，并要求整片连通） |
| 主格 | 片内邻居最多的那格：`buildingId: "69021"` + `patrolId`（= 该关 **NPC 队伍 ∧ 塔防最后一波** 那只，见「七」） |
| 其余格 | `buildingId: ""`（空串 ⇒ 不画建筑，§3.48 的 muted 收敛把它们整片隐掉 UI） |
| `battleId` | **宝箱组 id**（`monsterBox.monsterBoxId`），不是 `levelInfo.levelId` —— 写错这一跳的表现是「开始挑战」恒灰、点格子弹「站点配置待补齐」，零报错 |
| `unlock` | 整片共用一个前置格（最近的主线 `stage`；**不许指 `fixedResource`**，会被 `isPrerequisiteComplete` 的「可解锁即完成」特例放大），`combatPower 0 / silverCost 10 / exploreSeconds 2 / staminaCost 5` |
| id | `patrolChest_<N>`，N 接该章既有站点的最大序号（编辑器建点顺序），逐章：ch2 `105~109`、ch3 `122~126`、ch4~07 `52~56` |

#### 四、宝箱表（`PVP-关卡.xlsx` / 「巡逻宝箱怪」页 = `monsterBox`）

巡逻关卡 `60011~60070`（`levelInfo.levelType == 4`，每章 10 条 = 5 组 × 2 档）**表里本来就有**，
缺的只是宝箱行 ⇒ 补 **120 行**（6 章 × 5 组 × 4 级）：

- 组 id `1006~1035`（`chapter_01` 占 `1001~1005`）；
- `monsterBoxLevel`：1~3 级 = 该组基础关卡、4 级 = 满级关卡（`60011/60012` 这种成对口径）；
- 奖励 = 该章随机池（`2001 + 章节号`，ch2=`2003`…ch7=`2008`）每条 `number × 1/2/3/7`，
  `pro` 与条目顺序不动 ⇒ 「奖励类型对应所在章节的随机格奖励」；
- 升级四列沿用 `chapter_01` 五个组共同的 `(0,0,0,0) / (20,90,2,99) / (20,60,2,2) / (20,40,2,2)`。

#### 五、落点 + 工具

| 东西 | 落点 | 工具 |
| :--- | :--- | :--- |
| 地图预设 + 发布 | `tools/map-editor/presets/territory/*.json` → `assets/resources/config/territory-maps/` + 策划 `sever/territorymap/` | `tools/map-editor/add_patrol_chests.py --preview`（会出 `tmp/patrol_preview_chapter_XX.png` 改前/改后对照图） |
| 巡逻野怪 id 重算 | 同上 | `tools/map-editor/reassign_patrol_ids.py [--dry-run]`（真源 `patrol_monster_source.py`） |
| 宝箱表 | 源表 `PVP-关卡.xlsx`（`sheet9.xml`，zip 级手术 + `inlineStr`）/ `json/{client,sever}/monsterBox.json` / `assets/remoteRef/monsterBox.json` | `tools/config/add_patrol_monsterbox.py [--check]` |

`add_patrol_chests.py` 的几何常量全部来自 `HexGridLayout.ts`（`92.25 / 90 / ±22.5`）与
`territory_format._neighbors`，**不要拿编辑器截图像素反推格号**（编辑器是正六边形、游戏是压扁的，
拓扑一致但仿射不一致）。

#### 六、判据与已知红

`tests/territory-patrol-chests.test.ts` **7 条**：每章 5 片 × 4 格同 id + 唯一锚点（`69021`）/ 前置格
必须是主线站点且不能是本片自己 / 巡逻格必须从 `candidateCells` 与 `buildingIds` 里让位 /
宝箱表四档 = 随机池 ×1/2/3/7 且关卡对 / 地图 `battleId` 全能在 `monsterBox` 查到 / 七章 30 个
`battleId` 互不重复 / **野怪 id 必须来自该关 NPC 队伍 ∧ 塔防波次**（第 7 条，见「七」）。
另外同步更新两条既有用例：
`tests/territory-map-config.test.ts`（ch2 站点 102 → 122，且 `patrolChest` 不参与 `configId` 检查）、
`tests/territory-node-ui.test.ts`（ch2~07 从「一格都不隐」改成「隐 15 格 = 20 格巡逻片 − 5 个锚点」）。

领地全量 `1269 / 1256 绿 / 13 红`，13 条红单**按名字与改动前逐条一致**（`levelInfo`/`npcTeam` 漂移
四条、`宝箱3.meta` 缺 spriteFrame 三条、ch01 的 1023 宝箱少 1 格两条、`territory-progress` 两条、
`69021` 不在 `build` 表一条、玩家关卡弹窗字号一条）⇒ **0 条新红**。

#### 七、地图上展示的野怪 id 从哪来（2026-11-20 定案）

> 「在地图上展示的野怪 id 从对应关卡的 npc 队伍配置和塔防出怪表的波次中抽取 1 个」

`patrolId` 直连 `monsterCard.id`（`TerritoryChapterLoader` 按它取 `unitPrefabPath` 生成巡逻野怪预制）。
填一只这关根本不会出的怪，**画面照常出、控制台零报错**，只有玩家能发现「打的关和地图上站的怪对不上」。

**取数链路**：

```
site.battleId（宝箱组 id）
  → monsterBox 里该组「等级最低」那行的 monsterBoxLevel        ← 与 patrolLevelIdMapOf 同口径
  → levelInfo 行：
       extraCards.enemy  → npcTeam.npcTeamId → npcCard[].cardID   （NPC 队伍，表内顺序）
       levelModValue     → defenceModWave.startId → monsterId      （塔防波次，按 waveId 升序）
  → 两个来源都成立的最后一只（= 收尾 BOSS 波）⇒ patrolId
```

**抽哪一只**（`patrol_monster_source.pick_patrol_id`，判据写进产物打印里）：

1. **波次里出现、同时也在 NPC 队伍里**的最后一只 —— 实数据里就是 BOSS 波那只，两个来源交叉命中，
   单边改表时最不容易漂；
2. 否则波次最后一波；
3. 否则 NPC 队伍最后一张卡；
4. 三个都空 ⇒ 抛错（这关没有怪，配不成巡逻）。

🔴 两张表的 id 域都是 `monsterCard.id`（`50001~50039`），`levelInfo.levelMonsterGroup` 是同一个域
但它只是出怪表的汇总，**不再是取数来源**（早期按它的「最后一档」取，波次一改就对不上）。
🔴 选出来的 id 必须能在 `monsterCard.unitPrefabPath` 里查到，否则整章加载抛
「巡逻野怪 X 缺少 monsterCard.unitPrefabPath」—— 脚本侧 `assert_monster_card()` 先拦。

**落地**：`chapter_02~07` 30 片**全部本来就是 BOSS 波那只**（0 处改动）；`chapter_01` 有 4 处不合规，
本轮一并修正（只改 `patrolId` 的值，锚点格、`footprint`、`unlock`、`battleId` 一个字节没动）：

| 片 | 格 | 宝箱组 | 关卡 | 原 → 新 |
| :-- | :-- | :-- | :-- | :-- |
| `patrolChest_155` | 387 | 1001 | 60001 | `50021` → `50022` |
| `patrolChest_158` | 331 | 1002 | 60003 | `50005` → `50023` |
| `patrolChest_200` | 208 | 1003 | 60005 | `50007` → `50031` |
| `patrolChest_174` | 128 | 1004 | 60007 | `50005` → `50032` |

（`patrolChest_179` / 宝箱组 1005 本来就是 `50005`，不动。原 `50005`/`50007` 在对应关卡的队伍与波次里
**都不存在** —— 手填的典型症状。）


🔴 顺带发现（**未改**，需产品确认）：`chapter_01` 的 `rewardId=1023` 宝箱现在是 **22 格**
（`territory-building-id` / `territory-silver-chest-open` 两条用例都按 23 写死，故红）。
`chapter_01.json` 的 mtime 停在 2026-11-20 10:37，不是本轮改的。
另外 `69021` 至今**不在 `build.json` 里**（`chapter_01` 的五格也一样）⇒ 巡逻主格的外观走
`patrolChest → fixedResource` 的贴图兜底，与 `chapter_01` 表现完全一致；要让它长成自己的贴图，
得先给 `69021` 补一条 `build` 行 + 图。

### 3.50 通关后的巡逻野怪：继续巡逻、只去掉暗色与红描边（2026-11-20）

> 用户原话（配图红圈）：「已经通过的巡逻宝箱野怪，会继续展示移动，样式要去掉颜色叠暗和红色描边」

**现场**：截图红圈是一片已通关的绿色地块（地皮已转草地、红框已摘），**里面一只怪都没有**；
右侧红色未通关地块上那只紫黑色怪还带着暗色 + 红描边。用户要的是：通关片区仍能看到怪按原路线
来回走，但它不再是「敌方」，所以取消叠加、恢复原色。

**真因**：§3.47 把「通关」同时接到了两条链路上 —— 表现链路（`applyLook(cleared)`，本来就是
「恢复原色 + 收起描边副本」）是**对的**；但 `buildTerritoryMonsterPatrols` 里还有一句
`if (passedCells.has(site.cellId)) continue;`（11-18 旧口径「打掉了这组敌人」），
通关帧直接**不发布这只怪**，视图根本没有节点可写 ⇒ 表现链路写得再对也看不见。

**改法（一处）**：删掉 `buildTerritoryMonsterPatrols` 的 `passedCells` 计算与那句 `continue`。
生灭从此只看「片区内格子是否全部开启」这一个可见性前置；`territoryPatrolPassedCells` 保留，
由发布帧 `TerritoryViewState` 同拍冻结，只喂两处消费：
`TerritoryMonsterPatrolView.applyLook`（怪恢复原色 / 收描边）与 `paintHexes.isCellPassed`
（地皮转草地 / 摘红框）。`MainTerritoryMap` / `TerritoryMapView` 接线一个字没动。

🔴 **不变量**：`monsterPatrols` 与 `patrolPassedCells` 必须仍是**同一拍**发布帧的两个字段 ——
通关帧里怪还在、集合也同时标成已通过，视图才能在那一帧既画怪又写原色。
`applyLook` 每次 `sync` 写绝对色，节点按 `cellId` 复用，缓存判断会残留上一次的暗色。
🔴 别把「已通过」重新写回生灭判据：那会让通关片区变回一片空草地。

**判据**：`tests/territory-monster-patrol.test.ts` 两条停巡断言改为「通关后仍按原路线巡逻」；
`tests/territory-patrol-look.test.ts` 改写 3 条并新增 1 条端到端 —— 通关帧仍发布同一只怪、
视图写回 `[255,255,255]`、描边副本 `active=false`、`step()` 后位置确实变化。
🔴 同轮把 `tests/territory-patrol-node-ui.test.ts` 的「必须委托锚点表」文本守卫换成
**行为对拍**（同片多锚点 / 旧图 id 对不上两条边界）：外部进程把 `territoryPatrolAnchorCell`
换回独立实现时文本守卫会假红，语义守卫不会。

**回归**：专项 `33 / 33` 绿；领地全量分步对拍（备份落盘、字节级恢复）
基线 `1269 / 1251 绿 / 18 红` → 改动后 `1269 / 1256 绿 / 13 红`，
diff 只有 5 条「基线独有」（新口径用例在旧判据下的预期红），**0 条新增红**；
13 条常驻红全在配置 / 建筑对齐 / 进度等外部漂移，两边逐条一致。
`npx tsc --noEmit` 31 条全在 zcds 合并遗留，改动文件零报错。

### 3.51 巡逻宝箱改用 `territory_monsterBox_L1~L4`（2026-11-20）

> 用户原话（配图 = assets 面板里 `image/territory/buildings/` 下的
> `territory_monsterBox_L1 / L2 / L3 / L4`）：「**巡逻宝箱使用这边的资源**」。

**这两张图原来没人用、锚点格也没长箱子**：`chapter_01~07` 的巡逻主格虽然配了
`buildingId: "69021"`（§3.49 的「装饰宝箱」），但 ① `69021` 至今不在 `build.json` 里；
② `stationRenderOf` 的宝箱分支对 `patrolChest` 一律 `icon: null`（11-19 的口径「野怪宝箱不画宝箱外观」）。
⇒ 玩家在图上只能看见地皮颜色 + 巡逻野怪 + 价格/锁，看不见「这里是个宝箱」。
详情弹窗那边更早：模型取的是 `image/main/chest/boxLevel{1..4}`（100×100 的新手宝箱 UI 图），
塞进 `ChestModel` 的 192×192 CUSTOM 尺寸里被放大近 2 倍，发糊，而且和地图上完全不是一个东西。

**改法（四处，缺一处就是「一半生效」）**：

| # | 位置 | 改了什么 |
| :-- | :-- | :-- |
| ① | `model/TerritoryMonsterBoxSpec` | 新增 `territoryMonsterBoxArtPath(lv, open)`（4 档 × 闭合/开盖，脏等级夹到 1~4）与 `TERRITORY_MONSTER_BOX_ART_SCALE` |
| ② | `application/TerritoryPageAssets` | 8 张图随 `loadTerritoryBattleArt` 的 `Promise.all` 一起加载 → `patrolChestFrames` / `patrolChestOpenFrames` / `patrolChestIconScale` |
| ③ | `view/TerritoryMapView` | 宝箱分支的 `icon` 对 `patrolChest` 走新方法 `patrolChestIconOf`；`iconScale` 取 art 透传的倍率 |
| ④ | `main/MainTerritoryMap` | 弹窗的 `loadMonsterBoxArt` 换成同一套路径（`territoryMonsterBoxArtPath(lv)`） |

🔴 **四条口径，改之前先读**：

1. **只有锚点格画**（带 `patrolId` 的那格）。一片巡逻区 4~8 格，每格都画会长出一排箱子；
   与关卡 / 异步据点「一片区域只在一格长建筑」同源（§3.48 / §3.49）。
2. **等级取服务端快照** `ITerritoryStationState.monsterBoxLv`；快照还没到（`0`）按 **1 档**画 ——
   锚点格先空着等数据，玩家会读成「这块地什么都没长」。
3. **通过判据是片区口径** `patrolPassedCells`（同 `battleId` 任一格占点即整片通过），不是逐格 `owned`；
   否则只有占点那格换开盖图，同片其余还闭合。取不到这份集合（老夹具）才退回 `owned`。
4. **开盖不换宽**：`TERRITORY_MONSTER_BOX_ART_SCALE = 0.82` 是**两态共用**的体量倍率。
   归一到可见宽 84 后，闭合版高 70.9~73.1（正常），开盖版被掀起的盖子拉到 **88.9~91.6**，
   而格面只有 90 高 ⇒ 直接「顶满格子」（`territory-cell-center-align` 的 0.85 上限）。
   乘 0.82 后闭合 58.1~59.9 / 开盖 72.9~75.1，**可见宽两态恒为 68.9** ——
   通过那一刻只有盖子往上长、宽度不变，不会读成「箱子突然缩小」。
   🔴 这个倍率**不要 import 进 `TerritoryMapView`**：视图每多一个依赖，所有 VM 桩表都要跟着补
   （`Unexpected dependency` 一次性红一片），所以由 `TerritoryPageAssets` 随 art 透传。

**判据**：`tests/territory-monster-box-art.test.ts` **5 条**（路径函数夹取 / 8 张图在盘上且是
212 正方形建筑规格 / 锚点格按等级取图 + 通过换开盖 + 快照没到按 1 档 / 兄弟格不画 + 缺图不崩 +
老夹具不传表退回「不画」 / 弹窗不再读 `image/main/chest`）。
`tests/territory-two-step-render.test.ts` 两条「宝箱格 icon」守卫按新语义改写
（普通宝箱领完照旧清图，野怪宝箱改由 `patrolChestIconOf` 取图）；
`tests/territory-cell-center-align.test.ts` 的高度护栏按**显示尺寸**（含 0.82）复算。

**回归**：领地全量 `1280 / 1265 绿 / 15 红`，15 条与改动前**逐条同名**（配置漂移 7 条、
`宝箱3开` 体量 1 条、`syncStations` 夹具缺 `randomResourceOpenableCells` 的 5 条、进度 2 条）⇒
**改动范围 0 条新增红**；其中 `宝箱3开` 那条在改动前是被 `territory_monsterBoxOpen_L1` 挡在前面
（同一断言先红在怪物箱上），本轮的 0.82 把它让过去了，`宝箱3开` 本身是美术遗留、未处理。
`npx tsc --noEmit` 6 条全在别人未提交的 territory 文件里，改动文件零报错。

**未做（需要产品或表侧确认）**：`69021` 仍不在 `build.json`（源表 `PVP-建筑.xlsx / 装饰建筑`）——
现在外观由代码按 `patrolId` + 等级解析，不依赖那一行；但 `territory-building-id.test.ts` 那条
「配了 buildingId 就必须在 build 表里查得到」还是红的。补表要走 xlsx → `ref_compress_json.py` 的正规链路。

### 3.52 碎片进度徽标：仅新达成展示 + 2px 间距 / 图标上方 10px（2026-11-20 定案，2026-11-22 修订）

> 11-20 用户：「合并svn后，点击固定格/随机格领取资源提示 卡牌可升级的 碎片+进度动画丢失了，
> 进度满了可以伴随闪光粒子，或者进度条刷光」。
> 11-22 用户（配图 `26%` 徽标压在「英雄」卡片图标上）：「卡牌碎片icon和进度的间隔应该只有
> 2px，他们出现的位置应该在底部菜单栏卡牌icon的上方10px的位置；卡牌碎片和进度的展示逻辑
> 是只有卡牌可以升级（碎片和经验值都满了）才会展示对应的卡牌碎片和进度，现在是每次领奖都展示」。

#### 🔴 11-22 修订：11-20 的「回落通道」已整条撤掉

11-20 曾判断「徽标丢失 = 11-10 的 `detectTerritoryHeroBadges` 只认本次新达成，口径太窄」，
于是补了 `detectTerritoryHeroBadgeProgress`（按 `min(碎片比, 经验比)` 演本次真实增量）。
**实机变成「每次领奖都弹一个 26% 徽标」，用户明确否决**。已删除：
`detectTerritoryHeroBadgeProgress` / `territoryHeroBadgeProgress` / `ITerritoryHeroBadgeItem.to` /
`ITerritoryHeroUpgradeState.cardOwnedAfter|expOwned|expOwnedAfter|expNeed`、
组合层两档取数、以及 `tests/territory-hero-badge-progress.test.ts`。

🔴 **触发口径回到 11-10（也正是 11-22 用户要的）**：只有 `!canUpgradeBefore && canUpgradeAfter`
（本次领奖让碎片**和**经验同时凑齐、卡牌从不可升级变成可升级）且非满级 / 未配置才入队；
领奖前已可升级、本次没凑齐、满级都不播 ⇒ **不会每次领奖都展示**。
判定真源仍是 `TerritoryHeroReward.detectTerritoryHeroBadges`，组合层
`TerritoryHeroProgressSource.newlyReady()` 只 `return detectTerritoryHeroBadges(states)`。
`presentRewards()` 开头 `void this.playHeroBadges(rewards)` 仍覆盖随机格 / 固定格 /
银币宝箱 / 挂机弹窗四条路 —— 覆盖的是「每条路都查一次」，不是「每条路都播」。

#### 版面（2026-11-22 定案）

| 项 | 值 | 真源 |
| :--- | :--- | :--- |
| 碎片 icon ↔ 进度条间隔 | **2px** | `BadgeIcon.x = -49`（宽 44 ⇒ 右缘 -27）；`BadgeBarBg.x = 25`（宽 100 ⇒ 左缘 -25） |
| 整组位置 | 底栏「英雄 / 卡牌」按钮图标**顶边上方 10px** | `LiftAnchor.y = 10`；`HeroFragmentBadge.placeAboveHeroButton` |
| 槽底 / 填充 / 数字 | 深灰 `(62,64,72)` / 绿 `(60,200,40)` / 白色 `NN%` | `BAR_BG_COLOR` / `BAR_FILL_COLOR` / `BadgePercent` |
| 满进度表现 | 长满 100% 起一道白光横扫 | `territoryHeroBadgeShineFrame` |

🔴 **位置不能再用「图标中心 + 固定 58」**：`TabButton.icon` 是 RAW Sprite，尺寸由
`spriteFrame` 回写，实际高度远大于徽标的 44 ⇒ 旧写法把徽标压在卡牌图标**中间**（11-22 截图）。
现在取 `iconTransform.convertToWorldSpaceAR(new Vec3(0, iconTransform.height / 2, 0))` 拿
**图标顶边世界坐标**，换回 `BottomNav` 局部后：
`badgeY = iconTopY + LiftAnchor.y + rootTransform.height / 2`。
顶边与中心都走引擎矩阵 ⇒ 图标节点的 scale 一起算进去，不自己猜截图高度。

- `HeroFragmentBadge.prefab` 的 `BadgePercent`（`UITransform 100×24` + `cc.Label`，
  系统字体 20px、`_overflow=0` NONE、白字细黑描边）保留；🔴 `SHRINK` 会因框高 < 行高把字缩虚。
- 🔴 **`HeroFragmentBadge.ts` 不许出现 `addComponent(`**（`prefab-mounted-components.test.ts`
  守卫）⇒ 节点只能落 prefab；视图用 `getChildByName` **软取**，prefab 被外部进程回滚时
  退化成「只有进度条」，不抛错、不阻断发奖。
- 刷光**不新建节点**：`barFill` 那支 `Graphics` 画完绿填充后，用同一支再叠一条 26px
  白色半透明光带（`rect`），位置 / 透明度全来自 `territoryHeroBadgeShineFrame(elapsed)`
  （`sin(πk)` 两端淡入淡出）。不建 `cc.tween`（徽标池化，tween 回收后还会继续写）。
- 🔴 `TERRITORY_HERO_BADGE_TOTAL_SECONDS` **必须写成 `grow + SHINE_SECONDS`**，
  不能写 `grow + hold + fade`：两个浮点加法顺序差 1 ulp ⇒ 光带收尾错开一帧、永远收不干净。
  `SHINE_SECONDS = hold + fade`，扫完徽标正好淡出，不额外拖长整个表演。

#### 判据与回归

- `tests/territory-hero-badge-layout.test.ts`（10 条）：仅本次新达成 / 回落通道已删除 /
  进度长满 / 刷光时钟与浮点边界 / 2px 间距 / 图标上方 10px / prefab 版面 / 软降级。
- 与 `tests/territory-hero-reward.test.ts`、`tests/prefab-mounted-components.test.ts`
  合跑 `28/28` 绿；领地全量 `1298 / 1283 绿 / 15 红`，15 条红单与 11-20 基线**逐条一致**
  ⇒ 0 新增红；全量 `7024 / 6926 绿 / 98 红`，红单无一条指向本模块；
  `npx tsc --noEmit` 6 条全在别人未提交的 territory 文件，改动文件零报错；
  `verify:hygiene` 通过。


### 3.53 巡逻宝箱：升级摇奖动画 + 守护怪读 `levelMonsterGroup`（2026-11-22）

> 用户原话（配图 = 面板节点树 `DotLabel` / `UpgradeProgress` / `GuardRow`，示意条 = 灰底 + 绿条 + 黄竖条）：
> 「1. 增加升级动画 DotLabel 圆点过渡切换成进度条样式，进度绿色和底框灰色比例代表成功率，
> 黄色竖条在进度上来回移动，停在绿色框内代表升级成功（根据服务端的回调，做个前端动画，
> 整个动画的总时间为 2.2s）；2. 守护怪要读取 `levelInfo.json` 中的 `levelMonsterGroup` 字段，
> 展示对应 id 的头像 `headIcon`。」

#### 一、摇奖动画（2026-11-24 改版：空星槽虚影 + 宝箱变白）

> 11-22 初版是「绿灰进度条 + 黄竖条在条上来回滑、停在绿区 = 成功，2.2s」，**11-24 整块替换**。
> 用户原话：「删除旧的进度条升级动画，替换成新动画：空的星星槽位里有星星虚影闪烁 + 放大缩小，
> 持续 1.2~2.5s，越接近成功时间就越久；星星闪烁伴随宝箱左右晃动的动画，同时宝箱逐渐叠加
> 纯白色（越来越白），升级成功从白色变成下一等级的宝箱，颜色逐渐过渡回来」。
> 确认口径（三选一）：**1.2~2.5s = 单次呼吸周期从 1.2s 逐渐拉长到 2.5s**（越接近出结果越慢），
> 整段时长仍等回包、但最短演满 1.2s；变白走**纯白剪影叠层**；旧进度条**整块删除**。
> 当天晚些又改了两轮（都只调 `TERRITORY_MONSTER_BOX_ROLL` 常量，曲线形状不变）：
> ① 傍晚「摇晃节奏和星星缩放的节奏要加强」⇒ 幅度加大；② 夜里「宝箱抖动是**原地**的抖动，
> 不是明显的左右挪，快速的原地抖动（轻微左右 3px + 明显的缩放 + 轻微的跳动/震动），**星星闪烁
> 频率再快 3 倍**，大小略大 15%」⇒ 呼吸周期整体 ÷3、振动改成 7Hz 三通道并与呼吸**解耦**、
> 虚影缩放整体 ×1.15；③ 同一晚再追加「升级成功和失败要有小区分：失败节奏逐渐变缓，成功则在纯白
> 时顿 3 帧（可按判断延长）再变化」，并要求**两侧都弹通用系统提示** ⇒ 成功加 `pausing` 顿帧、
> 失败加时间膨胀减速，结果 toast 从回包挪到**演完**（见下面「结果提示」一条）。

曲线仍只在 `model/TerritoryMonsterBoxRoll`（零 `cc`、15 条用例）。

| 段 | 时长 | 说明 |
| :--- | :--- | :--- |
| 呼吸 / 颤动 / 变白 | `max(1.2s, 回包时刻)` | 虚影在下一个空槽放大缩小 + 明暗呼吸（周期 0.4 → 0.833s）；宝箱**原地 7Hz 颤动**：水平 `±4` 逻辑 px（屏上 ≈3px）+ 垂直 `±2` 跳动 + 缩放 `1±0.08`；白色叠层 0→1 |
| **成功**：顿 | 0.08s（≈5 帧） | 最白 + 姿势冻结，**不换图**（`phase = 'pausing'`） |
| **成功**：换图 + 褪白 | 0.45s | 换下一等级宝箱图、白色 1→0 缓出 |
| **失败**：减速褪白 | 0.65s | 不换图；相位被时间膨胀拖慢（越走越慢）+ 幅度衰减 ⇒ 节奏逐渐变缓 |
| 定格 | 0.15s | 收尾（虚影归位、按钮解禁） |

- 🔴 **呼吸周期只增不减**：`period(t)` 从 `pulseFastSeconds = 0.4` 线性涨到 `pulseSlowSeconds = 0.833`
  （`pulseRampSeconds = 0.6` 内，整条时间轴 = 初版 1.2 / 2.5 / 1.8 的 ÷3），相位取**积分**
  `∫dt/period(t)`（闭式解 `ln(1 + k·t/p0)/k`）。直接写 `t / period(t)` 会在周期拐点让星星「跳一下」；
  周期反向变快会被玩家读成「快出结果了」而骗人（用例逐段比较整周期递增）。
- 🔴 **等结果期间白度只涨不落**：`whitenSeconds = 1.2` 爬到 1 后保持 —— 回包再慢也是「一直最白」，
  不许因为等得久又白回去。
- 🔴 **虚影用点亮的金星图、不新增美术**：节点 `StarGhost` 运行时建在 `LevelStars` 下，位置照抄
  `StarOff[lv]`（下一个空槽），`UIOpacity` 在 `ghostMinOpacity = 35 ~ ghostMaxOpacity = 170`
  之间随 `pulse` 呼吸，缩放 `0.805 ~ 1.495`（摆幅 ±30%，整体比初版 `0.7~1.3` 大 15%）。
  **别用空槽的暗星图**（压在暗星上闪不出来）。
- 🔴 **宝箱是「原地颤动」不是「左右挪」**（11-24 夜用户口径）：三通道各管一件事 ——
  `shakeX` 水平 `±4` 逻辑 px（7Hz，`sin(u)`）、`shakeY` 垂直 `±2`（`sin(2u)`，走「8」字轨迹）、
  `shakeScale` 缩放 `1 ± 0.08`（`sin(u)`，与水平同相）。**位移轻、缩放重**：宝箱约 90px 宽，
  ±8% 让边缘走 ±7px，远大于水平的 4px —— 这才是「抖动」的力感来源；水平幅度一回到两位数
  就变成用户明确否掉的「左右挪位」。三条都从 0 / 1 起手（`flutterPhase` 脏输入归零），
  点下去不会「跳一下」。
- 🔴 **振动与呼吸解耦**：`shakeHz = 7` 恒定（0.143s 一个来回，60fps 约 8.6 帧/周期），
  不再由 `monsterBoxPulsePhaseAt` 推 —— 呼吸只剩 1.2~2.5Hz，挂在一起就是「慢慢歪」。
  频率上限别超过 10Hz：缩放通道会频闪。落定后三者按 `release` 一起收敛（缩放收向 **1** 不是 0）。
- **「劲」不许回调弱**：用例 `★★宝箱原地快速震动`（起手归零 / 水平 ≤5 / 缩放 ≥±5% / `shakeHz ≥ 5`）、
  `★★震动手感`（1s 内换向 ≥8 次、缩放带来的边缘位移 > 水平位移）、`★虚影整体放大 15%`
  （摆幅 ≥0.6、中位 ≈1.15）守住下限。
- 🔴 **变白 = 纯白剪影叠层**：`ChestWhite` 是 `ChestModel` 的运行时子节点，同 `spriteFrame` +
  `customMaterial = art.monsterOutlineMaterial`（巡逻怪描边的 `shaders/unit-outline-copy`：
  **只采样 alpha、输出顶点色** ⇒ 白 tint 就是纯白剪影），`UIOpacity` 跟 `whiten`。
  **`Sprite.color` 是乘算、拉不到纯白** —— 别再试「把 `chestSprite` 染白」。
  材质缺省（老章节没加载那份 shader）⇒ 整层不建，只演呼吸与颤动（降级不崩，也不建一张同色复制品）。
- 🔴 **成功 / 失败要有「小区分」**（11-24 夜用户口径）：
  **成功 = 顿一下再换** —— 到最白那一帧起 `successFreezeSeconds = 0.08` 内 `phase = 'pausing'`，
  姿势与白度全部冻结、`revealing` 仍为 `false`（这一拍绝不换图），顿完才换图 + 褪白；
  **失败 = 慢慢泄劲** —— 没有顿，落定即进 `revealing`，但相位走**时间膨胀**
  `x → x − x²/(2·failFadeSeconds)`（瞬时速度 ∝ `1 − x/fade`，末速为 0），叠上幅度衰减 ⇒
  相邻换向间隔递增（实测 0.078 → 0.090 → 0.113 → 0.174s）。收尾时长失败 `0.65s` > 成功 `0.45s`，
  但别超过成功两倍（会像卡住）。用例 `★★成功后先「顿」`、`★★失败：…没有「顿」那一拍`、
  `★★失败节奏逐渐变缓`。
- 🔴 **顿的时长只认 `successFreezeSeconds`**：用户给的是「3 帧」，60fps 下只有 50ms、读不出停顿 ⇒
  取 5 帧（0.08s）。**改这一个常量就能调顿感**，别在视图里另加 `scheduleOnce`。
- 🔴 **换图只切一次**：`pose.revealing` 在成功落定那一刻变 true，视图用 `roll.revealed` 闸住；
  换图后立刻 `syncChestWhite()` 让白层跟新图 —— 否则白层还是上一张，褪白时会「露出旧宝箱」。
- 🔴 **结果提示挂在「演完」，不挂在回包**：回包 100~300ms 就到，动画要 1.2s + 顿 + 褪白 ⇒
  回包那一刻弹 toast 等于**剧透**（玩家还没看到换图就知道成了）。分工：面板 `finishRoll()` /
  `abortRoll()` 发 `monsterBoxRollSettled { cellId }`（只报「这一格演完了」），
  `TerritoryModel.notifyMonsterBoxRollSettled` 按 `monsterBoxAttempt` 取文案 ——
  失败 `monsterBoxUpgradeFailed`、成功优先 `monsterBoxUpgraded(lv)`（读快照里该格等级），
  快照里还没这格时退回 `monsterBoxUpgradeSucceeded`（**不本地 `lv + 1`、不猜**）。
  错误包（`CmdTips`）已经说过原因时 `silentWriteTip` 那一刻早已复位 ⇒ 用
  `monsterBoxTipSuppressed` 在 `noteMonsterBoxAttempt` 时把它记下来，演完不再补第二条。
  用例 `★★ 升级结果提示挂「演完」而不是回包`（意图类型 / Controller 分支 / 面板收尾发 /
  回包段内不得出现结果 `showTip`）。
- 🔴 **动画从点击起演、落点等回包**：`startRoll` 在 `handleUpgrade` 里先跑，`applyContent` 收到
  `upgradeAttempt` 才把结果交给播放态。回包早于 1.2s ⇒ 落定在 1.2s（最短演满，玩家无法靠
  「演得短」猜结果）；更晚到 ⇒ 继续呼吸、落点顺延（停住等网络＝看着卡死，先演再改＝演相反结论）。
- **播放期间不接整块重绘**：回包会带来新等级，直接重绘会把刚换上的宝箱拆回旧等级。
  内容先落 `pendingContent`，演完 `finishRoll()` 一次性重绘（按钮也在同一拍解禁）。
- 🔴 **结果只认「序号更大」**：`ITerritoryMonsterBoxAttempt.seq`（Model 每次升级 +1）。
  少了这条，玩家「失败 → 再点」时上一轮 `attempt` 还在内容里，新动画会立刻以旧结果落定
  （观感「点了没演就失败」）。
- `upgrading`（服务端下发的升级中态、没有本地开演时刻）⇒ 星槽静止、按钮置灰，
  **不再画静态进度条**；`content.upgradeProgress` 字段保留但面板不读。

#### 二、prefab 改动（`ui/territory/TerritoryMonsterBoxPanel.prefab`）

| 节点 | 改动 | 理由 |
| :--- | :--- | :--- |
| `UpgradeProgress` 整棵（`BarBg` / `Bar` / `Percent` / `RollMarker` / `Arrow`） | **删除**（23 个序列化对象；`Panel._children` 与面板 4 个字段同步移除，其余 `__id__` 整体重映射） | 11-22 的进度条方案已被 11-24 取代，留着会变成第二套并存的动画 |
| `ChestModel` / `LevelStars` | 不动 | 白层与虚影都是这两处的**运行时**子节点 |

🔴 删节点必须**同步删面板字段**（`progressRoot` / `progressBar` / `progressLabel` / `rollMarker`）：
只删节点会让 `@property` 悬空（Inspector 显示 `Missing`），只删字段会留死节点。
`tests/territory-monster-box-prefab-refs.test.ts` 两条用例双向钉住（节点没了 / 字段没了 / 两个锚点还在）。

#### 三、守护怪头像（`levelMonsterGroup` → `headIcon`）

四跳，每跳错了都零报错、只是「格子空着」：

```
monsterBox.monsterBoxLevel（这一级打哪关）
  → levelInfo[levelId].levelMonsterGroup（[{ monsterId, number }]）
  → monsterCard[monsterId].headIcon（图标名 **或** 直路径，2026-11-23 起两种都认）
  → 图标名经 icon.json[名字].path = ui://图标_兵种_头像/<拼音> ⇒ icons/cardHead/<拼音>.png
     直路径则直接拆 `目录 + 资源名`（见 §38）
```

- 🔴 **取「当前等级那一关」的配置**，不是静态绑定的 `stage.levelId`：等级行的 `monsterBoxLevel`
  会随等级换关（1002 组 grade 4 → 60004），按静态绑定取会在满级后显示上一关的怪。
- 🔴 **按 `monsterBoxLevel` 定位、用全表的 `monsterGroupByLevelId`**（`readTerritoryGuardMonsters`）：
  关卡自己的 `levelChapter` 不跟宝箱走，按章过滤会静默丢图。
- 数据链只在 Model 层：`loadTerritoryCampaign → campaign.monsterGroupByLevelId` 进
  `ITerritoryChapterBundle` → `buildTerritoryMonsterBoxDetail` 落到 `guards[i].headIcon`；
  页面（`MainTerritoryMap.prefillMonsterBoxGuardIcons`）只负责 `headIcon → SpriteFrame`，
  与「关卡提示」敌军头像同一条链（`createIconArtResolver` + `spriteFramePath`）。
- 缺图不阻断：`headIcon` 为空 / 查不到 ⇒ 保留 prefab 占位图，并把 key 记进
  `monsterBoxGuardIcons` 缓存（含 `null`）停止重试，不把格子藏起来（藏了与「未解锁」同形）。

#### 四、锁定态样式（2026-11-24）

> 用户原话：「4 级解锁文案写在 icon 下方（同数量 UI 对齐）；锁 icon 居中显示，提前披露出具体的
> 怪物样式 icon，不用纯色的底」。

| 项 | 旧 | 新 |
| :--- | :--- | :--- |
| 卡底 | 锁定换成深棕 `LockBg` 纯色底 | **删掉 `LockBg`**（3 个节点 + 组件字段 + 测试断言），锁定也用米黄 `CardBg` |
| 头像 | 锁定 `active = false`（只剩纯色底） | **锁定也画**（提前披露是哪只怪） |
| 锁标 | `y = 26`（压在头顶） | `y = 0`（压在头像正中） |
| 解锁文案 | `y = -10`（格子内、白字 19px） | `y = -62`（与 `CountLabel` 同一行、同色、同宽 108） |

- 🔴 **头像开节点条件 = `guard.unlocked || guard.icon !== null`**：已解锁恒开是沿用旧行为（图晚到时
  不会先闪一下空）；未解锁没图就关，免得槽位复用时串上一只怪。
- 🔴 **解锁文案与数量共用一行、互斥显示**（`unlockText` 为空 = 已解锁 ⇒ 显示数量），所以可以同位置；
  但**颜色必须是深棕 `(103,70,56)`** —— 旧版白字是给深棕底配的，换到米黄底会看不清。
- 数据侧不动：`buildTerritoryMonsterBoxDetail` 对未解锁的格**同样给 `headIcon`**（只有 `countText`
  是空串），`prefillMonsterBoxGuardIcons` 也不按 `unlocked` 过滤 ⇒ 头像会提前取好。

#### 五、判据

- `tests/territory-monster-box-roll.test.ts`（15 条）：呼吸周期只增不减 / 虚影取到两端 /
  原地颤动三通道（起手归零 / 水平轻微 / 缩放明显 / 频率 ≥5Hz）/ **震动手感**（缩放比位移显眼）/
  **虚影整体 ×1.15** / 等结果时白度只涨不落 / 落定 = `max(1.2s, 回包)` /
  **成功后先「顿」**（冻结 + 不换图）/ 成功换图后白度 1→0 缓出 / **失败不换图且没有顿那一拍** /
  **失败节奏逐渐变缓**（换向间隔递增）/ 迟到顺延 / 接口处不跳 / 脏输入不越界。
- `tests/territory-monster-box-prefab-refs.test.ts`（6 条）：进度条节点与面板字段都已移除、
  `ChestModel` 与 4 组 `StarOn/StarOff` 仍在、`LockBg` 已删、锁 `y = 0`、
  解锁文案与数量同 y 同色。
- `tests/territory-monster-box.test.ts`（14 条，除仓储/协议外新增 1 条）：**结果提示挂「演完」**——
  意图类型、Controller 分支、面板 `finishRoll` 先发 `settled` 再清 `roll`、回包段内不得出现结果 `showTip`。
- `tests/territory-monster-box-guard-slot.test.ts`（4 条，沙箱跑真实组件）：锁定也画头像、
  解锁后锁收起、锁定没图只收图标、空格整格隐藏。
- `tests/territory-monster-box-detail.test.ts`（+4 条）：守护怪头像按当前等级那关取、
  组配置缺失时退回静态关、无配置给空串、`upgradeAttempt` 原样透传。
- `tests/territory-monster-box-guards.test.ts`（4 条，**真表**）：70 个巡逻关卡都有 ≥3 只守护怪、
  每只都能查到 `headIcon`、`headIcon` 能在 `icon.json` 解析且资源文件在盘上、
  `levelMonsterGroup` 脏条目只丢那一条。
- 回归（2026-11-24）：`tests/territory-monster-box*.test.ts` **66 绿**（成功顿帧 / 失败减速 / 演完弹 toast 之后；同日编辑器重存 prefab 把一处 `UnlockLabel` 颜色冲回白色，已补回）；
  `territory-presenter-battle` / `territory-level-tip-icons` / `territory-patrol-chests` /
  `territory-two-step-render` 合跑 60 绿 / 1 红（红的是 `territory-presenter-battle` 的
  「流程接手时收掉关卡界面」：把本轮加的 `whiteMaskMaterial` 一行临时撤掉后**同样失败**，
  与本批无关，属工作区既有状态）；`npx tsc --noEmit` 25 条全在本轮未改的文件
  （`role/*`、`TerritoryProjection`、`TerritoryProgress`、`TerritoryCloudView`、`ZCUnitTargeting`），
  改动文件零报错。

### 3.54 异步 PVP 战斗结束：掉落宝箱获得动画（2026-11-22）

#### 一、需求

> 「异步pvp战斗结束 增加1个战斗掉落宝箱获得动画：对应的宝箱 icon 带着三角形拖尾飞到宝箱 icon 的位置，弧线的飞行轨迹；宝箱飞入后，icon 抖动（类似卡牌 icon），激活底部的绿点」。

截图形状：地图 PVP 节点旁红框小方块 = 起飞点；红色弧线向右下弯到 HUD 里那颗
`ChestEntry`（`hud_chest.png`）；其下 `Cell0..Cell3` 四颗点，第一颗绿、其余灰。
目标挂件是 **`ArenaRoot/BottomHud/ChestEntry` + 4 个兄弟格**，不是 `ChestBar` 那 4 张卡片。

#### 二、触发边沿：只认 `victoryBattleCells`（11-23 修订）

- 回主界面 = `ProcedureMain` 重新实例化 `MainRoot`（`MainPage` / `MainTerritoryMap` 每局重建），
  战斗期间主城页已销毁 ⇒ **收不到** `CmdNewTreasureInfoBroMsg`；新宝箱是 `start()` →
  `loadTreasureQueue()` → `RequestNewTreasureInfoList` **全量拉回**发现的。
  ⇒ `NewTreasureRepository.render()` 只给全量 `slots`，**没有「本次新增一个」的增量信号**，
  拿 `count` 做 diff 会把「本来就有 1 个宝箱」误判成刚掉落。
- 🔴 **第一版踩的坑（2026-11-23 实机「战斗胜利没有播放」）**：当时拿
  `TerritoryModel.settleProgress()` 的 `victoryClaimCells` 当「这局刚打完」的边沿。
  但这条信号只由**本地探索 `TerritoryProgress.settle()` 收地**产生，而异步 PVP 胜利是
  **服务端权威**，时序是：
  ```
  loadChapter() → emitStateChange()（本地档先渲染）
                → await mergeServerState() → progress.applyServerState(passCells)
                     ⇒ owned.add(cellId) / serverOwned.add(cellId)
                → applyStoredBattleResult() → progress.startExplore(cellId, …)
                     ⇒ checkUnlock() 首行 `owned.has(cellId)` 直接拒
                → settleProgress() ⇒ claimed = [] ⇒ victoryClaimCells = []
  ```
  已通关据点重复挑战（子类型 2）更极端：格子**开战前**就 owned，永远不会有新收地。
  结果 `emitChestDropFlight()` 每帧静默 `return`，`CHEST_EVENTS.DROP_FLIGHT` 永不 emit。
- 🔴 **修订口径**：`ITerritoryViewState.victoryBattleCells` 是模型在
  `applyStoredBattleResult()` 里**直接读战斗结算存档**（`battle.status === victory`）
  落下的一次性边沿，与「有没有新收地」彻底分家；`loadChapter` / `dispose` 清空，
  且结算存档随即 `clearBattle` 消费一次 ⇒ 天然一局一次。字段做成**可选**，
  老快照 / 测试夹具不带时按「没边沿」处理。
- 领地异步据点战斗类型固定 `ZC_BATTLE_TYPE_CHAPTER (1002)` 带 `pve` 上下文
  （`TerritoryModel.battleParamsFor()` → `chapterCellBattleParams` / `chapterTreasureBattleParams`），
  **不是** `BigMapEntry` 的 `slgBattleType`；结算写 `TerritorySaveStore.resolveBattle()`。
- `MainTerritoryMap.emitChestDropFlight()` **只认** `TERRITORY_SITE_TYPE.asyncPvp` 那一格
  （白名单，见八：11-23 深夜按用户口径收窄，挑不到就整条不发）；格心取
  `TerritoryMapView.cellWorldPoint(cellId)` 的**世界坐标**，通过 `CHEST_EVENTS.DROP_FLIGHT`
  发给 `MainPage`。老快照 / 测试夹具可能整个不带这两个字段 ⇒ `claimCells?.length` 与
  `sites ?? []` 都要兜，否则 `renderAll` 会带崩整页（本轮第一次全量对拍就红了 7 条转场用例）。
- 🔴 **起飞点必须排在 `scrollToCell` 之后**：回城带 `focusCellId`，`renderAll` 会
  `scrollToOffset(offset, 0)` 把镜头立刻滚到战斗格；在滚动前 `convertToWorldSpaceAR`
  量到的是旧镜头下的坐标，宝箱会从错误位置起飞。
- 页面侧**双向汇合**：事件可能比 `open` 表 701 闸门早到（表是异步拉的），
  `onChestDropFlight` 只记 `chestDropArmed`；`applyChestEntryGate` 解锁那一拍再调一次
  `tryStartChestDrop()`。`chestDropPlayed` 实例闩保证一页只演一次。

#### 三、表现链路

| 段 | 真源 | 口径 |
| :-- | :-- | :-- |
| 曲线 | `ChestDropFlight.ts`（零 `cc`） | 二次贝塞尔，与 `TerritoryHeroFlight` 同款 `controlX = startX + dx*0.3` / `controlY = startY + |dy|*0.55`；时间用 smoothstep（起落缓、中段快），0.9s |
| 拖尾 | `chestDropTrailQuads` | 沿 **B'(k) 切线反方向**从宝箱后缘铺 6 段梯形，宽度线性收到 0 ⇒ 三角形；alpha 线性渐隐并整条乘 `opacity`。🔴 不能用「起点→当前点」那根弦定向，弧线飞行会把拖尾画歪 |
| 飞入 | `chestDropFlightFrame` | 起飞 0.62→1.15，最后 15% 收到 28% 且淡出 |
| 视图 | `ChestDropFlightView` | 挂 `MainPage.chestDropFxRoot()`（认到 `BottomNav` 的父 = `MainRoot`）并排最后一位；`Graphics` 每帧 `clear()` 重画，图标 `Sprite` 是后建子节点压在拖尾上；`sizeMode = CUSTOM`；不建 tween，由 `MainPage.update(dt)` 逐帧 `step` |
| 落地 | `onChestDropLanded` | 一次性回调（按**显式到达时刻**，不看 `fx` 变 null 的隐式窗口）；点亮绿点 + 起抖动 |
| 抖动 | `chestDropHitScale` | 直接转发 `ShakePresentation` 的 `spawnShakeScaleX/Y(BUILDING_SHAKE_STRETCH)`，与 `TabButton.playHitFeedback` 同曲线。`ChestEntry` 挂的是 `Sprite + Button`，**没有 `TabButton` 组件**，不能 `getComponent(TabButton)` |
| 绿点 | `MainPage.renderChests` | `chestDropPending` 为真时 `visibleCount = count - 1`，落地才放开。回城全量刷新可能比事件早到，不加这个闩就是「绿点先亮、宝箱才飞到」 |

图标直接取 `chestToggle` 上的 `Sprite.spriteFrame`（`hud_chest.png`），**不重新 `resources.load`**：
目标 icon 与飞行 icon 必须同一张图，换路径会变成「飞过去的是另一个箱子」。

#### 四、坑

- 🔴 **减速点**：`MainPage` 原本没有 `update`，新加的 `update` 必须同时推进飞行与抖动；
  `onDisable` / `onDestroy` 都要收（`stop()` / `dispose()`），否则复用节点上留着半截缩放和上一场拖尾。
- 🔴 **生成动画抢 scale**：701 首次解锁的 `startChestEntryPop()` 也在写同一个 `chestToggle.setScale`，
  抖动那一拍要 `if (this.chestEntryPopping) return`，等它落位。
- 🔴 **跨 realm**：VM 沙箱里 `deepStrictEqual` 会比较对象原型，起播的 `origin/target` 必须逐字段 assert。
- 🔴 **源码守卫去注释**：文件头写了「不建 `cc.tween`」，`assert.doesNotMatch(/cc\.tween/)` 会假红；
  判真实调用前先 `withoutComments()`。

#### 五、判据

- `tests/chest-drop-flight.test.ts`（16 条）：常量 / 弧线拱高 / 起飞与飞入缩放 / 切线单位化与退化 /
  拖尾线性收窄与收尖 / 逐段渐隐 / 随 opacity 消失 / 抖动与 `spawnShakeScale*` 对拍 /
  源码守卫（层级、不建 tween、格心唯一取数口、绿点闩）/ VM 行为对拍（只播一次、起终点、
  飞行期压住绿点、落地激活 + 抖动、缺格心兜底、闸门晚到补起播）。
- 回归：专项 `16/16` 绿；受影响组 `206` 条里 2 条红是 11-20 历史基线红
  （`chest-detail-lifecycle` / `chest-detail-panel`）；最终全量 `7034 / 6939 绿 / 95 红`，
  对 11-22 基线按**用例名** diff ⇒ **0 条真实新增红**（唯一多出的一条是
  `node:test` 并行 runner 的 `Unable to deserialize cloned data`，单跑 `26/26` 绿），
  另有 4 条召唤拴绳红被并行任务修好；`npx tsc --noEmit` 6 条全是工程存量；
  `verify:hygiene` 通过。行尾：`MainPage.ts` / `ChestEvents.ts` 保 CRLF，
  `MainTerritoryMap.ts` / `TerritoryMapView.ts` 与新文件保 LF。

#### 六、11-23 触发源修复（实机「战斗胜利没有播放」）

- 改动：`TerritoryModel`（新增 `victoryBattleCells` + `ITerritoryViewState` 可选字段 +
  `applyStoredBattleResult` 落边沿 + `loadChapter` / `dispose` 清空 + `buildState` 透出）、
  `MainTerritoryMap.emitChestDropFlight`（改读新字段、参数可空、调用点移到 `scrollToCell` 之后）、
  `ChestEvents` / `MainPage` 注释口径同步。
- 🔴 **不改 `victoryClaimCells` 本身**：它仍是 `TerritoryHexSpawn` 挑「胜利格进场节奏」的真源，
  两条边沿各管一件事，别合并（合并会让已 owned 的格重播进场动画）。
- 新增 `tests/chest-drop-flight-trigger.test.ts`（7 条）：
  ① 真模型链路复现「服务端 `passCells` 先落 owned」，`victoryClaimCells` 空而
  `victoryBattleCells = [cellId]`；② 重复挑战（本地档 + 服务端都 owned）照样发边沿；
  ③ 战败 / 未结算 / 无战斗存档都不误发；④ 切章清空；
  ⑤ 页面侧 VM 对拍：边沿 → `DROP_FLIGHT`，优先 `asyncPvp` 格心；
  ⑥ 单格 / 非 asyncPvp / 格心取不到退化；⑦ 空边沿 / 老快照 / `sites` 缺失跳过且不抛错。
- 源码守卫（`tests/chest-drop-flight.test.ts`）：`emitChestDropFlight(state.victoryBattleCells, …)`
  且**不许**再出现 `emitChestDropFlight(state.victoryClaimCells, …)`；调用点必须排在
  `scrollToCell` 之后；模型的胜利边沿必须落在 `battle.status === victory` 分支里、
  与 `startExplore` 返回值无关。
- 回归：专项 `24/24` 绿（原 17 条 + 新增 7 条）；领地 / 宝箱 / 主界面分组 `1537` 条里
  22 红，按**用例名**对 11-23 基线 `7089 / 7000 绿 / 89 红` diff ⇒ **0 条真实新增红**
  （3 条分组特有红与本次改动文件零交集，单跑也稳定红，属工作区既有红）。

#### 七、11-23 深夜二次实机：先认「旧 bundle」，再补诊断锚点

用户第二次报同一症状（「战斗胜利没有播放掉落宝箱飞行」），附的截图红框里是一条**别的**报错：

```
TypeError: ... .cachedLineupPowerText is not a function
    at MainResBar.paintCachedPower (MainResBar.ts:215:39)
    at MainResBar.onLoad (MainResBar.ts:152:14)
    ... Node.setParent → MainSessionPort.swapView
```

**① 这条报错不是当前源码，是旧 bundle。** 证据链：

- `grep -rn "paintCachedPower|cachedLineupPowerText" assets/script` **零命中**；
  磁盘 `MainResBar.ts`（16:09）用的是 `cardRepository.getCachedLineupPower?.() ?? null`，
  `CardRepository` 也只有 `getCachedLineupPower()` / `loadLineupPower()`。
- 但 `temp/programming/packer-driver/targets/editor/chunks/61/615f07…js.map` 的
  `sourcesContent` 里仍是那段旧源码（`paintCachedPower()` → `cardRepository.cachedLineupPowerText()`），
  该 chunk 的时间戳是 **15:51**，正是当时正在跑的编译产物。

⇒ 结论：`onLoad` 抛错的这版跑的是「战力首帧」改动中途的半成品，**与掉落宝箱无关**。

**② 这条抛错也不会让动画消失。** `MainResBar` 挂在 `ArenaRoot/TopHud`，`MainPage` 挂在
`ArenaRoot` **根节点** ⇒ 激活顺序是「根组件先 `onLoad`、子节点后」，
`EventMgr.instance.on(CHEST_EVENTS.DROP_FLIGHT, …)` 早已成立；实机截图里
`ChestEntry` 与 `BottomHud/Cell0..3` 都可见 ⇒ `chestEntryUnlocked === true`、
`chestToggle.active === true`，两道闸门都开着。

**③ 本轮加固（两处代码 + 一行守卫）**

1. `MainPage.tryStartChestDrop`：**只有 `play()` 返回 `true` 才置 `chestDropPlayed`**。
   原来先置位再 `play`，一旦 `play` 因宿主节点失效返回 `false`，这一局的动画就永久消失、
   且 `chestDropArmed` 还在（状态自相矛盾）。
2. 三条排查锚点（`console`，正常局只在胜利回城各出现一次）：

   | 控制台出现 | 含义 |
   | --- | --- |
   | `[ChestDrop] 回城边沿：格 N，起点 (x, y)` | 模型的 `victoryBattleCells` 到了、`DROP_FLIGHT` 已 emit |
   | `[ChestDrop] 回城边沿：格 N 量不到世界坐标…` | 边沿到了但 `cellWorldPoint` 落空，改用兜底起飞点 |
   | `[ChestDrop] 起飞 (x, y) -> (x, y)` | 页面真的起播了（此时看不见 ⇒ 查层级 / 宿主 / 遮挡） |
   | `[ChestDrop] 待播中：701 入口闸门还没开` | 事件早到、`chestEntryUnlocked` 还是 false，等 `applyChestEntryGate` 补播 |
   | `[ChestDrop] 起播失败…` | 宿主节点已失效，保留待播状态等下一次渲染重试 |
   | **一行都没有** | 边沿为空 ⇒ 问题在模型侧（`applyStoredBattleResult` 没读到胜利存档） |

3. 🔴 `MainTerritoryMap` 的注释里**不许写 `TerritoryModel` / `CacheMgr` / `GameNet` 这些标识符**：
   `tests/territory-mvc-boundary.test.ts` 用 `doesNotMatch` 扫**整份源码**（注释也算），
   写进注释一样会红。

**④ 顺手放宽的守卫**：`tests/main-quick-find-popup-mask.test.ts` 里 `setSiblingIndex` 的断言
改成只匹配 `setSiblingIndex(this.node.parent.children.length - 1)` —— 同一波空安全收紧把
`parent ? … : 0` 换成了 `if (this.node.parent) { … }`，语义一致（无父时那个 `: 0` 本来就是空写）。

#### 八、11-23 深夜三次实机：收窄到「只认异步 PVP 据点」

用户原话：

> 「塔防模式结束后回到领地，也播放了战斗宝箱飞入 icon 的动画，只有 pvp 异步据点才需要播放」

**① 兜底那一版为什么错了。** `emitChestDropFlight` 上一版是

```ts
const cellId = pvpCell ?? claimCells[0];   // ← 去掉
```

理由是「战斗掉落宝箱对任何据点战斗胜利都成立，不能因为类型没配上就让动画静默消失」。
这个前提**被证伪**：`TerritorySaveStore.resolveBattle()` 是**所有**带 `pve` 上下文的战斗
共用的收尾口（唯一调用点 `ZCBattlePreparation.resolvePveResult`，形参就叫
`pve.territoryCellId`，与 `mode` 无关）⇒ 塔防（`mode = defence`）与普通关（`mode = match`）
打赢回城时 `victoryBattleCells` 同样非空，于是被这条兜底一起演成宝箱掉落。

**② 修法：白名单，不是黑名单。**

```ts
const pvpCell = claimCells.find((cellId) => cells.some(
    (site) => site.cellId === cellId && site.type === TERRITORY_SITE_TYPE.asyncPvp));
if (pvpCell === undefined) {
    console.info(`[ChestDrop] 回城边沿：格 ${claimCells.join('/')} 不是异步 PVP 据点，不播宝箱飞行`);
    return;   // 挑不到 ⇒ 整条不发
}
const cellId = pvpCell;
```

`TERRITORY_SITE_TYPE` 还挂着 `stage` / `boss` / `fixedResource` / `bonus` / `patrolChest`
⇒ 必须写「只认 `asyncPvp`」，写「排除 defence」等于给未来的新类型自动发宝箱动画。

**③ 语义连带变化**（都是想要的）：

| 输入 | 旧行为 | 新行为 |
| --- | --- | --- |
| `sites` 里同格是 `stage` / `boss` / 资源格 | 用第一格兜底、照播 | **不播** |
| `sites` 整个缺失（老快照 / 夹具） | 用第一格兜底、照播 | **不播**（认不出类型就不演，好过所有模式都演） |
| 格心 `cellWorldPoint` 落空但类型是 `asyncPvp` | `origin = null` 交回 `MainPage` 用兜底起飞点 | **不变** |

**④ 诊断锚点加一条**：`[ChestDrop] 回城边沿：格 N 不是异步 PVP 据点，不播宝箱飞行`。
塔防 / 普通关回城出现这行是**正常**；异步 PVP 打赢也出现这行 ⇒ 那一格的 `type` 没配成
`asyncPvp`（配表问题，不是表现问题）。

**⑤ 用例（`tests/chest-drop-flight-trigger.test.ts`，10 条）**：原第 ⑥ 条拆成
「只认 asyncPvp（多候选取第一个）」+「`stage` / `boss` / `fixedResource` / `bonus` /
`patrolChest` 五种类型一律不播」+「格心取不到但类型对 ⇒ 仍发、`origin` 交回 `null`」，
原第 ⑦ 条里 `sites` 缺失的断言从「照常起飞」改成「不发」，并新增一条源码守卫
**不许再出现 `pvpCell ?? claimCells[0]`**。

**⑥ 🔴 守卫必须剥注释再扫**：这条守卫的「反面写法」就写在真源注释里（讲清为什么去掉兜底），
`assert.doesNotMatch(code, /pvpCell\s*(\?\?|\|\|)\s*claimCells\[0\]/)` 直接扫整份源码会
自己把自己的说明文字当成回归（`territory-mvc-boundary` 踩过同一个坑）。写法：

```ts
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
```

**⑦ 反向验证**：把 `?? claimCells[0]` 与 `if (… && false)` 临时加回去 ⇒ 专项 3 条转红
（正是用户可见的「塔防不播」那条 + `sites` 缺失那条 + 源码守卫），还原后 10/10 绿。

### 3.55 PVP 红气泡里的头像居中：小尖角抬升 + auto trim 补偿（2026-11-23）

> 「头像图 没有在红色地图居中显示」—— 领地紫色城堡上方那颗红色气泡里的兽人头像
> 贴着红框下沿 / 小尖角，上方空出一大片红。

#### 一、静态链路全对，偏的是版面

这颗气泡**没有独立 prefab**：宿主是 `ui/territory/TerritoryStation.prefab`，气泡是运行时
`new Node('LevelBubble')`、头像是 `new Node('LevelBubbleIcon')`（挂在气泡根上，与文字同层）。
底图是 `image/spawn-region/frame_02/spriteFrame`（`assets/bundles/battle/image/spawn-region/frame_02.png`），
头像是 `icons/head/icon_hero_head_40018/spriteFrame`，路径 / bundle / PNG / meta / art 槽位 /
`stationRenderOf` 两条「未通关」分支全都没问题。唯一错的是 `applyLevelBubbleLayout` 里
`icon.node.setPosition(0, isPortrait ? TERRITORY_PVP_BUBBLE_PORTRAIT_Y : chest.iconY, 0)`
那个固定常量 `3`。

#### 二、两笔偏移，旧口径只补了一笔

| | 实测 | 造成的偏移 |
| --- | --- | --- |
| 红底图 `frame_02` | `94×45`，`SLICED` 拉成 `60×66`；逐行量 `alpha>60` ⇒ **圆角主体 raw 行 `0..36`**，`37..44` 只剩一条居中小尖角（行宽 16px 收到 6px）；meta `borderTop=12` / `borderBottom=16` / `packable=false` | 九宫格上下切边 **1:1 渲染** ⇒ 节点顶边 ↔ raw 0、节点底边 ↔ raw 45 恒成立，中间段拉多长都不影响；主体可见中心恒比**气泡节点中心**高 `(45−36−1)/2 = 4px`，与气泡高度 / border 值都无关 |
| 头像 `icon_hero_head_40018` | `204×204`，`trimType:auto` ⇒ trim 到 `(0,27,200,177)`，`offsetX=-2` / `offsetY=-13.5`；`LevelBubbleIcon` 是 `sizeMode=CUSTOM` + **`sprite.trim=false`** | `trim=false` ⇒ 节点中心对应**原画布**中心，可见内容中心比节点中心低 `13.5 × 46/204 ≈ 3.04px`（横向另差 `2 × 46/204 ≈ 0.45px`）。与 `applyIconPlacement` 用 `frame.offset` 抵消建筑留白是同一套算法 |

旧常量 `PORTRAIT_Y = 3` **正好只补了第二笔**（`13.5 × 46/204 = 3.04`），所以头像可见中心被摆在
节点中心 `(0, 0)`，而红色主体中心在 `+4`：节点坐标下主体 `y ∈ [+33, −25]`、头像可见区
`y ∈ [+20, −20]` ⇒ **上留白 13px / 下留白 5px**，截图读作「没有居中」。

#### 三、落点唯一真源

`model/TerritoryLevelBubble`（零 `cc`）新增纯函数，视图只负责取帧并写节点：

```ts
function portraitPositionOf(canvasW, canvasH, offX, offY, size) {
    return {
        x: 0 - offX * size / canvasW,                          // 抵消 trim 的横向偏移
        y: BODY_CENTER_LIFT_Y - offY * size / canvasH,        // 尖角抬升 4 + trim 补偿 3.04
    };
}
export function territoryPvpBubblePortraitPosition(frame, size = PORTRAIT_SIZE) { ... }
```

- 真帧结果：`(x, y) ≈ (0.45, 7.04)`；减去 trim 后可见中心 `= +4` ⇒ 与主体中心重合，
  上下留白各 `≈ 9.04px`、左右各 `≈ 7.45px`。
- `x` 写成 `0 - ...` 而不是 `-offX * ...`：后者在 `offX = 0` 时产出 `-0`，`assert.equal(-0, 0)` 会红。
- 帧没到 / 画布尺寸非法 / `offset` 非有限 ⇒ 退回**当前美术**的实测几何（与真帧同一套公式），
  不产出 `NaN`；`TERRITORY_PVP_BUBBLE_PORTRAIT_Y` 保留为「无帧兜底」的版面锚点，不再是视图的写入口。
- 换底图只需按 PNG 重量 `FRAME_HEIGHT` / `BODY_BOTTOM_ROW`；换头像图 / 改 `PORTRAIT_SIZE`
  由 `frame.originalSize` / `frame.offset` 自动重算，**不许再写死一个 Y**。

#### 四、不变量

- 🔴 `LevelBubbleIcon` 必须保持 `sprite.trim = false`；改成 `true` 会让 `offset` 补偿整笔失效。
- 🔴 气泡底图仍是 `SLICED`（不是 `SIMPLE`）—— 只有 `SIMPLE` 时整帧线性拉伸，尖角抬升会变成
  `(45−37)/2 × 66/45 ≈ 5.87px`，与本节的 4px 不同源。
- 🔴 宝箱气泡（水滴）与编号胶囊**不受影响**：`isPortrait === false` 仍走
  `icon.node.setPosition(0, chest.iconY, 0)` / `badgeLabel → (0, chest.textY, 0)` 的上下两行。
- 🔴 `badgeLabel.node.active = visible && !portrait` 不变；PVP 头像气泡不显示编号文字。
- VM 夹具的 `FakeColor` 没有 `cc.Color.set`，切到宝箱分支的用例在本文件内**局部注入**
  `badgeOutlineTint.set`，不改共享 `tests/helpers/territory-station-fixtures.ts`。

#### 五、判据与回归

`tests/territory-pvp-bubble-portrait-align.test.ts`（10 条）：用 `decodePngRgba` 从
`frame_02.png` 逐行量出主体末行 36 / 尖角 8 行、从 `icon_hero_head_40018.png` 反算
`offset = (-2, -13.5)`，与两张 `.meta` 对拍；纯函数的抬升 / trim / 换尺寸 / `-0` / 缺帧兜底；
居中验收（上下留白相等，且旧 `+3` 的差值正好 ≈ 一条尖角）；VM 行为对拍（真帧落点、
切回宝箱气泡复位 `x=0 + chest.iconY`）；源码守卫（视图只读纯函数、旧固定 Y 分支已删、
模型零 `cc`）。既有 `tests/territory-station-batching.test.ts` 与
`tests/territory-chest-bubble.test.ts` 的版面 / 接线守卫同步改为钉新口径。

回归：定向 5 文件 `52/52` 绿；全量 `7069 / 6979 绿 / 90 红`，对 11-22 基线按**用例名**
diff ⇒ **0 条新增红**（另有 5 条历史红被并行任务修好）；`npx tsc --noEmit -p tsconfig.json`
6 条全是工程存量、改动文件 0 错；`verify:hygiene` 通过；`verify:guards` 的 3 条红是
`C7 / F7 / G12` 工程基线恒红；6 个改动文件全保 LF。

### 3.56 异步据点弹窗压在最上层 + 打开期间收起【快速寻敌】（2026-11-23）

**用户口径**：「弹窗的优先级在最上层，打开弹窗后，就隐藏【快速寻敌】按钮，关闭弹窗才展示」。
截图（11-23）里黄色【快速寻敌】按钮、左侧「任务」、右侧宝箱 icon、左下聊天条、右下绿点
全部**亮在弹窗暗底之上**，按钮甚至压住了弹窗卡片下沿。

#### 一、真因：页面内「排最后」不等于屏幕最上层（与 §3.41 同一条坑）

`BigMapPlayerLevelPanel` **不是 `PopupBase`**：`MainTerritoryMap.onLoad()` 直接
`instantiate(playerStagePrefab)` + `setParent(this.node)`，不进 `PopupManager._stack`。
主界面真实层级（`ArenaRoot.prefab` / `MainRoot.prefab` 的子节点顺序 = 渲染顺序）：

```
MainRoot
├─ [0] Content → ArenaRoot
│        ├─ [0] MapRoot → MainTerritoryMap.node → BigMapPlayerLevelPanel（Dim 黑 a=160）
│        ├─ [1] BeginGame        ← 【快速寻敌】，后画
│        ├─ [5] TopHud / [6] BottomHud / [7] ChestBar
└─ [1] BottomNav                 ← 最后画
```

`open()` 里 `setSiblingIndex(this.node.parent.children.length - 1)` 的父节点只是
`MainTerritoryMap.node`；整棵 `MapRoot` 分支是 `ArenaRoot` 的**第 0 个**孩子，后面每个兄弟
都盖得住它。这也解释了为什么同一张截图里 HUD 全都没被 `Dim` 压暗 —— 它们根本不在 `Dim` 之下。

#### 二、层级：只在打开那一拍挂 `MainRoot` 最后一位

* `BigMapPlayerLevelPanel.topLayerHost()`：从 `homeParent`（`initialize()` 记下的领地页根）
  往上找**挂了 `BottomNav` 的那层** = `MainRoot`，与 `MainPage.chestDropFxRoot()` /
  `MainTerritoryMap.rewardFxRoot()` 同一口径；找不到就退回原宿主（退化成老行为，不静默消失）。
* `open()`：`setParent(host)` → `active = true` → `setSiblingIndex(host.children.length - 1)`。
* `close()`：`restoreHomeParent()` 挂回领地页 —— 那里才是本页子树，节点才会随页面销毁；
  留在 `MainRoot` 上就是幽灵弹窗。
* `MainTerritoryMap.onDestroy()` 调 `playerStagePanel.dispose()`：`Node._onPreDestroyBase()`
  先销毁子节点再跑 `onDestroy`，打开态的节点挂在页面**之外**，引擎不会连带收，必须自己 `destroy()`
  （同 `disposeRewardFxLayer()`）。
* 三层根节点（`MainTerritoryMap` / `ArenaRoot` / `MainRoot`）都是 `720×1280`、
  anchor `(0.5,0.5)`、四边对齐 Widget ⇒ 换父不改坐标 / 尺寸。
* `Canvas/Popup`（全局 `PopupBase`）在 `MainRoot` 之外，仍在本面板之上，层级关系没被倒过来。

#### 三、显隐：真源是节点 `active`，不是全局弹窗栈

* 🔴 `PopupManager.inst.count / openedPopups` **查不到这个弹窗**（不是 `PopupBase`），
  `PopupManager` 也没有任何「弹窗开/关」全局事件或 `onOpen` 回调；`IPopupOpenParams` 只有
  per-open 的 `onClose`。
* 🔴 也**不能**用「`PopupManager.inst.count > 0` 就隐藏」：`Toast` / `LoadingPopup` 都是
  `PopupLayer.TOP` 的 `PopupBase`，一条 `showTip` / 一次网络请求就会开合 ⇒ 快速寻敌疯狂闪烁。
* 唯一真源：`MainTerritoryMap.playerStageOpen`（getter → `playerStagePanel.isOpen` → `node.active`），
  经 `MainPageComposition.mountTerritory` 注入的 `MainPage.territoryMap` 读，不另造平行状态；
  直接 `close()` 的四条路径（导航接手 / 互斥面板 / 空详情）也都认这一颗节点。
* `MainPage.maskQuickFindForPopup()` **只写 `false`、不负责恢复**，紧跟在 `start` /
  `applyQuickFindGate` / `setChestPanelOpen` 三处既有写入点之后：那三处只判 702 闸门与宝箱栏，
  领地页重绘（`refreshOpenGates`）、宝箱栏收起、池化复用都会把按钮顺手点亮。
* `MainPage.syncQuickFindOnPopupEdge()` 在 `update()` 里比 `stagePopupMasked` 电平，
  **只在开/关边沿写一次**：开 → `false`；关 → `quickFindUnlocked && !chestBar.opened`
  （完整判据，不绕过 `open` 702、不破坏「宝箱栏展开时收起」）。
* 🔴 **不许每帧无条件写 `active`**：`GuideComposition` 的 `DIALOG_HIDDEN_HUD` /
  `GUIDE_LOCKED_HUD` 都含 `BeginGame`，`syncDialogHud` / `restoreDialogHud` / `applyHudGate`
  也在直接写同一个节点；每帧写会把引导未到 `5-4` 的 `gateHidden` 隐藏口径顶掉。
* 既有源码守卫字面串（`tests/quick-find-gate.test.ts` / `tests/chest-bar.test.ts` /
  `tests/chest-entry-gate.test.ts`）**一条不改**，遮罩只是追加的一刀。

#### 四、用例与回归

`tests/main-quick-find-popup-mask.test.ts` 10 条：prefab 层级（`MapRoot < BeginGame`、
`BottomNav` 是 `MainRoot` 最后一位）、弹窗 reparent/restore/dispose 源码守卫、
`MainPage` 接线守卫、VM 行为对拍（开→藏、重绘/收宝箱栏不许点亮、关→只写一次 `true`、
702 未解锁不亮、宝箱栏展开不亮、无地图宿主不抛也不误藏）。
`tests/territory-async-player-panel.test.ts` 新增 1 条 VM 层级对拍：
`open → MainRoot 最后一位`、`close → 挂回领地页`、`dispose → 自己 destroy`。

回归：定向 6 文件 `66/67` 绿（唯一红是 prefab 字号基线红），收工关键组 `170/172` 绿
（2 条红均在 11-23 基线里：`玩家关卡弹窗两颗按钮字号`、`宝箱队列变化立即同步刷新详情按钮`）；
全量 `7089 / 7000 绿 / 89 红`，对 11-23 基线 `7069 / 6979 绿 / 90 红` 按**用例名** diff
⇒ **0 条新增红**（另有 1 条历史红被并行任务修好）；`npx tsc --noEmit -p tsconfig.json`
6 条全是工程存量、改动文件 0 错；`verify:hygiene` / `verify:layout` 通过。
`MainPage.ts` 保 CRLF，其余 4 个改动 / 新增文件保 LF。

### 3.57 回到领地页：模块入场改成「挂载先摆位、就绪只起表」，底图不再参与（2026-11-23）

**用户口径**：「从别的界面加载回领地界面时，出现一个空场景，再加载了按钮，但是按钮的位置和
空场景按钮的位置偏差，画面会显得跳一下」。

#### 一、真因：起播点比页面显示晚了一大截，`apply(0)` 把"已经静止"的 HUD 又推了一遍

`MainHudIntroPlayer` 的起播点是地图首帧就绪（`VIEW_LIFECYCLE{phase:'presented'}`，
`MainTerritoryMap` 首次成功渲染时发一次）。但那之前地图要**异步**读章节数据 + 美术，
切 tab 回来时页面早就渲染了零点几秒到两三秒 —— 这一段就是用户说的「空场景」，此时
各模块**已经在原位静止显示**。

`presented` 一到，`play()` 立刻 `apply(0)`：

| 模块 | 起始姿态（相对原位） |
| :--- | :--- |
| `TopHud` | **+40** px（上方） |
| `BottomHud` | **−40** px（下方） |
| `EntranceLayer` | −18 px |
| `BeginGame`（快速寻敌） | 缩放 **0.80** |
| `OSRankEntry` | 缩放 **0.72** |
| `MapRoot` | −14 px + 透明 |

⇒ 屏幕上那排「已经好好的」按钮被**一把推开 40px 并归零透明度**，再用 0.4~0.56s 缓回来。
玩家看到的就是"跳一下"；`MapRoot` 那条更狠 —— 整屏底图跳 14px 还闪一下。

#### 二、修法：两段式（`prepare` / `play`），基准只抓一次

- `MainPage.start()`：有地图宿主 ⇒ `prepareMainHudIntro(this.node)` **当场**摆成起始姿态。
  这一刻要么还没人看见（tab 刚挂上），要么还在登录图底下（首屏预加载）；
  没有地图宿主（测试桩 / 预览，没人发 `presented`）⇒ 仍走 `playMainHudIntro` 当场播完。
- `MainHudIntroPlayer.prepare()`：解析模块 → **抓基准**（位置 / 缩放）→ `apply(0)` → 挂兜底计时。
  不调度播放。
- `play()`：`armed` 时分三种情况 ——
  **① 只起表**（沿用挂载时抓的基准，绝不重抓、不重摆）；
  **② 补课**：挂载时被门禁压着、现在已经亮出来的模块（快速寻敌 / 排行角标）现抓现摆；
  **③ 已经 `settled`** ⇒ 直接 `false`（播完 / 超时放出来 / 老口径播过一次，都算"这一页的入场已了结"）。
- 兜底 `MAIN_HUD_INTRO_HOLD_SECONDS = 2.5s`：地图一直不就绪（数据失败 / 断网）就到点把 HUD
  直接放出来，并**放弃这一轮动画** —— 宁可没有动画，也不能让玩家对着一个没有 HUD 的页面。
- 🔴 `MapRoot` **从 `MAIN_HUD_INTRO_PLAN` 里摘掉**：底图是这一页的"底"，加载期间必须一直在位
  （它还要挡住后面什么都没有的 Canvas），所以它只能"一到就在"。地图内容自己是一块块铺上来的，
  不需要页面级位移去演。

#### 三、副作用与代价（写清楚，别当成 bug 又改回去）

- 加载那 0.2~2s 只有底图 + 底部七格导航，**没有顶栏 / 底栏 / 快速寻敌 / 宝箱** —— 这就是"加载中"
  该有的样子；就绪后它们一起淡入。首屏不受影响：登录图恰好在 `presented` 那一拍被 `release()`
  （`MainPageComposition` 监听 `presented` → `MainTabHost.resolveFirstScreen()`），揭图即入场。
- 顺序反过来（章节数据在内存里、`presented` 抢在 `start()` 前面到）也不会跳：老口径那一次会把
  `settled` 记上，随后 `prepare()` 直接 `false`，不会把 HUD 重新藏起来再等。

#### 四、用例与回归

`tests/main-hud-intro.test.ts` 15 条（原 8 条 + 新增 7 条），新增钉的是：
挂载当场摆位但不调度、就绪起表**沿用挂载基准**（若重抓，走完会停在 +40 处）、
超时放出并放弃动画（迟到的 `presented` 也不再摆）、重复 `presented` 不重播、
`presented` 早于 `start()` 时预备直接 `false`、门禁模块"补课"起手就落起始姿态、
`start()` 里 `hasTerritoryMap` 两条分支各就各位。
节奏表守卫反向加了一条：🔴 `MapRoot` **不许**再进节奏表。

## 7. 开局归属扩散波：归属格直接切换、中立格逐个替换

自选主城局选点结束进入战斗那一帧（`ZCGame.finishSpawnSelection`），纯表现层过渡（绝不回写模型）：

1. **执行顺序铁律**：必须**先调 `this.renderWorld.render(this.model)`**（让主城+6邻格共 14 个开局归属格一帧直接切到归属色），**再调 `this.renderWorld.startTerritoryClaimWave(this.model, selection)`**（把本半区中立可通行格压回选点半区色并启动扩散波，`selection` 必须传局部引用）。
2. **入波过滤条件（`buildClaimWavePlan`）**：仅收录 `ownerOf(hexId) === 'neutral' && sectionOwnerOf(hexId) === 主城方 && playable !== false` 的格子（`select_river` 实测两侧各 76 格共 152 格，14 个归属格绝不入波）。
3. **单一真源**：起点半区色唯一取自 `ZCSpawnSelection.regionOwnerOf`；终点战斗底色与地块底图、领地轮廓三处同源调用 `ZCGameViewUtil.territoryTintOwner(owner, canDevelop)`。
4. **时间表与幂次加速**：各主城独立做 BFS 环号分层 + 同环按极角 `atan2(dy, dx)`（值域 `(-π, π]`，`+π` 为最大角）升序排列；归一化名次 `r = rank / (total - 1)`，到达时刻 `= ZC_CLAIM_WAVE_SECONDS(1.0) × r^ZC_CLAIM_WAVE_ACCEL_POWER(0.65)`（相邻间隔单调递减，从 ~60ms 加速至 ~8.7ms），每格再做 `ZC_CLAIM_WAVE_FADE_SECONDS = 0.1s` 线性换色。
5. **绕过指纹闸门与收尾清理**：挂 `renderDynamic`；`ZCHexView.setClaimWave({ from, to, progress })` 绕过 `contentSignature` 直接写色，内部按 `written` Map 跳过未变进度；播完自动调 `clear()` 传入 `null` 并**清空 `this.contentKey = ''`** 强制下一帧常规重画；`ZCGame.destroy` 时也必须调 `clearTerritoryClaimWave()`。
- **判据**：`tests/zcds-territory-claim-wave.test.ts`（17 条）。

## 8. 点击脉冲：5 帧美术序列（2026-10-19 换美术，旧着色器整条退役）

- **这套是唯一实现**：`assets/bundles/battle/image/effects/hex_pulse_seq/hex_pulse_0..4.png`（320×320 透明底），
  由 `ZCGameLoader` 扫目录按名排序注入 → `ZCGameRenderWorld` → `ZCHexView.setHexPulseFrames`。
- 🔴 **落地的图被处理过（本体压到 35% 不透明度）**：美术原稿中心那块六边形是**实心不透明**的
  （画的是「地块本体」参考色 `#D9CDE2`），5 帧都带着它。直接盖到地块上会把整块地皮盖成淡紫、播完再弹回
  原色 —— 等于闪屏；但**彻底挖空**（alpha=0）又显得中间空得发虚（2026-10-19 先试过这一版）。
  最终口径：`tools/gen_hex_pulse_layer.py` 按第 0 帧量出的本体多边形（165×144 平顶六边形）**向心内缩
  `3px`**（留出帧 0 的贴边亮边），把这一区的 alpha **乘 `BODY_ALPHA = 0.35`**，外圈的波**原样不动**
  （它自带 70%→15% 的逐帧淡出）。⇒ 地块的阵营色 / 图标 / 价格透得出来，波又有个「发光的本体」托底。
  换图时**必须**重跑这个脚本（或在美术侧直接出「本体 35%」的图），否则会退化成「点击闪一下淡紫」。
- **美术自带曲线**（`六边形脉冲序列帧需求` §六）：帧 0 本体边缘 70% 白边 → 逐帧放大到 1.78 倍、淡到 15% →
  **直接消失**；5 帧每帧都有波、没有静止帧。所以视图侧**只换帧**：
  - 帧号由 `hexPulseFx(seconds).pulseFrame` 给（`0..4`，`-1 = HEX_PULSE_FRAME_HIDDEN` 退场）；
  - 节奏 `HEX_PULSE_FRAME_SECONDS = 0.1s`（10fps），一道波 `HEX_PULSE_WAVE_SECONDS = 0.5s`；
  - 严禁在节点上再写 scale / opacity 动画（图里已经有了，叠上去就是放大两次、虚化两次）。
- **对齐换算**：图上本体 `164×142` ↔ 格面 `123×90` ⇒ `HEX_PULSE_SCALE_X = 123/164`、`HEX_PULSE_SCALE_Y = 90/142`。
  节点 `contentSize` 按整张 `320×320` 给（波最大约 `292×253`）。`GroundGlow` 的 `_sizeMode = CUSTOM`，
  引擎不会自动改尺寸 ⇒ 这两件事都必须由 `applyPulseRipple` 写，离开段时由 `restorePulseLayer` 写回 `130×239`。
- **与段长的关系**：点击动画段仍是 `ZC_HEX_PULSE_SECONDS = 0.7s`（卡牌 / 首批兵 / 邻格按住窗都锚它），
  波只占前 `0.5s`；段尾 `0.2s` 波已退场，只剩缩没在收格子。
- **染色 = 卡牌品阶**（用户 2026-10-19）：`pulseTintForRarity(rarity)` —— `1` 绿 `#5AE28A`、
  `2` 蓝 `#4894FF`、`3` 紫 `#B26CFF`、`4` 金 `#FFC43C`，`0`（没抽到卡）/ 越界 / 非数字一律绿。
  品阶来自激活事件 `ZCHexActivation.cardRarity`（`ZCGameModel.developFor` 用 `ZC_RARITY_RANK[card.rarity]`
  填，没抽到卡填 0），由 `renderActivation` **每帧**写进 `pulseTint` —— 不能像旧版按 `state.tileType`
  在 0.15s 的 `render` 里缓存（品阶是「这一次开发」的结果，不是格子的静态属性）。
  ⚠️ 「抽到卡但建不上」（`!result.building`）仍有品阶、只是没有卡牌揭示（`hasCardReveal` 是另一件事）。
- **已退役**：旧 30 帧 `fkz_00..29`（155×144 灰度图）+ `shaders/hex-pulse.effect` 的径向虚化 / 保底乘抬亮，
  以及 `ZCHexView` 里的 `ensurePulseMaterial` / `applyPulseMaterial` / `applyPulseFade` / 每格克隆材质。
  文件和 effect **还留在盘上**做对照，但**代码不再加载**（`ZCGameLoader` 已删 `loadHexPulseMaterial`）。
  想回退先把 `HEX_FLIP_PULSE_ART_ROOT` 指回 `effects/hex_pulse` 并恢复那条材质链 —— 别只改一半。
- **判据**：`tests/zcds-hex-activation.test.ts`（`pulseFrame` 等宽推进 / 播完退场 / 对齐缩放恒定 / 旧材质链已删）。
  本体透明度属于美术产物，靠 `tools/gen_hex_pulse_layer.py` 写出的 `_preview_dark.png` / `_preview_tile.png` 肉眼验收（预览输出不入库）。

## 9. 体验反馈专项（row8~row13）：结算扫场 / 描边同步 / 金矿提示 / 横幅扇入 / 产金抖动

### 9.1 row8 胜利结算三段式填充动画：深色铺场（带闪烁）→ 回正 → 线条脉冲（2026-10-16 最新口径）

1. **方向判据唯一看「赢家身份」（不看单格归属）**：
   - `winner === 'player'` ⇒ 层号 `step = maxRow - row`（**从下往上**）。
   - 其他玩家（`enemy` / `enemy2` / `enemy3`）⇒ 层号 `step = row - minRow`（**从上往下**）。
2. **三段式时序与重叠规则**：

| 阶段 | 起点与步长 | 行为与关键常量 |
| :--- | :--- | :--- |
| **① 深色铺场 + 闪烁** | `t = 0` 起，每 `ZC_VICTORY_SWEEP_STEP_SECONDS = 0.06s` 推进一行 | 填入 `zcDeepFactionColor(owner)` 深色，并叠加 `victorySweepShimmer` 三角波偏白闪烁 |
| **② 起始点回正** | 铺过 **`ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS = 2` 个填充步**即起跑（与总行数无关；行数不足则 `Math.min` 兜底） | 小数游标 `victorySweepRevertCursor` 同速推进，屏幕上恒留 `LEAD_ROWS + 1 = 3` 行闭区间 `[cursor, litStep]` 深色带；由深色插值回阵营当前色（结束时刻用 `victorySweepRevertEndSeconds`） |
| **③ 共享轮廓线条脉冲** | ② 回正全部收手后立即起跑，速度 `PULSE_STEP_SECONDS = 0.035s/行` | 底色不再改动；在 `OutlineLayer` 上沿同方向扫过一道波带半宽 `PULSE_BAND_ROWS = 1`、对称三角形态的亮线（总结束时刻为 `victorySweepDuration`） |

3. **深色计算铁律（`zcDeepFactionColor`，`ZCTheme.ts`）**：
   - **全程纯 RGB，严禁走 HSV**（防中立灰丢色相及测试桩兼容）。
   - **顺序严禁写反：必须先推饱和 clamp 到 `[0, 255]`，最后再乘压暗系数 `ZC_DEEP_DARKEN = 0.9`**（2026-10-16 由 `0.78` 上调至 `0.9`；注意 `ZC_DEEP_DARKEN` 上界必须 `< 1`，否则深色退化为当前色）。
   - **五档标准深色值（供回归核对）**：
     - `player`: `#7e82ff → #6a70e6`
     - `enemy`: `#fb4969 → #e62b54`
     - `enemy2`: `#fbcc49 → #e6b80d`
     - `enemy3`: `#bd49fb → #c32be6`
     - `neutral`: `#c4dae5 → #aac6d5`
4. **铺场闪烁铁律（`victorySweepShimmer` + `zcTowardWhite`）**：
   - **用三角波不用正弦**：周期 `ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS = 0.15s`、峰值 `SHIMMER_MAX = 0.5`、相邻行相位差 `1/3` 周期，整周期恒非负且 `elapsed = 0` 为 0。
   - **只偏深色那一端**：`sweepFill` 算 `lerp(zcTowardWhite(deep, shimmer), current, mix)` ⇒ `mix = 1`（回正完成）时闪烁自动归零，无需单独停闪逻辑。
   - **指纹量化与剔除**：`ZCHexView.setSweepOwner(owner, mix = 0, shimmer = 0)` 中 `mix` 按 **32 档**、`shimmer` 按 **16 档**量化进 `sweepKey`；**当 `mix >= 1` 时必须将 shimmer 剔出指纹**，避免已回正的格子每帧无故重绘。
5. **第 ③ 段线条脉冲三处同步守卫（`ZCVictorySweep.pulseLevelOf` → `appendHexPulseOutlineSegments`）**：
   - 脉冲强度量化为 `PULSE_LEVELS = 4` 档、最亮档往白偏 `PULSE_MAX_MIX = 0.55`、线宽 `PULSE_LINE_WIDTH = 7`；`victorySweepPulseMix` 起跑判据必须写 **`cursor >= 0`**（写 `> 0` 会漏掉起跑当帧）。
   - ⚠️ **修改脉冲参数时必须同步的三处**：
     1. `redrawSharedOutline` 的探针每格压入 **4 个数**（`id / 阵营 / mask / 脉冲档位`），且传参时必须**按档位预建 `Color` 实例复用**（严禁逐格 `new Color`，否则每格拆成一个 `Graphics` subModel 破坏合批）；
     2. `ZCOutlineLayer` 的 `MAX_BUCKETS` 设为 **16**（原为 12）；
     3. `tests/zcds-progress.test.ts` 中读取轮廓探针的步长固定为 **4**。
   - `ZCVictorySweep.advance` 的重画判据共 4 项：填充步号、回正游标、闪烁相位档位（`victorySweepShimmerTick`）、脉冲波前。
- **判据**：`tests/zcds-progress.test.ts`（含 3/4 号席位方向、铺过 2 步起跑、深色带宽度、闪烁曲线、只偏深色端、脉冲曲线与探针共 7 条，注意用例须用 `advanceTo` 按绝对时刻推进）与 `tests/zcds-outline-layer.test.ts`（脉冲六边全描 / 同档合批 / 坐标对齐）。

### 9.2 row9 地块描边与地块图标同帧展示

- **2026-10-26 起不再有「按住窗」**：`ZCHexView.resolveDevelopableHold` 与 `ZC_HEX_NEIGHBOR_HOLD_SECONDS` 一并删除。新点亮邻格的图标 / 价格在点击那一拍就出现（只叠一段缩放 + 淡入的生成动画，见第 1.4 节），所以 `ownerForHex` 直接按 `model.canPlayerDevelop()` 判色即可 —— 它与地块视图在同一次 `renderHexSystem` 里写，描边不可能比图标早。
- 生成动画只改 `buildingLayer` 的缩放 / 透明度，**不改归属**，因此不存在「轮廓先变蓝、图标还在半透明」以外的任何错位；真要再出现割裂，先查是不是有人把延迟/按住加回来了。
- **判据**：`tests/zcds-hex-neighbor-spawn.test.ts`（★row9 用例：视图桩故意不提供 `resolveDevelopableHold`，加回旧逻辑即炸）。

### 9.3 row10 开局金矿格的整圈描边**呼吸**（2026-10-26 改口径）

- **纯函数曲线 `ZCGameViewUtil.zcNeutralHintAlpha(elapsed)`**：
  - 🔴 **没有窗口**：旧口径「`周期 1.1 × 4 次 = 4.4s` 闪完就停」已删除（连同 `ZC_NEUTRAL_HINT_CYCLES` / `ZC_NEUTRAL_HINT_SECONDS`）。现在只要 `elapsed >= 0`，就一直返回 `[MIN, 1]` 之间的呼吸值 —— 「什么时候收手」只由**目标还在不在**决定（见下一条）。用户的补充口径：**一直呼吸到金矿被点**。
  - 节奏放慢加深：`ZC_NEUTRAL_HINT_CYCLE_SECONDS = 1.6`（原 1.1，1.1 读起来是「闪」）、`ZC_NEUTRAL_HINT_MIN_ALPHA = 0.15`（原 0.35）；相位用 `cos` 保证 `elapsed = 0` 最亮。
  - 旧版末段的 `(1-u)²` 收尾包络**已删除**（没有窗口就没有收尾淡出）；负值 / NaN / Infinity 仍返回 0。
- **绘制落点与生命周期**：
  - 🔴 **目标是「金矿地块」而不是只认资源点**（2026-10-26 二次修）：`findMineHintTarget` 先找 `canDevelop && tileType === ZCPvpTileType.Mine` 的格子（就是开局那圈里画 `icon_jk` + 造价「50」的那一格 —— 玩家口中的「初始生成的金矿图标」），找不到才退到中立金矿**资源点**（`neutralResourceVisualOf(neutralResourceId) === ZCNeutralResourceVisual.Mine`）。判据随目标类型走（`hintTargetKind: 'tile' | 'resource'`）：地块类看「还 `canDevelop` 吗」，资源类看「`neutralResourceId` 还是金矿吗」。
    - 旧口径只认资源点，而实战地图的金矿主要表现成**地块类型** ⇒ 目标一次都没找到，描边一格都没闪过（用户反馈「没看到效果」的根因）。
  - 🔴 **画在棋盘最上层的共享画布上**（2026-10-26 三次改，用户口径「描边需要覆盖在最上层」）：`ZCGameRenderWorld.ensureHintOutlineGraphics` 惰性建一个 `ZCHintOutline` 节点（`cc.Graphics`）挂到 **`CooldownOverlay`** —— prefab 子节点序的**最后一个图层**（`MapWater / HexLayer / OutlineLayer / ResourceLayer / DecorLayer / BuildingOverlay / CooldownOverlay`），`setParent` 追加到该层子节点序末尾 ⇒ 一定压在所有地块、城墙、资源图标、建筑与冷却环之上。画布节点位置每帧跟着**目标格心**走（顶点是格心局部坐标），整局复用一份。
    - 旧做法画在单格自带的 `TerritoryOutline` 上 —— 那份和地块同层，相邻格的底色与建筑按绘制顺序把提示线盖掉半圈（用户截图里线被切掉）。该逐格节点、`Graphics` 及 Inspector 字段现已一并移除，不再为每个地块创建闲置画布。
  - 样式（2026-10-26 用户口径「换成绿色更显眼、描边大小增加 2px、提示线用 0.94 左右」）：颜色 `ZC_CLIENT_COLORS.hint`（`#3EE36F` 绿，原金色在中立土黄底上同色系看不见），线宽 **9**（领地轮廓 6px + 2px），顶点仍复用 `ZC_OUTLINE_HEX_POINTS` 但**内缩用自己的 `HINT_OUTLINE_INSET_SCALE = 0.94`**（不是领地轮廓的 `OWNED_OUTLINE_INSET_SCALE = 0.98`）：9px 的线在 0.98 下外沿会探出格界 4~5px、盖住邻格的造价数字，0.94 让外沿基本落在格界内侧。几何在 `ZCHexView.strokeHintOutline(graphics, alpha, previousAlpha)`（画布由调用方给，视图只负责 6 条边），带 2% 死区与 `graphics.enabled` 闸门。
  - **外发光（2026-10-26 用户口径「增加 2px 左右的边缘发光」）**：`cc.Graphics` 的描边**没有渐变**（`strokeColor` 只有一个颜色），项目里也没有适用于矢量线的发光材质 / 后处理 ⇒ 按用户给的第二方案「叠加透明度过渡到边缘」实现：同一圈六边形按 **4 环 + 1 核心**共描 5 笔，宽度 `13 / 12 / 11 / 10 / 9`（核心 9 + 单侧 2px），透明度系数 `ZC_HINT_GLOW_RING_ALPHAS = [0.08, 0.11, 0.15, 0.20]`（由外到内递增）再乘呼吸值。核心线**最后画**，压在光晕之上。
    - 5 笔共用**同一份顶点**（`traceHexEdges(graphics, inset)`），否则光晕会在格角错开。
    - `lineCap = ROUND`：六边形是 6 条独立线段，平头会在每个顶点留楔形缺口（光晕的缺口尤其明显）；共享轮廓层 `flushOutlineSegments` 也是 ROUND，两条线在格角才长得一样。
    - 环系数必须严格递增，任何一环取 1 都会把光晕画成一条实心粗线（有用例钉死）。
  - `ZCGameRenderWorld.renderNeutralHint` 挂 `renderDynamic`，时间锚定 `visualTime`。**目标 id 只找一次**（`hintTargetHexId` 缓存，不做每帧全盘 find —— 提示现在是整局常驻到被点），之后每帧只查 `hexesById` 里那一格还值不值得提示。
  - 收手条件只有三条：**目标被开发 / 被领走**、**对局已结束**（`snapshot.status !== 'playing'`，避免压在胜利扫场上）、换局复位 ⇒ 置单向闩锁 `hintOutlineSettled = true` 并清空关闭 `Graphics`；换局在 `initialize` 里把 `hintTargetHexId` / `hintTargetKind` / `hintOutlineSettled` / `hintOutlineAlpha` 一起复位。
  - ⚠️ **「这一帧没找到目标」不许结账**：开局头几帧目标格可能还没翻成 `canDevelop`（归属扩散波未铺完）/ 资源还没落位，一收手整局就再也起不来。没找到就只是这一帧不画，下一帧继续找。
- **判据**：`tests/zcds-neutral-hint-outline.test.ts`。

### 9.4 row11 传说牌横幅 `ZCGameLegendBanner`：从左往右扇入 + Role 下落生成

- **统一方向**：一律从屏幕左侧外部（`-viewWidth / 2 - halfWidth`）往右扇入，已删除敌我分方向的 `isLeftSide`。
- **Role 节点生成时序（`legendRoleProgress(elapsed, slideSeconds)`）**：
  - 横幅扇入期间 Role 进度恒为 `0`（完全透明）；扇入完成后在 `LEGEND_ROLE_GENERATE_SECONDS = 0.7s` 内按**已用秒数**线性推进 `0 → 1`，下落与淡入共用缓动 `legendRoleEase = easeOutCubic`。
  - 🔴 **Y 轴 `LEGEND_ROLE_DROP_Y = 80 → 0` 是相对立绘静止位的偏移**：静止位由 `legendRoleRestY()` 算出
    （`LEGEND_ROLE_BOTTOM_Y(-188) + LEGEND_ROLE_TARGET_HEIGHT(280)/2 = -48`），实际写入 `roleRestY + 80 * (1 - ease)`。
    ⚠️ 2026-11-02 起**不再惰性捕获 prefab 的 `Role.y`**（那个 `-21.798` 是「256 原生不缩放」时代的位，
    放大到 280 后沿用会让立绘整体上浮、狼头戳出丝带上沿）。写成绝对 `0` 同样错 —— 角色会浮在半空。
  - 立绘尺寸与下落动画互不干扰：尺寸只在 `renderContent` 换卡时按 `applyRoleScale()` 重算一次，每帧路径只动 y 与 alpha。
  - 透明度直接写 `roleSprite.color.a`（不挂 `UIOpacity`，且与 `renderContent` 互不冲突）。
- **判据**：`tests/zcds-legend-banner.test.ts`（★row11 采样用例）。

### 9.5 row12 + row13 建筑抖动扩展至产金，且建筑档拉伸量抬至 120%

1. **两档拉伸量分离**：
   - `SPAWN_SHAKE_STRETCH = 0.1`（110%）：仅供**单位自身出生**（`ZCUnitView.playSpawnShake`）使用，也是 `spawnShakePulse / ScaleX / ScaleY` 的默认参数。
   - `BUILDING_SHAKE_STRETCH = 0.2`（120%）：供**建筑抖动**（`ZCHexView.playBuildingShake`）使用，因子乘入唯一入口 `applyBuildingScale`（注：建筑生长曲线 `elasticPopScale` 的 `POP_PEAK_SCALE` 本就是 `1.2`，保持不变）。
2. **两个触发源与唯一挂点**：
   - **产兵触发（row5）**：`renderUnitEntity` 的 `isBirth` 分支检查 `unit.sourceHexId` 所在格 `building === 'barracks'` 时，直接调 `triggerBuildingShake(hexId, now)`（严禁用“是否有冷却环”作判据，否则主城/金矿也会误判为产兵）。
   - **产金触发（row12/row13）**：挂在 `economyContext.grantGold`（僅主城与金矿调用；**严禁挂私有的 `grantGold`**，否则击杀/拆建筑奖励也会让基地乱抖），当金额合法且 `> 0` 时向 `ZCBattlePresentationQueue` 推入 `ZCBuildingShake { id, hexId }`。
3. **取走即空队列（`drainBuildingShakes`）**：
   - 因 `playBuildingShake` 会重置起点（非幂等），队列**不参与按时间 `prune`**，而是由 `renderBuildingShakes`（挂 `renderDynamic`）每帧调 `takeBuildingShakes() / drainBuildingShakes()` **原子取走原数组并换新数组接手**（因此 `buildingShakeQueue` 不能标 `readonly`；空队列返回共享 `EMPTY_BUILDING_SHAKES`，上限 `BUILDING_SHAKE_CAP = 32`）。
- **判据**：`tests/zcds-building-spawn-shake.test.ts`（6 条）。

## 10. 战斗相机（R22「【战斗】相机」，2026-10-16）

需求原文（`v0.1战斗DEMO` 第 22 行）四条，分工与落点如下 —— **四条里只有第 1、3 条是这一轮新做的**：

| # | 需求 | 落地 | 备注 |
| :- | :--- | :--- | :--- |
| 1 | 局内战斗的支持地图缩放（每个地图配置对应的最大和最小倍率） | `ZCMapConfig.resolveZCMapZoom` → `ZC_MAP_ZOOM_MIN/MAX` → `ZCMatchConfig.map.zoom*` → `ZCGameHUDView.setMapZoomRange` | **新做**：地图 JSON 的 `zoomMin / zoomMax` |
| 2 | 开场动画：进入战场推镜头（展示全地图，推进放大到默认的相机高度） | `ZCGameHUDView.playMapIntro`（既有） | 收尾倍率改为 `mapSettleScale`（夹进本图区间），不再是硬编码的 `ZC_MAP_PRESENTATION_SCALE` |
| 3 | 镜头一键复位，回到初始点位，主城位于中心点下方100px | `ZCGameHUDView.resetCamera` / `mapRestCenterAtScale` + `leftPanel/ResetCameraBtn` | **新做**：`ZC_MAP_HOME_CENTER_OFFSET_Y = 100` |
| 4 | 结算拉高镜头看占据格子变化动画 | `ZCGameHUDView.startSettlementOverview`（既有，见 `docs/ZCGameHUD.md` §结算演出） | **不动**：全景 / 结算镜头是**脚本演出**，不受玩家缩放区间约束（地图把 `zoomMin` 配到 0.6 而"看清整盘"要 0.35 时，夹进去就看不到全图了） |

### 10.1 倍率区间的真源只有一份

- **地图 JSON** 的 `zoomMin` / `zoomMax` 是唯一真源；缺省 `0.6 / 1.2`（`ZC_MAP_ZOOM_MIN/MAX_DEFAULT`），
  硬边界 `0.3 ~ 1.5`（`ZC_MAP_ZOOM_HARD_MIN/MAX`）。
- `resolveZCMapZoom` 的口径：**越界 / 非数字 / 上下限颠倒一律抛错，不静默夹取**
  —— 夹取会让"地图配错了"这件事从表现上完全看不出来（只是手感怪一点）。
- HUD 侧**不写第二份默认值**（`mapZoomMin/Max` 初值就取 `ZC_MAP_ZOOM_*_DEFAULT`）；
  `ZCGame` 在 `createGame`（入口快照）与 `finishSpawnSelection`（选点后重解析的那一份）各注入一次。
- `ZCMatchConfig.map` 是这条链的最后一跳：**只加 `zoomMin/zoomMax` 两个键，随时要看有没有漏**。
- ⚠️ 地图编辑器 `tools/map-editor/app.js` 的 `buildJSON()` 是**白名单式重写**（`passthrough`）。
  加地图级字段**必须同时改「导入白名单」与「导出白名单」两处**，否则编辑器另存一次就静默丢字段。

### 10.2 缩放的两条输入路径，共用同一个 clamp

- **触摸端**：双指。`EventTouch.getAllTouches()` 取全部活动触点 —— 不能用 `getTouches()`：
  后者是"这一帧有变动的触点"，第一根按住不动、第二根刚落下时只报第二根，永远拿不到指间距。
  参照（指间距 + 倍率）在**落指那一刻**（`beginPinch`）就记好，所以第一帧 `move` 就能缩放。
- **桌面端**：滚轮（`Node.EventType.MOUSE_WHEEL`），每格 `× (1 ± ZC_MAP_ZOOM_WHEEL_STEP)`。
  没有这一支的话，编辑器预览里根本验证不了"每个地图自己的倍率区间"。
- 两条路都走 `applyMapZoom(scale, anchor?)`：`clampMapZoom` 夹取 + **锚点钉住**
  （`offset' = anchor - (anchor - offset)/scale · scale'`）+ `applyMapOffset` 收尾。
  不钉锚点的缩放会变成"缩放 + 平移"混合，手感是地图被推了一下。
- 锚点必须是**视口节点局部坐标**（`UITransform.convertToNodeSpaceAR`）：
  `getUILocation()` 给的是 UI 世界坐标（原点在设计分辨率左下角、窄长屏还带黑边偏移）。
- 双指期间**不算棋盘拖动**（落指即 `mapDragMoved = true`），否则松手会被当成点选地块。

### 10.3 「一键复位」= 秒回，不做补间

- `resetCamera()` 直接调 `resetMapPosition()`（与 `initialize` 开下一局**共用同一条路径**）
  ⇒ 复位后的构图与开局第一帧必然一致，不会出现"复位到一个只有复位才有的机位"。
- 刻意**不做 tween**：补间要多一个忙标记去和入场 / 结算镜头抢 `mapLayer`，收益只是 0.2s 的顺滑。
- `mapRestCenterAtScale` 里 `mapOffsetY = -focus.y · scale - ZC_MAP_HOME_CENTER_OFFSET_Y`：
  屏幕 y 轴**向上**为正 ⇒ 「主城在中心点下方 100px」就是让主城落在视口 `(0, -100)`。
  偏移量是**屏幕像素**、不乘倍率（否则越放大主城越往屏幕外跑）。
- 没给 `mapFocus`（自选主城图还没选点）时不加偏移，退回整盘中心。
- 复位同时清掉 `settlementOverviewRequested/Done`
  —— 否则复位完会把 `mapCameraBusy` 一直挂在"结算镜头在跑"上，棋盘直接拖不动。

### 10.4 视口 `UITransform` 只查一次

`mapOverviewScale` / `fitMapBackground` / `clampMapOffset` / 缩放锚点四处都要视口尺寸，
收敛成 `ZCGameHUDView.mapViewportTransform` **一个缓存 getter**（`initialize` 里清缓存）。
用例按「源码里 `mapViewport.getComponent` 只出现一次」钉死 —— 每多一个调用点，
就多一次"顺手判个空"的机会，判空会把 prefab 错误伪装成"镜头有点怪"。

### 10.5 判据

- `tests/zcds-map-declaration.test.ts`：`resolveZCMapZoom` 缺省 / 只配一半 / 越界 / 非数字 / 颠倒，
  以及 `configureZCMap` → 运行时绑定 → `captureZCMatchConfig` 快照三跳，外加地图目录逐张过一遍。
- `tests/zcds-hud.test.ts`：一键复位回到开局点位 + 主城在中心下方 100px、倍率区间夹取（滚轮与双指）、
  锚点钉住、双指不算点选、复位收掉结算镜头、缺省口径只有一份。
- `tests/zcds-hud-multiteam.test.ts`：`leftPanel` 五按钮几何（72×370、沿 y 等距 72、
  `ResetCameraBtn` 64×64 @ y-144 且 `_lscale = 0.7`）。
- `tests/zcds-rank-board-wiring.test.ts`：`ResetCameraBtn → onResetCameraClick → emit(ResetCamera)
  → ZCGame.onHudResetCamera → hudView.resetCamera()` 四环逐条。

## 11. 结算弹窗（`ZCSettlement`）：资源区底框与标题排版（2026-10-27）

对局结束弹出的胜负结算页（`ui/ZCSettlementPage.ts` + `ZCSettlement.prefab`）。结构与美术**全在 prefab**，
代码只按数据刷标题图、段位、奖励格（见类头注）。本节只收「资源部分」这两条 2026-10-27 的表现口径。

### 11.1 资源区必须有底框：`RewardBg`（美术稿里道具外面那块深色圆角底板）

美术稿上「通关奖励」下面是一块**比面板更深的深色圆角矩形**（`bg_02` 填充 `#2C2A2C` vs 面板 `bg_01` 的 `#4B484B`），
道具格整整齐齐落在里面；而 prefab 里原本没有这个节点 ⇒ 屏上只剩标题和两条装饰线，道具直接浮在面板底上（截图自证）。

| 项 | 值 | 说明 |
| --- | --- | --- |
| 节点名 | `RewardBg` | `RewardSection` 的**第一个**子节点（子节点序 = 渲染顺序，排在列表后面就被盖住） |
| 尺寸 | **623×327** | 与 `RewardScroll` 视窗**完全同矩形**（顶边都在 y=144.5，底边 −182.5） |
| 图 | `settlement/bg_02` | 与下方「变强途径」的 `GrowBg` **同一张**，两块框的灰度/圆角才对得上 |
| 类型 | `SLICED`（九宫格） | 131 高的图拉到 327 高，`SIMPLE` 会把 R10 的圆角竖着拉成椭圆 |

`bg_02.png.meta` 的 spriteFrame 必须带边距（`borderTop/Bottom/Left/Right = 12`，≥ 实测圆角半径 R10），
否则九宫格没有中段可拉伸 —— 但**不影响 `GrowBg`**（它是 `SIMPLE`，不看边距）。

### 11.2 标题排版：13sp / 15.5dp / #FFFEFA，且**不许被 SHRINK 悄悄缩小**

蓝湖标注（「通关奖励 拷贝」）：字号 **13sp**、行高 **15.5dp**、颜色 **#FFFEFA**、MicrosoftYaHei **Regular**、
图层 **56.5×13.5dp**。美术按 **2×** 出图（56.5×13.5 的图层在 prefab 里就是 113×31）⇒ **26px / 31px**。

| 项 | 旧 | 新 | 依据 |
| --- | --- | --- | --- |
| `_fontSize` | 28 | **26** | 13sp × 2 |
| `_lineHeight` | 34 | **31** | 15.5dp × 2 |
| `_color` | `#FFFFFF` | **`#FFFEFA`** | 标注色值（暖白，不是纯白） |
| 节点高 | 27 | **31** | 见下面的 🔴 |
| `_isBold` | false | false | Regular |
| 描边 | 黑 / 3px | 黑 / 3px | 保留：白字靠这层黑边在深色底上立起来 |

🔴 **本轮真正的坑：`_overflow: 2` 是 SHRINK，它按「行数 × 行高」和**节点高**比，塞不下就按比例缩字号。**
原稿图层高 13.5dp（=27px）但行高 15.5dp（=31px），27 < 31 ⇒ 27/34 那一档把 28 直接缩成 **22**，
屏上比美术稿小一圈 —— 这正是「字号和美术稿不统一」的根因。prefab 里 `_actualFontSize` 留着的
22 就是缩完的残值（`28 × 27/34 = 22.2`）。**修法是把框高抬到行高（31），而不是继续调 `_fontSize`。**
（同一份 prefab 里 `RankName/RankScore/RankHint/RankAdd` 也是这个形状 —— 26×25/32=20、24×21/30=16 …
`_actualFontSize` 与公式逐位吻合。那些是按眼睛调过的既有观感，本轮**不动**。）

「变强途径」的 `GrowTitle` 与本标题在美术稿里是同级标题 ⇒ 跟着改成同一组数（26 / 31 / #FFFEFA）。
项目里**没有导入任何 TTF**（`_isSystemFontUsed: true` + `_fontFamily: "Arial"` 全工程统一），
所以设计稿的 "MicrosoftYaHei" 在设备上只能落到系统默认中文字体；真正承载观感的是字号 / 行高 / 颜色 / 描边 / 字重。

判据：`tests/zcds-settlement-reward-frame.test.ts`（9 条）—— 底框存在且是第一个子节点、与视窗同矩形（顶/底边各算一遍）、
复用 `bg_02` 且为 SLICED、meta 边距 ≥ 圆角半径；标题的 26/31/#FFFEFA/不加粗、描边保留、
**「框高 ≥ 行高」的 SHRINK 守卫**、两个标题同字号、以及「标题墨迹下沿到框顶 ≈13px」的间距。

### 11.3 奖励格统一走公共 `RewardItem`（2026-10-28）

结算页的奖励格不再自带一份实现（原先是 prefab 里烘一个 `GoodsBox` 静态槽位 + `content/Slot` 模板），
改为与领地页三个弹窗（宝箱详情 / 关卡界面 / 玩家关卡）**共用同一份公共奖励格**
`ui/common/RewardItem.prefab`（`RewardItemView` 自己解析图标 / 品质框 / 数量）。

| 项 | 旧 | 新 |
| --- | --- | --- |
| 格子来源 | prefab 内烘的 `content/Slot` 静态槽（`GoodsBox`） | `VirtualScrollView.itemPrefab` → `ui/common/RewardItem.prefab` |
| 创建模式 | `itemCreationMode: 0`（NODE，模板取 content 首子节点） | **`itemCreationMode: 1`（PREFAB）** |
| 宿主喂什么 | 解析好的帧（`qualityFrame` / `iconFrame` / `number`） | **`{resId, amount}`**（`IRewardItemData`） |
| 格子尺寸 | 100×100 | **96×96**（公共件原生尺寸） |
| `content` 子节点 | 1 个静态模板 | **0 个**（PREFAB 模式下 `start()` 会 `removeAllChildren()`） |

**间距按设计稿反推**（格子从 100 缩到 96，但**列距 111 / 行距 114 不变**）：
`gridSpacing = 111 − 96 = 15`、`spacing = 114 − 96 = 18` ⇒ 落位与原稿逐值相同（首列 x=−222、首行 y=−68）。
⚠️ 行心 −68 与设计稿量的 −70 差 2px，来源是**格高**（96 的一半 48 + header 20），不是排版错。

**资源入口由控制器统一处理**：每个 `RewardItemView` 持有 `ComponentController`，首次加载时从既有 GameContext 取得必需服务，帧租约归当前格子的控制器，销毁时释放。主界面与对局流程共用此路径，无需组合根或宿主页单独调用 useAssets。
帧加载失败继续 `console.warn` 出声；节点销毁、资源作用域释放和条目复用仍必须校验。

**跨包引用是安全的**：`ZCSettlement.prefab` 在 **battle 分包**，`RewardItem.prefab` 在 **resources 首包**。
Creator 的规则是「被多个包引用时，资源存进**优先级高**的包，另一包存一条 `redirect` 记录指向它」
（`resources` 优先级 8 > `battle` 2 ⇒ 资源留在 resources，运行期 battle 读到的是同一条 uuid）。

判据：`tests/zcds-settlement-page.test.ts`（PREFAB 模式 / `itemPrefab` 指向公共件 / content 无静态槽位 / 落位公式）
+ `tests/reward-item.test.ts`（控制器资源归属 / 加载失败必须出声）；
端到端探针 `tmp/g_settlement_rewarditem_verify.mjs`（12 条：奖励格**真的出图出框**、数量、落位、尺寸）。

## 12. 多人伤害统计（2026-11-09）

- `GameRunAway` 使用逐玩家纵向列表，按本局席位顺序显示 2～4 人，自己固定首行并标“我”；头像与昵称来自 `seatProfiles`，阵营标记复用战场配色，不合并对手数据。
- 每行显示金色造成伤害和蓝色承受伤害；同类进度条以全体玩家该项最大值为统一上限，数值独立右对齐并使用千位分隔。数据变化不重排行。
- 面板随实际人数调整高度；无关闭按钮，沿用 `PopupBase` 的点内容外空白关闭。原有返回主界面模式保留独立按钮和空白关闭限制。
- 运行控制器在已有静态刷新节奏（0.15 秒）推送本局模型统计，只刷新已打开窗口；异步加载完成时立即追平最新统计。关闭后停止刷新，结算或退出时关闭窗口，退出/结算后迟到的加载结果立即释放。
- 头像经弹窗资源作用域与既有 `HeadArt` / `createIconLoader` 加载，关闭后迟到结果不得回填。视图不读取全局模型、不推进战斗规则、不新增统计网络请求。
- 验证：`tests/battle-runtime-controller.test.ts`、`tests/battle-composition-services.test.ts`、`tests/zcds-settlement.test.ts`、`tests/zcds-progress.test.ts`；交互和归属守卫 `tests/view-intent-events.test.ts`、`tests/callback-owner.test.ts`。真实引擎探针需覆盖四行绑定、双人收缩、数值/比例更新与点空白关闭。

#### 2026-11-24 头像底框按品级（对齐效果图）

- 行内头像位不再是「淡紫空心环 + 透明底」：`Avatar` 节点改成 **69×69 的 `cc.Mask`（RECT）容器**，
  容器里挂子节点 `Base`（69×85 的 Sprite，上对齐、`y=-8`）承载整张品级卡框，`Portrait` 头像叠在其上；
  `RunAwayUnitItem.base` 绑 `Base` 的 Sprite，运行时按 `unit.rarity` 整张换图（映射在 `ui/RunAwayQualityArt.ts`）。
- 底图**直接复用卡框原图 `image/frame/common_img_pzk_0N`（103×126），不再另出裁切派生图**：
  Mask 只有 69 高，可见区正好截掉底部灰「卡名条」，方形底、底部暗边、四角描边都保留原图效果。
  映射与 `cardUiArtRarity.frame` 同源：金 01 / 紫 02 / 绿 03 / 蓝 04；换图只换 pzk 原名，尺寸一致不用改节点。
  同一份 pzk 弹窗统计行与卡牌卡框两处通用，避免同名图多份维护。
- 品级取席位卡池的 `ZCDeckCard.rarity`（`ZCBattleRuntimeController.damageUnits`），查不到卡（波次怪 / 中立怪）按绿兜底。
- 判据：`tests/zcds-settlement.test.ts`（prefab 的 Mask 结构 + `Base` 高度 + 默认底框 uuid + 按品级取图）、`tests/zcds-progress.test.ts`（复用清空底框、底框必须在 Mask 下）、`tests/zcds-damage-stats.test.ts`（模型 `rarity` 字段）。

## 13. 技能释放与独立目标选择（2026-11-18）

当前口径由用户在[索敌机制落地方案](design/zcds-索敌机制落地方案.md)中确认；替代 2026-11-11 的“所有打人技能封顶到普攻范围”。

### 13.1 搜索与合法性

- 普攻重新索敌按 `D²×仇恨系数×卡牌价值系数` 排序；卡表 `unitValueFactor` 越小越优先，旧配置默认 1。有效锁定保持，技能独立选敌继续取最近；首版逐卡权重和调参依据见索敌方案 §10。
- 打人技能独立选择最近合法敌方单位，不复用普攻锁定的墙/建筑；同距按 id。Range=1 使用技能自己的搜索半径，All=2 搜索全场。参数袋按车道前缀配置 `xxxTargetMode`，缺省 Range，字段清单及各车道半径见方案 §9.1。
- 正式对局由 `ZCGameModel.buildSkillTriggerContext` 注入 `selectSkillTarget`，与攻击系统共用 `ZCTargetingSystem.acquireSkillUnit`。死亡、同 owner 与不可攻击的飞行目标均排除。多点打击的实际伤害选择也按最近排序。
- 自身圆形/前置矩形光环须存在真实形状覆盖的合法目标，判定复用 `zcGroundZoneReaches`，与出手后的区域伤害一致。喷火保留 350 表值长度；`auraTriggerRange` 正数才附加触发限制，0 与缺省等价。
- 自身增益、常驻被动、连发和低血护体继续豁免选敌闸门；冲锋空挥耗 CD 的既有规则保持。

### 13.2 射程与兼容上下文

- 普攻 `attackReach=(attackRange+目标半径×0.5)×combatDistanceScale`，生效定义含 `attackRangePct`。
- 自身 reach（副轨默认搜索半径及未配置搜索范围的落雷/弹体所用）取自身身体半径。其余技能沿用各自配置半径，不再统一封顶。
- 未注入独立选敌的旧/轻量上下文保留 `inAttackRange` / `attackReachOf` 兼容行为。共享 `release` 仅在真正需要且触发就绪时惰性计算，每单位每拍至多一次；无技能、未就绪单位不扫描敌人。

### 13.3 待触发与冷却

没有合法目标、实际形状无法覆盖敌人或参数不全时，保持 readyAt/累计次数不变，不刷新施法动作窗口。目标进入范围当拍补放。持续窗口已施放的后续波次仍按既有节拍推进，不反向取消已创建的效果。

#### 2026-11-20 口径收敛：除被动 / 召唤 / 陷阱，主动技能一律「等找到目标」

用户原话：「除了被动和召唤类以及陷阱类的，其他的主动技能都需要等待找到目标触发」。

逐条核过一遍，**绝大多数主动车道本来就已是这个语义**，只是判据分三种（这也让改动量只有两条）：

| 判据 | 车道 | 被拦下时 |
| :--- | :--- | :--- |
| 普攻射程（`release` → `hasTargetInAttackRange`） | `self_aura` / `bolt_strike` / `chain_lightning` / `ray_beam` / `wind_shot` / `missile_barrage` / `random_strike` / `blink_strike` / `splash_shot` / `secondary` / **`storm_zone`（本次新增，另加第二道闸）** | 不消费 CD，下拍重试 |
| 技能自己的作用范围（在 `castXxx` 里 `return false`） | `roar`（半径内没敌人）/ `burst_skill` + `venom`（同）/ `single_strike`（`singleSearchRadius` 内没人）/ `charge_shield`（`dashHeadingTowardTarget` 拿不到方向）/ `legacy_dash`（`dashTowardNearest = 1` 时找不到最近敌人）/ **`fan_slow`（半径内没敌人，本次新增）** | 同上 |
| 不看目标（刻意保留） | `self_cast`（自愈 / 迅击 / 闪避 / 净化，效果落在自己身上）、`team_buff`（给友军加攻）、`counter_buff`（累计普攻自增益）、`legacy_dash` 的 `dashTowardNearest = 0` 分支（102703 尖刺冲锋「沿朝向平移」）、`trap` / `summon_unit` / 全部被动 | — |

🔴 两条新增的**判据不同，别抄错**：

- `storm_zone` 用 `release` **加一道「最近敌人 ≤ 普攻射程」**。三叶小丑 68020 普攻射程 300 表值
  （`skillAttr 502203`「三叶小丑普攻攻击距离」）= **90 世界 px**，比风圈（90 表值 = 27 世界 px）宽松
  ⇒ 不会因为「风够不着但普攻够得着」漏放。**为什么要第二道**：`release` 把「锁定目标在射程内」
  也算有目标，而那个目标可能是一堵城墙 —— 只吃 `release` 会出现「贴着墙打、身边一个敌人也没有，
  却往自己脚下扔一片风」。第二道闸判 `nearestEnemyDistance ≤ attackReachOf`，与 `castStorm` 里
  挑投送目标（`stormDeliveryTarget`）的扫描同源，保证「闸门放行 ⇒ 必有落点」。
- `fan_slow` 用**扇形自己的半径**。机甲菇 68015 普攻射程只有 45 表值 = **13.5 世界 px**（贴脸近战），
  而扇形是 150 表值 = **45 世界 px**。用 `release` 卡会把「扇形够得着的人」全挡在外面，
  这条 14 秒 CD 的技能几乎放不出来（`zcds-fan-single-batch14` 的夹具里
  `inAttackRange: () => false` 就是为这条留的守卫）。

⚠️ 副作用：`storm_zone` 与 §33 的「投送段」叠加后，施放瞬间目标必然在 90 世界 px 内
⇒ 飓风的飞行距离变短（最远约 90 世界 px，约 3.2 秒），视觉上仍是「从本体飞到目标」，
但不会再有「飞很远」的情况。
`castStorm` 里「无活目标 ⇒ 原地生成」那条分支仍然保留，但只作为**兜底**：闸门放行后
锁定目标可能还没写（`targetUnitId` 要等这一拍的攻击流程跑完），投送段会按同一套射程
再扫一次最近的活敌（`stormDeliveryTarget`），扫不到才原地生成 —— 这条兜底就是
「一加闸门就不飞了」的修复（2026-11-20 用户实测）。

验证：`zcds-targeting-policy.test.ts`、`zcds-skill-trigger-range.test.ts`、`zcds-skill-plan.test.ts`、`zcds-active-pilot.test.ts` 与各车道回归。追击时钟与脱战名单的快照验证见 `zcds-neutral-features.test.ts`。

## 14. 磁电菇两条新主动：`bolt_strike` 车道 + 软控「麻痹」（2026-11-11）

技能设计案第 80/81 行新设两条主动（68016 磁电菇，金档）：

| 技能 | 触发 | 行为键 | 车道 |
| :--- | :--- | :--- | :--- |
| 101603 五雷轰顶 | 主动 · 冷却 12 秒 | `bolt_strike` | **新开**（`ZCSkillTriggerSystem.applyBoltStrike` → `ZCAttackResolutionSystem.castBoltLine`） |
| 101604 磁电冲击 | 主动 · 累计 8 次普攻 | `self_aura` | 复用自身光环，新增「累计次数」触发口径 |

### 14.1 五雷轰顶：为什么另起一条车道

设计口径是「锁定目标落 1 道雷，再沿**该目标的背朝向**补 2/3/4 道，每道间隔 45px」。
它与已有两条「打人」车道的差别都不小：

- 副轨扇形（`secondary`）的方向由**自身朝向**定，而且是一整片扇形，不是一条线；
- 多点打击（`random_strike`）按「就近 / 随机」挑**一批**目标各打一发，落点与目标位置无关。

所以另起 `bolt_strike`：只锁**一个**目标，雷沿「自身 → 目标」的延长线排开。它有自己的 CD 字段
`unit.boltReadyAt`（`ZCSnapshotCodec` 已登记），可以与副轨 / 光环同时挂在同一张卡上。

落点与判伤：

| 量 | 来源 | 换算 |
| :--- | :--- | :--- |
| 雷数 | `boltCount` = 3 / 4 / 5 | 1 道落在目标身上 + 2/3/4 道沿背朝向 |
| 间距 | `boltSpacing` = **60**（表值；2026-11-11 第二轮 30 → 45，2026-11-12 第三轮 45 → 60，每次 +15px） | × `combatDistanceScale` 0.3 = **18 世界 px**；屏上 ×0.76875 = **46.1 px** |
| 出现间隔 | `boltInterval` = **0.15 秒**（原 0.1 → 0.18 → 0.15） | `nextWaveAt = now + index × 0.15 + boltDelay`；五道 = 0.15 / 0.30 / 0.45 / 0.60 / 0.75s |
| 判伤延迟 | `boltDelay` = 0.15 秒 | 落在特效**第 5 帧**的时间窗内（见 §14.5） |
| 单道倍率 | `boltDamageRate` = 1.6 / 2.0 / 2.5 | **每道独立计** ⇒ 总伤 480% / 800% / 1250% |
| 判定半径 | `boltRadius` = 90（表值） | × 0.3 = 27 世界 px |

「160%/200%/250% 每道独立计」是用户 2026-11-11 拍板的口径 —— 不是 3/4/5 道**分摊**一份伤害。

实现上每道雷 = **一条 `area` 表现事件 + 一个 `wavesLeft: 1` 的地面区域**：表现事件负责画闪电，
区域只负责**在 `nextWaveAt` 那一刻**结算一次伤害与麻痹，所以两者不会重复扣血。

### 14.2 磁电冲击：`self_aura` 的第二种触发口径

「一片持续 N 秒、每秒一波、最多 N 人」正是自身光环已有的能力集，缺的只是
**触发口径**（原来只有 `auraCooldown` 秒）与四个可选落点 / 朝向参数：

| 参数 | 值 | 说明 |
| :--- | :--- | :--- |
| `auraEvery` | 8 | **累计 8 次普攻**触发，与 `auraCooldown` **二选一**；计数走 `unit.auraFiredCount` |
| `auraForward` | **= 同档 `auraRadius`**（160/180/200） | 2026-11-11 第二轮：从 1 改成同档半径 ⇒ 光束覆盖「本体中心 → 前方 `2×radius`」，起点贴中心。**表值** × `combatDistanceScale` |
| `auraFollow` | 0 | 冲击波**站桩**，不跟本体跑（缺省 1 = 跟随，无尘禁土不变） |
| `auraFaceTarget` | 1 | 出生点偏移与矩形朝向共用「本体 → 当前目标」方位角（见 §14.6） |
| `auraVisualLiftPx` | 30 | 表现竖直抬升（屏上 px），把光束从脚点抬到身体中心 |
| `auraWaveMaxTargets` | 5 | **每波**目标上限（与 `maxHits` 的「整段名额」不是一回事） |

波数 `waves = round(auraSeconds / auraInterval)` ⇒ 3 秒 / 每秒 1 波 = **3 波**。
判定是**随目标方向旋转的矩形**（半长跟随 `auraRadius`、半宽 54），贴合横向束美术 —— 见 §14.6。

自身光环的造型现在**按单位可覆盖**（`ZCSelfAuraFx.SELF_AURA_FX_BY_UNIT`，写法同
`ZCCombatEffectFlight.MISSILE_FX_BY_UNIT`）：68016 → `雷电冲击`，其余（68025 无尘禁土）→ 原来那根光柱。

### 14.3 软控「麻痹」`numb`：与硬控 `paralysis` 不是一回事

设计原文「麻痹只禁止攻击，移动速度减少 50%」。现有 `paralysis` 是**硬控**：
`controlOf` 非空 ⇒ `ZCUnitSystem.updateUnit` 在最前置闸门整段 `return`，连移动、索敌都停。
直接复用它会把「减速 50%」变成「定身」。

所以新建 `pvpStatus.numb`：**`control` 留空**，数值全部走 `statJson`：

```json
{ "moveSpeedPct": -50, "attackDisabled": 1 }
```

- `moveSpeedPct` 走既有属性链，不需要新代码；
- `attackDisabled` 是 `ZCStatusStatMods` 新增的软控位（`> 0` 即禁），由
  `ZCStatusSystem.attackBlockedOf(unitId)` 聚合；
- 消费点只有两处，都在「这一拳」上：`ZCUnitSystem.startAttack` 开头 `return`（不改
  `battleState`，单位原地站着，解控后下一帧就补一拳）、`tryStartDash` 返回 `false`（冲刺就是普攻本身）；
- **移动 / 索敌 / 技能不受影响** —— 那才是「只禁攻击」。
- 为什么不用 `attackIntervalPct` 顶：那个是乘在间隔上的（`1 - pct/100`，下限 0.01），
  拉到 100 反而变成攻速暴涨，表达不出「一拳都打不出」。

每个被打到的敌人**各自掷 30%**（不是整段判定一次）：判定落在 `ZCGroundZoneSystem` 的波次结算里，
由区域的 `hitStatusId` / `hitStatusChance` / `hitStatusSeconds` 三个可选字段驱动，
`context.random()` 必须是**对局种子随机**（不能用 `Math.random`，否则回放重算不一致）。

### 14.4 配表落点

| 表 | 改动 |
| :--- | :--- |
| `pvpSkillPlan` | +6 行（101603 / 101604 × 3 档，`pvpSkillId=30231`），参数全在 `skillParamJson` |
| `pvpStatus` | +1 行 `numb`（`control` 空、`statJson` 见上） |
| `K-卡牌升级.xlsx / 卡牌技能升级表` | 193~198 行本来就有这两条技能的空行，补 `name` / `desc`（`modfiy` 由 `project_skill_plan.mjs` 回填） |
| `armySkillLevelUp` | 同步 6 行 `name` / `desc` / `modfiy=[9401603x / 9401604x]` |

修改器号段：101603 = **94016031~33**，101604 = **94016041~43**（与 101601 的 94016011~13、
101602 的 94016021~23 同一套编号法）。解锁等级以 K 表为唯一真源（101603 = 9/18/24，101604 = 0/20/25）。

一键落地：`node tools/config/patch_magdi_mushroom.js assets/remoteRef "../doc/塔防数据配置/json/client"`
（幂等，重复跑只校正解锁等级）+ `python tools/config/patch_magdi_mushroom_k.py`（K 表 B/C 两列，zip 级手术）。

判据：`tests/zcds-magdi-mushroom.test.ts`（**25 条** —— 配表 / 两份产物互校 / K 表 6 行 / 双登记 /
每道独立伤害与排布 / 无目标不放 / 待触发不消费 CD / 累计 8 次 / 每波 5 人 / 逐目标掷骰 /
软控只挡普攻不冻移动；后 7 条盯两套特效预制体：三件套齐备 / 屏上尺寸对得上判定半径 /
帧数与 `wrapMode` / 「第 5 帧判伤」/ `f9941` 子资源 / 两条路径进得了本局加载清单）。

一键重建特效：`python tools/build_magdi_strike_fx.py`（幂等，复用已有 uuid；源散图在
`tmp/projectile_src/<目录>/`，原始尺寸备份在 `tmp/fx_backup/`）。


### 14.5 两套特效的预制体（2026-11-11 补齐）

美术原本只丢了散帧，两个目录里**没有 prefab / anim / pac** ⇒ 两条技能只能借别人的预制体占位
（`雷法师_武将闪电` / `持续光环伤害效果`）。现在由 `tools/build_magdi_strike_fx.py` 生成三件套：

| 目录 | 帧 | sample | wrapMode | 动画时长 | 画布 | 烘焙缩放 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `磁电菇_劈雷技能/` | 20（全取） | **30** | 1（一次性） | 0.667s | 193×231 | 1（已烘进贴图） |
| `雷电冲击/` | 6（第 9~14 帧） | 12 | 2（循环） | 0.5s | 489×144 | 0.575963 |

三条硬口径：

1. **`sample` 取 30 是为了「判伤在特效第 5 帧」**。第 5 帧 = 下标 4，占
   `4/30 ~ 5/30` = 0.1333~0.1667s，配表 `boltDelay = 0.15` 正落在这一帧**中间** ——
   配表一个数都不用改。换成项目里最常见的 `sample 12`，第 5 帧在 0.333s，判伤会早 0.2s。
   ⚠️ 表现事件的 `durationSeconds` 必须 ≥ 动画总长，否则 `ZCGameModel` 按
   `startedAt + durationSeconds` 剔除事件，第 16 帧之后那段「雷尾消散」永远看不到
   ⇒ 代码常量 `ZCBoltStrikeFx.ZC_BOLT_EFFECT_SECONDS = 20/30`，`castBoltLine` 用它算时长。
2. **`wrapMode` 由「这张特效要不要持续」决定**：落雷是一次性的（1 = Normal，停在末帧）；
   冲击波要在 3 秒里一直亮着，只能循环（2 = Loop），否则播 0.5s 就定格成一张静止图。
   设计案 101604 表现原文「中间需要持续时间是，使用 9~14 帧循环」⇒ 只取 6 帧，
   1~8（起势）/ 15~18（消散）搬去 `tmp/projectile_src/雷电冲击/`，不留在 bundle 里被打包。
   入场「由无到有」由区域系统的 `growSeconds = 0.2` 负责。
3. **尺寸反算**（屏上 px = 逻辑 px × 0.76875，见 §1.11），分母取「可见尺寸」不是画布宽：
   - 落雷：`boltRadius = 90` ⇒ 爆闪直径 **138.4** 屏上 px；分母 = 20 帧底部 12% 带的最大可见宽
     = 339 源 px（画布 1019 宽里闪电只占 450，拿画布当分母会把雷缩到三分之一）；
   - 冲击波：`auraRadius = 180`（L2 档）⇒ 长度 **276.8** 屏上 px；分母 = 内容并集宽 961 源 px。
     三档半径 160/180/200 只有一个预制体 ⇒ 按中档烘焙，L1 视觉偏大约 12.5%、L3 偏小约 10%。
   - 落雷的**地面接地点压在节点原点上**（`_lpos.y = +110.618`，Cocos +y 朝上）——
     `ZCCombatEffectView.mountVisual` 明确**不清零**根节点位置，所以这个静态摆位有效。
     符号写反的症状是「雷悬在地面上方半个画布」，最难一眼看出来。

✅ **形状不一致已解决（2026-11-11 用户口径「把判定改成长方形，尽可能贴合特效范围」）**：
磁电冲击的判定已从**圆**改成**随目标方向旋转的矩形**，且光束起点压到本体中心、终点朝目标，见 §14.6。
落雷那边一直不存在这个问题（判定圆就压在爆闪上，见 §14.1 的落点表）。

🔴 散图 meta 必须是 `type: "sprite-frame"` 且带 `f9941` 子资源。默认导入是 `type: "texture"`
（只有 `@6c48a`），`cc.Sprite._spriteFrame` 引 `@f9941` 取不到 —— **不报错、特效永远不出现**，
整条链路上没有任何一处会告警。生成器里 `build_sprite_frame_meta` 专门处理这一步，
`tests/zcds-magdi-mushroom.test.ts` 有守卫。

### 14.6 磁电冲击的判定改成矩形、起点压中心、终点朝目标（2026-11-11）

两轮用户口径，**后一轮覆盖前一轮的表现结论、不改判定尺寸**：

1. 「**把判定改成长方形，尽可能贴合特效范围**」（附「横束套在红色虚线圈里、圆的上 / 下缘大片空白」截图）；
2. 「**释放磁电冲击技能的特效起始位置要在角色的中心点，终点要朝向目标方向**」。

**尺寸怎么来的**：把 6 帧散图的 alpha 并集量出来 —— 485×143 画布 px，乘 prefab `_lscale`
0.575963 = 屏上 **279.3 × 82.4**；再除 0.76875 得逻辑 **363 × 107**。

| 量 | 取值 | 依据 |
| :--- | :--- | :--- |
| 半长 `rectHalfLength` | **跟随 `auraRadius`**（160 / 180 / 200） | 美术按 L2 的 180 烘焙 ⇒ L2 的 360 正好等于美术宽 363 |
| 半宽 `rectHalfHeight` | **54**（表值逻辑 px） | 108 逻辑 = 屏上 83.0 ≈ 美术高 82.4 |

表里**只加一个尺寸键**：`skillParamJson.auraRectHalfHeight = 54`（三档同值），
半长不写 —— 写了就等于把 `auraRadius` 那三档变成摆设。要让长度也固定贴合美术，
加一行 `auraRectHalfLength: 182` 即可。

**起点与朝向（第二轮）**

| 表键 | 值（101604 L1/L2/L3） | 效果 |
| :--- | :--- | :--- |
| `auraForward` | **160 / 180 / 200**（= 同档 `auraRadius`） | 区域中心从本体前移**半个身位** ⇒ 整条束覆盖「本体中心 → 前方 `2×radius`」，起点贴中心 |
| `auraFollow` | 0 | 站桩，不跟本体跑 |
| `auraFaceTarget` | **1** | 出生点偏移与矩形朝向共用「本体 → 当前目标」方位角 |
| `auraVisualLiftPx` | **30**（屏上 px） | 竖直抬升：单位根节点是逻辑**脚点**，不抬的话光束一半埋在地面线以下 |

🔴 **`auraForward` 与 `auraFaceTarget` 必须同源**。两个量都由
`castSelfAura` 里同一个 `aimRadians = atan2(target.y - origin.y, target.x - origin.x)` 算出
（没目标时回落到 `unit.facingRadians`）。历史 bug 的形态是：出生点沿本体朝向飘、矩形朝目标，
**中心对不上** —— 所以 `spawnX/spawnY`、`angleDegrees` 三处共用一个角，不能各算一遍。

**实现要点**

- `ZCGroundZoneState` 新增 `rectHalfLength` / `rectHalfHeight` / `angleDegrees` / `visualLiftPx`，
  四个都进 `ZCSnapshotCodec` 白名单（缺了会在读档时报错，补了才还原得了形状与朝向）；
- `castSelfAura` 读表值后**乘 `combatDistanceScale`**（与 `auraRadius` 同一套口径），
  `rectHalfHeight > 0` 才启用矩形，否则一个字节都不变；
  `auraFaceTarget` / `auraVisualLiftPx` 缺省 0 ⇒ 无尘禁土（102503）、喷射火焰（102603）逐字不变；
- 形状判定收口成一个纯函数 `zcGroundZoneReaches(zone, x, y)`：
  圆形 = `hypot ≤ radius`；矩形 = 先把点按 `-angleDegrees` 转回区域本地系
  （`localX = dx·cos + dy·sin`、`localY = -dx·sin + dy·cos`），再判 `|localX| ≤ 半长 && |localY| ≤ 半宽`。
  **`resolveWave` 与 `resolveExpiry` 两处都必须换** —— 漏掉到期那一处，
  症状是「每波打不到、区域消散那一下突然按圆炸一次」，最难查；
- 粗筛 `radiusHex` 改用 `zcGroundZoneBroadRadius`（矩形取**外接圆** `hypot(半长, 半宽)`）——
  粗筛只负责别漏人，真正的形状由上面的纯函数收口。矩形长边不取外接圆会被格子索引直接筛掉。

🔴 **朝向只能由模型给，视图算不出来**：`area` 事件 `from == to`，
`zcCombatEffectHeadingDegrees` 对零位移返回 `null`，美术本体本来也不转。
所以模型把方位角写进 `ZCCombatEventState.angleDegrees`，`ZCCombatEffectView` 见
`event.angleDegrees !== undefined` 就直接 `setRotationFromEuler(0, 0, angle)` 并**跳过头函数**；
`syncHoldVisual` 每帧同步，区域跟着目标转向时美术一起转。

🔴 **`visualLiftPx` 必须加在 `mapToViewY` 之后**（屏幕竖直、不跟旋转），
与 `ZCCombatEffectPlacement.zcCombatEffectLiftY` 同口径。写进 prefab `_lpos` 会被
`setRotationFromEuler` 一起转成侧移 —— 表现是「一转向光束就飘起来」。

⚠️ **不写 `casterLiftPx` 抬本体**：设计原文要的是「特效起始位置在角色中心」，
抬的是光束不是人（麻辣铁锅 102603 的「跳起来」才抬本体，见 §15.2）。两者别混。

🔴 这条是**逐技能开的**，不是全局改形状：无尘禁土（102503 站桩光柱）与麻辣铁锅
喷射火焰（102603 身前圆形）仍然是圆 —— 设计原文就写的「圆形区域」。
守卫 `tests/zcds-magdi-mushroom.test.ts` 第八节 4 条（配表 / 几何 / 结算 / 代码接线）
+ 第九节 3 条（旋转几何 / 事件抄角度 / 代码接线）；
一键 `python tools/config/patch_magdi_rect_judgment.py`（尺寸）与
`python tools/config/patch_magdi_aura_facing.py`（起点与朝向），两者幂等、都先做逐字节 round-trip 自检再写。

🔴 **描述有两份，改数值时必须一起改**：`armySkillLevelUp.desc`（卡片 UI 真读，
`CardSkillDescMarkup` 就是拿它转 RichText）+ **`pvpSkillPlan.desc`**（没有代码消费，但会被人读）。
只改前者会出现「同一行里 `boltSpacing: 60` 配着『每道间隔 30px』」这种自相矛盾的状态 ——
2026-11-11 第三轮就踩过，靠 `tools/config/patch_magdi_plan_desc_round3.py` 补的。
`pvpSkillPlan` 要按 **`modifierId`** 定位，`pvpSkillId`（30231）被 101603/101604 两条链共用、**不唯一**。

✅ **源表已补齐（2026-11-11 17:4x）**：`J-技能表.xlsx / PVP技能配置` 原本**没有 101603/101604 这 6 行**
（68016 共 59 行全是 101601/101602/191602/109001），两条技能只活在两份 JSON 产物里 —— 一旦某天
eSon 打表以 Excel 为准重生成 JSON，这 6 行会被整块刷掉。现已追加到 **2213~2218** 行，
`dimension` 同步到 `A1:AC2218`，29 列逐格与 JSON 对拍一致。

- 一键 `python tools/config/patch_magdi_skill_rows_excel.py`，**zip 级手术**：只重写
  `xl/worksheets/sheet9.xml`，其余 51 个成员逐字节复制；按成长技能链取行、已进表的自动跳过（幂等）。
- 页内两种编码：**表头行 `t="s"`（共享字符串）、数据行 `t="inlineStr"`** —— 读表头要解
  `sharedStrings.xml`，写数据行不碰它、样式逐列沿用末行。
- ⚠️ `export_tafang.mjs --validate-only` 校验的是 `assets/remoteRef`（不是 xlsx），所以补行不改变
  校验结果；它的错误行走 stderr。
- ✅ **68026 麻辣铁锅那 9 行也已进表（2026-11-12）**：`94026031~33` / `94026041~43` / `97026011~13`。
  命令行直接传链号即可：`python tools/config/patch_magdi_skill_rows_excel.py 102603 102604 372601`。
- 🔴 脚本原先是**只追加**（已存在的键整段 skip）⇒ 改已有行的数值时它会打印 `[skip]` 然后什么都不做，
  源表静默停在旧值。现已改成 **upsert**（原地重写 + 缺的补末尾），回读逐格对拍。

### 14.7 五雷轰顶的「看得见间隔」：间距 60、逐道 0.15 秒（2026-11-12 第三轮）

用户口径：「还是没做出明显的出现时间间隔差异和距离间隔，增加每道落雷的间隔 15px，
每道特效播放时间间隔 0.15s」。

| 量 | 第二轮 | 第三轮 | 屏上读数 |
| :--- | :--- | :--- | :--- |
| `boltSpacing` | 45 | **60** | 45 ⇒ 34.6px（几乎叠死）、60 ⇒ **46.1px** |
| `boltInterval` | 0.18 | **0.15** | 五道出现时刻 0.15 / 0.30 / 0.45 / 0.60 / 0.75s |
| `boltDelay` | 0.15 | 0.15（**不动**） | 它锚的是特效第 5 帧的判伤窗口，与逐道间隔是两件事 |

尺度感：一道雷特效本身约 **193×231 屏上 px**，而 45 表值只有 34.6px —— 五道完全叠住，
所以「加间距」必须加到和特效自身尺寸同一个量级才看得出排开；0.18s 又短于单道特效的
播放时长（0.667s），五道几乎同时在播 ⇒ 时间上也糊成一团。

三写落点：`pvpSkillPlan` + `armySkillLevelUp`（两份 × remoteRef/client）+ `J-技能表.xlsx`
`PVP技能配置`（`patch_magdi_skill_rows_excel.py 101603 101604`，upsert）+ `K-卡牌升级.xlsx`
B/C 列（`patch_magdi_mushroom_k.py`）+ 技能设计案 K80/P80
（`patch_skill_design_magdi_round4.py`）。守卫 `zcds-magdi-mushroom` 32 条。

### 14.8 磁电冲击跟随角色、固定在身前（2026-11-12 第九轮）

用户口径：「68016 的磁电冲击技能应该跟随角色一起移动，固定在角色身前」。截图里角色已经走到光束
右上方，光束还留在施法点 —— 因为 101604 一直配的是 `auraFollow = 0`（站桩）。

**改法只有两处**：配表 `auraFollow` 0 → 1；代码 `followCaster` 原本只会「圆心拍在本体身上」，
现在多认一个 `followForward`：

```
落点 = 本体坐标 + facingRadians × followForward
angleDegrees = facingRadians（每帧同步刷新）
```

- `followForward` 直接取 `auraForward`（`castSelfAura` 里算），**不另开参数** ——
  「出生时在身前 N px」和「之后一直悬在身前 N px」本来就是同一个数，开两个口径必然会配歪。
  101604 的 `auraForward = auraRadius`（160/180/200）⇒ 光束左缘永远压在角色脚点、右缘到身前 320/360/400。
- 🔴 **朝向必须跟着刷新**：落点沿朝向前移、矩形还朝旧角度的话，判定中心与画面上的光束立刻错开
  （`syncHoldVisual` 每帧把 `zone.angleDegrees` 抄进事件，所以只要改这一个数，视觉就同步）。
- 取 `facingRadians`（美术朝向，8 方向、45° 一档）而不是「指向目标」：玩家看到的「身前」是角色
  的正面。量化误差对判定无影响 —— 磁电菇 `unitAttackRange = 45` 逻辑 px（≈13.5 世界 px），
  贴脸目标在 22.5° 偏差下横向只偏 5 世界 px，远小于半宽 16.2。
- `followForward` 缺省 0 ⇒ 圆心贴本体，无尘禁土 102503 与所有既有光环行为逐字不变；
  它**必须进快照**（`ZCSnapshotCodec`），否则存档回来光柱会从「身前 160」跳回贴脚。

配表/产物：`patch_magdi_shock_follow.js`（两份 JSON 的 `pvpSkillPlan` + `armySkillLevelUp`）→
`patch_magdi_skill_rows_excel.py 101604`（J-技能表 upsert 3 行）→
`patch_skill_k_desc_excel.py 101604`（K-卡牌升级 B/C，第 196~198 行）→
`patch_skill_design_magdi_follow.py`（技能设计案第 81 行 K/L/M 补齐、N 换完整口径、O/P 补落地、S 已实现）。

新描述：「累计 8 次普攻：朝目标方向喷出一道长 320、宽 108 的雷电束（起点在自身中心），
持续 3 秒，**全程跟随角色移动、固定在角色身前**，每秒造成 250% 攻击力伤害，每波最多命中 5 个敌人」。

守卫：`zcds-ground-zone-system` 新增 2 条（身前距离 + 朝向同步；`followForward` 缺省贴本体且不改角度）、
`zcds-magdi-mushroom` 改 `auraFollow = 1` 并加 2 条源码接线守卫（`followForward` 落 zone、
`followCaster` 刷新 `angleDegrees`）。

### 14.9 🔴 `startedAt` 落在未来 ⇒ 视图整条不建节点（2026-11-12 第四轮，全表现层通用）

用户第三次反馈：「五雷轰顶的技能还是没有按照先后出现，**视觉感官是同时出现的**」。

前两轮一直在改配表（间距 30→45→60、间隔 0.1→0.18→0.15），判伤时刻早就是 0.15 / 0.30 / 0.45 /
0.60 / 0.75 逐道错开的 —— **数值一直是对的，错在表现层**：

```
castBoltLine:  同一拍把 N 条 area 事件推进 combatEvents，
               先后只写在 startedAt = now + index × boltInterval（未来时刻）上
ZCAttackResolutionSystem → ZCGameModel 保留事件直到 startedAt + durationSeconds
renderEffectSystem:  原来「看到事件就建节点」——
               pool.acquire → initialize → mountVisual（animation.stop()/play(默认 clip)）
ZCCombatEffectView.render:  progress = clamp((now − startedAt) / duration, 0, 1)
                       ⇒ 未到点的事件被钳成 0 显示，且动画已经在节点建好那一帧起播
```

结果：**五道雷同一帧全部亮起、动画同拍**，只是各自的进度都停在 0 —— 用户看到的就是「同时出现」。
这也是「改了几轮参数都没用」的原因：参数只改了判伤，没改到「什么时候建节点」。

**修法（唯一闸门，放在视图侧，模型语义一个字没动）**：

```ts
// ZCGameViewUtil
export function zcCombatEffectEntered(startedAt, now) {
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return true;  // 缺字段 = 立刻出现
    return startedAt <= now;
}
// ZCGameRenderWorld.renderEffectSystem：先过闸，再 acquire
for (const event of frame.snapshot.combatEvents) if (zcCombatEffectEntered(event.startedAt, now)) …
// 延迟出发的 projectile 同一条
```

- 🔴 **闸门必须在 `pool.acquire` 之前**：`initialize → mountVisual` 会把 clip 从第 0 帧 `play` 起来，
  建了节点就等于「已经出现了」，之后无论怎么隐藏/透明度压 0 都会漏出一次闪。
- `now` 取 `visualTime(frame)` = `elapsedSeconds + pendingSeconds`（≥ 逻辑时刻）：出手那一拍的第一道
  不能因为差了不足一逻辑步的余量而晚一帧出现；判据写 `<=`，写成 `<` 同样会吞掉第一帧。
- 缺 `startedAt` 一律视为「已到点」：历史口径就是「立刻出现」，闸门不能把这类表现项整条吞掉
  （`zcds-render-performance` 的手搓事件、老快照都靠这一条）。
- 落地后：5 道雷在 0 / 0.15 / 0.30 / 0.45 / 0.60 秒依次亮起，全部到点 0.6s < 单道特效 0.667s
  ⇒ 观感是「一道接一道砸下来」，而不是「一波齐射」。

守卫：`zcds-magdi-mushroom` 新增 2 条 —— ① 时间轴上「已到点」的道数逐道 +1
（`[0, 0.14, 0.15, 0.30, 0.45, 0.60]` ⇒ `1,1,2,3,4,5`）；② 源码顺序守卫（`zcCombatEffectEntered`
必须在 `pool.acquire` 之前、且弹道也过同一条闸）。

配表：**一行没改**。`boltSpacing 60 / boltInterval 0.15 / boltDelay 0.15 / boltCount 3·4·5 /
boltDamageRate 1.6·2.0·2.5 / boltRadius 90` 在 `J-技能表`（`PVP技能配置` 行 2213 起）、
`assets/remoteRef/pvpSkillPlan.json`、`doc/塔防数据配置/json/client/pvpSkillPlan.json` 三处已逐项一致
（`armySkillLevelUp` 的卡面 desc 也是「出现间隔0.15秒」）—— 本轮只补了技能设计案第 80 行
的 L/M/N/O 四格并在 P 追加第四轮复盘（`patch_skill_design_magdi_bolt.py`）。

## 15. 麻辣铁锅 68026：三段命中、滞空喷火与「第 26 帧」（2026-11-11）

技能设计案第 127~131 行（68026 麻辣铁锅，金档 · 盆栽 · 法师）。一动普攻 + 两条被动 + 两条主动：

| 技能 | 触发 | 行为键 | 车道 |
| :--- | :--- | :--- | :--- |
| 202601 烈焰弹 | 普攻 · 1.8 秒 | `projectile` | 既有；强化槽挂在本行 |
| 102601 孢子弹幕 | 被动 | `passive_stat` + `skill_params` | 既有（多弹 / 攻速 / 增伤） |
| 102602 吸养根须 | 被动 | `passive_stat` + `skill_params` | 既有（吸血 / 增伤 / 溅射） |
| 102603 喷射火焰 | 主动 · 冷却 12 秒 | `self_aura` | **复用**，新增 `casterLiftPx` |
| 102604 凤凰降临 | 主动 · 累计 8 次普攻 | `skill_params` | 既有 `projectile` + 新增「命中三段」 |

### 15.1 喷射火焰为什么复用 `self_aura`

设计原文「跳起来，在身前 350px 的位置造成一个 100×100 的圆形伤害，持续 3 秒、每秒一次，
范围内所有敌人都会受到伤害」。这句话逐项都能在 `castSelfAura` 上找到对应，**没有一项需要新车道**：

| 设计口径 | 参数 | 值 |
| :--- | :--- | :--- |
| 脚点 → 350 的矩形 | `auraForward` / `auraRadius` | **175 / 175**（矩形中心 ± 半长 ⇒ 覆盖 0~350，见 §15.11） |
| 矩形宽 140 | `auraRectHalfHeight` | **70**（半宽；`> 0` 即启用矩形判定） |
| 只有敌人进 350px 才放 | `auraTriggerRange` | **350**（2026-11-12 新增：超出则待触发、不消费 CD） |
| ~~直径 100 的圆~~ | ~~`auraRadius`~~ | ~~50~~ —— 2026-11-12 第八轮改矩形后作废 |
| 持续 3 秒、每秒一波 | `auraSeconds` / `auraInterval` | 3 / 1 ⇒ `waves = 3` |
| 范围内所有敌人 | `auraWaveMaxTargets` | 0（= 不限人数） |
| 跳起来、原地喷 | `auraFollow` | 0（站桩，缺省 1 = 跟本体跑） |
| 起点在角色头部 | `auraVisualLiftPx` | **97**（屏上 px；67 一个兵可见高 + 30 施法抬升） |
| 冷却 12 秒 | `auraCooldown` | 12 |

⚠️ `auraRadius` 是**半径**。设计案写「直径 100」，表里必须填 50 —— 填 100 会让判定圆
变成屏上直径 153.75px，比美术的火焰束宽出近一倍。
`auraForward` / `auraRadius` 都是**逻辑 px**，屏上要 × 0.76875（§1.11）。

### 15.2 `casterLiftPx`：抬美术根节点，时长寄生在地面区域上

「角色上移 30px、在空中循环播攻击动作」是纯表现，但它有**结束时刻**——火焰一停就该落地。
如果给单位加一个状态位，就得再写一套「什么时候清掉」的收尾逻辑；而这段滞空时长
**恰好等于 `auraSeconds`**。

所以把抬升量挂在 `ZCGroundZoneState.casterLiftPx` 上，与光环区域同生共死：

- `ZCGameRenderWorld.renderUnitSystem` 每帧从 `frame.snapshot.groundZones` **重建** `castLiftByUnit`
  （取最大值、不累加，多段光环叠加不会叠成 60px）；
- `renderUnitEntity` 每帧**显式**写 `presentation.castLiftPx`（`presentation` 是复用对象，
  不写就会带着上一帧/上一个单位的值）；
- 区域一到期，下一帧就查不到 ⇒ 自动落回地面，**零收尾逻辑**。

🔴 **抬的是叠加量，不是绝对值。** `ZCUnitView.visualRoot.y` 存的是「美术相对脚下原点」的摆位，
序列帧兵那个值是**负数**（`UNIT_VISUAL_OFFSET_FRAME`），骨骼兵是另一个值
（`UNIT_VISUAL_OFFSET_SPINE`）。直接写 `setPosition(0, 30)` 会让整只兵往上跳一截；
正确写法是 `visualBaseOffsetY + castLift`，且 `attachVisual` / `detachVisual` 时要重置
`appliedCastLift = Number.NaN`（下次 `render` 强制重写）。

滞空期间播攻击动作：`attacking || charging || castLift > 0 || casting` ⇒ `attackClip`
（`casting` 是 2026-11-12 新增的**施法动作窗口**，见 §18）。
单位坐标、索敌、受击判定全部不动 —— 「跳起来」只是视觉。

### 15.3 凤凰降临的三段伤害怎么落

设计原文三段：**命中直击 → 命中爆炸 → 爆炸开始后第 26 帧再炸一次**。
原来的落地口径写的是「新增 `summon_projectile` 车道 + II 级起残留火海依赖 1008 持续区域元件」，
2026-11-11 拍板**作废**：三段都实现，且不加持续火海。

| 段 | 实现 | 备注 |
| :--- | :--- | :--- |
| ① 直击 | 既有 `resolveProjectileHit` → `damageUnit` | `damageRate` 2.2 / 2.8 / 3.0 |
| ② 立即爆炸 | `resolveProjectileHit` 里**先**遍历 `context.unitsInRadius` 逐人结算 | `impactBurstRadius` 100、`impactBurstDamageRate` 1.5 / 2.0 / 2.5 |
| ③ 延迟爆炸 | 推一个 `groundZones` 波次：`nextWaveAt = now + delay`、`effectPrefabPath: null` | `impactBurstSecondRate` 1.5 / 1.8 / 2.0、`impactBurstSecondDelay` 0.8334 |

第二条要特别注意：**`ZCProjectileState.splashRadius` 不是这件事**。溅射不打主目标，
而且只在 `!empowered` 时读；「命中爆炸」要把**包括主目标在内**的所有人各打一次，
所以它走的是新加的 `burst*` 一组字段，与 `splash*` 完全平行。

第三段为什么不新开车道：`groundZones` 的「延迟波次」本来就是干这个的
（`nextWaveAt` 到了才结算、`wavesLeft: 1`），与五雷轰顶「第 5 帧判伤」（§14.1）是同一套机制。
`effectPrefabPath: null` 表示这一波**不推表现事件**——爆炸图已经由②那条 `area` 事件画了，
再推一次会闪两下。

⚠️ 命中事件的 `durationSeconds` 必须 ≥ 动画总长（`impactBurstEffectSeconds = 1.0667`），
否则 `ZCGameModel` 按 `startedAt + durationSeconds` 剔除事件，爆炸龙卷在尾帧前被摘掉。
不写这个键时退回 `.18`。

### 15.4 两道闸门：`projectileCount` 与 `projectileSpreadDeg`

102604 要「固定 4 颗、夹角 90°」，但同一张卡上 102601 的 `bulletNum` 是 +1 / +1 / +2：

- 🔴 **`projectileCount` 一旦显式声明（> 0），`patch.bulletNumFlat` 就不再叠加。**
  否则玩家点满 102601 后，凤凰弹会变成 4 + 2 = **6 颗**。
  这个闸门只在 `empowered`（强化那一击）路径上开，普攻的多弹逻辑不受影响 ——
  全表此前没有任何一条技能用过 `projectileCount`，所以是纯加法。
- 🔴 **`projectileSpreadDeg` 只覆盖强化那一击。** `bulletAngle` 是 **unit 域**修改器，
  同一张卡的普攻与强化击共用同一份槽；直接把它改成 90° 会把**普攻**也拉成 90° 扇形。
  102601 的张角走 `pvpSkillPlan 372601` 三行 `statId: 'bulletAngle'`：**2026-11-11 第四轮已从 20 收到 0**
  （20° 扇形 + 偶数弹 = 没有一发对准目标，普攻全脱靶，见 §15.7）。别为了「好看」再往上加。
- 🔴 **`projectileSpreadDeg` 有两种语义，靠 `359.999` 分界**（2026-11-11 第三轮）：

  | 取值 | 语义 | 每颗的角度 |
  | :--- | :--- | :--- |
  | `< 360` | **扇形**：整组摊在这段张角里 | `aim - 半张角 + spread × 全张角`，第 0 颗偏 `-一半`、最后一颗偏 `+一半` |
  | `≥ 360` | **全向均分**：向四周各打一发 | `aim + index × 360/count`，第 0 颗仍对准目标 |

  扇形那套**算不出十字**：`count = 4` 时 spread 是 −1 / −⅓ / +⅓ / +1，张角 360 会让首尾两颗
  同向朝背后（−180 与 +180 是一回事）⇒ 实际只剩 3 个方向。必须单独一条分支。
  凤凰降临原来配 90°（四发落在 −45 / −15 / +15 / +45），实测**四发全部脱靶**：
  ±15° 在 140px 处横向偏 37.5px，而目标身圈只有 27px ⇒ 一发不中、也不播受击。

### 15.5 三套特效与「第 26 帧 ⇒ 0.8334 秒」

| 特效 | 帧 | `sample` | `wrapMode` | 画布 | 缩放 | 对应判定 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `麻辣铁锅_喷射火焰` | 39 | 12 | 1（一次性 3.250s） | 222×168 | **1.278207** | 触发距离 350 反算缩放，**稳态**可见长度 210.5 画布 px ⇒ 屏上 269.06px；判定＝矩形 0~350×宽 140 |
| `麻辣铁锅_爆炸龙卷` | 32 | 30 | 1（一次性 1.067s） | 449×412 | 0.351831 | 半径 100 ⇒ 屏上直径 153.75 |
| `麻辣铁锅_凤凰弹` | 17 | 12 | 2（循环） | 派生副本（同 `396×126`） | 0.650000 | 弹体，无判定（= 旧基准 1.733333 × 1.5 × 0.25，绝对值锁死） |

**喷射火焰的 39 帧怎么来的**：设计案表现列写「需要延长时间时使用循环帧 11-17」。
落地做法是**把第 11~17 帧重复 3 遍直接拼进同一条 clip**：
源图 `146-1-attack_064~081` 共 18 帧 + `074~080` 再播 3 遍 = **39 帧** @12fps = 3.25 秒。
这样单条 clip 天然覆盖 3 秒，**不依赖 `wrapMode` 的循环标记**，
「第 N 帧」与时间轴仍然一一对应（循环播放时帧号会回绕，就没法用帧号对齐配表了）。
以后再要加时长，只需改拼帧遍数。

摆放（2026-11-12 第七轮定稿，🔴 距离反过来定长度，详见 §15.10）：

    **触发距离先定死 350 表值逻辑 px**（< 普攻 unitAttackRange 550，折后 495）
    尾部取**稳态尾部** = 各帧可见左缘的中位数（源 x=238），不是全序列并集左缘 68
    稳态可见长度 659 − 238 = 421 源 px ÷ 2 = 210.5 画布 px
    缩放 = 350 × 0.76875 ÷ 210.5 = **1.278207** ⇒ 视觉长度正好 350（屏上 269.06px）
    判定矩形：半长 auraRadius = 175、中心前移 auraForward = 175 ⇒ 覆盖 0~350、宽 140
    火焰尾部钉在施法者**逻辑脚点**：本地 (0, 0) ⇒ _lpos = (-0.320, -14.060)
    竖直抬到头部不写进 _lpos，走 auraVisualLiftPx = 97（视图在 mapToViewY 之后加）
    释放闸门：`auraTriggerRange = 350`，最近目标还在外面 ⇒ 待触发、不消费 CD

~~第四轮：缩放 1.040609 把可见长度拉到 400 逻辑 px、尾部钉在 (0, +45)~~ —— **已作废**。
第四轮按「铺满判定范围」反算缩放，只要可见并集的量法差一点，尾巴就离开角色一大截。
~~第五轮：并集左缘 68 当尾部 ⇒ 384 逻辑 px、`_lpos = (-109.2625, -58)`~~ —— **也已作废**（见 §15.9）。
~~第六轮：自然尺寸 1 + 稳态长度 ⇒ 274 逻辑 px、`_lpos = (-67.2, -11)`~~ —— **也已作废**（见 §15.10）。
`tools/build_maladi_guo_fx.py` 已同步（`reach_logic_px=350` + `pin_tail_y_zero` + `tail_policy='steady'`）。

朝向：`area` 事件由模型写 `angleDegrees`（`auraFaceTarget: 1`），宿主节点整体旋转，
各方向都跟着转，不再依赖美术摆正。

🔴 **`impactBurstSecondDelay` 必须取 0.8334，不是 0.8333。**
「第 N 帧」⇔ 时间窗 `[(N-1)/sample, N/sample)`，判据 `floor(t × sample) === N - 1`：

- 第 26 帧的窗 = `[25/30, 26/30)` = `[0.833333, 0.866667)`；
- `0.8333 × 30 = 24.999` ⇒ `floor` 到 **24** ⇒ 第 **25** 帧，早打一帧；
- `0.8334 × 30 = 25.002` ⇒ 第 26 帧，正确。

**爆炸龙卷为什么取 `sample 30` 而不是 12**：32 帧 @12fps 只有 2.67 秒，而且帧窗与配表秒数对不上；
取 30 之后「第 26 帧」= 0.8333 秒，与配表 `impactBurstSecondDelay` 落在**同一条时间轴**上 ——
和磁电菇劈雷取 `sample 30`（§14.5）是同一个理由。用例里直接钉死
`Math.floor(secondDelay * sample) === 25`。

**凤凰弹为什么是派生副本**：设计案表现列写「子弹使用火法师_火船(17帧) 放大 150%」。
`units/projectiles/火法师_火船/火法师_火船` 同时被 `pvpSkill 36181「火法师武将技」` 使用，
挂进 `ZCCombatEffectScale` 会把**别人的技能**一起放大。所以派生一份
`units/projectiles/麻辣铁锅_凤凰弹`：只写 prefab + meta，复用同一份 clip（`f73e3359`）
与散图 uuid，`_lscale` 落成 **0.65**（= 1.733333 × 1.5 × 0.25，第三轮的 25% 已烘进 prefab），
目录里**不放 png**。

📌 **2026-11-26 火船重烘（同一批图集治理）**：`火法师_火船` 的 17 帧从 402×364 裁到
**396×126**（alpha 并集只有 389×118，上下 240 行全是空）,根 `_lscale` 1.733333 → **1**
（贴图即屏上尺寸），`_lpos` 补 (−3.77, 3.19)。连带三处同源消费者：

| 消费者 | 改了什么 | 观感 |
| :--- | :--- | :--- |
| `火法师_火船.prefab`（36181） | 尺寸/缩放如上 | 船身 364×198 → **210×114** 屏上 px（旧链路是原生 210×114 被放大了 1.733 倍）；1.73 倍硬编码删除 |
| `麻辣铁锅_凤凰弹.prefab` | `_contentSize` 396×126，`_lscale` **0.65 不动** | **一个像素都不变**（绝对倍率，不跟基准走 ⇒ 生成器改用 `absolute_scale`） |
| `鹿神守护.prefab` 的 `fx_火船` | `_contentSize` 396×126、`_lpos` 92.2/150 → 88.6/153.6，`_lscale` **1.2 不动** | 不变（1.2 也是绝对倍率） |

🔴 火船**不许**登记进 `ZCCombatEffectScale`（会连带 36181）；凤凰弹保持派生副本也是这个原因。

### 15.6 配表落点

| 表 | 位置 | 内容 |
| :--- | :--- | :--- |
| `pvpSkill` | 30181 | `empoweredEvery: 8`、`empoweredSkillId: 36182`（原 10 / 36181） |
| `pvpSkill` | **36182（新增）** | `mode: projectile`、`projectileSpeed: 150`、`effectPrefabPath: 麻辣铁锅_凤凰弹`、`impactEffectPrefabPath: 麻辣铁锅_爆炸龙卷` |
| `pvpSkillPlan` | 372601 ×3 | `statId: 'bulletAngle'`、`add`、**`0`**（97026011~13，解锁 null/14/22；原 20，见 §15.7） |
| `pvpSkillPlan` | 102601 ×3 | 94026011~13：`attackSpeed` .14/.20/.26 + `damageRate` .08/.12/.16 |
| `pvpSkillPlan` | 102602 ×3 | 94026021~23：`lifestealRate` add .30/.40/.50 + `damageRate` .15/.20/.25 + `splashDamageRate` .20/.28/.36 + `splashRadius` 38/46/55 |
| `pvpSkillPlan` | 102603 ×3 | 94026031~33：`self_aura` + 光环参数（`auraForward` **175**、`auraRadius` **175**、`auraRectHalfHeight` **70**、`auraTriggerRange` **350**、`auraVisualLiftPx` **97**、`casterLiftPx: 30`、`auraFaceTarget: 1`）（解锁 9/18/24） |
| `pvpSkillPlan` | 102604 ×3 | 94026041~43：`skill_params` + 九个参数（解锁 0/20/25） |
| `armySkillLevelUp` | 102603/102604 ×6 | 补 `name` / `desc` / `modfiy`（94026031~33、94026041~43） |

🔴 **102602 的溅射字段名是 `splashDamageRate`**。设计案 P 列原来写的是
`explosionDamageRate` —— 引擎**不识别这个键**，配了等于没配（`ZCProjectileState` 上
叫「命中爆炸」的那组是 `burst*`，与「溅射」是两套东西）。设计案已于 2026-11-11 修正。

一键：
`node tools/config/patch_maladi_guo.js assets/remoteRef "<client json dir>"`（幂等 + 逐表 try/catch，
能吃掉 SVN 冲突态的 `pvpSkillPlan.json`）、`python tools/config/patch_maladi_spray_range.py`
（102603 的触发距离 / 抬升 / 两份描述，见 §15.8）、`python tools/config/patch_skill_design_maladi.py`
（回填设计案 127~131 行的 K/L/M/N/O/P/S）、`python tools/build_maladi_guo_fx.py`（两套特效 + 一份派生）。
守卫 `tests/zcds-maladi-guo.test.ts`（13 条）。

### 15.7 普攻「穿透目标不结算」的真因：偶数弹的扇形没有一发对准目标（2026-11-11 第四轮）

用户口径：「普通攻击穿透了目标没有造成伤害，接触目标没有播放法师受击效果」。

**真因是张角，不是命中圈。** `bulletNum` 在这张卡上是 **+1 / +1 / +2**（`skillChainId 282601`），
普攻基数 1 发 ⇒ 弹数 **2 / 2 / 3**。前两档是**偶数**，而扇形那套是

    halfSpan = bulletAngle / 2
    spread   = (index / (count - 1)) * 2 - 1        // count=2 ⇒ 只有 −1 和 +1
    heading  = aim + spread * halfSpan             // ⇒ −10° / +10°

⇒ **没有一发走 `aim`**。`bulletAngle = 20` 时两发分别偏 ±10°，射程 550 逻辑 px 处横向偏
`550 × tan10° = 97` 逻辑 px，而命中圈只有 **29** 逻辑 px（弹道 3 + 目标身圈 26）⇒ 两发从目标
两侧飞过去，既不结算伤害、也不触发受击特效。

真实模型实测（`tmp/diag_maladi_fan.ts`，`attackRange 550`，目标 68001 `bodyRadius 26`）：

| 英雄等级 | 弹数 | 各弹角度 | 受击特效 | 单次普攻伤害 |
| :--- | :--- | :--- | :--- | :--- |
| Lv1 ~ Lv20（`20°`） | 2 | −10 / +10 | 0 条 | **0**（两发全脱靶） |
| Lv25 / Lv30（`20°`） | 3 | −10 / 0 / +10 | 1 条 | 156（只有中间那发，应 468） |
| Lv1 ~ Lv20（`0°`，本版） | 2 | 0 / 0 | **2 条** | **312** |
| Lv25 / Lv30（`0°`，本版） | 3 | 0 / 0 / 0 | **3 条** | **468** |

修法：`97026011~13` 三行 `value` 20 → **0**（`halfSpan = 0` ⇒ 全部子弹走 `aim`，任何距离必中）。
一键 `python tools/config/patch_maladi_bullet_angle.py`（幂等，两份产物先跑 round-trip 自检）。

🔴 **不是「命中圈只有 3 逻辑 px」。** 那条推测（上一轮写的）实测**不成立**：ZC 运行时表清单
（`ZC_RUNTIME_TABLE_NAMES`）里**没有 `monsterCard`**，战斗单位一律来自 `pvpCard`；
塔防 NPC 的怪物卡 id（50028 等）在 `TerritoryCampaignConfig.projectCard` 里是**按名字**
映射到同名 `pvpCard`（50028 → 68026）的。运行目录里 `bodyRadius` 的实际分布是
**18 × 1 / 24 × 32 / 26 × 2，一个 0 都没有**。所以补 `PVP-怪物卡牌` 的 AA 列对战斗**零影响**
（已顺手补上 30 行 × 24，纯粹是配表整洁，别当成修好这条 bug 的原因）。

⚠️ 同款未修：`68010` 镭射飞龙（12°）、`68034` 魔术师（20°）也是偶数弹 × 扇形，同一症状
（12° 在 550 逻辑 px 处偏 `550 × tan6° = 58` > 命中圈 ⇒ Lv1/Lv2 同样全脱靶）。
本轮只按用户报的范围改了 68026，**这两张要改也是一行 `value`**。

### 15.8 第五轮：每颗凤凰弹朝自己的方向 + 触发距离由特效全长反推（2026-11-11）

用户两条口径：

> 「1. 释放【凤凰降临】技能子弹需要匹配正确的方向，2 号顺时针旋转 90 度、3 号顺时针旋转 180 度、
>   4 号顺时针旋转 270 度，1 号是正确的朝向」
> 「2. 喷火技能的位置还是不正确，如果是目标距离的问题，根据特效的最长像素作为触发技能的实际距离，
>   并把触发距离补充到技能描述中，特效的起始位置在角色的头部」

#### 15.8.1 每颗弹体的朝向必须由模型摊开，视图算不出来

**症状**：四颗弹体全部朝同一个方向画（截图里只有 1 号对）。

**真因**：视图（`ZCCombatEffectView` 的 projectile 分支）是拿 `to − from` 算转角的

    angle = Math.atan2(mapToViewY(toY − fromY), mapToViewX(toX − fromX))

而 `projectile` 事件里的 `to` 是**所有弹共用**的那个目标点 —— 四颗弹各自有独立的
`velocityX/Y`（`projectileSpreadDeg ≥ 360` 时是 `aim + i×360/n`），但转角读的是 `to`，
于是四颗全部朝 target 方向。

**修法**（`ZCAttackResolutionSystem` 推 `state.projectiles` 之前）：按各弹自己的 `heading`
把 `to` 沿该方向摊开，**长度保持 `length` 不变**：

    const bulletToX = fanned ? from.x + dirX * length : projectileEvent.toX;
    const bulletToY = fanned ? from.y + dirY * length : projectileEvent.toY;

- `fanned = length > 0 && (halfSpan > 0 || fullCircle)` ⇒ **单发弹道逐字不变**；
- 长度不变 ⇒ `aimFlightSeconds`（弧线进度）与「打空之后继续飞」的口径都不受影响；
- 视图不需要改，`ZCCombatEffectScale` / `FACING_BY_PREFAB_PATH` 都不需要登记 ——
  `火法师武将_火船_attack_01.png` 的焰头本来就是 **+X**，与 `atan2` 的 0° 同向。

**编号映射**（用户口中的 1~4 号 = 截图里右/下/左/上四个位置的火焰）：
散射顺序是 index 0 对准目标、之后 +90/+180/+270 ⇒ **1 = index0、4 = index1、3 = index2、2 = index3**。
用户要的「2 号 +90 / 3 号 +180 / 4 号 +270」正好等价于「每颗朝自己的飞行方向」。

**判据**：`tests/zcds-projectile.test.ts` 新增一条 —— 每颗弹道的 `to − from` 方向必须等于
它自己的速度方向（差角 < 1e-9），且散开只改方向不改长度。真实模型实测
（`tmp/diag_phoenix_dir.ts`，8 次普攻触发凤凰降临）：四颗差角全 **0.0°**、`to` 长度一致 242.3。

#### 15.8.2 喷射火焰：长度定距离，而不是距离定长度

**第四轮错在哪**：为了「可见长度铺满 350 + 50 = 400 逻辑 px」，反算缩放 1.040609。
于是量法（`alpha > 60` 的可见并集）只要差一点，尾巴就离开角色一大截；更要命的是
`_lpos` 是**宿主本地坐标**，宿主每帧 `setRotationFromEuler(朝向)`，写进 `_lpos.y` 的
竖直位移会变成「垂直于火焰的侧移」—— 只有正中朝右那一次看着是对的。

**第五轮口径**：特效取**自然尺寸**（`scale_policy = 'natural'` ⇒ 缩放恒 1），
长度反过来决定触发距离（⚠️ 下面这组数字是第五轮的，第六轮按**稳态尾部**重算、第七轮又改回
「距离定长度」，见 §15.9 / §15.10）：

    ~~可见并集 591 源 px ÷ DOWNSCALE 2 = 295.5 画布 px = 295.5 屏上 px（缩放 1）~~
    ~~⇒ 触发距离 = 295.5 ÷ 0.76875 = 384.4 ⇒ **384 逻辑 px**~~
    ~~⇒ auraForward = 384 − auraRadius 50 = **334**~~
    ~~⇒ prefab 根 `_lpos = (−109.262500, −58.000000)`~~
    ~~第六轮：稳态长度 421 源 px ÷ 2 = 210.5 屏上 px ⇒ 触发距离 274 ⇒ auraForward 224、
       _lpos = (−67.2, −11)、画布 222×168~~
    ~~第七轮：触发距离定死 350 ⇒ 缩放 1.278207、`auraForward` 300、`_lpos = (−96.413, −14.060)`~~
    ⇒ **第八轮（现行）**：判定改矩形 ⇒ `auraRadius` **175**（半长）、`auraForward` **175**、
       `auraRectHalfHeight` **70**、`_lpos = (−0.320, −14.060)`、画布 222×168、`auraTriggerRange` 350
    ⇒ 火焰尾部钉在施法者**逻辑脚点**：本地 (0, 0)

**竖直抬到头部只能走 `auraVisualLiftPx`**（视图在 `mapToViewY` **之后**加，屏幕上永远是竖直的，
不跟旋转）：

    auraVisualLiftPx = 97 = 67（一个兵可见高，`ZCCombatEffectPlacement` 既有口径）
                          + 30（`casterLiftPx` 施法抬升；抬升挂在地面区域上，与火焰同寿）

链路：`skillParamJson.auraVisualLiftPx` → `ZCAttackResolutionSystem.castSelfAura`
→ `groundZone.visualLiftPx` → `ZCGroundZoneSystem` 的 `area` 事件（`syncHoldVisual`
每帧跟着区域重写一次）→ `ZCCombatEffectView` 的
`setPosition(mapToViewX(toX), mapToViewY(toY) + (event.visualLiftPx ?? 0), 0)`。
缺省 0 ⇒ 任何既有光环逐字不变。

**描述同步**：`pvpSkillPlan.desc`（给人看）与 `armySkillLevelUp.desc`（卡片 UI 真读，
`CardSkillDescMarkup`）两份都要带触发距离 —— 只改一份，玩家看到的还是旧数字。

一键 `python tools/config/patch_maladi_spray_range.py`（四份文件先跑 round-trip 自检，
K 表的「每个标量独占一行 + 空数组压成 `[]`」排版必须逐字节还原）。
`patch_maladi_guo.js` 已同步同一组常量（`SPRAY_REACH / SPRAY_FORWARD / SPRAY_VISUAL_LIFT`），
重跑它与 Python 脚本的产物**逐字节一致**。

### 15.9 第六轮：锚点必须取**稳态尾部**，不是全序列并集（2026-11-12）

用户口径：「喷射火焰特效在下方的时候施法位置相对接近，但目标在右侧时，特效起始位置
离角色很远（相距 60px）」。

**真因不是触发距离没匹配，而是锚点选错了帧。** 逐帧量可见左缘（`alpha > 60`，源 px，
`tools/build_maladi_guo_fx.py` 里的 `content_box` 口径）：

| 帧 | 可见左缘（源 px） |
| :--- | :--- |
| 1~2（`064` / `065`） | 68 ~ 69 |
| 3 起（`066` 之后，共 39 帧里的 37 帧） | **230 ~ 247**（中位 238） |

第五轮按「全序列可见并集的左缘 = 68」钉尾部 ⇒ 锚在那团**只出现 2 帧（5% 时长）的起势火苗**上；
而 95% 的时间里火焰实体从 238 才起。两者相差 170 源 px ÷ 2 = **85 屏上 px** —— 屏幕上的
表现就是「火焰离开角色一大截」，朝右时因为你盯着看所以最刺眼。

**改法**：构建器新增 `tail_policy='steady'`：

    tail_x = median(各帧 content_box 左缘)                      # 238
    anchor_src = (tail_x, tail_centroid_y(sources, boxes, tail_x))  # 尾部窗内 alpha 加权重心 y
    crop_left = tail_x − CROP_MARGIN (12)                       # 226 ⇒ 画布宽 (670 − 226) ÷ 2 = 222
    measured_src = right − tail_x                                # 421 源 px ⇒ 210.5 屏上 px

三个连带结果（⚠️ 第三项已被第七轮改成 350，见 §15.10）：

- 画布 **307×168 → 222×168**：那 170 源 px 的透明空档不再打进图集（这一项保留）；
- ~~触发距离 384 → 274 逻辑 px、`auraForward` 334 → 224~~（第七轮：**350 / 300**）；
- ~~`_lpos` (−109.2625, −58) → (−67.2, −11)~~（第七轮：**(−96.413, −14.060)**）；
  尾部仍然钉本地 (0, 0)、竖直抬升仍只走 `auraVisualLiftPx = 97`
  （🔴 写进 `_lpos.y` 会被宿主旋转成侧移）。

`_lpos.y` 的来历：尾部窗 alpha 重心在画布 y=73（自上而下），锚点 0.5 ⇒ 相对中心是本地
**+11 画布 px**，所以根节点要下移 `11 × 缩放` 把它按回 0（第六轮缩放 1 ⇒ −11；第七轮
缩放 1.278207 ⇒ −14.060）。守卫 `tests/zcds-maladi-guo.test.ts` 第 8 条（现 13 条全绿）会同时断言
「尾部本地 x = 0」「尾部本地 y = 0」「尖端压在 350×0.76875」。

**判据：以后给任何序列帧特效钉尾部，先打印逐帧左缘再决定取哪个分位数。**
「并集」天然被最边缘的一两帧极值绑架，对 39 帧里出现过 2 帧的火苗毫无代表性。

同步落点：两份 `pvpSkillPlan` + 两份 `armySkillLevelUp`（`patch_maladi_spray_range.py`
+ 回灌 `patch_maladi_guo.js`）、`J-技能表.xlsx`（`patch_magdi_skill_rows_excel.py 102603`）、
`K-卡牌升级.xlsx` B/C（`patch_skill_k_desc_excel.py 102603 102604`）、技能设计案
130 行 K/L/M/O/P（`patch_skill_design_maladi.py`）。

### 15.10 第七轮：触发距离小于普攻、按 350px 反算特效长度（2026-11-12）

用户口径：「68026 的喷火技能的释放触发距离应该小于普通攻击的距离，和特效的 350px 范围相匹配，
只有敌人处于 350px 这个距离才会被攻击」。

**第六轮留下的病根**：触发距离按「稳态可见长度」反推成 274，但释放闸门仍是**普攻射程** ——
`pvpCard 68026.unitAttackRange = 550`（`attackReach` 对 >100 打九折 ⇒ 495 表值 = 148.5 世界 px）。
于是敌人在 280~495 之间时技能**会放**，而火焰只够 274 ⇒ 白喷一管 12 秒 CD。

**改法：距离定死、特效去匹配，再加第三道闸门。**

| 量 | 第六轮 | 第七轮 | 依据 |
| :--- | :--- | :--- | :--- |
| 触发距离 | 274（长度反推） | **350**（用户定） | 350 < 495（普攻折后） |
| 特效缩放 | 1.0 | **1.278207** = 350×0.76875 ÷ 210.5 | 视觉长度正好 350 |
| `auraForward` | 224 | **300** = 350 − 半径 50 | 判定圆 250~350 |
| `auraTriggerRange` | — | **350** | 闸门：最近目标在外 ⇒ 待触发 |
| `_lpos` | (−67.2, −11) | **(−96.413, −14.060)** | 尾部仍钉本地 (0,0) |
| 画布 | 222×168 | 222×168（不变） | 裁切口径没动 |

**为什么这次允许拉伸**：第四轮的教训是「按并集最左缘做量法 ⇒ 误差被放大成 85px 空档」。
现在锚点是**稳态尾部**（26/39 帧的共同左缘），被拉伸的就是那团 95% 时长都在的火焰实体，
量法误差只剩几 px，不会重新引入「尾巴离角色」。

**第三道闸门（新增代码，不是改配表就行）**：

- `ZCUnitTargeting.nearestEnemyDistance(unit)` —— 最近的敌对单位中心距（世界 px），
  过滤死人 / 打不到的空中单位，**不补身体半径、不打九折**（用户量的是「敌人处于多少 px」）；
- `IZCSkillTriggerContext.nearestEnemyDistance?` —— 缺省不压，既有单位逐字不变；
- 历史实现：`ZCSkillTriggerSystem.applySelfAura` 在 `release`（当时的普攻射程闸门）之后加。2026-11-18 起改用 §13 的独立技能选敌，后续的施放条件保留：
  `最近距离 > auraTriggerRange × distanceScale ⇒ 返回 false`，**不消费 CD**，
  目标走进来的那一帧立刻补放（与既有的「待触发」同一套语义，不新增状态机）；
- 组合根接线：`ZCGameModel.buildSkillTriggerContext`。

守卫：`tests/zcds-skill-trigger-range.test.ts` 新增 3 条
（闸门待触发不消费 CD / 不配该参数时不生效 / `nearestEnemyDistance` 的过滤与单位），
`tests/zcds-maladi-guo.test.ts` 第 8 条几何守卫改按 350/1.278207/(−96.413, −14.060) 断言，
并新增一条「触发距离必须小于普攻折后射程」。

⚠️ **已知取舍（已被第八轮解决）**：判定圆是 `auraForward 300 ± 半径 50` = 250~350，所以
贴脸（<250）的敌人不会被喷火打到。第八轮按用户口径改成矩形，见 §15.11。

同步落点：两份 `pvpSkillPlan` + 两份 `armySkillLevelUp`（`patch_maladi_spray_range.py`
+ 回灌 `patch_maladi_guo.js`，两者产物逐字节一致）、`J-技能表.xlsx`
（`patch_magdi_skill_rows_excel.py 102603`，upsert 3 行）、`K-卡牌升级.xlsx` B/C
（`patch_skill_k_desc_excel.py 102603 102604`）、技能设计案 130 行 K/L/M/O/P
（`patch_skill_design_maladi.py`）、特效 prefab（`build_maladi_guo_fx.py` 的 `reach_logic_px`）。

### 15.11 第八轮：判定改矩形，覆盖「脚点 → 350」（2026-11-12）

用户口径：「改矩形：加 `auraRectHalfHeight`（半长跟随 `auraRadius`），像磁电冲击 101604 那样
做成从脚点到 350 的锥/矩形」。

**为什么改**：第七轮的圆是 `auraForward 300 ± 半径 50` = **250~350**。敌人贴脸（<250）时技能
会放（闸门只看"最近敌人在 350 内"）却打不到，白烧一管 12 秒 CD，而且视觉上火焰明明穿过了敌人。

**怎么改**：复用 101604 那条矩形车道，一个参数都不用加代码 ——
`zcGroundZoneReaches` 判 `|dx| <= 半长 && |dy| <= 半宽`，半长**缺省跟随 `radius`**：

| 参数 | 值（表值逻辑 px） | 说明 |
| :--- | :--- | :--- |
| `auraRadius` | **175** | 在这里是**半长**（缺省跟随半径） |
| `auraForward` | **175** | 矩形中心前移 ⇒ 沿朝向覆盖 `175 ± 175` = **0~350** |
| `auraRectHalfHeight` | **70** | 半宽 ⇒ 宽 **140**；`> 0` 就是矩形判定的开关 |
| `auraTriggerRange` | **350** | 闸门不变：最近目标在 350 外 ⇒ 待触发 |

半宽 70 的来历：逐帧量火焰的垂直跨度（`alpha > 60`，源 px）中位 **195.5**，扣掉火柱约 26° 的
倾斜后垂直于朝向的厚度约 **175 源 px** ⇒ 屏上 ≈112px ⇒ 表值 ≈**145** ⇒ 取一半 72.5 再收一点
= **70**（宽 140）。判定略窄于视觉，宁可少打一点也不打空气。

**特效跟着挪了宿主**：`auraForward` 从 300 变 175，而 `build_maladi_guo_fx.py` 的 `_lpos` 是
「宿主摆在判定中心」算的 ⇒ 重跑后 `_lpos` 从 `(−96.413, −14.060)` 变成 **`(−0.320, −14.060)`**
（火焰尾巴仍然精确落在施法者脚点、尖端仍然压在 350）。**缩放 1.278207、画布 222×168、
`auraVisualLiftPx 97` 全部不变** —— 只动了判定形状，没动美术。

**两处结算都自动跟着变**：`resolveWave` 与 `resolveExpiry` 都调同一个 `zcGroundZoneReaches`，
101604 那一轮已经收口，所以这里只是"配表开了个开关"。粗筛 `zcGroundZoneBroadRadius` 取
外接圆 `hypot(52.5, 21) ≈ 56.55` 世界 px > 半长 52.5，不会漏人。

守卫 `tests/zcds-maladi-guo.test.ts`（现 **14 条**全绿）：新增第 14 条直接对 `zcGroundZoneReaches`
断言「脚点 true / 右边缘 350 true / 350.01 false / 横向 ±21 世界 true、多 0.01 false /
粗筛 > 半长 / 旋转到 −90° 后同样成立」；第 8 条几何守卫补了「左边缘 = 0、右边缘 = 350」两条。

同步落点：两份 `pvpSkillPlan` + 两份 `armySkillLevelUp`（`patch_maladi_spray_range.py` +
回灌 `patch_maladi_guo.js`，对拍 0 差异）、`J-技能表.xlsx`（`patch_magdi_skill_rows_excel.py 102603`）、
`K-卡牌升级.xlsx` B/C（`patch_skill_k_desc_excel.py`）、技能设计案 130 行 K/L/M/O/P
（`patch_skill_design_maladi.py`）、特效 prefab（`build_maladi_guo_fx.py`，`AURA_RADIUS_LOGIC 175`）。

描述文案随之变成：**「每秒对身前 0~350px 的矩形（宽 140）内所有敌人造成 X% 攻击力伤害
（触发距离 350px：敌人进入 350px 内才会释放，与火焰特效等长）」**。

### 15.12 第十三轮：喷射火焰换新美术 `ph_00~ph_13`，循环帧 `ph_03~ph_09`（2026-11-13）

用户口径原话：

> 「【麻辣铁锅】的喷火技能使用新的特效图片 ph_00~ph_13，循环帧改为 ph_03~ph_09，
> 替换成功后删除旧的资源，新的特效已经调整了喷火的角度是平行线，这个角度容易适配瞄准目标的角度」。

**新美术为什么好适配**：旧图是逐帧 `146-1-attack_064~081`（845×615，柱体实测主轴 **+18.76°**，
朝右下），宿主按 `angleDegrees` 一旋转，"右下斜的柱子"就跟着歪，命中感总是差一点。新图
`ph_00~ph_13`（519×437）画师把柱体拉平了：PCA 主轴 **−18.16°**、白热核心 **−14.46°**，
视觉上是**左尾右尖的水平柱**（尾部在左）⇒ 只要"本地 +x = 朝向"，转到任何 `angleDegrees`
都正对目标。方向系数因此一行没改，**只重算了"多长等于 350"**。

**帧序为什么是 38 帧**：`cc.AnimationClip` 一个 clip 只有一个 `wrapMode`，做不出"先播一次再无限
循环"（`ZCCombatEffectView.mountVisual` 只 `play(defaultClip)`，没有接龙能力）⇒ 帧序拼长代替串播：

```
ph_00 … ph_09        ← 起手 10 帧，走一遍
ph_03 … ph_09  × 4   ← 循环段（`sample 12`）连铺 4 圈
= 10 + 7×4 = 38 帧 @12fps = 3.167s（区域持续时间 3 秒，多出的一帧是尾帧不跳变）
```

🔴 **收火帧绝不能进循环段**：`ph_10~ph_13` 是收火（可见宽 **278 → 197 → 169 → 40**），
塞进"循环段"里火焰每圈都会缩成小火苗再"嘭"地涨回来 —— 一次喷火闪三下。收火本身是
区域到期时 `holdVisual` 事件整体摘掉、节点直接销毁完成的，不需要美术演一遍。

**几何反算**（`tools/build_maladi_guo_fx.py`，`SETS[0]`）：

| 量 | 旧 | 新 |
| :--- | :--- | :--- |
| 源图 | 845×615 | 519×437 |
| 裁切后 / 画布 | 388×372 → **222×168** | 388×372 → **194×186** |
| 稳态尾部（各帧可见左缘**中位数**） | 50 源 px | **50 源 px**（并集 45，占比 21/38 帧） |
| 尖端 | — | **415 源 px** ⇒ 可见长度 365 源 px = **182.5 画布 px** |
| 烘焙缩放 | 1.278207 | **1.474315**（`350 × 0.76875 ÷ 182.5`） |
| 根节点 `_lpos` | (−0.320, −14.060) | **(−0.368579, +29.486301)** |

`_lpos.y` 还是 0 附近的那个坑：宿主每帧按 `angleDegrees` 旋转，**本地 +y 会变成"垂直于火焰的
侧移"**，所以纵向只能靠 `auraVisualLiftPx 97` 在视图层补（抬到头部）；根节点这一层把"尾部"钉在
本地 `y = 0`（画布中心在尾部下方 20 画布 px ⇒ `+20 × 1.474315`）。判定一个数没动：
`auraRadius 175` / `auraForward 175` / `auraRectHalfHeight 70` / `auraTriggerRange 350`。

**旧资源删除**：`atlas/` 里旧 18 张 `146-1-attack_064~081` 的 png + meta（**36 个文件**）已删；
原始 845×615 大图还在 `tmp/projectile_src/麻辣铁锅_喷射火焰/`（想回滚直接重跑生成器）。
生成器加了 `keep_all=False` —— 没进帧序的**源**散图（`ph_10~ph_13`）会一起搬去
`tmp/projectile_src/<set>/`，不会留在 bundle 里。

**守卫**：`tests/zcds-maladi-guo.test.ts` 现 **14 条**全绿，常量换新
（`SPRAY_TAIL_SRC_PX 50` / `SPRAY_TIP_SRC_PX 415` / `SPRAY_VISIBLE_SPAN_PX 182.5`），
核心断言：`frames.length === 38`、`sample 12`、`wrapMode 1`、`_duration ≈ 3.1667`、
`frames[3] === frames[10] === frames[17] === 'ph_03.png'`、`canvas 194×186`、`scale 1.474315`、
`_lpos.y ≈ +20 × scale`。

同步落点：`build_maladi_guo_fx.py`（帧序 + `keep_all=False` + 新锚点常量）、
`anim/麻辣铁锅_喷射火焰.anim`、`麻辣铁锅_喷射火焰.prefab`、技能设计案 130 行的 O 列
（`patch_skill_design_maladi_ph.py`）。**判定、配表、描述文案一律不动。**

## 16. 魔术师 68034「鹿神守护」：从「地面区域冲刺」改成「会追踪的子弹」（2026-11-12）

用户口径原话：

> 「68034 魔术师的召唤物 小鹿 应该是类似子弹一样的效果，只是一个会追踪目标的子弹，
> 从角色朝向的 15px 处生成，移动时小鹿播放 walk 动画，前半段移速慢（70px），
> 贴近目标后的移速快（140PX，同步在小鹿身上覆盖火船特效），当原目标死亡后，小鹿会转向新目标，
> 接触到任意目标后造成伤害，子弹消失」

### 16.1 为什么不换成 `projectiles` 真弹道

小鹿现在走的是「**会移动的地面区域**」（`pvpSkillPlan 103405` → `ZCGroundZoneSystem`），
看起来像绕远路，但三件它需要的事真弹道都没有：

| 需要的东西 | 区域已有 | 真弹道（`ZCProjectileState`） |
| :--- | :--- | :--- |
| 一条跟着走的**复合视觉**（小鹿 spine + 火船） | `holdVisual` + `syncHoldVisual`（每帧搬事件坐标） | 每条弹道一个 sprite，没有「整段持有」概念 |
| **两档速度 + 阶段动画** | `visualAnimation` 推给 `applySpineAnimation` | 没有阶段字段 |
| 原目标**阵亡后改追** | 有 `context.unitsInRadius` 做就近搜索 | 弹道只有 `targetId`，目标死了就直线飞 |

换成真弹道等于把这三件事全部重写一遍，还会踩「弹道命中与区域命中两套结算口径」的分裂。
所以本轮只在区域系统内部换语义：**位置推进由 `advanceChase` 全权接管，主循环只负责计时与结算**。

### 16.2 三张口径表

配表（`pvpSkillPlan` 94034051~53，表值逻辑 px / px·s⁻¹，运行时 × `combatDistanceScale=0.3`）：

| 参数 | 值 | 说明 |
| :--- | :--- | :--- |
| `zoneSpawnForward` | **15**（原 30） | 沿施法者 `facingRadians` 前移；不落在目标处 |
| `zoneApproachSpeed` | 70 | 慢档 |
| `zoneMoveSpeed` | 140 | 快档（代码里叫 `sprintSpeed`） |
| `zoneSprintRange` | 200 | 与目标距离 ≤ 它 ⇒ 切快档 |
| `zoneMaxHits` | **1**（原 5） | 接触任意目标即消失 |
| `zoneDamageFalloff` | **删除**（原 0.5） | 只打一个目标，没有第二个可递减 |
| `zoneDuration` | 2 | 快档最长存活（兜底） |
| `zoneWaveInterval` | 0.15 | 快档探接触的节拍 |
| `zoneHoldVisual` | 1 | 整段持有一条跟随视觉 |

行为（`ZCGroundZoneSystem.advanceChase`，返回 `true` = 位移已由它推进）：

| 档位 | 触发 | 速度 | 动画 | 火船 | 读秒 / 结算 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 慢档 | 出生 | 70 | `move` | 灭 | **不读秒、不结算** |
| 快档 | 距目标 ≤ 200 | 140 | `attack` | **亮** | 每 0.15s 一波 |

**两档都每帧重算方向**：目标会走位，锁死出生朝向就是「小鹿飞到空地上」。

### 16.3 🔴 三个坑

**① `chased` 标记不能省。** 旧代码是「非接近段 ⇒ `remainingSeconds -= dt` **并且**按 `moveVelocity` 位移」。
现在位移归 `advanceChase` 管，快档时它也返回 `true`，如果主循环还照旧推一遍就是**双倍速度**。
所以 `tick` 里写成「`chased` 为假时才按 `moveVelocity` 推」：

```ts
const chased = this.advanceChase(zone, dt, now, context);
if (!chased && (zone.moveVelocityX || zone.moveVelocityY)) { /* 位移 */ }
const approaching = this.isApproaching(zone);        // approachSpeed > 0 && !sprinting
if (!approaching) zone.remainingSeconds -= dt;       // ← 读秒与位移彻底解耦
```

**② 换目标只在「目标不可追」时发生，不是每帧都选。** 每帧重选会带来「两个目标距离交替变小 ⇒
小鹿在两颗之间来回摆」。判据是 `isChaseable(unit)`（活着 + 未 dead），只在它变假时才查
`nearestChaseTarget`（`hexIdAt` + `unitsInRadius`，搜索半径 `max(sprintRange, 600)`）。

**③ 一个活敌人都没有时不能停在慢档。** 慢档不读秒 ⇒ 区域永远不会到期 ⇒ 小鹿永远飘在场上。
所以「追不到」的分支**强制进快档**、沿当前速度方向（没有速度就朝 +x）飞，让 2 秒兜底把它收掉。

### 16.4 火船只在快档：`overlayFx` 派生自 `sprinting`

需求「同步在小鹿身上覆盖火船特效」的落法是两段式，**模型不碰节点名**：

1. `ZCGroundZoneState` **不加字段** —— `syncHoldVisual` 直接把 `zone.sprinting === true` 写成
   `event.overlayFx`（派生值，不可能与档位脱拍）；
2. 视图查表 `zcCombatEffectOverlayChild(路径)`（`ZCCombatEffectPlacement`）拿到子节点名
   `fx_火船`，只在**翻转时**写 `child.active`（每帧写会反复重启粒子和 Animation）。

没登记叠层的特效一次都不碰 `active`（`overlayChildName === null` 直接 return），所以暴风 /
灼热地带那些完全不受影响。prefab 侧 `fx_火船` 的 `_active` 改成 **false**（`build_deer_guard_fx.py`
同步），保证「慢档第一帧」也不带火。

### 16.5 「walk 动画」实际落到 `move`

`魔术师召唤鹿/lu.skel` 只有三段动画：`idle` / `move` / `attack`（Spine 3.8 二进制里三个
长度前缀串可读）。美术那一段「走」就叫 `move`，**没有 `walk`**。所以
`ZONE_APPROACH_ANIMATION = 'move'` 就是需求里的走路，不要为它改名 —— 改名会让
`setAnimation` 找不到段，小鹿会定格在第一帧且不报错。

### 16.6 配表与产物落点

- 两份 JSON（`assets/remoteRef` / `doc/塔防数据配置/json/client`）的 `pvpSkillPlan` +
  `armySkillLevelUp`：`tools/config/patch_deer_tracking_bolt.js`（幂等，带三档偏差 + 两份一致自查）；
- 源表 `J-技能表.xlsx / PVP技能配置`：`patch_magdi_skill_rows_excel.py 103405`（upsert 3 行）；
- 源表 `K-卡牌升级.xlsx / 卡牌技能升级表` B/C：`patch_skill_k_desc_excel.py 103405`；
- 技能设计案第 **171** 行：`patch_skill_design_deer_tracking.py`
  （顺带修掉 G 列链号笔误 103404 → **103405**，K/L/M/N/O/P 从空补全，S 待规划 → 已实现）；
- prefab：`tools/build_deer_guard_fx.py`（`fx_火船` `_active=False`）。

新描述：**「累计8次普攻召唤小鹿：从身前15px生成并追踪最近的敌人，前段70px/s行走、
贴近后140px/s加速并燃起火焰，接触敌人造成 600/700/800 点伤害后消失；目标阵亡会自动转向最近的敌人」**

### 16.7 守卫（`tests/zcds-magician-skills.test.ts`，现 26 条）

| 条 | 钉什么 |
| :--- | :--- |
| 三档参数接线 / 参数真值 | 15 / 70 / 200 / 140、`maxHits 1`、`damageFalloff` 已消失 |
| 慢档按 70px/s 追、不结算 | 位置在涨、时长不动、`visualAnimation='move'`、`overlayFx=undefined` |
| 提速并换动画 / 点亮火船 | 进 60 世界 px 切档、`attack`、`overlayFx=true` |
| 原目标阵亡后改追最近敌人 | 换 `approachTargetId`、纵向拐弯、旧方向停推、逐拍逼近 |
| 接触即消失 | 只结算 1 次、区域与视觉同拍摘掉、之后不再复活 |
| 没敌人时兜底 | 强制进快档、朝原方向、2 秒散场 |
| 叠层登记 | `fx_火船` / 未登记 = `null` / 名字真在 prefab 根节点下 / `_active=false` |

## 17. 科学家 68035「精密陷阱」103504：布置物车道 `trap_place`（2026-11-12）

设计案第 175 行原话：「在原地坐标留下一个持续时间为 15/18/23 秒的陷阱，目标触碰到该陷阱会收到
1 次伤害 200%/250%/300%，陷阱会爆炸范围 100px 圆形，造成 1 次额外的伤害，爆炸范围内所有敌人受到
均等伤害 180%/220%/280%，陷阱达到指定的秒数后也会主动爆炸」。

表里这三行此前是**占位**「轨道打击」（`{"damageRate":2.0/2.8/4.0}` + `statusId=stun_*`），本轮换成真技能，
并新增第 ⑩ 条行为车道（`ZCSkillTriggerSystem.applyTrap` → `ZCAttackResolutionSystem.castTrap` →
`ZCGroundZoneSystem.resolveContact / pushExpireVisual / resolveExpiry`）。

### 17.1 为什么另起一条车道

| 候选 | 为什么不合适 |
| :--- | :--- |
| `self_aura` | 那片区域挂在**自己身上**、按波次打人、还跟着人走；陷阱是**留在原地**、没有波次、只在两个时刻结算 |
| `bolt_strike` | 那个锁目标落雷（伤害与目标位置绑定）；陷阱的落点与目标无关 |
| `random_strike` | 那个「立刻打出去」；陷阱是「先欠着，等人来踩」 |
| 直接塞进 `projectiles` | 那颗弹会飞、会撞；陷阱要停着等人，且要活 15~23 秒 |

车道触发**只看** `trapCooldown`：缺这个键 ⇒ 整段静默返回（**不**打日志，除非该卡真的配了别的 `trap*` 键）。
🔴 它**不看** `inAttackRange`（普攻射程闸门）—— 陷阱落在脚下，等目标进射程才落，
会永远落在追兵身后、一辈子踩不到。

### 17.2 三段口径

| 时刻 | 判定 | 伤害 | 表现 |
| :--- | :--- | :--- | :--- |
| 施法（CD 10s 到点） | 落点 = 脚下（`trapForward` 缺省 0） | — | `科学家_陷阱_出现` 一次性 0.4s |
| 被踩（每帧探 `contactRadius`） | 半径内**第一个**敌方单位 | `contactDamage` = 面板 × 200/250/300% | 立刻转下一行（陷阱消失） |
| 引爆（踩中 / 到点，同一条通道） | `radius` 内**全部**敌人 | `expireDamage` = 面板 × 180/220/280%，**均等无递减** | `科学家_陷阱爆炸` 一次性 0.6s |

- 触碰半径 50、爆炸半径 100（**表值 px**，代码 × `combatDistanceScale` 0.3 落世界坐标）：
  屏上 76.9px / 153.75px —— 判定圈与美术同源（见 17.4），不存在「看着炸到了其实没打到」；
- 🔴 **踩中 = 两笔**：触碰那一下 + 立刻引爆。设计案原文的「1 次伤害」与「1 次额外伤害」就是这两笔，
  不是二选一；实现上就是 `resolveContact` 返回 true 后把 `remainingSeconds` 清零，交给既有的到期通道；
- 暴击 / 克制按**放下那一刻**的当前目标算一次，两笔共用同一个乘数（陷阱是「灌注好能量的布置物」，
  不是「每次有人踩就重新掷一次骰」）；
- 常驻光环的 `visualDelaySeconds = 0.4s`：`start` 与 `idle` 是两段独立美术，同帧出场会**双影**。
  延迟靠 `startedAt` 推到未来 + `durationSeconds` 同步加上这段（视图侧由 §14.9 的闸门挡住），
  不需要任何「播完切下一段」的接龙代码。

### 17.3 🔴 两个坑

1. **`behaviorKey` 必须是 `trap_place`，而且必须三处齐**：
   `ZCStatSchema.SKILL_BEHAVIORS` 白名单（漏了读表直接抛「未注册 behaviorKey」）+
   `ZCSkillRuntime.register('trap_place')`（漏了参数进不了运行时）+
   `ZCVisualResourcePlan` 按它筛出三个预制体（漏了**不报错**，技能照常结算、屏幕上一个像素都没有）。
   注意这行**不是**该卡的 `unitId:pvpSkillId` 首行（首行是穿甲苔刺的 `skill_params`），
   所以运行时里的 `behaviorKey` 仍是 `skill_params` —— 陷阱车道靠 `trapCooldown` 认领，不靠它。
2. **触碰只打第一个**：同一帧两个人一起踩进来，也只由先到的那个引爆。全打一遍等于白送一份额外伤害，
   与设计案「收到 1 次伤害」不符。

### 17.4 三个预制体（`tools/build_scientist_trap_fx.py`）

| 预制体 | 帧 | sample | wrapMode | 时长 | 烘焙缩放 / 画布 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `科学家_陷阱/科学家_陷阱_出现` | `start00~11` 12 | 30 | 1（一次性） | 0.4s | 0.471626 / 167×61 |
| `科学家_陷阱/科学家_陷阱` | `idle00~11` 12 | 12 | 2（循环） | 1.0s 一圈 | 0.471626 / 167×61 |
| `科学家_陷阱爆炸/科学家_陷阱爆炸` | 18 | 30 | 1（一次性） | 0.6s | 0.613772 / 262×234 |

- `start` 与 `idle` **共用同一个裁切框**、反算缩放的分母只看 idle 帧（`alpha > 60` 的可见宽 76.9px）；
- 爆炸的 153.8px 正好等于「爆炸半径 100 × 2 × 0.76875」——**判定与美术同一个数**反推出来的；
- 🔴 **必须三个 prefab**：`cc.AnimationClip` 的 `wrapMode` 管**整段**，做不出「先播一次再无限循环」；
  `ZCCombatEffectView` 也只在 `mountVisual` 时播默认 clip，不会自己接龙；
- 生成段的 `durationSeconds` 必须 ≥ 动画总长（0.4s），爆炸段同理（0.6s ≈ `ZC_TRAP_EXPIRE_SECONDS`）。

### 17.5 配表与产物落点

- 两份 JSON（`assets/remoteRef` / `doc/塔防数据配置/json/client`）的 `pvpSkillPlan` + `armySkillLevelUp`：
  `tools/config/patch_scientist_trap.js`（幂等；自查「三档参数齐 / 无旧键 / 两份逐格一致 / `statusId` 已清空」）；
- 源表 `J-技能表.xlsx / PVP技能配置`：`patch_magdi_skill_rows_excel.py 103504`（upsert 3 行）；
- 源表 `K-卡牌升级.xlsx / 卡牌技能升级表` B/C：`patch_skill_k_desc_excel.py 103504`；
- 技能设计案第 **175** 行：`patch_skill_design_scientist_trap.py`
  （顺带修掉 G 列链号笔误 103503 → **103504**；K/L/M/N/O/P 从空补全，S 待规划 → 已实现）；
- `modifierId` 94035041 / 42 / 43；`unlockHeroLevel` 1 / 20 / 25；`triggerEvent=active`、`skillKind=active_cd`；
- `trapCooldown = 10` 抄的是设计案 **J 列**（不是惯例的 12）—— 这一格是数字格，读表时别只看文字格。

新描述（卡片与技能案同一句）：

> 冷却 10 秒：在脚下留下一个持续 15/18/23 秒的陷阱，敌人踩中立刻受到 200%/250%/300% 攻击力伤害并引爆；
> 爆炸半径 100px，范围内所有敌人均等受到 180%/220%/280% 攻击力伤害（不递减）；无人踩中则到时自动引爆

### 17.6 守卫（`tests/zcds-scientist-trap.test.ts`，13 条）

| 条 | 钉什么 |
| :--- | :--- |
| 三档参数真值 | 15/18/23、200/250/300、180/220/280、CD 10、两半径 50/100、`trapForward 0` |
| 旧占位清干净 | `skillName` 精密陷阱、`statusId` 必须为 null（不能白送 stun） |
| 两份产物一致 | 7 个字段逐格对拍 |
| 卡面同步 | `armySkillLevelUp.name/desc` 与 `pvpSkillPlan.desc` 逐字相同 |
| 双登记 + 资源计划 | 白名单 / 注册表 / 三条路径都进 `effectPaths`；未登记的卡一条都不多收 |
| 预制体落盘 | 12/12/18 帧、wrapMode 2/1/1、sample 12/30/30、时长常量同源 |
| 放置 | 落点在脚下（目标在 900 远处也不偏）、两段伤害 60/54、`wavesLeft 0`、生成事件 0.4s |
| 参数不全 | 缺任一参数 ⇒ `false`，一个区域都不建 |
| 触碰 | 只打第一个、随后当场引爆、爆炸内的人吃 54、半径外 0 |
| 到点自爆 | 没人踩也炸、范围内**每人都是满额 54** |
| 延迟出场 | `startedAt = now + 0.4`、`durationSeconds = 0.4 + 剩余` |
| 冷却 | 开局不立刻放、到点才放（射程闸门恒 false 照放）、被拒不推进 CD |

## 18. 施法动作窗口与 buff 类原地锁（2026-11-13）

> 用户口径：「角色使用技能的表现调整，当角色在移动中，释放任意的主动技能都需要角色要播放攻击动作
> （当前已经是攻击动作就无需打断），释放 buff 类技能（回血，加伤害）时要打断 walk，停止在原地
> （不影响攻击），匹配对应的特效或数字加成的动画播放时间结束才继续」。

### 18.1 拆成两个字段，两件事互不耦合

| 字段 | 谁写 | 谁读 | 语义 |
| :--- | :--- | :--- | :--- |
| `castActionUntil` | **所有**主动车道真放出去那一刻 | `ZCUnitView` 的 `casting` | 截止前把片段换成 `attackClip`。**不动 `battleState`、不挡移动、不挡攻击** |
| `castHoldUntil` | 只有 `self_cast`（buff 类） | `ZCUnitSystem.updateUnit` | 截止前留在原地（`idle`），**但照样出拳** |

两条时长都是 `0.5s`，收在 `assets/script/app/zcds/model/ZCUnitCastAction.ts`
（`ZC_SKILL_CAST_ACTION_SECONDS` / `ZC_SELF_CAST_HOLD_SECONDS`，文件必须保持**无 `cc` 依赖**）。

🔴 **不要拿 `selfCastSeconds` 当停顿时长。** 那是**增益持续秒**（4~8 秒），
拿它来停就是「站桩半局」。同理「施法动作该多久」本质是**动画片段时长**，属于表现、不属于数值槽 ——
与 `ZC_BLINK_CAST_EFFECT_SECONDS`（瞬间移动特效 0.75s）同一条理由。
真要逐档不同再单独加参数，别顺手往 `pvpSkillPlan.skillParamJson` 里塞列（那张表三写）。

📌 **2026-11-26 图集治理（`瞬间移动特效`，屏幕尺寸不变）**：18 帧原画布 1296×1228，
可见内容只有 1166×1166（第 15 帧峰值），根节点靠 `_lscale 0.06861` 缩到 80px。
而每帧矩形 1300×1232 塞不进 2048 的 auto-atlas（两帧并排 2600 > 2048），
**18 帧各占一页、合计 109 MB 纹理像素**。

改成按峰值重烘：裁可见并集 `(69,31)-(1235,1197)` → 1166×1166 → 重采样 80×80，
于是 `_lscale = 1`、`_contentSize = 80×80`、auto-atlas 一页（0.44 MB）；
18 张 PNG 5.57 MB → 94 KB。屏上尺寸与旧版一致（1166 × 80/1166 = 80px）。
重烘命令见 `tools/build_blink_fx.py` 文件头，原始帧备份在 `tmp/fx_src_backup/瞬间移动特效/`。

### 18.2 只在「真放出去」之后写

| 车道 | 写入点 | `hold` |
| :--- | :--- | :--- |
| `self_cast`（自愈 / 嗜血 / 迅击 / 狂暴） | `applySelfCast` 消费 CD 之后 | **true** |
| `secondary`（副轨扇形） | `castSecondary` 返回 `true` | false |
| `self_aura`（无尘禁土 / 喷射火焰） | `castSelfAura` 返回 `true` | false |
| `bolt_strike`（五雷轰顶） | `castBolt` 返回 `true` | false |
| `trap_place`（精密陷阱） | `castTrap` 返回 `true` | false |
| `random_strike`（多点打击） | `strike()` 命中 > 0 时 | false |
| `blink_strike`（移形换影） | `blinkTo` **之后**（落点播） | false |

🔴 **待触发 / 被拒不写。** 那两条路径是「CD 保持就绪、下一帧再试」的每帧循环，
写下去等于角色原地抖个不停。`tests/zcds-unit-cast-action.test.ts` 第 4 条钉住这件事。

`self_aura` 刻意**不锁**：无尘禁土 / 喷射火焰本来就跟着人走（`auraFollow`），
锁在原地会把「边跑边喷」变成站桩喷火 —— 那几个是有独立设计口径的，别一起改。

### 18.3 `ZCUnitSystem` 的锁分支放在哪、为什么

在 `attack` 分支**之后**、`tryStartDash` **之前**：

- 放 `attack` 之后 ⇒ 「当前已经是攻击动作就无需打断」，正在播的那一拳照常播完再掉回 `idle`；
- 放 `tryStartDash` 之前 ⇒ 锁定期内不许起冲（冲刺是普攻本身，会把人带走）；
- 锁内的出手判据与 `idle` 分支同源（有目标 + 在射程内 + `now >= nextAttackAt` ⇒ `startAttack`），
  对应括号里那句「不影响攻击」。

写法照抄 `dashRecoverUntil`（冲刺后原地待机）。两者唯一的区别：那个连索敌都不做
（「冷却期间静止在原地播待机动作」），这个**保留出手**。

到期时 `castHoldUntil = undefined` 交回常规状态机；`castActionUntil` **不清零**——
视图只做「`now < until`」的绝对比较，留着比清掉更安全（快照重放更确定）。

🔴 视图那半句还多一个 `unit.battleState !== 'dead'`：自愈本来就常在残血时放，
落地半秒内被打死的话，窗口没到期会让**尸体保持出拳姿势** —— 与 `unit.charging`
「每帧先清、别把出拳姿势带进 idle」是同一类事故。

### 18.4 守卫（`tests/zcds-unit-cast-action.test.ts`，9 条）

| 条 | 钉什么 |
| :--- | :--- |
| 常量 | 两条都是 0.5、量级在 0.2~1.5 之间、`ZCUnitCastAction.ts` 无 `cc` 依赖 |
| buff 类 | 出手时**同时**写两个字段；`selfCastSeconds = 0`（只回血）也要锁 |
| 其余六条车道 | 都写 `castActionUntil`、`castHoldUntil` 一律 `undefined` |
| 待触发 | 闸门关着 ⇒ 一个字段都不写；目标进范围当帧补写 |
| 打断 walk | 锁内不调 `advanceTowardUnit`、`battleState` 压回 `idle` |
| 到期恢复 | 字段清空、切回 `move`、下一帧真的开始挪 |
| 不影响攻击 | 锁内射程内有目标 + CD 到点 ⇒ `attack`；CD 没到就站着等 |
| 不打断出拳 | `attack` 分支在锁之前，`stateTime` 照常推进 |
| 视图 + 快照 | `casting` 进了那条三元、重播判据只认 `attacking`、两个字段登记进 codec 白名单 |

---

## 19. 普攻衍生的多目标递减 + 处决只留在养成系统（2026-11-14）

### 19.1 用户口径（原话）

> 技能设计中的处决机制先从卡牌中移除，处决机制只能留在其他的养成系统中，普通攻击带来的穿透类 / 分裂子弹 / 溅射 的伤害设计上需要遵循 多个目标递减的机制，初始值必须低于普通攻击，主要形成大面积的造成伤害的效果，但是数值不能太大。

拆成三条硬约束：

1. **处决（`executeChance`）从卡牌链路整体移除**，只保留给其他养成系统 —— 卡牌里「枯萎收割」（68024 / 102401、68035 / 103502）不再带处决。
2. **普攻衍生的三种结算形状必须多目标递减**：穿透 / 多弹（= 用户说的「分裂子弹」）/ 溅射。
3. **初始值低于普通攻击**，定位是「大面积、数值不大」，不是「单体加强版」。

### 19.2 三种结算形状的落地参数

| 形状 | 配表键 | 值 | 递减语义 | 逐目标 |
| :--- | :--- | :--- | :--- | :--- |
| 穿透 | `normalPierceFalloff` | `0.4` | `ZCProjectileSystem` 每穿一次 `× (1 - falloff)`，**首次命中不算穿** | 60% → 36% → 21.6% |
| 溅射 | `splashDamageRate` + `splashFalloff` | `0.20/0.26/0.32` + `0.3` | 同一爆点旁溅目标按**距离由近到远**排序，第 n 个（n 从 0 计）`× (1 - falloff)^n` | 20% → 14% → 9.8% |
| 多弹 | `bulletFalloff` | `0.4` | 第 1 颗是普攻本体（100%），第 2 颗起每颗 `× 0.6` | 100% → 60% → 36% |

三档都是**低于普攻（100%）**的；满档总额：穿透单发 100%（首目标）+ 36% + 21.6%；溅射一爆点 20% + 14% + 9.8%；多弹 +2 发整轮 196%（原 300%）。

### 19.3 三处「照字面写会静默失效」

1. 🔴 **`pierceCount` 不是普攻穿透**。`pierceCount` 只服务「强化那一击」（`empowered` 分支），普攻穿透必须写 `normalPierceCount`；写在 `pierceCount` 上等于没配。设计案 P 列历史上一律写的 `pierceCount`，本轮一并改成 `normalPierceCount`。
2. 🔴 **溅射的键名是 `splashDamageRate`，不是 `explosionDamageRate`**。后者引擎不认（命中爆炸走 `impactBurst*` 前缀，是另一套）。设计案 13 条溅射行里有 12 条写的是错键，本轮全部更正。
3. 🔴 **多弹是 unit 域修改器（`bulletNumFlat`），不能写进 `skillParamJson`**：`bulletNum` 走 `pvpAttrMap` 的 flat 映射，写进 `skillParamJson{"bulletNum":…}` 不会被读到。多弹的**递减系数**才是 `skillParamJson.bulletFalloff`（挂在多弹那几条修改器行自己身上，同 `pvpSkillId` 合并进普攻那份 runtime）。

### 19.4 代码落点

- `ZCAttackResolutionSystem.zcBulletDamageScale(index, baseProjectileCount, bulletFalloff)` —— 新导出的纯函数，`IZCPreparedAttack` 新增 `bulletNumExtra / bulletFalloff / baseProjectileCount` 三个字段透传到 `createAttackProjectiles`。`baseProjectileCount = projectileCount - bulletNumExtra` ⇒ **固定颗数（凤凰降临 4 颗）不算额外弹、不吃递减**。
- `strikeTargets` / `resolveProjectileHit` 的溅射段：先收集 `{unit, distance}` → `sort` → 按下标乘 `(1 - splashFalloff)^index`。
- `splashFalloff` 缺省 `0`、`bulletFalloff` 缺省 `0`、`normalPierceFalloff` 缺省 `0` ⇒ **没配这个键的既有技能行为逐字不变**。

### 19.5 处决移除的落点

`pvpSkillPlan.skillParamJson.executeChance` 6 行（102401/192401/103502/193502 × 3 档）已删；`armySkillLevelUp.desc`（卡牌技能卡文案，玩家真读的那份）里 6 处「普攻有 NN%概率处决残血目标，」已删；`pvpSkillPlan.desc` 同步删。代码侧 `ZCGameModel.tryExecuteUnit` / `tryExecute` 的读取路径**没删** —— 那是给其他养成系统留的入口，只是卡牌链路不再写这个键。

🔴 设计案里「枯萎收割」去掉处决后只剩暴击率 + 伤害两路，原「满级价值约 139 VP」是按含处决算的，**需要重算**（表里已标【优化中】）。

### 19.6 设计案回填（`技能设计案2.xlsx`）

- **N 列**：43 处「处决」句式全部清掉（30 行模板句「…附加伤害或处决为主干」、12 行紫档机制句「…减速 / 处决」、1 行旁注「不额外触发状态与处决」）；枯萎收割两行的档位句从「一处必杀机制 + 一到两处倍率」改成「两处倍率」。
- **K/L/M 列**：穿透补「（穿透目标承受 60%/36%）」，溅射换基准值并补「（同一爆点第2个目标起每次×0.7）」，多弹补「（额外弹：60% / 36%）」，枯萎收割删「普攻有 NN%概率处决残血目标，」。
- **S 列（技能状态）**：新增第三个取值 **【优化中】**，本轮涉改 24 行（穿透 5 + 溅射 13 + 多弹 4 + 处决 2）标上；`S1` 表头改成「技能状态（已实现 / 优化中 / 待规划）」。**只标「口径被本轮改过」的行，纯文案清理不动状态。**

### 19.7 守卫

| 用例 | 钉什么 |
| :--- | :--- |
| `zcds-multi-target-falloff.test.ts`（9 条） | 三条公式 + 缺省 0 不变 + 固定颗数不吃递减；四张多弹卡 12 行带 `bulletFalloff 0.4`；15 行普攻穿透带 `normalPierceFalloff 0.4` 且无 `pierceCount`；39 行溅射 20/26/32 + `splashFalloff 0.3` 且 `< 1`；`executeChance` 与「处决残血目标」零残留（两份产物 + `armySkillLevelUp`） |
| `zcds-zombie-skills.test.ts`「科学家 26 级」 | 三条词缀从「穿透 / 处决 / 暴击」改为「穿透 / 暴击 + 处决已移除」，断言 `skillParams.executeChance === undefined` |
| `zcds-dawtianlu-skills.test.ts` 102504 | 102502 裂变暴击的 `splashDamageRate` 0.48 → 0.32，并断言 `splashFalloff 0.3` |
| `zcds-maladi-guo.test.ts` 102602 | 溅射基准 0.20/0.28/0.36 → 0.20/0.26/0.32 + `splashFalloff` |

### 19.8 两个「改配表脚本」的幂等坑

1. 🔴 **描述替换串不能与匹配串自相包含**。`SPLASH_DESC = r'造成\d+%溅射伤害'` 而插入文本是「造成20%溅射伤害（同一爆点第2个目标起每次×0.7）」—— 每跑一次多追加一段括号，重跑三次后 68008 的 desc 变成三段。修法：匹配串把**已插入的后缀一起吃掉**（`(?:后缀)*`），替换成单段。
2. 🔴 **参数替换同理**：只匹配 `"splashDamageRate":[\d./]+` 会在每次重跑时再追加一个 `,"splashFalloff":0.3`。匹配串必须带 `(?:,"splashFalloff":[\d.]+)*`。
3. 🔴 **源表稀疏行没有 AC 格**：`sync_treant_excel.set_cell` 只会替换已存在的 `<c>`，多弹那 12 行历史行的 AC 列整列是空的 ⇒ `SystemExit('单元格 AC340 不存在')`。需要按列序**插格**（并沿用前一格 `s=` 样式），见 `patch_bullet_falloff.set_cell_safe`。

### 19.9 本轮脚本

- `tools/config/patch_multi_target_falloff.py` —— 穿透 / 溅射 / 处决，三写（remoteRef + client + `J-技能表.xlsx` sheet9 的 Z/AC、`K-卡牌升级.xlsx` sheet2 的 C）。
- `tools/config/patch_bullet_falloff.py` —— 多弹 `bulletFalloff`，三写（同上，只动 AC）。
- `tools/config/patch_design_doc_multitarget.py` —— 设计案回填（zip 级手术，`--check` 干跑）。
- 验法：源表 2209 行 × Z/AC 两列**逐格对拍 0 不一致**；`npx tsc --noEmit` 0 error；`tests/zcds-*.test.ts` 1446 条 / 1439 绿 / 7 红（7 红是改动前既有的）。
- 顺手修掉一条既有红：`remoteRef` vs `client` 互校里 `96802501~50.pvpSkillId` 长期是 `30171`（remoteRef）对 `30858`（client）。`patch_bullet_falloff.py` 按 client 全量重建 remoteRef（不再「只改有变化的行」）后自动对齐 —— 68025 的普攻就是自己的 30858，`30171` 是长枪兵的历史值，属于 remoteRef 陈旧。

## 20. 被动重设计 V5 · 第 4 批：克制条 20 条（2026-11-17）

### 20.1 口径

设计案里的「异种猎杀协议 / 职业猎杀协议 / 抗性装甲协议 / 职业抗性协议」四类，都是**单卡条件加成**：

- 攻方：**打**某阵营 / 某职业时增伤（`counter*`）；
- 守方：**受到**某阵营 / 某职业的伤害时减伤（`countered*`）。

它们是**卡牌被动**，与 `pvpCounter` 那 8 条全局克制规则（×1.3，阵营 4 条 + 职业 4 条）是**两套独立判定**，
结算时**相乘**。两套的链条**现已同源**（2026-11-17 起，见 §20.8）：设计案「克制谱系」把
「法师→坦克→射手→战士→法师」写成 A→B 读作「A 克 B」，即 **坦克→射手→战士→法师→坦克**，
阵营为 **花果→蘑菇→盆栽→僵尸→花果**，`pvpCounter` 已逐条对齐。
但克制条仍然**只按 statId 自己的判据**判定、不去读 `pvpCounter` —— 因为它是「单卡 × 单阵营/单职业」的
细粒度条件，而全局那 8 条是「职业级 ×1.3」的粗粒度关系，两者的值、生效范围、生命周期都不同；
同源只保证「表里写的方向和设计案不矛盾」，不保证「每张卡的克制条都能在全局链里找到对应」。

### 20.2 判据编进 statId

| statId | 语义 | 序号 |
| :--- | :--- | :--- |
| `counterCamp1..4` | 攻方：打某阵营增伤 | `ZC_CAMP_TRAITS` 下标 + 1（花果 1 / 蘑菇 2 / 盆栽 3 / 僵尸 4） |
| `counterRole1..4` | 攻方：打某职业增伤 | `ZC_ATTACK_TRAITS` 下标 + 1（射手 1 / 战士 2 / 法师 3 / 坦克 4） |
| `counteredCamp1..4` | 守方：受到某阵营伤害降低 | 同上 |
| `counteredRole1..4` | 守方：受到某职业伤害降低 | 同上 |

**为什么不写进 `skillParamJson`**（`counter: {camp:'蘑菇'}` 这种）：

1. 参数袋按 `unitId:pvpSkillId` 合并 ⇒ 同一张卡两条克制条会互相覆盖，而 68020 / 68021 恰好各有两条；
2. 结算点只拿得到双方的 `statPatch`，读不到「本行是哪条技能」，没法把判据和值对上。

值口径与 `critRate` 相同：**`add` + 百分点**（45 = +45%），`foldStatPatch` 直接累加，结算处再除 100。
`addRate` 在这一列恒 0 —— 这些 statId 没有 `baseValue` 可乘。

### 20.3 🔴 方向必须分开取特征（第一版写错的坑）

| 加成 | 判的是谁 |
| :--- | :--- |
| `counter*X` | **被打的人**是不是 X（我打 X 更疼） |
| `countered*X` | **打我的人**是不是 X（X 打我我少受伤） |

所以 `zcSkillCounterMultiplier(attackerPatch, defenderPatch, attackerTraits, defenderTraits)` **必须同时
拿到攻守两侧的 `traits`**。第一版只传了守方、用守方自己的职业去查 `counteredRole*`，
结果 68023 / 68031 的「受到法师伤害 -45%」被算成「守方自己是法师才减伤」——
整条抗性协议永不生效，且 68023 恰好是法师（雷蕉是法师）时反而会误生效。集成用例当场抓出（`1 !== 0.55`）。

### 20.4 代码落点

- `ZCStatSchema`：`ZC_COUNTER_STAT_IDS`（16 个）+ `STAT_IDS` + `STAT_TO_PATCH`（第二列 `null`）。
- `ZCModifierRuntime`：`ZCUnitStatPatch` 16 个可选 `*Pct` 字段。
- `ZCAttackResolutionSystem`
  - `zcSkillCounterMultiplier(...)` —— 导出纯函数，四层相乘：增伤（阵营/职业）× 减伤（阵营/职业）。
  - `counterMultiplierFor(unit, targetOwner, targetCardId, context, targetUnitId)` = `cardCounterMultiplier` × 上面那条。
  - `projectileCounterMultiplier(projectile, …)` —— `resolveProjectileHit` 是 static、手上只有弹体，
    靠 `projectile.sourceUnitId` 反查攻方实例；**射手已阵亡**（`unitById` 查不到）时退回全局克制，
    技能级克制条随之失效 —— 与「光环随施法者消失」同一口径。
  - `unitDamage` 新增第 6 个可选参 `targetUnitId`（守方 patch 按单位实例的 `unitId` 取才准），
    内部改调 `counterMultiplierFor`；10 处调用点已全部透传。
  - 建筑 / 格子没有卡技能 ⇒ 传 `undefined`，只剩全局克制；`ZCGameModel` 的旧防御塔路径保持原样。
- 缺省全 0 ⇒ 恒等，存量单位行为逐字不变。

### 20.5 配表与源表

- `tools/config/patch_passive_redesign_batch4.js`（幂等）：主判据写 `statId/operation/value`，
  第二个判据与暴击率写 `mix.<statId>` / `mix.critRate`；**已有行的 `modifierId` 一律不动**
  （`cardLevelUp.skillList` 引用它），只有整条链新建时按 `94000000 + (链 % 10000) * 10 + 档位` 生成。
- `patch_passive_redesign_tails.js`：7 条带混搭尾的链；并把「清 `mix.*`」改成**只清自己拥有的 5 个 statId**
  —— 整块清会把 batch4 写的 `mix.critRate` / `mix.counterRole2` 抹掉，两个脚本的先后顺序就有影响了。
  验收法：乱序重跑（`batch4 → tails → tails → batch4 → tails`），四份产物 md5 零差异。
- 旧机制的状态与参数必须一起清：100103 减速（`hunger_slow_*`）、100203 格挡、100303 点燃、
  100503 生命汲取（范围 + `lifestealRate`）、101302 / 102202 溅射、103003 共生矩阵（友军光环）。
- 回填：`patch_magdi_skill_rows_excel.py <20 链>`（J 表 60 行 × 29 列逐格一致）、
  `patch_passive_redesign_k.py`（K 表 147 行，B 名 / C 描述 / **D 解锁兵种等级**）。
- 顺手修掉一个超上限值：子链 `192302` 原本 `critRate add 20`（> 15% 上限），改成「攻击 7%」，
  暴击率改由 `mix.critRate` 8/10/12。

### 20.6 用例

| 用例 | 钉什么 |
| :--- | :--- |
| `zcds-counter-protocol.test.ts`（11 条） | 60 行全部落表且 statId 在白名单、三档数值与暴击率逐条对齐设计案、判据序号与 `ZC_CAMP_TRAITS`/`ZC_ATTACK_TRAITS` 同序、同一卡同一档最多一条带暴击率；纯函数四层相乘与缺省恒等；近战 100→145 / 100→55 / 只命中一条 →130；弹道 100→145 与「射手已阵亡」退回 100 |
| `zcds-multi-target-falloff.test.ts` | 溅射链 16 → 14（101302 / 102202 的溅射被设计案收走） |
| `zcds-yedan-skills.test.ts` | 100503 由「生命汲取」整段换成克制条：`lifestealRate` 必须消失、混搭尾三个键进 `statPatch` |
| `zcds-yulin-skills.test.ts` | 100401 由「灵巧投掷（攻速）」换成 `counterRole2` + `mix.critRate` |
| `zcds-skill-plan.test.ts` | 100103 不再加攻击、不再挂 `hunger_slow_l3` |
| `card-skill-list.test.ts` | 100103 名称「饥饿缠身」→「异种猎杀协议」 |

### 20.7 遗留

- **102001「对僵尸阵营 / 战士职业 +15%」** 落地为两条判据同值，打「僵尸·战士」（全表只有 68028）
  会叠成 ×1.15²（+32%）。用户已裁定：**不做互斥、保持叠乘** —— 「双条件各给一份」是设计意图。

### 20.8 全局克制链（`pvpCounter`）已与设计案同源

2026-11-17 用户要求「按照设计案重新调整 射手--坦克--法师--战士--射手的链条全部重新设计，并同步源表」。
设计案 `技能设计案2.xlsx / 技能设计案 (2)` 102001 机制列原文：

> 克制谱系（花果→蘑菇→盆栽→僵尸→花果；法师→坦克→射手→战士→法师）

A→B 读作「A 克 B」。职业链去掉闭环重复点 = **坦克→射手→战士→法师→坦克**，
阵营链 = **花果→蘑菇→盆栽→僵尸→花果**（原本就一致，未改）。

🔴 **「→」的方向不是猜的，用 Q/R 两列钉死**。同一张表表头：
`Q = 克制（出手 ×1.3） / counter`、`R = 被克制 / counteredBy`。
取四张**同阵营**（花果）的卡，排除阵营向、只剩职业向：

| 卡 | 职业 | Q（本卡克谁） | R（谁克本卡） |
| :--- | :--- | :--- | :--- |
| 68001 豌豆游侠 | 射手 | 战士 | 坦克 |
| 68002 巨力坚果 | 坦克 | 射手 | 法师 |
| 68003 火焰树妖 | 法师 | 坦克 | 战士 |
| 68005 椰蛋战士 | 战士 | 法师 | 射手 |

克制边 = 坦克→射手→战士→法师→坦克；且**每条 R 正好是别人的 Q**（正反方向自洽）。
⇒ 「法师→坦克→射手→战士→法师」= 法师克坦克、坦克克射手、射手克战士、战士克法师。

⚠️ 用户口述的「射手--坦克--法师--战士--射手」与此**互为逆环**（那串「--」是节点罗列、不含方向），
以设计案原文 + Q/R 列为准。

| 维度 | 攻方 | 守方（克制目标） | 倍率 | 本次 |
| :--- | :--- | :--- | :--- | :--- |
| 攻击 | 坦克 | 射手 | 1.3 | ✅ 改（原 → 战士） |
| 攻击 | 射手 | 战士 | 1.3 | ✅ 改（原 → 法师） |
| 攻击 | 战士 | 法师 | 1.3 | ✅ 改（原 → 射手） |
| 攻击 | 法师 | 坦克 | 1.3 | 不变 |
| 阵营 | 花果 | 蘑菇 | 1.3 | 不变 |
| 阵营 | 蘑菇 | 盆栽 | 1.3 | 不变 |
| 阵营 | 盆栽 | 僵尸 | 1.3 | 不变 |
| 阵营 | 僵尸 | 花果 | 1.3 | 不变 |

**改法（三处，脚本幂等）：**

1. `tools/config/patch_counter_chain_design.js` —— 两份 `pvpCounter.json`
   （`assets/remoteRef` 列存 / `doc/塔防数据配置/json/client` 行存）。
   守卫以「`dimension` + 攻方」为键，只比 `defender` 与 `damageMultiplier`——
   🔴 别拿「维度|攻方|守方」整体比，一换守方就全表不匹配、脚本静默无操作。
2. `tools/config/patch_counter_chain_design_excel.py` —— 源表 `PVP-克制羁绊.xlsx / 克制`，
   zip 级手术只换 `xl/worksheets/sheet1.xml` 里 C7/C8/C9 三个共享字符串**索引**
   （坦克 14 / 战士 15 / 射手 16 / 法师 17），不碰 `sharedStrings.xml`；带 `--check` 干跑 + 回读校验，
   二次运行为 `[skip]`。
3. 用例 `zcds-counter-protocol.test.ts` 第三组 4 条：8 条逐条对齐（**排序后比**，
   配表行序不是契约）、四职业单环走 4 步回到起点、全局 × 技能级相乘（射手打战士 100×1.3×1.24=161）、
   链条以外不生效（射手打法师不再是克制）。

**连带影响**：`tests/zcds-client-combat-config.test.ts` 的「领地首领波次卡」原本靠「射手克法师」
拿 1.3 倍，改后不再成立 ⇒ 末波卡由 `68003`（法师）换成 `68005`（椰蛋，花果·战士），保住用例语义。

## 21. 被动重设计 V5 · 第 5 批：多弹 9 条（2026-11-17）

### 21.1 口径（用户已裁定 Q11 / Q12）

设计案写「第 1 发 60%，第 2 发 36%」并要求逐档提高到 65/39、70/42，但**引擎里逐档额外弹伤害
没有任何消费点**（`extraBulletDamage` 谁都不读）。落地口径改成：

- 三档 `bulletFalloff` = **0.4 / 0.35 / 0.3**，第 2 颗 = 本体 `(1-f)²` ⇒ **36% / 42.25% / 49%**；
- 文案写「**约为第 1 发的 60% / 65% / 70%**」（L1 就是用户给的那句「约为第 1 发的 60%」）；
- 普攻裂弹的张角走 **`bulletAngle`**，不用 `projectileSpreadDeg`。

### 21.2 🔴 三个载体，一个都不能写重

| 载体 | 性质 | 合并方式 | 能写几处 |
| :--- | :--- | :--- | :--- |
| `bulletNum`（patch `bulletNumFlat`） | **statId**（unit 域） | 所有行 fold 进同一 `statPatch` ⇒ **相加** | **只能一处** |
| `bulletFalloff` | `skillParamJson` 键 | 按 `unitId:pvpSkillId` **覆盖** | **只能一处**（否则看行序） |
| `bulletAngle`（patch `bulletAngleFlat`） | **statId**（unit 域） | **相加**（度数） | **只能一处** |

代码依据：
- `ZCAttackResolutionSystem` 第 1282 行 `bulletNumExtra = patch.bulletNumFlat`，第 1286 行
  `projectileCount += bulletNumExtra` ⇒ flat 加法，两处就 +4；
- `ZCMatchRuntimeCompiler.mergeSkillPlanIntoRuntime` 第 71 行
  `parameters: { ...existing.parameters, ...params }` ⇒ 同名键**后者覆盖**；
- `readZCSkillMixStats`/`foldStatPatch` 对 statId 一律累加。

所以统一写法：**子弹数与递减系数只落主链行**，尾巴落子链槽位（或 `mix.*`），
子链原 `bulletNum` 槽位改承载 `attack`/`attackRange`，原 `bulletFalloff` 从子链 `spj` 清掉。

### 21.3 🔴 偶数颗不能配张角（第二颗起就没中心位）

扇形分布是 `spread = (i / (count - 1)) * 2 - 1`（第 1435 行）：

- `count = 3` ⇒ −1 / **0** / +1，中间那颗正好对准目标 ⇒ 25° 可用；
- `count = 2` ⇒ 只有 −1 / +1，**没有 0° 中心位** ⇒ 两发分别偏 ±12.5°，整轮脱靶。

102601 在 2026-11-11 为此把张角从 12° 收成 0°（实测两发全脱靶、伤害 0）。
本批：3 颗的 5 条给 25°，2 颗的 102201 **不配张角**（全走 `aim`）。
`patch_passive_redesign_batch5.js` 有硬守卫（`(bullets + 1) % 2 === 0 && angle` 直接抛错），
`zcds-maladi-guo.test.ts` 另有一条通用守卫遍历全部 `bulletNum` 行。

### 21.4 逐条配置

| 链 | 卡 | 技能 | 额外弹 | `bulletFalloff` | 张角 | 尾巴 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 101001 | 68010 镭射飞龙（法师金） | 孢群弹幕 | 2 | 0.4/0.35/0.3 | `bulletAngle` 25 | 子链 281001 attack 0.28 · 191001 attackRange 0.35 |
| 101301 | 68013 风炮菇（射手紫） | 连发苔针 | 1 | 0.4/0.35/0.3 | — | 无 |
| 101701 | 68017 毒箭蘑菇（射手金） | 苔针双连 | 2 | 0.4/0.35/0.3 | — | 子链 281701 attack 0.28 · 191701 attackRange 0.35 |
| 102201 | 68022 雷蕉（法师紫） | 孢子弹幕 | 1 | 0.4/0.35/0.3 | —（2 颗） | 无 |
| 102402 | 68024 急冻瓜（法师金） | 孢群弹幕 | 2 | 0.4/0.35/0.3 | `bulletAngle` 25 | 子链 192402 attack 0.18；mix 伤害 0.15 · 范围 0.25 |
| 102601 | 68026 麻辣铁锅（法师金） | 孢群弹幕 | 2 | 0.4/0.35/0.3 | `bulletAngle` 25 | 子链 282601 attack 0.28 · 192601 attackRange 0.35 |
| 103201 | 68032 吉他手（射手金） | 苔针双连 | 2 | 0.4/0.35/0.3 | — | 子链 193201 attack 0.28 · 283201 attackRange 0.35 |
| 103401 | 68034 魔术师（法师金） | 孢群弹幕 | 2 | 0.4/0.35/0.3 | `bulletAngle` 25 | 子链 283401 attack 0.28 · 193401 attackRange 0.35 |
| 103502 | 68035 科学家（射手金） | 苔针双连 | 2 | 0.4/0.35/0.3 | — | 子链 193502 attack 0.18；mix 伤害 0.15 · 范围 0.25 |

紫卡（101301 / 102201）按 **L 列的「额外发射 1 发 / 裂出 1 道」** 取 `bulletNum=1`，
设计案 P 列笼统写的 `=2` 是金卡口径（研发档案 Q1 已裁定按 L 列）。

### 21.5 工具链

1. `tools/config/patch_passive_redesign_batch5.js` —— 两份 `pvpSkillPlan.json`
   + 两份 `armySkillLevelUp.json`（主链 27 行 ×2、子链槽位 45 行 ×2）。幂等：重跑 md5 零差异。
2. `patch_magdi_skill_rows_excel.py <24 个链号>` —— `J-技能表 / PVP技能配置` 72 行（含子链），
   应输出「原地重写 72 行、追加 0 行」；出现「追加」说明有行的 modifierId 与 JSON 不一致。
3. `patch_passive_redesign_k.py` —— `K-卡牌升级 / 卡牌技能升级表` 174 行（B 名 / C 描述 / **D 解锁等级**）。
4. `patch_skill_design2_multibullet.py` —— 回写设计案本页 L1~L3 文案与 P 列落地口径（30 格），幂等。

🔴 **子链 modifierId 不是算出来的，是表里既有的**。`372601` 的两份 JSON 都用 `97026011`
（不是 `96726011`），一度误判成脏数据改成 967，结果 upsert 匹配不到 ⇒ 追加出重复行。
改任何子链编号前，先查 `remoteRef` 与 `client` 是否**同一个值**。

### 21.6 用例

| 用例 | 钉什么 |
| :--- | :--- |
| `zcds-flora-skills` 533 | 发数在**主链 101001**（2/2/2），子链 281001 改承载 attack 0.28，张角 371001 = 25°；`spj` 里不得出现 `bulletNum`/`bulletAngle` |
| `zcds-flora-skills` 534 | 68010 L25 的 patch：`bulletNumFlat=2` / `bulletAngleFlat=25` / 攻 44 / 伤 13 / 范围 58 / **无攻速** |
| `zcds-maladi-guo` 849 | 102601 主链 bulletNum 2、子链 282601 attack 0.28、192601 attackRange 0.35、372601 张角 25° |
| `zcds-maladi-guo` 守卫 | **总弹数为偶数时张角必须是 0**（遍历全部 `bulletNum` 行） |
| `zcds-multi-target-falloff` | 多弹 27 行（9 链 × 3 档）按 `bulletFalloff` 0.4/0.35/0.3；穿透 6 行（2 链，`100701` 已换投枪） |
| `zcds-zombie-skills` 1756 | 68035 L26：`bulletNumFlat=2` / 攻 18 / 伤 29 / 范围 25 / **`critRatePct` 消失** |

### 21.7 遗留

- 设计案 L 列写「同一爆点第 2 个目标起每次 ×0.7」，但 P 列落地口径**没有配** `splashDamageRate`
  —— 本批按 P 列执行（不加溅射）。若这句要真生效，需要另配溅射并重新做 VP 核算。
- `68008` 的 `100801` 是**穿透**不是多弹，本批没带它，仍在「半改卡」表里等穿透批次。
- 103502 主链原为 `critRate add 20/28/36`（越过 15% 上限），本批整段换成多弹后暴击率退出卡牌。

## 22. 被动重设计 V5 · 第 7 批：破阵投枪 5 条（2026-11-17）

### 22.1 口径：那一拍**整份换成弹道**，不是「普攻加穿透」

设计案 P 列原文：「触发时只替换本次普攻的 projectileKey，**不改 attackRange**」。
落成代码就是 `lanceProfileOf()` 把普攻档案整份换掉：

| 换掉的字段 | 值 | 为什么 |
| :--- | :--- | :--- |
| `mode` | `Projectile` | 这一拍不再是近战/区域 |
| `projectileSpeed` | `lanceSpeed` 缺省 **700** | 「掷出去的枪」比普攻弹速快一档 |
| `effectPrefabPath` | 常量 `units/projectiles/子弹_新怪物/通用箭矢` | 参数袋值域是 number，**路径不能配** |
| `areaRadius` / `durationSeconds` / `waves` / `slowRatio` | 清零 | 否则区域型单位投枪时会在目标点额外建一块地火 |
| `onHitStatusId` / `impactEffectPrefabPath` | 清空 | 投枪是**纯伤害弹** |
| `empoweredEvery` / `empoweredSkillId` | 清零 | 强化装配在普攻行上，投枪弹不该再继承 |

**不动的**：`attackRange` / `canAttackAir` / `collisionRadius` —— 沿用卡牌本体。

### 22.2 四个参数键（全部是 `skillParamJson`，覆盖语义）

| 键 | 三档值 | 语义 | 缺省 |
| :--- | :--- | :--- | :--- |
| `lanceEvery` | 4 / 3 / 2 | 每 N 次普攻触发一拍（按 `completedAttackCount % every === 0`） | **0 = 整条车道不触发** |
| `lancePierceCount` | 3 | 穿透**目标总数（含首目标）** ⇒ 剩余穿透 = N − 1 | 3 |
| `lancePierceFalloff` | 0.35 | 每穿一人 `× (1 - 0.35)` ⇒ 70% → 45.5% → 29.6% | 0.35 |
| `lanceDamageRate` | 0.7 | 首目标折算（乘进伤害链，不是「相对普攻的折扣」） | 0.7 |

🔴 **`lancePierceCount` / `pierceCount` / `normalPierceCount` 是三个不同语义**：
前者是「总共能打几个人」（含首目标），中者是「强化那一击的额外穿透次数」，
后者是「普攻的额外穿透次数」。写混的表现是「说穿 3 个、实际打 2 个」，数值上不容易看出来。

### 22.3 🔴 首目标 70% 必须同时进两条乘法链（第一版写错的坑）

近战/区域走 `ZCAttackResolutionSystem.unitDamage()`，弹道走 `createAttackProjectiles()` 里的
`ZCCombatSystem.unitDamageBase()` —— **两段代码、两条乘法链**。

第一版只把 `lanceDamageRate` 乘进了 `prepareAttack` 的 `damage`（事件字段），
而弹道实际伤害读的是 `projectile.baseDamage`（另算一遍）⇒ 表现是
「`combatEvents` 上写着 70%、真打出去还是 100%」，日志与飘字都看不出异常。

修法：`IZCPreparedAttack` 新增 `lanceDamageRate` 字段透传到 `createAttackProjectiles`，
`baseDamage` 写成 `unitDamageBase(..., skillDamageRate * damageRateMultiplier * lanceDamageRate)`；
同时把 `legacy.hasDamageFormula` 那条旁路也加上 `&& !lance`（旧伤害公式是近战挥击的算法，套在枪上会跑偏）。

### 22.4 与「强化那一击」互斥：撞拍时投枪让位、节拍不顺延

两者都是「替换本次普攻」，同一拍只能兑现一个。强化装配的是武将技行（36xxx）的表现与倍率，
优先级更高 ⇒ `lanceBeatOf()` 在 `empowered === true` 时直接 `return false`。

节拍按**绝对累计次数**取模，所以让位那一拍只是「这次不投枪」，下一次仍然是 N 的整数倍
（不会因为让位而往后顺延一格）。

### 22.5 投枪是一枚枪

`if (lance) projectileCount = 1` —— 不吃 `bulletNum` 的多发叠加，也不会被旧 `skillEffect` 的
`hitCount` 撑成多发。多目标靠**穿透链**表达，不靠多发（多发会遇到「偶数颗没有 0° 中心位」那套麻烦）。

### 22.6 代码落点

- `lanceBeatOf(unit, skillRuntime, empowered)` —— 节拍判定，纯函数式读参数袋。
- `lanceProfileOf(base, skillRuntime)` —— 整份换档。
- `ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH` 导出（视图侧要按它兜底弹体）。
- 三个缺省常量：`ZC_LANCE_DEFAULT_DAMAGE_RATE` / `_PIERCE_FALLOFF` / `_PIERCE_COUNT`（+ `_SPEED`）。

### 22.7 工具链（幂等）

1. `tools/config/patch_lance_batch7.js` —— 两份 `pvpSkillPlan.json` + 两份 `armySkillLevelUp.json`
   （主链 15 行 ×2、子链槽位 24 行 ×2）。守卫：全表扫 `lanceEvery`，同 `unitId` >1 条链直接 throw。
2. `patch_magdi_skill_rows_excel.py <13 个链号>` —— 39 行原地重写、29 列逐格对拍。
3. `patch_passive_redesign_k.py --all` —— 420 行、改 30 格。
4. `patch_skill_design2_lance.py` —— 设计案 32 格（含 `100901` 从「蔓生三连」整条改名为「破阵投枪」，
   以及 5 行的「技能状态」改成【已实现】）。守卫：G 列链号必须对得上行号。

### 22.8 用例

`tests/zcds-lance-skills.test.ts` 13 条 —— 配表 4（参数袋四键三档 / 名称与解锁档 / 子链尾巴同档 / 一卡一链守卫）
+ 结算 9（4-3-2 节拍、其余拍仍近战、首目标 70%、剩余穿透 2、衰减 0.35、弹速 700 且区域清 0、
撞拍让位、不吃多发、参数缺省兜底）。

## 23. 被动重设计 V5 · 第 8 批：三条新 statId（2026-11-17）

### 23.1 三个字段的共同点

| statId | 语义 | `add` 写什么 | 消费点 |
| :--- | :--- | :--- | :--- |
| `hpRegenPct` | 每秒回复最大生命的百分比 | `1.5` = 每秒 1.5% | `ZCSkillTriggerSystem.applyHpRegen` |
| `bulletSizeScale` | 普攻弹体体积倍率（**绝对**） | `1.6` = ×1.6 | `createAttackProjectiles` 的 `collisionRadius` + `sizeScale` |
| `cdReduceOnHit` | ~~每次普攻命中回退其他主动的秒数~~ **❌ 已全卡下线（第 10 批）** | ~~`0.4` = 0.4 秒~~ | ~~`ZCAttackResolutionSystem.reduceCooldownsOnHit`~~ |

> ⚠️ 本节写于第 8 批。第 10 批用户口径「所有卡牌都移除普通攻击减少冷却时间的这个机制」
> 已把 `cdReduceOnHit` **整条车道**拆掉（四处登记 + 字段 + 消费点 + 快照白名单 + 两份 JSON）。
> 下面 23.4 整节作废，23.5/23.7 里涉及它的行已标注。**现存约束只剩 `hpRegenPct` 与 `bulletSizeScale`。**

🔴 **三个都只能写 `add`，不能写 `addRate`**。`foldStatPatch` 的 `rate` 分支要乘
`baseValue(statId)`，而这三个都没有基础值（不在 `ZCUnitDefinition` 上）⇒ 恒 0。
`STAT_TO_PATCH` 里第二个槽位写 `null` 就是在表达「这个 statId 没有百分数口径」，
写了 `addRate` 不会报错、也不会生效 —— 最难查的那种。

登记清单（少一步就静默失效）：`ZCStatId` 联合 → `STAT_IDS` 集合 → `UNIT_STAT_IDS`（折叠用）
→ `STAT_TO_PATCH`（进 patch）→ `ZCUnitStatPatch` 字段（类型）→ 消费点。

### 23.2 每秒回复：必须整秒结算，不能逐帧切碎

`healUnit` 只收整数（`ZCStatusResolutionSystem.healUnit` 里 `Math.round` 之后封顶），
所以「每帧按 `dt` 比例回一点」会被取整全部抹掉：最大生命 1000、每秒 2% ⇒ 单帧 0.32 → 0。

落地：用 `floor(now) − floor(now − dt)` 数「这一步跨过了几个整秒」，跨过才补拍：

```ts
const ticks = Math.floor(now + 1e-9) - Math.floor(now - dt + 1e-9);
if (ticks <= 0) return;
context.healUnit?.(unit, unit.maxHp * rate / 100 * ticks);
```

步长固定 1/30 s 时 `ticks` 恒为 0 或 1；掉帧跨 2 秒就补 2 拍，不漏也不超。
**不加新快照字段**（第 8 批当时对比的是 `cdReducePaidAt` 那种去重戳；该字段已于第 10 批删除），
保持单位状态不变。

### 23.3 弹体体积：一个倍率喂两处

`bulletSizeScale` 同时决定「看着多大」与「判定多宽」：

- 逻辑：`collisionRadius = (profile.collisionRadius ?? 3) × combatDistanceScale × scale`；
- 视图：出手时把同一个 `scale` 写进 `ZCProjectileState.sizeScale`，
  `ZCCombatEffectView.render` 乘进宿主节点缩放（`nodeScale × growFactor × sizeScale`）。

只改一处就是两种症状：只改判定 →「判定变宽但看着没变」；只改视图 →「看着变大但打不中」。

🔴 它在 `ZCUnitStatPatch` 里是**绝对倍率**，与其它字段的「相加」语义不同：
同卡两条链都写会加成 3.2。设计口径里一张卡只有一条，本批没加守卫。

### 23.4 ~~命中回退冷却：只扣别的车道，且同帧只算一次~~ → ❌ 整节作废（第 10 批）

> 用户 2026-11-17 口径「所有卡牌都移除普通攻击减少冷却时间的这个机制」。
> `ZC_CD_REDUCE_READY_KEYS` / `reduceCooldownsOnHit` / `cdReducePaidAt` 三个符号
> **已从代码里全部删除**（含快照白名单）。下面保留原文只为记录当初的推理，不是现存约束。

~~回退清单 `ZC_CD_REDUCE_READY_KEYS`：`secondaryReadyAt` / `selfCastReadyAt` / `auraReadyAt` /
`boltReadyAt` / `trapReadyAt` / `strikeReadyAt` / `blinkReadyAt`。~~

~~🔴 **刻意不含 `empoweredReadyAt`**：那是「强化那一击 / 普攻」自己的节拍，设计口径明确
「不作用于自身、不作用于普攻本身」。放进来就成了「打人给自己加速」，攻速会失控螺旋。~~

~~🔴 **同一逻辑步只结算一次**：去重靠 `unit.cdReducePaidAt === now`。~~
~~穿透一拍打 3 人、溅射一拍扫一片，都在同一帧调进来，不去重就变成「命中人数越多 CD 掉得越快」。~~
~~这个字段必须登记进 `ZCSnapshotCodec` 的单位可选数值白名单（漏了会让脏值过校验）。~~

~~回退后一律夹到 `now`：`unit[key] = Math.max(now, readyAt - seconds)`，冷却已好的不会变成负 CD。~~

⚠️ **教训**：`cdReducePaidAt` 当时登记进了快照白名单，下线时白名单也得一起清 ——
否则「校验放行一个不存在的字段」这种事永远不会报错，只会让人以为那条车道还在。

### 23.5 代码落点

- `ZCStatSchema`：~~三个~~ **两个** statId 的四处登记（见 23.1）。
- `ZCSkillTriggerSystem`：`IZCSkillTriggerContext.statPatchOf?` + `applyHpRegen`；
  `tick` 的 `void dt` 已删（现在真的用到了 dt）。
- `ZCAttackResolutionSystem`：`zcBulletSizeScale`（纯函数，非法值一律 1）、
  ~~`reduceCooldownsOnHit`、`ZC_CD_REDUCE_READY_KEYS`~~（第 10 批删除）。
- `ZCGameModel.buildSkillTriggerContext`：`statPatchOf` 接 `unitStatPatches`（与攻击系统同一份 map）。
- `ZCCombatEffectView`：弹道分支乘 `projectile.sizeScale`。

### 23.6 工具链（幂等）

1. `tools/config/patch_regen_size_cd_batch8.js` —— 两份 `pvpSkillPlan.json` + 两份 `armySkillLevelUp.json`
   （主链 9 行 ×2、子链槽位 6 行 ×2）。
2. `patch_magdi_skill_rows_excel.py 100601 101602 191602 102401 192401` —— J 表 15 行、29 列逐格对拍。
3. `patch_passive_redesign_k.py --all` —— K 表 420 行、改 18 格。
4. `patch_skill_design2_batch8.py` —— 设计案 6 格（P 列 + 技能状态）。

### 23.7 用例

`tests/zcds-regen-size-cd.test.ts` ~~14~~ **10 条**（第 10 批删掉整个「结算：命中回退冷却」小节 4 条）
—— 配表 5（三档 statId/数值/解锁、两条各自的旧机制清空与尾巴落位、登记链路折一次）
+ 结算 5（整秒结算 / 掉帧补拍 / 不配不生效 / 体积两处同步 / 非法值按 1）。

## 24. 第 9 批：疑问清单 Q1/Q2/Q3 + 两条主动打样（2026-11-17）

本批是「三件裁定 + 一次打样」，代码只开了**三个缺省不生效的键**，配上两条新主动，
~~目的是把上一批 `102401 裂变共鸣`（每次普攻命中回退其他主动 CD）真正点亮。~~
→ **该目的已于第 10 批作废**：102401 换成「贯穿滋养」，冷却回退整条车道下线。
两条主动本身（102403 / 102404）不受影响，见 §25。

### 24.1 Q1（多弹按 L 列）→ 核对结论：已全对，零改动

| 链 | 卡 | 品级 | L 列 | 落表 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 101001 / 101701 / 102402 / 102601 / 103201 / 103401 / 103502 | 7 张金卡 | 金 | 额外 2 | `bulletNum add 2` | ✅ |
| 101301 / 102201 | 2 张紫卡 | 紫 | 额外 1 | `bulletNum add 1` | ✅ |

`armySkillLevelUp.desc` 同步是「1 道 / 2 道」，与 L 列同口径。**原来担心的「紫卡一律 2」并不存在。**

### 24.2 Q2：101702 噬血蔓延 整条重建（吸血 + 溅射 + 扩散段折算）

| 列 | 旧（爆囊扩散残留） | 新（按 L 列） |
| --- | --- | --- |
| 主链 statId | `attackSpeed addRate` 0.30/0.38/0.46 | **`lifestealRate add` 0.30/0.34/0.38** |
| 溅射 `splashDamageRate` | 0.12 / 0.16 / 0.20 | **0.40 / 0.44 / 0.48** |
| 扩散段折算 | 表里没有键 | **`lifestealSpreadRate = 0.5`** |
| 子链 191702 | `damageRate 0.20/0.26/0.32` | **`damageRate addRate 0.12`**（三档同值） |
| 混搭尾 | 无 | `mix.attack.addRate 0.14` / `mix.attackRange.addRate 0.20` |
| `splashRadius` | 38 / 46 / 55 | 38 / 46 / 55（设计案未定价，沿用） |

🔴 **`lifestealRate` 没有基础值 ⇒ 只能 `add`**（`STAT_TO_PATCH` 第二槽 `null`），写 `addRate`
会乘 `baseValue(0)` 恒 0 且不报错。

🔴 **扩散段折算做在调用点，不做在全局**：

```ts
static applyLifesteal(source, hitText, context, spreadRate = 1): void {
    const ratio = this.lifestealRatioOf(source, context) * Math.max(0, Math.min(1, spreadRate));
    ...
}
private static lifestealSpreadRateOf(unit, context): number {   // 读 skillParamJson.lifestealSpreadRate
    ...缺省 1（存量吸血 100703 / 100302 都没写这个键）
}
```

传 `lifestealSpreadRateOf(...)` 的**只有两处**：弹道溅射（`resolveProjectileHit` 的 splash 分支）
与命中爆炸（凤凰降临的 burst 分支）。近战锥扫、多点打击、区域每波、主目标直击一律不传 ——
它们的每个目标都是「直击」，不是「扩散段」。做成全局乘一次会把主目标一起打五折。

### 24.3 Q3：102001 异种猎杀协议 文案「间接版本」

机制一手不动（`counterCamp4` + `mix.counterRole2` 各 15/20/25%，同时命中 ×1.15²）。
只把玩家可见 desc 从「僵尸阵营 **/** 战士职业」改成「僵尸阵营**、**战士职业」：
斜杠会被读成二选一，顿号是并列枚举 —— 既没暴露叠乘，也没把机制说错。
改的 15 格：设计案 K/L/M（3）+ `pvpSkillPlan.desc`（两份 × 3 行）+ `armySkillLevelUp.desc`（两份 × 3 行）。

### 24.4 打样一：102403 冰山陨落 → `self_aura` 车道

| 项 | 值 |
| --- | --- |
| 触发 | 主动-冷却 **14 秒**（设计案 J 列原值） |
| 车道 | `self_aura`（`castSelfAura`），冷却落 `auraReadyAt` |
| 参数 | `auraCooldown 14` / `auraSeconds 3` / `auraInterval 0.5` / `auraRadius 120` / `auraDamageRate 0.55·0.65·0.75` / `auraSlowRatio 0.5` |
| 解锁 | 9 / 18 / 27（本卡第 3 格） |
| modifierId | 94024031 ~ 94024033 |

**为什么选 `self_aura` 而不是新建「定点区域」**：
1. 设计案表现列要求「技能持续过程中需要有**明确的蓝色光圈**代表技能范围」——
   `self_aura` 的区域本身就是 `holdVisual: true` 的持续表现，光圈半径 = 判定半径（同一个 `auraRadius`），
   不需要再做一层提示圈去和判定对拍（那种「圈画得比判定大」的坑以前踩过）；
2. `auraReadyAt` ~~在 `ZC_CD_REDUCE_READY_KEYS` 里 ⇒ **102401 的冷却回退立刻生效**，这是本轮打样的目的~~；
   → 该常量已于第 10 批删除，这条理由作废。102403 自身的冷却车道仍是 `auraReadyAt`，不受影响；
3. `auraEvery` 也已存在（累计普攻口径），101604 磁电冲击在用，语义边界清楚。

🔴 **本次新开 `auraSlowRatio`**：`castSelfAura` 原来把 `slowRatio` 写死 0。
现在读参数、缺省 0 ⇒ 无尘禁土（102503）/ 喷射火焰（102603）的区域**逐字不变**。

### 24.5 打样二：102404 急冻光线 → `random_strike`（累计普攻）

| 项 | 值 |
| --- | --- |
| 触发 | 主动-累计普攻 **9 次**（设计案 J 列原值） |
| 车道 | `random_strike` 的 `strikeEvery`（与 100804 戈壁狂箭同一条路） |
| 参数 | `strikeEvery 9` / `strikeCount 3` / `strikeRadius 260` / `strikeDamageRate 0.8·0.95·1.1` / `strikeNearest 1` / `strikeAppliesStatus 1` |
| 解锁 | 12 / 24 / 36（本卡第 4 格） |
| modifierId | 94024041 ~ 94024043 |

🔴 ~~**它刻意不吃 102401 的冷却回退**：累计次数不是冷卻，这条车道没有 `*ReadyAt`。~~
→ **第 10 批后不存在「吃不吃回退」这个问题**（车道已删）。`strikeEvery` 仍是
`random_strike` 两种触发口径里没有 `*ReadyAt` 的那一种，这一点不变。

🔴 **`strikeAppliesStatus` 的状态 id 写死常量 `numb`**，不能取 `runtime.statusId`：
那是整卡共用的一个槽（`mergeSkillPlanIntoRuntime` 按 `unitId:pvpSkillId` 合并，本卡 4 条技能
全挂在 `68024:30671`），而 `hitStatusOnBeat` 对没配 `statusEveryNAttacks` 的技能恒为 true ⇒
写了它这张卡的**普攻每一发**都会挂上同一个状态。这与落雷 `ZC_BOLT_NUMB_STATUS_ID` 同一个理由：
`skillParamJson` 只有数值槽，装不下状态 id。

用 `numb`（软控：只禁攻击 + 移速 −50%）而不是 `paralysis` / `freeze`：
前者是软控，后者是硬控，冰系主动一次扫 3 个人再叠 3 秒硬控会直接改变对局节奏。

### 24.6 新增的三个键（全部缺省不生效）

| 键 | 载体 | 缺省 | 语义 | 消费点 |
| --- | --- | --- | --- | --- |
| `lifestealSpreadRate` | `skillParamJson` | `1` | 扩散段吸血折算（0.5 = 溅射只回一半） | `applyLifesteal` 第 4 参 |
| `auraSlowRatio` | `skillParamJson` | `0` | `self_aura` 区域减速比例 | `castSelfAura` 的 `slowRatio` |
| `strikeAppliesStatus` | `skillParamJson` | `0` | `random_strike` 命中是否挂 `numb` | `applyRandomStrike` 的 `options.statusId` |

### 24.7 工具链（幂等）

1. `tools/config/patch_pilot_batch9.js` —— 两份 `pvpSkillPlan.json`（101702 重建 6 行 / 102001 文案 3 行 /
   102403+102404 新增 6 行）+ 两份 `armySkillLevelUp.json`（24 行）。
   🔴 跨产物校验用**键序无关**的逐格比较，且列集合取**表头全列**：
   client 那份里没写过的列（如 `statusStatJson`）不出现在对象上，用 `Object.keys(row)` 会比出假差异。
2. `patch_magdi_skill_rows_excel.py 101702 102403 102404` + `... 191702` —— J 表 6 行原地重写 + 6 行追加。
3. `patch_passive_redesign_k.py --all` —— K 表 420 行、改 21 格。
4. `patch_skill_design2_pilot9.py` —— 设计案 25 格。

### 24.8 用例

`tests/zcds-active-pilot.test.ts` 13 条 —— 配表 6（101702 主链/参数袋/子链、两条主动的车道与解锁、
Q3 文案、K 表三条链）+ 结算 7（扩散段折算三态、`auraSlowRatio` 落进区域、累计 9 次才开火、
不挂状态、~~**打样闭环**：发一发普攻 ⇒ `auraReadyAt` 从 14.05 回退到 13.65~~）。
→ 最后那条已于第 10 批**翻成反向守卫**：「普攻命中后 `auraReadyAt` 必须仍是 14.05，且单位上
不存在 `cdReducePaidAt`」—— 车道下线后它第一个会红。

> 夹具注意：敌方单位也是 `68024` 时，`castSelfAura` 回调**必须用传进来的 `u`**。

## 25. 第 10 批：102401 换机制 + `cdReduceOnHit` 全卡下线（2026-11-17）

### 25.1 口径

> 「102401 的技能机制修改，子弹穿过己方单位会回复生命值 3/4/5% 的生命值，
>   一颗子弹最多给 3/4/5 个己方单位回复，**所有卡牌都移除普通攻击减少冷却时间的这个机制**，
>   修改后同步相关的配置，并且修改技能名字」

三件事：**换机制 + 改名**（102401）、**全卡下线一条 statId**（`cdReduceOnHit`）、**四路同步**。

### 25.2 102401：裂变共鸣 → 贯穿滋养

| 项 | 值 |
| --- | --- |
| 链 | 102401（主）/ 192401（子）· 68024 急冻瓜（金） |
| 解锁 | 3 / 10 / 22（技能 1 口径） |
| 主链 | **三空**（`statId`/`operation`/`value` 全 null）+ `behaviorKey = skill_params` |
| `allyPierceHealPct` | 0.03 / 0.04 / 0.05 —— 单次回复**被治疗单位自己最大生命**的百分比 |
| `allyPierceMaxCount` | 3 / 4 / 5 —— **每颗弹道**能治疗的己方单位数 |
| 子链 192401 | `attackSpeed` addRate 0.20 / 0.22 / 0.24 |
| 混搭尾 | `mix.attack.addRate` 0.35 + `mix.attackRange.addRate` 0.35 |
| 描述 | 普攻子弹穿过己方单位时，为其回复3%最大生命（每颗子弹最多回复3个己方单位）；攻击速度提高20%；攻击提高35%，攻击范围提高35% |

**为什么改名**：「裂变共鸣」= CD 共鸣。机制换成续航后旧名会直接误导玩家与文案，
按「只有机制完全一样的才同名、机制不同一律另名」必须另起。

### 25.3 🔴 友军通道与 `hit` 是两条互斥通道

`ZCProjectileSystem.update` 里，友军扫掠（`healAllySweep`）**先于**敌军扫掠执行，且：

| 约束 | 违反后的症状 |
| --- | --- |
| 友军不消耗 `remainingPierces` | 「路过的友军替你挡了一发穿透」—— 穿甲卡的名额被自己人吃掉 |
| 友军不改 `baseDamage`、不过 `pierceFalloff` | 衰减是「同一发打多个敌人」的补偿，友军没挨打 |
| 友军不产生 `hit` 事件、不写 `hitUnitIds` | 写进去以后真的打它会被当成「已命中」跳过 |
| 排除施法者本人（`unit.id !== sourceUnitId`） | 法师站在自己子弹起点上 ⇒ 每发白送自愈 |
| 同一颗弹道对同一单位只回一次（`allyHealIds`） | 相邻两个扫掠步会在交界处重复接触同一个单位 |
| 额度归零立刻停（`allyHealLeft`） | 「一颗子弹最多 N 个」是**每颗弹道**的额度，多弹幕各算各的 |

### 25.4 🔴 额度与比例都要在出手时拷到弹道上

`skillParamJson` 是 `unitId:pvpSkillId` **一份**。一轮齐射 3 颗若每帧回查 `allyPierceMaxCount`，
就变成「整轮齐射共享 3 次」而不是「每颗 3 次」。同理血量比例也在出手时拷进去 ——
弹道在途时施法者可能已经死了，结算不该回头查技能运行时。

所以 `ZCProjectileState` 新增三个字段（都不是可选补丁，而是弹道自己的状态）：

| 字段 | 语义 | 快照校验 |
| --- | --- | --- |
| `allyHealPct?` | 单次回复比例（`0.03` = 3%） | `nonnegative && ≤ 1` |
| `allyHealLeft?` | 这一颗还能治疗几个 | `nonnegative` |
| `allyHealIds?` | 已经被这颗治疗过的单位 id | 数组、整数、`> 0 && < nextUnitId`、无重复 |

🔴 **比例按被治疗者自己的 `maxHp` 算**（`unit.maxHp * pct`）。法师血少、前排坦克血多；
写成施法者的比例，这条被动对坦克几乎无效，恰好把「站后排把射程变成团队续航带」做反。

治疗走 `ZCStatusResolutionSystem.healUnit`：封顶 `maxHp`、死亡不生效、溢出丢弃、
不吃治疗加成、不碰护盾 —— 沿用既有口径，不新开一条治疗管线。

### 25.5 删 statId 比加 statId 更容易漏

加的时候漏一处是「静默失效」，删的时候漏一处是「编译报错」或者更坏的
「字段还在、但再没人写它」—— 后者不报错，下次有人照着旧笔记配一行会得到恒 0 的属性。

`cdReduceOnHit` 的七个载体，一个都不能留：

| # | 载体 | 内容 |
| --- | --- | --- |
| 1 | `ZCStatSchema.ts` | `ZCStatId` 联合 / `STAT_IDS` / `UNIT_STAT_IDS` / `STAT_TO_PATCH` —— **四处登记** |
| 2 | `ZCModifierRuntime.ts` | `ZCUnitStatPatch.cdReduceOnHit?: number` |
| 3 | `ZCAttackResolutionSystem.ts` | `reduceCooldownsOnHit` 方法 + 两处调用 |
| 4 | `ZCAttackResolutionSystem.ts` | `ZC_CD_REDUCE_READY_KEYS` 常量 |
| 5 | `ZCGameTypes.ts` | `ZCUnitState.cdReducePaidAt?`（同帧去重戳） |
| 6 | `ZCSnapshotCodec.ts` | 白名单里的 `'cdReducePaidAt'` |
| 7 | 两份 `pvpSkillPlan.json` | 三行的 `statId` / `operation` / `value` → null |

下线后必须补**两道守卫**，否则下次有人照着旧笔记重建时没人拦得住：

- 全表守卫：`patch_ally_pierce_batch10.js` 的 `assertLaneGone()` —— 任一行的 `statId`
  或 `skillParamJson` 里含 `cdReduceOnHit` 就 throw；
- 源码守卫：`tests/zcds-ally-pierce-heal.test.ts` 对 5 个文件 `assert.ok(!/cdReduceOnHit/)`。

### 25.6 工具链（幂等，注意顺序）

1. `tools/config/patch_ally_pierce_batch10.js` —— 两份 `pvpSkillPlan.json`（主链 3 + 子链 3）
   + 两份 `armySkillLevelUp.json`（6 行）+ 全表守卫。
2. `patch_magdi_skill_rows_excel.py 102401 192401` —— J 表 6 行、29 列逐格对拍。
3. `patch_passive_redesign_k.py --all` —— K 表 420 行、改 6 格。
4. `patch_skill_design2_pilot10.py` —— 设计案 102401 **7 格** + 第 9 页「卡牌描述与落地」68024 那句。
5. `patch_card_description.js` + `patch_card_description.py` —— **必须最后跑**：
   它们以第 9 页为上游，把描述回填进两份 `pvpCard.json` 与 `PVP-卡牌.xlsx / 卡牌配置 I 列`。
   先跑这一步会把旧文案（还带「裂变共鸣」）又抄一遍回去。

### 25.7 用例

`tests/zcds-ally-pierce-heal.test.ts` **15 条**：

- 配表 6 —— 三档参数与三空主链 / 子链攻速 / K 表六行 / 全表无 `cdReduceOnHit` /
  代码侧七处载体已拆 / 卡面描述已换；
- 结算 7 —— 额度 3 停在第 4 个 / 额度 5 全治 / 同弹道同单位只回一次 / 不吃穿透不扣伤害不出 hit /
  不配比例时友军完全透明 / 死亡友军不参与 / 快照三字段已登记；
- **全链路 2** —— `ZCGameModel` 真跑：回 3% 见血（500 → 530）、满血封顶不溢出。

顺带改：`zcds-regen-size-cd`（SKILLS 3→2、删 4 条回退用例）、
`zcds-active-pilot`（末尾闭环翻成反向守卫）、`zcds-unit-cast-action`（白名单 3→2 字段）。

## 26. 第 11 批：102503「无尘禁土」换火焰光环特效（2026-11-17）

### 26.1 口径

> 「大威天芦 的无尘禁土 使用【大威天芦_火焰光环】特效，并按照统一的格式制作预制，
>   修改同步相关的配置源表和设计案」

### 26.2 半成品资源：只有 30 张散图

美术丢进来的是 `units/projectiles/大威天芦_火焰光环/` 里的 **30 张 864×883 散图**
（`245-3-standby_loop_00/02/…/59`），**没有 prefab / anim / pac** ——
与麻辣铁锅、磁电菇、雷蕉那几批一模一样的半成品状态。

统一格式（与 `持续光环伤害效果` 逐字同构）：

```
<set>/
├── atlas/<帧>.png (+ sprite-frame meta)
├── atlas/<set>.pac (+ auto-atlas meta)
├── anim/<set>-loop.anim (+ animation-clip meta)
└── <set>.prefab (+ prefab meta)
```

生成器 = `tools/build_dawtianlu_flame_aura_fx.py`（幂等，换美术后重跑）。

三件套的三个静默坑（散图 meta 必须 `type:"sprite-frame"` + `f9941`；`pac.meta` 三处必须 `false`）
与 §14.5 同源，这里不重复。

### 26.3 这是「脚下地面环」，锚点取椭圆环的几何中心

图是三部分：**底部一圈地面椭圆环** + **环上竖起的火焰墙** + **环下溅出的火星**。

`self_aura` 的判定是**以施法者为圆心的地面圆**（102503 没配 `auraForward`，
`castSelfAura` 的 `spawnX/spawnY` 直接取本体位置）。能代表判定范围的只有那圈地面椭圆环 ——
3/4 视角下地面圆的投影是椭圆，**椭圆的几何中心就是地面圆心的投影**，把它钉到宿主原点即可。

🔴 椭圆参数**量出来，别写死**：

| 量什么 | 怎么量 | 本套结果 |
| :--- | :--- | :--- |
| 环中心 y | 「水平跨度最大的那些行」的 y 中位（椭圆最宽处就在中心高度） | 704 源 px |
| 环中心 x | 同一批行的左右缘中点中位 | 520.5 |
| 环外径 | **各帧跨度的最大值**（不是中位） | 680 源 px |

外径取最大值而不是中位：画布宽会被钉成它，取最大值才让「最满的那一帧」正好贴合判定边界；
取中位会让最满那一帧溢出约 2%。「跨度 ≥ 最大跨度 × 0.96」是为了排除火焰墙的窄跨度与火星的碎跨度。

### 26.4 🔴 画布宽 = 环外径，于是尺寸校验变成一条可读等式

    _contentSize.width(308) × _lscale(1) = 308 ≈ 307.5 屏上 px = 判定直径

判定直径 = `auraRadius 200 × 2 × 0.76875` = 307.5（§1.11 的换算）；画布取整到 308，
差的 0.5 px 就是取整误差。之所以不「紧贴内容裁切」，就是为了让这条等式成立 ——
用例直接读 prefab 验算术，不用在别处再抄一个「可见宽」魔数。
代价是环两侧各留一点透明边（环外的火星），可以忽略。

🔴 **贴图就是屏上尺寸，`_lscale` 恒为 1**（2026-11-26 改口径：原来是画布 340 × 0.904412）。
`ZCCombatEffectScale.NODE_SCALE_BY_PREFAB_PATH` 也不登记（未登记 = 宿主倍率 1）。
这条 prefab 只服务 102503，没有共用路径的问题，所以倍率一处都不该有。
**改半径就重跑生成器**（画布跟着 `JUDGE_DIAMETER_SCREEN` 一起变），
别去 prefab 里手改 `_lscale`，也别去那张表里找。

### 26.5 🔴 `_lpos` 非零的前提：宿主不能旋转

横向因为「画布宽 = 环外径」已经对称，`_lpos.x` 只剩取整误差（−0.226）；
纵向要补 —— 环中心在画布中心**下方**约 72 画布 px（火焰墙全在环上方），
`_lpos.y = +71.93` 把它补回来，让「环中心 = 节点原点 = 区域圆心 = 施法者脚点」
（缩图前是 340 画布上的 79.5 × 0.904412 ≈ 71.9，屏上位移没变）。

🔴 这成立的前提是**宿主节点不旋转**：`castSelfAura` 只有配了 `auraFaceTarget` 才写 `angleDegrees`，
102503 没配 ⇒ 宿主保持 0° ⇒ `_lpos.y` 是纯竖直位移。
**如果以后给 102503 打开 `auraFaceTarget`，这个 y 会变成垂直于朝向的侧移**（§14.6 的老坑），
届时要改成把偏移烘进子节点或走 `auraVisualLiftPx`。

### 26.6 造型没有配置列 —— 落在代码表

`self_aura` 是行为技能：全部参数压在 `pvpSkillPlan.skillParamJson`（只有数值槽），
而 `pvpSkill`（唯一带 `effectPrefabPath` 的）按 `unitId` 挂的是**普攻行**（68025 = 30858），
一行只服务一个「出手」，装不下第三条主动技能的造型。

所以这条路径只能落成代码常量：`ZCSelfAuraFx.SELF_AURA_FX_BY_UNIT['68025']`。

🔴 它必须被 `ZCVisualResourcePlan` 收进本局清单（那边按「本局有没有这个单位的 `self_aura` 计划」）。
漏收的后果是**静默**的：技能照常每秒扣血、屏幕上一次都不亮，且一条错都不报。

### 26.7 兜底光柱退场

`ZC_SELF_AURA_EFFECT_PREFAB_PATH`（`持续光环伤害效果`）现在**没有任何单位落在上面** ——
68016 / 68025 / 68026 三家各有造型。它保留作 `castSelfAura` 里
`zcSelfAuraEffectPath(...) ?? ZC_SELF_AURA_EFFECT_PREFAB_PATH` 的兜底
（`effectPrefabPath` 是 `groundZones` 必填字段，不能为 `null`）。
`ZCCombatEffectScale` 里那条 2.07 倍率也保留并加了注释 ——
万一以后有单位退回兜底，尺寸仍然对得上 200 半径。

### 26.8 工具链

1. `tools/build_dawtianlu_flame_aura_fx.py` —— 30 帧 → atlas + anim + prefab；
   源散图搬进 `tmp/projectile_src/大威天芦_火焰光环/`（`keep_all=False`，不留死资源）。
2. `ZCSelfAuraFx.ts` —— 加 `'68025'` 覆盖；`ZCCombatEffectScale.ts` —— 给老光柱那条加退场注释。
3. `tools/config/patch_skill_design2_flame_aura.py` —— 设计案 102503 两格（O 表现 + P 落地口径），
   顺手订正 P 列两处历史笔误：`auraRadius` 60 → 200、`unlockHeroLevel` 9/18/24 → 9/18/27。
4. J / K 表已核对（`patch_magdi_skill_rows_excel.py 102503` 回读通过、`patch_passive_redesign_k.py --all` 无差异）。

> 🔴 **读设计案共享字符串格要 `html.unescape`**：`t="s"` 的正文在 `sharedStrings.xml` 里，
> `"` 存成 `&quot;`。不还原的话 `'"auraRadius":60'` 永远匹配不上 —— 本轮在
> `patch_skill_design2_flame_aura.py` 里踩了一次。

### 26.9 用例

新增 `tests/zcds-dawtianlu-flame-aura.test.ts` **9 条**：
结构 3（三件套齐备 + 无残留散图 / pac 三处 false / 30 张 meta 都是 sprite-frame）、
动画 1（30 帧 / sample 12 / Loop / 2.5s / 帧引用都在图集里）、
尺寸摆位 3（`width × scale = 307.5` / `_lpos` 横向归零纵向为正 / 首帧与 `_sizeMode`）、
接线 2（三家造型互不覆盖 + 兜底仍可用 / 资源计划收进与不收进）。

改 `zcds-dawtianlu-skills.test.ts`（3 条：区域 `effectPrefabPath` / 加载清单 / 尺寸改读 prefab）、
`zcds-magdi-mushroom.test.ts` 与 `zcds-maladi-guo.test.ts`（各 1 条：68025 不再走兜底光柱）。

---

## 27. 第 12 批：主动技能「射一枚会爆的弹」（2026-11-17）

孢爆箭 101303（风炮菇）/ 孢子凝珠 101104（水手菇）—— 两条共用一套实现的冷却型远程主动。
本节只记「照设计案 P 列字面配就会静默出错」的四条，其余照着既有主动车道抄。

### 27.1 参数键必须带 `shot` 前缀

`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋（同一张卡的所有计划行共用），
而 `splashRadius` / `splashDamageRate` **普攻链路也在读**（爆囊扩散那套）。
设计案 P 列原来写的是裸 `damageRate` / `splashRadius` / `cooldown`：

> 给主动技能配 90px 溅射 ⇒ 这张卡**每次普攻**也变成 90px 溅射。**不报错**，只是数值莫名变大。

实际落地一律 `shot` 前缀：`shotCooldown` / `shotDamageRate` / `shotRadius` /
`shotSlowRatio` / `shotSlowSeconds`。用例里有一条「参数袋不许出现裸键」的全表守卫。

### 27.2 旁溅倍率不能省（省掉 = 不炸）

`resolveProjectileHit` 里那句是 `projectile.splashDamageRate ?? 1`，看着像「不给就默认 1」，
但 `strikeTargets` **只在 `splashDamageRate > 0` 时**才把它写进弹体 —— 省掉这一格，
弹体上的 `splashDamageRate` 就是 `undefined`，旁溅伤害算出来是 0：

> 箭飞过去、目标掉血、**周围一个人都不掉**，全程无报错。

设计写的是「半径内**所有**敌人造成 90%」= 与直击同额 ⇒ 显式给 1，`splashFalloff` 给 0（不递减）。

### 27.3 减速要随弹体在命中时挂

`strikeTargets` 的 `options.statusId` 原来只有**立即结算**那一路在读（`castFanSkill` / 近战）。
导弹/弹道分支一直没接 ⇒「会飞的技能挂减速」永远不生效。本批补了一行：

```ts
onHitStatusId: options.statusId,   // pushProjectile 时随弹体快照
```

`resolveProjectileHit` 早就在直击与旁溅两处读 `projectile.onHitStatusId`，只是没人喂它。
缺省 `undefined` ⇒ 存量弹道逐字不变。

### 27.4 按档位变比例的减速只能动态注册状态

`pvpStatus` 里的 `slow` 是**一张定值档**，装不下 15/20/25% 三档。沿用友军光环的做法：
按「百分点 + 秒数」拼 id（`__shotslow:15.0000:2.00__`），缺定义就 `register` 一条
`statMods: { moveSpeedPct: -15 }`、`durationSeconds: 2`。

> `moveSpeedPct` 是**百分点**口径（-15 = 移速 −15%），与 `numb` 的 `-50` 同一单位；
> 0~1 的小数会被当成 0.15% 直接忽略。

### 27.5 车道与闸门（照抄既有主动车道）

| 项 | 做法 |
| --- | --- |
| 冷却字段 | `unit.splashReadyAt`，**必须登记 `ZCSnapshotCodec` 白名单**（不还原会读档白送一发） |
| 首轮 | 首次推进只挂 CD（`now + shotCooldown`），开局不立刻放 |
| 闸门 | 到点还要过「普攻射程内有目标」；锁定目标跑出射程 **不换目标、不消费 CD** |
| 动作 | 真放出去才 `markCastAction`（不原地锁 —— 射手要边走边放） |
| 表现 | 弹体/爆点 prefab 只在代码常量里（`ZCSplashShotFx`）⇒ 必须进 `ZCVisualResourcePlan` 与预下载清单 |

### 27.6 工具链

1. `tools/config/patch_splash_shot_batch12.js` —— 两份 `pvpSkillPlan.json` 各 3 档 + 裸键守卫
2. `tools/config/patch_magdi_skill_rows_excel.py 101303 101104` —— J 表补 6 行
3. `tools/config/patch_splash_shot_k.py` —— `armySkillLevelUp.json` 两份 + K 表 B/C/K/M
   （**改写**既有行：这两条链原来是「愈合 / 寒冰箭」）
4. `tools/config/patch_skill_design2_splash_shot.py` —— 设计案 O/P/S 三格（S 改「已实现」）

### 27.7 用例

`tests/zcds-splash-shot.test.ts` **14 条**：配表 5 / 登记 2 / 发弹 3 / 触发 4。
连带修 `tests/zcds-skill-plan.test.ts` 的「到档才逐格推进」（68013 从 14 级起多出 101303 的 L1）。

---

## 28. 第 13 批：主动技能「以自身为圆心爆一次」（2026-11-17）

菌毯爆发 101504（菌壶菇 68015）/ 菌核爆裂 101804（菌王菇 68018）—— 两条共用一套实现的
冷却型自心圆爆发。与 §27 正好互补：**那个的圆心由命中点决定**（要先选中一个远处目标、
再让弹体飞过去），**这个的圆心恒等于自己**（全向、不判朝向、不需要目标）。

本节只记四条「照设计案 P 列字面配就会静默出错」的坑，其余照着 `castFanSkill` / `castSelfAura` 抄。

### 28.1 参数键必须带 `burst` 前缀

与 §27.1 同一个理由，但这次撞得更硬：**68015 这张卡的另一条技能（爆囊扩散 101501）
已经在同一个袋子（`68015:30241`）里写了 `splashRadius` / `splashDamageRate`**。

> 按设计案 P 列的裸 `radius = 150` 配下去 ⇒ 这张卡的普攻溅射半径从 38 变成 150。
> 不报错、只是普攻突然变成大范围溅射，而且**改动方根本不会去看普攻行**。

实际落地一律 `burst` 前缀：`burstCooldown` / `burstDamageRate` / `burstRadius` /
`burstShieldRatio` / `burstShieldSeconds` / `burstShieldReducePct` / `burstKnockbackCells`。
`patch_burst_batch13.js` 除了拦裸键，回读时还额外断言「101501 三档的 `splashRadius` 仍是 38/46/55」——
裸键守卫只能证明「我没写进去」，这条才能证明「我没把它带跑」。

### 28.2 「护盾期间减伤」没有现成 `pvpStatus` 档

设计案 P 列原来写「III 级减伤走 `pvpStatus` 现有 `damageReduce` 档」。**那张表里没有这一档** ——
最接近的几条 `vulnerability*` / `vuln_10` / `vuln_20` 是**反方向**（`damageTakenPct` 为正 =
受到伤害提高），照配等于「给自己上了一个易伤」。

做法与 §27.4 同源：按「百分点 + 秒数」拼 id 再注册。

```ts
import { burstGuardStatusId } from '../ZCBurstFx';
burstGuardStatusId(15, 4);   // → '__burstguard:15.0000:4.00__'
// statMods: { damageTakenPct: -15 }   ← 百分点口径，由 ZCDamageResolutionSystem 的
//                                        1 + damageTakenPct / 100 消费
```

已知取舍：减伤跟着 `burstShieldSeconds`（4 秒）走，**护盾被打破不会提前揭掉减伤**
（「护盾存在期间」在这里等价于「护盾的持续时间」）。要做到「破了就掉减伤」得在
`expireShield` 之外再加一条「护盾归零时摘状态」的钩子，收益不抵复杂度。

### 28.3 不能吃普攻射程闸门（`release`）

2026-11-11 的历史实现中，`applySplashShot` / `castSecondary` / `castSelfAura` 都先过
`context.inAttackRange?.(unit)`；2026-11-18 起已由 §13 的独立技能选敌替代。爆发车道从一开始就不使用普攻射程闸门：

> 判据变成「普攻够不够得着」⇒ 一群怪在 140px 处围着、近战战士因为普攻打不到而不放大招。
> 而 150 / 120 的爆发半径本来就大于近战普攻射程。

本批的判据改成「**爆发半径内有没有人**」，由 `castBurstSkill` 自己算：命中 0 人 ⇒ 返回 false
⇒ 触发系统不消费 CD（与「打不出去不消费 CD」这条老口径一致）。
用例里有一条 `inAttackRange: () => false` 但照样放的守卫。

### 28.4 `Area` 事件的 `radius` 不会让特效变大

`ZCCombatEffectView` 里那句注释是硬事实：**「area 类地面区域的视觉尺寸完全来自 prefab 的
烘焙缩放，视图从不按 `event.radius` 缩放」**。而 `普攻爆炸` 这一个 prefab 现在被四处共用
——普攻命中、孢爆箭的 90px 溅射、菌毯爆发的 150、菌核爆裂的 120。

⇒ 也不能给路径登记全局倍率（`NODE_SCALE_BY_PREFAB_PATH`）：那会把别人的爆炸一起放大。

本批新增**事件级** `effectScale`（`undefined ⇒ 1`，`combatEvents` 不进存档，加字段不影响兼容），
在 `ZCCombatEffectView` 里与 `nodeScale * growFactor * sizeScale` 相乘：

```ts
import { zcBurstEffectScale } from '../ZCBurstFx';
zcBurstEffectScale(150);   // → 0.818   屏上直径 300 × 0.76875 = 230.625 ÷ prefab 屏上宽 282
zcBurstEffectScale(120);   // → 0.654
```

两个常量都写在 `ZCBurstFx` 里并注明量法：
`ZC_BURST_IMPACT_PREFAB_SCREEN_WIDTH = 282`（`UITransform._contentSize.width` 141 × 根 `_lscale` 2.0）、
`ZC_BURST_SCREEN_PER_LOGIC = 0.76875`（= `combatDistanceScale` 0.3 × view/logical 2.5625）。

不这么做的后果可量化：`普攻爆炸` 原生 ≈ 半径 183 逻辑 px ⇒ 配 120 的菌核爆裂会变成
「看着半径 183、只有 120 内掉血」—— 就是项目里反复踩的「看着大、打不到」。

### 28.5 车道与闸门

| 项 | 值 |
| --- | --- |
| CD 槽位 | `unit.burstReadyAt`（两条 behaviorKey 共用一格） |
| 首次推进 | 只挂 `now + burstCooldown`，开局不立刻放 |
| 打不出去 | 不消费 CD，下帧重试 |
| 施法动作 | `markCastAction(unit, now, **false**)` —— 不 hold，战士开团要能立刻跟进走位 |
| 快照 | 必须登记 `ZCSnapshotCodec` 白名单（不还原 = 读档白送一次爆发） |
| 伤害取值 | 与扇形 / 光环一致取**一份**：暴击与克制按「离得最近的那个敌人」算一次，半径内所有人吃同一个数 |
| 护盾 | 复用 `applySelfShield`（取最大值 + 写 `shieldExpireAt`），到期由 `expireShield` 清零 |
| 击退 | 复用 `applyKnockback`：格数 × `HEX_GRID_LOGICAL_ROW_STEP`，世界换算由 `applyLegacyKnockback` 自己乘 |

### 28.6 工具链

1. `tools/config/patch_burst_batch13.js` —— 两份 `pvpSkillPlan` 各 3 行。
2. `tools/config/patch_magdi_skill_rows_excel.py 101504 101804` —— J 表补 6 行。
3. `tools/config/patch_burst_k.py` —— `armySkillLevelUp` 两份 + K 表 B/C/K/M（**改写**既有行：
   两条链原来是「天灾降临 / 蛇首狂舞」）。
4. `tools/config/patch_skill_design2_burst13.py` —— 设计案第 76 / 91 行 O + P + S 三格。

### 28.7 用例

`tests/zcds-burst-batch13.test.ts` **18 条**：配表 5（含「68015 普攻溅射未被带跑」）/
登记 3（含 `effectScale` 算法真值）/ 爆发 4 / 触发 6。

连带修 `tests/zcds-magdi-mushroom.test.ts`：用户口径「麻痹是设计上需要先删除，控制部分留在
别的系统」⇒ 原「`pvpStatus.numb` 存在且是软控」翻成「不许回来，且配表也不许再引用」
（`pvpStatus` 没定义时 `statusSystem.apply` 静默不生效，悬空引用谁都看不出来）。

## 29. 第 14 批：主动技能「近身型」两条车道（2026-11-17）

菌丝绞杀 101503（机甲菇 68015）—— `fan_slow`：身前 120° 扇形甩一次，命中的敌人减速。
菌丝突刺 101403（分裂菇 68014）—— `single_strike`：扑到最近敌人身边打一发，命中挂硬控。

两条都是「离现有的某条车道最近、但不能直接复用」的类型，§29.1~29.5 记的正是「为什么不能复用」。

### 29.1 参数键必须带 `fan` / `single` 前缀

与 §27.1 / §28.1 同一条理由，本批是**同一张卡上第三次撞车**：

> `68015:30241` 这个袋子里，到本批为止已经同时住着三条车道的参数 ——
> 101501 的 `splashRadius`（38/46/55）、101504 的 `burstRadius`（150）、101503 的 `fanRadius`（150）。
> 任一车道用裸 `radius`，另外两条会跟着一起变，且**没有任何一处会报错**。

落地键名：`fanCooldown` / `fanDamageRate` / `fanRadius` / `fanAngle` / `fanMaxTargets` /
`fanSlowRatio` / `fanSlowSeconds`；`singleCooldown` / `singleDamageRate` / `singleSearchRadius` /
`singleStopDistance` / `singleHitRadius` / `singleStunSeconds` / `singleHastePct` / `singleHasteSeconds`。

`patch_fan_single_batch14.js` 的裸键守卫扩大到 7 个（`splashRadius` / `splashDamageRate` /
`burstRadius` / `burstDamageRate` / `damageRate` / `cooldown` / `radius`），回读时**两条既有车道都断言**：
101501 仍是 38/46/55、101504 仍是 150。

### 29.2 扇形不能复用 `castFanSkill`：人数上限是设计约束

副轨那条 `castFanSkill` 是「扇形内**全打**」，半径还是「普攻射程 × `secondaryRadiusScale`」。
设计案这条写的是「半径取表值 150、最多 4/5/6 名敌人」—— 两处都对不上：

* 半径不跟普攻射程（否则战士换一把射程不同的武器，扇形大小会跟着变）；
* **人数上限必须真的截断**。150 逻辑 px 的扇形扫到十个怪时只打前 N 个，
  否则「多目标递减 / 人数上限」这两条设计约束同时失效（和 §27.2 的旁溅递减同一类问题）。

`castFanSweep` 里对此的顺序是「先按距离排序、再 `slice(0, maxTargets)`」，
伤害取值与 `castFanSkill` / `castSelfAura` 一致取**一份**：暴击与克制按扇形里最近的那个算一次，
被扫到的所有人吃同一个数。

### 29.3 朝向的兜底是 `unit.facingRadians`

扇形总要有个方向。优先「朝当前锁定目标」（`atan2(target - origin)`），没有锁定目标时退回面朝方向。
`target` 落在自己脚下（差值 < 1e-9）时也退回 `facingRadians` —— 否则 `atan2(0, 0)` 会给出 0，
变成「目标贴脸时扇形突然朝 +x」。

### 29.4 眩晕是硬控，且时长必须跟着档位走

`pvpStatus` 里现成有 `stun_1` / `stun_1_5` / `stun_2` / `stun_2s` / `stun_3` / `stun_4` 等定值档，
**不用**：值只是**这一次**巧合相同，之后改配表时长不会跟着变（与 §27.4 同一条判据）。

做法：`singleStrikeStunStatusId(seconds)` → `__stunstrike:<秒>__`，注册时带 `control: 'stun'`：

```ts
control: 'stun',   // ZCControlKind 的硬控档 ⇒ 走 ZCUnitSystem 的受控闸门整段停手
```

> 不能拿 `numb` 那类软控（`attackDisabled: 1` + `moveSpeedPct: -50`、`control` 为空）冒充：
> 软控只减移速、照常出手；且 `numb` 已按设计删除（控制能力归别的系统）。

### 29.5 攻速增益只能「命中之后」给

设计案 N 列原话是「命中后自身攻速 +30%·4s」。挂进 `self_cast`（施法即加）会变成
**空挥也涨攻速** —— 突刺在搜索半径内没目标时压根不出手，但「施法即加」的判定发生在出手之前。

在 `applySingleStrike` 里就是先 `const hits = context.strike(...)`，再 `if (hits > 0 && hastePct > 0 ...)`：

```ts
statMods: { attackIntervalPct: hastePct }   // 正值 = 间隔缩短 = 攻速提升（30 = +30%）
```

`attackIntervalPct` 是「间隔缩短」口径，消费点 `ZCGameModel:2266` 的
`base.attackInterval * (1 - pct / 100)`；写负值等于给自己减速。

### 29.6 突刺为什么整条落在触发系统（而不是攻击系统）

它要**挪人**，而 `blinkTo` 只在触发侧的上下文里接线（`ZCGameModel.buildSkillTriggerContext`）
—— 与 `applyBlinkStrike`（魔术师 103404）同侧。与 103404 的三处差别：

| 项 | `blink_strike`（103404） | `single_strike`（101403） |
| --- | --- | --- |
| 形态 | 打往返、留分身 | 单向扑过去，不回来 |
| 射程闸门 | 吃 `release` | **不吃**（意义就是「够不着才扑过去」） |
| 命中状态 | 只结算伤害 | 硬控（`control: 'stun'`） |
| 增益 | 无 | III 级命中后攻速 |

`release` 那条尤其要注意：突刺一旦被普攻射程封顶，就退化成「原地打一发」，
和它的名字与设计意图都不符。用例里有一条 `inAttackRange: () => false` 但照样扑的守卫。

### 29.7 撕裂的播放时长 = 8 帧 ÷ 12fps，不是设计案写的 0.3s

设计案 O 列写「贴目标播 0.3s」。实测 `长戟兵_撕裂` 是 8 张序列帧、`sample: 12`
⇒ 走完一遍要 **0.667s**。截到 0.3s 会把后 4 张砍掉，观感是「砍一半就消失」。

口径与五雷轰顶一致：**帧数 ÷ 采样率**，写在 `ZC_SINGLE_STRIKE_EFFECT_SECONDS` 里并加注释。

贴目标的做法：`ZCCombatEffectPlacement` 对**未登记**的 prefab 一律按 `caster` 锚点取 `fromX/fromY`
⇒ 把事件的 `fromX/fromY` 与 `toX/toY` **都写成目标坐标**，它就落在被打的那个人身上。
漏收 `ZCVisualResourcePlan` 的后果是「照常结算、屏幕上不播」，所以代码常量里的路径必须同时进
`ZCVisualResourcePlan.effects`（实战）与 `ZCGameResourcePlan` 的 warmup（预下载）。

### 29.8 车道与闸门

| 项 | `fan_slow`（101503） | `single_strike`（101403） |
| --- | --- | --- |
| CD 槽位 | `unit.fanReadyAt` | `unit.singleReadyAt` |
| 首次推进 | 只挂 `now + fanCooldown`，不开局甩 | 只挂 `now + singleCooldown`，不开局扑 |
| 普攻射程闸门 | **不吃**（判据 = 扇形半径内有没有人） | **不吃**（判据 = 搜索半径内有没有人） |
| 打不出去 | 不消费 CD，下帧重试 | 同左（`searchRadius` 内没人就等） |
| 施法动作 | `markCastAction(unit, now, false)` | 同左（人已经被挪走，不锁原地） |
| 快照 | 必须登记 `ZCSnapshotCodec` 白名单 | 同左（不还原 = 读档白送一次） |

### 29.9 用例：两处夹具坑会让用例「以假红指错方向」

`tests/zcds-fan-single-batch14.test.ts` **17 条**（配表 6 / 登记 3 / 扇形 4 / 触发 4）。

首次跑出 4 条红，全部是夹具问题、实现无误 —— 记录在此，避免下次重踩：

1. **`distanceScale` 缺省是 1，不是 0.3。** `applySingleStrike` 里是
   `context.distanceScale ?? 1`（老上下文 / 单测夹具的缺省语义是「不换算」）。
   夹具不写这一格，`singleSearchRadius: 300` 就变成「300 **世界** px 都能扑」，
   「搜索半径内没人 ⇒ 不消费 CD」那条永远测不出来（要求 90 才够不着，实际 95 也够得着）。
2. **`runtimeOf` 不能对所有单位返回同一本技能书。** 真实语义是「这个单位自己的技能配置」。
   夹具图省事写成 `runtimeOf: () => runtime`，被扑的那个敌人也会放一次突刺 ⇒
   `strike` 被调两次、落点被敌人那次覆盖，红在「到点扑一次 / 落点应为 51」上，
   看着像实现的问题。
3. 观察命中别用 `applyHitStatus`：`castFanSweep` 里是 `if (slowStatusId) context.applyHitStatus(...)`，
   不传减速 id 时它根本不会被调用 ⇒ 「扇形朝面朝方向」那条要改用 `damageUnit` 数命中。

## 30. 第 15 批：主动技能「冲锋」一条车道三条技能（2026-11-17）

菌盾冲锋 101204（菇八戒 68012）—— `charge_shield`：朝目标方向定长 1 格，撞到的敌人吃伤害，落地自护盾。
冲锋 102303（南瓜战神 68023）—— `legacy_dash`：朝最近敌人冲，路径伤害 + 眩晕，III 级落地减伤。
尖刺冲锋 102703（爆锤莲王 68027）—— `legacy_dash`：朝面朝方向冲，路径伤害 + 易伤 / 破甲，III 级落地护盾。

一条车道、两条 behaviorKey（`charge_shield` / `legacy_dash`），一套结算（`castChargeDash`），
差异全在参数 —— 与 §27（`shot` / `spore`）、§28（`burst_aura` / `burst_knockback`）同一套做法。

### 30.1 命中集合是一整条线段（点到线段的距离）

前面四批的命中集合分别是：一个点（§27 溅射）、一个圆（§28 自心爆发）、一片扇形（§29）、
一个目标（`single_strike`）。冲锋是第五种：**「起冲点 → 落点」这条线段周围 `hitRadius` 的胶囊**。

```ts
// 投影参数必须夹在 [0,1] 才是「线段」而不是「直线」
const t = clamp01(((x - ox) * spanX + (y - oy) * spanY) / spanSquared);
distance = hypot(x - (ox + spanX * t), y - (oy + spanY * t));
```

不夹 `t` 的后果很难在肉眼上发现：落点**前方**的怪也会被算成「撞到」——
它根本不在冲锋路径上，但玩家看到的是「没走过去就把人打了」。

也正因为是线段，`strikeTargets`（圆形）与 `castFanSweep`（扇形）都不能复用，
`castChargeDash` 是新写的一段（§30.6 有它和 `IZCStrikeOptions` 为什么分开接口的理由）。

### 30.2 命中 0 人也要消费 CD，落地自保也不判命中

这一条与本项目其它主动车道**刻意相反**：

| 车道 | 打不出去时 | 理由 |
| --- | --- | --- |
| 扇形 / 爆发 / 突刺 / 闪现 | 不消费 CD，下帧重试 | 「空放浪费 12 秒」，而且突刺空扑还会把人送到没目标的空地 |
| **冲锋（本批）** | **照常消费 CD** | 人已经冲出去了，位移本身不可被打断（设计案 N 列 102303 原话） |

落地自保（护盾 / 减伤）同理：设计原话是「**并**为自己附加护盾」「冲锋**结束后**自身受到伤害降低 25%」——
都是无条件生效，所以写在 `victims.length` 的判断**之外**。

例外只有一处：`legacy_dash` 的**朝最近敌人**分支（102303）在搜索半径内没人时退出、不消费 CD ——
那不是「冲了没打到」，而是「压根没有冲的目标」。朝面朝方向的分支（102703）没有这个概念，
前面是空的也照冲。

### 30.3 `damageTakenPct` 一个字段两个方向

两条 `legacy_dash` 的自保与破甲**正好反向**，而且都在 `damageTakenPct` 上：

| 技能 | 档位 | 状态 id | `statMods` | 挂给谁 |
| --- | --- | --- | --- | --- |
| 102303 冲锋 | III | `__dashguard:25.0000:3.00__` | `{ damageTakenPct: -25 }` | 自己 |
| 102703 尖刺冲锋 | II | `__dashvuln:20.0000:4.00__` | `{ damageTakenPct: +20 }` | 被打的人 |
| 102703 尖刺冲锋 | III | `__dashvuln:35.0000:6.00__` | `{ damageTakenPct: +35 }` | 被打的人 |

> 写反一处就是「自保变成自残」「破甲变成给对方上护盾」，**而且不报错**。
> 这也是为什么两条各用一个 id 前缀（`__dashguard:` / `__dashvuln:`）而不是一条共用：
> 光看数值分不出方向，只能靠名字。

眩晕不另立 id：`__stunstrike:<秒>__`（`control: 'stun'`，§29.4）与突刺共用 —— 机制完全一样，
同一件事写两个 id 只会让状态系统里多一条永远命不中的定义。

### 30.4 冲锋是「定长位移」，落点必须校验

闪现 / 突刺的落点是「贴着一个必然合法的目标」算出来的，冲锋不是：它走的是
`chargeCells` / `dashCells` 个格距，方向由目标或朝向决定 —— 站在地图边缘朝外冲就会把人送出可玩区域，
而 `movement.placeAt` **不做边界检查**（它只写 `freeX/freeY` 再同步占格索引）。

所以 `dashDestination` 沿路逐步缩短再落：

```
1 格不可站 → 0.75 → 0.5 → 0.25 → 一个都不行就不冲（不消费 CD）
```

判据来自新增的可选上下文 `hexIdAt`（`ZCGameModel` 转给 `geometry.hexIdAt`）。
缺省（单测夹具）⇒ 不校验。

「冲程为 0」（目标就贴在身上）不当作「不能冲」：线段退化成一个点，`castChargeDash` 照样按胶囊判一次，
「冲到了」这件事仍然成立（消费 CD、落地自保生效）。

朝最近敌人的那一档还要 `min(冲程, 到目标的距离)` 封顶，否则会**冲过头穿到目标背后** ——
观感是「冲过去把人甩在身后」，判定上却只打到路过那一下。

### 30.5 两个 legacy prefab 的尺寸与时长口径

| prefab | contentSize | 根 `_lscale` | 烘焙 | clip | 时长口径 | 路径倍率 |
| --- | --- | --- | --- | --- | --- | --- |
| `轻骑兵_冲锋` | 300×140 | 1 | 300 | 1 帧 loop（静态） | **设计给的 0.3s** | 0.4 |
| `刀盾兵_护盾` | 100×100 | 1 | 100 | 17 帧 loop | **17 ÷ 12 = 1.417s** | 0.55 |

两个 prefab 的**时长口径是相反的**，这是本批最容易做错的一处：

* 残影是静态单帧 ⇒ 时长由「残影留多久」决定（设计案 O 列 0.3s），按帧数算会得到 0.083s；
* 护盾是序列帧 ⇒ 必须按帧数走完（§29.7 同一条），拍一个短时长会把动画截断。

`轻骑兵_冲锋` 的倍率 0.4 是反算出来的：烘焙 300 屏上 px 是「武将技」量级（≈9 个格距），
而冲锋只走 1~2 格（32~65 屏上 px）⇒ 目标宽约 120 屏上 px ⇒ 120 ÷ 300 = 0.4。
**改 `chargeCells` / `dashCells` 时这条倍率要跟着重算。**

### 30.6 残影的锚点必须是 `midpoint`

`ZCCombatEffectPlacement` 只有两个锚点（`caster` / `midpoint`），视图**没有**「沿路径平移」这条通道
—— `ZCCombatEffectView` 每一帧只按锚点定位一次，不插值位置。

⇒ 设计案 O 列「沿朝向平移留 0.3s 残影」唯一可行的落地方式是**画在这段路的中间**：
事件的 `from` 写起冲点、`to` 写落点，把 `轻骑兵_冲锋` 登记成 `midpoint`。
只写 `from`（起冲点）的话锚点退化成一个点，观感是「原地挥了一下然后瞬移」。

登记在**路径**而不是技能 id：与 §26 / §27 同一条口径，同一个 prefab 被三条技能复用时配一次就都对。

### 30.7 车道与闸门

| 项 | `charge_shield`（101204） | `legacy_dash`（102303 / 102703） |
| --- | --- | --- |
| CD 槽位 | `unit.chargeReadyAt` | `unit.dashReadyAt`（两条共用一格：同一条车道） |
| 首次推进 | 只挂 `now + chargeCooldown` | 只挂 `now + dashCooldown` |
| 选向 | 当前锁定目标 → 面朝（兜底） | `dashTowardNearest` = 1 朝最近敌人 / 0 朝 `facingRadians` |
| 冲程 | `chargeCells`（定长） | `dashCells`，朝最近敌人时再按 `min(·, 到目标距离)` 封顶 |
| 普攻射程闸门 | **不吃** | **不吃** |
| 打不出去 | 照常消费 CD（人已冲出去） | 朝最近敌人：没人 ⇒ 不消费；朝面朝：照冲 |
| 落地自保 | 护盾（`applySelfShield`，现有光圈） | 102303 减伤（补 `刀盾兵_护盾` 表现）/ 102703 护盾（现有光圈） |
| 快照 | 必须登记 `ZCSnapshotCodec` 白名单 | 同左 |

两条都在 `markCastAction(unit, now, false)`：不 hold（人已经被挪走了）。

### 30.8 工具链

1. `tools/config/patch_charge_dash_batch15.js` —— 两份 `pvpSkillPlan` 各 3 + 3 + 3 行。
   守卫：9 个裸键（含 `lanceDamageRate` / `lancePierceCount`）/ 每条链必须带自己的 CD 键 /
   回读断言「68027 的普攻溅射仍是 38/46/55、投枪仍是每 4/3/2 次」。
2. `tools/config/patch_magdi_skill_rows_excel.py 101204 102303 102703` —— J 表补 9 行（29 列逐格对拍）。
3. `tools/config/patch_charge_dash_k.py` —— `armySkillLevelUp` 两份（name/desc/modfiy）
   + `K-卡牌升级.xlsx` 的 B/C/K/M 四列（**改写**既有占位行）。
4. `tools/config/patch_skill_design2_charge_dash15.py` —— 设计案第 61 / 115 / 135 行 O + P + S。

### 30.9 用例

`tests/zcds-charge-dash-batch15.test.ts` **17 条**：配表 6（三条技能三档 / 裸键 / 68027 两条既有车道未带跑 /
两份产物一致 / K 表）+ 登记与表现 3（双登记与加载清单 / 快照白名单 / 锚点 `midpoint` + 两个路径倍率
+ 两种时长口径）+ 线段命中 3（路上全吃 & 线外不吃 & 落点前方不吃 / 命中 0 人照样给护盾 / 伤害取一份）
+ 触发 5（首次只挂 CD 与选向 / 无目标朝面朝 & 落点非法逐步缩短 / 朝最近敌人且不冲过头 & 没人不消费 CD /
III 级减伤负值 / 尖刺冲锋面朝 & 易伤正值 & III 级护盾 & L1 照冲）。

两条夹具坑沿用 §29.9：`distanceScale` 必须显式给 0.3（缺省 1 会把 1 格放大成 3.3 格）、
`runtimeOf` 只给施法者自己的技能书。

## 31. 命中附加特效的落点：气浪居中（2026-11-18）

用户口径原文：「运动霸命中特效复用重骑兵部分的时，特效的播放位置在运动霸和受击目标的中心点
坐标位置，不再是受击目标的坐标播放特效」。

### 31.1 这不是「换个坐标」，是「这块美术的圆心该在哪」

`pvpSkill.impactEffectPrefabPath`（命中附加特效）只服务表现：主攻击事件撒完，
`ZCAttackResolutionSystem.pushImpactEffect` 在同一 `startedAt` 补一条 `area` 事件，
`damage: 0`、走地面层（`zcCombatEffectLayerOf('area') = 'ground'`），压在角色脚下。

默认落点是**受击点**，因为绝大多数命中特效是「打在身上的一记爆点」——
`雷弹命中` / `磁电菇_子弹命中` / `麻辣铁锅_爆炸龙卷` 三条都是这个语义。

运动霸是例外：它拿 `重骑兵_践踏` 当「气浪」（项目里没有名为「气浪」的美术资源），
而那块美术是**以自身为中心向外摊开的地面冲击环**，读作「双方撞在一起的那一下」。
压在敌人脚下时，观感是「气浪从敌人身体里长出来」，所以圆心要移到双方中点。

### 31.2 落点在表里：`pvpSkill.impactEffectAnchor`（2026-11-18 第二轮）

第一版把「哪块美术要居中」写成代码常量 `ZC_IMPACT_MIDPOINT_PREFAB_PATHS`，按 **prefab 路径** 认。
用户追问「美术换了会不会失效」—— 会，而且是**静默**失效（登记不到就退回受击点，不报错）。
所以这一口径整体挪进配置表：

| 列 | 值域 | 说明 |
| :--- | :--- | :--- |
| `pvpSkill.impactEffectAnchor` | 0~1，留空 = 0 | 0 = 受击点、0.5 = 攻守双方中点、1 = 出手点，中间线性插值 |

- 源表 `PVP-技能.xlsx`（技能配置）**V 列**，四行头齐全：中文名「命中附加特效落点」/ 说明 / 字段名 /
  类型 `float`。只有 `30713`（运动霸普攻）填 `0.5`；其余 77 行留空 ⇒ 存量三条爆点类特效逐字不变。
- 加列脚本 `tools/config/add_pvp_skill_anchor_column.py`（默认预演，`--apply` 才写，幂等）。
- 三写：源表 V 列 + client `pvpSkill.json`（只有 30713 那一行有这个键）+ `assets/remoteRef/pvpSkill.json`
  （列存：`k` 末尾加一列、**每行都要补一格**，否则列宽不齐）。
- 类型声明 `ref_type_all.d.ts` 由 `ref_ref_type_all_gen.py … --table pvpSkill` 重生成。
  ⚠️ 那个生成器的输出是 **LF**，会把这一个表的 CRLF 冲掉，跑完必须统一回 CRLF，否则 diff 全红。

算法仍是纯函数（`ZCImpactEffectFx.ts`，无 `cc` 依赖，用例可直接读）：

```ts
export function zcImpactEffectAnchor(ratio, fromX, fromY, toX, toY) {
    if (!ratio || ratio <= 0) return { x: toX, y: toY };            // 默认：受击点
    if (ratio >= 1) return { x: fromX, y: fromY };                   // 出手点
    return { x: toX + (fromX - toX) * ratio, y: toY + (fromY - toY) * ratio };
}
```

- **线性插值，不是手调系数**：`0.5` 就是中点，`0.25` 就是「从受击点往出手点方向走 1/4」。
  解析层 `ZCPvpTableParser.parseImpactAnchor` 把越界值**直接抛错** —— 传 1.7 会让气浪落到出手点外侧，
  看着像「打空了旁边还有个环」，而表里只错一格、画面上要盯半天才发现。
- 两点重合时（贴脸、目标被推到同格）插值自然退化成那个点，不需要额外分支。
- `pushImpactEffect` 里 `fromX/fromY` **仍然给同一个坐标**：`area` 事件是原地播，
  起终点不同会让 `ZCCombatEffectFlight` 把它当成「有飞行段的特效」算朝向和时长。

### 31.3 为什么落在技能行，不落在代码里

- **换美术不再失效**（本次追问的触发点）：口径跟着**技能行**走 —— `重骑兵_践踏` 被替换、改名、
  甚至换成真正的爆点画，这一格都不动，行为不会悄悄退回受击点。
- **换落点也不用发版**：`0.5 → 0.35` 改一格，下次导表生效。
- 不按 `unitId`：`50035`（怪物卡运动霸）用的是另一条技能行（`30667`）且根本没配命中特效，
  按单位写死 `68033` 会让人误以为「怪物卡运动霸也居中」——它连这个特效都不播。
- 代价是「表里多一格没人读也不会报错」，所以用例反向钉死两条：全表只有 `30713` 非 0；
  且这一行必须同时有 `impactEffectPrefabPath`（否则比例永远没人读）。

### 31.4 只有落点变了，其余字段一个没动

| 字段 | 值 | 说明 |
| :--- | :--- | :--- |
| `type` | `area` | 只有 `area` 落地面层 |
| `damage` | `0` | 纯表现，伤害已由主事件结算 |
| `radius` | `1` | 不参与判定 |
| `durationSeconds` | `0.35` | 与近战主特效的 0.3s 对齐，余 0.05s 给冲击环 |
| `startedAt` | 与主事件同一帧 | 「命中」和「气浪」才是同一拍 |
| `from` / `to` | **落点（中点或受击点）** | 本次唯一改动 |

冲刺撞停的那条路（`ZCUnitSystem.updateDash` → `placeAt(hit.x, hit.y)`）出手点就是**接触点**，
所以中点落「运动霸贴上去之后与目标之间」的那一小段；站立近战（没进冲刺距离）出手点在原地，
中点就是双方之间明显的一段。两种情形都符合「撞在一起」的读法，不需要分成两套。

### 31.5 同轮附带：50017 机甲菇的 prefab 路径

怪物卡 `50017` 的 `unitPrefabPath` 一直是 `units/阿尔萨斯/阿尔萨斯`，而那个目录**早已删除**。
运行时不会报错：单位照常出生、照常结算，只是**画面上什么都没有**。
2026-11-18 一并修正为 `skel/机甲菇/机甲菇`（与同名玩家卡 `68015` 一致），
攻击动画时长 1.1s / 命中时点 0.44s 不变（同一副骨架，上一轮就是按它借的值）。

- 工具：`tools/config/fix_monster_prefab_50017.py`（默认预演，`--apply` 才写；幂等）。
- 三写：源表 `PVP-怪物卡牌.xlsx` 的 `AF23` / client `monsterCard.json` / `assets/remoteRef/monsterCard.json`。
- 守卫：`tests/card-unit-preview-assets.test.ts` 现在把怪物卡也一起扫 ——
  35 张兵种卡的 prefab 必须存在且带 `idle`，并单独钉住 `50017 === 'skel/机甲菇/机甲菇'`。

### 31.6 用例

`tests/zcds-impact-effect-anchor.test.ts` **7 条**：默认（0 / 留空 / `undefined`）= 受击点 /
0.5 = 双方中点 + 其余比例插值（含斜向、1/4、1 = 出手点、贴脸退化）/ 绕过解析层的越界也不出屏 /
配表 `30713 = 0.5` 且全表只有它非 0（两份产物都查）/ 加列脚本与列值不许漂移 /
解析层越界抛错 / 源码守卫（`pushImpactEffect` 必须走 `zcImpactEffectAnchor`，比例取自 `profile.impactEffectAnchor`）。

`tests/zcds-charge.test.ts`：气浪落在**双方中点**（夹具 `source x=0` / `target x=12` ⇒ `x=6`，
用例里显式给 `impactEffectAnchor: 0.5`）/ 没配落点的爆点类仍贴受击点 /
解析层把 `0.5` 读进档案、`1.5` 抛错。

## 32. 雷电系受击爆点缩到 50%：68016 / 68022 / 68008（2026-11-20）

用户口径原文：「68016 和 68022 使用了磁电菇-子弹命中特效的预制，统一都改小成 50%，
现在的受击效果太大了」。

### 32.1 先纠一处名字：这两张卡现在播的不是 `磁电菇_子弹命中`

- 两张卡共用普攻行 `pvpSkill 30231「雷法师普攻」`（`pvpCard.unitSkillId = 30231`，全表只有它俩）；
- 11-06 雷电系换皮（`tools/config/patch_leidan_art.js`）已把这条的
  `impactEffectPrefabPath` 从 `磁电菇_子弹命中` 换成 `雷弹命中`；
- `磁电菇_子弹命中` 现在只挂在 `30717 杰克藕普攻` 上。

所以「这两张卡的受击」= `units/projectiles/雷弹命中/雷弹命中`。倍率挂在名字像的那份上
就是典型的**静默无效**：改了、画面一点没变。

### 32.2 只挂倍率，不动 prefab

命中爆点是 `area` 事件：`ZCAttackResolutionSystem.pushImpactEffect` 补一条 `damage: 0`
的地面层事件，视觉尺寸 100% 来自 prefab 烘焙值，视图**不按** `event.radius` 缩放。
所以「缩到 N%」只能走宿主倍率（与椰蛋暴风 0.7 / 轻骑兵冲锋 0.4 同一口径）：

| 项 | 值 |
| :--- | :--- |
| prefab 本体烘焙 `_lscale` | 0.7（不动） |
| 目录 `nodeScale` | **0.5**（新增） |
| 屏上终值 | 0.35（与同批弹体的 0.35 一致） |

登记位置：`ZCEffectCatalog` → `ZC_EFFECT_PATHS.thunderBulletImpact` + `ZC_EFFECT_SPECS`
里一条 `nodeScale: 0.5` 的条目；视图侧不用改，`ZCCombatEffectView` 早就在乘
`zcCombatEffectNodeScaleOf(event.effectPrefabPath)`。

判定一行都没动：本行 `areaRadius` 是 0，这条爆点纯表现。

### 32.3 同轮修掉一条假红

`tests/zcds-effect-catalog-parity.test.ts` 的「② 尺寸逐键 parity」从 11-19 第二轮起一直红：
那时把 `雷弹攻击` 的宿主从 0.5 收到 0.35（去拖尾配套），但 `tests/fixtures/zc-effect-catalog-baseline.json`
没跟着改。本轮把基线补成 0.35（新增的 `雷弹命中` 记 0.5），该用例转绿 ——
基线是「有意改动必须同步登记」的快照，改动本身是生效的，只是没人更新它。

### 32.4 杰克藕（30717）那份也一起缩（同轮追问）

用户追加：「杰克藕（30717）那份 `磁电菇_子弹命中` 也缩」。

它是**另一份美术、另一个键**，只有 `68008 杰克藕` 用（`pvpCard.unitSkillId = 30717`，全表唯一）：

| prefab | 使用者 | 本体烘焙 | `nodeScale` | 屏上终值 |
| :--- | :--- | ---: | ---: | ---: |
| `雷弹命中`（`thunderBulletImpact`） | 68016 磁电菇 / 68022 雷蕉 | 0.7 | 0.5 | 0.35 |
| `磁电菇_子弹命中`（`cidianBulletImpact`） | 68008 杰克藕 | 1 | —（已删） | **1**（贴图即屏上尺寸，见下） |

两条倍率同为 0.5，但烘焙基准不同 ⇒ **屏上不是一个尺寸**（0.35 vs 0.2）。这是「各自按自己原大小的
50%」的结果，不是漏改；要「两条一样大」得另给一个数，不能靠合并键。

🔴 别把两个键合成一个：它们是两份独立 prefab（不同帧序、不同色相），合并后只要有一条换美术，
另一条会被连带改尺寸。

📌 **2026-11-26 图集治理（`磁电菇_子弹命中`，屏幕尺寸不变）**：旧链路是「prefab 烘焙 0.4 × 目录 `nodeScale` 0.5 = 屏上 0.2」，
画布 458×495 里可见内容只有 308×401（x 75–383 / y 38–439），其余是空白。
现在把两层倍率全部去掉、尺寸烘进贴图：裁可见并集 → 重烘 **62×80**（= 308×401 × 0.2），
`_lscale = 1`、`_contentSize = 62×80`、`_lpos.y = 1.8`（补回内容中心原本比节点原点高 9 画布 px × 0.2 = 1.8 屏上 px 的偏移）。
9 帧 PNG 1003 KB → 82 KB，纹理像素 2.04 M → 0.045 M（−98%），PAC 单页装得下。

### 32.5 用例

`tests/zcds-thunder-hit-fx-scale.test.ts` **4 条**：
68016/68022 的倍率 0.5 × 烘焙 0.7 = 屏上 0.35（目录与 facade 两个入口都查）/
两份 `pvpSkill` 的 30231 命中都指向该路径且 `pvpCard` 里只有 68016 / 68022 用 30231 /
杰克藕那份两层倍率都归 1、贴图 62×80 即屏上尺寸（不再乘 0.5 × 0.4）且两份美术烘焙值必然不同 /
30717 只挂在杰克藕（68008）上且两份产物都指向 `磁电菇_子弹命中`。

改过口径的三条既有断言：`zcds-magician-skills`（原来拿 `雷弹命中` 当「未登记=1」的例子）、
`zcds-missile-trail`（原断言「命中不被弹体倍率连带 ⇒ 1」）、`zcds-effect-path-parity`
（语义键快照补 `thunderBulletImpact` + `cidianBulletImpact`）。

## 33. 三叶小丑飓风「从本体飞到目标」：移速口径 + 10% 起长（2026-11-20）

用户口径原文：「三叶小丑的【飓风技能】没有从卡牌本体移动到目标的过程（按设计案的规划执行），
是因为移动速度太小了吗？如果是，改成和卡牌的移速一样，初始生成的大小只有 10%，
随着移动过程逐渐成长」。

### 33.1 「看着没动」有两层原因，移速小只是第二层

| 层 | 现象 | 数据 |
| :--- | :--- | :--- |
| ① 根本没有赶路段 | `castStorm` 只在 `context.unitPosition(unit)` 建区域，`x/y = 本体脚下` 后就交给随机游走 | 无 `approachSpeed` / `approachTargetId` |
| ② 游走速度小到看不出 | 配表 `stormWanderSpeed: 10` 是**表值 px/s**，经 `× combatDistanceScale (0.3)` 只剩 **3 世界 px/s ≈ 屏上 2.3 px/s** | 一张卡面移速 28 的怪，风比它慢 **9.3 倍** |

🔴 所以「把 `stormWanderSpeed` 从 10 改大」解决不了问题：方向仍然是随机的，不是「飞向目标」。
真正的修法是补一条**投送段**（追踪式直飞），落点用现成的 `approachSpeed` 两档机制。

### 33.2 移速取哪一格：卡牌面板移速，**不再乘** `combatDistanceScale`

`pvpCard.68020.unitMoveSpeed = 28`，而 `ZCMovementSystem.speedOf` 里是
`effectiveDefinition(unit).moveSpeed * … * dt` —— 这一格本来就是**世界 px/s**。
`castStorm` 里其余表值（`stormRadius` / `stormWanderSpeed` / `stormPull*`）要乘 0.3，
唯独移速不能，乘了就是每秒 8.4px 的蜗牛。🧨 这是本批最容易写错的一格：
同一个函数里两种口径并排放着，`scale` 一顺手就乘上去了。

### 33.3 三个口径对照

| 项 | 老 | 新 |
| :--- | :--- | :--- |
| 出生点 | 本体脚下 | 本体脚下（不变） |
| 投送 | 无 | `approachSpeed = 28`（面板移速，世界 px/s）飞向 `currentTarget` |
| 赶路期读秒 | 立刻开始 | **不读**（`isApproaching` 为真），落地那一刻按已耗时**一次性扣减** |
| 总寿命 | 活满 N 秒 | **含赶路共 N 秒**（`stormSeconds` = 6/7/8 是总账，见 §33.7） |
| 到达后 | 原地随机游走 | 交还随机游走（`arriveWander` + `releaseToWander`） |
| 入场大小 | 0 → 100%（`growSeconds: 0.2`） | **10% → 100%**（`growFrom: 0.1`，`growSeconds` = 直线赶路耗时） |
| 无活目标 / 在打墙 | 原地生成 | 原地生成 + 老出场口径（不追墙、不追建筑）；**2026-11-20 起空场已被 `applyStorm` 的射程闸门拦下**，见 §13.3 |

### 33.4 🔴 到点必须显式「下车」，否则是一片永不消散也不打人的风

`ZCGroundZoneSystem.advanceChase` 的入口判据是 `approachSpeed > 0`，一旦成立就**恒**
`return true` ⇒ 调用方的 `advanceWander` 与 `moveVelocity` 位移这一段永远轮不上。于是：

- `sprintSpeed` 配 0 ⇒ 飞到目标后**定在半空**；
- 配正数 ⇒ 一直朝最后一帧的方向冲出去；
- 更糟的是 `isApproaching` 也为真 ⇒ **不读秒、不结算波次** ⇒ 寿命永不归零。

四件事一起做才叫「落地」，`releaseToWander` 一次做完：
①按已耗时扣寿命并重算波数（§33.7）；②清 `approachSpeed / approachTargetId / sprintSpeed`；
③走一次 `enterSprint`（`sprinting = true` + **`nextWaveAt` 重置到此刻**）；④清旧速度。
🔴 重置 `nextWaveAt` 不能省：赶路期攒着的 `nextWaveAt` 还停在施法那一刻，不重置的话落地第一帧的
`while (now >= nextWaveAt)` 会把「本该打、但没打」的那几波**一口气全打出来**（用例
`落地那一拍只补当前一波` 就钉这一条）。目标半路死光走同一条出口（否则风会按 `sprintSpeed: 0` 定住）。

### 33.5 「初始 10%」必须新增一格起点占比

`zcCombatEffectGrowFactor` 的曲线是 `1-(1-t)²`，`t = 0` 时系数是 **0** —— 它只能表达
「从看不见长到满」。所以加第三参 `growFrom`（0~1，缺省 0），合成
`growFrom + (1-growFrom) × ease(t)`：

```ts
zcCombatEffectGrowFactor(growSeconds, ageSeconds, growFrom)
```

- 缺省 `undefined` ⇒ 当 0，**存量特效（从 0 长起来 / 压根不生长）逐字不变**；
- 🔴 `growSeconds` 非法时**一律返回 1**（满尺寸），不返回 `growFrom`：宁可「没有入场动画」，
  也不能让一格写歪的配表把整片飓风永久钉在 10%（那画面等于技能没放出来）。
- 链路：`ZCGroundZoneState.growFrom` → `syncHoldVisual` 抄进 `area` 事件 →
  `ZCCombatEffectView.growFactorOf` 传给纯函数。`combatEvents` 不进存档，但**区域进**，
  所以 `growFrom` 要在 `ZCSnapshotCodec` 登记（`growSeconds` 一直没登记：纯时长、写宽了只是快慢）。

### 33.6 到达容差 = 风半径的 1/4

`sprintRange = radius × 0.25`：本卡 90 表值 × `combatDistanceScale` 0.3 = 27 世界 px 的风半径
⇒ 容差 **6.75 世界 px**（用例夹具 `combatDistanceScale = 1`，所以断言里读到的是 22.5）。
两条极端都试过、都不行：

- 取 0 ⇒ **永远差半步**：`advanceChase` 每步都 `step = min(speed*dt, distance)` clamp 到
  「当时的目标点」，而目标每帧还在走（28 px/s × 16.7ms ≈ 0.5px/帧）；
- 取整个半径 ⇒ 目标本来就站在风圈里，赶路段被整段跳过，用户还是看不到飞行。

### 33.7 总时长口径：落地时按已耗时扣减（用户 2026-11-20 追加）

> 「落地时按已耗时扣减」

`remainingSeconds` 在赶路期不读秒（`isApproaching` 为真），所以账必须落地那一刻一次结清。
新增一格 `approachSeconds`：`advanceChase` 每帧 `+= dt`（只累计**真在追**的帧），
`releaseToWander` 里 `remainingSeconds -= approachSeconds`。

🔴 **`wavesLeft` 必须跟着重算**：它是照整段 N 秒算的（8s ÷ 0.5s = **16 波**），不重算就会把
16 波塞进剩下的几秒里 —— 表现为「落地后每 0.17 秒打一下」。重算口径与施放时一致：
`max(0, round(remaining / waveInterval))`。

🔴 **兜底闸**：`approachSeconds >= remainingSeconds`（赶路已经耗尽整段寿命）⇒ 当场
`releaseToWander`，扣完即散场。不设这道闸，「目标一直在跑、永远追不上」会让这片风
**永远在飞、永远不读秒**（一片不散场也不打人的风）；设了之后它的表现是
「追不上就在寿命用尽时落地消失」，至少是可控的。

实测（用例夹具，8 秒 / 每 0.5 秒一跳）：目标 100 世界 px、边飞边被牵引 ⇒ 落地耗时 **1.0s**，
剩余寿命 **6.9s**（8 − 1.0 − 本帧 0.1），`wavesLeft` 从 16 重算成 14、落地这一拍补 1 波后剩 13。
``remainingSeconds + elapsedSeconds ≈ N`` 就是这条口径的不变量。

`approachSeconds` 进快照（`nonnegative`）：不还原的话读档回来会白多活一整段赶路。

### 33.8 用例

`tests/zcds-remnant-batch17.test.ts` **+8 条**：

1. 出生在本体脚下、`approachSpeed = 28`、`growFrom = 0.1`、`growSeconds = (100 − 22.5) / 28`；
   1 秒走 28 世界 px、沿直线、**赶路期一波不打也一秒不掉寿命**；到点后
   `approachSpeed / approachTargetId / sprintSpeed` 全清、`sprinting` 保留；
2. 落地那一拍只补当前 1 波（不是攒下的那几波）+ 寿命按总账扣 + `wavesLeft` 按剩余时间重算；
3. 追不上的目标不能把风变成永动机（2000 世界 px 外 ⇒ 8 秒内落地散场、一下没打到）；
4. 兜底（直接调 `castStorm`、绕过闸门时）：无活目标 / 射程内没敌人 ⇒ 原地生成 +
   `growFrom` 缺省 + `growSeconds: 0.2` + 不累计 `approachSeconds`；
5. 快照白名单三条（`arriveWander` / `growFrom` / `approachSeconds`）；
6. **闸门放行但这一拍还没锁定**（`currentTarget` 给 `null`）⇒ 自己按普攻射程挑最近的活敌送出去，
   射程外的不追（2026-11-20 用户实测那条的回归）；
7. **锁定的是墙** ⇒ 照样飞向射程内的敌人，不飞到墙根定住；
8. 触发三拍：挂 CD / `release` 为假 ⇒ 待触发 / **`release` 为真但最近敌人还在射程外（只在打墙）
   ⇒ 仍待触发不消费 CD** / 敌人进射程当帧补放。

`tests/zcds-yedan-skills.test.ts` 扩 8 条断言（`growFactor` 的 `growFrom` 分支 + 区域不再写这一格
时视图按 0 处理）。既有两条 102004 用例**一条都没改**：它们的夹具 `currentTarget` 恒 `null`
⇒ 走「无活目标」分支，行为与改动前逐字一致。

### 33.9 已知遗留

目标移速 ≥ 风的移速且一直后退时，`advanceChase` 永远追不上 ⇒ 风一路飞、一下都不打，
**到寿命用尽时落地散场**（§33.7 的兜底闸兜住了「永不消散」）。这条对 103405 鹿神守护
仍然成立（同一套机制，它没有兜底闸也不会扣寿命）。本卡实际很少遇到：三叶小丑射程
300 表值 = **90 世界 px**，`currentTarget` 多在这个圈里，而敌人是朝本体走的。

> 2026-11-20 二次收敛（用户实测「改成等目标之后，飓风又不会移动了」）：原来那段
> 「`release` 为真但本帧还没锁定 ⇒ 原地生成」不是理论边角，而是**常态** —— 闸门恰好在
> 「敌人刚进圈的第一帧」放行，而 `targetUnitId` 要等这一拍的攻击流程跑完才写。修法两条：
> ① `castStorm` 在锁定目标不是活单位时，按**同一套射程**再扫一次最近的活敌
> （`stormDeliveryTarget`），扫不到才原地；② `applyStorm` 加第二道闸「最近敌人 ≤ 普攻射程」，
> 把「只是在打墙」从「有目标」里剔掉。用例见 §33.8 的 6~8 条。

### 33.10 追踪弹的目标生命周期（2026-11-20 第 31 批）

用户口径原话：「锁定类的子弹技能逻辑应该是，锁定目标，移动，目标丢失，切换目标，
没有目标继续往旧的目标坐标移动，不会静止」。

四段各自落在哪：

| 阶段 | 实现 | 关键点 |
| :--- | :--- | :--- |
| 锁定目标 | `approachTargetId` + 每帧 `context.unitPosition(target)` 求方向 | 每帧重算方向，不锁死出生朝向 |
| 移动 | `advanceChase` 慢档 `approachSpeed` / 快档 `sprintSpeed` | 慢档不读秒、不结算波次 |
| 目标丢失 → 切换 | `nearestChaseTarget`（`unitsInRadius` 粗筛，半径 `max(sprintRange, ZONE_RETARGET_RANGE)`） | 按**区域当前位置**找最近的活敌，不是按出生点 |
| 没有目标 → 旧坐标 | 新增 `chaseGoalX / chaseGoalY`（**最后已知目标坐标**） | 朝它继续飞，飞到了才按车道收尾 |

🔴 三处必须钉住，少一条就退化成「静止」：

1. **`chaseGoalX/Y` 每帧刷新**（目标活着的每一帧）。只在施法那一刻记一次不够 ——
   目标边跑边记，最后一段才是它真正的去向。
2. **速度兜底不能是 0**：老代码在没有目标的分支里取 `sprintSpeed ?? 0`，
   而飓风的投送段只有 `approachSpeed`、没有 `sprintSpeed` ⇒ 整片风定在原地。
   现在快档速度一律 `sprintSpeed || slowSpeed`，慢档本来就是「赶路速度」。
3. **飞到了才收尾**：`arriveWander`（飓风）在旧坐标才 `releaseToWander`（顺带清
   `chaseGoalX/Y`，否则游走接管后会被重新拽回去）；其余车道沿同方向继续飞到寿命结束。

区分点（改之前 vs 之后）：改之前「无目标」= 沿**旧速度方向**飞，且速度可能为 0；
改之后 = 朝**最后已知坐标**飞，速度恒 > 0。坐标为 `undefined`（出生就没锁定过目标）时
才退回「沿旧速度方向」，与存量行为逐字一致。

### 33.11 游走走 S 型（2026-11-20 用户口径）

原话：「飓风类技能的移动是要类似 S 型的行走方式，不要固定的直线（除了有明确标识不能移动的飓风）」。

**改的是什么**：`advanceWander` 原来每 `wanderTurnSeconds` 把朝向**整段重掷**成
`random × 2π` —— 那是折线，运气不好还会原地掉头。现在改成**连续转向 + 按段翻号**：

```
首帧：角度 = random × 2π，转向率 = (π/3) / wanderTurnSeconds   （这一拍不积分）
之后：角度 += 转向率 × dt；每到 nextTurnAt 就把转向率取反
```

一左一右、幅值不变 ⇒ 画出来是蛇形（S）。`ZC_ZONE_WANDER_SWING_RADIANS = π/3`：
60°/段（配表 1 秒）＝ 60°/秒。太小（< 20°）还是像直线，太大（> 90°）会绕圈走不出位移。

🔴 两个不动点：

- **`wanderSpeed = 0` 的区域一步都不挪**（第一行就 `return`）—— 这就是用户说的
  「有明确标识不能移动的飓风」。
- **首帧只定方向、不积分旋转**：初始朝向仍是 `random × 2π` 那一格，存量用例按角度
  断言过这一拍，行为逐字不变。

`wanderTurnRate` 进快照（按 `Number.isFinite` 校，**可负**，不能用 `nonnegative`）。

### 33.12 分裂菇分身「先特效、后出现」（2026-11-20 第 33 批）

用户三条原话：

1. 「分身生成坐标落，落在以本体为圆心，20px 为半径的圆内」；
2. 「每个分身生成有 0.1s 的间隔差」；
3. 「分身时，在分身坐标先播放【分裂菇_生成分身】，再出现分裂菇分身，分裂菇的分身透明度约为 65%」。

**这是一次「出生时刻」的改动，不是纯表现。** 原来 6 只分身在同一拍 `spawnUnit`、
坐标都取本体脚下（`placeSummon` 在 `follow=false` 分支就是 `placeAt(origin)`）；
现在第 i 只在 `t + i × 0.1s` 播特效、`t + i × 0.1s + 0.32s` 才真正出生。

落地口径（`ZCGameModel`）：

| 常量 | 值 | 管什么 |
| :-- | :-- | :-- |
| `SUMMON_SCATTER_RADIUS` | 20 逻辑 px（≈15.4 屏上 px） | 落点半径；与舞王阵位 18 同量级 |
| `SUMMON_STAGGER_SECONDS` | 0.1 | 第 i 只的 `fxAtSeconds` 间隔 |
| `SUMMON_APPEAR_DELAY_SECONDS` | 0.32 | 特效起播 → `spawnUnit` |
| `ZC_SUMMON_SPAWN_FX_SECONDS` | 26/24 ≈ 1.0833 | 特效事件寿命，**必须等于 clip `_duration`** |
| `SUMMON_INDEPENDENT_ALPHA` | 0.65 | 配表 `summonAlpha` 没填时的兜底（只兜独立分身） |

🔴 四个不能改回去的点：

1. **不能「先召出来再隐藏」**：隐藏的单位仍是合法目标 —— 会被看不见的东西挨打、
   也会自己往敌人方向走开，等到该出现时已经不在那个坐标上了。所以推迟的是
   `spawnUnit`，队列（`state.pendingSummons`）里存「出生需要的一切」。
2. **队列必须进快照**：这 0.6~0.9s 是真状态，读档 / 重连丢掉队列 = 白丢 6 只分身
   （累计普攻的次数已经消费掉了）。`ZCSnapshotCodec` 有 6 条断言守着（见用例）。
3. **排队中的份也算 12 只名额**：只数 `state.units` 会让 0.6s 内的第二次召唤看见
   「场上 0 只」再召一批，实际会冒出 15 只。
4. **角度按序号均分、只用随机量做抖动**：6 只若都听同一颗随机数，某些种子下会
   **叠在同一个点**上（看起来只召出 1 只）。半径仍按 `sqrt(random)` 铺满圆面。

特效资源：美术交付的 26 张散帧已齐全（`01_06` 于 2026-11-26 补回；原始画布 1185×1185，
裁剪框从 171 长到 912）。2026-11-26 按屏上尺寸重烘为 **156×156**：最大那帧屏上
120×116 px，prefab `_lscale` = 1、`UITransform` = 156×156，目录里没有 `nodeScale`
—— 尺寸全在贴图里，不再靠缩放凑。
prefab / anim 由 `tools/build_fission_spawn_fx.py` 生成，三条硬要求：
`_sizeMode=0`（CUSTOM，序列帧尺寸不跟着 frame 变）、`_isTrimmedMode=false`
（每帧按整张画布画进同一个 contentSize，帧间不抽动）、`wrapMode=1`（一次性，不循环）。
clip 的 `_duration` 按 26 拍排（1.0833 = 26/24），26 帧每拍一格。
路径登记在 `ZC_EFFECT_PATHS.fissionSpawn` + 行为键 `summon_unit`（**不标 `warmup`**：
没有分裂菇的对局不该下这 26 张散图）。

用例：`tests/zcds-split-shroom-summon.test.ts` §七（5 条）。

## 34. 召唤的三个口径：投掷段换皮 / 本体必须实心 / 舞王脚底纯表现光环（2026-11-20）

用户口径原文：「毒箭菇的蘑菇爆炸，丢技能的这段特效使用的应该是陷阱生成，而不是普攻的子弹」/
「分裂菇和艺术家释放分身技能，只有分身有透明度，本体是 100% 实心的，透明度是用来区分本体和分身作用」/
「艺术家释放分身时，在本体的脚底没有同步播放【持续光环伤害效果】预制体特效，改特效的范围需要囊括本体和 4 个分身」/
纠错一句：「现在是本体跟着变透了」。

### 34.1 陷阱投掷：飞行段恒定播「陷阱生成」

| 段 | 播什么 | 由谁决定 |
| :--- | :--- | :--- |
| 飞行（抛物线途中） | **陷阱生成**（`科学家_陷阱_出现`） | `flightVisualPath` —— 恒定值 |
| 落地常驻 | 陷阱 `idle` | `effectPrefabPath`，`ZCGroundZoneSystem.settleFlight` 换挡 |
| 到期炸开 | 普攻爆炸 / 陷阱爆炸 | `zcTrapExpirePath(unitId)`（按单位登记，见 §33 那批） |

🔴 **不要**写成「有配弹体就用弹体」：`profile.effectPrefabPath` 是**普攻**那一格，
换一张卡就跟着换皮，同一技能在不同卡上长得不一样。飞行段的判据只能是
`flying ? ZC_TRAP_SPAWN_PREFAB_PATH : undefined`。

### 34.2 「本体变透明」是两个独立的错叠在一起

只修一处，看着还是透 —— 两个都要动。

**① 判据认身份，不认数值袋的键。** 透明度是「本体 / 分身」的身份标记，
`summonAlpha` 只是数值袋里的一个键：被拷到别的行、读档串了，本体就跟着变透，**零报错**。

```ts
//  ZCUnitView.render
this.applySummonAlpha(unit.summonMasterId === undefined ? undefined : unit.summonAlpha);
```

**② 绘制顺序：召唤物排在普通单位之下。** 本体 100% 实心、4 个舞伴各 60%，
只要复制品画在本体**上面**，视觉结果就是「本体也透」（一层 60% 的膜盖在脸上）。
`ZCGameRenderWorld.applyUnitDrawOrder` 用 `summonEntityIds` 把召唤物插到第一个普通单位之前，
本体回最上层；`removeEntity` / `unitViews.clear()` 两处要同步 `delete` / `clear`。

**③ 池复用必须清缓存。** `UIOpacity` 挂在节点上、写入缓存挂组件上，
两样都不随 `active = false` 复位 ⇒ `resetForReuse` 里 `appliedSummonAlpha = -1`，
否则上一个舞伴淡到一半回池，下一个普通单位一出生就凭空半透明。

**④ 阵位半径 60 → 120（表值）。** 60 只投到 46.1 屏上 px，本体美术约 69 高 ⇒
4 个舞伴全压在本体身上（这也是「看着像本体变透」的共犯）；120 = 92.25 屏上 px 才真的散开。

### 34.3 脚底光环：借 `holdVisual + followUnitId`，四个伤害口子全关

口径：**纯表现、无伤害**，范围囊括本体 + 4 个分身。
不要新开「挂在单位身上的循环特效」——那要自己管生命周期，而单位会回池、会阵亡。

| 口子 | 写法 | 少关的后果 |
| :--- | :--- | :--- |
| 波次结算 | `wavesLeft = 0` | 每个 `waveInterval` 打一次，看不见的 DoT |
| 踩踏判定 | **不写** `contactRadius` | 走进去就挨打 |
| 到期爆炸 | `expireDamage: 0` + **不写** `expirePrefabPath` | 消失那一刻炸一下 |
| 摩擦 / 减速 | `damage: 0`、`slowRatio: 0` | 站在里面持续掉血 / 被拖慢 |

- 寿命与召唤同源（`summonSeconds` 6/7/8）；配 0（到战死）时
  `SUMMON_AURA_FALLBACK_SECONDS = 6` 兜底 —— 无限期区域会一直躺在 `groundZones` 里读秒；
- **只在这一次真的召出来（含排队份）才建**：被 12 只上限拒放的那次不留空光环；
- 独立分身（`101404`）三档都没 `summonAuraRadius` ⇒ 这段一次都不进。

**尺寸对账（屏上 = 表值 × 0.76875 = 0.3 × 2.5625）：**

> ⚠️ 这张表在 2026-11-20 第 35 批被实测修正过。原来按「画布宽 307.5 = 环宽」算，
> 得出「200 与画面同一圈」，实际差 1.77 倍 —— **画布大半是空的，那圈可见环只占 153/256**。

| 量 | 表值 / 来源 | 屏上 |
| :--- | :--- | :--- |
> 📌 2026-11-26：这张贴图已**裁掉空边并按屏上尺寸重烘**成 `215×90`，prefab 两级 `_lscale`
> 与目录 `nodeScale` 全部归一为 1（原 `offset 0.58` + `2.0716` 两级硬编码已删除）。
> 下表「表值」一列因此改成贴图像素 —— 缩放链已经不存在。

| 量 | 表值 / 来源 | 屏上 |
| :--- | :--- | :--- |
| 画布 | `215 × 90` texel px（缩放 1） | 215 × 90 |
| **可见环** | 184×72 texel px（缩放 1） | **183.8 × 72.1**（半轴 91.9 × 36.0） |
| 判定半径 | `summonAuraRadius` 200 | 153.75 |
| 阵位半径 | `summonSlotRadius` 120 | 92.25 |
| 舞伴**屏幕**站位（斜角位 × 投影 2.5625 / 2.1429） | 世界 36 px | **(±65.2, ±54.6)** |

🔴 **舞伴不在圆周上，别按 92.25 算包围**：四个斜角位 + 横纵投影不同 ⇒ 屏幕上是 (±65, ±55)，
加上卡面半宽 ~17 需要环半径至少 (82, 72)。横向 91.9 本来就够，**卡的是纵向 36.0**：
这张盘画得比镜头扁 2 倍（美术 0.39 / 投影 0.836）。

⇒ 这条车道用事件级 `effectScale = ZC_SUMMON_AURA_COVER_SCALE = 1.99`
（= 71.6 ÷ 36.0），把环放到 **365.7 × 143.4 屏上 px**，4 个舞伴 + 本体全进圈；
代价是纹理放大 2.5× 略软、横向多出一倍（用户 2026-11-20 拍的板）。

🔴 **不要为了「放大光环」去改公用的贴图 / prefab 尺寸**：`68021`(102104) / `68024`(102403) 的
`self_aura` 也在用这份 prefab，它们的 `auraRadius 120`（判定 184.5）与 184 这一档正好匹配，
改公用尺寸会把这俩一起放大。要改大小就走 `effectScale`。
`effectScale` 已进快照（`ZCSnapshotCodec` 校验 `> 0`）⇒ 读档不会缩回去。

🔴 **`area` 类区域的视觉尺寸不按 `event.radius` 缩放**，只认 `effectScale`
（`ZCCombatEffectView` 里 `uniformScale = nodeScale × growFactor × sizeScale × eventScale`）。
2026-11-26 起这条目录条目**不再登记 `nodeScale`**（贴图即屏上尺寸：画布 215×90、环 184×72），
**改大小之前先量 alpha>60 的实际环宽**，别按画布宽反推。

资源登记：`summon_unit` 行为组要**单独再收一次** `sustainedAura`。
`self_aura` 那份覆盖管不到 `summon_unit`（`zcEffectPathsForBehavior` 只按本组给清单），
漏收的表现是「结算正常、画面全无」。

用例：`zcds-king-dance.test.ts` 27 条（含新增「只有分身带透明度：本体 100% 实心」
与「脚底持续光环：跟着本体走、跟舞伴同寿命、一点伤害都不打」、以及 §34.4 的 7 条拴绳 / 追击）、
`zcds-trap-flight.test.ts` 17 条、`zcds-split-shroom-summon.test.ts` 17 条。

### 34.4 舞伴要在光环里自己走过去打（2026-11-21 第 36 批）

**病灶**：34.2 把 `summonSlotRadius` 60→120（世界 36）之后，`syncSummons` 仍每帧把坐标
**钉死在阵位**上，而舞伴射程只有 `(45 + 12) × 0.3 = 17.1` 世界 px
⇒ 离任何目标都永远 ≥ 18.9，一帧都进不了射程。用户实测：「分身会在特效范围内移动和攻击，
现在不会攻击了」。

**修法**：新增 `ZCUnitState.summonLeashRadius`（世界 px），并改三处语义：

| 位置 | 新语义 |
| :--- | :--- |
| `summonUnits` | 有光环才写拴绳；**没配光环不写** ⇒ 逐字保持第 17 批的「钉死阵位」 |
| `ZCUnitSystem` 召唤物短路 | 射程内 ⇒ 出手；射程外且有拴绳 ⇒ `advanceTowardPoint` 直线追一步；否则站住 |
| `ZCGameModel.leashSummon` | 只在这只**出圈**时 `placeAt` 到**边界** |

> ⚠️ **拴绳的长度口径在 2026-11-22 第 41 批被整条换掉**：第 36 批写的是
> 「`summonAuraRadius` × `combatDistanceScale`（表 200 ⇒ 60）＝一个圆」，那是**判定半径**；
> 而玩家看到的圈是美术画的扁盘，纵向只有横向的一半 ⇒ 舞伴往上下追时会走出画面（§34.6）。
> 现在拴绳是**椭圆**，由可见环反推：横向 `summonLeashRadius ≈ 71.4`、纵向
> `summonLeashRadiusY ≈ 33.5`。**别再按判定半径写拴绳**。

🔴 **不要放开正常寻路**：`advanceUnitMovement` 按格推 `progress`，和拴绳的自由坐标每帧互相
覆盖 ⇒ 观感原地抽筋（第 17 批注释里记过）。圈只有一两格大，直线够。
🔴 **拉边界，不拉阵位**：目标通常在圈边外一点，拽回阵位 = 「走一步退十步」。
🔴 **不许再兜 `max(拴绳, 阵位半径)`**（第 41 批删掉）：圈就是画面上那圈光，阵位比圈大
就该被拉进圈。兜上去等于「阵位在圈外时允许出圈」，正是这次 bug 的帮凶。
🔴 **阵位退化成「出生位置」**：配了拴绳就不再按阵位重摆 ⇒ 本体转身，圈内的舞伴不跟着转。
阵位旋转与「圈内自由移动」互斥，这是有意的取舍。

快照：`summonLeashRadius` 已进 `ZC_SNAPSHOT_UNIT_FIELDS`（漏了 = 读档后舞伴又钉死、又不攻击）。
用例：`zcds-king-dance.test.ts` 27 条，核心闸是「舞伴真的能打到站在本体旁边的敌人」
（`completedAttackCount > 0` **且**敌人真的掉血 —— 只断言 `battleState === 'attack'` 不够，
`startAttack` 只切状态，结算要等 `attackHitTime`）。

---

### 34.5 两类召唤物的四条差异（2026-11-22 澄清，第 39 批）

用户口径：「艺术家的召唤分身**也会受到伤害**，只是**不计入场上的单位数量限制**，对比分裂菇的
分身多了个**存在时间的硬限制**和**移动距离限制**」。

四条**在代码里本来就分别成立**，只是散在四处、没人一起钉住 ⇒ 容易被后来者「顺手统一」成另一套：

| | 艺术家 68031「舞王召唤」103103（跟随型） | 分裂菇 68014「一人成军」101404（独立分身） |
| :--- | :--- | :--- |
| 挨打 | **会**：`state.units` 里的普通成员，索敌 / 结算 / 飘字一条不少 | 会 |
| 占 `unitCapPerSide` | **不占**：`markSummon` 把注册时先记的那一格还回去 | 不占 |
| 存在时间 | **硬限制** `summonUntil = now + summonSeconds`（6/7/8）⇒ 到点 `dead` + 同帧摘掉 | 无（`summonSeconds` 不配 ⇒ 到战死） |
| 移动距离 | **拴绳**（椭圆）：横 `summonLeashRadius ≈ 71.4` / 纵 `summonLeashRadiusY ≈ 33.5` 世界 px，由**画面上那圈光的半轴**反推（§34.6），出圈才拉回边界 | 无（自由寻路） |
| 本体阵亡 | 跟着一起散（`syncSummons` 里本体没了就收场） | 不散（只有血量归零才消失） |

🔴 探针实测（`tmp/probe_artist_summon.ts`，兵种 27 级）：`count` 1→1、`countAll` 1→5；
敌方 AI 锁的就是最近的那个舞伴并扣血（1200→1186）；`summonUntil` 到点后场上分身归零；
手动把舞伴丢到远处会被拉回拴绳边界。（拴绳长度口径第 41 批已改为椭圆，见 §34.6。）
🔴 用例：`tests/zcds-king-dance.test.ts` 新增三条（名额 / 挨打 / 到期）⇒ 27 → 30 条。
🔴 别把「移动距离」再写一个新参数：它和脚底光环**看得见的那圈**是**同一个圈**（§34.6），
不是判定半径 —— 两处各算一遍迟早漂。

**已知副作用（2026-11-22 实测；需求方当天确认「两个副作用都是合理的」⇒ 正式口径，不是待办）**

| 项 | 实测 | 结论 |
| :--- | :--- | :--- |
| 击杀赏金 | 打死一只分身 = `killUnitGoldReward`（pvpGlobal = **1**）金币，与普通单位同价 ⇒ 一批 4 只 = 4 金币 | 与「任何敌方单位被击杀都有赏金」一致；CD 12s > 存活 6~8s，一分钟上限约 20 金币，不构成刷金 |
| 击杀数 | `sender.killCount += 1`（`ZCDamageResolutionSystem`）⇒ 团队增伤的「击杀延长」也吃这一格 | 同口径，不特殊化 |
| `countAll` | 生产代码**零消费点**（只有用例读它）⇒ 没有任何 UI / 统计数字会因分身而变 | 无需处理 |

🔴 上面三条都是**有意保留**：分身是场上的普通单位，打死它给赏金 / 记击杀数 / 进总数都是「它真的存在」
的一部分。要改先回到需求方，别在代码里单方面给召唤物开小灶。
🔴 夹具坑：手动构造 `ZCDamageSource` 时 `unitId` 是**单位实例 id（数字）**，不是兵种 id 字符串 ——
传 `'68028'` 时 `context.units.byId.get()` 查不到出手者，**击杀数静默不记、金币照发**，
用例会红在「击杀数 undefined」上，而错的地方在夹具。
🔴 用例：`zcds-king-dance` 再补一条「分身阵亡按普通单位结算」⇒ 31 条。

### 34.6 拴绳改成椭圆：圈就是画面上那圈光（2026-11-22 第 41 批）

用户反馈：「现在艺术家的分身会走出领域特效的范围，重新检查下原因」。

**根因不是拴绳失效，是拴绳量错了对象。** 第 36 批把拴绳写成
`summonAuraRadius × combatDistanceScale`（表 200 × 0.3 = **60**），那是**判定半径**；
但玩家眼里的圈是美术画的扁盘 —— 它比镜头扁约 2 倍（美术 0.39 / 投影 0.836）。
把可见环（屏上 183.8 × 72.1，半轴 91.9 × 36.0，§34.3 实测）按各向异性投影**反推回世界坐标**：

| 方向 | 换算式 | 世界半轴 |
| :--- | :--- | :--- |
| 横向 | `91.9 × 1.99 / 2.5625` | **71.37** |
| 纵向 | `36.05 × 1.99 / 2.1429` | **33.48** |

⇒ 横向 60 < 71.4（偏保守、没露馅），**纵向 60 > 33.5（超了 1.79 倍）**。舞伴往上下追目标时
必然跑出画面，横着追却看着正常 —— 正好对上「只有上下方向明显出圈」的观感。

**修法**（四处；两个新字段全部进快照）：

| 位置 | 改动 |
| :--- | :--- |
| `ZCGameTypes` | 新增 `summonLeashRadiusY?: number`（纵向半轴；**缺省 undefined ⇒ 当圆**，老快照照常读） |
| `ZCGameModel` | 新增 `zcSummonAuraLeashHalfWorld(effectScale)`：可见环半轴 ÷ 各向异性 ⇒ `{x, y}`；`summonUnits` 里两个半轴一起写；`pushSummonAuraZone` 与拴绳**共用同一个** `auraCoverScale`（只算一次） |
| `ZCGameModel.leashSummon` | 改成椭圆归一化：`norm = √((dx/rx)² + (dy/ry)²) > 1` ⇒ `placeAt(origin + d / norm)` |
| `ZCSnapshotCodec` | 白名单补 `summonLeashRadiusY`（漏了 = 读档后纵向又变 60、继续出圈） |

🔴 **必须删掉 `max(拴绳, 阵位半径)` 兜底**（第 36 批留的）：阵位半径 36 世界 px 落在椭圆纵向
33.5 之外 ⇒ 兜一下就把 `ry` 撑到 84.85，等于「允许出圈两倍半」。圈就是画面上那圈光，
阵位比圈大就该被拉进圈 —— 这也是为什么第 36 批的兜底在这里反而是 bug 的一部分。
🔴 **别去改 `effectScale` 遮这个洞**：光环放大是靠 1.99 把圈撑到装得下 4 个阵位（§34.3 用户拍板），
改它等于动整套站位；而且判定半径与可见环**本来就是两回事**，随它一起漂会更乱。
🔴 **两个半轴必须同源**：`effectScale` 和拴绳都吃 `auraCoverScale` 这一个值。分开算的话，
将来调光环大小，拴绳不会跟着变 —— 又是同一类静默错位。

探针 `tmp/probe_artist_leash.ts`（`combatDistanceScale = 0.3`，`effectScale = 1.99`）：

```
世界半轴 = 71.37 × 33.48        屏上半轴 = 182.9 × 71.7（与 §34.3 实测一致）
拴绳 = 71.37 × 33.48            阵位半径 = 36
追 3 秒后四个舞伴归一化最远 = 1.002   ✅ 全在光圈内
```

用例：`zcds-king-dance` 31 → **32** 条，闸门是「拴绳 = 画面上那圈光环的椭圆半轴
（横 ≈71 / 纵 ≈33，纵向必须 < 横向）」+「纵向到 ≈33 就被挡住、横向还能走到 60 以外」。

## 35. 自护盾的表现：参数袋车道也要有造型（2026-11-21 第 37 批）

「亡者护盾」（巨力坚果 68002 / 100204）走的是**参数袋车道**（`behaviorKey = skill_params`，
`triggerEvent = active`）：只带 `{selfShieldRatio, shieldSeconds}` 两个数，既没有
`pvpSkill.effectPrefabPath`，`empoweredSkillId` 30803 也只是个空 profile。

数值一直是对的（`applySelfShield` 写 `shield` + `shieldExpireAt`），缺的纯粹是表现 ⇒
玩家看到「凭空变硬」。本批把三层补齐：

| 层 | 写法 |
| :--- | :--- |
| 事件 | `ZCAttackResolutionSystem.pushSelfShieldVisual`：`Melee` 事件、`radius/damage = 0`、`from == to == 本体坐标`、`effectPrefabPath = ZC_DASH_GUARD_PREFAB_PATH` |
| 时长 | **`ZC_DASH_GUARD_SECONDS`（17 帧 @12fps ≈ 1.417s）**，不是 `shieldSeconds` |
| 资源 | `ZC_EFFECT_BEHAVIOR_SPECS` 里给 `skill_params` 补 `unitPrefabPaths: { '68002': [dashGuard] }` |

🔴 **时长不能拍 `shieldSeconds`**：这张 prefab 是 loop 序列帧，事件又**不跟随单位** ⇒
拍 10~12 秒就是「一圈盾在原地反复亮，本体已经走到对面了」。拍太短（0.3s 兜底）则动画截断。
🔴 **资源必须按单位覆盖，不能进 `prefabPaths`**：`skill_params` 被十几种卡的被动共用，
写进公共清单等于给所有卡预载一张护盾。
🔴 **预热 ≠ 本局清单**：`charge_shield` / `legacy_dash` 两组已让这张 prefab 进了
`zcWarmupEffectPaths()`（下载 / 解析），缺的一直是 `ZCGameLoader.effects` 那份
`buildZCVisualResourcePlan` 结果 —— 「预热有、实战没有」就是它漏收的样子。

夹具两个坑（`tests/zcds-nut-shield.test.ts`）：`shield` 解码后是 **0 不是 undefined**（判上盾只能看
表现事件）；敌人会还手的话护盾到手那刻就被啃掉几十点（把 `nextAttackAt` 推远才钉得死数值）。

## 36. 群体自身施法的护盾表现：`self_cast` 车道按单位补造型（2026-11-21 第 38 批）

波利奥 68006「吃口菠萝」100603 走的是另一条「只带数据、不带造型」的车道 —— **`self_cast`**
（`ZCSkillTriggerSystem.applySelfCast`）。它的三档全是**群体治疗**：

```
selfCastCooldown 10 / selfCastHealPct 8·10·15 / selfCastAllyRadius 252 / selfCastAllyHealPct 4·5·8
III 级再加 selfCastCleanse 1
```

🔴 这一行**一个护盾参数都没有**。所以本批不是「补数值」，而是按用户裁定
「**保留治疗，只补表现**」+「**自己 + 友军都播**」，在同一处推纯表现事件。

| 层 | 写法 |
| :--- | :--- |
| 事件 | `applySelfCast` 的朋友军治疗段之后：`selfCastAllyRadius > 0` ⇒ 遍历「自己 + 圈内同阵营活着的」，各推一条 |
| 推送函数 | `ZCDashFx.pushDashGuardVisualEvent`（第 38 批从第 37 批那份抽出，两个调用点共用字段口径） |
| 时长 | `ZC_DASH_GUARD_SECONDS`（17 帧 @12fps ≈ 1.417s），不是技能 CD 也不是 `selfCastSeconds` |
| 坐标 | 各目标自己的 `freeX / freeY`；拿不到有限值就不推（NaN 事件会挂在 (0,0) 或干脆不建节点） |
| 资源 | 新增行为键 `self_cast`，`unitPrefabPaths: { '68006': [dashGuard] }` |

🔴 **判据是「群体」而不是单位 id**：`selfCastAllyRadius > 0`。同车道的嗜血 100703 / 迅击 100903
都是纯自身增益、没有这一列 ⇒ 天然不播，不需要再写一份白名单。
🔴 **不看 `allyHealPct`**：这一圈盾表达的是「这是一次群体施法」，不是「回了多少血」；
`allyHealPct = 0` 的将来如果出现，盾照样该在。
🔴 **资源仍按单位覆盖**：同车道的另两张卡不该被连带预载一张护盾，所以 `prefabPaths` 保持空。
🔴 **治疗口径一个字没动**：自己吃 `selfCastHealPct`、友军吃 `selfCastAllyHealPct`，两段不重叠；
「多了一圆盾」≠「多回一次血」。

🔴 同一条车道的 **III 级净化**也已对齐 desc（2026-11-22 第 40 批）：`selfCastCleanse` 解的是
`selfCastAllyRadius` 圈内的**友军**（每人各 N 个，不含自己），不再是施法者自己 —— 见设计案「二十一」。

用例（`tests/zcds-poliao-shield.test.ts`，9 → 11 条）：三档参数 + **「没有护盾参数」反向守卫** /
同车道另两张卡无群体半径 / 自己+圈内友军各一条且圈外·尸体·敌人不播 / 钉在各自脚下·纯表现·17 帧 /
一个 CD 只推一轮 / 没群体半径一条都不推 / 资源清单 68006 收 68007 不收 / 预热仍在 /
整局接线（参数袋真的挂在普攻运行时上）。

## 37. 首目标重击 + 落点圆：`quake*` 三个键与 `anchor: 'target'`（2026-11-23 第 42 批）

仙桃行者 68009「大地之力」100904 的新口径（用户原话）：

> 「第一个被攻击的目标受到 300%/370%/450% 的伤害，并在该目标位置播放【仙桃行者_重击技能】特效，
> 特效落点的圆圈内所有敌人受到第一个目标一致的伤害，其他的效果保持不变」

外加一条同桌需求：

> 「所有使用了【重骑兵_武将技能的】统一更换为【仙桃行者_重击技能】特效，
> 并且该特效的释放一定是在目标的坐标位置播放」

### 37.1 为什么不复用 `impactBurst*`（凤凰降临那套）

| | 凤凰降临 `impactBurst*` | 本次 `quake*` |
| :--- | :--- | :--- |
| 圆心 | 命中点 | 命中点（同） |
| 打不打主目标 | **含**主目标，各再打一次 | **不含**首目标，它只是「改成高倍率」 |
| 倍率来源 | 独立的 `impactBurstDamageRate` | `quakeFirstRate` 替代 `baseDamage`，其余穿透目标不变 |
| 段数 | 两段（`impactBurstSecond*` 第 26 帧） | 一段 |

两者在「打不打主目标」上正好相反 ⇒ 共用一套键一定错一边。所以另开三个键：

```
quakeFirstRate   3 / 3.7 / 4.5      首目标倍率（相对面板，不含克制）
quakeRadius      54                 落点圆半径（逻辑 px，与 attackRange 同一套数）
quakeEffectSeconds 固定 29/24       只控制表现长度，**不读配表**
```

### 37.2 四个「照字面配就会静默出错」的点

🔴 **1. 三个键只在 `empowered` 时读。** 计划行按 `${unitId}:${pvpSkillId}` 合并成一袋
（100904 的 `pvpSkillId` 就是普攻行 30718），不设闸门 = 这张卡**每一次普攻**都变成 300%。
与 `pierceCount` 是同一个坑。

🔴 **2. 「第一个被攻击的目标」的判据是 `hitUnitIds` 为空，不是自己再记一个计数器。**
`ZCProjectileSystem` 是**先** `context.hit()`、**后**把 id 记进 `hitUnitIds`（穿透时），
所以命中那一拍它还停在上一发的结果上、首击时是空数组。
再补一道 `target.kind === 'unit'`：墙体 / 建筑不记 id，否则「先蹭到一段城墙」会把首目标那份让给墙。

🔴 **3. 落点圆里不含首目标。** 它刚吃完 300% 的直击，再进一次圆就是 600%。

🔴 **4. 存进弹道的必须是**不含克制**的基数。** 克制系数逐个受击者算（`projectileCounterMultiplier`），
带首目标的克制关系去炸别人就会算错 —— 与 `baseDamage` / `splashDamage` 同一条口径。
「一致的伤害」= 同一个倍率来源，不是无视克制照抄一个数字（否则被克制的敌人反而更痛）。

### 37.3 表现：`anchor: 'target'` 这个新锚点

`ZCEffectAnchor` 原来只有 `'caster' | 'midpoint'`。本批加 `'target'`：

```ts
if (anchor === 'target') return { x: span.toX, y: span.toY };
```

近战 / 参数袋事件的 `from` 是施法者、`to` 才是目标，默认 `caster` 会把整根柱子砸在自己头上。

- 目录条目：`ZC_EFFECT_SPECS` 里 `quakeStrike` 登记 `anchor: 'target'` + `layer: 'top'`。
  `top` 必须显式写 —— 它是「打在空中的一下」，而 `area` 事件类型默认会被压回地面层。
- **不写 `nodeScale`、prefab 也不留缩放**：尺寸已经烘进画布（144×321，`_lscale` 全是 1），
  `offset._lpos.y 116.92` 只负责把画布里的裂纹环对到脚下；目录再写一次倍率就是两个真源。
- 仙桃行者自己那条链**不走锚点**：`pushQuakeStrikeVisualEvent` 直接推一条 `from == to == 落点`
  的纯表现事件（`radius` / `damage` 都是 0），不依赖事件类型；两条路都指向同一个坐标。

### 37.4 名单覆盖：武将技行自带的美术默认是**不播的**

2026-11-19 定案 A 规定「强化那一击一律借普攻行的 prefab」，
所以只改 `pvpSkill` 36241 的 `effectPrefabPath` —— **游戏里什么都看不到**（改了没效果）。

```ts
export const ZC_EMPOWERED_FX_OVERRIDES: Readonly<Record<number, string>> = {
    36241: ZC_QUAKE_STRIKE_PREFAB_PATH,
};
```

🔴 名单制，不是「有配就用」：`pvpSkill` 全表 36xxx 行都自带美术，放开就是回退到定案 A 之前。
🔴 名单那一份**不吃 ×1.2**：它与仙桃行者自己那根柱子是同一个 prefab，两处出现必须一样大。
🔴 事件寿命取 `max(travelSeconds, ZC_QUAKE_STRIKE_SECONDS)` —— `ZCGameModel` 按
`startedAt + durationSeconds` 摘事件，短一截就是「砸到一半没了」（同 §14.5）。

### 37.5 美术 ↔ 判定圆必须同一份数

散图 32 张 1065×2372（41/42/43 全透明）取 29 帧，1.2083s 一次性演出。
`245_03` 帧的地面裂纹环最宽 616 源 px、质心 y ≈ 2050/2372 ⇒ 画布缩到 144×321（`_lscale` 1）、
`_lpos.y 116.92`。落下结果是：**画面裂纹环直径 ≈ 83 屏上 px ↔ 判定圆 54×0.3×2.5625×2 ≈ 83**。

🔴 这是「先定美术、再反推数值」的顺序，与 §34.6（舞伴拴绳拿判定半径 60 去套可见环、
差 1.79 倍）正好相反。改画布尺寸必须同步改 `skillParamJson.quakeRadius`（以及
`tools/build_xiantao_quake_fx.py` 的 `CANVAS_W/CANVAS_H`），否则「看着没打到却掉血」。

### 37.6 用例

`tests/zcds-xiantao-quake.test.ts`（15 条）：两份产物的配表真值（`remoteRef` + `client`）/
三档 desc 同时改两处 / `36241` 换图且全表再无【重骑兵_武将技能】/ 资源清单按单位收 /
`target` 锚点与 `top` 层、目录不写 `nodeScale` / 名单覆盖只认 36241 / 快照白名单 /
出手三个键与「非强化不带」/ 首目标 300%、圆内旁人同额、圆外不打、自己人不打、不重复打首目标 /
第二个穿透目标仍 120% / 先蹭到城墙不算首击 / 没配 `quakeFirstRate` 的旧弹道逐字不变 / facade 坐标与时长。

配套改动：`tests/zcds-model.test.ts` 的「定案 A」用例加了名单例外守卫
（名单内必须用它自己的图且不叠 ×1.2、名单外一律不许），
`tests/zcds-effect-catalog-parity.test.ts` 加了「迁移后增量清单」
（基线 JSON 保持冻结，新登记走 `POST_MIGRATION_PATHS`）。

### 37.7 追加（同日）：普攻也要有造型 —— 借用「旧值 长枪兵普攻_刀光」

> 「仙桃行者，普通攻击也要播放 长枪兵的武将技能特效」
> 30 分钟后用户纠正：「搞错了，应该使用的是 旧值 长枪兵普攻_刀光」

**① 落地的值是刀光，不是枪阵。**

改法极简：`pvpSkill 30718 仙桃行者普攻` 的 `effectPrefabPath` 从空改成
`units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光`（三写：`PVP-技能.xlsx` 行 64 / `remoteRef/pvpSkill.json` / `client/pvpSkill.json`）。

⚠️ 这一列中途曾经填成过 `长枪兵_武将技能`（地面枪阵那份），已回退。`tools/config/patch_xiantao_spear_fx.js`
的 `PREVIOUS_FX` 常量允许从那个误配值改回来，重跑是幂等的。

**② 刀光**不登记**目录 —— 锚点 / 层 / 尺寸 / 寿命全走兜底。**

| 维度 | 刀光 | 兜底值从哪来 |
| :--- | :--- | :--- |
| 锚点 | `caster` | 贴在本体出手点的一下挥击，不是砸在目标脚下的地面技 |
| 层 | `top` | `melee` 事件类型 ⇒ `zcCombatEffectLayerOf` 默认置顶 |
| 尺寸 | `1` | prefab 根 `_lscale = 1`，64×42 |
| 寿命 | `defaultAttackTravelSeconds`（0.32s） | 未登记 ⇒ `zcEffectDurationOf` 返回 0 ⇒ `max(travel, 0) = travel` |

🔴 这一组值**恰好就是长枪兵行 30171 自己的播法** —— 同一份美术、同一个 prefab，两张卡要长得一样，
唯一的办法是两边都别在目录里给它第二套参数。谁把刀光塞进 `ZC_EFFECT_SPECS` 去「顺手调一下」，
画面就会和长枪兵分家。用例 `②-3` 的标题就是这条纪律。

🔴 刀光 clip 是 12fps / 0.667s，**故意不抬事件寿命**。长枪兵原版同样被 0.32s 截断，
用户要的就是那截「旧值观感」；抬上去反而让两张卡不一致。

**③ `durationSeconds`（寿命下限）这个能力保留，但只给重击柱用。**

本批给 `IZCEffectSpec` 加的 `durationSeconds` 是为 29 帧的重击柱准备的：

```ts
const eventSeconds = Math.max(travelSeconds, zcEffectDurationOf(fxPrefabPath));
```

重击柱登记了 `ZC_EFFECT_TUNING.quakeStrikeSeconds`（29/24 ≈ 1.208s），
`ZCGameModel` 每步按 `startedAt + durationSeconds` 压缩过期事件 ⇒ 不抬就是「砸到一半没了」。
未登记的路径该函数返回 `0`，存量逐字不变 —— 刀光走的就是这一档。

**④ 名单的第三种状态：`null` = 明确不播（口径不变）。**

定案 A 让强化那一击借普攻行的 prefab。普攻行一旦有了图，68009 的强化那一击
（`30844` 是 **projectile**）就会拖着一把刀光飞过去，落点再砸一根重击柱。

刀光比枪阵轻得多，但**这不是放它过去的理由**：形态换了（近战 → 弹道）就不该继承挥击贴图。
`ZC_EMPOWERED_FX_OVERRIDES` 的值类型仍是 `string | null`：

| 值 | 语义 |
| :--- | :--- |
| `string` | 强化那一击播这一份（`36241` → 重击柱） |
| `null` | 强化那一击**不带贴图**（`30844`；表现由落点重击柱负责） |
| 键不存在（`undefined`） | 没登记 ⇒ 照旧借普攻行（定案 A 默认） |

🔴 **`null` 与 `undefined` 必须分开**：`override ?? profile.effectPrefabPath` 这一写法会把
「不播」吞成「借普攻行」，bug 就静默回来了。正确写法是
`override === undefined ? profile.effectPrefabPath : override`，`zcEmpoweredFxOverrideOf`
的返回类型也随之变成 `string | null | undefined`。
🔴 用例按三态分别断言（`zcds-model` 的「定案 A」），不是只测一种。

## 38. 表里的头像列可以填直路径（2026-11-23）

> 用户原话：「美术换了新头像，但代码还没切直路径」。

现场是**两个**问题叠在一起，只解决一个都不算完：

| # | 问题 | 表现 |
| :-- | :--- | :--- |
| ① | 代码只认 `icon.json` 的 **key**（`兵种_头像_*` / `图标_头像_*`），美术把 `monsterCard.headIcon` 整列写成了直路径 | `IconArtResolver.resolve()` 落空 ⇒ `loadIconByKey` 返回 null ⇒ **头像整片退占位图，一条错都不报** |
| ② | 美术写的目录是 `icons/head` | 那是**玩家头像特写 128×128**；卡面 / 传说卡横幅的立绘要的是 `icons/cardHead` 的**全身图 256×256** |

### 38.1 代码：key 优先，落空再按路径拆

真源 `HeadArtModel.iconArtTargetOfPath`，接线在 `createIconArtResolver.resolve`：

```ts
resolve: (iconKey) => targets.get(iconKey) ?? iconArtTargetOfPath(iconKey)
```

认三种写法（都能带 `/spriteFrame` 尾巴，会剥掉）：

| 写法 | 拆出来的 `root` / `art` |
| :--- | :--- |
| `icons/cardHead/wandouyouxia` | `icons/cardHead` / `wandouyouxia` |
| `icons/head/icon_hero_head_40018/spriteFrame` | `icons/head` / `icon_hero_head_40018` |
| `ui://图标_兵种_头像/wandouyouxia`（老端包名） | `icons/cardHead` / `wandouyouxia`（经 `ICON_PACKAGE_ART_ROOT` 换目录） |

- 🔴 **目录走白名单**（`ICON_ART_ROOTS` = 两个头像目录 + `ICON_PACKAGE_ART_ROOT` 的全部目的）：
  配错列（`skel/豌豆射手/...`、`units/...`）一律返回 null。照拼不误的话表现是「永远停在占位图 +
  后台一条 load warn」，比直接不认难查十倍。
- 🔴 **不带 `/` 的值恒按 key 处理**，不当路径猜 —— `兵种_头像_弓兵` 这种中文 key 里没有 `/`，
  一旦按路径拆就会拼出 `兵种_头像_弓兵/spriteFrame`。
- **key 命中优先**：表里查得到就用表，美术换图只改 `icon.json`，不用动配置表。
- 直路径**不依赖 `icon.json` 已加载**（`createIconArtResolver(null)` 也拆得出来）——
  塔防 / 领地这一路不保证主包的表先到。

### 38.2 为什么打表时把 `icons/head/` 换成了 `icons/cardHead/`

两个目录不是同一张图的两个分辨率，而是**两种取景**（同名 `moshushi`）：

| 目录 | 尺寸 | 取景 | 用在哪 |
| :--- | :--- | :--- | :--- |
| `icons/cardHead` | 256×256 | **全身立绘** | 卡面 / 卡牌阵容 / 传说卡横幅 / 地块翻牌 |
| `icons/head` | 128×128 | **头像特写（裁到胸）** | 玩家头像（HUD / 排行榜 / 聊天气泡） |

`headIcon` 同时喂「卡面」和「横幅立绘」（`ZCGame.loadLegendCardArt` → `legendCardArtFrames`），
所以整列指向 `icons/head` 的结果是**卡面变成裁到胸口的头像、还只有一半分辨率**。
源表这一列的说明本来就写着「兵种卡填 `兵种_头像_<兵种>` → image/icon/cardHead」——
美术按习惯写成了头像目录，不是要换取景。

⇒ 打表时统一规范成 **`icons/cardHead/<名>`**（35 行全部核对过卡片头目录里有同名 png），
并同步把列说明改成「图标名 **或** 直路径」。视觉与改前的 key 形态**逐像素相同**（同一张 256 图）。

### 38.3 打表脚本

`tools/config/sync_monster_head_icon.py`（默认预演，`--apply` 真写）：

- 只动 `headIcon` 一列 + 第 4 行的列说明；xlsx 走 **zip 级 `set_cell`**，其余字节原样；
- 换目录前先查 `icons/cardHead/<名>.png` **是否存在**，缺图的行原样保留并打印告警
  （别用「把路径改对」掩盖「图还没进工程」）；
- 产物两份（`json/client` + `assets/remoteRef`）逐格同步，回读比对；
- **幂等**：复跑输出「无差异」。⚠️ 判「列说明还是不是老文案」不能用 `icon.json 的图标名` 当判据——
  新说明里也有这半句，脚本会自己命中自己、永远不幂等（踩过）。

### 38.4 判据

- `tests/card-head-icon.test.ts`：直路径三种形态 / key 优先 / 未登记目录不认 / 表没读到也能拆；
  以及**真表 + 磁盘**两条（pvpCard、monsterCard）—— 逐行解得开、图在盘上、
  `headIcon` 不许出现 `icons/head/` 直路径、留空的只能是 50001/50002/50038/50039。
- 回归：`tests/card-head-view.test.ts`、`tests/territory-monster-box-guards.test.ts`、
  `tests/card-attack-anim-timing.test.ts` 合跑 25 绿。

### 38.5 同批修的另一件事：50038 / 50039 的命中帧

新卡 `50038 冰霜巨龙`、`50039 独眼巨人` 的 `unitAttackHitTime` 还停在整表占位值 `0.493`，
`card-attack-anim-timing` 直接红。按既有口径「命中时点 = 攻击动画时长 × 40%」用
`python tools/config/sync_card_attack_anim.py --apply` 回填（它会**现测骨架**，不是手抄）：

| 卡 | 动画时长 | 命中帧（旧 → 新） |
| :--- | :--- | :--- |
| 50038 冰霜巨龙 | 2.0s | 0.493 → **0.800** |
| 50039 独眼巨人 | 0.8s | 0.493 → **0.320** |

⚠️ 50038 的 `unitAttackDuration 2.0s` **大于** `unitAttackInterval 1.8s`（和运动霸同一类问题：
攻击态比节拍长）。这次只同步命中帧、没有动时长 —— 要不要「压时长保节拍」或登记进
`HIT_RATIO_EXCEPTIONS` 需要单独拍板。


## 39. 三条技能链换宿主：射线搬家 / 改名 / 新生（2026-11-23 第 43 批）

> 用户原话：「科学家的射线集束技能给机甲菇使用，技能效果不变，直接替换掉机甲菇的菌毯爆发，
> 菌毯爆发弃用，机甲菇使用的射线颜色和镭射飞龙的普通攻击颜色一致，不需要改成蓝色；
> 机甲菇的主动技能改成武器绞杀，技能描述的菌丝也改成武器；科学家的原射线集束技能改成文明之火，
> 特效使用灼热地带的特效，改成蓝色的，在目标位中心点，200px 半径的圆内，生成 3 个火焰区域，
> 每个火焰区域的大小都和灼热地带一致，持续时间对应 3 个等级 6/8/10 秒，
> 每秒钟造成的伤害为 100%/110%/120%」。

### 39.1 三条链的前后对照

| 链 | 卡 | 改前 | 改后 | 参数 |
| :--- | :--- | :--- | :--- | :--- |
| `101503` | 68015 机甲菇 | 菌丝绞杀（`fan_slow`） | **武器绞杀**（`fan_slow`） | 一个不动（120°/150/4-5-6 人/14-13-12s） |
| `101504` | 68015 机甲菇 | 菌毯爆发（`burst_aura`） | **射线集束**（`ray_beam`） | 逐字抄 68035 改造前的 103503 |
| `103503` | 68035 科学家 | 射线集束（`ray_beam`） | **文明之火**（`fire_zone`） | 全新：3 块 / 200 散布 / 60 半径 / 6-8-10s / 100-110-120% |

🔴 **`modifierId` 一个都不动**（94015031~33 / 94015041~43 / 94035031~33）：
那一列既是属性词条，也是 K 表 `modfiy` 的材料位引用键。换技能不改号，改号就断材料位。

🔴 **「菌毯爆发弃用」≠ 删代码**：`burst_aura` 车道现由 68018「毒液喷吐」101803 用着，
`castBurstSkill` / `applyBurstSkill` / `ZCBurstFx` 一行没删 —— 只是 68015 不再挂它。
反过来，「参数袋里不许残留旧车道的键」才是本批真正要守的东西（见 39.5）。

### 39.2 射线换图：乘法染色做不出「颜色一致」，只能换图

原设计（第 18 批）写的是「类似镭射飞龙普攻、**改成蓝色**的激光」，落地时借了磁电菇
「磁电冲击」那条 `雷电冲击`。这一批用户要的是「和镭射飞龙的普通攻击颜色一致」：

| 图 | 实测主色 |
| :--- | :--- |
| `雷电冲击` | 84,156,252（青蓝） |
| `镭射飞龙_普攻` | 252,36,12（正红） |

染色是**乘算**（`ZCCombatEffectTint` 按 prefab 路径查表、`applyTint` 在 `mountVisual` 末尾乘进去），
青蓝 × 任何颜色都到不了正红 —— 顶多得到一片暗红。所以这一版**直接换图、不染色**：

```ts
// ZCRayBeamFx.ts
export const ZC_RAY_BEAM_PREFAB_PATH = ZC_EFFECT_PATHS.laserAttack;
```

🔴 **换图必须重算基准半长**。`rayBeamReferenceHalfLength` 是「这张 prefab 烘进资产的可见半长」，
它决定事件级 `effectScale = rayHalfLength / 基准`：

| | 雷电冲击（旧） | 镭射飞龙（新） |
| :--- | :--- | :--- |
| 画布 | 485×73 | 700×73 |
| 画布缩放 | ×0.575963 | ×1 |
| alpha 可见宽（屏上 px） | 485 × 0.575963 ≈ 279 | 641 − 66 = **575** |
| 逻辑全宽 | — | 575 ÷ 0.76875 = 748 |
| 基准半长 | 180 | **374** |

180 是照旧图反算的。继续用旧值 ⇒ 表值半长 120 会算出 `120/180 = 0.667` 倍缩放，
而真实比例是 `120/374 = 0.321` —— **画面比判定长一倍还多**，且一条错都不报。

### 39.3 蓝色必须走**事件级**，不能登记成路径色

文明之火要「灼热地带的特效、改成蓝色」。这条最容易踩的坑是「既然要蓝，就把蓝色登记进目录」：

🔴 同一个 prefab（`火焰树妖_灼热地带技能`）**被火焰树妖 68003 自己的灼热地带 30811 用着**。
`ZCCombatEffectTint` 是按 **prefab 路径**查表的 ⇒ 一登记，那边也会变蓝。

所以新增了一条事件级通道：

| 层 | 字段 | 谁写 |
| :--- | :--- | :--- |
| 事件 | `ZCCombatEvent.tint?: readonly [number, number, number]` | `ZCGroundZoneSystem` 三处（`syncHoldVisual` / `pushExpireVisual` / `resolveWave`）从区域上抄 |
| 区域 | `ZCGroundZoneState.tint?` | `castFireZone` 逐块带 `ZC_FIRE_ZONE_TINT = [70,190,255]` |
| 视图 | `ZCCombatEffectView.initialize(..., tint?)` | 在 `mountVisual` **之前**赋值，`applyTint` 取 `事件色 ?? 路径色` |

🔴 `tint` 必须声明成 `readonly [number, number, number]`：常量是 `as const` 的只读元组，
写成可变的 `[number, number, number]` 会 TS2345。

### 39.4 文明之火：3 块**独立**区域，不是 1 块记 3 份

```ts
// ZCAttackResolutionSystem.castFireZone
for (let index = 0; index < count; index += 1) {
    const angle = context.random() * Math.PI * 2;
    const distance = Math.sqrt(context.random()) * spread;   // 面积均匀：半径取 sqrt
    state.groundZones.push({ ... });
}
```

四条口径（用户 2026-11-23 逐项确认）：

| # | 口径 | 后果 |
| :--- | :--- | :--- |
| ① | 每块**各自**按 100/110/120% 结算 | 合计约 ×3；三块摊分是另一种读法，已否 |
| ② | 落点**圆内随机、面积均匀** | 直接 `random() × 200` 会全挤在圆心（半径上密度偏高） |
| ③ | 每块半径 60（表值）与灼热地带一致 | `area` 类**从不按 `event.radius` 缩放** ⇒ 尺寸只由 prefab 烘焙值决定，这里刚好零缩放 |
| ④ | 触发沿用**累计普攻 8 次** | 不吃冷却；`fireEvery = 8` |

每块只推**一条**长效表现（`holdVisual: true` + `growSeconds: 0.2`）：
不设就是每秒推一条 `area` 事件，6~10 条火焰叠在同一处，看着像「越来越亮」。

📌 **2026-11-26 图集治理（视觉逐字不变）**：`火焰树妖_灼热地带技能` 的 14 帧从 400×451 裁到
**226×257**（以画布中心为原点对称裁，内容并集 172×246 相对中心的偏移量原样保留），
10 簇 `flame_*` 的 `_lpos` / `_lscale`（0.200543~0.32087，设计上的大小差异）与 `offset`、根节点
**一个数都没动**，只把 10 个 `UITransform._contentSize` 改成 226×257。合成结果经逐像素比对：
260×260 里只有 5 个像素差值 >8（重采样边界），包围盒仍等于范围圈 92.25×77.14
（`tests/zcds-hot-zone-effect.test.ts` ③ 用 PNG 自量后逐格校验）。

🔴 这份 prefab **没有**可删的「整体放大倍率」（根与 `offset` 都是 1），所以「去硬编码」在这里等于
「别再加外层倍率」；取消某一簇的 `_lscale` 会让 10 簇变成同样大，用例 ③ 的「至少 3 种缩放」也会红。

### 39.5 六个登记点 + 一个计数器（漏一处就静默不跑）

| # | 位置 | 漏了会怎样 |
| :--- | :--- | :--- |
| ① | `ZCEffectCatalog.ZC_EFFECT_BEHAVIOR_KEYS.fireZone` | 资源清单取不到路径 |
| ② | `ZCEffectCatalog.ZC_EFFECT_BEHAVIOR_SPECS.fireZone` | 编辑器里看得见、实战一片空白 |
| ③ | `ZCSkillRuntime.register('fire_zone', 'none')` | 参数永远进不了运行时，技能一声不响 |
| ④ | `ZCStatSchema.SKILL_BEHAVIORS` | 配表校验过不了 |
| ⑤ | `ZCSkillTriggerSystem.tick` 里的 `applyFireZone` 调用 | 有参数、有区域，就是没人推进 |
| ⑥ | `ZCGameModel.attackResolutionContext.castFireZone` | 推进到一半「没有这个方法」 |

🔴 计数器 `unit.fireFiredCount` 存的是**上一次的 `completedAttackCount` 快照**（首次只记基线、
被拒不消费），必须登记进 `ZCSnapshotCodec` 白名单 —— 不还原就是「读档回来白送一次」。

🔴 同一张卡的两个累计普攻车道必须各占一格：`rayFiredCount` 与 `fireFiredCount` 分开。
68015 现在同时有 `ray_beam`（101504）和 `fan_slow`（101503，吃冷却），互不干扰。

### 39.6 用例

`tests/zcds-civilization-fire.test.ts`（9 条，全绿）：

| # | 钉住的东西 |
| :--- | :--- |
| ① | 101504 三级参数与**改造前的 103503 逐键一致**（「技能效果不变」），且 68015 全表不再有 `burst_aura` |
| ② | 101503 = 武器绞杀，两份产物 + K 表描述里**一个字都不许再提「菌丝」**，120°/150 没被带跑 |
| ③ | 103503 三档 3 块 / 200 / 60 / 6-8-10 / 100-110-120，灼热地带 100304 自己没被顺手改掉 |
| ④ | 换图后基准半长 = 374，`zcRayBeamEffectScale(120) = 120/374` |
| ⑤ | 蓝色只按事件染：目录里**不能**登记 `hotZone` 的路径色 |
| ⑥ | 真链路「配表 → 定义 → 本局清单」：两张图都真的进了 `effectPaths` |
| ⑦ | `castFireZone` 撒 3 块独立 zone、半径 18 世界 px、落点在 60 世界 px 圆内、每块各自结算 120 |
| ⑧ | L1 ⇒ 6 秒 6 跳 100%/块；`fireCount = 0` 与「没有目标」都返回 `false` 且不留半块 |
| ⑨ | 袋里只有 `ray*`（漏改的典型形态）⇒ 拒放，不许撒出 0 半径 |

同批改写的既有用例（都是「旧口径」被本批作废，不是新 bug）：

| 文件 | 改法 |
| :--- | :--- |
| `zcds-burst-batch13` | 101504 那条从「三档爆发」改成「已换成射线集束 + 结构位不动」，`AURA_PARAMS` 降级为 `castBurstSkill` 的纯行为夹具 |
| `zcds-fan-single-batch14` | 101503 全篇改名武器绞杀；扇形选敌那条的期望值 `[2,3,4,6]` 修正为 `[2,3,4,5]`（id 5 在 −58° 刚好进 60° 半角、id 6 才是距离最远那只） |
| `zcds-ray-beam-batch18` | 103503 两条配表/卡面断言改 fire 口径；端到端改查 `fire*`；基准半长 180 → 374 |

### 39.7 遗留

- 设计案「卡牌描述与落地」那一页只有 `技能1..4` 四列，而这两张卡各有 **4 条主动技能 + 普攻**，
  第 4 条主动（101504 / 103503）本来就不在该页 —— 本批只在主表（`技能设计案 (2)` 第 75/76/176 行）
  与卡面描述两处同步，没有动那一页的列结构。
- 68015 的 `101504` 与 `101503` 现在共用 68015 这一袋参数（`68015:30241`），
  再加技能时**必须带前缀**（`ray*` / `fan*` / `fire*` / `splash*`），裸键会互相改掉。

## 40. 腾云驾雾：把「强化那一击」拆成四段突进连击（2026-11-24 第 44 批）

> 用户原话：「仙桃行者 大地之力技能优化 —— 1.名字改为腾云驾雾；2.技能机制修改：以150px速度
> 突进到目标1身前 攻击1次，以目标1为圆心 200px为半径，内索取额外3个目标（合计4人），
> 依次突进到这些目标身前攻击1次（每个目标攻击1次），再回到目标1的位置，给每个目标造成
> 350%410%/480%(对应等级的伤害)，每次攻击都会释放 重击特效 这个技能的攻击不计入普攻的累计数；
> 3.机甲菇的技能名字修改 三尖两刃」。

### 40.1 两条链的前后对照

| 链 | 卡 | 改前 | 改后 | 参数 |
| :--- | :--- | :--- | :--- | :--- |
| `100904` | 68009 仙桃行者 | 大地之力（`skill_params`：穿透冲击波 + 首目标重击 + 落点圆） | **腾云驾雾**（`dash_chain`：四段突进连击） | 全新 `dashChain*` 六个键 |
| `101503` | 68015 机甲菇 | 武器绞杀（`fan_slow`） | **三尖两刃**（`fan_slow`） | 一个不动（120°/150/4-5-6 人/14-13-12s） |

四条落地口径（逐项确认过的，别凭字面重推）：

1. 「三尖两刃」改的是 **101503**（机甲菇 120° 扇形那条），不是 101501 / 101504；
2. 触发方式**仍是强化那一击**（`pvpSkill 30718.empoweredEvery = 5`）——「不计入普攻累计数」
   说的是那 4 段伤害，触发它的那一次普攻照旧 +1；
3. 350% / 410% / 480% = **每个目标各自**吃这个倍率（4 个人各挨 350%，不是 4 人分 350%）；
4. 突进速度按**表值** 150 px/s，本体**真位移**（× `combatDistanceScale` 0.3 ⇒ 45 世界 px/s）。

🔴 `modifierId`（94009041~43）与 `pvpSkillId`（30718）**一个都不动**：前者是属性词条 + K 表
`modfiy` 的材料位引用键，后者是 `skillParamJson` 那个袋子的键（`${unitId}:${pvpSkillId}`，
100901~100904 共用一袋）。

### 40.2 为什么整条车道必须落在**触发系统**

它要逐帧挪人，而 `blinkTo` / `strike` 只接在 `IZCSkillTriggerContext` 那一侧
（与 `blink_strike` / `single_strike` / `charge_shield` 同一个理由）。所以起手拆成两拍：

| 位置 | 干什么 | 为什么 |
| :--- | :--- | :--- |
| `ZCAttackResolutionSystem.prepareAttack` | 在 `consumeEmpoweredAttack` **之后**写 `dashChainPendingAt` + `dashChainTargetId`，然后 `return null` | 累计数照常 +1；强化那一击**不再额外打一发** |
| `ZCSkillTriggerSystem.applyDashChain` | 建访问顺序 → 逐帧推 → 到位 `blinkTo` + `strike` + 推重击柱事件 | 同一帧内接手（`updateUnits` 在前、`tick` 在后） |

🔴 顺序不能反：起手若放在 `consumeEmpoweredAttack` **之前**，「每 5 次普攻」这条节拍永远等不到第 5 次。
🔴 `return null` 之后 `sendAttack` 直接返回 ⇒ 旧弹道（`createAttackProjectiles` 里那套 `quake*`）
一分钱都不走，「旧机制没删干净」在运行时是不可见的 —— 只能靠配表断言守（见 40.6 ①）。

### 40.3 访问顺序在**起手那一帧拍死**

「目标 1 + 圆内 3 个」只算一次：距离量的是**目标 1 到候选者**（不是本体到候选者 —— 本体此刻
可能离得很远，那正是要突进的原因），由近到远、同距按 `unit.id`。

- 中途某人被打死 ⇒ **跳过那一段**（`index += 1`），不空挥、不换人补打；
- 每帧重选会让「选中的人被打死 ⇒ 换一个」变成**打不完的循环**；同时四人名单里混进新出现的人，
  四段的「每人一次」就不再是同一个集合。

回程落点 = **起手那一刻目标 1 的坐标**（`dashChainReturnX/Y`），不是本体起手点、也不是最后一个人脚下。

### 40.4 参数前缀：`dashChain*`，不能写 `dash*`

`dashDamageRate` / `dashHitRadius` 已经被冲锋（`legacy_dash`，102303 / 102703）用着，
裸 `dash*` 会在「同一张卡既有冲锋又有腾云驾雾」时两边串味。这一袋（`68009:30718`）里还住着
100901 的 `lance*`、100902 的 `splash*`、100903 的 `selfCast*`。

| 键 | 值 | 含义 |
| :--- | :--- | :--- |
| `dashChainSpeed` | 150 | 突进速度（表值 px/秒，× `combatDistanceScale`） |
| `dashChainSpreadRadius` | 200 | 以目标 1 为圆心的索取半径（表值 px） |
| `dashChainCount` | 4 | 含目标 1 合计几人 |
| `dashChainStopDistance` | 30 | 落在目标身前的距离（与突刺 / 闪现同一套几何，表值 px） |
| `dashChainHitRadius` | 40 | 那一击的挑人半径（表值 px） |
| `dashChainDamageRate` | 3.5 / 4.1 / 4.8 | 每个目标各自的倍率 |

### 40.5 冻结、快照：不清就是「整局站着不动」

| 位置 | 内容 | 漏了会怎样 |
| :--- | :--- | :--- |
| `ZCUnitSystem.updateUnit` | `if (unit.dashChainIndex !== undefined) return;`，**必须插在 `dashUntil` 冲刺块之后** | 不索敌（中途锁新目标）/ 不出手（多打一发普攻）/ 不自己挪窝（和 `blinkTo` 抢坐标，画面抖成一团） |
| `ZCSnapshotCodec` | `dashChainPendingAt` / `dashChainTargetId` / `dashChainIndex`（数值）、`dashChainReturnX` / `ReturnY`（有限数）、`dashChainIds`（正整数、不重复） | 读档回来单位被冻在半路，却再没人推进它 —— **整局站着不动** |
| 三处登记 | `ZCStatSchema.SKILL_BEHAVIORS`、`ZCSkillRuntime.register('dash_chain')`、`ZCEffectCatalog.ZC_EFFECT_BEHAVIOR_KEYS` | 读表阶段直接抛「未注册 behaviorKey」，或者技能照常结算但表现一片空白 |

🔴 这条车道**没有冷却也没有自己的计数器**（`stateMode = 'none'`、`cooldown` / `maxTriggers` 留空），
节拍完全由 `pvpSkill.empoweredEvery` 决定 —— 想改「每几次普攻」去改 `PVP-技能.xlsx`，不是改 `dashChain*`。

### 40.6 表现：每次攻击都播重击柱，且不新增目录 spec

- 路径 `units/projectiles/仙桃行者_重击技能`，`anchor: 'target'`、`layer: 'top'`、
  不吃 ×1.2 强化缩放（`ZC_EMPOWERED_FX_OVERRIDES[30844] = null`）；
- **不在 `ZC_EFFECT_BEHAVIOR_SPECS` 里新增条目**：这张图已经按单位收在
  `skill_params` 的 `unitPrefabPaths['68009']`（第 42 批为大地之力补的，本批沿用），
  再登记一次就是同一份美术两个真源；
- 事件是**纯表现**（`radius = 0` / `damage = 0`），伤害已经由 `strike` 结算过；
- ⚠️ 旧口径「画面那圈裂纹 = 判定圆」本批失效：判定改成「贴脸打眼前这个」，裂纹只作表现。

🔴 打人圆心显式给成**目标自己的坐标**（`IZCStrikeOptions.origin`）：`strikeTargets` 只按
「离 origin 最近」挑，刚落地时附近若有更近的敌人，这一下会打到别人身上（四段打成同一个人）。

### 40.7 判据

`tests/zcds-dash-chain.test.ts`（9 条，全绿）：

| # | 钉住的东西 |
| :--- | :--- |
| ① | 队列 = 目标 1 + 圆内由近到远的 3 个；圆外与友军不进队列；每一下的 `origin` = 那一段的人 |
| ② | 每人一条重击柱事件，寿命 = 29 帧 ÷ 24fps，半径/伤害 0，落在被打的人身上 |
| ③ | 场上只有 2 个敌人 ⇒ 只打 2 段，照样回位（不补位、不重复） |
| ④ | 起手后被打死的那个人 ⇒ 跳过那一段，接着打下一段（不空挥、不换人） |
| ⑤ | 整条链路跑完 `completedAttackCount` 一格不动 |
| ⑥ | 没有 `dashChainSpeed` ⇒ 不动人 / 不冻结 / 不打人 |
| ⑦ | 一帧位移 = 150 × 0.3 ÷ 30 = 1.5 世界 px（表值 × `combatDistanceScale`） |
| ⑧ | 六个字段在 `ZCUnitState` 与 `ZCSnapshotCodec` 都在；冻结那一行在 `dashUntil` 之后 |
| ⑨ | 起手目标在「留标记 → 建序列」之间死了 ⇒ 空过一拍、清干净、不冻人 |

配表那一侧在 `tests/zcds-xiantao-quake.test.ts` ①②（三档参数 / 两个新名字 / 两份产物），
同批改写的既有用例：

| 文件 | 改法 |
| :--- | :--- |
| `zcds-xiantao-quake` | ①② 从旧「quake 三键」改成 `dash_chain` 口径；⑧~⑬ 的 `TIER1_PARAMS` 降级为纯行为夹具（守重击柱判定链本身） |
| `zcds-civilization-fire` | ② 名字 `武器绞杀` → `三尖两刃`（用户原话那一行保留历史） |
| `zcds-fan-single-batch14` | 全篇 `武器绞杀` → `三尖两刃` |

### 40.8 遗留

- `pvpSkill 30844` 的 `mode` 仍是 `projectile`：新机制在 `prepareAttack` 就 `return null`，
  那条弹道分支不会执行，所以本批**只改了名字没改 mode**。要动它得连带确认
  `empoweredProfile` 的其它读点。
- 设计案「卡牌描述与落地」页的 68015 行把 101503 列了两次（G 列写「武器绞杀」+「普攻伤害 =
  pvpCard.unitAttack」、P 列才是 `fan_slow` 那条主动技）。本批只改 P/Q（名字 + 状态→已实现），
  G 列属于普攻槽，需求没提就没动。
- `assets/remoteRef/armySkillLevelUp.json` 的 `modfiy` 整列曾被外部进程清空（420 行全 `[]`），
  已用 `node tools/config/sync_army_skill_modfiy.js` 按「union + 死引用过滤」修回（改 342 格）。
  同一份文件里 103103 的 `desc` 仍比 client 少一句（「本体脚底同时展开持续光…」），
  属外部回滚残留，不影响本批用例，待单独确认后同步。
- 🔴 `zcds-model:1022`「remoteRef 与转表产物逐格一致」本轮红，**75 处漂移全在本批之外**
  （`pvpSkillPlan` 零差异）：`pvpCard.headIcon`×35（remoteRef 已规范化 `icons/head/<拼音>`，
  client 还是中文原名）、`gameEndPrefabSize`×35、`2002.buildIcon`、`pvpSkill 30858.areaRadius`、
  `pvpTile.setCountLimit`×3。11-23 11:31 那轮是绿的，之后 `remoteRef/pvpTile.json`（11-24 10:41）
  等被外部进程改过。**没顺手对齐**：这五组都是别人先在 remoteRef 侧定的值，单方向覆盖有
  抹掉对方调整的风险，需原作者确认哪边为准。诊断脚本 `tmp/dump_drift_44.js`（按字段分组打印）。

## 41. 战斗统计面板：开局铺满阵容 / 数值降序 / 敌方头像切换（2026-11-24）

用户三条原话（配两张现场截图：开局面板两列全空；打起来后敌方一列把两方数据混在一起）：

1. 进局默认展示玩家阵容内的所有卡牌、按阵容排序作初始顺序，战斗开始拿到实际数据后再按数值降序；
2. 敌方默认选中 1 个 id 小的敌方，点头像切换成别的敌方；
3. 敌方玩家头像右对齐（只有 1 个就在最右侧）。

### 41.1 一条排序口径覆盖两个阶段（不要加「阶段开关」）

`ZCDamageStats.compareDamageStatsRows(metric)`：**当前页签数值降序 → 阵容序升序 → 席位序 → 卡 id**。

- 开局所有行都是 0 ⇒ 第一关键字恒等，自然落到阵容序 = 需求 1 的前半段；
- 一旦有人打出伤害，高数值自动浮上来 = 后半段；
- 同数值必须再由阵容序收敛，否则虚拟列表每帧重排、行会闪。

行的「阵容序」来自 `IZCDamageStatsUnit.deckOrder`（该席位卡组里的下标，`-1` / 缺省 = 不在卡组）。
不在卡组的行（波次怪 / 中立怪）排序键给 `Number.MAX_SAFE_INTEGER`，排在所有阵容卡之后 ——
**别**直接用 `deckOrder` 相减，`-1` 会跑到最前面。

### 41.2 开局为什么是空的：数据源只认「打过伤害的卡」

`ZCGameModel.damageCards` 是 `creditCardDamage` / `creditCardTaken` 现攒的（键 `owner:cardId`），
没人出手就一行都没有 ⇒ 老版本一进局面板两列全空。`ZCBattleRuntimeController.damageUnits()`
现在做两件事：先按 `damageCards` 出行（带 `deckOrder = deck.findIndex(id)`），再把**各席位卡组里
还没出现过的卡按 0 补进来**（`counted` 集合按 `owner:cardId` 去重，`unitId` 留空 = 还没上场）。
唯一出口仍在控制器，弹窗不碰模型（预览 / 结算 / 实时统计共用同一份）。

收行口径同步放宽：`buildDamageStatsColumns` 只对**阵容外**的行继续按页签过滤 0 值；
阵容内的卡一律保留（0 伤害也占一行，否则「开局铺满」这条需求无从体现）。

### 41.3 敌方只显示选中的那一方

`buildDamageStatsColumns(units, metric, enemyOwner = null)`：第三个参数非空时只收该席位的敌方行；
`null` = 全部非玩家席位合并（无席位上下文的旧调用方）。

- `enemyOwnersOf(units, owners)` 给头像栏的席位与顺序（席位序：`enemy` → `enemy2` → `enemy3`，
  不含玩家）；`owners`（= `ZCGameModel.owners`）是权威来源 —— 某方还没打出伤害也要能切过去；
- `defaultEnemyOwner()` = 席位序最小的敌方（需求原话「id 小的敌方」指的是**席位序**，不是服务端 `unitId`）；
- 换敌方 / 切页签才 `scrollToTop`，实时刷新不回顶（`resetScroll` 只在这两处为 `true`）。

### 41.4 头像栏的几何：塞进「我方 / 敌方」标题带，不动两条列表

先试过「把两条列表整体下移 56px 腾一条带」，但那会让左列平白空出一块，且 `zcds-settlement`
的 prefab 判据（列表高 435 / 顶 168）要跟着改 —— 收益不抵。最终落法是**用标题带里敌方列的右侧余量**：

| 元素 | 几何（`Panel` 局部坐标） |
| :--- | :--- |
| `EnemyHeader`（「敌方」二字） | x 18、宽 80 ⇒ 占 18~98 |
| `EnemySeats`（头像栏容器） | **(249, 189)**、151×44、`anchorPoint = (1, 0.5)` |
| 敌方列 | x 128、宽 242 ⇒ 右沿 249；列表顶 168 |
| 页签 `DamageTab` / `TakenTab` | y 238.5、高 41 ⇒ 底沿 218 |

- **右锚点**是关键：容器原点就是右沿，子头像一律负 x（`-40/2 - (n-1-i)*48`），
  一个敌方时它正好贴 249 —— 需求 3 的「只有 1 个就在最右侧」是几何自带的，不是特判；
- 头像 40×40、间距 8：三颗 136 ≤ 151 净宽，不压「敌方」二字（标头 18~98 + 栏位 98~249 首尾相接）；
- 选中标记是**套在头像身上**的白框（`Graphics` 线宽 2px，骑在 40×40 的边线上、外溢 1px）：标题带上下只剩 1~9px，
  放不下「头像 + 下划线」那种两段式标记（下划线会掉进列表 / 顶到页签）；
- 未选中的头像压暗成 `(120,122,128)`，选中 = 原色 + 白框。

头像图走 `HeadArt.loadHeadFrame(profile.headKey)`（= 「角色 id → head 表 → 图标名 → 资源」，
与 HUD 左侧四行同一口径）。**别**拼 `icons/head/<id>`：那是 `Bundle resources doesn't contain …`
的老坑（见 §3.53）。

### 41.5 契约：`openDamage` 多带一个 `seats`

| 位置 | 变化 |
| :--- | :--- |
| `IZCDamageStatsSeats` | 新增（`ZCDamageStats.ts`）：`owners` + `profiles`（= `RankSeatProfiles`） |
| `ZC_BATTLE_EVENTS.POPUP_COMMAND`（`kind: 'openDamage'`） | `(units, seats?)` |
| `IZCBattleSettlementRequest` | 新增可选 `seats` —— 结算期不再回读模型，头像 / 名字必须随 `units` 一起冻结 |
| `BattlePopupHost.openDamage`（`BattleComposition`） | 透传 `userData: { units, seats }` |
| `GameRunAwayOptions` | 新增可选 `seats` |

`seats` 缺省时：不建头像栏、敌方列退回「全部敌方合并」的老口径（本地局 / 老调用方不炸）。

### 41.6 判据

| 文件 | 钉住的东西 |
| :--- | :--- |
| `tests/zcds-damage-stats.test.ts` | 开局 0 值也铺满且按阵容序；有数据后数值降序、同值按阵容序；敌方列只收选中方；`enemyOwnersOf` 按席位序、默认选最小；`null` 时合并回落 |
| `tests/zcds-settlement.test.ts` | 默认只显示 id 小的敌方（1 行）；`selectEnemy('enemy2')` 后 2 行并回顶；重复点不重算；`refresh` 保留选中且不回顶；`EnemySeats` 几何（右锚点 / 右沿 249 / y 189 / 151×44 / 不压标头与页签） |
| `tests/battle-runtime-controller.test.ts` | `damageUnits()` 既有行序不变，其后补进 0 值阵容卡且带 `deckOrder` |

### 41.7 遗留

- 补进来的阵容卡按 0 显示，`formatDamageStatsValue(0)` 就是 `0`；若要「未上场显示 `—`」得再改
  `RunAwayUnitItem.render` 的入参口径（当前 `render(value, max, frame, baseFrame)` 只有值没有状态）。
- 实时 `refresh` 只换数据、不补载新出现的头像图：波次怪这类「开局不在 `units` 里」的单位
  仍可能没有头像（与改前一致）。
- 头像栏的选中态没有音效、没有切页动画；需求没提，未加。

## 42. 结算页 MVP 徽标 / Lv / 名字的坐标归 prefab（2026-11-24）

### 42.1 现场

实机结算页里 `MVP` 徽标飘在角色头顶（还对不齐），`Lv.x` 与卡名却贴在 prefab 的位置 —— 三者不成一行；
而 prefab 里徽标早在「与 Lv/名字 同一行、贴 `MvpBlock` 左沿」的 `(-254, 85)`。

### 42.2 根因

`ZCSettlementMvpActor.applyBadgePosition()` 在骨骼模型挂上之后，用
`ZC_SETTLEMENT_STYLE.mvpBadge.defaultX` + `calcMvpAdaptiveBadgeY(角色可见头顶)` **改写** `MvpIcon`
的位置（`-46.5` / 夹在 `125~132.5`）。那套「徽标悬浮在头顶上方」的自适应是旧稿（蓝湖 `-46.5 / 132.5`）
的口径：prefab 改成同一行之后，代码把徽标拽回旧坐标，`clear()` 时还会把它复位到旧的默认值
⇒ 实机永远和预制体差一截，且拖 prefab 没有任何效果。

### 42.3 口径（改了就不许回退）

- 🔴 **坐标唯一真源 = prefab**：`MvpBlock` 下 `MvpIcon` / `MvpLevel` / `MvpName` 及其它文案的位置只在
  prefab 里写。`ZCSettlementMvpActor` 只负责**立绘** —— 挂模型、按包围盒归一，`setScale` /
  `setPosition` 只作用于它自己 `instantiate` 出来的那个模型节点，不许碰 `MvpBlock` 的其它子节点。
- 立绘头顶上限仍保留（`ZC_SETTLEMENT_STYLE.mvpArt.maxHeadTopInBlock = 91`），只用来压立绘高度，
  不再兼职推徽标。
- 「徽标与文案同一行」是版面契约：`MvpIcon`（120×40）中心与两个 38 高的 Label 中心差 ≤2，
  `x` 严格递增，且徽标右沿不压 `Lv` 左沿。

### 42.4 改动清单

| 文件 | 改动 |
| :--- | :--- |
| `view/ZCSettlementMvpActor.ts` | 删 `applyBadgePosition` / `resetBadgePosition` / `badgeNode` / `headTopInBlock`；`show()` / `clear()` 不再动徽标 |
| `model/ZCSettlementStyle.ts` | 删 `mvpBadge` 整组 token 与 `calcMvpAdaptiveBadgeY`；`maxHeadTopInBlock` 并入 `mvpArt` |
| `tests/zcds-settlement-page.test.ts` | `DESIGN` 按 11-24 实机定案订正（徽标 `-254/85`、Lv `70/83`、名字 `175/83`）；自适应用例换成「坐标只认 prefab」守卫 |

### 42.5 判据

`npx tsx --test tests/zcds-settlement-page.test.ts`（23 绿）：prefab 几何按 `DESIGN`、徽标与文案同行、
`ZCSettlementMvpActor` 源码里不许出现 `MvpIcon`、`ZCSettlementStyle` 不许再出现
`calcMvpAdaptiveBadgeY` / `mvpBadge`。

### 42.6 遗留

`DESIGN` 表原本是「手抄蓝湖、别由 prefab 反推」，这次按用户 11-24 的实机定案（坐标是用户自己在 prefab
里拖的）订正，等于把 prefab 现状当成了新基准；蓝湖稿后续再出改版时仍以新稿覆盖它。

## 43. 伤害统计的柱状条 = 占全队总量的占比（2026-11-24）

### 43.1 口径

柱子回答的是「**这一行占本队总量多少**」，不是「离第一名多远」。

- 分母 = 该**列**的合计：我方列 = 我方全队（`totalOwn`）；敌方列 = **当前选中那一方**的全队
  （`totalEnemy`，切头像时跟着换，不含其它敌方席位）。
- 两个页签同一套：伤害统计分母 = 全队总伤害，承伤统计分母 = 全队总承伤。
- 分母为 0（开局全 0、单人局）⇒ 条全空；脏数据（value > total）裁到 1，不许画出界。
- 非零但占比 < 2% 时抬到 `ZC_DAMAGE_STATS_MIN_BAR_RATIO`，保证「有伤害但看起来是空条」不出现
  —— 代价是极小份额会略放大，这是可见性优先的既有取舍。

### 43.2 实现

| 位置 | 改动 |
| :--- | :--- |
| `model/ZCDamageStats.ts` | `IZCDamageStatsColumns.maxOwn/maxEnemy` → `totalOwn/totalEnemy`（`buildDamageStatsColumns` 里累加，不是取最大值）；`damageStatsBarRatio(value, total)` 的形参改名并改义 |
| `ui/GameRunAway.ts` | 两个列表的 `renderItemFn` 改喂列合计；`renderRow(itemNode, index, rows, total)` |
| `ui/RunAwayUnitItem.ts` | `render(value, total, frame, baseFrame)` |

### 43.3 判据

- `npx tsx --test tests/zcds-damage-stats.test.ts`（6 绿）：`totalOwn/totalEnemy` 逐条对账、
  「整列占比之和 = 1」、分母 0 / 越界 / 2% 兜底。
- `npx tsx --test tests/zcds-settlement.test.ts`（16 绿）：喂给行组件的第二参 = 合计
  （600+300 ⇒ 900；刷新后 900+300 ⇒ 1200），敌方只一席时合计 = 它自己。

### 43.4 遗留

行内只显示绝对值（`formatDamageStatsValue`），没有百分比文案；要「63%」那种显示得给
`RunAwayUnitItem` 加一个 Label（prefab 目前只有 `Value` 一个文本位）。

## 44. 治疗类技能表现统一：绿字 + 直线 75px / 0.2s + 通用治疗光环（2026-11-25 第 47 批）

### 44.1 需求与三块边界

> 「释放治疗类技能时，数字 UI 是绿色的前面带 + 号，字体大小和伤害一致，
>   移动轨迹是直线上移 75px，持续 0.2s，播放【通用治疗特效】，
>   制作统一格式的预制体，特效大小跟随角色模型大小轻微调整」。

三块各自有真源，别互相借：

| 块 | 真源 | 值 |
| :--- | :--- | :--- |
| 颜色 / `+` 前缀 / 字号 | `ZCFloatTextView` 的 `HEAL_COLOR` / `battleText` / `DEFAULT_FONT_SIZE` | `(91,255,49)` / `+N` / 30（与普通伤害同号） |
| 轨迹与时长 | `ZCFloatTextView.healRiseDistance` + 模型 `FLOAT_TEXT_HEAL_SECONDS` | 75px 直线 / **0.2s** |
| 特效 | `ZC_EFFECT_PATHS.healAura` + `ZC_EFFECT_TUNING.healAuraSeconds` | Spine `eff_cost_01` 的 `eff_buff_heal`，**1.0s** |

前两项本来就是对的（绿、`+`、字号 30），本批真正改的是**轨迹**与**时长**。

### 44.2 🔴 治疗不许落进伤害那段通用逻辑

`render()` 里伤害那一段对「无标记」的 kind 返回 `damageTravelSign = −1`（**向下坠**），
再按 `text.id` 散到 5 条横向轨道（`DAMAGE_LANES`）。治疗套进去的症状是
**「一半治疗数字往地里钻、并且每次位置都偏一点」**，不报错、只是读起来像 bug。

所以 heal 自成一档、**排在伤害段之前 `return`**：

```ts
if (text.kind === 'heal') {
    const rise = this.healRiseDistance * progress;   // 匀速走完整条时长
    this.textLabel.node.setPosition(0, headY + rise, 0);
    ...
    return;
}
```

- 用 `progress` 不用 `enter`：入场段走完就该正好 75px，用 `enter` 会在入场结束时就停住，
  后半段变成「原地不动地淡出」。
- 起点仍是 `headY = damageTargetSize/2 + damageHeadPadding`（角色头顶），与伤害同一基线。
- `healRiseDistance` 独立成字段，不与 `damageDropDistance`(100) 共用 —— 共用会变成
  「改伤害下坠距离顺手改掉治疗」。

### 44.3 🔴 时长不能与伤害同源

改前 `presentHeal` 推的是 `this.rules.floatTextDamageSeconds ?? FLOAT_TEXT_DAMAGE_SECONDS`（0.85s）。
看起来「统一口径」，实际会把 75px 拉成 0.85s 的慢飘 —— 与伤害那声「啪一下弹走」是两种手感。

| 常量 | 值 | 用途 |
| :--- | :--- | :--- |
| `FLOAT_TEXT_DAMAGE_SECONDS` | 0.85 | 伤害（三处调用点仍读 `rules.floatTextDamageSeconds`） |
| `FLOAT_TEXT_HEAL_SECONDS` | **0.2** | 治疗，需求直给 |

### 44.4 通用治疗特效：Spine 一次性播放

素材是 `units/projectiles/通用治疗特效/eff_cost_01.{skel,atlas,png}`，**全项目零引用**，也没有 prefab。

- `eff_cost_01.skel` 是 Spine 3.8 二进制、**浮点大端**、时间轴是**绝对时间**（不是增量）。
  动画段 `count = 1`，名字紧跟其后 = **`eff_buff_heal`**。
- 时长 **1.0s**：12 条 slot 颜色时间轴的末帧是 0.5 / 0.6667 / 0.7333 / 0.8 / 0.8333 / **1.0000**，
  最长为 1.0000 且出现 8 次。改动素材（换 skel）必须重读。
- 骨架 `width/height = 0`（导出时没设 bounds）⇒ 取景尺寸只能按**中枢光斑**估：
  `heal_c` 在图集里是 93×83，与兵种画布 98 同量级 ⇒ 目录 `nodeScale: 1` 正好盖住一个角色。
  **2026-11-25 实机改口径「治疗特效缩小成 50%」⇒ 已改成 `nodeScale: 0.5`**（见 §44.7 的表下注）。

**预制体**（手写，同目录 `通用治疗特效.prefab`，与 `鹿神守护.prefab` 同构）：

| 索引 | 对象 | 要点 |
| :--- | :--- | :--- |
| 1 | 根 Node | `_lpos (0,0)`、`_lscale 1`（`render()` 每帧 `setScale` 覆盖它）、UITransform |
| 2 | 子 Node `spine` | 挂 `sp.UITransform` + `sp.Skeleton` |
| 5 | `sp.Skeleton` | `_skeletonData` = skel meta uuid、`defaultAnimation: eff_buff_heal`、**`loop: false`** |

🔴 **`__id__` 必须逐个核**：我第一版把根节点的 `_prefab` 写成 11（数组只有 11 项）、
子节点的 `_prefab` 写成 8（指向 `cc.UITransform`）。两个都被 `tests/zcds-prefab-integrity.test.ts` 与
`tests/zcds-fx-prefab-existence.test.ts` 当场抓住 —— 这类错引擎 `_deserialize` 直接炸，
但**手写 prefab 时肉眼很难发现**，所以新增 prefab 后必须跑这两条。

### 44.5 🔴 `spineLoop`：一次性演出不能循环

`ZCCombatEffectView.applySpineAnimation()` 原来硬编码 `setAnimation(0, clip, true)`。
持续型特效（鹿神守护走 / 待机）本来就要循环，但一次性演出循环了就没有「播完」这回事 ——
事件寿命到点回池时正好卡在重播帧上，看起来像抽了一下。

- 事件新增 `spineLoop?: boolean`；调用点 `this.applySpineAnimation(event.spineAnimation, event.spineLoop !== false)`
  —— 缺省 `true`，存量全部逐字不变。
- 判「要不要重设」必须**连循环位一起比**（`key = loop ? clip+'\u0001loop' : clip`）：
  同一个 clip 名、两种循环位是两个不同的播放状态。

### 44.6 光环挂在哪：`presentHeal` 是唯一出口

治疗在 `ZCStatusResolutionSystem.healUnit` 汇成一次 `context.presentHeal`，上游却有四条路：
吸血（普攻每刀）、吃口菠萝、群体治疗、贯穿滋养。挂在任一条技能车道上只覆盖四分之一
⇒ 只能挂在出口，并配节流。

事件形状（照抄 `pushSummonSpawnFx` 那条「纯表现 area 事件」）：

| 字段 | 值 | 为什么 |
| :--- | :--- | :--- |
| `type` | `area` + `from == to` | 原地播，不参与弹道与碰撞 |
| `damage` / `skillId` | `0` / `0` | 不结算，也不进大招通报（`isActiveSkillCast` 第一道闸就是 `skillId <= 0`） |
| `durationSeconds` | `zcEffectDurationOf(healAura)` = 1.0 | 短了播一半被摘、长了停末帧，**两个方向都不报错** |
| `spineAnimation` / `spineLoop` | `eff_buff_heal` / `false` | 一次性 |
| `visualLiftPx` | `49 × scale` | 🔴 `area` 分支读的是**事件级**抬升；目录里的 `liftY` 只有弹道分支读，写错位置 = 「光环贴在地面上」 |
| `effectScale` | `healAuraScaleOf(unit)` | `area` 从不按 `radius` 缩放（§43），唯一入口 |

`layer: 'top'` 登记在目录里：光环比角色小一圈，压地面层会被站在圈里的角色挡住。

### 44.7 尺寸「跟随角色模型大小轻微调整」

```ts
const HEAL_AURA_BODY_FOLLOW = 0.5;      // 半程跟随
scale = clamp(1 + (bodyScale - 1) * 0.5, 0.75, 2)
```

| `bodyScale` | 倍率 | 场景 |
| :--- | :--- | :--- |
| 1 | 1.0 | 标准 |
| 2 | 1.5 | 战神附体 / 生命爆发：全跟随会变成「比人还大的一张光斑」 |
| 0.5 | 0.75 | 缩小：钳下限，否则光环套不住人 |
| 3 | 2.0 | 巨型：钳上限 |

⚠️ 上表是**跟随倍率**，屏上尺寸 = 目录 `nodeScale` × 它。`nodeScale` 原为 `1`（核心光斑 ≈ 一个角色），
2026-11-25 用户实机看完口径「治疗特效缩小成 50%」⇒ **改成 `0.5`**，上面四档倍率不变
（身体大的单位仍然大一点点，不是一刀切死尺寸）。

🔴 **别跟着把 `visualLiftPx` 也乘 0.5**：抬升是屏幕竖直偏移、不是节点本地坐标，
宿主缩小只是「绕同一点变小」，光环中心仍在身体中线；跟着缩会把它沉到脚下。

### 44.8 节流

`HEAL_AURA_MIN_INTERVAL_SECONDS = 0.35`，`Map<unitId, lastAt>` **per-unit**，
不进快照（纯表现，丢了顶多早闪一下；写进快照反而要处理「读档后时间轴回退」）。
不节流的症状是吸血卡「刀刀闪一下」，反而看不出是一次治疗。

### 44.9 首包代价

`heal_aura` 行为组标了 `warmup: true` ⇒ 进 `zcWarmupEffectPaths`。这是**故意**的：
它是唯一一条收不拢到技能车道的表现（出口统一在 `healUnit`），不进预热就必然漏载
（表现为「治疗了但没特效」）。代价是一张 174KB 图集常驻，预热清单 30 → 31 条。

### 44.10 判据

| 文件 | 钉住的东西 |
| :--- | :--- |
| `tests/zcds-heal-fx-batch47.test.ts` | 11 绿：prefab 两级结构 / 骨架 uuid 与动画名 / `loop=false` / 目录寿命与层级 / 直线 75px 分支位置 / 字号与 `+` / `spineLoop` 缺省 / 事件字段 / 半程跟随 4 档 / 节流 / 全链路 |
| `tests/zcds-effect-path-parity.test.ts` | 字面量快照 + `heal_aura` 行为组 + 预热 31 条 |
| `tests/zcds-effect-catalog-parity.test.ts` | 增量路径清单（第 45/46/47 批共 4 条一并补登） |
| `tests/zcds-prefab-integrity.test.ts` / `zcds-fx-prefab-existence.test.ts` | `__id__` 不越界 + 节点 `_prefab` 必须指到 `cc.PrefabInfo` |

### 44.11 遗留

- 特效的视觉尺寸只按「中枢光斑 ≈ 一个角色宽」估到 `nodeScale 1`（2026-11-25 已按实机缩到 `0.5`）；骨架没导出 bounds，
  精确值只能在实机上对一眼。要调大小**只改目录那一格**（事件级 `effectScale` 在其上再乘）。
- 1.0s 的 clip 配 0.2s 的飘字：数字先走完、光环还在播。若嫌光环尾巴长，改
  `ZC_EFFECT_TUNING.healAuraSeconds` 会同时把事件寿命缩短（两个数同源，别分开改）。
- 治疗光环没有音效（需求没提）。

## 45. 大招通报：传说卡放主动技（卡面形象 + 技能名，2026-11-25 第 48 批 / 二次口径）

需求原文：「战斗中，玩家方的橙色品质的卡首次释放任意的主动技能时播放通报特效。在特效上
叠加卡牌的形象图片（目录在 cardhead 中），伴随特效出来的还有技能名字，在形象的下方，
使用白色粗体字 + 黑色描边 2px，整个特效的比例贴近参考图」。

**二次口径（2026-11-25，用户补的）**：「应该是**任意的主动技能都弹**，两个主动技能时
**按顺序弹**，每次展示 **2.3s**」。⇒ 三处改动：

- 记账粒度从「卡」落到「**卡 + 主动技**」（`announcedActiveSkills`，键 `cardId:skill:<skillId>`
  / `cardId:behavior:<behaviorKey>`）：科学家的文明之火播过，精密陷阱照样播；
- 队列**串行**（`pushSkillAnnounce` 里 `startedAt = max(now, 上一条结束时刻)`）：两条同时触发
  也不叠在同一个角色头上；
- 单条时长 `ZC_SKILL_ANNOUNCE_SECONDS = 2.3`（全显段 1.66s + 淡出 28%），
  `ZCSkillAnnounceStyle.ZC_SKILL_ANNOUNCE_FALLBACK_SECONDS` 同值。

**判据（判「真正施法那一拍」）** —— 与 `ZCBattleAudio.clipOf` 逐条同源，不许另造一套：

1. `event.owner === 'player'`（只听玩家方）；
2. 卡面品级 `card.rarity === 'gold'`（`RARITY_IDS` 的顶档 = 橙色/传说）；
3. 按 `cardId:技能键` 记账（`announcedActiveSkills`）：**每条主动技一局各播一次**，且只有
   真正入队才算「播过」—— 坐标非有限 / 队列满被拒时要留着下次机会；
4. `isActiveSkillCast`：先挡 `beamHold` / `effectKey === 'hit'`；`empowered`（武将技）直接算；
   普攻行（`attackSkillId`）不算；其余只认 `activeSkillIds` 且真的结算了伤害
   （冲锋护盾 / 召唤 / 践踏落点也带 `skillId` 走同一条 `combatEvents`，只看「skillId 不是普攻」
   会在一批根本没施法的表现上弹通报）。

**技能名**：武将技事件名是 `<普攻名>·强化`，**不是**技能表里的名字 ⇒ 真名从
`unitDefinition(unitId).empoweredProfile?.name` 取（如「天降神拳」）；取不到才退回事件名并
`stripSkillVariantSuffix`（只剥 `·强化` / `·投枪`）。

**样式（`ZCSkillAnnounceStyle`，零 `cc`）**：形象高 165（≈ 屏高 13%）、抬升 86、名字 30、
间距 6、描边 2、入场 `0.72 → 1`（占 14%）、尾段淡出占 28%。三层（底光 / 形象 / 名字）共用
**同一个 `Color` 实例**，不加 `UIOpacity`（那是第二个真源）。描边只能走
`Label.enableOutline / outlineColor / outlineWidth`（`cc.LabelOutline` 在 3.8 已废弃）。

🔴 三个坑：

- **形象取 `presentationArt.cardArtFrames`**（卡表 `headIcon` → `icons/cardHead/**`），
  不是 `legendRoleArtFrames`（后者的语义是「阵容页立绘」，目前两表同值但别混用）。
- **底光必须按骨架画布高反算缩放**：`landscape_tab_anim` 画布 352×352、卡面只有 165，
  照抄 `setScale(1.35)` 会放大到 475 把形象整个盖住，且不报错。走
  `getRuntimeData(true).height`（`ZCUnitView.spineCanvasHeight` 同一条路），取不到退回 1。
- **`ZCSkillAnnounceStyle` 不许 `import` `ZCBattlePresentationQueue` 的常量**：视图单测夹具
  只按 `zcds/view|ui` 解析相对模块，反向引用会让整组渲染用例报
  `Missing view fixture module`（实测 render-performance 一组 7 条全红）。同值各写一份 +
  用例断言相等（`ZC_SKILL_ANNOUNCE_FALLBACK_SECONDS`）。

判据：`tests/zcds-skill-announce.test.ts`（事件路径那部分，见组 ①②③④⑤）。

### 45.1 行为车道技：判据从「战斗事件」补到「车道回调」（2026-11-25 二次修复）

用户现场：「战斗中，新加的橙色卡牌播放立绘动画没有展示」。

**根因不在视图**。上面那 4 条判据全靠战斗事件里的 `skillId` 身份，而新加的橙卡
（68031~68035 一批）的主动技是**行为车道**（`fire_zone` / `trap_place` / `blink_strike` /
`dash_chain` / `self_cast` / `random_strike`），这些技能**在基表 `pvpSkill` 里根本没有行**：
`ZCSkillResolutionSystem` 结算时套的是本卡普攻行（`definition.attackProfile`）⇒ 事件的
`skillId = attackSkillId`、`skillName = 「科学家普攻」`，第 4 条判据第一小步就当普攻丢掉；
这批卡的 `empoweredEvery` 又是 0 ⇒ 武将技那条腿也不成立。结果：**一次都不播、零报错**。

**修法**：通报改在**车道回调返回成功**那一拍发起 —— `ZCSkillTriggerSystem` 里
「`context.castXxx(...)` 返回真 ⇒ 消费 CD」是全工程唯一的「施法成功」信号。

| 车道 | 通报挂在哪 |
| :--- | :--- |
| 13 条有 `castXxx` 回调的（`fire_zone` / `trap_place` / `splash_shot` / `ray_beam` / `storm_zone` / `bolt_strike` / `chain_damage` / `self_aura` / `burst_aura` / `spore_burst` / `fan_slow` / `wind_bolt` / `missile_barrage` / `summon_unit`） | 模型里 `castWithAnnounce(key, unit, cast)` 包一层 |
| `charge_shield`（返回位移格数） | `dashWithAnnounce`，`> 0` 才算 |
| `blink_strike` / `dash_chain` / `single_strike` / `charge_shield` / `legacy_dash` | 共用 `blinkTo` ⇒ **行为键由调用方透传** |
| `self_cast`（自己挂增益）/ `random_strike`（走 `strike`） | 没有回调可包 ⇒ 触发系统在「CD 已消费」「`hits > 0`」那一拍回调 `announceCast(unit, key)` |

**技能名**：只能取构筑期冻结的 `pvpSkillPlan.skillName`（`ZCSkillPlanRecord.skillName` →
`ZCCompiledModifierLoadout.skillPlans` → `ZCMatchConfig.modifiers`），模型建
`unitId:behaviorKey → 名字` 索引（`zcAnnounceSkillNameIndex`，同名多级行取先出现的）。
**取不到名字就不播** —— 不许拿「XX普攻」或车道键名冒充。

**为什么现场看不出问题（2026-11-25 二次）**：这条链路**不播时没有任何异常**。所以在
`ZCSkillCastDiagnostics` 里开了独立一档 `ZCDC_LOG_SKILL_ANNOUNCE`（默认开、前缀 `[大招通报]`）：

- 索引懒建时打一行「本局橙卡 → 可通报的技能名」—— 一眼分清「名字压根不在索引里」
  （构筑期没带上 / 技能没解锁 / 表没更新）还是「名字在，但触发没走到」；
- 每个失败门（不是橙卡 / 名字没查到 / 被队列拒收 / 这条已播过）按 `cardId+原因` 各留一行；
- 入队成功也留一行。排查时按 `[大招通报]` 过滤即可，不在每帧路径上。

🔴 三个坑：

- **`ReadonlyMap` 不许下标取值**：`announceSkillNamesOf()[key]` 恒 `undefined`，编译器不报
  ⇒ 三道门全过、一条都不播。本批真踩到，必须 `.get()`。
- **`blinkTo` 的行为键必须由调用方给**：这条回调被 5 条车道共用，写死 `blink_strike` 会让
  `dash_chain`（仙桃行者「腾云驾雾」）永远查不到名字 —— 与本次 bug 同一种死法。
- **车道技事件的 `skillId` 记 0**：基表没有行，没有可记的 id；视图也不用它。通报只写
  「形象 + 技能名」。

判据：`tests/zcds-skill-announce.test.ts`（31 条；⑤ 之前是视图/队列，⑥ 是源码守卫，
⑦ 是**真模型全链路** —— 真表 → 真卡池 → 真队列，从车道回调一路走到 `presentation`；
③ 组钉住「串行排队」与 2.3s；⑧ 组钉住美术那份 prefab 的口径）。

### 45.2 美术交付物：`大招技能提示特效` 预制体（2026-11-25 第三次）

用户现场：「因为特效的预制体没做所以看不到，可以参考已有的结构实施」。

**先纠正一个前提**：运行时那条通报**不读 prefab** —— `view/ZCSkillAnnounceFx.createZCSkillAnnounceNode`
在代码里 `new Node` 组装（播放内容 100% 运行时才定：卡面图按 `pvpCard.headIcon`、技能名按计划行）。
所以「没有 prefab」本身**不会**导致不播，真因见 §45.1。但美术 / 策划确实需要一份能打开来
看结构的文件，于是按 `通用治疗特效`（两级 Node + `sp.Skeleton`）与 `建筑死亡特效`
（单 Node + `cc.Animation`）的既有序列化形态补了一份：

`assets/bundles/battle/units/effects/大招技能提示特效/大招技能提示特效.prefab`
（uuid `92ad4ea0-9db3-4e1b-b659-ddcfd40398c0`），三层自下而上：

| 节点 | 组件 | 口径 |
| :--- | :--- | :--- |
| `Glow` | `sp.Skeleton` + UITransform | 骨架 = 同目录 `landscape_tab_anim.skel`（uuid `4c880eb2-…`）；`defaultAnimation` **留空**（运行时取第一段）；`loop = true`（2.3s > clip）；`premultipliedAlpha = false`（与视图同值，否则描边外压一圈黑边） |
| `Head` | `cc.Sprite`（CUSTOM、不裁边、`_spriteFrame = null`） | 165×165 = `ZC_SKILL_ANNOUNCE_ART_HEIGHT`，`y = +(34+6)/2 = 20` |
| `Name` | `cc.Label`（白 30 号粗体 + 黑描边 2px、`overflow = NONE`） | 盒子 320×34，`y = -(165+6)/2 = -85.5` |

root 内容 165×205；四个节点 `_layer` 全是 `33554432`(UI_2D)、`_lscale` 全是 1
（缩放由 `renderZCSkillAnnounce` 每帧覆盖，烘进 prefab 会被整份抹掉）。

🔴 **prefab 与代码是两份、必须逐项同值**：漂掉的表现是「图看着对、实机歪一截」，
不报错、也没有别的信号 ⇒ 由 ⑧ 组按样式常量**反算**断言（坐标 / 字号 / 行高 / 描边 /
骨架 uuid / 三层与 `new Node('Glow'|'Head'|'Name')` 同名 / 与资源计划里的骨架同目录）。

想要视图**真的**读 prefab，还得另做三件事：路径登记进 `ZC_BATTLE_FX_PATHS`、
`ZCGame` 按 `Prefab` 加载（不能走 `loadBattleSpine`）、`createZCSkillAnnounceNode` 改成
先 `instantiate` 再按名找 `Glow|Head|Name` 并保留代码兜底 —— **当前没做**，别以为改 prefab 会生效。

### 45.3 第三类「一条都不播」：运行期表 `remoteRef` 落后于转表产物（2026-11-25 第四次）

通报的名字索引取 `pvpSkillPlan.skillName` + `behaviorKey`，**运行期读的是
`assets/remoteRef/pvpSkillPlan.json`**，而不是 `doc/塔防数据配置/json/client/`。这两份当时差了
一个时代：

| | remoteRef（运行期） | json/client（转表产物） |
| :--- | :--- | :--- |
| 行数 | 2209（11-17 快照，= SVN HEAD） | 2311（11-25） |
| 科学家 103503 | 「射线集束」/ `skill_params` | 「文明之火」/ `fire_zone` |
| 全表 `fire_zone` 行 | **0** | 3 |

⇒ 索引里压根没有 `68035:fire_zone` 这个键，四道门全在「名字没查到」那一关掉光，**一条都不播**。
不是代码问题，是表没同步。同步用 `tools/config/sync_pvp_skill_plan_from_client.py`
（保留该表现有形态：`[` + 行对象 `,\n` 分隔 + `]`，**不是** `{k,v,c}` 列存），
它带三个闸：序列化自检（重建 client 原文必须逐字节相同）、行集合、逐格比对。

🔴 同步「一张表」时会连带暴露两件别的东西，都必须一起处理：

- **`pvpCard.headIcon` 指错目录**：remoteRef 那 35 行还是 `icons/head/xxx`（= `HEAD_ART_ROOT`，
  **玩家头像**），而卡面是 `icons/cardHead`（`CARD_HEAD_ART_ROOT`）。`iconArtTargetOfPath`
  两个目录都在白名单里 ⇒ 不报错、不退占位图，**只是把玩家头像当卡面**（立绘 / 卡牌阵容 /
  通报的卡面图全读这一格）。同步脚本 `tools/config/sync_pvp_card_desc.js`（只动
  `description` + `headIcon` 两列，其余列有线上手动调整的历史，整表覆盖会抹掉）。
- **数据到位才会踩到的源码 bug**：`ZCGameModel.pushSummonAuraZone` 里
  `(params as any)?.summonAuraFx ?? …` —— `params` 是 `summonUnits` 的局部变量，本方法里
  不在作用域内 ⇒ 放技能即 `ReferenceError`。旧表里舞王那条链没有 `summonAuraRadius`，
  这段一次都没进过；同步后一放就炸，`zcds-king-dance` 从 19 红直接变 1 红。
  **判据：`tests/zcds-model.test.ts` 的「remoteRef 与转表产物逐格一致」**（同步前 67/68，
  同步后 68/68）。

剩 27 条 `pvpSkillPlan.desc` 与 `armySkillLevelUp.desc` 不一致（141 → 27，本次同步修掉 114、
新引入 0）—— 那是设计案两个页面的文案漂移，要改 xlsx 真源，属于另一件事。


## 46. 结算胜负 UI 特效与地块翻转同起同落（2026-11-25 第 48 批）

需求原文：「判定出胜负时，地块翻转的结算动画同步播放，胜利播放胜利 UI，失败播放失败 UI
特效，特效需要匹配屏幕宽度 720px，填充整个宽度，持续的时间和地块翻转结算动画时间一致」。

**「地块翻转的结算动画」= `ZCVictorySweep` 的三段式扫场**（铺场 / 回正 / 脉冲）。它没有
"时长常量"可抄 —— 总时长 `victorySweepDuration(stepCount)` 随地图行数变，所以：

1. `ZCVictorySweep.durationSeconds` 暴露本段时长，**和 `isPlaying` 共用同一个函数**；
2. `ZCGameRenderWorld.victorySweepSeconds` 转出来给 `ZCGame.playOutcomeEffect` 用；
3. 特效的 `timeScale = 扫场时长 / 片段时长` ⇒ 整段动画被拉伸/压缩到正好铺满扫场那一段
   （不是"播完就停"，也不是循环）；
4. 销毁时刻 = `outcomeEffectElapsed >= outcomeEffectSeconds`，与 `advanceVictorySweep`
   在同一处、吃同一个 `dt` 推进 ⇒ 两边同起同落（那条「结算总览还没起」的早退分支两边
   都不吃这一帧，否则会拉开一帧）。

**胜负判定**：`frame.snapshot.status`（`victory` / `defeat`）→ `zcOutcomeAnimationOf`。
平局与非胜负态返回空串，不播。

**尺寸**：按画布**宽**折算到 720（`zcUiBannerScale`，骨架画布 744×744、可见横幅 726×257）。
按高归一只有 ~340 宽，与「填充整个宽度」正好相反。⚠️ 这条与特效尺寸那条（`area` 地面特效
按 alpha 紧致 bbox）**不是同一套口径**：这里是 UI 横幅、按画布宽铺满屏幕。

**接口拆分**（2026-11-25 与 §48 一起抽的）：节点组装在 `view/ZCUISpineBannerFx`
（`createZCUISpineBannerNode` / `destroyZCUISpineBanner` / `isZCUISpineBannerAlive`），
数值口径在 `model/ZCUISpineBannerStyle`（`zcUiBannerScale` / `zcUiBannerTimeScale` /
`zcUiBannerCenterOf` / `zcUiBannerCanvasWidthOf` / `zcUiBannerClipSecondsOf`）。
结算与开局**共用这两份**，各自只留「播哪一段、播多久」在 `ZCSettlementOutcomeStyle` /
`ZCBattleStartStyle` 里。原来的 `view/ZCOutcomeEffectFx.ts` 已删。

**层级**：挂 `hudView.node`（HUD 根节点，720×1280 设计坐标）并置顶，**不能**挂
`mapLayer` —— 那条在 ScrollView 里会跟着镜头缩放，宽度就不受控了。居中按父级
`(0.5 − anchor) × size` 反算，不硬写 `(0,0)`。

**资源**：`ZC_BATTLE_FX_PATHS.settlementOutcomeSkeleton`
（`胜利失败UI特效/ddz_sgfc_sl_ani`），`ZCGame` 按 `sp.SkeletonData` 加载、**不进**
`ZC_BATTLE_COMMON_PREFABS`。动画名来自骨架本身：`ddz_sgfc_sl_ani` = 胜利、`ddz_sgfc_sb_ani`
= 失败（atlas 的 `sl` / `sb` 两个 slot；`.skel` 里只有这两段，用例会扫二进制钉死，
美术换骨架后名字对不上会立刻红）。

🔴 两个坑：

- **`shutdown()` 仍要显式收一次**：节点在 `hudView` 子树里、会随 HUD 一起销毁，但组件销毁
  是**下一帧**生效 —— 不先收的话收尾那一帧骨架还在吃 `update`（同 killBanner / 通报口径）。
- **给 `ZCGame.ts` 加 import = 改 N 个用例的沙箱白名单**：`grep ZCDCLogSwitch tests/` 那批
  （含 `loadGameModule()` 这种 `return {}` 的宽松桩）会静默拿到空模块 ⇒ 结算分支抛
  `zcOutcomeAnimationOf is not a function`。宽松桩要给**真模块**，强白名单
  （`assert.ok(name in dependencies)`）要补最小桩。

判据：`tests/zcds-outcome-effect.test.ts`（11 条）。

## 47. 冲锋三卡统一换【战士通用剑气】（2026-11-25 第 49 批）

需求原文：「现有卡牌的角色技能效果中使用了轻骑兵冲锋的统一换成【战士通用剑气】特效，
并制作格式一致的预制，飞行中的定格帧选择 skill_1_24，子弹的朝向目标的方向参考示例图」。

### 47.1 涉及的三条技能（都是冲锋车道）

| 技能 | 卡 | 车道 | 行程 |
| :--- | :--- | :--- | :--- |
| 菌盾冲锋 101204 | 菇八戒 68012 | `charge_shield` | 朝目标方向定长 1 格 |
| 冲锋 102303 | 南瓜战神 68023 | `legacy_dash` | 朝最近敌人 3 格（不超过目标） |
| 尖刺冲锋 102703 | 爆锤莲王 68027 | `legacy_dash` | 朝面朝方向 2 格 |

改前三条共播 `units/projectiles/轻骑兵_冲锋/轻骑兵_冲锋`（木马骑兵冲锋残影）。
出口只有一个：`ZCDashFx.ZC_DASH_EFFECT_PREFAB_PATH` → `ZCSkillTriggerSystem.pushDashCastEvent`。

### 47.2 素材与「飞行定格帧」

源素材是 `070-1-Skill_1_23 … _37` 共 15 帧（1646×673 大画布，内容只占右下 382×437）。
用户口径是「**飞行中的定格帧**选 skill_1_24」⇒ 弹体飞行途中**定格**在这一帧，不逐帧播：

- 只把 `_24` 打进图集（内容框 `(1215,124)-(1597,561)` 裁掉 88% 空白后等比缩到 **123×141**，即屏上尺寸）；
- 其余 14 帧搬去 `tmp/projectile_src/战士通用剑气/`（`CACHE_UNUSED_FRAMES`）——
  留在 bundle 里就是 14 张没用上的大图，`removeImageInBundle` 管不到散图；
- `anim` 仍是单帧 clip（**循环**：单帧不循环在某些机型会闪一下），时长 1/24 只是占位；
- 事件寿命由模型给（`ZCEffectTuning.dashSeconds = 0.3`），**不由 clip 推**。

### 47.3 格式一致的预制体

由 `tools/build_warrior_qi_fx.py` 生成（与第 45/46 批同一套 `build_dart_attack_fx` 底座），
产出三件套 + prefab：

```
战士通用剑气/atlas/070-1-Skill_1_24.png + 战士通用剑气.pac
战士通用剑气/anim/战士通用剑气-loop.anim
战士通用剑气/战士通用剑气.prefab
```

结构与全工程 40+ 个投射物 prefab 同构：根 Node（只分组、无组件、`_lscale 1`）+ 子节点
`offset`（UITransform / Sprite / Animation，**`_lscale = 1`**；尺寸真源是 `_contentSize 123×141`，
2026-11-26 去掉了原来的 0.55 倍率，贴图即屏上尺寸）。

🔴 素材目录原名 `战士通用剑气特效`，本批按「`<效果名>/<效果名>.prefab`」的既有口径
改名为 `战士通用剑气`（目录 meta uuid 保留，无引用受影响）。

### 47.4 🔴 朝向偏移 = 180°（这条最容易漏且不报错）

把 `skill_1_24` 的 alpha 掩码打成字符画就能读出来：**中段的右边界从 57 列缩到 34 列**，
上下两端的边界仍在 57 列 ⇒ 凹口朝 **右**、凸面（刃口）朝 **左**。用户示例图同样是
「凸面朝左 + 红箭头朝左」——箭头 = 飞行方向。

所以美术的正前方是 **−X**，而视图的算式是 `转角 = atan2(Δy, Δx) + facingOffsetDegrees`，
⇒ `facingOffsetDegrees = 180`。漏了它就是「剑气横着飞」，一帧都不报错。

### 47.5 🔴 登记 `flight`，不是 `facingDegrees`

两条路都能把角度转对，但只有 `flight` 会让它**动**：

- `facingDegrees`：位置仍走锚点（第 15 批的 `midpoint`），表现为「剑气凭空贴在半路播一次」；
- `flight`：位置按 `from → to` 逐帧插值、转角走飞行分支，且 `anchor` 对它**不生效**
  （飞行分支在锚点逻辑之前就 `return`）⇒ 目录里 `anchor` 保持默认 `caster`，
  别再抄回 `midpoint`（会让人以为它还在贴中点）。

本批登记：`flight = { speed 420, minSeconds 0.14, maxSeconds 0.6, facingOffsetDegrees 180 }`，
`layer: 'top'`（剑气从角色身前掠过，压地面层会被挡住）。

### 47.6 抬升：必须走事件级 `visualLiftPx`

旧残影画布 120×56，压着冲锋线放只低 28px，看不出问题；剑气是 **123×141**（≈1.4 个兵种高），
居中对齐就等于**一半插进地面**。所以补了 `ZCDashFx.ZC_DASH_EFFECT_LIFT_PX = 40`
（≈兵种视觉腰线），由 `pushDashCastEvent` 写进事件、`ZCCombatEffectView` 的**飞行分支**读它。

🔴 三条不许动的边界：

1. **不能写进 prefab 的 `_lpos`**：宿主节点按弹道转角（剑气朝右时整体转 180°），本地 +Y 会被
   一起转成「侧移 / 下沉」，四个方向的相对高度各不相同，且一帧都不报错。
2. **加在 `mapToViewY` 之后**：位置是父空间坐标，屏幕竖直方向，与转角无关。
3. **飞行分支原来没有这一格**（只有弹道分支读 `zcCombatEffectLiftY`）：本批补上
   `+ (event.visualLiftPx ?? 0)`，缺省 0 ⇒ 存量唯一登记了飞行段的近战特效
   （斧盾兵反击气刃 30271）一个像素都不动。

### 47.7 尺寸：只认 prefab 子节点那一格

被替换的残影是 300×140 画布 × `nodeScale 0.4` = 屏上 120×56。剑气是竖长条（382:437），
按**横向**对齐同一量级：`PREFAB_SCALE = 0.55` ⇒ 屏上 **123×141**。

🔴 目录里**不写** `nodeScale`。`ZCCombatEffectView.render` 每个渲染帧都会 `setScale`
在宿主节点上，而尺寸烘焙在子节点 `_lscale` 里，两处都写就是 0.55 × nodeScale 双重缩放，
改一次大小要动两个地方。要调大小只改脚本的 `PREFAB_SCALE` 重跑。

### 47.8 旧残影为什么还留着

`chargeDash`（轻骑兵_冲锋）已经不在任何行为组里，但**不能删**：配表 `pvpSkill 30191`
「轻骑兵普攻」的 `effectPrefabPath` 就是这条字面量，它不查目录、也不进预热。
目录里那条 spec（`nodeScale 0.4` / `anchor midpoint`）只为它保口径。

### 47.9 判据

| 文件 | 钉住的东西 |
| :--- | :--- |
| `tests/zcds-warrior-qi-batch49.test.ts` | 10 绿：两级结构 + `_lscale 0.55` / 定格帧 = skill_1_24 / 单帧 clip 循环 / 图集 224×256 且已裁空白 / 两条车道改播剑气 / `flight` + 180° + `layer top` + 不叠 nodeScale / 旧残影口径保留 / **全链路 tick 推的是剑气事件 + 带抬升** / prefab 不许带纵向摆位 / 生成脚本仍是唯一入口 |
| `tests/zcds-charge-dash-batch15.test.ts` | 「表现」那条从「中点锚点」改成「飞行 + 180°」（第 15 批的旧口径作废，行为用例一条没动） |
| `tests/zcds-combat-effect-flight.test.ts` | 6 绿：给飞行分支补抬升后，`facingOffsetDegrees` 与位置口径未变（缺省 0 走原路） |
| `tests/zcds-effect-path-parity.test.ts` | 字面量快照加 `warriorQi`；两条车道路径组改 `[warriorQi, dashGuard]`；预热清单换名 |
| `tests/zcds-effect-catalog-parity.test.ts` | 增量路径清单加 1 条 |

### 47.10 遗留 / 观察项

- **抬升 40 是估的**（兵种视觉画布 98 的腰线）。实机上如果觉得刀锋压着头顶或还在地面，
  只改 `ZCDashFx.ZC_DASH_EFFECT_LIFT_PX` 一个数（事件级，三条冲锋卡同时生效）。
- **行程远小于尺寸**：冲锋只走 1~3 格 = 屏上 27~81 px，而剑气本身 123 px 宽 ⇒ 位移幅度
  读起来不明显，主要靠**转角**表现朝向。若实机觉得「只是转了个方向没飞出去」，
  要么把 `PREFAB_SCALE` 调小（0.4 → 98 px），要么按行程拉长 `dashSeconds`。
- 素材丢了 14 帧，只留飞行帧。以后要做命中帧 / 拖尾帧，从
  `tmp/projectile_src/战士通用剑气/` 取回，把 `FLIGHT_FRAME` 扩成 `base.FRAMES` 列表重跑。
- 无音效（需求没提）。

## 48. 对局开始「开局对战」横幅：全景停留那一拍播一次（2026-11-25 第 50 批）

需求原文：「对局开始进入到地图时，镜头最高还没开始推镜头时，播放一次对局开始特效，
对局开始特效要填充满 720 宽的屏幕横度」。

### 48.1 「镜头最高、还没推」对应哪一段代码

`ZCGameHUDView.playMapIntro` 把镜头摆到全景（`mapLayer.setScale(overviewScale)`）之后，有一条
`tween.delay(MAP_OVERVIEW_HOLD_SECONDS = 0.45)` 的停留，再 `.to(MAP_ZOOM_DURATION_SECONDS = 0.9)`
推镜头到 `mapSettleScale`。**那 0.45s 就是唯一可播窗口**，落地成 `mapIntroHolding` 这个旗标：

```
mapIntroHolding = true      // 全景摆好、起 tween 之前
  → playBattleStartEffect() // 同帧就播（不等第一帧 update）
  → tween.delay(0.45).call(() => { mapIntroHolding = false })  // 推镜头开始 = 关窗
  → tween.to(0.9, …)
```

🔴 **关窗必须挂在 tween 上**，不能写在 `mapIntroPlaying = false` 那里：`mapIntroPlaying` 覆盖的是
「入场全程 1.35s」，而需求要的是「最高点那一拍」。挂在 tween 的 `.delay()` 与 `.to()` 之间，
时间就自动跟着 `MAP_OVERVIEW_HOLD_SECONDS` 走。

另外三条会**掐断**入场的路径也必须关窗（否则窗口一直开着，异步补播会在推镜头之后触发）：
`showSpawnSelectionMap()`（选点）、`setSpawnSelectionMode(true)`、`resetMapPosition()`（一键复位）。
三处都在 `mapIntroPlaying = false` 旁边加了 `mapIntroHolding = false`。

### 48.2 一局只播一次 + 骨架异步到货才播

- `battleStartPlayed` 挡重复（`playBattleStartEffect` 每帧 / 每次注入都会调，靠它幂等）；
  **置位在建节点之前** —— 中间抛错也不会下一帧再建一条。
- 骨架必然晚于 `playMapIntro`（那条是 `initialize` 里同步跑的，`assets.load` 是异步的）⇒
  `ZCGame.loadBattleStartBanner` 到货后调 `hudView.setBattleStartEffect(data)`，由 HUD 自己判
  「窗口还开着就补播，已经关了就不播」。
- 🔴 **发起时机必须在 `createGame` 之前**：`createGame` 里 `hudView.initialize()` 会**同帧**跑
  `playMapIntro`，晚一步就一定错过那 0.45s。
- `playMapIntro` 重开会先 `clearBattleStartBanner()` 再清 `battleStartPlayed`：否则重开一局会先看到
  上一局的「对战开始」闪一下（节点挂在 HUD 根上，不随 `mapLayer` 重建）。
- 播完按时长收：`clip + 0.1` 秒后 `scheduleOnce`（`+0.1` 让尾帧播完）；`clip` 读不出来才退
  `ZC_BATTLE_START_FALLBACK_SECONDS = 3`。**永远不留永久驻留**。
- `onDestroy` 显式 `clearBattleStartBanner()` + `battleStartSkeleton = null`（引擎的 `destroy`
  下一帧生效，且骨架引用不放会跟着 HUD 泄漏一局）。

### 48.3 动画名不是猜的

`score_anim.skel` 里只有两段：`dzks_xinxi`（入场，就是这条）与 `dzks_xinxi_jingtai`（静态版，
留给后续「常驻展示」）。atlas 的图块也印证 —— `kaishi` / `kaishi_1`（开始）、
`blue_line` / `red_line`（红蓝阵营线）、`touxiang`（头像框）。
用例扫 `.skel` 二进制钉死这两段名（spine 找不到动画只打日志、不抛，配错名字实机是静默不播）。

### 48.4 铺满 720：与结算那条共用一份口径

骨架画布 560×560、可见横幅 558×109（atlas 里 `blue_line` 是 546×106）⇒
`scale = 720 / 560 ≈ 1.2857`，屏上可见宽 ≈ 717。**按画布宽、不按可见高**。

开局这条**不传 `durationSeconds`**：需求只说「播放一次」，传了就会被 `timeScale` 拉伸成
「铺满某个时长」——那是结算那条的口径（§46）。

节点组装与数值口径都在 `view/ZCUISpineBannerFx` / `model/ZCUISpineBannerStyle`（见 §46），
`ZCBattleStartStyle` 只留三个数：动画名、`CENTER_OFFSET_Y`、兜底秒数。

### 48.5 🔴 又踩了一遍「给 ZCGame 加 import = 改 N 个用例的沙箱白名单」

`initialize` 里新增一次同步发起的加载，直接打穿两处桩：

| 用例 | 桩型 | 症状 | 修法 |
| :--- | :--- | :--- | :--- |
| `zcds-game-resources` | 宽松 `return {}` | `ZC_BATTLE_FX_PATHS` 变 undefined，读 `.battleStartBanner` 抛 TypeError，3 条全红 | 补 `ZCGameResourcePlan` 桩，三条路径给**空串**（命中 `loadBattleSpine` 的 `if (!path) return`） |
| `zcds-spawn-base-confirm` | 强白名单 `assert.ok(name in dependencies)` | `'./view/ZCUISpineBannerFx'` 缺桩 ⇒ 4 条借用/归还整个不跑 | 补 `ZCUISpineBannerFx` / `ZCUISpineBannerStyle` 最小桩 |
| `zcds-hud` | 自建 `cc` 桩 | `sp` 不在 `cc` 里 ⇒ require 期就炸 | `cc` 桩加 `sp: { Skeleton, SkeletonData }`，再补两条 banner 桩 |

顺带修了一处产品侧隐患：`loadBattleSpine` 加 `if (!path) return`。三条骨架是**可选增强**，
路径没配时不能因为一行 `undefined` 把 `initialize` 的 `catch { shutdown(); throw }` 触成
「整局开不起来」。

### 48.6 判据

`tests/zcds-battle-start.test.ts`（14 条，全绿）：

| 分组 | 钉住的东西 |
| :--- | :--- |
| ① 播哪一段 | 两个动画名在 `.skel` 里真的存在且只有这两段 / 静态版不许当开局动画用 / 竖直偏移只走 `ZC_BATTLE_START_CENTER_OFFSET_Y`，通用件里不许出现开局常量 |
| ② 什么时候播 | 窗口在全景摆好之后、起 tween 之前开 / `.delay()` → 关窗 → `.to()` 的先后顺序 / 三条掐断路径也要关窗 / 起播入口自己再判一次窗口 + 幂等 |
| ③ 只播一次、播完收 | 置位在建节点之前 / `playMapIntro` 重开先收残的 / `clip + 0.1` 与兜底秒数 / `only` 语义（不收下一局的） / 异步到货补播 + `hudView` 没了就不碰 / `onDestroy` 显式收 |
| ④ 铺满 720 | `zcUiBannerScale(560) = 720/560`，屏上可见宽 ≥ 714 / 开局这条不传 `durationSeconds` / 画布宽取不到退回 1 不是 0 |
| ⑤ 资源与接线 | 路径只在 `ZC_BATTLE_FX_PATHS` 声明一次、不进 Prefab 预热清单 / 发起时机在 `createGame` 之前 |

## 49. 野怪集火按钮贴到血条上方 3px + 未解锁不出文案（2026-11-25 第 51 批）

> 用户原话（配图圈住野怪格顶上那枚集火按钮）：
> 「特效按钮移动到血条位置上方 3px 的位置，隐藏未解锁的文字提示」

### 49.1 按钮位置：`+4` → `+3`，并抽成常量

`ZCHexView.positionMonsterHeader` 是野怪头顶那组「血条 + 集火按钮」的**唯一写入口**
（每帧算，因为模型头高随 `prefabSize` / 骨架 bounds 变，穷举不了）：

```ts
bar.setPosition(x, barY, …);
focus.setPosition(x, barY + halfBar + ZC_MONSTER_FOCUS_GAP_ABOVE_BAR + halfButton, …);
```

🔴 `barY` 是血条**中心**，所以「按钮底边 ↔ 血条顶边 N px」要 **`+ halfBar + N + halfButton`**
（两个半高各加一次）。只加一个就是中心距，看着比需求高 / 低一整个半高。
`ZC_MONSTER_FOCUS_GAP_ABOVE_BAR = 3` 由 `ZCHexView` 导出，原值写死的 `4` 已删。

别和 `ZC_MONSTER_HEALTH_BAR_GAP = 6`（`ZCUnitView`，管「模型头顶 → 血条底边」）混：
两个间距夹的是不同的两条缝，改一个不动另一个。

### 49.2 prefab 的 `_lpos` 也要跟着走（编辑器 / 归位点）

`ZCGameHex.prefab` 的 `MonsterFocus`：`_lpos.y` **120 → −6.739**。

- 实战坐标每帧被 `positionMonsterHeader` 覆盖，改 prefab **不影响实战**；
- 但它是编辑器里的基准位、也是 `restoreMonsterHeader` 的归位点（`monsterFocusBase` 从它捕获），
  和代码不同口径会让「拖 prefab 一点反应都没有」，事后还得反算；
- 算法：血条 `_lpos.y −40.239` + 半高 9.5 = 顶边 `−30.739`，+3 得按钮底边 `−27.739`，
  + 按钮半高 21 = 中心 `−6.739`。

🔴 **Cocos 的 y 向上**：`_lpos.y + 半高` 是**顶**边，`− 半高` 才是**底**边。本批第一版按
`−30.74 − 3 − 21 = −54.74` 写的（把「向上」当成了「向下」），按钮直接沉进血条底下，
`zcds-resource-unit-preview` 的 prefab 那条断言把它挡住了。

`FocusSpine` 是 128×128、挂在 150×42 的点击区里，**本来就上下各溢出 43px** —— 这是光效
（大于点击区才有"浮在按钮外面"的观感），不要按点击区尺寸去裁它。

### 49.3 未解锁：整段文字收起

`renderMonsterFocus` 里新增一行 `this.monsterFocusLabel.node.active = unlocked;`，
同时未解锁时 `string` 也写空串：

```ts
this.monsterFocusLabel.node.active = unlocked;
this.monsterFocusLabel.string = unlocked
    ? (remaining > 0 ? `${style.text} ${remaining.toFixed(1)}s` : style.text)
    : '';
```

| 为什么两件事都做 | |
| :--- | :--- |
| `node.active` | 硬保证：那一态只有「定格帧 + 压灰」的底特效，读起来就是"点不动" |
| `string = ''` | 顺手把冷却秒数一起挡住 —— 未解锁时 `remaining` 可能非 0，压上去会被读成假倒计时 |

`MONSTER_FOCUS_STYLE.locked.text` 改成 `''`（**这一支不能删**：`styleKey` 还要靠它取
`color 130,140,150`，`renderMonsterFocus` 也仍然只走一个分支）。
`applyMonsterFocusSpine(!unlocked)` 的定格 / 压灰口径不变（见 §…「倒数第 2 帧」那条）。

> 与策划 spec 的差异：`docs/spec/中立野怪规则.md` 仍写「按钮显示未解锁、集火野怪、取消集火和
> 冷却剩余秒数」。2026-11-25 起**未解锁不出文案**，以本条为准（spec 是需求源，未回改）。

### 49.4 判据

`tests/zcds-resource-unit-preview.test.ts` **21/21**：

| 用例 | 钉住的东西 |
| :--- | :--- |
| 野怪按钮显示… | 未解锁 `label.node.active === false` 且 `string === ''`；解锁后文字回来（池化复用不能一直藏着）；颜色仍随 `styleKey` |
| 野怪通过模型表现沉睡与攻击… | `focus.y − 42/2 === bar.y + 19/2 + 3`（写死 3，量的是底边↔顶边） |
| 集火按钮在 prefab 上… | `MonsterFocus._lpos.y − 21 === HealthBar._lpos.y + 高/2 + 3`（编辑器基准位同口径） |

改动只落在 `ZCHexView.ts` + `ZCGameHex.prefab` + 该用例文件；`zcds-hex-activation` 等 26 个
涉及地块视图的用例逐条对过基线（`applyPulseRipple` null、`positionResourceUnit` 带 origin
这类既存红），**零新增**。


## 50. 冰法师通用子弹：急冻瓜两条技能共用一颗弹体（2026-11-25 第 51 批）

需求原文：「急冻瓜的【冰山陨落】【急冻光线】都使用新的冰法师通用子弹特效，制作格式一致的
预制体，飞行中是循环的序列帧，普通子弹飞行时箭头的方向朝向目标，特殊技能垂直下落的子弹时
是箭头方向直线下落，急冻光线使用特效不用拉长，直接当场急冻子弹使用，不用改技能名称」。

### 50.1 一个 Set 两套产物

素材在 `units/projectiles/` 下**平铺散图**（不是 spine），用
`tools/build_ice_mage_bullet_fx.py` 生成两套同构产物（底座是 `build_dart_attack_fx.py`，
与 `战士通用剑气` / `玉米射手_普攻` 完全一致）：

| Set | 用在哪 | 帧 | 采样 | 屏上 |
| :-- | :-- | :-- | :-- | :-- |
| `冰法师通用子弹` | 急冻光线弹体 / 冰山陨落落地一击 | `fashe1_0..6`（7） | 24（0.292s 循环） | 38×77 |
| `冰法师通用子弹命中` | 上面两条的命中爆炸 | `fashe2_00..12`（13） | 12（1.083s 一次性） | 88×128 |

结构 = 两级节点（根 `_lscale 1` 只分组 + 子 `offset._lscale` 是尺寸唯一出口）
+ `Sprite(_sizeMode=0, _isTrimmedMode=false)` + `Animation(playOnLoad=false, wrapMode=2 循环)`。
`xuli_*`（蓄力 7 帧）本轮不用，脚本按 `CACHE_UNUSED_FRAMES` 搬去 `tmp/projectile_src/`。

### 50.2 🔴 素材正前方是 +Y，不是 +X

逐帧量 alpha>8 的框：第 0 帧是 200×200 的冰爆贴上方（y=46），之后内容**只往下长**（到 y=581）、
宽度 200→280 ⇒ **冰爆头在上、尾迹在下**。用户示例图（红箭头自下往上穿过冰爆）是同一个结论。

于是两条路的角度必须分开给，且**都要自洽**：

| 场景 | 走哪条 | 值 | 结果 |
| :-- | :-- | :-- | :-- |
| 急冻光线（水平飞） | 弹道分支：`转角 = 弹道方向 + facingOffsetDegrees` | `-90` | 弹道朝右 ⇒ 转 −90 ⇒ 冰爆头指向右 = 目标 |
| 冰山陨落（垂直落） | 事件级 `angleDegrees`（不查表） | `180` | 素材「上」转到「下」= 箭头直线下落 |

🔴 **两者不能混用**：弹道朝下时 `−90 + (−90) = −180 ≡ 180`，与落地那条完全相等 ——
用例把这两个数钉成「同为 180°」，改任何一个都会红。

⚠️ 旧值 `−90` 是给**旧冰锥**（正前方 +X，水平朝右）用的。换素材时只改路径不改角度 =
冰爆头朝右躺着砸下来（箭头指侧面），且**不报错**。

### 50.3 🔴 弹道分支原来不吃朝向偏移（本批补的）

`ZCCombatEffectView` 的 projectile 分支原来只有一句纯弹道角度：

```ts
const angle = Math.atan2(mapToViewY(toY - fromY), mapToViewX(toX - fromX)) * 180 / Math.PI;
```

melee 的飞行分支却是 `zcCombatEffectFacingDegrees(angle, flight)`（弹道 + 偏移）。
后果：**任何「正前方不是 +X」的弹体横着飞**，而既有所有 projectile 特效的正前方正好都是 +X，
所以一直没暴露。第 51 批改成两处同一套算式：

```ts
const angle = zcCombatEffectFacingDegrees(atan2(...) * 180 / Math.PI, zcCombatEffectFlightOf(path));
```

存量零变化的前提：**登记过朝向的路径都不走弹道**。目前是四条（斧盾兵反击气刃 30271 /
消灭学霸普攻 30713+30852 / 机甲菇扇形 / 战士通用剑气），全是 melee 或 area；
未登记的路径 `flight` 为 null ⇒ 偏移 0。用例 ⑤ 把这条钉住 —— 谁把其中一条改成 projectile，
它就会红，那正是要重新确认朝向的时候。

### 50.4 急冻光线：从「原地闪一下」改成真的飞

`applyRandomStrike` 拿不到 missile spec 时走 else 分支：**目标身上原地播一次 `area` + 立刻结算**。
所以急冻光线以前没有飞行过程，也就没有"朝向目标"可言。本批登记：

```ts
'68024': { missilePrefabPath: iceMageBullet, impactPrefabPath: iceMageBulletImpact, arcOffset: 0, warmup: false }
```

三条配表口径，各有原因：

- `arcOffset: 0` —— 直线飞。弧线（`sin(π·progress)` 横向偏移）是镭射飞龙 68010 的口径。
- **不配 `count`** —— `strikeCount = 3` 要「三个目标各一发」；配了 count 会从候选里重复取，
  3 发砸在同几个人身上（`ZCSkillResolutionSystem` 的 `volley` 切片）。
- 不配 `speed` —— 复用 `attackProfile.projectileSpeed`，与普攻弹速一致。

副作用要知情：伤害结算从「当帧」变成「弹道到达」，麻痹 3 秒同样延后到命中
（走 `onHitStatusId`）。这正是「有飞行才有朝向」的必然代价。

### 50.5 🔴 落地一击的路径以前根本没被资源计划收集

`SELF_AURA_LANDING_FX_BY_UNIT` 是**另一张表**，不在 behavior 组的 `unitPrefabPaths` 里，
`ZCVisualResourcePlan` 也没单独收它。旧 `iceCone` 之所以能显示，是因为它同时是**冰法师普攻**
（pvpSkill 30201）的 `effectPrefabPath` —— 只有本局有冰法师时才被顺带收进去。

第 51 批换路径后这条就断了（本局只有急冻瓜 ⇒ 新子弹不加载 ⇒ 区域照常结算、天上什么都没砸下来、
**且不报错**）。修法：在 `ZCVisualResourcePlan` 的 behavior 循环里补一行
`paths.push(zcSelfAuraLandingPath(key, unit.unitId))`。

### 50.6 「不用拉长」与「不进首包」

- **不拉长**：尺寸只由 prefab 的 `offset._lscale` 定（弹体 0.3、命中 0.5），目录**不登记
  `nodeScale`**，也没有任何按弹道距离 / 判定半径算尺寸的代码。屏上 38×77 ≈ 0.3 格宽、
  0.86 格长（格面 123×90）—— 是「一颗弹体」而不是「一条射线」。用例 ④ 用这个区间兜底。
- **不进首包**：`zcWarmupEffectPaths` 原来把 `zcEffectMissilePaths()` **全部**塞进开战预热。
  两颗 prefab 合计 ~8MB（13 帧命中帧每张 300~600KB）只服务一张卡 ⇒ 给
  `IZCEffectMissileSpec` 加可选 `warmup?: boolean`（缺省 true，镭射飞龙零变化），
  68024 标 `false`，改由 `ZCVisualResourcePlan` 按本局阵容收。

### 50.7 判据

`tests/zcds-ice-mage-bullet-batch51.test.ts`（9 条，全绿）：

| 分组 | 钉住的东西 |
| :--- | :--- |
| ① 格式 | 两级节点 / `offset._lscale` 是尺寸唯一出口 / 根 `_lpos.y = 0` / UITransform = 并集框裁后画布 / `_sizeMode=0` + `_isTrimmedMode=false` / `wrapMode=2` 循环 / 帧数与采样 / `playOnLoad=false` / 自动图集开 `removeImageInBundle` |
| ② 朝向 | 弹道偏移 −90 / 弹道朝右 ⇒ −90、朝上 ⇒ 0、朝左下 ⇒ −225 / 落地 180 / **两条路算出的「朝下」必须同为 180°** / 落地路径只给 68024，其他 self_aura 单位仍是 null |
| ③ 接线 | 登记成 missile（arcOffset 0、无 count、无 speed）/ 既有镭射飞龙 36 与 3 不变 / 落地路径与命中路径都在本局清单里 / 别的卡不在本局时一条都不下 |
| ④ 尺寸与首包 | 目录不登记 nodeScale / 层 `top` / 命中没有 flight / 屏上 20~100 宽、40~140 长 / `warmup: false` 且不在 `zcWarmupEffectPaths()` / 镭射飞龙两条仍在预热 |
| ⑤ 弹道分支 | projectile 与 melee 用同一套「弹道 + 偏移」算式 / `zcCombatEffectFacingDegrees(` 全文只出现 2 次 / 登记过朝向的四条都不是 −90 / 未登记路径仍返回纯弹道角度 |

配套更新：`zcds-effect-path-parity`（`PATH_LITERALS` 加两条，9/9）、
`zcds-effect-catalog-parity`（`POST_MIGRATION_PATHS` + 新增 `POST_MIGRATION_MISSILES` 增量表，6/6）。

---

## 51. 区域洒弹：子弹从区域上方垂直下落（2026-11-25 第 52 批）

需求原文：「篮球天才，急冻瓜，杰克藕这种在指定区域内发射子弹的都需要，让子弹呈弧线飞行到区域的
任意坐标内，在区域内触碰到任意敌方目标造成伤害，没有触碰到就没伤害，**或者选择方案 2 在区域的上方
垂直往下掉，哪个方案实行快就用哪个**」。

### 51.1 为什么是方案 2（这个决定写进了模块注释）

| 方案 | 要动的地方 | 代价 |
| :--- | :--- | :--- |
| 1 弧线飞入 + 触碰判定 | 弹体飞行 + 碰撞检测 + 把「区域 tick / 锁定目标」改成「命中判定」 | **改战斗结算**：三张卡的数值模型全变（区域 3s × 每 0.5s tick → 单发命中），配表、平衡、既有用例一并翻 |
| 2 上方垂直下落 | 表现事件多一个竖直起始偏移，视图按进度递减 | **纯表现**，结算与数值一个字节不动 |

选 2。所以本批只改「子弹怎么落到那一点」，**不改「落到之后伤谁、伤多少」**。
真要「没碰到就没伤害」，那是另一批的战斗结算改造，别在这一层硬塞。

### 51.2 一个可选字段 + 两个纯函数

- `ZCGameTypes` 的表现事件加 `dropFromPx?: number`（**屏幕 px**）。缺省不给 ⇒ 视图拿 0 ⇒
  `+ 0` ⇒ 存量特效位置逐字不变。字段级注释里写清了「这是竖直起始高度，不是坐标」。
- `view/ZCCombatEffectView` 只在**非飞行 area** 那条定位上叠加：

  ```ts
  const dropPx = zcBulletDropOffsetPx(event.dropFromPx ?? 0, progress);
  this.node.setPosition(mapToViewX(event.toX),
      mapToViewY(event.toY) + (event.visualLiftPx ?? 0) + dropPx, 0);
  ```

  🔴 **x 仍取 `event.toX`**，只有 y 加 `dropPx`。和 `visualLiftPx` 同一个竖直轴、同一口径
  （`mapToViewY` 之后是屏幕 y；写进 prefab 的 `_lpos` 会被棋盘转角转成侧移）。
- `model/ZCProjectileDropStyle`（**零 `cc`**）：`ZC_BULLET_DROP_HEIGHT_PX = 84`（≈0.93 个格面高，
  `HEX_GRID_FACE_HEIGHT = 90`），`zcBulletDropOffsetPx = height × (1 − progress)`：
  起播那一帧在最上方，**落地那一刻归 0**（所以 `to` 就是判定点，观感与判定重合）。

`progress` 越界夹到 `[0,1]`、`NaN` 直接返回 0 —— 🔴 `NaN` 泄进 `setPosition` 会让整层矩阵变 `NaN`，
**整片特效消失且不报错**。高度非正 / 非有限值也一律返回 0。

### 51.3 三条车道，各在自己的推送点带一次

| 单位 | 技能 | 车道 | 推送点 |
| :--- | :--- | :--- | :--- |
| `68024` 急冻瓜 | 冰山陨落 | `self_aura` 的**落地那一击** | `ZCSkillResolutionSystem`，紧跟在 `ZC_SELF_AURA_LANDING_ANGLE_DEGREES` 之后 |
| `68008` 杰克藕 | 戈壁箭雨 | `random_strike` 的 **else 分支**（每波 5 支箭各自落到目标头上） | 循环**外**算一次 `const dropHeight = …`，事件里 `angleDegrees: dropHeight > 0 ? 180 : undefined` |
| `68030` 篮球天才 | 篮球火 | `mode: area` 的**地面区域**每波 | `ZCGroundZoneSystem.resolveWave`，经 `context.unitById?.(zone.sourceUnitId)?.unitId` 换回定义 id（⚠️ 第 53 批起改走飞入段，见 §52） |

三条各有坑：

- 🔴 **戈壁箭雨必须补 `angleDegrees: 180`**：素材固有朝 +Y，prefab 的 `arc` / `offset` 子节点已预转
  −90（合成 +X）⇒ 根节点再转 180 才是「头朝下」。不给就是斜着飘下来。名单外**保留 `undefined`**
  （= 走目录登记的朝向），不许写成 `180` 兜底。
- 🔴 **区域只有实例 id**：`zone.sourceUnitId` 是**运行时实例**，直接拿去查名单永远查不到
  ⇒ 必须 `unitById` 换回 `unitId`。漏了不报错，只是「篮球火不掉」。
- 全项目 `dropFromPx: ` 只许出现 **3 次**（用例 ② 数着）。多一处就是有人又给别的技能加了「从天而降」。

### 51.4 名单与范围圈同值，但两张表故意分开

本节写于第 52 批，当时 `ZC_BULLET_DROP_UNITS` 与 `ZCSkillRangeRingFx.ZC_SKILL_RANGE_RING_UNITS`
**同值**（就是这三张卡），但语义不同：范围圈是「这个技能有区域判定」，落下是「这个技能的子弹从天上掉」。

> ⚠️ **第 53 批已改**：`68030` 篮球火改走「从施法者飞入」（见 §52），下落名单只剩 `68008 / 68024`。
> 于是两者从「同值」变成**严格包含**：掉的卡一定也画圈，画圈的卡不一定掉。
> 用例 ① 现在断言的是这个包含关系 + 「68030 仍在圈名单里」。

### 51.5 判据

`tests/zcds-bullet-drop-batch52.test.ts`（5 条，全绿）：

| 分组 | 钉住的东西 |
| :--- | :--- |
| ① 名单 | 恰好 `68008 / 68024 / 68030` / 高度 84 / 名单外一律 0（含 `'68030 '` 带空格、`'680301'`、`''`、`null`）/ 与范围圈名单同值 |
| ① 曲线 | 起播全高 / 一半半高 / 落地归零 / 越界夹住 / `NaN` 不产出 / 高度非法时零位移 |
| ② 字段 | `dropFromPx?: number` 带注释 / 视图 `?? 0` 兜底 / 叠加在 `mapToViewY + visualLiftPx` 同一轴 / **x 仍取 `to`** |
| ② 接线 | 三条车道的锚点各一条正则 / `dropFromPx: ` 全文恰好 3 处 |
| ③ 结算不动 | `hexIdAt(zone.x, zone.y)` 判定圆心不变 / `for (const { unit: victim } of victims)` 不变 / 自 aura 时长口径不被本批改动 |

顺带修一处守卫：`zcds-combat-effect-placement` ⑦ 原来用**固定字符串**
`indexOf('this.node.setPosition(mapToViewX(event.toX)')` 取分支边界，本批把 `setPosition` 拆成多行就取到 `-1`、
断言直接红（跟语义无关）。改成 `/this\.node\.setPosition\(\s*mapToViewX\(event\.toX\)/`
—— 这条守卫钉的是「竖直抬升必须加在 `mapToViewY` 之后」，不该被换行打红。

---

## 52. 篮球火：命中区域钉在敌方单位坐标 + 子弹从本体飞过去 + 无目标不释放（2026-11-25 第 53 批）

需求原文：「篮球少年的【篮球火】技能是以敌方为目标，**在目标坐标释放命中区域**
**子弹从本地移动到命中区域去，没有目标就不释放**，现在命中区域会出现在自己本体坐标」。

拆成三条判据，三条各自的真源不同，别混：

| # | 判据 | 真源 | 本批动作 |
| :-- | :--- | :--- | :--- |
| ① | 圆心 = 敌方单位坐标 | `createAttackGroundZones` 的 `zoneX/zoneY` | 只补注释与用例（代码本来就对，见 52.1） |
| ② | 子弹从施法者飞到圆心 | `ZCProjectileDropStyle` 飞入段 + 视图插值 | 新做（把 68030 从「垂直下落」名单里摘出来） |
| ③ | 没有实体敌方目标就不释放 | `createAttackGroundZones` 开头那道闸门 | 新做 |

### 52.1 先证伪：「圆心在自己脚下」不是代码算错了

用真实 `ZCGameModel` 跑（施法者 `-80`，敌方单位 `60`，`combatDistanceScale = 1`）：

```
t=15.05 area 技能范围_白环  from=[60,0] to=[60,0] src=1@-80     ← 我方那发，圆心在敌人身上
t=15.05 area 技能范围_白环  from=[-80,0] to=[-80,0] src=2@60    ← 敌方那发，圆心在我方身上
t=15.10 area 篮球少年_普攻   from=[60,0] to=[60,0] src=1@-80
zones [ [60,0], [-80,0] ]
```

- 区域圆心与白圈圆心**恒等于 `target.x/y`**（`zoneCount === 1` 时 `offset` 恒 0）；
- `pvpSkillPlan` 全表只有 68006 / 68031 / 68032 带 `zoneSelfCentered`，**30848 一条都没有**；
  36 级参数袋实测 `{"mix.critRate":10,"damageRate":1.4}`。链路（30702 → `empoweredSkillId` 30848 →
  `mode: area` → `createAttackGroundZones`）逐环核对过。

所以「看着在自己脚下」的两种**合法**来源只剩：

1. `zoneSelfCentered = 1`（配表开关，篮球火没有）；
2. 目标本来就贴在同一格 —— 而 `110` 表值半径 ⇒ 屏上横向半径 `110 × 0.76875 ≈ 84.6px`，
   **一颗圈横跨两格**，圆心在贴身的敌人身上时，圈必然压住自己那一格。

第 2 种在画面上就是「圈在自己脚下」，这也正是用户后面两条要求（要看见球飞过去、没目标别放）的由来。
👉 以后遇到同类反馈，先按这个算式判「是不是圈太大 + 目标贴脸」，别急着改落点公式。

🔴 用例侧踩过的坑：AI 那只 68030 也会放篮球火，`filter(e => e.skillId === 30848)` 会把两边混在一起，
于是「圆心在 -80」其实是**敌方那发**打在我方身上的正常落点。必须再按 `sourceUnitId` 收一条。

### 52.2 子弹从本体飞过去：与「垂直下落」并列的第二条纯表现通道

`ZCProjectileDropStyle` 现在有两个**互斥**名单：

| 名单 | 起点 | 观感 | 谁在用 |
| :--- | :--- | :--- | :--- |
| `ZC_BULLET_DROP_UNITS` | 圆心正上方 `84` 屏 px | 天上砸下来 | `68008` 戈壁箭雨 / `68024` 冰山陨落 |
| `ZC_BULLET_FLY_UNITS` | **施法者当时的坐标** | 手里扔出去 | `68030` 篮球火 |

事件侧四个可选字段（`ZCGameTypes`）：`flyFromX` / `flyFromY` / `flyInSeconds` / `flyArcPx`。

- 时长 = `距离 ÷ 600`（`ZC_BULLET_FLY_SPEED`），夹在 `[0.15, 0.55]` 秒 ——
  下限让贴脸也别一帧到位，上限别让飞行吃掉三分之一的区域寿命。
- 弧线 = `arc × 4p(1−p)`（起飞 0 / 正中最高 / 落地 0），峰高 `ZC_BULLET_FLY_ARC_PX = 92`，
  与投掷陷阱那一格同值。加在 `mapToViewY` 之后 ⇒ 屏幕竖直方向，不跟转角走。
- 🔴 视图插值用的是**自己的飞行时长**（`zcBulletFlyProgress(now - startedAt, flySeconds)`），
  **不是事件进度** `progress`：事件要活满区域寿命 3 秒，飞只占开头 0.2~0.4 秒，
  用 `progress` 会让球花 3 秒慢慢挪过去。飞满后退回「钉在 `to` 上原地播」。
- 🔴 事件寿命要 `Math.max(waveInterval, 目录寿命, flySeconds)`：飞 0.55s 却只活 0.3s = 半路消失。
- 🔴 起点必须是**施法者坐标**（`resolveWave` 里 `context.unitPosition(source)`），
  **不能**用区域事件的 `from` —— 那条的 `from` 与 `to` 恒同坐标（`fromX: zone.x`），拿它当起点等于飞 0 距离。

### 52.3 没有实体敌方目标就不释放

`context.currentTarget` 在敌方单位全死光时**不返回 `null`**，而是退化成打城墙 / 打建筑
（`ZCUnitTargeting.current` 的 `kind: 'wall' | 'building'` 两支）。区域照建就会落在城墙坐标上 ——
而地面区域只结算单位（`resolveWave` 只遍历 `unitsInRadius`），砸在墙上一个单位也伤不到，
纯属白放一次 + 白占 14 秒 CD。

```ts
const zoneSelfCenteredEarly = skillParams ? (skillParams.zoneSelfCentered ?? 0) > 0 : false;
const zoneMovingEarly = empowered && skillParams ? (skillParams.zoneMoveSpeed ?? 0) > 0 : false;
if (!zoneMovingEarly && !zoneSelfCenteredEarly && target.kind !== 'unit') return;
```

闸门**只盖「原地 · 以目标为圆心」这一档**：

- `selfCentered`（斗气爆发 / 迪斯科旋风 / 死亡摇滚）本来就落在自己脚下，不需要靶子；
- `moving`（暴风 / 鹿神守护小鹿）从施法者出发沿中轴飞，拆墙时也有意义，不动。

真实模型复算（只放一只 68030、不放敌人）：`structureLocked = true`（最终锁到 `targetBuildingHexId = 24`）、
`completedAttackCount > 0`、**`skillId === 30848` 的区域 0 个、表现事件 0 条**。
同一局里那些 `area:30702`（`path: null`、`radius: 4`、落点 `-18,305`）是**打建筑的出手事件**，
不是区域，别拿它当「还在放篮球火」。

### 52.4 判据

`tests/zcds-basketball-fly-batch53.test.ts`（7 条，全绿）：

| 分组 | 钉住的东西 |
| :--- | :--- |
| ① 名单 | `ZC_BULLET_FLY_UNITS === ['68030']` / 68030 已退出下落名单 / `zcBulletDropHeightOf('68030') === 0` / 两表无交集 |
| ① 时长 | 贴脸 = 下限 0.15 / 极远 = 上限 0.55 / 中距离按距离插值 / 名单外与 `null` 返回 0 / `NaN` 距离退回下限 |
| ① 曲线 | 起飞 0、正中 = 峰高、落地 0 / 进度越界夹住 / `NaN` 峰高返回 0 |
| ② 真模型 | 白圈圆心 = `60`（敌方单位）且 `≠ caster.x` / 区域圆心 = `60` / 飞入起点 = `caster.x, caster.y` / 飞入终点 = `60` / 时长在区间内 / `dropFromPx` 为 0 / 寿命 ≥ 飞行 |
| ③ 真模型 | 无敌人时 30848 事件 0 条、区域 0 个；**前提**：确实锁到城墙/建筑、确实出手过 |
| ③ 闸门 | 条件排除 `moving` 与 `selfCentered` / 两个 `Early` 变量取值口径 / 圆心仍只认 `target.x/y` |
| ② 视图 | 用自己的时长插值 / x 从起点到 `to` / 抛物抬升 / 缺字段退回原地播 / 起点取 `unitPosition(source)` / 寿命取 max |

配套更新：`zcds-bullet-drop-batch52.test.ts` 的 ① 与 ②（68030 退出下落名单 ⇒ 期望值从三张卡变两张；
「与范围圈同值」改成**严格包含**，并额外断言 68030 仍要画圈）。

### 52.5 一处口径提醒

本批**没有**改成「让区域真的飞过去」（区域自带 `flightSeconds` 那套，投掷陷阱 101704 在用）。
原因：篮球火是 `waves: 1`、波次间隔就是 3 秒 —— 区域一旦真的位移，第一波伤害要么落在施法者脚下结算、
要么得把 `nextWaveAt` 往后推，两种都是**改战斗节奏**。用户要的是「命中区域在目标坐标」，
判定就该从第一拍起钉在那儿，只有球是飞过去的。

---

## 53. 野怪：集火特效贴血条 3px + 身体三态染色 + 被玩家方打下补出生特效（2026-11-26 第 54 批）

需求原文：「1. 野怪按钮特效的位置应该在血条的上方 3px；2. 野怪未激活整体叠加一层灰色不透明度为 35%；
3. 野怪激活后去掉灰色，改成叠加暗色（类似敌方卡牌）；4. 野怪被玩家方击败，播放卡牌单位生成特效，
把颜色改回正常颜色，去掉叠加的暗红色」。

数字真源集中在 **`model/ZCMonsterPresentation.ts`**（零 `cc`，用例直接断言数值）：
布局两条算式、三态枚举、灰/暗红/不透明度四个常量、待机倍速。

### 53.1 🔴 特效的锚点是「可见特效的底边」，不是按钮中心

`FocusSpine` 是集火按钮的子节点，它的美术**从节点原点往上长** ⇒ **原点就是可见特效的底边**。
此前原点 = 按钮中心 = 血条上方 `3 + halfButton(21) = 24px`，所以图上看是「飘在血条上方一大截」——
用户截图圈的就是那段空档（他圈的第二处是空位，即「应该放这儿」）。

现在：

```ts
barTopY = barY + halfBar
buttonY = zcMonsterFocusButtonY(barTopY, halfButton)        // 底边 = barTop + 3
focus.setPosition(x, buttonY, …)
spine.setPosition(spine.position.x, zcMonsterFocusSpineY(barTopY) - buttonY, …)  // = −halfButton
```

即**特效原点压到点击区底边那条线** = 血条顶边 + 3px。改法是**运行时**（在 `positionMonsterHeader`
这个唯一写入口里）而不是改 prefab 的 `_lpos`：按钮高度若在 prefab 上调，两条线自动跟着走。
`restoreMonsterHeader` 补了 `monsterSpineBase` 的还原（池化复用，否则下一个非野怪格的特效停在压过的位置）。

### 53.2 三态染色

| 态 | 判据（`zcMonsterTintStateOf`） | 颜色 | 待机倍速 |
| :--- | :--- | :--- | :--- |
| `sleep` 未激活 | 中立 + 没被集火 | `(0xB4,0xB4,0xB4, 255)` = 灰 × 0.70，**不压透** | 0.35 |
| `awake` 激活可打 | 中立 + `awake` + `hp > 0` | `(0x96,0x54,0x54, 255)` = 暗红 | 1 |
| `captured` 被玩家方打下 | **`owner !== 'neutral'`** | `Color.WHITE`（不染） | 1 |
| `null` 不是野怪 | `monster === false` | 不动 | 1 |

四条口径：

- 🔴 **归属优先于 `awake`**：野怪被玩家方打下来后 `neutralResourceId` 是**故意留着**的
  （`ZCDevelopmentSystem`：「出生格的生命值仍由中立野怪战斗结算持有」）⇒ 这一格还会画那只野怪，
  这时必须回正常色，而不是继续挂暗红。只看 `awake` 永远等不到「打下去了」那一态。
- 🔴 **血空不算能打**：`awake` 置真后不会自己复位，判据必须自己看 `hp`（否则尸体一直挂暗红）。
- 🔴 **「叠加一层带透明度的颜色」≠「整体变透明」**（2026-11-26 用户澄清）：
  曾经 `ZC_MONSTER_SLEEP_ALPHA = 0x59`（35%）⇒ 整只怪半透明、地皮网格透过身体，读成幽灵。
  现在 alpha 钉 255，未激活只走**压亮**（灰 0xB4 ≈ ×0.70）。
  - 真正的「35% 灰罩」= `mix(原色, 灰, 0.35)`，**顶点色乘法做不到**（乘法只等比压暗，不改饱和度），
    必须加一个自定义片元材质（样板：`assets/resources/shaders/unit-outline-copy.effect` +
    `new Material().initialize({ effectAsset })`，项目已在巡逻怪描边上用同一套）。
  - 「去色变灰」同样要片元（亮度 `dot(rgb, 0.299/0.587/0.114)`），**不比灰罩省事** ——
    两者是同一个 shader 换一行公式，可做成 `u_veilColor` + `u_veilAmount` 两个参数。
  - 现状是「先压暗上机看观感」的过渡态：要更暗只调 `ZC_MONSTER_SLEEP_GRAY`（往下 = 更暗）。
- 旧的 `MONSTER_SLEEP_TINT = (130,150,180)` 蓝灰已删干净（用例守 `doesNotMatch`）。

### 53.3 「被玩家方击败」那一拍：置标志 → 渲染层取走

出生特效在 `ZCEffectPool`（渲染层持有），视图拿不到；而「刚改归属」只有视图每帧看得到
（`renderContent` 里已经有 `state.owner`）。所以走一条单向通道：

```
ZCHexView.renderContent → noteMonsterCapture() → monsterCapturedFxPending = true
ZCGameRenderWorld.renderNeutralFeatures → consumeMonsterCapturedFx()（取走即空）
        → effectPool.playSpawnFx(monsterView.monsterFxHost, now)   // 与卡牌单位出生同一份 prefab
```

- 🔴 只认 `ZCOwner.Player`：敌方打下别人的野怪该回正常色，但**不该播我方出生特效**。
- 🔴 只认「上一帧中立 → 这一帧非中立」这一拍；`initialize` 必须复位
  （池化复用会把上一局的 `true` 带回来，新局第一帧就在空地上播一次）。
- `monsterFxHost` = `resourceUnitNodes[0]`；资源单位被隐藏时返回 `null`（跳过，不报错）。

### 53.4 判据

`tests/zcds-monster-status-batch53.test.ts`（5 条，全绿）：

| 分组 | 钉住的东西 |
| :--- | :--- |
| ① 判据 | 非野怪（三种 owner）恒 `null` / 未激活 / 激活 / **血空退回 sleep** / **归属优先 captured**（含敌方打下）/ 归属改了即使满血也是 captured |
| ② 数值 | 灰三通道同值且不是全黑 / **alpha 恒 255（不压透）** / 暗红 = 红高于绿、绿蓝同值、整体压暗 / 激活不透明 / captured 全白 / 倍速只 sleep 是 0.35 |
| ③ 布局 | 按钮底边 = 血条顶 + 3 / 特效原点 = 按钮底边 / 间隙可覆写时两条线一起走 |
| ④ 视图 | 旧蓝灰常量与旧两态变量 `doesNotMatch` / 三态走纯函数 / 特效单独落位（局部 y = 目标线 − 按钮中心）/ `restoreMonsterHeader` 还原 + 进态前存基准 / 一次性标志的两个守卫 / `consume` 取走即空 |
| ④ 渲染层 | `consumeMonsterCapturedFx()` 全工程恰好 1 处 / 取到就 `playSpawnFx(host, now)` / 它与 `renderMonsterFocus` 在同一分支 |

配套更新：`tests/zcds-resource-unit-preview.test.ts` 的野怪用例 —— ① 桩状态补 `hp/maxHp`
（真实血量来自 `definition.maxHp`，本批起「能打」要看 `hp > 0`）；② 激活断言从「原色」改成**暗红**；
③ 末尾补「归属改成 player ⇒ 回白 + `consume` 首次 true、再次 false」。

## 54. 角色前后关系：层次 + 屏幕 y（2026-11-26 第 55 批）

用户讨论后拍板的四条：

> 「1. 血条不独立于单位 2. 地面一层按 y 排、飞行/中立资源的野怪整体压在地面之上
> 3. 分身（召出来的）现在被强制排在所有普通单位之下 4. 与墙砖同口径（y 大的先画）」

起因是原始反馈：「当角色重叠在一起时，更底下的角色模型在上层，包括他的描边层和血条」。
病根很简单：**单位根本没有按深度排过序** —— `attachToMapLayer` 把新单位 append 到 `mapLayer` 末尾，
顺序 = **出生先后**，与屏幕位置毫无关系；唯一的例外是分身，靠 `applyUnitDrawOrder` 出生时插队。

### 54.1 三个层次与「y 大的先画」

判据与比较器都在 **`model/ZCCharacterDrawOrder.ts`**（零 `cc`，用例直接断言）：

| tier | 谁 | 为什么 |
| :--- | :--- | :--- |
| `0` 分身 | `summonMasterId !== undefined` | 半透明复制品必须垫在本体之下，否则「本体也跟着变透了」（§34） |
| `1` 地面 | 其余单位 | 同层内按 y 排 |
| `2` 空中 | 卡表 `pvpCard.flying` / **中立资源野怪** | 用户口径 2：整体压在地面之上 |

```ts
if (a.tier !== b.tier) return a.tier - b.tier;   // 小的先画 = 更靠后
if (ay !== by) return by - ay;                  // 🔴 y 大的先画
return a.id - b.id;                             // 同 y 稳定兜底
```

- 🔴 **「y 大的先画」不是随便定的**：`+y` 在屏幕上是「更靠上 / 更远」，远者先画、近者压上来，
  才有「站在前面的人挡住后面的人」。**城墙砖就是这么排的**（`ZCWallRenderer`：`b.segment.y - a.segment.y`），
  单位沿用同一条式子，别再各写一份（用例双边守）。
- 🔴 **`id` 那一档不是装饰**：同层同 y（两兵叠在同一格、插值中间刚好重合）没有稳定兜底就会
  「每帧顺序抖一下」—— 描边和血条跟着闪。id 一局内唯一且不变。
- `y` 可能是 `NaN`（首帧插值还没跑过）⇒ 当 `0`，绝不能让比较器返回 `NaN` 把 `sort` 搅乱。
- 分身优先于飞行：一只**会飞的**分身照样垫底（用户要的是「分身整体在普通单位之下」）。

### 54.2 角色层：`mapLayer/CharacterLayer`

跨父节点比不了兄弟序，所以单位与野怪必须住进同一个容器：

- `ZCGameRenderWorld.characterLayer`：`initialize` 里建一次，**贴在棋盘之后第一位**
  （`board.getSiblingIndex() + 1`）。
  🔴 为什么是这个位置：地面特效走 `zcCombatEffectSiblingIndex('ground')` = `boardIndex + 1`，
  插进来会把角色层顶到 `+2` ⇒ 地上的火圈 / 光斑仍然画在角色**脚底**（§「火焰树妖灼热地带」那条不能被这批改坏）。
- 单位：`attachToCharacterLayer`（池里取出来 → 挂角色层末位 → 同步 layer）。
  没建出角色层（单测桩没走 `initialize`）⇒ 退回 `mapLayer`，**不排序**，宁可不排也不按猜的父节点乱挂。
- 野怪：身体从 `ResourceLayer`、血条与集火按钮从 `CooldownOverlay` 一起搬进来（见 54.3）。
- **血条 / 描边不单独排**（用户口径 1）：单位的血条与描边本来就是单位节点的子节点
  （`ZCGameUnit.prefab` 子序 `[VisualRoot, …, HealthBar, FootPoint]`；描边是 `VisualRoot` 内的
  `[OutlineCopy, Visual]` 副本），跟着自己单位一起被挡，天然满足口径 1。

### 54.3 🔴 野怪是「一整组」，不是三个独立角色

组内层序恒为 **身体 → 血条 → 集火按钮**（`extras`），**不按各自的 y 单独排**。

理由：血条画在头顶、y 比身体大，若让它自己参与排序，会被判成「更远先画」⇒ 反过来被自己的身体盖住。
这既是用户口径 1 的直接推论，也是老代码里那句「举锤或展翼时，模型仍画在血条和可点击的集火按钮下方」
要保住的东西。

搬层的时机是个坑：

- 🔴 **只能在开打后的帧里搬**（`renderMonsterFocus` 每帧触发 `syncMonsterTrailingNodes`），
  不能在 `layoutResourceUnits` 里顺手搬 —— `initialize` 里 `injectResourceUnits`（建骨骼）跑在
  `attachCooldownOverlay`（把血条抬到 `CooldownOverlay`）**之前**，搬早了会被随后的抬高逻辑
  按错误的坐标系重新落位（血条飘到棋盘原点）。
- 搬层**不需要改任何坐标**：`positionResourceUnit` / `positionMonsterHeader` 的 `origin` 判据是
  「父节点是不是格节点」，角色层与 `CooldownOverlay` 同在最原点 ⇒ 同一套算式照用。
- 退出野怪态（`hideResourceUnits` / `rebuildResourceUnits` / 换局）走 `restoreMonsterHeader`：
  位置还原 + **父节点还原**（`monsterBarHome` / `monsterFocusHome`）。
  🔴 这一根血条城墙和建筑也在用，留在角色层会被当成野怪的一部分去排。
- 集火按钮不再往 `MonsterFocusLayer` 抬（那个层已删）：它属于野怪那一组，跟身体同进同出。

### 54.4 每帧重排，但「没变就一个下标都不写」

`renderCharacterOrder` 挂在 `renderDynamic` 的**最后一步**（单位与野怪这一帧的位置都写完了才排，
否则读到的是上一帧的 y）：

1. 收集 → 单位槽（`unit.id` / tier / `node.position.y`）+ 野怪槽（`id = -(hexId+1)` / tier 2 / 身体 y）；
2. `sort(zcCharacterDrawOrder)`；
3. **与上一帧的「id 序列 + 每组节点数」逐项比对**，一致就 `return`；
4. 不一致才升序落位（`if (node.getSiblingIndex() !== index) node.setSiblingIndex(index)`）。

- 🔴 第 3 步是性能闸：`setSiblingIndex` 会让 cc 重建这份渲染数据，46 个单位每帧全量写 = 白扔一半帧。
- 🔴 槽位对象**复用**（`characterOrderSlots`），不每帧新建 —— update 路径不许分配临时对象。
- 野怪 id 取负数：同 y 时垫在单位之下，且与 `unit.id`（正数）不会撞。

### 54.5 判据

`tests/zcds-character-draw-order-batch55.test.ts`（6 条，全绿）：

| 分组 | 钉住的东西 |
| :--- | :--- |
| ① 层次 | 三层次序 / 普通地面 / `flying` / `monster` / 分身 / **分身优先于飞行** / 缺字段一律地面 |
| ② 比较器 | 层压过 y / y 大的先画（排序结果降序）/ 同 y 用 id 且输入顺序不影响结果 / `NaN` 当 0 且不返回 `NaN` / **与墙砖同一条式子**（双边源码守） |
| ③ 角色层 | 位置 = 棋盘之后第一位 / 地面特效仍在角色之下 / 单位挂角色层 / 没层时退回 `mapLayer` |
| ③ 重排 | 分身垫底 → 地面 y 降序 → 空中层按 y（野怪整组跟在身体后）/ 同一帧重排零写入 / y 变了必须重排 / 野怪不跟地面混排 |
| ④ 野怪成组 | 身体 / 血条 / 按钮同进角色层且组内有序 / `extras` 不含身体 / 幂等 / 退出时父节点还原 / 没注入层不搬 |
| ④ 源码守卫 | `applyUnitDrawOrder` / `summonEntityIds` / `MonsterFocusLayer` 全部消失 / 排序在 `renderNeutralFeatures` 之后 / 搬运在「不可见就早退」之前 |

配套更新：`tests/zcds-resource-unit-preview.test.ts` 的集火按钮用例 —— 从「按钮被抬到
`MonsterFocusLayer` 压住后生成的单位」改成「不再单独抬顶、留原层；层级交给角色层统一排」。

## 55. 弹道雨：三张卡从自身抛出一批子弹、贝塞尔落到区域内任意点（2026-11-26 第 55 批·表现层）

用户原话：

> 「杰克藕的戈壁箭雨、急冻瓜的冰山陨落、篮球天才的篮球火，三个卡牌的技能都是
>  **从自身发射多个技能子弹到区域的任意落点，子弹呈贝塞尔曲线飞行**」

配套的同批需求（同一个会话提的，落在 §55.6）：

> 「增加保底逻辑，没有目标不释放技能，有目标释放后，即使目标死亡，也会继续播放，
>  **一定是整个技能动作做完**」

### 55.1 第三条区域洒弹通道，与 §51 / §52 并列互斥

| 通道 | 起点 | 落点 | 颗数 | 轨迹 | 表 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `dropFromPx`（§51） | 区域正上方 | `to` | 1 | 竖直直落 | `ZC_BULLET_DROP_UNITS` |
| `flyFromX/Y`（§52） | 施法者 | `to` | 1 | 对称抛物线 | `ZC_BULLET_FLY_UNITS` |
| **`flyFromX/Y` + `flyToX/Y` + `flySwayPx`（本批）** | 施法者 | **区域内随机点** | **N** | **二次贝塞尔** | `ZC_BULLET_RAIN_UNITS` |

同一张卡只走一条。表在 `model/ZCProjectileDropStyle.ts`：

```ts
'68008': { channels: ['strike'], count: 5, arcPx: 120, swayPx: 34, spreadRatio: 0.85, faceAlongPath: true }
'68024': { channels: ['aura'],   count: 3, arcPx: 130, swayPx: 30, spreadRatio: 0.80, faceAlongPath: true }
'68030': { channels: ['zone'],   count: 3, arcPx: 110, swayPx: 28, spreadRatio: 0.75, faceAlongPath: true }
```

### 55.2 🔴 必须按「通道」分流，不能只按 `unitId`

`68024` 急冻瓜身上挂着**两条**技能：冰山陨落（`self_aura` 的落地那一击，本需求要改）与
急冻光线（`random_strike`，本需求没提）。只看 `unitId` 会把急冻光线一起改成三颗弧线 —— 超出需求且没人会发现。

⇒ `zcBulletRainStyleOf(unitId, channel)` 双参，三处调用点分别传 `'zone'` / `'aura'` / `'strike'`。

### 55.3 🔴 控制点 = 2 × 峰高

二次贝塞尔 `B(t) = 2(1−t)t·ctrl`，中点只走到 `ctrl/2`。直接把峰高当控制点 ⇒ **屏幕上量到的弧只有配置的一半，且不报错**。
`zcBulletRainPath` 里写的是 `ctrl = 弦中点 + (2·swayPx, 2·apexPx)`，所以 `t=0.5` 处的实际抬升正好是 `apexPx`。
一维对照函数 `zcBulletBezierOffsetPx(apexPx, t)` 同理，内部乘 2。

### 55.4 🔴 曲线必须在**屏幕空间**求值

`flyArcPx` / `flySwayPx` 是屏幕 px 量。先在世界坐标插值再 `mapToView`，会被 x / y 两档换算比拉扁
（横向 0.76875、纵向另一档）⇒「峰高 120」量出来不是 120。视图里的做法：

```ts
const path = zcBulletRainPath(
    mapToViewX(originX), mapToViewY(originY),
    mapToViewX(landX),   mapToViewY(landY),
    event.flyArcPx ?? 0, event.flySwayPx ?? 0,
);
```

朝向走**解析导数**（`zcBezierTangentDegrees`，`B'(1) = 2(P2−P1)`）而不是「取 t 与 t+ε 两点求差」：
ε 在 t 接近 1 时会跑出曲线外，且端点的导数不该退化成 0（落地那一帧朝向突然归零很扎眼）。

### 55.5 🔴 落点是表现、判定一个字节不动

`to` / `zone.x/y` 是战斗结算用的（`zcGroundZoneReaches` 跟着它走）。所以另起 `flyToX` / `flyToY`
专门承载**表现落点**：`to` 一动不动，`flyTo*` 只决定子弹看起来落在哪。
戈壁箭雨那条通道在 `strikeTargets` 里 `to` 也写落点 —— 它没有判定用途（结算已逐个 `victims` 做完）。

散布中心：**有敌人时取敌群质心**（不是施法者，否则一半箭扎在自己脚下）；
一颗敌人也没有时（见 §55.6）取「朝向前方半个半径」，散布半径同时收到半个半径，保证落点仍在白圈内。

### 55.6 保底：`forceVisual`

`IZCStrikeOptions.forceVisual`。三档：

| 场景 | `forceVisual` | 行为 |
| :--- | :--- | :--- |
| 首次施法、搜索半径内 0 个敌人 | 不带 | `strikeTargets` 返回 0 ⇒ 冷却不推进、不建窗口、每帧重试（**没目标不释放**） |
| 首次施法、有敌人 | 不带 | 正常放，建窗口 + 画白圈 |
| 窗口内每一波（6/7/8 秒） | **带** | 敌人被打光 / 走光也照发这一批子弹（**放完就演完**） |

`ZCSkillTriggerSystem.applyRandomStrike` 里就一处：`fire(true)` 只在 `unit.strikeUntil` 分支。

> 用户看到的那张「只有白圈、没有子弹」的截图，根因就在第一档：圈是 `pushStrikeRangeRing`
> 在窗口**开的那一刻**画的，与子弹是两条独立通道；圈内一个敌人都没有 ⇒ `strikeTargets` 早退 ⇒ 有圈无箭。
> 不是「目标刚好死亡」。

### 55.7 颗数跟配表走

戈壁箭雨三档 `strikeCount` = **5 / 6 / 8**。表里的 `count: 5` 只是缺省，
`strikeTargets` 把配表值当第 5 个参数传给 `zcBulletRainFieldsAt`（归一化侧摆也按实际颗数走，
否则 8 颗按 5 摊 ⇒ 三颗弧度完全重叠）。
`aura` / `zone` 两条通道配表里没有对应字段 ⇒ 只认表里的值。

### 55.8 判据

`tests/zcds-bullet-rain-batch55.test.ts`（12 条，全绿）：

| 分组 | 钉住的东西 |
| :--- | :--- |
| ① 贝塞尔 | 端点精确 / 中点抬升 = 峰高 / 中点横移 = swayPx / 一维偏移按 2× 反推 / 非数字退端点 / 切线用解析导数且与差分对得上 / 落地朝向不归零 |
| ② 名单 | 三张卡各挂一条通道 / **急冻光线保持原样** / 不在表里一律 null / 每家只挂一条通道 / 散布比例落 (0,1] |
| ② 配表 | 戈壁箭雨三档 5/6/8，表内缺省值与一档对齐 |
| ③ 落点 | 起点 = 施法者 / 第 0 颗在圆心 / 其余在散布圈内 / 时长按距离夹 LIMIT / 落点不抱团 / 同种子逐位相同 / 换种子换一批 / 半径 0·NaN·Infinity 退圆心 / 侧摆按实际颗数摊开 |
| ④ 保底 | 0 目标不带 `forceVisual` ⇒ 一条事件都不发、返回 0 / 带 `forceVisual` ⇒ 5 条纯表现事件、伤害 0、朝前方撒且不出圈 / 有敌人 ⇒ 5 条表现 + 2 次结算、`to` 与落点同处 |
| ⑤ 接线 | 三处各取自己的通道 / 颗数取配表 / 视图 `flyTo ?? to` + 贝塞尔求值 + 切线朝向 / 事件字段齐全 / 窗口内 `fire(true)`、窗口外 `if (!fire())` |

同批改动还修了三份旧用例的「源码逐字断言」（断言的是抛物线那套写法，改贝塞尔后必然红）：
`zcds-basketball-fly-batch53`（改成断言贝塞尔三条）、`zcds-bullet-drop-batch52`（`dropHeight` 改成按 `rain` 分流）、
`zcds-ice-mage-bullet-batch51`（`zcCombatEffectFacingDegrees` 调用点从 2 处变 3 处 —— 飞入段也走同一套）。

## 56. 弹道雨收口：速度 150px + 弧线差异化 + 命中即消失并播受击特效（2026-11-26 第 56 批）

用户原话（三句，对应三件事）：

> 「杰克藕，篮球少年，急冻瓜 3 个角色 释放这个圆圈范围技能时，**子弹命中指定坐标消失，
>  在坐标处播放受击特效**」
> 「1,释放这种技能的子弹速度 **改成 150px**」
> 「2.子弹的弧线不够明显，**每个子弹的弧线差异可以再大点，多条不同的贝塞尔曲线行进路线**」

### 56.1 速度 150px：单位口径与「别被 0.55 夹住」

`ZC_BULLET_RAIN_SPEED`：520 → **150**。

- 单位与配表 `projectileSpeed` 同一档：`ZCCombatSystem.attackTravelSeconds` 直接拿速度除**世界**距离，
  不乘 `combatDistanceScale` ⇒ 「150px」就是 150 世界 px/s，别自己再乘 0.3。
- 🔴 **飞行时长必须另起上下限**（`ZC_BULLET_RAIN_MIN_SECONDS / MAX_SECONDS = 0.35 / 1.6`）。
  第 53 批那条 `ZC_BULLET_FLY_MAX_SECONDS = 0.55` 是给「600 px/s 飞 40px」的单颗飞入用的：
  150 px/s 下大半颗子弹会被夹短 ⇒ 同一段时间要走完更长距离 ⇒ **弧线被抹平**，
  用户看到的还是「一条线」——改了速度却看着没变慢，就是这个坑。

### 56.2 弧线差异化：高度也要错开

只加 `swayPx`（横向）时所有弧的**高度**仍是同一个，眼睛读出来还是「一批同样的弧斜着撒」。

| 口径 | 值 | 作用 |
| :--- | :--- | :--- |
| `arcPx` | 120/130/110 → **170/180/150** | 整体抬高，一眼看出「抛」 |
| `swayPx` | 34/30/28 → **46/40/38** | 横向铺更开 |
| `ZC_BULLET_RAIN_ARC_SPREAD` | 0.45 | 逐颗峰高 `×(1 ± 0.45)` |
| `zcBulletRainSwayPx` | 分摊 + 抖动 | 抖幅 `±0.55 × (1 − |分摊值|)`，贴边那颗不抖 |

🔴 **峰高用「固定分档」而不是散列**：`ZC_BULLET_RAIN_ARC_STEPS = [0, 0.8, -0.53, 1, -1, 0.33, -0.8, 0.53]`。
散列有可能两个序号散出同一个值（取整后相同）⇒ 两条一模一样的弧，而「每颗都不一样」正是这条需求的全部意义。
分档互不相同 ⇒ 一批里条条不一样；轮转起点随种子走 ⇒ 换一波时「哪颗最高」也跟着换。
第 0 颗固定走基准弧（用例与「圈心那一发」都有稳定锚点）。

侧摆的抖幅按 `1 − |分摊值|` 收缩：贴边那颗本来就该走满宽度，再往外抖只会被 clamp 掉、
和旁边那颗撞成同一条弧。

### 56.3 命中即消失 + 受击特效：一条 `durationSeconds`、一条独立事件

| 事 | 做法 |
| :--- | :--- |
| 子弹到点消失 | 子弹事件的 `durationSeconds` 直接取 `flyInSeconds`（原来取 `max(0.3, …)` / `max(波间隔, 特效时长, …)` ⇒ 落在圈里还继续播整段区域寿命，看着像「火球停在地上」） |
| 视图兜底 | `ZCCombatEffectView` 的飞入分支 `t >= 1` 就 `visualNode.active = false` 并 return（池化复用，别销毁） |
| 受击特效 | `zcBulletRainImpactAt(style, fields, castAt)` 返回**另一条 `area` 事件**的 `{x, y, startedAt, durationSeconds}`，`startedAt = castAt + flyInSeconds` |

为什么「未来事件」可行：渲染层对 `startedAt` 在未来的事件**直接不建节点**
（`zcCombatEffectEntered`，第 45 批为「五雷轰顶逐道出现」加的），所以命中特效天然是「子弹到了才出现」，
不需要任何延时逻辑、也不会在施法那一拍闪一下。

命中特效在表里逐卡登记（`ZCBulletRainStyle.impactPrefabPath / impactSeconds`）：

| 卡 | 命中特效 | 时长 |
| :--- | :--- | :--- |
| 68008 戈壁箭雨 | `units/projectiles/磁电菇_子弹命中/磁电菇_子弹命中` | 0.5 |
| 68024 冰山陨落 | `units/projectiles/冰法师通用子弹命中/冰法师通用子弹命中` | 1.05 |
| 68030 篮球火 | `units/projectiles/普攻爆炸/普攻爆炸` | 1.0 |

🔴 **必须进资源计划**（`zcBulletRainImpactPathsForUnit` → `ZCVisualResourcePlan`）：
漏收的后果是「子弹到点消失、落点什么都没有」，而且**不报错**。这条在 §51 已经踩过一次
（落地一击的路径没被收集），所以这次直接加了用例守。

篮球火那条的命中特效还带 `visualLiftPx: zone.visualLiftPx`：球是抬着飞的，特效应在同一个高度炸，
否则「球在半空消失、爆炸在地上」。

### 56.4 判据

`tests/zcds-bullet-rain-batch55.test.ts`（15 条，全绿；文件名沿用接入那一批，内容含 55 / 56 两批）：

| 分组 | 新增/改动的钉子 |
| :--- | :--- |
| ③ 速度 | `ZC_BULLET_RAIN_SPEED === 150` / 上限必须宽于 0.55 / 距离翻倍时长翻倍 / 五个距离点逐一对照 |
| ③ 弧线 | 逐颗峰高在 ±45% 内且**两两不同**（3/5/8 颗都验）/ 最高最低 ≥ 1.5 倍 / 侧摆两两不同且用满宽度 / 抖幅贴边收缩 |
| ③ 可复算 | 同种子逐位相同 / 换种子换落点 / 峰高在连续种子里至少 3 种（7 档轮转，不死盯某一对种子） |
| ④ 命中特效 | 落在同一坐标 / `startedAt = 起手 + 飞行` / 时长来自表 / 三张卡各不相同 / 非数字不泄进 `startedAt` |
| ④ 资源计划 | 三张卡的命中特效都进加载清单 / 只收上场单位 |
| ⑤ 行为 | 5 颗子弹 + 5 条命中特效 / 子弹 `durationSeconds === flyInSeconds` / 命中特效 `toX/toY` 与子弹落点一一对应 |
| ⑥ 守卫 | 两个推送点都有 `zcBulletRainImpactAt` 与 `durationSeconds: fields.flyInSeconds` / 视图 `t >= 1` 隐藏 / 资源计划接线 |

### 56.5 旧用例的口径同步：断言的是同一件事，只是写法变了

第 55 批改掉「冰山陨落怎么砸下来」之后，`tests/zcds-active-pilot.test.ts` 的那条
「auraAtTarget 把圆心搬到受击目标，冰锥同点落地」还在按**旧单颗口径**断言
（`effectPrefabPath` 含 `冰法师_冰锥`、`cones.length === 1`、`angleDegrees === -90`），
于是它在第 55 批之后一直红着。改成弹道雨口径：

| 旧断言 | 新断言 | 为什么等价 |
| :--- | :--- | :--- |
| prefab 含 `冰法师_冰锥` | 按 **`flyToX !== undefined`** 分流取弹体 | 弹体字段变了，但「有东西在飞」这件事没变 |
| `length === 1` | `length === ZC_BULLET_RAIN_UNITS['68024'].count`（3） | 「一批」取代「一根」 |
| `fromX/toX === 60` | 保留（判定圆心一个字节不动） | `flyTo*` 只改表现坐标 |
| `angleDegrees === -90` | `angleDegrees === undefined` + `flyFrom*` = 施法者 | 朝向改走切线，不再摆死一个角 |
| — | `durationSeconds === flyInSeconds` / 落点在圈内且两两不同 / 每颗配一条命中原事件 | 第 56 批三条新要求 |

🔴 **别用 `effectPrefabPath.includes('冰法师通用子弹')` 筛弹体** —— 命中特效叫
`冰法师通用子弹命中`，`includes` 会把两类事件一起吃进来，「3 颗弹」当场变成「6 条」。
按**字段**分流（弹体有 `flyToX`、命中原事件没有），或者按全路径等值比。

## 57. 集火提示与特效下移：补上「美术抬升」+ 按钮恒可点（2026-11-26 第 56 批）

需求原文：「野怪特效按钮需要下移100px，在野怪血条上方间隔3px即可，特效按钮需要放大1.5倍，点击特效按钮后弹出提示UI，地块相邻后才能集火野怪，激活野怪后，点击按钮，弹出屏幕中间弹出文字提示，开始激活野怪，点击取消集火，取消集火时弹出提示【集火取消】」。

### 57.1 🔴 第 53 批只压对了「原点」，没算「原点到可见底边」

§53.1 把特效**节点原点**压到「血条顶边 + 3」，用户实测仍然浮在上面约 100px。
原因：那颗 spine 的美术整体画在原点**之上**，骨架 `bounds.y ≈ 200` × prefab `_lscale 0.5` = **100px**。

所以现在算的是「**美术底边**」那条线（`zcMonsterFocusSpineY(barTopY, artLift)`）：

```
origin.y = barTop + 3 − |bounds.y| × scale
```

- **取绝对值**：spine `data.y` 的符号约定在不同导出工具下不一致；方向靠实测（美术在原点之上），
  不能让一个负号把整段修正吞掉。
- 读不到骨架（空骨架 / 单测桩）⇒ 兜底常量 `ZC_MONSTER_FOCUS_SPINE_ART_LIFT = 200`（= 实测 100 ÷ 0.5）。
- 放大后**先算缩放、再算抬升**：美术变高 ⇒ 原点要让得更多，可见底边才仍钉在同一根线上。

### 57.2 放大 1.5 倍：乘在 prefab 原始缩放上，且必须还原

`zcMonsterFocusSpineScale(baseScaleY)` = `|base| × 1.5`（0.5 ⇒ 0.75），不写死绝对值 ——
换 prefab / 改导出缩放都不用动代码。基准缩放存 `monsterSpineBaseScale`，
`restoreMonsterHeader` 里连位置一起还原：池化复用会把放大的特效带进下一个（非野怪）地块。

### 57.3 🔴 按钮改为恒可点：「可点性」≠「现在能不能集火」

以前 `interactable = unlocked && remaining <= 0` ⇒ **点不动**，玩家连「为什么不能点」都得不到。
现在恒 `true`，能不能集火交给模型判原因、控制器弹吐司：

| 结局 | 提示 |
| :--- | :--- |
| `not-adjacent` | 相邻地块才能集火野怪 |
| `cooldown` | 集火冷却中，请稍候 |
| `started` | 开始激活野怪 |
| `cancelled` | 集火取消 |

"现在点不动"的视觉仍由**底特效定格压灰 + 文案收起**表达（§53.2 / 第 51 批），与可点性解耦。

### 57.4 一次切换只回一份结果

`ZCGameModel.toggleMonsterFocusResult()` → `{ ok, kind, reason }`：

- `kind` 由**切换前** `focusOwners` 里有没有本方来定 —— 开和关的返回值都是 `true`，靠返回值区分不出来。
- 两个都是 `null` ⇒ 这一下什么都不该发生（非对局中 / 非本方），控制器**不弹任何东西**。
- 判据只有一份：`ZCNeutralFeatureSystem.focusBlockReason()`，`toggleFocus()` 内部也走它，
  不会出现「按钮说不能集火、模型却切了」。
- 🔴 `focusBlockReason` 会顺手跑 `unlockMonster`：解锁是**按棋盘实时算**的（相邻地块有我方已建成地块就解锁），
  刚建好的房子这一拍就该生效，不刷这一遍会被误判成 `not-adjacent`。`unlockMonster` 幂等。

### 57.5 吐司走依赖注入，不直接 import

`common/Toast` 顶层 `import 'cc'`，而 `zcds/application` 的**运行期**依赖图必须 cc-free
（`tests/helpers/battle-runtime.ts` 直接 `import ZCBattleRuntimeController`，一出现 `cc` 整份用例加载失败）。

⇒ 出口挂在 `IZCBattleRuntimeServices.toast?`，装配在 `BattleComposition.createRuntimeServices`；
不注入就静默丢弃（同 `FW.showTip`）。同一条文案 **1 秒内不重复**（用对局逻辑秒，不是墙钟）：
按钮恒可点后，不相邻地块连点会一直弹同一句，而吐司是**排队**播的，连点五下要排队放好几秒。

### 57.6 判据

`tests/zcds-monster-focus-batch56.test.ts`（6 条）+ 改动集：

| 分组 | 钉子 |
| :--- | :--- |
| ① 拦截原因 | 不相邻 ⇒ `not-adjacent` 且**不偷着唤醒**；建好邻居立刻可切 ⇒ `started`；同拍再点 ⇒ `cooldown` 且状态不动；3s 后 ⇒ `cancelled`；非对局中 ⇒ 两个都 `null` |
| ② 文案 | 三句逐字对齐需求 + 冷却那句 |
| ③ 锚点 | 可见底边 = `barTop + 3`（放大前后都成立）/ 抬升 = `\|bounds.y\| × scale` / 符号无关 / 兜底 200 |
| ④ 视图 | 旧的 `interactable = unlocked && remaining <= 0` 必须删干净 / 恒可点 / 基准缩放存了要还原、退出要清 |
| ⑤ 控制器 | 按 `reason ?? kind` 弹 / 两个都空不弹 / 只有真切了才 `render()` / 不 import `Toast` / 同句 1s 去重 / 组合根接 `Toast.show` |
| ⑥ 通道 | 走公共吐司（根节点居中 + 常驻 `Popup` 层），不新造一套 UI |

### 57.7 按钮的灰不跟「解锁」走，跟「野怪三态」走（第 59 批补）

第 58 批把野怪本体改成「只压亮不压透」后，未激活的怪变暗了，但**头顶集火按钮还是亮的** ——
一眼看过去像"这只怪能点"。用户在 2026-11-26 第 59 批指出：「按钮也需要是灰色的」。

口径拆成两件互不相干的事（`zcMonsterFocusSpineVisualOf`，三档）：

| 档 | 判据 | 动画 | 颜色 |
| :--- | :--- | :--- | :--- |
| `locked` | `!unlocked` | 定格倒数第 2 帧（`timeScale = 0`） | 压灰 |
| `idle` | 解锁 + 野怪 `sleep` | 循环 `action` | **压灰** |
| `active` | 解锁 + 野怪 `awake` / `captured` / `null` | 循环 `action` | 原色 |

- 🔴 **灰跟三态、定格跟解锁**。所以「解锁了但怪没醒」= 循环 + 仍灰 —— 少了 `idle` 这一档，
  就会退回"解锁即白"，本批需求等于没做。
- 🔴 **两档灰共用 `MONSTER_FOCUS_DIM_TINT = (140,146,158,255)`**（冷灰，蓝比红高 18）。
  alpha 必须 255：spine 顶点色改 alpha 是**整只按钮变透**，与第 58 批被否掉的是同一个错。
- 三态算不出来（`null`）按 `active` 处理：按钮本就不显示，不必另造一档，也别顺手把它染灰。
- `renderMonsterFocus` 每帧全量进来 ⇒ `applyMonsterFocusSpine` 自己 diff（`monsterFocusSpineVisual`），
  同档早退；`initialize` 必须复位成 `null`，否则池化复用回来停在上一局的定格。
- 用例：`tests/zcds-monster-focus-grey-batch59.test.ts`（4 条）+ `zcds-resource-unit-preview`
  那条「集火特效」已改成「解锁 ⇒ 循环 + 仍灰 / 激活 ⇒ 白」。

## 58. 塔防 BOSS 波预警 UI 特效（2026-11-26 第 57 批）

需求原文：「塔防模式，触发 boss 波次的时候播放预警 UI 特效，给特效制作格式一致的预制，特效的宽度要匹配 720px」。

### 58.1 预制：与开局 / 结算横幅同一套「四件套」

`assets/bundles/battle/units/effects/BOSS来袭UI特效/BOSS来袭UI特效.prefab`
（骨架 `ddz_jinggao_ani.skel` 由美术放在同一目录，动画名就是 `ddz_jinggao_ani`）：

| 件 | 值 | 说明 |
| :--- | :--- | :--- |
| 根节点 `_lscale` | `720 ÷ 496 = 1.4516129032…` | **宽度匹配 720 只有这一处**，运行时不再改缩放 |
| `UITransform._contentSize` | `496 × 496` | = 导出 PNG 画布，锚点 (0.5, 0.5) |
| `sp.Skeleton._skeletonData` | `.skel.meta` 的 uuid | 与 `开局对战UI特效` 同一引用方式（subMetas 为空，直引文件 uuid）|
| `defaultAnimation` / `loop` | `ddz_jinggao_ani` / `false` | 预警只播一次 |

🔴 **720 的算法与兄弟预制共用一份**：`zcUiBannerScale(画布宽)`（`ZCUISpineBannerStyle`）。
560 ⇒ 1.2857…（开局）、744 ⇒ 0.9677…（胜负）、496 ⇒ 1.4516…（本条）。
换图时**只改 prefab 里那一个 `_lscale` 与 `_contentSize`**，别在代码里补缩放 ——
`createZCUISpineBannerNode` 只管起播 / 居中 / 销毁，不碰尺寸（见 §55 那套横幅口径）。

**口径分界（改宽度前先看这条）**：这里按**导出画布宽**折算（= 兄弟预制、`zcUiBannerScale` 的口径），
依据是导出画布本身就是「动画各帧的最大包围盒」—— 横幅骨会横向撑开，画布跟着撑到最大值。
本条素材的画布 496、atlas 里最宽的一块 `ddz_jinggao_tb_ani` 是 427（其余 426/402/243/226/211），
所以**静态那几帧**看起来只有 `427 × 1.4516 ≈ 620` 宽。
如果美术按「可见横幅必须实打实贴满 720」验，把 `_lscale` 换成 `720 ÷ 可见宽`（当前 427 ⇒ **1.68616**）即可，
**仍然只动 prefab 一个数** —— 代价是动画撑开时会略微溢出屏幕两侧（横幅类特效可接受）。

### 58.2 触发：每帧读波次进度 + 按 `waveId` 去重

`ZCGameHUDView.render(model)` 每帧拿 `model.defenceWaveProgress`，交给
`zcShouldPlayBossWarning(progress, playedWaveId)`（零 `cc`，可单测）三条件判：

1. 守城局（`defenceWaveProgress` 非 null）；
2. `currentWaveIsBoss === true` —— 与首领大血条、胜负判定同一份口径（`defenceBossWaveIndex()`）；
3. `currentWaveId !== playedWaveId` —— 这一波没播过。

🔴 **不能按「当前帧是不是 BOSS 波」判**：`render` 每帧都跑，那样屏幕会叠无数条；
**也不能按布尔「已播过」**：配置里两波都标 `isBoss` 时第二波就静默没预警了。
所以记的是**上一次播的那一波的 id**（表主键，唯一）。

骨架异步到货时补播一次（`setBossWarningEffect` → `playBossWarningEffect`）：
BOSS 波可能比 prefab 先到，尤其第一波就是 BOSS 的短局。

### 58.3 只在守城局加载

`ZCGame.loadBossWarningBanner()` 里 `if (!this.matchConfig?.pveDefence) return;` ——
普通对局没有 BOSS 波，不白拉这个预制；它和开局 / 胜负横幅一样**不进首包预热清单**
（`ZC_BATTLE_COMMON_PREFABS` 不收，路径只登记在 `ZC_BATTLE_FX_PATHS.bossWarningBanner`）。

### 58.4 判据

`tests/zcds-boss-warning-batch57.test.ts`（6 条）：

| 分组 | 钉子 |
| :--- | :--- |
| ① 格式一致 | 组件序列必须与 `开局对战UI特效` / `胜利失败UI特效` 逐项相同；根节点名 = 预制名；三个 fileId 按名字区分 |
| ② 720 宽度 | `UITransform` = PNG 画布（496²）；`_lscale` = `720 ÷ 画布宽` 且等比；`画布 × 缩放 === 720`；与 `zcUiBannerScale` 同一个数；兄弟预制 560/744 复核 |
| ③ 骨架 | prefab 引的 uuid = `.skel.meta` 的 uuid；`defaultAnimation` = 代码常量 = 骨架二进制里真实存在的动画；`loop:false`、非预乘 |
| ④ meta | `importer: prefab`、`syncNodeName` 对齐、uuid 唯一、文件非空 |
| ⑤ 判据 | 非守城 / 普通波 / 无 currentWaveId / NaN 都不播；同波只播一次；多段 BOSS 各播各的 |
| ⑥ 接线 | 资源计划路径；`pveDefence` 才加载；HUD 每帧喂进度 + 只认纯函数 + 播完即收 + `onDestroy` 清干净 |

## 59. 卡牌常用子弹：统一格式 prefab + 白色三角拖尾 + 身体抖动（2026-11-26 第 57 批）

七颗子弹（用户逐条点名，全部走同一套格式）：

| 卡 | 单位 | 触发路径 | 弹体 | 抖动 |
| :--- | :--- | :--- | :--- | :--- |
| 豌豆游侠（含机关枪 30801） | 68001 | 配表 `pvpSkill.effectPrefabPath` | `豌豆游侠_子弹` | — |
| 毒箭菇（蘑菇爆炸） | 68017 | 陷阱**飞行段** `flightVisualPath` | `毒箭菇_子弹` | **Y 轴** |
| 杰克藕 | 68010 | 配表 | `杰克藕_子弹` | — |
| 大嘴花（破阵术） | 68007 | `ZCLanceFx` 按单位覆盖 | `大嘴花_子弹` | **X 轴** |
| 仙桃行者（破阵术） | 68009 | `ZCLanceFx` | `仙桃行者_子弹` | — |
| 玉林好汉（普攻 30716） | 68004 | 配表 | `玉林好汉_子弹` | — |
| 诅咒菇（破阵术） | 68018 | `ZCLanceFx` | `诅咒菇_子弹`（**紫**拖尾） | — |

### 59.1 一条命令出七个：`tools/build_card_bullet_fx.py`

素材是七张 215×215 碎图，直接批量生成，**别手改 prefab**（手改的下一张就会漂）：

| 件 | 口径 |
| :--- | :--- |
| 节点结构 | 根 Node + 子节点 `body`（`BULLET_BODY_NODE_NAME`）+ `UITransform` + `Sprite`，七个逐字同构 |
| 尺寸 | 缩放在 **`body._lscale`**，根恒 1（宿主 `setScale` 会冲掉根，见 §1.10） |
| 缩放值 | 等效直径 `√(w·h)` 归一到 48，再给长边封顶 96（长条子弹不被压成豆） |
| 位置 | 主体几何中心对齐节点原点：`_lpos = (画布宽/2 − bbox 中心x, bbox 中心y − 画布高/2)` |
| `Sprite._sizeMode` | `0`（CUSTOM），`_isTrimmedMode: false` —— 素材是 trim 导入，开裁剪会按包围盒重排主体 |
| 贴图 | `_spriteFrame` = 同目录 PNG `.meta` uuid + `@` + spriteFrame 子资源名 |

🔴 **中心不对齐的代价**：拖尾接在节点本地 −X 上，主体偏了哪怕 8px，屏幕上就是「拖尾从子弹肚子里长出来」。

### 59.2 🔴 拖尾不进 prefab：只登记一张表

`ZC_EFFECT_TRAIL_SPECS` 登记几何，`ZCCombatEffectView.drawMissileTrail` 用 `Graphics` 画在**宿主节点**上
（宿主 +X 已被转成飞行方向，所以拖尾永远沿本地 −X 往外收尖）。

七条统一：`length: 96`、`tipHalfWidth: 1.5`、`slices: 12`、`alpha: 0.6`，`color` 只有诅咒菇是 `[186,140,255]`、其余纯白。
`startX` 逐颗不同（= 主体半宽 + 一点余量，由生成器按 bbox 算出：`-40.8 / -33.5 / -26.8 / -20.5 / -25.0 / -35.5 / -20.4`）。

🔴 **单位是「宿主本地 px」，不是屏上 px**：宿主 `nodeScale ≠ 1` 的弹体（如 `lightningBullet` 0.35）要把长度除以缩放；
本轮七颗**不写 `nodeScale`**，所以本地 px 就等于屏上 px。加 `nodeScale` 时必须回头改 `startX/length`，否则拖尾长度会跟着弹体一起缩。

### 59.3 抖动：挂 `body`，四个关键帧等分一个周期

口径 `1 → 1+amount → 1−amount → 1`（`amount = 0.05`、`periodSeconds = 0.28`），**段内线性插值**，不是正弦 ——
正弦给不出 0.95 这个值（谷值是 1−amount 的 0.95，正弦在 3/4 相位就是 0.95，但 1/4 相位会是 1.05 = 对的，然而
用正弦的中间值会过冲；关键是**用户点名要这四个数**，所以按关键帧线性插值，不引入函数形状）。

模型层 `ZCBulletWobble.ts`（零 `cc`，可单测）：`zcBulletWobbleScale` / `zcBulletWobbleScaleXY`；
非法配置（`amount ≤ 0`、`period ≤ 0`、非有限数）一律收敛成 1，不抛。

视图层 `ZCCombatEffectView.applyBulletWobble`：

| 坑 | 处理 |
| :--- | :--- |
| 承载节点 | **`body` 子节点**。宿主的 scale 已被 `nodeScale / grow / sizeScale / effectScale` 用光，抖动只能乘在子节点上 |
| 写绝对值 | 每帧写 `基准 × 倍率`，基准在 `bindWobbleNode` 时记一次（`wobbleBaseX / wobbleBaseY`） |
| 🔴 池化复用 | 换事件时**先把基准写回去再读**（`restoreWobble()`）。同一个 `visualNode` 会被下一个事件接着用，直接读会读到上一任抖到一半的缩放，之后全歪 |
| 时间基准 | `now − event.startedAt`，**不是节点寿命**（与 `growFactorOf` 同一条理由） |
| 清场 | `initialize` 里也调一次 `restoreWobble()` |

### 59.4 🔴 两条「表里没有」的按单位换美术通道

破阵术（投枪）与蘑菇爆炸飞行段都不在 `pvpSkill` 行里，参数袋只能放 `number`，所以走常数表：

| 通道 | 文件 | 收谁 |
| :--- | :--- | :--- |
| 破阵术弹体 | `ZCLanceFx.ZC_LANCE_EFFECT_PREFAB_BY_UNIT` | 68007 / 68009 / 68018；缺省 = `ZC_EFFECT_PATHS.lanceArrow` |
| 陷阱飞行段 | `ZCTrapFx.ZC_TRAP_FLIGHT_PREFAB_BY_UNIT` | 68017；缺省 = `ZC_TRAP_SPAWN_PREFAB_PATH` |

**两条都必须被 `ZCVisualResourcePlan` 按阵容收到**（`zcLanceEffectPrefabPathsForUnit` / `zcTrapFlightPathsForUnit`）。
漏收的代价是**静默**的：不报错，只是子弹隐形 / 蘑菇凭空出现。

同时注意守卫 `tests/zcds-effect-path-parity.test.ts`：`*Fx.ts` 里不许出现 `units/projectiles/` 字面量 ⇒
投枪的缺省箭矢路径也挪进了 `ZC_EFFECT_PATHS.lanceArrow`。

### 59.5 蘑菇爆炸：只换飞行段，机制一个字节不动

`castTrap` 里 `flying` 为真时写 `flightVisualPath: zcTrapFlightPath(unitId)` + `angleDegrees`；
落地 `ZCGroundZoneSystem.settleFlight` 里 `arc > 0` 时**把 `angleDegrees` 清回 `undefined`** ——
留着会让落地后的常驻陷阱图歪着躺在地上。

### 59.6 判据

`tests/zcds-card-bullet-batch57.test.ts`（12 条）：

| 分组 | 钉子 |
| :--- | :--- |
| ① 目录 | 七条路径都有 spec + 拖尾；全 `layer: 'top'`、都不写 `nodeScale` / `flight` |
| ② prefab 同构 | 结构逐字相同（含 `_isTrimmedMode: false`、`_sizeMode: 0`）；贴图 uuid 指向同目录 PNG |
| ③ 拖尾 | 几何统一（96 / 1.5 / 12）；诅咒菇紫、其余六条纯白 |
| ④ 抖动 | 只登记 Dujuan(Y) + Mouth(X)；四个关键帧精确 1-1.05-0.95-1；只动一个轴；非法配置收敛成 1 |
| ⑤ 接入 | 破阵术三张卡 + 缺省退回；陷阱飞行段只登记 68017；资源计划两条通道都收得到 |
| ⑥ 配表 | `remoteRef` 与 client json 一致；破阵术 `lanceEvery` 仍在；源码守卫 |

### 59.7 🔴 范围指示白环的圆心 = 「这一发打在哪」，不是施法者脚下

用户看图后纠正（同日第二遍）：「杰克藕的区域没有出现在对应的目标上，而是以杰克藕为圆心，
正确是以目标为圆心，检查下篮球少年和急冻瓜的」。

先说三张卡的现状（`ZC_SKILL_RANGE_RING_UNITS` 正好就是这三张）：

| 卡 | 技能 | 通道 | 改前 | 处理后 |
| :--- | :--- | :--- | :--- | :--- |
| 杰克藕 68008 | 戈壁箭雨 100804 | `random_strike` | ❌ 圈在自身 | ✅ 圈在敌群散布中心 |
| 急冻瓜 68024 | 急冻光线 102404 | `random_strike` | ❌ 圈在自身 | ✅ 圈在挑中的第一个目标（见 §60.3） |
| 急冻瓜 68024 | 冰山陨落 102403 | `self_aura` | ✅（`auraAtTarget: 1`） | 不动 |
| 篮球少年 68030 | 篮球火 103004 | `area` 区域 | ✅（`zoneX = target.x`） | 不动 |

**根因**：`pushStrikeRangeRing` 写死 `unitPosition(unit)`。而箭是按敌群质心撒的
（`strikeTargets` 里的 `centerX/centerY`），两者从第一帧就对不上。

**修法要点 —— 必须同源，不能在触发系统里重算**：

1. `IZCStrikeOptions.centerOut?: { x, y }` —— 调用方传一个**可变**对象进来，
   `strikeTargets` 挑完人之后把中心写回去。改返回类型会牵动所有调用点，这里只有一家在用。
2. `strikeTargets` 写两处：通用分支按 **`victims[0]` 的本体坐标**（不是全部候选 —— 半径外的敌人不算；
   第 57 批曾写质心，第 58 批按用户「光圈切换到下个目标」改成第一个目标，见 §60.3）；
   弹道雨分支覆盖成它自己的 `centerX/centerY`（含「0 目标时朝前半个半径」的兜底），
   因为那个分支的散布中心可能根本不存在质心。
3. 🔴 **挑人带随机**（`nearest: false`）：外面重算一遍必然得到另一个质心 ⇒ 圈与箭又错开。
   这就是必须回填、而不是「画圈时再算一次」的原因。
4. 没打出去（0 目标且非 `forceVisual`）⇒ `centerOut` 保持 `NaN`，圈心退回施法者。
   写个 `0,0` 会让圈跑到地图原点。

**窗口内要跟着走**（第二处，很容易漏）：

`pushStrikeRangeRing` 原来只在**首发放出**时调一次。敌人会移动，于是第二秒起就是
「第一秒的圈、第五秒的箭」。改成窗口内**每一波**都调一次，靠 `pushSkillRangeRingEvent` 的
第三个参数 `followCenter`（缺省 `false` = 存量逐字不变）实现「原地挪过去 + 续命、不新增」：

```ts
pushSkillRangeRingEvent(state, options, followCenter = true);
//  已有存活那条 ⇒ 改 fromX/toX、startedAt = now、effectScale/radius 同步，绝不 push 新的
```

🔴 **续命只能用剩余窗口**：`seconds = min(strikeSeconds, unit.strikeUntil − now)`。
用整段 `strikeSeconds` 的话，最后一波会把圈续到技能结束之后，玩家对着空圈继续等。

**判据**（`tests/zcds-bullet-rain-batch55.test.ts` 第 ⑥ 组，6 条）：
弹道雨单位 `centerOut` = 散布中心（= 挑中目标质心，且与箭群同源）/ 非弹道雨单位 = 第一个目标本体坐标
（不许退回质心）/ 0 目标不写（保持 NaN）/ 保底那波与箭群中心同源（容差 = 散布半径 20%）/
白环默认不跟随、`followCenter` 时原地挪且不叠圈 / 源码守卫（窗口内每波都调、寿命取剩余窗口）。

## 60. 弹道雨连发 + 起点抬高 + 白环滑动 + 子弹缩到 70%（2026-11-26 第 58 批）

用户看图后第二遍提的三条（同一句话里改了四件事）：

> 「这类技能的子弹是逐个射出去的 不是逐轮的齐射，不停的发射，每个子弹有 0.1s 左右的间隔，
>   **光圈（白色指示圈）切换到下个目标是快速移动（150px 速度），不要直接瞬移**
>   新加的子弹预制 统一改小成 70%，现在的子弹太大了，**拖尾要同步匹配大小**
>   这一批发射子弹的位置要在角色图片的**中心位置往上 5px**，现在子弹发射的位置太低了」

| # | 要求 | 落点 |
| :- | :--- | :--- |
| 1 | 逐颗出手、间隔 0.1s | `ZC_BULLET_RAIN_SHOT_INTERVAL_SECONDS`，三条推送通道各加 `fireAt`（§60.1） |
| 2 | 白环换目标 150px/s 滑动 | `ZC_SKILL_RANGE_RING_SLIDE_SPEED` + 事件四个 slide 字段 + `ZCCombatEffectSlide`（§60.2） |
| 3 | 子弹缩到 70%、拖尾同步 | `tools/build_card_bullet_fx.py` 两个常量 + `ZC_EFFECT_TRAIL_SPECS` 七条几何（§60.3） |
| 4 | 起点 = 角色图片中心 +5px | `ZC_BULLET_RAIN_ORIGIN_LIFT_PX = 25`（§60.4） |

### 60.1 逐颗出手：只错开**表现时刻**，伤害仍在施法那一拍一次性结算

改前一批 N 颗共用 `state.elapsedSeconds` ⇒ 五支箭同一帧全部出现，用户读成「逐轮齐射」。

```ts
const fireAt = state.elapsedSeconds + index * ZC_BULLET_RAIN_SHOT_INTERVAL_SECONDS; // 0.1
//  事件的 startedAt 与命中特效的 startedAt **都用 fireAt**
state.combatEvents.push({ ..., startedAt: fireAt, durationSeconds: fields.flyInSeconds, ... });
const impact = zcBulletRainImpactAt(rain, fields, fireAt);
```

三条通道各一份（`strike` / `aura` 在 `ZCSkillResolutionSystem`，`zone` 在 `ZCGroundZoneSystem`）。

🔴 **伤害不许跟着拆**：`victims` 的结算仍在上面那一段一次性做完。逐颗只影响
`startedAt` / 命中特效时刻，`flyTo*` 的落点集合与 `to`（区域判定圆心）一个字节不动。
把伤害也摊到 0.1s 一拍，等于把一个爆发技能改成 DoT，DPS 曲线全变。

🔴 **命中特效必须用 `zcBulletRainImpactAt(rain, fields, fireAt)`**，不能用 `state.elapsedSeconds`：
命中特效的时刻是「**这颗**出手时刻 + 飞行时长」，用施法那一拍会让五颗的爆炸全堆在开头。

### 60.2 白环「滑过去」而不是瞬移：150px/s、飞到之后停住

`pushSkillRangeRingEvent(..., followCenter = true)` 原来直接改 `toX/toY` ⇒ 圈一帧跳过去。
现在换目标时记下一个**滑动段**：

```ts
alive.slideFromX = alive.toX;  alive.slideFromY = alive.toY;   // 从上一次的位置出发
alive.slideStartAt = now;
alive.slideSeconds = distance / ZC_SKILL_RANGE_RING_SLIDE_SPEED;  // 150 px/s
alive.fromX = x; alive.fromY = y; alive.toX = x; alive.toY = y;    // to 立刻就是新位置
```

位移 < 0.5px 时把四个字段清掉、按瞬移处理（省一次无意义插值）。

🔴 **不能复用 `flyFrom*` / `flyInSeconds`**：那一套是**子弹**的，`t = 1` 时会「命中即摘」把节点藏起来。
白环飞到之后还要在新位置上活满整个技能窗口，两套语义必须分开 —— 这就是
`ZCCombatEvent` 另开 `slideFromX/slideFromY/slideStartAt/slideSeconds` 四个字段的原因。

视图侧把插值抽成纯函数 `view/ZCCombatEffectSlide.zcCombatEffectSlidePoint(event, now)`
（不 import `cc`，可以直接被测）：

| 情形 | 返回 |
| :--- | :--- |
| 没登记 `slideSeconds` / 没有起点 | `{ to }`（存量逐字不变） |
| `elapsed <= 0`（时钟回拨 / 快照重算） | 起点，别把圈甩到反方向 |
| `0 < elapsed < seconds` | 线性插值 |
| `elapsed >= seconds` | `{ to }`，停在新位置 |

视图那一行随之从 `mapToViewX(event.toX)` 变成 `mapToViewX(slide.x)`（`slide.x` 在缺省路径下逐字等于 `to`）。

### 60.3 七颗子弹缩到 70%：只改生成器两个常量，拖尾必须同步

`tools/build_card_bullet_fx.py`：

```python
TARGET_EQUIV_DIAMETER = 33.6   # 48 × 70%
MAX_LONG_EDGE = 67.2           # 96 × 70%
```

重跑后 prefab 的 `body._lscale` / `_lpos` 自动重算（七条 scale 0.261~0.532），
但 **`ZC_EFFECT_TRAIL_SPECS` 不会自己变** —— 那里是「宿主本地 px」的手写数值，必须按同比例缩：

| 卡 | scale | 屏上 | startX | rootHalfWidth |
| :--- | ---: | :--- | ---: | ---: |
| 仙桃行者 | 0.348 | 67.2×14.6 | −28.5 | 5.6 |
| 大嘴花 | 0.319 | 55.2×20.4 | −23.5 | 7.7 |
| 杰克藕 | 0.532 | 44.2×25.5 | −18.8 | 9.1 |
| 毒箭菇 | 0.261 | 33.7×33.4 | −14.3 | 9.8 |
| 玉林好汉 | 0.497 | 41.3×27.3 | −17.5 | 9.8 |
| 诅咒菇 | 0.379 | 58.4×19.3 | −24.8 | 7.0 |
| 豌豆游侠 | 0.494 | 33.6×33.6 | −14.3 | 9.8 |

统一口径：`length` 一律 67.2（= 2 × 等效直径）、`tipHalfWidth` 一律 1.05（1.5 × 70%）、`slices: 12`。
只改 prefab 不改这张表 ⇒ 子弹缩了、拖尾还是原来那么粗长，尾巴比弹体还大。

### 60.4 起点抬 25px = 既有「脚点→身体中心」20 + 用户点名的 5

单位根节点是**逻辑脚点**，子弹从脚底冒出来。`zcCombatEffectLiftY` 那套「补偏差」表
（玉林好汉 +20 / 三叶小丑 +30）是同一口径的既有做法，这里取 20 当基准：

```ts
export const ZC_BULLET_RAIN_ORIGIN_LIFT_PX = 25;  // 20 + 5
```

- `strike` / `aura`：事件直接写 `visualLiftPx: ZC_BULLET_RAIN_ORIGIN_LIFT_PX`。
- `zone`（篮球火）：**叠在区域自己的抬升上** —— `visualLiftPx: (zone.visualLiftPx ?? 0) + ZC_BULLET_RAIN_ORIGIN_LIFT_PX`，
  直接赋值会把区域原有抬升冲掉。

### 60.5 判据

`tests/zcds-bullet-rain-batch55.test.ts` 第 ⑦ 组（4 条）+ 第 ⑥ 组改 1 拆 2：

| 分组 | 钉子 |
| :--- | :--- |
| ⑦ 逐颗 | 5 颗 `startedAt` 严格 `0, 0.1, 0.2, 0.3, 0.4`；落点两两不同；命中特效各自 `startedAt + flyInSeconds` |
| ⑦ 起点 | 常量 = 25；`skill` 里两处 `visualLiftPx: ZC_BULLET_RAIN_ORIGIN_LIFT_PX,`；`zone` 里叠加 |
| ⑦ 滑动 | 50px ⇒ `slideSeconds = 50/150`；中点 (15,20)；走完停住；负时间给起点；无字段直接给 `to` |
| ⑦ 接线 | 模型层 `slideSeconds = distance / ZC_SKILL_RANGE_RING_SLIDE_SPEED;`、微调清字段；视图层走 `slidePoint` + `mapToViewX(slide.x)` |
| ⑥ 圈心 | 弹道雨单位 = 散布中心（与箭群同源）；非弹道雨单位 = 第一个目标本体坐标（不许退回质心） |

⚠️ 同期被这一批改到锚点的两条老守卫（`zcds-bullet-drop-batch52` ② / `zcds-combat-effect-placement` ⑦）
跟着改成 `slide.x/y` —— 它们钉的是「抬升加在 `mapToViewY` 之后」「x 不被 dropFromPx 影响」这两个**语义**，
缺省路径同义，不是放宽。

### 60.6 附：四条技能的真实判定范围（对「圈画多大」的唯一依据）

`pvpSkillPlan` 的 `skillParamJson`（源表 = `armySkillLevelUp` → `modfiy` → `pvpSkillPlan`），
世界半径 = 逻辑半径 × `combatDistanceScale 0.3`，圈半径再经
`searchRadius = min(strikeRadius × 0.3, attackReach)` 收窄 —— **圈画的是实际搜索半径，不是裸表值**。

| 技能 | 通道 | 逻辑半径 | 世界半径 | 持续 | 每波 | 档位差异 |
| :--- | :--- | ---: | ---: | ---: | :--- | :--- |
| 戈壁箭雨 100804 | `random_strike` | 210 | 63 | 6 / 7 / 8s | `strikeInterval 1s`，5 / 6 / 8 颗 | 只有颗数、时长、倍率变，半径三档同 210 |
| 冰山陨落 102403 | `self_aura` | 120 | 36 | 3s | `auraInterval 0.5s` | 倍率 0.55 / 0.65 / 0.75，`auraAtTarget: 1` |
| 急冻光线 102404 | `random_strike` | 260 | 78 | **无窗口**（不发 `strikeSeconds`） | 3 颗一次性 | `strikeNearest: 1` + `strikeAppliesStatus`（numb） |
| 篮球火 103004 | `area` | 110 | 33 | 3s | 1 波 | 倍率 0.7 / 1.0 / 1.4 |

两条容易记错的：

- **急冻光线没有 `strikeSeconds`** ⇒ `windowSeconds = 0` ⇒ 圈只在开火那一拍推一次、不跟随、不滑动。
  它的「切目标」发生在每次冷却到点（`strikeEvery 9` 次普攻）时，不是窗口内每波。
- **急冻光线的 260 比戈壁箭雨的 210 大**，但它的 `nearest: 1` 让它总是打最近的三只 ⇒ 圈心落在胸口那三只身上，
  视觉上比箭雨那张「撒在敌群里」的圈更靠前。

### 3.58 chapter_01：10 个 1023 银币宝箱按位置均匀改配（2026-11-26）

> 「按照位置均匀的 抽取 10个 1023 替换成8个1016 ，以及1个1015 和1个1012 ，
>  这10个修改的奖励对应的建筑id也同步改成69005」

#### 一、改了什么

`chapter_01` 里 22 个 `rewardId=1023`（银币宝箱）的格，挑 10 个改奖励，**建筑一起改**：

| 新奖励 | 池内容（`levelMapGrideReward`） | 格数 | 建筑 |
| :-- | :-- | ---: | :-- |
| `1016` | 银币 + 资源 `19104` + 角色经验 `19350/19301`（8 条） | 8 | `69020` → `69005` |
| `1015` | 银币 + 资源 `10010` + `19101`（4 条） | 1 | `69020` → `69005` |
| `1012` | 只有 `resId=9`（钻石）10 个（1 条） | 1 | `69020` → `69005` |

🔴 **建筑必须跟着奖励走**：`69020` 是 `coinBox`（银币箱子），而 `1023` 是**全表唯一整组只发 `resId=7`**
的池（§3.35）。换成 `1016/1015/1012` 以后还挂着 `coinBox`，就是「箱子画成银币宝箱、开出来却是碎片」。
`69005` 是通用的 `territory_fixed_resource_v1`，与 `fixedResource` 的空串回退同款（§3.35 那条）。

只改 `rewardId` 与 `buildingId`；`cellId / footprint / type / unlock / configId` 一个字节不动。
剩下 12 格仍是 `1023` + `69020` ⇒ §3.35 与「1023 的格必须显式配 69020」继续成立。

#### 二、落地的 10 格

| cell | 新奖励 | 半径 px | 方位角 |
| ---: | ---: | ---: | ---: |
| 29 | 1015 | 788.8 | 93.4° |
| 72 | 1016 | 607.9 | 67.7° |
| 97 | 1016 | 864.0 | 36.8° |
| 102 | 1016 | 790.6 | 151.1° |
| 189 | 1016 | 81.8 | 124.3° |
| 195 | 1016 | 511.8 | 7.6° |
| 206 | 1016 | 329.9 | -168.2° |
| 232 | 1016 | 279.3 | -34.3° |
| 268 | 1016 | 364.8 | -112.3° |
| 393 | 1012 | 892.9 | -68.8° |

改完 `chapter_01` 的奖励分布：`1012×1 / 1015×1 / 1016×60 / 1023×12 / 1024×1`。

#### 三、「位置均匀」的判据（`pick_even`）

22 选 10 ⇒ **全枚举 `C(22,10) = 646646` 组**（1~2 秒），按三条排序：

1. **硬约束：10 个格两两方位角至少差 `25°`**。少了这条会选出「同方向、不同半径」的组合 ——
   实测 `29` 与 `109` 都在 93°，欧氏距离却有 358px：数学上散得开，看着还是一条竖线上的两点。
   收不到解时按 `20 / 15 / 10 / 0` 逐级放宽并打印实际用的阈值。
2. **最小两两欧氏距离最大**（`p-dispersion`）—— 不许扎堆。
3. **覆盖半径最小**（`k-center`）—— 每个没被选中的 1023 格都要离某个选中格足够近。

距离和方位角都取**游戏真实格心**（`HexGridLayout` 的 `92.25 / 90 / ±22.5`），不拿行列表号当欧氏空间
（奇偶列有 22.5px 错位）。落地方位角空档 `55.9 / 43.5 / 34.5 / 41.9 / 29.2 / 30.9 / 25.7 / 30.9 /
26.8 / 40.7`（10 等分理想 36°，最大空档在左下那一段，那里只有 22 个候选里的两个）。

**两只稀有箱**（`1015` / `1012`）取这 10 格里**距离最远的一对** ⇒ 落在正上方（`29`）与正下方（`393`），
`cellId` 小的给 `1015` 只为可复现。

#### 四、落点 / 工具 / 用例

- 工具 `tools/map-editor/retune_chapter_01_rewards.py`：`--dry-run` / `--no-publish` / `--preview`
  （出 `tmp/chapter01_reward_retune.png` 改前改后对照）。**幂等护栏**：`1023` 格数不是 22 就直接报错退出
  （跑过第二遍不会是 22），不会把剩下 12 个再吃一遍。
- 落点照旧三处：预设 + `assets/resources/config/territory-maps/` + 策划 `sever/territorymap/`。
- 用例同步：`tests/territory-building-id.test.ts` 的 `expectedByChapter` 由 `[23, …]` 改成 `[12, …]`、
  合计 `146 → 135`；`tests/territory-silver-chest-open.test.ts` 同样 `146 → 135`。
  ⚠️ `chapter_01` 在本次改动**之前**就已经是 22 格（用例原先按 23 写，1 格缺口是既有差异），
  改成 12 之后那条用例不再覆盖这个缺口。
- 七章 `1023` 合计：`12 + 27 + 36 + 15 + 15 + 15 + 15 = 135`。（§3.35 的 148 是 11-10 的历史数。）
