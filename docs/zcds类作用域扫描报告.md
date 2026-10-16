# zcds 类作用域泄漏扫描报告

> 规则：`docs/AI架构与代码规范.md` §6.2 第 12 条 —— 作用域只在当前类的常量/方法，
> 必须收进类内（`private static readonly` / `private`），不得放模块外部给其他类引用。
> 扫描器：`tools/scan_class_scope.mjs`（`node tools/scan_class_scope.mjs`）。
> 扫描范围：`assets/script/app/zcds`（71 个文件，502 个模块级 const/function/enum），
> 消费方在全工程 `assets/script` + `tests` 中统计。
> 扫描日期：2026-10-13。

## 总览

| 类别 | 数量 | 结论 |
|---|---|---|
| **A 类**：含类文件内，模块级符号仅被 1 个类消费 | 129 | 应内聚；其中 **118 个可直接改**，**11 个需人工复核**（同时被模块级工厂函数用） |
| **B 类**：导出符号仅被另一文件的 1 个类消费 | 7 | 跨文件 API 漂移，应搬到消费类 |
| **人工确认**：含类文件中仅模块级使用 | 30 | 多数为模块公共 API 的内部实现/仅测试消费，**保留** |
| **合法共享**：≥2 类或跨文件 | 206 | 保留 |

---

## B 类违规（7 个，优先处理，改动小、归属明确）

| 符号 | 现位置 | 唯一消费类 | 建议 |
|---|---|---|---|
| `ZC_HINT_TEXTS` | `application/ZCTexts.ts` | `ZCGame` | 移入 `ZCGame` 为 `private static readonly` |
| `ZC_SETTLEMENT_TITLES` | `application/ZCTexts.ts` | `ZCGame` | 同上 |
| `ZC_SETTLEMENT_SUMMARY` | `application/ZCTexts.ts` | `ZCGame` | 同上 |
| `BUILDING_NAMES` | `model/ZCGameModel.ts` | `ZCGame` | 移入 `ZCGame`；`ZCActionResult` 等类型导出不受影响 |
| `ZC_CAPTURE_LEGACY_MAX_SECONDS` | `model/systems/ZCCaptureSystem.ts` | `ZCSnapshotCodec` | 注释已写明「只用于兼容校验，不参与玩法」，归 codec：移入 `ZCSnapshotCodec` 为 `private static readonly` |
| `guideRewardColor` | `ui/ZCGuideConfig.ts` | `ui/ZCGuideItem` | 移入 `ZCGuideItem` 为 `private` 方法；`ZCGuideEntry` 类型仍在 config 文件 |
| `zcOwnerEdgeColor` | `view/ZCTheme.ts` | `view/ZCUnitView` | 移入 `ZCUnitView` 为 `private` 方法 |

---

## A 类违规（按文件汇总，129 个）

### 可直接内聚（118 个，符号仅被单一类引用，无模块级共消费）

