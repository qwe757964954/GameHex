import { _decorator, Component, Label, Layout, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { ARTIFACT_ART_ROOT, MATCH_ART_ROOT, MATCH_ICON_ART_ROOT, MATCH_SLOT_BARS, MATCH_SLOT_FRAMES } from '../ArtPaths';
import type { MatchIconLoader } from './MatchIcons';
import { MATCH_STAT_SLOTS } from './MatchTypes';
import type { MatchPlayerData, MatchStat } from './MatchTypes';
import { MatchStatItem } from './MatchStatItem';

const { ccclass, property } = _decorator;

/** 放大镜需留在信息条内；半径上限 35.5，当前取 28。 */
const SEARCH_ORBIT_RADIUS = 28;

const SEARCH_ORBIT_SECONDS_PER_TURN = 1.9;

const SEARCH_ORBIT_SPEED = (Math.PI * 2) / SEARCH_ORBIT_SECONDS_PER_TURN;

/** 段位底图宽度随内容增长，至少保持设计宽度。 */
const RANK_ROW_MIN_WIDTH = 205;
const RANK_ROW_PADDING = 16;

/** 参与方信息条：按槽位配色，统计列表由 prefab 配置。 */
@ccclass('MatchPlayerItem')
export class MatchPlayerItem extends Component {
    @property({ type: Node, tooltip: 'Content：数据展示容器；匹配中整体隐藏' })
    contentRoot: Node = null;

    @property({ type: Sprite, tooltip: 'SearchIcon：匹配中显示的放大镜' })
    searchIcon: Sprite = null;

    @property({ type: Sprite, tooltip: 'Bar：条底图，由 applySlot() 按槽位换色' })
    barFrame: Sprite = null;

    @property({ type: Sprite, tooltip: 'AvatarFrame：阵营头像框，由 applySlot() 按槽位换色' })
    avatarFrame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Avatar：玩家头像' })
    avatar: Sprite = null;

    @property({ type: Sprite, tooltip: 'RoleIcon：神器图标' })
    artifactIcon: Sprite = null;

    @property({ type: Label, tooltip: 'RoleNameLabel：神器名称' })
    artifactNameLabel: Label = null;

    @property({ type: Sprite, tooltip: 'RankBadge：段位徽章' })
    rankBadge: Sprite = null;

    @property({ type: Label, tooltip: 'RankLabel：段位名，如「黄金」' })
    rankLabel: Label = null;

    @property({ type: Label, tooltip: 'TrophyLabel：奖杯数量' })
    trophyLabel: Label = null;

    @property({
        type: VirtualScrollView,
        tooltip: 'Content/StatRow/StatList：小图标+数值的虚拟列表（容器、条目预制体等配置绑在它自己身上）',
    })
    statList: VirtualScrollView = null;

    @property({
        type: Node,
        tooltip: 'Content/StatRow：无统计数据时整行隐藏',
    })
    statRow: Node = null;

    @property({
        type: Node,
        tooltip: 'Content/ArtifactRow：无神器时整组隐藏',
    })
    artifactRow: Node = null;

    @property({
        type: Node,
        tooltip: 'Content/RankLayout：段位与奖杯横排容器',
    })
    rankLayout: Node = null;

    @property({ type: Sprite, tooltip: 'Content/RankRowBg：段位行底图，宽度跟着 RankLayout 的内容走' })
    rankRowBg: Sprite = null;

    @property({ type: Label, tooltip: 'PlayerNameLabel：昵称' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'PowerValueLabel：战力数值' })
    powerValueLabel: Label = null;

    /** 内容与配色独立失效，销毁时一并递增。 */
    private contentRevision = 0;
    private slotRevision = 0;
    private iconLoader: MatchIconLoader = async () => null;

    private stats: MatchStat[] = [];

    private statFrames: (SpriteFrame | null)[] = [];

    /** 在 onLoad 保存 prefab 原位，进入和退出搜索时共用。 */
    private readonly searchOrbitCenter = new Vec3();

    private searchOrbitAngle = 0;

    private isSearching = false;

    protected onLoad(): void {
        this.searchOrbitCenter.set(this.searchIcon.node.position);
    }

    setIconLoader(loader: MatchIconLoader): void {
        this.iconLoader = loader;
    }

    /** 按槽位加载阵营底图和头像框；过期结果不应用。 */
    async applySlot(slot: number): Promise<void> {
        const token = ++this.slotRevision;
        const slotIndex = Math.max(0, Math.min(MATCH_SLOT_BARS.length - 1, Math.floor(slot)));
        const [bar, frame] = await Promise.all([
            this.iconLoader(MATCH_SLOT_BARS[slotIndex], MATCH_ART_ROOT),
            this.iconLoader(MATCH_SLOT_FRAMES[slotIndex], MATCH_ART_ROOT),
        ]);
        if (token !== this.slotRevision) return;
        if (bar) this.barFrame.spriteFrame = bar;
        if (frame) this.avatarFrame.spriteFrame = frame;
    }

    protected onDestroy(): void {
        this.contentRevision++;
        this.slotRevision++;
    }

    update(deltaTime: number): void {
        if (!this.isSearching) return;
        this.searchOrbitAngle += SEARCH_ORBIT_SPEED * deltaTime;
        this.applySearchOrbit();
    }

    private applySearchOrbit(): void {
        const center = this.searchOrbitCenter;
        this.searchIcon.node.setPosition(
            center.x + Math.cos(this.searchOrbitAngle) * SEARCH_ORBIT_RADIUS,
            center.y + Math.sin(this.searchOrbitAngle) * SEARCH_ORBIT_RADIUS,
            center.z,
        );
    }

    async refresh(data: MatchPlayerData): Promise<void> {
        const token = ++this.contentRevision;

        this.nameLabel.string = data.name;
        this.rankLabel.string = data.rank;
        this.trophyLabel.string = String(Math.max(0, Math.floor(data.trophy)));
        this.powerValueLabel.string = String(Math.max(0, Math.floor(data.power)));
        this.artifactNameLabel.string = data.artifactName;

        // 名字底与内容整组显隐，避免留下空底板。
        this.artifactRow.active = !!data.artifactIcon || !!data.artifactName;
        this.syncRankRowWidth();

        // 先并行加载，再按版本一次应用，避免旧图覆盖新数据。
        const slots = data.stats.slice(0, MATCH_STAT_SLOTS);
        const avatarRoot = data.avatarRoot || MATCH_ART_ROOT;

        const [avatarFrame, artifactFrame, statFrames] = await Promise.all([
            this.iconLoader(data.avatarIcon, avatarRoot),
            this.iconLoader(data.artifactIcon, ARTIFACT_ART_ROOT),
            Promise.all(slots.map((stat) => this.iconLoader(stat.icon, MATCH_ICON_ART_ROOT))),
        ]);
        if (token !== this.contentRevision) return;
        if (avatarFrame) this.avatar.spriteFrame = avatarFrame;
        if (artifactFrame) this.artifactIcon.spriteFrame = artifactFrame;
        this.renderStats(slots, statFrames);
    }

    clear(): void {
        this.contentRevision += 1;
        this.nameLabel.string = '';
        this.rankLabel.string = '';
        this.trophyLabel.string = '0';
        this.powerValueLabel.string = '0';
        this.artifactNameLabel.string = '';
        this.artifactRow.active = false;
        this.syncRankRowWidth();
        this.renderStats([], []);
    }

    setSearching(isSearching: boolean): void {
        this.isSearching = isSearching;
        this.searchIcon.node.active = isSearching;
        this.contentRoot.active = !isSearching;
        this.searchOrbitAngle = 0;
        if (isSearching) this.applySearchOrbit();
        else this.searchIcon.node.setPosition(this.searchOrbitCenter);
    }

    /** 先强制刷新文字，再按子项宽度求和；同帧读取 Layout 尺寸可能仍是旧值。 */
    private syncRankRowWidth(): void {
        this.rankLabel.updateRenderData(true);
        this.trophyLabel.updateRenderData(true);

        const layout = this.rankLayout.getComponent(Layout);
        const children = this.rankLayout.children;
        let contentWidth = layout.spacingX * Math.max(0, children.length - 1);
        for (const child of children) contentWidth += child.getComponent(UITransform).width;

        const width = Math.max(RANK_ROW_MIN_WIDTH, contentWidth + RANK_ROW_PADDING);
        const background = this.rankRowBg.getComponent(UITransform);
        background.setContentSize(width, background.height);
        this.rankRowBg.node.setPosition(this.rankLayout.position.x + width / 2, this.rankRowBg.node.position.y, 0);
    }

    private renderStats(slots: MatchStat[], frames: (SpriteFrame | null)[]): void {
        this.stats = slots;
        this.statFrames = frames;

        this.statRow.active = slots.length > 0;

        const list = this.statList;
        if (!list) {
            console.warn('[MatchPlayerItem] 未绑定 StatList，小图标不会渲染');
            return;
        }

        list.renderItemFn = (itemNode: Node, index: number): void => {
            const item = itemNode.getComponent(MatchStatItem);
            if (!item) return;
            item.render(this.stats[index] ?? null, this.statFrames[index] ?? null);
        };
        list.refreshList(slots);
    }
}
