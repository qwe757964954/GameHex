import { EffectAsset, Material, Node, Sprite, UITransform, Vec2, Vec4, type SpriteFrame } from 'cc';
import { HEX_GRID_IMAGE_HEIGHT, HEX_GRID_IMAGE_WIDTH } from '../../../core/hex/HexGridLayout';
import {
    HEX_FLIP_GLOW_MASK_OFFSET_Y,
    HEX_FLIP_IDLE_FX,
    HEX_SHATTER_ERODE_END,
    HEX_SHATTER_GRID_X,
    HEX_SHATTER_GRID_Y,
    HEX_SHATTER_JITTER,
    HEX_SHATTER_SECONDS,
    hexFlipFoldProgress,
    hexFlipGroundGlowStrength,
    hexShatterFx,
    type IZCHexFlipFx,
} from '../../../core/hex/HexFlipPresentation';

/** 「新地皮」子节点名（`TerritoryMapView.createHex` 挂；放大写在它身上）。 */
export const TERRITORY_HEX_REVEAL_NODE = 'Reveal';

/**
 * 翻格时「旧 / 新」两张地皮。
 *
 * ⚠️ **必须成对给**：`applyFace` 只要少一张就整条不动帧。
 *  为什么不能只给新的：点击那一帧 `paintHexes` 已经把地皮**换成新的**了（进度先于动画更新），
 *  不给旧的就等于「从新地皮开始翻」，读不出「翻开」这件事；
 *  为什么不能只给旧的：动画结束会停在旧地皮上（表现为「翻完还是泥巴」）。
 */
export interface ITerritoryHexFlipFrames {
    readonly from?: SpriteFrame | null;
    readonly to?: SpriteFrame | null;
}

interface ITerritoryHexFlipActive {
    readonly node: Node;
    readonly sprite: Sprite;
    /** 底部发光子节点（`GroundGlow`，字段里没有就是这副地图没配序列帧）。 */
    readonly glow: Sprite | null;
    /** 「新地皮」子节点（`Reveal`，放大写它；字段里没有就退化成「不放大地出现」）。 */
    readonly reveal: Sprite | null;
    readonly basePosition: Readonly<{ x: number; y: number; z: number }>;
    readonly material: Material;
    /** 复用同一个 `Vec2` 写 `flipCenter` —— 每帧新建对象会在 update 里制造垃圾。 */
    readonly center: Vec2;
    /** 材质参数的复用容器（每帧重写；`setProperty` 当场把数值拷进该材质自己的 uniform 缓冲）。 */
    readonly flashParams: Vec4;
    readonly shatterParams: Vec4;
    readonly shardGrid: Vec4;
    /** 格内半尺寸（**世界单位**，由格子的实际 `UITransform` 尺寸 × 世界缩放派生）。 */
    readonly half: Readonly<{ x: number; y: number }>;
    readonly fromFrame: SpriteFrame | null;
    readonly toFrame: SpriteFrame | null;
    /** 碎块朝向 / 延迟的随机种子（每次播放换一个 ⇒ 同一格两次碎裂不会一模一样）。 */
    readonly seed: number;
    elapsed: number;
}

/** 取格子的半尺寸（世界单位）：`flipHalfHeight` / `flipHalfWidth` 与格内归一化坐标都靠它。 */
function readTileHalfSize(node: Node): { x: number; y: number } {
    // 帧到位后 `applyTileFrame` 会把 `contentSize` 写成帧的 `originalSize`（现美术 126×117，
    // 与设计常量 130×119 差一圈），所以**以实际尺寸为准**，取不到才退回设计常量。
    const size = node.getComponent(UITransform)?.contentSize;
    const scale = node.worldScale;
    return {
        x: ((size && size.width > 0 ? size.width : HEX_GRID_IMAGE_WIDTH) / 2) * Math.abs(scale.x || 1),
        y: ((size && size.height > 0 ? size.height : HEX_GRID_IMAGE_HEIGHT) / 2) * Math.abs(scale.y || 1),
    };
}

