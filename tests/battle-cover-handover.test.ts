/**
 * 「云原地交接」这条链的**结构判据**（2026-11-02 用户口述的重做）。
 *
 * 口径（用户原话）：
 * > 只需要用已有的云，在地块消失的同时从四周移动过来填充（遮挡住地块），
 * > 等待进入匹配界面时（静止在匹配界面下方），匹配成功、战斗资源加载完成时，
 * > 匹配界面瞬间关闭，暴露出底层的云，同步云向四周散开，同步变淡消失
 *
 * 三件事必须同时成立，缺一条就退回旧的"云散完 → 空屏 → 匹配页"：
 *  ① 领地这一侧**不散场**，out 播完 + 回包到了就直接跳匹配；
 *  ② 匹配页在**自己底下**重建同一屏云（第 0 个子节点），并把待机步进接上；
 *  ③ 匹配成功后：先瞬间关界面、等战场资源、再散云、最后才切场景。
 *
 * 行为判据在 `territory-battle-intro.test.ts`（`setBaseStep` / `startRelease` / `tick`）与
 * `matching-controller.test.ts`（交接时序）；这里只钉"接线有没有接上"。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(new URL(`../assets/script/app/${path}`, import.meta.url), 'utf8');
const MAIN = read('main/MainTerritoryMap.ts');
const MAP_VIEW = read('territory/view/TerritoryMapView.ts');
const COMPOSITION = read('bootstrap/matching/MatchingComposition.ts');
const CONTROLLER = read('matching/MatchingController.ts');
const PROCEDURE = read('procedure/ProcedureMatching.ts');

test('★★★领地普通关不许自己散场：回包一到就把云交给匹配页', () => {
    // 判据只认 `mode = match` + 有 `battleParams`（塔防关没有匹配页，必须自己散完再跳）
    const handover = MAIN.slice(MAIN.indexOf('private isCoverHandover'), MAIN.indexOf('private commitBattleNav'));
    assert.ok(handover.includes("mode === 'match'"), '交接判据必须按 mode');
    assert.ok(handover.includes('battleParams'), '没有 battleParams 就没法让匹配页去发开战');
    // `hold` 段里，交接分支必须排在"等战场资源"之前 —— 排在后面就永远轮不到（`match` 没有战场预加载）
    const hold = MAIN.slice(MAIN.indexOf("if (intro.phase === 'hold')"), MAIN.indexOf("intro.phase === 'in'") > 0 ? MAIN.indexOf("if (intro.phase === 'in')") : undefined);
    const handoverAt = hold.indexOf('isCoverHandover');
    const waitAt = hold.indexOf('intro.waited');
    assert.ok(handoverAt > 0, 'hold 段里没有交接分支');
    assert.ok(waitAt > 0, 'hold 段里找不到等资源那段（判据本身过期了）');
    assert.ok(handoverAt < waitAt, '交接必须排在"等目标页资源"之前');
    const branch = hold.slice(handoverAt, hold.indexOf('this.abandonBattleIntro()'));
    assert.ok(branch.includes('this.commitBattleNav(intro.nav)'), '交接要直接跳走去匹配');
    // 交接这一段从头到尾不许碰 `phase`：进了 `in` 就是旧的"先散场再跳"。
    // （判据取到 `abandonBattleIntro()` 为止 —— 再往后就是"等资源 → 散场"那条老路。）
    assert.ok(!branch.includes("phase = 'in'"), '⚠️ 交接这条路**不许**进 in 段（那就是旧的"先散再跳"）');
});

test('★★★交接必须把待机步进带过去，否则切流程那一帧整屏云会换一次脸', () => {
    const commit = MAIN.slice(MAIN.indexOf('private commitBattleNav'), MAIN.indexOf('private watchBattleSwitch'));
    const matching = commit.slice(commit.indexOf('GameRoute.Matching'), commit.indexOf('} else {'));
    assert.ok(matching.includes('coverStep:'), '匹配载荷里没有 coverStep');
    assert.ok(matching.includes('battleIntroCoverStep'), 'coverStep 必须取自地图侧的实时步进');
    assert.ok(MAP_VIEW.includes('get battleIntroCoverStep()'), '地图视图没有暴露步进');
    assert.ok(MAP_VIEW.includes('frameStep'), '步进要来自云盖层自己的 `frameStep`');
});

test('★★★匹配页要在自己底下重建同一屏云（第 0 个子节点，不是盖在界面上）', () => {
    // 用户说的"静止在匹配界面下方"，落到代码就是这一行
    assert.ok(COMPOSITION.includes('setSiblingIndex(0)'), '云必须压到匹配 UI 之下');
    assert.ok(COMPOSITION.includes('cover.setBaseStep(params.coverStep ?? 0)'), '没接步进');
    // 交接进来时云已经是"合拢到位、整层不透明"，不是从头再演一遍 out
    assert.ok(COMPOSITION.includes('cover.apply(1, 1, 0)'), '云的就位状态不对');
    // 只有领地普通关才建云（PVP 匹配底下不该突然出现一屏云）
    assert.ok(COMPOSITION.includes('if (params?.pve) await this.loadCloudFrames(context);'),
        '云帧要在预加载阶段取好，进页时才有云可铺');
    assert.ok(COMPOSITION.includes('if (!params?.pve || !this.cloudFrames.length)'), '建云没有按 pve 收口');
    // 云帧缺了只是"没有云"，不许把匹配本身搞挂
    assert.ok(COMPOSITION.includes('this.cloudFrames = [];'), '加载失败要降级成空数组');
    // 换流程时把云一起带走（`dispose` 而不是 `destroy`：盖层自持的帧引用也要还回去）
    assert.ok(COMPOSITION.includes('this.cover?.dispose()'), 'dispose 没销毁云层');
});

test('★★★「瞬间关闭」只藏 UI：云留着，界面不留半张', () => {
    const hide = COMPOSITION.slice(COMPOSITION.indexOf('private hidePageContent'));
    const body = hide.slice(0, hide.indexOf('\n    }\n'));
    assert.ok(body.includes('child === coverNode'), '关界面时把云也关掉了');
    assert.ok(body.includes('child.active = false'), '必须是瞬间关（不是淡出）：淡出会露出半张界面');
    assert.ok(!body.includes('opacity'), '「瞬间关闭」不许走透明度那条路');
});

test('★★★匹配成功后：关界面 → 等资源 → **先切战场** → 战场挂上才散云', () => {
    const body = CONTROLLER.slice(CONTROLLER.indexOf('private handoffToBattle'),
        CONTROLLER.indexOf('private navigateToBattle'));
    const closeAt = body.indexOf('handoff.closeInstantly()');
    const navigateAt = body.indexOf('this.navigateToBattle()');
    const releaseAt = body.indexOf('handoff.releaseCover()');
    assert.ok(closeAt > 0, '没关界面');
    assert.ok(navigateAt > closeAt, '切战场必须在关界面之后');
    // 🔴 用户 2026-11-02 打回：云散开时底下必须是战场。所以切场要排在散云**之前**。
    assert.ok(releaseAt > navigateAt, '散云必须排在切战场之后（先散就会露黑底）');
    // 切场 + 散云都封在 `enter()` 里，而 `enter` 只由"资源到了"或"超时兜底"两条路触发：
    // 资源没到就切场 = 战场自己弹加载态（用调用点判断，别按文本先后比 —— `enter` 是闭包，定义在前）。
    assert.ok(body.includes('this.session?.ready'), '没有等战场资源');
    assert.ok(body.includes('void ready.then(enter'), '资源到了才切场');
    assert.ok(body.includes('this.options.schedule(enter, handoff.readyTimeout)'), '超时兜底也要切场');
    assert.ok(body.includes('handoff.readyTimeout'), '没有超时兜底');
    assert.ok(body.includes('GameRoute.Main'), '资源失败要有去处（回主界面）');
    // 失败那条路也要散：云已经交接出去了，不散就一直盖着主界面
    const fail = body.slice(body.indexOf('this.options.failed(error)'));
    assert.ok(fail.includes('handoff.releaseCover()'), '回主界面时没散云，一屏云会一直盖着');
    // 跳转只有一处出口，PVP 那条路与交接那条路共用载荷形状
    const navigate = CONTROLLER.slice(CONTROLLER.indexOf('private navigateToBattle'));
    assert.ok(navigate.includes('GameRoute.Battle'), '没找到切战场的出口');
    assert.equal(CONTROLLER.split('GameRoute.Battle').length - 1, 1, '切战场只许一个出口');
});

test('★★★云必须被搬出匹配页：留在页里就活不过 navigate（这就是黑底那一版）', () => {
    // 关界面那一步要顺手把云交给跨流程宿主
    const handOver = COMPOSITION.slice(COMPOSITION.indexOf('private handOverCover'));
    const body = handOver.slice(0, handOver.indexOf('\n    }\n'));
    assert.ok(body.includes('TerritoryBattleCoverOverlay.create'), '没有把云交给跨流程宿主');
    assert.ok(body.includes('this.cover = null'), '所有权没转交（dispose 会把云一起销毁）');
    assert.ok(COMPOSITION.includes('closeInstantly: () => this.handOverCover()'), '交接没走搬云那一步');
    assert.ok(COMPOSITION.includes('releaseCover: () => this.handoffOverlay?.arm()'), '散云没交给宿主');
    // dispose 里那份清理也要按"还是不是自己的云"判断，否则交接完又被销毁
    assert.ok(COMPOSITION.includes('if (this.cover === cover) cover.dispose()'),
        'dispose 会销毁已经交接出去的那层云');
    assert.ok(!COMPOSITION.includes('this.handoffOverlay?.destroy') &&
        !COMPOSITION.includes('this.handoffOverlay!.destroy'), '交接层的销毁归它自己（散完自收）');
    // 战场是 `host.addComponent(ZCGame)` 现挂的，而且 `createGame` 第一行就
    // `this.node.removeAllChildren()` —— 云挂宿主底下会在进战场那一帧被删掉。
    const overlay = read('territory/view/TerritoryBattleCoverOverlay.ts');
    assert.ok(overlay.includes('host.parent'), '覆盖层挂错了地方（会被战场上来的 removeAllChildren 清掉）');
    assert.ok(overlay.includes('setSiblingIndex'), '覆盖层没有排到战场之上');
    assert.ok(overlay.includes('onSwitchSettled'), '覆盖层没等流程切换落定就散云（会散在空屏上）');
    assert.ok(overlay.includes('releaseFinished'), '散完没人收工');
});

test('★★★交接层的云**自己持有帧引用**：匹配页一散，云还要接着画', () => {
    // 2026-11-03 实机：切战场首帧绘制完，渲染管线整屏报
    // `frame should not be invalid, it may have been released` → `getGFXTexture` 空指针。
    // 真因是云的 `SpriteFrame` 属于匹配页那个资源作用域，`onLeave` 里 `dispose()` 把帧
    // `decRef` 掉了，而云已经搬到 `Canvas` 上继续画。
    const cover = read('territory/view/TerritoryBattleCover.ts');
    assert.ok(cover.includes('private held: SpriteFrame[] = []'), '盖层没自己持有帧引用');
    assert.ok(/frame\.addRef\(\)/.test(cover), '注入的云帧必须 addRef（Sprite 不参与引用计数）');
    assert.ok(/frame\.decRef\(\)/.test(cover), '放掉引用要 decRef');
    assert.ok(cover.includes('dispose(): void {'), '缺 `dispose`：销毁节点与还引用要分开');
    assert.ok(!/destroy\(\): void \{\n[\s\S]{0,400}decRef/.test(cover),
        '`destroy` 不能还引用 —— `build` 换视口时先 destroy 再重建，帧还要接着用');
    // 交接层收工 / 被兜底销毁时都要还回去，否则那几帧永远掉不出引用计数。
    const overlay = read('territory/view/TerritoryBattleCoverOverlay.ts');
    assert.ok(overlay.includes('cover?.dispose()'), '交接层收工没还帧引用');
    assert.ok(overlay.includes('this.releaseCover()'), 'finish / onDestroy 没走同一个收尾');
});

test('★★★匹配流程要把入口参数传进预加载（不传就永远没有云帧）', () => {
    assert.ok(PROCEDURE.includes('preload(context, params)'), '流程没把 params 传下去');
    assert.ok(!PROCEDURE.includes('_params'), '参数被丢掉了（下划线前缀 = 没人用）');
});