| 文件 | 数 | 符号 | 归属类 |
|---|---|---|---|
| `application/ZCGameLoader.ts` | 15 | `HUD_URL` `BOARD_URL` `HEX_URL` `UNIT_URL` `EFFECT_URL` `WALL_URL` `WALL_LAYER_URL` `FLOAT_TEXT_URL` `CARD_REVEAL_URL` `LEGEND_BANNER_URL` `DECOR_URL` `BOSS_PANEL_URL` `WALL_TILE_EFFECT_URL` `DECOR_TILE_KEY_PATTERN` `ARTIFACT_DIRECTORY` | `ZCGameLoader` |
| `view/ZCHexView.ts` | 14 | `INSUFFICIENT_GOLD_COLOR` `ENEMY_BUILDING_COLOR` `RESOURCE_RESOLVED_COLOR` `NEUTRAL_FILL_ALPHA` `NEUTRAL_FILL_RGB` `HOME_NEIGHBOR_FILL_ALPHA` `BLOCKED_FILL_COLOR` `UNCONFIRMED_HQ_COLOR` `DEFAULT_TILE_ICON_POS` `RESOURCE_ICON_POS` `RESOURCE_UNIT_TARGET_HEIGHT` `RESOURCE_UNIT_SPACING` `RESOURCE_UNIT_POS_Y` `spineResourceCanvasHeight` | `ZCHexView` |
| `view/ZCFloatTextView.ts` | 9 | `FLOAT_TEXT_COLOR_BY_KIND` `DAMAGE_LANES` `EMPHASIS_FONT_SIZE` `DEFAULT_FONT_SIZE` `DAMAGE_ROW_STEP` `DAMAGE_ROW_DROP_EXTRA` `DAMAGE_ROW_SWAY_CENTER` `DAMAGE_ROW_SWAY_OFFSET` `battleText` | `ZCFloatTextView` |
| `view/ZCSpawnSelectionView.ts` | 9 | `TOAST_PANEL` `PANEL_CORNER_RADIUS` `TOAST_VISIBLE_SECONDS` `SPAWN_HINT_TEXTS` `SPAWN_URGENT_SECONDS` `URGENT` `CONFIRM_READY` `CONFIRM_INVALID` `CONFIRM_IDLE` | `ZCSpawnSelectionView` |
| `model/ZCGameModel.ts` | 7 | `STRUCTURE_TARGET_BODY_RADIUS` `HEX_STEP` `SOLDIER_WAIT_MIN` `SOLDIER_WAIT_RANDOM` `FLOAT_TEXT_DAMAGE_SECONDS` `FLOAT_TEXT_GOLD_SECONDS` `SPAWN_OFFSET_RADIUS` | `ZCGameModel` |
| `view/ZCGameHUDView.ts` | 6 | `MAP_EDGE_MARGIN_X` `MAP_EDGE_MARGIN_Y` `MAP_OVERVIEW_PADDING` `MAP_OVERVIEW_HOLD_SECONDS` `MAP_ZOOM_DURATION_SECONDS` `MAP_SETTLEMENT_ZOOM_SECONDS` | `ZCGameHUDView` |
| `ui/ZCGuideItem.ts` | 5 | `REWARD_COLUMN_X` `REWARD_ROW_PITCH` `REWARD_BLOCK_CENTER_Y` `ICON_BOX_WIDTH` `ICON_BOX_HEIGHT`（`fitInside` 见复核表） | `ZCGuideItem` |
| `view/ZCGameLegendBannerView.ts` | 6 | `BANNER_WIDTH` `FALLBACK_VIEW_WIDTH` `SLIDE_PROGRESS` `FADE_IN_PROGRESS` `FADE_START_PROGRESS` `isLeftSide`（另 2 个见复核表） | `ZCGameLegendBannerView` |
| `view/ZCUnitView.ts` | 8 | `UNIT_VISUAL_OFFSET_FRAME` `UNIT_VISUAL_OFFSET_SPINE` `UNIT_DEAD_TINT` `FOOT_SIZE_HERO` `FOOT_SIZE_UNIT` `FALLBACK_RADIUS_HERO` `FALLBACK_RADIUS_UNIT` `spineAnimationNames` | `ZCUnitView` |
| `model/ZCSpawnSelection.ts` | 5 | `ZC_SPAWN_SELECTION_SECONDS` `ZC_SPAWN_COMPRESSED_SECONDS` `ZC_SPAWN_AI_MIN_DELAY_SECONDS` `ZC_SPAWN_AI_MAX_DELAY_SECONDS` `ZC_SPAWN_AI_FOLLOW_DELAY_SECONDS` | `ZCSpawnSelection`（当前 export 无外部消费，内聚并去 export） |
| `view/ZCGameRenderWorld.ts` | 6 | `FACTION_ORDER` `LEGEND_BANNER_TIER` `SPAWN_FX_FALLBACK_DURATION` `WALL_JOIN_ALPHA_STEP` `UNIT_POSITION_SCRATCH` `UNIT_PRESENTATION_SCRATCH` | `ZCGameRenderWorld` |
| `model/ZCStatusEffect.ts` | 3 | `DEFAULT_MAX_STACKS` `cloneStatusInstance` `validRuntimeBehavior`（`cloneRuntimeBehavior` 见复核表） | `ZCStatusSystem` |
| `model/ZCSnapshotCodec.ts` | 2 | `ownerNumbers` `ownerTypeCounts`（`createTypeCounts` 见复核表） | `ZCSnapshotCodec` |
| `model/ZCLegacySkillEffect.ts` | 5 | `memberAccess` `applyBinary` → `Parser`；`expressionValue` `finite` `round2` → `ZCLegacySkillEffectRuntime` | `Parser` / `ZCLegacySkillEffectRuntime` |
| `model/ZCBattlePresentationQueue.ts` | 3 | `FLOAT_TEXT_CAP` `CARD_REVEAL_CAP` `HEX_ACTIVATION_CAP` | `ZCBattlePresentationQueue` |
| `model/systems/ZCCaptureSystem.ts` | 2 | `FOOTPRINT_SAMPLE_STEP` `isActive` | `ZCCaptureSystem` |
| `model/systems/ZCDamageResolutionSystem.ts` | 2 | `HATRED_SECONDS` `DEATH_SECONDS` | `ZCDamageResolutionSystem` |
| `view/ZCGameHudPlayerRow.ts` | 4 | `SELF_DISC_SIZE` `SELF_HEAD_SIZE` `OTHER_DISC_SIZE` `OTHER_HEAD_SIZE` | `ZCGameHudPlayerRow` |
| `view/ZCCardRevealView.ts` | 2 | `BACK_C3` `CARD_NAME_COLOR`（`BACK_C2` 见复核表） | `ZCCardRevealView` |
| `ui/ZCGuidePanel.ts` | 1 | `EMPTY_PARAMS` | `ZCGuidePanel` |
| `ZCGame.ts` | 1 | `SPAWN_SHOWCASE_SECONDS` | `ZCGame` |
| `model/systems/ZCAttackResolutionSystem.ts` | 1 | `damageFloatTextKind` | `ZCAttackResolutionSystem` |
| `model/systems/ZCLegacyCombatSystem.ts` | 1 | `legacyNumber` | `ZCLegacyCombatSystem` |
| `model/systems/ZCUnitSystem.ts` | 1 | `BORN_SECONDS` | `ZCUnitSystem` |

