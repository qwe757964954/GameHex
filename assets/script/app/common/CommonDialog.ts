/**
 * CommonDialog — 通用弹窗外壳（`ui/common/CommonDialog`）
 * ------------------------------------------------------------------
 * 提供「背景 + 木牌标题 + 右上角关闭按钮 + 内容插槽」四件套，
 * 生命周期与「点空白关闭」全部由 PopupBase 负责，业务只需：
 *
 *   1. `CommonDialog.open({ userData: { title: '宝箱详情' } })`
 *   2. 把业务内容挂到 `contentRoot` 下（或直接继承本类）
 *
 * 尺寸约定（预制体已配好，改尺寸只动 Panel 一个节点）：
 *   · Root 四边 Widget —— 铺满任意分辨率；
 *   · Panel 水平/垂直居中 Widget —— 永远居中，尺寸可自由调整；
 *   · Content 四边 Widget —— Panel 改多大，内容区自动跟随。
 */

import {
    _decorator,
    Button,
    Label,
    Node,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';

const { ccclass, property } = _decorator;

/** CommonDialog 的 userData 结构。 */
export interface ICommonDialogOptions {
    /** 标题文案；缺省时保留预制体上的默认文案 */
    title?: string;
}

@ccclass('CommonDialog')
export class CommonDialog extends PopupBase {
    static prefabPath = 'ui/common/CommonDialog';

    @property({ group: '外壳', tooltip: '标题文字' })
    titleLabel: Label = null!;

    @property({ group: '外壳', tooltip: '右上角关闭按钮，点击关闭本弹窗' })
    closeButton: Button = null!;

    @property({ group: '外壳', tooltip: '内容插槽：业务内容挂到这个节点下' })
    contentRoot: Node = null!;

    protected onInit(): void {
        this.closeButton.node.on(Button.EventType.CLICK, this.closeByButton, this);
    }

    protected onOpen(userData?: ICommonDialogOptions): void {
        if (userData?.title) this.titleLabel.string = userData.title;
    }

    /** 打开后修改标题（初始化时用 `userData.title` 即可）。 */
    setTitle(title: string): void {
        this.titleLabel.string = title;
    }
}
