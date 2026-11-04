import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { zcBeamSpecOf, zcBeamWidthScaleOf } from '../assets/script/app/zcds/view/ZCBeamEffect';
import { assetPath } from './helpers/asset-paths';

/**
 * **法师职业普攻子弹特效统一缩到 70%**（2026-10-30 需求）。
 *
 * 用户原话：「战斗中，所有的法师职业的普通攻击子弹特效改小比例成70%」。
 * 追问后定的两条边界（用户亲选）：
 *  1. 共用的 prefab **照缩、接受连带** —— 冰锥（泰兰德也用）、雷电（萨尔也用）跟着变小；
 *  2. 阿尔萨斯虽在 `traits.attack === '法师'` 里，但普攻 `mode === 'melee'`（践踏环，不是子弹），
 *     **跳过不动**。
 *
 * ## 口径：尺寸只认 prefab 里**带 `cc.Sprite` 那个节点**的 `_lscale`
 *
 * 这个节点可能在根（`子弹_新怪物`、`镭射飞龙_普攻`），也可能在 `offset` 中间层（其余 6 个）。
 * 「找根节点」/「找 `offset`」都只是单个案例，不是规律 —— 所以下面的
 * {@link spriteNodeScale} 按「哪个节点挂了 `cc.Sprite`」去找，找不到或多于一个都直接失败。
 *
 * `ZCCombatEffectView.render` 里那句 `spriteNode.setScale(Vec3.ONE)` 归的是它**自带的兜底
 * Sprite**，碰不到 prefab 实例，所以这次改动**一行代码都不用动**。
 *
 * ⚠️ 光束类（镭射飞龙）是唯一例外：`render` 每帧把 `scaleX` 覆盖成
 * `length / beamCanvasWidth`，**x 写了也白写**；粗细只认根节点 `y`（`beamBaseScaleY`）。
 */

const ROOT = join(__dirname, '..');
const SHRINK = 0.7;

interface IMageAttack {
    readonly unitId: number;
    readonly name: string;
    readonly skillId: number;
    /** 相对分包根的 prefab 路径（不带 `.prefab`）。 */
    readonly prefab: string;
    /** 改前 `_lscale`（用户说的「70%」就是相对它）。 */
    readonly before: { x: number; y: number };
    /** 改后 `_lscale`。 */
    readonly after: { x: number; y: number };
    /** 光束：`scaleX` 每帧被长度覆盖，只缩 `y`。 */
    readonly beam?: boolean;
    /** 2026-11-03 SVN 换皮：美术直接烘焙终值，70% 两段式比例断言不适用。 */
    readonly rebaked?: boolean;
}

/**
 * 9 个法师里**纳入本次改动**的 8 个（阿尔萨斯见 {@link MELEE_MAGE}）。
 * 顺序 = `pvpCard.id` 顺序，方便和配置表对照。
 */
const MAGES: readonly IMageAttack[] = [
    {
        unitId: 68003, name: '火焰树妖', skillId: 30711,
        prefab: 'units/projectiles/火焰树妖_普攻/火焰树妖_普攻',
        before: { x: 0.5, y: 0.5 }, after: { x: 0.35, y: 0.35 },
    },
    {
        unitId: 68010, name: '镭射飞龙', skillId: 30719,
        prefab: 'units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻',
        // 光束：canvas 宽由 `length` 撑，`x` 恒 1 才有意义（写了会被覆盖，反而误导）。
        before: { x: 1, y: 1 }, after: { x: 1, y: 0.7 }, beam: true,
    },
    {
        unitId: 68011, name: '水手菇', skillId: 30261,
        prefab: 'units/projectiles/冰法师_冰锥/冰法师_冰锥',
        // `x` 是**负数**（镜像朝向）；缩放只改大小，必须保留符号。
        // 2026-11-03 SVN：这张卡换皮改名（旧名「冰冻菇」），特效与缩放口径未变。
        before: { x: -0.4, y: 0.4 }, after: { x: -0.28, y: 0.28 },
    },
    {
        unitId: 68022, name: '雷蕉', skillId: 30231,
        // 2026-11-03 SVN：美术整体换皮，`雷法师_雷电` ⇒ `磁电菇_子弹攻击`，
        // 且新 prefab 的 scale 由美术直接烘焙成 0.4 终值（旧 70% 两段式不再适用）。
        prefab: 'units/projectiles/磁电菇_子弹攻击/磁电菇_子弹攻击',
        before: { x: 0.4, y: 0.4 }, after: { x: 0.4, y: 0.4 }, rebaked: true,
    },
    {
        unitId: 68024, name: '急冻瓜', skillId: 30671,
        prefab: 'units/projectiles/子弹_新怪物/子弹_新怪物',
        // 这个 prefab 没有 `offset` 中间层，Sprite 直接挂在根上 —— 尺寸也就在根上。
        before: { x: 1, y: 1 }, after: { x: 0.7, y: 0.7 },
    },
    {
        unitId: 68026, name: '麻辣铁锅', skillId: 30181,
        prefab: 'units/projectiles/火法师_新子弹/火法师_新子弹',
        before: { x: 0.666667, y: 0.666667 }, after: { x: 0.466667, y: 0.466667 },
    },
    {
        unitId: 68030, name: '篮球天才', skillId: 30702,
        prefab: 'units/projectiles/篮球少年_普攻/篮球少年_普攻',
        before: { x: 0.5, y: 0.5 }, after: { x: 0.35, y: 0.35 },
    },
    {
        unitId: 68034, name: '魔术师', skillId: 30710,
        prefab: 'units/projectiles/魔法师_普攻/魔法师_普攻',
        before: { x: 0.5, y: 0.5 }, after: { x: 0.35, y: 0.35 },
    },
];

