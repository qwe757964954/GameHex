import { _decorator, Button, Color, Component, Label, Node, RichText, Sprite, SpriteFrame, sp } from 'cc';
import { backgroundArtForType, MONTHCARD_ART } from './MonthCardGiftArt';
import {
    MONTHCARD_BOUGHT_TAG_POS,
    MONTHCARD_BUY_POS,
    MONTHCARD_DESC_POS,
    MONTHCARD_RENEW_POS,
    MONTHCARD_TIME_POS,
    MONTHCARD_TITLE_POS,
} from './MonthCardGiftLayout';
import { MonthCardGiftPrivilegeRow } from './MonthCardGiftPrivilegeRow';
import { MonthCardGiftSlot } from './MonthCardGiftSlot';
import {
    MONTH_CARD_TYPE_PREMIUM,
    MONTH_CARD_TYPE_WELFARE,
    formatRemain,
} from './MonthCardGiftTable';
import type { IMonthCardGiftView } from './MonthCardGiftTable';
import { MONTHCARD_TEXTS } from './MonthCardGiftTexts';

const { ccclass, property } = _decorator;

/** 一次刷新要用的全部美术（由页面预加载）。 */
export interface IMonthCardGiftEntryArt {
    readonly frames: ReadonlyMap<string, SpriteFrame>;
    readonly rewardIcons: ReadonlyMap<number, SpriteFrame>;
}

/** 标题/描述文字颜色（随卡类型切换）。 */
const MONTHCARD_TEXT_COLORS: Readonly<Record<number, {
    readonly titleFill: string;
    readonly titleOutline: string;
    readonly descFill: string;
    readonly descOutline: string;
}>> = {
    [MONTH_CARD_TYPE_WELFARE]: {
        titleFill: '#f6e078', titleOutline: '#170d1a',
        descFill: '#e5ebfe', descOutline: '#160e08',
    },
    [MONTH_CARD_TYPE_PREMIUM]: {
        titleFill: '#ffee72', titleOutline: '#000000',
        descFill: '#e3dae6', descOutline: '#000000',
    },
};

const MONTHCARD_DESC_HIGHLIGHT = '#FF9900';
const MONTHCARD_DESC_OUTLINE_WIDTH = 2;
const MONTHCARD_BUBBLE_SPIN_SECONDS = 48;

const _colorCache = new Map<string, Color>();
function hexColor(hex: string): Color {
    let color = _colorCache.get(hex);
    if (!color) {
        color = new Color();
        Color.fromHEX(color, hex);
        _colorCache.set(hex, color);
    }
    return color;
}

function descSegment(text: string, fill: string, outline: string): string {
    return `<outline color=${outline} width=${MONTHCARD_DESC_OUTLINE_WIDTH}><color=${fill}>${text}</color></outline>`;
}

/**
 * 月卡礼包的一个条目（633×380）。
 */
@ccclass('MonthCardGiftEntry')
export class MonthCardGiftEntry extends Component {
    @property({ type: Sprite, tooltip: 'Bg：卡面' })
    bg: Sprite = null;

    @property({ type: Node, tooltip: 'SpNode：yueka spine 容器' })
    spNode: Node = null;

    @property({ type: Node, tooltip: 'BtnBuy：主按钮' })
    btnBuy: Node = null;

    @property({ type: Label, tooltip: 'BtnBuy/Label：按钮文案' })
    btnBuyLabel: Label = null;

    @property({ type: Node, tooltip: 'BoughtTag：已购买角标' })
    boughtTag: Node = null;

    @property({ type: Label, tooltip: 'LbTime：剩余时间' })
    lbTime: Label = null;

    @property({ type: RichText, tooltip: 'DescTitle：有效期说明' })
    descTitle: RichText = null;

    @property({ type: Node, tooltip: 'BtnTaken：已领取按钮（恒隐藏）' })
    btnTaken: Node = null;

    @property({ type: Node, tooltip: 'BtnReward：领取按钮' })
    btnReward: Node = null;

    @property({ type: Node, tooltip: 'BtnReward/RedDot：领取红点' })
    redDot: Node = null;

    @property({ type: Node, tooltip: 'GainBubble：立即获得气泡' })
    gainBubble: Node = null;

    @property({ type: Node, tooltip: 'GainLabel：立即获得文案' })
    gainLabel: Node = null;

    @property({ type: MonthCardGiftSlot, tooltip: 'GainGoods：购买即时奖励' })
    gainGoods: MonthCardGiftSlot = null;

    @property({ type: Node, tooltip: 'DayBg：每日奖励区底' })
    dayBg: Node = null;

