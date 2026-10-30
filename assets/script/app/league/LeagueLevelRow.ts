/**
 * 「等级预览」列表里的**一行** —— `540×110`（`ui/League/LeagueLevelPreview.prefab` 的
 * `RowView/content/LevelRow`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/组件/组件_联盟_等级预览Item.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n0` 行底框 `frame_Zhikuang01`（155×113 九宫格） | 本节点自己的 `cc.Sprite` | 显示 540×110 |
 * | `n1` 深色半透明衬底 `BB_img03`（alpha 0.5） | `TitleBar` | 垫在「等级N」下面 |
 * | `title`（26px / `#fcf0d6` / 居中） | `Title` | 文案 = `LV_TEXT_0` + 等级 ⇒「等级4」 |
 * | `n4` 浅色半透明衬底 `white_jiao8`（alpha 0.4） | `CtxBar` | 垫在副文案下面 |
 * | `ctx`（26px / 默认黑 / 左对齐） | `Ctx` | 文案 = `UNION_LEVEL_PREVIEW_TEXT` + 新增上限 |
 *
 * ⚠️ 两行文案的**颜色是反的**（`title` 浅字压深条、`ctx` 深字压浅条）—— 这不是笔误，
 *    FGUI 原稿就是两组「深条 + 浅字 / 浅条 + 深字」；别「统一」成同一个颜色。
 *
 * ⚠️ `CtxBar` 那张 `white_jiao8.png` 是**纯白**图，FGUI 靠 loader 的 `color="#cbaa85"`
 *    把它染成茶色 ⇒ prefab 里 `CtxBar` 的 `cc.Sprite.color` 必须是
 *    `rgba(0xcb,0xaa,0x85,102)`（色调 + alpha），只写 alpha 会渲染成白条。
 *
 * ⚠️ 整行会被虚拟列表 **clone 复用** ⇒ `render()` 里每一处状态都要**绝对赋值**，
 *    不能只在「有值」时写（否则上一行的残留会留在复用槽位上）。
 */

import { _decorator, Component, Label, Sprite } from 'cc';
import type { ILeagueLevelView } from './LeagueTable';

const { ccclass, property } = _decorator;

@ccclass('LeagueLevelRow')
export class LeagueLevelRow extends Component {
    @property({ type: Sprite, tooltip: 'TitleBar：深色半透明衬底（`BB_img03`，静态）' })
    titleBar: Sprite = null;

    @property({ type: Label, tooltip: 'Title：「等级N」' })
    titleLabel: Label = null;

    @property({ type: Sprite, tooltip: 'CtxBar：浅色半透明衬底（`white_jiao8` 九宫格，静态）' })
    ctxBar: Sprite = null;

    @property({ type: Label, tooltip: 'Ctx：「最大可加入人数：+Δ」' })
    ctxLabel: Label = null;

    /** 铺一行（所有状态**绝对赋值**）。 */
    render(view: ILeagueLevelView): void {
        this.titleLabel.string = view.title;
        this.ctxLabel.string = view.ctx;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }
}
