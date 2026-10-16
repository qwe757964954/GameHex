import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { MAIN_ART_ROOT } from '../ArtPaths';
import { loadArt } from './CardLineupIcons';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

const { ccclass, property } = _decorator;

/** 六格中的一格：名称 + 选中 / 未选中图标名（图标名相对 `MAIN_ART_ROOT`）。 */
export interface CardLineupNavItem {
    /** 木牌上的名称。 */
    name: string;
    /** 选中态图标资源名（`image/main/<on>/spriteFrame`）。 */
    on: string;
    /** 未选中态图标资源名。 */
    off: string;
    /**
     * 本格的红点表达式（`[RDXxx]`；留空 = 本格没有红点）。
     *
     * 老端 `按钮_首页_菜单.xml` 每格都带一个红点组件（`xy` 见 `TabButton.prefab`），
     * 点亮口径来自 `open.json`：`RDExpr`（本入口自己的表达式）+ `tlRDResId`（还要关注
     * 哪些入口）聚合而成 —— 与左右入口列用的**同一套** `rd/RdExprResolver`。
     *
     * ⚠️ 目前六格在 `open.json` 里**还没有登记**（`belond = 1` 那几行 `name` / `icon` 都是空的，
     * 也没有 `RDExpr`）⇒ 六格全留空、红点恒收起。要接时：先在 `open.json` 登记每格的
     * `refId` / `RDExpr` / `tlRDResId`，再把聚合结果（或直接一个 `[RDXxx]`）填到这里。
     */
    rdExpr?: string;
}

/**
 * 底部六格导航的配置组 —— **六格的名称、顺序、图标名只在本文档维护这一份**。
 *
 * 宿主 `MainTabHost` 把它当「槽位表」用：按节点 x 从左到右排好后逐位对齐，
 * 所以**数组顺序就是设计稿从左到右的顺序**，插图 / 改顺序都只动这里。
 *
 *  不要把这个数组再复制一份到宿主或 prefab 的 Label 上：
 * 文案本体走 `CardLineupTexts`（项目约定「静态文案集中一处」），
 * 「哪一格配哪张图、排第几」属于本组件的结构配置，放在这里。
 *
 * 图标在 `image/main`：`btm_*` 是商店 / 角色 / 竞技三格，`btn_*` 是领地 / 冒险 / 联盟三格。
 */
export const CARD_LINEUP_NAV_GROUP: readonly CardLineupNavItem[] = [
    { name: CARD_LINEUP_TEXTS.navShops, on: 'btm_shop_s', off: 'btm_shop_n' },
    { name: CARD_LINEUP_TEXTS.navRoles, on: 'btm_char_s', off: 'btm_char_n' },
    { name: CARD_LINEUP_TEXTS.navArena, on: 'btm_arena_s', off: 'btm_arena_n' },
    { name: CARD_LINEUP_TEXTS.navTerritory, on: 'btn_territory_s', off: 'btn_territory_n' },
    { name: CARD_LINEUP_TEXTS.navAdventure, on: 'btn_adventure_s', off: 'btn_adventure_n' },
    { name: CARD_LINEUP_TEXTS.navAlliance, on: 'btn_alliance_s', off: 'btn_alliance_n' },
];

/** 取第 `index` 格的配置；越界返回 `undefined`（宿主据此隐藏多余的格子）。 */
export function cardLineupNavItem(index: number): CardLineupNavItem | undefined {
    return CARD_LINEUP_NAV_GROUP[index];
}

/** 加载本格图标（`image/main/<name>/spriteFrame`），带缓存，失败返回 `null`。 */
export function loadNavArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, MAIN_ART_ROOT);
}

/**
 * 主界面底部导航的单格木牌 —— ⚠️ **2026-09-28 起不再使用**。
 *
 * 底栏六格与战令页内四格已统一到工程共用的页签组件
 * `app/common/TabButton.ts` + `resources/ui/common/TabButton.prefab`
 * （依据：老端 `按钮_首页_菜单.xml` 本来就同时被这两处引用，见 `TabButton.ts` 文件头）。
 * `main/MainRoot.prefab` 的 `BottomNav` 现在挂的是 `TabButton` 实例。
 *
 *  本类与 `resources/ui/card/CardLineupNav.prefab` 暂时保留，只为不让那个 prefab 变成
 * `cc.MissingScript`（删类不删 prefab 会在加载时报警告）。**待确认后一起删**：
 * 全工程已无任何脚本 / prefab 引用它们，本文件真正在用的只有上面那份配置组与 `loadNavArt`。
 */
@ccclass('CardLineupNav')
export class CardLineupNav extends Component {
    @property({ type: Sprite, tooltip: 'Icon：木牌上的功能图标（未选中用 *_n 图，选中用 *_s 图）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'NameLabel：功能名，如「商店」' })
    nameLabel: Label = null!;
    private renderRevision = 0;

    /** 填入名称与图标；`frame` 为 `null` 时保留 prefab 现有图片。 */
    render(name: string, frame: SpriteFrame | null): void {
        this.nameLabel.string = name;
        if (frame) this.icon.spriteFrame = frame;
    }

    /**
     * 按配置组第 `index` 格渲染。
     *
     * 宿主只需要知道「第几格 / 选中没有」，名称与图标由本组件自己查，
     * 避免同一份槽位表在两边各存一份。
     */
    async renderAt(index: number, active: boolean): Promise<void> {
        const revision = ++this.renderRevision;
        const entry = cardLineupNavItem(index);
        if (!entry) {
            this.node.active = false;
            return;
        }
        this.node.active = true;
        const frame = await loadNavArt(active ? entry.on : entry.off);
        if (!this.isValid || !this.node?.isValid || revision !== this.renderRevision) return;
        this.render(entry.name, frame);
    }
}
