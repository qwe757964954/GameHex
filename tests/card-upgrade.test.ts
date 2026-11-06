/**
 * 卡牌升级（`cardLevelUp`）的单测。
 *
 * 覆盖几个**容易静默错**的点：
 *   ① 升级读的是 **`level + 1` 那一行**，不是当前等级那一行 —— 读错就把下一档的
 *      消耗当成本档的，玩家会觉得「明明材料够却升不了」。
 *   ② 经验是 **通用 + 兵种合计** 判定（表里只有一列 `costArmyLevelNum`，没有单独的
 *      通用经验数量）。按「两列各自 ≥ 需求」去判会永远判不过。
 *   ③ 卡牌数量是**独立**条件，经验再多也补不了卡牌。
 *   ④ **解锁（0 → 1）只是按钮换个说法**，判定与升级完全一致（含 `costArmyLevelNum` 经验门槛）。
 *
 * 只用无引擎依赖的模块（`CardUpgradeCost` 刻意不 import `cc`）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    buildCardLevelUpTable,
    evaluateUpgrade,
    parseCardLevelUpRow,
    resolveMaxLevel,
    upgradeButtonText,
    ZCCardLevelUpTable,
    ZCItemCounter,
} from '../assets/script/app/card/CardUpgradeCost';
import { CARD_LINEUP_TEXTS } from '../assets/script/app/card/CardLineupTexts';

/** 读 remoteRef 的列存表（`{k, v}`）→ 行对象数组。 */
function readCardLevelUp(): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync('assets/remoteRef/cardLevelUp.json', 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    return source.v.map((row) => {
        const entry: Record<string, unknown> = {};
        source.k.forEach((key, index) => { entry[key] = row[index]; });
        return entry;
    });
}

/** 用固定背包造一个取值函数。 */
function bagOf(counts: Record<string, number>): ZCItemCounter {
    return (itemId: string) => counts[String(itemId)] ?? 0;
}

const TABLE: ZCCardLevelUpTable = buildCardLevelUpTable(readCardLevelUp());

// 精灵弓箭手（68001）：卡牌 18003 / 兵种经验 16003 / 通用经验 16000。
// ⚠️ `66001` 是**重编号前的旧 id**，现表里已经查不到 —— 只用于断言「不该进表」。
/** 现表（`assets/remoteRef/cardLevelUp.json`）里精灵弓箭手的真实 id。 */
const LIVE_ARCHER = '68001';
const ARCHER = LIVE_ARCHER;
const LEGACY_ARCHER = '66001';
const ARCHER_CARD_ITEM = '18003';
const ARCHER_ARMY_EXP = '16003';
const GENERAL_EXP = '16000';

test('cardLevelUp：真实表能解析出 35 张卡（68001~68035），每张 51 档', () => {
    assert.equal(TABLE.size, 35);
    assert.equal(TABLE.has(ARCHER), true, '精灵弓箭手（68001）应当在表里');
    assert.equal(TABLE.has('68013'), true);
    assert.equal(TABLE.has(LEGACY_ARCHER), false, '66001 是重编号前的旧 id，现表已查不到');
});

test('cardLevelUp：等级档位连续，上限与源表一致', () => {
    // 68001：0..50 共 51 档
    assert.equal(TABLE.get(ARCHER)?.size, 51);
    assert.equal(resolveMaxLevel(TABLE, ARCHER), 50);
    // 68013（雷克萨）：现表同样铺满 0..50
    assert.equal(resolveMaxLevel(TABLE, '68013'), 50);
    // 没配置的卡
    assert.equal(resolveMaxLevel(TABLE, '99999'), 0);

    for (const [id, levels] of TABLE) {
        const max = resolveMaxLevel(TABLE, id);
        for (let level = 0; level <= max; level += 1) {
            assert.ok(levels.has(level), `${id} 缺 ${level} 档`);
        }
    }
});

