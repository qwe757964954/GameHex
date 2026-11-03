/**
 * 过场用的**云盖层**：一整屏云，按 `spread` 从画面中心散开 / 收拢，
 * 并按各自的 `delay` 一朵朵淡掉；`hold` 段（等回包 / 等目标页资源）里循环播待机帧。
 *
 * 只做四件事：建一屏云 → 每帧按倍率改写位置与逐朵不透明度 → 推进待机帧 → 收工时藏起来。
 * 时间轴与数值全部在 `model/TerritoryBattleIntro`（零 cc），这里只负责写节点。
 *
 * ## 🔴 美术只取**云体**（`cloud_body_0`），绝不能用 `cloud_idle_*` 合并图
 *
 * 两张图的差别只有一个：`cloud_idle_*` 把**影子**（纯黑、alpha 21~61）和云体烤在了一起，
 * `cloud_body_*` 只有云体。地图那边两者分开用 —— 影子全部抽到 `CloudShadow` 一层、
 * **压在云体之下**，所以地图上的云是白的。
 *
 * 盖层是几百朵**密铺**：每朵自带的黑影会盖在**邻居的白色云体**上，叠两三层就整屏发灰
 * （用户 2026-11-02 晚上实机截图：整屏均值 147，而领地正常页是 231）。
 * 实测（`tools/probe_cloud_cover_grey.py` 按真点阵合成）：合并图 147 / 纯云体 **225**。
 *
 * 想让盖层也有影子，**不要**把影子塞进每朵云里 —— 那等于把地图犯过的错再犯一遍
 * （见 `TerritoryCloudView` 里「灰云带」那段）。真要做，得像地图那样单独建一个**全局影子层**，
 * 且压在**所有**云体之下。
 *
 * ## 为什么现在只有一帧
 *
 * 用户要的是「云**静止**在匹配界面下方」，而能换的 `cloud_idle_1..4` 都带着那层黑影
 * （一换就灰）。帧循环的机制留着：`setBattleCloudFrames` 塞进多帧就自动恢复呼吸。
 *
 * ## 为什么单独铺一层，不借用地图上那套云
 *
 * 地图的云（`TerritoryCloudView`）只盖**未解锁格**，而且每朵的位置、倍率、消散状态都由
 * 解锁进度驱动 —— 拿它做"整屏盖住"要临时把几百朵云的状态全改一遍，收工还得原样还回去
 * （换章 / 解锁动到一半被打断就是一堆错位）。这里按**视口**重新摆一屏，与地图互不相干：
 * 盖上去、散掉、藏起来，中途出任何问题都只影响这一层。
 *
 * ## 为什么位置逐帧写、整层不透明度只写一个数
 *
 * 一屏三四百朵。**位移**必须逐朵写（散开就是位移），这是省不掉的；**显形 / 整层淡出**
 * 挂在一个 `UIOpacity` 上（一次改一个数）。逐朵只写**自己那份额外的淡出**（`color.a`）——
 * 散场是"一朵朵先淡后淡"散的，不是整屏一起降 alpha（那样读成"画面闪一下"）。
 *
 * ## 为什么 `clear()` 只是藏起来
 *
 * 建一屏云要 `new` 三四百个节点。过场每局只播一次、但页面可能反复进出战斗 ⇒ 收工藏起来、
 * 下次直接复用，避免"每次开战都在点击那一帧建几百个节点"的抖动。
 */

import { Color, Node, Sprite, UIOpacity, UITransform } from 'cc';
import type { SpriteFrame } from 'cc';
import {
    TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS,
    TERRITORY_BATTLE_INTRO_COVER_HEIGHT,
    TERRITORY_BATTLE_INTRO_COVER_SPREAD,
    TERRITORY_BATTLE_INTRO_COVER_WIDTH,
    TERRITORY_BATTLE_INTRO_IN_SECONDS,
    TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO,
    territoryBattleIntroCoverAlpha,
    territoryBattleIntroCoverFrameStep,
    territoryBattleIntroCoverPuffs,
    territoryBattleIntroInFx,
    type ITerritoryBattleIntroCover,
} from '../model/TerritoryBattleIntro';

/** 云盖层在覆盖层里的节点名（用例/调试按名字找）。 */
export const TERRITORY_BATTLE_INTRO_COVER_NODE = 'BattleIntroCover';

