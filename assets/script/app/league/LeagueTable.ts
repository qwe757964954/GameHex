/**
 * 「联盟」主页 —— 判定 / 映射的**纯函数表**（不 import `cc`，可脱离引擎单测）。
 *
 * 主页本体（`组件_联盟_主界面.xml`，720×1280）只有一条交互：**六个入口按钮**。
 * 每个入口对应老端 `CtrlLeague` 的一个 `Open*` 方法 / 一个 `play/LayerLeague*.ts`。
 * 本文件把「节点名 → 老端入口」钉成一张表，页面类只负责「按表接事件」。
 *
 * ## 为什么要有这张表（而不是在页面类里写 switch）
 *
 * 六个入口里有 5 个的目标面板**尚未移植**。老端的做法是「点谁开谁」，
 * 而这版必须能表达「这个入口已经通了 / 还没通」——
 * 表里带 `landed` 开关，页面类据此决定「开面板」还是「提示未开放」。
 * 这样每落地一个子面板只需要把对应行的 `landed` 改成 `true` + 接上面板类，
 * 不用回头改页面逻辑（`MainTabHost` 的 4 个空 tab 也是同一套思路）。
 */

import { toIdString } from '../net/RequestGuard';
import type { LeagueButtonColor } from './LeagueArt';
import {
    LEAGUE_DISCOUNT_PAGES,
    LEAGUE_EDIT_REJECTED_PLACEHOLDER,
    LEAGUE_LEVEL_ROW_CTX_PREFIX,
    LEAGUE_LEVEL_ROW_TITLE_PREFIX,
    LEAGUE_NORTH_ATTR_ATTACK,
    LEAGUE_NORTH_ENTER_COUNT_PREFIX,
    LEAGUE_NORTH_OPEN_HOUR_TEMPLATE,
    LEAGUE_STORE_LIMIT_TEMPLATE,
    fillLeagueText,
} from './LeagueTexts';
// ⚠️ `StringUtil` 是**零引擎依赖**的纯工具类（`framework/utils/StringUtil.ts` 一个 import 都没有）
//    ⇒ 引它不会破坏本文件的「不 import `cc`、可脱离引擎单测」这条底线。
//    北伐要用的两个：`formatNumberToZH`（伤害 / 进度）与 `numAbbr`（盟内伤害榜的 `2.1M` 缩写）。
import { StringUtil } from '../../framework/utils/StringUtil';

/** 老端 `CtrlLeague` 的入口方法名（用作稳定标识，不参与展示）。 */
export type LeagueEntranceKey =
    | 'LayerLeagueHall'
    | 'LayerLeagueStore'
    | 'LayerLeagueDiscount'
    | 'LayerLeagueTask'
    | 'LayerLeagueNorthernExpedition'
    | 'LayerLeagueDonate';

export interface ILeagueEntrance {
    /** prefab 里的节点名（唯一契约 —— 节点重命名时这里必须同改）。 */
    readonly node: string;
    /** 老端入口标识。 */
    readonly key: LeagueEntranceKey;
    /** 按钮文案（真源 = FGUI `<Button title=…>` / 组件默认 title）。 */
    readonly label: string;
    /** 按钮底图颜色（真源 = FGUI 引用的按钮组件）。 */
    readonly color: LeagueButtonColor;
    /**
     * 该入口的目标面板**是否已落地**（Demo3.8 侧）。
     *
     * 落地后逐行改 `true` 并在 `LeaguePage.onEntranceClick` 里加分发分支 ——
     * 两边必须同时改：只翻这里忘了加分支，`onEntranceClick` 的 `default` 会 `console.warn` 出来。
     */
    readonly landed: boolean;
}

/**
 * 六个入口（顺序 = FGUI `displayList` 里的声明序，**不是**视觉位置序）。
 *
 * FGUI 原稿：`btn_hall`(玩法标题) / `btn_shop`(红) / `btn_shopsale`(棕) /
 * `btn_task`(棕) / `btn_fight`(棕) / `btn_jx`(蓝)。
 */
export const LEAGUE_ENTRANCES: readonly ILeagueEntrance[] = [
    // 玩法标题 —— 唯一用 `title_btn`（206×54）的入口，文案「联盟大厅」
    // P2 已落：点它开 `ui/League/LeagueHall`（`LeagueHallPage.open`）
    { node: 'BtnHall', key: 'LayerLeagueHall', label: '联盟大厅', color: 'title', landed: true },
    // 红底 —— FGUI 给了 `<Button title="联盟商店" titleColor="#d1c0bf" titleFontSize="27"/>` 覆盖
    // P4 已落：`ui/League/LeagueStore`（`LeagueStorePage.open`）
    { node: 'BtnShop', key: 'LayerLeagueStore', label: '联盟商店', color: 'red', landed: true },
    // P4 已落：`ui/League/LeagueDiscount`（`LeagueDiscountPage.open`）
    { node: 'BtnSale', key: 'LayerLeagueDiscount', label: '每日砍价', color: 'brown', landed: true },
    // P5 已落：`ui/League/LeagueTask`（`LeagueTaskPage.open`）
    { node: 'BtnTask', key: 'LayerLeagueTask', label: '联盟任务', color: 'brown', landed: true },
    // P6 已落：`ui/League/LeagueNorthExpedition`（`LeagueNorthExpeditionPage.open`）
    { node: 'BtnFight', key: 'LayerLeagueNorthernExpedition', label: '联合战线', color: 'brown', landed: true },
    // P4 已落：`ui/League/LeagueDonate`（`LeagueDonatePage.open`）
    { node: 'BtnDonate', key: 'LayerLeagueDonate', label: '联盟捐献', color: 'blue', landed: true },
] as const;

/** 按 prefab 节点名查入口；查不到返回 `null`（不抛 —— 节点被改名时不至于把界面打崩）。 */
export function leagueEntranceByNode(nodeName: string): ILeagueEntrance | null {
    for (let index = 0; index < LEAGUE_ENTRANCES.length; index += 1) {
        if (LEAGUE_ENTRANCES[index].node === nodeName) return LEAGUE_ENTRANCES[index];
    }
    return null;
}

/** 已落地的入口（页面类用来决定「接面板」还是「提示未开放」）。 */
export function landedLeagueEntrances(): readonly ILeagueEntrance[] {
    return LEAGUE_ENTRANCES.filter((entrance) => entrance.landed);
}

/**
 * 尚未落地的入口 —— P6 收口后**恒为空**（六个入口全 `landed:true`）。
 *
 * 保留本函数是为了以后新增入口时，单测可以断言「当前只剩外壳」而不用手写节点名。
 */
export function pendingLeagueEntrances(): readonly ILeagueEntrance[] {
    return LEAGUE_ENTRANCES.filter((entrance) => !entrance.landed);
}

/**
 * 入口按钮上**红点节点**的名字。
 *
 * FGUI 四个入口按钮组件（`主界面/按钮_联盟_红|棕|蓝|玩法标题.xml`）里那颗都叫 `com_rd`；
 * 本端统一改名 `RedDot`（与 `ui/common/RedDot.prefab` 的根同名，便于 `getChildByName`）。
 *
 * ⚠️ 契约：`League.prefab` 里**六个**入口按钮下各挂一个 `ui/common/RedDot.prefab` 的嵌套实例，
 *    名字 `RedDot`（初始显隐不重要 —— `LeaguePage.applyEntranceRedDots()` 每次绝对赋值）。
 *    重命名时必须同步本常量与 `LeaguePage` 的查找。
 */
export const LEAGUE_ENTRANCE_RED_DOT = 'RedDot';

/**
 * 入口红点由哪条判据驱动。
 *
 * | 入口 | 老端 | 本端 |
 * |---|---|---|
 * | 联盟大厅 | `TabLeagueMain.updateRD()` 里**没有** `btn_hall` | `none` |
 * | 联盟商店 | `hasStoreRD()` —— 老端调用点那两行**是注释掉的** | `none`（照抄） |
 * | 每日砍价 | `hasDiscountRD()` = `todayBargainTimes < unionBargainBuyCount` | `discount`（**真做**） |
 * | 联盟任务 | `hasTaskRD()` = 「有任务可领」∪「有宝箱可领」 | `task`（**真做**，P5） |
 * | 联合战线 | `hasNorthernExpeditionRD()` = 挑战红点 ∪ 奖励红点 | `north`（**真做**，P6） |
 * | 联盟捐献 | `hasDonateRD()` = `ModelRole.GetAdvertRestTimes(AdType.unionDonate) > 0` —— 依赖**未迁移**的广告子系统 | `none` |
 *
 * ⚠️ 三条 `'task'` / `'discount'` / `'north'` 判据都要求**已入盟**
 *    （老端 `RDLeague.OnComputeResult()` 里先判 `ModelLeague.HasUnion()`）
 *    —— 那层闸在 `LeagueRepository.loadLeagueEntryRedDots()` 里，本表只管「哪个入口吃哪条字段」。
 */
export type LeagueEntranceRedDotSource = 'none' | 'discount' | 'task' | 'north';

/** 入口 → 红点来源（`LeagueEntranceKey` 全覆盖，漏一个类型就不过）。 */
export const LEAGUE_ENTRANCE_RED_DOT_SOURCE: Readonly<Record<LeagueEntranceKey, LeagueEntranceRedDotSource>> = {
    LayerLeagueHall: 'none',
    LayerLeagueStore: 'none',
    LayerLeagueDiscount: 'discount',
    LayerLeagueTask: 'task',
    LayerLeagueNorthernExpedition: 'north',
    LayerLeagueDonate: 'none',
};

// ============================================================
// 信息条（旗帜 + 名称 / 等级 / 成员数）
// ============================================================

/** 主页 prefab 里信息条相关节点的名字（页面类按名取，避免一堆 Inspector 绑定）。 */
export const LEAGUE_INFO_NODES = {
    banner: 'Banner',
    bannerFrame: 'Frame',
    bannerBase: 'Base',
    bannerColor: 'ColorIcon',
    name: 'LabName',
    level: 'LabLv',
    memberCount: 'LabUserCount',
    infoBg: 'InfoBg',
} as const;

/**
 * 信息条的三条文案（FGUI 原稿的占位值）。
 *
 * 真值要等联盟数据落地（`CmdUnion`）—— 老端是 `ModelLeague` 往这几个 `text` 里写。
 * 现阶段保留 FGUI 占位串，好处是「界面看起来是完整的」，且与设计稿逐字一致。
 */
export const LEAGUE_INFO_PLACEHOLDER = {
    name: '北伐中原',
    level: '传奇:4级',
    memberCount: '成员:26/46',
} as const;

// ============================================================
// 等级预览（配置表 `remoteRef/unionLevel.json`）
// ============================================================

/** 表名（`assets/remoteRef/unionLevel.json`，老端 `Ref.RefMgrunionLevel`）。 */
export const LEAGUE_UNION_LEVEL_TABLE = 'unionLevel';

/**
 * `unionLevel.json` 的一行。列 = `level` / `maxCount` / `exp`（`k` 列式，`v` 是行数组）。
 *
 * 现网 10 行：`1→40 / 2→42 / 3→44 / 4→46 / 5→48 / 6→51 / 7→54 / 8→57 / 9→60 / 10→65`。
 */
export interface ILeagueUnionLevelRow {
    readonly level: number;
    readonly maxCount: number;
    readonly exp: number;
}

/** 等级预览列表的一行（文案已拼好，行组件只负责上屏）。 */
export interface ILeagueLevelView {
    readonly level: number;
    /** 行标题（「等级N」）。 */
    readonly title: string;
    /** 行副文案（「最大可加入人数：+Δ」）。 */
    readonly ctx: string;
}

/**
 * 按等级取 `unionLevel` 那一行 —— 老端 `VOUnion.refNow`
 * （`Ref.RefMgrunionLevel.getRef("level", cmd.level)`）。
 *
 * 取不到返回 `null`（等级越界 / 表还没读到）。**不要**退回第 1 行或最后一行：
 * 那会让「进度条满格」这种假象悄悄出现在数据没到位的时候。
 */
export function findLeagueLevelRow(
    rows: readonly ILeagueUnionLevelRow[],
    level: number,
): ILeagueUnionLevelRow | null {
    if (!Number.isFinite(level)) return null;
    for (const row of rows) {
        if (row.level === level) return row;
    }
    return null;
}

/**
 * 联盟本级经验的**上限** —— 老端 `VOUnion.GetMaxExp() = refNow.exp`（进度条的 `max`）。
 *
 * 注意语义：`unionLevel.exp` 是「这一级的经验上限」，不是「升级所需」。
 * 表里第 1 级就是 `2000`，所以 1 级联盟的进度条 max 是 2000（不是「升到 2 级要 2000」那句
 * — 那句话恰好也成立，但别把两者混成同一个判据）。
 */
export function leagueMaxExp(rows: readonly ILeagueUnionLevelRow[], level: number): number {
    const row = findLeagueLevelRow(rows, level);
    return row ? row.exp : 0;
}

/**
 * 宽松取整（`remoteRef` 导出的数字列可能以字符串落盘 —— 同 MEMORY 里 PVP 表的既有做法）。
 *
 * ⚠️ **缺失值必须给 `NaN`、不能给 `0`**：`Number(null)` 是 `0`、`Number('')` 也是 `0`，
 * 而这两者在配置表里都是「这一格没填」。若收敛成 `0`，`parseXxx` 的 `Number.isFinite` 守卫
 * 就会把**空行当成值是 0 的合法行**放进结果 —— 例如 `unionOfficial` 里多出一条
 * `position = 0` 的假职位，`resolveLeagueMemberActions(0, …)` 于是能查到一份「全 false」的权限，
 * 与「我的职位查不到 ⇒ 无权限」这条判据混在一起，很难查。
 */
