import { _decorator, Button, Color, Component, Node } from 'cc';
import type { CardSkillListPresentation, CardSkillRowPresentation } from './CardPresentations';
import { CardSkillSlotView } from './CardSkillSlotView';
import { CardLineupEvent } from './CardLineupEvents';
import type { ISkillStepPayload } from './CardLineupEvents';
import { EventMgr } from '../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/**
 * 一行技能 = 左右两格，每格「名字 + 档位 + 描述 + ↓ / ↑」。
 *
 * 字段全部是 prefab 上已绑的节点，**不写判空**（项目约定：必填绑定缺失就让它在打开时炸）。
 *
 * ⚠️ 必须单独成文件：一个脚本最多一个 `Component`（否则引擎报
 * 「Each script can have at most one Component」并连锁抛 `_sealed` 空指针）。
 */
@ccclass('CardSkillRowView')
export class CardSkillRowView extends Component {
    @property({ type: Node, tooltip: 'Left：左技能格' })
    left: Node = null;

    @property({ type: Node, tooltip: 'Left/PrevBtn：↓ 往回看一档（本地预览）' })
    leftPrev: Node = null;

    @property({ type: Node, tooltip: 'Left/NextBtn：↑ 升一级（发请求）' })
    leftNext: Node = null;

    /** 右技能格：一行两技能的版式才需要；一行一技能时留空。 */
    @property({ type: Node, tooltip: 'Right：右技能格（一行一技能的版式留空）' })
    right: Node | null = null;

    @property({ type: Node, tooltip: 'Right/PrevBtn（right 为空时无需绑）' })
    rightPrev: Node | null = null;

    @property({ type: Node, tooltip: 'Right/NextBtn（right 为空时无需绑）' })
    rightNext: Node | null = null;

    /** 颜色由上层列表注入（行节点是 prefab 预建的，颜色只在列表上配一份）。 */
    colors: { active: Color; locked: Color } | null = null;

    private bound = false;
    private leftSkillId = 0;
    private rightSkillId = 0;

    /**
     * 注册四个按钮的点击。
     *
     * ⚠️ **不能放在 `onLoad` 里绑定**：`onLoad` 与属性注入的先后顺序不保证，
     * 一旦它先跑，`leftPrev` / `leftNext` 还是 `null`，`?.on()` 静默跳过，
     * 而 `bound` 已经被置 true —— 之后属性就位也永远不会补绑，表现就是
     * 「两个箭头点了毫无反应」。所以绑定点放在 `render()`（那时属性必然已注入），
     * 并用 `bound` 保证只挂一次。
     *
     * 直接对节点注册 `Button.EventType.CLICK`，不经过 `getComponent(Button)`：
     * 后者取不到就抛异常，会中断后续按钮的注册。
     */
    private bindButtons(): void {
        if (this.bound) return;
        // 只要求升级按钮存在（`leftPrev` 已按需求移除，兼容旧 prefab 时它可能是 null）。
        if (!this.leftNext) return;
        this.bound = true;
        this.leftPrev?.on(Button.EventType.CLICK, this.onLeftPrev, this);
        this.leftNext.on(Button.EventType.CLICK, this.onLeftNext, this);
        // 右格可能没绑（一行一技能的版式），有才挂。
        this.rightPrev?.on(Button.EventType.CLICK, this.onRightPrev, this);
        this.rightNext?.on(Button.EventType.CLICK, this.onRightNext, this);
    }

    render(
        left: CardSkillRowPresentation | null,
        right: CardSkillRowPresentation | null,
        data: CardSkillListPresentation | null,
    ): void {
        // 属性此时必然已注入，是唯一安全的按钮绑定时机。
        this.bindButtons();
        this.leftSkillId = left?.skill.skillId ?? 0;
        this.rightSkillId = right?.skill.skillId ?? 0;
        const colors = this.colors ?? undefined;
        this.renderSlot(this.left, left, data, colors);
        //  right 允许不绑：独立技能弹窗是「一行一个技能」，右格整个不存在。
        if (this.right) this.renderSlot(this.right, right, data, colors);
    }

    private renderSlot(
        node: Node,
        item: CardSkillRowPresentation | null,
        data: CardSkillListPresentation | null,
        colors: { active: Color; locked: Color } | undefined,
    ): void {
        node.active = !!item;
        if (!item) return;
        const slot = node.getComponent(CardSkillSlotView);
        if (!slot) return;
        slot.render(item, data, colors);
    }

    /**
     * 派发点击意图（`CardLineupEvent.SkillStep`），由页面订阅后决定发不发包。
     *
     *  原来这条路是注入式回调：`CardSkillListView.host` → `view.host` → `onSkillStep`，
     *  而且为了兜住「注入失败」还写了个沿父链**鸭子类型反射**找宿主的 `findHostUpward()`。
     *  删掉之后不存在"找不到宿主"这个状态 —— 没人订阅就没人处理，页面开着就一定会订阅。
     */
    private step(skillId: number, direction: 1 | -1): void {
        if (skillId <= 0) {
            console.warn('[CardSkillRowView] 点击时 skillId 为 0，说明这一格还没渲染过（render 未跑）');
            return;
        }
        EventMgr.instance.emit(CardLineupEvent.SkillStep, { skillId, direction } satisfies ISkillStepPayload);
    }

    private onLeftPrev(): void { this.step(this.leftSkillId, -1); }
    private onLeftNext(): void { this.step(this.leftSkillId, 1); }
    private onRightPrev(): void { this.step(this.rightSkillId, -1); }
    private onRightNext(): void { this.step(this.rightSkillId, 1); }
}