    @property({ type: Node, tooltip: 'DayDot：每日领取前的点' })
    dayDot: Node = null;

    @property({ type: Node, tooltip: 'DayLabel：每日领取文案' })
    dayLabel: Node = null;

    @property({ type: Node, tooltip: 'DayRewardList：每日奖励格容器' })
    dayList: Node = null;

    @property({ type: Node, tooltip: 'PrivilegeList：特权行容器' })
    privilegeList: Node = null;

    @property({ type: Label, tooltip: 'Title：卡名' })
    titleLabel: Label = null;

    private view: IMonthCardGiftView | null = null;
    private privilegeRows: MonthCardGiftPrivilegeRow[] = [];
    private daySlots: MonthCardGiftSlot[] = [];
    private skeleton: sp.Skeleton | null = null;
    private bubbleAngle = 0;

    onBuy: ((view: IMonthCardGiftView) => void) | null = null;
    onClaim: ((view: IMonthCardGiftView) => void) | null = null;

    protected onLoad(): void {
        this.privilegeRows = this.privilegeList.getComponentsInChildren(MonthCardGiftPrivilegeRow);
        this.daySlots = this.dayList.getComponentsInChildren(MonthCardGiftSlot);
        this.skeleton = this.spNode.getComponentInChildren(sp.Skeleton);

        const buyButton = this.btnBuy.getComponent(Button);
        if (buyButton) buyButton.node.on(Button.EventType.CLICK, this.handleBuyClick, this);
        const rewardButton = this.btnReward.getComponent(Button);
        if (rewardButton) rewardButton.node.on(Button.EventType.CLICK, this.handleClaimClick, this);
    }

    /** 把一张卡的视图铺到界面上。 */
    applyView(view: IMonthCardGiftView, art: IMonthCardGiftEntryArt): void {
        this.view = view;
        const gift = view.gift;
        const dy = view.layoutDy;
        const colors = MONTHCARD_TEXT_COLORS[gift.type] ?? MONTHCARD_TEXT_COLORS[MONTH_CARD_TYPE_WELFARE];

        // 卡面
        const bgFrame = art.frames.get(backgroundArtForType(gift.type));
        if (bgFrame) this.bg.spriteFrame = bgFrame;

        // 卡名
        this.titleLabel.string = gift.title;
        const titlePos = MONTHCARD_TITLE_POS[gift.type] ?? MONTHCARD_TITLE_POS[MONTH_CARD_TYPE_WELFARE];
        this.titleLabel.node.setPosition(titlePos.x, titlePos.y, 0);
        this.titleLabel.color = hexColor(colors.titleFill);

        // 有效期说明
        this.descTitle.string = [
            descSegment(MONTHCARD_TEXTS.descPrefix, colors.descFill, colors.descOutline),
            descSegment(String(gift.continueDays), MONTHCARD_DESC_HIGHLIGHT, colors.descOutline),
            descSegment(MONTHCARD_TEXTS.descSuffix, colors.descFill, colors.descOutline),
        ].join('');
        this.descTitle.node.setPosition(MONTHCARD_DESC_POS.x, MONTHCARD_DESC_POS.y - dy, 0);

        // 已购买区
        const bought = view.bought;
        this.boughtTag.active = bought;
        this.boughtTag.setPosition(
            MONTHCARD_BOUGHT_TAG_POS.x,
            MONTHCARD_BOUGHT_TAG_POS.y - view.boughtTagDy,
            0,
        );
        this.lbTime.node.active = bought;
        this.lbTime.node.setPosition(MONTHCARD_TIME_POS.x, MONTHCARD_TIME_POS.y - dy, 0);
        this.presentRemain(view.remainMs);

        // spine：已购买 + 至尊月卡 + 今日未领
        const spin = bought && gift.type === MONTH_CARD_TYPE_PREMIUM && !view.claimedToday;
        this.spNode.active = spin;
        if (spin && this.skeleton) {
            // ⚠️ 别拿 `'animation'` 当兜底名：`skel/yueka/yueka.skel` 里**没有**这个动画
            // ⇒ 每调一次 `applyView` 就打一条「Spine: Animation not found: animation」
            // （2026-10-14 战斗结束回主界面时被成片刷出来）。
            // 动画名口径与 `ZCHexView.readIdleClip` / `ZCUnitView` 一致：**只能走 `getRuntimeData()`**
            // （`sp.Skeleton.findAnimation()` 依赖 `onLoad` 之后的 `_skeleton`，绑定时取不到）。
            const current = this.skeleton.animation
                || this.skeleton.skeletonData?.getRuntimeData(true)?.animations[0]?.name;
            if (current) this.skeleton.setAnimation(0, current, true);
        }

        // 操作槽位
        this.presentSlot(view, dy);

        // 每日奖励
        const hasDayReward = gift.dayRewards.length > 0;
        this.dayBg.active = hasDayReward;
        this.dayDot.active = hasDayReward;
        this.dayLabel.active = hasDayReward;
        this.dayList.active = hasDayReward;
        if (hasDayReward) {
            const dotFrame = art.frames.get(MONTHCARD_ART.dotRich);
            const dotSprite = this.dayDot.getComponent(Sprite);
            if (dotFrame && dotSprite) dotSprite.spriteFrame = dotFrame;
            this.presentDayRewards(view, art);
        } else {
            for (const slot of this.daySlots) slot.hide();
        }

        // 购买即时奖励
        const buyReward = gift.buyReward;
        const hasBuyReward = buyReward !== null;
        this.gainBubble.active = hasBuyReward;
        this.gainLabel.active = hasBuyReward;
        this.gainGoods.node.active = hasBuyReward;
        if (buyReward) {
            this.gainGoods.render(art.rewardIcons.get(buyReward.resId) ?? null, null, String(buyReward.number));
        }

        // 特权列表
        this.presentPrivileges(view, art);
    }

