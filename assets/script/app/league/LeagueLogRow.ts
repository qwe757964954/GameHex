/**
 * 「联盟 · 大厅 · 动态」列表里的**一行动态** —— `646×70`
 * （`ui/League/LeagueHall.prefab` 的 `TabLog/LogList/content/LogRow`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/组件/组件_联盟_联盟动态item.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n6` 行底框 `frame_Zhikuang01`（155×113 九宫格） | 本节点自己的 `cc.Sprite` | 显示 656×70，**相对行中心上偏 3px** |
 * | `lab_ctx`（24px `#3a1e08` 左对齐 shrink） | `Ctx` | 整句文案（已在数据层拼好） |
 * | `lab_time`（24px `#6c4822` 右对齐） | `Time` | `MM/DD HH:mm:ss` |
 *
 * 整句文案由 `LeagueTable.buildLeagueLogViews` 按 `join` / `opPosition` 选模板填好，
 * 行脚本**不做任何文案拼接**（老端 `render` 也是 `StringUtil.format` 完直接 `setText`）。
 *
 * ⚠️ 整行会被虚拟列表 clone 复用 ⇒ `render()` 两次 `string` 都要**绝对赋值**。
 */

import { _decorator, Component, Label } from 'cc';
import type { ILeagueLogView } from './LeagueTable';

const { ccclass, property } = _decorator;

@ccclass('LeagueLogRow')
export class LeagueLogRow extends Component {
    @property({ type: Label, tooltip: 'lab_ctx：整句动态文案' })
    ctxLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_time：MM/DD HH:mm:ss' })
    timeLabel: Label = null;

    /** 铺一行（所有状态**绝对赋值**）。传 `null` 等价于藏掉整行。 */
    render(view: ILeagueLogView | null): void {
        if (!view) {
            this.hide();
            return;
        }
        this.ctxLabel.string = view.ctx;
        this.timeLabel.string = view.timeText;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }
}
