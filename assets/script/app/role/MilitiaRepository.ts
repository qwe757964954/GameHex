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
import { readItemCounts } from '../card/ItemBag';
import { RequestArmyUpLevel } from '../generated/requestMsg/RequestArmyMsg';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { toCount } from '../net/RequestGuard';
import {
    buildMilitiaSnapshot,
    parseMilitiaLevelRows,
    parseMilitiaModifiers,
    talentAttrsOf,
    talentDescsOf,
    talentDetailOf,
} from './MilitiaTable';
import type { IMilitiaLevelRow, IMilitiaModifierRow, IMilitiaTalentDetail, IMilitiaTalentSnapshot } from './MilitiaTypes';
import { MILITIA_ARMY_ID } from './MilitiaTypes';

/** 请求结果（与 `CardRepository` 同一套说法）。 */
export type MilitiaUpgradeResult = 'ok' | 'offline' | 'failed';

class MilitiaRepository {
    /** `armyLevel` 表（民兵的行，等级升序）。 */
    private rows: IMilitiaLevelRow[] = [];
    /** `skillAttrModifier` 表（id 索引）。 */
    private modifiers = new Map<number, IMilitiaModifierRow>();

    /** 先加载并索引两张配置表，列表和详情随后从内存同步读取。每次调用会重新读取表。 */
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

    /** 先调用 `loadTables`。升至下一等级的材料成本配置在当前等级行，持有量按该行的 `costItemID` 读取。 */
    snapshot(): IMilitiaTalentSnapshot {
        const level = this.level();
        const row = this.rows.find((r) => r.level === level);
        const itemOwned = row ? this.itemCount(row.costItemID) : 0;
        return buildMilitiaSnapshot(this.rows, level, this.modifiers, this.gold(), itemOwned);
    }

    /** 先调用 `loadTables`。总览汇总从 1 级到当前等级（含）的属性和技能描述。 */
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

    /** 升级请求只提交兵种 ID，材料由服务端结算。本地持有量用于判断按钮可用性。 */
    async requestLevelUp(caller: object, armyId: number = MILITIA_ARMY_ID): Promise<MilitiaUpgradeResult> {
        return GameNet.sendRequest(() => new RequestArmyUpLevel({ armyId }, caller), { tag: 'MilitiaRepository' });
    }
}

/** 民兵天赋数据仓库单例。 */
export const militiaRepository = new MilitiaRepository();
