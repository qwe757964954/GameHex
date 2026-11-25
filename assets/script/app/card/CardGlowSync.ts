import { _decorator, Component, sp } from 'cc';

const { ccclass } = _decorator;

/**
 * 剪影允许的最大播放头偏差（秒）。超过就硬拽回本体那一拍。
 *
 * 为什么需要「每帧看一次」而不是建副本时对齐一次就够（2026-11-25 用户：
 * 「因为角色是有动作的，叠加的白色会歪，可以跟随动作同步」）：副本与本体是两个独立的
 * `sp.Skeleton`，各自推进 `trackTime`。只要两边的 `timeScale` 被谁改过一点、或者中途换了
 * 动画，剪影就会持续脱离本体 —— 叠在角色上就是一块飘在脸侧的白斑。
 * 阈值取 1/30 秒：常态两边本来就在同一拍，不写入（`trackTime` 赋值会重算骨骼）；
 * 真漂了才纠，纠完立刻回到「零成本跟随」。
 */
const GLOW_MAX_DRIFT = 1 / 30;

/**
 * 发光副本的动画跟随器：每帧把本体骨架的播放头抄过来。
 *
 * 放在副本自己的 `spine` 节点上而不是由页面驱动 —— 页面的 `update` 可能被别处提前 `return`
 * （升级演出是按帧推进的），挂在节点上的 `lateUpdate` 不依赖任何外部调用方。
 */
@ccclass('CardGlowSync')
export class CardGlowSync extends Component {
    private main: sp.Skeleton | null = null;
    private self: sp.Skeleton | null = null;

    bind(main: sp.Skeleton | null): void {
        this.main = main;
        this.self = this.node.getComponent(sp.Skeleton);
    }

    protected lateUpdate(): void {
        const main = this.main;
        const self = this.self;
        if (!main || !main.isValid || !self || !self.isValid) return;
        if (self.timeScale !== main.timeScale) self.timeScale = main.timeScale;
        const mainEntry = main.getCurrent(0);
        const selfEntry = self.getCurrent(0);
        if (!mainEntry || !selfEntry) return;
        // 本体换了动画（比如待机被打断）⇒ 副本整段重来，不能只补时间
        const wantName = mainEntry.animation?.name ?? '';
        if ((selfEntry.animation?.name ?? '') !== wantName) {
            self.setAnimation(0, wantName, !!mainEntry.loop);
            const restarted = self.getCurrent(0);
            if (restarted) restarted.trackTime = mainEntry.trackTime;
            return;
        }
        if (Math.abs(selfEntry.trackTime - mainEntry.trackTime) > GLOW_MAX_DRIFT) {
            selfEntry.trackTime = mainEntry.trackTime;
        }
    }
}
