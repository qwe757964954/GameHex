import { readFileSync } from 'node:fs';

/** 用真实 Prefab 的层级和引用装配引擎桩，避免测试继续复制旧版 UI 构建代码。 */
export function bigMapPrefabFixture(types: Record<string, new (...args: any[]) => any>) {
    const objects = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab', 'utf8'));
    const scriptNames = ['BigMapPageLayout', 'BigMapBaseView', 'BigMapBasePlot', 'BigMapBuildRow', 'BigMapButton', 'BigMapPanel'];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const constructors = { ...types };
    for (const name of scriptNames) {
        const hex = JSON.parse(readFileSync(`assets/script/app/bigmap/view/${name}.ts.meta`, 'utf8')).uuid.replaceAll('-', '');
        let id = hex.slice(0, 5);
        for (let i = 5; i < 32; i += 3) {
            const value = parseInt(hex.slice(i, i + 3), 16);
            id += alphabet[value >> 6] + alphabet[value & 63];
        }
        constructors[id] = types[name] ?? class {};
    }
    const indices = new WeakMap<object, number>();
    const build = (index: number, external = new Map<number, any>()): any => {
        const instances = new Map<number, any>();
        const visit = (id: number) => {
            const data = objects[id];
            const node = new types['cc.Node'](data._name);
            node.active = data._active;
            node.setPosition(data._lpos.x, data._lpos.y, data._lpos.z);
            node.setScale(data._lscale.x, data._lscale.y, data._lscale.z);
            instances.set(id, node);
            indices.set(node, id);
            for (const ref of data._components) {
                const item = objects[ref.__id__];
                const Type = constructors[item.__type__] ?? class {};
                const component = node.getComponent(Type) ?? node.addComponent(Type);
                instances.set(ref.__id__, component);
            }
            for (const child of data._children) visit(child.__id__);
        };
        visit(index);
        const resolve = (value: any): any => {
            if (Array.isArray(value)) return value.map(resolve);
            if (value && typeof value === 'object' && '__id__' in value) return instances.get(value.__id__) ?? external.get(value.__id__);
            return value;
        };
        for (const [id, instance] of instances) {
            const data = objects[id];
            if (data.__type__ === 'cc.Node') {
                for (const child of data._children) instances.get(child.__id__).setParent(instance);
            } else {
                for (const [key, value] of Object.entries(data)) {
                    if (!key.startsWith('_') && key !== 'node') instance[key] = resolve(value);
                }
                if (data.__type__ === 'cc.UITransform') instance.setContentSize(data._contentSize.width, data._contentSize.height);
                if (data.__type__ === 'cc.Sprite') { instance.sizeMode = data._sizeMode; instance.trim = data._isTrimmedMode; }
            }
        }
        return { node: instances.get(index), instances };
    };
    const initial = build(objects[0].data.__id__);
    return {
        root: initial.node,
        findNode: (name: string) => [...initial.instances.values()].find((item) => item.name === name),
        instantiate: (template: object) => build(indices.get(template)!, initial.instances).node,
    };
}
