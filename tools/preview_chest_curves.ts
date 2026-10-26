/**
 * 导出三档开箱动画的逐帧采样（供 `tools/preview_chest_animation.py` /
 * `tools/preview_chest_frames.py` 画验收图）。
 *
 * 运行：`npx tsx tools/preview_chest_curves.ts`（一般由 python 绘制脚本自动调，不用手跑）。
 * 为什么要先采样再画：预览图必须和 `TerritoryChestAnimation` **同一份真源**，
 * 不能在 python 里再抄一遍参数表 —— 否则改了参数图还是旧的，验收就白看。
 */
import { writeFileSync } from 'node:fs';
import {
    TERRITORY_CHEST_SPECS,
    territoryChestBeamAlpha,
    territoryChestBodyFx,
    territoryChestCameraFx,
    territoryChestOpenFrame,
    territoryChestRayFx,
    territoryChestRainbowFx,
} from '../assets/script/app/territory/model/TerritoryChestAnimation';
import { TERRITORY_CHEST_TIER, TERRITORY_CHEST_TIER_LABEL } from '../assets/script/app/territory/model/TerritoryChestTier';

const STEP = 0.01;
const out: unknown[] = [];
for (const tier of [TERRITORY_CHEST_TIER.weak, TERRITORY_CHEST_TIER.medium, TERRITORY_CHEST_TIER.strong]) {
    const spec = TERRITORY_CHEST_SPECS[tier];
    const times: number[] = [];
    for (let t = 0; t <= spec.totalSeconds + 1e-9; t += STEP) times.push(Number(t.toFixed(4)));
    out.push({
        tier,
        label: TERRITORY_CHEST_TIER_LABEL[tier],
        spec,
        samples: times.map((t) => {
            const body = territoryChestBodyFx(spec, t);
            return {
                t,
                scale: body.scale,
                scaleY: body.scaleY,
                offsetY: body.offsetY,
                visible: body.visible,
                // 开盖换帧（2026-10-22 起箱盖不再旋转）：0 = 闭合，openFrames-1 = 全开
                frame: territoryChestOpenFrame(spec, t),
                // ⚠️ 2026-10-23 起没有白光爆点（用户要求移除），预览图也不再画这一条曲线。
                ray: (() => { const fx = territoryChestRayFx(spec, t); return fx ? fx.alpha : null; })(),
                beam: territoryChestBeamAlpha(spec, t),
                rainbow: (() => { const fx = territoryChestRainbowFx(spec, t); return fx ? fx.alpha : null; })(),
                camera: territoryChestCameraFx(spec, t).scale,
                vignette: territoryChestCameraFx(spec, t).vignette,
            };
        }),
    });
}
writeFileSync('docs/.tmp-chest-curves.json', JSON.stringify(out, null, 0), 'utf8');
console.log('ok');
