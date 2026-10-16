import { _decorator, Color, Component, Label, Sprite } from 'cc';

const { ccclass, property } = _decorator;
const LOADING_MESSAGE = '正在加载，请稍候…';

/**
 * 启动进度页组件（热更 + 登录后资源加载共用）。
 *
 * 挂在 `LaunchProgress.prefab` 根节点上，结构与实现对齐旧 `PostLoginLoadingPage`：
 * 轨道 + 横向填充条（白色圆角条 `image/main/bar_white`：轨道染深色、填充条白色原样，
 * FILLED + fillRange 裁剪）+ 百分比文本 + 状态文本四个引用，`onLoad` 代码兜底初始化样式；
 * 两个启动流程通过 `LaunchProgressUI` 驱动它。
 *
 * 相对旧页面的增量：`setStatus` 供热更阶段展示具体状态（检查/下载/校验），
 * `setProgress(null)` 表示无确定进度（检查/校验/提交阶段）——填充归零、不显示百分比。
 *
 * prefab 放 `resources`（首包内置，**不进远程热更 bundle**），因此热更阶段
 * （`ProcedureUpdate`）可以直接加载使用，不依赖任何远端资源。
 */
@ccclass('LaunchProgressPage')
export class LaunchProgressPage extends Component {
    @property({ type: Sprite, tooltip: '进度条轨道' })
    progressTrack: Sprite | null = null;

    @property({ type: Sprite, tooltip: '横向填充的进度条' })
    progressFill: Sprite | null = null;

    @property({ type: Label, tooltip: '百分比文本' })
    progressLabel: Label | null = null;

    @property({ type: Label, tooltip: '加载状态' })
    statusLabel: Label | null = null;

    onLoad(): void {
        // 样式已在 prefab 中设置；代码兜底，保证与旧 PostLoginLoadingPage 视觉口径一致。
        // 轨道/填充都用白色圆角条 image/main/bar_white（不改图）：轨道染深色、填充条染
        // 以前的青色(59,206,235)，填充用 FILLED 横向裁剪驱动进度（fillRange）。
        if (this.progressTrack) this.progressTrack.color = new Color(30, 43, 61, 230);
        if (this.progressFill) {
            this.progressFill.type = Sprite.Type.FILLED;
            this.progressFill.fillType = Sprite.FillType.HORIZONTAL;
            this.progressFill.fillStart = 0;
            this.progressFill.color = new Color(59, 206, 235, 255);
        }
        this.setProgress(0);
    }

    /**
     * 进度条填充（0~1）。`null` = 无确定进度（检查/校验/提交阶段），填充归零、不显示百分比。
     */
    setProgress(ratio: number | null): void {
        const normalized = ratio === null ? 0 : Math.max(0, Math.min(1, ratio));
        if (this.progressFill) this.progressFill.fillRange = normalized;
        if (this.progressLabel) {
            this.progressLabel.string = ratio === null ? '' : `${Math.round(normalized * 100)}%`;
        }
    }

    /** 状态文本（热更阶段：检查/下载/校验等具体文案）。 */
    setStatus(message: string): void {
        if (this.statusLabel) this.statusLabel.string = message;
    }

    showError(): void {
        this.setStatus('加载失败，请重新进入游戏');
    }
}
