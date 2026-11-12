# 塔防 Excel 命令行导表

策划仍然以 Excel 为唯一编辑入口。默认命令复用 `D:\City1001\doc\eson` 自带的 POI、fastjson 与导表规则，不需要打开 SWT 界面：

```powershell
npm run config:export
```

默认顺序：

1. eSon 批量读取 `D:\City1001\doc\塔防数据配置`。
2. 自动叠加 `outputs\skill_pipeline_20260926` 中的 J、K、PVP 三份闭环兼容表。
3. 把 `pvpSkillPlan` 投影到 K 表导出的 `armySkillLevelUp.modfiy`。
4. 在临时目录校验技能、状态、修改器、单位和服务端表；校验失败不会发布半套 JSON。
5. 更新 `doc\塔防数据配置\json`、客户端压缩 JSON 和 TypeScript 类型。

三份兼容表可以继续直接由策划修改；如果以后已经把它们覆盖回正式 Excel 目录，可关闭默认叠加：

```powershell
npm run config:export -- --no-default-overlays
```

也可以显式叠加任意单表或多表：

```powershell
npm run config:export -- --no-default-overlays `
  --overlay "D:\配置\J-技能表.xlsx" `
  --overlay "D:\配置\K-卡牌升级.xlsx"
```

只校验当前客户端导表结果：

```powershell
npm run config:validate
```

明确同步到本机已编译后端的配置目录：

```powershell
npm run config:export -- --sync-server-run
```

如果后端源码仓库存在，可另外提供其资源目录：

```powershell
npm run config:export -- --server-source-dir "D:\server-source\src\main\resources\tafang"
```

旧 `TFDocGenerator.exe` 仍可手动选择，但它当前对 J 表会报告导出失败，不能作为默认流水线：

```powershell
npm run config:export -- --engine tf
```

命令不会调用 `update-db`，也不会刷新或重启后端进程。配置同步完成后，由开发者选择热加载或重启时机。Proto 继续由后端维护；本流水线只发布双方共用的 JSON 字段契约。

## 卡牌 UI 美术（一张源表三个 sheet）

源表 `D:\City1001\doc\塔防数据配置\PVP-卡牌美术.xlsx`，一个维度一个 sheet；每个 sheet 的 A1 决定导出的 json 名（沿用同目录 `Z-装备`、`S-商城` 的多 sheet 约定）。首列是维度值，其余列是该维度下的图种。

| sheet | A1 → 客户端 json | 主键 | 列（首列勿改） | 行 |
| --- | --- | --- | --- | --- |
| 品级 | `cardUiArtRarity.json` | `rarity` | `name` 展示名（普通/稀有/史诗/传说）/ `sort` 列表排序权重 / `face` 卡面 / `disc` 垫盘 / `frame` 卡框 / `diamond` 详情品质图 | 4：`gold purple blue green` |
| 职业 | `cardUiArtClass.json` | `class` | `name` 中文名 / `sort` 列表排序权重 / `badge` 职业角标 / `iconOn` 选中 / `iconOff` 未选中 / `hero` 兜底雕像 / `boardHero` 布阵占位 | 4：`warrior mage archer tank` |
| 阵营 | `cardUiArtCamp.json` | `camp` | `name` 中文名 / `icon` 阵营图标 | 4：`huaguo mogu penzai jiangshi` |

三个维度值全部用英文 id，表里不写中文：品级 `gold/purple/blue/green`，职业 `warrior/mage/archer/tank`，阵营 `huaguo/mogu/penzai/jiangshi`。
品级 id 与运行时 `ZCCardRarity` 是**同一套英文值**，不再有映射层；`pvpCard` 表里品级仍是数字 `1=green 2=blue 3=purple 4=gold`，由 `ZCPvpTableParser.parseCardRarity` 翻成 id。写中文会被判「未知品级」。

`name` 与 `sort` 是维度元数据，不与美术资源冲突：

- `name` 是中文显示名。职业/阵营的 `name` 同时**就是 `pvpCard.traits.attack` / `traits.camp` 的取值**（职业 `战士/法师/射手/坦克`、阵营 `花果/蘑菇/盆栽/僵尸`），解析时按 `name` 建反向表，`ICardLineupCatalog.classOfTrait / campOfTrait` 直接查；品级的 `name` 只作展示文案（普通/稀有/史诗/传说），不参与 traits。三张表的 `name` 都必须唯一，重复会报「name 重复」。
- `sort` 是阵容列表的排序权重（0 最前），与行序无关：品级 `gold 0 / purple 1 / blue 2 / green 3`，职业 `archer 0 / mage 1 / warrior 2 / tank 3`（注意职业行序是 warrior/mage/archer/tank，和排序权重不同）。`sort` 必须是非负整数且同表唯一。

