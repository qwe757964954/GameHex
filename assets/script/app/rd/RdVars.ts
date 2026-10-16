/**
 * 客户端自算型红点变量的**真实现** —— 老端 `model/expr/RD/Client/**` 的对应物。
 *
 * ## 已经接了哪些
 * | 变量 | 数据源 | 口径（对应老端） |
 * |---|---|---|
 * | `RDActivity` / `RDActivityEvenyDayTask` | `activityRepository.load()` + `taskHasRedDot` | 活动页有可领的任务（老端 `RDActivityEvenyDayTask`，入口那个 set 只是它的聚合） |
 * | `RDBattleToken` | `battleTokenRepository.load()` + `RdJudgements.battleTokenRedDot` | 等级已到、档位已开、奖励还没领（`RDBattleToken`）；**支持带参** `[RDBattleToken:<type>]` = 战令页内某格 |
 * | `RDFriend` | `friendRepository.load()` + `RdJudgements.friendRedDot` | 有好友申请 **或** 「领取体力」可点（`RDFriend`） |
 * | `RDGift` / `RDGiftOnce` / `RDGiftWeek` / `RDGiftDaily` / `RDGiftMonth` | `rechargeActivityRepository.load().hasRedDot` | 充值页签里任一有可领奖励（`hasRecharegeTotalRd`） |
 * | `RDLeague` | `leagueRepository.loadLeagueEntryRedDots()` + `RdJudgements.leagueRedDot` | 已入盟 ∧（砍价 ∪ 任务 ∪ 北伐）—— 老端 `RDLeague.OnComputeResult()`；**不含捐献**（广告未迁） |
 *
 * ## 统一的写法（新加一个照抄）
 * ```
 * class RDXxxVar extends RdAsyncClientVar {
 *     private hasRedDot = false;
 *     protected GetWatchCacheNames() { return ['CmdYyy']; }   // 依赖哪张缓存 —— 变了要**重新装载**
 *     protected async loadSnapshot(): Promise<boolean> {      // 同步算不出来的部分
 *         const snapshot = await xxxRepository.load();
 *         if (this.destroyed) return false;                   // await 后必须判（界面可能已经关了）
 *         this.hasRedDot = <判定>(snapshot);
 *         return true;
 *     }
 *     protected OnComputeResult(): number { return this.hasRedDot ? 1 : 0; }  // 必须同步、必须 number
 * }
 * ```
 * 判定函数一律放 `RdJudgements.ts`（零 `cc` 依赖，Node 用例能直接跑），**别写在本文件里** ——
 * 本文件的 import 链上有 `CacheMgr`，进了 `cc` 就不进单测了。
 *
 * ## 还没接的（`RdTypes.RD_CLIENT_VARS` 里 `impl: 'stub'` 的那些）
 * - **玩法没做**：军师 / 兵种 / 武将 / 近卫 / 工坊 / 商店 / 秘境 / 开服冲榜 /
 *   签到 / 分享 / 历练 / 主城 / 主公技 —— 等系统落地再补数据源。现在注册成恒 0 的桩
 *   （名字必须在，否则表达式报「尚未注册该值」⇒ 红点静默不亮）。
 * - **玩法做了但取数口径要定**：
 *   - `RDChat`：⚠️ 卡在**聊天模块自己的「已读」没接线**，不是红点体系的锅 ——
 *     全仓 `IChatRepository.markRead()` **没有任何调用方**（`ChatPage` 只在退出时调了
 *     `saveRead()`）⇒ `readTimeOf()` 恒 0 ⇒ `ChatTable.hasUnread()` 对**任何有消息的会话**
 *     都返回 true ⇒ 现在接上去就是**永久亮着的假红点**。
 *     取数路径本身已经通（`ChatRepository.onBroadcast` 会给新会话建 page ⇒ 仓库的 `pages`
 *     里就有全部私聊流，只要补一个 `hasAnyUnread()` 就够了）。
 *     ⇒ **顺序：先补「进会话时 markRead」，再接 `RDChat`**。谁先谁后写反了就是假红点。
 *   - `RDFirstRecharge`：`open.json` 用的是**服务端型**的 `RDFirstRechargeServer`（已接），
 *     这个客户端型的暂时没有引用点。
 *   - `RDLimitTime`：限时礼包页在新工程还没落地。
 *
 * ## 顺带记一笔：变量接好了，但**界面**还没挂红点节点的地方
 * 红点体系只负责「表达式 → 值」；界面上要真看见，还得对应 prefab 里有 `RedDot` 节点
 * （或挂 `ui/common/RedDot.prefab`）。目前这些位置还是「故意没建空节点」的状态：
 * - 礼包：`GiftSubTab`（子页签）、`RechargeDailyView` / `RechargeTotalView`（页内）、`RechargeChest`；
 * - 邮件：`MailRow`（`com_rd`）；
 * - 聊天：`ChatPrivateHead`（`com_rd`）、主界面 `ChatEntry`（现在是个占位 Sprite）。
 *
 * ⚠️ 礼包子页签那四个（413 每日 / 414 周常 / 415 月度 / 416 终身）变量**值都等于整页聚合**，
 * 见上面 `RDGiftDaily` 的注释 —— 要接子页签红点得先按 plan 周期拆判据，否则四个页签一起亮。
 */

