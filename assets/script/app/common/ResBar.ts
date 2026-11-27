import { _decorator, CCInteger, Color, Component, Graphics, Layout, Node, UITransform, Vec3, Widget } from 'cc';
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { readRoleRow } from '../main/MainRoleRow';
import { MainResBarSlot } from '../main/MainResBarSlot';
import { buildResBarSlots, buildResBarView } from '../main/MainResBarTypes';
import { RES_BAR_FLASH_PEAK_ALPHA, resBarFlashFx } from '../main/MainResBarFeedback';
import { ITEM_TABLE, OPEN_TABLE, ROLE_PROPERTY_TABLE } from '../../core/config/TableNames';
import {
    IItemRefRow,
    IOpenRefRow,
    IResPropertyRow,
    RES_BAR_MAX_SLOTS,
    parseResKeys,
    resIconArt,
    resolveResBarCells,
} from './ResTypes';

const { ccclass, property } = _decorator;

/** 闪光的圆角半径（像素）。资源格的 `Bg` 本身就是圆角条，这里取它的量级。 */
const GLOW_RADIUS = 12;
/** 闪光描边宽度（像素）。 */
const GLOW_LINE_WIDTH = 3;
/** 闪光比格子外扩多少（像素）：不外扩会像贴在格子上的一块白纸。 */
const GLOW_PADDING = 8;

/**
 * 顶部货币条（`ui/common/ResBar`，552×106），对应老端 `组件_资源栏` 的 `组件_资源信息` 部分。
 * 玩家信息块归 `MainResBar`；这里只管货币格，竞技页 HUD 也用同一份嵌套实例。
 *
 * 接入二选一：
 * - `openRefId`（推荐）：读 `open.json` 的 `resShowType`，改表不用改客户端；
 * - `resKeys`：逗号分隔的 `roleProperty.key`，用于没有 open.json 条目的临时页。
 * `openRefId > 0` 时以表为准，解析不出来才回退 `resKeys`。
 *
 * 宿主一律用嵌套 prefab 实例接入，只覆盖 `resKeys` / `openRefId`，不要把公共件节点抄一份。
 * 三格都绑在公共件内部，`keys` 少于槽位数时多出来的格子 `render(null)` 整格隐藏 ——
 * 格数与加号只看 keys，不看数据是否到位。
 *
 * keys 用字符串而不是数组：MCP 设不了数组属性，而这几项配置要落在 prefab 实例上。
 *
 * 图标取 `roleProperty` 真表（`icons/resource/<icon>`，读不到走兜底白名单）；数值读
 * `CmdRole` 缓存（`readRoleRow`），缓存没落地时按 0 显示。`onLoad` 订阅缓存更新后自驱动，
 * 宿主不需要持有本组件引用。
 */
@ccclass('ResBar')
export class ResBar extends Component {
    @property(Layout) slotsLayout: Layout = null!;
    @property(UITransform) barTransform: UITransform = null!;
    @property(Widget) barWidget: Widget = null!;
    @property({ type: MainResBarSlot, tooltip: 'Res0：第 1 格（顺序 = openRefId 的 resShowType / resKeys）' })
    slot0: MainResBarSlot = null!;

    @property({ type: MainResBarSlot, tooltip: 'Res1：第 2 格' })
    slot1: MainResBarSlot = null!;

    @property({ type: MainResBarSlot, tooltip: 'Res2：第 3 格（keys 不足 3 个时整格隐藏）' })
    slot2: MainResBarSlot = null!;

    /**
     * `open.json` 的 `refId`（首选）：填了就读该行的 `resShowType`。
     * 例：民兵天赋 `refId=18` ⇒ `resShowType=[10,7]` ⇒ `coin,gold` 两格；`0` = 用 `resKeys`。
     */
    @property({ type: CCInteger, tooltip: 'openRefId：open.json 的 refId（如天赋页 18）；0 = 用 resKeys' })
    openRefId = 0;

    /** 展示哪几种资源：逗号分隔的 `roleProperty.key`，顺序即从左到右；`openRefId` 解析失败时兜底。 */
    @property({ tooltip: 'resKeys：逗号分隔的 roleProperty 名（如 coin,gold）；openRefId>0 时作兜底' })
    resKeys = 'coin,gold';

