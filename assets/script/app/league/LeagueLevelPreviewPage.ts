/**
 * 「等级预览」弹窗（老端 `play/LayerLeagueHallLevelPreview`，`ui/League/LeagueLevelPreview`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/大厅/组件_联盟_大厅_等级预览.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「等级预览」） | (40,187) 640×905 | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `requestList`（`overflow=scroll`） | (90,252) 540×746 | `RowView`（虚拟列表） |
 * | `defaultItem` = `组件_联盟_等级预览Item`（540×110） | — | `RowView/content/LevelRow` |
 *
 * `popBg` 那组的 relation 是 `center-center,middle-middle`，老端又调了 `toFullCenterParent`
 * ⇒ 弹窗**恒居中**（FGUI 里那对 xy 只是设计态坐标，不用照抄）；弹窗骨架图见
 * `LeagueArt.LEAGUE_POPUP_ART_ROOT` 的说明（跨模块取 `image/common`）。
 *
 * ## 数据：只读配置表，没有网络请求
 *
 * `remoteRef/unionLevel.json`（10 行：`level` / `maxCount` / `exp`）—— 老端也只是读
 * `Ref.RefMgrunionLevel`，不发协议。所以这里**不建 Repository**：`onOpen` 直接取表 + 铺行。
 *
 * 数据量固定 10 行，仍走**虚拟列表** `VirtualScrollView`：与 `FriendApplyPage` 同一套列表口径，
 * 表将来变长也不会挤坏。
 */

import { _decorator, Button, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { RefUtil } from '../../framework/ref/RefUtil';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { LeagueLevelRow } from './LeagueLevelRow';
import {
    buildLeagueLevelViews,
    parseUnionLevelRows,
    LEAGUE_UNION_LEVEL_TABLE,
    type ILeagueLevelView,
} from './LeagueTable';
import { LEAGUE_LEVEL_PREVIEW_TITLE } from './LeagueTexts';

const { ccclass, property } = _decorator;

@ccclass('LeagueLevelPreviewPage')
export class LeagueLevelPreviewPage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueLevelPreview';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    @property({ type: VirtualScrollView, tooltip: 'RowView：等级列表（虚拟列表 + Mask）' })
    levelList: VirtualScrollView = null;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueLevelView[] = [];

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        const button = this.closeButton?.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[League] CloseBtn 上没有 cc.Button，点击不会生效');

        this.levelList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    protected onClose(): void {
        this.revision += 1;
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // ============================================================
    // 取数（只读配置表）
    // ============================================================

    /** 弹窗标题（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get titleText(): string {
        return LEAGUE_LEVEL_PREVIEW_TITLE;
    }

    private async reload(): Promise<void> {
        const revision = ++this.revision;
        const raw = await this.readTable();
        if (!this.alive || revision !== this.revision) return;

        this.rows = buildLeagueLevelViews(parseUnionLevelRows(raw));

        // ⚠️ `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
        //    ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.present();
    }

    /** 读表；表缺失就返回空（界面空着，不崩）。 */
    protected async readTable(): Promise<unknown> {
        try {
            return (await RefUtil.instance.getRefAllAsync(LEAGUE_UNION_LEVEL_TABLE)) ?? [];
        } catch (error) {
            console.warn('[League] 等级表读取失败', error);
            return [];
        }
    }

    private present(): void {
        this.levelList.refreshList(this.rows);
        this.levelList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueLevelRow);
        if (!row) return;
        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.render(view);
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
