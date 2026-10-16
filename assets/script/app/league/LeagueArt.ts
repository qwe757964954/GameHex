/**
 * 「联盟」美术资源的**唯一入口** —— 要联盟的图名 / 九宫格口径，都从这里取。
 *
 * 目录：`assets/resources/image/league/`（本模块的图保留 FGUI 原名：`TY_btn17` / `title_btn` /
 * `lm_pic10` / `img_Qizhi_0N` …；只有三张背景从 `lianmeng_bg0N` 改名为 `lm_bg0N`）。
 *
 * ⚠️ 本文件**保持引擎无关**（不 import `cc`）——`tests/league.test.ts` 直接 import 它断言
 *    图名与颜色表口径（同 `FriendArt` / `GiftArt` 的分工）。真正的 `loadArt` 在页面类里调。
 *
 * ## 跨包来源（为什么这些图在联盟包里）
 *
 * FGUI `主界面_联盟` 的按钮底图**不在联盟包内**，而是引用了公用包（`公用0`，包 id `w3m64m87`）：
 *   红 `7ws21yxnalp` = `TY_btn17.png`
 *   棕 `7ws21yxnam4` = `TY_btn18.png`
 *   蓝 `7ws21yxnam3` = `TY_btn19.png`
 * 「玩法标题」用的 `tro83h` 才是联盟包自己的 `title_btn.png`。
 * 帮助按钮 `tohz1yxnajz` 来自公用包 = `zx_btn01.png`。
 * ⇒ 这 5 张是**按公用包 id 反查文件名**拷进来的，不是按图名猜的。
 *
 * ## 九宫格
 *
 * 联盟主页用到的这几张（`TY_btn17/18/19`、`title_btn`、`lm_bg01`、`img_Qizhi_*`、`icon_lm07`、
 * `zx_btn01`）在 FGUI 里**都没有 `scale="9grid"`** ⇒ 一律 `SIMPLE`，
 * 下面 `LEAGUE_ART_SLICED` 为空集是**有意**的（后续面板的大底板才需要九宫格）。
 *
 * ⚠️ P4 起本文件**多了两条对活动模块的 import**（`LayerActivityArt` / `LayerActivityTable`）——
 *    奖励图标的两支分流（`item` 直通 / `roleProperty` 落 `icons/resource`）是**全工程唯一入口**，
 *    活动、战令、礼包、邮件、挂机都在转它；联盟再抄一份就是第六份重复实现。
 *    这两个模块本身**不 import `cc`**（纯表/纯函数）⇒ 本文件仍保持引擎无关，单测可直连。
 */

import { RESOURCE_ICON_ART_ROOT, resolveRewardIconRef } from '../activity/LayerActivityArt';
import { rewardGoodsOf } from '../activity/LayerActivityTable';
import type { IActivityGoodsInfo } from '../activity/LayerActivityTable';
// ⚠️ **只 import 类型**：`LeagueTable` 反向 import 本文件的 `LeagueButtonColor`，
//    两边都是 `import type` ⇒ 编译后**双向都消失**，运行期没有环。
//    （若哪天改成 `import { … }` 取值，就真的成环了 —— esbuild/tsx 下未必立刻炸，
//     但打包器会把两份模块图拉成一坨，别冒这个险。）
import type { LeagueTaskBoxState } from './LeagueTable';

/** 联盟自有图目录（`loadArt(name, LEAGUE_ART_ROOT)` 用；不带 `resources/` 前缀）。 */
export const LEAGUE_ART_ROOT = 'image/league';

/** 整屏背景（FGUI `loader bg`，720×1742，刻意比 720×1280 的画布高，用来盖住长屏）。 */
export const LEAGUE_ART_BG = 'lm_bg01';

/** 主页底部「联盟信息条」的底框（FGUI `n29`，232×132）。 */
export const LEAGUE_ART_INFO_BG = 'lm_pic10';

/** 联盟旗帜：外框（选中态）/ 底 / 8 色旗面。 */
export const LEAGUE_ART_BANNER_FRAME = 'img_Qizhi_02';
export const LEAGUE_ART_BANNER_BASE = 'icon_lm07';

/** 帮助按钮（FGUI `btn_help`，公用包 `zx_btn01`，61×62）。 */
export const LEAGUE_ART_HELP = 'zx_btn01';

/**
 * 六个入口按钮的底图（`颜色` 语义 → 图名）。
 *
 * ⚠️ 不是「一个按钮一张图」：`棕` 被三个入口复用（每日砍价 / 联盟任务 / 联合战线），
 *    所以这里是按**颜色**取图，由 `LeagueTable` 的入口表决定每个入口用哪种颜色。
 */
export const LEAGUE_ART_BTN_RED = 'TY_btn17';
export const LEAGUE_ART_BTN_BROWN = 'TY_btn18';
export const LEAGUE_ART_BTN_BLUE = 'TY_btn19';
/** 「玩法标题」专用（比其余三色宽：206×54 vs 186×44）。 */
export const LEAGUE_ART_BTN_TITLE = 'title_btn';

// ============================================================
// 大厅（`ui/League/LeagueHall`）用图
// ============================================================

/** 大厅整屏背景（FGUI `bg` loader = `lianmeng_bg02`，720×1280）。 */
export const LEAGUE_ART_HALL_BG = 'lm_bg02';

/** 大厅顶部装饰外框（FGUI `n24`，`lm_kj_pic08`，720×502，**无 size ⇒ 原尺寸**）。 */
export const LEAGUE_ART_HALL_FRAME = 'lm_kj_pic08';

/** 公告底板（FGUI `n21` = `tro83j` = `frame_Zhikuang02`，595×91，九宫格 `112,22,63,44`）。 */
export const LEAGUE_ART_NOTICE_BG = 'frame_Zhikuang02';

/** 详情页签外框（FGUI `n35` = `tro83k` = `frame_Dikuang03`，720×650，九宫格 `147,110,100,112`）。 */
export const LEAGUE_ART_DETAIL_FRAME = 'frame_Dikuang03';

/** 详情表头 / 全服查询底板（FGUI `lm_pic07`，九宫格 `121,46,13,13`）。 */
export const LEAGUE_ART_PIC07 = 'lm_pic07';

/** 全服查询输入框底板（FGUI `frame_shurukuang`，九宫格 `13,12,5,7`）。 */
export const LEAGUE_ART_INPUT_BG = 'frame_shurukuang';

/** 全服查询按钮（FGUI `hknqe` = `hy_btn02`，65×55）。 */
export const LEAGUE_ART_SEARCH_BTN = 'hy_btn02';

/** 复制按钮（FGUI `league_copyid` / `league_copywx` = `hknqo` = `lm_btn01`，28×30 显示）。 */
export const LEAGUE_ART_COPY = 'lm_btn01';

/** 底部页签栏底板（公用包 `diban_BG`，九宫格 `347,69,38,7`）。 */
export const LEAGUE_ART_BOTTOM_BAR = 'diban_BG';

/** 返回按钮底图（公用包 `btn_FanHui`，115×119）。 */
export const LEAGUE_ART_BACK = 'btn_FanHui';

/** 管理按钮底图（FGUI `fyt_pic07`，111×50）。 */
export const LEAGUE_ART_MGR_BTN = 'fyt_pic07';

/** 大厅页签「未选中」底图（公用包 `TY_btn13`，168×132，显示 scale 0.7）。 */
export const LEAGUE_ART_TAB_UP = 'TY_btn13';

/** 大厅页签「选中」底图（公用包 `TY_btn14`，168×132，显示 scale 0.7）。 */
export const LEAGUE_ART_TAB_DOWN = 'TY_btn14';

/** 经验进度条底板（公用包 `bar_bg_01`，九宫格 `15,16,9,11`）。 */
export const LEAGUE_ART_PROGRESS_BG = 'bar_bg_01';

/** 经验进度条填充（公用包 `bar_bg_01_hong`）。 */
export const LEAGUE_ART_PROGRESS_FILL = 'bar_bg_01_hong';

// ---- 底部三个页签的图标（在**主界面图标目录** `icons/main/`，已随主界面导入）----

/** 页签图标所在的资源目录（`loadArt(name, LEAGUE_TAB_ICON_ROOT)`）。 */
export const LEAGUE_TAB_ICON_ROOT = 'icons/main';

/** 三个页签（FGUI `按钮_大厅页签` 的 `类型` controller：0=详情 / 1=动态 / 2=全服联盟）。 */
export const LEAGUE_HALL_TAB_ARTS: readonly {
    readonly up: string;
    readonly down: string;
}[] = [
    { up: 'lM_icon_xiangqing_1', down: 'lM_icon_xiangqing' },
    { up: 'lM_icon_dongtai_1', down: 'lM_icon_dongtai' },
    { up: 'lM_icon_QFlianmeng_1', down: 'lM_icon_QFlianmeng' },
] as const;

/** 页签下标 → 图标图名（`selected` 取选中态 / 未选中态）。越界就近夹取。 */
export function leagueTabIconArt(tabIndex: number, selected: boolean): string {
    const index = Number.isFinite(tabIndex) ? Math.trunc(tabIndex) : 0;
    const clamped = Math.min(Math.max(index, 0), LEAGUE_HALL_TAB_ARTS.length - 1);
    const entry = LEAGUE_HALL_TAB_ARTS[clamped];
    return selected ? entry.down : entry.up;
}

