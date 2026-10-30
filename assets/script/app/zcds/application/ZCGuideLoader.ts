import { SpriteFrame } from 'cc';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import { ZCDC_LOG_WARNINGS } from '../ZCDCLogSwitch';
import {
    getGuideIconPath,
    parseGuideEntries,
    parseGuideParams,
} from '../model/ZCGuideConfig';
import type { ZCGuideEntry, ZCGuideParams } from '../model/ZCGuideConfig';

/** 对局流程预加载后交给指南弹窗的只读展示数据。 */
export interface ZCGuidePreparedContent {
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

    async prepare(scope?: ResourceScope): Promise<ZCGuidePreparedContent> {
        const [entryRows, paramRows] = await Promise.all([
            this.resources.configs.getTable('zcGuide'),
            this.resources.configs.getTable('zcGuideParams'),
        ]);
        this.checkActive(scope);
        const entries = parseGuideEntries(entryRows);
        const iconFrames = await this.loadIconFrames(entries, scope);
        this.checkActive(scope);
        return { entries, params: parseGuideParams(paramRows), iconFrames };
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
            try {
                frames.set(key, await this.resources.assets.load(path, SpriteFrame, { scope }));
            } catch (error) {
                if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGuideLoader] 指南图标加载失败：${key} → ${path}`, error);
            }
        }));
        return frames;
    }

    private checkActive(scope?: ResourceScope): void {
        if (scope?.disposed) throw new Error('指南预加载已取消');
    }
}
