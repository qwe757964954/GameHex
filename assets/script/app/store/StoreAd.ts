/**
 * 商城的广告门：播放广告、映射广告位、读取每日上限。
 *
 * 广告流程固定为两步：先播完广告，再发 RequestWatchAdvert 记为看过一次。
 * 目前没有广告 SDK，playStoreAd 只是模拟播放；接入微信激励视频时只改它的函数体，
 * 调用方不用动。
 *
 * 本文件保持纯函数，不 import CacheMgr，否则单测会被 cc 依赖链拖进来。
 * 「已用 / 剩余次数」放在 StoreRepository.adRemaining()。
 */

/** 广告位类型，数值与 RefEnum.AdType 对齐。这里不直接 import 枚举，避免生成产物重复声明导致单测失败。 */
export const STORE_AD_TYPE_COMMON_BOX = 1;
export const STORE_AD_TYPE_SUPER_BOX = 2;
export const STORE_AD_TYPE_GOLD_SHOP = 3;

/** Mock 一次广告播放的时长；真 SDK 接入后随 playStoreAd 一起删掉。 */
const MOCK_AD_PLAY_MS = 800;

/**
 * 播一次广告。
 * 返回 true 表示完整看完，调用方才发 RequestWatchAdvert；false 表示未看完或失败。
 */
export async function playStoreAd(): Promise<boolean> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, MOCK_AD_PLAY_MS);
    });
    return true;
}

/** 宝箱卡序号转广告位：只有 2 走高级宝箱，其余都按普通宝箱处理。 */
export function storeAdTypeOfBox(boxId: unknown): number {
    return Number(boxId) === 2 ? STORE_AD_TYPE_SUPER_BOX : STORE_AD_TYPE_COMMON_BOX;
}

/**
 * ad 表里某个广告位的每日上限。表缺失或该行没有有效值时按 1 处理，
 * 避免文案出现 1/0。
 */
export function storeAdLimit(adRows: readonly unknown[], type: number): number {
    for (const raw of adRows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        if (Number(row.type) !== type) continue;
        const limit = Number(row.limit);
        return Number.isFinite(limit) && limit > 0 ? limit : 1;
    }
    return 1;
}
