import type { INetRequestStatus } from '../../core/types/NetResult';
/**
 * 个人信息五弹窗 + 设置面板的**数据端口**。
 *
 * 分层与 `MainTaskRepository` / `FriendRepository` 完全一致：
 * 判定与格式化全在 `PlayerInfoTable`（纯函数、可单测），本文件只负责
 * 「读表 + 读缓存 + 发请求」三件事。
 *
 * ## 数据来源
 *
 * | 用途 | 来源 |
 * |---|---|
 * | 自己：名字 / 等级 / 经验 / 头像 / 平台头像 / 改名免费次数 | 缓存 `CacheMgr.instance.getTlCmdRole()` |
 * | 自己：下一级经验 | 表 `level`（列 `level` / `exp`） |
 * | 他人：全部资料 | 请求 `CmdRoleInfoViewRspMsg`（`RequestRoleInfoView`，**等回包**） |
 * | 头像列表 | 表 `head`（20 行：`resId` / `type` / `icon` / `name`） |
 * | 改名 / 换头像 / 兑换码 | `CmdRoleChangeNameRspMsg` / `CmdRoleChangeImgRspMsg` / `CmdCodeExchangeRspMsg` |
 *
 * ## 缓存读不到不是异常
 *
 * `CacheMgr.instance` 在 `GameNet.doPrepare()` 之前只是个空字典：`getTlCmdRole()` 走
 * `GameCacheMgr.getValues` → `TDic.get`，只读字典、不构造 `GameCache`，**不抛**，返回空数组
 * ⇒ `loadSelf()` 给空快照。编辑器预览 / 未登录时界面必须能打开并显示空态，而不是白屏 + 一片报错。
 *
 * 会抛的是 `getCache()` 那条路（`GameCache.init()` 要读 `protoCacheMessage`），
 * 见 `GameCacheMgr.peekCache` 的注释 —— 本文件只读，不碰那条路。
 *
 * ## 已知缺口（有意留下，不造假的兜底）
 *
 * ① **区服名**：老端走 `ModelServer.getServerInfo(id).name`；本工程的 `remoteRef`
 *    里**没有 `server` 表**（只有 `serverRank`）⇒ `serverName` 恒为空串。
 * ② **头像解锁**：老端 `CheckHasHead(img)` 查背包里 `touxiang`（`ItemType.touxiang = 2`）
 *    类道具；`CacheMgrGen` 里**没有背包 getter** ⇒ `loadHeads()` 的 `unlocked` 一律 `true`，
 *    并把 `ownedResIds` 留成可选注入参数（探针 / 单测可喂假集合验证灰化分支）。
 */
import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { RESOURCE_ICON_ART_ROOT } from '../ArtPaths';
import {
    RequestCodeExchange,
    RequestRoleChangeImg,
    RequestRoleChangeName,
    RequestRoleInfoView,
} from '../generated/requestMsg/RequestRoleMsg';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { toCount, toIdString } from '../net/RequestGuard';
import type { IEquipRow } from '../role/RoleTable';
import { equipPartOf, normalizeEquipRows } from '../role/RoleTable';
import type { IOtherEquipEntry } from './PlayerInfoTable';
import {
    buildHeadIdList,
    isHeadUnlocked,
    resolveExpMax,
} from './PlayerInfoTable';

import { HEAD_TABLE, ITEM_TABLE, ROLE_PROPERTY_TABLE } from '../../core/config/TableNames';
import { READ_TIMEOUT_MS_SLOW as READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } from '../net/Timeouts';
/** 「自己」一名玩家的展示数据。 */
export interface IPlayerInfoSnapshot {
    /** 是不是自己（决定 `btn_rename` 等「仅自己可见」节点的显隐）。 */
    readonly isSelf: boolean;
    /** 角色 id（`uint64` 已转成十进制字符串）。 */
    readonly roleId: string;
    readonly roleName: string;
    /** 头像 `resId`；`0` 表示用平台头像。 */
    readonly img: number;
    /** 平台头像 url（微信 / 抖音），可能为空串。 */
    readonly platformImg: string;
    /** 头像框 `resId`（本工程暂未用到图，只留字段）。 */
    readonly headFrame: number;
    readonly level: number;
    readonly exp: number;
    /** 升到下一级所需经验；满级 / 表读不到为 `0`。 */
    readonly expMax: number;
    readonly serverId: number;
    /** 区服名（**本工程恒空串**，见文件头缺口 ①）。 */
    readonly serverName: string;
    /** 战力（他人信息才有；自己那份缓存里没有这个字段 ⇒ `0`）。 */
    readonly power: number;
    /** 关卡进度（他人信息才有 ⇒ `0`）。 */
    readonly battleLevel: number;
    /** 联盟名（他人信息才有 ⇒ 空串）。 */
    readonly unionName: string;
    /** 改名免费次数（只有自己有；他人信息恒 `0`）。 */
    readonly freeRenameCount: number;
    /**
     * 装备（他人信息才有 ⇒ 自己恒空数组）。
     * 老端 `LayeroOtherPlayerInfoUI.UpdateView` 里按 `tlCmdEquip` 逐件填 `equipTypeN`。
     */
    readonly equip: readonly IOtherEquipEntry[];
}

