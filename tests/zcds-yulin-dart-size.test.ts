import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { HEX_GRID_FACE_WIDTH } from '../assets/script/core/hex/HexGridLayout';
import { assetPath } from './helpers/asset-paths';
import { readPngAlphaBox } from './helpers/png-alpha';

/**
 * 玉林好汉普攻飞镖的**屏上大小**（2026-10-30 用户：「普攻飞镖大小缩小成 70%」）。
 *
 * 尺寸唯一真源是 prefab 里 `offset` 的 `_lscale`：
 *  - `ZCCombatEffectView.render` 的 `spriteNode.setScale(Vec3.ONE)` 只归它自带的兜底 Sprite，
 *    碰不到 prefab 实例；`ZCGameEffect` 宿主恒 `setScale(ONE)`；`ZCCombatEffectPlacement` 里**没有** scale 字段。
 *  - 所以「改大小」= 改 `offset._lscale`，代码里一行都不用动。
 *
 * ⚠️ 别看 `UITransform.contentSize`（256×254 是整张画布），**画布四周有留白**：
 *    13 帧并集的可见内容只有 187×178，按 contentSize 算会高估 37%。
 */

const ROOT = join(__dirname, '..');
const SKILL_ID = 30716;            // 玉林好汉普攻
const EMPOWERED_SKILL_ID = 30821;  // 精英猎手（强化那一击，借另一个 prefab）
const DART = 'units/projectiles/玉林好汉_飞镖普攻/玉林好汉_飞镖普攻';
const DART_DIR = 'units/projectiles/玉林好汉_飞镖普攻';
const DART_EMPOWERED = 'units/projectiles/玉林好汉_飞镖普攻_强化/玉林好汉_飞镖普攻_强化';

/** 改前的缩放。用户口径「缩小成 70%」是相对这个数说的。 */
const SCALE_BEFORE = 0.5;
const SHRINK = 0.7;
const SCALE_AFTER = SCALE_BEFORE * SHRINK; // 0.35

/**
 * 技能（100404「精英猎手」，走 30716 的强化那一击 → 30821）的预制体大小
 * = 普攻飞镖的 **1.75 倍**（用户 2026-10-30 口径）。
 */
const SKILL_RATIO = 1.75;
const SCALE_SKILL = 0.6125; // 0.35 × 1.75

/** 13 帧（`427_00` ~ `427_24`，步长 2）的可见内容并集，纹理坐标。 */
const FRAMES = ['427_00', '427_02', '427_04', '427_06', '427_08', '427_10', '427_12',
    '427_14', '427_16', '427_18', '427_20', '427_22', '427_24'];
const CONTENT = { width: 187, height: 178 };

const readJson = (relative: string): any => JSON.parse(readFileSync(join(ROOT, relative), 'utf8'));

