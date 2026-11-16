import { _decorator, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { Toast } from '../common/Toast';
import { OSDetailRow } from './OSDetailRow';
import { CL_NOT_IN_RANK, celebrationRepository, celebrationSelfRoleId } from './CelebrationRepository';
import type { ICelebrationRankEntry } from './CelebrationRepository';
import { CL_TEXTS } from './CelebrationTexts';

const { ccclass, property } = _decorator;

/**
 * 「详细排名>」二级弹窗（prefab `ui/Celebration/OSRankRankDetail`，720×1280），老端 `LayerOSRankDetailUI`。
 *
 * 老端 `enterAsync` 发 `CmdGetRankReqMsg{rankType, showNum: 50, unionId}`，`updateView` 里
 * `list.update(rankInfo.rankList)` 之后又单独 `renderItem(0, heroItem, rankInfo.myRank)`。
 * 「自己那行」（`heroItem`）不在列表里，是独立节点，只喂列表条数不够，本类也要单独持它。
 *
 * `heroItem` 实例写的是 `controller="显示背景,1"`（不显示），它那层 `n0` 背景是关的，
 * 底下另有一张 `n13` 当底；生成器已把 `n0` 显式烘成 false，本类不碰，与数据有没有回来无关。
 *
 * 老端 `renderItem` 里 `item.tm("rank").setText(data.rank || 0)` 是多余的：`rank` 是一个 GComponent，
 * 紧跟其后又写了 `item.tm("rank.lab")`，真正写数字的是后者。迁过来只保留 `RankNum` 一处。
 *
 * 名次徽章只有「未上榜 / 第一名」两态：`setSelectedPage("标签", rank == -1 ? "未上榜" : "第一名")`，
 * 控制器声明了 5 页但运行时只用 2 页，其余页名没有额外样式。
 */

/** 老端 `showNum: 50`。 */
export const CL_DETAIL_SHOW_NUM = 50;

/** 打开参数（由 `OSRankPage` 传）。 */
export interface IOsRankDetailParams {
    /** 排行榜类型（= 庆典的 `rankType`）。 */
    readonly rankType?: number;
    /** 战力口径名（老端 `refConfig.name`，填 `ColPower` 那一格）。 */
    readonly rankKey?: string;
}

/** 「还没拿到数据」的空行：`rank = -1` 显示未上榜，名字 / 战力为空。 */
const CL_EMPTY_RANK_ENTRY: ICelebrationRankEntry = {
    rank: CL_NOT_IN_RANK,
    roleName: '',
    power: 0,
    usedSkinResId: 0,
};

@ccclass('OSRankRankDetailPage')
export class OSRankRankDetailPage extends PopupBase {
    static prefabPath = 'ui/Celebration/OSRankRankDetail';

    @property({ type: VirtualScrollView, tooltip: 'List：排行列表（FGUI list，item = OSRankDetailRow）' })
    list: VirtualScrollView = null!;

    @property({ type: OSDetailRow, tooltip: 'HeroRow：自己那一行（FGUI heroItem，不在列表里，见文件头）' })
    heroRow: OSDetailRow = null!;

    @property({ type: Label, tooltip: 'ColPower：表头第三格（FGUI lab_key，运行时被 rankKey 覆盖）' })
    colPower: Label = null!;

    @property({ type: Node, tooltip: 'PopBg/CloseBtn：关闭按钮（FGUI 按钮_关闭）' })
    closeBtn: Node = null!;

    /** 本次拿到的排行行（`renderItemFn` 按 index 现取）。 */
    private _rows: readonly ICelebrationRankEntry[] = [];

    protected onInit(): void {
        this.closeBtn.on('click', this._onClose, this);
        this.list.renderItemFn = this._renderRow;
    }

    protected async onOpen(userData?: IOsRankDetailParams): Promise<void> {
        const rankType = Number(userData?.rankType) || 0;
        this.colPower.string = typeof userData?.rankKey === 'string' ? userData.rankKey : '';

        // 先把两处清空：回包不来就停在空态，不留上一轮的值（弹窗是复用实例）。
        this._rows = [];
        this.heroRow.render(CL_EMPTY_RANK_ENTRY);

        const detail = await celebrationRepository.requestRank(
            rankType,
            CL_DETAIL_SHOW_NUM,
            // 形参叫 unionId，老端传的是自己的 roleId。
            celebrationSelfRoleId(),
            this,
        );
        if (!this.isValid || !this.node.isValid) return;
        if (!detail) {
            Toast.show(CL_TEXTS.offlineTip);
            return;
        }

        this._rows = detail.list;
        this.heroRow.render(detail.myRank);

        // 槽位在 VirtualScrollView.start() 里建，onOpen 早于 start()，喂条数前要等一帧。
        if (!await this.nextPopupFrame()) return;
        if (!this.isValid || !this.node.isValid) return;
        this.list.setTotalCount(this._rows.length);
        this.list.scrollToTop(false);
    }

    private _onClose(): void {
        this.closeByButton();
    }

    /** 把一个名次灌进行节点（新建或回收来的），必须同步。 */
    private readonly _renderRow = (node: Node, index: number): void => {
        const entry = this._rows[index];
        const item = node.getComponent(OSDetailRow);
        if (!entry || !item) return;
        item.render(entry);
    };
}
