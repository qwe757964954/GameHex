/**
 * 红点（FGUI `组件_公用_红点` / `com_rd`）的**状态判定唯一入口**。
 *
 * **零 import 纯函数** —— 可被 Node 用例直接 import（依赖链上禁出现 `cc`）。
 * 落到节点上的事全在 `RedDot.ts`，本文件只回答「给一个计数 + 一个类型，该显示成什么样」。
 *
 * ## 与老端 `GObjRD` 的对齐
 * 来源：`client/assets/script/app/game/fguiExtend/GObjRD.ts`
 * ```
 * OnRDUpdate(rdNum, rdType?, icon?)            // rdNum: boolean | number
 *   rdNum == null              → 0             // 老端显式把 null 当 0
 *   typeof rdNum == 'boolean'  → rdNum && 1 || 0
 *   rdNum <= 0                 → setSelectedPage('是否显示红点', '不显示')
 *   否则                       → 按 '红点类型' 显示
 *                                 数字红点 → title.setText(rdNum)
 *                                 普通红点 → icon.SetSpine('reddot')   ← 红点闪闪，**不是**静态图
 *                                 （新红点走 FGUI 的 gearIcon，直接换 loader 的 url）
 * ```
 * 注意「普通红点」在老端是 **spine 动画**（`resources/塔防/spine/reddot`，动画名 `anmation`，
 * 上游拼写就少一个 i），FGUI XML 里那个 `公用_图标_红点.png` 只是**默认 gearIcon 的静态值**，
 * 运行时代码会把它换成 spine。所以本模块的状态里 `showSpine` 与 `artKey` 是**两个字段**：
 * 有 spine 就播动画，spine 不可用时回退到静态图（不留白）。
 */

/** FGUI `红点类型` 控制器的页序 —— **下标即类型号，别改顺序**（改了就与老端素材/行为错位）。 */
export const RED_DOT_TYPE_PAGES: readonly string[] = ['普通红点', '数字红点', '新红点'];

/** 红点类型 = FGUI `红点类型` 控制器的页下标。 */
export type RedDotType = 0 | 1 | 2;

/** 普通红点（0）。 */
export const RED_DOT_TYPE_ORDINARY: RedDotType = 0;
/** 数字红点（1）——底图换成 `cm_red_dot_num`，并把数字写在上面。 */
export const RED_DOT_TYPE_NUMBER: RedDotType = 1;
/** 新红点（2）——底图换成 `cm_red_dot_new`。 */
export const RED_DOT_TYPE_NEW: RedDotType = 2;
/** 老端 `GetRdType()` 的兜底：没设过类型 = 普通红点。 */
export const RED_DOT_TYPE_DEFAULT: RedDotType = RED_DOT_TYPE_ORDINARY;

/** 要显示的静态图 key（与 `RedDotArt.RED_DOT_ART_NAMES` 的键一一对应）。 */
export type RedDotArtKey = 'ordinary' | 'number' | 'new';

/** 一次「该显示成什么样」的完整描述。每一项都要**绝对赋值**到节点上（对象池复用安全）。 */
export interface IRedDotState {
    /** 整块显不显示；`false` ⇒ 其余字段无意义。 */
    readonly visible: boolean;
    /** 静态图 key；`null` = 不显示静态图。 */
    readonly artKey: RedDotArtKey | null;
    /** 是否播 spine（普通红点 = 老端的「红点闪闪」）。`true` 时 `artKey` 退化成兜底图。 */
    readonly showSpine: boolean;
    /** 数字文案；`''` = 不显示。 */
    readonly text: string;
}

/** 「不显示」——常量复用，避免每次判定都造对象。 */
const HIDDEN: IRedDotState = { visible: false, artKey: null, showSpine: false, text: '' };

/**
 * 计数归一化 —— 复刻老端那两行。
 *
 * ⚠️ 老端的 `rdNum` 是 **`boolean | number`**：调用点大量写的是 `OnRDUpdate(1)` / `OnRDUpdate(0)`
 * / `OnRDUpdate(data.hasRD)`（布尔）。两种都要接得住，否则布尔进到 `<= 0` 比较里
 * `true <= 0` 恒为 false ⇒ 红点永远显示。
 */
export function normalizeRedDotCount(count: number | boolean | null | undefined): number {
    if (count === null || count === undefined) return 0;
    if (typeof count === 'boolean') return count ? 1 : 0;
    if (!Number.isFinite(count)) return 0;
    return Math.floor(count);
}

/** 类型归一化：越界 / 空值一律当普通红点（对齐老端 `GetRdType()`）。 */
export function normalizeRedDotType(type: number | null | undefined): RedDotType {
    if (type === RED_DOT_TYPE_NUMBER) return RED_DOT_TYPE_NUMBER;
    if (type === RED_DOT_TYPE_NEW) return RED_DOT_TYPE_NEW;
    return RED_DOT_TYPE_ORDINARY;
}

/** 类型 → FGUI 控制器页名（只为可读 / 可对账，不参与判定）。 */
export function redDotTypePageName(type: RedDotType): string {
    return RED_DOT_TYPE_PAGES[type] ?? RED_DOT_TYPE_PAGES[0];
}

/**
 * **唯一判定入口**：计数 + 类型 → 该显示成什么样。
 *
 * 数字文案**不做 `99+` 之类的截断** —— 老端 `title.setText(rdNum)` 是原样写，
 * 超长由 Label 的 `SHRINK` 自己收（FGUI 那侧是靠 `singleLine` 溢出）。
 * 想加截断口径就改这里，别在界面代码里各写一份。
 */
export function resolveRedDotState(
    count: number | boolean | null | undefined,
    type: RedDotType | null | undefined = RED_DOT_TYPE_DEFAULT,
): IRedDotState {
    const amount = normalizeRedDotCount(count);
    if (amount <= 0) return HIDDEN;
    const kind = normalizeRedDotType(type);
    if (kind === RED_DOT_TYPE_NUMBER) {
        return { visible: true, artKey: 'number', showSpine: false, text: String(amount) };
    }
    if (kind === RED_DOT_TYPE_NEW) {
        return { visible: true, artKey: 'new', showSpine: false, text: '' };
    }
    // 普通红点：老端把 loader 的内容换成 spine ⇒ 图只作兜底（spine 不可用时不留白）
    return { visible: true, artKey: 'ordinary', showSpine: true, text: '' };
}
