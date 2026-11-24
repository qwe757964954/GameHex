/**
 * 大地图顶部 HUD 的唯一渲染组件（世界 / 基地两种模式共用）。
 *
 * 结构：左侧玩家卡（复用 `MainResBar` 的 CmdRole 数据链）+ 右侧资源格
 * （基地 4 格：粮 / 木 / 铁 / 行动力；世界 5 格再含金币）+ 基地专属队列卡。
 *
 * 两种模式只切配置：玩家卡两模式都显示；基地显示绿色加号与队列卡，
 * 世界显示金币、隐藏队列卡；图标固定为蓝湖切图，避免运行时被道具图标换错。
 *
 * 之前世界 `Header` 与基地 `DesignHud` 是两棵独立顶栏树，各自绑一套 Label；
 * 合并后所有资源文本只走 `buildBigMapTopHudView` 一份口径。
 */
import { _decorator, Button, Component, Label, Node, Sprite, type SpriteFrame } from 'cc';
import type { IBigMapViewState } from '../application/BigMapViewState';
import { MainResBar } from '../../main/MainResBar';
import { BigMapResourceFeedback } from './BigMapResourceFeedback';
import { buildBigMapTopHudView } from './BigMapTopHudTypes';

const { ccclass, property } = _decorator;

@ccclass('BigMapTopHud')
export class BigMapTopHud extends Component {
    @property({ type: MainResBar, tooltip: 'PlayerCard：玩家卡（头像/昵称/等级/经验/战力），复用主界面 CmdRole 数据链' })
    private playerCard: MainResBar = null!;

    @property({ type: Node, tooltip: 'QueueCard：基地模式的建造队列卡；世界模式隐藏' })
    private queueCard: Node = null!;

    @property({ type: Button, tooltip: 'QueueButton：基地建造队列按钮（点击呼出/收起底部建造面板）' })
    private queueButton: Button = null!;

    @property({ type: Label, tooltip: 'QueueBuildValue：建造队列摘要（忙/已解锁）' })
    private buildQueueValue: Label = null!;

    @property({ type: Label, tooltip: 'QueueResearchValue：研究队列占位（大地图暂无研究业务）' })
    private researchQueueValue: Label = null!;

    @property({ type: [Sprite], tooltip: '5 个资源图标，顺序 = 粮/木/铁/金币/行动力' })
    private resourceIcons: Sprite[] = [];

    @property({ type: [Label], tooltip: '5 个资源数值，顺序 = 粮/木/铁/金币/行动力' })
    private resourceValues: Label[] = [];

    /** 金币格三件套（底板/图标/数值）；基地设计稿只有 4 格，整个单元格按模式收起。 */
    @property({ type: [Node], tooltip: 'CoinPanel / CoinIcon / CoinValue（CoinPlus 永久隐藏）' })
    private coinNodes: Node[] = [];

    /** 基地设计稿的绿色加号；世界模式保留旧世界顶栏的无加号样式。 */
    @property({ type: [Node], tooltip: 'GrainPlus / WoodPlus / IronPlus / StaminaPlus' })
    private plusNodes: Node[] = [];

    /** 每个资源格的反馈驱动；下标与 resourceValues 对齐。 */
    private readonly feedback: BigMapResourceFeedback[] = [];

    onLoad(): void {
        for (let index = 0; index < this.resourceIcons.length; index += 1) {
            const icon = this.resourceIcons[index];
            if (!icon) continue;
            // 尺寸由 prefab 固定，图标按原始像素落位，避免不同资源图把格子撑歪。
            icon.trim = false;
            icon.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        for (let index = 0; index < this.resourceValues.length; index += 1) {
            const label = this.resourceValues[index];
            if (label) this.feedback.push(new BigMapResourceFeedback(label));
        }
    }

    onDisable(): void {
        for (const item of this.feedback) item.cancel();
    }

    /** 全量渲染：值变才起反馈，反馈在播时把 Label 交给反馈类。 */
    render(data: IBigMapViewState): void {
        const view = buildBigMapTopHudView(data.resources, data.queues, data.actionRecoverSeconds);
        for (let index = 0; index < this.resourceValues.length; index += 1) {
            const label = this.resourceValues[index];
            const slot = view.slots[index];
            if (!label || !slot) continue;
            const feedback = this.feedback[index];
            if (feedback && feedback.sync(slot.source)) continue;
            label.string = slot.text;
        }
        this.buildQueueValue.string = view.buildQueueText;
        this.researchQueueValue.string = view.researchQueueText;
        // 研究队列没有数据源，保留设计稿占位（与基地原貌一致），不伪造进度。
        const base = data.ui.mode === 'base';
        // 基地设计稿是 4 格资源 + 绿色加号；世界是 5 格含金币，保持旧世界顶栏的无加号样式。
        for (const node of this.coinNodes) node.active = !base;
        for (const node of this.plusNodes) node.active = base;
        this.queueCard.active = base;
    }

    /** 逐帧推进反馈；返回 true = 至少一格还在滚动。 */
    step(dt: number): boolean {
        let busy = false;
        for (const item of this.feedback) {
            if (item.step(dt)) busy = true;
        }
        return busy;
    }

    /** 把页面已加载的玩家头像注入玩家卡，避免 `HeadArt` 二次请求。 */
    setPlayerPortrait(frame: SpriteFrame | null): void {
        this.playerCard.setPortraitFrame(frame);
    }

    /** 基地建造队列按钮（用于宿主绑定点击以展开/收起底部建造面板）。 */
    get queueCardButton(): Button {
        return this.queueButton ?? this.queueCard?.getComponent(Button) ?? null!;
    }
}
