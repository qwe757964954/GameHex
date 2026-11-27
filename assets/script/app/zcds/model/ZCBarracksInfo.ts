import type { ZCDeckCard, ZCUnitDefinition } from './ZCCombatCatalog';
import { getZCModifierCatalogs, type ZCModifierCatalogs } from './ZCModifierRuntime';
import type { ZCSkillPlanRecord, ZCUnitGrowthRecord } from './ZCStatSchema';

/** 兵营信息面板的一行六维属性。 */
export interface IZCBarracksStatInfo {
    label: string;
    value: string;
    /** 升到下一级时这项属性的增量（`+160`）；无成长数据或增量为 0 时为空串。*/
    gain: string;
}

/** 兵营信息面板的一个技能格。 */
export interface IZCBarracksSkillInfo {
    skillId: number;
    name: string;
    description: string;
    unlocked: boolean;
    /** 未解锁时的英雄等级门槛；已解锁为 0。*/
    unlockLevel: number;
    /** 数值被动（设计稿六边形下面的「被动」蓝标）。*/
    passive: boolean;
    /** 这张卡没有第 N 个技能时的占位格（面板显示空六边形）。*/
    empty: boolean;
}

export interface IZCBarracksInfoPresentation {
    cardId: string;
    name: string;
    stats: readonly IZCBarracksStatInfo[];
    skills: readonly IZCBarracksSkillInfo[];
}

function trimNumber(value: number, digits = 0): string {
    return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function gainText(value: number, digits = 0): string {
    if (!Number.isFinite(value) || value <= 0) return '';
    return `+${trimNumber(value, digits)}`;
}

/** 建筑外观名 `barracks-金发老板` 的后半段就是设计稿名牌；没有时退回卡名。*/
function displayNameOf(card: ZCDeckCard): string {
    const tail = card.buildIcon?.split('-').slice(1).join('-').trim();
    return tail || card.name;
}

function growthGain(
    current: ZCUnitGrowthRecord | undefined,
    next: ZCUnitGrowthRecord | undefined,
    base: number,
    flatKey: 'maxHpFlat' | 'attackFlat' | 'attackRangeFlat' | null,
    rateKey: 'maxHpRate' | 'attackRate' | 'moveSpeedRate' | null,
): number {
    if (!next) return 0;
    const flat = flatKey ? next[flatKey] - (current?.[flatKey] ?? 0) : 0;
    const rate = rateKey ? next[rateKey] - (current?.[rateKey] ?? 0) : 0;
    return flat + rate * base;
}

function buildStats(
    definition: ZCUnitDefinition,
    heroLevel: number,
    catalogs: ZCModifierCatalogs,
): IZCBarracksStatInfo[] {
    const unitId = String(definition.unitId);
    const level = Math.max(1, Math.round(heroLevel) || 1);
    const current = catalogs.adapters.growth.get(`${unitId}:${level}`);
    const next = catalogs.adapters.growth.get(`${unitId}:${level + 1}`);
    const hpGain = growthGain(current, next, definition.maxHp, 'maxHpFlat', 'maxHpRate');
    const attackGain = growthGain(current, next, definition.attack, 'attackFlat', 'attackRate');
    const rangeGain = growthGain(current, next, definition.attackRange, 'attackRangeFlat', null);
    const speedGain = growthGain(current, next, definition.moveSpeed, null, 'moveSpeedRate');
    return [
        { label: '兵种血量', value: trimNumber(Math.round(definition.maxHp)), gain: gainText(hpGain) },
        { label: '兵种攻击', value: trimNumber(Math.round(definition.attack)), gain: gainText(attackGain) },
        { label: '攻击间隔', value: trimNumber(definition.attackInterval, 2), gain: '' },
        { label: '产兵间隔', value: trimNumber(definition.spawnSeconds), gain: '' },
        { label: '兵种射程', value: trimNumber(Math.round(definition.attackRange)), gain: gainText(rangeGain) },
        { label: '兵种移速', value: trimNumber(Math.round(definition.moveSpeed)), gain: gainText(speedGain, 1) },
    ];
}

function activePlanOf(
    rows: readonly ZCSkillPlanRecord[],
    heroLevel: number,
): ZCSkillPlanRecord | null {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => a.skillLevel - b.skillLevel);
    const unlocked = sorted.filter(row => heroLevel >= row.unlockHeroLevel);
    return unlocked[unlocked.length - 1] ?? sorted[0];
}

const EMPTY_SKILL: IZCBarracksSkillInfo = {
    skillId: 0, name: '', description: '', unlocked: false, unlockLevel: 0, passive: false, empty: true,
};

function buildSkill(
    skillId: number,
    heroLevel: number,
    plans: readonly ZCSkillPlanRecord[],
): IZCBarracksSkillInfo {
    const rows = plans.filter(row => row.enabled && row.skillChainId === skillId);
    const active = activePlanOf(rows, heroLevel);
    if (!active) {
        return { ...EMPTY_SKILL, skillId, empty: true };
    }
    const unlocked = heroLevel >= active.unlockHeroLevel;
    return {
        skillId,
        name: active.skillName ?? '',
        description: active.description ?? '',
        unlocked,
        unlockLevel: unlocked ? 0 : active.unlockHeroLevel,
        passive: active.skillKind === 'passive_stat',
        empty: false,
    };
}

/**
 * 兵营点击面板的唯一数据装配口（纯函数，不碰节点/资源）。
 *
 * 六行口径与卡牌详情 `buildDetailStats` 一致：兵种血量 / 攻击 / 攻击间隔 / 产兵间隔 /
 * 射程 / 移速，取本局生效属性（`effectiveDefinitionForUnit`），所以服务端倍率、卡级、
 * 技能被动都已经算进去。右侧绿色增量取 `pvpGrowth` 本级→下一级的差值，没有成长数据就留空。
*/
export function buildZCBarracksInfo(
    card: ZCDeckCard,
    definition: ZCUnitDefinition,
    heroLevel: number,
    catalogs: ZCModifierCatalogs = getZCModifierCatalogs(),
): IZCBarracksInfoPresentation {
    const level = Math.max(1, Math.round(heroLevel) || 1);
    const plans = catalogs.adapters.skillPlans.filter(row => row.unitId === String(card.unitId));
    const ids = (card.skillIds ?? []).slice(0, 4);
    const skills = ids.map(id => buildSkill(id, level, plans));
    while (skills.length < 4) skills.push(EMPTY_SKILL);
    return {
        cardId: card.id,
        name: displayNameOf(card),
        stats: buildStats(definition, level, catalogs),
        skills,
    };
}
