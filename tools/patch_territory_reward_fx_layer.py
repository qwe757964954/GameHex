"""
2026-11-11「飞舞的 icon 粒子要处在 UI 的上层，现在被聊天框挡住」接线补丁（原始状态一次到位）。

层级真值（prefab 实测）：
    MainRoot / { Bg, Content, BottomNav }
    Content / ArenaRoot / { MapRoot, ..., TopHud, BottomHud(ChatBar), ChestBar }
    ArenaRoot / MapRoot / MainTerritoryMap / MapViewport / MapLayer
`TerritoryOverlay` 挂在 `MainTerritoryMap` 页面根，只在**页面内部**靠上；跨到 `MainRoot`
时整棵 `Content` 都排在 `BottomNav` 之前，`ArenaRoot` 内又排在 `BottomHud` 之后 ⇒
飞到底部的奖励图标被聊天框 / 快速寻敌 / 底栏压住。

修法：页面只交出 `MainRoot` 的引用（不搭 UI），`TerritoryMapView` 惰性建
`TerritoryRewardFx` 并排到最后一个子节点；飞向英雄按钮的那批图标改挂它，
起点 / 终点走同一套 `cellPointInNode` 换算。格心喷发（`GainLayer`）与开箱 / 云盖 /
点击反馈（`TerritoryOverlay`）**不动** —— 前者要守住「粒子在读数之下」，后者是另一套全屏表演。

🔴 页面里绝不出现 `new Node(` / `addComponent(`：架构守卫
`territory-page-split.test.ts` 与 `territory-battle-intro.test.ts` 会卡这两条。

按 bytes 精确替换，CRLF / LF 各自保留；带 already 幂等标记。
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(rel: str, pairs: list[tuple[str, str]], already: str) -> None:
    target = ROOT / rel
    raw = target.read_bytes()
    crlf = raw.count(b'\r\n') == raw.count(b'\n') and b'\r\n' in raw
    text = raw.decode('utf-8')
    if already in text:
        print(f'skipped {rel} (already patched)')
        return
    for old, new in pairs:
        o = old.replace('\n', '\r\n') if crlf else old
        n = new.replace('\n', '\r\n') if crlf else new
        if o not in text:
            raise SystemExit(f'MISS in {rel}:\n{o[:300]}')
        if text.count(o) != 1:
            raise SystemExit(f'NOT UNIQUE in {rel} ({text.count(o)}):\n{o[:300]}')
        text = text.replace(o, n, 1)
    target.write_bytes(text.encode('utf-8'))
    print(f'patched {rel} ({len(pairs)} hunks, {"CRLF" if crlf else "LF"})')


# ---------------------------------------------------------------- MainTerritoryMap.ts
PAGE = 'assets/script/app/main/MainTerritoryMap.ts'

P1_OLD = """        this.heroBadge?.dispose();
        this.heroBadge = null;
"""
P1_NEW = """        this.heroBadge?.dispose();
        this.heroBadge = null;
        // 飞舞奖励图标的顶层宿主挂在 `MainRoot`（本页之外），由视图建、由视图收：
        // 页面只负责通知，不自己搭 UI（架构守卫禁止 `new Node` / `addComponent`）。
        this.mapView?.disposeRewardFxLayer();
