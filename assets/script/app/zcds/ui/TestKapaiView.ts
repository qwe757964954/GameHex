import {
    _decorator, Button, Camera, Color, Component, Graphics, JsonAsset, Label, Node, resources, Sprite, UIOpacity,
    UITransform,
} from 'cc';
import { ensureZCRuntimeCompiled } from '../application/ZCRuntimePrecompiler';
import {
    buildZCTestKapaiCatalog, damageOfSkill, EMPTY_TEST_KAPAI_CONFIG, factorsOfSkill,
    formatZCTestKapaiIssue, parseZCTestKapaiConfig,
} from '../model/ZCTestKapaiModel';
import type {
    ITestKapaiCard, ITestKapaiConfig, ITestKapaiIssue, ITestKapaiSkill,
} from '../model/ZCTestKapaiModel';
import { ZC_RUNTIME_CONFIG } from '../model/ZCRuntimeConfigStore';
import type { ZCRuntimeRules } from '../model/ZCGameRuntimeConfig';
import { RefConfigService } from '../../../platform/config/RefConfigService';
import { ZCTestKapaiStage } from './ZCTestKapaiStage';

const { ccclass, property } = _decorator;

/** 布局配置路径（`assets/resources/config/testkapai`）。*/
const LAYOUT_PATH = 'config/testkapai';

/** 技能行数 = 场景里预建的 3 行；切卡只改文案与可用性，不建节点。*/
const SKILL_ROW_COUNT = 3;

/** 数值格数 = 场景里预建的 8 格（2 列 × 4 行）。*/
const STAT_CELL_COUNT = 8;

/** 伤害飘字池：场景预建 3 个 Label，循环复用。*/
const FLOAT_COUNT = 3;
const FLOAT_SECONDS = 0.7;

/** 模型 / 特效覆盖的步进与边界。*/
const SCALE_STEP = 0.1;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.5;

/** 技能行运行时状态：`readyAt <= elapsed` 表示就绪；`charge` 是强化技的普攻累计次数。*/
interface ISkillRuntime {
    readyAt: number;
    charge: number;
    /** 已切换成冷却底色（只在进入冷却的那一帧重绘，避免每帧重建 Graphics）。*/
    dimmed: boolean;
    /** 上一次写入的倒计时文案（0.1s 精度不变就不重复赋值）。*/
    cdText: string;
}

/** 场景里一行技能按钮的子节点引用（节点由 MCP 建在 TestKapai.scene 上）。*/
interface ISkillRowView {
    readonly node: Node;
    readonly name: Label;
    readonly phase: Label;
    readonly meta: Label;
    readonly maskNode: Node;
    readonly maskSprite: Sprite;
    readonly cd: Label;
}

/** 飘字运行时状态。*/
interface IFloatRuntime {
    readonly label: Label;
    readonly opacity: UIOpacity;
    startedAt: number;
    active: boolean;
}

/**
 * TestKapai 手动验证场景的视图。
 *
 * 版式全部由 `TestKapai.scene` 承载（节点经 Cocos MCP 创建），本类**不创建任何 UI 节点**；
 * 只填文案、画底色 / 格子 / 范围圈、加载模型与特效。
 *
 * 三个直接可调项（覆盖仅本次会话有效）：
 * - 视图倍率：1.0 = 战场 1:1，2.0 / 4.2 只看细节；
 * - 模型 / 特效：模拟 `pvpCard.prefabSize` 与 `zcEffectNodeScaleOf` 改表后的观感；
 * - 伤害：乘在技能 `damageRate` 上，用真实公式复算。
 */
@ccclass('TestKapaiView')
export class TestKapaiView extends Component {
    /* ------------------------------------------------------------------ *
     * 场景引用（Inspector 必填；缺失即 prefab / 场景结构被改坏）
     * ------------------------------------------------------------------ */

    @property(Node) backdrop: Node = null!;

    @property(Node) diagnosticsNode: Node = null!;
    @property(Label) diagnosticsText: Label = null!;

    @property(Label) headerTitle: Label = null!;
    @property(Label) headerSub: Label = null!;
    @property(Node) prevButton: Node = null!;
    @property(Node) nextButton: Node = null!;
    @property(Label) switchName: Label = null!;
    @property(Label) switchIndex: Label = null!;

    @property(Node) stageNode: Node = null!;
    @property(Graphics) stageGrid: Graphics = null!;
    @property(Graphics) rangeRing: Graphics = null!;
    @property(Graphics) aoeRing: Graphics = null!;
    @property(Node) unitAnchor: Node = null!;
    @property(Node) targetAnchor: Node = null!;
    @property(Node) effectAnchor: Node = null!;
    @property(Graphics) targetRing: Graphics = null!;
    @property(Label) targetName: Label = null!;
    @property(Label) targetHpLabel: Label = null!;
    @property([Label]) floatLabels: Label[] = [];

