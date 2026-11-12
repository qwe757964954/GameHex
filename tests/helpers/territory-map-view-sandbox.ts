import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as mvcEvents from '../../assets/script/app/territory/application/TerritoryEvents';
import * as territoryBattleApproachModule from '../../assets/script/app/territory/model/TerritoryBattleApproach';
import * as territoryChestBubbleModule from '../../assets/script/app/territory/model/TerritoryChestBubble';
import * as territoryCostShortfallModule from '../../assets/script/app/territory/model/TerritoryCostShortfall';
import * as territoryLevelBubbleModule from '../../assets/script/app/territory/model/TerritoryLevelBubble';
import * as territoryNodeUIModule from '../../assets/script/app/territory/model/TerritoryNodeUI';
import * as territoryPreviewCinemaModule from '../../assets/script/app/territory/model/TerritoryPreviewCinema';
import * as territoryUnlockTransitionModule from '../../assets/script/app/territory/model/TerritoryUnlockTransition';

/**
 * 把 `TerritoryMapView.ts` 装进 `vm` 沙箱（桩表**只此一份**）。
 *
 * 谁要跑地图视图的渲染分支（随机格 / 站点格 / 颜色判据）都从这里拿类，
 * 别再各自抄一份 190 行的桩表 —— 抄一份就是"新增 import 时只补了一边"，
 * 另一边以 `Unexpected dependency` 红给你看。
 *
 * ⚠️ 新增 MapView 的 import 时**必须**在这里补桩，否则所有引用者一起红。
 */
