/**
 * 每日任务页（`LayerActivityPage` + `ui/Activity/Activity.prefab`）的版面契约与数据口径单测。
 *
 * 分三层：
 *
 *  **A. 版面几何**（`LayerActivityLayout`，纯函数）—— 重点是「条宽 → 节距 → 宝箱节点宽」
 *  这条**倒推链**：条宽不是抄来的输入，是按「8 档宝箱不重叠 + 首档不压徽章 + 末档不出画布」
 *  反推出来的结果。这里用**真实 `dayChallengeActTaskProgress` 表的 cost** 驱动，任何一环被改
 *  都会红。
 *
 *  **B. prefab ↔ layout 对拍**（读 assetPath(`ui/Activity/Activity.prefab`)）——
 *  把「代码常量」与「美术资源实际摆位」钉在一起：改 prefab 忘了改常量（或反之）都会红。
 *  只挑承重的几条；全量 257 条离线体检在 `tmp/_activity/audit_activity_prefab.mjs`。
 *
 *  **C. 数据口径**（`LayerActivityTable` / `LayerActivityTexts`）—— 表解析（含**真实表**）、
 *  任务三态、红点、排序、宝箱三态、进度比例、跨帧签名。
 *
 * 三个被测模块**零 import**（连 `cc` 都没有），运行时依赖链是空的，可直接在 node 里跑。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    ACTIVITY_BAR_CENTER_Y,
    ACTIVITY_BAR_HEIGHT,
    ACTIVITY_BAR_LEFT,
    ACTIVITY_BAR_WIDTH,
    ACTIVITY_CANVAS_HEIGHT,
    ACTIVITY_CANVAS_WIDTH,
    ACTIVITY_CHEST_ART_SIZE,
    ACTIVITY_CHEST_CENTER_Y,
    ACTIVITY_CHEST_NODE_HEIGHT,
    ACTIVITY_CHEST_NODE_WIDTH,
    ACTIVITY_LIST_SIZE,
    ACTIVITY_MEDAL_POS,
    ACTIVITY_MEDAL_SIZE,
    ACTIVITY_PREVIEW_ANCHOR_GAP,
    ACTIVITY_PREVIEW_CELL_GAP,
    ACTIVITY_PREVIEW_CELL_SIZE,
    ACTIVITY_PREVIEW_HEIGHT,
    ACTIVITY_PREVIEW_MAX_CELLS,
    ACTIVITY_PREVIEW_NUM_FONT_SIZE,
    ACTIVITY_PREVIEW_NUM_POS,
    ACTIVITY_PREVIEW_NUM_SCALE,
    ACTIVITY_PREVIEW_PADDING_X,
    ACTIVITY_ROW_ACTION_POS,
    ACTIVITY_ROW_ACTION_SIZE,
    ACTIVITY_ROW_BG_POS,
    ACTIVITY_ROW_BG_SIZE,
    ACTIVITY_ROW_HEIGHT,
    ACTIVITY_ROW_REWARD_BAR_POS,
    ACTIVITY_ROW_REWARD_BAR_SIZE,
    ACTIVITY_ROW_REWARD_NUM_FONT_SIZE,
    ACTIVITY_ROW_REWARD_NUM_POS,
    ACTIVITY_ROW_REWARD_SLOT_GAP,
    ACTIVITY_ROW_REWARD_SLOT_SIZE,
    ACTIVITY_ROW_REWARD_SLOTS,
    ACTIVITY_ROW_RIBBON_POS,
    ACTIVITY_ROW_RIBBON_SCALE_Y,
    ACTIVITY_ROW_RIBBON_SIZE,
    ACTIVITY_ROW_STAMP_POS,
    ACTIVITY_ROW_STAMP_SIZE,
    ACTIVITY_ROW_TITLE_LEFT,
    ACTIVITY_ROW_TITLE_SIZE,
    ACTIVITY_ROW_WIDTH,
    ACTIVITY_STRIP_HEIGHT,
    ACTIVITY_STRIP_POS,
    ACTIVITY_STRIP_WIDTH,
    ACTIVITY_TITLE_LABEL_SIZE,
    ACTIVITY_TITLE_SIZE,
    barFillWidth,
    chestOffsetX,
    chestPitch,
    fguiTopLeftToCocos,
    previewBubblePlacement,
    previewBubbleWidth,
    previewCellCount,
    previewCellX,
    rewardNumLayout,
    rewardSlotX,
    type IPreviewAnchorBox,
} from '../assets/script/app/activity/LayerActivityLayout';
import {
    ACTIVITY_TEXTS,
} from '../assets/script/app/activity/LayerActivityTexts';
import {
    ACTIVITY_STATE_FINISH,
    ACTIVITY_STATE_REWARDED,
    activityCoinOf,
    barRatioOf,
    boxClaimed,
    boxPhaseOf,
    chestRatioOf,
    DAY_CHALLENGE_ACT_TYPE,
    EMPTY_ACTIVITY_STATE,
    findDayChallengeTab,
    lastBoxCost,
    normalizeActivityState,
    parseItemRows,
    parseProgressRows,
    parseRewards,
    parseRolePropertyRows,
    parseTabRows,
    parseTaskRows,
    rewardGoodsOf,
    sortTasksForDisplay,
    stateSignatureOf,
    taskHasRedDot,
    taskPhaseOf,
    taskProgressText,
    type IActivityProgressRow,
    type IActivityServerState,
    type IActivityTaskRow,
} from '../assets/script/app/activity/LayerActivityTable';
import {
    RESOURCE_ICON_ART_ROOT,
    resolveRewardIconRef,
} from '../assets/script/app/activity/LayerActivityArt';
import {
    ACTIVITY_JUMP_ROUTES,
    JUMP_TYPE,
    activityJumpLabel,
    activityJumpTargetIds,
    activityJumpTargets,
    hasActivityJumpRoute,
    resolveActivityJump,
} from '../assets/script/app/activity/ActivityJumpTable';
import { assetPath } from './helpers/asset-paths';

// ============================================================
// 真实资源
// ============================================================

const PREFAB = assetPath('ui/Activity/Activity.prefab');
const TASK_TABLE = 'assets/remoteRef/dayChallengeActTask.json';
const PROGRESS_TABLE = 'assets/remoteRef/dayChallengeActTaskProgress.json';
const TAB_TABLE = 'assets/remoteRef/activityTab.json';

const PREFAB_TREE = JSON.parse(readFileSync(PREFAB, 'utf8')) as unknown[];
const REAL_TASKS = JSON.parse(readFileSync(TASK_TABLE, 'utf8')) as unknown[];
const REAL_TABS = JSON.parse(readFileSync(TAB_TABLE, 'utf8')) as unknown[];

/** `remoteRef` 的列式表 `{k,v}` → 行对象数组（`RefUtil.getRefAllAsync` 的等价物）。 */
function unflatten(raw: { k: string[]; v: unknown[][] }): Record<string, unknown>[] {
    return raw.v.map((row) => {
        const out: Record<string, unknown> = {};
        raw.k.forEach((key, i) => { out[key] = row[i]; });
        return out;
    });
}

const REAL_BOX_ROWS = parseProgressRows(
    unflatten(JSON.parse(readFileSync(PROGRESS_TABLE, 'utf8')) as { k: string[]; v: unknown[][] }),
);
const REAL_TASK_ROWS = parseTaskRows(REAL_TASKS);

/** 造一份「所有任务都无状态」的服务器状态。 */
function stateOf(overrides: Partial<IActivityServerState> = {}): IActivityServerState {
    return { ...EMPTY_ACTIVITY_STATE, ...overrides };
}

/**
 * 浮点近似比较。
 *
 * ⚠️ `rewardNumLayout` 里的 `(86 + 13) * 0.9 - 45` 这类算式落盘是 `44.10000000000001`，
 *    用 `assert.equal(x, 44.1)` 会红 —— 这里统一按 1e-6 判等（与 prefab 落盘精度同量级）。
 */
function close(actual: number, expected: number, what = ''): void {
    assert.ok(
        Math.abs(actual - expected) < 1e-6,
        `${what ? what + '：' : ''}期望 ${expected}，实际 ${actual}`,
    );
}

// ============================================================
// A. 版面几何
// ============================================================

test('A. FGUI 左上角 → Cocos 中心坐标（含父容器尺寸参数）', () => {
    // 720×1280 画布：(0,0) 左上角 → 中心 (-360, 640)
    assert.deepEqual(fguiTopLeftToCocos(0, 0, 0, 0), { x: -360, y: 640 });
    // 满幅 720×1020 摆 y=150 → 中心 x = 0，y = 640-150-510 = -20
    assert.deepEqual(fguiTopLeftToCocos(0, 150, 720, 1020), { x: 0, y: -20 });
    // 显式父容器口径也成立（与默认 720×1280 一致）
    assert.deepEqual(
        fguiTopLeftToCocos(19, 13, 658, 175, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT),
        { x: 19 + 329 - 339.5, y: 95 - 13 - 87.5 },
    );
});

test('A. ⚠️ 条宽 → 节距 → 宝箱节点宽的倒推链（8 档均分）', () => {
    const count = REAL_BOX_ROWS.length;
    assert.equal(count, 8, `宝箱档位数变成 ${count} 了，条宽 / 节距要重算`);

    const pitch = chestPitch(count);
    assert.equal(pitch, ACTIVITY_BAR_WIDTH / count);
    assert.ok(
        pitch >= ACTIVITY_CHEST_NODE_WIDTH,
        `节距 ${pitch} < 宝箱节点宽 ${ACTIVITY_CHEST_NODE_WIDTH}：相邻宝箱节点框会互相压`,
    );
    // 留一点余量（不是刚好相等），否则美术把节点宽调大 1px 就撞
    assert.ok(pitch - ACTIVITY_CHEST_NODE_WIDTH >= 1, '节距只比节点宽大不到 1px，没有余量');

    // ⚠️ 条的左端是**故意伸到徽章底下**的（不越画布即可）；右边不出画布。
    // 别拿 `ACTIVITY_STRIP_WIDTH/2` 当界 —— 那个 606 是 FGUI `list_act` 横滚视窗的宽，
    // 本工程换成一根连续条之后条不再受它约束（条左端 -304 比 -303 还多出 1px，
    // 无妨：`ProgressStrip` 没挂 Mask，多出的那 1px 不会被裁，而且它藏在徽章底下）。
    const medalRightEdge = ACTIVITY_MEDAL_POS.x + ACTIVITY_MEDAL_SIZE.width / 2;
    assert.ok(
        ACTIVITY_BAR_LEFT <= medalRightEdge,
        `条的左端 ${ACTIVITY_BAR_LEFT} 没伸到徽章底下（徽章右缘 ${medalRightEdge}）`,
    );
    assert.ok(
        ACTIVITY_STRIP_POS.x + ACTIVITY_BAR_LEFT + ACTIVITY_BAR_WIDTH <= ACTIVITY_CANVAS_WIDTH / 2,
        '条的右端出画布了',
    );
});

test('A. ⚠️ 用真实表的 cost 驱动：首档不压徽章 / 末档不出画布 / 相邻不叠', () => {
    const costMax = lastBoxCost(REAL_BOX_ROWS);
    assert.equal(costMax, 840, `最高档门槛变成 ${costMax} 了，宝箱位置全部要重算`);

    // 位置 = cost/costMax 的比例，**不是**等分下标（首档 cost=105 ⇒ ratio=0.125，不是 0）
    const centers = REAL_BOX_ROWS.map((row) => chestOffsetX(chestRatioOf(row, costMax)));
    const half = ACTIVITY_CHEST_NODE_WIDTH / 2;

    const medalRight = ACTIVITY_MEDAL_POS.x + ACTIVITY_MEDAL_SIZE.width / 2;
    assert.ok(
        centers[0] - half >= medalRight,
        `首档宝箱左缘 ${centers[0] - half} 压在徽章里（徽章右缘 ${medalRight}）`,
    );

    // 界是**画布**（±360），不是 strip 视窗（±303）：末档宝箱的节点框右缘正好贴住画布右缘。
    const canvasHalf = ACTIVITY_CANVAS_WIDTH / 2;
    const lastCenter = centers[centers.length - 1];
    assert.equal(ACTIVITY_STRIP_POS.x + lastCenter + half, canvasHalf, '末档宝箱节点右缘没贴住画布右缘（有人改过条宽 / 档位数）');
    // 宝箱**图**比节点窄 6px，所以图一定在画布内
    assert.ok(ACTIVITY_STRIP_POS.x + lastCenter + ACTIVITY_CHEST_ART_SIZE / 2 <= canvasHalf);

    for (let i = 1; i < centers.length; i++) {
        const gap = centers[i] - centers[i - 1];
        assert.ok(gap >= ACTIVITY_CHEST_NODE_WIDTH, `第 ${i} 与第 ${i - 1} 档节距 ${gap} < 节点宽（会叠）`);
    }
});