/**
 * 领地地图「翻开随机资源格」的翻格表现。
 *
 * ## 只剩「原地快碎裂」（2026-10-16 用户口径）
 *
 * 需求原文：「地块反转动画优化，两种方案都做，点击后随机播放，让我根据播放的结果判断只保留
 * 哪一种方案」⇒ 用户看完两套后拍板「**只保留地块破碎效果的方案**」。于是：
 *  · **保留**：`hexShatterFx` —— **原地快碎裂**（片元级碎块腐蚀，材质做）→ 新地皮从格心放大
 *    填充（写在 `Reveal` 子节点上）；
 *  · **删除**：抬起后绕水平轴垂直翻转 360° 的那套（`hexTurnFx`）、随机点将
 *    （`pickHexFlipVariant` + 本类的 `variant` / `lastVariant` / `setRandom` 点将用法），
 *    以及只有它需要的接线：`tileSin` / `flipPerspective` / `flipCos` / `flipSin` /
 *    `turnParams`（侧视淡出）与「抬起期间提到同层末位」的 siblingIndex 处理。
 *    着色器那四段（顶点 3D 旋转 + 透视除法 / 体积明暗 / 侧视淡出 / 补光）一并删除，
 *    且删除都是**逐像素等价**的 —— 理由见 `core/hex/HexFlipPresentation` 的模块头注释。
 *
 * ## 与对局共用什么
 *
 *  · 材质 → 同一份 `shaders/hex-flip.effect`（**只剩碎裂**那部分）；
 *  · 动作曲线与时长 → `core/hex/HexFlipPresentation`（`hexShatterFx` / `HEX_SHATTER_SECONDS`）；
 *  · 底光那套强度 / 帧序推导 → 同一个写口（⚠️ 碎裂不抬起 ⇒ 这道光恒灭，见 `applyGroundGlow`）。
 * 差别只在**接线**：对局翻完接卡牌揭示（并有「整格隐藏」段），领地翻完就停在新地皮上。
 *
 * ## ⚠️ 材质是**每格一份**
 *
 * uniform 里含格心世界坐标与随机种子 ⇒ 不能共享一份材质。播完必须摘回 `null` 并 `destroy()`，
 * 否则这一格会永久退出静态合批（不报错，只涨 DC）。
 */
export class TerritoryHexFlip {
    private flipEffect: EffectAsset | null = null;
    /** 底部发光的序列帧（与对局共用同一份 `image/effects/hex_ground_glow`）。 */
    private groundGlowFrames: readonly SpriteFrame[] = [];
    private readonly actives: ITerritoryHexFlipActive[] = [];
    /** 碎块朝向 / 延迟的随机源：运行时就是 `Math.random`，用例可注入确定性序列。 */
    private random: () => number = Math.random;

    /** 注入 `shaders/hex-flip` 的 effect；拿不到就整条表现静默关闭（不崩、不空）。 */
    setEffect(effect: EffectAsset | null): void {
        this.flipEffect = effect;
    }

    /** 注入底部发光的序列帧（按帧序）；空数组 ⇒ 只翻格、不画底光。 */
    setGroundGlowFrames(frames: readonly SpriteFrame[]): void {
        this.groundGlowFrames = frames ?? [];
    }