/**
 * 第 9 个法师，**故意不动**：普攻是近战践踏环，且和爆锤莲王（战士，68027）共用
 * `重骑兵_践踏`。缩它等于顺手改了战士的普攻，用户明确否掉了。
 */
const MELEE_MAGE = { unitId: 68015, name: '阿尔萨斯', skillId: 30241, prefab: 'units/projectiles/重骑兵_践踏/重骑兵_践踏' };

/**
 * 被连带的**非法师**单位（用户已知情接受）：
 * 水手菇（旧名「冰冻菇」）的 30261 就是弩兵普攻（冰锥），雷蕉的 30231 就是雷法师普攻，
 * 这两个技能同时被射手毒箭蘑菇（旧名「泰兰德」）、战士萨尔引用。哪天要拆成专属 prefab，这条会先红。
 */
const COLLATERAL = [
    { unitId: 68017, name: '毒箭蘑菇', role: '射手', skillId: 30261, sharedBy: '水手菇' },
    { unitId: 68016, name: '萨尔', role: '战士', skillId: 30231, sharedBy: '雷蕉' },
];

const prefabFile = (prefab: string): string => `${prefab}.prefab`;

function readText(relative: string): string {
    return readFileSync(join(ROOT, assetPath(relative)), 'utf8');
}

const readJson = (relative: string): any => JSON.parse(readText(relative));

