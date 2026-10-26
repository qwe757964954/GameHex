/**
 * 采样「开箱表演时间轴」的改前 / 改后数值，供 `tools/preview_chest_timeline.py` 出图。
 *
 * 用法（在仓库根目录）：
 *     npx tsx tools/preview_chest_timeline_curves.ts
 *
 * 这里**只取数，不画图**（与 `preview_chest_placement_curves.ts` 同一分工）：
 * 几何/时序一律从 model 的导出函数算，出图脚本不重算公式 —— 否则图会"自己证明自己"。
 *
 * 「改前」的口径写死在这里（2026-10-22 之前的参数表）：那套数已经不在代码里了，
 * 但对照图必须能复现它，否则看图上"空转变短了"没有依据。
 */
import { writeFileSync } from 'node:fs';
import {
    TERRITORY_CHEST_SPECS,
    territoryChestEndSeconds,
    territoryChestFadeStart,
    territoryChestLastRewardAt,
} from '../assets/script/app/territory/model/TerritoryChestAnimation';
import { TERRITORY_CHEST_TIER } from '../assets/script/app/territory/model/TerritoryChestTier';

/** 改前的三档（总时长 / 淡出）——只用于对照，运行时已不再使用。 */
const LEGACY: Readonly<Record<string, { total: number; fade: number }>> = {
    weak: { total: 3.0, fade: 0.55 },
    medium: { total: 2.6, fade: 0.40 },
    strong: { total: 4.0, fade: 0.50 },
};

const NAMES: Readonly<Record<string, string>> = {
    weak: '弱档',
    medium: '中档',
    strong: '强档',
};

const rows = Object.values(TERRITORY_CHEST_TIER).map((tier) => {
    const spec = TERRITORY_CHEST_SPECS[tier];
    const legacy = LEGACY[tier];
    const lastReward = territoryChestLastRewardAt(spec);
    const fadeStart = territoryChestFadeStart(spec);
    const end = territoryChestEndSeconds(spec);
    return {
        tier,
        name: NAMES[tier] ?? tier,
        // 开箱阶段：出场 → 箱盖开完（这段两版完全一样，图上用同一段表示）
        openStart: spec.popStart,
        openEnd: spec.lidStart + spec.lidSeconds,
        lidStart: spec.lidStart,
        lidEnd: spec.lidStart + spec.lidSeconds,
        flyStart: spec.flyStart,
        flyEnd: lastReward,
        lastReward,
        fadeStart,
        end,
        fade: spec.fadeOutSeconds,
        settle: spec.settleSeconds,
        settleSeconds: spec.settleSeconds,
        total: spec.totalSeconds,
        // 改前：收尾挂在 total - fade 上，与奖励飞完无关
        legacyTotal: legacy.total,
        legacyFade: legacy.fade,
        legacyFadeStart: legacy.total - legacy.fade,
        legacyIdle: legacy.total - legacy.fade - lastReward,
        idle: fadeStart - lastReward,
    };
});

const out = {
    rows,
    // 右端留一点空：总时长标签写在竖线右侧，贴边会被截掉
    maxSeconds: Math.max(...rows.map((row) => Math.max(row.legacyTotal, row.total))) + 0.26,
};

writeFileSync('docs/.tmp-chest-timeline.json', JSON.stringify(out, null, 2), 'utf8');
for (const row of rows) {
    const pad = (value: number) => value.toFixed(2).padStart(5);
    console.log(
        `${row.name}: 末枚落袋 ${pad(row.lastReward)}s | 空转 ${pad(row.legacyIdle)}s → ${pad(row.idle)}s`
        + ` | 总时长 ${pad(row.legacyTotal)}s → ${pad(row.total)}s`,
    );
}