test('A. 进度条取值：clamp / 端点 / 与比例线性（非有限一律 0）', () => {
    assert.equal(barFillWidth(0), 0);
    assert.equal(barFillWidth(1), ACTIVITY_BAR_WIDTH);
    assert.equal(barFillWidth(0.5), ACTIVITY_BAR_WIDTH / 2);
    assert.equal(chestOffsetX(0), ACTIVITY_BAR_LEFT);
    assert.equal(chestOffsetX(1), ACTIVITY_BAR_LEFT + ACTIVITY_BAR_WIDTH);

    // 有限越界：夹进 [0,1]
    assert.equal(barFillWidth(-1), 0);
    assert.equal(barFillWidth(-0.001), 0);
    assert.equal(barFillWidth(1.001), ACTIVITY_BAR_WIDTH);
    assert.equal(barFillWidth(2), ACTIVITY_BAR_WIDTH);
    assert.equal(chestOffsetX(-1), ACTIVITY_BAR_LEFT);
    assert.equal(chestOffsetX(2), ACTIVITY_BAR_LEFT + ACTIVITY_BAR_WIDTH);

    // ⚠️ 口径：`clampRatio` 对**非有限值**一律返回 0（含 `+Infinity`），
    //    也就是「算不出来就不画」，而不是「画满」。别把这条当成 bug 去改：
    //    ratio 来自 `cost/costMax`，两端都是有限数，非有限只可能是上游脏数据。
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(barFillWidth(bad), 0, `barFillWidth(${bad})`);
        assert.equal(chestOffsetX(bad), ACTIVITY_BAR_LEFT, `chestOffsetX(${bad})`);
    }
    for (const ratio of [-5, 0, 0.3, 1, 7, Number.NaN, Number.POSITIVE_INFINITY]) {
        const w = barFillWidth(ratio);
        assert.ok(Number.isFinite(w) && w >= 0 && w <= ACTIVITY_BAR_WIDTH, `barFillWidth(${ratio}) = ${w} 越界`);
    }
});

test('A. ⚠️ 奖励格：350 宽的容器只装得下 3 格 —— 真数据最多 2 格所以没暴露', () => {
    assert.equal(ACTIVITY_ROW_REWARD_SLOTS, 5, 'prefab 里挂了 5 个槽位');
    const xs = Array.from({ length: ACTIVITY_ROW_REWARD_SLOTS }, (_, i) => rewardSlotX(i));
    for (let i = 1; i < xs.length; i++) {
        assert.equal(xs[i] - xs[i - 1], ACTIVITY_ROW_REWARD_SLOT_SIZE + ACTIVITY_ROW_REWARD_SLOT_GAP);
    }
    assert.deepEqual(xs, [-132.5, -42.5, 47.5, 137.5, 227.5]);

    // ⚠️ 遗留：FGUI 原稿这里是个 `overflow="scroll" scroll="horizontal"` 的横向列表
    //    （350 宽、每格 85 + colGap 5 ⇒ 内容 445，本来就装不下 5 格，靠横滑看后面）。
    //    本工程没做那道横滑，所以第 4/5 格会伸出容器右缘并压到右侧按钮上。
    //    当前 `dayChallengeActTask` 每条任务**最多 2 个奖励**，所以从未触发 —— 但这是
    //    真隐患：加奖励加到第 4 个就会和按钮叠在一起，得先给 RewardBar 补 Mask 或改横滑。
    const half = ACTIVITY_ROW_REWARD_BAR_SIZE.width / 2;
    const fits = xs.filter((x) => x + ACTIVITY_ROW_REWARD_SLOT_SIZE / 2 <= half).length;
    assert.equal(fits, 3, '容器能完整装下的格数变了，同步改这条注释');

    const realMaxRewards = Math.max(...REAL_TASK_ROWS.map((row) => row.rewards.length));
    assert.ok(
        realMaxRewards <= fits,
        `真实表里已有任务带 ${realMaxRewards} 个奖励 > 容器装得下的 ${fits} 格 —— 奖励格已经压到按钮上了`,
    );
    // 第 1 格也不能出左缘
    assert.ok(xs[0] - ACTIVITY_ROW_REWARD_SLOT_SIZE / 2 >= -half);
});

test('A. 行内各元素的框都落在行模板 679×190 内', () => {
    const rowHalfW = ACTIVITY_ROW_WIDTH / 2;
    const rowHalfH = ACTIVITY_ROW_HEIGHT / 2;
    const boxes: [string, { x: number; y: number }, { width: number; height: number }][] = [
        ['行底框', ACTIVITY_ROW_BG_POS, ACTIVITY_ROW_BG_SIZE],
        ['奖励栏', ACTIVITY_ROW_REWARD_BAR_POS, ACTIVITY_ROW_REWARD_BAR_SIZE],
        ['按钮', ACTIVITY_ROW_ACTION_POS, ACTIVITY_ROW_ACTION_SIZE],
        ['印章', ACTIVITY_ROW_STAMP_POS, ACTIVITY_ROW_STAMP_SIZE],
    ];
    for (const [name, pos, size] of boxes) {
        assert.ok(pos.x - size.width / 2 >= -rowHalfW - 0.001, `${name} 出左缘`);
        assert.ok(pos.x + size.width / 2 <= rowHalfW + 0.001, `${name} 出右缘`);
        assert.ok(pos.y - size.height / 2 >= -rowHalfH - 0.001, `${name} 出下缘`);
        assert.ok(pos.y + size.height / 2 <= rowHalfH + 0.001, `${name} 出上缘`);
    }
});

test('A. ⚠️ 标题飘带：FGUI 的 scale 没写 pivot ⇒ 必须按左上角缩放', () => {
    // POS 是飘带的**左上角**（不是中心），配合锚点 (0,1) + scaleY=0.7
    assert.equal(ACTIVITY_ROW_RIBBON_POS.x, -ACTIVITY_ROW_WIDTH / 2 - 2);
    assert.equal(ACTIVITY_ROW_RIBBON_POS.y, ACTIVITY_ROW_HEIGHT / 2);
    assert.equal(ACTIVITY_ROW_RIBBON_SCALE_Y, 0.7);

    // 缩放后的可见下缘 = 顶边 - 高×0.7；标题框必须整块落在飘带可见区内
    const ribbonBottom = ACTIVITY_ROW_RIBBON_POS.y - ACTIVITY_ROW_RIBBON_SIZE.height * ACTIVITY_ROW_RIBBON_SCALE_Y;
    assert.equal(ribbonBottom, 21.5);
    // 标题框（左缘 = 21 - 679/2，宽 340）
    assert.equal(ACTIVITY_ROW_TITLE_LEFT, -318.5);
    assert.ok(ACTIVITY_ROW_TITLE_LEFT >= ACTIVITY_ROW_RIBBON_POS.x, '标题出飘带左缘');
    assert.ok(
        ACTIVITY_ROW_TITLE_LEFT + ACTIVITY_ROW_TITLE_SIZE.width <= ACTIVITY_ROW_RIBBON_POS.x + ACTIVITY_ROW_RIBBON_SIZE.width,
        '标题出飘带右缘',
    );
    // 若有人把飘带改成居中锚点（POS 变中心），下缘会掉到 6.5，标题就被挤出飘带
    assert.ok(ribbonBottom > 21, '飘带可见下缘算错 —— 很可能又被当成居中缩放了');
});

test('A. 标题框比 FGUI 的 206 宽 —— 否则 4/5 条任务名会被 SHRINK 缩到 13~17px', () => {
    // FGUI 原稿是 206，最长的任务名在 21px 下标称宽 323，照抄会缩字
    assert.equal(ACTIVITY_ROW_TITLE_SIZE.width, 340);
    assert.ok(ACTIVITY_ROW_TITLE_SIZE.width > 206);
    // 右缘仍在飘带内
    assert.ok(ACTIVITY_ROW_TITLE_LEFT + ACTIVITY_ROW_TITLE_SIZE.width <= ACTIVITY_ROW_RIBBON_POS.x + ACTIVITY_ROW_RIBBON_SIZE.width);
});

// ============================================================
// B. prefab ↔ layout 对拍
// ============================================================

interface PrefabBox {
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly top: number;
    readonly w: number;
    readonly h: number;
    readonly ax: number;
    readonly ay: number;
}

const PREFAB_INDEX = (() => {
    const objOf = (i: number) => PREFAB_TREE[i] as Record<string, unknown>;
    const byType = (i: number, type: string) => {
        const node = objOf(i);
        for (const ref of (node._components as { __id__: number }[] | undefined) ?? []) {
            const comp = objOf(ref.__id__);
            if (comp && String(comp.__type__).startsWith(type)) return comp;
        }
        return null;
    };
    // path → node 下标
    const pathIdx = new Map<string, number>();
    let root = -1;
    PREFAB_TREE.forEach((raw, i) => {
        const node = raw as Record<string, unknown>;
        if (node.__type__ === 'cc.Node' && node._name === 'Activity' && root < 0) root = i;
    });
    const walk = (i: number, prefix: string) => {
        const node = objOf(i);
        for (const child of (node._children as { __id__: number }[] | undefined) ?? []) {
            const name = String(objOf(child.__id__)._name);
            const path = prefix ? `${prefix}/${name}` : name;
            if (!pathIdx.has(path)) pathIdx.set(path, child.__id__);
            walk(child.__id__, path);
        }
    };
    pathIdx.set('', root);
    walk(root, '');
    return { objOf, byType, pathIdx, root };
})();

function prefabBox(path: string): PrefabBox | null {
    const i = PREFAB_INDEX.pathIdx.get(path);
    if (i === undefined) return null;
    const node = PREFAB_INDEX.objOf(i);
    const ut = PREFAB_INDEX.byType(i, 'cc.UITransform');
    if (!ut) return null;
    const size = ut._contentSize as { width: number; height: number };
    const anchor = ut._anchorPoint as { x: number; y: number };
    const pos = node._lpos as { x: number; y: number };
    return {
        left: pos.x - anchor.x * size.width,
        right: pos.x + (1 - anchor.x) * size.width,
        bottom: pos.y - anchor.y * size.height,
        top: pos.y + (1 - anchor.y) * size.height,
        w: size.width,
        h: size.height,
        ax: anchor.x,
        ay: anchor.y,
    };
}

function prefabChildren(path: string): string[] {
    const i = PREFAB_INDEX.pathIdx.get(path)!;
    const node = PREFAB_INDEX.objOf(i);
    return ((node._children as { __id__: number }[] | undefined) ?? []).map((c) => String(PREFAB_INDEX.objOf(c.__id__)._name));
}

test('B. prefab 存在且根为 720×1280', () => {
    const root = prefabBox('');
    assert.ok(root, '解析不出 prefab 根节点');
    assert.equal(root!.w, ACTIVITY_CANVAS_WIDTH);
    assert.equal(root!.h, ACTIVITY_CANVAS_HEIGHT);
});

test('B. ⚠️ prefab 每个节点的 layer 都是 UI_2D —— 落 DEFAULT 会整棵子树不渲染', () => {
    const bad: string[] = [];
    PREFAB_TREE.forEach((raw) => {
        const node = raw as Record<string, unknown>;
        if (node.__type__ === 'cc.Node' && node._layer !== 33554432) bad.push(String(node._name));
    });
    assert.deepEqual(bad, [], `这些节点 layer 不是 UI_2D(33554432)：${bad.join(', ')}`);
});

