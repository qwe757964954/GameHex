/**
 * 主界面顶部资源栏数据层 —— 纯函数，零引擎依赖。
 * 槽位顺序固定（银币/晶石/体力），体力值为 当前/上限。
 */
import { formatResourceAmount } from '../../core/math/CompactNumber';
import { FALLBACK_RES_ICON_ART } from '../common/ResTypes';
import { toCount, toIdString } from '../net/RequestGuard';

/**
 * 资源栏的**兜底展示顺序**（下标 = 第几格）：银币 / 晶石 / 体力。
 *
 * ⚠️ 2026-09-29 起它**只服务 `buildResBarView` 的默认参数**（`MainResBar` 拿它算一份
 * `view.slots`，但玩家信息块按设计不渲染货币格）—— HUD 上真正渲染货币的是
 * `ArenaRoot/TopHud/ResBarLayer` 下那颗 `common/ResBar` **嵌套实例**，
 * 格数真源是实例上覆盖的 `resKeys`。
 *
 * 🔴 **2026-10-26：HUD 不再是三格** —— 实例上覆盖成 `gold,end`（银币 + 体力，用户口径：
 * 「资源栏的按钮分别对应 银币 icon 和 体力 icon」）。所以本常量与 HUD **不再一一对应**，
 * `tests/main-resbar.test.ts` 里那条断言直接比 `'gold,end'` 字面量：
 * 改本文件**不需要**动 prefab，改 prefab 才需要同步那条断言。
 */
export const RES_BAR_KEYS: readonly string[] = ['gold', 'gem', 'end'];

/**
 * 资源键 → 图标资源名（**兜底表**，转发 `common/ResTypes.FALLBACK_RES_ICON_ART`）。
 *
 * ⚠️ 真源是 `assets/remoteRef/roleProperty.json` 的 `icon` 列 —— 运行期能读表时一律用
 * `ResTypes.resIconArt(key, rows)`（表优先、这张兜底）。表没落地（登录前 / 编辑器直连预览）
 * 时才落到这里，图在 `ArtPaths.RESOURCE_ICON_ART_ROOT`（`icons/resource/`）。
 * `tests/res-types.test.ts` 逐条比对这张表与真源，防手抄漂移。
 */
export { FALLBACK_RES_ICON_ART as RES_BAR_ICON_ART };

export interface ResBarRoleRow {
    id?: unknown;
    name?: unknown;
    img?: unknown;
    lv?: unknown;
    exp?: unknown;
    gold?: unknown;
    gem?: unknown;
    coin?: unknown;
    end?: unknown;
    endMax?: unknown;
}

export interface LevelRow {
    level?: unknown;
    exp?: unknown;
}

export interface ResBarSlot {
    readonly key: string;
    readonly iconArt: string;
    /** 显示文本（已过 {@link formatResBarAmountText}）；读数滚动/扣除比对**不能**拿它反解析。 */
    readonly valueText: string;
    /** 原始数量（滚动与涨扣比对用）；体力为当前值（已夹到 0 以上）。 */
    readonly amount: number;
    /** 体力上限（`end` 拼 `/上限`）；其余资源为 `0`。 */
    readonly cap: number;
    readonly showPlus: boolean;
}

export interface ResBarView {
    readonly name: string;
    readonly levelText: string;
    readonly uidText: string;
    readonly avatarId: string;
    readonly expRatio: number;
    readonly slots: readonly ResBarSlot[];
}

/**
 * 资源格**显示文本**：体力为 `当前/上限`，其余走工程公共大数换算。
 *
 * 大数换算统一走 `core/math/CompactNumber.formatResourceAmount`（1 万起 K/M/B/T、保留一位小数），
 * 不在这里另抄阈值/后缀 —— 老端资源栏用的是 `bigNum` 表驱动的 `BigNum.shortNum`，阶梯同源。
 *
 * `key === 'end'` 不走缩写：体力上限通常只有三位数，缩写反而读不出「还剩几次」。
 */
export function formatResBarAmountText(key: string, amount: number, cap = 0): string {
    if (key === 'end') {
        const current = Math.max(Math.floor(toCount(amount)), 0);
        return `${current}/${Math.floor(toCount(cap))}`;
    }
    return formatResourceAmount(toCount(amount));
}

