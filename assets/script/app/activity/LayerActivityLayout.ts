/**
 * 活动（每日任务）的版面公式 —— 纯逻辑，不 import `cc`，可单测。
 * 把 FairyGUI「左上角原点、y 向下」坐标换算成 Cocos「中心原点、y 向上」。
 * prefab 里写死的数字必须与本文件对得上。
 *
 * 坐标口径（与 `MonthCardGiftLayout` 同一套）：
 *   canvasX = fguiX + width / 2 - 360
 *   canvasY = 640 - fguiY - height / 2
 *
 * FGUI 原稿：`zarts/.../assets/活动/组件/组件_活动_首页.xml`（720×1280，与画布 1:1）
 *           + `组件/组件_活动_内容.xml`（页签内容层）
 *           + `组件/组件_活动列表_项.xml`（任务行）
 *           + `自定义组件/组件_活动_进度宝箱.xml` + `组件_活动_宝箱item.xml`（进度宝箱）
 */

export const ACTIVITY_CANVAS_WIDTH = 720;
export const ACTIVITY_CANVAS_HEIGHT = 1280;

export interface ILayoutPoint {
    readonly x: number;
    readonly y: number;
}

/** FGUI 左上角坐标 → Cocos 节点中心坐标。 */
export function fguiTopLeftToCocos(
    x: number,
    y: number,
    width: number,
    height: number,
    parentW: number = ACTIVITY_CANVAS_WIDTH,
    parentH: number = ACTIVITY_CANVAS_HEIGHT,
): ILayoutPoint {
    return {
        x: x + width / 2 - parentW / 2,
        y: parentH / 2 - y - height / 2,
    };
}

// ============================================================
// 周活跃进度条（父容器 = `ProgressStrip`，606×92，画布坐标 (36, 279)）
// ============================================================
// FGUI `list_act` 是 (93,315) 606×92；换算到「以条自身中心为原点」的局部坐标：
//   localX = fguiX绝对中心 - (93 + 606/2)
//   localY = (315 + 46) - fguiY绝对中心

/** FGUI `list_act` 左上角 x（用于反推各元素的局部坐标，别在别处再抄一遍）。 */
export const ACTIVITY_STRIP_FGUI_X = 93;
export const ACTIVITY_STRIP_FGUI_Y = 315;
export const ACTIVITY_STRIP_WIDTH = 606;
export const ACTIVITY_STRIP_HEIGHT = 92;

/**
 * 进度条：一根九宫条，高 24，纵向中心在条的 `y = 18`（FGUI 里各片段的纵向中心）。
 *
 * ## ⚠️ 宽度不是照抄 FGUI，是按「8 档宝箱不重叠」反推出来的
 *
 *  FGUI 原稿里进度条**不是一根**，而是 `list_act` 里 8 个 `组件_活动_进度宝箱`，
 *  每个自带一段 **110px 定宽、pivot 在右端**的片段，节距 118 ⇒ 内容宽 944。
 *  它把 `list_act` 的视窗做成 606×92 并 `overflow="scroll"`，**靠横向滑动看后面的档位**，
 *  同时把第 0 段（在最左边、落在视窗外）整段裁掉、位置让给徽章。
 *  （同项目的七日狂欢 `SevenDay.prefab / BoxBar` 也是这套：宝箱 100 宽、节距 95，
 *   每箱自带上/下两根 100×24 / 100×16 的片段，靠 5px 重叠拼成一根连续条。）
 *
 *  「一根连续条 + 按 `cost` 比例定位的宝箱」在语义上更准（FGUI 那套的片段长度是定死的，
 *  档位间隔一旦不等长，画出来的条长就是错的 —— 本表恰好等长，所以旧端才没暴露）。
 *  但换成一根条之后，8 个宝箱就得挤进条里，于是条宽由**节距下界**倒推：
 *
 *      节距 = 条宽 / 档位数 ≥ 宝箱节点宽（否则相邻宝箱的触摸区/节点框互相压）
 *      左端还要让开徽章（`ACTIVITY_MEDAL_POS` 右缘 = 条局部 -266）
 *      右端不能顶出画布（条局部 324 = 画布右缘 360）
 *
 *  ⇒ 取条宽 592（条局部 `[-304, 288]`）：节距 74 ≥ 节点宽 72 ✓，
 *    第 0 档在 -230（左缘 -266，正好贴住徽章）、第 7 档在 +288（右缘 321 < 324）✓。
 *  改档位数 / 改条宽时**这两条都要重算**（`tests/activity.test.ts` 钉住了）。
 */
