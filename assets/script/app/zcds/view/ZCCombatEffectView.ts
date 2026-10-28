import { _decorator, Animation, Color, Component, Graphics, instantiate, Node, Prefab, Sprite, UITransform, Vec3 } from 'cc';
import { ZCCombatEvent, ZCProjectileState } from '../model/ZCGameModel';
import { mapToViewX, mapToViewY } from './ZCGameViewUtil';

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
    private readonly genericTint = new Color(255, 229, 148);

    initialize(prefab: Prefab | null, allowGeneric = false): void {
        this.allowGeneric = allowGeneric && !prefab;
        this.graphics.clear();
        this.renderedEventId = -1;
        this.node.setRotationFromEuler(0, 0, 0);
        if (this.visualPrefab !== prefab || !this.visualNode?.isValid) {
            this.visualNode?.destroy();
            this.visualNode = null;
        }
        this.visualPrefab = prefab;
        if (!prefab) return;
        const visual = this.visualNode ?? instantiate(prefab);
        visual.setParent(this.node);
        // 根节点位置**不清零**：老客户端把特效的摆位偏移压在 prefab 的 `position` 层，转 prefab 时
        // 只带回了 scale/rotZ，那份偏移只能落在根节点的 `_lpos` 上（见
        // outputs/技能特效摆位取证_20260921.md）。清零会把它抹掉 → 特效下陷/悬空。
        // 世界定位仍由宿主 this.node 承担（见 render()），这里只管「相对宿主的摆位」。
        visual.layer = this.node.layer;
        this.visualNode = visual;
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
            const x = mapToViewX(projectile ? projectile.previousX + (projectile.x - projectile.previousX) * alpha : event.fromX + (event.toX - event.fromX) * progress);
            const y = mapToViewY(projectile ? projectile.previousY + (projectile.y - projectile.previousY) * alpha : event.fromY + (event.toY - event.fromY) * progress);
            this.node.setPosition(x, y, 0);
            const angle = Math.atan2(mapToViewY(event.toY - event.fromY), mapToViewX(event.toX - event.fromX)) * 180 / Math.PI;
            this.node.setRotationFromEuler(0, 0, angle);
            return;
        }

        this.node.setPosition(mapToViewX(event.toX), mapToViewY(event.toY), 0);
        this.node.setRotationFromEuler(0, 0, 0);
        if (event.type === 'melee') {
            // 近战特效贴**出手点**，不是命中点（与 projectile 走 from→to 的口径不同）。
            this.node.setPosition(mapToViewX(event.fromX), mapToViewY(event.fromY), 0);
        }
    }
}
