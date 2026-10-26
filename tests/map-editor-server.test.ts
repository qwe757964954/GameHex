// 地图编辑器**服务端**判据（真起进程 + 真发请求的端到端探针）。
//
// 为什么单独起进程验：`server.mjs` 的校验（validatePreset）是模块内私有函数、不导出，
// 而它恰恰是"绕开编辑器直接 PUT 预设"这条旁路的唯一守门人 —— 编辑器 app.js 侧的判据
// 管不到这里。历史上就踩过"三处口径不一致"的坑（app.js / server.mjs / map_format.py），
// 只测一处等于没测。
//
// 覆盖两块新行为：
//   1. `/bg/<资源名>` 背景图路由 —— 编辑器画布衬底取的是**游戏里同一张**贴图
//      （`assets/resources/image/zdbg1.jpg`），所以路由必须能读到它，且挡住路径穿越。
//   2. 装饰值兼容新格式 `{ art, span?, offset? }` —— 多格占位的每一格都要在虚空内，
//      坏 span 必须被挡（不能靠 `Number(null) → 0` 隐性兜底）。
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import test from 'node:test';

/** 先占一个空闲端口再放掉，拿到的端口交给被测服务 —— 不与开发者本机跑着的编辑器撞端口。 */
async function freePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const probe = createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            probe.close(() => resolve(port));
        });
    });
}

