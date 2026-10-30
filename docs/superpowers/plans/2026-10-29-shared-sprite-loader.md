# 公共 SpriteFrame 加载器

**Goal:** 提取 loadMatchIcon 同类加载器的重复机制，并迁移现有模块。

**Architecture:** 在 app/common/SpriteFrameCache.ts 提供实例缓存。按规范化路径去重，失败返回 null 且可重试，清理后拒绝迟到结果。流程实例通过 AssetService 和 ResourceScope 管理资源；已有静态入口通过 RoutedResource 加载并由缓存持有引用。各模块保留路径解析、业务默认值和公开入口。

**Tech Stack:** Cocos Creator 3.8、TypeScript、node:test / tsx。

**Constraints:** 不新增全局共享缓存；替换已有缓存实例。保留用户改动、Prefab 和业务路径，纯数据表不引擎化，不自动提交。

- [x] 测试公共缓存：路径等价/目录隔离、并发去重、同步异常/异步失败重试、失效帧重载、clear 与迟到请求竞态、引用对称、流程释放与 bundle 路由。
- [x] 实现 SpriteFrameCache 的 load、loadNamed、peek、clear 及 createIconLoader / createRoutedSpriteFrameCache。
- [x] 迁移 matching、CardLineupIcons、ItemDetailArtLoader、RoleArtLoader、StoreArt、HeadArt、RedDotArt、MainResBarArt、MainEntranceList，保留原公共接口和清理入口。
- [x] 更新测试依赖，执行资源生命周期、匹配、角色/物品/商城、头像、红点与资源栏回归，检查差异和类型诊断。

**Review focus:** 不重复 addRef；取消不缓存迟到结果；旧请求不能清除新请求；空值与失败不永久缓存；作用域资源不提前 decRef。

## 验证

- `npx tsx --test tests/sprite-frame-cache.test.ts tests/sprite-frame-consumers.test.ts tests/matching-resources.test.ts tests/cocos-resource-lifecycle.test.ts tests/routed-resource.test.ts tests/reddot.test.ts tests/res-types.test.ts tests/matching-server-readiness.test.ts tests/matching-artifact-icon.test.ts tests/zcds-matching-preload.test.ts tests/head-art-model.test.ts tests/main-entrance.test.ts tests/main-entrance-route.test.ts tests/role.test.ts`：152/152 通过。
- `npx tsx --test --test-name-pattern '匹配页图标|RoleArtLoader' tests/art-paths.test.ts`：2/2 通过。
- 扩大检查包含 card-head-icon、main-resbar、store、itemdetail：174 项中 166 通过、8 失败；失败来自未修改的 cardHead 目录、ItemDetail/Store Prefab 缺失，以及 ArenaRoot 结构/几何断言，不由新加载器执行结果决定。
- `npx tsc --noEmit --pretty false`：全仓仍有 Cocos 等既有错误，本次修改文件和新增测试无诊断。
- `git diff --check`：本次改动通过。Cocos MCP refresh `db://assets/script/app/common` 成功，引擎生成新脚本 meta。尚未做引擎内逐页画面验收。
- 只读代码审查未发现本次缓存及迁移引入的可操作问题；核对了路径、引用对称、作用域归属和请求竞态。旧版无调用方的 matching 默认加载入口已在上一轮移除；本次保留现有注入入口。源返回空/失效帧时返回 null，抛错时记录告警。

## 使用

流程/页面：`const loadIcon = createIconLoader(assets, scope)`，再 `await loadIcon(name, root)`。

既有静态入口：`const cache = createRoutedSpriteFrameCache('模块名')`，再 `cache.load(path)` 或 `cache.loadNamed(name, root)`；沿用宿主退出/登出时的 `cache.clear()`。
