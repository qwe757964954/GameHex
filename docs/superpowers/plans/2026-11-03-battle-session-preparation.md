# 对局准备统一到会话

用户已确认方案：复用 ResourceLoadManager / ScopedAssetCache / ResourceScope；单局 ZCBattleController 从准备持续持有资源，跨流程交接同一实例，删除 ZCGamePreload 与预加载专用 ComponentController。

## 实施与边界

- [x] 为真实会话增加准备幂等、等待回包、取消、失败和跨流程接管回归。
- [x] Controller 持有唯一准备 Promise 和 scope；运行节点装配延迟到 mount。接管先解除来源 scope 的释放登记，再登记目标流程；目标取消释放该会话，禁止重复接管。
- [x] 匹配和大地图创建会话；战斗组合层接收同一实例。领地由 TerritoryEntry 持有会话，View 只接收准备 Promise 和派发进入意图。保留领地准备失败后的直接加载回退及既有云层时序。
- [x] 清理旧预加载类与无效会话预加载 provider，入口参数归并到 ZCGameEntry；更新现行规范与相关测试。
- [x] 运行会话、匹配、领地、大地图取消、资源框架与流程归属绑定集；记录已有失败，不修改无关表现。

输入为本局参数、开战 Promise、资源服务；输出为首帧资源及可挂载会话。回包前取消不得启动加载，加载中取消后迟到结果不得挂载，失败立即释放且保留原错误；来源退出不得销毁已接管会话，运行节点拆除后才释放资源。不增加公共管理器或更改资源调度策略。

## 验证结果

绑定集 347 项通过，0 失败（会话、匹配、领地、大地图取消、资源框架、流程与 MVC 边界）。执行命令：

```powershell
npx tsx --test tests/battle-entry-controller.test.ts tests/battle-preparation-entry.test.ts tests/zcds-controller-resources.test.ts tests/zcds-matching-preload.test.ts tests/matching-controller.test.ts tests/territory-controller.test.ts tests/territory-presenter.test.ts tests/territory-mvc-boundary.test.ts tests/territory-battle-session.test.ts tests/bigmap-entry-cancellation.test.ts tests/battle-cover-handover.test.ts tests/post-login-loading.test.ts tests/flow-architecture.test.ts tests/view-intent-events.test.ts tests/callback-owner.test.ts tests/territory-battle-intro.test.ts tests/territory-battle-prelude.test.ts tests/territory-battle-approach.test.ts tests/territory-page-split.test.ts tests/bigmap-battle-enter-mask.test.ts tests/resource-load-manager.test.ts tests/scoped-asset-cache.test.ts tests/asset-scope-binding.test.ts tests/controller-resources.test.ts tests/cocos-resource-lifecycle.test.ts tests/procedure-manager-preload.test.ts tests/zcds-game-preload.test.ts tests/zcds-battle-phase.test.ts tests/battle-runtime-controller.test.ts tests/bigmap-battle-entry.test.ts
```

类型检查未通过：项目及依赖中仍有 selectChapter 意图类型缺失、ZCGameLoader 路径类型谓词、ZCGameRenderWorld goldCounter 契约及旧引擎全局声明等错误。本次不修复无关问题；未做 Creator 内运行验证。


## 后续收紧会话 API（用户确认后执行）

- [x] 创建输入改为 `{ owner, battle?, params? }`，owner 必填；构造时登记来源并启动唯一准备任务，公开只读 `ready`，移除 `prepare` / `retainUntilHandoff` 的调用顺序依赖。
- [x] 流程通过 `adopt(params, context)` 接管，直接进入时在创建前传入完整参数；保留取消、原始失败、禁止重复接管及资源释放顺序。
- [x] 匹配、领地、大地图与直接进入适配；目标已取消或已释放时不创建会话和启动加载。
- [x] 回归验证：先确认新增 API 与已取消直入用例失败，再运行上方完整绑定集命令，350 项通过、0 失败；相关文件 `git diff --check` 通过（仅行尾转换提示）。本轮未运行 Creator 场景验证及全工程类型检查。
