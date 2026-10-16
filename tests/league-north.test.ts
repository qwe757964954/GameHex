/**
 * 「联盟」P6（**北伐中原 / 联合战线**）的回归网。
 *
 * 与 `league-hall*.test.ts` / `league-apply-edit.test.ts` / `league-task.test.ts` 等同一套五段口径：
 *
 *   A. **文案口径**（`LeagueTexts`）—— 标题 / 三颗按钮 / 剩余时间模板 / 开放时段模板 /
 *      擂鼓上限提示 / 两个子页的页签与表头 / 两态页签的字色。
 *   B. **美术口径**（`LeagueArt`）—— P6 的图名别名（与大厅 / 商店 / 任务共用哪几张）、
 *      **页签底图与字色「反着来」**、九宫格集合（木纹外板 + 羊皮纸内框进，`zg_pic02/03` 不进）。
 *   C. **数据口径**（`LeagueTable`）—— `parseLeagueNorthConfig` / `isLeagueNorthOpen` /
 *      `parseLeagueActivity` / `parseLeagueGuanKaRows` / `parseLeagueMonsterRows` /
 *      `leagueNorthBossOf` / `parseLeagueRankRows` / `parseUnionRankAwardRows` /
 *      `leagueRankRewardOf` / `buildLeagueNorthRankRowView(s)` / `parseNorthTaskUnionRows` /
 *      `buildLeagueNorthRewardRowView(s)` / `northRewardRowsOf` / 三条红点判据 /
 *      `leagueNorthBuffText` / `leagueNorthTimesText` / `leagueNorthBuffRemainSec` /
 *      `leagueNorthResetRemainSec` / `leagueNorthHms`，并对四张真表做探针。
 *   D. **prefab 结构 + 几何**（6 张 prefab）—— 见文件尾部（prefab 落盘后补）。
 *   E. **页面逻辑 / 调用约定**（源码文本层）—— 排行页「请求-响应 + `!ok` 保留上一趟」、
 *      奖励页「切页签不发包」、主面板三颗按钮的闸、`nextPopupFrame` 时序、防连点。
 *
 * ## 口径真源
 *
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/副本/北伐中原/*.xml`
 *     （`组件_联盟_北伐中原` / `_排行` / `_排行Item` / `_奖励` / `_奖励Item` / `_排名` / `_文本`）、
 *     `…/主界面_联盟/副本/北伐中原/组件_联盟_页签.xml`
 *   - 表：`assets/remoteRef/taskUnion.json`（33 行：1→8 / **2→20** / **3→5**）、
 *     `bfUnionRankAward.json`（5 行）、`guankaReward.json`（1632 行，**只有 10 关带 `tlBoss`**）、
 *     `monster.json`（152 行）
 *   - 老端：`client/.../league/play/LayerLeagueNorthernExpedition{,Rank,Reward}.ts`、
 *     `model/league/ModelLeague.ts`（`hasNorthernExpedition*RD`）
 *   - 本项目：`assets/script/app/league/**`
 *
 * ## ⚠️ P6 里几条**刻意与直觉相反**的口径（回归点，别"顺手改对"）
 *
 *   ① **主面板背景是 `lm_bg03`（=`lianmeng_bg03`），不是 `lm_bg02`** —— 后者是大厅的。
 *   ② **属性区那 5 行文本是黑字**：FGUI 的 `组件_联盟_北伐中原文本` 没有 `color`
 *      ⇒ 吃工程默认 `#000000`，而它们落在**浅色羊皮纸**上；面板其它文本都在深色木纹上、显式米白。
 *   ③ **排行协议的 `unionId` 字段填的是角色 id**（照抄老端，服务端就这么认）。
 *   ④ **擂鼓判据是 `CmdRoleUnion.todayDrumTimes`**，不是 `selfTimes`（那是挑战次数）。
 *   ⑤ **活动剩余时间的 `resetTime`（proto 是 ms）折成秒后 + 86400 秒**才是截止时刻
 *      —— 别把老端的 `*1000` 也照抄过来。
 *   ⑥ **挑战红点：活动不存在 ⇒ 不亮**（老端 `if (!act) return false`），
 *      别写成「没活动 ⇒ 0 < 上限 ⇒ 恒亮」。
 *   ⑦ **页签两态是「底图与字色反着来」**：未选中 = 亮底 + 暗字，选中 = 暗底 + 亮字。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_BOTTOM_BAR,
    LEAGUE_ART_BTN_JOIN,
    LEAGUE_ART_LEVEL_ROW_BG,
    LEAGUE_ART_LEVEL_ROW_TITLE_BAR,
    LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA,
    LEAGUE_ART_NORTH_ATTR_BG,
    LEAGUE_ART_NORTH_BACK,
    LEAGUE_ART_NORTH_BG,
    LEAGUE_ART_NORTH_BOARD,
    LEAGUE_ART_NORTH_BOARD_TITLE,
    LEAGUE_ART_NORTH_BOTTOM_BAR,
    LEAGUE_ART_NORTH_CHALLENGE_BTN,
    LEAGUE_ART_NORTH_DRUM_BTN,
    LEAGUE_ART_NORTH_DONE_TAG,
    LEAGUE_ART_NORTH_GOODS_FRAME,
    LEAGUE_ART_NORTH_HEAD_FRAME,
    LEAGUE_ART_NORTH_HELP,
    LEAGUE_ART_NORTH_INNER_FRAME,
    LEAGUE_ART_NORTH_PROGRESS_BG,
    LEAGUE_ART_NORTH_PROGRESS_FILL,
    LEAGUE_ART_NORTH_RANK_HEAD_BAR,
    LEAGUE_ART_NORTH_RANK_MINE_BG,
    LEAGUE_ART_NORTH_RANK_ROW_BG,
    LEAGUE_ART_NORTH_RANK_TAB_ICON,
    LEAGUE_ART_NORTH_REWARD_BTN,
    LEAGUE_ART_NORTH_REWARD_ROW_BAR,
    LEAGUE_ART_NORTH_REWARD_ROW_BAR_ALPHA,
    LEAGUE_ART_NORTH_REWARD_ROW_BG,
    LEAGUE_ART_NORTH_REWARD_TAB_ICON,
    LEAGUE_ART_NORTH_ROW_BG,
    LEAGUE_ART_NORTH_SWEEP_BTN,
    LEAGUE_ART_NORTH_TAB_NORMAL,
    LEAGUE_ART_NORTH_TAB_SELECTED,
    LEAGUE_ART_NORTH_TAB_TEXT_NORMAL,
    LEAGUE_ART_NORTH_TAB_TEXT_SELECTED,
    LEAGUE_ART_NORTH_TAB_TEXT_STROKE,
    LEAGUE_ART_NORTH_TITLE_DECO,
    LEAGUE_ART_OPS_BTN,
    LEAGUE_ART_PROGRESS_BG,
    LEAGUE_ART_PROGRESS_FILL,
    LEAGUE_ART_SLICED,
    LEAGUE_SPRITE_SIMPLE,
    LEAGUE_SPRITE_SLICED,
    leagueSpriteType,
} from '../assets/script/app/league/LeagueArt';
import {
    buildLeagueNorthRankRowView,
    buildLeagueNorthRankRowViews,
    buildLeagueNorthRewardRowView,
    buildLeagueNorthRewardRowViews,
    hasLeagueNorthChallengeRedDot,
    hasLeagueNorthRedDot,
    hasLeagueNorthRewardRedDot,
    isLeagueNorthOpen,
    LEAGUE_ENTRANCES,
    LEAGUE_ENTRANCE_RED_DOT_SOURCE,
    LEAGUE_GUANKA_REWARD_TABLE,
    LEAGUE_MONSTER_TABLE,
    LEAGUE_NORTH_CONFIG_DEFAULTS,
    LEAGUE_NORTH_CONFIG_KEYS,
    LEAGUE_NORTH_RANK_SHOW_NUM,
    LEAGUE_NORTH_RANK_TYPE,
    LEAGUE_NORTH_REWARD_SUB_TYPES,
    LEAGUE_NORTH_REWARD_SUB_TYPE,
    LEAGUE_UNION_RANK_AWARD_TABLE,
    LeagueUnionTaskType,
    leagueNorthBossOf,
    leagueNorthBuffRemainSec,
    leagueNorthBuffText,
    leagueNorthHms,
    leagueNorthOpenHourText,
    leagueNorthResetRemainSec,
    leagueNorthTimesText,
    leagueRankRewardOf,
    northRewardRowsOf,
    parseLeagueActivity,
    parseLeagueGuanKaRows,
    parseLeagueMonsterRows,
    parseLeagueNorthConfig,
    parseLeagueRankRows,
    parseNorthTaskUnionRows,
    parseUnionRankAwardRows,
    type ILeagueActivityView,
    type ILeagueNorthConfig,
    type ILeagueRankRow,
    type ILeagueTaskUnionRow,
    type ILeagueUnionRankAwardRow,
} from '../assets/script/app/league/LeagueTable';
import {
    fillLeagueText,
    LEAGUE_NORTH_BTN_CHALLENGE,
    LEAGUE_NORTH_BTN_DRUM,
    LEAGUE_NORTH_BTN_SWEEP,
    LEAGUE_NORTH_COL_COUNT,
    LEAGUE_NORTH_COL_DAMAGE,
    LEAGUE_NORTH_COL_LEAGUE,
    LEAGUE_NORTH_COL_PLAYER,
    LEAGUE_NORTH_COL_RANK,
    LEAGUE_NORTH_COL_REWARD,
    LEAGUE_NORTH_DRUM_LIMIT,
    LEAGUE_NORTH_FIGHT_MISSING,
    LEAGUE_NORTH_HELP_ID,
    LEAGUE_NORTH_HELP_MISSING,
    LEAGUE_NORTH_OPEN_HOUR_TEMPLATE,
    LEAGUE_NORTH_RANK_AWARD_TIP,
    LEAGUE_NORTH_RANK_TITLE,
    LEAGUE_NORTH_RANK_UNRANKED,
    LEAGUE_NORTH_REMAIN_TIME_TEMPLATE,
    LEAGUE_NORTH_REWARD_BTN_CLAIM,
    LEAGUE_NORTH_REWARD_BTN_UNDONE,
    LEAGUE_NORTH_REWARD_TITLE,
    LEAGUE_NORTH_TAB_PROGRESS,
    LEAGUE_NORTH_TAB_RANK,
    LEAGUE_NORTH_TAB_REWARD_LEAGUE,
    LEAGUE_NORTH_TAB_REWARD_ROLE,
} from '../assets/script/app/league/LeagueTexts';

// ============================================================
// 路径
// ============================================================

const PAGE_TS = 'assets/script/app/league/LeagueNorthExpeditionPage.ts';
const RANK_PAGE_TS = 'assets/script/app/league/LeagueNorthRankPage.ts';
const REWARD_PAGE_TS = 'assets/script/app/league/LeagueNorthRewardPage.ts';
const RANK_ROW_TS = 'assets/script/app/league/LeagueNorthRankRow.ts';
const REWARD_ROW_TS = 'assets/script/app/league/LeagueNorthRewardRow.ts';
const TAB_TS = 'assets/script/app/league/LeagueNorthTab.ts';
const REPO_TS = 'assets/script/app/league/LeagueRepository.ts';
const LEAGUE_PAGE_TS = 'assets/script/app/league/LeaguePage.ts';

const TASK_UNION_JSON = 'assets/remoteRef/taskUnion.json';
const RANK_AWARD_JSON = 'assets/remoteRef/bfUnionRankAward.json';
const GUANKA_JSON = 'assets/remoteRef/guankaReward.json';
const MONSTER_JSON = 'assets/remoteRef/monster.json';

/** `{k:[…], v:[[…]]}` 列式表 → 行对象数组。 */
function loadTable(path: string): Array<Record<string, unknown>> {
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { k: string[]; v: unknown[][] };
    return doc.v.map((row) => Object.fromEntries(doc.k.map((name, i) => [name, row[i]])));
}

// ============================================================
// A. 文案
// ============================================================

test('A1 主面板文案：剩余时间模板 / 开放时段模板 / 擂鼓上限提示 / 三颗按钮', () => {
    // `mL.json` id=114 `Client_RemainTime` = `剩余时间：{0}`（**全角冒号**）
    assert.equal(LEAGUE_NORTH_REMAIN_TIME_TEMPLATE, '剩余时间：{0}');
    assert.equal(fillLeagueText(LEAGUE_NORTH_REMAIN_TIME_TEMPLATE, '01:02:03'), '剩余时间：01:02:03');
    // `mL.json` id=388 `LayerRank_10_NOT_OPEN` = `{0}点到{1}点开启`
    assert.equal(LEAGUE_NORTH_OPEN_HOUR_TEMPLATE, '{0}点到{1}点开启');
    // `mL.json` id=554 `LEAGUE_EXPEDITION_DRUM_LIMIT`
    assert.equal(LEAGUE_NORTH_DRUM_LIMIT, '今日擂鼓次数已用尽');
    // FGUI 三颗按钮的静态 title
    assert.equal(LEAGUE_NORTH_BTN_DRUM, '擂鼓');
    assert.equal(LEAGUE_NORTH_BTN_CHALLENGE, '挑战');
    assert.equal(LEAGUE_NORTH_BTN_SWEEP, '扫荡');
});

test('A2 两处「没迁」的提示：帮助 / 战斗入口（不静默失败）', () => {
    // 老端 `CtrlAlert.OpenHelpe("leaguefb01")` —— 本工程没有 CtrlAlert ⇒ 提示
    assert.equal(LEAGUE_NORTH_HELP_ID, 'leaguefb01');
    assert.equal(LEAGUE_NORTH_HELP_MISSING, '该功能暂未开放');
    // 老端 `CtrlJumpView.GotoSingleFight(...)` —— 战斗入口是另一套 ⇒ 提示
    assert.equal(LEAGUE_NORTH_FIGHT_MISSING, '该功能暂未开放');
});

test('A3 排行页页签 + 表头 + 底部说明', () => {
    assert.equal(LEAGUE_NORTH_TAB_RANK, '联盟排名');
    assert.equal(LEAGUE_NORTH_TAB_PROGRESS, '盟内进度');
    // 表头六个（排名是两页共用那一列，其余按页签各一组）
    assert.equal(LEAGUE_NORTH_COL_RANK, '排名');
    assert.equal(LEAGUE_NORTH_COL_LEAGUE, '联盟及伤害');
    assert.equal(LEAGUE_NORTH_COL_COUNT, '人数');
    assert.equal(LEAGUE_NORTH_COL_REWARD, '奖励');
    assert.equal(LEAGUE_NORTH_COL_DAMAGE, '伤害总量');
    assert.equal(LEAGUE_NORTH_COL_PLAYER, '玩家信息');
    assert.equal(LEAGUE_NORTH_RANK_AWARD_TIP, '排名奖励将在周一00:00以邮件形式发放');
    assert.equal(LEAGUE_NORTH_RANK_TITLE, '排名');
});

test('A4 奖励页页签 + 三态按钮文案 + 「未上榜」', () => {
    assert.equal(LEAGUE_NORTH_REWARD_TITLE, '联合战线奖励');
    assert.equal(LEAGUE_NORTH_TAB_REWARD_LEAGUE, '联盟奖励');
    assert.equal(LEAGUE_NORTH_TAB_REWARD_ROLE, '个人奖励');
    // `gearText pages="0,1" values="未完成|领取"`（「已领取」那页按钮整个隐藏，不在这两个里）
    assert.equal(LEAGUE_NORTH_REWARD_BTN_UNDONE, '未完成');
    assert.equal(LEAGUE_NORTH_REWARD_BTN_CLAIM, '领取');
    // `组件_联盟_北伐中原_排名` 的 `n10`（`标签` 控制器第 4 页）
    assert.equal(LEAGUE_NORTH_RANK_UNRANKED, '未上榜');
});

// ============================================================
// B. 美术
// ============================================================