export const ACTIVITY_BAR_LEFT = -304;
export const ACTIVITY_BAR_WIDTH = 592;
/** 条的横向中心（不是 0：左边让给徽章那块，所以整条是右偏的）。 */
export const ACTIVITY_BAR_CENTER_X = ACTIVITY_BAR_LEFT + ACTIVITY_BAR_WIDTH / 2;
export const ACTIVITY_BAR_HEIGHT = 24;
export const ACTIVITY_BAR_CENTER_Y = 18;

/**
 * 一个宝箱节点的尺寸。
 *
 * 宽 72 < 节距 74（8 档时），保证相邻宝箱的节点框不叠；
 * 高 92 取 `list_act` 的高度，让探出条上下的宝箱 / 达标数字不被自己的节点框裁掉。
 */
export const ACTIVITY_CHEST_NODE_WIDTH = 72;
export const ACTIVITY_CHEST_NODE_HEIGHT = 92;

/**
 * 宝箱**图**的画布尺寸（正方形，`act_box_*` 原图 100×100）。
 *
 *  比节点宽小 6px：原图四周有 ~7px 透明边（实测 `act_box_claimable` 实体只有 86×71），
 *  66 时两箱之间的**可见**间隙 ≈ 74 − 86×0.66 ≈ 17px，看着是分开的。
 *  这个尺寸由 `ActivityProgressBox.applyArtSize()` 在运行时写进 `ChestBtn/Bg` ——
 *  ⚠️ 必须配 `Sprite.sizeMode = CUSTOM`，否则换 `spriteFrame` 时引擎会按原图回写 100×100。
 */
export const ACTIVITY_CHEST_ART_SIZE = 66;

/** 宝箱纵向中心（在条上方，落在进度条上沿）。 */
export const ACTIVITY_CHEST_CENTER_Y = 45;

/** 宝箱横向可排布区间 = 一根整条。 */
export const ACTIVITY_CHEST_SPAN = ACTIVITY_BAR_WIDTH;

/** 某个 `cost/costMax` 比例的宝箱在 `ProgressStrip` 局部坐标里的 x。 */
export function chestOffsetX(ratio: number): number {
    return ACTIVITY_BAR_LEFT + clampRatio(ratio) * ACTIVITY_CHEST_SPAN;
}

/** 进度条填充宽度（`0..ACTIVITY_BAR_WIDTH`）。 */
export function barFillWidth(ratio: number): number {
    return clampRatio(ratio) * ACTIVITY_BAR_WIDTH;
}

/** 宝箱在条上的节距（`档位数` 个宝箱均分整条）。 */
export function chestPitch(boxCount: number): number {
    return boxCount > 0 ? ACTIVITY_BAR_WIDTH / boxCount : ACTIVITY_BAR_WIDTH;
}

function clampRatio(ratio: number): number {
    if (!Number.isFinite(ratio) || ratio <= 0) return 0;
    return ratio >= 1 ? 1 : ratio;
}

// ============================================================
// 任务行（父容器 = 行模板 679×190）
// ============================================================

export const ACTIVITY_ROW_WIDTH = 679;
export const ACTIVITY_ROW_HEIGHT = 190;

/** 一行最多放几个奖励格 —— 与 prefab 里 `RowTemplate/RewardBar` 下的槽位数一致。 */
export const ACTIVITY_ROW_REWARD_SLOTS = 5;

