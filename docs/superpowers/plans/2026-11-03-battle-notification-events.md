# 战斗通知事件收敛

用户确认将 navigate、showTip、recordPveResult 三类通知回调替换为事件，异步服务与生命周期端口保持显式调用。

## 设计与实施

- [x] ZCBattleEvents 集中定义 RETURN_TO_MAIN / SHOW_TIP；复用 PVE_RESULT。载荷仅包含数据与真实展示实例 owner，不携带回调。
- [x] Runtime 派发返回及提示事件；Settlement 用必填宿主元数据派发返回及 PVE 服务端结果，普通对局不派发 PVE 结果。
- [x] BattleComposition 初始化绑定通知，按当前展示实例过滤；本局返回参数在装配时计算。会话 scope 释放立即解除订阅，流程退出同样幂等释放。
- [x] 移除辅助/结算端口中的三类通知回调，保留 Promise 结果、请求取消、时钟与退订句柄；更新测试夹具及现行资源归属规范。

## 验证

以下绑定集 89 项通过：

```powershell
npx tsx --test tests/battle-runtime-controller.test.ts tests/zcds-settlement.test.ts tests/battle-entry-controller.test.ts tests/zcds-guide-lazy-lifecycle.test.ts tests/zcds-battle-phase.test.ts tests/view-intent-events.test.ts tests/callback-owner.test.ts tests/battle-preparation-entry.test.ts tests/territory-battle-session.test.ts tests/zcds-controller-resources.test.ts tests/battle-cover-handover.test.ts tests/flow-architecture.test.ts tests/bigmap-entry-cancellation.test.ts
```

真实组合层事件隔离与退订用例另 1 项通过：

```powershell
npx tsx --test --test-name-pattern '战斗流程只消费' tests/zcds-matching-preload.test.ts
```

回归覆盖真实 owner、错误 owner、原始组件销毁、换局、流程退出、导航参数及提示隔离，并检查会话销毁实际执行事件 off。

另运行整文件 `npx tsx --test tests/battle-runtime-controller.test.ts tests/zcds-settlement.test.ts tests/zcds-matching-preload.test.ts` 时，35 项通过、2 项失败：工作区新增 ZCRuntimePrecompiler 尚未注入匹配文件的 Loader 测试夹具，报 ensureZCRuntimeCompiled 不存在。本次保留该无关工作区改动，未修改 Loader/预编译器。

定向类型检查 `npx tsc --noEmit --pretty false -p $env:TEMP/battle-session-tsconfig.json` 仍未通过；本次事件、组合及控制器文件未报告错误。未进行 Creator 场景验证。
