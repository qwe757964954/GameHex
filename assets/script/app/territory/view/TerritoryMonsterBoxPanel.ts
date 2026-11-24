/**
 * 「巡逻宝箱」弹窗 —— 领地地图上野怪宝箱格的详情与升级入口面板。
 *
 * 三态（设计稿左中右三张）：
 * - `Lv.1~3`：等级星 + 守护怪 + 奖励 + 「开始挑战 / 升级宝箱」两个按钮，**升级为主、打为次**；
 * - 升级中：等级星换成进度条（`upgrading = true`），两个按钮都不可点；
 * - 满级：等级星全亮、守护怪全部点亮，只剩「开始挑战」（`upgradeCost = 0` ⇒ 升级按钮收起来）。
 *
 * ## 只做渲染，不做业务
 *
 * 所有数字都从 {@link ITerritoryMonsterBoxContent} 进来，**脚本里一个都不推算**：
 * 消耗、成功率、失败次数上限、守护怪解锁条件、奖励区间 —— 协议目前只下发 `lv`
 * （`CmdCityChapterCellInfoRspMsg.monsterBoxInfos`），其余要等配置 / 下发。
 * 缺数据时**整块隐藏**而不是显示 0：「没有数据」和「数值是 0」在界面上必须能区分开。
 *
 * ## 升级摇奖动画（2026-11-22）
 *
 * 点「升级宝箱」→ 等级星让位给进度条：**绿色占比 = 成功率**、其余灰底，
 * 一根黄色竖条在条上来回滑，**停在绿区 = 成功、停在灰区 = 失败**，整条 2.2s。
 * 曲线（含迟到的回包怎么处理）全在 `model/TerritoryMonsterBoxRoll`（零 `cc`、可单测）；
 * 这里只做三件事：把姿态写进 `fillRange` / 黄条坐标、收尾重绘、给黄条上色。
 *
 * 动画从**点击**起演（玩家立刻看到反馈），落点等回包：`upgradeAttempt.seq` 比开演时更大
 * 才算这一轮的结果 —— 换格子 / 连点 / 重开弹窗都不会重放旧结果。
 *
 * ## 结构约定（prefab 由 `TerritoryMonsterBoxPanel` 保证，别在别处复制这个约定）
 *
 * - `LevelStars`：子节点 `StarOn_i` / `StarOff_i` 按 1..N 级叠放，按 `lv` 显隐，不换帧；
 * - `GuardRow/Guard_i`：每格固定子节点 `CardBg` / `LockBg` / `Icon`(cc.Sprite) / `Lock`(Node) / `UnlockLabel`(cc.Label)；
 * - `RewardSection/RewardRow`：四列虚拟列表，奖励卡复用公共 `RewardItemView`；
 * - `UpgradeProgress`：等级行的替身（同一行），`BarBg` 灰底 / `Bar` 绿色填充 / `Percent` 成功率文字 / `RollMarker` 摇奖黄条指针。
 */
