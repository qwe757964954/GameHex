import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame, Tween, tween, Vec3 } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { MATCH_ART_ROOT, MATCH_SEARCH_BARS, MATCH_SLOT_BARS, MATCH_SLOT_PILLS } from '../ArtPaths';
import { MatchCardSlot } from './MatchCardSlot';
import type { IIconLoader } from '../common/SpriteFrameCache';
import { MATCH_REVEAL_POP_SCALE, MATCH_REVEAL_POP_SECONDS } from './MatchReveal';
import { MATCH_CARD_SLOTS } from './MatchTypes';
import type { MatchCardData, MatchPlayerData } from './MatchTypes';

const { ccclass, property } = _decorator;

/** 放大镜需留在信息条内；半径上限 35.5，当前取 28。 */
const SEARCH_ORBIT_RADIUS = 28;

const SEARCH_ORBIT_SECONDS_PER_TURN = 1.9;

const SEARCH_ORBIT_SPEED = (Math.PI * 2) / SEARCH_ORBIT_SECONDS_PER_TURN;

/** 匹配中空头像盘的按槽位底色：蓝 / 红 / 紫 / 黄，与蓝湖空盘取色一致。 */
const SEARCH_AVATAR_TINTS: readonly (readonly [number, number, number])[] = [
    [44, 76, 132],
    [122, 40, 40],
    [105, 82, 167],
    [132, 74, 18],
];

/** 参与方信息条，按槽位配色并展示可横向滚动的卡牌。 */
@ccclass('MatchPlayerItem')
export class MatchPlayerItem extends Component {
    @property({ type: Node, tooltip: 'Content：数据展示容器；匹配中整体隐藏' })
    contentRoot: Node = null!;

    @property({ type: Sprite, tooltip: 'SearchIcon：匹配中显示的放大镜' })
    searchIcon: Sprite = null!;

    @property({ type: Sprite, tooltip: 'SearchAvatar：匹配中的空头像盘（按槽位染色）' })
    searchAvatar: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Bar：条底图，由 applySlot() 按槽位换色' })
    barFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Avatar：玩家头像' })
    avatar: Sprite = null!;

    @property({ type: Sprite, tooltip: 'PowerBg：战力数值底（frame_01..04）' })
    powerBg: Sprite = null!;

    @property({ type: Sprite, tooltip: 'TrophyBg：奖杯数值底（frame_01..04）' })
    trophyBg: Sprite = null!;