    /** 防止 `reload` 重入（缓存落地 / 资源变化都可能触发）。 */
    private loading = false;

    /** 上一次 `reload` 真正画出来的资源键（顺序 = 从左到右），反馈按 key 找格子。 */
    private keys: readonly string[] = [];

    /** 闪光的绘制层（懒建；`null` = 还没建/建不起来）。只有一层，同帧只可能有一格在闪。 */
    private glow: Graphics | null = null;
    /** 本帧闪光的时间轴（`< 0` = 没在闪）。 */
    private flashElapsed = -1;
    /** 闪光覆盖的区域（本组件局部坐标，已含外扩留白）。 */
    private glowRect = { x: 0, y: 0, width: 0, height: 0 };
    /** 有没有反馈在播（没有就整段 `update` 直接返回，不逐帧空转）。 */
    private feedbackActive = false;

    /** `CmdRole` 缓存变化回调（箭头函数属性：引用稳定，供 onDestroy 精确摘除）。 */
    private onRoleCacheUpdate = (): void => {
        void this.reload();
    };

    onLoad(): void {
        CacheMgr.instance.setEventUpdate('CmdRole', this, this.onRoleCacheUpdate);
        void this.reload();
    }

    onDestroy(): void {
        CacheMgr.instance.removeEventUpdate('CmdRole', this, this.onRoleCacheUpdate);
    }

