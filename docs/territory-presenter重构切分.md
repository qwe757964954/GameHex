# Territory Presenter 重构切分方案

> 范围：
> `assets/script/app/territory`
> 目标：把
> `view/TerritoryPage.ts`
> （670 行 Component）里的
> **业务编排与状态**
> 抽到纯 TypeScript 的
> `TerritoryPresenter`
> ；
> Component 退化为生命周期 + 节点接线的薄壳。
> **不引入事件总线**
> ，页内刷新只有一个
> `onStateChange`
> 回调。
> 不动 prefab、不动协议、不动美术资源。



***

## 1. 目标架构



```
MainTabHost
  │ instantiate + initialize(assets)（注入时机不变）
  ▼
TerritoryPage（cc.Component，薄壳 ~180 行）
  ├─ onLoad：视图接线
  │    hudView / mapView / detailPanel 的回调 ──► presenter.intent()
  ├─ start                     ──► presenter.start()
  ├─ schedule 1s / 60s         ──► presenter.fastTick(now) / slowTick(now)
  ├─ onDestroy                 ──► presenter.dispose()
  ├─ presenter.onStateChange   ──► renderAll()：读 presenter.state，喂三个视图
  ├─ presenter.onLoadingChange ──► showLoading / showContent
  └─ 实现并注入副作用端口（Presenter 自己碰不到 cc/framework）：
       navigateToBattle = ProcedureManager.navigate(GameRoute.Battle, …)
       showTip          = FW.showTip
       showRewards      = FW.ShowReward
       walletSeed       = readRoleRow()
       lifecycleHost    = this（请求的取消宿主）

TerritoryPresenter（纯 TS，application/，import 链上无 cc / framework）
  ├─ 持有：map / layout / progress / saveState / stages / stageByCell
  │         + flags（startingBattle、chapterLoadId、resultNotice…）
  ├─ intents：start / selectSite / closeDetail / requestBattle
  │           / switchChapter / fastTick / slowTick / dispose
  ├─ state：ITerritoryViewState（地图渲染输入 + HUD + 弹窗，一次性组装）
  └─ 三个数据端口（接口）：
       ITerritoryChapterLoader   章节数据（地图 JSON + campaign + 美术）
       ITerritoryCellGateway     服务端格子状态
       ITerritoryChapterStore    本地存档（localStorage 落盘）
```

依赖方向（全部满足 §2 硬约束）：



```
TerritoryPage（view）
  └─► adapters（application：ChapterLoader / SaveStoreAdapter / 现有 CellRepository）
        └─► ports（接口声明在 Presenter 文件里）
Presenter ─► ports（类型）+ model 纯模块
adapters  ─► cc / framework / RefUtil（边界处允许）
Presenter ─► 禁止 import cc / framework / 其他 app feature
```



***

## 2. 新增文件

### 2.1 `application/TerritoryPresenter.ts`（核心，纯 TS）

Presenter 类 + 全部端口 / 状态类型集中在此（adapters 用 `import type` 反向引用，不产生运行时循环）。



