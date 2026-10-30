import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import * as ArtPaths from '../../assets/script/app/ArtPaths';
import * as BundleCatalog from '../../assets/script/core/asset/BundleCatalog';

export class TestSpriteFrame {
    refs = 0;
    isValid = true;
    addRef() { this.refs++; return this; }
    decRef() { this.refs--; return this; }
    destroy() { this.isValid = false; }
}

export function loadSpriteFrameCache(routedLoad?: unknown) {
    const exports = {};
    const dependencies: Record<string, unknown> = {
        cc: { SpriteFrame: TestSpriteFrame },
        '../ArtPaths': ArtPaths,
        '../../core/asset/BundleCatalog': BundleCatalog,
        './RoutedResource': { routedLoad },
    };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/common/SpriteFrameCache.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console: { warn() {} }, require(name: string) {
        if (name in dependencies) return dependencies[name];
        throw new Error(`Unexpected dependency: ${name}`);
    } });
    return exports as typeof import('../../assets/script/app/common/SpriteFrameCache');
}
