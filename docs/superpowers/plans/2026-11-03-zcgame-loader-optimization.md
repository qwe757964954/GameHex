# ZCGameLoader 优化

用户已确认落实三项：外壳具名结果、纯表现资源清单、可选资源失败与取消处理。保留现有加载顺序、优先级、首帧/后补分界、后补串行节奏及资源归属。

## 实施与边界

- [x] loadShellPrefabs 返回具名对象，必需外壳与两个条件资源由 ZCGamePreparedResources 的 Pick 表达；复用 ResourceLoadManager 批次与取消/失败释放。
- [x] 现有 ZCVisualResourcePlan 新增纯清单计算；输入目录、技能计划、参战单位和本局修正器，输出模型与去重特效路径。保留召唤闭包、普攻、命中附加、强化、副轨和离线完整目录。
- [x] Loader 内收敛可选资源加载边界：请求前和异步完成后检查 scope；普通缺失沿用 null/空集合降级，取消向上传播且不记录缺图；受击诊断保留 error 级别。必需外壳失败继续终止。
- [x] 先确认新增用例失败，再通过相关回归。测试直接使用真实 Plan 函数和真实 Loader，替换引擎及 I/O 边界。

## 验证

以下命令 155 项通过、0 失败：

```powershell
npx tsx --test tests/zcds-game-preload.test.ts tests/zcds-sprite-frame-loader.test.ts tests/preview-battle-resource-plan.test.ts tests/zcds-matching-preload.test.ts tests/zcds-map-loading.test.ts tests/zcds-game-resources.test.ts tests/zcds-guide-lazy-lifecycle.test.ts tests/battle-entry-controller.test.ts tests/battle-preparation-entry.test.ts tests/zcds-controller-resources.test.ts tests/territory-battle-session.test.ts tests/bigmap-entry-cancellation.test.ts tests/resource-load-manager.test.ts tests/scoped-asset-cache.test.ts tests/asset-scope-binding.test.ts tests/controller-resources.test.ts tests/cocos-resource-lifecycle.test.ts tests/procedure-manager-preload.test.ts tests/zcds-spawn-fx.test.ts tests/zcds-hit-fx.test.ts
```

定向类型检查：`npx tsc --noEmit --pretty false -p $env:TEMP/battle-session-tsconfig.json`。配置位于仓库外，复用前轮的入口范围与引擎声明。检查未通过：领地 selectChapter 意图、ZCGameRenderWorld goldCounter、旧引擎类型/全局声明等仍有错误；ZCGameLoader / ZCVisualResourcePlan 未报告错误。未进行 Creator 内运行或性能测量。