import type { ExprVarBase } from '../../framework/expr/ExprVarBase';
import { activityRepository } from '../activity/LayerActivityRepository';
import { taskHasRedDot } from '../activity/LayerActivityTable';
import { battleTokenRepository, maxLevelOf } from '../battletoken/BattleTokenRepository';
import { battleTokenRdType } from '../battletoken/BattleTokenTable';
import { friendRepository } from '../friend/FriendRepository';
import { rechargeActivityRepository } from '../gift/RechargeActivityRepository';
import { leagueRepository } from '../league/LeagueRepository';
import { battleTokenRedDot, friendRedDot, leagueRedDot } from './RdJudgements';
import { RdAsyncClientVar } from './RdClientVar';

// ============================================================
// 充值礼包（一组页签共用一个「聚合红点」）
// ============================================================

/** 充值礼包聚合红点（`CmdActivity` 缓存一有推送就重新装载）。 */
abstract class RdRechargeGiftVar extends RdAsyncClientVar {
    /** 最近一次装载到的红点状态。`OnComputeResult` 只读它（同步）。 */
    private hasRedDot = false;

    protected GetWatchCacheNames(): readonly string[] {
        return ['CmdActivity'];
    }

    protected async loadSnapshot(): Promise<boolean> {
        const snapshot = await rechargeActivityRepository.load();
        // await 之后对象可能已经被销毁（界面关了 / 退登），别再往下写
        if (this.destroyed) return false;
        this.hasRedDot = snapshot?.hasRedDot === true;
        return true;
    }

    protected OnComputeResult(): number {
        return this.hasRedDot ? 1 : 0;
    }
}

/** 礼包入口（老端 `RDGift`）。 */
export class RDGift extends RdRechargeGiftVar {
    static __cname: string = 'RDGift';
}

/** 终身礼包（老端 `RDGiftOnce`）。 */
export class RDGiftOnce extends RdRechargeGiftVar {
    static __cname: string = 'RDGiftOnce';
}

/** 每周礼包（老端 `RDGiftWeek`）。 */
export class RDGiftWeek extends RdRechargeGiftVar {
    static __cname: string = 'RDGiftWeek';
}

/**
 * 每日礼包（老端 `RDGiftDaily`）。
 *
 * ⚠️ 老端它是 `RDGiftBase`（按 `GiftType.day` 扫商店里 `cost == 0` 且没买满的行）；
 * Demo3.8 的礼包页签走 `RechargeActivityTable`，判据 = `rechargeTotalRedDot`。
 * 两边都是「这个页签里有东西可领」，所以与 `RDGift` 共用聚合红点。
 * 要做到「各子页签自己的红点」时得按 plan 的周期字段过滤 —— 等礼包页做子页签红点再拆。
 */
export class RDGiftDaily extends RdRechargeGiftVar {
    static __cname: string = 'RDGiftDaily';
}

