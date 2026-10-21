/**
 * 主界面顶部资源栏数据层 —— 纯函数，零引擎依赖。
 * 槽位顺序固定（银币/晶石/体力），体力值为 当前/上限。
 */
import { FALLBACK_RES_ICON_ART } from '../common/ResTypes';
import { toCount, toIdString } from '../net/RequestGuard';

/**
 * 主界面资源栏的展示顺序（下标 = 第几格）：银币 / 晶石 / 体力。
 *
 * ⚠️ 2026-09-29 起它**只服务 `buildResBarView` 的默认参数** —— HUD 上真正渲染货币的是
 * `ArenaRoot/ResBarLayer` 下那颗 `common/ResBar` **嵌套实例**，它的格数真源是实例上覆盖的
 * `resKeys`。两处必须一致，由 `tests/main-resbar.test.ts` 焊死：
 * 改这里就要同步改 `ArenaRoot.prefab` 里那份实例的 `resKeys`，否则货币顺序静默漂移。
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
    readonly valueText: string;
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

/** 资源数值文本。体力为 当前/上限，可为负时当前值归零、上限不变。 */
export function formatResValue(role: ResBarRoleRow | null | undefined, key: string): string {
    if (!role) return '';
    if (key === 'end') {
        const cur = Math.max(toCount(role.end), 0);
        return `${cur}/${toCount(role.endMax)}`;
    }
    const raw = (role as Record<string, unknown>)[key];
    if (typeof raw === 'string') return raw || '0';
    if (typeof raw === 'number') return String(raw);
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
    const slots: ResBarSlot[] = buildResBarSlots(keys, iconOf).map((slot) => ({
        ...slot,
        valueText: formatResValue(role, slot.key),
    }));
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
