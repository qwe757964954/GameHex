/**
 * 「巡逻宝箱」详情纯数据构造（对齐 MonsterBox 视觉设计规范）。
 *
 * 与 `buildTerritoryLevelInfo` / `buildTerritoryPlayerStage` 同一职责：
 * **Model 只负责把站点 + 服务端等级 + 宝箱组配置翻译成纯数据**，不碰任何 `cc` 资源；
 * 图标（宝箱模型 / 银币 / 守护怪头像）由页面装配 `TerritoryMonsterBoxPanel` 时补。
 *
 * ## 数值口径（全部来自 `monsterBox` 表，见 `TerritoryMonsterBoxConfig`）
 *
 * | 面板字段 | 取值 |
 * | --- | --- |
 * | `maxLv` | 组内最大 `monsterBoxGrade` |
 * | `upgradeCost` | **升到 `lv + 1`** 那行的 `monsterBoxUpCostCoins` |
 * | `successRate` | 同上那行的 `monsterBoxUpPro`（百分数） |
 * | `failLimit` | 同上那行的 `maxUpFailTimes` |
 * | `rewards` | **当前 `lv`** 那行的 `monsterBoxVictoryRwrad`（`pro` 万分比 → 百分比） |
 * | `battleEnabled` | 这一格有没有绑到关卡行 |
 * | `guards[].headIcon` | **当前 `lv`** 那行的 `monsterBoxLevel` → `levelInfo.levelMonsterGroup` 前 N 只 → `monsterCard.headIcon` |
 * | `upgradeAttempt` | Model 记的最近一次升级回包结果（原样透传，这里不判成功） |
 *
 * @note 升级所需消耗取 grade = lv + 1 配置，奖励与守护怪取当前等级配置。
 */

import type { TerritoryCampaignStage, TerritoryGuardMonster } from './TerritoryCampaignConfig';
import type { TerritorySite } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import { gradeOf, maxGradeOf, type ITerritoryMonsterBoxGroup } from './TerritoryMonsterBoxConfig';
import { TERRITORY_MONSTER_BOX_SPEC } from './TerritoryMonsterBoxSpec';

/** 一格奖励（与 `ITerritoryLevelDrop` 同形 + 概率/区间；Model 侧不引 application 层的类型）。 */
export interface ITerritoryMonsterBoxReward {
    readonly resId: number;
    /** 代表数量（取该资源各档里的**最大值**，用于图标解析与排序）。 */
    readonly amount: number;
    /** 数量区间文案（`100~500`）；同资源只有一档时不填，按 `amount` 显示。 */
    readonly amountText?: string;
    /** 概率（百分比，`100` ⇒ 100%）；`0` = 不显示。 */
    readonly ratePercent: number;
}

/** 守护怪格。 */
export interface ITerritoryMonsterBoxGuardState {
    readonly unlocked: boolean;
    /** 空串 = 已解锁，不显示解锁条件。 */
    readonly unlockText: string;
    /**
     * 守护怪头像（`monsterCard.headIcon`：图标名或直路径，**原样透传**，由 `HeadArt` 解析）。
     *
     * 空串 = 这一关的 `levelMonsterGroup` 没配够 / 那只怪没配头像：
     * 面板保留米黄卡底、不画头像（只有未解锁才换成深棕锁卡），不把格子藏起来。
     */
    readonly headIcon: string;
    /** 守护怪数量文案（`数量：44`）；空串 = 表里没填 / 未解锁，整行隐藏。 */
    readonly countText: string;
}

/**
 * 一次升级摇奖的回包结果 —— **只给前端演动画用**。
 *
 * 等级真值仍以服务端快照 `monsterBoxInfos` 为准（`lv` 不在这里），
 * 这里只有「成功 / 失败」这一比特，否则「停在绿区还是灰区」就得由视图自己猜。
 */
export interface ITerritoryMonsterBoxAttempt {
    /** 格子号；面板只认自己这一格的结果（玩家可能在回包前点了别的格子）。 */
    readonly cellId: number;
    /** 递增序号：面板按「比开演时大」判这是新一次，避免重放旧结果。 */
    readonly seq: number;
    readonly success: boolean;
}