export function loadTerritoryMapViewClass(): any {
    const source = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        experimentalDecorators: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === 'cc') return {
                _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
                Component: class {},
                // `paintHexes` 把地皮色写回绝对白（状态不再靠染色）⇒ 桩要提供 `Color.WHITE`。
                Color: { WHITE: { r: 255, g: 255, b: 255, a: 255 } },
                // 2026-11-11：坐标换算的行为测试会走到 `new Vec3()`（宿主局部坐标），
                // 桩只需要可构造；真实矩阵由测试自己的假 UITransform 提供。
                Vec3: class { constructor(public x = 0, public y = 0, public z = 0) {} },
                // `mountRewardFxLayer` 的行为测试会真的建一个顶层节点；只覆盖它用到的方法。
                Node: class {
                    isValid = true;
                    layer = 0;
                    children: any[] = [];
                    parent: any = null;
                    siblingIndex = -1;
                    destroyed = 0;
                    constructor(public name = '') {}
                    setParent(parent: any) { this.parent = parent; parent.children.push(this); }
                    addComponent() { return { setContentSize() {} }; }
                    setSiblingIndex(index: number) { this.siblingIndex = index; }
                    destroy() { this.destroyed += 1; this.isValid = false; }
                },
            };
            if (id.endsWith('/HexGridLayout')) return { HEX_GRID_IMAGE_SIZE: 128 };
            // 2026-10-15 起 MapView 不再 import `TerritoryMapConfig` 的运行时值
            // （两步式名单连同 `isTerritoryTwoStepCell` 已删除，关卡一律按站点类型判定）
            // ⇒ 这里不需要再给 TerritoryMapConfig 打桩。
            // `bottomAnchor` 判定（69008~69015 底部对齐）由 TerritoryMapView 调用，
            // 桩里必须给函数，否则 `undefined is not a function`；本夹具只关心文案 ⇒ 恒 false。
            if (id === './TerritoryStationView') {
                // `setConditionSpawnScale`：「未解锁 → 可激活」的 1s 过渡会往站点视图写价格系数，
                // 桩上必须有这个方法，否则锁一消失就 `is not a function`（真视图在
                // `TerritoryStationView` 里，曲线由 `territory-unlock-transition` 单测）。
                return { TerritoryStationView: class { setConditionSpawnScale() {} }, territoryUsesBottomAnchor: () => false };
        }
        if (id === './TerritoryResourceGainView') return { TerritoryResourceGainView: class {} };
        // 随机格「飞向英雄按钮」（2026-11-10 需求 ②）：夹具只关心站点文案，给个空壳即可。
        if (id === './TerritoryHeroFlight') return { TerritoryHeroFlight: class {} };
        // 喷发粒子（2026-10-16 row17）：夹具只关心站点文案，给个空壳即可。
        if (id === './TerritoryGainBurst') return {
            TERRITORY_GAIN_BURST_NODE: 'GainBurst',
            TerritoryGainBurst: class {},
        };
        // 飘字分流常量（银币 7 / 体力 9）与落点间距：夹具只关心站点文案，给空壳即可。
        if (id.endsWith('/TerritoryResourceGain')) return {
            TERRITORY_GAIN_STACK_GAP_PX: 40,
            TERRITORY_GAIN_START_LIFT_PX: 40,
            TERRITORY_SILVER_RES_ID: 7,
            TERRITORY_STAMINA_RES_ID: 9,
        };
        // 翻格表现（与对局共用曲线）：夹具只关心站点文案，给一个空壳即可。
        if (id === './TerritoryHexFlip') return {
            TerritoryHexFlip: class {
                setEffect() {}
                step() { return false; }
                play() { return false; }
                reset() {}
                isPlaying() { return false; }
            },
        };
        if (id === './TerritoryTheme') return {
            TERRITORY_COLORS: {
                gold: 'gold', locked: 'locked', cleared: 'cleared', danger: 'danger', randomConditionText: 'red',
                randomAvailableText: 'white',
            },
            TERRITORY_STATION_STATE: {
                owned: 'owned', exploring: 'exploring', available: 'available', locked: 'locked',
            },
            territoryStationTint: () => 'gold',
            territoryBossTint: () => 'danger',
            territoryUnboundTint: () => 'async-brown',
        };
        if (id.endsWith('/TerritoryTexts')) return {
            TERRITORY_TEXTS: {
                randomResource: '随机资源',
                openCost: (silver: number, stamina: number) => `${silver}银 ${stamina}体`,
            },
            TERRITORY_UNBOUND_TYPE_NAMES: { fixedResource: '固定资源点' },
        };
        // 事件契约：纯常量表，给桩（与 `view/TerritoryEvents.ts` 同值）。
        if (id === './TerritoryEvents') return {
            TERRITORY_EVENTS: {
                STATION_CLICK: 'territory:station-click',
                PREVIOUS_CHAPTER: 'territory:previous-chapter',
                NEXT_CHAPTER: 'territory:next-chapter',
                DETAIL_CLOSE: 'territory:detail-close',
                DETAIL_START: 'territory:detail-start',
            },
        };
        // MapView 按站点类型命名常量判定（2026-10-19 起），需运行时值桩。
        if (id === '../model/TerritoryMapConfig') return {
            TERRITORY_SITE_TYPE: {
                stage: 'stage', boss: 'boss', asyncPvp: 'asyncPvp',
                fixedResource: 'fixedResource', bonus: 'bonus',
            },
        };
        // 内容层留白（2026-10-21）：`syncContentSize` 现在把「地图包围盒 + 四周留白」写进
        // 内容层，留白归 `TerritoryMapLayout` 统一算。本用例不校验尺寸，桩只保证宽度高度可用。
        if (id.endsWith('/TerritoryMapLayout')) return {
            // 2026-10-27：`contentPaddingBottom` 的初值直接取这个常量、偏移取它的一半，
            // 桩缺了会让字段变 `undefined`（尺寸算出 NaN，用例看着"莫名其妙整片红"）。
            TERRITORY_MAP_CONTENT_PADDING: 300,
            // 2026-10-27：顶部留白也是运行时值（`(bottom − top)/2` 决定内容层偏移），
            // 桩缺了同样会让偏移变 NaN ⇒ 一并给 0。
            TERRITORY_MAP_CONTENT_PADDING_TOP: 0,
            territoryMapContentShiftY: (padding = 300, top = 0) => (padding - top) / 2,
            territoryMapContentSize: (layout: { width: number; height: number }) => ({
                width: layout.width,
                height: layout.height,
            }),
        };
        // 开箱表演 / 点击反馈（2026-10-22）：`TerritoryMapView` 新增的两个表现层，
        // 与本用例关注的渲染分支无关 ⇒ 给空壳（它们的曲线在 `territory-chest-animation`
        // / `territory-tap-feedback` 里单独测）。
        if (id === './TerritoryChestView') return { TerritoryChestView: class {} };
        if (id === './TerritoryTapFeedback') return { TerritoryTapFeedback: class {} };
        // 新地块生成（2026-10-22）：本用例只跑 `syncStations` 的「随机格用哪套图」分支，
        // 进场动画不参与判据 ⇒ 空壳（曲线在 `territory-hex-spawn` 里单独测）。
        if (id === './TerritoryHexSpawn') return {
            TerritoryHexSpawn: class {
                isPlaying() { return false; }
                play() { return false; }
                opacityOf() { return null; }
                stop() {}
                reset() {}
                step() { return false; }
            },
        };
        if (id === '../model/TerritoryHexSpawn') return {
            territoryHexSpawnDelays: () => new Map<number, number>(),
            territoryHexSpawnBatchSeconds: () => 0,
        };
        // 未解锁云（2026-10-23）：`TerritoryMapView` 又多了一条表现层依赖。本用例关注的
        // 渲染分支与云无关（云的层序 / 帧序 / 消散在 `territory-cloud` 里单独测）⇒ 空壳，
        // 成员按 MapView 实际调用面补齐（`attach` / `setFrames` / `sync` / `step` / `reset`）。
        if (id === './TerritoryCloudView') return {
            TERRITORY_CLOUD_LAYER_NODE: 'CloudLayer',
            TerritoryCloudView: class {
                attach(): void {}
                setFrames(): void {}
                setKeepOutPoints(): void {}
                sync(): void {}
                step(): void {}
                reset(): void {}
            },
        };
        // 未解锁云的**格位集合**（2026-10-23）：MapView 多了一条来自 model 的**值导入**
        // （`territoryCloudCells`），不只是 class。本用例的判据与云无关 ⇒ 给空集合
        // （视图那边全是空壳，没人读这些常量）。
        if (id === '../model/TerritoryCloud') return {
            territoryCloudCells: () => [],
            TERRITORY_CLOUD_SCALE: 1,
            TERRITORY_CLOUD_ART_OFFSET_Y: -21,
        };
        // 通关换色（2026-10-23 第三轮）：MapView 的又一条表现层依赖，与本用例关注的
        // 「随机格只显示银币图标 + 数量」无关 ⇒ 空壳（曲线在 `territory-hex-recolor` 里单独测）。
        if (id === './TerritoryHexRecolor') return {
            TERRITORY_HEX_RECOLOR_NEW_NODE: 'HexRecolorNew',
            TERRITORY_HEX_RECOLOR_OLD_NODE: 'HexRecolorOld',
            TerritoryHexRecolor: class {
                step(): void {}
                stop(): void {}
                reset(): void {}
                isPlaying() { return false; }
                play(): void {}
                hideGround(): void {}
            },
        };
        if (id === '../model/TerritoryHexRecolor') return {
            territoryHexRecolorDelays: () => new Map<number, number>(),
        };
        //  事件走 `EventMgr` 全局中控（组件侧 emit、页面侧 on 都经它）。
        if (id.includes('event/EventMgr')) {
            return { EventMgr: { instance: { emit() {}, on() {}, offTarget() {} } } };
        }
        if (id === '../application/TerritoryEvents') return mvcEvents;
        // 宝箱提示气泡 / 前置宝箱跳动（2026-11-02）：本用例关注的分支与它无关 ⇒ 给「不挂气泡、
        // 不跳」的退化桩（三条规则在 `territory-chest-hint` 里按**真模块**测）。
        // 气泡文案真源（2026-11-02 起搬进 model）：直接给**真模块**，别抄一份拼法 ——
        // 抄一遍就等于两边各改一半也能一起绿。
        if (id === '../model/TerritoryLevelBubble') return territoryLevelBubbleModule;
        // 「一个节点只在一块地上长 UI」的分组判据（2026-11-09）：给**真模块** ——
        // 退化成「空集合」会让「兄弟格被隐掉」的断言假绿，抄一份分组规则又会两边各改一半。
        if (id === '../model/TerritoryNodeUI') return territoryNodeUIModule;
        // 「预告首领关」过场的时间轴（2026-11-09）：给**真模块**（纯函数、零 cc）。
        // 退化成空实现会让「什么时候推镜 / 什么时候放开压住格」的断言无从断言。
        if (id === '../model/TerritoryPreviewCinema') return territoryPreviewCinemaModule;
        // 战斗过场曲线（2026-11-02）：纯函数、与本文件判据无关 ⇒ 给真模块，别抄一份常量。
        if (id === '../model/TerritoryBattleApproach') return territoryBattleApproachModule;
        // 2026-11-02 整页过场：地图视图新增的云盖层依赖。这组用例不演过场 ⇒ 给个空壳，
        // 千万别写 `throw` 兜底就完事（新增 import 必须同步补桩，见 `Unexpected dependency`）。
        if (id === './TerritoryBattleCover') {
            return { TerritoryBattleCover: class { setFrame() {} build() { return false; } apply() {} clear() {} destroy() {} dispose() {} } };
        }
        // 宝箱气泡底图 / 排版常量（2026-11-02 换 `frame_04`）⇒ 给真模块。
        if (id === '../model/TerritoryChestBubble') return territoryChestBubbleModule;
        if (id === '../model/TerritoryChestHint') return {
            TERRITORY_CHEST_HINT_SECONDS: 1.5,
            territoryChestHintBounceOffset: () => 0,
            territoryChestHintCell: () => null,
            territoryPrerequisiteChestCell: () => null,
        };
        // 「银币 / 体力够不够」的纯函数（2026-11-03）：给**真模块**，颜色判据不在这里验
        // （专项在 `territory-wallet-shortfall`），但退化成"永远够"会让颜色断言假绿。
        if (id === '../model/TerritoryCostShortfall') return territoryCostShortfallModule;
        // 「未解锁 → 可激活」的 1s 过渡曲线（2026-11-09）：纯函数、零 cc ⇒ 给**真模块**。
        // 退化成一个常量会让「锁该缩到几倍 / 价格该不该已经长出来」这类断言失去意义。
        if (id === '../model/TerritoryUnlockTransition') return territoryUnlockTransitionModule;
        throw new Error(`Unexpected dependency: ${id}`);
    },
});
    return moduleExports.TerritoryMapView as any;
}
