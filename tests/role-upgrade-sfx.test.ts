/**
 * 养成「升级成功 / 升级失败」通用反馈（用户 2026-11-26）。
 *
 * 五条需求：卡牌升级界面展示 / 野怪巡逻宝箱升级（成功与失败）/ 装备升级 / 装备强化 / 宝石镶嵌成功。
 *
 * ## 为什么值得钉
 *
 * 这一整条链**每一环错了都不报错**：
 *
 *   · 音效 key 不在 `audioConfig` ⇒ `AudioMgr.getClipPath` 返回空串，`playSound` 静默 `return null`；
 *   · mp3 没进 `resources` ⇒ 同上（只在控制台留一行 warn）；
 *   · `refSmallAll` 漏改 ⇒ 表里有、游戏里没有（运行时 `RefUtil` 读的是那份合并表）；
 *   · 字特效动画名抄错（`shengji` / `shengjie` 一字之差）⇒ spine 只打行日志，屏上什么都没有；
 *   · 播完不收节点 ⇒ 字停在最后一帧、一直糊在屏幕中间。
 *
 * 所以两头都钉：**配置落点**（三份 JSON + 磁盘 mp3）与**每个入口播哪个 key / 哪条动画**。
 * 源表 `Y-音频.xlsx` 由 `tools/config/patch_audio_config.py` 自带回读守卫，这里不重复解析 zip。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';
import { GAME_AUDIO } from '../assets/script/app/ResConst';
import {
    UI_UPGRADE_ANIMATION,
    UI_UPGRADE_FX_PREFAB,
    UI_UPGRADE_FX_SECONDS,
} from '../assets/script/app/common/UiUpgradeFxTable';

const SUCCESS_KEY = '升级成功通用音效';
const FAILURE_KEY = '升级失败通用音效';

const read = (path: string): string => readFileSync(path, 'utf8');
const EQUIP_PAGE_SRC = read('assets/script/app/role/EquipEvolvePage.ts');
const CARD_PAGE_SRC = read('assets/script/app/card/CardUpgradedPage.ts');
const MONSTER_PANEL_SRC = read('assets/script/app/territory/view/TerritoryMonsterBoxPanel.ts');
const GEM_POPUP_SRC = read('assets/script/app/role/RoleGemInfoPopup.ts');
const ROLE_CONTROLLER_SRC = read('assets/script/app/role/RoleController.ts');
const FX_SRC = read('assets/script/app/common/UiUpgradeFx.ts');

// ============================================================
// A. 音效配置：三份 JSON 都要有 + mp3 真在磁盘上
// ============================================================

test('A1｜`ResConst` 的两条路径就是表里的两条（`resources://塔防/音效/<名>`）', () => {
    assert.equal(GAME_AUDIO.upgradeSuccess, `resources://塔防/音效/${SUCCESS_KEY}`);
    assert.equal(GAME_AUDIO.upgradeFailure, `resources://塔防/音效/${FAILURE_KEY}`);
});

test('A2｜远端 / client / refSmallAll 三处都登记了这两条（少一处 = 表里有、游戏里没有）', () => {
    const remote = JSON.parse(read('assets/remoteRef/audioConfig.json')) as Array<{ key: string; value: string }>;
    const byKey = new Map(remote.map((row) => [row.key, row.value]));
    assert.equal(byKey.get(SUCCESS_KEY), GAME_AUDIO.upgradeSuccess);
    assert.equal(byKey.get(FAILURE_KEY), GAME_AUDIO.upgradeFailure);

    // 转表产物（策划改表 → 导出，客户端与工程内两份必须一致）
    const client = JSON.parse(
        read('D:/Alan/Project/POW/doc/塔防数据配置/json/client/audioConfig.json'),
    ) as Array<{ key: string; value: string }>;
    const clientByKey = new Map(client.map((row) => [row.key, row.value]));
    assert.equal(clientByKey.get(SUCCESS_KEY), GAME_AUDIO.upgradeSuccess);
    assert.equal(clientByKey.get(FAILURE_KEY), GAME_AUDIO.upgradeFailure);

    // 运行时真读这一份（`RefUtil` 的合并小表）
    const small = JSON.parse(read('assets/remoteRef/refSmallAll.json')) as {
        audioConfig: { k: string[]; v: unknown[][] };
    };
    const columns = small.audioConfig.k;
    const keyAt = columns.indexOf('key');
    const valueAt = columns.indexOf('value');
    const rows = new Map(small.audioConfig.v.map((row) => [String(row[keyAt]), String(row[valueAt])]));
    assert.equal(rows.get(SUCCESS_KEY), GAME_AUDIO.upgradeSuccess);
    assert.equal(rows.get(FAILURE_KEY), GAME_AUDIO.upgradeFailure);
});

test('A3｜两条 mp3 真在 `resources` 里（键对了但文件没进包 = 静默无声）', () => {
    for (const key of [SUCCESS_KEY, FAILURE_KEY]) {
        const rel = `塔防/音效/${key}.mp3`;
        assert.ok(existsSync(assetPath(rel)), `${rel} 不在磁盘上`);
    }
});

// ============================================================
// B. 字特效素材：预制 + 三条动画名
// ============================================================

test('B1｜动画名就是 `shengduan.skel` 里那三条，不要凭印象写', () => {
    // 二进制 skel：动画名是长度前缀 + 明文，直接按明文扫（同 `zcds` 扫 skel 的老办法）
    const names = new Set(
        read('assets/resources/skel/UI升级升星升阶特效字/shengduan.skel')
            .toString('latin1')
            .match(/sheng[a-z]+/g) ?? [],
    );
    assert.ok(names.has('shengduan'), '骨架名应仍是 shengduan');
    for (const animation of Object.values(UI_UPGRADE_ANIMATION)) {
        assert.ok(names.has(animation), `骨架里没有动画「${animation}」`);
    }
    // 只有三条 —— 多写一条「猜的名字」在 spine 里只是静默不播
    assert.equal(Object.keys(UI_UPGRADE_ANIMATION).length, 3);
});

test('B2｜预制路径与巡逻宝箱那份同一个壳子，时长够素材播完又不拖沓', () => {
    // 与 `tests/territory-monster-box-upgrade-fx.test.ts` 钉的是同一个预制，别各造一份
    assert.equal(UI_UPGRADE_FX_PREFAB, 'ui/territory/TerritoryMonsterBoxUpgradeFx');
    assert.ok(existsSync(assetPath(`${UI_UPGRADE_FX_PREFAB}.prefab`)), '预制不在包里');
    assert.ok(UI_UPGRADE_FX_SECONDS >= 1.07, `收起时刻 ${UI_UPGRADE_FX_SECONDS}s 比素材 1.07s 还短`);
    assert.ok(UI_UPGRADE_FX_SECONDS <= 1.4, `收起太晚（${UI_UPGRADE_FX_SECONDS}s）⇒ 字停在屏幕中间显脏`);
});

test('B3｜播放器：播一次 + 到点收 + 屏正中置顶', () => {
    assert.match(FX_SRC, /skeleton\.setAnimation\(0, animation, false\)/, '末位必须是 false（只播一次）');
    assert.match(FX_SRC, /this\.hideAt = performance\.now\(\) \+ UI_UPGRADE_FX_SECONDS \* 1000/,
        '收起时刻按登记的时长算，别在播放器里另写一个数');
    assert.match(FX_SRC, /public step\(\): void \{[\s\S]{0,320}?this\.node\.active = false/,
        '到点必须把字收起来（loop=false 的骨架会停在最后一帧）');
    assert.match(FX_SRC, /node\.setSiblingIndex\(host\.children\.length - 1\)/, '排到兄弟最后才压得住面板');
    assert.match(FX_SRC, /transform\.width \* \(0\.5 - transform\.anchorX\)/,
        '居中按宿主内容矩形反算，不能硬写 (0,0)');
    // 首次打开点得快：预制还没到 ⇒ 记住动画名，加载完补播一次（否则「成功但屏上没字」）
    assert.match(FX_SRC, /if \(!node\) \{\s*this\.pending = animation;/);
    assert.match(FX_SRC, /if \(pending && this\.prefab\) this\.play\(pending\);/);
    assert.match(FX_SRC, /public reset\(\): void \{\s*this\.hideAt = 0;\s*this\.pending = null;/,
        '换作用域时挂起的补播也要清掉');
});

// ============================================================
// C. 五个入口各自播什么
// ============================================================

test('C1｜卡牌升级界面：展示即播「升级成功」，且不重复播', () => {
    assert.match(CARD_PAGE_SRC,
        /protected onOpen\(userData\?: ICardUpgradedContent\): void \{[\s\S]{0,600}?AudioMgr\.instance\.playSound\(GAME_AUDIO\.upgradeSuccess, this\.resourceScope\)/,
        'onOpen 里要播一次通用「升级成功」');
    assert.equal(CARD_PAGE_SRC.match(/playSound\(GAME_AUDIO\.upgradeSuccess/g)?.length, 1,
        '这条弹窗只该在打开时播一次（时间轴里再播就是叠音）');
});

test('C2｜巡逻宝箱：成功 = 升级成功音，失败 = 升级失败音，同一拍', () => {
    assert.match(MONSTER_PANEL_SRC,
        /roll\.success \? GAME_AUDIO\.upgradeSuccess : GAME_AUDIO\.upgradeFailure/,
        '成功/失败必须是两条不同的音');
    assert.match(MONSTER_PANEL_SRC,
        /private notifyRollSettled\(\): void \{[\s\S]{0,700}?AudioMgr\.instance\.playSound\(/,
        '音效要挂在摇奖落定那一拍（回包时播 = 剧透）');
    assert.match(MONSTER_PANEL_SRC, /if \(this\.closing\) return;/, '关闭途中不播（节点马上跟着销毁）');
});

test('C3｜装备升级用「升级成功」字、装备强化用「升阶成功」字，两者都配通用成功音', () => {
    // 强化（单件 + 一键）→ rankUp；升级（升品页签）→ levelUp
    const buildBlock = EQUIP_PAGE_SRC.slice(
        EQUIP_PAGE_SRC.indexOf('private async onBuildClick'),
        EQUIP_PAGE_SRC.indexOf('private async onUpClick'),
    );
    assert.match(buildBlock, /this\.playGrowthSuccess\(UI_UPGRADE_ANIMATION\.rankUp\)/,
        '「强化」要播「升阶成功」');
    const upBlock = EQUIP_PAGE_SRC.slice(EQUIP_PAGE_SRC.indexOf('private async onUpClick'));
    assert.match(upBlock, /this\.playGrowthSuccess\(UI_UPGRADE_ANIMATION\.levelUp\)/,
        '「升级」要播「升级成功」');
    // 统一出口：音效 + 字特效一把起
    assert.match(EQUIP_PAGE_SRC,
        /private playGrowthSuccess\(animation: UiUpgradeAnimation\): void \{\s*void AudioMgr\.instance\.playSound\(GAME_AUDIO\.upgradeSuccess, this\.resourceScope\);\s*this\.upgradeFx\?\.play\(animation\);/,
        '成功的两件反馈必须在同一个出口，别只在某个按钮上补音效');
    // 每次打开重拉（作用域跟着 open 换），销毁/交还时收干净
    assert.match(EQUIP_PAGE_SRC, /onOpen\([\s\S]{0,900}?this\.upgradeFx\?\.reset\(\);[\s\S]{0,200}?this\.upgradeFx\?\.load\(this\.assets\);/);
    assert.match(EQUIP_PAGE_SRC, /public _internalReleaseResources\(\): void \{[\s\S]{0,200}?this\.upgradeFx\?\.reset\(\);/);
    assert.match(EQUIP_PAGE_SRC, /public update\(\): void \{[\s\S]{0,200}?this\.upgradeFx\?\.step\(\);/,
        'update 里要推进「到点收起来」');
});

test('C4｜宝石镶嵌成功播通用成功音；卸下不播', () => {
    assert.match(GEM_POPUP_SRC,
        /private playInlaidSound\(\): void \{\s*FW\.playSound\(GAME_AUDIO\.upgradeSuccess\);/);
    // 镶嵌 / 替换三处（空槽镶嵌、行内替换、两栏更换面板）都要播
    assert.equal(GEM_POPUP_SRC.match(/this\.playInlaidSound\(\);/g)?.length, 3,
        '镶嵌、替换、更换面板三处成功回调各播一次');
    // 卸下那条路径不播（否则「卸下成功」也响升级音）
    const downBlock = GEM_POPUP_SRC.slice(GEM_POPUP_SRC.indexOf('private async downSocketGem'));
    assert.doesNotMatch(downBlock, /playInlaidSound\(\)/);
    // 角色页那套（背包选宝石 → 镶嵌）走控制器的 `IRoleGemOperations.change`：
    // 组合层包一层，落定成功后播；卸下不播。控制器本身不引 `AudioMgr`（链上带 cc，node 用例会跑不起来）。
    const composition = read('assets/script/app/bootstrap/main/MainPageComposition.ts');
    assert.match(composition,
        /change: async change => \{[\s\S]{0,400}?const status = await roleRepository\.changeGem\(change, roleCaller\);[\s\S]{0,200}?if \(status === 'ok' && change\.kind !== 'down'\) FW\.playSound\(GAME_AUDIO\.upgradeSuccess\);/,
        '组合层必须把「镶嵌成功」接到真实播放，且卸下不响');
    assert.doesNotMatch(ROLE_CONTROLLER_SRC, /AudioMgr|playSound/,
        '控制器不许自己引音频（`AudioMgr` 带 cc）');
});
