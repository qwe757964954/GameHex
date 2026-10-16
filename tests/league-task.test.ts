/**
 * 「联盟」P5（**联盟任务 `LeagueTask`**）的回归网。
 *
 * 与 `league-hall*.test.ts` / `league-apply-edit.test.ts` / `league-join-create.test.ts` /
 * `league-mgr-info.test.ts` / `league-store-donate-discount.test.ts` 同一套五段口径：
 *
 *   A. **文案口径**（`LeagueTexts`）—— 标题 / 两颗按钮 / 百分比模板 / 广告行模板 / 跳转缺省提示。
 *   B. **美术口径**（`LeagueArt`）—— P5 的图名别名（与大厅 / 商店共用哪几张）、
 *      **宝箱三态图「图名数字 ≠ 状态名」**、九宫格集合（`bar_bg_01` / 按钮进、
 *      `bar_bg_01_hong` / `BB_img03` / `zb*` / `tag_gou` **不进**）。
 *   C. **数据口径**（`LeagueTable`）—— `parseTaskUnionRows` / `parseTaskUnionProgressRows` /
 *      `leagueTaskStateOf` / `buildLeagueTaskRowView(s)` / `leagueTaskProgress` /
 *      `leagueTaskBoxState` / `buildLeagueTaskBoxViews` / `hasLeagueTaskRedDot`，
 *      并对 `remoteRef/taskUnion.json` + `taskUnionProgress.json` 的**现网真行**做探针。
 *   D. **prefab 结构 + 几何**（`ui/League/LeagueTask.prefab` + `LeagueTaskBox.prefab`）
 *      —— `D1`~`D11`：脚本 cid（从 `.ts.meta` 反解，禁手抄）、全 UI_2D、顶层渲染序、
 *      每个视觉框逐条对 FGUI 原 XML、图 uuid + 九宫格 type、Label 排版、虚拟列表装配、
 *      嵌套实例（3 个宝箱 / 1 颗红点）、`@property` 逐条。
 *   E. **页面逻辑 / 调用约定**（源码文本）—— 「列表不发请求」、`nextPopupFrame` 时序、
 *      防连点、宝箱三支、浮框定位、三处「别按直觉改」（红点同源 / 不建 go·adv 红点 / adv 恒灭）。
 *
 * ## 口径真源
 *
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/任务/组件_联盟_任务.xml`、
 *     `…/任务/组件_联盟_任务item.xml`、`…/任务/组件_联盟_宝箱.xml`、
 *     `…/任务/组件_联盟_任务_奖励框.xml`、`…/组件/组件_联盟_进度条.xml`、
 *     `共用组件/组件/弹窗/组件_公共弹窗_新.xml`、`共用组件/组件/物品框/组件_公用_道具.xml`、
 *     `共用组件/组件/按钮/按钮_公共_通用.xml`、`共用组件/组件/按钮/按钮_公共_通用_图标.xml`、
 *     `共用组件/组件/按钮/按钮_公共_通用自动大小_变暗.xml`
 *   - 表：`assets/remoteRef/taskUnion.json`（33 行，`subType==1` 的 **8** 行）、
 *     `assets/remoteRef/taskUnionProgress.json`（3 行：1→3 / 2→5 / 3→8）
 *   - 老端：`client/.../league/play/LayerLeagueTask.ts`、`client/.../model/league/ModelLeague.ts`
 *     （`hasTaskRD` / `hasTaskHeadRewardRD`）、`model/vo/Other/VOLeagueTask.ts`
 *   - 本项目：`assets/script/app/league/**`
 *
 * ## ⚠️ P5 里几条**刻意与直觉相反**的口径（回归点，别"顺手改对"）
 *
 *   ① **宝箱图名里的数字不是状态名**：`gearIcon pages="2,1,0" values="zb0|zb1|zb2"`
 *      ⇒ `zb0` 是「不可领取」、`zb2` 是「已领取」。
 *   ② **`btn_get` 的红点与它的可见性同源**：老端两者都由 `CanBeReward()` 决定
 *      ⇒ 按钮一出现红点必然亮。看着冗余，照抄。
 *   ③ **`btn_go` / `btn_adv` 不建红点**：FGUI 按钮组件自带 `组件_红点`，但老端**从没驱动**
 *      ⇒ 建出来只是恒灭（有意偏离）。
 *   ④ **`btn_adv` 恒不可见**：广告子系统没迁（`LEAGUE_AD_PLAYBACK_AVAILABLE = false`）。
 *   ⑤ **领宝箱的请求体只有 `subType`**（没有宝箱 id）：服务端按
 *      `CmdRoleUnion.todayTaskGetProgressCount` 自己推进。
 *   ⑥ **顶部进度条的分母是「有 VO 的任务数」**，不是 `taskUnion` 表行数。
 *   ⑦ **嵌套 prefab 实例的壳节点名默认 = 源 prefab 的根名**（`prefab_prefab_instance
 *      instantiate` 不吃名字）⇒ `Box1/Box2/Box3` 必须在实例化后用 `node_transform { name }`
 *      补一刀才叫这个名字；补完会落成实例 `propertyOverrides` 里的 `['_name']`。
 *      同类：`BtnGet/RedDot` 与 `LeagueTaskBox/RedDot` 之所以「本来就对」，只是因为源
 *      prefab 根名恰好叫 `RedDot` —— **不是**因为有人改过名。
 *   ⑧ **实例壳上不序列化 UITransform**（尺寸为 0）、**也不序列化 `_layer`**
 *      ⇒ D3/D6/D7/D8 对壳只查位置（`propertyOverrides._lpos`），不查尺寸与层级。
 *      壳的真实尺寸在源 prefab 自己的回归里钉（本文件 D8 的「根 90×100」）。
 *   ⑨ **`CountLabel` 的宽高查不了**：FGUI 无 `autoSize` ⇒ `overflow NONE(0)`，
 *      引擎按文本重写 `contentSize`（21×39 只是设计稿占位）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_AD_VIDEO,
    LEAGUE_ART_BTN_JOIN,
    LEAGUE_ART_LEVEL_ROW_BG,
    LEAGUE_ART_LEVEL_ROW_CTX_BAR,
    LEAGUE_ART_LEVEL_ROW_TITLE_BAR,
    LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA,
    LEAGUE_ART_OPS_BTN,
    LEAGUE_ART_POPUP_BOARD,
    LEAGUE_ART_POPUP_CLOSE,
    LEAGUE_ART_POPUP_TITLE_BG,
    LEAGUE_ART_POPUP_TITLE_DECO,
    LEAGUE_ART_PROGRESS_BG,
    LEAGUE_ART_PROGRESS_FILL,
    LEAGUE_ART_SLICED,
    LEAGUE_ART_TASK_AD_BADGE,
    LEAGUE_ART_TASK_AD_BTN,
    LEAGUE_ART_TASK_AD_TEXT_COLOR,
    LEAGUE_ART_TASK_AD_TEXT_STROKE,
    LEAGUE_ART_TASK_BOX_CAN_REWARD,
    LEAGUE_ART_TASK_BOX_CHECK,
    LEAGUE_ART_TASK_BOX_LOCKED,
    LEAGUE_ART_TASK_BOX_REWARDED,
    LEAGUE_ART_TASK_BOX_VALUE_COLOR,
    LEAGUE_ART_TASK_BOX_VALUE_STROKE,
    LEAGUE_ART_TASK_CIRCLE,
    LEAGUE_ART_TASK_COUNT_COLOR,
    LEAGUE_ART_TASK_COUNT_STROKE,
    LEAGUE_ART_TASK_DONE_TAG,
    LEAGUE_ART_TASK_GET_BTN,
    LEAGUE_ART_TASK_GO_BTN,
    LEAGUE_ART_TASK_HEAD_BG,
    LEAGUE_ART_TASK_HEAD_TINT,
    LEAGUE_ART_TASK_PROGRESS_BG,
    LEAGUE_ART_TASK_PROGRESS_FILL,
    LEAGUE_ART_TASK_PROGRESS_TEXT_COLOR,
    LEAGUE_ART_TASK_PROGRESS_TEXT_STROKE,
    LEAGUE_ART_TASK_REWARD_BG,
    LEAGUE_ART_TASK_REWARD_BG_TINT,
    LEAGUE_ART_TASK_ROW_BG,
    LEAGUE_ART_TASK_ROW_TITLE_BAR,
    LEAGUE_ART_TASK_ROW_TITLE_BAR_ALPHA,
    LEAGUE_SPRITE_SIMPLE,
    LEAGUE_SPRITE_SLICED,
    leagueSpriteType,
    leagueTaskBoxArt,
} from '../assets/script/app/league/LeagueArt';
import {
    buildLeagueTaskBoxViews,
    buildLeagueTaskRowView,
    buildLeagueTaskRowViews,
    hasLeagueTaskRedDot,
    LEAGUE_ENTRANCES,
    LEAGUE_ENTRANCE_RED_DOT_SOURCE,
    LeagueUnionTaskType,
    LEAGUE_TASK_PROGRESS_TABLE,
    LEAGUE_TASK_UNION_TABLE,
    leagueTaskBoxState,
    leagueTaskProgress,
    leagueTaskStateOf,
    parseTaskUnionProgressRows,
    parseTaskUnionRows,
    type ILeagueTaskCmd,
    type ILeagueTaskProgressRow,
    type ILeagueTaskUnionRow,
} from '../assets/script/app/league/LeagueTable';
import {
    fillLeagueText,
    LEAGUE_AD_PLAYBACK_AVAILABLE,
    LEAGUE_TASK_AD_TEXT_TEMPLATE,
    LEAGUE_TASK_BTN_GET,
    LEAGUE_TASK_BTN_GO,
    LEAGUE_TASK_GOTO_MISSING,
    LEAGUE_TASK_PERCENT_TEMPLATE,
    LEAGUE_TASK_TITLE,
} from '../assets/script/app/league/LeagueTexts';

// ============================================================
// 路径
// ============================================================

const TASK_PREFAB = 'assets/resources/ui/League/LeagueTask.prefab';
const BOX_PREFAB = 'assets/resources/ui/League/LeagueTaskBox.prefab';
const RED_DOT_PREFAB = 'assets/resources/ui/common/RedDot.prefab';

const PAGE_TS = 'assets/script/app/league/LeagueTaskPage.ts';
const ROW_TS = 'assets/script/app/league/LeagueTaskRow.ts';
const BOX_TS = 'assets/script/app/league/LeagueTaskBox.ts';
const SLOT_TS = 'assets/script/app/league/LeagueRewardSlot.ts';
const REPO_TS = 'assets/script/app/league/LeagueRepository.ts';
const LEAGUE_PAGE_TS = 'assets/script/app/league/LeaguePage.ts';
const VSCROLL_TS = 'assets/script/vscrollview/VScrollView.ts';

const TASK_UNION_JSON = 'assets/remoteRef/taskUnion.json';
const TASK_PROGRESS_JSON = 'assets/remoteRef/taskUnionProgress.json';

const UI_2D = 33554432;

// ============================================================
// A. 文案
// ============================================================

test('A1 面板文案：标题 / 两颗按钮 / 百分比模板 / 跳转缺省提示', () => {
    assert.equal(LEAGUE_TASK_TITLE, '联盟任务');
    assert.equal(LEAGUE_TASK_BTN_GET, '领取');
    assert.equal(LEAGUE_TASK_BTN_GO, '前往');
    // 行内百分比的模板（老端 `Math.floor(now / max * 100) + "%"`）
    assert.equal(LEAGUE_TASK_PERCENT_TEMPLATE, '{0}%');
    // 措辞逐字取自 `SevenDayTexts.gotoMissing`（跳转路由没迁，全工程同一条提示）
    assert.equal(LEAGUE_TASK_GOTO_MISSING, '该功能暂未开放');
});

test('A2 ⚠️ 广告行模板：FGUI 静态串带半角冒号、代码模板不带（运行时以表为准）', () => {
    assert.equal(LEAGUE_TASK_AD_TEXT_TEMPLATE, '每日观看广告跳过剩余次数{0}/{1}');
    assert.equal(fillLeagueText(LEAGUE_TASK_AD_TEXT_TEMPLATE, 1, 1), '每日观看广告跳过剩余次数1/1');
    // FGUI `组件_联盟_任务.xml` 的 `lab_jump` 静态串是「…剩余次数:1/1」（**带半角冒号**）；
    // 运行时文案来自 `mL.json`（`VIEW_AD_SKIP_TEXT`，不带冒号）⇒ 两者**有意**差一个冒号。
    // prefab 里落的是 FGUI 设计稿原串（见 D7 的 Label 表），代码里用不带冒号的模板。
    assert.notEqual(LEAGUE_TASK_AD_TEXT_TEMPLATE, '每日观看广告跳过剩余次数:{0}/{1}');
});

test('A3 广告能力闸 = true（已接通 ⇒ 整行显形 + `btn_adv` 有条件显示）', () => {
    // 广告播放由 `LeagueAd.playLeagueAd()` 承接（Mock，无 SDK），次数按 `ad` 表 + `CmdAdvert` 推导
    // ⇒ 闸打开后底部那行显示**真值**，不再是隐藏 / 假的 0/0。
    assert.equal(LEAGUE_AD_PLAYBACK_AVAILABLE, true, '广告已接通，别再关着');
});

// ============================================================
// B. 美术
// ============================================================

test('B1 图名别名：与大厅 / 商店共用哪几张（别以为 FGUI 用了新图）', () => {
    // 顶部横幅底 = 行底框 = 大厅等级行底框（同一张 frame_Zhikuang01，只差一层色调）
    assert.equal(LEAGUE_ART_TASK_HEAD_BG, LEAGUE_ART_LEVEL_ROW_BG);
    assert.equal(LEAGUE_ART_TASK_HEAD_BG, 'frame_Zhikuang01');
    assert.equal(LEAGUE_ART_TASK_ROW_BG, LEAGUE_ART_LEVEL_ROW_BG);
    // 行标题衬底 = 大厅行标题衬底
    assert.equal(LEAGUE_ART_TASK_ROW_TITLE_BAR, LEAGUE_ART_LEVEL_ROW_TITLE_BAR);
    assert.equal(LEAGUE_ART_TASK_ROW_TITLE_BAR, 'BB_img03');
    assert.equal(LEAGUE_ART_TASK_ROW_TITLE_BAR_ALPHA, LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA);
    assert.equal(LEAGUE_ART_TASK_ROW_TITLE_BAR_ALPHA, 128);
    // 进度条 = 大厅经验条
    assert.equal(LEAGUE_ART_TASK_PROGRESS_BG, LEAGUE_ART_PROGRESS_BG);
    assert.equal(LEAGUE_ART_TASK_PROGRESS_BG, 'bar_bg_01');
    assert.equal(LEAGUE_ART_TASK_PROGRESS_FILL, LEAGUE_ART_PROGRESS_FILL);
    assert.equal(LEAGUE_ART_TASK_PROGRESS_FILL, 'bar_bg_01_hong');
    // 浮框底 = 创建页 / 等级行的衬底（原图纯白，全靠 tint 上色）
    assert.equal(LEAGUE_ART_TASK_REWARD_BG, LEAGUE_ART_LEVEL_ROW_CTX_BAR);
    assert.equal(LEAGUE_ART_TASK_REWARD_BG, 'white_jiao8');
    // 两颗按钮 = 申请行的「加入」/「拒绝」同图
    assert.equal(LEAGUE_ART_TASK_GET_BTN, LEAGUE_ART_BTN_JOIN);
    assert.equal(LEAGUE_ART_TASK_GET_BTN, 'TY_btn06');
    assert.equal(LEAGUE_ART_TASK_GO_BTN, LEAGUE_ART_OPS_BTN);
    assert.equal(LEAGUE_ART_TASK_GO_BTN, 'TY_btn07');
    assert.equal(LEAGUE_ART_TASK_AD_BTN, LEAGUE_ART_OPS_BTN);
    assert.equal(LEAGUE_ART_TASK_AD_BADGE, LEAGUE_ART_AD_VIDEO);
    assert.equal(LEAGUE_ART_TASK_AD_BADGE, 'img_video');
    // 圆环装饰
    assert.equal(LEAGUE_ART_TASK_CIRCLE, 'frame_yuan_pic02');
});

test('B2 色调 / 描边色：逐条对 FGUI 的 `color` / `strokeColor`', () => {
    assert.deepEqual([...LEAGUE_ART_TASK_HEAD_TINT], [0x65, 0x7d, 0x54]); // n29 color="#657d54"
    assert.deepEqual([...LEAGUE_ART_TASK_REWARD_BG_TINT], [0x33, 0x33, 0x33]); // n37 color="#333333"
    assert.deepEqual([...LEAGUE_ART_TASK_PROGRESS_TEXT_COLOR], [0xfc, 0xf0, 0xd6]); // lab_title
    assert.deepEqual([...LEAGUE_ART_TASK_PROGRESS_TEXT_STROKE], [0x16, 0x0e, 0x08]);
    assert.deepEqual([...LEAGUE_ART_TASK_COUNT_COLOR], [0xff, 0xd6, 0x73]); // lab_count
    assert.deepEqual([...LEAGUE_ART_TASK_COUNT_STROKE], [0x00, 0x00, 0x00]);
    assert.deepEqual([...LEAGUE_ART_TASK_AD_TEXT_COLOR], [0xff, 0xff, 0xff]); // lab_jump
    assert.deepEqual([...LEAGUE_ART_TASK_AD_TEXT_STROKE], [0x00, 0x00, 0x00]);
    assert.deepEqual([...LEAGUE_ART_TASK_BOX_VALUE_COLOR], [0xed, 0xe5, 0xae]); // lab_value
    assert.deepEqual([...LEAGUE_ART_TASK_BOX_VALUE_STROKE], [0x00, 0x00, 0x00]);
});

test('B3 ⚠️ 宝箱三态图：`gearIcon pages="2,1,0" values="zb0|zb1|zb2"` ⇒ 图名数字 ≠ 状态名', () => {
    // 不可领取 → zb0 / 可领取 → zb1 / 已领取 → zb2
    assert.equal(leagueTaskBoxArt('locked'), 'zb0');
    assert.equal(leagueTaskBoxArt('canReward'), 'zb1');
    assert.equal(leagueTaskBoxArt('rewarded'), 'zb2');
    assert.equal(LEAGUE_ART_TASK_BOX_LOCKED, 'zb0');
    assert.equal(LEAGUE_ART_TASK_BOX_CAN_REWARD, 'zb1');
    assert.equal(LEAGUE_ART_TASK_BOX_REWARDED, 'zb2');
    // 未知状态兜底走「不可领取」（与 `leagueTaskStateOf` 的兜底同口径）
    assert.equal(leagueTaskBoxArt('nope' as never), 'zb0');
    // 「已领取」的对勾只在已领取页
    assert.equal(LEAGUE_ART_TASK_BOX_CHECK, 'tag_gou');
    // 行内「已领取」整幅标
    assert.equal(LEAGUE_ART_TASK_DONE_TAG, '公用_图标_已领取');
});

test('B4 ⚠️ 九宫格集合：`bar_bg_01` / 两颗按钮进；`bar_bg_01_hong` / `BB_img03` / zb* / tag_gou **不进**', () => {
    // 进集合 ⇒ prefab 必须 `_type = 1`（横向拉宽才不变形）
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_TASK_HEAD_BG), 'frame_Zhikuang01 必须九宫格');
    assert.equal(leagueSpriteType(LEAGUE_ART_TASK_HEAD_BG), LEAGUE_SPRITE_SLICED);
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_TASK_PROGRESS_BG), 'bar_bg_01 必须九宫格');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_TASK_GET_BTN), 'TY_btn06 必须九宫格');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_TASK_GO_BTN), 'TY_btn07 必须九宫格');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_TASK_REWARD_BG), 'white_jiao8 必须九宫格');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_POPUP_BOARD), 'panel_window_01_9gong 必须九宫格');

    // 不进集合 ⇒ `_type = 0`
    for (const art of [
        LEAGUE_ART_TASK_PROGRESS_FILL, // bar_bg_01_hong：包里没标 scale9grid，靠改宽度
        LEAGUE_ART_TASK_ROW_TITLE_BAR, // BB_img03：488 vs 原生 233 —— 直接拉伸（原稿就是拉伸）
        LEAGUE_ART_TASK_CIRCLE, // frame_yuan_pic02
        LEAGUE_ART_TASK_DONE_TAG, // 公用_图标_已领取
        LEAGUE_ART_TASK_BOX_LOCKED,
        LEAGUE_ART_TASK_BOX_CAN_REWARD,
        LEAGUE_ART_TASK_BOX_REWARDED,
        LEAGUE_ART_TASK_BOX_CHECK,
        LEAGUE_ART_TASK_AD_BADGE,
    ]) {
        assert.ok(!LEAGUE_ART_SLICED.has(art), `${art} 不该在九宫格集合里`);
        assert.equal(leagueSpriteType(art), LEAGUE_SPRITE_SIMPLE, `${art} 应按 SIMPLE 用`);
    }
    // 弹窗骨架的三张（P2 起就在集合里的只有底板）
    assert.ok(!LEAGUE_ART_SLICED.has(LEAGUE_ART_POPUP_TITLE_BG));
    assert.ok(!LEAGUE_ART_SLICED.has(LEAGUE_ART_POPUP_TITLE_DECO));
    assert.ok(!LEAGUE_ART_SLICED.has(LEAGUE_ART_POPUP_CLOSE));
});

// ============================================================
// C. 数据口径
// ============================================================

/** 一行 `taskUnion` 的构造器（只写关心的字段，其余给默认值）。 */
const unionRow = (
    resId: number,
    name: string,
    targetCount: number,
    rewardResIds: readonly number[] = [13, 11],
    goto = 1,
): ILeagueTaskUnionRow => ({
    resId,
    subType: LeagueUnionTaskType.leagueTask,
    targetType: 0,
    targetCount,
    reward: rewardResIds.map((id) => ({ resId: id, number: 10 })),
    name,
    goto,
});

