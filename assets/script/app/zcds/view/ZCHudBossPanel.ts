import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import type { ZCDefenceWaveProgress } from '../model/ZCGameModel';

const { ccclass, property } = _decorator;

/**
 * 波次徽标的排版结果。
 *
 * 这三块文字必须带描边：这一版面板没有深色底板，白字是直接压在地图沙地上的
 * （设计稿渲染图里沙地亮度 230+，纯白字不加描边糊成一片）。
*/
export interface IZCHudBossWaveText {
    text: string;
    fontSize: number;
    lineHeight: number;
    outlineWidth: number;
}

/** 波次徽标字号（设计稿文字框 109×32、白核高 29.9 ⇒ fontSize ≈ 32）。*/
const ZC_BOSS_WAVE_FONT_SIZE = 32;
/** 倍率徽标字号（设计稿 `X4` 白核 26.5×16.1 ⇒ fontSize ≈ 22）。*/
/** 黑描边宽度（设计稿白核四周实测 2~3px）。*/
const ZC_BOSS_LABEL_OUTLINE_WIDTH = 3;

/** 波次徽标：`第4/8波`（设计稿这一帧就这一行，不再塞「下 Ns / 敌 M」）。*/
export function formatZCDefenceWaveText(progress: Readonly<ZCDefenceWaveProgress>): IZCHudBossWaveText {
    //  徽标常驻（2026-11-09 用户：波次数字信息要从第一波开始一直挂着）：
    //  第 1 波还没出场时 `spawnedWaves` 是 0，直接显示「第0/8波」很怪，钳到 1 起。
    const spawned = Math.max(1, Math.min(progress.spawnedWaves, progress.totalWaves));
    return {
        text: `第${spawned}/${progress.totalWaves}波`,
        fontSize: ZC_BOSS_WAVE_FONT_SIZE,
        lineHeight: ZC_BOSS_WAVE_FONT_SIZE + 6,
        outlineWidth: ZC_BOSS_LABEL_OUTLINE_WIDTH,
    };
}

/** 血量倍率 → `X4`（整数不带小数点，与设计稿一致）；非法值退回 `X1`。*/
export function formatZCDefenceHpRate(hpRate: number): string {
    if (!Number.isFinite(hpRate) || hpRate <= 0) return 'X1';
    return `X${Number.isInteger(hpRate) ? hpRate : Number(hpRate.toFixed(2))}`;
}

/**
 * 结算扣血动画时长（秒）。
 *
 * 与结算镜头拉远（`ZCGameHUDView.MAP_SETTLEMENT_ZOOM_SECONDS` 0.55s）同一拍：
 * 血条先降完、镜头再拉远、然后才扫场。取 0.5s 是因为这段要「看得出是个过程」
 * （BOSS 被打死那一下一条满血条瞬间归零很像卡帧），又不能拖住结算节奏。
*/
export const ZC_BOSS_HP_DRAIN_SECONDS = 0.5;

/**
 * 扣血动画某一帧的比例：`from` → `to` 按 smoothstep（`t²(3−2t)`）过渡。
 *
 * 与单位血条的白条（`healthBarDamageTrailScale`）同一套缓动：两端速度为 0，
 * 看上去像被「抽干」而不是被「切」掉。`elapsed` 越界直接落在两端（幂等）。
*/
export function bossHpDrainRatio(from: number, to: number, elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return from;
    if (elapsed >= ZC_BOSS_HP_DRAIN_SECONDS) return to;
    const progress = elapsed / ZC_BOSS_HP_DRAIN_SECONDS;
    return from + (to - from) * progress * progress * (3 - 2 * progress);
}

/**
 * 波次怪守城（塔防）模式左上角的首领条：骷髅 + `第4/8波` + 首领头像框 + 名字 + 红血条 + `X4`。
 *
 * 几何、尺寸与全部美术都在 `ZCBossPanel.prefab` 里（蓝湖「BOSS」稿，画布 720×1610，切片 1:1），
 * 代码只按数据刷「文案 / 头像 / 血量比例」。面板整体由 `ZCGame` 在守城局实例化并注入数据
 * （与 `ZCSpawnSelection` 同一条路子：`ZCGameLoader` 预加载 → `ZCGame` 实例化）。
 *
 * 两块文案的格式化（`formatZCDefenceWaveText` / `formatZCDefenceHpRate`）就放在本文件：
 * 它们只服务这一块面板（合并前在 `ZCDefenceWaveText.ts`，2026-10-13 山猫让合进来删掉那个模块）。
 *
 * 数据口径（山猫 2026-10-13 定）：
 * · 血条 = 本波剩余总血量 / 本波总血量（按波聚合，不是取某只代表怪）
 * · `X{n}` = 该波的血量倍率（`wave.hpRate`）
 * · 头像与名字 = 当前波（`currentWaveId`）那波的怪
 *
 * 🔴 2026-11-20：头像框 / 名字 / 血条 / 倍率这整组只在 **BOSS 波** 显示（`setBossBarVisible`），
 * 非 BOSS 波只留骷髅 + `第N/M波` 徽标；普通小怪走自己的头顶血条。
*/
@ccclass('ZCHudBossPanel')
export class ZCHudBossPanel extends Component {
    @property({ type: Label, group: '节点引用', tooltip: 'WaveText：第N/M波（白字黑描边，压在沙地上）' })
    waveLabel: Label = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Portrait/Icon：首领头像（当前波那波的怪）' })
    portraitIcon: Sprite = null;

    @property({ type: Label, group: '节点引用', tooltip: 'BossName：首领名字' })
    nameLabel: Label = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Bar/Fill：本波血条填充（FILLED 横条）' })
    hpFill: Sprite = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Bar/Rate：血量倍率 X4' })
    rateLabel: Label = null;