    @property({ type: Label, tooltip: 'PlayerNameLabel：昵称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'PowerValueLabel：战力数值' })
    powerValueLabel: Label = null!;

    @property({ type: Label, tooltip: 'TrophyLabel：奖杯数量' })
    trophyLabel: Label = null!;

    @property(VirtualScrollView)
    private cardList: VirtualScrollView = null!;

    private cards: readonly MatchCardData[] = [];
    private loader: IIconLoader | { readonly load: IIconLoader } = null!;
    private avatarRevision = 0;

    private get loadIcon(): IIconLoader {
        return typeof this.loader === 'function' ? this.loader : this.loader.load;
    }

    /** 在 onLoad 保存 prefab 原位，进入和退出搜索时共用。 */
    private readonly searchOrbitCenter = new Vec3();

    /** 数据态条底 / 搜索态条底分开存，切状态时只换帧，不动节点位置和缩放。 */
    private normalBarFrame: SpriteFrame | null = null;
    private searchBarSpriteFrame: SpriteFrame | null = null;

    private searchOrbitAngle = 0;

    private isSearching = false;

    initialize(loader: IIconLoader | { readonly load: IIconLoader }): void {
        this.loader = loader;
    }

    protected onLoad(): void {
        this.searchOrbitCenter.set(this.searchIcon.node.position);
        this.cardList.renderItemFn = (node, index) => {
            void node.getComponent(MatchCardSlot).render(this.cards[index], this.loader);
        };
    }

    protected onDestroy(): void {
        if (this.node && typeof Tween !== 'undefined' && Tween?.stopAllByTarget) {
            Tween.stopAllByTarget(this.node);
        }
    }

    /** 按槽位加载条底、搜索态条底和数值底。 */
    async applySlot(slot: number): Promise<void> {
        const slotIndex = Math.max(0, Math.min((MATCH_SLOT_BARS?.length || 1) - 1, Math.floor(slot)));
        const barName = MATCH_SLOT_BARS?.[slotIndex];
        const pillName = MATCH_SLOT_PILLS?.[slotIndex];
        const searchBarName = MATCH_SEARCH_BARS?.[slotIndex];
        const load = this.loadIcon;
        const [bar, pill, searchBar] = await Promise.all([
            load(barName, MATCH_ART_ROOT),
            load(pillName, MATCH_ART_ROOT),
            load(searchBarName, MATCH_ART_ROOT),
        ]);
        if (!this.isValid) return;
        if (bar) this.normalBarFrame = bar;
        if (searchBar) this.searchBarSpriteFrame = searchBar;
        this.applyBarFrame();
        if (pill) {
            if (this.powerBg) this.powerBg.spriteFrame = pill;
            if (this.trophyBg) this.trophyBg.spriteFrame = pill;
        }
        const tint = SEARCH_AVATAR_TINTS[slotIndex] ?? SEARCH_AVATAR_TINTS[0];
        if (this.searchAvatar && tint) {
            this.searchAvatar.color = new Color(tint[0], tint[1], tint[2], 255);
        }
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
        this.nameLabel.string = data.name;
        this.trophyLabel.string = String(Math.max(0, Math.floor(data.trophy)));
        this.powerValueLabel.string = String(Math.max(0, Math.floor(data.power)));

        this.cards = data.cards ?? [];
        this.cardList.refreshList(Math.min(this.cards.length, MATCH_CARD_SLOTS));

        const revision = ++this.avatarRevision;
        const avatarFrame = await this.loadIcon(data.avatarIcon, data.avatarRoot || MATCH_ART_ROOT);
        if (!this.isValid || revision !== this.avatarRevision) return;
        if (avatarFrame) this.avatar.spriteFrame = avatarFrame;
    }

    clear(): void {
        this.avatarRevision++;
        this.nameLabel.string = '';
        this.trophyLabel.string = '0';
        this.powerValueLabel.string = '0';
        this.cards = [];
        this.cardList.refreshList(0);
        this.cardList.scrollToTop();
    }

    setSearching(isSearching: boolean): void {
        this.isSearching = isSearching;
        this.applyBarFrame();
        this.searchIcon.node.active = isSearching;
        this.searchAvatar.node.active = isSearching;
        this.contentRoot.active = !isSearching;
        this.searchOrbitAngle = 0;
        if (isSearching) this.applySearchOrbit();
        else this.searchIcon.node.setPosition(this.searchOrbitCenter);
    }

    /** 搜索态换纯条底；没有搜索条资源时退回数据态条底，不出现空条。 */
    private applyBarFrame(): void {
        const frame = this.isSearching
            ? (this.searchBarSpriteFrame || this.normalBarFrame)
            : this.normalBarFrame;
        if (frame) this.barFrame.spriteFrame = frame;
    }

    /**
     * 从"匹配中"切到"有数据"时的一次小回弹（0.92 → 1，{@link MATCH_REVEAL_POP_SECONDS} 秒）。
     *
     * 为什么要动一下：信息条是**逐条**揭示的（见 `MatchReveal`），只换内容不换形态的话，
     * 玩家会读成"这一行刚才闪了一下"。回弹刚好落在"加载完成"这个动作上，且比最短间隔
     * （0.15s）还短，两条不会叠在一起动。
     */
    popIn(): void {
        const node = this.node;
        if (!node?.isValid) return;
        Tween.stopAllByTarget(node);
        node.setScale(MATCH_REVEAL_POP_SCALE, MATCH_REVEAL_POP_SCALE, 1);
        tween(node)
            .to(MATCH_REVEAL_POP_SECONDS, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }
}
