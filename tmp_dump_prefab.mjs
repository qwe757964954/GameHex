import fs from 'fs';

const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map();
for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (item && item.__type__) byId.set(i, item);
}

const CC_NODE = 'cc.Node';
const names = new Map();
for (const [id, item] of byId) {
    if (item.__type__ === CC_NODE) names.set(id, { id, name: item._name, children: item._children ?? [], comps: item._components ?? [] });
}

function compInfo(idx) {
    const entry = byId.get(idx?.__id__);
    if (!entry) return null;
    const type = entry.__type__;
    const extra = [];
    if (type === 'cc.Sprite') extra.push('spriteFrame=' + (entry._spriteFrame?.__uuid__ ?? 'null'));
    if (type === 'cc.Widget') extra.push(`align=${entry._alignFlags} l=${entry._left} r=${entry._right} t=${entry._top} b=${entry._bottom} mode=${entry._alignMode}`);
    if (type === 'cc.UITransform') extra.push(`size=${Math.round(entry._contentSize?.width ?? 0)}x${Math.round(entry._contentSize?.height ?? 0)} anchor=${entry._anchorPoint?.x},${entry._anchorPoint?.y}`);
    if (type === 'cc.ScrollView') extra.push('scrollview');
    if (type === 'cc.Mask') extra.push('mask');
    return type + (extra.length ? ` (${extra.join(' ')})` : '');
}

const root = raw.findIndex((x) => x && x.__type__ === 'cc.Prefab');
const rootNodeIdx = raw[root]?._root?.__id__ ?? raw.findIndex((x) => x && x.__type__ === CC_NODE);

function dump(idx, depth) {
    const node = names.get(idx);
    const pad = '  '.repeat(depth);
    if (!node) { console.log(pad + '<component ' + byId.get(idx)?.__type__ + '>'); return; }
    const pos = node.pos ?? '';
    console.log(`${pad}${node.name}   [localZOrder=${node.localZOrder ?? '-'}]`);
    for (const c of node.comps) {
        const info = compInfo(c);
        if (info) console.log(`${pad}    · ${info}`);
    }
    for (const child of node.children) dump(child.__id__, depth + 1);
}

// attach position
for (const [id, item] of byId) {
    if (item.__type__ === CC_NODE) {
        const rec = names.get(id);
        rec.localZOrder = item._localZOrder;
        rec.pos = item._lpos;
        rec.active = item._active;
    }
}

dump(rootNodeIdx, 0);
