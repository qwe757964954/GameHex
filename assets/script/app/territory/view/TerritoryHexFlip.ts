import { EffectAsset, Material, Node, Sprite, type SpriteFrame, Vec2 } from 'cc';
import { HEX_GRID_IMAGE_HEIGHT } from '../../../core/hex/HexGridLayout';
import {
    HEX_FLIP_FOLD_SECONDS,
    HEX_FLIP_GLOW_MASK_OFFSET_Y,
    HEX_FLIP_IDLE_FX,
    HEX_FLIP_PERSPECTIVE,
    HEX_FLIP_PIVOT_LIFT,
    HEX_FLIP_SECONDS,
    hexFlipBodyGlow,
    hexFlipFoldFx,
    hexFlipFoldProgress,
    hexFlipGroundGlowStrength,
    hexFlipUnfoldFx,
    type IZCHexFlipFx,
} from '../../../core/hex/HexFlipPresentation';

/** 一次翻格的总时长（翻面段 + 合回段）；调用方用它判断「还在播」。 */
export const TERRITORY_HEX_FLIP_TOTAL_SECONDS = HEX_FLIP_SECONDS + HEX_FLIP_FOLD_SECONDS;

interface ITerritoryHexFlipActive {
    readonly node: Node;
    readonly sprite: Sprite;
    /** 底部发光子节点（`GroundGlow`，字段里没有就是这副地图没配序列帧）。 */
    readonly glow: Sprite | null;
    readonly basePosition: Readonly<{ x: number; y: number; z: number }>;
    /** 布局时的 siblingIndex：抬起期间会被提到同层末位，落回要按它归位。 */
    readonly homeIndex: number;
    readonly material: Material;
    /** 复用同一个 `Vec2` 写 `flipCenter` —— 每帧新建对象会在 update 里制造垃圾。 */
    readonly center: Vec2;
    elapsed: number;
    raised: boolean;
}

/**
 * 领地地图「翻开随机资源格」的翻格表现。
 *
 * 与对局的地块激活（`app/zcds/view/ZCHexView`）**共用**：
 *  - 动作曲线（抬起 / 压扁 / 合回）与时长 → `core/hex/HexFlipPresentation`；
 *  - 透视材质 → 同一份 `shaders/hex-flip.effect`，`flipHalfHeight` 也都取 `HEX_GRID_IMAGE_HEIGHT / 2`；
 *  - 观感参数 → `HEX_FLIP_PERSPECTIVE` 等同一批常量。
 *
 * 所以两处翻格的抬手高度、翻面角度、落回节奏、透视强度完全一致。差别只在**接线**：
 * 对局翻完接卡牌揭示（并有「整格隐藏」段），领地没有卡牌接棒 ⇒ 翻完直接**合回去**。
 *
 * ⚠️ 材质是**每格一份**（uniform 里含格心世界坐标）；播完必须摘回 `null` 并 `destroy()`，
 * 否则这一格会永久退出静态合批（不报错，只涨 DC）。
 */
export class TerritoryHexFlip {
    private flipEffect: EffectAsset | null = null;
    /** 底部发光的序列帧（与对局共用同一份 `image/effects/hex_ground_glow`）。 */
    private groundGlowFrames: readonly SpriteFrame[] = [];
    private readonly actives: ITerritoryHexFlipActive[] = [];

    /** 注入 `shaders/hex-flip` 的 effect；拿不到就整条表现静默关闭（不崩、不空）。 */
    setEffect(effect: EffectAsset | null): void {
        this.flipEffect = effect;
    }

    /** 注入底部发光的序列帧（按帧序）；空数组 ⇒ 只翻格、不画底光。 */
    setGroundGlowFrames(frames: readonly SpriteFrame[]): void {
        this.groundGlowFrames = frames ?? [];
    }

    get effectReady(): boolean {
        return this.flipEffect !== null;
    }

    isPlaying(node: Node): boolean {
        for (const active of this.actives) {
            if (active.node === node) return true;
        }
        return false;
    }

    /** 立刻复位全部在播的格子（换章 / 重渲染前调）。 */
    reset(): void {
        for (const active of this.actives) this.settle(active);
        this.actives.length = 0;
    }

    /**
     * 播一次翻格。
     * @returns 是否真的开始了（没有 effect、或这一格已经在播 ⇒ `false`，调用方无需处理）。
     */
    play(node: Node, sprite: Sprite): boolean {
        const effect = this.flipEffect;
        if (!effect || this.isPlaying(node)) return false;
        const material = new Material();
        material.initialize({ effectAsset: effect });
        const position = node.position;
        const active: ITerritoryHexFlipActive = {
            node,
            sprite,
            glow: node.getChildByName('GroundGlow')?.getComponent(Sprite) ?? null,
            basePosition: { x: position.x, y: position.y, z: position.z },
            homeIndex: node.getSiblingIndex(),
            material,
            center: new Vec2(),
            elapsed: 0,
            raised: false,
        };
        sprite.customMaterial = material;
        this.actives.push(active);
        this.apply(active, HEX_FLIP_IDLE_FX);
        return true;
    }

