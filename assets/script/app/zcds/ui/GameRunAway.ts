import { _decorator, Button, Color, Graphics, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { HeadArt } from '../../HeadArt';
import type { ZCCardRarity } from '../model/ZCCombatCatalog';
import { createIconLoader } from '../../common/SpriteFrameCache';
import {
    buildDamageStatsColumns,
    damageValueOf,
    enemyOwnersOf,
    type IZCDamageStatsSeats,
    type IZCDamageStatsUnit,
    type ZCDamageStatsMetric,
} from '../model/ZCDamageStats';
import type { ZCOwner } from '../model/ZCMapConfig';
import { RUNAWAY_QUALITY_FRAME_NAMES, RUNAWAY_QUALITY_FRAME_ROOT } from './RunAwayQualityArt';
import { RunAwayUnitItem } from './RunAwayUnitItem';

const { ccclass, property } = _decorator;

/**
 * 敌方头像栏的版面：单个头像边长与间距。
 *
 * 栏位在「我方 / 敌方」那条标题带里（`EnemySeats`，右沿 = 敌方列右沿 249，宽 151）——
 * 三颗 40 + 两道 8 = 136，右对齐后正好不压到「敌方」二字（标头占 18~98）。
 * 选中标记画在头像内侧（白框），不额外占竖向空间：标题带上下只有 1~9px 余量。
 */
const SEAT_CHIP_SIZE = 40;
const SEAT_CHIP_GAP = 8;
/** 选中框的线宽（贴在 40×40 头部外侧的内缩 1px 矩形）。*/
const SEAT_RING_WIDTH = 2;

/** 未选中的头像压暗（选中 = 原色）。没有第二套美术，靠明暗 + 白框表达选中。*/
let idleSeatColor: Color | null = null;
function seatIdleColor(): Color {
    return idleSeatColor ??= new Color(120, 122, 128, 255);
}

export interface GameRunAwayOptions {
    /** 本局逐单位（卡）统计，由运行期控制器组装；弹窗自己按我方 / 敌方分栏。*/
    readonly units?: readonly IZCDamageStatsUnit[];
    /**
     * 席位上下文（本局席位 + 名字 / 头像档案）。
     *
     * 有它才画敌方头像栏、才把敌方列收成「当前选中的那一方」；缺省 ⇒ 头像栏整组不建，
     * 敌方列退回「全部敌方合并」的老口径（结算期老调用方 / 本地局）。
     */
    readonly seats?: IZCDamageStatsSeats;
}

/**
 * 战斗统计弹窗（蓝湖「统计伤害」，542×542 居中；设计节点 720×1610 → 游戏 720×1280）。
 *
 * 两个页签共用同一份数据：伤害统计 / 承伤统计；每列一个纵向虚拟列表，
 * 行 = 单位（卡），进度条 = **本行数值 ÷ 本列合计**（占全队总量的占比，不是「列内第一满格」）。
 * 点击面板外空白关闭。
 *
 * 与旧版「逐玩家 4 行」的区别：行数不再固定，列表可以上下滑动；因此不在这里缓存
 * 行组件或按玩家下标取数，所有渲染都走 `VirtualScrollView.renderItemFn(node, index)`。
 *
 * 2026-11-24 三条改动（都在这一个弹窗里）：
 * 1. **初始顺序 = 阵容序**：数据源已把各席位卡组里还没出伤害的卡按 0 补齐并带 `deckOrder`，
 *    排序口径 `compareDamageStatsRows` 是「数值降序 → 阵容序」，开局全 0 自然落到阵容序；
 *    一旦有数据就按数值降序（不需要额外的阶段开关）。
 * 2. **敌方只显示选中的一方**：`EnemySeats` 头像栏点谁就只看谁，默认选席位序最小的敌方。
 * 3. **头像栏右对齐**：最后一个敌方贴右沿，席位少的局也不会飘在中间。
 */
@ccclass('GameRunAway')
export class GameRunAway extends PopupBase {
    static prefabPath = 'ui/game/GameRunAway';

    /**
     * 不播统一离场过渡（与 `ZCSettlementPage` 同一条口径，见 `PopupBase.motionEnabled`）。
     *
     * 离场过渡会把节点寿命延长 0.16s，而 `_internalClose` 同步 dispose 资源作用域，
     * 头像 / 图标在 `EVENT_AFTER_DRAW` 就被销毁 ⇒ 淡出期间每帧崩
     * `frame should not be invalid, it may have been released`。
     */
    motionEnabled = false;

    @property({ type: VirtualScrollView, tooltip: 'OwnList：我方单位虚拟列表（纵向）' })
    ownList: VirtualScrollView = null!;

    @property({ type: VirtualScrollView, tooltip: 'EnemyList：敌方单位虚拟列表（纵向）' })
    enemyList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'EnemySeats：敌方席位头像栏（右对齐，运行时按席位建头像）' })
    enemySeats: Node | null = null;

    @property({ type: Button, tooltip: 'DamageTab：伤害统计页签' })
    damageTab: Button = null!;

    @property({ type: Button, tooltip: 'TakenTab：承伤统计页签' })
    takenTab: Button = null!;

    @property({ type: Sprite, tooltip: 'DamageTabBg：伤害页签底板' })
    damageTabBg: Sprite = null!;

    @property({ type: Sprite, tooltip: 'TakenTabBg：承伤页签底板' })
    takenTabBg: Sprite = null!;

    private units: readonly IZCDamageStatsUnit[] = [];
    private seats: IZCDamageStatsSeats | null = null;
    private metric: ZCDamageStatsMetric = 'damage';
    private ownRows: readonly IZCDamageStatsUnit[] = [];
    private enemyRows: readonly IZCDamageStatsUnit[] = [];
    /** 我方列的进度条分母（我方全队合计）。*/
    private totalOwn = 0;
    /** 敌方列的进度条分母（当前选中那一方的合计）。*/
    private totalEnemy = 0;
    /** 头像栏里的席位（席位序；不含玩家自己）。*/
    private seatOwners: readonly ZCOwner[] = [];
    /** 当前选中的敌方；`null` = 本局没有敌方（或没有席位上下文）。*/
    private selectedEnemy: ZCOwner | null = null;
    private readonly seatHeads = new Map<ZCOwner, Sprite>();
    private readonly seatRings = new Map<ZCOwner, Node>();
    private readonly seatFrames = new Map<ZCOwner, SpriteFrame>();
    private readonly iconFrames = new Map<string, SpriteFrame>();
    /** 品级底框（4 张固定图）：行渲染时按 `unit.rarity` 取。*/
    private readonly qualityFrames = new Map<ZCCardRarity, SpriteFrame>();
    private tabOnFrame: SpriteFrame | null = null;
    private tabOffFrame: SpriteFrame | null = null;

    protected onInit(): void {
        // 初始版面：伤害页签选中（亮底），承伤页签未选中（暗底）。
        this.tabOnFrame = this.damageTabBg.spriteFrame;
        this.tabOffFrame = this.takenTabBg.spriteFrame;
        this.damageTab.node.on(Button.EventType.CLICK, this.selectDamage, this);
        this.takenTab.node.on(Button.EventType.CLICK, this.selectTaken, this);
        // 绑定一次（PopupBase 保证 onInit 每实例只跑一次）；按 index 现取本趟数据。
        this.ownList.renderItemFn = (node, index) => this.renderRow(node, index, this.ownRows, this.totalOwn);
        this.enemyList.renderItemFn = (node, index) => this.renderRow(node, index, this.enemyRows, this.totalEnemy);
    }

    protected async onOpen(userData?: GameRunAwayOptions): Promise<void> {
        this.units = userData?.units ?? [];
        this.seats = userData?.seats ?? null;
        this.metric = 'damage';
        this.seatOwners = enemyOwnersOf(this.units, this.seats?.owners);
        this.selectedEnemy = this.seatOwners[0] ?? null;
        this.applyTabVisuals();
        this.buildSeatChips();
        this.syncColumns();

        const scope = this.resourceScope;
        const loadIcon = createIconLoader(this.assets, scope);
        const rarities = Object.entries(RUNAWAY_QUALITY_FRAME_NAMES) as [ZCCardRarity, string][];
        const qualityFrames = await Promise.all(rarities.map(([, name]) => loadIcon(name, RUNAWAY_QUALITY_FRAME_ROOT)));
        if (!this.isValid || scope.disposed) return;
        rarities.forEach(([rarity], index) => {
            const frame = qualityFrames[index];
            if (frame) this.qualityFrames.set(rarity, frame);
        });

        const keys = Array.from(new Set(this.units.map(unit => unit.iconKey).filter(Boolean)));
        if (keys.length) {
            const resolver = await HeadArt.loadIconArtResolver(this.configs);
            if (!this.isValid || scope.disposed) return;
            const frames = await Promise.all(keys.map(key => HeadArt.loadHeadIconFrame(key, loadIcon, resolver)));
            if (!this.isValid || scope.disposed) return;
            keys.forEach((key, index) => { if (frames[index]) this.iconFrames.set(key, frames[index]); });
        }

        if (this.enemySeats && this.seatOwners.length) {
            // 席位头像是「角色 id → head 表 → 图标名 → 资源」（与 HUD 左侧四行同一口径）；
            // 直接拼 `icons/head/<id>` 会报 `Bundle resources doesn't contain …`。
            const owners = this.seatOwners;
            const frames = await Promise.all(owners.map(owner =>
                HeadArt.loadHeadFrame(this.seats?.profiles.get(owner)?.headKey ?? '')));
            if (!this.isValid || scope.disposed) return;
            owners.forEach((owner, index) => { if (frames[index]) this.seatFrames.set(owner, frames[index]); });
            this.applySeatChips();
        }

        this.updateListCounts(true);
    }

    protected onClose(): void {
        this.units = [];
        this.seats = null;
        this.ownRows = [];
        this.enemyRows = [];
        this.totalOwn = 0;
        this.totalEnemy = 0;
        this.seatOwners = [];
        this.selectedEnemy = null;
        this.releaseSeatChips();
        this.seatFrames.clear();
        this.iconFrames.clear();
        this.qualityFrames.clear();
        this.ownList.setTotalCount(0);
        this.enemyList.setTotalCount(0);
        this.metric = 'damage';
    }

    /** 运行期实时刷新；打开时的首帧由 `onOpen` 负责。*/
    refresh(units: readonly IZCDamageStatsUnit[]): void {
        this.units = units;
        this.ensureSelectedEnemy();
        this.applyColumns();
    }

    private selectDamage(): void { this.selectMetric('damage'); }
    private selectTaken(): void { this.selectMetric('taken'); }

    private selectMetric(metric: ZCDamageStatsMetric): void {
        if (this.metric === metric) return;
        this.metric = metric;
        this.applyTabVisuals();
        this.applyColumns(true);
    }

    /** 点敌方头像：切到该席位（换列 = 换一批行，所以回顶）。*/
    private selectEnemy(owner: ZCOwner): void {
        if (this.selectedEnemy === owner) return;
        this.selectedEnemy = owner;
        this.applySeatChips();
        this.applyColumns(true);
    }

    /**
     * 保证 `selectedEnemy` 落在本局敌方里。
     *
     * 打开时席位表可能还没到位（老入口只给 `units`），后续 `refresh` 才凑齐 ——
     * 那种情况下补建头像栏；选中项一旦失效就退回「席位序最小的敌方」。
     */
    private ensureSelectedEnemy(): void {
        const owners = enemyOwnersOf(this.units, this.seats?.owners);
        const sameSeats = owners.length === this.seatOwners.length && owners.every(owner => this.seatOwners.indexOf(owner) >= 0);
        if (!sameSeats) {
            this.seatOwners = owners;
            this.buildSeatChips();
        }
        if (this.selectedEnemy && owners.indexOf(this.selectedEnemy) >= 0) return;
        this.selectedEnemy = owners[0] ?? null;
        this.applySeatChips();
    }

    private applyTabVisuals(): void {
        const selected = this.metric === 'damage';
        this.damageTabBg.spriteFrame = selected ? this.tabOnFrame : this.tabOffFrame;
        this.takenTabBg.spriteFrame = selected ? this.tabOffFrame : this.tabOnFrame;
    }

    /**
     * 按当前页签重算左右两列，并把条数推给两个虚拟列表。
     *
     * 行序见 `compareDamageStatsRows`（数值降序 → 阵容序）。数据刷新会重排：开局全 0 时
     * 就是阵容序，打出伤害后高数值浮上来 —— 这是 11-24 需求，不是回归；
     * 只有切换页签 / 换敌方时才回到顶部（`resetScroll`）。
     */
    private syncColumns(): void {
        const columns = buildDamageStatsColumns(this.units, this.metric, this.selectedEnemy);
        this.ownRows = columns.own;
        this.enemyRows = columns.enemy;
        this.totalOwn = columns.totalOwn;
        this.totalEnemy = columns.totalEnemy;
    }

    private applyColumns(resetScroll = false): void {
        this.syncColumns();
        this.updateListCounts(resetScroll);
    }

    private updateListCounts(resetScroll = false): void {
        this.ownList.setTotalCount(this.ownRows.length);
        this.enemyList.setTotalCount(this.enemyRows.length);
        if (resetScroll) {
            this.ownList.scrollToTop(false);
            this.enemyList.scrollToTop(false);
        }
    }

    /**
     * 按席位建敌方头像栏（右对齐）。
     *
     * 头像栏是纯运行时节点：一局最多 3 个敌方，节点数固定且很少，不做池化；
     * 每次打开重建（关掉时 `releaseSeatChips` 销掉），避免上一局的席位残留。
     *
     * 容器 `EnemySeats` 的锚点在右沿（`anchorPoint.x = 1`），所以子节点一律用**负 x**
     * 从原点向左排 —— 一个敌方时它就正好贴在敌方列最右侧。
     */
    private buildSeatChips(): void {
        const host = this.enemySeats;
        if (!host) return;
        this.releaseSeatChips();
        const owners = this.seatOwners;
        const step = SEAT_CHIP_SIZE + SEAT_CHIP_GAP;
        owners.forEach((owner, index) => {
            const chip = new Node(`Seat_${owner}`);
            chip.layer = host.layer;
            chip.addComponent(UITransform).setContentSize(SEAT_CHIP_SIZE, SEAT_CHIP_SIZE);
            const head = chip.addComponent(Sprite);
            head.sizeMode = Sprite.SizeMode.CUSTOM;
            head.trim = false;
            //  右对齐：最后一个席位贴右沿，其余向左排（只有 1 个敌方时就在最右侧）。
            chip.setPosition(-SEAT_CHIP_SIZE / 2 - (owners.length - 1 - index) * step, 0, 0);
            const button = chip.addComponent(Button);
            button.transition = Button.Transition.NONE;
            chip.on(Button.EventType.CLICK, () => this.selectEnemy(owner));

            //  选中框画在头像内侧：标题带上下只剩 1~9px，放不下「头像 + 下划线」那种两段式标记。
            const ring = new Node('Ring');
            ring.layer = host.layer;
            ring.addComponent(UITransform).setContentSize(SEAT_CHIP_SIZE, SEAT_CHIP_SIZE);
            const pen = ring.addComponent(Graphics);
            pen.lineWidth = SEAT_RING_WIDTH;
            pen.strokeColor = Color.WHITE;
            const half = SEAT_CHIP_SIZE / 2;
            pen.rect(-half, -half, SEAT_CHIP_SIZE, SEAT_CHIP_SIZE);
            pen.stroke();
            ring.active = false;

            chip.addChild(ring);
            host.addChild(chip);
            this.seatHeads.set(owner, head);
            this.seatRings.set(owner, ring);
        });
        this.applySeatChips();
    }

    /** 刷新头像图与选中态（选中 = 原色 + 白框，未选中 = 压暗且不画框）。*/
    private applySeatChips(): void {
        for (const owner of this.seatOwners) {
            const head = this.seatHeads.get(owner);
            if (head) {
                head.spriteFrame = this.seatFrames.get(owner) ?? null;
                head.color = owner === this.selectedEnemy ? Color.WHITE : seatIdleColor();
            }
            const ring = this.seatRings.get(owner);
            if (ring) ring.active = owner === this.selectedEnemy;
        }
    }

    private releaseSeatChips(): void {
        const host = this.enemySeats;
        if (host) {
            for (const chip of host.children.slice()) {
                chip.removeFromParent();
                chip.destroy();
            }
        }
        this.seatHeads.clear();
        this.seatRings.clear();
    }

    private renderRow(
        itemNode: Node,
        index: number,
        rows: readonly IZCDamageStatsUnit[],
        total: number,
    ): void {
        const item = itemNode.getComponent(RunAwayUnitItem);
        const unit = rows[index];
        if (unit) {
            item.render(
                damageValueOf(unit, this.metric), total,
                this.iconFrames.get(unit.iconKey) ?? null,
                this.qualityFrames.get(unit.rarity) ?? null,
            );
        } else {
            item.clear();
        }
    }
}
