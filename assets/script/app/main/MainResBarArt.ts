/**
 * 资源栏**货币图标**加载器，带模块级缓存。
 * 缓存键带根目录防串图；frame 必须 addRef（模块 Map 不参与引用计数）。不 reject。
 *
 * ⚠️ 默认根目录 = `ResTypes.resIconRoot(name)` —— 即 `icons/resource`（货币真源
 * `roleProperty.icon`），**少数例外查 `ROLE_PROPERTY_ICON_ROOT_OVERRIDE`**
 * （`图标_经验值` 在 `image/main/resbar`）。与既有唯一入口
 * `LayerActivityArt.resolveRewardIconRef` 的 `roleProperty` 支**同口径**。
 * 货币图标全工程只有一份，别再往 `image/main/resbar/` 拷第二份。
 */
import { resources, SpriteFrame } from 'cc';
import { artKey, spriteFramePath } from '../ArtPaths';
import { resIconRoot } from '../common/ResTypes';

const resBarCache = new Map<string, SpriteFrame>();

export function loadResBarSprite(
    name: string,
    root: string = resIconRoot(name),
): Promise<SpriteFrame | null> {
    if (!name || !root) return Promise.resolve(null);
    const key = artKey(root, name);
    const cached = resBarCache.get(key);
    if (cached) return Promise.resolve(cached);
    return new Promise<SpriteFrame | null>((resolve) => {
        resources.load(spriteFramePath(root, name), SpriteFrame, (error, frame) => {
            if (error || !frame) {
                console.warn(`[MainResBarArt] 资源栏图加载失败：${key}`, error);
                resolve(null);
                return;
            }
            frame.addRef();
            resBarCache.set(key, frame);
            resolve(frame);
        });
    });
}
