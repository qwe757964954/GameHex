/**
 * 「邮件」模块的全部文案 —— **改文案只动这一个文件**。
 *
 * 来源（逐条可回溯）：
 *   · FGUI `邮件/组件/组件_邮件_主界面.xml`：`Button title`「一键删除」「一键领取」、
 *     `文本_无邮件提示`「邮箱内没有任何信件」、`文本_自动删除提示`（带 `vars="true"` 占位）
 *   · FGUI `邮件/组件/组件_邮件_邮件内容.xml`：`Button title`（`gearText` 的两页「领取」「删除」）
 *   · FGUI `邮件/组件/组件_邮件_主界面Item.xml`：`状态`（`gearText` 的「已领取」/ default「已读」）
 *   · 老端 `LayerMail.ts` 的 `FW.showTip(FW.G_W("MAIL_NO_DELETABLE"))` 与 `PanelDialog` 配置
 *
 * ⚠️ 占位符统一用 `{0}` 形式（不用老端的 `StringUtil.format` 的 `%s`），
 *   由 `formatText` 替换 —— 与本模块其余文案同一口径。
 */

/** `{0}` / `{1}` 顺序替换；缺参保留原样（便于一眼看出漏传）。 */
export function formatText(template: string, ...args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (whole, indexText: string) => {
        const index = Number(indexText);
        const value = args[index];
        return value === undefined || value === null ? whole : String(value);
    });
}

/** 两个弹窗的标题（老端都是 `FW.G_W("MAIL_TITLE")`）。 */
export const MAIL_TITLE = '邮件';
export const MAIL_DETAIL_TITLE = '邮件';

/** 主界面底部两个大按钮（FGUI `Button title` 原值）。 */
export const MAIL_BTN_DELETE_ONE_KEY = '一键删除';
export const MAIL_BTN_TAKE_ONE_KEY = '一键领取';

/** 详情页按钮的两态（FGUI `gearText controller="是否领取" pages="0,1" values="领取|删除"`）。 */
export const MAIL_BTN_TAKE = '领取';
export const MAIL_BTN_DELETE = '删除';

/** 空态（FGUI `文本_无邮件提示` 原值）。 */
export const MAIL_EMPTY = '邮箱内没有任何信件';

/**
 * 自动删除提示（FGUI `文本_自动删除提示` 的 `vars="true"` 原文）：
 * `超过{day=0}天未领取或未领取总数超出{count=0}的将会自动删除`
 * ⇒ `{0}` = `mailValid`（40 天）、`{1}` = `maxMailNum`（50），两个都来自 `gameConfig` 表。
 */
export const MAIL_AUTO_DELETE_TEMPLATE = '超过{0}天未领取或未领取总数超出{1}的将会自动删除';

/** 行内状态文本（FGUI `状态` 的 `gearText`：page=2 →「已领取」，default「已读」）。 */
export const MAIL_STATE_READ = '已读';
export const MAIL_STATE_TAKEN = '已领取';

/** 时间文案（老端 `TimeUtil.timeSec2HMSStr15` 的四档）。 */
export const MAIL_TIME_DAYS = '{0}天前';
export const MAIL_TIME_HOURS = '{0}小时前';
export const MAIL_TIME_MINUTES = '{0}分钟前';
export const MAIL_TIME_JUST_NOW = '刚刚';

/** 一键删除的二次确认（老端 `LayerMail` 里硬编码的 `DialogConfig`）。 */
export const MAIL_DELETE_CONFIRM = '确定要删除已读邮件吗？';
export const MAIL_CONFIRM_OK = '确定';
export const MAIL_CONFIRM_CANCEL = '取消';

/** 提示（老端 `FW.showTip` 的对应键，键名留在注释里便于回溯）。 */
export const MAIL_TIP_NO_DELETABLE = '没有可删除的邮件'; // MAIL_NO_DELETABLE
export const MAIL_TIP_TAKE_NONE = '没有可领取的邮件';
export const MAIL_TIP_TAKE_OK = '领取成功';
export const MAIL_TIP_DELETE_OK = '删除成功';
export const MAIL_TIP_REQUEST_FAILED = '操作失败，请稍后再试';
export const MAIL_TIP_OFFLINE = '网络未连接，操作未生效';
