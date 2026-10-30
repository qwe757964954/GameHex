import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMatchProfileLookup, applyUnitToPlayerView } from '../assets/script/app/battle/BattleStartModel';
import type { MatchPlayerData } from '../assets/script/app/matching/MatchTypes';
import { assetPath } from './helpers/asset-paths';

/**
 * 匹配界面的神器图标必须与对局里**同一张图**。
 *
 * 起因（截图自证）：匹配成功面板显示一把**蓝色法杖**，进对局后 HUD 显示**剑**（霜封冰刃）。
 * 根因是 `MatchPlayerItem.prefab` 的 `ArtifactIcon` 上
 * **硬绑** `image/matching/icon_faqi.png`（那张固定占位图），而代码里
 * `data.artifactIcon` 全工程**从没被赋真值**（`MatchPool` 里是空串）⇒ 永远不覆盖它。
 *
 * 口径（山猫 2026-10-08）：图标**资源名**从 `pvpArtifact[].icon` 取（如 `霜封冰刃`），
 * 图在 `image/artifact/<icon>` —— 与对局里的神器格**同一张图**。
 */

const ARTIFACT_ROWS = [
    { artifactId: '69001', name: '希瓦的守护', icon: '霜封冰刃' },
    { artifactId: '69002', name: '疾风之靴', icon: '狂猎皮靴' },
    { artifactId: '69003', name: '战神之怒', icon: '狂暴战斧' },
];

test('lookup 从 pvpArtifact 表取神器图标名（与对局同一张图）', () => {
    const lookup = buildMatchProfileLookup(null, ARTIFACT_ROWS);
    assert.equal(lookup.artifactName(69001), '希瓦的守护');
    assert.equal(lookup.artifactIcon(69001), '霜封冰刃', '图标名要能查出来');
    assert.equal(lookup.artifactIcon(69003), '狂暴战斧');
    // 查不到返回空串，调用方保留 prefab 原帧 —— 不抛、不给 undefined。
    assert.equal(lookup.artifactIcon(99999), '');
});

test('名字与图标分开取：两列各自留空不互相拖累', () => {
    const lookup = buildMatchProfileLookup(null, [
        { artifactId: '1', name: '只有名字', icon: '' },
        { artifactId: '2', name: '', icon: '只有图标' },
        { artifactId: '0', name: '坏行 id', icon: 'x' },
        null as never,
    ]);
    assert.equal(lookup.artifactName(1), '只有名字');
    assert.equal(lookup.artifactIcon(1), '', 'name 有值不该让 icon 也被塞成空之外的怪值');
    assert.equal(lookup.artifactName(2), '');
    assert.equal(lookup.artifactIcon(2), '只有图标', '**icon 有值时不能被 name 缺失吞掉**');
    assert.equal(lookup.artifactName(0), '', 'id<=0 是坏行，跳过');
});

test('对手数据带上图标名（服务端 artifactId → 资源名）', () => {
    const lookup = buildMatchProfileLookup(null, ARTIFACT_ROWS);
    const base: MatchPlayerData = {
        name: '', avatarIcon: '', power: 0, rank: '', trophy: 0,
        artifactName: '', artifactIcon: '', stats: [],
    };
    const merged = applyUnitToPlayerView(
        base,
        { artifactId: 69001, name: '对手', power: 72, gradeScore: 386 } as never,
        lookup,
    );
    assert.equal(merged.artifactName, '希瓦的守护');
    assert.equal(merged.artifactIcon, '霜封冰刃', '对手的图标名必须一起带过来');
    // base 不能被就地改（视图对象当不可变用）。
    assert.equal(base.artifactIcon, '');
});

test('匹配界面从 image/artifact 取神器图，不是 image/matching', () => {
    const artPaths = readFileSync('assets/script/app/ArtPaths.ts', 'utf8');
    assert.match(artPaths, /ARTIFACT_ART_ROOT\s*=\s*`\$\{ART_ROOT\}\/artifact`/,
        '神器图根必须是 image/artifact（与对局同一张图）');
    const item = readFileSync('assets/script/app/matching/MatchPlayerItem.ts', 'utf8');
    assert.match(item, /iconLoader\(data\.artifactIcon,\s*ARTIFACT_ART_ROOT\)/,
        '匹配视图必须用 artifact 根加载神器图标');
    assert.ok(
        !/iconLoader\(data\.artifactIcon,\s*MATCH_ART_ROOT\)/.test(item),
        '**不能再用 MATCH_ART_ROOT 取神器** —— 那儿只有一张固定占位图',
    );
});

