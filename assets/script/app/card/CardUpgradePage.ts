import { _decorator, Button, Color, Label, Node, Sprite } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { cardArtProvider } from './CardArtProvider';
import { cardRepository } from './CardRepository';
import { LoadingPopup } from '../common/LoadingPopup';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { upgradeButtonText } from './CardUpgradeCost';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import { applyCardHeadArt } from './CardHeadView';
import { CardLineupEvent } from './CardLineupEvents';
import type { IHeroUpgradedPayload } from './CardLineupEvents';
import { EventMgr } from '../../framework/event/EventMgr';
import { CardSkillPage } from './CardSkillPage';
import type {
    CardUpgradePhase,
    CardUpgradePresentation,
    ICardUpgradeOpenData,
} from './CardPresentations';

export type { ICardUpgradeOpenData } from './CardPresentations';

const { ccclass, property } = _decorator;

/**
 * 「卡牌升级」弹窗（`assets/resources/ui/card/CardUpgrade.prefab`）。
 *
 * 入口是卡牌阵容页卡库里的一张卡（`CardLineup/CardGrid` 的条目）：
 * `CardLineupPage` 把 `VirtualScrollView.onItemClickFn` 接到本弹窗，
 * 带着「卡 + 当前等级」进来。
 *
 * 弹窗只做三件事：
 *   ① 读 `cardLevelUp` 算出「升到下一级」的消耗（`CardUpgradeCost`，纯函数）；
 *   ② 读物品背包 `CmdItem` 缓存，判断材料够不够，决定按钮能不能点；
 *   ③ 点「升级」发 `CmdPvpHeroUpLevelReqMsg { heroId }`，成功后用响应里的新等级重刷。
 *
 *  例外只有一处「说法」：**等级为 0（也就是「升到 1 级」这一档）时按钮叫「解锁」**
 *  —— 0 → 1 是把这张卡解锁出来，不是升级。**仅改按钮文案**，上面 ①②③ 全都不变：
 *  判定照样两条件（卡牌 + 经验）都要满足，`costArmyLevelNum` 该多少就是多少
 *  （表里 level=1 那行配多少经验就得有多少）。规则在 `upgradeButtonText()`（纯函数）。
 *
 *  ⚠️ 别因为按钮写着「解锁」就把经验判断去掉 —— 那是**扣材料**，不是文案。
 *
 *  **消耗由服务端结算，客户端只做展示**：请求体里没有任何材料参数，
 * 这里的「够不够」纯粹是按钮可用状态，别把它当校验。
 *
 *  项目约定：**样式与布局全在 prefab 的 Inspector 上**，代码只填数据
 * （连「材料够 / 不够」的两种颜色也提成 `@property`，见 `enoughColor` / `lackColor`）。
 */
@ccclass('CardUpgradePage')
export class CardUpgradePage extends PopupBase {
    private artRevision = 0;
    /** 本次打开的卡牌 id（「技能」按钮用它打开技能面板）。 */
    private cardIdForSkills = '';
    /** 当前卡牌等级（升级点击时用它决定 loading 文案：「解锁中…」/「升级中…」）。 */
    private currentLevel = 0;

    // ---- 原来在 `CardUpgradePresenter` 里的会话状态 ----
    /** 取数轮次：`open()` 那次与升级成功后的重刷会交错，慢的回来不许覆盖快的。 */
    private upgradeRevision = 0;
    private upgradeData: ICardUpgradeOpenData | null = null;
    private upgradeStatus: ZCUpgradeStatus | null = null;
    private upgradePhase: CardUpgradePhase = 'loading';

    /**
     * `CloseBtn` / `BtnUpgrade` 上的 `cc.Button`。
     */

    /** 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。 */
    static prefabPath = 'ui/card/CardUpgrade';

    @property({ type: Label, tooltip: 'Title/Label：标题「卡牌升级」' })
    titleLabel: Label = null!;

    @property({ type: Button, tooltip: 'CloseBtn 上的 cc.Button（**绑组件不绑节点**）' })
    closeButton: Button = null!;

