import { _decorator, Color, Component, Label, Node } from 'cc';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import type { CardSkillListPresentation } from './CardPresenters';
import { CardSkillRowView } from './CardSkillRowView';

const { ccclass, property } = _decorator;

/** 一行技能的按钮回调宿主（`CardUpgradePage` 实现）。 */
export interface ICardSkillRowHost {
    /** `direction = -1` 本地往回看一档；`+1` 发技能升级请求。 */
    onSkillStep(skillId: number, direction: 1 | -1): void;
}

/**
 * 技能列表（`CardUpgrade.prefab` 的 `Skills` 节点）。
 *
 * 版式：左侧卡面下方是**技能区**，一行 = **两个技能**，每个技能右侧挂 **2 个按钮**
 * （`↓` 往回看一档 / `↑` 升一级）—— 于是「一行 4 个按钮」。
 *
 * ⚠️ 为什么不是「4 个按钮 = 4 个等级档」：`CmdPvpHeroUpSkillReqMsg` 只有
 * `{ heroId, skillId }`，一次只能升**一级**，档位由服务端表决定。四个按钮的按钮语义
 * 只能拆成「两个技能 × 两个方向」，否则第三个按钮按下去没有协议可发。
 *
 * 本组件是**哑视图**：不读表、不判断规则，只把 `CardSkillListPresentation` 幂等地铺到
 * prefab 上的静态行节点上（行节点是 prefab 预建的，不用对象池 —— 最多 4 个技能）。
 * 所有判定走 `CardSkillList` 的纯函数，保证与单测口径一致。
 *
 * ⚠️ 一个脚本文件只能有一个 `@ccclass` 继承 `Component`（引擎报
 * 「Each script can have at most one Component」并连锁抛 `_sealed` 空指针），
 * 所以行 / 格两个子组件各自独立成 `CardSkillRowView.ts` / `CardSkillSlotView.ts`。
 */
@ccclass('CardSkillListView')
export class CardSkillListView extends Component {
    /** 技能行容器（`Skills/Rows`），其下 2 个 `CardSkillRow` 实例。 */
    @property({ type: Node, tooltip: 'Rows：技能行容器（子节点为 prefab 预建的 CardSkillRow）' })
    rowsRoot: Node = null!;

    /**
     * 空态提示（主城 / 金矿这类没有技能的卡）。
     *
     * 声明成 `Node` 而不是 `Label`：**组件类型的属性对序列化值要求更严** ——
     * 一旦 prefab 里存的是节点（或旧版本存的是别的类型），引擎反序列化会直接丢弃该字段，
     * 运行时读到 `undefined` 而不是抛错，只能等到用的时候才炸。节点引用则宽容得多。
     */
    @property({ type: Node, tooltip: 'Empty：没有任何技能时的提示节点（挂 Label）' })
    emptyNode: Node = null!;

    //  底色是浅米黄（244,232,200），文字必须够深才看得清：
    //  「未解锁」只是略淡，不能淡到与背景融为一体（旧值 176,168,150 实测几乎看不见）。
    @property({ type: Color, tooltip: '已解锁 / 可升级文字色（样式放 Inspector，代码不写死）' })
    activeColor: Color = new Color(74, 60, 42, 255);

    @property({ type: Color, tooltip: '未到解锁英雄等级时的文字色（要比背景深、但要与已解锁区分开）' })
    lockedColor: Color = new Color(138, 128, 110, 255);

    /** 行宿主（由 `CardUpgradePage` 注入：按钮点击回到 Presenter）。 */
    host: ICardSkillRowHost | null = null;

    private bindRows(): void {
        if (!this.rowsRoot) return;
        const colors = this.colors();
        for (const row of this.rowsRoot.children) {
            const view = row.getComponent(CardSkillRowView);
            if (!view) continue;
            view.host = this.host;
            view.colors = colors;
        }
    }

    /**
     * 幂等全量渲染：每行按快照全量赋值，行数不足的隐藏。
     *
     * **每行铺几个技能由行自己决定**（`CardSkillRowView.right` 绑没绑）：
     *   - 升级弹窗里一行两格 → 每行 2 个；
     *   - 独立技能弹窗一行一格 → 每行 1 个。
     * 这样同一套列表/行/格组件能同时service两种版式，不用维护两份。
     */
    render(data: CardSkillListPresentation | null): void {
        this.bindRows();
        //  绑定缺失（老 prefab / 手工拼装的实例）时整块跳过：技能区是**可选模块**，
        //  它挂了不该连带宿主弹窗一起打不开（`PopupBase.onOpen` 会把异常抛给上层）。
        if (!this.rowsRoot) return;

        const rows = this.rowsRoot.children;
        const list = data?.rows ?? [];
        let cursor = 0;

        for (let index = 0; index < rows.length; index += 1) {
            const view = rows[index].getComponent(CardSkillRowView);
            if (!view) continue;
            const left = cursor < list.length ? list[cursor++] : null;
            // 右格没绑 ⇒ 这行只放一个技能。
            const right = view.right && cursor < list.length ? list[cursor++] : null;
            const visible = !!(left || right);
            rows[index].active = visible;
            if (!visible) continue;
            view.render(left, right, data);
        }

        //  空态时把行容器一起收起来 —— 行已经被逐行 `active = false`，但容器本身还在，
        //  留着只会遮住 Empty 提示。
        const empty = !data || list.length === 0;
        if (empty) this.rowsRoot.active = false;
        else this.rowsRoot.active = true;
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
