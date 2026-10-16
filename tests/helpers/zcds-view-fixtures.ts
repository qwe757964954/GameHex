import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ZC_HEX_CONFIG, ZC_OWNER_ORDER, ownersForPlayerCount } from '../../assets/script/app/zcds/model/ZCMapConfig';

export function loadViews() {
    class Color {
        static WHITE = new Color(255, 255, 255);
        constructor(public r: number, public g: number, public b: number, public a = 255) {}
        set(r: number, g: number, b: number, a = 255) {
            this.r = r; this.g = g; this.b = b; this.a = a;
            return this;
        }
    }
    class FakeNode {
        static EventType = { TOUCH_END: 'touch-end' };
        active = true;
        isValid = true;
        layer = 1;
        children: FakeNode[] = [];
        parent: FakeNode | null = null;
        position = { x: 0, y: 0, z: 0, clone() { return { x: this.x, y: this.y, z: this.z }; } };
        /**
         * 世界坐标。桩里没有父级变换链（也没有 scale/rotate），所以直接等于局部 `position`
         * —— 地块翻面的透视材质要按格心**世界坐标**做变形，用例得读得到它。
         */
        get worldPosition() { return this.position; }
        get worldScale() { return this.scale; }
        size = { width: 24, height: 4 };
        private components = new Map<any, any>();
        constructor(public name = '') {}
        on() {}
        off() {}
        getChildByName(name: string) { return this.children.find((child) => child.name === name) ?? null; }
        getComponentInChildren() { return null; }
        /** 与引擎同义：先从当前位置摘出、再插到目标索引（地块「抬升到顶层 / 归位」要看它）。 */
        setSiblingIndex(index: number) {
            if (!this.parent) return;
            const siblings = this.parent.children;
            const current = siblings.indexOf(this);
            if (current >= 0) siblings.splice(current, 1);
            siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, this);
        }
        getSiblingIndex() { return this.parent ? this.parent.children.indexOf(this) : 0; }
        setRotationFromEuler(_x: number, _y: number, _z: number) {}
        getComponent(type?: any) {
            if (this.components.has(type)) return this.components.get(type);
            if (type?.name === 'Graphics') return null;
            const node = this;
            return {
                // 视图层按「本节点 UITransform 的 contentSize」决定绘制尺寸（吐司底 / 选点确认按钮
                // 的圆角矩形都不存宽高，改 prefab 就生效），所以桩必须把 size 读出去。
                get contentSize() { return node.size; },
                setContentSize: (width: number, height: number) => { this.size = { width, height }; },
            };
        }
        addComponent(type: any) {
            const component = new type();
            this.components.set(type, component);
            return component;
        }
        /** 与 `setParent` 等价，但保留「同一个父」的语义（视图里两种写法都有用）。 */
        addChild(child: FakeNode) {
            child.setParent(this);
        }
        setParent(parent: FakeNode) {
            if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
            this.parent = parent;
            parent.children.push(this);
        }
        /** 与引擎 `Node.removeFromParent` 同义。出生特效回池前必须摘宿主，否则会跟着别人进池。 */
        removeFromParent() {
            if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
            this.parent = null;
        }
        setPosition(x: number | { x: number; y: number; z: number }, y?: number, z?: number) {
            this.position.x = typeof x === 'number' ? x : x.x;
            this.position.y = typeof x === 'number' ? y! : x.y;
            this.position.z = typeof x === 'number' ? z! : x.z;
        }
        setScale(x: number | { x: number; y: number; z: number }, y?: number, z?: number) {
            this.scale.x = typeof x === 'number' ? x : x.x;
            this.scale.y = typeof x === 'number' ? y! : x.y;
            this.scale.z = typeof x === 'number' ? z! : x.z;
        }
        // 视图层按帧尺寸缩放资源图标（`resourceIconScale`），桩要能观测缩放结果。
        scale = { x: 1, y: 1, z: 1, clone() { return { x: this.x, y: this.y, z: this.z }; } };
        destroy() {
            this.isValid = false;
            // 贴近引擎语义：销毁后不再挂在父节点上。
            if (this.parent) {
                this.parent.children = this.parent.children.filter((child) => child !== this);
                this.parent = null;
            }
        }
    }
    class Graphics {
        static LineCap = { BUTT: 0, ROUND: 1, SQUARE: 2 };
        lineWidth = 1;
        lineCap = Graphics.LineCap.BUTT;
        strokeColor: Color | null = null;
        commands: Array<{ kind: string; x?: number; y?: number; radius?: number; width?: number; height?: number }> = [];
        fillColor: Color | null = null;
        clear() { this.commands = []; }
        moveTo(x: number, y: number) { this.commands.push({ kind: 'moveTo', x, y }); }
        lineTo(x: number, y: number) { this.commands.push({ kind: 'lineTo', x, y }); }
        /** 闭合当前路径（`ZCHexView.pathHexTop` 的六边形描边 / 填充）。 */
        close() { this.commands.push({ kind: 'close' }); }
        /** 地块激活光效的圆环绘制（`ZCHexView.drawActivationGlow`）。 */
        circle(x: number, y: number, radius: number) { this.commands.push({ kind: 'circle', x, y, radius }); }
        /** 圆角矩形（吐司底 / 选点确认按钮底板）：记录左下角、宽高与圆角，供用例算回尺寸。 */
        roundRect(x: number, y: number, width: number, height: number, radius: number) {
            this.commands.push({ kind: 'roundRect', x, y, radius, width, height });
        }
        fill() { this.commands.push({ kind: 'fill' }); }
        stroke() { this.commands.push({ kind: 'stroke' }); }
    }
    class Material {
        isValid = true;
        /** 引擎里是「从 effect 反查」的 getter；桩里做成可写字段，便于断言「按 effect 克隆」。 */
        effectAsset: any = null;
        readonly properties = new Map<string, unknown>();
        /** `ZCHexView` 建材质时调（`new Material().initialize({ effectAsset })`）。 */
        initialize(info: any) {
            if (info && info.effectAsset) this.effectAsset = info.effectAsset;
        }
        copy(source: Material) {
            this.effectAsset = source.effectAsset;
            source.properties.forEach((value, key) => this.properties.set(key, value));
        }
        setProperty(name: string, value: unknown) { this.properties.set(name, value); }
        destroy() { this.isValid = false; }
    }
    class Vec2 {
        constructor(public x: number, public y: number) {}
    }
    class Vec4 {
        constructor(public x: number, public y: number, public z: number, public w: number) {}
    }
    const cc = {
        _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {}, disallowMultiple: (value: unknown) => value },
        Color, Component: class { node = new FakeNode(); }, Animation: class {}, sp: { Skeleton: class {} }, Graphics, ProgressBar: class {},
        Sprite: class { static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 }; },
        SpriteFrame: class {}, UITransform: class {}, Label: class {}, Material, Prefab: class {}, Node: FakeNode, Vec4, Vec2,
        /** 局部透明度（卡牌评语延迟出现 / 金币图标淡出都会懒挂它）。 */
        UIOpacity: class { opacity = 255; },
        Vec3: class {
            static ZERO = new this(0, 0, 0);
            static ONE = new this(1, 1, 1);
            constructor(public x: number, public y: number, public z: number) {}
            /** 与引擎 `Vec3.set` 同签名（原地写回并返回自身）。视图层复用同一个实例算缩放。 */
            set(x: number, y: number, z: number) {
                this.x = x; this.y = y; this.z = z;
                return this;
            }
        },
        instantiate: (prefab: any) => prefab.make(),
    };
    const cache: Record<string, any> = {
        cc,
        '../model/ZCGameModel': { ZC_HEX_CONFIG, ZC_SIMULATION_STEP_SECONDS: 0.05 },
        // 视图直接值导入 `ZC_OWNER_ORDER`（横幅落位按席位次序排格）。`load` 只认 `./X`
        // 这种同层相对名，`../model/ZCMapConfig` 会落到 `zcds/ui/` 那个兜底分支去读不存在的文件，
        // 所以这里显式挂真源 —— 与文件顶部已经 import 的 `ZC_HEX_CONFIG` 同一个来源。
        '../model/ZCMapConfig': { ZC_OWNER_ORDER, ownersForPlayerCount },
        '../model/ZCCombatCatalog': {
            resolveUnitDefinition: () => ({}),
            luckTextOfTier: () => '',
            rarityNameOfTier: (tier: number) => `tier-${tier}`,
            // `ZCGameRenderWorld.resolveBuildingFrame` 会问卡表的 buildIcon；桩里给空串
            // ⇒ 回退到「兵营 / 主城」的通用图分支，不抛错。
            getCardBuildIcon: () => '',
        },
    };
    const load = (name: string): any => {
        if (cache[name]) return cache[name];
        if (name === './ZCCombatCatalog') return cache['../model/ZCCombatCatalog'];
        // ⚠️ 必须用 `join` 规范化，不能字符串拼接：`name` 可能是跨层相对路径
        // （如 `../../../core/hex/HexGridLayout`），拼接时 `..` 会少回落一层
        // （`zcds/view/../../core` → `app/core`），于是去读一个不存在的文件 ——
        // 症状是**整组用例一起红**，而且报错指向的是「模块不存在」这种看起来像产品代码的问题
        // （2026-09-30 实测：core/hex 抽取落地后一次红 33 条）。
        const relative = name.replace(/^\.\//, '');
        const viewPath = join('assets/script/app/zcds/view', `${relative}.ts`);
        const path = existsSync(viewPath) ? viewPath : join('assets/script/app/zcds/ui', `${relative}.ts`);
        if (!existsSync(path)) throw new Error(`Missing view fixture module ${name} at ${path}`);
        const code = ts.transpileModule(readFileSync(path, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
        }).outputText;
        // ⚠️ `console` 必须**显式透传**：`runInNewContext` 建的是另一个 realm，里面的 `console`
        // 不是本进程那个对象。视图层「卡面图缺失」这类开发日志要用例断言（见 zcds-progress.test.ts），
        // 不透传的话用例去替换 `console.warn` 就抓不到任何记录 —— 表现为「日志 0 次」，
        // 而代码其实在正常打日志。
        const context = { exports: {} as any, require: load, console };
        runInNewContext(code, context);
        return cache[name] = context.exports;
    };
    // `spriteFrame` 是血条按阵营换图后新增的读取点（原来只读 `color` 染色）。
    const bar = () => ({ node: new FakeNode(), progress: 0, totalLength: 24, barSprite: { node: new FakeNode(), color: null as any, spriteFrame: null as any } });

    /**
     * 构造一个**真实的** `ZCEffectPool`（连同它内部用的 `ZCNodePool`），供特效行为测试使用。
     *
     * 测试只通过公开 API（play / recycle / detach / clear / destroy 各方法）+ 观察节点挂点 / 坐标
     * 来验证，不再访问渲染世界或特效池的私有字段。资源与正式流程一致，在构造时传入。
     * `mapToViewX/Y` 默认给一个非恒等的可辨识换算，便于断言「坐标确实过了换算」。
     */
    function makeEffectPool(init?: {
        mapLayer?: any;
        spawnFxPrefab?: any;
        deathFxPrefab?: any;
        hitFxPrefabs?: Map<any, any>;
        mapToViewX?: (x: number) => number;
        mapToViewY?: (y: number) => number;
    }) {
        const { ZCNodePool } = load('./ZCNodePool');
        const { ZCEffectPool } = load('./ZCEffectPool');
        const mapLayer = init?.mapLayer ?? new FakeNode('MapLayer');
        const pool = new ZCNodePool();
        const effectPool = new ZCEffectPool({
            pool,
            mapLayer,
            spawnFxPrefab: init?.spawnFxPrefab ?? null,
            deathFxPrefab: init?.deathFxPrefab ?? null,
            hitFxPrefabs: init?.hitFxPrefabs ?? new Map(),
            // 默认非恒等：棋盘坐标 (x,y) 加一个可辨识偏移，证明特效确实过了换算。
            mapToViewX: init?.mapToViewX ?? ((x: number) => x + 100),
            mapToViewY: init?.mapToViewY ?? ((y: number) => y + 50),
        });
        return { effectPool, pool, mapLayer };
    }

    /**
     * 构造一个**真实的** `ZCWallRenderer`（连同真实 `ZCWallGeometry`），供城墙渲染行为测试使用。
     *
     * 测试只通过公开 API（`render` / `destroy`）+ 观察墙层子节点的 Sprite 结果来验证，不再
     * 覆写渲染世界的私有 `wallSegment`，也不 new 整个上帝类。墙砖 prefab 走 `{ make }`（夹具的
     * `cc.instantiate = prefab => prefab.make()`），每块墙砖是一个挂了真实 `cc.Sprite` 的 FakeNode：
     * 渲染器走 instantiate → setParent → getComponent(Sprite) 的完整路径，节点池由渲染器自管。
     *
     * `tiles()` 按墙层子节点顺序（= 全盘 y 降序的创建顺序）返回当前墙砖 Sprite；`enabled` 为 false
     * 的是上一轮重绘后被隐藏的池节点（缺口重绘时会出现）。
     */
    function makeWallRenderer(init?: {
        wallFrames?: Map<string, any>;
        wallMaterial?: any;
        map?: readonly any[];
    }) {
        const { ZCWallGeometry } = load('./ZCWallGeometry');
        const { ZCWallRenderer } = load('./ZCWallRenderer');
        const wallGeometry = new ZCWallGeometry();
        wallGeometry.setMap(init?.map ?? ZC_HEX_CONFIG);
        const wallLayer = new FakeNode('WallLayer');
        const wallPrefab = {
            make() {
                const node = new FakeNode();
                // 与真实墙砖 prefab 同构：节点上挂 Sprite，渲染器靠 node.getComponent(Sprite) 取它。
                const sprite = node.addComponent(cc.Sprite);
                sprite.node = node;
                sprite.spriteFrame = null;
                sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
                sprite.color = new Color(255, 255, 255, 255);
                sprite.enabled = false;
                sprite.customMaterial = null;
                // 缺图回退路径在 sprite 上调 getComponent(UITransform)；转发到节点，拿到桩的 UITransform。
                sprite.getComponent = (type: any) => node.getComponent(type);
                return node;
            },
        };
        const renderer = new ZCWallRenderer({
            wallGeometry,
            wallPrefab,
            wallLayer,
            wallMaterial: init?.wallMaterial ?? null,
            wallFrames: init?.wallFrames ?? new Map(),
        });
        const tiles = () => wallLayer.children.map((child) => child.getComponent(cc.Sprite));
        return { renderer, wallGeometry, wallLayer, tiles };
    }

    return { load, bar, FakeNode, cc, makeEffectPool, makeWallRenderer };
}