"""

P2_OLD = """        if (heroEntries.length) {
            const heroButton = this.findHeroTabButton();
"""
P2_NEW = """        if (heroEntries.length) {
            // 🔴 2026-11-11：飞行的图标必须画在**所有 UI 之上**（聊天框 / 快速寻敌 / 底栏）。
            //    页面内 `TerritoryOverlay` 只在 `Content / ArenaRoot` 里靠上，跨到底栏就输了；
            //    先把 `MainRoot` 交给视图建顶层宿主，再登记终点（否则坐标还是旧宿主的）。
            this.mapView.mountRewardFxLayer(this.rewardFxRoot());
            const heroButton = this.findHeroTabButton();
"""

P3_OLD = """        this.heroBadge = new HeroFragmentBadge(host.navBar, button);
        return this.heroBadge;
    }
"""
P3_NEW = """        this.heroBadge = new HeroFragmentBadge(host.navBar, button);
        return this.heroBadge;
    }

    /**
     * 飞舞奖励图标的**顶层根节点**（2026-11-11）。
     *
     * 只负责「找哪个节点」，建节点 / 排兄弟序 / 坐标换算全在 `TerritoryMapView`：
     * 页面不许自己搭 UI（架构守卫 `territory-page-split` / `territory-battle-intro`）。
     *
     * `BottomNav` 是 `MainRoot` 的最后一个子节点 ⇒ 把特效层挂到它的父节点并排最后，
     * 才能盖过底栏与 `ArenaRoot/BottomHud` 的聊天框；弹窗挂在 `MainRoot` 之外，仍在其上。
     *
     * ⚠️ 找不到 `MainTabHost`（结构被改 / 测试沙箱）就退回 `hostPageRoot()`（= `ArenaRoot`），
     *    至少盖住聊天框；再找不到返回 `null` ⇒ 视图回退页面内覆盖层，**不静默消失**。
     */
    private rewardFxRoot(): Node | null {
        const navBar = this.findHeroTabHost()?.navBar ?? null;
        return navBar?.parent ?? this.hostPageRoot();
    }
"""

patch(PAGE, [(P1_OLD, P1_NEW), (P2_OLD, P2_NEW), (P3_OLD, P3_NEW)],
      already='private rewardFxRoot()')


# ------------------------------------------------------------------ TerritoryMapView.ts
VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts'

V0_OLD = """export const TERRITORY_HEX_LOCK_LAYER = 'HexLockLayer';
"""
V0_NEW = """export const TERRITORY_HEX_LOCK_LAYER = 'HexLockLayer';

/** 运行时补在 `MainRoot` 下的「飞舞奖励图标」顶层宿主（不进 prefab）。 */
const TERRITORY_REWARD_FX_NODE = 'TerritoryRewardFx';
"""

V1_OLD = """    /** 飞完回收的奖励组（与 `burstPool` 同一套池化策略）。 */
    private readonly heroFlightPool: TerritoryHeroFlight[] = [];
"""
V1_NEW = """    /** 飞完回收的奖励组（与 `burstPool` 同一套池化策略）。 */
    private readonly heroFlightPool: TerritoryHeroFlight[] = [];
    /**
     * 飞舞奖励图标的**顶层宿主**（页面从 `MainRoot` 注入）。
     *
     * 🔴 2026-11-11：页面内 `TerritoryOverlay` 会被 `ArenaRoot/BottomHud`（聊天框）与
     *    `MainRoot/BottomNav`（底栏）压住 ⇒ 图标飞到底部就看不见了。
     *    `null` = 没注入 ⇒ {@link rewardFxLayer} 回退覆盖层（旧行为，绝不静默消失）。
     */
    private rewardFxHost: Node | null = null;
    /** 本视图自己建的那一个顶层节点（页面销毁时要收，不能靠页面子节点自动销毁）。 */
    private rewardFxOwned: Node | null = null;
"""

V2_OLD = """    /**
     * 格心（台面中心）→ **覆盖层局部坐标**。
     *
     * 走 `convertToWorldSpaceAR` → `convertToNodeSpaceAR` 而不是自己算偏移：
     * 地图在 ScrollView 里滚动、章节之间布局尺寸也不同，只有引擎的矩阵是权威。
     * 拿不到节点 / 变换时返回 `null`（调用方直接跳过这次表现，不猜一个坐标）。
     */
    private cellPointInOverlay(cellId: number): Vec3 | null {
        const hex = this.hexNodes.get(cellId);
        if (!hex?.isValid) return null;
        const hexTransform = hex.getComponent(UITransform);
        const host = this.ensureOverlayHost();
        const hostTransform = host.getComponent(UITransform);
        if (!hexTransform || !hostTransform) return null;
        // `HEX_GRID_CONTENT_LIFT` = 锚点与"人眼看到的台面中心"的差（见 `cellCenter`）。
        const world = hexTransform.convertToWorldSpaceAR(new Vec3(0, HEX_GRID_CONTENT_LIFT, 0));
        return hostTransform.convertToNodeSpaceAR(world, new Vec3());
    }
