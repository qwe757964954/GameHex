import { _decorator, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { Toast } from '../common/Toast';
import { OSDetailRow } from './OSDetailRow';
import { celebrationRepository, celebrationSelfRoleId } from './CelebrationRepository';
import type { ICelebrationRankEntry } from './CelebrationRepository';
import { CL_TEXTS } from './CelebrationTexts';

const { ccclass, property } = _decorator;

/**
 * 「详细排名>」二级弹窗（prefab `ui/Celebration/OSRankRankDetail`，720×1280）
 * —— 老端 `LayerOSRankDetailUI`（`ui://开服冲榜/组件_开服冲榜_排行`）。
 *
 * ## 老端只有 78 行，这里对齐它的三件事
 *
 * | 老端 | 落点 |
 * |---|---|
 * | `enterAsync`：发 `CmdGetRankReqMsg{rankType, showNum: 50, unionId}` | `onOpen` 里的 `requestRank(rankType, 50, 自己roleId)` |
 * | `enterAsync`：`lab_key.setText(proxy.RankKey)` | `ColPower.string = rankKey`（open 参数带进来） |
 * | `updateView`：`list.update(rankInfo.rankList)` + `renderItem(0, heroItem, rankInfo.myRank)` | `List.setTotalCount` + `HeroRow.render(myRank)` |
 *
 * ⚠️ **「自己那行」（`heroItem`）不在列表里**：它是独立节点，老端在 `updateView` 里手动
 * `renderItem(0, heroItem, myRank)` 填一次。所以本类也要单独持它 —— 只喂列表条数是不够的。
 *
 * ⚠️ `heroItem` 实例写的是 `controller="显示背景,1"`（不显示）⇒ 它那层 `n0` 背景是关的，
 * 底下另有一张 594×160 的 `n13`（`HeroRowBg`）当底。生成器已把它显式烘成 `false`
 * （`forceActive`），本类**不碰**它 —— 它和"数据有没有回来"无关。
 *
 * ## ⚠️ 老端 `renderItem` 里那句 `item.tm("rank").setText(data.rank || 0)` 是多余的
 *
 * `rank` 是 `组件_开服冲榜_排名`（一个 GComponent，内容是 `lab` + `n10` 两个名次件），
 * 紧跟其后又有一句 `item.tm("rank.lab").setText(data.rank)` —— 真正写数字的是后者。
 * 迁过来只保留 `RankNum` 一处（见 `OSDetailRow`）。
 *
 * ## 名次徽章只有「未上榜 / 第一名」两态
 *
 * 老端 `setSelectedPage("标签", data.rank == -1 ? "未上榜" : "第一名")`
 * —— `标签` 控制器声明了 5 页（第一名/第二名/第三名/第N名/未上榜），**运行时只用了 2 页**，
 * 且页名那 4 档没有任何额外样式（没有金银铜奖章图）。别照 `pages` 去实现 5 种。
 */

/** 老端 `showNum: 50`。 */
export const CL_DETAIL_SHOW_NUM = 50;

/** 打开参数（由 `OSRankPage._onRankDetail` 传）。 */
export interface IOsRankDetailParams {
    /** 排行榜类型（= 庆典的 `rankType`）。 */
    readonly rankType?: number;
    /** 战力口径名（老端 `refConfig.name`，填 `ColPower` 那一格）。 */
    readonly rankKey?: string;
}

@ccclass('OSRankRankDetailPage')
export class OSRankRankDetailPage extends PopupBase {
    static prefabPath = 'ui/Celebration/OSRankRankDetail';

    @property({ type: VirtualScrollView, tooltip: 'List：排行列表（FGUI `list`，item = `OSRankDetailRow`）' })
    list: VirtualScrollView = null;

    @property({ type: OSDetailRow, tooltip: 'HeroRow：自己那一行（FGUI `heroItem`，**不在列表里**，见文件头）' })
    heroRow: OSDetailRow = null;

    @property({ type: Label, tooltip: 'ColPower：表头第三格（FGUI `lab_key`，运行时被 `rankKey` 覆盖）' })
    colPower: Label = null;

    @property({ type: Node, tooltip: 'PopBg/CloseBtn：关闭按钮（FGUI `按钮_关闭`）' })
    closeBtn: Node = null;

    /** 本次拿到的排行行（`renderItemFn` 按 index 现取，规则 55）。 */
    private _rows: readonly ICelebrationRankEntry[] = [];

    protected onInit(): void {
        this.closeBtn?.on('click', this._onClose, this);
        // ⚠️ `renderItemFn` **只绑一次**；数据由 `_rows` 按 index 现取。
        if (this.list) this.list.renderItemFn = this._renderRow;
    }

    protected async onOpen(userData?: IOsRankDetailParams): Promise<void> {
        const rankType = Number(userData?.rankType) || 0;
        const rankKey = typeof userData?.rankKey === 'string' ? userData.rankKey : '';
        if (this.colPower) this.colPower.string = rankKey;

        // 先把两处清空 —— 回包不来就停在空态，**不留上一轮的值**（弹窗是多开复用的）。
        this._rows = [];
        if (this.heroRow) this.heroRow.render(CL_EMPTY_RANK_ENTRY);

        const detail = await celebrationRepository.requestRank(
            rankType,
            CL_DETAIL_SHOW_NUM,
            // ⚠️ 形参叫 `unionId`，老端传的是**自己的 roleId** —— 见 `RequestRankMsg` 文件头。
            celebrationSelfRoleId(),
            this,
        );
        if (!this.isValid || !this.node.isValid) return;
        if (!detail) {
            Toast.show(CL_TEXTS.offlineTip);
            return;
        }

        this._rows = detail.list;
        if (this.heroRow) this.heroRow.render(detail.myRank);

        // `VirtualScrollView` 的槽位在它自己的 `start()` 里建，而 `onOpen` 早于 `start()`
        // ⇒ 不等一帧 `setTotalCount` 会让列表**一片空白**（规则 86）。
        if (!await this.nextPopupFrame()) return;
        if (!this.isValid || !this.node.isValid) return;
        const list = this.list;
        if (!list || !list.node.isValid) return;
        list.setTotalCount(this._rows.length);
        list.scrollToTop(false);
    }

    private _onClose(): void {
        this.closeByButton();
    }

    /** 把一个名次灌进行节点（新建或回收来的）。**必须同步**。 */
    private readonly _renderRow = (node: Node, index: number): void => {
        const entry = this._rows[index];
        const item = node.getComponent(OSDetailRow);
        if (!entry || !item) return;
        item.render(entry);
    };
}

/** 「还没拿到数据」的空行（`rank = -1` ⇒ 显示「未上榜」、名字/战力为空串）。 */
export const CL_EMPTY_RANK_ENTRY: ICelebrationRankEntry = {
    rank: -1,
    roleName: '',
    power: 0,
    usedSkinResId: 0,
};
