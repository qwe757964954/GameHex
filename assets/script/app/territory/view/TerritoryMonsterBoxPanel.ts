/**
 * 「巡逻宝箱」弹窗 —— 领地地图上野怪宝箱格的详情与升级入口面板。
 *
 * 三态（设计稿左中右三张）：
 * - `Lv.1~3`：点阵 + 守护怪 + 奖励 + 「开始挑战 / 升级宝箱」两个按钮，**升级为主、打为次**；
 * - 升级中：点阵换成进度条（`upgrading = true`），两个按钮都不可点；
 * - 满级：点阵全实心、守护怪全部点亮，只剩「开始挑战」（`upgradeCost = 0` ⇒ 升级按钮收起来）。
 *
 * ## 只做渲染，不做业务
 *
 * 所有数字都从 {@link ITerritoryMonsterBoxContent} 进来，**脚本里一个都不推算**：
 * 消耗、成功率、失败次数上限、守护怪解锁条件、奖励区间 —— 协议目前只下发 `lv`
 * （`CmdCityChapterCellInfoRspMsg.monsterBoxInfos`），其余要等配置 / 下发。
 * 缺数据时**整块隐藏**而不是显示 0：「没有数据」和「数值是 0」在界面上必须能区分开。
 *
 * ## 结构约定（prefab 由 `TerritoryMonsterBoxPanel` 保证，别在别处复制这个约定）
 *
 * - `LevelDots`：子节点按顺序代表第 1..N 级；实心 / 空心只改 `cc.Sprite.color`，不换节点；
 * - `GuardRow/Guard_i`：每格固定三个子节点 `Icon`(cc.Sprite) / `Lock`(Node) / `UnlockLabel`(cc.Label)；
 * - `RewardSection/RewardRow`：四列虚拟列表，奖励卡复用公共 `RewardItemView`。
 */