import { _decorator, Button, Color, Label, Node, Sprite, Tween, tween, UITransform, Vec3, type SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { EventMgr } from '../../../framework/event/EventMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { RewardItemView, type IRewardItemData } from '../../common/RewardItemView';
import { TerritoryUiEvent } from '../application/TerritoryEvents';
import type { ITerritoryMonsterBoxAttempt } from '../model/TerritoryMonsterBoxDetail';
import { monsterBoxRollPose, type ITerritoryMonsterBoxRollPose } from '../model/TerritoryMonsterBoxRoll';
import { TERRITORY_THEME_TOKENS } from './TerritoryTheme';
import { TerritoryMonsterBoxGuardSlot, type ITerritoryMonsterBoxGuard } from './TerritoryMonsterBoxGuardSlot';

export type { ITerritoryMonsterBoxGuard };

const { ccclass, property } = _decorator;

/** 弹窗内容。字段缺省（`0` / 空数组 / `null`）一律解释为「没有这项数据」，UI 自动收起来。 */
export interface ITerritoryMonsterBoxContent {
    /** 这一格的格子号（协议 `monsterBoxInfos[].cellId`）：升级请求要原样带回去。 */
    readonly cellId: number;
    readonly title: string;
    /** 当前等级（协议 `monsterBoxInfos[].lv`）。 */
    readonly lv: number;
    /** 等级上限；`<= 0` ⇒ 不知道上限，等级星只画到 `lv`。 */
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
    /** 升级进度态：`true` 时等级星换成进度条，两个按钮都置灰（设计稿中间那张）。 */
    readonly upgrading?: boolean;
    /** 进度 0~1（只在 `upgrading` 时有意义）。 */
    readonly upgradeProgress?: number;
    /** 最近一次升级摇奖的结果（决定黄条停在绿区还是灰区）；缺省 = 还没摇过。 */
    readonly upgradeAttempt?: ITerritoryMonsterBoxAttempt | null;
}

/**
 * 按钮不可用时的压色。
 *
 * `Button.interactable = false` 只挡点击、**不改外观**（本弹窗三个按钮都是 SCALE 过渡，
 * 没有 disabled 贴图），所以「升级中按钮要看得出来不能点」得自己在 Sprite 上压一层灰。
 */
const BTN_DIM = TERRITORY_THEME_TOKENS.buttonDim;
const FAIL_LIMIT_LABEL = '失败上限';

/**
 * 摇奖黄条（指针）的尺寸。
 *
 * 宽 6 搭配顶部箭头 ▼ 形成清晰指针；高度 26 覆盖进度条主体。
 */
const ROLL_MARKER_WIDTH = 6;
const ROLL_MARKER_HEIGHT = 26;

/** 升级摇奖的播放状态（只在视图里活，不进 Model）。 */
interface IMonsterBoxRollPlayback {
    /** 正在演哪一格（回包要认格子）。 */
    readonly cellId: number;
    /** 开演时已经收到的 attempt 序号：只有**更大**的才算这一轮的结果。 */
    readonly fromSeq: number;
    /** 成功率 0~1。 */
    readonly rate: number;
    /** 开演时刻（`performance.now()`，毫秒）。 */
    readonly startedAt: number;
    /** 结果到达时刻（秒，相对开演）；`null` = 还没回来。 */
    resultAt: number | null;
    success: boolean | null;
}

/**
 * 巡逻宝箱弹窗。
 *
 * 与 `LevelInfoPanel` 同一套骨架（`PopupBase` + 四边 Widget + `closeOnBlank`），
 * 差别只有内容区：模型 / 等级星 / 守护怪是本弹窗独有，奖励区复用公共 `RewardItem`。
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

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/LevelStars：等级星容器（忙时整体隐藏）' })
    private levelStars: Node = null!;

    @property({ type: [Sprite], group: '节点引用', tooltip: 'LevelStars/StarOn_i：已点亮星（按 1..N 级顺序）' })
    private starOn: Sprite[] = [];

    @property({ type: [Sprite], group: '节点引用', tooltip: 'LevelStars/StarOff_i：未点亮星（按 1..N 级顺序）' })
    private starOff: Sprite[] = [];

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/UpgradeProgress：升级进度（等级星的替身，upgrading 时显示）' })
    private progressRoot: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'UpgradeProgress/Bar：进度条（type=FILLED, fillType=HORIZONTAL）' })
    private progressBar: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'UpgradeProgress/Percent：进度数字' })
    private progressLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/GuardRow：守护怪容器（每格 CardBg/LockBg/Icon/Lock/UnlockLabel）' })
    private guardRoot: Node = null!;

    @property({ type: [TerritoryMonsterBoxGuardSlot], group: '节点引用', tooltip: 'Panel/GuardRow：守护怪格列表（每格独立绑定头像/锁/解锁文案）' })
    private guardSlots: TerritoryMonsterBoxGuardSlot[] = [];

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

    @property({ type: Label, group: '节点引用', tooltip: 'BtnUpgrade/RateGroup/RateLabel：成功率' })
    private rateLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnUpgrade/RateGroup：成功率整块（底色 + 数字 + 说明）' })
    private rateGroup: Node = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/FailLabel：失败次数' })
    private failLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/FooterLabel：底部说明（可选）' })
    private footerLabel: Label | null = null;

    @property({ type: Node, group: '节点引用', tooltip: 'UpgradeProgress/RollMarker：摇奖黄条指针' })
    private rollMarker: Node = null!;

    /** 本趟奖励（ 按下标现取，别在回调里闭包捕获某一趟的数据）。 */
    private rewards: readonly IRewardItemData[] = [];

    /** 当前内容，供按钮回调读「这一格是哪一格」。 */
    private content: ITerritoryMonsterBoxContent | null = null;

    /**
     * 正在演的升级摇奖；`null` = 没在演。
     *
     * 演的时候**不接整块重绘**（回包会带来新等级，重绘会把进度条拆掉换回等级星）：
     * 内容先落到 {@link pendingContent}，演完再一次性重绘。
     */
    private roll: IMonsterBoxRollPlayback | null = null;

    /** 演摇奖期间收到的最新内容；演完用它收尾重绘。 */
    private pendingContent: ITerritoryMonsterBoxContent | null = null;

    /** 黄条可滑动的跨度（条宽 − 黄条宽）与黄条自身宽度：开演时量一次，别每帧查组件。 */
    private rollSpan = 0;

    /** 两个按钮并排时「开始挑战」的初始 x；满级只剩一个按钮时回到 0 居中（见 `renderButtons`）。 */
    private battleHomeX = 0;

    /** 宝箱常态 y 坐标，动画后复位。 */
    private chestHomeY = 260.475;

    /** 按钮精灵（onInit 缓存，避免每次渲染查组件）。 */
    private battleSprite: Sprite = null!;
    private upgradeSprite: Sprite = null!;

    /** 两个按钮的常态颜色（预制体里 Start 是白、Upgrade 是白，靠贴图本身区分蓝/金），置灰后要还原。 */
    private battleTint = new Color(255, 255, 255, 255);
    private upgradeTint = new Color(255, 255, 255, 255);

    protected onInit(): void {
        this.battleHomeX = this.battleButton.node.position.x;
        this.chestHomeY = this.chestSprite.node.position.y;
        this.battleSprite = this.battleButton.node.getComponent(Sprite);
        this.battleTint = this.battleSprite.color.clone();
        this.upgradeSprite = this.upgradeButton.node.getComponent(Sprite);
        this.upgradeTint = this.upgradeSprite.color.clone();
        this.rollMarker.active = false;
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
        const roll = this.roll;
        if (roll) {
            // 演到一半玩家点了别的格子 ⇒ 立即收掉摇奖，换成新格子的内容
            // （留着会「标题是新格子、进度条还在演上一格」，2.2s 后才对齐）
            if (content.cellId !== roll.cellId) {
                this.roll = null;
                this.pendingContent = null;
                this.renderContent(content);
                return;
            }
            // 演动画期间只记最新内容 + 认结果，绝不重绘（重绘会把进度条换回等级星）
            this.pendingContent = content;
            this.bindRollResult(roll, content.upgradeAttempt ?? null);
            return;
        }
        this.renderContent(content);
    }

    /**
     * 收下这一次摇奖的结果。
     *
     * 三个条件缺一不可：同一格、状态还没定、序号比开演时大。
     * 少了序号判断，玩家「失败 → 再点一次」时，上一轮的 `attempt` 还在内容里，
     * 新一圈动画会**立刻**以旧结果落定（观感是「点了没演就失败」）。
     */
    private bindRollResult(roll: IMonsterBoxRollPlayback, attempt: ITerritoryMonsterBoxAttempt | null): void {
        if (!attempt || roll.success !== null) return;
        if (attempt.cellId !== roll.cellId || attempt.seq <= roll.fromSeq) return;
        roll.success = attempt.success;
        roll.resultAt = (performance.now() - roll.startedAt) / 1000;
    }

    /**
     * 只做一件事：把这一帧的摇奖姿态写进节点。
     *
     * 曲线在 `TerritoryMonsterBoxRoll`（纯函数、有用例），这里不判断「该不该成功」。
     * `update` 里不建节点、不加载资源、不查配置。
     */
    update(): void {
        const roll = this.roll;
        if (!roll) return;
        const elapsed = (performance.now() - roll.startedAt) / 1000;
        const pose = monsterBoxRollPose({ elapsed, rate: roll.rate, success: roll.success, resultAt: roll.resultAt });
        this.applyRollPose(pose);
        if (pose.finished) this.finishRoll();
    }

    /** 整块重绘（幂等、全量赋值）；摇奖播放期间不会走到这里。 */
    private renderContent(content: ITerritoryMonsterBoxContent): void {
        this.titleLabel.string = content.title;
        this.levelLabel.string = content.lv > 0 ? `Lv.${content.lv}` : '';
        // 升级中：这一行让位给进度条（两者在 prefab 里是同一位置），别叠着画
        this.levelLabel.node.active = content.lv > 0 && content.upgrading !== true && this.roll === null;

        this.chestSprite.spriteFrame = content.chestIcon;
        this.chestSprite.node.active = content.chestIcon !== null;

        this.renderLevelDots(content);
        this.renderGuards(content);
        this.renderRewards(content);
        this.renderButtons(content);

        if (this.footerLabel && this.footerLabel.node) {
            this.footerLabel.string = content.footerText;
            this.footerLabel.node.active = content.footerText !== '';
        }
    }

    /** 等级星 / 进度条二选一：摇奖期间由进度条占位（`upgrading` 是服务端下发的另一条路，两者都按「忙」处理）。 */
    private renderLevelDots(content: ITerritoryMonsterBoxContent): void {
        // 星数 = 上限；不知道上限时只画到当前等级。prefab 只有 4 颗，多出来的等级不补星。
        const count = Math.min(this.starOn.length, this.starOff.length);
        const total = Math.min(content.maxLv > 0 ? content.maxLv : content.lv, count);
        for (let index = 0; index < count; index += 1) {
            const inRange = index < total;
            const filled = inRange && index < content.lv;
            this.starOn[index].node.active = filled;
            this.starOff[index].node.active = inRange && !filled;
        }

        const busy = this.roll !== null || content.upgrading === true;
        this.levelStars.active = total > 0 && !busy;
        this.progressRoot.active = busy;
        this.rollMarker.active = this.roll !== null;
        if (content.upgrading === true && this.roll === null) {
            // 没有本地摇奖时的兜底（例如别处推来的进度）：静态显示服务端给的比例
            const progress = Math.max(0, Math.min(1, Number(content.upgradeProgress) || 0));
            this.progressBar.fillRange = progress;
            this.progressLabel.string = `成功率：${Math.round(progress * 100)}%`;
        }
    }

    /** 守护怪：按 guardSlots 逐格渲染；锁与解锁文案由格组件自治，多出来的格子隐藏。 */
    private renderGuards(content: ITerritoryMonsterBoxContent): void {
        const guards = content.guards;
        const slots = this.guardSlots;
        if (slots) {
            for (let index = 0; index < slots.length; index += 1) {
                slots[index].render(guards[index]);
            }
        }
        // 一格都没有 ⇒ 整块收起来，别留一个空标题占位
        this.guardRoot.active = guards.length > 0;
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
    private tintButton(sprite: Sprite, normal: Color, usable: boolean): void {
        sprite.color = usable ? normal : BTN_DIM;
    }

    private renderButtons(content: ITerritoryMonsterBoxContent): void {
        // 摇奖动画也算「忙」：回包到了动画还在演，按钮不能提前解禁
        const busy = content.upgrading === true || this.roll !== null;
        this.battleLabel.string = content.battleCaption;
        const battleUsable = content.battleEnabled && !busy;
        this.battleButton.interactable = battleUsable;
        this.tintButton(this.battleSprite, this.battleTint, battleUsable);

        // 满级 / 未开放 ⇒ 没有升级入口：整块收起来，不留一个灰按钮
        const hasUpgrade = content.upgradeCost > 0 || content.upgrading === true || this.roll !== null;
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
        this.upgradeLabel.string = content.upgradeCaption;
        const upgradeUsable = !busy && content.upgradeCost > 0;
        this.upgradeButton.interactable = upgradeUsable;
        this.tintButton(this.upgradeSprite, this.upgradeTint, upgradeUsable);

        const hasCost = content.upgradeCost > 0;
        this.costLabel.string = hasCost ? String(Math.round(content.upgradeCost)) : '';
        this.costLabel.node.active = hasCost;
        this.costIcon.spriteFrame = content.costIcon;
        this.costIcon.node.active = hasCost && content.costIcon !== null;

        const hasRate = content.successRate > 0;
        this.rateGroup.active = hasRate;
        this.rateLabel.string = hasRate ? `${Math.round(content.successRate)}%` : '';

        const hasFailCount = content.failCount >= 0;
        const hasFailLimit = content.failLimit > 0;
        this.failLabel.node.active = hasFailCount || hasFailLimit;
        if (hasFailCount) {
            this.failLabel.string = hasFailLimit
                ? `失败次数：${Math.min(content.failCount, content.failLimit)} / ${content.failLimit}`
                : `失败次数：${content.failCount}`;
        } else {
            this.failLabel.string = hasFailLimit ? `${FAIL_LIMIT_LABEL}：${content.failLimit} 次` : '';
        }
    }

    /** 单格渲染 —— 下标现取，槽位复用不会拿到上一趟的数据。 */
    protected onClose(): void {
        // 演到一半被关掉：状态丢掉即可（面板关了就没人看；下次开重新算）
        this.roll = null;
        this.pendingContent = null;
        this.rollMarker.active = false;
        Tween.stopAllByTarget(this.chestSprite.node);
        this.chestSprite.node.setScale(Vec3.ONE);
        this.chestSprite.node.setPosition(0, this.chestHomeY, 0);
        // Presenter 靠这条清 `detailSite`（页面订阅后调 closeDetail，幂等）
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'closeDetail' } });
    }

    private handleBattle(): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'battle' } });
    }

    /**
     * 点「升级宝箱」：**先起演，再发请求**。
     *
     * 先起演是为了「点下去立刻有反馈」，不等网络；落点等回包（`applyContent` 里认）。
     * 演的过程中禁止再点（`this.roll` 非空即返回），否则两次请求的动画会叠在一起。
     */
    private handleUpgrade(): void {
        const content = this.content;
        const cellId = content?.cellId ?? 0;
        if (!content || cellId <= 0 || this.roll) return;
        this.startRoll(content);
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'upgradeMonsterBox', cellId } });
    }

    /** 起演：等级星让位 → 进度条上屏（绿 = 成功率）→ 黄条摆到起点。 */
    private startRoll(content: ITerritoryMonsterBoxContent): void {
        const rate = Math.max(0, Math.min(100, Number(content.successRate) || 0)) / 100;
        this.roll = {
            cellId: content.cellId,
            fromSeq: content.upgradeAttempt?.seq ?? 0,
            rate,
            startedAt: performance.now(),
            resultAt: null,
            success: null,
        };
        this.pendingContent = null;
        this.levelLabel.node.active = false;
        this.levelStars.active = false;
        this.rollMarker.active = true;
        this.rollSpan = this.measureRollSpan();
        this.progressLabel.string = `成功率：${Math.round(rate * 100)}%`;
        // 起手就摆好第一帧：`renderLevelDots` 之后进度条才 active，早一帧摆位避免闪烁
        this.renderLevelDots(content);
        this.renderButtons(content);
        this.applyRollPose(monsterBoxRollPose({ elapsed: 0, rate, success: null, resultAt: null }));
    }

    /** 收尾：清播放态 → 用最新内容整块重绘（等级星回到新等级、按钮解禁）。 */
    private finishRoll(): void {
        const wasSuccess = this.roll?.success === true || (this.pendingContent !== null && this.content !== null && this.pendingContent.lv > this.content.lv);
        const wasFail = this.roll?.success === false;
        this.roll = null;
        this.rollMarker.active = false;
        const content = this.pendingContent ?? this.content;
        this.pendingContent = null;
        if (content) this.renderContent(content);
        if (wasSuccess) {
            this.playChestSuccessBounce();
        } else if (wasFail) {
            this.playChestFailShake();
        }
    }

    /** 升级成功：宝箱 Q 弹跳动回馈。 */
    private playChestSuccessBounce(): void {
        const node = this.chestSprite.node;
        Tween.stopAllByTarget(node);
        node.setScale(Vec3.ONE);
        node.setPosition(0, this.chestHomeY, 0);
        tween(node)
            .to(0.1, { scale: new Vec3(0.92, 0.88, 1) }, { easing: 'quadOut' })
            .to(0.18, { scale: new Vec3(1.18, 1.22, 1) }, { easing: 'backOut' })
            .to(0.14, { scale: new Vec3(0.98, 0.98, 1) }, { easing: 'quadInOut' })
            .to(0.1, { scale: Vec3.ONE }, { easing: 'sineOut' })
            .start();
    }

    /** 升级失败：宝箱左右晃动回馈。 */
    private playChestFailShake(): void {
        const node = this.chestSprite.node;
        Tween.stopAllByTarget(node);
        node.setScale(Vec3.ONE);
        const y = this.chestHomeY;
        node.setPosition(0, y, 0);
        tween(node)
            .to(0.04, { position: new Vec3(-6, y, 0) })
            .to(0.06, { position: new Vec3(6, y, 0) })
            .to(0.05, { position: new Vec3(-4, y, 0) })
            .to(0.05, { position: new Vec3(4, y, 0) })
            .to(0.04, { position: new Vec3(0, y, 0) })
            .start();
    }

    /** 黄条可滑动跨度：条宽 − 黄条宽（两端都留半个黄条，别滑出条外）。 */
    private measureRollSpan(): number {
        const barTransform = this.progressBar.node.getComponent(UITransform);
        const width = barTransform ? barTransform.width : 0;
        return Math.max(0, width - ROLL_MARKER_WIDTH);
    }

    /** 写一帧姿态：绿条比例 + 黄条水平位置。 */
    private applyRollPose(pose: ITerritoryMonsterBoxRollPose): void {
        this.progressBar.fillRange = pose.fill;
        this.rollMarker.setPosition((pose.marker - 0.5) * this.rollSpan, 0);
    }
}
