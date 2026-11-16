/**
 * 阵型的数据模型与边界校验，纯函数、零引擎依赖。
 * FormationService 负责网络与缓存，本文件只回答这份数据能不能用。
 */

/**
 * 兼容旧导出：阵型单测与旧调用方曾从本模块取 `withTimeout`。
 * 真源在 `app/net/RequestGuard`，行为与参数保持不变。
 */
export { withTimeout } from '../net/RequestGuard';

/**
 * 经过边界校验的阵型。heroIds 与 pvpCard.id、后端英雄 heroId 同一套编号，
 * 与卡表对齐时用 String(heroId)。
 */
export interface ZCFormation {
    readonly formationId: number;
    readonly heroIds: readonly number[];
    /** 1=当前选中阵型，0=未选中 */
    readonly selected: boolean;
}

/** 单条阵型的边界校验；`heroId` 逐项过滤非法值并去重（同一英雄只能上一次）。 */
export function normalizeFormation(info: CmdFormationInfo | null | undefined): ZCFormation | null {
    if (!info) return null;
    const formationId = toPositiveInt(info.formationId);
    if (formationId === null) return null;
    return { formationId, heroIds: normalizeHeroIds(info.heroId), selected: info.select === 1 };
}

/**
 * 整份列表逐条校验，按 formationId 去重后升序。升序供页签下标映射使用。
 */
export function normalizeFormations(infos: CmdFormationInfoRspMsg['infos']): readonly ZCFormation[] {
    const result = new Map<number, ZCFormation>();
    for (const info of infos ?? []) {
        const formation = normalizeFormation(info);
        if (!formation) {
            console.warn('[FormationModel] 服务端返回了非法阵型数据，已跳过', info);
            continue;
        }
        result.set(formation.formationId, formation);
    }
    // 必须用 `Array.from` 而不是 `[...result.values()]`：构建期 Babel（loose）会把展开
    // 降级成 `[].concat(map.values())`，而 concat 不展开迭代器 → 调用方拿到的是 [MapIterator]，
    // 遍历它得到的东西根本不是 ZCFormation（`PvpHeroService` 同款坑）。
    return Array.from(result.values()).sort((a, b) => a.formationId - b.formationId);
}

/** 上阵英雄 id 列表：过滤非法项并去重，保持原顺序。 */
export function normalizeHeroIds(heroIds: readonly number[] | null | undefined): number[] {
    const seen = new Set<number>();
    const result: number[] = [];
    for (const raw of heroIds ?? []) {
        const heroId = toPositiveInt(raw);
        if (heroId === null || seen.has(heroId)) continue;
        seen.add(heroId);
        result.push(heroId);
    }
    return result;
}

/** 正整数字段（`uint32` 的 `formationId` / `heroId` 都是这个口径）。 */
export function toPositiveInt(value: unknown): number | null {
    const num = Number(value);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
}
