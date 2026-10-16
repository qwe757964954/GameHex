import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { CacheMgr } from '../net/CacheMgr';
import { countItem } from '../card/ItemBag';
import { StringUtil } from '../../framework/utils/StringUtil';
import { STORE_SECTIONS, type StoreSectionKey } from './StoreTable';
import {
    STORE_CHEST_ROWS,
    STORE_COIN_ICON,
    STORE_GIFT_ROW,
    STORE_GOLD_ROWS,
    STORE_GOODS_ROWS,
    STORE_SILVER_ROWS,
    storeQualityFrame,
    type IStoreChestRow,
    type IStoreGiftReward,
} from './StoreShopTable';
import { loadStoreIcon } from './StoreArt';
import { resolveDrawCost } from './StoreCostTable';
import { storeRepository } from './StoreRepository';
import { storeAction, type StoreActionKind } from './StoreActions';

const { ccclass, property } = _decorator;

/**
 * 「商城」**分段页**的根脚本 —— 5 个分段 prefab（`StoreGemBox` / `StoreLevelGift` /
 * `StoreGold` / `StoreSilver` / `StoreGoods`）**共用同一个类**。
 *
 * ## 它做三件事
 *
 * 1. **段标题**：以 {@link STORE_SECTIONS} 为准（prefab 里的文案是落盘快照，表是唯一真源）。
 * 2. **按节点名回填「图标 + 文案」**：5 段的节点名是一套**约定**（见下表），
 *    数据一律来自 `StoreShopTable.ts`。构建器 `tmp/_store2_build.mjs` 落盘时用的是
 *    **同一张表** ⇒ prefab 里的静态图与运行期回填**同源**，不会出现「构建填 A、运行刷成 B」。
 * 3. **接按钮**：所有可点节点 → {@link storeAction}（真实协议 / 真实支付 / 前置校验）。
 *
 * ## 节点名约定（构建器与运行期共用，改一边必须改另一边；`tests/store.test.ts` 守它）
 *
 * | 段 | 图标槽 | 按钮 |
 * |---|---|---|
 * | gem | `List/Card{i}/Buy1/Cost/Icon`、`Buy10/Cost/Icon`、`Own/Icon` | `Buy1`、`Buy10`、`AdBtn`、`Help` |
 * | gift | `List/Card/Reward/R{j}/Icon`、`Reward/R{j}/Frame`、`BuyBtn/Icon` | `BuyBtn`、`ChestBtn`、`ArrowLeft`、`ArrowRight` |
 * | gold | `List/Card{i}/Icon`、`Extra/Icon` | `List/Card{i}`、`List/Card{i}/Price` |
 * | silver | `List/Card{i}/Icon` | `List/Card{i}`、`List/Card{i}/Price` |
 * | goods | `List/Card{i}/ItemBox/Icon`、`ItemBox/Frame`、`Price/Icon` | `List/Card{i}`、`List/Card{i}/Price` |
 *
 * ⚠️ 后三段的卡节点**自己**也是一个按钮（`cc.Button` 落在卡上，不是落在价格按钮上）——
 * 老端 `initVirtualList(this, 渲染函数, 点击回调)` 的第三参就是「整卡点击」，
 * gem / gift 两段**没有**第三参 ⇒ 热区口径本来就不同。见 `tmp/_store2_build.mjs`
 * 的 `CARD_BUTTON_COMPS` 注释。
 *
 * ## 宝箱段的两条状态是**逐档、且随背包变**的（gem 独有）
 *
 * | 条 | 取哪一档的货币 | 老端 |
 * |---|---|---|
 * | 「拥有」（`Own`） | **固定** `gemBox.priceType` —— 1 档 `10991 银钥匙` / 2 档 `10992 金钥匙`；`ownNum > 0` 才显示整块 | `RenderBox` L668–690 |
 * | 「消耗」（`Buy1/Cost`、`Buy10/Cost`） | **动态**：钥匙够 ⇒ 本档钥匙；不够 ⇒ 退到备选货币（金币，`cost3` / `cost2`） | `updateConsumeItem(...)` |
 *
 * 两条刚好相反（一个看「有没有钥匙」、一个看「实际扣什么」），别弄混。
 * 数值由 {@link refreshBoxOwn} / {@link refreshBoxCost} 现算，并在 `CmdItem` / `CmdRole`
 * 缓存变化时重刷（= 老端 `VOBag.OnChanged` 里重跑 `RenderBox`）。
 *
 * ## 运行期回填是**幂等**的
 *
 * prefab 里已经写好了静态图/文案（构建期从同一张表读），`onLoad` 再刷一遍结果相同。
 * 留着这一遍是为了**真协议到位时不用改 prefab** —— 把 `StoreShopTable` 换成
 * 「`RefUtil` 读表 + `VOBag` 读状态」即可。
 *
 * ## 与外壳的关系
 *
 * 分段 prefab 是外壳 `Store.prefab` 里 `ScrollView/view/content` 的 5 个直接子节点
 * （`Sec0_StoreGemBox` … `Sec4_StoreGoods`），由外壳一次性实例化 ⇒ **分段自己不负责加载**。
 * 老端 `list.initVirtualList(...)` 是懒加载；本端 5 段总量可控（约 280 节点），不做虚拟化
 * —— 这是**有意降级**，不是漏了。
 */
