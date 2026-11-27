/**
 * 第 57 批：卡牌常用子弹统一格式（2026-11-26）。
 *
 * 用户口径：
 *   1. 豌豆游侠普攻 → 【豌豆游侠_子弹】，白色三角形拖尾（复用的技能也一起换）
 *   2. 毒箭菇蘑菇爆炸 从【陷阱特效】→【毒箭菇_子弹】，飞行段 Y 轴抖动 1-1.05-0.95-1
 *   3. 杰克藕普攻 从弓兵通用箭矢 →【杰克藕_子弹】
 *   4. 大嘴花破阵术 →【大嘴花_子弹】，飞行段 X 轴抖动
 *   5. 仙桃行者破阵术 →【仙桃行者_子弹】
 *   6. 玉林好汉普攻 →【玉林好汉_子弹】
 *   7. 诅咒菇破阵术 →【诅咒菇_子弹】，紫色拖尾
 *
 * 本文件钉的是「七颗子弹是同一套东西」：
 *   ① prefab 结构逐字同构（根 + `body` + Sprite，CUSTOM + 不裁剪）；
 *   ② 每颗都有 spec + 拖尾（漏一条 = 子弹飞出去没尾巴，不报错）；
 *   ③ 抖动只有毒箭菇(Y) / 大嘴花(X)，四个关键帧精确到 1 / 1.05 / 0.95 / 1；
 *   ④ 两个「表里没有、只能按单位登记」的入口（破阵术弹体 / 陷阱飞行段）都进了资源计划；
 *   ⑤ 配表三写一致（xlsx 源表由人改，这里只钉两份 json 与预期值）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    ZC_EFFECT_PATHS,
    zcEffectSpecOfPath,
    zcEffectTrailOf,
    zcEffectWobbleOf,
} from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { zcBulletWobbleScale, zcBulletWobbleScaleXY } from '../assets/script/app/zcds/model/ZCBulletWobble';
import {
    ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH,
    ZC_LANCE_EFFECT_PREFAB_BY_UNIT,
    zcLanceEffectPrefabPath,
    zcLanceEffectPrefabPathsForUnit,
} from '../assets/script/app/zcds/model/ZCLanceFx';
import {
    ZC_TRAP_FLIGHT_PREFAB_BY_UNIT,
    ZC_TRAP_SPAWN_PREFAB_PATH,
    zcTrapFlightPath,
    zcTrapFlightPathsForUnit,
} from '../assets/script/app/zcds/model/ZCTrapFx';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';

const BULLET_DIR = 'assets/bundles/battle/units/projectiles/卡牌常用子弹物件';

/** 七颗子弹：路径常量 | 素材名前缀 | 拖尾颜色是否紫色。*/
const BULLETS = [
    { key: 'cardBulletPea', name: '豌豆游侠_子弹', purple: false },
    { key: 'cardBulletDujuan', name: '毒箭菇_子弹', purple: false },
    { key: 'cardBulletJack', name: '杰克藕_子弹', purple: false },
    { key: 'cardBulletMouth', name: '大嘴花_子弹', purple: false },
    { key: 'cardBulletPeach', name: '仙桃行者_子弹', purple: false },
    { key: 'cardBulletYulin', name: '玉林好汉_子弹', purple: false },
    { key: 'cardBulletCurse', name: '诅咒菇_子弹', purple: true },
] as const;

function bulletPath(key: string): string {
    return (ZC_EFFECT_PATHS as unknown as Record<string, string>)[key];
}

function readJson(file: string): unknown {
    return JSON.parse(readFileSync(file, 'utf8'));
}

/** remoteRef 是列存 `{k,v}`，client 是行对象数组 —— 两种都要吃。*/
function tableRows(file: string): Array<Record<string, unknown>> {
    const raw = readJson(file) as Array<Record<string, unknown>> | { k: string[]; v: unknown[][] };
    if (Array.isArray(raw)) return raw;
    return raw.v.map((row) => Object.fromEntries(raw.k.map((key, index) => [key, row[index]])));
}