/** 按钮颜色语义。 */
export type LeagueButtonColor = 'red' | 'brown' | 'blue' | 'title';

/** 按钮颜色 → 底图名。 */
export function leagueButtonArt(color: LeagueButtonColor): string {
    switch (color) {
        case 'red':
            return LEAGUE_ART_BTN_RED;
        case 'blue':
            return LEAGUE_ART_BTN_BLUE;
        case 'title':
            return LEAGUE_ART_BTN_TITLE;
        default:
            return LEAGUE_ART_BTN_BROWN;
    }
}

// ============================================================
// 旗帜 8 色（FGUI `组件_联盟_旗帜` 的 `颜色` controller）
// ============================================================

/**
 * `颜色` controller 的页序（`pages="1,绿,2,蓝,3,紫,4,红,5,橙,6,黄,7,金,8,青"`）。
 *
 * ⚠️ **图名顺序与颜色名顺序不一致**，别按直觉排 —— 这是照 `gearIcon` 的 `values`
 *    逐个 id 回查 `package.xml` 得到的（`k49h3r` = `img_Qizhi_06`，不是 `img_Qizhi_03`）。
 */
export const LEAGUE_BANNER_COLORS: readonly { readonly name: string; readonly art: string }[] = [
    { name: '绿', art: 'img_Qizhi_06' },
    { name: '蓝', art: 'img_Qizhi_11' },
    { name: '紫', art: 'img_Qizhi_07' },
    { name: '红', art: 'img_Qizhi_08' },
    { name: '橙', art: 'img_Qizhi_09' },
    { name: '黄', art: 'img_Qizhi_05' },
    { name: '金', art: 'img_Qizhi_10' },
    { name: '青', art: 'img_Qizhi_04' },
] as const;

/** 颜色页数（fgui 里 8 页）。 */
export const LEAGUE_BANNER_COLOR_COUNT = LEAGUE_BANNER_COLORS.length;

/** 联盟旗帜默认色（`selected="0"` ⇒ 第 1 页 = 绿）。 */
export const LEAGUE_BANNER_DEFAULT_COLOR = 0;

/**
 * 颜色下标 → 旗面图名。越界**就地夹取**（不抛）—— 服务端下发的是裸数字，
 * 表里将来增删颜色时旧存档不应把界面打崩。
 */
export function leagueBannerArt(colorIndex: number): string {
    const index = Number.isFinite(colorIndex) ? Math.trunc(colorIndex) : 0;
    const clamped = Math.min(Math.max(index, 0), LEAGUE_BANNER_COLOR_COUNT - 1);
    return LEAGUE_BANNER_COLORS[clamped].art;
}

/** 颜色下标 → 中文色名（工具提示 / 调试用）。 */
export function leagueBannerColorName(colorIndex: number): string {
    const index = Number.isFinite(colorIndex) ? Math.trunc(colorIndex) : 0;
    const clamped = Math.min(Math.max(index, 0), LEAGUE_BANNER_COLOR_COUNT - 1);
    return LEAGUE_BANNER_COLORS[clamped].name;
}

// ============================================================
// 公共弹窗骨架（各子面板共用）
// ============================================================

/**
 * 弹窗骨架里**标题条 / 装饰条 / 闭钮**的图目录。
 *
 * ⚠️ **不在 `image/league/`**：FGUI 联盟各弹窗（退出提示 / 等级预览 / 申请列表 / 联盟信息 /
 * 管理 / 编辑信息）的 `popBg` 引的都是**公用包**的 `组件_公共弹窗_新`
 * （`共用组件/组件/弹窗/组件_公共弹窗_新.xml`，包 id `5ibsib88`）——
 * 标题条 / 装饰条 / 闭钮一律是公用素材，联盟包自己没有这套图。
 *
 * 新端这套素材落在工程既有的 **`image/common/`**（`app/common/CommonTips` 用的就是它，
 * 见 `ui/common/CommonTips.prefab`），所以这里**跨模块取图**，走 `loadCommonArt`
 * 而不是本模块的 `loadArt`。
 */
export const LEAGUE_POPUP_ART_ROOT = 'image/common';

/**
 * 弹窗**真底板**（公用0 `panel_window_01_9gong.png`，394×307，九宫格 `129,128,123,36`）。
 *
 * ⚠️ 这条是**第四刀补进来的**，也是本模块唯一一张放在 `image/league/` 的公用图 ——
 *    原因口径同 `TY_btn17/18/19`：按公用包资源 id 反查文件名后**拷进本模块目录**
 *    （联盟图目录没有 auto-atlas，九宫格不会被图集重打包破坏）。
 *
 * 为什么替换掉前两刀用的 `bg_04`(651×982) / `bg_05`(582×404)：那两张是**定尺寸**图
 * （`border` 全 0），只能等比拉伸。联盟这几个弹窗的高度各不相同
 * （等级预览 905 / 管理 979 / 联盟信息 771 / 申请列表 706 / 编辑信息 437），
 * 用它们顶替会把四角的「撕边」压扁 —— 尤其 640×706 这种既非窄长也非扁平的尺寸，
 * 横竖都变形。真底板是九宫格，任意尺寸都不变形，所以六个弹窗统一改用它。
 */
export const LEAGUE_ART_POPUP_BOARD = 'panel_window_01_9gong';

/** 真底板所在的资源目录（`image/league`，不是 `image/common`）。 */
export const LEAGUE_POPUP_BOARD_ROOT = 'image/league';

/** 弹窗标题条（公用 `title_01`，600×66）。 */
export const LEAGUE_ART_POPUP_TITLE_BG = 'title_01';

/** 弹窗标题装饰条（公用 `title_02`，253×44，压在标题条上）。 */
export const LEAGUE_ART_POPUP_TITLE_DECO = 'title_02';

/** 弹窗右上关闭按钮（公用 `btn_close`，54×51）。 */
export const LEAGUE_ART_POPUP_CLOSE = 'btn_close';

// ============================================================
// 通用按钮（`按钮_公共_通用` 的底图）
// ============================================================

/**
 * 「主操作」按钮底（同意 / 确定）：公用 `TY_btn10`（210×77）。
 *
 * ⚠️ **按 SIMPLE 用**（不进 `LEAGUE_ART_SLICED`）。FGUI `package.xml` 给它标的是
 *    `scale9grid="54,0,7,77"`，而图只有 77 高 ⇒ `top + bottom = 77 = 高`，**垂直中缝为 0**。
 *    带这种退化九宫格拉到 218×106 时，多出的 29px 只能由「源图第 0 行」去撑 ——
 *    渲染出来是**顶边那条深色描边被拉成 29px 的暗带**（比整图等比拉伸丑得多）。
 *    同样口径见 `tmp/_art_import_league.mjs` 的 SPEC 注释。
 */
export const LEAGUE_ART_BTN_OK = 'TY_btn10';

/** 「次操作」按钮底（拒绝 / 取消）：公用 `TY_btn09`（210×77，同样按 SIMPLE 用）。 */
export const LEAGUE_ART_BTN_CANCEL = 'TY_btn09';

// ============================================================
// 等级预览（`ui/League/LeagueLevelPreview`）用图
// ============================================================

/** 等级行底框（公用 `frame_Zhikuang01`，155×113，九宫格 `38,28,76,56`；显示 540×110）。 */
export const LEAGUE_ART_LEVEL_ROW_BG = 'frame_Zhikuang01';

/** 等级行「等级N」的深色半透明衬底（公用 `BB_img03`，233×31，显示 470×40 @ alpha 0.5）。 */
export const LEAGUE_ART_LEVEL_ROW_TITLE_BAR = 'BB_img03';

/**
 * 等级行副文案的浅色半透明衬底（公用 `white_jiao8`，24×24，九宫格 `13,9,0,6`；显示 430×32 @ alpha 0.4）。
 *
 * ⚠️ **原图是纯白**，FGUI 那条 loader 还带 `color="#cbaa85"` 把它染成茶色
 *    ⇒ 落地时 `cc.Sprite.color` 要写 `rgba(0xcb,0xaa,0x85,102)`，只写 alpha 会渲染成白条。
 */
export const LEAGUE_ART_LEVEL_ROW_CTX_BAR = 'white_jiao8';

/** 等级行副文案衬底的**色调**（FGUI `n4` 的 `color="#cbaa85"`）。 */
export const LEAGUE_ART_LEVEL_ROW_CTX_BAR_TINT: readonly [number, number, number] = [0xcb, 0xaa, 0x85];

/** 等级行副文案衬底的透明度（FGUI `n4` 的 `alpha="0.4"` ⇒ 255×0.4 ≈ 102）。 */
export const LEAGUE_ART_LEVEL_ROW_CTX_BAR_ALPHA = 102;

/** 等级行「等级N」深色衬底的透明度（FGUI `n1` 的 `alpha="0.5"` ⇒ 128）。 */
export const LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA = 128;

// ============================================================
// 大厅三个页签的行 / 角色操作浮层用图
// ============================================================

