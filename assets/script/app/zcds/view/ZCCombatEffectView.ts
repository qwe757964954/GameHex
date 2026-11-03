import { _decorator, Animation, Color, Component, Graphics, instantiate, Node, Prefab, Sprite, UITransform, Vec3 } from 'cc';
import { ZCCombatEvent, ZCProjectileState } from '../model/ZCGameModel';
import { mapToViewX, mapToViewY } from './ZCGameViewUtil';
import { zcCombatEffectAnchorOf, zcCombatEffectAnchorPoint } from './ZCCombatEffectPlacement';
import { zcCombatEffectFlightOf, zcCombatEffectFacingDegrees, zcCombatEffectHeadingDegrees } from '../model/ZCCombatEffectFlight';
import { zcBeamCoreWidthOf, zcBeamFrame, zcBeamSpecOf, zcBeamStretchOf, zcBeamWidthScaleOf } from './ZCBeamEffect';
import type { IZCBeamSpec } from './ZCBeamEffect';

const { ccclass, property } = _decorator;
const GENERIC_LINE_WIDTH = 3;
const GENERIC_TRAIL_START_X = -14;
const GENERIC_TRAIL_END_X = 4;
const GENERIC_RING_RADIUS = 8;
const GENERIC_RING_GROWTH = 14;
const GENERIC_FADE_RATIO = 0.7;
/** 光束兜底线的颜色：偏青白的激光色，与镭射飞龙那根光束同色系。 */
const BEAM_FALLBACK_COLOR = new Color(150, 240, 255);

/** 技能表现优先使用专属 Prefab；渐进加载局在它尚未就绪时使用短暂通用表现。 */
@ccclass('ZCCombatEffectView')
export class ZCCombatEffectView extends Component {
    @property({ type: Node })
    spriteNode: Node | null = null;

    @property({ type: Sprite })
    sprite: Sprite | null = null;

    @property({ type: UITransform })
    spriteTransform: UITransform | null = null;

    @property({ type: Graphics })
    graphics: Graphics | null = null;

    private visualNode: Node | null = null;
    private visualPrefab: Prefab | null = null;
    private renderedEventId = -1;
    private allowGeneric = false;
    /** 光束类特效的配置（镭射飞龙）；`null` = 走原来的「移动小图」弹道。 */
    private beamSpec: IZCBeamSpec | null = null;
    /** 光束预制体的画布宽度（视图单位）；`scaleX = 长度 / 它`。 */
    private beamCanvasWidth = 0;
    /** 光束预制体根节点的原始 y 缩放，用来叠 `widthScale`（不被逐帧的宽度覆盖掉）。 */
    private beamBaseScaleY = 1;
    private readonly genericTint = new Color(255, 229, 148);

    initialize(prefab: Prefab | null, allowGeneric = false, effectPrefabPath?: string | null): void {
        this.allowGeneric = allowGeneric && !prefab;
        this.graphics.clear();
        this.renderedEventId = -1;
        this.node.setRotationFromEuler(0, 0, 0);
        if (this.visualPrefab !== prefab || !this.visualNode?.isValid) {
            this.visualNode?.destroy();
            this.visualNode = null;
        }
        this.visualPrefab = prefab;
        //  🔴 光束配置必须在 `if (!prefab) return` **之前**认出来：美术没加载时也要知道
        //  「这是一条光束」，才能在 `render` 里画兜底线。放在后面的话 `beamSpec` 恒为 null，
        //  于是掉回通用弹道 —— 而 `allowGenericEffects=false` 的关卡里通用弹道也不画，
        //  整条光束凭空消失且不报错（2026-11-02 用户截图）。
        this.beamSpec = zcBeamSpecOf(effectPrefabPath);
        this.beamCanvasWidth = 0;
        this.beamBaseScaleY = 1;
        if (!prefab) return;
        const visual = this.visualNode ?? instantiate(prefab);
        visual.setParent(this.node);
        // 根节点位置**不清零**：老客户端把特效的摆位偏移压在 prefab 的 `position` 层，转 prefab 时
        // 只带回了 scale/rotZ，那份偏移只能落在根节点的 `_lpos` 上（见
        // outputs/技能特效摆位取证_20260921.md）。清零会把它抹掉 → 特效下陷/悬空。
        // 世界定位仍由宿主 this.node 承担（见 render()），这里只管「相对宿主的摆位」。
        visual.layer = this.node.layer;
        this.visualNode = visual;
        if (this.beamSpec) {
            // 光束预制体的锚点在**左端**（发射口），所以 `scaleX` 只拉长不两头长；
            // 画布宽度取 UITransform 的 contentSize，根节点自身缩放折算进 `beamBaseScaleY`。
            this.beamCanvasWidth = visual.getComponent(UITransform)?.contentSize.width ?? 0;
            this.beamBaseScaleY = visual.scale.y || 1;
        }
        const animation = visual.getComponent(Animation) ?? visual.getComponentInChildren(Animation);
        const clipName = animation?.defaultClip?.name || animation?.clips?.[0]?.name;
        if (animation && clipName) { animation.stop(); animation.play(clipName); }
    }