test('parseCardLevelUpRow：坏行返回 null，不抛异常', () => {
    assert.equal(parseCardLevelUpRow(null), null);
    assert.equal(parseCardLevelUpRow([]), null);
    assert.equal(parseCardLevelUpRow('x'), null);
    // level 为 null（希尔瓦娜斯那批行的形态）
    assert.equal(parseCardLevelUpRow({
        id: 68001, level: null, costCardID: 18037, costCardNum: 10,
        costArmyLevelID: 16006, costGeneralLevelID: 16000, costArmyLevelNum: 0,
    }), null);
    // 卡牌 id 缺失
    assert.equal(parseCardLevelUpRow({
        id: 66001, level: 1, costCardID: null, costCardNum: 10,
        costArmyLevelID: 16003, costGeneralLevelID: 16000, costArmyLevelNum: 20,
    }), null);
    // 正常行：id / 数量都归一化成字符串 / 整数
    const ok = parseCardLevelUpRow({
        id: 66001, name: '精灵弓箭手', level: '1', costCardID: 18003, costCardNum: '10',
        costArmyLevelID: 16003, costGeneralLevelID: 16000, costArmyLevelNum: '20',
    });
    assert.deepEqual(ok, {
        id: '66001', name: '精灵弓箭手', level: 1, costCardID: '18003', costCardNum: 10,
        costArmyLevelID: '16003', costGeneralLevelID: '16000', costArmyLevelNum: 20,
    });
    // 表里没配名称的老行：name 归一化成空串（不是 undefined，界面可直接判断）
    const noName = parseCardLevelUpRow({
        id: 66001, level: 1, costCardID: 18003, costCardNum: 10,
        costArmyLevelID: 16003, costGeneralLevelID: 16000, costArmyLevelNum: 20,
    });
    assert.equal(noName?.name, '');
});

test('升级读的是「目标等级」那一行（level 列 = 到达该等级）', () => {
    // 这张表的口径判据来自工程里已存在的消费者：`loadPvpHeroLevelCaps()` 把表里
    // `max(level)` 当作**等级上限**当进度条分母，所以 `level` 必须是「可到达的等级」。
    // 于是「从 L 升到 L+1」要读的是 `level = L + 1` 那一行。
    //
    // 精灵弓箭手（68001）的档位：
    //   level 1 → 卡牌 27 / 经验 53       level 2 → 卡牌 53 / 经验 160
    //   level 3 → 卡牌 80 / 经验 319      level 0 → 卡牌 10 / 经验 0（初始态，不可达）

    // 0 → 1：读 level=1 行
    const atZero = evaluateUpgrade(TABLE, ARCHER, 0, bagOf({ [ARCHER_CARD_ITEM]: 27, [GENERAL_EXP]: 53 }));
    assert.equal(atZero.targetLevel, 1);
    assert.equal(atZero.requirements[0].need, 27);
    assert.equal(atZero.requirements[1].need, 53);
    assert.equal(atZero.canUpgrade, true);

    // 弹药刚好差一点 → 不能升（证明读的不是 level=0 那行「0 经验」）
    const zeroShort = evaluateUpgrade(TABLE, ARCHER, 0, bagOf({ [ARCHER_CARD_ITEM]: 27, [GENERAL_EXP]: 52 }));
    assert.equal(zeroShort.requirements[1].need, 53);
    assert.equal(zeroShort.canUpgrade, false, '0→1 也要 53 经验，不是 0');

    // 1 → 2：读 level=2 行（卡牌 53 / 经验 160）
    const atOne = evaluateUpgrade(TABLE, ARCHER, 1, bagOf({ [ARCHER_CARD_ITEM]: 53 }));
    assert.equal(atOne.targetLevel, 2);
    assert.equal(atOne.requirements[0].need, 53);
    assert.equal(atOne.requirements[1].need, 160);
    assert.equal(atOne.canUpgrade, false, '只有卡、没经验，不该能升');

    // 2 → 3：读 level=3 行（卡牌 80 / 经验 319）
    const atTwo = evaluateUpgrade(TABLE, ARCHER, 2, bagOf({ [ARCHER_CARD_ITEM]: 80 }));
    assert.equal(atTwo.requirements[0].need, 80);
    assert.equal(atTwo.requirements[1].need, 319);
});

