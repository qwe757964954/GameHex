import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

const ROOT = join(__dirname, '..');

/** 单位视图的最小桩：一根血条 + prefab 上那几个必填引用（口径同 `tests/zcds-progress.test.ts`）。 */
function unitWatch() {
    const { load, bar, cc } = loadViews();
    const view = new (load('./ZCUnitView').ZCUnitView)();
    const healthBar = bar();
    view.rootTransform = { setContentSize: () => {} };
    view.visualRoot = healthBar.node;
    view.sprite = { enabled: true, spriteFrame: null };
    view.fallback = { node: healthBar.node, clear: () => {}, circle: () => {}, fill: () => {} };
    view.fallbackLabel = { node: healthBar.node, enabled: true, string: '' };
    view.healthBar = healthBar;
    return { view, healthBar, cc, load };
}

/** 拿血条上的白条画布（懒建在 `HealthBar` 下）。 */
function trailOf(healthBar: any) {
    return healthBar.node.children.find((child: any) => child.name === 'ZCDamageTrail') ?? null;
}

function lastRect(cc: any, trail: any) {
    const graphics = trail.getComponent(cc.Graphics);
    return graphics.commands.filter((command: any) => command.kind === 'rect').at(-1) ?? null;
}

// ============================================================
// 一、纯函数：0.13s 时间窗 / smoothstep 收缩 / 区间宽度
// ============================================================

test('白条时间窗 0.13s：两端都慢、单调收窄，非法时间当成「刚开始」', () => {
    const { load } = loadViews();
    const {
        HEALTH_BAR_DAMAGE_TRAIL_SECONDS,
        healthBarDamageTrailScale,
    } = load('./ZCGameViewUtil');

    assert.equal(HEALTH_BAR_DAMAGE_TRAIL_SECONDS, 0.13, '需求给定的时长');

    // 起点满宽、到点收干净（左闭右开：满 0.13s 就没有了）。
    assert.equal(healthBarDamageTrailScale(0), 1);
    assert.equal(healthBarDamageTrailScale(-0.01), 1, '起点之前按「刚开始」画，不出现负宽');
    assert.equal(healthBarDamageTrailScale(0.13), 0);
    assert.equal(healthBarDamageTrailScale(0.2), 0, '过点之后一律 0');
    assert.equal(healthBarDamageTrailScale(Number.NaN), 1, '时间脏了就退化成满宽，别缩成一条错帧');

    // 严格单调收窄。
    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 13; step += 1) {
        const value = healthBarDamageTrailScale(step * 0.01);
        assert.ok(value <= previous, `t=${step * 0.01}s 不该反而变宽`);
        previous = value;
    }

    // smoothstep 的特征：两端速度都为 0（前 1% 几乎没动、最后 1% 几乎已收干净），
    // 这正是「缓动」与线性的区别，也是这条用例要钉住的东西。
    assert.ok(healthBarDamageTrailScale(0.0013) > 0.999, '起步很慢');
    assert.ok(healthBarDamageTrailScale(0.1287) < 0.001, '收尾很慢');
    // 中点正好一半（smoothstep(0.5) = 0.5）。
    assert.ok(Math.abs(healthBarDamageTrailScale(0.065) - 0.5) < 1e-9);
});

test('白条宽度 = 总长 ×（扣血前 − 当前）× 收缩比例，回血/无变化/脏参数一律 0', () => {
    const { load } = loadViews();
    const { healthBarDamageTrailWidth } = load('./ZCGameViewUtil');

    // 100 长、从满血掉到 40%：刚挨打时 60 宽，半程 30，到点 0。
    assert.equal(healthBarDamageTrailWidth(100, 0.4, 1, 0), 60);
    assert.ok(Math.abs(healthBarDamageTrailWidth(100, 0.4, 1, 0.065) - 30) < 1e-9);
    assert.equal(healthBarDamageTrailWidth(100, 0.4, 1, 0.13), 0);

    // 掉血前的比例只取「扣血前的那条边」，不是旧血量本身。
    assert.ok(Math.abs(healthBarDamageTrailWidth(100, 0.7, 0.9, 0) - 20) < 1e-9);

    // 回血 / 没掉血 / 参数非法：不画。
    assert.equal(healthBarDamageTrailWidth(100, 0.9, 0.5, 0), 0, '回血不起白条');
    assert.equal(healthBarDamageTrailWidth(100, 0.5, 0.5, 0), 0, '没掉血不起白条');
    assert.equal(healthBarDamageTrailWidth(0, 0.4, 1, 0), 0, '没有长度');
    assert.equal(healthBarDamageTrailWidth(Number.NaN, 0.4, 1, 0), 0);
    assert.equal(healthBarDamageTrailWidth(100, Number.NaN, 1, 0), 0);

    // 比例先钳到 0~1：扣血前后的值脏了也不该算出超额宽度。
    assert.ok(healthBarDamageTrailWidth(100, -1, 2, 0) <= 100);
});

