/**
 * 采样「开箱镜头推近」曲线，供 `tools/preview_chest_camera.py` 出图。
 *
 * 用法（在仓库根目录）：
 *     npx tsx tools/preview_chest_camera_curves.ts
 *
 * 只取数不画图（同 `preview_chest_timeline_curves.ts`）：曲线必须由 model 的
 * `territoryChestCameraFx` 逐帧算出来，出图脚本不重算缓动 —— 否则图会"自己证明自己"。
 * 「改前」的镜头恒 1 是历史口径（弱/中档以前没有推镜），写在这里当对照基线。
 */
import { writeFileSync } from 'node:fs';
import {
    TERRITORY_CHEST_SPECS,
    territoryChestCameraFx,
    territoryChestEndSeconds,
    territoryChestFadeStart,
} from '../assets/script/app/territory/model/TerritoryChestAnimation';
import { TERRITORY_CHEST_TIER } from '../assets/script/app/territory/model/TerritoryChestTier';

const NAMES: Readonly<Record<string, string>> = { weak: '弱档', medium: '中档', strong: '强档' };
/** 宝箱在地图上的静止可见宽（`CHEST_VISIBLE_WIDTH` = `BUILDING_VISIBLE_WIDTH`）。 */
const CHEST_VISIBLE_WIDTH = 84;
const STEP = 1 / 60;

const tiers = Object.values(TERRITORY_CHEST_TIER).map((tier) => {
    const spec = TERRITORY_CHEST_SPECS[tier];
    const end = territoryChestEndSeconds(spec);
    const samples: { t: number; scale: number; vignette: number }[] = [];
    for (let t = 0; t <= end + 1e-9; t += STEP) {
        const fx = territoryChestCameraFx(spec, t);
        samples.push({
            t: Number(t.toFixed(4)),
            scale: Number(fx.scale.toFixed(5)),
            vignette: Number(fx.vignette.toFixed(4)),
        });
    }
    const peak = Math.max(...samples.map((sample) => sample.scale));
    return {
        tier,
        name: NAMES[tier] ?? tier,
        cameraZoom: spec.cameraZoom,
        cameraInStart: spec.cameraInStart,
        cameraInSeconds: spec.cameraInSeconds,
        cameraOutStart: spec.cameraOutStart,
        cameraOutSeconds: spec.cameraOutSeconds,
        vignetteAlpha: spec.vignetteAlpha,
        lidStart: spec.lidStart,
        lidEnd: spec.lidStart + spec.lidSeconds,
        fadeStart: territoryChestFadeStart(spec),
        end,
        peak: Number(peak.toFixed(5)),
        chestWidthAtPeak: Number((CHEST_VISIBLE_WIDTH * peak).toFixed(2)),
        samples,
    };
});

writeFileSync(
    'docs/.tmp-chest-camera.json',
    JSON.stringify({ chestVisibleWidth: CHEST_VISIBLE_WIDTH, rows: tiers }, null, 2),
    'utf8',
);

for (const row of tiers) {
    console.log(
        `${row.name}: 峰值 ${row.peak.toFixed(3)}×（宝箱 ${row.chestWidthAtPeak}px，静止 ${CHEST_VISIBLE_WIDTH}px）`
        + ` | 推 ${row.cameraInStart}s+${row.cameraInSeconds}s → 拉 ${row.cameraOutStart}s+${row.cameraOutSeconds}s`
        + ` | 暗角 ${row.vignetteAlpha}`,
    );
}
