/**
 * 美术资源路径表。业务脚本统一使用这里的常量，不要硬编码目录。
 *
 * Cocos 把每张 png 导成 SpriteFrame 子资源，装配路径为 `<root>/<name>/spriteFrame`，
 * 统一由 `spriteFramePath()` 拼。
 */

/** 美术大图根目录（页面背景、卡面、按钮等）。 */
export const ART_ROOT = 'image';

/** 主界面常驻图：底部导航、木牌底。 */
export const MAIN_ART_ROOT = `${ART_ROOT}/main`;

/**
 * **主城底栏（2026-10-19 蓝湖改版）** —— 七格的图标 + 选中底板 + 底条。
 *
 * 与 `MAIN_ART_ROOT` 下那批 `btm_*` / `btn_*`（旧六格，选中/未选中各一张）是**两套**：
 * 新版蓝湖稿每格只有**一张**图标（`zjm_icon_*`），选中态靠底板 `nav_sel`（金色圆角块）表达，
 * 底条是 `nav_bg`（720×152，贴屏幕底）。
 *
 * 文件对应（切图名 → 工程名）：
 * `bg_01` → `nav_bg` ｜ `tab_02` → `nav_sel` ｜
 * `zjm_icon_sd/yx/ld/tz/lm/sj` → `nav_shop/hero/territory/challenge/alliance/world`。
 *
 * 角色格图标已归一到 `nav_role`，不再复用旧六格切图。
 */
export const MAIN_CITY_ART_ROOT = `${MAIN_ART_ROOT}/city`;

/**
 * 主界面顶部资源栏的**专用件**：头像框（`zjm_Headicon_bg`）、货币格底（`zjm_huobi_bg`）、
 * 血条/经验条（`zjm_hp_bar_fg`）、补货加号（`公用_按钮_加号`）。
 *
 * ⚠️ **货币图标不在这里**（2026-09-29 起）。原先这里同时放了 `图标_铜币` / `图标_幻灵玉` /
 * `图标_灵石` / `图标_体力` / `图标_经验值` 5 张，其中 4 张与 `RESOURCE_ICON_ART_ROOT`
 * **是同一份文件（同 md5）** ⇒ 一份图两个目录、两套口径。现在货币/属性类图标统一取
 * `RESOURCE_ICON_ART_ROOT`（真源 = `roleProperty.icon`），本目录只留上面那批 HUD 专用件。
 */
export const RESBAR_ART_ROOT = `${ART_ROOT}/main/resbar`;

/**
 * **资源类（货币 / 属性）图标目录** —— 全工程唯一真源。
 *
 * 对应 `roleProperty` 表 `iconIsPath = false` 那一支：表里存的是 FGUI 裸组件名
 * （`图标_铜币`），装配路径就是 `<本目录>/<icon>/spriteFrame`。
 *
 * 消费方：`activity/LayerActivityArt.resolveRewardIconRef`（**唯一入口**，被 hang / gift /
 * celebration / battletoken / league / showReward 复用）、`main/MainResBarArt`（顶部货币条）。
 * 别再新开 `const XXX = 'icons/resource'`（曾经有 `LayerActivityArt` / `HangArt` 两份同值常量）。
 */
export const RESOURCE_ICON_ART_ROOT = `icons/resource`;

/**
 * 通用图标目录（`icons/common`）：`item` 表里按路径直通的那些图，以及 `roleProperty` 的
 * 少数例外（`图标_联盟贡献` / `图标_补天神石`，见 `ResTypes.ROLE_PROPERTY_ICON_ROOT_OVERRIDE`）。
 *
 * ⚠️ 与 `COMMON_ART_ROOT`（`image/common`，通用底图与按钮）**不是一个目录** ——
 * 名字像、值不同，别互相转发。
 */
export const COMMON_ICON_ART_ROOT = `icons/common`;

/** 卡牌阵容页大图：卡面 / 站台 / 垫盘 / 品级框。 */
export const CARD_ART_ROOT = `${ART_ROOT}/card`;

/** 卡牌阵容 / 布阵页图标：营地雕像、Q 版立绘、职业角标。 */
export const ICON_ART_ROOT = `icons/card`;

/** 布阵卡池卡框。 */
export const FRAME_ART_ROOT = `${ART_ROOT}/frame`;

/** 通用底图与按钮。 */
export const COMMON_ART_ROOT = `${ART_ROOT}/common`;