    @property(Sprite) badgeFrame: Sprite = null!;
    @property(Sprite) badgeBody: Sprite = null!;
    @property(Label) badgeName: Label = null!;
    @property(Label) badgeMeta: Label = null!;
    @property(Label) stageStatus: Label = null!;
    @property(Label) scaleTag: Label = null!;

    @property(Sprite) statusBg: Sprite = null!;
    @property(Label) statusTotal: Label = null!;
    @property(Label) statusCasts: Label = null!;
    @property(Label) statusTarget: Label = null!;

    @property([Node]) skillRowNodes: Node[] = [];

    @property(Sprite) resultBg: Sprite = null!;
    @property(Label) resultText: Label = null!;

    @property(Sprite) debugBg: Sprite = null!;
    @property(Label) viewValue: Label = null!;
    @property(Node) view1Button: Node = null!;
    @property(Node) view2Button: Node = null!;
    @property(Node) view4Button: Node = null!;
    @property(Label) modelValue: Label = null!;
    @property(Node) modelMinus: Node = null!;
    @property(Node) modelPlus: Node = null!;
    @property(Label) effectValue: Label = null!;
    @property(Node) effectMinus: Node = null!;
    @property(Node) effectPlus: Node = null!;
    @property(Node) damageHalf: Node = null!;
    @property(Node) damage1: Node = null!;
    @property(Node) damage2: Node = null!;
    @property(Node) autoButton: Node = null!;
    @property(Node) pauseButton: Node = null!;
    @property(Node) resetButton: Node = null!;

    @property([Node]) statCells: Node[] = [];

    @property(Sprite) logBg: Sprite = null!;
    @property(Label) logText: Label = null!;

    /* ------------------------------------------------------------------ *
     * 运行时
     * ------------------------------------------------------------------ */

    private config: ITestKapaiConfig = EMPTY_TEST_KAPAI_CONFIG;
    private rules: Readonly<ZCRuntimeRules> | null = null;
    private cards: readonly ITestKapaiCard[] = [];
    private hiddenBuildings = 0;
    private issues: ITestKapaiIssue[] = [];
    private cardIndex = 0;

    /** 本地时钟（累加 dt）：暂停时冷却一起停，不用墙钟。*/
    private elapsed = 0;
    private paused = false;
    private autoAttack = false;
    private autoNextAt = 0;
    private totalDamage = 0;
    private castCount = 0;
    private targetHp = 0;

    private viewScale = 1;
    private modelScale = 1;
    private effectScale = 1;
    private damageRate = 1;

    private stage: ZCTestKapaiStage | null = null;
    private readonly skillRows: ISkillRowView[] = [];
    private readonly skillRuntime: ISkillRuntime[] = [];
    private readonly floatRuntime: IFloatRuntime[] = [];
    private floatCursor = 0;

    private logLines: string[] = [];
    private logLabel: Label | null = null;

    protected onLoad(): void {
        void this.bootstrap();
    }

    protected onDestroy(): void {
        this.stage?.dispose();
        this.stage = null;
    }

    protected update(dt: number): void {
        this.stage?.update(dt);
        if (this.paused) return;
        this.elapsed += dt;
        this.updateCooldowns();
        this.updateFloats();
        this.updateAutoAttack();
    }

    /* ------------------------------------------------------------------ *
     * 启动
     * ------------------------------------------------------------------ */

    private async bootstrap(): Promise<void> {
        let raw: unknown = null;
        try {
            raw = await this.loadLayoutJson();
        } catch (error) {
            this.collectIssues([{
                level: 'error',
                scope: `资源 / ${LAYOUT_PATH}`,
                detail: `布局配置加载失败：${errorText(error)}`,
            }]);
        }
        const parsed = parseZCTestKapaiConfig(raw);
        this.config = parsed.config;
        this.collectIssues(parsed.issues);

        if (!this.isValid) return;
        this.applyCameraBackground();
        this.cacheSceneRefs();

        if (this.hasConfigError()) {
            this.diagnosticsNode.active = true;
            this.renderDiagnostics();
            this.pushLog('配置有错误：先修 config/testkapai.json，再看模型 / 数值');
            return;
        }

        try {
            const ready = await ensureZCRuntimeCompiled(new RefConfigService());
            if (!this.isValid) return;
            if (!ready) {
                this.collectIssues([{
                    level: 'error',
                    scope: '运行时配置',
                    detail: '配置编译被取消或未完成（会话是否已重置？）',
                }]);
            }
        } catch (error) {
            this.collectIssues([{
                level: 'error',
                scope: '运行时配置',
                detail: `pvpCard / pvpSkill / pvpGlobal 编译失败：${errorText(error)}`,
            }]);
        }

        const snapshot = ZC_RUNTIME_CONFIG.snapshot;
        this.rules = snapshot.rules ?? null;
        const catalog = buildZCTestKapaiCatalog(snapshot);
        this.cards = catalog.cards;
        this.hiddenBuildings = catalog.hiddenCount;
        this.collectIssues(catalog.issues);
        for (let index = 0; index < this.cards.length; index += 1) {
            this.collectIssues(this.cards[index].issues);
        }

        this.applyDebugDefaults();
        this.buildStage();
        this.bindChrome();
        this.paintChrome();
        this.resultText.string = '等待释放 · 视图 ×1.0 即战场 1:1';
        this.targetHp = this.config.damageTest.targetMaxHp;
        this.renderTargetLabel();
        this.selectCard(0);
        this.renderDiagnostics();
        this.refreshOverrideLabels();
        this.pushLog(this.hiddenBuildings > 0
            ? `配置就绪：${this.cards.length} 张兵种卡（已隐藏 ${this.hiddenBuildings} 张建筑卡）`
            : `配置就绪：${this.cards.length} 张卡`);
        this.pushLog('点技能释放：模型 / 特效 / 格子同倍率；视图 ×1.0 就是战场 1:1');
    }