function toInt(value: unknown): number {
    if (typeof value === 'boolean') return NaN;
    if (value === null || value === undefined || value === '') return NaN;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

/**
 * `toInt` 的「带兜底」版本：解析不出就返回 `fallback`（不返回 `NaN`）。
 *
 * ⚠️ P4 的这几张表里有**合法的 0**（`freeTimes` / `adTimes` 全表都是 0；`unionDiscount` 的
 *    `minPrice` 也可能是 0）⇒ 不能像 `unionLevel` 那样「解析不出就丢整行」。
 */
function intOr(value: unknown, fallback: number): number {
    const n = toInt(value);
    return Number.isFinite(n) ? n : fallback;
}

/** 计数归一：解析不出的、负数一律当 `0`（老端满屏 `… || 0` 的口径）。 */
function toCount(value: unknown): number {
    const n = toInt(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 把 `{k,v}` 列式配置表摊平成对象行。
 *
 * 兼容三种形状：① `{k:[列名…], v:[[值…],…]}`（本表就是这种）；② `{k,v}` 里 `v` 已经是对象行；
 * ③ 直接就是对象数组。取不到就返回空数组（**不抛** —— 表缺失时界面应当空着而不是崩）。
 */
export function toRefRows(raw: unknown): Record<string, unknown>[] {
    if (Array.isArray(raw)) {
        return raw.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
    }
    if (raw && typeof raw === 'object') {
        const box = raw as { k?: unknown; v?: unknown };
        if (Array.isArray(box.k) && Array.isArray(box.v)) {
            const keys = box.k.map((x) => String(x));
            return (box.v as unknown[]).map((row) => {
                if (Array.isArray(row)) {
                    const rec: Record<string, unknown> = {};
                    for (let i = 0; i < keys.length; i += 1) rec[keys[i]] = row[i];
                    return rec;
                }
                return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
            });
        }
    }
    return [];
}

/**
 * 解析 `unionLevel`。
 *
 * **丢弃** `level` 或 `maxCount` 解析不出整数的脏行（按 `level` 升序返回）。
 */
export function parseUnionLevelRows(raw: unknown): ILeagueUnionLevelRow[] {
    const out: ILeagueUnionLevelRow[] = [];
    for (const row of toRefRows(raw)) {
        const level = toInt(row.level);
        const maxCount = toInt(row.maxCount);
        if (!Number.isFinite(level) || !Number.isFinite(maxCount)) continue;
        const exp = toInt(row.exp);
        out.push({ level, maxCount, exp: Number.isFinite(exp) ? exp : 0 });
    }
    out.sort((a, b) => a.level - b.level);
    return out;
}

/**
 * 行视图模型 = 老端口径：`addCount = 本级上限 − 上一级上限`，**找不到上一级就用本级上限**
 * （老端 `RefMgrunionLevel.getRef("level", refId - 1)` 返回空时的分支）。
 *
 * ⚠️ 老端是按 **level** 查上一级（`refId - 1`），不是按数组下标 —— 表里级别不连续时
 * 两者不等价。这里照老端按 level 查。
 */
export function buildLeagueLevelViews(
    rows: readonly ILeagueUnionLevelRow[],
    titlePrefix = LEAGUE_LEVEL_ROW_TITLE_PREFIX,
    ctxPrefix = LEAGUE_LEVEL_ROW_CTX_PREFIX,
): ILeagueLevelView[] {
    const byLevel = new Map<number, ILeagueUnionLevelRow>();
    for (const row of rows) byLevel.set(row.level, row);
    return rows.map((row) => {
        const prev = byLevel.get(row.level - 1);
        const addCount = prev ? row.maxCount - prev.maxCount : row.maxCount;
        return {
            level: row.level,
            title: `${titlePrefix}${row.level}`,
            ctx: `${ctxPrefix}${addCount}`,
        };
    });
}

// ============================================================
// 职位权限（配置表 `remoteRef/unionOfficial.json`）
// ============================================================

/** 表名（老端 `Ref.RefMgrunionOfficial`）。 */
export const LEAGUE_UNION_OFFICIAL_TABLE = 'unionOfficial';

/**
 * 职位 id（老端 `LeagueOfficalType`）。
 *
 * ⚠️ 这是**协议字段** `CmdUnionMember.position` 的取值，与配置表的 `position` 列同域 ——
 * 别和「数组下标」搞混。
 */
export const LeaguePosition = {
    LEADER: 1,
    ADMIN: 2,
    MEMBER: 3,
} as const;

/** `unionOfficial.json` 的一行 —— 一个职位的权限集合。 */
export interface ILeagueOfficialRow {
    readonly position: number;
    readonly name: string;
    /** 能否审批入盟申请。 */
    readonly canApprove: boolean;
    /** 能否编辑联盟信息。 */
    readonly canEdit: boolean;
    /** 能踢出**哪些职位**的人。 */
    readonly kick: readonly number[];
    /** 能任命**哪些职位**的人为盟主。 */
    readonly appointLeader: readonly number[];
    /** 能任命**哪些职位**的人为副盟主。 */
    readonly appointDeputy: readonly number[];
    /** 能卸任**哪些职位**的人。 */
    readonly dismiss: readonly number[];
}

/** 宽松布尔（配置表里是 0/1）。 */
function toBool(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (text === 'true' || text === '1') return true;
        if (text === 'false' || text === '0') return false;
    }
    return fallback;
}

/** 宽松整数数组（配置表里可能是 `[2,3]` 或 `"2,3"` 或空）。 */
function toIntList(value: unknown): number[] {
    const out: number[] = [];
    const push = (item: unknown): void => {
        const n = toInt(item);
        if (Number.isFinite(n) && !out.includes(n)) out.push(n);
    };
    if (Array.isArray(value)) value.forEach(push);
    else if (typeof value === 'string') value.split(',').forEach(push);
    else if (value !== undefined && value !== null) push(value);
    return out;
}

/**
 * 解析 `unionOfficial`；`position` 解析不出整数、或 `position < 1` 的脏行**丢弃**
 * （按 `position` 升序）。
 *
 * ⚠️ `position >= 1` 是硬门槛：`0` 在协议域里表示「未入盟 / 没有职位」，
 * 让一条 `position = 0` 的行进表，等于凭空造出一份「存在但全 false」的权限。
 */
export function parseLeagueOfficialRows(raw: unknown): ILeagueOfficialRow[] {
    const out: ILeagueOfficialRow[] = [];
    for (const row of toRefRows(raw)) {
        const position = toInt(row.position);
        if (!Number.isFinite(position) || position < 1) continue;
        out.push({
            position,
            name: typeof row.name === 'string' ? row.name : '',
            canApprove: toBool(row.canApprove),
            canEdit: toBool(row.canEdit),
            kick: toIntList(row.kick),
            appointLeader: toIntList(row.appointLeader),
            appointDeputy: toIntList(row.appointDeputy),
            dismiss: toIntList(row.dismiss),
        });
    }
    out.sort((a, b) => a.position - b.position);
    return out;
}

/** `position → 权限` 的查表（查不到返回 `null`）。 */
export function officialPowersMap(rows: readonly ILeagueOfficialRow[]): Map<number, ILeagueOfficialRow> {
    const map = new Map<number, ILeagueOfficialRow>();
    for (const row of rows) map.set(row.position, row);
    return map;
}

/**
 * 角色操作浮层 5 个按钮的显隐 —— **纯函数**，老端口径：
 *
 * ```ts
 * let myvo = ModelLeague.GetMyMember();        // 我的成员对象
 * myvo.CanBeXxx(targetOffical)                  // targetOffical = 目标成员的 position
 *   ⇒ RefMgrunionOfficial.getRef("position", **我的** position).xxx.indexOf(target) > -1
 * ```
 *
 * 即「**我的职位**能不能对**目标职位**做这件事」，两边都是 `position` 值。
 * 我的职位查不到时**全部 `false`**（宁可不给操作，也别发出会被服务端拒的包）。
 *
 * `show`（查看）老端恒 `true` —— 但点自己时上层还要拦一道（`LEAGUE_TIP_VIEW_SELF`）。
 */
export interface ILeagueMemberActions {
    readonly show: boolean;
    readonly appointLeader: boolean;
    readonly appointAdmin: boolean;
    readonly dismissAdmin: boolean;
    readonly kick: boolean;
}

export function resolveLeagueMemberActions(
    myPosition: number,
    targetPosition: number,
    powers: ReadonlyMap<number, ILeagueOfficialRow>,
): ILeagueMemberActions {
    const my = powers.get(myPosition);
    if (!my) {
        return { show: true, appointLeader: false, appointAdmin: false, dismissAdmin: false, kick: false };
    }
    return {
        show: true,
        appointLeader: my.appointLeader.includes(targetPosition),
        appointAdmin: my.appointDeputy.includes(targetPosition),
        dismissAdmin: my.dismiss.includes(targetPosition),
        kick: my.kick.includes(targetPosition),
    };
}

/** 我的职位能否审批入盟申请（申请列表按钮的显隐）。 */
export function canApproveJoin(myPosition: number, powers: ReadonlyMap<number, ILeagueOfficialRow>): boolean {
    return powers.get(myPosition)?.canApprove === true;
}

/** 我的职位能否编辑联盟信息（编辑信息面板的入口）。 */
export function canEditUnion(myPosition: number, powers: ReadonlyMap<number, ILeagueOfficialRow>): boolean {
    return powers.get(myPosition)?.canEdit === true;
}

// ============================================================
// 缓存行归一化（`CmdUnion` / `CmdUnionMember` / `CmdUnionLogs` / `CmdUnionApplys`）
// ============================================================

/** 宽松字符串（`Long` / number / string 都收敛成字符串；空值给 `''`）。 */
function toText(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
    if (value && typeof value === 'object') {
        const long = value as { toString?: () => string; low?: number; high?: number };
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            const text = typeof long.toString === 'function' ? long.toString() : '';
            if (text && text !== '[object Object]') return text;
            return String(long.high * 4294967296 + (long.low >>> 0));
        }
        if (typeof long.toString === 'function') {
            const text = long.toString();
            if (text && text !== '[object Object]') return text;
        }
    }
    return fallback;
}

/** `CmdUnion` 归一化后的行（一盟一行，`tlKey = id`）。 */
export interface ILeagueUnionRow {
    readonly id: string;
    readonly name: string;
    readonly level: number;
    /** 旗帜颜色（`组件_联盟_旗帜` 的「颜色」控制器页序）。 */
    readonly icon: number;
    readonly count: number;
    readonly maxCount: number;
    readonly autoJoin: boolean;
    readonly leaderId: string;
    readonly leaderName: string;
    readonly notice: string;
    readonly declaration: string;
    readonly wxChat: string;
    readonly exp: number;
}

/** 归一化一条 `CmdUnion`；`id` 解析不出来（=0/空）返回 `null`。 */
export function normalizeLeagueUnion(raw: unknown): ILeagueUnionRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const cmd = raw as Record<string, unknown>;
    const id = toText(cmd.id);
    if (!id || id === '0') return null;
    const level = toInt(cmd.level);
    const count = toInt(cmd.count);
    const maxCount = toInt(cmd.maxCount);
    const icon = toInt(cmd.icon);
    const exp = toInt(cmd.exp);
    return {
        id,
        name: toText(cmd.name),
        level: Number.isFinite(level) ? level : 0,
        icon: Number.isFinite(icon) ? icon : 0,
        count: Number.isFinite(count) ? count : 0,
        maxCount: Number.isFinite(maxCount) ? maxCount : 0,
        autoJoin: toBool(cmd.autoJoin),
        leaderId: toText(cmd.leaderId),
        leaderName: toText(cmd.leaderName),
        notice: toText(cmd.notice),
        declaration: toText(cmd.declaration),
        wxChat: toText(cmd.wxChat),
        exp: Number.isFinite(exp) ? exp : 0,
    };
}

/** 归一化一批 `CmdUnion`（丢脏行）。 */
export function normalizeLeagueUnions(raw: readonly unknown[] | null | undefined): ILeagueUnionRow[] {
    const out: ILeagueUnionRow[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        const row = normalizeLeagueUnion(item);
        if (row) out.push(row);
    }
    return out;
}

/** `CmdUnionMember` 归一化后的行（`tlKey = roleId`）。 */
export interface ILeagueMemberRow {
    readonly roleId: string;
    readonly name: string;
    /** 头像 id（老端 `ModelPlayer.GetPlayerIcon(cmd.img)` 的入参）。 */
    readonly img: string;
    readonly headFrame: string;
    readonly level: number;
    readonly power: string;
    readonly serverId: number;
    readonly selectServerId: number;
    readonly position: number;
    readonly online: boolean;
    /** 最近离线时刻（**毫秒**；`0` = 从没离线过）。 */
    readonly lastOfflineTimeMs: number;
    readonly todayContribute: number;
    readonly allContribute: number;
}

/** 归一化一条 `CmdUnionMember`；`roleId` 解析不出来返回 `null`。 */
export function normalizeLeagueMember(raw: unknown): ILeagueMemberRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const cmd = raw as Record<string, unknown>;
    const roleId = toText(cmd.roleId);
    if (!roleId || roleId === '0') return null;
    const level = toInt(cmd.level);
    const position = toInt(cmd.position);
    const serverId = toInt(cmd.serverId);
    const selectServerId = toInt(cmd.selectServerId);
    const today = toInt(cmd.todayContribute);
    const all = toInt(cmd.allContribute);
    const offline = toText(cmd.lastOfflineTime);
    return {
        roleId,
        name: toText(cmd.name),
        img: toText(cmd.img, '0'),
        headFrame: toText(cmd.headFrame, '0'),
        level: Number.isFinite(level) ? level : 0,
        power: toText(cmd.power, '0'),
        serverId: Number.isFinite(serverId) ? serverId : 0,
        selectServerId: Number.isFinite(selectServerId) ? selectServerId : 0,
        position: Number.isFinite(position) ? position : LeaguePosition.MEMBER,
        online: toBool(cmd.online),
        lastOfflineTimeMs: Number(offline) || 0,
        todayContribute: Number.isFinite(today) ? today : 0,
        allContribute: Number.isFinite(all) ? all : 0,
    };
}

/** 归一化一批 `CmdUnionMember`（丢脏行）。 */
export function normalizeLeagueMembers(raw: readonly unknown[] | null | undefined): ILeagueMemberRow[] {
    const out: ILeagueMemberRow[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        const row = normalizeLeagueMember(item);
        if (row) out.push(row);
    }
    return out;
}

/** `CmdUnionLogs` 归一化后的行（`tlKey = id`）。 */
export interface ILeagueLogRow {
    readonly id: string;
    /** 被操作的成员名。 */
    readonly name: string;
    /** `1` = 加入，其余 = 离开/被踢。 */
    readonly join: number;
    /** 发生时刻（**毫秒**）。 */
    readonly timeMs: number;
    /** 操作者职位（`1` = 盟主）。 */
    readonly opPosition: number;
    /** 操作人名。 */
    readonly opName: string;
}

/** 归一化一条 `CmdUnionLogs`；`id` 解析不出来返回 `null`。 */
export function normalizeLeagueLog(raw: unknown): ILeagueLogRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const cmd = raw as Record<string, unknown>;
    const id = toText(cmd.id);
    if (!id) return null;
    const join = toInt(cmd.join);
    const opPosition = toInt(cmd.opPosition);
    return {
        id,
        name: toText(cmd.name),
        join: Number.isFinite(join) ? join : 0,
        timeMs: Number(toText(cmd.time)) || 0,
        opPosition: Number.isFinite(opPosition) ? opPosition : 0,
        opName: toText(cmd.opName),
    };
}

/** 归一化一批 `CmdUnionLogs`（丢脏行）。 */
export function normalizeLeagueLogs(raw: readonly unknown[] | null | undefined): ILeagueLogRow[] {
    const out: ILeagueLogRow[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        const row = normalizeLeagueLog(item);
        if (row) out.push(row);
    }
    return out;
}

/** `CmdUnionApplys` 归一化后的行（`tlKey = applyId`）。 */
export interface ILeagueApplyRow {
    readonly applyId: string;
    readonly name: string;
    readonly img: string;
    readonly headFrame: string;
    readonly level: number;
    readonly power: string;
    readonly serverId: number;
    readonly selectServerId: number;
}

/** 归一化一条 `CmdUnionApplys`；`applyId` 解析不出来返回 `null`。 */
export function normalizeLeagueApply(raw: unknown): ILeagueApplyRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const cmd = raw as Record<string, unknown>;
    const applyId = toText(cmd.applyId);
    if (!applyId || applyId === '0') return null;
    const level = toInt(cmd.level);
    const serverId = toInt(cmd.serverId);
    const selectServerId = toInt(cmd.selectServerId);
    return {
        applyId,
        name: toText(cmd.name),
        img: toText(cmd.img, '0'),
        headFrame: toText(cmd.headFrame, '0'),
        level: Number.isFinite(level) ? level : 0,
        power: toText(cmd.power, '0'),
        serverId: Number.isFinite(serverId) ? serverId : 0,
        selectServerId: Number.isFinite(selectServerId) ? selectServerId : 0,
    };
}

/** 归一化一批 `CmdUnionApplys`（丢脏行）。 */
export function normalizeLeagueApplies(raw: readonly unknown[] | null | undefined): ILeagueApplyRow[] {
    const out: ILeagueApplyRow[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        const row = normalizeLeagueApply(item);
        if (row) out.push(row);
    }
    return out;
}

// ============================================================
// 时间文案（老端 `TimeUtil.timeSec2HMSStr3` / `time2String2`）
// ============================================================

/** `{0}` / `{1}` / `{2}` 顺序替换（本文件不 import `LeagueTexts` 的同一个函数，避免表→文案反向依赖）。 */
function fillText(template: string, ...values: readonly (string | number)[]): string {
    if (typeof template !== 'string') return '';
    return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const value = values[Number(index)];
        return value === undefined || value === null ? whole : String(value);
    });
}

/** 两位补零。 */
function pad2(value: number): string {
    return (value < 10 ? '0' : '') + value;
}

/** 离线时长文案的三档模板（调用方从 `LeagueTexts` 取）。 */
export interface ILeagueOfflineTexts {
    readonly onlineText: string;
    /** `{0}天{1}小时{2}分前`。 */
    readonly days: string;
    /** `{0}小时{1}分前`。 */
    readonly hours: string;
    /** `{0}分前`。 */
    readonly minutes: string;
}

/**
 * 详情行「上次登录」列 —— 老端 `TimeUtil.timeSec2HMSStr3((now - lastOfflineTime) / 1000)`。
 *
 * 三档与缩放口径：
 * ```
 * h = floor(秒 / 3600)          // ⚠️ **总**小时，不是 24 进制的小时位
 * day = floor(h / 24); hour = h % 24; m = floor((秒 - h*3600) / 60)
 * day > 0 → "{day}天 {hour}小时 {m}分前"     // day **不补零**
 * hour > 0 → "{hour}小时 {m}分前"            // hour / m **两位补零**
 * 其余     → "{m}分前"                       // m **两位补零**
 * ```
 *
 * ⚠️ `online === true` 或 `lastOfflineTimeMs === 0` ⇒ 直接「在线」（老端的第一个分支，
 * 不是「0 分钟前」）。
 */
export function leagueOfflineText(
    online: boolean,
    lastOfflineTimeMs: number,
    nowMs: number,
    texts: ILeagueOfflineTexts,
): string {
    if (online || !lastOfflineTimeMs) return texts.onlineText;
    const seconds = Math.max(0, (nowMs - lastOfflineTimeMs) / 1000);
    const totalHours = Math.floor(seconds / 3600);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const minutes = Math.floor((seconds - totalHours * 3600) / 60);
    if (days > 0) return fillText(texts.days, days, pad2(hours), pad2(minutes));
    if (hours > 0) return fillText(texts.hours, pad2(hours), pad2(minutes));
    return fillText(texts.minutes, pad2(minutes));
}

/**
 * 动态行的时刻文案 —— 老端 `TimeUtil.time2String2(cmd.time)` = `MM/DD HH:mm:ss`。
 *
 * ⚠️ 入参是**毫秒**（老端 `time2Date` 直接 `new Date(time)`）。`0` / 非法值 → `''`
 * （老端 `time2Date` 会把负数夹成 0 ⇒ 1970 年，那显然不是想要的；这里给空串更安全）。
 */