test('匹配 prefab 不再硬绑那张占位神器图', () => {
    // `icon_faqi.png` 的 uuid（2026-10-08 从 prefab 里查出来的）。
    //  2026-10-13：我方/敌方已统一成同一个 `MatchPlayerItem`（配色由 `applySlot()` 运行时挑），
    //  `MatchEnemyItem.prefab` 随之删除，所以这里只剩一个 prefab 要查。
    const PLACEHOLDER_UUID = 'd18e689c-9532-4c19-9d4d-d5974023519b';
    for (const name of ['MatchPlayerItem']) {
        const prefab = readFileSync(assetPath(`ui/matching/${name}.prefab`), 'utf8');
        assert.ok(
            !prefab.includes(PLACEHOLDER_UUID),
            `${name}.prefab 的 ArtifactIcon 不该再硬绑占位神器图（蓝色法杖）—— 查不到配置就留空，别显示错的`,
        );
    }
});

// 2026-10-08 回归：占位帧清掉后，匹配页神器位**一直空白**（截图自证）。
// 根因不在 prefab 也不在查表，而在**我方神器 id 的来源**：
// `ProcedureMatching.onEnter` 读 `CacheMgr.getTlCmdArtifact()?.[0].artifactId`，
// 那是 `CmdArtifact` **推送**缓存 —— 本客户端从未订阅这条推送（工程里只有 CacheMgrGen
// 的 getter 与 protobuf 定义，没有任何地方把它写进缓存）⇒ 恒为 `[]`
// ⇒ `artifactName` / `artifactIcon` 都留空。
// ⚠️ 这类 bug 单测测不出来（测试环境不跑网络），只能靠"断言源码不出现那条读法"钉死。

test('我方神器不得读从未订阅的 CmdArtifact 推送缓存（那条恒为空 ⇒ 图标永远空白）', () => {
    const src = readFileSync('assets/script/app/procedure/ProcedureMatching.ts', 'utf8');
    // 反例断言先剥注释（规则 104）：解释根因的注释里会提到这个方法名。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(
        !/getTlCmdArtifact\(\)\s*\?\.\s*\[0\]|getTlCmdArtifact\(\)\s*\?\?\s*\[\]/.test(code),
        '我方神器 id 只能来自 CmdStartBattleRspMsg.unitInfos[].artifactId（与对手同源）；'
        + 'getTlCmdArtifact 是未订阅的推送缓存，恒为空 ⇒ artifactIcon 永远拿不到值',
    );
    // 正向：确实走了 applyUnitToPlayerView 这条合并点。
    assert.match(code, /applyUnitToPlayerView\(withPvp,\s*this\.selfUnit,\s*this\.profileLookup\)/,
        '我方神器应由 refreshMineView 的 applyUnitToPlayerView 统一合并上屏');
});

test('预热走全表图标名：按 id 预热必然查不到（本局神器 id 要等开始游戏回包）', () => {
    const lookup = buildMatchProfileLookup(null, ARTIFACT_ROWS);
    assert.deepEqual(lookup.allArtifactIcons(), ['霜封冰刃', '狂猎皮靴', '狂暴战斧'],
        '全表预热必须给出去重后的图标名');
    assert.deepEqual(buildMatchProfileLookup(null, null).allArtifactIcons(), [],
        '表读失败时给空数组，不抛');
    // 去重：同名只出现一次（预热列表重复 = 白白多加载一次）
    assert.deepEqual(
        buildMatchProfileLookup(null, [
            { artifactId: '1', name: 'a', icon: '同一张' },
            { artifactId: '2', name: 'b', icon: '同一张' },
        ]).allArtifactIcons(),
        ['同一张'],
    );

    const src = readFileSync('assets/script/app/procedure/ProcedureMatching.ts', 'utf8');
    assert.match(src, /preloadMatchIcons\(\s*lookup\.allArtifactIcons\(\),\s*ARTIFACT_ART_ROOT/,
        '匹配页预热必须用 allArtifactIcons() 全表预热，否则我方神器图标要等 onDemand 晚一帧');
});