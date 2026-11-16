/**
 * 庆典的图片预加载器：刷新时把要用的图一次性 load 好，渲染期只查表。
 *
 * 渲染期不能现 load：`resources.load` 是异步的，`renderItem` 一 await 就会在滚动 / 刷新时把
 * 回调打到已回收的行上，表现为图错位、闪烁。所以固定图经本类预加载，奖励图标按 `resId` 按需加，
 * 命中就同步赋 `spriteFrame`。
 *
 * 加载走 `routedLoad`，不直接调 `resources.load`：庆典图有一部分在分包里，绕过路由会报
 * `Bundle resources doesn't contain …`（表现是静默留白）。
 *
 * `Map` 持有 `SpriteFrame` 不参与引擎引用计数：不 `addRef` 的话 refCount 停在 0，
 * `ReleaseManager` 会把它 destroy 掉，而 `Sprite._spriteFrame` 还指着它，
 * 下次标脏渲染会炸 `Simple.updateUVs: Cannot read properties of null`。
 * 所以加载成功即 `addRef`，`dispose()` 里逐个 `decRef`，由页面 `onClose` 调。
 */

import { SpriteFrame } from 'cc';
import { routedLoad } from '../common/RoutedResource';
import {
    celebrationNeededArtPaths,
    OS_TAB_ART_KEYS,
    osArtPath,
    osQualityFramePath,
    osSharedPath,
} from './CelebrationArt';
import { rewardIconRefOf, rewardQualityOf } from './CelebrationRepository';
import type { ICelebrationSnapshot } from './CelebrationRepository';

/** 加载失败只警告一次，避免每趟刷新刷屏。 */
const warnedPaths = new Set<string>();

export class CelebrationFrames {
    private readonly _frames = new Map<string, SpriteFrame | null>();
    private readonly _pending = new Map<string, Promise<SpriteFrame | null>>();
    private _disposed = false;

    /** 页签图标 + 本次快照会用到的奖励图标 / 品质框，一次加载完。 */
    preload(snapshot: ICelebrationSnapshot, extraKeys: readonly string[] = OS_TAB_ART_KEYS): Promise<void> {
        const paths: string[] = [];
        for (const key of extraKeys) {
            const path = osArtPath(key);
            if (path) paths.push(path);
        }
        paths.push(...celebrationNeededArtPaths(snapshot));
        return Promise.all(paths.map((p) => this.loadFrame(p))).then(() => undefined);
    }

    /** 单图，按装配路径（已带 `/spriteFrame`）加；加载过（含失败）就直接给缓存结果。 */
    loadFrame(path: string): Promise<SpriteFrame | null> {
        if (!path) return Promise.resolve(null);
        if (this._frames.has(path)) return Promise.resolve(this._frames.get(path));
        const pending = this._pending.get(path);
        if (pending) return pending;

        const task = new Promise<SpriteFrame | null>((resolve) => {
            routedLoad(path, SpriteFrame, (error, frame) => {
                if (error) {
                    if (!warnedPaths.has(path)) {
                        warnedPaths.add(path);
                        console.warn(`[Celebration] 加载 SpriteFrame 失败：${path}`, error);
                    }
                    this._pending.delete(path);
                    this._frames.set(path, null);
                    resolve(null);
                    return;
                }
                frame.addRef();
                if (this._disposed) {
                    // 等待期间被关闭：补一次 decRef，避免漏引用。
                    frame.decRef();
                    resolve(null);
                    return;
                }
                this._pending.delete(path);
                this._frames.set(path, frame);
                resolve(frame);
            });
        });
        this._pending.set(path, task);
        return task;
    }

    /** 同步取已加载的图；没加载好返回 `null`（调用方降级成只画品质框）。 */
    frameOf(path: string): SpriteFrame | null {
        return this._frames.get(path);
    }

    /** 奖励图标（`resId` → `SpriteFrame`）；查不到 / 没加载好返回 `null`。 */
    iconOf(snapshot: ICelebrationSnapshot, resId: number): SpriteFrame | null {
        const ref = rewardIconRefOf(snapshot, resId);
        return ref ? this.frameOf(osSharedPath(ref)) : null;
    }

    /** 奖励品质框（`resId` → `SpriteFrame`）；查不到按 1 档。 */
    qualityOf(snapshot: ICelebrationSnapshot, resId: number): SpriteFrame | null {
        return this.frameOf(osQualityFramePath(rewardQualityOf(snapshot, resId)));
    }

    /** 释放所有引用。页面 `onClose` 里调；重复调用安全。 */
    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        for (const frame of this._frames.values()) {
            if (frame && frame.isValid) frame.decRef();
        }
        this._frames.clear();
        this._pending.clear();
    }
}