/**
 * 详情 · 动态 · 全服**三种行共用同一张行底框**（FGUI `组件_联盟_联盟{角色,动态,}item.xml`
 * 的 `n6` 都是 `frame_Zhikuang01`，155×113 / 九宫格 `38,28,76,56`）。
 *
 * 之所以拆成三个名字：三行的显示尺寸不同（662×109 / 656×70 / 660×113），
 * 将来若某一行单独换皮只改一处，不必动另外两行。
 */
export const LEAGUE_ART_MEMBER_ROW_BG = LEAGUE_ART_LEVEL_ROW_BG;
export const LEAGUE_ART_LOG_ROW_BG = LEAGUE_ART_LEVEL_ROW_BG;
export const LEAGUE_ART_UNION_ROW_BG = LEAGUE_ART_LEVEL_ROW_BG;

/** 详情行的头像外框（FGUI `n8`，公用 `img_Touxiang_01`，73×73）。 */
export const LEAGUE_ART_MEMBER_HEAD_FRAME = 'img_Touxiang_01';

/**
 * 详情行的「盟主 / 副盟主」职务标（FGUI `n14`，公用 `lm_pic04`，57×75）。
 *
 * FGUI 挂了 `gearDisplay controller="盟主" pages="1,2"` ⇒ **只有盟主 / 副盟主那一行才显示**，
 * 普通成员行要把它 `active=false`（见 `LeagueMemberRow.render`）。
 */
export const LEAGUE_ART_MEMBER_POSITION_TAG = 'lm_pic04';

/** 详情行的战力条底（FGUI `n11`，公用 `zx_zl_pic01`，113×27，压在 `lab_power` 下）。 */
export const LEAGUE_ART_MEMBER_POWER_BAR = 'zx_zl_pic01';

/** 详情行的等级徽章（FGUI `n10`，公用 `lt_pic07`，47×47，压在 `lab_lv` 下）。 */
export const LEAGUE_ART_MEMBER_LEVEL_BADGE = 'lt_pic07';

/**
 * 角色操作浮层的按钮底（FGUI `组件_联盟_联盟操作.xml` 里 5 个 `按钮_公共_通用`
 * 的 `icon="ui://w3m64m87n44q1yxnaki"`，回查 `package.xml` = `TY_btn07`，83×77）。
 *
 * FGUI 该图**带 `scale9grid`**（15,11,4,9）⇒ prefab 里必须 SLICED，否则 140×70 / 172×70
 * 两种尺寸会被拉变形（圆角被扯平）。
 */
export const LEAGUE_ART_OPS_BTN = 'TY_btn07';

// ============================================================
// 申请列表（`ui/League/LeagueApplyList`）用图
// ============================================================

/** 申请行底框 —— 与等级行 / 详情行**同图**（FGUI 三处 `n6` 都引 `frame_Zhikuang01`）。 */
export const LEAGUE_ART_APPLY_ROW_BG = LEAGUE_ART_LEVEL_ROW_BG;

/**
 * 申请行战力条左侧的小徽记（FGUI `组件_联盟_联盟角色申请` 的 `n12`，`bb_pic13`，34×33，显示 scale 0.8）。
 *
 * ⚠️ 详情行（`组件_联盟_联盟角色item`）**没有**这个节点 —— 只有申请行有，别照抄错。
 */
export const LEAGUE_ART_APPLY_ROW_POWER_DECO = 'bb_pic13';

/** 申请行头像外框（FGUI `n8`，公用 `img_Touxiang_01`，73×73）—— 与详情行同图。 */
export const LEAGUE_ART_APPLY_ROW_HEAD_FRAME = LEAGUE_ART_MEMBER_HEAD_FRAME;

/** 申请行等级徽章（FGUI `n10`，公用 `lt_pic07`，48×47）—— 与详情行同图，压在 `lab_lv` 下。 */
export const LEAGUE_ART_APPLY_ROW_LEVEL_BADGE = LEAGUE_ART_MEMBER_LEVEL_BADGE;

/** 申请行战力条底（FGUI `n11`，公用 `zx_zl_pic01`，113×27）—— 与详情行同图，压在 `lab_power` 下。 */
export const LEAGUE_ART_APPLY_ROW_POWER_BAR = LEAGUE_ART_MEMBER_POWER_BAR;

/**
 * 申请行**「拒绝」**按钮底 = `TY_btn07`（与角色操作浮层同图，九宫格 15,11,4,9）。
 *
 * ⚠️ 申请行这两个按钮的 FGUI `icon` 与弹窗那对（`TY_btn09`/`TY_btn10`）**不是一套**：
 *    `btn_kick` = `ui://w3m64m87n44q1yxnaki`（`TY_btn07`）、`btn_sure` = `…hknq1yxnakl`（`TY_btn10`）。
 *    即「拒绝」用的是中性底图，只有「同意」是亮色底 —— 别按弹窗的「同意亮 / 拒绝暗」去套。
 */
export const LEAGUE_ART_APPLY_ROW_REJECT_BTN = LEAGUE_ART_OPS_BTN;

/** 申请行**「同意」**按钮底 = `TY_btn10`（亮色，与弹窗「确定 / 全部同意」同图）。 */
export const LEAGUE_ART_APPLY_ROW_AGREE_BTN = LEAGUE_ART_BTN_OK;

// ============================================================
// 管理（`ui/League/LeagueMgr`）/ 联盟信息（`ui/League/LeagueInfo`）用图
// ============================================================

/**
 * 「加入」按钮底（FGUI `组件_联盟_大厅_联盟信息` 的 `btn_join`，
 * `icon="ui://w3m64m87n44q1yxnakh"` → 回查 `公用0/package.xml` = `TY_btn06.png`，84×77）。
 *
 * ⚠️ **与申请行那两颗不是同一张**：申请行「拒绝」= `TY_btn07`（id `…ki`）、本图 = `TY_btn06`
 *    （id `…kh`）。两个 id 只差最后一个字符，且图名只差一个数字 —— 按 id 回查时极易串。
 *    `TY_btn06` **带真九宫格**（`scale9grid="14,11,4,12"`：`14+4 < 84` 且 `11+12 < 77`）
 *    ⇒ 与 `TY_btn07` 同口径必须 SLICED（显示尺寸 169×70 会把圆角拉平）。
 */
export const LEAGUE_ART_BTN_JOIN = 'TY_btn06';

/**
 * 勾选框**底框**（FGUI `公用_按钮_勾选` 的 `icon`，
 * `icon="ui://w3m64m87sowy1yxnal1"` → `shaixuan_dikuang.png`，39×39，九宫格 `10,13,17,14`）。
 *
 * 显示尺寸 50×50（组件 `size="50,50"`），九宫格是真网格 ⇒ SLICED。
 */
export const LEAGUE_ART_CHECK_BG = 'shaixuan_dikuang';

/** 勾选框**对勾**所在的资源目录（`image/sevenDay`，**跨模块复用**）。 */
export const LEAGUE_SHARED_CHECK_ROOT = 'image/sevenDay';

/**
 * 勾选框对勾图名（`sd_check`，32×33，**无**九宫格 ⇒ SIMPLE）。
 *
 * ⚠️ **不往 `image/league` 拷**：FGUI 那张 `shaixuan_duigou.png`（公用包 `sowy1yxnal2`）
 *    与本工程 `image/sevenDay/sd_check.png` 的 **md5 都是 `93fff398…`**（逐字节相同），
 *    工程里已有两处复用先例（`FriendArt.FRIEND_SHARED_CHECK_ROOT/NAME`、
 *    `BattleTokenArt.BT_SHARED_CHECK`）⇒ 照同一口径复用，避免同一张图在包里躺两份。
 */
export const LEAGUE_SHARED_CHECK_NAME = 'sd_check';

/** 勾选框对勾的资源目录别名（读代码时一眼看出「这颗勾是七日活动那张」）。 */
export const LEAGUE_ART_CHECK_MARK_ROOT = LEAGUE_SHARED_CHECK_ROOT;
export const LEAGUE_ART_CHECK_MARK = LEAGUE_SHARED_CHECK_NAME;

/**
 * 联盟信息里旗帜背后的**茶色晕影**（FGUI `n27`，`url="ui://w3m64m87hknqx"` → `white_jiao8.png`）。
 *
 * 与等级预览 / 等级行的副文案衬底**同一张图**（`white_jiao8` 原图纯白，靠 `color` 染色），
 * 所以色调 / 透明度也复用那两个常量。
 */
export const LEAGUE_ART_INFO_BANNER_BG = LEAGUE_ART_LEVEL_ROW_CTX_BAR;

/** 晕影的色调（FGUI `n27` 的 `color="#cbaa85"`）—— 同 `LEAGUE_ART_LEVEL_ROW_CTX_BAR_TINT`。 */
export const LEAGUE_ART_INFO_BANNER_BG_TINT = LEAGUE_ART_LEVEL_ROW_CTX_BAR_TINT;

/** 晕影的透明度（FGUI `n27` 的 `alpha="0.4"` ⇒ 102）—— 同 `LEAGUE_ART_LEVEL_ROW_CTX_BAR_ALPHA`。 */
export const LEAGUE_ART_INFO_BANNER_BG_ALPHA = LEAGUE_ART_LEVEL_ROW_CTX_BAR_ALPHA;

