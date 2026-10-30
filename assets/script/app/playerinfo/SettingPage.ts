import { _decorator, Button, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { AudioMgr } from '../../framework/audio/AudioMgr';
import { Toast } from '../common/Toast';
import { PLAYER_INFO_TEXTS } from './PlayerInfoTexts';
import { VolumeSlider } from './VolumeSlider';

const { ccclass, property } = _decorator;

/**
 * 「设置」面板 —— 老端 `LayerSetting`（`LayerSettingUI`，`app/game/ctrl/main/Xiulian/Setting/`），
 * FGUI `设置/组件/组件_设置.xml`（720×1280；弹窗底 `popBg` 626×438）。
 *
 * 版面：弹窗底 + 标题「设置」+ 关闭 → 小标题条「声音」
 * → 音乐图标 + 「音乐开关」+ 开关 + 「音乐音量」+ 滑动条 + 数值
 * → 音效图标 + 同类三件 → （设计期隐藏的）用户协议 / 隐私协议。
 *
 * ## 声音部分直连 `AudioMgr`（本工程新写的音频底座）
 *
 * 老端把音量挂在一组 `OnOff` 对象上（`OnOffMgr.OnOffMusic` / `OnOffSound`，各自
 * `SetValue` + `Save` 落 localStorage），并由 `CtrlAudio.SetMusicVolume/SetSoundVolume` 生效。
 * 本工程把这三件事收敛成一个 `AudioMgr.instance`（`framework/audio/AudioMgr.ts`，**真生效**）：
 *
 * | 老端 | 本页 |
 * |---|---|
 * | `onoff.Value` | `AudioMgr.instance.getMusicVolume()`（0..100） |
 * | `onoff.GetValue()`（bool 开关） | `isMusicOn()`（`volume > 0`） |
 * | `onoff.SetValue(...)` + `Save()` | `setMusicVolume(v)`（内部落存档） |
 * | `CtrlAudio.SetMusicVolume` | 同上（`AudioMgr` 内部 `applyVolumes()`） |
 * | 开关的 `selected ? (value==0 ? 50 : value) : 0` | `setMusicOn(on)`（`toggleVolume` 同式） |
 *
 * ## 开关的两个视觉状态怎么来的
 *
 * FGUI 的 `按钮_声音_开关` 是个 `extention="Button"` 组件，内部带一个自制 `button` 控制器
 * （`pages="4,up,5,down,6,over,7,selectedOver"`）：
 * `n37`(滑块·左) + `n36`(「关」) 挂 `pages="4,6"`，`n32`(滑块·右) + `n35`(「开」) 挂 `pages="5,7"`。
 * `GButton.updateState()` 在**选中**时把页设成 `selectedOver`、未选中设成 `up`
 * ⇒ 老端 `btn.selected = onoff.GetValue()` 就是在两个状态间切。
 *
 * 布局引擎只烘**设计期那一页**（该实例写的是 `selected="0"`，`4/5/6/7` 都不是它 ⇒ 四个节点
 * **全被算成隐藏**）。所以生成器 `inline` 里按上面这份出处把它们改回「关」态
 * （`OffLabel` / `OffKnob` 可见），运行期由本页**无条件写**四个 `active`（规则 82）。
 */
@ccclass('SettingPage')
export class SettingPage extends PopupBase {
    /** 预制体路径（目录名必须与磁盘一致，热更新 zip 内大小写敏感）。 */
    static prefabPath = 'ui/PlayerInfo/Setting';

    // ---------- 弹窗框 ----------
    @property({ type: Node, tooltip: 'PopBg/CloseBtn：关闭按钮' })
    closeButton: Node = null;

    // ---------- 音乐 ----------
    @property({ type: Node, tooltip: 'MusicSwitch：「音乐开关」整块（挂 cc.Button）' })
    musicSwitch: Node = null;

    @property({ type: Node, tooltip: 'MusicSwitch/OffKnob：关态滑块（靠左）' })
    musicOffKnob: Node = null;
    @property({ type: Node, tooltip: 'MusicSwitch/OnKnob：开态滑块（靠右）' })
    musicOnKnob: Node = null;
    @property({ type: Node, tooltip: 'MusicSwitch/OffLabel：「关」字' })
    musicOffLabel: Node = null;
    @property({ type: Node, tooltip: 'MusicSwitch/OnLabel：「开」字' })
    musicOnLabel: Node = null;

    @property({ type: VolumeSlider, tooltip: 'MusicSlider：音乐音量滑动条' })
    musicSlider: VolumeSlider = null;

    @property({ type: Label, tooltip: 'MusicVolumeValue：音乐音量数值文本' })
    musicVolumeValue: Label = null;

    // ---------- 音效 ----------
    @property({ type: Node, tooltip: 'SoundSwitch：「音效开关」整块' })
    soundSwitch: Node = null;

    @property({ type: Node, tooltip: 'SoundSwitch/OffKnob：关态滑块' })
    soundOffKnob: Node = null;
    @property({ type: Node, tooltip: 'SoundSwitch/OnKnob：开态滑块' })
    soundOnKnob: Node = null;
    @property({ type: Node, tooltip: 'SoundSwitch/OffLabel：「关」字' })
    soundOffLabel: Node = null;
    @property({ type: Node, tooltip: 'SoundSwitch/OnLabel：「开」字' })
    soundOnLabel: Node = null;

    @property({ type: VolumeSlider, tooltip: 'SoundSlider：音效音量滑动条' })
    soundSlider: VolumeSlider = null;

    @property({ type: Label, tooltip: 'SoundVolumeValue：音效音量数值文本' })
    soundVolumeValue: Label = null;

    // ============================================================
    // 生命周期
    // ============================================================

    /**
     * 绑按钮。
     *
     * ⚠️ FGUI `<loader>` / `<image>` 迁过来**只有 `cc.Sprite`、没有 `cc.Button`**（规则 81b）：
     * 那种节点上绑 `Button.EventType.CLICK` 是**静默死按钮**。反过来 `extention="Button"`
     * 形态迁过来**有** `cc.Button`，绑 `TOUCH_END` 会绕过 `interactable`。按实际组件分流。
     */
    private bindButton(node: Node | null | undefined, handler: () => void): void {
        if (!node) return;
        const button = node.getComponent(Button);
        if (button) {
            button.node.on(Button.EventType.CLICK, handler, this);
            return;
        }
        node.on(Node.EventType.TOUCH_END, handler, this);
    }

    protected onInit(): void {
        this.bindButton(this.closeButton, () => this.close(PopupCloseReason.CloseButton));
        this.bindButton(this.musicSwitch, () => this.onSwitchToggle(true));
        this.bindButton(this.soundSwitch, () => this.onSwitchToggle(false));

        // ⚠️ 回调**只绑一次**（`onInit` 只跑一次）：拖滑动条时 `onChanged` 会被高频调用。
        if (this.musicSlider) {
            this.musicSlider.onChanged = (v: number) => this.onVolumeChanged(v, true);
        }
        if (this.soundSlider) {
            this.soundSlider.onChanged = (v: number) => this.onVolumeChanged(v, false);
        }
    }

    protected onOpen(): void {
        // 每次打开都从 `AudioMgr`（= 存档）重新读一遍 —— 换号后别人的音量不该沿用。
        AudioMgr.instance.init();
        this.present();
    }

    // ============================================================
    // 铺界面
    // ============================================================

    /**
     * 铺全部状态。**一律无条件写**（规则 82）：开关与滑动条是一对双向驱动的控件，
     * 「只在翻转时写」会让另一侧停在旧值。
     */
    private present(): void {
        const mgr = AudioMgr.instance;

        const musicOn = mgr.isMusicOn();
        const soundOn = mgr.isSoundOn();
        const musicVolume = mgr.getMusicVolume();
        const soundVolume = mgr.getSoundVolume();

        this.presentSwitch(musicOn, this.musicOnKnob, this.musicOffKnob, this.musicOnLabel, this.musicOffLabel);
        this.presentSwitch(soundOn, this.soundOnKnob, this.soundOffKnob, this.soundOnLabel, this.soundOffLabel);

        // `setValue` 的第二参 `notify = false`：这里是**外部驱动**，回调再打回来会自激。
        this.musicSlider?.setValue(musicVolume, false);
        this.soundSlider?.setValue(soundVolume, false);

        if (this.musicVolumeValue) this.musicVolumeValue.string = mgr.getMusicVolumeText();
        if (this.soundVolumeValue) this.soundVolumeValue.string = mgr.getSoundVolumeText();
    }

    /** 一个开关的四个节点。`on` 为真 = 滑块靠右 + 显示「开」。 */
    private presentSwitch(
        on: boolean,
        onKnob: Node | null | undefined,
        offKnob: Node | null | undefined,
        onLabel: Node | null | undefined,
        offLabel: Node | null | undefined,
    ): void {
        if (onKnob) onKnob.active = on;
        if (offKnob) offKnob.active = !on;
        if (onLabel) onLabel.active = on;
        if (offLabel) offLabel.active = !on;
    }

    // ============================================================
    // 交互
    // ============================================================

    /**
     * 点开关。
     *
     * 老端（以音效为例，`LayerSettingUI.InitClick` 的 `data[0].click`）：
     * ```js
     * let selected = btn.selected                       // FGUI Check 按钮：点完已翻转
     * let value = onoff.Value
     * onoff.SetValue(selected ? (value == 0 ? DEFAULT_SOUND_VOLUME : value) : 0)
     * onoff.Save()
     * this.CtrlAudio.SetSoundVolume(selected ? onoff.Value : 0)
     * ssl.value = onoff.Value                           // 滑动条跟着跳
     * com.tm("文本_音效音量_数值").setText(onoff.Value)
     * ```
     * 本工程 `AudioMgr.setSoundOn(on)` 内部就是 `toggleVolume(当前值, on)`（同一条 `value == 0 ⇒ 50`），
     * `present()` 负责把滑动条与文本同步过去。
     *
     * ⚠️ 我们**没有** `cc.Button.selected` 这个状态（`cc.Button` 不是 `cc.Toggle`），
     * 所以「点完的新状态」由当前值取反得到 —— 语义与 FGUI 的 Check 按钮一致。
     */
    private onSwitchToggle(isMusic: boolean): void {
        const mgr = AudioMgr.instance;
        if (isMusic) mgr.setMusicOn(!mgr.isMusicOn());
        else mgr.setSoundOn(!mgr.isSoundOn());
        this.present();
    }

    /** 拖动滑动条。老端 `Math.floor(msl.value)` 后写 `OnOff` + 立即生效。 */
    private onVolumeChanged(volume: number, isMusic: boolean): void {
        const mgr = AudioMgr.instance;
        if (isMusic) mgr.setMusicVolume(volume);
        else mgr.setSoundVolume(volume);
        this.present();
    }

    /**
     * 「用户协议 / 隐私协议」。
     *
     * ⚠️ 这两个按钮在 FGUI 原稿里就是 `visible="false"`，老端 196 行里除了 `setClick`
     * **也没有任何一行把它们显示出来**（提审开关那几行是注释掉的）⇒ 老端自己就是死代码。
     * 本页保持它们隐藏、**不挂事件**，只留节点：真要接的时候，出处是
     * `CtrlLogin.LayerAgreement.load({ type: 1 | 2 })`（1 = 用户协议，2 = 隐私协议）。
     */
    protected canCloseOnBlank(): boolean {
        return true;
    }

    /** 未接入的跳转提示（协议按钮将来接线时复用）。 */
    showNotWired(): void {
        Toast.show(PLAYER_INFO_TEXTS.jumpNotWired);
    }

    /** 探针用：当前音乐 / 音效音量（直接读 `AudioMgr`，绕过界面）。 */
    get volumes(): { music: number; sound: number; musicOn: boolean; soundOn: boolean } {
        const mgr = AudioMgr.instance;
        return {
            music: mgr.getMusicVolume(),
            sound: mgr.getSoundVolume(),
            musicOn: mgr.isMusicOn(),
            soundOn: mgr.isSoundOn(),
        };
    }
}