/** 每月礼包（老端 `RDGiftMonth`）。口径同 `RDGiftDaily`。 */
export class RDGiftMonth extends RdRechargeGiftVar {
    static __cname: string = 'RDGiftMonth';
}

// ============================================================
// 活动（每日任务）
// ============================================================

/**
 * 活动入口红点（老端 `RDActivity` / `RDActivityEvenyDayTask`）。
 *
 * 老端 `RDActivity` 是个聚合 set（`GetScript() = "[RDActivityEvenyDayTask]"`，见
 * `ModelActivity.GetActivityBtnRdExpr()`），`RDActivityEvenyDayTask` 才是真判定。
 * Demo3.8 的活动页就是「每日任务」，所以一个类直接代表两者 —— 不去造只有单元素的 set。
 */
class RdActivityVar extends RdAsyncClientVar {
    private hasRedDot = false;

    protected GetWatchCacheNames(): readonly string[] {
        return ['CmdActivity'];
    }

    protected async loadSnapshot(): Promise<boolean> {
        const snapshot = await activityRepository.load();
        if (this.destroyed) return false;
        const state = snapshot.state;
        this.hasRedDot = (snapshot.tasks ?? []).some((task) => taskHasRedDot(task, state));
        return true;
    }

    protected OnComputeResult(): number {
        return this.hasRedDot ? 1 : 0;
    }
}

/** 活动入口（老端 `RDActivity`）。 */
export class RDActivity extends RdActivityVar {
    static __cname: string = 'RDActivity';
}

/**
 * 老端 `RDActivityEvenyDayTask` —— `RDActivity` 的聚合子项，**判定实体**就是它。
 *
 * 为什么不省掉：这个名字在 `RD_EXTRA_VAR_NAMES` 里被登记过（老端确实注册了它），
 * 策划顺手往 `open.json` 一填就会生效。若只注册 `RDActivity`，它只能落到恒 0 的桩上 ——
 * 表现是**红点不亮、不报错**，最难查的那类。所以两个名字都给真实现。
 *
 * 单开一个类（而不是两个键指向同一个类）只为日志里 `this.constructor.name` 看得出是谁在算。
 */
export class RDActivityEvenyDayTask extends RdActivityVar {
    static __cname: string = 'RDActivityEvenyDayTask';
}

// ============================================================
// 战令
// ============================================================

/**
 * 战令红点（老端 `RDBattleToken`）。
 *
 * ## 带参 = 页内某个页签
 * 表达式写 `[RDBattleToken:<type>]` 时，`ExprVarMgr` 会按「名字 + 参数」建**另一个实例**
 * （`Hash(name,p1,p2,p3)`），本类从 `GetP1()` 取参数 ⇒ 同一个变量名服务四格，
 * 每格各算自己的 `type`。
 *
 * - 无参（`[RDBattleToken]`）—— `open.json` `refId=104` 战令**入口**，
 *   老端 `RDBattleToken.OnComputeResult()` 口径（取第一个 VO = 通行证）；
 * - 带参（`[RDBattleToken:3]` 等）—— 战令**页内**四格，
 *   与老端 `LayerBattleToken.refreshRd()` 逐 tab 的 `GetBattleTokenRD(type)` 对齐。
 *
 * ⚠️ 参数解析一律走 `battleTokenRdType()`（非法值回落默认页），别在这里自己 `Number()`。
 */
class RDBattleTokenVar extends RdAsyncClientVar {
    private hasRedDot = false;

    protected GetWatchCacheNames(): readonly string[] {
        // 等级 / 经验 / 各档位开没开 / 已领等级 全在 `CmdBattleToken`（按 type 分表）
        return ['CmdBattleToken'];
    }

    protected async loadSnapshot(): Promise<boolean> {
        // await 之前先把 type 定下来（规则：async 之后不依赖 async 之前读到的成员）
        const type = battleTokenRdType(this.GetP1());
        const snapshot = await battleTokenRepository.load();
        if (this.destroyed) return false;
        this.hasRedDot = battleTokenRedDot(
            {
                plans: snapshot.plans,
                rewards: snapshot.rewards,
                states: snapshot.states,
                maxLevel: maxLevelOf(snapshot),
            },
            type,
        );
        return true;
    }

