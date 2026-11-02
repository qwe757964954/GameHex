# 资源加载管理器实施计划

目标：按已确认建议增加统一队列、优先级、批量进度与取消，保留 AssetService 和现有资源归属。

设计：组合根持有 ResourceLoadManager，包装 CocosAssetService，向流程和弹窗注入。共享纯 TS ResourceLoadQueue 调度实现，ScopedAssetCache 的局部并发预算也复用它，保留缓存合并、动态提优与 TTL。应用总并发初始为 4，沿用当前会话加载预算；预下载默认优先级 -1，同优先级 FIFO，不抢占在途任务。has 仅预检索引，不占下载名额。

取消：ResourceScope 销毁立即拒绝单项等待；批量句柄 cancel / 父作用域销毁返回 false，错误保持 reject。排队任务移除，在途引擎任务不伪装成已中止，占位到实际完成；迟到结果不更新进度。管理器 dispose 拒绝所有等待。资源仍归真实 scope，无新全局缓存。ResourceScope.defer 返回可移除登记，避免完成请求残留取消回调。

批量 API：loadBatch(requests, { scope, onProgress }) 返回 { result, cancel }，完成按输入顺序返回资产，进度是已完成项数/总项数（空清单为 1），成功资源跟随父作用域；失败释放该批资产并停止后续派发。进度不代表字节或引擎依赖数量。

实施与验证（单 Agent，复用当前工作区，不提交）：

- [x] 新增真实调度/批量行为测试，先确认缺少实现时失败。
- [x] 实现 ResourceLoadQueue、ResourceLoadManager、可解除的 scope 登记；提取缓存调度并接入启动层，销毁时释放管理器。
- [x] 跑新测试及缓存、作用域、引擎资源生命周期、流程预加载与会话预热相关最小集；检查类型与差异；通过 Cocos 刷新新脚本 meta。

审查重点：取消不突破物理并发、同步抛错后继续调度、失败后不报完成进度、重复路径保留缓存租约、作用域清理不跳过其他释放动作。

## 接入与验证记录

`AssetService.loadBatch` 为可选能力，组合根注入管理器后可直接使用；`scopeAssetService` 保留该入口的真实宿主绑定。批量必须显式传入父作用域，不自动接管其他 scope。现有 `ScopedAssetCache` 继续负责缓存租约与复用，局部并发预算和应用全局预算分别生效，共用调度实现。

```typescript
const batch = assets.loadBatch(requests, { scope, onProgress });
const values = await batch.result; // false 表示已取消；失败使用 catch 处理。
// 宿主退出时 scope.dispose()；需要单独取消本批时 batch.cancel()。
```

实际验证：

```text
npx tsx --test tests/resource-load-manager.test.ts tests/scoped-asset-cache.test.ts tests/asset-scope-binding.test.ts tests/cocos-resource-lifecycle.test.ts tests/controller-resources.test.ts tests/bundle-scope.test.ts tests/procedure-manager-preload.test.ts tests/battle-common-warmup.test.ts tests/preview-loading-warmup.test.ts tests/battle-idle-parse.test.ts tests/matching-resources.test.ts tests/zcds-matching-preload.test.ts tests/zcds-game-preload.test.ts tests/flow-architecture.test.ts
91/91 通过。

npx tsc --noEmit --skipLibCheck --target ES2022 --module commonjs --moduleResolution node --esModuleInterop tests/resource-load-manager.test.ts
退出码 0。

git diff --check -- assets/script/core/asset assets/script/app/bootstrap/ProcedureBootstrap.ts
无空白错误。
```

已通过 Cocos MCP 刷新 `db://assets/script/core/asset`，引擎生成两份新脚本 meta。全工程 `npx tsc --noEmit` 未通过（引擎声明、其他业务与临时文件存在错误）；单独检查新增核心实现和测试通过，不宣称全工程编译通过。未执行编辑器内游戏运行和实机性能测试。