export class TerritoryBattleCover {
    private readonly host: Node;
    private layer: Node | null = null;
    private opacity: UIOpacity | null = null;
    /** 云点阵（画面坐标，原点 = 画面中心）；`null` = 还没按视口尺寸建过。 */
    private clouds: ITerritoryBattleIntroCover[] | null = null;
    private readonly sprites: Sprite[] = [];
    /**
     * 待机帧（**云体**，`cloud_body_*`）。由页面在资源就绪后注入。
     *
     * 空 ⇒ 建不出盖层（`build` 返回 `false`，调用方放弃整页过场）：
     * 没有贴图的精灵画出来是透明的，"盖住地块"这件事就不存在了。
     *
     * 当前只有 1 帧（见类注释「为什么现在只有一帧」）；多帧时按步进循环。
     */
    private frames: readonly SpriteFrame[] = [];
    /**
     * 写 `color` 复用的一个 `Color` 实例。
     *
     * 每帧给三四百个精灵建新 `Color` 就是每帧几百次小对象分配（GC 会在这几帧里抖一下）。
     * `sprite.color` 的 setter 是**拷贝**进来的，复用同一个实例没问题。
     */
    private readonly tint = new Color(255, 255, 255, 255);
    /** 过场起演到现在的秒数（只有待机循环用得上）。 */
    private clock = 0;
    /** 上一次写进去的帧步进 —— 同一步不重复写帧（`spriteFrame` 赋值会标脏整棵渲染树）。 */
    private writtenStep = -1;
    /**
     * `in` 段已经走了多少秒；`< 0` = 还没开始散场。
     *
     * 由 {@link startRelease} 置 0、{@link tick} 推进。这条路径是给**跨流程交接**用的：
     * 领地把云交给匹配页之后，散布这件事发生在匹配页这一侧（那里没有人逐帧喂 fx），
     * 所以盖层必须能自己把 `in` 段走完。
     */
    private releaseElapsed = -1;
    /** `in` 段是否已经走完（散完并自行隐藏）—— 跨流程宿主靠它收工。 */
    private released = false;
    private width = 0;
    private height = 0;
    /**
     * 这一层**自己持有引用**的那些帧（与 {@link frames} 同一批，去重）。
     *
     * 🔴 为什么必须自己持引用：`frames` 是**页面注入**的（`setBattleCloudFrames`），
     * 而注入方活在**另一个资源作用域**里 —— 领地页 / 匹配页一离开就 `ResourceScope.dispose()`，
     * `CocosAssetService` 会把这些帧 `decRef` 掉。盖层没有自己那一份引用的话，图当场被回收，
     * 而还挂在 `Canvas` 上的几百个 `Sprite` 照样每帧提交渲染 ⇒ 下一帧就崩在 `Batcher2D`：
     * `frame should not be invalid, it may have been released` → `getGFXTexture` 空指针
     * （2026-11-03 实机：匹配成功切战场，首帧绘制完就整屏报错）。
     *
     * 跨流程交接（`TerritoryBattleCoverOverlay`）正是这个场景：**云比页面活得久**。
     * 与 `docs/ZCGameHUD.md`「装饰图必须自己 `addRef()`」同一条口径。
     */
    private held: SpriteFrame[] = [];

    constructor(host: Node, frames: readonly SpriteFrame[] = []) {
        this.host = host;
        this.retainExact(frames);
        this.frames = this.held.slice();
    }

    /** 云层是否已经建过节点（用例可读）。 */
    get built(): boolean {
        return this.sprites.length > 0 && !!this.layer?.isValid;
    }

    /** 云朵数量（用例可读）。 */
    get count(): number {
        return this.sprites.length;
    }

    /** 层节点（没建过 = `null`）。 */
    get layerNode(): Node | null {
        return this.layer?.isValid ? this.layer : null;
    }

    /** 待机循环当前走到第几步（用例可读；还没推进过 = -1）。 */
    get frameStep(): number {
        return this.writtenStep;
    }

    /**
     * `in` 段是否已经散完（走到底、已自行隐藏）。
     *
     * 给 {@link TerritoryBattleCoverOverlay} 用的：这一层跨流程活下来，散完得有人把整层收掉，
     * 而"散完"这件事只有盖层自己知道（它每帧按 `releaseElapsed` 推）。
     */
    get releaseFinished(): boolean {
        return this.released;
    }

