import { _decorator, CCInteger, Color, Component, Graphics, Node, UITransform, Vec3 } from 'cc';
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { readRoleRow } from '../main/MainRoleRow';
import { MainResBarSlot } from '../main/MainResBarSlot';
import { buildResBarSlots, buildResBarView } from '../main/MainResBarTypes';
import {RES_BAR_FLASH_PEAK_ALPHA, resBarFlashFx} from '../main/MainResBarFeedback';
import {
    IItemRefRow,
    IOpenRefRow,
    IResBarCell,
    IResPropertyRow,
    ITEM_TABLE,
    OPEN_TABLE,
    RES_BAR_MAX_SLOTS,
    ROLE_PROPERTY_TABLE,
    parseResKeys,
    resIconArt,
    resolveResBarCells,
} from './ResTypes';

const { ccclass, property } = _decorator;

/** 闪光的圆角半径（像素）。资源格的 `Bg` 本身就是圆角条，这里取它的量级。 */
const GLOW_RADIUS = 12;
/** 闪光描边宽度（像素）。 */
const GLOW_LINE_WIDTH = 3;
/** 闪光比格子外扩多少（像素）：不外扩会像"贴在格子上的一块白纸"。 */
const GLOW_PADDING = 8;

/**
 * 顶部**货币条**（`ui/common/ResBar`，552×106，老端 `组件_资源栏` 的 `组件_资源信息` 部分）。
 *
 * ## 与 `MainResBar` 的分工（不是两份实现）
 *
 * 老端 `组件_资源栏` 是**常驻层**（`LayerMainResources`，`UIOrder.ResourceUI`），一整条里含两块：
 *
 *  | 块 | 内容 | 本工程 |
 *  |---|---|---|
 *  | `组件_玩家信息` 463×106 | 头像 / 昵称 / LV / uid / 经验条 | `MainResBar`（挂在竞技页 `ArenaRoot/ResBarLayer`，属主界面 HUD） |
 *  | `组件_资源信息` × N（132×40） | 图标 + 数值 + 加号 | **本组件** |
 *
 * 二级页（民兵天赋 / 武将 / 军师…）顶部要的是「**这一页关心的那两三种货币**」，
 * 不需要把玩家信息块塞进全屏弹窗 ⇒ 抽成只管货币的通用件。
 *
 * ⚠️ 2026-09-29：**竞技页 HUD 那条也换成本组件了** —— 在 `ArenaRoot/ResBarLayer` 下挂一份
 * **嵌套 prefab 实例**（`ResBarLayer/ResBar`），`MainResBar` 只留玩家信息块。两边共用同一份
 * 数据层（`MainResBarTypes`）与槽组件（`MainResBarSlot`），HUD 不再自带一套货币渲染
 * （否则同一份 CmdRole 会被两条链路各写一遍）。
 *
 * ## 接入方式（二选一）
 *
 * | 属性 | 什么时候用 | 来源 |
 * |---|---|---|
 * | `openRefId` | **推荐**。填 `open.json` 的 `refId`（天赋页 = 18） | 策划表 `resShowType` —— 改表不用改客户端 |
 * | `resKeys` | 临时页 / 没有 `open.json` 条目时兜底 | prefab 上手填，逗号分隔（`coin,gold`） |
 *
 * `openRefId > 0` 时以**表**为准，解析不出来（表未落地 / 该行没配）才回退 `resKeys`。
 *
 * ⚠️ 宿主一律用**嵌套实例**（`cc.PrefabInstance`）接入，只覆盖 `_name` / `_lpos` /
 * `resKeys`（或 `openRefId`）三项；**不许把公共件的节点抄一份到宿主里** —— 那样改公共件
 * 不会穿透宿主，等于每个宿主私有一份。
 *
 * ## 槽位绑定（`slot0` / `slot1` / `slot2`）
 *
 * 绑定落在**公共件内部**（三格都绑），宿主只覆盖 `resKeys`：
 *
 * | 宿主 | `resKeys` | 效果 |
 * |---|---|---|
 * | 民兵天赋页（3 格） | `coin,gold`（或走 `openRefId=18`） | 三格中前两格出图，第 3 格整格隐藏 |
 * | 竞技页 HUD（3 格容器） | **`gold,end`**（2026-10-26） | 银币 + 体力两格出图，第 3 格整格隐藏 |
 * | 商城（2 格） | `gold,gem` | 第 3 格整格隐藏（`render(null)`） |
 *
 * 槽位顺序 = 从左到右渲染顺序 = `openRefId` 的 `resShowType` / `resKeys` 顺序；
 * **keys 比宿主格子少时多出来的格子整格隐藏**（规则 140：格数只看 keys，不看数据可用性）。
 * 每个槽是 `MainResBarSlot`，它的 `plus`（补货加号）按数据显隐 —— 只有体力格会亮。
 *
 * ## 为什么 keys 写成字符串而不是数组
 *
 * MCP `component_set_component_property` **不支持数组属性**（见 `cocos-mcp-build-prefab` 铁律 3），
 * 数组只能在 Inspector 里手填；而「哪几种货币」是要**落在 prefab 实例上**的配置 ⇒
 * 用逗号分隔字符串，prefab 里可覆盖、代码里零分支。
 *
 * ## 图标与数值各自的口径
 *
 * - **图标**：`roleProperty` 真表 → `icons/resource/<icon>`（与 `resolveRewardIconRef` 同源）。
 *   表读不到时落 `ResTypes.FALLBACK_RES_ICON_ART` 兜底白名单。
 * - **数值**：`CmdRole` 缓存（`readRoleRow()`，服务端权威）；缓存没落地时按 `0` 显示。
 * - **格数 / 加号**：只看 keys —— **不许**跟数据可用性绑定（规则 140）。
 *
 * ## 自驱动
 *
 * `onLoad` 里读一次并订阅 `CmdRole` 缓存更新（服务器推资源变化 ⇒ 自动重写数值）。
 * 宿主**不需要**持有本组件的引用，嵌进页面就能用。
 */
