# 主界面七入口 MVC

用户批准底栏统一导航、各功能独立 MVC，并要求公共能力放入控制器基类。

复用 ControllerBase，增加归属清理和事件订阅能力。框架基类不引用 app、网络单例或具体页面；业务通过清理动作接入。保留资源服务惰性解析。

MainTabController 管理切换，MainTabModel 保存当前/加载/覆盖页状态，MainTabHost 只负责节点装配和绘制。七入口沿用实际路径：商城 Store、英雄 CardLineup、角色 Role、领地主城 ArenaRoot、挑战锁定、联盟 LeagueTab、世界覆盖页。保留外部 switchToTab 入口和首屏 ready、首充、预热时序。

异步切换最后请求生效，同目标合并，成功后提交，失败保留旧页，取消释放待加载作用域。世界保留底页且返回恢复高亮。程序跳转不计用户点击。

商城沿用 StoreActions/Repository，分段点击改发意图；英雄取数和结果事件移入功能控制器；角色取数、背包选择及导航决策移入控制器；联盟入盟判定移入控制器并用事件替代 onJoined；领地与世界保留既有 Model/Controller，只合并公共清理。挑战不凭空实现玩法。

比较方案：保留组件内全部编排改动少但职责混杂；全功能统一大控制器会耦合业务；选择功能独立控制器并复用基类。不改 Prefab 结构、不改美术、不增加全局状态。不覆盖已有 TerritoryModel 与对应测试的用户改动。

## 所有权修正：Page 不持有控制器

用户反馈“Page 持有控制器不合理”。本次据此明确单向所有权：`ProcedureMain → MainTabsComposition → MainTabController / MainPageComposition → 功能控制器与 TerritoryEntry`。所有组合代码位于 `app/bootstrap/main`。

Page 不再 import、创建、保存或 dispose 业务控制器，也不再用 ComponentController 作资源宿主。只注入展示资源契约，提供渲染方法、派发输入意图及生命周期事件。控制器引用 View 的渲染端口，View 不保存反向引用或退出闭包。MainPage 的快速寻敌和地图首屏就绪同步改为事件。

组合层必须在 setParent 前组装与注入；页面完成输入/渲染订阅后报告 ready，外部才启动业务；角色 enabled/disabled 控制刷新与取消。切页、流程取消、挂载失败及销毁统一释放。展示资源的 scope 随页组合释放，控制器仍复用 ControllerBase。世界覆盖页沿用 BigMapEntry 的外部所有权。