```
// ── 数据端口 ────────────────────────────────────────────────────────────

/** 一章的加载产物。loader 内部允许碰 cc / RefUtil；Presenter 只消费结构。 */
export interface ITerritoryChapterBundle {
    readonly mapJson: unknown;
    readonly campaign: {
        readonly stages: TerritoryCampaignStage[];
        readonly playerCardCount: number;
        readonly idleRewardMaxHours: number;
    };
    readonly art: ITerritoryBattleArt;
}
export interface ITerritoryChapterLoader {
    /** 地图 JSON 拉不到（≠ 单张美术缺失）返回 null，调用方展示加载失败。 */
    load(chapterId: number): Promise<ITerritoryChapterBundle | null>;
}

/** 服务端格子网关；运行时直接传现有 TerritoryCellRepository 实例（结构匹配）。 */
export interface ITerritoryCellGateway {
    fetchChapterCells(
        chapterId: number, maxCell: number, host?: unknown,
    ): Promise<TerritoryCellFetchResult>;
    clear(): void;
}

/** 本地存档端口；落盘实现见 TerritorySaveStoreAdapter。 */
export interface ITerritoryChapterStore {
    loadLastChapter(): number;
    saveLastChapter(chapterId: number): void;
    load(chapterId: number, walletSeed: TerritoryWallet): TerritoryChapterSave;
    saveProgress(
        chapterId: number, progress: TerritoryProgressData, source: TerritoryChapterSave,
    ): TerritoryChapterSave;
    settleIdleRewards(
        chapterId: number, sources: readonly TerritoryIdleRewardSource[],
        maxHours: number, now: number, source: TerritoryChapterSave,
    ): TerritoryIdleRewardSaveResult;
    beginBattle(
        chapterId: number,
        request: { cellId: number; levelId: number; silverCost: number; staminaCost: number },
        source: TerritoryChapterSave,
    ): TerritoryBeginBattleResult;
    clearBattle(chapterId: number, source: TerritoryChapterSave): TerritoryChapterSave;
}

// ── 副作用输出（页面实现）────────────────────────────────────────────────

/** navigateToBattle 收到的就是现 ProcedureManager.navigate 的 { pve: … } 里的 pve。 */
export interface ITerritoryBattleNavParams {
    readonly levelId: number;
    readonly chapterId: number;
    readonly stage: number;
    readonly territoryCellId: number;
    readonly mode: string;
    readonly enemyName: string;
    readonly enemyCardIds: number[];
    readonly enemyTeamCardIds: readonly number[];
    readonly playerCount: number;
    readonly hpRate: number;
    readonly attackRate: number;
    readonly waves: ReadonlyArray<{
        readonly waveId: number; readonly showAtSeconds: number;
        readonly pvpCardId: number; readonly monsterCount: number;
        readonly hpRate: number; readonly attackRate: number;
    }>;
}

export interface ITerritoryPresenterOutputs {
    readonly navigateToBattle: (pve: ITerritoryBattleNavParams) => void;
    readonly showTip: (text: string) => void;
    readonly showRewards: (rewards: readonly TerritoryIdleRewardGain[]) => void;
}

export interface ITerritoryPresenterPorts {
    readonly loader: ITerritoryChapterLoader;
    readonly gateway: ITerritoryCellGateway;
    readonly store: ITerritoryChapterStore;
    readonly outputs: ITerritoryPresenterOutputs;
    readonly walletSeed: () => TerritoryWallet;
    readonly availableChapters: readonly number[];
    readonly lifecycleHost?: unknown;
}

// ── 视图状态（Presenter 输出，页面只读）──────────────────────────────────

export interface ITerritoryDetailState {
    readonly open: boolean;
    readonly content: ITerritorySiteDetailContent | null;
}

export interface ITerritoryViewState {
    readonly ready: boolean;
    readonly chapterId: number;
    readonly map: TerritoryMapConfig | null;
    readonly layout: ITerritoryMapLayout;
    readonly art: ITerritoryBattleArt;
    readonly progress: TerritoryProgress | null;
    readonly stageByCell: ReadonlyMap<number, TerritoryCampaignStage>;
    readonly hud: ITerritoryHudRender | null;
    readonly detail: ITerritoryDetailState;
}

// ── Presenter ────────────────────────────────────────────────────────────

export class TerritoryPresenter {
    constructor(private readonly ports: ITerritoryPresenterPorts) {
        this.currentChapterId = ports.store.loadLastChapter();
    }

    /** 唯一的重渲染入口：页面在回调里 renderAll()。 */
    onStateChange: (() => void) | null = null;
    /** 加载态入口：message=null 回到常态。 */
    onLoadingChange: ((message: string | null) => void) | null = null;

    start(): void;
    dispose(): void;
    selectSite(site: TerritorySite): void;
    closeDetail(): void;
    requestBattle(): void;
    switchChapter(offset: number): void;
    fastTick(now: number): void;
    slowTick(now: number): void;

    get state(): ITerritoryViewState;
}
```

**实现口径（从现有 Page 1:1 搬运，不改语义）：**



* `loadChapter` 保留 `loadId` 取消、每处 `await` 后的 loadId / 存活检查；

  `cc` 存活检查（`isValid`）删除 —— 销毁由 `dispose()` 置位 + loadId 保证旧回包不落地。

* `showLoading / showContent` 改调 `onLoadingChange(message | null)`。

* 合并服务端状态的三态判定（`'reason' in result` 收窄、失败仅 warn 不阻断、`markServerStateKnown` 只在成功时调）原样搬入。

* `fastTick / slowTick` 对应当前 `tickProgress`（无 activeExplorations 早退）与 `tickIdleRewards`（每拍都 settle）。

* 状态组装采用**变更后一次性重建** hud + detail，`get state` 只返回字段；渲染顺序等价于现

  settle → persist → notify →（页面 renderAll）。

