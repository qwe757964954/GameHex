import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import type { ZCDefenceWaveProgress } from '../model/ZCGameModel';

const { ccclass, property } = _decorator;

/**
 * 波次徽标的排版结果。
 *
 *  这三块文字**必须带描边**：这一版面板没有深色底板，白字是直接压在地图沙地上的
 * （设计稿渲染图里沙地亮度 230+，纯白字不加描边糊成一片）。
 */
export interface IZCHudBossWaveText {
    text: string;
    fontSize: number;
    lineHeight: number;
    outlineWidth: number;
}

/** 波次徽标字号（设计稿文字框 109×32、白核高 29.9 ⇒ fontSize ≈ 32）。 */
const ZC_BOSS_WAVE_FONT_SIZE = 32;
/** 倍率徽标字号（设计稿 `X4` 白核 26.5×16.1 ⇒ fontSize ≈ 22）。 */
const ZC_BOSS_RATE_FONT_SIZE = 22;
/** 黑描边宽度（设计稿白核四周实测 2~3px）。 */
const ZC_BOSS_LABEL_OUTLINE_WIDTH = 3;

/** 波次徽标：`第4/8波`（设计稿这一帧就这一行，不再塞「下 Ns / 敌 M」）。 */
export function formatZCDefenceWaveText(progress: Readonly<ZCDefenceWaveProgress>): IZCHudBossWaveText {
    return {
        text: `第${progress.spawnedWaves}/${progress.totalWaves}波`,
        fontSize: ZC_BOSS_WAVE_FONT_SIZE,
        lineHeight: ZC_BOSS_WAVE_FONT_SIZE + 6,
        outlineWidth: ZC_BOSS_LABEL_OUTLINE_WIDTH,
    };
}

/** 血量倍率 → `X4`（整数不带小数点，与设计稿一致）；非法值退回 `X1`。 */
export function formatZCDefenceHpRate(hpRate: number): string {
    if (!Number.isFinite(hpRate) || hpRate <= 0) return 'X1';
    return `X${Number.isInteger(hpRate) ? hpRate : Number(hpRate.toFixed(2))}`;
}

/**
 * 波次怪守城（塔防）模式左上角的**首领条**：骷髅 + `第4/8波` + 首领头像框 + 名字 + 红血条 + `X4`。
 *
 * 几何、尺寸与全部美术都在 `ZCBossPanel.prefab` 里（蓝湖「BOSS」稿，画布 720×1610，切片 1:1），
 * 代码只按数据刷「文案 / 头像 / 血量比例」。面板整体由 `ZCGame` 在守城局实例化并注入数据
 * （与 `ZCSpawnSelection` 同一条路子：`ZCGameLoader` 预加载 → `ZCGame` 实例化）。
 *
 * 两块文案的格式化（`formatZCDefenceWaveText` / `formatZCDefenceHpRate`）**就放在本文件**：
 * 它们只服务这一块面板（合并前在 `ZCDefenceWaveText.ts`，2026-10-13 山猫让合进来删掉那个模块）。
 *
 * 数据口径（山猫 2026-10-13 定）：
 *  · 血条 = **本波剩余总血量 / 本波总血量**（按波聚合，不是取某只代表怪）
 *  · `X{n}` = 该波的**血量倍率**（`wave.hpRate`）
 *  · 头像与名字 = **当前波**（`currentWaveId`）那波的怪
 */
@ccclass('ZCHudBossPanel')
export class ZCHudBossPanel extends Component {
    @property({ type: Label, group: '节点引用', tooltip: 'WaveText：第N/M波（白字黑描边，压在沙地上）' })
    waveLabel: Label = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Portrait/Icon：首领头像（当前波那波的怪）' })
    portraitIcon: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BossName：首领名字' })
    nameLabel: Label = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Bar/Fill：本波血条填充（FILLED 横条）' })
    hpFill: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Bar/Rate：血量倍率 X4' })
    rateLabel: Label = null!;

    /**
     * 全量赋值（每次渲染都会被调）。
     *
     *  头像帧是**异步**拿到的：`null` 表示「还没加载到」而不是「这一波没头像」
     * ⇒ 保留上一张，别清空（清空会留一个空框，与「没这个怪」区分不开）。
     */
    render(progress: Readonly<ZCDefenceWaveProgress>, name: string, portrait: SpriteFrame | null): void {
        const wave = formatZCDefenceWaveText(progress);
        this.waveLabel.string = wave.text;
        this.waveLabel.fontSize = wave.fontSize;
        this.waveLabel.lineHeight = wave.lineHeight;
        this.waveLabel.outlineWidth = wave.outlineWidth;

        this.nameLabel.string = name;
        this.rateLabel.string = formatZCDefenceHpRate(progress.currentWaveHpRate);
        if (portrait) this.portraitIcon.spriteFrame = portrait;

        // 分母取「生成那一刻记下的总血量」，分母为 0（该波没生成出单位）时条画空。
        const ratio = progress.currentWaveMaxHp > 0 ? progress.currentWaveHp / progress.currentWaveMaxHp : 0;
        this.hpFill.fillRange = Math.max(0, Math.min(1, ratio));
    }
}