    /**
     * 这一层是按多大视口铺的（px）。没建过 = `{ 0, 0 }`。
     *
     * 交接时要把这个尺寸一起交给匹配页 —— 两边**必须同一套视口**，否则点阵会长得不一样，
     * 切流程那一帧整屏云会整体位移一下。
     */
    get size(): { readonly width: number; readonly height: number } {
        return { width: this.width, height: this.height };
    }

    /**
     * 注入 / 替换待机帧（`cloud_idle_0..4`）。
     *
     * 资源是异步加载的：页面先 `initialize` 就发起加载，玩家点开战时通常已经到手；
     * 万一来晚了（已建过层），这里会把帧补写进去，不用等下一次过场。
     */
    setFrames(frames: readonly SpriteFrame[]): void {
        this.retainExact(Array.isArray(frames) ? frames : []);
        this.frames = this.held.slice();
        if (!this.layer?.isValid) return;
        this.writtenStep = -1;
        this.writeFrames(territoryBattleIntroCoverFrameStep(this.clock));
    }

    /**
     * 让"持有的引用"正好等于 `next`：新来的 `addRef`、不再用到的 `decRef`。
     *
     * 只做差集而不是"全放再全留"：`setFrames` 会在资源晚到时被调一次，全放会让那几帧
     * 在中间瞬间掉到 0（引擎立刻回收），差值法不会出现这个窗口。
     */
    private retainExact(next: readonly SpriteFrame[]): void {
        const keep: SpriteFrame[] = [];
        for (const frame of next) if (frame && !keep.includes(frame)) keep.push(frame);
        for (let index = this.held.length - 1; index >= 0; index -= 1) {
            const frame = this.held[index];
            if (keep.includes(frame)) continue;
            this.held.splice(index, 1);
            if (frame.isValid) frame.decRef();
        }
        for (const frame of keep) {
            if (this.held.includes(frame)) continue;
            frame.addRef();
            this.held.push(frame);
        }
    }

    /**
     * 按视口尺寸铺一层云（幂等：尺寸没变就只把层显示出来）。
     *
     * @param width  / @param height 视口尺寸（px）；非法或没有云帧 ⇒ 不铺（返回 `false`）
     * @returns 是否铺好了（`false` ⇒ 调用方应把云层当作"没有"，放弃整页过场）
     */
    build(width: number, height: number): boolean {
        if (!this.host?.isValid) return false;
        const w = Number.isFinite(width) && width > 0 ? width : 0;
        const h = Number.isFinite(height) && height > 0 ? height : 0;
        if (!(w > 0) || !(h > 0)) return false;
        // 同一尺寸 ⇒ 点阵不变，直接复用（只把层打开 + 把帧补上）。
        if (this.layer?.isValid && this.clouds && this.width === w && this.height === h) {
            this.layer.active = true;
            this.releaseElapsed = -1;
            this.released = false;
            this.writtenStep = -1;
            this.writeFrames(territoryBattleIntroCoverFrameStep(this.clock));
            return true;
        }
        // 没有云美术 ⇒ 整层不建（宁可让调用方退回推镜过场，也不要盖一片空白上来）。
        if (!this.frames.length) return false;
        this.destroy();
        const layer = new Node(TERRITORY_BATTLE_INTRO_COVER_NODE);
        layer.layer = this.host.layer;
        layer.setParent(this.host);
        const transform = layer.addComponent(UITransform);
        transform.setContentSize(w, h);
        this.opacity = layer.addComponent(UIOpacity);
        this.opacity.opacity = 0;
        // 最后一位 = 画在覆盖层里所有东西之上（点击反馈 / 宝箱 / 光柱都在它下面）。
        layer.setSiblingIndex(this.host.children.length - 1);
        this.layer = layer;
        this.width = w;
        this.height = h;
        this.releaseElapsed = -1;
        this.released = false;
        this.clouds = territoryBattleIntroCoverPuffs(w, h);
        for (let index = 0; index < this.clouds.length; index += 1) {
            const sprite = this.createSprite(layer, index);
            if (sprite) this.sprites.push(sprite);
        }
        // 起手就位在画面之外（`spread` 的 2 倍，比曲线里的起手值还远一档）：
        // 建出来的那一帧玩家看到的是**干净**的画面，等第一帧 `apply` 才收拢。
        this.applySpread(TERRITORY_BATTLE_INTRO_COVER_SPREAD * 2);
        this.applyRelease(0);
        this.writeOpacity(0);
        // 全部先填满一帧：否则 `out` 段前 0.18s 里所有精灵都还没有 `spriteFrame`（一片空白）。
        this.writtenStep = -1;
        this.writeFrames(0);
        return true;
    }

