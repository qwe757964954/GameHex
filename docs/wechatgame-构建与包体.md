# 微信小游戏构建与包体

基于 Cocos Creator 3.8.8。可复用的发布配置为 `config/wechatgame-build.json`，从现有微信构建任务导出，保持原有 AppID、资源服务器、引擎插件和首场景配置。

## 构建

在仓库根目录执行（编辑器安装路径按实际环境调整）：

```powershell
& 'C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe' --project 'D:/City1001/Demo3.8' --build 'configPath=D:/City1001/Demo3.8/config/wechatgame-build.json'
```

构建输出到 `build/wechatgame`。本机 `profiles/v2/packages/builder.json` 与 `wechatgame.json` 的微信任务/默认配置也已同步。已经打开的构建面板可能仍持有旧值，构建前确认「主包压缩类型」为「小游戏分包」，或导入上述配置；`profiles` 不入库，其他机器使用保存的配置文件。

## 包体归属

- Cocos `main` Bundle 使用 `subpackage`，交由引擎生成微信分包及启动加载配置；不要手动移动构建后的脚本或修改生成的 `game.json`。
- 远程资源继续使用已有 CDN 地址，`build-templates/wechatgame/project.config.json` 排除上传 `remote` 目录。此规则随每次构建写入微信工程配置。
- CDN 根地址为构建配置中的 `server`。部署时将 `build/wechatgame/remote` 内的内容对应到该地址，保留各 Bundle 目录层级，避免额外套一层 `remote`。
- JS 随主包或微信分包发布，不能作为 CDN 远程脚本加载。

## 发布前验证

1. 确认构建日志报告成功，生成的 `game.json` 声明 `main` 分包。
2. 微信开发者工具检查上传文件列表：排除 `remote`，主包小于 4 MB；以工具实际统计为准。
3. 确认 CDN 已部署与本次构建匹配的资源；清缓存验证首次启动、登录、进入战斗和大地图，覆盖分包下载失败及弱网情况。

本地构建不执行 CDN 上传、微信代码上传或发布。

## 本次验证（2026-11-12）

Cocos 命令行完整构建完成。按生成的上传排除项与微信分包根目录统计未压缩文件：微信主包 2,410,287 字节（约 2.30 MiB），`main` 分包约 6.25 MiB，`internal` 分包约 0.66 MiB，主包加分包合计约 9.20 MiB。远程资源约 236.68 MiB，不计入上传包。

已用 Node 断言检查主包小于 4,000,000 字节、远程目录排除、分包 `game.js` 入口存在、`settings.json` 分包声明及启动预加载一致；对主包入口、Application 和两个分包入口执行 `node --check` 通过。尚未执行微信开发者工具统计、CDN 部署和真机测试。
