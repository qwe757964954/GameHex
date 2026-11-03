/**
 * 「进战斗 / 匹配」整页过场的**曲线导出口**（`tools/preview_battle_intro.py` 吃它的 JSON）。
 *
 * 只打印真实模型算出来的值 —— 预览图要能证明"图上那几帧就是实机那几帧"，
 * 所以一律 `import` 真模块，不在这里抄常量：云团的点阵、逐帧浓度全部由
 * `model/TerritoryBattleIntro` 算，python 那边只负责上色。
 */
import {
    TERRITORY_BATTLE_INTRO_COVER_HEIGHT,
    TERRITORY_BATTLE_INTRO_COVER_SPREAD,
    TERRITORY_BATTLE_INTRO_COVER_WIDTH,
    TERRITORY_BATTLE_INTRO_IN_SECONDS,
    TERRITORY_BATTLE_INTRO_OUT_SECONDS,
    territoryBattleIntroCoverAlpha,
    territoryBattleIntroCoverPuffs,
    territoryBattleIntroHoldFx,
    territoryBattleIntroInFx,
    territoryBattleIntroOutFx,
    type ITerritoryBattleIntroFx,
} from '../assets/script/app/territory/model/TerritoryBattleIntro';
import { territoryFaceOutlinePoints } from '../assets/script/app/territory/model/TerritoryCloud';
import {
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
} from '../assets/script/core/hex/HexGridLayout';

const SCREEN_WIDTH = 750;
const SCREEN_HEIGHT = 1334;

interface IFrame {
    readonly label: string;
    readonly phase: 'out' | 'hold' | 'in';
    readonly fx: ITerritoryBattleIntroFx;
}

const frames: IFrame[] = [
    { label: 't=0', phase: 'out', fx: territoryBattleIntroOutFx(0) },
    { label: `out 40%`, phase: 'out', fx: territoryBattleIntroOutFx(TERRITORY_BATTLE_INTRO_OUT_SECONDS * 0.4) },
    { label: `out 75%`, phase: 'out', fx: territoryBattleIntroOutFx(TERRITORY_BATTLE_INTRO_OUT_SECONDS * 0.75) },
    { label: 'hold', phase: 'hold', fx: territoryBattleIntroHoldFx() },
    { label: 'in 45%', phase: 'in', fx: territoryBattleIntroInFx(TERRITORY_BATTLE_INTRO_IN_SECONDS * 0.45) },
    { label: 'in 100%', phase: 'in', fx: territoryBattleIntroInFx(TERRITORY_BATTLE_INTRO_IN_SECONDS) },
];

const clouds = territoryBattleIntroCoverPuffs(SCREEN_WIDTH, SCREEN_HEIGHT);

process.stdout.write(JSON.stringify({
    outSeconds: TERRITORY_BATTLE_INTRO_OUT_SECONDS,
    inSeconds: TERRITORY_BATTLE_INTRO_IN_SECONDS,
    coverSpread: TERRITORY_BATTLE_INTRO_COVER_SPREAD,
    frames,
    /** 云团点阵；`alpha` 是**逐帧**的浓度（已经把该帧的 `coverRelease` 算进去了）。 */
    cover: {
        width: TERRITORY_BATTLE_INTRO_COVER_WIDTH,
        height: TERRITORY_BATTLE_INTRO_COVER_HEIGHT,
        clouds: clouds.map((cloud) => ({
            x: cloud.x,
            y: cloud.y,
            scale: cloud.scale,
            delay: cloud.delay,
            flip: cloud.flip,
            frame: cloud.frame,
            alpha: frames.map((frame) => territoryBattleIntroCoverAlpha(cloud, frame.fx.coverRelease)),
        })),
    },
    grid: {
        columnSpacing: HEX_GRID_VIEW_COLUMN_SPACING,
        rowSpacing: HEX_GRID_VIEW_ROW_SPACING,
        face: territoryFaceOutlinePoints(),
    },
}, null, 2));