test('B1 ⚠️ 主面板背景 = `lm_bg03`（`lianmeng_bg03`），不是大厅那张 `lm_bg02`', () => {
    assert.equal(LEAGUE_ART_NORTH_BG, 'lm_bg03');
    // 面板自带宽幅木纹板 + 羊皮纸内框（不是公共弹窗骨架）
    assert.equal(LEAGUE_ART_NORTH_BOARD, 'panel_window_02_9gong');
    assert.equal(LEAGUE_ART_NORTH_INNER_FRAME, 'frame_01_9gong');
    // 木牌标题 + 标题金边横幅
    assert.equal(LEAGUE_ART_NORTH_BOARD_TITLE, 'zg_pic03');
    assert.equal(LEAGUE_ART_NORTH_TITLE_DECO, 'zg_pic02');
});

test('B2 图名别名：与大厅 / 商店 / 任务共用哪几张（别以为 FGUI 用了新图）', () => {
    // 底栏 / 返回 / 帮助 都是全工程通用的那三张
    assert.equal(LEAGUE_ART_NORTH_BOTTOM_BAR, LEAGUE_ART_BOTTOM_BAR);
    assert.equal(LEAGUE_ART_NORTH_BOTTOM_BAR, 'diban_BG');
    assert.equal(LEAGUE_ART_NORTH_BACK, 'btn_FanHui');
    assert.equal(LEAGUE_ART_NORTH_HELP, 'zx_btn01');
    // 行底框 = 大厅等级行底框（frame_Zhikuang05 / 我的名次底板 frame_Zhikuang01）
    assert.equal(LEAGUE_ART_NORTH_ROW_BG, 'frame_Zhikuang05');
    assert.equal(LEAGUE_ART_NORTH_ATTR_BG, 'frame_Zhikuang04');
    assert.equal(LEAGUE_ART_NORTH_RANK_ROW_BG, LEAGUE_ART_LEVEL_ROW_BG);
    assert.equal(LEAGUE_ART_NORTH_RANK_MINE_BG, LEAGUE_ART_LEVEL_ROW_BG);
    assert.equal(LEAGUE_ART_NORTH_REWARD_ROW_BG, LEAGUE_ART_LEVEL_ROW_BG);
    // 行标题衬底 = 大厅行标题衬底（BB_img03，alpha 0.5）；排行页表头底条同图
    assert.equal(LEAGUE_ART_NORTH_RANK_HEAD_BAR, LEAGUE_ART_LEVEL_ROW_TITLE_BAR);
    assert.equal(LEAGUE_ART_NORTH_REWARD_ROW_BAR, LEAGUE_ART_LEVEL_ROW_TITLE_BAR);
    assert.equal(LEAGUE_ART_NORTH_REWARD_ROW_BAR_ALPHA, LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA);
    assert.equal(LEAGUE_ART_NORTH_REWARD_ROW_BAR_ALPHA, 128);
    // 进度条 = 大厅经验条（bg 九宫格 / fill 靠改宽度）
    assert.equal(LEAGUE_ART_NORTH_PROGRESS_BG, LEAGUE_ART_PROGRESS_BG);
    assert.equal(LEAGUE_ART_NORTH_PROGRESS_FILL, LEAGUE_ART_PROGRESS_FILL);
    // 三颗按钮：擂鼓 = 通用按钮 / 挑战 = **TY_btn23** / 扫荡 = TY_btn24
    assert.equal(LEAGUE_ART_NORTH_DRUM_BTN, LEAGUE_ART_OPS_BTN);
    // ⚠️ 「挑战」**不是** P5 那颗 `TY_btn06`（`LEAGUE_ART_BTN_JOIN`）。
    //    依据 `组件_联盟_北伐中原.xml`：
    //      <Button title="挑战" icon="ui://w3m64m877ws21yxnalz"/>  ← `yxnalz` = TY_btn23
    //    `TY_btn06`（`n44q1yxnakh`）在本页只用在「擂鼓 / 领取」那颗（= `LEAGUE_ART_OPS_BTN` 那族的
    //    另一张，见 F 段），跟挑战按钮无关。别凭「挑战 = 加入同义」猜图名。
    assert.equal(LEAGUE_ART_NORTH_CHALLENGE_BTN, 'TY_btn23');
    assert.notEqual(LEAGUE_ART_NORTH_CHALLENGE_BTN, LEAGUE_ART_BTN_JOIN, 'TY_btn23 ≠ TY_btn06');
    assert.equal(LEAGUE_ART_NORTH_SWEEP_BTN, 'TY_btn24');
    // 奖励行那颗「领取」= 通用按钮
    assert.equal(LEAGUE_ART_NORTH_REWARD_BTN, LEAGUE_ART_OPS_BTN);
    // 物品框 / 头像框 / 战力条 / 已领取印章
    assert.equal(LEAGUE_ART_NORTH_GOODS_FRAME, 'common_img_pzk_01');
    assert.equal(LEAGUE_ART_NORTH_HEAD_FRAME, 'img_Touxiang_01');
    assert.equal(LEAGUE_ART_NORTH_DONE_TAG, '公用_图标_已领取');
    // 左侧两个入口图标（排行 / 奖励）
    assert.equal(LEAGUE_ART_NORTH_RANK_TAB_ICON, 'ph');
    assert.equal(LEAGUE_ART_NORTH_REWARD_TAB_ICON, 'jl');
});

test('B3 ⚠️ 页签两态：底图与字色**反着来**（未选中 = 亮底暗字；选中 = 暗底亮字）', () => {
    // `gearIcon pages="0,1,2,3" values="…TY_btn23|…TY_btn20|…TY_btn23|…TY_btn20"`
    // ⚠️ 未选中底图 = `TY_btn23`，**与「挑战」按钮同一张**（≠ P5 的 `TY_btn06`）。
    //    这里断言「等于挑战按钮的图」而不是「等于 TY_btn06」：两者同源同图，
    //    绑在一起改才不会各改一半。
    assert.equal(LEAGUE_ART_NORTH_TAB_NORMAL, LEAGUE_ART_NORTH_CHALLENGE_BTN); // TY_btn23（亮）
    assert.equal(LEAGUE_ART_NORTH_TAB_NORMAL, 'TY_btn23');
    assert.notEqual(LEAGUE_ART_NORTH_TAB_NORMAL, LEAGUE_ART_BTN_JOIN, 'TY_btn23 ≠ TY_btn06');
    assert.equal(LEAGUE_ART_NORTH_TAB_SELECTED, 'TY_btn20'); // 暗
    // `gearColor pages="0,…" values="#b6af95,#160e08|#fcf0d6,#502010|…"`
    assert.deepEqual([...LEAGUE_ART_NORTH_TAB_TEXT_NORMAL], [0xb6, 0xaf, 0x95]); // 暗字
    assert.deepEqual([...LEAGUE_ART_NORTH_TAB_TEXT_SELECTED], [0xfc, 0xf0, 0xd6]); // 亮字
    assert.deepEqual([...LEAGUE_ART_NORTH_TAB_TEXT_STROKE], [0x50, 0x20, 0x10]);
    // ⚠️ 「选中 = 亮」这条不能只看字色就推底图（两者是反的）
    const normalLum = LEAGUE_ART_NORTH_TAB_TEXT_NORMAL[0] + LEAGUE_ART_NORTH_TAB_TEXT_NORMAL[1]
        + LEAGUE_ART_NORTH_TAB_TEXT_NORMAL[2];
    const selectedLum = LEAGUE_ART_NORTH_TAB_TEXT_SELECTED[0] + LEAGUE_ART_NORTH_TAB_TEXT_SELECTED[1]
        + LEAGUE_ART_NORTH_TAB_TEXT_SELECTED[2];
    assert.ok(selectedLum > normalLum, '选中态字色应当比未选中更亮');
});

test('B4 九宫格集合：木纹外板 + 羊皮纸内框进；`zg_pic02/03` / `bb_pic11` 等**不进**', () => {
    // 进集合 ⇒ prefab 必须 `_type = 1`（720×660 横向拉宽 + 680×545 双向都不变形）
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_NORTH_BOARD), 'panel_window_02_9gong 必须九宫格');
    assert.equal(leagueSpriteType(LEAGUE_ART_NORTH_BOARD), LEAGUE_SPRITE_SLICED);
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_NORTH_INNER_FRAME), 'frame_01_9gong 必须九宫格');
    assert.equal(leagueSpriteType(LEAGUE_ART_NORTH_INNER_FRAME), LEAGUE_SPRITE_SLICED);
    // 两块小底板 / 属性区片 也是九宫格（FGUI `公用0` 的 05 与 `主界面_联盟` 的 04 都标了 scale9grid）
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_NORTH_ROW_BG), 'frame_Zhikuang05 必须九宫格');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_NORTH_ATTR_BG), 'frame_Zhikuang04 必须九宫格');
    // 行/底板/进度条沿用大厅那几张（已在集合里）
    for (const art of [
        LEAGUE_ART_NORTH_RANK_ROW_BG, LEAGUE_ART_NORTH_RANK_MINE_BG,
        LEAGUE_ART_NORTH_REWARD_ROW_BG, LEAGUE_ART_NORTH_PROGRESS_BG,
        LEAGUE_ART_NORTH_DRUM_BTN, LEAGUE_ART_NORTH_REWARD_BTN,
    ]) {
        assert.ok(LEAGUE_ART_SLICED.has(art), `${art} 应当九宫格`);
    }
    // 不进集合 ⇒ `_type = 0`
    for (const art of [
        LEAGUE_ART_NORTH_BG, // lm_bg03：整屏底图，直接铺满
        LEAGUE_ART_NORTH_TITLE_DECO, // zg_pic02：FGUI 没标 scale9grid（实例也无 size）
        LEAGUE_ART_NORTH_BOARD_TITLE, // zg_pic03
        LEAGUE_ART_NORTH_PROGRESS_FILL, // bar_bg_01_hong：靠改宽度
        LEAGUE_ART_NORTH_SWEEP_BTN, // TY_btn24（原稿 224×79，一格不拉）
        LEAGUE_ART_NORTH_TAB_SELECTED, // TY_btn20
        LEAGUE_ART_NORTH_CHALLENGE_BTN, // ⚠️ TY_btn23（≠ P5 的 TY_btn06）
        LEAGUE_ART_NORTH_TAB_NORMAL, // 同上，与挑战按钮同图
        LEAGUE_ART_NORTH_DONE_TAG, LEAGUE_ART_NORTH_HEAD_FRAME, LEAGUE_ART_NORTH_GOODS_FRAME,
    ]) {
        assert.ok(!LEAGUE_ART_SLICED.has(art), `${art} 不该在九宫格集合里`);
        assert.equal(leagueSpriteType(art), LEAGUE_SPRITE_SIMPLE, `${art} 应按 SIMPLE 用`);
    }
    // ⚠️ 页签的**未选中底图**与「挑战」按钮是**同一张** `TY_btn23`（不是 P5 的 `TY_btn06`）
    assert.equal(LEAGUE_ART_NORTH_TAB_NORMAL, LEAGUE_ART_NORTH_CHALLENGE_BTN);
    assert.equal(LEAGUE_ART_NORTH_CHALLENGE_BTN, 'TY_btn23');
    assert.notEqual(LEAGUE_ART_NORTH_CHALLENGE_BTN, LEAGUE_ART_BTN_JOIN, 'TY_btn23 ≠ TY_btn06');
});

// ============================================================
// C. 数据口径
// ============================================================

const CFG: ILeagueNorthConfig = {
    enterMaxCount: 2, drumMaxCount: 1, openHourStart: 9, openHourEnd: 23,
    buffAttack: 10, buffAddValue: 20, buffHours: 3, dailyRewards: [],
};

const act = (over: Partial<ILeagueActivityView> = {}): ILeagueActivityView => ({
    unionId: '1', type: 2, id: 40001, resetTimeSec: 1_700_000_000,
    addBuffTimes: 3, addBuffTimeMs: 1_700_000_000_000, allValue: 12_345,
    infos: [], ...over,
});

const rankRow = (over: Partial<ILeagueRankRow> = {}): ILeagueRankRow => ({
    rank: 1, roleId: '1', roleName: '盛世', value: 2_100_000_000,
    count: 53, maxCount: 53, usedSkinResId: 0, ...over,
});

const rewardRow = (over: Partial<ILeagueTaskUnionRow> = {}): ILeagueTaskUnionRow => ({
    resId: 502001, subType: LeagueUnionTaskType.leagueDamage, targetType: 0, targetCount: 100,
    reward: [{ resId: 11, number: 100 }], name: '联盟今日造成{count}伤害', goto: 0, ...over,
});

test('C1 表名常量 + 页签枚举 + 请求常量', () => {
    assert.equal(LEAGUE_GUANKA_REWARD_TABLE, 'guankaReward');
    assert.equal(LEAGUE_MONSTER_TABLE, 'monster');
    assert.equal(LEAGUE_UNION_RANK_AWARD_TABLE, 'bfUnionRankAward');
    // 两个页签 → 两个 `rankType`（联盟榜 24 / 盟内榜 22）
    assert.deepEqual({ ...LEAGUE_NORTH_RANK_TYPE }, { league: 24, progress: 22 });
    assert.equal(LEAGUE_NORTH_RANK_SHOW_NUM, 50);
    // 两档 `taskUnion.subType`
    assert.deepEqual({ ...LEAGUE_NORTH_REWARD_SUB_TYPE }, { league: 2, role: 3 });
    assert.deepEqual([...LEAGUE_NORTH_REWARD_SUB_TYPES], [2, 3]);
});

test('C2 `gameConfig` 6 个键：键名 + 兜底值逐条对现网', () => {
    assert.deepEqual({ ...LEAGUE_NORTH_CONFIG_KEYS }, {
        enterMaxCount: 'unionBFZYEnterMaxCount',
        drumMaxCount: 'unionBFZYDrumMaxCount',
        openHour: 'unionBFZYOpenHour',
        buff: 'unionBuffConfig',
        dailyRewards: 'unionDailyChallengeRewards',
    });
    assert.deepEqual({ ...LEAGUE_NORTH_CONFIG_DEFAULTS }, {
        enterMaxCount: 2, drumMaxCount: 1, openHourStart: 9, openHourEnd: 23,
        buffAttack: 10, buffAddValue: 20, buffHours: 3, dailyRewards: [],
    });
});

test('C3 parseLeagueNorthConfig：标量 / 数组 / 奖励三段都要读对；缺项取兜底', () => {
    const cfg = parseLeagueNorthConfig([
        { key: 'unionBFZYEnterMaxCount', value: 5 },
        { key: 'unionBFZYDrumMaxCount', value: 2 },
        { key: 'unionBFZYOpenHour', value: [10, 22] },
        { key: 'unionBuffConfig', value: [30, 40, 6] },
        { key: 'unionDailyChallengeRewards', value: [{ number: 200, resId: 7 }] },
        { key: 'other', value: 1 },
    ]);
    assert.equal(cfg.enterMaxCount, 5);
    assert.equal(cfg.drumMaxCount, 2);
    assert.equal(cfg.openHourStart, 10);
    assert.equal(cfg.openHourEnd, 22);
    assert.equal(cfg.buffAttack, 30);
    assert.equal(cfg.buffAddValue, 40);
    assert.equal(cfg.buffHours, 6);
    assert.deepEqual(cfg.dailyRewards, [{ resId: 7, number: 200 }]);
    // 全空 ⇒ 兜底
    assert.deepEqual({ ...parseLeagueNorthConfig([]) }, { ...LEAGUE_NORTH_CONFIG_DEFAULTS });
    assert.deepEqual({ ...parseLeagueNorthConfig(null as never) }, { ...LEAGUE_NORTH_CONFIG_DEFAULTS });
    // 数组缺一半 ⇒ 那一半取兜底
    const half = parseLeagueNorthConfig([{ key: 'unionBFZYOpenHour', value: [8] }]);
    assert.equal(half.openHourStart, 8);
    assert.equal(half.openHourEnd, LEAGUE_NORTH_CONFIG_DEFAULTS.openHourEnd);
});