/** 构造入参。 */
export interface ITerritoryMonsterBoxDetailInput {
    readonly site: TerritorySite | null;
    /** 服务端宝箱记录的格子号，用于升级请求。 */
    readonly boxCellId?: number;
    /** 这一格绑到的关卡行；`null` ⇒ 挑战按钮置灰（`battleId` 在 `monsterBox` 表里查不到）。 */
    readonly stage: TerritoryCampaignStage | null;
    /** 服务端下发的这一格宝箱等级（`0` = 还没拉到快照）。 */
    readonly lv: number;
    /** 这一格的宝箱组配置（`monsterBox` 表）；`null` ⇒ 只显示等级与挑战，升级块收起。 */
    readonly group: ITerritoryMonsterBoxGroup | null;
    /** 关卡 id → 守护怪（`levelInfo.levelMonsterGroup`）；缺省 ⇒ 守护怪只留占位图。 */
    readonly monsterGroupByLevelId?: ReadonlyMap<number, readonly TerritoryGuardMonster[]> | null;
    /** 最近一次升级摇奖的回包结果；缺省 / `null` ⇒ 还没摇过。 */
    readonly attempt?: ITerritoryMonsterBoxAttempt | null;
    /** 这一格累计升级失败次数；缺省为 0。 */
    readonly failCount?: number;
}

/** 构造结果（结构对齐 `TerritoryModel.ITerritoryMonsterBoxDetail`）。 */
export interface ITerritoryMonsterBoxDetailContent {
    readonly cellId: number;
    readonly lv: number;
    readonly maxLv: number;
    readonly upgradeCost: number;
    /** 升级消耗货币的 resId（7: 银币，10: 金币/幻灵玉）。 */
    readonly costResId: number;
    readonly successRate: number;
    readonly failCount: number;
    readonly failLimit: number;
    readonly upgrading: boolean;
    readonly upgradeProgress: number;
    readonly guards: readonly ITerritoryMonsterBoxGuardState[];
    readonly rewards: readonly ITerritoryMonsterBoxReward[];
    readonly title: string;
    readonly battleCaption: string;
    readonly battleEnabled: boolean;
    readonly upgradeCaption: string;
    readonly footerText: string;
    /** 最近一次升级摇奖的结果（面板据此决定黄条停在绿区还是灰区）；`null` = 还没摇过。 */
    readonly upgradeAttempt: ITerritoryMonsterBoxAttempt | null;
}

/**
 * 奖励池 → 面板格子：同一个 resId 的多档合并成单格展示。
 * 数量按区间汇总（如 100~500），概率取该资源的最高档展示。
 *
 * 合并口径：
 * - 数量写**区间**（`100~500`）—— 表里本来就是"抽到哪档给多少"；
 * - 概率取该资源的**最高档**（`10000` ⇒ 100%）—— 玩家关心"至少有多大概率拿到"。
 *
 * 去重后正好覆盖全部资源种类（当前配置是 4 种：`10010` / `7` / `19350` / `19301`），
 * 与面板 4 个格子一一对应；将来种类超过格子数再加虚拟列表。
 */
function mergeRewardsByResId(pool: readonly { resId: number; amount: number; pro: number }[]): ITerritoryMonsterBoxReward[] {
    const byResId = new Map<number, { min: number; max: number; pro: number }>();
    for (const entry of pool) {
        const prev = byResId.get(entry.resId);
        if (!prev) {
            byResId.set(entry.resId, { min: entry.amount, max: entry.amount, pro: entry.pro });
            continue;
        }
        prev.min = Math.min(prev.min, entry.amount);
        prev.max = Math.max(prev.max, entry.amount);
        prev.pro = Math.max(prev.pro, entry.pro);
    }
    return Array.from(byResId, ([resId, item]) => ({
        resId,
        amount: item.max,
        // 万分比 → 百分比（`10000` ⇒ 100）
        ratePercent: Math.round(item.pro / 100),
        // 单档时不写这个键（`undefined` 也会被 `deepEqual` 当成差异）
        ...(item.min === item.max ? {} : { amountText: `${item.min}~${item.max}` }),
    }));
}

