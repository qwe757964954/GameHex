import { SpriteFrame } from 'cc';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import {
    getGuideIconPath,
    parseGuideEntries,
    parseGuideParams,
} from '../model/ZCGuideConfig';
import type { ZCGuideEntry, ZCGuideParams } from '../model/ZCGuideConfig';

/** 点开指南后交给弹窗的只读数据。*/
export interface IZCGuidePreparedContent {
    readonly entries: readonly ZCGuideEntry[];
    readonly params: ZCGuideParams;
    readonly iconFrames: ReadonlyMap<string, SpriteFrame>;
}

/**
 * 指南加载器。配置和图标都挂在当前对局的 ResourceScope 上，弹窗只管同步展示。
*/
export class ZCGuideLoader {
    constructor(
        private readonly resources: Pick<IControllerResources, 'assets' | 'configs'>,
    ) {}

    async prepare(scope?: ResourceScope): Promise<IZCGuidePreparedContent> {
        this.checkActive(scope);
        try {
            const [entryRows, paramRows] = await Promise.all([
                this.resources.configs.getTable('zcGuide'),
                this.resources.configs.getTable('zcGuideParams'),
            ]);
            this.checkActive(scope);
            const entries = parseGuideEntries(entryRows);
            const iconFrames = await this.loadIconFrames(entries, scope);
            return { entries, params: parseGuideParams(paramRows), iconFrames };
        } finally {
            this.checkActive(scope);
        }
    }

    private async loadIconFrames(
        entries: readonly ZCGuideEntry[],
        scope?: ResourceScope,
    ): Promise<ReadonlyMap<string, SpriteFrame>> {
        const iconPaths = new Map<string, string>();
        for (const entry of entries) {
            const path = getGuideIconPath(entry.icon);
            if (path) iconPaths.set(entry.icon, path);
        }

        const frames = new Map<string, SpriteFrame>();
        await Promise.all(Array.from(iconPaths, async ([key, path]) => {
            const frame = await this.resources.assets.load(path, SpriteFrame, { scope });
            this.checkActive(scope);
            frames.set(key, frame);
        }));
        return frames;
    }

    private checkActive(scope?: ResourceScope): void {
        if (scope?.disposed) throw new Error('指南加载已取消');
    }
}