// ── 一、七颗子弹是同一套东西 ────────────────────────────────────────────────

test('七条路径都登记了 spec 与拖尾（漏一条 = 子弹飞出去没尾巴，且不报错）', () => {
    for (const bullet of BULLETS) {
        const path = bulletPath(bullet.key);
        assert.equal(path, `units/projectiles/卡牌常用子弹物件/${bullet.name}`,
            `${bullet.key} 必须指向同目录的 prefab`);
        const spec = zcEffectSpecOfPath(path);
        assert.ok(spec, `${bullet.name} 没有 spec：视图取不到层/尺寸，会落到兜底表现`);
        assert.equal(spec.layer, 'top', '弹体必须在动态对象最上层');
        //  🔴 不写 nodeScale 是硬要求：宿主 scale = 1 时拖尾的「本地 px」才等于「屏上 px」，
        //     七张卡才能共用同一组拖尾数字。写了就会让拖尾按倍率缩水。
        assert.equal(spec.nodeScale, undefined, `${bullet.name} 不准写 nodeScale（缩放烘在 prefab 的 body）`);
        assert.ok(zcEffectTrailOf(path), `${bullet.name} 没有拖尾登记`);
    }
});

test('prefab 结构逐字同构：根 + body + Sprite（CUSTOM、不裁剪）', () => {
    for (const bullet of BULLETS) {
        const prefabPath = `${BULLET_DIR}/${bullet.name}.prefab`;
        assert.ok(existsSync(prefabPath), `缺 prefab：${prefabPath}`);
        assert.ok(existsSync(`${prefabPath}.meta`), `缺 meta（编辑器不会自己补到 SVN 里）：${prefabPath}.meta`);
        const nodes = readJson(prefabPath) as Array<Record<string, unknown>>;
        const types = nodes.map((node) => node.__type__);
        assert.deepEqual(types, [
            'cc.Prefab', 'cc.Node', 'cc.Node', 'cc.UITransform',
            'cc.CompPrefabInfo', 'cc.Sprite', 'cc.CompPrefabInfo',
            'cc.PrefabInfo', 'cc.PrefabInfo',
        ], `${bullet.name} 结构漂了：七份必须逐字同构`);

        const root = nodes[1];
        const body = nodes[2];
        assert.equal(root._name, bullet.name);
        assert.equal(body._name, 'body', '抖动按这个名字找节点，改名等于关掉抖动');
        //  根节点不承载美术/缩放：缩放必须烘在 body 上，这样抖动的基准只有一处。
        assert.deepEqual(root._lscale, { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 });
        const bodyScale = body._lscale as { x: number; y: number };
        assert.ok(bodyScale.x > 0 && bodyScale.x < 1.2, `${bullet.name} body 缩放越界：${bodyScale.x}`);
        assert.equal(bodyScale.x, bodyScale.y, '等比缩放：抖动乘上来才不会把子弹拉扁');

        const transform = nodes[3];
        assert.deepEqual(transform._contentSize, { __type__: 'cc.Size', width: 215, height: 215 },
            '内容尺寸必须是素材画布（215×215），否则主体会被拉伸');

        const sprite = nodes[5];
        assert.equal(sprite._isTrimmedMode, false,
            '🔴 素材是 trim 导入的：开着裁剪会把主体按包围盒重排，主体中心就不在原点了');
        assert.equal(sprite._sizeMode, 0, 'CUSTOM 尺寸，跟着 UITransform 走');

        //  贴图必须指向同目录那张 png 的 sprite-frame（不是别的卡串了图）。
        const meta = readJson(`${BULLET_DIR}/${bullet.name}.png.meta`) as {
            uuid: string;
            subMetas?: Record<string, { importer?: string }>;
        };
        const subName = Object.keys(meta.subMetas ?? {}).find(
            (name) => meta.subMetas?.[name]?.importer === 'sprite-frame',
        );
        assert.ok(subName, `${bullet.name}.png.meta 里没有 sprite-frame`);
        assert.deepEqual(sprite._spriteFrame, {
            __uuid__: `${meta.uuid}@${subName}`,
            __expectedType__: 'cc.SpriteFrame',
        }, `${bullet.name} 的贴图指向不对`);
    }
});