/**
 * 一格的**原始数量 + 体力上限**（滚动与涨扣比对的数据源）。
 *
 * 体力当前值夹到 0（老端 `Math.max(vo.GetEnd(), 0)`，可以被消耗成负数但显示 0）；
 * 其余资源照原值，脏负值不在模型层掩盖。
 */
export function resBarAmountOf(
    role: ResBarRoleRow | null | undefined,
    key: string,
): { amount: number; cap: number } {
    if (!role) return { amount: 0, cap: 0 };
    if (key === 'end') {
        return { amount: Math.max(toCount(role.end), 0), cap: toCount(role.endMax) };
    }
    return { amount: toCount((role as Record<string, unknown>)[key]), cap: 0 };
}

/** 资源数值文本。体力为 当前/上限，可为负时当前值归零、上限不变。 */
export function formatResValue(role: ResBarRoleRow | null | undefined, key: string): string {
    if (!role) return '';
    if (key === 'end') return formatResBarAmountText('end', toCount(role.end), toCount(role.endMax));
    const raw = (role as Record<string, unknown>)[key];
    if (typeof raw === 'string') {
        // 空串按 0（服务端偶发空字段）；非数字的脏串原样显示，别硬换算成 0。
        if (raw === '') return formatResBarAmountText(key, 0);
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? formatResBarAmountText(key, parsed) : raw;
    }
    if (typeof raw === 'number') return formatResBarAmountText(key, raw);
    if (raw && typeof raw === 'object') return formatResBarAmountText(key, toCount(raw));
    return '';
}

/** 当前等级经验进度：取下一级那一行；满级/表缺失返回 0。 */
export function computeExpRatio(
    lv: unknown,
    exp: unknown,
    levelRows?: readonly LevelRow[] | null,
): number {
    const level = toCount(lv);
    const current = toCount(exp);
    if (level <= 0 || !levelRows) return 0;
    for (const row of levelRows) {
        if (!row) continue;
        if (toCount(row.level) !== level + 1) continue;
        const max = toCount(row.exp);
        if (max <= 0) return 0;
        return Math.min(1, Math.max(0, current / max));
    }
    return 0;
}

/**
 * 只按 `keys` 产出**槽位骨架**（数值一律 `0`）。
 *
 * ⚠️ 「显示哪几格、每格什么图标、带不带加号」是**静态配置**，只由 `keys` 决定，
 * 与 `CmdRole` 缓存有没有落地无关：天赋页 `resShowType=[10,7]` ⇒ `coin,gold` **两格**，
 * 登录前 / 缓存未落地时也必须只显示两格（老端同理，数值是 0 但不会凭空多一格）。
 * 早先这层是跟着 `buildResBarView` 走的 —— 拿不到角色行就整条不渲染，
 * 于是格数与加号退回 prefab 默认（三格全亮、加号全在），**静默错版面**。
 */
export function buildResBarSlots(
    keys: readonly string[],
    iconOf: (key: string) => string = (key) => FALLBACK_RES_ICON_ART[key] ?? '',
): ResBarSlot[] {
    return keys.map((key) => ({
        key,
        iconArt: iconOf(key),
        valueText: '0',
        amount: 0,
        cap: 0,
        showPlus: key === 'end',
    }));
}

/**
 * CmdRole + 等级表 → 资源栏数据；无角色行返回 null。不抛。
 *
 * `iconOf` 与 {@link buildResBarSlots} 同一个口子：不传时用兜底白名单，页面级货币条
 * （`common/ResBar`）传 `roleProperty` 表驱动的函数。
 */
export function buildResBarView(
    role: ResBarRoleRow | null | undefined,
    levelRows?: readonly LevelRow[] | null,
    keys: readonly string[] = RES_BAR_KEYS,
    iconOf?: (key: string) => string,
): ResBarView | null {
    if (!role) return null;
    const slots: ResBarSlot[] = buildResBarSlots(keys, iconOf).map((slot) => {
        const { amount, cap } = resBarAmountOf(role, slot.key);
        return { ...slot, amount, cap, valueText: formatResValue(role, slot.key) };
    });
    return {
        name: typeof role.name === 'string' ? role.name : '',
        // 2026-10-20 起只显示等级数字（原为 `LV12`，需求要求去掉 `LV` 前缀）。
        levelText: `${toCount(role.lv)}`,
        uidText: `uid:${toIdString(role.id)}`,
        avatarId: toIdString(role.img),
        expRatio: computeExpRatio(role.lv, role.exp, levelRows),
        slots,
    };
}
