import { SpriteFrame } from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import type { ResourceScope } from '../../core/asset/ResourceScope';
import { bundleForPath } from '../../core/asset/BundleCatalog';
import { spriteFramePathOf } from '../ArtPaths';
import { routedLoad } from './RoutedResource';

export type ISpriteFrameSource = (path: string) => Promise<SpriteFrame | null>;
export type IIconLoader = (name: string, root: string) => Promise<SpriteFrame | null>;

/** 每个宿主独立持有缓存；传入 scope 时资源引用由 AssetService 管理。 */
export class SpriteFrameCache {
    private readonly frames = new Map<string, SpriteFrame>();
    private readonly pending = new Map<string, Promise<SpriteFrame | null>>();
    private revision = 0;

    constructor(
        private readonly source: ISpriteFrameSource,
        private readonly label = 'SpriteFrameCache',
        private readonly scope?: ResourceScope,
    ) {
        scope?.defer(() => this.clear());
    }

    /** 裸图路径与已带 /spriteFrame 的路径共用缓存；失败不缓存。 */
    load(artPath: string): Promise<SpriteFrame | null> {
        if (!artPath || this.scope?.disposed) return Promise.resolve(null);
        const path = spriteFramePathOf(artPath);
        const cached = this.peek(path);
        if (cached) return Promise.resolve(cached);
        const pending = this.pending.get(path);
        if (pending) return pending;
        const revision = this.revision;
        const isCurrent = () => revision === this.revision && !this.scope?.disposed;
        const task = Promise.resolve()
            .then(() => isCurrent() ? this.source(path) : null)
            .then((frame) => {
                if (!isCurrent() || !frame?.isValid) return null;
                // JS Map 不参与 Cocos 引用计数；非作用域缓存必须自己持有引用。
                if (!this.scope) frame.addRef();
                this.frames.set(path, frame);
                return frame;
            })
            .catch((error: unknown) => {
                if (isCurrent()) console.warn(`[${this.label}] 图标加载失败：${path}`, error);
                return null;
            });
        this.pending.set(path, task);
        void task.then(() => {
            if (this.pending.get(path) === task) this.pending.delete(path);
        });
        return task;
    }

    loadNamed(name: string, root: string): Promise<SpriteFrame | null> {
        return name && root ? this.load(`${root}/${name}`) : Promise.resolve(null);
    }

    peek(artPath: string): SpriteFrame | null {
        if (!artPath || this.scope?.disposed) return null;
        const path = spriteFramePathOf(artPath);
        const frame = this.frames.get(path);
        if (frame?.isValid) return frame;
        this.frames.delete(path);
        return null;
    }

    /** 清理后可重新加载；旧请求不得回填或删除新请求。 */
    clear(): void {
        this.revision++;
        this.pending.clear();
        if (!this.scope) {
            for (const frame of this.frames.values()) {
                if (frame.isValid) frame.decRef();
            }
        }
        this.frames.clear();
    }
}

/** 流程/页面使用注入的资源服务，缓存与资源归同一个作用域。 */
export function createIconLoader(assets: AssetService, scope: ResourceScope): IIconLoader {
    const cache = new SpriteFrameCache(
        (path) => assets.load(path, SpriteFrame, { scope, bundle: bundleForPath(path) }),
        'IconLoader', scope,
    );
    return (name, root) => cache.loadNamed(name, root);
}

/** 既有静态美术入口的兼容适配；调用方保留原有 clear / 退出登录释放时机。 */
export function createRoutedSpriteFrameCache(label: string): SpriteFrameCache {
    return new SpriteFrameCache((path) => new Promise((resolve, reject) => {
        routedLoad(path, SpriteFrame, (error, frame) => {
            if (error) reject(error);
            else resolve(frame);
        });
    }), label);
}
