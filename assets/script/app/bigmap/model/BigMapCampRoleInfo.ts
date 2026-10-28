/**
 * SLG 据点**角色展示信息**（`SlgGameCameRoleInfo`，协议真源 r879/r880）的归一化层。
 *
 * 纯 TS、零引擎依赖（规则 78），Node 下可直接单测。
 *
 * ## 协议形状
 *
 * ```
 * message SlgGameCameRoleInfo {
 *   required uint64 roleId    = 1; // 玩家Id
 *   required uint64 serverId  = 2; // 玩家所在serverId
 *   required string roleName  = 3; // 玩家名称
 *   required uint64 img       = 4; // 玩家头像
 *   required uint32 defenseHp = 5; // 血量
 *   required uint32 pos       = 6; // 所在格子   ← r880 才加
 * }
 * message CmdSlgCampRoleInfosRspMsg { required uint32 campId = 1; repeated SlgGameCameRoleInfo infos = 2; }
 * ```
 *
 * ## 三条口径（错一条就是静默出错）
 *
 * 1. **两个 `uint64` 一律走字符串**（`roleId` / `serverId` / `img`）：protobufjs 开了 `--force-long`，
 *    运行时拿到的是 `Long` 对象，`Number()` 会丢精度。`img` 用 `toIdString` 与
 *    `ZCBattleUnit.avatarId`（`showInfo.img`）同一口径，才能喂同一个头像解析器。
 * 2. **`pos` 是地图格 id，0 合法**（与建造 `position=0` 同源口径）。负数/小数/超 uint32 才丢该条。
 * 3. **整包坏（不是对象 / `infos` 不是数组 / `campId` 与请求不符）返回 `null`**，由调用方
 *    *保留已有快照不清空*；单条坏只跳过该条 —— 一次超时不能把已展示的角色列表抹成空。
 */

import { toCount, toIdString } from '../../net/RequestGuard';
import { isBigMapCampId } from './BigMapCampInfo';

/** 据点内的一个角色（一个玩家在某个格子上的驻守/占领记录）。 */
export interface IBigMapCampRoleInfo {
    /** 玩家 id（`uint64` → 十进制字符串，禁止转 number）。 */
    readonly roleId: string;
    /** 玩家所在区服 id（`uint64` → 字符串）。跨服据点谁都能来，界面要能显示来源服。 */
    readonly serverId: string;
    readonly roleName: string;
    /** 头像 id（`img`，`uint64` → 字符串）；**不是资源名**，要经 head/icon 表解析。 */
    readonly avatarId: string;
    /** 当前血量（`uint32`，0 表示已破防但记录还在）。 */
    readonly defenseHp: number;
    /** 所在格子 id（`uint32`，**0 合法**）。 */
    readonly pos: number;
}

const UINT32_MAX = 0xffffffff;

/** 角色列表的查询状态（与据点状态 `campDetailStatus` 分开，两条独立协议）。 */
export type BigMapCampRoleStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** 详情面板里角色段的文案。{n} 由调用方替换成人数。 */
export const BIGMAP_CAMP_ROLE_TEXT = {
    heading: '据点角色：{n} 人',
    empty: '据点角色：暂无',
    pending: '据点角色：加载中',
    failed: '据点角色：获取失败，重新选择据点可重试',
    /** 单行角色描述：名字 · 血量 · 所在格。名字可能为空（SLG 守军允许空名），退回玩家 id。 */
    row: (name: string, fallbackId: string, hp: number, pos: number): string =>
        `· ${name || fallbackId}　HP ${hp}　格 ${pos}`,
} as const;

/** 格子 id：整数且落在 uint32 内（0 合法）。 */
function isHexId(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}

