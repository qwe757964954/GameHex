/**
 * 卡牌攻击动画时长的口径守卫（2026-11-18）。
 *
 * 背景：`PVP-卡牌.xlsx` 的这两列在 2026-11-06 按骨架实测重配过一轮，但美术换皮的几张
 * （水手菇 / 菇八戒 / 风炮菇 / 分裂菇 / 机甲菇 / 磁电菇 / 毒箭菇 / 诅咒菇）后来只换了
 * `.skel`、表里还留着 `1.0` 这类占位值；`PVP-怪物卡牌.xlsx` 更是整表 37 行全是
 * `0.667 / 0.345`。表现层的口径是「状态机到点就切回 idle」（`ZCUnitSystem.updateUnit`：
 * `stateTime >= definition.attackDuration`），所以时长配短了 = **攻击动作被砍掉后半段**，
 * 配长了 = 单位卡在攻击态、攻击变慢（DPS 掉）。
 *
 * 这里守三件事，不需要读骨架（读骨架靠 `tools/spine_dur.py`，用例里跑 Python 不合适）：
 *   ① `unitAttackHitTime` 必须等于 `unitAttackDuration × 40%`（口径见 `patch_attack_anim_timing.js`）；
 *   ② 整表不许落成同一个占位值（那就是「没人管过」的样子）；
 *   ③ 三写一致：`assets/remoteRef` 与 `doc/塔防数据配置/json/client` 两份逐行相同。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readRefKvc, rowsOf } from './helpers/ref-kvc';

const CLIENT = '../doc/塔防数据配置/json/client';

/** 命中帧 = 攻击动画总时长的 40%（2026-11-06 的用户口径）。 */
const HIT_RATIO = 0.4;

/**
 * 刻意不守 40% 口径的卡。
 *
 * 运动霸（68033 / 50035）：它的普攻是**冲刺**，节拍由 `unitAttackInterval = 0.7s` 决定，
 * 而 `消灭学霸` 的 attack 片段是 1.0s —— 写 1.0 会把 0.7s 的节拍拖成 1.0s（DPS 掉三成），
 * 写 0.667 则是「动作播一半」。历史决定是**保节拍**，命中帧也沿用原来的 0.345。
 */
const HIT_RATIO_EXCEPTIONS = new Set([68033, 50035]);

interface IRow {
    readonly id: number;
    readonly name: string;
    readonly unitAttackDuration?: number;
    readonly unitAttackHitTime?: number;
}

/** 读 remoteRef 表 → 行对象数组（列存 / 行对象数组两种产物格式由 helper 收口）。 */
function readRemoteRef(name: string): IRow[] {
    return rowsOf(readRefKvc(`assets/remoteRef/${name}`)) as unknown as IRow[];
}

/** 读 client 行数组（一行一行的 `[{...}]`）。 */
function readClient(name: string): IRow[] {
    return JSON.parse(readFileSync(`${CLIENT}/${name}`, 'utf8')) as IRow[];
}

const TABLES: { label: string; file: string }[] = [
    { label: 'pvpCard（玩家卡牌）', file: 'pvpCard.json' },
    { label: 'monsterCard（怪物卡牌）', file: 'monsterCard.json' },
];

for (const table of TABLES) {
    test(`${table.label}：命中时点 = 攻击动画时长 × 40%`, () => {
        for (const row of readRemoteRef(table.file)) {
            const duration = row.unitAttackDuration;
            const hit = row.unitAttackHitTime;
            if (!(typeof duration === 'number' && duration > 0)) continue;
            assert.equal(typeof hit, 'number', `${row.id} ${row.name} 缺 unitAttackHitTime`);
            if (HIT_RATIO_EXCEPTIONS.has(row.id)) continue;
            assert.ok(Math.abs(Number(hit) - duration * HIT_RATIO) <= 0.002,
                `${row.id} ${row.name}：命中时点 ${hit} ≠ 时长 ${duration} × 40%`
                + `（应为 ${(duration * HIT_RATIO).toFixed(3)}）—— 改时长时忘了同步命中帧？`);
        }
    });

    test(`${table.label}：不许整表落成同一个占位值`, () => {
        const durations = readRemoteRef(table.file)
            .map((row) => row.unitAttackDuration)
            .filter((value): value is number => typeof value === 'number' && value > 0);
        assert.ok(durations.length >= 10, `${table.label} 只读到 ${durations.length} 行有动画时长，表结构变了？`);
        assert.ok(new Set(durations).size >= 5,
            `${table.label}：${durations.length} 行只有 ${new Set(durations).size} 个不同时长`
            + `（全是 ${[...new Set(durations)].join(' / ')}）—— 这是「整表占位值」的样子，`
            + '说明没人按骨架实测配过');
    });

    test(`${table.label}：两份产物（remoteRef / client）逐行一致`, () => {
        const remote = new Map(readRemoteRef(table.file).map((row) => [row.id, row]));
        for (const row of readClient(table.file)) {
            const peer = remote.get(row.id);
            assert.ok(peer, `${row.id} 只在 client 里有`);
            //  建筑行（主城 / 金矿）在两份产物里的「空」写法不同：列存那边是 null，
            //  client 那边干脆没有这个键 —— 所以按「都算空」比较，别拿 undefined 和 null 互相比。
            assert.equal(peer.unitAttackDuration ?? null, row.unitAttackDuration ?? null,
                `${row.id} ${row.name} 的 unitAttackDuration 两份不一致`);
            assert.equal(peer.unitAttackHitTime ?? null, row.unitAttackHitTime ?? null,
                `${row.id} ${row.name} 的 unitAttackHitTime 两份不一致`);
        }
    });
}
