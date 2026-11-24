/**
 * 战斗音效（`ZCBattleAudio`，用户 2026-11-23 口径）：
 *
 *  1. 四个职业（射手 / 战士 / 法师 / 坦克）各有「普攻」「技能」两条音效，按攻击方职业取；
 *  2. **只播玩家这方**：敌方 / NPC 打出同样的职业与技能一律静音；
 *  3. 技能音只在真正施法那一拍响 —— 普攻、被动表现（冲锋护盾 / 召唤 / 践踏落点）、
 *     以及同一发的末端爆炸 / 命中附加特效都不许再响一次；
 *  4. 同一时间出现两个相同音效 ⇒ 只播 1 个。
 *
 * 地块点击音（随机格奖励）不归本类：它挂在控制器 `onHexClick` 的开发成功那一拍，
 * 见 `battle-runtime-controller.test.ts`「战斗内点击可开发地块就播随机格奖励音」。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCBattleAudio } from '../assets/script/app/zcds/application/ZCBattleAudio';

const source = { trait: '法师' as const, attackSkillId: 100, activeSkillIds: [101, 102] };
const attack = { id: 1, owner: 'player' as const, sourceUnitId: 7, type: 'projectile' as const, skillId: 100, startedAt: 0, empowered: false };
const skill = { ...attack, skillId: 101 };

test('普攻、强化和爆炸各播一次，飞行和命中不重复播放普攻', () => {
    const audio = new ZCBattleAudio();
    const played: string[] = [];
    const play = (key: string) => played.push(key);
    audio.present([attack], 0, () => source, play);
    audio.present([attack, { ...attack, id: 2, type: 'area', effectKey: 'hit' }], 0.2, () => source, play);
    audio.present([{ ...attack, id: 3, startedAt: 0.3, empowered: true }], 0.3, () => source, play);
    audio.present([{ ...attack, id: 4, type: 'area', startedAt: 0.5, effectPrefabPath: 'units/projectiles/爆炸/爆炸' }],
        0.5, () => undefined, play);
    assert.deepEqual(played.map(key => key.split('/').pop()), ['法师普攻', '法师技能', '爆炸技能']);
});

test('相同音效的同帧出手合并，未来的技能到出手时才播', () => {
    const audio = new ZCBattleAudio();
    const played: string[] = [];
    const play = (key: string) => played.push(key);
    const events = [attack, { ...attack, id: 2, sourceUnitId: 8 }, { ...attack, id: 3, startedAt: 1, skillId: 101 }];
    audio.present(events, 0, () => source, play);
    audio.present(events, 0.5, () => source, play);
    assert.equal(played.length, 1);
    audio.present(events, 1, () => source, play);
    assert.deepEqual(played.map(key => key.split('/').pop()), ['法师普攻', '法师技能']);
});

test('敌方 / NPC 出手一律静音', () => {
    const audio = new ZCBattleAudio();
    const played: string[] = [];
    audio.present([
        { ...attack, owner: 'enemy' },
        { ...skill, id: 2, owner: 'enemy2' },
        { ...attack, id: 3, owner: 'enemy3' },
    ], 0, () => source, (key) => played.push(key));
    assert.deepEqual(played, []);
});

test('主动技能只在施法那一拍响，被动技能行与末端余韵都不响', () => {
    const audio = new ZCBattleAudio();
    const played: string[] = [];
    const play = (key: string) => played.push(key);
    // 101 / 102 都是主动技能行 ⇒ 各响一次（间隔超过 0.18s）。
    audio.present([{ ...skill, id: 1 }], 0, () => source, play);
    // 同一发的末端爆炸：带着主动技能 id 但 damage 为 0 ⇒ 不再响第二次。
    audio.present([{ ...skill, id: 2, type: 'area', startedAt: 0.1, damage: 0 }], 0.6, () => source, play);
    // 被动表现（冲锋护盾）：skillId 既不是普攻也不是主动技能 ⇒ 静音。
    audio.present([{ ...attack, id: 3, startedAt: 0.7, type: 'melee', skillId: 999 }], 0.7, () => source, play);
    audio.present([{ ...attack, id: 4, startedAt: 0.8, skillId: 102 }], 0.8, () => source, play);
    assert.deepEqual(played.map(key => key.split('/').pop()), ['法师技能', '法师技能']);
});

test('四个职业各取自己的普攻 / 技能音效', () => {
    for (const trait of ['射手', '战士', '法师', '坦克'] as const) {
        const audio = new ZCBattleAudio();
        const played: string[] = [];
        const own = { trait, attackSkillId: 100, activeSkillIds: [101] };
        audio.present([attack], 0, () => own, (key) => played.push(key));
        audio.present([{ ...attack, id: 2, startedAt: 1, skillId: 101 }], 1, () => own, (key) => played.push(key));
        assert.deepEqual(played.map(key => key.split('/').pop()), [`${trait}普攻`, `${trait}技能`]);
    }
});