export function formatLeagueLogTime(timeMs: number): string {
    if (!Number.isFinite(timeMs) || timeMs <= 0) return '';
    const date = new Date(timeMs);
    return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

// ============================================================
// 行视图模型（行组件只负责「上屏」，文案全在这里拼好）
// ============================================================

/** 动态行的视图模型。 */
export interface ILeagueLogView {
    readonly id: string;
    /** 已按 `join` / `opPosition` 选好模板并填好名字的整句。 */
    readonly ctx: string;
    /** `MM/DD HH:mm:ss`。 */
    readonly timeText: string;
    /** 是否「加入」类（空模板时上层可用来兜底）。 */
    readonly join: boolean;
}

/** 动态行文案的三句模板（调用方从 `LeagueTexts` 取）。 */
export interface ILeagueLogTexts {
    readonly join: string;
    readonly kick: string;
    readonly quit: string;
}

/**
 * 动态行文案 —— 老端口径：
 *
 * ```ts
 * if (cmd.join == 1)                       format(ALLIANCE_DYNAMIC_MESSAGE1, cmd.name)          // 欢迎新成员{0}加入联盟
 * else if (cmd.opPosition == 1)             format(ALLIANCE_DYNAMIC_MESSAGE2, cmd.name, cmd.opName) // 成员{0}被{1}请出联盟
 * else                                      format(ALLIANCE_DYNAMIC_MESSAGE3, cmd.name)          // 成员{0}退出联盟
 * ```
 *
 * ⚠️ 第二档判的是 `opPosition == 1`（**盟主**操作的才是「请出」）；副盟主踢人走第三档
 * 「退出联盟」—— 属老端的分支写法，照搬。
 */
export function buildLeagueLogViews(
    rows: readonly ILeagueLogRow[],
    texts: ILeagueLogTexts,
    sortDescending = true,
): ILeagueLogView[] {
    const views = rows.map((row) => {
        const isJoin = row.join === 1;
        let ctx: string;
        if (isJoin) ctx = fillText(texts.join, row.name);
        else if (row.opPosition === 1) ctx = fillText(texts.kick, row.name, row.opName);
        else ctx = fillText(texts.quit, row.name);
        return { id: row.id, ctx, timeText: formatLeagueLogTime(row.timeMs), join: isJoin, timeMs: row.timeMs };
    });
    if (sortDescending) views.sort((a, b) => b.timeMs - a.timeMs);
    return views.map(({ id, ctx, timeText, join: isJoin }) => ({ id, ctx, timeText, join: isJoin }));
}

/** 详情行的视图模型。 */
export interface ILeagueMemberView {
    readonly roleId: string;
    readonly name: string;
    /** 等级（纯数字，FGUI `lab_lv` 不带后缀）。 */
    readonly levelText: string;
    readonly powerText: string;
    /** 「在线」或「{N}分/小时/天前」。 */
    readonly timeText: string;
    /** `今日贡献/累计贡献`（FGUI `lab_usercount`）。 */
    readonly contributeText: string;
    readonly position: number;
    /** 头像 id（上层拿它去解析头像图）。 */
    readonly img: string;
    readonly serverId: number;
    readonly selectServerId: number;
    readonly online: boolean;
}

/**
 * 详情行 —— 老端 `LayerLeagueHallDetail.render()` 逐字段对齐：
 *
 * | 节点 | 值 |
 * |---|---|
 * | `lab_name` | `cmd.name` |
 * | `lab_lv` | `cmd.level`（**纯数字**，不带「级」；与全服页不同） |
 * | `lab_power` | `cmd.power` |
 * | `lab_time` | `ONLINE_TEXT` 或离线时长 |
 * | `lab_usercount` | `` `${todayContribute}/${allContribute}` `` |
 * | `icon` | 头像（`GetPlayerIcon(cmd.img)`） |
 * | `盟主` 控制器 | `IsLeader` → 盟主 / `IsAdmin` → 副盟主 / 其余 → 否 |
 *
 * 排序：老端用 `CmdUnionMember` 缓存的原始序（服务端给的）。这里**保持原序**，
 * 但把盟主提到最前、其余按职位升序再按累计贡献降序 —— 这是**新端加的一道**，
 * 因为缓存序在真机上不稳定（`GetValues` 的实现随版本变）。
 */
export function buildLeagueMemberViews(
    rows: readonly ILeagueMemberRow[],
    nowMs: number,
    offlineTexts: ILeagueOfflineTexts,
    sortForDisplay = true,
): ILeagueMemberView[] {
    // 排序键 `allContribute` 只用于排序，不进视图模型 ⇒ 单独放一张平行表，别塞进返回值再删。
    const entries: { view: ILeagueMemberView; allContribute: number }[] = rows.map((row) => ({
        view: {
            roleId: row.roleId,
            name: row.name,
            levelText: String(row.level),
            powerText: row.power,
            timeText: leagueOfflineText(row.online, row.lastOfflineTimeMs, nowMs, offlineTexts),
            contributeText: `${row.todayContribute}/${row.allContribute}`,
            position: row.position,
            img: row.img,
            serverId: row.serverId,
            selectServerId: row.selectServerId,
            online: row.online,
        },
        allContribute: row.allContribute,
    }));
    if (sortForDisplay) {
        entries.sort((a, b) => {
            if (a.view.position !== b.view.position) return a.view.position - b.view.position;
            if (a.allContribute !== b.allContribute) return b.allContribute - a.allContribute;
            return a.view.roleId < b.view.roleId ? -1 : a.view.roleId > b.view.roleId ? 1 : 0;
        });
    }
    return entries.map((entry) => entry.view);
}

/** 全服行的视图模型。 */
export interface ILeagueUnionView {
    readonly id: string;
    readonly name: string;
    /** `6级`。 */
    readonly levelText: string;
    /** `盟主:xxxx`。 */
    readonly leaderText: string;
    /** `成员:45/46`。 */
    readonly memberText: string;
    /** 旗帜颜色（`组件_联盟_旗帜` 的控制器页序）。 */
    readonly icon: number;
    readonly autoJoin: boolean;
    readonly count: number;
    readonly maxCount: number;
    /**
     * 联系微信号（**裸值，不带前缀**）。
     *
     * ⚠️ 全服行自己**不显示**这一列 —— 它是给「点行开联盟信息」那条链路带的
     *    （`LeagueInfoPage` 的 `微信号：` 那行）。放在这里是为了让「行 → 详情」传的是
     *    **同一个不可变视图对象**，不必让列表再留一份 `ILeagueUnionRow` 原始行。
     */
    readonly wxChat: string;
    /** 联盟宣言（同 `wxChat`：行不显示，详情要用）。 */
    readonly declaration: string;
}

/** 全服行文案的两个前缀（调用方从 `LeagueTexts` 取）。 */
export interface ILeagueUnionTexts {
    readonly levelSuffix: string;
    readonly leaderPrefix: string;
    readonly memberPrefix: string;
}

/**
 * 全服行 —— 老端 `LayerLeagueHallAllServer.render()`：
 * `lab_name` / `lab_lv`（`` `${level}级` ``）/ `lab_topuser`（`盟主:名字`）/
 * `lab_usercount`（`成员:count/maxCount`）/ `banner`（按 `vo.icon` 选「颜色」页）。
 */
export function buildLeagueUnionViews(
    rows: readonly ILeagueUnionRow[],
    texts: ILeagueUnionTexts,
): ILeagueUnionView[] {
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        levelText: `${row.level}${texts.levelSuffix}`,
        leaderText: `${texts.leaderPrefix}${row.leaderName}`,
        memberText: `${texts.memberPrefix}${row.count}/${row.maxCount}`,
        icon: row.icon,
        autoJoin: row.autoJoin,
        count: row.count,
        maxCount: row.maxCount,
        wxChat: row.wxChat,
        declaration: row.declaration,
    }));
}

/** 详情页签表头的成员数（老端 `ALLIANCE_MEMBER + `${count}/${maxCount}``）。 */
export function buildMemberCountText(prefix: string, count: number, maxCount: number): string {
    return `${prefix}${count}/${maxCount}`;
}

// ============================================================
// 联盟信息（`ui/League/LeagueInfo`）
// ============================================================

/** 「联盟信息」弹窗的视图模型（7 行文字 + 旗帜色，全部拼好）。 */
export interface ILeagueInfoView {
    readonly id: string;
    /** 联盟名（纯名，不带前缀）。 */
    readonly name: string;
    /** `6级`。 */
    readonly levelText: string;
    /** `盟主:aaaa`。 */
    readonly leaderText: string;
    /** `ID:2115228`。 */
    readonly idText: string;
    /** `微信号：xxx`（**全角**冒号，见 `LeagueTexts.LEAGUE_HALL_WX_PREFIX`）。 */
    readonly wxText: string;
    /** `成员:46/51`。 */
    readonly memberText: string;
    /** 联盟宣言（多行正文，直接进 `comp_dec.content`）。 */
    readonly declaration: string;
    /** 旗帜颜色下标。 */
    readonly icon: number;
}

/** 联盟信息要的三条额外前缀（`levelSuffix` / `leaderPrefix` / `memberPrefix` 复用 `ILeagueUnionTexts`）。 */
export interface ILeagueInfoTexts extends ILeagueUnionTexts {
    /** `ID:`。 */
    readonly idPrefix: string;
    /** `微信号：`（**全角**冒号）。 */
    readonly contactPrefix: string;
}

/**
 * 联盟信息 —— 老端 `LayerLeagueInfoUI.updateView()` 逐句对齐：
 *
 * | FGUI 节点 | 老端赋值 |
 * |---|---|
 * | `league_name` | `cmd.name` |
 * | `league_lv` | `` cmd.level + FW.G_W("LV_TEXT") `` |
 * | `league_leader` | `FW.G_W("UNION_MENBER_0") + cmd.leaderName` |
 * | `league_id` | `` `ID:${cmd.id}` `` |
 * | `league_wx` | `FW.G_W("CONTACT_WAY") + cmd.wxChat` |
 * | `lab_user` | `` FW.G_W("UNION_MENBER_1") + `${count}/${maxCount}` `` |
 * | `comp_dec.content` | `cmd.declaration` |
 * | `league_banner` | 按 `cmd.icon` 选「颜色」页 |
 *
 * ⚠️ `lab_user` 走的是 `count` / `maxCount` 两个**协议字段**（不是成员列表长度）——
 *    老端同此，且 `cmd` 为空时整块面板直接 `showTip + unload`（`buildLeagueInfoView` 返回 `null`）。
 */
export function buildLeagueInfoView(
    union: ILeagueUnionRow | null | undefined,
    texts: ILeagueInfoTexts,
): ILeagueInfoView | null {
    if (!union) return null;
    return {
        id: union.id,
        name: union.name,
        levelText: `${union.level}${texts.levelSuffix}`,
        leaderText: `${texts.leaderPrefix}${union.leaderName}`,
        idText: `${texts.idPrefix}${union.id}`,
        wxText: `${texts.contactPrefix}${union.wxChat}`,
        memberText: buildMemberCountText(texts.memberPrefix, union.count, union.maxCount),
        declaration: union.declaration,
        icon: union.icon,
    };
}

/**
 * 从「全服行视图」取出联盟信息（列表行 → 详情弹窗那条链路的入参）。
 *
 * 行的 `levelText` / `leaderText` / `memberText` 已经是拼好的串，直接复用；
 * `idText` / `wxText` 行上没有（行不显示这两列）⇒ 在这儿补拼。
 */
export function buildLeagueInfoViewFromUnionView(
    view: ILeagueUnionView | null | undefined,
    texts: ILeagueInfoTexts,
): ILeagueInfoView | null {
    if (!view) return null;
    return {
        id: view.id,
        name: view.name,
        levelText: view.levelText,
        leaderText: view.leaderText,
        idText: `${texts.idPrefix}${view.id}`,
        wxText: `${texts.contactPrefix}${view.wxChat}`,
        memberText: view.memberText,
        declaration: view.declaration,
        icon: view.icon,
    };
}

// ============================================================
// 联盟管理（`ui/League/LeagueMgr`）
// ============================================================

/** 「联盟管理」弹窗的视图模型。 */
export interface ILeagueMgrView {
    readonly id: string;
    readonly name: string;
    /** `ID:2115228`。 */
    readonly idText: string;
    /** `微信号：xxx`（全角冒号）。 */
    readonly wxText: string;
    /**
     * 联系微信号（**裸值，不带前缀**）。
     *
     * ⚠️ 与 `wxText` 并存不是冗余：`wxText` 是**上屏**用的（带「微信号：」前缀），
     *    而点微信号开编辑框时老端传的是 `cmd.wxChat`（**裸值**）——
     *    拿 `wxText` 去当输入框初值会把前缀一起编辑掉。
     */
    readonly wxChat: string;
    /** 联盟宣言（进 `DecBox/content`）。 */
    readonly declaration: string;
    /** 联盟公告（进 `NoticeBox/content`）。 */
    readonly notice: string;
    readonly icon: number;
    /** 「允许快速加入」勾选框的初值。 */
    readonly autoJoin: boolean;
}

/** 联盟管理要的前缀（`idPrefix` / `contactPrefix` 口径同 `ILeagueInfoTexts`）。 */
export type ILeagueMgrTexts = Pick<ILeagueInfoTexts, 'idPrefix' | 'contactPrefix'>;

/**
 * 联盟管理 —— 老端 `LayerLeagueHallMgrUI.updateView()`：
 * `league_name` / `league_id` / `league_wx` / `comp_dec.content` / `comp_notice.content` /
 * `league_banner`（按 `cmd.icon`）/ `按钮_勾选.selected = cmd.autoJoin`。
 *
 * ⚠️ 老端**没有**给 `league_lv` / `league_leader` 赋值 —— 这张面板上也没有这两个节点
 *    （只有联盟信息那张有），别顺手抄过来。
 *
 * `union` 为空（未入盟 / 还没推回来）⇒ 返回 `null`，页面据此走老端的 `unload()` 分支。
 */
export function buildLeagueMgrView(
    union: ILeagueUnionRow | null | undefined,
    texts: ILeagueMgrTexts,
): ILeagueMgrView | null {
    if (!union) return null;
    return {
        id: union.id,
        name: union.name,
        idText: `${texts.idPrefix}${union.id}`,
        wxText: `${texts.contactPrefix}${union.wxChat}`,
        wxChat: union.wxChat,
        declaration: union.declaration,
        notice: union.notice,
        icon: union.icon,
        autoJoin: union.autoJoin,
    };
}

/**
 * 「管理」面板该显示第几页 —— 老端 `com.setSelectedPage("管理", CanApprove() ? "是" : "否")`。
 *
 * FGUI `管理` controller 两页（`0,否` / `1,是`）是**互斥**的：
 *
 * | 页 | 可见节点 |
 * |---|---|
 * | `1`(`是`) | `btn_mgr`（申请管理）+ `btn_quit`（退出联盟，居左）+ `按钮_勾选` + `n23` |
 * | `0`(`否`) | 只有 `btn_quit1`（退出联盟，**居中**） |
 *
 * ⇒ 不能审批的人看不到「申请管理」，也看不到「允许快速加入」（老端口径）。
 * 返回 `1` / `0`，页面直接拿它去开关那 4 个节点。
 */
export function leagueMgrPage(canApprove: boolean): 0 | 1 {
    return canApprove ? 1 : 0;
}

// ============================================================
// 申请列表（`ui/League/LeagueApplyList`）
// ============================================================

/** 申请行的视图模型（行组件只负责「上屏」，文案全在这里拼好）。 */
export interface ILeagueApplyView {
    readonly applyId: string;
    readonly name: string;
    /** 等级（**纯数字**，FGUI `lab_lv` 不带「级」后缀 —— 与详情行同口径）。 */
    readonly levelText: string;
    /** 战力（**纯数字**，FGUI `lab_power` 不带「战力」后缀）。 */
    readonly powerText: string;
    /** 头像 id（上层拿它去解析头像图）。 */
    readonly img: string;
    readonly serverId: number;
    readonly selectServerId: number;
}

/**
 * 申请行 —— 老端 `LayerLeagueHallApproveUI.renderApply()` 逐字段对齐：
 *
 * | 节点 | 值 |
 * |---|---|
 * | `lab_name` | `cmd.name` |
 * | `lab_lv` | `cmd.level`（纯数字） |
 * | `lab_power` | `cmd.power` |
 * | `icon` | 头像（`ModelPlayer.GetPlayerIcon(cmd.img)`） |
 *
 * 排序：**保持缓存原序**（服务端给的申请顺序）。
 * 详情 / 全服两个列表在移植时加了「按职位 / 按贡献」的重排（见 `buildLeagueMemberViews`），
 * 但申请列表**不能**那么做 —— 审批是「先来先看」的语义，按名字或等级重排会让
 * 「最早申请的人」被挤到看不见的位置，与老端的处理顺序不一致。
 */
export function buildLeagueApplyViews(rows: readonly ILeagueApplyRow[]): ILeagueApplyView[] {
    return rows.map((row) => ({
        applyId: row.applyId,
        name: row.name,
        levelText: String(row.level),
        powerText: row.power,
        img: row.img,
        serverId: row.serverId,
        selectServerId: row.selectServerId,
    }));
}

/**
 * 「全部同意 / 全部拒绝」两个按钮是否可点 —— 老端两句守卫的合并：
 *
 * ```ts
 * async RequestLeagueApproveJoinOneKey() {
 *     if (!this.nowApplyArr || this.nowApplyArr.length == 0) return;   // ← 这里
 *     await this.ModelMgr.ModelLeague.RequestLeagueApproveJoinOneKey(true);
 * }
 * ```
 *
 * 空列表时**不发包**（老端如此）。所以两个按钮在列表为空时要么置灰、要么点了不响应 ——
 * 本端选「点了不响应 + 不发包」，与老端一致（老端这两颗按钮**没有**置灰逻辑）。
 */
export function canApproveAll(rows: readonly ILeagueApplyRow[] | readonly ILeagueApplyView[]): boolean {
    return rows.length > 0;
}

// ============================================================
// 全服页签：列表与搜索（老端 `ModelLeague.GetCmdUnionListBySearch` / `GetCanBeJoinList`）
// ============================================================

/**
 * 全服列表 —— 老端口径：
 *
 * ```ts
 * GetCmdUnionListBySearch(search) {
 *     if (searchCacheDict.has(search)) return [searchCacheDict.get(search)];  // 搜到过 ⇒ 只显示那一个
 *     return VOUnionBag.GetBagAsArray().map(vo => vo.GetCmd());                // 否则显示全部
 * }
 * ```
 *
 * ⚠️ 缓存键是**搜索输入的字符串本身**（不是解析后的 id）—— 输 `"123"` 搜到后，
 * 只要输入框里还是 `"123"` 就只显示那一个；一旦改动输入框（哪怕只加一个空格），
 * 就落回「全部」。老端就是这么写的，照搬（否则「搜完再改字，列表不回来」）。
 */
export function pickUnionListForSearch(
    rows: readonly ILeagueUnionRow[],
    cached: ILeagueUnionRow | null | undefined,
): ILeagueUnionRow[] {
    return cached ? [cached] : [...rows];
}

/** `GetCanBeJoinList` 的条数上限（老端写死 5）。 */
export const LEAGUE_QUICK_JOIN_LIMIT = 5;

/**
 * 搜索框输入的合法性 —— 老端 `StringUtil.isPositiveInteger` **逐字照搬**：
 *
 * ```ts
 * static isPositiveInteger(str: string): boolean { return /^[0-9]\d*$/.test(str); }
 * ```
 *
 * ⚠️ 名字叫 positive 但正则**允许 `"0"` 与 `"007"`**（`[0-9]` 与 `\d` 等价）。老端就是这样，
 *    移植保真优先 —— 别顺手改成 `[1-9]\d*`，否则「输 0 会被清空」这种老端没有的行为会冒出来。
 *    FGUI 那边还叠了一层 `restrict="[0-9]"`（输入阶段就滤掉非数字），这里只兜「粘贴」等旁路。
 */
export function isLeagueSearchId(text: string): boolean {
    return /^[0-9]\d*$/.test(text);
}


/**
 * 「可快速加入」的联盟 id —— 老端 `GetCanBeJoinList`：
 * `autoJoin && count < maxCount`，超过 `limit` 截断。
 */
export function pickQuickJoinUnionIds(
    rows: readonly ILeagueUnionRow[],
    limit = LEAGUE_QUICK_JOIN_LIMIT,
): string[] {
    const ids: string[] = [];
    for (const row of rows) {
        if (row.autoJoin && row.count < row.maxCount) ids.push(row.id);
        if (ids.length >= limit) break;
    }
    return ids;
}

/** 从成员列表里取「我」（按 `roleId` 比）。取不到返回 `null`。 */
export function findSelfMember(
    rows: readonly ILeagueMemberRow[],
    selfRoleId: string,
): ILeagueMemberRow | null {
    if (!selfRoleId) return null;
    for (const row of rows) {
        if (row.roleId === selfRoleId) return row;
    }
    return null;
}

/** 从联盟列表里取「我所在的联盟」（按 `id` 比）。取不到返回 `null`。 */
export function findMyUnion(
    rows: readonly ILeagueUnionRow[],
    unionId: string,
): ILeagueUnionRow | null {
    if (!unionId || unionId === '0') return null;
    for (const row of rows) {
        if (row.id === unionId) return row;
    }
    return null;
}


// ============================================================
// 加入联盟（`ui/League/LeagueJoin`）
// ============================================================