/**
 * 构造「巡逻宝箱」详情；选中的不是巡逻宝箱格时返回 `null`。
 *
 * 三档收口（都按「宁可少显示，不显示假数据」）：
 * - 组配置缺失 ⇒ 不给升级入口（`upgradeCost = 0`、`upgradeCaption` 空串）；
 * - 满级 ⇒ 同上 + 底部换满级文案；
 * - 绑不到关卡行 ⇒ 挑战按钮置灰 + 底部写明「这一片还没有配巡逻关卡」。
 */
export function buildTerritoryMonsterBoxDetail(
    input: ITerritoryMonsterBoxDetailInput,
): ITerritoryMonsterBoxDetailContent | null {
    const { site, boxCellId, stage, lv, group } = input;
    if (!site || site.type !== TERRITORY_SITE_TYPE.patrolChest) return null;

    const spec = TERRITORY_MONSTER_BOX_SPEC;
    // 数值安全兜底：非有限值一律归零。
    const rawLevel = Number(lv);
    const level = Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : 0;

    const maxLv = maxGradeOf(group);
    const isMax = maxLv > 0 && level >= maxLv;
    // 「升到下一级」的那行才是消耗 / 成功率 / 失败上限的来源
    const nextGrade = gradeOf(group, level + 1);
    // 奖励池按**当前级**取（打赢这一级的巡逻野怪掉的就是它）
    const currentGrade = gradeOf(group, level);
    const failCount = input.failCount !== undefined ? Math.max(0, Math.floor(Number(input.failCount) || 0)) : -1;
    const maxFailTimes = nextGrade ? nextGrade.maxFailTimes : 0;
    const reachedFailLimit = maxFailTimes > 0 && failCount >= 0 && failCount >= maxFailTimes;
    // 当失败次数达到上限时，如果有配金币消耗（monsterBoxUpCostDiamond），切成金币；否则不可升级
    const useDiamond = !isMax && nextGrade !== null && reachedFailLimit && nextGrade.upCostDiamond > 0;
    const canUpgrade = !isMax && nextGrade !== null && (
        useDiamond ? true : (!reachedFailLimit && nextGrade.upCostCoins > 0)
    );
    const upgradeCost = canUpgrade ? (useDiamond ? nextGrade.upCostDiamond : nextGrade.upCostCoins) : 0;
    const costResId = useDiamond ? 10 : 7;

    // 守护怪头像按「当前等级那一关」的 `levelMonsterGroup` 取：
    // 等级行的 `monsterBoxLevel` 会随等级换关（如 1002 组 grade 4 → 60004），
    // 用静态绑定的 `stage.levelId` 会在满级后显示上一关的怪。
    const guardLevelId = currentGrade?.levelId ?? stage?.levelId ?? 0;
    const guardMonsters = input.monsterGroupByLevelId?.get(guardLevelId) ?? [];

    const guards: ITerritoryMonsterBoxGuardState[] = [];
    for (let index = 0; index < spec.guardCount; index += 1) {
        const requiredLv = spec.guardUnlockLvs[Math.min(index, spec.guardUnlockLvs.length - 1)] ?? 0;
        const unlocked = level >= requiredLv;
        const guard = guardMonsters[index];
        const guardCount = guard?.count ?? 0;
        guards.push({
            unlocked,
            unlockText: unlocked ? '' : `${requiredLv} 级解锁`,
            headIcon: guard?.headIcon ?? '',
            countText: unlocked && guardCount > 0 ? `数量：${guardCount}` : '',
        });
    }

    const rewards = mergeRewardsByResId(currentGrade?.rewards ?? []);

    const battleEnabled = stage !== null;
    let footerText: string = spec.footerText;
    if (!battleEnabled) footerText = spec.footerTextNoLevel;
    else if (isMax) footerText = spec.footerTextAtMaxLv;

    return {
        cellId: boxCellId ?? site.cellId,
        lv: level,
        maxLv: maxLv > 0 ? maxLv : level,
        upgradeCost,
        costResId,
        successRate: canUpgrade ? nextGrade.upPro : 0,
        failCount,
        failLimit: canUpgrade ? nextGrade.maxFailTimes : 0,
        upgrading: false,
        upgradeProgress: 0,
        guards,
        rewards,
        title: spec.title,
        battleCaption: spec.battleCaption,
        battleEnabled,
        upgradeCaption: canUpgrade ? spec.upgradeCaption : '',
        footerText,
        upgradeAttempt: input.attempt ?? null,
    };
}
