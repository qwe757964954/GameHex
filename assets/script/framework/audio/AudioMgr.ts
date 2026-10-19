/**
 * 音频管理（音乐 / 音效的开关与音量 + 本地持久化 + 真实播放）。
 *
 * ## 为什么不用 `cc.audioEngine`
 *
 * 老端 `CtrlAudio` 全篇用 `cc.audioEngine.*`；早期搬进 Demo3.8 的
 * `engine/ResourceMgr.ts` 也曾照抄 `openMusic/openSound`，现已删除。
 * **Creator 3.8 已经没有 `audioEngine` 了**：
 * 在 `…/3.8.8/resources/resources/3d/engine` 全源里搜，`audioEngine` 只出现在
 * `pal/audio/native/player.ts`、`pal/audio/minigame/*` 这些**模块内局部变量**
 * （`const audioEngine = jsb.AudioEngine`），`cocos/audio/index.ts` 只导出
 * `AudioClip` / `AudioSource` / `AudioPCMDataView`。引擎 d.ts 里一个 `audioEngine` 都没有。
 * ⇒ `cc.audioEngine.playMusic(...)` 是**必炸**的死代码，别照着抄。
 *
 * 本类改用 3.8 的 `AudioSource`：
 *   · 音乐 —— 常驻 `_music` 源，`loop = true`，音量 `volume = 音量/100`；
 *   · 音效 —— 常驻 `_sound` 源（本身 `volume` 恒 1），每次 `playOneShot(clip, 音量/100)`。
 *     3.8 **没有**「全局音效音量」这种设施，老端 `setEffectsVolume` 的替代就是
 *     在这里把音量当 `volumeScale` 逐次乘进去。
 *
 * ## 状态口径
 *
 * 全部对齐老端 `OnOffMusic` / `OnOffSound` / `LayerSetting`：键名 `setting_music<account>`、
 * 首值 100（老端 `_value = true`）、关掉写 0、从 0 打开回落到 50。
 * 换算细节在零 `cc` 的 `AudioSettingTable.ts`，本文件只做「读存档 / 落存档 / 真播放」。
 *
 * ## 装配
 *
 * 不写进 `FW.ts` —— `FW → AudioMgr → ResourceMgr → FW` 是循环引用（`FW.ts` 顶部对
 * `CacheMgr` 有同类说明）。改成组合根注入，与 `FW.showTip = Toast.show` 同一手法：
 *
 * ```ts
 * // app/bootstrap/ProcedureBootstrap.onLoad()
 * AudioMgr.instance.init();
 * FW.playSound = (key: string) => { void AudioMgr.instance.playSound(key); };
 * ```
 */
import { AudioClip, AudioSource, Layers, Node, director, sys } from 'cc';
import { ResourceMgr } from '../../engine/ResourceMgr';
import { RefUtil } from '../ref/RefUtil';
import {
    ACCOUNT_STORAGE_KEY,
    AudioConfigRow,
    DEFAULT_VOLUME,
    buildClipPathMap,
    clampVolume,
    formatVolume,
    isVolumeOn,
    musicStorageKey,
    parseStoredVolume,
    resolveClipPath,
    soundStorageKey,
    toVolumeScale,
    toggleVolume,
} from './AudioSettingTable';

/** 音频配置表名（`assets/remoteRef/audioConfig.json`）。 */
export const AUDIO_CONFIG_TABLE = 'audioConfig';

/** 常驻音频节点名（探针按这个名字找）。 */
export const AUDIO_ROOT_NODE_NAME = 'AudioRoot';

export class AudioMgr {
    static __cname: string = 'AudioMgr';

    private static readonly _instance = new AudioMgr();

    static get instance(): AudioMgr {
        return AudioMgr._instance;
    }

    /** 当前账号（拼存档键用）。 */
    private _account: string = '';
    /** 音乐音量 0..100。 */
    private _musicVolume: number = DEFAULT_VOLUME;
    /** 音效音量 0..100。 */
    private _soundVolume: number = DEFAULT_VOLUME;

    /** 常驻节点与两个源；场景切换后被销毁 ⇒ 下次播放时 `ensureSources()` 自愈重建。 */
    private _root: Node | null = null;
    private _music: AudioSource | null = null;
    private _sound: AudioSource | null = null;

    /** `audioConfig` 的「键 → resources 相对路径」，懒加载一次。 */
    private _clipPaths: Map<string, string> | null = null;
    /** 已加载的 AudioClip（键 → clip）。**不参与引用计数**，见下方 `releaseClips`。 */
    private _clips = new Map<string, AudioClip>();

