import { _decorator, Button, Color, Label, Node, Prefab, Sprite, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { PopupBase } from '../../framework/ui/PopupBase';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { upgradeButtonText } from './CardUpgradeCost';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import { loadCardDetailArt } from './CardLineupIcons';
import { CardUnitPreview } from './CardUnitPreview';
import { CardUnitPreviewAssets } from './CardUnitPreviewAssets';
import { CardDetailHexSlot } from './CardDetailHexSlot';
import { CardDetailMilestoneRow } from './CardDetailMilestoneRow';
import { CardPopupEvent } from './CardPopupEvents';
import { EventMgr } from '../../framework/event/EventMgr';
import { itemDetailRepository } from '../itemdetail/ItemDetailRepository';
import { loadItemIconArt } from '../itemdetail/ItemDetailArtLoader';
import { cardCampName, cardClassName, cardRarityName, resolveCardCamp, resolveCardClass } from './CardLineupTypes';
import type {
    CardDetailPresentation,
    CardDetailSkillSlot,
} from './CardDetailPresenter';
import type {
    CardUpgradePhase,
    CardUpgradePresentation,
    ICardUpgradeViewState,
} from './CardPresentations';

export type { ICardUpgradeOpenData } from './CardPresentations';

const { ccclass, property } = _decorator;

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

    @property({ group: '基本信息', type: Sprite, tooltip: 'Header/QualityDiamond：品质菱形（diamond_*，按品级换图）' })
    qualitySprite: Sprite = null!;

    @property({ group: '基本信息', type: Label, tooltip: 'Header/QualityLabel：菱形中央品质字（史诗 等）' })
    qualityLabel: Label = null!;

    @property({ group: '基本信息', type: Label, tooltip: 'Header/TagCamp/Label：种族标签字（花果 等）' })
    tagCampLabel: Label = null!;

    @property({ group: '基本信息', type: Node, tooltip: '无阵营的建筑卡隐藏整个阵营标签' })
    campTagRoot: Node = null!;

    @property({ group: '基本信息', type: Label, tooltip: 'Header/TagClass/Label：职业标签字（战士 等）' })
    tagClassLabel: Label = null!;

    @property({ group: '角色展示', type: Sprite, tooltip: 'Header/Hero：角色立绘（cardHead 专属图 / 职业雕像兜底）' })
    heroSprite: Sprite = null!;


    @property({ group: '基本信息', type: Label, tooltip: 'Header/PowerPill/PowerLabel：当前卡牌战力' })
    powerLabel: Label = null!;

    @property({ group: '基本信息', type: Label, tooltip: 'SkillChain/LevelPlate/LevelLabel：等级牌数字' })
    levelBigLabel: Label = null!;

    @property({ group: '技能天赋', type: Node, tooltip: 'SkillChain：技能链容器（CardDetailHexSlot 从这里收集）' })
    chainRoot: Node = null!;

    @property({ group: '升级操作', type: Label, tooltip: '升级按钮下方的当前等级与目标等级' })
    levelTransitionLabel: Label = null!;

    @property({ group: '技能天赋', type: VirtualScrollView, tooltip: '技能天赋不等高虚拟列表' })
    milestoneScroll: VirtualScrollView = null!;

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

    @property({ group: '升级材料', type: Label, tooltip: 'UpgradePanel/MatCard/CountLabel：卡牌数量「持有/需要」' })
    matCardCountLabel: Label = null!;

    @property({ group: '升级材料', type: Label, tooltip: 'UpgradePanel/MatCardName：材料卡名（读 cardLevelUp.name，如「豌豆游侠」）' })
    matCardItemLabel: Label = null!;

    @property({ group: '升级材料', type: Sprite, tooltip: '卡牌材料图标，复用消耗物品的 item.icon' })
    matCardIcon: Sprite = null!;

    @property({ group: '升级材料', type: Sprite, tooltip: '经验材料图标，复用通用经验或兵种经验的 item.icon' })
    matExpIcon: Sprite = null!;

    @property({ group: '升级材料', type: Label, tooltip: 'UpgradePanel/MatExp/CountLabel：经验数量「合计持有/需要」' })
    matExpCountLabel: Label = null!;

    @property({ group: '升级材料', type: Label, tooltip: 'UpgradePanel/MatExp/ItemLabel：小字，写「通用 16000 + 兵种 16003」' })
    matExpItemLabel: Label = null!;

    @property({ group: '导航按钮', type: Button, tooltip: '左上角返回/CloseBtn 上的 cc.Button（**绑组件不绑节点**）' })
    closeButton: Button = null!;

    @property({ group: '导航按钮', type: Button })
    teamButton: Button = null!;

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

    /** 技能链格子（onInit 收集一次，按节点名 Hex0..4 排序）。 */
    private hexSlots: readonly CardDetailHexSlot[] = [];

    private milestones: CardDetailPresentation['milestones'] = [];

    protected onInit(): void {
        this.upgradeLabel.string = upgradeButtonText(1, false);
        //  打开瞬间的初始文案由 render 按真实等级覆盖。
        //  按「1 级」写，于是仍然是「升级」；走同一个函数是为了让按钮文案**只有一个来源**。
        this.closeButton.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.teamButton.node.on(Button.EventType.CLICK, this.onTeamClick, this);
        this.previousButton.node.on(Button.EventType.CLICK, this.onPreviousClick, this);
        this.nextButton.node.on(Button.EventType.CLICK, this.onNextClick, this);
        this.upgradeButton.node.on(Button.EventType.CLICK, this.onUpgradeClick, this);
        this.skillButton?.node.on(Button.EventType.CLICK, this.onSkillClick, this);

        // 技能链按节点名排序，里程碑交给虚拟列表复用。
        this.hexSlots = this.chainRoot.getComponentsInChildren(CardDetailHexSlot)
            .slice()
            .sort((a, b) => a.node.name.localeCompare(b.node.name));
        for (const slot of this.hexSlots) slot.node.on(Button.EventType.CLICK, this.onSkillClick, this);
        this.milestoneScroll.getItemTypeIndexFn = () => 0;
        this.milestoneScroll.renderItemFn = (node, index) => {
            node.getComponent(CardDetailMilestoneRow).render(this.milestones[index]);
        };
    }

    protected onOpen(): void {
        this.hasRenderedStatus = false;
        this.upgradeButton.interactable = false;
        this.heroSprite.spriteFrame = null;
        this.qualitySprite.spriteFrame = null;
    }

    private readonly onSkillClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: this, kind: 'skills' });
    };

    private readonly onTeamClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: this, kind: 'team' });
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
        this.renderHeader(data);
        this.levelBigLabel.string = `${CARD_LINEUP_TEXTS.detailMilestonePrefix}${data.level}`;
        this.levelTransitionLabel.string = `${CARD_LINEUP_TEXTS.detailTabLevel} ${data.level}`;
        const navigating = data.phase !== 'submitting';
        this.teamButton.interactable = navigating;
        this.previousButton.interactable = navigating;
        this.nextButton.interactable = navigating;
        this.renderDetail(data.detail);
        if (data.status) {
            this.renderStatus(data.status, data.phase);
            this.hasRenderedStatus = true;
            return;
        }
        this.upgradeButton.interactable = false;
        //  提交中按钮文案保持常态（「升级」/「解锁」）：进行中的状态提示由通用 loading 全屏承担。
        this.upgradeLabel.string = upgradeButtonText(data.level, false);
        if (this.hasRenderedStatus && data.phase === 'loading') return;
        this.matCardCountLabel.string = '';
        this.matCardItemLabel.string = '';
        this.matExpCountLabel.string = '';
        this.matExpItemLabel.string = '';
        this.matCardIcon.spriteFrame = null;
        this.matExpIcon.spriteFrame = null;
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
        const texts = CARD_LINEUP_TEXTS;
        this.nameLabel.string = card?.name ?? data.cardId;
        if (card) {
            const lineup = data.lineup;
            const camp = lineup ? resolveCardCamp(card, lineup) : null;
            this.campTagRoot.active = camp !== null;
            if (camp && lineup) this.tagCampLabel.string = cardCampName(camp, lineup);
            this.tagClassLabel.string = lineup ? cardClassName(resolveCardClass(card, lineup), lineup) : '';
            this.qualityLabel.string = lineup ? `${cardRarityName(card.rarity, lineup)}${texts.detailQualityGrade}` : '';
        } else {
            this.campTagRoot.active = false;
            this.tagClassLabel.string = '';
            this.qualityLabel.string = '';
        }
        this.powerLabel.string = `${texts.detailPower} ${data.detail?.powerText || '--'}`;
        this.qualitySprite.spriteFrame = data.art?.diamond ?? null;
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
                // 这里**不乘** `pvpCard.prefabSize`：详情弹窗一次只展示一个兵种，没有并排对比，
                // 归一化就够了；而 Hero 区只有 365px（Header 370 高），270 基准已经占满 74%，
                // 乘 1.5 会画出 405px 顶出 Header。阵容页/布阵页那种并排场景才需要体型差。
                const preview = new CardUnitPreview(this.heroSprite, 270);
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
        const texts = CARD_LINEUP_TEXTS;
        if (!detail) {
            for (const label of this.statValueLabels().values()) label.string = '--';
            for (const label of this.statGainLabels().values()) label.string = '';
            this.levelBigLabel.string = this.levelBigLabel.string || '0';
            for (const slot of this.hexSlots) this.renderHexSlot(slot, null);
            this.milestones = [];
            this.milestoneScroll.refreshList(0);
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
        this.hexSlots.forEach((slot, index) => this.renderHexSlot(slot, detail.chain[index] ?? null));
        this.milestones = detail.milestones;
        // 可见行会重新测量高度，原位刷新以保留节点和阅读位置。
        this.milestoneScroll.refreshList(this.milestones.length);
    }

    private renderHexSlot(slot: CardDetailHexSlot, data: CardDetailSkillSlot | null): void {
        const texts = CARD_LINEUP_TEXTS;
        if (!data || data.empty) {
            slot.interactable = false;
            this.loadDetailFrame('hex_lock', (frame) => { if (frame) slot.hexSprite.spriteFrame = frame; });
            slot.nameLabel.string = texts.detailChainLocked;
            slot.nameLabel.color = this.idleColor;
            if (slot.badgeSprite) slot.badgeSprite.node.active = false;
            if (slot.badgeLabel) slot.badgeLabel.string = '';
            return;
        }
        slot.interactable = true;
        const art = data.unlocked ? (slot.node.name === 'Hex0' ? 'hex_counter' : 'hex_passive') : 'hex_lock';
        this.loadDetailFrame(`${art}`, (frame) => { if (frame) slot.hexSprite.spriteFrame = frame; });
        slot.nameLabel.string = data.name || texts.detailChainLocked;
        slot.nameLabel.color = data.unlocked ? slot.unlockedColor : this.idleColor;
        if (slot.badgeSprite) slot.badgeSprite.node.active = data.unlockLevel > 0;
        if (slot.badgeLabel) slot.badgeLabel.string = data.unlockLevel > 0 ? `${data.unlockLevel}` : '';
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

    /** 升级可能改变技能锁定态，旧渲染的迟到切图不能覆盖新状态。 */
    private loadDetailFrame(name: string, apply: (frame: SpriteFrame | null) => void): void {
        const scope = this.resourceScope;
        const revision = this.renderRevision;
        void loadCardDetailArt(name).then((frame) => {
            if (scope.disposed || !this.alive || revision !== this.renderRevision) return;
            apply(frame);
        }).catch(error => { if (!scope.disposed && this.alive) console.error('[CardUpgradePage] 详情切图加载失败', name, error); });
    }

    // ------------------------------------------------------------------
    // 固定底栏：原升级判定与提示语义保持不变
    // ------------------------------------------------------------------

    /** 把判定结果铺到升级面板（这是升级侧**唯一**的写 UI 入口）。 */
    private renderStatus(status: ZCUpgradeStatus, phase: CardUpgradePhase): void {
        const texts = CARD_LINEUP_TEXTS;
        this.renderMaterialIcon(this.matCardIcon, [status.requirements.find(row => row.key === 'card')?.itemId ?? '']);
        this.renderMaterialIcon(this.matExpIcon, [status.generalExpItemId, status.armyExpItemId]);
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
        //  提交中按钮文案保持常态：进行中由通用 loading 提示，不显示「升级中…」。
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

    /** 经验合计优先通用经验，未配图时取兵种经验；始终复用物品表图标。 */
    private renderMaterialIcon(sprite: Sprite, itemIds: readonly string[]): void {
        const scope = this.resourceScope;
        const revision = this.renderRevision;
        void (async () => {
            for (const id of itemIds) {
                if (!id) continue;
                const item = await itemDetailRepository.loadItemRow(Number(id));
                if (scope.disposed || !this.alive || revision !== this.renderRevision) return;
                if (!item || !item.icon) continue;
                const frame = await loadItemIconArt(item.icon);
                if (scope.disposed || !this.alive || revision !== this.renderRevision) return;
                sprite.spriteFrame = frame;
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
