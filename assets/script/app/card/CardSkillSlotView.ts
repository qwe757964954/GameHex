import { _decorator, Button, Color, Component, Label, Node } from 'cc';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { isSkillMaxed, skillLevelRow, skillMaxLevel } from './CardSkillList';
import type { CardSkillListPresentation, CardSkillRowPresentation } from './CardPresentations';

const { ccclass, property } = _decorator;

/**
 * 单格技能：名字 / 档位 /（解锁提示）/ 描述 + 升级按钮的可用状态。
 *
 * 渲染是**纯函数式**的：全部按入参重算，不读组件上一次的状态，因此可以在任意帧重复调用。
 *
 * ## 为什么每个文字位都直接绑 `cc.Label`
 *
 * 早前这里绑的是**节点**，运行时再 `getComponent(Label)`，还写了个 `setLabel(node, text)`
 * 往自身 / 第一个子节点上找 Label。那条路的代价是：**绑错了永远不知道** —— 找不到 Label
 * 就静默跳过（当时的理由是"技能区是可选模块，缺一个 Label 不该让面板打不开"），
 * 表现是「技能行文字空白，日志一个字都没有」。
 * 现在的约定是**必绑、绑组件**：没绑就是打开面板时当场抛错，而不是静默不显示。
 *
 * ⚠️ 必须单独成文件：一个脚本最多一个 `Component`。
 */
@ccclass('CardSkillSlotView')
export class CardSkillSlotView extends Component {
    @property({ type: Label, tooltip: 'NameLabel：技能名（**绑组件不绑节点**）' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'LevelLabel：写成「2/3」的 Label' })
    levelLabel: Label = null;

    @property({ type: Label, tooltip: 'DescLabel：该档效果描述的 Label' })
    descLabel: Label = null;

    @property({ type: Label, tooltip: 'LockTip：未解锁提示的 Label（够等级时整个节点隐藏）' })
    lockTip: Label = null;

    /**
     * 已废弃的 `↓`「往回看一档」按钮。
     *
     * 面板每行只保留一个升级入口（用户要求），这个字段只为兼容还没清理的旧 prefab，
     * 绑了也不会被使用。
     */
    @property({ type: Node, tooltip: 'PrevBtn：已废弃（保留兼容，不参与交互）' })
    prevButton: Node | null = null;

    @property({ type: Button, tooltip: 'NextBtn 上的 cc.Button（升级按钮，**绑组件不绑节点**）' })
    nextButton: Button = null;

    @property({ type: Label, tooltip: 'NextBtn/Label：按钮文案（满级时写「满级」）' })
    nextLabel: Label = null;

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
        this.nameLabel.string = skill.name || `${texts.skillNameFallback}${skill.skillId}`;
        //  满级直接写「3（满级）」，比只写 3/3 更明确 —— 玩家不会去猜还有没有下一档。
        this.levelLabel.string = maxed
            ? `${texts.skillLevelPrefix}${item.level}${texts.skillMaxed}`
            : `${texts.skillLevelPrefix}${item.level}/${maxLevel}`;
        this.descLabel.string = item.desc || texts.skillDescEmpty;
        if (colors) this.descLabel.color = locked ? colors.locked : colors.active;

        // 「未解锁」只在**下一档还没到解锁等级**时才说（纯提示；满级时不再显示）。
        this.lockTip.node.active = locked;
        this.lockTip.string = `${texts.skillLocked}（${targetNeed}）`;

        //  「升级」只在**满级**或**发包中**时置灰：这两个是客户端能确知的硬约束。
        //  等级不足一律放行给服务端，否则口径一错就整排按钮点不动。
        this.nextButton.interactable = !maxed && !busy;
        //  满级时按钮文案也换成「满级」—— 只置灰不改字，玩家会以为卡住/没加载。
        this.nextLabel.string = maxed ? texts.skillMaxed : texts.skillUpgradeButton;
    }
}