/**
 * 「告示」子组件（FGUI `组件_联盟_告示`）用图 —— 管理与联盟信息的宣言 / 公告块共用。
 *
 * 底框 = `frame_Zhikuang01`（与等级行 / 各类行底框同图，九宫格 `38,28,76,56`）；
 * 标题衬底 = `BB_img03`（与等级行的「等级N」衬底同图，alpha 0.5）。
 */
export const LEAGUE_ART_NOTICE_BOX_BG = LEAGUE_ART_LEVEL_ROW_BG;
export const LEAGUE_ART_NOTICE_BOX_TITLE_BAR = LEAGUE_ART_LEVEL_ROW_TITLE_BAR;
export const LEAGUE_ART_NOTICE_BOX_TITLE_BAR_ALPHA = LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA;

// ============================================================
// 加入联盟（`ui/League/LeagueJoin`）用图
// ============================================================

/**
 * 加入联盟页的三块背景 —— **与大厅同源**（同一套「联盟内页」视觉）：
 * 整屏底 `lianmeng_bg02`、顶部装饰框 `lm_kj_pic08`、列表底板 `frame_Dikuang03`。
 *
 * ⚠️ FGUI `组件_联盟_加入联盟` 的 `bg` 引 `ui://fq1exoumhknqm`（= `lianmeng_bg02`），
 *    而**大厅**的 `bg` 引的是同一个资源 id ⇒ 两页背景本来就是一张图，不必各留一个名字。
 *    这里仍拆出三个**别名常量**：读代码时一眼看出「加入联盟用的是这一套」，
 *    将来某一页换皮只改一处。
 */
export const LEAGUE_ART_JOIN_BG = LEAGUE_ART_HALL_BG;
export const LEAGUE_ART_JOIN_FRAME = LEAGUE_ART_HALL_FRAME;
export const LEAGUE_ART_JOIN_BOARD = LEAGUE_ART_DETAIL_FRAME;

/**
 * 「创建联盟」按钮底（公用0 `TY_btn23.png`，**224×79 原生**）。
 *
 * 它是 `按钮_公共_通用` 组件**自身的默认 icon**（`7ws21yxnalz`），
 * 实例上又被显式写成同一个 id ⇒ 不写 `icon` 的实例也长这样。
 * 与实例框 224×79 完全同尺寸 ⇒ **SIMPLE**（`package.xml` 里也没标 `scale9grid`）。
 */
export const LEAGUE_ART_BTN_CREATE = 'TY_btn23';

/**
 * 「快速加入」按钮底（公用0 `TY_btn20.png`，**224×79 原生**）。
 *
 * ⚠️ 与 `TY_btn23` 长得像但**不是同一张**（一个是「创建」图标、一个是「闪电」图标），
 *    且两个公用包 id 只差最后一位（`…nam2` vs `…nalz`）—— 按 id 反查时极易串。
 */
export const LEAGUE_ART_BTN_QUICK_JOIN = 'TY_btn20';

// ============================================================
// 创建联盟（`ui/League/LeagueCreate`）用图
// ============================================================

/**
 * 「创建」消耗按钮的底图（公用0 `TY_btn21.png`，224×79，显示 **300×130**）。
 *
 * `package.xml` 的 `scale9grid="56,19,112,38"` 是**真九宫格**
 * （`56+112 = 168 < 224` ✓、`19+38 = 57 < 79` ✓，与 `TY_btn10/09` 那种垂直退化的情况相反）
 * ⇒ 300×130 必须 SLICED，否则四角圆角会被拉平。
 */
export const LEAGUE_ART_COST_BTN = 'TY_btn21';

/**
 * 「创建」按钮里那行浅色衬底（FGUI `按钮_联盟_消耗按钮` 的 `n7`，`white_jiao8`，
 * `(20,15) 260×30`、`alpha="0.4"`、`color="#666666"`）。
 *
 * 与等级行的副文案衬底是**同一张图**（原图纯白，全靠 `color` 染色）⇒ 复用 `white_jiao8`。
 */
export const LEAGUE_ART_COST_BAR = LEAGUE_ART_LEVEL_ROW_CTX_BAR;

/** 衬底的色调（FGUI `n7` 的 `color="#666666"`）——**注意与等级行那块茶色不同**。 */
export const LEAGUE_ART_COST_BAR_TINT: readonly [number, number, number] = [0x66, 0x66, 0x66];

/** 衬底的透明度（FGUI `n7` 的 `alpha="0.4"` ⇒ 255×0.4 ≈ 102）。 */
export const LEAGUE_ART_COST_BAR_ALPHA = 102;

/**
 * 消耗项 `lab_has` 的**两套字色** —— FGUI `gearColor controller="足够" pages="0,1"
 * values="#e6e5d9,#181614|#ea4332,#160e08"`。
 *
 * | 页 | 含义 | 字色 | 描边 |
 * |---|---|---|---|
 * | 0（`是`） | 够 | `#e6e5d9` | `#181614` |
 * | 1（`否`） | 不够 | `#ea4332` | `#160e08` |
 *
 * `lab_need` **没有** `gearColor` ⇒ 两态都是 `#e6e5d9` / `#181614`（老端就是这样，别顺手也染红）。
 */
export const LEAGUE_COST_ENOUGH_COLOR: readonly [number, number, number] = [0xe6, 0xe5, 0xd9];
export const LEAGUE_COST_ENOUGH_STROKE: readonly [number, number, number] = [0x18, 0x16, 0x14];
export const LEAGUE_COST_SHORT_COLOR: readonly [number, number, number] = [0xea, 0x43, 0x32];
export const LEAGUE_COST_SHORT_STROKE: readonly [number, number, number] = [0x16, 0x0e, 0x08];

/**
 * 联盟名输入框底板 —— `frame_shurukuang`（与全服查询框同图，九宫格 `13,12,5,7`），
 * 显示 376×50（FGUI `n8`）。
 */
export const LEAGUE_ART_CREATE_NAME_BG = LEAGUE_ART_INPUT_BG;

/**
 * 消耗图标的**资源目录** —— `icons/resource/`（`roleProperty` 那一支的 FGUI 裸名，
 * 与 `LayerActivityArt.resolveRewardIconRef` 的 `iconIsPath = false` 分支同口径）。
 *
 * ⚠️ **不能**走 `image/league`：`roleProperty.icon` 存的是 FGUI 组件名（`图标_幻灵玉`），
 *    不是相对 `resources` 的路径 —— 见 `LeagueTable` 的 `buildLeagueCostView`。
 */
export const LEAGUE_COST_ICON_ROOT = 'icons/resource';

// ============================================================
// P4 三面板（商店 / 捐献 / 砍价）用图
// ============================================================

/**
 * 商店**行底框** —— FGUI `组件_联盟_商店Item.xml` 的 `n0`，公用 `frame_Zhikuang01`
 * （155×113 九宫格 `38,28,76,56`），显示 **556×142**。
 *
 * ⇒ 与等级行 / 三类大厅行**同一张图**，但仍给一个别名：商店行将来单独换皮只改这一处。
 */
export const LEAGUE_ART_STORE_ROW_BG = LEAGUE_ART_LEVEL_ROW_BG;

/** 商店行标题衬底（FGUI `n1`，公用 `BB_img03`，488×32、`alpha=0.5`）—— 同等级行标题衬底。 */
export const LEAGUE_ART_STORE_ROW_TITLE_BAR = LEAGUE_ART_LEVEL_ROW_TITLE_BAR;

/** 商店行的标题衬底透明度（FGUI `n1` 的 `alpha="0.5"` ⇒ 255×0.5 ≈ 128）。 */
export const LEAGUE_ART_STORE_ROW_TITLE_BAR_ALPHA = LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA;

/**
 * 商店行的「购买」小按钮底（FGUI `组件_联盟_商店Item.xml` 的 `btnBuy` 实例
 * 显式写了 `icon="ui://w3m64m877ws21yxnam2"`，回查 `package.xml` = `TY_btn20`，**224×79**）。
 *
 * ⚠️ 与「快速加入」按钮同名同图（`LEAGUE_ART_BTN_QUICK_JOIN`）—— 这里是**有意复用**：
 *    FGUI 原稿就是这一张。两处都保留各自的名字，读代码时不必回查引用点。
 * ⚠️ `package.xml` 没给它标 `scale9grid` ⇒ **SIMPLE**（拉到 121×42 会轻微压扁圆角，可接受；
 *    强行按 9grid 处理反而无九宫格数据可用）。
 */
export const LEAGUE_ART_STORE_BUY_BTN = LEAGUE_ART_BTN_QUICK_JOIN;

/**
 * 捐献 / 砍价面板里的「广告按钮」底（FGUI `按钮_联盟_广告` 的 `n10`，
 * `icon="ui://w3m64m87hknq1yxnakl"` = `TY_btn10`，210×77）。
 *
 * ⚠️ 按 **SIMPLE** 用 —— 理由与 `LEAGUE_ART_BTN_OK` 相同（`TY_btn10` 的 `scale9grid`
 *    在垂直方向退化：`top + bottom = 0 + 77 = 77 = 图高`，中缝为 0）。
 */
export const LEAGUE_ART_AD_BTN = LEAGUE_ART_BTN_OK;