    private loadLayoutJson(): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            resources.load(LAYOUT_PATH, JsonAsset, (error: Error | null, asset: JsonAsset) => {
                if (error || !asset) {
                    reject(error ?? new Error('返回空资源'));
                    return;
                }
                resolve(asset.json);
            });
        });
    }

    private collectIssues(issues: readonly ITestKapaiIssue[]): void {
        for (const issue of issues) {
            this.issues.push(issue);
            if (issue.level === 'error') console.error(formatZCTestKapaiIssue(issue));
            else console.warn(formatZCTestKapaiIssue(issue));
        }
    }

    private hasConfigError(): boolean {
        return this.issues.some((issue) => issue.level === 'error' && issue.scope.startsWith('配置'));
    }

    /** 清屏色走 Camera；再加一块根尺寸的底块兜住不同 clearFlags 的相机。*/
    private applyCameraBackground(): void {
        const scene = this.node.scene;
        const camera = scene ? scene.getComponentInChildren(Camera) : null;
        if (camera) camera.clearColor = toColor(this.config.palette.background);
    }

    /**
     * 把场景里的固定子节点缓存成运行时引用。
     *
     * 技能行 / 数值格 / 飘字的子节点名是场景契约（MCP 建树时按它命名），
     * 这里只取值不兜底：名字对不上就直接抛错，避免"看起来能跑、其实少了一列数"。
     */
    private cacheSceneRefs(): void {
        for (let index = 0; index < this.skillRowNodes.length && index < SKILL_ROW_COUNT; index += 1) {
            const node = this.skillRowNodes[index];
            const name = requiredLabel(node, 'Name');
            const phase = requiredLabel(node, 'Phase');
            const meta = requiredLabel(node, 'Meta');
            const cooldown = requiredNode(node, 'Cooldown');
            const maskNode = requiredNode(cooldown, 'Mask');
            const maskSprite = requiredSprite(maskNode);
            const cd = requiredLabel(cooldown, 'Text');
            this.skillRows.push({ node, name, phase, meta, maskNode, maskSprite, cd });
            this.skillRuntime.push({ readyAt: 0, charge: 0, dimmed: false, cdText: '' });
        }
        if (this.skillRows.length !== SKILL_ROW_COUNT) {
            throw new Error(`TestKapai 场景需要 ${SKILL_ROW_COUNT} 行技能按钮，实际 ${this.skillRows.length}`);
        }
        if (this.statCells.length !== STAT_CELL_COUNT) {
            throw new Error(`TestKapai 场景需要 ${STAT_CELL_COUNT} 个数值格，实际 ${this.statCells.length}`);
        }
        if (this.floatLabels.length !== FLOAT_COUNT) {
            throw new Error(`TestKapai 场景需要 ${FLOAT_COUNT} 个飘字，实际 ${this.floatLabels.length}`);
        }
        for (const label of this.floatLabels) {
            const opacity = label.getComponent(UIOpacity);
            if (!opacity) throw new Error(`飘字 ${label.node.name} 缺 UIOpacity（透明度动画依赖它）`);
            this.floatRuntime.push({ label, opacity, startedAt: 0, active: false });
            label.node.active = false;
        }
        this.logLabel = this.logText;
    }

    private buildStage(): void {
        this.stage = new ZCTestKapaiStage({
            host: this.stageNode,
            grid: this.stageGrid,
            rangeRing: this.rangeRing,
            aoeRing: this.aoeRing,
            unitAnchor: this.unitAnchor,
            targetAnchor: this.targetAnchor,
            effectAnchor: this.effectAnchor,
            targetRing: this.targetRing,
        }, this.config.stage, (text, color) => this.setStageStatus(text, color));
        this.stage.initialize();
        this.viewScale = this.config.stage.viewScale;
    }

    private applyDebugDefaults(): void {
        this.viewScale = this.config.stage.viewScale;
        this.modelScale = this.config.debug.modelScale;
        this.effectScale = this.config.debug.effectScale;
        this.damageRate = this.config.debug.damageRate;
    }

    /* ------------------------------------------------------------------ *
     * 事件绑定与底色
     * ------------------------------------------------------------------ */

    private bindChrome(): void {
        this.bindClick(this.prevButton, () => this.selectCard(this.cardIndex - 1));
        this.bindClick(this.nextButton, () => this.selectCard(this.cardIndex + 1));

        this.bindClick(this.view1Button, () => this.setViewScale(this.config.stage.scaleOptions[0] ?? 1));
        this.bindClick(this.view2Button, () => this.setViewScale(this.config.stage.scaleOptions[1] ?? 2));
        this.bindClick(this.view4Button, () => this.setViewScale(this.config.stage.scaleOptions[2] ?? 4.2));

        this.bindClick(this.modelMinus, () => this.stepModelScale(-SCALE_STEP));
        this.bindClick(this.modelPlus, () => this.stepModelScale(SCALE_STEP));
        this.bindClick(this.effectMinus, () => this.stepEffectScale(-SCALE_STEP));
        this.bindClick(this.effectPlus, () => this.stepEffectScale(SCALE_STEP));

        this.bindClick(this.damageHalf, () => this.setDamageRate(0.5));
        this.bindClick(this.damage1, () => this.setDamageRate(1));
        this.bindClick(this.damage2, () => this.setDamageRate(2));

        this.bindClick(this.autoButton, () => this.toggleAutoAttack());
        this.bindClick(this.pauseButton, () => this.togglePause());
        this.bindClick(this.resetButton, () => this.resetDebug());

        for (let index = 0; index < this.skillRows.length; index += 1) {
            this.bindClick(this.skillRows[index].node, () => this.castRow(index));
        }
    }

    private bindClick(node: Node, handler: () => void): void {
        const button = node.getComponent(Button) ?? node.addComponent(Button);
        button.transition = Button.Transition.NONE;
        node.on(Button.EventType.CLICK, handler, this);
    }

    /** 底色 / 面板 / 按钮统一在这里画；节点与尺寸来自场景，颜色来自配置。*/
    private paintChrome(): void {
        const palette = this.config.palette;
        paintNode(this.backdrop, palette.background, 0);
        paintNode(this.diagnosticsNode, palette.panel, 8);
        paintNode(this.statusBg.node, palette.panel, 8);
        paintNode(this.resultBg.node, palette.panel, 8);
        paintNode(this.debugBg.node, palette.panel, 8);
        paintNode(this.logBg.node, palette.panel, 8);
        paintNode(this.badgeBody.node, palette.panelAlt, 6);
        paintNode(this.prevButton, palette.button, 8);
        paintNode(this.nextButton, palette.button, 8);
        for (const row of this.skillRows) paintNode(row.node, palette.button, 10);
        this.paintViewButtons();
        this.paintDamageButtons();
        this.paintDebugButton(this.autoButton);
        this.paintDebugButton(this.pauseButton);
        this.paintDebugButton(this.resetButton);
    }

    private paintViewButtons(): void {
        const options = this.config.stage.scaleOptions;
        this.paintOptionButton(this.view1Button, options[0], this.viewScale);
        this.paintOptionButton(this.view2Button, options[1], this.viewScale);
        this.paintOptionButton(this.view4Button, options[2], this.viewScale);
    }

    private paintDamageButtons(): void {
        this.paintOptionButton(this.damageHalf, 0.5, this.damageRate);
        this.paintOptionButton(this.damage1, 1, this.damageRate);
        this.paintOptionButton(this.damage2, 2, this.damageRate);
    }

    /** 选项按钮：值缺失就隐藏；当前值高亮。*/
    private paintOptionButton(node: Node, value: number | undefined, current: number): void {
        if (value === undefined) {
            node.active = false;
            return;
        }
        node.active = true;
        const active = Math.abs(value - current) < 1e-6;
        paintNode(node, active ? this.config.palette.buttonActive : this.config.palette.button, 8);
    }

    private paintDebugButton(node: Node): void {
        paintNode(node, this.config.palette.button, 8);
    }

    /** 开关类按钮：打开时用高亮色，避免"点了但看不出状态"。*/
    private paintToggleButton(node: Node, active: boolean): void {
        paintNode(node, active ? this.config.palette.buttonActive : this.config.palette.button, 8);
    }

    /* ------------------------------------------------------------------ *
     * 卡牌渲染
     * ------------------------------------------------------------------ */

    private selectCard(index: number): void {
        if (!this.cards.length) return;
        const count = this.cards.length;
        this.cardIndex = ((index % count) + count) % count;
        this.renderCard();
        this.refreshStatus();
    }

    private currentCard(): ITestKapaiCard | null {
        return this.cards.length ? this.cards[this.cardIndex] : null;
    }

    private renderCard(): void {
        const card = this.currentCard();
        if (!card) return;
        const rarityColors = ['#8C99A6', '#5FBF6A', '#4E9BE8', '#B96BE8', '#E8B44E'];
        const frameColor = rarityColors[Math.min(rarityColors.length - 1, card.rarityColorIndex)];
        paintNode(this.badgeFrame.node, frameColor, 8);
        this.badgeName.string = card.name;
        this.badgeMeta.string = `${card.typeLabel} · ${card.rarityLabel} · ${card.id}`;
        this.switchName.string = card.name;
        this.switchIndex.string = `${this.cardIndex + 1} / ${this.cards.length}`;
        this.headerSub.string = card.playable
            ? `${card.typeLabel} · ${card.skills.length} 技能\n模型 ${shortName(card.unitPrefabPath) || '无'}`
            : `${card.typeLabel} · 无技能行`;
        this.targetName.string = this.config.damageTest.targetName;

        void this.stage?.showUnit(card.unitPrefabPath, card.prefabSize);
        const areaRadius = card.skills.reduce((max, skill) => Math.max(max, skill.areaRadius), 0);
        this.stage?.setRanges(card.attackRange, areaRadius);
        this.renderStats(card);
        this.rebuildSkillRows();
        this.refreshViewTag();
    }

    private renderStats(card: ITestKapaiCard): void {
        for (let index = 0; index < this.statCells.length; index += 1) {
            const cell = this.statCells[index];
            const stat = card.stats[index];
            cell.active = !!stat;
            if (!stat) continue;
            const label = requiredLabel(cell, 'Label');
            const value = requiredLabel(cell, 'Value');
            const source = requiredLabel(cell, 'Source');
            label.string = stat.label;
            value.string = stat.value;
            source.string = stat.source;
        }
    }

    private rebuildSkillRows(): void {
        const card = this.currentCard();
        for (let index = 0; index < this.skillRows.length; index += 1) {
            const row = this.skillRows[index];
            const skill = card && card.playable ? card.skills[index] : undefined;
            row.node.active = !!skill;
            if (!skill) continue;
            const runtime = this.skillRuntime[index];
            runtime.readyAt = 0;
            runtime.charge = 0;
            runtime.dimmed = false;
            runtime.cdText = '';
            row.name.string = skill.name;
            row.phase.string = this.phaseText(skill, 0);
            row.meta.string = this.metaText(skill);
            this.paintSkillReady(index);
        }
    }

    private phaseText(skill: ITestKapaiSkill, charge: number): string {
        if (skill.attacksRequired > 0) return `${skill.triggerText} ${charge}/${skill.attacksRequired}`;
        return `${skill.triggerText} · ${skill.detail}`;
    }

    private metaText(skill: ITestKapaiSkill): string {
        const card = this.currentCard();
        const damage = card && card.definition && this.rules
            ? damageOfSkill(skill, card.definition, this.rules, this.damageRate)
            : skill.damage;
        return `${damage} 伤害\n${skill.attacksRequired > 0
            ? `需 ${skill.attacksRequired} 次普攻`
            : `CD ${formatSeconds(skill.cooldownSeconds)}`}`;
    }

    private refreshSkillMeta(): void {
        const card = this.currentCard();
        if (!card) return;
        for (let index = 0; index < this.skillRows.length; index += 1) {
            const skill = card.skills[index];
            if (!skill) continue;
            this.skillRows[index].meta.string = this.metaText(skill);
            this.skillRows[index].phase.string = this.phaseText(skill, this.skillRuntime[index].charge);
        }
    }

    /* ------------------------------------------------------------------ *
     * 技能释放
     * ------------------------------------------------------------------ */

    private castRow(index: number): void {
        const card = this.currentCard();
        if (!card || !card.playable) return;
        const skill = card.skills[index];
        if (!skill) return;
        const runtime = this.skillRuntime[index];
        if (runtime.readyAt > this.elapsed) return;

        // 强化那一击按真实口径计次（`pvpSkill.empoweredEvery`）：没满只累积，不结算伤害。
        if (skill.attacksRequired > 0) {
            runtime.charge += 1;
            if (runtime.charge < skill.attacksRequired) {
                this.skillRows[index].phase.string = this.phaseText(skill, runtime.charge);
                this.pushLog(`【${card.name}】${skill.name} 蓄力 ${runtime.charge}/${skill.attacksRequired}`
                    + `（还差 ${skill.attacksRequired - runtime.charge} 次普攻）`);
                return;
            }
            runtime.charge = 0;
            this.skillRows[index].phase.string = this.phaseText(skill, 0);
        }

        this.resolveHit(skill);
        if (skill.cooldownSeconds > 0) {
            runtime.readyAt = this.elapsed + skill.cooldownSeconds;
            this.paintSkillCooldown(index, skill.cooldownSeconds);
        }
        if (skill.kind === 'basic') this.feedEmpoweredCharge();
        this.stage?.setRanges(card.attackRange, skill.areaRadius);
        this.flashTitle();
    }

    /** 普攻命中后累计强化技次数；到门槛直接打出（与真实节拍一致）。*/
    private feedEmpoweredCharge(): void {
        const card = this.currentCard();
        if (!card) return;
        for (let index = 0; index < card.skills.length; index += 1) {
            const skill = card.skills[index];
            if (skill.kind !== 'empowered' || skill.attacksRequired <= 0) continue;
            const runtime = this.skillRuntime[index];
            runtime.charge += 1;
            if (runtime.charge < skill.attacksRequired) {
                this.skillRows[index].phase.string = this.phaseText(skill, runtime.charge);
                return;
            }
            runtime.charge = 0;
            this.skillRows[index].phase.string = this.phaseText(skill, 0);
            this.resolveHit(skill);
            return;
        }
    }

    /** 一次真实伤害：真实公式 + 靶子扣血 + 飘字 + 特效 + 明细。*/
    private resolveHit(skill: ITestKapaiSkill): void {
        const card = this.currentCard();
        if (!card || !card.definition || !this.rules) return;
        const damage = damageOfSkill(skill, card.definition, this.rules, this.damageRate);
        const factors = factorsOfSkill(skill, this.damageRate);

        this.totalDamage += damage;
        this.castCount += 1;
        const brokeBefore = this.targetHp > 0 && damage >= this.targetHp;
        this.targetHp = Math.max(0, this.targetHp - damage);
        if (brokeBefore) this.targetHp = this.config.damageTest.targetMaxHp;

        this.spawnFloat(damage);
        void this.playSkillEffect(skill);
        this.pushLog(
            `【${card.name}】${skill.name}（#${skill.skillId}）→ ${damage} 伤害`
            + `（攻击 ${factors.attack} × 品级 ${round2(factors.tier)} × 克制 ${factors.counter}`
            + ` × 全局 ${round2(factors.global)} × 技能 ${round2(factors.skillRate)}）`,
        );
        if (brokeBefore) {
            this.pushLog(`${this.config.damageTest.targetName}被击破，血量重置 ${this.config.damageTest.targetMaxHp}`);
        }
        this.resultText.string = `本次 ${damage} 伤害 · 击破需 `
            + `${Math.max(1, Math.ceil(this.config.damageTest.targetMaxHp / Math.max(1, damage)))} 次（明细见日志）`;
        this.refreshStatus();
    }

    private async playSkillEffect(skill: ITestKapaiSkill): Promise<void> {
        const stage = this.stage;
        if (!stage) return;
        if (!skill.effectPrefabPath) {
            this.setStageStatus(`pvpSkill[${skill.skillId}] 未登记 effectPrefabPath，仅演示数值`, this.config.stage.errorColor);
            return;
        }
        const result = await stage.playEffect(skill.effectPrefabPath);
        if (!this.isValid || !result) return;
        this.setStageStatus(
            `${skill.name} 特效 ${round2(result.total)}px · 战斗 ${round2(result.battle)}×`
            + ` / 覆盖 ${round2(this.effectScale)}× / 视图 ${round2(this.viewScale)}×`,
            this.config.stage.guideColor,
        );
    }

    /* ------------------------------------------------------------------ *
     * 调试控制
     * ------------------------------------------------------------------ */

    private setViewScale(scale: number): void {
        if (scale === this.viewScale) return;
        this.viewScale = scale;
        this.stage?.setViewScale(scale);
        this.refreshViewTag();
        this.paintViewButtons();
    }

    private stepModelScale(delta: number): void {
        this.modelScale = clampScale(this.modelScale + delta);
        this.stage?.setModelScale(this.modelScale);
        this.refreshOverrideLabels();
    }

    private stepEffectScale(delta: number): void {
        this.effectScale = clampScale(this.effectScale + delta);
        this.stage?.setEffectScale(this.effectScale);
        this.refreshOverrideLabels();
    }

    private setDamageRate(rate: number): void {
        this.damageRate = rate;
        this.refreshOverrideLabels();
        this.refreshSkillMeta();
        this.paintDamageButtons();
    }

    private toggleAutoAttack(): void {
        this.autoAttack = !this.autoAttack;
        this.autoNextAt = 0;
        this.setButtonText(this.autoButton, this.autoAttack ? '停止自动' : '自动攻击');
        this.paintToggleButton(this.autoButton, this.autoAttack);
    }

    private togglePause(): void {
        this.paused = !this.paused;
        this.setButtonText(this.pauseButton, this.paused ? '继续' : '暂停');
        this.paintToggleButton(this.pauseButton, this.paused);
    }

    private resetDebug(): void {
        this.applyDebugDefaults();
        this.stage?.setViewScale(this.viewScale);
        this.stage?.setModelScale(this.modelScale);
        this.stage?.setEffectScale(this.effectScale);
        this.paused = false;
        this.autoAttack = false;
        this.autoNextAt = 0;
        this.totalDamage = 0;
        this.castCount = 0;
        this.targetHp = this.config.damageTest.targetMaxHp;
        this.autoButton.getChildByName('Text')!.getComponent(Label)!.string = '自动攻击';
        this.pauseButton.getChildByName('Text')!.getComponent(Label)!.string = '暂停';
        this.paintToggleButton(this.autoButton, false);
        this.paintToggleButton(this.pauseButton, false);
        this.paintViewButtons();
        this.paintDamageButtons();
        this.refreshOverrideLabels();
        this.refreshSkillMeta();
        this.refreshStatus();
        this.resultText.string = '等待释放 · 视图 ×1.0 即战场 1:1';
        this.pushLog('调试项已复位（覆盖不写入配置）');
    }

    private refreshOverrideLabels(): void {
        this.viewValue.string = `×${formatScale(this.viewScale)}`;
        this.modelValue.string = `×${this.modelScale.toFixed(2)}`;
        this.effectValue.string = `×${this.effectScale.toFixed(2)}`;
    }

    private refreshViewTag(): void {
        const options = this.config.stage.scaleOptions;
        this.viewValue.string = `×${formatScale(this.viewScale)}`;
        this.scaleTag.string = `格 36×42 · 视图 ×${formatScale(this.viewScale)}`;
        this.setButtonText(this.view1Button, options[0] === undefined ? '' : `×${formatScale(options[0])}`);
        this.setButtonText(this.view2Button, options[1] === undefined ? '' : `×${formatScale(options[1])}`);
        this.setButtonText(this.view4Button, options[2] === undefined ? '' : `×${formatScale(options[2])}`);
    }

    private setButtonText(node: Node, text: string): void {
        node.getChildByName('Text')!.getComponent(Label)!.string = text;
    }

    private refreshStatus(): void {
        this.statusTotal.string = `累计伤害 ${this.totalDamage}`;
        this.statusCasts.string = `释放 ${this.castCount} 次`;
        this.renderTargetLabel();
    }

    private renderTargetLabel(): void {
        const max = this.config.damageTest.targetMaxHp;
        this.statusTarget.string = `${this.config.damageTest.targetName} ${this.targetHp} / ${max}`;
        this.statusTarget.color = this.targetHp <= max * 0.3
            ? toColor(this.config.palette.danger)
            : toColor(this.config.palette.muted);
        this.targetHpLabel.string = `${this.targetHp} / ${max}`;
    }

    private setStageStatus(text: string, color: string): void {
        this.stageStatus.string = text;
        this.stageStatus.color = toColor(color);
    }

    /* ------------------------------------------------------------------ *
     * 冷却 / 飘字 / 自动攻击
     * ------------------------------------------------------------------ */

    private updateCooldowns(): void {
        for (let index = 0; index < this.skillRuntime.length; index += 1) {
            const runtime = this.skillRuntime[index];
            if (runtime.readyAt <= 0) continue;
            const remain = runtime.readyAt - this.elapsed;
            if (remain <= 0) {
                runtime.readyAt = 0;
                this.paintSkillReady(index);
            } else {
                this.paintSkillCooldown(index, remain);
            }
        }
    }

    private paintSkillReady(index: number): void {
        const row = this.skillRows[index];
        const runtime = this.skillRuntime[index];
        runtime.dimmed = false;
        runtime.cdText = '';
        row.maskNode.active = false;
        row.cd.string = '';
        paintNode(row.node, this.config.palette.button, 10);
    }

    private paintSkillCooldown(index: number, remain: number): void {
        const row = this.skillRows[index];
        const runtime = this.skillRuntime[index];
        const total = this.currentCard()?.skills[index]?.cooldownSeconds ?? 0;
        const ratio = total > 0 ? Math.max(0, Math.min(1, remain / total)) : 0;
        const size = row.node.getComponent(UITransform)!.contentSize;
        const maskHeight = size.height * ratio;

        if (!runtime.dimmed) {
            runtime.dimmed = true;
            paintNode(row.node, this.config.palette.buttonDisabled, 10);
        }
        row.maskNode.active = maskHeight > 0.01;
        if (row.maskNode.active) {
            const maskTransform = row.maskNode.getComponent(UITransform)!;
            maskTransform.setContentSize(size.width, maskHeight);
            row.maskNode.setPosition(0, size.height / 2, 0);
            const maskColor = toColor(this.config.palette.buttonDisabled);
            maskColor.a = 200;
            row.maskSprite.color = maskColor;
        }
        const text = `${remain.toFixed(1)}s`;
        if (text !== runtime.cdText) {
            runtime.cdText = text;
            row.cd.string = text;
        }
        row.name.color = toColor(this.config.palette.text);
    }

    private spawnFloat(damage: number): void {
        if (!this.floatRuntime.length) return;
        const state = this.floatRuntime[this.floatCursor % this.floatRuntime.length];
        this.floatCursor += 1;
        state.active = true;
        state.startedAt = this.elapsed;
        state.label.node.active = true;
        state.label.string = `-${damage}`;
        state.opacity.opacity = 255;
        state.label.node.setPosition(0, 18, 0);
    }

    private updateFloats(): void {
        for (const state of this.floatRuntime) {
            if (!state.active) continue;
            const progress = (this.elapsed - state.startedAt) / FLOAT_SECONDS;
            if (progress >= 1) {
                state.active = false;
                state.label.node.active = false;
                continue;
            }
            state.label.node.setPosition(0, 18 + progress * 44, 0);
            state.opacity.opacity = Math.round(255 * (1 - progress));
        }
    }

    private updateAutoAttack(): void {
        if (!this.autoAttack) return;
        const card = this.currentCard();
        if (!card || !card.playable) return;
        const basic = card.skills[0];
        if (!basic || basic.cooldownSeconds <= 0) return;
        if (this.autoNextAt <= 0) this.autoNextAt = this.elapsed;
        if (this.elapsed < this.autoNextAt) return;
        this.autoNextAt = this.elapsed + basic.cooldownSeconds;
        this.castRow(0);
    }

    /* ------------------------------------------------------------------ *
     * 日志与诊断
     * ------------------------------------------------------------------ */

    private pushLog(line: string): void {
        this.logLines.unshift(line);
        if (this.logLines.length > 6) this.logLines.length = 6;
        if (this.logLabel) this.logLabel.string = this.logLines.join('\n');
    }

    private renderDiagnostics(): void {
        const errors = this.issues.filter((issue) => issue.level === 'error');
        const warns = this.issues.filter((issue) => issue.level === 'warn');
        if (!errors.length && !warns.length) {
            this.diagnosticsNode.active = false;
            return;
        }
        this.diagnosticsNode.active = true;
        const ordered = errors.concat(warns);
        const shown = ordered.slice(0, 2);
        const rest = ordered.length - shown.length;
        this.diagnosticsText.string = shown.map((issue) => formatZCTestKapaiIssue(issue)).join('\n')
            + (rest > 0 ? `\n…另有 ${rest} 条，见控制台` : '');
    }

    private flashTitle(): void {
        this.headerTitle.color = toColor(this.config.palette.accent);
        this.scheduleOnce(() => {
            if (this.headerTitle) this.headerTitle.color = toColor(this.config.palette.text);
        }, 0.25);
    }
}

