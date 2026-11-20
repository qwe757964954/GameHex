import { Animation, AssetManager, assetManager, Color, Graphics, instantiate, Node, Prefab, resources, sp, UITransform, Vec3 } from 'cc';
import { zcEffectAnchorOf, zcEffectLiftYOf, zcEffectNodeScaleOf } from '../model/ZCEffectCatalog';
import type { ITestKapaiStageLayout } from '../model/ZCTestKapaiModel';
import { ZC_SPINE_CANVAS_TARGET_HEIGHT } from '../view/ZCUnitView';

/** UI_2D 层。动态实例化的 prefab 默认落 DEFAULT，UI 相机整棵子树都不渲染。*/
const UI_2D_LAYER = 1 << 25;

/** 战斗格逻辑尺寸（`HexGridLayout` 的口径，世界 px）。*/
const GRID_CELL_WIDTH = 36;
const GRID_CELL_HEIGHT = 42;

/** 兵种美术 prefab 的固定子节点名（与 `ZCUnitView.VISUAL_SPINE_NODE_NAME` 同源）。*/
const SPINE_NODE_NAME = 'spine';

/** 战斗资源包；`pvpSkill.effectPrefabPath` 都落在这里。*/
const BATTLE_BUNDLE = 'battle';

/** 特效播放余量：clip 播完后多留一点，避免尾帧被硬切。*/
const EFFECT_TAIL_SECONDS = 0.35;

/** 特效最长存活时间：`cc.Animation` 缺省 clip 时长时用它兜底，防止节点泄漏。*/
const EFFECT_MAX_SECONDS = 3;

interface IStageEffect {
    readonly node: Node;
    readonly expireAt: number;
}

/**
 * 场景节点引用：舞台里所有节点都由 `TestKapai.scene` 提供（Cocos MCP 创建），
 * 本类只负责挂模型 / 播特效 / 画格子与范围圈，**不创建任何 UI 节点**。
 */
export interface IZCTestKapaiStageRefs {
    readonly host: Node;
    readonly grid: Graphics;
    readonly rangeRing: Graphics;
    readonly aoeRing: Graphics;
    readonly unitAnchor: Node;
    readonly targetAnchor: Node;
    readonly effectAnchor: Node;
    readonly targetRing: Graphics;
}

/**
 * 卡牌验证台的舞台：spine 兵种模型 + 技能释放特效。
 *
 * 尺寸口径**不在这里发明**：
 * - 单位：`ZC_SPINE_CANVAS_TARGET_HEIGHT / 骨架 canvas 高 × pvpCard.prefabSize × modelScale × viewScale`
 *   （前两段与 `ZCUnitView.applyVisualSize` 完全一致，`modelScale` 只模拟 `prefabSize` 改配表）
 * - 特效：`zcEffectNodeScaleOf(path) × effectScale × viewScale`
 *
 * 视图倍率 `viewScale` 同时乘在模型 / 特效 / 格子上 ⇒ 舞台里「兵 vs 特效 vs 格子」的相对比例
 * 与战场一致；切到 1.0 就是战场 1:1，切到 4.2 只是把同一画面放大看细节。
 */
export class ZCTestKapaiStage {
    private unitNode: Node | null = null;
    private unitPrefabPath = '';
    /** 当前模型的基准缩放 = 69.4 / 骨架 canvas 高 × prefabSize；不含覆盖与视图。*/
    private unitBaseScale = 0;
    private unitPrefabSize = 1;
    /** spine 节点自身的设计高度；用来还原"屏幕上到底多高"，而不是只看节点缩放。*/
    private unitVisualHeight = 0;
    /** 最近一次画的射程 / 范围，用于视图切换后重绘。*/
    private lastAttackRange = 0;
    private lastAreaRadius = 0;
    /** 异步加载令牌：切卡比加载快时，旧请求的产物必须丢掉。*/
    private unitToken = 0;

    private effectRoot: Node | null = null;
    private readonly effects: IStageEffect[] = [];

