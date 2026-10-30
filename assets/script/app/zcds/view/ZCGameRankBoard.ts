import { _decorator, Node, Sprite, SpriteFrame, resources } from 'cc';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { GAME_RANK_ART_ROOT, spriteFramePath } from '../../ArtPaths';
import { HeadArt } from '../../HeadArt';
import { ZCDC_LOG_WARNINGS } from '../ZCDCLogSwitch';
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
 * 再刷，表现为**先闪一帧默认头像**。所以 `loadFrames()` 失败也要把列表设成 0 条，
 * 不能停在"没设过"的中间态。
 */
@ccclass('ZCGameRankBoard')
export class ZCGameRankBoard extends PopupBase {
    static prefabPath = 'ui/game/ZCGameRankBoard';

    @property({ type: VirtualScrollView, tooltip: 'List：排行虚拟列表（纵向）' })
    list: VirtualScrollView = null;

    @property({ type: Node, tooltip: 'CloseBtn：关闭按钮（**设计稿没有，留空**；本弹窗靠点空白关闭）' })
    closeBtn: Node | null = null;

    /** 本次打开的席位（`renderItemFn` 按 index 现取，规则 55）。 */
    private seats: readonly IRankSeat[] = [];
    /** 加载好的帧；`null` = 还没加载完（此时不设条数）。 */
    private frames: IRankRowFrames | null = null;
    /**
     * 所有手动 addRef 的帧（含直接设到 Bg/Title 上的）。
     * onDestroy 时统一 decRef，防止引用计数只增不减导致内存泄漏。
     */
    private readonly loadedFrames = new Set<SpriteFrame>();

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
        this.seats = userData?.seats ?? [];

        const frames = await this.loadFrames();
        if (!this.isValid || !this.node.isValid) return;
        this.frames = frames;

        // 美术没加载出来也把条数设成 0：停在"没设过"会让列表保持上一个弹窗的行数。
        if (!await this.nextPopupFrame()) return;
        if (!this.isValid || !this.node.isValid) return;
        //  跨了 `await`：节点可能已被销毁 ⇒ 这里只判 `isValid`，不判 `list` 本身
        //  （它是 prefab 必填引用，判它是重复判空）。
        const list = this.list;
        if (!list.node.isValid) return;
        list.setTotalCount(this.seats.length);
        list.scrollToTop(false);
    }

    /**
     * 加载全部帧。
     *
     *  单张 png 的路径必须 `spriteFramePath(root, name)` 拼 `/spriteFrame`（规则 142）：
     * 裸路径 `resources.load` 报的是 `Bundle resources doesn't contain ...`（**不是 404**），
     * 极易误判成「美术没交图」。这里统一走 ArtPaths 的拼法。
     */
    private async loadFrames(): Promise<IRankRowFrames> {
        //  这里**不加载** `common_txk`（头像圆框）：它已经硬绑在
        // `ZCGameRankRow.prefab` 的 `HeadFrame` 上了 —— 行是 prefab 实例，
        // 节点不在这棵 prefab 树里，`getChildByPath('Panel/List/RowTemplate/HeadFrame')`
        // 恒为 null（2026-10-09 真机日志实证）。
        const [listFirst, listNormal, badge1, badge2, badge3, tile, countNormal, countPlaying] =
            await Promise.all([
                this.loadArt('phb_list_01'),
                this.loadArt('phb_list_02'),
                this.loadArt('icon_01'),
                this.loadArt('icon_02'),
                this.loadArt('icon_03'),
                this.loadArt('icon_tile'),
                this.loadArt('di_01'),
                this.loadArt('di_02'),
            ]);
        // 底板与标题走 prefab 上声明的 Sprite（`Panel/Bg`、`Panel/Title`）。
        const [bg, title] = await Promise.all([this.loadArt('bg_01'), this.loadArt('title')]);
        if (bg) this.setSprite('Panel/Bg', bg);
        if (title) this.setSprite('Panel/Title', title);

        // 头像按席位逐个取。
        //  **必须用 `HeadArt.loadHeadFrame` 而不是 `HeadArt.loadHeadSprite`**：`headKey` 存的是
        // **角色 id**（后端 `showInfo.img`，如 `70001`），要先经 `head` 表翻译成图标名。
        // 直接 `HeadArt.loadHeadSprite('70001')` 会把 id 当图标名去 `icons/head/70001` 找 ——
        // 那目录只有图标名、没有 id ⇒ 必然失败（实测报
        // `Bundle resources doesn't contain icons/head/70001/spriteFrame`）。
        const head: Record<string, SpriteFrame> = {};
        await Promise.all(Array.from(new Set(this.seats.map((seat) => seat.headKey).filter(Boolean)))
            .map(async (key) => {
                const sprite = await HeadArt.loadHeadFrame(key);
                if (sprite) {
                    // HeadArt 从缓存取帧，弹窗期间 addRef 防止被自动回收，关闭时随 loadedFrames 统一 decRef。
                    sprite.addRef();
                    this.loadedFrames.add(sprite);
                    head[key] = sprite;
                }
            }));

        return {
            rowBg: { first: listFirst, normal: listNormal },
            rankBadge: { 1: badge1, 2: badge2, 3: badge3 },
            head,
            tileIcon: tile,
            countBg: { normal: countNormal, playing: countPlaying },
        };
    }

    /**
     * 取一张切图；缺失只 `console.warn` 不抛（美术没交不该让整个弹窗打不开）。
     *
     *  `addRef()` 必加（规则 81）：模块级缓存里的 SpriteFrame 不参与引擎引用计数，
     * 引用计数为 0 时会被 `ReleaseManager` 自动回收（`_destruct()` 把 uv 置 null），
     * 而仍挂在 Sprite 上渲染的行会炸 ——「Simple.updateUVs: Cannot read properties of null」。
     */
    private loadArt(name: string): Promise<SpriteFrame | null> {
        const path = spriteFramePath(GAME_RANK_ART_ROOT, name);
        return new Promise((resolve) => {
            resources.load(path, SpriteFrame, (error, frame) => {
                if (error || !frame) {
                    if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameRankBoard] 美术缺失：${path}`, error);
                    resolve(null);
                    return;
                }
                frame.addRef();
                this.loadedFrames.add(frame);
                resolve(frame);
            });
        });
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

    /**
     * 弹窗销毁时释放所有手动 addRef 的帧。
     * 不释放的话，模块缓存里的 SpriteFrame 引用计数只增不减，
     * 长期反复打开排行榜会导致内存泄漏。
     */
    onDestroy(): void {
        for (const frame of this.loadedFrames) {
            frame.decRef();
        }
        this.loadedFrames.clear();
        this.frames = null;
        super.onDestroy();
    }

    /** 把第 `index` 行灌进（新建或回收的）行节点。**必须同步**。 */
    private readonly _renderRow = (node: Node, index: number): void => {
        const seat = this.seats[index];
        const row = node.getComponent(ZCGameRankRow);
        if (!seat || !row || !this.frames) return;
        row.render(seat, this.frames);
    };
}