    /**
     * 推进待机循环。**`out` / `hold` / `in` 三段都要调**（页面每帧一次）。
     *
     * 只改帧、不改位置与不透明度：位置那一段由 `apply` 负责，静图盯久了会读成卡死，
     * 所以 `hold` 段虽然"一帧不动"，云本体仍然在呼吸。
     */
    step(dt: number): void {
        if (!this.layer?.isValid || !this.layer.active) return;
        this.clock += Number.isFinite(dt) && dt > 0 ? dt : 0;
        this.writeFrames(territoryBattleIntroCoverFrameStep(this.clock));
    }

    /**
     * 接着"上一位"的待机相位继续循环（跨流程交接用，单位 = 步进数）。
     *
     * 领地页把云交给匹配页时，两边的点阵是同一份（确定性），但待机**步进**是各自的时钟：
     * 不接上的话，切换那一帧每朵云的形态会同时换一次 = 整屏"抖一下"。
     * 把领地页当时的步进带过来，切过去就是**一帧没变**。
     */
    setBaseStep(step: number): void {
        const value = Number.isFinite(step) && step > 0 ? step : 0;
        this.clock = value * TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS;
        this.writtenStep = -1;
        this.writeFrames(territoryBattleIntroCoverFrameStep(this.clock));
    }

    /**
     * 开始 `in` 段（向四周散开 + 逐朵淡）。之后靠 {@link tick} 自走。
     *
     * @returns **过多久该发起跳转**（秒）= `IN_SECONDS × NAVIGATE_RATIO`。
     *          交回给调用方是为了让"何时切场景"仍然只有一个地方决定（本类不认识流程）。
     */
    startRelease(): number {
        // 幂等：重复调（页面调度 + 覆盖层各调一次）不许把散场重新归零 —— 归零就是"闪一下重散"。
        if (!this.released && this.releaseElapsed < 0) this.releaseElapsed = 0;
        return TERRITORY_BATTLE_INTRO_IN_SECONDS * TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO;
    }

    /**
     * 每帧推进：待机循环照常呼吸；已经在散场就同步推进 `in` 段，走完自己藏起来。
     *
     * 与 {@link step} 的区别：`step` 只换帧（页面每帧喂 fx，位置由 {@link apply} 写），
     * 这里是**没人喂 fx** 的场景（匹配页底层那层云），位置与淡出都由自己算。
     */
    tick(dt: number): void {
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        this.step(step);
        if (this.releaseElapsed < 0) return;
        this.releaseElapsed += step;
        const fx = territoryBattleIntroInFx(this.releaseElapsed);
        this.apply(fx.coverSpread, fx.coverOpacity, fx.coverRelease);
        if (!fx.done) return;
        this.releaseElapsed = -1;
        this.released = true;
        this.clear();
    }

    /**
     * 写一帧：每朵摆在 `cloud × spread`，逐朵按 `release` 写自己的淡出，整层不透明度写 `opacity`。
     *
     * @param release `in` 段进度（0~1）；`out` / `hold` 段传 0（云保持原样、只显形）
     *
     * 脏值一律夹住（透明度夹到 `[0, 1]`、倍率夹到 `> 0`）：`NaN` 写进位置会让整层云
     * 消失且零报错。
     */
    apply(spread: number, opacity: number, release: number = 0): void {
        if (!this.layer?.isValid) return;
        this.applySpread(Number.isFinite(spread) && spread > 0 ? spread : 1);
        this.applyRelease(Number.isFinite(release) ? release : 0);
        this.writeOpacity(Number.isFinite(opacity) ? opacity : 0);
    }

    /** 收工：藏起来（节点保留，下次直接复用）。 */
    clear(): void {
        if (this.layer?.isValid) this.layer.active = false;
        this.writeOpacity(0);
    }

    /** 彻底销毁节点（换视口 / 页面销毁时；正常过场收工只走 {@link clear}）。**不动帧引用**。 */
    destroy(): void {
        if (this.layer?.isValid) this.layer.destroy();
        this.layer = null;
        this.opacity = null;
        this.sprites.length = 0;
        this.clouds = null;
        this.writtenStep = -1;
        this.releaseElapsed = -1;
        this.released = false;
        this.width = 0;
        this.height = 0;
    }