    private readonly prefabCache = new Map<string, Prefab>();
    private battleBundle: AssetManager.Bundle | null = null;
    private elapsed = 0;
    private disposed = false;

    /** 视图倍率：1.0 = 战场 1:1，其余档位只放大观察。*/
    private viewScale: number;
    /** 模型 / 特效的调试覆盖（1 = 不改配置）。*/
    private modelScale = 1;
    private effectScale = 1;

    constructor(
        private readonly refs: IZCTestKapaiStageRefs,
        private readonly layout: ITestKapaiStageLayout,
        private readonly onStatus: (text: string, color: string) => void,
    ) {
        this.viewScale = layout.viewScale > 0 ? layout.viewScale : 1;
        this.effectRoot = refs.effectAnchor;
    }

    /* ---------------------------------------------------------------- *
     * 初始化
     * ---------------------------------------------------------------- */

    initialize(): void {
        this.refs.effectAnchor.setPosition(0, this.layout.effectOffsetY, 0);
        this.paintStage();
        this.setRanges(0, 0);
    }

    /** 视图倍率切换：模型 / 特效 / 格子一起变，重绘格子与范围圈。*/
    setViewScale(scale: number): void {
        if (!(scale > 0) || scale === this.viewScale) return;
        this.viewScale = scale;
        this.paintStage();
        this.setRanges(this.lastAttackRange, this.lastAreaRadius);
        this.applyUnitScale();
        this.onStatus(`视图 ×${formatScale(scale)}（1.0 = 战场 1:1）`, this.layout.guideColor);
    }

    /** 模型调试覆盖：只改模型，用来模拟 `pvpCard.prefabSize` 改表后的观感。*/
    setModelScale(scale: number): void {
        if (!(scale > 0)) return;
        this.modelScale = scale;
        this.applyUnitScale();
    }

    /** 特效调试覆盖：只改特效，用来模拟 `zcEffectNodeScaleOf` 调整后的观感。*/
    setEffectScale(scale: number): void {
        if (!(scale > 0)) return;
        this.effectScale = scale;
        this.onStatus(`特效 ×${formatScale(scale)}（下一次释放生效）`, this.layout.guideColor);
    }

    /** 当前视图倍率（供 UI 展示）。*/
    viewScaleOf(): number {
        return this.viewScale;
    }

    /** 模型在舞台上的实际高度（设计像素）与占格数；未加载时返回 null。*/
    unitSizeOf(): { height: number; cells: number } | null {
        if (!this.unitNode?.isValid || this.unitVisualHeight <= 0) return null;
        const height = this.unitVisualHeight * this.unitNode.scale.x;
        return { height, cells: height / (GRID_CELL_HEIGHT * this.viewScale) };
    }

    /* ---------------------------------------------------------------- *
     * 格子与范围
     * ---------------------------------------------------------------- */

