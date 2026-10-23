import { readFileSync } from 'node:fs';
import { buildTerritoryMapLayout, territoryMapOffsetForCell } from '../assets/script/app/territory/model/TerritoryMapLayout';
import type { TerritoryMapConfig } from '../assets/script/app/territory/model/TerritoryMapConfig';
const raw = JSON.parse(readFileSync('tools/map-editor/presets/territory/chapter_01.json', 'utf8'));
const map = { ...raw } as unknown as TerritoryMapConfig;
const layout = buildTerritoryMapLayout(map);
console.log('layout', layout.width, layout.height);
for (const vh of [700, 816, 900, 1000]) {
    const viewport = { width: 720, height: vh };
    const maxY = Math.max(0, layout.height - vh);
    const desired367 = layout.height / 2 - vh / 2 - (layout.points.get(367)?.y ?? 0) + 100;
    const offset = territoryMapOffsetForCell(layout, 367, viewport);
    console.log('vh', vh, 'maxY', maxY, 'desired', desired367.toFixed(1), 'clamped', offset.y.toFixed(1), 'point.y', layout.points.get(367)?.y);
}