test('C4 isLeagueNorthOpen：闭区间 `[start, end]`（`now === end` 仍算开）', () => {
    assert.equal(isLeagueNorthOpen(8, CFG), false);
    assert.equal(isLeagueNorthOpen(9, CFG), true, '起始那一刻算开');
    assert.equal(isLeagueNorthOpen(15, CFG), true);
    assert.equal(isLeagueNorthOpen(23, CFG), true, '结束那一刻仍算开（老端是 `now > end` 才算关）');
    assert.equal(isLeagueNorthOpen(0, CFG), false);
    assert.equal(isLeagueNorthOpen(Number.NaN, CFG), false);
    assert.equal(leagueNorthOpenHourText(CFG), '9点到23点开启');
});

test('C5 parseLeagueActivity：`resetTime`（ms）折成秒；缺字段按 0/null', () => {
    const view = parseLeagueActivity({
        unionId: 7, type: 2, id: 40003, resetTime: 1_700_000_000_000,
        addBuffTimes: 2, addBuffTime: 1_699_999_000_000, allValue: 999,
        tlCmdUnionActInfo: [{ roleId: 5, times: 2, value: 300 }, { roleId: '5', times: 1, value: 100 }],
    });
    assert.ok(view);
    assert.equal(view!.resetTimeSec, 1_700_000_000, 'resetTime 是 ms，折成秒后 +86400 才是截止');
    assert.equal(view!.id, 40003);
    assert.equal(view!.allValue, 999);
    assert.equal(view!.addBuffTimes, 2);
    assert.equal(view!.addBuffTimeMs, 1_699_999_000_000);
    assert.equal(view!.infos.length, 2);
    // 空 / 非对象 ⇒ null
    assert.equal(parseLeagueActivity(null), null);
    assert.equal(parseLeagueActivity(undefined), null);
});

test('C6 parseLeagueGuanKaRows / parseLeagueMonsterRows：**全表保留**，没 boss 的关 `bossId = 0`', () => {
    const guanKa = parseLeagueGuanKaRows([
        { level: 40001, guanKaType: 3, tlBoss: [{ id: 62001 }] },
        { level: 10001, guanKaType: 1, tlBoss: [] },
        { level: 40002, guanKaType: 3, tlBoss: [{ id: 62002 }] },
        { level: 40003, guanKaType: 3, tlBoss: null },
        { level: 'x', guanKaType: 3, tlBoss: [{ id: 62003 }] },
    ]);
    // ⚠️ 解析层**不按 tlBoss 过滤**（1632 行里只有 10 关带 boss）——
    //    过滤掉的话 `leagueNorthBossOf(level)` 的查表就只对 boss 关有效，
    //    而「活动 id 指到非 boss 关 ⇒ 没有名字」这条路径要能返回 null（不是「查不到关」）。
    assert.deepEqual(guanKa.map((g) => [g.level, g.bossId]),
        [[40001, 62001], [10001, 0], [40002, 62002], [40003, 0]]);
    assert.deepEqual(parseLeagueGuanKaRows(null), []);

    const monsters = parseLeagueMonsterRows([
        { id: 62001, name: '深渊领主', model: '塔防_怪物_深渊领主' },
        { id: 'x', name: '脏', model: 'm' },
    ]);
    assert.deepEqual(monsters, [{ id: 62001, name: '深渊领主', model: '塔防_怪物_深渊领主' }]);
});

test('C7 leagueNorthBossOf：`actId` → `guankaReward.tlBoss[0]` → `monster` 三级反查', () => {
    const guanKa = parseLeagueGuanKaRows([
        { level: 40001, guanKaType: 3, tlBoss: [{ id: 62001 }] },
        { level: 90001, guanKaType: 3, tlBoss: [{ id: 62004 }] },
    ]);
    const monsters = parseLeagueMonsterRows([
        { id: 62001, name: '深渊领主', model: '塔防_怪物_深渊领主' },
        { id: 62004, name: '黑曜石魔像', model: '塔防_怪物_黑曜石魔像' },
    ]);
    assert.equal(leagueNorthBossOf(guanKa, monsters, 40001)?.name, '深渊领主');
    assert.equal(leagueNorthBossOf(guanKa, monsters, 90001)?.name, '黑曜石魔像');
    // 活动 id 不在表里 / 没有 monster ⇒ null（不抛）
    assert.equal(leagueNorthBossOf(guanKa, monsters, 12345), null);
    assert.equal(leagueNorthBossOf(guanKa, [], 40001), null);
    assert.equal(leagueNorthBossOf(guanKa, monsters, 0), null);
});

test('C8 parseLeagueRankRows：`rank`/`value`/`count` 数字化，`-1` 保留', () => {
    const rows = parseLeagueRankRows([
        { rank: 1, roleId: '9', roleName: '盛世', value: 100, count: 3, maxCount: 5, usedSkinResId: 0 },
        { rank: -1, roleId: '8', roleName: '我', value: 5, count: 1, maxCount: 5 },
        null,
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].rank, 1);
    assert.equal(rows[0].roleName, '盛世');
    assert.equal(rows[1].rank, -1, '未上榜是 -1，别钳成 0');
    assert.equal(rows[1].maxCount, 5);
    assert.deepEqual(parseLeagueRankRows(null), []);
});

test('C9 parseUnionRankAwardRows + leagueRankRewardOf：闭区间查表', () => {
    const awards: ILeagueUnionRankAwardRow[] = parseUnionRankAwardRows([
        { id: 1, rank: [1, 1], reward: [{ number: 3000, resId: 7 }] },
        { id: 2, rank: [4, 10], reward: [{ number: 2400, resId: 7 }] },
        { id: 3, rank: [11, 99], reward: [] },
    ]);
    assert.equal(awards.length, 3);
    assert.equal(awards[0].minRank, 1);
    assert.equal(awards[0].maxRank, 1);
    assert.equal(awards[1].minRank, 4);
    assert.equal(awards[1].maxRank, 10);
    assert.equal(leagueRankRewardOf(awards, 1)?.id, 1);
    assert.equal(leagueRankRewardOf(awards, 4)?.id, 2);
    assert.equal(leagueRankRewardOf(awards, 10)?.id, 2, '闭区间上界');
    assert.equal(leagueRankRewardOf(awards, 11)?.id, 3);
    assert.equal(leagueRankRewardOf(awards, 2), null, '2/3 名没有区间（表里就缺）');
    assert.equal(leagueRankRewardOf(awards, -1), null, '未上榜查不到 ⇒ 两颗物品框藏起来');
});

test('C10 buildLeagueNorthRankRowView：两个版式的字段一次算全；`rankText` 与 `rank` 的差异', () => {
    const awards = parseUnionRankAwardRows([
        { id: 1, rank: [1, 1], reward: [{ number: 3000, resId: 7 }, { number: 5000, resId: 11 }] },
    ]);
    const view = buildLeagueNorthRankRowView(rankRow({ rank: 1, value: 2_100_000_000, count: 53, maxCount: 53 }), awards);
    assert.equal(view.rank, 1);
    assert.equal(view.leagueName, '盛世');
    assert.equal(view.roleCountText, '53/53');
    assert.equal(view.userName, '盛世');
    assert.equal(view.headResId, 0);
    assert.equal(view.rewards.length, 2);
    assert.equal(view.rewards[0].resId, 7);
    // 数值走两种格式化（第 0 页 `formatNumberToZH` / 第 1 页 `numAbbr`）—— 未必相等
    assert.ok(view.powerText.length > 0, '第 0 页伤害文案不该为空');
    assert.ok(view.powerAbbrText.length > 0, '第 1 页伤害文案不该为空');
    // 未上榜：查不到区间 ⇒ 空奖励
    const unranked = buildLeagueNorthRankRowView(rankRow({ rank: -1 }), awards);
    assert.equal(unranked.rank, -1);
    assert.deepEqual(unranked.rewards, []);
    // 批量（入参是**已解析**的行数组 —— 解析层的空值兜底在 `parseLeagueRankRows` 里）
    assert.equal(buildLeagueNorthRankRowViews([rankRow(), rankRow({ rank: 2 })], awards).length, 2);
    assert.deepEqual(buildLeagueNorthRankRowViews([], awards), []);
});

test('C11 parseNorthTaskUnionRows：只留 `subType` 2/3（1 档是 P5 的任务）', () => {
    const rows = parseNorthTaskUnionRows({
        k: ['resId', 'subType', 'targetType', 'param', 'reward', 'name', 'goto'],
        v: [
            [502001, 2, 0, { count: 100 }, [{ number: 100, resId: 11 }], '联盟今日造成{count}伤害', 0],
            [501001, 1, 0, { count: 1 }, [], '联盟任务', 1],
            [503001, 3, 0, { count: 20 }, [{ number: 100, resId: 11 }], '个人今日造成{count}伤害', 0],
            ['bad', 2, 0, { count: 1 }, [], '脏行', 0],
        ],
    });
    assert.deepEqual(rows.map((r) => r.resId), [502001, 503001]);
    assert.equal(rows[0].targetCount, 100);
});

test('C12 buildLeagueNorthRewardRowView(s)：标题替换 / 进度百分比 / 三态 / 显式排序', () => {
    // 有进度：now=50 / max=100 ⇒ 50%
    const half = buildLeagueNorthRewardRowView(rewardRow(), { resId: 502001, count: 50, rewardState: 0 });
    assert.equal(half.nameText, '联盟今日造成100伤害');
    assert.equal(half.now, 50);
    assert.equal(half.maxValue, 100);
    assert.equal(half.progress, 50);
    assert.equal(half.state, 'undone');
    assert.equal(half.reward?.resId, 11);
    // `rewardState` 1 ⇒ 可领 / 2 ⇒ 已领
    assert.equal(buildLeagueNorthRewardRowView(rewardRow(), { resId: 502001, count: 100, rewardState: 1 }).state, 'canReward');
    assert.equal(buildLeagueNorthRewardRowView(rewardRow(), { resId: 502001, count: 100, rewardState: 2 }).state, 'rewarded');
    // 没有 VO ⇒ undone / now 0
    const none = buildLeagueNorthRewardRowView(rewardRow(), null);
    assert.equal(none.state, 'undone');
    assert.equal(none.now, 0);
    // 分母 0 ⇒ 进度 0（老端会得到 Infinity）
    const zero = buildLeagueNorthRewardRowView(rewardRow({ targetCount: 0 }), { resId: 502001, count: 5, rewardState: 0 });
    assert.equal(zero.progress, 0);
    // 批量：显式排序 = 可领在前 / 已领在后 / 其余保序
    const rows = [rewardRow({ resId: 1 }), rewardRow({ resId: 2 }), rewardRow({ resId: 3 }), rewardRow({ resId: 4 })];
    const cmds = [
        { resId: 1, count: 0, rewardState: 0 },
        { resId: 2, count: 0, rewardState: 1 },
        { resId: 3, count: 0, rewardState: 2 },
        { resId: 4, count: 0, rewardState: 1 },
    ];
    assert.deepEqual(buildLeagueNorthRewardRowViews(rows, cmds).map((v) => v.resId), [2, 4, 1, 3]);
    assert.deepEqual(buildLeagueNorthRewardRowViews(rows, null).map((v) => v.resId), [1, 2, 3, 4]);
});

test('C13 northRewardRowsOf：两档各过滤（不是一次全过滤 + 切换显示）', () => {
    const rows = [
        rewardRow({ resId: 1, subType: 2 }), rewardRow({ resId: 2, subType: 3 }),
        rewardRow({ resId: 3, subType: 2 }), rewardRow({ resId: 4, subType: 3 }),
    ];
    assert.deepEqual(northRewardRowsOf(rows, 'league').map((r) => r.resId), [1, 3]);
    assert.deepEqual(northRewardRowsOf(rows, 'role').map((r) => r.resId), [2, 4]);
});

test('C14 ⚠️ 三条红点判据：挑战（活动不存在 ⇒ 不亮）/ 奖励 / 并集', () => {
    const rows = [rewardRow({ resId: 1, subType: 2 }), rewardRow({ resId: 2, subType: 3 })];
    // 挑战：Σ(我的 times) < 上限
    const actWithInfos = act({ infos: [{ roleId: '5', times: 1, value: 0 }] });
    assert.equal(hasLeagueNorthChallengeRedDot(actWithInfos, '5', 2), true, '1 < 2 ⇒ 亮');
    assert.equal(hasLeagueNorthChallengeRedDot(actWithInfos, '5', 1), false, '1 不小于 1 ⇒ 灭');
    assert.equal(hasLeagueNorthChallengeRedDot(actWithInfos, '9', 2), true, '我没有记录 ⇒ 0 < 2 ⇒ 亮');
    // ⚠️ 活动不存在 ⇒ 恒灭（老端 `if (!act) return false`）——
    //    没有这道闸的话 `times=0 < 上限` 会**恒亮**，那是错的。
    assert.equal(hasLeagueNorthChallengeRedDot(null, '5', 2), false);
    // 反证：**有**活动、只是我还没打过（infos 里没有我那条）⇒ 仍算亮（0 < 2）
    assert.equal(hasLeagueNorthChallengeRedDot(act({ infos: [] }), '5', 2), true,
        '有活动时「我没记录」= 0 次 ⇒ 亮（只有 `act === null` 才灭）');
    // 奖励：两档任一有可领
    assert.equal(hasLeagueNorthRewardRedDot(rows, [{ resId: 2, count: 0, rewardState: 1 }], 'league'), false);
    assert.equal(hasLeagueNorthRewardRedDot(rows, [{ resId: 1, count: 0, rewardState: 1 }], 'league'), true);
    assert.equal(hasLeagueNorthRewardRedDot(rows, [{ resId: 2, count: 0, rewardState: 1 }], 'role'), true);
    // 并集
    assert.equal(hasLeagueNorthRedDot(actWithInfos, '5', 2, rows, []), true);
    assert.equal(hasLeagueNorthRedDot(null, '5', 2, rows, []), false);
    assert.equal(hasLeagueNorthRedDot(act({ infos: [{ roleId: '5', times: 9, value: 0 }] }), '5', 2, rows, []), false);
});

test('C15 三条数值化：`leagueNorthBuffText` / `leagueNorthTimesText` / 两个倒计时', () => {
    // 攻击加成 = `攻击` + 数字（裸拼，**无加号**）
    assert.equal(leagueNorthBuffText(CFG, 3), '攻击30');
    assert.equal(leagueNorthBuffText(CFG, 0), '攻击0');
    assert.equal(leagueNorthBuffText(CFG, -5), '攻击0', '负数按 0 算');
    // ⚠️ `mL.json` id=423 `ATTR_ATTACK` = `攻击`（**没有**加号）
    assert.ok(!leagueNorthBuffText(CFG, 3).includes('+'));
    // 挑战次数 = `挑战次数:`（**半角冒号**）+ 剩余/上限
    assert.equal(leagueNorthTimesText(CFG, 0), '挑战次数:2/2');
    assert.equal(leagueNorthTimesText(CFG, 1), '挑战次数:1/2');
    assert.equal(leagueNorthTimesText(CFG, 5), '挑战次数:0/2', '超额也钳到 0');
    assert.ok(leagueNorthTimesText(CFG, 0).includes('挑战次数:'), '冒号是半角（逐字取自 mL.json id=445）');

    // buff 剩余秒：`addBuffTime + buffHours*3600*1000` 为截止时刻
    const startMs = 1_700_000_000_000;
    assert.equal(leagueNorthBuffRemainSec(CFG, startMs, startMs), 3 * 3600);
    assert.equal(leagueNorthBuffRemainSec(CFG, startMs, startMs + 3 * 3600 * 1000), 0);
    assert.equal(leagueNorthBuffRemainSec(CFG, startMs, startMs + 99 * 3600 * 1000), 0, '过期钳到 0');
    // 活动剩余秒：`resetTimeSec + 86400` 为截止时刻（⚠️ 别把 *1000 也抄过来）
    assert.equal(leagueNorthResetRemainSec(1_700_000_000, 1_700_000_000 * 1000), 86400);
    assert.equal(leagueNorthResetRemainSec(1_700_000_000, (1_700_000_000 + 86400) * 1000), 0);
    assert.equal(leagueNorthResetRemainSec(1_700_000_000, (1_700_000_000 + 99999) * 1000), 0);
    // HH:MM:SS（四段补零，输出恒三段）
    assert.equal(leagueNorthHms(0), '00:00:00');
    assert.equal(leagueNorthHms(59), '00:00:59');
    assert.equal(leagueNorthHms(3600), '01:00:00');
    assert.equal(leagueNorthHms(3661), '01:01:01');
    assert.equal(leagueNorthHms(-5), '00:00:00');
    assert.equal(leagueNorthHms(Number.NaN), '00:00:00');
});