    protected OnComputeResult(): number {
        return this.hasRedDot ? 1 : 0;
    }
}

export class RDBattleToken extends RDBattleTokenVar {
    static __cname: string = 'RDBattleToken';
}

// ============================================================
// 好友
// ============================================================

/** 好友入口（老端 `RDFriend`）。 */
class RDFriendVar extends RdAsyncClientVar {
    private hasRedDot = false;

    protected GetWatchCacheNames(): readonly string[] {
        // 申请列表 / 好友列表各一张缓存。自己「今日已领次数」在 `CmdRole` —— 它变化时
        // 服务端会连带重推好友表，所以不必再多挂一张（多挂只是多一次重算，不会更准）。
        return ['CmdFriendApply', 'CmdFriend'];
    }

    protected async loadSnapshot(): Promise<boolean> {
        const snapshot = await friendRepository.load();
        if (this.destroyed) return false;
        this.hasRedDot = friendRedDot(
            snapshot?.applyRows?.length ?? 0,
            snapshot?.friendRows,
            snapshot?.config?.takeEndTimes ?? 0,
        );
        return true;
    }

    protected OnComputeResult(): number {
        return this.hasRedDot ? 1 : 0;
    }
}

export class RDFriend extends RDFriendVar {
    static __cname: string = 'RDFriend';
}

// ============================================================
// 联盟
// ============================================================

/**
 * 联盟入口红点 —— `open.json` refId 14「联盟」的 `RDExpr: "[RDLeague]"`。
 *
 * 老端 `RDLeague.OnComputeResult()`：已入盟 ∧（任务 ∪ 捐献 ∪ 砍价 ∪ 北伐）。
 * 本端少一条「捐献」（广告链路未迁，详见 `RdJudgements.leagueRedDot`）。
 *
 * ⚠️ 在 `RDLeague` 还是桩的时候，主界面「联盟」入口的**红点永远不亮** —— 而 `open.json`
 *    一直在用这个表达式 ⇒ 属于「界面无感的静默失效」，这类洞只能靠对老端 `RD/Client/**`
 *    逐个点名才查得出来。
 */
abstract class RDLeagueVar extends RdAsyncClientVar {
    private hasRedDot = false;

    protected GetWatchCacheNames(): readonly string[] {
        // 三条判据各自的数据源：
        //   · `CmdRoleUnion`     —— 砍价次数（`todayBargainTimes`）
        //   · `CmdTask`          —— 联盟任务的进度与领取状态
        //   · `CmdUnionActivity` —— 北伐活动（活动没开时那条判据本就不亮）
        // `gameConfig` / `taskUnion` 是**配置表**，运行期不会变，不必监听（多挂只是多一次重算）。
        return ['CmdRoleUnion', 'CmdTask', 'CmdUnionActivity'];
    }

    protected async loadSnapshot(): Promise<boolean> {
        const dots = await leagueRepository.loadLeagueEntryRedDots();
        // await 之后对象可能已被销毁（界面关了 / 退登）—— 往死对象上写状态没意义
        if (this.destroyed) return false;
        this.hasRedDot = leagueRedDot(dots);
        return true;
    }

    protected OnComputeResult(): number {
        return this.hasRedDot ? 1 : 0;
    }
}

export class RDLeague extends RDLeagueVar {
    static __cname: string = 'RDLeague';
}

/** 变量名 → 实现类。`RdRegistry` 遍历它注册，其余客户端型自动补桩。 */
export const RD_CLIENT_VAR_CLASSES: Readonly<Record<string, new () => ExprVarBase>> = {
    RDActivity,
    // 老端是「聚合 set [RDActivityEvenyDayTask]」，判定实体是子项 —— 两个名字同一份判定
    RDActivityEvenyDayTask,
    RDBattleToken,
    RDFriend,
    RDLeague,
    RDGift,
    RDGiftDaily,
    RDGiftMonth,
    RDGiftOnce,
    RDGiftWeek,
};
