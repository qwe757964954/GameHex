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
 *          ⚠️ ③ 现在拿不到（服务端没实现 `CmdStartBattle`，见 `BattleStartService`），
 *          所以实际生效的是 ① + ② —— 昵称/头像来自 `CmdRole`，段位来自服务端，其余仍是本地占位。
 *   对手 —— 匹配成功那一刻显示服务端下发的对手单元（`pickOpponents`），
 *          拿不到就退回本地对手池。
 *   服务端给的是 id（`gradeId` / `artifactId` / `img`），界面要的是段位名 / 神器名 / 头像图，
 *   所以 `onPreload` 里先把 `grade` / `pvpArtifact` / `head` / `icon` 四张表读成
 *   `MatchProfileLookup` 交给上面几个 `apply*`。头像那条是**两层表**
 *   （`img` → `head.icon` 中文名 → `icon.path` 的 `ui://包/资源名` 末段）。
 */
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
     *  所以可以安全地让匹配流程等它，也可以安全地不检查它的结果。
     */
    private battleStartTask: Promise<ZCBattleStart | null> | null = null;

    async onPreload(_params?: any, context?: ProcedurePreloadContext): Promise<void> {
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
        this.matchingNode = instantiate(this.matchingPrefab);
        this.matchingNode.setParent(this.host);
        this.matchingNode.setPosition(Vec3.ZERO);

        const page = this.matchingNode.getComponent(MatchingPage);
        if (!page || !this.iconLoader) {
            this.error('MatchingRoot 组件或匹配内容服务缺失，匹配界面无法启动');
            return;
        }
        //  用 beginMatch 而不是 start：start 是 Cocos 组件的生命周期回调，会被引擎无参调用。
        const provider = this.sessionAssets as unknown as Partial<BattlePreloadProvider>;
        // 正常路径直接接管登录后已经完成的加载；未经过登录流程时保留直接进入的兜底。
        const preload = provider.takeBattlePreload?.()
            ?? new ZCGamePreload(new ZCGameLoader(this.assets, this.configs, MAP_DIRECTORY));
        this.battlePreload = preload;
        void preload.ready.catch((error) => {
            if (this.battlePreload === preload) this.error(`对局资源预加载失败：${error}`);
        });
        //  「开始游戏」的服务端语义就在这一步：点主界面按钮进到匹配流程 = 请求开一局。
        //  请求与下面的匹配动画**并行**跑（服务端内网应答是毫秒级），所以不拖慢开局手感；
        //  它自带硬超时且不 reject，拿不到就整条退回本地对手池，匹配流程不会因此失败。
        clearLastBattleStart();
        const battleStartTask = startBattle(
            params?.battleType ?? ZC_BATTLE_TYPE_PVP,
            params?.battleParams ?? [],
        );
        this.battleStartTask = battleStartTask;

        // 我方信息条的起始数据：本机昵称 / 头像（`CmdRole` 缓存）+ 本地占位。
        //  底下的段位/奖杯在服务端数据到达前是假的（`MatchPool.LOCAL_PLAYER` 的占位值），
        //  所以下面立刻去要真的要得着的那一份 —— 见 `refreshMineView` 的注释。
        //  头像要查两张表（`head` + `icon`），所以必须把 `profileLookup` 一起传进去。
        const identity = readSelfIdentity();
        this.selfIdentity = identity;
        this.mineBase = buildSelfPlayerData(identity, this.profileLookup);
        // ⚠️ 神器**不在这里取**。
        //
        //  原来读 `CacheMgr.instance.getTlCmdArtifact()?.[0]` —— 那是 `CmdArtifact` **推送**缓存，
        //  而本客户端从未订阅这条推送（`CmdArtifact` 只出现在 CacheMgrGen 与 protobuf 里，
        //  没有任何 `register`/`onPush` 把它写进缓存）⇒ `getTlCmdArtifact()` 恒为 `[]`
        //  ⇒ `first` 恒 undefined ⇒ artifactName / artifactIcon 永远留空，
        //  匹配页神器位**一直空白**（图标那格上一轮刚被清掉占位帧，于是彻底空出来）。
        //
        //  正确来源与对手同源：`CmdStartBattleRspMsg.unitInfos[].artifactId`
        //  （`applyUnitToPlayerView` 里查表换名字 + 图标名）。回包到达时由
        //  `refreshMineView` 统一合并上屏 —— 那条本来就会覆盖 artifact 字段，无需在此预置。
        this.pvpInfo = null;
        this.selfUnit = null;

        page.beginMatch({
            mine: this.mineBase,
            iconLoader: this.iconLoader,
            tips: this.tips,
            // 搜索时长到点时，若服务端数据还在路上，最多再等它一会儿再选人 ——
            // 保证「界面上展示的对手」与「真正带进对局的对手」是同一份数据。
            awaitReady: () => battleStartTask.then(() => undefined),
            pickOpponents: () => this.pickOpponents(),
            onMatched: (opponents) => {
                if (this.battlePreload === preload) this.enterBattle(opponents);
            },
        });

        // ① 服务端权威的我方 PVP 信息（段位 / 积分）—— 匹配过程中就显示自己的个人信息，
        //    不等匹配成功。**这是目前唯一通的那条**：`CmdStartBattleRspMsg.unitInfos`
        //    服务端还没实现（一律回 `CmdTips{content:"配置错误"}`）。
        //    拿不到（未连接 / 超时 / 服务端未实现）时 `refreshMineView` 什么都不做，保留本地占位。
        // 先用上次缓存的段位/积分上屏（打完一局加减分后不会闪空），再拉新的覆盖
        this.pvpInfo = getLastPvpInfo();
        void fetchPvpInfo().then((info) => {
            if (!info) return;
            this.pvpInfo = info;
            this.refreshMineView();
        });

        // ② 服务端下发的我方战斗单元（昵称 / 战力 / 段位 / 段位积分 / 神器）——
        //    覆盖范围比 ① 大，但要等「开始游戏」回包；服务端通了之后这条会盖在 ① 上面。
        void battleStartTask.then((battle) => {
            if (!battle) return;
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
            this.selfUnit = mine;
            this.refreshMineView();
        });
        this.log('进入匹配流程');
    }

    /**
     * 重算我方信息条并上屏 —— **两条服务端数据的统一合并点**。
     *
     *  `CmdPvpInfoReqMsg` 与 `CmdStartBattleReqMsg` 是并行发的，到达顺序不定。
     *  如果各自 `then` 里直接 `updateMine(自己那份)`，就成了「谁后到谁赢」：
     *  段位来自 PVP 信息、战力来自战斗单元时，先到的会被后到的整条盖掉（且偶发）。
     *  所以这里每次都**从 `mineBase` 重新叠一遍**，与到达顺序无关。
     *
     *  流程已切走（`matchingNode` 已销毁）时直接返回 —— 不能碰已销毁的界面。
     */
    private refreshMineView(): void {
        const node = this.matchingNode;
        if (node == null) return;
        const page = node.getComponent(MatchingPage);
        if (!page) return;
        const withPvp = applyPvpInfoToPlayerView(this.mineBase, this.pvpInfo, this.profileLookup);
        page.updateMine(applyUnitToPlayerView(withPvp, this.selfUnit, this.profileLookup));
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
        const opponent = opponents[0];
        this.opponent = opponent;
        const battle = getLastBattleStart();
        if (battle) {
            this.log(`匹配到对手：${opponent.name}（战力 ${opponent.power}）`
                + ` · battleId=${battle.battleId} seed=${battle.seed} 单元 ${battle.units.length} 只`);
        } else {
            this.log(`匹配到对手：${opponent.name}（战力 ${opponent.power}）· 本局无服务端数据（本地对局）`);
        }
        this.navigate(GameRoute.Battle, {
            opponent,
            opponents,
            preload: this.battlePreload,
            battle,
            selfRoleId: this.selfIdentity?.roleId,
        });
    }
}
