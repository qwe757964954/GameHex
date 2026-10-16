/**
 * 七日狂欢美术口径。
 * item.icon 已是 resources 资源路径（icons/分类/文件名），直接解析。
 */

import { FRAME_ART_ROOT, spriteFramePath } from '../ArtPaths';

export const SEVEN_DAY_ART_ROOT = 'image/sevenDay';

const QUALITY_FRAME_LEVELS = 4;

/** 品质档 → 框档（1..4）。 */
export function qualityFrameLevel(quality: number): number {
    const raw = Math.floor(quality) - 1;
    return Math.min(QUALITY_FRAME_LEVELS, Math.max(1, raw > 0 ? raw : 1));
}

export function qualityFrameName(quality: number): string {
    return `common_img_pzk_0${qualityFrameLevel(quality)}`;
}

export const QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

/** 全部品质框名（按框档枚举，恰好 4 张）。 */
export const QUALITY_FRAME_NAMES: readonly string[] = Array.from(
    { length: QUALITY_FRAME_LEVELS },
    (_unused, index) => `common_img_pzk_0${index + 1}`,
);

export interface ISevenDayIconRef {
    readonly root: string;
    readonly name: string;
}

/** 人工白名单（优先级高于路径直通），当前为空。 */
export const SEVEN_DAY_ITEM_ICON_MAP: ReadonlyMap<string, ISevenDayIconRef> = new Map<
    string,
    ISevenDayIconRef
>([]);

export const SEVEN_DAY_ICON_PATH_ROOT = 'icons';

/**
 * 把资源路径形态的 icon 拆成加载参数。
 * 只认 icons/ 前缀；老格式裸名返回 null。
 */
export function splitIconPath(iconPath: string): ISevenDayIconRef | null {
    if (!iconPath.startsWith(`${SEVEN_DAY_ICON_PATH_ROOT}/`)) return null;
    const slash = iconPath.lastIndexOf('/');
    const root = iconPath.slice(0, slash);
    const name = iconPath.slice(slash + 1);
    if (!root || !name) return null;
    return { root, name };
}

/** 取道具图标加载参数；解析不出返回 null（调用方隐藏图标节点）。 */
export function resolveItemIconRef(iconKey: string): ISevenDayIconRef | null {
    if (!iconKey) return null;
    const mapped = SEVEN_DAY_ITEM_ICON_MAP.get(iconKey);
    if (mapped) return mapped;
    return splitIconPath(iconKey);
}

export function resolveItemIconPath(iconKey: string): string | null {
    const ref = resolveItemIconRef(iconKey);
    return ref ? spriteFramePath(ref.root, ref.name) : null;
}