test('C16 真表探针：`taskUnion` 33 行 = 1→8 / 2→20 / 3→5', () => {
    const raw = JSON.parse(readFileSync(TASK_UNION_JSON, 'utf8'));
    const north = parseNorthTaskUnionRows(raw);
    assert.equal(north.length, 25, '2 档 20 + 3 档 5 = 25（变了先回头看 taskUnion.json）');
    assert.deepEqual(northRewardRowsOf(north, 'league').length, 20);
    assert.deepEqual(northRewardRowsOf(north, 'role').length, 5);
    for (const row of north) {
        assert.ok(row.targetCount > 0, `${row.resId} 的 param.count 应为正数`);
        assert.ok(row.name.includes('{count}'), `${row.resId} 的标题模板应含 {count}`);
        assert.ok(row.subType === 2 || row.subType === 3);
    }
    // 标题里不该残留 `{count}`（视图模型负责替换）
    for (const view of buildLeagueNorthRewardRowViews(northRewardRowsOf(north, 'league'), null)) {
        assert.ok(!view.nameText.includes('{count}'), `标题没替换干净：${view.nameText}`);
    }
});

test('C17 真表探针：`bfUnionRankAward` 5 行覆盖 1 / 2 / 3 / 4-10 / 11-99', () => {
    const awards = parseUnionRankAwardRows(JSON.parse(readFileSync(RANK_AWARD_JSON, 'utf8')));
    assert.equal(awards.length, 5);
    assert.deepEqual(awards.map((a) => [a.minRank, a.maxRank]), [[1, 1], [2, 2], [3, 3], [4, 10], [11, 99]]);
    assert.equal(leagueRankRewardOf(awards, 1)?.id, 1);
    assert.equal(leagueRankRewardOf(awards, 3)?.id, 3);
    assert.equal(leagueRankRewardOf(awards, 99)?.id, 5);
    assert.equal(leagueRankRewardOf(awards, 100), null, '99 名之后没有奖励区间');
    // 每档恰好两件奖励（面板上是两颗物品框）
    for (const award of awards) assert.equal(award.reward.length, 2, `id=${award.id} 应有两件奖励`);
});

test('C18 真表探针：`guankaReward` 1632 行里恰好 10 关带 `tlBoss`，且都能查到 monster', () => {
    const guanKa = parseLeagueGuanKaRows(JSON.parse(readFileSync(GUANKA_JSON, 'utf8')));
    assert.equal(guanKa.length, 1632, '`guankaReward` 全表都留（解析层不按 tlBoss 过滤）');
    const withBoss = guanKa.filter((g) => g.bossId > 0);
    assert.equal(withBoss.length, 10, '带 tlBoss 的关数变了？');
    assert.deepEqual(withBoss.map((g) => g.level),
        [40001, 40002, 40003, 40004, 40005, 90001, 90002, 90003, 90004, 90005]);
    const monsters = parseLeagueMonsterRows(JSON.parse(readFileSync(MONSTER_JSON, 'utf8')));
    assert.equal(monsters.length, 152, 'monster 表行数变了？');
    // 五只 boss（62001~62005）逐只反查得到
    for (const level of [40001, 40002, 40003, 40004, 40005]) {
        const boss = leagueNorthBossOf(guanKa, monsters, level);
        assert.ok(boss, `level=${level} 反查不到 boss`);
        assert.ok(boss!.name.length > 0, `level=${level} 的 boss 名为空`);
        assert.ok(boss!.model.startsWith('塔防_怪物_'), `level=${level} 的 model 意外：${boss!.model}`);
    }
    // 非 boss 关（10001）⇒ null（那条路径要能安静地不显示名字）
    assert.equal(leagueNorthBossOf(guanKa, monsters, 10001), null);
    assert.equal(leagueNorthBossOf(guanKa, monsters, 40001)?.name, '深渊领主');
    assert.equal(leagueNorthBossOf(guanKa, monsters, 90001)?.name, '黑曜石魔像');
});

// ============================================================
// E. 页面逻辑 / 调用约定（源码文本层）
// ============================================================

test('E1 三个主脚本：是 PopupBase、prefabPath 大小写正确、标题取常量', () => {
    for (const [path, prefab, title] of [
        [PAGE_TS, 'LeagueNorthExpedition', '北伐中原'],
        [RANK_PAGE_TS, 'LeagueNorthRank', '排名'],
        [REWARD_PAGE_TS, 'LeagueNorthReward', '联合战线奖励'],
    ] as const) {
        const code = readFileSync(path, 'utf8');
        assert.ok(code.includes('extends PopupBase'), `${path} 应继承 PopupBase`);
        assert.ok(code.includes(`static prefabPath = 'ui/League/${prefab}'`),
            `${path} 的 prefabPath 应写死为 ui/League/${prefab}（真机 zip 路径大小写敏感）`);
        assert.ok(code.includes('static get titleText()'), `${path} 应暴露静态标题`);
        assert.ok(code.includes(title), `${path} 的标题应取常量（${title}）`);
    }
});

test('E2 主面板：进面板先发 `requestActList(NORTHERN_EXPEDITION)` 再读数', () => {
    const code = readFileSync(PAGE_TS, 'utf8');
    const req = code.indexOf('requestActList(LeagueACT_TYPE.NORTHERN_EXPEDITION');
    const load = code.indexOf('await this.reload()');
    assert.ok(req > 0, '缺 requestActList(NORTHERN_EXPEDITION)');
    assert.ok(load > req, '应先发活动列表请求、再 reload 读缓存');
    assert.ok(code.includes('this.repository.loadNorthExpedition()'), '应通过 loadNorthExpedition() 取数');
});

test('E3 主面板三颗按钮的闸：擂鼓判 `todayDrumTimes`、扫荡/挑战先判开放时段', () => {
    const code = readFileSync(PAGE_TS, 'utf8');
    // ⚠️ 擂鼓判据是 `todayDrumTimes`（服务端已用次数），不是 selfTimes
    assert.ok(code.includes('snapshot.todayDrumTimes'), '擂鼓要判 todayDrumTimes');
    assert.ok(!/const used = snapshot\.selfTimes/.test(code), '别拿 selfTimes 当擂鼓次数');
    assert.ok(/snapshot\.todayDrumTimes >= snapshot\.config\.drumMaxCount/.test(code), '擂鼓上限判据要写对');
    assert.ok(code.includes('LEAGUE_NORTH_DRUM_LIMIT'), '次数用尽要提示');
    // 扫荡 / 挑战都要过开放时段闸
    const gates = code.match(/if \(!this\.ensureOpen\(\)\) return;/g) ?? [];
    assert.equal(gates.length, 2, `扫荡 / 挑战各一道开放时段闸，实得 ${gates.length} 处`);
    assert.ok(/isLeagueNorthOpen\(new Date\(\)\.getHours\(\), snapshot\.config\)/.test(code),
        '开放时段判据要取本地小时');
    assert.ok(code.includes('leagueNorthOpenHourText(snapshot.config)'), '未开放提示要填起止小时');
    // 挑战：PVE 副本战斗本端未接入 ⇒ 弹北境说明、不伪造战斗、不发包
    assert.ok(code.includes('openLeagueHelp') && code.includes('LEAGUE_NORTH_HELP_ID'),
        '「挑战」应弹北境帮助说明（PVE 未接入），不伪造战斗');
    // 帮助：本端用 openLeagueHelp 弹静态帮助
    assert.ok(code.includes('openLeagueHelp(LEAGUE_NORTH_HELP_ID)'),
        '北境帮助按钮应打开 leaguefb01 帮助');
    // 两个写操作（擂鼓 / 扫荡）各过防连点门并 finally 复位
    assert.equal((code.match(/if \(!this\.beginWrite\(\)\) return;/g) ?? []).length, 2);
    assert.equal((code.match(/this\.busy = false;/g) ?? []).length, 2);
});

test('E4 主面板：两个入口各开一个子页 + 每秒刷时间（`schedule` / `unschedule` 配对）', () => {
    const code = readFileSync(PAGE_TS, 'utf8');
    assert.ok(code.includes('LeagueNorthRankPage.open({})'), 'RankBtn 应开排行页');
    assert.ok(code.includes('LeagueNorthRewardPage.open({})'), 'RewardBtn 应开奖励页');
    // 老端 `toolSet.addTimer(1000, …)` ⇒ 本端 schedule(…, 1)
    assert.ok(/this\.schedule\(this\.tick, 1\)/.test(code), '时间行每秒刷');
    assert.ok(/this\.unschedule\(this\.tick\)/.test(code), 'onClose 要注销定时器');
    // 刻度函数必须是箭头字段（schedule/unschedule 靠同一引用配对）
    assert.ok(/private readonly tick = \(\): void =>/.test(code), 'tick 要用箭头字段');
    // 两行时间都由 LeagueTable 的纯函数算
    assert.ok(code.includes('leagueNorthBuffRemainSec(snapshot.config, snapshot.act.addBuffTimeMs, now)'));
    assert.ok(code.includes('leagueNorthResetRemainSec(snapshot.act.resetTimeSec, now)'));
    assert.ok(code.includes('leagueNorthHms('));
});

test('E5 排行页：唯一「请求-响应」式；`!ok` 保留上一趟 + 提示，不清空', () => {
    const code = readFileSync(RANK_PAGE_TS, 'utf8');
    assert.ok(code.includes('this.repository.loadNorthRank(tab, this)'), '应按页签发 loadNorthRank');
    assert.ok(/if \(snapshot\.ok\)/.test(code), '成功后才换列表');
    assert.ok(code.includes('LEAGUE_TIP_FAILED'), '失败要提示，不能静默');
    // `!ok` 分支里不许出现「把 rows 清空」
    const fail = code.slice(code.indexOf('} else {'), code.indexOf('this.refreshList();'));
    assert.ok(!/this\.rows = \[\]/.test(fail), '失败时不该把列表清空（那会看着像「没人上榜」）');
    // 页签切换要作废在飞的响应
    assert.ok(code.includes('revision !== this.revision'), 'response 回来时要校验 revision');
    // 两页签底图 + 表头随页签切
    assert.ok(code.includes('this.headerRank.active = this.tab === '), '结盟排名表头要随页签显隐');
    assert.ok(code.includes('this.headerProgress.active = this.tab === '), '盟内进度表头要随页签显隐');
    assert.ok(code.includes('hero.render(this.myRow, this.tab, this.art, false)'),
        '我的那一行不画行底框（showBackground=false）');
    assert.ok(code.includes('this.heroItem.getComponent(LeagueNorthRankRow)'),
        'HeroItem 是嵌套实例 ⇒ 绑节点、运行时 getComponent（同 P5 宝箱）');
    assert.ok(code.includes('this.myBg.active = visible'), '没有 myRank 时整块藏掉（老端这里会抛）');
});