/** 匹配页页面大图：头像占位、神器、雷达、阵营旗、展示底图。 */
export const MATCH_ART_ROOT = `${ART_ROOT}/matching`;

/** 匹配页信息条小图标：icon_01~icon_04。 */
export const MATCH_ICON_ART_ROOT = `icons/matching`;

/**
 * 匹配页信息条槽位配色（资源在 `MATCH_ART_ROOT` 下）。
 *
 * 槽位 0 = 我方（蓝），1~3 = 对手（红 / 紫 / 黄）—— 人数由本局实际参与方决定（2~4 人）。
 * 由 `MatchPlayerItem.applySlot()` 在运行时按槽位取图，所以**新增配色只改这两张表**。
 */
export const MATCH_SLOT_BARS: readonly string[] = ['bar_01', 'bar_02', 'bar_03', 'bar_04'];
export const MATCH_SLOT_FRAMES: readonly string[] = ['frame_01', 'frame_02', 'frame_03', 'frame_04'];

/**
 * 神器图标：`image/artifact`（与对局里的神器格**同一张图**、同一个根）。
 *
 * ⚠️ **别再用 `image/matching/icon_faqi.png`** —— 那是一张固定占位图（蓝色法杖），
 * 与玩家实际带的神器无关。图标**资源名**真源= `pvpArtifact[].icon`（如 `霜封冰刃`），
 * 装配路径 `image/artifact/<icon>/spriteFrame`，由 `spriteFramePath()` 拼。
 */
export const ARTIFACT_ART_ROOT = `${ART_ROOT}/artifact`;

/**
 * 中立资源点图标：`image/map-resource`（`gold` / `mine` / `chest`，同一套 212×212 画布）。
 *
 * 格子内图标由 `ZCGameHex.prefab` 硬绑；这里提供装配常量给「运行时按名加载」的场景
 * （金币飞行特效的贴图 = `gold`，与格子图标同一张，见 `ZCGameLoader.loadGoldCoinFrame`）。
 */
export const MAP_RESOURCE_ART_ROOT = `${ART_ROOT}/map-resource`;

/** 玩家头像。 */
export const HEAD_ART_ROOT = `icons/head`;

/** 兵种头像（Q 版单位头像）。 */
export const CARD_HEAD_ART_ROOT = `icons/cardHead`;

/** 主界面活动入口图标。 */
export const ACTIVITY_ICON_ART_ROOT = `${ART_ROOT}/activityIcon`;

/** FairyGUI 包名 → 资源根目录映射。 */
export const ICON_PACKAGE_ART_ROOT: Readonly<Record<string, string>> = {
    '图标_兵种_头像': CARD_HEAD_ART_ROOT,
    '图标_武将': HEAD_ART_ROOT,
    '图标': HEAD_ART_ROOT,
    '图标_主界面': ACTIVITY_ICON_ART_ROOT,
};

/** 建筑图标：金矿 / 兵营 / 防御塔 / 城墙。 */
export const BUILDING_ART_ROOT = `${ART_ROOT}/buildings`;

/** 章节领地专用建筑：主城 / 普通据点 / 首领据点。 */
export const TERRITORY_BUILDING_ART_ROOT = `${ART_ROOT}/territory/buildings`;

/** 章节领地页面大图：背景等根目录资源。 */
export const TERRITORY_ART_ROOT = `${ART_ROOT}/territory`;

/** 章节领地专用 HUD：标题框与章节按钮。 */
export const TERRITORY_UI_ART_ROOT = `${ART_ROOT}/territory/ui`;
/**
 * 地块抬起后**原位开口**的底部发光序列帧（8 帧，`hex_ground_glow_01..08`，同画布 130×239）。
 *
 * 对局（`ZCHexView` 的 `GroundGlow`）与领地地图（`TerritoryHexFlip`）**共用这一份**，
 * 所以放这里当唯一真源，两边都别写自己的路径。
 */
export const HEX_GROUND_GLOW_ART_ROOT = `${ART_ROOT}/effects/hex_ground_glow`;