/** 换头像列表的一格。 */
export interface IHeadEntry {
    /** 头像 `resId`；`0` = 平台头像。 */
    readonly id: number;
    /**
     * 资源名（交给 `HeadArt.loadHeadFrame` / `icon.json` 两级映射解析）。
     * 平台头像恒为空串 —— 它的图要走 `spriteFrame` 直链（`platformImg`）。
     */
    readonly icon: string;
    /** 显示名（`head.name`；取不到为空串）。 */
    readonly name: string;
    /** 是否已解锁（见文件头缺口 ②）。 */
    readonly unlocked: boolean;
}

/** 写请求结果：三态。 */
export type PlayerInfoRequestResult = INetRequestStatus;

/** 读请求结果（他人信息需要回包体）。 */
export interface IOtherInfoResult {
    readonly status: PlayerInfoRequestResult;
    readonly snapshot: IPlayerInfoSnapshot | null;
}

/** 写请求超时（与 `MainTaskRepository` / `FriendRepository` 同口径）。 */
/** 读请求超时（比写短，界面要尽快出空态）。 */

/** 空快照（缓存读不到时用）。 */
const EMPTY_SNAPSHOT: IPlayerInfoSnapshot = {
    isSelf: true,
    roleId: '',
    roleName: '',
    img: 0,
    platformImg: '',
    headFrame: 0,
    level: 1,
    exp: 0,
    expMax: 0,
    serverId: 0,
    serverName: '',
    power: 0,
    battleLevel: 0,
    unionName: '',
    freeRenameCount: 0,
    equip: [],
};

/**
 * 改名消耗的相关配置与图标路径。
 *
 * 出处：`gameConfig`（`renameItemId = 10116` / `renameCostGem = 500`）
 * + `item` 表（`10116` 的 `icon = 'icons/common/图标_改名卡'`，**相对 `assets/resources/` 的路径**）
 * + `roleProperty` 表（`coin` 的 `resId = 10`、`icon = '图标_幻灵玉'`，**FGUI 图标名** ⇒ 落 `icons/resource/`）。
 */
export interface IRenameCostInfo {
    /** 改名卡 `resId`（`gameConfig.renameItemId`）。 */
    readonly itemId: number;
    /** 改名金币数（`gameConfig.renameCostGem`）。 */
    readonly gemCost: number;
    /** 金币的 `resId`（`roleProperty.coin`）。 */
    readonly coinResId: number;
    /** 改名卡图标 —— 相对 `resources` 的装配路径（空 = 表里没读到）。 */
    readonly itemIconPath: string;
    /** 金币图标 —— 相对 `resources` 的装配路径（空 = 表里没读到）。 */
    readonly coinIconPath: string;
}

/** 两张图都拿不到时的兜底（`gemCost` 用老端的默认值 500，别给 0 让玩家以为免费）。 */
const FALLBACK_RENAME_COST: IRenameCostInfo = {
    itemId: 10116,
    gemCost: 500,
    coinResId: 10,
    itemIconPath: '',
    coinIconPath: '',
};

/**
 * 文本字段安全取值：只认 string（协议里这些字段就是 `string`，别的类型视为脏数据）。
 *
 * id / `Long` 的十进制转换统一走 `core/value/Coerce.toIdString`（经 `RequestGuard` 出口）。
 */
