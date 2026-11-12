import { _decorator, Animation, Color, Component, Graphics, instantiate, Node, Prefab, sp, Sprite, UITransform, UIOpacity, Vec3 } from 'cc';
import { ZCCombatEvent, ZCProjectileState } from '../model/ZCGameModel';
import { mapToViewX, mapToViewY } from './ZCGameViewUtil';
import { zcCombatEffectAnchorOf, zcCombatEffectAnchorPoint, zcCombatEffectLiftY, zcCombatEffectOverlayChild } from './ZCCombatEffectPlacement';
import { zcCombatEffectFlightOf, zcCombatEffectFacingDegrees, zcCombatEffectHeadingDegrees } from '../model/ZCCombatEffectFlight';
import { zcBeamCoreWidthOf, zcBeamFrame, zcBeamSpecOf, zcBeamStretchOf, zcBeamWidthScaleOf } from './ZCBeamEffect';
import type { IZCBeamSpec } from './ZCBeamEffect';
import { zcCombatEffectGrowFactor, zcCombatEffectNodeScaleOf } from './ZCCombatEffectScale';
import { zcMissileTrailOf, zcMissileTrailQuads } from './ZCMissileTrail';
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
    /** 已经 `setAnimation` 过的骨架段名（池化复用下必须复位，见 `initialize`）。 */
    private appliedSpineAnimation = '';
    /** 本预制体里「按阶段开关」的叠层子节点名；`null` = 这份特效没有叠层（一次都不碰）。 */
    private overlayChildName: string | null = null;
    /** 叠层当前是否已点亮；`null` = 本任还没设置过（池化复用后必须重设一遍）。 */
    private appliedOverlayFx: boolean | null = null;
    private readonly genericTint = new Color(255, 229, 148);
    /** 诊断用：本节点对应的特效资源路径（只有 `initialize` 知道）。 */
    private diagEffectPath = '';

    initialize(prefab: Prefab | null, allowGeneric = false, effectPrefabPath?: string | null): void {
        this.allowGeneric = allowGeneric && !prefab;
        this.graphics.clear();
        this.renderedEventId = -1;
        //  池化复用：上一任可能把骨架切到 `attack`，不复位的话下一只小鹿「一出生就在冲」。
        this.appliedSpineAnimation = '';
        //  叠层同理：上一任可能把火船点亮着还回来，不复位的话下一只小鹿「一出生就浑身着火」。
        this.overlayChildName = zcCombatEffectOverlayChild(effectPrefabPath);
        this.appliedOverlayFx = null;
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
        //  取不到 prefab 就在这里留一句（`allowGeneric` 决定是画通用短线还是什么都不画）。
        if (!prefab && this.diagEffectPath.includes('导弹')) {
            missileLog('视图', `initialize 取不到 prefab：${this.diagEffectPath}`
                + `（allowGeneric=${allowGeneric} ⇒ ${this.allowGeneric ? '画通用短线' : '什么都不画'}）`);
        }
        if (!prefab) return;
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

    /**
     * 入场「由小变大」的缩放系数（2026-11-07 椰蛋战士「暴风」100504）。
     *
     * 需求：「生成后由小变大到当前的大小」。缓动与钳位都在 `zcCombatEffectGrowFactor`（纯函数、可单测），
     * 这里只负责把「事件年龄」换算出来。
     *
     * 走 `event.startedAt` 而不是节点创建时刻：池化复用下节点寿命比事件长得多，
     * 用节点自身的时间会让第二个复用它的飓风「一上来就是满尺寸」。
     */
    private growFactorOf(event: Readonly<ZCCombatEvent>, now: number): number {
        return zcCombatEffectGrowFactor(event.growSeconds, now - event.startedAt);
    }

    /**
     * 按事件给的**阶段动画名**切骨架动画（2026-11-07 鹿神守护 103405 需求 2「播放对应的移动动画」）。
     *
     * 只在名字**变化**时才 `setAnimation`：它会把播放头拉回 0，每帧调一次等于把动画钉死在
     * 第一帧 —— 小鹿会原地抽搐而不是走路。
     *
     * 用 `getComponentInChildren`：鹿神守护那份预制的骨架在子节点 `spine` 上，根节点只有一个
     * UITransform。没有骨架的特效（磁电菇 / 雷弹那一类）直接跳过，不会被这条影响。
     */
    private applySpineAnimation(clip: string | null | undefined): void {
        if (!clip || clip === this.appliedSpineAnimation) return;
        const skeleton = this.visualNode?.getComponentInChildren(sp.Skeleton);
        if (!skeleton) return;
        this.appliedSpineAnimation = clip;
        //  与 `ZCUnitView.playClip` / `CardUnitPreview` 同一口径：`(0, name, true)` 且由骨架循环。
        skeleton.setAnimation(0, clip, true);
    }

    /**
     * 按事件给的语义开关**叠层子节点**（2026-11-12 鹿神守护：火船只在提速段烧起来）。
     *
     * 只在状态**翻转**时才动节点：`active` 变化会触发子树的启用/禁用周期，每帧写一次
     * 会让粒子 / 动画反复重启。用 `appliedOverlayFx` 记住上一次的值。
     *
     * 这份特效没登记叠层（`overlayChildName === null`）时一次都不碰 ——
     * 其余所有特效的预制体 `_active` 说了算，行为逐字不变。
     */
    private applyOverlayFx(active: boolean | undefined): void {
        const name = this.overlayChildName;
        if (!name) return;
        const wanted = active === true;
        if (wanted === this.appliedOverlayFx) return;
        const child = this.visualNode?.getChildByName(name);
        if (!child) return;
        this.appliedOverlayFx = wanted;
        child.active = wanted;
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
        const hasMissileTrail = event.type === 'projectile' && zcMissileTrailOf(event.effectPrefabPath) !== null;
        if (firstRender || event.type !== 'projectile' || (this.allowGeneric && !hasMissileTrail)) this.graphics.clear();
        if (!this.visualPrefab && this.allowGeneric && !hasMissileTrail) {
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
        //  阶段动画（2026-11-07 鹿神守护：走过去播 `move`、提速扑击播 `attack`）。
        //  只有模型给了名字才切；没给的一次都不碰，预制体自带的 `defaultAnimation` 照旧播。
        this.applySpineAnimation(event.spineAnimation);
        //  叠层（2026-11-12 鹿神守护：火船只在提速段覆盖在身上）。没登记叠层的特效不做任何事。
        this.applyOverlayFx(event.overlayFx);

        // ── 整体尺寸（按 prefab 路径登记的倍率，未登记 = 1）──
        //  需求 2026-11-03「龙卷风的特效范围和预制大小整体缩小成 80%」；
        //  2026-11-10 追加「椰蛋战士的暴风，3 个飓风调成 70%」⇒ 表里那条已改成 0.7。
        //  area 类地面区域的视觉尺寸完全来自 prefab 的烘焙缩放，视图从不按 `event.radius`
        //  缩放，所以「缩到 N%」只能在这里乘一个倍率；碰撞半径跟着改的是配表 `areaRadius`。
        //  ⚠️ 只缩**宿主节点**：光束分支改的是子节点（`visualNode`）的 scaleX/scaleY，
        //  两者相乘正是期望行为（宿主 0.7 × 光束自己的宽度倍率）。
        const nodeScale = zcCombatEffectNodeScaleOf(event.effectPrefabPath);
        //  入场「由小变大」（2026-11-07 椰蛋战士「暴风」：生成后由小变大到当前大小）。
        //  `growSeconds` 缺省 ⇒ 系数恒 1，所有既有特效逐字不变。
        //  缓动用 ease-out quad（`1-(1-t)^2`）：0.3s 这种短入场里，线性会显得"一顿"，
        //  out-back 又会在末段过冲、把飓风撑得比最终尺寸还大一圈。
        const growFactor = this.growFactorOf(event, now);
        this.node.setScale(nodeScale * growFactor, nodeScale * growFactor, 1);
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
            //  发射高度补偿（2026-11-11）：单位根节点是**逻辑脚点**，子弹贴在弹道逻辑坐标上
            //  就是「从脚下擦着地面飞出去」。加在 `mapToViewY` 之后 ⇒ 视图 px、屏幕竖直、
            //  不跟弹道旋转（与光束的 `muzzleLift` 同一口径；写进 prefab 的 `_lpos` 会被
            //  `setRotationFromEuler` 转成侧移）。数值表见 `ZCCombatEffectPlacement.zcCombatEffectLiftY`。
            const liftY = zcCombatEffectLiftY(event.effectPrefabPath);
            this.node.setPosition(mapToViewX(headX), mapToViewY(headY) + liftY, 0);
            const angle = Math.atan2(mapToViewY(event.toY - event.fromY), mapToViewX(event.toX - event.fromX)) * 180 / Math.PI;
            this.node.setRotationFromEuler(0, 0, angle);
            //  追踪导弹的弧线：飞行进度在中段达到最大横向偏移（`sin(π·progress)`）。
            //  偏移方向 = 弹道方向逆时针转 90°（即垂直于弹道的一侧），
            //  弹体节点在直线位置上再横推这一截，三个下标错开的 `arcOffset` 就成了三条不同弧线。
            if (projectile && (projectile.arcOffset ?? 0) !== 0) {
                const flown = Math.max(0, Math.min(1, (now - projectile.startedAt) / this.aimFlightSeconds(projectile)));
                const lateral = Math.sin(Math.PI * flown) * (projectile.arcOffset ?? 0);
                const perpX = -Math.sin(angle * Math.PI / 180);
                const perpY = Math.cos(angle * Math.PI / 180);
                this.node.setPosition(
                    mapToViewX(headX) + perpX * mapToViewX(lateral),
                    mapToViewY(headY) + perpY * mapToViewY(lateral) + liftY,
                    0,
                );
            }
            //  锥形拖尾（2026-11-05 需求，11-06 纠正方向：宽端贴弹体、往外收成尖）：
            //  画在**这一帧的最终位置 + 转角**定好之后，
            //  所以必须放在所有 `setPosition` / `setRotationFromEuler` 之后 —— 它是本地坐标系里的
            //  图形，跟宿主节点一起转、一起缩，位置写死在这里就自动跟着弧线飞。
            // 局部几何不随帧变化，后续只变换宿主节点；新事件与 initialize 会重画。
            if (firstRender) this.drawMissileTrail(event.effectPrefabPath);
            return;
        }

        //  竖直抬升（2026-11-11 磁电冲击「起始位置要在角色的中心点」）：加在 `mapToViewY` 之后，
        //  就是屏幕竖直方向、不跟下面那行转角走 —— 与 `zcCombatEffectLiftY`（弹道补偿）同口径。
        //  缺省 0 ⇒ 所有既有特效位置逐字不变。
        this.node.setPosition(mapToViewX(event.toX), mapToViewY(event.toY) + (event.visualLiftPx ?? 0), 0);
        this.node.setRotationFromEuler(0, 0, event.angleDegrees ?? 0);
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
        //  ⚠️ 事件自己带角度时（`area` 原地特效，2026-11-11 磁电冲击）以它为准：
        //  那一类事件 `from == to`，下面这条算式本来就只会返回 `null`；但万一某张图
        //  同时登记了 `FACING_BY_PREFAB_PATH`，模型给的角度才是对的，不能被覆盖。
        const heading = event.angleDegrees !== undefined ? null : zcCombatEffectHeadingDegrees(
            mapToViewX(event.toX - event.fromX),
            mapToViewY(event.toY - event.fromY),
            event.effectPrefabPath,
        );
        if (heading !== null) this.node.setRotationFromEuler(0, 0, heading);
    }

    /**
     * 弧线用的「瞄准段飞行秒数」= `出手点 → 瞄准点` 的距离 / 速度。
     *
     * 为什么不能直接用 `durationSeconds`：2026-11-09 起弹道寿命多了「打空续飞」的一截
     * （`ZC_PROJECTILE_MISS_DISTANCE`，命中即消耗所以只在没打中时走）。弧线是按
     * `sin(π · 飞行进度)` 算横向偏移的，分子换成整条寿命会被**整条拉长** ——
     * 飞到瞄准点时进度才 0.4 出头，弹体正好顶在最大偏移处横着飘出去，看着像脱靶。
     *
     * 速度从 `velocityX/velocityY` 反推（与出手时用的是同一个 speed），
     * 距离用事件自带的 `from → to`。两者都取不到时退回 `durationSeconds`，与改前一致。
     */
    private aimFlightSeconds(projectile: Readonly<ZCProjectileState>): number {
        const speed = Math.hypot(projectile.velocityX, projectile.velocityY);
        if (!(speed > 0)) return projectile.durationSeconds;
        const aim = Math.hypot(projectile.toX - projectile.fromX, projectile.toY - projectile.fromY) / speed;
        return aim > 0 ? Math.min(aim, projectile.durationSeconds) : projectile.durationSeconds;
    }

    /** 固定局部几何每事件画一次，后续随宿主变换；重画前清屏避免池化残留。 */
    private drawMissileTrail(prefabPath: string | null | undefined): void {
        const trail = zcMissileTrailOf(prefabPath);
        if (!trail) return;
        const graphics = this.graphics;
        if (!graphics?.isValid) return;
        graphics.clear();
        const [red, green, blue] = trail.color;
        for (const quad of zcMissileTrailQuads(trail)) {
            if (quad.alpha <= 0.004) continue;
            graphics.fillColor = new Color(red, green, blue, Math.round(255 * quad.alpha));
            graphics.moveTo(quad.x0, quad.halfWidth0);
            graphics.lineTo(quad.x1, quad.halfWidth1);
            graphics.lineTo(quad.x1, -quad.halfWidth1);
            graphics.lineTo(quad.x0, -quad.halfWidth0);
            graphics.close();
            graphics.fill();
        }
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
