/**
 * 中立资源组合表的**测试夹具**。
 *
 *  内容对齐 `PVP-中立资源配置.xlsx / 中立资源组合`（2026-10-26 版）：
 *  覆盖 6 种 `resourceType`（宝箱 / 金矿 / 兵团 / 神器充能 / 兵营 / 战斗Buff）+ 一个多行混合组合，
 *  资源项 id 与正式表一致，改表时这里要一起改（用例断言的是行为，不是数值）。
 *
 *  ⚠️ 为什么不用 `assets/remoteRef/neutralResourceGroup.json`：那份是压缩后的 `{k,v}` 形状，
 *  解析要依赖 `ConfigService`；用例要的是「装一张确定的目录」，手写更稳也更好读。
 */
import {
    compileZCNeutralResourceCatalog,
    setZCNeutralResourceCatalog,
    type ZCNeutralResourceCatalog,
} from '../../assets/script/app/zcds/model/ZCNeutralResourceGroup';

/** 卡目录桩：只有资源项引用到的两张卡（金矿 2001 / 兵营 68001）。 */
const TEST_CARDS = new Map<string, { id: string; type: number }>([
    ['2001', { id: '2001', type: 1 }],
    ['68001', { id: '68001', type: 2 }],
]);

/** 与正式表一致的组合行（`param` 形状按 `resourceType` 分支）。 */
export const ZC_TEST_NEUTRAL_RESOURCE_ROWS: ReadonlyArray<Record<string, unknown>> = [
    { groupId: 13001, id: 1300101, groupName: '金币宝箱', resourceType: 1, weight: 10000, param: 50, icon: 'gold' },
    { groupId: 13002, id: 1300201, groupName: '混合资源', resourceType: 1, weight: 5000, param: 50, icon: 'gold' },
    { groupId: 13002, id: 1300202, groupName: '混合资源', resourceType: 3, weight: 3000, param: { resId: '68001', value: 3 }, icon: null },
    { groupId: 13002, id: 1300203, groupName: '混合资源', resourceType: 4, weight: 2000, param: 1, icon: null },
    { groupId: 13003, id: 1300301, groupName: '大金币宝箱', resourceType: 1, weight: 10000, param: 100, icon: 'chest' },
    { groupId: 13004, id: 1300401, groupName: '固定兵团', resourceType: 3, weight: 10000, param: { resId: '68001', value: 3 }, icon: null },
    { groupId: 13005, id: 1300501, groupName: '固定金矿', resourceType: 2, weight: 10000, param: { resId: '2001' }, icon: null },
    { groupId: 13006, id: 1300601, groupName: '固定兵营', resourceType: 5, weight: 0, param: { resId: '68001' }, icon: null },
    { groupId: 13008, id: 1300801, groupName: '固定战斗Buff', resourceType: 6, weight: 0, param: { resId: '中立资源攻击强化' }, icon: null },
];

/** 装一份确定的目录，返回它（用例要断言 id / visual 时直接用）。 */
export function installZCNeutralTestCatalog(
    rows: ReadonlyArray<Record<string, unknown>> = ZC_TEST_NEUTRAL_RESOURCE_ROWS,
): ZCNeutralResourceCatalog {
    const catalog = compileZCNeutralResourceCatalog(rows, TEST_CARDS as never);
    setZCNeutralResourceCatalog(catalog);
    return catalog;
}

/** 清空目录（用例之间相互隔离，避免上一个用例装进来的表泄漏）。 */
export function clearZCNeutralTestCatalog(): void {
    setZCNeutralResourceCatalog(null);
}

/** 资源项 id 的具名常量：用例里写 `ZC_TEST_ITEM.UnitCap` 比写 1300401 好读。 */
export const ZC_TEST_ITEM = {
    /** 金币宝箱（type1，param 50，icon gold）。 */
    Gold: 1300101,
    /** 混合资源·宝箱（type1，param 50）。 */
    MixedGold: 1300201,
    /** 混合资源·兵团（type3，68001 × 3）。 */
    MixedUnit: 1300202,
    /** 混合资源·充能（type4，1 点）。 */
    MixedCharge: 1300203,
    /** 大金币宝箱（type1，param 100，icon chest）。 */
    BigChest: 1300301,
    /** 固定兵团（type3，68001 × 3）。 */
    Unit: 1300401,
    /** 固定金矿（type2，2001）。 */
    Mine: 1300501,
    /** 固定兵营（type5，68001）。 */
    Barracks: 1300601,
    /** 固定战斗Buff（type6）。 */
    Buff: 1300801,
} as const;
