# hot-update 构建扩展（原生全构建目录热更新）

项目级 Cocos Creator 扩展。作用是在**每次构建之后**替原生包做两件热更新必需的事，
对应官方 `hot-update` 范例插件，但补上了随包清单的生成。

| 步骤 | 做什么 | 不做会怎样 |
| --- | --- | --- |
| 1. 注入 `main.js` | 把「恢复热更搜索路径」的片段放到 `main.js` **最前面** | 热更文件下载成功，但引擎仍从安装包读旧脚本 → **改了代码不生效** |
| 2. 生成随包 `project.manifest` | 遍历构建产物 `src` / `assets` / `jsb-adapter`，逐文件 md5 | 客户端没有"包内基线"，引擎无法算出差异列表 |

只处理 `android` / `ios`，其他平台直接跳过（Web 与小游戏的远程包走 Bundle 方案，不由本扩展管）。

## 目录

```
extensions/hot-update/
├── package.json          # contributions.builder → ./builder（目录形式，别写成 ./builder/index.js）
└── builder/
    ├── index.js          # 注册 hooks（构建进程执行 hook.js）
    ├── hook.js           # onAfterBuild：注入 + 生成随包清单
    └── inject.js         # 注入片段的唯一来源，同时提供 CLI 给发布脚本复用
```

⚠️ **`hooks` 的解析基准是 `contributions.builder` 所在目录，不是扩展根目录。**
所以端点必须写目录形式 `"./builder"`，`hooks: './builder/hook.js'` 才解析到
`extensions/hot-update/builder/hook.js`（与官方 hot-update 范例逐字一致）。

若把端点改成文件形式 `"./builder/index.js"`，dirname 变成 `builder/`，
hooks 会被解析成 `builder/builder/hook.js` ——**文件不存在，构建照样成功、
日志一条错都没有**，只是注入和随包清单全都静默不做（真机表现为热更永不生效）。
官方构建扩展模板同理：端点 `./dist/builder.js` 配 `hooks: './hooks'` → `dist/hooks.js`。

## 生效方式

扩展**装进 `extensions/` 不等于已生效**，要过三关（任一关没过都是「构建零报错、功能全无」）：

1. 编辑器**加载**了它 —— 新装或改过之后必须**重启编辑器**（主进程脚本只在启动时加载）；
2. 扩展管理器里处于**启用**状态：扩展 → 扩展管理器 → 项目 → `hot-update`，必要时点「重新载入」；
3. `hooks` 路径能解析到真文件（见上面的 ⚠️）。

过关后编辑器里「项目 → 构建发布」正常构建 `android` / `ios` 即可，扩展会自动跑。
构建日志里必须能看到这三行（第一行是**唯一的自证信号**）：

```
[hot-update] 构建钩子已载入（hook.js 被构建进程 require 成功）
[hot-update] 已注入搜索路径恢复片段：build\android\data\main.js
[hot-update] 已生成随包 project.manifest：2361 个文件 / 102886503 字节 / 版本 0.6.0.0
```

看不到第一行 → 扩展没被加载或 hooks 没解析到，别往下查业务逻辑。
发布脚本也会兜一次：产物里缺注入片段或随包清单时打一整屏告警（见 `tools/hotupdate/publish_hotupdate.py`
的 `warn_if_build_extension_skipped`）。

## 命令行复用

`--skip-build` 复用别人构建的产物时，`tools/hotupdate/publish_hotupdate.py` 会再调一次注入 CLI 兜底：

```bat
node extensions\hot-update\builder\inject.js build\android\data\main.js
```

幂等：已注入的文件重复执行不会叠加、内容逐字节不变（有单测守着）。

## 与官方范例的差异（刻意为之）

注入片段逐行对齐官方，但改了两处：

1. 取全局对象改成 `window || globalThis` 并显式判空 —— 官方版直接写 `window.jsb`，
   在没有 `window` 的进程里会抛。
2. 恢复中断更新时判断目录用 `charAt(length - 1)` —— 官方版写的是
   `srcPath[srcPath.length] === '/'`，下标越界恒为 `undefined`，该分支永远不进，
   目录项会掉进 `renameFile` 分支，父目录还没建时失败。

另外清单生成没有照抄官方 `version_generator.js`，而是抽到
`tools/hotupdate/hotupdate_manifest.js`，让**构建扩展**和**发布脚本**共用同一实现
（否则随包清单与远端清单的算法一旦漂移，差异比对会整包重下）。

## 清单生成器怎么被加载（构建进程只认相对说明符）

`hook.js` 要跨目录复用 `tools/hotupdate/hotupdate_manifest.js`，但**构建进程的 `require`
不认跨目录的绝对路径**。实测（2026-09-28，同一份 hook.js、同一次 android 构建）：

| 写法 | 结果 |
| --- | --- |
| `require('./inject.js')`（同目录、相对说明符） | ✅ 注入片段确实落进了 `build/android/data/main.js` |
| `require('<工程根>\tools\hotupdate\hotupdate_manifest.js')`（跨目录、绝对路径） | ❌ 抛错，且 `error.message` **是空的** |

那次构建日志里还出现过 `...\Creator\3.8.8\file:\D:\City1001\...` 这种 `file:` URL 与
Windows 路径混拼 ⇒ 该进程的 require 大概率按 **URL 语义**解析说明符，而 `D:\...` 不是合法说明符。
所以日志里那句「该文件被移动过？」是误导 —— 文件一直在原地。

现在 `loadManifestGenerator()` 走三层兜底，任一成功即用：

1. **读源码求值**（剥掉 shebang / BOM 后 `new Function`）—— **首选**，完全不经过宿主的模块系统；
2. **相对说明符** `../../../tools/hotupdate/hotupdate_manifest.js` —— 兜底；
3. `createRequire(工程根)` —— 再兜一层。

三层全失败才报错，并把每层失败原因连同 `rev=… ｜ __dirname=… ｜ cwd=…` 一起打出来。

⚠️ 这个差异**本地测不出**：原生 node 下两种 require 写法都能加载，`node tests/smoke_hotupdate_hook.mjs`
一直是全绿。所以冒烟用例里手工 patch `Module.prototype.require` 把「绝对路径被拒」造出来，
断言清单照常生成、且 require 缓存里没有生成器条目（证明是 fs 求值拿到的）。

### ⚠️ 改过扩展必须重启编辑器（否则改了像没改）

**构建进程跑的是编辑器启动时加载的那份内存副本。** 实测：14:13 改了 `hook.js`，
14:17 重新构建，日志里报的还是**改前的三行**、`error.message` 依旧为空 —— 看起来像「改了没用」。
所以 `hook.js` 里加了**版本指纹**：

```
[hot-update] 构建钩子已载入（hook.js 被构建进程 require 成功，rev 2026-09-28.2）
```

指纹没变 ⇒ 别往下查业务逻辑，先去重启编辑器（或扩展管理器里点「重新载入」）。

## 注意

- 构建时必须**关闭 MD5 Cache**（本项目 android 默认已是 `md5Cache: false`）。
  开了的话清单里的文件名会和产物对不上。扩展只在构建日志里告警，发布脚本会再拦一次。
- `main.js` / `application.js` **故意不进清单**：它们要在热更生效之前就把搜索路径恢复好，
  一旦被替换就会自锁。
- `remoteManifestUrl` 指向**渠道目录**而不是 release 目录 —— 渠道目录才是可变指针，
  包一装上就锁死在某个 release 会导致永远收不到后续更新。
