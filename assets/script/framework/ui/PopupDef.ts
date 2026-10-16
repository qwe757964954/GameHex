/**
 * PopupDef — 弹窗框架的枚举 / 常量 / 打开参数
 * ------------------------------------------------------------------
 * 对齐 Unity GameFramework（下称 GF）的 UI 模块概念：
 *
 *   PopupLayer          ≈ UIGroup（按深度划分的 UI 组，数值越大越靠上）
 *   IPopupOpenParams    ≈ OpenUIForm 的入参（uiGroupName / pauseCoveredUIForm / userData）
 *   PopupCloseReason    ≈ GF 无对应项；用于让业务区分「谁关的」，
 *                         典型场景是「点空白关闭」需要弹二次确认时按来源分支。
 *
 * 本文件刻意不引用 PopupBase / PopupManager，避免循环依赖：
 * 定义层只描述「数据结构」，实现层（PopupBase / PopupManager）单向依赖它。
 * ------------------------------------------------------------------
 */

/**
 * 弹窗层级。
 * 深度排序规则：先比 popupLayer，再比打开先后（serialId）。
 * 即同层弹窗后开的盖住先开的，高层弹窗永远盖住低层弹窗。
 */
export enum PopupLayer {
    /** 普通弹窗：活动、详情、设置等会被互相覆盖的业务弹窗。 */
    NORMAL = 0,
    /** 系统弹窗：提示 / 确认框，永远压在所有 NORMAL 弹窗之上。 */
    SYSTEM = 1,
    /** 顶层：加载圈、断线重连、跑马灯等必须可见的提示。 */
    TOP = 2,
}

/** PopupLayer 的中文名，仅用于日志。 */
export const POPUP_LAYER_NAMES: Readonly<Record<PopupLayer, string>> = {
    [PopupLayer.NORMAL]: 'Normal',
    [PopupLayer.SYSTEM]: 'System',
    [PopupLayer.TOP]: 'Top',
};

/**
 * 弹窗关闭来源。
 * 业务在 onClose(reason) 里可以据此区分「玩家点空白误触」与「主动点关闭」。
 */
export enum PopupCloseReason {
    /** 业务代码主动调用 close()。 */
    Manual = 0,
    /** 基类的「点击空白关闭」触发。 */
    Blank = 1,
    /** 关闭按钮触发（子类调用 close(CloseButton) 时传入）。 */
    CloseButton = 2,
    /** 被 PopupManager.closeAll() / 流程切换统一关闭。 */
    Force = 3,
}

/** 弹窗从创建到关闭的统一生命周期状态。 */
export enum PopupLifecycleState {
    Closed = 'closed',
    Opening = 'opening',
    Open = 'open',
    Closing = 'closing',
}

/** 常驻弹窗根节点在场景里的固定名字。 */
export const POPUP_ROOT_NAME = 'Popup';

/**
 * 「点击空白关闭」的移动容差（像素）。
 * 按下到抬起之间的 UI 位移超过该值就视为拖拽（列表滑动 / 摇杆），
 * 不当成点击，避免滑动列表时把弹窗关掉。
 */
export const POPUP_BLANK_TOLERANCE = 12;

/**
 * 打开弹窗的参数。
 * @typeParam T userData 的类型，业务自定义（列表数据、回调上下文等）。
 */
export interface IPopupOpenParams<T = any> {
    /** 业务数据，原样透传给 PopupBase.onOpen(userData)。 */
    userData?: T;
    /** 临时指定层级；省略则用弹窗自身 Inspector 上的 popupLayer。 */
    layer?: PopupLayer;
    /** 临时覆盖「点击空白关闭」；省略则用弹窗自身 Inspector 上的 closeOnBlank。 */
    closeOnBlank?: boolean;
    /**
     * 关闭后是否回收进实例池以便下次复用。
     * 默认 false（关闭即销毁），因为 UI prefab 实例化成本不高，
     * 而复用要保证 onOpen 里重置掉全部状态，容易漏。
     */
    cache?: boolean;
    /**
     * 是否允许同一弹窗类同时存在多个实例。默认 false：已打开则返回现有实例，
     * 正在加载则复用同一次打开任务。只有确认需要同类多开的业务才应设为 true。
     */
    allowMultiple?: boolean;
    /** 关闭回调，在弹窗 onClose 之后触发（无论何种关闭来源都会调用一次）。 */
    onClose?: (reason: PopupCloseReason) => void;
}

/** PopupBase.open() 的等价别名，便于业务书写。 */
export type PopupOpenParams<T = any> = IPopupOpenParams<T>;
