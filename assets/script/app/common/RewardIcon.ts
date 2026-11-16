/**
 * 奖励图标解析唯一入口（零引擎依赖）。
 *
 * `item.icon` 是相对 resources 的路径（只认 `icons/` 前缀）；`roleProperty.icon`
 * 是 FGUI 裸名，落 `resIconRoot()`。调用方不要只走 item 一支，否则货币格只剩品质框。
 */
import { spriteFramePath } from '../ArtPaths';
import { resIconRoot } from './ResTypes';
import type { IResGoodsInfo } from '../../core/types/Reward';

export interface IItemIconRef {
    readonly root: string;
    readonly name: string;
}

/** 人工白名单（优先级高于路径直通），当前为空。 */
export const ITEM_ICON_ALIASES: ReadonlyMap<string, IItemIconRef> = new Map<string, IItemIconRef>([]);

export const ITEM_ICON_PATH_ROOT = 'icons';

/** 路径形态 icon → 加载参数；只认 `icons/` 前缀，裸名返回 null。 */
export function splitIconPath(iconPath: string): IItemIconRef | null {
    if (!iconPath.startsWith(`${ITEM_ICON_PATH_ROOT}/`)) return null;
    const slash = iconPath.lastIndexOf('/');
    const root = iconPath.slice(0, slash);
    const name = iconPath.slice(slash + 1);
    if (!root || !name) return null;
    return { root, name };
}

/** 取道具图标加载参数；解析不出返回 null。 */
export function resolveItemIconRef(iconKey: string): IItemIconRef | null {
    if (!iconKey) return null;
    return ITEM_ICON_ALIASES.get(iconKey) ?? splitIconPath(iconKey);
}

/** 取道具图标的 resources 装配路径；解析不出返回 null。 */
export function resolveItemIconPath(iconKey: string): string | null {
    const ref = resolveItemIconRef(iconKey);
    return ref ? spriteFramePath(ref.root, ref.name) : null;
}

/** 一条奖励展示信息 → 加载参数；两类 icon 分流，解析不出返回 null。 */
export function resolveRewardIconRef(info: IResGoodsInfo | null): IItemIconRef | null {
    if (!info || !info.icon) return null;
    if (info.iconIsPath) return resolveItemIconRef(info.icon);
    return { root: resIconRoot(info.icon), name: info.icon };
}
