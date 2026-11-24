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
import type { IStoreActionContext, StoreActionKind } from './StoreActions';
import { StoreEvent } from './StoreEvents';
import { StorePage } from './StorePage';
import { EventMgr } from '../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/**
 * 商城分段页根脚本，5 个分段 prefab（StoreGemBox / StoreLevelGift / StoreGold /
 * StoreSilver / StoreGoods）共用。
 *
 * 职责有三块：按 STORE_SECTIONS 写段标题；按固定节点名从 StoreShopTable 回填图标和文案；
 * 给可点节点挂 StoreActions 意图。
 *
 * 节点名是构建器和运行期的共用契约，改动要同步 tmp/_store2_build.mjs 和 tests/store.test.ts。
 * 后三段的整卡本身是按钮，gem/gift 只有局部按钮，热区口径不同。
 *
 * gem 段的「拥有」按固定钥匙类型判断，「消耗」按实际扣费显示；两者都随背包和钱包刷新。
 * 5 个分段由外壳一次性实例化，不做虚拟化。
 */
@ccclass('StoreSectionPage')
export class StoreSectionPage extends Component {
    @property({ type: Label, tooltip: 'Title：段标题' })
    titleLabel: Label = null!;

    /** 字符串键与 STORE_SECTIONS 的 key 一一对应；prefab 里存数字枚举容易跨版本错位。 */
    @property({ tooltip: '段键：gem / gift / gold / silver / goods' })
    sectionKey = '';

    /** 当前段配置；段键无效时为 null。 */
    get section() {
        return STORE_SECTIONS.find((s) => s.key === (this.sectionKey as StoreSectionKey)) ?? null;
    }

    onLoad(): void {
        const section = this.section;
        if (!section) {
            console.warn(`[StoreSectionPage] 未知段键「${this.sectionKey}」，段标题与内容保持 prefab 现状`);
            return;
        }
        this.titleLabel.string = section.title;
        this.bindButtons(section.key);
        this.refresh();
        // 宝箱段的拥有数量和消耗货币都依赖背包与钱包缓存；其余段来自静态表，不需要订阅。
        if (section.key === 'gem') {
            CacheMgr.instance.setEventUpdate('CmdItem', this, this.onChestWalletChanged);
            CacheMgr.instance.setEventUpdate('CmdRole', this, this.onChestWalletChanged);
        }
    }

    onDestroy(): void {
        CacheMgr.instance.removeEventCaller('CmdItem', this);
        CacheMgr.instance.removeEventCaller('CmdRole', this);
    }

    /** 背包或钱包变化后重刷宝箱段。 */
    private readonly onChestWalletChanged = (): void => {
        if (this.sectionKey !== 'gem') return;
        this.refreshGem();
    };

