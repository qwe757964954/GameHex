import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