test('B. 进度条 / 宝箱：prefab 摆位 == layout 常量', () => {
    const barBg = prefabBox('ProgressStrip/BarBg')!;
    assert.equal(barBg.left, ACTIVITY_BAR_LEFT);
    assert.equal(barBg.right, ACTIVITY_BAR_LEFT + ACTIVITY_BAR_WIDTH);
    assert.equal(barBg.h, ACTIVITY_BAR_HEIGHT);
    assert.equal((barBg.top + barBg.bottom) / 2, ACTIVITY_BAR_CENTER_Y);

    // 填充锚点必须在左端 (0, 0.5)，否则改宽度时不是从左往右长
    const barFill = prefabBox('ProgressStrip/BarFill')!;
    assert.equal(barFill.ax, 0);
    assert.equal(barFill.ay, 0.5);
    assert.equal(barFill.left, ACTIVITY_BAR_LEFT);

    const box = prefabBox('ProgressStrip/BoxRow/BoxTemplate')!;
    assert.equal(box.w, ACTIVITY_CHEST_NODE_WIDTH);
    assert.equal(box.h, ACTIVITY_CHEST_NODE_HEIGHT);
    assert.equal((box.top + box.bottom) / 2, ACTIVITY_CHEST_CENTER_Y);
    // 图比节点小（原图有透明边），且必须 sizeMode=CUSTOM 才不会回写 100×100
    const art = prefabBox('ProgressStrip/BoxRow/BoxTemplate/ChestBtn/Bg')!;
    assert.equal(art.w, ACTIVITY_CHEST_ART_SIZE);
    assert.equal(art.h, ACTIVITY_CHEST_ART_SIZE);
    assert.ok(art.w < box.w, '宝箱图不该比节点宽 —— 那样相邻宝箱会看起来粘住');
});

test('B. 任务行：prefab 摆位 == layout 常量', () => {
    // 行模板锚点 (0.5, 0.5) + y = -95 ⇒ 占 -190..0，顶边与 content 顶边齐（和 SevenDay 同口径）
    const row = prefabBox('RowView/content/RowTemplate')!;
    assert.equal(row.w, ACTIVITY_ROW_WIDTH);
    assert.equal(row.h, ACTIVITY_ROW_HEIGHT);
    assert.equal(row.ax, 0.5);
    assert.equal(row.ay, 0.5);
    assert.equal(row.top, 0, '行模板顶边必须与 content 顶边齐平');

    const title = prefabBox('RowView/content/RowTemplate/Title')!;
    assert.equal(title.left, ACTIVITY_ROW_TITLE_LEFT);
    assert.equal(title.w, ACTIVITY_ROW_TITLE_SIZE.width);

    const bar = prefabBox('RowView/content/RowTemplate/RewardBar')!;
    assert.equal(bar.w, ACTIVITY_ROW_REWARD_BAR_SIZE.width);
    assert.equal(bar.h, ACTIVITY_ROW_REWARD_BAR_SIZE.height);

    const btn = prefabBox('RowView/content/RowTemplate/ActionBtn')!;
    assert.equal(btn.w, ACTIVITY_ROW_ACTION_SIZE.width);
    assert.equal(btn.h, ACTIVITY_ROW_ACTION_SIZE.height);

    // 5 个槽位横向位置 == layout 的推导；frame 锚点居中
    for (let n = 1; n <= ACTIVITY_ROW_REWARD_SLOTS; n++) {
        const slot = prefabBox(`RowView/content/RowTemplate/RewardBar/Slot${n}`)!;
        assert.equal(slot.w, ACTIVITY_ROW_REWARD_SLOT_SIZE, `Slot${n} 宽`);
        assert.equal(slot.h, ACTIVITY_ROW_REWARD_SLOT_SIZE, `Slot${n} 高`);
        assert.equal(slot.ax, 0.5);
        assert.equal((slot.left + slot.right) / 2, rewardSlotX(n - 1), `Slot${n} 的 x 与 rewardSlotX 不一致`);
    }
});

test('B. ⚠️ 奖励格必须有 Num（数量）：锚点 (1,0.5) + 右对齐 + overflow=NONE', () => {
    // 缺口来源：FGUI 里的数量在**物品框自己**身上
    // （`共用组件/组件/物品框/组件_公用_道具.xml` 的 `<richtext name="text_number">`），
    // 不在 `组件_活动列表_项_奖励Item.xml` 里 —— 只照着后者搬就会**整块漏掉数量**。
    for (let n = 1; n <= ACTIVITY_ROW_REWARD_SLOTS; n++) {
        const base = `RowView/content/RowTemplate/RewardBar/Slot${n}`;
        const path = `${base}/Num`;
        const box = prefabBox(path);
        assert.ok(box, `${path} 不存在 —— 奖励数量不会显示`);
        // 锚点必须是 (1, 0.5)：位数变长时把**右缘**钉死（左对齐/居中会让数字跟着漂）
        assert.equal(box!.ax, 1, `${path} 锚点 x 必须是 1`);
        assert.equal(box!.ay, 0.5, `${path} 锚点 y 必须是 0.5`);
        assert.ok(
            Math.abs(box!.right - ACTIVITY_ROW_REWARD_NUM_POS.x) < 0.01,
            `${path} 右缘 ${box!.right} ≠ ACTIVITY_ROW_REWARD_NUM_POS.x ${ACTIVITY_ROW_REWARD_NUM_POS.x}`,
        );

        const label = PREFAB_INDEX.byType(PREFAB_INDEX.pathIdx.get(path)!, 'cc.Label');
        assert.ok(label, `${path} 上没有 cc.Label`);
        assert.equal(label!._fontSize, ACTIVITY_ROW_REWARD_NUM_FONT_SIZE, `${path} 字号`);
        // CLAMP 会把 4 位数的「1000」裁掉；SHRINK 会把字缩小 ⇒ 必须 NONE，让它往左溢
        assert.equal(label!._overflow, 0, `${path} overflow 必须 NONE`);
        assert.equal(label!._horizontalAlign, 2, `${path} 必须右对齐`);
        // 数量必须排在 Icon **之后**（后添加的兄弟画在上层），否则被道具图盖住
        const kids = prefabChildren(base);
        assert.ok(
            kids.indexOf('Icon') >= 0 && kids.indexOf('Icon') < kids.indexOf('Num'),
            `${base} 里 Num 必须在 Icon 之后（当前序：${kids.join(',')}）`,
        );
    }
});

test('B. ⚠️ 奖励数量必须「无条件写」+ 走 itemNumberTextOf —— 复用格不会留下上一行的数字', () => {
    // 整行会被虚拟列表 clone 复用：「有值才写」会让「上一行有数量、这一行没数量」的格子
    // 把旧数字留在界面上，且不报错（规则 82 同款缺陷）。
    const slot = readFileSync('assets/script/app/activity/ActivityRewardSlot.ts', 'utf8');
    assert.ok(/this\.num\.string = numberText;/.test(slot), 'ActivityRewardSlot.render 必须无条件写 num.string');
    assert.ok(
        /this\.num\.node\.active = numberText\.length > 0;/.test(slot),
        '数量为空串时必须整块隐藏（不是留个空 Label）',
    );

    // 数量文案必须走全工程同一条口径（`0 ⇒ ''`、纯整数不缩写），别在这里 `String(number)`
    const page = readFileSync('assets/script/app/activity/LayerActivityPage.ts', 'utf8');
    assert.ok(
        /numberText: itemNumberTextOf\(reward\.number\)/.test(page),
        'buildRowView 必须用 itemNumberTextOf(reward.number) 生成数量文案',
    );
});

/** 根节点上的主脚本组件（`cc.*` 之外的那个）。 */
function rootScript(): Record<string, unknown> {
    const i = PREFAB_INDEX.pathIdx.get('')!;
    const node = PREFAB_INDEX.objOf(i);
    for (const ref of ((node._components as { __id__: number }[] | undefined) ?? [])) {
        const comp = PREFAB_INDEX.objOf(ref.__id__);
        if (comp && !String(comp.__type__).startsWith('cc.')) return comp;
    }
    throw new Error('prefab 根上没有脚本组件');
}

/** `{ __id__ }` 引用指向的**节点**名（传组件引用会得到空串）。 */
function refNodeName(value: unknown): string {
    const id = (value as { __id__?: number } | null)?.__id__;
    if (id === undefined) return '';
    return String(PREFAB_INDEX.objOf(id)._name ?? '');
}

test('B. ⚠️ 长屏适配：贴顶名单与 prefab 名字硬绑定（改名要红）', () => {
    // `topAlignedNodes` 是 `nodeArray`，MCP 写不进去（扩展漏传 dump.type）⇒ 名单落在代码里，
    // 于是「代码里的名字」与「prefab 里的节点名」之间**没有编译期约束** ——
    // 改名会让长屏适配**静默偏掉**（只是位置差一点，不报错），只能由这条用例钉住。
    const src = readFileSync('assets/script/app/activity/LayerActivityPage.ts', 'utf8');
    const block = /const ACTIVITY_HEADER_NODES: readonly string\[\] = \[([\s\S]*?)\n\];/.exec(src);
    assert.ok(block, 'LayerActivityPage.ts 里找不到 ACTIVITY_HEADER_NODES 表');
    const names = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(names.length >= 5, `贴顶名单太短（读到的名字：${names.join(',')}）`);

    const rootKids = prefabChildren('');
    for (const name of names) {
        assert.ok(rootKids.includes(name), `贴顶名单里的「${name}」不在 prefab 根下（改名了？长屏适配会静默偏掉）`);
    }

    // 面板必须是九宫底（长屏只长高，靠 9-slice 平铺；SIMPLE 拉伸会变形）
    const panelSprite = PREFAB_INDEX.byType(PREFAB_INDEX.pathIdx.get('PanelBg')!, 'cc.Sprite');
    assert.ok(panelSprite, 'PanelBg 上没有 cc.Sprite');
    assert.equal(panelSprite!._type, 1, 'PanelBg 不是 SLICED（9 宫），长屏拉伸会变形');
});

test('B. ⚠️ 长屏适配：panel 绑到 PanelBg，且 onInit 抓基线 / onOpen 应用', () => {
    assert.equal(refNodeName(rootScript().panel), 'PanelBg', 'LayerActivityPage.panel 没绑到 PanelBg');

    // 顺序错了会**累加偏移**：基线若在 onOpen 里抓（那时已经 apply 过一次），
    // 每开关一次弹窗就整体再往上挪 extra/2。
    const src = readFileSync('assets/script/app/activity/LayerActivityPage.ts', 'utf8');
    const onInit = /protected onInit\(\): void \{([\s\S]*?)\n {4}\}/.exec(src);
    assert.ok(onInit, '读不到 onInit 的实现体');
    assert.ok(
        onInit![1].indexOf('captureLayoutBase()') >= 0,
        'onInit 里必须调 captureLayoutBase() —— 基线要在 prefab 还没被 applyScreenLayout 动过时抓',
    );
    assert.ok(onInit![1].indexOf('bindBlankContent()') >= 0, 'onInit 里必须调 bindBlankContent()');
    const onOpen = /protected async onOpen\(\): Promise<void> \{([\s\S]*?)\n {4}\}/.exec(src);
    assert.ok(onOpen, '读不到 onOpen 的实现体');
    assert.ok(onOpen![1].indexOf('applyScreenLayout()') >= 0, 'onOpen 里必须调 applyScreenLayout()');
});

test('B. 列表视窗 / content 锚点必须是 (0.5, 1)（VScrollView 约定）', () => {
    const list = prefabBox('RowView')!;
    assert.equal(list.ax, 0.5);
    assert.equal(list.ay, 1, '视窗锚点不是 (0.5,1) —— 整条列表会下移半个视口高');
    assert.equal(list.w, ACTIVITY_LIST_SIZE.width);
    assert.equal(list.h, ACTIVITY_LIST_SIZE.height);

    const content = prefabBox('RowView/content')!;
    assert.equal(content.ax, 0.5);
    assert.equal(content.ay, 1);
    assert.equal(content.w, ACTIVITY_LIST_SIZE.width);
    assert.equal(content.h, ACTIVITY_LIST_SIZE.height);
});