/**
 * 翻格「脉冲」序列帧（**5 帧** `hex_pulse_0..4`，320×320 透明底，靠 `sprite.color` 乘色）。
 *
 * 2026-10-19 换成美术给的新一套：**缩放与不透明度全部烘焙进图**（1.00→1.78 倍、70%→15%），
 * 视图只按 10fps 选帧，不许在节点上再叠 scale / opacity 动画。只有对局在用（`ZCHexView`）。
 *
 * 🔴 落地的图**被处理过**：美术原稿中心那块六边形是**实心**的（画的是「地块本体」参考色），
 * 直接盖到地块上会把整块地皮盖成淡紫。`tools/gen_hex_pulse_layer.py` 把本体压到
 * **35% 不透明度**（`BODY_ALPHA`）—— 比彻底挖空更实一点、又能透出地块的阵营色与图标，
 * 外圈的波原样保留。帧数与 320 画布不变 ⇒ 换图时**要么**用同款处理后的图，
 * **要么**把本路径指回去再改视图。
 *
 * 🔴 旧的那套 30 帧 `effects/hex_pulse/fkz_00..29`（155×144，配 `shaders/hex-pulse.effect`
 * 做径向虚化）**已退役**：文件还留在盘上做对照，但代码不再加载 —— 别把新帧混进那个目录，
 * 那个目录的加载器是「扫全目录按名排序」，混进去会变成 35 帧。
 */
export const HEX_FLIP_PULSE_ART_ROOT = `${ART_ROOT}/effects/hex_pulse_seq`;

/** 月卡礼包美术。 */
export const MONTHCARD_ART_ROOT = `${ART_ROOT}/monthcard`;

/** 通用 UI 图：问号、血条、进度条等。 */
export const GAMEUI_ART_ROOT = `${ART_ROOT}/gameui`;

/**
 * 「对局内排行榜」美术（蓝湖「排行榜」设计稿，11 张切图）。
 *
 * ⚠️ 每张单图都得拼 `/spriteFrame`（规则 142）—— `resources.load` 裸路径报的是
 * `Bundle resources doesn't contain ...`，**不是 404**，极易误判成「美术没交图」。
 * 用 `spriteFramePath(GAME_RANK_ART_ROOT, name)` 拼，别手写字符串。
 */
export const GAME_RANK_ART_ROOT = `${ART_ROOT}/GameRank`;

/** 地图装饰根目录。 */
export const DECOR_ART_ROOT = `${ART_ROOT}/decor`;

/**
 * 「传说卡牌出场横幅」美术（抽到金卡时弹出的整条横幅）。
 *
 *  切图来自蓝湖「出场横幅」设计稿（720×1665，四组同构、每色一组）：`legend_banner_01~04` 是四色底板、
 *  `legend_ring_01~04` 是同色头像环、`legend_title` 是固定的「传说卡牌」标题。
 * 设计稿里的角色立绘**不导出**：运行时用该卡产出的兵种 idle 立绘（与卡面同一条解析链）。
 */
export const LEGEND_BANNER_ART_ROOT = `${GAMEUI_ART_ROOT}/legend`;

/** 拼 SpriteFrame 装配路径：`<root>/<name>/spriteFrame`。 */
export function spriteFramePath(root: string, name: string): string {
    return `${root}/${name}/spriteFrame`;
}

/** 装饰图装配路径。 */
export function decorFramePath(art: string): string {
    return `${art}/spriteFrame`;
}

/**
 * 「数据里直接存了 resources 相对路径」时的装配路径（幂等）。
 *
 * `item.icon` 这类字段存的是图片资源本身的路径（如 `icons/item/图标_兵书随机`），
 * **不能**直接拿去 `resources.load(path, SpriteFrame)` —— 实测（2026-09-23，编辑器预览）：
 *
 *   资源在 resources bundle 的索引里只登记 `xxx/spriteFrame`（`icons/*`、`image/*` 全都如此，
 *   `getDirWithPath('icons/common', SpriteFrame)` 返回的 78 条路径**全部**带后缀），
 *   裸路径 `xxx` 根本没有登记 ⇒ 报 `Bundle resources doesn't contain xxx`
 *   （`image/card/*` 这种用了很久的目录同样如此，与自动图集无关）。
 *
 * 所以凡是从数据里拿到完整路径的地方，一律先过这里再 load。
 */
export function spriteFramePathOf(artPath: string): string {
    return artPath.endsWith('/spriteFrame') ? artPath : `${artPath}/spriteFrame`;
}

/** 缓存键：`<root>/<name>`，避免同名图串图。 */
export function artKey(root: string, name: string): string {
    return `${root}/${name}`;
}