test('拖尾：诅咒菇紫、其余白；七条几何同一套口径（长度 67.2、尖端 1.05）', () => {
    //  2026-11-26 第 58 批：用户实机看「子弹太大了」⇒ 等效直径 48 → 33.6（70%），
    //  拖尾四件几何同步 ×0.7：length 96 → 67.2、tipHalfWidth 1.5 → 1.05。
    //  🔴 只缩 prefab 不缩拖尾的话，拖尾会明显比弹体粗一圈（两者是独立登记的）。
    for (const bullet of BULLETS) {
        const trail = zcEffectTrailOf(bulletPath(bullet.key));
        assert.ok(trail, `${bullet.name} 缺拖尾`);
        assert.equal(trail.length, 67.2, '长度统一（= 2 倍等效直径 33.6）');
        assert.equal(trail.tipHalfWidth, 1.05, '尖端统一：三角形要收得尖');
        assert.equal(trail.slices, 12);
        assert.ok(trail.startX < 0, '拖尾沿 -X 伸展（宿主本地 +X = 飞行方向）');
        assert.ok(trail.rootHalfWidth > trail.tipHalfWidth, '根部必须比尖端宽，才是三角形');
        if (bullet.purple) {
            const [red, green, blue] = trail.color;
            assert.ok(blue > red && red > green, `诅咒菇要紫色，现在是 ${trail.color.join(',')}`);
        } else {
            assert.deepEqual([...trail.color], [255, 255, 255], `${bullet.name} 要白色拖尾`);
        }
    }
});

// ── 二、抖动 ──────────────────────────────────────────────────────────────

test('抖动只登记毒箭菇(Y) 与 大嘴花(X)，其余五颗不抖', () => {
    const wobbleOf = (key: string) => zcEffectWobbleOf(bulletPath(key));
    assert.equal(wobbleOf('cardBulletDujuan')?.axis, 'y', '毒箭菇：上下挤');
    assert.equal(wobbleOf('cardBulletMouth')?.axis, 'x', '大嘴花：左右伸');
    for (const key of ['cardBulletPea', 'cardBulletJack', 'cardBulletPeach', 'cardBulletYulin', 'cardBulletCurse']) {
        assert.equal(wobbleOf(key), null, `${key} 不该抖（用户只点了两张）`);
    }
});

test('四个关键帧精确是 1 / 1.05 / 0.95 / 1（等分一个周期）', () => {
    const wobble = { axis: 'y' as const, amount: 0.05, periodSeconds: 0.28 };
    assert.equal(zcBulletWobbleScale(wobble, 0), 1);
    assert.ok(Math.abs(zcBulletWobbleScale(wobble, 0.28 / 3) - 1.05) < 1e-12);
    assert.ok(Math.abs(zcBulletWobbleScale(wobble, 0.28 * 2 / 3) - 0.95) < 1e-12);
    assert.ok(Math.abs(zcBulletWobbleScale(wobble, 0.28 * 0.999) - 1) < 1e-3, '末尾要回到 1，不能停在 0.95');
    //  循环：下一个周期同样的相位给同样的值
    assert.ok(Math.abs(zcBulletWobbleScale(wobble, 0.28 + 0.28 / 3) - 1.05) < 1e-9);
});