test('B. ⚠️ 渲染序（_children 序 = 渲染序）：标题字必须在标题图之上', () => {
    const top = prefabChildren('');
    assert.ok(top.indexOf('TitleArt') >= 0 && top.indexOf('TitleLabel') >= 0);
    assert.ok(
        top.indexOf('TitleArt') < top.indexOf('TitleLabel'),
        `TitleArt 排在 TitleLabel 之后 ⇒ 461×119 的横幅图会把「每日任务」整块盖住（当前序：${top.join(',')}）`,
    );

    const strip = prefabChildren('ProgressStrip');
    // 宝箱的底缘与进度条顶缘重叠 10px ⇒ 宝箱必须描在条之上
    assert.ok(
        strip.indexOf('BoxRow') > strip.indexOf('BarFill'),
        'BoxRow 排在 BarFill 之前 ⇒ 进度填充会盖住宝箱',
    );
    // 「周活跃」页签与徽章重叠 7px ⇒ 页签必须压在徽章之上（对齐 FGUI displayList）
    assert.ok(
        strip.indexOf('WeekTag') > strip.indexOf('Medal'),
        'WeekTag 排在 Medal 之前 ⇒ 页签被徽章压住',
    );

    // ⚠️ 下面三条是 2026-09-28 补的：原来只查了页面级，**行内三层全漏**，
    //    结果 prefab 里 Ribbon 排在 Title 之后（飘带 `act_row_ribbon` 把任务名整条盖住）、
    //    ActionBtn/Bg 排在 Label 之后（按钮底图把「前往」盖住）——两处肉眼都看不到字，
    //    而单测全绿（这条用例当时只覆盖了 `TitleArt/TitleLabel` 与 `ProgressStrip`）。
    const row = prefabChildren('RowView/content/RowTemplate');
    assert.ok(
        row.indexOf('Ribbon') >= 0 && row.indexOf('Title') >= 0 && row.indexOf('Ribbon') < row.indexOf('Title'),
        `Ribbon 排在 Title 之后 ⇒ 420×105 的飘带会把任务名整条盖住（当前序：${row.join(',')}）`,
    );
    const actionBtn = prefabChildren('RowView/content/RowTemplate/ActionBtn');
    assert.ok(
        actionBtn.indexOf('Bg') >= 0 && actionBtn.indexOf('Label') >= 0
            && actionBtn.indexOf('Bg') < actionBtn.indexOf('Label'),
        `ActionBtn/Bg 排在 Label 之后 ⇒ 按钮底图会把文案盖住（当前序：${actionBtn.join(',')}）`,
    );
    // FGUI `组件_活动_宝箱item` 的 displayList 是「宝箱本体 → 积分 → 对勾 → 可领取字」
    // ⇒ 对勾（`tag_gou`）必须在宝箱图**之上**，否则已领取的宝箱看不到对勾。
    const chest = prefabChildren('ProgressStrip/BoxRow/BoxTemplate/ChestBtn');
    assert.ok(
        chest.indexOf('Bg') >= 0 && chest.indexOf('Check') >= 0 && chest.indexOf('Bg') < chest.indexOf('Check'),
        `ChestBtn/Bg 排在 Check 之后 ⇒ 宝箱图会把已领取的对勾盖住（当前序：${chest.join(',')}）`,
    );
});

test('B. ⚠️ 标题横幅绑的是 act_title（木板牌），不是同名的 image/common/title_02', () => {
    const sfUuid = (() => {
        const i = PREFAB_INDEX.pathIdx.get('TitleArt')!;
        const sprite = PREFAB_INDEX.byType(i, 'cc.Sprite')!;
        return ((sprite._spriteFrame as { __uuid__?: string } | null)?.__uuid__) ?? '';
    })();
    assert.notEqual(sfUuid, '', 'TitleArt 没绑图');
    // image/common/title_02.png = 253×44 扁平箭头条（宽高比 5.75），拉进 461×119 会双向变形
    assert.notEqual(sfUuid, 'a957fd35-0792-4a27-9de3-85a44274a5d0@f9941', 'TitleArt 绑回了 image/common/title_02');
    assert.equal(sfUuid, '7a075eb6-bf94-4d16-a060-b5a9eff0d100@f9941', 'TitleArt 的图换过了，同步更新这条断言');
});

// ============================================================
// C. 表解析
// ============================================================

test('C. parseRewards：非法条目跳过，不抛', () => {
    assert.deepEqual(parseRewards(undefined), []);
    assert.deepEqual(parseRewards(null), []);
    assert.deepEqual(parseRewards('x'), []);
    assert.deepEqual(parseRewards([1, 'a', null, {}]), []);
    // resId / number <= 0 的条目跳过
    assert.deepEqual(parseRewards([{ resId: 0, number: 1 }, { resId: 1, number: 0 }]), []);
    assert.deepEqual(parseRewards([{ resId: 10060, number: 2 }]), [{ resId: 10060, number: 2 }]);
    // 数字字符串也认
    assert.deepEqual(parseRewards([{ resId: '8', number: '40' }]), [{ resId: 8, number: 40 }]);
});

test('C. 真实 dayChallengeActTask：5 条任务、按 order 升序、字段齐', () => {
    assert.equal(REAL_TASK_ROWS.length, 5);
    assert.deepEqual(REAL_TASK_ROWS.map((r) => r.resId), [1, 2, 3, 4, 5]);
    assert.deepEqual(REAL_TASK_ROWS.map((r) => r.order), [1, 2, 3, 4, 5]);
    assert.deepEqual(REAL_TASK_ROWS.map((r) => r.name), [
        '累计消耗20点体力',
        '合成一次宝石',
        '完成1次装备升级',
        '累计击杀2000只怪物',
        '累计击败1个精英或首领',
    ]);
    // param.count 打平进 count
    assert.deepEqual(REAL_TASK_ROWS.map((r) => r.count), [20, 1, 1, 2000, 1]);
    // 每条都得有跳转目标，否则按钮会退化成「未完成」
    for (const row of REAL_TASK_ROWS) assert.ok(row.goto > 0, `${row.name} 没有 goto`);
    for (const row of REAL_TASK_ROWS) assert.equal(row.rewards.length, 2, `${row.name} 的奖励条数变了`);
});