@ccclass('ResBar')
export class ResBar extends Component {
    @property({ type: MainResBarSlot, tooltip: 'Res0：第 1 格（顺序 = openRefId 的 resShowType / resKeys）' })
    slot0: MainResBarSlot = null;

    @property({ type: MainResBarSlot, tooltip: 'Res1：第 2 格' })
    slot1: MainResBarSlot = null;

    @property({ type: MainResBarSlot, tooltip: 'Res2：第 3 格（keys 不足 3 个时整格隐藏）' })
    slot2: MainResBarSlot = null;

    /**
     * `open.json` 的 `refId`（**首选**）：填了就读该行的 `resShowType` 决定显示哪几格。
     *
     * 例：民兵天赋 `refId=18` ⇒ `resShowType=[10,7]` ⇒ `coin,gold` 两格。
     * `0` = 不读表，用下面的 `resKeys`。
     */
    @property({ type: CCInteger, tooltip: 'openRefId：open.json 的 refId（如天赋页 18）；0 = 用 resKeys' })
    openRefId = 0;

    /**
     * 展示哪几种资源（**逗号分隔**的 `roleProperty.key`，顺序 = 从左到右）。
     *
     * 只在 `openRefId` 为 0（或表里解析不出）时生效。
     * 老端 `open.json` 的 `resShowType` 是数字（`roleProperty` 枚举：6 gem / 7 gold / 9 end / 10 coin…），
     * 这里用 `key` 是因为 `CmdRole` 缓存的字段名就是 `key`（`gold` / `coin` / …）。
     */
    @property({ tooltip: 'resKeys：逗号分隔的 roleProperty 名（如 coin,gold）；openRefId>0 时作兜底' })
    resKeys = 'coin,gold';

    /** 防止 `reload` 重入（缓存落地 / 资源变化都可能触发）。 */
    private loading = false;

    /**
     * 上一次 `reload` 真正画出来的资源键（顺序 = 从左到右）。
     *
     * 反馈要按 key 找格子（`playGainFeedback('gold', 120)`），而 prefab 上的
     * `slot0/1/2` 只有位置没有语义 ⇒ 必须记住这次渲染的 `keys`。
     */
    private keys: readonly string[] = [];