    /** 注入碎块随机源（`null` 还原成 `Math.random`）。**只给用例用**，运行时不用调。 */
    setRandom(random: (() => number) | null): void {
        this.random = random ?? Math.random;
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
     * 播一次翻格（「原地快碎裂」）。
     *
     * @param frames 旧 / 新两张地皮；缺一张就整条不动帧（理由见 `ITerritoryHexFlipFrames`）
     * @returns 是否真的开始了（没有 effect、或这一格已经在播 ⇒ `false`，调用方无需处理）
     */
    play(node: Node, sprite: Sprite, frames?: ITerritoryHexFlipFrames): boolean {
        const effect = this.flipEffect;
        if (!effect || this.isPlaying(node)) return false;
        const material = new Material();
        material.initialize({ effectAsset: effect });
        const position = node.position;
        const active: ITerritoryHexFlipActive = {
            node,
            sprite,
            glow: node.getChildByName('GroundGlow')?.getComponent(Sprite) ?? null,
            reveal: node.getChildByName(TERRITORY_HEX_REVEAL_NODE)?.getComponent(Sprite) ?? null,
            basePosition: { x: position.x, y: position.y, z: position.z },
            material,
            center: new Vec2(),
            flashParams: new Vec4(0, 0, 0, 0),
            shatterParams: new Vec4(0, 0, 0, 0),
            shardGrid: new Vec4(HEX_SHATTER_GRID_X, HEX_SHATTER_GRID_Y, 0, 0),
            half: readTileHalfSize(node),
            fromFrame: frames?.from ?? null,
            toFrame: frames?.to ?? null,
            seed: this.random() * 32,
            elapsed: 0,
        };
        sprite.customMaterial = material;
        this.actives.push(active);
        // 起手先按静止态写一遍（**不能省**）：材质是当场 `new` 的，uniform 还是出厂值
        // （`flipCenter = [0,0]` / `shatterParams.x = 0`），且 `applyFace` 还没跑 —— 这一帧
        // 会渲染出「没有碎块网格、且可能是新地皮」的画面。写一遍 idle 之后，play 这一帧
        // 就已经是「旧地皮、完好、按本格格心划分碎块」的静止态，下一帧才从 0 起碎裂。
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

    /**
     * 段内已过秒数 → 表现参数；`null` = 已播完（该复位了）。
     *
     * 时长与曲线都取自 core 的同一个模块（这里只做「按 `HEX_SHATTER_SECONDS` 归一化」，
     * 不写死任何秒数）。
     */
    private fxAt(elapsed: number): IZCHexFlipFx | null {
        if (elapsed >= HEX_SHATTER_SECONDS) return null;
        return hexShatterFx(elapsed / HEX_SHATTER_SECONDS);
    }

    private apply(active: ITerritoryHexFlipActive, fx: IZCHexFlipFx): void {
        const { node, basePosition } = active;
        // 🔴 **不动画家排序**：碎裂是「原地」的（`tileLift` 恒 0），地块既不会抬起来、碎片也
        //    不会伸到邻格头上，所以不需要像早先那套翻整圈那样「抬起期间提到同层末位」。
        // 格心坐标也不动（需求原文「原地快碎裂」）：只有「被别处挪过」时才掰回基准。
        if (node.position.y !== basePosition.y) node.setPosition(basePosition.x, basePosition.y, basePosition.z);
        // 格根缩放恒 `1`（新地皮的放大写在子节点 `Reveal` 上，见 `applyReveal`）——
        // 池化复用回来的节点若带着脏缩放，这里掰回来。
        if (node.scale.y !== 1 || node.scale.x !== 1) node.setScale(1, 1, 1);

        this.applyFace(active);

        // 碎块划分要用**格心世界坐标 + 格子半尺寸**：`vQuad` 由它们把世界坐标归一化到格内
        // （**不能**用 UV —— SpriteFrame 可能裁剪 / 进图集）。它们必须每帧写：布局变了就过期。
        Vec2.set(active.center, node.worldPosition.x, node.worldPosition.y);
        const material = active.material;
        material.setProperty('flipCenter', active.center);
        material.setProperty('flipHalfHeight', active.half.y);
        material.setProperty('flipHalfWidth', active.half.x);
        // 起手白闪：曲线只在开头那一段给非零值。
        active.flashParams.x = fx.flash ?? 0;
        material.setProperty('flashParams', active.flashParams);
        // 碎裂：`x` 是总开关，为 0 时着色器整段跳过 ⇒ 逐像素等价于「没有碎裂」。
        const shatter = fx.shatter ?? 0;
        active.shatterParams.x = shatter > 0 ? 1 : 0;
        active.shatterParams.y = shatter;
        active.shatterParams.z = active.seed;
        active.shatterParams.w = HEX_SHATTER_JITTER;
        material.setProperty('shatterParams', active.shatterParams);
        material.setProperty('shardGrid', active.shardGrid);
        this.applyReveal(active, fx);
        this.applyGroundGlow(active, fx);
    }

    /**
     * 写「这一帧该显示旧地皮还是新地皮」（**唯一写入口**）。
     *
     * 换脸点 = 这一格**碎没**的那一瞬（`HEX_SHATTER_ERODE_END`），所以换帧本身看不见。
     * ⚠️ 别改到碎裂中途（进度还小的时候）：那会看到地皮在碎片底下硬切一刀。
     *
     * ⚠️ 必须**每帧重写**：`paintHexes` 是幂等的全量重绘，随时可能把 `spriteFrame` 直接写成
     * 新地皮（进度先于动画更新了），动画中途被顶掉就会「碎到一半突然换成新地皮」。
     * 每帧比一次引用（零成本）即可自愈。
     */
    private applyFace(active: ITerritoryHexFlipActive): void {
        const { fromFrame, toFrame, sprite } = active;
        if (!fromFrame || !toFrame) return;
        const swapped = active.elapsed / HEX_SHATTER_SECONDS >= HEX_SHATTER_ERODE_END;
        const frame = swapped ? toFrame : fromFrame;
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
    }

    /**
     * 方案2 的「新地皮从格心放大填充」：倍率写在**子节点 `Reveal`** 上，**不动格根**
     * （格根的缩放归对局的缩没段；这里动它会把格面框 / 底光 / 建筑一起放大）。
     *
     * 倍率 0 ⇒ 整个节点收起（连一次「缩到 0 的绘制」都不做）；不是这套方案时曲线给的就是 0。
     */
    private applyReveal(active: ITerritoryHexFlipActive, fx: IZCHexFlipFx): void {
        const reveal = active.reveal;
        if (!reveal) return;
        const scale = fx.revealScale ?? 0;
        const visible = scale > 0;
        if (reveal.node.active !== visible) reveal.node.active = visible;
        if (!visible) return;
        const frame = active.toFrame;
        if (frame && reveal.spriteFrame !== frame) reveal.spriteFrame = frame;
        if (reveal.node.scale.x !== scale) reveal.node.setScale(scale, scale, 1);
    }

    /**
     * 底部发光（开口光）：与对局**同一份序列帧、同一套进度推导**。
     *
     * 位置要**抵消父节点的上移**（父节点抬多少、Sprite 就往下补多少）⇒ 光带留在原格开口处；
     * 颜色跟随该格底图当前的颜色（地图格是绿/黄/灰，白光乘色后与地图同色系）。
     *
     * ⚠️ 这道光画的是「地块抬起来之后露出的原格开口」—— 而「原地快碎裂」**全程不抬起**
     * （`tileLift` 恒 `0`），强度式子里的 `tileLift / HEX_FLIP_LIFT_PIXELS` 因此恒为 0
     * ⇒ **这段永远不点亮**（唯一实际动作是把节点关掉）。这是本方案的**自洽结果**，不是漏接线：
     * 别为了让底光亮起来去填一个假的抬升量（那等于把「原地」破坏掉）。
     * 保留这条通道是因为它与对局共用同一份 core 推导（一处改两处跟）。
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
        // 底光整块关掉（位置留给下次 play 重设）；新地皮层收起并**把缩放复位**，池化复用不能
        // 带着上一格的放大倍率（否则下次播放会从「半个格子」开始）。
        if (active.glow?.node.active) active.glow.node.active = false;
        this.hideReveal(active);
        // 🔴 落回**新地皮**：动画中途被 `reset()` 打断时 `applyFace` 可能还停在旧地皮上，
        // 摘了材质不收口就会永远停在泥巴块（表现为「格子没翻过来」）。
        if (active.toFrame && sprite.spriteFrame !== active.toFrame) sprite.spriteFrame = active.toFrame;
        // 必须真的摘回 `null`（恢复内置 sprite 材质），否则这一格永久退出静态合批。
        if (sprite.customMaterial === active.material) sprite.customMaterial = null;
        active.material.destroy();
    }

    /** 收起「新地皮」层并把缩放复位（`settle` 与「倍率回到 0」两条路共用）。 */
    private hideReveal(active: ITerritoryHexFlipActive): void {
        const reveal = active.reveal;
        if (!reveal) return;
        if (reveal.node.active) reveal.node.active = false;
        if (reveal.node.scale.x !== 1 || reveal.node.scale.y !== 1) reveal.node.setScale(1, 1, 1);
    }
}