/**
 * 搜索框输入的非数字字符过滤 —— 老端 `TabLeagueJoin.onInputTextChange()`：
 *
 * ```ts
 * let text = this.com.tm("comp_search.lab_input").asTextInput.text;
 * if (!StringUtil.isPositiveInteger(text)) { …setText("") }
 * ```
 *
 * 也就是「只要不是纯数字串就**把输入框清空**」（不是拒绝这次按键）。
 * FGUI 那层还叠了 `restrict="[0-9]"` 在输入阶段就滤掉非数字，本端 `cc.EditBox`
 * 的 `inputMode = NUMERIC` 同理 —— 这条是兜「粘贴」等旁路。
 */
export function sanitizeLeagueSearchInput(text: string): string {
    return isLeagueSearchId(text ?? '') ? text : '';
}

/**
 * 「快速加入」要点名的联盟 id —— 老端 `TabLeagueJoin.onClickJoin()`
 * 调 `ModelLeague.GetCanBeJoinList(inputText)`，而那个方法**分两支**：
 *
 * ```ts
 * GetCanBeJoinList(search) {
 *     if (this.searchCacheDict.has(search)) return [this.searchCacheDict.get(search).id]; // ①
 *     // ② 否则全量里挑 autoJoin && count < maxCount，最多 5 条
 * }
 * ```
 *
 * ⚠️ ① 支**不查 `autoJoin`、也不查满没满** —— 搜索命中的那一个直接点名加入。
 *    漏掉这一支的症状：搜到一个没开「允许快速加入」的盟，点「快速加入」提示「没有可加入的联盟」，
 *    而老端是能进的。所以这里必须把 `cached` 一起传进来，不能只调 `pickQuickJoinUnionIds`。
 */
export function pickQuickJoinIdsFor(
    rows: readonly ILeagueUnionRow[],
    cached: ILeagueUnionRow | null | undefined,
    limit = LEAGUE_QUICK_JOIN_LIMIT,
): string[] {
    if (cached) return [cached.id];
    return pickQuickJoinUnionIds(rows, limit);
}

// ============================================================
// 创建联盟（`ui/League/LeagueCreate`）
// ============================================================

/**
 * 可选旗帜色的个数 —— 老端 `LayerLeagueCreat.arr = [0,1,2,3,4,5,6,7]`。
 *
 * 正好等于 `组件_联盟_旗帜` 的 `颜色` controller 页数（`LEAGUE_BANNER_COLOR_COUNT`，8 页）。
 */
export const LEAGUE_CREATE_BANNER_COUNT = 8;

/** `[0, 1, …, count-1]` —— 老端 `this.arr`（列表数据源就是「颜色下标」本身）。 */
export function leagueCreateBannerIndices(count = LEAGUE_CREATE_BANNER_COUNT): number[] {
    const total = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
    const out: number[] = [];
    for (let index = 0; index < total; index += 1) out.push(index);
    return out;
}

/**
 * 创建消耗的资源 id = `roleProperty.coin` = **10**（`RefEnum.ts` 的 `roleProperty.coin`）。
 *
 * `roleProperty.json` 的 `resId=10` 行：`{ key:"coin", name:"金币", icon:"图标_幻灵玉", isbig:1 }`。
 */
export const LEAGUE_CREATE_COST_RES_ID = 10;

/**
 * `roleProperty.coin` = **10**（`{ key:"coin", name:"金币", icon:"图标_幻灵玉" }`）。
 *
 * P4 的「每日砍价」三处用它，老端写的一律是 `roleProperty.coin`：
 * - 行内 `icon`（`LayerLeagueDiscount.initList` 的 `GetGoodsIconKeyByRefId(roleProperty.coin)`）；
 * - 面板 `itemIcon`（`updateView` 同上）；
 * - 砍价购买扣的货币（`onBuy` 里 `{ resId: roleProperty.coin, number: priceNow }`）。
 *
 * ⚠️ 与 `LEAGUE_CREATE_COST_RES_ID` **同值同物**（那个名字是创建页的历史命名）。
 *    故意保留两个名字：各自的注释才能写清「老端这一处写的是哪个枚举」，
 *    合并成一个「中立名」会让两处调用点都失去这份出处（本文件里同类别名不止这一对）。
 */
export const LEAGUE_COIN_RES_ID = 10;

/**
 * 捐献的两件奖励对应的 `roleProperty` 下标（老端 `roleProperty.unionCoin` / `roleProperty.unionContri`）。
 *
 * | 常量 | `resId` | `key` | `name` | `icon` |
 * |---|---|---|---|---|
 * | `LEAGUE_UNION_COIN_RES_ID` | 11 | `unionCoin` | **联盟银币** | `图标_联盟银币` |
 * | `LEAGUE_UNION_CONTRI_RES_ID` | 13 | `unionContri` | 联盟贡献 | `图标_联盟贡献` |
 *
 * ⚠️ **`resId=11` 的 `name` 是「联盟银币」，不是「联盟金币」** —— 捐献面板上那句
 *    「联盟金币*300」来自**语言表** `ALLIANCE_GOLD_COIN`（`mL.json` id=382），
 *    跟这张表的 `name` **不是同一个来源**。落了 prefab 的静态文案/文案常量要用语言表那份，
 *    这两条常量只用来**取图标**。别拿 `name` 去上屏。
 */
export const LEAGUE_UNION_COIN_RES_ID = 11;

/** 见 `LEAGUE_UNION_COIN_RES_ID` 的说明（`roleProperty.unionContri` = 联盟贡献）。 */
export const LEAGUE_UNION_CONTRI_RES_ID = 13;

/** `roleProperty` 分表名（`assets/remoteRef/roleProperty.json`，货币 / 属性类资源的图标与字段名）。 */
export const LEAGUE_PROPERTY_TABLE = 'roleProperty';

/** 道具表（`item`，奖励图标「直通 `resources/` 路径」的那一支）。 */
export const LEAGUE_ITEM_TABLE = 'item';

/** `gameConfig` 分表名（`{key, value}` 两列的泛型配置，创建消耗数量在里面）。 */
export const LEAGUE_GAME_CONFIG_TABLE = 'gameConfig';

/** 创建消耗**数量**所在的配置键 —— 老端 `RefMgrgameConfig.getRef("key","unionCreateCost").value`。 */
export const LEAGUE_CREATE_COST_CONFIG_KEY = 'unionCreateCost';

/** 配置读不到时的兜底数量（`assets/remoteRef/gameConfig.json` 现网值 = **100**）。 */
export const LEAGUE_CREATE_COST_FALLBACK = 100;

/**
 * 从 `gameConfig` 的行集里取创建消耗数量。
 *
 * `gameConfig` 是一张 `{key, value}` 两列的泛型配置表（本工程已有先例：
 * `LayerActivityRepository` 也读它）⇒ 按 `key` 找 `value`，取不到用兜底值。
 */
export function leagueCreateCost(
    rows: readonly unknown[] | null | undefined,
    key: string = LEAGUE_CREATE_COST_CONFIG_KEY,
    fallback: number = LEAGUE_CREATE_COST_FALLBACK,
): number {
    if (!Array.isArray(rows)) return fallback;
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        if (toText(row.key) !== key) continue;
        const value = toInt(row.value);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return fallback;
}

/**
 * `roleProperty` 表的行（**只取消耗展示要用的那几列**）。
 *
 * ⚠️ `icon` 在本表里存的是 **FGUI 组件名**（`图标_幻灵玉`），不是相对 `resources` 的路径
 *    ⇒ 取图要落 `icons/resource/<icon>`（同 `LayerActivityTable` 的 `iconIsPath = false` 口径）。
 * ⚠️ `key` 同时是 **`CmdRole` 上的字段名**（老端 `ModelGoods.GetGoodsNumberByRefId`
 *    对 `playerAtt` 类就是 `voRole.GetRolePropertyNum(ref.key)`）⇒ 持有量按它取。
 */
export interface ILeaguePropertyRow {
    readonly resId: number;
    readonly key: string;
    readonly name: string;
    readonly icon: string;
    /** FGUI `isbig`（1 = 大数，老端走 `BigNum.shortNum` 缩短显示）。 */
    readonly isBig: boolean;
    readonly unenoughTips: string;
}

/** 归一化 `roleProperty` 全表（脏行丢弃）。 */
export function parseLeaguePropertyRows(raw: readonly unknown[] | null | undefined): ILeaguePropertyRow[] {
    const out: ILeaguePropertyRow[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const resId = toInt(row.resId);
        if (!Number.isFinite(resId) || resId <= 0) continue;
        out.push({
            resId,
            key: toText(row.key),
            name: toText(row.name),
            icon: toText(row.icon),
            isBig: toInt(row.isbig) === 1,
            unenoughTips: toText(row.unenoughTips),
        });
    }
    return out;
}

/** 按 `resId` 找一行 `roleProperty`；找不到返回 `null`。 */
export function findLeagueProperty(
    rows: readonly ILeaguePropertyRow[],
    resId: number,
): ILeaguePropertyRow | null {
    for (const row of rows) {
        if (row.resId === resId) return row;
    }
    return null;
}

/**
 * 从一行 `CmdRole` 里按 `roleProperty.key` 取**持有量**。
 *
 * 老端 `ModelGoods.GetGoodsNumberByRefId` 的 `playerAtt` 支：`voRole.GetRolePropertyNum(ref.key)`。
 * `CmdRole.coin` / `gold` 是**十进制字符串**（可能超 2^53）、`end` / `unionCoin` 等是 number ⇒ 两种都收。
 *
 * ⚠️ 返回 `{ text, value }`：`text` 保留原始串（大数显示不失真），`value` 是给「够不够」比大小用的
 *    近似数值。老端对 `isbig` 的数额走 `BigNum.shortNum`，本端没有 big-number 库 ⇒ 直接显示原始数字
 *    （**有意简化**，见 `ILeagueCostView` 的说明）。
 */
export function rolePropertyAmount(row: unknown, key: string): { text: string; value: number } {
    if (!row || typeof row !== 'object' || !key) return { text: '0', value: 0 };
    const raw = (row as Record<string, unknown>)[key];
    const text = toText(raw, '0');
    const value = Number(text);
    return { text: text === '' ? '0' : text, value: Number.isFinite(value) ? value : 0 };
}

/** 消耗项的展示模型（`组件_公用_消耗_单个` 一个实例要的全部信息）。 */
export interface ILeagueCostView {
    readonly resId: number;
    /** 需要多少。 */
    readonly need: number;
    /** 够不够（驱动 `足够` controller：够 = 黑字 / 不够 = 红字）。 */
    readonly enough: boolean;
    /** `lab_has` 的文本（含尾巴 `/`）。 */
    readonly hasText: string;
    /** `lab_need` 的文本。 */
    readonly needText: string;
    /** 图标资源目录（`icons/resource`）。 */
    readonly iconRoot: string;
    /** 图标资源名（`图标_幻灵玉`）。解析不出时为 `''`（调用方降级成不画图）。 */
    readonly iconName: string;
    /** 不足时的提示（`roleProperty.unenoughTips`，如「金币不足」）。 */
    readonly unenoughTips: string;
    /**
     * 资源名（`roleProperty.name`，如「金币」）—— 表里没写 `unenoughTips` 时，
     * 页面用 `LEAGUE_COST_NOT_ENOUGH_TEMPLATE`（`{0}不足`）自己拼一条。
     */
    readonly name: string;
}

/**
 * 组装创建消耗的展示模型 —— 老端 `ViewConsumeItemOne.updateByConsume()`：
 *
 * ```ts
 * let hasNum = ModelGoods.GetGoodsNumberByRefId(resId);
 * t.com.setSelectedPage("足够", hasNum >= needNum ? "是" : "否");
 * t.com.tm("lab_has").setText(hasNumStr + "/");
 * t.com.tm("lab_need").setText(needNumStr);
 * return hasNum >= needNum;
 * ```
 *
 * ⚠️ **有意简化**：老端对 `isbig` 的资源（金币就是）会走 `BigNum.shortNum` 把 100000 缩成 `10K`
 *    那种写法；本工程没有 big-number 库 ⇒ 这里显示**原始数字**。
 *    金币 100 这种量级两端口径一致；只有持有量上万时字面会变长（数值本身不失真）。
 */
export function buildLeagueCostView(
    property: ILeaguePropertyRow | null | undefined,
    has: { text: string; value: number },
    need: number,
    iconRoot = 'icons/resource',
): ILeagueCostView {
    const needValue = Number.isFinite(need) && need > 0 ? Math.trunc(need) : 0;
    const hasValue = Number.isFinite(has?.value) ? has.value : 0;
    const hasText = has?.text ?? '0';
    return {
        resId: property?.resId ?? 0,
        need: needValue,
        enough: hasValue >= needValue,
        hasText: `${hasText}/`,
        needText: String(needValue),
        iconRoot,
        iconName: property?.icon ?? '',
        unenoughTips: property?.unenoughTips ?? '',
        name: property?.name ?? '',
    };
}

/**
 * 联盟名能不能拿去建盟 —— 老端 `LayerLeagueCreat.onClickCreat()` 的守卫：
 *
 * ```ts
 * let labName = input.text;
 * if (!labName || labName == "***") return;
 * ```
 *
 * ⚠️ 老端**不 trim**（`" "` 能过）—— 保真照搬，别顺手加 `.trim()`，
 *    否则「空格名被拒」这种老端没有的行为会冒出来。
 */
export function isLeagueNameUsable(name: string): boolean {
    return !!name && name !== LEAGUE_EDIT_REJECTED_PLACEHOLDER;
}

/**
 * 创建成功后要落地的旗帜色（越界就地夹到 `[0, 7]`）。
 *
 * 老端 `LayerLeagueCreat.onClickCreat()`：`let selectIndex = this.arr[this.selectIndex]`
 * ⇒ 传出去的其实就是**颜色下标本身**（`arr` 是 `[0..7]`）。这里保留夹取，防止越界页码发脏包。
 */
export function leagueCreateBannerIndexOf(selectedIndex: number): number {
    const index = Number.isFinite(selectedIndex) ? Math.trunc(selectedIndex) : 0;
    return Math.min(Math.max(index, 0), LEAGUE_CREATE_BANNER_COUNT - 1);
}

// ============================================================
// P4 公用：奖励条目 + `gameConfig` 的 P4 键
// ============================================================

/** 一条奖励（`unionShop.rewards[]` / `unionDiscount.rewards[]` 的单元）。 */
export interface ILeagueReward {
    readonly resId: number;
    readonly number: number;
}

/**
 * 解析一条奖励数组。丢弃 `resId` 或 `number` 解析不出整数的脏项。
 *
 * ⚠️ 老端是 `rewards[0]` / `rewards[1]` **按下标硬取**（`LayerLeagueDiscount.updateView`）。
 *    本端保留数组形态，取用点自己按下标取 —— 表里少一项时出来是 `undefined`，
 *    与老端「下标越界拿到 undefined」同一后果（调用点必须判）。
 */
export function parseLeagueRewards(raw: unknown): ILeagueReward[] {
    if (!Array.isArray(raw)) return [];
    const out: ILeagueReward[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const box = item as { resId?: unknown; number?: unknown };
        const resId = toInt(box.resId);
        const number = toInt(box.number);
        if (!Number.isFinite(resId)) continue;
        out.push({ resId, number: Number.isFinite(number) ? number : 0 });
    }
    return out;
}

/**
 * P4 用到的 6 个 `gameConfig` 键。
 *
 * `gameConfig.json` 是 `[{key, value}]`（与好友模块同一张表、同一套读法）。
 *
 * | 字段 | `gameConfig.key` | 老端读点 |
 * |---|---|---|
 * | `donateCost` | `unionDonateCost` | `LayerLeagueDonate.onClickDonate` |
 * | `donateGainCoin` | `unionDonateGainCoin` | `LayerLeagueDonate.updateView` |
 * | `donateGainExp` | `unionDonateGainExp` | 同上 |
 * | `donateMaxCount` | `unionDonateMaxCount` | 同上（`todayDonateTimes` 的上限） |
 * | `donateAdvCount` | `unionDonateAdvCount` | 同上（广告捐献的上限） |
 * | `bargainBuyCount` | `unionBargainBuyCount` | `LayerLeagueDiscount.canBuy` / `canBeSale` |
 */
export interface ILeagueP4Config {
    readonly donateCost: number;
    readonly donateGainCoin: number;
    readonly donateGainExp: number;
    readonly donateMaxCount: number;
    readonly donateAdvCount: number;
    readonly bargainBuyCount: number;
}

/** 字段 → `gameConfig.key`。 */
export const LEAGUE_P4_CONFIG_KEYS: Readonly<Record<keyof ILeagueP4Config, string>> = {
    donateCost: 'unionDonateCost',
    donateGainCoin: 'unionDonateGainCoin',
    donateGainExp: 'unionDonateGainExp',
    donateMaxCount: 'unionDonateMaxCount',
    donateAdvCount: 'unionDonateAdvCount',
    bargainBuyCount: 'unionBargainBuyCount',
};

/** 读不到表 / 缺项时的兜底：**全 0**（与老端 `… .value || 0` 同口径）。 */
export const LEAGUE_P4_CONFIG_DEFAULTS: ILeagueP4Config = {
    donateCost: 0,
    donateGainCoin: 0,
    donateGainExp: 0,
    donateMaxCount: 0,
    donateAdvCount: 0,
    bargainBuyCount: 0,
};

/** `gameConfig` 行（`[{key, value}]`）→ P4 配置。缺项取 `LEAGUE_P4_CONFIG_DEFAULTS`。 */
export function parseLeagueP4Config(rows: readonly unknown[]): ILeagueP4Config {
    const found = new Map<string, unknown>();
    if (Array.isArray(rows)) {
        for (const raw of rows) {
            if (!raw || typeof raw !== 'object') continue;
            const row = raw as { key?: unknown; value?: unknown };
            if (typeof row.key === 'string') found.set(row.key, row.value);
        }
    }
    const pick = (field: keyof ILeagueP4Config): number => {
        const value = found.get(LEAGUE_P4_CONFIG_KEYS[field]);
        const n = toInt(value);
        return Number.isFinite(n) ? n : LEAGUE_P4_CONFIG_DEFAULTS[field];
    };
    return {
        donateCost: pick('donateCost'),
        donateGainCoin: pick('donateGainCoin'),
        donateGainExp: pick('donateGainExp'),
        donateMaxCount: pick('donateMaxCount'),
        donateAdvCount: pick('donateAdvCount'),
        bargainBuyCount: pick('bargainBuyCount'),
    };
}