* `serverCellState / serverRewardClaimed` 两个 getter 经全仓检索**无外部调用**，随 Page 删除，

  gateway 快照留在 Presenter 内部。

### 2.2 `application/TerritoryChapterLoader.ts`（适配器，允许 cc）



```
export class TerritoryChapterLoader implements ITerritoryChapterLoader {
    constructor(private readonly assets: AssetService) {}

    async load(chapterId: number): Promise<ITerritoryChapterBundle | null> {
        const [mapJson, campaign] = await Promise.all([
            loadTerritoryMapJson(this.assets, chapterId),
            loadTerritoryCampaign(chapterId),
        ]);
        if (mapJson == null) return null;
        // 美术加载需要背景路径，先 configure 一次（Presenter 侧还会再 configure 用于建图）。
        const sourceMap = configureTerritoryMap(mapJson);
        const art = await loadTerritoryBattleArt(this.assets, sourceMap.background);
        return { mapJson, campaign, art };
    }
}
```

### 2.3 `application/TerritorySaveStoreAdapter.ts`（适配器，纯委托）

把 `TerritorySaveStore` 的静态方法包成实例端口；构造时传 `availableChapters` 与 fallback：



```
export class TerritorySaveStoreAdapter implements ITerritoryChapterStore {
    constructor(
        private readonly availableChapters: readonly number[],
        private readonly fallbackChapter = 1,
    ) {}

    loadLastChapter(): number {
        return TerritorySaveStore.loadLastChapter(this.availableChapters, this.fallbackChapter);
    }
    // saveLastChapter / load / saveProgress / settleIdleRewards / beginBattle / clearBattle
    // 全部一行委托给同名静态方法。
}
```

### 2.4 `tests/territory-presenter.test.ts`（新增，纯单测）

全部用假端口，不加载引擎；用例清单见 §5。



***

## 3. 修改文件

### 3.0（步骤 0）`model/TerritoryMapConfig.ts`：configureTerritoryMap 优化

纯 model 内部重构，不改变任何导出 API 与 throw 定位（编辑器侧 `territory-format.js` 仍负责全量 issues + 环路检测）。

**结构拆分**（主函数变成组合，约 30 行）：



```
const TERRITORY_MAP_MIN_SIDE = 4;
const TERRITORY_MAP_MAX_SIDE = 60;
const TERRITORY_DEFAULT_UNLOCK: TerritoryUnlock = {
    requiredCells: [], combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5,
};

interface TerritoryMapContext {
    readonly total: number;
    readonly startCellId: number;
    readonly occupied: Set<number>;
    readonly ids: Set<string>;
}

/** 严格：元素非整数直接 throw（带 label/index），不再静默过滤。 */
function cellList(value: unknown, label: string): number[];
function cellInRange(value: unknown, total: number, label: string): number;
function cellsInRange(value: unknown, total: number, label: string): number[];
function parseDefaults(raw: unknown): TerritoryUnlock;          // requiredCells 恒为 []，保持旧口径
function parseSiteUnlock(raw: unknown, fallback: TerritoryUnlock, total: number, label: string): TerritoryUnlock;
function parseHeader(data: Record<string, unknown>): TerritoryMapHeader;
function parseSite(raw: unknown, ctx: TerritoryMapContext, index: number, fallback: TerritoryUnlock): TerritorySite;
function parseRandomSites(raw: unknown, ctx: TerritoryMapContext): TerritoryRandomSites | undefined;
function parseDecorations(raw: unknown, total: number): TerritoryDecoration[] | undefined;
```

**收紧的校验（坏配置在边界直接 throw，不静默）：**



1. `requiredCells` / `candidateCells` 里的非整数、越界元素：旧实现被 `filter` 吞掉 → 改为 throw。

2. `footprint` 重复格子 → throw；`requiredCells` 含站点自身 footprint（会导致永久死锁）→ throw。

3. `decorations`：cellId 校验上界、artId 必须非空、同格重复 → throw。

4. `randomSites.maxActive` 必须 ≥ 1（为 0 属退化配置）。

5. `candidateCells` 仍按旧口径过滤 startCellId / 已被站点占用格并 dedupe（这是有意的业务过滤，不是丢数据）。

**去重 / 常量化：** 行列范围 `[4,60]` 与默认 `10/2/5` 提为命名常量；`nonNegative` 后重复的 `>=0`

断言、三处「数组→整数→过滤」样板、`parseRandomSites` 入口重复的 `isRecord` 全部消除。

