import { _decorator, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { GAME_RANK_ART_ROOT } from '../../ArtPaths';
import { HeadArt } from '../../HeadArt';
import { ZCDC_LOG_WARNINGS } from '../ZCDCLogSwitch';
import { createIconLoader } from '../../common/SpriteFrameCache';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IRankSeat, RankSeatProfiles } from '../model/ZCRankBoard';
import { ZCGameRankRow, type IRankRowFrames } from './ZCGameRankRow';

const { ccclass, property } = _decorator;

/** 打开参数（由 `ZCGame.openRankBoard` 传）。 */
export interface IZCRankBoardParams {
    /** 已排好序的席位（名次从 1 起）。 */
    readonly seats: readonly IRankSeat[];
    /** 席位档案（头像键 → 帧由本弹窗加载）。 */
    readonly profiles: RankSeatProfiles;
}

/**
 * 对局内排行榜弹窗（prefab `ui/game/ZCGameRankBoard`，628×579 + 居中）。
 *
 * 对应蓝湖「排行榜」设计稿。**不是**开服冲榜那一套（那走 `CmdGetRankReqMsg` 查服务端）——
 * 本弹窗是纯本地数据，来源见 `model/ZCRankBoard`。
 *
 * ## 弹窗骨架全部在 prefab 上（规则 162）
 *
 * `Bg` / `Title` / 列头三格 / `List` 都在 prefab 声明；本类**只做赋值**，不 `new Node`。
 *
 * ##  `setTotalCount` 必须等一帧（规则 86）
 *
 * `VirtualScrollView` 的槽位在它自己的 `start()` 里建，而 `onOpen` 早于 `start()`
 * ⇒ 不 `await this.nextPopupFrame()` 就设条数，列表**一片空白**。
 *
 * ##  美术要先加载完再设条数
 *
 * 行的 `render(seat, frames)` 依赖帧表；帧没到位就设条数 ⇒ 虚拟列表先用空帧渲染一遍
 * 再刷，表现为**先闪一帧默认头像**。缺失切图使用空帧，资源批次结束后统一设置条数；
 * 已关闭的加载批次不再更新列表。
 */
@ccclass('ZCGameRankBoard')
export class ZCGameRankBoard extends PopupBase {
    static prefabPath = 'ui/game/ZCGameRankBoard';

    @property({ type: VirtualScrollView, tooltip: 'List：排行虚拟列表（纵向）' })
    list: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'CloseBtn：关闭按钮（**设计稿没有，留空**；本弹窗靠点空白关闭）' })
    closeBtn: Node | null = null;

    /** 本次打开的席位（`renderItemFn` 按 index 现取，规则 55）。 */
    private seats: readonly IRankSeat[] = [];
    /** 加载好的帧；`null` = 还没加载完（此时不设条数）。 */
    private frames: IRankRowFrames | null = null;
    protected onInit(): void {
        //  `closeBtn` 是**真实可选**引用（`Node | null`）：设计稿没有关闭按钮，prefab 里
        //  也没有 `CloseBtn` 节点 ⇒ 它恒为 null，本弹窗靠 `closeOnBlank` 点空白关闭。
        //  别把它改成 `null!` 再删掉这里的判空 —— 那是把「没有这个按钮」当成资源错误，
        //  会当场崩在 `onInit`（判据 `zcds-rank-board-wiring` 反向钉住可选链）。
        this.closeBtn?.on('click', this._onClose, this);
        //  `renderItemFn` **只绑一次**（规则 171：绑定一律放 `onInit`，禁 `bound` 守卫）。
        this.list.renderItemFn = this._renderRow;
    }

    protected async onOpen(userData?: IZCRankBoardParams): Promise<void> {
        const seats = userData?.seats ?? [];
        const scope = this.resourceScope;
        this.seats = seats;
        const content = await this.loadFrames(scope, seats);
        if (!this.isValid || scope.disposed || !content) return;
        this.frames = content.frames;
        if (content.bg) this.setSprite('Panel/Bg', content.bg);
        if (content.title) this.setSprite('Panel/Title', content.title);

        if (!await this.nextPopupFrame()) return;
        if (!this.isValid || scope.disposed) return;
        this.list.setTotalCount(seats.length);
        this.list.scrollToTop(false);
    }

    private async loadFrames(scope: ResourceScope, seats: readonly IRankSeat[]): Promise<{
        frames: IRankRowFrames; bg: SpriteFrame | null; title: SpriteFrame | null;
    } | null> {
        // 捕获本次打开的端口；旧任务即使跨过重开，也不能借用新的资源作用域。
        const loadIcon = createIconLoader(this.assets, scope);
        const configs = this.configs;
        const [listFirst, listNormal, badge1, badge2, badge3, tile, countNormal, countPlaying, bg, title] =
            await Promise.all([
                'phb_list_01', 'phb_list_02', 'icon_01', 'icon_02', 'icon_03',
                'icon_tile', 'di_01', 'di_02', 'bg_01', 'title',
            ].map(name => loadIcon(name, GAME_RANK_ART_ROOT)));
        if (!this.isValid || scope.disposed) return null;

        const head: Record<string, SpriteFrame> = {};
        const keys = Array.from(new Set(seats.map(seat => seat.headKey).filter(Boolean)));
        if (keys.length) {
            const resolver = await HeadArt.loadHeadArtResolver(configs);
            if (!this.isValid || scope.disposed) return null;
            const portraits = await Promise.all(keys.map(key => HeadArt.loadHeadFrame(key, loadIcon, resolver)));
            if (!this.isValid || scope.disposed) return null;
            keys.forEach((key, index) => { if (portraits[index]) head[key] = portraits[index]; });
        }
        return {
            bg, title,
            frames: {
                rowBg: { first: listFirst, normal: listNormal },
                rankBadge: { 1: badge1, 2: badge2, 3: badge3 },
                head, tileIcon: tile, countBg: { normal: countNormal, playing: countPlaying },
            },
        };
    }

    protected onClose(): void {
        this.frames = null;
        this.seats = [];
    }

    /** 按相对路径找 Sprite 并赋值；找不到只 warn（prefab 结构由人保证，这里不兜底造节点）。 */
    private setSprite(relativePath: string, frame: SpriteFrame): void {
        const sprite = this.node.getChildByPath(relativePath)?.getComponent(Sprite);
        if (!sprite) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameRankBoard] prefab 缺少节点 ${relativePath}`);
            return;
        }
        sprite.spriteFrame = frame;
    }

    private _onClose(): void {
        this.closeByButton();
    }

    /** 把第 `index` 行灌进（新建或回收的）行节点。**必须同步**。 */
    private readonly _renderRow = (node: Node, index: number): void => {
        const seat = this.seats[index];
        const row = node.getComponent(ZCGameRankRow);
        if (!seat || !row || !this.frames) return;
        row.render(seat, this.frames);
    };
}
