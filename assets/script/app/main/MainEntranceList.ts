import { _decorator, CCInteger, Component, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { ART_ROOT } from '../ArtPaths';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import { HeadArt } from '../HeadArt';
import { IconArtResolver, loadIconByKey } from '../HeadArtModel';
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { toCount } from '../net/RequestGuard';
import { PopupManager } from '../../framework/ui/PopupManager';
import type { PopupBase } from '../../framework/ui/PopupBase';
import { ItemCreationMode, VirtualScrollView } from '../../vscrollview/VScrollView';
import { FirstRechargePage } from '../firstRecharge/FirstRechargePage';
import { FriendPage } from '../friend/FriendPage';
import { GiftPage } from '../gift/GiftPage';
import { MonthCardGiftPage } from '../monthcard/MonthCardGiftPage';
import { SevenDayPage } from '../sevenDay/SevenDayPage';
import { BattleTokenPage } from '../battletoken/BattleTokenPage';
import { LayerActivityPage } from '../activity/LayerActivityPage';
import { LimitTimeActPage } from '../limitTimeAct/LimitTimeActPage';
import { MailPage } from '../mail/MailPage';
import { ChatPage } from '../chat/ChatPage';
import { MainTabHost } from './MainTabHost';
import { RedDot } from '../common/RedDot';
import { resolveAllRdExprs } from '../rd/RdExprResolver';
import type { RdExprResolveResult } from '../rd/RdExprResolver';
import { RdExprBinding } from '../rd/RedDotBinding';
import { EntrancePopupKey, resolveEntranceRoute } from './MainEntranceRoute';
import {
    collectEntranceItems,
    ENTRANCE_ITEM_SIZE,
    ENTRANCE_ITEM_SPACING,
    ENTRANCE_SIDE_LAYOUT,
    MainEntranceItem,
    normalizeBelond,
    OpenRowLike,
} from './MainEntranceTypes';
import {
    EMPTY_ENTRANCE_PLAYER_STATE,
    indexOpenRowsByRefId,
    isEntranceRowVisible,
} from './MainEntranceVisible';
import type { EntrancePlayerState } from './MainEntranceVisible';

const { ccclass, property } = _decorator;

/** 入口图标落地目录（icon.json ui://图标_主界面/…）。 */
const ENTRANCE_ART_ROOT = `${ART_ROOT}/activityIcon`;

/** 条目上红点子节点的名字（模板 prefab 里是一个 `ui/common/RedDot` 实例）。 */
const ENTRANCE_RED_DOT_NAME = 'RedDot';

const FIRST_RECHARGE_TABLE = 'firstRechargeNew';

/**
 * 主界面左右两侧活动入口列表。
 * 列表本体是 prefab 上挂的 VirtualScrollView（序列化配置真源是 Inspector），
 * 本脚本只接 renderItemFn / onItemClickFn 两个回调。
 */
@ccclass('MainEntranceList')
export class MainEntranceList extends Component {
    @property({ type: CCInteger, tooltip: 'belond：2=左侧，3=右侧' })
    belond = 2;

    /** 路由 key → 弹窗类。新增界面只动这里 + Route 白名单。
     *
     *  ⚠️ `Partial`：`role`（角色主界面）**不是弹窗**了（2026-09-26 改成主界面 tab 页，
     *  与 `CardLineup` 同构）⇒ 它不在这张表里，走 {@link openPopupRoute} 开头的切 tab 分支。 */
    private static readonly POPUP_CLASSES: Partial<Record<EntrancePopupKey, new () => PopupBase>> = {
        firstRecharge: FirstRechargePage,
        sevenDay: SevenDayPage,
        monthCardGift: MonthCardGiftPage,
        gift: GiftPage,
        // 活动（open.json refId=102 / url=LayerActivity）——每日任务页。
        activity: LayerActivityPage,
        // 战令（open.json refId=104 / url=LayerBattleToken）——4 页签主容器。
        battleToken: BattleTokenPage,
        // 好友（open.json refId=206 / url=LayerFriend）——三页签主容器。
        friend: FriendPage,
        // 邮件（open.json refId=301 / url=LayerMail）——邮件列表容器。
        mail: MailPage,
        // 聊天（open.json refId=13 / url=LayerChat）。⚠️ 表里 `belond = 0` ⇒ 左右列收不到它，
        // 主界面入口在 BottomHud/ChatBar；这里登记只为白名单一致。
        chat: ChatPage,
        // 角色主界面（open.json refId=2 / url=TabRoleMain）——**主界面 tab 页**，不是弹窗
        // （2026-09-26 山猫定：「应该类似 CardLineup，不是弹窗」）⇒ 不在 POPUP_CLASSES 里，
        // 由 openPopupRoute 开头的分支切 tab。
        limitTimeBuy: LimitTimeActPage,
    };

    private items: MainEntranceItem[] = [];
    private readonly frames = new Map<string, SpriteFrame | null>();
    private readonly iconSprites = new Map<Node, Sprite>();
    private list: VirtualScrollView | null = null;
    private loading = false;

    /** refId → 聚合后的红点表达式（空串 = 这个入口没红点）。由 `reload()` 重算。 */
    private rdExprByRefId: ReadonlyMap<number, string> = new Map();

    /** 槽位节点 → 其上的 RedDot 组件。虚拟列表复用槽位，按节点缓存。 */
    private readonly redDots = new Map<Node, RedDot>();

    /** RedDot → 绑定器。一个槽位换绑到别的入口时走同一个绑定器重新 `bind`。 */
    private readonly rdBindings = new Map<RedDot, RdExprBinding>();

    /** 「模板上没有 RedDot」只报一次，别每渲染一个槽位刷一行。 */
    private warnedMissingRedDot = false;

    onLoad(): void {
        let list = this.node.getComponent(VirtualScrollView);
        if (!list) {
            console.error(
                `[MainEntranceList] ${this.node.name} 缺 VirtualScrollView，已兜底补最小配置。`,
            );
            list = this.node.addComponent(VirtualScrollView);
            list.content = this.node.getChildByName('Content');
            list.itemCreationMode = ItemCreationMode.NODE;
            list.spacing = ENTRANCE_ITEM_SPACING;
            list.enableMouseWheel = true;
        }
        this.list = list;

        list.renderItemFn = (node, index) => this.renderItem(node, index);
        list.onItemClickFn = (_node, index) => this.onItemClick(index);

        // 订阅 CmdRole 缓存更新：主界面创建早于服务端下发 CmdRole 时，onLoad 这一次
        // 读不到角色会按「未登录」过滤掉所有入口；缓存到达后必须重算一次（对齐 MainResBar）。
        CacheMgr.instance.setEventUpdate('CmdRole', this, this.onRoleCacheUpdate);
        void this.reload();
    }

    /** CmdRole 到达 / 升级 / 充值等变化后重算入口可见性。 */
    private onRoleCacheUpdate = (): void => {
        void this.reload();
    };

    onDestroy(): void {
        CacheMgr.instance.removeEventUpdate('CmdRole', this, this.onRoleCacheUpdate);
        // 必须解绑：表达式引擎里留着指向本槽位 RedDot 的回调，槽位销毁后再来一次值变化
        // 就会往死对象上写（`RdExprBinding` 头注释里写的第 1 种场合）。顺带把表达式的
        // 引用计数还回去，归零的表达式才会从 `ExprMgr` 里退场。
        for (const binding of this.rdBindings.values()) binding.unbind();
        this.rdBindings.clear();
        this.redDots.clear();
    }

    /** 读表 → 玩家状态 → 过滤 → 预取图标 → 刷列表。先取完图标再刷，避免复用条目闪旧图。 */
    async reload(): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        try {
            const openRows = (await RefUtil.instance.getRefAllAsync('open')) as OpenRowLike[];

            const state = await this.resolvePlayerState();
            const byRefId = indexOpenRowsByRefId(openRows);

            this.items = collectEntranceItems(openRows, normalizeBelond(this.belond), (row) =>
                isEntranceRowVisible(row, byRefId, state),
            );

            // 红点表达式：策划在 open.json 上给每个入口配 `RDExpr` + `tlRDResId`（关注哪些子入口），
            // 聚合出「这个入口自己 + 它关注的所有入口」的红点求和式。见 `RdExprResolver`。
            this.rdExprByRefId = buildEntranceRdExprs(openRows);

            // [DEBUG-ENTRANCE] 定位首充入口为何不显示，定位完可删
            const target = openRows.find((r) => r.url === 'LayerFirstRecharge');
            const blRows = CacheMgr.instance.getTlCmdBattleLevel() ?? [];
            const blRow1 = CacheMgr.instance.getCmdBattleLevel(1);
            console.log('[DEBUG-ENTRANCE] belond=', normalizeBelond(this.belond),
                'openRows=', openRows.length,
                'state=', JSON.stringify({
                    hasRole: state.hasRole, roleLevel: state.roleLevel,
                    rechargeCount: state.rechargeCount, firstRechargeId: state.firstRechargeId,
                    firstRechargeNextExists: state.firstRechargeNextExists, createdDays: state.createdDays,
                }),
                'CmdBattleLevel行数=', blRows.length,
                'getCmdBattleLevel(1)=', blRow1 ? JSON.stringify(blRow1) : 'null',
                'isLevelPassed(1)=', isLevelPassed(1),
                '首充可见=', target ? isEntranceRowVisible(target, byRefId, state) : '-',
                '最终条目=', this.items.map((i) => `${i.refId}:${i.url}`).join(','));

            const resolver = await HeadArt.loadIconArtResolver();
            await Promise.all(this.items.map((item) => this.loadFrame(item, resolver)));
            if (!this.isValid) return;

            this.applyList();
        } catch (error) {
            console.error('[MainEntranceList] 入口列表加载失败', error);
        } finally {
            this.loading = false;
        }
    }

    /** 取玩家可见状态。拿不到 CmdRole 走 EMPTY（带条件入口全隐藏）。不抛。 */
    private async resolvePlayerState(): Promise<EntrancePlayerState> {
        let role: CmdRole | null = null;
        try {
            const rows = CacheMgr.instance.getTlCmdRole() ?? [];
            role = rows.find((row) => row != null) ?? null;
        } catch (error) {
            console.warn('[MainEntranceList] CmdRole 缓存不可用', error);
        }

        if (!role) {
            console.warn('[MainEntranceList] 拿不到 CmdRole，入口按「未登录」口径过滤。');
            return EMPTY_ENTRANCE_PLAYER_STATE;
        }

        const rechargeCount = toCount(role.recharge);
        const firstRechargeId = toCount(role.cmdFirstRechargeInfo?.id);
        const firstRechargeNextExists =
            rechargeCount > 0 && firstRechargeId > 0 ? await firstRechargeTierExists(firstRechargeId + 1) : true;

        return {
            hasRole: true,
            roleLevel: toCount(role.lv),
            createdDays: createdDaysOf(toCount(role.createTime), Date.now()),
            rechargeCount,
            firstRechargeId,
            firstRechargeNextExists,
            audit: false,
            guardExists: false,
            lotteryOpenIds: [],
            miningShow: role.miningShow === true,
            dailyShareShow: false,
            osRankShow: false,
            isLevelPassed,
        };
    }

    private applyList(): void {
        const list = this.list;
        if (!list || !list.isValid) return;

        list.refreshList(this.items);

        const layout = ENTRANCE_SIDE_LAYOUT[normalizeBelond(this.belond)];
        if (layout.startAtTail) list.scrollToBottom(false);
        else list.scrollToTop(false);
    }

    /** 取条目图标；null 也缓存，避免滚动重试。 */
    private async loadFrame(item: MainEntranceItem, resolver: IconArtResolver): Promise<void> {
        if (this.frames.has(item.iconKey)) return;
        const frame = await loadIconByKey(item.iconKey, resolver, loadEntranceSprite);
        this.frames.set(item.iconKey, frame ?? null);
        if (!frame) console.warn(`[MainEntranceList] 入口图标取不到：${item.iconKey}`);
    }

    /** 渲染一条入口（列表在条目激活前回调）。 */
    private renderItem(node: Node, index: number): void {
        const item = this.items[index];
        const frame = item ? (this.frames.get(item.iconKey) ?? null) : null;

        // 红点先接（图有没有取到都得先把红点状态摆对）
        this.applyEntranceRedDot(node, item);

        const sprite = this.spriteOf(node);
        if (!sprite) return;

        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;

        const ut = sprite.node.getComponent(UITransform);
        if (!ut) return;
        const raw = frame?.originalSize;
        if (!raw || raw.width <= 0 || raw.height <= 0) {
            ut.setContentSize(ENTRANCE_ITEM_SIZE, ENTRANCE_ITEM_SIZE);
            return;
        }
        // 等比 contain（只缩不放、不变形）。
        const fit = Math.min(ENTRANCE_ITEM_SIZE / raw.width, ENTRANCE_ITEM_SIZE / raw.height);
        ut.setContentSize(raw.width * fit, raw.height * fit);
    }

    /**
     * 把该入口的红点表达式绑到槽位的 `RedDot` 上。
     *
     * 虚拟列表会**复用**槽位（同一个节点换 index），所以每次渲染都要走一遍：
     * `bind()` 内部先 `unbind()`，反复调用幂等；表达式没变时直接跳过，不做多余的
     * 建/拆 ToolSet 往返（`bind` 会立即同步回调一次，红点不会等下一帧）。
     */
    private applyEntranceRedDot(node: Node, item: MainEntranceItem | undefined): void {
        const redDot = this.redDotOf(node);
        if (!redDot) return;

        const expr = item ? (this.rdExprByRefId.get(item.refId) ?? '') : '';
        const binding = this.bindingOf(redDot);
        if (binding.currentExpr === expr) return;
        binding.bind(expr);
    }

    /** 取槽位上的红点。拿不到只报一次（模板被改坏了才会走到）。 */
    private redDotOf(node: Node): RedDot | null {
        const cached = this.redDots.get(node);
        if (cached && cached.isValid) return cached;

        const found = node.getChildByName(ENTRANCE_RED_DOT_NAME)?.getComponent(RedDot) ?? null;
        if (!found) {
            if (!this.warnedMissingRedDot) {
                this.warnedMissingRedDot = true;
                console.warn(
                    `[MainEntranceList] ${node.name} 下没有 ${ENTRANCE_RED_DOT_NAME}（RedDot），`
                    + '入口红点不会显示 —— 检查 ArenaRoot.prefab 的左侧/右侧入口条目模板。',
                );
            }
            return null;
        }
        this.redDots.set(node, found);
        return found;
    }

    private bindingOf(redDot: RedDot): RdExprBinding {
        let binding = this.rdBindings.get(redDot);
        if (!binding) {
            binding = new RdExprBinding(redDot);
            this.rdBindings.set(redDot, binding);
        }
        return binding;
    }

    private spriteOf(node: Node): Sprite | null {
        const cached = this.iconSprites.get(node);
        if (cached && cached.isValid) return cached;
        const sprite = node.getChildByName('Icon')?.getComponent(Sprite) ?? null;
        if (sprite) this.iconSprites.set(node, sprite);
        return sprite;
    }

    private onItemClick(index: number): void {
        const item = this.items[index];
        if (!item) return;

        const route = resolveEntranceRoute(item.url);
        if (route.kind === 'none') {
            // 能点与否由可见性决定，与界面有没有做无关，这里只留痕、不隐藏。
            console.warn(
                `[MainEntranceList] 入口 refId=${item.refId}（${item.url || '未配置 url'}）还没有界面，忽略点击`,
            );
            return;
        }

        void this.openPopupRoute(route.key, item);
    }

    /** 按 key 开弹窗；防连点交给 PopupManager（同类单实例）。 */
    private async openPopupRoute(key: EntrancePopupKey, item: MainEntranceItem): Promise<void> {
        // 「角色主界面」是**主界面 tab 页**（与 `CardLineup` 同构），不再是弹窗 ⇒ 切 tab。
        if (key === 'role') {
            const host = this.node.scene?.getComponentInChildren(MainTabHost);
            if (!host) {
                console.error(`[MainEntranceList] 入口 refId=${item.refId} 要切角色页，但场景里没有 MainTabHost`);
                return;
            }
            host.switchToRoleMain();
            return;
        }

        const cls = MainEntranceList.POPUP_CLASSES[key];
        const manager = PopupManager.inst;
        if (!cls) {
            console.error(`[MainEntranceList] 入口 refId=${item.refId} 路由 ${key}，但没有配置弹窗类`);
            return;
        }
        const popup = await manager.openAsync(cls);
        if (!popup) console.error(`[MainEntranceList] 入口 refId=${item.refId} 的弹窗 ${key} 打开失败`);
    }
}

