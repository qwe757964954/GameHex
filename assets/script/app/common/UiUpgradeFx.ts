import { instantiate, Node, Prefab, sp, UITransform } from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import {
    UI_UPGRADE_FX_PREFAB,
    UI_UPGRADE_FX_SECONDS,
    type UiUpgradeAnimation,
} from './UiUpgradeFxTable';

/**
 * UI「升级 / 升阶 / 升星」字特效的通用播放器（2026-11-26）。
 *
 * ## 为什么单独抽一份
 *
 * 素材只有一个：`skel/UI升级升星升阶特效字/shengduan`，一个 `.skel` 里三条动画
 * （`shengji` 升级 / `shengjie` 升阶 / `shengxing` 升星，各 1.07s）。预制
 * `ui/territory/TerritoryMonsterBoxUpgradeFx` 是它的单节点 `sp.Skeleton` 壳子。
 *
 * 巡逻宝箱那套（`TerritoryMonsterBoxPanel.ensureUpgradeFx` 等）已经在跑，且被
 * `tests/territory-monster-box-upgrade-fx.test.ts` 按源码钉死，**不动它**；本文件是给
 * 「装备升级 / 装备强化」这类新入口复用的同一份口径 —— 路径、动画名与时长只在
 * {@link UiUpgradeFxTable} 里写一遍。
 *
 * ## 三条纪律（错了都不报错，只是「看着不太对」）
 *
 * 1. **播一次**：`setAnimation(0, 动画名, false)`，末位是 `loop`；
 * 2. **播完收起来**：`loop = false` 的骨架停在最后一帧，不收就一直糊在屏幕中间
 *    ⇒ 由 {@link UiUpgradeFx.step} 到点置 `active = false`；
 * 3. **屏正中 + 置顶**：挂在调用方给的宿主节点（弹窗根节点，720×1280 全屏层）的
 *    内容矩形中心，排到兄弟最后才压得住 `Dim` / `Panel`。
 *
 * 资源归属调用方：`prefab` 与节点都在传入的 {@link AssetService} 作用域里，
 * 关面板 / 换作用域必须调 {@link UiUpgradeFx.reset}（否则下一次打开贴的是已释放的骨骼）。
 */

export class UiUpgradeFx {
    private prefab: Prefab | null = null;
    private loaded = false;
    private node: Node | null = null;
    /** 该收起来的时刻（`performance.now()` 毫秒）；`0` = 没在演。 */
    private hideAt = 0;

    /**
     * 预制还没到就先记下「要播哪一条」，加载完补播。
     *
     * 不记的话，首次打开点得快一点就是「升级成功了，但屏上什么都没有」——
     * 这类静默缺失正是这个播放器要避免的。
     */
    private pending: UiUpgradeAnimation | null = null;

    /** @param host 字特效的宿主（弹窗根节点），节点挂上去后排在兄弟最后。 */
    constructor(private readonly host: Node) { }

    /** 是否正在演（调用方据此决定按钮能不能点）。 */
    public get playing(): boolean {
        return this.hideAt > 0;
    }

    /**
     * 拉预制：一次，失败只少一场演出。
     *
     * 与首帧并行发起（调用方在 `onOpen` 里调），这样玩家点按钮时预制早就到了。
     */
    public load(assets: AssetService): void {
        if (this.loaded) return;
        this.loaded = true;
        assets.load(UI_UPGRADE_FX_PREFAB, Prefab)
            .then((prefab) => {
                this.prefab = prefab?.isValid ? prefab : null;
                const pending = this.pending;
                this.pending = null;
                if (pending && this.prefab) this.play(pending);
            })
            .catch((error: unknown) => {
                // 出声：静默吞掉会变成「特效时好时坏、零报错」
                console.warn('[UiUpgradeFx] 字特效预制加载失败，跳过特效', error);
            });
    }

    /**
     * 起播一次。
     *
     * @returns 是否真的起播（`false` ⇒ 资源没到 / 宿主已失效 / 预制缺 `sp.Skeleton`；
     *          「资源没到」这一支会记住动画名，{@link load} 完成时补播一次）
     */
    public play(animation: UiUpgradeAnimation): boolean {
        const node = this.ensureNode();
        if (!node) {
            this.pending = animation;
            return false;
        }
        const skeleton = node.getComponent(sp.Skeleton);
        if (!skeleton) {
            // 预制做错了（少了 sp.Skeleton）：重试也不会变好，报一次就够
            console.warn('[UiUpgradeFx] 字特效预制缺少 sp.Skeleton，跳过特效');
            return false;
        }
        node.active = true;
        try {
            // 同一条轨道上重设即从头播（`setAnimation` 替换 track 0），不用先 stop；
            // 末位 `false` = 不循环，就是「播放 1 次」。
            skeleton.setAnimation(0, animation, false);
            this.hideAt = performance.now() + UI_UPGRADE_FX_SECONDS * 1000;
            return true;
        } catch (error) {
            console.warn('[UiUpgradeFx] 字特效播放失败', error);
            node.active = false;
            this.hideAt = 0;
            return false;
        }
    }

    /** 逐帧调用（挂在宿主的 `update` 里）：到点把字收起来。 */
    public step(): void {
        if (this.hideAt <= 0) return;
        if (performance.now() < this.hideAt) return;
        this.hideAt = 0;
        if (this.node && this.node.isValid && this.node.active) this.node.active = false;
    }

    /** 关面板 / 换资源作用域：停演 + 销毁节点 + 丢预制，下一次打开重新拉。 */
    public reset(): void {
        this.hideAt = 0;
        this.pending = null;
        if (this.node && this.node.isValid) this.node.destroy();
        this.node = null;
        this.prefab = null;
        this.loaded = false;
    }

    /**
     * 建/复用节点。
     *
     * 位置按宿主内容矩形反算（宿主锚点不一定是 0.5，硬写 `(0,0)` 只对「720×1280 居中」
     * 那种弹窗成立）；排到兄弟最后 = 压在遮罩与面板之上。
     */
    private ensureNode(): Node | null {
        const host = this.host;
        if (!host || !host.isValid) return null;
        let node = this.node;
        if (node && node.isValid && node.parent === host) {
            node.setSiblingIndex(host.children.length - 1);
            return node;
        }
        if (node && node.isValid) node.destroy();
        this.node = null;
        const prefab = this.prefab;
        if (!prefab) return null;
        try {
            node = instantiate(prefab);
            host.addChild(node);
            const transform = host.getComponent(UITransform);
            const centerX = transform ? transform.width * (0.5 - transform.anchorX) : 0;
            const centerY = transform ? transform.height * (0.5 - transform.anchorY) : 0;
            node.setPosition(centerX, centerY, 0);
            // 先以「不播」的状态挂好，起播时再点亮 ⇒ 不会出现「挂上去就停在第一帧」
            node.active = false;
            this.node = node;
            return node;
        } catch (error) {
            console.warn('[UiUpgradeFx] 字特效实例化失败，跳过特效', error);
            return null;
        }
    }
}
