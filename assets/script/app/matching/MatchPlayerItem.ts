import { _decorator, Component, Label, Layout, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { ARTIFACT_ART_ROOT, MATCH_ART_ROOT, MATCH_ICON_ART_ROOT, MATCH_SLOT_BARS, MATCH_SLOT_FRAMES } from '../ArtPaths';
import type { MatchIconLoader } from './MatchIcons';
import { MATCH_STAT_SLOTS, MatchPlayerData, MatchStat } from './MatchTypes';
import { MatchStatItem } from './MatchStatItem';

const { ccclass, property } = _decorator;

/**
 * 放大镜「搜索中」的绕圈半径（设计单位）。
 *
 * 上限由信息条自身高度卡死：条 630×160（本地 y ∈ [-80, 80]），放大镜节点 85×89、
 * 基准位置 y = 0，绕圈后下边缘到 `-R - 44.5`。要让最底点不越过 -80 就必须 `R ≤ 35.5`，
 * 这里取 28 留 7px 余量 —— 所以**不是**随便调大就能"更明显"的，
 * 想加大得先给条加高或把放大镜缩小。
 */
const SEARCH_ORBIT_RADIUS = 28;

/** 放大镜绕一圈的秒数（越小转得越快）。1.9s ≈ 0.53 圈/秒，比初版 2.6s 快一档，看得清镜身又不拖沓。 */
const SEARCH_ORBIT_SECONDS_PER_TURN = 1.9;

/** 每帧推进的弧度。 */
const SEARCH_ORBIT_SPEED = (Math.PI * 2) / SEARCH_ORBIT_SECONDS_PER_TURN;

/**
 * 段位行底图的最小宽度（= 设计稿的 205）与内容左右留白。
 *  段位名长度可变，底图宽度跟着 `RankLayout` 走；太短的段位名（如「白银」）也不会缩得比设计稿窄。
 */
const RANK_ROW_MIN_WIDTH = 205;
const RANK_ROW_PADDING = 16;

/**
 * 匹配界面单个参与方的信息条（我方 + 最多 3 名对手共用这一个类，挂在 MatchingRoot 下）。
 *
 * 结构对应蓝湖「战斗匹配(1)」设计稿的信息条（630×160，设计稿 720×1610 坐标系）：
 *   条底 → 头像框 + 头像（CircleAvatar 圆裁）→ 昵称 → 段位徽章 + 段位名 + 奖杯 + 数量
 *        → 4 个小图标槽位（虚拟列表）→ 战力图标 + 数值 → 神器图标 + 神器名
 * 四样东西**全在条内**（旧版把昵称与战力挂在条外下方，新设计已收进条里）。
 *
 * 4 套配色（蓝 / 红 / 紫 / 黄）由 `applySlot(slot)` 运行时挑：槽位 0 = 我方，1~3 = 对手；
 * 因此左右两侧共用同一个 prefab 与同一个类，不再需要"我方 prefab / 敌方 prefab"两份。
 *
 * 排版全部由 prefab 摆好，本组件只负责填数据与换色。
 *
 * 小图标槽位走 `Content/StatList`（VirtualScrollView）+ `MatchStatItem.prefab`：
 * 槽位不再固定 4 个节点，统计数据由 `refreshList` 驱动按需实例化与复用。
 * 列表的方向 / 条目预制体 / 禁用回弹等配置**全部在 prefab 里用 Inspector 绑定**，
 * 脚本不再运行时覆盖 —— 同 `ZCGuidePanel` 的用法约定。
 *
 * 搜索中的放大镜走**绕圈跑**：圆心取 prefab 里的静止位置（所以 prefab 不用改、
 * 停动画也不跳），只做平移不做自转 —— 放大镜自转会把镜柄甩到上面，反而认不出是什么。
 */
@ccclass('MatchPlayerItem')
export class MatchPlayerItem extends Component {
    @property({ type: Node, tooltip: 'Content：数据展示容器；匹配中整体隐藏' })
    contentRoot: Node = null;

    @property({ type: Sprite, tooltip: 'SearchIcon：匹配中显示的放大镜' })
    searchIcon: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Bar：条底图，由 applySlot() 按槽位换色' })
    barFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'AvatarFrame：阵营头像框，由 applySlot() 按槽位换色' })
    avatarFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Avatar：玩家头像' })
    avatar: Sprite = null!;

    @property({ type: Sprite, tooltip: 'RoleIcon：神器图标' })
    artifactIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'RoleNameLabel：神器名称' })
    artifactNameLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'RankBadge：段位徽章' })
    rankBadge: Sprite = null!;

    @property({ type: Label, tooltip: 'RankLabel：段位名，如「黄金」' })
    rankLabel: Label = null!;

    @property({ type: Label, tooltip: 'TrophyLabel：奖杯数量' })
    trophyLabel: Label = null!;

    @property({
        type: VirtualScrollView,
        tooltip: 'Content/StatRow/StatList：小图标+数值的虚拟列表（容器、条目预制体等配置绑在它自己身上）',
    })
    statList: VirtualScrollView = null!;

    @property({
        type: Node,
        tooltip: 'Content/StatRow：小图标整行（底图 + 虚拟列表）；没有统计数据时**整行隐藏** —— '
            + '底图留在那儿会变成一条空的深色长条（2026-10-13 真机截图）',
    })
    statRow: Node = null!;

    @property({
        type: Node,
        tooltip: 'Content/ArtifactRow：神器整组（图标 + 名字底 + 名字）；没带神器时**整组隐藏**，'
            + '否则右侧会留一条空的深色名底',
    })
    artifactRow: Node = null!;

    @property({
        type: Node,
        tooltip: 'Content/RankLayout：段位行（徽章 + 段位名 + 奖杯 + 数量），HORIZONTAL 自动横排 —— '
            + '段位名长度可变（「白银」/「菜鸟I」/「荣耀王者」），固定坐标会让它压到奖杯上',
    })
    rankLayout: Node = null!;

    @property({ type: Sprite, tooltip: 'Content/RankRowBg：段位行底图，宽度跟着 RankLayout 的内容走' })
    rankRowBg: Sprite = null!;

    @property({ type: Label, tooltip: 'PlayerNameLabel：昵称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'PowerValueLabel：战力数值' })
    powerValueLabel: Label = null!;

    /** 加载令牌：连续 refresh 时丢弃过期结果，避免旧图标覆盖新数据。 */
    private loadToken = 0;
    /** 默认加载器：`beginMatch` 之前调用 `refresh` 时用，直接返回 null 走占位图。 */
    private iconLoader: MatchIconLoader = async () => null;

    /** 当前列表数据（由 renderItemFn 按索引读取）。 */
    private statSlots: MatchStat[] = [];

    /** 与 statSlots 一一对应的已加载图标。 */
    private statFrames: (SpriteFrame | null)[] = [];

    /** 放大镜绕圈圆心 = prefab 里的静止位置；`onLoad` 记一次，之后一直用它复位。 */
    private readonly searchOrbitCenter = new Vec3();

    /** 当前绕圈相位（弧度）。 */
    private searchOrbitAngle = 0;

    /** 是否正在绕圈。 */
    private searching = false;

    /**
     * 记住放大镜的静止位置作为绕圈圆心。
     *
     * 必须在这里（而不是第一次 `setSearching(true)` 时）取：那时节点还在设计位置上，
     * 而 `onLoad` 早于任何一次 `beginMatch`，拿到的一定是 prefab 里的原始值，
     * 也天然兼容父 prefab 用 `targetOverrides` 改过的位置。
     */
    protected onLoad(): void {
        this.searchOrbitCenter.set(this.searchIcon.node.position);
    }

    setIconLoader(loader: MatchIconLoader): void {
        this.iconLoader = loader;
    }

    /**
     * 按槽位换阵营配色（0 = 我方蓝，1~3 = 对手红 / 紫 / 黄）。
     *
     * 配色**刻意不写进 prefab 的 propertyOverrides**：人数是运行时才知道的（2~4 人），
     * 固定 4 份 override 会让"3 人局"这类情形多出一份没人看的死配置，
     * 也把"谁用什么颜色"这件事劈成了 prefab 数据与代码两处真源。
     *
     * 图走 `iconLoader`（自带缓存），`ProcedureMatching.onPreload` 已把 4 组全部预热，
     * 正常不会出现"先闪默认色再换"。加载失败保留 prefab 里的默认图，不抛。
     */
    async applySlot(slot: number): Promise<void> {
        const i = Math.max(0, Math.min(MATCH_SLOT_BARS.length - 1, Math.floor(slot)));
        const [bar, frame] = await Promise.all([
            this.iconLoader(MATCH_SLOT_BARS[i], MATCH_ART_ROOT),
            this.iconLoader(MATCH_SLOT_FRAMES[i], MATCH_ART_ROOT),
        ]);
        if (bar) this.barFrame.spriteFrame = bar;
        if (frame) this.avatarFrame.spriteFrame = frame;
    }

    /** 搜索中推进绕圈；非搜索状态直接返回，零开销。 */
    update(deltaTime: number): void {
        if (!this.searching) return;
        this.searchOrbitAngle += SEARCH_ORBIT_SPEED * deltaTime;
        this.applySearchOrbit();
    }

    /**
     * 按当前相位把放大镜摆到圆周上（只平移，不动旋转与缩放）。
     *
     * `setSearching` 与 `update` 共用这一段 —— 否则「起手那一帧」会先落在圆心、
     * 下一帧才跳到圆周上，表现为放大镜出现时向外弹一下。
     */
    private applySearchOrbit(): void {
        const center = this.searchOrbitCenter;
        this.searchIcon.node.setPosition(
            center.x + Math.cos(this.searchOrbitAngle) * SEARCH_ORBIT_RADIUS,
            center.y + Math.sin(this.searchOrbitAngle) * SEARCH_ORBIT_RADIUS,
            center.z,
        );
    }

    /** 全量刷新该玩家的展示数据；图标异步加载，其余字段同步写入。 */
    async refresh(data: MatchPlayerData): Promise<void> {
        const token = ++this.loadToken;

        this.nameLabel.string = data.name;
        this.rankLabel.string = data.rank;
        this.trophyLabel.string = String(Math.max(0, Math.floor(data.trophy)));
        this.powerValueLabel.string = String(Math.max(0, Math.floor(data.power)));
        this.artifactNameLabel.string = data.artifactName;

        //  神器三件套是**一整组**（图标 / 名字底 / 名字），没带神器就整组藏掉：
        //  底图和图标都来自 prefab（静态），数据是运行时的 —— 只藏内容不藏底图，
        //  真机上就会留一条空的深色名底（2026-10-13 截图）。
        this.artifactRow.active = !!data.artifactIcon || !!data.artifactName;
        this.syncRankRowWidth();

        // 小图标：先并行取图，再一次性灌给列表。列表的 renderItemFn 同步生效，
        // 避免「异步图标回来时槽位已经被复用」的错帧。
        //
        //  两组图分属不同根目录（见 `ArtPaths`）：头像 / 神器在 `image/matching`，
        // 信息条小图标 `icon_01..05` 在 `image/icon/matching`。不要合并成一次调用。
        //  **头像还有第三个根**：服务端头像（`head` 表）在 `image/icon/head`，由数据带下来
        //  （`data.avatarRoot`，写它的是 `HeadArtModel.applyHeadArt`），
        //  没带时才回落到 `MATCH_ART_ROOT` 的占位图。
        const slots = data.stats.slice(0, MATCH_STAT_SLOTS);
        const avatarRoot = data.avatarRoot || MATCH_ART_ROOT;

        const [avatarFrame, artifactFrame, statFrames] = await Promise.all([
            this.iconLoader(data.avatarIcon, avatarRoot),
            // ⚠️ 根目录是 `image/artifact`（不是 `image/matching`）：神器图标要与
            // 对局里的神器格**用同一张图**，资源名真源 = `pvpArtifact[].icon`。
            // 旧口径读 `image/matching` 且 prefab 硬绑 `icon_faqi.png`（固定占位蓝色法杖），
            // 于是永远显示那张图 —— 与玩家实际带的神器无关。
            this.iconLoader(data.artifactIcon, ARTIFACT_ART_ROOT),
            Promise.all(slots.map((stat) => this.iconLoader(stat.icon, MATCH_ICON_ART_ROOT))),
        ]);
        if (token !== this.loadToken) return;
        if (avatarFrame) this.avatar.spriteFrame = avatarFrame;
        if (artifactFrame) this.artifactIcon.spriteFrame = artifactFrame;
        this.renderStats(slots, statFrames);
    }

    /** 清空为「尚无数据」的占位状态（对方未匹配到时用）。 */
    clear(): void {
        this.loadToken += 1;
        this.nameLabel.string = '';
        this.rankLabel.string = '';
        this.trophyLabel.string = '0';
        this.powerValueLabel.string = '0';
        this.artifactNameLabel.string = '';
        this.artifactRow.active = false;
        this.syncRankRowWidth();
        this.renderStats([], []);
    }

    /**
     * 切换「匹配中」外观：放大镜与数据内容互斥显示。
     * 搜索阶段敌方条只留底条与放大镜，匹配成功后整体换成对手数据。
     *
     * 相位在每次进出搜索时都归零：
     *   进入 → 立刻摆到 0 相位的圆周点上（不能停在圆心，否则第一帧会向外弹一下）
     *   退出 → 复位到 prefab 里的静止位置（放大镜已隐藏，这里只是把节点还原成设计状态）
     */
    setSearching(searching: boolean): void {
        this.searching = searching;
        this.searchIcon.node.active = searching;
        this.contentRoot.active = !searching;
        this.searchOrbitAngle = 0;
        if (searching) this.applySearchOrbit();
        else this.searchIcon.node.setPosition(this.searchOrbitCenter);
    }

    /**
     * 段位行底图宽度跟着内容走。
     *
     *  `RankLayout` 是 HORIZONTAL + CONTAINER ⇒ 宽度随段位名长度变（「白银」/「菜鸟I」/「荣耀王者」），
     *  而底图是固定 205 的切图 ⇒ 长段位名会顶出底图。这里按内容宽重设（留 `RANK_ROW_PADDING` 余量），
     *  最短仍保持设计稿的 205。
     *
     *  底图 anchor 是 (0.5,0.5)、`RankLayout` 是 (0,0.5) ⇒ 用容器左边缘反推底图中心，两者左边缘才对齐。
     *  `updateLayout()` 必须显式调：改完 `Label.string` 同帧读 `width` 拿到的是**旧值**。
     */
    private syncRankRowWidth(): void {
        //  Label 的排版是**延迟到渲染前**的：改完 `string` 同帧读 `contentSize` 拿到的是**旧值**，
        //  所以先强制刷新一次渲染数据（`Label` 没有 `forceUpdate*`，用带 force 的 `updateRenderData`）。
        this.rankLabel.updateRenderData(true);
        this.trophyLabel.updateRenderData(true);

        //  容器宽度**自己按子节点求和**，不读 `Layout` 算出来的尺寸 ——
        //  `Layout` 的重排走内部 dirty 标记，同帧 `updateLayout()` 不保证已经跑过（实测拿到的还是旧宽）。
        const layout = this.rankLayout.getComponent(Layout)!;
        const children = this.rankLayout.children;
        let content = layout.spacingX * Math.max(0, children.length - 1);
        for (const child of children) content += child.getComponent(UITransform)!.width;

        const width = Math.max(RANK_ROW_MIN_WIDTH, content + RANK_ROW_PADDING);
        const bg = this.rankRowBg.getComponent(UITransform)!;
        bg.setContentSize(width, bg.height);
        this.rankRowBg.node.setPosition(this.rankLayout.position.x + width / 2, this.rankRowBg.node.position.y, 0);
    }

    /**
     * 把小图标交给虚拟列表渲染。
     *
     * 列表模式（启用虚拟列表 / 创建模式 / 条目预制体 / 尺寸）由 prefab 里
     * StatList 的 Inspector 绑定决定，这里只挂渲染回调 + 数据长度。
     */
    private renderStats(slots: MatchStat[], frames: (SpriteFrame | null)[]): void {
        this.statSlots = slots;
        this.statFrames = frames;

        //  没有统计数据时**整行**（深色底 + 列表）一起隐藏 —— 只把列表清空、
        //  留着底图，真机上就是一条空的深色长条（2026-10-13 截图）。
        this.statRow.active = slots.length > 0;

        const list = this.statList;
        if (!list) {
            console.warn('[MatchPlayerItem] 未绑定 StatList，小图标不会渲染');
            return;
        }

        list.renderItemFn = (itemNode: Node, index: number): void => {
            const item = itemNode.getComponent(MatchStatItem);
            if (!item) return;
            item.render(this.statSlots[index] ?? null, this.statFrames[index] ?? null);
        };
        // refreshList 只取长度；数据本体由上面的 renderItemFn 按索引读取
        list.refreshList(slots);
    }
}
