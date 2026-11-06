import { _decorator, Animation, Color, Component, Graphics, instantiate, Node, Prefab, Sprite, UITransform, UIOpacity, Vec3 } from 'cc';
import { ZCCombatEvent, ZCProjectileState } from '../model/ZCGameModel';
import { mapToViewX, mapToViewY } from './ZCGameViewUtil';
import { zcCombatEffectAnchorOf, zcCombatEffectAnchorPoint } from './ZCCombatEffectPlacement';
import { zcCombatEffectFlightOf, zcCombatEffectFacingDegrees, zcCombatEffectHeadingDegrees } from '../model/ZCCombatEffectFlight';
import { zcBeamCoreWidthOf, zcBeamFrame, zcBeamSpecOf, zcBeamStretchOf, zcBeamWidthScaleOf } from './ZCBeamEffect';
import type { IZCBeamSpec } from './ZCBeamEffect';
import { zcCombatEffectNodeScaleOf } from './ZCCombatEffectScale';
import { missileLog } from '../ZCMissileSkillDiagnostics';

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
    //  2026-11-03：原 `beamBaseScaleY` 已被移除。池化复用下从 `visual.scale.y` 读取会累乘污染
    //  （第1次 0.7→1.26，第2次复用读到 1.26→2.27，越来越大）。现在 prefab 的 0.7 原始缩放
    //  已 bake 进 `ZCBeamEffect.widthScale`（1.8→1.26），`applyBeamStretch` 直接写绝对值。
    /** 宿主节点上的 `UIOpacity`（懒取）：整棵子树一起淡，预制体有几层都不用逐层改。 */
    private nodeOpacity: UIOpacity | null = null;
    private readonly genericTint = new Color(255, 229, 148);
    /** 诊断用：本节点对应的特效资源路径（只有 `initialize` 知道）。 */
    private diagEffectPath = '';

    initialize(prefab: Prefab | null, allowGeneric = false, effectPrefabPath?: string | null): void {
        this.allowGeneric = allowGeneric && !prefab;
        this.graphics.clear();
        this.renderedEventId = -1;
        this.node.setRotationFromEuler(0, 0, 0);
        //  池化复用：上一任可能是淡到全透明的「定格光束」，不在这里复位的话，
        //  下一次借出来的特效会「一出生就是半透明」。
        this.resetOpacity();
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
        //  诊断：把这个特效节点对应的资源路径记住，`mountVisual` 里要用它决定打不打日志。
        this.diagEffectPath = effectPrefabPath ?? '';
        if (!prefab) {
            if (this.diagEffectPath.includes('导弹')) {
                missileLog('视图', `initialize 取不到 prefab：${this.diagEffectPath}`
                    + `（allowGeneric=${allowGeneric} ⇒ ${this.allowGeneric ? '画通用短线' : '什么都不画'}）`);
            }
            return;
        }
        this.mountVisual(prefab);
    }

    /** 这个特效节点现在有没有挂上美术（后补到货时靠它判断要不要补挂）。 */
    get hasVisual(): boolean {
        return !!this.visualNode?.isValid;
    }

    /**
     * 美术**后补到货**：把 prefab 挂上，但**不动**渲染状态（`renderedEventId` / 透明度 / 旋转）。
     *
     * 为什么需要：渐进加载局（`deferEffects`）首帧 `effectVisualPrefabs` 还是空 Map，
     * 特效节点会以 `visualNode === null` 创建。而 `ZCGameRenderWorld` 只在**节点首次创建**
     * （`if (!entityId)`）时调一次 `initialize`，prefab 之后到货**没有任何人再挂** ⇒
     * 这个子弹整段飞行都只剩一条 18px 的通用短线，看上去就是「子弹不见了」
     * （2026-11-04 萨尔/萨满 68016 / 68022）。
     */
    attachVisualPrefab(prefab: Prefab): void {
        if (this.visualPrefab === prefab && this.visualNode?.isValid) return;
        this.visualNode?.destroy();
        this.visualNode = null;
        this.visualPrefab = prefab;
        this.mountVisual(prefab);
    }

    /**
     * 把一份美术真挂上去：`initialize` 与 {@link attachVisualPrefab} 共用这一段，
     * 避免两处顺序漂移（建子树 → 写 layer → 取画布宽 → 起播 clip）。
     */
    private mountVisual(prefab: Prefab): void {
        const visual = this.visualNode ?? instantiate(prefab);
        visual.setParent(this.node);
        // 根节点位置**不清零**：老客户端把特效的摆位偏移压在 prefab 的 `position` 层，转 prefab 时
        // 只带回了 scale/rotZ，那份偏移只能落在根节点的 `_lpos` 上（见
        // outputs/技能特效摆位取证_20260921.md）。清零会把它抹掉 → 特效下陷/悬空。
        // 世界定位仍由宿主 this.node 承担（见 render()），这里只管「相对宿主的摆位」。
        visual.layer = this.node.layer;
        visual.active = true;
        this.visualNode = visual;
        if (this.beamSpec) {
            // 光束预制体的锚点在**左端**（发射口），所以 `scaleX` 只拉长不两头长。
            // 2026-11-03：不复用旧节点的 `scale.y`（池化复用下已被 applyBeamStretch 污染），
            // prefab 原始纵向缩放（0.7）已 bake 进 `ZCBeamEffect.widthScale`。
            this.beamCanvasWidth = visual.getComponent(UITransform)?.contentSize.width ?? 0;
        }
        const animation = visual.getComponent(Animation) ?? visual.getComponentInChildren(Animation);
        const clipName = animation?.defaultClip?.name || animation?.clips?.[0]?.name;
        if (animation && clipName) { animation.stop(); animation.play(clipName); }
        //  诊断⑤：美术挂上了、clip 起播了没。用户问的就是「导弹技能播放了没」，
        //  这一行直接回答：prefab 名 / 节点名 / 尺寸 / clip 名 / 有没有动画组件。
        if (this.diagEffectPath.includes('导弹')) {
            const size = visual.getComponent(UITransform)?.contentSize;
            missileLog('视图', `挂载美术 ${this.diagEffectPath}`
                + ` | prefab=${prefab.name} visual=${visual.name} active=${visual.active}`
                + ` scale=(${visual.scale.x.toFixed(3)},${visual.scale.y.toFixed(3)})`
                + ` 画布=${size ? `${size.width}x${size.height}` : '无'}`
                + ` 动画组件=${animation ? '有' : '无'} clip=${clipName ?? '无'}`
                + ` 播放=${animation && clipName ? '已 play' : '未播放'}`);
        }
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

        // ── 整体尺寸（按 prefab 路径登记的倍率，未登记 = 1）──
        //  需求 2026-11-03「龙卷风的特效范围和预制大小整体缩小成 80%」。
        //  area 类地面区域的视觉尺寸完全来自 prefab 的烘焙缩放，视图从不按 `event.radius`
        //  缩放，所以「缩到 80%」只能在这里乘一个倍率；碰撞半径跟着改的是配表 `areaRadius`。
        //  ⚠️ 只缩**宿主节点**：光束分支改的是子节点（`visualNode`）的 scaleX/scaleY，
        //  两者相乘正是期望行为（宿主 0.8 × 光束自己的宽度倍率）。
        const nodeScale = zcCombatEffectNodeScaleOf(event.effectPrefabPath);
        this.node.setScale(nodeScale, nodeScale, 1);
        //  除「定格光束」外一律复位到全不透明：池化节点上一任可能正好淡到 0 才回池。
        if (!event.beamHold) this.resetOpacity();

        if (event.type === 'projectile') {
            //  ── 定格光束（`beamHold`）：命中后那 0.18s 的余韵 ──
            //  这条事件是模型在弹道被摘掉时补的，`to` 就是命中点、`durationSeconds` 就是淡出秒数。
            //  所以这里**不插值**（长度已经定格在命中点），只把整体透明度压到 0；
            //  需求 2026-11-03「触碰到第一个敌人时就会停止延长…特效缓慢变透消失，0.18s 内消失」。
            if (event.beamHold && this.beamSpec) {
                const hold = zcBeamFrame(
                    { x: mapToViewX(event.fromX), y: mapToViewY(event.fromY) },
                    { x: mapToViewX(event.toX), y: mapToViewY(event.toY) },
                    this.beamSpec,
                    event.skillId,
                );
                this.node.setPosition(hold.x, hold.y, 0);
                this.node.setRotationFromEuler(0, 0, hold.angleDegrees);
                this.applyBeamStretch(hold.length, event.skillId);
                //  线性淡出：0.18s 这么短，缓动曲线肉眼分辨不出来，别为此再引入一条曲线表。
                this.applyOpacity(1 - progress);
                return;
            }
            //  弹头位置：有 `projectile` 时按上一个逻辑步插值，没有（已经命中、只剩事件）时按事件进度。
            const headX = projectile ? projectile.previousX + (projectile.x - projectile.previousX) * alpha : event.fromX + (event.toX - event.fromX) * progress;
            const headY = projectile ? projectile.previousY + (projectile.y - projectile.previousY) * alpha : event.fromY + (event.toY - event.fromY) * progress;
            //  光束（镭射飞龙）：不"飞"，而是从发射口一路连到弹头 —— 节点摆在发射口、转角对住弹道，
            //  `scaleX` 拉成"发射口→弹头"的长度。锚点在预制体左端，所以只有远端在长。
            if (this.beamSpec) {
                //  超长射线（镭射死光 30845/30846）：长度写死在 18 格，方向固定朝向目标，
                //  必须传 **event.to**（18 格外）而不是弹头坐标，否则第一帧弹头还贴着发射口，
                //  方向会退化成"朝右"。普通光束只按"发射口→弹头"逐帧长，传弹头、不传目标。
                const isLaserDeath = event.skillId === 30845 || event.skillId === 30846;
                const toX = isLaserDeath ? event.toX : headX;
                const toY = isLaserDeath ? event.toY : headY;
                const frame = zcBeamFrame(
                    { x: mapToViewX(event.fromX), y: mapToViewY(event.fromY) },
                    { x: mapToViewX(toX), y: mapToViewY(toY) },
                    this.beamSpec,
                    event.skillId,
                );
                this.node.setPosition(frame.x, frame.y, 0);
                this.node.setRotationFromEuler(0, 0, frame.angleDegrees);
                this.applyBeamStretch(frame.length, event.skillId);
                return;
            }
            this.node.setPosition(mapToViewX(headX), mapToViewY(headY), 0);
            const angle = Math.atan2(mapToViewY(event.toY - event.fromY), mapToViewX(event.toX - event.fromX)) * 180 / Math.PI;
            this.node.setRotationFromEuler(0, 0, angle);
            //  追踪导弹的弧线：飞行进度在中段达到最大横向偏移（`sin(π·progress)`）。
            //  偏移方向 = 弹道方向逆时针转 90°（即垂直于弹道的一侧），
            //  弹体节点在直线位置上再横推这一截，三个下标错开的 `arcOffset` 就成了三条不同弧线。
            if (projectile && (projectile.arcOffset ?? 0) !== 0) {
                const flown = Math.max(0, Math.min(1, (now - projectile.startedAt) / projectile.durationSeconds));
                const lateral = Math.sin(Math.PI * flown) * (projectile.arcOffset ?? 0);
                const perpX = -Math.sin(angle * Math.PI / 180);
                const perpY = Math.cos(angle * Math.PI / 180);
                this.node.setPosition(
                    mapToViewX(headX) + perpX * mapToViewX(lateral),
                    mapToViewY(headY) + perpY * mapToViewY(lateral),
                    0,
                );
            }
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
     * 把光束拉到 `length` 长（两条路径共用：正常飞行段 / 命中后的定格淡出）。
     *
     * 有美术时拉 `visualNode.scaleX`；美术没加载（或缺 `UITransform` 算不出画布宽）时
     * **必须**画兜底线 —— 这条分支原来会掉回「通用弹道」，而 `allowGenericEffects=false`
     * 的关卡里通用弹道也不画 ⇒ 整条光束凭空消失、一条错都不报（2026-11-02 用户截图）。
     */
    private applyBeamStretch(length: number, skillId: number): void {
        if (!this.beamSpec) return;
        if (this.visualNode && this.beamCanvasWidth > 0) {
            const stretch = zcBeamStretchOf(this.beamSpec, this.beamCanvasWidth, length);
            this.visualNode.setScale(
                stretch.scaleX,
                zcBeamWidthScaleOf(this.beamSpec, skillId),
                1,
            );
            //  画布左侧那段留白（≈5% 宽）推到锚点外面，线条起点才真的落在发射口上。
            this.visualNode.setPosition(stretch.offsetX, 0, 0);
            return;
        }
        this.drawBeamFallback(length, zcBeamCoreWidthOf(this.beamSpec, skillId));
    }

    /**
     * 整体透明度走**宿主节点**的 `UIOpacity`，而不是逐层改 `Sprite.color`：
     * 光束预制体里有亮芯 + 柔光两层，逐层改会漏；`UIOpacity` 一次级联整棵子树，
     * 兜底的 `Graphics` 线也一起淡（它同样是 `UIRenderer`）。
     */
    private applyOpacity(alpha: number): void {
        const opacity = this.ensureOpacity();
        if (opacity) opacity.opacity = Math.round(255 * Math.max(0, Math.min(1, alpha)));
    }

    private ensureOpacity(): UIOpacity | null {
        if (this.nodeOpacity?.isValid) return this.nodeOpacity;
        this.nodeOpacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
        return this.nodeOpacity;
    }

    /** 复位到全不透明；**不**新建 `UIOpacity`（没淡出过就不该多挂一个组件）。 */
    private resetOpacity(): void {
        if (this.nodeOpacity?.isValid) this.nodeOpacity.opacity = 255;
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
