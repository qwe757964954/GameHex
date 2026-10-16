/**
 * 主线任务（详情弹窗 + 主界面入口 + 「10级领取」HUD）美术的**唯一入口**（纯数据、零 `cc`）。
 *
 * 分两层的理由与 `ItemDetailArt` / `ItemDetailArtLoader` 完全一致：
 * 本文件零 `cc` ⇒ 单测能直接 import 它做「映射 ↔ 磁盘文件 ↔ `.meta` border」对账；
 * 一旦出现 `import { resources } from 'cc'`，整组用例会 `Cannot find module 'cc'`
 * **静默失效**（规则 78）。
 *
 * 加载层直接用 `ItemDetailArtLoader.loadIdArtByRel` —— 本模块的图与物品详情同源
 * （品质框 / 物品图标都走那一份缓存），不为装饰图再开一套缓存。
 *
 * 迁移来源（老端 `D:/City1001/zarts/art/UIProject/trunk/UIProject/assets/`）：
 *   `公用0/图片/底板_panel/panel_window_01_9gong.png`  → 公共弹窗底
 *   `公用0/图片/框体_frame/title_brown.png`            → 标题缎带
 *   `公用0/图片/公用_按钮_关闭01.png`                    → 关闭按钮
 *   `主界面_战斗/图片/jldb.png`                         → 入口底图
 *   `公用0/图片/宝箱_bx/lb1.png`                        → 宝箱装饰
 *   `公用0/图片/散件_img/BB_img03.png`                  → 标题下装饰条
 * 见 `tmp/_copy_maintask_art.py` + `tmp/_set_maintask_border.py`。
 */

/** 本模块自有图目录（`assets/resources/image/maintask`）。 */
export const MT_ART_DIR = 'maintask';

/**
 * 全部图的 key → 相对 `assets/resources/image/` 的路径。
 * ⚠️ `compile()` 会按 **FGUI 那张图的原尺寸** 反查对账，尺寸不符直接 throw
 * （`tmp/_role_fgui.mjs` 的 `art.rawW !== n.art.w`）—— 这就是「同名不同图」的防线。
 */
export const MT_ART_NAMES: Readonly<Record<string, string>> = {
    // ---------- 「10级领取」HUD（`组件_主界面_领取武将`）----------
    /** 进度条底 64×30（老端 `frame_02_3gong`，九宫 31,7,28,9；FGUI 实例 `alpha="0.5"`）。 */
    valueBg: 'maintask/mt_value_bg',
    /** 顶部挂饰 98×54（老端 `jllq_pic02`，FGUI `xy="1,-17"` —— 故意高出组件上沿）。 */
    pic02: 'maintask/mt_jllq_pic02',
    /** 右下标底 89×34（老端 `jllq_pic03`）。 */
    pic03: 'maintask/mt_jllq_pic03',
    /** 背衬 139×79（老端 `jllq_pic04`）。 */
    pic04: 'maintask/mt_jllq_pic04',

    // ---------- 主线任务详情弹窗（`组件_战斗_主线任务详情`）----------
    /** 公共弹窗底 394×307（老端 `panel_window_01_9gong`，九宫 129,128,123,36；实例显示 590×627）。 */
    panelWindow: 'maintask/mt_panel_window',
    /** 标题缎带 344×81（老端 `title_brown`，九宫 171,20,16,40；显示 344×81 原尺寸）。 */
    titleBrown: 'maintask/mt_title_brown',
    /** 关闭按钮 60×60（老端 `公用_按钮_关闭01`，**无九宫**）。 */
    btnClose: 'maintask/mt_btn_close',
    /** 标题下装饰条 233×31（老端 `BB_img03`，九宫 58,0,116,31；实例 `scale="1.5"` + `alpha="0.4"` ⇒ 显示 444×48）。 */
    decoBar: 'maintask/mt_deco_bar',

    // ---------- 主线任务入口 HUD（`组件_战斗_主线任务`）----------
    /** 入口底图 254×76（老端 `jldb`，九宫 37,0,27,76；实例被 relation 拉到 222×84）。 */
    entryBg: 'maintask/mt_entry_bg',
    /** 宝箱装饰 100×100（老端 `lb1`，**无九宫**；实例显示 80×80）。 */
    chest: 'maintask/mt_chest',

    // ---------- 共用（`image/common`，不另存第二份）----------
    /**
     * 「前往」按钮底 210×77（老端 `TY_btn10`）。
     * 与物品详情的 `btn2Gray` **是同一张图** ⇒ 指同一份文件，别拷第二个副本。
     */
    btn2Gray: 'common/cu_ty_btn10',
    /** 可领取红点 29×28（`公用_图标_红点`，与物品详情 / 庆典 / 10级领取同款，指同一张 `common/cm_red_dot`）。 */
    redDot: 'common/cm_red_dot',
};

/**
 * 需要 `Sprite._type = SLICED(1)` 的图（= `.png.meta` 里 border 有任意一条非 0）。
 * ⚠️ 不是第二真源：`tmp/_fguilib.mjs` 的 `emit()` 自检③ 会与 `.meta` **双向对账**，不一致直接 fail。
 *
 * `btnClose`（`公用_按钮_关闭01`）与 `chest`（`lb1`）**不在**名单里 —— 它们的
 * `scale9grid` 是 null（FGUI 无九宫），迁过来 `.meta` border 也全 0。
 */
export const MT_ART_SLICED: ReadonlySet<string> = new Set<string>([
    'valueBg',     // frame_02_3gong          border 31,7,28,9
    'panelWindow', // panel_window_01_9gong   border 129,128,142,143
    'titleBrown',  // title_brown             border 171,20,157,21
    'entryBg',     // jldb                    border 37,0,190,0
    'decoBar',     // BB_img03                border 58,0,59,0
    'btn2Gray',    // TY_btn10                border 54,0,7,77
]);

/**
 * 平铺图 —— 本模块一张都没有。
 * 但生成器内核 `tmp/_fguilib.mjs` 的 `createLib()` 会 `readArtSet(opts.tiledConst)`，
 * 缺了直接 `throw`；⚠️ 写法必须带 `([`，否则内核正则匹配不上。
 */
export const MT_ART_TILED: ReadonlySet<string> = new Set<string>([]);