/**
 * 广告按钮左上角那行浅色衬底（FGUI `按钮_联盟_广告` 的 `n7`，公用 `white_jiao8`，
 * `213×30`、`alpha="0.4"`、`color="#666666"`）。
 *
 * 与「创建页消耗项衬底」是**同一张图**（原图纯白，全靠 `color` 染色）；色调同 `#666666`。
 */
export const LEAGUE_ART_AD_BAR = LEAGUE_ART_LEVEL_ROW_CTX_BAR;

/** 广告按钮衬底的色调（FGUI `n7` 的 `color="#666666"`）—— 同创建页消耗项衬底。 */
export const LEAGUE_ART_AD_BAR_TINT = LEAGUE_ART_COST_BAR_TINT;

/** 广告按钮衬底的透明度（FGUI `n7` 的 `alpha="0.4"` ⇒ 102）。 */
export const LEAGUE_ART_AD_BAR_ALPHA = LEAGUE_ART_COST_BAR_ALPHA;

/**
 * 广告按钮右上角的**小视频角标**（FGUI `按钮_联盟_广告` 的 `n9`，公用 `img_video`，
 * 39×28 原生、无 `scale9grid` ⇒ SIMPLE）。
 *
 * 只在 `类型 = 免费` 那一页显示（`gearDisplay controller="类型" pages="0"`）。
 */
export const LEAGUE_ART_AD_VIDEO = 'img_video';

/** 捐献道具格的底框（FGUI `组件_联盟_捐献_道具.xml` 的 `n29`，公用 `frame_Zhikuang01`，270×180）。 */
export const LEAGUE_ART_DONATE_ITEM_BG = LEAGUE_ART_LEVEL_ROW_BG;

/**
 * 砍价面板的大底板（FGUI `组件_联盟_砍价.xml` 的 `n58`，联盟包 `图片/框体_frame/frame_Dikuang01.png`，
 * 原生 **422×533**、九宫格 **`105,124,190,344`**（105+190=295<422 ✓、124+344=468<533 ✓ 是真九宫格），
 * 显示 **581×533**）。
 *
 * ⚠️ 必须 SLICED（见 `LEAGUE_ART_SLICED`）—— 横向要 422→581 拉宽 159px，
 *    按 SIMPLE 会把左右两端的木纹拉糊。
 */
export const LEAGUE_ART_BARGAIN_BOARD = 'frame_Dikuang01';

/**
 * 砍价面板顶端那个「砍价横幅」（FGUI `n59`，联盟包 `图片/kjrw.png`，446×549 原生）。
 *
 * ⚠️ 原生比整屏还大（446 宽 × 549 高），FGUI 里 `xy="131,35"` **没有 size** ⇒ 按原生尺寸落，
 *    会**故意溢出**到画布下沿之外（这是设计稿的「飘出」效果，别去裁它）。
 */
export const LEAGUE_ART_BARGAIN_BANNER = 'kjrw';

/**
 * 砍价面板右上角的对话气泡（FGUI `n45`，联盟包 `图片/lm_kj__qipao.png`，241×141 原生）。
 *
 * ⚠️ 文件名里是**两个下划线**（`lm_kj__qipao`），不是笔误。
 */
export const LEAGUE_ART_BARGAIN_BUBBLE = 'lm_kj__qipao';

/** 砍价面板里「已砍金额」小图标底下那朵云（FGUI `n54`，联盟包 `图片/lm_kj_pic01.png`，137×87 原生）。 */
export const LEAGUE_ART_BARGAIN_CLOUD = 'lm_kj_pic01';

/**
 * 砍价两个主按钮（`btn_sale` / `btn_buy`）的底图 —— FGUI 两处都是
 * `icon="ui://w3m64m877ws21yxnam1"`，回查 `package.xml` = **`TY_btn21`**（224×79，九宫格 `56,19,112,38`）。
 *
 * ⇒ 与创建页的「创建」消耗按钮**同一张图**；显示尺寸 230×77 ⇒ 必须 SLICED（复用 `LEAGUE_ART_COST_BTN`）。
 */
export const LEAGUE_ART_BARGAIN_BTN = LEAGUE_ART_COST_BTN;

/**
 * 砍价原价上的**删除线**（FGUI `n53`，`<graph type="rect" lineColor="#ffd84040" fillColor="#ff000000">`）。
 *
 * `#ffd84040` 是 **ARGB**：`alpha=ff`、`rgb=d84040`（红）。FGUI 的 graph 无贴图 ⇒
 * 本端用 `cc.Graphics` 画一条 100×3 的红线（见 `LeagueDiscountPage` 的 `drawStrikeThrough`）。
 */
export const LEAGUE_ART_BARGAIN_STRIKE_COLOR: readonly [number, number, number] = [0xd8, 0x40, 0x40];

// ============================================================
// 联盟任务（`ui/League/LeagueTask`）用图
// ============================================================

/**
 * 面板顶部「横幅」的底 —— FGUI `组件_联盟_任务.xml` 的 `n29`，公用 `frame_Zhikuang01`
 * （155×113 九宫格 `38,28,76,56`），显示 **550×160**，带 `color="#657d54"` 染成墨绿。
 *
 * ⚠️ 与列表行底框**同一张图、只差一层色调** —— 所以这里给两个名字 + 一个色调常量，
 *    别以为 FGUI 用了两张不同的图。
 */
export const LEAGUE_ART_TASK_HEAD_BG = LEAGUE_ART_LEVEL_ROW_BG;

/** 顶部横幅的色调（FGUI `n29` 的 `color="#657d54"`）—— 行底框不染（保持原色）。 */
export const LEAGUE_ART_TASK_HEAD_TINT: readonly [number, number, number] = [0x65, 0x7d, 0x54];

/** 任务行底框（FGUI `组件_联盟_任务item.xml` 的 `n27`，同 `frame_Zhikuang01`，550×160）。 */
export const LEAGUE_ART_TASK_ROW_BG = LEAGUE_ART_LEVEL_ROW_BG;

/** 任务行标题衬底（FGUI `item` 的 `n28`，公用 `BB_img03`，488×32、`alpha=0.5`）。 */
export const LEAGUE_ART_TASK_ROW_TITLE_BAR = LEAGUE_ART_LEVEL_ROW_TITLE_BAR;

/** 任务行标题衬底的透明度（FGUI `n28` 的 `alpha="0.5"` ⇒ 255×0.5 ≈ 128）。 */
export const LEAGUE_ART_TASK_ROW_TITLE_BAR_ALPHA = LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA;

/**
 * 顶部进度条底 / 填充 —— 与大厅**经验条同图**（`bar_bg_01` / `bar_bg_01_hong`）。
 *
 * 面板上显示 452×38（`comp_progress`），行内 `comp_progress` 显示 160×38
 * （`组件_联盟_进度条.xml` 原生 652×38 ⇒ 两处都靠九宫格横向压缩）。
 * ⚠️ `bar_bg_01` 在 `LEAGUE_ART_SLICED` 里（prefab 必须 `type = 1`）；
 *    `bar_bg_01_hong` 包没标 `scale9grid` ⇒ SIMPLE，且它由 `ProgressBar` 按 `value/max`
 *    裁切（`cc.ProgressBar` 的 `barSprite` + `mode = HORIZONTAL`），不是靠拉伸。
 */
export const LEAGUE_ART_TASK_PROGRESS_BG = LEAGUE_ART_PROGRESS_BG;
export const LEAGUE_ART_TASK_PROGRESS_FILL = LEAGUE_ART_PROGRESS_FILL;

/** 进度条文字色（FGUI `组件_联盟_进度条.xml` 的 `lab_title` 的 `#fcf0d6` / 描边 `#160e08`）。 */
export const LEAGUE_ART_TASK_PROGRESS_TEXT_COLOR: readonly [number, number, number] = [0xfc, 0xf0, 0xd6];
export const LEAGUE_ART_TASK_PROGRESS_TEXT_STROKE: readonly [number, number, number] = [0x16, 0x0e, 0x08];

/**
 * 进度条左端那枚圆环装饰（FGUI `组件_联盟_任务.xml` 的 `n31`，
 * 联盟包 `图片/框体_frame/frame_yuan_pic02.png`，**86×87 原生**，显示 43×46、`scale 1.4`）。
 *
 * ⚠️ 这里同时标了 `size="43,46"` 和 `scale="1.4"` ⇒ 视觉尺寸 ≈ 60×64，
 *    落 prefab 时给 `43×46` + `scale 1.4`（别把 60 写进 `contentSize`，否则又叠一次缩放）。
 */
export const LEAGUE_ART_TASK_CIRCLE = 'frame_yuan_pic02';

/** 进度值大字色（FGUI `lab_count` 的 `#ffd673`，描边 `#000000`）。 */
export const LEAGUE_ART_TASK_COUNT_COLOR: readonly [number, number, number] = [0xff, 0xd6, 0x73];
export const LEAGUE_ART_TASK_COUNT_STROKE: readonly [number, number, number] = [0x00, 0x00, 0x00];

/** 「每日观看广告跳过剩余次数」行（FGUI `lab_jump`）：白字 + 黑描边、居中。 */
export const LEAGUE_ART_TASK_AD_TEXT_COLOR: readonly [number, number, number] = [0xff, 0xff, 0xff];
export const LEAGUE_ART_TASK_AD_TEXT_STROKE: readonly [number, number, number] = [0x00, 0x00, 0x00];