**保留不动：** `background: ''` 是既成契约（运行时回落 `bg_03`）；`name` 缺省回落 id；

运行时不做全量 issues 收集与环路检测。

**测试（**`tests/territory-map-config.test.ts`**&#x20;新增）：** 非法 / 越界 requiredCells、requiredCells 含自身、

footprint 重复、decoration 越界 / 空 artId / 重复、maxActive=0、candidateCells 非整数均 throw；

defaults 缺省仍落 10/2/5 且 requiredCells 为空。

### 3.1 `view/TerritoryPage.ts`（670 → 约 180 行）

保留：`@property` 四个引用、`onLoad`（接线 + instantiate detailPanel）、`start`、`onDestroy`、

`renderAll`、loading 切换；其余全部删除。骨架：



```
@ccclass('TerritoryPage')
export class TerritoryPage extends Component {
    @property mapScrollView: ScrollView = null!;
    @property mapView: TerritoryMapView = null!;
    @property hudView: TerritoryHeaderView = null!;
    @property detailPrefab: Prefab = null!;

    private presenter!: TerritoryPresenter;
    private detailPanel!: TerritorySiteDetailPanel;
    private lastRenderedChapter = -1;

    initialize(assets: AssetService): void {
        const store = new TerritorySaveStoreAdapter(TERRITORY_CHAPTERS, TERRITORY_CHAPTERS[0]);
        this.presenter = new TerritoryPresenter({
            loader: new TerritoryChapterLoader(assets),
            gateway: new TerritoryCellRepository(),
            store,
            availableChapters: TERRITORY_CHAPTERS,
            lifecycleHost: this,
            walletSeed: () => this.walletSeed(),
            outputs: {
                navigateToBattle: (pve) =>
                    ProcedureManager.navigate(GameRoute.Battle, { pve }),
                showTip: (text) => FW.showTip(text),
                showRewards: (rewards) => this.presentIdleRewards(rewards),
            },
        });
        this.presenter.onStateChange = () => this.renderAll();
        this.presenter.onLoadingChange = (message) => this.onLoadingChange(message);
    }

    onLoad(): void {
        this.hudView.initialize({
            onPreviousChapter: () => this.presenter.switchChapter(-1),
            onNextChapter: () => this.presenter.switchChapter(1),
        });
        this.mapView.initialize((site) => this.presenter.selectSite(site));
        // instantiate detailPrefab → detailPanel，initialize 回调 → presenter.closeDetail / requestBattle
        this.onLoadingChange(TERRITORY_TEXTS.loading);
    }

    start(): void { this.presenter.start(); }

    onDestroy(): void { this.presenter.dispose(); }
    // 保留现有的「不能对子节点 off」引擎陷阱注释，移到 dispose 调用处。

    private renderAll(): void {
        const state = this.presenter.state;
        if (!state.ready || !state.map || !state.progress) return;
        const resetScroll = state.chapterId !== this.lastRenderedChapter;
        this.lastRenderedChapter = state.chapterId;
        this.mapView.renderMap({
            map: state.map, layout: state.layout, art: state.art,
            progress: state.progress, stageByCell: state.stageByCell,
        });
        if (resetScroll) this.mapScrollView.scrollToOffset(new Vec2(0, 0), 0);
        if (state.hud) this.hudView.render(state.hud);
        if (state.detail.open && state.detail.content) this.detailPanel.open(state.detail.content);
        else if (!state.detail.open && this.detailPanel.isOpen) this.detailPanel.close();
    }

    private onLoadingChange(message: string | null): void {
        if (message === null) {
            this.mapScrollView.node.active = true;
            this.hudView.setLoading(null);
        } else {
            this.detailPanel?.close();
            this.mapScrollView.node.active = false;
            this.hudView.setLoading(message);
        }
    }

    private walletSeed(): TerritoryWallet { /* 现有 readRoleRow + TERRITORY_FALLBACK_WALLET 逻辑 */ }
    private presentIdleRewards(rewards: readonly TerritoryIdleRewardGain[]): void { /* 现有 FW.ShowReward 适配 */ }

    private readonly onFastTick = (): void => this.presenter.fastTick(Date.now());
    private readonly onSlowTick = (): void => this.presenter.slowTick(Date.now());
}
```

注意：`schedule(this.onFastTick, 1)` / `schedule(this.onSlowTick, 60)` 仍在 **Presenter 加载成功之后**才启动 ——