test('抖动只动一个轴；非法配置一律当「不抖」而不是 NaN', () => {
    const y = { axis: 'y' as const, amount: 0.05, periodSeconds: 0.28 };
    assert.deepEqual([...zcBulletWobbleScaleXY(y, 0.28 / 3)], [1, 1.05]);
    const x = { axis: 'x' as const, amount: 0.05, periodSeconds: 0.28 };
    assert.deepEqual([...zcBulletWobbleScaleXY(x, 0.28 / 3)], [1.05, 1]);
    assert.deepEqual([...zcBulletWobbleScaleXY(null, 1)], [1, 1]);
    //  🔴 这些值若漏进 setScale 会让整颗子弹消失且不报错 —— 必须收敛成 1。
    assert.equal(zcBulletWobbleScale({ axis: 'y', amount: 0, periodSeconds: 0.28 }, 0.1), 1);
    assert.equal(zcBulletWobbleScale({ axis: 'y', amount: 0.05, periodSeconds: 0 }, 0.1), 1);
    assert.equal(zcBulletWobbleScale({ axis: 'y', amount: Number.NaN, periodSeconds: 0.28 }, 0.1), 1);
    assert.equal(zcBulletWobbleScale({ axis: 'y', amount: 0.05, periodSeconds: Number.POSITIVE_INFINITY }, 0.1), 1);
    //  事件时间倒流（快照还原）不能给出负数相位
    assert.ok(zcBulletWobbleScale(y, -0.05) >= 0.95);
});

// ── 三、两条「表里没有」的入口 ─────────────────────────────────────────────

test('破阵术三张卡换成各自的子弹，其余卡仍用通用箭矢', () => {
    assert.equal(zcLanceEffectPrefabPath('68007'), bulletPath('cardBulletMouth'));
    assert.equal(zcLanceEffectPrefabPath('68009'), bulletPath('cardBulletPeach'));
    assert.equal(zcLanceEffectPrefabPath('68018'), bulletPath('cardBulletCurse'));
    //  没登记的卡（含「没有 unitId」这种脏输入）必须原样退回，不能抛也不能给空串。
    assert.equal(zcLanceEffectPrefabPath('68001'), ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH);
    assert.equal(zcLanceEffectPrefabPath(null), ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH);
    assert.equal(zcLanceEffectPrefabPath(''), ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH);
    assert.deepEqual([...zcLanceEffectPrefabPathsForUnit('68007')], [bulletPath('cardBulletMouth')]);
    assert.deepEqual([...zcLanceEffectPrefabPathsForUnit('68001')], []);
    //  三条覆盖都不许指向「通用箭矢」—— 那等于没换。
    for (const path of Object.values(ZC_LANCE_EFFECT_PREFAB_BY_UNIT)) {
        assert.notEqual(path, ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH);
    }
});

test('毒箭菇陷阱的飞行段换成蘑菇子弹；落地仍是原来的陷阱（机制不动）', () => {
    assert.equal(zcTrapFlightPath('68017'), bulletPath('cardBulletDujuan'));
    //  别的卡（68024 急冻瓜 / 103504 精密陷阱）一点不动
    assert.equal(zcTrapFlightPath('68024'), ZC_TRAP_SPAWN_PREFAB_PATH);
    assert.equal(zcTrapFlightPath('103504'), ZC_TRAP_SPAWN_PREFAB_PATH);
    assert.deepEqual([...zcTrapFlightPathsForUnit('68017')], [bulletPath('cardBulletDujuan')]);
    assert.deepEqual([...zcTrapFlightPathsForUnit('68024')], []);
    assert.deepEqual(Object.keys(ZC_TRAP_FLIGHT_PREFAB_BY_UNIT), ['68017'], '只登记毒箭菇一张卡');
});

test('资源计划收得到两条「表里没有」的弹体（漏收 = 隐形子弹 / 蘑菇凭空出现）', () => {
    const plan = (unitId: string, behaviorKey: string) => buildZCVisualResourcePlan([
        {
            unitId,
            prefabPath: `units/${unitId}`,
            attackProfile: { effectPrefabPath: null, impactEffectPrefabPath: null },
        },
    ], { skillPlans: [{ enabled: true, unitId, behaviorKey }], textOverrides: new Map() });

    const lance = plan('68007', 'skill_params');
    assert.ok(lance.effectPaths.includes(bulletPath('cardBulletMouth')),
        '大嘴花的破阵术弹体没进清单：投枪会变成一根隐形的枪');

    const trap = plan('68017', 'trap_place');
    assert.ok(trap.effectPaths.includes(bulletPath('cardBulletDujuan')),
        '毒箭菇的陷阱飞行段没进清单：只剩落地那半截');

    //  不相关的卡不许被顺带收进来（否则每局多加载几条）。
    const other = plan('68001', 'skill_params');
    assert.ok(!other.effectPaths.includes(bulletPath('cardBulletMouth')));
});

