import { JsonAsset } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import { resolveBigMapLayout, type IBigMapLayout } from '../model/BigMapLayout';
import type { IBigMapConfig } from '../model/BigMapTypes';
import { completeBigMapCampLayout } from '../model/BigMapCampWorld';

/**
 * 大地图**布局文件**的加载器（唯一允许碰 `cc` 的布局入口）。
 *
 * 与 `TerritoryChapterLoader` 同一套口径：`AssetService` 加载、拿不到就返回 `null`，
 * 由调用方（`BigMapPresenter`）回退种子生成。**任何异常都不向外抛** —— 策划把图配错
 * 最多是「回到默认地图」，不能把大世界整个打不开。
 *
 * 路径约定：`config/bigmap-maps/world_<worldId 两位>`，与编辑器预设同名
 * （`tools/map-editor/presets/bigmap/world_01.json` → `assets/resources/config/bigmap-maps/world_01.json`）。
 * 不走配置表额外加列：多一列就多一处「导表漏填导致整图不见」的静默失效点。
 */
export const BIGMAP_LAYOUT_DIR = 'config/bigmap-maps';

export function bigMapLayoutPath(worldId: number): string {
    return `${BIGMAP_LAYOUT_DIR}/world_${String(worldId).padStart(2, '0')}`;
}

export async function loadBigMapLayout(
    assets: AssetService,
    config: IBigMapConfig,
): Promise<IBigMapLayout | null> {
    const path = bigMapLayoutPath(config.world.worldId);
    try {
        // `has` 先探一下：Cocos 对未进构建索引的路径抛的是
        // 「Bundle resources doesn't contain xxx」，很容易被当成「资源丢了」去查半天。
        if (!(await assets.has(path, JsonAsset))) {
            console.log(`[BigMap] 没有布局文件，按种子生成世界：${path}`);
            return null;
        }
        const asset = await assets.load(path, JsonAsset);
        const { layout, reason } = resolveBigMapLayout(asset.json, config);
        if (!layout) console.warn(`[BigMap] 布局不可用（${reason}），回退种子生成：${path}`);
        return layout ? completeBigMapCampLayout(config, layout) : null;
    } catch (error) {
        console.warn(`[BigMap] 布局加载失败，回退种子生成：${path}`, error);
        return null;
    }
}