const cmd = (resId: number, count: number, rewardState: number): ILeagueTaskCmd => ({ resId, count, rewardState });

test('C1 表名常量（老端 `Ref.RefMgrtaskUnion` / `Ref.RefMgrtaskUnionProgress`）', () => {
    assert.equal(LEAGUE_TASK_UNION_TABLE, 'taskUnion');
    assert.equal(LEAGUE_TASK_PROGRESS_TABLE, 'taskUnionProgress');
    // 三档 `EnumUnionTaskType` 都要留着（表里多档混排，过滤时漏一个会串模块）
    assert.deepEqual({ ...LeagueUnionTaskType }, { leagueTask: 1, leagueDamage: 2, leagueRoleDamage: 3 });
});

test('C2 parseTaskUnionRows：只留 `subType == LeagueTask`，`param.count` → `targetCount`，脏行丢弃', () => {
    const raw = {
        k: ['resId', 'subType', 'targetType', 'param', 'reward', 'name', 'goto'],
        v: [
            [501001, 1, 3, { count: 1 }, [{ number: 10, resId: 13 }], '合成{count}次宝石', 1],
            [502001, 2, 3, { count: 5 }, [{ number: 1, resId: 11 }], '联盟伤害', 0], // 别档 ⇒ 丢
            [503001, 3, 3, { count: 5 }, [], '个人伤害', 0], // 别档 ⇒ 丢
            ['bad', 1, 0, { count: 1 }, [], '脏行', 0], // resId 解析不出 ⇒ 丢
            [501002, 1, 30, { count: 2 }, [{ number: 50, resId: 11 }], '开启高级宝箱{count}次', 8],
        ],
    };
    const rows = parseTaskUnionRows(raw);
    assert.deepEqual(rows.map((r) => r.resId), [501001, 501002]);
    assert.equal(rows[0].targetCount, 1);
    assert.equal(rows[1].targetCount, 2);
    assert.equal(rows[0].goto, 1);
    assert.equal(rows[1].goto, 8);
    assert.equal(rows[1].name, '开启高级宝箱{count}次');
    assert.deepEqual(rows[1].reward, [{ resId: 11, number: 50 }]);
    // `param` 缺 / `goto` 缺 ⇒ 兜底 0（不抛）
    const loose = parseTaskUnionRows({
        k: ['resId', 'subType', 'targetType', 'param', 'reward', 'name', 'goto'],
        v: [[501003, 1, 0, null, null, null, 'x']],
    });
    assert.equal(loose.length, 1);
    assert.equal(loose[0].targetCount, 0);
    assert.equal(loose[0].goto, 0);
    assert.equal(loose[0].name, '');
    assert.deepEqual(loose[0].reward, []);
    // 非对象输入不炸
    assert.deepEqual(parseTaskUnionRows(null), []);
    assert.deepEqual(parseTaskUnionRows(undefined), []);
});