### 需人工复核（11 个：被单一类 + 模块级公共工厂函数共同消费）

这些符号所在文件同时以「模块级导出函数」作为公共 API（如 `parseZCLegacySkillEffectConfig`、
`build…` 渲染函数），模块函数与类都在用同一符号。直接搬进类会让模块工厂无法访问或被迫实例化。
两个选择：① 模块工厂与类合并为同一职责单元；② 保留文件级但在注释写明「类与模块工厂共享」。

| 文件 | 符号 | 共消费方 |
|---|---|---|
| `model/ZCLegacySkillEffect.ts` | `FORBIDDEN_MEMBERS` `SUPPORTED_SCRIPTS` `conditionFormula` | 类 + 模块级 `compileZCLegacyExpression` / `parseZCLegacySkillEffectConfig` |
| `model/ZCStatusEffect.ts` | `cloneRuntimeBehavior` | `ZCStatusSystem` + 模块级配置函数 |
| `ui/ZCGuideItem.ts` | `fitInside` | `ZCGuideItem` + 模块级布局函数 |
| `view/ZCCardRevealView.ts` | `BACK_C2` | `ZCCardRevealView` + 模块级构建函数 |
| `view/ZCGameLegendBannerView.ts` | `FALLBACK_VIEW_HEIGHT` `clampCount` | `ZCGameLegendBannerView` + 模块级工厂 |
| `view/ZCHexView.ts` | `TERRITORY_FILL_ALPHA` `ENEMY_DEVELOP_ICON_POS` | `ZCHexView` + 模块级渲染函数 |
| `model/ZCSnapshotCodec.ts` | `createTypeCounts` | `ZCSnapshotCodec` + 模块级计数函数 |

---

## 人工确认桶（30 个，建议保留）

- **`ZC_UNIT_CAP`**（`model/ZCGameModel.ts`）：仅 `tests/zcds-model.test.ts` 消费 —— 符合
  「公开仅因测试」例外，保留导出并注释。
- 其余 29 个（`EXPRESSION_CACHE`、`normalizeZCLegacyRows`、`asOperations`、`indexGeneralStarRows`、
  `executeGeneralStarModifiers`、`sectionForZCResource`、`depthForZCResource`、`clampedZCResourceRandom`、
  `BACK_C1`、`ZCFloatTextView` 的 10 个颜色/紧凑度常量与 `compactBattleNumber`、`BANNER_HEIGHT`、
  `WALL_ENDPOINT_KEY_SCALE`、`RESOURCE_ICON_TARGET_SIZE`、`HEX_ACT_*` 动画参数、
  `UNIT_VISUAL_CENTER_FROM_FOOT_Y` 等）：均为**模块级公共函数的内部实现**，消费方是模块自己的
  导出 API 而非任何类 —— 不属于「类作用域」，文件级保留。

## 合法共享（206 个）

`ZCGameViewUtil`（几何常量/换算，多类共享）、`ZCTheme`（主题色表，多类共享）、
`ZCOutlineLayer`（无类的功能模块）、`ZCMapGeometry`、`ZCPvpTableParser`、
`ZCClientCombatConfig` 等纯函数模块的符号，被 ≥2 类或跨文件消费，均为合法共享。

---

## 执行建议

1. **第一批**：B 类 7 个 —— 改动面小、跨文件关系明确，改完跑对应模块测试。
2. **第二批**：按 view 目录逐文件内聚 A 类（`ZCHexView`/`ZCSpawnSelectionView`/`ZCFloatTextView`
   等较大的文件单独成批），每批跑 `npx tsx --test tests/zcds-*.test.ts` 对比失败名单。
3. **第三批**：11 个复核项，结合「模块工厂是否该并入类」做结构判断。
4. 内聚时注意：常量改为 `private static readonly`、纯函数改为 `private` 方法（若用到
   `this` 之外的共享数据，保持 static 避免无谓实例化）；行为不变、逐边/逐帧比对结果一致。
