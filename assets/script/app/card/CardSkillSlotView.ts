import { _decorator, Button, Color, Component, Label, Node } from 'cc';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { isSkillMaxed, skillLevelRow, skillMaxLevel } from './CardSkillList';
import type { CardSkillListPresentation, CardSkillRowPresentation } from './CardPresenters';

const { ccclass, property } = _decorator;

/** 往节点上的 Label 写文案；节点没绑或没挂 Label 时静默跳过（技能区是可选模块）。 */
/**
 * 往节点（或其第一个挂 Label 的子节点）写文案。
 *
 * 按钮的文案在子节点 `Label` 上，按钮节点本身没有 `Label`，所以先查自身再往下一层找；
 * 都没有就静默跳过 —— 技能区是可选模块，缺一个 Label 不该让面板打不开。
 */
function setLabel(node: Node | null | undefined, text: string): void {
    if (!node) return;
    const self = node.getComponent(Label);
    if (self) {
        self.string = text;
        return;
    }
    const child = node.children.find((item) => item.getComponent(Label));
    const label = child?.getComponent(Label);
    if (label) label.string = text;
}

/**
 * 单格技能：名字 / 档位 /（解锁提示）/ 描述 + 两个按钮的可用状态。
 *
 * 渲染是**纯函数式**的：全部按入参重算，不读组件上一次的状态，因此可以在任意帧重复调用。
 *
 * ⚠️ 必须单独成文件：一个脚本最多一个 `Component`。
 */
@ccclass('CardSkillSlotView')
export class CardSkillSlotView extends Component {
    //  三个文字位一律绑**节点**、用时 `getComponent(Label)`：组件类型的属性对序列化值
    //  要求更严（存成节点就整字段被丢弃 → 运行时 undefined），节点引用则宽容得多。
    @property({ type: Node, tooltip: 'NameLabel：技能名节点（挂 Label）' })
    nameNode: Node = null!;

    @property({ type: Node, tooltip: 'LevelLabel：写成「Lv.2/3」的节点（挂 Label）' })
    levelNode: Node = null!;

    @property({ type: Node, tooltip: 'DescLabel：该档效果描述的节点（挂 Label）' })
    descNode: Node = null!;

    @property({ type: Node, tooltip: 'LockTip：未解锁提示（够等级时隐藏）' })
    lockTip: Node = null!;

    /**
     * 升级按钮（**唯一**）。
     *
     * 早前还有过一个 `↓`「往回看一档」的按钮，已按用户要求去掉：技能面板每行只保留
     * 一个升级入口。留成可空是为了兼容还没清理的旧 prefab，绑了也不会被使用。
     */
    @property({ type: Node, tooltip: 'PrevBtn：已废弃（保留兼容，不参与交互）' })
    prevButton: Node | null = null;

    @property({ type: Node, tooltip: 'NextBtn：升级按钮' })
    nextButton: Node = null!;

    render(
        item: CardSkillRowPresentation,
        data: CardSkillListPresentation | null,
        colors: { active: Color; locked: Color } | undefined,
    ): void {
        const texts = CARD_LINEUP_TEXTS;
        const skill = item.skill;
        const heroLevel = data?.heroLevel ?? 0;
        const busy = data?.busy ?? false;
        const maxLevel = skillMaxLevel(skill);

        /*
         * 下一档的解锁等级，**只用于提示文案，不再用于置灰按钮**。
         *
         * 曾经拿它判 `locked` 并把「升级」设成 `interactable = false`，结果实测点不动：
         * 后端 `CmdPvpHeroInfo.level` 与本地的 `unlockarmylevel` 口径对不上
         * （日志里 hero=1 而技能需要 14），按钮就被永久锁死，且 Button 的禁用是**静默**的。
         * 门槛本来就该由服务端判 —— 客户端只负责把请求发出去，用 rsp 决定成败。
         */
        const targetRow = skillLevelRow(skill, item.level + 1);
        const targetNeed = targetRow?.unlockHeroLevel ?? 0;
        /*
         * 满级 = **表里没有下一档**（不是 `level >= 最大档`）。档位可能不连续，
         * 按最大档判会给「2 级但表里只有 1/2/4」的技能留一个点不动的按钮。
         */
        const maxed = isSkillMaxed(skill, item.level);
        // 仅「显示提醒」，不影响可点性；满级时不再提示等级不足。
        const locked = !maxed && targetRow !== undefined && heroLevel > 0 && heroLevel < targetNeed;

        // 表里 `name` / `desc` 可能为空（狼骑兵四个技能就是全空），空了给占位文案，
        // 否则整个格子只剩编号，看起来像没加载出来。
        setLabel(this.nameNode, skill.name || `${texts.skillNameFallback}${skill.skillId}`);
        //  满级直接写「Lv.3（满级）」，比只写 3/3 更明确 —— 玩家不会去猜还有没有下一档。
        setLabel(
            this.levelNode,
            maxed
                ? `${texts.skillLevelPrefix}${item.level}${texts.skillMaxed}`
                : `${texts.skillLevelPrefix}${item.level}/${maxLevel}`,
        );
        setLabel(this.descNode, item.desc || texts.skillDescEmpty);
        const desc = this.descNode?.getComponent(Label);
        if (desc && colors) desc.color = locked ? colors.locked : colors.active;

        // 「未解锁」只在**下一档还没到解锁等级**时才说（纯提示；满级时不再显示）。
        if (this.lockTip) this.lockTip.active = locked;
        setLabel(this.lockTip, `${texts.skillLocked}（${targetNeed}）`);

        //  「升级」只在**满级**或**发包中**时置灰：这两个是客户端能确知的硬约束。
        //  等级不足一律放行给服务端，否则口径一错就整排按钮点不动。
        this.setEnabled(this.nextButton, !maxed && !busy);
        //  满级时按钮文案也换成「满级」—— 只置灰不改字，玩家会以为卡住/没加载。
        setLabel(this.nextButton, maxed ? texts.skillMaxed : texts.skillUpgradeButton);
    }

    private setEnabled(node: Node, enabled: boolean): void {
        if (!node) return;
        const button = node.getComponent(Button);
        if (button) button.interactable = enabled;
    }
}