// ============================================================
// 联盟商店（`ui/League/LeagueStore`，配置表 `remoteRef/unionShop.json`）
// ============================================================

/** 表名（老端 `Ref.RefMgrunionShop`）。 */
export const LEAGUE_UNION_SHOP_TABLE = 'unionShop';

/**
 * `unionShop.json` 的一行（列名见表的 `k`：`id,desc,rewards,priceType,cost,limitType,limitDesc,freeTimes,adTimes,limit`）。
 *
 * ⚠️ 字段名与老端 `IRefunionShop` 逐一对齐 —— **别去掉 `limitType` / `freeTimes` / `adTimes`**：
 *    现网 9 行里 `limitType` 有 1 / 2 两档（每日 / 每周），`freeTimes` / `adTimes` 全 0，
 *    看着像没用的列，实际是「限购类型」的语义来源。
 */
export interface ILeagueUnionShopRow {
    readonly id: number;
    /** 商品名（如「攻城令牌」）。 */
    readonly desc: string;
    /** 奖励列表（老端只取 `rewards[0]`）。 */
    readonly rewards: ILeagueReward[];
    /**
     * 货币的 `roleProperty` 下标 —— **现网 9 行只用两档**：
     * `11`（`unionCoin` 联盟银币，1~7 行）与 `12`（`unionGold` 联盟金币，8~9 行，钥匙类）。
     *
     * ⚠️ 与捐献的「扣金币（`coin`=10）」**不是同一套**：商店扣的是联盟内部货币。
     *    取值一律按 `roleProperty` 表的 `resId` 直接查（图标 / 名字 / 持有量都靠它）。
     */
    readonly priceType: number;
    /** 单价。 */
    readonly cost: number;
    /** 限购周期类型（1 = 日 / 2 = 周）。 */
    readonly limitType: number;
    /** 限购文案前缀（如「每日限购」「每周限购」）。 */
    readonly limitDesc: string;
    readonly freeTimes: number;
    readonly adTimes: number;
    /** 单周期限购次数。 */
    readonly limit: number;
}

/** 解析 `unionShop`。丢弃 `id` 解析不出整数的脏行（按 `id` 升序返回）。 */
export function parseUnionShopRows(raw: unknown): ILeagueUnionShopRow[] {
    const out: ILeagueUnionShopRow[] = [];
    for (const row of toRefRows(raw)) {
        const id = toInt(row.id);
        if (!Number.isFinite(id)) continue;
        out.push({
            id,
            desc: toText(row.desc),
            rewards: parseLeagueRewards(row.rewards),
            priceType: intOr(row.priceType, 0),
            cost: intOr(row.cost, 0),
            limitType: intOr(row.limitType, 0),
            limitDesc: toText(row.limitDesc),
            freeTimes: intOr(row.freeTimes, 0),
            adTimes: intOr(row.adTimes, 0),
            limit: intOr(row.limit, 0),
        });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
}

/** 商店一行的视图模型（文案全拼好，行组件只负责上屏）。 */
export interface ILeagueStoreRowView {
    readonly id: number;
    /** 商品名（进 `labName`）。 */
    readonly desc: string;
    /** `每日限购:0/10`（进 `labCount`，见 `LEAGUE_STORE_LIMIT_TEMPLATE`）。 */
    readonly limitText: string;
    /** 单价（按钮上的 `title`）。 */
    readonly cost: number;
    /** 货币 `roleProperty` 下标（按钮 `priceIcon` 按它换帧）。 */
    readonly priceType: number;
    /** 奖励（`com_goods` 的图标按 `resId` 换帧）。 */
    readonly rewardResId: number;
    readonly rewardNumber: number;
    /** 已购次数。 */
    readonly buyTimes: number;
    /** 限购用尽。 */
    readonly soldOut: boolean;
    /** 货币够。 */
    readonly enough: boolean;
    /** 能不能点（= 没售罄 **且** 够钱）—— 老端 `btn_buy.grayed = !canbuy`。 */
    readonly canBuy: boolean;
}

/** 商店行视图的入参（都是**回调**，让本函数保持纯 —— 表 / 缓存的读取在 Repository）。 */
export interface ILeagueStoreRowDeps {
    /** 某商品已购次数（`CmdShopGoods.buyTimes`）。 */
    buyTimesOf(id: number): number;
    /** 某货币 `roleProperty` 下标 → 持有量。 */
    ownedOf(resId: number): number;
}

/**
 * 组装商店行视图 —— 老端 `LayerLeagueStore.initList()` 的 `render()` 逐句对齐：
 *
 * ```ts
 * let buyTimes = shopGoods && shopGoods.buyTimes || 0
 * item.tm("labName").setText(ref.desc);
 * item.tm("labCount").setText(`${ref.limitDesc}:${ref.limit - buyTimes}/${ref.limit}`);
 * btn_buy.tm("title").setText(ref.cost)
 * let enough = ModelGoods.CheckHaveEnoughCostAndOpenAlert([cost], false);
 * let canbuy = buyTimes < ref.limit && enough
 * btn_buy.grayed = !canbuy;
 * ```
 *
 * ⚠️ 限购进度按老端口径是 **`limit - buyTimes`**（剩余 / 上限），不是「已购 / 上限」。
 * ⚠️ `buyTimes` 会被**钳到 `limit`**（服务端超卖过时 `limit - buyTimes` 会变负，负号上屏很怪）。
 * ⚠️ 剩余量再 `max(0, …)` 兜一层：`limit` 没配（= 0）时老端会打出 `不限购:-5/0` 这种负号串
 *    （现网 9 行 `limit` 都 ≥ 2，走不到），本端把它压成 `0` —— 这是本函数**唯一的**偏离，
 *    其余（`limit − buyTimes` 的方向、`limit=0` 不判售罄）都照老端。
 */
export function buildLeagueStoreRowViews(
    rows: readonly ILeagueUnionShopRow[],
    deps: ILeagueStoreRowDeps,
    limitTemplate = LEAGUE_STORE_LIMIT_TEMPLATE,
): ILeagueStoreRowView[] {
    return rows.map((row) => {
        const rawTimes = deps.buyTimesOf(row.id);
        const buyTimes = Number.isFinite(rawTimes) && rawTimes > 0 ? Math.trunc(rawTimes) : 0;
        const limit = row.limit > 0 ? row.limit : 0;
        const clamped = limit > 0 ? Math.min(buyTimes, limit) : buyTimes;
        const remain = Math.max(0, limit - clamped);
        const reward = row.rewards[0];
        const owned = deps.ownedOf(row.priceType);
        const enough = Number.isFinite(owned) ? owned >= row.cost : false;
        const soldOut = limit > 0 && buyTimes >= limit;
        return {
            id: row.id,
            desc: row.desc,
            limitText: fillText(limitTemplate, row.limitDesc, remain, limit),
            cost: row.cost,
            priceType: row.priceType,
            rewardResId: reward?.resId ?? 0,
            rewardNumber: reward?.number ?? 0,
            buyTimes,
            soldOut,
            enough,
            canBuy: !soldOut && enough,
        };
    });
}

/**
 * 商店红点 —— 老端 `ModelLeague.hasStoreRD()`：
 *
 * ```ts
 * for (let ref of RefMgrunionShop.getRefAll()) {
 *     let enough = CheckHaveEnoughCostAndOpenAlert([{resId: ref.priceType, number: ref.cost}], false)
 *     if (enough) { let buyTimes = …; if (buyTimes < ref.limit) return true }
 * }
 * ```
 *
 * ⇒ **任意一件「买得起且没买满」就亮**。
 */
export function hasLeagueStoreRedDot(views: readonly ILeagueStoreRowView[]): boolean {
    return views.some((view) => view.canBuy);
}

/**
 * 从 `CmdShopGoods` 行里取某个商品的已购次数。
 *
 * ⚠️ `CmdShop` 是**按 `cmdShopType` 归档**的（`CmdShop_Key { cmdShopType }`），
 *    本函数只认它自己的 `tlCmdShopGoods[].id` —— 调用方负责先取对 `cmdShopType`。
 */
export function leagueShopBuyTimesOf(rows: readonly unknown[] | null | undefined, id: number): number {
    if (!Array.isArray(rows)) return 0;
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as { id?: unknown; buyTimes?: unknown };
        if (toInt(row.id) === id) {
            const times = toInt(row.buyTimes);
            return Number.isFinite(times) && times > 0 ? times : 0;
        }
    }
    return 0;
}

// ============================================================
// 每日砍价（`ui/League/LeagueDiscount`，配置表 `remoteRef/unionDiscount.json`）
// ============================================================

/** 表名（老端 `Ref.RefMgrunionDiscount`）。 */
export const LEAGUE_UNION_DISCOUNT_TABLE = 'unionDiscount';

/** `unionDiscount.json` 的一行（列：`id,rewards,priceType,cost,minPrice`）。 */
export interface ILeagueUnionDiscountRow {
    readonly id: number;
    readonly rewards: ILeagueReward[];
    readonly priceType: number;
    /** 原价。 */
    readonly cost: number;
    /** 砍价下限（`priceNow = max(cost − 已砍总额, minPrice)`）。 */
    readonly minPrice: number;
}

/** 解析 `unionDiscount`（按 `id` 升序）。 */
export function parseUnionDiscountRows(raw: unknown): ILeagueUnionDiscountRow[] {
    const out: ILeagueUnionDiscountRow[] = [];
    for (const row of toRefRows(raw)) {
        const id = toInt(row.id);
        if (!Number.isFinite(id)) continue;
        out.push({
            id,
            rewards: parseLeagueRewards(row.rewards),
            priceType: intOr(row.priceType, 0),
            cost: intOr(row.cost, 0),
            minPrice: intOr(row.minPrice, 0),
        });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
}

/** 砍价列表的一行（`组件_联盟_砍价Item`：`lab_who` / `lab_price`）。 */
export interface ILeagueDiscountRowView {
    readonly roleId: string;
    /** 成员名（查不到时落空串）。 */
    readonly name: string;
    /** 该成员砍掉的额度。 */
    readonly value: number;
}

/**
 * 砍价参与列表 —— 老端 `LayerLeagueDiscount.updateView()`：
 *
 * ```ts
 * for (let item of cmd.tlCmdUnionActInfo) {
 *     let member = VOUnionMemberBag.GetMemberByRoleId(item.roleId);
 *     if (member) listCmds.push(item);        // ← 查不到成员的**整条丢掉**
 * }
 * list.update(listCmds);
 * lab_user_count.setText(UNION_ACTIVE_COUNT.replace("{0}", listCmds.length));  // ← 用过滤后的条数
 * ```
 *
 * ⚠️ `{0}` 填的是**过滤后**的条数（不是原始条数）；成员表还没推下来时会显示 0 人。
 */
export function buildLeagueDiscountRows(
    actInfo: readonly unknown[] | null | undefined,
    nameOf: (roleId: string) => string | null | undefined,
): ILeagueDiscountRowView[] {
    const out: ILeagueDiscountRowView[] = [];
    if (!Array.isArray(actInfo)) return out;
    for (const raw of actInfo) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as { roleId?: unknown; value?: unknown };
        const roleId = toText(row.roleId);
        if (!roleId || roleId === '0') continue;
        const name = nameOf(roleId);
        if (name === null || name === undefined) continue;
        out.push({ roleId, name, value: intOr(row.value, 0) });
    }
    return out;
}

/** 砍价面板的视图模型。 */
export interface ILeagueDiscountView {
    readonly id: number;
    /** 原价（`lab_price`，带删除线）。 */
    readonly price: number;
    /** 现价（`lab_price_now`）。 */
    readonly priceNow: number;
    /** 已砍总额（= 各行 `value` 之和）。 */
    readonly saleNum: number;
    readonly priceType: number;
    /** 两件奖励（老端取 `rewards[0]` / `rewards[1]`）。 */
    readonly rewardA: ILeagueReward | null;
    readonly rewardB: ILeagueReward | null;
    /**
     * 本轮重置时刻（**秒**）—— 协议 `CmdUnionActivity.resetTime` 是**毫秒**
     * （服务端写的是 `CommonUtils.getTodayZeroTimestamp()` = `toEpochMilli()`），
     * Repository 读缓存时已 `/1000` 折成秒（`LeagueRepository.toSecFromMs`）。`0` = 没有。
     */
    readonly resetTimeSec: number;
    /** `状态` controller 的页下标：0 砍价 / 1 购买 / 2 已购买。 */
    readonly pageIndex: number;
}

/**
 * 组装砍价视图 —— 老端 `LayerLeagueDiscount.updateView()`：
 *
 * ```ts
 * saleNum = Σ cmd.tlCmdUnionActInfo[].value
 * this.price    = ref.cost
 * this.priceNow = Math.max(this.price - saleNum, ref.minPrice)
 * com.setSelectedPage("状态", canBeSale() ? "砍价" : (canBuy() ? "购买" : "已购买"))
 * ```
 *
 * ⚠️ 老端 `updateView` 里那个 `saleNum` **只统计了全部 `tlCmdUnionActInfo`**（不过滤成员），
 *    而列表只展示过滤后的行 —— 两者刻意不同，别"统一"。
 */
export function buildLeagueDiscountView(
    row: ILeagueUnionDiscountRow | null | undefined,
    actInfo: readonly unknown[] | null | undefined,
    resetTimeSec: number,
    canBargain: boolean,
    canBuy: boolean,
    pages: readonly string[] = LEAGUE_DISCOUNT_PAGES,
): ILeagueDiscountView | null {
    if (!row) return null;
    let saleNum = 0;
    if (Array.isArray(actInfo)) {
        for (const raw of actInfo) {
            if (!raw || typeof raw !== 'object') continue;
            saleNum += intOr((raw as { value?: unknown }).value, 0);
        }
    }
    const priceNow = Math.max(row.cost - saleNum, row.minPrice);
    return {
        id: row.id,
        price: row.cost,
        priceNow,
        saleNum,
        priceType: row.priceType,
        rewardA: row.rewards[0] ?? null,
        rewardB: row.rewards[1] ?? null,
        resetTimeSec: Number.isFinite(resetTimeSec) ? Math.trunc(resetTimeSec) : 0,
        pageIndex: leagueDiscountPageIndex(canBargain, canBuy, pages),
    };
}

/**
 * `状态` controller 的页下标 —— 老端 `canBeSale() ? "砍价" : (canBuy() ? "购买" : "已购买")`。
 *
 * 页序来自 FGUI `<controller name="状态" pages="0,砍价,1,购买,2,已购买">`。
 * 传 `pages` 是为了让单测能钉住「页名 → 下标」这一步（页名改了要立刻红）。
 */
export function leagueDiscountPageIndex(
    canBargain: boolean,
    canBuy: boolean,
    pages: readonly string[] = LEAGUE_DISCOUNT_PAGES,
): number {
    const want = canBargain ? pages[0] : canBuy ? pages[1] : pages[2];
    const index = pages.indexOf(want);
    return index >= 0 ? index : 0;
}

/**
 * 秒 → `HH:MM:SS`（`day > 0` 时前缀 `N天`）—— 老端 `TimeUtil.timeSec2HMSStr2` 逐句复刻。
 *
 * ⚠️ 是 `Math.floor` 取整（老端 `timeSec2HMS` 内部就是 floor），**不是** `ceil` ——
 *    与挂机的 `timeMillisecond2HMSStr`（那个是 ceil）**不是同一个函数**，别互相抄。
 * ⚠️ `lerp <= 0` 时调用点要显示 `00:00:00`（老端 `updateTime` 的显式分支），本函数对 0
 *    也会输出 `00:00:00`，但**负数**会输出 `00:00:00`（钳零），别指望它报错。
 */
export function formatLeagueCountdown(seconds: number): string {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const day = Math.floor(total / 86400);
    const hour = Math.floor((total % 86400) / 3600);
    const minute = Math.floor((total % 3600) / 60);
    const second = total % 60;
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
    const hms = `${pad(hour)}:${pad(minute)}:${pad(second)}`;
    return day > 0 ? `${day}天${hms}` : hms;
}

/** 砍价能不能砍：老端 `canBeSale()` = `todayBargainTimes < unionBargainBuyCount`。 */
export function canLeagueBargain(todayBargainTimes: number, bargainBuyCount: number): boolean {
    return toCount(todayBargainTimes) < toCount(bargainBuyCount);
}

/** 砍价能不能买：老端 `canBuy()` = `todayBuyBargainTimes < unionBargainBuyCount`。 */
export function canLeagueBuyBargain(todayBuyBargainTimes: number, bargainBuyCount: number): boolean {
    return toCount(todayBuyBargainTimes) < toCount(bargainBuyCount);
}

/**
 * 「每日砍价」**入口**上的红点 —— 老端 `ModelLeague.hasDiscountRD()`：
 *
 * ```ts
 * hasDiscountRD(): boolean {
 *     return roleUnion.GetCmd().todayBargainTimes
 *         < this.Ref.RefMgrgameConfig.getRef("key", "unionBargainBuyCount").value;
 * }
 * ```
 *
 * ⚠️ 与面板内 `btn_sale.组件_红点` 用的是**同一个表达式**（`canLeagueBargain`）——
 *    老端两处各写了一遍，这里收成一处：本函数就是 `canLeagueBargain` 的语义别名，
 *    有了新名字之后调用点能看出「这是入口红点，不是按钮可用态」。
 *
 * 另外三条入口红点**恒关**（各自原因写在 `LeaguePage` / `LEAGUE_ENTRANCE_RED_DOT_SOURCE`）：
 *   - 捐献 `hasDonateRD()` = `ModelRole.GetAdvertRestTimes(AdType.unionDonate) > 0` —— 依赖**未迁移**的广告子系统；
 *   - 商店 `hasStoreRD()` —— 老端 `TabLeagueMain.updateRD()` 里那两行**是注释掉的**（`RDLeague` 里也注释掉了）；
 *   - 大厅 —— 老端 `TabLeagueMain.updateRD()` 里**没有** `btn_hall`。
 *
 * ⚠️「任务」（P5 `hasLeagueTaskRedDot()`）与「联合战线」（P6 `hasLeagueNorthRedDot()`）
 *    的红点**都已真做**，**不在**上面这三条恒关之列。
 */
export function hasLeagueDiscountRedDot(todayBargainTimes: number, bargainBuyCount: number): boolean {
    return canLeagueBargain(todayBargainTimes, bargainBuyCount);
}

