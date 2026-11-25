import { _decorator, Component, sp } from 'cc';

const { ccclass } = _decorator;

/** 两个骨架独立推进，播放头相差超过一帧时才校正。 */
const GLOW_MAX_DRIFT = 1 / 30;

@ccclass('CardGlowSync')
export class CardGlowSync extends Component {
    private main: sp.Skeleton = null!;
    private copy: sp.Skeleton = null!;
    private idleAnimation: string = null!;

    bind(main: sp.Skeleton, idleAnimation: string): void {
        this.main = main;
        this.copy = this.getComponent(sp.Skeleton);
        this.idleAnimation = idleAnimation;
        this.syncAnimation();
    }

    protected lateUpdate(): void {
        this.syncAnimation();
    }

    private syncAnimation(): void {
        const main = this.main;
        const copy = this.copy;
        if (copy.timeScale !== main.timeScale) copy.timeScale = main.timeScale;
        const mainEntry = main.getCurrent(0);
        const name = mainEntry?.animation?.name || this.idleAnimation;
        const loop = mainEntry?.loop ?? true;
        const copyEntry = copy.getCurrent(0);
        if (!copyEntry || copyEntry.animation?.name !== name || copyEntry.loop !== loop) {
            const entry = copy.setAnimation(0, name, loop);
            if (entry && mainEntry) entry.trackTime = mainEntry.trackTime;
            return;
        }
        if (mainEntry && Math.abs(copyEntry.trackTime - mainEntry.trackTime) > GLOW_MAX_DRIFT) {
            copyEntry.trackTime = mainEntry.trackTime;
        }
    }
}