// ── 四、配表 ──────────────────────────────────────────────────────────────

test('配表：普攻 / 机关枪的弹体路径两份产物一致（三写里的后两份）', () => {
    const files = [
        'assets/remoteRef/pvpSkill.json',
        'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
    ];
    const expected: Record<number, string> = {
        30701: bulletPath('cardBulletPea'),
        30801: bulletPath('cardBulletPea'),
        30716: bulletPath('cardBulletYulin'),
        30717: bulletPath('cardBulletJack'),
    };
    for (const file of files) {
        const rows = tableRows(file);
        for (const [skillId, path] of Object.entries(expected)) {
            const row = rows.find((entry) => Number(entry.skillId) === Number(skillId));
            assert.ok(row, `${file} 里没有技能行 ${skillId}`);
            assert.equal(row.effectPrefabPath, path, `${file} 的 ${skillId} 弹体不对`);
        }
    }
});

test('配表：三张卡的破阵术仍在原表行（lanceEvery 有值 ⇒ 车道真的会触发）', () => {
    const rows = tableRows('assets/remoteRef/pvpSkillPlan.json');
    const lanes: Array<[string, number]> = [['68007', 100701], ['68009', 100901], ['68018', 101802]];
    for (const [unitId, chain] of lanes) {
        const hits = rows.filter((row) => String(row.unitId) === unitId
            && Number(row.skillChainId) === chain);
        assert.ok(hits.length > 0, `${unitId} 缺破阵术计划行 ${chain}`);
        for (const row of hits) {
            const params = JSON.parse(String(row.skillParamJson ?? '{}')) as Record<string, number>;
            assert.ok((params.lanceEvery ?? 0) > 0, `${unitId} 的破阵术没有 lanceEvery`);
        }
    }
});

// ── 五、源码守卫 ──────────────────────────────────────────────────────────

test('守卫：两处按单位换美术的入口都真的接上了（不是只写在表里）', () => {
    const trap = readFileSync('assets/script/app/zcds/model/systems/ZCSkillResolutionSystem.ts', 'utf8');
    assert.match(trap, /flightVisualPath: flying \? zcTrapFlightPath\(unit\.unitId\)/,
        'castTrap 必须走 zcTrapFlightPath，直接写 ZC_TRAP_SPAWN_PREFAB_PATH 等于没换');
    assert.ok(!/flightVisualPath: flying \? ZC_TRAP_SPAWN_PREFAB_PATH/.test(trap), '旧写法不许留着');

    const attack = readFileSync('assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts', 'utf8');
    assert.match(attack, /effectPrefabPath: zcLanceEffectPrefabPath\(unitId\)/,
        'lanceProfileOf 必须按单位取弹体');
    assert.ok(!/effectPrefabPath: ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH/.test(attack),
        '投枪弹体不许再写死缺省值');

    const zone = readFileSync('assets/script/app/zcds/model/systems/ZCGroundZoneSystem.ts', 'utf8');
    assert.match(zone, /zone\.angleDegrees = undefined;/,
        '落地必须清掉飞行段朝向，否则陷阱图歪着躺在地上');

    const view = readFileSync('assets/script/app/zcds/view/ZCCombatEffectView.ts', 'utf8');
    assert.match(view, /this\.applyBulletWobble\(event, now\)/, '视图必须每帧应用抖动');
    assert.match(view, /getChildByName\(BULLET_BODY_NODE_NAME\)/, '抖动按 body 这个名字找节点');
    assert.match(view, /this\.restoreWobble\(\);/, '换事件 / 重新 initialize 必须还原基准缩放');
});