test('经验按「通用 + 兵种」合计判定', () => {
    // 0 → 1 那一档需要 53 经验
    const need = evaluateUpgrade(TABLE, ARCHER, 0, bagOf({})).requirements[1].need;
    assert.equal(need, 53);

    // 一边够、另一边不够，但合计刚好够 → 可以升
    const split = evaluateUpgrade(TABLE, ARCHER, 0, bagOf({
        [ARCHER_CARD_ITEM]: 27, [GENERAL_EXP]: 5, [ARCHER_ARMY_EXP]: 48,
    }));
    assert.equal(split.generalExpOwned, 5);
    assert.equal(split.armyExpOwned, 48);
    assert.equal(split.requirements[1].owned, 53, '经验行的 owned 是两者之和');
    assert.equal(split.canUpgrade, true, '5 通用 + 48 兵种 满足 53 经验');

    // 合计差 1 → 不能升
    const short = evaluateUpgrade(TABLE, ARCHER, 0, bagOf({
        [ARCHER_CARD_ITEM]: 27, [GENERAL_EXP]: 5, [ARCHER_ARMY_EXP]: 47,
    }));
    assert.equal(short.requirements[1].owned, 52);
    assert.equal(short.canUpgrade, false);
    assert.match(short.blockedReason, /经验不足/);

    // 只有通用经验、没有兵种经验 → 也算（合计口径）
    const generalOnly = evaluateUpgrade(TABLE, ARCHER, 0, bagOf({
        [ARCHER_CARD_ITEM]: 27, [GENERAL_EXP]: 53,
    }));
    assert.equal(generalOnly.canUpgrade, true);
});

test('卡牌数量是独立条件，经验再多也补不了', () => {
    const status = evaluateUpgrade(TABLE, ARCHER, 0, bagOf({
        [ARCHER_CARD_ITEM]: 26, [GENERAL_EXP]: 999999, [ARCHER_ARMY_EXP]: 999999,
    }));
    assert.equal(status.requirements[0].need, 27);
    assert.equal(status.requirements[0].owned, 26);
    assert.equal(status.requirements[0].enough, false);
    assert.equal(status.requirements[1].enough, true);
    assert.equal(status.canUpgrade, false);
    assert.match(status.blockedReason, /卡牌不足/);
});

test('已满级 / 超出上限 / 无配置 三种不可升形态', () => {
    const maxed = evaluateUpgrade(TABLE, ARCHER, 50, bagOf({ [ARCHER_CARD_ITEM]: 9999 }));
    assert.equal(maxed.configured, true);
    assert.equal(maxed.maxed, true);
    assert.equal(maxed.canUpgrade, false);
    assert.equal(maxed.blockedReason, '已满级');
    assert.equal(maxed.requirements.length, 0, '满级时没有材料行');
    assert.equal(maxed.targetLevel, maxed.level);

    // 后端给的等级超过了表里的上限（表改小过）—— 同样按「不能再升」处理
    const beyond = evaluateUpgrade(TABLE, ARCHER, 55, bagOf({}));
    assert.equal(beyond.maxed, true);
    assert.equal(beyond.maxLevel, 50);

    // 表里查无此卡（例如重编号前的旧 id 66001）
    const missing = evaluateUpgrade(TABLE, LEGACY_ARCHER, 3, bagOf({}));
    assert.equal(missing.configured, false);
    assert.equal(missing.maxed, false);
    assert.equal(missing.canUpgrade, false);
    assert.equal(missing.blockedReason, '该卡没有升级配置');
    assert.equal(missing.requirements.length, 0);
});

test('requirements 的形状固定为 [card, exp]，exp 行给的是通用经验 id', () => {
    // 每一档（含解锁 0 → 1）都是两行，形状固定。
    const status = evaluateUpgrade(TABLE, LIVE_ARCHER, 0, bagOf({}));
    assert.deepEqual(status.requirements.map((row) => row.key), ['card', 'exp']);
    assert.equal(status.requirements[1].itemId, GENERAL_EXP, '经验行主物品取通用经验 id');
    assert.equal(status.generalExpItemId, GENERAL_EXP);
    assert.equal(status.armyExpItemId, ARCHER_ARMY_EXP);
});

test('背包取值函数返回负数 / NaN / 小数时的兜底', () => {
    const status = evaluateUpgrade(TABLE, ARCHER, 1, (itemId: string) => {
        if (itemId === ARCHER_CARD_ITEM) return 12.9; // 小数 → 向下取整
        if (itemId === GENERAL_EXP) return -5;        // 负数 → 0
        return Number.NaN;                            // NaN → 0
    });
    assert.equal(status.requirements[0].owned, 12);
    assert.equal(status.generalExpOwned, 0);
    assert.equal(status.armyExpOwned, 0);
    assert.equal(status.requirements[1].owned, 0);
    assert.equal(status.canUpgrade, false);
});