/**
 * 砍价这一轮的**重置周期**（秒）—— 老端 `LayerLeagueDiscount.updateView()`：
 *
 * ```ts
 * this.resetTime = cmd.resetTime + this.TimeUtil.S_DayTime * 1000;   // S_DayTime = 86400
 * ```
 *
 * ⇒ 协议里的 `CmdUnionActivity.resetTime` 是**本轮开始时刻**（`todayZeroTimestamp`，**毫秒**），
 *    真正的截止时刻 = `resetTime + 1 天`。倒计时按截止时刻算（`updateTime` 里 `resetTime - now`）。
 *
 * ⚠️ 老端那行是 **ms + ms**（`S_DayTime * 1000`）；本端 `resetTimeSec` 已经是**秒**
 *    （Repository 里 `/1000` 折过）⇒ 页面用**本常量**（86400 秒）而不是 `S_DayTime * 1000`。
 *    两边算出来是同一个截止时刻，别把 `* 1000` 也照抄过来（会变成 24 万小时）。
 *
 * ⚠️ 别把它折进 `buildLeagueDiscountView`：那个纯函数只忠实搬运协议字段，
 *    加一天是**展示口径**，由页面决定（`LeagueDiscountPage` 的 `deadlineSec`）。
 */
export const LEAGUE_DISCOUNT_RESET_DAY_SECONDS = 86400;

// ============================================================
// 联盟任务（`ui/League/LeagueTask`，表 `remoteRef/taskUnion.json` + `taskUnionProgress.json`）
// ============================================================
//
// 老端真源：`play/LayerLeagueTask.ts` + `model/league/ModelLeague.hasTaskRD/hasTaskHeadRewardRD`
//          + `model/vo/Other/VOLeagueTask.ts`（任务 VO：`GetValue/GetMaxValue/IsUnDone/CanBeReward/Rewarded`）。
//
// ⚠️ **任务列表没有独立请求**（分期方案 §2 的「唯一待核项」已核）：
//    老端 `VOLeagueTaskBag.GetCacheName()` 返回 `"CmdTask"` ⇒ 联盟任务就是**通用任务缓存**
//    按 `taskUnion` 表的 `resId` 反查（`GetVOByTaskId` 是**线性遍历** `CmdTask` 缓存）。
//    所以本端 `loadLeagueTask()` 只读 `getTlCmdTask()`，**不发任何包**。

/** 表名（老端 `Ref.RefMgrtaskUnion` / `Ref.RefMgrtaskUnionProgress`）。 */
export const LEAGUE_TASK_UNION_TABLE = 'taskUnion';
export const LEAGUE_TASK_PROGRESS_TABLE = 'taskUnionProgress';

/**
 * `EnumUnionTaskType`（老端 `model/vo/Other/VOLeague.ts`）。
 *
 * ⚠️ 三档都要（不是只留 `LeagueTask`）：`taskUnion` 表里 `subType` 是**多档混排**的，
 *    过滤时漏掉任何一个都会把别的模块的任务错当联盟任务铺进列表。
 */
export const LeagueUnionTaskType = {
    /** 联盟任务（本面板唯一要的）。 */
    leagueTask: 1,
    /** 联盟伤害。 */
    leagueDamage: 2,
    /** 联盟个人伤害。 */
    leagueRoleDamage: 3,
} as const;

/**
 * `taskUnion.json` 的一行（列名见表的 `k`：`resId,subType,targetType,param,reward,name,goto`）。
 *
 * | 字段 | 用途 |
 * |---|---|
 * | `resId` | 任务 id —— 与 `CmdTask.resId` 配对（`GetVOByTaskId`） |
 * | `subType` | `EnumUnionTaskType`，本面板只取 `1` |
 * | `param.count` | 目标次数（`VOLeagueTask.GetMaxValue()`） |
 * | `reward` | 奖励列表（`组件_联盟_任务item` 的两个 `com_goods` 槽） |
 * | `name` | 标题模板，含 `{count}` 占位（如「合成{count}次宝石」） |
 * | `goto` | 「前往」跳转目标（老端 `CtrlJumpView.JumpType(ref.goto)`） |
 */
export interface ILeagueTaskUnionRow {
    readonly resId: number;
    readonly subType: number;
    readonly targetType: number;
    /** `param.count` —— 目标次数。 */
    readonly targetCount: number;
    readonly reward: ILeagueReward[];
    readonly name: string;
    readonly goto: number;
}

/**
 * `taskUnionProgress.json` 的一行（`id,count,rewards`）—— **进度宝箱**（不是任务）。
 *
 * 现网 3 行：`1→3` / `2→5` / `3→8`（「完成 3 / 5 / 8 个任务各领一次」）。
 * `id` 是**宝箱序号**（老端 `setBoxState(name, progress, done)` 的 `progress` 入参就是它）。
 */
export interface ILeagueTaskProgressRow {
    readonly id: number;
    /** 里程碑：已领奖任务数达到它才可领。 */
    readonly count: number;
    readonly rewards: ILeagueReward[];
}

/** 解析 `taskUnion.json`，**只留 `subType == LeagueTask`**（脏行丢弃）。 */
export function parseTaskUnionRows(raw: unknown): ILeagueTaskUnionRow[] {
    const out: ILeagueTaskUnionRow[] = [];
    for (const row of toRefRows(raw)) {
        const resId = toInt(row.resId);
        const subType = toInt(row.subType);
        if (!Number.isFinite(resId) || subType !== LeagueUnionTaskType.leagueTask) continue;
        const param = (row.param ?? {}) as { count?: unknown };
        const targetType = toInt(row.targetType);
        const goto = toInt(row.goto);
        out.push({
            resId,
            subType,
            targetType: Number.isFinite(targetType) ? targetType : 0,
            targetCount: toCount(param.count),
            reward: parseLeagueRewards(row.reward),
            name: typeof row.name === 'string' ? row.name : '',
            goto: Number.isFinite(goto) ? goto : 0,
        });
    }
    return out;
}

/** 解析 `taskUnionProgress.json`（按 `id` 升序 —— 宝箱顺序就是 id 序）。 */
export function parseTaskUnionProgressRows(raw: unknown): ILeagueTaskProgressRow[] {
    const out: ILeagueTaskProgressRow[] = [];
    for (const row of toRefRows(raw)) {
        const id = toInt(row.id);
        if (!Number.isFinite(id)) continue;
        out.push({ id, count: toCount(row.count), rewards: parseLeagueRewards(row.rewards) });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
}

/**
 * 任务状态 —— 老端 `VOLeagueTask` 的三个判定收敛成一个枚举。
 *
 * 映射自协议 `CmdCommonState`：`UNDONE = 0` / `FINISH = 1` / `REWARDED = 2`。
 * ⚠️ 协议里 `FINISH` 的语义是「**可领奖**」（不是「已完成」）—— 老端 `CanBeReward()` 就是判它。
 *    直接拿 `CmdCommonState` 的名字读代码极易误解，故本端起别名。
 */
export type LeagueTaskState = 'undone' | 'canReward' | 'rewarded';

/** 协议 `rewardState` → 本端三态。未知值按 `undone`（与老端 `IsUnDone` 的兜底同口径）。 */
export function leagueTaskStateOf(rewardState: number): LeagueTaskState {
    if (rewardState === 2) return 'rewarded';
    if (rewardState === 1) return 'canReward';
    return 'undone';
}

/** 一条「任务行」的展示模型。 */
export interface ILeagueTaskRowView {
    readonly resId: number;
    /** 标题（`name` 的 `{count}` 已替换成 `targetCount`）。 */
    readonly title: string;
    /** 三态（驱动器 `组件_联盟_任务item` 的「状态」controller pages `0,未完成,1,可领取,2,已领取`）。 */
    readonly state: LeagueTaskState;
    /** 当前值（`CmdTask.count`）。 */
    readonly value: number;
    /** 目标值（`param.count`）。 */
    readonly maxValue: number;
    /** 进度条百分比文案（`Math.floor(value / maxValue * 100) + '%'`；`maxValue <= 0` ⇒ `''`）。 */
    readonly percentText: string;
    /** 最多两格奖励（老端**按下标硬取** `rewards[0]` / `rewards[1]`，缺位即 `null`）。 */
    readonly rewards: readonly (ILeagueReward | null)[];
    readonly goto: number;
}

/**
 * 一条协议 `CmdTask`（只取本模块要的三个字段）。
 *
 * 不直接吃 `CmdTask` 是因为它在 `generated/netProto`，而本文件是**纯函数表**（单测里不引引擎类型）。
 */
export interface ILeagueTaskCmd {
    readonly resId: number;
    readonly count: number;
    readonly rewardState: number;
}

/** 构建一条行的展示模型（`cmd` 为 `null` ⇒ 按「未完成 / 0 / 满进度」渲染，与老端 `else` 分支同口径）。 */
export function buildLeagueTaskRowView(
    row: ILeagueTaskUnionRow,
    cmd: ILeagueTaskCmd | null,
): ILeagueTaskRowView {
    const state: LeagueTaskState = cmd ? leagueTaskStateOf(cmd.rewardState) : 'undone';
    const value = cmd ? toCount(cmd.count) : 0;
    const maxValue = row.targetCount;
    const percentText = maxValue > 0 ? Math.floor((Math.min(value, maxValue) / maxValue) * 100) + '%' : '';
    return {
        resId: row.resId,
        title: row.name.replace('{count}', String(maxValue)),
        state,
        value,
        maxValue,
        percentText,
        rewards: [row.reward[0] ?? null, row.reward[1] ?? null],
        goto: row.goto,
    };
}

/**
 * 构建整张列表 —— 复刻老端 `updateView()` 的**建表 + 排序**：
 *
 * ```ts
 * refArray.sort((a, b) => {
 *     if (taskVoA.CanBeReward() || taskVoB.CanBeReward()) return taskVoA.CanBeReward() ? -1 : 1;
 *     if (taskVoA.Rewarded()   || taskVoB.Rewarded())   return taskVoA.Rewarded()   ?  1 : -1;
 *     return 0;
 * });
 * ```
 *
 * 即 **「可领取」排最前、「已领取」排最后**，其余保持表内原序（老端的比较器对两个「未完成」
 * 返回 `0`，`Array.sort` 在 V8 上稳定 ⇒ 原序）。本端用显式 rank + 稳定排序达到同一结果，
 * 不依赖运行时的 sort 稳定性。
 */
export function buildLeagueTaskRowViews(
    rows: readonly ILeagueTaskUnionRow[],
    cmds: readonly ILeagueTaskCmd[] | null | undefined,
): ILeagueTaskRowView[] {
    const byId = new Map<number, ILeagueTaskCmd>();
    for (const cmd of cmds ?? []) byId.set(cmd.resId, cmd);
    const rank = (state: LeagueTaskState): number => (state === 'canReward' ? 0 : state === 'undone' ? 1 : 2);
    return rows
        .map((row, index) => ({ view: buildLeagueTaskRowView(row, byId.get(row.resId) ?? null), index }))
        .sort((a, b) => rank(a.view.state) - rank(b.view.state) || a.index - b.index)
        .map((x) => x.view);
}

/**
 * 面板顶部进度条 + `lab_count` 的入参 —— 老端 `updateView()`：
 *
 * ```ts
 * if (taskVo) { total++; if (taskVo.Rewarded()) done++; }
 * ...
 * progress.value = Math.min(done, total); progress.max = total;
 * lab_count.setText(done);                 // ↑ `lab_count` 只显示 done（不带分母）
 * ```
 *
 * ⚠️ 分母是**有 VO 的任务数**（`total`），不是表里全部任务数 —— 表里有任务但服务端还没下发 VO 时，
 *    分母会小于表行数。照抄表行数会让进度条永远不满。
 */
export function leagueTaskProgress(
    rows: readonly ILeagueTaskUnionRow[],
    cmds: readonly ILeagueTaskCmd[] | null | undefined,
): { done: number; total: number } {
    const byId = new Map<number, ILeagueTaskCmd>();
    for (const cmd of cmds ?? []) byId.set(cmd.resId, cmd);
    let done = 0;
    let total = 0;
    for (const row of rows) {
        const cmd = byId.get(row.resId);
        if (!cmd) continue;
        total += 1;
        if (leagueTaskStateOf(cmd.rewardState) === 'rewarded') done += 1;
    }
    return { done, total };
}

/** 进度宝箱的三态（驱动器 `组件_联盟_宝箱` 的「状态」controller pages `2,不可领取,1,可领取,0,已领取`）。 */
export type LeagueTaskBoxState = 'locked' | 'canReward' | 'rewarded';

/**
 * 一个进度宝箱的状态 —— 老端 `setBoxState(boxName, progress, done)`：
 *
 * ```ts
 * if (done) state = progress <= cmd.todayTaskGetProgressCount ? "已领取" : "可领取";
 * else      state = "不可领取";
 * ```
 *
 * @param boxId 宝箱序号（`taskUnionProgress.id`，现网 1/2/3）
 * @param done  已领奖任务数（`leagueTaskProgress().done`）
 * @param milestone 该宝箱的里程碑（`taskUnionProgress.count`，现网 3/5/8）
 * @param todayTaskGetProgressCount 已领取的进度宝箱个数（协议 `CmdRoleUnion.todayTaskGetProgressCount`）
 */
export function leagueTaskBoxState(
    boxId: number,
    done: number,
    milestone: number,
    todayTaskGetProgressCount: number,
): LeagueTaskBoxState {
    if (toCount(done) < toCount(milestone)) return 'locked';
    return toCount(todayTaskGetProgressCount) >= toCount(boxId) ? 'rewarded' : 'canReward';
}

/**
 * 「联盟任务」**入口 / 面板**红点 —— 老端 `ModelLeague.hasTaskRD()`：
 *
 * ```ts
 * hasTaskRD() {
 *     // ① 有任务可领
 *     for (const ref of taskUnion.filter(t => t.subType == LeagueTask)) {
 *         const vo = VOLeagueTaskBag.GetVOByTaskId(ref.resId);
 *         if (vo && vo.CanBeReward()) return true;
 *     }
 *     // ② 或进度宝箱可领
 *     return this.hasTaskHeadRewardRD();
 * }
 * ```
 *
 * 即 **「有任务可领」∪「有宝箱可领」**。两条都在本函数里算，调用点传 `rows` / `cmds` /
 * `todayTaskGetProgressCount` 即可（宝箱的里程碑由 `progressRows` 给）。
 */
export function hasLeagueTaskRedDot(
    rows: readonly ILeagueTaskUnionRow[],
    cmds: readonly ILeagueTaskCmd[] | null | undefined,
    progressRows: readonly ILeagueTaskProgressRow[],
    todayTaskGetProgressCount: number,
): boolean {
    const byId = new Map<number, ILeagueTaskCmd>();
    for (const cmd of cmds ?? []) byId.set(cmd.resId, cmd);
    for (const row of rows) {
        const cmd = byId.get(row.resId);
        if (cmd && leagueTaskStateOf(cmd.rewardState) === 'canReward') return true;
    }
    const { done } = leagueTaskProgress(rows, cmds);
    for (const box of progressRows) {
        if (leagueTaskBoxState(box.id, done, box.count, todayTaskGetProgressCount) === 'canReward') return true;
    }
    return false;
}

/** 一个**进度宝箱**的展示模型（= `taskUnionProgress` 的一行 + 它当前的状态）。 */
export interface ILeagueTaskBoxView {
    /** 宝箱序号（`taskUnionProgress.id`，现网 1 / 2 / 3）。 */
    readonly id: number;
    /** 里程碑（`taskUnionProgress.count`，现网 3 / 5 / 8）—— 显示在宝箱下方的 `lab_value`。 */
    readonly milestone: number;
    /** 三态（`组件_联盟_宝箱` 的「状态」controller）。 */
    readonly state: LeagueTaskBoxState;
    /** 该宝箱的奖励（老端只取 `rewards[0]` 显示在浮框里）。 */
    readonly rewards: readonly ILeagueReward[];
}

/**
 * 三个进度宝箱的展示模型（按 `id` 升序 —— 宝箱在图上的左右序就是 id 序）。
 *
 * 老端是**写死三个**（`setBoxState("box_3", 1, done >= 3)` / `box_5` / `box_8`），
 * 里程碑也写死在节点名里；本端改成从 `taskUnionProgress` 表遍历生成 ⇒
 * 运营把宝箱改成 4 档时界面跟着多一个（老端得改代码）。
 *
 * ⚠️ 面板上只建了 **3 个**宝箱节点（对齐 FGUI 原稿）—— 表里超过 3 行时多出来的会被
 *    面板丢掉（见 `LeagueTaskPage.renderBoxes` 的说明），不会错位。
 */
export function buildLeagueTaskBoxViews(
    progressRows: readonly ILeagueTaskProgressRow[],
    done: number,
    todayTaskGetProgressCount: number,
): ILeagueTaskBoxView[] {
    return progressRows.map((box) => ({
        id: box.id,
        milestone: box.count,
        rewards: box.rewards,
        state: leagueTaskBoxState(box.id, done, box.count, todayTaskGetProgressCount),
    }));
}

// ============================================================
// 北伐中原（`ui/League/LeagueNorthExpedition` + 排行 / 奖励两个子页）
// ============================================================
//
// 老端真源：
//   `play/LayerLeagueNorthernExpedition.ts`（主面板）
//   `play/LayerLeagueNorthernExpeditionRank.ts`（排行，2 页签）
//   `play/LayerLeagueNorthernExpeditionReward.ts`（奖励，2 页签）
//   `model/league/ModelLeague.hasNorthernExpedition*RD()`（红点三判据）
//
// ## 数据来源（三张**服务端推**的 + 四张配置表）
//
// | 来源 | 说明 |
// |---|---|
// | `CmdUnionActivity`（`type = 2`） | 活动本体：`id`（boss 关卡 level）/ `resetTime` / `addBuffTimes` / `addBuffTime` / `allValue` / `tlCmdUnionActInfo` |
// | `taskUnion`（`subType` 2 / 3） | 奖励页两页签的任务行（联盟伤害 / 个人伤害） |
// | `CmdTask` | 每行的进度与状态（与 P5 同一份通用任务缓存） |
// | `guankaReward` + `monster` | `level → tlBoss[0].id → monster.name / model` |
// | `bfUnionRankAward` | 排名 → 奖励区间（`rank: [min, max]`） |
// | `gameConfig` | 6 个键（见 `ILeagueNorthConfig`） |
//
// ## ⚠️ 排行是**通用排行协议**，不是联盟协议
//
// 老端 `LayerLeagueNorthernExpeditionRank.requestRankInfo()` 发的是 `RequestGetRank`
// （`generated/requestMsg/RequestRankMsg.ts`），`rankType` 两档：**24 = 联盟榜 / 22 = 盟内榜**
// ⇒ 请求体 `{ rankType, showNum: 50, unionId: 我联盟id }`，响应 `CmdGetRankRspMsg { rankInfo }`。
// `ReqMsgProtoName` 里 `CmdGetRankReqMsg` 已登记（`Cmd.d.ts` 7038 行）⇒ 本端补一个
// `RequestGetRank` 类即可（与 `RequestRoleWatchAdvert` 一样，跨域协议就近收在 `RequestLeagueMsg`）。

/** 表名（老端 `Ref.RefMgrguankaReward` / `Ref.RefMgrmonster` / `Ref.RefMgrbfUnionRankAward`）。 */
export const LEAGUE_GUANKA_REWARD_TABLE = 'guankaReward';
export const LEAGUE_MONSTER_TABLE = 'monster';
export const LEAGUE_UNION_RANK_AWARD_TABLE = 'bfUnionRankAward';

/** 排行 `rankType`（老端 `getRankType()` 写死的 `[24, 22]`，顺序 = 页签序）。 */
export const LEAGUE_NORTH_RANK_TYPE = {
    /** 页签 0「联盟排名」—— 全服联盟榜（`CmdRankRole.count/maxCount` = 人数）。 */
    league: 24,
    /** 页签 1「盟内进度」—— 本盟成员伤害榜。 */
    progress: 22,
} as const;

/** 排行请求一次拉多少条（老端 `showNum: 50`）。 */
export const LEAGUE_NORTH_RANK_SHOW_NUM = 50;

/** 两个排行页签（顺序 = FGUI `tab_rank` / `tab_progress` 的左右序）。 */
export type LeagueNorthRankTab = 'rank' | 'progress';

/** 奖励页两个页签（= `taskUnion.subType` 2 / 3）。 */
export type LeagueNorthRewardTab = 'league' | 'role';

/** 页签 → `taskUnion.subType`（老端 `EnumUnionTaskType`）。 */
export const LEAGUE_NORTH_REWARD_SUB_TYPE: Readonly<Record<LeagueNorthRewardTab, number>> = {
    league: LeagueUnionTaskType.leagueDamage, // 2
    role: LeagueUnionTaskType.leagueRoleDamage, // 3
};

// ------------------------------------------------------------
// `gameConfig` 的 6 个北伐键
// ------------------------------------------------------------

/**
 * 北伐用到的 6 个 `gameConfig` 键（老端 `Ref.RefMgrgameConfig.getRef("key", …)`）。
 *
 * | 字段 | `gameConfig.key` | 现网值 | 老端读点 |
 * |---|---|---|---|
 * | `enterMaxCount` | `unionBFZYEnterMaxCount` | `2` | 「挑战次数:2/2」的分母 + 挑战红点判据 |
 * | `drumMaxCount` | `unionBFZYDrumMaxCount` | `1` | 擂鼓上限（`todayDrumTimes >= max` ⇒ 提示已用尽） |
 * | `openHour` | `unionBFZYOpenHour` | `[9, 23]` | 开放时段（数组：`[起, 止]`） |
 * | `buff` | `unionBuffConfig` | `[10, 20, 3]` | `[攻击加成值, 每层叠加值, buff 持续小时]` |
 * | `dailyRewards` | `unionDailyChallengeRewards` | 两个奖励 | 「今日挑战奖励」的两个物品框 |
 */
export interface ILeagueNorthConfig {
    /** 每人每日可挑战次数（`unionBFZYEnterMaxCount`）。 */
    readonly enterMaxCount: number;
    /** 每人每日可擂鼓次数（`unionBFZYDrumMaxCount`）。 */
    readonly drumMaxCount: number;
    /** 开放起始小时（`unionBFZYOpenHour[0]`）。 */
    readonly openHourStart: number;
    /** 开放结束小时（`unionBFZYOpenHour[1]`）。 */
    readonly openHourEnd: number;
    /** 英雄共鸣的基础攻击加成（`unionBuffConfig[0]`）。 */
    readonly buffAttack: number;
    /** 英雄共鸣每层的叠加值（`unionBuffConfig[1]`）。 */
    readonly buffAddValue: number;
    /** buff 持续小时数（`unionBuffConfig[2]`）。 */
    readonly buffHours: number;
    /** 「今日挑战奖励」的两个物品（`unionDailyChallengeRewards`）。 */
    readonly dailyRewards: readonly ILeagueReward[];
}

/** 字段 → `gameConfig.key`（数组型的三项共用一条键，见 `parseLeagueNorthConfig`）。 */
export const LEAGUE_NORTH_CONFIG_KEYS = {
    enterMaxCount: 'unionBFZYEnterMaxCount',
    drumMaxCount: 'unionBFZYDrumMaxCount',
    openHour: 'unionBFZYOpenHour',
    buff: 'unionBuffConfig',
    dailyRewards: 'unionDailyChallengeRewards',
} as const;

/** 缺表 / 缺键时的兜底（**与现网值一致** —— 免得界面显示成 0）。 */
export const LEAGUE_NORTH_CONFIG_DEFAULTS: ILeagueNorthConfig = {
    enterMaxCount: 2,
    drumMaxCount: 1,
    openHourStart: 9,
    openHourEnd: 23,
    buffAttack: 10,
    buffAddValue: 20,
    buffHours: 3,
    dailyRewards: [],
};

/** 宽松数字数组（`gameConfig` 的数组型 value；解析不出的项丢掉）。 */
function numberList(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const out: number[] = [];
    for (const item of value) {
        const n = toInt(item);
        if (Number.isFinite(n)) out.push(n);
    }
    return out;
}

/** `gameConfig` 行（`[{key, value}]`）→ 北伐配置。缺项取 `LEAGUE_NORTH_CONFIG_DEFAULTS`。 */
export function parseLeagueNorthConfig(rows: readonly unknown[]): ILeagueNorthConfig {
    const found = new Map<string, unknown>();
    if (Array.isArray(rows)) {
        for (const raw of rows) {
            if (!raw || typeof raw !== 'object') continue;
            const row = raw as { key?: unknown; value?: unknown };
            if (typeof row.key === 'string') found.set(row.key, row.value);
        }
    }
    /** 标量键：解析不出就用兜底。 */
    const pick = (key: string, fallback: number): number => {
        const n = toInt(found.get(key));
        return Number.isFinite(n) ? n : fallback;
    };
    const hours = numberList(found.get(LEAGUE_NORTH_CONFIG_KEYS.openHour));
    const buff = numberList(found.get(LEAGUE_NORTH_CONFIG_KEYS.buff));
    const rewards = parseLeagueRewards(found.get(LEAGUE_NORTH_CONFIG_KEYS.dailyRewards));
    return {
        enterMaxCount: pick(LEAGUE_NORTH_CONFIG_KEYS.enterMaxCount, LEAGUE_NORTH_CONFIG_DEFAULTS.enterMaxCount),
        drumMaxCount: pick(LEAGUE_NORTH_CONFIG_KEYS.drumMaxCount, LEAGUE_NORTH_CONFIG_DEFAULTS.drumMaxCount),
        openHourStart: hours.length > 0 ? hours[0] : LEAGUE_NORTH_CONFIG_DEFAULTS.openHourStart,
        openHourEnd: hours.length > 1 ? hours[1] : LEAGUE_NORTH_CONFIG_DEFAULTS.openHourEnd,
        buffAttack: buff.length > 0 ? buff[0] : LEAGUE_NORTH_CONFIG_DEFAULTS.buffAttack,
        buffAddValue: buff.length > 1 ? buff[1] : LEAGUE_NORTH_CONFIG_DEFAULTS.buffAddValue,
        buffHours: buff.length > 2 ? buff[2] : LEAGUE_NORTH_CONFIG_DEFAULTS.buffHours,
        dailyRewards: rewards,
    };
}

/**
 * 当前小时是否在活动开放时段内 —— 老端那段
 * `if (timelist[0] > now || now > timelist[1]) { showTip(...); return; }`。
 *
 * ⚠️ 老端用 `new Date().getHours()`（**本地时区的小时**，0~23）⇒ 本函数也收 0~23 的小时数，
 *    由调用点用 `new Date().getHours()` 取（`LeagueNorthExpeditionPage` 里现取，
 *    这样单测可以直接喂任意小时、不用 mock 时间）。
 * ⚠️ 边界口径照抄老端：`start > now` **或** `now > end` 都算关（即 `[start, end]` **闭区间**，
 *    `now === end` 那一刻仍算开）。
 */
export function isLeagueNorthOpen(nowHour: number, config: ILeagueNorthConfig): boolean {
    if (!Number.isFinite(nowHour)) return false;
    return !(config.openHourStart > nowHour || nowHour > config.openHourEnd);
}

/** 活动未开放时的提示（`mL.json` id=388 `{0}点到{1}点开启`）。 */
export function leagueNorthOpenHourText(config: ILeagueNorthConfig): string {
    return fillLeagueText(LEAGUE_NORTH_OPEN_HOUR_TEMPLATE, config.openHourStart, config.openHourEnd);
}

// ------------------------------------------------------------
// `CmdUnionActivity` → 活动视图
// ------------------------------------------------------------

/** `CmdUnionActInfo` 的一行（`roleId` / `times` / `value`）。 */
export interface ILeagueActInfoRow {
    readonly roleId: string;
    readonly times: number;
    readonly value: number;
}

/** 解析 `CmdUnionActivity.tlCmdUnionActInfo`（脏行丢弃；`roleId` 归一成十进制串）。 */
export function parseLeagueActInfos(raw: unknown): ILeagueActInfoRow[] {
    if (!Array.isArray(raw)) return [];
    const out: ILeagueActInfoRow[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const box = item as { roleId?: unknown; times?: unknown; value?: unknown };
        out.push({
            roleId: toIdString(box.roleId),
            times: toCount(box.times),
            // ⚠️ `value` 在 proto 里是 `Long` ⇒ 不能 `value as number`（会得到对象再变 NaN）；
            //    走 `toCount` 的 `Number(value)`（`Long#valueOf()` 给出 number）。
            value: toCount(box.value),
        });
    }
    return out;
}

/** 一次北伐活动的归一视图（`CmdUnionActivity`，`type = 2`）。 */
export interface ILeagueActivityView {
    readonly unionId: string;
    readonly type: number;
    /** **boss 关卡 level**（老端 `actCmd.id` 去 `guankaReward` 表按 `level` 反查 `tlBoss[0]`）。 */
    readonly id: number;
    /** 活动重置时刻（**秒**；Repository 已从 ms 折过）。 */
    readonly resetTimeSec: number;
    /** 英雄共鸣已叠加层数。 */
    readonly addBuffTimes: number;
    /** 上次擂鼓时刻（**毫秒**，`CmdUnionActivity.addBuffTime` 原值）。 */
    readonly addBuffTimeMs: number;
    /** 今日**全盟**累计伤害（`allValue`）。 */
    readonly allValue: number;
    /** 每个成员的次数 / 伤害。 */
    readonly infos: readonly ILeagueActInfoRow[];
}

/**
 * `CmdUnionActivity` → 视图。`null` / 缺 `type` 时返回 `null`（调用点按「活动未开」处理）。
 *
 * ⚠️ `resetTime` 在 proto 里是 `Long`（**毫秒**，服务端写的是今日零点时间戳）⇒
 *    这里 `/1000` 折成秒，**与 `LeagueRepository.toSecFromMs` 同一口径**
 *    （老端是先 ms 再加 `S_DayTime * 1000`、再除 1000 回来，两次换算等价）。
 */
export function parseLeagueActivity(raw: unknown): ILeagueActivityView | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as {
        unionId?: unknown; type?: unknown; id?: unknown; resetTime?: unknown;
        addBuffTimes?: unknown; addBuffTime?: unknown; allValue?: unknown; tlCmdUnionActInfo?: unknown;
    };
    return {
        unionId: toIdString(row.unionId),
        type: toCount(row.type),
        id: toCount(row.id),
        resetTimeSec: toSecFromMsField(row.resetTime),
        addBuffTimes: toCount(row.addBuffTimes),
        addBuffTimeMs: Number.isFinite(toInt(row.addBuffTime)) ? Number(toInt(row.addBuffTime)) : 0,
        allValue: toCount(row.allValue),
        infos: parseLeagueActInfos(row.tlCmdUnionActInfo),
    };
}