    /** 正在播放的音乐键（老端 `CtrlAudio.lastMusic`，同曲不重播）。 */
    private _lastMusicKey: string = '';
    /** 丢过期回调用：每次 `playMusic` 自增，回调回来对不上就丢弃。 */
    private _musicToken: number = 0;

    private constructor() { }

    //#region 生命周期

    /**
     * 初始化：读存档 + 建常驻节点。
     * @param account 不传则读 `localStorage['account_num']`（老端 `OnOff.GetAccount()`）
     */
    public init(account?: string): void {
        this.setAccount(account ?? this.readAccount());
        this.ensureSources();
    }

    /**
     * 切换账号并重新读存档。
     *
     * 老端 `OnOffMgr.OnLogin()` 干的就是这件事（逐个 `item.Load()`）——
     * 换号后别人的音量设置不该沿用。
     */
    public setAccount(account: string): void {
        this._account = account ?? '';
        this._musicVolume = this.readStoredVolume(musicStorageKey(this._account), DEFAULT_VOLUME);
        this._soundVolume = this.readStoredVolume(soundStorageKey(this._account), DEFAULT_VOLUME);
        this.applyVolumes();
    }

    /** 当前账号。 */
    public get account(): string {
        return this._account;
    }

    //#endregion

    //#region 音量读写（面板接线口）

    /** 音乐音量 0..100。 */
    public getMusicVolume(): number {
        return this._musicVolume;
    }

    /** 音效音量 0..100。 */
    public getSoundVolume(): number {
        return this._soundVolume;
    }

    /** 音乐开关是否「开」。 */
    public isMusicOn(): boolean {
        return isVolumeOn(this._musicVolume);
    }

    /** 音效开关是否「开」。 */
    public isSoundOn(): boolean {
        return isVolumeOn(this._soundVolume);
    }

    /** 面板数值文本（老端 `setText(value)`）。 */
    public getMusicVolumeText(): string {
        return formatVolume(this._musicVolume);
    }

    /** 面板数值文本。 */
    public getSoundVolumeText(): string {
        return formatVolume(this._soundVolume);
    }

    /** 滑动条回调用：写音乐音量（`Math.floor` 后落存档并立即生效）。 */
    public setMusicVolume(volume: unknown): number {
        this._musicVolume = clampVolume(volume);
        this.saveVolume(musicStorageKey(this._account), this._musicVolume);
        this.applyVolumes();
        return this._musicVolume;
    }

    /** 滑动条回调用：写音效音量（无全局音效音量，下次 `playSound` 生效）。 */
    public setSoundVolume(volume: unknown): number {
        this._soundVolume = clampVolume(volume);
        this.saveVolume(soundStorageKey(this._account), this._soundVolume);
        return this._soundVolume;
    }

    /** 音乐开关点击：`on=false` → 0；`on=true` 且当前是 0 → 50。 */
    public setMusicOn(on: boolean): number {
        return this.setMusicVolume(toggleVolume(this._musicVolume, on));
    }

    /** 音效开关点击。 */
    public setSoundOn(on: boolean): number {
        return this.setSoundVolume(toggleVolume(this._soundVolume, on));
    }

    //#endregion

    //#region 播放

    /**
     * 播背景音乐（同一首不重播，对齐老端 `CtrlAudio.PlayMusic` 的 `lastMusic` 去重）。
     * @returns 是否真的起了播放
     */
    public async playMusic(key: string): Promise<boolean> {
        if (!key || key === this._lastMusicKey) return false;
        this.ensureSources();
        if (!this._music) return false;

        const token = ++this._musicToken;
        const clip = await this.loadClip(key);
        // 加载期间又切了别的曲子 ⇒ 丢弃这次结果（否则会盖掉新的）
        if (!clip || token !== this._musicToken) return false;

        this._lastMusicKey = key;
        this._music.stop();
        this._music.clip = clip;
        this._music.loop = true;
        this._music.volume = toVolumeScale(this._musicVolume);
        this._music.play();
        return true;
    }

    /** 停背景音乐。 */
    public stopMusic(): void {
        this._musicToken++;
        this._lastMusicKey = '';
        if (this._music && this._music.isValid) {
            this._music.stop();
            this._music.clip = null;
        }
    }

    /** 当前正在播的音乐键（空串 = 没播）。 */
    public get currentMusicKey(): string {
        return this._lastMusicKey;
    }

