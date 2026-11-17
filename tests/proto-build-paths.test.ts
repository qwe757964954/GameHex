import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('client_proto 构建同步生成当前运行时静态模块，并在生成失败时停止', () => {
    const source = readFileSync('client_proto/build_proto.bat', 'utf8');
    assert.match(source, /node "%~dp0\.\.\\tools\\proto\\gen_static_module\.mjs"\r?\nif errorlevel 1 goto :failed/);
    assert.ok(source.indexOf('gen_static_module.mjs') < source.indexOf('Protocol build completed.'));
});

test('协议构建脚本统一输出到 resources/config，不再写入旧 subproto 目录', () => {
    const files = [
        'client_proto/build_proto.bat',
        'client_proto/strip_edition.py',
        'client_proto/protoCache_build.py',
        'tools/proto/build_proto.bat',
        'tools/proto/strip_edition.py',
        'tools/proto/protoCache_build.py',
    ];
    const source = files.map((path) => readFileSync(path, 'utf8')).join('\n');

    assert.doesNotMatch(source, /assets[\\/]resources[\\/]subproto/i);
    assert.match(source, /assets[\\/]resources[\\/]config[\\/]protoCompiled\.json/i);
    assert.match(source, /['"]config['"], ['"]protoCache\.json['"]/);
});
