import { instantiate, Node, Prefab, Vec3 } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureBase } from '../../framework/procedure/ProcedureBase';
import type { ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { ARTIFACT_ART_ROOT, MATCH_ART_ROOT, MATCH_SLOT_BARS, MATCH_SLOT_FRAMES } from '../ArtPaths';
import { preloadHeadByIds } from '../HeadArtModel';
import { applyUnitToPlayerView, splitBattleUnits, ZC_BATTLE_TYPE_PVP } from '../battle/BattleStartModel';
import type { MatchProfileLookup, ZCBattleStart, ZCBattleUnit } from '../battle/BattleStartModel';
import { clearLastBattleStart, getLastBattleStart, startBattle } from '../battle/BattleStartService';
import { applyPvpInfoToPlayerView } from '../battle/PvpInfoModel';
import type { ZCPvpInfo } from '../battle/PvpInfoModel';
import { getLastPvpInfo, fetchPvpInfo } from '../battle/PvpInfoService';
import { CacheMgr } from '../net/CacheMgr';
import { createMatchIconLoader, preloadMatchIcons } from '../matching/MatchIcons';
import type { MatchIconLoader } from '../matching/MatchIcons';
import { MatchingPage } from '../matching/MatchingPage';
import { LOCAL_PLAYER } from '../matching/MatchPool';
import { loadMatchProfileLookup } from '../matching/MatchProfileConfig';
import { SelfIdentity, buildSelfPlayerData, readSelfIdentity } from '../matching/MatchSelfProfile';
import { loadMatchTips } from '../matching/MatchTipsConfig';
import { MatchPlayerData } from '../matching/MatchTypes';
import type { IMatchingEntryParams } from '../matching/MatchTypes';
import type { BattlePreloadProvider } from '../session/AppSessionAssetService';
import { MAP_DIRECTORY } from '../zcds/ZCGame';
import { ZCGameLoader } from '../zcds/application/ZCGameLoader';
import { ZCGamePreload } from '../zcds/application/ZCGamePreload';
import { EventMgr } from '../../framework/event/EventMgr';

const MATCHING_ROOT_URL = 'ui/matching/MatchingRoot';

/**
 * 战斗匹配流程 —— 夹在主界面与对局之间。
 *
 * 生命周期：
 *   onPreload  预加载 MatchingRoot 预制体 + 界面用到的图标 + 底部提示文案，
 *              避免进入后图标逐帧弹出、提示条先空一格再补字
 *   onEnter    发「开始游戏」请求 + 启动匹配并接管登录后预加载的对局资源；
 *              成功展示后移交给 ProcedureGame
 *   onLeave    销毁匹配界面
 *
 * 界面**没有取消入口**，所以流程不提供中止回调；将来要接系统返回键，
 * 在这里导航到 `GameRoute.Main` 即可。
 *
 * 对手来源：
 *   ① 服务端 `CmdStartBattleRspMsg.unitInfos` 里非我方的那只单元（`BattleStartService`），
 *   ② 拿不到（未连接 / 超时 / 协议还没登记 MessageId）时打 error，不进假对局（以服务端为准）。
 * 两条路都在 `pickOpponents()` 里收敛，界面（`MatchingPage`）不需要知道数据从哪来。
 * 界面已支持 2~4 人局（按对手数组长度铺信息条），当前数据层仍只产出 1 名对手。
 *
 * 两侧信息条的数据来源（服务端 `CmdBattleUnitShowInfo` = 「个人信息参数」）：
 *   我方 —— 三段叠加，**后一段只覆盖前一段确实给了的字段**（`apply*ToPlayerView` 的统一口径）：
 *          ① 进界面先显示 `MatchSelfProfile`（`CmdRole` 缓存的**昵称 + 头像** + `MatchPool` 本地占位）；
 *          ② `CmdPvpInfoReqMsg` 一到 → 换成服务端权威的**段位 / 积分**（`applyPvpInfoToPlayerView`）；
 *          ③ 「开始游戏」回包一到 → 换成服务端下发的**我方**单元（`applyUnitToPlayerView`）。
 *          ②③ 是**并行**的两条请求，到达顺序不定，所以统一走 `refreshMineView()` 合并，
 *          不写「谁回来就覆盖谁」——那会变成到达顺序依赖，偶发。
 *   对手 —— 匹配成功那一刻显示服务端下发的对手单元（`pickOpponents`），
 *          开战未获服务端确认时终止匹配并返回主界面。
 *   服务端给的是 id（`gradeId` / `artifactId` / `img`），界面要的是段位名 / 神器名 / 头像图，
 *   所以 `onPreload` 里先把 `grade` / `pvpArtifact` / `head` / `icon` 四张表读成
 *   `MatchProfileLookup` 交给上面几个 `apply*`。头像那条是**两层表**
 *   （`img` → `head.icon` 中文名 → `icon.path` 的 `ui://包/资源名` 末段）。
 */
/** 匹配流程内的两条异步数据：`.then()` 里 emit，`onEnter` 订阅、`onLeave` 摘掉。 */
const MATCHING_EVENT = {
    PvpInfoReady: 'matching-pvp-info-ready',
    SelfUnitReady: 'matching-self-unit-ready',
} as const;

export class ProcedureMatching extends ProcedureBase {
    public static __cname: string = 'ProcedureMatching';

    /** 预加载得到的 MatchingRoot 预制体（缓存，重进匹配时复用）。 */
    private matchingPrefab: Prefab | null = null;

    /** 当前匹配界面节点实例（切出时销毁）。 */
    private matchingNode: Node | null = null;

    /** 最近一次匹配到的对手（切到对局时传给 ProcedureGame）。 */
    private opponent: MatchPlayerData | null = null;
    private iconLoader: MatchIconLoader | null = null;
    private tips: readonly string[] = [];
    private battlePreload: ZCGamePreload | null = null;

    /** 「服务端 id → 显示值」解析器（`onPreload` 读 `grade` / `pvpArtifact` / `head` / `icon` 建好）。 */
    private profileLookup: MatchProfileLookup | null = null;

    /** 本机身份（角色 id + 昵称），用来区分敌我与填我方昵称。 */
    private selfIdentity: SelfIdentity | null = null;

    /** 我方信息条的**起始**数据（本机昵称 + 本地占位）。所有覆盖都以它为底。 */
    private mineBase: MatchPlayerData = LOCAL_PLAYER;

    /** 服务端 PVP 信息（`CmdPvpInfoReqMsg` 的段位/积分），没拿到就是 `null`。 */
    private pvpInfo: ZCPvpInfo | null = null;

    /** 服务端下发的**我方**战斗单元（`CmdStartBattleRspMsg.unitInfos`），没拿到就是 `null`。 */
    private selfUnit: ZCBattleUnit | null = null;

    /**
     * 本局「开始游戏」的在途请求。
     *
     *  它**自带硬超时**（`BATTLE_START_TIMEOUT_MS`）且保证不 reject —— 见 `BattleStartService`，
     *  null 表示开战未获确认，必须结束匹配，禁止转成本地对局。
     */
    private battleStartTask: Promise<ZCBattleStart | null> | null = null;

    async onPreload(_params?: any, context?: ProcedurePreloadContext): Promise<void> {
        this.sessionAssets?.pauseWarmup?.();
        if (!context) throw new Error('匹配流程缺少 ProcedurePreloadContext');
        if (!this.matchingPrefab) {
            const prefab = await this.assets.load(MATCHING_ROOT_URL, Prefab, { scope: context.resources });
            if (context.cancelled) return;
            this.matchingPrefab = prefab;
            this.log('MatchingRoot 预加载完成');
        }
        this.iconLoader = createMatchIconLoader(this.assets, context.resources);
        // 提示文案随 remoteRef bundle 下发，这里先读一次进缓存，界面打开即可直接上屏。
        //  四张「id → 显示值」表（`grade` / `pvpArtifact` / `head` / `icon`）同理：服务端
        //  下发的 gradeId / artifactId / img 必须在这里就能换成名字与资源名，否则信息条
        //  只能显示本地兜底值（读表失败不抛，退回空解析器）。
        //  必须先于下面的图标预加载 —— 本机头像的资源名要从 `head`+`icon` 里查。
        const [tips, lookup] = await Promise.all([
            loadMatchTips(this.configs),
            loadMatchProfileLookup(this.configs),
        ]);
        if (context.cancelled) return;
        this.tips = tips;
        this.profileLookup = lookup;

        // 预取本局用到的头像/放大镜；对手图标在选中后再取（数量随对手而变）。
        // 头像与放大镜在 `image/matching`（页面大图）；信息条小图标 `icon_01..05` 在
        // `image/icon/matching`，由 MatchPlayerItem.refresh 按需取。
        //
        // ⚠️ 神器图标**不在 `image/matching`**（那儿只有一张固定占位 `icon_faqi.png`），
        // 真源是 `image/artifact/<pvpArtifact[].icon>` —— 与对局里的神器格同一张图。
        //
        // 预热名只能从 `profileLookup` 现查（`LOCAL_PLAYER.artifactIcon` 是空串占位），
        // 而**本局神器 id 要等「开始游戏」回包才拿得到**（见 `refreshMineView`），
        // 所以这一轮几乎必然查不到 → 预热是**尽力而为**：`refreshMineView` 之后
        // 图标由 `MatchPlayerItem.refresh` 自己按需取（`iconLoader` 有缓存），
        // 只是首帧可能晚一两帧出图，不再是「永远空白」。
        const warmup: Promise<unknown>[] = [preloadMatchIcons(
            // 本方头像占位 + 放大镜 + 4 套条底/头像框配色。
            //  配色图必须一起预热：`MatchPlayerItem.applySlot()` 是异步换图，
            //  不预热的话会先闪一下 prefab 里的默认蓝条再跳成对手色。
            [LOCAL_PLAYER.avatarIcon, 'icon_fdj', ...MATCH_SLOT_BARS, ...MATCH_SLOT_FRAMES],
            MATCH_ART_ROOT,
            this.iconLoader,
        )];
        // 兜底把 pvpArtifact 的图标全预热：条目固定十几张，代价可接受，
        // 换取「我方神器图标一定在进界面时已就绪」，不再依赖上面那次必然查不到的预热。
        warmup.push(preloadMatchIcons(
            lookup.allArtifactIcons(),
            ARTIFACT_ART_ROOT,
            this.iconLoader,
        ));
        // 本机头像（`CmdRole` 缓存里登录后就有）一并预取：不预取的话进界面的第一帧画的是
        // prefab 里的占位图 `img_people`，`resources.load` 回来（实测 ~0.4s）才跳成真头像 ——
        // 眼见的"头像闪一下"。走 `preloadHeadByIds` 而不是自己 `headArt.artName + iconLoader`：
        // 「id → 资源名 → 哪个根目录」这套只在 `HeadArtModel` 一处，页面/流程不该各写一遍。
        // （与上面那批**不同根**：那批在 `image/matching`，头像在 `image/icon/head`。）
        warmup.push(preloadHeadByIds(
            [readSelfIdentity()?.avatarId ?? ''],
            lookup.headArt,
            this.iconLoader,
        ));
        await Promise.all(warmup);
        if (context.cancelled) return;
    }

    onEnter(params?: IMatchingEntryParams): void {
        if (!this.matchingPrefab) {
            this.error('MatchingRoot 尚未预加载，无法进入匹配流程');
            return;
        }
        this.opponent = null;
        const matchingNode = instantiate(this.matchingPrefab);
        this.matchingNode = matchingNode;
        matchingNode.setParent(this.host);
        matchingNode.setPosition(Vec3.ZERO);

        const page = this.matchingNode.getComponent(MatchingPage);
        if (!page || !this.iconLoader) {
            this.error('MatchingRoot 组件或匹配内容服务缺失，匹配界面无法启动');
            return;
        }
        //  「开始游戏」的服务端语义就在这一步：点主界面按钮进到匹配流程 = 请求开一局。
        //  请求与下面的匹配动画**并行**跑（服务端内网应答是毫秒级），所以不拖慢开局手感；
        //  请求失败或超时必须结束匹配，不能把拒绝开战伪装成本地对局。
        clearLastBattleStart();
        const battleStartTask = startBattle(
            params?.battleType ?? ZC_BATTLE_TYPE_PVP,
            params?.battleParams ?? [],
            this,
            () => this.matchingNode === matchingNode,
        );
        this.battleStartTask = battleStartTask;
        const provider = this.sessionAssets as unknown as Partial<BattlePreloadProvider>;
        // 等回包人数和阵容确定后选图、加载本局表现；公共资源已由会话预下载。
        const preload = provider.takeBattlePreload?.()
            ?? new ZCGamePreload(new ZCGameLoader(this.sessionAssets?.reusableAssets ?? this.assets, this.configs, MAP_DIRECTORY),
                battleStartTask.then((battle) => {
                    if (!battle) throw new Error('服务端未确认开战');
                    return battle;
                }));
        this.battlePreload = preload;
        void preload.ready.catch((error) => {
            if (this.battlePreload === preload) this.error(`对局资源预加载失败：${error}`);
        });

        const identity = readSelfIdentity();
        this.selfIdentity = identity;
        this.mineBase = buildSelfPlayerData(identity, this.profileLookup);
        this.pvpInfo = null;
        this.selfUnit = null;
        EventMgr.instance.on(MATCHING_EVENT.PvpInfoReady, this.onPvpInfoReady, this);
        EventMgr.instance.on(MATCHING_EVENT.SelfUnitReady, this.onSelfUnitReady, this);

        page.beginMatch({
            mine: this.mineBase,
            iconLoader: this.iconLoader,
            tips: this.tips,
            // 搜索时长到点时，若服务端数据还在路上，最多再等它一会儿再选人 ——
            // 保证「界面上展示的对手」与「真正带进对局的对手」是同一份数据。
            awaitReady: () => battleStartTask.then((battle) => battle !== null && this.battlePreload === preload),
            pickOpponents: () => this.pickOpponents(),
            onMatched: (opponents) => {
                if (this.battlePreload === preload) this.enterBattle(opponents);
            },
        });

        // ① 服务端权威的我方 PVP 信息（段位 / 积分）—— 匹配过程中就显示自己的个人信息，
        //    不等匹配成功；它的返回不能替代开战回包作为进入对局的依据。
        // 先用上次缓存的段位/积分上屏（打完一局加减分后不会闪空），再拉新的覆盖
        this.pvpInfo = getLastPvpInfo();
        void fetchPvpInfo().then((info) => {
            if (!info) return;
            EventMgr.instance.emit(MATCHING_EVENT.PvpInfoReady, info);
        });

        // ② 服务端下发的我方战斗单元（昵称 / 战力 / 段位 / 段位积分 / 神器）——
        //    覆盖范围比 ① 大，但要等「开始游戏」回包；服务端通了之后这条会盖在 ① 上面。
        void battleStartTask.then((battle) => {
            if (this.matchingNode !== matchingNode || this.battlePreload !== preload) return;
            if (!battle) {
                this.battlePreload = null;
                preload.releaseFromMatching();
                this.battleStartTask = null;
                clearLastBattleStart();
                this.error('服务端未确认开战，结束匹配并返回主界面');
                this.navigate(GameRoute.Main);
                return;
            }
            // 调试：打印 CmdRole 推送与双方单元，排查"对手和自己一样"
            try {
                const roles = CacheMgr.instance.getTlCmdRole() ?? [];
                console.log('[调试] CmdRole 推送：', roles.map((r) => ({ id: String(r?.id), name: r?.name, img: String(r?.img) })));
            } catch (e) { console.log('[调试] CmdRole 读取失败', e); }
            console.log('[调试] 服务端下发单元：', battle.units.map((u) => ({
                roleId: u.roleId, campId: u.campId, name: u.name, power: u.power,
                gradeId: u.gradeId, gradeScore: u.gradeScore, artifactId: u.artifactId,
            })));
            console.log('[调试] 本机 selfRoleId =', this.selfIdentity?.roleId);
            const mine = this.pickSelfUnit(battle);
            if (!mine) return;
            EventMgr.instance.emit(MATCHING_EVENT.SelfUnitReady, mine);
        });
        this.log('进入匹配流程');
    }

    private onPvpInfoReady(info: ZCPvpInfo): void {
        this.pvpInfo = info;
        this.refreshMineView();
    }

    private onSelfUnitReady(unit: ZCBattleUnit): void {
        this.selfUnit = unit;
        this.refreshMineView();
    }

    /**
     * 重算我方信息条并上屏 —— 两条服务端数据的统一合并点。
     *
     *  `CmdPvpInfoReqMsg` 与 `CmdStartBattleReqMsg` 并行发、到达顺序不定；各自 `then` 里
     *  直接 `updateMine(自己那份)` 就会「谁后到谁赢」，所以每次都从 `mineBase` 重叠一遍。
     */
    private refreshMineView(): void {
        const withPvp = applyPvpInfoToPlayerView(this.mineBase, this.pvpInfo, this.profileLookup);
        this.matchingNode!.getComponent(MatchingPage)!
            .updateMine(applyUnitToPlayerView(withPvp, this.selfUnit, this.profileLookup));
    }

    /**
     * 从「开始游戏」回包里取出**我方**那只单元。
     *
     *  判据与 `splitBattleUnits` 一致：优先按本机 `roleId` 命中，命中不了才退回 campId 升序。
     *  拿不到回包 / 回包里没有单元时返回 `null`，调用方保持本地资料不动。
     */
    private pickSelfUnit(battle: ZCBattleStart): ZCBattleUnit | null {
        return splitBattleUnits(battle.units, this.selfIdentity?.roleId).mine;
    }

    /**
     * 选对手：返回本局**全部**对手（界面按数组长度铺信息条，支持 2~4 人局）。
     *
     *  服务端覆盖的是 `CmdBattleUnitShowInfo`（个人信息参数：昵称 / 战力 / 段位 / 段位积分）
     *  加上单元本体的 `artifactId` —— 段位 / 神器 / 头像在这里按 id 查表换成名字与资源名
     *  （`profileLookup`，头像那条是两层表）。
     *  `headFrame` 也是 id，但**本工程没有对应的资源**（策划侧 `T-头像表.xlsx` 没有框行、
     *  老端走 FairyGUI 组件渲染、无 loose png），所以框保留本地值 —— 见表里那张「待外部输入」。
     *
     *  ⚠️ 目前仍然只产出 **1 名**对手：`splitBattleUnits` 只把单元分成「我方 / 敌方」两堆，
     *  多人局需要服务端先给出多个 `campId` 的单元、且下游 `enterBattle` 能带多个对手进对局。
     *  界面侧（`MatchingPage`）已经按数组长度铺条，这里换成 `map` 即可，不必再动界面。
     */
    private pickOpponents(): readonly MatchPlayerData[] {
        const start = getLastBattleStart();
        const enemy = start ? splitBattleUnits(start.units, this.selfIdentity?.roleId).enemy : null;
        const emptyOpponent: MatchPlayerData = {
            name: '无对手', avatarIcon: '', power: 0, rank: '', trophy: 0,
            artifactName: '', artifactIcon: '', stats: [],
        };
        if (!enemy) {
            console.error('[ProcedureMatching] 服务端未返回对手数据，无法进入对局（以服务端为准）');
            this.log('服务端未返回对手数据');
            return [emptyOpponent];
        }
        this.log(`服务端下发对手：${enemy.name}（战力 ${enemy.power}，campId ${enemy.campId}`
            + `，段位 ${enemy.gradeId}/${enemy.gradeScore}，神器 ${enemy.artifactId}）`);
        return [applyUnitToPlayerView(emptyOpponent, enemy, this.profileLookup)];
    }

    onPreloadCancelled(): void {
        this.battlePreload?.releaseFromMatching();
        this.battlePreload = null;
        this.matchingPrefab = null;
        this.opponent = null;
        this.iconLoader = null;
        this.tips = [];
        this.battleStartTask = null;
        this.pvpInfo = null;
        this.selfUnit = null;
        clearLastBattleStart();
    }

    onLeave(): void {
        EventMgr.instance.offTarget(this);
        this.battlePreload?.releaseFromMatching();
        this.battlePreload = null;
        if (this.matchingNode) {
            this.matchingNode.destroy();
            this.matchingNode = null;
        }
        this.matchingPrefab = null;
        this.iconLoader = null;
        this.tips = [];
        this.profileLookup = null;
        this.selfIdentity = null;
        this.pvpInfo = null;
        this.selfUnit = null;
        this.mineBase = LOCAL_PLAYER;
        // 本局数据已经在 enterBattle 里随 params 交给对局流程，缓存这里清掉，
        // 免得下一局复用上一局的 battleId。
        this.battleStartTask = null;
        clearLastBattleStart();
        this.releaseResourceScope();
        this.log('离开匹配流程');
    }

    protected onDestroy(): void {
        // 管理器销毁流程时不会调用 onLeave，后台预加载仍需要释放。
        this.onLeave();
        super.onDestroy();
    }

    /**
     * 「匹配成功！」展示完毕：把对手（以及本局服务端数据）带给对局流程。
     *
     *  参数是**全部对手**；对局流程目前只消费第一个（`params.opponent`），
     *  多人局落地时把 `opponents` 一并传过去即可。
     */
    private enterBattle(opponents: readonly MatchPlayerData[]): void {
        const battle = getLastBattleStart();
        if (!battle || opponents.length === 0) {
            this.error('缺少本局开战回包或对手，拒绝进入对局');
            return;
        }
        const opponent = opponents[0];
        this.opponent = opponent;
        this.log(`匹配到对手：${opponent.name}（战力 ${opponent.power}）`
            + ` · battleId=${battle.battleId} seed=${battle.seed} 单元 ${battle.units.length} 只`);
        this.navigate(GameRoute.Battle, {
            opponent,
            opponents,
            preload: this.battlePreload,
            battle,
            selfRoleId: this.selfIdentity?.roleId,
        });
    }
}