/**
 * 毫秒型 `Long` 字段 → 秒（`parseLeagueActivity` 专用）。
 *
 * ⚠️ 与 `LeagueRepository.toSecFromMs` 同一个坑（`Number(long)` 在 protobufjs 上是 `NaN`）——
 *    本文件是**纯函数表**、不能 import Repository（那边会 import 本文件），所以就地再写一份，
 *    两处都用 `toInt` 的 `Number(value)` 口径（`Long#valueOf()` 给 number）。
 */
function toSecFromMsField(value: unknown): number {
    const n = toInt(value);
    return Number.isFinite(n) ? Math.trunc(n / 1000) : 0;
}

/** 「我」在这次活动里的次数与伤害（老端 `updateView()` 里那段 `forEach` 累加）。 */
export function leagueActSelfStats(
    act: ILeagueActivityView | null,
    selfRoleId: string,
): { times: number; value: number } {
    let times = 0;
    let value = 0;
    if (!act || !selfRoleId) return { times, value };
    for (const info of act.infos) {
        // ⚠️ 老端是 `item.roleId == role.GetCmd().roleId`（**宽松相等**，proto 的 `Long` 与 number
        //    混比在那边能过）。本端两边都归一成十进制串，再做 `===`。
        if (info.roleId !== selfRoleId) continue;
        times += info.times;
        value += info.value;
    }
    return { times, value };
}

// ------------------------------------------------------------
// boss（`guankaReward` → `monster`）
// ------------------------------------------------------------

/** `guankaReward` 的一行（只留北伐要的两列）。 */
export interface ILeagueGuanKaRow {
    readonly level: number;
    /** `tlBoss[0].id`；没配 boss 时为 `0`。 */
    readonly bossId: number;
}

/** 解析 `guankaReward.json`（只留 `level` 与 `tlBoss[0].id`）。 */
export function parseLeagueGuanKaRows(raw: unknown): ILeagueGuanKaRow[] {
    const out: ILeagueGuanKaRow[] = [];
    for (const row of toRefRows(raw)) {
        const level = toInt(row.level);
        if (!Number.isFinite(level)) continue;
        const bosses = Array.isArray(row.tlBoss) ? row.tlBoss : [];
        const first = bosses[0] as { id?: unknown } | undefined;
        const bossId = toInt(first?.id);
        out.push({ level, bossId: Number.isFinite(bossId) ? bossId : 0 });
    }
    return out;
}

/** 一个怪物的展示模型（`monster.json` 的行）。 */
export interface ILeagueMonsterView {
    readonly id: number;
    readonly name: string;
    /** 模型名（老端 `monster.model.split("_")` 取最后一段 + `npc` 去查半身像）。 */
    readonly model: string;
}

/** 解析 `monster.json`（只留 `id` / `name` / `model`）。 */
export function parseLeagueMonsterRows(raw: unknown): ILeagueMonsterView[] {
    const out: ILeagueMonsterView[] = [];
    for (const row of toRefRows(raw)) {
        const id = toInt(row.id);
        if (!Number.isFinite(id)) continue;
        out.push({
            id,
            name: typeof row.name === 'string' ? row.name : '',
            model: typeof row.model === 'string' ? row.model : '',
        });
    }
    return out;
}

/**
 * boss 关卡 level → 怪物（老端 `updateView()` 的两行链式反查）。
 *
 * ```ts
 * let boss = this.Ref.RefMgrguankaReward.getRef("level", actCmd.id).tlBoss[0];
 * let monster = this.Ref.RefMgrmonster.getRef("id", boss.id);
 * com.tm("lab_monster").setText(monster.name);
 * ```
 *
 * ⚠️ **中间任何一环落空都要返回 `null`**（老端在这里会**直接抛** —— `getRef` 返回空壳、
 *    再取 `.tlBoss` 就崩了）。本端返回 `null`，面板把名字留空（活动没开时 `id` 是 0，
 *    查不到任何关卡，这条路径是常态而不是异常）。
 */
export function leagueNorthBossOf(
    guanKaRows: readonly ILeagueGuanKaRow[],
    monsters: readonly ILeagueMonsterView[],
    level: number,
): ILeagueMonsterView | null {
    if (!Number.isFinite(level) || level <= 0) return null;
    const stage = guanKaRows.find((row) => row.level === level);
    if (!stage || stage.bossId <= 0) return null;
    return monsters.find((m) => m.id === stage.bossId) ?? null;
}

// ------------------------------------------------------------
// 排行页（`ui/League/LeagueNorthRank`）
// ------------------------------------------------------------

/** `CmdRankRole` 的归一视图。 */
export interface ILeagueRankRow {
    /** 名次；`-1` = 未上榜。 */
    readonly rank: number;
    readonly roleId: string;
    readonly roleName: string;
    /** 伤害总量（联盟榜 = 联盟总伤害 / 盟内榜 = 该成员伤害）。 */
    readonly value: number;
    /** 联盟榜：人数 / 上限。 */
    readonly count: number;
    readonly maxCount: number;
    /** 盟内榜用它查头像（老端 `ModelPlayer.GetPlayerIcon(usedSkinResId)`）。 */
    readonly usedSkinResId: number;
}

/** `Long`/number 原样 → number（**不做 `> 0` 归一**：`rank` 的 `-1` 是有意义的「未上榜」）。 */
function toSignedNumber(value: unknown): number {
    const n = toInt(value);
    return Number.isFinite(n) ? n : 0;
}

/** 解析 `rankInfo.rankList` / `rankInfo.myRank`。 */
export function parseLeagueRankRows(raw: unknown): ILeagueRankRow[] {
    if (!Array.isArray(raw)) return [];
    const out: ILeagueRankRow[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const row = item as {
            rank?: unknown; roleId?: unknown; roleName?: unknown; value?: unknown;
            count?: unknown; maxCount?: unknown; usedSkinResId?: unknown;
        };
        out.push({
            rank: toSignedNumber(row.rank),
            roleId: toIdString(row.roleId),
            roleName: typeof row.roleName === 'string' ? row.roleName : '',
            value: toCount(row.value),
            count: toCount(row.count),
            maxCount: toCount(row.maxCount),
            usedSkinResId: toCount(row.usedSkinResId),
        });
    }
    return out;
}

