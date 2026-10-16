import { _decorator, Color, Component, Sprite, SpriteFrame, Tween, tween, Vec3 } from 'cc';
import { GoodsBox } from '../itemdetail/GoodsBox';
import { FGUI_FPS, SR_STAR_TRACKS } from './ShowRewardTable';

const { ccclass, property } = _decorator;

/** 帧 → 秒（FGUI transition 单位是帧，帧率 60）。 */
const sec = (frames: number): number => frames / FGUI_FPS;

/**
 * 一个奖励格（FGUI `列表_奖励列表Item`，100×100）：GoodsBox + 闪光 Glow + 5 星点。
 * 节点 active 恒 true：挂脚本的节点 inactive 时 onLoad 不跑、会静默不显示，显隐交给 Grid。
 *
 * 出现动画（老端 t0，18 帧 ≈ 0.3s）：0 帧 scale 0.2、闪光全亮、星点 scale 0；
 * 5 帧放大、星点飞散、闪光淡出；10 帧星点缩回。
 * 槽位会被复用，每格只播一次（账本在 Page 的 playedAni），铺新数据前先 resetAppear。
 */
@ccclass('ShowRewardItem')
export class ShowRewardItem extends Component {
    @property({ type: GoodsBox, tooltip: 'Goods：物品框（品质框 / 图标 / 数量），FGUI 的 com_goods' })
    goods: GoodsBox = null!;

    @property({ type: Sprite, tooltip: 'Glow：闪光（FGUI n1），入场时 alpha 1→0 淡出' })
    glow: Sprite = null!;

    @property({ type: [Sprite], tooltip: 'Stars：5 个星点（FGUI n2~n6，按顺序传入，与 SR_STAR_TRACKS 对应）' })
    stars: Sprite[] = [];

    /** 当前承载的数据下标（`-1` = 未绑定）；动画回调靠它核身份，错峰期间槽位可能已被复用。 */
    dataIndex = -1;

    /** 动画代号：槽位复用时自增，上一轮排队的回调比对不上即放弃，避免把旧轨迹画到新格。 */
    private animRevision = 0;

    // ============================================================
    // 铺数据
    // ============================================================

    /**
     * 铺一个奖励。参数无条件写：复用槽位条件式赋值会在图加载失败时残留上一格品质颜色。
     * @param qualityFrame 品质框（`null` = 用 prefab 静态帧）
     * @param iconFrame    道具图标（`null` = 整块隐藏，不画问号）
     * @param numberText   数量文案（空串不显示）
     * @param showNumber   是否显示数量
     */
    render(
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
        numberText: string,
        showNumber: boolean,
    ): void {
        this.goods?.render(qualityFrame, iconFrame, numberText, showNumber);
    }

    // ============================================================
    // 出现动画
    // ============================================================

    /**
     * 复位到动画未播态：停动画、scale 0.2、闪光全亮、星点归位。
     * 星点用 scale 0 隐藏、不用 active=false：inactive 节点首次起 tween 会被
     * ActionManager 置 paused，而激活动作写在同一 tween 的 call 里 ⇒ 死锁。
     */
    resetAppear(): void {
        this.stopAnim();
        this.node.setScale(0.2, 0.2, 1);

        if (this.glow) {
            this.glow.node.active = true;
            this.setAlpha(this.glow, 1);
        }

        for (let i = 0; i < this.stars.length; i += 1) {
            const star = this.stars[i];
            if (!star) continue;
            star.node.active = true;
            star.node.setScale(0, 0, 1);
            const track = SR_STAR_TRACKS[i];
            if (track) star.node.setPosition(track.from[0], track.from[1], 0);
        }
    }

    /** 播一次出现动画（同一格只播一次，见类注释）。 */
    appear(): void {
        this.resetAppear();
        const rev = this.animRevision;

        // ① 品质格：0.2 → 1，5 帧
        tween(this.node).to(sec(5), { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();

        // ② 闪光：t=5 起 7 帧内淡到 0。
        // 🔴 target 必须是 Node、不能是裸量对象：裸量没有 NODE_DESTROYED 停机时机，
        //    弹窗销毁后补间仍跑，glow 被置 null 后回调抛错并打断整轮 update。
        if (this.glow) {
            const color = new Color(this.glow.color);
            tween(this.glow.node)
                .delay(sec(5))
                .to(sec(7), {}, {
                    onUpdate: (_target, ratio) => {
                        if (rev !== this.animRevision) return;
                        color.a = Math.round(255 * (1 - ratio));
                        this.glow.color = color;
                    },
                })
                .start();
        }

        // ③ 星点：t=5 出现放大（5 帧）+ 飞散（13 帧），t=10 起 8 帧缩回（节点须保持 active，见 resetAppear）。
        for (let i = 0; i < this.stars.length; i += 1) {
            const star = this.stars[i];
            const track = SR_STAR_TRACKS[i];
            if (!star || !track) continue;
            const node = star.node;

            node.setPosition(track.mid[0], track.mid[1], 0);
            node.setScale(0, 0, 1);

            tween(node)
                .delay(sec(5))
                .call(() => {
                    if (rev === this.animRevision) node.active = true;
                })
                .to(sec(5), { scale: new Vec3(1, 1, 1) })
                .start();

            tween(node)
                .delay(sec(5))
                .to(sec(13), { position: new Vec3(track.to[0], track.to[1], 0) })
                .start();

            tween(node)
                .delay(sec(10))
                .to(sec(8), { scale: new Vec3(0, 0, 1) })
                .call(() => {
                    if (rev === this.animRevision) node.active = false;
                })
                .start();
        }
    }

    /** 停掉本格所有补间并作废其回调（下次 appear 才重新生效）。 */
    stopAnim(): void {
        this.animRevision += 1;
        Tween.stopAllByTarget(this.node);
        // 闪光补间以 glow 节点为 target（见 appear），不在上一条里。
        if (this.glow) Tween.stopAllByTarget(this.glow.node);
        for (const star of this.stars) {
            if (star) Tween.stopAllByTarget(star.node);
        }
    }

    // ============================================================
    // 只读状态（探针 / 单测用）
    // ============================================================

    /** 数量文案（探针判有没有铺上数据）。 */
    get numberText(): string {
        return this.goods?.num?.string ?? '';
    }

    /** 品质框 uuid（探针对比两格是否不同图）。 */
    get qualityUuid(): string {
        return this.goods?.frame?.spriteFrame?._uuid ?? '';
    }

    /** 道具图 uuid。 */
    get iconUuid(): string {
        return this.goods?.icon?.spriteFrame?._uuid ?? '';
    }

    private setAlpha(sprite: Sprite, alpha: number): void {
        const color = new Color(sprite.color);
        color.a = Math.round(255 * Math.max(0, Math.min(1, alpha)));
        sprite.color = color;
    }
}