@ccclass('StoreSectionPage')
export class StoreSectionPage extends Component {
    @property({ type: Label, tooltip: 'Title：段标题（`title_brown` 绶带上的描边文字）' })
    titleLabel: Label = null!;

    /**
     * 本段是 5 段里的哪一段。
     *
     * ⚠️ 用 `@property({ type: CCString })` 存**字符串键**而不是枚举：
     * 枚举要靠 `cc.Enum` 注册，prefab 里存的是数字，跨版本容易错位；
     * 字符串键与 {@link STORE_SECTIONS} 的 `key` 一位对一位，改不坏。
     */
    @property({ tooltip: '段键：gem / gift / gold / silver / goods（见 StoreTable.STORE_SECTIONS）' })
    sectionKey = '';

    /** 段配置（拿不到返回 `null`）。 */
    get section() {
        return STORE_SECTIONS.find((s) => s.key === (this.sectionKey as StoreSectionKey)) ?? null;
    }

    onLoad(): void {
        const section = this.section;
        if (!section) {
            // 段键漏写 ⇒ 只剩 prefab 里的落盘快照，图标/按钮都不会回填。这条警告是排查入口。
            console.warn(`[StoreSectionPage] 未知段键「${this.sectionKey}」，段标题与内容保持 prefab 现状`);
            return;
        }
        if (this.titleLabel) this.titleLabel.string = section.title;
        this.bindButtons(section.key);
        this.refresh();
        // 宝箱段的「拥有 / 消耗」两条依赖**背包与钱包**（钥匙在 `CmdItem`、金币在 `CmdRole`）。
        // 老端是 `VOBag.OnChanged` 里重跑 `RenderBox`；本端用 framework 的缓存事件，
        // 口径与 `StorePage` / `MainResBar` 一致（都是 `setEventUpdate`）。
        // ⚠️ 另外 4 段不订阅 —— 它们的内容来自静态表，与背包无关。
        if (section.key === 'gem') {
            const caller = this as unknown as destroyable;
            CacheMgr.instance.setEventUpdate('CmdItem', caller, this.onChestWalletChanged);
            CacheMgr.instance.setEventUpdate('CmdRole', caller, this.onChestWalletChanged);
        }
    }

    onDestroy(): void {
        // 对没订阅过的表 `removeEventCaller` 是 no-op（内部先 `peekCache`）⇒ 不必判断段键。
        const caller = this as unknown as destroyable;
        CacheMgr.instance.removeEventCaller('CmdItem', caller);
        CacheMgr.instance.removeEventCaller('CmdRole', caller);
    }

    /** 背包 / 钱包变化 ⇒ 重刷宝箱段（老端 `VOBag.OnChanged` → `RenderBox` 的对应物）。 */
    private readonly onChestWalletChanged = (): void => {
        if (!this.isValid || this.sectionKey !== 'gem') return;
        this.refreshGem();
    };

    // ============================================================
    // 一、按节点名回填图标 + 文案（数据全部来自 StoreShopTable）
    // ============================================================
    /** 把本段的图标 / 文案按表刷一遍（异步，图标逐张加载；失败只留白不抛）。 */
    refresh(): void {
        const key = this.sectionKey as StoreSectionKey;
        switch (key) {
            case 'gem': this.refreshGem(); break;
            case 'gift': this.refreshGift(); break;
            case 'gold': this.refreshGold(); break;
            case 'silver': this.refreshSilver(); break;
            case 'goods': this.refreshGoods(); break;
            default: break;
        }
    }

