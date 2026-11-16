import { _decorator, Button, instantiate, Label, Layout, Node, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { UIResources } from '../../framework/ui/UIResources';
import { RewardItemView } from '../common/RewardItemView';
import { Toast } from '../common/Toast';
import { ItemInfoRow } from './ItemInfoRow';
import { ITEM_DETAIL_TEXTS, formatText } from './ItemDetailTexts';
import { itemDetailRepository } from './ItemDetailRepository';
import type { IItemDetailRepository, IItemDetailSnapshot } from './ItemDetailRepository';
import type { IItemAccessRef } from './ItemDetailTable';
import {
    ITEM_INFO_REWARD_ITEM_SIZE,
    ITEM_INFO_REWARD_SLOT_SIZE,
    itemTypeNameOf,
} from './ItemInfoTable';

const { ccclass, property } = _decorator;

/** `ItemInfoPage.open({ userData })` 的入参。 */
export interface IItemInfoOpenParams {
    /** 物品 `resId`（`item` 表主键）。 */
    readonly resId: number;
    /** 持有数量；不传按 `0`（`0` ⇒ 不显示数字）。 */
    readonly number?: number;
}

/**
 * 「道具信息」弹窗 —— 蓝湖「道具信息」稿（720×1610，面板 470×659）。
 *
 * 版面自上而下：蓝色标题区（物品名 / 物品格 / 类型 / 品质）、
 * 正文区（「道具说明」+ 说明文字、「获取途径」+ 途径行）。途径行是 prefab 预建 4 行，按条数收放。
 *
 * 与 `ItemDetailPage` 是两个不同设计稿的弹窗：那个是老端 FGUI「组件_角色_道具详情」
 * （品质缎带 / 数量行 / 内容格 / 合成·前往），本类是新版紧凑稿（无内容格、无按钮、固定高度）。
 * 数据端口共用 itemdetail 模块，物品格用公共 `RewardItemView`，这里只做「取数 → 铺界面」。
 *
 * 入口是 `CardUpgradePage` 的 `ExpIcon`（经验材料图标），`resId` 即图标当前显示的道具。
 * 途径行点击只提示「跳转未接入」——本工程还没有 `CtrlJumpView`，不假装跳成功。
 */
@ccclass('ItemInfoPage')
export class ItemInfoPage extends PopupBase {
    /** 弹窗预制体在 resources 下的路径（目录名大小写须与磁盘一致，真机才不炸）。 */
    static prefabPath = 'ui/ItemInfo/ItemInfo';

    @property({ group: '头部', type: Label, tooltip: 'NameLabel：物品名（蓝色标题区左上，白字描边）' })
    nameLabel: Label = null!;

    @property({ group: '头部', type: Node, tooltip: 'Goods：物品格**宿主**（100×100；运行时把公共 RewardItem 实例挂到它下面）' })
    goodsHost: Node = null!;

    @property({ group: '头部', type: Label, tooltip: 'TypeLabel：类型行（类型名查不到时整行留空）' })
    typeLabel: Label = null!;

    @property({ group: '头部', type: Label, tooltip: 'QualityLabel：品质行（品质名来自 gameConfig.qualityname）' })
    qualityLabel: Label = null!;

    @property({ group: '正文', type: Label, tooltip: 'DescLabel：道具说明正文（多行，超长自动撑高）' })
    descLabel: Label = null!;

    @property({ group: '获取途径', type: Node, tooltip: 'RowsPlate：途径底板（九宫，高度随行数收放）' })
    rowsPlate: Node = null!;

    @property({ group: '获取途径', type: Node, tooltip: 'RowsRoot：行容器（子节点为 prefab 预建的 ItemInfoRow，最多 4 行）' })
    rowsRoot: Node = null!;

    /** 数据端口；测试可替换。 */
    private repo: IItemDetailRepository = itemDetailRepository;

    private resId = 0;
    private ownedNumber = 0;
    /** 每次「取数 → 铺界面」递增，用来丢弃过期的异步结果。 */
    private revision = 0;
    /** 途径行数据（渲染与点击都按 index 现取）。 */
    private accessRefs: IItemAccessRef[] = [];
    /** 公共奖励格实例（`onInit` 建一次，之后只 `render`）。 */
    private rewardView: RewardItemView | null = null;
    /** 公共奖励格的加载任务（`onInit` 起，`presentGoods` 等它）。 */
    private rewardLoading: Promise<void> | null = null;

    /**
     * 公共奖励格的 resources 路径。
     *
     * 走运行时加载而不是 Inspector 绑 Prefab：本弹窗在 `main-pages` 包，奖励格在 `resources` 包，
     * 绑死就是跨包引用（构建期可能重复打包）。`UIResources.loadAsync` 内部会套缓存 / bundle 判定。
     */
    private static readonly REWARD_ITEM_PATH = 'ui/common/RewardItem';

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        // 行是 prefab 预建的固定节点（下标恒定），监听只绑一次，点击时按 index 现取数据。
        this.rows.forEach((row, index) => {
            row.node.on(Button.EventType.CLICK, () => this.onAccessClick(index), this);
        });
        this.createRewardView();
    }

    /**
     * 运行时加载公共奖励格并实例化到 `Goods` 宿主下。
     *
     * 尺寸走根 `scale`（96 → 100），别改根 `contentSize`：内部 Frame / Icon / Num 都按 96 烘死。
     * 实例自己的 Button 要关掉 —— `RewardItemView` 的点击会发「开老道具详情」的全局意图，
     * 而本弹窗的主物品格按老口径不可点。加载失败只打错误：其余文字 / 途径照常显示。
     */
    private createRewardView(): void {
        const host = this.goodsHost;
        if (!host) {
            console.error('[ItemInfo] 未绑 goodsHost，主物品格不显示');
            return;
        }
        this.rewardLoading = (async () => {
            const prefab = await UIResources.loadAsync(ItemInfoPage.REWARD_ITEM_PATH);
            // 加载期间弹窗可能已关闭 / 销毁。
            if (!prefab || !host.isValid || !this.node?.isValid) return;
            const node = instantiate(prefab);
            node.parent = host;
            const scale = ITEM_INFO_REWARD_SLOT_SIZE / ITEM_INFO_REWARD_ITEM_SIZE;
            node.setScale(scale, scale, 1);
            node.setPosition(ITEM_INFO_REWARD_SLOT_SIZE / 2, -ITEM_INFO_REWARD_SLOT_SIZE / 2, 0);
            const button = node.getComponent(Button);
            if (button) button.interactable = false;
            this.rewardView = node.getComponent(RewardItemView);
            if (!this.rewardView) console.error('[ItemInfo] 公共奖励格缺少 RewardItemView 组件');
        })();
    }

    protected async onOpen(userData?: IItemInfoOpenParams): Promise<void> {
        this.resId = Number.isFinite(userData?.resId) ? userData.resId : 0;
        this.ownedNumber = Number.isFinite(userData?.number) ? userData.number : 0;
        this.accessRefs = [];
        await this.reload();
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 让在途的 load / present 作废。
        this.revision += 1;
        this.accessRefs = [];
        for (const row of this.rows) row.hide();
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: IItemDetailRepository): void {
        this.repo = repository;
    }

    /** 弹窗还活着吗（异步回来时可能已被关掉）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid && this.isPopupOpen;
    }

    /** prefab 预建的途径行（按 `_children` 序，不按 active 过滤）。 */
    private get rows(): ItemInfoRow[] {
        const out: ItemInfoRow[] = [];
        for (const child of this.rowsRoot.children) {
            const row = child.getComponent(ItemInfoRow);
            if (row) out.push(row);
        }
        return out;
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

    private async reload(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repo.load(this.resId, this.ownedNumber);
        if (!this.alive || revision !== this.revision) return;
        this.present(snapshot);
    }

    private present(snapshot: IItemDetailSnapshot): void {
        this.presentTexts(snapshot);
        this.presentGoods(snapshot);
        this.presentAccess(snapshot);
    }

    private presentTexts(snapshot: IItemDetailSnapshot): void {
        const texts = ITEM_DETAIL_TEXTS;
        const row = snapshot.row;
        // 同一实例会被不同物品复用，全部无条件写。
        this.nameLabel.string = row && row.name ? row.name : texts.unknownName;
        const typeName = itemTypeNameOf(row?.type ?? 0);
        this.typeLabel.string = typeName ? formatText(texts.infoTypeLine, typeName) : '';
        this.qualityLabel.string = formatText(texts.infoQualityLine, snapshot.qualityName);
        this.descLabel.string = row && row.desc ? row.desc : texts.noDesc;
    }

    /**
     * 铺主物品格 —— 走公共奖励格 `RewardItemView`。
     *
     * 宿主只给「物品 id + 数量」，品质框档位、图标路径、加载与失败重试都在组件里，
     * 这边不再各写一遍品质框 / 图标的加载（那就是第二份真源）。
     * 格子是运行时加载的，先等 `rewardLoading`，首帧就绪后只是 await 一个已完成的 Promise。
     */
    private presentGoods(snapshot: IItemDetailSnapshot): void {
        const revision = this.revision;
        void (async () => {
            await (this.rewardLoading ?? Promise.resolve());
            if (!this.alive || revision !== this.revision) return;
            this.rewardView?.render({ resId: this.resId, amount: snapshot.number });
        })();
    }

    private presentAccess(snapshot: IItemDetailSnapshot): void {
        const texts = ITEM_DETAIL_TEXTS;
        const rows = this.rows;
        // 途径查不到时给一行占位（空列表看着像界面坏了），占位行不可点、不画箭头。
        const refs: IItemAccessRef[] = snapshot.accessRefs.length > 0
            ? snapshot.accessRefs.slice(0, rows.length)
            : [{ resId: 0, text: texts.noAccess }];
        if (snapshot.accessRefs.length > rows.length) {
            console.warn(`[ItemInfo] ${this.resId} 的获取途径 ${snapshot.accessRefs.length} 条，超过预建行数 ${rows.length}，多余的没显示`);
        }
        this.accessRefs = refs;

        for (let index = 0; index < rows.length; index += 1) {
            const ref = refs[index];
            if (!ref) {
                rows[index].hide();
                continue;
            }
            rows[index].node.active = true;
            rows[index].render(ref.text, ref.resId > 0);
        }
        this.applyRowsHeight();
    }

    /** 底板高度跟随 RowsRoot 的 Layout 容器高度（两者同一坐标系，锚点都在上沿）。 */
    private applyRowsHeight(): void {
        this.rowsRoot.getComponent(Layout).updateLayout();
        const rows = this.rowsRoot.getComponent(UITransform);
        const plate = this.rowsPlate.getComponent(UITransform);
        plate.setContentSize(plate.width, rows.height);
    }

    private onAccessClick(index: number): void {
        const ref = this.accessRefs[index];
        // 占位行的 resId 是 0，不跳（否则点了没反应还以为卡了）。
        if (!ref || ref.resId <= 0) return;
        console.log(`[ItemInfo] 跳转 ${ref.resId}：${ITEM_DETAIL_TEXTS.jumpNotWired}`);
        Toast.show(ITEM_DETAIL_TEXTS.jumpNotWired);
    }
}