test('等级是小数 / 负数时归一化到非负整数', () => {
    assert.equal(evaluateUpgrade(TABLE, ARCHER, -3, bagOf({})).level, 0);
    assert.equal(evaluateUpgrade(TABLE, ARCHER, 2.7, bagOf({})).level, 2);
});

// ---------------------------------------------------------------------------
// 按钮文案：0 级（「升到 1 级」）叫「解锁」
// ---------------------------------------------------------------------------

test('0 级这一档按钮叫「解锁」，1 级往上仍是「升级」', () => {
    // 0 → 1 在语义上是**解锁**这张卡，不是升级 —— 所以按钮换个说法。
    // ⚠️ 只是说法：判定 / 展示 / 发的 `CmdPvpHeroUpLevelReqMsg` 全都没变
    // （见 `upgradeButtonText` 的注释，以及下面那条「判定不受影响」的断言）。
    assert.equal(upgradeButtonText(0, false), '解锁');
    assert.equal(upgradeButtonText(0, true), '解锁中…');

    for (const level of [1, 2, 29, 30]) {
        assert.equal(upgradeButtonText(level, false), '升级', `${level} 级不该写「解锁」`);
        assert.equal(upgradeButtonText(level, true), '升级中…');
    }

    // 非法值按 0 处理（与 `evaluateUpgrade` 的归一化口径一致 —— 负数/NaN 都不是「在升级」）
    assert.equal(upgradeButtonText(-3, false), '解锁');
    assert.equal(upgradeButtonText(Number.NaN, false), '解锁');
    assert.equal(upgradeButtonText(2.7, false), '升级', '小数向下取整，2.7 → 2');
});

test('换文案不改判定：解锁（0 → 1）照样要经验', () => {
    // 「解锁」**只是按钮文案**，判定两条件一个都不能少 ——
    // `costArmyLevelNum` 该判就判（表里 level=1 那行配多少经验就得有多少）。
    // 这条是防回归：看到「解锁」两个字就顺手把经验判断去掉，是把扣材料当成文案改。
    //
    // 用**现表里的真实卡**（68001 精灵弓箭手）：文件里另一批 `66001` 是重编号前的旧 id，
    // 现表查不到，需求值从表里**动态取**，不要写死数字。
    const probe = evaluateUpgrade(TABLE, LIVE_ARCHER, 0, bagOf({}));
    assert.equal(probe.configured, true, '现表里应当有 68001 的升级配置');
    assert.equal(probe.targetLevel, 1);
    assert.deepEqual(probe.requirements.map((row) => row.key), ['card', 'exp'], '解锁也有经验行');
    assert.equal(upgradeButtonText(probe.level, false), '解锁');

    const [cardRow, expRow] = probe.requirements;
    assert.equal(expRow.itemId, GENERAL_EXP, '经验行主物品取通用经验 id');
    assert.ok(expRow.need > 0, '解锁这一档在表里配了经验，就该判');

    // 只有卡牌、没有经验 → 不能解锁
    const noExp = evaluateUpgrade(TABLE, LIVE_ARCHER, 0, bagOf({ [cardRow.itemId]: cardRow.need }));
    assert.equal(noExp.canUpgrade, false, '解锁不能免经验');
    assert.match(noExp.blockedReason, /经验不足/);

    // 卡牌够、经验也够（通用 + 兵种合计）→ 可点，且按钮仍是「解锁」
    const enough = evaluateUpgrade(TABLE, LIVE_ARCHER, 0, bagOf({
        [cardRow.itemId]: cardRow.need,
        [expRow.itemId]: expRow.need,
    }));
    assert.equal(enough.canUpgrade, true);
    assert.equal(upgradeButtonText(enough.level, false), '解锁');

    // 卡牌差一张 → 不可点，两个不足都报出来，但按钮文案仍然是「解锁」
    const short = evaluateUpgrade(TABLE, LIVE_ARCHER, 0, bagOf({}));
    assert.equal(short.canUpgrade, false);
    assert.match(short.blockedReason, /卡牌不足/);
    assert.equal(upgradeButtonText(short.level, false), '解锁');

    // 1 级以后是「升级」，判定口径与解锁档完全一致
    const afterUnlock = evaluateUpgrade(TABLE, LIVE_ARCHER, 1, bagOf({}));
    assert.deepEqual(afterUnlock.requirements.map((row) => row.key), ['card', 'exp']);
    assert.equal(upgradeButtonText(afterUnlock.level, false), '升级');
});