test('C. 真实 dayChallengeActTaskProgress：8 档、cost 105..840 等步长', () => {
    assert.equal(REAL_BOX_ROWS.length, 8);
    assert.deepEqual(REAL_BOX_ROWS.map((r) => r.id), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(REAL_BOX_ROWS.map((r) => r.cost), [105, 210, 315, 420, 525, 630, 735, 840]);
    assert.equal(lastBoxCost(REAL_BOX_ROWS), 840);
    // cost 单调不减（宝箱位置依赖这一点）
    for (let i = 1; i < REAL_BOX_ROWS.length; i++) {
        assert.ok(REAL_BOX_ROWS[i].cost > REAL_BOX_ROWS[i - 1].cost);
    }
    assert.ok(REAL_BOX_ROWS.every((r) => r.rewards.length > 0));
});

test('C. 真实 activityTab：id=1 是每日任务（tlType 含 1001）', () => {
    const tabs = parseTabRows(REAL_TABS);
    assert.equal(tabs.length, 4);
    const dayTab = findDayChallengeTab(tabs);
    assert.ok(dayTab, '找不到每日任务页签');
    assert.equal(dayTab!.id, 1);
    assert.equal(dayTab!.name, '每日任务');
    assert.equal(dayTab!.key, 'dailyTask');
    assert.ok(dayTab!.types.includes(DAY_CHALLENGE_ACT_TYPE));
    // 别的页签不该被误判
    for (const tab of tabs) {
        if (tab.id !== 1) assert.equal(findDayChallengeTab([tab]), null, `tab ${tab.id} 被误判成每日任务`);
    }
});

test('C. parseTaskRows 的降级口径：无 resId / 无 name 的行被丢掉', () => {
    const rows = parseTaskRows([
        { resId: 0, name: 'a' },
        { resId: 1, name: '' },
        { resId: 2, name: 'ok' },
        null,
        'x',
    ]);
    assert.deepEqual(rows.map((r) => r.resId), [2]);
    assert.equal(rows[0].count, 0, 'param 缺失时 count 应为 0');
    assert.deepEqual(rows[0].rewards, []);
});

test('C. parseProgressRows / parseItemRows 的降级口径', () => {
    assert.deepEqual(parseProgressRows([{ id: 1, cost: 0 }]), [], 'cost<=0 的档位丢掉');
    assert.deepEqual(parseProgressRows([{ id: 0, cost: 10 }]), []);
    assert.deepEqual(parseProgressRows([{ id: 2, cost: 10 }, { id: 1, cost: 5 }]).map((r) => r.id), [1, 2]);

    const items = parseItemRows([
        { resId: 15, quality: 3, icon: 'icons/item/图标_灵石', name: '灵石' },
        { resId: 0, quality: 1, icon: 'x' },
        { resId: 8, quality: '5', icon: 123 },
    ]);
    assert.equal(items.size, 2);
    assert.deepEqual(items.get(15), { name: '灵石', quality: 3, icon: 'icons/item/图标_灵石', iconIsPath: true });
    assert.deepEqual(items.get(8), { name: '', quality: 5, icon: '', iconIsPath: true }, 'icon 非字符串应降级成空串');
});

test('C. parseRolePropertyRows / rewardGoodsOf：货币类奖励靠 roleProperty 兜住', () => {
    const res = parseRolePropertyRows([
        { resId: 15, name: '活跃度', quality: 4, icon: '图标_活跃度' },
        { resId: 0, name: 'x', quality: 1, icon: 'x' },
        { resId: 7, name: '银币', quality: 3, icon: 123 },
    ]);
    assert.equal(res.size, 2);
    assert.deepEqual(res.get(15), { name: '活跃度', quality: 4, icon: '图标_活跃度', iconIsPath: false });
    assert.equal(res.get(7)!.icon, '', 'icon 非字符串应降级成空串');

    // ⚠️ roleProperty.icon 是 FGUI 组件名 ⇒ iconIsPath 必须是 false，
    //    否则会被 `resolveItemIconRef` 当成「裸名」拒掉（规则 56）
    assert.equal(res.get(15)!.iconIsPath, false);

    const items = parseItemRows([{ resId: 15, quality: 2, icon: 'icons/item/图标_甲' }]);
    assert.equal(rewardGoodsOf(15, items, res)!.icon, 'icons/item/图标_甲', 'item 命中时优先');
    assert.equal(rewardGoodsOf(7, items, res)!.name, '银币', 'item 没有则回落 roleProperty');
    assert.equal(rewardGoodsOf(999, items, res), null, '两张表都没有 ⇒ null（降级成只画品质框）');
});

test('C. resolveRewardIconRef：item 走路径直通、roleProperty 落 icons/resource', () => {
    const items = parseItemRows([{ resId: 10011, quality: 3, icon: 'icons/item/图标_图纸_问号', name: '随机装备图纸' }]);
    const res = parseRolePropertyRows([{ resId: 15, name: '活跃度', quality: 4, icon: '图标_活跃度' }]);

    assert.equal(RESOURCE_ICON_ART_ROOT, 'icons/resource');
    assert.deepEqual(resolveRewardIconRef(items.get(10011)!), { root: 'icons/item', name: '图标_图纸_问号' });
    assert.deepEqual(resolveRewardIconRef(res.get(15)!), { root: RESOURCE_ICON_ART_ROOT, name: '图标_活跃度' });
    // `item` 里的**老格式裸名**（没迁过的那几行）仍然解析不出 —— 不能拿 FGUI 组件名当路径去 load
    assert.equal(resolveRewardIconRef({ name: '', quality: 1, icon: '图标_图纸_帽子', iconIsPath: true }), null);
    assert.equal(resolveRewardIconRef({ name: '', quality: 1, icon: '', iconIsPath: false }), null);
    assert.equal(resolveRewardIconRef(null), null);
});

test('⚠️ 真实 dayChallengeActTask 的每个奖励都解析得出图标，且图真的在磁盘上', () => {
    // ⚠️ `item` / `roleProperty` 这两张表在 `remoteRef` 里是**普通数组**（不是 `{k,v}` 列式）——
    //    列式的只有 `dayChallengeActTaskProgress` 那一类，别一律套 `unflatten`。
    const items = parseItemRows(JSON.parse(readFileSync('assets/remoteRef/item.json', 'utf8')) as unknown[]);
    const resources = parseRolePropertyRows(JSON.parse(readFileSync('assets/remoteRef/roleProperty.json', 'utf8')) as unknown[]);

    const seen = new Map<number, { root: string; name: string }>();
    for (const task of REAL_TASK_ROWS) {
        for (const reward of task.rewards) {
            const info = rewardGoodsOf(reward.resId, items, resources);
            assert.ok(info, `奖励 resId=${reward.resId}（任务 ${task.resId}）在 item / roleProperty 里都查不到`);
            const ref = resolveRewardIconRef(info);
            assert.ok(ref, `奖励 resId=${reward.resId} 解析不出资源路径（icon="${info!.icon}"）`);
            seen.set(reward.resId, ref!);
        }
    }

    // ⚠️ 这两条是本次缺口的核心判据：只搬 `item` 那一支时，
    //    10 个奖励格里 8 个（银币 7 / 洗炼石 8 / 金币 10 / 活跃度 15）会只剩品质框、没有图标。
    assert.ok(Array.from(seen.values()).some((r) => r.root === 'icons/item'), '应该有用 item 表路径的奖励');
    assert.ok(Array.from(seen.values()).some((r) => r.root === RESOURCE_ICON_ART_ROOT),
        '应该有用 roleProperty 兜的货币类奖励（活跃度每条任务都发）');
    assert.deepEqual(seen.get(15), { root: RESOURCE_ICON_ART_ROOT, name: '图标_活跃度' },
        '活跃度 15 ⇒ icons/resource/图标_活跃度（zarts 原图叫 `活跃度.png`，按 icon.json 的 key 改了名）');

    for (const [resId, ref] of seen) {
        const file = assetPath(`${ref.root}/${ref.name}.png`);
        assert.ok(existsSync(file), `奖励 resId=${resId} 的图标文件不存在：${file}`);
    }
});

// ============================================================
// C. 服务器状态与任务口径
// ============================================================

test('C. normalizeActivityState：只收 type=1001 的那条 CmdActivity', () => {
    const activityRows = [{ resId: 900, type: DAY_CHALLENGE_ACT_TYPE }, { resId: 901, type: 1002 }];
    const state = normalizeActivityState([
        // type 不对 —— 必须跳过
        {
            activityRefId: 901, openResId: 9999,
            detail: { dayChallengeActDetail: { tlDayChallengeTask: [{ resId: 1, process: 5, state: 1 }] } },
        },
        {
            activityRefId: 900, openResId: 1234,
            detail: {
                dayChallengeActDetail: {
                    tlDayChallengeTask: [{ resId: 1, process: 20, state: ACTIVITY_STATE_FINISH }],
                    tlProgressInfo: [1, 0, 1],
                },
            },
        },
    ], activityRows);

    assert.equal(state.instanceId, 1234);
    assert.deepEqual(state.tasks.get(1), { process: 20, state: ACTIVITY_STATE_FINISH });
    assert.deepEqual(state.claimedBoxes, [1, 0, 1]);
    assert.equal(state.coin, 0, 'coin 挂在 CmdRole 上，不该从这里出');
});

test('C. normalizeActivityState：找不到 / 脏数据 → EMPTY，不抛', () => {
    assert.equal(normalizeActivityState([], []).instanceId, 0);
    assert.equal(normalizeActivityState(null as unknown as [], null as unknown as []).instanceId, 0);
    assert.equal(normalizeActivityState([{ activityRefId: 900 }], []).instanceId, 0);
    // detail 缺失不应抛
    const state = normalizeActivityState([{ activityRefId: 900, openResId: 7 }], [{ resId: 900, type: DAY_CHALLENGE_ACT_TYPE }]);
    assert.equal(state.instanceId, 7);
    assert.equal(state.tasks.size, 0);
    assert.deepEqual(state.claimedBoxes, []);
});

test('C. activityCoinOf：取第一条 >0 的 activityCoin，全空返回 0', () => {
    assert.equal(activityCoinOf([]), 0);
    assert.equal(activityCoinOf([{}]), 0);
    assert.equal(activityCoinOf([{ activityCoin: 0 }, { activityCoin: 500 }]), 500);
    assert.equal(activityCoinOf([{ activityCoin: 300 }, { activityCoin: 500 }]), 300);
});

test('C. taskPhaseOf：四态（服务器没下发 = 未开始）', () => {
    const task = REAL_TASK_ROWS[0];
    // 查不到 = 还没开始做
    assert.equal(taskPhaseOf(task, stateOf()), 'goto');
    assert.equal(taskPhaseOf({ ...task, goto: 0 }, stateOf()), 'undone');
    // 1 = 可领取
    assert.equal(taskPhaseOf(task, stateOf({ tasks: new Map([[task.resId, { process: 0, state: ACTIVITY_STATE_FINISH }]]) })), 'claimable');
    // 2 = 已领取（优先级高于 goto）
    assert.equal(taskPhaseOf({ ...task, goto: 0 }, stateOf({ tasks: new Map([[task.resId, { process: 0, state: ACTIVITY_STATE_REWARDED }]]) })), 'taken');
    // 0 = 未完成
    assert.equal(taskPhaseOf(task, stateOf({ tasks: new Map([[task.resId, { process: 3, state: 0 }]]) })), 'goto');
    assert.equal(taskPhaseOf({ ...task, goto: 0 }, stateOf({ tasks: new Map([[task.resId, { process: 3, state: 0 }]]) })), 'undone');
});

test('C. ⚠️ taskHasRedDot 只在「可领取」时为真（已领取 / 未完成都不亮）', () => {
    const task = REAL_TASK_ROWS[0];
    assert.equal(taskHasRedDot(task, stateOf()), false);
    assert.equal(taskHasRedDot(task, stateOf({ tasks: new Map([[task.resId, { process: 0, state: 0 }]]) })), false);
    assert.equal(taskHasRedDot(task, stateOf({ tasks: new Map([[task.resId, { process: 0, state: ACTIVITY_STATE_REWARDED }]]) })), false);
    assert.equal(taskHasRedDot(task, stateOf({ tasks: new Map([[task.resId, { process: 0, state: ACTIVITY_STATE_FINISH }]]) })), true);
});

test('C. taskProgressText：模板 replace + 无状态按 0 进度（文案本身不带空格）', () => {
    const task = REAL_TASK_ROWS[3]; // 累计击杀2000只怪物, count=2000
    assert.equal(ACTIVITY_TEXTS.taskProgress, '({0}/{1})');
    assert.equal(taskProgressText(task, stateOf(), ACTIVITY_TEXTS.taskProgress), '累计击杀2000只怪物(0/2000)');
    assert.equal(
        taskProgressText(task, stateOf({ tasks: new Map([[task.resId, { process: 2000, state: ACTIVITY_STATE_FINISH }]]) }), ACTIVITY_TEXTS.taskProgress),
        '累计击杀2000只怪物(2000/2000)',
    );
});

test('C. sortTasksForDisplay：可领取(0) → 未完成(1) → 已领取(2)，组内按 order', () => {
    const tasks = REAL_TASK_ROWS;
    const state = stateOf({
        tasks: new Map([
            [1, { process: 0, state: ACTIVITY_STATE_REWARDED }], // 已领取 → 最后
            [3, { process: 0, state: ACTIVITY_STATE_FINISH }],   // 可领取 → 最前
            [4, { process: 0, state: ACTIVITY_STATE_FINISH }],   // 可领取（order 更大）
        ]),
    });
    assert.deepEqual(sortTasksForDisplay(tasks, state).map((r) => r.resId), [3, 4, 2, 5, 1]);
    // 不修改入参
    assert.deepEqual(tasks.map((r) => r.resId), [1, 2, 3, 4, 5]);
});

// ============================================================
// C. 周活跃宝箱与进度
// ============================================================

test('C. boxClaimed：只认 tlProgressInfo 里的 1', () => {
    const state = stateOf({ claimedBoxes: [1, 0, 2] });
    assert.equal(boxClaimed(0, state), true);
    assert.equal(boxClaimed(1, state), false);
    assert.equal(boxClaimed(2, state), false, '2 不是「已领取」');
    assert.equal(boxClaimed(99, state), false, '越界返回 false');
    assert.equal(boxClaimed(-1, state), false);
});

test('C. boxPhaseOf：已领取 > 门槛判定；cost 是阈值不是消耗', () => {
    const row = REAL_BOX_ROWS[0]; // cost 105
    assert.equal(boxPhaseOf(row, 0, stateOf({ coin: 104 })), 'locked');
    assert.equal(boxPhaseOf(row, 0, stateOf({ coin: 105 })), 'claimable', '刚好达标应当可领');
    assert.equal(boxPhaseOf(row, 0, stateOf({ coin: 1000 })), 'claimable');
    // 已领取优先，即使积分被改小也不该退回 locked
    assert.equal(boxPhaseOf(row, 0, stateOf({ coin: 0, claimedBoxes: [1] })), 'taken');
});

test('C. chestRatioOf / barRatioOf：分母为 0 / 非法一律 0，超额夹到 1', () => {
    assert.equal(chestRatioOf({ id: 1, cost: 105, rewards: [] }, 0), 0);
    assert.equal(chestRatioOf({ id: 1, cost: 105, rewards: [] }, -1), 0);
    assert.equal(chestRatioOf({ id: 1, cost: 105, rewards: [] }, 210), 0.5);
    assert.equal(barRatioOf(stateOf({ coin: 420 }), REAL_BOX_ROWS), 0.5);
    assert.equal(barRatioOf(stateOf({ coin: 0 }), REAL_BOX_ROWS), 0);
    assert.equal(barRatioOf(stateOf({ coin: 99999 }), REAL_BOX_ROWS), 1, '超额必须夹到 1，否则条会画到框外');
    assert.equal(barRatioOf(stateOf({ coin: 500 }), []), 0, '空表分母 0');
    assert.equal(barRatioOf(stateOf({ coin: Number.NaN }), REAL_BOX_ROWS), 0);
});

test('C. stateSignatureOf：积分 / 任务进度 / 已领宝箱 任一变化都要变', () => {
    const base = stateOf({ instanceId: 1, coin: 100, claimedBoxes: [1, 0], tasks: new Map([[1, { process: 5, state: 0 }]]) });
    const sig = stateSignatureOf(base);
    assert.equal(stateSignatureOf(base), sig, '同样输入必须同签名');
    assert.notEqual(stateSignatureOf({ ...base, coin: 101 }), sig);
    assert.notEqual(stateSignatureOf({ ...base, instanceId: 2 }), sig);
    assert.notEqual(stateSignatureOf({ ...base, claimedBoxes: [1, 1] }), sig);
    assert.notEqual(stateSignatureOf({ ...base, tasks: new Map([[1, { process: 6, state: 0 }]]) }), sig);
    assert.notEqual(stateSignatureOf({ ...base, tasks: new Map([[1, { process: 5, state: 1 }]]) }), sig);
    // 任务顺序不影响签名（按 id 排序后再拼）
    const a = stateOf({ tasks: new Map([[2, { process: 1, state: 0 }], [1, { process: 1, state: 0 }]]) });
    const b = stateOf({ tasks: new Map([[1, { process: 1, state: 0 }], [2, { process: 1, state: 0 }]]) });
    assert.equal(stateSignatureOf(a), stateSignatureOf(b));
});

// ============================================================
// C. 文案
// ============================================================

test('C. 文案常量与 FGUI 原稿一致（标题 / 周活跃 / 按钮）', () => {
    assert.equal(ACTIVITY_TEXTS.title, '每日任务');
    assert.equal(ACTIVITY_TEXTS.coinLabel, '周活跃');
    assert.equal(ACTIVITY_TEXTS.taskClaim, '领取');
    assert.equal(ACTIVITY_TEXTS.taskTaken, '已领取');
    assert.equal(ACTIVITY_TEXTS.taskGoto, '前往');
    assert.equal(ACTIVITY_TEXTS.taskProgress, '({0}/{1})');
    for (const key of ['empty', 'offline', 'failed', 'gotoMissing', 'notOpen', 'boxMissing'] as const) {
        assert.ok(ACTIVITY_TEXTS[key].length > 0, `${key} 是空文案`);
    }
});

// ============================================================
// D. 奖励预览气泡（`RewardPreviewPage` + `ui/Activity/RewardPreview.prefab`）
// ============================================================
//
// 对齐老端 `CtrlAlert.OpenPanelRewards` → `PanelPreviewRewards`
// （FGUI `共用弹窗/组件/panel弹窗/奖励预览/组件_共用弹窗_查看奖励`）。
// 本端**有意不复刻**它的 12 方位箭头择优定位：老端自己在文件头注明
// 「该方法不适用于720p的界面，位置信息错误」，而本端设计分辨率正是 720×1280；
// 且箭头图本端没有 ⇒ 改成确定性规则（贴宝箱正上方 / 水平居中 / 夹进屏内 / 上方放不下翻下方）。

const PREVIEW_PREFAB = assetPath('ui/Activity/RewardPreview.prefab');
const PREVIEW_PREFAB_TREE = JSON.parse(readFileSync(PREVIEW_PREFAB, 'utf8')) as unknown[];

/** 通用 prefab 路径索引（`Activity.prefab` 那份 `PREFAB_INDEX` 是写死根名的，这里要按根名参数化）。 */
function makePrefabIndex(tree: unknown[], rootName: string) {
    const objOf = (i: number) => tree[i] as Record<string, unknown>;
    const byType = (i: number, type: string) => {
        const node = objOf(i);
        for (const ref of (node._components as { __id__: number }[] | undefined) ?? []) {
            const comp = objOf(ref.__id__);
            if (comp && String(comp.__type__).startsWith(type)) return comp;
        }
        return null;
    };
    const pathIdx = new Map<string, number>();
    let root = -1;
    tree.forEach((raw, i) => {
        const node = raw as Record<string, unknown>;
        if (node.__type__ === 'cc.Node' && node._name === rootName && root < 0) root = i;
    });
    const walk = (i: number, prefix: string) => {
        const node = objOf(i);
        for (const child of (node._children as { __id__: number }[] | undefined) ?? []) {
            const name = String(objOf(child.__id__)._name);
            const path = prefix ? `${prefix}/${name}` : name;
            if (!pathIdx.has(path)) pathIdx.set(path, child.__id__);
            walk(child.__id__, path);
        }
    };
    pathIdx.set('', root);
    walk(root, '');
    const box = (path: string): PrefabBox | null => {
        const i = pathIdx.get(path);
        if (i === undefined) return null;
        const node = objOf(i);
        const ut = byType(i, 'cc.UITransform');
        if (!ut) return null;
        const size = ut._contentSize as { width: number; height: number };
        const anchor = ut._anchorPoint as { x: number; y: number };
        const pos = node._lpos as { x: number; y: number };
        return {
            left: pos.x - anchor.x * size.width,
            right: pos.x + (1 - anchor.x) * size.width,
            bottom: pos.y - anchor.y * size.height,
            top: pos.y + (1 - anchor.y) * size.height,
            w: size.width,
            h: size.height,
            ax: anchor.x,
            ay: anchor.y,
        };
    };
    const children = (path: string): string[] => {
        const i = pathIdx.get(path);
        if (i === undefined) return [];
        const node = objOf(i);
        return ((node._children as { __id__: number }[] | undefined) ?? []).map((c) => String(objOf(c.__id__)._name));
    };
    return { objOf, byType, pathIdx, root, box, children };
}

const PREVIEW_INDEX = makePrefabIndex(PREVIEW_PREFAB_TREE, 'RewardPreview');

test('D. 气泡版面常量：格 90 / 间距 10 / 内边距 15 / 高 150 / 上限 5', () => {
    // FGUI：`组件_共用弹窗_查看奖励气泡.xml` 的 `list xy="15,25" size="500,100"`
    // + `组件_共用弹窗_奖励格子.xml` 的 90×90（物品框实例，k = 0.9）
    assert.equal(ACTIVITY_PREVIEW_CELL_SIZE, 90);
    assert.equal(ACTIVITY_PREVIEW_CELL_GAP, 10);
    assert.equal(ACTIVITY_PREVIEW_PADDING_X, 15);
    assert.equal(ACTIVITY_PREVIEW_HEIGHT, 150);
    assert.equal(ACTIVITY_PREVIEW_MAX_CELLS, 5);
});

test('D. ⚠️ 气泡宽随格数长；满格 520（不是 FGUI 根的 530）', () => {
    // FGUI 的 `list` 视窗写死 500，比 5 格所需的 490 多 10 ⇒ 根 = 500 + 30 = 530。
    // 本端按**内容所需**算：2×15 + n×90 + (n−1)×10 ⇒ n=5 是 520。
    assert.equal(previewBubbleWidth(5), 520);
    assert.equal(previewBubbleWidth(1), 15 * 2 + 90);
    assert.equal(previewBubbleWidth(2), 15 * 2 + 180 + 10);
    assert.equal(previewBubbleWidth(3), 15 * 2 + 270 + 20);
    assert.equal(previewBubbleWidth(4), 15 * 2 + 360 + 30);
    // 上限 5：再多也不变宽（多出来的奖励宿主会 console.warn）
    assert.equal(previewBubbleWidth(9), previewBubbleWidth(5));
    // 0 / 负数 / NaN 一律按 1 格算（不返回 30 这种「画不出格子」的宽度）
    assert.equal(previewBubbleWidth(0), previewBubbleWidth(1));
    assert.equal(previewBubbleWidth(-3), previewBubbleWidth(1));
    assert.equal(previewBubbleWidth(Number.NaN), previewBubbleWidth(1));
});

test('D. previewCellCount：夹到 1..5', () => {
    assert.equal(previewCellCount(0), 1);
    assert.equal(previewCellCount(1), 1);
    assert.equal(previewCellCount(5), 5);
    assert.equal(previewCellCount(6), 5);
    assert.equal(previewCellCount(-1), 1);
    assert.equal(previewCellCount(Number.NaN), 1);
    assert.equal(previewCellCount(Number.POSITIVE_INFINITY), 1, 'Infinity 不是有限数 ⇒ 兜底 1');
    assert.equal(previewCellCount(3.7), 3, '取整不是四舍五入');
});

test('D. ⚠️ 满格（5）时格子 x = −200/−100/0/100/200 —— 与 prefab 摆位一致', () => {
    const xs = [0, 1, 2, 3, 4].map((i) => previewCellX(i, 5));
    assert.deepEqual(xs, [-200, -100, 0, 100, 200]);
    // 整排居中：首格左边 + 末格右边 必须对称
    const first = xs[0] - ACTIVITY_PREVIEW_CELL_SIZE / 2;
    const last = xs[4] + ACTIVITY_PREVIEW_CELL_SIZE / 2;
    assert.equal(first, -last);
    // 气泡左缘到首格左缘 = 一个内边距
    close(first + previewBubbleWidth(5) / 2, ACTIVITY_PREVIEW_PADDING_X, '左内边距');
    // 相邻格心距 = 格宽 + 间距
    assert.equal(xs[1] - xs[0], ACTIVITY_PREVIEW_CELL_SIZE + ACTIVITY_PREVIEW_CELL_GAP);
    // 少格时整体仍居中
    assert.deepEqual([0, 1, 2].map((i) => previewCellX(i, 3)), [-100, 0, 100]);
    assert.deepEqual([0].map((i) => previewCellX(i, 1)), [0]);
});

test('D. ⚠️ 数量版面与行内格共用同一条公式（k = 0.9 ⇒ 字号 22）', () => {
    assert.equal(ACTIVITY_PREVIEW_NUM_SCALE, 0.9);
    assert.equal(ACTIVITY_PREVIEW_NUM_FONT_SIZE, 22);
    // 与 `rewardNumLayout` 现算的一致 —— 别把 90 与 85 两档写成两套手抄数
    const computed = rewardNumLayout(ACTIVITY_PREVIEW_CELL_SIZE);
    assert.equal(ACTIVITY_PREVIEW_NUM_POS.x, computed.pos.x);
    assert.equal(ACTIVITY_PREVIEW_NUM_POS.y, computed.pos.y);
    close(ACTIVITY_PREVIEW_NUM_POS.x, 44.1, '预览格 Num.x');
    close(ACTIVITY_PREVIEW_NUM_POS.y, -29.7, '预览格 Num.y');
    // 行内 85 档仍是 20px（重构不能改到它）
    assert.equal(ACTIVITY_ROW_REWARD_NUM_FONT_SIZE, 20);
    close(ACTIVITY_ROW_REWARD_NUM_POS.x, 41.65, '行内格 Num.x');
    close(ACTIVITY_ROW_REWARD_NUM_POS.y, -28.05, '行内格 Num.y');
});

test('D. previewBubblePlacement：贴宝箱正上方 + 水平居中', () => {
    const anchor: IPreviewAnchorBox = { left: 300, bottom: 400, width: 72, height: 72 };
    const p = previewBubblePlacement(anchor, 520, 150, 720, 1485);
    assert.equal(p.below, false);
    // 垂直：气泡底边 = 锚点顶边 + gap
    assert.equal(p.y - 150 / 2, anchor.bottom + anchor.height + ACTIVITY_PREVIEW_ANCHOR_GAP);
    // 水平：与锚点中心对齐（此处 336 落在可放区间内）
    assert.equal(p.x, anchor.left + anchor.width / 2);
});

test('D. ⚠️ previewBubblePlacement：水平夹进屏内（左右各留 8）', () => {
    const margin = 8;
    const width = 520;
    // 宝箱贴左边 ⇒ 气泡不能出一屏，左缘 = margin
    const left = previewBubblePlacement({ left: 0, bottom: 400, width: 72, height: 72 }, width, 150, 720, 1485);
    assert.equal(left.x - width / 2, margin);
    // 宝箱贴右边 ⇒ 右缘 = 屏宽 − margin
    const right = previewBubblePlacement({ left: 648, bottom: 400, width: 72, height: 72 }, width, 150, 720, 1485);
    assert.equal(right.x + width / 2, 720 - margin);
    // 气泡比屏还宽 ⇒ 改为屏心对齐（不再夹到「左缘 > 右缘」的荒唐值）
    const wide = previewBubblePlacement({ left: 0, bottom: 400, width: 72, height: 72 }, 2000, 150, 720, 1485);
    assert.equal(wide.x, 360);
});

test('D. ⚠️ previewBubblePlacement：上方顶出屏幕上沿 ⇒ 翻到正下方', () => {
    const anchor: IPreviewAnchorBox = { left: 300, bottom: 1400, width: 72, height: 72 };
    const p = previewBubblePlacement(anchor, 520, 150, 720, 1485);
    assert.equal(p.below, true, '锚点贴着屏幕上沿时必须翻到下方，否则气泡被裁掉');
    // 气泡顶边 = 锚点底边 − gap
    assert.equal(p.y + 150 / 2, anchor.bottom - ACTIVITY_PREVIEW_ANCHOR_GAP);
    assert.ok(p.y - 150 / 2 >= 8, '翻到下方后仍须留在屏内');
});

test('D. ⚠️ previewBubblePlacement：上下都放不下 ⇒ 回退「贴屏幕上沿内壁」', () => {
    // 极矮屏：气泡比可见区还高 ⇒ 无论如何都放不下，但**绝不能画到屏外**
    const p = previewBubblePlacement({ left: 300, bottom: 100, width: 72, height: 72 }, 520, 2000, 720, 400);
    assert.equal(p.below, false);
    assert.equal(p.y, 400 - 8 - 2000 / 2, '回退必须是「贴住屏幕上沿内壁」（宁可压住宝箱，不能没反馈）');
});

test('D. ⚠️ RewardPreview.prefab：根 720×1280 + 全节点 UI_2D', () => {
    const root = PREVIEW_INDEX.box('');
    assert.ok(root, '解析不出 RewardPreview.prefab 根节点');
    assert.equal(root!.w, 720);
    assert.equal(root!.h, 1280);
    assert.equal(root!.ax, 0.5);
    assert.equal(root!.ay, 0.5);
    const bad: string[] = [];
    PREVIEW_PREFAB_TREE.forEach((raw) => {
        const node = raw as Record<string, unknown>;
        if (node.__type__ === 'cc.Node' && node._layer !== 33554432) bad.push(String(node._name));
    });
    assert.deepEqual(bad, [], `这些节点 layer 不是 UI_2D(33554432)：${bad.join(', ')}`);
});

test('D. ⚠️ 气泡底板：满格 520×150 + 九宫格（SLICED）+ sizeMode=CUSTOM', () => {
    const bubble = PREVIEW_INDEX.box('Bubble');
    assert.ok(bubble, 'RewardPreview.prefab 里没有 Bubble');
    assert.equal(bubble!.w, previewBubbleWidth(ACTIVITY_PREVIEW_MAX_CELLS));
    assert.equal(bubble!.h, ACTIVITY_PREVIEW_HEIGHT);
    assert.equal(bubble!.ax, 0.5, 'Bubble 锚点必须居中 —— 运行时按格数改宽要往两边长');
    assert.equal(bubble!.ay, 0.5);

    const sprite = PREVIEW_INDEX.byType(PREVIEW_INDEX.pathIdx.get('Bubble')!, 'cc.Sprite');
    assert.ok(sprite, 'Bubble 上没有 cc.Sprite');
    assert.equal(sprite!._type, 1, 'Bubble 不是 SLICED（9 宫）—— 改宽度会被整张拉伸变形');
    // ⚠️ sizeMode 默认是 TRIMMED(1)：赋 spriteFrame 时引擎按**贴图原始尺寸**回写 contentSize
    assert.equal(sprite!._sizeMode, 0, 'Bubble 的 sizeMode 必须是 CUSTOM(0)');
    assert.ok(sprite!._spriteFrame, 'Bubble 必须预置底板图（否则运行期取不到会画成空白）');
});

test('D. ⚠️ 格子数 == ACTIVITY_PREVIEW_MAX_CELLS，且 x 与 previewCellX 一致', () => {
    const kids = PREVIEW_INDEX.children('Bubble/Cells');
    const cells = kids.filter((n) => n.startsWith('Cell'));
    assert.equal(
        cells.length,
        ACTIVITY_PREVIEW_MAX_CELLS,
        `Bubble/Cells 下的格子数 ${cells.length} ≠ 常量 ${ACTIVITY_PREVIEW_MAX_CELLS}（改 prefab 要同步改常量）`,
    );
    for (let i = 0; i < cells.length; i++) {
        const box = PREVIEW_INDEX.box(`Bubble/Cells/Cell${i + 1}`);
        assert.ok(box, `Bubble/Cells/Cell${i + 1} 不存在`);
        assert.equal(box!.w, ACTIVITY_PREVIEW_CELL_SIZE);
        assert.equal(box!.h, ACTIVITY_PREVIEW_CELL_SIZE);
        assert.equal(box!.ax, 0.5);
        assert.equal(box!.ay, 0.5);
        assert.equal(
            (box!.left + box!.right) / 2,
            previewCellX(i, cells.length),
            `Cell${i + 1} 的 x 与 previewCellX(${i}, ${cells.length}) 不一致`,
        );
        assert.equal((box!.top + box!.bottom) / 2, 0, '格子纵向必须落在气泡正中（FGUI vAlign=middle 所致）');
    }
});

test('D. ⚠️ 每格：Frame/Icon 的 spriteFrame 必须留 null 且 sizeMode=CUSTOM', () => {
    // ⚠️ 这里的物品框**故意不烘静态图**：`GoodsBox.defaultFrame` 是 `onLoad` 抓的
    //    —— 烘一张图会把「品质框图加载失败 ⇒ 空白」变成「显示成那张图」。
    //    同时 `sizeMode` 必须是 CUSTOM(0)：TRIMMED 会在赋 spriteFrame 时按贴图原始尺寸
    //    回写 contentSize（品质框 100×100、图标 100×100）⇒ 5 个格子互相叠。
    const iconW = Math.round(80 * (ACTIVITY_PREVIEW_CELL_SIZE / 100));
    for (let n = 1; n <= ACTIVITY_PREVIEW_MAX_CELLS; n++) {
        const base = `Bubble/Cells/Cell${n}`;
        for (const [child, expectedW] of [['Frame', ACTIVITY_PREVIEW_CELL_SIZE], ['Icon', iconW]] as const) {
            const box = PREVIEW_INDEX.box(`${base}/${child}`);
            assert.ok(box, `${base}/${child} 不存在`);
            assert.equal(box!.w, expectedW, `${base}/${child} 宽错了`);
            assert.equal(box!.h, expectedW, `${base}/${child} 必须正方形`);
            const sprite = PREVIEW_INDEX.byType(PREVIEW_INDEX.pathIdx.get(`${base}/${child}`)!, 'cc.Sprite');
            assert.ok(sprite, `${base}/${child} 上没有 cc.Sprite`);
            assert.equal(sprite!._sizeMode, 0, `${base}/${child} 的 sizeMode 必须是 CUSTOM(0)`);
            assert.equal(sprite!._spriteFrame, null, `${base}/${child} 的 spriteFrame 必须留 null（运行期现赋）`);
        }
    }
});

test('D. ⚠️ 每格必须有 Num：锚点 (1,0.5) + 右对齐 + overflow=NONE + 22px', () => {
    for (let n = 1; n <= ACTIVITY_PREVIEW_MAX_CELLS; n++) {
        const base = `Bubble/Cells/Cell${n}`;
        const path = `${base}/Num`;
        const box = PREVIEW_INDEX.box(path);
        assert.ok(box, `${path} 不存在 —— 气泡里的奖励不会显示数量`);
        assert.equal(box!.ax, 1, `${path} 锚点 x 必须是 1（位数变长时右缘钉死）`);
        assert.equal(box!.ay, 0.5);
        assert.ok(
            Math.abs(box!.right - ACTIVITY_PREVIEW_NUM_POS.x) < 0.01,
            `${path} 右缘 ${box!.right} ≠ ACTIVITY_PREVIEW_NUM_POS.x ${ACTIVITY_PREVIEW_NUM_POS.x}`,
        );
        const label = PREVIEW_INDEX.byType(PREVIEW_INDEX.pathIdx.get(path)!, 'cc.Label');
        assert.ok(label, `${path} 上没有 cc.Label`);
        assert.equal(label!._fontSize, ACTIVITY_PREVIEW_NUM_FONT_SIZE, `${path} 字号`);
        assert.equal(label!._overflow, 0, `${path} overflow 必须 NONE`);
        assert.equal(label!._horizontalAlign, 2, `${path} 必须右对齐`);
        // Num 必须排在 Icon 之后（后添加的兄弟画在上层），否则被道具图盖住
        const kids = PREVIEW_INDEX.children(base);
        assert.ok(
            kids.indexOf('Icon') >= 0 && kids.indexOf('Icon') < kids.indexOf('Num'),
            `${base} 里 Num 必须在 Icon 之后（当前序：${kids.join(',')}）`,
        );
    }
});

test('D. ⚠️ prefab 根脚本文稿绑好了 bubble / cells（改名要红）', () => {
    const rootScriptComp = (() => {
        const node = PREVIEW_INDEX.objOf(PREVIEW_INDEX.root);
        for (const ref of ((node._components as { __id__: number }[] | undefined) ?? [])) {
            const comp = PREVIEW_INDEX.objOf(ref.__id__);
            if (comp && !String(comp.__type__).startsWith('cc.')) return comp;
        }
        throw new Error('RewardPreview.prefab 根上没有脚本组件');
    })();
    const nameOf = (value: unknown): string => {
        const id = (value as { __id__?: number } | null)?.__id__;
        if (id === undefined) return '';
        return String(PREVIEW_INDEX.objOf(id)._name ?? '');
    };
    assert.equal(nameOf(rootScriptComp.bubble), 'Bubble', 'RewardPreviewPage.bubble 没绑到 Bubble');
    assert.equal(nameOf(rootScriptComp.cells), 'Cells', 'RewardPreviewPage.cells 没绑到 Cells');
});

test('D. ⚠️ RewardPreviewPage 的关闭口径：contentNodes=[bubble] 且 onInit 里设', () => {
    const src = readFileSync('assets/script/app/activity/RewardPreviewPage.ts', 'utf8');
    // `PopupBase` 的 `_bindBlankClose()` 在 `onInit` **之后**才跑 ⇒ 在 onInit 里设才生效
    const onInit = /protected onInit\(\): void \{([\s\S]*?)\n {4}\}/.exec(src);
    assert.ok(onInit, '读不到 onInit 的实现体');
    assert.ok(
        /this\.contentNodes = \[this\.bubble\]/.test(onInit![1]),
        'onInit 里必须把 contentNodes 设成 [bubble]（点气泡不关、点别处关）',
    );
    // 定位必须走 convertToNodeSpaceAR —— 手算「减去半个可见区」会偏（UI 世界原点在左下角）
    assert.ok(
        /convertToNodeSpaceAR/.test(src),
        'applyPlacement 必须用 convertToNodeSpaceAR 换算（见 PopupBase.isPointOnNode 的长注释）',
    );
    // 静态 showAt 必须在「已开着」时就地重铺，否则点第二个宝箱会没反应
    assert.ok(/static showAt\(/.test(src), '缺少静态 showAt');
    assert.ok(
        /current\.present\(params\)/.test(src),
        'showAt 在已打开时必须 present(params) 就地重铺 —— 单开会返回旧实例、onOpen 不重跑',
    );
});

test('D. ⚠️ 宝箱点击：可领取才领，否则弹预览（老端 `box.setClick` 口径）', () => {
    const src = readFileSync('assets/script/app/activity/LayerActivityPage.ts', 'utf8');
    const body = /private async onBoxClick\([\s\S]*?\n {4}\}/.exec(src);
    assert.ok(body, '读不到 onBoxClick 的实现体');
    assert.ok(
        /boxPhaseOf\(data, index, snapshot\.state\) !== 'claimable'/.test(body![0]),
        'onBoxClick 必须按 boxPhaseOf 分流',
    );
    assert.ok(
        /this\.openBoxPreview\(data, anchorNode\)/.test(body![0]),
        '不可领取时必须弹预览气泡（老端 `CtrlAlert.OpenPanelRewards`）—— 不能静默 return',
    );
    assert.ok(
        /this\.repo\.claimBox\(data\.id, this\)/.test(body![0]),
        '可领取时必须发领奖请求',
    );

    // 锚点必须取 72×72 的 chestButton（不是 72×92 的 BoxN），否则气泡整体偏高
    assert.ok(
        /view\.chestButton \?\? node/.test(src),
        'rebuildBoxes 必须把 chestButton 当锚点传给 onBoxClick',
    );
    // 空奖励要给提示，而不是弹一个空气泡
    assert.ok(/ACTIVITY_TEXTS\.boxRewardEmpty/.test(src), 'openBoxPreview 必须处理「空奖励」');
    // 宝箱奖励也要预加载图标，否则气泡只有品质框
    assert.ok(
        /snapshot\.boxes/.test(src),
        'loadIconFrames 必须把 snapshot.boxes 的奖励也纳入预加载',
    );
});

test('D. 文案：宝箱空奖励提示', () => {
    assert.equal(ACTIVITY_TEXTS.boxRewardEmpty, '该宝箱暂无奖励');
    assert.equal(ACTIVITY_TEXTS.gotoMissing, '该功能暂未开放');
});

// ============================================================
// E. 前往跳转（`ActivityJumpTable` 纯表 + `ActivityJump` 执行层）
// ============================================================
//
// 老端「前往」= `CtrlJumpView.JumpType(ref.goto)`（`ViewJump.ts` 的 `switch`，
// 其中 HERO/FIGHT/ARMY/SHOP/LEAGUE 走 `default` → `LayerMainMenu` 的 `"Jump"` 事件，
// 那五个是切**主界面底栏**页）。本端按同一张枚举路由到**确实存在**的页面，
// 其余一律提示「该功能暂未开放」—— 不静默失败。

test('E. ⚠️ JUMP_TYPE 数值与老端 ModelJump.ts 逐字一致', () => {
    // 值是**配置表里的数字**（dayChallengeActTask.goto / taskUnion.goto），
    // 重排会让「前往」跳到别的系统上，且不报错。
    assert.equal(JUMP_TYPE.NONE, 0);
    assert.equal(JUMP_TYPE.HERO, 1);
    assert.equal(JUMP_TYPE.FIGHT, 2);
    assert.equal(JUMP_TYPE.EQUIP_BUILD, 3);
    assert.equal(JUMP_TYPE.MILTIAATTR, 4);
    assert.equal(JUMP_TYPE.ARMY, 5);
    assert.equal(JUMP_TYPE.EQUIP_UPLV, 6);
    assert.equal(JUMP_TYPE.FAST_FIGHT, 7);
    assert.equal(JUMP_TYPE.SHOP, 8);
    assert.equal(JUMP_TYPE.HANG, 9);
    assert.equal(JUMP_TYPE.LEAGUE, 10);
    assert.equal(JUMP_TYPE.LEAGUE_SHOP, 11);
    assert.equal(JUMP_TYPE.LEAGUE_DONATE, 12);
    assert.equal(JUMP_TYPE.DAY_CHALLENGE, 13);
    assert.equal(JUMP_TYPE.SHEN_YUAN, 14);
    assert.equal(JUMP_TYPE.EQUIP_DESTROY, 15);
    assert.equal(JUMP_TYPE.EQUIP_INSTANCE, 16);
    assert.equal(JUMP_TYPE.CITY_BUILD, 17);
    assert.equal(JUMP_TYPE.GENERAL, 18);
    assert.equal(JUMP_TYPE.ADVISOR, 19);
    assert.equal(JUMP_TYPE.GUARD_JIAN_GE, 20);
    assert.equal(JUMP_TYPE.PLEASGOD, 21);
    assert.equal(JUMP_TYPE.RANK, 22);
    assert.equal(JUMP_TYPE.FIRST_CHARGE, 23);
    assert.equal(JUMP_TYPE.BattleToken, 24);
    assert.equal(JUMP_TYPE.GUARDS, 25);
    assert.equal(JUMP_TYPE.SPIN_ACTIVITY, 26);
    // 全枚举 0..26 无空洞
    assert.deepEqual(
        Object.values(JUMP_TYPE).slice().sort((a, b) => a - b),
        Array.from({ length: 27 }, (_v, i) => i),
    );
});

test('E. ⚠️ 已登记目标：往哪跳 + 怎么打开（stack / switch / self）', () => {
    // `switch` = 切 tab / 切流程 ⇒ 必须先关发起页，否则弹窗盖住新页面（看着像没反应）
    for (const [goto, target] of [
        [JUMP_TYPE.HERO, 'roleMain'],
        [JUMP_TYPE.FIGHT, 'arenaTab'],
        [JUMP_TYPE.EQUIP_BUILD, 'roleMain'],
        [JUMP_TYPE.FAST_FIGHT, 'matching'],
    ] as const) {
        const route = resolveActivityJump(goto);
        assert.ok(route, `goto=${goto} 没登记`);
        assert.equal(route!.kind, 'switch', `goto=${goto} 必须是 switch`);
        assert.equal(route!.target, target, `goto=${goto} 的目标错了`);
    }

    // `stack` = 弹窗目标，叠在发起页之上（关掉目标就回到每日任务）
    for (const [goto, target] of [
        [JUMP_TYPE.HANG, 'hang'],
        [JUMP_TYPE.LEAGUE_SHOP, 'leagueShop'],
        [JUMP_TYPE.LEAGUE_DONATE, 'leagueDonate'],
        [JUMP_TYPE.BattleToken, 'battleToken'],
    ] as const) {
        const route = resolveActivityJump(goto);
        assert.ok(route, `goto=${goto} 没登记`);
        assert.equal(route!.kind, 'stack', `goto=${goto} 必须是 stack`);
        assert.equal(route!.target, target, `goto=${goto} 的目标错了`);
    }

    // 每日挑战就是本页 ⇒ self（不关窗、不做动作）
    const self = resolveActivityJump(JUMP_TYPE.DAY_CHALLENGE);
    assert.ok(self, 'goto=13 没登记');
    assert.equal(self!.kind, 'self');
    assert.equal(self!.target, 'self');
});

test('E. ⚠️ 装备强化（3）不能接 CardUpgradePage —— 它要卡牌实例', () => {
    // `CardUpgradePage.onOpen(userData)` 必须有卡牌实例，凭空打开拿不到数据。
    // ⇒ 本端降级成「角色主界面（领地 tab，装备栏所在页）」，
    //    这也正是老端那个「装备进化」浮层的常规入口（`TabRoleMain.ts:224`）。
    const route = resolveActivityJump(JUMP_TYPE.EQUIP_BUILD);
    assert.equal(route!.target, 'roleMain');
    const upgradePage = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    assert.ok(
        /onOpen\(userData\?: ICardUpgradeOpenData\)/.test(upgradePage),
        'CardUpgradePage 的 onOpen 仍需要 userData —— 若改了这条降级口径也要一起复核',
    );
});

test('E. ⚠️ 未登记 / 0 / 非法值一律不抛出，交给兜底提示', () => {
    for (const bad of [0, -1, 4, 5, 6, 8, 10, 14, 99, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(resolveActivityJump(bad), null, `goto=${bad} 不该有目标`);
        assert.equal(hasActivityJumpRoute(bad), false, `goto=${bad} 不该算已登记`);
        assert.equal(activityJumpLabel(bad), '', `goto=${bad} 不该有可读名`);
    }
    // 取整口径：2.9 当 2 用（表里是整数，脏数据不该炸）
    assert.equal(resolveActivityJump(2.9)?.target, 'arenaTab');
});

test('E. ⚠️ 表宽与 target 集合被钉住（顺手扩表要过这一关）', () => {
    assert.deepEqual(activityJumpTargets(), [1, 2, 3, 7, 9, 11, 12, 13, 24]);
    // 按 `goto` 升序去重后的 target 序（3 与 1 同目标，去重）
    assert.deepEqual(
        activityJumpTargetIds(),
        ['roleMain', 'arenaTab', 'matching', 'hang', 'leagueShop', 'leagueDonate', 'self', 'battleToken'],
    );
    // 每条都要有可读名（日志 / 排障用），且不重复
    const labels = activityJumpTargets().map((goto) => activityJumpLabel(goto));
    assert.ok(labels.every((label) => label.length > 0), '有目标缺可读名');
    assert.equal(new Set(labels).size, labels.length, '可读名重复了');
});

test('E. ⚠️ 真实表的每个 goto 都能落地（不是「该功能暂未开放」）', () => {
    // 5 条任务的「前往」是用户**唯一**的行动路径：任何一条落到兜底提示就是个死按钮。
    // 表改了 goto、或本端删了目标，这条立刻红。
    for (const row of REAL_TASKS as { name: string; goto: number }[]) {
        const route = resolveActivityJump(row.goto);
        assert.ok(route, `「${row.name}」的 goto=${row.goto} 落到兜底提示（死按钮）`);
    }
    const gotos = [...new Set((REAL_TASKS as { goto: number }[]).map((row) => row.goto))].sort((a, b) => a - b);
    assert.deepEqual(gotos, [1, 2, 3, 7], `每日任务的 goto 集合变了：${gotos.join(',')}`);
});

test('E. ⚠️ 执行层：每个 target 都有 opener（漏一个 = 点了没反应）', () => {
    const src = readFileSync('assets/script/app/activity/ActivityJump.ts', 'utf8');
    const block = /const ACTIVITY_JUMP_OPENERS[\s\S]*?\{([\s\S]*?)\n\};/.exec(src);
    assert.ok(block, '读不到 ACTIVITY_JUMP_OPENERS 表');
    const keys = [...block![1].matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
    assert.ok(keys.length > 0, 'opener 表是空的');
    for (const target of activityJumpTargetIds()) {
        assert.ok(keys.includes(target), `opener 表缺 ${target} —— 那张表会被类型强制穷尽，这里只是双保险`);
    }
    // `Record<ActivityJumpTarget, () => void>` 是穷尽性保障，别被改成宽松类型
    assert.ok(
        /Readonly<Record<ActivityJumpTarget, \(\) => void>>/.test(src),
        'opener 表必须声明成 Record<ActivityJumpTarget, () => void>（漏项要编译期报错）',
    );
});

test('E. ⚠️ 执行层：只有 switch 目标才关发起页；未登记走提示', () => {
    const src = readFileSync('assets/script/app/activity/ActivityJump.ts', 'utf8');
    const body = /export function gotoActivityTask\([\s\S]*?\n\}/.exec(src);
    assert.ok(body, '读不到 gotoActivityTask 的实现体');
    assert.ok(
        /if \(route\.kind === 'switch'\) dismiss\?\.\(\);/.test(body![0]),
        '只有 switch 目标该关发起页 —— stack 目标要保留每日任务页（关掉目标就回到这里）',
    );
    // 关窗要在 open 之前：`matching` 那条会切流程，之后 `this` 已经销毁
    assert.ok(
        body![0].indexOf("dismiss?.()") < body![0].indexOf('ACTIVITY_JUMP_OPENERS[route.target]()'),
        'dismiss 必须在 open 之前调用',
    );
    assert.ok(
        /FW\.showTip\(ACTIVITY_TEXTS\.gotoMissing\)/.test(body![0]),
        '未登记目标必须提示「该功能暂未开放」，不能静默 return',
    );
});

test('E. ⚠️ 接线：`前往`走跳转路由，且切 tab 目标要关掉本页', () => {
    const page = readFileSync('assets/script/app/activity/LayerActivityPage.ts', 'utf8');
    assert.ok(/import \{ gotoActivityTask \} from '\.\/ActivityJump';/.test(page), '没引入跳转路由');
    const gotoBranch = /if \(phase === 'goto'\) \{([\s\S]*?)\n {8}\}/.exec(page);
    assert.ok(gotoBranch, "读不到 onRowAction 的 'goto' 分支");
    assert.ok(
        /gotoActivityTask\(row\.goto, \(\) => this\.close\(\)\)/.test(gotoBranch![1]),
        "'goto' 分支必须走 gotoActivityTask，并把「关掉本页」作为 dismiss 传下去",
    );
    assert.ok(
        !/ACTIVITY_TEXTS\.gotoMissing/.test(gotoBranch![1]),
        "兜底提示已搬进 ActivityJump —— 分支里不该再自己 setHint(gotoMissing)",
    );
    // 参数必须是**从 this.rows 现取**的当前行（虚拟列表复用节点），别写成渲染时捕获的那份
    assert.ok(
        /const row = this\.rows\[index\]|this\.rows\[index\]/.test(page),
        '跳转要用当前行的 goto，不是渲染时捕获的那份',
    );
});

test('E. ⚠️ MainTabHost 开了按 index 切 tab 的外部入口', () => {
    const src = readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8');
    assert.ok(/switchToTab\(index: number\): void/.test(src), 'MainTabHost 缺 switchToTab(index)');
    assert.ok(/switchToRoleMain\(\): void \{\s*\n\s*void this\.switchTab\(MainTab\.Territory\)/.test(src),
        'switchToRoleMain 必须仍切领地 tab（open.json 的 TabRoleMain 依赖它）');
    // 竞技 tab 就是战斗选关主界面 —— 跳转表里的 `arenaTab` 依赖这个映射
    assert.ok(
        /if \(index === MainTab\.Arena\) return this\.arenaPage;/.test(src),
        'Arena tab 必须绑 arenaPage（ArenaRoot = 战斗选关主界面 + 开始游戏）',
    );
});