    /**
     * 播音效。
     *
     * 音量为 0 时**直接早退**：既不发请求也不播放，省掉一次白加载
     * （老端是靠 `setEffectsVolume(0)` 静音，资源照样加载）。
     */
    public async playSound(key: string): Promise<boolean> {
        if (!key || !isVolumeOn(this._soundVolume)) return false;
        this.ensureSources();
        if (!this._sound) return false;

        const clip = await this.loadClip(key);
        if (!clip || !this._sound.isValid) return false;
        this._sound.playOneShot(clip, toVolumeScale(this._soundVolume));
        return true;
    }

    /** 音频配置表是否已就绪（探针/单测用）。 */
    public get clipTableReady(): boolean {
        return this._clipPaths != null;
    }

    /** 已缓存的 clip 数（探针用）。 */
    public get cachedClipCount(): number {
        return this._clips.size;
    }

    //#endregion

    //#region 内部

    /** 建/复用常驻节点。场景切换后旧节点会失效 ⇒ 重新建，避免「进第二局没声音」。 */
    private ensureSources(): void {
        if (this._root && this._root.isValid && this._music && this._music.isValid) return;

        const scene = director.getScene();
        if (!scene) return;                 // 未进场景（纯逻辑环境）⇒ 只保留状态，不崩

        const node = new Node(AUDIO_ROOT_NODE_NAME);
        node.layer = Layers.Enum.UI_2D;
        scene.addChild(node);

        const music = node.addComponent(AudioSource);
        music.playOnAwake = false;
        music.loop = true;
        music.volume = toVolumeScale(this._musicVolume);

        const sound = node.addComponent(AudioSource);
        sound.playOnAwake = false;
        // 音效音量逐次当 volumeScale 传给 playOneShot，所以基准音量恒 1
        sound.volume = 1;

        this._root = node;
        this._music = music;
        this._sound = sound;
    }

    private applyVolumes(): void {
        if (this._music && this._music.isValid) {
            this._music.volume = toVolumeScale(this._musicVolume);
        }
    }

    /**
     * 键 → AudioClip。
     *
     * 缓存**只挂 `_clips` 这个 JS Map**。注意这里**故意不 `addRef()`**：
     * 老端音效资源是「长住资源」，`resources.load` 出来的 clip 由引擎的资源缓存持有，
     * 手写 `addRef` 反而会在场景切换后留下永不释放的引用。
     * 真要显式释放走 `releaseClips()`。
     */
    private async loadClip(key: string): Promise<AudioClip | null> {
        const cached = this._clips.get(key);
        if (cached && cached.isValid) return cached;

        const path = await this.getClipPath(key);
        if (!path) return null;

        try {
            const clip = await ResourceMgr.load(path, undefined, undefined, AudioClip) as AudioClip | null;
            if (clip && clip.isValid) {
                this._clips.set(key, clip);
                return clip;
            }
            console.warn(`[AudioMgr] 音效资源加载不到：${key} → ${path}`);
        } catch (error) {
            console.warn(`[AudioMgr] 音效资源加载异常：${key} → ${path}`, error);
        }
        return null;
    }

    /** 显式释放已缓存的 clip（退出游戏/换号时可选调用）。 */
    public releaseClips(): void {
        this._clips.clear();
    }

    private async getClipPath(key: string): Promise<string> {
        if (this._clipPaths == null) {
            let rows: AudioConfigRow[] | null = null;
            try {
                rows = (await RefUtil.instance.getRefAllAsync(AUDIO_CONFIG_TABLE)) as AudioConfigRow[] | null;
            } catch (error) {
                console.warn('[AudioMgr] audioConfig 读取失败', error);
            }
            // 表没准备好也把空表落下来：避免每次播放都去重试一趟
            this._clipPaths = buildClipPathMap(rows);
        }
        return resolveClipPath(this._clipPaths, key);
    }

    private readAccount(): string {
        try {
            return sys.localStorage?.getItem(ACCOUNT_STORAGE_KEY) ?? '';
        } catch (error) {
            return '';
        }
    }

    private readStoredVolume(key: string, fallback: number): number {
        try {
            const raw = sys.localStorage?.getItem(key);
            const parsed = parseStoredVolume(raw);
            return parsed == null ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    }

    private saveVolume(key: string, volume: number): void {
        try {
            sys.localStorage?.setItem(key, String(volume));
        } catch (error) {
            console.warn(`[AudioMgr] 音量存档失败：${key}`, error);
        }
    }

    //#endregion
}

/** 组合根里省几行：把 `AudioMgr` 接到 `FW.playSound`。 */
export function bindAudioToFramework(fw: { playSound: (key: string) => void }): void {
    fw.playSound = (key: string): void => { void AudioMgr.instance.playSound(key); };
}