    /** 上一次真正写进 `hpFill.fillRange` 的比例（= 结算扣血动画的起点，也是「没演动画时」的唯一真源）。*/
    private displayedRatio = 1;
    /** 数据侧最新比例；扣血动画期间只更新它，不直接落地。*/
    private targetRatio = 1;
    /** 扣血动画的起点比例与已播秒数（`draining` 为 true 时有效）。*/
    private drainFrom = 0;
    private drainElapsed = 0;
    private draining = false;
    /** 血条组是否可见（`setBossBarVisible` 的最近一次入参）：藏着时不做扣血演出。*/
    private barVisible = true;

    /**
     * 当前波的头像 / 名字 / 总血条显隐（「大血条」整组）。
     *
     * 🔴 只在 BOSS 波为 true（2026-11-20 恢复 SVN 回退）：非 BOSS 怪只有头顶血条，
     * 这一组三者一起收起，普通波不再挂首领头像框 / 名字 / 总血条。
     *
     * 波次徽标（`IconBoss` + `WaveText`）不在这里控制：它从第一波起常驻（2026-11-09 用户）。
     * 三处引用都取自本组件已绑定的 Inspector 引用，不需要在 prefab 上再加容器节点：
     * · 头像框 = `Portrait`（`portraitIcon` 绑在它的子节点 `Icon` 上 ⇒ 要收的是父节点，
     *   只藏 `Icon` 会在普通波留下一个空头像框）
     * · 名字 = `BossName`
     * · 血条 = `Bar`（`Fill` / `Rate` 的父节点）
    */
    setBossBarVisible(visible: boolean): void {
        const portrait = this.portraitIcon.node.parent ?? this.portraitIcon.node;
        portrait.active = visible;
        this.nameLabel.node.active = visible;
        const bar = this.hpFill.node.parent;
        if (bar) bar.active = visible;
        // 血条组藏着的时候没有「扣血」可看 ⇒ 结算也别为它多等半秒（见 `beginHpDrain`）。
        this.barVisible = visible;
    }

    /**
     * 全量赋值（每次渲染都会被调）。
     *
     * 头像帧异步取得；切波尚未加载时清空旧图，避免把上一波的怪当作当前波。
     *
     * 血条分两条路：平时（对局中）按最新血量**直接落地**；只有在结算扣血动画期间
     * （`beginHpDrain` 之后）才只记目标、由 `advanceHpDrain` 逐帧把条降下去 ——
     * 这样「打怪时血条跟手」和「结算时看得见扣血」两件事互不影响。
    */
    render(progress: Readonly<ZCDefenceWaveProgress>, name: string, portrait: SpriteFrame | null): void {
        const wave = formatZCDefenceWaveText(progress);
        this.waveLabel.string = wave.text;
        this.waveLabel.fontSize = wave.fontSize;
        this.waveLabel.lineHeight = wave.lineHeight;
        this.waveLabel.outlineWidth = wave.outlineWidth;

        this.nameLabel.string = name;
        this.rateLabel.string = formatZCDefenceHpRate(progress.currentWaveHpRate);
        this.portraitIcon.spriteFrame = portrait;

        // 分母取「生成那一刻记下的总血量」，分母为 0（该波没生成出单位）时条画空。
        const ratio = progress.currentWaveMaxHp > 0 ? progress.currentWaveHp / progress.currentWaveMaxHp : 0;
        this.targetRatio = Math.max(0, Math.min(1, ratio));
        if (!this.draining) this.applyHpRatio(this.targetRatio);
    }

    /**
     * 结算起手：把血条钉在「死前那一刻的比例」上，随后的新血量改成补间落地。
     *
     * **必须在把最终血量 `render` 进面板之前调**，否则条已经跳到 0，起点就丢了。
     * 这里不判「有没有真的掉血」—— 那一刻面板拿到的还是旧数据（新血量在随后的
     * `render` 里才进来），判定统一放到 `advanceHpDrain` 的第一帧：没掉血 / 回血 /
     * 条是隐藏的，就当场放行，调用方不会为空动画白等。
    */
    beginHpDrain(): void {
        this.drainFrom = this.displayedRatio;
        this.drainElapsed = 0;
        this.draining = true;
    }

    /**
     * 推进扣血动画。返回 `true` = 还在播（调用方先别开结算演出）。
     *
     * 按 `dt` 累加而不是取绝对时间：它与扫场（`ZCVictorySweep.advance(dt)`）同处结算分支、
     * 同一个 `dt` 源，两者不会互相错位。
    */
    advanceHpDrain(dt: number): boolean {
        if (!this.draining) return false;
        // 起手之后的第一次推进才拿得到真正的目标：没掉血（相等 / 回血）或条藏着 ⇒
        // 这不是「被扣」，硬拉一条动画只会显得卡 ⇒ 当帧放弃动画、把条写到位。
        if (!this.barVisible || !(this.targetRatio < this.drainFrom - 1e-4)) {
            this.draining = false;
            this.applyHpRatio(this.targetRatio);
            return false;
        }
        this.drainElapsed += Math.max(0, dt);
        const done = this.drainElapsed >= ZC_BOSS_HP_DRAIN_SECONDS;
        this.applyHpRatio(done
            ? this.targetRatio
            : bossHpDrainRatio(this.drainFrom, this.targetRatio, this.drainElapsed));
        this.draining = !done;
        return this.draining;
    }

    private applyHpRatio(ratio: number): void {
        this.displayedRatio = ratio;
        this.hpFill.fillRange = ratio;
    }
}
