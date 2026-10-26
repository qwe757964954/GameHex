import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * HUD 神器图标必须与棋盘资源格显示**同一件神器**。
 *
 * 起因（截图自证）：棋盘上的`artifact_charge` 格显示「霜封冰刃」（本局携带的神器），
 * 而 HUD 右下角的神器按钮显示一把石锤 —— 那是 prefab 硬绑的 `image/gameui/zd_faqi.png`
 * （91×94 的**通用「神器」按钮图**），与本局神器毫无关系。
 *
 * 判据走**文件口径 + prefab 绑定**（这两个是「不一致」能被静态逮住的地方）：
 * 真实缩放/渲染在引擎里验（编辑器 + CDP 探针），单测只锁住「同一份帧」这条契约。
 */

/** prefab 上原先硬绑的通用图。 */
const GENERIC_ARTIFACT_ART = 'assets/resources/image/gameui/zd_faqi.png';
/** 本局携带神器的图（`pvpArtifact[].icon` = 霜封冰刃）。 */
const CARRIED_ARTIFACT_ART = 'assets/resources/image/artifact/霜封冰刃.png';

function readSource(path: string): string {
    return readFileSync(path, 'utf8');
}

test('HUD 神器图标不再用 prefab 硬绑的通用图，改吃本局携带神器的帧', () => {
    assert.ok(existsSync(GENERIC_ARTIFACT_ART), '这张通用图应该还在（我只是不再用它）');
    assert.ok(existsSync(CARRIED_ARTIFACT_ART), '本局神器的图必须存在');

    const hud = readSource('assets/script/app/zcds/view/ZCGameHUDView.ts');
    // 有 setter：接收帧并按 HUD 目标尺寸缩放（TRIMMED 会把节点撑成 230）。
    assert.match(hud, /setArtifactFrame\s*\(frame:\s*SpriteFrame\s*\|\s*null\)/,
        'HUD 必须提供注入本局神器帧的入口');
    assert.match(hud, /ARTIFACT_ICON_TARGET_SIZE/,
        '换帧后必须缩放回按钮尺寸 —— ArtifactIcon 是 TRIMMED，会被 230×230 撑爆');
    // 不能再有对通用图的**代码**引用（注释里提一嘴来源是允许的）⇒ 先剥注释再查（规则 104）。
    const code = hud.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!code.includes('zd_faqi'), '代码里不该再按名字引用那张通用神器图');

    const game = readSource('assets/script/app/zcds/ZCGame.ts');
    // 🔴 2026-10-23 回退：HUD 神器按钮**任何局**都喂本局神器的帧。
    // 首版错误地把自选地图局也换成 whh 问号 —— 那个按钮显示的是玩家自己的神器，
    // 不是地图里随机的资源，遮蔽它没有意义。真正要遮蔽的是棋盘上的中立资源格
    // （见 `zcds-neutral-resource-mask.test.ts`）。
    assert.match(game, /hudView\.setArtifactFrame\(prepared\.artifactIconFrame\)/,
        'ZCGame 必须把已加载的神器帧喂给 HUD（所有局同一口径，不因自选局换成问号）');
    assert.ok(!/setArtifactFrame\(selectingSpawn/.test(game),
        'HUD 神器按钮不许按 cityMode 分支（2026-10-23 已纠正）');
});

test('棋盘资源格与 HUD 共用同一份神器帧 —— 两者都由 artifactIconFrame 驱动', () => {
    const world = readSource('assets/script/app/zcds/view/ZCGameRenderWorld.ts');
    // 棋盘侧：地块视图拿的是 options.artifactIconFrame。
    assert.match(world, /setArtifactChargeFrame\(this\.options\.artifactIconFrame/,
        '棋盘资源格必须吃同一份 artifactIconFrame');
    const game = readSource('assets/script/app/zcds/ZCGame.ts');
    // ⚠️ 2026-10-23 对齐现状：`ZCGame` 不再把帧回写到自己字段（`this.artifactIconFrame` 已不存在，
    // 这条断言此前一直是红的），而是直接把 `prepared.artifactIconFrame` 递给 HUD 与渲染层 ——
    // 「同源」这条契约没变，只是路径短了一步。
    assert.match(game, /artifactIconFrame:\s*prepared\.artifactIconFrame/,
        '渲染层 options 传的也是同一份');
    const loader = readSource('assets/script/app/zcds/application/ZCGameLoader.ts');
    assert.match(loader, /this\.loadArtifactIconFrame\(scope\)/,
        '这一份来自 ZCGameLoader 预加载 —— 不是各自去读表/各自硬绑');
});

test('prefab 侧：ArtifactIcon 仍是 TRIMMED，所以代码里必须缩放而不是改 sizeMode', () => {
    // 这条是给「后人」看的护栏：改sizeMode 会让 prefab 与代码两处口径打架。
    const prefab = readFileSync('assets/resources/ui/game/ZCGameHUD.prefab', 'utf8');
    assert.match(prefab, /"artifactIcon"/, 'HUD prefab 上应有 ArtifactIcon 引用');
    assert.match(prefab, /"_sizeMode":\s*1/, 'ArtifactIcon 的 sizeMode 应仍是 TRIMMED(1)');
});