// ============================================================
// 二、单位血条：扣血那一下起白条、0.13s 内从右往左缩没
// ============================================================

test('单位血条扣血：白色段贴着填充右缘起步，0.13s 收没后关掉画布', () => {
    const { view, healthBar, cc } = unitWatch();
    const unit = { hp: 100, maxHp: 100, battleState: 'idle' };
    const definition = { hero: false };
    const render = (now: number) => view.render({ unit, definition, x: 0, y: 0, now });

    // 满血静置：连画布都不该建（白条是"掉血才有"的东西）。
    render(0);
    assert.equal(trailOf(healthBar), null, '没掉过血不该建白条画布');

    // 挨一下 100 → 60：白条正好盖住「扣掉的那 40%」。
    unit.hp = 60;
    render(1);
    const trail = trailOf(healthBar);
    assert.ok(trail, '掉血后必须有白条画布');
    assert.equal(trail.active, true);
    const totalLength = healthBar.totalLength;
    const fillLeft = healthBar.barSprite.node.position.x;
    const rect = lastRect(cc, trail);
    assert.ok(rect, '白条要真的画出来');
    assert.ok(Math.abs(rect.width - totalLength * 0.4) < 1e-6, `刚挨打时白条是满宽（实际 ${rect.width}）`);
    // 🔴 左缘 = 填充条的右缘（不是填充左边）：白条覆盖的是**被扣掉**的那一段。
    assert.ok(Math.abs(rect.x - (fillLeft + totalLength * 0.6)) < 1e-6,
        '白条左缘必须齐着填充右缘');
    assert.equal(rect.height, view.barFillHeight, '白条高度 = 填充条高度（不另行放大）');
    // 垫在填充条下面：子节点序 = 渲染顺序，重叠只可能是亚像素，由填充压住白条。
    assert.equal(healthBar.node.children[0], trail, '白条要是 HealthBar 的第一个子节点');

    // 半程：smoothstep(0.5) = 0.5 ⇒ 宽度减半（左缘不动，右缘往左走）。
    render(1.065);
    const half = lastRect(cc, trail);
    assert.ok(Math.abs(half.width - totalLength * 0.2) < 1e-6, `半程剩一半（实际 ${half.width}）`);
    assert.ok(Math.abs(half.x - rect.x) < 1e-6, '左缘钉在填充右缘：只有右缘在动');

    // 0.13s 到点：画布关掉、路径清空。
    render(1.13);
    assert.equal(trail.active, false, '0.13s 后必须收干净');
    assert.equal(trail.getComponent(cc.Graphics).commands.length, 0, '收手要 clear，别留着上一帧的路径');
});

test('单位血条扣血：白条中途再挨打就按「新的填充右缘 → 这次扣血前的边」重新计时', () => {
    const { view, healthBar, cc } = unitWatch();
    const unit = { hp: 100, maxHp: 100, battleState: 'idle' };
    const definition = { hero: false };
    const render = (now: number) => view.render({ unit, definition, x: 0, y: 0, now });

    render(0);
    unit.hp = 60;
    render(1);
    const trail = trailOf(healthBar);
    const totalLength = healthBar.totalLength;
    const fillLeft = healthBar.barSprite.node.position.x;

    // 白条还在收（1.05s，已缩掉一部分）时又掉血 60 → 30。
    unit.hp = 30;
    render(1.05);
    const rect = lastRect(cc, trail);
    // 这次的白条只覆盖「60% → 30%」这 30%，且从**当前**填充右缘起步。
    assert.ok(Math.abs(rect.width - totalLength * 0.3) < 1e-6, `新白条只覆盖这一下扣的血（实际 ${rect.width}）`);
    assert.ok(Math.abs(rect.x - (fillLeft + totalLength * 0.3)) < 1e-6, '起点跟着填充右缘一起左移');
    assert.equal(trail.active, true);
});

test('单位血条：回血与「血量不变的重渲染」都不起白条', () => {
    const { view, healthBar, cc } = unitWatch();
    const unit = { hp: 100, maxHp: 100, battleState: 'idle' };
    const definition = { hero: false };
    const render = (now: number) => view.render({ unit, definition, x: 0, y: 0, now });

    render(0);
    unit.hp = 60;
    render(1);
    render(1.2);                       // 0.13s 之后白条已收干净
    const trail = trailOf(healthBar);
    assert.equal(trail.active, false);

    // 回血（60 → 90）不该冒出白条。
    unit.hp = 90;
    render(2);
    assert.equal(trail.active, false, '回血不是「扣血」');
    assert.equal(trail.getComponent(cc.Graphics).commands.length, 0);
});

// ============================================================
// 三、复用复位 + 接线守卫
// ============================================================

