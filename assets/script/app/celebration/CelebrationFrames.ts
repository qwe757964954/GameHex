/**
 * 庆典的图片预加载器 —— 「这次刷新要用到的图，一次load好，渲染期只查表」。
 *
 * ## 为什么必须有它（而不是渲染时 `resources.load`）
 *
 * `resources.load` 是**异步**的，而列表行是**虚拟列表 clone 复用**的：同一份节点会在几帧内
 * 先后表示不同的行。在渲染里现加载会出现
 *   ① 先闪一帧上一行的图（残影）；
 *   ② 第 1 行的图加载完落到已经复用成第 5 行的节点上 ⇒ **图串行**（谁先加载完谁赢）。
 * 两者都**不报错**。
 *
 * 所以约定（与 `hang` / `activity` / `gift` / `sevenDay` 同一条）：
 * **宿主先把整份快照要用的图 load 完，再把 `CelebrationFrames` 交给行组件**，行组件只做同步查表。
 *
 * ## 预加载集合的算法在 `CelebrationArt.celebrationNeededArtPaths`（可单测）
 *
 * 本类只负责「load + 缓存 + 查表」。集合怎么算、为什么是那四类，见那个函数的注释
 * （规则 60 的坑：货币图标不在 `rewards` 里）。
 *
 * ## ⚠️ 缓存必须 `addRef()`（规则 81）
 *
 * 模块级 / 长生命周期对象里的 `Map` 持有 `SpriteFrame` **不参与 Cocos 的引用计数**：
 * 不 `addRef` 的话 `refCount` 停在 0，引擎的 `ReleaseManager._freeAssets()` 会把它
 * `destroy()` 掉（`_destruct()` 把 `uv` 置 null），而 `Sprite._spriteFrame` 还指着它
 * ⇒ 下一次标脏渲染时炸 `Simple.updateUVs: Cannot read properties of null`。
 * 这个坑挂机那轮在 `HeadArt.loadHeadSprite` 上踩过一次（**只在重新渲染那一刻炸**，
 * 看着像别处的锅）。
 */

import { SpriteFrame } from 'cc';
import { routedLoad } from '../common/RoutedResource';
import { celebrationNeededArtPaths, osArtPath, OS_TAB_ART_KEYS, osQualityFramePath, osSharedPath } from './CelebrationArt';
import { goodsOf, rewardIconRefOf, rewardQualityOf } from './CelebrationRepository';
import type { ICelebrationSnapshot } from './CelebrationRepository';

/** `resources.load` 的结果缓存；`null` = 加载失败（别反复重试）。 */
export class CelebrationFrames {
    private readonly _frames = new Map<string, SpriteFrame | null>();

    /** 已经跑过集合的路径（避免同一批重复请求）。 */
    private readonly _requested = new Set<string>();

    /**
     * 按快照预加载。
     *
     * @param extraKeys 除了快照推出来的那些之外、**界面自己会换**的固定图 key
     *                  （`OS_ART_NAMES` 的键）。默认带上三个页签的 6 张图标 ——
     *                  它们在 prefab 里也会烘静态引用，这里是给「页面想用代码换页签态」兜底。
     */
    async preload(snapshot: ICelebrationSnapshot, extraKeys: readonly string[] = OS_TAB_ART_KEYS): Promise<void> {
        const paths = celebrationNeededArtPaths(snapshot, extraKeys);
        await Promise.all(paths.map((p) => this.loadFrame(p)));
    }

    /** 显式预加载一批装配路径（详情排行页那种「不在快照里」的场景用）。 */
    async preloadPaths(paths: readonly string[]): Promise<void> {
        await Promise.all(paths.map((p) => this.loadFrame(p)));
    }

    /**
     * load 一条装配路径（带缓存 + `addRef`）。
     *
     * ⚠️ `path` 必须是**装配路径**（带 `/spriteFrame`）—— 传裸路径会报
     *    `Bundle resources doesn't contain xxx`，且只是静默留白 + 一条 warn。
     */
    loadFrame(path: string): Promise<SpriteFrame | null> {
        if (!path) return Promise.resolve(null);
        if (this._frames.has(path)) return Promise.resolve(this._frames.get(path));
        this._requested.add(path);
        return new Promise((resolve) => {
            routedLoad(path, SpriteFrame, (error, frame) => {
                if (error || !frame) {
                    console.warn('[Celebration] 加载图失败', path, error);
                    this._frames.set(path, null);
                    resolve(null);
                    return;
                }
                // 🔴 必须 addRef（规则 81）—— 见文件头。
                frame.addRef();
                this._frames.set(path, frame);
                resolve(frame);
            });
        });
    }

    /** 查一条装配路径（没预加载过 / 加载失败 ⇒ `null`）。 */
    frameOf(path: string): SpriteFrame | null {
        return this._frames.get(path) ?? null;
    }

    /**
     * 查一个 `OS_ART_NAMES` 的 key（固定图）。
     *
     * ⚠️ 走包装的 `osArtPath`（内部过 `spriteFramePathOf`）；别在这里自己拼 `root + '/' + name`。
     */
    artOf(key: string): SpriteFrame | null {
        return this.frameOf(osArtPath(key));
    }

    /**
     * 一个奖励 `resId` 的图标帧。
     *
     * 🔴 **绝对赋值**语义（规则 10）：`resId <= 0` / 解析不出 / 没加载到，一律返回 `null`，
     * 由调用方把 `Sprite.spriteFrame` **写成 null 并隐藏节点** —— 绝不能
     * 「`null` 就留着上一趟的图」。
     */
    iconOf(snapshot: ICelebrationSnapshot, resId: number): SpriteFrame | null {
        if (resId <= 0) return null;
        const goods = goodsOf(snapshot, resId);
        if (!goods || !goods.icon) return null;
        const ref = rewardIconRefOf(snapshot, resId);
        return ref ? this.frameOf(osSharedPath(ref)) : null;
    }

    /**
     * 一个奖励 `resId` 的品质框帧。
     *
     * ⚠️ 查不到 `quality` 时按 **1**（与 `rewardQualityOf` 同一兜底）——
     * 返回 `null` 会让框整个消失（看着像"图丢了"），而 1 档框至少是个正常框。
     */
    qualityOf(snapshot: ICelebrationSnapshot, resId: number): SpriteFrame | null {
        return this.frameOf(osQualityFramePath(rewardQualityOf(snapshot, resId)));
    }

    /** 测试 / 重载用：清空缓存（**先 decRef 再清**，与 `addRef` 对称）。 */
    dispose(): void {
        for (const frame of this._frames.values()) {
            if (frame && frame.isValid) frame.decRef();
        }
        this._frames.clear();
        this._requested.clear();
    }

    /** 已缓存条数（探针 / 单测用）。 */
    get size(): number {
        return this._frames.size;
    }

    /** 已请求过的路径（探针用来断言「预加载集合」对不对，含加载失败的）。 */
    get requestedPaths(): readonly string[] {
        return [...this._requested];
    }
}
