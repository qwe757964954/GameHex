# 匹配期间预加载对局

匹配界面进入后，`ProcedureMatching` 同时开始搜索对手和创建 `ZCGamePreload`。预加载准备 PvP 配置、随机地图、对局首屏 Prefab，以及单位和攻击特效 Prefab，不创建战斗节点。配置就绪后，地图、首屏和单位/特效资源并行加载。

匹配成功展示结束后，将对手和本次预加载交给 `ProcedureGame`。对局流程等待同一个 `ready` Promise，资源就绪才切出匹配界面，因此不会重复加载，也不会先进入空白对局。直接进入对局时仍通过加载器准备资源。

预加载资源拥有独立的 `ResourceScope`。成功时，在匹配退出前移交给对局流程；对局退出时释放。匹配离开、流程销毁或加载失败时释放尚未移交的资源；迟到加载会立即释放，取消后的配置和地图结果不会注入。仅取消进入对局的导航而仍留在匹配界面时，匹配保留自己的加载结果。

当前预加载提前完成资源读取，场景节点仍在进入对局时创建。未添加加载进度条或自动重试；加载失败时记录错误，并保留匹配界面。

验证：`node --import tsx --test tests/zcds-matching-preload.test.ts tests/zcds-game-preload.test.ts tests/procedure-manager-preload.test.ts`。覆盖复用、等待、取消、失败、资源移交、销毁、重入、并行加载和过期结果保护。