function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(join(ROOT, `assets/remoteRef/${name}.json`), 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

const rowOf = (rows: Array<Record<string, unknown>>, skillId: number): Record<string, unknown> => {
    const hit = rows.find((row) => row.skillId === skillId);
    assert.ok(hit, `pvpSkill 缺少技能行 ${skillId}`);
    return hit!;
};

/** prefab 里各节点的 `_lscale`（名字 → 缩放）。 */
function scales(file: string): Map<string, { x: number; y: number }> {
    const prefab = readJson(assetPath(file)) as Array<Record<string, any>>;
    const result = new Map<string, { x: number; y: number }>();
    for (const entry of prefab) {
        if (entry.__type__ !== 'cc.Node') continue;
        result.set(entry._name, { x: entry._lscale.x, y: entry._lscale.y });
    }
    return result;
}

test('① 配置表：30716 用普攻飞镖、30821 用强化飞镖，是两套独立的 prefab', () => {
    const rows = readPvpRows('pvpSkill');
    assert.equal(rowOf(rows, SKILL_ID).effectPrefabPath, DART);
    assert.equal(rowOf(rows, SKILL_ID).empoweredSkillId, EMPOWERED_SKILL_ID);
    // 强化那一击是「精英猎手」，自己一套美术，**不跟着缩小**。
    assert.equal(rowOf(rows, EMPOWERED_SKILL_ID).effectPrefabPath, DART_EMPOWERED);
});

test('② 缩放：offset 从 0.5 缩到 0.35（= 70%），根节点仍是 1', () => {
    const dart = scales(`${DART_DIR}/玉林好汉_飞镖普攻.prefab`);
    const offset = dart.get('offset')!;
    assert.ok(offset, '飞镖 prefab 缺 offset 节点');
    assert.ok(Math.abs(offset.x - SCALE_AFTER) < 1e-6,
        `offset 缩放 ${offset.x} 应等于 ${SCALE_BEFORE} × ${SHRINK} = ${SCALE_AFTER}`);
    assert.equal(offset.x, offset.y, '飞镖要等比缩，非等比会拉扁');
    // 尺寸不能写在根上：宿主 `setScale(Vec3.ONE)` 会把它冲掉（见 §1.10）。
    const root = dart.get('玉林好汉_飞镖普攻')!;
    assert.deepEqual([root.x, root.y], [1, 1], '根节点必须恒 1，尺寸只认 offset');
});

test('③ 屏上尺寸：13 帧可见并集 187×178 × 0.35 ≈ 65.5×62.3px（0.53 格）', () => {
    // 先用 PNG 自己量一遍，避免常数和美术脱节。
    // `readPngAlphaBox` 的 y 已翻成自下而上（`bottom` 含、`top` 不含），这里换回自上而下的纹理坐标。
    const measured = FRAMES.reduce((acc, frame) => {
        const box = readPngAlphaBox(join(ROOT, assetPath(`${DART_DIR}/atlas/${frame}.png`)), 7);
        return {
            left: Math.min(acc.left, box.left),
            right: Math.max(acc.right, box.right),
            top: Math.min(acc.top, box.height - box.top),
            bottom: Math.max(acc.bottom, box.height - box.bottom),
        };
    }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
    assert.deepEqual(
        { width: measured.right - measured.left, height: measured.bottom - measured.top },
        CONTENT,
        '13 帧可见并集变了 ⇒ 下面的换算要重算',
    );

    const onScreen = { width: CONTENT.width * SCALE_AFTER, height: CONTENT.height * SCALE_AFTER };
    assert.ok(Math.abs(onScreen.width - 65.45) < 0.5, `屏上宽 ${onScreen.width.toFixed(2)} 应约 65.45`);
    assert.ok(Math.abs(onScreen.height - 62.3) < 0.5, `屏上高 ${onScreen.height.toFixed(2)} 应约 62.30`);
    // 改前 93.5px（0.76 格，快赶上一格顶面）→ 改后 0.53 格，缩小的意义就在这里。
    assert.ok(onScreen.width < HEX_GRID_FACE_WIDTH * 0.6,
        `屏上宽 ${onScreen.width.toFixed(1)}px 应小于 0.6 格（${(HEX_GRID_FACE_WIDTH * 0.6).toFixed(1)}px）`);
    assert.ok(onScreen.width > HEX_GRID_FACE_WIDTH * 0.4, '再小就读不清是飞镖了（0.4 格是下限）');
});

test('④ 技能（精英猎手）：预制体 = 普攻飞镖的 1.75 倍 = 0.6125', () => {
    const dart = scales(`${DART_DIR}/玉林好汉_飞镖普攻.prefab`);
    const empowered = scales(`${DART_EMPOWERED}.prefab`);
    const normal = dart.get('offset')!.x;
    const skill = empowered.get('offset')!.x;

    assert.equal(skill, SCALE_SKILL, `技能 offset ${skill} 应等于 0.35 × 1.75 = ${SCALE_SKILL}`);
    // 关系本身也要守住：以后单独改普攻忘了同步技能，这条会先红。
    assert.ok(Math.abs(skill - normal * SKILL_RATIO) < 1e-6,
        `技能 ${skill} 必须是普攻 ${normal} 的 ${SKILL_RATIO} 倍（实得 ${(skill / normal).toFixed(3)} 倍）`);
    assert.equal(empowered.get('offset')!.x, empowered.get('offset')!.y, '技能飞镖也要等比缩');

    // 两套**共用同一份美术**：强化 prefab 目录里只有 `.prefab`，Sprite / Animation 直接引用
    // 普攻目录的 uuid。⇒「1.75 倍」是纯缩放比例，不需要按不同美术的可见尺寸换算。
    // （哪天有人给技能单独换一套图，这条会红，提醒把基准换成实测可见尺寸。）
    const spriteOf = (file: string): string => {
        const prefab = readJson(assetPath(file)) as Array<Record<string, any>>;
        return prefab.find((entry) => entry.__type__ === 'cc.Sprite')._spriteFrame.__uuid__;
    };
    assert.equal(spriteOf(`${DART_EMPOWERED}.prefab`), spriteOf(`${DART_DIR}/玉林好汉_飞镖普攻.prefab`),
        '技能与普攻必须共用同一份帧图 —— 否则「1.75 倍」的基准就不成立了');

    // 屏上可见宽：65.45 × 1.75 = 114.5px（普攻那支是 65.45）。
    const skillWidth = CONTENT.width * SCALE_SKILL;
    assert.ok(Math.abs(skillWidth - 114.54) < 0.5, `技能屏上宽 ${skillWidth.toFixed(2)} 应约 114.54`);
});
