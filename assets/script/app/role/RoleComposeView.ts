/**
 * 一键合成按宝石品质聚合材料和预计产出，每个品质在各自列表中只出现一次。
 * 品质 q 的材料产出 `floor(count / consume[q + 1])` 颗品质 q + 1 的宝石，本次产出不参与下一档计算。
 * `gemCount` 包含未知材料，`outputCount` 是各档预计产出之和，`topQuality` 取已识别材料的最高品质，无已识别材料时为 0。
 */
import type { IRoleGemEntry } from './RoleTypes';

/** 聚合输入的一条材料（`CmdGemPreview.num` 已由仓库层摊平成 count）。 */
export interface IRoleComposeMaterial {
    readonly id: string;
    readonly count: number;
}

/** 一条材料解析到的宝石信息（`ops.find` 的展示投影）。 */
export interface IRoleComposeGem {
    readonly quality: number;
    readonly iconKey: string;
}

/** 一档品质的棋子（材料区 / 产出区共用）。 */
export interface IRoleComposeChip {
    readonly quality: number;
    readonly count: number;
    /** 代表图标（`gemQuality.icon`，同品质共用一张图；空串 = 无图，界面留白）。 */
    readonly iconKey: string;
}

/** `gemQuality` 一行：品质、合成消耗（做出该档需要几张低一档）、图标键。 */
export interface IRoleComposeQuality {
    readonly quality: number;
    readonly consume: number;
    readonly iconKey: string;
}

/** 弹窗要渲染的完整视图数据。 */
export interface IRoleComposeView {
    /** 材料：按品质升序，一档一格。 */
    readonly materials: readonly IRoleComposeChip[];
    /** 预计产出：按品质升序，一档一格；算不出来时为空（弹窗隐藏产出区）。 */
    readonly outputs: readonly IRoleComposeChip[];
    /** 材料总颗数（= Σ 材料 count，含查不到品质的材料）。 */
    readonly gemCount: number;
    /** 预计产出总颗数（= Σ outputs count）。 */
    readonly outputCount: number;
    /** 最高品质（1..8；0 = 没有可解析的材料），决定高品质二次确认。 */
    readonly topQuality: number;
}

/** 二次确认的品质门槛：>= 5（传说 / 绝世 / 神话）合成后不可找回。 */
export const ROLE_COMPOSE_HIGH_QUALITY = 5;

/**
 * 把 `preview.materials` 聚合成弹窗的两段棋子。
 *
 * @param materials 材料 id + 数量（同 id 重复出现会累加，防止服务端分批发）
 * @param find      按 id 查宝石品质 / 图标；返回 null 表示查不到（只计入 total，不占棋子）
 * @param qualities `gemQuality` 全表（品质 → consume / icon），产出估算与图标来源
 */
export function buildRoleComposeView(
    materials: readonly IRoleComposeMaterial[],
    find: (id: string) => IRoleComposeGem | null,
    qualities: readonly IRoleComposeQuality[],
): IRoleComposeView {
    // ① 先按 id 累加：同 id 的材料只算一次，数量取和。
    const countById = new Map<string, number>();
    let gemCount = 0;
    for (const material of materials) {
        const count = Math.max(0, Math.floor(material.count) || 0);
        if (count <= 0) continue;
        countById.set(material.id, (countById.get(material.id) ?? 0) + count);
        gemCount += count;
    }

    // ② 按品质汇总材料；同品质的 iconKey 取首条非空。
    const materialByQuality = new Map<number, IRoleComposeChip>();
    let topQuality = 0;
    for (const [id, count] of countById) {
        const gem = find(id);
        const quality = Math.max(0, Math.floor(gem?.quality ?? 0) || 0);
        const iconKey = gem?.iconKey ?? '';
        if (quality <= 0) continue; // 查不到品质：只进 gemCount，不画棋子
        if (quality > topQuality) topQuality = quality;
        const prev = materialByQuality.get(quality);
        materialByQuality.set(quality, {
            quality,
            count: (prev?.count ?? 0) + count,
            iconKey: prev?.iconKey || iconKey,
        });
    }

    const qualityInfo = new Map<number, IRoleComposeQuality>();
    for (const row of qualities) {
        const q = Math.floor(row.quality) || 0;
        if (q > 0) qualityInfo.set(q, row);
    }

    // ③ 逐档估算产出：q 档 → q+1 档，消耗取 q+1 的 consume；不跨档结转。
    const outputByQuality = new Map<number, IRoleComposeChip>();
    for (const chip of materialByQuality.values()) {
        const next = qualityInfo.get(chip.quality + 1);
        const consume = Math.max(0, Math.floor(next?.consume ?? 0) || 0);
        if (!next || consume <= 0) continue;
        const produced = Math.floor(chip.count / consume);
        if (produced <= 0) continue;
        const prev = outputByQuality.get(next.quality);
        outputByQuality.set(next.quality, {
            quality: next.quality,
            count: (prev?.count ?? 0) + produced,
            iconKey: prev?.iconKey || next.iconKey,
        });
    }

    const sortedMaterials = Array.from(materialByQuality.values())
        .sort((a, b) => a.quality - b.quality);
    const sortedOutputs = Array.from(outputByQuality.values())
        .sort((a, b) => a.quality - b.quality);
    const outputCount = sortedOutputs.reduce((sum, chip) => sum + chip.count, 0);

    return {
        materials: sortedMaterials,
        outputs: sortedOutputs,
        gemCount,
        outputCount,
        topQuality,
    };
}

/** `ops.find` 的返回值（`IRoleGemEntry`）→ 聚合用的展示投影。 */
export function composeGemOf(gem: IRoleGemEntry): IRoleComposeGem {
    return { quality: gem.quality, iconKey: gem.iconKey };
}