    /** 闪光的绘制层（懒建；`null` = 还没建/建不起来）。只有一层 ⇒ 同帧只可能有一格在闪。 */
    private glow: Graphics | null = null;
    /** 本帧闪光的时间轴（`< 0` = 没在闪）。 */
    private flashElapsed = -1;
    /** 闪光覆盖的区域（**本组件局部坐标**，已含外扩留白）。 */
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
     * 读表 + 读缓存 → 逐格渲染。失败降级，**不抛**。
     *
     * ⚠️ **格数 / 图标 / 加号只看 keys，不看数据是否到位**：
     * 拿不到 `CmdRole`（登录前 / 缓存未落地）时照旧按 `keys` 摆出骨架（数值 `0`），
     * 只多一条 warn —— 否则会退回 prefab 默认值（三格全亮、加号全在），
     * 二级页顶部平白多出一格带加号的空货币格，且**一句错都不报**（规则 140）。
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
            // 槽位数 = keys 数（1~3）：宿主**绑几格就渲染几格**（见 `hostSlots()`）。
            // keys 少于槽位时（如 3 格宿主只配了 2 个货币）多出来的传 null ⇒ 那一格整格隐藏。
            this.hostSlots().forEach((slot, i) => {
                slot.render(slots[i] ?? null);
            });
            this.keys = keys;
        } catch (error) {
            console.error('[ResBar] 货币条刷新失败', error);
        } finally {
            this.loading = false;
        }
    }

    /**
     * 宿主实际绑了几个格子（1~3，顺序 = `Res0` / `Res1` / `Res2`）。
     *
     * ⚠️ 现在三个宿主都用**同一个公共件实例** ⇒ 三格都绑，`keys` 不足时多出来的格子传 `null`
     * 整格隐藏（商城 2 格就是这么做的）。「绑空」这条路仍然合法 —— 谁把公共件改成只有 2 格的
     * 私有件，`slot2` 就该留空，`filter` 会跳过它。
     * 规则 109 管的是「绑错了不许静默」，与「合法地不绑」是两回事。
     */
    private hostSlots(): readonly MainResBarSlot[] {
        return [this.slot0, this.slot1, this.slot2].filter((slot): slot is MainResBarSlot => !!slot);
    }

    // ============================================================
    // 被奖励击中的反馈（宝箱图标飞进来那一刻，见 `TerritoryChestView`）
    // ============================================================

    /**
     * 逐帧推进反馈（**唯一心跳**：单格的弹跳 / 数字滚动都由这里驱动）。
     *
     * 为什么不让 `MainResBarSlot` 自己挂 `update`：一条栏可能三格同时在跳
     * （银币 + 体力 + 其它），三个组件各自 `update` 只是多三次空转；
     * 而且闪光**只有一层 `Graphics`**、又是全栏一处时序 ⇒ 收在本组件最省；
     * 时序收在一处，也不会出现「闪光收尾了、数字还在滚」。
     *
     * ⚠️ 不用 tween（规则 106/247）：全是「记起点 + 向纯函数要当帧值」。
     */
    update(dt: number): void {
        if (!this.feedbackActive) return;
        let busy = false;
        for (const slot of this.hostSlots()) if (slot.step(dt)) busy = true;
        if (this.stepFlash(dt)) busy = true;
        this.feedbackActive = busy;
    }

    /**
     * 某一格**被奖励击中**：图标弹一下 + 数字从「原值」滚到「新值」+ **那一格**闪光。
     *
     * ⚠️ 2026-10-26 改口径：原先闪**整条栏**，用户反馈「宝箱只给体力时，银币格跟着一起亮，
     * 看不出到底涨的是哪个」⇒ 现在只闪命中的那一格，别的格纹丝不动。
     *
     * @param key    `roleProperty.key`（`gold` 银币 / `end` 体力 …）。
     *               **不在本条栏的 `keys` 里 ⇒ 静默跳过**（合法配置：HUD 只显示两种资源，
     *               领地随机格发的道具本来就没有对应的格子）。
     * @param amount 这次增加了多少（数字滚动的起点 = 当前值 - amount）。
     *               **`<= 0` / 非有限数 ⇒ 整段跳过**（没涨就没反馈，别让格子弹一下却没变化）。
     */
    playGainFeedback(key: string, amount: number): void {
        // `amount <= 0`（脏数据 / 该资源在这批奖励里配了 0）= **没涨** ⇒ 连闪都不该闪。
        // 开箱奖励是配表来的，0 值行确实存在；不拦的话会出现「这一格亮了一下、数字没动」。
        if (!Number.isFinite(amount) || amount <= 0) return;
        const slot = this.slotOfKey(key);
        if (!slot) return;
        slot.playGainFeedback(amount);
        this.flash(slot);
        this.feedbackActive = true;
    }

    /**
     * 闪光：**传了槽位只闪那一格**，不传才闪整条（兼容旧调用，本工程目前只有单格这一种用法）。
     *
     * 复用的场景：`playGainFeedback` 每次都会调一次，所以连续两次命中**只重启时间轴**，
     * 不会叠出两层光（`Graphics` 只有一个，重画即覆盖）；连续命中**不同格**时，
     * 后一次直接改写 `glowRect`，光会跳到新格上 —— 这比"两格同时亮"更符合"哪格涨了闪哪格"。
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
     * 某一格的**世界坐标中心**（宝箱图标要飞到这里）。
     *
     * 返回 `null` = 这一格没显示 / 找不到变换 —— 调用方保持原落点，
     * 不要拿 `(0,0)` 顶替（那会让整串图标飞到页面正中，比"不飞"更怪）。
     */
    slotWorldPositionOf(key: string): Vec3 | null {
        const slot = this.slotOfKey(key);
        if (!slot?.node.active) return null;
        const transform = slot.node.getComponent(UITransform);
        if (!transform) return null;
        return transform.convertToWorldSpaceAR(new Vec3(0, 0, 0), new Vec3());
    }

    /** `key` → 宿主上的具体格子（顺序 = `reload` 时的 `keys` 顺序）。 */
    private slotOfKey(key: string): MainResBarSlot | null {
        const index = this.keys.indexOf(key);
        if (index < 0) return null;
        return this.hostSlots()[index] ?? null;
    }

    private stepFlash(dt: number): boolean {
        if (this.flashElapsed < 0) return false;
        this.flashElapsed += Number.isFinite(dt) && dt > 0 ? dt : 0;
        if (resBarFlashFx(this.flashElapsed) === null) {
            this.flashElapsed = -1;
            this.glow?.clear();
            if (this.glow) this.glow.node.active = false;
            return false;
        }
        this.applyFlash();
        return true;
    }

    /** 画一帧闪光（`alpha` 由时间轴给出；没有光层就直接返回）。 */
    private applyFlash(): void {
        const glow = this.glow;
        if (!glow) return;
        const strength = resBarFlashFx(this.flashElapsed) ?? 0;
        glow.node.active = true;
        glow.clear();
        if (strength <= 0) return;
        const rect = this.glowRect;
        const alpha = Math.round(strength * RES_BAR_FLASH_PEAK_ALPHA * 255);
        // 填充：暖白。刻意**不满不刺眼** —— 它是"确认",不是"白屏"，峰值只到 42%。
        glow.fillColor = new Color(255, 241, 206, alpha);
        glow.roundRect(rect.x, rect.y, rect.width, rect.height, GLOW_RADIUS);
        glow.fill();
        // 描边：比填充亮一档，边缘才读得出「这一格亮了一下」的轮廓。
        glow.lineWidth = GLOW_LINE_WIDTH;
        glow.strokeColor = new Color(255, 252, 236, Math.min(255, Math.round(alpha * 1.9)));
        glow.roundRect(rect.x, rect.y, rect.width, rect.height, GLOW_RADIUS);
        glow.stroke();
    }

    /**
     * 建（或复用）闪光绘制层：本节点下一个 `Graphics` 子节点，**排在最后**（画在图标之上）。
     *
     * 为什么现画而不是 prefab 里放一张九宫格：闪光没有美术资源、也不需要被策划调参
     * （颜色/透明度全在 `MainResBarFeedback` 与本节常量里），而 `Graphics` 现画是
     * 全工程做"无资源光效"的既有姿势（见 `TerritoryChestView` 的光柱 / 星光）。
     */
    private ensureGlow(): Graphics | null {
        if (this.glow?.isValid) return this.glow;
        const host = this.node.getComponent(UITransform);
        if (!host) return null;
        const node = new Node('FeedbackGlow');
        node.layer = this.node.layer;
        node.setParent(this.node);
        node.addComponent(UITransform);
        node.setSiblingIndex(this.node.children.length - 1);
        node.active = false;
        this.glow = node.addComponent(Graphics);
        return this.glow;
    }

    /**
     * 闪光覆盖范围（本组件局部坐标）。
     *
     * - `target` 有值 ⇒ **只算那一格**的框 + 外扩（本轮口径：哪格涨了闪哪格）。
     * - `target` 为 `null` ⇒ **所有显示中的格子**的包围盒 + 外扩（整条闪，老口径，留作兼容）。
     *
     * 为什么不直接用本节点的 `552×106`：那是三格容器的框，而上层宿主只显示 2 格时
     * 第 3 格的位置是空的 —— 照框画会在右侧糊一大片没有内容的亮块。
     *
     * ⚠️ `target` 不可见 / 没有变换时**返回 `null`（不闪）**，绝不回退成整条 ——
     * 那正是本轮要修的病（银币格跟着体力格一起亮）。
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
            // 换算到**本节点**坐标系（槽位直接挂在 ResBar 下，但仍用变换求，避免以后再套一层）
            const center = this.toLocal(node.worldPosition);
            minX = Math.min(minX, center.x - size.width * anchor.x);
            minY = Math.min(minY, center.y - size.height * anchor.y);
            maxX = Math.max(maxX, center.x + size.width * (1 - anchor.x));
            maxY = Math.max(maxY, center.y + size.height * (1 - anchor.y));
        }
        if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
        const pad = GLOW_PADDING;
        return {
            x: minX - pad,
            y: minY - pad,
            width: Math.max(1, maxX - minX + pad * 2),
            height: Math.max(1, maxY - minY + pad * 2),
        };
    }

    /** 世界坐标 → 本组件局部坐标（走引擎矩阵，不自己算偏移）。 */
    private toLocal(world: Readonly<Vec3>): Vec3 {
        const transform = this.node.getComponent(UITransform);
        if (!transform) return new Vec3(world.x, world.y, 0);
        return transform.convertToNodeSpaceAR(new Vec3(world.x, world.y, 0), new Vec3());
    }

    /**
     * 读 `roleProperty`（图标真源）、`open`（格数真源）、`item`（区分"道具格 / 查不到的格"）。
     * 表读不到不抛 —— 走兜底白名单 + `resKeys`，界面上照旧有东西（规则 140）。
     */
    private async readTables(): Promise<
        [readonly IResPropertyRow[] | null, readonly IOpenRefRow[] | null, readonly IItemRefRow[] | null]
    > {
        const fromOpen = this.openRefId > 0;
        const [propRows, openRows, itemRows] = await Promise.all([
            this.readTable(ROLE_PROPERTY_TABLE),
            fromOpen ? this.readTable(OPEN_TABLE) : Promise.resolve(null),
            fromOpen ? this.readTable(ITEM_TABLE) : Promise.resolve(null),
        ]);
        return [
            propRows as readonly IResPropertyRow[] | null,
            openRows as readonly IOpenRefRow[] | null,
            itemRows as readonly IItemRefRow[] | null,
        ];
    }

    private async readTable(name: string): Promise<readonly unknown[] | null> {
        try {
            return (await RefUtil.instance.getRefAllAsync(name)) ?? null;
        } catch (error) {
            console.warn(`[ResBar] ${name} 表读取失败，走兜底口径`, error);
            return null;
        }
    }

    /**
     * 显示哪几格 + 每格图标：`openRefId`（真源）优先，解析不出来才用 `resKeys`。
     *
     * ⚠️ `resShowType` 里的 id 可能落在**两张表**上（老端 `GetGoodsTypeByResId` 的两支）：
     * `roleProperty`（货币 / 属性，数值在 `CmdRole`）与 `item`（道具，数值在背包）。
     * 本组件目前只画 `roleProperty` 那一支 —— `item` / 查不到的格子**跳过并留一条 warn**，
     * 而不是画个 0 假装有数据（要接道具格得先有背包数据源）。
     */
    private resolveCells(
        openRows: readonly IOpenRefRow[] | null,
        propRows: readonly IResPropertyRow[] | null,
        itemRows: readonly IItemRefRow[] | null,
    ): { keys: readonly string[]; iconByKey: ReadonlyMap<string, string> } {
        const iconByKey = new Map<string, string>();
        let cells: readonly IResBarCell[] | null = null;
        if (this.openRefId > 0) {
            cells = resolveResBarCells(this.openRefId, openRows, propRows, itemRows);
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