把这两个 schedule 调用放到 Page 的 `onLoadingChange(null)` 里（现口径是在 `loadChapter` 末尾）；

切章 loading 时由 `onLoadingChange(message)` 中 `unschedule`，与现有行为一致。

### 3.2 测试守卫更新



* `tests/territory-page-split.test.ts`（现 7 条）


  * 现有「页面应驱动三个视图」三条断言保留（`renderMap` / `hudView.render` / `detailPanel.open`）。

  * 新增守卫：Page 源码（剥注释后）不得再出现 `configureTerritoryMap`、`loadTerritoryCampaign`、

    `TerritorySaveStore.`、`new TerritoryProgress`、`settleIdleRewards`、`.beginBattle(`

    （业务已全部在 Presenter；`TerritorySaveStoreAdapter` 是合法的适配器，不在禁用列）。

  * 新增 Presenter 纯度守卫（剥注释 + 剥 `import type` 含多行块后断言）：


    * 不含 `from 'cc'`、不含 `framework`；

    * 不得依赖四个边界模块：`TerritoryPageAssets`、`TerritoryCellRepository`、

      `TerritoryCampaignRepository`、`TerritorySaveStore`（仅允许 `import type` 其类型）。

* `tests/territory-page-current-json.test.ts`（现 5 条）


  * 随代码迁移的断言改读 Presenter：`/random\.candidateCells\.length/`、`/尚未发布/`；

  * 「仅展示地图站点，不扣资源、不进入战斗」字面文案在 `TerritoryTexts`，断言读它并

    同时钉 Presenter 引用 `TERRITORY_TEXTS.unboundStatus`；

  * 两处 stale 断言对齐实际代码：mapView 用 `TERRITORY_UNBOUND_TYPE_NAMES[site.type]` 与

    `badge: TERRITORY_TEXTS.pendingConfig`；HUD 美术改为通用 `COMMON_ART_ROOT` 的

    `cu_title_brown` / `cu_ty_btn09` / `cu_ty_btn13`。

* 其余三处含旧 Page 源码断言的文件同步迁移（业务编排断言 → Presenter，存档委托 → 适配器）：


  * `tests/main-tab-adventure-route.test.ts`：`loadTerritoryCampaign` 读 `TerritoryChapterLoader`、

    load/saveLastChapter/beginBattle 读 `TerritorySaveStoreAdapter`、导航组装读 Presenter、

    背景缺省回落改钉 `territory_bg_v1`；

  * `tests/territory-cell-protocol.test.ts`：Repository 持有仍在 Page，fetch/merge/clear、

    unlock/pass 调用方与顺序、reason 分流断言全部读 Presenter；

  * `tests/territory-idle-reward.test.ts`：idleRewardMaxHours/owned 过滤 / 结算顺序读 Presenter、

    `settleIdleRewards` 委托读适配器、定时器与 `FW.ShowReward` 仍在 Page。

### 3.3 `docs/AI架构与代码规范.md` §7.3.5



* 职责表新增两行：`Presenter（状态与编排，纯 TS）`、`端口适配器（ChapterLoader / SaveStoreAdapter）`；

  最后一行页数更新为 `TerritoryPage.ts（670 → ~180 行）`。

* 硬口径补一条：「页内只允许 Presenter 的 `onStateChange` 单回调，不新增细粒度事件 / 事件总线」。



***

## 4. 分步切分（每步可独立验证）



| 步骤 | 内容                                                                    | 验证                                                                                                         |
| -- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 0  | 重构 `TerritoryMapConfig.configureTerritoryMap` + 补 map-config 测试（§3.0） | `npx tsx --test tests/territory-map-config.test.ts`                                                        |
| 1  | 新增 `TerritoryChapterLoader` + `TerritorySaveStoreAdapter`（暂不接线）       | `npx tsc --noEmit -p tsconfig.json`（新增文件零类型错误）                                                             |
| 2  | 新增 `TerritoryPresenter.ts` + `tests/territory-presenter.test.ts`      | `npx tsx --test tests/territory-presenter.test.ts`                                                         |
| 3  | 重写 `TerritoryPage.ts` 接线（§3.1）                                        | 先跑 §3.2 两个守卫：`npx tsx --test tests/territory-page-split.test.ts tests/territory-page-current-json.test.ts` |
| 4  | 更新守卫断言与 §7.3.5 文档                                                     | `npm test` 全量                                                                                              |
| 5  | 编辑器 / 真机回归（清单见 §6）                                                    | 人工冒烟                                                                                                       |