"""
V2_NEW = """    /**
     * 格心（台面中心）→ **覆盖层局部坐标**（开箱 / 点击反馈 / 推镜用）。
     *
     * 走 `convertToWorldSpaceAR` → `convertToNodeSpaceAR` 而不是自己算偏移：
     * 地图在 ScrollView 里滚动、章节之间布局尺寸也不同，只有引擎的矩阵是权威。
     * 拿不到节点 / 变换时返回 `null`（调用方直接跳过这次表现，不猜一个坐标）。
     */
    private cellPointInOverlay(cellId: number): Vec3 | null {
        return this.cellPointInNode(cellId, this.ensureOverlayHost());
    }

    /**
     * 格心 → **指定宿主**的局部坐标（2026-11-11 抽出）。
     *
     * 飞舞图标换了 `MainRoot` 顶层宿主之后，起点与终点必须落在**同一套坐标系**里；
     * 其它全屏表演仍走 {@link cellPointInOverlay}，不受影响。
     */
    private cellPointInNode(cellId: number, host: Node): Vec3 | null {
        const hex = this.hexNodes.get(cellId);
        if (!hex?.isValid) return null;
        const hexTransform = hex.getComponent(UITransform);
        const hostTransform = host.getComponent(UITransform);
        if (!hexTransform || !hostTransform) return null;
        // `HEX_GRID_CONTENT_LIFT` = 锚点与"人眼看到的台面中心"的差（见 `cellCenter`）。
        const world = hexTransform.convertToWorldSpaceAR(new Vec3(0, HEX_GRID_CONTENT_LIFT, 0));
        return hostTransform.convertToNodeSpaceAR(world, new Vec3());
    }
"""

V3_OLD = """    /**
     * 随机格飞行的终点（**世界坐标** → 覆盖层局部坐标，矩阵换算留在视图）。
     *
     * `null` = 清掉 ⇒ 随机格飞行整段跳过（**纯表现**：喷发、读数、发奖一个都不少）。
     * 与 {@link setRewardCatchWorldPoint} 同一套换算，只是目标从「资源栏某一格」换成
     * 「底栏英雄按钮」—— 两者都在 `MainRoot` 层，页面根在 `Content` 层，只有引擎矩阵说得准。
     */
    setHeroRewardTargetWorld(world: Vec3 | null): void {
        if (!world) {
            this.heroRewardTarget = null;
            return;
        }
        const host = this.ensureOverlayHost();
        const transform = host.getComponent(UITransform);
        if (!transform) {
            this.heroRewardTarget = null;
            return;
        }
        const local = transform.convertToNodeSpaceAR(world, new Vec3());
        this.heroRewardTarget = { x: local.x, y: local.y };
    }