// ============================================================
// 可见性取数（读坏了也不抛的降级口径）
// ============================================================

/** 某关是否已通关：CmdBattleLevel.star >= 1。 */
function isLevelPassed(level: number): boolean {
    try {
        const row = CacheMgr.instance.getCmdBattleLevel(level);
        return row != null && toCount(row.star) >= 1;
    } catch (error) {
        console.warn('[MainEntranceList] 读 CmdBattleLevel 失败', error);
        return false;
    }
}

/** 创角第几天（1-based）；拿不到创角时间返回 0。 */
function createdDaysOf(createTimeMs: number, nowMs: number): number {
    if (!Number.isFinite(createTimeMs) || createTimeMs <= 0) return 0;
    const created = startOfLocalDay(createTimeMs);
    const today = startOfLocalDay(nowMs);
    return Math.max(1, Math.round((today - created) / 86400000) + 1);
}

function startOfLocalDay(timeMs: number): number {
    const date = new Date(timeMs);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/** firstRechargeNew 表有没有 tierId 档；读失败按 false（已买完）处理。 */
async function firstRechargeTierExists(tierId: number): Promise<boolean> {
    try {
        const rows = (await RefUtil.instance.getRefAllAsync(FIRST_RECHARGE_TABLE)) as { id?: unknown }[];
        return (rows ?? []).some((row) => toCount(row?.id) === tierId);
    } catch (error) {
        console.warn('[MainEntranceList] 读 firstRechargeNew 失败，首充入口按已买完处理', error);
        return false;
    }
}

// ============================================================
// 红点表达式（读坏了也不抛的降级口径）
// ============================================================

/**
 * `open.json` 全表 → `refId` → 聚合后的红点表达式（只留非空的）。
 *
 * 聚合规则（自引用 / 成环 / 缺配置的守卫）全在 `RdExprResolver` 里，与老端
 * `SystemObject.GetRDExpr` 对齐；这里只负责把警告转成日志 —— 配置错不该让入口列表挂掉，
 * 但也不能静默（静默就是「策划改了表、红点不亮、没人知道」）。
 */
function buildEntranceRdExprs(rows: readonly OpenRowLike[]): ReadonlyMap<number, string> {
    const out = new Map<number, string>();
    let resolved: Map<number, RdExprResolveResult>;
    try {
        resolved = resolveAllRdExprs(rows);
    } catch (error) {
        console.error('[MainEntranceList] 红点表达式聚合失败，入口红点全部按「无」处理', error);
        return out;
    }

    const warned = new Set<string>();
    for (const [refId, result] of resolved) {
        if (result.expr) out.set(refId, result.expr);
        for (const warning of result.warnings) {
            if (warned.has(warning)) continue;
            warned.add(warning);
            console.warn(`[MainEntranceList] open.json 红点配置：${warning}`);
        }
    }
    return out;
}

const entranceCache = createRoutedSpriteFrameCache('MainEntranceList');

function loadEntranceSprite(name: string, root: string = ENTRANCE_ART_ROOT): Promise<SpriteFrame | null> {
    return entranceCache.loadNamed(name, root);
}
