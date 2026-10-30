# Territory chapter context implementation plan

**Goal:** 落实已确认的 review 方案：章节数据原子替换，加载期推送不丢失，销毁后无副作用。

**Architecture:** Presenter 持有可空章节上下文；加载任务持有目标章的去重通关增量与快照。沿用 TerritoryProgress 单调合并、loadId 竞态校验和页面归属取消机制。

**Constraints:** 保留当前工作区改动；不改 Prefab、生成文件或业务协议；加载失败保留旧章显示；不自动提交。

- [x] 新增加载期间推送、拉取失败、切章隔离、销毁及页面无地图接收的行为测试，确认失败。
- [x] 将 map/progress/saveState 与关联章节元数据收拢到上下文，本地构建完成后一次发布。
- [x] 两个推送入口只处理生命周期和章节路由，内部合并接收非空上下文；加载期间按目标章暂存，成功后消费，失败/取消/销毁清理。
- [x] 页面在地图未就绪时也解析快照；地图边界由目标上下文的 TerritoryProgress 裁剪。
- [x] 运行领地规范绑定测试及协议、订阅回归，检查 diff。

**Review focus:** 推送快照不含新增占领格时解锁态也需刷新；重复推送幂等；旧章迟到消息不可污染目标章；失效加载不能清理后续任务的暂存；快照失败不能清除已收到的推送。

**Validation:** `npx tsx --test` 运行 territory-presenter、territory-page-split、territory-cell-center-align、territory-hex-flip、territory-building-shake、territory-hex-spawn、territory-cell-protocol、territory-cell-subscriptions、territory-cell-write-concurrency、view-intent-events、territory-boss-and-random-building 共 205 项，204 通过。唯一失败是未改动的建筑资源尺寸守卫（territory_decor_03_v1 高 90.1 > 76.5）。全仓 `npx tsc --noEmit --pretty false` 仍有大量工程/Cocos 声明及既有测试诊断，三个改动业务文件未出现诊断。未进行引擎运行时验证。

**Review:** 独立审查指出旧章在途拉取会吞掉新章推送。已用实际响应对象的 WeakSet 替换全局在途门闩，并用页面/Repository 集成测试验证；复审无其他重要问题。

**生命周期约束调整:** 按用户最终要求，移除 TerritoryPresenter 的整个 disposed 字段与所有入口、异步恢复和渲染中的相关判断。同步投递由宿主解除订阅；dispose 主动作废既有 loadId/interactionId，释放章节上下文，消费各请求登记的 loading 释放动作。await 恢复只校验任务版本，未引入另一份生命周期标志。测试不再将退出后直接调用业务入口视为有效用法，覆盖退出后迟到加载/快照/写请求不能落盘、广播或重复 hide。本轮 8 个测试文件共 188 项，187 通过，唯一失败仍是未改动的美术尺寸守卫；独立复审无重要发现。
