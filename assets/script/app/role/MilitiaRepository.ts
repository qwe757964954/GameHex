/**
 * 民兵「天赋」数据仓库（**单例**）。
 *
 * 数据三路：
 *   ① `armyLevel` 配置表 —— 等级曲线（消耗 / 图标 / effect），`RefUtil`；
 *   ② `skillAttrModifier` 配置表 —— 效果名与描述；
 *   ③ `CmdArmyLevel` 缓存 —— 当前等级（服务端下发，`CacheMgrGen.getCmdArmyLevel`）。
 * 加上两路「持有量」：`CmdRole.gold`（金币）+ `CmdItem`（道具，走 `readItemCounts`）。
 *
 * 判定全在 {@link MilitiaTable}（零 `cc`，规则 78）；这里只做取数与发请求。
 */
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { RequestArmyUpLevel } from '../generated/requestMsg/RequestArmyMsg';
import { toCount } from '../net/RequestGuard';
import { readItemCounts } from '../card/ItemBag';
import type { IMilitiaLevelRow, IMilitiaModifierRow, IMilitiaTalentDetail, IMilitiaTalentSnapshot } from './MilitiaTypes';
import { MILITIA_ARMY_ID } from './MilitiaTypes';
import {
    buildMilitiaSnapshot,
    parseMilitiaLevelRows,
    parseMilitiaModifiers,
    talentAttrsOf,
    talentDescsOf,
    talentDetailOf,
} from './MilitiaTable';

/** 请求结果（与 `CardRepository` 同一套说法）。 */
export type MilitiaUpgradeResult = 'ok' | 'offline' | 'failed';

class MilitiaRepository {
    /** `armyLevel` 表（民兵的行，等级升序）。 */
    private rows: IMilitiaLevelRow[] = [];
    /** `skillAttrModifier` 表（id 索引）。 */
    private modifiers = new Map<number, IMilitiaModifierRow>();

    /**
     * 读两张配置表（幂等，重复调用会重读 —— 表是远端下发的，热更可能换）。
     *
     * ⚠️ 单独暴露出来：视图层要在**铺列表之前**先把表读好，否则每格渲染时现读会闪。
     */
    async loadTables(): Promise<void> {
        const [levelRows, modifierRows] = await Promise.all([
            RefUtil.instance.getRefAllAsync('armyLevel'),
            RefUtil.instance.getRefAllAsync('skillAttrModifier'),
        ]);
        this.rows = parseMilitiaLevelRows((levelRows ?? []) as unknown[]);
        this.modifiers = parseMilitiaModifiers((modifierRows ?? []) as unknown[]);
    }

    /** 当前民兵等级（`CmdArmyLevel.level`；读不到时 `buildMilitiaSnapshot` 兜 1 级）。 */
    level(): number {
        const cmd = CacheMgr.instance.getCmdArmyLevel(MILITIA_ARMY_ID) as { level?: unknown } | null;
        return toCount(cmd?.level as number);
    }

    /** 持有金币（`CmdRole.gold`，单行表取第一行）。 */
    gold(): number {
        const rows = CacheMgr.instance.getTlCmdRole() as Array<{ gold?: unknown }> | null;
        const first = rows?.[0];
        return first ? toCount(first.gold as number) : 0;
    }

    /** 持有道具数量（`CmdItem`，与背包同一通道）。 */
    itemCount(itemId: number): number {
        return readItemCounts().get(String(itemId)) ?? 0;
    }

    /**
     * 整页快照（列表 + 焦点 + 红点）。
     *
     * ⚠️ 必须先 {@link loadTables}。道具持有量按「当前等级行」的 `costItemID` 读 ——
     * 老端 `checkCanLvUp` 也是取当前等级那一行。
     */
    snapshot(): IMilitiaTalentSnapshot {
        const level = this.level();
        const row = this.rows.find((r) => r.level === level);
        const itemOwned = row ? this.itemCount(row.costItemID) : 0;
        return buildMilitiaSnapshot(this.rows, level, this.modifiers, this.gold(), itemOwned);
    }

    /**
     * 天赋总览的两份列表（老端 `LayerMiltiaAllAttr`）。
     *
     * ⚠️ 必须先 {@link loadTables}。区间 = `1 .. 当前等级`（含当前级）。
     */
    overview(): { attrs: string[]; descs: string[] } {
        return {
            attrs: talentAttrsOf(this.rows, this.level(), this.modifiers),
            descs: talentDescsOf(this.rows, this.level()),
        };
    }

    /** 指定等级的详情（点列表一格）。 */
    detailOf(level: number): IMilitiaTalentDetail | null {
        const row = this.rows.find((r) => r.level === level);
        const itemOwned = row ? this.itemCount(row.costItemID) : 0;
        return talentDetailOf(this.rows, this.level(), level, this.gold(), itemOwned, this.modifiers);
    }

    /**
     * 兵种升级：发 `CmdArmyLevelUpReqMsg { armyId }`。
     *
     * ⚠️ 与「卡牌升级」同一口径：**消耗由服务端结算**，请求体里没有任何材料参数
     * （客户端算出来的「够不够」只用来置灰按钮）。
     * 老端成功后还会开「升级信息」弹窗（`openLayerArmyLevelUpInfo`），但**民兵（66014）被写死排除**
     * —— 所以这里成功后只重刷界面，不额外弹窗。
     */
    async requestLevelUp(armyId: number = MILITIA_ARMY_ID): Promise<MilitiaUpgradeResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        try {
            const ok = await net.send(new RequestArmyUpLevel({ armyId }, this as never, () => { }), false);
            return ok ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[MilitiaRepository] 兵种升级请求失败', error);
            return 'failed';
        }
    }
}

/** 民兵天赋数据仓库单例。 */
export const militiaRepository = new MilitiaRepository();
