import { SpriteFrame } from 'cc';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import {
    getGuideIconPath,
    parseGuideEntries,
    parseGuideParams,
} from '../model/ZCGuideConfig';
import type { ZCGuideEntry, ZCGuideParams } from '../model/ZCGuideConfig';

/** 点击指南时加载后交给弹窗的只读展示数据。 */
export interface IZCGuidePreparedContent {
    readonly entries: readonly ZCGuideEntry[];
    readonly params: ZCGuideParams;
    readonly iconFrames: ReadonlyMap<string, SpriteFrame>;
}

/**
 * 指南的应用层加载器。配置和图标都归属当前对局 ResourceScope，Popup 只负责同步展示。
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
        const keys = Array.from(new Set(entries.map((entry) => entry.icon)))
            .filter((key) => getGuideIconPath(key) !== null);
        const frames = new Map<string, SpriteFrame>();
        await Promise.all(keys.map(async (key) => {
            const path = getGuideIconPath(key);
            if (!path) return;
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
