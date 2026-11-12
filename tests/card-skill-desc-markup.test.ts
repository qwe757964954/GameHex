import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DEFAULT_SKILL_DESC_COLORS,
    SKILL_DESC_BOOST_VERBS,
    formatSkillDescMarkup,
    hexOfColor,
} from '../assets/script/app/card/CardSkillDescMarkup';

const BOOST = DEFAULT_SKILL_DESC_COLORS.boost;
const PLAIN = DEFAULT_SKILL_DESC_COLORS.plain;

/** 期望片段（省得每处手写尖括号）。 */
const colored = (color: string, value: string): string => `<color=${color}>${value}</color>`;

describe('formatSkillDescMarkup', () => {
    it('提高/增加/提升/增强 后面的百分比用绿色', () => {
        for (const verb of SKILL_DESC_BOOST_VERBS) {
            assert.equal(
                formatSkillDescMarkup(`暴击率${verb}22%`),
                `暴击率${verb}${colored(BOOST, '22%')}`,
                verb,
            );
        }
        assert.equal(
            formatSkillDescMarkup('暴击率提高22%，暴击伤害提高90%'),
            `暴击率提高${colored(BOOST, '22%')}，暴击伤害提高${colored(BOOST, '90%')}`,
        );
    });

    it('动词后面的整数（没百分号）仍算普通数字', () => {
        assert.equal(formatSkillDescMarkup('增加2个目标'), `增加${colored(PLAIN, '2')}个目标`);
    });

    it('造成/其它语境下的百分比用蓝色', () => {
        assert.equal(
            formatSkillDescMarkup('命中对周围造成30%溅射伤害'),
            `命中对周围造成${colored(PLAIN, '30%')}溅射伤害`,
        );
        //  同一句里「造成」的那一个不能因为后面有「提高」而被染绿。
        assert.equal(
            formatSkillDescMarkup('造成30%溅射伤害，攻击速度提高14%'),
            `造成${colored(PLAIN, '30%')}溅射伤害，攻击速度提高${colored(BOOST, '14%')}`,
        );
    });

    it('次数/半径/秒数这类数字默认蓝色', () => {
        assert.equal(
            formatSkillDescMarkup('每3次普攻，第3次附带点燃：每0.5秒造成1'),
            `每${colored(PLAIN, '3')}次普攻，第${colored(PLAIN, '3')}次附带点燃：每${colored(PLAIN, '0.5')}秒造成${colored(PLAIN, '1')}`,
        );
        assert.equal(
            formatSkillDescMarkup('目标点生成半径60的灼热地带'),
            `目标点生成半径${colored(PLAIN, '60')}的灼热地带`,
        );
    });

    it('没有数字时原样返回（不触发 RichText 重排），空串返回空串', () => {
        const plain = '命中对周围造成溅射伤害';
        assert.equal(formatSkillDescMarkup(plain), plain);
        assert.equal(formatSkillDescMarkup(''), '');
        assert.equal(formatSkillDescMarkup(null as unknown as string), '');
    });

    it('自定义配色', () => {
        assert.equal(
            formatSkillDescMarkup('伤害提高5%', { boost: '#00FF00', plain: '#0000FF' }),
            `伤害提高${colored('#00FF00', '5%')}`,
        );
    });

    it('bold：整段包一层 <b>，color 标签嵌在里面（解析器会把父样式合并到子标签）', () => {
        assert.equal(
            formatSkillDescMarkup('普攻额外发射1发，攻击速度提高14%', DEFAULT_SKILL_DESC_COLORS, true),
            `<b>普攻额外发射${colored(PLAIN, '1')}发，攻击速度提高${colored(BOOST, '14%')}</b>`,
        );
    });

    it('bold：没有数字也要包 <b>，否则换 RichText 后粗体就丢了', () => {
        assert.equal(formatSkillDescMarkup('无数字描述', DEFAULT_SKILL_DESC_COLORS, true), '<b>无数字描述</b>');
    });
});

describe('hexOfColor', () => {
    it('cc.Color 形状 → 大写 #RRGGBB，越界钳位', () => {
        assert.equal(hexOfColor({ r: 24, g: 115, b: 30 }), '#18731E');
        assert.equal(hexOfColor({ r: 28, g: 74, b: 168 }), '#1C4AA8');
        assert.equal(hexOfColor({ r: -5, g: 300, b: 15.6 }), '#00FF10');
    });

    it('空值当黑色，不炸', () => {
        assert.equal(hexOfColor(null), '#000000');
        assert.equal(hexOfColor(undefined), '#000000');
    });
});

describe('真表复核', () => {
    const table = JSON.parse(readFileSync('assets/remoteRef/armySkillLevelUp.json', 'utf8'));
    const index = new Map<string, number>(table.k.map((name: string, at: number) => [name, at]));
    const descOf = (skillId: number, tier: number): string => {
        const row = table.v.find((r: unknown[]) => Number(r[index.get('id')!]) === skillId
            && Number(r[index.get('skilllevel')!]) === tier);
        return String(row?.[index.get('desc')!] ?? '');
    };

    it('火焰树妖首档：唯一一个百分比是「提高10%」，走绿色', () => {
        const desc = descOf(100301, 1);
        assert.equal(desc, '攻击提高10%（三级同值，不叠加）');
        assert.equal(formatSkillDescMarkup(desc), `攻击提高${colored(BOOST, '10%')}（三级同值，不叠加）`);
    });

    it('爆囊扩散首档（截图那一行）：造成30% 留蓝，提高14%/6% 变绿', () => {
        const desc = descOf(101501, 1);
        assert.equal(desc, '命中对周围造成30%溅射伤害，攻击速度提高14%，伤害提高6%');
        assert.equal(
            formatSkillDescMarkup(desc),
            `命中对周围造成${colored(PLAIN, '30%')}溅射伤害，攻击速度提高${colored(BOOST, '14%')}，伤害提高${colored(BOOST, '6%')}`,
        );
    });

    it('全表：染色后的可见字符与原文逐字一致（只多了 color 标签）', () => {
        const strip = (markup: string): string => markup.replace(/<color=[^>]*>|<\/color>/g, '');
        let checked = 0;
        for (const row of table.v) {
            const desc = String(row[index.get('desc')!] ?? '');
            if (!desc) continue;
            checked++;
            assert.equal(strip(formatSkillDescMarkup(desc)), desc, desc);
        }
        assert.ok(checked > 300, `实际检查 ${checked} 条`);
    });
});
