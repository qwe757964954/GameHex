import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('单表类型生成保留其他已生成内容，重复运行不会增生类型或枚举', () => {
    const root = mkdtempSync(join(tmpdir(), 'ref-single-table-'));
    try {
        const tools = join(root, 'tools', 'ref'), raw = join(root, 'raw');
        const generated = join(root, 'assets', 'script', 'app', 'generated', 'refGen');
        for (const path of [tools, raw, generated]) mkdirSync(path, { recursive: true });
        const script = join(tools, 'ref_ref_type_all_gen.py');
        copyFileSync(resolve('tools/ref/ref_ref_type_all_gen.py'), script);
        const untouched = 'interface IRefkeep extends IRefBase\n{\ncustom:number\n}\n\n';
        const path = join(generated, 'ref_type_all.d.ts');
        writeFileSync(path, untouched + 'type TRefName="keep.json"\n\ntype TRefName2="keep"\n');
        writeFileSync(join(raw, 'keep.json'), JSON.stringify([{ replacedByOldSource: true }]));
        writeFileSync(join(raw, 'cardUiArt.json'), JSON.stringify([{ key: 'face.金', path: 'image/card/test' }]));
        const run = () => {
            const result = spawnSync('python', [script, raw, '--table', 'cardUiArt'], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            return readFileSync(path, 'utf8');
        };
        const first = run();
        assert.ok(first.startsWith(untouched));
        assert.match(first, /interface IRefcardUiArt extends IRefBase/);
        assert.match(first, /key:string/);
        assert.match(first, /path:string/);
        assert.match(first, /type TRefName="keep.json"\|"cardUiArt.json"/);
        assert.equal(run(), first);
        writeFileSync(join(raw, 'cardUiArt.json'), JSON.stringify([{ key: 'new', path: 'image/card/test', extra: 1 }]));
        const updated = run();
        assert.ok(updated.startsWith(untouched));
        assert.match(updated, /extra:number/);
        assert.equal((updated.match(/interface IRefcardUiArt extends/g) ?? []).length, 1);
    } finally {
        assert.ok(resolve(root).startsWith(join(resolve(tmpdir()), 'ref-single-table-')));
        rmSync(root, { recursive: true, force: true });
    }
});