test('C3 parseTaskUnionProgressRows：按 `id` 升序（宝箱顺序 = id 序）', () => {
    const rows = parseTaskUnionProgressRows({
        k: ['id', 'count', 'rewards'],
        v: [[3, 8, [{ number: 300, resId: 11 }]], [1, 3, [{ number: 100, resId: 11 }]], [2, 5, []]],
    });
    assert.deepEqual(rows.map((r) => r.id), [1, 2, 3]);
    assert.deepEqual(rows.map((r) => r.count), [3, 5, 8]);
    assert.deepEqual(rows[0].rewards, [{ resId: 11, number: 100 }]);
    assert.deepEqual(rows[1].rewards, []);
});

test('C4 leagueTaskStateOf：`CmdCommonState` 0/1/2 → undone/canReward/rewarded，未知按 undone', () => {
    assert.equal(leagueTaskStateOf(0), 'undone');
    assert.equal(leagueTaskStateOf(1), 'canReward'); // ⚠️ FINISH 的语义是「可领奖」
    assert.equal(leagueTaskStateOf(2), 'rewarded');
    assert.equal(leagueTaskStateOf(-1), 'undone');
    assert.equal(leagueTaskStateOf(Number.NaN), 'undone');
    assert.equal(leagueTaskStateOf(99), 'undone');
});

test('C5 buildLeagueTaskRowView：标题替换 / 百分比向下取整 / 进度截断 / 奖励按下标硬取', () => {
    const row = unionRow(501001, '合成{count}次宝石', 2);
    // 有 VO：value=1 / max=2 ⇒ 50%
    const half = buildLeagueTaskRowView(row, cmd(501001, 1, 0));
    assert.equal(half.title, '合成2次宝石');
    assert.equal(half.state, 'undone');
    assert.equal(half.value, 1);
    assert.equal(half.maxValue, 2);
    assert.equal(half.percentText, '50%');
    // 向下取整（1/3 = 33.33 ⇒ 33%）
    const third = buildLeagueTaskRowView(unionRow(1, 'a{count}b', 3), cmd(1, 1, 0));
    assert.equal(third.percentText, '33%');
    // ⚠️ 进度截断：`Math.min(value, max)`（服务端可能给出超额进度）
    const over = buildLeagueTaskRowView(unionRow(1, 'a{count}b', 2), cmd(1, 9, 1));
    assert.equal(over.percentText, '100%');
    assert.equal(over.value, 9, 'value 本身照搬（只有百分比截断）');
    assert.equal(over.state, 'canReward');
    // 没有 VO ⇒ 按「未完成 / 0 / 满进度」渲染（老端 else 分支）
    const none = buildLeagueTaskRowView(row, null);
    assert.equal(none.state, 'undone');
    assert.equal(none.value, 0);
    assert.equal(none.percentText, '0%');
    // `targetCount` 为 0 ⇒ 百分比是空串（老端不设 `pro_title`）
    const zero = buildLeagueTaskRowView(unionRow(1, 'x', 0), cmd(1, 3, 0));
    assert.equal(zero.percentText, '');
    // 奖励最多两格，缺位是 `null`（老端 `rewards[0]` / `rewards[1]`）
    const one = buildLeagueTaskRowView(unionRow(1, 'x', 1, [13]), null);
    assert.deepEqual(one.rewards[0], { resId: 13, number: 10 });
    assert.equal(one.rewards[1], null);
});

test('C6 ⚠️ buildLeagueTaskRowViews：可领取排最前、已领取排最后、其余保持表内原序', () => {
    const rows = [unionRow(1, 'a{count}', 1), unionRow(2, 'b{count}', 1),
        unionRow(3, 'c{count}', 1), unionRow(4, 'd{count}', 1)];
    const cmds = [
        cmd(1, 0, 0), // undone
        cmd(2, 0, 1), // canReward
        cmd(3, 0, 2), // rewarded
        cmd(4, 0, 1), // canReward
    ];
    assert.deepEqual(buildLeagueTaskRowViews(rows, cmds).map((v) => v.resId), [2, 4, 1, 3]);
    // ⚠️ 两个「可领取」之间保持**表内原序**（老端比较器对它们返 0，靠 V8 稳定排序）
    //    反序表 [4,3,2,1] ⇒ 排完是 [4,2 | 1 | 3]（4/2 可领按原序、1 未完成、3 已领在最后）
    assert.deepEqual(buildLeagueTaskRowViews(rows.slice().reverse(), cmds).map((v) => v.resId), [4, 2, 1, 3]);
    // 表里没有 VO 的行也在（按 undone 排中间）
    assert.deepEqual(buildLeagueTaskRowViews(rows, []).map((v) => v.resId), [1, 2, 3, 4]);
    assert.deepEqual(buildLeagueTaskRowViews(rows, null).map((v) => v.resId), [1, 2, 3, 4]);
});

test('C7 ⚠️ leagueTaskProgress：分母是「有 VO 的任务数」，不是表行数', () => {
    const rows = [unionRow(1, 'a{count}', 1), unionRow(2, 'b{count}', 1), unionRow(3, 'c{count}', 1)];
    // 只有 2 行有 VO ⇒ total = 2（不是 3）；其中 1 行已领奖 ⇒ done = 1
    const { done, total } = leagueTaskProgress(rows, [cmd(1, 0, 2), cmd(2, 0, 0)]);
    assert.equal(total, 2);
    assert.equal(done, 1);
    // 表外的 `CmdTask`（别的模块的任务）**不**计入
    const withOther = leagueTaskProgress(rows, [cmd(1, 0, 2), cmd(999999, 0, 2)]);
    assert.deepEqual(withOther, { done: 1, total: 1 });
    assert.deepEqual(leagueTaskProgress(rows, []), { done: 0, total: 0 });
});

test('C8 leagueTaskBoxState：四档表（先判里程碑、再判已领个数）', () => {
    // done < milestone ⇒ 不可领取（哪怕今天已经领过同 id）
    assert.equal(leagueTaskBoxState(1, 2, 3, 0), 'locked');
    assert.equal(leagueTaskBoxState(1, 0, 3, 9), 'locked');
    // done >= milestone 且 todayTaskGetProgressCount >= id ⇒ 已领取
    assert.equal(leagueTaskBoxState(1, 3, 3, 1), 'rewarded');
    assert.equal(leagueTaskBoxState(2, 5, 5, 2), 'rewarded');
    assert.equal(leagueTaskBoxState(1, 8, 3, 3), 'rewarded');
    // done >= milestone 但还没领到这个 id ⇒ 可领取（id 是升序推进的水位线）
    assert.equal(leagueTaskBoxState(2, 5, 5, 1), 'canReward');
    assert.equal(leagueTaskBoxState(1, 8, 3, 0), 'canReward');
    // 脏输入不炸：NaN / 负数按 0 算
    assert.equal(leagueTaskBoxState(1, Number.NaN, 3, 0), 'locked');
    assert.equal(leagueTaskBoxState(1, 3, 3, Number.NaN), 'canReward');
});

test('C9 buildLeagueTaskBoxViews：保 id 升序、带 milestone 与三态', () => {
    const progress: ILeagueTaskProgressRow[] = parseTaskUnionProgressRows(JSON.parse(readFileSync(TASK_PROGRESS_JSON, 'utf8')));
    assert.deepEqual(progress.map((p) => p.id), [1, 2, 3]);
    const boxes = buildLeagueTaskBoxViews(progress, 5, 1);
    assert.deepEqual(boxes.map((b) => b.id), [1, 2, 3]);
    assert.deepEqual(boxes.map((b) => b.milestone), [3, 5, 8]);
    // done=5 ⇒ 1/2 的里程碑都过了；todayTaskGetProgressCount=1 ⇒ 1 已领、2 可领、3 不可领
    assert.deepEqual(boxes.map((b) => b.state), ['rewarded', 'canReward', 'locked']);
    assert.deepEqual(boxes[0].rewards, [{ resId: 11, number: 100 }]);
});

test('C10 ⚠️ hasLeagueTaskRedDot = 「有任务可领」∪「有宝箱可领」（两条都灭才灭）', () => {
    const rows = [unionRow(1, 'a{count}', 1), unionRow(2, 'b{count}', 1), unionRow(3, 'c{count}', 1)];
    const progress = parseTaskUnionProgressRows(JSON.parse(readFileSync(TASK_PROGRESS_JSON, 'utf8')));
    const allRewarded = [cmd(1, 0, 2), cmd(2, 0, 2), cmd(3, 0, 2)]; // done = 3，刚好够到第一个里程碑
    // ① 有任务可领
    assert.equal(hasLeagueTaskRedDot(rows, [cmd(1, 0, 1)], progress, 0), true);
    // ② 有宝箱可领（done=3 够到里程碑 1、todayTaskGetProgressCount=0 还没领）
    assert.equal(hasLeagueTaskRedDot(rows, allRewarded, progress, 0), true);
    // 两条都灭：任务是 undone/rewarded，宝箱 done 不够（只领了 1 个）
    assert.equal(hasLeagueTaskRedDot(rows, [cmd(1, 0, 2), cmd(2, 0, 0)], progress, 0), false);
    // 宝箱都领完了（todayTaskGetProgressCount 追平三个 id）⇒ 灭
    assert.equal(hasLeagueTaskRedDot(rows, allRewarded, progress, 3), false);
    // 没有任何 VO ⇒ 灭
    assert.equal(hasLeagueTaskRedDot(rows, [], progress, 0), false);
    assert.equal(hasLeagueTaskRedDot(rows, null, progress, 0), false);
});