    private refreshGem(): void {
        STORE_CHEST_ROWS.forEach((row, i) => {
            const card = `List/Card${i}`;
            // 钥匙**逐档不同**（1 档银 / 2 档金）⇒ 三处图标一律取本档的 `keyIcon`。
            this.setIcon(`${card}/Buy1/Cost/Icon`, row.keyIcon);
            this.setIcon(`${card}/Buy10/Cost/Icon`, row.keyIcon);
            this.setIcon(`${card}/Own/Icon`, row.keyIcon);
            this.setText(`${card}/Title`, row.title);
            this.setText(`${card}/Buy1/Cost/Value`, row.cost1);
            this.setText(`${card}/Buy10/Cost/Value`, row.cost10);
            this.setText(`${card}/AdBtn/Label`, '免费');
            this.tint(`${card}/Buy1/Label`, row.buttonColor);
            this.tint(`${card}/Buy10/Label`, row.buttonColor);
            // 「拥有」条要读背包（同步），「消耗」条要读表（异步，且要算兜底价）⇒ 分开。
            this.refreshBoxOwn(card, row);
        });
        void this.refreshBoxCost();
    }

    /**
     * 「拥有」条：**背包里有几把本档的钥匙**（老端 `RenderBox` 的 `ownItem`）。
     *
     * 老端口径（`TabStoreMain` L668–690）：
     * - `keyType = refGemBox.priceType` —— **固定用配置表的钥匙类型**，
     *   ⚠️ **不能**用兜底切换后的价格类型：钥匙不足时它已被换成金币，判断不出有没有钥匙；
     * - `ownNum > 0` 才显示**整块**「拥有」，否则 `ownItem.visible = false`；
     * - 数量走 `StringUtil.formatNumberToKMBT`（本端同名函数已存在）。
     */
    private refreshBoxOwn(card: string, row: IStoreChestRow): void {
        const count = countItem(row.keyResId);
        const ownNode = this.find(`${card}/Own`);
        if (ownNode) ownNode.active = count > 0;
        if (count > 0) this.setText(`${card}/Own/Value`, StringUtil.formatNumberToKMBT(count));
    }

    /**
     * 消耗条：按 {@link resolveDrawCost} 算**当前实际会扣的**货币与数量并覆盖上去。
     *
     * 钥匙够 ⇒ 本档钥匙 + `cost1`/`cost10`；钥匙不够 ⇒ 退到备选货币（金币）+ `cost3`/`cost2`。
     *
     * ⚠️ 老端 `updateConsumeItem(getBtnInnerChild(box, "按钮_1次", "消耗1次"), priceType, cost)`
     *    用的是**兜底切换后**的 `priceType` / `cost` —— 与「拥有」条刚好相反，别弄混：
     *    消耗显示「实际要扣什么」，拥有显示「有没有钥匙」。
     */
    private async refreshBoxCost(): Promise<void> {
        for (let i = 0; i < STORE_CHEST_ROWS.length; i += 1) {
            const row = STORE_CHEST_ROWS[i];
            // `STORE_CHEST_ROWS[i]` ↔ `gemBox.id = i + 1`（与 `bindButtons` 的 `rowId = i + 1` 同口径）。
            const box = await storeRepository.readGemBox(i + 1);
            if (!box || !this.isValid) return;

            const held = new Map<number, number>();
            for (const resId of [box.priceType, box.priceType3]) {
                if (resId <= 0 || held.has(resId)) continue;
                held.set(resId, await storeRepository.held(resId));
            }
            const heldOf = (resId: number): number => held.get(resId) ?? 0;
            const card = `List/Card${i}`;

            for (const [suffix, ten] of [['Buy1', false], ['Buy10', true]] as const) {
                if (!this.isValid) return;
                const cost = resolveDrawCost(box, heldOf, ten);
                // 扣的是本档钥匙就用钥匙图，退到备选货币就用金币图。
                const icon = cost.resId === row.keyResId ? row.keyIcon : STORE_COIN_ICON;
                this.setIcon(`${card}/${suffix}/Cost/Icon`, icon);
                this.setText(`${card}/${suffix}/Cost/Value`, String(cost.number));
            }
        }
    }