    /** 深色底 + 六边格 + 地平线 + 靶子落点圈。*/
    private paintStage(): void {
        const grid = this.refs.grid;
        const size = this.refs.host.getComponent(UITransform)!.contentSize;
        const scale = this.viewScale;
        grid.clear();
        grid.fillColor = toColor(this.layout.gridFillColor);
        grid.rect(-size.width / 2, -size.height / 2, size.width, size.height);
        grid.fill();

        // 六边格：与战场同一个 36×42 逻辑格，按视图倍率整体缩放。
        const cellWidth = GRID_CELL_WIDTH * scale;
        const cellHeight = GRID_CELL_HEIGHT * scale;
        const halfW = cellWidth / 2;
        const halfH = cellHeight / 2;
        const quarterW = cellWidth / 4;
        const rows = Math.ceil(size.height / cellHeight) + 1;
        const columns = Math.ceil(size.width / cellWidth) + 1;
        grid.strokeColor = toColor(this.layout.gridColor);
        grid.lineWidth = 2;
        for (let row = -1; row <= rows; row += 1) {
            const centerY = row * cellHeight;
            for (let column = -1; column <= columns; column += 1) {
                const centerX = column * cellWidth + (row % 2 === 0 ? 0 : cellWidth / 2);
                grid.moveTo(centerX - halfW, centerY);
                grid.lineTo(centerX - quarterW, centerY + halfH);
                grid.lineTo(centerX + quarterW, centerY + halfH);
                grid.lineTo(centerX + halfW, centerY);
                grid.lineTo(centerX + quarterW, centerY - halfH);
                grid.lineTo(centerX - quarterW, centerY - halfH);
                grid.close();
            }
        }
        grid.stroke();

        // 地平线：脚点所在高度，给模型一个"站地上"的落点感。
        grid.strokeColor = toColor(this.layout.gridColor);
        grid.lineWidth = 2;
        grid.moveTo(-size.width / 2 + 16, this.layout.groundOffsetY);
        grid.lineTo(size.width / 2 - 16, this.layout.groundOffsetY);
        grid.stroke();

        // 我方脚下的格子高亮：一眼看出模型占了几格。
        const cellColor = toColor(this.layout.gridColor);
        grid.fillColor = new Color(cellColor.r, cellColor.g, cellColor.b, 55);
        grid.rect(
            this.layout.unitOffsetX - cellWidth / 2,
            this.layout.groundOffsetY - cellHeight / 2,
            cellWidth,
            cellHeight,
        );
        grid.fill();

        // 双方脚点的连线：长度就是目标距离，和射程值一起看是否够得着。
        grid.strokeColor = toColor(this.layout.gridColor);
        grid.lineWidth = 1.2;
        grid.moveTo(this.layout.unitOffsetX, this.layout.groundOffsetY + 14);
        grid.lineTo(this.layout.targetOffsetX, this.layout.groundOffsetY + 14);
        grid.stroke();

        // 靶子落点圈。
        const targetRing = this.refs.targetRing;
        const radius = GRID_CELL_WIDTH * scale * 0.55;
        targetRing.clear();
        targetRing.strokeColor = toColor(this.layout.guideColor);
        targetRing.lineWidth = 2;
        targetRing.ellipse(0, 0, radius, radius * 0.42);
        targetRing.stroke();
    }

    /**
     * 画射程圈（我方脚点）与技能范围圈（靶子）：
     * 半径都是世界 px × 视图倍率，和格子同一把尺子。
     */
    setRanges(attackRange: number, areaRadius: number): void {
        this.lastAttackRange = attackRange;
        this.lastAreaRadius = areaRadius;
        const range = this.refs.rangeRing;
        range.clear();
        if (attackRange > 0) {
            const radius = attackRange * this.viewScale;
            const centerX = this.layout.unitOffsetX;
            const centerY = this.layout.groundOffsetY;
            range.strokeColor = toColor(this.layout.guideColor);
            range.lineWidth = 2.2;
            this.strokeCircleClipped(range, centerX, centerY, radius);
            range.strokeColor = toColor(this.layout.gridColor);
            range.lineWidth = 1.4;
            this.strokeCircleClipped(range, centerX, centerY, radius - 2.5);
        }

        const aoe = this.refs.aoeRing;
        aoe.clear();
        if (areaRadius > 0) {
            const radius = areaRadius * this.viewScale;
            const centerX = this.layout.targetOffsetX;
            const centerY = this.layout.groundOffsetY;
            aoe.strokeColor = toColor(this.layout.errorColor);
            aoe.lineWidth = 2.2;
            this.strokeCircleClipped(aoe, centerX, centerY, radius);
        }
    }

    /** 只画舞台矩形内的圆弧：Graphics 不受 Mask 裁剪，必须在几何层截断。*/
    private strokeCircleClipped(graphics: Graphics, centerX: number, centerY: number, radius: number): void {
        const size = this.refs.host.getComponent(UITransform)!.contentSize;
        const halfWidth = size.width / 2 - 1;
        const halfHeight = size.height / 2 - 1;
        const segments = Math.max(64, Math.ceil(radius / 6));
        let drawing = false;
        for (let index = 0; index <= segments; index += 1) {
            const angle = index / segments * Math.PI * 2;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            if (Math.abs(x) <= halfWidth && Math.abs(y) <= halfHeight) {
                if (!drawing) {
                    graphics.moveTo(x, y);
                    drawing = true;
                } else {
                    graphics.lineTo(x, y);
                }
            } else {
                drawing = false;
            }
        }
        graphics.stroke();
    }

