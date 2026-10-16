import { _decorator, Animation, Component, Graphics, instantiate, Node, Prefab, Sprite, UITransform, Vec3 } from 'cc';
import { ZCCombatEvent, ZCProjectileState } from '../model/ZCGameModel';
import { mapToViewX, mapToViewY } from './ZCGameViewUtil';

const { ccclass, property } = _decorator;

/**
 * `ZCGameEffect.prefab` 上的技能视觉表现。
 *
 * 🔴 **视觉 100% 来自 prefab**（2026-10-15 删掉全部矢量绘制）：`pvpSkill.json`
 * 43/43 行都填了 `effectPrefabPath` 且对应 prefab 全部入库，`visualNode` 恒非空。
 * 原来的 `Graphics` 兜底（弹道箭头 / 刀光 / area 椭圆）已随之删除。
 *
 * 副作用（**要接受**）：后续新增技能若忘了填 `effectPrefabPath`，
 * 该技能的特效会「什么都不出」而不是出替代图形 —— 属于配置问题，本就该显眼。
 *
 * `graphics` 组件与 `@property` 仍保留：`ZCGameEffect.prefab` 里绑着它，
 * 删声明会造成 prefab 与脚本不一致（规则 161/162）。
 */
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

    initialize(prefab: Prefab | null): void {
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
        // 只清掉 prefab 里可能烘焙的几何；矢量绘制已删，这里不再画任何东西。
        if (firstRender || event.type !== 'projectile') this.graphics.clear();
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
