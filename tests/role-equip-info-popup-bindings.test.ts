/**
 * `RoleEquipInfoPopup` 的 prefab 绑定完整性。
 *
 * ## 为什么要有这条
 *
 * 2026-11-27 删掉 `renderView` / `updateTabDisplay` / `renderBaseRows` 里的三处判空与三个可选链
 * （`if (this.qualityChipBg)`、`if (this.statusChipBg)`、`if (this.tabEquipOutline)`、
 * `this.baseRows[0]?.setData(...)`）：这些字段全是 prefab 绑定的 `@property`，判空只会把
 * 绑定错误藏到运行期之后（表现为「某个 chip 一直不变色」而不是当场抛）。
 *
 * 删完之后「prefab 上到底绑没绑、数组够不够长」就成了唯一的运行前提，所以用资源校验钉住：
 * 该组件不许有 null 引用，三个数组长度必须与代码里写死的下标一致。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { assetPath } from './helpers/asset-paths';

interface IPrefabObject {
    __type__?: string;
    [key: string]: unknown;
}

const ROOT = path.resolve(import.meta.dirname, '..');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** `.ts.meta` 的 uuid → prefab 里脚本组件的 23 位压缩 cid（编辑器同一套压缩规则）。 */
function compressUuid(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    assert.equal(hex.length, 32, `不是合法 uuid: ${uuid}`);
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const a = parseInt(hex[i], 16);
        const b = parseInt(hex[i + 1], 16);
        const c = parseInt(hex[i + 2], 16);
        out += B64[(a << 2) | (b >> 2)] + B64[((b & 3) << 4) | c];
    }
    return out;
}

const POPUP_CID = compressUuid(
    (JSON.parse(readFileSync(path.join(ROOT, 'assets/script/app/role/RoleEquipInfoPopup.ts.meta'), 'utf8')) as { uuid: string }).uuid,
);

const objects = JSON.parse(readFileSync(assetPath('ui/Role/RoleEquipInfoPopup.prefab'), 'utf8')) as IPrefabObject[];

function popupComponent(): IPrefabObject {
    const found = objects.filter((object) => object.__type__ === POPUP_CID);
    assert.equal(found.length, 1, `RoleEquipInfoPopup.prefab 里该组件的数量是 ${found.length}，期望 1`);
    return found[0];
}

test('RoleEquipInfoPopup ⚠️ 所有 @property 都绑了（删掉判空后，漏绑只能在运行期炸）', () => {
    const comp = popupComponent();
    const missing = Object.entries(comp)
        .filter(([key, value]) => !key.startsWith('__') && key !== 'node' && value === null)
        .map(([key]) => key);
    assert.deepEqual(missing, [], `这些字段在 prefab 里是 null：${missing.join(', ')}`);
});

test('属性行 / 宝石行数组长度与代码写死的下标一致（baseRows[2]、extraRows[3] 是裸写的）', () => {
    const comp = popupComponent();
    assert.equal((comp.baseRows as unknown[]).length, 3, 'baseRows 必须 3 行：renderBaseRows 裸写 [0][1][2]');
    assert.equal((comp.extraRows as unknown[]).length, 4, 'extraRows 必须 4 行：renderExtraRows 按 length 遍历');
    assert.equal((comp.gemItems as unknown[]).length, 5, 'gemItems 必须 5 行：与 ROLE_GEM_SOCKET_COUNT 一致');
});