function toText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * **配置表行**取值（`remoteRef` JSON：可能是 number / string / null）。
 *
 * 与协议边界的 `toCount` 分开：协议字段类型由 proto 定死（不存在字符串形态），
 * 而表行是 JSON，字符串是正常形态。两者对 `null` 的取舍也不同 ——
 * 本函数按 `Number(null) === 0` 走，保持既有表行口径。
 */
function tableNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function readTable(rows: unknown): readonly Record<string, unknown>[] {
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
}

/** `level` 表 → 升到 `level` 级所需经验。 */
function buildLevelExpMap(rows: readonly Record<string, unknown>[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const row of rows) {
        const lv = tableNumber(row.level, 0);
        if (lv <= 0) continue;
        out.set(lv, resolveExpMax(row));
    }
    return out;
}

/** 数据端口。测试 / 探针可注入替身（见各 Page 的 `setRepository`）。 */
export interface IPlayerInfoRepository {
    /** 读缓存 + 读 `level` 表，组装「自己」的快照；**不发请求**。任何时候都兑现。 */
    loadSelf(): Promise<IPlayerInfoSnapshot>;
    /** 发 `CmdRoleInfoViewReqMsg` 拿别人的资料；离线 / 超时 / 失败返回 `snapshot = null`。 */
    loadOther(roleId: string, serverId: number, caller?: object): Promise<IOtherInfoResult>;
    /** 读 `head` 表拿头像列表（+ 可选注入的「已拥有」集合做解锁判定）。 */
    loadHeads(ownedResIds?: ReadonlySet<number> | readonly number[] | null): Promise<readonly IHeadEntry[]>;
    /** 读 `gameConfig` / `item` / `roleProperty`，拿改名消耗与两张图标路径。任何时候都兑现。 */
    loadRenameCost(): Promise<IRenameCostInfo>;
    /** 改名（`CmdRoleChangeNameReqMsg`）。 */
    rename(name: string, caller?: object): Promise<PlayerInfoRequestResult>;
    /** 换头像（`CmdRoleChangeImgReqMsg`）。 */
    changeHead(resId: number, caller?: object): Promise<PlayerInfoRequestResult>;
    /** 兑换码（`CmdCodeExchangeReqMsg`）。 */
    redeem(code: string, caller?: object): Promise<PlayerInfoRequestResult>;
}

class PlayerInfoRepositoryImpl implements IPlayerInfoRepository {
    /** `level` 表缓存（一次会话内不变）。 */
    private levelExp: Map<number, number> | null = null;
    /** `equip` 表缓存（840 行，按 `resId` 索引；一次会话内不变）。 */
    private equipByResId: Map<number, IEquipRow> | null = null;
    /** 改名消耗缓存（两张配置表 + 两张小表，算一次就够）。 */
    private renameCost: IRenameCostInfo | null = null;

    async loadSelf(): Promise<IPlayerInfoSnapshot> {
        // 缓存里通常只有「自己」那一条；`CmdRole` 的主键是 `id`。
        const row = CacheMgr.instance.getTlCmdRole()[0];
        if (!row) return { ...EMPTY_SNAPSHOT };

        // `lv` / `exp` / `selectServerId` / `freeRenameCount` 是 `sint32` ⇒ 已是整数 number，
        // 只保留业务下界钳制；`id` / `img` / `headFrame` 是 `sint64` ⇒ `Long`，走 core 边界转换。
        const level = Math.max(1, row.lv);
        const exp = Math.max(0, row.exp);
        const expMax = await this.expMaxOf(level);

        return {
            isSelf: true,
            roleId: toIdString(row.id),
            roleName: toText(row.name),
            img: toCount(row.img),
            platformImg: toText(row.platformImg),
            headFrame: toCount(row.headFrame),
            level,
            exp,
            expMax,
            serverId: row.selectServerId ?? 0,
            // 缺口 ①：本工程没有 `server` 表 ⇒ 区服名恒空串。
            serverName: '',
            power: 0,
            battleLevel: 0,
            unionName: '',
            freeRenameCount: Math.max(0, row.freeRenameCount),
            // 自己那份缓存（`CmdRole`）里没有装备栏 —— 装备只在他人信息（`CmdRoleInfoViewRspMsg`）里下发。
            equip: [],
        };
    }

