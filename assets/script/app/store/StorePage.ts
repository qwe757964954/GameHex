import { _decorator, Component } from 'cc';

const { ccclass } = _decorator;

/**
 * 「商城」页主控（`assets/resources/ui/Store/Store.prefab`）。
 *
 * ## 它在主界面里的位置
 *
 * 商城是**主界面底部六格的第 0 格**（`MainTabHost.MainTab.Shop`），与 `CardLineup`（角色）、
 * `ArenaRoot`（竞技）同构：**整页实例化 / 切走即销毁**，不是弹窗
 * （老端 `open.json` 里 refId 1 是 `type = 1`「主界面 tab」，`TabStoreMain extends GameTabProxy`）
 * ⇒ 本类 `extends Component`，**不是** `PopupBase`：商城没有「点空白关闭」「关闭按钮」这些弹窗语义。
 *
 * ## 版面（真源 `组件/组件_商店_界面.xml`）
 *
 * ```
 * Store              720×1280  ← 本脚本（主脚本挂根节点）
 * ├─ Bg              720×1280  sd_fg_01_3gong（地牢货架整屏）
 * ├─ ShopPanel       720×926   sd_bg_01（木框面板，FGUI @(0,384)）
 * ├─ Npc             720×330   shoping_bg04（哥布林商人，FGUI @(1,61)）
 * ├─ ResBar          720×40    资源条
 * │    ├─ Res0       132×40    ← 挂 `MainResBarSlot`（图标 + 数值）
 * │    └─ Res1       132×40    ← 同上
 * └─ ScrollView      666×738   纵向滚动（FGUI `n61` list，@(361,385) 顶边中点）
 *      └─ view（Mask）
 *           └─ content      666×3486
 *                └─ Sec0..4  5 个分段 prefab（StoreGemBox / StoreLevelGift / StoreGold / StoreSilver / StoreGoods）
 * ```
 *
 * ⚠️ **`组件_商店_界面` 里没有页签、没有分页** —— 用户拿真机截图纠正过一次。
 *    之前那套「4 个页签 + 4 个独立子页」是照 `组件_商店_主界面` + `组件_商店_菜单栏` 做的，
 *    已被整体回退（备份在 `tmp/backup_store_p3/`）。
 *
 * ## 顶部资源条为什么单独做一条
 *
 * FGUI `组件_商店_界面` 的 `displayList` 只有 6 项，**不含资源栏** —— 截图顶部那两枚
 * 「28.1K / 67.4K」药丸来自主界面 HUD。本工程 HUD 已搬到竞技页
 * （`MainResBar` 挂在 `ui/main/ArenaRoot` 上，切走即销毁）⇒ 商城页自己补一条。
 *
 * **实现 = 公共货币件 `app/common/ResBar`**（2026-09-29 换的，原先本类自己拿
 * `buildResBarView` + `loadResBarSprite` 手写渲染）。现在：
 *
 * | 项 | 在哪 |
 * |---|---|
 * | 显示哪两格 | `Store.prefab` 的 `ResBar.resKeys = 'gold,gem'`（**配置落 prefab**，代码不参与） |
 * | 数值 / 图标 / `CmdRole` 订阅 | `ResBar` 组件内部自驱动，宿主不需要持有引用 |
 *
 * ⇒ 本类不再有货币相关的 `@property`，也不再订阅缓存；以前的 `resIcon0/resIcon1/resValue0/resValue1`
 * 与 `reload()` / `readLevelRows()` / `readRoleRow()` 已随公共件一起删掉。
 *
 * ⚠️ **待确认的真源分歧**：`open.json` 里商城是 `refId = 1`（`url: "TabStore"`），
 *    但那行 `resShowType = [10, 7]`（幻灵玉 + 铜币）与界面上的「铜币 + 灵石」**对不上**
 *    （顺序与内容都不同）。目前沿用界面现状（`resKeys`）；策划确认后再改成 `openRefId = 1`。
 *
 * ## 分期边界
 *
 * - **数据 / 协议**（`VOShop` / `RequestShop*`）：本类不碰网络，5 段内容由
 *   `StoreShopTable` 的静态表驱动（见 `StoreSectionPage`）。
 * - **红点**（`RDGemStore` / `RDCoinStore`）：prefab 里已有红点槽位（`ui/common/RedDot`
 *   实例），表达式求值属后续分期。
 */
@ccclass('StorePage')
export class StorePage extends Component {
    /**
     * 页面 prefab 在 resources 下的路径。
     *
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/Store/`，S 大写）：
     * Android / iOS 的热更新 zip 内路径**大小写敏感**，写成 `ui/store/...`
     * 在编辑器里照样能跑（Windows 不敏感），真机上才会 `resources.load` 失败变空白页。
     */
    static prefabPath = 'ui/Store/Store';
}
