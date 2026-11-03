# 战斗入口 MVC 实施计划

沿用已确认的外部组合设计，按 writing-plans / executing-plans 在当前工作区实施，不提交版本库。保留既有战斗规则、选点与表现算法及并行大地图改动。

边界：ProcedureGame 只转发生命周期，兼容 current 只读查询；bootstrap/battle/BattleComposition 装配运行组件、资源与账号存档适配器；application/ZCBattleController 管理匹配预加载接管、直接预加载、挂载、实例结果意图和释放；ZCBattleEntryBuilder 纯函数复用现有 PVE/服务端构筑与席位映射。ZCGame 不创建/释放资源控制器，只消费外部展示资源；PVE Context 仅含数据，结果走 owner 作用域事件。ZCGame 内部模型推进、输入编排与结算仍是后续运行期拆分范围，不将本批记为整模块 MVC 完成。

不变量：预加载失败/取消不挂载；旧准备结果不污染新实例；匹配资源只移交一次，退出释放；先 shutdown 视图、destroy 组件再释放资源；单局 seed、服务器席位、统计 unitId、SLG 人数、离线 PVE 阵容/波次与捕获的存档 owner 原样保持。初始化失败与直接销毁也结束会话；PVE 结果按实例记录一次，不保存回调到组件。

- [x] 增加真实控制器行为测试：移交、直接入口、取消、失败、清理顺序、结果实例隔离。
- [x] 提取纯入口构筑与 BattleComposition；ProcedureGame 只转发生命周期。
- [x] 移交 ZCGame 运行资源所有权，PVE 结果契约事件化，保留已有表现。
- [x] 更新受影响测试，运行入口/匹配/资源/构筑/结算专项与边界护栏，刷新 Cocos 并记录类型诊断及后续范围。

结果：92 项专项通过；扩展 12 项既有失败与 70 条既有类型诊断均经 HEAD 对照，详见 [验证记录](2026-11-02-battle-entry-mvc-validation.md)。
