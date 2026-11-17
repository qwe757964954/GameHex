/**
 * 联盟主页。六个入口按 LEAGUE_ENTRANCES 接事件，底部信息条读 myUnion。
 * 入口红点按 LEAGUE_ENTRANCE_RED_DOT_SOURCE 绝对赋值。
 */

import { _decorator, Component, Node, Label, Sprite, Button, SpriteFrame } from 'cc';
import { FW } from '../../framework/FW';
import { RedDot } from '../common/RedDot';
import { LeagueDiscountPage } from './LeagueDiscountPage';
import { LeagueDonatePage } from './LeagueDonatePage';
import { LeagueHallPage } from './LeagueHallPage';
import { LeagueStorePage } from './LeagueStorePage';
import { LeagueNorthExpeditionPage } from './LeagueNorthExpeditionPage';
import { LeagueTaskPage } from './LeagueTaskPage';
import { LEAGUE_ART_BANNER_BASE, LEAGUE_ART_BANNER_FRAME } from './LeagueArt';
import { loadLeagueBannerFrames } from './LeagueBannerArt';
import { leagueRepository, type ILeagueEntryRedDots, type ILeagueRepository } from './LeagueRepository';
import {
    LEAGUE_ENTRANCES,
    LEAGUE_ENTRANCE_RED_DOT,
    LEAGUE_ENTRANCE_RED_DOT_SOURCE,
    LEAGUE_INFO_PLACEHOLDER,
    leagueEntranceByNode,
    type ILeagueEntrance,
    type ILeagueUnionRow,
    type LeagueEntranceRedDotSource
} from './LeagueTable';
import { LEAGUE_HALL_LV_SUFFIX, LEAGUE_TIP_NOT_OPEN, LEAGUE_UNION_MEMBER_PREFIX } from './LeagueTexts';
import { openLeagueHelp } from './LeagueHelp';

const { ccclass, property } = _decorator;

/**
 * 一个入口的红点该不该亮 —— `LEAGUE_ENTRANCE_RED_DOT_SOURCE` 只有「来源名」，
 * 这层把来源名映射到**本次取回的判据**上。
 *
 * 抽成模块级纯函数（而不是写在 `applyEntranceRedDots` 里的三元）：单测可以直接喂
 * 两个 bool 把六条来源逐个过一遍，不必起引擎。
 *
 * `switch` 用 `LeagueEntranceRedDotSource` 做穷尽：以后加第 3 条判据时
 * 这里会被 `tsc` 顶出来（`case` 少一个 + 末尾 `return false` 让 TS 无法判穷尽
 * 只是兜底，真正的护栏是 `LEAGUE_ENTRANCE_RED_DOT_SOURCE` 那张完整表）。
 */
export function leagueEntranceRedDotOn(source: LeagueEntranceRedDotSource, dots: ILeagueEntryRedDots): boolean {
    switch (source) {
        case 'discount': return dots.discount;
        case 'task': return dots.task;
        case 'north': return dots.north;
        case 'none': return false;
        default: return false;
    }
}

@ccclass('LeaguePage')
export class LeaguePage extends Component {
    /**
     * 目录名大小写**必须**与磁盘一致（`assets/resources/ui/League/`，L 大写）：
     * Android / iOS 热更新 zip 内路径大小写敏感，写成 `ui/league/...`
     * 在 Windows 编辑器里照样能跑，真机上 `resources.load` 失败、变成一个空白页。
     */
    static prefabPath = 'ui/League/League';

    @property({ type: Node, tooltip: 'Banner：联盟旗帜容器（底 / 外框 / 旗面）' })
    banner: Node = null;

    @property({ type: Sprite, tooltip: 'Banner/ColorIcon：旗面（随联盟颜色切图）' })
    bannerColor: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Banner/Frame：选中态外框（未选中时隐藏）' })
    bannerFrame: Sprite = null!;

    @property({ type: Label, tooltip: 'LabName：联盟名' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'LabLv：联盟等级' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: 'LabUserCount：成员数' })
    memberLabel: Label = null!;

    @property({ type: Node, tooltip: 'BtnHelp：玩法说明（未落地 ⇒ 提示）' })
    helpButton: Node = null!;

    /** 当前展示的联盟颜色下标（FGUI `颜色` controller 的页序）。 */
    private bannerColorIndex = 0;

    /** 旗面八张图（首次用到后缓存；切色不再走 `resources.load`）。 */
    private bannerFrames: (SpriteFrame | null)[] | null = null;

    /** 每个入口只接一次点击（`onLoad` 会随实例化跑一次，这里仍留幂等保护）。 */
    private entrancesBound = false;

    /**
     * 入口 → 红点**根节点**（`ui/common/RedDot.prefab` 的嵌套实例）。
     *
     * 查不到的入口（节点被改名 / 忘了挂）不写进来，也不抛 —— 红点丢一个不影响主流程，
     * 但会在 `bindEntrances` 里 `console.warn` 一条（不静默）。
     */
    private readonly entranceRedDots = new Map<string, Node>();

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    onLoad(): void {
        this.bindEntrances();
        // 先用 FGUI 占位串铺一遍（数据还没回来时信息条不空），再按真数据覆盖。
        this.applyInfoTexts(null);
        void this.applyBannerColor(this.bannerColorIndex);
        void this.refresh();
    }