    @property({ type: Sprite, tooltip: 'Card/Face：卡面底图（common_img_kp_01..04，按品级换图）' })
    cardFace: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Card/Badge：左上角职业角标（class_*）' })
    cardBadge: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Card/Hero：职业营地雕像（camp_*）' })
    cardHero: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Card/HeadIcon：该卡自己的头像（84×84，与 Hero 互斥显示）' })
    cardHeadIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'Info/NameLabel：卡牌名（如「精灵弓箭手」）' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'Info/LevelLabel：等级，写成「3级 → 4级」；已满级时只写当前等级' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostCard/NameLabel：消耗行名称「卡牌」' })
    cardCostNameLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostCard/CountLabel：卡牌数量「持有/需要」' })
    cardCostCountLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostCard/ItemLabel：小字，写被消耗卡牌的道具 id' })
    cardCostItemLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostExp/NameLabel：消耗行名称「经验」' })
    expCostNameLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostExp/CountLabel：经验数量「合计持有/需要」（通用 + 兵种）' })
    expCostCountLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostExp/ItemLabel：小字，写「通用 16000 + 兵种 16003」' })
    expCostItemLabel: Label = null!;

    @property({ type: Label, tooltip: 'Hint：底部提示（材料不足原因 / 未连接 / 已满级）' })
    hintLabel: Label = null!;

    @property({ type: Button, tooltip: 'BtnUpgrade 上的 cc.Button（**绑组件不绑节点**）' })
    upgradeButton: Button = null!;

    @property({ type: Label, tooltip: 'BtnUpgrade/Label：按钮文案' })
    upgradeLabel: Label = null!;

    /**
     * 「技能」按钮：打开独立的技能面板弹窗。
     *
     * 技能列表**不塞进本弹窗**：本弹窗纵向已被卡面 / 信息 / 消耗 / 经验 / 提示 /
     * 升级按钮占满（背景 651×982），硬塞会与「卡牌」「经验」两行文字重叠。
     * 允许为空 —— 没配这个按钮时技能入口就只从卡牌页走。
     */
    @property({ type: Button, tooltip: 'BtnSkill 上的 cc.Button（**绑组件不绑节点**；可留空）' })
    skillButton: Button | null = null;

    @property({ type: Color, tooltip: '材料已满足时的文字颜色（样式放 Inspector，代码不写死）' })
    enoughColor: Color = new Color(104, 218, 59, 255);

    @property({ type: Color, tooltip: '材料不足时的文字颜色' })
    lackColor: Color = new Color(226, 88, 74, 255);

    @property({ type: Color, tooltip: '已满级 / 无配置时的文字颜色' })
    idleColor: Color = new Color(176, 168, 150, 255);

    protected onInit(): void {
        this.titleLabel.string = CARD_LINEUP_TEXTS.upgradeTitle;
        this.cardCostNameLabel.string = CARD_LINEUP_TEXTS.upgradeCardRow;
        this.expCostNameLabel.string = CARD_LINEUP_TEXTS.upgradeExpRow;
        //  打开瞬间的初始文案（紧接着 `presentUpgrade` 就会按真实等级覆盖掉）——
        //  按「1 级」写，于是仍然是「升级」；走同一个函数是为了让按钮文案**只有一个来源**，
        //  否则 0 级卡在打开的第一帧会闪一下「升级」。
        this.upgradeLabel.string = upgradeButtonText(1, false);

        //  CLICK 是挂在**节点**上的（Button 自身没有 on），别写成 button.on(...)。
        this.closeButton.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.upgradeButton.node.on(Button.EventType.CLICK, this.onUpgradeClick, this);
        this.skillButton?.node.on(Button.EventType.CLICK, this.onSkillClick, this);
    }

    protected onOpen(userData?: ICardUpgradeOpenData): void | Promise<void> {
        if (!userData) return;
        this.cardIdForSkills = userData.cardId;
        return this.openUpgrade(userData);
    }

    /**
     * 打开技能面板（独立弹窗，带 heroId + 卡名）。
     *
     * **先关掉本弹窗**再开技能面板：两者都是 660 宽、居中的全屏面板，同时存在时
     * 背景板完全重合，下层的卡面 / 文字会从上层边缘透出来（实测就是「界面串了」）。
     * 关掉后再开，界面永远只有一层。
     */
    private onSkillClick(): void {
        if (!this.alive) return;
        const heroId = Number(this.cardIdForSkills);
        //  卡 id 不是数字（主城 / 金矿这类非英雄卡）就没有技能可升，直接忽略点击。
        if (!Number.isSafeInteger(heroId) || heroId <= 0) return;
        const cardName = this.nameLabel.string;
        void CardSkillPage.open({ userData: { heroId, cardName } });
        this.close();
    }

    /**
     * 打开：先派发 loading 态，再拉升级状态。
     *
     *  这段原来在 `CardUpgradePresenter.open()` 里；现在弹窗自己管
     *  （`upgradePhase` + `upgradeStatus` 是跨"打开 → 升级 → 重刷"的会话状态）。
     */
    private async openUpgrade(data: ICardUpgradeOpenData): Promise<void> {
        this.upgradeData = data;
        this.cardIdForSkills = String(data.cardId);
        this.currentLevel = Math.max(0, Math.floor(Number(data.level) || 0));
        this.upgradeStatus = null;
        this.upgradePhase = 'loading';
        this.emitUpgrade();
        await this.loadUpgradeStatus();
    }