/* ------------------------------------------------------------------ *
 * 场景节点工具
 * ------------------------------------------------------------------ */

function requiredNode(parent: Node, name: string): Node {
    const node = parent.getChildByName(name);
    if (!node) throw new Error(`${parent.name} 缺少子节点 ${name}（TestKapai 场景结构被改动？）`);
    return node;
}

function requiredLabel(parent: Node, name: string): Label {
    const label = requiredNode(parent, name).getComponent(Label);
    if (!label) throw new Error(`${parent.name}/${name} 缺少 Label 组件`);
    return label;
}

function requiredSprite(parent: Node): Sprite {
    const sprite = parent.getComponent(Sprite);
    if (!sprite) throw new Error(`${parent.name} 缺少 Sprite 组件（底色应由 white.png 承载）`);
    return sprite;
}

/** 矩形底色只改 Sprite 的颜色；尺寸与版式由场景节点决定，不再画矢量图形。*/
function paintNode(node: Node, color: string, _radius = 0): void {
    const sprite = node.getComponent(Sprite);
    if (!sprite) throw new Error(`${node.name} 缺 Sprite（底色应由 white.png 承载）`);
    sprite.color = toColor(color);
}

/** `#RRGGBB` / `#RRGGBBAA` → Color。不用 `Color.fromHEX`，避开版本间行为差异。*/
function toColor(hex: string): Color {
    const value = hex.startsWith('#') ? hex.slice(1) : hex;
    const r = parseInt(value.substring(0, 2), 16) || 0;
    const g = parseInt(value.substring(2, 4), 16) || 0;
    const b = parseInt(value.substring(4, 6), 16) || 0;
    const a = value.length >= 8 ? parseInt(value.substring(6, 8), 16) : 255;
    return new Color(r, g, b, Number.isFinite(a) ? a : 255);
}

function formatSeconds(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '无';
    return `${Math.round(value * 10) / 10}s`;
}

function formatScale(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** 模型路径只留最后一段，避免 `skel/豌豆射手/豌豆射手` 把头部行撑爆。*/
function shortName(prefabPath: string): string {
    const parts = prefabPath.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}

function clampScale(value: number): number {
    return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, value)) * 100) / 100;
}

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