/** `bfUnionRankAward` 的一行（`id` / `rank: [min, max]` / `reward`）。 */
export interface ILeagueUnionRankAwardRow {
    readonly id: number;
    readonly minRank: number;
    readonly maxRank: number;
    readonly reward: readonly ILeagueReward[];
}

/** 解析 `bfUnionRankAward.json`。 */
export function parseUnionRankAwardRows(raw: unknown): ILeagueUnionRankAwardRow[] {
    const out: ILeagueUnionRankAwardRow[] = [];
    for (const row of toRefRows(raw)) {
        const id = toInt(row.id);
        if (!Number.isFinite(id)) continue;
        const range = numberList(row.rank);
        out.push({
            id,
            minRank: range.length > 0 ? range[0] : 0,
            maxRank: range.length > 1 ? range[1] : (range.length > 0 ? range[0] : 0),
            reward: parseLeagueRewards(row.reward),
        });
    }
    out.sort((a, b) => a.minRank - b.minRank);
    return out;
}

/**
 * 名次 → 奖励区间（老端 `getRefByRank(rank)`：`rank >= min && rank <= max`）。
 *
 * ⚠️ `-1`（未上榜）**永远查不到**（没有任何区间会覆盖负数）⇒ 返回 `null`、两颗物品框藏起来，
 *    与老端 `else { com_goods.visible = false; … }` 一致。
 */
export function leagueRankRewardOf(
    rows: readonly ILeagueUnionRankAwardRow[],
    rank: number,
): ILeagueUnionRankAwardRow | null {
    if (!Number.isFinite(rank)) return null;
    return rows.find((row) => rank >= row.minRank && rank <= row.maxRank) ?? null;
}

/**
 * 一条排行行的展示模型 —— **两种页签共用**（老端 `renderRank` / `renderProgress` 的并集）。
 *
 * 两页签各只显示一半字段（FGUI 靠 `gearDisplay controller="标签"` 切），但**数据一次算好**、
 * 由行脚本按页签挑着铺（`LeagueNorthRankRow`）。
 */
export interface ILeagueNorthRankRowView {
    /** 名次（`-1` = 未上榜）。 */
    readonly rank: number;
    /** `rank` 列文案（老端 `item.tm("rank").setText(data.rank || 0)` + `rank.lab`）。 */
    readonly rankText: string;
    /** 「联盟及伤害」列 —— 联盟名（`roleName`）。 */
    readonly leagueName: string;
    /** 「联盟及伤害」列第二行 —— `formatNumberToZH(value)`。 */
    readonly powerText: string;
    /** 「人数」列 —— `count/maxCount`。 */
    readonly roleCountText: string;
    /** 「盟内进度」页的玩家名（与 `leagueName` 同源，但那一列是独立 Label）。 */
    readonly userName: string;
    /** 「盟内进度」页第二行 —— `numAbbr(value)`（`2.1M` 那种缩写）。 */
    readonly powerAbbrText: string;
    /** 「盟内进度」页头像 —— `usedSkinResId`（解析不出图时调用点藏掉头像内层）。 */
    readonly headResId: number;
    /** 该名次对应的奖励区间（查不到 ⇒ 空数组，两颗物品框藏起来）。 */
    readonly rewards: readonly ILeagueReward[];
}

/** 单行 → 视图。 */
export function buildLeagueNorthRankRowView(
    row: ILeagueRankRow,
    awardRows: readonly ILeagueUnionRankAwardRow[],
): ILeagueNorthRankRowView {
    const award = leagueRankRewardOf(awardRows, row.rank);
    return {
        rank: row.rank,
        // ⚠️ 老端 `setText(data.rank || 0)` —— `-1 || 0` 得到 `0`，但**另一行**又写
        //    `rank.lab` = `data.rank`（`-1`）。`组件_联盟_北伐中原_排名` 的 `标签` 控制器
        //    按 `data.rank == -1 ? "未上榜" : "第一名"` 切页 ⇒ 显示「未上榜」那页，
        //    `lab` 根本不显示。所以这里 `rank` 列只在**上榜**时给数字，未上榜给空串
        //    （比老端那个会被盖住的 `0` 更贴近实际渲染）。
        rankText: row.rank > 0 ? String(row.rank) : '',
        leagueName: row.roleName,
        powerText: StringUtil.formatNumberToZH(row.value),
        roleCountText: `${row.count}/${row.maxCount}`,
        userName: row.roleName,
        powerAbbrText: StringUtil.numAbbr(row.value),
        headResId: row.usedSkinResId,
        rewards: award ? award.reward : [],
    };
}

/** 整页 → 视图数组（`awardRows` 供「联盟排名」页查奖励区间）。 */
export function buildLeagueNorthRankRowViews(
    rows: readonly ILeagueRankRow[],
    awardRows: readonly ILeagueUnionRankAwardRow[],
): ILeagueNorthRankRowView[] {
    return rows.map((row) => buildLeagueNorthRankRowView(row, awardRows));
}

// ------------------------------------------------------------
// 奖励页（`ui/League/LeagueNorthReward`）
// ------------------------------------------------------------

/** `taskUnion` 里北伐奖励页的两档 `subType`（老端 `[LeagueDamage, LeagueRoleDamage]`）。 */
export const LEAGUE_NORTH_REWARD_SUB_TYPES: readonly number[] = [
    LeagueUnionTaskType.leagueDamage,
    LeagueUnionTaskType.leagueRoleDamage,
];

/**
 * 解析 `taskUnion.json` 里 `subType ∈ {2, 3}` 的行（**P5 的 `parseTaskUnionRows` 只留 1**）。
 *
 * ⚠️ 与 P5 那条**不能合并**：P5 的任务面板只认 `subType = 1`，奖励页只认 `2 / 3`。
 *    合并成「全部都留」会让 P5 的任务列表多出 25 行伤害任务。
 */
export function parseNorthTaskUnionRows(raw: unknown): ILeagueTaskUnionRow[] {
    const out: ILeagueTaskUnionRow[] = [];
    for (const row of toRefRows(raw)) {
        const resId = toInt(row.resId);
        const subType = toInt(row.subType);
        if (!Number.isFinite(resId) || !LEAGUE_NORTH_REWARD_SUB_TYPES.includes(subType)) continue;
        const param = (row.param ?? {}) as { count?: unknown };
        const targetType = toInt(row.targetType);
        const goto = toInt(row.goto);
        out.push({
            resId,
            subType,
            targetType: Number.isFinite(targetType) ? targetType : 0,
            targetCount: toCount(param.count),
            reward: parseLeagueRewards(row.reward),
            name: typeof row.name === 'string' ? row.name : '',
            goto: Number.isFinite(goto) ? goto : 0,
        });
    }
    return out;
}

/** 一条奖励行的展示模型（`组件_联盟_北伐中原_奖励Item` 的三种页）。 */
export interface ILeagueNorthRewardRowView {
    readonly resId: number;
    /** 标题（`name` 模板的 `{count}` 已替换成 `ref.param.count`，老端 `ref.name.replace("{count}", …)`）。 */
    readonly nameText: string;
    readonly reward: ILeagueReward | null;
    /** 当前进度（`CmdTask.count`，没有 VO ⇒ 0）。 */
    readonly now: number;
    /** 目标（`param.count`）。 */
    readonly maxValue: number;
    /** 进度条 `value`（0~100，老端 `(now / ref.param.count) * 100`）。 */
    readonly progress: number;
    /** 进度条文案 —— 老端 `${strNow}/${strDamage}`（两边都过 `formatNumberToZH`）。 */
    readonly progressText: string;
    readonly state: LeagueTaskState;
}

/**
 * 一条奖励行 → 视图。
 *
 * ⚠️ 老端 `render()` 是三处**松散**取值，有一处会炸：
 *    `let titleStr = ref.name.replace("{count}", ref.param.count)` —— `param` 缺失时抛；
 *    `progress.value = (now / ref.param.count) * 100` —— 分母 0 ⇒ `Infinity`。
 *    本端：缺 `param` ⇒ `targetCount = 0`；分母 0 ⇒ 比例 0（进度条不满也不 NaN）。
 */
export function buildLeagueNorthRewardRowView(
    row: ILeagueTaskUnionRow,
    cmd: ILeagueTaskCmd | null,
): ILeagueNorthRewardRowView {
    const state: LeagueTaskState = cmd ? leagueTaskStateOf(cmd.rewardState) : 'undone';
    const now = cmd ? toCount(cmd.count) : 0;
    const maxValue = row.targetCount;
    const ratio = maxValue > 0 ? Math.max(0, Math.min(1, now / maxValue)) : 0;
    return {
        resId: row.resId,
        // ⚠️ 任务名用的是 **`{count}`** 占位（不是 `fillLeagueText` 的 `{0}`）——
        //    老端 `ref.name.replace("{count}", ref.param.count)`，别拿 `fillLeagueText` 填
        //    （那个只认 `{数字}`，会把名字原样吐回来，界面上就残留着 `{count}`）。
        nameText: row.name.replace('{count}', String(maxValue)),
        reward: row.reward[0] ?? null,
        now,
        maxValue,
        progress: ratio * 100,
        progressText: `${StringUtil.formatNumberToZH(now)}/${StringUtil.formatNumberToZH(maxValue)}`,
        state,
    };
}

/**
 * 一整页的任务行 → 视图（**排序照抄老端 `updateView()`**）。
 *
 * 老端那段比较器的语义（`a` 在前返回负）：
 * ```
 * if (taskVoA.CanBeReward() || taskVoB.CanBeReward()) return taskVoA.CanBeReward() ? -1 : 1;
 * if (taskVoA.Rewarded()   || taskVoB.Rewarded())   return taskVoA.Rewarded()   ?  1 : -1;
 * return 0;
 * ```
 * ⚠️ 老端这里**会抛**：`taskVoA` 可能 `undefined`（`GetVOByTaskId` 查不到），
 *    第一句就 `Cannot read properties of undefined`。本端按「无 VO = 未完成」兜底
 *    （与 `buildLeagueTaskRowView` 的口径一致）。
 * ⚠️ 老端**没有**用显式 rank + 稳定排序 —— 本端补上（同 `buildLeagueTaskRowViews` 的处置），
 *    否则同档内的顺序会依赖 V8 的实现细节。
 */
export function buildLeagueNorthRewardRowViews(
    rows: readonly ILeagueTaskUnionRow[],
    cmds: readonly ILeagueTaskCmd[] | null | undefined,
): ILeagueNorthRewardRowView[] {
    const byId = new Map<number, ILeagueTaskCmd>();
    for (const cmd of cmds ?? []) byId.set(cmd.resId, cmd);
    const rankOf = (state: LeagueTaskState): number => (state === 'canReward' ? 0 : state === 'undone' ? 1 : 2);
    return rows
        .map((row, index) => ({ row, index, state: leagueTaskStateOf(byId.get(row.resId)?.rewardState ?? 0) }))
        .sort((a, b) => (rankOf(a.state) - rankOf(b.state)) || (a.index - b.index))
        .map((item) => buildLeagueNorthRewardRowView(item.row, byId.get(item.row.resId) ?? null));
}

/** 按页签取 `taskUnion` 的行（`league` → subType 2 / `role` → subType 3）。 */
export function northRewardRowsOf(
    rows: readonly ILeagueTaskUnionRow[],
    tab: LeagueNorthRewardTab,
): ILeagueTaskUnionRow[] {
    const subType = LEAGUE_NORTH_REWARD_SUB_TYPE[tab];
    return rows.filter((row) => row.subType === subType);
}

// ------------------------------------------------------------
// 红点（老端 `ModelLeague.hasNorthernExpedition{Challenge,Reward}RD`）
// ------------------------------------------------------------

/**
 * 「挑战」红点 —— 老端 `hasNorthernExpeditionChallengeRD()`：
 *
 * ```ts
 * act = VOUnionActivityBag.GetTypeArray(NORTHERN_EXPEDITION)[0];  // 没有活动 ⇒ false
 * count = Σ(actCmd.tlCmdUnionActInfo 里 roleId == 我 的 times);
 * return count < RefMgrgameConfig.getRef("key", "unionBFZYEnterMaxCount").value;
 * ```
 *
 * ⚠️ **活动不存在时返回 `false`**（老端第一句就 `if (!act) return false`）——
 *    别写成「没活动就没打过 ⇒ 次数 0 < 上限 ⇒ 恒亮」。
 */
export function hasLeagueNorthChallengeRedDot(
    act: ILeagueActivityView | null,
    selfRoleId: string,
    enterMaxCount: number,
): boolean {
    if (!act) return false;
    const { times } = leagueActSelfStats(act, selfRoleId);
    return times < enterMaxCount;
}

/**
 * 某一档「奖励」红点 —— 老端 `hasNorthernExpeditionReward(subType)`：
 * 该档任务里**任意一条**处于「可领取」就亮。
 *
 * ⚠️ 老端那句 `let taskVo = …GetVOByTaskId(ref.resId); if (taskVo && taskVo.CanBeReward())`
 *    有 `taskVo &&` 守 —— 与 P5 的 `hasLeagueTaskRedDot` 同口径（无 VO 不算可领）。
 */
export function hasLeagueNorthRewardRedDot(
    rows: readonly ILeagueTaskUnionRow[],
    cmds: readonly ILeagueTaskCmd[] | null | undefined,
    tab: LeagueNorthRewardTab,
): boolean {
    const byId = new Map<number, ILeagueTaskCmd>();
    for (const cmd of cmds ?? []) byId.set(cmd.resId, cmd);
    for (const row of northRewardRowsOf(rows, tab)) {
        const cmd = byId.get(row.resId);
        if (cmd && leagueTaskStateOf(cmd.rewardState) === 'canReward') return true;
    }
    return false;
}

/**
 * **入口红点** —— 老端 `hasNorthernExpeditionRD()` = 挑战 ∪ 两档奖励（三个判据的并）。
 *
 * ⚠️ 「必须已入盟」那道闸**不在本函数里**：老端 `RDLeague.OnComputeResult()` 第一句就是
 *    `if (!IsJoinedLeague()) return 0`（同 P4/P5 两条入口红点的处置），
 *    由 `LeagueRepository.loadLeagueEntryRedDots()` 统一兜。
 */
export function hasLeagueNorthRedDot(
    act: ILeagueActivityView | null,
    selfRoleId: string,
    enterMaxCount: number,
    rows: readonly ILeagueTaskUnionRow[],
    cmds: readonly ILeagueTaskCmd[] | null | undefined,
): boolean {
    if (hasLeagueNorthChallengeRedDot(act, selfRoleId, enterMaxCount)) return true;
    return hasLeagueNorthRewardRedDot(rows, cmds, 'league')
        || hasLeagueNorthRewardRedDot(rows, cmds, 'role');
}

// ------------------------------------------------------------
// 主面板文案（老端 `updateView()` / `updateTime()` 里那几串）
// ------------------------------------------------------------

/**
 * 「英雄共鸣」那一行的属性加成文案 —— 老端
 * `com.tm("attr.value").setText(FW.G_W("ATTR_ATTACK") + formatNumberToZH(value[0] * actCmd.addBuffTimes))`。
 *
 * = `攻击` + 数字（`mL.json` id=423 `ATTR_ATTACK` = `攻击`；**没有**加号 —— 老端是裸拼）。
 */
export function leagueNorthBuffText(config: ILeagueNorthConfig, addBuffTimes: number): string {
    return `${LEAGUE_NORTH_ATTR_ATTACK}${StringUtil.formatNumberToZH(config.buffAttack * Math.max(0, addBuffTimes))}`;
}

/**
 * 挑战次数文案 —— 老端
 * `com.tm("lab_times").setText(FW.G_W("DUNGEON_ENTER_COUNT_TEXT") + `${maxCount - count}/${maxCount}`)`。
 *
 * = `挑战次数:` + `剩余/上限`（**半角冒号**，`mL.json` id=445 逐字如此）。
 */
export function leagueNorthTimesText(config: ILeagueNorthConfig, used: number): string {
    const max = Math.max(0, config.enterMaxCount);
    const left = Math.max(0, max - Math.max(0, used));
    return `${LEAGUE_NORTH_ENTER_COUNT_PREFIX}${left}/${max}`;
}

/**
 * buff 剩余秒数 —— 老端 `updateTime()`：
 *
 * ```ts
 * let buffend = this.addBuffTime + (value[2] * this.TimeUtil.S_HourTime) * 1000;
 * let lerp = (buffend - now) / 1000;   // ≤ 0 ⇒ "00:00:00"
 * ```
 *
 * ⚠️ 入参 `addBuffTimeMs` 是**毫秒**（协议原值），`nowMs` 也是毫秒 ⇒ 单位自洽。
 *    返回值钳到 `>= 0`（老端靠 `if (lerp <= 0) "00:00:00"` 兜，本端直接钳）。
 */
export function leagueNorthBuffRemainSec(
    config: ILeagueNorthConfig,
    addBuffTimeMs: number,
    nowMs: number,
): number {
    if (!Number.isFinite(addBuffTimeMs) || !Number.isFinite(nowMs)) return 0;
    const end = addBuffTimeMs + config.buffHours * 3600 * 1000;
    return Math.max(0, Math.floor((end - nowMs) / 1000));
}

/**
 * 活动剩余秒数 —— 老端
 * `this.resetTime = actCmd.resetTime + TimeUtil.S_DayTime * 1000`（`resetTime` 是**今日零点**）。
 *
 * ⇒ 截止时刻 = 今日零点 + 24h = **次日零点**。本端 `resetTimeSec` 已经是秒
 * （`parseLeagueActivity` 折过）⇒ 这里加 `LEAGUE_DISCOUNT_RESET_DAY_SECONDS`（86400 秒），
 * **别把 `* 1000` 也照抄过来**（同 `LEAGUE_DISCOUNT_RESET_DAY_SECONDS` 的教训）。
 */
export function leagueNorthResetRemainSec(resetTimeSec: number, nowMs: number): number {
    if (!Number.isFinite(resetTimeSec) || !Number.isFinite(nowMs)) return 0;
    const deadlineMs = (resetTimeSec + LEAGUE_DISCOUNT_RESET_DAY_SECONDS) * 1000;
    return Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
}

/**
 * 秒 → `HH:MM:SS`（老端 `TimeUtil.timeSec2HMSStr4(lerp)`）。
 *
 * ⚠️ 老端那个 `timeSec2HMSStr4` 的名字容易读成「带毫秒」，实际是**四段补零**
 *    （`StringUtil.paddingNum` 到 2 位）⇒ 输出恒为 `HH:MM:SS`。
 */
export function leagueNorthHms(seconds: number): string {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