/**
 * 进度宝箱的**三态图** —— FGUI `组件_联盟_宝箱.xml` 的
 * `gearIcon controller="状态" pages="2,1,0" values="zb0|zb1|zb2"`。
 *
 * ⚠️ **图名里的数字是「状态序号」，不是状态名**：按 `pages="2,1,0"` 与
 *    `values="…zb0|…zb1|…zb2"` 的位置对应逐个回查得到
 *    （`f2q41yxnapz`=zb0 / `f2q41yxnaqe`=zb1 / `f2q41yxnaqf`=zb2，见 `公用0/package.xml`）：
 *
 *    | controller 页 | 状态名 | 图 |
 *    |---|---|---|
 *    | 2 | 不可领取 | **`zb0`** |
 *    | 1 | 可领取 | `zb1` |
 *    | 0 | 已领取 | `zb2` |
 *
 *    ⇒ 「zb**0** 是灰色的不可领取箱、zb**2** 是已领取箱」，**与数字大小的直觉相反**，
 *    按文件名数字当状态会把三个箱子全画反。
 */
export const LEAGUE_ART_TASK_BOX_LOCKED = 'zb0';
export const LEAGUE_ART_TASK_BOX_CAN_REWARD = 'zb1';
export const LEAGUE_ART_TASK_BOX_REWARDED = 'zb2';

/**
 * 宝箱「已领取」的对勾（FGUI `组件_联盟_宝箱.xml` 的 `n67`，
 * 联盟包 `图片/标签_tag/tag_gou.png`，70×70 原生，显示 `scale 0.5`）。
 *
 * ⚠️ 它挂在 `gearDisplay controller="状态" pages="0"` 上 ⇒ **只在「已领取」页显示**；
 *    不可领取 / 可领取两页都不显示。
 */
export const LEAGUE_ART_TASK_BOX_CHECK = 'tag_gou';

/** 宝箱里程碑数字色（FGUI `lab_value` 的 `#ede5ae`，描边 `#000000`、`faceDilate=1`）。 */
export const LEAGUE_ART_TASK_BOX_VALUE_COLOR: readonly [number, number, number] = [0xed, 0xe5, 0xae];
export const LEAGUE_ART_TASK_BOX_VALUE_STROKE: readonly [number, number, number] = [0x00, 0x00, 0x00];

/**
 * 任务行里那块「已领取」的整幅标（FGUI `组件_联盟_任务item.xml` 的 `n35`，
 * 联盟包 `图片/公用_图标_已领取.png`，**119×74 原生**，无 `scale9grid` ⇒ SIMPLE）。
 *
 * ⚠️ 工作目录里只有这一个**中文文件名**的图 —— `loadArt` 走的是
 *    `resources.load('image/league/公用_图标_已领取/spriteFrame')`，路径是普通字符串，
 *    中文字符不影响（但别在别处手拼成拼音/英文名去查，会静默拿 `null`）。
 */
export const LEAGUE_ART_TASK_DONE_TAG = '公用_图标_已领取';

/**
 * 宝箱「不可领取」时弹出的奖励浮框底（FGUI `组件_联盟_任务_奖励框.xml` 的 `n37`，
 * 公用 `white_jiao8`，110×110、带 `color="#333333"` 染色）。
 *
 * ⇒ 与等级行 / 创建页 / 广告按钮那几块衬底**同图**（原图纯白，全靠 `tint` 上色）。
 */
export const LEAGUE_ART_TASK_REWARD_BG = LEAGUE_ART_LEVEL_ROW_CTX_BAR;

/** 浮框底的色调（FGUI `n37` 的 `color="#333333"`）—— 比创建页的 `#666666` 更暗。 */
export const LEAGUE_ART_TASK_REWARD_BG_TINT: readonly [number, number, number] = [0x33, 0x33, 0x33];

/**
 * 任务行两颗按钮的底图 —— FGUI `组件_联盟_任务item.xml` 两处实例**显式覆盖了 `icon`**：
 *
 * - `btn_get`（「领取」，`gearDisplay 状态 pages="1"`）`icon="ui://w3m64m87n44q1yxnakh"` = **`TY_btn06`**（亮色）
 * - `btn_go`（「前往」，`gearDisplay 状态 pages="0"`）`icon="ui://w3m64m87n44q1yxnaki"` = **`TY_btn07`**（中性）
 *
 * ⚠️ 与申请行那对**共用同两张图但方向不同**：申请行「拒绝」= `TY_btn07`、「同意」= `TY_btn10`。
 *    这里「领取」用 `TY_btn06`（与「加入」按钮同图）—— 按「亮色 = 主操作」去套能对上，
 *    但**名字别乱复用**（`LEAGUE_ART_TASK_GET_BTN` / `LEAGUE_ART_TASK_GO_BTN` 各留一个，
 *    将来某一颗单独换皮只改一处）。
 * ⚠️ 两张都是**真九宫格**（`TY_btn06` = 14,11,4,12 / `TY_btn07` = 15,11,4,9）
 *    ⇒ 已在 `LEAGUE_ART_SLICED` 里，显示 117×60 必须 `type = 1`。
 */
export const LEAGUE_ART_TASK_GET_BTN = LEAGUE_ART_BTN_JOIN;
export const LEAGUE_ART_TASK_GO_BTN = LEAGUE_ART_OPS_BTN;

/**
 * 行内「看广告」小按钮（FGUI `btn_adv`，`按钮_公共_通用_图标` 组件）的底图 +
 * 左上角小视频角标。
 *
 * 该组件自己的 `icon` 就是 `ui://w3m64m87n44q1yxnaki` = **`TY_btn07`**，
 * 且带一枚 `img_video`（`n5`，21,17）—— 与捐献面板那颗大广告按钮的角标**同一张图**。
 */
export const LEAGUE_ART_TASK_AD_BTN = LEAGUE_ART_OPS_BTN;
export const LEAGUE_ART_TASK_AD_BADGE = LEAGUE_ART_AD_VIDEO;

/** 宝箱三态 → 图名（见 `LEAGUE_ART_TASK_BOX_LOCKED` 的三态表）。 */
export function leagueTaskBoxArt(state: LeagueTaskBoxState): string {
    switch (state) {
        case 'canReward':
            return LEAGUE_ART_TASK_BOX_CAN_REWARD;
        case 'rewarded':
            return LEAGUE_ART_TASK_BOX_REWARDED;
        default:
            return LEAGUE_ART_TASK_BOX_LOCKED;
    }
}

// ============================================================
// 北伐中原（`ui/League/LeagueNorthExpedition` + 排行 / 奖励子页）用图
// ============================================================
//
// FGUI 真源：`副本/北伐中原/组件_联盟_北伐中原*.xml`。
// ⚠️ 主面板**不用** `组件_公共弹窗_新` 那套骨架 —— 它自带的是一块**木纹大板**
//    （`panel_window_02_9gong`）+ 一块**羊皮纸内框**（`frame_01_9gong`），
//    两个子页（排行 / 奖励）才用公共弹窗。

/** 主面板的整屏背景（FGUI `组件_联盟_北伐中原.xml` 的 `bg` → `lianmeng_bg03`）。 */
export const LEAGUE_ART_NORTH_BG = 'lm_bg03';

/**
 * 主面板外板 —— FGUI `n1`，公用 `panel_window_02_9gong`（318×257，九宫格 `85,117,183,56`），
 * 显示 **720×660**。
 *
 * ⚠️ `85+183 = 268 < 318` ✓、`117+56 = 173 < 257` ✓ —— **真九宫格**（横中缝 50 / 纵中缝 84），
 *    拉到 2.26× / 2.57× 必须 `SLICED`，否则四角的木纹钉会被抻平。
 */
export const LEAGUE_ART_NORTH_BOARD = 'panel_window_02_9gong';

/**
 * 主面板内框（羊皮纸内容区）—— FGUI `n3`，公用 `frame_01_9gong`
 * （370×292，九宫格 `160,127,57,50`），显示 **680×545**。
 *
 * ⚠️ 这块是**浅色**底（羊皮纸）⇒ 落在它上面的字要用**深色**。FGUI 那 5 行属性文本
 *    （`组件_联盟_北伐中原文本`）**没有写 `color`** ⇒ 吃工程默认值 `#000000`（见
 *    `settings/Common.json` 的 `textColor`）—— 这里照抄黑色，**别**顺手改成米白。
 */
export const LEAGUE_ART_NORTH_INNER_FRAME = 'frame_01_9gong';

/** 内框顶部那两片标题装饰（FGUI `n2` = `zg_pic03` 木牌 / `n24` = `zg_pic02` 金边横幅）。 */
export const LEAGUE_ART_NORTH_BOARD_TITLE = 'zg_pic03';
export const LEAGUE_ART_NORTH_TITLE_DECO = 'zg_pic02';

/** 主面板底部那条底栏（FGUI `n54`，公用 `diban_BG`）—— 与大厅 / 商店**同图**。 */
export const LEAGUE_ART_NORTH_BOTTOM_BAR = LEAGUE_ART_BOTTOM_BAR;