import { _decorator, Button, Color, Label, Node, Sprite, type SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { EventMgr } from '../../../framework/event/EventMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { RewardItemView, type IRewardItemData } from '../../common/RewardItemView';
import { TerritoryUiEvent } from '../application/TerritoryEvents';
import { TERRITORY_THEME_TOKENS } from './TerritoryTheme';

const { ccclass, property } = _decorator;

/** 一个守护怪格：头像 + 是否已解锁 + 解锁条件文案。 */
export interface ITerritoryMonsterBoxGuard {
    readonly icon: SpriteFrame | null;
    readonly unlocked: boolean;
    /** 解锁条件（如「4 级解锁」）；空串 = 整行隐藏。 */
    readonly unlockText: string;
}

/** 弹窗内容。字段缺省（`0` / 空数组 / `null`）一律解释为「没有这项数据」，UI 自动收起来。 */
export interface ITerritoryMonsterBoxContent {
    /** 这一格的格子号（协议 `monsterBoxInfos[].cellId`）：升级请求要原样带回去。 */
    readonly cellId: number;
    readonly title: string;
    /** 当前等级（协议 `monsterBoxInfos[].lv`）。 */
    readonly lv: number;
    /** 等级上限；`<= 0` ⇒ 不知道上限，点阵只画到 `lv`。 */
    readonly maxLv: number;
    /** 宝箱模型图（按 `lv` 取 `territory_monsterBox_L{N}`，由页面加载后透传）。 */
    readonly chestIcon: SpriteFrame | null;
    readonly guards: readonly ITerritoryMonsterBoxGuard[];
    readonly rewards: readonly IRewardItemData[];
    /** 升级消耗（银币）；`<= 0` ⇒ 没有升级入口（满级 / 未开放）。 */
    readonly upgradeCost: number;
    /** 消耗图标；`null` ⇒ 只显示数字。 */
    readonly costIcon: SpriteFrame | null;
    /** 成功率（百分比，`90` ⇒ 90%）；`<= 0` ⇒ 不显示。 */
    readonly successRate: number;
    /** 已失败次数；`< 0` 表示服务端未提供。 */
    readonly failCount: number;
    /** 失败次数上限；`<= 0` ⇒ 不知道上限，不判「达上限」。 */
    readonly failLimit: number;
    readonly battleCaption: string;
    readonly battleEnabled: boolean;
    /** 升级按钮文案（如「升级宝箱」）。 */
    readonly upgradeCaption: string;
    /** 底部说明（如「升级为主，打为次」/「灰怪点亮，只可打开」）；空串 = 隐藏。 */
    readonly footerText: string;
    /** 升级进度态：`true` 时点阵换成进度条，两个按钮都置灰（设计稿中间那张）。 */
    readonly upgrading?: boolean;
    /** 进度 0~1（只在 `upgrading` 时有意义）。 */
    readonly upgradeProgress?: number;
}

/** 点阵「已点亮」的颜色（设计稿：实心近黑、空心是同一字体的 ○）。 */
const DOT_ON = TERRITORY_THEME_TOKENS.dotOn;

/**
 * 按钮不可用时的压色。
 *
 * `Button.interactable = false` 只挡点击、**不改外观**（本弹窗三个按钮都是 SCALE 过渡，
 * 没有 disabled 贴图），所以「升级中按钮要看得出来不能点」得自己在 Sprite 上压一层灰。
 */
const BTN_DIM = TERRITORY_THEME_TOKENS.buttonDim;
const FAIL_LIMIT_LABEL = '失败上限';

/**
 * 巡逻宝箱弹窗。
 *
 * 与 `LevelInfoPanel` 同一套骨架（`PopupBase` + 四边 Widget + `closeOnBlank`），
 * 差别只有内容区：模型 / 点阵 / 守护怪是本弹窗独有，奖励区复用公共 `RewardItem`。
 */
@ccclass('TerritoryMonsterBoxPanel')
export class TerritoryMonsterBoxPanel extends PopupBase {
    /** 预制体路径。 */
    static prefabPath = 'ui/territory/TerritoryMonsterBoxPanel';

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/TitleLabel：标题' })
    private titleLabel: Label = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Panel/ChestModel：宝箱模型（按等级换帧）' })
    private chestSprite: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/LevelLabel：Lv.N' })
    private levelLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/DotLabel：等级指示点阵' })
    private dotLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/UpgradeProgress：升级进度（点阵的替身，upgrading 时显示）' })
    private progressRoot: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'UpgradeProgress/Bar：进度条（type=FILLED, fillType=HORIZONTAL）' })
    private progressBar: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'UpgradeProgress/Percent：进度数字' })
    private progressLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/GuardRow：守护怪容器（每格 Icon/Lock/UnlockLabel）' })
    private guardRoot: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/RewardSection：奖励说明、底板与列表' })
    private rewardSection: Node = null!;

    @property({ type: VirtualScrollView, group: '节点引用', tooltip: 'RewardSection/RewardRow：四列奖励卡' })
    private rewardList: VirtualScrollView = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/CloseBtn：关闭' })
    private closeButton: Button = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnBattle：开始挑战' })
    private battleButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnBattle/Label：按钮文案' })
    private battleLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnUpgrade：升级宝箱' })
    private upgradeButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnUpgrade/Label：按钮文案' })
    private upgradeLabel: Label = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'BtnUpgrade/CostIcon：消耗图标' })
    private costIcon: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnUpgrade/CostLabel：消耗数字' })
    private costLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnUpgrade/RateLabel：成功率' })
    private rateLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/FailLabel：失败次数' })
    private failLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/FooterLabel：底部说明' })
    private footerLabel: Label = null!;

    /** 本趟奖励（ 按下标现取，别在回调里闭包捕获某一趟的数据）。 */
    private rewards: readonly IRewardItemData[] = [];

    /** 当前内容，供按钮回调读「这一格是哪一格」。 */
    private content: ITerritoryMonsterBoxContent | null = null;

    /** 两个按钮并排时「开始挑战」的初始 x；满级只剩一个按钮时回到 0 居中（见 `renderButtons`）。 */
    private battleHomeX = 0;

    /** 两个按钮的常态颜色（预制体里 Start 是白、Upgrade 是白，靠贴图本身区分蓝/金），置灰后要还原。 */
    private battleTint = new Color(255, 255, 255, 255);
    private upgradeTint = new Color(255, 255, 255, 255);

    protected onInit(): void {
        this.battleHomeX = this.battleButton.node.position.x;
        const battleSprite = this.battleButton.node.getComponent(Sprite);
        if (battleSprite) this.battleTint = battleSprite.color.clone();
        const upgradeSprite = this.upgradeButton.node.getComponent(Sprite);
        if (upgradeSprite) this.upgradeTint = upgradeSprite.color.clone();
        // 奖励卡会被列表复用，渲染时按下标读取当前数据。
        this.rewardList.renderItemFn = this.renderRewardItem;
        this.battleButton.node.on(Button.EventType.CLICK, this.handleBattle, this);
        this.upgradeButton.node.on(Button.EventType.CLICK, this.handleUpgrade, this);
        this.closeButton.node.on(Button.EventType.CLICK, this.closeByButton, this);
    }

    protected onOpen(userData?: unknown): void {
        if (userData) this.applyContent(userData as ITerritoryMonsterBoxContent);
    }

    /**
     * 面板已开着时换内容（`PopupManager` 对同类弹窗单实例去重，点另一格不会再走 `onOpen`）。
     */
    applyContent(content: ITerritoryMonsterBoxContent): void {
        this.content = content;
        this.titleLabel.string = content.title;
        this.levelLabel.string = content.lv > 0 ? `Lv.${content.lv}` : '';
        // 升级中：这一行让位给进度条（两者在 prefab 里是同一位置），别叠着画
        this.levelLabel.node.active = content.lv > 0 && content.upgrading !== true;

        this.chestSprite.spriteFrame = content.chestIcon;
        this.chestSprite.node.active = content.chestIcon !== null;

        this.renderLevelDots(content);
        this.renderGuards(content);
        this.renderRewards(content);
        this.renderButtons(content);

        this.footerLabel.string = content.footerText;
        this.footerLabel.node.active = content.footerText !== '';
    }

    /** 点阵：前 `lv` 个实心、之后空心；`maxLv` 未知时只画到 `lv`（上限 10 个防撑宽）。 */
    private renderLevelDots(content: ITerritoryMonsterBoxContent): void {
        const total = Math.min(content.maxLv > 0 ? content.maxLv : content.lv, 10);
        const dots: string[] = [];
        for (let index = 0; index < total; index += 1) dots.push(index < content.lv ? '●' : '○');
        this.dotLabel.string = dots.join(' ');
        this.dotLabel.node.active = dots.length > 0;
        this.dotLabel.color = DOT_ON;

        this.dotLabel.node.active = dots.length > 0 && content.upgrading !== true;
        this.progressRoot.active = content.upgrading === true;
        if (content.upgrading === true) {
            const progress = Math.max(0, Math.min(1, Number(content.upgradeProgress) || 0));
            this.progressBar.fillRange = progress;
            this.progressLabel.string = `${Math.round(progress * 100)}%`;
        }
    }

    /** 守护怪：按 `guards` 逐格点亮；锁与解锁文案跟着格子走，多出来的格子隐藏。 */
    private renderGuards(content: ITerritoryMonsterBoxContent): void {
        const cells = this.guardRoot.children;
        for (let index = 0; index < cells.length; index += 1) {
            const cell = cells[index];
            const guard = content.guards[index];
            cell.active = guard !== undefined;
            if (!guard) continue;
            const icon = cell.getChildByName('Icon')?.getComponent(Sprite);
            if (icon) {
                // 有图才覆盖：`guard.icon` 为 null 时**保留 prefab 里的占位图**。
                // 直接赋 null 会把格子清成空框 —— 那和「未解锁」长得一样，玩家分不清。
                if (guard.icon) icon.spriteFrame = guard.icon;
                icon.node.active = true;
                icon.color = guard.unlocked ? Color.WHITE : TERRITORY_THEME_TOKENS.guardLockedDim;
            }
            const lock = cell.getChildByName('Lock');
            if (lock) lock.active = !guard.unlocked;
            const label = cell.getChildByName('UnlockLabel')?.getComponent(Label);
            if (label) {
                label.string = guard.unlockText;
                label.node.active = guard.unlockText !== '';
            }
        }
        // 一格都没有 ⇒ 整块收起来，别留一个空标题占位
        this.guardRoot.active = content.guards.length > 0;
    }

    /**
     * 奖励卡的列数、间距与模板由 prefab 配置。
     *
     * 与「宝箱详情」`ChestDetailPanel` 同一套：同一个 `resId` 的多档已在 Model 合并成一格
     * （见 `mergeRewardsByResId`），所以条数 = 资源种类数，不是掉落池行数。
     */
    private renderRewards(content: ITerritoryMonsterBoxContent): void {
        this.rewards = content.rewards;
        this.rewardSection.active = content.rewards.length > 0;
        this.rewardList.setTotalCount(content.rewards.length);
    }

    /**
     * 列表条目渲染（槽位池化复用，全量赋值防状态残留）。
     */
    private readonly renderRewardItem = (item: Node, index: number): void => {
        const data = this.rewards[index];
        if (!data) return;
        item.getComponent(RewardItemView).render(data);
    };

    /** 按可用性给按钮上色：不能用时压成灰色（`interactable` 本身不改外观）。 */
    private tintButton(button: Button, normal: Color, usable: boolean): void {
        const sprite = button.node.getComponent(Sprite);
        if (sprite) sprite.color = usable ? normal : BTN_DIM;
    }

    private renderButtons(content: ITerritoryMonsterBoxContent): void {
        this.battleLabel.string = content.battleCaption;
        const battleUsable = content.battleEnabled && content.upgrading !== true;
        this.battleButton.interactable = battleUsable;
        this.tintButton(this.battleButton, this.battleTint, battleUsable);

        // 满级 / 未开放 ⇒ 没有升级入口：整块收起来，不留一个灰按钮
        const hasUpgrade = content.upgradeCost > 0 || content.upgrading === true;
        this.upgradeButton.node.active = hasUpgrade;
        // 只剩「开始挑战」时回到中线，别留半个空位（设计稿满级那张是单个通栏按钮）
        this.battleButton.node.setPosition(
            hasUpgrade ? this.battleHomeX : 0,
            this.battleButton.node.position.y,
        );
        if (!hasUpgrade) {
            this.failLabel.node.active = false;
            return;
        }
        const reachedLimit = content.failLimit > 0 && content.failCount >= content.failLimit;
        this.upgradeLabel.string = content.upgradeCaption;
        const upgradeUsable = content.upgrading !== true && !reachedLimit;
        this.upgradeButton.interactable = upgradeUsable;
        this.tintButton(this.upgradeButton, this.upgradeTint, upgradeUsable);

        const hasCost = content.upgradeCost > 0;
        this.costLabel.string = hasCost ? String(Math.round(content.upgradeCost)) : '';
        this.costLabel.node.active = hasCost;
        this.costIcon.spriteFrame = content.costIcon;
        this.costIcon.node.active = hasCost && content.costIcon !== null;

        const hasRate = content.successRate > 0;
        this.rateLabel.string = hasRate ? `${Math.round(content.successRate)}%` : '';
        this.rateLabel.node.active = hasRate;

        const hasFailCount = content.failCount >= 0;
        const hasFailLimit = content.failLimit > 0;
        this.failLabel.node.active = hasFailCount || hasFailLimit;
        if (hasFailCount) {
            this.failLabel.string = hasFailLimit
                ? `失败次数：${content.failCount} / ${content.failLimit}`
                : `失败次数：${content.failCount}`;
        } else {
            this.failLabel.string = hasFailLimit ? `${FAIL_LIMIT_LABEL}：${content.failLimit} 次` : '';
        }
    }

    /** 单格渲染 —— 下标现取，槽位复用不会拿到上一趟的数据。 */
    protected onClose(): void {
        // Presenter 靠这条清 `detailSite`（页面订阅后调 closeDetail，幂等）
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'closeDetail' } });
    }

    private handleBattle(): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'battle' } });
    }

    private handleUpgrade(): void {
        const cellId = this.content?.cellId ?? 0;
        if (cellId <= 0) return;
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'upgradeMonsterBox', cellId } });
    }
}