test('白条复位：换单位/换局后第一帧满血，不许带着上一条命的白条', () => {
    const { load, bar } = loadViews();
    const { ZCHealthBarDamageTrail } = load('./ZCHealthBarDamageTrail');
    const healthBar = bar();
    const trail = new ZCHealthBarDamageTrail();

    // 建立基线后掉血，白条出现；返回值就是「这一帧还画着」。
    assert.equal(trail.render(healthBar, 1, 0), false, '第一帧只记基线');
    assert.equal(trail.render(healthBar, 0.5, 1), true, '掉血那一帧起白条');
    assert.equal(trail.render(healthBar, 0.5, 1.065), true, '半程仍在动');
    const node = healthBar.node.children.find((child: any) => child.name === 'ZCDamageTrail');
    assert.equal(node.active, true);

    // 0.13s 到点：返回 false（调用方据此出队），画布关掉。
    assert.equal(trail.render(healthBar, 0.5, 1.13), false);
    assert.equal(node.active, false);

    // 复位后重新给满血：上一帧的 `lastRatio` 不能留在 0.5 上再算出一条白条。
    trail.render(healthBar, 0.5, 1.5);
    trail.reset();
    assert.equal(trail.render(healthBar, 1, 2), false, '复位后第一帧满血不该有白条');
    assert.equal(node.active, false);

    // 复位是幂等的（单位可能连续复位两次）。
    trail.reset();
    trail.reset();
    assert.equal(node.active, false);
});

test('地块条的白条挂逐帧集合：静态刷新登记、动态帧推进（0.13s 比 0.15s 节流还短）', () => {
    const world = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCGameRenderWorld.ts'), 'utf8');
    const hexView = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCHexView.ts'), 'utf8');

    // 视图侧：静态刷新算比例 + 登记，动态帧只按时间轴重算宽度。
    assert.match(hexView, /isHealthBarTrailAnimating\(\): boolean/, '要能问"还在收吗"');
    assert.match(hexView, /advanceHealthBarTrail\(now: number\): boolean/, '要能被动态帧推进');
    assert.match(hexView, /this\.lastBarRatio = healthBarRatio\(barHp, barMaxHp\);/, '比例在静态刷新里算一次');

    // 渲染世界侧：集合 + 登记 + 出队 + 换局清空。
    assert.match(world, /private readonly healthBarTrailHexes = new Set<number>\(\)/);
    assert.match(world, /if \(view\.isHealthBarTrailAnimating\(\)\) this\.healthBarTrailHexes\.add\(state\.id\)/,
        '静态刷新时把刚掉血的格子挂进集合');
    assert.match(world, /this\.healthBarTrailHexes\.clear\(\);/, '换局/换图必须清集合');

    // 🔴 必须在 renderDynamic 里跑：留在 renderStatic（0.15s）里会"闪一帧就没"。
    const dynamic = world.slice(world.indexOf('renderDynamic(frame: ZCGameRenderFrame, events'),
        world.indexOf('renderDynamic(frame: ZCGameRenderFrame, events') + 1200);
    assert.match(dynamic, /this\.renderHealthBarTrails\(frame\);/, '白条推进必须挂在 renderDynamic');
    assert.ok(!/renderStatic\(frame: ZCGameRenderFrame\)[\s\S]{0,300}renderHealthBarTrails/.test(world),
        '不许挂回静态刷新');
});

test('接线：单位条与地块条都走同一个白条类，且不许退回 tween / 定时器', () => {
    const unitView = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCUnitView.ts'), 'utf8');
    const hexView = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCHexView.ts'), 'utf8');
    for (const [name, source] of [['ZCUnitView', unitView], ['ZCHexView', hexView]] as const) {
        assert.match(source, /private readonly damageTrail = new ZCHealthBarDamageTrail\(\)/, `${name} 要持有白条实例`);
        assert.match(source, /this\.damageTrail\.reset\(\)/, `${name} 复用/换局必须复位白条`);
        assert.match(source, /this\.damageTrail\.render\(/, `${name} 每帧要把比例喂给白条`);
        assert.match(source, /healthBarRatio\(/, `${name} 的比例要取共享口径，别自己再钳一遍`);
    }

    const trailSource = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCHealthBarDamageTrail.ts'), 'utf8');
    assert.ok(!/tween\(/.test(trailSource), '白条是纯函数时间轴，禁止 tween');
    assert.ok(!/schedule\(|setTimeout\(/.test(trailSource), '禁止定时器：掉帧会漂');
    // 时长真源只有一处：这份实现引用 ZCGameViewUtil 的常量，不许自己再定义一个 0.13。
    assert.match(trailSource, /HEALTH_BAR_DAMAGE_TRAIL_SECONDS/, '要引用共享时长常量');
    assert.ok(!/(const|let)\s+\w*(TRAIL|DAMAGE)\w*SECONDS\s*=/.test(trailSource),
        '别在实现里另写一份时长');
});
