import { _decorator, Animation, Color, Component, Graphics, instantiate, Label, Material, Node, Prefab, ProgressBar, sp, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import type { ZCUnitDefinition } from '../model/ZCCombatCatalog';
import type { ZCUnitState } from '../model/ZCGameModel';
import type { ZCOwner } from '../model/ZCMapConfig';
import { ZC_CLIENT_COLORS } from './ZCTheme';
import { isHealthBarVisible, pickHealthBarFill, spawnShakePulse, SPAWN_SHAKE_PHASE_SECONDS, updateHealthBar } from './ZCGameViewUtil';
import { ProcedureGame } from '../../procedure/ProcedureGame';

const { ccclass, property } = _decorator;

export interface IZCUnitPresentation {
    unit: Readonly<ZCUnitState>;
    definition: Readonly<ZCUnitDefinition>;
    x: number;
    y: number;
    /** 表现时间（秒），用于判断血条是否还在「被攻击后 3 秒」的显示窗口内。 */
    now: number;
}

/**
 * Rendering behaviour owned by ZCGameUnit.prefab.
 *
 * 六个引用（`rootTransform` / `visualRoot` / `sprite` / `fallback` / `fallbackLabel` / `healthBar`）
 * 连同 `VisualRoot`、`HealthBar` 两个容器节点都声明在 `ZCGameUnit.prefab` 里 ——
 * 这里不再 `getChildByName` 兜底，也不为「旧场景」现建 `VisualRoot`：
 * 那种兼容分支只会让一个「Inspector 全空」的视图静默存活。
 */
@ccclass('ZCUnitView')
export class ZCUnitView extends Component {
    /**
     * 各席位兜底圆点的描边色。
     * 原在 `ZCTheme.zcOwnerEdgeColor` 导出，但全工程唯一消费类是 ZCUnitView ——
     * 按 §6.2 第 12 条内聚为私有静态；颜色仍读共享主题 `ZC_CLIENT_COLORS`，不复制值。
     */
    private static readonly OWNER_EDGE_COLOR: Readonly<Record<ZCOwner, Color>> = {
        player: ZC_CLIENT_COLORS.playerEdge,
        enemy: ZC_CLIENT_COLORS.enemyEdge,
        enemy2: ZC_CLIENT_COLORS.enemy2Edge,
        enemy3: ZC_CLIENT_COLORS.enemy3Edge,
    };

    /** 当前兵种画布的脚底位于视觉根节点下方 45.7px；单位根节点本身代表逻辑脚点。 */
    private static readonly UNIT_VISUAL_CENTER_FROM_FOOT_Y = 45.7;

    /**
     * 「视觉容器相对单位逻辑脚点」的 Y 偏移，按**资产形态**分两套：
     * 序列帧（`units/**`）内容原点在画布中心 ⇒ +45.7；spine（`skel/**`）骨架原点≈脚底 ⇒ 0。
     * 混用的症状是 spine 单位整体浮空 45.7px，不报错、只有肉眼能发现。
     */
    private static readonly UNIT_VISUAL_OFFSET_FRAME = ZCUnitView.UNIT_VISUAL_CENTER_FROM_FOOT_Y;
    private static readonly UNIT_VISUAL_OFFSET_SPINE = 0;

    /**
     * 阵亡后的美术染色。序列帧走 `Sprite.color`、spine 走 `Skeleton.color`，
     * setter 内部是拷贝，共享这一个实例安全。
     */
    private static readonly UNIT_DEAD_TINT = new Color(135, 135, 135, 190);
    /**
     * 其他玩家（非我方席位）单位的暗色叠加色（#828282）。
     *
     * 与阵亡灰同一机制：走顶点色**相乘**（`Sprite.color` / `Skeleton.color`），
     * 保留原画色相、整体压暗成灰调。乘 0.51 灰而不是 0（全黑），是为了还看得出体积与明暗。
     */
    private static readonly OTHER_PLAYER_TINT = new Color(0x82, 0x82, 0x82, 255);

    /**
     * 顶点色染色的三种状态（`applyVisualTint`）。
     *
     * 用枚举值而不是 `boolean`：这一态同时承载「我方原色 / 其他玩家取灰 / 阵亡」，
     * 折成布尔就表达不了「其他玩家**且**阵亡」该走哪一档。优先级：阵亡 > 其他玩家 > 原色
     *（阵亡的 alpha 190 已经在表达「躺下」，再叠一层灰没有额外信息）。
     */
    private static readonly TINT_WHITE = 0;
    private static readonly TINT_OTHER_PLAYER = 1;
    private static readonly TINT_DEAD = 2;

    /** 兜底圆点的尺寸（没有可用美术 prefab 时）。 */
    private static readonly FOOT_SIZE_HERO = 46;
    private static readonly FOOT_SIZE_UNIT = 34;
    private static readonly FALLBACK_RADIUS_HERO = 13;
    private static readonly FALLBACK_RADIUS_UNIT = 9;

    /**
     * spine 骨架 canvas 高 → 目标「等效画布高」（69.4），给 spine 单位定缩放。
     * 实测口径（2026-09-24，`tmp/_spine_unit_scale.mjs`）：spine 可见高/骨架 canvas 高 = 0.970，
     * 要对齐序列帧可见高 67.27 ⇒ 目标 canvas 高 69.4。
     */
    private static readonly SPINE_CANVAS_TARGET_HEIGHT = 69.4;
    /**
     * 「整体外轮廓」副本的放大倍数。
     *
     * 副本绕**脚点**放大 ⇒ 脚底基本不动、越往上外扩越多（69px 高的兵头顶约 5px、脚底 ≈0），
     * 正是站在地上的角色该有的样子。用**倍数**而不是固定像素：材质全局共用，而各兵种骨架的
     * canvas 高差一个数量级（292~916），只有比例口径能让一套值通吃。
     */
    private static readonly OUTLINE_COPY_SCALE = 1.08;

    /** 朝向判定的死区滞回阈值（避免在 ~90°/270° 附近微调角度时每帧左右闪烁翻转）。 */
    private static readonly FACING_HYSTERESIS_COS = 0.15;

    /**
     * 取骨架的动画名表（用于探测 idle / move / attack 到底叫什么）。
     * 必须走 `getRuntimeData()`：`sp.Skeleton.findAnimation()` 依赖 `onLoad` 后的 `_skeleton`，
     * `initialize()` 紧跟 `instantiate()` 调用，探测会静默返回空表。
     */
    private static spineAnimationNames(skeleton: sp.Skeleton): readonly string[] {
        const runtime = skeleton.skeletonData?.getRuntimeData(true);
        return (runtime?.animations ?? []).map((animation) => animation.name);
    }

    /**
     * 骨架的 canvas 高度（设计单位），用来算 spine 单位的缩放。
     * 必须走 `getRuntimeData()`，不能读美术 prefab 上的 `UITransform`（尺寸不可信）。
     */
    private static spineCanvasHeight(skeleton: sp.Skeleton): number {
        const runtime = skeleton.skeletonData?.getRuntimeData(true);
        return runtime?.height ?? 0;
    }

    @property({ type: UITransform })
    rootTransform: UITransform = null!;

    @property({ type: Node, tooltip: '兵种美术容器；原点相对单位逻辑脚点上移 45.7px' })
    visualRoot: Node = null!;

    @property({ type: Sprite })
    sprite: Sprite = null!;

    @property({ type: Graphics })
    fallback: Graphics = null!;

    @property({ type: Label })
    fallbackLabel: Label = null!;

    @property({ type: ProgressBar, group: '状态条', tooltip: 'HealthBar：单位生命值' })
    healthBar: ProgressBar = null!;

    // 血条填充图：按阵营各一张 —— 我方蓝 / 敌红 / 敌2 黄 / 敌3 紫（R25「不同阵营区分不同的血条」）。
    // 紫图取自项目里已有但一直没人用的 `buildings/jindutiao_p.png`，不需要新美术；
    // 四家的取值口径见 `ZCGameViewUtil.pickHealthBarFill`。
    @property({ type: SpriteFrame, group: '状态条', tooltip: '血条填充：我方（蓝）' })
    barFillPlayer: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '状态条', tooltip: '血条填充：敌方（红）' })
    barFillEnemy: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '状态条', tooltip: '血条填充：敌方 2（黄）' })
    barFillEnemy2: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '状态条', tooltip: '血条填充：敌方 3（紫）' })
    barFillEnemy3: SpriteFrame = null!;

    // 兵种视觉 prefab 的画布统一是 256×256、节点 98×98，可见身体约 56~74 宽 × 69 高。
    // 单位根节点现在是逻辑脚点，VisualRoot 上移 45.7px 后，美术脚底正好落在原点；
    // 头顶相对脚点约 +69~+74，所以血条放在 +80（离头顶 6~11）。
    // 尺寸取蓝湖「多队伍」稿：外框 76×17（内容区 72×12），填充 8 高、左右各内缩 4。
    @property({ group: '状态条', tooltip: '普通单位血条外框宽度' })
    barWidth = 76;

    @property({ group: '状态条', tooltip: '英雄单位血条外框宽度' })
    barWidthHero = 86;

    @property({ group: '状态条', tooltip: '血条外框高度（蓝湖稿 17）' })
    barHeight = 17;

    @property({ group: '状态条', tooltip: '血条填充高度（蓝湖稿 8）' })
    barFillHeight = 8;

    @property({ group: '状态条', tooltip: '填充相对外框的左右内缩（蓝湖稿各 4）' })
    barFillInset = 4;

    @property({ group: '状态条', tooltip: '血条中心相对单位根节点的 Y 偏移（头顶之上）' })
    barOffsetY = 80;

    private visualNode: Node | null = null;
    private visualPrefab: Prefab | null = null;
    private visualAnimation: Animation | null = null;
    private visualSprite: Sprite | null = null;
    /** 非 null = 这条兵种美术是 spine（`resources/skel/**`），动作走 `setAnimation` 而不是 `Animation`。 */
    private visualSkeleton: sp.Skeleton | null = null;
    /**
     * 整体外轮廓 = **同一份美术 prefab 的第二个实例**（放大 `OUTLINE_COPY_SCALE`、
     * 只画不透明像素，排在美术后面 ⇒ 大出来的那一圈就是顺着角色外形的描边）。
     *
     * 不声明进 `ZCGameUnit.prefab`：它和 `visualNode` 一样是「按兵种不同」的美术实例，
     * 进 prefab 反而要按兵种各建一份；这里与 `attachVisual` 同一条路径 `instantiate`。
     * 只有 spine 美术有整体外形可描 —— 序列帧（`units/**`）不建副本。
     */
    private outlineCopyMaterial: Material | null = null;
    private outlineCopyNode: Node | null = null;
    private outlineCopySkeleton: sp.Skeleton | null = null;
    private readonly outlineCopyScale = new Vec3(1, 1, 1);
    /** 美术每真正起播一次动画 +1；副本只在代次变化时 `setAnimation`（见 `syncOutlineCopyClip`）。 */
    private outlineClipEpoch = 0;
    private outlineSyncedEpoch = -1;
    private appliedOutlineCopyOwner: ZCOwner | null = null;
    /**
     * prefab 自带的缩放 × spine canvas 归一系数（**不含** `prefabSize`）。
     *
     * 拆成两层是因为二者来源不同：这里是「资产客观事实」（美术 prefab 上写了多少、
     * 骨架 canvas 多大），`prefabSize` 是「策划的表现意图」。意图变了不该逼着重建节点。
     */
    private visualAssetScale = new Vec3(1, 1, 1);
    /** 表里的等比缩放系数（`pvpCard.prefabSize`）；见 `applyVisualSize`。 */
    private visualSize = 1;
    /** 实际写进节点的缩放 = `visualAssetScale` × `visualSize`。朝向翻转在 render 里另乘。 */
    private visualBaseScale = new Vec3(1, 1, 1);
    private idleClip = '';
    private moveClip = '';
    private attackClip = '';
    private currentClip = '';
    private lastAttackCount = -1;
    /** 上一次写进 prefab 的血条尺寸（-1 = 还没写过）。血条尺寸只在变化时写，见 renderHealthBar。 */
    private barAppliedWidth = -1;
    private barAppliedHeight = -1;
    /** 上一次 render 到的血量；null = 这条命还没看过（第一次渲染只记录，不算挨打）。 */
    private observedHp: number | null = null;
    private barAppliedHp: number | null = null;
    private barAppliedMaxHp: number | null = null;
    private barAppliedOwner: ZCOwner | null = null;
    private barAppliedOffsetY = Number.NaN;
    /** 本兵最后一次实际扣血的表现时间；null = 还没挨过打，血条不显示。 */
    private lastDamagedAt: number | null = null;
    private fallbackKey = -1;
    private appliedRootSize = -1;
    private appliedRootX = Number.NaN;
    private appliedRootY = Number.NaN;
    /**
     * 朝向缩放用的复用 `Vec3` + 上次写入值 + 朝向滞回状态。
     *
     * 原先每帧 `setScale(new Vec3(...))`，46 个单位 × 60 帧 = 每秒近 3 千个短命对象，
     * 正是 AGENTS.md 明令禁止的「update 路径分配临时对象」——表现为 GC 尖刺、
     * 帧时间忽高忽低。这里改成复用实例，**并且值没变就不写**（setScale 会触发引擎侧
     * 变换脏标记，没必要的写入本身也花钱）。
     */
    private readonly visualScale = new Vec3(1, 1, 1);
    private appliedVisualScaleX = Number.NaN;
    private appliedVisualScaleY = Number.NaN;
    private lastFacing: 1 | -1 = 1;
    private appliedTint = -1;
    /** 出生抖动起点（表现时间，秒）；null = 没在抖。建筑生成单位时由渲染层设一次。 */
    private spawnShakeStartedAt: number | null = null;

    /** 整体外轮廓（放大副本）的材质；null ⇒ 不出轮廓。 */
    setOutlineCopyMaterial(material: Material | null): void {
        this.outlineCopyMaterial = material;
        if (this.outlineCopySkeleton) this.outlineCopySkeleton.customMaterial = material;
    }

    /**
     * 建筑生成单位时调一次：播**原地抖动**（Y 轴拉 110% 回落、再 X 轴拉 110% 回落）。
     *
     * 只记起点、不建 tween：`render` 每帧按 `now - spawnShakeStartedAt` 反推抖动缩放，
     * 与工程「按进度计算、不留补间残影」的惯例一致。同一单位重复调用只是把起点刷新（重播）。
     */
    playSpawnShake(now: number): void {
        this.spawnShakeStartedAt = now;
    }

    /**
     * @param prefabSize 卡表 `pvpCard.prefabSize`（美术等比缩放）。
     *   **不给默认值**：漏传要在编译期报「少了实参」，而不是静默按 1 渲染 ——
     *   表里配了 1.2 的兵看起来没变大，正是本工程反复踩的那类静默失效。
     */
    /**
     * 绑定一个兵种的表现。
     *
     *  两个入参都**不再从外部传**（2026-10-16）：
     *   · 美术 prefab 按 `definition.unitId` 向控制器现取（`ProcedureGame.current?.resolveUnitPrefab`）——
     *     「按兵种不同」的东西进不了 `@property`，也没必要让渲染层再包一层；
     *   · `prefabSize` 本来就是这份 `definition` 上的策划数据（`pvpCard.prefabSize`）。
     */
    initialize(definition: Readonly<ZCUnitDefinition>): void {
        const prefab = ProcedureGame.current?.resolveUnitPrefab(definition.unitId) ?? null;
        this.resetForReuse(definition.prefabSize);
        if (this.visualNode?.isValid && this.visualPrefab === prefab) {
            this.visualNode.active = true;
            this.applyVisualSize();
            this.resetVisualTint();
            this.visualAnimation?.stop();
            this.playClip(this.idleClip, true);
            return;
        }
        this.clearVisual();
        this.visualPrefab = prefab;
        if (!prefab) return;
        this.attachVisual(prefab);
        this.applyVisualSize();
        this.configureAnimationClips();
        this.playClip(this.idleClip, true);
    }

    private resetForReuse(prefabSize: number): void {
        this.fallbackKey = -1;
        this.currentClip = '';
        this.lastAttackCount = -1;
        // A pooled node must not inherit the previous unit's damage window or cached writes.
        this.observedHp = null;
        this.lastDamagedAt = null;
        this.barAppliedHp = null;
        this.barAppliedMaxHp = null;
        this.barAppliedOwner = null;
        this.barAppliedOffsetY = Number.NaN;
        this.appliedRootX = Number.NaN;
        this.appliedRootY = Number.NaN;
        this.appliedTint = -1;
        this.appliedOutlineCopyOwner = null;
        this.outlineSyncedEpoch = -1;
        // 复用回来的节点不能带着上一条命的抖动/缩放/朝向残影。
        this.spawnShakeStartedAt = null;
        this.appliedVisualScaleX = Number.NaN;
        this.appliedVisualScaleY = Number.NaN;
        this.lastFacing = 1;
        // Keep this before the null-prefab exit: fallback bars also use the current card size.
        this.visualSize = prefabSize;
    }

    private clearVisual(): void {
        this.visualNode?.destroy();
        this.visualNode = null;
        this.outlineCopyNode?.destroy();
        this.outlineCopyNode = null;
        this.outlineCopySkeleton = null;
        this.visualAnimation = null;
        this.visualSprite = null;
        this.visualSkeleton = null;
        this.idleClip = '';
        this.moveClip = '';
        this.attackClip = '';
        this.visualRoot.setPosition(Vec3.ZERO);
    }

    private attachVisual(prefab: Prefab): void {
        const visual = instantiate(prefab);
        visual.setParent(this.visualRoot);
        visual.setSiblingIndex(0);
        visual.setPosition(Vec3.ZERO);
        visual.layer = this.node.layer;
        this.visualNode = visual;
        // getComponentInChildren is not guaranteed to include the root node in every Cocos version.
        this.visualAnimation = visual.getComponent(Animation) ?? visual.getComponentInChildren(Animation);
        this.visualSprite = visual.getComponent(Sprite) ?? visual.getComponentInChildren(Sprite);
        this.visualSkeleton = visual.getComponent(sp.Skeleton) ?? visual.getComponentInChildren(sp.Skeleton);
        if (this.visualSprite) this.visualSprite.node.layer = this.node.layer;
        if (this.visualSkeleton) this.visualSkeleton.node.layer = this.node.layer;

        const scale = visual.scale;
        this.visualAssetScale.set(scale.x, scale.y, scale.z);
        if (this.visualSkeleton) {
            const canvasHeight = ZCUnitView.spineCanvasHeight(this.visualSkeleton);
            if (canvasHeight > 0) {
                const factor = ZCUnitView.SPINE_CANVAS_TARGET_HEIGHT / canvasHeight;
                this.visualAssetScale.set(scale.x * factor, scale.y * factor, scale.z * factor);
            }
        }
        // 整体外轮廓用同一份美术 prefab 的第二个实例 ⇒ 只在有骨架时建。
        if (this.visualSkeleton) this.attachOutlineCopy(prefab);
        // Frame art is centered on its canvas; Spine art is already anchored near the feet.
        this.visualRoot.setPosition(0, this.visualSkeleton
            ? ZCUnitView.UNIT_VISUAL_OFFSET_SPINE : ZCUnitView.UNIT_VISUAL_OFFSET_FRAME, 0);
    }

    /**
     * 建「整体外轮廓」副本：同一份美术 prefab 的第二个实例，同动画、放大 `OUTLINE_COPY_SCALE`、
     * 只画不透明像素（`shaders/unit-outline-copy`），排在美术**后面** ⇒ 大出来的那一圈 = 描边。
     *
     * 子序：美术先在 `attachVisual` 里占 0（那时它是独子），副本后到会把它挤到 1 ⇒
     * 最终 `[副本, 美术]`。改这里的下标要同步改 `attachVisual` 里那一行，否则副本会盖到角色身上
     * （整只兵变成一个色块）。
     */
    private attachOutlineCopy(prefab: Prefab): void {
        const copy = instantiate(prefab);
        copy.setParent(this.visualRoot);
        copy.setSiblingIndex(0);
        copy.setPosition(Vec3.ZERO);
        copy.layer = this.node.layer;
        copy.name = `${copy.name}_OutlineCopy`;
        const skeleton = copy.getComponent(sp.Skeleton) ?? copy.getComponentInChildren(sp.Skeleton);
        // 与 `attachVisual` 是同一份 prefab（`visualSkeleton` 非空才建副本）⇒ 这里必然找得到。
        // 找不到说明美术资产形态变了，当场抛比静默少一层描边好排查。
        if (!skeleton) throw new Error('ZCUnitView 轮廓副本：美术 prefab 里找不到 sp.Skeleton');
        skeleton.node.layer = this.node.layer;
        skeleton.customMaterial = this.outlineCopyMaterial;
        // shader 按**预乘**口径输出（见 effect 顶部注释）；这里把口径钉死，别依赖美术 prefab 上的勾选。
        skeleton.premultipliedAlpha = true;
        this.outlineCopyNode = copy;
        this.outlineCopySkeleton = skeleton;
    }

    private configureAnimationClips(): void {
        if (this.visualSkeleton) {
            // Read names from the asset: Skeleton's runtime instance may not be ready yet.
            const names = ZCUnitView.spineAnimationNames(this.visualSkeleton);
            const pick = (candidates: readonly string[]): string => candidates.find((name) => names.includes(name)) ?? '';
            this.idleClip = pick(['idle']);
            this.moveClip = pick(['move', 'run']) || this.idleClip;
            this.attackClip = pick(['attack']) || this.idleClip;
            return;
        }
        const clips = this.visualAnimation?.clips ?? [];
        const bySuffix = (suffix: string): string => clips.find((clip) => clip?.name?.endsWith(suffix))?.name ?? '';
        this.idleClip = bySuffix('-idle') || this.visualAnimation?.defaultClip?.name || clips[0]?.name || '';
        this.moveClip = bySuffix('-run') || this.idleClip;
        this.attackClip = bySuffix('-attack') || this.idleClip;
    }

    render(presentation: Readonly<IZCUnitPresentation>): void {
        const { unit, definition, x, y, now } = presentation;
        this.renderHealthBar(unit, definition, now);

        const size = definition.hero ? ZCUnitView.FOOT_SIZE_HERO : ZCUnitView.FOOT_SIZE_UNIT;
        if (this.appliedRootSize !== size) {
            this.rootTransform.setContentSize(size, size);
            this.appliedRootSize = size;
        }
        if (x !== this.appliedRootX || y !== this.appliedRootY) {
            this.node.setPosition(x, y, 0);
            this.appliedRootX = x;
            this.appliedRootY = y;
        }

        if (this.visualNode) {
            // 滞回判定：超过死区才翻转朝向，防止在 ~90°/270° 附近微调时每帧左右抽搐。
            const cos = Math.cos(unit.facingRadians);
            if (cos < -ZCUnitView.FACING_HYSTERESIS_COS) this.lastFacing = -1;
            else if (cos > ZCUnitView.FACING_HYSTERESIS_COS) this.lastFacing = 1;
            const facing = this.lastFacing;

            // 出生抖动：Y 拉 110% 回落 → X 拉 110% 回落，叠加在朝向翻转之上。
            let shakeX = 1;
            let shakeY = 1;
            if (this.spawnShakeStartedAt !== null) {
                const elapsed = now - this.spawnShakeStartedAt;
                if (elapsed < SPAWN_SHAKE_PHASE_SECONDS) {
                    shakeY = spawnShakePulse(elapsed / SPAWN_SHAKE_PHASE_SECONDS);
                } else if (elapsed < SPAWN_SHAKE_PHASE_SECONDS * 2) {
                    shakeX = spawnShakePulse((elapsed - SPAWN_SHAKE_PHASE_SECONDS) / SPAWN_SHAKE_PHASE_SECONDS);
                } else {
                    this.spawnShakeStartedAt = null;
                }
            }
            const scaleX = this.visualBaseScale.x * facing * shakeX;
            const scaleY = this.visualBaseScale.y * shakeY;
            // 值没变就不写 setScale：引擎会因它置脏标记，每帧无条件写是纯浪费。
            if (scaleX !== this.appliedVisualScaleX || scaleY !== this.appliedVisualScaleY) {
                this.appliedVisualScaleX = scaleX;
                this.appliedVisualScaleY = scaleY;
                this.visualScale.set(scaleX, scaleY, this.visualBaseScale.z);
                this.visualNode.setScale(this.visualScale);
                this.applyOutlineCopyScale(scaleX, scaleY);
            }
            const attacking = unit.battleState === 'attack';
            // target（索敌）本质是「正在接近目标」的过渡态，追击时每跨一格都会短暂经过，
            // 若把它当 idle 会导致 run 动画被频繁打断成 idle，看起来像「不切换动作」。
            const moving = unit.battleState === 'move'
                || unit.battleState === 'moveForward'
                || unit.battleState === 'target';
            const clip = attacking ? this.attackClip : moving ? this.moveClip : this.idleClip;
            const attackRestarted = attacking && (unit.completedAttackCount ?? 0) !== this.lastAttackCount;
            this.playClip(clip, attackRestarted);
            this.lastAttackCount = unit.completedAttackCount ?? 0;
            // 「其他玩家」= 非我方席位，与领地染色 / 城墙敌我判定同一个口径（`owner !== 'player'`）。
            // 优先级：阵亡 > 其他玩家 > 原色 —— 阵亡那条 alpha 190 已经在表达状态，再叠一层灰没有额外信息。
            this.applyVisualTint(unit.battleState === 'dead' ? ZCUnitView.TINT_DEAD
                : unit.owner === 'player' ? ZCUnitView.TINT_WHITE : ZCUnitView.TINT_OTHER_PLAYER);
        }

        this.renderOutline(unit);

        this.renderFallback(unit, definition);
    }

    /**
     * 整体外轮廓：只给「非我方席位 + 没阵亡 + 有 spine 外形可描」的单位显示。
     * 材质缺失（effect 没加载成功）时整层关掉，不影响其余表现。
     */
    private renderOutline(unit: Readonly<ZCUnitState>): void {
        const copy = this.outlineCopyNode;
        const skeleton = this.outlineCopySkeleton;
        if (!copy || !skeleton) return;
        const isVisible = this.outlineCopyMaterial !== null && this.visualSkeleton !== null
            && unit.owner !== 'player' && unit.battleState !== 'dead';
        if (copy.active !== isVisible) {
            copy.active = isVisible;
            // 从隐藏恢复显示时强制重对齐一次动画与轨道时间（防止隐藏期间未 update 导致相位脱节）。
            if (isVisible) this.outlineSyncedEpoch = -1;
        }
        if (!isVisible) return;

        // 位置与缩放全归 `attachOutlineCopy` / `applyOutlineCopyScale`，这里只管显隐、颜色与动画对齐。
        if (unit.owner !== this.appliedOutlineCopyOwner) {
            skeleton.color = ZCUnitView.OWNER_EDGE_COLOR[unit.owner];
            this.appliedOutlineCopyOwner = unit.owner;
        }
        this.syncOutlineCopyClip();
    }

    /**
     * 把副本的动画对齐到美术当前那一拍。
     *
     * 只在**代次变化**（或刚恢复显示）时 `setAnimation`：它会让轨道从头计时，每帧调一次等于副本永远停在第一帧。
     * 起播后同步主骨架当前的 `trackTime`，确保任何时刻激活副本都能与本体严丝合缝地锁相。
     * `setAnimation` 返回 null = 骨架还没就绪（与 `playClip` 同一条自愈路径）⇒ 不记代次，下一帧再来。
     */
    private syncOutlineCopyClip(): void {
        const skeleton = this.outlineCopySkeleton;
        if (!skeleton || !this.currentClip || this.outlineSyncedEpoch === this.outlineClipEpoch) return;
        const entry = skeleton.setAnimation(0, this.currentClip, true);
        if (entry) {
            const mainEntry = this.visualSkeleton?.getCurrent(0);
            if (mainEntry) entry.trackTime = mainEntry.trackTime;
            this.outlineSyncedEpoch = this.outlineClipEpoch;
        }
    }

    /**
     * 把 `visualAssetScale`（资产客观缩放）与 `visualSize`（策划配的 `pvpCard.prefabSize`）
     * 相乘写进 `visualBaseScale`，并立刻刷到节点上。
     *
     * **为什么要拆成两层而不是直接在 `initialize` 里乘一次**：
     * 节点是对象池复用的，`initialize` 有一条「同一个 prefab 直接复用美术子树」的早退分支。
     * 如果系数只在建节点时算一次，那条早退分支就会沿用**上一次**的系数 ——
     * 表里把某个兵的 `prefabSize` 从 1 改成 1.2，复用同一个 prefab 的另一个单位时
     * 就会带着错的尺寸渲染，且不报错。拆开后早退分支重算一次即可自愈。
     *
     * 顺序不能反：是「先按 canvas 归一（技术性），再乘 prefabSize（表现性）」。
     * 反过来的话 spine 单位会被自己的 canvas 高再抵消一次策划的意图。
     *
     * 复用同一个 `Vec3` 实例写入 —— 每帧/每次都 `new Vec3` 是 AGENTS.md 明令禁止的短命对象。
     */
    private applyVisualSize(): void {
        const asset = this.visualAssetScale;
        const size = this.visualSize;
        this.visualBaseScale.set(asset.x * size, asset.y * size, asset.z * size);
        // 朝向翻转由 render 每帧按 facing 重算，这里只把基准值写回去；
        // 强制下一帧重写（appliedVisualScaleX 置 NaN ⇒ NaN !== x 恒真）。
        this.appliedVisualScaleX = Number.NaN;
        this.visualNode?.setScale(this.visualBaseScale);
        this.applyOutlineCopyScale(this.visualBaseScale.x, this.visualBaseScale.y);
    }

    /**
     * 副本缩放 = 美术缩放 × `OUTLINE_COPY_SCALE` —— **唯一写入口**（`applyVisualSize` 与 `render`
     * 的朝向分支都走它）。必须与美术同朝向：副本是整只角色放大后的剪影，朝向反了描边会
     * 从角色的另一侧"长出来"，人马分离。
     */
    private applyOutlineCopyScale(scaleX: number, scaleY: number): void {
        const copy = this.outlineCopyNode;
        if (!copy) return;
        this.outlineCopyScale.set(
            scaleX * ZCUnitView.OUTLINE_COPY_SCALE,
            scaleY * ZCUnitView.OUTLINE_COPY_SCALE,
            this.visualBaseScale.z
        );
        copy.setScale(this.outlineCopyScale);
    }

    /**
     * 血条：一格一根，尺寸按英雄/普通两档，**只在尺寸变化时写一次**。
     *
     * - 尺寸只在变化时写，绝不能每帧写 —— 这是「打一下血条先短一下、下一帧又变回满血」的根因。
     *
     * 引擎 `ProgressBar._updateBarStatus` 有两个陷阱：
     *   ① totalLength / progress 的 setter 都在「值没变」时直接 return，不会重算；
     *   ② 重算时 宽度 = totalLength × progress，高度取填充条**当时**的 contentSize。
     * 老代码每次 render 都先把填充条 contentSize 写回 (width, height)（本意只想改高度）：
     * 宽度被抹成满条之后，紧接着的 totalLength / progress 双双因为值没变而早退、
     * 不再重算 → 满血前的那一帧看起来"闪"了一下，下一帧就停在满条（颜色仍按 ratio 走）。
     */
    private renderHealthBar(unit: Readonly<ZCUnitState>, definition: Readonly<ZCUnitDefinition>, now: number): void {
        const width = definition.hero ? this.barWidthHero : this.barWidth;
        const height = this.barHeight;
        if (width !== this.barAppliedWidth || height !== this.barAppliedHeight) {
            this.barAppliedWidth = width;
            this.barAppliedHeight = height;
            // 填充条比外框窄一圈：外框是「槽」（17 高），填充是槽里那条（8 高、左右各内缩 4）。
            const fillWidth = width - this.barFillInset * 2;
            // 先用「陷阱②」决定顺序：先写尺寸再设 totalLength，反了高度会停在 prefab 的旧值。
            this.healthBar.barSprite?.node.getComponent(UITransform)!.setContentSize(fillWidth, this.barFillHeight);
            this.healthBar.node.getComponent(UITransform)!.setContentSize(width, height);
            // 填充条锚点是 (0, 0.5)，靠 position 把左缘对齐到外框内沿（与引擎 _initBarSprite 同一算法）。
            this.healthBar.barSprite?.node.setPosition(-width / 2 + this.barFillInset, 0, 0);
            this.healthBar.totalLength = fillWidth;
            // 「陷阱①」：普通单位的 fillWidth 恰好等于 prefab 的 68 → 上一行也会因「值没变」早退，
            // 宽度就停在刚写进去的满条上。用一个越界值空写一次，逼 totalLength 必定重算
            // （同一次 render 内同步完成，中间态不会被绘制）。
            this.healthBar.totalLength = fillWidth + 1;
            this.healthBar.totalLength = fillWidth;
        }
        // 血条 Y 必须跟着 `prefabSize` 一起缩放：美术放大后头顶也跟着升
        // （基准 +69~+74，×1.2 就是 +83~+89），而条固定在 +80 就会**陷进脑袋里**。
        // 宽度不缩 —— 血条宽是「可读性」规格（56/64），跟着美术体型缩到 45 会读不出比例。
        const barOffsetY = this.barOffsetY * this.visualSize;
        if (barOffsetY !== this.barAppliedOffsetY) {
            this.healthBar.node.setPosition(0, barOffsetY, 0);
            this.barAppliedOffsetY = barOffsetY;
        }
        if (unit.hp !== this.barAppliedHp || unit.maxHp !== this.barAppliedMaxHp
            || unit.owner !== this.barAppliedOwner) {
            updateHealthBar(this.healthBar, unit.hp, unit.maxHp,
                pickHealthBarFill(unit.owner, this.barFillPlayer, this.barFillEnemy,
                    this.barFillEnemy2, this.barFillEnemy3));
            this.barAppliedHp = unit.hp;
            this.barAppliedMaxHp = unit.maxHp;
            this.barAppliedOwner = unit.owner;
        }
        // 「被攻击才有血条」：血量比上一帧少 = 这一帧挨了打（近战、弹道、持续伤害
        // 最终都会落到 hp 上）。第一次渲染只记录基线，不然新兵/复用节点一出生就亮条。
        if (this.observedHp !== null && unit.hp < this.observedHp) this.lastDamagedAt = now;
        this.observedHp = unit.hp;
        // 即使血量未变，时间窗口或死亡状态仍可改变可见性。
        const isVisible = Number.isFinite(unit.maxHp) && unit.maxHp > 0
            && unit.battleState !== 'dead'
            && isHealthBarVisible(this.lastDamagedAt, now);
        if (this.healthBar.node.active !== isVisible) this.healthBar.node.active = isVisible;
    }

    /**
     * 没有可用美术 prefab 时的兜底：圆点 + 「兵 / 弓 / 将」字。
     * 形态与归属没变就不重画（`fallbackKey` 是这三者的指纹）。
     */
    private renderFallback(unit: Readonly<ZCUnitState>, definition: Readonly<ZCUnitDefinition>): void {
        // 指纹用**位掩码**而不是模板字符串：这段每帧每单位都会跑，
        // `${a}|${b}|${c}` 每次都新建一个字符串（46 单位 × 60 帧 ≈ 2800 个/秒），
        // 而它只是拿来判"要不要重画"。四个因子各占一位，够用且零分配。
        const key = (this.visualNode ? 1 : 0)
            | (unit.owner === 'player' ? 2 : unit.owner === 'enemy' ? 4 : unit.owner === 'enemy2' ? 8 : 16)
            | (definition.hero ? 32 : 0)
            | (definition.attackRange > 100 ? 64 : 0);
        if (key === this.fallbackKey) return;
        this.fallbackKey = key;
        this.sprite.enabled = false;
        this.sprite.spriteFrame = null;
        this.fallback.clear();
        this.fallbackLabel.enabled = this.visualNode === null;
        if (this.visualNode) return;
        const radius = definition.hero
            ? ZCUnitView.FALLBACK_RADIUS_HERO : ZCUnitView.FALLBACK_RADIUS_UNIT;
        this.fallback.node.setPosition(0, radius, 0);
        this.fallbackLabel.node.setPosition(0, radius + 1, 0);
        this.fallback.fillColor = ZCUnitView.OWNER_EDGE_COLOR[unit.owner];
        this.fallback.circle(0, 0, radius);
        this.fallback.fill();
        this.fallbackLabel.string = definition.hero ? '将' : definition.attackRange > 100 ? '弓' : '兵';
    }

    /** 把美术色复位成原色（复用节点换形态时，上一条命的阵亡灰 / 其他玩家的灰都必须清掉）。 */
    private resetVisualTint(): void {
        this.appliedTint = -1;
        this.applyVisualTint(ZCUnitView.TINT_WHITE);
    }

    /**
     * 只给「手上真有的那一种渲染组件」上色。
     *
     * 序列帧单位有 `Sprite`、spine 单位有 `Skeleton`，二者互斥 —— 写成
     * `if (sprite) sprite.color = …` 而不带 `else` 时，spine 单位**永远不会变色**：
     * 阵亡不灰、其他玩家的兵不灰，都看不出区别（不报错、逻辑也没问题，纯表现缺失）。
     */
    private applyVisualTint(tint: number): void {
        if (this.appliedTint === tint) return;
        const color = tint === ZCUnitView.TINT_DEAD ? ZCUnitView.UNIT_DEAD_TINT
            : tint === ZCUnitView.TINT_OTHER_PLAYER ? ZCUnitView.OTHER_PLAYER_TINT
                : Color.WHITE;
        if (this.visualSprite) this.visualSprite.color = color;
        else if (this.visualSkeleton) this.visualSkeleton.color = color;
        else return;
        this.appliedTint = tint;
    }

    private playClip(name: string, restart: boolean): void {
        if (!name || (!restart && this.currentClip === name)) return;
        if (this.visualSkeleton) {
            // spine 走轨道 0。名字在 `initialize` 里已用骨架的动画名表探测过，正常不会触发
            // 引擎那条「动画不存在」的 warn（`logID 7509`）。
            //
            // 但 `setAnimation` 在骨架还没走完 `onLoad`（`this._skeleton` 为 null）时**返回 null
            // 且不生效**（引擎源码：`skeleton ? findAnimation(name) : null` → `logID(7509)` → return）。
            // 而 `initialize()` 是在 `instantiate()` 之后**立刻**调用的，赶不上骨架就绪。
            // 所以**只在真播上时写 `currentClip`**：没写的话，下一帧 `render()` 会再试一次（自愈）；
            // 写早了则 `currentClip === name` 会让它永远早退 —— 单位定格在 prefab 的 `defaultAnimation` 上
            // （豌豆射手 / 外卖僵尸 的 defaultAnimation 是 `die` ⇒ 一出生就躺下，且一条错都不报）。
            if (this.visualSkeleton.setAnimation(0, name, true)) {
                this.currentClip = name;
                // 整体外轮廓副本靠这个代次知道「该重新对一次动画了」（见 syncOutlineCopyClip）。
                this.outlineClipEpoch++;
            }
            return;
        }
        if (!this.visualAnimation) return;
        this.visualAnimation.play(name);
        this.currentClip = name;
    }
}