    private refreshGift(): void {
        const row = STORE_GIFT_ROW;
        const card = 'List/Card';
        row.rewards.forEach((reward: IStoreGiftReward, j) => {
            this.setIcon(`${card}/Reward/R${j}/Icon`, reward.iconPath);
            this.setIcon(`${card}/Reward/R${j}/Frame`, storeQualityFrame(reward.quality));
        });
        this.setIcon(`${card}/BuyBtn/Icon`, row.priceIcon);
        this.setText(`${card}/RebateText`, row.rebate);
        this.setText(`${card}/BuyCount`, row.buyCount);
        this.setText(`${card}/BuyBtn/Label`, row.price);
    }

    private refreshGold(): void {
        STORE_GOLD_ROWS.forEach((row, i) => {
            const card = `List/Card${i}`;
            this.setIcon(`${card}/Icon`, row.iconPath);
            this.setIcon(`${card}/Extra/Icon`, row.extraIcon);
            this.setText(`${card}/Name`, row.name);
            this.setText(`${card}/Extra/Count`, `x${row.coin}`);
            this.setText(`${card}/Price/Label`, `${row.rmb}元`);
        });
    }

    private refreshSilver(): void {
        STORE_SILVER_ROWS.forEach((row, i) => {
            const card = `List/Card${i}`;
            this.setIcon(`${card}/Icon`, row.iconPath);
            this.setText(`${card}/Name`, row.name);
            this.setText(`${card}/Price/Label`, row.price);
            if (row.sale) this.setText(`${card}/SaleText`, row.sale);
        });
    }

    private refreshGoods(): void {
        STORE_GOODS_ROWS.forEach((row, i) => {
            const card = `List/Card${i}`;
            this.setIcon(`${card}/ItemBox/Icon`, row.iconPath);
            this.setIcon(`${card}/ItemBox/Frame`, storeQualityFrame(row.quality));
            this.setIcon(`${card}/Price/Icon`, STORE_GIFT_ROW.priceIcon);
            this.setText(`${card}/ItemBox/Count`, `${row.number}`);
            this.setText(`${card}/Name`, row.name);
            // 老端 `text_remainTime` 的变量是 `限购{剩余}/{上限}次`；静态视图按「未买过」= 满额。
            this.setText(`${card}/Remain`, `限购${row.limit - row.bought}/${row.limit}次`);
            this.setText(`${card}/Price/Value`, row.price);
        });
    }

    // ============================================================
    // 二、接按钮 → StoreActions（真实链路）
    // ============================================================
    private bindButtons(key: StoreSectionKey): void {
        switch (key) {
            case 'gem': {
                STORE_CHEST_ROWS.forEach((row, i) => {
                    const card = `List/Card${i}`;
                    const rowId = i + 1;
                    this.onClick(`${card}/Buy1`, 'draw', { section: 'gem', index: i, rowId, amount: 1, label: row.title });
                    this.onClick(`${card}/Buy10`, 'draw', { section: 'gem', index: i, rowId, amount: 10, label: row.title });
                    this.onClick(`${card}/AdBtn`, 'ad', { section: 'gem', index: i, rowId, label: row.title });
                    this.onClick(`${card}/Help`, 'help', { section: 'gem', index: i, rowId, label: row.title });
                });
                break;
            }
            case 'gift': {
                const row = STORE_GIFT_ROW;
                // ⚠️ `rowId` 一律传 **`guankaGift.id`**（= 18），不是 `level`（= 50）——
                //    老端 `ModelStore.requestBuyGuanKaGift(ref.id)` 发的是 id。
                this.onClick('List/Card/BuyBtn', 'buyGift', { section: 'gift', rowId: row.id, label: row.title });
                this.onClick('List/Card/ChestBtn', 'claimGift', { section: 'gift', rowId: row.id, label: row.title });
                this.onClick('ArrowLeft', 'page', { section: 'gift', rowId: row.id, amount: -1, label: row.title });
                this.onClick('ArrowRight', 'page', { section: 'gift', rowId: row.id, amount: 1, label: row.title });
                break;
            }
            case 'gold': {
                STORE_GOLD_ROWS.forEach((row, i) => {
                    const ctx = { section: 'gold', index: i, rowId: row.id, label: row.name } as const;
                    // 老端 `initVirtualList(this, this.RenderCharge, this.onClickCharge)` ⇒ **整卡**可点。
                    // 卡与价格按钮各挂一个 `click`：触摸落到价格按钮上时由**它**派发（卡上的那份不会重复触发，
                    // `cc.Button` 发的是 `node.emit('click')` 不是冒泡事件）。
                    this.onClick(`List/Card${i}`, 'pay', ctx);
                    this.onClick(`List/Card${i}/Price`, 'pay', ctx);
                });
                break;
            }
            case 'silver': {
                STORE_SILVER_ROWS.forEach((row, i) => {
                    const ctx = { section: 'silver', index: i, rowId: row.id, label: row.name } as const;
                    // 老端 `initVirtualList(this, this.RendCoinItem, this.onClickCoin)` ⇒ 整卡可点。
                    this.onClick(`List/Card${i}`, 'buyCoin', ctx);
                    this.onClick(`List/Card${i}/Price`, 'buyCoin', ctx);
                });
                break;
            }
            case 'goods': {
                STORE_GOODS_ROWS.forEach((row, i) => {
                    const ctx = { section: 'goods', index: i, rowId: row.id, label: row.name } as const;
                    // 老端 `initVirtualList(this, this.RenderGoods, this.onClickCoin)` ⇒ 整卡可点。
                    this.onClick(`List/Card${i}`, 'buyGoods', ctx);
                    this.onClick(`List/Card${i}/Price`, 'buyGoods', ctx);
                });
                break;
            }
            default: break;
        }
    }