function readRows(name: string): Array<Record<string, any>> {
    const source = JSON.parse(readFileSync(join(ROOT, `assets/remoteRef/${name}.json`), 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source as Array<Record<string, any>>;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

/**
 * prefab 里**带 `cc.Sprite` 的那个节点**的名字与 `_lscale`（= 尺寸真源）。
 *
 * 数量必须恰好 1：0 个说明找错了节点，2 个以上说明得先定「哪个 Sprite 才代表可见尺寸」。
 */
function spriteNodeScale(prefab: string): { name: string; x: number; y: number } {
    const entries = readJson(prefabFile(prefab)) as Array<Record<string, any>>;
    const hits = entries.filter((entry) => {
        if (entry.__type__ !== 'cc.Node') return false;
        const types = (entry._components ?? []).map((ref: any) => entries[ref.__id__].__type__);
        return types.includes('cc.Sprite');
    });
    assert.equal(hits.length, 1, `${prefab} 里带 cc.Sprite 的节点应恰好 1 个，实际 ${hits.length} 个`);
    const node = hits[0];
    return { name: node._name, x: node._lscale.x, y: node._lscale.y };
}

const near = (actual: number, expected: number, eps = 1e-6): boolean => Math.abs(actual - expected) < eps;

test('① 名单：pvpCard 里恰好 9 个法师，其中 8 个走投射物、1 个（阿尔萨斯）走近战', () => {
    const cards = readRows('pvpCard');
    const mages = cards.filter((card) => card.traits && card.traits.attack === '法师');
    assert.deepEqual(
        mages.map((card) => card.id).sort((a: number, b: number) => a - b),
        [...MAGES.map((mage) => mage.unitId), MELEE_MAGE.unitId].sort((a, b) => a - b),
        '法师名单变了 ⇒ 新法师要不要一起缩，得先回答这个问题',
    );
    // 名单里的 prefab 不是手抄的：逐条回配置表核对，防止「改了名字相近的另一个特效」。
    const skills = readRows('pvpSkill');
    for (const mage of MAGES) {
        const card = cards.find((item) => item.id === mage.unitId)!;
        assert.equal(card.name, mage.name);
        assert.equal(card.unitSkillId, mage.skillId, `${mage.name} 的普攻技能 id 变了`);
        const row = skills.find((item) => item.skillId === mage.skillId)!;
        assert.equal(row.effectPrefabPath, mage.prefab, `${mage.name} 的普攻特效路径变了`);
        assert.equal(row.mode, 'projectile', `${mage.name} 不再是投射物，这条用例的前提就没了`);
    }

    const melee = skills.find((item) => item.skillId === MELEE_MAGE.skillId)!;
    assert.equal(melee.mode, 'melee', '阿尔萨斯要是改成投射物了，就得把他并进 MAGES');
});

test('② 缩放：8 个 prefab 的尺寸节点 = 改前 × 70%（绝对值 + 比例双断言）', () => {
    for (const mage of MAGES) {
        const scale = spriteNodeScale(mage.prefab);
        assert.ok(near(scale.x, mage.after.x) && near(scale.y, mage.after.y),
            `${mage.name}（${mage.prefab}）${scale.name} 是 ${scale.x}/${scale.y}，应为 ${mage.after.x}/${mage.after.y}`);
        // 关系也要守住：以后谁把基线改了却忘了 70%，绝对值那条可能刚好还绿。
        const ratioX = mage.beam || mage.rebaked ? 1 : scale.x / mage.before.x;
        const ratioY = mage.rebaked ? 1 : scale.y / mage.before.y;
        assert.ok(near(ratioX, mage.beam || mage.rebaked ? 1 : SHRINK, 1e-4),
            `${mage.name} x 缩放比例 ${ratioX.toFixed(4)} 应为 ${mage.beam || mage.rebaked ? 1 : SHRINK}`);
        assert.ok(near(ratioY, mage.rebaked ? 1 : SHRINK, 1e-4),
            `${mage.name} y 缩放比例 ${ratioY.toFixed(4)} 应为 ${mage.rebaked ? 1 : SHRINK}`);
    }
});

test('③ 冰锥的负号必须留着（x<0 是镜像朝向，不是「大小」）', () => {
    const cone = MAGES.find((mage) => mage.name === '水手菇')!;
    const scale = spriteNodeScale(cone.prefab);
    assert.ok(scale.x < 0, `冰锥 x 应仍为负（镜像），实际 ${scale.x}`);
    assert.ok(near(scale.y, -scale.x), `镜像要等比：|x| ${-scale.x} 应等于 y ${scale.y}`);
});

test('④ 光束（镭射飞龙）：只缩粗细，x 恒 1 —— 长度由每帧的 scaleX 撑，缩 x 无意义', () => {
    const dragon = MAGES.find((mage) => mage.beam)!;
    const scale = spriteNodeScale(dragon.prefab);
    assert.equal(scale.x, 1, 'scaleX 每帧被 length / beamCanvasWidth 覆盖，写别的值只会误导');
    assert.ok(near(scale.y, 0.7), `光柱粗细（根节点 y）应为 0.7，实际 ${scale.y}`);

    // 前提守卫：这个路径确实登记成光束了，否则「x 无意义」不成立（会走「移动小图」弹道）。
    const spec = zcBeamSpecOf(dragon.prefab);
    assert.ok(spec, 'ZCBeamEffect 没登记这个路径 ⇒ 它其实是普通子弹，x 就有意义了');

    // 真正的算式（2026-11-03 新口径）：粗细 = 画布高 × widthScale。
    // 0.7 已 **bake 进** widthScale（1.8 × 0.7 = 1.26），`applyBeamStretch` 把它作为
    // **绝对值**写到 visualNode.scaleY —— prefab 根节点的 0.7 被覆盖而不是相乘，
    // 否则池化复用下从旧 scale.y 读值会累乘污染（0.7→1.26→2.27…）。
    // 普攻 30719：53 × 1.26 = 66.78px（与旧口径 53 × 1.8 × 0.7 数值一致）。
    // 带强化的「镭射死光」30845 挂同一份美术（倍率 1.3 ⇒ 86.81px）。
    // 画布高从 prefab 的 UITransform 现取，不从注释里抄。
    const canvasHeight = (readJson(prefabFile(dragon.prefab)) as Array<Record<string, any>>)
        .find((entry) => entry.__type__ === 'cc.UITransform')!._contentSize.height;
    assert.equal(canvasHeight, 53, '光束画布高变了 ⇒ 下面两个像素值要重算');
    const thickness = (skillId: number): number => canvasHeight * zcBeamWidthScaleOf(spec!, skillId);
    assert.ok(Math.abs(thickness(30719) - 66.78) < 0.1, `普攻光柱高 ${thickness(30719).toFixed(2)}px 应约 66.78`);
    assert.ok(Math.abs(thickness(30845) - 86.81) < 0.1, `镭射死光高 ${thickness(30845).toFixed(2)}px 应约 86.81`);
    assert.ok(near(zcBeamWidthScaleOf(spec!, 30719) / 1.8, SHRINK, 1e-6),
        '美术目标粗细 1.8 中的 0.7 已 bake 进 widthScale（1.26），只 bake 一次');

    // 别处不许再乘一遍根节点缩放 —— 乘两遍就成了 49%。
    // （`beamBaseScaleY` 只允许出现在注释里 —— 字段本身已被移除。）
    const viewSource = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCCombatEffectView.ts'), 'utf8');
    assert.ok(!/beamBaseScaleY\s*[=.]/.test(viewSource),
        'beamBaseScaleY 的赋值/读取必须移除（读旧 scale.y 会累乘污染，0.7 bake 进 widthScale）');
    assert.match(viewSource, /setScale\(\s*stretch\.scaleX,\s*zcBeamWidthScaleOf\(this\.beamSpec, skillId\)/,
        'applyBeamStretch 必须把宽度作为绝对值写入 scaleY（覆盖 prefab 的 0.7）');
});

test('⑤ 连带影响是**已知取舍**：冰锥/雷电同时被泰兰德、萨尔用着，他们也一起变小了', () => {
    const cards = readRows('pvpCard');
    const skills = readRows('pvpSkill');
    for (const victim of COLLATERAL) {
        const card = cards.find((item) => item.id === victim.unitId)!;
        assert.ok(card, `pvpCard 缺少 ${victim.name}`);
        assert.equal(card.name, victim.name);
        assert.equal(card.traits.attack, victim.role, `${victim.name} 的职业变了 ⇒ 连带影响要重新评估`);
        assert.equal(card.unitSkillId, victim.skillId,
            `${victim.name} 换了普攻技能 ⇒ 可能已经不再和${victim.sharedBy}共用特效，这条该删`);
        const row = skills.find((item) => item.skillId === victim.skillId)!;
        const owner = MAGES.find((mage) => mage.skillId === victim.skillId)!;
        assert.equal(row.effectPrefabPath, owner.prefab,
            `${victim.name} 和${victim.sharedBy}必须共用同一份 prefab，否则「连带」这个说法不成立`);
    }
});

test('⑥ 阿尔萨斯（近战践踏）= 跳过：重骑兵_践踏 仍是 1/1', () => {
    const scale = spriteNodeScale(MELEE_MAGE.prefab);
    assert.deepEqual([scale.x, scale.y], [1, 1],
        '近战践踏环不缩（用户口径「子弹特效」）—— 顺带也保住了爆锤莲王的普攻');
});

test('⑦ 结构：每个 prefab 的尺寸节点唯一、落盘是干净 LF', () => {
    for (const mage of [...MAGES, MELEE_MAGE]) {
        // 顺带断言「没被写成 CRLF」—— 文本模式重写会把整个 prefab 变成 \r\n，
        // 数值全对但文件全脏，这是本项目踩过的坑。
        assert.ok(!readText(prefabFile(mage.prefab)).includes('\r'), `${mage.prefab} 混进了 CRLF`);
        const scale = spriteNodeScale(mage.prefab);
        assert.ok(scale.name === 'offset' || scale.name.includes(mage.prefab.split('/').pop()!),
            `${mage.name} 的尺寸节点叫 ${scale.name}，既不是 offset 也不像根节点，确认一下是不是找错了`);
    }
});