    /** 操作槽位三态。 */
    private presentSlot(view: IMonthCardGiftView, dy: number): void {
        this.btnTaken.active = false;

        const claimable = view.phase === 'claimable';
        this.btnReward.active = claimable;
        this.redDot.active = claimable;

        if (claimable) {
            this.btnBuy.active = false;
            return;
        }

        this.btnBuy.active = true;
        const price = view.gift.price;
        if (view.bought) {
            this.btnBuy.setPosition(MONTHCARD_RENEW_POS.x, MONTHCARD_RENEW_POS.y - dy, 0);
            this.btnBuyLabel.string = `${MONTHCARD_TEXTS.renewPrefix}${MONTHCARD_TEXTS.buyPrefix}${price}`;
        } else {
            this.btnBuy.setPosition(MONTHCARD_BUY_POS.x, MONTHCARD_BUY_POS.y - dy, 0);
            this.btnBuyLabel.string = `${MONTHCARD_TEXTS.buyPrefix}${price}`;
        }
    }

    /** 每日奖励格。 */
    private presentDayRewards(view: IMonthCardGiftView, art: IMonthCardGiftEntryArt): void {
        const rewards = view.gift.dayRewards;
        const slots = this.daySlots;
        for (let index = 0; index < slots.length; index++) {
            const reward = rewards[index];
            if (!reward) {
                slots[index].hide();
                continue;
            }
            slots[index].node.active = true;
            slots[index].render(
                art.rewardIcons.get(reward.resId) ?? null,
                null,
                String(reward.number),
            );
        }
    }

    /** 特权行。 */
    private presentPrivileges(view: IMonthCardGiftView, art: IMonthCardGiftEntryArt): void {
        const privileges = view.gift.privileges;
        const dotFrame = art.frames.get(view.gift.dotArt) ?? null;
        const rows = this.privilegeRows;
        for (let index = 0; index < rows.length; index++) {
            const privilege = privileges[index];
            if (!privilege) {
                rows[index].hide();
                continue;
            }
            rows[index].node.active = true;
            rows[index].render(dotFrame, privilege.desc);
        }
    }

    /** 每秒刷新倒计时；刚过期返回 true。 */
    tickRemain(nowMs: number): boolean {
        const view = this.view;
        if (!view || !view.bought) return false;
        const remainMs = view.endTimeMs - nowMs;
        if (remainMs <= 0) {
            this.presentRemain(0);
            return true;
        }
        this.presentRemain(remainMs);
        return false;
    }

    private presentRemain(remainMs: number): void {
        const { day } = formatRemain(remainMs);
        this.lbTime.string = `${MONTHCARD_TEXTS.remainPrefix}${day}${MONTHCARD_TEXTS.remainSuffix}`;
    }

    /** 气泡自转。 */
    protected update(dt: number): void {
        if (!this.gainBubble.activeInHierarchy) return;
        this.bubbleAngle = (this.bubbleAngle + (360 / MONTHCARD_BUBBLE_SPIN_SECONDS) * dt) % 360;
        this.gainBubble.angle = -this.bubbleAngle;
    }

    private handleBuyClick(): void {
        if (this.view) this.onBuy?.(this.view);
    }

    private handleClaimClick(): void {
        if (this.view) this.onClaim?.(this.view);
    }
}