    async loadOther(roleId: string, serverId: number, caller?: object): Promise<IOtherInfoResult> {
        let rsp: CmdRoleInfoViewRspMsg | null = null;
        try {
            // ⚠️ `GameNet.send(req, false)` 的第二个参数恒为 `false`（全工程口径）——
            //    回包通过 `RequestMsg` 的 `fCallback` 通知，不是靠返回值。见
            //    `LayerActivityRepository` / `BattleTokenRepository` 的同款写法。
            const status = await GameNet.sendRequest(() =>
                    new RequestRoleInfoView(
                        { roleId: toCount(roleId), serverId } as any,
                        caller,
                        (r: CmdRoleInfoViewRspMsg) => { rsp = r ?? null; },
                    ),
                { timeoutMs: READ_TIMEOUT_MS, tag: 'PlayerInfo' },
            );
            if (status !== 'ok') return { status, snapshot: null };
        } catch (error) {
            console.warn('[PlayerInfo] 请求他人信息失败', error);
            return { status: 'failed', snapshot: null };
        }

        const r = rsp;
        if (!r) return { status: 'failed', snapshot: null };

        const equip = await this.equipOf(r.tlCmdEquip);

        return {
            status: 'ok',
            snapshot: {
                isSelf: false,
                roleId: toIdString(r.roleId),
                roleName: toText(r.roleName),
                img: toCount(r.img),
                platformImg: toText(r.platformImg),
                headFrame: toCount(r.headFrame),
                level: Math.max(1, r.level ?? 1),
                // `CmdRoleInfoViewRspMsg` **没有** exp / expMax 字段 ⇒ 经验条在他人信息里恒空。
                exp: 0,
                expMax: 0,
                serverId: r.selectServerId ?? serverId,
                serverName: '',
                power: r.power ?? 0,
                battleLevel: r.battleLevel ?? 0,
                unionName: toText(r.unionInfo?.name),
                freeRenameCount: 0,
                equip,
            },
        };
    }

    async loadHeads(ownedResIds?: ReadonlySet<number> | readonly number[] | null): Promise<readonly IHeadEntry[]> {
        let rows: readonly Record<string, unknown>[] = [];
        try {
            rows = readTable(await RefUtil.instance.getRefAllAsync(HEAD_TABLE));
        } catch (error) {
            console.warn('[PlayerInfo] 读 head 表失败', error);
        }

        const all: IHeadEntry[] = [];
        const ids: number[] = [];
        for (const row of rows) {
            const id = Math.floor(tableNumber(row.resId, 0));
            if (id <= 0) continue;
            ids.push(id);
            all.push({
                id,
                icon: toText(row.icon),
                name: toText(row.name),
                unlocked: ownedResIds ? isHeadUnlocked(id, ownedResIds) : true,
            });
        }
        // `buildHeadIdList` 负责「平台头像（id 0）排最前 + 去重」，这里复用它算顺序，
        // 再按顺序把条目捞出来 —— 保证 prefab 侧与数据侧的顺序来自同一个函数。
        const ordered = buildHeadIdList('', ids);
        const byId = new Map(all.map((e) => [e.id, e]));
        return ordered.map((id) => byId.get(id)).filter((e): e is IHeadEntry => !!e);
    }

    async loadRenameCost(): Promise<IRenameCostInfo> {
        if (this.renameCost) return this.renameCost;

        let itemId = FALLBACK_RENAME_COST.itemId;
        let gemCost = FALLBACK_RENAME_COST.gemCost;
        try {
            const itemRow = await RefUtil.instance.getRefAsync('gameConfig', 'key', 'renameItemId');
            const gemRow = await RefUtil.instance.getRefAsync('gameConfig', 'key', 'renameCostGem');
            itemId = tableNumber((itemRow as Record<string, unknown> | null)?.value, itemId);
            gemCost = tableNumber((gemRow as Record<string, unknown> | null)?.value, gemCost);
        } catch (error) {
            console.warn('[PlayerInfo] 读 gameConfig 改名配置失败', error);
        }

        // 改名卡图标：`item` 表的 `icon` 就是**相对 `assets/resources/` 的路径**，直接用。
        let itemIconPath = '';
        try {
            const items = readTable(await RefUtil.instance.getRefAllAsync(ITEM_TABLE));
            const row = items.find((r) => tableNumber(r.resId, 0) === itemId);
            itemIconPath = toText(row?.icon);
        } catch (error) {
            console.warn('[PlayerInfo] 读 item 表失败', error);
        }

        // 金币图标：`roleProperty.icon` 是 **FGUI 图标名**（`图标_幻灵玉`），落固定目录。
        let coinResId = FALLBACK_RENAME_COST.coinResId;
        let coinName = '';
        try {
            const props = readTable(await RefUtil.instance.getRefAllAsync(ROLE_PROPERTY_TABLE));
            const row = props.find((r) => toText(r.key) === 'coin');
            coinResId = tableNumber(row?.resId, coinResId);
            coinName = toText(row?.icon);
        } catch (error) {
            console.warn('[PlayerInfo] 读 roleProperty 表失败', error);
        }

        this.renameCost = {
            itemId,
            gemCost,
            coinResId,
            itemIconPath,
            // ⚠️ 这里只拼「相对 `resources` 的目录部分」，`/spriteFrame` 后缀由加载层拼
            //    （与 `ArtPaths.RESOURCE_ICON_ART_ROOT` 同一口径）。
            coinIconPath: coinName ? `${RESOURCE_ICON_ART_ROOT}/${coinName}` : '',
        };
        return this.renameCost;
    }

