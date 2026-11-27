# tests/ 索引与约定

本文件解决两件事：**找不到**（哪个文件管哪块）和**写不对**（新用例该用哪套手法）。
测试规模与分域索引见「前缀索引」，由 `npm run index:tests` 从文件系统统计、`npm run index:tests:write` 回写。
全部跑在 `node:test` 上（无 jest / vitest）。

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
> `npm test` 走的是分批执行器：单进程跑 516 个文件实测会挂住（工程内记录 449 个文件
> 23m39s 不返回），分批 60 个文件 ≈130s 跑完。想还原旧行为用 `npm run test:raw`。

## 为什么是平铺而不是按域建子目录

历史上规范表整体搬过一次家（`AGENTS.md` → `docs/agent/`），硬编码路径的护栏在搬家当天
**静默失效**（路由命中数掉到 0 且照样打印 PASS）。`AGENTS.md` 和路由表里散着上百条
`npx tsx --test tests/xxx.test.ts` 硬编码路径，按域重组目录等于把同一个坑再挖一遍。

所以维持平铺 + **文件名前缀即功能域**，靠本文件做索引。

### 目录约束

- `tests/*.test.ts` 必须平铺：`tools/verify/verify.mjs` 只读 `tests` 顶层 `.test.ts`，放进子目录不会被默认发现。
- 夹具统一放 `tests/fixtures/`，辅助放 `tests/helpers/`；`__pycache__/` 不入库。
- 新增、重命名或合并用例后跑 `npm run index:tests:write`，不要手改计数。

## 前缀索引

`文件` 是 `.test.ts` 个数，`用例` 是 `test()/it()` 声明数，`已进路由表` 指被
`docs/agent/规范路由与最小验证.md` 显式引用（未引用不等于不跑 —— `verify.mjs` 还有 import
反向可达与路径字面量两条机械判据兜底）。

<!-- TEST-INDEX:BEGIN -->
共 650 个测试文件、201,294 行、7,483 条用例（2026-11-16 实测；`npm run index:tests` 可重算）。

| 前缀 | 文件 | 用例 | 已进路由表 |
| --- | --- | --- | --- |
| `zcds` | 212 | 2168 | 37 |
| `territory` | 104 | 1371 | 29 |
| `bigmap` | 67 | 538 | 11 |
| `card` | 31 | 344 | 7 |
| `role` | 21 | 121 | 0 |
| `guide` | 19 | 227 | 19 |
| `league` | 18 | 494 | 17 |
| `main` | 18 | 164 | 3 |
| `chest` | 11 | 95 | 2 |
| `battle` | 9 | 109 | 3 |
| `matching` | 8 | 58 | 0 |
| `login` | 6 | 27 | 6 |
| `map` | 4 | 133 | 0 |
| `popup` | 4 | 33 | 0 |
| `pvp` | 4 | 26 | 0 |
| `common` | 3 | 14 | 0 |
| `framework` | 3 | 22 | 0 |
| `prefab` | 3 | 10 | 0 |
| `sprite` | 3 | 18 | 0 |
| `asset` | 2 | 10 | 1 |
| `auto` | 2 | 10 | 2 |
| `component` | 2 | 2 | 0 |
| `config` | 2 | 9 | 0 |
| `equip` | 2 | 9 | 0 |
| `firstRecharge` | 2 | 43 | 0 |
| `game` | 2 | 14 | 0 |
| `hero` | 2 | 16 | 2 |
| `hot` | 2 | 34 | 2 |
| `militia` | 2 | 23 | 1 |
| `network` | 2 | 28 | 0 |
| `post` | 2 | 16 | 0 |
| `preview` | 2 | 11 | 0 |
| `procedure` | 2 | 16 | 1 |
| `reddot` | 2 | 26 | 0 |
| `reward` | 2 | 23 | 1 |
| `store` | 2 | 36 | 0 |
| `tab` | 2 | 14 | 0 |
| `ui` | 2 | 15 | 0 |
| `verify` | 2 | 17 | 0 |
| 其余 62 个单文件前缀 | 62 | 1139 | 15 |
<!-- TEST-INDEX:END -->

单文件前缀（一个功能一个文件，按需 grep）：`activity`、`art`、`battletoken`、`bootstrap`、
`bundle`、`cache`、`callback`、`celebration`、`center`、`chapter`、`chat`、`cocos`、`common`、
`controller`、`definition`、`disconnect`、`engine`、`first`、`flow`、`formation`、`friend`、
`gift`、`hang`、`head`、`hex`、`http`、`isolated`、`itemdetail`、`iteminfo`、`limittimeact`、
`lineup`、`mail`、`maintask`、`monthcard`、`new`、`no`、`playerinfo`、`proto`、`quick`、
`rdExpr`、`rdVars`、`recharge`、`ref`、`res`、`resbar`、`resource`、`routed`、`scoped`、
`server`、`seven`、`showreward`、`storeActions`、`toast`、`tween`、`ui`、`view`、`vscroll`。

## 四类断言手法

> 「数量」是 2026-11-13 人工归类快照（合计 496），与当前 516 个文件不一致；归类依赖人工判断，
> 暂不随索引自动重算，仅作分布参考。

| 手法 | 数量（2026-11-13 快照） | 什么时候用 | 入口 |
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

## 已知遗留（2026-11-16 复核）

| 问题 | 现状 | 处置建议 |
| --- | --- | --- |
| 巨型文件 | `territory-presenter`（已于 2026-11-20 拆解为 battle/chapter/resource 3 个子文件并提取共享 fixture）、`map-editor` 2724/109、`hang` 2350/87、`zcds-model` 2328/66 | 按语义块拆成 3–4 个文件，不重写断言 |
| 单源文件被围猎 | `TerritoryMapView.ts` 被 **42** 个测试文件覆盖，每个都自带一份 cc 桩 | 根因是它本身太大；先拆源模块，测试自然收敛 |
| 重名用例 | 27 组同名（`D3 ⚠️ 所有节点 _layer 都是 UI_2D` ×5） | 加 `<域> ›` 前缀消歧；**改名会让基线失败名单失配**，需与 `baseline` 重算同批做 |
| 两种风格 | 510 个平铺 `test()`，6 个 `describe/it` | 非缺陷，两种都能被 TAP 采集；保持现状即可，新文件用平铺 |
| 未接进流水线的脚本 | `test_login_slices.py`（缺 Pillow，未接 npm）、`smoke_hotupdate_hook.mjs` 不在 `npm test` 里；其余 6 个 `tests/*.py` 已接 `test:*` 入口 | 补 `pip install Pillow` 后接入口，或长期标 manual；改前查 `package.json` |