/** 行底框 `act_row_bg`：FGUI (19,13) 658×175。 */
export const ACTIVITY_ROW_BG_POS = fguiTopLeftToCocos(19, 13, 658, 175, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_BG_SIZE = { width: 658, height: 175 } as const;

/**
 * 标题飘带 `act_row_ribbon`：FGUI (-2,0) 420×105，`scale="1,0.7"`。
 *
 * ⚠️ FGUI 那条 `scale` **没写 `pivot` ⇒ 按 (0,0) 即左上角缩放**（FairyGUI 的默认 pivot 是 0,0），
 *   所以缩放后飘带的纵向范围是 FGUI `y = 0 ~ 73.5`，不是「以中心缩 0.7」。
 *   对应到 Cocos：Ribbon 节点的锚点必须是 **(0, 1)**，位置 = 飘带的**左上角**。
 *   若按居中锚点写（本文件早期版本就是），飘带整体会**下移 15.75px**，
 *   把标题挤出飘带的可视区（肉眼看只是"字没在飘带上"，不会报错）。
 */
export const ACTIVITY_ROW_RIBBON_POS = {
    x: -ACTIVITY_ROW_WIDTH / 2 - 2,
    y: ACTIVITY_ROW_HEIGHT / 2,
} as const;
export const ACTIVITY_ROW_RIBBON_SIZE = { width: 420, height: 105 } as const;
export const ACTIVITY_ROW_RIBBON_SCALE_Y = 0.7;

/**
 * 标题文字：「标题 (进度/目标)」，fontSize 21，色 `#e4d79c`，描边 `#1d150e` 宽 3。
 *
 * ⚠️ 宽度**没有照抄 FGUI 的 206**：实测当前 5 条任务名在 21px 下的宽度是 **192 ~ 323**
 *   （`累计击杀2000只怪物 (2000/2000)` 最宽），照抄 206 会有 4 条走 `Label` 的 SHRINK
 *   把字缩到 13~17px（FGUI 那边是 `autoSize="none"`，干脆折行后被 30 高的框裁掉 —— 原稿本身是坏的）。
 *   行飘带自身有 420 宽（局部 `-341.5 ~ +78.5`），所以**左边缘保持 FGUI 的 `x = 21`**
 *   （局部 -318.5）、宽度放到 340（右边缘 21.5，仍在飘带内）。
 *   锚点用 **(0.5, 0.5)**，`POS` 是**加宽后那个框的中心**；文字对齐 = 左。
 */
export const ACTIVITY_ROW_TITLE_POS = fguiTopLeftToCocos(21, 15, 340, 30, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_TITLE_SIZE = { width: 340, height: 30 } as const;
export const ACTIVITY_ROW_TITLE_LEFT = 21 - ACTIVITY_ROW_WIDTH / 2;

/** 奖励格容器：FGUI (74,71) 350×90（`colGap=5`，每格 85×85）。 */
export const ACTIVITY_ROW_REWARD_BAR_POS = fguiTopLeftToCocos(74, 71, 350, 90, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_REWARD_BAR_SIZE = { width: 350, height: 90 } as const;
export const ACTIVITY_ROW_REWARD_SLOT_SIZE = 85;
export const ACTIVITY_ROW_REWARD_SLOT_GAP = 5;

/** 第 `index` 个奖励格在 `RewardBar` 里的 x（靠左排，与 FGUI `list` 的 `layout="row"` 一致）。 */
export function rewardSlotX(index: number): number {
    return -ACTIVITY_ROW_REWARD_BAR_SIZE.width / 2
        + ACTIVITY_ROW_REWARD_SLOT_SIZE / 2
        + index * (ACTIVITY_ROW_REWARD_SLOT_SIZE + ACTIVITY_ROW_REWARD_SLOT_GAP);
}

/**
 * 物品框**数量**（`Num`）的版面 —— 与格子边长有关，全工程**只有这一个真源**。
 *
 * ## 真源不是 `组件_活动列表_项_奖励Item.xml`（那里面只有一句 `<component com_goods>`）
 *
 * 数量在 FGUI 里是**物品框自己**画的：
 * `共用组件/组件/物品框/组件_公用_道具.xml`（**100×100 原稿**）里的
 * ```
 * <richtext name="text_number" xy="86,66" size="13,34" fontSize="24"
 *           color="#ffffff" align="right" vAlign="middle">
 *   <relation target="" sidePair="right-left%,top-top"/>
 * </richtext>
 * ```
 * 老端 `GObjGoodsBehavior.enter()` 按 `k = 格子边长 / 100` **整体缩放**里面那一整套
 * ⇒ 给定任一边长都能套这一个公式（85 的行内奖励格、90 的预览格都走它）。
 *
 * ⇒ 换算成**锚点 `(1,0.5)`** 的 Cocos 局部坐标：
 *   锚点取 `(1,0.5)` 是有意的 —— 个位数到四位数（`2` … `1000`）右缘必须**钉死**在同一个位置，
 *   否则数字一变长整个数字框就跟着漂。配合 `overflow=NONE`，多出来的位数往**左**溢（不是裁掉）。
 *
 * ⚠️ **已知的 1px 级历史分叉**：工程里已有 28 处 `Num`（`ShowReward` / `ItemDetail` /
 *   `MainTaskDetail` …），其中 `ItemDetail`（84 格）与 `ShowReward`（100 格）把右缘摆在了
 *   格子的**最右缘**（`42` / `50`），比本公式（`41.16` / `49`）多约 1px ——
 *   那是当年手摆的值，不是 `relation` 算出来的。这里**按 FGUI 的 relation 算**，
 *   并**不去动那两个 prefab**（28 处实例、收益只有 1px）。别反过来把本公式改成「最右缘」。
 */
export function rewardNumLayout(cellSize: number): {
    /** 格子边长 / 100 —— FGUI 的整体系数。 */
    readonly scale: number;
    /** **格子中心**为原点的局部坐标（`Num` 节点自身锚点 `(1, 0.5)`）。 */
    readonly pos: ILayoutPoint;
    readonly fontSize: number;
} {
    const scale = cellSize / 100;
    return {
        scale,
        pos: {
            // FGUI 左上 (86,66) + 13 宽 = 右缘 99；× k 后再减去半格 = 右缘的局部 x
            x: (86 + 13) * scale - cellSize / 2,
            // FGUI 高 34、vAlign=middle ⇒ 中心在 66 + 17；× k 后相对格心（锚点 y = 0.5）
            y: cellSize / 2 - (66 + 34 / 2) * scale,
        },
        // FGUI 24 × k（0.85 ⇒ 20.4 ⇒ 20；0.9 ⇒ 21.6 ⇒ 22）
        fontSize: Math.round(24 * scale),
    };
}

/** 行内奖励格（85×85）的数量版面。 */
const ROW_NUM_LAYOUT = rewardNumLayout(ACTIVITY_ROW_REWARD_SLOT_SIZE);
export const ACTIVITY_ROW_REWARD_NUM_SCALE = ROW_NUM_LAYOUT.scale;
export const ACTIVITY_ROW_REWARD_NUM_POS = ROW_NUM_LAYOUT.pos;
/** 字号 20（= 24 × 0.85 四舍五入）。 */
export const ACTIVITY_ROW_REWARD_NUM_FONT_SIZE = ROW_NUM_LAYOUT.fontSize;
/**
 * ⚠️ 这里**故意没有**「数量框尺寸」常量 —— `cc.Label` 的 `Overflow.NONE` 会按**实测文本**
 * 重写宿主的 `contentSize`（空串就写成 `0 × 25.2`），prefab 里写死的尺寸存不住（实测：
 * MCP 补写 `(11.05, 28.9)` 后存盘又变回 `(0, 25.2)`）。
 * 但**这正是想要的行为**：盒子永远紧贴文本，而锚点 `(1, 0.5)` 把**右缘钉死在 `POS.x`**
 * ⇒ 「2」和「1000」的右缘落在同一条竖线上、多的位数往左长。
 * 所以承重的是 **锚点 + `POS` + `fontSize`**，不是尺寸；`halign=RIGHT` 是在
 * 「盒子比文本宽」（将来若开 `enableWrapText`）时才生效的保险。
 */

/** 右侧按钮：FGUI (509,89) 132×63。 */
export const ACTIVITY_ROW_ACTION_POS = fguiTopLeftToCocos(509, 89, 132, 63, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_ACTION_SIZE = { width: 132, height: 63 } as const;

/** 已领取印章：FGUI (509,75) 119×74。 */
export const ACTIVITY_ROW_STAMP_POS = fguiTopLeftToCocos(509, 75, 119, 74, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_STAMP_SIZE = { width: 119, height: 74 } as const;

// ============================================================
// 外层（父容器 = 画布 720×1280）
// ============================================================

/** 主底板 `act_panel_bg`：FGUI (0,150) 720×1020。 */
export const ACTIVITY_PANEL_POS = fguiTopLeftToCocos(0, 150, 720, 1020);

/** 顶部装饰底 `act_top_bg`（森林景）：FGUI (26,228) 673×239。 */
export const ACTIVITY_TOP_BG_POS = fguiTopLeftToCocos(26, 228, 673, 239);
export const ACTIVITY_TOP_BG_SIZE = { width: 673, height: 239 } as const;

/**
 * 标题横幅：FGUI `图片/框体_frame/title_02.png`（359×93 带铆钉木板牌），摆在 (116,105) 461×119。
 *
 * ⚠️ 别绑 `image/common/title_02.png` —— 那是**另一张同名不同图**（253×44 扁平箭头条，
 *   宽高比 5.75 vs 本图 3.86），拉进 461×119 会横竖双向变形。
 *   工程里没有 359×93 的图，现从 zarts 拷到 `image/activity/act_title.png`。
 */
export const ACTIVITY_TITLE_POS = fguiTopLeftToCocos(116, 105, 461, 119);
export const ACTIVITY_TITLE_SIZE = { width: 461, height: 119 } as const;

/** 标题文字「每日任务」：FGUI (227,127) 240×76，fontSize 58，色 `#dbd394`，描边 `#140f0b`。 */
export const ACTIVITY_TITLE_LABEL_POS = fguiTopLeftToCocos(227, 127, 240, 76);
export const ACTIVITY_TITLE_LABEL_SIZE = { width: 240, height: 76 } as const;

/** 关闭按钮：FGUI (657,148) 60×55（组件本体 60×60，被 55 压一点，照抄）。 */
export const ACTIVITY_CLOSE_POS = fguiTopLeftToCocos(657, 148, 60, 55);
export const ACTIVITY_CLOSE_SIZE = { width: 60, height: 55 } as const;

/** 任务列表：FGUI (17,454) 688×660。 */
export const ACTIVITY_LIST_POS = fguiTopLeftToCocos(17, 454, 688, 660);
export const ACTIVITY_LIST_SIZE = { width: 688, height: 660 } as const;

/** 周活跃整条（含徽章/积分/条/宝箱）：FGUI (93,315) 606×92。 */
export const ACTIVITY_STRIP_POS = fguiTopLeftToCocos(93, 315, ACTIVITY_STRIP_WIDTH, ACTIVITY_STRIP_HEIGHT);

// ============================================================
// 周活跃左侧那块「徽章 + 积分 + 周活跃」
// ============================================================
// FGUI 里它们是 `list_act` 的兄弟节点，坐标在 `组件_活动_内容` 的绝对空间里；
// 换算到 `ProgressStrip` 局部坐标（见上面的两条公式）。

/** 徽章 `act_medal`：FGUI (47,301) 83×94。 */
export const ACTIVITY_MEDAL_POS = stripLocalOf(47, 301, 83, 94);
export const ACTIVITY_MEDAL_SIZE = { width: 83, height: 94 } as const;

/** 积分数字 `act_coin`：FGUI (0,323) 177×42，fontSize 30，色 `#f2efd4`，居中。 */
export const ACTIVITY_COIN_POS = stripLocalOf(0, 323, 177, 42);
export const ACTIVITY_COIN_SIZE = { width: 177, height: 42 } as const;

/** 「周活跃」字底 `act_week_tag`：FGUI (50,388) 79×36（九宫）。 */
export const ACTIVITY_WEEK_TAG_POS = stripLocalOf(50, 388, 79, 36);
export const ACTIVITY_WEEK_TAG_SIZE = { width: 79, height: 36 } as const;

/** 「周活跃」文字：FGUI (53,390) 70×32，fontSize 22，色 `#f2efd4`，描边黑 2。 */
export const ACTIVITY_WEEK_LABEL_POS = stripLocalOf(53, 390, 70, 32);
export const ACTIVITY_WEEK_LABEL_SIZE = { width: 70, height: 32 } as const;

/** FGUI 绝对坐标（`组件_活动_内容` 空间）→ `ProgressStrip` 局部坐标。 */
export function stripLocalOf(x: number, y: number, width: number, height: number): ILayoutPoint {
    const canvas = fguiTopLeftToCocos(x, y, width, height);
    return {
        x: canvas.x - ACTIVITY_STRIP_POS.x,
        y: canvas.y - ACTIVITY_STRIP_POS.y,
    };
}

// ============================================================
// 「奖励预览」气泡（`ui/Activity/RewardPreview.prefab`）
// ============================================================
// FGUI 真源：
//   `共用弹窗/组件/panel弹窗/奖励预览/组件_共用弹窗_查看奖励.xml`（根 530×150）
//   + `组件_共用弹窗_查看奖励气泡.xml`（气泡本体：底图 + 12 个方位箭头 + 横向 list）
//   + `组件_共用弹窗_奖励格子.xml`（一格 90×90 = 物品框实例，k = 0.9）
//
// 老端对应 `CtrlAlert.OpenPanelRewards` → `PanelPreviewRewards`：
//   · `getHasBackground() = false` ⇒ **无全屏遮罩**的浮动气泡；
//   · `list.width = 90n + 10(n−1)`、`n = min(5, 奖励条数)`；
//   · 定位走 `FW.FairyMgr.GetPoupPosition2(com_tips, gobj, PopInfoDirect.topmid, tmPos)`
//     —— 拿 `com_tips.com1..com12` 这 12 根箭头的位置当候选锚点，按
//     「不越界得分 + 离屏幕中心越近得分越高 + 命中期望方位 ×10」排序取第一名。
//
// ★ 本端**有意不复刻那 12 方位箭头**，理由有两条，都不是审美问题：
//   ① 老端在 `PanelPreviewRewards.ts` 文件头自己注明了
//      「注意，该方法不适用于720p的界面，位置信息错误」，而本端设计分辨率**正好是 720×1280**
//      ⇒ 照抄等于把老端已知的 bug 一起搬过来；
//   ② 那 12 根箭头的图是 `共用弹窗/图片/城堡_按钮_箭头.png`（51×51，FGUI 里靠 `gearLook`
//      转 4 个方向**共用同一张图**），**本端没有这张图**，也不该为它新造美术。
//   ⇒ 改成一条**确定性**规则：**贴在宝箱正上方、水平居中、夹进屏幕内；上方放不下就翻到下方**。
//     纯函数、可单测（`previewBubblePlacement`），且与「点哪个宝箱」一一对应，不会指错目标。
//
// 气泡本体几何照 FGUI：`list xy="15,25" size="500,100"`，里放 90×90 的格子、`colGap=10`、
// `vAlign=middle` ⇒ 格顶 = 25 + (100−90)/2 = 30、格心 = 30 + 45 = **75 = 150/2**
// ⇒ **格子正好落在气泡正中**（所以本端格子的 y 恒为 0，不需要额外的纵向偏移）。
//
// 气泡宽随格数长：`2×15 + n×90 + (n−1)×10`（n=5 ⇒ 520）。
// ⚠️ FGUI 根是 530（`relation target=list width-width` ⇒ 根 = `list.width + 30`，
//   而它的 `list` 视窗写死 500，比 5 格所需的 490 多 10）⇒ 本端按**内容所需**算 520，
//   不做那个「视窗比内容宽 10」的余量。

export const ACTIVITY_PREVIEW_CELL_SIZE = 90;
export const ACTIVITY_PREVIEW_CELL_GAP = 10;
/** FGUI `list` 的 `x = 15`（左右各一份）⇒ 气泡宽 = `2×15 + 内容宽`。 */
export const ACTIVITY_PREVIEW_PADDING_X = 15;
/** FGUI 根高 150。 */
export const ACTIVITY_PREVIEW_HEIGHT = 150;
/**
 * 最多几格。
 *
 * 与 `Bubble/Cells` 下的格子数**硬绑定**（`tests/activity.test.ts` 钉住了 prefab 里的节点数）；
 * FGUI `list` 也是摆 5 个 `item`、老端再 `Math.min(5, tlGoods.length)`。
 * 奖励超过这个数**不静默丢**：宿主会 `console.warn` 留痕。
 */
export const ACTIVITY_PREVIEW_MAX_CELLS = 5;
/** 气泡**底边**与宝箱**顶边**之间的间隙。 */
export const ACTIVITY_PREVIEW_ANCHOR_GAP = 12;
/** 气泡离屏幕左右 / 上下的最小留白。 */
export const ACTIVITY_PREVIEW_SCREEN_MARGIN = 8;

/** 预览格（90×90）的数量版面 —— 与行内格共用 `rewardNumLayout`。 */
const PREVIEW_NUM_LAYOUT = rewardNumLayout(ACTIVITY_PREVIEW_CELL_SIZE);
export const ACTIVITY_PREVIEW_NUM_SCALE = PREVIEW_NUM_LAYOUT.scale;
export const ACTIVITY_PREVIEW_NUM_POS = PREVIEW_NUM_LAYOUT.pos;
/** 字号 22（= 24 × 0.9 四舍五入）。 */
export const ACTIVITY_PREVIEW_NUM_FONT_SIZE = PREVIEW_NUM_LAYOUT.fontSize;

/** 把「要显示的格数」夹到 `1..ACTIVITY_PREVIEW_MAX_CELLS`。 */
export function previewCellCount(cellCount: number): number {
    const n = Math.floor(cellCount);
    if (!Number.isFinite(n) || n < 1) return 1;
    return n > ACTIVITY_PREVIEW_MAX_CELLS ? ACTIVITY_PREVIEW_MAX_CELLS : n;
}

/** 气泡宽度（按可见格数）。 */
export function previewBubbleWidth(cellCount: number): number {
    const n = previewCellCount(cellCount);
    return ACTIVITY_PREVIEW_PADDING_X * 2
        + n * ACTIVITY_PREVIEW_CELL_SIZE
        + (n - 1) * ACTIVITY_PREVIEW_CELL_GAP;
}

/** 第 `index` 格在气泡**局部**坐标里的 x（相对气泡中心，整排居中）。 */
export function previewCellX(index: number, cellCount: number): number {
    const left = -previewBubbleWidth(cellCount) / 2 + ACTIVITY_PREVIEW_PADDING_X;
    return left + index * (ACTIVITY_PREVIEW_CELL_SIZE + ACTIVITY_PREVIEW_CELL_GAP)
        + ACTIVITY_PREVIEW_CELL_SIZE / 2;
}

/** 锚点（宝箱）在 **UI 世界坐标**里的盒 —— `left/bottom/width/height` 口径同 `getBoundingBoxToWorld`。 */
export interface IPreviewAnchorBox {
    readonly left: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
}

/** 气泡摆放结果（**UI 世界坐标**）。 */
export interface IPreviewPlacement {
    /** 气泡**中心**的 x。 */
    readonly x: number;
    /** 气泡**中心**的 y。 */
    readonly y: number;
    /** 是否翻到了锚点**下方**（上方顶出屏幕上沿时）。 */
    readonly below: boolean;
}

/**
 * 气泡摆放 —— **UI 世界坐标**（原点在屏幕左下角，与 `event.getUILocation()` /
 * `getBoundingBoxToWorld()` 同一套，见 `PopupBase.isPointOnNode` 的长注释）。
 *
 * 规则（确定性，无随机、无择优打分）：
 *   ① 优先贴在锚点**正上方**：气泡底边 = 锚点顶边 + `gap`；
 *   ② 水平居中于锚点，再把整条夹进 `[margin, viewWidth − margin]`
 *      （气泡比屏还宽时改为「屏心对齐」，不再夹）；
 *   ③ 上方顶出屏幕上沿 ⇒ 翻到**正下方**（气泡顶边 = 锚点底边 − `gap`）；
 *   ④ 下方也放不下（极矮屏）⇒ 回退成「上方、贴住屏幕上沿内壁」——
 *      宁可压住宝箱，也不能把气泡画到屏幕外（画到屏外等于没反馈）。
 *
 * @param viewWidth/viewHeight 可见区尺寸（`view.getVisibleSize()`）。
 */
export function previewBubblePlacement(
    anchor: IPreviewAnchorBox,
    bubbleWidth: number,
    bubbleHeight: number,
    viewWidth: number,
    viewHeight: number,
    margin: number = ACTIVITY_PREVIEW_SCREEN_MARGIN,
    gap: number = ACTIVITY_PREVIEW_ANCHOR_GAP,
): IPreviewPlacement {
    const anchorCx = anchor.left + anchor.width / 2;
    const minX = bubbleWidth / 2 + margin;
    const maxX = viewWidth - bubbleWidth / 2 - margin;
    const x = minX > maxX ? viewWidth / 2 : Math.min(Math.max(anchorCx, minX), maxX);

    const anchorTop = anchor.bottom + anchor.height;
    const aboveY = anchorTop + gap + bubbleHeight / 2;
    if (aboveY + bubbleHeight / 2 <= viewHeight - margin) {
        return { x, y: aboveY, below: false };
    }

    const belowY = anchor.bottom - gap - bubbleHeight / 2;
    if (belowY - bubbleHeight / 2 >= margin) {
        return { x, y: belowY, below: true };
    }

    return { x, y: viewHeight - margin - bubbleHeight / 2, below: false };
}