    /* ---------------------------------------------------------------- *
     * 单位模型
     * ---------------------------------------------------------------- */

    /**
     * 展示某张卡的兵种模型。
     *
     * @param prefabPath `pvpCard.unitPrefabPath`（`skel/<名>/<名>`）
     * @param prefabSize `pvpCard.prefabSize`
    */
    async showUnit(prefabPath: string, prefabSize: number): Promise<void> {
        if (!prefabPath) {
            this.clearUnit();
            this.onStatus('该卡没有 unitPrefabPath（建筑卡不出兵）', this.layout.errorColor);
            return;
        }
        if (this.unitPrefabPath === prefabPath && this.unitNode?.isValid) {
            this.setModelScale(this.modelScale);
            return;
        }
        this.unitPrefabPath = prefabPath;
        this.unitToken += 1;
        const token = this.unitToken;
        this.onStatus('模型加载中…', this.layout.loadingColor);

        let prefab: Prefab;
        try {
            prefab = await this.loadResourcePrefab(prefabPath);
        } catch (error) {
            if (token !== this.unitToken) return;
            this.clearUnit();
            this.onStatus(`模型加载失败：${prefabPath}（${errorText(error)}）`, this.layout.errorColor);
            return;
        }
        if (token !== this.unitToken || this.disposed || !this.refs.unitAnchor.isValid) return;

        this.clearUnit();
        const node = instantiate(prefab);
        node.setParent(this.refs.unitAnchor);
        node.setPosition(Vec3.ZERO);
        applyLayer(node);

        const skeletonNode = node.getChildByName(SPINE_NODE_NAME);
        const skeleton = skeletonNode?.getComponent(sp.Skeleton) ?? node.getComponentInChildren(sp.Skeleton);
        if (!skeleton || !skeleton.skeletonData) {
            node.removeFromParent();
            node.destroy();
            this.onStatus(`模型缺少 spine 骨架：${prefabPath}`, this.layout.errorColor);
            return;
        }

        const canvasHeight = skeletonHeightOf(skeleton);
        if (!(canvasHeight > 0)) {
            node.removeFromParent();
            node.destroy();
            this.onStatus(`骨架 canvas 高度无效：${prefabPath}`, this.layout.errorColor);
            return;
        }
        const size = Number.isFinite(prefabSize) && prefabSize > 0 ? prefabSize : 1;
        const visual = (skeletonNode ?? node).getComponent(UITransform);
        this.unitVisualHeight = visual ? visual.contentSize.height : 0;
        this.unitPrefabSize = size;
        this.unitBaseScale = ZC_SPINE_CANVAS_TARGET_HEIGHT / canvasHeight * size;
        this.unitNode = node;

        const clip = pickSkeletonAnimation(skeleton, 'idle');
        if (clip) skeleton.setAnimation(0, clip, true);
        this.applyUnitScale();
        this.setRanges(this.lastAttackRange, this.lastAreaRadius);
    }

    /** 重新写模型缩放：基准 × 模型覆盖 × 视图倍率，并刷新口径文案。*/
    private applyUnitScale(): void {
        const node = this.unitNode;
        if (!node || !node.isValid || this.unitBaseScale <= 0) return;
        const scale = this.unitBaseScale * this.modelScale * this.viewScale;
        node.setScale(scale, scale, 1);
        const rendered = this.unitVisualHeight > 0 ? this.unitVisualHeight * scale : 0;
        const distance = Math.abs(this.layout.targetOffsetX - this.layout.unitOffsetX);
        const rangeText = this.lastAttackRange > 0
            ? ` · 射程 ${round1(this.lastAttackRange)} / 目标 ${round1(distance)}`
                + (distance > this.lastAttackRange ? '（范围外）' : '')
            : '';
        this.onStatus(
            `模型 ${round1(rendered)}px · ${round2(rendered / (GRID_CELL_HEIGHT * this.viewScale))} 格${rangeText}`,
            this.layout.guideColor,
        );
    }