test('按钮文案只有一个来源：页面不得自己拼「升级」', () => {
    const page = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    const assignments = page.match(/this\.upgradeLabel\.string = [^;]+;/g) ?? [];
    assert.ok(assignments.length >= 3, `按钮文案赋值点只有 ${assignments.length} 处，检查是否漏改`);
    for (const line of assignments) {
        assert.ok(
            /upgradeButtonText\(/.test(line) || /upgradeMaxed/.test(line),
            `按钮文案必须走 upgradeButtonText（「已满级」除外）：${line}`,
        );
    }
    assert.ok(
        !/CARD_LINEUP_TEXTS\.upgradeConfirm/.test(page),
        '页面里不该再直写 upgradeConfirm，否则 0 级卡会漏掉「解锁」',
    );

    // 文案本体在 `CardLineupTexts`，不散落到 prefab 的 Label 上（项目约定）
    assert.equal(CARD_LINEUP_TEXTS.upgradeUnlock, '解锁');
    assert.equal(CARD_LINEUP_TEXTS.upgradeUnlocking, '解锁中…');
    assert.equal(CARD_LINEUP_TEXTS.upgradeConfirm, '升级');
});

test('升级 loading 由组合根提供，控制器成对释放并在退出时回收', () => {
    const composition = readFileSync('assets/script/app/bootstrap/card/CardPopupComposition.ts', 'utf8');
    const controller = readFileSync('assets/script/app/card/CardUpgradeController.ts', 'utf8');
    const page = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    assert.doesNotMatch(page, /LoadingPopup|submitUpgrade/);
    assert.match(composition, /LoadingPopup.show\(/);
    assert.match(composition, /return \(\) => LoadingPopup.hide\(\)/);
    assert.match(composition, /upgradeUnlocking/);
    assert.match(composition, /upgradeSending/);
    assert.match(controller, /this.own\(\(\) => this.stopLoading\(\)\)/);
    assert.match(controller, /finally \{ this.stopLoading\(\); \}/);
});

test('卡牌名称：表里每行都带名，且与卡牌表 pvpCard 完全一致', () => {
    // 回归 K-卡牌升级 的历史坑：
    //   ① B 列（卡牌名称）导出标志被写成 0 + 字段名空 ⇒ eSon 不导出，`cardLevelUp.json` 没有 name；
    //   ② 表里 35 张卡有 23 张名称还是旧项目英雄名（女猎手 / 冰霜巨龙 / 希尔瓦娜斯…）。
    // 两者都只会在界面上表现为「材料位没有名字」，零报错 —— 所以用真实表钉住。
    const rows = readCardLevelUp();
    const withName = rows.filter((row) => String(row.name ?? '').trim().length > 0);
    assert.equal(withName.length, rows.length, `有 ${rows.length - withName.length} 行没有 name`);

    const pvp = JSON.parse(readFileSync('assets/remoteRef/pvpCard.json', 'utf8')) as {
        k: string[]; v: unknown[][];
    };
    const cardName = new Map<string, string>();
    for (const row of pvp.v) {
        const entry = {} as Record<string, unknown>;
        pvp.k.forEach((key, index) => { entry[key] = row[index]; });
        cardName.set(String(entry.id), String(entry.name));
    }
    const mismatched = rows.filter((row) => cardName.get(String(row.id)) !== row.name);
    assert.deepEqual(mismatched.slice(0, 3), [], '名称必须与 pvpCard 对齐（样例）');
    assert.equal(mismatched.length, 0);

    // 判定结果把名字带出去，页面直接显示（不再回退通用文案「卡牌」）
    const status = evaluateUpgrade(TABLE, LIVE_ARCHER, 0, bagOf({}));
    assert.equal(status.requirements[0].name, '豌豆游侠');
    assert.equal(status.requirements[1].name, '', '经验行没有卡名');
});

test('材料位显示卡牌表名称，不再写死通用文案', () => {
    const page = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    assert.match(
        page,
        /this\.matCardItemLabel\.string = cardRow\.name \|\| texts\.upgradeCardRow;/,
        '材料卡名必须读 cardRow.name，只在表里没配时才回退通用文案',
    );
    assert.doesNotMatch(
        page,
        /this\.matCardItemLabel\.string = texts\.upgradeCardRow;/,
        '这里退回写死文案就是本 bug 的原形态',
    );
});
