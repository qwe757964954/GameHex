# 登录与匹配统一工程架构

用户要求沿用已确定的主界面架构：Page 不持有 Controller；公共机制复用 ControllerBase，作为工程规范落地。

所有权为 Procedure → app/bootstrap 的 Composition → Controller + View + 适配器。Procedure 只转发 preload/mount/dispose；Composition 在挂载前注入展示依赖并监听生命周期；Controller 处理意图、异步时序、服务调用和导航；View 只读输入、渲染、报告生命周期。纯规则与状态进入 Model，网络/存储/引擎访问留在已有服务或适配器。

登录复用 LoginRoot/LoginGateway，不再在 Page 创建业务根。账号恢复、bootstrap、登录/注册、选服校验、延迟导航归 LoginController；选服面板与条目改用 owner 作用域的意图事件，取消 userData 回调。版本 JSON 经 AssetService 加载并校验。退出阻止后续请求步骤、持久化和导航，解除网络归属；保留成功后的会话重连能力。

匹配新增 MatchingModel 与 MatchingController。开战请求、PVP 资料合并、最短搜索 3 秒、成功展示 1.4 秒及战斗资源交接归控制器，Page 不再存 awaitReady/pickOpponents/onMatched。本局回包直接留在 Model，避免从全局最近回包反推本局；拒绝/失败返回主界面，不能进入假对局。退出取消定时器、解除请求归属并归还未移交的预加载。视图时间轴使用绝对起点，不累加 dt。

工程规范与架构守卫覆盖登录、匹配以及既有主界面：不得在 Page 创建或保存业务对象/控制器、不得透传业务回调、不得在 View 直接导航/网络/资源加载。保留既有 prefab 与正常用户行为；必要的 Button 绑定由 Cocos MCP 定位、修改与刷新。保护当前所有并行配置、协议和大世界改动，不提交或发布。
