# 战斗运行期归属收敛

用户确认：外部只操作会话，运行期、结算保留独立职责，避免合成巨型控制器。

## 设计与实施

- [x] 会话在创建展示组件后，接收组合层返回的窄运行期句柄（start / dispose），先持有再启动；移除组合层保存运行控制器及 releaseRuntime 回调。
- [x] 会话负责运行期句柄、展示组件及整局资源；运行期负责结算与辅助弹窗；结算负责自身请求、流程监听及结算弹窗。初始化失败与正常退出使用同一释放入口。
- [x] 释放顺序：断开会话输入 → 运行期停止输入与时钟 → 结算关闭请求/弹窗 → 辅助弹窗 → 展示 shutdown/destroy → 会话资源。重复释放幂等，清理异常不能跳过剩余层级。
- [x] 更新实际行为与组合边界回归，验证初始化失败、部分装配失败、取消、迟到回调和释放顺序；更新相关归属规范。

不改业务阶段、战斗规则、网络协议或弹窗重复打开策略。组合层只装配，不长期保存子控制器。

## 验证结果

104 项通过、0 失败，实际命令：

```powershell
npx tsx --test tests/battle-entry-controller.test.ts tests/battle-runtime-controller.test.ts tests/zcds-settlement.test.ts tests/zcds-battle-phase.test.ts tests/zcds-matching-preload.test.ts tests/zcds-guide-lazy-lifecycle.test.ts tests/callback-owner.test.ts tests/view-intent-events.test.ts tests/battle-preparation-entry.test.ts tests/territory-battle-session.test.ts tests/zcds-controller-resources.test.ts tests/battle-cover-handover.test.ts tests/flow-architecture.test.ts tests/bigmap-entry-cancellation.test.ts
```

新增回归先确认失败再实现，包括清理异常不跳过弹窗/资源、初始化与清理同时失败时保留初始化原始错误。定向类型检查 `npx tsc --noEmit --pretty false -p $env:TEMP/battle-session-tsconfig.json` 仍有既有领地意图、渲染目标及旧引擎声明错误，本次四个控制器/组合文件未报告错误。未做 Creator 场景运行验证。
