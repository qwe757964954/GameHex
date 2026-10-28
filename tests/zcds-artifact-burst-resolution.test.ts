import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('神器领取爆炸的 18 帧按常规显示尺寸保存，帧编号完整', () => {
    const dir = 'assets/bundles/battle/image/effects/artifact_claim_burst';
    const names = readdirSync(dir).filter(name => /^artifact_claim_burst_\d\d\.png$/.test(name)).sort();
    assert.equal(names.length, 18);
    for (let i = 0; i < names.length; i++) {
        assert.equal(names[i], `artifact_claim_burst_${String(i).padStart(2, '0')}.png`);
        const bytes = readFileSync(join(dir, names[i]));
        assert.equal(bytes.readUInt32BE(16), 90, names[i]);
        assert.equal(bytes.readUInt32BE(20), 90, names[i]);
    }
});