/** 「返回」按钮（FGUI `按钮_返回`，公用 `btn_FanHui`）。 */
export const LEAGUE_ART_NORTH_BACK = LEAGUE_ART_BACK;

/** 「英雄共鸣」行右侧那颗帮助按钮（FGUI `btn_help`，公用 `zx_btn01`）—— 与主页 `BtnHelp` 同图。 */
export const LEAGUE_ART_NORTH_HELP = LEAGUE_ART_HELP;

/**
 * 主面板两块小底板（FGUI `n48` ＝ 英雄共鸣 / `n50` ＝ 今日挑战奖励，**同一张图** `frame_Zhikuang05`）。
 *
 * ⚠️ 与属性区的 `n49`（`frame_Zhikuang04`，600×187）**不是同一张**：04 是那大片羊皮纸，
 *    05 是这两条 600×87 的窄条。两张都**没有** `scale9grid` ⇒ SIMPLE。
 */
export const LEAGUE_ART_NORTH_ROW_BG = 'frame_Zhikuang05';

/** 属性区底板（FGUI `n49`，600×187，SIMPLE）。 */
export const LEAGUE_ART_NORTH_ATTR_BG = 'frame_Zhikuang04';

/**
 * 主面板左侧两颗「页签式」入口图标（FGUI `btn_rank` = 公用 `ph.png`、`btn_reward` = 联盟包 `jl.png`）。
 *
 * ⚠️ `ph.png` 是**美术的占位图**（placeholder，图名就是「ph」）—— 老端 FGUI 里它**就是**这么用的
 *    （`<Button icon="ui://fq1exoumrej52i"/>`，`rej52i` = `ph.png`）。照抄，不要自作主张换图。
 */
export const LEAGUE_ART_NORTH_RANK_TAB_ICON = 'ph';
export const LEAGUE_ART_NORTH_REWARD_TAB_ICON = 'jl';

/**
 * 主面板三颗按钮的底图。
 *
 * | 按钮 | FGUI `icon` | 图 |
 * |---|---|---|
 * | 「擂鼓」（114×54） | `ui://w3m64m87n44q1yxnaki` | `TY_btn07`（中性） |
 * | 「挑战」（224×79） | `ui://w3m64m877ws21yxnalz` | `TY_btn23`（亮） |
 * | 「扫荡」（224×79） | `ui://w3m64m877ws21yxnaly` | `TY_btn24`（亮，与 23 同宽同形、只差包内序号） |
 *
 * ⚠️ `TY_btn07` 是**真九宫格**（`15,11,4,9`）⇒ 已在 `LEAGUE_ART_SLICED` 里，114×54 要 `type = 1`；
 *    `TY_btn23` / `TY_btn24` 都**没有** `scale9grid` ⇒ SIMPLE（原生就是 224×79，一格不拉）。
 */
export const LEAGUE_ART_NORTH_DRUM_BTN = LEAGUE_ART_OPS_BTN;
/**
 * ⚠️ 挑战 = `TY_btn23`（`ui://w3m64m877ws21yxnalz`）——**不是** `LEAGUE_ART_BTN_JOIN`。
 *    后者是 `TY_btn06`（P5 的 `btn_get` 图标，公用包 `n44q1yxnakh`），两张图不同
 *    （`TY_btn06` 7381B / 带九宫格；`TY_btn23` 13304B / 无九宫格，原稿就是 224×79）。
 *    `TY_btn23` 与页签的「未选中」底图**是同一张**（FGUI 两处都引 `7ws21yxnalz`）。
 */
export const LEAGUE_ART_NORTH_CHALLENGE_BTN = 'TY_btn23'; // 亮
export const LEAGUE_ART_NORTH_SWEEP_BTN = 'TY_btn24';

/**
 * 排行 / 奖励两个子页的**页签按钮底图**（FGUI `组件_联盟_页签.xml` 的 `gearIcon` 两态）。
 *
 * ```xml
 * <gearIcon controller="button" pages="0,1,2,3"
 *           values="ui://…7ws21yxnalz | ui://…7ws21yxnam2 | ui://…7ws21yxnalz | ui://…7ws21yxnam2"/>
 * ```
 *
 * `button` controller 的 4 页是 `up / down / over / selectedOver`，`selected="3"` ⇒
 *
 * | 页 | 状态 | 图 |
 * |---|---|---|
 * | up / over | **未选中** | `TY_btn23`（亮） |
 * | down / selectedOver | **选中** | `TY_btn20`（暗） |
 *
 * ⚠️ 「选中 = 暗、未选中 = 亮」—— 与直觉相反（FGUI 里靠**文字**变亮来强调选中，
 *    `gearColor` 把选中态的字色 `#b6af95` 改成 `#fcf0d6`）。落 prefab 时**底图与字色一起换**。
 */
export const LEAGUE_ART_NORTH_TAB_NORMAL = 'TY_btn23'; // 亮
export const LEAGUE_ART_NORTH_TAB_SELECTED = 'TY_btn20'; // 暗

/** 页签文字的两态色（FGUI `gearColor values="#b6af95,#160e08|#fcf0d6,#502010|…"`）。 */
export const LEAGUE_ART_NORTH_TAB_TEXT_NORMAL: readonly [number, number, number] = [0xb6, 0xaf, 0x95];
export const LEAGUE_ART_NORTH_TAB_TEXT_SELECTED: readonly [number, number, number] = [0xfc, 0xf0, 0xd6];
export const LEAGUE_ART_NORTH_TAB_TEXT_STROKE: readonly [number, number, number] = [0x50, 0x20, 0x10];

/** 排行行的底框（FGUI `组件_联盟_北伐中原_排行Item.xml` 的 `n0`，550×130）＝ 任务行同图。 */
export const LEAGUE_ART_NORTH_RANK_ROW_BG = LEAGUE_ART_LEVEL_ROW_BG;
/** 排行页「我的名次」那条的底框（FGUI `n13`，594×160，同 `frame_Zhikuang01`）。 */
export const LEAGUE_ART_NORTH_RANK_MINE_BG = LEAGUE_ART_LEVEL_ROW_BG;
/** 排行页表头衬底（FGUI `n5`，488×32、`alpha=0.5`，同 `BB_img03`）。 */
export const LEAGUE_ART_NORTH_RANK_HEAD_BAR = LEAGUE_ART_LEVEL_ROW_TITLE_BAR;
/** 排行行「盟内进度」页的头像框底（FGUI `com_head` → 公用 `组件_公用_头像框` 的 `n0`，110×110）。 */
export const LEAGUE_ART_NORTH_HEAD_FRAME = 'img_Touxiang_01';
/** 排行行「盟内进度」页战斗力数字背后的两条底衬（FGUI `n18` = `bb_pic11` / `n19` = `bb_pic13`）。 */
export const LEAGUE_ART_NORTH_POWER_BAR = 'bb_pic11';
export const LEAGUE_ART_NORTH_POWER_BAR2 = 'bb_pic13';

/** 奖励行的底框 / 标题衬底（FGUI `组件_联盟_北伐中原_奖励Item.xml` 的 `n0` / `n1`）。 */
export const LEAGUE_ART_NORTH_REWARD_ROW_BG = LEAGUE_ART_LEVEL_ROW_BG;
export const LEAGUE_ART_NORTH_REWARD_ROW_BAR = LEAGUE_ART_LEVEL_ROW_TITLE_BAR;
export const LEAGUE_ART_NORTH_REWARD_ROW_BAR_ALPHA = LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA;

/** 奖励行「已领取」印章（FGUI `n7`，同 P5 那张 `公用_图标_已领取`）。 */
export const LEAGUE_ART_NORTH_DONE_TAG = '公用_图标_已领取';

/** 进度条（奖励行 `comp_progress`）—— 与大厅 / 任务面板同一对图。 */
export const LEAGUE_ART_NORTH_PROGRESS_BG = LEAGUE_ART_PROGRESS_BG;
export const LEAGUE_ART_NORTH_PROGRESS_FILL = LEAGUE_ART_PROGRESS_FILL;

/** 物品框品质底（FGUI 各处 `com_goods` → 公用 `物品框`；与 P5 用同一档兜底图）。 */
export const LEAGUE_ART_NORTH_GOODS_FRAME = 'common_img_pzk_01';

/** 奖励行「未完成 / 已完成」两页那颗按钮的底图（FGUI `按钮_公共_通用` 的 `icon`，`TY_btn07`）。 */
export const LEAGUE_ART_NORTH_REWARD_BTN = LEAGUE_ART_OPS_BTN;

