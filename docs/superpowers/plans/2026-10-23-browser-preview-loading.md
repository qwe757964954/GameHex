# 浏览器预览首轮加载优化

用户已确认第一轮，直接在当前 Cocos 工程实施，不提交或分包。

## 目标与边界

登录不等待战斗；首屏不加载未打开 Tab；后台预热只下载公共资源，不选图、不改全局配置；正式战斗按后端阵容准备表现；预览按可用通道通信。沿用 AssetService / ConfigService / ResourceScope 和现有取消机制。

## 实施顺序

1. 会话准备与公共预热分离。给 AssetService 增加可选预下载能力，由 CocosAssetService 实现。AppSessionAssetService.prepare 仅准备配置和公共 UI，warmup 下载有限战斗公共 Prefab，前台开战暂停未派发的预热。测试登录不创建 GameLoader、并发合并、清理/失败/迟到完成以及预热不解析配置。
2. MainTabHost 按资源路径加载页面、使用页级作用域，取消过期切页并保持旧页直到新页就绪。MainRoot 移除五个页面强引用；通过 Cocos MCP 保存、验证、刷新。主界面首屏完成后启动预热。测试快速切页、重复点击、失败、销毁、资源归属及底栏世界入口。
3. 战斗回包后才准备本局配置。ZCGamePreload 支持等待战斗数据，Matching / Territory 入口沿用现有资源移交。ZCGameLoader 按回包人数选图，并按 heroInfos 与配置中的召唤/模型依赖闭包准备单位表现；离线保留全部卡牌。测试回包前不选图、取消和失败、阵容资源完整性及 1003/1004 入口。
4. 浏览器预览网络直连优先；仅网络/跨域类失败回退代理，业务 HTTP 失败不二次发送，不影响原生/小游戏与同源请求。测试直连成功、代理回退、应用错误、超时和非浏览器环境。
5. 运行绑定最小测试与 Cocos 引擎探针，复测预览与页面加载依赖，记录真实结果和未覆盖的服务端登录。

## 主要接口

- AssetService.preload?：仅预下载，不持有解析后的资产；调度由会话服务负责，不创建第二套全局缓存。
- SessionAssetService 可选 warmup / pauseWarmup：向流程提供能力，framework 不依赖 app。
- ZCGamePreload 的战斗数据等待器不修改 ResourceScope 单次移交契约。
- Tab 页每次加载拥有独立 ResourceScope；过期结果释放，不销毁当前显示页。

## 验证重点

登录/换号清理与后台任务交错；快速 Tab 切换；首场战斗和战后重进；英雄召唤及替换模型资源；代理只回退网络失败。比较首屏依赖和阶段时间，不把编辑器预览数字当线上性能承诺。