    async rename(name: string, caller?: object): Promise<PlayerInfoRequestResult> {
        return this.send(() => new RequestRoleChangeName({ name }, caller, () => undefined));
    }

    async changeHead(resId: number, caller?: object): Promise<PlayerInfoRequestResult> {
        return this.send(() => new RequestRoleChangeImg({ resId } as any, caller, () => undefined));
    }

    async redeem(code: string, caller?: object): Promise<PlayerInfoRequestResult> {
        return this.send(() => new RequestCodeExchange(
            { code },
            caller,
            (rsp) => FW.ShowReward(rsp?.tlReward ?? []),
        ));
    }

    // ---------- 内部 ----------

    /**
     * `CmdEquipLook[]` → 装备格数据。
     *
     * 复用 `RoleTable.equipPartOf`（`equipId` → 部位 / 图标 / 品质，`equip` 表查不到就丢），
     * 额外带上 `level` —— 那是 `CmdEquipLook` 自己的字段，不在 `equip` 表里。
     */
    private async equipOf(rawList: unknown): Promise<readonly IOtherEquipEntry[]> {
        if (!Array.isArray(rawList) || rawList.length === 0) return [];
        if (!this.equipByResId) {
            try {
                this.equipByResId = normalizeEquipRows(readTable(await RefUtil.instance.getRefAllAsync('equip')));
            } catch (error) {
                console.warn('[PlayerInfo] 读 equip 表失败', error);
                this.equipByResId = new Map();
            }
        }
        const out: IOtherEquipEntry[] = [];
        for (const raw of rawList) {
            const part = equipPartOf(raw, this.equipByResId);
            if (!part) continue;
            const level = tableNumber((raw as Record<string, unknown> | null)?.level, 0);
            out.push({
                slot: part.type,
                equipId: part.equipId,
                icon: part.icon,
                quality: part.quality,
                level: Math.max(0, Math.floor(level)),
                gemCount: part.gemCount,
            });
        }
        return out;
    }

    /** 升到 `level + 1` 级需要的经验。满级 / 表读不到 ⇒ `0`。 */
    private async expMaxOf(level: number): Promise<number> {
        if (!this.levelExp) {
            try {
                this.levelExp = buildLevelExpMap(readTable(await RefUtil.instance.getRefAllAsync('level')));
            } catch (error) {
                console.warn('[PlayerInfo] 读 level 表失败', error);
                this.levelExp = new Map();
            }
        }
        return this.levelExp.get(level + 1) ?? 0;
    }

    /** 统一的发包 + 三态收口（与 `FriendRepository.send` / `MainTaskRepository.claim` 同款）。 */
    private async send(make: () => any): Promise<PlayerInfoRequestResult> {
        return GameNet.sendRequest(make, { timeoutMs: WRITE_TIMEOUT_MS, tag: 'PlayerInfo' });
    }
}

/** 全局单例（页面默认用它；测试可注入替身）。 */
export const playerInfoRepository: IPlayerInfoRepository = new PlayerInfoRepositoryImpl();

/** 空快照的只读出口（页面在 `loadSelf()` 还没回来时先用它铺空态）。 */
export function emptyPlayerInfoSnapshot(): IPlayerInfoSnapshot {
    return { ...EMPTY_SNAPSHOT };
}