"""
V3_NEW = """    /**
     * 页面把顶层根节点（`MainRoot`）交进来，由**视图**建特效层并排到最后一个子节点。
     *
     * 🔴 页面不许自己搭 UI（`territory-page-split` / `territory-battle-intro` 两条架构守卫
     *    禁止页面出现 `new Node(` / `addComponent(`），所以建节点 / 排兄弟序全在这里。
     *    弹窗由 `PopupManager` 挂在 `MainRoot` 之外，仍盖在图标之上。
     *
     * `null`（页面连 `ArenaRoot` 都找不到）⇒ 不建层，`rewardFxLayer()` 回退页面内覆盖层。
     */
    mountRewardFxLayer(root: Node | null): Node | null {
        if (this.rewardFxHost?.isValid) return this.rewardFxHost;
        if (!root?.isValid) return null;
        const host = new Node(TERRITORY_REWARD_FX_NODE);
        host.layer = root.layer;
        const size = root.getComponent(UITransform)?.contentSize;
        host.addComponent(UITransform).setContentSize(size?.width ?? 720, size?.height ?? 1280);
        host.setParent(root);
        // 子节点顺序 = 渲染顺序；排最后 ⇒ 画在 `BottomNav` / `ChestBar` / `BottomHud` 之上。
        host.setSiblingIndex(root.children.length - 1);
        this.rewardFxOwned = host;
        this.setRewardFxHost(host);
        return host;
    }

    /** 页面销毁时收掉运行时补的顶层节点（它不随本页子节点自动销毁）。 */
    disposeRewardFxLayer(): void {
        const owned = this.rewardFxOwned;
        this.setRewardFxHost(null);
        if (owned?.isValid) owned.destroy();
        this.rewardFxOwned = null;
    }

    /**
     * 注入「飞舞奖励图标」的顶层宿主（`MainRoot` 最后一层，由 `mountRewardFxLayer` 建）。
     *
     * 🔴 换宿主时把在飞 / 池化中的图标**全部丢弃重建**：它们的节点挂在旧宿主下，
     *    复用就会「新层上一个图标都不出现」。同时作废 `heroRewardTarget` —— 那是旧宿主的
     *    局部坐标，继续用会整批飞偏。
     */
    setRewardFxHost(host: Node | null): void {
        const next = host?.isValid ? host : null;
        if (this.rewardFxHost === next) return;
        this.rewardFxHost = next;
        this.resetHeroFlights();
        for (const flight of this.heroFlightPool) {
            if (flight.node.isValid) flight.node.destroy();
        }
        this.heroFlightPool.length = 0;
        this.heroRewardTarget = null;
    }

    /** 飞舞图标的宿主：顶层优先，没注入 / 已失效时回退页面内覆盖层（旧行为）。 */
    private rewardFxLayer(): Node {
        return this.rewardFxHost?.isValid ? this.rewardFxHost : this.ensureOverlayHost();
    }

    /**
     * 随机格飞行的终点（**世界坐标** → 飞舞图标宿主局部坐标，矩阵换算留在视图）。
     *
     * `null` = 清掉 ⇒ 随机格飞行整段跳过（**纯表现**：喷发、读数、发奖一个都不少）。
     * 与 {@link setRewardCatchWorldPoint} 同一套换算，只是目标从「资源栏某一格」换成
     * 「底栏英雄按钮」—— 两者都在 `MainRoot` 层，页面根在 `Content` 层，只有引擎矩阵说得准。
     */
    setHeroRewardTargetWorld(world: Vec3 | null): void {
        if (!world) {
            this.heroRewardTarget = null;
            return;
        }
        const host = this.rewardFxLayer();
        const transform = host.getComponent(UITransform);
        if (!transform) {
            this.heroRewardTarget = null;
            return;
        }
        const local = transform.convertToNodeSpaceAR(world, new Vec3());
        this.heroRewardTarget = { x: local.x, y: local.y };
    }
"""

V4_OLD = """        if (!entries.length || !this.heroRewardTarget) return false;
        const origin = this.cellPointInOverlay(cellId);
        if (!origin) return false;
        return this.acquireHeroFlight().play(
"""
V4_NEW = """        if (!entries.length || !this.heroRewardTarget) return false;
        const host = this.rewardFxLayer();
        const origin = this.cellPointInNode(cellId, host);
        if (!origin) return false;
        return this.acquireHeroFlight(host).play(
"""

V5_OLD = """    /** 取一束飞行图标：池里有就复用，没有才现建（挂在覆盖层，与开箱 Fly 同坐标系）。 */
    private acquireHeroFlight(): TerritoryHeroFlight {
        const reused = this.heroFlightPool.pop();
        if (reused) {
            this.activeHeroFlights.push(reused);
            return reused;
        }
        const flight = new TerritoryHeroFlight(this.ensureOverlayHost());
"""
V5_NEW = """    /** 取一束飞行图标：池里有就复用，没有才现建（挂在顶层宿主，与飞行终点同坐标系）。 */
    private acquireHeroFlight(layer: Node): TerritoryHeroFlight {
        const reused = this.heroFlightPool.pop();
        if (reused) {
            this.activeHeroFlights.push(reused);
            return reused;
        }
        const flight = new TerritoryHeroFlight(layer);
"""

patch(VIEW, [(V0_OLD, V0_NEW), (V1_OLD, V1_NEW), (V2_OLD, V2_NEW),
             (V3_OLD, V3_NEW), (V4_OLD, V4_NEW), (V5_OLD, V5_NEW)],
      already='mountRewardFxLayer(root: Node | null)')
