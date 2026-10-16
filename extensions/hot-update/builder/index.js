/**
 * 构建扩展入口（构建进程加载）。
 *
 * `configs['*'].hooks` 指向构建进程里执行的钩子脚本；本文件只负责注册，
 * 真正干活的是 `./hook.js` 的 `onAfterBuild`。
 *
 * ⚠️ hooks 路径的解析基准 = **`contributions.builder` 所在目录**，不是扩展根目录。
 * 这条结论由三处证据交叉推出：
 *   1. 官方 hot-update 范例（cocos-tutorial-hot-update/extensions/hot-update）：
 *      端点 `"builder": "./builder"`（目录形式）+ `hooks: './builder/hook.js'`；
 *   2. 官方构建扩展模板（Creator 内置 builtin/builder/build-plugin-template）：
 *      端点 `"builder": "./dist/builder.js"` + `hooks: './hooks'` → `<ext>/dist/hooks.js`，
 *      与它的 `dist/hooks.js` 对得上；
 *   3. 同模板的 `assetHandlers: './asset-handlers'` 同样落在 `dist/`。
 *
 * 所以 package.json 里的端点**必须**写目录形式 `"./builder"`。
 * 一旦写成 `"./builder/index.js"`，dirname 变成 `builder/`，
 * 本行就会解析成 `builder/builder/hook.js` —— 文件不存在，
 * 构建照常成功、日志里一条报错都没有，只是注入和随包清单都不做。
 */
'use strict';

exports.load = function () {
    console.log('[hot-update] 构建扩展已加载');
};

exports.unload = function () {
    console.log('[hot-update] 构建扩展已卸载');
};

exports.configs = {
    '*': {
        hooks: './builder/hook.js',
    },
};
