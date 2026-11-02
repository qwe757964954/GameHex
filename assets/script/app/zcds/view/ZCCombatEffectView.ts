import { _decorator, Animation, Color, Component, Graphics, instantiate, Node, Prefab, Sprite, UITransform, Vec3 } from 'cc';
import { ZCCombatEvent, ZCProjectileState } from '../model/ZCGameModel';
import { mapToViewX, mapToViewY } from './ZCGameViewUtil';
import { zcCombatEffectAnchorOf, zcCombatEffectAnchorPoint } from './ZCCombatEffectPlacement';
import { zcBeamFrame, zcBeamSpecOf, zcBeamWidthScaleOf } from './ZCBeamEffect';
import type { IZCBeamSpec } from './ZCBeamEffect';

const { ccclass, property } = _decorator;
const GENERIC_LINE_WIDTH = 3;
const GENERIC_TRAIL_START_X = -14;
const GENERIC_TRAIL_END_X = 4;
const GENERIC_RING_RADIUS = 8;
const GENERIC_RING_GROWTH = 14;
const GENERIC_FADE_RATIO = 0.7;

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
        this.beamSpec = null;
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
        this.beamSpec = zcBeamSpecOf(effectPrefabPath);
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
            if (this.beamSpec && this.visualNode && this.beamCanvasWidth > 0) {
                const frame = zcBeamFrame(
                    { x: mapToViewX(event.fromX), y: mapToViewY(event.fromY) },
                    { x: mapToViewX(headX), y: mapToViewY(headY) },
                    this.beamSpec,
                );
                this.node.setPosition(frame.x, frame.y, 0);
                this.node.setRotationFromEuler(0, 0, frame.angleDegrees);
                this.visualNode.setScale(
                    frame.length / this.beamCanvasWidth,
                    this.beamBaseScaleY * zcBeamWidthScaleOf(this.beamSpec, event.skillId),
                    1,
                );
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
            // 近战特效默认贴**出手点**（与 projectile 走 from→to 的口径不同）；
            // 个别特效改贴「攻击者 ↔ 受击目标」的连线中点，口径见 `ZCCombatEffectPlacement`
            // （需求 2026-10-30：巨力坚果普攻砸在两者中间，而不是砸在自己身上）。
            const anchor = zcCombatEffectAnchorOf(event.effectPrefabPath);
            const point = zcCombatEffectAnchorPoint(event, anchor);
            this.node.setPosition(mapToViewX(point.x), mapToViewY(point.y), 0);
        }
    }
}