test('C11 真表探针：`taskUnion` 33 行里 `subType==1` 恰好 8 行（501001~501008）', () => {
    const rows = parseTaskUnionRows(JSON.parse(readFileSync(TASK_UNION_JSON, 'utf8')));
    assert.equal(rows.length, 8, '`subType==1` 的行数变了？先回头看 `EnumUnionTaskType`');
    assert.deepEqual(rows.map((r) => r.resId), [501001, 501002, 501003, 501004, 501005, 501006, 501007, 501008]);
    for (const row of rows) {
        assert.ok(row.targetCount > 0, `任务 ${row.resId} 的 param.count 应为正数`);
        assert.ok(row.name.includes('{count}'), `任务 ${row.resId} 的标题模板应含 {count} 占位`);
        assert.ok(row.goto > 0, `任务 ${row.resId} 的 goto 应为正数（不然「前往」按钮点了没落）`);
        assert.ok(row.reward.length >= 1, `任务 ${row.resId} 至少一个奖励`);
        // 现网奖励只有两个 resId：11 = `unionCoin`（联盟银币）/ 13 = `unionContri`（联盟贡献）
        for (const reward of row.reward) {
            assert.ok(reward.resId === 11 || reward.resId === 13,
                `任务 ${row.resId} 的奖励 resId=${reward.resId} 超出已知的 11/13`);
        }
    }
    // 标题占位替换后不该再残留 `{count}`
    const views = buildLeagueTaskRowViews(rows, null);
    for (const view of views) assert.ok(!view.title.includes('{count}'), `标题没替换干净：${view.title}`);
});

test('C12 真表探针：`taskUnionProgress` 三档里程碑 3/5/8，rewards 只取 `[0]`', () => {
    const progress = parseTaskUnionProgressRows(JSON.parse(readFileSync(TASK_PROGRESS_JSON, 'utf8')));
    assert.equal(progress.length, 3, '面板上只建了 3 个宝箱节点，表多行会被 `LeagueTaskPage.renderBoxes` 丢掉');
    assert.deepEqual(progress.map((p) => [p.id, p.count]), [[1, 3], [2, 5], [3, 8]]);
    for (const box of progress) assert.ok(box.rewards.length >= 1, `宝箱 ${box.id} 没有奖励`);
    // 浮框只显示 `rewards[0]`（老端 `reward.com_goods` 单格）
    const boxes = buildLeagueTaskBoxViews(progress, 0, 0);
    for (const box of boxes) assert.equal(box.rewards[0].resId, 11);
});

// ============================================================
// D. prefab 结构 + 几何
// ============================================================

interface Entry { __type__?: string; [key: string]: unknown }

/** `.ts.meta` 的 uuid → 压缩 cid（= 脚本组件的 `__type__`）。**禁手抄 cid**。 */
function compressUuid(uuid: string): string {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const hex = uuid.replace(/-/g, '');
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        out += KEYS[v >> 6] + KEYS[v & 63];
    }
    return out;
}
const cidOf = (tsPath: string): string =>
    compressUuid((JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string }).uuid);
const uuidOfPrefab = (p: string): string =>
    (JSON.parse(readFileSync(`${p}.meta`, 'utf8')) as { uuid: string }).uuid;

const near = (a: number, b: number, eps = 0.05): boolean => Math.abs(a - b) <= eps;

/** 本 prefab 用到的图 → `spriteFrame` uuid（`<顶层uuid>@f9941`）。 */
const U: Readonly<Record<string, string>> = {
    panel_window_01_9gong: 'a295d231-ef9a-4bea-9818-0e0d85794ef0@f9941',
    title_01: 'de242388-9444-451f-adff-78fe5a73e20d@f9941',
    title_02: 'a957fd35-0792-4a27-9de3-85a44274a5d0@f9941',
    btn_close: 'ca6d0ca8-3ed8-4009-963d-d845eb296872@f9941',
    frame_Zhikuang01: 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941',
    BB_img03: 'e7dd22cc-dc8b-4cb8-92b1-b1c6ac085db3@f9941',
    bar_bg_01: '443fa078-9ba5-42c8-a2bc-77e75125a70f@f9941',
    bar_bg_01_hong: '3da2c83a-3976-4d13-95a0-3cef532cb52e@f9941',
    frame_yuan_pic02: 'f45d37ee-5a7b-4084-be34-b8e56dec5540@f9941',
    img_video: 'f0d043bc-41c1-458a-b790-dc36ae3108b0@f9941',
    TY_btn06: '3bb46826-19e5-4722-be43-d4fd1d78c4e9@f9941',
    TY_btn07: '0f92b28c-0dc5-49fe-b839-8fe1bdd20a37@f9941',
    公用_图标_已领取: 'd4543a98-1c4e-44ac-9993-0bf5cafc72ff@f9941',
    white_jiao8: 'b456d791-97f9-40ae-ada5-05ca902ef521@f9941',
    common_img_pzk_01: '0f3d4145-0e38-4010-9a5a-b72eb2ad483b@f9941',
    zb0: 'b006d2da-af30-4893-987a-c6c7ef1b677f@f9941',
    tag_gou: '6b50c034-9d1a-4ce4-8ed9-a01b10a4a74a@f9941',
};

interface Box {
    path: string;
    node: Entry;
    x: number;
    y: number;
    w: number;
    h: number;
    ax: number;
    ay: number;
    sx: number;
    sy: number;
    /** 有效 layer（嵌套实例的真值可能在 `propertyOverrides` 里）。 */
    layer: number;
    info: Entry | null;
    overrides: ReadonlyMap<string, unknown>;
}

interface NestInstance {
    shell: Box;
    uuid: string;
    overrides: ReadonlyMap<string, unknown>;
}

interface PrefabDoc {
    all: Entry[];
    nodes: Entry[];
    /** 全部节点的视觉框（含嵌套实例壳，按路径序）。 */
    boxes: Box[];
    rootName: string;
    P: (p: string) => Box | undefined;
    comp: (p: string, type: string) => Entry | null;
    refPath: (ref: unknown) => string | null;
    customCids: string[];
    instances: NestInstance[];
}

/**
 * 读一张 prefab 的盘上 JSON，反解「节点路径 → 本地几何 + 组件」。
 *
 * ⚠️ **嵌套 prefab 实例的字段在 `propertyOverrides` 里，不在壳节点上**：
 *    盘上壳节点的 `_lpos` / `_lscale` / `_name` / `_active` 全是 `undefined`，
 *    真值挂在 `cc.PrefabInfo.instance.propertyOverrides[]` 的
 *    `CCPropertyOverrideInfo{ propertyPath:['_lpos'], value }`。不叠回去会把
 *    `Box1` 读成 `pos(0,0)`。
 */