    /**
     * 这个盖层**真的不要了**：先销毁节点，再放掉自己持有的帧引用。
     *
     * 与 {@link destroy} 分成两个方法，是因为 `build` 换视口时会先 `destroy()` 再重建 ——
     * 那里帧还要接着用。只有"页面销毁 / 交接层收工 / 交接失败"才该走这里。
     */
    dispose(): void {
        this.destroy();
        this.frames = [];
        this.retainExact([]);
    }

    private applySpread(spread: number): void {
        const clouds = this.clouds;
        if (!clouds || clouds.length !== this.sprites.length) return;
        for (let index = 0; index < clouds.length; index += 1) {
            const sprite = this.sprites[index];
            if (!sprite?.node?.isValid) continue;
            const cloud = clouds[index];
            // 取整：位置每帧都在变，浮点尾数会让同一朵反复标脏、也便于用例逐字比对。
            const x = Math.round(cloud.x * spread);
            const y = Math.round(cloud.y * spread);
            if (sprite.node.position.x !== x || sprite.node.position.y !== y) {
                sprite.node.setPosition(x, y, 0);
            }
        }
    }

    /** 逐朵写自己在 `in` 段那份额外的淡出（乘在基准 alpha 上）。 */
    private applyRelease(release: number): void {
        const clouds = this.clouds;
        if (!clouds || clouds.length !== this.sprites.length) return;
        for (let index = 0; index < clouds.length; index += 1) {
            const sprite = this.sprites[index];
            if (!sprite?.node?.isValid) continue;
            const alpha = territoryBattleIntroCoverAlpha(clouds[index], release);
            const target = Math.round((alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha) * 255);
            if (sprite.color.a === target) continue;
            this.tint.a = target;
            sprite.color = this.tint;
        }
    }

    /** 把待机帧按 `步进 + 每朵相位` 写进去；同一步重复调只在第一次真的写。 */
    private writeFrames(step: number): void {
        const count = this.frames.length;
        const clouds = this.clouds;
        if (!count || !clouds || !this.layer?.isValid) return;
        if (step === this.writtenStep) return;
        this.writtenStep = step;
        for (let index = 0; index < this.sprites.length; index += 1) {
            const sprite = this.sprites[index];
            if (!sprite?.node?.isValid) continue;
            const phase = Number.isFinite(clouds[index]?.frame) ? clouds[index].frame : 0;
            const frame = this.frames[((step + phase) % count + count) % count];
            if (!frame || sprite.spriteFrame === frame) continue;
            sprite.spriteFrame = frame;
        }
    }

    private writeOpacity(value: number): void {
        if (!this.opacity?.node?.isValid) return;
        const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;
        const target = Math.round(clamped * 255);
        if (this.opacity.opacity !== target) this.opacity.opacity = target;
    }

    private createSprite(parent: Node, index: number): Sprite | null {
        const cloud = this.clouds?.[index];
        const frame = this.frames[0];
        if (!cloud || !frame) return null;
        const node = new Node(`BattleIntroCloud_${index}`);
        node.layer = parent.layer;
        node.setParent(parent);
        // 🔴 尺寸必须写成**显示尺寸**（260×312），贴图只有 200×240。
        //    用 `SizeMode.RAW` 的话节点会跟着位图走 ⇒ 屏幕上只有设计尺寸的 3/4，
        //    而模型里的"间距 < 云体尺寸"是按 260×312 算的 ⇒ 团与团之间会漏出底色。
        node.addComponent(UITransform)
            .setContentSize(TERRITORY_BATTLE_INTRO_COVER_WIDTH, TERRITORY_BATTLE_INTRO_COVER_HEIGHT);
        const sprite = node.addComponent(Sprite);
        // `CUSTOM` = 按节点尺寸拉伸这张 200×240 的位图。
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        // 倍率逐朵略有差别（0.9~1.12）：完全一致的话，云的轮廓会连成整齐的行列。
        const scale = Number.isFinite(cloud.scale) && cloud.scale > 0 ? cloud.scale : 1;
        // 左右镜像再多一倍形态（云本来就没有正反之分）。
        node.setScale(cloud.flip ? -scale : scale, scale, 1);
        this.tint.a = Math.round((cloud.alpha <= 0 ? 0 : cloud.alpha >= 1 ? 1 : cloud.alpha) * 255);
        sprite.color = this.tint;
        return sprite;
    }
}
