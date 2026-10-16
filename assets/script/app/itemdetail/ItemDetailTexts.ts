/**
 * 物品详情 + 10级领取的**全部文案**（唯一出口）。
 *
 * 与 `RoleTexts` / `CelebrationTexts` 同一口径：改文案只动这一处，页面脚本里**不许**
 * 出现中文字符串字面量（单测会扫源码文本）。
 *
 * 静态文案的真源 = FGUI XML 的 `text="…"` 属性：
 *   · `组件_角色_道具详情.xml`：`品质:` / `数量:` / `道具说明` / `内容` / `获取途径` / `前往` / `合成`
 *   · `组件_主界面_领取武将.xml`：`10级领取`（`n5`）
 *   · `组件_角色_道具详情_项.xml`：`商店`（`lab`，运行时被途径文案覆盖）
 */

/** 物品详情（`ui/ItemDetail/ItemDetail`）。 */
export const ITEM_DETAIL_TEXTS = {
    /** 品质标签前缀（FGUI `n9` 的 `品质:`）。 */
    qualityLabel: '品质:',
    /** 数量标签前缀（FGUI `n11` 的 `数量:`）。 */
    countLabel: '数量:',
    /** 描述区标题（FGUI `n13` 的 `道具说明`）。 */
    descTitle: '道具说明',
    /** 内容区标题（FGUI `n31` 的 `内容`）。 */
    contentTitle: '内容',
    /** 获取途径标题（FGUI `n23` 的 `获取途径`）。 */
    accessTitle: '获取途径',
    /** 有内容可使用时按钮文案（FGUI `btn_go` 的 `Button title="前往"`）。 */
    goBtn: '前往',
    /** 无内容可使用时按钮文案（FGUI `btn_go1` 的 `Button title="前往"`）。 */
    goBtn1: '前往',
    /** 合成按钮（FGUI `btn_compos` 的 `Button title="合成"`）。 */
    composBtn: '合成',
    /** 表里查不到这个 `resId` 时的兜底物品名。 */
    unknownName: '未知物品',
    /** 表里没写 `desc` 时的兜底描述。 */
    noDesc: '暂无描述',
    /** `access` 为空（或 viewtype 全查不到）时的占位行。 */
    noAccess: '暂无获取途径',
    /** 「前往」目标没接线时的宿主提示（跳转链路本工程未接）。 */
    jumpNotWired: '跳转未接入',
    /** 合成的提示（本工程只做入口，未接合成弹窗）。 */
    composNotWired: '合成未接入',
} as const;

/**
 * 占位符格式化（`{0}` / `{1}` …）。只支持顺序替换 —— 与 `CelebrationTexts.formatText` 同款，
 * 别引 `StringUtil`（那会把 `cc` 拉进零依赖层）。
 */
export function formatText(template: string, ...args: readonly (string | number)[]): string {
    let out = template;
    for (let i = 0; i < args.length; i += 1) {
        out = out.split(`{${i}}`).join(String(args[i]));
    }
    return out;
}
