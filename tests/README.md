# tests/ 索引与约定

496 个测试文件、约 15 万行、5.8 千条用例，全部跑在 `node:test` 上（无 jest / vitest）。
本文件解决两件事：**找不到**（哪个文件管哪块）和**写不对**（新用例该用哪套手法）。

## 怎么跑

```bash
npm test                                        # 全量，分批跑（≈130s），只报结果不比基线
npm run test:raw                                # 全量，单进程（会挂住，仅排障用）
npx tsx --test tests/zcds-hit-fx.test.ts        # 单文件
node tools/verify/verify.mjs route              # 只打印「你改了这些文件 → 该跑哪些用例」
node tools/verify/verify.mjs check              # 跑 diff 命中的最小集 + tsc，比基线（日常用这个）
node tools/verify/verify.mjs full               # 全量 + tsc，比基线
node tools/verify/verify.mjs reds               # 重新生成基线红清单，并单跑复核每条红
```

> ⚠️ **不要用「跑一遍看绿不绿」判断改动安全**。本工程基线长期带红，唯一有效判据是
> 「相对基线零新增」，由 `verify.mjs` 的差集给出。裸跑全量只会看到一片红。
>
> `npm test` 走的是分批执行器：单进程跑 496 个文件实测会挂住（工程内记录 449 个文件
> 23m39s 不返回），分批 60 个文件 ≈130s 跑完。想还原旧行为用 `npm run test:raw`。

## 为什么是平铺而不是按域建子目录

历史上规范表整体搬过一次家（`AGENTS.md` → `docs/agent/`），硬编码路径的护栏在搬家当天
**静默失效**（路由命中数掉到 0 且照样打印 PASS）。`AGENTS.md` 和路由表里散着上百条
`npx tsx --test tests/xxx.test.ts` 硬编码路径，按域重组目录等于把同一个坑再挖一遍。

所以维持平铺 + **文件名前缀即功能域**，靠本文件做索引。

## 前缀索引

`文件` 是 `.test.ts` 个数，`用例` 是 `test()/it()` 声明数，后四列是断言手法分布（见下节），
`已进路由表` 指被 `docs/agent/规范路由与最小验证.md` 显式引用（未引用不等于不跑 —— `verify.mjs`
还有 import 反向可达与路径字面量两条机械判据兜底）。

| 前缀 | 文件 | 用例 | 单测 | 沙箱 | 源码 | 资源 | 已进路由表 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `zcds` | 148 | 1404 | 48 | 26 | 37 | 37 | 36 |
| `territory` | 81 | 1095 | 30 | 23 | 22 | 6 | 26 |
| `bigmap` | 66 | 522 | 27 | 28 | 6 | 5 | 7 |
| `card` | 27 | 274 | 9 | 10 | 3 | 5 | 0 |
| `league` | 16 | 480 | 7 | 3 | 4 | 2 | 3 |
| `main` | 15 | 130 | 6 | 4 | 4 | 1 | 3 |
| `battle` | 9 | 98 | 4 | 4 | 1 | 0 | 0 |
| `chest` | 7 | 52 | 1 | 4 | 1 | 1 | 0 |
| `matching` | 7 | 49 | 4 | 2 | 1 | 0 | 0 |
| `login` | 6 | 27 | 1 | 4 | 1 | 0 | 0 |
| `map` | 4 | 130 | 1 | 1 | 0 | 2 | 0 |
| `popup` | 4 | 30 | 2 | 2 | 0 | 0 | 0 |
| `pvp` | 4 | 23 | 3 | 0 | 1 | 0 | 0 |
| `framework` / `role` / `sprite` | 3 各 | — | — | — | — | — | 0 |
| 其余 57 个单文件前缀 | 57 | — | 见下表 | | | | 5 |

