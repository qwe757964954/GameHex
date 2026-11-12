import assert from 'node:assert/strict';

type Raw = Record<string, any>;

/** Apply direct serialized overrides by fileId, so a child's position cannot overwrite its root. */
export function applyInstanceOverrides(source: readonly Raw[], host: readonly Raw[], instance: Raw): Raw[] {
    const objects: Raw[] = structuredClone(source);
    const targets = new Map<string, Raw>();
    for (const object of objects) {
        const ref = object._prefab ?? object.__prefab;
        const fileId = ref && objects[ref.__id__]?.fileId;
        if (fileId) targets.set(fileId, object);
    }
    for (const ref of instance.propertyOverrides ?? []) {
        const override = host[ref.__id__];
        const ids = host[override.targetInfo.__id__].localID;
        assert.equal(ids.length, 1, 'fixture expects a direct prefab target');
        let target = targets.get(ids[0]);
        assert.ok(target, 'unknown override fileId: ' + ids[0]);
        const path: string[] = override.propertyPath;
        for (const key of path.slice(0, -1)) target = target[key];
        target[path.at(-1)!] = structuredClone(override.value);
    }
    return objects;
}