    private async loadUpgradeStatus(): Promise<void> {
        if (!this.upgradeData) return;
        const revision = ++this.upgradeRevision;
        const status = await cardRepository.loadUpgradeStatus(this.cardIdForSkills, this.currentLevel);
        if (revision !== this.upgradeRevision) return;
        if (!this.alive) return;
        this.upgradeStatus = status;
        this.upgradePhase = 'ready';
        this.emitUpgrade();
    }

    /**
     * 「升级」：发 `CmdPvpHeroUpLevelReqMsg`。
     *
     * `submitting` 既是**防重入**（第二次点击直接返回）也是按钮置灰的依据；
     * 失败只回退 phase，不动 `currentLevel`（服务端没变，本地也不该变）。
     */
    private async submitUpgrade(caller: object): Promise<void> {
        if (!this.upgradeData || this.upgradePhase === 'submitting' || !this.upgradeStatus?.canUpgrade) return;
        this.upgradePhase = 'submitting';
        this.emitUpgrade();
        const result = await cardRepository.upgradeHero(Number(this.cardIdForSkills), caller);
        if (result.kind === 'offline' || result.kind === 'failed') {
            this.upgradePhase = result.kind;
            this.emitUpgrade();
            return;
        }
        this.currentLevel = result.level;
        cardRepository.applyHeroLevel(result.heroId, result.level);
        //  升级成功**当场派发**，不等弹窗关闭：卡牌页拿它回写等级缓存并整页重刷。
        EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, {
            heroId: result.heroId,
            level: result.level,
        } satisfies IHeroUpgradedPayload);
        await this.loadUpgradeStatus();
    }

    private emitUpgrade(): void {
        if (!this.upgradeData) return;
        this.presentUpgrade({
            data: this.upgradeData,
            cardId: this.cardIdForSkills,
            level: this.currentLevel,
            status: this.upgradeStatus,
            phase: this.upgradePhase,
        });
    }

    /** 唯一的写 UI 入口：卡面 → 升级状态。 */
    private presentUpgrade(data: CardUpgradePresentation): void {
        this.currentLevel = data.level;
        this.nameLabel.string = data.data.card?.name ?? data.cardId;
        this.renderCardFace(data);
        if (data.status) {
            this.renderStatus(data.status, data.phase);
            return;
        }
        this.upgradeButton.interactable = false;
        //  提交中按钮文案保持常态（「升级」/「解锁」）：进行中的状态提示由通用 loading 全屏承担，
        //  按钮不再显示「升级中…」，避免 loading 遮罩下按钮文案与 loading 文字重复。
        this.upgradeLabel.string = upgradeButtonText(data.level, false);
        this.hintLabel.string = '';
    }

    /** 组件所在节点是否仍然有效（面板随时可能被关掉，`close()` 是直接 destroy）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    /** 卡面四张图：与卡库里那张卡同一套映射（品级 → 卡面，职业 → 角标 / 雕像，头像 → 按卡）。 */
    private renderCardFace(data: CardUpgradePresentation): void {
        const card = data.data.card;
        if (!card) return;
        const revision = ++this.artRevision;
        void cardArtProvider.loadLineupCard(card).then((frames) => {
            if (!this.alive || revision !== this.artRevision) return;
            this.cardFace.spriteFrame = frames.face;
            this.cardBadge.spriteFrame = frames.badge;
            // 与卡库同一入口：有头像铺头像、没头像退回雕像立绘（互斥显隐）。
            //  本类的两个 Sprite 叫 `cardHero` / `cardHeadIcon`（不是 `hero` / `headIcon`），
            //  结构上不满足 `CardHeadSlots`，所以显式组一个 —— 别为了少写这行去改名，
            //  这两个属性名是 prefab 上已绑的。
            applyCardHeadArt({ hero: this.cardHero, headIcon: this.cardHeadIcon }, frames.hero, frames.head);
        });
    }

    /** 把判定结果铺到界面上（这是本弹窗**唯一**的写 UI 入口）。 */
    private renderStatus(status: ZCUpgradeStatus, phase: CardUpgradePhase): void {
        const texts = CARD_LINEUP_TEXTS;

        // ---- 等级：可升时写「3级 → 4级」，满级 / 无配置只写当前等级 ----
        const current = `${status.level}${texts.levelSuffix}`;
        if (status.configured && !status.maxed) {
            this.levelLabel.string = `${current}${texts.upgradeLevelArrow}${status.targetLevel}${texts.levelSuffix}`;
        } else {
            this.levelLabel.string = current;
        }

        // ---- 两行材料 ----
        const [cardRow, expRow] = status.requirements;
        if (cardRow) {
            this.cardCostCountLabel.string = `${cardRow.owned}${texts.progressSeparator}${cardRow.need}`;
            this.cardCostCountLabel.color = cardRow.enough ? this.enoughColor : this.lackColor;
            this.cardCostItemLabel.string = `ID ${cardRow.itemId}`;
        } else {
            this.cardCostCountLabel.string = `${texts.progressSeparator}${texts.progressSeparator}`;
            this.cardCostCountLabel.color = this.idleColor;
            this.cardCostItemLabel.string = '';
        }
        if (expRow) {
            this.expCostCountLabel.string = `${expRow.owned}${texts.progressSeparator}${expRow.need}`;
            this.expCostCountLabel.color = expRow.enough ? this.enoughColor : this.lackColor;
            // 经验是「通用 + 兵种」合计 —— 把拆分写在下面，否则玩家看不懂这个和是怎么来的。
            this.expCostItemLabel.string =
                `${texts.upgradeExpDetail} ${status.generalExpOwned}` +
                `${texts.upgradeExpDetailJoin}${status.armyExpOwned}`;
        } else {
            this.expCostCountLabel.string = `${texts.progressSeparator}${texts.progressSeparator}`;
            this.expCostCountLabel.color = this.idleColor;
            this.expCostItemLabel.string = '';
        }

        // ---- 按钮与提示 ----
        if (!status.configured) {
            this.hintLabel.string = texts.upgradeNoConfig;
            this.hintLabel.color = this.idleColor;
            this.upgradeLabel.string = upgradeButtonText(status.level, false);
            this.upgradeButton.interactable = false;
            return;
        }
        if (status.maxed) {
            this.hintLabel.string = '';
            this.upgradeLabel.string = texts.upgradeMaxed;
            this.upgradeButton.interactable = false;
            return;
        }
        const submitting = phase === 'submitting';
        //  提交中按钮文案保持常态（与上面 presentUpgrade 同一口径）：进行中由通用 loading 提示，
        //  不显示「升级中…」（`submitting` 仍用于按钮置灰与提示分支）。
        this.upgradeLabel.string = upgradeButtonText(status.level, false);
        if (phase === 'offline' || phase === 'failed') {
            this.hintLabel.string = phase === 'offline' ? texts.upgradeOffline : texts.upgradeFailed;
            this.hintLabel.color = this.lackColor;
            this.upgradeButton.interactable = status.canUpgrade;
            return;
        }
        this.hintLabel.string = status.canUpgrade ? '' : status.blockedReason;
        this.hintLabel.color = status.canUpgrade ? this.enoughColor : this.lackColor;
        this.upgradeButton.interactable = status.canUpgrade && !submitting;
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    /**
     * 「升级」：发 `CmdPvpHeroUpLevelReqMsg { heroId }`。
     *
     *  请求体只有 `heroId` —— 消耗由服务端按 `cardLevelUp` 自己扣，
     * 这里算出来的材料数**不是**参数，也别指望它防作弊。
     *
     * 成功后拿 `rsp.info.level` 就地更新本地等级并重刷（背包缓存会被服务器同步下来，
     * 所以重刷时必须重新读一次表与背包，不能复用进入时的快照）。
     */
    private async onUpgradeClick(): Promise<void> {
        //  升级期间用工程通用 loading 全屏遮挡（`LoadingPopup` 引用计数，show/hide 配对），
        //  防止玩家在请求往返期间反复点击重复发 `CmdPvpHeroUpLevelReqMsg`。
        //  文案与按钮同源：0 级档叫「解锁中…」，1 级以上叫「升级中…」。
        LoadingPopup.show(
            this.currentLevel === 0
                ? CARD_LINEUP_TEXTS.upgradeUnlocking
                : CARD_LINEUP_TEXTS.upgradeSending,
        );
        try {
            await this.submitUpgrade(this);
        } finally {
            LoadingPopup.hide();
        }
    }

    onDestroy(): void {
        // 摘掉订阅：`EventMgr` 是全局单例，弹窗每次关闭都销毁重建。
        EventMgr.instance.offTarget(this);
        this.artRevision += 1;
        this.upgradeRevision += 1;
        super.onDestroy();
    }
}