每步结束都可提交；步骤 0–2 不改变任何运行时行为（步骤 0 只收紧坏配置，published JSON 已过编辑器校验）。



***

## 5. Presenter 单测用例（`tests/territory-presenter.test.ts`）

假件：`FakeLoader`（可控返回 bundle /null）、`FakeGateway`（可控三态）、`FakeStore`（内存账本）、

outputs 用 spy 记录调用。



1. **start 首载**：loader 以初始章节被调用；结束后 `state.ready=true`，HUD 含「章节名・已占领 N/M・已启用 K 张卡牌」。

2. **加载失败**：loader 返回 null → `onLoadingChange` 收到失败文案；state 不 ready。

3. **选点 - 有关卡**：`selectSite` → `detail.open=true`，content 与现 `stageDetailContent` 一致（体力 / 银币 / 敌人 / 奖励文本）。

4. **选点 - 待配置**：未绑定站点 → `canStart=false`，副标题含类型名。

5. **关闭弹窗**：`closeDetail` → `detail.open=false`。

6. **开战 - 资源足**：`requestBattle` → store 被扣费、`navigateToBattle` 收到 pve（含 waves/enemyCardIds 映射）。

7. **开战 - 资源不足**：银币或体力不够 → `showTip` 收到原因、**未** navigate、弹窗 startEnabled=false。

8. **切章**：未完成点下一章 → `showTip`（需要先完成）；上一章可直接切；完成后下一章触发新加载。

9. **fastTick**：探索到期 → 新占领格进 state、通知一次；未到期 → 不通知。

10. **slowTick**：满结算窗口 → `showRewards` 收到挂机产出；未到窗口无输出。

11. **网关失败**：gateway 返回 `offline/failed` → 页面仍 ready（本地存档放行，不阻断）。

12. **dispose 语义**：dispose 后 loader/gateway 回包到达不落地、tick 不抛不通知；模拟快速连切两章，旧 loadId 回包不污染新章 state。



***

## 6. 编辑器 / 真机冒烟清单（步骤 5）



* [ ] 进「冒险」页：地图、HUD、加载态正常；`MapScrollView` 双向拖拽 + 惯性，拖动中不误开站点。

* [ ] 点有关卡站点：详情文本与开战按钮态正确；点「待配置」站点无开战按钮。

* [ ] 开战：扣费正常、跳转战场；胜负回来后占领 / 提示正确（含杀后台、重登回来的补结算）。

* [ ] 倒计时：探索中的「剩余 N 秒」每秒刷新；到点自动占领、HUD 占领数更新。

* [ ] 挂机：满 1 小时自动结算弹奖励；断网 / 弱网下页面仍可点、不卡死。

* [ ] 切章：未完成时下一章给提示；上一章 / 下一章切换后地图回中心、不串上一章状态。



***

## 7. 风险与回滚



| 风险                        | 应对                                                     |
| ------------------------- | ------------------------------------------------------ |
| tick 早退 / 通知条件搬运偏差导致多刷或漏刷 | 用例 9/10/12 锚定；渲染层幂等，多刷只会费性能，漏刷由冒烟清单兜底                  |
| `schedule` 启动 / 停止时机迁移    | 统一挂在 `onLoadingChange` 两个分支，与 loadChapter 末尾 / 清场处一一对应 |
| 网络请求 `caller` 生命周期变化      | `lifecycleHost` 仍传 Page 组件本身，RequestMsg 取消语义不变         |
| SaveStoreAdapter 委托漏静态方法  | 端口接口方法逐个对照，tsserver 报未实现即阻断                            |
| 行为回退                      | 每步独立提交，步骤 3 出问题可单独 revert，1–2 为无行为变更                   |

**明确不做：** 不做事件总线 / 细粒度事件；不把 `FWEventCenter` 用于页内；不改 prefab 节点与 `.meta`；

不把 SaveStore 改成实例（备选方案，本次不采用，避免触碰战斗流程对 `resolveBattle` 的调用）。



***

## 8. 完成定义（DoD）



* `npm test` 全绿（含 21 个 territory 测试 + 新增 presenter 测试）。

* `npx tsc --noEmit` 零错误。

* §6 冒烟清单全部通过。

* §7.3.5 文档更新落地，页数与职责表与代码一致。

* 交付说明列出：改动文件、验证命令与实测结果、未覆盖风险。