    /** 每帧推进。@returns 是否还有在播的（调用方可据此省掉后续工作）。 */
    step(dt: number): boolean {
        if (this.actives.length === 0) return false;
        for (let index = this.actives.length - 1; index >= 0; index -= 1) {
            const active = this.actives[index];
            active.elapsed += dt;
            const fx = this.fxAt(active.elapsed);
            if (!fx) {
                this.settle(active);
                this.actives.splice(index, 1);
                continue;
            }
            this.apply(active, fx);
        }
        return this.actives.length > 0;
    }

    /** 进度 → 表现参数；`null` = 已播完（该复位了）。 */
    private fxAt(elapsed: number): IZCHexFlipFx | null {
        if (elapsed >= TERRITORY_HEX_FLIP_TOTAL_SECONDS) return null;
        if (elapsed < HEX_FLIP_SECONDS) return hexFlipFoldFx(elapsed / HEX_FLIP_SECONDS);
        // 翻面段之后**合回去**：领地没有卡牌揭示接棒，停住就会只剩一条线（读作「格子没了」）。
        const fold = (elapsed - HEX_FLIP_SECONDS) / Math.max(1e-6, HEX_FLIP_FOLD_SECONDS);
        return hexFlipUnfoldFx(fold);
    }

    private apply(active: ITerritoryHexFlipActive, fx: IZCHexFlipFx): void {
        const { node, basePosition } = active;
        // 抬起期间提到同层末位，否则会被上排格子（画家排序在后）整图盖住。
        const raised = fx.tileLift > 0;
        if (raised !== active.raised) {
            active.raised = raised;
            this.reindex(node, raised ? Number.MAX_SAFE_INTEGER : active.homeIndex);
        }
        const targetY = basePosition.y + fx.tileLift + HEX_FLIP_PIVOT_LIFT * (1 - fx.tileFlip);
        if (node.position.y !== targetY) node.setPosition(basePosition.x, targetY, basePosition.z);
        // 透视路径下变形全在顶点层做，节点 scale 必须留在 1（否则叠成双重压扁）。
        if (node.scale.y !== 1 || node.scale.x !== 1) node.setScale(1, 1, 1);
        const world = node.worldPosition;
        const sin = Math.sqrt(Math.max(0, 1 - fx.tileFlip * fx.tileFlip));
        Vec2.set(active.center, world.x, world.y);
        const material = active.material;
        material.setProperty('flipCos', fx.tileFlip);
        material.setProperty('flipSin', sin);
        material.setProperty('flipPerspective', HEX_FLIP_PERSPECTIVE);
        material.setProperty('flipCenter', active.center);
        material.setProperty('flipHalfHeight', HEX_GRID_IMAGE_HEIGHT / 2);
        material.setProperty('glowStrength', hexFlipBodyGlow(fx.tileLift));
        this.applyGroundGlow(active, fx);
    }

    /**
     * 底部发光（开口光）：与对局**同一份序列帧、同一套进度推导**。
     *
     * 位置要**抵消父节点的上移**（父节点抬多少、Sprite 就往下补多少）⇒ 光带留在原格开口处；
     * 颜色跟随该格底图当前的颜色（地图格是绿/黄/灰，白光乘色后与地图同色系）。
     */
    private applyGroundGlow(active: ITerritoryHexFlipActive, fx: IZCHexFlipFx): void {
        const glow = active.glow;
        if (!glow) return;
        const frames = this.groundGlowFrames;
        const lit = frames.length > 0 && hexFlipGroundGlowStrength(fx.tileLift, fx.tileFlip) > 0.001;
        if (glow.node.active !== lit) glow.node.active = lit;
        if (!lit) return;
        glow.node.setPosition(0, HEX_FLIP_GLOW_MASK_OFFSET_Y - fx.tileLift, 0);
        const tint = active.sprite.color;
        if (!glow.color.equals(tint)) glow.color = tint;
        const progress = hexFlipFoldProgress(fx.tileLift, fx.tileFlip);
        const frame = frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))];
        if (frame && glow.spriteFrame !== frame) glow.spriteFrame = frame;
    }

    private settle(active: ITerritoryHexFlipActive): void {
        const { node, sprite, basePosition } = active;
        node.setPosition(basePosition.x, basePosition.y, basePosition.z);
        if (node.scale.x !== 1 || node.scale.y !== 1) node.setScale(1, 1, 1);
        if (active.raised) this.reindex(node, active.homeIndex);
        // 底光整块关掉（位置留给下次 play 重设）。
        if (active.glow?.node.active) active.glow.node.active = false;
        // 必须真的摘回 `null`（恢复内置 sprite 材质），否则这一格永久退出静态合批。
        if (sprite.customMaterial === active.material) sprite.customMaterial = null;
        active.material.destroy();
    }

    /** 把节点移到同层指定下标；越界按末位处理（布局可能刚重建过）。 */
    private reindex(node: Node, index: number): void {
        const parent = node.parent;
        if (!parent) return;
        node.setSiblingIndex(Math.max(0, Math.min(index, parent.children.length - 1)));
    }
}