/** 主面板底部 `lab_times` / 顶部 `lab_endtime` 等文字色（逐条取自 FGUI XML）。 */
export const LEAGUE_ART_NORTH_TEXT_TIMES_COLOR: readonly [number, number, number] = [0xc4, 0xc5, 0xc2];
export const LEAGUE_ART_NORTH_TEXT_TIMES_STROKE: readonly [number, number, number] = [0x1b, 0x21, 0x26];
export const LEAGUE_ART_NORTH_TEXT_MONSTER_COLOR: readonly [number, number, number] = [0xe7, 0xe2, 0xc4];
export const LEAGUE_ART_NORTH_TEXT_MONSTER_STROKE: readonly [number, number, number] = [0x1e, 0x10, 0x04];
export const LEAGUE_ART_NORTH_TEXT_TIME_COLOR: readonly [number, number, number] = [0xed, 0xd3, 0x7a];
export const LEAGUE_ART_NORTH_TEXT_TIME_STROKE: readonly [number, number, number] = [0x23, 0x12, 0x04];
export const LEAGUE_ART_NORTH_TEXT_SECTION_COLOR: readonly [number, number, number] = [0xf5, 0xea, 0xac];
export const LEAGUE_ART_NORTH_TEXT_SECTION_STROKE: readonly [number, number, number] = [0x1e, 0x10, 0x04];
export const LEAGUE_ART_NORTH_TEXT_BUFF_COLOR: readonly [number, number, number] = [0xfe, 0xee, 0xb0];
export const LEAGUE_ART_NORTH_TEXT_DAILY_COLOR: readonly [number, number, number] = [0xfe, 0xef, 0xb1];
export const LEAGUE_ART_NORTH_TEXT_DARK_STROKE: readonly [number, number, number] = [0x16, 0x0e, 0x08];
/** 主面板三颗按钮的字色（FGUI `titleColor="#fcf0d6"`；擂鼓那颗没写 ⇒ 组件默认 `#fcf0d6`）。 */
export const LEAGUE_ART_NORTH_BTN_TEXT_COLOR: readonly [number, number, number] = [0xfc, 0xf0, 0xd6];
export const LEAGUE_ART_NORTH_BTN_TEXT_STROKE: readonly [number, number, number] = [0x11, 0x0b, 0x08];
/** 排行页头 / 表头 / 底部说明的字色（FGUI 逐条：表头无 color ⇒ 黑；`n12` = `#fcf0d6`）。 */
export const LEAGUE_ART_NORTH_RANK_HEAD_COLOR: readonly [number, number, number] = [0x00, 0x00, 0x00];
export const LEAGUE_ART_NORTH_RANK_TIP_COLOR: readonly [number, number, number] = [0xfc, 0xf0, 0xd6];
export const LEAGUE_ART_NORTH_RANK_TIP_STROKE: readonly [number, number, number] = [0x16, 0x0e, 0x08];
/** 排行行内名次 / 联盟名 / 伤害等（FGUI 里大多无 color ⇒ 黑；`文本_战斗力` = `#fef3b0`）。 */
export const LEAGUE_ART_NORTH_RANK_CELL_COLOR: readonly [number, number, number] = [0x00, 0x00, 0x00];
export const LEAGUE_ART_NORTH_RANK_POWER_COLOR: readonly [number, number, number] = [0xfe, 0xf3, 0xb0];
export const LEAGUE_ART_NORTH_RANK_POWER_STROKE: readonly [number, number, number] = [0x16, 0x0e, 0x08];
/** 奖励行 `labName` 字色（FGUI 无 color ⇒ 黑）。 */
export const LEAGUE_ART_NORTH_REWARD_NAME_COLOR: readonly [number, number, number] = [0x00, 0x00, 0x00];

// ============================================================
// Sprite 口径
// ============================================================

/** `cc.Sprite._type`：`SIMPLE = 0` / `SLICED = 1`。 */
export const LEAGUE_SPRITE_SIMPLE = 0;
export const LEAGUE_SPRITE_SLICED = 1;

/**
 * **需要九宫格渲染的图**（prefab 里 `cc.Sprite._type` 必须 = 1）。
 *
 * 主页用到的图在 FGUI 里都没标 `scale="9grid"` ⇒ 那儿为空集；
 * 后几刀陆续补进来的这些**带** `scale9grid`（见 FGUI `package.xml`）⇒ 必须 SLICED，
 * 否则拉伸会变形（尤其 `diban_BG` 底栏、`frame_Dikuang03` 大底板、弹窗底板 `panel_window_01_9gong`）。
 *
 * ⚠️ **不进本集合 ≠ 不用九宫格**：`TY_btn09` / `TY_btn10` 的 `scale9grid`
 *    （`59,0,7,77` / `54,0,7,77`）在**垂直方向是退化的**（`top + bottom = 77 = 图高`，
 *    中缝为 0），拉高会把顶边描边拉成一条暗带 ⇒ 那两张**故意按 SIMPLE 用**，
 *    判定见 `leagueSpriteType` 与各构建器里的同处说明。
 */
export const LEAGUE_ART_SLICED: ReadonlySet<string> = new Set<string>([
    LEAGUE_ART_NOTICE_BG, // frame_Zhikuang02  112,22,63,44
    LEAGUE_ART_DETAIL_FRAME, // frame_Dikuang03  147,110,100,112
    LEAGUE_ART_PIC07, // lm_pic07         121,46,13,13
    LEAGUE_ART_INPUT_BG, // frame_shurukuang 13,12,5,7
    LEAGUE_ART_BOTTOM_BAR, // diban_BG         347,69,38,7
    LEAGUE_ART_PROGRESS_BG, // bar_bg_01        15,16,9,11
    LEAGUE_ART_LEVEL_ROW_BG, // frame_Zhikuang01 38,28,76,56
    LEAGUE_ART_LEVEL_ROW_CTX_BAR, // white_jiao8      13,9,0,6
    LEAGUE_ART_OPS_BTN, // TY_btn07         15,11,4,9
    LEAGUE_ART_POPUP_BOARD, // panel_window_01_9gong 129,128,123,36（第四刀新增）
    LEAGUE_ART_BTN_JOIN, // TY_btn06         14,11,4,12（第五刀新增）
    LEAGUE_ART_CHECK_BG, // shaixuan_dikuang 10,13,17,14（第五刀新增）
    LEAGUE_ART_COST_BTN, // TY_btn21         56,19,112,38（P3 新增；显示 300×130）
    LEAGUE_ART_BARGAIN_BOARD, // frame_Dikuang01 105,124,190,344（P4 新增；显示 581×533）
    LEAGUE_ART_NORTH_BOARD, // panel_window_02_9gong 85,117,183,56（P6 新增；显示 720×660）
    LEAGUE_ART_NORTH_INNER_FRAME, // frame_01_9gong  160,127,57,50（P6 新增；显示 680×545）
    LEAGUE_ART_NORTH_ROW_BG, // frame_Zhikuang05 148,21,33,42（P6 新增；英雄共鸣 / 今日挑战奖励两块小底板）
    LEAGUE_ART_NORTH_ATTR_BG, // frame_Zhikuang04 103,39,104,78（P6 新增；属性区那片羊皮纸 600×187）
]);

/** 按资源名给出该图应使用的 `cc.Sprite._type`。 */
export function leagueSpriteType(artName: string): number {
    return LEAGUE_ART_SLICED.has(artName) ? LEAGUE_SPRITE_SLICED : LEAGUE_SPRITE_SIMPLE;
}

// ============================================================
// 按钮「置灰」色板
// ============================================================

/**
 * `cc.Sprite.color` 的**正常态**（不染色）与**置灰态**（压暗 + 去饱和的近似）。
 *
 * FGUI 的 `grayed` 是一层灰度滤镜，Cocos 的 `cc.Sprite` 只有顶点色**乘法**（做不出真灰度），
 * 只能用「压暗到 132/255」去近似。用在两处「FGUI 靠 `grayed` 表达不可用」的按钮上：
 * `组件_联盟_商店Item` 的 `btn_buy`（老端 `grayed = !canbuy`）与砍价面板的 `btn_buy`
 * （「已购买」页 `gearLook` 的 `grayed=1`）。
 *
 * ⚠️ **置灰 ≠ 关交互**：FGUI 的 `grayed` 按钮**点得动**，老端是在 click 里分支做提示
 *    （见 `LeagueStoreRow` 类头）。所以调用点只染 `color`，**不要**动 `interactable`。
 *
 * ⚠️ 导出的是 **4 元组**（不是 `cc.Color`）—— 本文件刻意保持**引擎无关**（可被单测直连）。
 *    调用点自己 `new Color(...LEAGUE_TINT_GRAY)` 建一次常量即可（别每次 render 都 new）。
 */
export const LEAGUE_TINT_NORMAL: readonly [number, number, number, number] = [255, 255, 255, 255];

/** 见 `LEAGUE_TINT_NORMAL`。 */
export const LEAGUE_TINT_GRAY: readonly [number, number, number, number] = [132, 132, 132, 255];

// ============================================================
// 奖励图标（`item` / `roleProperty` 两支分流，唯一入口）
// ============================================================

/** 资源类奖励（货币 / 属性，`roleProperty` 表）的图标目录 —— 转发活动模块的常量。 */
export const LEAGUE_RESOURCE_ICON_ART_ROOT = RESOURCE_ICON_ART_ROOT;

/** 一条奖励 → 图标 `{ root, name }`；解析不出返回 `null`（奖励格降级成只剩底框）。 */
export function leagueRewardIconRef(
    resId: number,
    items: ReadonlyMap<number, IActivityGoodsInfo>,
    resources: ReadonlyMap<number, IActivityGoodsInfo>,
): { root: string; name: string } | null {
    return resolveRewardIconRef(rewardGoodsOf(resId, items, resources));
}

export type { IActivityGoodsInfo as ILeagueGoodsInfo };