test('E6 奖励页：切页签**不发包**（两档一次读全），领奖走 `requestTaskReward`', () => {
    const code = readFileSync(REWARD_PAGE_TS, 'utf8');
    assert.ok(code.includes('this.repository.loadNorthReward()'), '应通过 loadNorthReward() 取数');
    // 切页签只是换数组，不重新请求
    const onTab = code.slice(code.indexOf('private onTabClick('), code.indexOf('private applyTabPage('));
    assert.ok(!/loadNorthReward|repository\./.test(onTab), '切页签不该再发请求（两档一次读全）');
    assert.ok(onTab.includes('this.presentRows()'), '切页签要重铺列表');
    // 领奖
    assert.ok(code.includes('this.repository.requestTaskReward(view.resId, this)'), '点「领取」应发领奖请求');
    assert.ok(/if \(this\.busy\) return;/.test(code), '领奖要防连点');
    // 页签红点
    // ⚠️ 页签是**嵌套实例** ⇒ `tabLeague`/`tabRole` 这两个 `@property` 绑的是 **Node 壳**，
    //    红点只能打在运行时 `getComponent` 取到的脚本 ref 上；写成
    //    `this.tabLeague.setRedDot(...)` 根本编译不过（`cc.Node` 上没有这方法）。
    //    所以这里断言的是 `…Ref` 口径，并反向守住「别把红点打到壳上」。
    assert.ok(code.includes('this.tabLeagueRef.setRedDot('), '联盟奖励页签要有红点');
    assert.ok(code.includes('this.tabRoleRef.setRedDot('), '个人奖励页签要有红点');
    assert.ok(!/this\.tabLeague\.setRedDot\(/.test(code), '别把红点打到 Node 壳上');
    // 红点来源 = 仓库快照的两个**独立**字段（`hasLeagueNorthRewardRedDot()` 按 subType 各算各的）
    assert.ok(code.includes('this.snapshot?.leagueRedDot'), '联盟页签红点取 leagueRedDot');
    assert.ok(code.includes('this.snapshot?.roleRedDot'), '个人页签红点取 roleRedDot');
    // 选中态同源同口径（也是打在 ref 上）
    assert.ok(code.includes("this.tabLeagueRef.setSelected(this.tab === 'league')"), '联盟页签的选中态');
    assert.ok(code.includes("this.tabRoleRef.setSelected(this.tab === 'role')"), '个人页签的选中态');
});

test('E7 三个列表页：都等 `nextPopupFrame()` 再 refreshList（否则虚拟列表槽位还没建）', () => {
    for (const [path, listName] of [
        [RANK_PAGE_TS, 'this.rankList.refreshList('],
        [REWARD_PAGE_TS, 'this.rewardList.refreshList('],
    ] as const) {
        const code = readFileSync(path, 'utf8');
        const frame = code.indexOf('await this.nextPopupFrame();');
        const refresh = code.indexOf(listName);
        assert.ok(frame > 0, `${path} 缺 await this.nextPopupFrame()`);
        assert.ok(refresh > frame, `${path} 的 refreshList 必须晚于 defer 一帧`);
        assert.ok(code.includes('.scrollToTop(false)'), `${path} 铺完应回到顶部`);
        assert.ok(/if \(!this\.rendererBound\)/.test(code), `${path} 的 renderItemFn 绑定要幂等`);
    }
});

test('E8 行 / 页签组件：`LeagueNorthTab` 两态绝对赋值、行脚本不改 `interactable`', () => {
    const tab = readFileSync(TAB_TS, 'utf8');
    // 底图 + 字色 + 描边 + 红点一次性绝对赋值
    assert.ok(/const frame = this\.selected \? this\.frames\.selected : this\.frames\.normal;/.test(tab),
        '底图按 selected 二选一');
    assert.ok(tab.includes('LEAGUE_ART_NORTH_TAB_TEXT_SELECTED') && tab.includes('LEAGUE_ART_NORTH_TAB_TEXT_NORMAL'),
        '字色两态都要切（只换底图会被看成两个都选中）');
    assert.ok(tab.includes('LEAGUE_ART_NORTH_TAB_TEXT_STROKE'), '描边也要随态切');
    assert.ok(/dot\.setRedDot\(this\.dotOn \? 1 : 0\)/.test(tab), '红点走 setRedDot');

    const rewardRow = readFileSync(REWARD_ROW_TS, 'utf8');
    // ⚠️ 只查**赋值**、不查裸词：脚本的文档注释里**故意**写了 `interactable` 来记录根因
    //    （块注释里的行不以 `//` 开头，剥不掉）。
    assert.ok(!/\.interactable\s*=/.test(rewardRow), '置灰只染 color（FGUI grayed 仍可点）');
    assert.ok(/const NORTH_ROW_PROGRESS_FULL_WIDTH = 156;/.test(rewardRow), '进度条满宽 = 637/652×160 ≈ 156');
    assert.ok(/this\.claimLabel\.string = claimable \? LEAGUE_NORTH_REWARD_BTN_CLAIM : LEAGUE_NORTH_REWARD_BTN_UNDONE/.test(rewardRow),
        '按钮文案要按「可领 / 未完成」两态切');
    assert.ok(/if \(view\.state !== 'canReward'\) return;/.test(rewardRow), '不可领时不许发包');

    const rankRow = readFileSync(RANK_ROW_TS, 'utf8');
    assert.ok(/const ranked = view\.rank > 0;/.test(rankRow), '名次 > 0 才算上榜');
    assert.ok(rankRow.includes('LEAGUE_NORTH_RANK_UNRANKED'));
    // 行底框由宿主给的 showBackground 决定（不从节点树猜）
    assert.ok(rankRow.includes('this.rowBg.node.active = showBackground'));
});

test('E9 主面板 onDestroy / 页脚本：不许在销毁期碰已销毁的子节点（同 `LeagueTaskBox`）', () => {
    for (const path of [PAGE_TS, RANK_PAGE_TS, REWARD_PAGE_TS]) {
        const code = readFileSync(path, 'utf8');
        const m = /onDestroy\(\): void \{([\s\S]*?)\n    \}/.exec(code);
        assert.ok(m, `${path} 缺 onDestroy`);
        const body = m![1].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        assert.ok(!body.includes('getComponent'), `${path} 的 onDestroy 里不许 getComponent`);
        assert.ok(!/\.off\(/.test(body), `${path} 的 onDestroy 里不许手动 off()`);
    }
});

test('E10 入口接线：`BtnFight` 已落 + 分发到 LeagueNorthExpeditionPage + 红点来源 `north`', () => {
    const btnFight = LEAGUE_ENTRANCES.find((e) => e.node === 'BtnFight');
    assert.ok(btnFight, '入口表里没有 BtnFight');
    assert.equal(btnFight!.key, 'LayerLeagueNorthernExpedition');
    assert.equal(btnFight!.landed, true, 'P6 起 BtnFight 应已落地');
    assert.equal(LEAGUE_ENTRANCE_RED_DOT_SOURCE.LayerLeagueNorthernExpedition, 'north', '北伐入口红点要接真判据');

    const page = readFileSync(LEAGUE_PAGE_TS, 'utf8');
    assert.ok(/case 'LayerLeagueNorthernExpedition':[\s\S]{0,200}void LeagueNorthExpeditionPage\.open\(/.test(page),
        '入口要分发到 LeagueNorthExpeditionPage.open');
    assert.ok(/import \{ LeagueNorthExpeditionPage \} from '\.\/LeagueNorthExpeditionPage';/.test(page),
        '缺 LeagueNorthExpeditionPage 的 import');
    assert.ok(/case 'north': return dots\.north;/.test(page), '红点映射函数要认 north 来源');
});

test('E11 LeagueRepository：北伐快照的取数与两种请求通道', () => {
    const repo = readFileSync(REPO_TS, 'utf8');
    // 三个只读取数
    for (const need of ['async loadNorthExpedition()', 'async loadNorthReward()', 'async loadNorthRank(']) {
        assert.ok(repo.includes(need), `缺 ${need}`);
    }
    // 主面板快照要带 todayDrumTimes（擂鼓判据）
    const at = repo.indexOf('async loadNorthExpedition()');
    const body = repo.slice(at, repo.indexOf('\n    }', at));
    assert.ok(body.includes('todayDrumTimes'), 'loadNorthExpedition 要带 todayDrumTimes');
    assert.ok(body.includes('readMyRoleUnionRow'), 'todayDrumTimes 从 CmdRoleUnion 取');
    assert.ok(body.includes('leagueNorthTimesText(') && body.includes('leagueNorthBuffText('));
    assert.ok(body.includes('hasLeagueNorthRedDot(') || body.includes('rewardRedDot'));
    assert.ok(body.includes('leagueNorthBossOf('), 'boss 三级反查要在取数层做');
    // 排行：唯一走「拿响应」的通道
    assert.ok(/private requestRsp</.test(repo), '排行要有一等响应通道 requestRsp');
    assert.ok(repo.includes('new RequestGetRank('), '排行应发 RequestGetRank');
    assert.ok(/unionId: readSelfRoleId\(\)/.test(repo), '⚠️ 排行请求体的 unionId 填**角色 id**');
    // 两个写请求
    assert.ok(repo.includes('new RequestUnionActDrum(') && repo.includes('new RequestUnionActSweep('));
    assert.ok(/RequestUnionActDrum\(\{ type: LeagueACT_TYPE\.NORTHERN_EXPEDITION \}/.test(repo), '擂鼓请求体 type=2');
    // 入口红点 north 分支（跨行写法：`north: joined` 换行再接 `&& hasLeagueNorthRedDot(`）
    assert.ok(/north:\s*joined\s*&&\s*hasLeagueNorthRedDot\(/.test(repo), '入口红点 north 分支要带「已入盟」闸');
    // 「已入盟」闸的理由同 P4/P5：老端 `RDLeague.OnComputeResult()` 第一句就是 `if (!IsJoinedLeague()) return 0`
    assert.ok(/joined && hasLeagueNorthRedDot\(|north:\s*joined/.test(repo));
});

// ============================================================
// D. prefab 结构 + 几何（6 张 prefab）
// ============================================================

const PREFAB_DIR = 'assets/resources/ui/League';
/** 1. 页签（`组件_联盟_页签`，207×105） */
const TAB_PREFAB = `${PREFAB_DIR}/LeagueNorthTab.prefab`;
/** 2. 排行行（`组件_联盟_北伐中原_排行Item`，550×130） */
const RANK_ROW_PREFAB = `${PREFAB_DIR}/LeagueNorthRankRow.prefab`;
/** 3. 奖励行（`组件_联盟_北伐中原_奖励Item`，550×160） */
const REWARD_ROW_PREFAB = `${PREFAB_DIR}/LeagueNorthRewardRow.prefab`;
/** 4. 主面板（`组件_联盟_北伐中原`，整屏 720×1280） */
const MAIN_PREFAB = `${PREFAB_DIR}/LeagueNorthExpedition.prefab`;
/** 5. 排行弹窗（`组件_联盟_北伐中原_排行`） */
const RANK_PREFAB = `${PREFAB_DIR}/LeagueNorthRank.prefab`;
/** 6. 奖励弹窗（`组件_联盟_北伐中原_奖励`） */
const REWARD_PREFAB = `${PREFAB_DIR}/LeagueNorthReward.prefab`;
const RED_DOT_PREFAB = 'assets/resources/ui/common/RedDot.prefab';
const SLOT_TS = 'assets/script/app/league/LeagueRewardSlot.ts';
const VSCROLL_TS = 'assets/script/vscrollview/VScrollView.ts';

/** `cc.Node._layer` 的 UI_2D（`Layers.Enum.UI_2D`）。 */
const UI_2D = 33554432;

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

/**
 * 本组 prefab 用到的图 → `spriteFrame` uuid（`<顶层uuid>@f9941`）。
 *
 * ⚠️ 这张表**不手抄**：`D0` 会把每个 uuid 拿回 `assets/resources/image/**` 对号
 *    （文件名必须与图名一致）—— 图换了 / 名字拼错 / 表过期，D0 立刻红，
 *    而不是等到某个 `assertSprites` 给出一个看不懂的 uuid diff。
 */
const U: Readonly<Record<string, string>> = {
    // 页签两态底图
    TY_btn23: 'ab3d4c52-d694-4b26-8e55-daec483290f2@f9941',
    TY_btn20: '55afd73b-2bfd-43fa-b91a-9e5b2a6b2751@f9941',
    // 行底框 / 属地板 / 两块小底板（都是大厅那套 frame_Zhikuang*）
    frame_Zhikuang01: 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941',
    frame_Zhikuang04: 'a22d22a0-bbb8-4a17-be83-63764afd1662@f9941',
    frame_Zhikuang05: '1294f020-2331-4758-a112-494654974d0d@f9941',
    // 行标题衬底 / 表头底条
    BB_img03: 'e7dd22cc-dc8b-4cb8-92b1-b1c6ac085db3@f9941',
    // 物品框品质底（静态兜底 1 档；其余档运行时换图）
    common_img_pzk_01: '0f3d4145-0e38-4010-9a5a-b72eb2ad483b@f9941',
    // 头像框（⚠️ 用 gameui 那份，不是 image/league 里的同名图）
    img_Touxiang_01: 'f11d3299-6f25-4a3d-a32e-71cfb500d9be@f9941',
    // 战力条底衬 + 条头
    bb_pic11: '9c2c065a-6ba7-4329-8a3e-2f3dc57ef033@f9941',
    bb_pic13: '066f0c45-16a8-4fae-8f0b-28aa89425e17@f9941',
    // 进度条（底九宫格 / 填充靠改宽度）
    bar_bg_01: '443fa078-9ba5-42c8-a2bc-77e75125a70f@f9941',
    bar_bg_01_hong: '3da2c83a-3976-4d13-95a0-3cef532cb52e@f9941',
    // 「已领取」印章
    公用_图标_已领取: 'd4543a98-1c4e-44ac-9993-0bf5cafc72ff@f9941',
    // 主面板骨架
    lm_bg03: 'b154f463-d193-4d57-83a0-6358178aab9f@f9941',
    zg_pic02: '72734013-c67a-43ca-8769-6cad7c865f70@f9941',
    zg_pic03: '689faa78-760a-4c5a-b0f2-290680e7cf17@f9941',
    panel_window_02_9gong: '34749ccd-f624-4b0c-bc0d-3f9c617af574@f9941',
    frame_01_9gong: '01e77661-6b59-4238-a493-0177016f71a1@f9941',
    zx_btn01: 'aed42e26-d9f4-4985-a6d3-fbc985c1a71b@f9941',
    TY_btn07: '0f92b28c-0dc5-49fe-b839-8fe1bdd20a37@f9941',
    TY_btn24: 'e9e34bdf-0a43-4854-9a7b-bccd2596b5e1@f9941',
    diban_BG: '9f8dde9a-b493-4c50-bf04-a6d220683183@f9941',
    btn_FanHui: 'f5b84274-a67d-4d78-b14d-9336ee6a8b34@f9941',
    // 左侧两个入口图标
    jl: '34ff3110-7d4d-4813-af85-410be95b8b68@f9941',
    ph: '381b93a0-63a4-4d26-bcbd-ac31f2d96b65@f9941',
    // 公共弹窗骨架（与 P2~P5 面板同一套）
    panel_window_01_9gong: 'a295d231-ef9a-4bea-9818-0e0d85794ef0@f9941',
    title_01: 'de242388-9444-451f-adff-78fe5a73e20d@f9941',
    title_02: 'a957fd35-0792-4a27-9de3-85a44274a5d0@f9941',
    btn_close: 'ca6d0ca8-3ed8-4009-963d-d845eb296872@f9941',
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
 *    `HeroItem` 读成 `pos(0,0)`。
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

const tabDoc = lazyDoc(TAB_PREFAB);
const rankRowDoc = lazyDoc(RANK_ROW_PREFAB);
const rewardRowDoc = lazyDoc(REWARD_ROW_PREFAB);
const mainDoc = lazyDoc(MAIN_PREFAB);
const rankPopDoc = lazyDoc(RANK_PREFAB);
const rewardPopDoc = lazyDoc(REWARD_PREFAB);

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

const RANK_ROW = 'RankList/content/RankRow';
const REWARD_ROW = 'RewardList/content/RewardRow';

test('D0 `U` 表守卫：每个 uuid 都能在 `assets/resources/image` 里对上号，且文件名 = 图名', () => {
    const byUuid = new Map<string, string>();
    const walk = (dir: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name === '.svn') continue;
            const p = `${dir}/${e.name}`;
            if (e.isDirectory()) { walk(p); continue; }
            if (!/\.(png|jpg)\.meta$/.test(e.name)) continue;
            const uuid = (JSON.parse(readFileSync(p, 'utf8')) as { uuid?: string }).uuid;
            if (uuid) byUuid.set(uuid, e.name.replace(/\.(png|jpg)\.meta$/, ''));
        }
    };
    walk('assets/resources/image');
    assert.ok(byUuid.size > 300, `图片索引只找到 ${byUuid.size} 张 —— 路径不对？`);
    for (const [art, sf] of Object.entries(U)) {
        const uuid = sf.replace(/@f9941$/, '');
        const file = byUuid.get(uuid);
        assert.ok(file, `U['${art}'] 的 uuid（${uuid}）在 assets/resources/image 里找不到 —— 图换了或表过期`);
        assert.equal(file, art, `U['${art}'] 指向的文件是「${file}」，与图名不一致`);
    }
});

test('D1 六张 prefab + 六份 `.ts.meta` 在磁盘上；三张**叶子组件**的根尺寸 = FGUI 原生尺寸', () => {
    for (const p of [TAB_PREFAB, RANK_ROW_PREFAB, REWARD_ROW_PREFAB, MAIN_PREFAB, RANK_PREFAB, REWARD_PREFAB]) {
        assert.ok(existsSync(p), `缺 prefab：${p}`);
        assert.ok(existsSync(`${p}.meta`), `缺 meta：${p}.meta`);
    }
    for (const ts of [PAGE_TS, RANK_PAGE_TS, REWARD_PAGE_TS, RANK_ROW_TS, REWARD_ROW_TS, TAB_TS]) {
        assert.ok(existsSync(ts), `缺脚本：${ts}`);
        assert.ok(existsSync(`${ts}.meta`), `缺 .ts.meta：${ts}.meta（编辑器不会给未 refresh 的新 .ts 生成）`);
    }
    assert.ok(existsSync(RED_DOT_PREFAB), '共用红点 prefab 缺失');

    // ⚠️ 根尺寸**不是摆设**（`create` 建出来的根是引擎默认的 100×100，必须自己钉回去）：
    //    ① 两个行 prefab 的根高 = `VScrollView.itemMainSize`（`_initFixedSizeMode` 读
    //       `itemNode` 实例的 `UITransform.height` 算 `stride = itemMainSize + spacing`）
    //       ⇒ 停在 100 会让 130 / 160 高的行**互相压叠**、可视行数也算多；
    //    ② 页签的根 = **点击热区**（`LeagueNorthTab` 根上没有 `cc.Button` ⇒ 走
    //       `Node.TOUCH_END`，而 `UITransform.hitTest` 只认节点**自己**的矩形、不含子节点）
    //       ⇒ 100×100 时 224×79 的底图左右各有一截点不动；
    //    ③ 父 prefab 里的嵌套实例壳**不序列化 `UITransform`** ⇒ 量到的壳尺寸恒为 0，
    //       所以这三条只能在**源 prefab 的根**上查（也是 `setRootSize` 存在的理由）。
    assert.deepEqual([tabDoc.P('')!.w, tabDoc.P('')!.h], [207, 105], 'LeagueNorthTab 根应为 207×105（`组件_联盟_页签` 原生）');
    assert.deepEqual([rankRowDoc.P('')!.w, rankRowDoc.P('')!.h], [550, 130], 'LeagueNorthRankRow 根应为 550×130（`_排行Item` 原生）');
    assert.deepEqual([rewardRowDoc.P('')!.w, rewardRowDoc.P('')!.h], [550, 160], 'LeagueNorthRewardRow 根应为 550×160（`_奖励Item` 原生）');
});

test('D2 ⚠️ 六个 prefab 的坐标里不许出现 `null`（NaN 经 JSON 会变 null，编辑器照收不误）', () => {
    // 起因（2026-09-26）：主面板构建脚本的 `ATTR_TITLE` / `ATTR_VALUE` 两个内联对象漏写了 `y: 0`
    //   ⇒ `ATTR_TOP + undefined + h/2` 是 `NaN` ⇒ `JSON.stringify(NaN)` 是 `null`
    //   ⇒ `node_transform` 照单全收，prefab 里留下 `_lpos.y = null` 的十个节点，
    //   运行时那两列文本会贴在行盒原点（差 0.5px，肉眼看不出来）。
    //   现在两道闸：`tmp/_league_prefab_lib.mjs` 的 `validateSpec` 预检有限数，
    //   这条断言守最后一道（编辑器换版本 / 手改 prefab 都可能重新引入）。
    for (const [doc, tag] of [
        [tabDoc, 'LeagueNorthTab'], [rankRowDoc, 'LeagueNorthRankRow'], [rewardRowDoc, 'LeagueNorthRewardRow'],
        [mainDoc, 'LeagueNorthExpedition'], [rankPopDoc, 'LeagueNorthRank'], [rewardPopDoc, 'LeagueNorthReward'],
    ] as const) {
        const bad: string[] = [];
        for (const e of doc.all) {
            for (const key of ['_lpos', '_lrot', '_lscale', '_euler']) {
                const v = e?.[key] as Record<string, unknown> | undefined;
                if (!v || typeof v !== 'object') continue;
                for (const axis of ['x', 'y', 'z']) {
                    if (axis in v && v[axis] === null) bad.push(`${String(e._name)}.${key}.${axis}`);
                }
            }
        }
        assert.deepEqual(bad, [], `${tag} 有 null 坐标：${bad.join(', ')}`);
    }
});

test('D3 节点树规模 + 根上只挂本页脚本；自定义 cid 集合恰好等于预期（反查 `.ts.meta`，禁手抄）', () => {
    assert.equal(tabDoc.rootName, 'LeagueNorthTab');
    // 4 = 根 + Bg / Title / RedDot
    assert.equal(tabDoc.nodes.length, 4);
    assert.deepEqual([...tabDoc.customCids].sort(), [cidOf(TAB_TS)].sort());

    assert.equal(rankRowDoc.rootName, 'LeagueNorthRankRow');
    // 24 = 根 + RowBg / Rank(Lab,Unranked) / RankFields(LeagueName,LeaguePower,RoleCount,
    //   RewardSlot(Icon,Count),RewardSlot1(Icon,Count)) / ProgressFields(Head(Frame,Icon),
    //   UserName,UserPower,PowerBar,PowerBar2,PowerText)
    assert.equal(rankRowDoc.nodes.length, 24, `LeagueNorthRankRow 节点数变了（实得 ${rankRowDoc.nodes.length}）`);
    assert.deepEqual([...rankRowDoc.customCids].sort(), [cidOf(RANK_ROW_TS), cidOf(SLOT_TS)].sort());

    assert.equal(rewardRowDoc.rootName, 'LeagueNorthRewardRow');
    // 14 = 根 + RowBg / TitleBar / NameLabel / RewardSlot(Icon,Count) / Progress(ProgressBg,
    //   ProgressFill,ProgressLabel) / DoneTag / ClaimBtn(Label)
    assert.equal(rewardRowDoc.nodes.length, 14, `LeagueNorthRewardRow 节点数变了（实得 ${rewardRowDoc.nodes.length}）`);
    assert.deepEqual([...rewardRowDoc.customCids].sort(), [cidOf(REWARD_ROW_TS), cidOf(SLOT_TS)].sort());

    assert.equal(mainDoc.rootName, 'LeagueNorthExpedition');
    // 49 = 根 + 顶层 29 + 五行 10 + 两个物品框 4（Icon/Count ×2）+ 三颗按钮的文案 3
    //   + 红点实例 2（奖励入口 `RewardRedDot` + 挑战按钮 `ChallengeBtn/RedDot`）
    assert.equal(mainDoc.nodes.length, 49, `LeagueNorthExpedition 节点数变了（实得 ${mainDoc.nodes.length}）`);
    assert.deepEqual([...mainDoc.customCids].sort(), [cidOf(PAGE_TS), cidOf(SLOT_TS)].sort());

    assert.equal(rankPopDoc.rootName, 'LeagueNorthRank');
    // 23 = 根 + 顶层 15 + 列表 content 1 + 行模板实例 1 + 表头列 6
    assert.equal(rankPopDoc.nodes.length, 23, `LeagueNorthRank 节点数变了（实得 ${rankPopDoc.nodes.length}）`);
    // ⚠️ 排行页的两颗页签 + 行模板都是**嵌套实例**：它们的脚本组件在**源 prefab** 里
    //    ⇒ 本文件只应有 `VScrollView` + 本页脚本（`LeagueNorthTab` / `LeagueNorthRankRow`
    //    的 cid 一个都不该出现，出现了就说明有人把实例拆成了内联节点）。
    assert.deepEqual([...rankPopDoc.customCids].sort(), [cidOf(RANK_PAGE_TS), cidOf(VSCROLL_TS)].sort());

    assert.equal(rewardPopDoc.rootName, 'LeagueNorthReward');
    // 11 = 根 + 顶层 8 + 列表 content 1 + 行模板实例 1
    assert.equal(rewardPopDoc.nodes.length, 11, `LeagueNorthReward 节点数变了（实得 ${rewardPopDoc.nodes.length}）`);
    assert.deepEqual([...rewardPopDoc.customCids].sort(), [cidOf(REWARD_PAGE_TS), cidOf(VSCROLL_TS)].sort());
});

test('D4 全 UI_2D（`create` 会把根 layer 重置成 DEFAULT，不报错但整棵不渲染）', () => {
    for (const [doc, tag] of [
        [tabDoc, 'LeagueNorthTab'], [rankRowDoc, 'LeagueNorthRankRow'], [rewardRowDoc, 'LeagueNorthRewardRow'],
        [mainDoc, 'LeagueNorthExpedition'], [rankPopDoc, 'LeagueNorthRank'], [rewardPopDoc, 'LeagueNorthReward'],
    ] as const) {
        // ⚠️ 嵌套实例的壳节点盘上**没有 `_layer`**（层级随源 prefab，`node_transform` 写它会被
        //    静默丢掉、不进 `propertyOverrides`）⇒ 只查真正序列化在本文件里的节点。
        //    同一口径见 `league-task.test.ts` 的 D3。
        const shells = new Set(doc.instances.map((i) => i.shell.node));
        const bad = [...new Set(doc.nodes
            .filter((n) => !shells.has(n))
            .map((n) => n._layer))]
            .filter((l) => l !== UI_2D);
        assert.deepEqual(bad, [], `${tag} 有非 UI_2D 的层：${bad.join(',')}`);
    }
});

test('D5 顶层渲染序（= FGUI `displayList` 序，含几个「反直觉」的相邻关系）', () => {
    const kids = (doc: PrefabDoc): string[] =>
        ((doc.P('')!.node._children ?? []) as unknown[])
            .map((ref) => doc.refPath(ref)!.slice(doc.rootName.length + 1));

    // 页签：底图在文案下面、红点最上
    assert.deepEqual(kids(tabDoc), ['Bg', 'Title', 'RedDot']);
    assert.deepEqual(kids(rankRowDoc), ['RowBg', 'Rank', 'RankFields', 'ProgressFields']);
    assert.deepEqual(kids(rewardRowDoc),
        ['RowBg', 'TitleBar', 'NameLabel', 'RewardSlot', 'Progress', 'DoneTag', 'ClaimBtn']);

    // ⚠️ 主面板里两处「和阅读顺序相反」的：
    //   ① `DailySlot1`（(534,945)）画在 `DailyBg` 之后、`BuffBg` **之前**
    //      —— FGUI displayList 是「底板 → 右格子 → 左头框 → 左格子」，别按坐标排；
    //   ② `RewardRedDot` 在 `EndTimeLabel` 之后（红点压在入口按钮上）。
    assert.deepEqual(kids(mainDoc), [
        'Bg', 'TitleBanner', 'Board', 'InnerFrame', 'BoardTitle', 'AttrBg',
        'Attr0', 'Attr1', 'Attr2', 'Attr3', 'Attr4',
        'DailyBg', 'DailySlot1', 'BuffBg', 'DailySlot0', 'BuffTitle', 'DailyTitle', 'SectionTitle',
        'TimesLabel', 'HelpBtn', 'DrumBtn', 'ChallengeBtn', 'SweepBtn',
        'MonsterLabel', 'EndTimeLabel', 'RewardRedDot', 'RankBtn', 'RewardBtn', 'BottomBg', 'BackBtn',
    ]);

    // 两个弹窗：两页表头组（`HeaderRank` / `HeaderProgress`）垫在最后 —— 它们靠页签切显隐
    assert.deepEqual(kids(rankPopDoc), [
        'PopBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn',
        'HeaderBar', 'RankList', 'MyBg', 'TabRank', 'TabProgress', 'HeroItem',
        'HeaderRankTitle', 'AwardTip', 'HeaderRank', 'HeaderProgress',
    ]);
    assert.deepEqual(kids(rewardPopDoc),
        ['PopBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn', 'RewardList', 'TabLeague', 'TabRole']);
});

test('D6 图 uuid + 九宫格 type：页签 / 两行 / 主面板', () => {
    assertSprites(tabDoc, [['Bg', 'TY_btn23']], 'LeagueNorthTab');
    assertSprites(rankRowDoc, [
        ['RowBg', 'frame_Zhikuang01'],
        ['RankFields/RewardSlot', 'common_img_pzk_01'],
        ['RankFields/RewardSlot/Icon', null],
        ['RankFields/RewardSlot1', 'common_img_pzk_01'],
        ['RankFields/RewardSlot1/Icon', null],
        ['ProgressFields/Head/Frame', 'img_Touxiang_01'],
        ['ProgressFields/Head/Icon', null],
        ['ProgressFields/PowerBar', 'bb_pic11'],
        ['ProgressFields/PowerBar2', 'bb_pic13'],
    ], 'LeagueNorthRankRow');
    assertSprites(rewardRowDoc, [
        ['RowBg', 'frame_Zhikuang01'],
        ['TitleBar', 'BB_img03'],
        ['RewardSlot', 'common_img_pzk_01'],
        ['RewardSlot/Icon', null],
        ['Progress/ProgressBg', 'bar_bg_01'],
        ['Progress/ProgressFill', 'bar_bg_01_hong'],
        ['DoneTag', '公用_图标_已领取'],
        ['ClaimBtn', 'TY_btn07'],
    ], 'LeagueNorthRewardRow');
    assertSprites(mainDoc, [
        ['Bg', 'lm_bg03'],
        ['TitleBanner', 'zg_pic02'],
        ['Board', 'panel_window_02_9gong'],
        ['InnerFrame', 'frame_01_9gong'],
        ['BoardTitle', 'zg_pic03'],
        ['AttrBg', 'frame_Zhikuang04'],
        ['DailyBg', 'frame_Zhikuang05'],
        ['BuffBg', 'frame_Zhikuang05'],
        ['HelpBtn', 'zx_btn01'],
        ['DrumBtn', 'TY_btn07'],
        ['ChallengeBtn', 'TY_btn23'],
        ['SweepBtn', 'TY_btn24'],
        ['RankBtn', 'ph'],
        ['RewardBtn', 'jl'],
        ['BottomBg', 'diban_BG'],
        ['BackBtn', 'btn_FanHui'],
        ['DailySlot0', 'common_img_pzk_01'],
        ['DailySlot0/Icon', null],
        ['DailySlot1', 'common_img_pzk_01'],
        ['DailySlot1/Icon', null],
    ], 'LeagueNorthExpedition');
});

test('D7 页签几何：207×105 里一枚 224×79 的底图（**故意溢出右缘 17px**）+ 30×30 红点', () => {
    assertBoxes(tabDoc, [
        // n4 底图 (0,0) 224×79 ⇒ 中心 (112,39.5) ⇒ 相对组件中心 (103.5,52.5) = (8.5, 13)
        //   ⚠️ 组件只有 207 宽 ⇒ 底图右缘在 +120.5、超出组件右缘 17px。这是 FGUI 原样
        //      （loader 写了 `autoSize="true"`），底图**必须是子节点**、不能挂根上。
        { p: 'Bg', x: 8.5, y: 13, w: 224, h: 79 },
        // title (4,1) 215×75 ⇒ 中心 (111.5,38.5) ⇒ (8, 14)
        { p: 'Title', x: 8, y: 14, w: 215, h: 75 },
        // com_rd (177,0) 30×30 ⇒ 中心 (192,15) ⇒ (88.5, 37.5)；嵌套实例壳 ⇒ 不查尺寸
        { p: 'RedDot', x: 88.5, y: 37.5 },
    ], 'LeagueNorthTab');
});

test('D8 排行行几何：`_排行Item` 逐条 + 名次格 `_排名` 两个文本', () => {
    assertBoxes(rankRowDoc, [
        // n0 行底框 (0,0) 550×130
        { p: 'RowBg', x: 0, y: 0, w: 550, h: 130 },
        // rank 名次格 (16,35) 60×60 ⇒ 中心 (46,65) ⇒ (−229, 0)
        { p: 'Rank', x: -229, y: 0, w: 60, h: 60 },
        //   lab (0,0) 60×60 ⇒ 与格同心
        { p: 'Rank/Lab', x: 0, y: 0, w: 60, h: 60 },
        //   n10「未上榜」(−14,0) 89×60 ⇒ 中心 (30.5,30) ⇒ 相对格中心 (30,30) = (0.5, 0)
        { p: 'Rank/Unranked', x: 0.5, y: 0, w: 89, h: 60 },
        // n22 组「联盟排名」页 (81,5) 461×120 ⇒ 中心 (311.5,65) ⇒ (36.5, 0)
        { p: 'RankFields', x: 36.5, y: 0, w: 461, h: 120 },
        //   leagueName (81,31) 153×29 ⇒ 中心 (157.5,45.5)
        { p: 'RankFields/LeagueName', x: -154, y: 19.5, w: 153, h: 29 },
        //   com_goods (323,5) **pivot .5** ⇒ xy 是盒左上角、缩放绕中心 ⇒ 中心 (383,65)
        { p: 'RankFields/RewardSlot', x: 71.5, y: 0, w: 120, h: 120, sx: 0.8 },
        //     icon 与容器同尺寸、再叠一层 0.8
        { p: 'RankFields/RewardSlot/Icon', x: 0, y: 0, w: 120, h: 120, sx: 0.8 },
        //     text_number：relation right-left%,top-top ⇒ 右缘钉住（锚点 (1,.5)）
        { p: 'RankFields/RewardSlot/Count', x: 58.8, y: -23, ax: 1, ay: 0.5 },
        //   com_goods1 (422,5) ⇒ 盒中心 (482,65)
        { p: 'RankFields/RewardSlot1', x: 170.5, y: 0, w: 120, h: 120, sx: 0.8 },
        { p: 'RankFields/RewardSlot1/Icon', x: 0, y: 0, w: 120, h: 120, sx: 0.8 },
        { p: 'RankFields/RewardSlot1/Count', x: 58.8, y: -23, ax: 1, ay: 0.5 },
        // n21 组「盟内进度」页 (70,10) 440×110 ⇒ 中心 (290,65) ⇒ (15, 0)
        { p: 'ProgressFields', x: 15, y: 0, w: 440, h: 110 },
        //   com_head (70,10) **pivot .5** scale .8 110×110 ⇒ 盒中心 (125,65)
        { p: 'ProgressFields/Head', x: -165, y: 0, w: 110, h: 110, sx: 0.8 },
        //     n0 img_Touxiang_01 (0,0) 110×110 ⇒ 与头框同心
        { p: 'ProgressFields/Head/Frame', x: 0, y: 0, w: 110, h: 110 },
        //     icon (55,52) pivot .5 **+ anchor="true"** ⇒ xy 就是**中点** ⇒ 相对头框中心 (55,55) = (0, 3)
        //     ⚠️ 别按「xy = 左上角」算 —— 那样得 (100,97)/(45,−42)，头像会跑到框右上角外面
        { p: 'ProgressFields/Head/Icon', x: 0, y: 3, w: 90, h: 90 },
        //   userName (177,18) 236×29 ⇒ 中心 (295,32.5)；userPower (384,50) ⇒ 中心 (447,64.5)
        { p: 'ProgressFields/UserName', x: 5, y: 32.5 },
        { p: 'ProgressFields/UserPower', x: 157, y: 0.5 },
        //   n18 bb_pic11 (174,49) 138×38 ⇒ 中心 (243,68)；n19 bb_pic13 (185,49) **无 size**
        //   ⇒ 原生 34×33 ⇒ 中心 (202,65.5)
        { p: 'ProgressFields/PowerBar', x: -47, y: -3, w: 138, h: 38 },
        { p: 'ProgressFields/PowerBar2', x: -88, y: -0.5, w: 34, h: 33 },
        //   文本_战斗力 (223,48) 83×34 ⇒ 中心 (264.5,65)
        { p: 'ProgressFields/PowerText', x: -25.5, y: 0, w: 83, h: 34 },
    ], 'LeagueNorthRankRow');
});

test('D9 奖励行几何：`_奖励Item` 逐条（含 156 宽进度条填充）', () => {
    assertBoxes(rewardRowDoc, [
        { p: 'RowBg', x: 0, y: 0, w: 550, h: 160 },
        // n1 标题衬底 BB_img03 (31,8) 488×32 ⇒ 中心 (275,24) ⇒ (0, 56)
        { p: 'TitleBar', x: 0, y: 56, w: 488, h: 32 },
        // n2 labName (50,10) 447×29 ⇒ 中心 (273.5,24.5) ⇒ (−1.5, 55.5)
        { p: 'NameLabel', x: -1.5, y: 55.5, w: 447, h: 29 },
        // n3 com_goods (34,40) scale .8 **无 pivot** ⇒ 缩小绕左上角 ⇒ 视觉盒 (34,40)-(130,136)
        //    ⇒ 视觉中心 (82,88) ⇒ (−193, −8)
        { p: 'RewardSlot', x: -193, y: -8, w: 120, h: 120, sx: 0.8 },
        { p: 'RewardSlot/Icon', x: 0, y: 0, w: 120, h: 120, sx: 0.8 },
        { p: 'RewardSlot/Count', x: 58.8, y: -23, ax: 1, ay: 0.5 },
        // n6 comp_progress (372,41) 160×38 ⇒ 中心 (452,60) ⇒ (177, 20)
        { p: 'Progress', x: 177, y: 20, w: 160, h: 38 },
        { p: 'Progress/ProgressBg', x: 0, y: 0, w: 160, h: 38 },
        //   满宽 = 637/652×160 ≈ 156.3 → 156；左内缩 8/652×160 ≈ 2 ⇒ x = −80+2，锚点 (0,.5)
        { p: 'Progress/ProgressFill', x: -78, y: 0, w: 156, h: 21, ax: 0, ay: 0.5 },
        { p: 'Progress/ProgressLabel', x: 0, y: 0, w: 160, h: 29 },
        // n7 已领取印章 (395,59) 原生 119×74 ⇒ 中心 (454.5,96) ⇒ (179.5, −16)
        { p: 'DoneTag', x: 179.5, y: -16, w: 119, h: 74 },
        // n8 按钮 (378,77) 144×62 ⇒ 中心 (450,108) ⇒ (175, −28)
        { p: 'ClaimBtn', x: 175, y: -28, w: 144, h: 62 },
        //   `按钮_公共_通用` 的 title：宽 = 按钮宽、高 66、`top-middle` ⇒ 中心 = 按钮中心 + 1
        { p: 'ClaimBtn/Label', x: 0, y: 1, w: 144, h: 66 },
    ], 'LeagueNorthRewardRow');
});

test('D10 主面板几何：整屏骨架 + 五行属性 + 两个物品框 + 三颗按钮（对 `组件_联盟_北伐中原.xml`）', () => {
    assertBoxes(mainDoc, [
        // bg (0,0) 720×1280
        { p: 'Bg', x: 0, y: 0, w: 720, h: 1280 },
        // n24 zg_pic02 (171,35) 原生 362×112 ⇒ 中心 (352,91) ⇒ (−8, 549)
        { p: 'TitleBanner', x: -8, y: 549, w: 362, h: 112 },
        // n1 panel_window_02_9gong (0,543) 720×660 ⇒ 中心 (360,873) ⇒ (0, −233)
        { p: 'Board', x: 0, y: -233, w: 720, h: 660 },
        // n3 frame_01_9gong (19,624) 680×545 ⇒ 中心 (359,896.5) ⇒ (−1, −256.5)
        { p: 'InnerFrame', x: -1, y: -256.5, w: 680, h: 545 },
        // n2 zg_pic03 (172,516) 原生 359×93 ⇒ 中心 (351.5,562.5) ⇒ (−8.5, 77.5)
        { p: 'BoardTitle', x: -8.5, y: 77.5, w: 359, h: 93 },
        // n49 frame_Zhikuang04 (64,748) 600×187 ⇒ 中心 (364,841.5) ⇒ (4, −201.5)
        { p: 'AttrBg', x: 4, y: -201.5, w: 600, h: 187 },
        // n17 组 layout=vt lineGap=2：五行 600×35，行距 37 ⇒ 中心 y = 640−(749+35/2)−37i
        { p: 'Attr0', x: 0, y: -126.5, w: 600, h: 35 },
        { p: 'Attr1', x: 0, y: -163.5, w: 600, h: 35 },
        { p: 'Attr2', x: 0, y: -200.5, w: 600, h: 35 },
        { p: 'Attr3', x: 0, y: -237.5, w: 600, h: 35 },
        { p: 'Attr4', x: 0, y: -274.5, w: 600, h: 35 },
        //   行内 `title` (36,0) 241×34 / `value` (379,0) 197×34（**相对行盒左上角**）
        //   ⇒ dx = 60+36+120.5 − 360 = −143.5 / 60+379+98.5 − 360 = 177.5
        //   ⇒ dy = 766.5 − (749+0+17) = +0.5（行盒 35 高、组件原生 34 高 ⇒ 半像素差）
        { p: 'Attr0/Title', x: -143.5, y: 0.5, w: 241, h: 34 },
        { p: 'Attr0/Value', x: 177.5, y: 0.5, w: 197, h: 34 },
        { p: 'Attr4/Title', x: -143.5, y: 0.5, w: 241, h: 34 },
        { p: 'Attr4/Value', x: 177.5, y: 0.5, w: 197, h: 34 },
        // n50 frame_Zhikuang05 (66,939) 600×87 ⇒ 中心 (366,982.5) ⇒ (6, −342.5)
        { p: 'DailyBg', x: 6, y: -342.5, w: 600, h: 87 },
        // n36 com_goods1 (534,945) **无 pivot** scale .6 ⇒ 视觉盒 (534,945)-(606,1017)
        //    ⇒ 视觉中心 (570,981) ⇒ (210, −341)
        { p: 'DailySlot1', x: 210, y: -341, w: 120, h: 120, sx: 0.6 },
        // n48 frame_Zhikuang05 (64,660) 600×87 ⇒ 中心 (364,703.5) ⇒ (4, −63.5)
        { p: 'BuffBg', x: 4, y: -63.5, w: 600, h: 87 },
        // n35 com_goods (456,945) 同上 ⇒ 视觉中心 (492,981) ⇒ (132, −341)
        { p: 'DailySlot0', x: 132, y: -341, w: 120, h: 120, sx: 0.6 },
        //   物品框内部（`物品框` 三件套）：Icon 与容器同尺寸叠 0.8；Count 右缘钉住
        { p: 'DailySlot0/Icon', x: 0, y: 0, w: 120, h: 120, sx: 0.8 },
        { p: 'DailySlot0/Count', x: 58.8, y: -23, ax: 1, ay: 0.5 },
        { p: 'DailySlot1/Icon', x: 0, y: 0, w: 120, h: 120, sx: 0.8 },
        { p: 'DailySlot1/Count', x: 58.8, y: -23, ax: 1, ay: 0.5 },
        // n21 英雄共鸣 (89,685) 144×42 ⇒ 中心 (161,706) ⇒ (−199, −66)
        { p: 'BuffTitle', x: -199, y: -66, w: 144, h: 42 },
        // n9 今日挑战奖励 (86,966) 154×34 ⇒ 中心 (163,983) ⇒ (−197, −343)
        { p: 'DailyTitle', x: -197, y: -343, w: 154, h: 34 },
        // n7 战况 (274,530) 144×69 ⇒ 中心 (346,564.5) ⇒ (−14, 75.5)
        { p: 'SectionTitle', x: -14, y: 75.5, w: 144, h: 69 },
        // n6 lab_times (434,1021) 155×36 ⇒ 中心 (511.5,1039) ⇒ (151.5, −399)
        //   ⚠️ **不查宽高**：FGUI 没写 `autoSize` ⇒ 落成 `overflow NONE(0)`，引擎按文本
        //      把 contentSize 重写成实际尺寸（实测 151.37×54.4）。位置才是真值。
        { p: 'TimesLabel', x: 151.5, y: -399 },
        // n19 btn_help (258,680) 60×64 **无 pivot** scale .8 ⇒ 视觉中心 (282,705.6) ⇒ (−78, −65.6)
        { p: 'HelpBtn', x: -78, y: -65.6, w: 60, h: 64, sx: 0.8 },
        // n22 按钮_擂鼓 (524,678) 114×54 ⇒ 中心 (581,705) ⇒ (221, −65)
        { p: 'DrumBtn', x: 221, y: -65, w: 114, h: 54 },
        { p: 'DrumBtn/Label', x: 0, y: 1, w: 114, h: 66 },
        // n5 按钮_挑战 (397,1055) 224×79 ⇒ 中心 (509,1094.5) ⇒ (149, −454.5)
        { p: 'ChallengeBtn', x: 149, y: -454.5, w: 224, h: 79 },
        { p: 'ChallengeBtn/Label', x: 0, y: 1, w: 224, h: 66 },
        // n4 按钮_扫荡 (112,1056) 224×79 ⇒ 中心 (224,1095.5) ⇒ (−136, −455.5)
        { p: 'SweepBtn', x: -136, y: -455.5, w: 224, h: 79 },
        { p: 'SweepBtn/Label', x: 0, y: 1, w: 224, h: 66 },
        // n25 lab_monster (229,69) 250×46 ⇒ 中心 (354,92) ⇒ (−6, 548)
        { p: 'MonsterLabel', x: -6, y: 548, w: 250, h: 46 },
        // n27 lab_endtime (163,139) 360×36 ⇒ 中心 (343,157) ⇒ (−17, 483)
        { p: 'EndTimeLabel', x: -17, y: 483, w: 360, h: 36 },
        // n44 组件_公用_红点 (73,196) 30×30 ⇒ 中心 (88,211) ⇒ (−272, 429)；嵌套实例壳 ⇒ 不查尺寸
        { p: 'RewardRedDot', x: -272, y: 429 },
        // n52 btn_rank (29,302) 90×100 ⇒ 中心 (74,352) ⇒ (−286, 288)
        { p: 'RankBtn', x: -286, y: 288, w: 90, h: 100 },
        // n53 btn_reward (29,200) 90×100 ⇒ 中心 (74,250) ⇒ (−286, 390)
        { p: 'RewardBtn', x: -286, y: 390, w: 90, h: 100 },
        // n54 diban_BG (0,1160) 720×120 ⇒ 中心 (360,1220) ⇒ (0, −580)
        { p: 'BottomBg', x: 0, y: -580, w: 720, h: 120 },
        // 按钮_返回 (0,1164) 原生 132×116 ⇒ 中心 (66,1222) ⇒ (−294, −582)
        { p: 'BackBtn', x: -294, y: -582, w: 132, h: 116 },
    ], 'LeagueNorthExpedition');
});

test('D11 两个弹窗骨架：popBg **不在画布中心**（`n4` 组只占它的上半部分）', () => {
    // ⚠️ 别照抄 `LeagueApplyList` 的「popBg 中心 = 画布中心」——那个 popBg 706 高、恰好居中。
    //    北伐这两个的骨架在 FGUI 里是：组件 720×1280 → `n4` 组 (40,162/191) 640×956
    //    （`relation center-center,middle-middle` ⇒ n4 的中心 = 画布中心）→ popBg 640×895
    //    贴在 n4 的**左上角** ⇒ popBg 中心比画布中心高 30.5 / 1.5。
    const TOP_RANK = 30.5 + 895 / 2; // = 478（popBg 顶边在 cocos 里的 y）
    const TOP_REWARD = 1.5 + 895 / 2; // = 449
    assertBoxes(rankPopDoc, [
        // popBg (40,162) 640×895 ⇒ 中心 (360,609.5) ⇒ 640−609.5 = +30.5
        { p: 'PopBg', x: 0, y: 30.5, w: 640, h: 895 },
        // 骨架三条（距 popBg 顶边是常数，与高度无关）：标题条 / 装饰条 中心 12.5、标题 10、关闭 10
        { p: 'TitleBg', x: 0, y: TOP_RANK - 12.5, w: 601, h: 66 },
        { p: 'TitleDeco', x: 0, y: TOP_RANK - 12.5, w: 253, h: 44 },
        { p: 'Title', x: 0, y: TOP_RANK - 10, w: 240, h: 42 },
        { p: 'CloseBtn', x: 288, y: TOP_RANK - 10, w: 54, h: 51 },
        // n5 BB_img03 (104,223) 488×32 ⇒ 中心 (348,239) ⇒ (−12, 401)
        { p: 'HeaderBar', x: -12, y: 401, w: 488, h: 32 },
        // list (85,270) 550×537，**锚点 (0.5,1)** ⇒ 顶边中点 (360,270) ⇒ (0, 370)
        { p: 'RankList', x: 0, y: 370, w: 550, h: 537, ax: 0.5, ay: 1 },
        { p: 'RankList/content', x: 0, y: 0, w: 550, h: 537, ax: 0.5, ay: 1 },
        // 行模板：lineGap 10 ⇒ 首行中心 = 列表顶 − 130/2（壳不序列化尺寸 ⇒ 不查）
        { p: RANK_ROW, x: 0, y: -65 },
        // n13 frame_Zhikuang01 (63,783) 594×160 ⇒ 中心 (360,863) ⇒ (0, −223)
        { p: 'MyBg', x: 0, y: -223, w: 594, h: 160 },
        // tab_rank (76,1013) / tab_progress (293,1013)，页签原生 207×105
        //   ⇒ 中心 (179.5,1065.5) / (396.5,1065.5) ⇒ (−180.5,−425.5) / (36.5,−425.5)
        { p: 'TabRank', x: -180.5, y: -425.5 },
        { p: 'TabProgress', x: 36.5, y: -425.5 },
        // heroItem (84,793) 550×130 ⇒ 中心 (359,858) ⇒ (−1, −218)
        { p: 'HeroItem', x: -1, y: -218 },
        // n6 排名 (117,225) 44×29 ⇒ 中心 (139,239.5) ⇒ (−221, 400.5)（表头三列的同 y）
        { p: 'HeaderRankTitle', x: -221, y: 400.5 },
        // n12 (120,944) 480×36 ⇒ 中心 (360,962) ⇒ (0, −322)
        { p: 'AwardTip', x: 0, y: -322 },
        // n15 组 (183,225) 362×29 ⇒ 中心 (364,239.5) ⇒ (4, 400.5)
        { p: 'HeaderRank', x: 4, y: 400.5, w: 362, h: 29 },
        { p: 'HeaderRank/ColLeagueDamage', x: -129, y: 0 },
        { p: 'HeaderRank/ColMembers', x: -10, y: 0 },
        { p: 'HeaderRank/ColReward', x: 159, y: 0 },
        // n16 组 (294,226) 279×29 ⇒ 中心 (433.5,240.5) ⇒ (73.5, 399.5)
        { p: 'HeaderProgress', x: 73.5, y: 399.5, w: 279, h: 29 },
        { p: 'HeaderProgress/ColPlayer', x: -97.5, y: 0 },
        { p: 'HeaderProgress/ColTotalDamage', x: 97.5, y: 0 },
    ], 'LeagueNorthRank');

    assertBoxes(rewardPopDoc, [
        // popBg (40,191) 640×895 ⇒ 中心 (360,638.5) ⇒ 640−638.5 = +1.5
        { p: 'PopBg', x: 0, y: 1.5, w: 640, h: 895 },
        { p: 'TitleBg', x: 0, y: TOP_REWARD - 12.5, w: 601, h: 66 },
        { p: 'TitleDeco', x: 0, y: TOP_REWARD - 12.5, w: 253, h: 44 },
        { p: 'Title', x: 0, y: TOP_REWARD - 10, w: 240, h: 42 },
        { p: 'CloseBtn', x: 288, y: TOP_REWARD - 10, w: 54, h: 51 },
        // list (85,246) 550×772，锚点 (0.5,1) ⇒ (0, 394)
        { p: 'RewardList', x: 0, y: 394, w: 550, h: 772, ax: 0.5, ay: 1 },
        { p: 'RewardList/content', x: 0, y: 0, w: 550, h: 772, ax: 0.5, ay: 1 },
        // 行模板：首行中心 = 列表顶 − 160/2
        { p: REWARD_ROW, x: 0, y: -80 },
        { p: 'TabLeague', x: -180.5, y: -454.5 },
        { p: 'TabRole', x: 36.5, y: -454.5 },
    ], 'LeagueNorthReward');
});

test('D12 Label 排版：字号 / 颜色（含 5 行黑字）/ 对齐 / 描边 / 按钮文案', () => {
    assertLabels(tabDoc, [
        { p: 'Title', text: '联盟排名', size: 30, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
    ], 'LeagueNorthTab');
    assertLabels(rankRowDoc, [
        { p: 'Rank/Lab', text: '1', size: 30, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        // n10「未上榜」同色同描边、只小一号
        { p: 'Rank/Unranked', text: '未上榜', size: 20, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        // ⚠️ 下面 5 条 FGUI **没有 color** ⇒ 吃工程默认 `#000000`（`settings/Common.json`），
        //    而且**无描边** —— 它们落在浅色羊皮纸 `frame_Zhikuang01` 上，对比度够。
        { p: 'RankFields/LeagueName', text: '盛世', size: 20, color: [0, 0, 0], align: 0, vAlign: 0 },
        { p: 'RankFields/LeaguePower', text: '102117.8亿', size: 20, color: [0, 0, 0], align: 0, vAlign: 0 },
        { p: 'RankFields/RoleCount', text: '53/53', size: 20, color: [0, 0, 0], align: 0, vAlign: 0 },
        { p: 'ProgressFields/UserName', text: '金强吉', size: 20, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'ProgressFields/UserPower', text: '2.1亿', size: 20, color: [0, 0, 0], align: 0, vAlign: 1 },
        // 文本_战斗力：24px #fef3b0 / 描边 #160e08(2) / 居中
        { p: 'ProgressFields/PowerText', text: '210', size: 24, color: [254, 243, 176], align: 1, vAlign: 1, outline: 2 },
        // 数量：24px #ffffff 右对齐/居中（右缘钉住、往左长）
        { p: 'RankFields/RewardSlot/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        { p: 'RankFields/RewardSlot1/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
    ], 'LeagueNorthRankRow');
    assertLabels(rewardRowDoc, [
        { p: 'NameLabel', text: '铜钱', size: 20, color: [0, 0, 0], align: 1, vAlign: 1 },
        { p: 'Progress/ProgressLabel', text: '', size: 20, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: 'ClaimBtn/Label', text: '领取', size: 26, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: 'RewardSlot/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
    ], 'LeagueNorthRewardRow');
    assertLabels(mainDoc, [
        { p: 'MonsterLabel', text: '巫妖王*阿尔萨斯', size: 31, color: [231, 226, 196], align: 1, vAlign: 1, outline: 2 },
        // vAlign = 上（FGUI 没写 vAlign ⇒ 默认上）
        { p: 'EndTimeLabel', text: '活动剩余时间:08:15:38', size: 24, color: [237, 211, 122], align: 1, vAlign: 0, outline: 2 },
        { p: 'SectionTitle', text: '战况', size: 38, color: [245, 234, 172], align: 1, vAlign: 1, outline: 4 },
        { p: 'BuffTitle', text: '英雄共鸣', size: 30, color: [254, 238, 176], align: 1, vAlign: 1, outline: 2 },
        // `n9` 给了 strokeColor 但**没给 strokeSize** ⇒ FGUI 默认 1
        { p: 'DailyTitle', text: '今日挑战奖励', size: 24, color: [254, 239, 177], align: 0, vAlign: 0, outline: 1 },
        { p: 'TimesLabel', text: '挑战次数:0/0', size: 26, color: [196, 197, 194], align: 0, vAlign: 0, outline: 2 },
        { p: 'DrumBtn/Label', text: '擂鼓', size: 26, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: 'ChallengeBtn/Label', text: '挑战', size: 38, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: 'SweepBtn/Label', text: '扫荡', size: 38, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        // ⚠️ 五行属性是**黑字**：`组件_联盟_北伐中原文本` 的 title / value 都没有 color
        //    ⇒ 吃工程默认 #000000，而它们的底板 `frame_Zhikuang04` 是浅羊皮纸（实测内部
        //    rgb(155,137,106)，对比度约 6:1）。面板其它文本都在深色木纹上、显式米白。
        { p: 'Attr0/Title', text: '今日联盟累计伤害', size: 24, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'Attr0/Value', text: '0', size: 24, color: [0, 0, 0], align: 1, vAlign: 1 },
        { p: 'Attr1/Title', text: '今日累计伤害', size: 24, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'Attr2/Title', text: 'Buff剩余时间', size: 24, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'Attr2/Value', text: '00:00:00', size: 24, color: [0, 0, 0], align: 1, vAlign: 1 },
        { p: 'Attr3/Title', text: '叠加层数', size: 24, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'Attr4/Title', text: '属性加成', size: 24, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'Attr4/Value', text: '攻击+0', size: 24, color: [0, 0, 0], align: 1, vAlign: 1 },
        { p: 'DailySlot0/Count', text: '0', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        { p: 'DailySlot1/Count', text: '0', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
    ], 'LeagueNorthExpedition');
    assertLabels(rankPopDoc, [
        { p: 'Title', text: '排名', size: 30, color: [255, 246, 196], align: 1, vAlign: 1, outline: 3 },
        // 表头：6 条都是 20px 黑字、无描边、左对齐/居中
        { p: 'HeaderRankTitle', text: '排名', size: 20, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'HeaderRank/ColLeagueDamage', text: '联盟及伤害', size: 20, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'HeaderRank/ColMembers', text: '人数', size: 20, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'HeaderRank/ColReward', text: '奖励', size: 20, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'HeaderProgress/ColPlayer', text: '玩家信息', size: 20, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'HeaderProgress/ColTotalDamage', text: '伤害总量', size: 20, color: [0, 0, 0], align: 0, vAlign: 1 },
        { p: 'AwardTip', text: '排名奖励将在周一00:00以邮件形式发放', size: 26, color: [252, 240, 214], align: 0, vAlign: 0, outline: 2 },
    ], 'LeagueNorthRank');
    assertLabels(rewardPopDoc, [
        { p: 'Title', text: '联合战线奖励', size: 30, color: [255, 246, 196], align: 1, vAlign: 1, outline: 3 },
    ], 'LeagueNorthReward');
});

test('D13 虚拟列表装配 + 嵌套实例（页签 / 行模板 / 红点）+ Button 按下态', () => {
    const listCid = cidOf(VSCROLL_TS);
    for (const [doc, listKey, itemKey, tag] of [
        [rankPopDoc, 'RankList', RANK_ROW, 'LeagueNorthRank'],
        [rewardPopDoc, 'RewardList', REWARD_ROW, 'LeagueNorthReward'],
    ] as const) {
        const listComp = doc.comp(listKey, listCid);
        assert.ok(listComp, `${tag}：${listKey} 上没挂 VirtualScrollView`);
        assert.equal(doc.refPath(listComp!.content), `${doc.rootName}/${listKey}/content`, `${tag}：content 没绑`);
        assert.equal(doc.refPath(listComp!.itemNode), `${doc.rootName}/${itemKey}`, `${tag}：itemNode 没绑`);
        assert.equal(listComp!.useVirtualList, true);
        assert.equal(listComp!.itemCreationMode, 0, `${tag}：0 = NODE`);
        assert.equal(listComp!.direction, 0, `${tag}：0 = 纵向`);
        assert.equal(listComp!.gridCount, 1);
        assert.equal(listComp!.spacing, 10, `${tag}：FGUI list 的 lineGap="10"`);
    }

    // 嵌套实例清单（uuid 从各自 `.ts.meta` / `.prefab.meta` 反解，禁手抄）
    const rankRowUuid = uuidOfPrefab(RANK_ROW_PREFAB);
    const rewardRowUuid = uuidOfPrefab(REWARD_ROW_PREFAB);
    const tabUuid = uuidOfPrefab(TAB_PREFAB);
    const dotUuid = uuidOfPrefab(RED_DOT_PREFAB);
    const rel = (doc: PrefabDoc, uuid: string): string[] =>
        doc.instances.filter((i) => i.uuid === uuid)
            .map((i) => i.shell.path.slice(doc.rootName.length + 1));

    assert.deepEqual(rel(rankPopDoc, tabUuid), ['TabRank', 'TabProgress']);
    assert.deepEqual(rel(rankPopDoc, rankRowUuid).sort(), ['HeroItem', RANK_ROW].sort(),
        '⚠️ 排行页有**两个** `LeagueNorthRankRow` 实例：列表行模板 + 我的名次那一行');
    assert.deepEqual(rel(rewardPopDoc, tabUuid), ['TabLeague', 'TabRole']);
    assert.deepEqual(rel(rewardPopDoc, rewardRowUuid), [REWARD_ROW]);
    // 页签自己的红点、主面板的两颗红点（奖励入口 + 挑战按钮）
    assert.deepEqual(rel(tabDoc, dotUuid), ['RedDot']);
    assert.deepEqual(
        rel(mainDoc, dotUuid).sort(),
        ['ChallengeBtn/RedDot', 'RewardRedDot'].sort(),
        '主面板应有两颗红点：奖励入口（老端 `btn_reward_com_rd`）+ 挑战按钮（老端 `按钮_挑战.组件_红点`）',
    );
    // 三个叶子组件里不该有别的嵌套实例
    assert.deepEqual(rel(rankRowDoc, dotUuid), []);
    assert.deepEqual(rel(rewardRowDoc, dotUuid), []);

    // 按钮按下态：FGUI `downEffect="scale" 0.9`（`按钮_公共_通用` 与 `按钮_公共_关闭` 都是）
    const scaleBtns: readonly (readonly [PrefabDoc, string])[] = [
        [mainDoc, 'BackBtn'], [mainDoc, 'HelpBtn'], [mainDoc, 'DrumBtn'],
        [mainDoc, 'ChallengeBtn'], [mainDoc, 'SweepBtn'], [mainDoc, 'RankBtn'], [mainDoc, 'RewardBtn'],
        [rewardRowDoc, 'ClaimBtn'],
        [rankPopDoc, 'CloseBtn'], [rewardPopDoc, 'CloseBtn'],
    ];
    for (const [doc, p] of scaleBtns) {
        const btn = doc.comp(p, 'cc.Button');
        assert.ok(btn, `${doc.rootName}/${p} 上没有 cc.Button`);
        assert.equal(btn!._transition, 3, `${doc.rootName}/${p} 的过渡应为 SCALE(3)`);
        assert.ok(near(Number(btn!._zoomScale ?? 1), 0.9), `${doc.rootName}/${p} 的缩放系数应为 0.9`);
    }
});

test('D14 `@property` 逐条：主面板 18 + 排行页 9 + 奖励页 4 + 两行各 14/8 + 页签 3', () => {
    assertBinds(mainDoc, PAGE_TS, '', [
        ['backButton', 'BackBtn'],
        ['helpButton', 'HelpBtn'],
        ['rewardButton', 'RewardBtn'],
        ['rankButton', 'RankBtn'],
        ['rewardRedDot', 'RewardRedDot'],
        ['drumButton', 'DrumBtn'],
        ['challengeButton', 'ChallengeBtn'],
        ['sweepButton', 'SweepBtn'],
        ['monsterLabel', 'MonsterLabel'],
        ['endTimeLabel', 'EndTimeLabel'],
        ['timesLabel', 'TimesLabel'],
        // ⚠️ 五条属性绑的是行内的 **Value** 子节点（不是行节点本身）
        ['attrLeaguePower', 'Attr0/Value'],
        ['attrPower', 'Attr1/Value'],
        ['attrTime', 'Attr2/Value'],
        ['attrAdd', 'Attr3/Value'],
        ['attrBuff', 'Attr4/Value'],
        // 物品框是 `LeagueRewardSlot.prefab` 实例 ⇒ 绑**节点**、运行时 `getComponent`
        ['dailySlot0', 'DailySlot0'],
        ['dailySlot1', 'DailySlot1'],
    ], 'LeagueNorthExpeditionPage');

    assertBinds(rankPopDoc, RANK_PAGE_TS, '', [
        ['closeButton', 'CloseBtn'],
        ['tabRank', 'TabRank'],
        ['tabProgress', 'TabProgress'],
        ['rankList', 'RankList'],
        ['myBg', 'MyBg'],
        ['heroItem', 'HeroItem'],
        ['headerRank', 'HeaderRank'],
        ['headerProgress', 'HeaderProgress'],
        ['awardTip', 'AwardTip'],
    ], 'LeagueNorthRankPage');

    assertBinds(rewardPopDoc, REWARD_PAGE_TS, '', [
        ['closeButton', 'CloseBtn'],
        ['tabLeague', 'TabLeague'],
        ['tabRole', 'TabRole'],
        ['rewardList', 'RewardList'],
    ], 'LeagueNorthRewardPage');

    assertBinds(tabDoc, TAB_TS, '', [
        ['bg', 'Bg'],
        ['titleLabel', 'Title'],
        ['redDot', 'RedDot'],
    ], 'LeagueNorthTab');

    assertBinds(rankRowDoc, RANK_ROW_TS, '', [
        ['rowBg', 'RowBg'],
        ['rankLabel', 'Rank/Lab'],
        ['unranked', 'Rank/Unranked'],
        ['rankFields', 'RankFields'],
        ['leagueName', 'RankFields/LeagueName'],
        ['leaguePower', 'RankFields/LeaguePower'],
        ['roleCount', 'RankFields/RoleCount'],
        ['rewardSlot', 'RankFields/RewardSlot'],
        ['rewardSlot1', 'RankFields/RewardSlot1'],
        ['progressFields', 'ProgressFields'],
        ['headIcon', 'ProgressFields/Head/Icon'],
        ['userName', 'ProgressFields/UserName'],
        ['userPower', 'ProgressFields/UserPower'],
        ['powerText', 'ProgressFields/PowerText'],
    ], 'LeagueNorthRankRow');

    assertBinds(rewardRowDoc, REWARD_ROW_TS, '', [
        ['nameLabel', 'NameLabel'],
        ['rewardSlot', 'RewardSlot'],
        ['progressNode', 'Progress'],
        ['progressFill', 'Progress/ProgressFill'],
        ['progressLabel', 'Progress/ProgressLabel'],
        ['doneTag', 'DoneTag'],
        ['claimButton', 'ClaimBtn'],
        ['claimLabel', 'ClaimBtn/Label'],
    ], 'LeagueNorthRewardRow');

    // 两个奖励格脚本（`LeagueRewardSlot`）：每个 2 个属性
    for (const [doc, slots, tag] of [
        [rankRowDoc, ['RankFields/RewardSlot', 'RankFields/RewardSlot1'], 'LeagueNorthRankRow'],
        [rewardRowDoc, ['RewardSlot'], 'LeagueNorthRewardRow'],
        [mainDoc, ['DailySlot0', 'DailySlot1'], 'LeagueNorthExpedition'],
    ] as const) {
        for (const slot of slots) {
            assertBinds(doc, SLOT_TS, slot, [['icon', `${slot}/Icon`], ['countLabel', `${slot}/Count`]], `${tag}/${slot}`);
        }
    }
});
