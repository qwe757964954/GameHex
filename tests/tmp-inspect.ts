import { readFileSync } from 'node:fs';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { resolveZCSpawnMatchConfig } from '../assets/script/app/zcds/model/ZCSpawnSelection';

const FACE_W = 112, FACE_H = 98;
const SCALE_X = 84 / 36, SCALE_Y = 98 / 42;
const vx = (x: number) => x * SCALE_X;
const vy = (y: number) => y * SCALE_Y;

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
];
const tables = Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);

const layout = JSON.parse(readFileSync('assets/resources/config/maps/select_river.json', 'utf8')) as ZCMapLayout;
configureZCMap(layout);
const base = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });
const homes = { player: base.map.homes![0], enemy: base.map.homes![1] };
const config = resolveZCSpawnMatchConfig(base, { homes: homes as never, resolvedResources: [] as never });
const model = new ZCGameModel(null, Math.random, config);
const state = (model as any).state;

const homeId = config.map.playerHomeId;
const home = config.map.hexes[homeId];
console.log(`HOME ${homeId} center (${vx(home.x).toFixed(1)}, ${vy(home.y).toFixed(1)})`);
home.neighbors.forEach((nid: number, edge: number) => {
    const n = config.map.hexes[nid];
    console.log(`  edge ${edge}: nb ${nid} center (${vx(n.x).toFixed(1)}, ${vy(n.y).toFixed(1)}) owner=${state.hexes[nid].owner} state=${state.hexes[nid].state} res=${state.hexes[nid].neutralResourceId}`);
});

// 手动把 edge 0 邻格设成金矿（模拟玩家建金矿）。
const mineId = home.neighbors[0];
const mine = state.hexes[mineId];
mine.owner = 'player'; mine.building = 'mine'; mine.state = 'developed'; mine.developmentResolved = true;
mine.hp = 100; mine.maxHp = 100; mine.wallHp = 300; mine.wallMaxHp = 300; mine.neutralResourceId = null;

// 主城城墙 + 金矿城墙
function walls(id: number, label: string) {
    const cfg = config.map.hexes[id];
    const connected = model.connectedDevelopedHexIds(id);
    console.log(`\n${label} ${id} connected=[${connected}]`);
    for (let edge = 0; edge < 6; edge += 1) {
        const start = Math.PI / 3 * edge, end = Math.PI / 3 * (edge + 1);
        const normal = start + Math.PI / 6;
        let adj: number | null = null; let best = -Infinity;
        for (const nid of cfg.neighbors) {
            const n = config.map.hexes[nid];
            const dx = n.x - cfg.x, dy = n.y - cfg.y;
            const a = (dx * Math.cos(normal) + dy * Math.sin(normal)) / Math.max(1, Math.hypot(dx, dy));
            if (a > best) { best = a; adj = nid; }
        }
        const adjId = best > 0.7 ? adj : null;
        const drawn = !(adjId !== null && connected.includes(adjId));
        const mx = vx(cfg.x) + (FACE_W/2)*(Math.cos(start)+Math.cos(end))/2;
        const my = vy(cfg.y) + (FACE_H/2)*(Math.sin(start)+Math.sin(end))/2;
        console.log(`  edge ${edge} adj=${adjId} wallAt=(${mx.toFixed(1)}, ${my.toFixed(1)}) drawn=${drawn}`);
    }
}
walls(homeId, 'HOME');
walls(mineId, 'MINE');
