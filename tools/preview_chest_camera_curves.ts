/**
 * 采样「开箱镜头推近」曲线，供 `tools/preview_chest_camera.py` 出图。
 *
 * 用法（在仓库根目录）：
 *     npx tsx tools/preview_chest_camera_curves.ts
 *
 * 只取数不画图（同 `preview_chest_timeline_curves.ts`）：曲线必须由 model 的
 * `territoryChestCameraFx` 逐帧算出来，出图脚本不重算缓动 —— 否则图会"自己证明自己"。
 *
 * ## 2026-10-23 起按**奖励总量**分档采样（不再按档位）
 *
 * 用户最终口径：「推进的倍率根据奖励资源的数量区分弱中强三档，弱小于 50、中 51-500、
 * 强 1000+；强推进倍率 = 2.3、中推近 = 1.35、弱推进 = 1.08」。
 *
 * 所以这里固定用**同一份参数表**（弱档的时间轴 —— 弱 / 中档的推近窗口本来就一样，
 * 都是"开盖那一刻起、与开盖同长"），只换 `cameraZoom`，让三条曲线的差别**只剩倍数**：
 * 混进档位差异（强档 0s 起手、暗角）就看不出倍率本身的效果了。
 */
import { writeFileSync } from 'node:fs';
import {
    TERRITORY_CHEST_SPECS,
    territoryChestCameraFx,
    territoryChestCameraZoomOf,
    territoryChestEndSeconds,
    territoryChestFadeStart,
} from '../assets/script/app/territory/model/TerritoryChestAnimation';
import { TERRITORY_CHEST_TIER } from '../assets/script/app/territory/model/TerritoryChestTier';

/** 宝箱在地图上的静止可见宽（`CHEST_VISIBLE_WIDTH` = `BUILDING_VISIBLE_WIDTH`）。 */
const CHEST_VISIBLE_WIDTH = 84;
const STEP = 1 / 60;

/**
 * 三个采样用的**奖励总量**（各自落在"弱 / 中 / 强"区间里）。
 *
 *  取 20 / 200 / 2000 只是为了让三档都可读；任何落在同一区间的总量都会得到同一条曲线。
 */
const BUCKETS: readonly { readonly key: string; readonly total: number; readonly label: string }[] = [
    { key: 'weak', total: 20, label: '弱：总量 ≤ 50' },
    { key: 'medium', total: 200, label: '中：总量 51~500' },
    { key: 'strong', total: 2000, label: '强：总量 > 500' },
];

/** 共同的时间轴（弱档）：推近窗口 = 开盖那一刻起、与开盖同长。 */
const SPEC = TERRITORY_CHEST_SPECS[TERRITORY_CHEST_TIER.weak];
const END = territoryChestEndSeconds(SPEC);

const rows = BUCKETS.map((bucket) => {
    const zoom = territoryChestCameraZoomOf(bucket.total);
    const samples: { t: number; scale: number; focus: number }[] = [];
    for (let t = 0; t <= END + 1e-9; t += STEP) {
        const fx = territoryChestCameraFx(SPEC, t, zoom);
        samples.push({
            t: Number(t.toFixed(4)),
            scale: Number(fx.scale.toFixed(5)),
            focus: Number(fx.focus.toFixed(4)),
        });
    }
    const peak = Math.max(...samples.map((sample) => sample.scale));
    return {
        tier: bucket.key,
        name: bucket.label,
        total: bucket.total,
        cameraZoom: zoom,
        cameraInStart: SPEC.cameraInStart,
        cameraInSeconds: SPEC.cameraInSeconds,
        cameraOutStart: SPEC.cameraOutStart,
        cameraOutSeconds: SPEC.cameraOutSeconds,
        vignetteAlpha: 0,
        lidStart: SPEC.lidStart,
        lidEnd: SPEC.lidStart + SPEC.lidSeconds,
        fadeStart: territoryChestFadeStart(SPEC),
        end: END,
        peak: Number(peak.toFixed(5)),
        chestWidthAtPeak: Number((CHEST_VISIBLE_WIDTH * peak).toFixed(2)),
        samples,
    };
});

writeFileSync(
    'docs/.tmp-chest-camera.json',
    JSON.stringify({ chestVisibleWidth: CHEST_VISIBLE_WIDTH, rows }, null, 2),
    'utf8',
);

for (const row of rows) {
    console.log(
        `${row.name}（总量 ${row.total} ⇒ ${row.cameraZoom}×）: 峰值 ${row.peak.toFixed(3)}×`
        + `（宝箱 ${row.chestWidthAtPeak}px，静止 ${CHEST_VISIBLE_WIDTH}px）`
        + ` | 推 ${row.cameraInStart}s+${row.cameraInSeconds}s → 拉 ${row.cameraOutStart}s+${row.cameraOutSeconds}s`,
    );
}