function openPrefab(path: string): PrefabDoc {
    const all = JSON.parse(readFileSync(path, 'utf8')) as Entry[];
    const at = (ref: unknown): Entry | null =>
        ref && typeof ref === 'object' && '__id__' in (ref as Entry)
            ? all[(ref as { __id__: number }).__id__]! : null;
    const nodes = all.filter((e) => e && e.__type__ === 'cc.Node');
    const root = nodes[0]!;
    const rootName = String(root._name);
    const byPath = new Map<string, Box>();
    const idxPath = new Map<number, string>();
    const instances: NestInstance[] = [];

    const nameOf = (node: Entry): string => {
        const info = at(node._prefab);
        const inst = at(info?.instance);
        for (const ref of ((inst?.propertyOverrides ?? []) as unknown[])) {
            const ov = at(ref);
            if ((ov?.propertyPath as unknown[] | undefined)?.[0] === '_name') return String(ov!.value);
        }
        return String(node._name ?? '');
    };

    const walk = (node: Entry, p: string, pCx: number, pCy: number, pSx: number, pSy: number): void => {
        const info = at(node._prefab);
        const inst = at(info?.instance);
        const overrides = new Map<string, unknown>();
        for (const ref of ((inst?.propertyOverrides ?? []) as unknown[])) {
            const ov = at(ref);
            const key = (ov?.propertyPath as unknown[] | undefined)?.[0];
            if (typeof key === 'string') overrides.set(key, ov!.value);
        }
        const isInstance = overrides.size > 0 && !!(info?.asset as { __uuid__?: string } | undefined)?.__uuid__;
        const pos = (overrides.get('_lpos') ?? node._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
        const sc = (overrides.get('_lscale') ?? node._lscale ?? { x: 1, y: 1 }) as { x: number; y: number };
        const name = String(overrides.get('_name') ?? node._name ?? '');
        const comps = ((node._components ?? []) as unknown[]).map(at);
        const uit = comps.find((c) => c?.__type__ === 'cc.UITransform');
        const size = (uit?._contentSize ?? { width: 0, height: 0 }) as { width: number; height: number };
        const anchor = (uit?._anchorPoint ?? { x: 0.5, y: 0.5 }) as { x: number; y: number };
        const cx = pCx + pos.x * pSx;
        const cy = pCy - pos.y * pSy;
        const sx = pSx * (sc.x ?? 1);
        const sy = pSy * (sc.y ?? 1);
        const box: Box = {
            path: p, node, x: pos.x ?? 0, y: pos.y ?? 0,
            w: size.width ?? 0, h: size.height ?? 0,
            ax: anchor.x ?? 0.5, ay: anchor.y ?? 0.5,
            sx: sc.x ?? 1, sy: sc.y ?? 1,
            layer: Number(overrides.get('_layer') ?? node._layer),
            info: isInstance ? info : null, overrides,
        };
        byPath.set(p, box);
        idxPath.set(all.indexOf(node), p);
        if (isInstance) {
            instances.push({ shell: box, uuid: String((info!.asset as { __uuid__?: string }).__uuid__ ?? ''), overrides });
        }
        for (const child of ((node._children ?? []) as unknown[])) {
            const c = at(child);
            if (c) walk(c, `${p}/${nameOf(c)}`, cx, cy, sx, sy);
        }
    };
    walk(root, rootName, 360, 640, 1, 1);

    const P = (p: string): Box | undefined => byPath.get(p === '' ? rootName : `${rootName}/${p}`);
    const comp = (p: string, type: string): Entry | null =>
        (((P(p)?.node._components ?? []) as unknown[]).map(at)
            .find((c) => c?.__type__ === type) ?? null);
    const refPath = (ref: unknown): string | null => {
        if (!ref || typeof ref !== 'object' || !('__id__' in (ref as Entry))) return null;
        const t = at(ref);
        if (!t) return null;
        if (t.__type__ === 'cc.Node') return idxPath.get((ref as { __id__: number }).__id__) ?? null;
        const owner = at(t.node);
        return owner ? idxPath.get((t.node as { __id__: number }).__id__) ?? null : null;
    };
    const customCids = [...new Set(all.map((e) => e?.__type__)
        .filter((t) => t && !/^(cc\.|sp\.|CC)/.test(String(t))))] as string[];
    return { all, nodes, boxes: [...byPath.values()], rootName, P, comp, refPath, customCids, instances };
}

/**
 * 懒加载 prefab 文档。
 *
 * ⚠️ `openPrefab` 内部是 `readFileSync` —— 放在模块顶层会让**整个文件**在跑到 `D` 段之前
 *    就 ENOENT 崩掉（A/B/C/E 四段的信号全丢）。prefab 还没生成时也要能跑完那四段。
 */
function lazyDoc(path: string): PrefabDoc {
    let doc: PrefabDoc | null = null;
    const load = (): PrefabDoc => (doc ??= openPrefab(path));
    return new Proxy({} as PrefabDoc, {
        get: (_target, prop) => (load() as unknown as Record<string, unknown>)[prop as string],
    });
}

const task = lazyDoc(TASK_PREFAB);
const box = lazyDoc(BOX_PREFAB);

type SpriteRow = readonly [string, string | null];

function assertSprites(doc: PrefabDoc, rows: readonly SpriteRow[], tag: string): void {
    for (const [p, art] of rows) {
        const sp = doc.comp(p, 'cc.Sprite');
        assert.ok(sp, `${tag}：${p} 上没有 cc.Sprite`);
        const uuid = (sp!._spriteFrame as { __uuid__?: string } | null)?.__uuid__ ?? null;
        if (art === null) {
            assert.equal(uuid, null, `${tag}：${p} 是运行时图槽，prefab 里必须留空`);
            assert.equal(sp!._type, 0, `${tag}：${p} 空图槽 type 应为 SIMPLE`);
        } else {
            assert.equal(uuid, U[art], `${tag}：${p} 的图应为「${art}」（${U[art]}）`);
            assert.equal(sp!._type, leagueSpriteType(art),
                `${tag}：${p} 的九宫格 type 必须跟随 LEAGUE_ART_SLICED（${art}）`);
        }
    }
}

interface BoxRow {
    p: string; x: number; y: number;
    w?: number; h?: number;
    sx?: number; sy?: number;
    ax?: number; ay?: number;
}

function assertBoxes(doc: PrefabDoc, rows: readonly BoxRow[], tag: string): void {
    for (const r of rows) {
        const b = doc.P(r.p);
        assert.ok(b, `${tag}：缺节点 ${r.p}`);
        assert.ok(near(b!.x, r.x) && near(b!.y, r.y),
            `${tag}/${r.p} 位置应为 (${r.x}, ${r.y})，实得 (${b!.x}, ${b!.y})`);
        if (r.w !== undefined) assert.ok(near(b!.w, r.w), `${tag}/${r.p} 宽应为 ${r.w}，实得 ${b!.w}`);
        if (r.h !== undefined) assert.ok(near(b!.h, r.h), `${tag}/${r.p} 高应为 ${r.h}，实得 ${b!.h}`);
        if (r.sx !== undefined) {
            assert.ok(near(b!.sx, r.sx) && near(b!.sy, r.sy ?? r.sx),
                `${tag}/${r.p} scale 应为 ${r.sx}，实得 (${b!.sx}, ${b!.sy})`);
        }
        if (r.ax !== undefined) {
            assert.ok(near(b!.ax, r.ax) && near(b!.ay, r.ay ?? 0.5),
                `${tag}/${r.p} anchor 应为 (${r.ax}, ${r.ay ?? 0.5})，实得 (${b!.ax}, ${b!.ay})`);
        }
    }
}

interface LabelRow {
    p: string; text: string; size: number;
    color: readonly [number, number, number];
    align: number;
    vAlign: number;
    outline?: number;
}

function assertLabels(doc: PrefabDoc, rows: readonly LabelRow[], tag: string): void {
    for (const r of rows) {
        const lb = doc.comp(r.p, 'cc.Label');
        assert.ok(lb, `${tag}：${r.p} 上没有 cc.Label`);
        assert.equal(lb!._string, r.text, `${tag}/${r.p} 文案应为「${r.text}」`);
        assert.equal(lb!._fontSize, r.size, `${tag}/${r.p} 字号应为 ${r.size}`);
        assert.equal(lb!._horizontalAlign, r.align, `${tag}/${r.p} 水平对齐应为 ${r.align}`);
        assert.equal(lb!._verticalAlign, r.vAlign, `${tag}/${r.p} 垂直对齐应为 ${r.vAlign}`);
        const c = lb!._color as { r: number; g: number; b: number };
        assert.deepEqual([c.r, c.g, c.b], [...r.color],
            `${tag}/${r.p} 颜色应为 #${r.color.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
        const outline = lb!._enableOutline ? (lb!._outlineWidth ?? 0) : 0;
        assert.equal(outline, r.outline ?? 0, `${tag}/${r.p} 描边宽度应为 ${r.outline ?? 0}（0 = 不描边）`);
    }
}

function assertBinds(
    doc: PrefabDoc, tsPath: string, nodePath: string,
    binds: readonly (readonly [string, string])[], tag: string,
): void {
    const c = doc.comp(nodePath, cidOf(tsPath));
    assert.ok(c, `${tag}：${nodePath} 上没有 ${tsPath}`);
    for (const [prop, want] of binds) {
        assert.equal(doc.refPath(c![prop]), `${doc.rootName}/${want}`,
            `${tag}：${tsPath.split('/').pop()}.${prop} 应绑到 ${want}`);
    }
}

const ROW = 'TaskListView/content/TaskRow';

test('D1 两张 prefab + 四个脚本（都带 `.meta`）在磁盘上', () => {
    for (const p of [TASK_PREFAB, BOX_PREFAB]) {
        assert.ok(existsSync(p), `缺 prefab：${p}`);
        assert.ok(existsSync(`${p}.meta`), `缺 meta：${p}.meta`);
    }
    for (const ts of [PAGE_TS, ROW_TS, BOX_TS, SLOT_TS]) {
        assert.ok(existsSync(ts), `缺脚本：${ts}`);
        assert.ok(existsSync(`${ts}.meta`), `缺 .ts.meta：${ts}.meta（编辑器不会给未 refresh 的新 .ts 生成）`);
    }
    assert.ok(existsSync(RED_DOT_PREFAB), '共用红点 prefab 缺失');
});

test('D2 节点树规模 + 根上只挂本页脚本；脚本 cid 集合恰好等于预期（反查 `.ts.meta`，禁手抄）', () => {
    // 45 = 44 + 根：根 1 + 顶层 11（PopupBg/TitleBg/TitleDeco/Title/CloseBtn/HeadBg/
    //   TaskProgress/Circle/TaskListView/AdLabel/CountLabel）+ 进度条内 3 + 列表内 2
    //   （content/TaskRow）+ 行内 20 + 三个宝箱实例 3 + 浮框 5
    //   （Reward/Goods/Goods-Icon/Goods-Count/ClickClose）
    assert.equal(task.nodes.length, 45, `LeagueTask.prefab 节点数变了 —— 对一下规格表（45 = 44 + 根）`);
    assert.equal(task.rootName, 'LeagueTask');
    const want = [PAGE_TS, ROW_TS, SLOT_TS, VSCROLL_TS].map(cidOf).sort();
    assert.deepEqual([...task.customCids].sort(), want,
        `LeagueTask.prefab 里的自定义组件应恰好是这 4 个，实得 ${task.customCids.join(', ')}`);

    assert.equal(box.rootName, 'LeagueTaskBox');
    // 5 = 4 + 根：Box / Value / Check / RedDot
    assert.equal(box.nodes.length, 5, `LeagueTaskBox.prefab = 根 + Box / Value / Check / RedDot（实得 ${box.nodes.length}）`);
    assert.deepEqual([...box.customCids].sort(), [cidOf(BOX_TS)].sort());
});

test('D3 全 UI_2D（`create` 会把根 layer 重置成 DEFAULT，不报错但整棵不渲染）', () => {
    for (const [doc, tag] of [[task, 'LeagueTask'], [box, 'LeagueTaskBox']] as const) {
        // ⚠️ 嵌套实例的壳节点盘上**没有 `_layer`**（层级随源 prefab，`node_transform` 写它会被
        //    静默丢掉、不进 `propertyOverrides`）⇒ 只查真正序列化在本文件里的节点。
        //    同一口径见 `league-store-donate-discount.test.ts` 的 D3。
        const shells = new Set(doc.instances.map((i) => i.shell.node));
        assert.ok(shells.size > 0, `${tag} 应当有嵌套实例（壳节点要排除在 layer 检查外）`);
        const bad = [...new Set(doc.nodes
            .filter((n) => !shells.has(n))
            .map((n) => n._layer))]
            .filter((l) => l !== UI_2D);
        assert.deepEqual(bad, [], `${tag} 有非 UI_2D 的层：${bad.join(',')}`);
    }
});

test('D4 顶层渲染序（= FGUI `displayList` 序，`Reward` 浮框在最上层）', () => {
    const want = [
        'PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn',
        'HeadBg', 'TaskProgress', 'Circle', 'TaskListView',
        'AdLabel', 'CountLabel', 'Box1', 'Box2', 'Box3', 'Reward',
    ];
    const rootBox = task.P('')!;
    const got = ((rootBox.node._children ?? []) as unknown[])
        .map((ref) => task.refPath(ref)!.slice(task.rootName.length + 1));
    assert.deepEqual(got, want);
    assert.deepEqual(
        ((box.P('')!.node._children ?? []) as unknown[])
            .map((ref) => box.refPath(ref)!.slice(box.rootName.length + 1)),
        ['Box', 'Value', 'Check', 'RedDot'],
    );
});

test('D5 图 uuid + 九宫格 type：面板 / 行 / 浮框', () => {
    assertSprites(task, [
        ['PopupBg', 'panel_window_01_9gong'],
        ['TitleBg', 'title_01'],
        ['TitleDeco', 'title_02'],
        ['CloseBtn', 'btn_close'],
        ['HeadBg', 'frame_Zhikuang01'],
        ['Circle', 'frame_yuan_pic02'],
        ['TaskProgress/ProgressBg', 'bar_bg_01'],
        ['TaskProgress/ProgressFill', 'bar_bg_01_hong'],
        ['Reward', 'white_jiao8'],
        ['Reward/Goods', 'common_img_pzk_01'],
        ['Reward/Goods/Icon', null],
        [`${ROW}/TitleBar`, 'BB_img03'],
        [`${ROW}/Reward`, 'common_img_pzk_01'],
        [`${ROW}/Reward/Icon`, null],
        [`${ROW}/Reward1`, 'common_img_pzk_01'],
        [`${ROW}/Reward1/Icon`, null],
        [`${ROW}/Progress/ProgressBg`, 'bar_bg_01'],
        [`${ROW}/Progress/ProgressFill`, 'bar_bg_01_hong'],
        [`${ROW}/BtnGet`, 'TY_btn06'],
        [`${ROW}/BtnGo`, 'TY_btn07'],
        [`${ROW}/BtnAdv`, 'TY_btn07'],
        [`${ROW}/BtnAdv/Badge`, 'img_video'],
        [`${ROW}/DoneTag`, '公用_图标_已领取'],
    ], 'LeagueTask');
    assertSprites(box, [
        ['Box', 'zb0'],
        ['Check', 'tag_gou'],
    ], 'LeagueTaskBox');
});

test('D6 几何：弹窗骨架 / 顶部横幅 / 进度条 / 圆环 / 列表 / 两行文案 / 三个宝箱 / 浮框', () => {
    assertBoxes(task, [
        // popBg (40,187) 640×895 ⇒ 中心 (360,634.5) → (0, +5.5)
        { p: 'PopupBg', x: 0, y: 5.5, w: 640, h: 895 },
        // 标题骨架：右缘内缩 2、标题条上边距 12.5（与 P4 三面板同一解算）
        { p: 'TitleBg', x: 0, y: 440.5, w: 601, h: 66 },
        { p: 'TitleDeco', x: 0, y: 440.5, w: 253, h: 44 },
        { p: 'Title', x: 0, y: 443, w: 240, h: 42 },
        { p: 'CloseBtn', x: 288, y: 443, w: 54, h: 51 },
        // n29 (85,249) 550×160 ⇒ 中心 (360,329) → (0, 311)
        { p: 'HeadBg', x: 0, y: 311, w: 550, h: 160 },
        // comp_progress (134,303) 452×38 ⇒ 中心 (360,322) → (0, 318)
        { p: 'TaskProgress', x: 0, y: 318, w: 452, h: 38 },
        { p: 'TaskProgress/ProgressBg', x: 0, y: 0, w: 452, h: 38 },
        // 填充：满宽 637/652×452 ≈ 441；左内缩 8/652×452 ≈ 5.5，锚点 (0,0.5) ⇒ x = −226+5.5
        { p: 'TaskProgress/ProgressFill', x: -220.5, y: 0, w: 441, h: 21, ax: 0, ay: 0.5 },
        { p: 'TaskProgress/ProgressLabel', x: -0.5, y: 0.5, w: 367, h: 29 },
        // n31 (106,288) 43×46 scale 1.4（无 pivot ⇒ 绕左上角）⇒ 视觉中心 (136.1,320.2)
        { p: 'Circle', x: -223.9, y: 319.8, w: 43, h: 46, sx: 1.4 },
        // list (85,415) 550×537，锚点 (0.5,1) ⇒ 顶边中点 (360,415) → (0, 225)
        { p: 'TaskListView', x: 0, y: 225, w: 550, h: 537, ax: 0.5, ay: 1 },
        { p: 'TaskListView/content', x: 0, y: 0, w: 550, h: 537, ax: 0.5, ay: 1 },
        // lineGap 10：首行中心 = 列表顶 − 160/2
        { p: ROW, x: 0, y: -80, w: 550, h: 160 },
        // lab_jump (157,969) 405×34 ⇒ 中心 (359.5,986) → (−0.5, −346)
        { p: 'AdLabel', x: -0.5, y: -346, w: 405, h: 34 },
        // lab_count (126,299) 21×39 ⇒ 中心 (136.5,318.5) → (−223.5, 321.5)
        // ⚠️ 宽高**不查**：FGUI 没有 `autoSize` ⇒ 落成 `overflow NONE(0)`，引擎会按文本
        //    （单行 "5"、28px）把 contentSize 重写成文本尺寸（实测 19.57×33）
        //    ⇒ 21×39 只是设计稿占位值，盘上早就不是它了。位置（中心）才是真值。
        { p: 'CountLabel', x: -223.5, y: 321.5 },
        // box_3 / box_5 / box_8：(245/358/517,277) 90×100 ⇒ 中心 y=327
        // ⚠️ 这三个是 `LeagueTaskBox.prefab` 的**嵌套实例壳**，壳上不序列化 UITransform
        //    ⇒ 尺寸为 0（真值在源 prefab 上，见 D8 的「根 90×100」）。位置来自
        //    `propertyOverrides._lpos`，照查。
        { p: 'Box1', x: -70, y: 313 },
        { p: 'Box2', x: 43, y: 313 },
        { p: 'Box3', x: 202, y: 313 },
        // reward (289,178) 110×110 ⇒ 中心 (344,233) → (−16, 407)
        { p: 'Reward', x: -16, y: 407, w: 110, h: 110 },
        // ⚠️ 浮框里的 com_goods：`(-5,-5) pivot=0.5,0.5`（无 anchor）⇒ xy 是盒左上角，
        //    未缩放盒 (−5,−5)-(115,115) 的中心正是浮框中心 ⇒ 相对偏移 (0, 0)
        { p: 'Reward/Goods', x: 0, y: 0, w: 120, h: 120, sx: 0.8 },
        { p: 'Reward/Goods/Icon', x: 0, y: 0, w: 120, h: 120, sx: 0.8 },
        // clickNode (-665,-1225) 1440×2560 ⇒ 盒中心 = 浮框中心
        { p: 'Reward/ClickClose', x: 0, y: 0, w: 1440, h: 2560 },
    ], 'LeagueTask');
});

test('D7 几何：行内 17 个节点逐条对 `组件_联盟_任务item.xml`', () => {
    assertBoxes(task, [
        // n28 (31,8) 488×32 ⇒ 中心 (275,24) → (0, +56)
        { p: `${ROW}/TitleBar`, x: 0, y: 56, w: 488, h: 32 },
        // title (131,7) 288×34 ⇒ 中心 (275,24) → (0, +56)
        { p: `${ROW}/Title`, x: 0, y: 56, w: 288, h: 34 },
        // com_goods (23,42) 120×120 scale 0.8（无 pivot ⇒ 绕左上角）⇒ 视觉中心 (71,90)
        { p: `${ROW}/Reward`, x: -204, y: -10, w: 120, h: 120, sx: 0.8 },
        // icon 与容器同尺寸、再叠一层 0.8（道具自带 `scale=0.8`）
        { p: `${ROW}/Reward/Icon`, x: 0, y: 0, w: 120, h: 120, sx: 0.8 },
        // text_number：relation right-left%,top-top ⇒ 右缘 99%×120=118.8、盒中心 y=83
        { p: `${ROW}/Reward/Count`, x: 58.8, y: -23, ax: 1, ay: 0.5 },
        // com_goods1 (122,42) ⇒ 视觉中心 (170,90)
        { p: `${ROW}/Reward1`, x: -105, y: -10, w: 120, h: 120, sx: 0.8 },
        { p: `${ROW}/Reward1/Count`, x: 58.8, y: -23, ax: 1, ay: 0.5 },
        // comp_progress (358,42) 160×38 ⇒ 中心 (438,61) → (+163, +19)
        { p: `${ROW}/Progress`, x: 163, y: 19, w: 160, h: 38 },
        { p: `${ROW}/Progress/ProgressBg`, x: 0, y: 0, w: 160, h: 38 },
        // 160 宽下满宽 = 637/652×160 ≈ 156；左内缩 8/652×160 ≈ 2 ⇒ x = −80+2
        { p: `${ROW}/Progress/ProgressFill`, x: -78, y: 0, w: 156, h: 21, ax: 0, ay: 0.5 },
        { p: `${ROW}/Progress/ProgressLabel`, x: 0, y: 0, w: 160, h: 29 },
        // btn_get / btn_go (383,80) 117×60 ⇒ 中心 (441.5,110) → (+166.5, −30)
        { p: `${ROW}/BtnGet`, x: 166.5, y: -30, w: 117, h: 60 },
        { p: `${ROW}/BtnGo`, x: 166.5, y: -30, w: 117, h: 60 },
        // title：relation width-width,center-center,top-middle ⇒ 盒 (0,−2)-(117,64)
        { p: `${ROW}/BtnGet/Label`, x: 0, y: -1, w: 117, h: 66 },
        { p: `${ROW}/BtnGo/Label`, x: 0, y: -1, w: 117, h: 66 },
        // com_rd (20,0) 30×30 ⇒ 中心 (35,15) → (−23.5, +15)
        // ⚠️ 也是嵌套实例壳（`ui/common/RedDot.prefab`）⇒ 不查尺寸，只查位置
        { p: `${ROW}/BtnGet/RedDot`, x: -23.5, y: 15 },
        // btn_adv (298,80) 80×60 ⇒ 中心 (338,110) → (+63, −30)
        { p: `${ROW}/BtnAdv`, x: 63, y: -30, w: 80, h: 60 },
        // n5 img_video (21,17) 39×28 ⇒ 盒中心 (40.5,31) → (+0.5, −1)
        { p: `${ROW}/BtnAdv/Badge`, x: 0.5, y: -1, w: 39, h: 28 },
        // n35 (391,47) 119×74 ⇒ 中心 (450.5,84) → (+175.5, −4)
        { p: `${ROW}/DoneTag`, x: 175.5, y: -4, w: 119, h: 74 },
    ], 'LeagueTask');
});

test('D8 几何：宝箱 90×100 + 内部四点（`anchor="true"` 的 `lab_value` 按 pivot 算）', () => {
    assertBoxes(box, [
        // 按钮_章节宝箱 (-6,-20) 100×100 ⇒ 盒中心 (44,30)
        { p: 'Box', x: -1, y: 20, w: 100, h: 100 },
        // lab_value (44,84) 90×42 **pivot 0.5 + anchor=true** ⇒ xy 就是中点
        { p: 'Value', x: -1, y: -34, w: 90, h: 42 },
        // n67 tag_gou (50,34) 70×70 scale 0.5（无 pivot ⇒ 绕左上角）⇒ 视觉中心 (67.5,51.5)
        { p: 'Check', x: 22.5, y: -1.5, w: 70, h: 70, sx: 0.5 },
        // com_rd (60,0) 30×30 ⇒ 盒中心 (75,15)
        // ⚠️ 嵌套实例壳（`ui/common/RedDot.prefab`）⇒ 不查尺寸，只查位置
        { p: 'RedDot', x: 30, y: 35 },
    ], 'LeagueTaskBox');
    // 根 90×100（面板实例写 `size="90,100"`；组件原生只有 90×78）
    const root = box.P('')!;
    assert.ok(near(root.w, 90) && near(root.h, 100), `根应为 90×100，实得 ${root.w}×${root.h}`);
    assert.ok(near(root.ax, 0.5) && near(root.ay, 0.5), '根锚点应为 (0.5,0.5)');
});

test('D9 Label 排版：文案 / 字号 / 颜色 / 对齐 / 描边', () => {
    assertLabels(task, [
        { p: 'Title', text: '联盟任务', size: 30, color: [255, 246, 196], align: 1, vAlign: 1, outline: 3 },
        // 顶部 `lab_title` 老端显式置空（百分比只在行内那条上）
        { p: 'TaskProgress/ProgressLabel', text: '', size: 20, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        // FGUI 静态串带**半角冒号**（运行时被 `LEAGUE_TASK_AD_TEXT_TEMPLATE` 覆盖）
        { p: 'AdLabel', text: '每日观看广告跳过剩余次数:1/1', size: 24, color: [255, 255, 255], align: 1, vAlign: 1, outline: 2 },
        { p: 'CountLabel', text: '5', size: 28, color: [255, 214, 115], align: 1, vAlign: 1, outline: 2 },
        // 行 title：FGUI 没写 color ⇒ 工程默认 #000000，且**无描边**
        { p: `${ROW}/Title`, text: '合成一次玉石(0/1)', size: 24, color: [0, 0, 0], align: 1, vAlign: 1 },
        { p: `${ROW}/Progress/ProgressLabel`, text: '', size: 20, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: `${ROW}/BtnGet/Label`, text: '领取', size: 24, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: `${ROW}/BtnGo/Label`, text: '前往', size: 24, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: `${ROW}/Reward/Count`, text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        { p: `${ROW}/Reward1/Count`, text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        { p: 'Reward/Goods/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
    ], 'LeagueTask');
    assertLabels(box, [
        { p: 'Value', text: '3', size: 28, color: [237, 229, 174], align: 1, vAlign: 1, outline: 2 },
    ], 'LeagueTaskBox');
});

test('D10 色调：顶部横幅染 `#657d54`、浮框底染 `#333333`、标题衬底 alpha 128', () => {
    const tintOf = (doc: PrefabDoc, p: string): readonly number[] => {
        const sp = doc.comp(p, 'cc.Sprite');
        assert.ok(sp, `${p} 上没有 cc.Sprite`);
        const c = sp!._color as { r: number; g: number; b: number; a: number };
        return [c.r, c.g, c.b, c.a];
    };
    assert.deepEqual(tintOf(task, 'HeadBg'), [...LEAGUE_ART_TASK_HEAD_TINT, 255]);
    assert.deepEqual(tintOf(task, 'Reward'), [...LEAGUE_ART_TASK_REWARD_BG_TINT, 255]);
    // 行底框**不染**（保持原色）
    assert.deepEqual(tintOf(task, `${ROW}`), [255, 255, 255, 255]);
    // n28 `alpha="0.5"` ⇒ 255×0.5 ≈ 128
    assert.deepEqual(tintOf(task, `${ROW}/TitleBar`), [255, 255, 255, LEAGUE_ART_TASK_ROW_TITLE_BAR_ALPHA]);
});

test('D11 虚拟列表装配 + 嵌套实例（3 个宝箱 / 1 颗红点）+ Button 按下态', () => {
    const listCid = cidOf(VSCROLL_TS);
    const listComp = task.comp('TaskListView', listCid);
    assert.ok(listComp, 'TaskListView 上没挂 VirtualScrollView');
    assert.equal(task.refPath(listComp!.content), `${task.rootName}/TaskListView/content`, 'content 没绑');
    assert.equal(task.refPath(listComp!.itemNode), `${task.rootName}/${ROW}`, 'itemNode 没绑');
    assert.equal(listComp!.useVirtualList, true);
    assert.equal(listComp!.itemCreationMode, 0, '0 = NODE');
    assert.equal(listComp!.direction, 0, '0 = 纵向');
    assert.equal(listComp!.gridCount, 1);
    assert.equal(listComp!.spacing, 10, 'FGUI `list` 的 lineGap="10"');

    // 三个宝箱 = `LeagueTaskBox.prefab` 的嵌套实例；`BtnGet` 下 1 颗 = 共用红点
    const boxUuid = uuidOfPrefab(BOX_PREFAB);
    const dotUuid = uuidOfPrefab(RED_DOT_PREFAB);
    const nested = task.instances.map((i) => [i.shell.path, i.uuid] as const);
    assert.deepEqual(
        nested.filter(([, u]) => u === boxUuid).map(([p]) => p.slice(task.rootName.length + 1)),
        ['Box1', 'Box2', 'Box3'],
    );
    assert.deepEqual(
        nested.filter(([, u]) => u === dotUuid).map(([p]) => p.slice(task.rootName.length + 1)),
        [`${ROW}/BtnGet/RedDot`],
        '⚠️ 只建 `btn_get` 这一颗（`btn_go` / `btn_adv` 的红点老端从没驱动过）',
    );
    assert.deepEqual(
        box.instances.map((i) => i.shell.path.slice(box.rootName.length + 1)),
        ['RedDot'],
    );

    // 按钮按下态：FGUI `downEffect="scale" 0.9`
    for (const p of ['CloseBtn', `${ROW}/BtnGet`, `${ROW}/BtnGo`, `${ROW}/BtnAdv`]) {
        const btn = task.comp(p, 'cc.Button');
        assert.ok(btn, `${p} 上没有 cc.Button`);
        assert.equal(btn!._transition, 3, `${p} 的过渡应为 SCALE(3)`);
        assert.ok(near(Number(btn!._zoomScale ?? 1), 0.9), `${p} 的缩放系数应为 0.9`);
    }
    // ⚠️ 宝箱的按下态是 **COLOR**（FGUI `downEffect="dark"`）——
    //    SCALE 过渡会和呼吸 tween 抢 `scale`
    const boxButton = box.comp('Box', 'cc.Button');
    assert.ok(boxButton, 'Box 上没有 cc.Button');
    assert.equal(boxButton!._transition, 1, 'Box 的过渡应为 COLOR(1)');
    assert.equal(box.refPath(boxButton!._target), `${box.rootName}/Box`);
});

test('D12 `@property` 逐条：主脚本 12 + 行脚本 11 + 三个奖励格各 2', () => {
    assertBinds(task, PAGE_TS, '', [
        ['closeButton', 'CloseBtn'],
        ['taskList', 'TaskListView'],
        ['progressFill', 'TaskProgress/ProgressFill'],
        ['progressLabel', 'TaskProgress/ProgressLabel'],
        ['countLabel', 'CountLabel'],
        ['adLabel', 'AdLabel'],
        ['box1', 'Box1'],
        ['box2', 'Box2'],
        ['box3', 'Box3'],
        ['rewardNode', 'Reward'],
        ['rewardSlot', 'Reward/Goods'],
        ['rewardClose', 'Reward/ClickClose'],
    ], 'LeagueTaskPage');

    assertBinds(task, ROW_TS, ROW, [
        ['titleLabel', `${ROW}/Title`],
        ['rewardSlot', `${ROW}/Reward`],
        ['rewardSlot1', `${ROW}/Reward1`],
        ['progressNode', `${ROW}/Progress`],
        ['progressFill', `${ROW}/Progress/ProgressFill`],
        ['progressLabel', `${ROW}/Progress/ProgressLabel`],
        ['getButton', `${ROW}/BtnGet`],
        ['getRedDot', `${ROW}/BtnGet/RedDot`],
        ['goButton', `${ROW}/BtnGo`],
        ['advButton', `${ROW}/BtnAdv`],
        ['doneTag', `${ROW}/DoneTag`],
    ], 'LeagueTaskRow');

    for (const [slot, icon, count] of [
        [`${ROW}/Reward`, `${ROW}/Reward/Icon`, `${ROW}/Reward/Count`],
        [`${ROW}/Reward1`, `${ROW}/Reward1/Icon`, `${ROW}/Reward1/Count`],
        ['Reward/Goods', 'Reward/Goods/Icon', 'Reward/Goods/Count'],
    ] as const) {
        assertBinds(task, SLOT_TS, slot, [['icon', icon], ['countLabel', count]], 'LeagueRewardSlot');
    }

    assertBinds(box, BOX_TS, '', [
        ['chest', 'Box'],
        ['valueLabel', 'Value'],
        ['checkMark', 'Check'],
        ['redDot', 'RedDot'],
    ], 'LeagueTaskBox');
});

// ============================================================
// E. 页面逻辑 / 调用约定（源码文本层）
// ============================================================

test('E1 LeagueTaskPage：是 PopupBase、prefabPath 大小写正确、标题取常量', () => {
    const code = readFileSync(PAGE_TS, 'utf8');
    assert.ok(code.includes('extends PopupBase'), '弹窗面板应继承 PopupBase');
    // 真机 zip 内路径大小写敏感（目录是 `League`，L 大写）
    assert.ok(code.includes("static prefabPath = 'ui/League/LeagueTask'"), 'prefabPath 写错了');
    assert.ok(code.includes('static get titleText()'), '应暴露静态标题给复用方');
    assert.ok(code.includes('LEAGUE_TASK_TITLE'), '标题应取常量而不是写死中文字面量');
});

test('E2 ⚠️ 列表不发请求：只读缓存（`CmdTask`）+ 两个领奖请求', () => {
    const code = readFileSync(PAGE_TS, 'utf8');
    assert.ok(code.includes('this.repository.loadTask()'), '面板应通过 repository.loadTask() 取数');
    assert.ok(!/Request[A-Za-z]*Task[Ll]ist/.test(code), '联盟任务**没有**独立的列表请求（= 通用任务缓存）');
    assert.ok(code.includes('this.repository.requestTaskReward('), '点「领取」应发领奖请求');
    // ⚠️ 领宝箱的请求体**只有 subType**，没有宝箱 id
    assert.ok(/requestTaskProgressReward\(LeagueUnionTaskType\.leagueTask/.test(code),
        '领宝箱要传 `LeagueUnionTaskType.leagueTask`（不是 `view.id`）');
    assert.ok(!/requestTaskProgressReward\([^)]*view\.id/.test(code), '别把宝箱 id 塞进请求体');
});

test('E3 ⚠️ `refreshList` 必须晚于 `nextPopupFrame()`（否则虚拟列表槽位还没建、列表空白）', () => {
    const code = readFileSync(PAGE_TS, 'utf8');
    const frame = code.indexOf('await this.nextPopupFrame();');
    const refresh = code.indexOf('this.taskList.refreshList(');
    assert.ok(frame > 0, '没找到 `await this.nextPopupFrame();`');
    assert.ok(refresh > frame, '`refreshList` 出现在 defer 一帧之前 ⇒ 列表会空');
    assert.ok(code.includes('this.taskList.scrollToTop(false)'), '铺完应回到顶部（换页 / 重开都会留着上次的滚动位置）');
    // 行渲染回调只绑一次（放 onOpen 会随每次打开重复叠加）
    assert.ok(/if \(!this\.rendererBound\)/.test(code), '`renderItemFn` 的绑定要幂等');
});

test('E4 防连点 + 写后三态收口（`ok` 重读、`offline` / 其它各给提示）', () => {
    const code = readFileSync(PAGE_TS, 'utf8');
    assert.ok(/private beginWrite\(\): boolean/.test(code), '缺 beginWrite');
    assert.ok(/if \(this\.busy\) return false;/.test(code), 'beginWrite 应先判 busy');
    assert.ok(code.includes("if (result === 'ok')"), 'afterWrite 应按 `ok` 重读一次');
    assert.ok(code.includes('LEAGUE_TIP_OFFLINE') && code.includes('LEAGUE_TIP_FAILED'),
        'offline / failed 各给一条提示，不许静默');
    // 三个写操作（领奖 / 看广告 / 领宝箱）都要过门，且都要 finally 复位
    const gates = code.match(/if \(!this\.beginWrite\(\)\) return;/g) ?? [];
    assert.equal(gates.length, 3, `三个写操作都要过防连点门，实得 ${gates.length} 处`);
    const resets = code.match(/this\.busy = false;/g) ?? [];
    assert.equal(resets.length, 3, `三处 finally 都要复位 busy，实得 ${resets.length} 处`);
});

test('E5 宝箱点击三支 + 浮框定位（`reward.y = box.y + 105`）+ 「前往」只提示不关面板', () => {
    const code = readFileSync(PAGE_TS, 'utf8');
    // 三支：可领取 ⇒ 发包；不可领取 ⇒ 弹浮框；已领取 ⇒ 什么都不做
    assert.ok(/view\.state === 'canReward'/.test(code), '缺「可领取」分支');
    assert.ok(/view\.state === 'locked'/.test(code), '缺「不可领取」分支（要弹浮框）');
    assert.ok(/requestTaskProgressReward\(LeagueUnionTaskType\.leagueTask, this\)/.test(code));
    const boxClick = code.slice(code.indexOf('private async onBoxClick('), code.indexOf('private showReward('));
    assert.ok(boxClick.includes('this.showReward(view)'), '「不可领取」点下去要弹浮框');
    assert.ok(!/state === 'rewarded'[\s\S]{0,200}request/.test(boxClick), '「已领取」不该发任何包');

    // 浮框：老端 `rewardCom.y = box.y - rewardCom.height` ⇒ 本端 `box.y + 宝箱半高 + 浮框半高`
    assert.ok(/const TASK_BOX_REWARD_GAP = 105;/.test(code), '浮框间距应为 100/2 + 110/2');
    assert.ok(/setPosition\(new Vec3\(p\.x, p\.y \+ TASK_BOX_REWARD_GAP, p\.z\)\)/.test(code),
        '浮框要贴在「被点的那个宝箱」正上方（x 不变、y 加间距）');
    assert.ok(/rewardNode\.active = true/.test(code) && code.includes('hideReward()'), '浮框显隐要成套');

    // 「前往」：已接联盟任务专用跳转路由（已知目标直接开、其余兜底、**不关面板**）
    assert.ok(code.includes('gotoLeagueTask'), '「前往」要走联盟任务跳转路由');
    const jump = code.slice(code.indexOf('private jump('), code.indexOf('private async onBoxClick('));
    assert.ok(!jump.includes('this.close('), '「前往」不该顺手关掉面板');

    // 顶部进度条：`lab_title` 恒置空（老端 `setText("")`），填充按 value/max 改宽度
    assert.ok(/this\.progressLabel\.string = ''/.test(code), '顶部百分比文案应恒为空');
    assert.ok(/const TASK_PROGRESS_FULL_WIDTH = 441;/.test(code), '顶部满宽应为 441（637/652×452）');
    assert.ok(code.includes('progressValue') && code.includes('progressMax'), '进度应取快照的 value/max');
    // 广告行整块隐藏
    assert.ok(/this\.adLabel\.node\.active = available/.test(code), '广告没接入时整行隐藏（别显示假的 0/0）');
});

test('E6 LeagueRepository：`loadTask` 只读缓存、`progressValue = min(done, total)`、`showAd` 来自 `todayTaskAdvTimes`', () => {
    const repo = readFileSync(REPO_TS, 'utf8');
    // 取数：任务 / 宝箱两张表 + `CmdTask` 缓存 + `CmdRoleUnion`
    const at = repo.indexOf('async loadTask(');
    assert.ok(at > 0, '缺 loadTask 实现');
    const body = repo.slice(at, repo.indexOf('\n    }', at));
    for (const need of ['LEAGUE_TASK_UNION_TABLE', 'LEAGUE_TASK_PROGRESS_TABLE', 'this.readTaskCmds()',
        'buildLeagueTaskRowViews(', 'leagueTaskProgress(', 'buildLeagueTaskBoxViews(']) {
        assert.ok(body.includes(need), `loadTask 里应出现 ${need}`);
    }
    assert.ok(/progressValue: Math\.min\(done, total\)/.test(body), '老端那句 `Math.min(done, total)` 不是多余的');
    assert.ok(/progressMax: total/.test(body));
    assert.ok(/showAd: countOf\(roleUnion\?\.todayTaskAdvTimes\) <= 0/.test(body), '「显示广告」的门是 `todayTaskAdvTimes <= 0`');
    assert.ok(/adAvailable: LEAGUE_AD_PLAYBACK_AVAILABLE/.test(body), '广告能力闸应直连常量');
    assert.ok(/hasRedDot: hasLeagueTaskRedDot\(/.test(body));
    assert.ok(!/Request[A-Za-z]*Task/.test(body), 'loadTask 不该发任何请求');

    // `readTaskCmds`：只读 `getTlCmdTask()`，且**不按表裁剪**
    const rcAt = repo.indexOf('private readTaskCmds(');
    assert.ok(rcAt > 0, '缺 readTaskCmds');
    const rc = repo.slice(rcAt, repo.indexOf('\n    }', rcAt));
    assert.ok(rc.includes('getTlCmdTask'), '联盟任务 = 通用任务缓存，读 `getTlCmdTask()`');
    assert.ok(rc.includes('countOf(row.count)'), 'protobuf `Long` 要走 `countOf`（直接当 number 会得到 NaN）');
    assert.ok(!rc.includes('parseTaskUnionRows'), '别在读取层按表裁剪（表热更后不必重进面板）');
    assert.ok(!/Request[A-Za-z]*Task/.test(rc), '读取层不许发包');

    // 两个领奖请求：非法参数直接 `failed`，不发空包
    const rewardAt = repo.indexOf('async requestTaskReward(');
    assert.ok(/if \(id <= 0\) return 'failed';/.test(repo.slice(rewardAt, rewardAt + 400)));
    const progressAt = repo.indexOf('async requestTaskProgressReward(');
    assert.ok(/if \(value <= 0\) return 'failed';/.test(repo.slice(progressAt, progressAt + 400)));
    assert.ok(repo.includes('RequestTaskUnionGetReward') && repo.includes('RequestTaskUnionGetProgressReward'));
});

test('E7 LeagueTaskRow：5 处显隐绝对赋值 + 红点走 `setRedDot` + 三处「别按直觉改」', () => {
    const row = readFileSync(ROW_TS, 'utf8');
    // 一个 controller 摊成 5 处 bool
    for (const line of [
        'this.getButton.active = canReward;',
        'this.goButton.active = undone;',
        'this.advButton.active = undone && showAd && LEAGUE_AD_PLAYBACK_AVAILABLE;',
        'this.doneTag.active = rewarded;',
        'this.progressNode.active = !rewarded;',
    ]) {
        assert.ok(row.includes(line), `缺一句绝对赋值：${line}`);
    }
    // ① 红点与按钮可见性同源
    assert.ok(row.includes('dot.setRedDot(canReward ? 1 : 0)'), '必须用 `setRedDot()`（`RedDot.onLoad` 会压三个子节点）');
    assert.ok(/dot\.setRedDot\(canReward \? 1 : 0\)/.test(row));
    // ② 只有一颗红点 @property（`btn_go` / `btn_adv` 不建）
    const redDotProps = [...row.matchAll(/@property\([^)]*\)\s*\n\s*(\w+)\s*:/g)]
        .map((m) => m[1])
        .filter((name) => /reddot/i.test(name));
    assert.deepEqual(redDotProps, ['getRedDot'],
        '只该有 `getRedDot` 一颗（老端从没驱动过 `btn_go` / `btn_adv` 的红点）');
    // ③ `btn_adv` 恒灭（第三道门直接关死）
    assert.ok(row.includes('LEAGUE_AD_PLAYBACK_AVAILABLE'), '`btn_adv` 的可见性要过广告能力闸');
    // 进度条满宽是常量、不现算（现算会越缩越小）
    assert.ok(/export const LEAGUE_TASK_ROW_PROGRESS_FULL_WIDTH = 156;/.test(row));
    // 三颗按钮各绑一次；空槽点了不发
    assert.ok(/private bind\(\): void/.test(row) && row.includes('this.bound'));
    assert.ok(row.includes('const view = this.current;'));
});

test('E8 LeagueTaskBox：呼吸 tween 复刻 FGUI 过渡 `t0`，缩放挂 `Box`、销毁时停干净', () => {
    const code = readFileSync(BOX_TS, 'utf8');
    assert.ok(/const BREATH_SEGMENT_SECONDS = 0\.5;/.test(code), '每段 12 帧 @24fps = 0.5s');
    // 1 → 1.1 → 1 → 0.9 → 1，无限循环
    for (const v of ['new Vec3(1.1, 1.1, 1)', 'new Vec3(0.9, 0.9, 1)']) {
        assert.ok(code.includes(v), `缺 tween 目标值 ${v}`);
    }
    assert.ok(code.includes('.union()') && code.includes('.repeatForever()'), '四段要 union 后 repeatForever');
    // ⚠️ 缩放挂 `chest.node`（FGUI 过渡的 target 是那颗按钮），不是本节点
    assert.ok(/const node = this\.chest\.node;/.test(code), '缩放应挂在 Box 上（挂本节点会连带 Value/Check/RedDot 一起脉动）');
    assert.ok(/Tween\.stopAllByTarget\(node\)/.test(code), 'onDestroy 必须停 tween（否则节点销毁后报 target is invalid）');
    // 三态绝对赋值
    assert.ok(code.includes("this.checkMark.active = view.state === 'rewarded'"), '对勾只在「已领取」页');
    assert.ok(code.includes("dot.setRedDot(view.state === 'canReward' ? 1 : 0)"), '宝箱红点只在「可领取」页');
    assert.ok(code.includes('this.valueLabel.string = String(view.milestone)'), '里程碑数字取自表');
    assert.ok(code.includes('if (frame && this.chest) this.chest.spriteFrame = frame'),
        '帧为 null 时**保留** prefab 静态图（不清成空白）');
    // 三条点击支路由宿主决定
    assert.ok(code.includes('onBoxClick'), '点击出口要交给宿主（发包 / 弹浮框都不属于这一层）');
});

test('E9 入口接线：`BtnTask` 已落 + 分发到 LeagueTaskPage + 红点来源改 `task`', () => {
    const btnTask = LEAGUE_ENTRANCES.find((e) => e.node === 'BtnTask');
    assert.ok(btnTask, '入口表里没有 BtnTask');
    assert.equal(btnTask!.key, 'LayerLeagueTask');
    assert.equal(btnTask!.landed, true, 'P5 起 BtnTask 应已落地');
    assert.equal(LEAGUE_ENTRANCE_RED_DOT_SOURCE.LayerLeagueTask, 'task', '任务入口红点要接真判据');

    const page = readFileSync(LEAGUE_PAGE_TS, 'utf8');
    assert.ok(/case 'LayerLeagueTask':[\s\S]{0,200}void LeagueTaskPage\.open\(/.test(page),
        '入口要分发到 LeagueTaskPage.open');
    assert.ok(/import \{ LeagueTaskPage \} from '\.\/LeagueTaskPage';/.test(page), '缺 LeagueTaskPage 的 import');
    // 来源表 → 具体判据的映射（`discount` / `task` 两条真判据都要认）
    assert.ok(/function leagueEntranceRedDotOn\(/.test(page), '缺 leagueEntranceRedDotOn');
    assert.ok(/case 'task': return dots\.task;/.test(page), '映射函数要认 task 来源');
    assert.ok(/case 'discount': return dots\.discount;/.test(page), '映射函数要认 discount 来源');
});

test('E10 ⚠️ LeagueTaskBox.onDestroy 只能碰「还活着」的引用：不许 getComponent / off', () => {
    const code = readFileSync(BOX_TS, 'utf8');
    const m = /protected onDestroy\(\): void \{([\s\S]*?)\n    \}/.exec(code);
    assert.ok(m, '找不到 LeagueTaskBox.onDestroy');
    // ⚠️ 必须先把注释剥掉再查：这段的说明注释里**故意**写了 `Component.getComponent()`
    //    和 `off()` 来记录根因，直接 `includes()` 会误报。
    const body = m![1].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!body.includes('getComponent'),
        'onDestroy 里不许 getComponent：`chest` 的子节点此时已先销毁，`Component.getComponent()` 内部读 `this._node` 会抛');
    assert.ok(!/\.off\(/.test(body),
        'onDestroy 里不许手动 `off()`（事件监听随节点销毁由引擎清；口径同 `LeagueDiscountPage.onDestroy`）');
    // 只读 `chest.node` 这个**可空**引用（读属性不抛），为 null 就跳过
    assert.ok(/const node = this\.chest \? this\.chest\.node : null;/.test(body),
        '要读 `chest.node` 这个可空引用，不能直接解引用（`this.chest.node` 可能已是 null）');
    assert.ok(/if \(node\) Tween\.stopAllByTarget\(node\);/.test(body), 'tween 仍要停，但要判空');
    // 顺手把宿主回调摘掉（不然组件销毁后还攥着外部闭包）
    assert.ok(body.includes('this.current = null;') && body.includes('this.onBoxClick = null;'),
        'onDestroy 要把 `current` / `onBoxClick` 摘掉');
});
