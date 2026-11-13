import { _decorator, Button, Color, Label, Node, Prefab, Sprite, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { PopupBase } from '../../framework/ui/PopupBase';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { upgradeButtonText } from './CardUpgradeCost';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import { CardUnitPreview } from './CardUnitPreview';
import { CardUnitPreviewAssets } from './CardUnitPreviewAssets';
import { CardDetailHexSlot } from './CardDetailHexSlot';
import { CardDetailMilestoneRow } from './CardDetailMilestoneRow';
import { CardPopupEvent } from './CardPopupEvents';
import { EventMgr } from '../../framework/event/EventMgr';
import { itemDetailRepository } from '../itemdetail/ItemDetailRepository';
import { loadItemIconArt } from '../itemdetail/ItemDetailArtLoader';
import { ItemInfoPage } from '../itemdetail/ItemInfoPage';
import { cardCampName, cardClassName, resolveCardCamp, resolveCardClass } from './CardLineupTypes';
import { milestoneAnchorIndex } from './CardDetailPresenter';
import type {
    CardDetailPresentation,
    CardDetailSkillSlot,
} from './CardDetailPresenter';
import { formatCritDamageGain } from './CardDetailCritDamage';
import type {
    CardUpgradePhase,
    CardUpgradePresentation,
    ICardUpgradeViewState,
} from './CardPresentations';

export type { ICardUpgradeOpenData } from './CardPresentations';

const { ccclass, property } = _decorator;

/**
 * 立绘待机预览的归一高度（设计 px）。
 *
 * 取值口径：展示栏里「战力牌顶 → 上排（名字/品质/职业）底」那段可用带的高度 ——
 * 原版 390 对 388.5 的带，缩完 318 对 317.5，脚点距牌顶 12、头顶压过上排底 12.5 也都沿用。
 *
 * 必须与 `CardUpgrade.prefab` 的 `Header/Hero._lscale`（318/390）一起改：
 *   - spine 预览的高度只认这个入参 —— `cardPreviewFactor` 会把宿主（Hero 节点）的缩放
 *     抵消掉，所以单独调节点缩放对 spine 无效；
 *   - 静态立绘（没有待机骨架时的兜底）只认节点缩放，这个入参管不到它。
 * Hero 锚点是 (0.5, 0)（脚底基线），两条路径都绕脚点缩，所以这里写同一个比例就够。
 */
const HERO_PREVIEW_HEIGHT = 318;

/** 六维属性的写入器：key → (valueLabel, gainLabel) 的页面字段名。 */
type StatKey = 'hp' | 'attack' | 'buildHp' | 'spawn' | 'range' | 'speed';

/** 卡牌详情视图：渲染外部会话快照，按钮仅派发意图。 */
@ccclass('CardUpgradePage')
export class CardUpgradePage extends PopupBase {
    private artRevision = 0;
    private renderRevision = 0;
    private preview: CardUnitPreview | null = null;
    private previewAssets: CardUnitPreviewAssets<Prefab> | null = null;
    private heroKey: string | null = null;
    private hasRenderedStatus = false;
    /** 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。 */
    static prefabPath = 'ui/card/CardUpgrade';

    @property({ group: '基本信息', type: Label, tooltip: 'Header/NameLabel：卡牌名（如「椰蛋战士」）' })
    nameLabel: Label = null!;

    @property({ group: '基本信息', type: Sprite, tooltip: 'Header/QualityDiamond：含品质文字的完整切图，按品级换图' })
    qualitySprite: Sprite = null!;

    @property({ group: '基本信息', type: Label, tooltip: 'Header/TagCamp/Label：种族标签字（花果 等）' })
    tagCampLabel: Label = null!;

    @property({ group: '基本信息', type: Node, tooltip: '无阵营的建筑卡隐藏整个阵营标签' })
    campTagRoot: Node = null!;

    @property({ group: '基本信息', type: Label, tooltip: 'Header/TagClass/Label：职业标签字（战士 等）' })
    tagClassLabel: Label = null!;

    @property({ group: '基本信息', type: Sprite, tooltip: 'Header/TagClass：按职业切换带图标的标签底板' })
    tagClassSprite: Sprite = null!;

    @property({ group: '角色展示', type: Sprite, tooltip: 'Header/Hero：角色立绘（cardHead 专属图 / 职业雕像兜底）' })
    heroSprite: Sprite = null!;


    @property({ group: '基本信息', type: Label, tooltip: 'Header/PowerPill/PowerLabel：当前卡牌战力' })
    powerLabel: Label = null!;

    @property({ group: '基本信息', type: Label, tooltip: 'SkillChain/LevelPlate/LevelLabel：等级牌数字' })
    levelBigLabel: Label = null!;

    @property({ group: '技能天赋', type: VirtualScrollView, tooltip: 'SkillChain：原生 ScrollView 驱动的横向虚拟列表' })
    chainScroll: VirtualScrollView = null!;

    @property({ group: '升级操作', type: Label, tooltip: '升级按钮下方的当前等级与目标等级' })
    levelTransitionLabel: Label = null!;

    @property({ group: '技能天赋', type: VirtualScrollView, tooltip: '原生 ScrollView 驱动的技能天赋虚拟列表' })
    milestoneScroll: VirtualScrollView = null!;

    @property({ group: '技能天赋', type: Node, tooltip: 'MilestoneViewport/MilestoneEmpty：一条描述都没有时的占位' })
    milestoneEmpty: Node = null!;

    @property({ group: '技能天赋', type: Label, tooltip: 'MilestoneViewport/MilestoneEmpty/Label：空态文案' })
    milestoneEmptyLabel: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatHp/ValueLabel：兵种血量' })
    statHpValue: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatHp/GainLabel：兵种血量增量' })
    statHpGain: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatAttack/ValueLabel：攻击力' })
    statAttackValue: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatAttack/GainLabel：攻击力增量' })
    statAttackGain: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatBuildHp/ValueLabel：建筑血量' })
    statBuildHpValue: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatBuildHp/GainLabel：建筑血量增量' })
    statBuildHpGain: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatSpawn/ValueLabel：生产时间' })
    statSpawnValue: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatRange/ValueLabel：攻击范围' })
    statRangeValue: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatRange/GainLabel：攻击范围增量' })
    statRangeGain: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatSpeed/ValueLabel：移动速度' })
    statSpeedValue: Label = null!;

    @property({ group: '基础属性', type: Label, tooltip: 'StatsPanel/StatSpeed/GainLabel：移动速度增量' })
    statSpeedGain: Label = null!;

    @property({ group: '升级操作', type: Label, tooltip: 'UpgradePanel/Hint：提示（材料不足原因 / 未连接 / 已满级）' })
    hintLabel: Label = null!;

    @property({ group: '升级操作', type: Button, tooltip: 'UpgradePanel/BtnUpgrade 上的 cc.Button（**绑组件不绑节点**）' })
    upgradeButton: Button = null!;

    @property({ group: '升级操作', type: Label, tooltip: 'UpgradePanel/BtnUpgrade/Label：按钮文案' })
    upgradeLabel: Label = null!;

    @property({ group: '升级操作', type: Sprite, tooltip: 'UpgradePanel/BtnUpgrade 上的 cc.Sprite：不可升级时整块置灰' })
    upgradeButtonSprite: Sprite = null!;

    @property({ group: '升级操作', type: Color, tooltip: '升级按钮不可点时的文字颜色（可点时沿用 prefab 里的 Label 颜色）' })
    disabledUpgradeLabelColor: Color = new Color(255, 255, 255, 160);

    @property({ group: '升级材料', type: Label, tooltip: 'UpgradePanel/MatCard/CountLabel：卡牌数量「持有/需要」' })
    matCardCountLabel: Label = null!;

    @property({ group: '升级材料', type: Label, tooltip: 'UpgradePanel/MatCardName：材料卡名（读 cardLevelUp.name，如「豌豆游侠」）' })
    matCardItemLabel: Label = null!;

    @property({ group: '升级材料', type: Sprite, tooltip: '卡牌材料图标，复用消耗物品的 item.icon' })
    matCardIcon: Sprite = null!;

    @property({ group: '升级材料', type: Sprite, tooltip: '经验材料图标，复用通用经验或兵种经验的 item.icon' })
    matExpIcon: Sprite = null!;

    /**
     * 经验材料图标的按钮 —— 点它开「道具信息」弹窗（蓝湖「道具信息」稿）。
     *
     * 允许为空：老 prefab 没挂按钮时这个入口就不存在，不影响升级流程。
     * 打开的是当前显示的那颗图标对应的道具（通用经验没配图时是兵种经验），
     * 数量用该道具自己的持有数，不是「通用 + 兵种」的合计。
     */
    @property({ group: '升级材料', type: Button, tooltip: 'ExpIcon 上的 cc.Button（**绑组件不绑节点**；可留空）' })
    expIconButton: Button | null = null;

    @property({ group: '升级材料', type: Label, tooltip: 'UpgradePanel/MatExp/CountLabel：经验数量「合计持有/需要」' })
    matExpCountLabel: Label = null!;

    @property({ group: '升级材料', type: Label, tooltip: 'UpgradePanel/MatExp/ItemLabel：小字，写「通用 16000 + 兵种 16003」' })
    matExpItemLabel: Label = null!;

    @property({ group: '导航按钮', type: Button, tooltip: '左上角返回/CloseBtn 上的 cc.Button（**绑组件不绑节点**）' })
    closeButton: Button = null!;

    @property({ group: '导航按钮', type: Button })
    previousButton: Button = null!;

    @property({ group: '导航按钮', type: Button })
    nextButton: Button = null!;

    /**
     * 「技能」按钮：打开独立的技能面板弹窗（详情页技能链格子也可进入）。
     * 允许为空 —— 没配这个按钮时技能入口就只从技能链格子走。
     */
    @property({ group: '技能天赋', type: Button, tooltip: '可选的技能入口按钮（**绑组件不绑节点**；可留空）' })
    skillButton: Button | null = null;

    @property({ group: '材料状态色', type: Color, tooltip: '材料已满足时的文字颜色（样式放 Inspector，代码不写死）' })
    enoughColor: Color = new Color(104, 218, 59, 255);

    @property({ group: '材料状态色', type: Color, tooltip: '材料不足时的文字颜色' })
    lackColor: Color = new Color(226, 88, 74, 255);

    @property({ group: '材料状态色', type: Color, tooltip: '已满级 / 无配置时的文字颜色' })
    idleColor: Color = new Color(176, 168, 150, 255);

    @property({ group: '材料状态色', type: Color, tooltip: '「升级增加全队暴击伤害」文案的颜色' })
    critColor: Color = new Color(97, 19, 4, 255);

    private chain: CardDetailPresentation['chain'] = [];

    private milestones: CardDetailPresentation['milestones'] = [];

    /** 升到下一级新增的全队暴击伤害（百分点）；0 = 不显示那条文案。 */
    private critDamageGain = 0;

    /** 描述栏当前落点与卡牌身份，用来判断「要不要重新滚」，避免刷新时把阅读位置顶掉。 */
    private renderedCardId = '';
    private milestoneKey = '';

    /** 经验材料图标当前显示的是哪件道具、持有多少（点图标开「道具信息」用）。 */
    private expItemId = 0;
    private expItemOwned = 0;

    /** 按钮可点时的文字颜色（开机时从 prefab 的 Label 上取，代码不写死）。 */
    private upgradeLabelColor: Color | null = null;

    protected onInit(): void {
        this.upgradeLabelColor = this.upgradeLabel.color.clone();
        this.upgradeLabel.string = upgradeButtonText(1, false);
        //  打开瞬间的初始文案由 render 按真实等级覆盖。
        //  按「1 级」写，于是仍然是「升级」；走同一个函数是为了让按钮文案只有一个来源。
        this.closeButton.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.previousButton.node.on(Button.EventType.CLICK, this.onPreviousClick, this);
        this.nextButton.node.on(Button.EventType.CLICK, this.onNextClick, this);
        this.upgradeButton.node.on(Button.EventType.CLICK, this.onUpgradeClick, this);
        this.skillButton?.node.on(Button.EventType.CLICK, this.onSkillClick, this);
        this.expIconButton?.node.on(Button.EventType.CLICK, this.onExpIconClick, this);

        this.chainScroll.renderItemFn = (node, index) => {
            this.renderHexSlot(node.getComponent(CardDetailHexSlot), this.chain[index] ?? null, index);
        };
        this.chainScroll.onItemInitFn = node => {
            node.on(Button.EventType.CLICK, this.onHexClick, this);
        };
        this.milestoneScroll.getItemTypeIndexFn = () => 0;
        this.milestoneScroll.renderItemFn = (node, index) => {
            node.getComponent(CardDetailMilestoneRow).render(this.milestones[index]);
        };
        //  空态文案与其它界面文案同源，预制体里的只是编辑器占位。
        this.milestoneEmptyLabel.string = CARD_LINEUP_TEXTS.detailMilestoneEmpty;

    }

    protected onOpen(): void {
        this.hasRenderedStatus = false;
        this.setUpgradeEnabled(false);
        this.heroSprite.spriteFrame = null;
        this.qualitySprite.spriteFrame = null;
        this.tagClassSprite.spriteFrame = null;
    }

    private readonly onSkillClick = (): void => {
        this.openSkill(this.chain.find(slot => !slot.empty && slot.skillId > 0)?.skillId ?? 0);
    };

    private readonly onHexClick = (slot: CardDetailHexSlot): void => {
        this.openSkill(slot.skillId);
    };

    private openSkill(skillId: number): void {
        EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: this, kind: 'skills', skillId });
    }

    /**
     * 点经验材料图标 → 开「道具信息」弹窗（蓝湖「道具信息」稿）。
     *
     * 顺序上必须先由 `renderStatus` 把 `expItemId` 定下来（它是这一趟图标画的那件道具）；
     * 图标还没铺出来时不响应，避免拿上一张卡的经验道具去开详情。
     */
    private readonly onExpIconClick = (): void => {
        if (this.expItemId <= 0) return;
        void ItemInfoPage.open({
            userData: { resId: this.expItemId, number: this.expItemOwned },
            layer: this.popupLayer,
        });
    };

    private readonly onPreviousClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: this, kind: 'previous' });
    };

    private readonly onNextClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: this, kind: 'next' });
    };

    /** 唯一的写 UI 入口：头部 + 详情区 + 升级状态。 */
    render(data: ICardUpgradeViewState): void {
        this.renderRevision++;
        this.renderedCardId = String(data.cardId ?? '');
        this.renderHeader(data);
        this.levelBigLabel.string = String(data.level);
        this.levelTransitionLabel.string = `${CARD_LINEUP_TEXTS.detailTabLevel} ${data.level}`;
        const navigating = data.phase !== 'submitting';
        this.previousButton.interactable = navigating;
        this.nextButton.interactable = navigating;
        this.renderDetail(data.detail);
        if (data.status) {
            this.renderStatus(data.status, data.phase);
            this.hasRenderedStatus = true;
            return;
        }
        this.setUpgradeEnabled(false);
        //  提交中按钮文案保持常态（「升级」/「解锁」）：进行中的状态提示由通用 loading 全屏承担。
        this.upgradeLabel.string = upgradeButtonText(data.level, false);
        if (this.hasRenderedStatus && data.phase === 'loading') return;
        this.matCardCountLabel.string = '';
        this.matCardItemLabel.string = '';
        this.matExpCountLabel.string = '';
        this.matExpItemLabel.string = '';
        this.matCardIcon.spriteFrame = null;
        this.matExpIcon.spriteFrame = null;
        // 图标一起收掉 ⇒ 「点开哪件道具」也一起作废（否则会拿上一张卡的经验道具开详情）。
        this.expItemId = 0;
        this.expItemOwned = 0;
        this.matCardCountLabel.color = this.idleColor;
        this.matExpCountLabel.color = this.idleColor;
        this.hintLabel.color = this.lackColor;
        this.hintLabel.string = data.phase === 'failed' ? CARD_LINEUP_TEXTS.upgradeFailed : '';
    }

    /** 组件所在节点是否仍然有效（面板随时可能被关掉，`close()` 是直接 destroy）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    // ------------------------------------------------------------------
    // 头部：名字 / 品质 / 种族职业 / 立绘 / 战力
    // ------------------------------------------------------------------

    private renderHeader(data: ICardUpgradeViewState): void {
        const card = data.data.card;
        this.nameLabel.string = card?.name ?? data.cardId;
        if (card) {
            const lineup = data.lineup;
            const camp = lineup ? resolveCardCamp(card, lineup) : null;
            this.campTagRoot.active = camp !== null;
            if (camp && lineup) this.tagCampLabel.string = cardCampName(camp, lineup);
            this.tagClassLabel.string = lineup ? cardClassName(resolveCardClass(card, lineup), lineup) : '';
        } else {
            this.campTagRoot.active = false;
            this.tagClassLabel.string = '';
        }
        this.powerLabel.string = data.detail?.powerText || '--';
        this.qualitySprite.spriteFrame = data.art?.diamond ?? null;
        this.tagClassSprite.spriteFrame = data.art?.classTag ?? null;
        this.renderHero(card, data.art?.hero ?? null);
    }

    /** 优先展示对应兵种的循环待机，缺少模型或 idle 时保留原立绘。 */
    private renderHero(card: CardUpgradePresentation['data']['card'], hero: SpriteFrame | null): void {
        const key = card ? `${card.id}|${card.rarity}|${card.unitId}|${card.unitPrefabPath}` : null;
        if (key !== null && key === this.heroKey) return;
        this.heroKey = key;
        const scope = this.resourceScope;
        const revision = ++this.artRevision;
        this.preview?.clear();
        this.heroSprite.spriteFrame = hero;
        if (!card) {
            return;
        }
        if (!this.previewAssets) {
            const assets = this.assets;
            this.previewAssets = new CardUnitPreviewAssets((path) => assets.load(path, Prefab));
        }
        void this.previewAssets.load(card).then(prefab => {
            if (scope.disposed || !this.alive || revision !== this.artRevision) return;
            if (!this.preview) {
                const preview = new CardUnitPreview(this.heroSprite, HERO_PREVIEW_HEIGHT);
                this.preview = preview;
                scope.defer(() => { preview.clear(); });
            }
            this.preview.show(prefab);
        }).catch(error => { if (!scope.disposed && this.alive) console.error('[CardUpgradePage] 待机预览加载失败', error); });
    }

    // ------------------------------------------------------------------
    // 详情区：六维 / 技能链 / 里程碑
    // ------------------------------------------------------------------

    private renderDetail(detail: CardDetailPresentation | null): void {
        if (!detail) {
            for (const label of this.statValueLabels().values()) label.string = '--';
            for (const label of this.statGainLabels().values()) label.string = '';
            this.levelBigLabel.string = this.levelBigLabel.string || '0';
            this.renderChain([]);
            this.renderMilestones([]);
            //  还停在「详情没到」（加载中 / 无数据）时不算「没有描述」，占位条要真有详情才可能出现。
            this.milestoneEmpty.active = false;
            this.critDamageGain = 0;
            return;
        }
        const values = this.statValueLabels();
        const gains = this.statGainLabels();
        for (const line of detail.stats) {
            const valueLabel = values.get(line.key);
            if (valueLabel) valueLabel.string = line.value;
            const gainLabel = gains.get(line.key);
            if (gainLabel) gainLabel.string = line.gain;
        }
        this.renderChain(detail.chain);
        this.renderMilestones(detail.milestones);
        this.critDamageGain = Math.max(0, Number(detail.critDamageGain) || 0);
    }

    private renderChain(chain: CardDetailPresentation['chain']): void {
        this.chain = chain;
        this.chainScroll.refreshList(chain.length);
    }

    /**
     * 描述栏：全部技能档都进列表，只把打开时的落点放到「最新解锁那一档」。
     *
     * 只有落点或行数变了才滚 —— 同一张卡刷新（升级回包、状态刷两次）保持玩家当前阅读位置。
     * 一条都没有（技能描述整块未配）时显示占位条，而不是留一片空白。
     */
    private renderMilestones(milestones: CardDetailPresentation['milestones']): void {
        this.milestones = milestones;
        this.milestoneScroll.refreshList(milestones.length);
        this.milestoneEmpty.active = milestones.length === 0;
        const anchor = milestoneAnchorIndex(milestones);
        const key = `${this.renderedCardId}|${anchor}|${milestones.length}`;
        if (key === this.milestoneKey) return;
        this.milestoneKey = key;
        this.milestoneScroll.scrollToIndex(anchor);
    }

    private renderHexSlot(slot: CardDetailHexSlot, data: CardDetailSkillSlot | null, index: number): void {
        const texts = CARD_LINEUP_TEXTS;
        const configured = !!data && !data.empty;
        slot.skillId = configured ? data.skillId : 0;
        const unlocked = configured && data.unlocked;
        const showBadge = unlocked && data.unlockLevel > 0;
        const activeStyle = index === 1;
        slot.namePlate.spriteFrame = activeStyle ? slot.activeNamePlateFrame : slot.normalNamePlateFrame;
        slot.namePlateTransform.setContentSize(activeStyle ? 68 : 72, activeStyle ? 31 : 35);
        const badgeSize = activeStyle ? 32.4 : 36;
        slot.badgeTransform.setContentSize(badgeSize, badgeSize);
        slot.badgeWidget.left = activeStyle ? 75.8 : 73;
        slot.badgeWidget.updateAlignment();
        slot.interactable = configured;
        //  技能图标暂时都共用 `skillArt` 里烘焙的那张图：首格不再单独隐藏（2026-11-11 需求），
        //  等每个技能都有专属图标后再按 `data.skillId` 换图。
        slot.skillArt.node.active = true;
        slot.lockRoot.active = !unlocked;
        slot.namePlate.node.active = unlocked;
        slot.nameTransform.width = unlocked ? (index === 1 ? 60 : 64) : 114;
        slot.nameLabel.string = !configured ? texts.detailChainLocked : unlocked
            ? data.name || texts.detailChainLocked
            : `${data.unlockLevel}${texts.detailLevelSuffix}${texts.upgradeUnlock}`;
        slot.nameLabel.color = unlocked ? slot.unlockedColor : this.idleColor;
        if (slot.badgeSprite) slot.badgeSprite.node.active = showBadge;
        if (slot.badgeLabel) slot.badgeLabel.string = showBadge ? String(data.unlockLevel) : '';
    }

    private statValueLabels(): ReadonlyMap<StatKey, Label> {
        return new Map<StatKey, Label>([
            ['hp', this.statHpValue],
            ['attack', this.statAttackValue],
            ['buildHp', this.statBuildHpValue],
            ['spawn', this.statSpawnValue],
            ['range', this.statRangeValue],
            ['speed', this.statSpeedValue],
        ]);
    }

    private statGainLabels(): ReadonlyMap<StatKey, Label> {
        return new Map<StatKey, Label>([
            ['hp', this.statHpGain],
            ['attack', this.statAttackGain],
            ['buildHp', this.statBuildHpGain],
            ['range', this.statRangeGain],
            ['speed', this.statSpeedGain],
        ]);
    }

    // ------------------------------------------------------------------
    // 固定底栏：原升级判定与提示语义保持不变
    // ------------------------------------------------------------------

    /** 把判定结果铺到升级面板（这是升级侧唯一的写 UI 入口）。 */
    private renderStatus(status: ZCUpgradeStatus, phase: CardUpgradePhase): void {
        const texts = CARD_LINEUP_TEXTS;
        //  经验图标的「点开道具信息」身份每一趟都重算：图标换了、道具就不能还停在上一次那件。
        this.expItemId = 0;
        this.expItemOwned = 0;
        const cardRequirement = status.requirements.find(row => row.key === 'card');
        this.renderMaterialIcon(
            this.matCardIcon,
            cardRequirement ? [{ id: cardRequirement.itemId, owned: cardRequirement.owned }] : [],
        );
        this.renderMaterialIcon(
            this.matExpIcon,
            [
                { id: status.generalExpItemId, owned: status.generalExpOwned },
                { id: status.armyExpItemId, owned: status.armyExpOwned },
            ],
            (picked) => {
                this.expItemId = Number(picked.id) || 0;
                this.expItemOwned = picked.owned;
            },
        );
        this.levelTransitionLabel.string = status.maxed
            ? texts.upgradeMaxed
            : `${texts.detailTabLevel} ${status.level}${texts.upgradeLevelArrow}${status.targetLevel}`;

        // ---- 两行材料 ----
        const [cardRow, expRow] = status.requirements;
        if (cardRow) {
            this.matCardCountLabel.string = `${cardRow.owned}${texts.progressSeparator}${cardRow.need}`;
            this.matCardCountLabel.color = cardRow.enough ? this.enoughColor : this.lackColor;
            // 卡牌名读 `cardLevelUp.name`（表里已按 pvpCard 对齐）；老表没名字时退回通用文案。
            this.matCardItemLabel.string = cardRow.name || texts.upgradeCardRow;
        } else {
            this.matCardCountLabel.string = `${texts.progressSeparator}${texts.progressSeparator}`;
            this.matCardCountLabel.color = this.idleColor;
            this.matCardItemLabel.string = '';
        }
        if (expRow) {
            this.matExpCountLabel.string = `${expRow.owned}${texts.progressSeparator}${expRow.need}`;
            this.matExpCountLabel.color = expRow.enough ? this.enoughColor : this.lackColor;
            // 经验是「通用 + 兵种」合计 —— 把拆分写在下面，否则玩家看不懂这个和是怎么来的。
            this.matExpItemLabel.string =
                `${texts.upgradeExpDetail} ${status.generalExpOwned}` +
                `${texts.upgradeExpDetailJoin}${status.armyExpOwned}`;
        } else {
            this.matExpCountLabel.string = `${texts.progressSeparator}${texts.progressSeparator}`;
            this.matExpCountLabel.color = this.idleColor;
            this.matExpItemLabel.string = '';
        }

        // ---- 按钮与提示 ----
        if (!status.configured) {
            this.hintLabel.string = texts.upgradeNoConfig;
            this.hintLabel.color = this.idleColor;
            this.upgradeLabel.string = upgradeButtonText(status.level, false);
            this.setUpgradeEnabled(false);
            return;
        }
        if (status.maxed) {
            this.hintLabel.string = '';
            this.upgradeLabel.string = texts.upgradeMaxed;
            this.setUpgradeEnabled(false);
            return;
        }
        const submitting = phase === 'submitting';
        //  提交中按钮文案保持常态：进行中由通用 loading 提示，不显示「升级中…」。
        this.upgradeLabel.string = upgradeButtonText(status.level, false);
        if (phase === 'offline' || phase === 'failed') {
            this.hintLabel.string = phase === 'offline' ? texts.upgradeOffline : texts.upgradeFailed;
            this.hintLabel.color = this.lackColor;
            this.setUpgradeEnabled(status.canUpgrade);
            return;
        }
        //  这一栏常态显示「升级增加全队暴击伤害」：材料不足已经由按钮置灰 + 材料数字变红表达，
        //  不再让红字提示和奖励文案抢同一行（2026-11-10 需求）。
        this.hintLabel.string = this.critDamageText();
        this.hintLabel.color = this.critColor;
        //  材料不足（canUpgrade = false）时按钮置灰：交互态与灰态只有一个入口，避免两者说法不一致。
        this.setUpgradeEnabled(status.canUpgrade && !submitting);
    }

    /** 升级奖励条上的暴击伤害文案；链上没有下一档（已满级 / 没配置）时为空。 */
    private critDamageText(): string {
        const gain = formatCritDamageGain(this.critDamageGain);
        return gain ? `${CARD_LINEUP_TEXTS.upgradeCritDamage}${gain}` : '';
    }

    /** 升级按钮可用态的唯一写入口：可点 = 原色，不可点 = 置灰。 */
    private setUpgradeEnabled(enabled: boolean): void {
        this.upgradeButton.interactable = enabled;
        this.upgradeButtonSprite.grayscale = !enabled;
        const color = enabled ? this.upgradeLabelColor : this.disabledUpgradeLabelColor;
        if (color) this.upgradeLabel.color = color;
    }

    /** 经验合计优先通用经验，未配图时取兵种经验；始终复用物品表图标。 */
    private renderMaterialIcon(
        sprite: Sprite,
        entries: readonly { readonly id: string; readonly owned: number }[],
        onPick?: (picked: { readonly id: string; readonly owned: number }) => void,
    ): void {
        const scope = this.resourceScope;
        const revision = this.renderRevision;
        void (async () => {
            for (const entry of entries) {
                if (!entry.id) continue;
                const item = await itemDetailRepository.loadItemRow(Number(entry.id));
                if (scope.disposed || !this.alive || revision !== this.renderRevision) return;
                if (!item || !item.icon) continue;
                const frame = await loadItemIconArt(item.icon);
                if (scope.disposed || !this.alive || revision !== this.renderRevision) return;
                sprite.spriteFrame = frame;
                //  只有真的画出来的那一件才算「当前显示的道具」（点图标开的就是它）。
                onPick?.(entry);
                return;
            }
            sprite.spriteFrame = null;
        })().catch(error => {
            if (!scope.disposed && this.alive) console.error('[CardUpgradePage] 物品图标加载失败', error);
        });
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private readonly onUpgradeClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: this, kind: 'submit' });
    };

    protected onClose(): void {
        this.artRevision++;
        this.renderRevision++;
        this.preview?.clear();
        this.preview = null;
        this.previewAssets = null;
        this.heroKey = null;
    }
}
