import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

/**
 * 3.8.2 起 `cc.LabelOutline` 组件已废弃：
 *   `'LabelOutline.color' is deprecated. (Please use Label.outlineColor instead.)`
 * 且编辑器在序列化该组件时会读取 `LabelOutline.color`，每次保存 prefab 都刷一条 warn。
 *
 * 正确做法：描边全部走 `Label` 自己的 `enableOutline / outlineColor / outlineWidth`
 * （三者必须同时给：`outlineWidth` 只在 `enableOutline = true` 时参与渲染）。
 *
 * 这里用 HUD 预制体钉住，防止以后有人图省事又挂回 `cc.LabelOutline`。
 */
const HUD_PREFAB = assetPath('ui/game/ZCGameHUD.prefab');

function readHud(): any[] {
    return JSON.parse(readFileSync(HUD_PREFAB, 'utf8')) as any[];
}

test('ZCGameHUD 不得再挂已废弃的 cc.LabelOutline 组件', () => {
    const data = readHud();
    const offenders = data
        .filter((o) => o && o.__type__ === 'cc.LabelOutline')
        .map((o) => (data[o.node.__id__] as any)._name);
    assert.deepEqual(
        offenders, [],
        `★这些节点仍挂 cc.LabelOutline（会刷 LabelOutline.color deprecated 警告）：${offenders.join(', ')}`,
    );
});

test('计时与比分数字的描边走 Label 自身属性（enableOutline / outlineColor / outlineWidth）', () => {
    const data = readHud();
    const rows = data
        .filter((o) => o && o.__type__ === 'cc.Label')
        .map((o) => ({ label: o, node: data[o.node.__id__] as any }))
        .filter(({ node }) => node && (node._name === 'timeLab' || node._name === 'Value'));
    assert.equal(rows.length, 5, '★HUD 上应有 4 个比分 Value + 1 个 timeLab');

    for (const { label, node } of rows) {
        assert.equal(label._enableOutline, true, `★${node._name} 必须 enableOutline=true`);
        assert.equal(label._outlineWidth, 2, `★${node._name} 描边宽 2`);
        assert.ok(
            label._outlineColor && label._outlineColor.__type__ === 'cc.Color',
            `★${node._name} 必须有 outlineColor（不能靠旧组件默认值）`,
        );
    }
});