async function waitForServer(base: string, child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`编辑器服务提前退出：exitCode=${child.exitCode}`);
        try {
            const response = await fetch(`${base}/api/presets`);
            if (response.ok) return;
        } catch {
            /* 还没起来，接着等 */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('编辑器服务 15s 内没起来');
}

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['server.mjs'], {
        cwd: 'tools/map-editor',
        env: { ...process.env, MAP_EDITOR_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 吞掉子进程输出，否则管道写满会把它堵死（僵尸挂在 15s 超时上）。
    child.stdout?.resume();
    child.stderr?.resume();
    try {
        await waitForServer(base, child);
        await run(base);
    } finally {
        child.kill();
    }
}

/** 一份合法的半场镜像底图（与 presets/river.json 同构，虚空格在绝对行 9/10 的 0/1 列）。 */
function basePreset(id: string) {
    return {
        id, name: id, version: 3, rows: 20, columns: 11,
        playerCount: 2, cityMode: 'fixed',
        mirrorVertical: true, mirrorHorizontal: false, mirror180: false,
        ascii: [
            '..00...00..', '..00...00..', '..00...00..', '..000..000.', '.000000000.',
            '00000100000', '00000000000', '00000000000', '00000000000', '00000000000',
        ],
        homes: [{ row: 15, column: 5 }, { row: 4, column: 5 }],
    };
}

async function putPreset(base: string, id: string, body: unknown): Promise<{ status: number; body: any }> {
    const response = await fetch(`${base}/api/presets/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
}

test('地图编辑器服务端：/bg 背景图路由读游戏同源贴图，且挡路径穿越', async () => {
    assert.ok(existsSync('assets/resources/image/zdbg1.jpg'), '★默认底图 zdbg1.jpg 必须存在（游戏与编辑器共用）');
    await withServer(async (base) => {
        // 编辑器画布请求的就是 art.background（默认 image/zdbg1，不带扩展名）。
        const response = await fetch(`${base}/bg/image/zdbg1`);
        assert.equal(response.status, 200, '背景图应该能取到');
        assert.equal(response.headers.get('content-type'), 'image/jpeg');
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.ok(bytes.length > 1000, `背景图像素量应该像张真图，实际 ${bytes.length} 字节`);
        // 带扩展名 / 不带扩展名都要认（策划手填常连后缀一起写）。
        assert.equal((await fetch(`${base}/bg/image/zdbg1.jpg`)).status, 200);

        // 只放行 `image/` 前缀：`/bg/config/maps/river` 会读到工程里任意文件，必须 404。
        assert.equal((await fetch(`${base}/bg/config/maps/river`)).status, 404, '非 image/ 前缀不许穿');
        // `..` 一律 404（编码与否都要挡）。
        assert.equal((await fetch(`${base}/bg/image/%2e%2e%2f%2e%2e%2fserver.mjs`)).status, 404, '路径穿越必须挡住');
        assert.equal((await fetch(`${base}/bg/image/not-a-real-bg`)).status, 404);
    });
});

test('地图编辑器服务端：校验并保存自由装饰，拒绝非法尺寸与翻转值', async () => {
    await withServer(async (base) => {
        const probeIds = ['probe-free-ok', 'probe-size', 'probe-flip', 'probe-empty-bg', 'probe-ok-bg'];
        try {
            const valid = { ...basePreset('probe-free-ok'), art: { freeDecor: [{
                id: 'rock', art: 'image/decor/sea/reef', x: 12, y: -8,
                width: 240, height: 120, rotation: 15, flipX: true, flipY: false,
            }] } };
            const r1 = await putPreset(base, 'probe-free-ok', valid);
            assert.equal(r1.status, 200, '自由装饰应被接受：' + JSON.stringify(r1.body));
            assert.deepEqual(r1.body.preset.art.freeDecor, valid.art.freeDecor);

            const badSize = { ...basePreset('probe-size'), art: { freeDecor: [{
                art: 'image/decor/sea/reef', x: 0, y: 0, width: 0, height: 100,
            }] } };
            assert.equal((await putPreset(base, 'probe-size', badSize)).status, 400);

            const badFlip = { ...basePreset('probe-flip'), art: { freeDecor: [{
                art: 'image/decor/sea/reef', x: 0, y: 0, width: 100, height: 100, flipX: 'yes',
            }] } };
            assert.equal((await putPreset(base, 'probe-flip', badFlip)).status, 400);

            // art.background 空串 → 400；合法 → 原样保留。
            const emptyBg = { ...basePreset('probe-empty-bg'), art: { background: '   ' } };
            assert.equal((await putPreset(base, 'probe-empty-bg', emptyBg)).status, 400, '空 background 应当 400');
            const okBg = { ...basePreset('probe-ok-bg'), art: { background: 'image/zdbg1' } };
            const r2 = await putPreset(base, 'probe-ok-bg', okBg);
            assert.equal(r2.status, 200);
            assert.equal(r2.body.preset.art.background, 'image/zdbg1', 'background 必须原样透传');
        } finally {
            // 失败用例也不能把探针预设留在仓库里污染预设库。
            for (const id of probeIds) {
                await fetch(`${base}/api/presets/${id}`, { method: 'DELETE' }).catch(() => {});
            }
        }
    });
});

test('map editor server preserves weighted neutral-resource pools and home-candidate ranges', async () => {
    await withServer(async (base) => {
        const id = 'probe-map-metadata';
        try {
            const preset = {
                ...basePreset(id),
                cityMode: 'select',
                mirrorVertical: false,
                ascii: Array(20).fill('00000000000'),
                homeCandidates: [{ section: 1, cells: [1, 2] }],
                resourcePoints: [{ row: 2, column: 2, pool: { gold: 1, chest: 4, unit_cap: 2 } }],
            };
            const response = await putPreset(base, id, preset);
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.deepEqual(response.body.preset.homeCandidates, preset.homeCandidates);
            assert.deepEqual(response.body.preset.resourcePoints, preset.resourcePoints);
        } finally {
            await fetch(`${base}/api/presets/${id}`, { method: 'DELETE' }).catch(() => {});
        }
    });
});

function resourcePreset(id: string, resourcePoints: unknown[]) {
    return {
        id, name: id, version: 3, rows: 10, columns: 12, playerCount: 4,
        cityMode: 'select', mirrorVertical: false, mirrorHorizontal: false,
        ascii: Array(10).fill('012340123401'), resourcePoints,
    };
}

test('组合资源点可保存到玩家分区，读取保留坐标和组合ID，旧池保持原样', async () => {
    await withServer(async (base) => {
        const id = 'probe-resource-groups';
        const points = [
            { row: 0, column: 1, groupId: 13001 },
            { row: 4, column: 2, groupId: 13002 },
            { row: 9, column: 3, pool: { chest: 0, gold: 1 } },
        ];
        try {
            const response = await putPreset(base, id, resourcePreset(id, points));
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.deepEqual(response.body.preset.resourcePoints, points);
            const saved = await (await fetch(`${base}/api/presets`)).json();
            assert.deepEqual(saved.presets.find((preset: { id: string }) => preset.id === id).resourcePoints, points);
        } finally {
            await fetch(`${base}/api/presets/${id}`, { method: 'DELETE' });
        }
    });
});

test('保存拒绝非法组合ID、混合旧池、虚空、主城重叠和过近点位', async () => {
    await withServer(async (base) => {
        const id = 'probe-invalid-resource-group';
        const cases: Array<{ name: string; body: ReturnType<typeof resourcePreset> }> = [];
        for (const groupId of [0, -1, 1.2, '13001', 2147483648, null]) {
            cases.push({ name: `groupId=${groupId}`, body: resourcePreset(id, [{ row: 1, column: 1, groupId }]) });
        }
        cases.push({ name: '混合旧池', body: resourcePreset(id, [{ row: 1, column: 1, groupId: 13001, pool: { chest: 1 } }]) });
        cases.push({ name: '空点位', body: resourcePreset(id, [{ row: 1, column: 1 }]) });
        cases.push({ name: '旧池全零', body: resourcePreset(id, [{ row: 1, column: 1, pool: { chest: 0, gold: 0 } }]) });
        cases.push({ name: '重复点位', body: resourcePreset(id, [{ row: 1, column: 1, groupId: 13001 }, { row: 1, column: 1, groupId: 13002 }]) });
        cases.push({ name: '距离不足', body: resourcePreset(id, [{ row: 1, column: 1, groupId: 13001 }, { row: 2, column: 1, groupId: 13002 }]) });
        const voidMap = resourcePreset(id, [{ row: 0, column: 0, groupId: 13001 }]);
        voidMap.ascii[0] = '.12340123401';
        cases.push({ name: '虚空', body: voidMap });
        try {
            for (const entry of cases) assert.equal((await putPreset(base, id, entry.body)).status, 400, entry.name);
            const homeMap = { ...resourcePreset(id, [{ row: 1, column: 1, groupId: 13001 }]), homes: [{ row: 1, column: 1 }, null, null, null] };
            assert.equal((await putPreset(base, id, homeMap)).status, 400, '主城重叠');
            const distant = resourcePreset(id, [{ row: 1, column: 1, groupId: 13001 }, { row: 4, column: 1, groupId: 13002 }]);
            assert.equal((await putPreset(base, id, distant)).status, 200, '恰好三步可以放');
            assert.equal((await putPreset(base, id, { ...distant, spacing: { resourceMinDistance: 4 } })).status, 400, '保留配置的更大间距');
        } finally {
            await fetch(`${base}/api/presets/${id}`, { method: 'DELETE' });
        }
    });
});

test('组合点位的间距沿可通行路径计算且镜像压缩图使用绝对坐标', async () => {
    await withServer(async (base) => {
        const id = 'probe-resource-mirror';
        try {
            const separated = { ...resourcePreset(id, [{ row: 2, column: 1, groupId: 13001 }, { row: 2, column: 3, groupId: 13002 }]), ascii: Array(10).fill('11.333333333') };
            assert.equal((await putPreset(base, id, separated)).status, 200, '虚空隔断不能当作两步路径');
            const mirrored = { ...basePreset(id), resourcePoints: [{ row: 0, column: 0, groupId: 13001 }, { row: 19, column: 0, groupId: 13002 }] };
            const response = await putPreset(base, id, mirrored);
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.deepEqual(response.body.preset.resourcePoints, mirrored.resourcePoints);
        } finally {
            await fetch(`${base}/api/presets/${id}`, { method: 'DELETE' });
        }
    });
});