    /**
     * 读表 + 读缓存 → 逐格渲染。失败降级，不抛。
     *
     * 拿不到 `CmdRole`（登录前 / 缓存未落地）时照旧按 keys 摆骨架（数值 0），只多一条 warn；
     * 否则会退回 prefab 默认值（三格全亮、加号全在）。
     */
    async reload(): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        try {
            const [propRows, openRows, itemRows] = await this.readTables();
            if (!this.isValid) return;
            const { keys, iconByKey } = this.resolveCells(openRows, propRows, itemRows);
            const iconOf = (key: string): string => iconByKey.get(key) ?? resIconArt(key, propRows);
            const view = buildResBarView(readRoleRow(), null, keys, iconOf);
            if (!this.isValid) return;
            if (!view) console.warn('[ResBar] 拿不到 CmdRole 缓存（登录前 / 缓存未落地），数值按 0 显示');
            const slots = view?.slots ?? buildResBarSlots(keys, iconOf);
            this.hostSlots().forEach((slot) => {
                //  `hostSlots()` 会跳过未绑的格子，循环下标不等于数据下标 —— 按 Res0..2 的固定位取。
                const i = this.hostSlotIndex(slot);
                if (i < 0) return;
                const cell = slots[i];
                // 扣除反馈必须在 render 之前调：那一刻 label 上还是扣前的值，
                // render 会把新值塞进待落地暂存，两条时间线才对得上。
                const spent = cell ? slot.spendDeltaOf(cell.amount) : 0;
                if (cell && spent > 0) {
                    slot.playSpendFeedback(spent, cell);
                    this.feedbackActive = true;
                }
                slot.render(slots[i] ?? null);
            });
            this.keys = keys;
            if (this.slotsLayout.enabled) {
                this.barTransform.height = this.slotsLayout.cellSize.height;
                this.slotsLayout.updateLayout();
                this.barWidget.updateAlignment();
            }
        } catch (error) {
            console.error('[ResBar] 货币条刷新失败', error);
        } finally {
            this.loading = false;
        }
    }

    /** 宿主实际绑了几个格子（1~3，顺序 = Res0 / Res1 / Res2）；没绑的槽位跳过。 */
    private hostSlots(): readonly MainResBarSlot[] {
        return [this.slot0, this.slot1, this.slot2].filter((slot): slot is MainResBarSlot => !!slot);
    }

    /** 格子在本组件里的固定位（`Res0/1/2`）—— 过滤掉未绑槽位后，位置不能再当数据下标用。 */
    private hostSlotIndex(slot: MainResBarSlot): number {
        if (slot === this.slot0) return 0;
        if (slot === this.slot1) return 1;
        if (slot === this.slot2) return 2;
        return -1;
    }

    // ============================================================
    // 单格反馈：加（宝箱图标飞进来）/ 扣（白色闪烁 + 跳动 + 再扣 + -N 飘字）
    // ============================================================

    /**
     * 逐帧推进反馈（唯一心跳：单格的弹跳 / 数字滚动都由这里驱动）。
     *
     * 一条栏可能三格同时在跳，闪光又只有一层 Graphics，所以时序统一收在本组件，
     * 不会出现「闪光收尾了、数字还在滚」。全部是「记起点 + 向纯函数要当帧值」，不建 tween。
     */
    update(dt: number): void {
        if (!this.feedbackActive) return;
        let busy = false;
        busy = this.slot0.step(dt) || busy;
        busy = this.slot1.step(dt) || busy;
        busy = this.slot2.step(dt) || busy;
        if (this.stepFlash(dt)) busy = true;
        this.feedbackActive = busy;
    }

    /**
     * 某一格被奖励击中：图标弹一下 + 数字从原值滚到新值 + 那一格闪光。
     * 只闪命中的那一格 —— 闪整条会让「宝箱只给体力时银币格跟着亮」，看不出涨的是哪个。
     *
     * @param key    `roleProperty.key`；不在本条栏的 keys 里就静默跳过（合法配置：HUD 只显示两种资源）。
     * @param amount 增加了多少；`<= 0` / 非有限数整段跳过（没涨就别让格子弹一下却没变化）。
     */
    playGainFeedback(key: string, amount: number): void {
        if (!Number.isFinite(amount) || amount <= 0) return;
        const slot = this.slotOfKey(key);
        if (!slot) return;
        slot.playGainFeedback(amount);
        this.flash(slot);
        this.feedbackActive = true;
    }

    /**
     * 某一格被扣除：数字白色闪烁 + 跳一下，跳完才把数字扣下去，同时上方飘一条 `-N`。
     *
     * 通常不用手动调：`CmdRole` 数值变小后，`reload` 里逐格比对 `spendDeltaOf` 会自动演一遍，
     * 覆盖所有扣除来源。手动调只用于「值已落地、但不会再走 render」的边角，且必须在扣完之后调，
     * 否则会先滚到一个还没扣的数再弹回来。
     *
     * @param key    `roleProperty.key`；不在本条栏的 keys 里就静默跳过。
     * @param amount 扣了多少（`<= 0` / 非有限数整段跳过）。
     */
    playSpendFeedback(key: string, amount: number): void {
        if (!Number.isFinite(amount) || amount <= 0) return;
        const slot = this.slotOfKey(key);
        if (!slot) return;
        slot.playSpendFeedback(amount);
        this.feedbackActive = true;
    }

    /**
     * 闪光：传了槽位只闪那一格，不传才闪整条（兼容旧调用）。
     * 连续命中只重启同一条时间轴，Graphics 重画即覆盖，不会叠出两层光。
     */
    flash(target?: MainResBarSlot | null): void {
        if (!this.isValid) return;
        const rect = this.computeGlowRect(target ?? null);
        if (!rect) return;
        const glow = this.ensureGlow();
        if (!glow) return;
        this.glowRect = rect;
        this.flashElapsed = 0;
        this.feedbackActive = true;
        this.applyFlash();
    }

    /**
     * 某一格的世界坐标中心（宝箱图标要飞到这里）。
     * 返回 `null` = 这一格没显示 / 找不到变换，调用方保持原落点，别拿 (0,0) 顶替。
     */
    slotWorldPositionOf(key: string): Vec3 | null {
        const slot = this.slotOfKey(key);
        if (!slot?.node.active) return null;
        const transform = slot.node.getComponent(UITransform);
        if (!transform) return null;
        return transform.convertToWorldSpaceAR(new Vec3(0, 0, 0), new Vec3());
    }

    /** `key` → 宿主上的具体格子（顺序 = `reload` 时的 keys 顺序）。 */
    private slotOfKey(key: string): MainResBarSlot | null {
        const index = this.keys.indexOf(key);
        if (index < 0) return null;
        return this.hostSlots().find((slot) => this.hostSlotIndex(slot) === index) ?? null;
    }

    private stepFlash(dt: number): boolean {
        if (this.flashElapsed < 0) return false;
        this.flashElapsed += Number.isFinite(dt) && dt > 0 ? dt : 0;
        if (resBarFlashFx(this.flashElapsed) === null) {
            this.flashElapsed = -1;
            if (this.glow) {
                this.glow.clear();
                this.glow.node.active = false;
            }
            return false;
        }
        this.applyFlash();
        return true;
    }

    /** 画一帧闪光（alpha 由时间轴给出；没有光层就直接返回）。 */
    private applyFlash(): void {
        const glow = this.glow;
        if (!glow) return;
        const strength = resBarFlashFx(this.flashElapsed) ?? 0;
        glow.node.active = true;
        if (this.slotsLayout.enabled) glow.node.setWorldPosition(this.node.worldPosition);
        glow.clear();
        if (strength <= 0) return;
        const rect = this.glowRect;
        const alpha = Math.round(strength * RES_BAR_FLASH_PEAK_ALPHA * 255);
        // 填充暖白、峰值只到 42%：它是「确认」，不是白屏。
        glow.fillColor = new Color(255, 241, 206, alpha);
        glow.roundRect(rect.x, rect.y, rect.width, rect.height, GLOW_RADIUS);
        glow.fill();
        // 描边比填充亮一档，边缘才读得出轮廓。
        glow.lineWidth = GLOW_LINE_WIDTH;
        glow.strokeColor = new Color(255, 252, 236, Math.min(255, Math.round(alpha * 1.9)));
        glow.roundRect(rect.x, rect.y, rect.width, rect.height, GLOW_RADIUS);
        glow.stroke();
    }

    /**
     * 建（或复用）闪光绘制层：本节点下一个 `Graphics` 子节点，排在最后（画在图标之上）。
     * 闪光没有美术资源、也不需要策划调参，现画与全工程其它无资源光效一致。
     */
    private ensureGlow(): Graphics | null {
        if (this.glow?.isValid) return this.glow;
        const host = this.node.getComponent(UITransform);
        const node = new Node('FeedbackGlow');
        node.layer = this.node.layer;
        // 自适应 Layout 只排列资源格；闪光留在格内并保持货币条坐标原点。
        node.setParent(this.slotsLayout.enabled ? this.hostSlots()[0].node : this.node);
        node.addComponent(UITransform);
        node.setSiblingIndex(node.parent.children.length - 1);
        node.active = false;
        this.glow = node.addComponent(Graphics);
        return this.glow;
    }

    /**
     * 闪光覆盖范围（本组件局部坐标）。
     *
     * - 传 `target` ⇒ 只算那一格 + 外扩（哪格涨了闪哪格）。
     * - 传 `null` ⇒ 所有显示中格子的包围盒 + 外扩（整条闪，老口径，留作兼容）。
     *
     * 不直接用本节点 552×106：那是三格容器的框，宿主只显示 2 格时右侧是空的，
     * 照框画会糊出一片没有内容的亮块。target 不可见 / 没有变换时返回 `null`，绝不回退成整条。
     */
    private computeGlowRect(
        target: MainResBarSlot | null,
    ): { x: number; y: number; width: number; height: number } | null {
        const targets = target ? [target] : this.hostSlots();
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const slot of targets) {
            const node = slot.node;
            if (!node.active) continue;
            const transform = node.getComponent(UITransform);
            if (!transform) continue;
            const size = transform.contentSize;
            const anchor = transform.anchorPoint;
            // 换算到本节点坐标系（槽位直接挂在 ResBar 下，但仍用变换求，避免以后再套一层）
            const center = this.toLocal(node.worldPosition);
            minX = Math.min(minX, center.x - size.width * anchor.x);
            minY = Math.min(minY, center.y - size.height * anchor.y);
            maxX = Math.max(maxX, center.x + size.width * (1 - anchor.x));
            maxY = Math.max(maxY, center.y + size.height * (1 - anchor.y));
        }
        if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
        return {
            x: minX - GLOW_PADDING,
            y: minY - GLOW_PADDING,
            width: Math.max(1, maxX - minX + GLOW_PADDING * 2),
            height: Math.max(1, maxY - minY + GLOW_PADDING * 2),
        };
    }

    /** 世界坐标 → 本组件局部坐标（走引擎矩阵，不自己算偏移）。 */
    private toLocal(world: Readonly<Vec3>): Vec3 {
        const transform = this.node.getComponent(UITransform);
        return transform.convertToNodeSpaceAR(new Vec3(world.x, world.y, 0), new Vec3());
    }

    /**
     * 读 `roleProperty`（图标真源）、`open`（格数真源）、`item`（区分「道具格 / 查不到的格」）。
     * 表读不到不抛，走兜底白名单 + resKeys，界面上照旧有东西。
     */
    private async readTables(): Promise<
        [readonly IResPropertyRow[] | null, readonly IOpenRefRow[] | null, readonly IItemRefRow[] | null]
    > {
        const fromOpen = this.openRefId > 0;
        return Promise.all([
            this.readTable<IResPropertyRow>(ROLE_PROPERTY_TABLE),
            fromOpen ? this.readTable<IOpenRefRow>(OPEN_TABLE) : null,
            fromOpen ? this.readTable<IItemRefRow>(ITEM_TABLE) : null,
        ]);
    }

    private async readTable<T>(name: string): Promise<readonly T[] | null> {
        try {
            return ((await RefUtil.instance.getRefAllAsync(name)) as readonly T[] | null) ?? null;
        } catch (error) {
            console.warn(`[ResBar] ${name} 表读取失败，走兜底口径`, error);
            return null;
        }
    }

    /**
     * 显示哪几格 + 每格图标：`openRefId`（真源）优先，解析不出来才用 `resKeys`。
     *
     * `resShowType` 的 id 可能落在 `roleProperty`（货币 / 属性，数值在 CmdRole）或
     * `item`（道具，数值在背包）两张表上。本组件只画 `roleProperty` 那一支，
     * item / 查不到的格子跳过并 warn，不画个 0 假装有数据（接道具格得先有背包数据源）。
     */
    private resolveCells(
        openRows: readonly IOpenRefRow[] | null,
        propRows: readonly IResPropertyRow[] | null,
        itemRows: readonly IItemRefRow[] | null,
    ): { keys: readonly string[]; iconByKey: ReadonlyMap<string, string> } {
        const iconByKey = new Map<string, string>();
        if (this.openRefId > 0) {
            const cells = resolveResBarCells(this.openRefId, openRows, propRows, itemRows);
            const usable = cells.filter((cell) => cell.kind === 'roleProperty' && cell.key !== '');
            if (usable.length === 0 && cells.length === 0) {
                console.warn(
                    `[ResBar] open.json refId=${this.openRefId} 解析不出货币（表缺失 / 该行没配 resShowType），回退 resKeys`,
                );
            } else if (usable.length < cells.length) {
                const skipped = cells.filter((cell) => cell.kind !== 'roleProperty' || cell.key === '');
                console.warn(
                    `[ResBar] refId=${this.openRefId} 有 ${skipped.length} 格的数据源还没接（` +
                        skipped.map((cell) => `${cell.refId}:${cell.kind}`).join(' / ') +
                        `），本次只画 ${usable.length} 格`,
                );
            }
            if (usable.length > 0) {
                for (const cell of usable) iconByKey.set(cell.key, cell.icon);
                return { keys: this.clampKeys(usable.map((cell) => cell.key)), iconByKey };
            }
        }
        return { keys: this.clampKeys(parseResKeys(this.resKeys)), iconByKey };
    }

    /**
     * 本组件只有 3 个槽位（MCP 写不了数组属性）⇒ 超出部分丢弃并留痕，
     * 免得「策划配了 4 个货币，第 4 个永远不显示」变成无声行为。
     */
    private clampKeys(keys: readonly string[]): readonly string[] {
        if (keys.length <= RES_BAR_MAX_SLOTS) return keys;
        console.warn(
            `[ResBar] keys 有 ${keys.length} 个，超过 ${RES_BAR_MAX_SLOTS} 格上限，只显示前 ${RES_BAR_MAX_SLOTS} 个`,
        );
        return keys.slice(0, RES_BAR_MAX_SLOTS);
    }
}
