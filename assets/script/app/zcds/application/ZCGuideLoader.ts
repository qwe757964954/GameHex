import { SpriteFrame } from 'cc';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import {
    getGuideIconPath,
    parseGuideEntries,
    parseGuideParams,
    ZC_GUIDE_TABLE,
    ZC_GUIDE_PARAMS_TABLE,
    type IZCGuidePreparedContent,
    type ZCGuideEntry,
    type ZCGuideIconKey,
} from '../model/ZCGuideConfig';

export type { IZCGuidePreparedContent };

/**
 * 指南内容加载函数。
 * 纯粹的数据与资产加载器：读取配置并加载所需图标，图标归属传入的 ResourceScope。
 */
export async function loadZCGuide(
    resources: Pick<IControllerResources, 'assets' | 'configs'>,
    scope?: ResourceScope,
): Promise<IZCGuidePreparedContent> {
    const [entryRows, paramRows] = await Promise.all([
        resources.configs.getTable(ZC_GUIDE_TABLE),
        resources.configs.getTable(ZC_GUIDE_PARAMS_TABLE),
    ]);
    const entries = parseGuideEntries(entryRows);
    const iconFrames = await loadGuideIconFrames(resources, entries, scope);
    return { entries, params: parseGuideParams(paramRows), iconFrames };
}

async function loadGuideIconFrames(
    resources: Pick<IControllerResources, 'assets'>,
    entries: readonly ZCGuideEntry[],
    scope?: ResourceScope,
): Promise<ReadonlyMap<ZCGuideIconKey, SpriteFrame>> {
    const iconPaths = new Map<ZCGuideIconKey, string>();
    for (const entry of entries) {
        if (entry.icon === null) continue;
        const path = getGuideIconPath(entry.icon);
        if (path) iconPaths.set(entry.icon, path);
    }

    const frames = new Map<ZCGuideIconKey, SpriteFrame>();
    await Promise.all(Array.from(iconPaths, async ([key, path]) => {
        const frame = await resources.assets.load(path, SpriteFrame, { scope });
        if (frame) frames.set(key, frame);
    }));
    return frames;
}

/**
 * 指南加载器类包装。
 * 兼容现有面向对象调用及单测/装配 mock，内部委托纯函数 {@link loadZCGuide}。
 */
export class ZCGuideLoader {
    constructor(
        private readonly resources: Pick<IControllerResources, 'assets' | 'configs'>,
    ) {}

    prepare(scope?: ResourceScope): Promise<IZCGuidePreparedContent> {
        return loadZCGuide(this.resources, scope);
    }
}
