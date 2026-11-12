"""2026-11-11：预告关卡节点红色气泡 + 异步据点解锁即直开。

按 bytes 精确替换，自动探测并保持每个文件原有的行尾（CRLF / LF）。
源码三份与一条既有守卫用例都是 CRLF，直接文本替换会产出「只是换行变了」的巨大 diff。

用法：python tools/patch_territory_preview_bubble.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def shift_lines(s: str, spaces: int) -> str:
    """给整段字符串每行补 N 个空格（空行不动、末尾换行不动）。"""
    pad = " " * spaces
    return "\n".join((pad + line) if line.strip() else line for line in s.split("\n"))


def patch(rel: str, pairs: list[tuple[str, str]], shift: int = 0, already: str | None = None) -> None:
    target = ROOT / rel
    raw = target.read_bytes()
    crlf = b"\r\n" in raw and raw.count(b"\r\n") == raw.count(b"\n")
    text = raw.decode("utf-8")
    if crlf:
        text = text.replace("\r\n", "\n")
    if already and already in text:
        print(f"skipped {rel} (already patched)")
        return
    if shift:
        pairs = [(shift_lines(o, shift), shift_lines(n, shift)) for o, n in pairs]
    for old, new in pairs:
        count = text.count(old)
        assert count == 1, f"{rel}: expected 1 occurrence, got {count} for {old[:70]!r}"
        text = text.replace(old, new, 1)
    if crlf:
        text = text.replace("\n", "\r\n")
    target.write_bytes(text.encode("utf-8"))
    print(f"patched {rel} ({'CRLF' if crlf else 'LF'})")


MAP_VIEW = "assets/script/app/territory/view/TerritoryMapView.ts"
STATION_VIEW = "assets/script/app/territory/view/TerritoryStationView.ts"
MODEL = "assets/script/app/territory/application/TerritoryModel.ts"
BOSS_TEST = "tests/territory-boss-and-random-building.test.ts"


patch(MAP_VIEW, [
    (r"""        const short = territoryUnlockShortfall(input.wallet, site.unlock);
        const silverRed = short.silver
            || (!isOpenable && !short.stamina);
        return {
            site,
            icon: null,
            isCondition: true,
            isLoading: isPending,
            conditionIcon: input.art.randomSilverIcon,
""",
     r"""        const short = territoryUnlockShortfall(input.wallet, site.unlock);
        const silverRed = short.silver
            || (!isOpenable && !short.stamina);
        // 🔴 2026-11-11 用户：「预告关卡节点，展示气泡提示（红色未通过的状态）」。
        //   提前披露只改可见性 —— 这一格仍然走「未解锁」的锁 / 价格画法，气泡是**额外叠上去的**，
        //   绝不因此放宽解锁、扣费、开战判据（模型侧 `territoryRevealedCells` 的口径一个字没动）。
        //   四条判据同时成立才挂：
        //     ① 在 `previewCells` 里（披露序列 = 本章第 1 关 + 每个首领，见 `model/TerritoryPreview`）；
        //     ② 是战斗站点（stage / boss / asyncPvp），资源点与装饰格不挂编号；
        //     ③ 配了 `buildingId` 且查得到帧 = **虚影承载格**（`syncGhosts` 也只在这格画虚影）；
        //     ④ 能算出气泡文案（asyncPvp 恒 `PVP`，其余要绑到 campaign 行才有 `章节-关卡`）。
        //   ⇒ 一关 footprint 有 5~10 格，只有承载格挂一颗，不会满屏 `1-1`（§3.28 同口径）。
        const isPreviewBattleSite = (input.previewCells ?? []).includes(site.cellId)
            && (site.type === TERRITORY_SITE_TYPE.stage
                || site.type === TERRITORY_SITE_TYPE.boss
                || site.type === TERRITORY_SITE_TYPE.asyncPvp)
            && !!site.buildingId
            && territoryLevelBubbleText(site, stage) !== undefined;
        // 站点自身 `icon` 必须是 null（未解锁不画实心建筑），但气泡要抬到**虚影建筑**顶上：
        // 把虚影那张帧单独交给视图算可见高，别让它按「没有建筑 ⇒ height 0」把气泡压回格心。
        const previewAnchor = isPreviewBattleSite
            ? this.stationIconOf(site, stage, input.art) : null;
        const previewBubble = isPreviewBattleSite && previewAnchor !== null;
        return {
            site,
            icon: null,
            isCondition: true,
            isLoading: isPending,
            conditionIcon: input.art.randomSilverIcon,
"""),
    (r"""            conditionTextColor: silverRed
                ? TERRITORY_COLORS.randomConditionText : TERRITORY_COLORS.randomAvailableText,
            caption: isPending
                ? ''
                : String(site.unlock.silverCost),
            tint: isOpenable ? TERRITORY_COLORS.gold : TERRITORY_COLORS.locked,
""",
     r"""            conditionTextColor: silverRed
                ? TERRITORY_COLORS.randomConditionText : TERRITORY_COLORS.randomAvailableText,
            // 预告关卡的红色编号气泡：文案复用 `model/TerritoryLevelBubble`，底图固定取
            // 「未通关」红 `frame_02`（这一格本来就没通过）；红图缺失照旧回退蓝图，别让编号消失。
            levelBubble: previewBubble ? territoryLevelBubbleText(site, stage) : undefined,
            levelBubbleFrame: previewBubble
                ? input.art.levelBubblePendingFrame ?? input.art.levelBubbleFrame ?? null
                : undefined,
            previewBubble,
            levelBubbleAnchorFrame: previewAnchor,
            caption: isPending
                ? ''
                : String(site.unlock.silverCost),
            tint: isOpenable ? TERRITORY_COLORS.gold : TERRITORY_COLORS.locked,
"""),
], shift=4, already="const isPreviewBattleSite")


patch(STATION_VIEW, [
    (r"""    readonly levelBubbleIcon?: SpriteFrame | null;
    readonly levelBubbleFrame?: SpriteFrame | null;
""",
     r"""    readonly levelBubbleIcon?: SpriteFrame | null;
    readonly levelBubbleFrame?: SpriteFrame | null;
    /**
     * **预告关卡**的编号气泡（2026-11-11）。这一格仍是「未解锁」画法（`icon: null` +
     * `isCondition: true`），但气泡要照常显示 ⇒ `renderLevelBubble` 对这一支放宽
     * 「必须有实心建筑 / 不能是条件格」两道门槛。**只有承载格**会传 true
     * （判据在 `TerritoryMapView.stationRenderOf`，整关 footprint 只挂一颗）。
     */
    readonly previewBubble?: boolean;
    /**
     * 预告气泡的**锚点帧** = 35% 虚影用的那张建筑图。
     *
     * `icon` 是 null（不画实心建筑），`applyLevelBubblePosition` 原本按「没有建筑」把
     * 气泡压在格心，会盖住虚影和价格。传这张帧给视图按虚影的可见高抬起，
     * 与 `syncGhosts` / `renderGhost` 用的是同一个 `stationIconOf` 结果。
     */
    readonly levelBubbleAnchorFrame?: SpriteFrame | null;
"""),
    (r"""    private hintBubbleSuppressed = false;
""",
     r"""    private hintBubbleSuppressed = false;
    /** 本帧预告气泡的锚点帧（`renderLevelBubble` 每帧写入；池化复用时不许留上一格的值）。 */
    private levelBubbleAnchorFrame: SpriteFrame | null = null;
"""),
    (r"""    private renderLevelBubble(content: ITerritoryStationRender): void {
        const text = content.levelBubble ?? '';
        const frame = content.levelBubbleFrame ?? null;
        const iconFrame = content.levelBubbleIcon ?? null;
        // 需求 2026-11-02 第 3 条：播放「宝箱还没点我」跳动时**隐藏**它的提示气泡。
        // 判据走开关（`setHintBubbleSuppressed`），不是直接关节点 —— 站点每秒会被重画一次。
        const visible = text !== '' && frame !== null && content.icon !== null && !content.isCondition
            && !content.hidden && !content.isLoading && !this.hintBubbleSuppressed;
""",
     r"""    private renderLevelBubble(content: ITerritoryStationRender): void {
        const text = content.levelBubble ?? '';
        const frame = content.levelBubbleFrame ?? null;
        const iconFrame = content.levelBubbleIcon ?? null;
        this.levelBubbleAnchorFrame = content.levelBubbleAnchorFrame ?? null;
        // 需求 2026-11-02 第 3 条：播放「宝箱还没点我」跳动时**隐藏**它的提示气泡。
        // 判据走开关（`setHintBubbleSuppressed`），不是直接关节点 —— 站点每秒会被重画一次。
        // 🔴 预告关卡（2026-11-11）：格子未解锁 ⇒ `icon: null` + `isCondition: true`，
        //    按老门槛两颗都过不了。这一支**只放宽这两条**，hidden / loading / suppressed
        //    与气泡形状、点击、层级全部照旧，不另起一套渲染路径。
        const preview = content.previewBubble === true;
        const visible = text !== '' && frame !== null
            && (preview || (content.icon !== null && !content.isCondition))
            && !content.hidden && !content.isLoading && !this.hintBubbleSuppressed;
"""),
    (r"""        const frame = this.iconSprite.spriteFrame;
        const height = frame && frame.originalSize.height > 0
            ? frame.rect.height * this.iconTransform.contentSize.height / frame.originalSize.height * this.iconBaseScale : 0;
        const lift = this.bottomAnchored ? height / 2 - TERRITORY_BOTTOM_ANCHOR_DROP_PX : 0;
""",
     r"""        // 🔴 预告格：站点自身没有实心建筑（`icon: null`），改按虚影那张帧算可见高，
        //    否则气泡会落回格心、压住价格与 35% 建筑。缩放也换成对应的归一系数
        //    （`previewAnchorScale` 逐字复刻 `applyIconPlacement`），两者必须同源才不飘。
        const anchorFrame = this.levelBubbleAnchorFrame ?? this.iconSprite.spriteFrame;
        const anchorScale = this.levelBubbleAnchorFrame
            ? this.previewAnchorScale() : this.iconBaseScale;
        const height = anchorFrame && anchorFrame.originalSize.height > 0
            ? anchorFrame.rect.height * this.iconTransform.contentSize.height
                / anchorFrame.originalSize.height * anchorScale : 0;
        const lift = this.bottomAnchored ? height / 2 - TERRITORY_BOTTOM_ANCHOR_DROP_PX : 0;
"""),
    (r"""            mapMarkerBadgeY(this.mapY + offsets.icon.y + lift + height / 2, bubbleHeight), this.mapZ + offsets.icon.z);
    }

    private readonly handleClick = (): void => {
""",
     r"""            mapMarkerBadgeY(this.mapY + offsets.icon.y + lift + height / 2, bubbleHeight), this.mapZ + offsets.icon.z);
    }

    /**
     * 预告气泡锚点帧的缩放：**逐字复刻 `applyIconPlacement` 的归一系数**，只是把帧换成虚影那张。
     *
     * `iconSizeScale` 与虚影同源（`syncStations` 和 `renderGhost` 都传 `buildScaleOf`），
     * 所以这里算出的可见高与虚影 View 的 `anchorLiftY` / 可见高逐像素一致。
     */
    private previewAnchorScale(): number {
        const frame = this.levelBubbleAnchorFrame;
        const nodeSize = this.iconTransform.contentSize;
        const canvas = frame?.originalSize;
        const trimmed = frame?.rect;
        if (!frame || !canvas || !trimmed || !(canvas.width > 0) || !(trimmed.width > 0)
            || !(nodeSize.width > 0)) return 1;
        const visibleWidth = trimmed.width * nodeSize.width / canvas.width;
        return (visibleWidth > 0 ? BUILDING_VISIBLE_WIDTH / visibleWidth : 1) * this.iconSizeScale;
    }

    private readonly handleClick = (): void => {
"""),
    (r"""        // 银币宝箱退场也要停表：节点马上被 destroy，不能留着一条会写已销毁节点的秒表。
        this.resetSilverChestPop();
""",
     r"""        // 银币宝箱退场也要停表：节点马上被 destroy，不能留着一条会写已销毁节点的秒表。
        this.resetSilverChestPop();
        // 预告气泡锚点帧同理：池化槽位借给下一格时，别把上一格的虚影高度带过去。
        this.levelBubbleAnchorFrame = null;
"""),
], already="readonly previewBubble?: boolean")


patch(MODEL, [
    (r"""            //   → `markCellsUnlocked`），界面**不弹**；主线关卡解锁成功后**立刻发开战**（2026-10-29，
            //   见下面那段口径）—— 只解锁的只剩 asyncPvp 与绑不到 campaign 行的格子。
""",
     r"""            //   → `markCellsUnlocked`），界面**不弹**；战斗站点解锁成功后**立刻发开战**（2026-10-29，
            //   2026-11-11 起含 asyncPvp，见下面那段口径）—— 只解锁的只剩绑不到 campaign 行的格子。
"""),
    (r"""                //   ⚠️ 只对**主线关卡**（stage / boss）生效：asyncPvp 的弹窗带「侦查」，先弹再接战；
                //     绑不到 campaign 行时没有 battleParams，退回「只解锁」。
                //   ⚠️ 开关是 `gameConfig.chapterLevelAutoStartConfig`（1 开 / 0 关，策划表口径），
                //     关掉之后这里退回「点一下只解锁」的老行为 —— 判据只在 `selectSite` 这一处，
                //     别在 `handleUnlockThenBattle` 里再判一遍（两处判据迟早不一致）。
                if (this.levelAutoStart && lockedStage && this.isLevelSite(site)) {
""",
     r"""                //   ⚠️ 2026-11-11 用户「触发异步据点也是直接进入战斗」：直开名单从
                //     主线关卡（stage / boss）扩到**全部战斗站点**（含 asyncPvp）。
                //     已解锁 / 已通关的 asyncPvp 仍走下面 `detailSite = site` ⇒
                //     `BigMapPlayerLevelPanel` 的侦查 / 占领奖励 / 双按钮完整保留，
                //     被跳过的只是「花银币解锁那一次」的弹窗。
                //     绑不到 campaign 行时 `lockedStage = null` ⇒ 退回「只解锁」，不会发空请求。
                //   ⚠️ 开关是 `gameConfig.chapterLevelAutoStartConfig`（1 开 / 0 关，策划表口径），
                //     关掉之后这里退回「点一下只解锁」的老行为 —— 判据只在 `selectSite` 这一处，
                //     别在 `handleUnlockThenBattle` 里再判一遍（两处判据迟早不一致）。
                if (this.levelAutoStart && lockedStage && this.isAutoStartSite(site)) {
"""),
    (r"""     * 锁着的关卡格：**解锁成功即开战**（不弹关卡界面）。
""",
     r"""     * 锁着的战斗站点格（关卡 / 首领 / **异步据点**）：**解锁成功即开战**（不弹详情面板）。
"""),
    (r"""    /**
     * **主线关卡**（普通关 / 首领）。「解锁那一次直开」只对它生效：
     * asyncPvp 的弹窗带「侦查」，要留给人点。
     */
    private isLevelSite(site: TerritorySite): boolean {
        return site.type === TERRITORY_SITE_TYPE.stage
            || site.type === TERRITORY_SITE_TYPE.boss;
    }
""",
     r"""    /**
     * **「花银币解锁那一次就立刻开战」的站点名单**（2026-11-11）。
     *
     * 2026-10-29 只有主线关卡（stage / boss）；当时的注释「asyncPvp 的弹窗带侦查，
     * 要留给人点」在 2026-11-11 被用户「触发异步据点也是直接进入战斗」覆盖：
     * asyncPvp 并入直开名单。**已解锁 / 已通关仍弹侦查面板**，那句旧注释只针对锁态分支。
     *
     * 与 {@link isBattleSite} 的区别：那边管「能不能发开战请求」，这边只管「要不要跳过弹窗」。
     * 两张名单眼下恰好相同，但语义不同 —— 以后某个战斗站点要保留弹窗时只改这里。
     */
    private isAutoStartSite(site: TerritorySite): boolean {
        return this.isBattleSite(site);
    }
"""),
], already="private isAutoStartSite")


patch(BOSS_TEST, [
    (r"""    assert.match(code, /lockedStage && this\.isLevelSite\(site\)/,
        '直开只给主线关卡：asyncPvp 的弹窗带侦查，绑不到关卡的格没有 battleParams');
""",
     r"""    // 2026-11-11 用户「触发异步据点也是直接进入战斗」：直开名单扩到全部战斗站点。
    assert.match(code, /lockedStage && this\.isAutoStartSite\(site\)/,
        '解锁那一次直开必须走 isAutoStartSite（含 asyncPvp）；绑不到关卡的格没有 battleParams');
    const autoStartSite = codeOf(memberOf(src, 'private isAutoStartSite(site: TerritorySite): boolean'));
    assert.match(autoStartSite, /this\.isBattleSite\(site\)/,
        '直开名单 = 全部战斗站点：stage / boss / asyncPvp（已解锁仍弹侦查面板）');
"""),
], already="private isAutoStartSite(site: TerritorySite): boolean")


FIXTURES = "tests/helpers/territory-station-fixtures.ts"
PRESENTER_TEST = "tests/territory-presenter.test.ts"


patch(FIXTURES, [
    (r"""    readonly levelBubble?: string;
    readonly levelBubbleFrame?: unknown;
    readonly interactive: boolean;
""",
     r"""    readonly levelBubble?: string;
    readonly levelBubbleFrame?: unknown;
    /** 2026-11-11 预告关卡：未解锁条件格也要显示编号气泡。 */
    readonly previewBubble?: boolean;
    /** 预告气泡按虚影建筑抬升用的锚点帧（与 syncGhosts 同源）。 */
    readonly levelBubbleAnchorFrame?: unknown;
    readonly interactive: boolean;
"""),
    (r"""    setSpawnOpacity(value: number): void;
""",
     r"""    setSpawnOpacity(value: number): void;
    /** 宝箱提示气泡的显示开关（2026-11-02）；视图真方法，夹具接口同步声明。 */
    setHintBubbleSuppressed(suppressed: boolean): void;
"""),
], already="readonly previewBubble?: boolean")


patch(PRESENTER_TEST, [
    (r"""    assert.equal(h.gatewayCalls.startBattle, 0, '首次点击只解锁，不启动战斗');
    assert.deepEqual(h.tips, ['已解锁，点击查看关卡', '已解锁，点击查看关卡', '已解锁，点击查看关卡']);

    h.presenter.selectSite(sites[0]);
    await flush();
    assert.ok(h.presenter.state.detail.playerStage, '解锁后再次点击才弹玩家关卡详情');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 3, '已解锁的异步格再次点击不重复请求解锁');
""",
     r"""    // 2026-11-11 用户「触发异步据点也是直接进入战斗」：解锁那一次就 `beginBattle`
    // （mode = match ⇒ 请求交给匹配页，领地侧 `startBattle` 仍为 0），不再弹「已解锁」提示。
    assert.equal(h.gatewayCalls.startBattle, 0, 'mode = match：请求交给匹配页，领地侧不发');
    assert.deepEqual(h.tips, [], '解锁即直开，不再提示「已解锁，点击查看关卡」');
    assert.equal(h.storeCalls.beginBattle, 3, '三格各自解锁即开战（2026-11-11 口径）');

    h.presenter.selectSite(sites[0]);
    await flush();
    assert.ok(h.presenter.state.detail.playerStage, '已解锁后再次点击仍弹玩家关卡详情（侦查面板保留）');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 3, '已解锁的异步格再次点击不重复请求解锁');
"""),
    (r"""    assert.deepEqual(h.battleParams[0], ['1', '1', '372']);
    assert.equal(h.storeCalls.beginBattle, 1);
    assert.equal(h.nav[0]?.levelId, 20001, '开战应使用 levelInfo.json 中的 20001');
""",
     r"""    assert.deepEqual(h.battleParams[0], ['1', '1', '372']);
    assert.equal(h.storeCalls.beginBattle, 4, '三格解锁直开 + 372 面板按钮再开一次');
    assert.equal(h.nav[0]?.levelId, 20001, '开战应使用 levelInfo.json 中的 20001');
"""),
    (r"""    h.presenter.selectSite(site); // 第一次点击只解锁
""",
     r"""    h.presenter.selectSite(site); // 第一次点击：解锁并直接开战（2026-11-11）
"""),
    (r"""    assert.equal(h.presenter.state.progress?.isCellUnlocked(372), true);
    h.presenter.selectSite(site); // 解锁后再点：再弹窗
    await flush();
    h.presenter.requestBattle(); // 再点「开始战斗」→ 开战步
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页');
    assert.deepEqual(h.battleParams[0], ['1', '1', '372'],
        '未通关 asyncPvp 用格子战斗子类型 1（服务端对没打过的格按格子战斗分流）');
    assert.equal(h.nav.length, 1);
""",
     r"""    assert.equal(h.presenter.state.progress?.isCellUnlocked(372), true);
    // 2026-11-11：花银币解锁那一次就直接进战斗（mode = match ⇒ 匹配页），不等弹窗按钮。
    assert.equal(h.nav.length, 1, '解锁即直开：第一跳由 selectSite 触发');
    h.presenter.selectSite(site); // 已解锁后再点：仍弹侦查面板
    await flush();
    h.presenter.requestBattle(); // 面板「开始战斗」→ 第二跳
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页');
    assert.deepEqual(h.battleParams[0], ['1', '1', '372'],
        '未通关 asyncPvp 用格子战斗子类型 1（服务端对没打过的格按格子战斗分流）');
    assert.equal(h.nav.length, 2, '解锁那一次 + 面板按钮各一跳');
"""),
], already="三格各自解锁即开战")

print('done')