    clearUnit(): void {
        if (this.unitNode?.isValid) {
            this.unitNode.removeFromParent();
            this.unitNode.destroy();
        }
        this.unitNode = null;
        this.unitBaseScale = 0;
    }

    /* ---------------------------------------------------------------- *
     * 技能特效
     * ---------------------------------------------------------------- */

    /**
     * 播放一次技能特效。
     *
     * @param effectPrefabPath `pvpSkill.effectPrefabPath`（battle bundle 内路径）
     * @returns `{ battle, total }`：`battle` 是 `zcEffectNodeScaleOf` 的战斗倍率，
     *          `total` 是乘上覆盖与视图倍数后的实际缩放；`null` 表示没有可播的特效。
     */
    async playEffect(effectPrefabPath: string): Promise<{ battle: number; total: number } | null> {
        if (!effectPrefabPath || !this.effectRoot?.isValid) return null;
        let prefab: Prefab;
        try {
            prefab = await this.loadBattlePrefab(effectPrefabPath);
        } catch (error) {
            this.onStatus(`特效加载失败：${effectPrefabPath}（${errorText(error)}）`, this.layout.errorColor);
            return null;
        }
        if (this.disposed || !this.effectRoot?.isValid) return null;

        // 锚点与战场同源：`caster` 落在单位脚点，`midpoint` 落在两者中点。
        const anchor = zcEffectAnchorOf(effectPrefabPath) === 'caster' ? this.refs.unitAnchor : this.refs.effectAnchor;
        const node = instantiate(prefab);
        node.setParent(anchor);
        node.setPosition(0, zcEffectLiftYOf(effectPrefabPath) * this.viewScale, 0);
        applyLayer(node);

        const battleScale = zcEffectNodeScaleOf(effectPrefabPath);
        const scale = battleScale * this.effectScale * this.viewScale;
        node.setScale(scale, scale, 1);

        const animation = node.getComponent(Animation) ?? node.getComponentInChildren(Animation);
        const clipName = animation?.defaultClip?.name || animation?.clips?.[0]?.name || '';
        if (animation && clipName) {
            animation.stop();
            animation.play(clipName);
        }
        const skeleton = node.getComponent(sp.Skeleton) ?? node.getComponentInChildren(sp.Skeleton);
        if (!animation && skeleton) {
            const clip = pickSkeletonAnimation(skeleton, 'animation');
            if (clip) skeleton.setAnimation(0, clip, false);
        }

        const clipSeconds = animation?.defaultClip?.duration;
        const life = Number.isFinite(clipSeconds) && clipSeconds > 0
            ? Math.min(EFFECT_MAX_SECONDS, clipSeconds + EFFECT_TAIL_SECONDS)
            : EFFECT_MAX_SECONDS;
        this.effects.push({ node, expireAt: this.elapsed + life });
        return { battle: battleScale, total: scale };
    }

    /* ---------------------------------------------------------------- *
     * 帧驱动与清理
     * ---------------------------------------------------------------- */

