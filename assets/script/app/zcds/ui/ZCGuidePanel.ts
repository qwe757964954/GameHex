/**
 * ZCGuidePanel —— 战斗「指南」页面（挂在 ZCGuidePanel.prefab 根节点上）。
 *
 * 继承 PopupBase，由 PopupManager 统一调度（挂到常驻节点 `Popup` 下、参与深度排序、
 * 点击空白处自动关闭）。
 *
 * 结构（对齐参考图 assets/resources/image/战斗_指南.png）：
 *   ZCGuidePanel(720×1280, 层级 UI_2D)
 *     Panel          羊皮纸面板 bg_05（九宫格拉伸到 616×1109）
 *       TitleBar     木质标题条 title_01 + TitleLab（「指南」）
 *       ListView     虚拟列表（VirtualScrollView + Mask），条目由 ZCGuideItem 渲染
 *         content    列表内容容器（锚点 0.5/1，条目按行挂到这里）
 *       FooterLab    底部说明
 *       CloseBtn     右上角关闭 btn_close
 *
 * 列表使用 VirtualScrollView 的「等大小模式」：条目高度固定 184，仅渲染可视区
 * 内的槽位，滚动时复用节点 —— 后续指南条目涨到几十上百条也不会增加节点数。
 *
 *  列表几何约定（VirtualScrollView 不做锚点补偿，很容易踩）：
 *   它把 content.position.y 直接当作滚动偏移（0 = 列表顶部），槽位在 content 本地
 *   坐标里排在 y = -(行号 * itemMainSize + itemMainSize/2)，等价于
 *   「content 的原点 = 第一张卡的上边缘」。因此：
 *     ListView（视窗）锚点必须是 (0.5, 1)，content 锚点 (0.5, 1) 且 lpos (0, 0)；
 *   若 ListView 用常见的中点锚点 (0.5, 0.5)，整条列表会下移半个视口高
 *   （976 / 2 = 488px），表现为「首卡上方一大片空白 + 列表溢出视窗底部」。
 *
 *  列表配置全部走 Inspector 绑定（VirtualScrollView 的「容器节点 / 启用虚拟列表 /
 * 创建模式 / 子项预制体」），脚本不再运行时覆盖：一来抢在 start() 之前用代码赋值
 * 容易和编辑器里的配置打架，二来会把同一份配置散到代码和 prefab 两处。
 * 脚本只负责喂数据和提供渲染回调（renderItemFn / onItemClickFn）。
 *
 * 打开方式：
 *   // 对局流程预加载完成后，由 ZCGame 传入已准备的 content。
 *   ZCGuidePanel.open({ userData: { content } });
 */

import {
    _decorator,
    Button,
    Label,
    Node,
    Sprite,
    SpriteFrame,
} from 'cc';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import type { ZCGuidePreparedContent } from '../application/ZCGuideLoader';
import type { ZCGuideEntry, ZCGuideParams } from '../model/ZCGuideConfig';
import { ZCGuideItem } from './ZCGuideItem';

const { ccclass, property } = _decorator;

const EMPTY_PARAMS: ZCGuideParams = {
    panelTitle: '指南',
    footerText: '',
    emptyText: '暂无指南内容',
};

/** ZCGuidePanel.open 的 userData 结构。 */
export interface ZCGuidePanelOptions {
    /** 由对局预加载器准备；Popup 不做配置读取或资源加载。 */
    readonly content: ZCGuidePreparedContent;
}

/**
 * 战斗指南面板。
 * 只负责展示与关闭，不改动对局状态；对局暂停/恢复由上层决定。
 */
@ccclass('ZCGuidePanel')
export class ZCGuidePanel extends PopupBase {
    /** 预制体路径（PopupManager 据此加载）。 */
    static prefabPath = 'ui/game/ZCGuidePanel';

    @property({ type: Sprite, group: '面板', tooltip: 'Panel：羊皮纸底 bg_05' })
    panelBg: Sprite = null;

    @property({ type: Label, group: '面板', tooltip: 'TitleBar/TitleLab：面板标题' })
    titleLabel: Label = null;

    @property({ type: Button, group: '面板', tooltip: 'CloseBtn：右上角关闭按钮' })
    closeButton: Button = null;

    @property({ type: Label, group: '面板', tooltip: 'FooterLab：底部说明文案' })
    footerLabel: Label = null;

    @property({ type: VirtualScrollView, group: '列表', tooltip: 'Panel/ListView：虚拟滚动列表（条目预制体等配置在它自己身上绑）' })
    listView: VirtualScrollView = null;

    private entries: ZCGuideEntry[] = [];
    private iconFrames: ReadonlyMap<string, SpriteFrame> = new Map();

    /** 当前展示的条目数，供上层/调试读取。 */
    get entryCount(): number {
        return this.entries.length;
    }

    
    // PopupBase 生命周期
    

    /** Popup 只消费预加载结果，因此打开过程无异步竞争。 */
    protected onOpen(userData?: ZCGuidePanelOptions): void {
        const content = userData?.content;
        this.entries = content ? [...content.entries] : [];
        this.iconFrames = content?.iconFrames ?? new Map();
        this.applyParams(content?.params ?? EMPTY_PARAMS);
        this.refreshList();
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 回调在 onInit 绑定一次，关闭时只清数据，复用节点不会读到上一轮内容。
        this.entries = [];
        this.iconFrames = new Map();
        this.listView.refreshList(0);
    }

    protected onInit(): void {
        this.bindEvents();
        //  赋**具名方法 + `.bind(this)`**（规范 §7.5 配套第 3 条）：`VScrollView` 侧是
        // `this.renderItemFn(itemNode, i)` 的方法调用语法，不绑的话函数里的 `this` 会是它。
        // 只在这里绑一次：`PopupBase` 保证 `onInit` 每实例跑一次（`onEnable` 会被实例池反复触发，
        // 在那儿补绑才是会叠监听的那种写法 —— 规范 7.2）。
        this.listView.renderItemFn = this.renderItem.bind(this);
    }

    /**
     * 列表条目的渲染回调：虚拟列表会复用节点，所以按下标**现取**本趟数据（不闭包捕获）。
     */
    private renderItem(itemNode: Node, index: number): void {
        const entry = this.entries[index];
        const item = itemNode.getComponent(ZCGuideItem);
        // `getComponent` 的类型契约可空：条目节点没挂脚本时跳过（这不是 Inspector 引用）。
        if (!item) return;
        if (!entry) {
            item.clear();
            return;
        }
        item.render(entry, this.iconFrames);
    }

    
    // 内部实现
    

    private applyParams(params: ZCGuideParams): void {
        this.titleLabel.string = params.panelTitle;
        this.footerLabel.string = params.footerText;
    }

    /**
     * 把条目数据灌进虚拟列表。
     * 列表模式（启用虚拟列表 / 创建模式 / 子项预制体）由 prefab 里 Inspector 的绑定决定，
     * 这里只挂渲染回调 + 数据长度，不再覆盖列表配置。
     */
    private refreshList(): void {
        // renderItemFn 在 onInit 只绑定一次；它按 index 读取 entries/iconFrames。
        this.listView.refreshList(this.entries);
    }

    private bindEvents(): void {
        this.closeButton.node.on(Button.EventType.CLICK, this.closeByButton, this);
    }
}
