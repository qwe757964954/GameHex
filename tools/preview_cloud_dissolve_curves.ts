/**
 * 按 `territoryCloudDissolveFrame` 逐帧采样「云消散」姿态，供 `preview_cloud_dissolve.py` 合成预览图。
 *
 * 真源是 `model/TerritoryCloud`（图与代码同一份，不会漂）。用法：
 *
 *     npx tsx tools/preview_cloud_dissolve_curves.ts
 *
 * 产物：`docs/.tmp-cloud-dissolve.json`（预览脚本读完会删掉）。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    TERRITORY_CLOUD_DISSOLVE_SECONDS,
    territoryCloudDissolveFrame,
} from '../assets/script/app/territory/model/TerritoryCloud';

/** 美术实际给的两帧（`cloud_dissolve_body_0…1`）。 */
const FRAME_COUNT = 2;
/** 30fps —— 和真机一帧一采样，预览里的台阶就是实机看到的台阶。 */
const FPS = 30;

const total = TERRITORY_CLOUD_DISSOLVE_SECONDS;
const samples: {
    seconds: number;
    index: number;
    scale: number;
    liftY: number;
    opacity: number;
    shadowScale: number;
    shadowOpacity: number;
}[] = [];
for (let step = 0; step <= Math.round(total * FPS); step += 1) {
    const seconds = step / FPS;
    const pose = territoryCloudDissolveFrame(seconds, FRAME_COUNT);
    if (!pose) break;
    samples.push({
        seconds: Number(seconds.toFixed(4)),
        index: pose.index,
        scale: Number(pose.scale.toFixed(5)),
        liftY: Number(pose.liftY.toFixed(4)),
        opacity: Number(pose.opacity.toFixed(5)),
        shadowScale: Number(pose.shadowScale.toFixed(5)),
        shadowOpacity: Number(pose.shadowOpacity.toFixed(5)),
    });
}

const out = join('docs', '.tmp-cloud-dissolve.json');
writeFileSync(out, JSON.stringify({ total, frameCount: FRAME_COUNT, samples }, null, 2));
console.log(`${out}  ${samples.length} 帧 / ${total}s`);
