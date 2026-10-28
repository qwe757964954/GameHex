# 主界面显示后静默预下载战斗资源

使用 executing-plans，沿用绑定编辑器的当前工作区；用户已指定方案，不另建工作树、不提交。

契约：ProcedureMain 移除登录图后，MainTabHost 等实际 after-draw，再开始低优先级预下载；切页/开战/销毁停止派发。后台只下载文件，不解析 Prefab、不选地图、不请求开战。服务端 heroInfos 仍决定正式阵容。世界等待期间保留地图，透明输入拦截，失败恢复详情。

## Task 1: 会话预下载清单
先补卡牌/弹道/模型覆盖及取消、重试测试，再实现纯函数清单和会话下载队列。并发 2，按 bundle 路由；保留已有 64 条/10 分钟解析缓存。

## Task 2: 主界面生命周期
先补未进入主界面不预热、绘制后才启动、切页取消测试，再接 ProcedureMain.onEnter。移除领地/世界详情直接解析预热。

## Task 3: 世界透明等待与验证
先补透明遮罩回归，再保留地图和输入拦截，失败恢复详情。运行相关单测、编辑器浏览器验证并做一次独立最终审查。

验证：npx tsx --test tests/preview-loading-warmup.test.ts tests/battle-common-warmup.test.ts tests/main-tab-lazy-loading.test.ts tests/procedure-main-loading.test.ts tests/bigmap-battle-enter-mask.test.ts tests/bigmap-entry-cancellation.test.ts tests/battle-preparation-entry.test.ts；另跑相关战斗资源测试。真实账号开战需用户验收，隔离预览验证真实加载链。

Review Focus: 切页期间下载去重、退出登录迟到结果、after-draw 解绑、世界失败恢复详情、预下载是否误解析或阻塞首屏。
