/**
 * 「巡逻宝箱」弹窗 —— 领地地图上**野怪宝箱格**的详情 / 升级入口（设计稿 2026-11-19）。
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
 * - `RewardList`：`VirtualScrollView` + 公共 `RewardItem`，3 列（设计稿 4 个刚好一行）。
 */
import { _decorator, Button, Color, Label, Node, Sprite, type SpriteFrame } from 'cc';
import { EventMgr } from '../../../framework/event/EventMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { RewardItemView, type IRewardItemData } from '../../common/RewardItemView';
import { TerritoryUiEvent } from '../application/TerritoryEvents';

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
    /** 宝箱模型图（按 `lv` 取 `image/main/chest/boxLevel{N}`，由页面加载后透传）。 */
    readonly chestIcon: SpriteFrame | null;
    readonly guards: readonly ITerritoryMonsterBoxGuard[];
    readonly rewards: readonly IRewardItemData[];
    /** 升级消耗（银币）；`<= 0` ⇒ 没有升级入口（满级 / 未开放）。 */
    readonly upgradeCost: number;
    /** 消耗图标；`null` ⇒ 只显示数字。 */
    readonly costIcon: SpriteFrame | null;
    /** 成功率（百分比，`90` ⇒ 90%）；`<= 0` ⇒ 不显示。 */
    readonly successRate: number;
    /** 已失败次数；`< 0` ⇒ 不显示这一行。 */
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
const DOT_ON = new Color(58, 36, 16, 255);

/**
 * 巡逻宝箱弹窗。
 *
 * 与 `LevelInfoPanel` 同一套骨架（`PopupBase` + 四边 Widget + `closeOnBlank`），
 * 差别只有内容区：模型 / 点阵 / 守护怪是本弹窗独有，奖励区复用公共 `RewardItem`。
 */
@ccclass('TerritoryMonsterBoxPanel')
export class TerritoryMonsterBoxPanel extends PopupBase {
    /** ⚠️ 目录名必须与磁盘一致（`assets/resources/ui/territory/`）。 */
    static prefabPath = 'ui/territory/TerritoryMonsterBoxPanel';

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/TitleLabel：标题' })
    private titleLabel: Label = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Panel/ChestModel：宝箱模型（按等级换帧）' })
    private chestSprite: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/LevelLabel：Lv.N' })
    private levelLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/DotLabel：等级点阵（●●○○ 由脚本拼）' })
    private dotLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/UpgradeProgress：升级进度（点阵的替身，upgrading 时显示）' })
    private progressRoot: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'UpgradeProgress/Bar：进度条（type=FILLED, fillType=HORIZONTAL）' })
    private progressBar: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'UpgradeProgress/Percent：进度数字' })
    private progressLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/GuardRow：守护怪容器（每格 Icon/Lock/UnlockLabel）' })
    private guardRoot: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/RewardRow：奖励格容器（子节点挂 RewardItemView，按顺序填）' })
    private rewardRoot: Node = null!;

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

    /** 当前内容，供按钮回调读「这一格是哪一格」。 */
    private content: ITerritoryMonsterBoxContent | null = null;

    protected onInit(): void {
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
                icon.spriteFrame = guard.icon;
                icon.color = guard.unlocked ? Color.WHITE : new Color(255, 255, 255, 96);
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
     * 奖励：固定槽位（设计稿 4 格），每格挂公共 `RewardItemView`。
     *
     * 不用 `VirtualScrollView`：这里最多 4 格、永不滚动，虚拟列表只会多一层
     * 看不到的复杂度（槽位池 / 回收残影）。要加格数就加节点，脚本按 `children` 顺序填。
     */
    private renderRewards(content: ITerritoryMonsterBoxContent): void {
        const slots = this.rewardRoot.children;
        for (let index = 0; index < slots.length; index += 1) {
            const slot = slots[index];
            const data = content.rewards[index];
            slot.active = data !== undefined;
            if (!data) continue;
            slot.getComponent(RewardItemView).render(data);
        }
        this.rewardRoot.active = content.rewards.length > 0;
    }

    private renderButtons(content: ITerritoryMonsterBoxContent): void {
        this.battleLabel.string = content.battleCaption;
        this.battleButton.interactable = content.battleEnabled && content.upgrading !== true;

        // 满级 / 未开放 ⇒ 没有升级入口：整块收起来，不留一个灰按钮
        const hasUpgrade = content.upgradeCost > 0 || content.upgrading === true;
        this.upgradeButton.node.active = hasUpgrade;
        if (!hasUpgrade) {
            this.failLabel.node.active = false;
            return;
        }
        const reachedLimit = content.failLimit > 0 && content.failCount >= content.failLimit;
        this.upgradeLabel.string = content.upgradeCaption;
        this.upgradeButton.interactable = content.upgrading !== true && !reachedLimit;

        const hasCost = content.upgradeCost > 0;
        this.costLabel.string = hasCost ? String(Math.round(content.upgradeCost)) : '';
        this.costLabel.node.active = hasCost;
        this.costIcon.spriteFrame = content.costIcon;
        this.costIcon.node.active = hasCost && content.costIcon !== null;

        const hasRate = content.successRate > 0;
        this.rateLabel.string = hasRate ? `${Math.round(content.successRate)}%` : '';
        this.rateLabel.node.active = hasRate;

        const hasFail = content.failCount >= 0;
        this.failLabel.node.active = hasFail;
        this.failLabel.string = hasFail
            ? (content.failLimit > 0
                ? `失败次数：${content.failCount} / ${content.failLimit}`
                : `失败次数：${content.failCount}`)
            : '';
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