    /** 按段键回填图标和文案。 */
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
            this.setIcon(`${card}/Buy1/Cost/Icon`, row.keyIcon);
            this.setIcon(`${card}/Buy10/Cost/Icon`, row.keyIcon);
            this.setIcon(`${card}/Own/Icon`, row.keyIcon);
            this.setText(`${card}/Title`, row.title);
            this.setText(`${card}/Buy1/Cost/Value`, row.cost1);
            this.setText(`${card}/Buy10/Cost/Value`, row.cost10);
            this.setText(`${card}/AdBtn/Label`, '免费');
            this.tint(`${card}/Buy1/Label`, row.buttonColor);
            this.tint(`${card}/Buy10/Label`, row.buttonColor);
            this.refreshBoxOwn(card, row);
        });
        void this.refreshBoxCost();
    }

    /** 拥有条按配置里的固定钥匙类型判断，不能用兜底后的价格类型，否则钥匙不足时判断不出持有量。 */
    private refreshBoxOwn(card: string, row: IStoreChestRow): void {
        const count = countItem(row.keyResId);
        const ownNode = this.find(`${card}/Own`);
        if (ownNode) ownNode.active = count > 0;
        if (count > 0) this.setText(`${card}/Own/Value`, StringUtil.formatNumberToKMBT(count));
    }

    /**
     * 消耗条按实际扣费显示：钥匙够就用本档钥匙，不够就退到备选货币。
     * 与拥有条相反，这里必须用兜底后的价格类型。
     */
    private async refreshBoxCost(): Promise<void> {
        for (let i = 0; i < STORE_CHEST_ROWS.length; i += 1) {
            const row = STORE_CHEST_ROWS[i];
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
                // 请求参数用礼包 id（18），不是关卡号（50）。
                this.onClick('List/Card/BuyBtn', 'buyGift', { section: 'gift', rowId: row.id, label: row.title });
                this.onClick('List/Card/ChestBtn', 'claimGift', { section: 'gift', rowId: row.id, label: row.title });
                this.onClick('ArrowLeft', 'page', { section: 'gift', rowId: row.id, amount: -1, label: row.title });
                this.onClick('ArrowRight', 'page', { section: 'gift', rowId: row.id, amount: 1, label: row.title });
                break;
            }
            case 'gold': {
                STORE_GOLD_ROWS.forEach((row, i) => {
                    const ctx = { section: 'gold', index: i, rowId: row.id, label: row.name } as const;
                    this.onClick(`List/Card${i}`, 'pay', ctx);
                    this.onClick(`List/Card${i}/Price`, 'pay', ctx);
                });
                break;
            }
            case 'silver': {
                STORE_SILVER_ROWS.forEach((row, i) => {
                    const ctx = { section: 'silver', index: i, rowId: row.id, label: row.name } as const;
                    this.onClick(`List/Card${i}`, 'buyCoin', ctx);
                    this.onClick(`List/Card${i}/Price`, 'buyCoin', ctx);
                });
                break;
            }
            case 'goods': {
                STORE_GOODS_ROWS.forEach((row, i) => {
                    const ctx = { section: 'goods', index: i, rowId: row.id, label: row.name } as const;
                    this.onClick(`List/Card${i}`, 'buyGoods', ctx);
                    this.onClick(`List/Card${i}/Price`, 'buyGoods', ctx);
                });
                break;
            }
            default: break;
        }
    }

    /** 给节点挂 CLICK。节点名对不上时只告警，避免整个分段打不开。 */
    private onClick(path: string, kind: StoreActionKind, ctx: IStoreActionContext): void {
        const node = this.find(path);
        if (!node) {
            console.warn(`[StoreSectionPage] ${this.sectionKey} 段找不到按钮节点 ${path}`);
            return;
        }
        const button = node.getComponent(Button);
        if (!button) {
            console.warn(`[StoreSectionPage] ${this.sectionKey} 段 ${path} 上没有 cc.Button`);
            return;
        }
        // 构建器生成的 Button 可能没有 target；按下态缩放需要它，缺省会报错。
        if (!button.target) button.target = node;
        node.on(Button.EventType.CLICK, () => {
            let root: Node | null = this.node;
            while (root && !root.getComponent(StorePage)) root = root.parent;
            if (!root) throw new Error('StoreSectionPage requires StorePage');
            EventMgr.instance.emit(StoreEvent.Action, { kind, context: ctx }, root.getComponent(StorePage));
        }, this);
    }

    /** 按相对段根的斜杠路径查子节点。 */
    private find(path: string): Node | null {
        let cur: Node | null = this.node;
        for (const seg of path.split('/')) {
            if (!cur) return null;
            cur = cur.getChildByName(seg);
        }
        return cur;
    }

    /** 写 Label 文案；节点或 Label 不存在时跳过。 */
    private setText(path: string, text: string): void {
        const label = this.find(path)?.getComponent(Label);
        if (label) label.string = text;
    }

    /** 异步刷图标，失败时保留 prefab 里的现有图。 */
    private setIcon(path: string, artPath: string): void {
        const sprite = this.find(path)?.getComponent(Sprite);
        if (!sprite || !artPath) return;
        void loadStoreIcon(artPath).then((frame) => {
            if (!frame) return;
            if (!this.isValid || !sprite.isValid) return;
            sprite.spriteFrame = frame;
        });
    }

    /** 给 Label 上色。 */
    private tint(path: string, rgb: readonly [number, number, number]): void {
        const label = this.find(path)?.getComponent(Label);
        if (label) label.color.set(rgb[0], rgb[1], rgb[2], 255);
    }
}