/** 血量：uint32 非负整数。 */
function normalizeHp(value: unknown): number {
    const num = toCount(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.min(UINT32_MAX, Math.floor(num));
}

/**
 * 单条角色归一化（`SlgGameCameRoleInfo`）：列表回包与广播事件共用同一口径。
 *
 * roleId 是主键（空串不是合法玩家 id）、`pos` 必须是 uint32 格 id（**0 合法**），
 * 任一不满足就丢弃这一条 —— 不猜、不补默认值。
 */
export function normalizeBigMapCampRoleInfo(raw: unknown): IBigMapCampRoleInfo | null {
    if (!raw || typeof raw !== 'object') return null;
    const { roleId, serverId, roleName, img, defenseHp, pos } = raw as {
        roleId?: unknown; serverId?: unknown; roleName?: unknown;
        img?: unknown; defenseHp?: unknown; pos?: unknown;
    };
    const id = toIdString(roleId);
    if (!id || !isHexId(pos)) return null;
    return {
        roleId: id,
        serverId: toIdString(serverId),
        roleName: typeof roleName === 'string' ? roleName : '',
        avatarId: toIdString(img),
        defenseHp: normalizeHp(defenseHp),
        pos,
    };
}

/**
 * `CmdSlgCampRoleInfosRspMsg` → 角色列表。
 *
 * @param response 原始回包
 * @param campId 本次请求的据点 id；回包 `campId` 与之不符视为**过期/串包**，返回 `null`
 * @returns 按 `pos` 升序去重（同 `pos` 后到覆盖先到）的列表；整包不可用时 `null`
 */
export function normalizeBigMapCampRoleInfos(
    response: unknown,
    campId: number,
): readonly IBigMapCampRoleInfo[] | null {
    if (!response || typeof response !== 'object') return null;
    const { campId: rspCampId, infos } = response as { campId?: unknown; infos?: unknown };
    if (!isBigMapCampId(rspCampId) || rspCampId !== campId) return null;
    if (!Array.isArray(infos)) return null;
    // 键用 pos：同一格不可能站两个角色，后到的更可信（服务端按事务串行写）。
    const byPos = new Map<number, IBigMapCampRoleInfo>();
    for (const info of infos) {
        const role = normalizeBigMapCampRoleInfo(info);
        if (!role) continue;
        byPos.set(role.pos, role);
    }
    return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

/**
 * 据点角色段落（喂给详情面板那段文本），视图只做拼接、不做判断。
 *
 * 四条文案互斥且**优先用已有数据**：查询失败但有旧列表时仍然展示旧列表
 * （一次超时不该把画面清空），只有「从没成功过」才显示失败/加载中。
 */
export function formatBigMapCampRoleLines(
    roles: readonly IBigMapCampRoleInfo[],
    status: BigMapCampRoleStatus,
): readonly string[] {
    if (roles.length === 0) {
        if (status === 'failed') return [BIGMAP_CAMP_ROLE_TEXT.failed];
        if (status === 'loading' || status === 'idle') return [BIGMAP_CAMP_ROLE_TEXT.pending];
        return [BIGMAP_CAMP_ROLE_TEXT.empty];
    }
    return [
        BIGMAP_CAMP_ROLE_TEXT.heading.replace('{n}', String(roles.length)),
        ...roles.map((role) => BIGMAP_CAMP_ROLE_TEXT.row(role.roleName, role.roleId, role.defenseHp, role.pos)),
    ];
}

/**
 * 角色事件类型 —— 对应 `CmdSlgGameRoleInfoBroMsg.eventType`。
 *
 * | 值 | 含义 | 客户端要看重的字段 |
 * |---|---|---|
 * | 1 | 攻击 | `defenseHp`（打完掉血） |
 * | 2 | 复活 | `defenseHp`（回满） |
 * | 3 | 移动 | `pos`（换格） |
 * | 4 | 出生 | 整条（新角色进场） |
 *
 * 四种事件都带**完整** `SlgGameCameRoleInfo`，所以客户端统一按「按 roleId 覆盖这条角色」处理，
 * 不必为每种事件写一套字段合并规则（那样漏一种就会留着过期血量）。
 */
export const BIGMAP_ROLE_EVENT_TYPE = {
    Attack: 1,
    Revive: 2,
    Move: 3,
    Spawn: 4,
} as const;

export type BigMapRoleEventType = (typeof BIGMAP_ROLE_EVENT_TYPE)[keyof typeof BIGMAP_ROLE_EVENT_TYPE];

/** 一条角色广播事件。 */
export interface IBigMapRoleEvent {
    readonly eventType: BigMapRoleEventType;
    readonly role: IBigMapCampRoleInfo;
}

/**
 * `CmdSlgGameRoleInfoBroMsg` → 事件对象；认不出来整条丢弃。
 *
 * 🔴 `eventType` **只认 1~4**，其它值直接 `null` —— 服务端以后加了新事件类型，
 * 老客户端不能把它当成某个已知事件去改数据（那会把血量/位置写坏）。
 * 这条广播**不带 campId**：角色属于哪座据点要靠 `role.pos` 去地图上反查，
 * 所以本层只做「消息 → 结构化事件」，归属判断留给持有地图几何的 Presenter。
 */
export function normalizeBigMapRoleEvent(message: unknown): IBigMapRoleEvent | null {
    if (!message || typeof message !== 'object') return null;
    const { eventType, info } = message as { eventType?: unknown; info?: unknown };
    const type = toCount(eventType);
    if (type !== BIGMAP_ROLE_EVENT_TYPE.Attack && type !== BIGMAP_ROLE_EVENT_TYPE.Revive
        && type !== BIGMAP_ROLE_EVENT_TYPE.Move && type !== BIGMAP_ROLE_EVENT_TYPE.Spawn) return null;
    const role = normalizeBigMapCampRoleInfo(info);
    if (!role) return null;
    return { eventType: type, role };
}