    /** 给一个节点挂 `click`（节点缺失 / 没挂 `cc.Button` 时只打一条 warn，不抛）。 */
    private onClick(path: string, kind: StoreActionKind, ctx: Parameters<typeof storeAction>[1]): void {
        const node = this.find(path);
        if (!node) {
            console.warn(`[StoreSectionPage] ${this.sectionKey} 段找不到按钮节点 ${path}（节点名约定变了？）`);
            return;
        }
        const button = node.getComponent(Button);
        if (!button) {
            console.warn(`[StoreSectionPage] ${this.sectionKey} 段 ${path} 上没有 cc.Button，点击不会触发`);
            return;
        }
        // ⚠️ MCP 建出来的 `cc.Button` 的 `_target` 是 `null`（规格里没这一步）。
        //    按下态（`transition = SCALE` / `zoomScale = 0.9`）要对 `target` 做缩放，
        //    显式补上自己是最省事的兜底（缺 target 时部分引擎版本会直接抛）。
        if (!button.target) button.target = node;
        // `storeAction` 是 async（要读表 / 等广告 / 发包）⇒ 显式 `void`，不把 Promise 交给事件系统。
        node.on(Button.EventType.CLICK, () => { void storeAction(kind, ctx); }, this);
    }

    // ============================================================
    // 三、小工具
    // ============================================================
    /** 按「从段根算起」的斜杠路径找子节点。 */
    private find(path: string): Node | null {
        let cur: Node | null = this.node;
        for (const seg of path.split('/')) {
            if (!cur) return null;
            cur = cur.getChildByName(seg);
        }
        return cur;
    }

    /** 写一个 Label 的文案（节点不存在 / 没 Label 时静默跳过）。 */
    private setText(path: string, text: string): void {
        const label = this.find(path)?.getComponent(Label);
        if (label) label.string = text;
    }

    /** 给一个 `cc.Sprite` 槽位异步刷图标（**失败保留现有图**，见 `StoreArt` 的注释）。 */
    private setIcon(path: string, artPath: string): void {
        const sprite = this.find(path)?.getComponent(Sprite);
        if (!sprite || !artPath) return;
        void loadStoreIcon(artPath).then((frame) => {
            if (!frame) return;
            if (!this.isValid || !sprite.isValid) return;
            sprite.spriteFrame = frame;
        });
    }

    /** 给一个 Label 上色（宝箱卡的低级/高级按钮字色）。 */
    private tint(path: string, rgb: readonly [number, number, number]): void {
        const label = this.find(path)?.getComponent(Label);
        if (label) label.color.set(rgb[0], rgb[1], rgb[2], 255);
    }
}