现状：这两列的解析结果挂在 `ICardArtConfig.lineup` 上，表已是唯一数据源。`CardLineupTypes` 里的 `resolveCardClass` / `resolveCardCamp` / `cardClassName` / `cardCampName` / `cardRarityName` / `sortLineupCards` / `tallyDeck*` 都从这里取，代码里不再有职业名、阵营名、品级展示名、traits 中文或排序权重。

品级展示名只有一个可编辑源：表 `name` 列。运行时由 `CardRepository.loadArtConfig()` 与 `ZCGameLoader` 解析后调 `ZCCombatCatalog.setCardRarityMeta(...)` 注入（同时注入 `name` 与 `sort`）；`DEFAULT_CARD_RARITY_META` 只在表尚未加载的纯 model 场景兜底，日常改文案只改表。

品级档位（1=绿 … 4=金，对局里算建筑耐久与产出加成）也不再手写：`rarityRank` 由注入元数据的 `sort` 反序位置派生（绿 sort 3 → 1、金 sort 0 → 4），改表权重档位自动跟随。品级 id 数组只有一份（`ZCCombatCatalog.ZC_CARD_RARITIES`），`CardLineupTypes` 只是 re-export；职业/阵营同理，代码数组是编译期白名单，表行集合必须与它一致，`pvpCard.traits` 的中文取值必须落在 `ZC_ATTACK_TRAITS / ZC_CAMP_TRAITS` 内 —— 三条都有 `tests/card-dimensions-single-source.test.ts` 钉住。

纵向一行一个维度值，横向一列一个图种——加一种图只加一列，不用给 40 条键各加一行。
`path` 都是资源相对路径，不带扩展名或 `/spriteFrame`。每个 sheet 的表头六行：A1 表名、第 2 行类型码、第 3 行中文说明、第 4 行主键（仅首列）、第 5 行字段名、第 6 行类型（资源列 `string`、`sort` 列 `int`）、第 7 行起数据。

品级表（`cardUiArtRarity`）：

| rarity | name | sort | face | disc | frame | diamond |
| --- | --- | --- | --- | --- | --- | --- |
| gold | 传说 | 0 | `image/card/common_img_kp_01` | `image/card/kpzr_di_01` | `image/frame/common_img_pzk_01` | `image/carddetail/identity/icon_quality_legendary` |
| purple | 史诗 | 1 | `image/card/common_img_kp_02` | `image/card/kpzr_di_02` | `image/frame/common_img_pzk_02` | `image/carddetail/identity/icon_quality_epic` |
| blue | 稀有 | 2 | `image/card/common_img_kp_04` | `image/card/kpzr_di_04` | `image/frame/common_img_pzk_04` | `image/carddetail/identity/icon_quality_rare` |
| green | 普通 | 3 | `image/card/common_img_kp_03` | `image/card/kpzr_di_03` | `image/frame/common_img_pzk_03` | `image/carddetail/identity/icon_quality_uncommon` |

职业表（`cardUiArtClass`）：

| class | name | sort | badge | iconOn | iconOff | hero | boardHero |
| --- | --- | --- | --- | --- | --- | --- | --- |
| warrior | 战士 | 2 | `icons/card/class_warrior` | `icons/card/common_img_zhanshi01` | `icons/card/common_img_zhanshi02` | `icons/card/camp_warrior` | `icons/cardHead/wandouyouxia` |
| archer | 射手 | 0 | `icons/card/class_archer` | `icons/card/common_img_sheshou_01` | `icons/card/common_img_sheshou_02` | `icons/card/camp_archer` | `icons/cardHead/wandouyouxia` |
| mage | 法师 | 1 | `icons/card/class_mage` | `icons/card/common_img_fashi02` | `icons/card/common_img_gh_fashi01` | `icons/card/camp_mage` | `icons/cardHead/jiezhanshi` |
| tank | 坦克 | 3 | `icons/card/class_tank` | `icons/card/common_img_tanke_01` | `icons/card/common_img_tanke_02` | `icons/card/camp_tank` | `icons/cardHead/jiezhanshi` |

阵营表（`cardUiArtCamp`）：

| camp | name | icon |
| --- | --- | --- |
| huaguo | 花果 | `icons/card/common_img_huaguo` |
| mogu | 蘑菇 | `icons/card/common_img_mogu` |
| penzai | 盆栽 | `icons/card/common_img_penzai` |
| jiangshi | 僵尸 | `icons/card/common_img_jiangshi` |

