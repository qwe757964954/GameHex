import { _decorator, Color, Component, Label, Node } from 'cc';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import type { CardSkillListPresentation } from './CardPresentations';
import { CardSkillRowView } from './CardSkillRowView';

const { ccclass, property } = _decorator;

/** 将技能快照按顺序渲染到预建的单技能行。 */
@ccclass('CardSkillListView')
export class CardSkillListView extends Component {
    /** 技能行容器（`Skills/Rows`），其下为 `CardSkillRow` 实例。 */
    @property({ type: Node, tooltip: 'Rows：技能行容器（子节点为 prefab 预建的 CardSkillRow）' })
    rowsRoot: Node = null;

    /**
     * 空态提示（主城 / 金矿这类没有技能的卡）。
     *
     * 声明成 `Node` 而不是 `Label`：**组件类型的属性对序列化值要求更严** ——
     * 一旦 prefab 里存的是节点（或旧版本存的是别的类型），引擎反序列化会直接丢弃该字段，
     * 运行时读到 `undefined` 而不是抛错，只能等到用的时候才炸。节点引用则宽容得多。
     */
    @property({ type: Node, tooltip: 'Empty：没有任何技能时的提示节点（挂 Label）' })
    emptyNode: Node = null;

    //  底色是浅米黄（244,232,200），文字必须够深才看得清：
    //  「未解锁」只是略淡，不能淡到与背景融为一体（旧值 176,168,150 实测几乎看不见）。
    @property({ type: Color, tooltip: '已解锁 / 可升级文字色（样式放 Inspector，代码不写死）' })
    activeColor: Color = new Color(74, 60, 42, 255);

    @property({ type: Color, tooltip: '未到解锁英雄等级时的文字色（要比背景深、但要与已解锁区分开）' })
    lockedColor: Color = new Color(138, 128, 110, 255);

    private bindRows(): void {
        if (!this.rowsRoot) return;
        const colors = this.colors();
        for (const row of this.rowsRoot.children) {
            const view = row.getComponent(CardSkillRowView);
            if (!view) continue;
            //  行只派发 `CardLineupEvent.SkillStep`，不再需要注入宿主（见 `CardSkillRowView.step`）。
            view.colors = colors;
        }
    }

    render(data: CardSkillListPresentation | null): void {
        this.bindRows();
        //  绑定缺失（老 prefab / 手工拼装的实例）时整块跳过：技能区是**可选模块**，
        //  它挂了不该连带宿主弹窗一起打不开（`PopupBase.onOpen` 会把异常抛给上层）。
        if (!this.rowsRoot) return;

        const rows = this.rowsRoot.children;
        const list = data?.rows ?? [];

        for (let index = 0; index < rows.length; index += 1) {
            const view = rows[index].getComponent(CardSkillRowView);
            if (!view) continue;
            const item = list[index];
            rows[index].active = !!item;
            if (!item) continue;
            view.render(item, data);
        }

        //  空态时把行容器一起收起来 —— 行已经被逐行 `active = false`，但容器本身还在，
        //  留着只会遮住 Empty 提示。
        const empty = !data || list.length === 0;
        this.rowsRoot.active = !empty;
        if (!this.emptyNode) return;
        this.emptyNode.active = empty;
        const label = this.emptyNode.getComponent(Label);
        if (label) label.string = CARD_LINEUP_TEXTS.skillEmpty;
    }

    /** 供行视图取「解锁 / 置灰色」。 */
    colors(): { active: Color; locked: Color } {
        return { active: this.activeColor, locked: this.lockedColor };
    }
}