单文件前缀（一个功能一个文件，按需 grep）：`activity`、`art`、`battletoken`、`bootstrap`、
`bundle`、`cache`、`callback`、`celebration`、`center`、`chapter`、`chat`、`cocos`、`common`、
`controller`、`definition`、`disconnect`、`engine`、`first`、`flow`、`formation`、`friend`、
`gift`、`hang`、`head`、`hex`、`http`、`isolated`、`itemdetail`、`iteminfo`、`limittimeact`、
`lineup`、`mail`、`maintask`、`monthcard`、`new`、`no`、`playerinfo`、`proto`、`quick`、
`rdExpr`、`rdVars`、`recharge`、`ref`、`res`、`resbar`、`resource`、`routed`、`scoped`、
`server`、`seven`、`showreward`、`storeActions`、`toast`、`tween`、`ui`、`view`、`vscroll`。

## 四类断言手法

| 手法 | 数量 | 什么时候用 | 入口 |
| --- | --- | --- | --- |
| **单测** | 177 | Model / 纯函数 / 协议编解码，真模块能直接 `import`（不拖 `cc`） | 直接 import |
| **沙箱** | 141 | 视图 / 控制器依赖 `cc`，node 里 import 不进来 | `helpers/cc-sandbox.ts` |
| **源码守卫** | 113 | 要钉的是「**必须这么写**」而不是「运行结果」（如 `withTimeout + catch` 漏写） | `helpers/source-text.ts` |
| **资源校验** | 65 | prefab 的 `__type__` / `_layer` / uuid 可反解，config 列表齐全，png 透明通道 | `helpers/asset-paths.ts` + `readFileSync` |

**优先级**：能用单测就不用沙箱；能用沙箱就不写源码守卫。源码守卫对格式敏感（换行符、
缩进、变量改名全都会假红），只在「行为无法在 node 里观察到」时才用。

## 新增测试文件的五条约定

1. **文件名 `<域>-<主题>.test.ts`**，域取上表已有前缀；新域先在本文档登记。
2. **用例名写成一句话结论**，能自证「为什么存在」。工程内的好例子：
   `D3 ⚠️ 所有节点 _layer 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染且不报错）`。
   带 ⚠️ 的是「静默失效」类断言（错了不报错、只是不生效），这类尤其要把后果写进名字。
3. **读源码一律走 `readSource()`**，不要裸 `readFileSync(x, 'utf8')`。源码一旦整份
   LF→CRLF，硬编码 `'\n'` 的切片与含换行的正则会集体假红（2026-11-11 已踩过）。
4. **沙箱一律走 `loadTsModule()`**，并把 `unresolved` 断言成 `[]`，或写清为什么可以非空。
   内联 `runInNewContext` + `return {}` 兜底会让「漏桩」表现为 `undefined` 而不报错 ——
   用例开始测空气，仍然是绿的。
5. **不要复制算法**。断言用的常量、几何公式从源模块 import；复制一份等于给自己发一张
   永远绿的假证书。

## 已知遗留（2026-11-13 体检，未处理）

| 问题 | 现状 | 处置建议 |
| --- | --- | --- |
| 巨型文件 | `territory-presenter` 3405 行/111 用例、`map-editor` 2724/109、`hang` 2350/87、`zcds-model` 2328/66 | 按语义块拆成 3–4 个文件，不重写断言 |
| 单源文件被围猎 | `TerritoryMapView.ts` 被 **34** 个测试文件覆盖，每个都自带一份 cc 桩 | 根因是它本身太大；先拆源模块，测试自然收敛 |
| 重名用例 | 27 组同名（`D3 ⚠️ 所有节点 _layer 都是 UI_2D` ×5） | 加 `<域> ›` 前缀消歧；**改名会让基线失败名单失配**，需与 `baseline` 重算同批做 |
| 两种风格 | 490 个平铺 `test()`，6 个 `describe/it` | 非缺陷，两种都能被 TAP 采集；保持现状即可，新文件用平铺 |
| 未接进流水线的脚本 | `tests/*.py`（7 个）、`smoke_hotupdate_hook.mjs` 不在 `npm test` 里 | 已有独立入口（`test:hotupdate-publish` 等），改前查 `package.json` |