    update(dt: number): void {
        this.elapsed += dt;
        for (let index = this.effects.length - 1; index >= 0; index -= 1) {
            const effect = this.effects[index];
            if (this.elapsed < effect.expireAt) continue;
            if (effect.node.isValid) {
                effect.node.removeFromParent();
                effect.node.destroy();
            }
            this.effects.splice(index, 1);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.unitToken += 1;
        this.clearUnit();
        for (const effect of this.effects) {
            if (!effect.node.isValid) continue;
            effect.node.removeFromParent();
            effect.node.destroy();
        }
        this.effects.length = 0;
        this.prefabCache.clear();
        this.battleBundle = null;
        this.effectRoot = null;
    }

    /* ---------------------------------------------------------------- *
     * 资源
     * ---------------------------------------------------------------- */

    private loadResourcePrefab(path: string): Promise<Prefab> {
        const cached = this.prefabCache.get(`res:${path}`);
        if (cached) return Promise.resolve(cached);
        return new Promise<Prefab>((resolve, reject) => {
            resources.load(path, Prefab, (error: Error | null, prefab: Prefab) => {
                if (error || !prefab) {
                    reject(error ?? new Error('返回空 prefab'));
                    return;
                }
                this.prefabCache.set(`res:${path}`, prefab);
                resolve(prefab);
            });
        });
    }

    private async loadBattlePrefab(path: string): Promise<Prefab> {
        const cached = this.prefabCache.get(`battle:${path}`);
        if (cached) return cached;
        const bundle = await this.ensureBattleBundle();
        const prefab = await new Promise<Prefab>((resolve, reject) => {
            bundle.load(path, Prefab, (error: Error | null, asset: Prefab) => {
                if (error || !asset) {
                    reject(error ?? new Error(`battle 包内不存在：${path}`));
                    return;
                }
                resolve(asset);
            });
        });
        this.prefabCache.set(`battle:${path}`, prefab);
        return prefab;
    }

    private ensureBattleBundle(): Promise<AssetManager.Bundle> {
        if (this.battleBundle) return Promise.resolve(this.battleBundle);
        return new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle(BATTLE_BUNDLE, (error: Error | null, bundle: AssetManager.Bundle) => {
                if (error || !bundle) {
                    reject(error ?? new Error('battle 包加载失败'));
                    return;
                }
                this.battleBundle = bundle;
                resolve(bundle);
            });
        });
    }
}

/* ------------------------------------------------------------------ *
 * 纯工具
 * ------------------------------------------------------------------ */

function applyLayer(node: Node): void {
    node.layer = UI_2D_LAYER;
    for (const child of node.children) applyLayer(child);
}

/**
 * 骨架的运行时数据（高度 + 动画名表）。
 *
 * 必须走 `getRuntimeData(true)`：`sp.Skeleton` 的 `skeleton` 在 3.8.8 是私有字段
 * （只有 `_skeleton`），而 `skeletonData` 本身不带动画列表。`getRuntimeData` 是两者唯一的
 * 公开出口，`ZCUnitView.spineCanvasHeight` 读高度也是同一条路。
*/
interface ISpineRuntimeData {
    readonly height?: number;
    readonly animations?: readonly { readonly name?: string }[];
}

function spineRuntimeOf(skeleton: sp.Skeleton): ISpineRuntimeData | null {
    const data = skeleton.skeletonData;
    if (!data) return null;
    try {
        return data.getRuntimeData(true) as ISpineRuntimeData | null;
    } catch {
        return null;
    }
}

/** 骨架 canvas 高；取不到按 0 交给调用方判错。*/
function skeletonHeightOf(skeleton: sp.Skeleton): number {
    const runtime = spineRuntimeOf(skeleton);
    const height = runtime?.height;
    return typeof height === 'number' && Number.isFinite(height) ? height : 0;
}

/** 优先 idle，其次第一个动画；没有动画返回空串。*/
function pickSkeletonAnimation(skeleton: sp.Skeleton, preferred: string): string {
    const animations = spineRuntimeOf(skeleton)?.animations ?? [];
    if (!animations.length) return '';
    const names = animations.map((item) => item?.name ?? '');
    return names.includes(preferred) ? preferred : (names[0] ?? '');
}

function toColor(hex: string): Color {
    const value = hex.startsWith('#') ? hex.slice(1) : hex;
    const r = parseInt(value.substring(0, 2), 16) || 0;
    const g = parseInt(value.substring(2, 4), 16) || 0;
    const b = parseInt(value.substring(4, 6), 16) || 0;
    const a = value.length >= 8 ? parseInt(value.substring(6, 8), 16) : 255;
    return new Color(r, g, b, Number.isFinite(a) ? a : 255);
}

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function formatScale(value: number): string {
    return Number.isInteger(value) ? String(value) : String(round2(value));
}
