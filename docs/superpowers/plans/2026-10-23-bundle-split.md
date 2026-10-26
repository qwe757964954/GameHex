# Bundle 分包范围（第二轮）

用户已确认进入第二轮：确定并完成 Bundle 分包范围。沿用第一轮结论：加载通道 `AssetLoadOptions.bundle` 已在 core/platform 就绪（`CocosAssetService.getBundle`：resources 直通、本地 bundle 走 `assetManager.getBundle/loadBundle`、远端走 `CocosBundleRegistry`）。本计划只做：目录划分、目录标记（MCP）、加载点接线、同构搬迁、验证。

## 现状（实测，2026-10-23）

- `assets/resources` 全部打进首包，约 **145MB**：units 53.1 / image 50.1 / icons 17.7 / ui 10.5 / 塔防（音频）9.0 / skel 3.5 / config 1.1 / shaders 0.04（单位 MB，文件数 1300/1083/488/134/39/89/27/7）。
- 首屏依赖（第一轮探针）：MainRoot + TabButton + RedDot 共 16 资产 2.15MiB；`MainRoot` 仅依赖 `ui/common`；`ArenaRoot`（主城 tab）依赖 `ui/main`、`ui/common`、`ui/MainTask`；`RedDot` 依赖 **`skel/reddot`**（Spine）→ skel 不能整棵移出。
- 「塔防/音效」实为**全局音频**（登录 BGM、点击音效、兵种命中）→ 留在首包，无 td 包。
- 代码加载点已收敛：`AppSessionAssetService.warmup`（8 个 ui/game Prefab）、`MainTabHost.loadPage`（5 tab）、`ZCGameLoader`（战斗）、`BigMapPage/BigMapArtLoader`（大世界）、Territory（主城内嵌，首包）。
- 功能页组件（card/role/league/store/gift/battletoken/…）内部存在**大量运行时动态加载**（league 13 处、hang 7 处等，均未显式传 bundle）→ main-pages 不能只搬目录，必须由加载通道自动路由。

## 划分（v1，已实施；首包 ≈ 43.8MB，−70%）

| Bundle | 目录（`assets/bundles/<name>/` 下同构） | 体积 | 优先级 | 加载时机 |
|---|---|---|---|---|
| **battle** | units/、ui/game/、image/effects/、image/map-resource/、image/spawn-region/、image/gameui/、image/settlement/ | ≈ 55MB | 2（低） | 主界面首屏后 warmup 预下载公共；回包后 ZCGameLoader 补齐本局 |
| **bigmap** | image/bigmap/、ui/bigmap/ | ≈ 15.3MB | 1 | 进入「世界」页时 loadBundle + 加载 |
| **main-pages** | 功能页 ui/image/icons 全清单（41 目录） | ≈ 30.8MB | 1 | 点击对应 tab / 首次动态加载时，由 `bundleForPath` 自动路由 |

首包保留（resources 原样，实测 43.78MB）：config/、ui/login|loading|main|common|MainTask|territory|matching、image/login|main|common|maintask|territory|matching|artifact|buildings|decor|legend|GameRank|setting|frame、icons/common|main|head、skel/（含首屏 RedDot 依赖的 reddot）、塔防/（全局音频）、shaders/ 等其余目录。

### 划分原则与风险（已按实测修正）
- **同构搬迁**：resources 下目录原样搬到 `assets/bundles/<name>/`，代码路径字符串不变，uuid/meta/pac 整树保留（Move-Item 同盘，已执行 58 目录 4948 文件）。
- **`image/buildings`、`image/decor`、`image/legend` 留首包**：BigMap 复用 buildings/decor（`BigMapArtLoader` 直接加载 `image/buildings/hq-base` 等），若搬进 battle 则"进大世界需先下 battle 包"形成坏耦合；legend 无代码引用、被 prefab 引用，保守留首包。这使首包从早期估算 34MB 修正为实测 43.78MB。
- **加载通道自动路由**：`BundleCatalog`（core/asset，纯常量+纯函数）登记目录归属；`CocosAssetService` 在 options.bundle 未指定时按 `bundleForPath(path)` 路由（未命中 → resources）。功能页组件零改动即可按需加载 main-pages；显式传参点（ZCGameLoader battleOptions、warmup、MainTabHost pageBundle、BigMap）语义更明确。
- **跨 bundle 引用**（功能页 → icons/common、battle → 首包 shaders/buildings 等）：Cocos 构建会把被引用资源复制进引用方 bundle；**构建后必须复查产物体积与缺图**（本机构建需用户确认）。
- 预览模式 loadBundle 可用性：**已验证**（battle/bigmap/main-pages 在预览运行时全部可加载，代表资源 6 项全部解析成功，requestFailed=0）。

## 实施（已完成）

1. 代码接线：
   - 新增 `core/asset/BundleCatalog.ts`：BATTLE/BIGMAP/MAIN_PAGES_BUNDLE 常量 + BUNDLE_DIRECTORIES 归属表 + `bundleForPath` 路由。
   - `CocosAssetService`：preload/load/has/loadDir 未显式 bundle 时按路径自动路由。
   - `ZCGameLoader`：battleOptions helper，22 处战斗加载点传 `bundle:'battle'`；config/maps、image/artifact、两个 shader 保持首包。
   - `AppSessionAssetService.warmup`：8 个战斗公共 Prefab 预下载传 `bundle:'battle'`。
   - `MainTabHost`：pageBundle 映射（Territory=首包，Shop/Hero/Role/Alliance=main-pages），loadPage 传参。
   - `BigMapPage`（ui/bigmap 弹窗）+ `BigMapArtLoader`（按路径路由 image/bigmap→bigmap，其余首包）。
2. 资源同构搬迁：`tmp/_bundle_migrate.ps1`，58 目录 4948 文件（101.1MB）从 resources 移到 `assets/bundles/<bundle>/`。
3. MCP 标记：`assetAdvanced_asset_manage save_meta` 写三个 bundle 目录 meta（isBundle=true、bundleName、priority 2/1/1）+ refresh。
4. 验证：绑定测试 **85/85 全绿**（新增 bundle-scope 路由/通道 2 条 + main-tab bundle 断言 + warmup/loader bundle 断言）；预览首屏 fresh 3168ms / warm 4232ms、failures=0、pageErrors=0；运行时 bundle 加载探针 6/6 成功。

## 验证重点
- 首屏（登录→主城可操作）不加载 battle/bigmap/main-pages 任何资产；warmup 只预下载 battle 公共 Prefab。✓
- 切 tab / 进大世界 / 开战三个时机各自 loadBundle 成功且不重复下载（loadBundle 幂等由 assetManager 缓存保证）。✓（bundle 加载与代表资源已验证；真机开战/切 tab 的端到端需登录态，未覆盖）
- 资源 uuid 零变化（meta 随文件移动）；auto-atlas.pac 每树最外层规则保持。✓
- 全量与绑定测试不回归；全量测试余 155 条并行功能既有失败与本计划无因果。

## 未覆盖 / 需用户确认
- 生产构建产物验证（bundle 输出/跨包引用复制体积）→ 需用户允许执行一次 web 构建（写 build/）。
- 线上真机下载链路（分包远程托管）不在本轮。
- 端到端登录→切 tab→开战的真机链路（需账号/战斗会话），本轮以单测 + 运行时 bundle 探针覆盖。