用途（谁用）：`face`/`disc` 阵容页卡库与槽位；`frame`/`boardHero` 布阵页卡池与空槽；`badge` 卡面角标；`iconOn`/`iconOff`/`icon` 阵容页图标行；`hero` 无专属图时的列表/详情立绘兜底；`diamond` 升级/详情页品质菱形。

两个易错点：`face` 编号是 01金 / 02紫 / 03绿 / 04蓝（≠ 显示顺序，别按"蓝=03"改）；`diamond.*` 统一指向 `image/carddetail/identity/icon_quality_{legendary,epic,rare,uncommon}`，按金/紫/蓝/绿对应传说/史诗/稀有/普通，四张同前缀，别再写回已退役的 `diamond_*` / `quality_purple` 顶层切图。

解析与校验：`CardArtConfig.parseCardArtConfig(tables, iconRows)` 把三张表合成同一份 40 条 `ICardArtKey → path`，消费方契约不变（`CardArtProvider` / 页面零改）。逐表校验未知维度值、重复维度值、非法路径，最后用 `REQUIRED_CARD_ART_KEYS` 校验齐全（清单由 `ZC_CARD_RARITIES × face/disc/frame/diamond` + `ZC_CARD_CLASSES × badge/iconOn/iconOff/hero/boardHero` + `ZC_CARD_CAMPS` 唯一推导，测试与文档别另写死数量）。

角色专属图仍由 `pvpCard.headIcon → icon.json` 提供（`ICardArtConfig.heroIcons`），与三表的 `paths` 是两套真源；详情 Controller 在提交新卡前准备立绘与品质帧，View 不临时读配置。

品级表 `frame` 列那 4 张图（`image/frame/common_img_pzk_01..04`）同时是**全工程通用品质框**：七日 / 活动 / 礼包 / 战令 / 挂机 / 首充 / OS 排行榜都调 `app/common/QualityFrameArt.ts`（`qualityFrameName` / `QUALITY_FRAME_NAMES`），各模块只转发、不再重算 `common_img_pzk_0N`。两处是同一批图但语义不同：卡牌卡框按品级 id 取表列，通用品质框按物品品质档 `clamp(floor(q)-1,1,4)` 直取（既有约定：品质 1~2 → 01、3 → 02、4 → 03、5+ → 04），不要把两者互相改成对方的算法。

改表流程：

1. 改 `PVP-卡牌美术.xlsx` 里对应的 sheet（品级 / 职业 / 阵营），首列维度值勿改；新增品级/职业/阵营时，先扩 `CardLineupTypes` 的 `ZC_CARD_RARITIES/ZC_CARD_CLASSES/ZC_CARD_CAMPS` 与 `ICardArtKey` 类型。
2. 导表（上方 `config:export`，或下方单表迁移命令）；每个 sheet 导出自己 A1 声明的 json，不需要改文件名。
3. 把图落到对应目录：`image/card`、`image/frame`、`image/carddetail`、`icons/card`、`icons/cardHead`。
4. 跑 `npx tsx --test tests/card-art-config.test.ts`：校验三表合成齐全、路径合法、每个文件真实存在。
5. 提交 `cardUiArtRarity.json` / `cardUiArtClass.json` / `cardUiArtCamp.json`（含各自 `.meta`）。

单表迁移（保留其他已生成类型）：`python tools/ref/ref_ref_type_all_gen.py <原始JSON目录> --table cardUiArtRarity`（class / camp 同法），再运行 `ref_RefBase_gen.py`。三张表已在 `refGen` / `TRefName` / `TRefName2` / `RefBase.ts` 登记（`IRefcardUiArtRarity` / `IRefcardUiArtClass` / `IRefcardUiArtCamp`）；改字段后走一次全量导表即可同步，单表迁移只用于局部修补。

`PVP-卡牌美术.xlsx` 原有的单 sheet（40 行 `key/path` 长表，导出 `cardUiArt.json`）已被这三个 sheet 取代，源文件内不再保留该 sheet；改表前的单表版备份在 `D:\City1001\doc\塔防数据配置\_backup\PVP-卡牌美术-单表版-20261105.xlsx.bak`。`assets/remoteRef/cardUiArt.json(.meta)` 暂时保留作对照，确认没有外部引用后即可删除；`ref_type_all.d.ts` 里仍有 `"cardUiArt.json"` 历史条目，别再用 `RefMgr.cardUiArt` 取美术配置。