    render(event: Readonly<ZCCombatEvent>, now: number, projectile?: Readonly<ZCProjectileState>, alpha = 1): void {
        const progress = Math.max(0, Math.min(1, (now - event.startedAt) / event.durationSeconds));
        const firstRender = this.renderedEventId !== event.id;
        if (firstRender) {
            this.renderedEventId = event.id;
            this.sprite.spriteFrame = null;
            this.sprite.enabled = false;
            this.spriteNode.setPosition(Vec3.ZERO);
            this.spriteNode.setScale(Vec3.ONE);
            this.spriteNode.setRotationFromEuler(0, 0, 0);
        }
        if (firstRender || event.type !== 'projectile' || this.allowGeneric) this.graphics.clear();
        if (!this.visualPrefab && this.allowGeneric) {
            this.genericTint.a = Math.round(255 * (1 - progress * GENERIC_FADE_RATIO));
            this.graphics.strokeColor = this.genericTint;
            this.graphics.lineWidth = GENERIC_LINE_WIDTH;
            if (event.type === 'projectile') {
                this.graphics.moveTo(GENERIC_TRAIL_START_X, 0);
                this.graphics.lineTo(GENERIC_TRAIL_END_X, 0);
            } else {
                this.graphics.circle(0, 0, GENERIC_RING_RADIUS + GENERIC_RING_GROWTH * progress);
            }
            this.graphics.stroke();
        }
        if (this.visualNode) this.visualNode.active = true;

        if (event.type === 'projectile') {
            //  弹头位置：有 `projectile` 时按上一个逻辑步插值，没有（已经命中、只剩事件）时按事件进度。
            const headX = projectile ? projectile.previousX + (projectile.x - projectile.previousX) * alpha : event.fromX + (event.toX - event.fromX) * progress;
            const headY = projectile ? projectile.previousY + (projectile.y - projectile.previousY) * alpha : event.fromY + (event.toY - event.fromY) * progress;
            //  光束（镭射飞龙）：不"飞"，而是从发射口一路连到弹头 —— 节点摆在发射口、转角对住弹道，
            //  `scaleX` 拉成"发射口→弹头"的长度。锚点在预制体左端，所以只有远端在长。
            if (this.beamSpec) {
                const frame = zcBeamFrame(
                    { x: mapToViewX(event.fromX), y: mapToViewY(event.fromY) },
                    { x: mapToViewX(headX), y: mapToViewY(headY) },
                    this.beamSpec,
                );
                this.node.setPosition(frame.x, frame.y, 0);
                this.node.setRotationFromEuler(0, 0, frame.angleDegrees);
                if (this.visualNode && this.beamCanvasWidth > 0) {
                    const stretch = zcBeamStretchOf(this.beamSpec, this.beamCanvasWidth, frame.length);
                    this.visualNode.setScale(
                        stretch.scaleX,
                        this.beamBaseScaleY * zcBeamWidthScaleOf(this.beamSpec, event.skillId),
                        1,
                    );
                    //  画布左侧那段留白（≈5% 宽）推到锚点外面，线条起点才真的落在发射口上。
                    this.visualNode.setPosition(stretch.offsetX, 0, 0);
                } else {
                    //  美术没加载（或缺 UITransform 算不出画布宽）时**必须**画一条兜底线：
                    //  这条分支原来会掉回「通用弹道」，而 `allowGenericEffects=false` 的关卡
                    //  里通用弹道也不画 ⇒ 整条光束凭空消失、一条错都不报（2026-11-02 用户截图）。
                    this.drawBeamFallback(frame.length, zcBeamCoreWidthOf(this.beamSpec, event.skillId));
                }
                return;
            }
            this.node.setPosition(mapToViewX(headX), mapToViewY(headY), 0);
            const angle = Math.atan2(mapToViewY(event.toY - event.fromY), mapToViewX(event.toX - event.fromX)) * 180 / Math.PI;
            this.node.setRotationFromEuler(0, 0, angle);
            return;
        }

        this.node.setPosition(mapToViewX(event.toX), mapToViewY(event.toY), 0);
        this.node.setRotationFromEuler(0, 0, 0);
        if (event.type === 'melee') {
            // ── 登记了飞行段的近战特效：像子弹一样从出手点飞向目标 ──
            //  需求 2026-11-02「猎头者的攻击特效需要匹配射程，特效改成像子弹一样飞向目标」。
            //  没有这一段时，月牙气刃会「凭空出现在锚点上播一次」，隔着半个屏幕打也看不出过程。
            //  时长由逻辑层按「距离 / 速度」给（`ZCCombatEffectFlight`），所以这里只用进度插值：
            //  进度走完 = 正好到目标，与命中视觉同拍。
            const flight = zcCombatEffectFlightOf(event.effectPrefabPath);
            if (flight) {
                const headX = event.fromX + (event.toX - event.fromX) * progress;
                const headY = event.fromY + (event.toY - event.fromY) * progress;
                this.node.setPosition(mapToViewX(headX), mapToViewY(headY), 0);
                //  转角 = 弹道方向 + 登记的朝向偏移（`facingOffsetDegrees`）。
                //  猎头者那条登记 90°：长轴**垂直**弹道，长轴的法线正好指着目标 —— 顺着弹道摆
                //  法线会甩向侧下方，看着像"斜着飘过去"（2026-11-02 用户口径）。
                //  与 projectile 分支同一套角度算式，两处不要各写一份。
                const angle = zcCombatEffectFacingDegrees(
                    Math.atan2(
                        mapToViewY(event.toY - event.fromY),
                        mapToViewX(event.toX - event.fromX),
                    ) * 180 / Math.PI,
                    flight,
                );
                this.node.setRotationFromEuler(0, 0, angle);
                return;
            }
            // 近战特效默认贴**出手点**（与 projectile 走 from→to 的口径不同）；
            // 个别特效改贴「攻击者 ↔ 受击目标」的连线中点，口径见 `ZCCombatEffectPlacement`
            // （需求 2026-10-30：巨力坚果普攻砸在两者中间，而不是砸在自己身上）。
            const anchor = zcCombatEffectAnchorOf(event.effectPrefabPath);
            const point = zcCombatEffectAnchorPoint(event, anchor);
            this.node.setPosition(mapToViewX(point.x), mapToViewY(point.y), 0);
        }
        // ── 朝向 ──
        //  需求 2026-11-02「运动霸技能特效没有朝向目标，现在的朝向是反的」。
        //  改前这里的转角恒 0 ⇒ 美术朝哪边就朝哪边：运动霸普攻那把朝右扇开的绿气刃，
        //  目标站左边时正好朝反、站上下时是「横着扫」。
        //  只有登记过朝向的特效才转身（`FACING_BY_PREFAB_PATH`），没登记的与改前逐字一致。
        //  飞行段那条分支自带偏移（`zcCombatEffectFacingDegrees`）且已经在上面 `return`，
        //  不会走到这里 —— 两处不要各写一份「转角 = 弹道 + 偏移」。
        const heading = zcCombatEffectHeadingDegrees(
            mapToViewX(event.toX - event.fromX),
            mapToViewY(event.toY - event.fromY),
            event.effectPrefabPath,
        );
        if (heading !== null) this.node.setRotationFromEuler(0, 0, heading);
    }

    /**
     * 光束美术缺失时的兜底线：沿局部 +X 从发射口画到弹头。
     *
     * `graphics` 对 projectile 事件只在**首帧**清一次（见 `render` 开头），
     * 所以这里必须自己清，否则每帧都会多压一条线上去。
     */
    private drawBeamFallback(length: number, width: number): void {
        this.graphics.clear();
        this.graphics.strokeColor = BEAM_FALLBACK_COLOR;
        this.graphics.lineWidth = width;
        this.graphics.moveTo(0, 0);
        this.graphics.lineTo(length, 0);
        this.graphics.stroke();
    }
}
