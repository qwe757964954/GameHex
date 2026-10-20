import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const PROJECT_ROOT = process.cwd();
const LEGACY_TAB_ASSETS = [
    'assets/resources/image/main/tab_bg_01.png',
    'assets/resources/image/main/tab_bg_01.png.meta',
    'assets/resources/image/main/tab_bg_02.png',
    'assets/resources/image/main/tab_bg_02.png.meta',
] as const;
const LEGACY_REFERENCES = [
    'tab_bg_01',
    'tab_bg_02',
    '01160154-423b-4b28-93b5-7464bbb81174',
    'b09f13ff-cf09-410b-988e-cc4ee0391fad',
] as const;

function filesUnder(directory: string): string[] {
    return readdirSync(join(PROJECT_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return filesUnder(path);
        return /\.(ts|prefab)$/.test(entry.name) ? [path] : [];
    });
}

test('主页页签改版后删除旧 tab_bg 资源和所有代码、Prefab 引用', () => {
    for (const path of LEGACY_TAB_ASSETS) {
        assert.equal(existsSync(join(PROJECT_ROOT, path)), false, `${path} should be deleted`);
    }

    const consumers = [
        ...filesUnder('assets/script/app'),
        ...filesUnder('assets/resources/ui'),
    ];
    for (const path of consumers) {
        const source = readFileSync(join(PROJECT_ROOT, path), 'utf8');
        for (const reference of LEGACY_REFERENCES) {
            assert.equal(source.includes(reference), false, `${path} still references ${reference}`);
        }
    }
});