    onDestroy(): void {
        this.revision += 1;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /**
     * 按缓存里的联盟数据刷新底部信息条 + 旗帜色（老端 `TabLeagueMain.refreshLeague()`）。
     *
     * 老端靠 `VORoleUnionBag` 的 `OnChanged` **推送**触发；本端 `CacheMgr` 只读取值、
     * 不发事件 ⇒ 「入盟 / 建盟成功后刷信息条」由容器页 `LeagueTabPage` 重建本页来实现
     * （见 `LeagueTabPage.showPage` 与 `LeagueJoinPage.onJoined`）。
     * 因此这里把刷新抽成公开方法，重复进入 / 手动调用都安全。
     */
    async refresh(): Promise<void> {
        const revision = ++this.revision;
        // 信息条与入口红点一起取：两者共用同一个 `revision` 作废在飞结果。
        // 别把红点单独抽成第二个 `++this.revision` 的方法 —— 那两个并发调用会互相作废，
        // 表现成「先回来的那一半永远不落地」。
        const [snapshot, redDots] = await Promise.all([
            this.repository.load(),
            this.repository.loadLeagueEntryRedDots(),
        ]);
        if (!this.node.isValid || revision !== this.revision) return;
        this.applyInfoTexts(snapshot.myUnion);
        if (snapshot.myUnion) void this.applyBannerColor(snapshot.myUnion.icon);
        this.applyEntranceRedDots(redDots);
    }

    /**
     * 信息条三行文本 —— 老端 `TabLeagueMain.refreshLeague()` 逐句对照：
     *
     * | FGUI 节点 | 老端赋值 |
     * |---|---|
     * | `labName` | `cmd.name` |
     * | `labLv` | `` cmd.level + FW.G_W("LV_TEXT") `` ⇒「4级」 |
     * | `labUserCount` | `` FW.G_W("UNION_MENBER_1") + `${count}/${maxCount}` `` ⇒「成员:26/46」 |
     *
     * `union` 为空（未入盟 / 数据还没推回来）时退回 FGUI 的设计稿占位串 `LEAGUE_INFO_PLACEHOLDER`
     * —— 那是**设计态文本**（`labLv` 写的是「传奇:4级」），只当兜底用，不是运行时真值。
     */
    private applyInfoTexts(union: ILeagueUnionRow | null | undefined): void {
        this.nameLabel.string = union?.name || LEAGUE_INFO_PLACEHOLDER.name;
        this.levelLabel.string = union
            ? `${union.level}${LEAGUE_HALL_LV_SUFFIX}`
            : LEAGUE_INFO_PLACEHOLDER.level;
        this.memberLabel.string = union
            ? `${LEAGUE_UNION_MEMBER_PREFIX}${union.count}/${union.maxCount}`
            : LEAGUE_INFO_PLACEHOLDER.memberCount;
    }

    /**
     * 按 `LeagueTable.LEAGUE_ENTRANCES` 表接六个入口的点击 + 收起各自的入口红点。
     *
     * 表里 `landed === false` 的入口 ⇒ 提示未开放（**不静默**，也不置灰：
     * 置灰会让人以为「有这功能、只是不可用」，与「本版本没做」的语义不符）。
     *
     * 红点**先全部收起**：那六颗实例的 `icon` / `spine` / `title` 三个子节点的显隐
     * 只在 `RedDot.onLoad` 时才被压平 ⇒ 进场景时若整棵树还没激活就先不碰，
     * 等 `refreshEntranceRedDots()` 里的真判据回来再点。
     */
    private bindEntrances(): void {
        if (this.entrancesBound) return;
        this.entrancesBound = true;

        for (let index = 0; index < LEAGUE_ENTRANCES.length; index += 1) {
            const entrance = LEAGUE_ENTRANCES[index];
            const node = this.node.getChildByName(entrance.node);
            if (!node) {
                console.warn(`[League] 找不到节点：${entrance.node}（入口「${entrance.label}」点击不会生效）`);
                continue;
            }
            const button = node.getComponent(Button);
            if (!button) {
                console.warn(`[League] ${entrance.node} 上没有 cc.Button，点击不会生效`);
                continue;
            }
            button.node.on(Button.EventType.CLICK, () => this.onEntranceClick(entrance.node), this);

            const redDot = node.getChildByName(LEAGUE_ENTRANCE_RED_DOT);
            if (redDot) this.entranceRedDots.set(entrance.key, redDot);
            else if (LEAGUE_ENTRANCE_RED_DOT_SOURCE[entrance.key] !== 'none') {
                // 有判据却找不到节点 = 契约破了，必须吵
                console.warn(`[League] ${entrance.node} 下找不到 ${LEAGUE_ENTRANCE_RED_DOT}，该入口红点不会生效`);
            }
        }

        const help = this.helpButton.getComponent(Button);
        help.node.on(Button.EventType.CLICK, this.onHelpClick, this);
    }

    private onEntranceClick(nodeName: string): void {
        const entrance = leagueEntranceByNode(nodeName);
        if (!entrance) return;
        if (!entrance.landed) {
            // 目标面板尚未移植 —— 明确告知，不假装成功。
            FW.showTip(LEAGUE_TIP_NOT_OPEN);
            return;
        }
        // 已落地的入口：按 key 分发到对应面板。
        switch (entrance.key) {
            case 'LayerLeagueHall':
                void LeagueHallPage.open({});
                return;
            case 'LayerLeagueStore':
                void LeagueStorePage.open({});
                return;
            case 'LayerLeagueDiscount':
                void LeagueDiscountPage.open({});
                return;
            case 'LayerLeagueDonate':
                void LeagueDonatePage.open({});
                return;
            case 'LayerLeagueTask':
                void LeagueTaskPage.open({});
                return;
            case 'LayerLeagueNorthernExpedition':
                void LeagueNorthExpeditionPage.open({});
                return;
            default:
                // `landed: true` 却没有分发分支 = 接了入口忘了接面板。
                // 这里明确报出来，而不是静默退回「未开放」把人绕晕。
                console.warn(`[League] 入口 ${entrance.node}（${entrance.key}）标了 landed 但还没有分发分支`);
                FW.showTip(LEAGUE_TIP_NOT_OPEN);
        }
    }

    // 入口红点

    /**
     * 把判据落到六颗入口红点上（老端 `TabLeagueMain.updateRD()`）。
     *
     * 取数在 `refresh()` 里（见那里的注释 —— 与信息条共用同一个 `revision`）。
     *
     * **必须晚于 `RedDot.onLoad`**：`RedDot.onLoad` 会把 `icon` / `spine` / `title`
     * 三个子节点**无条件压成 inactive**（设计如此，避免复用残影）。
     * 本方法由 `refresh()` 的 `await` 之后调用 ⇒ 那时整棵节点树的 `onLoad` 早跑完了。
     * 若改成在 `onLoad` 里同步直调，会出现「刚点亮就被 `onLoad` 抹掉」的静默 bug。
     *
     * 走 `RedDot.setRedDot()` 而不是直接写 `node.active`：红点根节点之下还有
     * 「静态图 / spine 闪闪 / 数字」三个子节点要一起安排，只翻根节点的 `active`
     * 会得到「根开着、子全关」⇒ 什么都看不见。
     * 每次都是**绝对赋值**（完整算一遍），不做增量。
     */
    applyEntranceRedDots(dots: ILeagueEntryRedDots): void {
        for (const entrance of LEAGUE_ENTRANCES) {
            const node = this.entranceRedDots.get(entrance.key);
            if (!node) continue;
            const on = leagueEntranceRedDotOn(LEAGUE_ENTRANCE_RED_DOT_SOURCE[entrance.key], dots);
            const redDot = node.getComponent(RedDot);
            if (redDot) redDot.setRedDot(on ? 1 : 0);
            // 兜底：万一实例上没挂到组件（不该发生），至少把根节点显隐对上
            else node.active = on;
        }
    }

    /** 当前挂上了红点的入口（单测 / 探针用）。 */
    redDotEntrances(): readonly ILeagueEntrance[] {
        return LEAGUE_ENTRANCES.filter((entrance) => this.entranceRedDots.has(entrance.key));
    }

    private onHelpClick(): void {
        // 老端 `CtrlAlert.OpenHelpe("league")`；本端用静态帮助注册表承接。
        openLeagueHelp('league');
    }

    /**
     * 切旗帜颜色（FGUI `颜色` controller：绿/蓝/紫/红/橙/黄/金/青）。
     *
     * 八张旗面按需一次性预加载 —— 只切色不重取数，避免每次换色都闪一下。
     * 取图失败时**保持当前图**并打一条 warn（`loadArt` 解不出就返回 null）。
     */
    async applyBannerColor(colorIndex: number): Promise<void> {
        this.bannerColorIndex = colorIndex;

        if (!this.bannerFrames) {
            const frames = await loadLeagueBannerFrames();
            if (!this.node.isValid) return;
            this.bannerFrames = frames;
        }
        const frame = this.bannerFrames[colorIndex] ?? null;
        if (frame) this.bannerColor.spriteFrame = frame;
    }

    /** 选中态外框（FGUI `选中` controller：0=否 / 1=是）。 */
    setBannerSelected(selected: boolean): void {
        this.bannerFrame.node.active = selected;
        if (selected && !this.bannerFrame) {
            console.warn('[League] Banner/Frame 缺失，选中态外框不显示');
        }
    }

    /** 联盟旗帜的底图名（给需要按名取图的调用方；本类内部用）。 */
    static bannerBaseArt(): string {
        return LEAGUE_ART_BANNER_BASE;
    }

    /** 联盟旗帜外框图名。 */
    static bannerFrameArt(): string {
        return LEAGUE_ART_BANNER_FRAME;
    }
}
