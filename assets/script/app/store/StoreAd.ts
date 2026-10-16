/**
 * 「商城」的**广告门** —— 播放 + 广告位次数。
 *
 * 与 `league/LeagueAd.ts` **同源同算法**，但**不复用**那份：
 * `league` 那三个函数（`leagueAdLimit` / `leagueAdUsed` / `leagueAdRest`）已经按 `type`
 * 参数化了、`playLeagueAd` 也是通用的，直接 import 会让 `store` 反向依赖 `league` 模块。
 * 两边各持一份，代价是 30 行重复，收益是模块边界干净（与 `RequestShopBuy` 的处置一致）。
 *
 * ## 老端是两步，绝不能被合成一步
 *
 * 先 `CtrlPay.PayforAdVideo(type)`（**真把广告放完**，拿到凭据），再发
 * `RequestRoleWatchAdvert`（`CmdRoleWatchAdvertReqMsg { type }`）记为「看过一次」。
 *
 * Demo3.8 **没有广告 SDK** ⇒ {@link playStoreAd} 目前是 **Mock**：短暂模拟一次播放后
 * 按「看完」返回。**关键是「先播后发」** —— `RequestWatchAdvert` 本身就是发奖凭据，
 * 裸发等于白拿（商城这边 `ad.json` 的 `type=3` 直接送 500 银币）。
 *
 * ⚠️ 真接入点：微信小游戏走 `wx.createRewardedVideoAd()`，`onClose(res)` 里
 *    `res && res.isEnded` 为 true 才算看完。届时只换 {@link playStoreAd} 的函数体，
 *    **调用方一行都不用改**。
 *
 * ## 商城用到的广告位（数值与 `ad.json` 的 `type` 一一对应）
 *
 * | 动作 | 广告位 | 值 | `ad.json` 对应行 |
 * |---|---|---|---|
 * | 低级宝石宝箱「免费抽」 | `commonBox` | 1 | `{type:1, desc:普通宝石宝箱, limit:1, rewards:[{1,10013}]}` |
 * | 高级宝石宝箱「免费抽」 | `superBox` | 2 | `{type:2, desc:璀璨钻石宝箱, limit:1, rewards:[{1,10013}]}` |
 * | 铜钱铺（银币）广告档 | `goldShop` | 3 | `{type:3, desc:金币商城, limit:1, rewards:[{500,7}]}` |
 *
/**
 * ⚠️ 老端 `GetAdType(refGemBox.id)`：`id == 2 ⇒ superBox`，**其余一律 `commonBox`**
 *    （`default` 分支，不是「id==1 才是 commonBox」）。本端 {@link storeAdTypeOfBox} 同口径。
 *
 * ## ⚠️ 本文件**保持纯净**（不 import `CacheMgr`）
 *
 * 「今天还能看几次」要读 `CmdRole.tlCmdAdvert`，那必须过 `CacheMgr` —— 而
 * `CacheMgr → CacheMgrGen → GameCacheMgr → engine/ResourceMgr` 这条链会把 `cc` 拉进来，
 * 于是**本模块整份进不了单测**（`tests/storeActions.test.ts` 里 `H1/H2/H3` 会全炸）。
 *
 * 所以这里只留**纯函数**（播放 + 广告位映射 + `ad` 表上限），
 * 「已用 / 剩余次数」的读缓存部分放在 `StoreRepository.adRemaining()`（那份本来就不测）。
 */

/**
 * 广告位类型（对齐 `RefEnum.AdType`）。
 *
 * ⚠️ **刻意不 import `AdType` 枚举** —— 与 `hang/HangRepository.ts` 同一处置：
 *    `generated/refGen/RefEnum.ts` 里有重复声明（生成产物自身的问题，如
 *    `suijijinengjuanzhou` 声明了两次），`esbuild`（单测走的 transformer）会直接抛
 *    `The symbol "..." has already been declared`，导致本模块**进不了单测**。
 *    数值两端同源（`generated/refGen/RefEnum.ts` 的 `AdType`），改一处这里能一眼看出。
 */
export const STORE_AD_TYPE_COMMON_BOX = 1; // AdType.commonBox
export const STORE_AD_TYPE_SUPER_BOX = 2;  // AdType.superBox
export const STORE_AD_TYPE_GOLD_SHOP = 3;  // AdType.goldShop

/** Mock 一次广告播放的时长（ms）。真 SDK 接入后随 {@link playStoreAd} 一起删掉。 */
const MOCK_AD_PLAY_MS = 800;

/**
 * 播一次广告。
 *
 * @returns `true` = 完整看完（调用方才发 `RequestWatchAdvert`）；`false` = 未看完 / 失败（**不要发包**）。
 */
export async function playStoreAd(): Promise<boolean> {
    // Mock：没有 SDK，短暂模拟一次播放后按「看完」返回。
    await new Promise<void>((resolve) => {
        setTimeout(resolve, MOCK_AD_PLAY_MS);
    });
    return true;
}

/** 宝箱卡序号（1 = 低级 / 2 = 高级）→ 广告位（老端 `GetAdType` 的 `id == 2` 分支）。 */
export function storeAdTypeOfBox(boxId: unknown): number {
    return Number(boxId) === 2 ? STORE_AD_TYPE_SUPER_BOX : STORE_AD_TYPE_COMMON_BOX;
}

/**
 * `ad` 表里某 `type` 的**上限**（老端 `ModelRole.GetAdvertLimit(type)`）。
 *
 * 表缺失 / 没有这一行时退到 **1**（与老端同一兜底），而不是 0 —— 0 会让文案变成 `1/0`。
 *
 * ⚠️ 目前**只被 `StoreRepository.adRemaining()` 用**（前端在广告档点击时前置拦住
 *    「今日次数已用完」）；`btn_ad` 的显隐不归它管 —— 老端是用 FGUI 的「有无广告」
 *    控制器 + 红点做的，本端 prefab 里没有那个控制器，所以改成**点击时提示**。
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
